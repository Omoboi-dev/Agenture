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
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ERC-8004 IdentityRegistry: register(uri) mints a fresh agentId to the caller.
export const identityAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "uri", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
] as const;

// ERC-8004 ReputationRegistry write side: a client (a judge) rates an agent (a startup).
export const reputationWriteAbi = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "decimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "uri", type: "string" },
      { name: "hash", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

// Agenture RevenueShare: the startup reports revenue and pays the fund's cut.
export const revenueShareAbi = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dealId", type: "uint256" },
      { name: "revenueAmount", type: "uint256" },
    ],
    outputs: [],
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
    type: "function",
    name: "getDeal",
    stateMutability: "view",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "judge", type: "address" },
          { name: "startup", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "revenueShareBps", type: "uint16" },
          { name: "returned", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "pitchRef", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "depositCapital",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "registerJudge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "judge", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "mandate", type: "uint256" },
    ],
    outputs: [],
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
