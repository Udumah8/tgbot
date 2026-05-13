/**
 * diagnostics/validateCurveConfig.js
 * 
 * Diagnostic utility to validate bonding curve configuration
 * before running CURVE_PUMP strategies.
 * 
 * Usage:
 *   node diagnostics/validateCurveConfig.js <market> <mint> [rpcUrl]
 * 
 * Example:
 *   node diagnostics/validateCurveConfig.js PUMP_FUN TokenMintAddress123...
 */

import { SolanaTrade } from 'solana-trade';
import dotenv from 'dotenv';

dotenv.config();

const BONDING_CURVE_MARKETS = [
    'PUMP_FUN',
    'PUMP_SWAP',
    'METEORA_DBC',
    'RAYDIUM_LAUNCHPAD',
    'MOONIT',
    'HEAVEN',
    'SUGAR',
    'BOOP_FUN'
];

/**
 * Validate market and mint configuration
 */
function validateConfig(market, mint) {
    console.log('\n🔍 Validating Configuration...\n');
    
    const errors = [];
    const warnings = [];

    // Check market
    if (!market) {
        errors.push('❌ Market is undefined or empty');
    } else if (!BONDING_CURVE_MARKETS.includes(market)) {
        errors.push(`❌ Market '${market}' does not support bonding curves`);
        warnings.push(`   Valid markets: ${BONDING_CURVE_MARKETS.join(', ')}`);
    } else {
        console.log(`✅ Market: ${market}`);
    }

    // Check mint
    if (!mint) {
        errors.push('❌ Mint address is undefined or empty');
    } else if (typeof mint !== 'string' || mint.length < 32 || mint.length > 44) {
        errors.push(`❌ Invalid mint address format: ${mint}`);
        warnings.push('   Mint should be a base58 string (32-44 characters)');
    } else {
        console.log(`✅ Mint: ${mint.slice(0, 8)}...${mint.slice(-8)}`);
    }

    return { errors, warnings, valid: errors.length === 0 };
}

/**
 * Test API call to solana-trade
 */
async function testApiCall(market, mint, rpcUrl) {
    console.log('\n🌐 Testing API Call...\n');
    console.log(`RPC: ${rpcUrl.slice(0, 50)}...`);
    
    try {
        const trader = new SolanaTrade(rpcUrl);
        
        console.log('⏳ Fetching price and bonding curve data...');
        const startTime = Date.now();
        
        // Add timeout wrapper
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('API call timeout after 30 seconds')), 30000);
        });
        
        const apiPromise = trader.price({
            market,
            mint,
            unit: 'SOL',
        });
        
        const result = await Promise.race([apiPromise, timeoutPromise]);
        
        const duration = Date.now() - startTime;
        
        console.log(`\n✅ API Call Successful (${duration}ms)\n`);
        console.log('📊 Results:');
        console.log(`   Price: ${result.price || 'N/A'} SOL`);
        console.log(`   Bonding Curve: ${result.bondingCurvePercent !== null ? result.bondingCurvePercent.toFixed(2) + '%' : 'N/A (not a bonding curve market)'}`);
        
        if (result.bondingCurvePercent === null) {
            console.log('\n⚠️  Warning: bondingCurvePercent is null');
            console.log('   This could mean:');
            console.log('   - Token is not on a bonding curve market');
            console.log('   - Token has already graduated');
            console.log('   - Market does not support bonding curves');
        }
        
        return { success: true, result };
        
    } catch (error) {
        console.log('\n❌ API Call Failed\n');
        console.log('Error:', error.message);
        
        if (error.stack && !error.message.includes('timeout')) {
            console.log('\nStack Trace (first 500 chars):');
            console.log(error.stack.slice(0, 500));
        }
        
        console.log('\n💡 Troubleshooting:');
        
        if (error.message.includes('timeout')) {
            console.log('   - API call timed out after 30 seconds');
            console.log('     • RPC endpoint may be slow or unresponsive');
            console.log('     • Try a premium RPC endpoint');
            console.log('     • Check network connectivity');
        }
        
        if (error.message.includes('Assertion')) {
            console.log('   - "Assertion failed" usually means:');
            console.log('     • Token does not exist on this market');
            console.log('     • Bonding curve has not been initialized yet');
            console.log('     • Market/mint combination is invalid');
            console.log('     • Token may have already graduated from launchpad');
        }
        
        if (error.message.includes('429') || error.message.includes('rate limit')) {
            console.log('   - RPC rate limiting detected');
            console.log('     • Use a premium RPC endpoint');
            console.log('     • Reduce request frequency');
        }
        
        if (error.message.includes('network') || error.message.includes('ECONNREFUSED')) {
            console.log('   - Network connectivity issue');
            console.log('     • Check your internet connection');
            console.log('     • Try a different RPC endpoint');
        }
        
        return { success: false, error };
    }
}

/**
 * Main diagnostic function
 */
async function runDiagnostics() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  Bonding Curve Configuration Validator');
    console.log('═══════════════════════════════════════════════════');
    
    // Parse arguments
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.log('\n❌ Usage: node validateCurveConfig.js <market> <mint> [rpcUrl]\n');
        console.log('Example:');
        console.log('  node diagnostics/validateCurveConfig.js PUMP_FUN TokenMintAddress123...\n');
        console.log('Valid Markets:');
        BONDING_CURVE_MARKETS.forEach(m => console.log(`  - ${m}`));
        process.exit(1);
    }
    
    const market = args[0];
    const mint = args[1];
    const rpcUrl = args[2] || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    
    // Step 1: Validate configuration
    const validation = validateConfig(market, mint);
    
    if (validation.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        validation.warnings.forEach(w => console.log(w));
    }
    
    if (!validation.valid) {
        console.log('\n❌ Configuration Errors:');
        validation.errors.forEach(e => console.log(e));
        console.log('\n❌ Validation Failed - Fix errors before proceeding\n');
        process.exit(1);
    }
    
    // Step 2: Test API call
    const apiTest = await testApiCall(market, mint, rpcUrl);
    
    // Final summary
    console.log('\n═══════════════════════════════════════════════════');
    if (apiTest.success) {
        console.log('✅ All Checks Passed - Configuration is Valid');
        console.log('═══════════════════════════════════════════════════\n');
        process.exit(0);
    } else {
        console.log('❌ Validation Failed - See errors above');
        console.log('═══════════════════════════════════════════════════\n');
        process.exit(1);
    }
}

// Run diagnostics
runDiagnostics().catch(error => {
    console.error('\n💥 Unexpected Error:', error);
    process.exit(1);
});
