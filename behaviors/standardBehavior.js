/**
 * behaviors/standardBehavior.js
 * 
 * Standard strategy behavior for agent-based execution
 * Simple buy/sell alternation with randomized amounts
 */

/**
 * Decide next action for the agent
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    // Use agent's entropy engine for all randomness
    const entropy = agent.entropy;
    
    // Get current token balance
    const tokenBalance = await agent._getTokenBalance();
    
    // Decide buy or sell based on holdings
    let shouldBuy;
    if (tokenBalance === 0) {
        shouldBuy = true; // Must buy if no tokens
    } else if (tokenBalance > 0.1) {
        shouldBuy = entropy.getRandomBoolean(0.3); // 30% chance to buy if high balance
    } else {
        shouldBuy = entropy.getRandomBoolean(0.6); // 60% chance to buy if low balance
    }
    
    if (shouldBuy) {
        // Calculate buy amount with jitter
        const baseAmount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        const jitterMultiplier = 1 + (entropy.getRandomFloat(-agent.jitterPercentage, agent.jitterPercentage) / 100);
        const amount = parseFloat((baseAmount * jitterMultiplier).toFixed(6));
        
        return { type: 'BUY', amount };
    } else {
        // Sell a random portion of holdings
        if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.1, 0.5);
            const amount = tokenBalance * sellPortion;
            
            return { type: 'SELL', amount };
        }
    }
    
    return { type: 'WAIT' };
}

export default { decideAction };
