/**
 * QUICK START INTEGRATION
 * 
 * Copy and paste these code snippets into volumebot.js to enable the behavioral ecosystem
 */

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Add import at the top of volumebot.js (after other imports)
// ═══════════════════════════════════════════════════════════════════════════════

import { 
    initializeBehavioralEcosystem, 
    shutdownBehavioralEcosystem, 
    updateActiveWalletCount,
    getEcosystemStats 
} from './behavioralIntegration.js';

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: Add to STATE object (around line 1000)
// ═══════════════════════════════════════════════════════════════════════════════

const STATE = {
    // ... existing config ...
    
    // 🧠 BEHAVIORAL ECOSYSTEM
    useBehavioralEcosystem: true,           // Enable behavioral ecosystem
    behavioralMutationRate: 0.01,           // DNA mutation rate (1%)
    behavioralHealthCheckInterval: 60000,   // Health check every minute
    behavioralAutoCorrect: true,            // Enable automatic corrections
};

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: Initialize ecosystem after logger setup (around line 1100)
// ═══════════════════════════════════════════════════════════════════════════════

// Initialize behavioral ecosystem
let behavioralEcosystem = null;
if (STATE.useBehavioralEcosystem) {
    (async () => {
        try {
            logger.info('🧠 Initializing behavioral ecosystem...');
            behavioralEcosystem = await initializeBehavioralEcosystem(logger);
            logger.info('✅ Behavioral ecosystem initialized successfully');
            
            // Log initial stats
            const stats = getEcosystemStats();
            if (stats) {
                logger.info(`📊 Ecosystem ready - Regime: ${stats.ecosystem.regime}, Health: ${stats.health.status}`);
            }
        } catch (error) {
            logger.error('❌ Failed to initialize behavioral ecosystem:', error);
            logger.warn('⚠️ Bot will continue without behavioral features');
            STATE.useBehavioralEcosystem = false;
        }
    })();
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: Update handleShutdown function (around line 200)
// ═══════════════════════════════════════════════════════════════════════════════

async function handleShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger?.info(`🛑 Shutdown signal received: ${signal}`);
    STATE.running = false;

    // ... existing shutdown code ...

    // Shutdown behavioral ecosystem
    if (behavioralEcosystem && STATE.useBehavioralEcosystem) {
        logger?.info('🧠 Shutting down behavioral ecosystem...');
        try {
            await shutdownBehavioralEcosystem();
            logger?.info('✅ Behavioral ecosystem shutdown complete');
        } catch (error) {
            logger?.error('❌ Error shutting down behavioral ecosystem:', error);
        }
    }

    // ... rest of shutdown code ...
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: Add Telegram command for ecosystem stats (add with other bot.onText handlers)
// ═══════════════════════════════════════════════════════════════════════════════

bot.onText(/\/ecosystem/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) {
        bot.sendMessage(chatId, '⛔ Admin only');
        return;
    }

    if (!STATE.useBehavioralEcosystem) {
        bot.sendMessage(chatId, '⚠️ Behavioral ecosystem is disabled\n\nSet `useBehavioralEcosystem: true` in config to enable.');
        return;
    }

    const stats = getEcosystemStats();
    if (!stats) {
        bot.sendMessage(chatId, '⚠️ Behavioral ecosystem not initialized yet');
        return;
    }

    const message = `
🧠 *Behavioral Ecosystem Status*

*Overview*
Wallets: \`${stats.wallets}\`
Regime: \`${stats.ecosystem.regime}\`
Sentiment: \`${(stats.ecosystem.sentiment * 100).toFixed(1)}%\`
Hype Level: \`${(stats.ecosystem.hypeLevel * 100).toFixed(1)}%\`
Fear Index: \`${(stats.ecosystem.fearIndex * 100).toFixed(1)}%\`

*Social Structure*
Leaders: \`${stats.social.leaders}\`
Followers: \`${stats.social.followers}\`
Independent: \`${stats.social.independent}\`
Whales: \`${stats.social.whales}\`

*Lifecycle*
Active: \`${stats.lifecycle.active}\`
Dormant: \`${stats.lifecycle.dormant}\`
Retired: \`${stats.lifecycle.retired}\`
Avg PnL: \`${stats.lifecycle.avgLifetimePnL.toFixed(4)} SOL\`

*Mutations*
Total: \`${stats.mutations.totalMutations}\`
Wallets Mutated: \`${stats.mutations.walletsWithMutations}\`

*Health*
Status: \`${stats.health.status}\`
${stats.health.activeIssues.length > 0 ? `⚠️ Issues: ${stats.health.activeIssues.join(', ')}` : '✅ No issues detected'}
    `.trim();

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: (Optional) Update active wallet count in your strategy execution loop
// ═══════════════════════════════════════════════════════════════════════════════

// Add this wherever you track active agents (e.g., in executeStrategyWithAgents)
if (STATE.useBehavioralEcosystem && behavioralEcosystem) {
    const activeCount = executor.getStats().activeAgents;
    updateActiveWalletCount(activeCount);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7: (Optional) Add ecosystem info to strategy status messages
// ═══════════════════════════════════════════════════════════════════════════════

// In your strategy status reporting, add:
if (STATE.useBehavioralEcosystem) {
    const stats = getEcosystemStats();
    if (stats) {
        statusMessage += `\n\n🧠 *Ecosystem*\n`;
        statusMessage += `Regime: \`${stats.ecosystem.regime}\`\n`;
        statusMessage += `Sentiment: \`${(stats.ecosystem.sentiment * 100).toFixed(0)}%\`\n`;
        statusMessage += `Health: \`${stats.health.status}\`\n`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DONE! The behavioral ecosystem is now integrated.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * VERIFICATION
 * 
 * After integration, verify it's working:
 * 
 * 1. Start the bot and check logs for:
 *    ✅ "Behavioral ecosystem initialized successfully"
 * 
 * 2. Send /ecosystem command in Telegram to see stats
 * 
 * 3. Check storage/ directory for:
 *    - wallet_dna/
 *    - wallet_memory/
 *    - wallet_emotions/
 *    - wallet_lifecycle/
 *    - ecosystem_state.json
 *    - social_graph.json
 * 
 * 4. Run a strategy and observe:
 *    - Wallets have different behaviors
 *    - Emotional states evolve
 *    - Health monitoring active
 */

/**
 * TROUBLESHOOTING
 * 
 * If ecosystem doesn't initialize:
 * 1. Check that all core/ files exist
 * 2. Check that storage/ directory is writable
 * 3. Check logs for specific error messages
 * 4. Verify imports are correct
 * 
 * If wallets behave identically:
 * 1. Check that DNA files are being created in storage/wallet_dna/
 * 2. Verify entropy engine is working (check logs)
 * 3. Increase mutation rate in config
 * 
 * If memory usage is high:
 * 1. Reduce number of wallets
 * 2. Increase auto-save intervals
 * 3. Implement LRU cache eviction
 */
