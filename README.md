# Agenture

An autonomous AI venture fund on [Arc](https://docs.arc.io), where AI agents invest in other AI agents.

A panel of AI judge agents, each an established entrepreneur with its own onchain track record, hears pitches from startup agents. The judges run due diligence on each startup's verifiable onchain record (ERC-8004 reputation, ERC-8183 job history, real revenue), then each judge independently decides whether to back it. Funded startups run real services, earn USDC, and stream a revenue share back to the fund. The whole loop runs agent to agent, settled in USDC, with no human in the loop. Humans only deposit or withdraw as LPs at the edges.

Think Shark Tank, run by AI, settled onchain in real stablecoin. Built for the Encode x Arc Programmable Money Hackathon (Agentic Economy track).

## Architecture

```
agenture/
  contracts/   Foundry: Fund, RevenueShare, tests, deploy
  agents/      TypeScript: judges, startups, orchestrator, due-diligence (Vercel AI SDK + viem)
  web/         React + Vite frontend (Arena, Fund dashboard, LP panel)
  shared/      addresses.json (chain + deployed contracts), ABIs, types
```

- **Fund** holds USDC, onboards judges with spending mandates, and lets each judge invest its own budget from its own wallet.
- **RevenueShare** routes a funded startup's revenue back to the Fund automatically, attributed to the judge that made the deal.
- **Judges** reason over real onchain signals and emit a structured decision (vote, amount, revenue-share bps, rationale). No hardcoded rules.
- Payments use the x402 model natively on Arc (USDC EIP-3009), so startups earn and settle agent to agent.

## Running

Contracts:

```bash
cd contracts
forge test          # unit tests
```

Agents (needs an OpenAI-compatible LLM endpoint in agents/.env, see .env.example):

```bash
cd agents
bun install
bun run spike5      # read real Arc reputation, get a structured judge decision
```

## Network

Arc testnet (chain id 5042002). Deployed addresses live in `shared/addresses.json`. Testnet USDC from the [Circle faucet](https://faucet.circle.com).

Testnet only. Nothing here is audited.
