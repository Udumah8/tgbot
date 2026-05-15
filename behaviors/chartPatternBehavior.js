/**
 * behaviors/chartPatternBehavior.js
 *
 * Chart pattern strategy behavior for agent-based execution
 * Creates specific chart patterns (cup & handle, ascending triangle, etc.)
 *
 * STRATEGY:
 *   - Multiplier < 1.0 = DIP phase (accumulation zone) → BUY
 *   - Multiplier > 1.0 = PEAK phase (distribution zone) → SELL
 *   - Buy amounts scale with dip depth (deeper dips = larger buys)
 *   - Sell amounts scale with peak strength (higher peaks = larger sells)
 *
 * AUDIT FIXES (v3 - FINAL):
 *   - Added input validation for agent properties
 *   - Added error handling for async operations
 *   - Fixed potential negative multiplier values
 *   - Fixed pattern reset logic and flow control
 *   - Added safety checks for division by zero
 *   - Improved logging and error messages
 *   - CRITICAL: Fixed buy amount exceeding maxBuyAmount constraint
 *   - Added minimum sell amount check to prevent dust transactions
 *   - Enhanced logging with dipStrength and peakStrength metrics
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
 * @returns {number} Volume multiplier (always >= 0.1 to prevent negative values)
 */
function getPatternMultiplier(pattern, phase, entropy) {
    const noise = entropy.getRandomFloat(0.9, 1.1);
    let multiplier = 1.0;

    switch (pattern) {
        case 'cup_and_handle':
            // U-shaped dip then small consolidation
            if (phase < 0.4) {
                multiplier = 1.0 - phase * 1.5;           // Dip (goes to 0.4)
            } else if (phase < 0.7) {
                multiplier = 0.4 + (phase - 0.4) * 2;     // Recovery (0.4 → 1.0)
            } else {
                multiplier = 1.0 - (phase - 0.7) * 0.5;   // Handle (1.0 → 0.85)
            }
            break;

        case 'ascending_triangle':
            // Higher lows, flat highs
            multiplier = 0.5 + phase * 0.5 + Math.sin(phase * Math.PI * 4) * 0.2;
            break;

        case 'bull_flag':
            // Sharp rise then consolidation
            if (phase < 0.3) {
                multiplier = 1.0 + phase * 2;             // Pole (1.0 → 1.6)
            } else {
                multiplier = 1.6 - (phase - 0.3) * 0.3;   // Flag (1.6 → 1.39)
            }
            break;

        case 'double_bottom':
            // Two distinct lows
            if (phase < 0.25) {
                multiplier = 1.0 - phase * 2;             // First dip (1.0 → 0.5)
            } else if (phase < 0.50) {
                multiplier = 0.5 + (phase - 0.25) * 2;    // Recovery (0.5 → 1.0)
            } else if (phase < 0.75) {
                multiplier = 1.0 - (phase - 0.5) * 2;     // Second dip (1.0 → 0.5)
            } else {
                multiplier = 0.5 + (phase - 0.75) * 2;    // Final recovery (0.5 → 1.0)
            }
            break;

        case 'inverse_head_shoulders':
            // Left shoulder, head (lowest), right shoulder, breakout
            if (phase < 0.2) {
                multiplier = 1.0 - phase * 2;             // Left shoulder (1.0 → 0.6)
            } else if (phase < 0.4) {
                multiplier = 0.6 - (phase - 0.2) * 1.5;   // Head (0.6 → 0.3)
            } else if (phase < 0.6) {
                multiplier = 0.3 + (phase - 0.4) * 1.5;   // Recovery (0.3 → 0.6)
            } else if (phase < 0.8) {
                multiplier = 0.6 - (phase - 0.6) * 1;     // Right shoulder (0.6 → 0.4)
            } else {
                multiplier = 0.4 + (phase - 0.8) * 3;     // Breakout (0.4 → 1.0)
            }
            break;

        case 'rising_wedge':
            multiplier = 0.8 + phase * 0.4 - Math.abs(Math.sin(phase * Math.PI * 3)) * (0.3 - phase * 0.2);
            break;

        case 'symmetrical_triangle':
            multiplier = 1.0 - Math.abs(Math.sin(phase * Math.PI * 3)) * (0.5 - phase * 0.4);
            break;

        case 'rounding_bottom':
            // Smooth U-shape (0.5 at phase=0.5, 1.0 at edges)
            multiplier = 0.5 + 0.5 * Math.cos(phase * Math.PI);
            break;

        case 'falling_wedge':
            multiplier = 1.2 - phase * 0.6 - Math.abs(Math.sin(phase * Math.PI * 3)) * (0.3 - phase * 0.2);
            break;

        case 'pennant':
            // Sharp move then tight consolidation
            if (phase < 0.2) {
                multiplier = 1.0 + phase * 3;             // Sharp move (1.0 → 1.6)
            } else {
                multiplier = 1.6 - Math.abs(Math.sin((phase - 0.2) * Math.PI * 5)) * (0.4 - (phase - 0.2) * 0.3);
            }
            break;

        case 'rectangle':
            // Horizontal consolidation
            multiplier = 1.0 + Math.sin(phase * Math.PI * 4) * 0.2;
            break;

        case 'triple_bottom':
            // Three distinct lows
            if (phase < 0.15) {
                multiplier = 1.0 - phase * 3;             // First dip (1.0 → 0.55)
            } else if (phase < 0.30) {
                multiplier = 0.55 + (phase - 0.15) * 3;   // Recovery (0.55 → 1.0)
            } else if (phase < 0.45) {
                multiplier = 1.0 - (phase - 0.3) * 3;     // Second dip (1.0 → 0.55)
            } else if (phase < 0.60) {
                multiplier = 0.55 + (phase - 0.45) * 3;   // Recovery (0.55 → 1.0)
            } else if (phase < 0.75) {
                multiplier = 1.0 - (phase - 0.6) * 3;     // Third dip (1.0 → 0.55)
            } else {
                multiplier = 0.55 + (phase - 0.75) * 1.8; // Final recovery (0.55 → 1.0)
            }
            break;

        default:
            multiplier = 1.0;
    }

    // Apply noise and ensure non-negative result
    const result = multiplier * noise;
    return Math.max(0.1, result); // Minimum 0.1 to prevent negative or zero values
}

/**
 * Decide next action for chart pattern strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    try {
        // Validate agent has required properties
        if (!agent.entropy) {
            throw new Error('[ChartPattern] Agent missing entropy engine');
        }
        if (!agent.logger) {
            throw new Error('[ChartPattern] Agent missing logger');
        }
        if (typeof agent.minBuyAmount !== 'number' || typeof agent.maxBuyAmount !== 'number') {
            throw new Error('[ChartPattern] Agent missing minBuyAmount or maxBuyAmount');
        }

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

        // Check if pattern is complete before processing
        if (agent.chartTrades >= agent.chartMaxTrades) {
            agent.logger.info(
                `[ChartPattern] Pattern ${agent.chartPattern} complete (${agent.chartTrades}/${agent.chartMaxTrades}), selecting new pattern`
            );
            // Reset for next pattern
            agent.chartPattern = null;
            agent.chartPhase = 0;
            agent.chartTrades = 0;
            return { type: 'WAIT' };
        }

        // Update phase (0 → 1 over the life of this pattern)
        // Safety check to prevent division by zero
        agent.chartPhase = agent.chartMaxTrades > 0 
            ? agent.chartTrades / agent.chartMaxTrades 
            : 0;

        const multiplier   = getPatternMultiplier(agent.chartPattern, agent.chartPhase, entropy);
        const tokenBalance = await agent._getTokenBalance();

        // STRATEGY: Buy during dips (multiplier < 1.0), sell during peaks (multiplier > 1.0)
        // Always buy if we have no tokens to avoid getting stuck
        const shouldBuy = multiplier < 1.0 || tokenBalance < 0.01;

        if (shouldBuy) {
            // Buy with pattern-adjusted amount (larger buys at deeper dips)
            const baseAmount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            const dipStrength = Math.max(0, 1.0 - multiplier); // 0 at par, larger at deeper dips
            const adjustedAmount = baseAmount * (1 + dipStrength * 0.5);
            // CRITICAL: Ensure we don't exceed maxBuyAmount even with dip adjustment
            const amount = parseFloat(Math.min(adjustedAmount, agent.maxBuyAmount).toFixed(6));

            agent.chartTrades++;
            agent.logger.debug(
                `[ChartPattern] BUY ${amount} (phase: ${agent.chartPhase.toFixed(2)}, ` +
                `multiplier: ${multiplier.toFixed(2)}, dipStrength: ${dipStrength.toFixed(2)}, ` +
                `trade: ${agent.chartTrades}/${agent.chartMaxTrades})`
            );
            return { type: 'BUY', amount };
        } else {
            // Sell during peaks - scale sell amount with peak strength
            if (tokenBalance > 0) {
                const peakStrength = Math.min(Math.max(multiplier - 1.0, 0) / 1.0, 1.0); // 0–1
                const minSell      = 0.10 + peakStrength * 0.10; // 10–20%
                const maxSell      = 0.25 + peakStrength * 0.25; // 25–50%
                const sellPortion  = entropy.getRandomFloat(minSell, maxSell);
                const rawAmount    = tokenBalance * sellPortion;
                const amount       = parseFloat(rawAmount.toFixed(6));

                // Check if amount is too small (dust) - avoid failed transactions
                if (amount < 0.000001) {
                    agent.logger.debug(
                        `[ChartPattern] WAIT (sell amount too small: ${amount}, phase: ${agent.chartPhase.toFixed(2)})`
                    );
                    return { type: 'WAIT' };
                }

                agent.chartTrades++;
                agent.logger.debug(
                    `[ChartPattern] SELL ${amount} (${(sellPortion * 100).toFixed(1)}% of balance, ` +
                    `phase: ${agent.chartPhase.toFixed(2)}, multiplier: ${multiplier.toFixed(2)}, ` +
                    `peakStrength: ${peakStrength.toFixed(2)}, trade: ${agent.chartTrades}/${agent.chartMaxTrades})`
                );
                return { type: 'SELL', amount };
            } else {
                // No tokens to sell, wait
                agent.logger.debug(
                    `[ChartPattern] WAIT (no tokens to sell, phase: ${agent.chartPhase.toFixed(2)})`
                );
                return { type: 'WAIT' };
            }
        }
    } catch (error) {
        // Log error and return WAIT to prevent crash
        if (agent.logger) {
            agent.logger.error(`[ChartPattern] Error in decideAction: ${error.message}`);
        } else {
            console.error(`[ChartPattern] Error in decideAction: ${error.message}`);
        }
        return { type: 'WAIT' };
    }
}

export default { decideAction, PATTERNS };
