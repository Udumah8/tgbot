/**
 * core/walletMemory.js
 * 
 * Persistent memory system for wallet agents
 * Tracks trading history, emotional state evolution, and learned behaviors
 * 
 * Features:
 * - Persistent storage across restarts
 * - Dynamic confidence/fear/greed evolution
 * - Trade history with outcome tracking
 * - Successful strategy identification
 * - Trauma event recording
 */

import fs from 'fs/promises';
import path from 'path';

const MEMORY_STORAGE_DIR = './storage/wallet_memory';
const MAX_HISTORY_LENGTH = 100;

/**
 * Wallet Memory structure
 */
class WalletMemory {
    constructor(data = {}) {
        // Emotional state (evolves over time)
        this.confidence = data.confidence || 0.5;
        this.fear = data.fear || 0.0;
        this.greed = data.greed || 0.0;
        this.fatigue = data.fatigue || 0.0;
        
        // Performance tracking
        this.pnlHistory = data.pnlHistory || [];
        this.recentWins = data.recentWins || 0;
        this.recentLosses = data.recentLosses || 0;
        this.failedTrades = data.failedTrades || 0;
        this.totalTrades = data.totalTrades || 0;
        
        // Behavioral learning
        this.averageHoldTime = data.averageHoldTime || 0;
        this.successfulStrategies = data.successfulStrategies || {};
        this.profitableTimeWindows = data.profitableTimeWindows || {};
        
        // Trauma tracking
        this.traumaEvents = data.traumaEvents || [];
        this.maxDrawdown = data.maxDrawdown || 0;
        this.consecutiveLosses = data.consecutiveLosses || 0;
        this.maxConsecutiveLosses = data.maxConsecutiveLosses || 0;
        
        // Momentum tracking
        this.profitMomentum = data.profitMomentum || 0;
        this.winStreak = data.winStreak || 0;
        this.lossStreak = data.lossStreak || 0;
        
        // Timestamps
        this.lastTradeTime = data.lastTradeTime || 0;
        this.createdAt = data.createdAt || Date.now();
        this.updatedAt = data.updatedAt || Date.now();
    }

    /**
     * Record a trade outcome
     * @param {Object} trade - Trade details
     */
    recordTrade(trade) {
        this.totalTrades++;
        this.lastTradeTime = Date.now();
        this.updatedAt = Date.now();
        
        const { success, type, pnl = 0, holdTime = 0 } = trade;
        
        if (success) {
            this.recentWins++;
            this.winStreak++;
            this.lossStreak = 0;
            this.consecutiveLosses = 0;
            
            // Update confidence
            this.confidence = Math.min(1.0, this.confidence + 0.02);
            this.fear = Math.max(0.0, this.fear - 0.03);
            
            // Track PnL
            if (pnl > 0) {
                this.greed = Math.min(1.0, this.greed + 0.05);
                this.profitMomentum = Math.min(1.0, this.profitMomentum + 0.1);
            }
            
            // Update hold time average
            if (holdTime > 0) {
                this.averageHoldTime = (this.averageHoldTime * 0.9) + (holdTime * 0.1);
            }
            
        } else {
            this.recentLosses++;
            this.failedTrades++;
            this.lossStreak++;
            this.winStreak = 0;
            this.consecutiveLosses++;
            this.maxConsecutiveLosses = Math.max(this.maxConsecutiveLosses, this.consecutiveLosses);
            
            // Update emotional state
            this.confidence = Math.max(0.0, this.confidence - 0.05);
            this.fear = Math.min(1.0, this.fear + 0.08);
            this.profitMomentum = Math.max(-1.0, this.profitMomentum - 0.15);
            
            // Check for trauma
            if (this.consecutiveLosses >= 5) {
                this._recordTrauma('CONSECUTIVE_LOSSES', { count: this.consecutiveLosses });
            }
        }
        
        // Track PnL history
        this.pnlHistory.push({
            timestamp: Date.now(),
            pnl,
            type,
            success
        });
        
        // Trim history
        if (this.pnlHistory.length > MAX_HISTORY_LENGTH) {
            this.pnlHistory = this.pnlHistory.slice(-MAX_HISTORY_LENGTH);
        }
        
        // Update fatigue
        this._updateFatigue();
        
        // Decay recent counters
        this._decayRecentCounters();
    }

    /**
     * Record a trauma event
     * @private
     */
    _recordTrauma(type, details) {
        this.traumaEvents.push({
            type,
            details,
            timestamp: Date.now()
        });
        
        // Trim trauma history
        if (this.traumaEvents.length > 20) {
            this.traumaEvents = this.traumaEvents.slice(-20);
        }
        
        // Increase fear significantly
        this.fear = Math.min(1.0, this.fear + 0.2);
        this.confidence = Math.max(0.0, this.confidence - 0.3);
    }

    /**
     * Update fatigue based on trading activity
     * @private
     */
    _updateFatigue() {
        const now = Date.now();
        const timeSinceLastTrade = now - this.lastTradeTime;
        
        // Fatigue increases with trading
        this.fatigue = Math.min(1.0, this.fatigue + 0.01);
        
        // Fatigue decreases with rest (1% per hour)
        const hoursRested = timeSinceLastTrade / (1000 * 60 * 60);
        this.fatigue = Math.max(0.0, this.fatigue - (hoursRested * 0.01));
    }

    /**
     * Decay recent win/loss counters over time
     * @private
     */
    _decayRecentCounters() {
        // Decay recent wins/losses by 1% per trade
        this.recentWins = Math.max(0, this.recentWins * 0.99);
        this.recentLosses = Math.max(0, this.recentLosses * 0.99);
    }

    /**
     * Get current emotional state
     */
    getEmotionalState() {
        return {
            confidence: this.confidence,
            fear: this.fear,
            greed: this.greed,
            fatigue: this.fatigue,
            profitMomentum: this.profitMomentum
        };
    }

    /**
     * Get win rate
     */
    getWinRate() {
        if (this.totalTrades === 0) return 0.5;
        return (this.totalTrades - this.failedTrades) / this.totalTrades;
    }

    /**
     * Get recent performance (last 20 trades)
     */
    getRecentPerformance() {
        const recentTrades = this.pnlHistory.slice(-20);
        if (recentTrades.length === 0) return 0;
        
        const totalPnL = recentTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        return totalPnL / recentTrades.length;
    }

    /**
     * Check if wallet is traumatized
     */
    isTraumatized() {
        return this.traumaEvents.length > 0 && 
               (Date.now() - this.traumaEvents[this.traumaEvents.length - 1].timestamp) < 3600000; // 1 hour
    }

    /**
     * Get confidence modifier for trading decisions
     */
    getConfidenceModifier() {
        // High confidence = more aggressive
        // High fear = more cautious
        return (this.confidence * 1.5) - (this.fear * 1.0);
    }

    /**
     * Get fatigue modifier
     */
    getFatigueModifier() {
        // High fatigue reduces activity
        return 1.0 - (this.fatigue * 0.5);
    }

    /**
     * Should wallet rest?
     */
    shouldRest() {
        return this.fatigue > 0.8 || this.fear > 0.7;
    }

    /**
     * Record successful strategy
     */
    recordSuccessfulStrategy(strategyName, pnl) {
        if (!this.successfulStrategies[strategyName]) {
            this.successfulStrategies[strategyName] = {
                count: 0,
                totalPnL: 0,
                avgPnL: 0
            };
        }
        
        const strategy = this.successfulStrategies[strategyName];
        strategy.count++;
        strategy.totalPnL += pnl;
        strategy.avgPnL = strategy.totalPnL / strategy.count;
        
        this.updatedAt = Date.now();
    }

    /**
     * Get best performing strategy
     */
    getBestStrategy() {
        let best = null;
        let bestPnL = -Infinity;
        
        for (const [name, data] of Object.entries(this.successfulStrategies)) {
            if (data.avgPnL > bestPnL && data.count >= 3) {
                bestPnL = data.avgPnL;
                best = name;
            }
        }
        
        return best;
    }

    /**
     * Serialize memory for storage
     */
    toJSON() {
        return {
            confidence: this.confidence,
            fear: this.fear,
            greed: this.greed,
            fatigue: this.fatigue,
            pnlHistory: this.pnlHistory,
            recentWins: this.recentWins,
            recentLosses: this.recentLosses,
            failedTrades: this.failedTrades,
            totalTrades: this.totalTrades,
            averageHoldTime: this.averageHoldTime,
            successfulStrategies: this.successfulStrategies,
            profitableTimeWindows: this.profitableTimeWindows,
            traumaEvents: this.traumaEvents,
            maxDrawdown: this.maxDrawdown,
            consecutiveLosses: this.consecutiveLosses,
            maxConsecutiveLosses: this.maxConsecutiveLosses,
            profitMomentum: this.profitMomentum,
            winStreak: this.winStreak,
            lossStreak: this.lossStreak,
            lastTradeTime: this.lastTradeTime,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Create memory from JSON
     */
    static fromJSON(data) {
        return new WalletMemory(data);
    }
}

/**
 * Memory Engine - manages memory persistence
 */
class MemoryEngine {
    constructor(logger = console) {
        this.logger = logger;
        this.cache = new Map(); // walletKey -> Memory
    }

    /**
     * Initialize storage directory
     */
    async initialize() {
        try {
            await fs.mkdir(MEMORY_STORAGE_DIR, { recursive: true });
            this.logger.info('[MemoryEngine] Storage initialized');
        } catch (error) {
            this.logger.error('[MemoryEngine] Failed to initialize storage:', error);
        }
    }

    /**
     * Get or create memory for a wallet
     * @param {string} walletPublicKey - Wallet public key
     * @returns {Promise<WalletMemory>}
     */
    async getMemory(walletPublicKey) {
        // Check cache
        if (this.cache.has(walletPublicKey)) {
            return this.cache.get(walletPublicKey);
        }

        // Try to load from storage
        const stored = await this._loadMemory(walletPublicKey);
        if (stored) {
            this.cache.set(walletPublicKey, stored);
            return stored;
        }

        // Create new memory
        const newMemory = new WalletMemory();
        await this._saveMemory(walletPublicKey, newMemory);
        this.cache.set(walletPublicKey, newMemory);
        
        return newMemory;
    }

    /**
     * Save memory to storage
     */
    async saveMemory(walletPublicKey, memory) {
        await this._saveMemory(walletPublicKey, memory);
        this.cache.set(walletPublicKey, memory);
    }

    /**
     * Load memory from storage
     * @private
     */
    async _loadMemory(walletPublicKey) {
        try {
            const filePath = path.join(MEMORY_STORAGE_DIR, `${walletPublicKey}.json`);
            const data = await fs.readFile(filePath, 'utf8');
            return WalletMemory.fromJSON(JSON.parse(data));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.warn(`[MemoryEngine] Error loading memory for ${walletPublicKey.slice(0, 8)}:`, error.message);
            }
            return null;
        }
    }

    /**
     * Save memory to storage
     * @private
     */
    async _saveMemory(walletPublicKey, memory) {
        try {
            const filePath = path.join(MEMORY_STORAGE_DIR, `${walletPublicKey}.json`);
            await fs.writeFile(filePath, JSON.stringify(memory.toJSON(), null, 2));
        } catch (error) {
            this.logger.error(`[MemoryEngine] Error saving memory for ${walletPublicKey.slice(0, 8)}:`, error);
        }
    }

    /**
     * Get all cached memories
     */
    getAllMemories() {
        return Array.from(this.cache.entries()).map(([wallet, memory]) => ({
            wallet,
            memory: memory.toJSON()
        }));
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }
}

export { WalletMemory, MemoryEngine };
