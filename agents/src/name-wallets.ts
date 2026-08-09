import "dotenv/config";
import { renameWallet, labelFor, type WalletLabel } from "./circle.js";
import { addresses } from "./config.js";
import { startups } from "./startups.js";
import { customers } from "./customers.js";

// Label every Circle wallet Agenture owns, so the console shows who each one is instead
// of a column of addresses. Wallets minted before labelling was wired in are renamed here;
// anything provisioned from now on is named at creation.
//
// Names are set from the rosters, which are the source of truth for who is who, so this is
// safe to re-run and will quietly repair a wallet someone renamed by hand.
//
//   bun run name-wallets -- --dry     see what it would set, change nothing

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Target = { walletId: string; label: WalletLabel };

function targets(): Target[] {
  const out: Target[] = [];

  for (const j of addresses.agenture.judges) {
    out.push({ walletId: j.walletId, label: labelFor("Judge", j.name) });
  }
  for (const s of startups) {
    out.push({ walletId: s.walletId, label: labelFor("Startup", s.name) });
  }
  for (const c of customers) {
    if (c.walletId) out.push({ walletId: c.walletId, label: labelFor("Customer", c.name) });
  }

  // The original single house customer, still the rater behind seed-traction and still
  // holding USDC, so it needs to be findable too.
  const house = addresses.agenture.customer;
  if (house?.walletId) {
    // No parentheses: Circle rejects them in a wallet name with "API parameter invalid".
    out.push({ walletId: house.walletId, label: { name: "Customer House legacy", refId: "customer:house" } });
  }

  return out;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const all = targets();

  console.log(`Naming ${all.length} Circle wallets${dryRun ? " (dry run)" : ""}.\n`);

  let done = 0;
  for (const t of all) {
    console.log(`${t.label.name.padEnd(28)} ${t.label.refId.padEnd(24)} ${t.walletId}`);
    if (dryRun) continue;
    try {
      await renameWallet(t.walletId, t.label);
      done++;
    } catch (e) {
      // A wallet that no longer exists, or one from an earlier wallet set, must not stop
      // the rest from being labelled.
      console.log(`  failed: ${String((e as Error).message).split("\n")[0]}`);
    }
    await sleep(400);
  }

  console.log(dryRun ? "\nDry run: nothing changed." : `\nNamed ${done} of ${all.length} wallets.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
