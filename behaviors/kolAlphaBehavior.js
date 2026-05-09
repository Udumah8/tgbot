/**
 * behaviors/kolAlphaBehavior.js
 * 
 * KOL (Key Opinion Leader) Alpha strategy behavior
 * Simulates KOL calls with coordinated whale and swarm activity
 */

const KOL_PHASES = {
    SETUP: 'setup',
    WHALE_BUY: 'whale_buy',
    SWARM_BUILD: 'swarm_build',
    WHALE_SELL: 'whale_sell',
    SWARM_EXIT: 'swarm_exit'
};

/**
 * Decide next action for KOL alpha strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize KOL state
    if (!agent.kolInitialized) {
        agent.kolInitialized = true;
        agent.kolPhase = KOL_PHASES.SETUP;
        agent.kolTrades = 0;
        agent.kolIsWhale = entropy.getRandomBoolean(0.2); // 20% are whales
        agent.kolWhaleThreshold = agent.maxBuyAmount * 3;
        
        agent.logger.info(`[KOLAlpha] ${agent.kolIsWhale ? 'Whale' : 'Swarm'} role assigned`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    // Different behavior based on role
    if (agent.kolIsWhale) {
        return handleWhale(agent, entropy, tokenBalance);
    } else {
        return handleSwarm(agent, entropy, tokenBalance);
    }
}

function handleWhale(agent, entropy, tokenBalance) {
    // Whale executes large trades
    switch (agent.kolPhase) {
        case KOL_PHASES.SETUP:
            // Start with whale buy
            const setupAmount = entropy.getRandomFloat(agent.maxBuyAmount, agent.maxBuyAmount * 3);
            agent.kolTrades++;
            agent.kolPhase = KOL_PHASES.WHALE_BUY;
            return { type: 'BUY', amount: parseFloat(setupAmount.toFixed(6)) };
            
        case KOL_PHASES.WHALE_BUY:
            // Continue buying
            const buyAmount = entropy.getRandomFloat(agent.maxBuyAmount, agent.maxBuyAmount * 2);
            agent.kolTrades++;
            
            // Transition to sell
            if (entropy.getRandomBoolean(0.4)) {
                agent.kolPhase = KOL_PHASES.WHALE_SELL;
            }
            return { type: 'BUY', amount: parseFloat(buyAmount.toFixed(6)) };
            
        case KOL_PHASES.WHALE_SELL:
            // Dump
            if (tokenBalance > 0.1) {
                const sellPortion = entropy.getRandomFloat(0.5, 0.8);
                agent.kolTrades++;
                
                // Reset after sell
                agent.kolPhase = KOL_PHASES.SETUP;
                return { type: 'SELL', amount: tokenBalance * sellPortion };
            }
            return { type: 'WAIT' };
            
        default:
            return { type: 'WAIT' };
    }
}

function handleSwarm(agent, entropy, tokenBalance) {
    // Swarm follows with smaller trades
    switch (agent.kolPhase) {
        case KOL_PHASES.SETUP:
            // Small initial buy
            const setupAmount = entropy.getRandomFloat(
                agent.minBuyAmount,
                agent.minBuyAmount * 2
            );
            agent.kolTrades++;
            agent.kolPhase = KOL_PHASES.SWARM_BUILD;
            return { type: 'BUY', amount: setupAmount };
            
        case KOL_PHASES.SWARM_BUILD:
            // Build position
            const buildAmount = entropy.getRandomFloat(
                agent.minBuyAmount,
                agent.maxBuyAmount
            );
            agent.kolTrades++;
            
            // Build for a while then exit
            if (entropy.getRandomBoolean(0.25)) {
                agent.kolPhase = KOL_PHASES.SWARM_EXIT;
            }
            return { type: 'BUY', amount: parseFloat(buildAmount.toFixed(6)) };
            
        case KOL_PHASES.SWARM_EXIT:
            // Exit when whale sells
            if (tokenBalance > 0.01) {
                const sellPortion = entropy.getRandomFloat(0.6, 0.9);
                agent.kolTrades++;
                
                // Reset
                agent.kolPhase = KOL_PHASES.SETUP;
                return { type: 'SELL', amount: tokenBalance * sellPortion };
            }
            return { type: 'WAIT' };
            
        default:
            return { type: 'WAIT' };
    }
}

export default { decideAction, KOL_PHASES };
