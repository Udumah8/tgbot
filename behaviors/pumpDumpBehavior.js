/**
 * behaviors/pumpDumpBehavior.js
 * 
 * Pump & Dump strategy behavior
 * Coordinated pumps followed by dumps
 */

const PHASES = {
    QUIESCENT: 'quiescent',
    PUMP: 'pump',
    PEAK: 'peak',
    DUMP: 'dump'
};

/**
 * Decide next action for pump & dump strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize if not set
    if (!agent.pumpDumpPhase) {
        agent.pumpDumpPhase = PHASES.QUIESCENT;
        agent.pumpDumpTrades = 0;
        agent.pumpDumpCycleTrades = 0;
        agent.pumpDumpTarget = entropy.getRandomInt(5, 15); // Target pumps per cycle
        agent.pumpDumpPeakCount = 0;
        
        agent.logger.info(`[PumpDump] Starting in ${agent.pumpDumpPhase} phase`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    // Phase handler
    switch (agent.pumpDumpPhase) {
        case PHASES.QUIESCENT:
            return handleQuiescent(agent, entropy, tokenBalance);
        case PHASES.PUMP:
            return handlePump(agent, entropy, tokenBalance);
        case PHASES.PEAK:
            return handlePeak(agent, entropy, tokenBalance);
        case PHASES.DUMP:
            return handleDump(agent, entropy, tokenBalance);
        default:
            return { type: 'WAIT' };
    }
}

function handleQuiescent(agent, entropy, tokenBalance) {
    // Quiet phase - occasional small buys
    const shouldBuy = entropy.getRandomBoolean(0.2); // 20% chance
    
    if (shouldBuy) {
        const amount = entropy.getRandomFloat(
            agent.minBuyAmount,
            agent.minBuyAmount * 2
        );
        
        agent.pumpDumpTrades++;
        agent.pumpDumpCycleTrades++;
        
        // Random chance to start pump
        if (entropy.getRandomBoolean(0.3)) {
            transitionPhase(agent, PHASES.PUMP);
            agent.pumpDumpTarget = entropy.getRandomInt(5, 15);
            agent.pumpDumpPeakCount = 0;
        }
        
        return { type: 'BUY', amount };
    }
    
    return { type: 'WAIT' };
}

function handlePump(agent, entropy, tokenBalance) {
    // Aggressive buying to pump price
    const amount = entropy.getRandomFloat(
        agent.minBuyAmount,
        agent.maxBuyAmount
    );
    
    agent.pumpDumpTrades++;
    agent.pumpDumpCycleTrades++;
    agent.pumpDumpPeakCount++;
    
    // Check if we've pumped enough
    if (agent.pumpDumpPeakCount >= agent.pumpDumpTarget) {
        transitionPhase(agent, PHASES.PEAK);
    }
    
    return { type: 'BUY', amount };
}

function handlePeak(agent, entropy, tokenBalance) {
    // Hold at peak, then transition to dump
    const shouldDump = entropy.getRandomBoolean(0.4); // 40% chance per cycle
    
    if (tokenBalance > 0.01) {
        const sellPortion = entropy.getRandomFloat(0.2, 0.5);
        const amount = tokenBalance * sellPortion;
        
        agent.pumpDumpTrades++;
        agent.pumpDumpCycleTrades++;
        
        if (shouldDump || tokenBalance > agent.maxBuyAmount * 5) {
            transitionPhase(agent, PHASES.DUMP);
        }
        
        return { type: 'SELL', amount };
    } else {
        // No tokens, must buy some first
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    }
}

function handleDump(agent, entropy, tokenBalance) {
    // Aggressive selling
    if (tokenBalance > 0.01) {
        const sellPortion = entropy.getRandomFloat(0.4, 0.8);
        const amount = tokenBalance * sellPortion;
        
        agent.pumpDumpTrades++;
        agent.pumpDumpCycleTrades++;
        
        // Check if dump is complete
        if (tokenBalance < 0.02) {
            // Cycle complete, go to quiescent
            transitionPhase(agent, PHASES.QUIESCENT);
            agent.pumpDumpTarget = entropy.getRandomInt(5, 15);
        }
        
        return { type: 'SELL', amount };
    }
    
    return { type: 'WAIT' };
}

function transitionPhase(agent, newPhase) {
    agent.logger.info(`[PumpDump] Phase: ${agent.pumpDumpPhase} → ${newPhase}`);
    agent.pumpDumpPhase = newPhase;
    agent.pumpDumpPeakCount = 0;
}

export default { decideAction, PHASES };
