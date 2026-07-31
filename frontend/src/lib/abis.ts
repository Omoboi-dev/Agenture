// Read-only ABIs the dashboard needs.
export const fundAbi = [
  { type: 'function', name: 'cash', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nav', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalCapital', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalDeployed', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalReturned', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalOutstanding', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'dealCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'getDeal',
    stateMutability: 'view',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'judge', type: 'address' },
          { name: 'startup', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'revenueShareBps', type: 'uint16' },
          { name: 'returned', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'pitchRef', type: 'string' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getJudge',
    stateMutability: 'view',
    inputs: [{ name: 'judge', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'active', type: 'bool' },
          { name: 'agentId', type: 'uint256' },
          { name: 'mandate', type: 'uint256' },
          { name: 'deployed', type: 'uint256' },
          { name: 'returned', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'judgeRoiBps',
    stateMutability: 'view',
    inputs: [{ name: 'judge', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const reputationAbi = [
  {
    type: 'function',
    name: 'getSummary',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
      { name: 'summaryValueDecimals', type: 'uint8' },
    ],
  },
] as const

export const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const
