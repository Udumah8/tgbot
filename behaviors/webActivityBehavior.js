/**
 * behaviors/webActivityBehavior.js
 * 
 * Web of Activity strategy behavior - diverse activity patterns
 * Creates varied trading patterns across multiple dimensions
 */

/**
 * Decide next action for web of activity strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize web activity state
    if (!agent.webInitialized) {
        agent.webInitialized = true;
        agent.webTrades = 0;
        agent.webPattern = entropy.getRandomInt(0, 4); // 0-4 different patterns
        
        agent.logger.info(`[WebActivity] Pattern type: ${agent.webPattern}`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    // Rotate through patterns based on trade count
    const patternIndex = Math.floor(agent.webTrades / 10) % 5;
    
    let action;
    switch (patternIndex) {
        case 0:
            action = patternSteady(agent, entropy, tokenBalance);
            break;
        case 1:
            action = patternBurst(agent, entropy, tokenBalance);
            break;
        case 2:
            action = patternAlternating(agent, entropy, tokenBalance);
            break;
        case 3:
            action = patternRandom(agent, entropy, tokenBalance);
            break;
        case 4:
            action = patternCyclical(agent, entropy, tokenBalance);
            break;
        default:
            action = patternSteady(agent, entropy, tokenBalance);
    }
    
    agent.webTrades++;
    return action;
}

function patternSteady(agent, entropy, tokenBalance) {
    // Steady, consistent buys
    const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
    return { type: 'BUY', amount };
}

function patternBurst(agent, entropy, tokenBalance) {
    // Burst of activity
    const shouldBurst = entropy.getRandomBoolean(0.3);
    
    if (shouldBurst) {
        // Multiple trades
        const amount = entropy.getRandomFloat(agent.maxBuyAmount * 0.8, agent.maxBuyAmount * 1.2);
        return { type: 'BUY', amount: parseFloat(amount.toFixed(6)) };
    }
    
    // Small trade
    if (tokenBalance > 0.01) {
        const sellPortion = entropy.getRandomFloat(0.3, 0.5);
        return { type: 'SELL', amount: tokenBalance * sellPortion };
    }
    
    const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.minBuyAmount * 1.5);
    return { type: 'BUY', amount };
}

function patternAlternating(agent, entropy, tokenBalance) {
    // Alternate buy/sell
    const isBuy = agent.webTrades % 2 === 0;
    
    if (isBuy) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    } else {
        if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.4, 0.6);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        }
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    }
}

function patternRandom(agent, entropy, tokenBalance) {
    // Completely random
    const shouldBuy = entropy.getRandomBoolean(0.5);
    
    if (shouldBuy) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    } else {
        if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.3, 0.7);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        }
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    }
}

function patternCyclical(agent, entropy, tokenBalance) {
    // 3 trades up, 1 trade down
    const cyclePosition = agent.webTrades % 4;
    
    if (cyclePosition < 3) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    } else {
        if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.5, 0.8);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        }
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    }
}

export default { decideAction };
