/**
 * behaviors/holderGrowthBehavior.js
 * 
 * Holder Growth strategy behavior - accumulate and hold
 * Slowly accumulates tokens and holds for long periods
 */

const PHASES = {
    ACCUMULATING: 'accumulating',
    HOLDING: 'holding',
    DISTRIBUTING: 'distributing'
};

/**
 * Decide next action for holder growth strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize holder state
    if (!agent.holderInitialized) {
        agent.holderInitialized = true;
        agent.holderPhase = PHASES.ACCUMULATING;
        agent.holderTrades = 0;
        agent.holderTargetHoldings = entropy.getRandomFloat(
            agent.maxBuyAmount * 5,
            agent.maxBuyAmount * 20
        ); // Target 5-20x max buy
        
        agent.logger.info(`[HolderGrowth] Target: ${agent.holderTargetHoldings.toFixed(4)} tokens`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    switch (agent.holderPhase) {
        case PHASES.ACCUMULATING:
            return handleAccumulating(agent, entropy, tokenBalance);
        case PHASES.HOLDING:
            return handleHolding(agent, entropy, tokenBalance);
        case PHASES.DISTRIBUTING:
            return handleDistributing(agent, entropy, tokenBalance);
        default:
            return { type: 'WAIT' };
    }
}

function handleAccumulating(agent, entropy, tokenBalance) {
    // Buy aggressively to accumulate
    const amount = entropy.getRandomFloat(
        agent.minBuyAmount,
        agent.maxBuyAmount
    );
    
    agent.holderTrades++;
    
    // Check if target reached
    const projectedHoldings = tokenBalance + amount * 1000; // Estimate
    if (projectedHoldings >= agent.holderTargetHoldings) {
        agent.holderPhase = PHASES.HOLDING;
        agent.holderHoldStart = Date.now();
        agent.holderMinHoldTime = entropy.getRandomInt(30000, 120000); // 30s - 2min
        
        agent.logger.info(`[HolderGrowth] Target reached, starting hold phase`);
    }
    
    return { type: 'BUY', amount };
}

function handleHolding(agent, entropy, tokenBalance) {
    const holdTime = Date.now() - agent.holderHoldStart;
    
    // Check if minimum hold time passed
    if (holdTime >= agent.holderMinHoldTime) {
        // Small chance to distribute
        if (entropy.getRandomBoolean(0.2)) {
            agent.holderPhase = PHASES.DISTRIBUTING;
            agent.logger.info(`[HolderGrowth] Starting distribution`);
        }
    }
    
    // Very small chance to add more during hold
    if (entropy.getRandomBoolean(0.05)) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.minBuyAmount * 2);
        return { type: 'BUY', amount };
    }
    
    return { type: 'WAIT' };
}

function handleDistributing(agent, entropy, tokenBalance) {
    if (tokenBalance > 0.01) {
        // Sell small portion
        const sellPortion = entropy.getRandomFloat(0.1, 0.25);
        const amount = tokenBalance * sellPortion;
        
        agent.holderTrades++;
        
        // Check if mostly distributed
        if (tokenBalance < agent.holderTargetHoldings * 0.2) {
            // Reset cycle
            agent.holderPhase = PHASES.ACCUMULATING;
            agent.holderTargetHoldings = entropy.getRandomFloat(
                agent.maxBuyAmount * 5,
                agent.maxBuyAmount * 20
            );
            agent.logger.info(`[HolderGrowth] Distribution complete, new target set`);
        }
        
        return { type: 'SELL', amount };
    }
    
    return { type: 'WAIT' };
}

export default { decideAction, PHASES };
