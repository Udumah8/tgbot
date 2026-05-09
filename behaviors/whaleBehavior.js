/**
 * behaviors/whaleBehavior.js
 * 
 * Whale strategy behavior - large coordinated trades
 * Simulates whale activity with large buy/sell orders
 */

const PHASES = {
    ACCUMULATION: 'accumulation',
    DISTRIBUTION: 'distribution',
    DUMP: 'dump',
    RECOVERY: 'recovery'
};

/**
 * Decide next action for whale strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize phase if not set
    if (!agent.whalePhase) {
        agent.whalePhase = PHASES.ACCUMULATION;
        agent.whaleTrades = 0;
        agent.whalePhaseTrades = 0;
        agent.whaleMaxPhaseTrades = entropy.getRandomInt(10, 30);
        agent.whaleBaseAmount = agent.maxBuyAmount * entropy.getRandomFloat(3, 10); // Large amounts
        
        agent.logger.info(`[Whale] Starting in ${agent.whalePhase} phase`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    // Phase logic
    switch (agent.whalePhase) {
        case PHASES.ACCUMULATION:
            return handleAccumulation(agent, entropy, tokenBalance);
            
        case PHASES.DISTRIBUTION:
            return handleDistribution(agent, entropy, tokenBalance);
            
        case PHASES.DUMP:
            return handleDump(agent, entropy, tokenBalance);
            
        case PHASES.RECOVERY:
            return handleRecovery(agent, entropy, tokenBalance);
            
        default:
            return { type: 'WAIT' };
    }
}

function handleAccumulation(agent, entropy, tokenBalance) {
    // Large buys, accumulate tokens
    const baseAmount = entropy.getRandomFloat(agent.minBuyAmount, agent.whaleBaseAmount);
    const jitterMultiplier = 1 + (entropy.getRandomFloat(-10, 10) / 100);
    const amount = parseFloat((baseAmount * jitterMultiplier).toFixed(6));
    
    agent.whaleTrades++;
    agent.whalePhaseTrades++;
    
    // Check for phase transition
    if (agent.whalePhaseTrades >= agent.whaleMaxPhaseTrades) {
        transitionPhase(agent, PHASES.DISTRIBUTION);
    }
    
    return { type: 'BUY', amount };
}

function handleDistribution(agent, entropy, tokenBalance) {
    // Mixed buys and sells, distribute
    const shouldBuy = entropy.getRandomBoolean(0.6);
    
    if (shouldBuy) {
        const baseAmount = entropy.getRandomFloat(agent.minBuyAmount, agent.whaleBaseAmount * 0.5);
        const amount = parseFloat((baseAmount * (1 + entropy.getRandomFloat(-10, 10) / 100)).toFixed(6));
        
        agent.whaleTrades++;
        agent.whalePhaseTrades++;
        
        if (agent.whalePhaseTrades >= agent.whaleMaxPhaseTrades) {
            transitionPhase(agent, PHASES.DUMP);
        }
        
        return { type: 'BUY', amount };
    } else if (tokenBalance > 0) {
        // Sell portion of holdings
        const sellPortion = entropy.getRandomFloat(0.15, 0.35);
        const amount = tokenBalance * sellPortion;
        
        agent.whaleTrades++;
        agent.whalePhaseTrades++;
        
        if (agent.whalePhaseTrades >= agent.whaleMaxPhaseTrades) {
            transitionPhase(agent, PHASES.DUMP);
        }
        
        return { type: 'SELL', amount };
    }
    
    return { type: 'WAIT' };
}

function handleDump(agent, entropy, tokenBalance) {
    // Massive sell-off
    if (tokenBalance > 0) {
        const sellPortion = entropy.getRandomFloat(0.5, 0.9); // Sell 50-90%
        const amount = tokenBalance * sellPortion;
        
        agent.whaleTrades++;
        agent.whalePhaseTrades++;
        
        if (agent.whalePhaseTrades >= agent.whaleMaxPhaseTrades) {
            transitionPhase(agent, PHASES.RECOVERY);
        }
        
        return { type: 'SELL', amount };
    }
    
    // No tokens, wait
    return { type: 'WAIT' };
}

function handleRecovery(agent, entropy, tokenBalance) {
    // Small buys to rebuild position slowly
    if (tokenBalance < 0.1) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.whaleBaseAmount * 0.2);
        
        agent.whaleTrades++;
        agent.whalePhaseTrades++;
        
        if (agent.whalePhaseTrades >= agent.whaleMaxPhaseTrades * 2) {
            // Reset cycle
            transitionPhase(agent, PHASES.ACCUMULATION);
        }
        
        return { type: 'BUY', amount };
    }
    
    return { type: 'WAIT' };
}

function transitionPhase(agent, newPhase) {
    agent.logger.info(`[Whale] Transitioning from ${agent.whalePhase} to ${newPhase}`);
    agent.whalePhase = newPhase;
    agent.whalePhaseTrades = 0;
    
    const entropy = agent.entropy;
    agent.whaleMaxPhaseTrades = entropy.getRandomInt(10, 30);
}

export default { decideAction, PHASES };
