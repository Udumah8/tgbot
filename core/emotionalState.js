/**
 * core/emotionalState.js
 * 
 * Emotional state engine for wallet agents
 * Manages dynamic emotional states that evolve based on trading outcomes
 * 
 * Features:
 * - Dynamic emotional state transitions
 * - Emotion-driven behavior modifiers
 * - State persistence and evolution
 * - Emotional contagion support
 */

import fs from 'fs/promises';
import path from 'path';

const EMOTION_STORAGE_DIR = './storage/wallet_emotions';

/**
 * Emotional states
 */
const EmotionalState = {
    CONFIDENT: 'CONFIDENT',
    GREEDY: 'GREEDY',
    FEARFUL: 'FEARFUL',
    CAUTIOUS: 'CAUTIOUS',
    FOMO: 'FOMO',
    PANIC: 'PANIC',
    EXHAUSTED: 'EXHAUSTED',
    REVENGE_TRADING: 'REVENGE_TRADING',
    EUPHORIC: 'EUPHORIC',
    NEUTRAL: 'NEUTRAL'
};

/**
 * Wallet emotional state
 */
class WalletEmotionalState {
    constructor(data = {}) {
        this.currentState = data.currentState || EmotionalState.NEUTRAL;
        this.stateIntensity = data.stateIntensity || 0.5; // 0.0 to 1.0
        this.stateHistory = data.stateHistory || [];
        
        // Emotional metrics (0.0 to 1.0)
        this.confidence = data.confidence || 0.5;
        this.fear = data.fear || 0.0;
        this.greed = data.greed || 0.0;
        this.fatigue = data.fatigue || 0.0;
        this.frustration = data.frustration || 0.0;
        this.euphoria = data.euphoria || 0.0;
        
        // State duration tracking
        this.stateStartTime = data.stateStartTime || Date.now();
        this.stateDuration = data.stateDuration || 0;
        
        // Timestamps
        this.lastUpdate = data.lastUpdate || Date.now();
        this.createdAt = data.createdAt || Date.now();
    }

    /**
     * Update emotional state based on trade outcome
     * @param {Object} trade - Trade outcome
     * @param {Object} memory - Wallet memory
     * @param {Object} dna - Wallet DNA
     */
    updateFromTrade(trade, memory, dna) {
        const { success, pnl = 0, type } = trade;
        
        if (success && pnl > 0) {
            // Successful profitable trade
            this.confidence = Math.min(1.0, this.confidence + 0.05);
            this.fear = Math.max(0.0, this.fear - 0.03);
            this.greed = Math.min(1.0, this.greed + 0.04);
            this.euphoria = Math.min(1.0, this.euphoria + 0.06);
            this.frustration = Math.max(0.0, this.frustration - 0.05);
            
            // Check for euphoric state
            if (memory.winStreak >= 3 && this.euphoria > 0.7) {
                this._transitionTo(EmotionalState.EUPHORIC, 0.8);
            } else if (this.greed > 0.7 && this.confidence > 0.6) {
                this._transitionTo(EmotionalState.GREEDY, 0.7);
            } else if (this.confidence > 0.7) {
                this._transitionTo(EmotionalState.CONFIDENT, 0.6);
            }
            
        } else if (success && pnl <= 0) {
            // Successful trade but no profit
            this.confidence = Math.max(0.0, this.confidence - 0.02);
            this.frustration = Math.min(1.0, this.frustration + 0.03);
            
        } else {
            // Failed trade
            this.confidence = Math.max(0.0, this.confidence - 0.08);
            this.fear = Math.min(1.0, this.fear + 0.1 * dna.fearSensitivity);
            this.frustration = Math.min(1.0, this.frustration + 0.07);
            this.euphoria = Math.max(0.0, this.euphoria - 0.1);
            
            // Check for negative states
            if (memory.consecutiveLosses >= 3 && this.fear > 0.6) {
                this._transitionTo(EmotionalState.PANIC, 0.8);
            } else if (memory.consecutiveLosses >= 2 && this.frustration > 0.7) {
                this._transitionTo(EmotionalState.REVENGE_TRADING, 0.7);
            } else if (this.fear > 0.6) {
                this._transitionTo(EmotionalState.FEARFUL, 0.6);
            } else if (this.fear > 0.4) {
                this._transitionTo(EmotionalState.CAUTIOUS, 0.5);
            }
        }
        
        // Update fatigue
        this.fatigue = Math.min(1.0, this.fatigue + 0.01);
        
        // Check for exhaustion
        if (this.fatigue > 0.8) {
            this._transitionTo(EmotionalState.EXHAUSTED, 0.9);
        }
        
        this.lastUpdate = Date.now();
    }

    /**
     * Update emotional state from ecosystem conditions
     * @param {Object} ecosystem - Ecosystem state
     * @param {Object} dna - Wallet DNA
     */
    updateFromEcosystem(ecosystem, dna) {
        // High sentiment increases confidence
        if (ecosystem.sentiment > 0.7) {
            this.confidence = Math.min(1.0, this.confidence + 0.02);
            this.greed = Math.min(1.0, this.greed + 0.03);
        }
        
        // High fear index increases fear
        if (ecosystem.fearIndex > 0.6) {
            this.fear = Math.min(1.0, this.fear + 0.05 * dna.fearSensitivity);
        }
        
        // High hype creates FOMO
        if (ecosystem.hypeLevel > 0.8 && dna.socialSusceptibility > 0.5) {
            this._transitionTo(EmotionalState.FOMO, 0.7);
        }
        
        // Whale pressure creates FOMO
        if (ecosystem.whalePressure > 0.7 && dna.socialSusceptibility > 0.6) {
            this.greed = Math.min(1.0, this.greed + 0.04);
            if (this.currentState !== EmotionalState.FOMO) {
                this._transitionTo(EmotionalState.FOMO, 0.6);
            }
        }
        
        this.lastUpdate = Date.now();
    }

    /**
     * Transition to new emotional state
     * @private
     */
    _transitionTo(newState, intensity) {
        if (this.currentState !== newState) {
            // Record state history
            this.stateHistory.push({
                state: this.currentState,
                intensity: this.stateIntensity,
                duration: Date.now() - this.stateStartTime,
                timestamp: Date.now()
            });
            
            // Trim history
            if (this.stateHistory.length > 50) {
                this.stateHistory = this.stateHistory.slice(-50);
            }
            
            // Transition
            this.currentState = newState;
            this.stateIntensity = intensity;
            this.stateStartTime = Date.now();
        } else {
            // Update intensity
            this.stateIntensity = Math.max(this.stateIntensity, intensity);
        }
    }

    /**
     * Natural emotional decay over time
     */
    decay() {
        const now = Date.now();
        const hoursSinceUpdate = (now - this.lastUpdate) / (1000 * 60 * 60);
        
        // Decay extreme emotions
        this.fear = Math.max(0.0, this.fear - (hoursSinceUpdate * 0.05));
        this.greed = Math.max(0.0, this.greed - (hoursSinceUpdate * 0.04));
        this.euphoria = Math.max(0.0, this.euphoria - (hoursSinceUpdate * 0.06));
        this.frustration = Math.max(0.0, this.frustration - (hoursSinceUpdate * 0.03));
        this.fatigue = Math.max(0.0, this.fatigue - (hoursSinceUpdate * 0.02));
        
        // Confidence slowly returns to neutral
        if (this.confidence < 0.5) {
            this.confidence = Math.min(0.5, this.confidence + (hoursSinceUpdate * 0.02));
        } else if (this.confidence > 0.5) {
            this.confidence = Math.max(0.5, this.confidence - (hoursSinceUpdate * 0.01));
        }
        
        // Check if state should return to neutral
        if (this.fear < 0.3 && this.greed < 0.3 && this.euphoria < 0.3 && this.frustration < 0.3) {
            if (this.currentState !== EmotionalState.NEUTRAL) {
                this._transitionTo(EmotionalState.NEUTRAL, 0.5);
            }
        }
        
        this.lastUpdate = now;
    }

    /**
     * Get buy probability modifier based on emotional state
     */
    getBuyProbabilityModifier() {
        switch (this.currentState) {
            case EmotionalState.CONFIDENT:
                return 1.0 + (this.stateIntensity * 0.3);
            case EmotionalState.GREEDY:
                return 1.0 + (this.stateIntensity * 0.5);
            case EmotionalState.FOMO:
                return 1.0 + (this.stateIntensity * 0.7);
            case EmotionalState.EUPHORIC:
                return 1.0 + (this.stateIntensity * 0.6);
            case EmotionalState.FEARFUL:
                return 1.0 - (this.stateIntensity * 0.4);
            case EmotionalState.CAUTIOUS:
                return 1.0 - (this.stateIntensity * 0.2);
            case EmotionalState.PANIC:
                return 1.0 - (this.stateIntensity * 0.7);
            case EmotionalState.EXHAUSTED:
                return 1.0 - (this.stateIntensity * 0.6);
            case EmotionalState.REVENGE_TRADING:
                return 1.0 + (this.stateIntensity * 0.4);
            default:
                return 1.0;
        }
    }

    /**
     * Get sell probability modifier based on emotional state
     */
    getSellProbabilityModifier() {
        switch (this.currentState) {
            case EmotionalState.CONFIDENT:
                return 1.0 - (this.stateIntensity * 0.2);
            case EmotionalState.GREEDY:
                return 1.0 - (this.stateIntensity * 0.4);
            case EmotionalState.FEARFUL:
                return 1.0 + (this.stateIntensity * 0.3);
            case EmotionalState.PANIC:
                return 1.0 + (this.stateIntensity * 0.8);
            case EmotionalState.CAUTIOUS:
                return 1.0 + (this.stateIntensity * 0.2);
            case EmotionalState.EXHAUSTED:
                return 1.0 + (this.stateIntensity * 0.5);
            case EmotionalState.EUPHORIC:
                return 1.0 - (this.stateIntensity * 0.5);
            case EmotionalState.REVENGE_TRADING:
                return 1.0 + (this.stateIntensity * 0.3);
            default:
                return 1.0;
        }
    }

    /**
     * Get position size modifier based on emotional state
     */
    getPositionSizeModifier() {
        switch (this.currentState) {
            case EmotionalState.CONFIDENT:
                return 1.0 + (this.stateIntensity * 0.2);
            case EmotionalState.GREEDY:
                return 1.0 + (this.stateIntensity * 0.4);
            case EmotionalState.FOMO:
                return 1.0 + (this.stateIntensity * 0.5);
            case EmotionalState.EUPHORIC:
                return 1.0 + (this.stateIntensity * 0.3);
            case EmotionalState.REVENGE_TRADING:
                return 1.0 + (this.stateIntensity * 0.6);
            case EmotionalState.FEARFUL:
                return 1.0 - (this.stateIntensity * 0.3);
            case EmotionalState.CAUTIOUS:
                return 1.0 - (this.stateIntensity * 0.2);
            case EmotionalState.PANIC:
                return 1.0 - (this.stateIntensity * 0.5);
            case EmotionalState.EXHAUSTED:
                return 1.0 - (this.stateIntensity * 0.4);
            default:
                return 1.0;
        }
    }

    /**
     * Get holding duration modifier based on emotional state
     */
    getHoldingDurationModifier() {
        switch (this.currentState) {
            case EmotionalState.CONFIDENT:
                return 1.0 + (this.stateIntensity * 0.3);
            case EmotionalState.GREEDY:
                return 1.0 + (this.stateIntensity * 0.5);
            case EmotionalState.EUPHORIC:
                return 1.0 + (this.stateIntensity * 0.4);
            case EmotionalState.FEARFUL:
                return 1.0 - (this.stateIntensity * 0.3);
            case EmotionalState.PANIC:
                return 1.0 - (this.stateIntensity * 0.7);
            case EmotionalState.CAUTIOUS:
                return 1.0 - (this.stateIntensity * 0.1);
            case EmotionalState.REVENGE_TRADING:
                return 1.0 - (this.stateIntensity * 0.4);
            default:
                return 1.0;
        }
    }

    /**
     * Should wallet pause trading?
     */
    shouldPause() {
        return (
            (this.currentState === EmotionalState.PANIC && this.stateIntensity > 0.7) ||
            (this.currentState === EmotionalState.EXHAUSTED && this.stateIntensity > 0.8) ||
            this.fatigue > 0.9
        );
    }

    /**
     * Get emotional state summary
     */
    getSummary() {
        return {
            state: this.currentState,
            intensity: this.stateIntensity,
            duration: Date.now() - this.stateStartTime,
            metrics: {
                confidence: this.confidence,
                fear: this.fear,
                greed: this.greed,
                fatigue: this.fatigue,
                frustration: this.frustration,
                euphoria: this.euphoria
            }
        };
    }

    /**
     * Serialize for storage
     */
    toJSON() {
        return {
            currentState: this.currentState,
            stateIntensity: this.stateIntensity,
            stateHistory: this.stateHistory,
            confidence: this.confidence,
            fear: this.fear,
            greed: this.greed,
            fatigue: this.fatigue,
            frustration: this.frustration,
            euphoria: this.euphoria,
            stateStartTime: this.stateStartTime,
            stateDuration: this.stateDuration,
            lastUpdate: this.lastUpdate,
            createdAt: this.createdAt
        };
    }

    /**
     * Create from JSON
     */
    static fromJSON(data) {
        return new WalletEmotionalState(data);
    }
}

/**
 * Emotional State Engine - manages emotional state persistence
 */
class EmotionalStateEngine {
    constructor(logger = console) {
        this.logger = logger;
        this.cache = new Map(); // walletKey -> EmotionalState
    }

    /**
     * Initialize storage directory
     */
    async initialize() {
        try {
            await fs.mkdir(EMOTION_STORAGE_DIR, { recursive: true });
            this.logger.info('[EmotionalStateEngine] Storage initialized');
        } catch (error) {
            this.logger.error('[EmotionalStateEngine] Failed to initialize storage:', error);
        }
    }

    /**
     * Get or create emotional state for a wallet
     */
    async getEmotionalState(walletPublicKey) {
        // Check cache
        if (this.cache.has(walletPublicKey)) {
            return this.cache.get(walletPublicKey);
        }

        // Try to load from storage
        const stored = await this._loadEmotionalState(walletPublicKey);
        if (stored) {
            this.cache.set(walletPublicKey, stored);
            return stored;
        }

        // Create new emotional state
        const newState = new WalletEmotionalState();
        await this._saveEmotionalState(walletPublicKey, newState);
        this.cache.set(walletPublicKey, newState);
        
        return newState;
    }

    /**
     * Save emotional state
     */
    async saveEmotionalState(walletPublicKey, emotionalState) {
        await this._saveEmotionalState(walletPublicKey, emotionalState);
        this.cache.set(walletPublicKey, emotionalState);
    }

    /**
     * Load emotional state from storage
     * @private
     */
    async _loadEmotionalState(walletPublicKey) {
        try {
            const filePath = path.join(EMOTION_STORAGE_DIR, `${walletPublicKey}.json`);
            const data = await fs.readFile(filePath, 'utf8');
            return WalletEmotionalState.fromJSON(JSON.parse(data));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.warn(`[EmotionalStateEngine] Error loading state for ${walletPublicKey.slice(0, 8)}:`, error.message);
            }
            return null;
        }
    }

    /**
     * Save emotional state to storage
     * @private
     */
    async _saveEmotionalState(walletPublicKey, emotionalState) {
        try {
            const filePath = path.join(EMOTION_STORAGE_DIR, `${walletPublicKey}.json`);
            await fs.writeFile(filePath, JSON.stringify(emotionalState.toJSON(), null, 2));
        } catch (error) {
            this.logger.error(`[EmotionalStateEngine] Error saving state for ${walletPublicKey.slice(0, 8)}:`, error);
        }
    }

    /**
     * Get all cached emotional states
     */
    getAllEmotionalStates() {
        return Array.from(this.cache.entries()).map(([wallet, state]) => ({
            wallet,
            state: state.toJSON()
        }));
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }
}

export { WalletEmotionalState, EmotionalStateEngine, EmotionalState };
