import "dotenv/config";
import type { Address, Hex } from "viem";
import { parseSignature, toHex } from "viem";
import { randomBytes } from "node:crypto";
import { walletFromKey, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { circleClient } from "./circle.js";

const USDC = addresses.usdc as Address;
const CHAIN_ID = addresses.chainId;

// USDC EIP-3009. The v,r,s form is supported by USDC v2 and is what x402 settles with:
// the payer signs an authorization off-chain, a facilitator submits it onchain.
const authAbi = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

export type X402Payment = {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
};

// A payment requirement, the x402 quote: pay `value` to `to`, valid for one hour, with a
// fresh random nonce (USDC rejects a nonce twice, which stops replay).
export function createPayment(from: Address, to: Address, value: bigint): X402Payment {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    from,
    to,
    value,
    validAfter: 0n,
    validBefore: now + 3600n,
    nonce: toHex(randomBytes(32)),
  };
}

// The customer (a Circle wallet) signs the EIP-3009 authorization off-chain via Circle.
// This signature is the x402 payment payload and costs the payer no gas.
export async function signPayment(customerWalletId: string, p: X402Payment): Promise<Hex> {
  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
    message: {
      from: p.from,
      to: p.to,
      value: p.value.toString(),
      validAfter: p.validAfter.toString(),
      validBefore: p.validBefore.toString(),
      nonce: p.nonce,
    },
  };

  const res = await circleClient.signTypedData({ walletId: customerWalletId, data: JSON.stringify(typedData) });
  const sig = (res.data as { signature?: string })?.signature;
  if (!sig) throw new Error("Circle signTypedData returned no signature");
  return sig as Hex;
}

// The facilitator (operator EOA) submits the signed authorization onchain and pays gas.
// The payer's USDC moves to the recipient: this settles the x402 payment.
export async function settlePayment(relayerKey: Hex, p: X402Payment, signature: Hex): Promise<Hex> {
  const { r, s, v, yParity } = parseSignature(signature);
  let vByte = v !== undefined ? Number(v) : yParity + 27;
  if (vByte < 27) vByte += 27;

  const relayer = walletFromKey(relayerKey);
  const hash = await withRpcRetry(() =>
    relayer.writeContract({
      address: USDC,
      abi: authAbi,
      functionName: "transferWithAuthorization",
      args: [p.from, p.to, p.value, p.validAfter, p.validBefore, p.nonce, vByte, r, s],
    }),
  );
  await waitReceipt(hash);
  return hash;
}

// Full x402 payment: the customer signs, the facilitator settles. Returns the settlement
// tx hash. This is how a startup earns its service revenue, agent to agent, in USDC.
export async function payViaX402(
  customerWalletId: string,
  customerAddress: Address,
  relayerKey: Hex,
  to: Address,
  value: bigint,
): Promise<Hex> {
  const payment = createPayment(customerAddress, to, value);
  const signature = await signPayment(customerWalletId, payment);
  return settlePayment(relayerKey, payment, signature);
}
