/**
 * behaviors/chartPatternBehavior.js
 *
 * Chart pattern strategy behavior for agent-based execution
 * Creates specific chart patterns (cup & handle, ascending triangle, etc.)
 *
 * FIXES APPLIED:
 *   shouldBuy was `multiplier > 1.0` — meaning the bot SOLD during dip
 *   phases (multiplier < 1.0). For patterns like cup_and_handle,
 *   double_bottom, and rounding_bottom, the dip IS the accumulation zone.
 *   The logic was backwards — buying peaks and selling dips.
 *
 *   Fix 1: shouldBuy = multiplier < 1.0  (buy the dip, sell the peak)
 *   Fix 2: sell portions scale with peak strength so larger peaks produce
 *           proportionally larger distributions (more realistic).
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
 * @param {number} phase   - Current phase (0–1)
 * @param {EntropyEngine} entropy
 * @returns {number} Volume multiplier
 */
function getPatternMultiplier(pattern, phase, entropy) {
    const noise = entropy.getRandomFloat(0.9, 1.1);

    switch (pattern) {
        case 'cup_and_handle':
            // U-shaped dip then small consolidation
            if (phase < 0.4) return (1.0 - phase * 1.5) * noise;           // Dip
            if (phase < 0.7) return (0.4 + (phase - 0.4) * 2) * noise;     // Recovery
            return (1.0 - (phase - 0.7) * 0.5) * noise;                    // Handle

        case 'ascending_triangle':
            // Higher lows, flat highs
            return (0.5 + phase * 0.5 + Math.sin(phase * Math.PI * 4) * 0.2) * noise;

        case 'bull_flag':
            // Sharp rise then consolidation
            if (phase < 0.3) return (1.0 + phase * 2) * noise;             // Pole
            return (1.6 - (phase - 0.3) * 0.3) * noise;                    // Flag

        case 'double_bottom':
            // Two distinct lows
            if (phase < 0.25) return (1.0 - phase * 2) * noise;
            if (phase < 0.50) return (0.5 + (phase - 0.25) * 2) * noise;
            if (phase < 0.75) return (1.0 - (phase - 0.5) * 2) * noise;
            return (0.5 + (phase - 0.75) * 2) * noise;

        case 'inverse_head_shoulders':
            // Left shoulder, head (lowest), right shoulder, breakout
            if (phase < 0.2) return (1.0 - phase * 2) * noise;             // Left shoulder
            if (phase < 0.4) return (0.6 - (phase - 0.2) * 2) * noise;    // Head
            if (phase < 0.6) return (0.2 + (phase - 0.4) * 2) * noise;    // Recovery
            if (phase < 0.8) return (0.6 - (phase - 0.6) * 1) * noise;    // Right shoulder
            return (0.4 + (phase - 0.8) * 3) * noise;                      // Breakout

        case 'rising_wedge':
            return (0.8 + phase * 0.4 - Math.abs(Math.sin(phase * Math.PI * 3)) * (0.3 - phase * 0.2)) * noise;

        case 'symmetrical_triangle':
            return (1.0 - Math.abs(Math.sin(phase * Math.PI * 3)) * (0.5 - phase * 0.4)) * noise;

        case 'rounding_bottom':
            // Smooth U-shape
            return (0.5 + 0.5 * Math.cos(phase * Math.PI)) * noise;

        case 'falling_wedge':
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
            if (phase < 0.30) return (0.55 + (phase - 0.15) * 3) * noise;
            if (phase < 0.45) return (1.0 - (phase - 0.3) * 3) * noise;
            if (phase < 0.60) return (0.55 + (phase - 0.45) * 3) * noise;
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
        agent.chartPattern   = entropy.pickRandom(PATTERNS);
        agent.chartPhase     = 0;
        agent.chartTrades    = 0;
        agent.chartMaxTrades = entropy.getRandomInt(20, 50);

        agent.logger.info(
            `[ChartPattern] Selected pattern: ${agent.chartPattern} (${agent.chartMaxTrades} trades)`
        );
    }

    // Update phase (0 → 1 over the life of this pattern)
    agent.chartPhase = agent.chartTrades / agent.chartMaxTrades;

    const multiplier   = getPatternMultiplier(agent.chartPattern, agent.chartPhase, entropy);
    const tokenBalance = await agent._getTokenBalance();

    // FIX 1: was `multiplier > 1.0` — bot was buying peaks and selling dips.
    // Correct: buy when multiplier is LOW (dip = accumulation zone),
    //          sell when multiplier is HIGH (peak = distribution zone).
    const shouldBuy = multiplier < 1.0 || tokenBalance < 0.01;

    if (shouldBuy) {
        // Buy with pattern-adjusted amount (larger buys at deeper dips)
        const baseAmount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        const dipStrength = Math.max(0, 1.0 - multiplier); // 0 at par, larger at deeper dips
        const amount = parseFloat((baseAmount * (1 + dipStrength * 0.5)).toFixed(6));

        agent.chartTrades++;
        return { type: 'BUY', amount };
    } else {
        // FIX 2: sell portions scale with peak strength
        // Old: fixed entropy.getRandomFloat(0.1, 0.3) regardless of peak height
        // New: stronger peaks → larger sells (more realistic profit-taking)
        if (tokenBalance > 0) {
            const peakStrength = Math.min(Math.max(multiplier - 1.0, 0) / 1.0, 1.0); // 0–1
            const minSell      = 0.10 + peakStrength * 0.10; // 10–20%
            const maxSell      = 0.25 + peakStrength * 0.25; // 25–50%
            const sellPortion  = entropy.getRandomFloat(minSell, maxSell);
            const amount       = tokenBalance * sellPortion;

            agent.chartTrades++;
            return { type: 'SELL', amount };
        }
    }

    // Reset pattern when complete
    if (agent.chartTrades >= agent.chartMaxTrades) {
        agent.logger.info(
            `[ChartPattern] Pattern ${agent.chartPattern} complete, selecting new pattern`
        );
        agent.chartPattern = null;
    }

    return { type: 'WAIT' };
}

export default { decideAction, PATTERNS };
