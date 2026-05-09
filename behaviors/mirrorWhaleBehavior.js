/**
 * behaviors/mirrorWhaleBehavior.js
 * 
 * Mirror Whale strategy behavior - copies whale movements
 * Mirrors large wallet activity for fake momentum
 */

/**
 * Decide next action for mirror whale strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize mirror state
    if (!agent.mirrorInitialized) {
        agent.mirrorInitialized = true;
        agent.mirrorTrades = 0;
        agent.mirrorTargetWhale = generateFakeWhale(entropy);
        agent.mirrorSyncChance = entropy.getRandomFloat(0.3, 0.6);
        
        agent.logger.info(`[MirrorWhale] Mirroring whale: ${agent.mirrorTargetWhale.address.slice(0, 8)}...`);
    }
    
    const tokenBalance = await agent._getTokenBalance();
    
    // Decide whether to mirror the whale
    const shouldMirror = entropy.getRandomBoolean(agent.mirrorSyncChance);
    
    if (!shouldMirror) {
        // Small random trade
        if (entropy.getRandomBoolean(0.3)) {
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            agent.mirrorTrades++;
            return { type: 'BUY', amount };
        }
        return { type: 'WAIT' };
    }
    
    // Simulate whale action
    const whaleAction = agent.mirrorTargetWhale.nextAction(entropy);
    
    if (whaleAction === 'BUY') {
        // Large buy to mirror whale
        const amount = entropy.getRandomFloat(
            agent.maxBuyAmount,
            agent.maxBuyAmount * 2
        );
        
        agent.mirrorTrades++;
        
        // Occasionally update whale target
        if (entropy.getRandomBoolean(0.2)) {
            agent.mirrorTargetWhale = generateFakeWhale(entropy);
        }
        
        return { type: 'BUY', amount };
    } else {
        // Sell to mirror whale exit
        if (tokenBalance > 0.01) {
            const sellPortion = entropy.getRandomFloat(0.4, 0.7);
            
            agent.mirrorTrades++;
            
            // Update whale target after sell
            agent.mirrorTargetWhale = generateFakeWhale(entropy);
            
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        } else {
            // Need tokens - small buy
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            agent.mirrorTrades++;
            return { type: 'BUY', amount };
        }
    }
}

function generateFakeWhale(entropy) {
    // Generate a fake whale pattern
    return {
        address: generateRandomAddress(entropy),
        balance: entropy.getRandomFloat(100, 1000), // SOL
        lastAction: entropy.getRandomBoolean(0.6) ? 'BUY' : 'SELL',
        nextAction: (entropy) => {
            // 60% chance to continue same action (momentum)
            const continueSame = entropy.getRandomBoolean(0.6);
            if (continueSame) {
                return agent.mirrorTargetWhale?.lastAction || 'BUY';
            }
            return entropy.getRandomBoolean(0.5) ? 'BUY' : 'SELL';
        }
    };
}

function generateRandomAddress(entropy) {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let address = '';
    for (let i = 0; i < 44; i++) {
        address += chars[entropy.getRandomInt(0, chars.length - 1)];
    }
    return address;
}

export default { decideAction };
