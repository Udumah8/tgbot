/**
 * fundManager.js
 * 
 * Manages wallet funding with per-wallet randomization
 * Replaces batch funding with independent, randomized funding per wallet
 * 
 * Features:
 * - Per-wallet amount randomization (no two wallets get same amount)
 * - Random delays between funding operations
 * - Multi-hop stealth funding support
 * - Concurrency control
 * - Progress tracking
 * - Graceful cancellation
 */

import { EntropyEngine } from './entropyEngine.js';
import { LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';

class FundManager {
    /**
     * Create a new fund manager
     * @param {Object} config - Configuration
     */
    constructor(config = {}) {
        this.logger = config.logger || console;
        this.defaultVariance = config.defaultVariance || 0.25; // ±25%
        this.defaultConcurrency = config.defaultConcurrency || 10;
        this.minDelay = config.minDelay || 200; // ms
        this.maxDelay = config.maxDelay || 2000; // ms
        this.useWebFunding = config.useWebFunding || false;
        this.stealthLevel = config.stealthLevel || 1;
        this.hopDepth = config.hopDepth || 2;
    }

    /**
     * Fund a single wallet with randomized amount
     * @param {Object} wallet - Wallet keypair
     * @param {Object} options - Funding options
     */
    async fundWallet(wallet, options) {
        const {
            connection,
            masterKeypair,
            sendSOLFn,
            baseAmount,
            variance = this.defaultVariance,
            useWebFunding = this.useWebFunding,
            stealthLevel = this.stealthLevel,
            hopDepth = this.hopDepth
        } = options;

        // Create entropy engine for this wallet
        const entropy = new EntropyEngine(wallet.publicKey.toBase58());

        // Randomize amount
        const fundAmount = entropy.getRandomizedAmount(baseAmount, variance);
        
        this.logger.info(`[FundManager] Funding ${wallet.publicKey.toBase58().slice(0, 8)}... with ${fundAmount.toFixed(6)} SOL`);

        try {
            // Random delay before funding
            const delay = entropy.getRandomInt(this.minDelay, this.maxDelay);
            await this._sleep(delay);

            // Execute funding
            if (useWebFunding && stealthLevel > 0) {
                // Multi-hop stealth funding
                await this._fundWithMultiHop(wallet, {
                    connection,
                    masterKeypair,
                    sendSOLFn,
                    amount: fundAmount,
                    hopDepth
                });
            } else {
                // Direct funding
                await sendSOLFn(connection, masterKeypair, wallet.publicKey, fundAmount);
            }

            return { success: true, amount: fundAmount, wallet: wallet.publicKey.toBase58() };

        } catch (error) {
            this.logger.error(`[FundManager] Failed to fund ${wallet.publicKey.toBase58().slice(0, 8)}:`, error.message);
            return { success: false, error: error.message, wallet: wallet.publicKey.toBase58() };
        }
    }

    /**
     * Fund multiple wallets with independent randomization
     * @param {Array} wallets - Array of wallet keypairs
     * @param {Object} options - Funding options
     */
    async fundWallets(wallets, options) {
        const {
            connection,
            masterKeypair,
            sendSOLFn,
            baseAmount,
            variance = this.defaultVariance,
            concurrency = this.defaultConcurrency,
            progressCb = null,
            checkRunning = null,
            useWebFunding = this.useWebFunding,
            stealthLevel = this.stealthLevel,
            hopDepth = this.hopDepth
        } = options;

        if (!Array.isArray(wallets) || wallets.length === 0) {
            throw new Error('Wallets must be a non-empty array');
        }

        this.logger.info(`[FundManager] 💰 Funding ${wallets.length} wallets with per-wallet randomization (±${(variance * 100).toFixed(0)}% variance)`);

        const results = {
            total: wallets.length,
            succeeded: 0,
            failed: 0,
            skipped: 0,
            details: []
        };

        // Process wallets with concurrency control
        const chunks = this._chunkArray(wallets, concurrency);

        for (let i = 0; i < chunks.length; i++) {
            // Check if we should stop
            if (checkRunning && !checkRunning()) {
                this.logger.warn('[FundManager] Funding cancelled by external signal');
                results.skipped = wallets.length - (results.succeeded + results.failed);
                break;
            }

            const chunk = chunks[i];
            
            // Fund chunk in parallel
            const chunkResults = await Promise.all(
                chunk.map(wallet => 
                    this.fundWallet(wallet, {
                        connection,
                        masterKeypair,
                        sendSOLFn,
                        baseAmount,
                        variance,
                        useWebFunding,
                        stealthLevel,
                        hopDepth
                    })
                )
            );

            // Update results
            for (const result of chunkResults) {
                if (result.success) {
                    results.succeeded++;
                } else {
                    results.failed++;
                }
                results.details.push(result);
            }

            // Progress callback
            if (progressCb) {
                const progress = {
                    current: results.succeeded + results.failed,
                    total: wallets.length,
                    succeeded: results.succeeded,
                    failed: results.failed
                };
                progressCb(progress);
            }
        }

        this.logger.info(`[FundManager] ✅ Funding complete: ${results.succeeded} succeeded, ${results.failed} failed, ${results.skipped} skipped`);

        return results;
    }

    /**
     * Fund wallet using multi-hop for stealth
     * @private
     */
    async _fundWithMultiHop(wallet, options) {
        const { connection, masterKeypair, sendSOLFn, amount, hopDepth } = options;

        if (hopDepth <= 1) {
            // Direct funding
            await sendSOLFn(connection, masterKeypair, wallet.publicKey, amount);
            return;
        }

        // Create intermediate wallets
        const intermediateWallets = [];
        
        for (let i = 0; i < hopDepth - 1; i++) {
            intermediateWallets.push(Keypair.generate());
        }

        try {
            // Fund first intermediate wallet
            const firstHopAmount = amount + (0.001 * (hopDepth - 1)); // Add fees for subsequent hops
            await sendSOLFn(connection, masterKeypair, intermediateWallets[0].publicKey, firstHopAmount);
            
            // Wait for confirmation
            await this._sleep(1000);

            // Fund through intermediate wallets
            for (let i = 0; i < intermediateWallets.length - 1; i++) {
                const from = intermediateWallets[i];
                const to = intermediateWallets[i + 1];
                const hopAmount = amount + (0.001 * (hopDepth - i - 2));
                
                await sendSOLFn(connection, from, to.publicKey, hopAmount);
                await this._sleep(500);
            }

            // Final hop to target wallet
            const lastIntermediate = intermediateWallets[intermediateWallets.length - 1];
            await sendSOLFn(connection, lastIntermediate, wallet.publicKey, amount);

        } catch (error) {
            this.logger.error('[FundManager] Multi-hop funding failed:', error.message);
            throw error;
        }
    }

    /**
     * Drain a single wallet
     * @param {Object} wallet - Wallet keypair
     * @param {Object} options - Drain options
     */
    async drainWallet(wallet, options) {
        const { connection, masterKeypair, sendSOLFn } = options;

        try {
            const balance = await connection.getBalance(wallet.publicKey);
            const MIN_RENT = 0;
            const TX_FEE = 5000;
            
            const drainAmount = (balance - MIN_RENT - TX_FEE) / LAMPORTS_PER_SOL;

            if (drainAmount > 0) {
                await sendSOLFn(connection, wallet, masterKeypair.publicKey, drainAmount);
                this.logger.info(`[FundManager] Drained ${drainAmount.toFixed(6)} SOL from ${wallet.publicKey.toBase58().slice(0, 8)}`);
                return { success: true, amount: drainAmount, wallet: wallet.publicKey.toBase58() };
            } else {
                this.logger.info(`[FundManager] No SOL to drain from ${wallet.publicKey.toBase58().slice(0, 8)}`);
                return { success: true, amount: 0, wallet: wallet.publicKey.toBase58() };
            }

        } catch (error) {
            this.logger.error(`[FundManager] Failed to drain ${wallet.publicKey.toBase58().slice(0, 8)}:`, error.message);
            return { success: false, error: error.message, wallet: wallet.publicKey.toBase58() };
        }
    }

    /**
     * Drain multiple wallets
     * @param {Array} wallets - Array of wallet keypairs
     * @param {Object} options - Drain options
     */
    async drainWallets(wallets, options) {
        const {
            connection,
            masterKeypair,
            sendSOLFn,
            concurrency = this.defaultConcurrency,
            progressCb = null,
            checkRunning = null
        } = options;

        if (!Array.isArray(wallets) || wallets.length === 0) {
            return { total: 0, succeeded: 0, failed: 0, totalRecovered: 0 };
        }

        this.logger.info(`[FundManager] 💸 Draining ${wallets.length} wallets...`);

        const results = {
            total: wallets.length,
            succeeded: 0,
            failed: 0,
            skipped: 0,
            totalRecovered: 0,
            details: []
        };

        // Process wallets with concurrency control
        const chunks = this._chunkArray(wallets, concurrency);

        for (let i = 0; i < chunks.length; i++) {
            // Check if we should stop
            if (checkRunning && !checkRunning()) {
                this.logger.warn('[FundManager] Draining cancelled by external signal');
                results.skipped = wallets.length - (results.succeeded + results.failed);
                break;
            }

            const chunk = chunks[i];
            
            // Drain chunk in parallel
            const chunkResults = await Promise.all(
                chunk.map(wallet => 
                    this.drainWallet(wallet, {
                        connection,
                        masterKeypair,
                        sendSOLFn
                    })
                )
            );

            // Update results
            for (const result of chunkResults) {
                if (result.success) {
                    results.succeeded++;
                    results.totalRecovered += result.amount || 0;
                } else {
                    results.failed++;
                }
                results.details.push(result);
            }

            // Progress callback
            if (progressCb) {
                const progress = {
                    current: results.succeeded + results.failed,
                    total: wallets.length,
                    succeeded: results.succeeded,
                    failed: results.failed,
                    totalRecovered: results.totalRecovered
                };
                progressCb(progress);
            }
        }

        this.logger.info(`[FundManager] ✅ Draining complete: ${results.succeeded} succeeded, ${results.failed} failed, ${results.totalRecovered.toFixed(6)} SOL recovered`);

        return results;
    }

    /**
     * Chunk array for batch processing
     * @private
     */
    _chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Sleep utility
     * @private
     */
    async _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export { FundManager };
