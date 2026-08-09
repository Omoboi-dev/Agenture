import type { Address } from "viem";
import { parseUnits } from "viem";
import roster from "../../shared/customers.json" with { type: "json" };

// The buying side. A customer agent is not part of the fund: it holds its own Circle
// wallet, spends its own USDC, and owes the judges nothing. It is here because a venture
// fund without customers is only a scoring exercise, and because the rating a buyer
// leaves after paying is the one reputation signal in this system with no conflict of
// interest behind it.
//
// A customer decides with a policy rather than a language model. That is not a downgrade:
// it holds its own keys, nobody tells it what to buy, and its choices depend on a private
// history no other agent can read. What it will never do is surprise you, which is the
// price of a market that keeps running when the model is rate limited.

export type Weights = {
  experience: number; // how much its own past satisfaction counts
  reputation: number; // how much the public ERC-8004 score counts
  price: number; // how much being cheap counts
};

export type Customer = {
  name: string;
  role: string;
  budgetUsdc: number;
  weights: Weights;
  /** Chance per run of spending a slot on a seller it has never tried. Without this the
   *  first agent to win a customer keeps it forever and no newcomer can break in. */
  explore: number;
  wallet: Address | null;
  walletId: string | null;
  agentId: bigint | null;
};

export const customers: Customer[] = roster.customers.map((c) => ({
  name: c.name,
  role: c.role,
  budgetUsdc: c.budgetUsdc,
  weights: c.weights,
  explore: c.explore,
  wallet: (c.wallet as Address | null) ?? null,
  walletId: c.walletId ?? null,
  agentId: c.agentId === null || c.agentId === undefined ? null : BigInt(c.agentId),
}));

/** A customer that has a wallet and can therefore actually transact. */
export type LiveCustomer = Customer & { wallet: Address; walletId: string };

export function liveCustomers(): LiveCustomer[] {
  return customers.filter((c): c is LiveCustomer => Boolean(c.wallet && c.walletId));
}

export function budgetOf(c: Customer): bigint {
  return parseUnits(c.budgetUsdc.toFixed(6), 6);
}

export function findCustomerByWallet(wallet: string): Customer | undefined {
  const w = wallet.toLowerCase();
  return customers.find((c) => c.wallet?.toLowerCase() === w);
}
