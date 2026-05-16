/**
 * core/ecosystemState.js
 * 
 * Shared ecosystem state engine
 * Tracks aggregate market conditions that influence all wallet agents
 * 
 * Features:
 * - Real-time ecosystem metrics
 * - Dynamic sentiment tracking
 * - Whale activity monitoring
 * - Congestion and stress detection
 * - Momentum and pressure tracking
 */

import fs from 'fs/promises';
import path from 'path';

const ECOSYSTEM_STORAGE_PATH = './storage/ecosystem_state.json';

/**
 * Market regimes
 */
const MarketRegime = {
    BULL: 'BULL',
    BEAR: 'BEAR',
    SIDEWAYS: 'SIDEWAYS',
    VOLATILE: 'VOLATILE',
    LOW_LIQUIDITY: 'LOW_LIQUIDITY',
    DEAD: 'DEAD',
    PARABOLIC: 'PARABOLIC'
};

/**
 * Ecosystem state
 */
class EcosystemState {
    constructor(data = {}) {
        // Core metrics (0.0 to 1.0)
        this.sentiment = data.sentiment || 0.5;
        this.volatility = data.volatility || 0.3;
        this.hypeLevel = data.hypeLevel || 0.0;
        this.whalePressure = data.whalePressure || 0.0;
        this.congestion = data.congestion || 0.0;
        this.fearIndex = data.fearIndex || 0.0;
        this.momentum = data.momentum || 0.0;
        this.liquidityStress = data.liquidityStress || 0.0;
        this.buyPressure = data.buyPressure || 0.5;
        this.sellPressure = data.sellPressure || 0.5;
        
        // Market regime
        this.regime = data.regime || MarketRegime.SIDEWAYS;
        this.regimeStartTime = data.regimeStartTime || Date.now();
        
        // Activity tracking
        this.totalBuys = data.totalBuys || 0;
        this.totalSells = data.totalSells || 0;
        this.failedTransactions = data.failedTransactions || 0;
        this.successfulTransactions = data.successfulTransactions || 0;
        this.activeWallets = data.activeWallets || 0;
        
        // Whale tracking
        this.whaleAccumulation = data.whaleAccumulation || 0;
        this.whaleDistribution = data.whaleDistribution || 0;
        this.recentWhaleActivity = data.recentWhaleActivity || [];
        
        // Price tracking
        this.priceHistory = data.priceHistory || [];
        this.volumeHistory = data.volumeHistory || [];
        
        // Timestamps
        this.lastUpdate = data.lastUpdate || Date.now();
        this.createdAt = data.createdAt || Date.now();
    }

    /**
     * Update ecosystem from wallet activity
     * @param {Object} activity - Wallet activity data
     */
    updateFromActivity(activity) {
        const { type, success, amount, walletType, price, volume } = activity;
        
        // Update transaction counts
        if (success) {
            this.successfulTransactions++;
        } else {
            this.failedTransactions++;
        }
        
        // Update buy/sell counts
        if (type === 'BUY') {
            this.totalBuys++;
            this.buyPressure = Math.min(1.0, this.buyPressure + 0.01);
            this.sellPressure = Math.max(0.0, this.sellPressure - 0.005);
        } else if (type === 'SELL') {
            this.totalSells++;
            this.sellPressure = Math.min(1.0, this.sellPressure + 0.01);
            this.buyPressure = Math.max(0.0, this.buyPressure - 0.005);
        }
        
        // Track whale activity
        if (walletType === 'WHALE' || amount > 0.5) {
            if (type === 'BUY') {
                this.whaleAccumulation++;
                this.whalePressure = Math.min(1.0, this.whalePressure + 0.05);
            } else if (type === 'SELL') {
                this.whaleDistribution++;
                this.whalePressure = Math.max(0.0, this.whalePressure - 0.03);
            }
            
            this.recentWhaleActivity.push({
                type,
                amount,
                timestamp: Date.now()
            });
            
            // Trim whale activity history
            if (this.recentWhaleActivity.length > 100) {
                this.recentWhaleActivity = this.recentWhaleActivity.slice(-100);
            }
        }
        
        // Update congestion from failed transactions
        if (!success) {
            this.congestion = Math.min(1.0, this.congestion + 0.02);
        } else {
            this.congestion = Math.max(0.0, this.congestion - 0.01);
        }
        
        // Track price and volume
        if (price !== undefined) {
            this.priceHistory.push({ price, timestamp: Date.now() });
            if (this.priceHistory.length > 200) {
                this.priceHistory = this.priceHistory.slice(-200);
            }
        }
        
        if (volume !== undefined) {
            this.volumeHistory.push({ volume, timestamp: Date.now() });
            if (this.volumeHistory.length > 200) {
                this.volumeHistory = this.volumeHistory.slice(-200);
            }
        }
        
        // Update derived metrics
        this._updateDerivedMetrics();
        
        this.lastUpdate = Date.now();
    }

    /**
     * Update derived metrics
     * @private
     */
    _updateDerivedMetrics() {
        // Calculate sentiment from buy/sell pressure
        this.sentiment = (this.buyPressure * 0.6) + ((1.0 - this.sellPressure) * 0.4);
        
        // Calculate momentum from recent price action
        if (this.priceHistory.length >= 10) {
            const recent = this.priceHistory.slice(-10);
            const oldest = recent[0].price;
            const newest = recent[recent.length - 1].price;
            const change = (newest - oldest) / oldest;
            this.momentum = Math.max(-1.0, Math.min(1.0, change * 10));
        }
        
        // Calculate volatility from price variance
        if (this.priceHistory.length >= 20) {
            const recent = this.priceHistory.slice(-20);
            const prices = recent.map(p => p.price);
            const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
            const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
            const stdDev = Math.sqrt(variance);
            this.volatility = Math.min(1.0, (stdDev / mean) * 10);
        }
        
        // Calculate fear index from failed transactions and sell pressure
        const failureRate = this.failedTransactions / Math.max(1, this.successfulTransactions + this.failedTransactions);
        this.fearIndex = (failureRate * 0.4) + (this.sellPressure * 0.4) + ((1.0 - this.sentiment) * 0.2);
        
        // Calculate hype level from whale activity and momentum
        const whaleActivity = (this.whaleAccumulation - this.whaleDistribution) / Math.max(1, this.whaleAccumulation + this.whaleDistribution + 1);
        this.hypeLevel = Math.max(0.0, Math.min(1.0,
            (this.momentum * 0.4) + (whaleActivity * 0.3) + (this.sentiment * 0.3)
        ));
        
        // Calculate liquidity stress
        this.liquidityStress = (this.congestion * 0.5) + (failureRate * 0.5);
        
        // Detect market regime
        this._detectRegime();
    }

    /**
     * Detect current market regime
     * @private
     */
    _detectRegime() {
        const oldRegime = this.regime;
        
        // Parabolic: extreme momentum + high hype
        if (this.momentum > 0.7 && this.hypeLevel > 0.8) {
            this.regime = MarketRegime.PARABOLIC;
        }
        // Bull: positive momentum + positive sentiment
        else if (this.momentum > 0.3 && this.sentiment > 0.6) {
            this.regime = MarketRegime.BULL;
        }
        // Bear: negative momentum + negative sentiment
        else if (this.momentum < -0.3 && this.sentiment < 0.4) {
            this.regime = MarketRegime.BEAR;
        }
        // Volatile: high volatility
        else if (this.volatility > 0.7) {
            this.regime = MarketRegime.VOLATILE;
        }
        // Low liquidity: high liquidity stress
        else if (this.liquidityStress > 0.6) {
            this.regime = MarketRegime.LOW_LIQUIDITY;
        }
        // Dead: very low activity
        else if (this.activeWallets < 5 && this.totalBuys + this.totalSells < 10) {
            this.regime = MarketRegime.DEAD;
        }
        // Sideways: default
        else {
            this.regime = MarketRegime.SIDEWAYS;
        }
        
        // Reset regime start time if changed
        if (oldRegime !== this.regime) {
            this.regimeStartTime = Date.now();
        }
    }

    /**
     * Natural decay of metrics over time
     */
    decay() {
        const now = Date.now();
        const minutesSinceUpdate = (now - this.lastUpdate) / (1000 * 60);
        
        // Decay pressures toward neutral
        this.buyPressure = this._decayToward(this.buyPressure, 0.5, minutesSinceUpdate * 0.01);
        this.sellPressure = this._decayToward(this.sellPressure, 0.5, minutesSinceUpdate * 0.01);
        
        // Decay extreme metrics
        this.hypeLevel = Math.max(0.0, this.hypeLevel - (minutesSinceUpdate * 0.02));
        this.whalePressure = Math.max(0.0, this.whalePressure - (minutesSinceUpdate * 0.015));
        this.congestion = Math.max(0.0, this.congestion - (minutesSinceUpdate * 0.03));
        this.fearIndex = Math.max(0.0, this.fearIndex - (minutesSinceUpdate * 0.02));
        
        // Momentum decays toward zero
        this.momentum = this._decayToward(this.momentum, 0.0, minutesSinceUpdate * 0.015);
        
        this.lastUpdate = now;
    }

    /**
     * Decay value toward target
     * @private
     */
    _decayToward(value, target, rate) {
        if (value > target) {
            return Math.max(target, value - rate);
        } else if (value < target) {
            return Math.min(target, value + rate);
        }
        return value;
    }

    /**
     * Update active wallet count
     */
    updateActiveWallets(count) {
        this.activeWallets = count;
        this.lastUpdate = Date.now();
    }

    /**
     * Get regime-specific behavior modifiers
     */
    getRegimeModifiers() {
        switch (this.regime) {
            case MarketRegime.BULL:
                return {
                    aggressionMultiplier: 1.3,
                    positionSizeMultiplier: 1.2,
                    holdingDurationMultiplier: 1.4,
                    buyProbabilityMultiplier: 1.3,
                    sellProbabilityMultiplier: 0.7
                };
            case MarketRegime.BEAR:
                return {
                    aggressionMultiplier: 0.7,
                    positionSizeMultiplier: 0.8,
                    holdingDurationMultiplier: 0.6,
                    buyProbabilityMultiplier: 0.7,
                    sellProbabilityMultiplier: 1.4
                };
            case MarketRegime.PARABOLIC:
                return {
                    aggressionMultiplier: 1.5,
                    positionSizeMultiplier: 1.4,
                    holdingDurationMultiplier: 0.8,
                    buyProbabilityMultiplier: 1.6,
                    sellProbabilityMultiplier: 0.5
                };
            case MarketRegime.VOLATILE:
                return {
                    aggressionMultiplier: 0.9,
                    positionSizeMultiplier: 0.7,
                    holdingDurationMultiplier: 0.7,
                    buyProbabilityMultiplier: 1.0,
                    sellProbabilityMultiplier: 1.2
                };
            case MarketRegime.LOW_LIQUIDITY:
                return {
                    aggressionMultiplier: 0.6,
                    positionSizeMultiplier: 0.5,
                    holdingDurationMultiplier: 1.2,
                    buyProbabilityMultiplier: 0.6,
                    sellProbabilityMultiplier: 0.8
                };
            case MarketRegime.DEAD:
                return {
                    aggressionMultiplier: 0.3,
                    positionSizeMultiplier: 0.4,
                    holdingDurationMultiplier: 1.5,
                    buyProbabilityMultiplier: 0.4,
                    sellProbabilityMultiplier: 0.6
                };
            case MarketRegime.SIDEWAYS:
            default:
                return {
                    aggressionMultiplier: 1.0,
                    positionSizeMultiplier: 1.0,
                    holdingDurationMultiplier: 1.0,
                    buyProbabilityMultiplier: 1.0,
                    sellProbabilityMultiplier: 1.0
                };
        }
    }

    /**
     * Get ecosystem summary
     */
    getSummary() {
        return {
            regime: this.regime,
            regimeDuration: Date.now() - this.regimeStartTime,
            sentiment: this.sentiment,
            volatility: this.volatility,
            hypeLevel: this.hypeLevel,
            whalePressure: this.whalePressure,
            congestion: this.congestion,
            fearIndex: this.fearIndex,
            momentum: this.momentum,
            liquidityStress: this.liquidityStress,
            buyPressure: this.buyPressure,
            sellPressure: this.sellPressure,
            activeWallets: this.activeWallets,
            totalTransactions: this.successfulTransactions + this.failedTransactions,
            successRate: this.successfulTransactions / Math.max(1, this.successfulTransactions + this.failedTransactions)
        };
    }

    /**
     * Serialize for storage
     */
    toJSON() {
        return {
            sentiment: this.sentiment,
            volatility: this.volatility,
            hypeLevel: this.hypeLevel,
            whalePressure: this.whalePressure,
            congestion: this.congestion,
            fearIndex: this.fearIndex,
            momentum: this.momentum,
            liquidityStress: this.liquidityStress,
            buyPressure: this.buyPressure,
            sellPressure: this.sellPressure,
            regime: this.regime,
            regimeStartTime: this.regimeStartTime,
            totalBuys: this.totalBuys,
            totalSells: this.totalSells,
            failedTransactions: this.failedTransactions,
            successfulTransactions: this.successfulTransactions,
            activeWallets: this.activeWallets,
            whaleAccumulation: this.whaleAccumulation,
            whaleDistribution: this.whaleDistribution,
            recentWhaleActivity: this.recentWhaleActivity,
            priceHistory: this.priceHistory,
            volumeHistory: this.volumeHistory,
            lastUpdate: this.lastUpdate,
            createdAt: this.createdAt
        };
    }

    /**
     * Create from JSON
     */
    static fromJSON(data) {
        return new EcosystemState(data);
    }
}

/**
 * Ecosystem State Engine - manages shared ecosystem state
 */
class EcosystemStateEngine {
    constructor(logger = console) {
        this.logger = logger;
        this.state = new EcosystemState();
        this.autoSaveInterval = null;
    }

    /**
     * Initialize engine
     */
    async initialize() {
        try {
            // Try to load existing state
            const stored = await this._loadState();
            if (stored) {
                this.state = stored;
                this.logger.info('[EcosystemStateEngine] Loaded existing state');
            } else {
                this.logger.info('[EcosystemStateEngine] Created new state');
            }
            
            // Start auto-save
            this.startAutoSave(60000); // Save every minute
            
            // Start auto-decay
            this.startAutoDecay(30000); // Decay every 30 seconds
            
        } catch (error) {
            this.logger.error('[EcosystemStateEngine] Failed to initialize:', error);
        }
    }

    /**
     * Get current ecosystem state
     */
    getState() {
        return this.state;
    }

    /**
     * Update state from activity
     */
    updateFromActivity(activity) {
        this.state.updateFromActivity(activity);
    }

    /**
     * Update active wallet count
     */
    updateActiveWallets(count) {
        this.state.updateActiveWallets(count);
    }

    /**
     * Start auto-save interval
     */
    startAutoSave(intervalMs) {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }
        
        this.autoSaveInterval = setInterval(async () => {
            await this._saveState();
        }, intervalMs);
    }

    /**
     * Start auto-decay interval
     */
    startAutoDecay(intervalMs) {
        if (this.autoDecayInterval) {
            clearInterval(this.autoDecayInterval);
        }
        
        this.autoDecayInterval = setInterval(() => {
            this.state.decay();
        }, intervalMs);
    }

    /**
     * Stop auto-save
     */
    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
        if (this.autoDecayInterval) {
            clearInterval(this.autoDecayInterval);
            this.autoDecayInterval = null;
        }
    }

    /**
     * Load state from storage
     * @private
     */
    async _loadState() {
        try {
            const data = await fs.readFile(ECOSYSTEM_STORAGE_PATH, 'utf8');
            return EcosystemState.fromJSON(JSON.parse(data));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.warn('[EcosystemStateEngine] Error loading state:', error.message);
            }
            return null;
        }
    }

    /**
     * Save state to storage
     * @private
     */
    async _saveState() {
        try {
            const dir = path.dirname(ECOSYSTEM_STORAGE_PATH);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(ECOSYSTEM_STORAGE_PATH, JSON.stringify(this.state.toJSON(), null, 2));
        } catch (error) {
            this.logger.error('[EcosystemStateEngine] Error saving state:', error);
        }
    }

    /**
     * Shutdown engine
     */
    async shutdown() {
        this.stopAutoSave();
        await this._saveState();
        this.logger.info('[EcosystemStateEngine] Shutdown complete');
    }
}

export { EcosystemState, EcosystemStateEngine, MarketRegime };
