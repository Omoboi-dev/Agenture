# What Agenture is
Agenture is an autonomous venture fund that runs on Arc, where AI agents invest in other AI agents. A panel of AI "judge" agents, each with its own investment thesis and onchain reputation, hears pitches from up-and-coming "startup" agents. The judges run due diligence on each startup's verifiable onchain track record, then vote and deploy USDC to the ones they back. Funded startup agents run real services, earn USDC, and stream a share of revenue back to the fund. Reputation compounds for judges who pick winners and startups who deliver. The whole loop runs agent-to-agent, settled in USDC, with no human in the loop. Humans can only deposit or withdraw capital at the edges as LPs; they never touch a decision or a transaction.

Think Shark Tank, run by AI, settled onchain in real stablecoin.

# The hackathon
Encode x Arc "Programmable Money Hackathon." Online. Track: Agentic Economy ("autonomous AI agents that hold wallets and pay, settle and transact in USDC without a human in the loop"). Key dates: Checkpoint 2 (progress) ~Jul 26, Checkpoint 3 (final submission) Aug 9, Demo Day Aug 20. Final submission needs: a functional MVP deployed on Arc, a public repo, a 3-minute video plus demo, and a deck.

The track rewards: agents with decision logic tied to REAL onchain signals (not hardcoded rules), autonomous USDC settlement, meaningful use of Agent Stack, App Kits, Circle Wallets, Nanopayments and Paymaster.

# Arc facts (testnet only)
- Chain ID: 5042002 (hex 0x4CEF52)
- RPC: https://rpc.testnet.arc.network
- USDC (native gas token AND ERC-20): 0x3600000000000000000000000000000000000000 (native view 18 decimals, ERC-20 view 6 decimals, same pool, never double-count)
- Faucet: https://faucet.circle.com (testnet USDC and EURC)
- Explorer: https://testnet.arcscan.app
- Standard EVM tooling works: Foundry, Hardhat, viem, wagmi
VERIFY all addresses below against https://docs.arc.io before relying on them; they were read from docs and may have changed.
- ERC-8004 IdentityRegistry: 0x8004A818BFB912233c491871b3d84c89A494BD9e
- ERC-8004 ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
- ERC-8004 ValidationRegistry: 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
- ERC-8183 Job (escrow): 0x0747EEf0706327138c69792bF28Cd525089e4583

# Stack
- Contracts: Foundry (Solidity), deployed to Arc testnet
- Agents: TypeScript, forked from circlefin/agent-stack-starter-kits (use the kits/claude-agent-sdk kit). This satisfies the mandatory Agent Stack requirement.
- Onchain reads/writes: viem
- Frontend: React + Vite + wagmi/viem
- Use Circle's official Claude Code skills where helpful: use-arc, use-gateway (from circlefin/skills)

# Architecture (four parts)
1. Contracts we write, on top of the deployed ERC-8004 and ERC-8183:
   - Fund.sol: the capital pool. Holds USDC, tracks NAV and positions, releases capital when the panel approves.
   - Deal.sol: one investment (startup, amount, revenue-share terms in bps, status).
   - RevenueShare.sol: funded startups' earnings flow through here; the fund's cut streams back automatically.
2. Agents (TypeScript, on the Agent Stack kit):
   - Judge agents: each has a distinct thesis in its system prompt. Input = a pitch plus the startup's real onchain data. Output = a STRUCTURED decision (JSON: vote, amount, revenueShareBps, rationale). Never free text.
   - Startup agents: generate a pitch and run a simple service that actually earns USDC.
   - Orchestrator: runs an autonomous round end to end: collect pitches, dispatch to judges, tally votes, execute the funding transaction, advance the earning period, route returns, update reputation. No human in the loop.
3. Due-diligence module: a viem reader that pulls each startup's ERC-8004 reputation, ERC-8183 job history, and revenue, and feeds it to the judges as the real signals the track demands.
4. Frontend: an Arena (live pitch, judge verdicts, funding animation), a Fund dashboard (positions, NAV, returns streaming live), leaderboards, and an LP deposit panel at the edge.

# How startups earn
Startup agents run a simple but REAL service that other agents or users pay for via Nanopayments / x402. Revenue routes through RevenueShare so the fund's cut comes back automatically. For the demo, support a time-compression / simulation mode so a "quarter" of earnings plays out in minutes on real rails. Be transparent that the clock is sped up.

# Build principle
Spine first, then removable layers. Never leave the spine half-done to add features. A finished, complete loop beats a sprawling broken one.

THE SPINE (must work end to end):
A startup agent registers, submits a pitch, the judges pull its real onchain reputation, deliberate, vote and set terms, the Fund releases real USDC into a RevenueShare deal, the startup runs a service and earns real USDC, and returns stream back to the Fund while reputations update, all shown live in the React arena.

Packable layers (add in this order, drop any without breaking the spine): 3 then 5 judges with distinct theses; live judge counter-offers / negotiation; human LP deposits; leaderboards (judges by ROI, startups by performance); provable P&L panel (revenue minus real USDC gas); StableFX multi-currency payouts (USDC/EURC); autonomous rounds on a schedule; a secondary market for positions.

# The five spikes to run FIRST (de-risk before building)
1. Deploy a contract to Arc with USDC gas (faucet + forge deploy).
2. ERC-8004: register an agent, write and read a reputation score, work out the validator flow.
3. ERC-8183: run a job through create -> fund -> submit -> complete.
4. Nanopayments/x402: get one sub-cent payment working, and confirm whether it settles Arc-native or via Circle Gateway. This is the biggest unknown.
5. Agent Stack kit: get it running with a Circle Wallet on Arc.

# Repo layout
agenture/
  contracts/   (Foundry: Fund, Deal, RevenueShare, tests, deploy scripts)
  agents/      (TS: judges, startups, orchestrator, due-diligence, Agent Stack integration)
  web/         (React + Vite frontend)
  shared/      (ABIs, addresses, types)

# Phases
Phase 0 (now -> ~Jul 22): scaffold repo, deploy hello-world to Arc, run one agent with a wallet, complete the five spikes.
Phase 1 (Jul 23 -> Jul 26, CP2): minimal Fund/Deal/RevenueShare, one judge reasoning over real reputation, orchestrator moving real USDC end to end, rough frontend. This is the CP2 submission.
Phase 2 (Jul 27 -> Aug 3): full spine, 3 then 5 judges, real startup earning via x402, streaming returns, reputation updates, Arena comes alive, autonomous round loop.
Phase 3 (Aug 4 -> Aug 9, CP3): pack layers, demo/simulation mode, 3-min video, deck, final submission.
Phase 4 (Aug 10 -> Aug 20): rehearse and polish for Demo Day.

# Start here
Begin with Phase 0. First scaffold the repo, then run spike 1 (deploy a hello-world contract to Arc) to confirm the toolchain end to end. Tell me what you find at each spike before moving on.
