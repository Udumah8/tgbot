/**
 * core/behavioralEcosystem.js
 * 
 * Master orchestrator for the persistent adaptive behavioral ecosystem
 * Integrates all behavioral systems into a cohesive emergent ecosystem
 * 
 * Features:
 * - Centralized ecosystem management
 * - Automatic system initialization
 * - Behavioral modifier composition
 * - Health monitoring and correction
 * - Persistent state management
 */

import { DNAEngine } from './walletDNA.js';
import { MemoryEngine } from './walletMemory.js';
import { EmotionalStateEngine } from './emotionalState.js';
import { EcosystemStateEngine } from './ecosystemState.js';
import { SocialGraphEngine } from './socialGraph.js';
import { LifecycleEngine } from './lifecycleEngine.js';
import { BehavioralMutation } from './behavioralMutation.js';
import { EcosystemHealthMonitor } from '../analytics/ecosystemHealth.js';

/**
 * Behavioral Ecosystem Orchestrator
 * 
 * This is the central integration point for all behavioral systems.
 * It manages the lifecycle of all engines and provides a unified interface
 * for wallet agents to access behavioral modifiers.
 */
class BehavioralEcosystem {
    constructor(logger = console) {
        this.logger = logger;
        
        // Core engines
        this.dnaEngine = new DNAEngine(logger);
        this.memoryEngine = new MemoryEngine(logger);
        this.emotionalEngine = new EmotionalStateEngine(logger);
        this.ecosystemEngine = new EcosystemStateEngine(logger);
        this.socialGraphEngine = new SocialGraphEngine(logger);
        this.lifecycleEngine = new LifecycleEngine(logger);
        
        // Behavioral systems
        this.mutationEngine = new BehavioralMutation(logger);
        this.healthMonitor = new EcosystemHealthMonitor(logger);
        
        // State
        this.initialized = false;
        this.walletContexts = new Map(); // walletKey -> full context
        this.recentTrades = [];
        
        // Auto-update intervals
        this.mutationInterval = null;
        this.healthCheckInterval = null;
    }

    /**
     * Initialize all engines
     */
    async initialize() {
        if (this.initialized) {
            this.logger.warn('[BehavioralEcosystem] Already initialized');
            return;
        }

        this.logger.info('[BehavioralEcosystem] Initializing ecosystem...');

        try {
            // Initialize all engines in parallel
            await Promise.all([
                this.dnaEngine.initialize(),
                this.memoryEngine.initialize(),
                this.emotionalEngine.initialize(),
                this.ecosystemEngine.initialize(),
                this.socialGraphEngine.initialize(),
                this.lifecycleEngine.initialize()
            ]);

            // Start periodic systems
            this.startPeriodicMutation(300000); // Every 5 minutes
            this.startHealthMonitoring(60000); // Every minute

            this.initialized = true;
            this.logger.info('[BehavioralEcosystem] ✅ Ecosystem initialized');
        } catch (error) {
            this.logger.error('[BehavioralEcosystem] Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Get or create complete behavioral context for a wallet
     * 
     * @param {string} walletKey - Wallet public key
     * @returns {Promise<Object>} Complete behavioral context
     */
    async getWalletContext(walletKey) {
        // Check cache
        if (this.walletContexts.has(walletKey)) {
            return this.walletContexts.get(walletKey);
        }

        // Load all components
        const [dna, memory, emotionalState, lifecycle] = await Promise.all([
            this.dnaEngine.getDNA(walletKey),
            this.memoryEngine.getMemory(walletKey),
            this.emotionalEngine.getEmotionalState(walletKey),
            this.lifecycleEngine.getLifecycle(walletKey)
        ]);

        const context = {
            walletKey,
            dna,
            memory,
            emotionalState,
            lifecycle,
            socialNode: this.socialGraphEngine.getGraph().getNode(walletKey)
        };

        this.walletContexts.set(walletKey, context);
        return context;
    }

    /**
     * Get comprehensive behavioral modifiers for a wallet
     * 
     * This is the core function that composes all behavioral layers
     * into final decision modifiers.
     * 
     * @param {string} walletKey - Wallet public key
     * @returns {Promise<Object>} Behavioral modifiers
     */
    async getBehavioralModifiers(walletKey) {
        const context = await this.getWalletContext(walletKey);
        const ecosystemState = this.ecosystemEngine.getState();
        const socialGraph = this.socialGraphEngine.getGraph();

        // Get base modifiers from each system
        const dnaModifiers = this._getDNAModifiers(context.dna);
        const emotionalModifiers = this._getEmotionalModifiers(context.emotionalState);
        const memoryModifiers = this._getMemoryModifiers(context.memory);
        const ecosystemModifiers = this._getEcosystemModifiers(ecosystemState);
        const socialModifiers = this._getSocialModifiers(context.socialNode, context.dna, socialGraph);
        const lifecycleModifiers = this._getLifecycleModifiers(context.lifecycle);

        // Compose all modifiers
        return this._composeModifiers({
            dna: dnaModifiers,
            emotional: emotionalModifiers,
            memory: memoryModifiers,
            ecosystem: ecosystemModifiers,
            social: socialModifiers,
            lifecycle: lifecycleModifiers
        });
    }

    /**
     * Record a trade and update all systems
     * 
     * @param {string} walletKey - Wallet public key
     * @param {Object} trade - Trade outcome
     */
    async recordTrade(walletKey, trade) {
        const context = await this.getWalletContext(walletKey);
        const ecosystemState = this.ecosystemEngine.getState();

        // Update memory
        context.memory.recordTrade(trade);
        await this.memoryEngine.saveMemory(walletKey, context.memory);

        // Update emotional state
        context.emotionalState.updateFromTrade(trade, context.memory, context.dna);
        await this.emotionalEngine.saveEmotionalState(walletKey, context.emotionalState);

        // Update lifecycle
        context.lifecycle.updateFromTrade(trade);
        await this.lifecycleEngine.saveLifecycle(walletKey, context.lifecycle);

        // Update social graph
        context.socialNode.updateFromTrade(trade);

        // Update ecosystem state
        ecosystemState.updateFromActivity({
            type: trade.type,
            success: trade.success,
            amount: trade.amount,
            walletType: context.dna.personalityType,
            price: trade.price,
            volume: trade.volume
        });

        // Record trade for health monitoring
        this.recentTrades.push({
            walletKey,
            ...trade,
            timestamp: Date.now()
        });

        // Trim trade history
        if (this.recentTrades.length > 1000) {
            this.recentTrades = this.recentTrades.slice(-1000);
        }

        // Apply behavioral evolution
        this.mutationEngine.evolvePreferences(context.memory, trade);
    }

    /**
     * Get DNA modifiers
     * @private
     */
    _getDNAModifiers(dna) {
        return {
            buyProbability: dna.getBuyProbabilityModifier(1.0),
            sellProbability: dna.getSellProbabilityModifier(1.0),
            positionSize: dna.getPositionSizeModifier(1.0),
            holdingDuration: dna.getHoldingDurationModifier(),
            retryAggression: dna.getRetryAggression(),
            slippageTolerance: dna.getSlippageTolerance(),
            panicThreshold: dna.getPanicThreshold(),
            fomoSusceptibility: dna.getFOMOSusceptibility()
        };
    }

    /**
     * Get emotional modifiers
     * @private
     */
    _getEmotionalModifiers(emotionalState) {
        return {
            buyProbability: emotionalState.getBuyProbabilityModifier(),
            sellProbability: emotionalState.getSellProbabilityModifier(),
            positionSize: emotionalState.getPositionSizeModifier(),
            holdingDuration: emotionalState.getHoldingDurationModifier(),
            shouldPause: emotionalState.shouldPause()
        };
    }

    /**
     * Get memory modifiers
     * @private
     */
    _getMemoryModifiers(memory) {
        return {
            confidence: memory.getConfidenceModifier(),
            fatigue: memory.getFatigueModifier(),
            shouldRest: memory.shouldRest(),
            winRate: memory.getWinRate(),
            recentPerformance: memory.getRecentPerformance()
        };
    }

    /**
     * Get ecosystem modifiers
     * @private
     */
    _getEcosystemModifiers(ecosystemState) {
        const regimeModifiers = ecosystemState.getRegimeModifiers();
        return {
            ...regimeModifiers,
            sentiment: ecosystemState.sentiment,
            fearIndex: ecosystemState.fearIndex,
            hypeLevel: ecosystemState.hypeLevel,
            regime: ecosystemState.regime
        };
    }

    /**
     * Get social modifiers
     * @private
     */
    _getSocialModifiers(socialNode, dna, socialGraph) {
        const influence = socialGraph.getInfluenceSignal(socialNode.walletKey, dna);
        return {
            buyPressure: influence.buyPressure,
            sellPressure: influence.sellPressure,
            confidenceBoost: influence.confidence,
            role: socialNode.role,
            influenceScore: socialNode.influenceScore
        };
    }

    /**
     * Get lifecycle modifiers
     * @private
     */
    _getLifecycleModifiers(lifecycle) {
        return {
            activityModifier: lifecycle.getActivityModifier(),
            isActive: lifecycle.isActive(),
            isRetired: lifecycle.isRetired(),
            state: lifecycle.state
        };
    }

    /**
     * Compose all modifiers into final values
     * @private
     */
    _composeModifiers(modifiers) {
        const { dna, emotional, memory, ecosystem, social, lifecycle } = modifiers;

        // Compose buy probability
        let buyProbability = 1.0;
        buyProbability *= dna.buyProbability;
        buyProbability *= emotional.buyProbability;
        buyProbability *= (1.0 + memory.confidence);
        buyProbability *= ecosystem.buyProbabilityMultiplier;
        buyProbability *= (1.0 + social.buyPressure * 0.3);
        buyProbability *= lifecycle.activityModifier;

        // Compose sell probability
        let sellProbability = 1.0;
        sellProbability *= dna.sellProbability;
        sellProbability *= emotional.sellProbability;
        sellProbability *= (1.0 - memory.confidence * 0.2);
        sellProbability *= ecosystem.sellProbabilityMultiplier;
        sellProbability *= (1.0 + social.sellPressure * 0.3);
        sellProbability *= lifecycle.activityModifier;

        // Compose position size
        let positionSize = 1.0;
        positionSize *= dna.positionSize;
        positionSize *= emotional.positionSize;
        positionSize *= memory.fatigue;
        positionSize *= ecosystem.positionSizeMultiplier;
        positionSize *= lifecycle.activityModifier;

        // Compose holding duration
        let holdingDuration = 1.0;
        holdingDuration *= dna.holdingDuration;
        holdingDuration *= emotional.holdingDuration;
        holdingDuration *= ecosystem.holdingDurationMultiplier;

        // Determine if should pause
        const shouldPause = emotional.shouldPause || 
                          memory.shouldRest || 
                          !lifecycle.isActive ||
                          lifecycle.isRetired;

        return {
            buyProbability: Math.max(0, Math.min(2.0, buyProbability)),
            sellProbability: Math.max(0, Math.min(2.0, sellProbability)),
            positionSizeMultiplier: Math.max(0.1, Math.min(2.0, positionSize)),
            holdingDurationMultiplier: Math.max(0.3, Math.min(3.0, holdingDuration)),
            shouldPause,
            retryAggression: dna.retryAggression,
            slippageTolerance: dna.slippageTolerance,
            
            // Context for decision making
            context: {
                emotionalState: emotional,
                memoryState: memory,
                ecosystemState: ecosystem,
                socialState: social,
                lifecycleState: lifecycle
            }
        };
    }

    /**
     * Start periodic mutation
     */
    startPeriodicMutation(intervalMs) {
        if (this.mutationInterval) {
            clearInterval(this.mutationInterval);
        }

        this.mutationInterval = setInterval(async () => {
            await this._applyPeriodicMutations();
        }, intervalMs);
    }

    /**
     * Apply periodic mutations to all wallets
     * @private
     */
    async _applyPeriodicMutations() {
        for (const [walletKey, context] of this.walletContexts.entries()) {
            // DNA mutation
            this.mutationEngine.mutateDNA(context.dna, context.memory, 0.01);
            
            // Emotional drift
            this.mutationEngine.applyEmotionalDrift(context.emotionalState, context.memory);
            
            // Performance adaptation
            this.mutationEngine.performanceAdaptation(context.dna, context.memory);
            
            // Natural decay
            context.emotionalState.decay();
        }
    }

    /**
     * Start health monitoring
     */
    startHealthMonitoring(intervalMs) {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        this.healthCheckInterval = setInterval(async () => {
            await this._performHealthCheck();
        }, intervalMs);
    }

    /**
     * Perform health check and apply corrections
     * @private
     */
    async _performHealthCheck() {
        const wallets = Array.from(this.walletContexts.values());
        const ecosystemState = this.ecosystemEngine.getState();
        const socialGraph = this.socialGraphEngine.getGraph();

        const healthReport = this.healthMonitor.performHealthCheck({
            wallets,
            ecosystemState,
            socialGraph,
            lifecycleEngine: this.lifecycleEngine,
            recentTrades: this.recentTrades
        });

        if (healthReport.issues.length > 0) {
            this.logger.warn(`[BehavioralEcosystem] Health issues detected: ${healthReport.issues.length}`);
            
            const corrections = this.healthMonitor.applyCorrections({
                wallets,
                ecosystemState,
                mutationEngine: this.mutationEngine
            });

            if (corrections.length > 0) {
                this.logger.info(`[BehavioralEcosystem] Applied ${corrections.length} corrections`);
            }
        }
    }

    /**
     * Get ecosystem statistics
     */
    getStats() {
        return {
            wallets: this.walletContexts.size,
            dna: this.dnaEngine.getAllDNA().length,
            memories: this.memoryEngine.getAllMemories().length,
            emotions: this.emotionalEngine.getAllEmotionalStates().length,
            ecosystem: this.ecosystemEngine.getState().getSummary(),
            social: this.socialGraphEngine.getGraph().getStats(),
            lifecycle: this.lifecycleEngine.getStats(),
            mutations: this.mutationEngine.getStats(),
            health: this.healthMonitor.getSummary()
        };
    }

    /**
     * Shutdown ecosystem
     */
    async shutdown() {
        this.logger.info('[BehavioralEcosystem] Shutting down...');

        // Stop intervals
        if (this.mutationInterval) {
            clearInterval(this.mutationInterval);
        }
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        // Shutdown engines
        await Promise.all([
            this.ecosystemEngine.shutdown(),
            this.socialGraphEngine.shutdown()
        ]);

        this.initialized = false;
        this.logger.info('[BehavioralEcosystem] ✅ Shutdown complete');
    }
}

export { BehavioralEcosystem };
