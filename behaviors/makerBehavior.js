/**
 * behaviors/makerBehavior.js
 *
 * Maker strategy behavior - liquidity provision
 * Places orders on both sides of the market
 *
 * FIXES APPLIED:
 *   makerSpread was computed (5–15%) and logged but never used anywhere.
 *   Since this bot uses market orders (no limit-order support on-chain),
 *   spread cannot be applied to price offsets directly.
 *   Fix: use spread to influence the bid/ask ratio — wider spread means
 *   a more conservative maker (fewer buys, more patient on the ask side).
 *
 *   Old: const shouldPlaceBid = entropy.getRandomFloat(0, 1) < agent.makerBidRatio;
 *   New: const shouldPlaceBid = entropy.getRandomFloat(0, 1) < spreadAdjustedRatio;
 *
 *   With makerSpread = 0.10 and makerBidRatio = 0.50:
 *   spreadAdjustedRatio = 0.50 × (1 − 0.10 × 0.5) = 0.475
 *   → slightly fewer buys when spread is wide (more conservative)
 */

const ORDER_SIDES = {
    BID: 'bid',
    ASK: 'ask'
};

/**
 * Decide next action for maker strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy      = agent.entropy;
    const tokenBalance = await agent._getTokenBalance();

    // Initialize maker state
    if (!agent.makerInitialized) {
        agent.makerInitialized = true;
        agent.makerTrades      = 0;
        agent.makerLastSide    = null;
        agent.makerSpread      = entropy.getRandomFloat(0.05, 0.15); // 5–15% spread
        agent.makerBidRatio    = entropy.getRandomFloat(0.45, 0.55); // balanced

        agent.logger.info(
            `[Maker] Starting — spread: ${(agent.makerSpread * 100).toFixed(0)}%, ` +
            `base bid ratio: ${(agent.makerBidRatio * 100).toFixed(0)}%`
        );
    }

    // FIX: apply spread to bid ratio — wider spread → more conservative (fewer buys)
    // Old: const shouldPlaceBid = entropy.getRandomFloat(0, 1) < agent.makerBidRatio;
    const spreadAdjustedRatio = agent.makerBidRatio * (1 - agent.makerSpread * 0.5);
    const shouldPlaceBid      = entropy.getRandomFloat(0, 1) < spreadAdjustedRatio;

    if (shouldPlaceBid) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);

        agent.makerTrades++;
        agent.makerLastSide = ORDER_SIDES.BID;

        return { type: 'BUY', amount };
    } else {
        if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.2, 0.4);
            const amount      = tokenBalance * sellPortion;

            agent.makerTrades++;
            agent.makerLastSide = ORDER_SIDES.ASK;

            return { type: 'SELL', amount };
        } else {
            // No tokens to sell — must buy first
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);

            agent.makerTrades++;
            agent.makerLastSide = ORDER_SIDES.BID;

            return { type: 'BUY', amount };
        }
    }
}

export default { decideAction, ORDER_SIDES };
