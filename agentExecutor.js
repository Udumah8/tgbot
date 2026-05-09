/**
 * agentExecutor.js
 * 
 * Manages multiple wallet agents running concurrently
 * Handles lifecycle, monitoring, and graceful shutdown
 * 
 * Features:
 * - Concurrent agent execution
 * - Centralized monitoring and statistics
 * - Graceful shutdown with timeout
 * - State aggregation across agents
 * - Error handling and recovery
 */

import { WalletAgent, AgentState } from './walletAgent.js';

class AgentExecutor {
    /**
     * Create a new agent executor
     * @param {Object} config - Executor configuration
     */
    constructor(config = {}) {
        this.agents = new Map(); // wallet pubkey -> agent
        this.agentPromises = new Map(); // wallet pubkey -> promise
        this.isRunning = false;
        this.stopRequested = false;
        this.isPaused = false;
        
        // Config
        this.logger = config.logger || console;
        this.strategyId = config.strategyId || 'unknown';
        this.strategyName = config.strategyName || 'Unknown';
        this.staggerDelayMs = config.staggerDelayMs || 200; // Delay between agent launches
        this.onAgentStateChange = config.onAgentStateChange || (() => {});
        this.onAgentTrade = config.onAgentTrade || (() => {});
        this.onAgentError = config.onAgentError || (() => {});
        this.onComplete = config.onComplete || (() => {});
        
        // Statistics
        this.stats = {
            totalAgents: 0,
            activeAgents: 0,
            degradedAgents: 0,
            pausedAgents: 0,
            failedAgents: 0,
            stoppedAgents: 0,
            totalTrades: 0,
            successfulTrades: 0,
            failedTrades: 0
        };
    }

    /**
     * Create and start agents for multiple wallets
     * @param {Array} wallets - Array of wallet keypairs
     * @param {Object} agentConfig - Configuration for each agent
     */
    async startAgents(wallets, agentConfig) {
        if (this.isRunning) {
            throw new Error('Executor is already running');
        }

        if (!Array.isArray(wallets) || wallets.length === 0) {
            throw new Error('Wallets must be a non-empty array');
        }

        this.isRunning = true;
        this.stopRequested = false;
        this.stats.totalAgents = wallets.length;

        this.logger.info(`[AgentExecutor:${this.strategyName}] Starting ${wallets.length} agents with ${this.staggerDelayMs}ms stagger...`);

        // Create and start agents with staggered delay
        for (let i = 0; i < wallets.length; i++) {
            if (this.stopRequested) break;

            const wallet = wallets[i];
            const walletKey = wallet.publicKey.toBase58();
            
            // Create agent with callbacks
            const agent = new WalletAgent({
                ...agentConfig,
                wallet,
                onStateChange: (state, error) => this._handleStateChange(walletKey, state, error),
                onTrade: (trade) => this._handleTrade(walletKey, trade),
                onError: (error) => this._handleError(walletKey, error)
            });

            this.agents.set(walletKey, agent);

            // Start agent (non-blocking)
            const promise = agent.start().catch(error => {
                this.logger.error(`[AgentExecutor:${this.strategyName}] Agent ${walletKey.slice(0, 8)} crashed:`, error);
            });

            // If executor is paused during staggered startup, pause this agent immediately
            if (this.isPaused) {
                agent.pause();
            }

            this.agentPromises.set(walletKey, promise);

            // Stagger agent launches to avoid RPC rate limiting
            if (i < wallets.length - 1 && this.staggerDelayMs > 0) {
                await this._sleep(this.staggerDelayMs);
            }
        }

        this.logger.info(`[AgentExecutor:${this.strategyName}] ✅ All ${wallets.length} agents started`);
        
        // Update initial stats
        this._updateStats();
    }

    /**
     * Stop all agents gracefully
     * @param {number} timeout - Maximum time to wait for shutdown (ms)
     */
    async stopAll(timeout = 30000) {
        if (!this.isRunning) {
            this.logger.warn('[AgentExecutor] Executor is not running');
            return;
        }

        this.logger.info(`[AgentExecutor] Stopping ${this.agents.size} agents...`);
        this.stopRequested = true;

        // Request stop for all agents
        const stopPromises = [];
        for (const [walletKey, agent] of this.agents.entries()) {
            stopPromises.push(
                agent.stop().catch(error => {
                    this.logger.error(`[AgentExecutor] Error stopping agent ${walletKey.slice(0, 8)}:`, error);
                })
            );
        }

        // Wait for all agents to stop (with timeout)
        try {
            await Promise.race([
                Promise.all(stopPromises),
                this._sleep(timeout)
            ]);
        } catch (error) {
            this.logger.error('[AgentExecutor] Error during shutdown:', error);
        }

        // Wait for all agent promises to complete
        try {
            await Promise.race([
                Promise.all(Array.from(this.agentPromises.values())),
                this._sleep(timeout)
            ]);
        } catch (error) {
            this.logger.error('[AgentExecutor] Error waiting for agent promises:', error);
        }

        this.isRunning = false;
        this._updateStats();

        this.logger.info('[AgentExecutor] ✅ All agents stopped');
    }

    /**
     * Pause all agents
     */
    pauseAll() {
        this.logger.info(`[AgentExecutor] Pausing ${this.agents.size} agents...`);
        this.isPaused = true;
        
        for (const agent of this.agents.values()) {
            agent.pause();
        }
        
        this._updateStats();
    }

    /**
     * Resume all paused agents
     */
    resumeAll() {
        this.logger.info(`[AgentExecutor] Resuming agents...`);
        this.isPaused = false;
        
        for (const agent of this.agents.values()) {
            if (agent.state === AgentState.PAUSED) {
                agent.resume();
            }
        }
        
        this._updateStats();
    }

    /**
     * Get specific agent by wallet key
     * @param {string} walletKey - Wallet public key
     */
    getAgent(walletKey) {
        return this.agents.get(walletKey);
    }

    /**
     * Get all agents
     */
    getAllAgents() {
        return Array.from(this.agents.values());
    }

    /**
     * Get aggregated statistics
     */
    getStats() {
        this._updateStats();
        return { ...this.stats };
    }

    /**
     * Get detailed statistics for all agents
     */
    getDetailedStats() {
        const agentStats = [];
        
        for (const [walletKey, agent] of this.agents.entries()) {
            agentStats.push({
                wallet: walletKey,
                ...agent.getStats()
            });
        }

        return {
            summary: this.getStats(),
            agents: agentStats
        };
    }

    /**
     * Wait for all agents to complete
     */
    async waitForCompletion() {
        if (!this.isRunning) {
            return;
        }

        this.logger.info(`[AgentExecutor:${this.strategyName}] Waiting for all agents to complete...`);
        
        try {
            await Promise.all(Array.from(this.agentPromises.values()));
        } catch (error) {
            this.logger.error(`[AgentExecutor:${this.strategyName}] Error waiting for completion:`, error);
        }

        this.isRunning = false;
        this._updateStats();
        
        this.logger.info(`[AgentExecutor:${this.strategyName}] ✅ All agents completed`);
        
        // Fire completion callback
        try {
            this.onComplete();
        } catch (e) {
            this.logger.warn(`[AgentExecutor:${this.strategyName}] onComplete callback error: ${e.message}`);
        }
    }

    /**
     * Get aggregate cycle progress across all agents
     * @returns {Object} Cycle progress summary
     */
    getCycleProgress() {
        let totalCycles = 0;
        let completedCycles = 0;
        let maxCyclesPerAgent = 0;

        for (const agent of this.agents.values()) {
            const stats = agent.getStats();
            completedCycles += stats.currentCycle || 0;
            maxCyclesPerAgent = stats.maxCycles || 0;
            totalCycles += maxCyclesPerAgent;
        }

        const percent = totalCycles > 0 ? Math.round((completedCycles / totalCycles) * 100) : 0;

        return {
            completedCycles,
            totalCycles,
            maxCyclesPerAgent,
            percent,
            agentCount: this.agents.size
        };
    }

    /**
     * Handle agent state change
     * @private
     */
    _handleStateChange(walletKey, state, error) {
        this.logger.info(`[AgentExecutor] Agent ${walletKey.slice(0, 8)} state changed to ${state}`);
        
        this._updateStats();
        this.onAgentStateChange(walletKey, state, error);
    }

    /**
     * Handle agent trade
     * @private
     */
    _handleTrade(walletKey, trade) {
        if (trade.success) {
            this.stats.successfulTrades++;
        } else {
            this.stats.failedTrades++;
        }
        this.stats.totalTrades++;
        
        this.onAgentTrade(walletKey, trade);
    }

    /**
     * Handle agent error
     * @private
     */
    _handleError(walletKey, error) {
        this.logger.error(`[AgentExecutor] Agent ${walletKey.slice(0, 8)} error:`, error.message);
        this.onAgentError(walletKey, error);
    }

    /**
     * Update aggregated statistics
     * @private
     */
    _updateStats() {
        let active = 0;
        let degraded = 0;
        let paused = 0;
        let failed = 0;
        let stopped = 0;

        for (const agent of this.agents.values()) {
            switch (agent.state) {
                case AgentState.ACTIVE:
                    active++;
                    break;
                case AgentState.DEGRADED:
                    degraded++;
                    break;
                case AgentState.PAUSED:
                    paused++;
                    break;
                case AgentState.FAILED:
                    failed++;
                    break;
                case AgentState.STOPPED:
                    stopped++;
                    break;
            }
        }

        this.stats.activeAgents = active;
        this.stats.degradedAgents = degraded;
        this.stats.pausedAgents = paused;
        this.stats.failedAgents = failed;
        this.stats.stoppedAgents = stopped;
    }

    /**
     * Sleep utility
     * @private
     */
    async _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get health status
     */
    getHealth() {
        this._updateStats();
        
        const totalAgents = this.stats.totalAgents;
        const healthyAgents = this.stats.activeAgents + this.stats.degradedAgents;
        const unhealthyAgents = this.stats.pausedAgents + this.stats.failedAgents;
        
        let status = 'HEALTHY';
        if (unhealthyAgents > totalAgents * 0.5) {
            status = 'CRITICAL';
        } else if (unhealthyAgents > totalAgents * 0.2) {
            status = 'DEGRADED';
        }

        return {
            status,
            totalAgents,
            healthyAgents,
            unhealthyAgents,
            successRate: this.stats.totalTrades > 0 
                ? ((this.stats.successfulTrades / this.stats.totalTrades) * 100).toFixed(2)
                : 0
        };
    }

    /**
     * Restart failed agents
     */
    async restartFailedAgents(agentConfig) {
        const failedAgents = [];
        
        for (const [walletKey, agent] of this.agents.entries()) {
            if (agent.state === AgentState.FAILED || agent.state === AgentState.PAUSED) {
                failedAgents.push({ walletKey, wallet: agent.wallet });
            }
        }

        if (failedAgents.length === 0) {
            this.logger.info('[AgentExecutor] No failed agents to restart');
            return;
        }

        this.logger.info(`[AgentExecutor] Restarting ${failedAgents.length} failed agents...`);

        for (const { walletKey, wallet } of failedAgents) {
            // Stop old agent
            const oldAgent = this.agents.get(walletKey);
            await oldAgent.stop();

            // Create new agent
            const newAgent = new WalletAgent({
                ...agentConfig,
                wallet,
                onStateChange: (state, error) => this._handleStateChange(walletKey, state, error),
                onTrade: (trade) => this._handleTrade(walletKey, trade),
                onError: (error) => this._handleError(walletKey, error)
            });

            this.agents.set(walletKey, newAgent);

            // Start new agent
            const promise = newAgent.start().catch(error => {
                this.logger.error(`[AgentExecutor] Restarted agent ${walletKey.slice(0, 8)} crashed:`, error);
            });

            this.agentPromises.set(walletKey, promise);
        }

        this.logger.info(`[AgentExecutor] ✅ Restarted ${failedAgents.length} agents`);
        this._updateStats();
    }
}

export { AgentExecutor };
