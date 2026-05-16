/**
 * core/behavioralMutation.js
 * 
 * Behavioral mutation engine for gradual personality evolution
 * Prevents long-term synchronization through small, persistent mutations
 * 
 * Features:
 * - Gradual DNA mutation
 * - Emotional drift
 * - Adaptive preference evolution
 * - Nonlinear timing evolution
 * - Performance-based adaptation
 */

import { EntropyEngine } from '../entropyEngine.js';

/**
 * Mutation types
 */
const MutationType = {
    DNA_DRIFT: 'DNA_DRIFT',
    EMOTIONAL_DRIFT: 'EMOTIONAL_DRIFT',
    PREFERENCE_SHIFT: 'PREFERENCE_SHIFT',
    TIMING_EVOLUTION: 'TIMING_EVOLUTION',
    PERFORMANCE_ADAPTATION: 'PERFORMANCE_ADAPTATION'
};

/**
 * Behavioral mutation engine
 */
class BehavioralMutation {
    constructor(logger = console) {
        this.logger = logger;
        this.mutationHistory = new Map(); // walletKey -> mutation events
    }

    /**
     * Apply DNA mutation
     * Small, persistent changes to personality traits
     * 
     * @param {WalletDNA} dna - Wallet DNA
     * @param {WalletMemory} memory - Wallet memory
     * @param {number} mutationRate - Base mutation rate (0.0 to 1.0)
     * @returns {Object} Mutation summary
     */
    mutateDNA(dna, memory, mutationRate = 0.01) {
        const entropy = new EntropyEngine(`mutation-${Date.now()}`, 1000);
        const mutations = {};
        
        // Performance-based mutation rate adjustment
        const performanceModifier = this._getPerformanceMutationModifier(memory);
        const effectiveRate = mutationRate * performanceModifier;
        
        // Mutate each trait with small random walk
        const traits = [
            'aggression', 'patience', 'fearSensitivity', 'greedFactor',
            'conviction', 'volatilityAffinity', 'socialSusceptibility',
            'executionDiscipline', 'fatigueRate', 'dipBuyingBias',
            'impulsiveness', 'holdingStrength', 'riskTolerance', 'revengeTradingBias'
        ];
        
        for (const trait of traits) {
            if (entropy.getRandomBoolean(0.3)) { // 30% chance to mutate each trait
                const mutation = entropy.getNormalDistribution(0, effectiveRate);
                const oldValue = dna[trait];
                dna[trait] = this._clamp(oldValue + mutation);
                
                if (Math.abs(mutation) > 0.001) {
                    mutations[trait] = {
                        old: oldValue,
                        new: dna[trait],
                        delta: mutation
                    };
                }
            }
        }
        
        // Record mutation
        this._recordMutation(dna.walletKey || 'unknown', MutationType.DNA_DRIFT, mutations);
        
        return {
            type: MutationType.DNA_DRIFT,
            mutationCount: Object.keys(mutations).length,
            mutations
        };
    }

    /**
     * Apply emotional drift
     * Gradual shift in emotional baseline
     * 
     * @param {WalletEmotionalState} emotionalState - Emotional state
     * @param {WalletMemory} memory - Wallet memory
     * @returns {Object} Drift summary
     */
    applyEmotionalDrift(emotionalState, memory) {
        const entropy = new EntropyEngine(`emotion-drift-${Date.now()}`, 1000);
        const drifts = {};
        
        // Drift toward performance-based emotional baseline
        const targetConfidence = this._getTargetConfidence(memory);
        const targetFear = this._getTargetFear(memory);
        
        // Gradual drift
        const confidenceDrift = (targetConfidence - emotionalState.confidence) * 0.05;
        const fearDrift = (targetFear - emotionalState.fear) * 0.05;
        
        emotionalState.confidence = this._clamp(emotionalState.confidence + confidenceDrift);
        emotionalState.fear = this._clamp(emotionalState.fear + fearDrift);
        
        // Add random noise
        emotionalState.confidence = this._clamp(
            emotionalState.confidence + entropy.getNormalDistribution(0, 0.01)
        );
        emotionalState.fear = this._clamp(
            emotionalState.fear + entropy.getNormalDistribution(0, 0.01)
        );
        
        drifts.confidence = confidenceDrift;
        drifts.fear = fearDrift;
        
        return {
            type: MutationType.EMOTIONAL_DRIFT,
            drifts
        };
    }

    /**
     * Evolve trading preferences based on success
     * 
     * @param {WalletMemory} memory - Wallet memory
     * @param {Object} recentTrade - Recent trade outcome
     * @returns {Object} Evolution summary
     */
    evolvePreferences(memory, recentTrade) {
        const evolutions = {};
        
        // Successful trades reinforce behavior
        if (recentTrade.success && recentTrade.pnl > 0) {
            // Reinforce successful hold time
            if (recentTrade.holdTime) {
                const oldAvg = memory.averageHoldTime;
                memory.averageHoldTime = (oldAvg * 0.9) + (recentTrade.holdTime * 0.1);
                evolutions.holdTime = {
                    old: oldAvg,
                    new: memory.averageHoldTime
                };
            }
            
            // Reinforce successful strategy
            if (recentTrade.strategy) {
                memory.recordSuccessfulStrategy(recentTrade.strategy, recentTrade.pnl);
                evolutions.strategy = recentTrade.strategy;
            }
        }
        
        // Failed trades trigger adaptation
        else if (!recentTrade.success || recentTrade.pnl < 0) {
            // Adapt hold time
            if (recentTrade.holdTime && memory.averageHoldTime > 0) {
                // Try opposite direction
                const adjustment = recentTrade.holdTime > memory.averageHoldTime ? -0.1 : 0.1;
                memory.averageHoldTime = Math.max(0, memory.averageHoldTime * (1 + adjustment));
                evolutions.holdTime = {
                    adjustment,
                    new: memory.averageHoldTime
                };
            }
        }
        
        return {
            type: MutationType.PREFERENCE_SHIFT,
            evolutions
        };
    }

    /**
     * Evolve timing patterns to prevent synchronization
     * 
     * @param {Object} timingProfile - Current timing profile
     * @param {WalletDNA} dna - Wallet DNA
     * @returns {Object} Evolved timing profile
     */
    evolveTimingPattern(timingProfile, dna) {
        const entropy = new EntropyEngine(`timing-${Date.now()}`, 1000);
        
        // Add nonlinear drift to timing parameters
        const evolved = { ...timingProfile };
        
        // Mutate base interval
        if (evolved.baseInterval) {
            const drift = entropy.getNormalDistribution(0, evolved.baseInterval * 0.05);
            evolved.baseInterval = Math.max(1000, evolved.baseInterval + drift);
        }
        
        // Mutate jitter
        if (evolved.jitter !== undefined) {
            const drift = entropy.getNormalDistribution(0, 2);
            evolved.jitter = this._clamp(evolved.jitter + drift, 0, 50);
        }
        
        // Mutate lambda (for Poisson distribution)
        if (evolved.lambda) {
            const drift = entropy.getNormalDistribution(0, evolved.lambda * 0.03);
            evolved.lambda = Math.max(0.01, Math.min(2.0, evolved.lambda + drift));
        }
        
        // DNA-influenced timing evolution
        if (dna.impulsiveness > 0.7) {
            evolved.baseInterval = Math.max(1000, evolved.baseInterval * 0.95);
        } else if (dna.patience > 0.7) {
            evolved.baseInterval = evolved.baseInterval * 1.05;
        }
        
        return {
            type: MutationType.TIMING_EVOLUTION,
            old: timingProfile,
            new: evolved
        };
    }

    /**
     * Performance-based adaptation
     * Successful wallets become more aggressive, failing wallets more cautious
     * 
     * @param {WalletDNA} dna - Wallet DNA
     * @param {WalletMemory} memory - Wallet memory
     * @returns {Object} Adaptation summary
     */
    performanceAdaptation(dna, memory) {
        const adaptations = {};
        const winRate = memory.getWinRate();
        const recentPerf = memory.getRecentPerformance();
        
        // High win rate: increase aggression
        if (winRate > 0.7 && recentPerf > 0) {
            const increase = 0.02;
            dna.aggression = this._clamp(dna.aggression + increase);
            dna.riskTolerance = this._clamp(dna.riskTolerance + increase);
            adaptations.aggression = increase;
            adaptations.riskTolerance = increase;
        }
        
        // Low win rate: increase caution
        else if (winRate < 0.4 || recentPerf < -0.05) {
            const decrease = 0.02;
            dna.aggression = this._clamp(dna.aggression - decrease);
            dna.patience = this._clamp(dna.patience + decrease);
            adaptations.aggression = -decrease;
            adaptations.patience = decrease;
        }
        
        // Consecutive losses: reduce revenge trading bias
        if (memory.consecutiveLosses > 3) {
            const decrease = 0.03;
            dna.revengeTradingBias = this._clamp(dna.revengeTradingBias - decrease);
            adaptations.revengeTradingBias = -decrease;
        }
        
        // High profitability: increase conviction
        if (memory.profitMomentum > 0.5) {
            const increase = 0.01;
            dna.conviction = this._clamp(dna.conviction + increase);
            adaptations.conviction = increase;
        }
        
        return {
            type: MutationType.PERFORMANCE_ADAPTATION,
            adaptations
        };
    }

    /**
     * Get performance-based mutation rate modifier
     * @private
     */
    _getPerformanceMutationModifier(memory) {
        const winRate = memory.getWinRate();
        
        // Successful wallets mutate less (preserve winning behavior)
        if (winRate > 0.7) {
            return 0.5;
        }
        // Failing wallets mutate more (explore new behaviors)
        else if (winRate < 0.4) {
            return 2.0;
        }
        
        return 1.0;
    }

    /**
     * Get target confidence based on performance
     * @private
     */
    _getTargetConfidence(memory) {
        const winRate = memory.getWinRate();
        const recentPerf = memory.getRecentPerformance();
        
        let target = 0.5;
        
        if (winRate > 0.6) target += 0.2;
        if (recentPerf > 0.05) target += 0.1;
        if (memory.winStreak > 3) target += 0.1;
        
        return this._clamp(target);
    }

    /**
     * Get target fear based on performance
     * @private
     */
    _getTargetFear(memory) {
        const winRate = memory.getWinRate();
        const recentPerf = memory.getRecentPerformance();
        
        let target = 0.2;
        
        if (winRate < 0.4) target += 0.3;
        if (recentPerf < -0.05) target += 0.2;
        if (memory.consecutiveLosses > 3) target += 0.2;
        
        return this._clamp(target);
    }

    /**
     * Record mutation event
     * @private
     */
    _recordMutation(walletKey, type, details) {
        if (!this.mutationHistory.has(walletKey)) {
            this.mutationHistory.set(walletKey, []);
        }
        
        const history = this.mutationHistory.get(walletKey);
        history.push({
            type,
            details,
            timestamp: Date.now()
        });
        
        // Trim history
        if (history.length > 100) {
            this.mutationHistory.set(walletKey, history.slice(-100));
        }
    }

    /**
     * Clamp value between 0 and 1
     * @private
     */
    _clamp(value, min = 0, max = 1) {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Get mutation history for wallet
     */
    getMutationHistory(walletKey) {
        return this.mutationHistory.get(walletKey) || [];
    }

    /**
     * Get mutation statistics
     */
    getStats() {
        const allMutations = Array.from(this.mutationHistory.values()).flat();
        
        const byType = {};
        for (const mutation of allMutations) {
            byType[mutation.type] = (byType[mutation.type] || 0) + 1;
        }
        
        return {
            totalMutations: allMutations.length,
            walletsWithMutations: this.mutationHistory.size,
            byType
        };
    }

    /**
     * Clear history
     */
    clearHistory() {
        this.mutationHistory.clear();
    }
}

export { BehavioralMutation, MutationType };
