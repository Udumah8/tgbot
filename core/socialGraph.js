/**
 * core/socialGraph.js
 * 
 * Social influence graph for wallet agents
 * Implements behavioral contagion and leader-follower dynamics
 * 
 * Features:
 * - Leader/follower relationships
 * - Influence score tracking
 * - Behavioral contagion propagation
 * - Whale imitation
 * - Trend following
 */

import fs from 'fs/promises';
import path from 'path';

const SOCIAL_GRAPH_STORAGE_PATH = './storage/social_graph.json';

/**
 * Wallet roles in social graph
 */
const WalletRole = {
    LEADER: 'LEADER',
    FOLLOWER: 'FOLLOWER',
    INDEPENDENT: 'INDEPENDENT',
    WHALE: 'WHALE'
};

/**
 * Social node representing a wallet in the graph
 */
class SocialNode {
    constructor(walletKey, data = {}) {
        this.walletKey = walletKey;
        this.role = data.role || WalletRole.INDEPENDENT;
        this.influenceScore = data.influenceScore || 0.5;
        this.followers = data.followers || [];
        this.following = data.following || [];
        this.recentActions = data.recentActions || [];
        this.profitability = data.profitability || 0.0;
        this.tradeCount = data.tradeCount || 0;
        this.successRate = data.successRate || 0.5;
        this.createdAt = data.createdAt || Date.now();
        this.lastUpdate = data.lastUpdate || Date.now();
    }

    /**
     * Update node from trade outcome
     */
    updateFromTrade(trade) {
        this.tradeCount++;
        
        // Update success rate
        if (trade.success) {
            this.successRate = (this.successRate * 0.95) + (1.0 * 0.05);
        } else {
            this.successRate = (this.successRate * 0.95) + (0.0 * 0.05);
        }
        
        // Update profitability
        if (trade.pnl !== undefined) {
            this.profitability = (this.profitability * 0.9) + (trade.pnl * 0.1);
        }
        
        // Record action
        this.recentActions.push({
            type: trade.type,
            success: trade.success,
            pnl: trade.pnl || 0,
            timestamp: Date.now()
        });
        
        // Trim action history
        if (this.recentActions.length > 50) {
            this.recentActions = this.recentActions.slice(-50);
        }
        
        // Update influence score
        this._updateInfluenceScore();
        
        this.lastUpdate = Date.now();
    }

    /**
     * Update influence score based on performance
     * @private
     */
    _updateInfluenceScore() {
        // Base influence from success rate
        let influence = this.successRate * 0.4;
        
        // Add profitability component
        influence += Math.max(0, Math.min(0.3, this.profitability * 10));
        
        // Add experience component
        const experienceFactor = Math.min(0.3, this.tradeCount / 100);
        influence += experienceFactor;
        
        // Whale bonus
        if (this.role === WalletRole.WHALE) {
            influence += 0.2;
        }
        
        this.influenceScore = Math.max(0.0, Math.min(1.0, influence));
        
        // Update role based on influence
        if (this.influenceScore > 0.7 && this.followers.length > 3) {
            this.role = WalletRole.LEADER;
        } else if (this.following.length > this.followers.length && this.following.length > 0) {
            this.role = WalletRole.FOLLOWER;
        } else {
            this.role = WalletRole.INDEPENDENT;
        }
    }

    /**
     * Add follower
     */
    addFollower(walletKey) {
        if (!this.followers.includes(walletKey)) {
            this.followers.push(walletKey);
            this._updateInfluenceScore();
        }
    }

    /**
     * Remove follower
     */
    removeFollower(walletKey) {
        this.followers = this.followers.filter(w => w !== walletKey);
        this._updateInfluenceScore();
    }

    /**
     * Follow another wallet
     */
    follow(walletKey) {
        if (!this.following.includes(walletKey)) {
            this.following.push(walletKey);
            this._updateInfluenceScore();
        }
    }

    /**
     * Unfollow wallet
     */
    unfollow(walletKey) {
        this.following = this.following.filter(w => w !== walletKey);
        this._updateInfluenceScore();
    }

    /**
     * Get recent action summary
     */
    getRecentActionSummary() {
        const recent = this.recentActions.slice(-10);
        const buys = recent.filter(a => a.type === 'BUY').length;
        const sells = recent.filter(a => a.type === 'SELL').length;
        const avgPnL = recent.reduce((sum, a) => sum + (a.pnl || 0), 0) / Math.max(1, recent.length);
        
        return { buys, sells, avgPnL, total: recent.length };
    }

    /**
     * Serialize for storage
     */
    toJSON() {
        return {
            walletKey: this.walletKey,
            role: this.role,
            influenceScore: this.influenceScore,
            followers: this.followers,
            following: this.following,
            recentActions: this.recentActions,
            profitability: this.profitability,
            tradeCount: this.tradeCount,
            successRate: this.successRate,
            createdAt: this.createdAt,
            lastUpdate: this.lastUpdate
        };
    }

    /**
     * Create from JSON
     */
    static fromJSON(data) {
        return new SocialNode(data.walletKey, data);
    }
}

/**
 * Social graph managing wallet relationships
 */
class SocialGraph {
    constructor(logger = console) {
        this.logger = logger;
        this.nodes = new Map(); // walletKey -> SocialNode
        this.whaleWallets = new Set();
    }

    /**
     * Get or create node for wallet
     */
    getNode(walletKey) {
        if (!this.nodes.has(walletKey)) {
            const node = new SocialNode(walletKey);
            this.nodes.set(walletKey, node);
        }
        return this.nodes.get(walletKey);
    }

    /**
     * Mark wallet as whale
     */
    markAsWhale(walletKey) {
        const node = this.getNode(walletKey);
        node.role = WalletRole.WHALE;
        node.influenceScore = Math.max(node.influenceScore, 0.8);
        this.whaleWallets.add(walletKey);
    }

    /**
     * Update node from trade
     */
    updateFromTrade(walletKey, trade) {
        const node = this.getNode(walletKey);
        node.updateFromTrade(trade);
        
        // Propagate influence to followers
        this._propagateInfluence(walletKey, trade);
    }

    /**
     * Propagate influence to followers
     * @private
     */
    _propagateInfluence(walletKey, trade) {
        const node = this.nodes.get(walletKey);
        if (!node || node.followers.length === 0) return;
        
        // Only propagate successful trades from influential wallets
        if (!trade.success || node.influenceScore < 0.6) return;
        
        // Notify followers (this would trigger behavioral changes in their agents)
        for (const followerKey of node.followers) {
            const follower = this.nodes.get(followerKey);
            if (follower) {
                // Record influence event
                follower.recentActions.push({
                    type: 'INFLUENCED',
                    source: walletKey,
                    action: trade.type,
                    timestamp: Date.now()
                });
            }
        }
    }

    /**
     * Create follow relationship
     */
    createFollowRelationship(followerKey, leaderKey) {
        if (followerKey === leaderKey) return;
        
        const follower = this.getNode(followerKey);
        const leader = this.getNode(leaderKey);
        
        follower.follow(leaderKey);
        leader.addFollower(followerKey);
        
        this.logger.debug(`[SocialGraph] ${followerKey.slice(0, 8)} now follows ${leaderKey.slice(0, 8)}`);
    }

    /**
     * Remove follow relationship
     */
    removeFollowRelationship(followerKey, leaderKey) {
        const follower = this.nodes.get(followerKey);
        const leader = this.nodes.get(leaderKey);
        
        if (follower) follower.unfollow(leaderKey);
        if (leader) leader.removeFollower(followerKey);
    }

    /**
     * Get influence from leaders for a wallet
     * Returns aggregated influence signal
     */
    getInfluenceSignal(walletKey, dna) {
        const node = this.getNode(walletKey);
        
        // Independent wallets ignore influence
        if (node.role === WalletRole.INDEPENDENT || dna.socialSusceptibility < 0.3) {
            return { buyPressure: 0, sellPressure: 0, confidence: 0 };
        }
        
        let buyPressure = 0;
        let sellPressure = 0;
        let confidenceBoost = 0;
        let totalInfluence = 0;
        
        // Aggregate influence from followed wallets
        for (const leaderKey of node.following) {
            const leader = this.nodes.get(leaderKey);
            if (!leader) continue;
            
            const recentActions = leader.recentActions.slice(-5);
            const buys = recentActions.filter(a => a.type === 'BUY').length;
            const sells = recentActions.filter(a => a.type === 'SELL').length;
            
            const weight = leader.influenceScore * dna.socialSusceptibility;
            
            buyPressure += (buys / Math.max(1, recentActions.length)) * weight;
            sellPressure += (sells / Math.max(1, recentActions.length)) * weight;
            confidenceBoost += leader.profitability * weight;
            totalInfluence += weight;
        }
        
        // Normalize
        if (totalInfluence > 0) {
            buyPressure /= totalInfluence;
            sellPressure /= totalInfluence;
            confidenceBoost /= totalInfluence;
        }
        
        return {
            buyPressure: Math.max(0, Math.min(1, buyPressure)),
            sellPressure: Math.max(0, Math.min(1, sellPressure)),
            confidence: Math.max(-0.2, Math.min(0.2, confidenceBoost))
        };
    }

    /**
     * Auto-form relationships based on performance
     */
    autoFormRelationships() {
        // Get all nodes sorted by influence
        const sortedNodes = Array.from(this.nodes.values())
            .sort((a, b) => b.influenceScore - a.influenceScore);
        
        const leaders = sortedNodes.filter(n => n.influenceScore > 0.7).slice(0, 10);
        const followers = sortedNodes.filter(n => n.influenceScore < 0.5 && n.role !== WalletRole.WHALE);
        
        // Randomly assign followers to leaders
        for (const follower of followers) {
            // Skip if already following enough wallets
            if (follower.following.length >= 3) continue;
            
            // Pick random leader
            const leader = leaders[Math.floor(Math.random() * leaders.length)];
            if (leader && leader.walletKey !== follower.walletKey) {
                this.createFollowRelationship(follower.walletKey, leader.walletKey);
            }
        }
    }

    /**
     * Get top leaders
     */
    getTopLeaders(count = 10) {
        return Array.from(this.nodes.values())
            .sort((a, b) => b.influenceScore - a.influenceScore)
            .slice(0, count)
            .map(n => ({
                wallet: n.walletKey,
                role: n.role,
                influence: n.influenceScore,
                followers: n.followers.length,
                profitability: n.profitability,
                successRate: n.successRate
            }));
    }

    /**
     * Get graph statistics
     */
    getStats() {
        const nodes = Array.from(this.nodes.values());
        
        return {
            totalNodes: nodes.length,
            leaders: nodes.filter(n => n.role === WalletRole.LEADER).length,
            followers: nodes.filter(n => n.role === WalletRole.FOLLOWER).length,
            independent: nodes.filter(n => n.role === WalletRole.INDEPENDENT).length,
            whales: nodes.filter(n => n.role === WalletRole.WHALE).length,
            avgInfluence: nodes.reduce((sum, n) => sum + n.influenceScore, 0) / Math.max(1, nodes.length),
            totalRelationships: nodes.reduce((sum, n) => sum + n.following.length, 0)
        };
    }

    /**
     * Serialize for storage
     */
    toJSON() {
        return {
            nodes: Array.from(this.nodes.values()).map(n => n.toJSON()),
            whaleWallets: Array.from(this.whaleWallets)
        };
    }

    /**
     * Load from JSON
     */
    static fromJSON(data, logger) {
        const graph = new SocialGraph(logger);
        
        if (data.nodes) {
            for (const nodeData of data.nodes) {
                const node = SocialNode.fromJSON(nodeData);
                graph.nodes.set(node.walletKey, node);
            }
        }
        
        if (data.whaleWallets) {
            graph.whaleWallets = new Set(data.whaleWallets);
        }
        
        return graph;
    }
}

/**
 * Social Graph Engine - manages social graph persistence
 */
class SocialGraphEngine {
    constructor(logger = console) {
        this.logger = logger;
        this.graph = new SocialGraph(logger);
        this.autoSaveInterval = null;
    }

    /**
     * Initialize engine
     */
    async initialize() {
        try {
            // Try to load existing graph
            const stored = await this._loadGraph();
            if (stored) {
                this.graph = stored;
                this.logger.info('[SocialGraphEngine] Loaded existing graph');
            } else {
                this.logger.info('[SocialGraphEngine] Created new graph');
            }
            
            // Start auto-save
            this.startAutoSave(120000); // Save every 2 minutes
            
            // Start auto-relationship formation
            this.startAutoRelationships(300000); // Every 5 minutes
            
        } catch (error) {
            this.logger.error('[SocialGraphEngine] Failed to initialize:', error);
        }
    }

    /**
     * Get graph
     */
    getGraph() {
        return this.graph;
    }

    /**
     * Start auto-save interval
     */
    startAutoSave(intervalMs) {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }
        
        this.autoSaveInterval = setInterval(async () => {
            await this._saveGraph();
        }, intervalMs);
    }

    /**
     * Start auto-relationship formation
     */
    startAutoRelationships(intervalMs) {
        if (this.autoRelationshipInterval) {
            clearInterval(this.autoRelationshipInterval);
        }
        
        this.autoRelationshipInterval = setInterval(() => {
            this.graph.autoFormRelationships();
        }, intervalMs);
    }

    /**
     * Stop auto-save
     */
    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
        if (this.autoRelationshipInterval) {
            clearInterval(this.autoRelationshipInterval);
            this.autoRelationshipInterval = null;
        }
    }

    /**
     * Load graph from storage
     * @private
     */
    async _loadGraph() {
        try {
            const data = await fs.readFile(SOCIAL_GRAPH_STORAGE_PATH, 'utf8');
            return SocialGraph.fromJSON(JSON.parse(data), this.logger);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.warn('[SocialGraphEngine] Error loading graph:', error.message);
            }
            return null;
        }
    }

    /**
     * Save graph to storage
     * @private
     */
    async _saveGraph() {
        try {
            const dir = path.dirname(SOCIAL_GRAPH_STORAGE_PATH);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(SOCIAL_GRAPH_STORAGE_PATH, JSON.stringify(this.graph.toJSON(), null, 2));
        } catch (error) {
            this.logger.error('[SocialGraphEngine] Error saving graph:', error);
        }
    }

    /**
     * Shutdown engine
     */
    async shutdown() {
        this.stopAutoSave();
        await this._saveGraph();
        this.logger.info('[SocialGraphEngine] Shutdown complete');
    }
}

export { SocialGraph, SocialGraphEngine, SocialNode, WalletRole };
