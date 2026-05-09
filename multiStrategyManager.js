// multiStrategyManager.js - Multi-Strategy Execution Manager
// Allows running multiple strategies simultaneously with isolated wallet pools

import fs from 'fs';
import { EventEmitter } from 'events';

const MULTI_STRATEGY_STATE_FILE = 'multi_strategies.json';

export class MultiStrategyManager extends EventEmitter {
    constructor() {
        super();
        this.strategies = new Map(); // strategyId -> { config, status, wallets, stats }
        this.loadStrategies();
    }

    /**
     * Create a new strategy instance
     * @param {string} strategyId - Unique identifier
     * @param {Object} config - Strategy configuration
     * @returns {Object} Strategy metadata
     */
    createStrategy(strategyId, config) {
        if (this.strategies.has(strategyId)) {
            throw new Error(`Strategy \`${strategyId}\` already exists`);
        }

        const strategy = {
            id: strategyId,
            name: config.name || strategyId,
            type: config.strategyType, // STANDARD, MAKER, WEB_OF_ACTIVITY, etc.
            createdAt: Date.now(),
            status: 'IDLE', // IDLE, RUNNING, PAUSED, STOPPED, ERROR
            
            // Configuration
            config: {
                tokenAddress: config.tokenAddress,
                minBuyAmount: config.minBuyAmount || 0.01,
                maxBuyAmount: config.maxBuyAmount || 0.05,
                priorityFee: config.priorityFee || 0.0005,
                slippage: config.slippage || 2,
                numberOfCycles: config.numberOfCycles || 3,
                intervalBetweenActions: config.intervalBetweenActions || 15000,
                jitterPercentage: config.jitterPercentage || 20,
                useJito: config.useJito || false,
                jitoTipAmount: config.jitoTipAmount || 0.0001,
                swapProvider: config.swapProvider || 'SOLANA_TRACKER',
                targetDex: config.targetDex || 'RAYDIUM_AMM',
                
                // Wallet allocation
                dedicatedWallets: config.dedicatedWallets || [], // Array of wallet indices
                walletCount: config.walletCount || 10,
                fundAmountPerWallet: config.fundAmountPerWallet || 0.005,
                
                // Strategy-specific settings
                ...config.strategySpecific
            },
            
            // Runtime state
            runtime: {
                startedAt: null,
                stoppedAt: null,
                currentCycle: 0,
                executionHandle: null, // For cancellation
                agentExecutor: null, // AgentExecutor instance for distributed mode
                lastError: null
            },
            
            // Statistics
            stats: {
                totalBuys: 0,
                totalSells: 0,
                successfulBuys: 0,
                successfulSells: 0,
                failedBuys: 0,
                failedSells: 0,
                totalSOLSpent: 0,
                totalSOLReceived: 0,
                totalTokensBought: 0,
                totalTokensSold: 0,
                profitLoss: 0,
                roi: 0
            },
            
            // Wallet tracking
            wallets: {
                assigned: [], // Wallet public keys assigned to this strategy
                funded: [], // Wallets that have been funded
                active: [], // Wallets currently holding tokens
                available: [] // Wallets ready for use
            }
        };

        this.strategies.set(strategyId, strategy);
        this.saveStrategies();
        this.emit('strategyCreated', strategy);
        
        return strategy;
    }

    /**
     * Get strategy by ID
     */
    getStrategy(strategyId) {
        return this.strategies.get(strategyId);
    }

    /**
     * Get all strategies with optional filtering
     */
    getAllStrategies(statusFilter = null) {
        const result = [];
        for (const [, strategy] of this.strategies) {
            if (statusFilter && strategy.status !== statusFilter) continue;
            result.push({
                id: strategy.id,
                name: strategy.name,
                type: strategy.type,
                status: strategy.status,
                walletCount: strategy.wallets.assigned.length,
                cycles: `${strategy.runtime.currentCycle}/${strategy.config.numberOfCycles}`,
                profitLoss: strategy.stats.profitLoss,
                roi: strategy.stats.roi
            });
        }
        return result;
    }

    /**
     * Update strategy configuration
     */
    updateStrategyConfig(strategyId, updates) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) throw new Error(`Strategy \`${strategyId}\` not found`);
        
        if (strategy.status === 'RUNNING') {
            throw new Error('Cannot update configuration while strategy is running');
        }
        
        Object.assign(strategy.config, updates);
        this.saveStrategies();
        this.emit('strategyUpdated', strategy);
    }

    /**
     * Assign wallets to a strategy
     */
    assignWallets(strategyId, walletPublicKeys) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) throw new Error(`Strategy \`${strategyId}\` not found`);
        
        // Check if wallets are already assigned to another strategy
        for (const [id, strat] of this.strategies) {
            if (id === strategyId) continue;
            const overlap = walletPublicKeys.filter(w => strat.wallets.assigned.includes(w));
            if (overlap.length > 0) {
                throw new Error(`Wallets already assigned to strategy \`${id}\`: ${overlap.join(', ')}`);
            }
        }
        
        strategy.wallets.assigned = walletPublicKeys;
        strategy.wallets.available = [...walletPublicKeys];
        this.saveStrategies();
        this.emit('walletsAssigned', { strategyId, wallets: walletPublicKeys });
    }

    /**
     * Start a strategy
     */
    async startStrategy(strategyId, executionFunction) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) throw new Error(`Strategy \`${strategyId}\` not found`);
        
        if (strategy.status === 'RUNNING') {
            throw new Error('Strategy is already running');
        }
        
        // Only check for assigned wallets if using wallet pool mode
        // Ephemeral mode generates wallets on-the-fly
        if (strategy.config.useWalletPool && strategy.wallets.assigned.length === 0) {
            throw new Error('No wallets assigned to this strategy');
        }
        
        strategy.status = 'RUNNING';
        strategy.runtime.startedAt = Date.now();
        strategy.runtime.currentCycle = 0;
        strategy.runtime.lastError = null;
        strategy.runtime.agentExecutor = null; // Clear any stale executor
        
        this.saveStrategies();
        this.emit('strategyStarted', strategy);
        
        // Execute strategy (caller provides the execution function)
        try {
            strategy.runtime.executionHandle = executionFunction(strategy);
        } catch (error) {
            strategy.status = 'ERROR';
            strategy.runtime.lastError = error.message;
            this.saveStrategies();
            this.emit('strategyError', { strategyId, error });
            throw error;
        }
    }

    /**
     * Stop a strategy
     */
    stopStrategy(strategyId, reason = 'User stopped') {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) throw new Error(`Strategy \`${strategyId}\` not found`);
        
        if (strategy.status !== 'RUNNING') {
            throw new Error('Strategy is not running');
        }
        
        strategy.status = 'STOPPED';
        strategy.runtime.stoppedAt = Date.now();
        
        // Stop agent executor if running
        if (strategy.runtime.agentExecutor) {
            try {
                strategy.runtime.agentExecutor.stopAll(15000).catch(e => {
                    console.error(`[MultiStrategyManager] Error stopping agents: ${e.message}`);
                });
            } catch (e) {
                console.error(`[MultiStrategyManager] Error initiating agent stop: ${e.message}`);
            }
        }
        
        // Cancel execution if handle exists
        if (strategy.runtime.executionHandle && typeof strategy.runtime.executionHandle.cancel === 'function') {
            strategy.runtime.executionHandle.cancel();
        }
        
        this.saveStrategies();
        this.emit('strategyStopped', { strategyId, reason });
    }

    /**
     * Pause a strategy
     */
    pauseStrategy(strategyId) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) throw new Error(`Strategy \`${strategyId}\` not found`);
        
        if (strategy.status !== 'RUNNING') {
            throw new Error('Strategy is not running');
        }
        
        strategy.status = 'PAUSED';
        
        // Pause agent executor if running
        if (strategy.runtime.agentExecutor) {
            strategy.runtime.agentExecutor.pauseAll();
        }
        
        this.saveStrategies();
        this.emit('strategyPaused', strategy);
    }

    /**
     * Resume a paused strategy
     */
    resumeStrategy(strategyId) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) throw new Error(`Strategy \`${strategyId}\` not found`);
        
        if (strategy.status !== 'PAUSED') {
            throw new Error('Strategy is not paused');
        }
        
        strategy.status = 'RUNNING';
        
        // Resume agent executor if it exists
        if (strategy.runtime.agentExecutor) {
            strategy.runtime.agentExecutor.resumeAll();
        }
        
        this.saveStrategies();
        this.emit('strategyResumed', strategy);
    }

    /**
     * Get agent health for a strategy
     */
    getAgentHealth(strategyId) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy || !strategy.runtime?.agentExecutor) return null;
        return strategy.runtime.agentExecutor.getHealth();
    }

    /**
     * Get detailed agent statistics
     */
    getAgentDetails(strategyId) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy || !strategy.runtime?.agentExecutor) return null;
        return strategy.runtime.agentExecutor.getDetailedStats();
    }

    /**
     * Get agent cycle progress
     */
    getAgentCycleProgress(strategyId) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy || !strategy.runtime?.agentExecutor) return null;
        return strategy.runtime.agentExecutor.getCycleProgress();
    }

    /**
     * Update strategy statistics
     */
    updateStats(strategyId, updates) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) return;
        
        Object.assign(strategy.stats, updates);
        
        // Calculate P&L and ROI
        strategy.stats.profitLoss = strategy.stats.totalSOLReceived - strategy.stats.totalSOLSpent;
        strategy.stats.roi = strategy.stats.totalSOLSpent > 0 
            ? ((strategy.stats.profitLoss / strategy.stats.totalSOLSpent) * 100)
            : 0;
        
        this.saveStrategies();
        this.emit('statsUpdated', { strategyId, stats: strategy.stats });
    }

    /**
     * Record a buy transaction
     */
    recordBuy(strategyId, walletPubkey, solSpent, tokensReceived, success = true) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) return;
        
        strategy.stats.totalBuys++;
        if (success) {
            strategy.stats.successfulBuys++;
            strategy.stats.totalSOLSpent += solSpent;
            strategy.stats.totalTokensBought += tokensReceived;
            
            // Move wallet to active
            if (!strategy.wallets.active.includes(walletPubkey)) {
                strategy.wallets.active.push(walletPubkey);
            }
        } else {
            strategy.stats.failedBuys++;
        }
        
        this.updateStats(strategyId, strategy.stats);
    }

    /**
     * Record a sell transaction
     */
    recordSell(strategyId, walletPubkey, tokensSold, solReceived, success = true) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) return;
        
        strategy.stats.totalSells++;
        if (success) {
            strategy.stats.successfulSells++;
            strategy.stats.totalSOLReceived += solReceived;
            strategy.stats.totalTokensSold += tokensSold;
            
            // Move wallet back to available
            const activeIndex = strategy.wallets.active.indexOf(walletPubkey);
            if (activeIndex > -1) {
                strategy.wallets.active.splice(activeIndex, 1);
                if (!strategy.wallets.available.includes(walletPubkey)) {
                    strategy.wallets.available.push(walletPubkey);
                }
            }
        } else {
            strategy.stats.failedSells++;
        }
        
        this.updateStats(strategyId, strategy.stats);
    }

    /**
     * Delete a strategy
     */
    deleteStrategy(strategyId) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) return false;
        
        if (strategy.status === 'RUNNING') {
            throw new Error('Cannot delete a running strategy. Stop it first.');
        }
        
        this.strategies.delete(strategyId);
        this.saveStrategies();
        this.emit('strategyDeleted', strategyId);
        return true;
    }

    /**
     * Get running strategies count
     */
    getRunningCount() {
        let count = 0;
        for (const [, strategy] of this.strategies) {
            if (strategy.status === 'RUNNING') count++;
        }
        return count;
    }

    /**
     * Check if a wallet is assigned to any strategy
     */
    isWalletAssigned(walletPubkey) {
        for (const [, strategy] of this.strategies) {
            if (strategy.wallets.assigned.includes(walletPubkey)) {
                return strategy.id;
            }
        }
        return null;
    }

    /**
     * Get strategy statistics summary
     */
    getGlobalStats() {
        let totalStrategies = this.strategies.size;
        let runningStrategies = 0;
        let totalBuys = 0;
        let totalSells = 0;
        let totalProfitLoss = 0;
        let totalWalletsUsed = 0;
        
        for (const [, strategy] of this.strategies) {
            if (strategy.status === 'RUNNING') runningStrategies++;
            totalBuys += strategy.stats.totalBuys;
            totalSells += strategy.stats.totalSells;
            totalProfitLoss += strategy.stats.profitLoss;
            totalWalletsUsed += strategy.wallets.assigned.length;
        }
        
        return {
            totalStrategies,
            runningStrategies,
            idleStrategies: totalStrategies - runningStrategies,
            totalBuys,
            totalSells,
            totalProfitLoss,
            totalWalletsUsed
        };
    }

    /**
     * Save strategies to file
     */
    saveStrategies() {
        try {
            const data = {};
            for (const [id, strategy] of this.strategies) {
                // Don't save execution handles or agent executors
                const { runtime, ...saveData } = strategy;
                const { executionHandle, agentExecutor, ...runtimeData } = runtime;
                data[id] = { ...saveData, runtime: runtimeData };
            }
            fs.writeFileSync(MULTI_STRATEGY_STATE_FILE, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error(`[MultiStrategyManager] Failed to save strategies: ${e.message}`);
        }
    }

    /**
     * Load strategies from file
     */
    loadStrategies() {
        try {
            if (fs.existsSync(MULTI_STRATEGY_STATE_FILE)) {
                const data = JSON.parse(fs.readFileSync(MULTI_STRATEGY_STATE_FILE, 'utf8'));
                for (const [id, strategy] of Object.entries(data)) {
                    // Reset running status on load (bot restart)
                    if (strategy.status === 'RUNNING') {
                        strategy.status = 'STOPPED';
                        strategy.runtime.stoppedAt = Date.now();
                    }
                    this.strategies.set(id, strategy);
                }
            }
        } catch (e) {
            console.error(`[MultiStrategyManager] Failed to load strategies: ${e.message}`);
        }
    }
}

export default MultiStrategyManager;
