/**
 * behaviors/makerBehavior.js
 * 
 * Maker strategy behavior - liquidity provision
 * Places limit orders on both sides of the order book
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
    const entropy = agent.entropy;
    const tokenBalance = await agent._getTokenBalance();
    
    // Initialize maker state
    if (!agent.makerInitialized) {
        agent.makerInitialized = true;
        agent.makerTrades = 0;
        agent.makerLastSide = null;
        agent.makerSpread = entropy.getRandomFloat(0.05, 0.15); // 5-15% spread
        agent.makerBidRatio = entropy.getRandomFloat(0.45, 0.55); // Balanced
        
        agent.logger.info(`[Maker] Starting with ${(agent.makerSpread * 100).toFixed(0)}% spread`);
    }
    
    // Maker strategy: balance between buys and sells
    const shouldPlaceBid = entropy.getRandomFloat(0, 1) < agent.makerBidRatio;
    
    if (shouldPlaceBid) {
        // Place bid (buy order)
        const amount = entropy.getRandomFloat(
            agent.minBuyAmount,
            agent.maxBuyAmount
        );
        
        agent.makerTrades++;
        agent.makerLastSide = ORDER_SIDES.BID;
        
        return { type: 'BUY', amount };
    } else {
        // Place ask (sell order)
        if (tokenBalance > 0) {
            // Sell portion of holdings
            const sellPortion = entropy.getRandomFloat(0.2, 0.4);
            const amount = tokenBalance * sellPortion;
            
            agent.makerTrades++;
            agent.makerLastSide = ORDER_SIDES.ASK;
            
            return { type: 'SELL', amount };
        } else {
            // Must buy first
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            agent.makerTrades++;
            agent.makerLastSide = ORDER_SIDES.BID;
            
            return { type: 'BUY', amount };
        }
    }
}

export default { decideAction, ORDER_SIDES };
