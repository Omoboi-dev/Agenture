import "dotenv/config";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { publicClient, walletFromKey, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi, fundAbi } from "./abis.js";
import { getJudgeState } from "./fund.js";
import { loadJudges } from "./judges.js";
import { startups } from "./startups.js";

// Operator-only. Gets the migrated agents ready: gas-funds every Circle wallet and
// registers the judges in the Fund at their new Circle addresses (existing agentIds and
// mandates). Idempotent: skips wallets already funded and judges already registered.
const USDC = addresses.usdc as Address;
const FUND = addresses.agenture.fund as Address;

function envKey(name: string): Hex {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing ${name} in environment`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

async function balanceOf(addr: Address): Promise<bigint> {
  return (await withRpcRetry(() =>
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
  )) as bigint;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const op = walletFromKey(envKey("DEPLOYER_PRIVATE_KEY"));
  const gas = parseUnits(process.env.CIRCLE_GAS_USDC ?? "0.7", 6);
  const judges = loadJudges();

  console.log("=== Agenture onboard-circle ===\n");

  // 1. Gas-fund every agent Circle wallet.
  const wallets: { label: string; addr: Address }[] = [
    ...judges.map((j) => ({ label: `judge ${j.name}`, addr: j.wallet })),
    ...startups.map((s) => ({ label: `startup ${s.name}`, addr: s.wallet })),
  ];
  for (const w of wallets) {
    if ((await balanceOf(w.addr)) >= gas) {
      console.log(`${w.label}: already funded, skipping.`);
      continue;
    }
    const h = await withRpcRetry(() =>
      op.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [w.addr, gas] }),
    );
    await waitReceipt(h);
    console.log(`${w.label}: sent ${formatUnits(gas, 6)} USDC gas -> ${w.addr}`);
    await sleep(1500);
  }

  // 2. Register judges in the Fund at their Circle addresses.
  for (const j of judges) {
    if ((await getJudgeState(j.wallet)).active) {
      console.log(`judge ${j.name}: already registered in Fund, skipping.`);
      continue;
    }
    const h = await withRpcRetry(() =>
      op.writeContract({
        address: FUND,
        abi: fundAbi,
        functionName: "registerJudge",
        args: [j.wallet, j.agentId, j.mandate],
      }),
    );
    await waitReceipt(h);
    console.log(`judge ${j.name}: registered at ${j.wallet} (mandate ${formatUnits(j.mandate, 6)} USDC).`);
    await sleep(1500);
  }

  console.log("\nOnboarding complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
