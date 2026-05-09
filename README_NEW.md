Here is a complete, production‑grade prompt that encapsulates everything needed to refactor the existing codebase into the distributed agent system. It references the files you provided, mandates the removal of Math.random, and ensures all strategies (single & multi) work with the new architecture.

---

🧠 MASTER PROMPT – SOLANA MULTI‑WALLET ENTROPY AGENT REFACTOR

You are a senior Solana trading systems engineer and distributed systems architect.

📁 Provided files

· volumebot.js – main bot, Telegram UI, 19 strategies, swap logic, RPC handling
· walletManager.js – persistent wallet pool + aging system
· batchEngine.js – batch executor (to be replaced)
· multiStrategyManager.js – runs multiple strategies simultaneously
· jito.js – Jito bundle sender
· seasoningEngine.js – wallet seasoning
· walletAging.js – wallet age tiers & metadata

🎯 OBJECTIVE

Refactor the entire system into a high‑entropy distributed agent system with these mandatory requirements:

---

1. PER‑WALLET ENTROPY ENGINE (NO Math.random)

Create entropyEngine.js with class EntropyEngine:

· Constructor: (walletPublicKey, timeBucketMs = 60000)
· Seed = sha256(walletPublicKey + timeBucket) → 32‑bit integer
· PRNG = mulberry32 or xorshift
· Methods (ONLY these, no Math.random):
  · getRandomFloat(min, max)
  · getRandomInt(min, max)
  · getPoissonDelay(lambda) – returns milliseconds
  · getNormalDistribution(mean, stdDev)
  · getWeightedChoice(options)

Strict rule: After refactor, Math.random must not appear anywhere in the bot’s trading logic, funding, delays, or decision making. All randomness must be routed through EntropyEngine per wallet (or per operation if a wallet is available).

---

2. WALLET AGENT SYSTEM (Replace All Batch Execution)

Create walletAgent.js with:

· Class WalletAgent
· Each agent runs its own infinite while‑loop (while (this.state === 'ACTIVE'))
· State machine: ACTIVE → DEGRADED → PAUSED → FAILED
· Transitions:
  · 3 consecutive failures → DEGRADED
  · 6 consecutive failures → PAUSED
· Post‑trade verification:
  · Buy → confirm token balance increased
  · Sell → confirm SOL balance increased
· Retry: exponential backoff for transient errors (max retries per wallet)
· Stuck detection: if no balance change after N cycles → pause wallet
· Agent uses its own EntropyEngine for all decisions (delay, amount, probability)
· Each agent has a stop() method for graceful shutdown

Rules:

· No batch loops
· No shared timers
· Each wallet = independent async process

---

3. FUNDING RANDOMIZATION (Replace batch funding)

Create fundManager.js:

· Class FundManager
· Method fundWallet(wallet):
  · Generate amount with variance (e.g., ±25% around base)
  · Random delay before transfer (200‑2000 ms)
  · Optionally use multi‑hop stealth (if configured)
· Method fundWallets(wallets, progressCb, checkRunning):
  · Funds each wallet independently (no batch equal amounts)
  · Respects concurrency limit
· No two wallets get the same amount in the same funding cycle

---

4. STRATEGY ADAPTER (Unify Single & Multi Strategy)

Create strategyAdapter.js:

· Takes a strategy configuration object and runs it using agents.
· Handles both wallet pool (persistent wallets) and ephemeral mode.
· Automatically maps 19 existing strategies (STANDARD, MAKER, CHART_PATTERN, WHALE, etc.) to agent behaviors.
· Creates one AgentExecutor per strategy that spawns WalletAgent for each wallet.
· Integrates with MultiStrategyManager: each strategy instance gets its own adapter and can be started/stopped independently.

Behavior injection:

· Keep the unique logic of each strategy (e.g., chart pattern buy amounts, whale dump chunks, etc.) by overriding the agent’s decideAction and executeBuy/executeSell with strategy‑specific code.
· Do not lose any existing functionality from the 19 strategies.

---

5. REFACTOR volumebot.js

· Remove all Math.random() and replace with EntropyEngine calls (where a wallet is available). For global functions like getDynamicSlippage without a wallet, pass a wallet or create a temporary entropy engine.
· Replace BatchSwapEngine.executeBatch calls with AgentExecutor (or directly StrategyAdapter).
· Keep the Telegram UI, config system, RPC fallback, and swap function untouched.
· Update startEngine to use the new StrategyAdapter.
· Update all 19 strategy functions to be wrappers that call the adapter with appropriate configuration.
· Keep STATE object but add flags for agent‑specific overrides.

---

6. MODIFY multiStrategyManager.js

· Replace internal batch execution with StrategyAdapter.
· Each strategy’s startStrategy should create a new adapter and run it.
· Ensure pause/resume/stop work by calling adapter.stop().
· Keep wallet isolation (each strategy gets its own subset of pool wallets).

---

7. DELIVERABLES (Full Production Code)

Generate complete, runnable files:

1. entropyEngine.js
2. walletAgent.js
3. fundManager.js
4. agentExecutor.js – runs multiple agents concurrently, handles stop signals
5. strategyAdapter.js
6. Updated volumebot.js (only the changed parts, or full file)
7. Updated multiStrategyManager.js (only changed parts)
8. A new folder behaviors/ containing one file per original strategy (e.g., standardBehavior.js, chartPatternBehavior.js, etc.) that exports the decision logic to be injected.

Include all necessary imports, error handling, logging, and graceful shutdown support.

Constraints:

· Do not break existing swap function (works with SolanaTracker / solana‑trade).
· Keep Jito integration intact.
· Keep Telegram UI and config persistence.
· The bot must compile and run without errors.

---

8. EXAMPLE OF CORRECT AGENT LOOP

```javascript
async function runWalletAgent(wallet) {
  const entropy = new EntropyEngine(wallet.publicKey.toBase58());
  while (this.state === 'ACTIVE') {
    const delay = entropy.getPoissonDelay(this.lambda);
    await sleep(delay);
    const action = this.decideAction(); // uses entropy
    const success = await this.executeTrade(action);
    if (!success) this.consecutiveFailures++;
    else this.consecutiveFailures = 0;
    if (this.consecutiveFailures >= 6) this.state = 'PAUSED';
  }
}
```

---

You now have all the context, constraints, and file references. Produce the final refactored code.


    integrate each behavors into the volumebot.js , make sure the bot run correctly and each strategy work correctly in both single and mult