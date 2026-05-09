/**
 * behaviors/curvePumpBehavior.js
 * 
 * Curve Pump strategy behavior - smooth price manipulation
 * Gradual buying to create smooth price increases
 */

const PUMP_PHASES = {
    RAMP_UP: 'ramp_up',
    SUSTAIN: 'sustain',
    ACCELERATE: 'accelerate',
    RELEASE: 'release'
};

/**
 * Decide next action for curve pump strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize curve pump state
    if (!agent.curveInitialized) {
        agent.curveInitialized = true;
        agent.curvePhase = PUMP_PHASES.RAMP_UP;
        agent.curveTrades = 0;
        agent.curveIntensity = entropy.getRandomFloat(0.5, 1.5);
        
        agent.logger.info(`[CurvePump] Starting with intensity: ${agent.curveIntensity.toFixed(2)}`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    // Phase handler
    switch (agent.curvePhase) {
        case PUMP_PHASES.RAMP_UP:
            return handleRampUp(agent, entropy, tokenBalance);
        case PUMP_PHASES.SUSTAIN:
            return handleSustain(agent, entropy, tokenBalance);
        case PUMP_PHASES.ACCELERATE:
            return handleAccelerate(agent, entropy, tokenBalance);
        case PUMP_PHASES.RELEASE:
            return handleRelease(agent, entropy, tokenBalance);
        default:
            return { type: 'WAIT' };
    }
}

function handleRampUp(agent, entropy, tokenBalance) {
    // Slow, gradual buying
    const baseAmount = agent.minBuyAmount + (agent.maxBuyAmount - agent.minBuyAmount) * 0.3;
    const amount = baseAmount * agent.curveIntensity * entropy.getRandomFloat(0.8, 1.2);
    
    agent.curveTrades++;
    
    // Phase transition
    if (agent.curveTrades > entropy.getRandomInt(8, 15)) {
        agent.curvePhase = PUMP_PHASES.SUSTAIN;
        agent.curveTrades = 0;
        agent.logger.info(`[CurvePump] Transitioning to SUSTAIN`);
    }
    
    return { type: 'BUY', amount: parseFloat(amount.toFixed(6)) };
}

function handleSustain(agent, entropy, tokenBalance) {
    // Maintain buying pressure
    const baseAmount = agent.minBuyAmount + (agent.maxBuyAmount - agent.minBuyAmount) * 0.5;
    const amount = baseAmount * agent.curveIntensity * entropy.getRandomFloat(0.8, 1.2);
    
    agent.curveTrades++;
    
    // Chance to accelerate
    if (entropy.getRandomBoolean(0.3)) {
        agent.curvePhase = PUMP_PHASES.ACCELERATE;
        agent.curveTrades = 0;
        agent.logger.info(`[CurvePump] Transitioning to ACCELERATE`);
    }
    
    // Phase transition
    if (agent.curveTrades > entropy.getRandomInt(10, 20)) {
        agent.curvePhase = PUMP_PHASES.ACCELERATE;
        agent.curveTrades = 0;
    }
    
    return { type: 'BUY', amount: parseFloat(amount.toFixed(6)) };
}

function handleAccelerate(agent, entropy, tokenBalance) {
    // Aggressive buying
    const baseAmount = agent.maxBuyAmount * agent.curveIntensity;
    const amount = baseAmount * entropy.getRandomFloat(0.9, 1.1);
    
    agent.curveTrades++;
    
    // Occasional profit-taking
    if (entropy.getRandomBoolean(0.15) && tokenBalance > 0.05) {
        const sellPortion = entropy.getRandomFloat(0.2, 0.4);
        return { type: 'SELL', amount: tokenBalance * sellPortion };
    }
    
    // Phase transition
    if (agent.curveTrades > entropy.getRandomInt(5, 12)) {
        agent.curvePhase = PUMP_PHASES.RELEASE;
        agent.curveTrades = 0;
        agent.logger.info(`[CurvePump] Transitioning to RELEASE`);
    }
    
    return { type: 'BUY', amount: parseFloat(amount.toFixed(6)) };
}

function handleRelease(agent, entropy, tokenBalance) {
    // Dump accumulated tokens
    if (tokenBalance > 0.02) {
        const sellPortion = entropy.getRandomFloat(0.5, 0.8);
        const amount = tokenBalance * sellPortion;
        
        agent.curveTrades++;
        
        // Reset cycle
        if (tokenBalance < 0.03) {
            agent.curvePhase = PUMP_PHASES.RAMP_UP;
            agent.curveTrades = 0;
            agent.curveIntensity = entropy.getRandomFloat(0.5, 1.5);
            agent.logger.info(`[CurvePump] Cycle complete, new intensity: ${agent.curveIntensity.toFixed(2)}`);
        }
        
        return { type: 'SELL', amount };
    }
    
    // Need tokens
    const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
    return { type: 'BUY', amount };
}

export default { decideAction, PUMP_PHASES };
