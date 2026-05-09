# Solana Volume & Trading Bot v3.2 🤖🚀

**Enterprise-Grade Solana Trading Automation with Natural Behavior & Anti-Detection**

A production-ready, institutional-quality Solana trading and volume generation bot with complete Telegram control interface. Features 19 battle-tested trading strategies, advanced multi-strategy manager, intelligent randomization for natural behavior, wallet aging system, Jito MEV protection, 10,000+ wallet management, multi-DEX support (15+ protocols), and failover resilience.

[![Node.js](https://img.shields.io/badge/Node.js-18.x%20%7C%2020.x-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-purple.svg)](https://solana.com/)
[![Production Ready](https://img.shields.io/badge/Status-Production%20Ready-success.svg)]()

> **⚡ Live Telegram Control • 🎯 Multi-Strategy Manager • 🤖 Natural Behavior AI • 🔐 Enterprise Security • 📊 Real-time Monitoring**

---

## 🎯 What's New in v3.2

### 🤖 Natural Behavior & Anti-Detection System
- **Randomized funding amounts** (±25% variance per wallet)
- **Enhanced trade randomization** (double-layer jitter system)
- **Random pre-trade delays** (0-3 seconds for organic timing)
- **Works on BOTH modes** (ephemeral and wallet pool)
- **Undetectable patterns** - simulates human trading behavior
- **Minimal capital mode** - run with just 0.012 SOL total

### 🎯 Multi-Strategy Manager
- **Run multiple strategies simultaneously** with isolated wallet pools
- **Per-cycle wallet funding** for ephemeral mode (eliminates rate limiting)
- **Chart pattern selection UI** for both single and multi-strategy
- **Pause/Resume functionality** for active strategies
- **Real-time monitoring** of all running strategies
- **Independent configuration** per strategy

### ⚡ Enhanced Features
- **Smart wallet allocation** between strategies
- **Ephemeral mode improvements** with automatic per-cycle funding/draining
- **Better error handling** for Telegram connection timeouts
- **Improved pause/resume** with proper state management
- **No hard wallet limits** - respects user configuration
- **Configurable jitter** via Telegram UI

---

## 📋 Table of Contents

- [Quick Start](#-quick-start-5-minutes)
- [Key Features](#-key-features)
- [Multi-Strategy Manager](#-multi-strategy-manager)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Trading Strategies](#-trading-strategies)
- [Wallet Management](#-wallet-management)
- [Telegram Interface](#-telegram-bot-interface)
- [Best Practices](#-best-practices)
- [Troubleshooting](#-troubleshooting)

---

## ⚡ Quick Start (5 Minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your credentials:
# - TELEGRAM_TOKEN (from @BotFather)
# - ADMIN_CHAT_ID (your Telegram chat ID)
# - PRIVKEY (your master wallet private key)
```

### 3. Start the Bot
```bash
npm start
```

### 4. Open Telegram
- Find your bot and send `/start`
- Navigate through the intuitive menu system
- Configure your first strategy
- Start trading!

---

## 🌟 Key Features

### 🤖 Natural Behavior & Anti-Detection
- **Randomized Funding**: ±25% variance per wallet (no fixed amounts)
- **Enhanced Trade Randomization**: Double-layer jitter system
- **Random Timing**: 0-3 second delays simulate human "thinking time"
- **Organic Patterns**: Breaks bot detection signatures
- **Works Everywhere**: Both ephemeral and wallet pool modes
- **Minimal Capital**: Run with just 0.012 SOL total
- **Configurable**: Adjust jitter percentage via Telegram UI

### 🎯 Multi-Strategy Manager
- Run up to 10+ strategies simultaneously
- Each strategy has isolated wallet pool or ephemeral wallets
- Independent configuration per strategy
- Real-time monitoring and control
- Pause/Resume/Stop individual strategies
- Per-cycle funding for minimal capital requirements

### 💼 Dual Wallet Modes

**Wallet Pool Mode** (`useWalletPool: true`):
- Persistent wallets saved to disk
- Reusable across operations
- Supports wallet aging system
- Randomized funding for natural behavior
- Best for long-term campaigns

**Ephemeral Mode** (`useWalletPool: false`):
- Temporary in-memory wallets
- Auto-generated and auto-cleaned
- Per-cycle funding/draining
- Randomized amounts per cycle
- 5x less capital required (0.012 SOL minimum)
- Best for one-time operations

### 🎨 19 Trading Strategies

**Core Organic Simulation**:
- Standard Volume
- Market Maker
- Holder Growth
- Volume Boost

**Chart Manipulation**:
- Chart Pattern (10 patterns available)
- Curve Pump
- Pump & Dump
- Web of Activity
- Micro Spam

**Whale & Influencer Simulation**:
- Whale Simulation
- Mirror Whale
- KOL Alpha Call
- Bull Trap
- Social Proof Airdrop

**Trending Master Suite**:
- Viral Pump
- Organic Growth
- FOMO Wave
- Liquidity Ladder
- Wash Trading

### 🔐 Enterprise Security
- Admin-only access control
- Private key encryption
- Rate limiting
- Session management
- Secure error handling
- Anti-detection randomization

### 📊 Real-Time Monitoring
- Live progress updates
- Success/failure tracking
- Transaction confirmations
- Error reporting with solutions
- Performance metrics
- Randomization logging

---

## 🎯 Multi-Strategy Manager

### Overview

The Multi-Strategy Manager allows you to run multiple trading strategies simultaneously, each with its own configuration and wallet allocation.

### Key Features

**Independent Strategies**:
- Each strategy runs in isolation
- Separate wallet pools or ephemeral wallets
- Individual configuration (buy amounts, cycles, DEX, etc.)
- Independent start/stop/pause controls

**Wallet Modes**:
- **Pool Mode**: Assign specific wallets from your wallet pool
- **Ephemeral Mode**: Auto-generate temporary wallets per strategy

**Per-Cycle Funding** (Ephemeral Mode):
- Set total wallets (e.g., 150)
- Set wallets per cycle (e.g., 30)
- Bot funds only 30 wallets at a time
- Drains after each cycle
- Eliminates rate limiting
- Reduces capital requirements

### Creating a Multi-Strategy

```
Main Menu → 🎯 Multi-Strategy → ➕ Create Strategy
```

1. **Select Strategy Type**: Choose from 19 strategies
2. **Configure Settings**:
   - Token address
   - Buy/sell amounts
   - Number of cycles
   - Delay between actions
   - Provider & DEX selection
   - Chart pattern (if applicable)

3. **Choose Wallet Mode**:
   - **Pool Mode**: Assign wallets from your pool
   - **Ephemeral Mode**: Set total wallets and wallets per cycle

4. **Start Strategy**: Begin execution

### Managing Strategies

**View All Strategies**:
```
Multi-Strategy → 📋 List Strategies
```
Shows: Name, Type, Status, Wallets, Cycles, P&L

**Strategy Details**:
```
Select Strategy → View Details
```
Shows: Configuration, Statistics, Wallet info, Current cycle

**Control Options**:
- ▶️ **Start**: Begin strategy execution
- ⏸️ **Pause**: Pause after current cycle completes
- ▶️ **Resume**: Continue from paused state
- ⏹️ **Stop**: Stop strategy and cleanup
- ⚙️ **Configure**: Modify settings (when not running)
- 🗑️ **Delete**: Remove strategy (when stopped)

### Wallet Allocation

**Pool Mode Allocation**:
```
Multi-Strategy → 💼 Wallet Allocation
```
- View which wallets are assigned to which strategies
- Allocate wallets to strategies
- See available vs assigned wallets

**Ephemeral Mode**:
- No allocation needed
- Wallets generated automatically
- Specify total wallets and wallets per cycle

### Per-Cycle Funding Example

**Configuration**:
- Total Wallets: 150
- Wallets/Cycle: 30
- Cycles: 50

**Execution**:
```
Cycle 1:  Fund wallets 0-29   → Trade → Drain
Cycle 2:  Fund wallets 30-59  → Trade → Drain
Cycle 3:  Fund wallets 60-89  → Trade → Drain
...
Cycle 5:  Fund wallets 120-149 → Trade → Drain
Cycle 6:  Fund wallets 0-29   → Trade → Drain (wraps around)
```

**Benefits**:
- Only 30 concurrent operations (no rate limiting)
- Only need capital for 30 wallets at a time
- All 150 wallets used across cycles
- Faster startup (fund 30 vs 150)

### Multi-Strategy Best Practices

1. **Start Small**: Test with 1-2 strategies first
2. **Monitor Resources**: Watch RPC rate limits and SOL balance
3. **Use Different Tokens**: Avoid conflicts on same token
4. **Stagger Start Times**: Don't start all at once
5. **Use Per-Cycle Funding**: For large wallet counts (>50)

---

## 📦 Installation

### System Requirements

- **Node.js**: v18.x or v20.x LTS
- **NPM**: v9.0.0 or higher
- **RAM**: 2GB minimum, 4GB recommended
- **Disk**: 500MB for application + wallet storage
- **Network**: Stable internet (10+ Mbps)

### Installation Steps

```bash
# 1. Clone or download the repository
git clone https://github.com/yourusername/solana-volume-bot.git
cd solana-volume-bot

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
nano .env  # Edit with your credentials

# 4. Start the bot
npm start
```

### Environment Variables

Create a `.env` file with:

```env
# Telegram Bot Configuration
TELEGRAM_TOKEN=your_telegram_bot_token_here
ADMIN_CHAT_ID=your_telegram_chat_id_here

# Solana Configuration
PRIVKEY=your_master_wallet_private_key_base58
RPC_URL=https://api.mainnet-beta.solana.com

# Optional: Multiple RPC endpoints (comma-separated)
# RPC_URLS=https://api.mainnet-beta.solana.com,https://rpc.ankr.com/solana
```

### Getting Telegram Credentials

1. **Create Bot**:
   - Open Telegram, search for @BotFather
   - Send `/newbot` and follow prompts
   - Save the bot token

2. **Get Chat ID**:
   - Start your bot (send `/start`)
   - Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   - Find your `chat.id` in the response

---

## ⚙️ Configuration

### Basic Settings

Configure via Telegram: `Main Menu → ⚙️ Settings → Basic Settings`

| Setting | Description | Default | Range |
|---------|-------------|---------|-------|
| Token Address | Target token mint address | - | Valid Solana address |
| Min Buy Amount | Minimum SOL per buy | 0.01 | 0.0001-1.0 |
| Max Buy Amount | Maximum SOL per buy | 0.05 | 0.001-10.0 |
| Number of Cycles | Trading cycles to execute | 3 | 1-1000 |
| Interval | Delay between actions (ms) | 15000 | 100-60000 |
| Wallets Per Cycle | Wallets to use per cycle | 50 | 1-10000 |
| Jitter Percentage | Trade amount randomization | 20 | 0-100 |

### Advanced Settings

Configure via Telegram: `Main Menu → ⚙️ Settings → Advanced`

| Setting | Description | Default |
|---------|-------------|---------|
| Batch Concurrency | Parallel operations | 10 |
| Priority Fee | SOL fee per transaction | 0.0005 |
| Slippage | Slippage tolerance (%) | 2 |
| Jitter Percentage | Trade amount randomization | 20 |
| Use Jito | Enable MEV protection | false |
| Funding Variance | Randomized funding (±%) | 25 (hardcoded) |
| Swap Provider | SOLANA_TRACKER or SOLANA_TRADE | SOLANA_TRACKER |
| Target DEX | Which DEX to use | RAYDIUM_AMM |

### Wallet Modes

**Pool Mode** (`useWalletPool: true`):
- Persistent wallets on disk
- Reusable across operations
- Requires wallet generation first
- Best for: Long-term campaigns

**Ephemeral Mode** (`useWalletPool: false`):
- Temporary wallets in memory
- Auto-generated per operation
- Auto-cleaned after completion
- Best for: One-time operations

### Chart Pattern Selection

For CHART_PATTERN strategy, select pattern via UI:

**Available Patterns**:
- 📈 Ascending Triangle
- 📉 Descending Triangle
- 🚩 Bull Flag
- 🏴 Bear Flag
- ☕ Cup & Handle
- 👤 Head & Shoulders
- ⏬ Double Bottom
- ⏫ Double Top
- 📐 Rising Wedge
- 📐 Falling Wedge

**How to Select**:
```
Settings → Strategy Config → Chart Pattern → Select Pattern
```

---

## 🎯 Trading Strategies

### Strategy Selection Guide

| Goal | Strategy | Wallet Count | Duration |
|------|----------|--------------|----------|
| Consistent volume | Standard Volume | 20-50 | Continuous |
| Organic activity | Market Maker | 30-100 | Long-term |
| Holder count | Holder Growth | 50-200 | Gradual |
| Chart pattern | Chart Pattern | 20-50 | 1-4 hours |
| Pump.fun launch | Curve Pump | 30-100 | 30-60 min |
| Quick pump | Pump & Dump | 20-50 | 15-30 min |
| Whale FOMO | Whale Simulation | 10-30 | 1-2 hours |
| Viral momentum | Viral Pump | 50-150 | 2-6 hours |
| Free volume | Wash Trading | 10-20 | Continuous |

### Strategy Descriptions

**Standard Volume**: Classic buy/sell cycles with configurable parameters. Reliable and predictable.

**Market Maker**: Simulates real traders with different personalities (Scalper, Whale, Retail). Organic-looking activity.

**Holder Growth**: Accumulates small amounts across many wallets to increase holder count.

**Chart Pattern**: Paints specific technical analysis patterns on the chart. Choose from 10 patterns.

**Curve Pump**: Pushes Pump.fun bonding curve to target completion percentage.

**Pump & Dump**: Aggressive concentrated buys followed by stealth sells.

**Whale Simulation**: Single massive buy followed by segmented dumping.

**Viral Pump**: Escalating buy amounts mimicking explosive organic adoption.

**Wash Trading**: Matching wallets passing tokens for zero-cost volume.

---

## 💼 Wallet Management

### Generating Wallets

```
Main Menu → 💼 Wallet Pool → Generate Wallets
```

**Recommendations**:
- Small campaigns: 10-50 wallets
- Medium campaigns: 50-200 wallets
- Large campaigns: 200-1000 wallets
- Maximum: 10,000 wallets

### Wallet Operations

**View Wallets**:
```
Wallet Pool → View Wallets
```
Shows: Total count, addresses, balances

**Drain Wallets**:
```
Wallet Pool → Drain Pool
```
Recovers all SOL from wallets back to master wallet

**Clear Wallets**:
```
Wallet Pool → Clear Pool
```
Deletes all wallets from disk (cannot be undone)

### Wallet Aging System

The bot automatically tracks wallet age and behavior:

**Age Tiers**:
- 🆕 Fresh (0-1 day): 60% amounts, 180% delays
- 🌱 Young (1-7 days): 75% amounts, 140% delays
- 🌿 Seasoned (7-30 days): 90% amounts, 110% delays
- 🌳 Mature (30-90 days): 100% amounts, 100% delays
- 🏆 Veteran (90+ days): 120% amounts, 80% delays

**Benefits**:
- More organic-looking activity
- Reduced detection risk
- Better long-term sustainability

---

## 🤖 Telegram Bot Interface

### Main Menu

```
🏠 Main Menu
├── 📈 Strategies (19 single strategies)
├── 🎯 Multi-Strategy (multi-strategy manager)
├── ⚙️ Settings (configuration)
├── 💼 Wallet Pool (wallet management)
├── 📊 Status (current operation info)
└── ❓ Help (command reference)
```

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize bot and show main menu |
| `/stop` | Emergency stop current operation |
| `/status` | View current operation status |
| `/health` | Run system health check |
| `/help` | Show command reference |

### Real-Time Updates

The bot provides live progress updates:

```
🚀 Starting Standard Volume...
💰 Funding 50 wallets... (25/50) 50%
🛒 Executing buys... (40/50) 80%
💤 Waiting 5 seconds...
💸 Executing sells... (48/50) 96%
✅ Complete! Success: 48/50 (96%)
```

---

## 🎓 Best Practices

### Starting Out

1. **Test with Small Amounts**:
   - 5-10 wallets
   - 0.001-0.005 SOL per trade
   - 1-2 cycles only

2. **Monitor Closely**:
   - Watch Telegram updates
   - Check transaction confirmations
   - Review error messages

3. **Use Devnet First** (optional):
   ```env
   RPC_URL=https://api.devnet.solana.com
   ```

### Scaling Up

1. **Gradual Increase**:
   - Double wallet count each run
   - Increase amounts slowly
   - Test new strategies individually

2. **Optimize Settings**:
   - Adjust concurrency based on RPC performance
   - Fine-tune delays for organic appearance
   - Use per-cycle funding for large wallet counts
   - Increase jitter percentage for more variance (20-40%)

3. **Use Multiple RPC Endpoints**:
   ```env
   RPC_URLS=https://api.mainnet-beta.solana.com,https://rpc.ankr.com/solana,https://solana-api.projectserum.com
   ```

4. **Leverage Randomization**:
   - Default ±25% funding variance is automatic
   - Adjust jitter percentage in Settings → Advanced
   - Random delays are automatic (0-3 seconds)
   - No two executions will look the same

### Multi-Strategy Tips

1. **Start with 1-2 strategies** to understand the system
2. **Use different tokens** to avoid conflicts
3. **Monitor RPC rate limits** when running multiple strategies
4. **Use per-cycle funding** for ephemeral mode with >50 wallets
5. **Stagger start times** to avoid overwhelming RPC
6. **Leverage randomization** - each strategy will have unique patterns
7. **Adjust jitter per strategy** for different behavior profiles

### Security

1. **Private Key Management**:
   - Never share `.env` file
   - Use separate master wallet for bot
   - Keep backup of private keys offline

2. **Access Control**:
   - Set correct `ADMIN_CHAT_ID`
   - Don't share bot token
   - Monitor bot activity

3. **Operational Security**:
   - Start with small test amounts
   - Monitor for unusual activity
   - Keep logs for auditing

---

## 🔧 Troubleshooting

### Common Issues

**Issue: "Insufficient SOL" errors**

**Solutions**:
1. Check error message for exact requirements
2. Fund master wallet with more SOL
3. Reduce buy amounts
4. Use ephemeral mode (requires less buffer)

**Issue: RPC rate limiting**

**Solutions**:
1. Add multiple RPC endpoints in `.env`
2. Reduce `batchConcurrency` to 5-10
3. Increase `intervalBetweenActions`
4. Use paid RPC service

**Issue: "No wallets assigned" (Multi-Strategy)**

**Solutions**:
1. For Pool Mode: Allocate wallets to strategy
2. For Ephemeral Mode: Already fixed - should work automatically
3. Check wallet mode setting

**Issue: Telegram connection timeout**

**Solutions**:
1. Check internet connection
2. Verify bot token is correct
3. Bot will auto-retry in background
4. Use VPN if Telegram is blocked

**Issue: Strategy won't pause**

**Solutions**:
1. Pause waits for current cycle to complete
2. Check strategy status in details view
3. Use Stop if immediate halt needed

**Issue: Trades look too similar/bot-like**

**Solutions**:
1. Already fixed! Randomization is automatic
2. Increase jitter percentage (Settings → Advanced)
3. Use longer intervals between actions
4. Verify logs show "randomized amount" messages

### Getting Help

1. Check error messages in Telegram
2. Review logs in `logs/` directory
3. Run health check: `/health`
4. Check GitHub issues
5. Contact support

---

## 📊 Performance Tuning

### For Speed
```json
{
  "batchConcurrency": 30,
  "intervalBetweenActions": 1000,
  "jitterPercentage": 10,
  "useJito": true
}
```
**Note**: Lower jitter = faster but more detectable

### For Reliability
```json
{
  "batchConcurrency": 10,
  "intervalBetweenActions": 5000,
  "jitterPercentage": 20,
  "useJito": false
}
```
**Note**: Balanced approach with good randomization

### For Maximum Stealth
```json
{
  "batchConcurrency": 5,
  "intervalBetweenActions": 10000,
  "jitterPercentage": 40,
  "useJito": false
}
```
**Note**: Higher jitter + longer delays = most organic appearance

### Natural Behavior Features (Automatic)
- ✅ Funding variance: ±25% (hardcoded, always active)
- ✅ Random delays: 0-3 seconds (hardcoded, always active)
- ✅ Trade jitter: Configurable via jitterPercentage
- ✅ Works on both ephemeral and wallet pool modes

---

## 🔐 Security Guidelines

1. **Never commit `.env` file** to version control
2. **Use separate wallet** for bot operations
3. **Start with small amounts** for testing
4. **Monitor bot activity** regularly
5. **Keep private keys secure** and backed up
6. **Use admin-only access** via `ADMIN_CHAT_ID`
7. **Review logs** for suspicious activity

---

## 📝 License

MIT License - See LICENSE file for details

---

## 🙏 Support

- **Issues**: GitHub Issues
- **Documentation**: This README
- **Updates**: Check GitHub for latest version

---

## ⚠️ Disclaimer

This bot is for educational and research purposes. Use at your own risk. Always comply with local regulations and exchange terms of service. The developers are not responsible for any financial losses or legal issues arising from the use of this software.

---

**Built with ❤️ for the Solana community**
