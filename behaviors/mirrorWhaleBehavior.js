/**
 * behaviors/mirrorWhaleBehavior.js
 *
 * Mirror Whale strategy behavior - copies whale movements
 * Mirrors large wallet activity for fake momentum
 *
 * FIXES APPLIED:
 *   1. generateFakeWhale: the `nextAction` closure referenced `agent` which is
 *      not in scope of that standalone function — caused ReferenceError (or
 *      silent fallback via optional chaining) on every call, permanently
 *      breaking momentum-continuation logic.
 *      Fix: close over the whale object itself (`whale.lastAction`) instead of
 *      `agent.mirrorTargetWhale?.lastAction`.
 *   2. nextAction now updates `whale.lastAction` after each decision so
 *      momentum correctly persists across consecutive calls.
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
        agent.mirrorInitialized  = true;
        agent.mirrorTrades       = 0;
        agent.mirrorTargetWhale  = generateFakeWhale(entropy);
        agent.mirrorSyncChance   = entropy.getRandomFloat(0.3, 0.6);

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
        const amount = entropy.getRandomFloat(agent.maxBuyAmount, agent.maxBuyAmount * 2);

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
            // Need tokens first — small buy
            const amount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            agent.mirrorTrades++;
            return { type: 'BUY', amount };
        }
    }
}

/**
 * FIX: `nextAction` previously closed over `agent` (not in scope here).
 * Now closes over the local `whale` object so `lastAction` is always valid,
 * and updates it after each decision so momentum persists correctly.
 */
function generateFakeWhale(entropy) {
    const whale = {
        address:    generateRandomAddress(entropy),
        balance:    entropy.getRandomFloat(100, 1000), // SOL
        lastAction: entropy.getRandomBoolean(0.6) ? 'BUY' : 'SELL',

        nextAction: function(entropy) {
            // 60% chance to continue same direction (momentum)
            const continueSame = entropy.getRandomBoolean(0.6);
            const action = continueSame
                ? whale.lastAction                                   // ✅ closes over whale
                : (entropy.getRandomBoolean(0.5) ? 'BUY' : 'SELL');

            whale.lastAction = action; // ✅ update so next call gets correct history
            return action;
        }
    };
    return whale;
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
