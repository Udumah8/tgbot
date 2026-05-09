// seasoningEngine.js - Wallet Seasoning & Organic Activity Builder
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";

/**
 * SeasoningEngine - Builds organic wallet history over time
 * 
 * Creates realistic transaction patterns to make wallets appear organic:
 * - SOL transfers between wallets
 * - Token swaps with popular tokens
 * - Variable timing and amounts
 * - Realistic activity distribution
 */
export class SeasoningEngine {
    
    /**
     * Season a batch of wallets with organic activity
     * 
     * @param {Keypair[]} wallets - Wallets to season
     * @param {Connection} connection - Solana connection
     * @param {Keypair} masterKeypair - Master wallet for funding
     * @param {Function} swapFn - Swap function for token trades
     * @param {Object} options - Seasoning options
     * @returns {Promise<{completed: number, total: number, successes: number, failures: number}>}
     */
    static async seasonWallets(wallets, connection, masterKeypair, swapFn, options = {}) {
        const {
            durationDays = 7,           // Seasoning period in days
            activitiesPerDay = 3,       // Average activities per day per wallet
            minAmount = 0.001,          // Min SOL per activity
            maxAmount = 0.01,           // Max SOL per activity
            includeTokenSwaps = true,   // Include token swaps
            includeTransfers = true,    // Include SOL transfers
            useLiquidTokens = true,     // Use liquid tokens (USDC/USDT) instead of specific token
            tokenAddress = null,        // Optional: specific token address
            progressCb = null,          // Progress callback
            checkRunning = null,        // Cancellation check
            realtime = false            // If true, spread over actual days; if false, execute immediately
        } = options;

        console.log(`[SeasoningEngine] Starting seasoning for ${wallets.length} wallets over ${durationDays} days`);

        const totalActivities = Math.floor(wallets.length * durationDays * activitiesPerDay);
        const activities = [];

        // Generate activity schedule
        for (let i = 0; i < totalActivities; i++) {
            const wallet = wallets[Math.floor(Math.random() * wallets.length)];
            const activityType = Math.random();
            
            let activity;
            if (activityType < 0.4 && includeTransfers) {
                // SOL transfer activity
                const targetWallet = wallets[Math.floor(Math.random() * wallets.length)];
                if (targetWallet !== wallet) {
                    activity = {
                        type: 'SOL_TRANSFER',
                        wallet,
                        targetWallet,
                        amount: this._randomAmount(minAmount, maxAmount),
                        delay: this._calculateDelay(i, totalActivities, durationDays, realtime)
                    };
                }
            } else if (includeTokenSwaps) {
                // Token swap activity
                // Use liquid tokens for reliable swaps, or specific token if provided
                const swapToken = (useLiquidTokens || !tokenAddress)
                    ? this._selectRandomToken()  // Use liquid tokens (USDC/USDT/mSOL/stSOL)
                    : tokenAddress;               // Use specific token if provided
                
                activity = {
                    type: 'TOKEN_SWAP',
                    wallet,
                    amount: this._randomAmount(minAmount, maxAmount),
                    token: swapToken,
                    delay: this._calculateDelay(i, totalActivities, durationDays, realtime)
                };
            }
            
            if (activity) activities.push(activity);
        }

        // Sort by delay
        activities.sort((a, b) => a.delay - b.delay);

        console.log(`[SeasoningEngine] Generated ${activities.length} activities`);

        // Execute activities
        let completed = 0;
        let successes = 0;
        let failures = 0;
        const startTime = Date.now();

        for (const activity of activities) {
            // Check cancellation
            if (checkRunning && !checkRunning()) {
                console.log(`[SeasoningEngine] Seasoning cancelled by user`);
                break;
            }

            // Wait for scheduled time
            if (activity.delay > 0) {
                await this._sleep(activity.delay);
            }
            
            try {
                if (activity.type === 'SOL_TRANSFER') {
                    await this._executeSolTransfer(
                        connection, 
                        activity.wallet, 
                        activity.targetWallet, 
                        activity.amount
                    );
                    successes++;
                } else if (activity.type === 'TOKEN_SWAP') {
                    await this._executeTokenSwap(
                        connection,
                        activity.wallet,
                        activity.token,
                        activity.amount,
                        swapFn
                    );
                    successes++;
                }
                
                completed++;
                
                // Progress callback
                if (progressCb && (completed % Math.max(1, Math.floor(activities.length / 20)) === 0 || completed === activities.length)) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    const rate = (completed / (Date.now() - startTime) * 1000).toFixed(1);
                    const eta = activities.length > completed 
                        ? Math.round((activities.length - completed) / (completed / (Date.now() - startTime)) / 1000)
                        : 0;
                    
                    progressCb({
                        completed,
                        total: activities.length,
                        successes,
                        failures,
                        percent: Math.round((completed / activities.length) * 100),
                        elapsed: `${elapsed}s`,
                        rate: `${rate}/s`,
                        eta: eta > 0 ? `${eta}s` : 'done'
                    });
                }
            } catch (error) {
                failures++;
                console.error(`[SeasoningEngine] Activity failed: ${error.message}`);
            }
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[SeasoningEngine] Completed: ${successes}/${activities.length} in ${totalTime}s`);

        return { completed, total: activities.length, successes, failures };
    }

    /**
     * Quick season - Execute minimal activities immediately
     */
    static async quickSeason(wallets, connection, masterKeypair, swapFn, options = {}) {
        const {
            minAmount = 0.001,
            maxAmount = 0.005,
            tokenAddress = null, // Optional: specific token, or null to use liquid tokens
            useLiquidTokens = true, // Use established liquid tokens (USDC/USDT) instead of target token
            progressCb = null
        } = options;

        console.log(`[SeasoningEngine] Quick seasoning ${wallets.length} wallets`);

        const activities = [];
        
        // Generate 2 activities per wallet (1 transfer + 1 swap)
        for (const wallet of wallets) {
            // SOL transfer
            const targetWallet = wallets[Math.floor(Math.random() * wallets.length)];
            if (targetWallet !== wallet) {
                activities.push({
                    type: 'SOL_TRANSFER',
                    wallet,
                    targetWallet,
                    amount: this._randomAmount(minAmount, maxAmount)
                });
            }
            
            // Token swap
            // Use liquid tokens (USDC/USDT) for reliable seasoning, or specific token if provided
            const swapToken = (useLiquidTokens || !tokenAddress) 
                ? this._selectRandomToken()  // Use liquid tokens (USDC/USDT/mSOL/stSOL)
                : tokenAddress;               // Use specific token if provided
            
            activities.push({
                type: 'TOKEN_SWAP',
                wallet,
                amount: this._randomAmount(minAmount, maxAmount),
                token: swapToken
            });
        }

        // Execute all activities with small delays
        let completed = 0;
        let successes = 0;
        let failures = 0;

        for (const activity of activities) {
            try {
                if (activity.type === 'SOL_TRANSFER') {
                    await this._executeSolTransfer(
                        connection,
                        activity.wallet,
                        activity.targetWallet,
                        activity.amount
                    );
                } else if (activity.type === 'TOKEN_SWAP') {
                    await this._executeTokenSwap(
                        connection,
                        activity.wallet,
                        activity.token,
                        activity.amount,
                        swapFn
                    );
                }
                successes++;
            } catch (error) {
                failures++;
                console.error(`[SeasoningEngine] Quick season activity failed: ${error.message}`);
            }
            
            completed++;
            
            if (progressCb) {
                progressCb({
                    completed,
                    total: activities.length,
                    successes,
                    failures,
                    percent: Math.round((completed / activities.length) * 100)
                });
            }
            
            // Small delay between activities
            await this._sleep(Math.random() * 1000 + 500);
        }

        return { completed, total: activities.length, successes, failures };
    }

    /**
     * Calculate delay for organic distribution
     */
    static _calculateDelay(index, total, durationDays, realtime) {
        if (!realtime) {
            // Immediate execution with small delays
            return index * (Math.random() * 2000 + 1000); // 1-3 seconds between activities
        }
        
        // Spread over actual days
        const totalMs = durationDays * 24 * 60 * 60 * 1000;
        const baseDelay = (totalMs / total) * index;
        const jitter = baseDelay * 0.3 * (Math.random() - 0.5);
        return Math.max(0, baseDelay + jitter);
    }

    /**
     * Generate random amount with realistic log-normal distribution
     */
    static _randomAmount(min, max) {
        // Use log-normal distribution for realistic amounts
        // Most trades are small, few are large
        const mean = (Math.log(min) + Math.log(max)) / 2;
        const std = (Math.log(max) - Math.log(min)) / 4;
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const amount = Math.exp(mean + std * z);
        return Math.max(min, Math.min(max, amount));
    }

    /**
     * Select random popular token for swaps
     */
    static _selectRandomToken() {
        const popularTokens = [
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
            'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
            'So11111111111111111111111111111111111111112',  // Wrapped SOL
            'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
            '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj'   // stSOL
        ];
        return popularTokens[Math.floor(Math.random() * popularTokens.length)];
    }

    /**
     * Execute SOL transfer between wallets
     */
    static async _executeSolTransfer(connection, fromWallet, toWallet, amountSOL) {
        try {
            const balance = await connection.getBalance(fromWallet.publicKey);
            const lamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);
            const lamportsWithFee = lamports + 5000;

            if (balance < lamportsWithFee) {
                console.debug(`[SeasoningEngine] Insufficient balance for transfer: ${balance / LAMPORTS_PER_SOL} SOL`);
                return null;
            }

            const tx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromWallet.publicKey,
                    toPubkey: toWallet.publicKey,
                    lamports
                })
            );

            const { blockhash } = await connection.getLatestBlockhash('confirmed');
            tx.recentBlockhash = blockhash;
            tx.feePayer = fromWallet.publicKey;
            tx.sign(fromWallet);

            const txid = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed'
            });

            console.debug(`[SeasoningEngine] SOL transfer: ${amountSOL.toFixed(4)} SOL | ${txid.substring(0, 8)}...`);
            return txid;
        } catch (error) {
            console.error(`[SeasoningEngine] SOL transfer failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Execute token swap
     */
    static async _executeTokenSwap(connection, wallet, tokenAddress, amountSOL, swapFn) {
        try {
            const SOL_ADDR = "So11111111111111111111111111111111111111112";
            
            // Buy token
            const txid = await swapFn(
                SOL_ADDR,
                tokenAddress,
                wallet,
                connection,
                amountSOL,
                null,  // No chatId
                true   // Silent
            );

            if (txid) {
                console.debug(`[SeasoningEngine] Token swap: ${amountSOL.toFixed(4)} SOL | ${txid.substring(0, 8)}...`);
                
                // Wait a bit then sell back
                await this._sleep(Math.random() * 5000 + 2000);
                
                // Sell token back to SOL
                await swapFn(
                    tokenAddress,
                    SOL_ADDR,
                    wallet,
                    connection,
                    'auto',
                    null,
                    true
                );
            }

            return txid;
        } catch (error) {
            console.error(`[SeasoningEngine] Token swap failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Sleep helper
     */
    static _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default SeasoningEngine;
