# NPM Install Fix Guide

## Problem
The `@pump-fun/pump-swap-sdk` package (dependency of `solana-swap`) has a bug where it tries to initialize a PublicKey with invalid data during module load, causing this error:

```
Error: Assertion failed
at assert (node_modules\bn.js\lib\bn.js:6:21)
at BN._initArray (node_modules\bn.js\lib\bn.js:145:5)
at new PublicKey (node_modules\@solana\web3.js\lib\index.cjs.js:176:20)
```

## Root Cause
- The SDK tries to create PublicKey objects during module initialization
- Version conflicts between `@solana/web3.js` versions
- The `overrides` section in package.json was forcing incompatible versions

## Solutions (Try in Order)

### Solution 1: Clean Install (RECOMMENDED)
```bash
# Delete node_modules and lock file
rm -rf node_modules package-lock.json

# Clear npm cache
npm cache clean --force

# Install with legacy peer deps
npm install --legacy-peer-deps
```

### Solution 2: Use Yarn Instead
```bash
# Install yarn if not installed
npm install -g yarn

# Remove node_modules
rm -rf node_modules

# Install with yarn
yarn install
```

### Solution 3: Downgrade solana-swap
Edit `package.json` and change:
```json
"solana-swap": "^1.1.0"
```

Then run:
```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

### Solution 4: Use Alternative Swap Library
Replace `solana-swap` with `solana-trade` only:

1. Edit `package.json`, remove:
```json
"solana-swap": "^1.3.0",
```

2. Update `volumebot.js`, replace:
```javascript
import { SolanaTracker } from "solana-swap";
```

With:
```javascript
import { SolanaTrade } from "solana-trade";
```

3. Update swap logic to use SolanaTrade API

### Solution 5: Manual Fix (If npm keeps hanging)

1. **Stop any running npm processes:**
```bash
# Windows
taskkill /F /IM node.exe
taskkill /F /IM npm.exe

# Linux/Mac
killall node
killall npm
```

2. **Delete everything and start fresh:**
```bash
rm -rf node_modules
rm package-lock.json
rm -rf ~/.npm/_cacache  # Clear global cache
```

3. **Install with specific flags:**
```bash
npm install --legacy-peer-deps --no-optional --prefer-offline
```

## Current Package.json Status
✅ Removed `@solana/web3.js` override
✅ Updated `solana-swap` to `^1.3.0`
✅ Kept `@coral-xyz/anchor` override at `0.29.0`

## If npm install Still Hangs

The issue might be:
1. **Network problems** - Try using a VPN or different network
2. **Antivirus blocking** - Temporarily disable antivirus
3. **Disk space** - Ensure you have at least 2GB free
4. **npm registry issues** - Try:
   ```bash
   npm config set registry https://registry.npmjs.org/
   ```

## Quick Test After Install
```bash
node -e "import('solana-swap').then(() => console.log('OK')).catch(e => console.error(e))"
```

If this works, the installation is successful.

## Alternative: Use Docker
If all else fails, use Docker to avoid dependency issues:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
CMD ["npm", "start"]
```

## Need Help?
If none of these solutions work, please provide:
1. Node version: `node --version`
2. npm version: `npm --version`
3. Operating system
4. Full error log from `npm-debug.log`
