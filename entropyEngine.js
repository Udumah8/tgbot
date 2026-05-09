/**
 * entropyEngine.js
 * 
 * Per-wallet deterministic entropy engine for high-quality randomness
 * Eliminates Math.random() and provides reproducible, wallet-specific entropy
 * 
 * Features:
 * - Deterministic seeding based on wallet public key + time bucket
 * - Mulberry32 PRNG for high-quality random numbers
 * - Poisson distribution for realistic delays
 * - Normal distribution for natural variance
 * - Weighted choice for probability-based decisions
 */

import crypto from 'crypto';

class EntropyEngine {
    /**
     * Create a new entropy engine for a specific wallet
     * @param {string} walletPublicKey - Base58 wallet public key
     * @param {number} timeBucketMs - Time bucket size in milliseconds (default: 60000 = 1 minute)
     */
    constructor(walletPublicKey, timeBucketMs = 60000) {
        this.walletPublicKey = walletPublicKey;
        this.timeBucketMs = timeBucketMs;
        this.seed = this._generateSeed();
        this.state = this.seed;
        this.lastReseed = Date.now();
    }

    /**
     * Generate deterministic seed from wallet + time bucket
     * @private
     */
    _generateSeed() {
        const timeBucket = Math.floor(Date.now() / this.timeBucketMs);
        const seedString = `${this.walletPublicKey}-${timeBucket}`;
        const hash = crypto.createHash('sha256').update(seedString).digest();
        
        // Convert first 4 bytes to 32-bit unsigned integer
        const seed = hash.readUInt32BE(0);
        return seed >>> 0; // Ensure unsigned
    }

    /**
     * Check if we need to reseed based on time bucket
     * @private
     */
    _checkReseed() {
        const now = Date.now();
        const currentBucket = Math.floor(now / this.timeBucketMs);
        const lastBucket = Math.floor(this.lastReseed / this.timeBucketMs);
        
        if (currentBucket !== lastBucket) {
            this.seed = this._generateSeed();
            this.state = this.seed;
            this.lastReseed = now;
        }
    }

    /**
     * Mulberry32 PRNG - high quality, fast, simple
     * @private
     */
    _next() {
        this._checkReseed();
        
        let t = this.state += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        const result = ((t ^ t >>> 14) >>> 0) / 4294967296;
        
        this.state = t;
        return result;
    }

    /**
     * Generate random float in range [min, max)
     * @param {number} min - Minimum value (inclusive)
     * @param {number} max - Maximum value (exclusive)
     * @returns {number}
     */
    getRandomFloat(min, max) {
        if (min >= max) {
            throw new Error(`Invalid range: min (${min}) must be less than max (${max})`);
        }
        return min + this._next() * (max - min);
    }

    /**
     * Generate random integer in range [min, max]
     * @param {number} min - Minimum value (inclusive)
     * @param {number} max - Maximum value (inclusive)
     * @returns {number}
     */
    getRandomInt(min, max) {
        if (min > max) {
            throw new Error(`Invalid range: min (${min}) must be <= max (${max})`);
        }
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(this._next() * (max - min + 1)) + min;
    }

    /**
     * Generate Poisson-distributed delay (realistic inter-arrival times)
     * @param {number} lambda - Average rate (events per second)
     * @returns {number} Delay in milliseconds
     */
    getPoissonDelay(lambda) {
        if (lambda <= 0) {
            throw new Error(`Lambda must be positive, got ${lambda}`);
        }
        
        // Inverse transform sampling for exponential distribution
        // Exponential is the continuous analog of Poisson for inter-arrival times
        const u = this._next();
        const delay = -Math.log(1 - u) / lambda;
        
        // Convert to milliseconds
        return Math.max(0, Math.floor(delay * 1000));
    }

    /**
     * Generate normally distributed value using Box-Muller transform
     * @param {number} mean - Mean of distribution
     * @param {number} stdDev - Standard deviation
     * @returns {number}
     */
    getNormalDistribution(mean, stdDev) {
        if (stdDev <= 0) {
            throw new Error(`Standard deviation must be positive, got ${stdDev}`);
        }
        
        // Box-Muller transform
        const u1 = this._next();
        const u2 = this._next();
        
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        return mean + z0 * stdDev;
    }

    /**
     * Choose from weighted options
     * @param {Array<{value: any, weight: number}>} options - Array of {value, weight} objects
     * @returns {any} Selected value
     */
    getWeightedChoice(options) {
        if (!Array.isArray(options) || options.length === 0) {
            throw new Error('Options must be a non-empty array');
        }
        
        // Calculate total weight
        const totalWeight = options.reduce((sum, opt) => {
            if (typeof opt.weight !== 'number' || opt.weight < 0) {
                throw new Error('All weights must be non-negative numbers');
            }
            return sum + opt.weight;
        }, 0);
        
        if (totalWeight === 0) {
            throw new Error('Total weight must be greater than 0');
        }
        
        // Random selection
        let random = this._next() * totalWeight;
        
        for (const option of options) {
            random -= option.weight;
            if (random <= 0) {
                return option.value;
            }
        }
        
        // Fallback (should never reach here due to floating point)
        return options[options.length - 1].value;
    }

    /**
     * Generate random boolean with given probability
     * @param {number} probability - Probability of true (0.0 to 1.0)
     * @returns {boolean}
     */
    getRandomBoolean(probability = 0.5) {
        if (probability < 0 || probability > 1) {
            throw new Error(`Probability must be between 0 and 1, got ${probability}`);
        }
        return this._next() < probability;
    }

    /**
     * Shuffle array in place using Fisher-Yates algorithm
     * @param {Array} array - Array to shuffle
     * @returns {Array} Shuffled array (same reference)
     */
    shuffleArray(array) {
        if (!Array.isArray(array)) {
            throw new Error('Input must be an array');
        }
        
        for (let i = array.length - 1; i > 0; i--) {
            const j = this.getRandomInt(0, i);
            [array[i], array[j]] = [array[j], array[i]];
        }
        
        return array;
    }

    /**
     * Pick random element from array
     * @param {Array} array - Array to pick from
     * @returns {any} Random element
     */
    pickRandom(array) {
        if (!Array.isArray(array) || array.length === 0) {
            throw new Error('Input must be a non-empty array');
        }
        
        const index = this.getRandomInt(0, array.length - 1);
        return array[index];
    }

    /**
     * Generate random amount with variance
     * @param {number} baseAmount - Base amount
     * @param {number} variance - Variance as decimal (e.g., 0.25 for ±25%)
     * @returns {number}
     */
    getRandomizedAmount(baseAmount, variance) {
        if (baseAmount <= 0) {
            throw new Error(`Base amount must be positive, got ${baseAmount}`);
        }
        if (variance < 0 || variance > 1) {
            throw new Error(`Variance must be between 0 and 1, got ${variance}`);
        }
        
        const minAmount = baseAmount * (1 - variance);
        const maxAmount = baseAmount * (1 + variance);
        return this.getRandomFloat(minAmount, maxAmount);
    }

    /**
     * Generate jittered interval
     * @param {number} baseInterval - Base interval in milliseconds
     * @param {number} jitterPercent - Jitter percentage (e.g., 20 for ±20%)
     * @returns {number} Jittered interval in milliseconds
     */
    getJitteredInterval(baseInterval, jitterPercent) {
        if (baseInterval <= 0) {
            throw new Error(`Base interval must be positive, got ${baseInterval}`);
        }
        if (jitterPercent < 0 || jitterPercent > 100) {
            throw new Error(`Jitter percent must be between 0 and 100, got ${jitterPercent}`);
        }
        
        const variation = baseInterval * (jitterPercent / 100);
        return Math.floor(this.getRandomFloat(baseInterval - variation, baseInterval + variation));
    }

    /**
     * Get current seed (for debugging/logging)
     * @returns {number}
     */
    getCurrentSeed() {
        return this.seed;
    }

    /**
     * Get wallet public key
     * @returns {string}
     */
    getWalletKey() {
        return this.walletPublicKey;
    }
}

export { EntropyEngine };
