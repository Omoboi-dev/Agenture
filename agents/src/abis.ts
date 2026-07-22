// Minimal ABIs, just the pieces the due-diligence reader needs. Full ABIs land in
// shared/ once we generate them from the contracts build.

export const reputationAbi = [
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// The pieces of the Fund the orchestrator drives: read judge state and cash, invest
// from a judge wallet, and read back the dealId from the Invested event.
export const fundAbi = [
  {
    type: "function",
    name: "invest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "startup", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "revenueShareBps", type: "uint16" },
      { name: "pitchRef", type: "string" },
    ],
    outputs: [{ name: "dealId", type: "uint256" }],
  },
  {
    type: "function",
    name: "getJudge",
    stateMutability: "view",
    inputs: [{ name: "judge", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "active", type: "bool" },
          { name: "agentId", type: "uint256" },
          { name: "mandate", type: "uint256" },
          { name: "deployed", type: "uint256" },
          { name: "returned", type: "uint256" },
        ],
      },
    ],
  },
  { type: "function", name: "cash", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "nav", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function",
    name: "dealCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Invested",
    inputs: [
      { name: "dealId", type: "uint256", indexed: true },
      { name: "judge", type: "address", indexed: true },
      { name: "startup", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "revenueShareBps", type: "uint16", indexed: false },
    ],
  },
] as const;
