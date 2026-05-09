// walletAging.js - Wallet Aging & Seasoning System

// ─────────────────────────────────────────────
// 🕐 Wallet Age Tiers Configuration
// ─────────────────────────────────────────────
export const WALLET_AGE_TIERS = {
    FRESH: {
        minAge: 0,           // 0 days
        maxAge: 86400000,    // 1 day
        trustScore: 0.2,
        label: '🆕 Fresh',
        restrictions: ['limited_amounts', 'no_large_trades', 'frequent_delays'],
        amountMultiplier: 0.6,  // Trade 60% of base amount
        delayMultiplier: 1.8     // Wait 180% longer
    },
    YOUNG: {
        minAge: 86400000,    // 1 day
        maxAge: 604800000,   // 7 days
        trustScore: 0.4,
        label: '🌱 Young',
        restrictions: ['moderate_amounts', 'occasional_delays'],
        amountMultiplier: 0.75,
        delayMultiplier: 1.4
    },
    SEASONED: {
        minAge: 604800000,   // 7 days
        maxAge: 2592000000,  // 30 days
        trustScore: 0.7,
        label: '🌿 Seasoned',
        restrictions: ['normal_trading'],
        amountMultiplier: 0.9,
        delayMultiplier: 1.1
    },
    MATURE: {
        minAge: 2592000000,  // 30 days
        maxAge: 7776000000,  // 90 days
        trustScore: 0.9,
        label: '🌳 Mature',
        restrictions: [],
        amountMultiplier: 1.0,
        delayMultiplier: 1.0
    },
    VETERAN: {
        minAge: 7776000000,  // 90+ days
        maxAge: Infinity,
        trustScore: 1.0,
        label: '🏆 Veteran',
        restrictions: [],
        amountMultiplier: 1.2,  // Can trade 120% of base
        delayMultiplier: 0.8     // Can trade 20% faster
    }
};

// ─────────────────────────────────────────────
// 🎭 Trading Personalities
// ─────────────────────────────────────────────
export const TRADING_PERSONALITIES = {
    CONSERVATIVE: {
        riskTolerance: 0.3,
        impulsiveness: 0.2,
        avgDelayMultiplier: 1.5,
        preferredTimeSlots: [9, 10, 14, 15],  // Business hours
        tradeFrequency: 0.6
    },
    MODERATE: {
        riskTolerance: 0.5,
        impulsiveness: 0.5,
        avgDelayMultiplier: 1.0,
        preferredTimeSlots: [9, 12, 15, 18, 21],
        tradeFrequency: 0.8
    },
    AGGRESSIVE: {
        riskTolerance: 0.8,
        impulsiveness: 0.7,
        avgDelayMultiplier: 0.7,
        preferredTimeSlots: [0, 3, 6, 9, 12, 15, 18, 21],  // Active all day
        tradeFrequency: 1.0
    },
    WHALE: {
        riskTolerance: 0.9,
        impulsiveness: 0.3,
        avgDelayMultiplier: 2.0,  // Slow and deliberate
        preferredTimeSlots: [10, 14, 22],  // Strategic times
        tradeFrequency: 0.4
    },
    SCALPER: {
        riskTolerance: 0.6,
        impulsiveness: 0.9,
        avgDelayMultiplier: 0.5,  // Very fast
        preferredTimeSlots: [9, 10, 11, 14, 15, 16],  // Peak hours
        tradeFrequency: 1.2
    }
};

// ─────────────────────────────────────────────
// 📊 Wallet Metadata Manager
// ─────────────────────────────────────────────
export class WalletAgingManager {
    
    /**
     * Initialize metadata for a wallet
     */
    static initializeMetadata() {
        const personality = this._assignPersonality();
        
        return {
            createdAt: Date.now(),
            firstTradeAt: null,
            lastTradeAt: null,
            totalTrades: 0,
            totalVolume: 0,
            ageTier: 'FRESH',
            trustScore: 0.2,
            personality: personality.name,
            seasoningActivities: {
                solTransfers: 0,
                tokenSwaps: 0,
                uniqueTokens: new Set(),
                daysActive: 0,
                avgTradeSize: 0,
                largestTrade: 0,
                lastActivityDate: null
            },
            behaviorProfile: {
                preferredTimeSlots: personality.preferredTimeSlots,
                avgDelayBetweenTrades: this._generateAvgDelay(personality),
                riskTolerance: personality.riskTolerance,
                impulsiveness: personality.impulsiveness,
                tradeFrequency: personality.tradeFrequency
            }
        };
    }

    /**
     * Assign random personality to wallet
     */
    static _assignPersonality() {
        const personalities = Object.keys(TRADING_PERSONALITIES);
        const weights = [0.3, 0.35, 0.2, 0.1, 0.05];  // Distribution
        
        const random = Math.random();
        let cumulative = 0;
        
        for (let i = 0; i < personalities.length; i++) {
            cumulative += weights[i];
            if (random < cumulative) {
                return {
                    name: personalities[i],
                    ...TRADING_PERSONALITIES[personalities[i]]
                };
            }
        }
        
        return {
            name: 'MODERATE',
            ...TRADING_PERSONALITIES.MODERATE
        };
    }

    /**
     * Generate average delay based on personality
     */
    static _generateAvgDelay(personality) {
        const baseDelay = 3600000; // 1 hour
        const variance = baseDelay * 0.3 * Math.random();
        return Math.floor((baseDelay * personality.avgDelayMultiplier) + variance);
    }

    /**
     * Update wallet metadata after a trade
     */
    static updateTradeMetadata(metadata, tradeAmount, tokenAddress) {
        const now = Date.now();
        
        // Update trade stats
        if (!metadata.firstTradeAt) metadata.firstTradeAt = now;
        metadata.lastTradeAt = now;
        metadata.totalTrades++;
        metadata.totalVolume += tradeAmount;
        
        // Update seasoning activities
        metadata.seasoningActivities.tokenSwaps++;
        metadata.seasoningActivities.uniqueTokens.add(tokenAddress);
        metadata.seasoningActivities.avgTradeSize = 
            metadata.totalVolume / metadata.totalTrades;
        metadata.seasoningActivities.largestTrade = 
            Math.max(metadata.seasoningActivities.largestTrade, tradeAmount);
        
        // Update days active
        const today = new Date().toDateString();
        if (metadata.seasoningActivities.lastActivityDate !== today) {
            metadata.seasoningActivities.daysActive++;
            metadata.seasoningActivities.lastActivityDate = today;
        }
        
        // Update age tier
        this.updateAgeTier(metadata);
        
        return metadata;
    }

    /**
     * Calculate and update wallet age tier
     */
    static updateAgeTier(metadata) {
        const age = Date.now() - metadata.createdAt;
        
        for (const [tier, config] of Object.entries(WALLET_AGE_TIERS)) {
            if (age >= config.minAge && age < config.maxAge) {
                metadata.ageTier = tier;
                metadata.trustScore = config.trustScore;
                break;
            }
        }
        
        return metadata;
    }

    /**
     * Calculate age-based delay for trading
     */
    static calculateAgeBasedDelay(metadata, baseDelay) {
        const ageTier = WALLET_AGE_TIERS[metadata.ageTier];
        const personalityMultiplier = metadata.behaviorProfile.avgDelayBetweenTrades / 3600000;
        
        // Combine age and personality factors
        const totalMultiplier = ageTier.delayMultiplier * personalityMultiplier;
        
        // Add randomness
        const variance = baseDelay * 0.2 * (Math.random() - 0.5);
        
        return Math.floor(baseDelay * totalMultiplier + variance);
    }

    /**
     * Calculate age-based trade amount
     */
    static calculateAgeBasedAmount(metadata, baseAmount) {
        const ageTier = WALLET_AGE_TIERS[metadata.ageTier];
        const riskMultiplier = 0.8 + (metadata.behaviorProfile.riskTolerance * 0.4);
        
        // Combine age and risk factors
        const totalMultiplier = ageTier.amountMultiplier * riskMultiplier;
        
        // Add randomness
        const variance = baseAmount * 0.15 * (Math.random() - 0.5);
        
        return Math.max(0.0001, baseAmount * totalMultiplier + variance);
    }

    /**
     * Check if wallet should trade now based on preferred time slots
     */
    static shouldTradeNow(metadata) {
        const currentHour = new Date().getHours();
        const preferredSlots = metadata.behaviorProfile.preferredTimeSlots;
        
        // Check if current hour is in preferred slots (±1 hour tolerance)
        for (const slot of preferredSlots) {
            if (Math.abs(currentHour - slot) <= 1) {
                return true;
            }
        }
        
        // Random chance to trade outside preferred hours (impulsiveness)
        return Math.random() < metadata.behaviorProfile.impulsiveness * 0.3;
    }

    /**
     * Get wallet age in human-readable format
     */
    static getWalletAge(metadata) {
        const age = Date.now() - metadata.createdAt;
        const days = Math.floor(age / 86400000);
        const hours = Math.floor((age % 86400000) / 3600000);
        
        if (days > 0) {
            return `${days}d ${hours}h`;
        }
        return `${hours}h`;
    }

    /**
     * Get aging statistics for a wallet
     */
    static getWalletStats(metadata) {
        const ageTier = WALLET_AGE_TIERS[metadata.ageTier];
        
        return {
            age: this.getWalletAge(metadata),
            tier: ageTier.label,
            trustScore: metadata.trustScore,
            totalTrades: metadata.totalTrades,
            totalVolume: metadata.totalVolume.toFixed(4),
            avgTradeSize: metadata.seasoningActivities.avgTradeSize.toFixed(4),
            daysActive: metadata.seasoningActivities.daysActive,
            personality: metadata.personality,
            uniqueTokens: metadata.seasoningActivities.uniqueTokens.size
        };
    }

    /**
     * Serialize metadata for storage (convert Set to Array)
     */
    static serializeMetadata(metadata) {
        return {
            ...metadata,
            seasoningActivities: {
                ...metadata.seasoningActivities,
                uniqueTokens: Array.from(metadata.seasoningActivities.uniqueTokens)
            }
        };
    }

    /**
     * Deserialize metadata from storage (convert Array to Set)
     */
    static deserializeMetadata(metadata) {
        return {
            ...metadata,
            seasoningActivities: {
                ...metadata.seasoningActivities,
                uniqueTokens: new Set(metadata.seasoningActivities.uniqueTokens || [])
            }
        };
    }
}

export default WalletAgingManager;
