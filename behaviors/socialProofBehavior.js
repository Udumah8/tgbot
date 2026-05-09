/**
 * behaviors/socialProofBehavior.js
 * 
 * Social Proof strategy behavior - mimics social media hype
 * Creates patterns that look like coordinated community buys
 */

/**
 * Decide next action for social proof strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize social proof state
    if (!agent.socialInitialized) {
        agent.socialInitialized = true;
        agent.socialTrades = 0;
        agent.socialWaveCount = 0;
        agent.socialInWave = entropy.getRandomBoolean(0.3); // 30% chance to be in wave
        
        agent.logger.info(`[SocialProof] ${agent.socialInWave ? 'In wave' : 'Waiting for wave'}`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    // Wave-based trading
    if (agent.socialInWave) {
        return handleInWave(agent, entropy, tokenBalance);
    } else {
        return handleWaitingForWave(agent, entropy, tokenBalance);
    }
}

function handleInWave(agent, entropy, tokenBalance) {
    // In a social wave - trade heavily
    const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
    
    agent.socialTrades++;
    agent.socialWaveCount++;
    
    // Small chance to exit wave
    if (entropy.getRandomBoolean(0.15)) {
        agent.socialInWave = false;
        agent.socialWaveCount = 0;
        
        // Sell if have tokens
        if (tokenBalance > 0.01) {
            const sellPortion = entropy.getRandomFloat(0.4, 0.7);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        }
    }
    
    // Also sell periodically during wave for volume
    if (entropy.getRandomBoolean(0.2) && tokenBalance > 0.01) {
        const sellPortion = entropy.getRandomFloat(0.2, 0.4);
        return { type: 'SELL', amount: tokenBalance * sellPortion };
    }
    
    return { type: 'BUY', amount };
}

function handleWaitingForWave(agent, entropy, tokenBalance) {
    // Waiting for social wave - occasional small trades
    const shouldTrade = entropy.getRandomBoolean(0.2); // 20% trade chance
    
    if (!shouldTrade) {
        return { type: 'WAIT' };
    }
    
    // Small buy
    const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.minBuyAmount * 1.5);
    
    agent.socialTrades++;
    
    // Chance to join wave
    if (entropy.getRandomBoolean(0.25)) {
        agent.socialInWave = true;
        agent.logger.info(`[SocialProof] Joining wave #${agent.socialWaveCount + 1}`);
    }
    
    return { type: 'BUY', amount };
}

export default { decideAction };
