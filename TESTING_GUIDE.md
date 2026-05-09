# Testing Guide - Agent System Integration

## Quick Start Testing

### Prerequisites
1. ✅ ES6 modules fixed (COMPLETE)
2. ✅ Bot starts without errors (VERIFIED)
3. ✅ EntropyEngine integrated (COMPLETE)
4. ⏭️ Telegram bot configured
5. ⏭️ Master wallet funded
6. ⏭️ RPC endpoint configured

### Test Environment Setup

```bash
# 1. Verify bot starts
node volumebot.js

# Expected output:
# ✅ SolanaTrade provider initialized successfully
# ✅ Master Wallet loaded: [address]
# 💼 Wallet Manager: X wallets loaded
# 🚀 Volume Bot v3.2 started | Strategies: 19
```

## Phase 4: Individual Strategy Testing

### Test Template (Use for Each Strategy)

#### 1. Standard Strategy Test

**Wallet Pool Mode:**
```
/start
/token [TOKEN_ADDRESS]
/strategy standard
/wallets 5
/trades 10
/amount 0.001 0.005
/pool
/run
```

**Ephemeral Mode:**
```
/start
/token [TOKEN_ADDRESS]
/strategy standard
/wallets 5
/trades 10
/amount 0.001 0.005
/ephemeral
/run
```

**What to Verify:**
- [ ] Funding: Each wallet gets different amount (±25% variance)
- [ ] Trading: Buy/sell amounts vary per trade
- [ ] Timing: Delays between trades are randomized
- [ ] Draining: Ephemeral wallets drain back to master (ephemeral only)
- [ ] Logs: No errors in bot.log
- [ ] Completion: Strategy completes successfully

**Expected Funding Pattern:**
```
Wallet 1: 0.0075 SOL  (base 0.01 - 25%)
Wallet 2: 0.0118 SOL  (base 0.01 + 18%)
Wallet 3: 0.0092 SOL  (base 0.01 - 8%)
Wallet 4: 0.0103 SOL  (base 0.01 + 3%)
Wallet 5: 0.0088 SOL  (base 0.01 - 12%)
```
❌ **BAD:** All wallets get 0.0100 SOL (no variance)
✅ **GOOD:** Each wallet gets different amount

### Strategy-Specific Test Commands

#### 2. Maker Strategy
```
/strategy maker
/wallets 10
/trades 20
/amount 0.002 0.008
```
**Verify:** Balanced buy/sell ratio, spread variation

#### 3. Web of Activity
```
/strategy web
/wallets 15
/trades 30
/amount 0.001 0.01
```
**Verify:** Complex interaction patterns, varied timing

#### 4. Spam Strategy
```
/strategy spam
/wallets 20
/trades 50
/amount 0.0005 0.002
```
**Verify:** High frequency, small amounts, rapid execution

#### 5. Pump & Dump
```
/strategy pump
/wallets 10
/trades 25
/amount 0.005 0.02
```
**Verify:** Phase transitions (accumulation → pump → dump)

#### 6. Chart Pattern
```
/strategy chart
/wallets 8
/trades 20
/amount 0.003 0.015
```
**Verify:** Pattern formation (cup, wedge, triangle)

#### 7. Holder Growth
```
/strategy holder
/wallets 12
/trades 30
/amount 0.002 0.01
```
**Verify:** Gradual accumulation, holder count increase

#### 8. Whale Strategy
```
/strategy whale
/wallets 5
/trades 10
/amount 0.01 0.05
```
**Verify:** Large trades, market impact, phases

#### 9. Volume Boost
```
/strategy volume
/wallets 15
/trades 40
/amount 0.001 0.008
```
**Verify:** High volume generation, balanced buy/sell

#### 10. Trending Strategy
```
/strategy trending
/wallets 20
/trades 50
/amount 0.002 0.01
```
**Verify:** Momentum building, viral patterns

#### 11. Jito MEV
```
/strategy jito
/wallets 8
/trades 15
/amount 0.005 0.02
```
**Verify:** Bundle execution, MEV optimization

#### 12. KOL Alpha
```
/strategy kol
/wallets 10
/trades 25
/amount 0.003 0.015
```
**Verify:** Phase-based execution, alpha generation

#### 13. Bull Trap
```
/strategy bulltrap
/wallets 12
/trades 30
/amount 0.004 0.02
```
**Verify:** Trap phases (setup → trigger → exit)

#### 14. Social Proof
```
/strategy social
/wallets 15
/trades 35
/amount 0.002 0.01
```
**Verify:** Social signal generation, holder patterns

#### 15. Ladder Strategy
```
/strategy ladder
/wallets 10
/trades 25
/amount 0.003 0.015
```
**Verify:** Ladder phases, price level targeting

#### 16. Sniper Strategy
```
/strategy sniper
/wallets 5
/trades 10
/amount 0.01 0.05
```
**Verify:** Fast execution, precise timing

#### 17. Advanced Wash
```
/strategy advwash
/wallets 12
/trades 30
/amount 0.002 0.01
```
**Verify:** Wash patterns, volume generation

#### 18. Mirror Whale
```
/strategy mirror
/wallets 8
/trades 20
/amount 0.005 0.025
```
**Verify:** Whale mirroring, large trade patterns

#### 19. Curve Pump
```
/strategy curve
/wallets 10
/trades 25
/amount 0.004 0.02
```
**Verify:** Curve phases, smooth price action

## Test Checklist

### Per Strategy Test:
```
Strategy: _______________
Date: _______________

Wallet Pool Mode:
[ ] Funding randomization verified
[ ] Trading randomization verified
[ ] Trades executed successfully
[ ] No errors in logs
[ ] Strategy completed

Ephemeral Mode:
[ ] Funding randomization verified
[ ] Trading randomization verified
[ ] Trades executed successfully
[ ] Wallets drained successfully
[ ] No errors in logs
[ ] Strategy completed

Notes:
_________________________________
_________________________________
_________________________________
```

## Verification Commands

### Check Funding Randomization
```bash
# Look for funding logs in bot.log
grep "Funding" bot.log | tail -20

# Expected pattern:
# Funding wallet 1 with 0.0075 SOL
# Funding wallet 2 with 0.0118 SOL
# Funding wallet 3 with 0.0092 SOL
```

### Check Trading Randomization
```bash
# Look for trade logs
grep "BUY\|SELL" bot.log | tail -30

# Expected pattern:
# BUY 0.0032 SOL
# SELL 0.0047 SOL
# BUY 0.0028 SOL
# (amounts should vary)
```

### Check for Errors
```bash
# Check for errors
grep "ERROR\|Error\|error" bot.log | tail -20

# Should be empty or only network errors
```

### Monitor Real-Time
```bash
# Watch logs in real-time
tail -f bot.log

# Or on Windows PowerShell:
Get-Content bot.log -Wait -Tail 20
```

## Common Issues & Solutions

### Issue: All wallets funded with same amount
**Cause:** Funding randomization not working
**Check:** Verify EntropyEngine is being used
**Solution:** Already fixed in ES6 module conversion

### Issue: Bot crashes on startup
**Cause:** Module import errors
**Check:** Run `node --check volumebot.js`
**Solution:** Already fixed in ES6 module conversion

### Issue: Strategy doesn't execute
**Cause:** Behavior module not loaded
**Check:** Verify behavior file exists and exports correctly
**Solution:** All behaviors converted to ES6 default exports

### Issue: Trades fail
**Cause:** Insufficient balance, RPC issues, or network errors
**Check:** Verify master wallet balance, RPC endpoint
**Solution:** Fund master wallet, check RPC configuration

## Performance Monitoring

### Metrics to Track:
1. **Funding Time:** How long to fund all wallets
2. **Trade Execution Time:** Average time per trade
3. **Success Rate:** Percentage of successful trades
4. **Memory Usage:** Monitor for memory leaks
5. **CPU Usage:** Check for performance issues

### Monitoring Commands:
```bash
# Check process stats (Linux/Mac)
ps aux | grep node

# Check process stats (Windows)
Get-Process node | Select-Object CPU,WorkingSet,ProcessName

# Monitor memory over time
while ($true) { 
    Get-Process node | Select-Object WS,CPU; 
    Start-Sleep 5 
}
```

## Test Results Template

```markdown
# Test Results - [Strategy Name]

**Date:** [Date]
**Tester:** [Name]
**Environment:** [Mainnet/Devnet]

## Configuration
- Strategy: [Name]
- Wallets: [Count]
- Trades: [Count]
- Amount Range: [Min] - [Max] SOL
- Mode: [Pool/Ephemeral]

## Results

### Funding
- Total Wallets: [X]
- Successfully Funded: [X]
- Failed: [X]
- Variance Observed: [Yes/No]
- Min Amount: [X] SOL
- Max Amount: [X] SOL
- Avg Amount: [X] SOL

### Trading
- Total Trades: [X]
- Successful: [X]
- Failed: [X]
- Success Rate: [X]%
- Avg Trade Time: [X]s
- Total Duration: [X]m

### Draining (Ephemeral Only)
- Wallets Drained: [X]
- SOL Recovered: [X]
- Failed: [X]

### Issues
- [ ] No issues
- [ ] [Describe issue 1]
- [ ] [Describe issue 2]

### Logs
```
[Paste relevant log excerpts]
```

### Conclusion
[Pass/Fail] - [Brief summary]
```

## Next Steps After Testing

1. **Document Results** - Record all test results
2. **Fix Issues** - Address any problems found
3. **Retest** - Verify fixes work
4. **Move to Phase 5** - Test multi-strategy mode
5. **Begin Agent Integration** - Start Phase 6

---

**Status:** Ready for Phase 4 Testing
**Last Updated:** May 9, 2026
