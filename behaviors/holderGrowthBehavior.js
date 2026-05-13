/**
 * behaviors/holderGrowthBehavior.js
 *
 * Holder Growth strategy behavior - accumulate and hold
 * Slowly accumulates tokens and holds for long periods
 *
 * FIXES APPLIED:
 *   1. holderTargetHoldings changed from float SOL balance (maxBuyAmount * 5-20)
 *      to integer trade count (8-25 trades). The old check used `amount * 1000`
 *      as a fake token estimate which always exceeded the target on the very
 *      first trade, sending every agent to HOLDING after one buy.
 *   2. handleAccumulating: replaced broken projectedHoldings check with
 *      agent.holderTrades >= agent.holderTargetHoldings (trade count).
 *   3. handleDistributing reset: replaced broken token balance comparison
 *      with holderTrades > holderTargetHoldings * 3, and resets holderTrades.
 */

const PHASES = {
    ACCUMULATING: 'accumulating',
    HOLDING:      'holding',
    DISTRIBUTING: 'distributing'
};

/**
 * Decide next action for holder growth strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;

    // Initialize holder state
    if (!agent.holderInitialized) {
        agent.holderInitialized = true;
        agent.holderPhase      = PHASES.ACCUMULATING;
        agent.holderTrades     = 0;

        // FIX 1: target is now a trade COUNT (8-25), not a broken SOL balance estimate
        agent.holderTargetHoldings = entropy.getRandomInt(8, 25);

        agent.logger.info(`[HolderGrowth] Target: ${agent.holderTargetHoldings} accumulation trades`);
    }

    const tokenBalance = await agent._getTokenBalance();

    switch (agent.holderPhase) {
        case PHASES.ACCUMULATING:
            return handleAccumulating(agent, entropy, tokenBalance);
        case PHASES.HOLDING:
            return handleHolding(agent, entropy, tokenBalance);
        case PHASES.DISTRIBUTING:
            return handleDistributing(agent, entropy, tokenBalance);
        default:
            return { type: 'WAIT' };
    }
}

function handleAccumulating(agent, entropy, tokenBalance) {
    // Buy to accumulate
    const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);

    agent.holderTrades++;

    // FIX 2: check trade count, not broken `tokenBalance + amount * 1000` estimate
    if (agent.holderTrades >= agent.holderTargetHoldings) {
        agent.holderPhase       = PHASES.HOLDING;
        agent.holderHoldStart   = Date.now();
        agent.holderMinHoldTime = entropy.getRandomInt(30000, 120000); // 30s–2min

        agent.logger.info(`[HolderGrowth] Accumulated ${agent.holderTrades} trades, starting hold phase`);
    }

    return { type: 'BUY', amount };
}

function handleHolding(agent, entropy, tokenBalance) {
    const holdTime = Date.now() - agent.holderHoldStart;

    // Check if minimum hold time passed
    if (holdTime >= agent.holderMinHoldTime) {
        if (entropy.getRandomBoolean(0.2)) {
            agent.holderPhase = PHASES.DISTRIBUTING;
            agent.logger.info(`[HolderGrowth] Starting distribution`);
        }
    }

    // Very small chance to add more during hold
    if (entropy.getRandomBoolean(0.05)) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.minBuyAmount * 2);
        return { type: 'BUY', amount };
    }

    return { type: 'WAIT' };
}

function handleDistributing(agent, entropy, tokenBalance) {
    if (tokenBalance > 0.01) {
        const sellPortion = entropy.getRandomFloat(0.1, 0.25);
        const amount      = tokenBalance * sellPortion;

        agent.holderTrades++;

        // FIX 3: was `tokenBalance < holderTargetHoldings * 0.2` — a float SOL
        // balance compared against a trade count, always false or always true.
        // Now: reset after enough distribution trades.
        if (agent.holderTrades > agent.holderTargetHoldings * 3) {
            agent.holderPhase          = PHASES.ACCUMULATING;
            agent.holderTargetHoldings = entropy.getRandomInt(8, 25); // new trade-count target
            agent.holderTrades         = 0;                            // reset counter
            agent.logger.info(`[HolderGrowth] Distribution complete, new target set`);
        }

        return { type: 'SELL', amount };
    }

    return { type: 'WAIT' };
}

export default { decideAction, PHASES };
