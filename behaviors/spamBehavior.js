/**
 * behaviors/spamBehavior.js
 * 
 * Spam strategy behavior - high frequency micro transactions
 * Creates many small transactions for volume generation
 */

/**
 * Decide next action for spam strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    const tokenBalance = await agent._getTokenBalance();
    
    // Initialize spam state
    if (!agent.spamInitialized) {
        agent.spamInitialized = true;
        agent.spamTrades = 0;
        agent.spamLastAction = null; // 'buy' or 'sell'
        agent.spamBuyRatio = entropy.getRandomFloat(0.4, 0.7); // 40-70% buys
        
        agent.logger.info(`[Spam] Starting with ${(agent.spamBuyRatio * 100).toFixed(0)}% buy ratio`);
    }
    
    // Very high frequency - almost always trade
    const shouldTrade = entropy.getRandomBoolean(0.9); // 90% chance to trade
    
    if (!shouldTrade) {
        return { type: 'WAIT' };
    }
    
    // Determine action based on buy ratio
    const shouldBuy = entropy.getRandomFloat(0, 1) < agent.spamBuyRatio;
    
    // Micro amount (very small)
    const microAmount = entropy.getRandomFloat(
        agent.minBuyAmount * 0.1, // 10% of min
        agent.minBuyAmount * 0.5  // 50% of min
    );
    
    agent.spamTrades++;
    agent.spamLastAction = shouldBuy ? 'buy' : 'sell';
    
    if (shouldBuy) {
        return { type: 'BUY', amount: microAmount };
    } else {
        // Sell some tokens
        if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.3, 0.7);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        } else {
            // Must buy if no tokens
            return { type: 'BUY', amount: microAmount };
        }
    }
}

export default { decideAction };
