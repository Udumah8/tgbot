/**
 * behaviors/ladderBehavior.js
 * 
 * Ladder strategy behavior - price ladder trading
 * Buys at progressively higher prices, sells at peaks
 */

const LADDER_PHASES = {
    BUILDING: 'building',
    CLIMBING: 'climbing',
    PEAKING: 'peaking',
    DESCENDING: 'descending'
};

/**
 * Decide next action for ladder strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize ladder state
    if (!agent.ladderInitialized) {
        agent.ladderInitialized = true;
        agent.ladderPhase = LADDER_PHASES.BUILDING;
        agent.ladderTrades = 0;
        agent.ladderStep = 0;
        agent.ladderMaxSteps = entropy.getRandomInt(5, 10);
        agent.ladderStepSize = entropy.getRandomFloat(0.1, 0.2); // 10-20% per step
        
        agent.logger.info(`[Ladder] Starting with ${agent.ladderMaxSteps} steps, ${(agent.ladderStepSize * 100).toFixed(0)}% per step`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    switch (agent.ladderPhase) {
        case LADDER_PHASES.BUILDING:
            return handleBuilding(agent, entropy, tokenBalance);
        case LADDER_PHASES.CLIMBING:
            return handleClimbing(agent, entropy, tokenBalance);
        case LADDER_PHASES.PEAKING:
            return handlePeaking(agent, entropy, tokenBalance);
        case LADDER_PHASES.DESCENDING:
            return handleDescending(agent, entropy, tokenBalance);
        default:
            return { type: 'WAIT' };
    }
}

function handleBuilding(agent, entropy, tokenBalance) {
    // Build initial position
    const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
    
    agent.ladderTrades++;
    agent.ladderStep++;
    
    // Move to climbing
    if (agent.ladderStep >= entropy.getRandomInt(3, 5)) {
        agent.ladderPhase = LADDER_PHASES.CLIMBING;
        agent.ladderStep = 0;
        agent.logger.info(`[Ladder] Moving to climbing phase`);
    }
    
    return { type: 'BUY', amount };
}

function handleClimbing(agent, entropy, tokenBalance) {
    // Buy at each ladder step (higher price)
    const stepMultiplier = 1 + (agent.ladderStep * agent.ladderStepSize);
    const amount = agent.maxBuyAmount * stepMultiplier * entropy.getRandomFloat(0.8, 1.2);
    
    agent.ladderTrades++;
    agent.ladderStep++;
    
    // Check if reached top of ladder
    if (agent.ladderStep >= agent.ladderMaxSteps) {
        agent.ladderPhase = LADDER_PHASES.PEAKING;
        agent.ladderStep = 0;
        agent.logger.info(`[Ladder] Reached peak, starting descent`);
    }
    
    return { type: 'BUY', amount: parseFloat(amount.toFixed(6)) };
}

function handlePeaking(agent, entropy, tokenBalance) {
    // Hold at peak briefly
    const shouldSell = entropy.getRandomBoolean(0.4);
    
    if (tokenBalance > 0.01 && shouldSell) {
        const sellPortion = entropy.getRandomFloat(0.3, 0.5);
        
        agent.ladderTrades++;
        agent.ladderStep++;
        
        if (agent.ladderStep >= entropy.getRandomInt(2, 4)) {
            agent.ladderPhase = LADDER_PHASES.DESCENDING;
            agent.ladderStep = 0;
        }
        
        return { type: 'SELL', amount: tokenBalance * sellPortion };
    }
    
    return { type: 'WAIT' };
}

function handleDescending(agent, entropy, tokenBalance) {
    // Sell down the ladder
    if (tokenBalance > 0.01) {
        const stepMultiplier = 1 - (agent.ladderStep * agent.ladderStepSize * 0.5);
        const sellPortion = entropy.getRandomFloat(0.2, 0.4) * stepMultiplier;
        
        agent.ladderTrades++;
        agent.ladderStep++;
        
        // Reset ladder when complete
        if (agent.ladderStep >= agent.ladderMaxSteps || tokenBalance < 0.02) {
            // Full reset
            agent.ladderPhase = LADDER_PHASES.BUILDING;
            agent.ladderStep = 0;
            agent.ladderMaxSteps = entropy.getRandomInt(5, 10);
            
            agent.logger.info(`[Ladder] Ladder complete, resetting`);
        }
        
        return { type: 'SELL', amount: tokenBalance * sellPortion };
    }
    
    return { type: 'WAIT' };
}

export default { decideAction, LADDER_PHASES };
