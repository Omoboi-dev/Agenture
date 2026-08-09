import "dotenv/config";
import type { Address, Hex } from "viem";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

// The Circle Developer Controlled Wallets client. Agents (judges and startups) hold
// Circle wallets and sign through this; the operator stays a plain EOA admin. Keys never
// leave Circle (MPC), we drive wallets by walletId. Needs CIRCLE_API_KEY + ENTITY_SECRET.
export const circleClient = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY ?? "",
  entitySecret: process.env.ENTITY_SECRET ?? "",
});

const BLOCKCHAIN = "ARC-TESTNET";

export async function createWalletSet(name: string): Promise<string> {
  const res = await circleClient.createWalletSet({ name });
  const id = res.data?.walletSet?.id;
  if (!id) throw new Error("failed to create wallet set");
  return id;
}

// Every wallet is created with a label. Without one the Circle console is a list of
// addresses with nothing to tell a judge from a seller from a buyer, and picking the
// wrong one when funding or debugging is a real mistake to make. `name` is what the
// console shows; `refId` is a stable machine key for our own tooling.
export type WalletLabel = { name: string; refId: string };

export async function createWallet(
  walletSetId: string,
  label?: WalletLabel,
): Promise<{ id: string; address: Address }> {
  const res = await circleClient.createWallets({
    walletSetId,
    blockchains: [BLOCKCHAIN] as never,
    count: 1,
    accountType: "EOA",
    ...(label ? { metadata: [{ name: label.name, refId: label.refId }] } : {}),
  });
  const w = res.data?.wallets?.[0];
  if (!w?.id || !w?.address) throw new Error("failed to create wallet");
  return { id: w.id, address: w.address as Address };
}

/** Label a wallet that already exists. Circle allows this after the fact, which is the
 *  only way to fix the ones minted before labelling was wired in. */
export async function renameWallet(walletId: string, label: WalletLabel): Promise<void> {
  await circleClient.updateWallet({ id: walletId, name: label.name, refId: label.refId });
}

/** One convention, used everywhere, so the console sorts by role and reads at a glance.
 *  The leading capital is forced because judges are stored lowercase in the roster and
 *  "Judge alpha" sitting next to "Startup MeshRelay" looks like a bug. */
export function labelFor(role: "Judge" | "Startup" | "Customer", name: string): WalletLabel {
  const display = name.charAt(0).toUpperCase() + name.slice(1);
  return { name: `${role} ${display}`, refId: `${role.toLowerCase()}:${name.toLowerCase()}` };
}

const TERMINAL = ["COMPLETE", "FAILED", "DENIED", "CANCELLED"];

// Execute a contract call from a Circle wallet and wait for it to land onchain. Circle
// signing is async: we submit, then poll to a terminal state and return the tx hash so
// callers can read receipts/events with viem exactly as before. Throws if it does not
// complete. Integer args should be passed as strings.
export async function circleExecute(
  walletId: string,
  contractAddress: Address,
  abiFunctionSignature: string,
  abiParameters: unknown[],
): Promise<Hex> {
  const tx = await circleClient.createContractExecutionTransaction({
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters: abiParameters as never,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as never);

  const id = (tx.data as { id?: string })?.id;
  if (!id) throw new Error("Circle returned no transaction id");

  let state = (tx.data as { state?: string })?.state ?? "";
  let txHash: string | undefined;
  for (let i = 0; i < 40 && !TERMINAL.includes(state); i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const r = await circleClient.getTransaction({ id });
    const t = r.data?.transaction as { state?: string; txHash?: string } | undefined;
    state = t?.state ?? state;
    txHash = t?.txHash ?? txHash;
  }

  if (state !== "COMPLETE") throw new Error(`Circle tx ${id} ended in state ${state}`);
  if (!txHash) throw new Error(`Circle tx ${id} completed without a tx hash`);
  return txHash as Hex;
}
