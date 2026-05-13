# CURVE_PUMP Quick Fix Summary

## The Problem
Your CURVE_PUMP strategy failed with "Assertion failed" errors because:
- Token `7LpvxqijqTHHAYkyRA8mNarFezHHmQWXFNbGs8GW1ray` may not exist on `RAYDIUM_LAUNCHPAD`
- Or it has already graduated from the launchpad
- The solana-trade API couldn't find bonding curve data

## Quick Fix Steps

### 1. Validate Your Configuration (30 seconds)
```bash
node diagnostics/validateCurveConfig.js RAYDIUM_LAUNCHPAD 7LpvxqijqTHHAYkyRA8mNarFezHHmQWXFNbGs8GW1ray
```

This will tell you if the market/mint combination is valid.

### 2. If Validation Fails

**Option A: Find the Correct Market**
- Check where your token actually exists (Solscan, Birdeye, etc.)
- Update `targetDex` in your strategy config to match

**Option B: Use a Different Token**
- Find a token that's currently on a bonding curve
- Recent PUMP_FUN launches are good candidates
- Update `tokenAddress` in your strategy config

**Option C: Switch Strategy**
- If token has graduated, use STANDARD or MAKER strategy instead
- CURVE_PUMP only works for tokens still on bonding curves

### 3. Fund Your Wallets
Your wallet `AYGx9rD9...` had 0 SOL. Each trade needs ~0.02-0.03 SOL.

```bash
# Fund the wallet with at least 0.05 SOL
solana transfer AYGx9rD9u6Fg9huAkkRkVYNcPSvGMPNNYEfaD9541nX2 0.05
```

### 4. Use Premium RPC (Recommended)
Add to `.env`:
```
RPC_URL=https://your-premium-rpc-endpoint.com
```

## What Was Fixed

✅ **Added configuration validation** - Checks market/mint before trading
✅ **Enhanced error handling** - Better diagnostics and retry logic  
✅ **Created diagnostic tool** - Test configs before running strategies
✅ **Improved logging** - See exactly what's failing and why

## Valid Bonding Curve Markets

Only use these markets with CURVE_PUMP:
- `PUMP_FUN` - Pump.fun launchpad
- `PUMP_SWAP` - PumpSwap
- `METEORA_DBC` - Meteora Dynamic Bonding Curve
- `RAYDIUM_LAUNCHPAD` - Raydium Launchpad
- `MOONIT`, `HEAVEN`, `SUGAR`, `BOOP_FUN` - Other launchpads

**Don't use:** RAYDIUM_AMM, ORCA_WHIRLPOOL, etc. (regular DEXs don't have bonding curves)

## Test Before Running

Always validate first:
```bash
# Test your configuration
node diagnostics/validateCurveConfig.js <MARKET> <TOKEN_MINT>

# Example with PUMP_FUN
node diagnostics/validateCurveConfig.js PUMP_FUN SomeTokenMintAddress
```

## Need More Help?

See `CURVE_PUMP_FIX_GUIDE.md` for detailed troubleshooting.
