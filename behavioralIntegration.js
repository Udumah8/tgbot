/**
 * behavioralIntegration.js
 * 
 * Integration layer between the behavioral ecosystem and existing trading system
 * Provides seamless integration without breaking existing functionality
 */

import { BehavioralEcosystem } from './core/behavioralEcosystem.js';

/**
 * Global behavioral ecosystem instance
 */
let behavioralEcosystem = null;

/**
 * Initialize the behavioral ecosystem
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<BehavioralEcosystem>}
 */
export async function initializeBehavioralEcosystem(logger) {
    if (behavioralEcosystem) {
        logger.warn('[BehavioralIntegration] Ecosystem already initialized');
        return behavioralEcosystem;
    }

    logger.info('[BehavioralIntegration] Initializing behavioral ecosystem...');
    
    try {
        behavioralEcosystem = new BehavioralEcosystem(logger);
        await behavioralEcosystem.initialize();
        
        logger.info('[BehavioralIntegration] ✅ Behavioral ecosystem initialized');
        return behavioralEcosystem;
    } catch (error) {
        logger.error('[BehavioralIntegration] Failed to initialize ecosystem:', error);
        throw error;
    }
}

/**
 * Get the behavioral ecosystem instance
 * @returns {BehavioralEcosystem|null}
 */
export function getBehavioralEcosystem() {
    return behavioralEcosystem;
}

/**
 * Enhanced decideAction function with behavioral modifiers
 * Wraps the original behavior decideAction with ecosystem modifiers
 * 
 * @param {Object} agent - WalletAgent instance
 * @param {Function} originalDecideAction - Original behavior decideAction function
 * @returns {Promise<Object>} Action decision
 */
export async function enhancedDecideAction(agent, originalDecideAction) {
    const walletKey = agent.wallet.publicKey.toBase58();
    
    // If ecosystem not initialized, use original behavior
    if (!behavioralEcosystem) {
        return await originalDecideAction(agent);
    }

    try {
        // Get behavioral modifiers
        const modifiers = await behavioralEcosystem.getBehavioralModifiers(walletKey);
        
        // Check if wallet should pause
        if (modifiers.shouldPause) {
            agent.logger.debug(`${agent.logPrefix} Paused by behavioral ecosystem`);
            return { type: 'WAIT' };
        }

        // Get base action from original behavior
        const baseAction = await originalDecideAction(agent);
        
        // If base action is WAIT, respect it
        if (!baseAction || baseAction.type === 'WAIT') {
            return baseAction;
        }

        // Apply behavioral modifiers to the action
        const enhancedAction = applyModifiersToAction(baseAction, modifiers, agent);
        
        return enhancedAction;
    } catch (error) {
        agent.logger.error(`${agent.logPrefix} Error in enhanced decision:`, error);
        // Fallback to original behavior on error
        return await originalDecideAction(agent);
    }
}

/**
 * Apply behavioral modifiers to an action
 * @private
 */
function applyModifiersToAction(action, modifiers, agent) {
    const enhanced = { ...action };
    
    if (action.type === 'BUY') {
        // Apply buy probability modifier
        const buyProb = 1.0 * modifiers.buyProbability;
        
        // Check if buy should proceed
        if (!agent.entropy.getRandomBoolean(Math.min(1.0, buyProb))) {
            return { type: 'WAIT' };
        }
        
        // Apply position size modifier
        if (enhanced.amount) {
            enhanced.amount = enhanced.amount * modifiers.positionSizeMultiplier;
            enhanced.amount = Math.max(agent.minBuyAmount, Math.min(agent.maxBuyAmount, enhanced.amount));
        }
        
        agent.logger.debug(`${agent.logPrefix} Buy enhanced: prob=${buyProb.toFixed(2)}, size=${modifiers.positionSizeMultiplier.toFixed(2)}`);
    }
    
    else if (action.type === 'SELL') {
        // Apply sell probability modifier
        const sellProb = 1.0 * modifiers.sellProbability;
        
        // Check if sell should proceed
        if (!agent.entropy.getRandomBoolean(Math.min(1.0, sellProb))) {
            return { type: 'WAIT' };
        }
        
        // Apply position size modifier
        if (enhanced.amount) {
            enhanced.amount = enhanced.amount * modifiers.positionSizeMultiplier;
        }
        
        agent.logger.debug(`${agent.logPrefix} Sell enhanced: prob=${sellProb.toFixed(2)}, size=${modifiers.positionSizeMultiplier.toFixed(2)}`);
    }
    
    return enhanced;
}

/**
 * Record a trade in the behavioral ecosystem
 * @param {string} walletKey - Wallet public key
 * @param {Object} trade - Trade details
 */
export async function recordTradeInEcosystem(walletKey, trade) {
    if (!behavioralEcosystem) return;
    
    try {
        await behavioralEcosystem.recordTrade(walletKey, trade);
    } catch (error) {
        // Don't throw - just log the error
        console.error(`[BehavioralIntegration] Error recording trade:`, error);
    }
}

/**
 * Update ecosystem with active wallet count
 * @param {number} count - Number of active wallets
 */
export function updateActiveWalletCount(count) {
    if (!behavioralEcosystem) return;
    
    try {
        behavioralEcosystem.ecosystemEngine.updateActiveWallets(count);
    } catch (error) {
        console.error(`[BehavioralIntegration] Error updating wallet count:`, error);
    }
}

/**
 * Get ecosystem statistics
 * @returns {Object|null} Ecosystem stats or null if not initialized
 */
export function getEcosystemStats() {
    if (!behavioralEcosystem) return null;
    
    try {
        return behavioralEcosystem.getStats();
    } catch (error) {
        console.error(`[BehavioralIntegration] Error getting stats:`, error);
        return null;
    }
}

/**
 * Shutdown the behavioral ecosystem
 */
export async function shutdownBehavioralEcosystem() {
    if (!behavioralEcosystem) return;
    
    try {
        await behavioralEcosystem.shutdown();
        behavioralEcosystem = null;
    } catch (error) {
        console.error(`[BehavioralIntegration] Error during shutdown:`, error);
    }
}

/**
 * Create enhanced agent config with behavioral integration
 * @param {Object} baseConfig - Base agent configuration
 * @param {Function} originalDecideAction - Original behavior decideAction
 * @returns {Object} Enhanced agent configuration
 */
export function createEnhancedAgentConfig(baseConfig, originalDecideAction) {
    return {
        ...baseConfig,
        
        // Wrap decideAction with behavioral modifiers
        decideAction: async (agent) => {
            return await enhancedDecideAction(agent, originalDecideAction);
        },
        
        // Enhance executeBuy to record trades
        executeBuy: async (wallet, amount, conn, tokenMint) => {
            const walletKey = wallet.publicKey.toBase58();
            const startTime = Date.now();
            
            try {
                // Execute original buy
                const result = await baseConfig.executeBuy(wallet, amount, conn, tokenMint);
                
                // Record successful trade
                await recordTradeInEcosystem(walletKey, {
                    type: 'BUY',
                    success: true,
                    amount,
                    pnl: 0, // PnL calculated on sell
                    holdTime: 0,
                    timestamp: Date.now()
                });
                
                return result;
            } catch (error) {
                // Record failed trade
                await recordTradeInEcosystem(walletKey, {
                    type: 'BUY',
                    success: false,
                    amount,
                    error: error.message,
                    timestamp: Date.now()
                });
                
                throw error;
            }
        },
        
        // Enhance executeSell to record trades with PnL
        executeSell: async (wallet, amount, conn, tokenMint) => {
            const walletKey = wallet.publicKey.toBase58();
            const startTime = Date.now();
            
            try {
                // Execute original sell
                const result = await baseConfig.executeSell(wallet, amount, conn, tokenMint);
                
                // Calculate hold time and PnL
                const holdTime = Date.now() - startTime;
                const pnl = result.solReceived || 0;
                
                // Record successful trade
                await recordTradeInEcosystem(walletKey, {
                    type: 'SELL',
                    success: true,
                    amount,
                    pnl,
                    holdTime,
                    solReceived: result.solReceived,
                    timestamp: Date.now()
                });
                
                return result;
            } catch (error) {
                // Record failed trade
                await recordTradeInEcosystem(walletKey, {
                    type: 'SELL',
                    success: false,
                    amount,
                    error: error.message,
                    timestamp: Date.now()
                });
                
                throw error;
            }
        }
    };
}

export default {
    initializeBehavioralEcosystem,
    getBehavioralEcosystem,
    enhancedDecideAction,
    recordTradeInEcosystem,
    updateActiveWalletCount,
    getEcosystemStats,
    shutdownBehavioralEcosystem,
    createEnhancedAgentConfig
};
