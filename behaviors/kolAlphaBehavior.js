/**
 * behaviors/kolAlphaBehavior.js
 *
 * KOL (Key Opinion Leader) Alpha strategy behavior
 * Simulates KOL calls with coordinated whale and swarm activity
 *
 * FIXES APPLIED:
 *   Previously every agent ran its own independent phase state machine.
 *   A swarm agent could be in SWARM_EXIT while the whale agent was still
 *   in SETUP — the KOL narrative never executed correctly.
 *
 *   Fix: a shared coordinator object is stored on agent.strategyConfig
 *   (a reference all agents on the same strategy share). Whale agents
 *   write flags; swarm agents read them. Phases are now truly coordinated.
 *
 *   - coord.swarmCanEnter  : set true when whale completes a buy
 *   - coord.swarmShouldExit: set true when whale starts selling
 *   - Each flag is cleared at the end of the cycle so it can repeat
 */

const KOL_PHASES = {
    SETUP:       'setup',
    WHALE_BUY:   'whale_buy',
    SWARM_BUILD: 'swarm_build',
    WHALE_SELL:  'whale_sell',
    SWARM_EXIT:  'swarm_exit'
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
        agent.kolInitialized    = true;
        agent.kolPhase          = KOL_PHASES.SETUP;
        agent.kolTrades         = 0;
        agent.kolIsWhale        = entropy.getRandomBoolean(0.2); // 20% are whales
        agent.kolWhaleThreshold = agent.maxBuyAmount * 3;

        // FIX: create shared coordinator on first agent; all agents on the same
        // strategy receive the same strategyConfig object reference so mutations
        // are immediately visible to every other agent.
        if (!agent.strategyConfig._kolCoordinator) {
            agent.strategyConfig._kolCoordinator = {
                swarmCanEnter:   false, // opened by whale after buying
                swarmShouldExit: false  // opened by whale when selling
            };
        }
        agent.kolCoordinator = agent.strategyConfig._kolCoordinator;

        agent.logger.info(`[KOLAlpha] ${agent.kolIsWhale ? '🐋 Whale' : '🐜 Swarm'} role assigned`);
    }

    const tokenBalance = await agent._getTokenBalance();

    if (agent.kolIsWhale) {
        return handleWhale(agent, entropy, tokenBalance);
    } else {
        return handleSwarm(agent, entropy, tokenBalance);
    }
}

function handleWhale(agent, entropy, tokenBalance) {
    const coord = agent.kolCoordinator;

    switch (agent.kolPhase) {
        case KOL_PHASES.SETUP: {
            const amount = entropy.getRandomFloat(agent.maxBuyAmount, agent.maxBuyAmount * 3);
            agent.kolTrades++;
            agent.kolPhase = KOL_PHASES.WHALE_BUY;
            return { type: 'BUY', amount: parseFloat(amount.toFixed(6)) };
        }

        case KOL_PHASES.WHALE_BUY: {
            const amount = entropy.getRandomFloat(agent.maxBuyAmount, agent.maxBuyAmount * 2);
            agent.kolTrades++;

            // Signal swarm: you can enter now
            coord.swarmCanEnter = true;

            if (entropy.getRandomBoolean(0.4)) {
                agent.kolPhase = KOL_PHASES.WHALE_SELL;
            }
            return { type: 'BUY', amount: parseFloat(amount.toFixed(6)) };
        }

        case KOL_PHASES.WHALE_SELL: {
            if (tokenBalance > 0.1) {
                const sellPortion = entropy.getRandomFloat(0.5, 0.8);
                agent.kolTrades++;

                // Signal swarm: start exiting
                coord.swarmShouldExit = true;

                // Reset cycle
                agent.kolPhase      = KOL_PHASES.SETUP;
                coord.swarmCanEnter = false; // clear for next cycle

                return { type: 'SELL', amount: tokenBalance * sellPortion };
            }
            return { type: 'WAIT' };
        }

        default:
            return { type: 'WAIT' };
    }
}

function handleSwarm(agent, entropy, tokenBalance) {
    const coord = agent.kolCoordinator;

    // Wait for whale to signal entry is open
    if (!coord.swarmCanEnter) {
        // Small test buy while waiting (optional — looks organic)
        if (entropy.getRandomBoolean(0.1)) {
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.minBuyAmount * 1.5);
            agent.kolTrades++;
            return { type: 'BUY', amount };
        }
        return { type: 'WAIT' };
    }

    // Whale signalled exit — swarm should sell
    if (coord.swarmShouldExit) {
        if (tokenBalance > 0.01) {
            const sellPortion = entropy.getRandomFloat(0.6, 0.9);
            agent.kolTrades++;
            // Each swarm agent clears its own exit flag so it only sells once per cycle
            coord.swarmShouldExit = false;
            return { type: 'SELL', amount: tokenBalance * sellPortion };
        }
        return { type: 'WAIT' };
    }

    // Normal swarm build phase — follow the KOL call
    const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
    agent.kolTrades++;
    return { type: 'BUY', amount: parseFloat(amount.toFixed(6)) };
}

export default { decideAction, KOL_PHASES };
