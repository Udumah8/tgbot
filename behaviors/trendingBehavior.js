/**
 * behaviors/trendingBehavior.js
 *
 * Trending/Viral strategy behavior - follows viral patterns
 * Simulates viral growth and trending activity
 *
 * FIXES APPLIED:
 *   1. handleViralPump: agent.tradingMomentum → agent.trendingMomentum (was undefined → NaN amounts)
 *   2. handleLiquidityLadder: agent.tradingTrades++ → agent.trendingTrades++
 *   3. handleWashTrading: agent.tradingTrades++ → agent.trendingTrades++
 */

const TRENDING_MODES = [
    'viral_pump',
    'organic_growth',
    'fomo_wave',
    'liquidity_ladder',
    'wash_trading'
];

/**
 * Decide next action for trending strategy
 * @param {WalletAgent} agent - The wallet agent
 * @returns {Object} Action object {type, amount}
 */
async function decideAction(agent) {
    const entropy = agent.entropy;

    // Initialize trending state
    if (!agent.trendingInitialized) {
        agent.trendingInitialized = true;
        agent.trendingMode = entropy.pickRandom(TRENDING_MODES);
        agent.trendingTrades = 0;
        agent.trendingMomentum = 0;

        agent.logger.info(`[Trending] Mode: ${agent.trendingMode}`);
    }

    const tokenBalance = await agent._getTokenBalance();

    // Delegate to mode-specific handler
    switch (agent.trendingMode) {
        case 'viral_pump':
            return handleViralPump(agent, entropy, tokenBalance);
        case 'organic_growth':
            return handleOrganicGrowth(agent, entropy, tokenBalance);
        case 'fomo_wave':
            return handleFomoWave(agent, entropy, tokenBalance);
        case 'liquidity_ladder':
            return handleLiquidityLadder(agent, entropy, tokenBalance);
        case 'wash_trading':
            return handleWashTrading(agent, entropy, tokenBalance);
        default:
            return { type: 'WAIT' };
    }
}

function handleViralPump(agent, entropy, tokenBalance) {
    // Viral pump: exponential buying
    agent.trendingMomentum = Math.min(agent.trendingMomentum + 0.1, 2.0);

    // FIX 1: was agent.tradingMomentum (undefined) → always produced NaN amounts
    const baseAmount = agent.maxBuyAmount * (1 + agent.trendingMomentum);
    const amount = entropy.getRandomFloat(agent.minBuyAmount, baseAmount);

    agent.trendingTrades++;

    // Occasional dumps during pump
    if (entropy.getRandomBoolean(0.1) && tokenBalance > 0.01) {
        const sellPortion = entropy.getRandomFloat(0.3, 0.6);
        return { type: 'SELL', amount: tokenBalance * sellPortion };
    }

    return { type: 'BUY', amount };
}

function handleOrganicGrowth(agent, entropy, tokenBalance) {
    // Organic growth: steady, consistent buys
    const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);

    agent.trendingTrades++;

    // Occasional larger buy
    if (entropy.getRandomBoolean(0.15)) {
        const largerAmount = amount * entropy.getRandomFloat(1.5, 3.0);
        return { type: 'BUY', amount: largerAmount };
    }

    return { type: 'BUY', amount };
}

function handleFomoWave(agent, entropy, tokenBalance) {
    // FOMO wave: bursts of buying
    const burstChance = entropy.getRandomBoolean(0.3); // 30% burst chance

    if (burstChance) {
        // Burst buy
        const amount = agent.maxBuyAmount * entropy.getRandomFloat(1.5, 2.5);
        agent.trendingTrades++;
        return { type: 'BUY', amount };
    }

    // Small buy
    if (tokenBalance < 0.01) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        agent.trendingTrades++;
        return { type: 'BUY', amount };
    }

    return { type: 'WAIT' };
}

function handleLiquidityLadder(agent, entropy, tokenBalance) {
    // Liquidity ladder: buy at increasing prices
    if (!agent.ladderStep) agent.ladderStep = 0;
    if (!agent.ladderBase) agent.ladderBase = agent.minBuyAmount;

    const amount = agent.ladderBase * (1 + agent.ladderStep * 0.1);

    // FIX 2: was agent.tradingTrades++ (never declared)
    agent.trendingTrades++;

    // Move up ladder
    if (entropy.getRandomBoolean(0.4)) {
        agent.ladderStep++;
    }

    // Reset occasionally
    if (agent.ladderStep > 10 || entropy.getRandomBoolean(0.1)) {
        agent.ladderStep = 0;
    }

    return { type: 'BUY', amount };
}

function handleWashTrading(agent, entropy, tokenBalance) {
    // Wash trading: buy and sell back and forth
    const shouldBuy = entropy.getRandomBoolean(0.5);

    // FIX 3: was agent.tradingTrades++ (never declared)
    agent.trendingTrades++;

    if (shouldBuy) {
        const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
        return { type: 'BUY', amount };
    } else {
        if (tokenBalance > 0) {
            const sellPortion = entropy.getRandomFloat(0.4, 0.8);
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        } else {
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            return { type: 'BUY', amount };
        }
    }
}

export default { decideAction, TRENDING_MODES };
