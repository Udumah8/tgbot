// walletManager.js
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WalletAgingManager } from "./walletAging.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WALLETS_FILE = path.join(__dirname, "wallets.json");
const WALLETS_BACKUP = path.join(__dirname, "wallets.backup.json");
const METADATA_FILE = path.join(__dirname, "wallets.metadata.json");

/**
 * WalletPool — Manages 10,000+ persistent Solana wallets.
 * 
 * Wallets are stored as JSON on disk and loaded into memory on boot.
 * All batch operations (fund, drain, balance scan) use configurable
 * concurrency to avoid RPC rate limits.
 * 
 * Features:
 * - Atomic file writes for crash safety
 * - Rate-limit aware batch execution with retry
 * - Per-wallet rate limiting to avoid RPC spam
 * - Progress callbacks for UI updates
 * - Cancellation support via checkRunning callback
 * - Memory-efficient random subset selection
 * - Automatic backup and recovery
 * - PublicKey index for O(1) lookups
 * - Wallet aging and seasoning system
 * - Organic behavior simulation
 */
export class WalletPool {
    constructor() {
        /** @type {Keypair[]} */
        this.wallets = [];
        /** @type {Map<string, Keypair>} */
        this.publicKeyMap = new Map();
        /** @type {Map<string, Object>} Wallet metadata for aging system */
        this.metadata = new Map();
        /** @type {number} Last save timestamp for debouncing */
        this._lastSaveTime = 0;
        /** @type {number} Minimum ms between saves */
        this._saveDebounceMs = 1000;
        /** @type {boolean} Enable wallet aging features */
        this.agingEnabled = true;
        this._load();
        this._loadMetadata();
    }

    // ─── Persistence ───────────────────────────────

    /**
     * Load wallets from disk with error recovery
     */
    _load() {
        try {
            if (fs.existsSync(WALLETS_FILE)) {
                const raw = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf-8"));
                this.wallets = raw.map(w => {
                    const kp = Keypair.fromSecretKey(bs58.decode(w.secretKey));
                    this.publicKeyMap.set(kp.publicKey.toBase58(), kp);
                    
                    // Initialize metadata if aging is enabled
                    if (this.agingEnabled && !this.metadata.has(kp.publicKey.toBase58())) {
                        this.metadata.set(
                            kp.publicKey.toBase58(),
                            WalletAgingManager.initializeMetadata(kp)
                        );
                    }
                    
                    return kp;
                });
                console.log(`✅ [WalletPool] Loaded ${this.wallets.length} wallets from disk.`);
            } else {
                console.log(`ℹ️ [WalletPool] No wallets.json found. Starting with empty pool.`);
            }
        } catch (e) {
            console.error(`⚠️ [WalletPool] Failed to load wallets.json: ${e.message}`);
            // Try backup file
            try {
                if (fs.existsSync(WALLETS_BACKUP)) {
                    const raw = JSON.parse(fs.readFileSync(WALLETS_BACKUP, "utf-8"));
                    this.wallets = raw.map(w => {
                        const kp = Keypair.fromSecretKey(bs58.decode(w.secretKey));
                        this.publicKeyMap.set(kp.publicKey.toBase58(), kp);
                        return kp;
                    });
                    console.log(`✅ [WalletPool] Recovered ${this.wallets.length} wallets from backup.`);
                } else {
                    console.warn(`⚠️ [WalletPool] No backup file found. Starting with empty pool.`);
                    this.wallets = [];
                    this.publicKeyMap.clear();
                }
            } catch (backupErr) {
                console.error(`❌ [WalletPool] Backup recovery failed: ${backupErr.message}`);
                this.wallets = [];
                this.publicKeyMap.clear();
            }
        }
    }

    /**
     * Load wallet metadata from disk
     */
    _loadMetadata() {
        if (!this.agingEnabled) return;
        
        try {
            if (fs.existsSync(METADATA_FILE)) {
                const raw = JSON.parse(fs.readFileSync(METADATA_FILE, "utf-8"));
                for (const [pubKey, meta] of Object.entries(raw)) {
                    this.metadata.set(pubKey, WalletAgingManager.deserializeMetadata(meta));
                }
                console.log(`✅ [WalletPool] Loaded metadata for ${this.metadata.size} wallets.`);
            }
        } catch (e) {
            console.error(`⚠️ [WalletPool] Failed to load metadata: ${e.message}`);
        }
    }

    /**
     * Save wallets to disk with atomic write (temp file + rename)
     * Includes debouncing to prevent excessive disk I/O
     */
    _save(force = false) {
        try {
            // Debounce saves unless forced
            const now = Date.now();
            if (!force && (now - this._lastSaveTime) < this._saveDebounceMs) {
                console.debug(`[WalletPool] Save debounced (${now - this._lastSaveTime}ms since last save)`);
                return;
            }
            this._lastSaveTime = now;
            
            const data = this.wallets.map(kp => ({
                publicKey: kp.publicKey.toBase58(),
                secretKey: bs58.encode(kp.secretKey)
            }));
            
            // Atomic write: write to temp file first, then rename
            const tempFile = WALLETS_FILE + '.tmp';
            fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
            
            // Create backup of existing file before overwriting
            if (fs.existsSync(WALLETS_FILE)) {
                fs.copyFileSync(WALLETS_FILE, WALLETS_BACKUP);
            }
            
            // Atomic rename
            fs.renameSync(tempFile, WALLETS_FILE);
            
            // Update in-memory index
            this.publicKeyMap.clear();
            for (const wallet of this.wallets) {
                this.publicKeyMap.set(wallet.publicKey.toBase58(), wallet);
            }
            
            // Save metadata
            if (this.agingEnabled) {
                this._saveMetadata();
            }
            
            console.debug(`💾 [WalletPool] Saved ${this.wallets.length} wallets to disk.`);
        } catch (e) {
            console.error(`❌ [WalletPool] Failed to save wallets.json: ${e.message}`);
            // Clean up temp file if it exists
            try {
                const tempFile = WALLETS_FILE + '.tmp';
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch (e) {
                // Silently ignore cleanup errors
            }
        }
    }

    /**
     * Save wallet metadata to disk
     */
    _saveMetadata() {
        if (!this.agingEnabled) return;
        
        try {
            const data = {};
            for (const [pubKey, meta] of this.metadata.entries()) {
                data[pubKey] = WalletAgingManager.serializeMetadata(meta);
            }
            
            const tempFile = METADATA_FILE + '.tmp';
            fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
            
            if (fs.existsSync(METADATA_FILE)) {
                fs.copyFileSync(METADATA_FILE, METADATA_FILE + '.backup');
            }
            
            fs.renameSync(tempFile, METADATA_FILE);
            console.debug(`💾 [WalletPool] Saved metadata for ${this.metadata.size} wallets.`);
        } catch (e) {
            console.error(`❌ [WalletPool] Failed to save metadata: ${e.message}`);
        }
    }

    // ─── Generation ────────────────────────────────

    /**
     * Generate `count` new wallets and append to the pool.
     * Generates in chunks to avoid blocking the event loop.
     * 
     * @param {number} count - Number of wallets to generate
     * @param {Function} progressCb - Optional callback: ({generated, total}) => void
     * @returns {Promise<number>} Number of wallets actually generated
     */
    async generateWallets(count, progressCb = null) {
        if (!count || count <= 0) return 0;
        
        const CHUNK = 500;
        let generated = 0;
        const startTime = Date.now();

        while (generated < count) {
            const batchSize = Math.min(CHUNK, count - generated);
            
            for (let i = 0; i < batchSize; i++) {
                const kp = Keypair.generate();
                this.wallets.push(kp);
                this.publicKeyMap.set(kp.publicKey.toBase58(), kp);
            }
            
            generated += batchSize;

            if (progressCb) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                const rate = (generated / (Date.now() - startTime) * 1000).toFixed(0);
                progressCb({ 
                    generated, 
                    total: count,
                    elapsed: `${elapsed}s`,
                    rate: `${rate}/s`
                });
            }

            // Yield to event loop every chunk to prevent blocking
            await new Promise(r => setImmediate(r));
        }

        // Persist to disk
        this._save();
        
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ [WalletPool] Generated ${generated} wallets in ${totalTime}s`);
        return generated;
    }

    /**
     * Generate temporary ephemeral wallets that are NOT persisted to the pool.
     * Use this when you do not want to use or pollute the saved wallets.json.
     * 
     * @param {number} count - Number of ephemeral wallets to generate
     * @param {boolean} withSimulatedAging - Whether to simulate aging metadata (default: true)
     * @returns {Keypair[]} Array of newly generated Keypairs
     */
    generateEphemeralWallets(count, withSimulatedAging = true) {
        const tempWallets = [];
        
        if (!withSimulatedAging || !this.agingEnabled) {
            // Simple generation without aging
            for (let i = 0; i < count; i++) {
                tempWallets.push(Keypair.generate());
            }
            return tempWallets;
        }
        
        // Generate with simulated age distribution for organic behavior
        const distribution = {
            VETERAN: Math.floor(count * 0.15),  // 15% veterans
            MATURE: Math.floor(count * 0.25),   // 25% mature
            SEASONED: Math.floor(count * 0.35), // 35% seasoned
            YOUNG: Math.floor(count * 0.20),    // 20% young
            FRESH: Math.floor(count * 0.05)     // 5% fresh
        };
        
        // Fill remaining to reach exact count
        const allocated = Object.values(distribution).reduce((a, b) => a + b, 0);
        if (allocated < count) {
            distribution.SEASONED += (count - allocated);
        }
        
        for (const [tier, tierCount] of Object.entries(distribution)) {
            for (let i = 0; i < tierCount; i++) {
                const wallet = Keypair.generate();
                
                // Simulate age by backdating creation time
                const meta = WalletAgingManager.initializeMetadata(wallet);
                meta.createdAt = this._getBackdatedTimestamp(tier);
                meta.ageTier = tier;
                
                // Simulate trading history
                meta.totalTrades = this._getSimulatedTrades(tier);
                meta.totalVolume = this._getSimulatedVolume(tier);
                meta.firstTradeAt = meta.createdAt + (24 * 60 * 60 * 1000); // Day after creation
                meta.lastTradeAt = Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000; // Within last week
                
                // Update trust score based on simulated activity
                WalletAgingManager.updateAgeTier(meta);
                
                // Store in metadata map (in-memory for ephemeral)
                this.metadata.set(wallet.publicKey.toBase58(), meta);
                tempWallets.push(wallet);
            }
        }
        
        return tempWallets;
    }
    
    /**
     * Get backdated timestamp for simulated wallet age
     * @private
     */
    _getBackdatedTimestamp(tier) {
        const now = Date.now();
        const ageRanges = {
            VETERAN: [90, 365],  // 90-365 days ago
            MATURE: [30, 90],    // 30-90 days ago
            SEASONED: [7, 30],   // 7-30 days ago
            YOUNG: [1, 7],       // 1-7 days ago
            FRESH: [0, 1]        // 0-1 day ago
        };
        
        const [min, max] = ageRanges[tier] || [0, 1];
        const daysAgo = min + Math.random() * (max - min);
        return now - (daysAgo * 24 * 60 * 60 * 1000);
    }
    
    /**
     * Get simulated trade count for wallet tier
     * @private
     */
    _getSimulatedTrades(tier) {
        const tradeRanges = {
            VETERAN: [50, 200],
            MATURE: [20, 50],
            SEASONED: [5, 20],
            YOUNG: [1, 5],
            FRESH: [0, 1]
        };
        
        const [min, max] = tradeRanges[tier] || [0, 1];
        return Math.floor(min + Math.random() * (max - min));
    }
    
    /**
     * Get simulated volume for wallet tier
     * @private
     */
    _getSimulatedVolume(tier) {
        const volumeRanges = {
            VETERAN: [5.0, 20.0],
            MATURE: [1.0, 5.0],
            SEASONED: [0.2, 1.0],
            YOUNG: [0.05, 0.2],
            FRESH: [0, 0.05]
        };
        
        const [min, max] = volumeRanges[tier] || [0, 0.05];
        return parseFloat((min + Math.random() * (max - min)).toFixed(4));
    }

    // ─── Batch Operations ──────────────────────────

    /**
     * Concurrency-limited async executor with retry and rate limiting.
     * Runs `fn(item, index)` for each item with at most `concurrency` in flight.
     * 
     * @param {Array} items - Items to process
     * @param {Function} fn - Async function: (item, index) => Promise
     * @param {number} concurrency - Max parallel operations
     * @param {Function} progressCb - Optional: ({completed, total, successes, failures}) => void
     * @param {Function} checkRunning - Optional: () => boolean to check if should continue
     * @param {number} maxRetries - Max retry attempts for transient errors
     * @returns {Promise<{completed, successes, failures}>}
     */
    async _batchExecute(items, fn, concurrency, progressCb = null, checkRunning = null, maxRetries = 2) {
        if (!items?.length) return { completed: 0, successes: 0, failures: 0 };
        
        let completed = 0;
        let successes = 0;
        let failures = 0;
        const total = items.length;
        let index = 0;
        const startTime = Date.now();

        // Per-wallet rate limiting to avoid RPC spam
        const lastCallTime = new Map();
        const MIN_INTERVAL_MS = 100; // Minimum ms between calls per wallet

        const worker = async () => {
            while (index < total) {
                // Check cancellation signal
                if (checkRunning && !checkRunning()) {
                    console.log(`[WalletPool] Worker stopped: checkRunning returned false`);
                    break;
                }
                
                const currentIndex = index++;
                const item = items[currentIndex];
                const itemKey = item?.publicKey?.toBase58?.() || `item_${currentIndex}`;
                let lastError;

                // Retry loop for transient errors
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        // Per-item rate limiting
                        const lastTime = lastCallTime.get(itemKey) || 0;
                        const now = Date.now();
                        const elapsed = now - lastTime;
                        
                        if (elapsed < MIN_INTERVAL_MS) {
                            await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
                        }
                        lastCallTime.set(itemKey, Date.now());

                        // Execute the operation
                        await fn(item, currentIndex);
                        successes++;
                        lastError = null;
                        break; // Success - exit retry loop
                        
                    } catch (err) {
                        lastError = err;
                        
                        // Determine if error is retryable
                        const isRetryable = 
                            err.message?.includes('timeout') ||
                            err.message?.includes('429') ||
                            err.message?.includes('rate limit') ||
                            err.message?.includes('blockhash') ||
                            err.message?.includes('Transaction was not confirmed') ||
                            err.message?.includes('failed to get') ||
                            err.message?.includes('fetch failed') ||
                            err.message?.includes('ECONNREFUSED') ||
                            err.message?.includes('ECONNRESET') ||
                            err.message?.includes('network error') ||
                            err.code === 'TIMEOUT' ||
                            err.code === 'ETIMEDOUT' ||
                            err.code === 'ENOTFOUND' ||
                            err.code === 'EAI_AGAIN' ||
                            err.code === 'ECONNRESET' ||
                            err.code === 'ECONNREFUSED' ||
                            err.code === 'UND_ERR_CONNECT_TIMEOUT';
                        
                        if (isRetryable && attempt < maxRetries) {
                            // Exponential backoff with jitter
                            const baseDelay = 1000 * Math.pow(2, attempt);
                            const jitter = baseDelay * 0.2 * Math.random();
                            const delay = Math.min(baseDelay + jitter, 5000);
                            console.debug(`[WalletPool] Item ${currentIndex} retry ${attempt+1}/${maxRetries} in ${Math.round(delay)}ms: ${err.message}`);
                            await new Promise(r => setTimeout(r, delay));
                            continue;
                        }
                        
                        // Non-retryable error or max retries exceeded
                        break;
                    }
                }

                if (lastError) {
                    failures++;
                    console.error(`[WalletPool] Item ${currentIndex} (${itemKey.slice(0,8)}...) failed: ${lastError.message}`);
                }

                completed++;

                // Progress callback throttled to ~5% intervals to avoid spam
                if (progressCb && (completed % Math.max(1, Math.floor(total / 20)) === 0 || completed === total)) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    const rate = (completed / (Date.now() - startTime) * 1000).toFixed(1);
                    const eta = total > completed ? Math.round((total - completed) / (completed / (Date.now() - startTime))) : 0;
                    
                    progressCb({ 
                        completed, 
                        total, 
                        successes, 
                        failures,
                        percent: Math.round((completed / total) * 100),
                        elapsed: `${elapsed}s`,
                        rate: `${rate}/s`,
                        eta: eta > 0 ? `${Math.round(eta/1000)}s` : 'done'
                    });
                }
            }
        };

        // Spawn worker promises up to concurrency limit
        const workerCount = Math.min(concurrency, total);
        const workers = Array.from({ length: workerCount }, () => worker());
        
        await Promise.all(workers);
        
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[WalletPool] Batch complete: ${successes}/${total} succeeded, ${failures} failed in ${totalTime}s`);
        
        return { completed, successes, failures };
    }

    /**
     * Fund all wallets from a master keypair.
     * Skips wallets that already have >= amountSOL balance (with 10% tolerance).
     * 
     * @param {Connection} connection - Solana connection
     * @param {Keypair} masterKeypair - Master wallet to fund from
     * @param {Function} sendSOLFn - Async function: (conn, from, toPubkey, amountSOL) => Promise<txid>
     * @param {number} amountSOL - Amount of SOL to send per wallet
     * @param {number} concurrency - Max parallel funding operations
     * @param {Function} progressCb - Optional progress callback
     * @param {Function} checkRunning - Optional cancellation check
     * @param {boolean} useWebFunding - Enable multi-hop funding
     * @param {number} stealthLevel - 1=direct, 2=multi-hop
     * @param {number} hopDepth - Number of intermediate hops (1-5)
     * @param {boolean} randomizeAmounts - Enable per-wallet randomization
     * @param {number} fundingVariance - Variance percentage (e.g., 0.25 = ±25%)
     * @returns {Promise<{completed, successes, failures, skipped}>}
     */
    async fundAll(connection, masterKeypair, sendSOLFn, amountSOL, concurrency = 10, progressCb = null, checkRunning = null, useWebFunding = false, stealthLevel = 1, hopDepth = 2, randomizeAmounts = false, fundingVariance = 0.25) {
        if (!this.wallets.length) {
            console.warn('[WalletPool] fundAll called with empty pool');
            return { completed: 0, successes: 0, failures: 0, skipped: 0 };
        }

        console.log(`[WalletPool] Scanning ${this.wallets.length} wallets for funding needs...`);
        
        // First, scan which wallets need funding (batched for efficiency)
        const walletsToFund = [];
        const scanResults = await this.scanBalances(connection, Math.min(concurrency * 2, 30));

        for (let i = 0; i < this.wallets.length; i++) {
            const bal = scanResults.balances[i] || 0;
            const threshold = amountSOL * LAMPORTS_PER_SOL * 0.9; // 10% tolerance
            if (bal < threshold) {
                walletsToFund.push(this.wallets[i]);
            }
        }

        const skipped = this.wallets.length - walletsToFund.length;
        console.log(`[WalletPool] Funding ${walletsToFund.length} wallets, skipping ${skipped} already funded`);

        if (walletsToFund.length === 0) {
            if (progressCb) progressCb({ completed: 0, total: 0, successes: 0, failures: 0, skipped });
            return { completed: 0, successes: 0, failures: 0, skipped };
        }

        if (progressCb) {
            progressCb({ 
                completed: 0, 
                total: walletsToFund.length, 
                successes: 0, 
                failures: 0, 
                skipped,
                phase: 'funding'
            });
        }

        // Use web funding (multi-hop) if enabled
        if (useWebFunding && stealthLevel === 2 && hopDepth > 0) {
            console.log(`[WalletPool] 🕸️ Web Funding enabled: ${hopDepth}-hop chain`);
            return await this._fundWithMultiHop(walletsToFund, {
                connection,
                masterKeypair,
                sendSOLFn,
                amountSOL,
                concurrency,
                progressCb,
                checkRunning,
                hopDepth,
                skipped
            });
        }

        // Direct funding (default)
        const result = await this._batchExecute(
            walletsToFund,
            async (wallet) => {
                await sendSOLFn(connection, masterKeypair, wallet.publicKey, amountSOL);
            },
            concurrency,
            progressCb,
            checkRunning
        );

        return { ...result, skipped };
    }

    /**
     * Fund a specific array of wallets from a master keypair.
     * 
     * @param {Keypair[]} wallets - Array of wallets to fund
     * @param {Object} options - Funding options
     * @param {boolean} options.randomizeAmounts - Enable per-wallet randomization
     * @param {number} options.fundingVariance - Variance percentage (e.g., 0.25 = ±25%)
     * @returns {Promise<{completed, successes, failures, skipped}>}
     */
    async fundWallets(wallets, { connection, masterKeypair, sendSOLFn, amountSOL, concurrency = 10, progressCb = null, checkRunning = null, useWebFunding = false, stealthLevel = 1, hopDepth = 2, randomizeAmounts = false, fundingVariance = 0.25 }) {
        if (!wallets || !wallets.length) {
            console.warn('[WalletPool] fundWallets called with empty array');
            return { completed: 0, successes: 0, failures: 0, skipped: 0 };
        }

        console.log(`[WalletPool] Scanning ${wallets.length} specific wallets for funding needs...`);
        const walletsToFund = [];
        
        // Scan balances first to avoid unnecessary funding
        let skipped = 0;
        await this._batchExecute(
            wallets,
            async (wallet) => {
                try {
                    const bal = await connection.getBalance(wallet.publicKey, 'confirmed');
                    const threshold = amountSOL * LAMPORTS_PER_SOL * 0.9;
                    if (bal < threshold) {
                        walletsToFund.push(wallet);
                    } else {
                        skipped++;
                    }
                } catch {
                    // On error assume needs funding
                    walletsToFund.push(wallet);
                }
            },
            concurrency * 2, // run scanning fast
            null,
            null
        );

        console.log(`[WalletPool] Specific funding: ${walletsToFund.length} need funds, skipping ${skipped}`);

        if (walletsToFund.length === 0) {
            if (progressCb) progressCb({ completed: 0, total: 0, successes: 0, failures: 0, skipped });
            return { completed: 0, successes: 0, failures: 0, skipped };
        }

        if (progressCb) {
            progressCb({ completed: 0, total: walletsToFund.length, successes: 0, failures: 0, skipped, phase: 'funding' });
        }

        // Use web funding (multi-hop) if enabled
        if (useWebFunding && stealthLevel === 2 && hopDepth > 0) {
            console.log(`[WalletPool] 🕸️ Web Funding enabled: ${hopDepth}-hop chain`);
            return await this._fundWithMultiHop(walletsToFund, {
                connection,
                masterKeypair,
                sendSOLFn,
                amountSOL,
                concurrency,
                progressCb,
                checkRunning,
                hopDepth,
                skipped,
                randomizeAmounts,
                fundingVariance
            });
        }

        // Log randomization status
        if (randomizeAmounts) {
            console.log(`[WalletPool] 💰 Per-wallet randomization enabled: ±${(fundingVariance * 100).toFixed(0)}% variance`);
        }

        // Direct funding (default)
        const result = await this._batchExecute(
            walletsToFund,
            async (wallet) => {
                // Apply per-wallet randomization if enabled
                let fundAmount = amountSOL;
                if (randomizeAmounts && fundingVariance > 0) {
                    const minAmount = amountSOL * (1 - fundingVariance);
                    const maxAmount = amountSOL * (1 + fundingVariance);
                    fundAmount = parseFloat((minAmount + Math.random() * (maxAmount - minAmount)).toFixed(6));
                }
                await sendSOLFn(connection, masterKeypair, wallet.publicKey, fundAmount);
            },
            concurrency,
            progressCb,
            checkRunning
        );

        return { ...result, skipped };
    }

    /**
     * Fund wallets using multi-hop chain for obfuscation
     * Creates intermediate wallets to break direct on-chain link
     * @private
     */
    async _fundWithMultiHop(wallets, { connection, masterKeypair, sendSOLFn, amountSOL, progressCb, checkRunning, hopDepth, skipped, randomizeAmounts = false, fundingVariance = 0.25 }) {
        const results = { completed: 0, successes: 0, failures: 0, skipped };
        
        for (const targetWallet of wallets) {
            if (checkRunning && !checkRunning()) {
                console.log('[WalletPool] Multi-hop funding stopped by checkRunning');
                break;
            }

            try {
                // Apply per-wallet randomization if enabled
                let targetAmount = amountSOL;
                if (randomizeAmounts && fundingVariance > 0) {
                    const minAmount = amountSOL * (1 - fundingVariance);
                    const maxAmount = amountSOL * (1 + fundingVariance);
                    targetAmount = parseFloat((minAmount + Math.random() * (maxAmount - minAmount)).toFixed(6));
                }

                // Generate intermediate hop wallets
                const hopWallets = [];
                for (let i = 0; i < hopDepth; i++) {
                    hopWallets.push(Keypair.generate());
                }

                // Calculate amounts with fees
                // Each hop needs: target amount + fees for next hop
                const feePerHop = 0.000005; // Solana base fee
                let currentAmount = targetAmount;
                const hopAmounts = [];
                
                // Work backwards from target to calculate each hop amount
                for (let i = hopDepth - 1; i >= 0; i--) {
                    hopAmounts.unshift(currentAmount + feePerHop);
                    currentAmount = currentAmount + feePerHop;
                }

                // Step 1: Fund first hop wallet from master
                const firstHopAmount = hopAmounts[0];
                await sendSOLFn(connection, masterKeypair, hopWallets[0].publicKey, firstHopAmount);
                
                // Small delay to ensure transaction confirms
                await new Promise(resolve => setTimeout(resolve, 500));

                // Step 2: Chain through intermediate hops
                for (let i = 0; i < hopDepth - 1; i++) {
                    const fromWallet = hopWallets[i];
                    const toWallet = hopWallets[i + 1];
                    const amount = hopAmounts[i + 1];
                    
                    await sendSOLFn(connection, fromWallet, toWallet.publicKey, amount);
                    
                    // Small delay between hops
                    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200));
                }

                // Step 3: Final hop to target wallet
                const lastHopWallet = hopWallets[hopDepth - 1];
                await sendSOLFn(connection, lastHopWallet, targetWallet.publicKey, targetAmount);

                results.successes++;
                const amountStr = randomizeAmounts ? `${targetAmount.toFixed(6)}` : `${amountSOL.toFixed(6)}`;
                console.log(`[WalletPool] ✅ Multi-hop funded: ${targetWallet.publicKey.toBase58().substring(0, 8)}... with ${amountStr} SOL via ${hopDepth} hops`);

            } catch (error) {
                results.failures++;
                console.error(`[WalletPool] ❌ Multi-hop failed for ${targetWallet.publicKey.toBase58().substring(0, 8)}...: ${error.message}`);
            }

            results.completed++;
            
            if (progressCb) {
                progressCb({
                    completed: results.completed,
                    total: wallets.length,
                    successes: results.successes,
                    failures: results.failures,
                    skipped: results.skipped
                });
            }

            // Rate limiting between wallets
            if (results.completed < wallets.length) {
                await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));
            }
        }

        return results;
    }

    /**
     * Drain all wallets back to the master wallet.
     * Leaves MIN_RENT lamports for rent-exemption.
     * 
     * @param {Connection} connection - Solana connection
     * @param {Keypair} masterKeypair - Destination wallet
     * @param {Function} sendSOLFn - Async function: (conn, from, toPubkey, amountSOL) => Promise<txid>
     * @param {number} concurrency - Max parallel drain operations
     * @param {Function} progressCb - Optional progress callback
     * @param {Function} checkRunning - Optional cancellation check
     * @returns {Promise<{completed, successes, failures}>}
     */
    async drainAll(connection, masterKeypair, sendSOLFn, concurrency = 10, progressCb = null, checkRunning = null) {
        if (!this.wallets.length) {
            console.warn('[WalletPool] drainAll called with empty pool');
            return { completed: 0, successes: 0, failures: 0 };
        }

        const MIN_RENT = 0; // ~0 SOL (Deep sweep to reclaim all funds)
        const MIN_DRAIN = 0; // ~0 SOL (Allow deep sweep of tiny amounts)
        const TX_FEE = 5000;      // Exact standard Solana transfer fee (to hit zero exactly)

        console.log(`[WalletPool] Draining ${this.wallets.length} wallets to ${masterKeypair.publicKey.toBase58().slice(0,8)}...`);

        return await this._batchExecute(
            this.wallets,
            async (wallet) => {
                const bal = await connection.getBalance(wallet.publicKey, 'confirmed');
                if (bal > MIN_RENT + MIN_DRAIN) {
                    const drainAmount = (bal - MIN_RENT - TX_FEE) / LAMPORTS_PER_SOL;
                    if (drainAmount > 0) {
                        await sendSOLFn(connection, wallet, masterKeypair.publicKey, drainAmount);
                    }
                }
            },
            concurrency,
            progressCb,
            checkRunning,
            3
        );
    }

    /**
     * Drain a specific array of wallets back to the master wallet.
     * 
     * @param {Keypair[]} wallets - Array of wallets to drain
     * @param {Object} options - Drain options
     * @returns {Promise<{completed, successes, failures}>}
     */
    async drainWallets(wallets, { connection, masterKeypair, sendSOLFn, concurrency = 10, progressCb = null, checkRunning = null }) {
        if (!wallets || !wallets.length) return { completed: 0, successes: 0, failures: 0 };

        const MIN_RENT = 0; 
        const MIN_DRAIN = 0; 
        const TX_FEE = 5000;

        return await this._batchExecute(
            wallets,
            async (wallet) => {
                const bal = await connection.getBalance(wallet.publicKey, 'confirmed');
                if (bal > MIN_RENT + MIN_DRAIN) {
                    const drainAmount = (bal - MIN_RENT - TX_FEE) / LAMPORTS_PER_SOL;
                    if (drainAmount > 0) {
                        await sendSOLFn(connection, wallet, masterKeypair.publicKey, drainAmount);
                    }
                }
            },
            concurrency,
            progressCb,
            checkRunning,
            3
        );
    }

    /**
     * Scan balances of all wallets.
     * Returns aggregated stats and individual balances array.
     * 
     * @param {Connection} connection - Solana connection
     * @param {number} concurrency - Max parallel balance queries
     * @returns {Promise<{totalSOL, funded, empty, balances: number[]}>}
     */
    async scanBalances(connection, concurrency = 20, showDetails = false) {
        if (!this.wallets.length) {
            return { totalSOL: 0, funded: 0, empty: 0, balances: [], walletDetails: [] };
        }

        const balances = new Array(this.wallets.length).fill(0);
        const walletDetails = [];
        let totalLamports = 0;
        let funded = 0;
        let empty = 0;
        const startTime = Date.now();

        await this._batchExecute(
            this.wallets,
            async (wallet, i) => {
                try {
                    const bal = await connection.getBalance(wallet.publicKey, 'confirmed');
                    balances[i] = bal;
                    totalLamports += bal;
                    
                    const solBalance = bal / LAMPORTS_PER_SOL;
                    const isFunded = bal >= 2100000; // MIN_RENT threshold
                    
                    if (isFunded) funded++;
                    else empty++;
                    
                    // Store detailed info for each wallet
                    walletDetails.push({
                        index: i,
                        address: wallet.publicKey.toBase58(),
                        balance: solBalance,
                        lamports: bal,
                        isFunded,
                        status: isFunded ? '✅' : '❌'
                    });
                    
                    // Show details in console if requested
                    if (showDetails) {
                        const status = isFunded ? '✅' : '❌';
                        console.log(`  ${status} Wallet ${i + 1}: ${wallet.publicKey.toBase58().substring(0, 8)}... | ${solBalance.toFixed(6)} SOL`);
                    }
                } catch (error) {
                    empty++;
                    balances[i] = 0;
                    walletDetails.push({
                        index: i,
                        address: wallet.publicKey.toBase58(),
                        balance: 0,
                        lamports: 0,
                        isFunded: false,
                        status: '❌',
                        error: error.message
                    });
                    
                    if (showDetails) {
                        console.log(`  ❌ Wallet ${i + 1}: ${wallet.publicKey.toBase58().substring(0, 8)}... | ERROR: ${error.message}`);
                    }
                }
            },
            concurrency,
            null, // No progress callback for internal scan
            null  // No cancellation check for internal scan
        );

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const totalSOL = totalLamports / LAMPORTS_PER_SOL;
        
        console.log(`[WalletPool] Balance scan complete: ${totalSOL.toFixed(4)} SOL total, ${funded} funded, ${empty} empty in ${totalTime}s`);
        
        return { 
            totalSOL, 
            totalLamports,
            funded, 
            empty, 
            balances,
            walletDetails,
            scanned: this.wallets.length,
            duration: totalTime
        };
    }

    // ─── Selection ─────────────────────────────────

    /**
     * Get a random subset of `count` wallets from the pool.
     * Uses Fisher-Yates partial shuffle for O(count) performance.
     * Does not modify the original pool.
     * 
     * @param {number} count - Number of wallets to select
     * @returns {Keypair[]} Array of selected Keypairs
     */
    getRandomSubset(count) {
        const n = Math.min(count, this.wallets.length);
        if (n <= 0) return [];
        if (n === this.wallets.length) return [...this.wallets];
        
        // Create a shallow copy for shuffling
        const pool = [...this.wallets];
        
        // Fisher-Yates partial shuffle: only shuffle the last n elements
        for (let i = pool.length - 1; i > pool.length - 1 - n && i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        
        return pool.slice(pool.length - n);
    }

    /**
     * Get wallet by public key string (base58)
     * 
     * @param {string} pubkeyBase58 - Public key in base58 format
     * @returns {Keypair|undefined} The wallet if found, undefined otherwise
     */
    getByPublicKey(pubkeyBase58) {
        return this.publicKeyMap.get(pubkeyBase58);
    }

    /**
     * Check if a public key exists in the pool
     * 
     * @param {string} pubkeyBase58 - Public key in base58 format
     * @returns {boolean} True if wallet exists in pool
     */
    hasWallet(pubkeyBase58) {
        return this.publicKeyMap.has(pubkeyBase58);
    }

    // ─── Management ────────────────────────────────

    /**
     * Clear all wallets from pool and delete the file.
     * Creates a backup before deletion.
     */
    clearAll() {
        console.log(`[WalletPool] Clearing ${this.wallets.length} wallets...`);
        
        // Create backup before clearing
        try {
            if (fs.existsSync(WALLETS_FILE)) {
                fs.copyFileSync(WALLETS_FILE, WALLETS_BACKUP + '.' + Date.now());
                console.log(`[WalletPool] Backup created before clear`);
            }
        } catch (e) {
            console.warn(`[WalletPool] Backup before clear failed: ${e.message}`);
        }
        
        this.wallets = [];
        this.publicKeyMap.clear();
        
        try {
            if (fs.existsSync(WALLETS_FILE)) fs.unlinkSync(WALLETS_FILE);
            console.log(`[WalletPool] wallets.json deleted`);
        } catch (e) {
            console.error(`⚠️ [WalletPool] Failed to delete wallets.json: ${e.message}`);
        }
    }

    /**
     * Remove specific wallet from pool by public key
     * 
     * @param {string} pubkeyBase58 - Public key to remove
     * @returns {boolean} True if wallet was found and removed
     */
    removeWallet(pubkeyBase58) {
        const wallet = this.publicKeyMap.get(pubkeyBase58);
        if (!wallet) return false;
        
        const index = this.wallets.findIndex(w => w.publicKey.toBase58() === pubkeyBase58);
        if (index === -1) return false;
        
        this.wallets.splice(index, 1);
        this.publicKeyMap.delete(pubkeyBase58);
        this._save();
        
        console.log(`[WalletPool] Removed wallet ${pubkeyBase58.slice(0,8)}...`);
        return true;
    }

    /**
     * Export wallet secret key for backup/transfer
     * 
     * @param {string} pubkeyBase58 - Public key of wallet to export
     * @returns {string|null} Base58-encoded secret key or null if not found
     */
    exportWallet(pubkeyBase58) {
        const wallet = this.publicKeyMap.get(pubkeyBase58);
        if (!wallet) return null;
        return bs58.encode(wallet.secretKey);
    }

    /**
     * Import a wallet from base58-encoded secret key
     * 
     * @param {string} secretKeyBase58 - Base58-encoded secret key
     * @returns {Keypair|null} The imported keypair or null if invalid
     */
    importWallet(secretKeyBase58) {
        try {
            const kp = Keypair.fromSecretKey(bs58.decode(secretKeyBase58));
            // Check if already exists
            if (this.hasWallet(kp.publicKey.toBase58())) {
                console.warn(`[WalletPool] Wallet ${kp.publicKey.toBase58().slice(0,8)}... already exists`);
                return kp;
            }
            this.wallets.push(kp);
            this.publicKeyMap.set(kp.publicKey.toBase58(), kp);
            this._save();
            console.log(`[WalletPool] Imported wallet ${kp.publicKey.toBase58().slice(0,8)}...`);
            return kp;
        } catch (e) {
            console.error(`[WalletPool] Failed to import wallet: ${e.message}`);
            return null;
        }
    }

    /**
     * Get pool statistics (no RPC calls)
     * 
     * @returns {{total: number, firstFew: string[]}}
     */
    getStats() {
        return {
            total: this.wallets.length,
            firstFew: this.wallets.slice(0, 3).map(w => w.publicKey.toBase58().substring(0, 8) + "..."),
            memoryEstimateKB: Math.round((this.wallets.length * 128) / 1024) // ~128 bytes per Keypair
        };
    }

    /**
     * Get detailed pool info including balance summary (requires RPC)
     * 
     * @param {Connection} connection - Solana connection
     * @returns {Promise<{total: number, totalSOL: number, avgBalance: number}>}
     */
    async getDetailedStats(connection) {
        const scan = await this.scanBalances(connection, 30);
        return {
            total: this.wallets.length,
            totalSOL: scan.totalSOL,
            avgBalance: this.wallets.length > 0 ? scan.totalSOL / this.wallets.length : 0,
            funded: scan.funded,
            empty: scan.empty
        };
    }

    // ─── Getters ───────────────────────────────────

    /**
     * Get number of wallets in pool
     * @returns {number}
     */
    get size() {
        return this.wallets.length;
    }

    /**
     * Get all wallet public keys as base58 strings
     * @returns {string[]}
     */
    get publicKeys() {
        return this.wallets.map(w => w.publicKey.toBase58());
    }

    /**
     * Get array of all Keypairs (read-only copy)
     * @returns {Keypair[]}
     */
    get allWallets() {
        return [...this.wallets];
    }

    // ─── Wallet Aging Methods ──────────────────────

    /**
     * Update trade metadata for a wallet
     */
    updateTradeMetadata(wallet, tradeAmount, tokenAddress) {
        if (!this.agingEnabled) return;
        
        const pubKey = wallet.publicKey.toBase58();
        let meta = this.metadata.get(pubKey);
        
        if (!meta) {
            meta = WalletAgingManager.initializeMetadata(wallet);
            this.metadata.set(pubKey, meta);
        }
        
        WalletAgingManager.updateTradeMetadata(meta, tradeAmount, tokenAddress);
        this._saveMetadata();
    }

    /**
     * Get wallets filtered by age tier
     */
    getWalletsByAgeTier(tier, count) {
        if (!this.agingEnabled) {
            return this.getRandomSubset(count);
        }
        
        const filtered = this.wallets.filter(w => {
            const meta = this.metadata.get(w.publicKey.toBase58());
            if (!meta) {
                // Initialize metadata for wallets without it
                const newMeta = WalletAgingManager.initializeMetadata(w);
                this.metadata.set(w.publicKey.toBase58(), newMeta);
                WalletAgingManager.updateAgeTier(newMeta);
                return newMeta.ageTier === tier;
            }
            WalletAgingManager.updateAgeTier(meta);
            return meta.ageTier === tier;
        });
        
        const n = Math.min(count, filtered.length);
        return this._selectRandom(filtered, n);
    }

    /**
     * Get optimal wallet mix based on age distribution
     */
    getOptimalWalletMix(count) {
        if (!this.agingEnabled || this.wallets.length === 0) {
            return this.getRandomSubset(count);
        }
        
        // Update all wallet age tiers first
        for (const wallet of this.wallets) {
            const pubKey = wallet.publicKey.toBase58();
            let meta = this.metadata.get(pubKey);
            if (!meta) {
                meta = WalletAgingManager.initializeMetadata(wallet);
                this.metadata.set(pubKey, meta);
            }
            WalletAgingManager.updateAgeTier(meta);
        }
        
        // Target distribution
        const distribution = {
            VETERAN: Math.floor(count * 0.15),  // 15% veterans
            MATURE: Math.floor(count * 0.25),   // 25% mature
            SEASONED: Math.floor(count * 0.35), // 35% seasoned
            YOUNG: Math.floor(count * 0.20),    // 20% young
            FRESH: Math.floor(count * 0.05)     // 5% fresh
        };

        const selected = [];
        for (const [tier, tierCount] of Object.entries(distribution)) {
            if (tierCount > 0) {
                const tierWallets = this.getWalletsByAgeTier(tier, tierCount);
                selected.push(...tierWallets);
            }
        }

        // Fill remaining with any available wallets
        const remaining = count - selected.length;
        if (remaining > 0) {
            const available = this.wallets.filter(w => !selected.includes(w));
            const additional = this._selectRandom(available, remaining);
            selected.push(...additional);
        }

        return selected.slice(0, count);
    }

    /**
     * Get aging statistics
     */
    getAgingStats() {
        if (!this.agingEnabled) {
            return {
                FRESH: 0,
                YOUNG: 0,
                SEASONED: 0,
                MATURE: 0,
                VETERAN: 0,
                avgTrustScore: 0,
                totalTrades: 0,
                totalVolume: 0
            };
        }
        
        const stats = {
            FRESH: 0,
            YOUNG: 0,
            SEASONED: 0,
            MATURE: 0,
            VETERAN: 0,
            avgTrustScore: 0,
            totalTrades: 0,
            totalVolume: 0
        };
        
        let totalTrust = 0;
        
        for (const wallet of this.wallets) {
            const pubKey = wallet.publicKey.toBase58();
            let meta = this.metadata.get(pubKey);
            
            if (!meta) {
                meta = WalletAgingManager.initializeMetadata(wallet);
                this.metadata.set(pubKey, meta);
            }
            
            WalletAgingManager.updateAgeTier(meta);
            stats[meta.ageTier]++;
            totalTrust += meta.trustScore;
            stats.totalTrades += meta.totalTrades;
            stats.totalVolume += meta.totalVolume;
        }
        
        stats.avgTrustScore = this.wallets.length > 0 ? totalTrust / this.wallets.length : 0;
        
        return stats;
    }

    /**
     * Get detailed stats for a specific wallet
     */
    getWalletStats(wallet) {
        if (!this.agingEnabled) return null;
        
        const pubKey = wallet.publicKey.toBase58();
        const meta = this.metadata.get(pubKey);
        
        if (!meta) return null;
        
        return WalletAgingManager.getWalletStats(meta);
    }

    /**
     * Calculate age-based delay for a wallet
     */
    calculateAgeBasedDelay(wallet, baseDelay) {
        if (!this.agingEnabled) return baseDelay;
        
        const pubKey = wallet.publicKey.toBase58();
        const meta = this.metadata.get(pubKey);
        
        if (!meta) return baseDelay;
        
        return WalletAgingManager.calculateAgeBasedDelay(meta, baseDelay);
    }

    /**
     * Calculate age-based trade amount for a wallet
     */
    calculateAgeBasedAmount(wallet, baseAmount) {
        if (!this.agingEnabled) return baseAmount;
        
        const pubKey = wallet.publicKey.toBase58();
        const meta = this.metadata.get(pubKey);
        
        if (!meta) return baseAmount;
        
        return WalletAgingManager.calculateAgeBasedAmount(meta, baseAmount);
    }

    /**
     * Check if wallet should trade now based on behavior profile
     */
    shouldTradeNow(wallet) {
        if (!this.agingEnabled) return true;
        
        const pubKey = wallet.publicKey.toBase58();
        const meta = this.metadata.get(pubKey);
        
        if (!meta) return true;
        
        return WalletAgingManager.shouldTradeNow(meta);
    }

    /**
     * Enable or disable aging system
     */
    setAgingEnabled(enabled) {
        this.agingEnabled = enabled;
        console.log(`[WalletPool] Aging system ${enabled ? 'enabled' : 'disabled'}`);
    }

    // ─── Helper Methods ────────────────────────────

    /**
     * Select random items from array
     */
    _selectRandom(array, count) {
        if (count >= array.length) return [...array];
        if (count <= 0) return [];
        
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > shuffled.length - 1 - count && i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        
        return shuffled.slice(shuffled.length - count);
    }

    // ─── Compatibility Methods ─────────────────────

    /**
     * Alias for getRandomSubset - for backward compatibility
     * @param {number} count - Number of wallets to get
     * @returns {Keypair[]}
     */
    getWallets(count) {
        return this.getRandomSubset(count);
    }

    /**
     * Check if wallet pool is ephemeral (always returns false for persistent pool)
     * @returns {boolean}
     */
    get isEphemeral() {
        return false;
    }
}

// ─── Module Exports ────────────────────────────────
export default WalletPool;