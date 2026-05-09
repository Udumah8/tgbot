/**
 * behaviors/advancedWashBehavior.js
 * 
 * Advanced Wash Trading behavior - sophisticated volume generation
 * Creates realistic trading patterns with wash trades
 */

const WASH_PATTERNS = [
    'simple_back_and_forth',
    'triangle_cycle',
    'random_walk',
    'momentum_building'
];

/**
 * Decide next action for advanced wash trading
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize wash state
    if (!agent.washInitialized) {
        agent.washInitialized = true;
        agent.washPattern = entropy.pickRandom(WASH_PATTERNS);
        agent.washTrades = 0;
        agent.washLastAction = entropy.getRandomBoolean(0.5) ? 'BUY' : 'SELL';
        agent.washCycleCount = 0;
        
        agent.logger.info(`[AdvancedWash] Pattern: ${agent.washPattern}`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    // Always execute - this is wash trading
    const shouldTrade = entropy.getRandomBoolean(0.85); // 85% trade rate
    
    if (!shouldTrade) {
        return { type: 'WAIT' };
    }
    
    // Pattern-based decision
    let action;
    
    switch (agent.washPattern) {
        case 'simple_back_and_forth':
            action = handleBackAndForth(agent, entropy, tokenBalance);
            break;
        case 'triangle_cycle':
            action = handleTriangleCycle(agent, entropy, tokenBalance);
            break;
        case 'random_walk':
            action = handleRandomWalk(agent, entropy, tokenBalance);
            break;
        case 'momentum_building':
            action = handleMomentumBuilding(agent, entropy, tokenBalance);
            break;
        default:
            action = handleBackAndForth(agent, entropy, tokenBalance);
    }
    
    agent.washTrades++;
    agent.washLastAction = action.type;
    
    return action;
}

function handleBackAndForth(agent, entropy, tokenBalance) {
    // Simply alternate buy/sell
    const shouldBuy = agent.washLastAction === 'SELL';
    
    if (shouldBuy) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    } else {
        if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.4, 0.7);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        } else {
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            return { type: 'BUY', amount };
        }
    }
}

function handleTriangleCycle(agent, entropy, tokenBalance) {
    // Buy, buy, sell, sell, repeat (triangle pattern)
    const cyclePosition = agent.washTrades % 4;
    
    if (cyclePosition < 2) {
        // Buying phase
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    } else {
        // Selling phase
        if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.4, 0.6);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        } else {
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            return { type: 'BUY', amount };
        }
    }
}

function handleRandomWalk(agent, entropy, tokenBalance) {
    // Random walk - probability based on balance
    const buyThreshold = 0.5 + (agent.washTrades % 10) * 0.03;
    const shouldBuy = entropy.getRandomBoolean(Math.min(buyThreshold, 0.8));
    
    if (shouldBuy) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    } else {
        if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.3, 0.6);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        } else {
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            return { type: 'BUY', amount };
        }
    }
}

function handleMomentumBuilding(agent, entropy, tokenBalance) {
    // Momentum: build up then release
    if (!agent.momentumCount) agent.momentumCount = 0;
    
    const inMomentumPhase = agent.momentumCount < 5;
    
    if (inMomentumPhase) {
        // Building momentum - mostly buy
        agent.momentumCount++;
        
        if (entropy.getRandomBoolean(0.7)) {
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            return { type: 'BUY', amount };
        } else if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.2, 0.4);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        }
    } else {
        // Release - mostly sell
        agent.momentumCount++;
        
        if (tokenBalance > 0.01) {
            const sellPortion = entropy.getRandomFloat(0.5, 0.8);
            
            // Reset after release
            if (agent.momentumCount > 8) {
                agent.momentumCount = 0;
            }
            
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        } else {
            agent.momentumCount = 0;
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            return { type: 'BUY', amount };
        }
    }
    
    return { type: 'WAIT' };
}

export default { decideAction, WASH_PATTERNS };
