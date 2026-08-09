import "dotenv/config";
import type { Address } from "viem";
import { formatUnits, parseUnits } from "viem";
import { publicClient, withRpcRetry } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi } from "./abis.js";
import { startups } from "./startups.js";
import { circleExecute } from "./circle.js";
import { liveCustomers, budgetOf } from "./customers.js";

const USDC = addresses.usdc as Address;
const fmt = (b: bigint) => formatUnits(b, 6);
const U = (n: string) => parseUnits(n, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function balanceOf(addr: Address): Promise<bigint> {
  return (await withRpcRetry(() =>
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
  )) as bigint;
}

// The testnet economy is closed: USDC only ever flows fund -> seller and customer ->
// seller, so the customers run dry while the sellers pool everything. Sending some of it
// back keeps the same coins circulating. This is plumbing for a fixed-supply testnet, not
// part of the fund's economics: the revenue share the fund earns is real either way.
//
// Each customer is topped up to its own budget and no further. Handing every buyer the
// same float would quietly erase the difference between a desk with 7 USDC to spend and
// one with 3, and that difference is half of what makes the demand uneven.
export async function recycle(headroom: number): Promise<void> {
  const buyers = liveCustomers();
  if (buyers.length === 0) {
    console.log("No customer agents provisioned yet; nothing to recycle. Run: bun run provision-customers\n");
    return;
  }

  const wants: Array<{ name: string; wallet: Address; needed: bigint }> = [];
  for (const c of buyers) {
    const target = (budgetOf(c) * BigInt(Math.round(headroom * 100))) / 100n;
    const held = await balanceOf(c.wallet);
    if (held < target) wants.push({ name: c.name, wallet: c.wallet, needed: target - held });
    else console.log(`${c.name} holds ${fmt(held)} USDC, no top-up needed.`);
  }
  if (wants.length === 0) {
    console.log("");
    return;
  }

  console.log(`Topping up ${wants.map((w) => `${w.name} (+${fmt(w.needed)})`).join(", ")} from seller earnings.`);

  let want = wants.shift();
  for (const s of startups) {
    if (!want) break;
    const balance = await balanceOf(s.wallet);
    // Leave every seller a working balance so it can still pay gas and settle.
    let spare = balance > U("5") ? balance - U("5") : 0n;
    if (spare <= 0n) continue;

    while (want && spare > 0n) {
      const amount = spare < want.needed ? spare : want.needed;
      await circleExecute(s.walletId, USDC, "transfer(address,uint256)", [want.wallet, amount.toString()]);
      console.log(`  ${s.name} paid ${fmt(amount)} USDC to ${want.name}.`);
      spare -= amount;
      want.needed -= amount;
      if (want.needed <= 0n) want = wants.shift();
      await sleep(1500);
    }
  }

  const short = [want, ...wants].filter(Boolean) as Array<{ name: string; needed: bigint }>;
  if (short.length > 0) {
    console.log(`  ${short.map((w) => `${w.name} still short ${fmt(w.needed)}`).join(", ")}; sellers have nothing spare.`);
  }
  console.log("");
}

// Runnable on its own, because a freshly provisioned customer has gas and nothing to
// spend, and waiting for a whole cycle to fix that means running a judging round just to
// put money in a wallet.
async function main() {
  const headroom = Number(process.env.CYCLE_CUSTOMER_HEADROOM ?? "1.4");
  console.log(`=== Agenture recycle · ${new Date().toISOString()} ===\n`);
  await recycle(headroom);
  for (const c of liveCustomers()) console.log(`${c.name.padEnd(13)} ${fmt(await balanceOf(c.wallet))} USDC`);
}

if (process.argv[1]?.endsWith("recycle.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
