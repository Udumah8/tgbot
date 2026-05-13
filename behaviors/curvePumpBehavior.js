/**
 * behaviors/curvePumpBehavior.js
 *
 * IMPROVED Curve Pump Strategy — Real On-Chain Bonding Curve Awareness
 *
 * Uses solana-trade's trader.price() to read the actual bondingCurvePercent
 * from the blockchain before every decision cycle. The bot knows exactly
 * where the curve stands and adjusts its behavior accordingly.
 *
 * Phases are now DRIVEN BY REAL CURVE DATA, not internal trade counters.
 *
 * Dependencies: solana-trade (npm install solana-trade)
 */

import { SolanaTrade } from 'solana-trade';

// ─────────────────────────────────────────────
// Phase definitions — determined by live curve %
// ─────────────────────────────────────────────
const CURVE_PHASES = {
    RAMP_UP:     'ramp_up',      // 0%  → 25%   — slow, quiet accumulation
    SUSTAIN:     'sustain',      // 25% → 55%   — steady pressure
    ACCELERATE:  'accelerate',   // 55% → 80%   — aggressive push to graduation
    NEAR_GRAD:   'near_grad',    // 80% → 95%   — final sprint, maximum buys
    GRADUATED:   'graduated',    // 95%+         — curve complete, stop buying
};

// How much of the buy range to use per phase (0 = minBuyAmount, 1 = maxBuyAmount)
const PHASE_BUY_SCALE = {
    [CURVE_PHASES.RAMP_UP]:    0.30,  // 30% of range
    [CURVE_PHASES.SUSTAIN]:    0.55,  // 55% of range
    [CURVE_PHASES.ACCELERATE]: 0.85,  // 85% of range
    [CURVE_PHASES.NEAR_GRAD]:  1.00,  // 100% — max buy amount
    [CURVE_PHASES.GRADUATED]:  0,     // No buys
};

// Sell probability per phase (chance to take partial profit per cycle)
const PHASE_SELL_PROB = {
    [CURVE_PHASES.RAMP_UP]:    0.00,  // Never sell while ramping
    [CURVE_PHASES.SUSTAIN]:    0.03,  // 3% chance — very rare profit take
    [CURVE_PHASES.ACCELERATE]: 0.10,  // 10% — occasional trim
    [CURVE_PHASES.NEAR_GRAD]:  0.00,  // Don't sell — push to graduation
    [CURVE_PHASES.GRADUATED]:  1.00,  // Always exit on graduation
};

// Sell portion when a sell is triggered (fraction of token balance)
const PHASE_SELL_PORTION = {
    [CURVE_PHASES.RAMP_UP]:    0,
    [CURVE_PHASES.SUSTAIN]:    [0.10, 0.20],  // Trim 10-20%
    [CURVE_PHASES.ACCELERATE]: [0.20, 0.40],  // Trim 20-40%
    [CURVE_PHASES.NEAR_GRAD]:  0,
    [CURVE_PHASES.GRADUATED]:  [0.70, 1.00],  // Exit 70-100%
};

// How long (ms) to cache the curve % before re-fetching
const CURVE_CACHE_TTL_MS = 12000; // 12 seconds — avoids hammering RPC

// ─────────────────────────────────────────────
// Shared curve cache (across all agents on the same token)
// ─────────────────────────────────────────────
const curveCache = new Map();
// key: `${market}:${mint}`  →  { percent, fetchedAt }

/**
 * Validate market and mint configuration before attempting API calls
 * @param {string} market - Market identifier
 * @param {string} mint - Token mint address
 * @returns {{ valid: boolean, error?: string }}
 */
function validateMarketMintConfig(market, mint) {
    // Valid markets that support bonding curves
    const BONDING_CURVE_MARKETS = [
        'PUMP_FUN',
        'PUMP_SWAP',
        'METEORA_DBC',
        'RAYDIUM_LAUNCHPAD',
        'MOONIT',
        'HEAVEN',
        'SUGAR',
        'BOOP_FUN'
    ];

    if (!market) {
        return { valid: false, error: 'Market is undefined or empty' };
    }

    if (!mint) {
        return { valid: false, error: 'Mint address is undefined or empty' };
    }

    // Check if market supports bonding curves
    if (!BONDING_CURVE_MARKETS.includes(market)) {
        return { 
            valid: false, 
            error: `Market '${market}' does not support bonding curves. Valid markets: ${BONDING_CURVE_MARKETS.join(', ')}` 
        };
    }

    // Basic mint address validation (should be base58 and ~44 chars)
    if (typeof mint !== 'string' || mint.length < 32 || mint.length > 44) {
        return { valid: false, error: `Invalid mint address format: ${mint}` };
    }

    return { valid: true };
}

/**
 * Fetch the live bonding curve completion % using solana-trade.
 * Results are cached per (market, mint) for CURVE_CACHE_TTL_MS.
 *
 * @param {string} market  - e.g. 'PUMP_FUN' or 'METEORA_DBC'
 * @param {string} mint    - token mint address
 * @param {string} rpcUrl  - Solana RPC endpoint
 * @param {Object} logger  - Logger instance (optional)
 * @returns {Promise<{ percent: number, price: number }>}
 */
async function fetchCurveState(market, mint, rpcUrl, logger = console) {
    const cacheKey = `${market}:${mint}`;
    const cached = curveCache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < CURVE_CACHE_TTL_MS) {
        return { percent: cached.percent, price: cached.price };
    }

    // Validate configuration before making API call
    const validation = validateMarketMintConfig(market, mint);
    if (!validation.valid) {
        throw new Error(`Configuration error: ${validation.error}`);
    }

    // Retry logic with exponential backoff
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // solana-trade's price() returns { price, bondingCurvePercent }
            // bondingCurvePercent is null for non-bonding-curve markets
            const trader = new SolanaTrade(rpcUrl);
            const result = await trader.price({
                market,
                mint,
                unit: 'SOL',
            });

            const percent = result.bondingCurvePercent ?? 0; // null → 0 for safety
            const price   = result.price ?? 0;

            curveCache.set(cacheKey, { percent, price, fetchedAt: Date.now() });
            return { percent, price };

        } catch (err) {
            lastError = err;
            
            // Log detailed error information
            if (logger && logger.error) {
                logger.error(`[CurvePump] Fetch attempt ${attempt + 1}/${maxRetries} failed:`, {
                    error: err.message,
                    stack: err.stack,
                    market,
                    mint: mint.slice(0, 8) + '...',
                    rpcUrl: rpcUrl.slice(0, 30) + '...'
                });
            }

            // Check if error is retryable
            const isRetryable = err.message?.toLowerCase().includes('429') ||
                               err.message?.toLowerCase().includes('timeout') ||
                               err.message?.toLowerCase().includes('network') ||
                               err.message?.toLowerCase().includes('rate limit');

            // Don't retry on assertion failures or invalid config
            if (err.message?.toLowerCase().includes('assertion') ||
                err.message?.toLowerCase().includes('invalid') ||
                err.message?.toLowerCase().includes('not found')) {
                throw new Error(`Non-retryable error: ${err.message}. Check if token ${mint.slice(0, 8)}... exists on ${market} market.`);
            }

            // If retryable and not last attempt, wait with exponential backoff
            if (isRetryable && attempt < maxRetries - 1) {
                const backoffMs = 1000 * Math.pow(2, attempt);
                if (logger && logger.warn) {
                    logger.warn(`[CurvePump] Retrying after ${backoffMs}ms...`);
                }
                await new Promise(resolve => setTimeout(resolve, backoffMs));
                continue;
            }

            // Last attempt or non-retryable
            if (attempt === maxRetries - 1) {
                throw lastError;
            }
        }
    }

    throw lastError || new Error('Failed to fetch curve state after retries');
}

/**
 * Map a live curve % to a phase name.
 *
 * @param {number} curvePercent - 0 to 100
 * @returns {string} phase key
 */
function getPhaseFromCurve(curvePercent) {
    if (curvePercent >= 95) return CURVE_PHASES.GRADUATED;
    if (curvePercent >= 80) return CURVE_PHASES.NEAR_GRAD;
    if (curvePercent >= 55) return CURVE_PHASES.ACCELERATE;
    if (curvePercent >= 25) return CURVE_PHASES.SUSTAIN;
    return CURVE_PHASES.RAMP_UP;
}

/**
 * Calculate the buy amount for this agent in this cycle.
 * Uses phase scale + agent's personal intensity + entropy jitter.
 *
 * @param {Object} agent
 * @param {Object} entropy
 * @param {string} phase
 * @returns {number} SOL amount
 */
function calcBuyAmount(agent, entropy, phase) {
    const scale = PHASE_BUY_SCALE[phase];
    const range = agent.maxBuyAmount - agent.minBuyAmount;
    const base  = agent.minBuyAmount + range * scale;

    // Per-agent intensity: set once at init, re-rolled after graduation cycle
    const intensified = base * agent.curveIntensity;

    // Small entropy jitter ±15%
    const jitter = entropy.getRandomFloat(0.85, 1.15);

    return parseFloat((intensified * jitter).toFixed(6));
}

// ─────────────────────────────────────────────
// Main entry point — called by agent executor
// ─────────────────────────────────────────────

/**
 * Decide next action for the curve pump strategy.
 * Reads live on-chain bonding curve state via solana-trade and drives
 * phase transitions from real data instead of internal counters.
 *
 * @param {WalletAgent} agent
 * @returns {Promise<{ type: 'BUY'|'SELL'|'WAIT', amount?: number }>}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;

    // ── One-time agent initialisation ─────────────────────
    if (!agent.curveInitialized) {
        agent.curveInitialized  = true;
        agent.curvePhase        = CURVE_PHASES.RAMP_UP;
        agent.curveIntensity    = entropy.getRandomFloat(0.7, 1.4);
        agent.lastCurvePercent  = 0;
        agent.cyclesInPhase     = 0;
        agent.totalBuysSol      = 0;
        agent.curveConfigValidated = false; // Flag for one-time config validation

        agent.logger.info(
            `[CurvePump] Init — intensity: ${agent.curveIntensity.toFixed(2)}, ` +
            `target: ${agent.strategyConfig?.curveTargetPercent ?? agent.curveTargetPercent ?? 80}%`
        );
    }

    // ── Fetch real curve state ────────────────────────────
    let curvePercent = agent.lastCurvePercent;
    let currentPrice = 0;

    try {
        // Get configuration from agent's strategyConfig
        const market  = agent.strategyConfig?.targetDex || agent.targetDex || 'PUMP_FUN';
        const mint    = agent.tokenMint;
        const rpcUrl  = agent.strategyConfig?.rpcUrl || agent.rpcUrl || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

        // Validate configuration on first fetch
        if (!agent.curveConfigValidated) {
            agent.logger.info(`[CurvePump] Validating configuration - Market: ${market}, Mint: ${mint.slice(0, 8)}...`);
            
            const validation = validateMarketMintConfig(market, mint);
            if (!validation.valid) {
                agent.logger.error(`[CurvePump] ❌ Configuration validation failed: ${validation.error}`);
                throw new Error(validation.error);
            }
            
            agent.logger.info(`[CurvePump] ✅ Configuration validated successfully`);
            agent.curveConfigValidated = true;
        }

        const state   = await fetchCurveState(market, mint, rpcUrl, agent.logger);
        curvePercent  = state.percent;
        currentPrice  = state.price;

        // Detect meaningful progress and log it
        const delta = curvePercent - agent.lastCurvePercent;
        if (delta >= 1) {
            agent.logger.info(
                `[CurvePump] Curve: ${agent.lastCurvePercent.toFixed(1)}% → ` +
                `${curvePercent.toFixed(1)}% (+${delta.toFixed(1)}%) | ` +
                `Price: ${currentPrice.toFixed(8)} SOL`
            );
        }
        agent.lastCurvePercent = curvePercent;

    } catch (err) {
        // Log detailed error information
        agent.logger.error(`[CurvePump] Failed to fetch curve state:`, {
            error: err.message,
            market: agent.strategyConfig?.targetDex || agent.targetDex || 'PUMP_FUN',
            mint: agent.tokenMint?.slice(0, 8) + '...',
            lastKnownPercent: curvePercent.toFixed(1) + '%'
        });
        
        // If this is a configuration error, pause the agent
        if (err.message?.includes('Configuration error') || 
            err.message?.includes('does not support bonding curves') ||
            err.message?.includes('Invalid mint address')) {
            agent.logger.error(`[CurvePump] ❌ Fatal configuration error - agent cannot continue`);
            throw err; // Propagate to pause the agent
        }
        
        // Otherwise, use cached value and continue
        agent.logger.warn(`[CurvePump] Using cached ${curvePercent.toFixed(1)}% - will retry next cycle`);
    }

    // ── Check hard target ─────────────────────────────────
    const targetPercent = agent.strategyConfig?.curveTargetPercent ?? agent.curveTargetPercent ?? 80;
    if (curvePercent >= targetPercent) {
        agent.logger.info(`[CurvePump] ✅ Target ${targetPercent}% reached (current: ${curvePercent.toFixed(1)}%). Switching to exit.`);
        return handleGraduated(agent, entropy);
    }

    // ── Map real curve % → phase ──────────────────────────
    const newPhase = getPhaseFromCurve(curvePercent);
    if (newPhase !== agent.curvePhase) {
        agent.logger.info(`[CurvePump] Phase: ${agent.curvePhase} → ${newPhase} (curve at ${curvePercent.toFixed(1)}%)`);
        agent.curvePhase   = newPhase;
        agent.cyclesInPhase = 0;
    }
    agent.cyclesInPhase++;

    // ── Dispatch to phase handler ─────────────────────────
    switch (agent.curvePhase) {
        case CURVE_PHASES.RAMP_UP:    return handleRampUp(agent, entropy, curvePercent);
        case CURVE_PHASES.SUSTAIN:    return handleSustain(agent, entropy, curvePercent);
        case CURVE_PHASES.ACCELERATE: return handleAccelerate(agent, entropy, curvePercent);
        case CURVE_PHASES.NEAR_GRAD:  return handleNearGrad(agent, entropy, curvePercent);
        case CURVE_PHASES.GRADUATED:  return handleGraduated(agent, entropy);
        default:                      return { type: 'WAIT' };
    }
}

// ─────────────────────────────────────────────
// Phase handlers
// ─────────────────────────────────────────────

/**
 * RAMP_UP (0% → 25%)
 * Slow, quiet accumulation. Never sells.
 * Adds random "not-yet-convinced" delays to look organic.
 */
function handleRampUp(agent, entropy, curvePercent) {
    // 10% chance to skip this cycle (simulates hesitant retail buyer)
    if (entropy.getRandomFloat(0, 1) < 0.10) {
        agent.logger.info(`[CurvePump][RAMP_UP] Skipping cycle — simulating hesitation`);
        return { type: 'WAIT' };
    }

    const amount = calcBuyAmount(agent, entropy, CURVE_PHASES.RAMP_UP);
    agent.totalBuysSol += amount;

    agent.logger.info(
        `[CurvePump][RAMP_UP] BUY ${amount.toFixed(4)} SOL | ` +
        `curve: ${curvePercent.toFixed(1)}% | total spent: ${agent.totalBuysSol.toFixed(4)} SOL`
    );

    return { type: 'BUY', amount };
}

/**
 * SUSTAIN (25% → 55%)
 * Steady pressure. Rare profit-taking (3%) to add sell-side realism.
 */
async function handleSustain(agent, entropy, curvePercent) {
    const tokenBalance = await agent._getTokenBalance();

    // Rare trim — adds realism, doesn't hurt curve progress much
    if (
        entropy.getRandomFloat(0, 1) < PHASE_SELL_PROB[CURVE_PHASES.SUSTAIN] &&
        tokenBalance > 0.05
    ) {
        const [minP, maxP] = PHASE_SELL_PORTION[CURVE_PHASES.SUSTAIN];
        const portion = entropy.getRandomFloat(minP, maxP);
        const amount  = tokenBalance * portion;

        agent.logger.info(
            `[CurvePump][SUSTAIN] SELL ${(portion * 100).toFixed(0)}% (${amount.toFixed(4)} tokens) — small trim`
        );
        return { type: 'SELL', amount };
    }

    const amount = calcBuyAmount(agent, entropy, CURVE_PHASES.SUSTAIN);
    agent.totalBuysSol += amount;

    agent.logger.info(
        `[CurvePump][SUSTAIN] BUY ${amount.toFixed(4)} SOL | curve: ${curvePercent.toFixed(1)}%`
    );
    return { type: 'BUY', amount };
}

/**
 * ACCELERATE (55% → 80%)
 * Aggressive buys. 10% chance of partial trim per cycle.
 * Larger amounts — this is where the curve really moves.
 */
async function handleAccelerate(agent, entropy, curvePercent) {
    const tokenBalance = await agent._getTokenBalance();

    // Occasional profit-take during aggressive phase
    if (
        entropy.getRandomFloat(0, 1) < PHASE_SELL_PROB[CURVE_PHASES.ACCELERATE] &&
        tokenBalance > 0.05
    ) {
        const [minP, maxP] = PHASE_SELL_PORTION[CURVE_PHASES.ACCELERATE];
        const portion = entropy.getRandomFloat(minP, maxP);
        const amount  = tokenBalance * portion;

        agent.logger.info(
            `[CurvePump][ACCELERATE] SELL ${(portion * 100).toFixed(0)}% (${amount.toFixed(4)} tokens) — profit trim`
        );
        return { type: 'SELL', amount };
    }

    const amount = calcBuyAmount(agent, entropy, CURVE_PHASES.ACCELERATE);
    agent.totalBuysSol += amount;

    agent.logger.info(
        `[CurvePump][ACCELERATE] BUY ${amount.toFixed(4)} SOL | ` +
        `curve: ${curvePercent.toFixed(1)}% | ${(80 - curvePercent).toFixed(1)}% to near-grad`
    );
    return { type: 'BUY', amount };
}

/**
 * NEAR_GRAD (80% → 95%)
 * Final sprint. Maximum buy amounts every cycle. Never sells.
 * The bot is fully committed to pushing graduation.
 */
function handleNearGrad(agent, entropy, curvePercent) {
    const amount = calcBuyAmount(agent, entropy, CURVE_PHASES.NEAR_GRAD);
    agent.totalBuysSol += amount;

    const remaining = (95 - curvePercent).toFixed(1);
    agent.logger.info(
        `[CurvePump][NEAR_GRAD] 🚀 BUY ${amount.toFixed(4)} SOL | ` +
        `curve: ${curvePercent.toFixed(1)}% | ${remaining}% to graduation`
    );
    return { type: 'BUY', amount };
}

/**
 * GRADUATED (95%+) or target reached.
 * Exit accumulated position. Reset agent for next cycle with new intensity.
 */
async function handleGraduated(agent, entropy) {
    const tokenBalance = await agent._getTokenBalance();

    if (tokenBalance > 0.01) {
        const [minP, maxP] = PHASE_SELL_PORTION[CURVE_PHASES.GRADUATED];
        const portion = entropy.getRandomFloat(minP, maxP);
        const amount  = tokenBalance * portion;

        agent.logger.info(
            `[CurvePump][GRADUATED] 🎓 SELL ${(portion * 100).toFixed(0)}% (${amount.toFixed(4)} tokens) | ` +
            `Total SOL spent this cycle: ${agent.totalBuysSol.toFixed(4)}`
        );

        // If almost fully exited, reset for next pump cycle
        if (tokenBalance * (1 - portion) < 0.01) {
            agent.curvePhase     = CURVE_PHASES.RAMP_UP;
            agent.cyclesInPhase  = 0;
            agent.totalBuysSol   = 0;
            agent.curveIntensity = entropy.getRandomFloat(0.7, 1.4); // New random intensity
            agent.logger.info(`[CurvePump] 🔄 Cycle reset — new intensity: ${agent.curveIntensity.toFixed(2)}`);
        }

        return { type: 'SELL', amount };
    }

    // No tokens to sell — just wait
    return { type: 'WAIT' };
}

// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────
export default { 
    decideAction, 
    CURVE_PHASES, 
    fetchCurveState, 
    getPhaseFromCurve,
    validateMarketMintConfig 
};
