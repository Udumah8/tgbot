/**
 * behaviors/jitoMEVBehavior.js
 *
 * High-Frequency Trading behavior — fast alternating buy/sell cycles
 * Simulates MEV bot activity patterns with high trade frequency.
 *
 * FIXES APPLIED:
 *   This file previously claimed to perform "Jito MEV bundling" but contained
 *   zero Jito-related code. No sendJitoBundle call, no bundle construction,
 *   no tip transaction. The variables `mevInBundle`, `mevFlashLoan`, and
 *   `mevBundleCount` were internal counters controlling trade sizing and
 *   frequency — unrelated to actual Jito infrastructure.
 *
 *   Fix: updated comments and logger labels to accurately describe what the
 *   behavior actually does (high-frequency buy/sell with burst mode and
 *   size multiplier). The trading logic itself is unchanged.
 *
 *   NOTE: Actual Jito bundle submission is controlled by STATE.useJito in
 *   volumebot.js and applies to ALL strategies independently of this module.
 *   Enabling STATE.useJito routes this behavior's trades through Jito bundles
 *   without any changes to this file.
 */

/**
 * Decide next action for high-frequency trading strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;

    // Initialize HFT state
    if (!agent.mevInitialized) {
        agent.mevInitialized = true;
        agent.mevTrades      = 0;
        agent.mevBundleCount = 0;
        agent.mevInBundle    = entropy.getRandomBoolean(0.4); // 40% start in burst mode
        agent.mevFlashLoan   = entropy.getRandomFloat(1.5, 3.0); // size multiplier

        agent.logger.info(
            `[HFT] ${agent.mevInBundle ? 'Burst' : 'Solo'} mode | ` +
            `${agent.mevFlashLoan.toFixed(1)}x size multiplier`
        );
    }

    const tokenBalance = await agent._getTokenBalance();

    // HFT bots have very high trade rate
    const shouldTrade = entropy.getRandomBoolean(0.8); // 80% trade rate
    if (!shouldTrade) {
        return { type: 'WAIT' };
    }

    if (agent.mevInBundle) {
        return handleBurst(agent, entropy, tokenBalance);
    } else {
        return handleSolo(agent, entropy, tokenBalance);
    }
}

/**
 * Burst mode — multiple rapid trades in sequence before pausing
 */
function handleBurst(agent, entropy, tokenBalance) {
    const amount = agent.maxBuyAmount * agent.mevFlashLoan * entropy.getRandomFloat(0.5, 1.0);

    agent.mevTrades++;
    agent.mevBundleCount++;

    // Chance to exit burst mode
    if (entropy.getRandomBoolean(0.2)) {
        agent.mevInBundle = false;
    }

    // End burst after 3-6 trades; sell accumulated position
    if (agent.mevBundleCount > entropy.getRandomInt(3, 6)) {
        agent.mevBundleCount = 0;

        if (tokenBalance > 0.01) {
            const sellPortion = entropy.getRandomFloat(0.6, 0.9);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        }
    }

    return { type: 'BUY', amount: parseFloat(amount.toFixed(6)) };
}

/**
 * Solo mode — standard alternating buy/sell at high frequency
 */
function handleSolo(agent, entropy, tokenBalance) {
    const shouldBuy = entropy.getRandomBoolean(0.6);

    if (shouldBuy) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);

        agent.mevTrades++;

        // Chance to enter burst mode
        if (entropy.getRandomBoolean(0.25)) {
            agent.mevInBundle    = true;
            agent.mevBundleCount = 0;
        }

        return { type: 'BUY', amount };
    } else {
        if (tokenBalance > 0.01) {
            const sellPortion = entropy.getRandomFloat(0.4, 0.7);

            agent.mevTrades++;

            // Reset size multiplier after sell
            agent.mevFlashLoan = entropy.getRandomFloat(1.5, 3.0);

            return { type: 'SELL', amount: tokenBalance * sellPortion };
        }

        // No tokens — buy instead
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    }
}

export default { decideAction };
