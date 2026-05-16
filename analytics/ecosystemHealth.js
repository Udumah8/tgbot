/**
 * analytics/ecosystemHealth.js
 * 
 * Ecosystem health monitoring and automatic correction system
 * Detects and prevents pathological behaviors
 * 
 * Features:
 * - Synchronization risk detection
 * - Timing correlation analysis
 * - Behavioral clustering detection
 * - Panic cascade prevention
 * - Automatic correction systems
 */

/**
 * Health status levels
 */
const HealthStatus = {
    HEALTHY: 'HEALTHY',
    WARNING: 'WARNING',
    CRITICAL: 'CRITICAL',
    EMERGENCY: 'EMERGENCY'
};

/**
 * Health issues
 */
const HealthIssue = {
    SYNCHRONIZATION: 'SYNCHRONIZATION',
    TIMING_CORRELATION: 'TIMING_CORRELATION',
    BEHAVIORAL_CLUSTERING: 'BEHAVIORAL_CLUSTERING',
    EXCESSIVE_AGGRESSION: 'EXCESSIVE_AGGRESSION',
    PANIC_CASCADE: 'PANIC_CASCADE',
    RPC_FAILURE_CASCADE: 'RPC_FAILURE_CASCADE',
    WALLET_DEATH_SPIKE: 'WALLET_DEATH_SPIKE',
    LIQUIDITY_CRISIS: 'LIQUIDITY_CRISIS'
};

/**
 * Ecosystem health monitor
 */
class EcosystemHealthMonitor {
    constructor(logger = console) {
        this.logger = logger;
        this.healthStatus = HealthStatus.HEALTHY;
        this.activeIssues = new Set();
        this.issueHistory = [];
        this.correctionHistory = [];
        this.lastCheck = Date.now();
    }

    /**
     * Perform comprehensive health check
     * 
     * @param {Object} context - Health check context
     * @returns {Object} Health report
     */
    performHealthCheck(context) {
        const {
            wallets,
            ecosystemState,
            socialGraph,
            lifecycleEngine,
            recentTrades
        } = context;
        
        const issues = [];
        
        // Check synchronization risk
        const syncIssue = this._checkSynchronization(wallets, recentTrades);
        if (syncIssue) issues.push(syncIssue);
        
        // Check timing correlation
        const timingIssue = this._checkTimingCorrelation(recentTrades);
        if (timingIssue) issues.push(timingIssue);
        
        // Check behavioral clustering
        const clusterIssue = this._checkBehavioralClustering(wallets);
        if (clusterIssue) issues.push(clusterIssue);
        
        // Check excessive aggression
        const aggressionIssue = this._checkExcessiveAggression(wallets, ecosystemState);
        if (aggressionIssue) issues.push(aggressionIssue);
        
        // Check panic cascades
        const panicIssue = this._checkPanicCascade(wallets, ecosystemState);
        if (panicIssue) issues.push(panicIssue);
        
        // Check RPC failures
        const rpcIssue = this._checkRPCFailures(ecosystemState);
        if (rpcIssue) issues.push(rpcIssue);
        
        // Check wallet death rate
        const deathIssue = this._checkWalletDeathRate(lifecycleEngine);
        if (deathIssue) issues.push(deathIssue);
        
        // Check liquidity crisis
        const liquidityIssue = this._checkLiquidityCrisis(ecosystemState);
        if (liquidityIssue) issues.push(liquidityIssue);
        
        // Update health status
        this._updateHealthStatus(issues);
        
        // Record issues
        for (const issue of issues) {
            this.activeIssues.add(issue.type);
            this._recordIssue(issue);
        }
        
        this.lastCheck = Date.now();
        
        return {
            status: this.healthStatus,
            issues,
            activeIssueCount: this.activeIssues.size,
            timestamp: Date.now()
        };
    }

    /**
     * Check for synchronization risk
     * @private
     */
    _checkSynchronization(wallets, recentTrades) {
        if (!recentTrades || recentTrades.length < 10) return null;
        
        // Check if trades are happening in tight clusters
        const recent = recentTrades.slice(-20);
        const timestamps = recent.map(t => t.timestamp);
        
        // Calculate time gaps
        const gaps = [];
        for (let i = 1; i < timestamps.length; i++) {
            gaps.push(timestamps[i] - timestamps[i - 1]);
        }
        
        // Check for suspiciously small gaps (< 100ms)
        const tightGaps = gaps.filter(g => g < 100).length;
        const syncRatio = tightGaps / gaps.length;
        
        if (syncRatio > 0.5) {
            return {
                type: HealthIssue.SYNCHRONIZATION,
                severity: syncRatio > 0.7 ? 'CRITICAL' : 'WARNING',
                details: {
                    syncRatio,
                    tightGaps,
                    totalGaps: gaps.length
                },
                message: `High synchronization detected: ${(syncRatio * 100).toFixed(1)}% of trades within 100ms`
            };
        }
        
        return null;
    }

    /**
     * Check for timing correlation
     * @private
     */
    _checkTimingCorrelation(recentTrades) {
        if (!recentTrades || recentTrades.length < 20) return null;
        
        const recent = recentTrades.slice(-50);
        const intervals = [];
        
        for (let i = 1; i < recent.length; i++) {
            intervals.push(recent[i].timestamp - recent[i - 1].timestamp);
        }
        
        // Calculate coefficient of variation
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / intervals.length;
        const stdDev = Math.sqrt(variance);
        const cv = stdDev / mean;
        
        // Low CV indicates high correlation (predictable timing)
        if (cv < 0.3) {
            return {
                type: HealthIssue.TIMING_CORRELATION,
                severity: cv < 0.2 ? 'CRITICAL' : 'WARNING',
                details: {
                    coefficientOfVariation: cv,
                    meanInterval: mean,
                    stdDev
                },
                message: `High timing correlation detected: CV = ${cv.toFixed(3)}`
            };
        }
        
        return null;
    }

    /**
     * Check for behavioral clustering
     * @private
     */
    _checkBehavioralClustering(wallets) {
        if (!wallets || wallets.length < 10) return null;
        
        // Check if too many wallets have similar emotional states
        const states = {};
        for (const wallet of wallets) {
            if (wallet.emotionalState) {
                const state = wallet.emotionalState.currentState;
                states[state] = (states[state] || 0) + 1;
            }
        }
        
        // Find dominant state
        let maxCount = 0;
        let dominantState = null;
        for (const [state, count] of Object.entries(states)) {
            if (count > maxCount) {
                maxCount = count;
                dominantState = state;
            }
        }
        
        const clusterRatio = maxCount / wallets.length;
        
        if (clusterRatio > 0.6) {
            return {
                type: HealthIssue.BEHAVIORAL_CLUSTERING,
                severity: clusterRatio > 0.8 ? 'CRITICAL' : 'WARNING',
                details: {
                    dominantState,
                    clusterRatio,
                    affectedWallets: maxCount
                },
                message: `Behavioral clustering detected: ${(clusterRatio * 100).toFixed(1)}% in ${dominantState} state`
            };
        }
        
        return null;
    }

    /**
     * Check for excessive aggression
     * @private
     */
    _checkExcessiveAggression(wallets, ecosystemState) {
        if (!wallets || wallets.length === 0) return null;
        
        // Calculate average aggression
        let totalAggression = 0;
        let count = 0;
        
        for (const wallet of wallets) {
            if (wallet.dna && wallet.dna.aggression !== undefined) {
                totalAggression += wallet.dna.aggression;
                count++;
            }
        }
        
        const avgAggression = count > 0 ? totalAggression / count : 0.5;
        
        // Check if aggression is too high given ecosystem state
        const maxSafeAggression = ecosystemState.liquidityStress > 0.5 ? 0.6 : 0.8;
        
        if (avgAggression > maxSafeAggression) {
            return {
                type: HealthIssue.EXCESSIVE_AGGRESSION,
                severity: avgAggression > 0.9 ? 'CRITICAL' : 'WARNING',
                details: {
                    avgAggression,
                    maxSafeAggression,
                    liquidityStress: ecosystemState.liquidityStress
                },
                message: `Excessive aggression: avg ${avgAggression.toFixed(2)} exceeds safe limit ${maxSafeAggression.toFixed(2)}`
            };
        }
        
        return null;
    }

    /**
     * Check for panic cascade
     * @private
     */
    _checkPanicCascade(wallets, ecosystemState) {
        if (!wallets || wallets.length === 0) return null;
        
        // Count wallets in panic or fearful states
        let panicCount = 0;
        let fearfulCount = 0;
        
        for (const wallet of wallets) {
            if (wallet.emotionalState) {
                if (wallet.emotionalState.currentState === 'PANIC') {
                    panicCount++;
                } else if (wallet.emotionalState.currentState === 'FEARFUL') {
                    fearfulCount++;
                }
            }
        }
        
        const panicRatio = (panicCount + fearfulCount) / wallets.length;
        
        if (panicRatio > 0.4 || (panicCount > 5 && ecosystemState.fearIndex > 0.6)) {
            return {
                type: HealthIssue.PANIC_CASCADE,
                severity: panicRatio > 0.6 ? 'EMERGENCY' : 'CRITICAL',
                details: {
                    panicCount,
                    fearfulCount,
                    panicRatio,
                    fearIndex: ecosystemState.fearIndex
                },
                message: `Panic cascade detected: ${panicCount} panicked, ${fearfulCount} fearful`
            };
        }
        
        return null;
    }

    /**
     * Check for RPC failure cascade
     * @private
     */
    _checkRPCFailures(ecosystemState) {
        const failureRate = ecosystemState.failedTransactions / 
            Math.max(1, ecosystemState.successfulTransactions + ecosystemState.failedTransactions);
        
        if (failureRate > 0.3) {
            return {
                type: HealthIssue.RPC_FAILURE_CASCADE,
                severity: failureRate > 0.5 ? 'EMERGENCY' : 'CRITICAL',
                details: {
                    failureRate,
                    failedTransactions: ecosystemState.failedTransactions,
                    totalTransactions: ecosystemState.successfulTransactions + ecosystemState.failedTransactions
                },
                message: `High RPC failure rate: ${(failureRate * 100).toFixed(1)}%`
            };
        }
        
        return null;
    }

    /**
     * Check wallet death rate
     * @private
     */
    _checkWalletDeathRate(lifecycleEngine) {
        const stats = lifecycleEngine.getStats();
        const deathRate = stats.retired / Math.max(1, stats.total);
        
        if (deathRate > 0.3) {
            return {
                type: HealthIssue.WALLET_DEATH_SPIKE,
                severity: deathRate > 0.5 ? 'CRITICAL' : 'WARNING',
                details: {
                    deathRate,
                    retired: stats.retired,
                    total: stats.total
                },
                message: `High wallet death rate: ${(deathRate * 100).toFixed(1)}%`
            };
        }
        
        return null;
    }

    /**
     * Check for liquidity crisis
     * @private
     */
    _checkLiquidityCrisis(ecosystemState) {
        if (ecosystemState.liquidityStress > 0.7) {
            return {
                type: HealthIssue.LIQUIDITY_CRISIS,
                severity: ecosystemState.liquidityStress > 0.9 ? 'EMERGENCY' : 'CRITICAL',
                details: {
                    liquidityStress: ecosystemState.liquidityStress,
                    congestion: ecosystemState.congestion
                },
                message: `Liquidity crisis: stress level ${ecosystemState.liquidityStress.toFixed(2)}`
            };
        }
        
        return null;
    }

    /**
     * Update overall health status
     * @private
     */
    _updateHealthStatus(issues) {
        if (issues.length === 0) {
            this.healthStatus = HealthStatus.HEALTHY;
            this.activeIssues.clear();
            return;
        }
        
        const hasCritical = issues.some(i => i.severity === 'CRITICAL');
        const hasEmergency = issues.some(i => i.severity === 'EMERGENCY');
        
        if (hasEmergency) {
            this.healthStatus = HealthStatus.EMERGENCY;
        } else if (hasCritical) {
            this.healthStatus = HealthStatus.CRITICAL;
        } else {
            this.healthStatus = HealthStatus.WARNING;
        }
    }

    /**
     * Apply automatic corrections
     * 
     * @param {Object} context - Correction context
     * @returns {Array} Applied corrections
     */
    applyCorrections(context) {
        const corrections = [];
        
        for (const issueType of this.activeIssues) {
            const correction = this._getCorrection(issueType, context);
            if (correction) {
                corrections.push(correction);
                this._recordCorrection(correction);
            }
        }
        
        return corrections;
    }

    /**
     * Get correction for issue type
     * @private
     */
    _getCorrection(issueType, context) {
        switch (issueType) {
            case HealthIssue.SYNCHRONIZATION:
                return this._correctSynchronization(context);
            case HealthIssue.TIMING_CORRELATION:
                return this._correctTimingCorrelation(context);
            case HealthIssue.EXCESSIVE_AGGRESSION:
                return this._correctExcessiveAggression(context);
            case HealthIssue.PANIC_CASCADE:
                return this._correctPanicCascade(context);
            case HealthIssue.RPC_FAILURE_CASCADE:
                return this._correctRPCFailures(context);
            case HealthIssue.WALLET_DEATH_SPIKE:
                return this._correctWalletDeaths(context);
            case HealthIssue.LIQUIDITY_CRISIS:
                return this._correctLiquidityCrisis(context);
            default:
                return null;
        }
    }

    /**
     * Correct synchronization
     * @private
     */
    _correctSynchronization(context) {
        return {
            type: 'INCREASE_TIMING_VARIANCE',
            action: 'Increase jitter and timing variance across all wallets',
            parameters: {
                jitterIncrease: 50,
                timingVarianceMultiplier: 2.0
            }
        };
    }

    /**
     * Correct timing correlation
     * @private
     */
    _correctTimingCorrelation(context) {
        return {
            type: 'DIVERSIFY_TIMING',
            action: 'Apply nonlinear timing mutations to break correlation',
            parameters: {
                mutationRate: 0.1,
                targetCV: 0.5
            }
        };
    }

    /**
     * Correct excessive aggression
     * @private
     */
    _correctExcessiveAggression(context) {
        return {
            type: 'REDUCE_AGGRESSION',
            action: 'Globally reduce aggression and increase patience',
            parameters: {
                aggressionReduction: 0.2,
                patienceIncrease: 0.1
            }
        };
    }

    /**
     * Correct panic cascade
     * @private
     */
    _correctPanicCascade(context) {
        return {
            type: 'CALM_ECOSYSTEM',
            action: 'Force dormancy for panicked wallets and reduce fear propagation',
            parameters: {
                forceDormancy: true,
                fearPropagationMultiplier: 0.5
            }
        };
    }

    /**
     * Correct RPC failures
     * @private
     */
    _correctRPCFailures(context) {
        return {
            type: 'REDUCE_ACTIVITY',
            action: 'Reduce overall activity to ease RPC load',
            parameters: {
                activityReduction: 0.5,
                retryBackoff: 2.0
            }
        };
    }

    /**
     * Correct wallet deaths
     * @private
     */
    _correctWalletDeaths(context) {
        return {
            type: 'INCREASE_CAUTION',
            action: 'Increase caution and reduce risk across ecosystem',
            parameters: {
                riskReduction: 0.3,
                cautionIncrease: 0.2
            }
        };
    }

    /**
     * Correct liquidity crisis
     * @private
     */
    _correctLiquidityCrisis(context) {
        return {
            type: 'REDUCE_POSITION_SIZES',
            action: 'Reduce position sizes and increase spacing',
            parameters: {
                positionSizeMultiplier: 0.5,
                minSpacing: 5000
            }
        };
    }

    /**
     * Record issue
     * @private
     */
    _recordIssue(issue) {
        this.issueHistory.push({
            ...issue,
            timestamp: Date.now()
        });
        
        // Trim history
        if (this.issueHistory.length > 1000) {
            this.issueHistory = this.issueHistory.slice(-1000);
        }
    }

    /**
     * Record correction
     * @private
     */
    _recordCorrection(correction) {
        this.correctionHistory.push({
            ...correction,
            timestamp: Date.now()
        });
        
        // Trim history
        if (this.correctionHistory.length > 500) {
            this.correctionHistory = this.correctionHistory.slice(-500);
        }
    }

    /**
     * Get health summary
     */
    getSummary() {
        return {
            status: this.healthStatus,
            activeIssues: Array.from(this.activeIssues),
            recentIssues: this.issueHistory.slice(-10),
            recentCorrections: this.correctionHistory.slice(-10),
            lastCheck: this.lastCheck
        };
    }
}

export { EcosystemHealthMonitor, HealthStatus, HealthIssue };
