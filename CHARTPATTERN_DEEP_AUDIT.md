# Chart Pattern Behavior - Deep Mathematical Audit

**File:** `behaviors/chartPatternBehavior.js`  
**Audit Level:** Mathematical & Edge Case Analysis  
**Date:** May 15, 2026

---

## Mathematical Analysis of Pattern Multipliers

### Pattern-by-Pattern Analysis

#### 1. **cup_and_handle** ✅ SAFE
```javascript
phase < 0.4:  multiplier = 1.0 - phase * 1.5    // Range: [1.0, 0.4]
phase < 0.7:  multiplier = 0.4 + (phase - 0.4) * 2  // Range: [0.4, 1.0]
phase >= 0.7: multiplier = 1.0 - (phase - 0.7) * 0.5 // Range: [1.0, 0.85]
```
- **Min:** 0.4 (at phase=0.4)
- **Max:** 1.0 (at phase=0, 0.7)
- **Continuity:** ✅ Continuous at boundaries
- **Status:** Safe, no negative values possible

#### 2. **ascending_triangle** ⚠️ NEEDS REVIEW
```javascript
multiplier = 0.5 + phase * 0.5 + Math.sin(phase * Math.PI * 4) * 0.2
```
- **Base range:** [0.5, 1.0] from linear component
- **Sine oscillation:** ±0.2
- **Theoretical min:** 0.5 - 0.2 = **0.3** ✅
- **Theoretical max:** 1.0 + 0.2 = **1.2** ✅
- **Status:** Safe with noise (0.3 * 0.9 = 0.27 > 0.1 floor)

#### 3. **bull_flag** ✅ SAFE
```javascript
phase < 0.3:  multiplier = 1.0 + phase * 2      // Range: [1.0, 1.6]
phase >= 0.3: multiplier = 1.6 - (phase - 0.3) * 0.3 // Range: [1.6, 1.39]
```
- **Min:** 1.39 (at phase=1.0)
- **Max:** 1.6 (at phase=0.3)
- **Status:** Always above 1.0, safe

#### 4. **double_bottom** ✅ SAFE
```javascript
phase < 0.25: multiplier = 1.0 - phase * 2           // [1.0, 0.5]
phase < 0.50: multiplier = 0.5 + (phase - 0.25) * 2  // [0.5, 1.0]
phase < 0.75: multiplier = 1.0 - (phase - 0.5) * 2   // [1.0, 0.5]
phase >= 0.75: multiplier = 0.5 + (phase - 0.75) * 2 // [0.5, 1.0]
```
- **Min:** 0.5 (at phase=0.25, 0.75)
- **Max:** 1.0 (at phase=0, 0.5, 1.0)
- **Continuity:** ✅ Perfect continuity
- **Status:** Safe, symmetric pattern

#### 5. **inverse_head_shoulders** ✅ FIXED
```javascript
phase < 0.2:  multiplier = 1.0 - phase * 2           // [1.0, 0.6]
phase < 0.4:  multiplier = 0.6 - (phase - 0.2) * 1.5 // [0.6, 0.3]
phase < 0.6:  multiplier = 0.3 + (phase - 0.4) * 1.5 // [0.3, 0.6]
phase < 0.8:  multiplier = 0.6 - (phase - 0.6) * 1   // [0.6, 0.4]
phase >= 0.8: multiplier = 0.4 + (phase - 0.8) * 3   // [0.4, 1.0]
```
- **Min:** 0.3 (at phase=0.4) - the "head"
- **Max:** 1.0 (at phase=1.0) - the breakout
- **Continuity:** ✅ Continuous at all boundaries
- **Status:** Fixed from v1 (was 0.2, now 0.3 minimum)

#### 6. **rising_wedge** ⚠️ COMPLEX
```javascript
multiplier = 0.8 + phase * 0.4 - Math.abs(Math.sin(phase * Math.PI * 3)) * (0.3 - phase * 0.2)
```
- **Base:** [0.8, 1.2] from linear component
- **Oscillation amplitude:** (0.3 - phase * 0.2) ranges from 0.3 to 0.1
- **Worst case:** 0.8 - 1.0 * 0.3 = **0.5** ✅
- **Status:** Safe, but complex - consider simplification

#### 7. **symmetrical_triangle** ⚠️ COMPLEX
```javascript
multiplier = 1.0 - Math.abs(Math.sin(phase * Math.PI * 3)) * (0.5 - phase * 0.4)
```
- **Oscillation amplitude:** (0.5 - phase * 0.4) ranges from 0.5 to 0.1
- **Worst case:** 1.0 - 1.0 * 0.5 = **0.5** ✅
- **Status:** Safe, converging oscillation

#### 8. **rounding_bottom** ✅ SAFE
```javascript
multiplier = 0.5 + 0.5 * Math.cos(phase * Math.PI)
```
- **Min:** 0.5 (at phase=0.5, when cos(π/2) = 0)
- **Max:** 1.0 (at phase=0 and 1.0, when cos=±1)
- **Status:** Perfect U-shape, mathematically elegant

#### 9. **falling_wedge** ⚠️ COMPLEX
```javascript
multiplier = 1.2 - phase * 0.6 - Math.abs(Math.sin(phase * Math.PI * 3)) * (0.3 - phase * 0.2)
```
- **Base:** [1.2, 0.6] from linear component
- **Oscillation amplitude:** (0.3 - phase * 0.2) ranges from 0.3 to 0.1
- **Worst case:** 0.6 - 1.0 * 0.1 = **0.5** ✅
- **Status:** Safe, but complex

#### 10. **pennant** ⚠️ EDGE CASE
```javascript
phase < 0.2:  multiplier = 1.0 + phase * 3  // [1.0, 1.6]
phase >= 0.2: multiplier = 1.6 - Math.abs(Math.sin((phase - 0.2) * Math.PI * 5)) * (0.4 - (phase - 0.2) * 0.3)
```
- **Phase 2 amplitude:** (0.4 - (phase - 0.2) * 0.3)
  - At phase=0.2: amplitude = 0.4
  - At phase=1.0: amplitude = 0.4 - 0.8 * 0.3 = **0.16**
- **Worst case:** 1.6 - 1.0 * 0.4 = **1.2** ✅
- **Status:** Safe, always above 1.0

#### 11. **rectangle** ✅ SAFE
```javascript
multiplier = 1.0 + Math.sin(phase * Math.PI * 4) * 0.2
```
- **Range:** [0.8, 1.2]
- **Status:** Simple, safe oscillation

#### 12. **triple_bottom** ✅ SAFE
```javascript
phase < 0.15: multiplier = 1.0 - phase * 3              // [1.0, 0.55]
phase < 0.30: multiplier = 0.55 + (phase - 0.15) * 3    // [0.55, 1.0]
phase < 0.45: multiplier = 1.0 - (phase - 0.3) * 3      // [1.0, 0.55]
phase < 0.60: multiplier = 0.55 + (phase - 0.45) * 3    // [0.55, 1.0]
phase < 0.75: multiplier = 1.0 - (phase - 0.6) * 3      // [1.0, 0.55]
phase >= 0.75: multiplier = 0.55 + (phase - 0.75) * 1.8 // [0.55, 1.0]
```
- **Min:** 0.55 (at three bottoms)
- **Max:** 1.0 (at peaks)
- **Continuity:** ✅ Perfect
- **Status:** Safe, symmetric triple pattern

---

## Additional Issues Found

### Issue #9: Noise Can Push Values Below Intended Minimums ⚠️
**Problem:** Noise multiplier (0.9-1.1) is applied AFTER pattern calculation
```javascript
const result = multiplier * noise;
return Math.max(0.1, result);
```

**Example:**
- Pattern returns 0.3
- Noise = 0.9
- Result = 0.3 * 0.9 = 0.27 ✅ (still above 0.1)

**Worst case:**
- Pattern returns 0.3 (inverse_head_shoulders head)
- Noise = 0.9
- Result = 0.27 (still safe)

**Status:** ✅ Safe due to 0.1 floor, but reduces pattern fidelity

### Issue #10: Pattern Continuity at Boundaries ✅
All patterns checked for continuity at phase boundaries:
- ✅ cup_and_handle: Continuous
- ✅ double_bottom: Continuous
- ✅ inverse_head_shoulders: Continuous
- ✅ triple_bottom: Continuous
- ✅ bull_flag: Continuous
- ✅ pennant: Continuous

### Issue #11: Sell Amount Precision ⚠️ MINOR
```javascript
const amount = parseFloat((tokenBalance * sellPortion).toFixed(6));
```
**Potential issue:** If tokenBalance is very small (e.g., 0.0001), selling 10% gives 0.00001, which rounds to 0.000010. This is fine for most cases but could cause issues with tokens that have different decimal precision.

**Recommendation:** Add minimum sell amount check:
```javascript
const rawAmount = tokenBalance * sellPortion;
const amount = parseFloat(rawAmount.toFixed(6));
if (amount < 0.000001) {
    // Amount too small, wait instead
    return { type: 'WAIT' };
}
```

### Issue #12: Buy Amount Can Exceed maxBuyAmount ⚠️ MODERATE
```javascript
const baseAmount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
const dipStrength = Math.max(0, 1.0 - multiplier); // 0 at par, larger at deeper dips
const amount = parseFloat((baseAmount * (1 + dipStrength * 0.5)).toFixed(6));
```

**Problem:** 
- maxBuyAmount = 1.0
- baseAmount = 1.0 (at max)
- dipStrength = 0.7 (deep dip, multiplier = 0.3)
- amount = 1.0 * (1 + 0.7 * 0.5) = 1.0 * 1.35 = **1.35** ❌

**This violates the maxBuyAmount constraint!**

**Fix Required:**
```javascript
const baseAmount = entropy.getRandomFloat(agent.minBuyAmount, agent.maxBuyAmount);
const dipStrength = Math.max(0, 1.0 - multiplier);
const adjustedAmount = baseAmount * (1 + dipStrength * 0.5);
const amount = parseFloat(Math.min(adjustedAmount, agent.maxBuyAmount).toFixed(6));
```

### Issue #13: Phase Calculation Edge Case ✅ FIXED
Already fixed with:
```javascript
agent.chartPhase = agent.chartMaxTrades > 0 
    ? agent.chartTrades / agent.chartMaxTrades 
    : 0;
```

---

## Critical Fixes Required

### 🔴 CRITICAL: Fix #1 - Buy Amount Exceeds Max
**Priority:** HIGH  
**Impact:** Violates agent configuration constraints  
**Fix:** Add Math.min() to cap at maxBuyAmount

### 🟡 MODERATE: Fix #2 - Minimum Sell Amount
**Priority:** MEDIUM  
**Impact:** Could cause failed transactions with dust amounts  
**Fix:** Add minimum threshold check

---

## Recommendations

### Code Quality
1. ✅ All patterns are mathematically safe (no negative values)
2. ✅ All patterns have proper continuity
3. ⚠️ Buy amount can exceed maxBuyAmount (MUST FIX)
4. ⚠️ Consider minimum sell amount threshold

### Performance
- All calculations are O(1) - excellent
- No loops or recursive calls
- Pattern selection is efficient

### Maintainability
- Consider extracting complex patterns (rising_wedge, falling_wedge, symmetrical_triangle) into helper functions
- Add unit tests for each pattern
- Consider adding pattern visualization for debugging

---

## Test Coverage Needed

1. **Boundary Tests**
   - Test all patterns at phase = 0, 0.5, 1.0
   - Verify no negative values
   - Verify continuity at boundaries

2. **Buy Amount Tests**
   - Test that buy amounts never exceed maxBuyAmount
   - Test with various dip strengths

3. **Sell Amount Tests**
   - Test with very small token balances
   - Verify minimum sell amounts

4. **Integration Tests**
   - Run full pattern lifecycle (0 → 1.0)
   - Verify pattern resets correctly
   - Test error handling paths

---

## Conclusion

The code is **mostly safe** but has **one critical issue** (buy amount exceeding max) that must be fixed before production use. The mathematical foundations are sound, and all patterns are properly bounded.

**Status:** 🟡 NEEDS FIXES (1 critical, 1 moderate)
