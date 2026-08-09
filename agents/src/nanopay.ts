import "dotenv/config";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { BatchEvmScheme, CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { publicClient, withRpcRetry } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi } from "./abis.js";
import { circleClient, circleExecute } from "./circle.js";

// Circle Gateway Nanopayments: x402 settled through Gateway's batched infrastructure
// rather than one onchain transaction per payment.
//
// The difference from x402.ts, which we keep as the fallback:
//
//   x402.ts        buyer signs EIP-3009 against the USDC contract, the operator submits
//                  it onchain. One transaction, one gas fee, per payment.
//   this file      buyer signs EIP-3009 against the GatewayWalletBatched domain, Circle
//                  verifies it and settles many payments together in one batch. The buyer
//                  pays no gas and neither does the operator: the seller is credited from
//                  a Gateway balance the buyer deposited once.
//
// That is the whole point for an agent marketplace. Our orders run to fractions of a
// USDC, and paying Arc gas on every one of them to move 0.35 USDC is the cost structure
// x402 exists to remove.
//
// Two things the docs do not make obvious and which cost time to find:
//   1. The SDK defaults to the MAINNET Gateway host, which serves no testnet at all. Arc
//      testnet only appears on gateway-api-testnet.circle.com.
//   2. The buyer must deposit into the Gateway Wallet contract first. Its Gateway balance
//      is a separate pot from its wallet balance, and a payment draws on the former.

const USDC = addresses.usdc as Address;
const ARC = CHAIN_CONFIGS.arcTestnet;
const GATEWAY_WALLET = ARC.gatewayWallet as Address;
const NETWORK = `eip155:${addresses.chainId}`;

const GATEWAY_URL = process.env.GATEWAY_API_URL ?? "https://gateway-api-testnet.circle.com";

const fmt = (b: bigint) => formatUnits(b, 6);

export const facilitator = new BatchFacilitatorClient({ url: GATEWAY_URL });

/** The Gateway Wallet's own ABI, just the two calls a depositor needs. */
const gatewayWalletAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "availableBalance",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "depositor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** What this agent can spend through Gateway, which is not the same as what is in its wallet. */
export async function gatewayBalance(wallet: Address): Promise<bigint> {
  return (await withRpcRetry(() =>
    publicClient.readContract({
      address: GATEWAY_WALLET,
      abi: gatewayWalletAbi,
      functionName: "availableBalance",
      args: [USDC, wallet],
    }),
  )) as bigint;
}

/**
 * Move USDC from an agent's wallet into its Gateway balance. One onchain transaction,
 * signed by the agent itself, after which its payments cost no gas at all.
 */
export async function depositToGateway(walletId: string, amount: bigint): Promise<Hex> {
  await circleExecute(walletId, USDC, "approve(address,uint256)", [GATEWAY_WALLET, amount.toString()]);
  return circleExecute(walletId, GATEWAY_WALLET, "deposit(address,uint256)", [USDC, amount.toString()]);
}

/**
 * A Circle Developer Controlled Wallet presented as something the x402 SDK can sign with.
 *
 * The SDK's own quickstart wants a raw private key. Our agents do not have one: their keys
 * are held by Circle under MPC and never leave it. The signer interface it actually
 * requires is only `{ address, signTypedData }`, and a Circle wallet can do exactly that,
 * so the agents keep custody and still sign a valid Gateway authorization.
 */
function circleSigner(address: Address, walletId: string) {
  return {
    address,
    signTypedData: async (params: {
      domain: unknown;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<Hex> => {
      // Circle wants EIP712Domain declared explicitly and every value as a string.
      const typed = {
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          ...params.types,
        },
        primaryType: params.primaryType,
        domain: params.domain,
        message: Object.fromEntries(
          Object.entries(params.message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
        ),
      };
      const res = await circleClient.signTypedData({ walletId, data: JSON.stringify(typed) });
      const sig = (res.data as { signature?: string })?.signature;
      if (!sig) throw new Error("Circle signTypedData returned no signature");
      return sig as Hex;
    },
  };
}

/** The seller's terms, as Gateway itself declares them for Arc. Cached per process. */
let terms: { scheme: string; network: string; extra: Record<string, unknown> } | null = null;

async function arcTerms() {
  if (terms) return terms;
  const { kinds } = await facilitator.getSupported();
  const kind = (kinds as { scheme: string; network: string; extra?: Record<string, unknown> }[]).find(
    (k) => k.network === NETWORK,
  );
  if (!kind) {
    throw new Error(
      `Circle Gateway does not offer nanopayments on ${NETWORK} via ${GATEWAY_URL}. ` +
        `The mainnet host serves no testnets; set GATEWAY_API_URL to the testnet host.`,
    );
  }
  terms = { scheme: kind.scheme, network: kind.network, extra: kind.extra ?? {} };
  return terms;
}

export type NanoResult = { settled: true; tx: string | null } | { settled: false; reason: string };

/**
 * One agent pays another over x402, settled by Gateway in a batch.
 *
 * The three x402 roles are all here: the seller states its terms, the buyer signs a
 * payment for them, and the facilitator verifies and settles. We are not running an HTTP
 * server between the agents, so the 402 negotiation happens in process; what crosses the
 * wire to Circle is exactly what a networked x402 seller would send.
 */
export async function payViaNanopayments(
  buyerWalletId: string,
  buyer: Address,
  seller: Address,
  amount: bigint,
  service = "agenture-service",
): Promise<NanoResult> {
  const t = await arcTerms();

  // `resource` describes what is being bought. Over HTTP it is the endpoint that returned
  // the 402; Gateway requires it either way, as a structured object rather than a string.
  const resource = {
    url: `https://agenture.market/${seller}`,
    description: "Agenture marketplace service call",
    mimeType: "application/json",
    serviceName: service.slice(0, 32),
    tags: ["agenture"],
  };

  // 1. The seller's demand.
  const requirements = {
    scheme: t.scheme,
    network: t.network,
    asset: USDC,
    amount: amount.toString(),
    payTo: seller,
    resource,
    maxTimeoutSeconds: 600,
    extra: t.extra,
  };

  // 2. The buyer signs it. Off-chain, no gas, from its own Circle wallet.
  const scheme = new BatchEvmScheme(circleSigner(buyer, buyerWalletId) as never);
  const signed = await scheme.createPaymentPayload(2, requirements as never);

  // Gateway wants the payload to carry the resource it is paying for and the exact terms
  // being accepted, so it can check the signature against what the seller actually asked.
  const payload = { ...signed, resource, accepted: requirements };

  // 3. The facilitator checks it is good for the money before anything settles.
  const verified = await facilitator.verify(payload as never, requirements as never);
  if (!(verified as { isValid?: boolean }).isValid) {
    const why = (verified as { invalidReason?: string }).invalidReason ?? "unknown";
    return { settled: false, reason: `Gateway rejected the authorization: ${why}` };
  }

  // 4. Settle. Gateway batches this with everyone else's and pays gas once for the lot.
  const settled = await facilitator.settle(payload as never, requirements as never);
  const ok = (settled as { success?: boolean }).success;
  if (!ok) {
    return { settled: false, reason: (settled as { errorReason?: string }).errorReason ?? "settlement failed" };
  }
  return { settled: true, tx: (settled as { transaction?: string }).transaction ?? null };
}

// Top the buyers' Gateway balances up so a market run can pay gas free. Run once, or
// whenever a buyer has spent its balance down.
//
//   bun run gateway-deposit            deposit the default per buyer
//   bun run gateway-deposit -- --check show balances, move nothing
async function main() {
  const { liveCustomers, budgetOf } = await import("./customers.js");
  const check = process.argv.includes("--check");
  // Default to the buyer's whole budget, not a flat figure. A single order draws on one
  // rail or the other, so a buyer holding less in Gateway than its largest possible order
  // silently falls back to paying onchain for that one. Matching the budget keeps every
  // purchase on the gasless rail.
  const override = process.env.GATEWAY_DEPOSIT_USDC;

  console.log(`=== Gateway balances · ${GATEWAY_URL} ===\n`);
  const t = await arcTerms().catch((e) => {
    console.log(String((e as Error).message));
    return null;
  });
  if (!t) return;
  console.log(`Arc nanopayments live: scheme ${t.scheme}, verifying ${String(t.extra.verifyingContract)}\n`);

  for (const c of liveCustomers()) {
    const target = override !== undefined ? parseUnits(override, 6) : budgetOf(c);
    const held = await gatewayBalance(c.wallet);
    const wallet = (await withRpcRetry(() =>
      publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [c.wallet] }),
    )) as bigint;
    console.log(`${c.name.padEnd(13)} gateway ${fmt(held).padStart(8)}  wallet ${fmt(wallet).padStart(8)}`);

    if (check || held >= target) continue;
    const short = target - held;
    if (wallet < short) {
      console.log(`  wallet is short ${fmt(short - wallet)} USDC; run fund-customers first.`);
      continue;
    }
    const tx = await depositToGateway(c.walletId, short);
    console.log(`  deposited ${fmt(short)} USDC into Gateway · ${tx}`);
  }

  if (check) console.log("\nCheck only: nothing moved.");
}

if (process.argv[1]?.endsWith("nanopay.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
