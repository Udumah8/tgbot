/**
 * behaviors/jitoMEVBehavior.js
 * 
 * Jito MEV Wash strategy behavior - Jito bundling simulation
 * Simulates MEV bot activity with fast, bundled transactions
 */

/**
 * Decide next action for Jito MEV wash strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize MEV state
    if (!agent.mevInitialized) {
        agent.mevInitialized = true;
        agent.mevTrades = 0;
        agent.mevBundleCount = 0;
        agent.mevInBundle = entropy.getRandomBoolean(0.4); // 40% in bundle mode
        agent.mevFlashLoan = entropy.getRandomFloat(1.5, 3.0); // Leverage
        
        agent.logger.info(`[JitoMEV] ${agent.mevInBundle ? 'Bundle' : 'Solo'} mode, ${agent.mevFlashLoan.toFixed(1)}x leverage`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    // MEV bots are very aggressive
    const shouldTrade = entropy.getRandomBoolean(0.8); // 80% trade rate
    
    if (!shouldTrade) {
        return { type: 'WAIT' };
    }
    
    // High frequency trading with leverage
    if (agent.mevInBundle) {
        return handleBundle(agent, entropy, tokenBalance);
    } else {
        return handleSolo(agent, entropy, tokenBalance);
    }
}

function handleBundle(agent, entropy, tokenBalance) {
    // Bundle mode - multiple quick trades
    const amount = agent.maxBuyAmount * agent.mevFlashLoan * entropy.getRandomFloat(0.5, 1.0);
    
    agent.mevTrades++;
    agent.mevBundleCount++;
    
    // Chance to exit bundle
    if (entropy.getRandomBoolean(0.2)) {
        agent.mevInBundle = false;
    }
    
    // Bundle ends periodically
    if (agent.mevBundleCount > entropy.getRandomInt(3, 6)) {
        agent.mevBundleCount = 0;
        
        // Sell accumulated
        if (tokenBalance > 0.01) {
            const sellPortion = entropy.getRandomFloat(0.6, 0.9);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        }
    }
    
    return { type: 'BUY', amount: parseFloat(amount.toFixed(6)) };
}

function handleSolo(agent, entropy, tokenBalance) {
    // Solo mode - regular trades
    const shouldBuy = entropy.getRandomBoolean(0.6);
    
    if (shouldBuy) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        
        agent.mevTrades++;
        
        // Chance to enter bundle
        if (entropy.getRandomBoolean(0.25)) {
            agent.mevInBundle = true;
            agent.mevBundleCount = 0;
        }
        
        return { type: 'BUY', amount };
    } else {
        if (tokenBalance > 0.01) {
            const sellPortion = entropy.getRandomFloat(0.4, 0.7);
            
            agent.mevTrades++;
            
            // Reset leverage after sell
            agent.mevFlashLoan = entropy.getRandomFloat(1.5, 3.0);
            
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        }
        
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    }
}

export default { decideAction };
