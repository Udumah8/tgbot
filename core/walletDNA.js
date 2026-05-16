/**
 * core/walletDNA.js
 * 
 * Persistent personality DNA engine for wallet agents
 * DNA defines immutable personality traits that influence all behavior
 * 
 * Features:
 * - Deterministic generation from wallet seed
 * - Persistent storage across restarts
 * - Influences timing, sizing, risk tolerance, emotional responses
 * - Never regenerated after initial creation
 */

import { EntropyEngine } from '../entropyEngine.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DNA_STORAGE_DIR = './storage/wallet_dna';

/**
 * Wallet DNA structure - immutable personality traits
 */
class WalletDNA {
    constructor(traits) {
        // Core personality traits (0.0 to 1.0)
        this.aggression = traits.aggression || 0.5;              // Trading frequency and position sizing
        this.patience = traits.patience || 0.5;                  // Holding duration preference
        this.fearSensitivity = traits.fearSensitivity || 0.5;    // Reaction to losses and volatility
        this.greedFactor = traits.greedFactor || 0.5;            // Profit-taking behavior
        this.conviction = traits.conviction || 0.5;              // Resistance to panic selling
        this.volatilityAffinity = traits.volatilityAffinity || 0.5; // Preference for volatile conditions
        this.socialSusceptibility = traits.socialSusceptibility || 0.5; // Influence from other wallets
        this.executionDiscipline = traits.executionDiscipline || 0.5; // Adherence to strategy
        this.fatigueRate = traits.fatigueRate || 0.5;            // How quickly wallet gets exhausted
        this.dipBuyingBias = traits.dipBuyingBias || 0.5;        // Tendency to buy dips
        this.impulsiveness = traits.impulsiveness || 0.5;        // Spontaneous decision making
        this.holdingStrength = traits.holdingStrength || 0.5;    // Resistance to selling pressure
        this.riskTolerance = traits.riskTolerance || 0.5;        // Maximum position size comfort
        this.revengeTradingBias = traits.revengeTradingBias || 0.5; // Tendency to overtrade after losses
        
        // Derived traits
        this.personalityType = this._classifyPersonality();
        this.createdAt = traits.createdAt || Date.now();
        this.generation = traits.generation || 0;
    }

    /**
     * Classify personality type based on trait combinations
     * @private
     */
    _classifyPersonality() {
        const { aggression, patience, fearSensitivity, conviction } = this;
        
        if (aggression > 0.7 && fearSensitivity < 0.3) {
            return 'ALPHA_PREDATOR';
        } else if (patience > 0.7 && conviction > 0.7) {
            return 'DIAMOND_HANDS';
        } else if (fearSensitivity > 0.7 && impulsiveness > 0.6) {
            return 'PAPER_HANDS';
        } else if (aggression > 0.6 && impulsiveness > 0.6) {
            return 'DEGEN_GAMBLER';
        } else if (patience > 0.6 && executionDiscipline > 0.6) {
            return 'DISCIPLINED_TRADER';
        } else if (socialSusceptibility > 0.7) {
            return 'FOLLOWER';
        } else if (volatilityAffinity > 0.7 && riskTolerance > 0.7) {
            return 'VOLATILITY_HUNTER';
        } else {
            return 'BALANCED';
        }
    }

    /**
     * Get modifier for buy probability
     */
    getBuyProbabilityModifier(baseProb) {
        let modifier = 1.0;
        
        // Aggression increases buy frequency
        modifier *= (0.7 + this.aggression * 0.6);
        
        // Impulsiveness adds variance
        modifier *= (0.9 + this.impulsiveness * 0.2);
        
        return Math.min(1.0, baseProb * modifier);
    }

    /**
     * Get modifier for sell probability
     */
    getSellProbabilityModifier(baseProb) {
        let modifier = 1.0;
        
        // Holding strength reduces sell probability
        modifier *= (1.0 - this.holdingStrength * 0.3);
        
        // Patience reduces sell frequency
        modifier *= (1.0 - this.patience * 0.2);
        
        return Math.min(1.0, baseProb * modifier);
    }

    /**
     * Get position size modifier
     */
    getPositionSizeModifier(baseSize) {
        let modifier = 1.0;
        
        // Risk tolerance affects position sizing
        modifier *= (0.5 + this.riskTolerance * 1.0);
        
        // Aggression increases size
        modifier *= (0.8 + this.aggression * 0.4);
        
        return baseSize * modifier;
    }

    /**
     * Get holding duration modifier (multiplier for base duration)
     */
    getHoldingDurationModifier() {
        let modifier = 1.0;
        
        // Patience increases holding time
        modifier *= (0.5 + this.patience * 1.5);
        
        // Impulsiveness reduces holding time
        modifier *= (1.0 - this.impulsiveness * 0.4);
        
        return modifier;
    }

    /**
     * Get panic threshold (how much loss triggers panic)
     */
    getPanicThreshold() {
        // Lower threshold = easier to panic
        return 0.05 + (this.conviction * 0.15) - (this.fearSensitivity * 0.1);
    }

    /**
     * Get FOMO susceptibility
     */
    getFOMOSusceptibility() {
        return (this.impulsiveness * 0.5) + (this.greedFactor * 0.3) + (this.socialSusceptibility * 0.2);
    }

    /**
     * Get retry aggression (how aggressively to retry failed trades)
     */
    getRetryAggression() {
        return Math.floor(3 + (this.aggression * 4) + (this.revengeTradingBias * 3));
    }

    /**
     * Get slippage tolerance
     */
    getSlippageTolerance() {
        return 0.01 + (this.riskTolerance * 0.04) + (this.impulsiveness * 0.02);
    }

    /**
     * Serialize DNA for storage
     */
    toJSON() {
        return {
            aggression: this.aggression,
            patience: this.patience,
            fearSensitivity: this.fearSensitivity,
            greedFactor: this.greedFactor,
            conviction: this.conviction,
            volatilityAffinity: this.volatilityAffinity,
            socialSusceptibility: this.socialSusceptibility,
            executionDiscipline: this.executionDiscipline,
            fatigueRate: this.fatigueRate,
            dipBuyingBias: this.dipBuyingBias,
            impulsiveness: this.impulsiveness,
            holdingStrength: this.holdingStrength,
            riskTolerance: this.riskTolerance,
            revengeTradingBias: this.revengeTradingBias,
            personalityType: this.personalityType,
            createdAt: this.createdAt,
            generation: this.generation
        };
    }

    /**
     * Create DNA from JSON
     */
    static fromJSON(data) {
        return new WalletDNA(data);
    }
}

/**
 * DNA Engine - manages DNA generation and persistence
 */
class DNAEngine {
    constructor(logger = console) {
        this.logger = logger;
        this.cache = new Map(); // walletKey -> DNA
    }

    /**
     * Initialize storage directory
     */
    async initialize() {
        try {
            await fs.mkdir(DNA_STORAGE_DIR, { recursive: true });
            this.logger.info('[DNAEngine] Storage initialized');
        } catch (error) {
            this.logger.error('[DNAEngine] Failed to initialize storage:', error);
        }
    }

    /**
     * Get or create DNA for a wallet
     * @param {string} walletPublicKey - Wallet public key
     * @returns {Promise<WalletDNA>}
     */
    async getDNA(walletPublicKey) {
        // Check cache
        if (this.cache.has(walletPublicKey)) {
            return this.cache.get(walletPublicKey);
        }

        // Try to load from storage
        const stored = await this._loadDNA(walletPublicKey);
        if (stored) {
            this.cache.set(walletPublicKey, stored);
            return stored;
        }

        // Generate new DNA
        const newDNA = this._generateDNA(walletPublicKey);
        await this._saveDNA(walletPublicKey, newDNA);
        this.cache.set(walletPublicKey, newDNA);
        
        this.logger.info(`[DNAEngine] Generated new DNA for ${walletPublicKey.slice(0, 8)}: ${newDNA.personalityType}`);
        
        return newDNA;
    }

    /**
     * Generate DNA from wallet seed
     * @private
     */
    _generateDNA(walletPublicKey) {
        // Use wallet key as seed for deterministic generation
        const hash = crypto.createHash('sha256').update(walletPublicKey).digest();
        
        // Create entropy engine with wallet-specific seed
        const entropy = new EntropyEngine(walletPublicKey, 86400000); // 24h bucket for stability
        
        // Generate traits using normal distribution for realistic variance
        const traits = {
            aggression: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            patience: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            fearSensitivity: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            greedFactor: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            conviction: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            volatilityAffinity: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            socialSusceptibility: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            executionDiscipline: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            fatigueRate: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            dipBuyingBias: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            impulsiveness: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            holdingStrength: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            riskTolerance: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            revengeTradingBias: this._clamp(entropy.getNormalDistribution(0.5, 0.15)),
            createdAt: Date.now(),
            generation: 0
        };

        return new WalletDNA(traits);
    }

    /**
     * Load DNA from storage
     * @private
     */
    async _loadDNA(walletPublicKey) {
        try {
            const filePath = path.join(DNA_STORAGE_DIR, `${walletPublicKey}.json`);
            const data = await fs.readFile(filePath, 'utf8');
            return WalletDNA.fromJSON(JSON.parse(data));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.warn(`[DNAEngine] Error loading DNA for ${walletPublicKey.slice(0, 8)}:`, error.message);
            }
            return null;
        }
    }

    /**
     * Save DNA to storage
     * @private
     */
    async _saveDNA(walletPublicKey, dna) {
        try {
            const filePath = path.join(DNA_STORAGE_DIR, `${walletPublicKey}.json`);
            await fs.writeFile(filePath, JSON.stringify(dna.toJSON(), null, 2));
        } catch (error) {
            this.logger.error(`[DNAEngine] Error saving DNA for ${walletPublicKey.slice(0, 8)}:`, error);
        }
    }

    /**
     * Mutate DNA (for evolution)
     * @param {WalletDNA} dna - Original DNA
     * @param {number} mutationRate - Mutation strength (0.0 to 1.0)
     * @returns {WalletDNA} Mutated DNA
     */
    mutateDNA(dna, mutationRate = 0.05) {
        const traits = dna.toJSON();
        const entropy = new EntropyEngine(`mutation-${Date.now()}`, 1000);
        
        // Mutate each trait slightly
        for (const key of Object.keys(traits)) {
            if (typeof traits[key] === 'number' && key !== 'createdAt' && key !== 'generation') {
                const mutation = entropy.getNormalDistribution(0, mutationRate);
                traits[key] = this._clamp(traits[key] + mutation);
            }
        }
        
        traits.generation = (traits.generation || 0) + 1;
        
        return new WalletDNA(traits);
    }

    /**
     * Clamp value between 0 and 1
     * @private
     */
    _clamp(value) {
        return Math.max(0, Math.min(1, value));
    }

    /**
     * Get all cached DNA
     */
    getAllDNA() {
        return Array.from(this.cache.entries()).map(([wallet, dna]) => ({
            wallet,
            dna: dna.toJSON()
        }));
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }
}

export { WalletDNA, DNAEngine };
