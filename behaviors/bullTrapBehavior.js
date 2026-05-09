/**
 * behaviors/bullTrapBehavior.js
 * 
 * Bull Trap strategy behavior - fake breakout
 * Creates false bullish signal then dumps
 */

const TRAP_PHASES = {
    ACCUMULATION: 'accumulation',
    FAKE_BREAKOUT: 'fake_breakout',
    TRAP_TRIGGERED: 'trap_triggered',
    DUMP: 'dump',
    RESET: 'reset'
};

/**
 * Decide next action for bull trap strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize trap state
    if (!agent.trapInitialized) {
        agent.trapInitialized = true;
        agent.trapPhase = TRAP_PHASES.ACCUMULATION;
        agent.trapTrades = 0;
        agent.trapBreakoutTarget = entropy.getRandomInt(8, 15);
        agent.trapBreakoutCount = 0;
        
        agent.logger.info(`[BullTrap] Starting trap sequence`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    switch (agent.trapPhase) {
        case TRAP_PHASES.ACCUMULATION:
            return handleAccumulation(agent, entropy, tokenBalance);
        case TRAP_PHASES.FAKE_BREAKOUT:
            return handleFakeBreakout(agent, entropy, tokenBalance);
        case TRAP_PHASES.TRAP_TRIGGERED:
            return handleTrapTriggered(agent, entropy, tokenBalance);
        case TRAP_PHASES.DUMP:
            return handleDump(agent, entropy, tokenBalance);
        case TRAP_PHASES.RESET:
            return handleReset(agent, entropy, tokenBalance);
        default:
            return { type: 'WAIT' };
    }
}

function handleAccumulation(agent, entropy, tokenBalance) {
    // Build position quietly
    const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
    
    agent.trapTrades++;
    agent.trapBreakoutCount++;
    
    // Transition to fake breakout
    if (agent.trapBreakoutCount >= agent.trapBreakoutTarget) {
        agent.trapPhase = TRAP_PHASES.FAKE_BREAKOUT;
        agent.trapBreakoutCount = 0;
        agent.logger.info(`[BullTrap] Accumulation complete, initiating fake breakout`);
    }
    
    return { type: 'BUY', amount };
}

function handleFakeBreakout(agent, entropy, tokenBalance) {
    // Aggressive buying to simulate breakout
    const amount = entropy.getRandomFloat(agent.maxBuyAmount * 0.8, agent.maxBuyAmount * 1.5);
    
    agent.trapTrades++;
    agent.trapBreakoutCount++;
    
    // Trigger the trap
    if (agent.trapBreakoutCount >= entropy.getRandomInt(5, 10)) {
        agent.trapPhase = TRAP_PHASES.TRAP_TRIGGERED;
        agent.trapDumpStart = Date.now();
        agent.logger.info(`[BullTrap] Trap triggered!`);
    }
    
    return { type: 'BUY', amount: parseFloat(amount.toFixed(6)) };
}

function handleTrapTriggered(agent, entropy, tokenBalance) {
    // Brief pause to let others buy in
    const triggerElapsed = Date.now() - agent.trapDumpStart;
    
    if (triggerElapsed < entropy.getRandomInt(2000, 5000)) {
        // Still waiting
        if (entropy.getRandomBoolean(0.3)) {
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            return { type: 'BUY', amount };
        }
        return { type: 'WAIT' };
    }
    
    // Transition to dump
    agent.trapPhase = TRAP_PHASES.DUMP;
    return handleDump(agent, entropy, tokenBalance);
}

function handleDump(agent, entropy, tokenBalance) {
    if (tokenBalance > 0.01) {
        // Dump everything
        const sellPortion = entropy.getRandomFloat(0.7, 1.0);
        const amount = tokenBalance * sellPortion;
        
        agent.trapTrades++;
        
        // Check if dump complete
        if (tokenBalance < 0.02) {
            agent.trapPhase = TRAP_PHASES.RESET;
        }
        
        return { type: 'SELL', amount };
    }
    
    return { type: 'WAIT' };
}

function handleReset(agent, entropy, tokenBalance) {
    // Small buy to restart cycle
    if (entropy.getRandomBoolean(0.3)) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.minBuyAmount * 2);
        
        // Full reset
        agent.trapPhase = TRAP_PHASES.ACCUMULATION;
        agent.trapBreakoutTarget = entropy.getRandomInt(8, 15);
        agent.trapBreakoutCount = 0;
        
        agent.logger.info(`[BullTrap] Trap complete, resetting`);
        
        return { type: 'BUY', amount };
    }
    
    return { type: 'WAIT' };
}

export default { decideAction, TRAP_PHASES };
