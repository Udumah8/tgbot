/**
 * core/lifecycleEngine.js
 * 
 * Wallet lifecycle management system
 * Manages wallet states like active, dormant, retired, evolving
 * 
 * Features:
 * - Dynamic lifecycle state transitions
 * - Dormancy and reactivation
 * - Retirement based on performance
 * - Wallet evolution and splitting
 * - Long-term ecosystem continuity
 */

import fs from 'fs/promises';
import path from 'path';

const LIFECYCLE_STORAGE_DIR = './storage/wallet_lifecycle';

/**
 * Lifecycle states
 */
const LifecycleState = {
    ACTIVE: 'ACTIVE',
    DORMANT: 'DORMANT',
    RETIRED: 'RETIRED',
    MIGRATING: 'MIGRATING',
    EVOLVING: 'EVOLVING',
    REACTIVATING: 'REACTIVATING'
};

/**
 * Wallet lifecycle
 */
class WalletLifecycle {
    constructor(walletKey, data = {}) {
        this.walletKey = walletKey;
        this.state = data.state || LifecycleState.ACTIVE;
        this.stateHistory = data.stateHistory || [];
        
        // Activity tracking
        this.totalTrades = data.totalTrades || 0;
        this.activeDays = data.activeDays || 0;
        this.dormantDays = data.dormantDays || 0;
        this.lastActiveTime = data.lastActiveTime || Date.now();
        this.lastStateChange = data.lastStateChange || Date.now();
        
        // Performance tracking
        this.lifetimePnL = data.lifetimePnL || 0.0;
        this.peakPnL = data.peakPnL || 0.0;
        this.worstDrawdown = data.worstDrawdown || 0.0;
        
        // Evolution tracking
        this.generation = data.generation || 0;
        this.parentWallet = data.parentWallet || null;
        this.childWallets = data.childWallets || [];
        
        // Retirement criteria
        this.consecutiveLosses = data.consecutiveLosses || 0;
        this.retirementReason = data.retirementReason || null;
        
        // Timestamps
        this.createdAt = data.createdAt || Date.now();
        this.updatedAt = data.updatedAt || Date.now();
    }

    /**
     * Update lifecycle from trade
     */
    updateFromTrade(trade) {
        this.totalTrades++;
        this.lastActiveTime = Date.now();
        
        // Update PnL
        if (trade.pnl !== undefined) {
            this.lifetimePnL += trade.pnl;
            this.peakPnL = Math.max(this.peakPnL, this.lifetimePnL);
            
            const drawdown = this.peakPnL - this.lifetimePnL;
            this.worstDrawdown = Math.max(this.worstDrawdown, drawdown);
        }
        
        // Track consecutive losses
        if (!trade.success || (trade.pnl !== undefined && trade.pnl < 0)) {
            this.consecutiveLosses++;
        } else {
            this.consecutiveLosses = 0;
        }
        
        // Check for retirement conditions
        this._checkRetirement();
        
        // Ensure active state
        if (this.state === LifecycleState.DORMANT) {
            this._transitionTo(LifecycleState.REACTIVATING);
            setTimeout(() => {
                if (this.state === LifecycleState.REACTIVATING) {
                    this._transitionTo(LifecycleState.ACTIVE);
                }
            }, 5000);
        }
        
        this.updatedAt = Date.now();
    }

    /**
     * Check if wallet should retire
     * @private
     */
    _checkRetirement() {
        // Retire after too many consecutive losses
        if (this.consecutiveLosses >= 10) {
            this._transitionTo(LifecycleState.RETIRED, 'Too many consecutive losses');
            return;
        }
        
        // Retire if drawdown is too severe
        if (this.worstDrawdown > 0.5 && this.lifetimePnL < -0.1) {
            this._transitionTo(LifecycleState.RETIRED, 'Severe drawdown');
            return;
        }
        
        // Retire if lifetime PnL is very negative
        if (this.lifetimePnL < -1.0) {
            this._transitionTo(LifecycleState.RETIRED, 'Negative lifetime PnL');
            return;
        }
    }

    /**
     * Transition to new lifecycle state
     * @private
     */
    _transitionTo(newState, reason = null) {
        if (this.state !== newState) {
            // Record state history
            this.stateHistory.push({
                from: this.state,
                to: newState,
                reason,
                duration: Date.now() - this.lastStateChange,
                timestamp: Date.now()
            });
            
            // Trim history
            if (this.stateHistory.length > 50) {
                this.stateHistory = this.stateHistory.slice(-50);
            }
            
            this.state = newState;
            this.lastStateChange = Date.now();
            
            if (newState === LifecycleState.RETIRED) {
                this.retirementReason = reason;
            }
        }
    }

    /**
     * Check if wallet should go dormant
     */
    checkDormancy(ecosystemState, memory, dna) {
        // Already dormant or retired
        if (this.state === LifecycleState.DORMANT || this.state === LifecycleState.RETIRED) {
            return;
        }
        
        const hoursSinceActive = (Date.now() - this.lastActiveTime) / (1000 * 60 * 60);
        
        // Go dormant if inactive for too long
        if (hoursSinceActive > 24) {
            this._transitionTo(LifecycleState.DORMANT, 'Inactivity timeout');
            return;
        }
        
        // Go dormant if exhausted
        if (memory.fatigue > 0.9) {
            this._transitionTo(LifecycleState.DORMANT, 'Exhaustion');
            return;
        }
        
        // Go dormant if traumatized
        if (memory.isTraumatized() && memory.fear > 0.8) {
            this._transitionTo(LifecycleState.DORMANT, 'Trauma');
            return;
        }
        
        // Go dormant in dead markets (low patience wallets)
        if (ecosystemState.regime === 'DEAD' && dna.patience < 0.3) {
            this._transitionTo(LifecycleState.DORMANT, 'Dead market');
            return;
        }
    }

    /**
     * Check if wallet should reactivate
     */
    checkReactivation(ecosystemState, memory, dna) {
        if (this.state !== LifecycleState.DORMANT) {
            return false;
        }
        
        const hoursSinceDormant = (Date.now() - this.lastStateChange) / (1000 * 60 * 60);
        
        // Reactivate after rest period
        if (hoursSinceDormant > 12 && memory.fatigue < 0.3) {
            this._transitionTo(LifecycleState.REACTIVATING, 'Rest complete');
            return true;
        }
        
        // Reactivate during high hype
        if (ecosystemState.hypeLevel > 0.8 && dna.socialSusceptibility > 0.6) {
            this._transitionTo(LifecycleState.REACTIVATING, 'FOMO reactivation');
            return true;
        }
        
        // Reactivate during parabolic moves
        if (ecosystemState.regime === 'PARABOLIC' && dna.greedFactor > 0.6) {
            this._transitionTo(LifecycleState.REACTIVATING, 'Parabolic reactivation');
            return true;
        }
        
        return false;
    }

    /**
     * Check if wallet should evolve (split capital)
     */
    shouldEvolve(memory, dna) {
        // Only successful wallets evolve
        if (this.lifetimePnL < 0.5) {
            return false;
        }
        
        // Only after significant trading history
        if (this.totalTrades < 50) {
            return false;
        }
        
        // High win rate
        if (memory.getWinRate() < 0.7) {
            return false;
        }
        
        // Not too many children already
        if (this.childWallets.length >= 3) {
            return false;
        }
        
        return true;
    }

    /**
     * Evolve wallet (create child)
     */
    evolve(childWalletKey) {
        this._transitionTo(LifecycleState.EVOLVING, 'Creating child wallet');
        
        this.childWallets.push({
            walletKey: childWalletKey,
            createdAt: Date.now(),
            generation: this.generation + 1
        });
        
        // Return to active after evolution
        setTimeout(() => {
            if (this.state === LifecycleState.EVOLVING) {
                this._transitionTo(LifecycleState.ACTIVE);
            }
        }, 1000);
        
        this.updatedAt = Date.now();
    }

    /**
     * Get activity modifier based on lifecycle state
     */
    getActivityModifier() {
        switch (this.state) {
            case LifecycleState.ACTIVE:
                return 1.0;
            case LifecycleState.DORMANT:
                return 0.0;
            case LifecycleState.RETIRED:
                return 0.0;
            case LifecycleState.REACTIVATING:
                return 0.5;
            case LifecycleState.EVOLVING:
                return 0.3;
            case LifecycleState.MIGRATING:
                return 0.2;
            default:
                return 1.0;
        }
    }

    /**
     * Is wallet active?
     */
    isActive() {
        return this.state === LifecycleState.ACTIVE || this.state === LifecycleState.REACTIVATING;
    }

    /**
     * Is wallet retired?
     */
    isRetired() {
        return this.state === LifecycleState.RETIRED;
    }

    /**
     * Get lifecycle summary
     */
    getSummary() {
        return {
            state: this.state,
            totalTrades: this.totalTrades,
            activeDays: this.activeDays,
            dormantDays: this.dormantDays,
            lifetimePnL: this.lifetimePnL,
            peakPnL: this.peakPnL,
            worstDrawdown: this.worstDrawdown,
            generation: this.generation,
            childCount: this.childWallets.length,
            retirementReason: this.retirementReason
        };
    }

    /**
     * Serialize for storage
     */
    toJSON() {
        return {
            walletKey: this.walletKey,
            state: this.state,
            stateHistory: this.stateHistory,
            totalTrades: this.totalTrades,
            activeDays: this.activeDays,
            dormantDays: this.dormantDays,
            lastActiveTime: this.lastActiveTime,
            lastStateChange: this.lastStateChange,
            lifetimePnL: this.lifetimePnL,
            peakPnL: this.peakPnL,
            worstDrawdown: this.worstDrawdown,
            generation: this.generation,
            parentWallet: this.parentWallet,
            childWallets: this.childWallets,
            consecutiveLosses: this.consecutiveLosses,
            retirementReason: this.retirementReason,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Create from JSON
     */
    static fromJSON(data) {
        return new WalletLifecycle(data.walletKey, data);
    }
}

/**
 * Lifecycle Engine - manages wallet lifecycles
 */
class LifecycleEngine {
    constructor(logger = console) {
        this.logger = logger;
        this.lifecycles = new Map(); // walletKey -> WalletLifecycle
    }

    /**
     * Initialize storage directory
     */
    async initialize() {
        try {
            await fs.mkdir(LIFECYCLE_STORAGE_DIR, { recursive: true });
            this.logger.info('[LifecycleEngine] Storage initialized');
        } catch (error) {
            this.logger.error('[LifecycleEngine] Failed to initialize storage:', error);
        }
    }

    /**
     * Get or create lifecycle for wallet
     */
    async getLifecycle(walletKey) {
        // Check cache
        if (this.lifecycles.has(walletKey)) {
            return this.lifecycles.get(walletKey);
        }

        // Try to load from storage
        const stored = await this._loadLifecycle(walletKey);
        if (stored) {
            this.lifecycles.set(walletKey, stored);
            return stored;
        }

        // Create new lifecycle
        const newLifecycle = new WalletLifecycle(walletKey);
        await this._saveLifecycle(walletKey, newLifecycle);
        this.lifecycles.set(walletKey, newLifecycle);
        
        return newLifecycle;
    }

    /**
     * Save lifecycle
     */
    async saveLifecycle(walletKey, lifecycle) {
        await this._saveLifecycle(walletKey, lifecycle);
        this.lifecycles.set(walletKey, lifecycle);
    }

    /**
     * Load lifecycle from storage
     * @private
     */
    async _loadLifecycle(walletKey) {
        try {
            const filePath = path.join(LIFECYCLE_STORAGE_DIR, `${walletKey}.json`);
            const data = await fs.readFile(filePath, 'utf8');
            return WalletLifecycle.fromJSON(JSON.parse(data));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.warn(`[LifecycleEngine] Error loading lifecycle for ${walletKey.slice(0, 8)}:`, error.message);
            }
            return null;
        }
    }

    /**
     * Save lifecycle to storage
     * @private
     */
    async _saveLifecycle(walletKey, lifecycle) {
        try {
            const filePath = path.join(LIFECYCLE_STORAGE_DIR, `${walletKey}.json`);
            await fs.writeFile(filePath, JSON.stringify(lifecycle.toJSON(), null, 2));
        } catch (error) {
            this.logger.error(`[LifecycleEngine] Error saving lifecycle for ${walletKey.slice(0, 8)}:`, error);
        }
    }

    /**
     * Get lifecycle statistics
     */
    getStats() {
        const lifecycles = Array.from(this.lifecycles.values());
        
        return {
            total: lifecycles.length,
            active: lifecycles.filter(l => l.state === LifecycleState.ACTIVE).length,
            dormant: lifecycles.filter(l => l.state === LifecycleState.DORMANT).length,
            retired: lifecycles.filter(l => l.state === LifecycleState.RETIRED).length,
            evolving: lifecycles.filter(l => l.state === LifecycleState.EVOLVING).length,
            reactivating: lifecycles.filter(l => l.state === LifecycleState.REACTIVATING).length,
            avgLifetimePnL: lifecycles.reduce((sum, l) => sum + l.lifetimePnL, 0) / Math.max(1, lifecycles.length),
            totalTrades: lifecycles.reduce((sum, l) => sum + l.totalTrades, 0)
        };
    }

    /**
     * Get all lifecycles
     */
    getAllLifecycles() {
        return Array.from(this.lifecycles.entries()).map(([wallet, lifecycle]) => ({
            wallet,
            lifecycle: lifecycle.toJSON()
        }));
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.lifecycles.clear();
    }
}

export { WalletLifecycle, LifecycleEngine, LifecycleState };
