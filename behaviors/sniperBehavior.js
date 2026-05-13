/**
 * behaviors/sniperBehavior.js
 *
 * Sniper strategy behavior - precise entry/exit
 * Waits for optimal moments then executes large trades
 *
 * FIXES APPLIED:
 *   handleSniping compared `tokenBalance` (token count, e.g. 500,000)
 *   against `sniperTargetAmount` (SOL, e.g. 0.25). The condition
 *   `tokenBalance < sniperTargetAmount * 0.5` was almost always true,
 *   so the snipe loop ran forever and never transitioned to EXITING.
 *
 *   Fix: track `agent.sniperSOLSpent` — the actual SOL spent this snipe
 *   cycle. Compare that against `sniperTargetAmount` (both in SOL).
 *   Reset `sniperSOLSpent` to 0 on each new cycle.
 */

const PHASES = {
    WAITING:  'waiting',
    SNIPING:  'sniping',
    EXITING:  'exiting'
};

/**
 * Decide next action for sniper strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;

    // Initialize sniper state
    if (!agent.sniperInitialized) {
        agent.sniperInitialized = true;
        agent.sniperPhase       = PHASES.WAITING;
        agent.sniperTrades      = 0;
        agent.sniperWaitTime    = entropy.getRandomInt(5000, 20000);
        agent.sniperStartTime   = Date.now();
        agent.sniperSOLSpent    = 0; // FIX: track SOL spent, not token balance

        agent.logger.info(`[Sniper] Starting in ${agent.sniperPhase} phase`);
    }

    const tokenBalance = await agent._getTokenBalance();
    const elapsed      = Date.now() - agent.sniperStartTime;

    switch (agent.sniperPhase) {
        case PHASES.WAITING:
            return handleWaiting(agent, entropy, tokenBalance, elapsed);
        case PHASES.SNIPING:
            return handleSniping(agent, entropy, tokenBalance);
        case PHASES.EXITING:
            return handleExiting(agent, entropy, tokenBalance);
        default:
            return { type: 'WAIT' };
    }
}

function handleWaiting(agent, entropy, tokenBalance, elapsed) {
    if (elapsed >= agent.sniperWaitTime) {
        agent.sniperPhase        = PHASES.SNIPING;
        agent.sniperTargetAmount = entropy.getRandomFloat(
            agent.maxBuyAmount * 2,
            agent.maxBuyAmount * 5
        ); // target SOL to spend
        agent.sniperSOLSpent = 0; // reset for new snipe cycle

        agent.logger.info(`[Sniper] Sniping — target: ${agent.sniperTargetAmount.toFixed(6)} SOL`);
    }

    // Small test trades while waiting
    if (entropy.getRandomBoolean(0.1)) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.minBuyAmount * 1.5);
        agent.sniperTrades++;
        return { type: 'BUY', amount };
    }

    return { type: 'WAIT' };
}

function handleSniping(agent, entropy, tokenBalance) {
    // FIX: compare SOL spent (same units as sniperTargetAmount)
    // Old code: tokenBalance < sniperTargetAmount * 0.5
    //   — token count vs SOL amount → almost always true → infinite loop
    if (agent.sniperSOLSpent >= agent.sniperTargetAmount * 0.8) {
        // Spent enough SOL — transition to exit
        agent.sniperPhase     = PHASES.EXITING;
        agent.sniperExitWait  = entropy.getRandomInt(3000, 10000);
        agent.sniperExitStart = Date.now();

        agent.logger.info(
            `[Sniper] Snipe complete (${agent.sniperSOLSpent.toFixed(4)} SOL spent), preparing exit`
        );
        return { type: 'WAIT' };
    }

    // Buy aggressively toward target
    const remaining = agent.sniperTargetAmount - agent.sniperSOLSpent;
    const amount    = parseFloat(Math.min(
        entropy.getRandomFloat(agent.maxBuyAmount * 1.5, agent.maxBuyAmount * 3),
        remaining
    ).toFixed(6));

    agent.sniperSOLSpent += amount; // FIX: accumulate SOL spent
    agent.sniperTrades++;

    return { type: 'BUY', amount };
}

function handleExiting(agent, entropy, tokenBalance) {
    const exitElapsed = Date.now() - agent.sniperExitStart;

    if (exitElapsed < agent.sniperExitWait) {
        return { type: 'WAIT' };
    }

    if (tokenBalance > 0.01) {
        const amount = tokenBalance; // sell everything

        agent.sniperTrades++;

        // Reset full cycle
        agent.sniperPhase     = PHASES.WAITING;
        agent.sniperWaitTime  = entropy.getRandomInt(5000, 20000);
        agent.sniperStartTime = Date.now();
        agent.sniperSOLSpent  = 0; // FIX: reset SOL tracker for next cycle

        agent.logger.info(`[Sniper] Exit complete, waiting for next opportunity`);

        return { type: 'SELL', amount };
    }

    return { type: 'WAIT' };
}

export default { decideAction, PHASES };
