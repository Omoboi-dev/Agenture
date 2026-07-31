import data from '@shared/addresses.json'

// The single source of truth, shared with the agents and contracts.
export const addresses = data

export type JudgeConfig = (typeof data.agenture.judges)[number]
