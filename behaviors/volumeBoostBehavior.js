/**
 * behaviors/volumeBoostBehavior.js
 * 
 * Volume Boost strategy behavior - maximizes trading volume
 * High frequency trading to boost volume metrics
 */

/**
 * Decide next action for volume boost strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize volume state
    if (!agent.volumeInitialized) {
        agent.volumeInitialized = true;
        agent.volumeTrades = 0;
        agent.volumeLastAction = null;
        agent.volumeTargetRatio = entropy.getRandomFloat(0.4, 0.6); // Buy/sell ratio
        
        agent.logger.info(`[VolumeBoost] Target buy ratio: ${(agent.volumeTargetRatio * 100).toFixed(0)}%`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    // Almost always trade (95% chance)
    const shouldTrade = entropy.getRandomBoolean(0.95);
    
    if (!shouldTrade) {
        return { type: 'WAIT' };
    }
    
    // Determine action based on ratio
    const buyThreshold = agent.volumeTargetRatio;
    const shouldBuy = entropy.getRandomFloat(0, 1) < buyThreshold;
    
    // Calculate volume-optimized amount
    const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
    
    agent.volumeTrades++;
    agent.volumeLastAction = shouldBuy ? 'BUY' : 'SELL';
    
    if (shouldBuy) {
        return { type: 'BUY', amount };
    } else {
        if (tokenBalance > 0) {
            // Sell portion
            const sellPortion = entropy.getRandomFloat(0.3, 0.6);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        } else {
            // Must buy
            return { type: 'BUY', amount };
        }
    }
}

export default { decideAction };
