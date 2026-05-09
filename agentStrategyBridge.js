/**
 * agentStrategyBridge.js
 * 
 * Bridge module connecting MultiStrategyManager strategies to the
 * AgentExecutor + WalletAgent distributed execution system.
 * 
 * Responsibilities:
 * - Maps strategy types to behavior modules
 * - Creates AgentExecutor configs from strategy configs
 * - Wires swap functions, stat recording, and lifecycle hooks
 * - Handles wallet funding/draining around agent execution
 */

import { AgentExecutor } from './agentExecutor.js';
import { EntropyEngine } from './entropyEngine.js';

// SOL address constant
const SOL_ADDR = 'So11111111111111111111111111111111111111112';

/**
 * Map a strategy type string to the behavior registry key
 * @param {string} strategyType - e.g. 'STANDARD', 'MAKER', 'CHART_PATTERN'
 * @returns {string} Normalized key for behaviorRegistry lookup
 */
function mapStrategyToBehaviorKey(strategyType) {
    if (!strategyType) return 'standard';
    
    const map = {
        'STANDARD': 'standard',
        'MAKER': 'maker',
        'WEB_OF_ACTIVITY': 'web',
        'SPAM': 'spam',
        'PUMP_DUMP': 'pump_dump',
        'CHART_PATTERN': 'chart_pattern',
        'HOLDER_GROWTH': 'holder_growth',
        'WHALE': 'whale',
        'VOLUME_BOOST': 'volume_boost',
        'TRENDING': 'trending',
        'JITO_MEV_WASH': 'jito_mev',
        'KOL_ALPHA_CALL': 'kol_alpha',
        'BULL_TRAP': 'bull_trap',
        'SOCIAL_PROOF_AIRDROP': 'social_proof',
        'LADDER': 'ladder',
        'SNIPER': 'sniper',
        'ADV_WASH': 'advanced_wash',
        'MIRROR_WHALE': 'mirror_whale',
        'CURVE_PUMP': 'curve_pump'
    };
    
    return map[strategyType] || 'standard';
}

/**
 * Calculate trade lambda (average trades per second) from strategy config
 * @param {Object} config - Strategy configuration
 * @returns {number} Lambda value for Poisson-distributed delays
 */
function calculateLambda(config) {
    // intervalBetweenActions is in ms; lambda = 1 / (interval_seconds)
    const intervalSec = (config.intervalBetweenActions || 15000) / 1000;
    // Clamp lambda between 0.01 (1 trade per 100s) and 2.0 (2 trades per second)
    return Math.max(0.01, Math.min(2.0, 1.0 / intervalSec));
}

/**
 * Execute a strategy using the distributed agent system
 * 
 * This is the core bridge function that replaces the legacy
 * BatchSwapEngine.executeBatch() loop with AgentExecutor + WalletAgent.
 * 
 * @param {Object} strategy - Strategy object from MultiStrategyManager
 * @param {Object} deps - Dependencies
 * @param {Connection} deps.connection - Solana connection
 * @param {Keypair} deps.masterKeypair - Master wallet keypair
 * @param {WalletPool} deps.walletManager - Wallet pool manager
 * @param {MultiStrategyManager} deps.multiStrategyManager - Strategy manager
 * @param {Function} deps.swapFn - swap(fromToken, toToken, wallet, connection, amount, chatId, silent)
 * @param {Function} deps.sendSOLFn - sendSOL function for funding
 * @param {Function} deps.getTokenBalanceFn - getTokenBalance function
 * @param {Object} deps.behaviorRegistry - Map of behavior key -> behavior module
 * @param {string|number} deps.chatId - Telegram chat ID
 * @param {Object} deps.bot - Telegram bot instance
 * @param {Object} deps.logger - Winston logger
 * @param {Function} deps.sleepFn - sleep utility
 * @param {number} deps.agentTimeBucketMs - Time bucket for entropy engine
 * @returns {Promise<AgentExecutor>} The running AgentExecutor instance
 */
async function executeStrategyWithAgents(strategy, deps) {
    const {
        connection,
        masterKeypair,
        walletManager,
        multiStrategyManager,
        swapFn,
        sendSOLFn,
        getTokenBalanceFn,
        behaviorRegistry,
        chatId,
        bot,
        logger,
        sleepFn,
        agentTimeBucketMs = 60000
    } = deps;

    const strategyId = strategy.id;
    const config = strategy.config;
    const behaviorKey = mapStrategyToBehaviorKey(strategy.type);
    const behavior = behaviorRegistry[behaviorKey] || behaviorRegistry['standard'];

    if (!behavior) {
        throw new Error(`No behavior module found for strategy type: ${strategy.type}`);
    }

    logger.info(`[AgentBridge] Starting agent-based execution for ${strategy.name} (${strategy.type}) with behavior: ${behaviorKey}`);

    // ─── Create AgentExecutor ───
    const executor = new AgentExecutor({
        logger,
        strategyId: strategy.id,
        strategyName: strategy.name,
        onAgentStateChange: (walletKey, state, error) => {
            logger.debug(`[AgentBridge] ${strategy.name} - Agent ${walletKey.slice(0, 8)} -> ${state}`);
        },
        onAgentTrade: (walletKey, trade) => {
            // Record trade in MultiStrategyManager for P&L tracking
            if (trade.success) {
                if (trade.type === 'BUY') {
                    multiStrategyManager.recordBuy(
                        strategyId,
                        walletKey,
                        trade.solSpent || trade.amount || 0,
                        trade.tokensReceived || 0,
                        true
                    );
                } else if (trade.type === 'SELL') {
                    multiStrategyManager.recordSell(
                        strategyId,
                        walletKey,
                        trade.tokensSold || trade.amount || 0,
                        trade.solReceived || 0,
                        true
                    );
                }
            } else {
                if (trade.type === 'BUY') {
                    multiStrategyManager.recordBuy(strategyId, walletKey, trade.amount || 0, 0, false);
                } else if (trade.type === 'SELL') {
                    multiStrategyManager.recordSell(strategyId, walletKey, 0, 0, false);
                }
            }
        },
        onAgentError: (walletKey, error) => {
            logger.warn(`[AgentBridge] ${strategy.name} - Agent ${walletKey.slice(0, 8)} error: ${error.message}`);
        },
        onComplete: () => {
            logger.info(`[AgentBridge] ${strategy.name} - All agents completed`);
        }
    });

    // ─── Store executor on strategy for lifecycle control ───
    strategy.runtime.agentExecutor = executor;

    // ─── Resolve Wallets ───
    let strategyWallets = [];

    if (config.useWalletPool) {
        // Pool mode: use assigned wallets
        strategyWallets = strategy.wallets.assigned.map(pubkey => {
            return walletManager.allWallets.find(w => w.publicKey.toBase58() === pubkey);
        }).filter(w => w !== undefined);

        if (strategyWallets.length === 0) {
            throw new Error('No wallets assigned from pool');
        }

        logger.info(`[AgentBridge] ${strategy.name} - Using ${strategyWallets.length} wallets from pool`);
    } else {
        // Ephemeral mode: generate temporary wallets
        const totalWallets = config.walletCount || 50;
        strategyWallets = walletManager.generateEphemeralWallets(totalWallets);

        if (!strategyWallets || strategyWallets.length === 0) {
            throw new Error('Failed to generate ephemeral wallets');
        }

        logger.info(`[AgentBridge] ${strategy.name} - Generated ${strategyWallets.length} ephemeral wallets`);

        // Fund ephemeral wallets
        if (chatId && bot) {
            bot.sendMessage(chatId,
                `💰 Funding ${strategyWallets.length} wallets for agent-based execution...`,
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }

        const baseFundAmount = config.fundAmountPerWallet || 0.005;
        const fundingConcurrency = Math.min(config.batchConcurrency || 3, 5);

        const fundResult = await walletManager.fundWallets(strategyWallets, {
            connection,
            masterKeypair,
            sendSOLFn: sendSOLFn,
            amountSOL: baseFundAmount,
            concurrency: fundingConcurrency,
            checkRunning: () => strategy.status === 'RUNNING',
            useWebFunding: config.useWebFunding || false,
            stealthLevel: config.fundingStealthLevel || 0,
            hopDepth: config.fundingStealthLevel || 0,
            randomizeAmounts: true,
            fundingVariance: 0.25
        });

        if (!fundResult || !fundResult.success) {
            throw new Error('Wallet funding failed');
        }

        logger.info(`[AgentBridge] ${strategy.name} - Funded ${fundResult.successes} wallets`);

        if (chatId && bot) {
            bot.sendMessage(chatId,
                `✅ Funded ${fundResult.successes} wallets`,
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
    }

    // ─── Build Agent Config ───
    const agentConfig = {
        connection,
        tokenMint: config.tokenAddress,
        strategy: behaviorKey,
        lambda: calculateLambda(config),
        minBuyAmount: config.minBuyAmount || 0.01,
        maxBuyAmount: config.maxBuyAmount || 0.05,
        jitterPercentage: config.jitterPercentage || 20,
        maxRetries: 3,
        verifyTrades: true,
        stuckThreshold: 10,
        timeBucketMs: agentTimeBucketMs,
        logger,

        // Cycle control: each agent runs for numberOfCycles trades
        maxCycles: config.numberOfCycles || 3,

        // Pass strategy config so behaviors can access strategy-specific params
        strategyConfig: {
            ...config,
            strategyType: strategy.type,
            strategyId: strategy.id
        },

        // Behavior-driven action decision
        decideAction: async (agent) => {
            try {
                return await behavior.decideAction(agent);
            } catch (err) {
                logger.warn(`[AgentBridge] Behavior decideAction error: ${err.message}`);
                return { type: 'WAIT' };
            }
        },

        // Buy execution — wraps the bot's swap function
        executeBuy: async (wallet, amount, conn, tokenMint) => {
            const balanceBefore = await getTokenBalanceFn(conn, wallet.publicKey, tokenMint);

            const txid = await swapFn(
                SOL_ADDR,
                tokenMint,
                wallet,
                conn,
                amount,
                chatId,
                true // silent
            );

            if (txid) {
                await sleepFn(1500);
                const balanceAfter = await getTokenBalanceFn(conn, wallet.publicKey, tokenMint);
                const tokensReceived = balanceAfter - balanceBefore;

                return {
                    txid,
                    type: 'BUY',
                    solSpent: amount,
                    tokensReceived: Math.max(0, tokensReceived)
                };
            }

            throw new Error('Swap returned no txid');
        },

        // Sell execution — wraps the bot's swap function
        executeSell: async (wallet, amount, conn, tokenMint) => {
            const solBefore = await conn.getBalance(wallet.publicKey);

            const txid = await swapFn(
                tokenMint,
                SOL_ADDR,
                wallet,
                conn,
                amount,
                chatId,
                true // silent
            );

            if (txid) {
                await sleepFn(1500);
                const solAfter = await conn.getBalance(wallet.publicKey);
                const solReceived = (solAfter - solBefore) / 1e9;

                return {
                    txid,
                    type: 'SELL',
                    tokensSold: amount,
                    solReceived: Math.max(0, solReceived)
                };
            }

            throw new Error('Swap returned no txid');
        },

        // Stop condition
        shouldStop: () => {
            return ['STOPPED', 'ERROR', 'IDLE'].includes(strategy.status);
        }
    };

    // ─── Start Agents ───
    if (chatId && bot) {
        bot.sendMessage(chatId,
            `🤖 *Launching ${strategyWallets.length} agents...*\n` +
            `Strategy: \`${strategy.name}\`\n` +
            `Behavior: \`${behaviorKey}\`\n` +
            `Cycles/Agent: \`${agentConfig.maxCycles}\``,
            { parse_mode: 'Markdown' }
        ).catch(() => {});
    }

    await executor.startAgents(strategyWallets, agentConfig);

    logger.info(`[AgentBridge] ${strategy.name} - ${strategyWallets.length} agents launched`);

    // ─── Wait for Completion ───
    await executor.waitForCompletion();

    // ─── Post-Execution ───
    const health = executor.getHealth();
    const stats = executor.getStats();

    logger.info(`[AgentBridge] ${strategy.name} - Execution complete. Health: ${health.status}, Trades: ${stats.totalTrades}, Success Rate: ${health.successRate}%`);

    // Mark strategy as complete if it was still running
    if (strategy.status === 'RUNNING') {
        try {
            multiStrategyManager.stopStrategy(strategy.id, 'All agents completed');
        } catch (e) {
            // Already stopped
        }
    }

    // ─── Drain Ephemeral Wallets ───
    if (!config.useWalletPool && strategyWallets.length > 0) {
        logger.info(`[AgentBridge] ${strategy.name} - Draining ${strategyWallets.length} ephemeral wallets...`);

        if (chatId && bot) {
            bot.sendMessage(chatId,
                `🔄 Draining ephemeral wallets...`,
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }

        try {
            const drainConcurrency = Math.min(config.batchConcurrency || 5, 5);
            await walletManager.drainWallets(strategyWallets, {
                connection,
                masterKeypair,
                sendSOLFn: sendSOLFn,
                concurrency: drainConcurrency,
                checkRunning: () => true
            });
            logger.info(`[AgentBridge] ${strategy.name} - Ephemeral wallets drained`);
        } catch (error) {
            logger.error(`[AgentBridge] ${strategy.name} - Failed to drain wallets: ${error.message}`);
        }
    }

    // ─── Final Report ───
    if (chatId && bot) {
        bot.sendMessage(chatId,
            `✅ *Strategy Completed*\n\n` +
            `${strategy.name}\n` +
            `Mode: \`${config.useWalletPool ? 'Wallet Pool' : 'Ephemeral'}\`\n` +
            `Agents: \`${stats.totalAgents}\`\n` +
            `Health: \`${health.status}\`\n` +
            `Trades: \`${stats.successfulTrades}/${stats.totalTrades}\`\n` +
            `Success Rate: \`${health.successRate}%\`\n` +
            `Buys: \`${strategy.stats.successfulBuys}/${strategy.stats.totalBuys}\`\n` +
            `Sells: \`${strategy.stats.successfulSells}/${strategy.stats.totalSells}\`\n` +
            `P&L: \`${strategy.stats.profitLoss.toFixed(4)}\` SOL`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});
    }


    return executor;
}

/**
 * Stop a strategy's agent executor gracefully
 * @param {Object} strategy - Strategy object
 * @param {Object} logger - Logger instance
 */
async function stopStrategyAgents(strategy, logger) {
    if (strategy.runtime?.agentExecutor) {
        logger.info(`[AgentBridge] Stopping agents for ${strategy.name}...`);
        await strategy.runtime.agentExecutor.stopAll(15000);
        strategy.runtime.agentExecutor = null;
        logger.info(`[AgentBridge] Agents stopped for ${strategy.name}`);
    }
}

/**
 * Pause a strategy's agents
 * @param {Object} strategy - Strategy object
 * @param {Object} logger - Logger instance
 */
function pauseStrategyAgents(strategy, logger) {
    if (strategy.runtime?.agentExecutor) {
        logger.info(`[AgentBridge] Pausing agents for ${strategy.name}...`);
        strategy.runtime.agentExecutor.pauseAll();
    }
}

/**
 * Resume a strategy's agents
 * @param {Object} strategy - Strategy object
 * @param {Object} logger - Logger instance
 */
function resumeStrategyAgents(strategy, logger) {
    if (strategy.runtime?.agentExecutor) {
        logger.info(`[AgentBridge] Resuming agents for ${strategy.name}...`);
        strategy.runtime.agentExecutor.resumeAll();
    }
}

/**
 * Get agent health for a strategy
 * @param {Object} strategy - Strategy object
 * @returns {Object|null} Health status or null
 */
function getStrategyAgentHealth(strategy) {
    if (strategy.runtime?.agentExecutor) {
        return strategy.runtime.agentExecutor.getHealth();
    }
    return null;
}

/**
 * Get detailed agent stats for a strategy
 * @param {Object} strategy - Strategy object
 * @returns {Object|null} Detailed stats or null
 */
function getStrategyAgentDetails(strategy) {
    if (strategy.runtime?.agentExecutor) {
        return strategy.runtime.agentExecutor.getDetailedStats();
    }
    return null;
}

export {
    executeStrategyWithAgents,
    stopStrategyAgents,
    pauseStrategyAgents,
    resumeStrategyAgents,
    getStrategyAgentHealth,
    getStrategyAgentDetails,
    mapStrategyToBehaviorKey,
    calculateLambda
};
