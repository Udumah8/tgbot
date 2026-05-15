/**
 * behaviors/holderGrowthBehavior.js
 *
 * Holder Growth strategy behavior - accumulate and hold
 * Slowly accumulates tokens and holds for long periods
 *
 * FIXES APPLIED (v1):
 *   1. holderTargetHoldings changed from float SOL balance (maxBuyAmount * 5-20)
 *      to integer trade count (8-25 trades). The old check used `amount * 1000`
 *      as a fake token estimate which always exceeded the target on the very
 *      first trade, sending every agent to HOLDING after one buy.
 *   2. handleAccumulating: replaced broken projectedHoldings check with
 *      agent.holderTrades >= agent.holderTargetHoldings (trade count).
 *   3. handleDistributing reset: replaced broken token balance comparison
 *      with holderTrades > holderTargetHoldings * 3, and resets holderTrades.
 *
 * FIXES APPLIED (v2 - Deep Audit):
 *   4. Added error handling and input validation to prevent crashes
 *   5. Fixed distribution phase getting stuck when no tokens available
 *   6. Fixed holding phase infinite loop with max hold time and progressive exit probability
 *   7. Fixed trade counter not incrementing during holding phase buys
 *   8. Fixed distribution logic to use reasonable trade counts and token balance checks
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
    try {
        // FIX 4: Validate agent properties
        if (!agent.entropy) {
            throw new Error('[HolderGrowth] Agent missing entropy engine');
        }
        if (!agent.logger) {
            throw new Error('[HolderGrowth] Agent missing logger');
        }
        if (typeof agent.minBuyAmount !== 'number' || typeof agent.maxBuyAmount !== 'number') {
            throw new Error('[HolderGrowth] Agent missing minBuyAmount or maxBuyAmount');
        }

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
    } catch (error) {
        // FIX 4: Log error and return WAIT to prevent crash
        if (agent.logger) {
            agent.logger.error(`[HolderGrowth] Error in decideAction: ${error.message}`);
        } else {
            console.error(`[HolderGrowth] Error in decideAction: ${error.message}`);
        }
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

    // FIX 6: Add maximum hold time on first entry to holding phase
    if (!agent.holderMaxHoldTime) {
        agent.holderMaxHoldTime = entropy.getRandomInt(120000, 300000); // 2-5 min max
    }

    // Check if minimum hold time passed
    if (holdTime >= agent.holderMinHoldTime) {
        // FIX 6: Increase probability over time, force exit at max time
        const timeProgress = Math.min(holdTime / agent.holderMaxHoldTime, 1.0);
        const exitProbability = 0.2 + (timeProgress * 0.6); // 20% → 80% over time
        
        if (holdTime >= agent.holderMaxHoldTime || entropy.getRandomBoolean(exitProbability)) {
            agent.holderPhase = PHASES.DISTRIBUTING;
            agent.holderMaxHoldTime = undefined; // Reset for next cycle
            agent.logger.info(
                `[HolderGrowth] Starting distribution (held for ${(holdTime/1000).toFixed(1)}s)`
            );
        }
    }

    // Very small chance to add more during hold
    if (entropy.getRandomBoolean(0.05)) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.minBuyAmount * 2);
        agent.holderTrades++; // FIX 7: Track all trades consistently
        agent.logger.debug(
            `[HolderGrowth] Adding to position during hold (trade #${agent.holderTrades})`
        );
        return { type: 'BUY', amount };
    }

    return { type: 'WAIT' };
}

function handleDistributing(agent, entropy, tokenBalance) {
    if (tokenBalance > 0.01) {
        const sellPortion = entropy.getRandomFloat(0.1, 0.25);
        const amount      = tokenBalance * sellPortion;

        agent.holderTrades++;

        // FIX 8: Reset based on tokens remaining OR reasonable trade count
        // Track distribution trades separately from accumulation trades
        if (!agent.holderDistributionStart) {
            agent.holderDistributionStart = agent.holderTrades;
            agent.holderMaxDistributionTrades = entropy.getRandomInt(5, 12);
        }

        const distributionTrades = agent.holderTrades - agent.holderDistributionStart;
        const remainingAfterSell = tokenBalance * (1 - sellPortion);
        
        // Exit distribution if: almost no tokens left OR reached max distribution trades
        if (remainingAfterSell < 0.02 || distributionTrades >= agent.holderMaxDistributionTrades) {
            agent.holderPhase          = PHASES.ACCUMULATING;
            agent.holderTargetHoldings = entropy.getRandomInt(8, 25); // new trade-count target
            agent.holderTrades         = 0;                            // reset counter
            agent.holderDistributionStart = undefined;                 // reset distribution tracking
            agent.logger.info(
                `[HolderGrowth] Distribution complete (${distributionTrades} trades, ` +
                `${remainingAfterSell.toFixed(4)} tokens remaining)`
            );
        }

        return { type: 'SELL', amount };
    }

    // FIX 5: Reset to accumulating if no tokens to distribute
    agent.logger.warn(`[HolderGrowth] No tokens to distribute, resetting to accumulation`);
    agent.holderPhase          = PHASES.ACCUMULATING;
    agent.holderTargetHoldings = entropy.getRandomInt(8, 25);
    agent.holderTrades         = 0;
    agent.holderDistributionStart = undefined;
    return { type: 'WAIT' };
}

export default { decideAction, PHASES };
