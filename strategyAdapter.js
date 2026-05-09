/**
 * strategyAdapter.js
 * 
 * Unified adapter for all trading strategies
 * Maps existing 19 strategies to agent-based execution
 * Supports both single and multi-strategy modes
 * 
 * Features:
 * - Strategy behavior injection
 * - Wallet pool and ephemeral mode support
 * - Automatic wallet lifecycle management
 * - Integration with AgentExecutor
 * - Preserves all existing strategy logic
 */

import { AgentExecutor } from './agentExecutor.js';
import { FundManager } from './fundManager.js';
import { EntropyEngine } from './entropyEngine.js';
import { Keypair, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';

// Strategy types
const StrategyType = {
    STANDARD: 'standard',
    MAKER: 'maker',
    WEB_OF_ACTIVITY: 'web',
    SPAM: 'spam',
    PUMP_DUMP: 'pump',
    CHART_PATTERN: 'chart',
    HOLDER_GROWTH: 'holder',
    WHALE: 'whale',
    VOLUME_BOOST: 'volume',
    TRENDING: 'trending',
    JITO_MEV: 'jito',
    KOL_ALPHA: 'kol',
    BULL_TRAP: 'bulltrap',
    SOCIAL_PROOF: 'social',
    LADDER: 'ladder',
    SNIPER: 'sniper',
    ADVANCED_WASH: 'advwash',
    MIRROR_WHALE: 'mirror',
    CURVE_PUMP: 'curve'
};

class StrategyAdapter {
    /**
     * Create a new strategy adapter
     * @param {Object} config - Strategy configuration
     */
    constructor(config) {
        // Core config
        this.strategyType = config.strategyType || StrategyType.STANDARD;
        this.strategyName = config.strategyName || this.strategyType;
        this.connection = config.connection;
        this.tokenMint = config.tokenMint;
        
        // Wallet config
        this.useWalletPool = config.useWalletPool || false;
        this.walletManager = config.walletManager;
        this.masterKeypair = config.masterKeypair;
        this.numWallets = config.numWallets || 10;
        
        // Trading config
        this.minBuyAmount = config.minBuyAmount || 0.001;
        this.maxBuyAmount = config.maxBuyAmount || 0.01;
        this.fundAmountPerWallet = config.fundAmountPerWallet || 0.01;
        this.lambda = config.lambda || 0.1;
        this.jitterPercentage = config.jitterPercentage || 20;
        this.maxTrades = config.maxTrades || 100;
        this.duration = config.duration || null; // null = unlimited
        
        // Behavior injection
        this.behaviorModule = config.behaviorModule || null;
        this.decideAction = config.decideAction || null;
        this.executeBuy = config.executeBuy;
        this.executeSell = config.executeSell;
        
        // Funding config
        this.fundingVariance = config.fundingVariance || 0.25;
        this.useWebFunding = config.useWebFunding || false;
        this.stealthLevel = config.stealthLevel || 1;
        this.hopDepth = config.hopDepth || 2;
        this.autoDrain = config.autoDrain !== false;
        
        // Components
        this.executor = null;
        this.fundManager = new FundManager({
            logger: config.logger,
            defaultVariance: this.fundingVariance,
            useWebFunding: this.useWebFunding,
            stealthLevel: this.stealthLevel,
            hopDepth: this.hopDepth
        });
        
        // State
        this.wallets = [];
        this.isRunning = false;
        this.startTime = null;
        this.endTime = null;
        this.tradeCount = 0;
        
        // Callbacks
        this.onProgress = config.onProgress || (() => {});
        this.onComplete = config.onComplete || (() => {});
        this.onError = config.onError || (() => {});
        
        // Logging
        this.logger = config.logger || console;
        this.logPrefix = `[Strategy:${this.strategyName}]`;
        
        // Load behavior if module provided
        if (this.behaviorModule) {
            this._loadBehavior(this.behaviorModule);
        }
    }

    /**
     * Start the strategy
     */
    async start() {
        if (this.isRunning) {
            throw new Error('Strategy is already running');
        }

        this.logger.info(`${this.logPrefix} Starting strategy...`);
        this.isRunning = true;
        this.startTime = Date.now();

        try {
            // Step 1: Prepare wallets
            await this._prepareWallets();

            // Step 2: Fund wallets
            await this._fundWallets();

            // Step 3: Start agents
            await this._startAgents();

            // Step 4: Monitor execution
            await this._monitorExecution();

            // Step 5: Cleanup
            await this._cleanup();

            this.endTime = Date.now();
            const duration = ((this.endTime - this.startTime) / 1000).toFixed(2);
            
            this.logger.info(`${this.logPrefix} ✅ Strategy completed in ${duration}s`);
            this.onComplete({
                strategyName: this.strategyName,
                duration,
                trades: this.tradeCount,
                wallets: this.wallets.length
            });

        } catch (error) {
            this.logger.error(`${this.logPrefix} Strategy failed:`, error);
            this.onError(error);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Stop the strategy
     */
    async stop() {
        if (!this.isRunning) {
            this.logger.warn(`${this.logPrefix} Strategy is not running`);
            return;
        }

        this.logger.info(`${this.logPrefix} Stopping strategy...`);

        if (this.executor) {
            await this.executor.stopAll();
        }

        await this._cleanup();
        
        this.isRunning = false;
        this.endTime = Date.now();
        
        this.logger.info(`${this.logPrefix} ✅ Strategy stopped`);
    }

    /**
     * Pause the strategy
     */
    pause() {
        if (this.executor) {
            this.executor.pauseAll();
            this.logger.info(`${this.logPrefix} Strategy paused`);
        }
    }

    /**
     * Resume the strategy
     */
    resume() {
        if (this.executor) {
            this.executor.resumeAll();
            this.logger.info(`${this.logPrefix} Strategy resumed`);
        }
    }

    /**
     * Get strategy statistics
     */
    getStats() {
        const baseStats = {
            strategyName: this.strategyName,
            strategyType: this.strategyType,
            isRunning: this.isRunning,
            startTime: this.startTime,
            endTime: this.endTime,
            duration: this.startTime ? (Date.now() - this.startTime) / 1000 : 0,
            wallets: this.wallets.length,
            tradeCount: this.tradeCount
        };

        if (this.executor) {
            return {
                ...baseStats,
                executor: this.executor.getStats()
            };
        }

        return baseStats;
    }

    /**
     * Prepare wallets (pool or ephemeral)
     * @private
     */
    async _prepareWallets() {
        this.logger.info(`${this.logPrefix} Preparing wallets...`);

        if (this.useWalletPool) {
            // Use wallet pool
            if (!this.walletManager) {
                throw new Error('Wallet manager required for pool mode');
            }

            this.wallets = await this.walletManager.allocate(this.numWallets);
            this.logger.info(`${this.logPrefix} Allocated ${this.wallets.length} wallets from pool`);

        } else {
            // Create ephemeral wallets
            this.wallets = [];
            
            for (let i = 0; i < this.numWallets; i++) {
                this.wallets.push(Keypair.generate());
            }
            
            this.logger.info(`${this.logPrefix} Created ${this.wallets.length} ephemeral wallets`);
        }
    }

    /**
     * Fund wallets with randomization
     * @private
     */
    async _fundWallets() {
        this.logger.info(`${this.logPrefix} Funding wallets...`);

        const result = await this.fundManager.fundWallets(this.wallets, {
            connection: this.connection,
            masterKeypair: this.masterKeypair,
            sendSOLFn: this._getSendSOLFunction(),
            baseAmount: this.fundAmountPerWallet,
            variance: this.fundingVariance,
            concurrency: 10,
            progressCb: (progress) => {
                this.onProgress({
                    phase: 'funding',
                    ...progress
                });
            },
            checkRunning: () => this.isRunning,
            useWebFunding: this.useWebFunding,
            stealthLevel: this.stealthLevel,
            hopDepth: this.hopDepth
        });

        if (result.failed > 0) {
            this.logger.warn(`${this.logPrefix} ${result.failed} wallets failed to fund`);
        }

        this.logger.info(`${this.logPrefix} ✅ Funded ${result.succeeded} wallets`);
    }

    /**
     * Start wallet agents
     * @private
     */
    async _startAgents() {
        this.logger.info(`${this.logPrefix} Starting agents...`);

        // Create executor
        this.executor = new AgentExecutor({
            logger: this.logger,
            onAgentStateChange: (walletKey, state, error) => {
                this.logger.info(`${this.logPrefix} Agent ${walletKey.slice(0, 8)} -> ${state}`);
            },
            onAgentTrade: (walletKey, trade) => {
                this.tradeCount++;
                this.onProgress({
                    phase: 'trading',
                    trades: this.tradeCount,
                    maxTrades: this.maxTrades
                });
            },
            onAgentError: (walletKey, error) => {
                this.logger.error(`${this.logPrefix} Agent ${walletKey.slice(0, 8)} error:`, error.message);
            }
        });

        // Agent configuration
        const agentConfig = {
            connection: this.connection,
            tokenMint: this.tokenMint,
            strategy: this.strategyType,
            lambda: this.lambda,
            minBuyAmount: this.minBuyAmount,
            maxBuyAmount: this.maxBuyAmount,
            jitterPercentage: this.jitterPercentage,
            decideAction: this.decideAction,
            executeBuy: this.executeBuy,
            executeSell: this.executeSell,
            shouldStop: () => this._shouldStopAgent(),
            verifyTrades: true,
            maxRetries: 3,
            logger: this.logger
        };

        // Start all agents
        await this.executor.startAgents(this.wallets, agentConfig);
        
        this.logger.info(`${this.logPrefix} ✅ All agents started`);
    }

    /**
     * Monitor execution until completion
     * @private
     */
    async _monitorExecution() {
        this.logger.info(`${this.logPrefix} Monitoring execution...`);

        // Wait for completion or timeout
        const checkInterval = 5000; // 5 seconds
        
        while (this.isRunning) {
            await this._sleep(checkInterval);

            // Check if we should stop
            if (this._shouldStopExecution()) {
                this.logger.info(`${this.logPrefix} Stop condition met`);
                await this.executor.stopAll();
                break;
            }

            // Log progress
            const stats = this.executor.getStats();
            this.logger.info(`${this.logPrefix} Progress: ${stats.totalTrades} trades, ${stats.activeAgents} active agents`);
        }
    }

    /**
     * Cleanup (drain wallets if ephemeral)
     * @private
     */
    async _cleanup() {
        if (!this.useWalletPool && this.autoDrain && this.wallets.length > 0) {
            this.logger.info(`${this.logPrefix} Draining ephemeral wallets...`);

            const result = await this.fundManager.drainWallets(this.wallets, {
                connection: this.connection,
                masterKeypair: this.masterKeypair,
                sendSOLFn: this._getSendSOLFunction(),
                concurrency: 10,
                progressCb: (progress) => {
                    this.onProgress({
                        phase: 'draining',
                        ...progress
                    });
                },
                checkRunning: () => true
            });

            this.logger.info(`${this.logPrefix} ✅ Recovered ${result.totalRecovered.toFixed(6)} SOL`);
        }
    }

    /**
     * Check if agent should stop
     * @private
     */
    _shouldStopAgent() {
        // Max trades reached
        if (this.maxTrades && this.tradeCount >= this.maxTrades) {
            return true;
        }

        // Duration exceeded
        if (this.duration && this.startTime) {
            const elapsed = (Date.now() - this.startTime) / 1000;
            if (elapsed >= this.duration) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if execution should stop
     * @private
     */
    _shouldStopExecution() {
        if (!this.executor) return true;

        const stats = this.executor.getStats();
        
        // All agents stopped
        if (stats.activeAgents === 0 && stats.degradedAgents === 0) {
            return true;
        }

        // Max trades reached
        if (this.maxTrades && this.tradeCount >= this.maxTrades) {
            return true;
        }

        // Duration exceeded
        if (this.duration && this.startTime) {
            const elapsed = (Date.now() - this.startTime) / 1000;
            if (elapsed >= this.duration) {
                return true;
            }
        }

        return false;
    }

    /**
     * Load behavior from module
     * @private
     */
    async _loadBehavior(behaviorModule) {
        try {
            const behavior = await import(behaviorModule);
            
            if (behavior.decideAction) {
                this.decideAction = behavior.decideAction;
            }
            
            if (behavior.executeBuy) {
                this.executeBuy = behavior.executeBuy;
            }
            
            if (behavior.executeSell) {
                this.executeSell = behavior.executeSell;
            }
            
            this.logger.info(`${this.logPrefix} Loaded behavior from ${behaviorModule}`);
        } catch (error) {
            this.logger.error(`${this.logPrefix} Failed to load behavior:`, error);
        }
    }

    /**
     * Get sendSOL function (placeholder - should be injected)
     * @private
     */
    _getSendSOLFunction() {
        // This should be provided in config
        // Placeholder implementation
        return async (connection, from, to, amount) => {
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: from.publicKey,
                    toPubkey: to,
                    lamports: Math.floor(amount * 1e9)
                })
            );

            return await sendAndConfirmTransaction(connection, transaction, [from]);
        };
    }

    /**
     * Sleep utility
     * @private
     */
    async _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export { StrategyAdapter, StrategyType };
