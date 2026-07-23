import "dotenv/config";
import { createWallet } from "./circle.js";
import { addresses } from "./config.js";
import { startups } from "./startups.js";

// Provision one Circle wallet per agent (judges + startups) in the existing wallet set.
// Prints the mapping to wire into shared/addresses.json (judges) and startups.ts.
const WALLET_SET = process.env.CIRCLE_WALLET_SET ?? "3f824ea9-5876-52b8-ad82-ba4cfe2f8cf3";

async function main() {
  const agents = [
    ...addresses.agenture.judges.map((j) => ({ kind: "judge", name: j.name })),
    ...startups.map((s) => ({ kind: "startup", name: s.name })),
  ];

  console.log(`Provisioning ${agents.length} Circle wallets in set ${WALLET_SET}\n`);

  for (const a of agents) {
    const w = await createWallet(WALLET_SET);
    console.log(`${a.kind.padEnd(8)} ${a.name.padEnd(12)} walletId ${w.id}  address ${w.address}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
