/**
 * behaviors/sniperBehavior.js
 * 
 * Sniper strategy behavior - precise entry/exit
 * Waits for optimal moments then executes large trades
 */

const PHASES = {
    WAITING: 'waiting',
    SNIPING: 'sniping',
    EXITING: 'exiting'
};

/**
 * Decide next action for sniper strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize sniper state
    if (!agent.sniperInitialized) {
        agent.sniperInitialized = true;
        agent.sniperPhase = PHASES.WAITING;
        agent.sniperTrades = 0;
        agent.sniperWaitTime = entropy.getRandomInt(5000, 20000); // Initial wait
        agent.sniperStartTime = Date.now();
        
        agent.logger.info(`[Sniper] Starting in ${agent.sniperPhase} phase`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    const elapsed = Date.now() - agent.sniperStartTime;
    
    switch (agent.sniperPhase) {
        case PHASES.WAITING:
            return handleWaiting(agent, entropy, tokenBalance, elapsed);
        case PHASES.SNIPING:
            return handleSniping(agent, entropy, tokenBalance);
        case PHASES.EXITING:
            return handleExiting(agent, entropy, tokenBalance);
        default:
            return { type: 'WAIT' };
    }
}

function handleWaiting(agent, entropy, tokenBalance, elapsed) {
    // Wait for optimal moment
    if (elapsed >= agent.sniperWaitTime) {
        // Time to snipe
        agent.sniperPhase = PHASES.SNIPING;
        agent.sniperTargetAmount = entropy.getRandomFloat(
            agent.maxBuyAmount * 2,
            agent.maxBuyAmount * 5
        ); // Large amount
        
        agent.logger.info(`[Sniper] Sniping with target: ${agent.sniperTargetAmount.toFixed(6)} SOL`);
    }
    
    // Small test trades while waiting
    if (entropy.getRandomBoolean(0.1)) {
        const amount = entropy.getRandomFloat(
            agent.minBuyAmount,
            agent.minBuyAmount * 1.5
        );
        agent.sniperTrades++;
        return { type: 'BUY', amount };
    }
    
    return { type: 'WAIT' };
}

function handleSniping(agent, entropy, tokenBalance) {
    // Execute large snipe
    if (tokenBalance < agent.sniperTargetAmount * 0.5) {
        // Buy aggressively to reach target
        const remaining = agent.sniperTargetAmount - tokenBalance;
        const amount = Math.min(
            entropy.getRandomFloat(agent.maxBuyAmount * 1.5, agent.maxBuyAmount * 3),
            remaining
        );
        
        agent.sniperTrades++;
        
        // After sniping, transition to exit
        if (tokenBalance + amount >= agent.sniperTargetAmount * 0.8) {
            agent.sniperPhase = PHASES.EXITING;
            agent.sniperExitWait = entropy.getRandomInt(3000, 10000);
            agent.sniperExitStart = Date.now();
            
            agent.logger.info(`[Sniper] Snipe complete, preparing exit`);
        }
        
        return { type: 'BUY', amount };
    }
    
    return { type: 'WAIT' };
}

function handleExiting(agent, entropy, tokenBalance) {
    const exitElapsed = Date.now() - agent.sniperExitStart;
    
    // Wait for exit timing
    if (exitElapsed < agent.sniperExitWait) {
        return { type: 'WAIT' };
    }
    
    // Sell all
    if (tokenBalance > 0.01) {
        const amount = tokenBalance; // Sell all
        
        agent.sniperTrades++;
        
        // Reset cycle
        agent.sniperPhase = PHASES.WAITING;
        agent.sniperWaitTime = entropy.getRandomInt(5000, 20000);
        agent.sniperStartTime = Date.now();
        
        agent.logger.info(`[Sniper] Exit complete, waiting for next opportunity`);
        
        return { type: 'SELL', amount };
    }
    
    return { type: 'WAIT' };
}

export default { decideAction, PHASES };
