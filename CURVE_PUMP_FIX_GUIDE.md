# CURVE_PUMP Bonding Curve API Fix Guide

## Problem Summary

The CURVE_PUMP strategy was failing with "Assertion failed" errors when trying to fetch bonding curve data from the solana-trade library. All trades failed with 0% success rate due to:

1. **Assertion failures** from solana-trade API
2. **Invalid market/mint configuration** 
3. **Insufficient error diagnostics**
4. **No configuration validation**

## Root Causes

### 1. Assertion Failed Error
The error `Assertion failed` comes from inside the `solana-trade` library when:
- Token doesn't exist on the specified market
- Bonding curve hasn't been initialized
- Token has already graduated from the launchpad
- Market/mint combination is invalid

### 2. Configuration Issues
From your logs, the configuration was:
- **Market**: `RAYDIUM_LAUNCHPAD`
- **Token**: `7LpvxqijqTHHAYkyRA8mNarFezHHmQWXFNbGs8GW1ray`

This token may not actually be on Raydium Launchpad, or it has already graduated.

### 3. Stuck at 0% Curve
Because the API call failed on every attempt, the agent:
- Never knew the real curve state
- Stayed in RAMP_UP phase indefinitely
- Kept using cached 0% value
- Couldn't make informed trading decisions

## Fixes Applied

### 1. Enhanced Error Handling (`behaviors/curvePumpBehavior.js`)

#### Added Configuration Validation
```javascript
function validateMarketMintConfig(market, mint) {
    const BONDING_CURVE_MARKETS = [
        'PUMP_FUN', 'PUMP_SWAP', 'METEORA_DBC', 
        'RAYDIUM_LAUNCHPAD', 'MOONIT', 'HEAVEN', 
        'SUGAR', 'BOOP_FUN'
    ];
    
    // Validates market support and mint format
    // Returns { valid: boolean, error?: string }
}
```

#### Added Retry Logic with Exponential Backoff
```javascript
async function fetchCurveState(market, mint, rpcUrl, logger) {
    // Validates config before API call
    // Retries up to 3 times with exponential backoff
    // Distinguishes retryable vs non-retryable errors
    // Provides detailed error logging
}
```

#### Improved Error Diagnostics
- Logs full error details (message, stack, market, mint)
- Identifies configuration errors vs transient failures
- Pauses agent on fatal configuration errors
- Continues with cached data on transient errors

### 2. Configuration Validation on Agent Init
```javascript
if (!agent.curveConfigValidated) {
    agent.logger.info(`[CurvePump] Validating configuration...`);
    
    const validation = validateMarketMintConfig(market, mint);
    if (!validation.valid) {
        agent.logger.error(`[CurvePump] ❌ Configuration validation failed`);
        throw new Error(validation.error);
    }
    
    agent.curveConfigValidated = true;
}
```

### 3. Diagnostic Utility (`diagnostics/validateCurveConfig.js`)

New command-line tool to test configurations before running strategies:

```bash
node diagnostics/validateCurveConfig.js <market> <mint> [rpcUrl]
```

**Features:**
- Validates market support for bonding curves
- Checks mint address format
- Tests actual API call to solana-trade
- Provides detailed troubleshooting guidance
- 30-second timeout protection

## How to Use

### Step 1: Validate Your Configuration

Before running a CURVE_PUMP strategy, test your market/mint combination:

```bash
# Test with your token
node diagnostics/validateCurveConfig.js PUMP_FUN YourTokenMintAddress

# Test with custom RPC
node diagnostics/validateCurveConfig.js PUMP_FUN YourTokenMintAddress https://your-rpc.com
```

**Expected Output (Success):**
```
✅ Market: PUMP_FUN
✅ Mint: 7Lpvxqij...s8GW1ray
✅ API Call Successful (1234ms)
📊 Results:
   Price: 0.00001234 SOL
   Bonding Curve: 45.67%
✅ All Checks Passed - Configuration is Valid
```

**Expected Output (Failure):**
```
❌ API Call Failed
Error: Assertion failed
💡 Troubleshooting:
   - "Assertion failed" usually means:
     • Token does not exist on this market
     • Bonding curve has not been initialized yet
     • Market/mint combination is invalid
```

### Step 2: Fix Configuration Issues

If validation fails, check:

1. **Is the token on the correct market?**
   - PUMP_FUN tokens only work with `PUMP_FUN` market
   - Raydium tokens need `RAYDIUM_LAUNCHPAD` or `RAYDIUM_CPMM`
   - Check the token's actual DEX/launchpad

2. **Has the token graduated?**
   - Graduated tokens no longer have bonding curve data
   - Use regular DEX markets (RAYDIUM_AMM, ORCA_WHIRLPOOL, etc.)
   - Switch to a different strategy (STANDARD, MAKER, etc.)

3. **Is the mint address correct?**
   - Verify the token mint on Solscan or similar
   - Ensure no typos in the address

### Step 3: Update Your Strategy Configuration

Edit `multi_strategies.json` or create a new strategy with correct settings:

```json
{
  "config": {
    "tokenAddress": "YourValidTokenMint",
    "targetDex": "PUMP_FUN",  // Must match where token actually is
    "curveTargetPercent": 80,
    "swapProvider": "SOLANA_TRADE"
  }
}
```

### Step 4: Use Premium RPC (Recommended)

The public RPC endpoint is rate-limited. For production use:

1. Get a premium RPC from:
   - Helius (https://helius.dev)
   - QuickNode (https://quicknode.com)
   - Alchemy (https://alchemy.com)

2. Add to `.env`:
   ```
   RPC_URL=https://your-premium-rpc-endpoint.com
   ```

3. Pass to validator:
   ```bash
   node diagnostics/validateCurveConfig.js PUMP_FUN YourToken $RPC_URL
   ```

## Valid Markets for Bonding Curves

Only these markets support bonding curve data:

| Market | Description |
|--------|-------------|
| `PUMP_FUN` | Pump.fun launchpad |
| `PUMP_SWAP` | PumpSwap DEX |
| `METEORA_DBC` | Meteora Dynamic Bonding Curve |
| `RAYDIUM_LAUNCHPAD` | Raydium Launchpad |
| `MOONIT` | Moonit launchpad |
| `HEAVEN` | Heaven.xyz |
| `SUGAR` | Sugar.money |
| `BOOP_FUN` | Boop.fun |

**Note:** Regular DEX markets (RAYDIUM_AMM, ORCA_WHIRLPOOL, etc.) do NOT support bonding curves.

## Error Messages Explained

### "Assertion failed"
**Cause:** Token doesn't exist on the specified market or has graduated.

**Fix:** 
- Verify token is on the correct market
- Check if token has graduated (use regular DEX market instead)
- Validate mint address is correct

### "Configuration error: Market 'X' does not support bonding curves"
**Cause:** You're using a regular DEX market with CURVE_PUMP strategy.

**Fix:**
- Use a launchpad market (PUMP_FUN, METEORA_DBC, etc.)
- Or switch to a different strategy (STANDARD, MAKER, etc.)

### "429 Too Many Requests"
**Cause:** RPC rate limiting.

**Fix:**
- Use a premium RPC endpoint
- Reduce request frequency
- Increase cache TTL in behavior config

### "API call timeout after 30 seconds"
**Cause:** RPC endpoint is slow or unresponsive.

**Fix:**
- Try a different RPC endpoint
- Check network connectivity
- Use a geographically closer RPC

## Monitoring and Debugging

### Check Agent Logs
Look for these key log messages:

```
✅ [CurvePump] Configuration validated successfully
✅ [CurvePump] Curve: 0.0% → 15.3% (+15.3%) | Price: 0.00001234 SOL
❌ [CurvePump] Failed to fetch curve state: Assertion failed
```

### Agent State Transitions
- **ACTIVE** → Normal operation
- **DEGRADED** → 3+ consecutive failures
- **PAUSED** → 6+ consecutive failures or fatal config error
- **FAILED** → Unrecoverable error

### Success Indicators
- Curve percent updates regularly (not stuck at 0%)
- Phase transitions occur (RAMP_UP → SUSTAIN → ACCELERATE)
- Trades execute successfully
- Balance changes detected

## Best Practices

1. **Always validate before running**
   ```bash
   node diagnostics/validateCurveConfig.js <market> <mint>
   ```

2. **Use premium RPC for production**
   - Public endpoints are rate-limited
   - Premium endpoints are faster and more reliable

3. **Monitor the first few cycles**
   - Check logs for curve % updates
   - Verify trades are executing
   - Watch for error patterns

4. **Match market to token reality**
   - Don't assume a token is on a specific market
   - Verify on blockchain explorers
   - Check the token's official channels

5. **Fund wallets adequately**
   - Each trade needs ~0.02-0.03 SOL
   - Include buffer for fees and rent
   - Monitor wallet balances

## Troubleshooting Checklist

- [ ] Ran validation tool successfully
- [ ] Token exists on the specified market
- [ ] Token hasn't graduated yet
- [ ] Mint address is correct (no typos)
- [ ] Using a supported bonding curve market
- [ ] RPC endpoint is responsive
- [ ] Wallets are funded with sufficient SOL
- [ ] No rate limiting errors (429)
- [ ] Logs show curve % updates (not stuck at 0%)

## Support

If issues persist after following this guide:

1. Run the diagnostic tool and save output
2. Check logs for detailed error messages
3. Verify token on blockchain explorer
4. Test with a known-good token (e.g., a recent PUMP_FUN launch)
5. Try a different RPC endpoint

## Summary of Changes

**Files Modified:**
- `behaviors/curvePumpBehavior.js` - Enhanced error handling, validation, retry logic
- `diagnostics/validateCurveConfig.js` - New diagnostic utility (created)
- `CURVE_PUMP_FIX_GUIDE.md` - This documentation (created)

**Key Improvements:**
- ✅ Configuration validation before API calls
- ✅ Retry logic with exponential backoff
- ✅ Detailed error diagnostics and logging
- ✅ Distinction between fatal and transient errors
- ✅ Command-line validation tool
- ✅ Comprehensive troubleshooting guide
