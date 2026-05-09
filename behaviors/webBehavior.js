/**
 * behaviors/webBehavior.js
 * 
 * Web of Activity strategy - Creates interconnected trading patterns
 * Simulates network of related traders
 */

async function decideAction(agent) {
    const entropy = agent.entropy;
    const tokenBalance = await agent._getTokenBalance();
    
    // Initialize web state
    if (!agent.webPhase) {
        agent.webPhase = entropy.getRandomInt(0, 3); // 4 phases
        agent.webCycle = 0;
    }
    
    // Rotate through phases
    agent.webCycle++;
    if (agent.webCycle > entropy.getRandomInt(5, 15)) {
        agent.webPhase = (agent.webPhase + 1) % 4;
        agent.webCycle = 0;
    }
    
    // Phase-based behavior
    switch (agent.webPhase) {
        case 0: // Accumulation
            if (tokenBalance < 0.1) {
                const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount * 1.2);
                return { type: 'BUY', amount };
            }
            break;
            
        case 1: // Active trading
            const shouldBuy = entropy.getRandomBoolean(0.6);
            if (shouldBuy) {
                const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
                return { type: 'BUY', amount };
            } else if (tokenBalance > 0.01) {
                const sellPortion = entropy.getRandomFloat(0.1, 0.4);
                return { type: 'SELL', amount: tokenBalance * sellPortion };
            }
            break;
            
        case 2: // Distribution
            if (tokenBalance > 0.05) {
                const sellPortion = entropy.getRandomFloat(0.2, 0.5);
                return { type: 'SELL', amount: tokenBalance * sellPortion };
            }
            break;
            
        case 3: // Quiet period
            if (entropy.getRandomBoolean(0.3)) {
                const amount = entropy.getRandomFloat(agent.minBuyAmount * 0.5, agent.maxBuyAmount * 0.5);
                return { type: 'BUY', amount };
            }
            break;
    }
    
    return { type: 'WAIT' };
}

export default { decideAction };

