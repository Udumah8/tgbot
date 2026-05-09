/**
 * walletAgent.js
 * 
 * Independent wallet agent that runs its own trading loop
 * Each agent operates autonomously with its own entropy engine
 * 
 * Features:
 * - Independent async execution loop
 * - State machine: ACTIVE → DEGRADED → PAUSED → FAILED
 * - Post-trade verification (balance checks)
 * - Exponential backoff retry logic
 * - Stuck detection and auto-pause
 * - Graceful shutdown support
 */

import { EntropyEngine } from './entropyEngine.js';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Agent states
const AgentState = {
    ACTIVE: 'ACTIVE',
    DEGRADED: 'DEGRADED',
    PAUSED: 'PAUSED',
    FAILED: 'FAILED',
    STOPPED: 'STOPPED'
};

class WalletAgent {
    /**
     * Create a new wallet agent
     * @param {Object} config - Agent configuration
     */
    constructor(config) {
        // Wallet info
        this.wallet = config.wallet;
        this.walletPublicKey = this.wallet.publicKey.toBase58();
        
        // Entropy engine for this wallet
        this.entropy = new EntropyEngine(this.walletPublicKey, config.timeBucketMs || 60000);
        
        // State management
        this.state = AgentState.ACTIVE;
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
        this.totalTrades = 0;
        this.successfulTrades = 0;
        this.failedTrades = 0;
        
        // Trading config
        this.connection = config.connection;
        this.tokenMint = config.tokenMint;
        this.strategy = config.strategy || 'standard';
        this.lambda = config.lambda || 0.1; // Average trades per second
        this.minBuyAmount = config.minBuyAmount || 0.001;
        this.maxBuyAmount = config.maxBuyAmount || 0.01;
        this.jitterPercentage = config.jitterPercentage || 20;
        
        // Cycle control — agent self-terminates after maxCycles trades
        this.maxCycles = config.maxCycles || 0; // 0 = unlimited
        this.currentCycle = 0;
        
        // Strategy config passthrough — behaviors can access strategy-specific params
        this.strategyConfig = config.strategyConfig || {};
        
        // Behavior injection
        this.decideActionFn = config.decideAction || this._defaultDecideAction.bind(this);
        this.executeBuyFn = config.executeBuy;
        this.executeSellFn = config.executeSell;
        this.shouldStopFn = config.shouldStop || (() => false);
        
        // Verification config
        this.verifyTrades = config.verifyTrades !== false;
        this.maxRetries = config.maxRetries || 3;
        this.stuckThreshold = config.stuckThreshold || 10; // Cycles without balance change
        
        // State tracking
        this.lastBalanceChange = Date.now();
        this.cyclesWithoutChange = 0;
        this.lastSOLBalance = 0;
        this.lastTokenBalance = 0;
        this.isRunning = false;
        this.stopRequested = false;
        
        // Callbacks
        this.onStateChange = config.onStateChange || (() => {});
        this.onTrade = config.onTrade || (() => {});
        this.onError = config.onError || (() => {});
        
        // Logging
        this.logger = config.logger || console;
        this.logPrefix = `[Agent:${this.walletPublicKey.slice(0, 8)}]`;
    }

    /**
     * Start the agent's trading loop
     */
    async start() {
        if (this.isRunning) {
            this.logger.warn(`${this.logPrefix} Already running`);
            return;
        }

        this.isRunning = true;
        this.stopRequested = false;
        this.state = AgentState.ACTIVE;
        
        this.logger.info(`${this.logPrefix} Starting agent (strategy: ${this.strategy})`);
        
        try {
            await this._initializeBalances();
            await this._runLoop();
        } catch (error) {
            this.logger.error(`${this.logPrefix} Fatal error in agent loop:`, error);
            this.state = AgentState.FAILED;
            this.onStateChange(this.state, error);
        } finally {
            this.isRunning = false;
            this.logger.info(`${this.logPrefix} Agent stopped`);
        }
    }

    /**
     * Stop the agent gracefully
     */
    async stop() {
        this.logger.info(`${this.logPrefix} Stop requested`);
        this.stopRequested = true;
        this.state = AgentState.STOPPED;
        
        // Wait for current operation to complete (max 30s)
        const maxWait = 30000;
        const startWait = Date.now();
        
        while (this.isRunning && (Date.now() - startWait) < maxWait) {
            await this._sleep(100);
        }
        
        if (this.isRunning) {
            this.logger.warn(`${this.logPrefix} Force stopped after timeout`);
        }
    }

    /**
     * Pause the agent
     */
    pause() {
        if (this.state === AgentState.ACTIVE || this.state === AgentState.DEGRADED) {
            this.state = AgentState.PAUSED;
            this.onStateChange(this.state);
            this.logger.info(`${this.logPrefix} Agent paused`);
        }
    }

    /**
     * Resume the agent
     */
    resume() {
        if (this.state === AgentState.PAUSED) {
            this.state = AgentState.ACTIVE;
            this.consecutiveFailures = 0;
            this.onStateChange(this.state);
            this.logger.info(`${this.logPrefix} Agent resumed`);
        }
    }

    /**
     * Get agent statistics
     */
    getStats() {
        return {
            wallet: this.walletPublicKey,
            state: this.state,
            totalTrades: this.totalTrades,
            successfulTrades: this.successfulTrades,
            failedTrades: this.failedTrades,
            successRate: this.totalTrades > 0 ? (this.successfulTrades / this.totalTrades * 100).toFixed(2) : 0,
            consecutiveFailures: this.consecutiveFailures,
            consecutiveSuccesses: this.consecutiveSuccesses,
            cyclesWithoutChange: this.cyclesWithoutChange,
            lastBalanceChange: this.lastBalanceChange,
            currentCycle: this.currentCycle,
            maxCycles: this.maxCycles
        };
    }

    /**
     * Main agent loop
     * @private
     */
    async _runLoop() {
        while (!this.stopRequested && this.state !== AgentState.FAILED && this.state !== AgentState.STOPPED) {
            // Check if we should stop (external condition)
            if (this.shouldStopFn()) {
                this.logger.info(`${this.logPrefix} External stop condition met`);
                break;
            }

            // Check cycle limit — stop after maxCycles trades
            if (this.maxCycles > 0 && this.currentCycle >= this.maxCycles) {
                this.logger.info(`${this.logPrefix} Completed ${this.currentCycle}/${this.maxCycles} cycles, stopping`);
                break;
            }

            // Skip if paused
            if (this.state === AgentState.PAUSED) {
                await this._sleep(1000);
                continue;
            }

            try {
                // Poisson-distributed delay for realistic timing
                const delay = this.entropy.getPoissonDelay(this.lambda);
                await this._sleep(delay);

                // Decide action
                const action = await this.decideActionFn(this);

                if (action && action.type !== 'WAIT') {
                    // Execute trade
                    const success = await this._executeTrade(action);

                    // Increment cycle counter on every trade attempt
                    this.currentCycle++;

                    // Update state based on result
                    this._updateState(success);

                    // Check for stuck condition
                    if (this.verifyTrades) {
                        await this._checkStuckCondition();
                    }
                }

            } catch (error) {
                this.logger.error(`${this.logPrefix} Error in agent loop:`, error);
                this.onError(error);
                this._updateState(false);
            }
        }
    }

    /**
     * Initialize wallet balances
     * @private
     */
    async _initializeBalances() {
        try {
            this.lastSOLBalance = await this._getSOLBalance();
            this.lastTokenBalance = await this._getTokenBalance();
            this.logger.info(`${this.logPrefix} Initial balances - SOL: ${this.lastSOLBalance.toFixed(6)}, Token: ${this.lastTokenBalance.toFixed(6)}`);
        } catch (error) {
            this.logger.warn(`${this.logPrefix} Could not initialize balances:`, error.message);
        }
    }

    /**
     * Execute a trade with retry logic
     * @private
     */
    async _executeTrade(action) {
        const { type, amount } = action;
        
        this.logger.info(`${this.logPrefix} Executing ${type} - Amount: ${amount?.toFixed(6) || 'N/A'}`);

        let lastError = null;
        
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                // Get pre-trade balances
                const preSOL = this.verifyTrades ? await this._getSOLBalance() : 0;
                const preToken = this.verifyTrades ? await this._getTokenBalance() : 0;

                // Execute trade
                let result;
                if (type === 'BUY') {
                    result = await this.executeBuyFn(this.wallet, amount, this.connection, this.tokenMint);
                } else if (type === 'SELL') {
                    result = await this.executeSellFn(this.wallet, amount, this.connection, this.tokenMint);
                } else {
                    throw new Error(`Unknown action type: ${type}`);
                }

                // Verify trade if enabled
                if (this.verifyTrades) {
                    const verified = await this._verifyTrade(type, preSOL, preToken);
                    if (!verified) {
                        this.logger.warn(`${this.logPrefix} Trade verification failed (attempt ${attempt + 1}/${this.maxRetries})`);
                        if (attempt < this.maxRetries - 1) {
                            await this._sleep(this._getBackoffDelay(attempt));
                            continue;
                        }
                        return false;
                    }
                }

                // Success
                this.totalTrades++;
                this.successfulTrades++;
                this.onTrade({ type, amount, success: true, result });
                this.logger.info(`${this.logPrefix} ${type} successful`);
                return true;

            } catch (error) {
                lastError = error;
                this.logger.warn(`${this.logPrefix} ${type} failed (attempt ${attempt + 1}/${this.maxRetries}):`, error.message);
                
                // Check if error is retryable
                if (!this._isRetryableError(error)) {
                    break;
                }
                
                // Exponential backoff
                if (attempt < this.maxRetries - 1) {
                    await this._sleep(this._getBackoffDelay(attempt));
                }
            }
        }

        // All retries failed
        this.totalTrades++;
        this.failedTrades++;
        this.onTrade({ type, amount, success: false, error: lastError });
        this.onError(lastError);
        return false;
    }

    /**
     * Verify trade by checking balance changes
     * @private
     */
    async _verifyTrade(type, preSOL, preToken) {
        // Wait for balance update
        await this._sleep(2000);

        const postSOL = await this._getSOLBalance();
        const postToken = await this._getTokenBalance();

        const solChange = postSOL - preSOL;
        const tokenChange = postToken - preToken;

        if (type === 'BUY') {
            // SOL should decrease, token should increase
            if (tokenChange > 0) {
                this.lastSOLBalance = postSOL;
                this.lastTokenBalance = postToken;
                this.lastBalanceChange = Date.now();
                this.cyclesWithoutChange = 0;
                return true;
            }
        } else if (type === 'SELL') {
            // Token should decrease, SOL should increase
            if (solChange > 0) {
                this.lastSOLBalance = postSOL;
                this.lastTokenBalance = postToken;
                this.lastBalanceChange = Date.now();
                this.cyclesWithoutChange = 0;
                return true;
            }
        }

        return false;
    }

    /**
     * Check if wallet is stuck (no balance changes)
     * @private
     */
    async _checkStuckCondition() {
        this.cyclesWithoutChange++;

        if (this.cyclesWithoutChange >= this.stuckThreshold) {
            this.logger.warn(`${this.logPrefix} Wallet appears stuck (${this.cyclesWithoutChange} cycles without balance change)`);
            this.state = AgentState.PAUSED;
            this.onStateChange(this.state, new Error('Wallet stuck - no balance changes'));
        }
    }

    /**
     * Update agent state based on trade result
     * @private
     */
    _updateState(success) {
        if (success) {
            this.consecutiveSuccesses++;
            this.consecutiveFailures = 0;

            // Recover from degraded state
            if (this.state === AgentState.DEGRADED && this.consecutiveSuccesses >= 3) {
                this.state = AgentState.ACTIVE;
                this.onStateChange(this.state);
                this.logger.info(`${this.logPrefix} Recovered to ACTIVE state`);
            }
        } else {
            this.consecutiveFailures++;
            this.consecutiveSuccesses = 0;

            // Transition to degraded
            if (this.consecutiveFailures >= 3 && this.state === AgentState.ACTIVE) {
                this.state = AgentState.DEGRADED;
                this.onStateChange(this.state);
                this.logger.warn(`${this.logPrefix} Degraded to DEGRADED state`);
            }

            // Transition to paused
            if (this.consecutiveFailures >= 6) {
                this.state = AgentState.PAUSED;
                this.onStateChange(this.state, new Error('Too many consecutive failures'));
                this.logger.error(`${this.logPrefix} Paused due to excessive failures`);
            }
        }
    }

    /**
     * Default action decision (can be overridden)
     * @private
     */
    async _defaultDecideAction(agent) {
        // Simple buy/sell alternation with randomized amounts
        const shouldBuy = agent.entropy.getRandomBoolean(0.5);
        
        if (shouldBuy) {
            const amount = agent.entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
            const jitterMultiplier = 1 + (agent.entropy.getRandomFloat(-agent.jitterPercentage, agent.jitterPercentage) / 100);
            const finalAmount = parseFloat((amount * jitterMultiplier).toFixed(6));
            
            return { type: 'BUY', amount: finalAmount };
        } else {
            // Sell a portion of holdings
            const tokenBalance = await agent._getTokenBalance();
            if (tokenBalance > 0) {
                const sellPortion = agent.entropy.getRandomFloat(0.1, 0.5);
                return { type: 'SELL', amount: tokenBalance * sellPortion };
            }
        }
        
        return { type: 'WAIT' };
    }

    /**
     * Get SOL balance
     * @private
     */
    async _getSOLBalance() {
        try {
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            return balance / LAMPORTS_PER_SOL;
        } catch (error) {
            this.logger.warn(`${this.logPrefix} Could not fetch SOL balance:`, error.message);
            return this.lastSOLBalance;
        }
    }

    /**
     * Get token balance
     * @private
     */
    async _getTokenBalance() {
        try {
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                this.wallet.publicKey,
                { mint: new PublicKey(this.tokenMint) }
            );

            if (tokenAccounts.value.length > 0) {
                const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
                return balance || 0;
            }
            return 0;
        } catch (error) {
            this.logger.warn(`${this.logPrefix} Could not fetch token balance:`, error.message);
            return this.lastTokenBalance;
        }
    }

    /**
     * Check if error is retryable
     * @private
     */
    _isRetryableError(error) {
        const retryableMessages = [
            'blockhash not found',
            'timeout',
            'network',
            'connection',
            'rate limit',
            '429',
            'too many requests'
        ];

        const errorMessage = error.message?.toLowerCase() || '';
        return retryableMessages.some(msg => errorMessage.includes(msg));
    }

    /**
     * Get exponential backoff delay
     * @private
     */
    _getBackoffDelay(attempt) {
        const baseDelay = 1000;
        const maxDelay = 30000;
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        
        // Add jitter
        const jitter = this.entropy.getRandomFloat(0.8, 1.2);
        return Math.floor(delay * jitter);
    }

    /**
     * Sleep utility
     * @private
     */
    async _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export { WalletAgent, AgentState };
