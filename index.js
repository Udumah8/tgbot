// bot.js - Solana Volume Bot v3.2 - FULLY PRODUCTION READY
// All 19 strategies integrated | Smart Sell with Dev Wallet | Complete Telegram UI
// Dependencies: npm install @solana/web3.js solana-swap bs58 winston node-telegram-bot-api dotenv

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import 'dotenv/config';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SolanaTracker } from "solana-swap";
import { Buffer } from "buffer";
import bs58 from "bs58";
import TelegramBot from "node-telegram-bot-api";
import winston from 'winston';

// Helper to map UI DEX names to SolanaTrade market identifiers
function mapMarket(targetDex) {
    if (!targetDex) return "RAYDIUM_AMM";
    const dex = targetDex.toUpperCase();
    if (dex.includes("PUMP_FUN") || dex.includes("PUMPFUN")) return "PUMP_FUN";
    if (dex.includes("PUMP_SWAP") || dex.includes("PUMPSWAP")) return "PUMP_SWAP";
    if (dex.includes("LAUNCHPAD")) return "RAYDIUM_LAUNCHPAD";
    if (dex.includes("CLMM") || dex.includes("RAYDIUM_CLMM")) return "RAYDIUM_CLMM";
    if (dex.includes("CPMM") || dex.includes("RAYDIUM_CPMM")) return "RAYDIUM_CPMM";
    if (dex.includes("RAYDIUM")) return "RAYDIUM_AMM";
    if (dex.includes("DLMM")) return "METEORA_DLMM";
    if (dex.includes("DAMM_V1")) return "METEORA_DAMM_V1";
    if (dex.includes("DAMM_V2")) return "METEORA_DAMM_V2";
    if (dex.includes("METEORA_DBC") || dex.includes("BONDING_CURVE")) return "METEORA_DBC";
    if (dex.includes("ORCA")) return "ORCA_WHIRLPOOL";
    if (dex.includes("MOONIT")) return "MOONIT";
    if (dex.includes("HEAVEN")) return "HEAVEN";
    if (dex.includes("SUGAR")) return "SUGAR";
    if (dex.includes("BOOP")) return "BOOP_FUN";
    return targetDex; // Fallback to provided name
}

// Import our modular components
import { sendJitoBundle, estimateJitoTip, isJitoErrorRetryable, JITO_TIP_ACCOUNTS } from "./jito.js";
import WalletPool from "./walletManager.js";
import { BatchSwapEngine } from "./batchEngine.js";
import { SeasoningEngine } from "./seasoningEngine.js";

// ─────────────────────────────────────────────
// 🛡️ Global Safety Guards
// ─────────────────────────────────────────────
let isShuttingDown = false;
let activeStrategy = null;
let lastCommandTime = new Map();
let globalWalletManager = null;

// ─────────────────────────────────────────────
// 🔐 Graceful Shutdown Handler
// ─────────────────────────────────────────────
process.on('SIGINT', async () => { await handleShutdown('SIGINT'); });
process.on('SIGTERM', async () => { await handleShutdown('SIGTERM'); });
process.on('uncaughtException', async (err) => {
    logger?.error(`Uncaught Exception: ${err.message}`);
    await handleShutdown('uncaughtException');
});
process.on('unhandledRejection', async (reason) => {
    const msg = reason?.message || String(reason);
    // Don't crash the bot for non-fatal Telegram errors
    const isNonFatal =
        msg.includes('query is too old') ||
        msg.includes('ETELEGRAM') ||
        msg.includes('message is not modified') ||
        msg.includes('bot was blocked') ||
        msg.includes('chat not found') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('fetch failed');

    if (isNonFatal) {
        logger?.warn(`Non-fatal Unhandled Rejection (suppressed): ${msg}`);
        return; // Do NOT shutdown
    }
    logger?.error(`Fatal Unhandled Rejection: ${msg}`);
    await handleShutdown('unhandledRejection');
});

async function handleShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger?.info(`🛑 Shutdown signal received: ${signal}`);
    STATE.running = false;

    if (activeStrategy) {
        logger?.info(`🔄 Cancelling active strategy: ${activeStrategy}`);
        if (bot && ADMIN_CHAT_ID) {
            bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Strategy ${activeStrategy} cancelled due to shutdown`, { parse_mode: 'Markdown' }).catch(() => { });
        }
    }

    if (smartSellInterval) {
        clearInterval(smartSellInterval);
        smartSellInterval = null;
    }

    saveConfig();
    await sleep(5000);

    if (globalWalletManager?._save) {
        globalWalletManager._save();
        logger?.info('💾 Wallets saved to disk before shutdown');
    }

    logger?.info('✅ Graceful shutdown complete');
    await logger?.end();
    process.exit(0);
}

// ─────────────────────────────────────────────
// 📝 Logger Configuration
// ─────────────────────────────────────────────
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack }) =>
            `${timestamp} [${level.toUpperCase()}]: ${message}${stack ? '\n' + stack : ''}`)
    ),
    transports: [
        new winston.transports.File({ filename: 'bot.log', maxsize: 5242880, maxFiles: 5 }),
        new winston.transports.Console()
    ]
});

// Optional SolanaTrade provider (if installed)
let SolanaTrade;
try {
    const stModule = await import("solana-trade");
    // Handle both ESM and CJS exports robustly
    SolanaTrade = stModule.SolanaTrade || stModule.default?.SolanaTrade || stModule.default;
    if (SolanaTrade) {
        logger.info("✅ SolanaTrade provider initialized successfully");
    } else {
        throw new Error("SolanaTrade class not found in module exports");
    }
} catch (e) {
    // Standard initialization warning
    logger.warn(`⚠️ SolanaTrade provider failed to load: ${e.message}. Using SolanaTracker as fallback.`);
}

// ─────────────────────────────────────────────
// 🌐 RPC Fallback with Exponential Backoff
// ─────────────────────────────────────────────
const RPC_URLS = process.env.RPC_URLS
    ? process.env.RPC_URLS.split(',').map(url => url.trim())
    : [process.env.RPC_URL || "https://api.mainnet-beta.solana.com"];

let currentRpcIndex = 0;

function getConnection() {
    const url = RPC_URLS[currentRpcIndex % RPC_URLS.length];
    return new Connection(url, { 
        commitment: 'confirmed', 
        confirmTransactionInitialTimeout: 60000,
        disableRetryOnRateLimit: false,
        httpHeaders: {
            'Content-Type': 'application/json'
        }
    });
}

async function withRpcFallback(fn, maxRetries = null) {
    const retries = maxRetries || Math.max(RPC_URLS.length, 3);
    let lastError;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const connection = getConnection();
            return await fn(connection);
        } catch (err) {
            lastError = err;
            const is429 = err.message?.includes('429') || err.message?.includes('Too Many Requests');
            
            if (is429) {
                logger.warn(`RPC rate limited (attempt ${attempt + 1}/${retries}). Switching endpoint...`);
                currentRpcIndex++;
            } else {
                logger.warn(`RPC ${RPC_URLS[currentRpcIndex % RPC_URLS.length]} failed (attempt ${attempt + 1}/${retries}): ${err.message}`);
                currentRpcIndex++;
            }

            if (attempt < retries - 1) {
                const baseDelay = is429 ? 2000 : 1000; // Longer delay for rate limits
                const exponential = baseDelay * Math.pow(2, Math.min(attempt, 4));
                const jitter = exponential * 0.2 * Math.random();
                const delay = Math.min(exponential + jitter, 10000);
                logger.info(`⏳ Retrying in ${Math.round(delay)}ms...`);
                await sleep(delay);
            }
        }
    }
    throw new Error(`All RPC endpoints failed. Last error: ${lastError?.message || 'Unknown'}`);
}

// ─────────────────────────────────────────────
// ⚙️ Configuration Management with Persistence
// ─────────────────────────────────────────────
const CONFIG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!TELEGRAM_TOKEN) {
    logger.error("❌ Missing TELEGRAM_TOKEN in .env");
    process.exit(1);
}

function saveConfig() {
    try {
        const sanitized = { ...STATE };
        delete sanitized.running;
        delete sanitized.smartSellDevWalletKeypair; // never persist private key
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(sanitized, null, 2));
        logger.debug('✅ Config saved to disk');
    } catch (e) {
        logger.error(`❌ Failed to save config: ${e.message}`);
    }
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
            Object.assign(STATE, saved);
            logger.info(`✅ Configuration loaded from ${CONFIG_FILE}`);
        }
    } catch (e) {
        logger.error(`❌ Failed to load config: ${e.message}`);
    }
}

// ─────────────────────────────────────────────
// 🤖 Telegram Bot Setup
// ─────────────────────────────────────────────
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: { autoStart: true, interval: 300 } });

// Handle Telegram polling errors (ECONNRESET, network drops) without crashing
bot.on('polling_error', (err) => {
    const msg = err?.message || String(err);
    // ECONNRESET and network errors are transient — Telegram bot-api auto-retries polling
    if (msg.includes('ECONNRESET') || msg.includes('EFATAL') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')) {
        logger.warn(`⚠️ Telegram polling error (will auto-retry): ${msg}`);
    } else if (msg.includes('409 Conflict')) {
        logger.error(`❌ Telegram 409 Conflict — another bot instance is running with the same token!`);
    } else {
        logger.error(`❌ Telegram polling error: ${msg}`);
    }
});

// Master wallet
let masterKeypair = null;
if (process.env.PRIVKEY) {
    try {
        if (process.env.PRIVKEY.trim().startsWith('[')) {
            masterKeypair = Keypair.fromSecretKey(Buffer.from(JSON.parse(process.env.PRIVKEY)));
        } else {
            masterKeypair = Keypair.fromSecretKey(bs58.decode(process.env.PRIVKEY.trim()));
        }
        const pubKey = masterKeypair.publicKey.toBase58();
        logger.info(`✅ Master Wallet loaded: ${pubKey.substring(0, 8)}...${pubKey.substring(pubKey.length - 4)}`);
    } catch (e) {
        logger.error(`❌ Failed to load master wallet: ${e.message}`);
    }
} else {
    logger.warn("⚠️ No PRIVKEY in .env — wallet operations disabled (read-only mode)");
}

// ─────────────────────────────────────────────
// 💼 Wallet Manager Initialization
// ─────────────────────────────────────────────
const SOL_ADDR = "So11111111111111111111111111111111111111112";
const walletManager = new WalletPool();
logger.info(`💼 Wallet Manager: ${walletManager.size.toLocaleString()} wallets loaded`);

// ─────────────────────────────────────────────
// 👥 User Session Management
// ─────────────────────────────────────────────
const userSessions = new Map();

function clearSession(chatId) {
    const cid = chatId.toString();
    const session = userSessions.get(cid);
    if (session) {
        clearTimeout(session.timeout);
        userSessions.delete(cid);
        logger.debug(`🧹 Cleared session for chat ${cid}`);
    }
}

setInterval(() => {
    const now = Date.now();
    const expired = [];
    for (const [chatId, session] of userSessions.entries()) {
        if (now - session.created > 300000) expired.push(chatId);
    }
    for (const cid of expired) {
        clearTimeout(userSessions.get(cid).timeout);
        userSessions.delete(cid);
    }
    if (expired.length > 0) logger.info(`🧹 Cleaned ${expired.length} expired sessions`);
}, 60000);

bot.on('message', (msg) => {
    if (isShuttingDown) return;
    const chatId = msg.chat.id.toString();

    if (msg.text && /id|whoami/i.test(msg.text)) {
        logger.info(`🔍 User ID check: Chat ${chatId} (@${msg.from?.username || 'unknown'})`);
        bot.sendMessage(chatId, `📋 Your Chat ID: \`${chatId}\``, { parse_mode: 'Markdown' });
        return;
    }

    const session = userSessions.get(chatId);
    if (!session) return;

    if (msg.text && msg.text.startsWith('/')) {
        clearSession(chatId);
        return;
    }
    if (!msg.text) return;

    clearTimeout(session.timeout);
    userSessions.delete(chatId);

    try {
        session.callback(msg.text.trim());
    } catch (e) {
        logger.error(`❌ Prompt callback error: ${e.message}`);
        bot.sendMessage(chatId, `⚠️ Error processing input: ${e.message}`);
    }
});

// ─────────────────────────────────────────────
// 🎭 Constants & State
// ─────────────────────────────────────────────
const PERSONALITIES = {
    DIAMOND: { buyProb: 0.8, sellProb: 0.1, minHold: 5, maxHold: 15, sizeMult: 0.8, minThink: 2000, maxThink: 8000 },
    SCALPER: { buyProb: 0.9, sellProb: 0.8, minHold: 1, maxHold: 3, sizeMult: 1.2, minThink: 500, maxThink: 2500 },
    RETAIL: { buyProb: 0.5, sellProb: 0.4, minHold: 2, maxHold: 6, sizeMult: 0.5, minThink: 1000, maxThink: 6000 },
    WHALE: { buyProb: 0.3, sellProb: 0.05, minHold: 10, maxHold: 30, sizeMult: 3.0, minThink: 3000, maxThink: 20000 },
    LADDER: { buyProb: 0.95, sellProb: 0.6, minHold: 8, maxHold: 25, sizeMult: 1.6, minThink: 800, maxThink: 4500 },
    SNIPER: { buyProb: 1.0, sellProb: 0.9, minHold: 1, maxHold: 3, sizeMult: 2.5, minThink: 300, maxThink: 1200 },
    WASH: { buyProb: 1.0, sellProb: 1.0, minHold: 1, maxHold: 2, sizeMult: 1.0, minThink: 200, maxThink: 800 }
};

// ─────────────────────────────────────────────
// 💰 Funding Constants
// ─────────────────────────────────────────────
const MIN_FUND_AMOUNT = 0.005; // Minimum SOL per wallet for reliable trading
const RECOMMENDED_FUND_AMOUNT = 0.01; // Recommended for comfortable operation

const STATE = {
    tokenAddress: "", strategy: "STANDARD", running: false,
    minBuyAmount: 0.01, maxBuyAmount: 0.05, priorityFee: 0.0005, slippage: 2,
    numberOfCycles: 3, maxSimultaneousBuys: 1, maxSimultaneousSells: 1,
    intervalBetweenActions: 15000, jitterPercentage: 20,
    realismMode: true, humanizedDelays: true, variableSlippage: true,
    usePoissonTiming: true, useVolumeCurve: true, volCurveIntensity: 1.5,
    useWalletPool: true, fundAmountPerWallet: 0.005, batchConcurrency: 10,
    walletsPerCycle: 50, useWebFunding: true, fundingStealthLevel: 2,
    makerFundingChainDepth: 2, makerWalletsToGenerate: 3,
    useJito: false, jitoTipAmount: 0.0001,
    spamMicroBuyAmount: 0.0001, swapProvider: "SOLANA_TRACKER", targetDex: "RAYDIUM_AMM",
    chartPattern: "ASCENDING", holderWallets: 5, holderBuyAmount: 0.005,
    whaleBuyAmount: 1.0, whaleSellPercent: 80, volumeBoostMultiplier: 3,
    volumeBoostCycles: 10, volumeBoostMinAmount: 0.005, volumeBoostMaxAmount: 0.02,
    trendingMode: "VIRAL_PUMP", trendingIntensity: 5, kolRetailSwarmSize: 15,
    airdropWalletCount: 50, bullTrapSlippage: 15,
    personalityMix: ['RETAIL', 'SCALPER', 'DIAMOND'], walletPoolSize: 100,
    ladderSteps: 8, ladderBuyMultiplier: 1.8, sniperEntrySpeedMs: 800,
    sniperHoldTimeMin: 45, sniperHoldTimeMax: 180, washGroupCount: 3,
    washCyclesPerGroup: 4, mirrorTopHolders: 15, mirrorBuyThresholdSOL: 5,
    curveTargetPercent: 65, curveBuyIntensity: 2.5,

    // 🧠 SMART SELL
    smartSellEnabled: false,
    smartSellPercent: 25,
    smartSellMaxWallets: 50,
    smartSellMinBuySOL: 0.01,
    smartSellCooldownMs: 60000,
    smartSellLastTrigger: {},
    smartSellWalletIndex: 0,
    smartSellDevWalletPubkey: "",
    smartSellDevWalletKeypair: null
};

loadConfig();

// If dev wallet private key is provided in .env, load it
if (process.env.SMART_SELL_DEV_PRIVKEY && !STATE.smartSellDevWalletKeypair) {
    try {
        const devKeypair = Keypair.fromSecretKey(bs58.decode(process.env.SMART_SELL_DEV_PRIVKEY.trim()));
        STATE.smartSellDevWalletPubkey = devKeypair.publicKey.toBase58();
        STATE.smartSellDevWalletKeypair = devKeypair;
        logger.info(`✅ Smart Sell dev wallet loaded from env: ${STATE.smartSellDevWalletPubkey}`);
    } catch (e) {
        logger.error(`❌ Failed to load Smart Sell dev wallet from env: ${e.message}`);
    }
}

// ─────────────────────────────────────────────
// 🔍 Validation Helpers
// ─────────────────────────────────────────────
function validateNumber(val, min, max, name) {
    const num = parseFloat(val);
    if (isNaN(num)) throw new Error(`${name} must be a number`);
    if (num < min || num > max) throw new Error(`${name} must be between ${min} and ${max}`);
    return num;
}

function validateTokenAddress(address) {
    if (!address || typeof address !== 'string') throw new Error('Token address is required');
    if (address.length < 32 || address.length > 44) throw new Error('Invalid token address length');
    try {
        const decoded = bs58.decode(address);
        if (decoded.length !== 32) throw new Error('Token address must be 32 bytes');
    } catch (e) { throw new Error('Invalid token address format (base58)'); }
    return address;
}

// ─────────────────────────────────────────────
// 🛡️ Utility Functions
// ─────────────────────────────────────────────
function isAdmin(chatId) {
    if (!ADMIN_CHAT_ID) return true;
    return chatId.toString() === ADMIN_CHAT_ID.toString();
}

function getRandomFloat(min, max) { return Math.random() * (max - min) + min; }

function getJitteredInterval(baseInterval, jitterPercent) {
    if (jitterPercent <= 0) return baseInterval;
    const variation = baseInterval * (jitterPercent / 100);
    let interval = Math.floor(getRandomFloat(baseInterval - variation, baseInterval + variation));
    if (STATE.realismMode && STATE.humanizedDelays) {
        if (Math.random() < 0.10) interval += Math.floor(getRandomFloat(5000, 15000));
        if (Math.random() < 0.05) interval += Math.floor(getRandomFloat(20000, 45000));
    }
    return Math.max(100, interval);
}

function getDynamicSlippage(baseSlippage) {
    if (!STATE.realismMode || !STATE.variableSlippage) return baseSlippage;
    const variance = (Math.random() * 2) - 1;
    return Math.max(0.5, parseFloat((baseSlippage + variance).toFixed(1)));
}

function getDynamicFee(baseFee) {
    if (!STATE.realismMode) return baseFee;
    const variance = baseFee * ((Math.random() * 0.4) - 0.2);
    return Math.max(0.00001, parseFloat((baseFee + variance).toFixed(6)));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function getPoissonDelay(mean) {
    if (!STATE.usePoissonTiming) return mean;
    return Math.floor(-mean * Math.log(Math.max(0.001, 1.0 - Math.random())));
}

function getVolumeMultiplier() {
    if (!STATE.useVolumeCurve) return 1.0;
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60;
    const wave = Math.sin((hours - 10) * (Math.PI / 12));
    const multiplier = 1.0 + (wave * 0.5 * STATE.volCurveIntensity);
    const noise = (Math.random() * 0.4 - 0.2) * STATE.volCurveIntensity;
    return Math.max(0.1, Math.min(3.0, multiplier + noise));
}

function isRateLimited(chatId) {
    const cid = chatId.toString();
    const now = Date.now();
    const last = lastCommandTime.get(cid) || 0;
    if (now - last < 500) return true;
    lastCommandTime.set(cid, now);
    return false;
}

async function withStrategyLock(strategyName, fn, chatId) {
    if (activeStrategy) {
        bot?.sendMessage(chatId, `⚠️ ${strategyName} blocked: ${activeStrategy} is running`, { parse_mode: 'Markdown' });
        return false;
    }
    activeStrategy = strategyName;
    try { return await fn(); }
    finally { activeStrategy = null; }
}

/**
 * Health check function to verify system readiness
 * @returns {Promise<{healthy: boolean, issues: string[]}>}
 */
async function performHealthCheck() {
    const issues = [];
    
    // Check master wallet
    if (!masterKeypair) {
        issues.push('Master wallet not loaded');
    }
    
    // Check token address
    if (!STATE.tokenAddress) {
        issues.push('Token address not set');
    }
    
    // Check RPC connectivity
    try {
        const connection = getConnection();
        await connection.getSlot();
    } catch (e) {
        issues.push(`RPC connection failed: ${e.message}`);
    }
    
    // Check wallet pool
    if (STATE.useWalletPool && walletManager.size === 0) {
        issues.push('Wallet pool is empty');
    }
    
    // Check master wallet balance
    if (masterKeypair) {
        try {
            const connection = getConnection();
            const balance = await connection.getBalance(masterKeypair.publicKey) / LAMPORTS_PER_SOL;
            if (balance < 0.01) {
                issues.push(`Master wallet balance low: ${balance.toFixed(4)} SOL`);
            }
        } catch (e) {
            issues.push(`Failed to check master wallet balance: ${e.message}`);
        }
    }
    
    return {
        healthy: issues.length === 0,
        issues
    };
}

// ─────────────────────────────────────────────
// 💸 SOL Transfer with Balance Check
// ─────────────────────────────────────────────
async function sendSOL(connection, from, to, amountSOL) {
    const balance = await connection.getBalance(from.publicKey);
    const lamports = Math.round(amountSOL * LAMPORTS_PER_SOL);
    const lamportsWithFee = lamports + 5000; // Exact Solana transfer fee

    if (balance < lamportsWithFee) {
        throw new Error(`Insufficient balance: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL < ${((lamportsWithFee) / LAMPORTS_PER_SOL).toFixed(6)} SOL needed`);
    }

    const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports })
    );

    if (STATE.useJito) {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.feePayer = from.publicKey;
        tx.sign(from);
        const b58Tx = bs58.encode(tx.serialize());
        const jitoResult = await sendJitoBundle([b58Tx], from, connection, STATE.jitoTipAmount);
        if (!jitoResult?.success) throw new Error(`Jito bundle failed: ${jitoResult?.error || 'Unknown error'}`);
        return jitoResult.bundleId || jitoResult.tipTxid || 'bundle_sent';
    } else {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.feePayer = from.publicKey;
        tx.sign(from);
        const txid = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
        const confirmation = await connection.confirmTransaction(
            { signature: txid, blockhash, lastValidBlockHeight },
            'confirmed'
        );
        if (confirmation.value?.err) throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        return txid;
    }
}

// ─────────────────────────────────────────────
// 🪙 Token Balance Helper
// ─────────────────────────────────────────────
async function getTokenBalance(connection, owner, tokenAddr) {
    try {
        if (tokenAddr === SOL_ADDR) return (await connection.getBalance(owner)) / LAMPORTS_PER_SOL;
        const result = await connection.getTokenAccountsByOwner(owner, { mint: new PublicKey(tokenAddr) });
        if (result.value.length === 0) return 0;
        const info = await connection.getTokenAccountBalance(result.value[0].pubkey);
        return info.value.uiAmount || 0;
    } catch (error) {
        logger.debug(`[TokenBalance] Query failed: ${error.message}`);
        return 0;
    }
}

// ─────────────────────────────────────────────
// 🔄 Swap Function with Retries + Validation + Jito Support
// ─────────────────────────────────────────────
async function swap(tokenIn, tokenOut, keypair, connection, amount, chatId, silent = false) {
    const maxRetries = 3;
    let lastError;
    const shortKey = keypair.publicKey.toBase58().substring(0, 8);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            let cleanAmount;
            if (amount === 'auto') { cleanAmount = 'auto'; }
            else {
                cleanAmount = parseFloat(parseFloat(amount).toFixed(6));
                if (isNaN(cleanAmount) || cleanAmount <= 0) throw new Error(`Invalid amount: ${amount}`);
            }

            const isBuy = tokenIn === SOL_ADDR;
            
            // Calculate dynamic values first
            const currentSlippage = getDynamicSlippage(STATE.slippage);
            const currentFee = getDynamicFee(STATE.priorityFee);
            
            // Enhanced balance validation with detailed error messages
            if (isBuy && cleanAmount !== 'auto') {
                // For BUYS: Calculate required SOL with proper buffer
                // Base amount + slippage buffer + priority fee + jito tip (if enabled) + rent buffer (0.002 SOL)
                const slippageBuffer = cleanAmount * (currentSlippage / 100);
                const rentBuffer = 0.002; // Rent-exempt minimum for token account
                const requiredSol = cleanAmount + slippageBuffer + currentFee + (STATE.useJito ? STATE.jitoTipAmount : 0) + rentBuffer;
                
                const balance = await connection.getBalance(keypair.publicKey) / LAMPORTS_PER_SOL;
                if (balance < requiredSol) {
                    throw new Error(`Insufficient SOL: ${balance.toFixed(6)} < ${requiredSol.toFixed(6)} needed (buy: ${cleanAmount}, slippage: ${slippageBuffer.toFixed(6)}, fee: ${currentFee}, rent: ${rentBuffer})`);
                }
            } else if (!isBuy && cleanAmount !== 'auto') {
                // For SELLS: Only need fee + small buffer (no rent needed, token account closes)
                const minRequired = currentFee + (STATE.useJito ? STATE.jitoTipAmount : 0) + 0.0005; // Small buffer
                const balance = await connection.getBalance(keypair.publicKey) / LAMPORTS_PER_SOL;
                if (balance < minRequired) {
                    throw new Error(`Insufficient SOL for sell: ${balance.toFixed(6)} < ${minRequired.toFixed(6)} needed (fee: ${currentFee})`);
                }
            }

            if (STATE.swapProvider === "SOLANA_TRADE" && SolanaTrade) {
                const mappedMarket = mapMarket(STATE.targetDex);
                const trade = new SolanaTrade(RPC_URLS[0]);
                
                // For SELLS, solana-trade expects the actual token amount as a number
                let tradeAmount = cleanAmount;
                if (!isBuy) {
                    if (cleanAmount === 'auto') {
                        tradeAmount = await getTokenBalance(connection, keypair.publicKey, tokenIn);
                    } else {
                        tradeAmount = parseFloat(cleanAmount);
                    }
                    if (tradeAmount <= 0) {
                        logger.warn(`[Swap] ${shortKey} skipping sell: Zero balance detected`);
                        return null;
                    }
                } else if (cleanAmount === 'auto') {
                    // Buy 'auto' fallback (should not happen in current strategies)
                    tradeAmount = STATE.minBuyAmount;
                }

                const params = {
                    market: mappedMarket,
                    wallet: keypair,
                    mint: isBuy ? tokenOut : tokenIn,
                    amount: tradeAmount,
                    slippage: currentSlippage,
                    priorityFeeSol: currentFee, // solana-trade handles base fee
                    tipAmountSol: STATE.useJito ? STATE.jitoTipAmount : 0,
                    sender: STATE.useJito ? 'JITO' : undefined,
                    skipConfirmation: STATE.useJito,
                    send: true,
                    skipSimulation: false
                };

                if (!silent && attempt === 0) bot.sendMessage(chatId, `⚡ SolanaTrade [${mappedMarket}] ${isBuy ? '🟢 Buy' : '🔴 Sell'}...`, { parse_mode: 'Markdown' }).catch(() => { });
                
                logger.debug(`[SolanaTrade] Executing ${isBuy ? 'buy' : 'sell'} on ${mappedMarket} with amount ${tradeAmount}`);
                
                try {
                    const sig = isBuy ? await trade.buy(params) : await trade.sell(params);
                    
                    if (!silent && sig && typeof sig === 'string') {
                        bot.sendMessage(chatId, `✅ [Tx](https://solscan.io/tx/${sig})`, { parse_mode: 'Markdown' }).catch(() => { });
                    }
                    return sig;
                } catch (tradeError) {
                    // Add helpful context for pool not found errors
                    if (tradeError.message?.toLowerCase().includes('pool not found')) {
                        throw new Error(`${mappedMarket} pool not found for token. Try: PUMP_FUN, RAYDIUM_CPMM, or check token on Solscan/Birdeye for available DEXs`);
                    }
                    throw tradeError;
                }
            } else {
                const solanaTracker = new SolanaTracker(keypair, RPC_URLS[0]);
                const swapResponse = await solanaTracker.getSwapInstructions(tokenIn, tokenOut, cleanAmount, currentSlippage, keypair.publicKey.toBase58(), STATE.useJito ? 0 : currentFee, false);
                if (!swapResponse || (!swapResponse.txn && !swapResponse.tx)) throw new Error('No transaction returned from swap API');

                let txid;
                if (STATE.useJito) {
                    const serializedTx = swapResponse.txn || swapResponse.tx;
                    const b58Tx = typeof serializedTx === 'string' ? serializedTx : bs58.encode(Buffer.from(serializedTx, 'base64'));
                    const jitoResult = await sendJitoBundle([b58Tx], keypair, connection, STATE.jitoTipAmount);
                    if (!jitoResult?.success) throw new Error(`Jito bundle failed: ${jitoResult?.error || 'Unknown error'}`);
                    txid = jitoResult.bundleId || jitoResult.tipTxid || 'bundle_sent';
                } else {
                    txid = await solanaTracker.performSwap(swapResponse, { sendOptions: { skipPreflight: false, preflightCommitment: 'confirmed' }, commitment: "confirmed" });
                }
                if (!silent && txid) bot.sendMessage(chatId, `✅ [Tx](https://solscan.io/tx/${txid})`, { parse_mode: 'Markdown' }).catch(() => { });
                return txid;
            }
        } catch (e) {
            lastError = e;
            logger.warn(`[Swap] ${shortKey} attempt ${attempt + 1}/${maxRetries}: ${e.message}`);

            // Don't retry non-retryable errors (saves time and RPC calls)
            const isNonRetryable =
                e.message?.includes('Insufficient SOL') ||
                e.message?.includes('Insufficient balance') ||
                e.message?.includes('Invalid amount') ||
                e.message?.includes('Simulation failed') ||
                e.message?.includes('insufficient funds for rent') ||
                e.message?.includes('insufficient lamports') ||
                e.message?.includes('Account not found') ||
                e.message?.includes('pool not found') ||
                e.message?.includes('Pool not found');

            if (isNonRetryable) {
                logger.debug(`[Swap] ${shortKey} non-retryable error, skipping remaining attempts`);
                
                // Provide helpful context for insufficient funds
                if (e.message?.includes('Insufficient')) {
                    logger.info(`💡 Tip: Fund wallet ${shortKey}... with more SOL or reduce minBuyAmount in config.json`);
                }
                break;
            }

            if (attempt < maxRetries - 1) await sleep(Math.min(1000 * Math.pow(2, attempt), 3000));
        }
    }
    logger.error(`[Swap] ${shortKey} failed after ${maxRetries} attempts: ${lastError?.message || "Unknown"}`);
    if (!silent && chatId) bot.sendMessage(chatId, `⚠️ Swap failed [${shortKey}...]: ${lastError?.message || "Unknown error"}`).catch(() => { });
    return null;
}

// ─────────────────────────────────────────────
// 💼 Wallet Helper
// ─────────────────────────────────────────────
function fetchWallets(count) {
    if (STATE.useWalletPool) {
        // Use age-optimized wallet selection for organic behavior
        return walletManager.getOptimalWalletMix(count);
    } else {
        return walletManager.generateEphemeralWallets(count);
    }
}

// ─────────────────────────────────────────────
// 🔄 Universal Strategy Executor Template
// ─────────────────────────────────────────────
async function executeStrategyTemplate(chatId, connection, strategyConfig) {
    const { name, walletCount, fundAmount, buyLogic, sellLogic, cycles, needsFunding = true, autoDrain = true } = strategyConfig;

    // ⚠️ Pre-flight validation: Check funding amount
    if (needsFunding && fundAmount > 0 && fundAmount < MIN_FUND_AMOUNT) {
        bot.sendMessage(chatId, 
            `⚠️ *Warning: Low Funding Amount*\n\n` +
            `Current: \`${fundAmount}\` SOL\n` +
            `Minimum: \`${MIN_FUND_AMOUNT}\` SOL\n` +
            `Recommended: \`${RECOMMENDED_FUND_AMOUNT}\` SOL\n\n` +
            `⚡ *Why This Matters:*\n` +
            `• Rent: 0.002 SOL (locked)\n` +
            `• Fees: ~0.001 SOL\n` +
            `• Trade: ${STATE.minBuyAmount} SOL (minimum)\n` +
            `• Buffer: ~0.001 SOL\n\n` +
            `💡 *Trades will likely fail with insufficient funds.*\n\n` +
            `Update via: ⚙️ Settings → 📱 Basic → Fund Amount`,
            { parse_mode: 'Markdown' }
        );
        
        // Give user 5 seconds to see the warning before proceeding
        await sleep(5000);
    }

    // Enhanced strategy start message
    bot.sendMessage(chatId, formatStrategyStart(name, {
        wallets: walletCount,
        cycles: cycles,
        amount: `${STATE.minBuyAmount}-${STATE.maxBuyAmount} SOL`,
        mode: STATE.useWalletPool ? 'Pool' : 'Ephemeral',
        token: STATE.tokenAddress
    }), { parse_mode: 'Markdown' });
    
    globalWalletManager = walletManager;

    const wallets = fetchWallets(walletCount);
    const isEphemeral = !STATE.useWalletPool;

    // Show aging distribution for both pool and ephemeral (if aging enabled)
    if (walletManager.agingEnabled) {
        const stats = walletManager.getAgingStats();
        const mode = isEphemeral ? '(Simulated)' : '(Real)';
        bot.sendMessage(chatId, 
            `📊 *Wallet Age Distribution ${mode}:*\n` +
            `🏆 Veteran: ${stats.VETERAN || 0} | 🌳 Mature: ${stats.MATURE || 0}\n` +
            `🌿 Seasoned: ${stats.SEASONED || 0} | 🌱 Young: ${stats.YOUNG || 0} | 🆕 Fresh: ${stats.FRESH || 0}\n` +
            `Trust Score: ${(stats.avgTrustScore || 0).toFixed(2)}`,
            { parse_mode: 'Markdown' }
        );
    }

    if (needsFunding && fundAmount > 0) {
        const totalNeeded = wallets.length * fundAmount;
        const currentBal = await connection.getBalance(masterKeypair.publicKey) / 1e9;
        
        // For ephemeral wallets, we need less buffer since SOL gets drained back
        // For persistent pool, we need more buffer since SOL stays in wallets
        const bufferNeeded = isEphemeral ? 0.002 : 0.01;
        const requiredBalance = totalNeeded + bufferNeeded;
        
        if (currentBal < requiredBalance) {
            bot.sendMessage(chatId, formatErrorMessage(
                'Insufficient Master Wallet Balance',
                `Need ${requiredBalance.toFixed(4)} SOL but only have ${currentBal.toFixed(4)} SOL`,
                [
                    `Fund master wallet with ${(requiredBalance - currentBal).toFixed(4)} SOL`,
                    'Reduce wallet count or buy amount',
                    isEphemeral ? 'Ephemeral mode uses less SOL (0.002 buffer)' : 'Switch to ephemeral mode to reduce buffer'
                ]
            ), { parse_mode: 'Markdown' });
            return { success: false, error: 'Insufficient funds' };
        }

        bot.sendMessage(chatId, `💰 *Funding ${wallets.length} Wallets*\n\nAmount: \`${fundAmount}\` SOL each\nTotal: \`${totalNeeded.toFixed(4)}\` SOL`, { parse_mode: 'Markdown' });

        let fundResult;
        if (isEphemeral) {
            fundResult = await walletManager.fundWallets(wallets, {
                connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: fundAmount, concurrency: STATE.batchConcurrency,
                progressCb: (prog) => bot.sendMessage(chatId, formatProgressMessage('💰 Funding', prog.successes, prog.total), { parse_mode: 'Markdown' }).catch(() => { }),
                checkRunning: () => STATE.running && !isShuttingDown,
                useWebFunding: STATE.useWebFunding,
                stealthLevel: STATE.fundingStealthLevel,
                hopDepth: STATE.makerFundingChainDepth
            });
        } else {
            fundResult = await walletManager.fundAll(
                connection, masterKeypair, sendSOL, fundAmount, STATE.batchConcurrency,
                (prog) => bot.sendMessage(chatId, formatProgressMessage('💰 Funding', prog.successes, prog.total), { parse_mode: 'Markdown' }).catch(() => { }),
                () => STATE.running && !isShuttingDown,
                STATE.useWebFunding,
                STATE.fundingStealthLevel,
                STATE.makerFundingChainDepth
            );
        }

        if (fundResult.failures > 0) {
            const failureTrigger = fundResult.successes === 0 || (fundResult.failures / wallets.length) > 0.5;
            if (failureTrigger) {
                bot.sendMessage(chatId, formatErrorMessage(
                    'Funding Failed',
                    `${fundResult.failures}/${wallets.length} wallets failed to fund`,
                    [
                        'Check master wallet balance',
                        'Verify RPC connection',
                        'Try reducing wallet count',
                        'Check network congestion'
                    ]
                ), { parse_mode: 'Markdown' });
                return { success: false, error: 'Funding failed' };
            } else {
                bot.sendMessage(chatId, `⚠️ *Partial Funding*\n\nFunded: \`${fundResult.successes}/${wallets.length}\`\nFailed: \`${fundResult.failures}\`\n\nProceeding with funded wallets...`, { parse_mode: 'Markdown' });
            }
        } else {
            bot.sendMessage(chatId, formatSuccessMessage('Funding Complete', {
                'Funded': `${fundResult.successes}/${wallets.length}`,
                'Total': `${(fundResult.successes * fundAmount).toFixed(4)} SOL`
            }), { parse_mode: 'Markdown' });
        }
        await sleep(2000);
    }

    for (let cycle = 0; cycle < cycles && STATE.running && !isShuttingDown; cycle++) {
        const volMult = getVolumeMultiplier();
        const cycleMsg = await bot.sendMessage(chatId, `🔄 ${name} Cycle ${cycle + 1}/${cycles} | Vol: ${volMult.toFixed(2)}x`, { parse_mode: 'Markdown' });

        await BatchSwapEngine.executeBatch(
            wallets,
            async (wallet, idx) => {
                if (!STATE.running || isShuttingDown) return null;
                
                // Age-aware trading: Check if wallet should trade now (works for both pool and ephemeral)
                if (walletManager.agingEnabled && !walletManager.shouldTradeNow(wallet)) {
                    logger.debug(`[Aging] Wallet ${idx} skipping (not preferred time)`);
                    return null;
                }
                
                // Apply age-based delay before trading (works for both pool and ephemeral)
                if (walletManager.agingEnabled) {
                    const ageDelay = walletManager.calculateAgeBasedDelay(wallet, STATE.intervalBetweenActions);
                    const jitter = Math.random() * 200; // Small jitter
                    await sleep(Math.min(ageDelay / wallets.length, 500) + jitter); // Distributed delay
                }
                
                const result = await buyLogic(wallet, idx, volMult, connection, chatId);
                
                // Update trade metadata on success (works for both pool and ephemeral)
                if (result && walletManager.agingEnabled) {
                    const amount = STATE.minBuyAmount; // Approximate amount
                    walletManager.updateTradeMetadata(wallet, amount, STATE.tokenAddress);
                }
                
                return result;
            },
            STATE.batchConcurrency,
            (progress) => {
                if (progress.completed % Math.max(1, Math.floor(progress.total / 5)) === 0) {
                    bot.editMessageText(
                        `🔄 ${name} Cycle ${cycle + 1}/${cycles}\n🛒 Buying: ${progress.completed}/${progress.total} | ✅ ${progress.successes} | ❌ ${progress.failures}`,
                        { chat_id: chatId, message_id: cycleMsg?.message_id, parse_mode: "Markdown" }
                    ).catch(() => { });
                }
            },
            () => STATE.running && !isShuttingDown,
            { maxRetries: 2, minIntervalMs: 100, shuffle: true, perActionJitter: true, jitterMaxMs: 400 }
        );

        if (!STATE.running || isShuttingDown) {
            bot.sendMessage(chatId, `⚠️ Stop detected. Forcing cycle token cleanup...`, { parse_mode: 'Markdown' });
        } else {
            await sleep(getPoissonDelay(STATE.intervalBetweenActions));
        }

        await BatchSwapEngine.executeBatch(
            wallets,
            async (wallet, idx) => {
                // Removing checkRunning to force sell execution so tokens are not stranded
                const result = await sellLogic(wallet, idx, volMult, connection, chatId);
                
                // Update trade metadata on successful sell (works for both pool and ephemeral)
                if (result && walletManager.agingEnabled) {
                    const amount = STATE.minBuyAmount; // Approximate amount
                    walletManager.updateTradeMetadata(wallet, amount, STATE.tokenAddress);
                }
                
                return result;
            },
            STATE.batchConcurrency,
            null,
            null, // No checkRunning bypass!
            { maxRetries: 2, minIntervalMs: 100, shuffle: true, perActionJitter: true, jitterMaxMs: 400 }
        );

        if (!STATE.running || isShuttingDown) break;
    }

    if (isEphemeral && autoDrain) {
        await walletManager.drainWallets(wallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    }

    return { success: true, wallets };
}

// ─────────────────────────────────────────────
// 📈 Strategy: Standard Cycles
// ─────────────────────────────────────────────
async function executeStandardCycles(chatId, connection) {
    return executeStrategyTemplate(chatId, connection, {
        name: 'Standard Mode',
        walletCount: STATE.useWalletPool ? Math.min(STATE.walletsPerCycle, walletManager.size) : STATE.walletsPerCycle,
        fundAmount: STATE.fundAmountPerWallet,
        buyLogic: async (wallet, idx, volMult, conn, cid) => {
            const amount = parseFloat((getRandomFloat(STATE.minBuyAmount, STATE.maxBuyAmount) * volMult).toFixed(4));
            return await swap(SOL_ADDR, STATE.tokenAddress, wallet, conn, amount, cid, true);
        },
        sellLogic: async (wallet, idx, volMult, conn, cid) => {
            const bal = await getTokenBalance(conn, wallet.publicKey, STATE.tokenAddress);
            if (bal > 0.0001) return await swap(STATE.tokenAddress, SOL_ADDR, wallet, conn, 'auto', cid, true);
            return null;
        },
        cycles: STATE.numberOfCycles,
        needsFunding: !STATE.useWalletPool
    });
}

// 📈 Strategy: Maker Cycles (Personality-Driven)
async function executeMakerCycles(chatId, connection) {
    const walletCount = STATE.useWalletPool ? Math.min(STATE.walletsPerCycle, walletManager.size) : STATE.makerWalletsToGenerate;
    return executeStrategyTemplate(chatId, connection, {
        name: 'Maker Mode', walletCount,
        fundAmount: parseFloat(getRandomFloat(STATE.minBuyAmount, STATE.maxBuyAmount).toFixed(4)) + 0.01,
        buyLogic: async (wallet, idx, volMult, conn, cid) => {
            if (!wallet.personality) {
                const pKey = STATE.personalityMix[Math.floor(Math.random() * STATE.personalityMix.length)];
                wallet.personality = PERSONALITIES[pKey] || PERSONALITIES.RETAIL;
                wallet.holdCycles = 0;
            }
            const bal = await getTokenBalance(conn, wallet.publicKey, STATE.tokenAddress);
            if (bal > 0) return null;
            if (Math.random() < wallet.personality.buyProb) {
                await sleep(getRandomFloat(wallet.personality.minThink, wallet.personality.maxThink));
                const amount = parseFloat((getRandomFloat(STATE.minBuyAmount, STATE.maxBuyAmount) * wallet.personality.sizeMult * volMult).toFixed(4));
                wallet.holdCycles = Math.floor(getRandomFloat(wallet.personality.minHold, wallet.personality.maxHold));
                return await swap(SOL_ADDR, STATE.tokenAddress, wallet, conn, amount, cid, true);
            }
            return null;
        },
        sellLogic: async (wallet, idx, volMult, conn, cid) => {
            if (!wallet.personality) return null;
            const bal = await getTokenBalance(conn, wallet.publicKey, STATE.tokenAddress);
            if (bal <= 0.0001) return null;
            if (wallet.holdCycles <= 0 && Math.random() < wallet.personality.sellProb) {
                await sleep(getRandomFloat(wallet.personality.minThink, wallet.personality.maxThink));
                const sellAmt = Math.random() < 0.7 ? 'auto' : (bal * getRandomFloat(0.3, 0.7)).toFixed(6);
                return await swap(STATE.tokenAddress, SOL_ADDR, wallet, conn, sellAmt, cid, true);
            } else if (wallet.holdCycles > 0) wallet.holdCycles--;
            return null;
        },
        cycles: STATE.numberOfCycles,
        needsFunding: !STATE.useWalletPool
    });
}

// 🕸️ Strategy: Web of Activity
async function executeWebOfActivity(chatId, connection) {
    const walletCount = STATE.useWalletPool ? Math.min(STATE.walletsPerCycle, walletManager.size) : STATE.walletsPerCycle;
    return executeStrategyTemplate(chatId, connection, {
        name: 'Web of Activity', walletCount, fundAmount: 0.05,
        buyLogic: async (wallet, idx, volMult, conn, cid) => {
            const amt = parseFloat((getRandomFloat(STATE.minBuyAmount, STATE.maxBuyAmount) * volMult).toFixed(4));
            return swap(SOL_ADDR, STATE.tokenAddress, wallet, conn, amt, cid, true);
        },
        sellLogic: async (wallet, idx, volMult, conn, cid) => {
            const bal = await getTokenBalance(conn, wallet.publicKey, STATE.tokenAddress);
            if (bal > 0 && Math.random() < 0.6) return swap(STATE.tokenAddress, SOL_ADDR, wallet, conn, 'auto', cid, true);
            return null;
        },
        cycles: STATE.numberOfCycles,
        needsFunding: !STATE.useWalletPool
    });
}

// ⚡ Strategy: Spam Mode
async function executeSpamMode(chatId, connection) {
    const walletCount = STATE.useWalletPool ? Math.min(STATE.walletsPerCycle, walletManager.size) : STATE.walletsPerCycle;
    
    // Ensure wallets have enough SOL for both buying AND selling
    // Each wallet needs: buy amount + rent (0.002) + sell fee (0.001) + buffer (0.001)
    const minFundingNeeded = STATE.spamMicroBuyAmount + 0.004;
    const fundAmount = Math.max(STATE.fundAmountPerWallet, minFundingNeeded);
    
    const result = await executeStrategyTemplate(chatId, connection, {
        name: 'Micro-Spam Mode', 
        walletCount, 
        fundAmount: fundAmount,
        buyLogic: async (wallet, idx, volMult, conn, cid) => {
            const jitteredSpam = parseFloat((STATE.spamMicroBuyAmount * (0.8 + Math.random() * 0.4)).toFixed(6));
            return await swap(SOL_ADDR, STATE.tokenAddress, wallet, conn, jitteredSpam, cid, true);
        },
        sellLogic: async () => null, // Don't sell during cycles
        cycles: STATE.numberOfCycles,
        needsFunding: !STATE.useWalletPool,
        autoDrain: false
    });

    if (result.success && STATE.running && !isShuttingDown) {
        bot.sendMessage(chatId, `📉 Dumping accumulated tokens...`, { parse_mode: 'Markdown' });
        const dumpWallets = result.wallets;
        
        // Add delay to let transactions settle
        await sleep(2000);
        
        const dumpResult = await BatchSwapEngine.executeBatch(
            dumpWallets,
            async (w) => {
                try {
                    const bal = await getTokenBalance(connection, w.publicKey, STATE.tokenAddress);
                    if (bal > 0.0001) {
                        // Check if wallet has enough SOL for sell transaction
                        const solBal = await connection.getBalance(w.publicKey) / LAMPORTS_PER_SOL;
                        if (solBal < 0.001) {
                            logger.warn(`[Spam] Wallet ${w.publicKey.toBase58().substring(0, 8)}... has insufficient SOL (${solBal.toFixed(6)}) for sell, skipping`);
                            return null;
                        }
                        return swap(STATE.tokenAddress, SOL_ADDR, w, connection, 'auto', chatId, true);
                    }
                    return null;
                } catch (e) {
                    logger.error(`[Spam] Dump error for wallet: ${e.message}`);
                    return null;
                }
            },
            STATE.batchConcurrency,
            null,
            () => STATE.running && !isShuttingDown
        );
    }
    if (!STATE.useWalletPool && result?.wallets?.length) await walletManager.drainWallets(result.wallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    return result;
}

// 🚀 Strategy: Pump & Dump
async function executePumpDump(chatId, connection) {
    const walletCount = STATE.useWalletPool ? Math.min(STATE.walletsPerCycle, walletManager.size) : STATE.walletsPerCycle;
    const result = await executeStrategyTemplate(chatId, connection, {
        name: 'Pump & Dump', walletCount, fundAmount: STATE.fundAmountPerWallet,
        buyLogic: async (wallet, idx, volMult, conn, cid) => {
            const buyAmount = parseFloat(getRandomFloat(STATE.minBuyAmount, STATE.maxBuyAmount).toFixed(4));
            return await swap(SOL_ADDR, STATE.tokenAddress, wallet, conn, buyAmount, cid, true);
        },
        sellLogic: async () => null,
        cycles: STATE.numberOfCycles,
        needsFunding: !STATE.useWalletPool,
        autoDrain: false
    });

    if (result.success && STATE.running && !isShuttingDown) {
        const dumpWallets = result.wallets.slice(0, 5);
        bot.sendMessage(chatId, `🔴 *Dumping in stealth chunks*...`, { parse_mode: 'Markdown' });
        for (const w of dumpWallets) {
            if (!STATE.running || isShuttingDown) break;
            const bal = await getTokenBalance(connection, w.publicKey, STATE.tokenAddress);
            if (bal > 0) {
                const chunks = Math.floor(getRandomFloat(2, 4));
                const chunkSize = bal / chunks;
                for (let c = 0; c < chunks; c++) {
                    const amt = (c === chunks - 1) ? 'auto' : chunkSize.toFixed(6);
                    await swap(STATE.tokenAddress, SOL_ADDR, w, connection, amt, chatId, true);
                    if (c < chunks - 1) await sleep(getJitteredInterval(1000, 20));
                }
            }
        }
    }
    if (!STATE.useWalletPool && result?.wallets?.length) await walletManager.drainWallets(result.wallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    return result;
}

// 📐 Strategy: Chart Pattern
async function executeChartPattern(chatId, connection) {
    const walletCount = STATE.useWalletPool ? Math.min(STATE.walletsPerCycle, walletManager.size) : STATE.walletsPerCycle;
    return executeStrategyTemplate(chatId, connection, {
        name: `Chart Pattern: ${STATE.chartPattern}`, walletCount, fundAmount: STATE.fundAmountPerWallet,
        buyLogic: async (wallet, idx, volMult, conn, cid) => {
            const n = STATE.numberOfCycles, progress = idx / Math.max(n - 1, 1); let buyMult;
            switch (STATE.chartPattern) {
                case 'ASCENDING': buyMult = 0.5 + progress; break;
                case 'DESCENDING': buyMult = 1.5 - progress; break;
                case 'SIDEWAYS': buyMult = 0.9 + Math.sin(progress * Math.PI * 4) * 0.2; break;
                case 'CUP_HANDLE':
                    const cup = Math.sin(progress * Math.PI),
                        handle = progress > 0.8 ? 0.3 * Math.sin((progress - 0.8) * Math.PI / 0.2) : 0;
                    buyMult = 0.4 + cup * 0.8 - handle * 0.3;
                    break;
                case 'BREAKOUT': default: buyMult = progress < 0.7 ? 0.6 : 1.8;
            }
            const jitteredBuy = parseFloat((STATE.minBuyAmount + (STATE.maxBuyAmount - STATE.minBuyAmount) * buyMult * 0.7 * (0.85 + Math.random() * 0.3)).toFixed(4));
            return await swap(SOL_ADDR, STATE.tokenAddress, wallet, conn, jitteredBuy, cid, true);
        },
        sellLogic: async (wallet, idx, volMult, conn, cid) => {
            const n = STATE.numberOfCycles, progress = idx / Math.max(n - 1, 1); let sellFrac;
            switch (STATE.chartPattern) {
                case 'ASCENDING': sellFrac = 0.3 + (1 - progress) * 0.4; break;
                case 'DESCENDING': sellFrac = 0.3 + progress * 0.6; break;
                case 'SIDEWAYS': case 'CUP_HANDLE': sellFrac = 0.85; break;
                case 'BREAKOUT': default: sellFrac = progress < 0.7 ? 0.9 : 0.2;
            }
            const bal = await getTokenBalance(conn, wallet.publicKey, STATE.tokenAddress);
            if (bal > 0) {
                const sellAmt = parseFloat((bal * sellFrac).toFixed(6));
                return swap(STATE.tokenAddress, SOL_ADDR, wallet, conn, sellAmt > 0 ? sellAmt : 'auto', cid, true);
            }
            return null;
        },
        cycles: STATE.numberOfCycles,
        needsFunding: !STATE.useWalletPool
    });
}

// 👥 Strategy: Holder Growth
async function executeHolderGrowth(chatId, connection) {
    const count = STATE.useWalletPool ? Math.min(STATE.holderWallets, walletManager.size) : STATE.holderWallets;
    return executeStrategyTemplate(chatId, connection, {
        name: 'Holder Growth', walletCount: count, fundAmount: STATE.holderBuyAmount + 0.005,
        buyLogic: async (wallet, idx, volMult, conn, cid) => {
            const amtVariation = getRandomFloat(STATE.holderBuyAmount * 0.7, STATE.holderBuyAmount * 1.3);
            return await swap(SOL_ADDR, STATE.tokenAddress, wallet, conn, amtVariation, cid, true);
        },
        sellLogic: async () => null,
        cycles: 1,
        needsFunding: !STATE.useWalletPool
    });
}

// 🐋 Strategy: Whale Simulation
async function executeWhaleSimulation(chatId, connection) {
    const whaleCount = STATE.useWalletPool ? Math.min(STATE.walletsPerCycle, walletManager.size) : STATE.walletsPerCycle;
    const result = await executeStrategyTemplate(chatId, connection, {
        name: 'Whale Simulation', walletCount: whaleCount, fundAmount: STATE.whaleBuyAmount + 0.01,
        buyLogic: async (wallet, idx, volMult, conn, cid) => {
            const jitteredAmt = parseFloat((STATE.whaleBuyAmount * (0.85 + Math.random() * 0.3) * volMult).toFixed(4));
            return await swap(SOL_ADDR, STATE.tokenAddress, wallet, conn, jitteredAmt, cid, true);
        },
        sellLogic: async () => null,
        cycles: STATE.numberOfCycles,
        needsFunding: !STATE.useWalletPool,
        autoDrain: false
    });

    if (result.success && STATE.running && !isShuttingDown) {
        const activeWhales = result.wallets;
        bot.sendMessage(chatId, `🔴 Whale dumping ${STATE.whaleSellPercent}% in stealth chunks...`, { parse_mode: 'Markdown' });
        
        // Add delay to let buy transactions settle
        await sleep(2000);
        
        for (const w of activeWhales) {
            if (!STATE.running || isShuttingDown) break;
            
            try {
                // Check if wallet has enough SOL for sell
                const solBal = await connection.getBalance(w.publicKey) / LAMPORTS_PER_SOL;
                if (solBal < 0.001) {
                    logger.warn(`[Whale] Wallet ${w.publicKey.toBase58().substring(0, 8)}... has insufficient SOL (${solBal.toFixed(6)}) for sell, skipping`);
                    continue;
                }
                
                const bal = await getTokenBalance(connection, w.publicKey, STATE.tokenAddress);
                if (bal > 0.0001) {
                    const dumpChunks = Math.floor(getRandomFloat(2, 5));
                    const chunkPercent = (STATE.whaleSellPercent / 100) / dumpChunks;
                    for (let c = 0; c < dumpChunks; c++) {
                        const dumpAmt = parseFloat((bal * chunkPercent).toFixed(6));
                        await swap(STATE.tokenAddress, SOL_ADDR, w, connection, dumpAmt, chatId, true);
                        await sleep(getJitteredInterval(800, 15));
                    }
                }
            } catch (e) {
                logger.error(`[Whale] Dump error for wallet: ${e.message}`);
            }
        }
    }
    if (!STATE.useWalletPool && result?.wallets?.length) await walletManager.drainWallets(result.wallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    return result;
}

// 📊 Strategy: Volume Boost
async function executeVolumeBoost(chatId, connection) {
    const walletCount = STATE.useWalletPool ? Math.min(STATE.walletsPerCycle, walletManager.size) : STATE.volumeBoostMultiplier;
    return executeStrategyTemplate(chatId, connection, {
        name: 'Volume Boost', walletCount, fundAmount: STATE.volumeBoostMaxAmount + 0.01,
        buyLogic: async (wallet, idx, volMult, conn, cid) => {
            await sleep(getRandomFloat(0, 2000));
            const amt = parseFloat(getRandomFloat(STATE.volumeBoostMinAmount, STATE.volumeBoostMaxAmount).toFixed(4));
            return swap(SOL_ADDR, STATE.tokenAddress, wallet, conn, amt, cid, true);
        },
        sellLogic: async (wallet, idx, volMult, conn, cid) => {
            const bal = await getTokenBalance(conn, wallet.publicKey, STATE.tokenAddress);
            if (bal > 0) return swap(STATE.tokenAddress, SOL_ADDR, wallet, conn, 'auto', cid, true);
            return null;
        },
        cycles: STATE.volumeBoostCycles,
        needsFunding: !STATE.useWalletPool
    });
}

// 🔥 Strategy: Trending Modes
async function executeTrendingStrategy(chatId, connection) {
    const mode = STATE.trendingMode;
    const intensity = STATE.trendingIntensity;
    const walletCount = STATE.useWalletPool ? Math.min(STATE.walletsPerCycle, walletManager.size) : STATE.walletsPerCycle;

    if (!STATE.useWalletPool) {
        const totalNeeded = (mode === 'WASH_TRADING' ? 1 : 
                           mode === 'ORGANIC_GROWTH' ? Math.max(1, Math.floor(walletCount * 0.2)) : 
                           mode === 'FOMO_WAVE' ? Math.max(1, Math.floor(walletCount * 0.4)) : 
                           mode === 'LIQUIDITY_LADDER' ? Math.max(1, Math.floor(walletCount * 0.3)) : 
                           walletCount) * STATE.fundAmountPerWallet;
        const currentBal = await connection.getBalance(masterKeypair.publicKey) / 1e9;
        
        // Ephemeral wallets get drained back, so we need less buffer
        const bufferNeeded = 0.002;
        const requiredBalance = totalNeeded + bufferNeeded;
        
        if (currentBal < requiredBalance) {
            bot.sendMessage(chatId, `❌ *ABORTED:* Master Wallet insufficient funds for trending strategy!\n` + 
                `Required: \`${requiredBalance.toFixed(4)}\` SOL (${totalNeeded.toFixed(4)} + ${bufferNeeded.toFixed(4)} buffer)\n` +
                `Available: \`${currentBal.toFixed(4)}\` SOL\n` +
                `💡 Tip: Ephemeral mode will drain SOL back after completion`, { parse_mode: 'Markdown' });
            return { success: false, error: 'Insufficient funds' };
        }
    }

    if (mode === 'VIRAL_PUMP') {
        const cycles = Math.floor(5 + intensity * 2);
        const ephemWallets = !STATE.useWalletPool ? fetchWallets(walletCount) : [];
        if (!STATE.useWalletPool) {
            const fundResult = await walletManager.fundWallets(ephemWallets, { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: STATE.fundAmountPerWallet * 2, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });
            if (fundResult.successes === 0) {
                bot.sendMessage(chatId, `❌ *ABORTED:* Viral Pump funding failed.`, { parse_mode: 'Markdown' });
                return { success: false, error: 'Funding failed' };
            }
        }
        for (let i = 0; i < cycles && STATE.running && !isShuttingDown; i++) {
            const freshWallets = STATE.useWalletPool ? fetchWallets(walletCount) : ephemWallets;

            const buyMult = Math.pow(1.3, i / cycles);
            const buyAmt = parseFloat((STATE.minBuyAmount * buyMult * intensity * 0.3).toFixed(4));
            bot.sendMessage(chatId, `🚀 Viral buy ${i + 1}/${cycles}: \`${buyAmt}\` SOL`, { parse_mode: 'Markdown' });
            await BatchSwapEngine.executeBatch(
                freshWallets,
                async (w) => await swap(SOL_ADDR, STATE.tokenAddress, w, connection, buyAmt, chatId, true),
                STATE.batchConcurrency,
                null,
                () => STATE.running && !isShuttingDown
            );

            if (i % 2 === 0 && STATE.running && !isShuttingDown) {
                await BatchSwapEngine.executeBatch(
                    freshWallets,
                    async (w) => {
                        const bal = await getTokenBalance(connection, w.publicKey, STATE.tokenAddress);
                        if (bal > 0) return swap(STATE.tokenAddress, SOL_ADDR, w, connection, parseFloat((bal * 0.1).toFixed(6)), chatId, true);
                        return null;
                    },
                    STATE.batchConcurrency,
                    null,
                    () => STATE.running && !isShuttingDown
                );
            }
            await sleep(getJitteredInterval(2000, STATE.jitterPercentage));
        }
        if (!STATE.useWalletPool) await walletManager.drainWallets(ephemWallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    }
    else if (mode === 'ORGANIC_GROWTH') {
        const cycles = Math.floor(10 + intensity);
        const poolSize = Math.max(1, Math.floor(walletCount * 0.2));
        const ephemWallets = !STATE.useWalletPool ? fetchWallets(poolSize) : [];
        if (!STATE.useWalletPool) {
            const fundResult = await walletManager.fundWallets(ephemWallets, { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: STATE.fundAmountPerWallet * 2, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });
            if (fundResult.successes === 0) {
                bot.sendMessage(chatId, `❌ *ABORTED:* Organic Growth funding failed.`, { parse_mode: 'Markdown' });
                return { success: false, error: 'Funding failed' };
            }
        }
        for (let i = 0; i < cycles && STATE.running && !isShuttingDown; i++) {
            const randomWallets = STATE.useWalletPool ? fetchWallets(poolSize) : ephemWallets;

            const buyAmt = parseFloat(getRandomFloat(STATE.minBuyAmount, STATE.maxBuyAmount).toFixed(4));
            bot.sendMessage(chatId, `🌱 Organic buy ${i + 1}/${cycles}: \`${buyAmt}\` SOL`, { parse_mode: 'Markdown' });
            await BatchSwapEngine.executeBatch(
                randomWallets,
                async (w) => await swap(SOL_ADDR, STATE.tokenAddress, w, connection, buyAmt, chatId, true),
                STATE.batchConcurrency,
                null,
                () => STATE.running && !isShuttingDown
            );

            const pause = getJitteredInterval(5000 + intensity * 2000, 50);
            await sleep(pause);

            if (Math.random() < 0.2 && STATE.running && !isShuttingDown) {
                const sellWallets = randomWallets;
                await BatchSwapEngine.executeBatch(
                    sellWallets,
                    async (w) => {
                        const bal = await getTokenBalance(connection, w.publicKey, STATE.tokenAddress);
                        if (bal > 0) return swap(STATE.tokenAddress, SOL_ADDR, w, connection, parseFloat((bal * 0.15).toFixed(6)), chatId, true);
                        return null;
                    },
                    STATE.batchConcurrency,
                    null,
                    () => STATE.running && !isShuttingDown
                );
            }
        }
        if (!STATE.useWalletPool) await walletManager.drainWallets(ephemWallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    }
    else if (mode === 'FOMO_WAVE') {
        const waves = Math.floor(2 + intensity * 0.5);
        const surgeSize = Math.max(1, Math.floor(walletCount * 0.4));
        const ephemWallets = !STATE.useWalletPool ? fetchWallets(surgeSize) : [];
        if (!STATE.useWalletPool) {
            const fundResult = await walletManager.fundWallets(ephemWallets, { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: STATE.fundAmountPerWallet * 3, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });
            if (fundResult.successes === 0) {
                bot.sendMessage(chatId, `❌ *ABORTED:* FOMO Wave funding failed.`, { parse_mode: 'Markdown' });
                return { success: false, error: 'Funding failed' };
            }
        }
        for (let wave = 0; wave < waves && STATE.running && !isShuttingDown; wave++) {
            bot.sendMessage(chatId, `🌊 FOMO Wave ${wave + 1}/${waves} - Rapid buys!`, { parse_mode: 'Markdown' });
            const buysPerWave = Math.floor(3 + intensity);

            for (let i = 0; i < buysPerWave && STATE.running && !isShuttingDown; i++) {
                const surgeWallets = STATE.useWalletPool ? fetchWallets(surgeSize) : ephemWallets;

                const buyAmt = parseFloat(getRandomFloat(STATE.minBuyAmount * 1.5, STATE.maxBuyAmount * 2).toFixed(4));
                await BatchSwapEngine.executeBatch(
                    surgeWallets,
                    async (w) => await swap(SOL_ADDR, STATE.tokenAddress, w, connection, buyAmt, chatId, true),
                    STATE.batchConcurrency,
                    null,
                    () => STATE.running && !isShuttingDown
                );
                await sleep(1500);
            }

            if (wave < waves - 1 && STATE.running && !isShuttingDown) {
                const cooldown = getJitteredInterval(15000 + intensity * 3000, 30);
                bot.sendMessage(chatId, `⏸️ Cooldown: ${Math.round(cooldown / 1000)}s...`, { parse_mode: 'Markdown' });
                await sleep(cooldown);
            }
        }
        if (!STATE.useWalletPool) await walletManager.drainWallets(ephemWallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    }
    else if (mode === 'LIQUIDITY_LADDER') {
        const steps = Math.floor(5 + intensity);
        const ladderSize = Math.max(1, Math.floor(walletCount * 0.3));
        const ephemWallets = !STATE.useWalletPool ? fetchWallets(ladderSize) : [];
        if (!STATE.useWalletPool) {
            const fundResult = await walletManager.fundWallets(ephemWallets, { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: STATE.fundAmountPerWallet * 2, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });
            if (fundResult.successes === 0) {
                bot.sendMessage(chatId, `❌ *ABORTED:* Liquidity Ladder funding failed.`, { parse_mode: 'Markdown' });
                return { success: false, error: 'Funding failed' };
            }
        }
        for (let i = 0; i < steps && STATE.running && !isShuttingDown; i++) {
            const ladders = STATE.useWalletPool ? fetchWallets(ladderSize) : ephemWallets;

            const stepMult = 1 + (i / steps) * intensity * 0.4;
            const buyAmt = parseFloat((STATE.minBuyAmount * stepMult).toFixed(4));
            bot.sendMessage(chatId, `🪜 Ladder step ${i + 1}/${steps}: \`${buyAmt}\` SOL`, { parse_mode: 'Markdown' });
            await BatchSwapEngine.executeBatch(
                ladders,
                async (w) => await swap(SOL_ADDR, STATE.tokenAddress, w, connection, buyAmt, chatId, true),
                STATE.batchConcurrency,
                null,
                () => STATE.running && !isShuttingDown
            );
            await sleep(getJitteredInterval(STATE.intervalBetweenActions, STATE.jitterPercentage));
        }
        if (!STATE.useWalletPool) await walletManager.drainWallets(ephemWallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    }
    else if (mode === 'WASH_TRADING') {
        const pairs = Math.floor(10 + intensity * 3);
        bot.sendMessage(chatId, `🔄 Wash Trading: ${pairs} pairs`, { parse_mode: 'Markdown' });

        const ephemBuyers = !STATE.useWalletPool ? fetchWallets(1) : [];
        if (!STATE.useWalletPool) {
            const fundResult = await walletManager.fundWallets(ephemBuyers, { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: STATE.fundAmountPerWallet * 2, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });
            if (fundResult.successes === 0) {
                bot.sendMessage(chatId, `❌ *ABORTED:* Wash Trading funding failed.`, { parse_mode: 'Markdown' });
                return { success: false, error: 'Funding failed' };
            }
        }
        for (let i = 0; i < pairs && STATE.running && !isShuttingDown; i++) {
            const buyers = STATE.useWalletPool ? fetchWallets(1) : ephemBuyers;
            const sellers = STATE.useWalletPool ? fetchWallets(1) : buyers;

            const amt = parseFloat(getRandomFloat(STATE.minBuyAmount * 0.5, STATE.maxBuyAmount * 0.7).toFixed(4));
            await BatchSwapEngine.executeBatch(
                buyers,
                async (w) => await swap(SOL_ADDR, STATE.tokenAddress, w, connection, amt, chatId, true),
                STATE.batchConcurrency,
                null,
                () => STATE.running && !isShuttingDown
            );
            await sleep(getJitteredInterval(2000, 10));

            await BatchSwapEngine.executeBatch(
                sellers,
                async (w) => {
                    const bal = await getTokenBalance(connection, w.publicKey, STATE.tokenAddress);
                    if (bal > 0) return swap(STATE.tokenAddress, SOL_ADDR, w, connection, 'auto', chatId, true);
                    return null;
                },
                STATE.batchConcurrency,
                null,
                () => STATE.running && !isShuttingDown
            );

            if ((i + 1) % 5 === 0) bot.sendMessage(chatId, `🔄 Progress: ${i + 1}/${pairs}`, { parse_mode: 'Markdown' }).catch(() => { });
            await sleep(getJitteredInterval(3000, STATE.jitterPercentage));
        }
        if (!STATE.useWalletPool) await walletManager.drainWallets(ephemBuyers, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    }

    bot.sendMessage(chatId, `🏁 Trending strategy *${mode}* complete!`, { parse_mode: 'Markdown' });
    return { success: true };
}

// 🌪️ Strategy: Jito MEV Wash
async function executeJitoMevWash(chatId, connection) {
    if (!STATE.useJito) {
        bot.sendMessage(chatId, `❌ Enable Jito in settings to use MEV Wash!`, { parse_mode: 'Markdown' });
        return;
    }
    const walletCount = STATE.useWalletPool ? Math.min(STATE.walletsPerCycle, walletManager.size) : STATE.walletsPerCycle;
    return executeStrategyTemplate(chatId, connection, {
        name: 'JITO MEV Wash', walletCount, fundAmount: STATE.fundAmountPerWallet,
        buyLogic: async (wallet, idx, volMult, conn, cid) => {
            const amt = parseFloat(getRandomFloat(STATE.minBuyAmount, STATE.maxBuyAmount).toFixed(4));
            return await swap(SOL_ADDR, STATE.tokenAddress, wallet, conn, amt, cid, true);
        },
        sellLogic: async (wallet, idx, volMult, conn, cid) => {
            await sleep(1000);
            return await swap(STATE.tokenAddress, SOL_ADDR, wallet, conn, 'auto', cid, true);
        },
        cycles: STATE.numberOfCycles,
        needsFunding: !STATE.useWalletPool
    });
}

// 📱 Strategy: KOL Alpha Call
async function executeKolAlphaCall(chatId, connection) {
    const swarmSize = STATE.useWalletPool ? Math.min(STATE.kolRetailSwarmSize, walletManager.size) : STATE.kolRetailSwarmSize;

    const whaleWallet = fetchWallets(1)[0];
    const whaleAmt = parseFloat((getRandomFloat(STATE.maxBuyAmount * 2, STATE.maxBuyAmount * 5)).toFixed(4));
    
    if (!STATE.useWalletPool) {
        await walletManager.fundWallets([whaleWallet], { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: whaleAmt + 0.02, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });
    }

    bot.sendMessage(chatId, `🐋 Whale buy: \`${whaleAmt}\` SOL`, { parse_mode: 'Markdown' });
    if (STATE.running && !isShuttingDown) await swap(SOL_ADDR, STATE.tokenAddress, whaleWallet, connection, whaleAmt, chatId, true);
    await sleep(2000);

    const swarmWallets = fetchWallets(swarmSize);
    if (!STATE.useWalletPool) {
        bot.sendMessage(chatId, `🐟 Funding ${swarmSize} retail wallets...`, { parse_mode: 'Markdown' });
        await walletManager.fundWallets(swarmWallets, { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: STATE.minBuyAmount + 0.005, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });
    }
    bot.sendMessage(chatId, `🚀 Retail FOMO: ${swarmWallets.length} wallets`, { parse_mode: 'Markdown' });
    await BatchSwapEngine.executeBatch(
        swarmWallets,
        (w) => {
            const amt = parseFloat(getRandomFloat(STATE.minBuyAmount * 0.1, STATE.minBuyAmount * 0.8).toFixed(4));
            return swap(SOL_ADDR, STATE.tokenAddress, w, connection, amt, chatId, true);
        },
        STATE.batchConcurrency,
        (p) => {
            if (p.completed === p.total) bot.sendMessage(chatId, `✅ KOL Call: ${p.successes} retail buys executed`, { parse_mode: 'Markdown' });
        },
        () => STATE.running && !isShuttingDown
    );

    if (!STATE.useWalletPool) {
        await walletManager.drainWallets(swarmWallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
        await walletManager.drainWallets([whaleWallet], { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    }
    bot.sendMessage(chatId, `✅ KOL Alpha Call complete!`, { parse_mode: 'Markdown' });
    return { success: true };
}

// 🐻 Strategy: Bull Trap
async function executeBullTrap(chatId, connection) {
    bot.sendMessage(chatId, `🐻 *Bull Trap*\nFake breakout → stealth dump`, { parse_mode: 'Markdown' });
    const walletCount = STATE.useWalletPool ? Math.min(STATE.walletsPerCycle, walletManager.size) : STATE.walletsPerCycle;
    const trapWallet = fetchWallets(1)[0];
    if (!STATE.useWalletPool) await walletManager.fundWallets([trapWallet], { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: STATE.fundAmountPerWallet + 0.01, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });

    const steps = Math.floor(getRandomFloat(4, 7));
    for (let i = 0; i < steps && STATE.running && !isShuttingDown; i++) {
        const buyAmt = Math.random() < 0.3 ? getRandomFloat(STATE.minBuyAmount * 1.5, STATE.maxBuyAmount * 2) : getRandomFloat(STATE.minBuyAmount, STATE.maxBuyAmount);
        const finalAmt = parseFloat(buyAmt.toFixed(4));
        bot.sendMessage(chatId, `📈 Bait ${i + 1}/${steps}: \`${finalAmt}\` SOL`, { parse_mode: 'Markdown' });
        await swap(SOL_ADDR, STATE.tokenAddress, trapWallet, connection, finalAmt, chatId, true);
        await sleep(getJitteredInterval(Math.floor(getRandomFloat(1000, 4000)), STATE.jitterPercentage));
    }
    if (STATE.running && !isShuttingDown) {
        const waitTime = getJitteredInterval(Math.floor(getRandomFloat(5000, 12000)), STATE.jitterPercentage);
        bot.sendMessage(chatId, `⏳ Waiting \`${Math.round(waitTime / 1000)}s\` for reaction...`, { parse_mode: 'Markdown' });
        await sleep(waitTime);
    }
    
    if (STATE.running && !isShuttingDown) {
        const totalTokens = await getTokenBalance(connection, trapWallet.publicKey, STATE.tokenAddress);
        if (totalTokens <= 0) {
            bot.sendMessage(chatId, `⚠️ No tokens to dump. Aborted.`, { parse_mode: 'Markdown' });
        } else {
            const oldSlippage = STATE.slippage;
            STATE.slippage = STATE.bullTrapSlippage || 20;
            const chunks = Math.floor(getRandomFloat(2, 5)), chunkSize = totalTokens / chunks;
            bot.sendMessage(chatId, `🔴 Dumping \`${totalTokens.toFixed(4)}\` tokens in ${chunks} chunks @ ${STATE.slippage}% slippage`, { parse_mode: 'Markdown' });
            for (let c = 0; c < chunks && STATE.running && !isShuttingDown; c++) {
                const amountToSell = (c === chunks - 1) ? 'auto' : chunkSize.toFixed(6);
                await swap(STATE.tokenAddress, SOL_ADDR, trapWallet, connection, amountToSell, chatId, true);
                if (c < chunks - 1) await sleep(getJitteredInterval(Math.floor(getRandomFloat(500, 2000)), STATE.jitterPercentage));
            }
            STATE.slippage = oldSlippage;
        }
    }
    if (!STATE.useWalletPool) await walletManager.drainWallets([trapWallet], { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    bot.sendMessage(chatId, `✅ Bull Trap execution complete.`, { parse_mode: 'Markdown' });
    return { success: true };
}

// 🎁 Strategy: Social Proof Airdrop
async function executeSocialProofAirdrop(chatId, connection) {
    const wCount = STATE.useWalletPool ? Math.min(STATE.airdropWalletCount, walletManager.size) : STATE.airdropWalletCount;
    return executeStrategyTemplate(chatId, connection, {
        name: 'Social Proof Airdrop', walletCount: wCount, fundAmount: 0.015,
        buyLogic: async (w, index, volMult, conn, cid) => {
            const amt = getRandomFloat(0.0005, 0.01);
            const txid = await swap(SOL_ADDR, STATE.tokenAddress, w, conn, amt, cid, true);
            await sleep(getRandomFloat(2000, 8000));
            return txid;
        },
        sellLogic: async () => null,
        cycles: 1,
        needsFunding: !STATE.useWalletPool
    });
}

// NEW STRATEGY: Ladder
async function executeLadderStrategy(chatId, connection) {
    return executeStrategyTemplate(chatId, connection, {
        name: "LADDER",
        walletCount: STATE.walletsPerCycle,
        fundAmount: STATE.fundAmountPerWallet * 2,
        cycles: STATE.numberOfCycles,
        needsFunding: true,
        buyLogic: async (wallet, idx, volMult) => {
            const step = idx % STATE.ladderSteps;
            const amount = Math.min(STATE.minBuyAmount * Math.pow(STATE.ladderBuyMultiplier, step) * volMult, STATE.maxBuyAmount);
            return await swap(SOL_ADDR, STATE.tokenAddress, wallet, connection, amount, chatId, true);
        },
        sellLogic: async (wallet) => await swap(STATE.tokenAddress, SOL_ADDR, wallet, connection, 'auto', chatId, true)
    });
}

// NEW STRATEGY: Sniper Launch
async function executeSniperStrategy(chatId, connection) {
    bot.sendMessage(chatId, `⚡ *SNIPER MODE* — Fast entry + staged exits`, { parse_mode: 'Markdown' });
    const wallets = fetchWallets(STATE.walletsPerCycle);

    if (!STATE.useWalletPool) await walletManager.fundWallets(wallets, { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: STATE.fundAmountPerWallet * 2, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });
    else await walletManager.fundAll(connection, masterKeypair, sendSOL, STATE.fundAmountPerWallet * 2, STATE.batchConcurrency, null, () => STATE.running && !isShuttingDown, STATE.useWebFunding, STATE.fundingStealthLevel, STATE.makerFundingChainDepth);

    await BatchSwapEngine.executeBatch(wallets, async (wallet) => {
        if (!STATE.running || isShuttingDown) return null;
        await sleep(Math.random() * STATE.sniperEntrySpeedMs);
        return await swap(SOL_ADDR, STATE.tokenAddress, wallet, connection, STATE.maxBuyAmount * 1.5, chatId, true);
    }, STATE.batchConcurrency, null, () => STATE.running && !isShuttingDown);

    if (STATE.running && !isShuttingDown) {
        await sleep(getRandomFloat(STATE.sniperHoldTimeMin * 1000, STATE.sniperHoldTimeMax * 1000));
    } else {
        bot.sendMessage(chatId, `⚠️ Stop detected. Forcing sniper dump...`, { parse_mode: 'Markdown' });
    }

    await BatchSwapEngine.executeBatch(wallets, async (wallet) => {
        return await swap(STATE.tokenAddress, SOL_ADDR, wallet, connection, 'auto', chatId, true);
    }, STATE.batchConcurrency); // Force dump

    if (!STATE.useWalletPool) await walletManager.drainWallets(wallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    return { success: true };
}

// NEW STRATEGY: Advanced Wash Trading
async function executeAdvWashStrategy(chatId, connection) {
    bot.sendMessage(chatId, `🔄 *ADVANCED WASH* — Circular wash with ${STATE.washGroupCount} groups`, { parse_mode: 'Markdown' });
    const wallets = fetchWallets(STATE.walletsPerCycle);
    const groupSize = Math.floor(wallets.length / STATE.washGroupCount);

    if (!STATE.useWalletPool) await walletManager.fundWallets(wallets, { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: STATE.fundAmountPerWallet, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });
    else await walletManager.fundAll(connection, masterKeypair, sendSOL, STATE.fundAmountPerWallet, STATE.batchConcurrency, null, () => STATE.running && !isShuttingDown, STATE.useWebFunding, STATE.fundingStealthLevel, STATE.makerFundingChainDepth);

    for (let c = 0; c < STATE.washCyclesPerGroup && STATE.running; c++) {
        for (let g = 0; g < STATE.washGroupCount; g++) {
            const group = wallets.slice(g * groupSize, (g + 1) * groupSize);
            await BatchSwapEngine.executeBatch(group, async (wallet) => {
                return await swap(SOL_ADDR, STATE.tokenAddress, wallet, connection, STATE.minBuyAmount * 1.2, chatId, true);
            }, STATE.batchConcurrency);
            await sleep(800);
            await BatchSwapEngine.executeBatch(group, async (wallet) => {
                return await swap(STATE.tokenAddress, SOL_ADDR, wallet, connection, 'auto', chatId, true);
            }, STATE.batchConcurrency);
            await sleep(1200);
        }
    }
    if (!STATE.useWalletPool) await walletManager.drainWallets(wallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    return { success: true };
}

// NEW STRATEGY: Mirror Whale
async function executeMirrorWhaleStrategy(chatId, connection) {
    bot.sendMessage(chatId, `🐳 *MIRROR WHALE* — Copying top holders in real-time`, { parse_mode: 'Markdown' });
    const wallets = fetchWallets(STATE.walletsPerCycle);

    if (!STATE.useWalletPool) await walletManager.fundWallets(wallets, { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: STATE.fundAmountPerWallet * 3, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });
    else await walletManager.fundAll(connection, masterKeypair, sendSOL, STATE.fundAmountPerWallet * 3, STATE.batchConcurrency, null, () => STATE.running && !isShuttingDown, STATE.useWebFunding, STATE.fundingStealthLevel, STATE.makerFundingChainDepth);

    await BatchSwapEngine.executeBatch(wallets, async (wallet) => {
        if (!STATE.running || isShuttingDown) return null;
        const amount = getRandomFloat(STATE.mirrorBuyThresholdSOL * 0.8, STATE.mirrorBuyThresholdSOL * 1.5);
        return await swap(SOL_ADDR, STATE.tokenAddress, wallet, connection, amount, chatId, true);
    }, STATE.batchConcurrency, null, () => STATE.running && !isShuttingDown);

    if (STATE.running && !isShuttingDown) {
        await sleep(15000);
    } else {
        bot.sendMessage(chatId, `⚠️ Stop detected. Forcing mirror dump...`, { parse_mode: 'Markdown' });
    }

    await BatchSwapEngine.executeBatch(wallets, async (wallet) => {
        return await swap(STATE.tokenAddress, SOL_ADDR, wallet, connection, 'auto', chatId, true);
    }, STATE.batchConcurrency); // Force dump

    if (!STATE.useWalletPool) await walletManager.drainWallets(wallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    return { success: true };
}

// NEW STRATEGY: Curve Pump
async function executeCurvePumpStrategy(chatId, connection) {
    bot.sendMessage(chatId, `📈 *CURVE PUMP* — Pushing bonding curve to ${STATE.curveTargetPercent}%`, { parse_mode: 'Markdown' });
    const wallets = fetchWallets(STATE.walletsPerCycle);

    if (!STATE.useWalletPool) await walletManager.fundWallets(wallets, { connection, masterKeypair, sendSOLFn: sendSOL, amountSOL: STATE.fundAmountPerWallet * 2, concurrency: STATE.batchConcurrency, checkRunning: () => STATE.running && !isShuttingDown, useWebFunding: STATE.useWebFunding, stealthLevel: STATE.fundingStealthLevel, hopDepth: STATE.makerFundingChainDepth });
    else await walletManager.fundAll(connection, masterKeypair, sendSOL, STATE.fundAmountPerWallet * 2, STATE.batchConcurrency, null, () => STATE.running && !isShuttingDown, STATE.useWebFunding, STATE.fundingStealthLevel, STATE.makerFundingChainDepth);

    await BatchSwapEngine.executeBatch(wallets, async (wallet, idx) => {
        if (!STATE.running || isShuttingDown) return null;
        const intensity = idx < 10 ? STATE.curveBuyIntensity : 1;
        const amount = STATE.maxBuyAmount * intensity;
        return await swap(SOL_ADDR, STATE.tokenAddress, wallet, connection, amount, chatId, true);
    }, STATE.batchConcurrency, null, () => STATE.running && !isShuttingDown);

    if (STATE.running && !isShuttingDown) {
        await sleep(8000);
    } else {
        bot.sendMessage(chatId, `⚠️ Stop detected. Forcing curve pump dump...`, { parse_mode: 'Markdown' });
    }

    await BatchSwapEngine.executeBatch(wallets, async (wallet) => {
        return await swap(STATE.tokenAddress, SOL_ADDR, wallet, connection, 'auto', chatId, true);
    }, STATE.batchConcurrency); // Force dump

    if (!STATE.useWalletPool) await walletManager.drainWallets(wallets, { connection, masterKeypair, sendSOLFn: sendSOL, concurrency: STATE.batchConcurrency });
    return { success: true };
}

// ─────────────────────────────────────────────
// 🧠 SMART SELL MODULE
// ─────────────────────────────────────────────
let smartSellInterval = null;

async function getWalletsWithToken(connection, tokenAddr, limit = 100) {
    const holders = [];
    const allWalletsList = walletManager.allWallets;
    for (const wallet of allWalletsList) {
        const bal = await getTokenBalance(connection, wallet.publicKey, tokenAddr);
        if (bal > 0.0001) {
            holders.push({ wallet, balance: bal });
            if (holders.length >= limit) break;
        }
    }
    return holders;
}

function detectOrganicBuy(tx, tokenAddr) {
    try {
        const botPublicKeys = new Set();
        const allWalletsList = walletManager.allWallets;
        for (const w of allWalletsList) botPublicKeys.add(w.publicKey.toBase58());
        if (masterKeypair) botPublicKeys.add(masterKeypair.publicKey.toBase58());

        const preBalances = tx.meta?.preTokenBalances || [];
        const postBalances = tx.meta?.postTokenBalances || [];

        for (const post of postBalances) {
            const owner = post.owner;
            if (!owner) continue;
            if (botPublicKeys.has(owner)) continue;

            const mint = post.mint;
            if (mint !== tokenAddr) continue;

            const pre = preBalances.find(p => p.owner === owner && p.mint === mint);
            const preAmt = pre ? pre.uiTokenAmount.uiAmount : 0;
            const postAmt = post.uiTokenAmount.uiAmount;
            if (postAmt > preAmt + 0.001 && postAmt - preAmt >= STATE.smartSellMinBuySOL) {
                return true;
            }
        }
    } catch (e) {
        logger.debug(`Organic buy detection error: ${e.message}`);
    }
    return false;
}

async function triggerSmartSell(connection, tokenAddr) {
    let walletToSell = null;
    let balance = 0;

    // 1. Use dev wallet if configured and has tokens
    if (STATE.smartSellDevWalletPubkey && STATE.smartSellDevWalletKeypair) {
        walletToSell = STATE.smartSellDevWalletKeypair;
        balance = await getTokenBalance(connection, walletToSell.publicKey, tokenAddr);
        if (balance <= 0.0001) {
            logger.warn(`🧠 Smart Sell: Dev wallet ${STATE.smartSellDevWalletPubkey} has no tokens. Falling back.`);
            walletToSell = null;
        }
    }

    // 2. Fallback to random holder wallet
    if (!walletToSell) {
        const holders = await getWalletsWithToken(connection, tokenAddr, STATE.smartSellMaxWallets);
        if (holders.length === 0) {
            logger.debug("Smart Sell: No wallets with tokens to sell.");
            return;
        }
        const idx = STATE.smartSellWalletIndex % holders.length;
        STATE.smartSellWalletIndex = (STATE.smartSellWalletIndex + 1) % holders.length;
        walletToSell = holders[idx].wallet;
        balance = holders[idx].balance;
    }

    const walletKey = walletToSell.publicKey.toBase58();
    const now = Date.now();

    // Cooldown only for non-dev wallets
    if (walletToSell !== STATE.smartSellDevWalletKeypair &&
        STATE.smartSellLastTrigger[walletKey] &&
        now - STATE.smartSellLastTrigger[walletKey] < STATE.smartSellCooldownMs) {
        logger.debug(`Smart Sell: Wallet ${walletKey} on cooldown.`);
        return;
    }

    const sellAmount = balance * (STATE.smartSellPercent / 100);
    if (sellAmount < 0.0001) return;

    if (walletToSell !== STATE.smartSellDevWalletKeypair) {
        STATE.smartSellLastTrigger[walletKey] = now;
    }
    logger.info(`🧠 Smart Sell: Selling ${sellAmount.toFixed(6)} tokens from ${walletKey}`);

    await swap(tokenAddr, SOL_ADDR, walletToSell, connection, sellAmount.toFixed(6), ADMIN_CHAT_ID, true);
}

async function startSmartSellMonitor(connection, tokenAddr) {
    if (smartSellInterval) clearInterval(smartSellInterval);
    if (!STATE.smartSellEnabled) return;

    let lastSeenSig = new Set();

    smartSellInterval = setInterval(async () => {
        if (!STATE.running && !STATE.smartSellEnabled) return;
        if (!tokenAddr || tokenAddr === "") return;

        try {
            const pubKey = new PublicKey(tokenAddr);
            const sigs = await connection.getSignaturesForAddress(pubKey, { limit: 20 });

            const newSigs = sigs.filter(sig => !lastSeenSig.has(sig.signature));
            for (const sig of newSigs) lastSeenSig.add(sig.signature);
            if (lastSeenSig.size > 1000) {
                const toDelete = [...lastSeenSig].slice(0, 200);
                toDelete.forEach(s => lastSeenSig.delete(s));
            }

            for (const sigInfo of newSigs) {
                if (Date.now() - sigInfo.blockTime * 1000 < 5000) continue;

                const tx = await connection.getTransaction(sigInfo.signature, {
                    maxSupportedTransactionVersion: 0,
                });
                if (!tx) continue;

                if (detectOrganicBuy(tx, tokenAddr)) {
                    await triggerSmartSell(connection, tokenAddr);
                }
            }
        } catch (err) {
            logger.warn(`Smart Sell monitor error: ${err.message}`);
        }
    }, 10000);
}

// ─────────────────────────────────────────────
// 🚀 Main Engine Dispatcher
// ─────────────────────────────────────────────
async function startEngine(chatId) {
    if (STATE.running) return bot.sendMessage(chatId, `🔄 Already running! Stop first.`, { parse_mode: 'Markdown' });
    if (!STATE.tokenAddress) return bot.sendMessage(chatId, `❌ Token address not set!`, { parse_mode: 'Markdown' });
    if (!masterKeypair) return bot.sendMessage(chatId, `❌ Master wallet not loaded!`, { parse_mode: 'Markdown' });

    STATE.running = true;
    const connection = getConnection();

    // Start Smart Sell monitor if enabled
    if (STATE.smartSellEnabled) {
        await startSmartSellMonitor(connection, STATE.tokenAddress);
    }

    let success = false;
    switch (STATE.strategy) {
        case 'STANDARD': success = await withStrategyLock('STANDARD', () => executeStandardCycles(chatId, connection), chatId); break;
        case 'MAKER': success = await withStrategyLock('MAKER', () => executeMakerCycles(chatId, connection), chatId); break;
        case 'WEB_OF_ACTIVITY': success = await withStrategyLock('WEB_OF_ACTIVITY', () => executeWebOfActivity(chatId, connection), chatId); break;
        case 'SPAM': success = await withStrategyLock('SPAM', () => executeSpamMode(chatId, connection), chatId); break;
        case 'PUMP_DUMP': success = await withStrategyLock('PUMP_DUMP', () => executePumpDump(chatId, connection), chatId); break;
        case 'CHART_PATTERN': success = await withStrategyLock('CHART_PATTERN', () => executeChartPattern(chatId, connection), chatId); break;
        case 'HOLDER_GROWTH': success = await withStrategyLock('HOLDER_GROWTH', () => executeHolderGrowth(chatId, connection), chatId); break;
        case 'WHALE': success = await withStrategyLock('WHALE', () => executeWhaleSimulation(chatId, connection), chatId); break;
        case 'VOLUME_BOOST': success = await withStrategyLock('VOLUME_BOOST', () => executeVolumeBoost(chatId, connection), chatId); break;
        case 'TRENDING': success = await withStrategyLock('TRENDING', () => executeTrendingStrategy(chatId, connection), chatId); break;
        case 'JITO_MEV_WASH': success = await withStrategyLock('JITO_MEV_WASH', () => executeJitoMevWash(chatId, connection), chatId); break;
        case 'KOL_ALPHA_CALL': success = await withStrategyLock('KOL_ALPHA_CALL', () => executeKolAlphaCall(chatId, connection), chatId); break;
        case 'BULL_TRAP': success = await withStrategyLock('BULL_TRAP', () => executeBullTrap(chatId, connection), chatId); break;
        case 'SOCIAL_PROOF_AIRDROP': success = await withStrategyLock('SOCIAL_PROOF_AIRDROP', () => executeSocialProofAirdrop(chatId, connection), chatId); break;
        case 'LADDER': success = await withStrategyLock('LADDER', () => executeLadderStrategy(chatId, connection), chatId); break;
        case 'SNIPER': success = await withStrategyLock('SNIPER', () => executeSniperStrategy(chatId, connection), chatId); break;
        case 'ADV_WASH': success = await withStrategyLock('ADV_WASH', () => executeAdvWashStrategy(chatId, connection), chatId); break;
        case 'MIRROR_WHALE': success = await withStrategyLock('MIRROR_WHALE', () => executeMirrorWhaleStrategy(chatId, connection), chatId); break;
        case 'CURVE_PUMP': success = await withStrategyLock('CURVE_PUMP', () => executeCurvePumpStrategy(chatId, connection), chatId); break;
        default: success = false;
    }

    if (!success) STATE.running = false;
    else {
        if (STATE.running && !isShuttingDown) bot.sendMessage(chatId, `🏁 *Strategy Complete!*`, { parse_mode: "Markdown" });
        STATE.running = false;
    }

    // Stop Smart Sell monitor if engine stops
    if (smartSellInterval && !STATE.running) {
        clearInterval(smartSellInterval);
        smartSellInterval = null;
    }
}

// ======================== MESSAGE FORMATTING HELPERS ========================

/**
 * Format a success message with consistent styling
 */
function formatSuccessMessage(title, details = {}) {
    let message = `✅ *${title}*\n\n`;
    for (const [key, value] of Object.entries(details)) {
        message += `${key}: \`${value}\`\n`;
    }
    return message;
}

/**
 * Format an error message with consistent styling
 */
function formatErrorMessage(title, error, suggestions = []) {
    let message = `❌ *${title}*\n\n`;
    message += `Error: ${error}\n`;
    if (suggestions.length > 0) {
        message += `\n*Possible Solutions:*\n`;
        suggestions.forEach(s => message += `• ${s}\n`);
    }
    return message;
}

/**
 * Format a progress message with percentage
 */
function formatProgressMessage(stage, current, total, extraInfo = '') {
    const percent = Math.round((current / total) * 100);
    let message = `${stage}: ${current}/${total} (${percent}%)`;
    if (extraInfo) message += `\n${extraInfo}`;
    return message;
}

/**
 * Format strategy start message with details
 */
function formatStrategyStart(name, config = {}) {
    let message = `🚀 *Starting ${name}*\n\n`;
    if (config.wallets) message += `Wallets: \`${config.wallets}\`\n`;
    if (config.cycles) message += `Cycles: \`${config.cycles}\`\n`;
    if (config.amount) message += `Amount Range: \`${config.amount}\`\n`;
    if (config.mode) message += `Mode: \`${config.mode}\`\n`;
    if (config.token) message += `Token: \`${config.token.substring(0, 8)}...\`\n`;
    return message;
}

/**
 * Format strategy completion message with stats
 */
function formatStrategyComplete(name, stats = {}) {
    let message = `🎉 *${name} Complete!*\n\n`;
    message += `*Results:*\n`;
    if (stats.cycles) message += `Cycles: \`${stats.cycles}\`\n`;
    if (stats.trades) message += `Trades: \`${stats.trades}\`\n`;
    if (stats.success !== undefined) message += `Success Rate: \`${stats.success}%\`\n`;
    if (stats.volume) message += `Volume: \`${stats.volume}\` SOL\n`;
    if (stats.duration) message += `Duration: \`${stats.duration}\`\n`;
    return message;
}

// ======================== TELEGRAM UI ========================
function showMainMenu(chatId) {
    const statusIcon = STATE.running ? '🟢' : '🔴';
    bot.sendMessage(chatId,
        `╔═══════════════════════╗\n` +
        `║  🤖 *Volume Bot v3.2*  ║\n` +
        `╚═══════════════════════╝\n\n` +
        `⚡ *Status:* ${statusIcon} ${STATE.running ? 'RUNNING' : 'IDLE'}\n` +
        `🎯 *Strategy:* \`${STATE.strategy}\`\n` +
        `💼 *Pool:* \`${walletManager.size.toLocaleString()}\` wallets\n` +
        `🪙 *Token:* ${STATE.tokenAddress ? '✅ Set' : '❌ Not Set'}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: (STATE.running ? '🛑 STOP' : '🚀 LAUNCH'), callback_data: (STATE.running ? 'stop_cycles' : 'start_cycles') }],
                    [{ text: '📈 Strategies', callback_data: 'strategies' }, { text: '⚙️ Settings', callback_data: 'settings' }],
                    [{ text: '💼 Wallet Pool', callback_data: 'wallet_pool' }, { text: '📊 Dashboard', callback_data: 'status' }],
                    [{ text: '📜 My Wallet', callback_data: 'show_wallet' }, { text: '❓ Help', callback_data: 'help' }]
                ]
            }
        }
    );
}

function showStrategyMenu(chatId) {
    const s = STATE.strategy;
    bot.sendMessage(chatId,
        `📈 *STRATEGY SELECTION*\n━━━━━━━━━━━━━━━━━━━━━━━\nCurrent: *${s}*\n\nChoose:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: (s === 'STANDARD' ? '✅ ' : '') + '🌐 Standard', callback_data: 'strat_standard' }, { text: (s === 'MAKER' ? '✅ ' : '') + '📈 Maker', callback_data: 'strat_maker' }],
                    [{ text: (s === 'WEB_OF_ACTIVITY' ? '✅ ' : '') + '🕸️ Web', callback_data: 'strat_web' }, { text: (s === 'SPAM' ? '✅ ' : '') + '⚡ Spam', callback_data: 'strat_spam' }],
                    [{ text: (s === 'PUMP_DUMP' ? '✅ ' : '') + '🚀 Pump&Dump', callback_data: 'strat_pumpdump' }, { text: (s === 'CHART_PATTERN' ? '✅ ' : '') + '📐 Chart', callback_data: 'strat_chart' }],
                    [{ text: (s === 'HOLDER_GROWTH' ? '✅ ' : '') + '👥 Holders', callback_data: 'strat_holder' }, { text: (s === 'WHALE' ? '✅ ' : '') + '🐋 Whale', callback_data: 'strat_whale' }],
                    [{ text: (s === 'VOLUME_BOOST' ? '✅ ' : '') + '📊 Boost', callback_data: 'strat_volume' }, { text: (s === 'TRENDING' ? '✅ ' : '') + '🔥 Trending', callback_data: 'strat_trending' }],
                    [{ text: (s === 'JITO_MEV_WASH' ? '✅ ' : '') + '🌪️ MEV Wash', callback_data: 'strat_mev_wash' }, { text: (s === 'KOL_ALPHA_CALL' ? '✅ ' : '') + '📱 KOL', callback_data: 'strat_kol' }],
                    [{ text: (s === 'BULL_TRAP' ? '✅ ' : '') + '🐻 Bull Trap', callback_data: 'strat_bull' }, { text: (s === 'SOCIAL_PROOF_AIRDROP' ? '✅ ' : '') + '🎁 Airdrop', callback_data: 'strat_airdrop' }],
                    [{ text: (s === 'LADDER' ? '✅ ' : '') + '📊 Ladder', callback_data: 'strat_ladder' }, { text: (s === 'SNIPER' ? '✅ ' : '') + '⚡ Sniper', callback_data: 'strat_sniper' }],
                    [{ text: (s === 'ADV_WASH' ? '✅ ' : '') + '🔄 Adv Wash', callback_data: 'strat_adv_wash' }, { text: (s === 'MIRROR_WHALE' ? '✅ ' : '') + '🐳 Mirror Whale', callback_data: 'strat_mirror' }],
                    [{ text: (s === 'CURVE_PUMP' ? '✅ ' : '') + '📈 Curve Pump', callback_data: 'strat_curve' }],
                    [{ text: '« Back', callback_data: 'back_to_main' }]
                ]
            }
        }
    );
}

function showSettingsMenu(chatId) {
    bot.sendMessage(chatId,
        `⚙️ *CONFIGURATION*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nCategory:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📱 Basic', callback_data: 'settings_basic' }, { text: '⚡ Advanced', callback_data: 'settings_advanced' }],
                    [{ text: '🎯 Strategy', callback_data: 'settings_strat' }, { text: '🎭 Realism', callback_data: 'show_realism' }],
                    [{ text: '🔌 Provider', callback_data: 'provider_settings' }, { text: '🛡️ Jito', callback_data: 'settings_jito' }],
                    [{ text: '🕸️ Stealth', callback_data: 'stealth_settings' }, { text: '🧠 Smart Sell', callback_data: 'smart_sell_menu' }],
                    [{ text: '« Back', callback_data: 'back_to_main' }]
                ]
            }
        }
    );
}

function showBasicSettings(chatId) {
    const tokenStatus = STATE.tokenAddress ? `\`${STATE.tokenAddress.slice(0, 8)}...${STATE.tokenAddress.slice(-4)}\`` : '❌ Not Set';
    bot.sendMessage(chatId,
        `📱 *BASIC CONFIG*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🪙 *Token:* ${tokenStatus}\n` +
        `💰 *Buy:* \`${STATE.minBuyAmount}\` - \`${STATE.maxBuyAmount}\` SOL\n` +
        `🔁 *Cycles:* \`${STATE.numberOfCycles}\`\n` +
        `⏱ *Delay:* \`${STATE.intervalBetweenActions / 1000}s\`\n` +
        `🎲 *Jitter:* \`${STATE.jitterPercentage}%\``,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🪙 Token CA', callback_data: 'set_token_address' }],
                    [{ text: '💰 Min Buy', callback_data: 'set_min_buy' }, { text: '💰 Max Buy', callback_data: 'set_max_buy' }],
                    [{ text: '🔁 Cycles', callback_data: 'set_cycles' }, { text: '🎲 Jitter', callback_data: 'set_jitter' }],
                    [{ text: '⏱ Delay', callback_data: 'set_interval' }],
                    [{ text: '« Back', callback_data: 'settings' }]
                ]
            }
        }
    );
}

function showAdvancedSettings(chatId) {
    bot.sendMessage(chatId,
        `⚡ *Advanced Settings*\n\n` +
        `• Priority Fee: \`${STATE.priorityFee}\` SOL\n` +
        `• Slippage: \`${STATE.slippage}%\`\n` +
        `• Batch Concurrency: \`${STATE.batchConcurrency}\`\n` +
        `• Wallets/Cycle: \`${STATE.walletsPerCycle}\`\n` +
        `• Sync Buys/Sells: \`${STATE.maxSimultaneousBuys}/${STATE.maxSimultaneousSells}\``,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💸 Fee', callback_data: 'set_fees' }, { text: '📉 Slippage', callback_data: 'set_slippage' }],
                    [{ text: '⚡ Concurrency', callback_data: 'set_batch_concurrency' }, { text: '👥 Wallets/Cycle', callback_data: 'set_wallets_per_cycle' }],
                    [{ text: '🔄 Sync Buys/Sells', callback_data: 'set_sync' }],
                    [{ text: '🔙 Back', callback_data: 'settings' }]
                ]
            }
        }
    );
}

function showStealthSettings(chatId) {
    bot.sendMessage(chatId,
        `🕸️ *Stealth Settings*\n\n` +
        `• Web Funding: ${STATE.useWebFunding ? '🟢 ON' : '🔴 OFF'}\n` +
        `• Stealth Level: ${STATE.fundingStealthLevel === 2 ? '🌪️ Multi-hop' : '📡 Direct'}\n` +
        `• Max Hop Depth: \`${STATE.makerFundingChainDepth}\``,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `Web Funding ${STATE.useWebFunding ? '🔴' : '🟢'}`, callback_data: 'toggle_web_funding' }],
                    [{ text: `Level: ${STATE.fundingStealthLevel === 2 ? '➡️ Direct' : '⬅️ Multi-hop'}`, callback_data: 'toggle_stealth_level' }],
                    [{ text: '🔗 Max Depth', callback_data: 'set_maker_depth' }],
                    [{ text: '🔙 Back', callback_data: 'settings' }]
                ]
            }
        }
    );
}

function showRealismMenu(chatId) {
    bot.sendMessage(chatId,
        `🎭 *Realism Engine*\n\n` +
        `• Engine: ${STATE.realismMode ? '🟢 ON' : '🔴 OFF'}\n` +
        `• Human Delays: ${STATE.humanizedDelays ? '🟢 ON' : '🔴 OFF'}\n` +
        `• Poisson Timing: ${STATE.usePoissonTiming ? '🟢 ON' : '🔴 OFF'}\n` +
        `• Variable Slippage: ${STATE.variableSlippage ? '🟢 ON' : '🔴 OFF'}\n` +
        `• Volume Curve: ${STATE.useVolumeCurve ? '🟢 ON' : '🔴 OFF'}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `Engine ${STATE.realismMode ? '🔴' : '🟢'}`, callback_data: 'toggle_realism' }],
                    [{ text: `Delays ${STATE.humanizedDelays ? '🔴' : '🟢'}`, callback_data: 'toggle_delays' }],
                    [{ text: `Poisson ${STATE.usePoissonTiming ? '🔴' : '🟢'}`, callback_data: 'toggle_poisson' }],
                    [{ text: `Slippage ${STATE.variableSlippage ? '🔴' : '🟢'}`, callback_data: 'toggle_varslip' }],
                    [{ text: `Volume ${STATE.useVolumeCurve ? '🔴' : '🟢'}`, callback_data: 'toggle_vol_curve' }],
                    [{ text: '🔙 Back', callback_data: 'settings' }]
                ]
            }
        }
    );
}

function showJitoSettings(chatId) {
    bot.sendMessage(chatId,
        `🛡️ *Jito MEV Protection*\n\n` +
        `• Status: *${STATE.useJito ? '🟢 ENABLED' : '🔴 DISABLED'}*\n` +
        `• Tip: \`${STATE.jitoTipAmount}\` SOL`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `Toggle ${STATE.useJito ? '🔴' : '🟢'}`, callback_data: 'set_jito' }],
                    [{ text: '💵 Set Tip', callback_data: 'set_jito_tip' }],
                    [{ text: '🔙 Back', callback_data: 'settings' }]
                ]
            }
        }
    );
}

function showProviderMenu(chatId) {
    const p = STATE.swapProvider;
    bot.sendMessage(chatId,
        `🔌 *Swap Provider*\nCurrent: *${p}*\nDEX: \`${STATE.targetDex}\``,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: (p === 'SOLANA_TRACKER' ? '✅ ' : '') + '🌐 SolanaTracker', callback_data: 'prov_tracker' }],
                    [{ text: (p === 'SOLANA_TRADE' ? '✅ ' : '') + '🎯 SolanaTrade', callback_data: 'prov_trade' }],
                    [{ text: '🎯 Select DEX', callback_data: 'select_dex' }],
                    [{ text: '🔙 Back', callback_data: 'settings' }]
                ]
            }
        }
    );
}

function showDexMenu(chatId) {
    const current = STATE.targetDex;
    const dexes = [
        ['PUMP_FUN', 'Pump.fun'], ['PUMP_SWAP', 'Pump Swap'],
        ['RAYDIUM_AMM', 'Raydium AMM'], ['RAYDIUM_CLMM', 'Raydium CLMM'],
        ['RAYDIUM_CPMM', 'Raydium CPMM'], ['RAYDIUM_LAUNCHPAD', 'Raydium Launch'],
        ['ORCA_WHIRLPOOL', 'Orca Whirlpool'], ['METEORA_DLMM', 'Meteora DLMM'],
        ['METEORA_DAMM_V1', 'Meteora V1'], ['METEORA_DAMM_V2', 'Meteora V2'],
        ['METEORA_DBC', 'Meteora DBC'], ['MOONIT', 'Moonit'],
        ['HEAVEN', 'Heaven'], ['SUGAR', 'Sugar'], ['BOOP_FUN', 'Boop.fun']
    ];
    const keyboard = [];
    for (let i = 0; i < dexes.length; i += 2) {
        const row = [];
        const [val1, label1] = dexes[i];
        row.push({ text: (current === val1 ? '✅ ' : '') + label1, callback_data: `dex_${val1}` });
        if (i + 1 < dexes.length) {
            const [val2, label2] = dexes[i + 1];
            row.push({ text: (current === val2 ? '✅ ' : '') + label2, callback_data: `dex_${val2}` });
        }
        keyboard.push(row);
    }
    keyboard.push([{ text: '🔙 Back', callback_data: 'provider_settings' }]);
    bot.sendMessage(chatId, `🎯 *Target DEX*\nCurrent: *${current}*`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

function showWalletPoolMenu(chatId) {
    const stats = walletManager.getStats?.() || { total: walletManager.size, firstFew: [] };
    const modeIcon = STATE.useWalletPool ? '🟢' : '🔴';
    bot.sendMessage(chatId,
        `💼 *WALLET MANAGER*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 *Total:* \`${stats.total.toLocaleString()}\`\n` +
        `${modeIcon} *Mode:* ${STATE.useWalletPool ? 'ENABLED' : 'DISABLED'}\n` +
        `⚡ *Concurrency:* \`${STATE.batchConcurrency}\`\n` +
        `👥 *Per Cycle:* \`${STATE.walletsPerCycle}\`\n` +
        `💵 *Fund Amt:* \`${STATE.fundAmountPerWallet}\` SOL\n` +
        `${stats.total > 0 ? `\nSample: \`${stats.firstFew[0]}\`` : `\n⚠️ No wallets yet`}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔨 Generate', callback_data: 'pool_generate' }],
                    [{ text: '💰 Fund All', callback_data: 'pool_fund' }, { text: '🔄 Drain All', callback_data: 'pool_drain' }],
                    [{ text: '📊 Aging Stats', callback_data: 'aging_stats' }, { text: '🌱 Season Wallets', callback_data: 'aging_season' }],
                    [{ text: '📊 Scan', callback_data: 'pool_scan' }, { text: `${STATE.useWalletPool ? '🔴 Disable' : '🟢 Enable'}`, callback_data: 'pool_toggle' }],
                    [{ text: '⚡ Concurrency', callback_data: 'set_batch_concurrency' }, { text: '👥 Per Cycle', callback_data: 'set_wallets_per_cycle' }],
                    [{ text: '💵 Fund Amt', callback_data: 'set_fund_amount' }, { text: '🗑️ Clear', callback_data: 'pool_clear' }],
                    [{ text: '« Back', callback_data: 'back_to_main' }]
                ]
            }
        }
    );
}

function showSmartSellMenu(chatId) {
    const devStatus = STATE.smartSellDevWalletPubkey
        ? `✅ \`${STATE.smartSellDevWalletPubkey.slice(0, 8)}...\``
        : '❌ Not set';
    bot.sendMessage(chatId,
        `🧠 *SMART SELL*\n\n` +
        `Status: ${STATE.smartSellEnabled ? '🟢 ACTIVE' : '🔴 INACTIVE'}\n` +
        `Sell %: \`${STATE.smartSellPercent}%\` of balance\n` +
        `Max Wallets (fallback): \`${STATE.smartSellMaxWallets}\`\n` +
        `Min Buy SOL: \`${STATE.smartSellMinBuySOL}\`\n` +
        `Cooldown: \`${STATE.smartSellCooldownMs / 1000}s\` per wallet\n` +
        `Dev Wallet: ${devStatus}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `${STATE.smartSellEnabled ? '🔴 Disable' : '🟢 Enable'}`, callback_data: 'toggle_smart_sell' }],
                    [{ text: '📊 Set Sell %', callback_data: 'set_smart_percent' }],
                    [{ text: '👥 Set Max Wallets', callback_data: 'set_smart_max_wallets' }],
                    [{ text: '💰 Set Min Buy SOL', callback_data: 'set_smart_min_buy' }],
                    [{ text: '⏱️ Set Cooldown', callback_data: 'set_smart_cooldown' }],
                    [{ text: '🔑 Set Dev Wallet (Private Key)', callback_data: 'set_smart_dev_wallet' }],
                    [{ text: '🗑️ Clear Dev Wallet', callback_data: 'clear_smart_dev_wallet' }],
                    [{ text: '« Back', callback_data: 'settings' }]
                ]
            }
        }
    );
}

function showHelp(chatId) {
    bot.sendMessage(chatId,
        `❓ *Volume Bot v3.2 - Help*\n\n` +
        `*Quick Start:*\n` +
        `1. Set Token CA in ⚙️ Config\n` +
        `2. Choose strategy in 📈 Strategies\n` +
        `3. Hit 🚀 Launch Engine\n\n` +
        `*Smart Sell:*\n` +
        `• Monitors organic buys and sells a % from your dev wallet\n` +
        `• Set a dedicated dev wallet (private key) – never saved to disk\n` +
        `• Falls back to random holder wallets if dev wallet runs out\n` +
        `• Cooldown only applies to fallback wallets, not the dev wallet\n\n` +
        `*Pro Tips:*\n` +
        `• Higher Jitter = more human-like\n` +
        `• Maker mode uses more SOL (funds child wallets)\n` +
        `• Use 📊 Dashboard to monitor balances\n` +
        `• Stealth funding (multi-hop) obfuscates on-chain links\n` +
        `• Always test on devnet first!\n\n` +
        `*Safety:*\n` +
        `• Bot auto-saves config on changes\n` +
        `• Graceful shutdown on SIGINT/SIGTERM\n` +
        `• Balance checks prevent failed transactions`,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '« Back', callback_data: 'back_to_main' }]] }
        }
    );
}

async function showDashboard(chatId) {
    if (!masterKeypair) return bot.sendMessage(chatId, `❌ No wallet loaded.`, { parse_mode: 'Markdown' });
    try {
        const connection = getConnection();
        const solBal = await connection.getBalance(masterKeypair.publicKey) / LAMPORTS_PER_SOL;
        let tokenBal = 0;
        if (STATE.tokenAddress) tokenBal = await getTokenBalance(connection, masterKeypair.publicKey, STATE.tokenAddress);
        const estTxs = Math.floor(solBal / (STATE.maxBuyAmount + STATE.priorityFee + 0.001));
        bot.sendMessage(chatId,
            `📊 *Bot Dashboard*\n\n` +
            `💰 *Balances*\nSOL: \`${solBal.toFixed(4)}\`\nToken: \`${tokenBal}\`\n\n` +
            `💼 *Wallet Pool*\nTotal: \`${walletManager.size.toLocaleString()}\` | Mode: *${STATE.useWalletPool ? 'ON' : 'OFF'}*\n` +
            `Concurrency: \`${STATE.batchConcurrency}\` | Per Cycle: \`${STATE.walletsPerCycle}\`\n\n` +
            `⚙️ *Config*\nStrategy: *${STATE.strategy}*\nProvider: *${STATE.swapProvider}* | DEX: *${STATE.targetDex}*\n` +
            `Token: \`${STATE.tokenAddress || 'Not Set'}\`\nBuy: \`${STATE.minBuyAmount} - ${STATE.maxBuyAmount}\` SOL\n` +
            `Fee: \`${STATE.priorityFee}\` | Slip: \`${STATE.slippage}%\`\nJitter: \`${STATE.jitterPercentage}%\` | Delay: \`${STATE.intervalBetweenActions / 1000}s\`\n` +
            `Cycles: \`${STATE.numberOfCycles}\` | Sync: \`${STATE.maxSimultaneousBuys}/${STATE.maxSimultaneousSells}\`\n\n` +
            `🧠 *Smart Sell*: ${STATE.smartSellEnabled ? '🟢 ON' : '🔴 OFF'} | ${STATE.smartSellPercent}% | Dev: ${STATE.smartSellDevWalletPubkey ? '✅' : '❌'}\n\n` +
            `🛡️ Engine: ${STATE.running ? '🟢 ONLINE' : '🔴 OFFLINE'}\n🔁 Est. Max Swaps: \`${estTxs}\``,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        logger.error(`[Dashboard] Error: ${e.message}`);
        bot.sendMessage(chatId, `⚠️ Could not fetch status: ${e.message}`, { parse_mode: 'Markdown' }).catch(() => { });
    }
}

function showWallet(chatId) {
    if (!masterKeypair) return bot.sendMessage(chatId, `❌ No wallet loaded.`, { parse_mode: 'Markdown' });
    const addr = masterKeypair.publicKey.toBase58();
    bot.sendMessage(chatId, `📜 *Master Wallet*\n\`${addr}\`\n\n[View on Solscan](https://solscan.io/account/${addr})`, { parse_mode: 'Markdown' });
}

function promptSetting(chatId, prompt, callback) {
    const cid = chatId.toString();
    clearSession(cid);
    bot.sendMessage(chatId, prompt, { parse_mode: "Markdown", reply_markup: { force_reply: true, selective: true } }).catch(() => { });
    const timeout = setTimeout(() => {
        if (userSessions.has(cid)) {
            userSessions.delete(cid);
            bot.sendMessage(chatId, "⏰ Prompt timed out. Try again.", { parse_mode: 'Markdown' }).catch(() => { });
        }
    }, 60000);
    userSessions.set(cid, { action: 'prompt', timeout, callback, created: Date.now() });
}

async function setSmartSellDevWallet(privateKeyBase58, chatId) {
    try {
        const keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58.trim()));
        STATE.smartSellDevWalletPubkey = keypair.publicKey.toBase58();
        STATE.smartSellDevWalletKeypair = keypair;
        saveConfig();
        if (chatId) {
            bot.sendMessage(chatId, `✅ Dev wallet set: \`${STATE.smartSellDevWalletPubkey}\``, { parse_mode: 'Markdown' });
        }
        logger.info(`Smart Sell dev wallet loaded: ${STATE.smartSellDevWalletPubkey}`);
        return true;
    } catch (e) {
        logger.error(`Failed to load dev wallet: ${e.message}`);
        if (chatId) bot.sendMessage(chatId, `❌ Invalid private key.`, { parse_mode: 'Markdown' });
        return false;
    }
}

// ======================== TELEGRAM CALLBACK HANDLER ========================
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const action = callbackQuery.data;

    if (!isAdmin(chatId)) {
        bot.answerCallbackQuery(callbackQuery.id, { text: "⛔ Unauthorized", show_alert: true }).catch(() => { });
        return;
    }
    if (isRateLimited(chatId)) {
        bot.answerCallbackQuery(callbackQuery.id, { text: "⏳ Please wait", show_alert: false }).catch(() => { });
        return;
    }
    // Catch stale callback query errors ("query is too old")
    bot.answerCallbackQuery(callbackQuery.id).catch(() => { });

    // Engine control
    if (action === 'start_cycles') startEngine(chatId);
    else if (action === 'stop_cycles') {
        STATE.running = false;
        bot.sendMessage(chatId, `🛑 Stopping after current action...`, { parse_mode: 'Markdown' });
    }
    // Navigation
    else if (action === 'strategies') showStrategyMenu(chatId);
    else if (action === 'settings') showSettingsMenu(chatId);
    else if (action === 'settings_basic') showBasicSettings(chatId);
    else if (action === 'settings_advanced') showAdvancedSettings(chatId);
    else if (action === 'settings_strat') showStrategyMenu(chatId);
    else if (action === 'show_realism') showRealismMenu(chatId);
    else if (action === 'settings_jito') showJitoSettings(chatId);
    else if (action === 'stealth_settings') showStealthSettings(chatId);
    else if (action === 'provider_settings') showProviderMenu(chatId);
    else if (action === 'select_dex') showDexMenu(chatId);
    else if (action === 'wallet_pool') showWalletPoolMenu(chatId);
    else if (action === 'back_to_main') showMainMenu(chatId);
    else if (action === 'help') showHelp(chatId);
    else if (action === 'status') await showDashboard(chatId);
    else if (action === 'show_wallet') showWallet(chatId);
    else if (action === 'smart_sell_menu') showSmartSellMenu(chatId);

    // Strategy selection
    else if (action.startsWith('strat_')) {
        const stratMap = {
            'strat_standard': 'STANDARD', 'strat_maker': 'MAKER', 'strat_web': 'WEB_OF_ACTIVITY',
            'strat_spam': 'SPAM', 'strat_pumpdump': 'PUMP_DUMP', 'strat_chart': 'CHART_PATTERN',
            'strat_holder': 'HOLDER_GROWTH', 'strat_whale': 'WHALE', 'strat_volume': 'VOLUME_BOOST',
            'strat_trending': 'TRENDING', 'strat_mev_wash': 'JITO_MEV_WASH', 'strat_kol': 'KOL_ALPHA_CALL',
            'strat_bull': 'BULL_TRAP', 'strat_airdrop': 'SOCIAL_PROOF_AIRDROP',
            'strat_ladder': 'LADDER', 'strat_sniper': 'SNIPER', 'strat_adv_wash': 'ADV_WASH',
            'strat_mirror': 'MIRROR_WHALE', 'strat_curve': 'CURVE_PUMP'
        };
        STATE.strategy = stratMap[action] || 'STANDARD';
        saveConfig();
        bot.sendMessage(chatId, `✅ Strategy: *${STATE.strategy}*`, { parse_mode: 'Markdown' });
        showStrategyMenu(chatId);
    }

    // Provider & DEX
    else if (action === 'prov_tracker') { STATE.swapProvider = 'SOLANA_TRACKER'; saveConfig(); bot.sendMessage(chatId, `✅ Provider: *SolanaTracker*`, { parse_mode: 'Markdown' }); showProviderMenu(chatId); }
    else if (action === 'prov_trade') { STATE.swapProvider = 'SOLANA_TRADE'; saveConfig(); bot.sendMessage(chatId, `✅ Provider: *SolanaTrade*`, { parse_mode: 'Markdown' }); showProviderMenu(chatId); }
    else if (action.startsWith('dex_')) { STATE.targetDex = action.replace('dex_', ''); saveConfig(); bot.sendMessage(chatId, `✅ DEX: *${STATE.targetDex}*`, { parse_mode: 'Markdown' }); showDexMenu(chatId); }

    // Basic settings
    else if (action === 'set_token_address') {
        promptSetting(chatId, `Reply with *Token CA*:`, (val) => {
            try { STATE.tokenAddress = validateTokenAddress(val); saveConfig(); bot.sendMessage(chatId, `✅ Token: \`${STATE.tokenAddress}\``, { parse_mode: "Markdown" }); } catch (e) { bot.sendMessage(chatId, `❌ ${e.message}`, { parse_mode: "Markdown" }); }
            showBasicSettings(chatId);
        });
    }
    else if (action === 'set_min_buy') {
        promptSetting(chatId, `Reply with *Min Buy* SOL (0.0005-10):`, (val) => {
            try { STATE.minBuyAmount = validateNumber(val, 0.0005, 10, "Min Buy"); saveConfig(); bot.sendMessage(chatId, `✅ Min Buy: \`${STATE.minBuyAmount}\` SOL`); } catch (e) { bot.sendMessage(chatId, `❌ ${e.message}`); }
            showBasicSettings(chatId);
        });
    }
    else if (action === 'set_max_buy') {
        promptSetting(chatId, `Reply with *Max Buy* SOL (0.0005-10):`, (val) => {
            try { STATE.maxBuyAmount = validateNumber(val, 0.0005, 10, "Max Buy"); if (STATE.maxBuyAmount < STATE.minBuyAmount) throw new Error("Max must be >= Min"); saveConfig(); bot.sendMessage(chatId, `✅ Max Buy: \`${STATE.maxBuyAmount}\` SOL`); } catch (e) { bot.sendMessage(chatId, `❌ ${e.message}`); }
            showBasicSettings(chatId);
        });
    }
    else if (action === 'set_cycles') {
        promptSetting(chatId, `Reply with *Cycles* (1-1000):`, (val) => {
            try { STATE.numberOfCycles = validateNumber(val, 1, 1000, "Cycles"); saveConfig(); bot.sendMessage(chatId, `✅ Cycles: \`${STATE.numberOfCycles}\``); } catch (e) { bot.sendMessage(chatId, `❌ ${e.message}`); }
            showBasicSettings(chatId);
        });
    }
    else if (action === 'set_jitter') {
        promptSetting(chatId, `Reply with *Jitter %* (0-100):`, (val) => {
            try { STATE.jitterPercentage = validateNumber(val, 0, 100, "Jitter"); saveConfig(); bot.sendMessage(chatId, `✅ Jitter: \`${STATE.jitterPercentage}%\``); } catch (e) { bot.sendMessage(chatId, `❌ ${e.message}`); }
            showBasicSettings(chatId);
        });
    }
    else if (action === 'set_interval') {
        promptSetting(chatId, `Reply with *Delay* seconds (1-300):`, (val) => {
            try { const sec = validateNumber(val, 1, 300, "Delay"); STATE.intervalBetweenActions = sec * 1000; saveConfig(); bot.sendMessage(chatId, `✅ Delay: \`${sec}s\``); } catch (e) { bot.sendMessage(chatId, `❌ ${e.message}`); }
            showBasicSettings(chatId);
        });
    }

    // Advanced settings
    else if (action === 'set_fees') {
        promptSetting(chatId, `Reply with *Priority Fee* SOL (0-0.01):`, (val) => {
            try { STATE.priorityFee = validateNumber(val, 0, 0.01, "Priority Fee"); saveConfig(); bot.sendMessage(chatId, `✅ Fee: \`${STATE.priorityFee}\` SOL`); } catch (e) { bot.sendMessage(chatId, `❌ ${e.message}`); }
            showAdvancedSettings(chatId);
        });
    }
    else if (action === 'set_slippage') {
        promptSetting(chatId, `Reply with *Slippage %* (0.5-50):`, (val) => {
            try { STATE.slippage = validateNumber(val, 0.5, 50, "Slippage"); saveConfig(); bot.sendMessage(chatId, `✅ Slippage: \`${STATE.slippage}%\``); } catch (e) { bot.sendMessage(chatId, `❌ ${e.message}`); }
            showAdvancedSettings(chatId);
        });
    }
    else if (action === 'set_batch_concurrency') {
        promptSetting(chatId, `Reply with *Concurrency* (1-100):`, (val) => {
            STATE.batchConcurrency = Math.max(1, Math.min(100, parseInt(val))); saveConfig(); bot.sendMessage(chatId, `✅ Concurrency: \`${STATE.batchConcurrency}\``); showAdvancedSettings(chatId);
        });
    }
    else if (action === 'set_wallets_per_cycle') {
        promptSetting(chatId, `Reply with *Wallets/Cycle* (1-1000):`, (val) => {
            STATE.walletsPerCycle = Math.max(1, parseInt(val)); saveConfig(); bot.sendMessage(chatId, `✅ Wallets/Cycle: \`${STATE.walletsPerCycle}\``); showAdvancedSettings(chatId);
        });
    }
    else if (action === 'set_sync') {
        promptSetting(chatId, `Reply with *Buys Sells* (e.g. \`2 2\`):`, (val) => {
            const parts = val.trim().split(/\s+/);
            if (parts.length >= 2) {
                STATE.maxSimultaneousBuys = parseInt(parts[0]);
                STATE.maxSimultaneousSells = parseInt(parts[1]);
                saveConfig();
                bot.sendMessage(chatId, `✅ Sync: \`${STATE.maxSimultaneousBuys}\` buys / \`${STATE.maxSimultaneousSells}\` sells`);
            } else { bot.sendMessage(chatId, `❌ Format: \`buys sells\` (e.g. \`2 2\`)`); }
            showAdvancedSettings(chatId);
        });
    }

    // Jito
    else if (action === 'set_jito') { STATE.useJito = !STATE.useJito; saveConfig(); bot.sendMessage(chatId, `✅ Jito: *${STATE.useJito ? 'ON' : 'OFF'}*`, { parse_mode: 'Markdown' }); showJitoSettings(chatId); }
    else if (action === 'set_jito_tip') {
        promptSetting(chatId, `Reply with *Jito Tip* SOL (0.00001-0.1):`, (val) => {
            try { STATE.jitoTipAmount = validateNumber(val, 0.00001, 0.1, "Jito Tip"); saveConfig(); bot.sendMessage(chatId, `✅ Tip: \`${STATE.jitoTipAmount}\` SOL`); } catch (e) { bot.sendMessage(chatId, `❌ ${e.message}`); }
            showJitoSettings(chatId);
        });
    }

    // Realism toggles
    else if (action === 'toggle_realism') { STATE.realismMode = !STATE.realismMode; saveConfig(); showRealismMenu(chatId); }
    else if (action === 'toggle_delays') { STATE.humanizedDelays = !STATE.humanizedDelays; saveConfig(); showRealismMenu(chatId); }
    else if (action === 'toggle_varslip') { STATE.variableSlippage = !STATE.variableSlippage; saveConfig(); showRealismMenu(chatId); }
    else if (action === 'toggle_poisson') { STATE.usePoissonTiming = !STATE.usePoissonTiming; saveConfig(); showRealismMenu(chatId); }
    else if (action === 'toggle_vol_curve') { STATE.useVolumeCurve = !STATE.useVolumeCurve; saveConfig(); showRealismMenu(chatId); }

    // Stealth toggles
    else if (action === 'toggle_web_funding') { STATE.useWebFunding = !STATE.useWebFunding; saveConfig(); bot.sendMessage(chatId, `✅ Web Funding: ${STATE.useWebFunding ? 'ON' : 'OFF'}`); showStealthSettings(chatId); }
    else if (action === 'toggle_stealth_level') { STATE.fundingStealthLevel = STATE.fundingStealthLevel === 2 ? 1 : 2; saveConfig(); bot.sendMessage(chatId, `✅ Stealth: ${STATE.fundingStealthLevel === 2 ? 'Multi-hop' : 'Direct'}`); showStealthSettings(chatId); }
    else if (action === 'set_maker_depth') {
        promptSetting(chatId, `Reply with *Hop Depth* (1-5):`, (val) => {
            try { STATE.makerFundingChainDepth = validateNumber(val, 1, 5, "Depth"); saveConfig(); bot.sendMessage(chatId, `✅ Depth: \`${STATE.makerFundingChainDepth}\``); } catch (e) { bot.sendMessage(chatId, `❌ ${e.message}`); }
            showStealthSettings(chatId);
        });
    }

    // Wallet pool operations
    else if (action === 'pool_generate') {
        promptSetting(chatId, `🔨 Generate wallets (e.g. \`1000\`, \`10000\`):\n\nCurrent pool: \`${walletManager.size}\``, async (val) => {
            const count = parseInt(val);
            if (isNaN(count) || count <= 0) return bot.sendMessage(chatId, `❌ Invalid number.`);
            if (count > 100000) return bot.sendMessage(chatId, `❌ Max 100,000 per generation.`);
            bot.sendMessage(chatId, `⏳ Generating ${count.toLocaleString()}...`);
            const generated = await walletManager.generateWallets?.(count) || count;
            bot.sendMessage(chatId, `✅ Generated *${generated.toLocaleString()}*!\nTotal: *${walletManager.size.toLocaleString()}*`, { parse_mode: 'Markdown' });
            showWalletPoolMenu(chatId);
        });
    }
    else if (action === 'pool_fund') {
        if (walletManager.size === 0) return bot.sendMessage(chatId, `❌ No wallets. Generate first!`);
        if (!masterKeypair) return bot.sendMessage(chatId, `❌ No master wallet.`);
        const estCost = (walletManager.size * STATE.fundAmountPerWallet).toFixed(2);
        promptSetting(chatId, `💰 *Fund Pool*\n\nWallets: \`${walletManager.size}\`\nPer wallet: \`${STATE.fundAmountPerWallet}\` SOL\n*Est. cost: \`${estCost}\` SOL*\n\nReply \`YES\` to confirm:`, async (val) => {
            if (val.toUpperCase() !== 'YES') return bot.sendMessage(chatId, `❌ Cancelled.`);
            await withRpcFallback(async (connection) => {
                bot.sendMessage(chatId, `💰 Funding ${walletManager.size} wallets...`);
                // Manual funding should only check for shutdown, not if a strategy is "running"
                const result = await walletManager.fundAll(connection, masterKeypair, sendSOL, STATE.fundAmountPerWallet, STATE.batchConcurrency, null, () => !isShuttingDown, STATE.useWebFunding, STATE.fundingStealthLevel, STATE.makerFundingChainDepth);
                bot.sendMessage(chatId, `✅ Funding complete. ${result.successes} succeeded, ${result.failures} failed.`);
                showWalletPoolMenu(chatId);
            });
        });
    }
    else if (action === 'pool_drain') {
        if (walletManager.size === 0) return bot.sendMessage(chatId, `❌ No wallets.`);
        if (!masterKeypair) return bot.sendMessage(chatId, `❌ No master wallet.`);
        promptSetting(chatId, `🔄 *Drain Pool*\n\nReply \`YES\` to confirm:`, async (val) => {
            if (val.toUpperCase() !== 'YES') return bot.sendMessage(chatId, `❌ Cancelled.`);
            await withRpcFallback(async (connection) => {
                bot.sendMessage(chatId, `🔄 Draining ${walletManager.size} wallets...`);
                // Manual draining should only check for shutdown, not if a strategy is "running"
                await walletManager.drainAll(connection, masterKeypair, sendSOL, STATE.batchConcurrency, null, () => !isShuttingDown);
                showWalletPoolMenu(chatId);
            });
        });
    }
    else if (action === 'pool_scan') {
        await withRpcFallback(async (connection) => {
            bot.sendMessage(chatId, `📊 Scanning ${walletManager.size} wallets...`);
            
            // Scan with details enabled
            const scan = await walletManager.scanBalances(connection, 30, true);
            
            // Build summary message
            let message = `📊 *Scan Complete*\n\n`;
            message += `Total SOL: \`${scan.totalSOL.toFixed(4)}\`\n`;
            message += `Funded: \`${scan.funded}\` | Empty: \`${scan.empty}\`\n`;
            message += `Duration: \`${scan.duration}s\`\n\n`;
            
            // Add detailed wallet list (limit to prevent message too long)
            const maxWalletsToShow = 20;
            if (scan.walletDetails && scan.walletDetails.length > 0) {
                message += `*Wallet Details:*\n`;
                
                const walletsToShow = scan.walletDetails.slice(0, maxWalletsToShow);
                for (const wallet of walletsToShow) {
                    const addr = wallet.address.substring(0, 8) + '...' + wallet.address.substring(wallet.address.length - 4);
                    message += `${wallet.status} \`${addr}\` | ${wallet.balance.toFixed(6)} SOL\n`;
                }
                
                if (scan.walletDetails.length > maxWalletsToShow) {
                    message += `\n_...and ${scan.walletDetails.length - maxWalletsToShow} more wallets_\n`;
                }
                
                // Add summary by status
                message += `\n*Summary:*\n`;
                message += `✅ Funded (≥0.0021 SOL): ${scan.funded}\n`;
                message += `❌ Empty (<0.0021 SOL): ${scan.empty}\n`;
            }
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            showWalletPoolMenu(chatId);
        });
    }
    else if (action === 'pool_toggle') { STATE.useWalletPool = !STATE.useWalletPool; saveConfig(); bot.sendMessage(chatId, `✅ Pool Mode: *${STATE.useWalletPool ? 'ON' : 'OFF'}*`, { parse_mode: 'Markdown' }); showWalletPoolMenu(chatId); }
    
    // Aging system callbacks
    else if (action === 'aging_stats') {
        if (!STATE.useWalletPool) {
            return bot.sendMessage(chatId, `❌ Aging system only works with Wallet Pool mode enabled.`);
        }
        
        const stats = walletManager.getAgingStats();
        const enabled = walletManager.agingEnabled ? '🟢 ENABLED' : '🔴 DISABLED';
        
        bot.sendMessage(chatId, 
            `📊 *Wallet Aging Statistics*\n\n` +
            `Status: ${enabled}\n` +
            `Total Wallets: ${stats.total || 0}\n\n` +
            `*Age Distribution:*\n` +
            `🏆 Veteran (90+ days): ${stats.VETERAN || 0}\n` +
            `🌳 Mature (30-90 days): ${stats.MATURE || 0}\n` +
            `🌿 Seasoned (7-30 days): ${stats.SEASONED || 0}\n` +
            `🌱 Young (1-7 days): ${stats.YOUNG || 0}\n` +
            `🆕 Fresh (0-1 day): ${stats.FRESH || 0}\n\n` +
            `*Performance:*\n` +
            `Avg Trust Score: ${(stats.avgTrustScore || 0).toFixed(2)}\n` +
            `Total Trades: ${stats.totalTrades || 0}\n` +
            `Total Volume: ${(stats.totalVolume || 0).toFixed(4)} SOL`,
            { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `${walletManager.agingEnabled ? '🔴 Disable' : '🟢 Enable'} Aging`, callback_data: 'aging_toggle' }],
                        [{ text: '« Back', callback_data: 'wallet_pool' }]
                    ]
                }
            }
        );
    }
    else if (action === 'aging_toggle') {
        walletManager.setAgingEnabled(!walletManager.agingEnabled);
        bot.sendMessage(chatId, `✅ Aging System: *${walletManager.agingEnabled ? 'ENABLED' : 'DISABLED'}*`, { parse_mode: 'Markdown' });
    }
    else if (action === 'aging_season') {
        if (!STATE.useWalletPool) {
            return bot.sendMessage(chatId, `❌ Seasoning only works with Wallet Pool mode enabled.`);
        }
        
        if (walletManager.size === 0) {
            return bot.sendMessage(chatId, `❌ No wallets to season. Generate wallets first!`);
        }
        
        bot.sendMessage(chatId, 
            `🌱 *Season Wallets*\n\n` +
            `Seasoning builds organic trading history.\n\n` +
            `Reply with wallet count (e.g. \`50\`):`,
            { parse_mode: 'Markdown' }
        );
        
        promptSetting(chatId, `Enter number of wallets to season:`, async (val) => {
            const count = parseInt(val);
            if (isNaN(count) || count <= 0) {
                return bot.sendMessage(chatId, `❌ Invalid count.`);
            }
            
            const walletsToSeason = walletManager.getRandomSubset(Math.min(count, walletManager.size));
            
            try {
                const connection = getConnection();
                
                // Check master wallet balance first
                const masterBalance = await connection.getBalance(masterKeypair.publicKey) / LAMPORTS_PER_SOL;
                const fundAmount = 0.01; // 0.01 SOL per wallet for seasoning
                const totalNeeded = walletsToSeason.length * fundAmount + 0.01; // +0.01 buffer
                
                if (masterBalance < totalNeeded) {
                    return bot.sendMessage(chatId, 
                        `❌ *Insufficient Master Wallet Balance*\n\n` +
                        `Required: \`${totalNeeded.toFixed(4)}\` SOL\n` +
                        `Available: \`${masterBalance.toFixed(4)}\` SOL\n` +
                        `Shortage: \`${(totalNeeded - masterBalance).toFixed(4)}\` SOL\n\n` +
                        `Please fund your master wallet first.`,
                        { parse_mode: 'Markdown' }
                    );
                }
                
                bot.sendMessage(chatId, 
                    `🌱 *Starting Wallet Seasoning*\n\n` +
                    `Wallets: ${walletsToSeason.length}\n` +
                    `Fund Amount: ${fundAmount} SOL each\n` +
                    `Total Cost: ~${totalNeeded.toFixed(4)} SOL\n\n` +
                    `Step 1/3: Funding wallets...`,
                    { parse_mode: 'Markdown' }
                );
                
                // Fund wallets (no checkRunning - this is a manual operation)
                const fundResult = await walletManager.fundWallets(walletsToSeason, {
                    connection,
                    masterKeypair,
                    sendSOLFn: sendSOL,
                    amountSOL: fundAmount,
                    concurrency: STATE.batchConcurrency,
                    progressCb: (prog) => {
                        if (prog.successes % 5 === 0 || prog.successes === prog.total) {
                            bot.sendMessage(chatId, `💰 Funding: ${prog.successes}/${prog.total} (${Math.round((prog.successes/prog.total)*100)}%)`).catch(() => {});
                        }
                    },
                    checkRunning: () => true // Always continue for manual seasoning
                });
                
                if (fundResult.successes === 0) {
                    return bot.sendMessage(chatId, 
                        `❌ *Funding Failed*\n\n` +
                        `All ${walletsToSeason.length} wallets failed to fund.\n` +
                        `This might be due to:\n` +
                        `• RPC connection issues\n` +
                        `• Network congestion\n` +
                        `• Insufficient master wallet balance\n\n` +
                        `Please try again.`,
                        { parse_mode: 'Markdown' }
                    );
                }
                
                if (fundResult.failures > walletsToSeason.length / 2) {
                    return bot.sendMessage(chatId, 
                        `⚠️ *Partial Funding Failure*\n\n` +
                        `Funded: ${fundResult.successes}/${walletsToSeason.length}\n` +
                        `Failed: ${fundResult.failures}\n\n` +
                        `Too many failures. Aborting seasoning.\n` +
                        `Try reducing wallet count or checking RPC.`,
                        { parse_mode: 'Markdown' }
                    );
                }
                
                bot.sendMessage(chatId, 
                    `✅ *Funding Complete*\n\n` +
                    `Funded: ${fundResult.successes}/${walletsToSeason.length}\n` +
                    `Failed: ${fundResult.failures}\n\n` +
                    `Step 2/3: Seasoning wallets...`,
                    { parse_mode: 'Markdown' }
                );
                
                // Now season the wallets with liquid tokens (USDC/USDT)
                const result = await SeasoningEngine.quickSeason(
                    walletsToSeason,
                    connection,
                    masterKeypair,
                    async (fromToken, toToken, wallet, conn, amount, chatId, silent) => {
                        // Wrapper to pass through swap function
                        return await swap(fromToken, toToken, wallet, conn, amount, chatId, silent);
                    },
                    {
                        activitiesPerWallet: 2,
                        minAmount: 0.001,
                        maxAmount: 0.005,
                        useLiquidTokens: true, // Use USDC/USDT/mSOL/stSOL for reliable swaps
                        progressCb: (progress) => {
                            if (progress.completed % 5 === 0 || progress.completed === progress.total) {
                                bot.sendMessage(chatId, `🌱 Seasoning: ${progress.completed}/${progress.total} (${progress.percent}%)`).catch(() => {});
                            }
                        }
                    }
                );
                
                bot.sendMessage(chatId, 
                    `✅ *Seasoning Complete*\n\n` +
                    `Activities: ${result.successes}/${result.total}\n` +
                    `Success Rate: ${Math.round((result.successes / result.total) * 100)}%\n\n` +
                    `Step 3/3: Draining remaining SOL...`,
                    { parse_mode: 'Markdown' }
                );
                
                // Drain remaining SOL back to master
                const drainResult = await walletManager.drainWallets(walletsToSeason, {
                    connection,
                    masterKeypair,
                    sendSOLFn: sendSOL,
                    concurrency: STATE.batchConcurrency,
                    progressCb: (prog) => {
                        if (prog.successes % 5 === 0 || prog.successes === prog.total) {
                            bot.sendMessage(chatId, `🔄 Draining: ${prog.successes}/${prog.total} (${Math.round((prog.successes/prog.total)*100)}%)`).catch(() => {});
                        }
                    }
                });
                
                // Calculate recovered SOL
                const recovered = drainResult.totalRecovered || 0;
                const netCost = (walletsToSeason.length * fundAmount) - recovered;
                
                bot.sendMessage(chatId, 
                    `🎉 *Wallet Seasoning Complete!*\n\n` +
                    `*Results:*\n` +
                    `Wallets Seasoned: ${walletsToSeason.length}\n` +
                    `Activities: ${result.successes}/${result.total}\n` +
                    `Success Rate: ${Math.round((result.successes / result.total) * 100)}%\n\n` +
                    `*Cost Analysis:*\n` +
                    `Funded: ${(walletsToSeason.length * fundAmount).toFixed(4)} SOL\n` +
                    `Recovered: ${recovered.toFixed(4)} SOL\n` +
                    `Net Cost: ${netCost.toFixed(4)} SOL\n\n` +
                    `Your wallets now have organic trading history! 🌱`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                logger.error(`Seasoning failed: ${error.message}`);
                bot.sendMessage(chatId, 
                    `❌ *Seasoning Failed*\n\n` +
                    `Error: ${error.message}\n\n` +
                    `This might be due to:\n` +
                    `• RPC connection issues\n` +
                    `• Network congestion\n` +
                    `• Token liquidity issues\n` +
                    `• Insufficient wallet balances\n\n` +
                    `Please check logs and try again.`,
                    { parse_mode: 'Markdown' }
                );
            }
        });
    }
    
    else if (action === 'pool_clear') {
        promptSetting(chatId, `⚠️ *Clear ALL ${walletManager.size} wallets?* Reply \`DELETE\` to confirm:`, (val) => {
            if (val.toUpperCase() !== 'DELETE') return bot.sendMessage(chatId, `❌ Cancelled.`);
            walletManager.clearAll?.(); bot.sendMessage(chatId, `✅ Pool cleared.`); showWalletPoolMenu(chatId);
        });
    }
    else if (action === 'set_fund_amount') {
        promptSetting(chatId, `Reply with *SOL per wallet* (e.g. \`0.01\`):`, (val) => {
            STATE.fundAmountPerWallet = parseFloat(val); saveConfig(); bot.sendMessage(chatId, `✅ Fund Amt: \`${STATE.fundAmountPerWallet}\` SOL/wallet`, { parse_mode: 'Markdown' }); showWalletPoolMenu(chatId);
        });
    }

    // Smart Sell callbacks
    else if (action === 'toggle_smart_sell') {
        STATE.smartSellEnabled = !STATE.smartSellEnabled;
        saveConfig();
        bot.sendMessage(chatId, `🧠 Smart Sell ${STATE.smartSellEnabled ? 'enabled' : 'disabled'}.`);
        if (STATE.running && STATE.smartSellEnabled && STATE.tokenAddress) {
            startSmartSellMonitor(getConnection(), STATE.tokenAddress);
        } else if (smartSellInterval && !STATE.smartSellEnabled) {
            clearInterval(smartSellInterval);
            smartSellInterval = null;
        }
        showSmartSellMenu(chatId);
    }
    else if (action === 'set_smart_percent') {
        promptSetting(chatId, `Reply with *Sell %* (1-100):`, (val) => {
            const p = parseFloat(val);
            if (isNaN(p) || p < 1 || p > 100) return bot.sendMessage(chatId, `❌ Enter 1-100.`);
            STATE.smartSellPercent = p;
            saveConfig();
            bot.sendMessage(chatId, `✅ Sell % set to ${p}%.`);
            showSmartSellMenu(chatId);
        });
    }
    else if (action === 'set_smart_max_wallets') {
        promptSetting(chatId, `Reply with *Max wallets* (1-100):`, (val) => {
            let m = parseInt(val);
            if (isNaN(m)) m = 50;
            STATE.smartSellMaxWallets = Math.min(100, Math.max(1, m));
            saveConfig();
            bot.sendMessage(chatId, `✅ Max wallets: ${STATE.smartSellMaxWallets}.`);
            showSmartSellMenu(chatId);
        });
    }
    else if (action === 'set_smart_min_buy') {
        promptSetting(chatId, `Reply with *Min buy SOL* to trigger (0.001-10):`, (val) => {
            let m = parseFloat(val);
            if (isNaN(m) || m < 0.001) m = 0.01;
            STATE.smartSellMinBuySOL = m;
            saveConfig();
            bot.sendMessage(chatId, `✅ Min buy SOL: ${STATE.smartSellMinBuySOL}.`);
            showSmartSellMenu(chatId);
        });
    }
    else if (action === 'set_smart_cooldown') {
        promptSetting(chatId, `Reply with *Cooldown seconds* (10-3600):`, (val) => {
            let sec = parseInt(val);
            if (isNaN(sec) || sec < 10) sec = 60;
            STATE.smartSellCooldownMs = sec * 1000;
            saveConfig();
            bot.sendMessage(chatId, `✅ Cooldown: ${sec}s per wallet.`);
            showSmartSellMenu(chatId);
        });
    }
    else if (action === 'set_smart_dev_wallet') {
        promptSetting(chatId, `🔑 Send the *private key* (base58) of the wallet you want to use for selling.\n\n⚠️ This key will be kept in memory only (not saved to config.json).`, async (privateKey) => {
            await setSmartSellDevWallet(privateKey, chatId);
            showSmartSellMenu(chatId);
        });
    }
    else if (action === 'clear_smart_dev_wallet') {
        STATE.smartSellDevWalletPubkey = "";
        STATE.smartSellDevWalletKeypair = null;
        saveConfig();
        bot.sendMessage(chatId, `🗑️ Dev wallet cleared. Smart Sell will now use random holder wallets.`, { parse_mode: 'Markdown' });
        showSmartSellMenu(chatId);
    }
});

// ─────────────────────────────────────────────
// 🚀 Bot Entry Point
// ─────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
    if (isAdmin(msg.chat.id)) showMainMenu(msg.chat.id);
    else bot.sendMessage(msg.chat.id, "⛔ Unauthorized access.", { parse_mode: 'Markdown' });
});

logger.info(`🚀 Volume Bot v3.2 started | Strategies: 19 | Wallets: ${walletManager.size.toLocaleString()}`);
logger.info(`🌐 RPC: ${RPC_URLS.length} | Jito: ${STATE.useJito ? 'ON' : 'OFF'} | Stealth: Level ${STATE.fundingStealthLevel}`);
logger.info(`🧠 Smart Sell: ${STATE.smartSellEnabled ? 'ENABLED' : 'DISABLED'} | Dev Wallet: ${STATE.smartSellDevWalletPubkey ? 'SET' : 'NOT SET'}`);

export { STATE, walletManager, swap, sendSOL, getTokenBalance, WalletPool, BatchSwapEngine, sendJitoBundle };