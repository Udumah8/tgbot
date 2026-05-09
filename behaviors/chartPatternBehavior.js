/**
 * behaviors/chartPatternBehavior.js
 * 
 * Chart pattern strategy behavior for agent-based execution
 * Creates specific chart patterns (cup & handle, ascending triangle, etc.)
 */

const PATTERNS = [
    'cup_and_handle',
    'ascending_triangle',
    'bull_flag',
    'double_bottom',
    'inverse_head_shoulders',
    'rising_wedge',
    'symmetrical_triangle',
    'rounding_bottom',
    'falling_wedge',
    'pennant',
    'rectangle',
    'triple_bottom'
];

/**
 * Get pattern multiplier based on pattern type and phase
 * @param {string} pattern - Pattern name
 * @param {number} phase - Current phase (0-1)
 * @param {EntropyEngine} entropy - Entropy engine for randomness
 * @returns {number} Volume multiplier
 */
function getPatternMultiplier(pattern, phase, entropy) {
    const noise = entropy.getRandomFloat(0.9, 1.1);
    
    switch (pattern) {
        case 'cup_and_handle':
            // U-shaped dip then small consolidation
            if (phase < 0.4) return (1.0 - phase * 1.5) * noise; // Dip
            if (phase < 0.7) return (0.4 + (phase - 0.4) * 2) * noise; // Recovery
            return (1.0 - (phase - 0.7) * 0.5) * noise; // Handle
            
        case 'ascending_triangle':
            // Higher lows, flat highs
            return (0.5 + phase * 0.5 + Math.sin(phase * Math.PI * 4) * 0.2) * noise;
            
        case 'bull_flag':
            // Sharp rise then consolidation
            if (phase < 0.3) return (1.0 + phase * 2) * noise; // Pole
            return (1.6 - (phase - 0.3) * 0.3) * noise; // Flag
            
        case 'double_bottom':
            // Two distinct lows
            if (phase < 0.25) return (1.0 - phase * 2) * noise;
            if (phase < 0.5) return (0.5 + (phase - 0.25) * 2) * noise;
            if (phase < 0.75) return (1.0 - (phase - 0.5) * 2) * noise;
            return (0.5 + (phase - 0.75) * 2) * noise;
            
        case 'inverse_head_shoulders':
            // Left shoulder, head, right shoulder
            if (phase < 0.2) return (1.0 - phase * 2) * noise; // Left shoulder
            if (phase < 0.4) return (0.6 - (phase - 0.2) * 2) * noise; // Head
            if (phase < 0.6) return (0.2 + (phase - 0.4) * 2) * noise; // Recovery
            if (phase < 0.8) return (0.6 - (phase - 0.6) * 1) * noise; // Right shoulder
            return (0.4 + (phase - 0.8) * 3) * noise; // Breakout
            
        case 'rising_wedge':
            // Converging trend lines, both rising
            return (0.8 + phase * 0.4 - Math.abs(Math.sin(phase * Math.PI * 3)) * (0.3 - phase * 0.2)) * noise;
            
        case 'symmetrical_triangle':
            // Converging highs and lows
            return (1.0 - Math.abs(Math.sin(phase * Math.PI * 3)) * (0.5 - phase * 0.4)) * noise;
            
        case 'rounding_bottom':
            // Smooth U-shape
            return (0.5 + 0.5 * Math.cos(phase * Math.PI)) * noise;
            
        case 'falling_wedge':
            // Converging trend lines, both falling
            return (1.2 - phase * 0.6 - Math.abs(Math.sin(phase * Math.PI * 3)) * (0.3 - phase * 0.2)) * noise;
            
        case 'pennant':
            // Sharp move then tight consolidation
            if (phase < 0.2) return (1.0 + phase * 3) * noise;
            return (1.6 - Math.abs(Math.sin((phase - 0.2) * Math.PI * 5)) * (0.4 - (phase - 0.2) * 0.3)) * noise;
            
        case 'rectangle':
            // Horizontal consolidation
            return (1.0 + Math.sin(phase * Math.PI * 4) * 0.2) * noise;
            
        case 'triple_bottom':
            // Three distinct lows
            if (phase < 0.15) return (1.0 - phase * 3) * noise;
            if (phase < 0.3) return (0.55 + (phase - 0.15) * 3) * noise;
            if (phase < 0.45) return (1.0 - (phase - 0.3) * 3) * noise;
            if (phase < 0.6) return (0.55 + (phase - 0.45) * 3) * noise;
            if (phase < 0.75) return (1.0 - (phase - 0.6) * 3) * noise;
            return (0.55 + (phase - 0.75) * 1.8) * noise;
            
        default:
            return 1.0 * noise;
    }
}

/**
 * Decide next action for chart pattern strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;
    
    // Initialize pattern if not set
    if (!agent.chartPattern) {
        agent.chartPattern = entropy.pickRandom(PATTERNS);
        agent.chartPhase = 0;
        agent.chartTrades = 0;
        agent.chartMaxTrades = entropy.getRandomInt(20, 50);
        
        agent.logger.info(`[ChartPattern] Selected pattern: ${agent.chartPattern} (${agent.chartMaxTrades} trades)`);
    }
    
    // Update phase
    agent.chartPhase = agent.chartTrades / agent.chartMaxTrades;
    
    // Get pattern multiplier
    const multiplier = getPatternMultiplier(agent.chartPattern, agent.chartPhase, entropy);
    
    // Get token balance
    const tokenBalance = await agent._getTokenBalance();
    
    // Decide action based on multiplier
    const shouldBuy = multiplier > 1.0 || tokenBalance < 0.01;
    
    if (shouldBuy) {
        // Buy with pattern-adjusted amount
        const baseAmount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        const amount = parseFloat((baseAmount * multiplier).toFixed(6));
        
        agent.chartTrades++;
        return { type: 'BUY', amount };
    } else {
        // Sell portion
        if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.1, 0.3);
            const amount = tokenBalance * sellPortion;
            
            agent.chartTrades++;
            return { type: 'SELL', amount };
        }
    }
    
    // Reset pattern if complete
    if (agent.chartTrades >= agent.chartMaxTrades) {
        agent.logger.info(`[ChartPattern] Pattern ${agent.chartPattern} complete, selecting new pattern`);
        agent.chartPattern = null;
    }
    
    return { type: 'WAIT' };
}

export default { decideAction, PATTERNS };

