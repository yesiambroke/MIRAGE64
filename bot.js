const { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } = require('@solana/web3.js');
const solanaWeb3 = require('@solana/web3.js');
const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { getAssociatedTokenAddress, getAssociatedTokenAddressSync,createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const splToken = require('@solana/spl-token');
const bs58 = require('bs58');
const { Buffer } = require('buffer');
const { TOKEN_PROGRAM_ID, NATIVE_MINT } = require('@solana/spl-token');
require('dotenv').config();

// Configuration
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const KUCOIN_API_URL = 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=SOL-USDT';
const WSS_URL = `wss://atlas-mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Strategy configuration
let strategyConfig = null;

// Strategy variables (instead of constants)
let TRADE_AMOUNT = 0.2;
let MAX_TR = 3;
let MAX_TRADES_PER_TOKEN = 3;
let TRADE_COOLDOWN = 120000;
let PROFIT_THRESHOLD = 1.0;
let LOSS_THRESHOLD = -0.06;
let MOMENTUM_PROFIT_THRESHOLD = 0.02;
let MOMENTUM_PROFIT_THRESHOLD_1 = 0.15;
let MOMENTUM_PROFIT_THRESHOLD_2 = 0.3;
let MOMENTUM_PROFIT_THRESHOLD_3 = 0.6;
let MOMENTUM_PROFIT_THRESHOLD_4 = 0.8;
let MOMENTUM_PRICE_CHANGE_THRESHOLD_1 = 0.05;
let MOMENTUM_PRICE_CHANGE_THRESHOLD_2 = 0.08;
let MOMENTUM_PRICE_CHANGE_THRESHOLD_3 = 0.12;
let MOMENTUM_PRICE_CHANGE_THRESHOLD_4 = 0.15;
let LOSS_THRESHOLD_TRAIL = 0.045;
let LOSS_PRICE_CHANGE_THRESHOLD_TRAIL = 0.01;
let LOSS_EARLY_PRICE_CHANGE_THRESHOLD = 0.005;
let NEUTRAL_ZONE_PRICE_CHANGE_THRESHOLD = 0.005;
let MOMENTUM_STAGNANT_TIME = 1200;
let MAX_HOLD_TIME = 60000;
let MC_MIN = 28;
let PUMP_THRESHOLD = 0.05;
let BUY_THRESHOLD = 3;
let VOLUME_THRESHOLD = 10;
let MIN_VOLUME = 1.5;
let CREATOR_OWNERSHIP_MAX = 0.2;
let USE_DEX_SCREENER_FILTER = true;

// Add new configuration variables after the existing ones
let TRADE_COOLDOWN_ENABLED = false;
let TRADE_COOLDOWN_PROFIT_CAP = 5; // in SOL
let TRADE_COOLDOWN_DURATION = 3600; // in seconds (1 hour)
let TRADE_COOLDOWN_START_TIME = null;
let TRADE_COOLDOWN_ACTIVE = false;

// File paths
let LOG_FILE = path.join(__dirname, 'transactions.log');
let TRADES_FILE = path.join(__dirname, 'trades.json');
let STATS_FILE = path.join(__dirname, 'stats.json');
let ACTIVE_TRADES_FILE = path.join(__dirname, 'active-trades.json');

// Program IDs and PDAs
let PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
let PUMP_FUN_PROGRAM = new PublicKey(PUMP_FUN_PROGRAM_ID);
let GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
let FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
let PUMP_FUN_ACCOUNT = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
let METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
let ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// Seeds
let CREATOR_VAULT_SEED = Buffer.from("creator-vault");
let BONDING_CURVE_SEED = Buffer.from("bonding-curve");

// State
let activeTrades = new Map();
let tokenData = new Map();
let ws;
let lastTradeTimestamp = 0;
let currentSolPrice = 153; // Initial price, will be updated immediately
let lastSolPriceUpdate = 0;
let solPriceUpdateInterval;
const BOT_PUBLIC_KEY = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY)).publicKey;
const BOT_PUBLIC_KEY_BASE58 = BOT_PUBLIC_KEY.toBase58();
let connection;

// Stats
let stats = {
  totalTxs: 0,
  failedTxs: 0,
  pumpFunTxs: 0,
  buyTxs: 0,
  filterStats: {
    mc: 0,
    pump: 0,
    volume: 0,
    buys: 0,
    ownership: 0,
    liquidity: 0,
    maxTrades: 0,
    cooldown: 0
  },
  lastReset: Date.now(),
  trades: {
    total: 0,
    wins: 0,
    losses: 0,
    totalPnL: 0,
    history: [],
    tokenTradeCounts: new Map(),
    lastTradeTime: new Map()
  }
};

// Function to load strategy configuration
async function loadStrategyConfig() {
  try {
    const configPath = path.join(__dirname, 'strategy-config.json');
    const configData = await fs.readFile(configPath, 'utf8');
    strategyConfig = JSON.parse(configData);
    
    // Update variables immediately after loading config
    updateStrategyVariables();
    
    console.log('Strategy configuration loaded successfully');
    return strategyConfig;
  } catch (error) {
    console.error('Error loading strategy configuration:', error);
    throw error;
  }
}

// Function to get strategy config value - no defaults allowed
function getStrategyValue(key) {
  if (!strategyConfig) {
    throw new Error(`Strategy config not loaded when trying to access ${key}`);
  }

  // Handle nested properties (e.g., "momentumProfitThresholds.threshold1")
  const parts = key.split('.');
  let value = strategyConfig;
  
  for (const part of parts) {
    if (!(part in value)) {
      throw new Error(`Required config value '${key}' is missing from strategy-config.json`);
    }
    value = value[part];
  }
  
  return value;
}

// Function to update all dependent variables after config reload
function updateStrategyVariables() {
  TRADE_AMOUNT = getStrategyValue('tradeAmount');
  MAX_TR = getStrategyValue('maxTrades');
  MAX_TRADES_PER_TOKEN = getStrategyValue('maxTradesPerToken');
  TRADE_COOLDOWN = getStrategyValue('tradeCooldown');
  PROFIT_THRESHOLD = getStrategyValue('profitThreshold');
  LOSS_THRESHOLD = getStrategyValue('lossThreshold');
  MOMENTUM_PROFIT_THRESHOLD = getStrategyValue('momentumProfitThreshold');
  MOMENTUM_PROFIT_THRESHOLD_1 = getStrategyValue('momentumProfitThresholds.threshold1');
  MOMENTUM_PROFIT_THRESHOLD_2 = getStrategyValue('momentumProfitThresholds.threshold2');
  MOMENTUM_PROFIT_THRESHOLD_3 = getStrategyValue('momentumProfitThresholds.threshold3');
  MOMENTUM_PROFIT_THRESHOLD_4 = getStrategyValue('momentumProfitThresholds.threshold4');
  MOMENTUM_PRICE_CHANGE_THRESHOLD_1 = getStrategyValue('momentumPriceChangeThresholds.threshold1');
  MOMENTUM_PRICE_CHANGE_THRESHOLD_2 = getStrategyValue('momentumPriceChangeThresholds.threshold2');
  MOMENTUM_PRICE_CHANGE_THRESHOLD_3 = getStrategyValue('momentumPriceChangeThresholds.threshold3');
  MOMENTUM_PRICE_CHANGE_THRESHOLD_4 = getStrategyValue('momentumPriceChangeThresholds.threshold4');
  LOSS_THRESHOLD_TRAIL = getStrategyValue('lossThresholdTrail');
  LOSS_PRICE_CHANGE_THRESHOLD_TRAIL = getStrategyValue('lossPriceChangeThresholdTrail');
  NEUTRAL_ZONE_PRICE_CHANGE_THRESHOLD = getStrategyValue('neutralZonePriceChangeThreshold');
  MOMENTUM_STAGNANT_TIME = getStrategyValue('momentumStagnantTime');
  MAX_HOLD_TIME = getStrategyValue('maxHoldTime');
  MC_MIN = getStrategyValue('marketCapLimits.min');
  MC_MAX = getStrategyValue('marketCapLimits.max');
  PUMP_THRESHOLD = getStrategyValue('pumpThreshold');
  BUY_THRESHOLD = getStrategyValue('buyThreshold');
  VOLUME_THRESHOLD = getStrategyValue('volumeThreshold');
  MIN_VOLUME = getStrategyValue('minVolume');
  CREATOR_OWNERSHIP_MAX = getStrategyValue('creatorOwnershipMax');
  USE_DEX_SCREENER_FILTER = getStrategyValue('useDexScreenerFilter');
  TRADE_COOLDOWN_ENABLED = getStrategyValue('tradeCooldownEnabled');
  TRADE_COOLDOWN_PROFIT_CAP = getStrategyValue('tradeCooldownProfitCap');
  TRADE_COOLDOWN_DURATION = getStrategyValue('tradeCooldownDuration');
}

// Watch strategy-config.json for changes
const configPath = path.join(__dirname, 'strategy-config.json');
fs.watch(configPath, async (eventType) => {
  if (eventType === 'change') {
    try {
      console.log('Detected change in strategy-config.json, reloading...');
      await loadStrategyConfig();
      updateStrategyVariables();
      console.log('Strategy configuration reloaded and applied.');
    } catch (err) {
      console.error('Failed to reload strategy config:', err);
    }
  }
});

const TOKEN_SUPPLY = 1_000_000_000; // 1B tokens

// Initialize Solana connection
connection = new Connection(
  `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
  {
    wsEndpoint: WSS_URL,
    commitment: 'processed',
  },
);

// Log to file
async function logToFile(data) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${JSON.stringify(data, null, 2)}\n`;
  try {
    await fs.appendFile(LOG_FILE, logEntry);
  } catch (err) {
    console.error('Error writing to log file:', err);
  }
}

// WebSocket setup
function setupWebSocket() {
  ws = new WebSocket(WSS_URL);

  ws.on('open', () => {
    console.log('Connected to Helius Enhanced WebSocket');
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'transactionSubscribe',
        params: [
          {
            accountInclude: [PUMP_FUN_PROGRAM_ID],
            vote: false,
          },
        ],
      }),
    );
    setInterval(() => ws.send(JSON.stringify({ ping: true })), 5 * 1000);
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'transactionNotification') {
        //await logToFile(msg.params.result);
        processTransaction(msg.params.result);
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    reconnectWebSocket();
  });

  ws.on('close', () => {
    console.log('WebSocket closed, reconnecting...');
    reconnectWebSocket();
  });
}

// Reconnect WebSocket
function reconnectWebSocket() {
  if (ws) ws.close();
  setTimeout(setupWebSocket, 5000);
}

// Add function to fetch SOL price
async function fetchSolPrice() {
    try {
      const response = await axios.get(KUCOIN_API_URL);
      const data = response.data;
      
      if (data.code === '200000' && data.data && data.data.price) {
        const newPrice = parseFloat(data.data.price);
        if (newPrice > 0) {
          currentSolPrice = newPrice;
          lastSolPriceUpdate = Date.now();
          
          // Log price update if it changed significantly (>1%)
          if (Math.abs(newPrice - currentSolPrice) / currentSolPrice > 0.01) {
            console.log(`\nSOL Price Updated: $${newPrice.toFixed(2)}`);
          }
          
          // Update stats with new price
          await saveStats();
        }
      }
    } catch (error) {
      console.error('Error fetching SOL price:', error.message);
    }
  }

// Add function to start price updates
function startSolPriceUpdates() {
  // Initial fetch
  fetchSolPrice();
  
  // Set up interval for updates
  solPriceUpdateInterval = setInterval(fetchSolPrice, 1000);
  
  // Log price updates every minute
  setInterval(() => {
    const timeSinceUpdate = Date.now() - lastSolPriceUpdate;
    if (timeSinceUpdate > 5000) { // If no update in 5 seconds
      console.log(`\nWarning: SOL price hasn't updated in ${Math.floor(timeSinceUpdate/1000)}s`);
    }
  }, 30000);
}

// Modify the displayStats function
function displayStats() {
  const now = Date.now();
  const timeElapsed = (now - stats.lastReset) / 1000; // in seconds
  const timeSincePriceUpdate = (now - lastSolPriceUpdate) / 1000;
  
  //console.clear(); // Clear console for cleaner display
  console.log('\n=== Pump.fun Bot Statistics ===');
  console.log(`Time Elapsed: ${Math.floor(timeElapsed)}s`);
  console.log(`SOL Price: $${currentSolPrice.toFixed(2)} (Updated ${Math.floor(timeSincePriceUpdate)}s ago)`);
  console.log(`MC : $${MC_MIN * currentSolPrice} - $${MC_MAX * currentSolPrice}`);
  
  // Show trading performance
  console.log('\n=== Trading Performance ===');
  console.log(`Total Trades: ${stats.trades.total}`);
  console.log(`Win Rate: ${((stats.trades.wins / stats.trades.total) * 100 || 0).toFixed(2)}%`);
  console.log(`Total PNL: ${stats.trades.totalPnL.toFixed(4)} SOL`);
  console.log(`Wins: ${stats.trades.wins} | Losses: ${stats.trades.losses}`);
  
  
  console.log('\nFilter Failures:');
  console.log(`Market Cap: ${stats.filterStats.mc}`);
  console.log(`Pump %: ${stats.filterStats.pump}`);
  console.log(`Volume: ${stats.filterStats.volume}`);
  console.log(`Buy Count: ${stats.filterStats.buys}`);
  console.log(`Ownership: ${stats.filterStats.ownership}`);
  console.log(`Liquidity: ${stats.filterStats.liquidity}`);
  console.log(`Max Trades: ${stats.filterStats.maxTrades}`);
  console.log(`Cooldown: ${stats.filterStats.cooldown}`);
  
  // Display active trades with market cap
  if (activeTrades.size > 0) {
    console.log('\n=== Active Trades ===');
    for (const [tokenId, trade] of activeTrades) {
      const token = tokenData.get(tokenId);
      if (!token) continue;

      const currentPrice = token.price;
      const profitLoss = ((currentPrice - trade.buyPrice) / trade.buyPrice) * 100;
      const timeHeld = (now - trade.buyTime) / 1000;
      const timeLeft = Math.max(0, (MAX_HOLD_TIME / 1000) - timeHeld);
      const currentMc = currentPrice * TOKEN_SUPPLY * currentSolPrice;
      
      console.log(`\nToken: ${tokenId}`);
      console.log(`Entry: ${trade.buyPrice.toFixed(8)} SOL (MC: $${trade.entryMc.toFixed(2)})`);
      console.log(`Current: ${currentPrice.toFixed(8)} SOL (MC: $${currentMc.toFixed(2)})`);
      console.log(`P/L: ${profitLoss.toFixed(2)}%`);
      console.log(`Amount: ${trade.amount.toFixed(4)} SOL`);
      console.log(`Time Held: ${Math.floor(timeHeld)}s`);
      console.log(`Time Left: ${Math.floor(timeLeft)}s`);
      
      let status = '🟢 Active';
      if (profitLoss >= PROFIT_THRESHOLD * 100) status = '🟡 Take Profit';
      if (profitLoss <= LOSS_THRESHOLD * 100) status = '🔴 Stop Loss';
      if (timeLeft <= 0) status = '⚫ Time Out';
      console.log(`Status: ${status}`);
    }
    console.log('=====================');
  } else {
    console.log('\nNo Active Trades');
  }

  // Show recent trade history with market cap
  if (stats.trades.history.length > 0) {
    console.log('\n=== Recent Trades ===');
    const recentTrades = stats.trades.history.slice(-5).reverse();
    for (const trade of recentTrades) {
      const emoji = trade.netPnL >= 0 ? '🟢' : '🔴';
      console.log(
        `\n${emoji} ${trade.tokenId}`,
        `\nEntry: ${trade.entryPrice.toFixed(8)} SOL (MC: $${trade.entryMc.toFixed(2)})`,
        `\nExit: ${trade.exitPrice.toFixed(8)} SOL (MC: $${trade.exitMc.toFixed(2)})`,
        `\nP/L: ${trade.pnl.toFixed(2)}%`,
        `\nNet: ${trade.netPnL.toFixed(4)} SOL`,
        `\nTime: ${trade.timeHeld}s`,
        `\nReason: ${trade.reason}`
      );
    }
    console.log('=====================');
  }
  
  console.log('=============================\n');
  
  // Save stats after updating display
  saveStats().catch(console.error);
}

// Modify processTransaction to update stats
async function processTransaction(tx) {
  stats.totalTxs++;
  
  const timestamp = Date.now();
  const signature = tx.signature || 'unknown';
  
  // Fix transaction data access
  const transactionData = tx.transaction?.transaction?.[0];
  if (!transactionData) return;

  const meta = tx.transaction?.meta || {};
  
  // Check if transaction failed
  if (meta.err !== null) {
    stats.failedTxs++;
    return;
  }

  const preBalances = meta.preBalances || [];
  const postBalances = meta.postBalances || [];
  const preTokenBalances = meta.preTokenBalances || [];
  const postTokenBalances = meta.postTokenBalances || [];
  const logMessages = meta.logMessages || [];

  // Check for Pump.fun instruction in log messages
  const isPumpFunTx = logMessages.some(log => log.includes(PUMP_FUN_PROGRAM_ID));
  if (!isPumpFunTx) return;
  stats.pumpFunTxs++;

  // Determine buy or sell
  let isBuy = false;
  let amountSol = 0;
  let tokenAmount = 0;
  let tokenId = 'unknown';
  let pricePerToken = 0;

  // Check instruction type
  const isSell = logMessages.some((log) => log.includes('Instruction: Sell'));
  if (isSell) return;
  
  isBuy = logMessages.some((log) => log.includes('Instruction: Buy'));
  if (!isBuy) return;
  stats.buyTxs++;

  // Find trader's wallet (first account)
  if (preBalances[0] && postBalances[0]) {
    amountSol = (preBalances[0] - postBalances[0]) / LAMPORTS_PER_SOL;
    if (amountSol <= 0) return;
    isBuy = true;
  } else return;

  // Find token mint and amount
  for (let i = 0; i < postTokenBalances.length; i++) {
    const post = postTokenBalances[i];
    const pre = preTokenBalances.find((p) => p.accountIndex === post.accountIndex && p.mint === post.mint) || {
      uiTokenAmount: { uiAmount: 0 },
    };
    if (post.mint && post.uiTokenAmount.uiAmount > pre.uiTokenAmount.uiAmount) {
      tokenId = post.mint;
      tokenAmount = post.uiTokenAmount.uiAmount - pre.uiTokenAmount.uiAmount;
      break;
    }
  }

  // Calculate price
  if (isBuy && amountSol > 0 && tokenAmount > 0) {
    pricePerToken = amountSol / tokenAmount;
  }

  // Initialize token data if it doesn't exist
  if (!tokenData.has(tokenId)) {
    tokenData.set(tokenId, {
      price: 0,
      lastPrice: 0,
      volume: [],
      buys: [],
      marketCap: 0,
      lastVolume: 0,
      lastUpdate: 0,
      name: null,
      symbol: null,
      creator: null,
      virtual_sol_reserves: 0,
      virtual_token_reserves: 0,
      bonding_curve: null,
      associated_bonding_curve: null,
      totalSupply: 0
    });
  }

  // Update the token data with accurate information
  const coinData = await fetchAccurateCoinData(tokenId);
  if (!coinData) {
    // Skip this token if we couldn't get valid data
    return;
  }

  const token = tokenData.get(tokenId);
  token.lastPrice = token.price;
  token.price = coinData.price;
  token.marketCap = coinData.marketCap;
  token.totalSupply = coinData.totalSupply;
  token.lastUpdate = Date.now();
  token.name = coinData.name;
  token.symbol = coinData.symbol;
  token.creator = coinData.creator;
  token.virtual_sol_reserves = coinData.virtual_sol_reserves;
  token.virtual_token_reserves = coinData.virtual_token_reserves;
  token.bonding_curve = coinData.bonding_curve;
  token.associated_bonding_curve = coinData.associated_bonding_curve;

  // Track buys (30-second window)
  if (isBuy && amountSol >= 0.1 && amountSol <= 0.5) {
    token.buys.push({ timestamp, amount: amountSol });
    token.buys = token.buys.filter((b) => timestamp - b.timestamp <= 30 * 1000);
  }

  // Track volume (1-minute window)
  token.volume.push({ timestamp, amount: amountSol });
  token.volume = token.volume.filter((v) => timestamp - v.timestamp <= 60 * 1000);
  const currentVolume = token.volume.reduce((sum, v) => sum + v.amount, 0) * currentSolPrice;
  const volumeSpike = token.lastVolume > 0 ? (currentVolume / token.lastVolume) * 100 : 0;
  token.lastVolume = currentVolume;

  // Check filters and update stats
  if (token.marketCap < MC_MIN || token.marketCap > MC_MAX) {
    //console.log(`\nMarket Cap Filter Failed for ${tokenId}:`);
    //console.log(`Token: ${token.name || 'Unknown'} (${token.symbol || 'Unknown'})`);
    //console.log(`Market Cap: ${token.marketCap} SOL ($${token.marketCap * SOL_PRICE})`);
    //console.log(`Min Required: ${MC_MIN} SOL ($${MC_MIN * SOL_PRICE})`);
    //console.log(`Max Allowed: ${MC_MAX} SOL ($${MC_MAX * SOL_PRICE})`);
    stats.filterStats.mc++;
    return;
  }

  const pumpPercent = token.lastPrice > 0 ? (token.price / token.lastPrice - 1) * 100 : 0;
  if (pumpPercent < PUMP_THRESHOLD * 100) {
    stats.filterStats.pump++;
    return;
  }

  if (token.buys.length < BUY_THRESHOLD) {
    stats.filterStats.buys++;
    return;
  }

  if (volumeSpike < VOLUME_THRESHOLD) {
    stats.filterStats.volume++;
    return;
  }

  if (currentVolume < MIN_VOLUME) {
    stats.filterStats.volume++;
    return;
  }

  // Only log if we have a valid token that passed all filters
  console.log(`\n=== New Token Found ===`);
  console.log(`Token: ${tokenId}`);
  console.log(`MC: $${token.marketCap.toFixed(2)}`);
  console.log(`Pump: ${pumpPercent.toFixed(2)}%`);
  console.log(`Volume: $${currentVolume.toFixed(2)} (${volumeSpike.toFixed(2)}% spike)`);
  console.log(`Buys (30s): ${token.buys.length}`);
  console.log(`Price: ${pricePerToken.toFixed(8)} SOL/token`);
  console.log(`Amount: ${tokenAmount.toFixed(2)} tokens`);
  console.log(`SOL Spent: ${amountSol.toFixed(4)} SOL`);
  console.log('=====================\n');

  // Display updated stats
  displayStats();

  // Continue with trade execution if all checks pass
  checkFilters(tokenId, token, currentVolume, volumeSpike, timestamp);
}

// Modify checkFilters to update ownership and liquidity stats
async function checkFilters(tokenId, token, currentVolume, volumeSpike, timestamp) {
  if (activeTrades.size >= MAX_TR) return;

  // Check if we already have an active position
  if (activeTrades.has(tokenId)) return;

  let dexCheckPromise = null; 
  if (USE_DEX_SCREENER_FILTER) {
    // Start DexScreener check in parallel with other filters if enabled
    dexCheckPromise = isDexPaid(tokenId);
  }

  // Check cooldown period
  const lastTradeTime = stats.trades.lastTradeTime.get(tokenId);
  if (lastTradeTime) {
    const timeSinceLastTrade = timestamp - lastTradeTime;
    if (timeSinceLastTrade < TRADE_COOLDOWN) {
      const remainingCooldown = Math.ceil((TRADE_COOLDOWN - timeSinceLastTrade) / 1000 / 60); // in minutes
      console.log(`\nSkipping ${token.name || tokenId} - Cooldown period (${remainingCooldown} minutes remaining)`);
      stats.filterStats.cooldown++;
      return;
    }
  }

  // Check if we've exceeded max trades for this token
  const tokenTradeCount = stats.trades.tokenTradeCounts.get(tokenId) || 0;
  if (tokenTradeCount >= MAX_TRADES_PER_TOKEN) {
    stats.filterStats.maxTrades++;
    return;
  }

  const ownership = await checkCreatorOwnership(tokenId);
  if (ownership > CREATOR_OWNERSHIP_MAX) {
    stats.filterStats.ownership++;
    return;
  }

  const isLocked = await checkLiquidity(tokenId);
  if (!isLocked) {
    stats.filterStats.liquidity++;
    return;
  }

  // Wait for DexScreener check result if enabled
  if (USE_DEX_SCREENER_FILTER) {
    const isPaid = await dexCheckPromise;
    if (!isPaid) {
      console.log(`\nSkipping ${token.name || tokenId} - Not a paid DexScreener token`);
      return;
    }
  }

  // If we get here, all checks passed
  executeTrade(tokenId, token, timestamp);
}

// Placeholder: Check creator ownership
async function checkCreatorOwnership(tokenId) {
  console.log(`Checking ownership for ${tokenId} (Solscan manual)`);
  return 0.1; // Mock 10%
}

// Placeholder: Check liquidity
async function checkLiquidity(tokenId) {
  console.log(`Checking liquidity for ${tokenId} (Solscan manual)`);
  return true; // Mock locked
}

// Execute trade
async function executeTrade(tokenId, token, buyTime) {
    try {
      let buyPrice = token.price;
      // Check if already trading this token
      if (activeTrades.has(tokenId)) return;

      // Get current trade count for this token
      const currentCount = stats.trades.tokenTradeCounts.get(tokenId) || 0;
      
      // Check if we've traded this token too many times
      if (currentCount >= MAX_TR) {
        console.log(`Skipping ${tokenId} - Max trades reached (${currentCount}/${MAX_TR})`);
        return;
      }

      // Check if we've traded this token recently
      const lastTradeTime = stats.trades.lastTradeTime.get(tokenId);
      if (lastTradeTime && Date.now() - lastTradeTime < TRADE_COOLDOWN) {
        console.log(`Skipping ${tokenId} - In cooldown period`);
        return;
      }

      // Update trade statistics
      stats.trades.tokenTradeCounts.set(tokenId, currentCount + 1);
      stats.trades.lastTradeTime.set(tokenId, buyTime);

      // Set active trade BEFORE executing buy
      activeTrades.set(tokenId, { 
        buyPrice, 
        buyTime, 
        amount: TRADE_AMOUNT,
        entryMc: buyPrice * TOKEN_SUPPLY * currentSolPrice,
        tradeCount: currentCount + 1
      });
      const buyResult = await pumpFunBuy({
        tokenMintAddress: tokenId,
        buyerPrivateKey: process.env.WALLET_PRIVATE_KEY,
        buyAmountSol: TRADE_AMOUNT,
        slippageDecimal: 0.05,
        useJito: false,
        createAccount: false,
        randomizePlatform: false,
        dynamicCompute: true,
        virtual_sol_reserves: token.virtual_sol_reserves,
        virtual_token_reserves: token.virtual_token_reserves,
        bonding_curve: token.bonding_curve,
        associated_bonding_curve: token.associated_bonding_curve,
        tokenCreator: token.creator
      });

      // Validate buy result
      if (!buyResult || !buyResult.txId) {
        console.log('Buy transaction failed - No transaction ID returned');
        activeTrades.delete(tokenId);
        return;
      }

      // Check transaction status with retries
      const txCheck = await checkTransactionStatus(buyResult.txId);
      if (!txCheck.success) {
        console.log(`Buy transaction failed: ${txCheck.error}`);
        activeTrades.delete(tokenId);
        return;
      }

      console.log(`\n✅ Buy transaction successful! => ${buyResult.txId}`);
      
      // Start monitoring the trade
      monitorTrade(tokenId);
      
    } catch (error) {
      console.error(`Error executing trade: ${error.message}`);
      // Clean up active trade if it exists
      if (activeTrades.has(tokenId)) {
        activeTrades.delete(tokenId);
      }
    }
}

// Add price fetch interval constant
const PRICE_FETCH_INTERVAL = 300; // Fetch price every 2 seconds

// Modify monitorTrade to include active price fetching
function monitorTrade(tokenId) {
  const trade = activeTrades.get(tokenId);
  let lastPrice = trade.buyPrice;
  let lastPriceTime = trade.buyTime;
  let stagnantStartTime = null;
  let lastFetchTime = 0;
  let priceFetchInterval;
  let monitorInterval;
  let isClosing = false; // Add flag to prevent double closure
  
  // Function to update token price
  async function updateTokenPrice() {
    try {
      const currentTime = Date.now();
      // Only fetch if enough time has passed
      if (currentTime - lastFetchTime < PRICE_FETCH_INTERVAL) return;
      
      const coinData = await fetchAccurateCoinData(tokenId);
      if (!coinData) return;

      const token = tokenData.get(tokenId);
      if (!token) return;

      // Update token data with fetched price
      token.lastPrice = token.price;
      token.price = coinData.price;
      token.marketCap = coinData.marketCap;
      token.lastUpdate = currentTime;
      lastFetchTime = currentTime;

      // Save updated trade data
      await saveActiveTrades();

      // Check if we're in cooldown and the position is profitable
      if (TRADE_COOLDOWN_ACTIVE && trade.pnl > 0) {
        console.log(`Closing profitable position for ${trade.tokenSymbol} during cooldown`);
        await closeTrade(tokenId, 'Cooldown: Profit cap reached', true);
        return;
      }
    } catch (error) {
      console.error(`Error fetching price for ${tokenId}:`, error.message);
    }
  }

  // Start price fetch interval
  priceFetchInterval = setInterval(updateTokenPrice, PRICE_FETCH_INTERVAL);
  
  // Initial price fetch
  updateTokenPrice();
  
  monitorInterval = setInterval(async () => {
    const currentTime = Date.now();
    const token = tokenData.get(tokenId);
    if (!token || !trade || isClosing) {
      clearInterval(monitorInterval);
      clearInterval(priceFetchInterval);
      activeTrades.delete(tokenId);
      await saveActiveTrades();
      displayStats();
      return;
    }

    // Update active trades file
    await saveActiveTrades();

    const currentPrice = token.price;
    const profitLoss = (currentPrice - trade.buyPrice) / trade.buyPrice;
    const currentMc = currentPrice * TOKEN_SUPPLY * currentSolPrice;

    // Function to handle trade closure
    const closeTrade = async (reason, isWin = true) => {
      if (isClosing) return; // Prevent double closure
      isClosing = true;

      try {
        // Execute sell transaction
        const sellResult = await pumpFunSell({
          tokenMintAddress: tokenId,
          sellerPrivateKey: process.env.WALLET_PRIVATE_KEY,
          sellPercentage: 100, // Sell entire position
          slippageDecimal: 0.1,
          useJito: false,
          dynamicCompute: true
        });

        // Validate sell result
        if (!sellResult || !sellResult.txId) {
          console.log('Sell transaction failed - No transaction ID returned');
          isClosing = false;
          return;
        }

        // Check transaction status with retries
        const txCheck = await checkTransactionStatus(sellResult.txId);
        if (!txCheck.success) {
          console.log(`Sell transaction failed: ${txCheck.error}`);
          
          // Retry sell with exponential backoff
          const maxRetries = 3;
          const baseDelay = 200; // 2 seconds
          
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
            console.log(`Retrying sell transaction (attempt ${attempt}/${maxRetries}) after ${delay}ms delay...`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
              const retrySellResult = await pumpFunSell({
                tokenMintAddress: tokenId,
                sellerPrivateKey: process.env.WALLET_PRIVATE_KEY,
                sellPercentage: 100,
                slippageDecimal: 0.1,
                useJito: false,
                dynamicCompute: true
              });
              
              if (retrySellResult && retrySellResult.txId) {
                const retryTxCheck = await checkTransactionStatus(retrySellResult.txId);
                if (retryTxCheck.success) {
                  console.log(`Sell transaction succeeded on retry attempt ${attempt}`);
                  // Get actual sell price from retry transaction
                  const retryDetails = await extractTransactionDetails(retryTxCheck.status, tokenId, BOT_PUBLIC_KEY_BASE58);
                  const actualSellPrice = Math.abs(retryDetails.solChange / retryDetails.tokenChange);
                  console.log(`Actual sell price: ${actualSellPrice.toFixed(12)} SOL per token`);
                  
                  // Calculate PNL using actual sell price
                  const actualProfitLoss = (actualSellPrice - trade.buyPrice) / trade.buyPrice;
                  const actualGain = actualProfitLoss * trade.amount;
                  const fees = 0;
                  const net = actualGain - fees;
                  const timeHeld = (currentTime - trade.buyTime) / 1000;
                  const actualExitMc = actualSellPrice * TOKEN_SUPPLY * currentSolPrice;

                  // Update trade statistics
                  stats.trades.total++;
                  if (isWin) stats.trades.wins++;
                  else stats.trades.losses++;
                  stats.trades.totalPnL += net;

                  // Prepare trade data for saving
                  const tradeData = {
                    tokenId,
                    tokenName: token.name,
                    tokenSymbol: token.symbol,
                    entryPrice: trade.buyPrice,
                    exitPrice: actualSellPrice,
                    entryMc: trade.entryMc,
                    exitMc: actualExitMc,
                    pnl: actualProfitLoss * 100,
                    netPnL: net,
                    timeHeld: Math.floor(timeHeld),
                    reason,
                    amount: trade.amount,
                    tradeCount: trade.tradeCount,
                    fees,
                    marketCap: actualExitMc,
                    volume: token.volume.reduce((sum, v) => sum + v.amount, 0),
                    buysInWindow: token.buys.length,
                    lastPriceUpdate: lastFetchTime,
                    sellTxId: retrySellResult.txId
                  };

                  // Save trade data
                  await saveTradeData(tradeData);
                  await saveStats();

                  // Add to trade history
                  stats.trades.history.push({
                    ...tradeData,
                    timestamp: currentTime
                  });

                  // Keep only last 100 trades in history
                  if (stats.trades.history.length > 100) {
                    stats.trades.history.shift();
                  }

                  // Log trade closure
                  await logToFile({
                    type: 'TRADE_CLOSED',
                    ...tradeData,
                    timestamp: new Date().toISOString()
                  });

                  console.log(`\n=== Trade Closed: ${reason} ===`);
                  console.log(`Token: ${token.name || tokenId} (${token.symbol || 'Unknown'})`);
                  console.log(`Profit: ${(actualProfitLoss * 100).toFixed(2)}%`);
                  console.log(`Net PNL: ${net.toFixed(4)} SOL`);
                  console.log(`Time Held: ${Math.floor(timeHeld)}s`);
                  console.log(`Sell TX: ${retrySellResult.txId}`);
                  console.log('===========================\n');

                  clearInterval(monitorInterval);
                  clearInterval(priceFetchInterval);
                  activeTrades.delete(tokenId);
                  displayStats();
                  break;
                }
              }
              
              if (attempt === maxRetries) {
                console.log('All sell retry attempts failed');
                isClosing = false;
                return;
              }
            } catch (retryError) {
              console.log(`Retry attempt ${attempt} failed:`, retryError);
              if (attempt === maxRetries) {
                console.log('All sell retry attempts failed');
                isClosing = false;
                return;
              }
            }
          }
        } else {
          // Get actual sell price from transaction
          const details = await extractTransactionDetails(txCheck.status, tokenId, BOT_PUBLIC_KEY_BASE58);
          const actualSellPrice = Math.abs(details.solChange / details.tokenChange);
          console.log(`Actual sell price: ${actualSellPrice.toFixed(12)} SOL per token`);
          
          // Calculate PNL using actual sell price
          const actualProfitLoss = (actualSellPrice - trade.buyPrice) / trade.buyPrice;
          const actualGain = actualProfitLoss * trade.amount;
          const fees = 0;
          const net = actualGain - fees;
          const timeHeld = (currentTime - trade.buyTime) / 1000;
          const actualExitMc = actualSellPrice * TOKEN_SUPPLY * currentSolPrice;

          // Update trade statistics
          stats.trades.total++;
          if (isWin) stats.trades.wins++;
          else stats.trades.losses++;
          stats.trades.totalPnL += net;

          // Prepare trade data for saving
          const tradeData = {
            tokenId,
            tokenName: token.name,
            tokenSymbol: token.symbol,
            entryPrice: trade.buyPrice,
            exitPrice: actualSellPrice,
            entryMc: trade.entryMc,
            exitMc: actualExitMc,
            pnl: actualProfitLoss * 100,
            netPnL: net,
            timeHeld: Math.floor(timeHeld),
            reason,
            amount: trade.amount,
            tradeCount: trade.tradeCount,
            fees,
            marketCap: actualExitMc,
            volume: token.volume.reduce((sum, v) => sum + v.amount, 0),
            buysInWindow: token.buys.length,
            lastPriceUpdate: lastFetchTime,
            sellTxId: sellResult.txId
          };

          // Save trade data
          await saveTradeData(tradeData);
          await saveStats();

          // Add to trade history
          stats.trades.history.push({
            ...tradeData,
            timestamp: currentTime
          });

          // Keep only last 100 trades in history
          if (stats.trades.history.length > 100) {
            stats.trades.history.shift();
          }

          // Log trade closure
          await logToFile({
            type: 'TRADE_CLOSED',
            ...tradeData,
            timestamp: new Date().toISOString()
          });

          console.log(`\n=== Trade Closed: ${reason} ===`);
          console.log(`Token: ${token.name || tokenId} (${token.symbol || 'Unknown'})`);
          console.log(`Profit: ${(actualProfitLoss * 100).toFixed(2)}%`);
          console.log(`Net PNL: ${net.toFixed(4)} SOL`);
          console.log(`Time Held: ${Math.floor(timeHeld)}s`);
          console.log(`Sell TX: ${sellResult.txId}`);
          console.log('===========================\n');

          clearInterval(monitorInterval);
          clearInterval(priceFetchInterval);
          activeTrades.delete(tokenId);
          displayStats();
        }
      } catch (error) {
        console.error(`Error closing trade: ${error.message}`);
        isClosing = false;
      }
    };

    // Check for momentum stagnation
    if (profitLoss >= MOMENTUM_PROFIT_THRESHOLD) {
      const priceChange = Math.abs(currentPrice - lastPrice) / lastPrice;
      
      // Define price change thresholds based on profit level
      let priceChangeThreshold;
      if (profitLoss >= MOMENTUM_PROFIT_THRESHOLD_4) {
        priceChangeThreshold = MOMENTUM_PRICE_CHANGE_THRESHOLD_4; // 15% price change required at 80%+ profit
      } else if (profitLoss >= MOMENTUM_PROFIT_THRESHOLD_3) {
        priceChangeThreshold = MOMENTUM_PRICE_CHANGE_THRESHOLD_3; // 12% price change required at 60%+ profit
      } else if (profitLoss >= MOMENTUM_PROFIT_THRESHOLD_2) {
        priceChangeThreshold = MOMENTUM_PRICE_CHANGE_THRESHOLD_2; // 8% price change required at 30%+ profit
      } else if (profitLoss >= MOMENTUM_PROFIT_THRESHOLD_1) {
        priceChangeThreshold = MOMENTUM_PRICE_CHANGE_THRESHOLD_1; // 5% price change required at 15%+ profit
      } else {
        priceChangeThreshold = 0.01; // 1% price change required at 2%+ profit
      }

      // Check if price change is below threshold
      if (priceChange < priceChangeThreshold) {
        if (!stagnantStartTime) {
          stagnantStartTime = currentTime;
          console.log(`Price change (${(priceChange * 100).toFixed(2)}%) below threshold (${(priceChangeThreshold * 100).toFixed(2)}%) at ${(profitLoss * 100).toFixed(2)}% profit`);
        } else if (currentTime - stagnantStartTime >= MOMENTUM_STAGNANT_TIME) {
          console.log(`Momentum faded: Price change (${(priceChange * 100).toFixed(2)}%) below threshold (${(priceChangeThreshold * 100).toFixed(2)}%) for ${MOMENTUM_STAGNANT_TIME/1000}s at ${(profitLoss * 100).toFixed(2)}% profit`);
          await closeTrade('Momentum Faded', true);
          return;
        }
      } else {
        // Reset stagnant timer if price change is above threshold
        if (stagnantStartTime) {
          console.log(`Price change (${(priceChange * 100).toFixed(2)}%) above threshold (${(priceChangeThreshold * 100).toFixed(2)}%), resetting stagnant timer`);
          stagnantStartTime = null;
        }
      }
    } else if (profitLoss >= 0) {
      // Monitor stagnation for small profits (0% to 2%)
      const priceChange = Math.abs(currentPrice - lastPrice) / lastPrice;
      
      if (priceChange < NEUTRAL_ZONE_PRICE_CHANGE_THRESHOLD) {
        if (!stagnantStartTime) {
          stagnantStartTime = currentTime;
          console.log(`Small profit stagnation: Price change (${(priceChange * 100).toFixed(2)}%) below threshold (${(NEUTRAL_ZONE_PRICE_CHANGE_THRESHOLD * 100).toFixed(2)}%) at ${(profitLoss * 100).toFixed(2)}% profit`);
        } else if (currentTime - stagnantStartTime >= MOMENTUM_STAGNANT_TIME) {
          console.log(`Small profit exit: Price stagnant at ${(priceChange * 100).toFixed(2)}% for ${MOMENTUM_STAGNANT_TIME/1000}s with ${(profitLoss * 100).toFixed(2)}% profit`);
          await closeTrade('Neutral Zone Stagnation', true);
          return;
        }
      } else {
        // Reset stagnant timer if price is moving
        if (stagnantStartTime) {
          console.log(`Small profit: Price change (${(priceChange * 100).toFixed(2)}%) above threshold (${(NEUTRAL_ZONE_PRICE_CHANGE_THRESHOLD * 100).toFixed(2)}%), resetting stagnant timer`);
          stagnantStartTime = null;
        }
      }
    }

    if (profitLoss < 0 && profitLoss >= -LOSS_THRESHOLD_TRAIL) {
      const priceChange = Math.abs(currentPrice - lastPrice) / lastPrice;
      if (priceChange < LOSS_EARLY_PRICE_CHANGE_THRESHOLD) {
        if (!stagnantStartTime) {
          stagnantStartTime = currentTime;
          console.log(`Early loss protection: Price change (${(priceChange * 100).toFixed(2)}%) below threshold (${(LOSS_EARLY_PRICE_CHANGE_THRESHOLD * 100).toFixed(2)}%) at ${(profitLoss * 100).toFixed(2)}% loss`);
        } else if (currentTime - stagnantStartTime >= MOMENTUM_STAGNANT_TIME) {
          console.log(`Early loss protection triggered: Price stagnant at ${(priceChange * 100).toFixed(2)}% for ${MOMENTUM_STAGNANT_TIME/1000}s with ${(profitLoss * 100).toFixed(2)}% loss`);
          await closeTrade('Early loss Protection', false);
          return;
        }
      } else {
        // Reset stagnant timer if price is moving
        if (stagnantStartTime) {
          console.log(`Loss protection: Price change (${(priceChange * 100).toFixed(2)}%) above threshold (${(LOSS_EARLY_PRICE_CHANGE_THRESHOLD * 100).toFixed(2)}%), resetting stagnant timer`);
          stagnantStartTime = null;
        }
      }
    }
    // Check for loss protection
    if (profitLoss < -LOSS_THRESHOLD_TRAIL) {
      const priceChange = Math.abs(currentPrice - lastPrice) / lastPrice;
      // If we're in loss and price is stagnant, sell
      if (priceChange < LOSS_PRICE_CHANGE_THRESHOLD_TRAIL) {
        if (!stagnantStartTime) {
          stagnantStartTime = currentTime;
          console.log(`Loss protection: Price change (${(priceChange * 100).toFixed(2)}%) below threshold (${(LOSS_PRICE_CHANGE_THRESHOLD_TRAIL * 100).toFixed(2)}%) at ${(profitLoss * 100).toFixed(2)}% loss`);
        } else if (currentTime - stagnantStartTime >= MOMENTUM_STAGNANT_TIME) {
          console.log(`Loss protection triggered: Price stagnant at ${(priceChange * 100).toFixed(2)}% for ${MOMENTUM_STAGNANT_TIME/1000}s with ${(profitLoss * 100).toFixed(2)}% loss`);
          await closeTrade('Loss Protection', false);
          return;
        }
      } else {
        // Reset stagnant timer if price is moving
        if (stagnantStartTime) {
          console.log(`Loss protection: Price change (${(priceChange * 100).toFixed(2)}%) above threshold (${(LOSS_PRICE_CHANGE_THRESHOLD_TRAIL * 100).toFixed(2)}%), resetting stagnant timer`);
          stagnantStartTime = null;
        }
      }
    }

    // Update last price and time
    lastPrice = currentPrice;
    lastPriceTime = currentTime;

    // Regular exit conditions
    if (profitLoss >= PROFIT_THRESHOLD) {
      await closeTrade('Take Profit', true);
    } else if (profitLoss <= LOSS_THRESHOLD) {
      await closeTrade('Stop Loss', false);
    } else if (currentTime - trade.buyTime >= MAX_HOLD_TIME) {
      await closeTrade('Time Out', profitLoss > 0);
    }
  }, 100);

  // Add cleanup for price fetch interval
  process.on('SIGINT', () => {
    if (priceFetchInterval) {
      clearInterval(priceFetchInterval);
    }
    if (monitorInterval) {
      clearInterval(monitorInterval);
    }
  });
}

// Start bot
async function startBot() {
  try {
    // Load strategy configuration first and wait for it to complete
    await loadStrategyConfig();
    
    // Initialize connection
    connection = new Connection(HELIUS_RPC_URL, 'confirmed');
    
    // Start SOL price updates
    startSolPriceUpdates();
    
    // Setup WebSocket connection
    setupWebSocket();
    
    // Start stats display
    setInterval(displayStats, 1000);
    
    console.log('Bot started successfully');
  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
}

// Add periodic stats display
setInterval(displayStats, 1000); // Update stats every 5 seconds

// Run
startBot().catch(console.error);

// Add function to fetch accurate coin data
async function fetchAccurateCoinData(tokenId) {
    try {
        const mint = new PublicKey(tokenId);
        const bondingCurvePDA = getBondingCurvePDA(mint, PUMP_FUN_PROGRAM_ID);
        const associatedBondingCurve = await getAssociatedTokenAddress(mint, bondingCurvePDA, true);
        const metadataPDA = getMetadataPDA(mint);
        
        // Fetch both bonding curve and metadata account data
        const [bondingCurveAccount, metadataAccount] = await Promise.all([
            connection.getAccountInfo(bondingCurvePDA),
            connection.getAccountInfo(metadataPDA)
        ]);
        
        if (!bondingCurveAccount) {
            //console.log(`Skipping invalid token ${tokenId} - No bonding curve account`);
            return null;
        }
        
        // Parse the bonding curve data
        const parsedData = parseBondingCurveData(bondingCurveAccount.data);
        
        if (!parsedData) {
            //console.log(`Skipping corrupted token ${tokenId} - Invalid bonding curve data`);
            return null;
        }
        
        // Parse metadata if available
        let metadata = { name: null, symbol: null };
        if (metadataAccount) {
            metadata = parseMetadata(metadataAccount.data);
        }

        // Get raw values
        const virtualSolReserves = BigInt(parsedData.virtual_sol_reserves); // in lamports (9 decimals)
        const virtualTokenReserves = BigInt(parsedData.virtual_token_reserves); // in 6 decimals
        const tokenTotalSupply = BigInt(parsedData.token_total_supply); // in 6 decimals

        // Additional validation checks
        if (virtualTokenReserves === BigInt(0)) {
            //console.log(`Skipping invalid token ${tokenId} - Zero token reserves`);
            return null;
        }

        if (tokenTotalSupply === BigInt(0)) {
            //console.log(`Skipping invalid token ${tokenId} - Zero total supply`);
            return null;
        }

        // Calculate price per token in SOL (with 9 decimals)
        const pricePerToken = ((virtualSolReserves * BigInt(1e9)) / virtualTokenReserves);
        //console.log((Number(pricePerToken)/1e12).toFixed(12))    
        // Calculate market cap in SOL (with 9 decimals)
        const marketCapSol = (pricePerToken * tokenTotalSupply) / BigInt(1e9);
        //console.log(Number(marketCapSol/BigInt(1e9))) 

        return {
            price: Number(pricePerToken) / 1e12, // Convert to actual SOL amount
            marketCap: Number(marketCapSol) / 1e9, // Convert to actual SOL amount
            totalSupply: Number(tokenTotalSupply) / 1e6, // Convert to actual token amount
            name: metadata.name,
            symbol: metadata.symbol,
            virtual_sol_reserves: Number(parsedData.virtual_sol_reserves),
            virtual_token_reserves: Number(parsedData.virtual_token_reserves),
            bonding_curve: bondingCurvePDA.toBase58(),
            associated_bonding_curve: associatedBondingCurve.toBase58(),
            creator: parsedData.creator,
            realSolReserves: Number(parsedData.real_sol_reserves), // Convert to SOL
            realTokenReserves: Number(parsedData.real_token_reserves) // Convert to actual token amount
        };
      } catch (error) {
        console.log(`Error processing token ${tokenId}: ${error.message}`);
        return null;
    }
}

// Helper functions for PDAs
function getBondingCurvePDA(mint, programId) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('bonding-curve'), mint.toBuffer()],
        new PublicKey(programId)
    )[0];
}

function getMetadataPDA(mint) {
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from('metadata'),
            METADATA_PROGRAM_ID.toBuffer(),
            mint.toBuffer(),
        ],
        METADATA_PROGRAM_ID
    )[0];
}

// Add parsing functions
function parseMetadata(data) {
    try {
        // Metadata account structure:
        // 1 byte: key
        // 32 bytes: update authority
        // 32 bytes: mint
        // Variable: name (max 32 bytes, null-terminated)
        // Variable: symbol (max 10 bytes, null-terminated)
        // Variable: uri (max 200 bytes, null-terminated)
        
        let offset = 1 + 32 + 32; // Skip key, update authority, and mint
        
        // Read name (next 4 bytes are length, then the string)
        const nameLength = data.readUInt32LE(offset);
        offset += 4;
        const nameBytes = data.subarray(offset, offset + nameLength);
        const name = nameBytes.toString('utf8').replace(/\0/g, '').trim();
        offset += nameLength;
        
        // Read symbol (next 4 bytes are length, then the string)
        const symbolLength = data.readUInt32LE(offset);
        offset += 4;
        const symbolBytes = data.subarray(offset, offset + symbolLength);
        const symbol = symbolBytes.toString('utf8').replace(/\0/g, '').trim();
        
        return {
            name,
            symbol
        };
    } catch (error) {
        console.error('Error parsing metadata:', error);
        // Fallback: try simple parsing for fixed-length fields
        try {
            let offset = 1 + 32 + 32; // Skip key, update authority, and mint
            
            // Try reading as fixed 32-byte name and 10-byte symbol
            const nameBytes = data.subarray(offset, offset + 32);
            const name = nameBytes.toString('utf8').replace(/\0/g, '').trim();
            offset += 32;
            
            const symbolBytes = data.subarray(offset, offset + 10);
            const symbol = symbolBytes.toString('utf8').replace(/\0/g, '').trim();
            
            return { name, symbol };
        } catch (fallbackError) {
            console.error('Fallback parsing also failed:', fallbackError);
            return { name: null, symbol: null };
        }
    }
}

function parseBondingCurveData(data) {
    try {
        // Based on testing, the correct data starts at offset 8
        let offset = 8;
        
        // Parse the fields in the correct order as shown on Solscan
        const virtual_token_reserves = data.readBigUInt64LE(offset);
        offset += 8;
        
        const virtual_sol_reserves = data.readBigUInt64LE(offset);
        offset += 8;
        
        const real_token_reserves = data.readBigUInt64LE(offset);
        offset += 8;
        
        const real_sol_reserves = data.readBigUInt64LE(offset);
        offset += 8;
        
        const token_total_supply = data.readBigUInt64LE(offset);
        offset += 8;
        
        // Parse the complete flag
        const complete = data.readUInt8(offset);
        offset += 1;
        
        // Parse the creator pubkey (32 bytes)
        let creator = null;
        if (offset + 32 <= data.length) {
            const creatorBytes = data.subarray(offset, offset + 32);
            creator = new PublicKey(creatorBytes).toBase58();
        }
        
        return {
            virtual_token_reserves: virtual_token_reserves.toString(),
            virtual_sol_reserves: virtual_sol_reserves.toString(),
            real_token_reserves: real_token_reserves.toString(),
            real_sol_reserves: real_sol_reserves.toString(),
            token_total_supply: token_total_supply.toString(),
            complete: complete === 1,
            creator: creator
        };
    } catch (error) {
        console.error('Error parsing bonding curve data:', error);
        return null;
    }
}
// Add function to save trade data
async function saveTradeData(tradeData) {
  try {
    // Read existing trades
    let trades = [];
    try {
      const existingData = await fs.readFile(TRADES_FILE, 'utf8');
      trades = JSON.parse(existingData);
    } catch (err) {
      // File doesn't exist or is invalid, start with empty array
    }

    // Generate unique trade ID
    const tradeId = `${tradeData.tokenId}-${Date.now()}`;
    
    // Check if trade already exists
    const existingTradeIndex = trades.findIndex(t => 
      t.tokenId === tradeData.tokenId && 
      t.entryPrice === tradeData.entryPrice && 
      t.exitPrice === tradeData.exitPrice &&
      Math.abs(new Date(t.timestamp) - new Date()) < 5000 // Within 5 seconds
    );

    if (existingTradeIndex !== -1) {
      console.log('Trade already exists, skipping duplicate');
      return;
    }

    // Add new trade with timestamp
    const tradeWithTimestamp = {
      ...tradeData,
      timestamp: new Date().toISOString(),
      tradeId
    };

    // Add to trades array
    trades.push(tradeWithTimestamp);

    // Sort trades by timestamp (most recent first)
    trades.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Keep only last 1000 trades
    if (trades.length > 1000) {
      trades = trades.slice(0, 1000);
    }

    // Save updated trades
    await fs.writeFile(TRADES_FILE, JSON.stringify(trades, null, 2));
  } catch (err) {
    console.error('Error saving trade data:', err);
  }
}

// Modify saveStats to include SOL price
async function saveStats() {
  try {
    const statsData = {
      ...stats,
      timestamp: new Date().toISOString(),
      solPrice: {
        current: currentSolPrice,
        lastUpdate: new Date(lastSolPriceUpdate).toISOString()
      },
      trades: {
        ...stats.trades,
        tokenTradeCounts: Object.fromEntries(stats.trades.tokenTradeCounts),
        lastTradeTime: Object.fromEntries(stats.trades.lastTradeTime)
      }
    };

    await fs.writeFile(STATS_FILE, JSON.stringify(statsData, null, 2));
  } catch (err) {
    console.error('Error saving stats:', err);
  }
}

// Add periodic stats saving
setInterval(() => {
  saveStats().catch(console.error);
}, 60000); // Save stats every minute

// Add function to save active trades
async function saveActiveTrades() {
  try {
    const activeTradesData = Array.from(activeTrades.entries()).map(([tokenId, trade]) => {
      const token = tokenData.get(tokenId);
      const currentTime = Date.now();
      const currentPrice = token ? token.price : trade.buyPrice;
      const profitLoss = ((currentPrice - trade.buyPrice) / trade.buyPrice) * 100;
      const timeHeld = (currentTime - trade.buyTime) / 1000;
      const timeLeft = Math.max(0, (MAX_HOLD_TIME / 1000) - timeHeld);
      const currentMc = currentPrice * TOKEN_SUPPLY * currentSolPrice;
      
      return {
        tokenId,
        tokenName: token?.name || 'Unknown',
        tokenSymbol: token?.symbol || 'Unknown',
        entryPrice: trade.buyPrice,
        currentPrice,
        entryMc: trade.entryMc,
        currentMc,
        pnl: profitLoss,
        netPnL: (profitLoss / 100) * trade.amount - 0.024, // Include fees
        amount: trade.amount,
        timeHeld: Math.floor(timeHeld),
        timeLeft: Math.floor(timeLeft),
        buyTime: trade.buyTime,
        lastUpdate: currentTime,
        tradeCount: trade.tradeCount,
        status: profitLoss >= PROFIT_THRESHOLD * 100 ? 'take_profit' :
                profitLoss <= LOSS_THRESHOLD * 100 ? 'stop_loss' :
                timeLeft <= 0 ? 'timeout' : 'active',
        volume: token ? token.volume.reduce((sum, v) => sum + v.amount, 0) : 0,
        buysInWindow: token ? token.buys.length : 0,
        priceHistory: token ? token.volume.map(v => ({
          price: v.price,
          timestamp: v.timestamp
        })).slice(-30) : [] // Keep last 30 price points
      };
    });

    const data = {
      timestamp: Date.now(),
      solPrice: currentSolPrice,
      lastSolPriceUpdate,
      activeTrades: activeTradesData,
      totalActiveTrades: activeTrades.size,
      totalPnL: activeTradesData.reduce((sum, trade) => sum + trade.netPnL, 0)
    };

    await fs.writeFile(ACTIVE_TRADES_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving active trades:', err);
  }
}

// Add cleanup for price updates
process.on('SIGINT', () => {
  if (solPriceUpdateInterval) {
    clearInterval(solPriceUpdateInterval);
  }
  process.exit();
});

// Add cleanup for active trades file
process.on('SIGINT', async () => {
  if (solPriceUpdateInterval) {
    clearInterval(solPriceUpdateInterval);
  }
  // Save final state of active trades before exit
  await saveActiveTrades();
  process.exit();
});

async function getSOLBalance(publicKey) {
    const balance = await connection.getBalance(new solanaWeb3.PublicKey(publicKey));
    return balance / 1_000_000_000;
}


async function getSPLBalance(tokenAccountPublicKey, retries = 2, delay = 300) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            tokenAccountPublicKey = new solanaWeb3.PublicKey(tokenAccountPublicKey)
            const tokenAccountInfo = await connection.getTokenAccountBalance(tokenAccountPublicKey);
            return tokenAccountInfo.value.amount;
        } catch (error) {
            //console.log(`Token Account not found`)
            //console.error(`Attempt ${attempt} failed: ${error.message}`);
            if (attempt === retries) {
                //logging(`Failed to fetch token account balance after ${retries} attempts`);
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function extractTransactionDetails(txStatus, tokenMintAddress, userWalletAddress) {
  try {
      // Find SOL change
      const accountKeys = txStatus.transaction.message.accountKeys.map(a => a.toBase58());
      const walletIndex = accountKeys.indexOf(userWalletAddress);
      if (walletIndex === -1) {
          throw new Error("User wallet not found in transaction.");
      }

      const preSOL = txStatus.meta.preBalances[walletIndex];
      const postSOL = txStatus.meta.postBalances[walletIndex];
      const solChange = (preSOL - postSOL) / 1e9; // in SOL

      // Find token changes specifically for the user's wallet
      let tokenChange = 0;
      let tokenDecimals = 0;

      // Find pre-token balance for user's wallet
      const preTokenBalance = txStatus.meta.preTokenBalances.find(tb => 
          tb.mint === tokenMintAddress && tb.owner === userWalletAddress
      );

      // Find post-token balance for user's wallet
      const postTokenBalance = txStatus.meta.postTokenBalances.find(tb => 
          tb.mint === tokenMintAddress && tb.owner === userWalletAddress
      );

      if (preTokenBalance) {
          tokenDecimals = preTokenBalance.uiTokenAmount.decimals;
          tokenChange -= Number(preTokenBalance.uiTokenAmount.amount) / Math.pow(10, tokenDecimals);
      }

      if (postTokenBalance) {
          tokenDecimals = postTokenBalance.uiTokenAmount.decimals;
          tokenChange += Number(postTokenBalance.uiTokenAmount.amount) / Math.pow(10, tokenDecimals);
      }

      return {
          solChange,
          tokenChange,
          tokenDecimals,
          timestamp: txStatus.blockTime
      };
  } catch (err) {
      console.error("Failed to extract transaction details:", err.message);
      process.exit(1);
  }
}

// Add this new function for transaction status checking
async function checkTransactionStatus(txId, maxRetries = 5, delayMs = 300) {
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        console.log(`\n⏳ Checking transaction status (Attempt ${retries + 1}/${maxRetries})...`);
        
        const txStatus = await connection.getTransaction(txId, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        });
  
        if (!txStatus) {
          console.log(`Transaction not found yet, retrying in ${delayMs/1000}s...`);
          retries++;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
  
        if (txStatus.meta?.err) {
          console.log(`Transaction failed with error: ${JSON.stringify(txStatus.meta.err)}`);
          return {
            success: false,
            error: txStatus.meta.err,
            status: txStatus,
            attempts: retries + 1
          };
        }
  
        // Transaction found and successful
        console.log(`✅ Transaction confirmed on attempt ${retries + 1}`);
        return {
          success: true,
          status: txStatus,
          attempts: retries + 1
        };
      } catch (error) {
        if (retries === maxRetries - 1) {
          console.log(`Final attempt failed: ${error.message}`);
          return {
            success: false,
            error: error.message,
            attempts: retries + 1
          };
        }
        console.log(`Error checking transaction: ${error.message}, retrying...`);
        retries++;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  
    return {
      success: false,
      error: `Transaction status check failed after ${maxRetries} attempts`,
      attempts: maxRetries
    };
}

async function fetchCoinData(mintAddress) {
    try {
        const mint = new PublicKey(mintAddress);
        const bondingCurvePDA = getBondingCurvePDA(mint, PUMP_FUN_PROGRAM_ID);
        const associatedBondingCurve = await getAssociatedTokenAddress(mint, bondingCurvePDA, true);
        const metadataPDA = getMetadataPDA(mint);
        
        // Fetch both bonding curve and metadata account data
        const [bondingCurveAccount, metadataAccount] = await Promise.all([
            connection.getAccountInfo(bondingCurvePDA),
            connection.getAccountInfo(metadataPDA)
        ]);
        
        if (!bondingCurveAccount) {
            throw new Error('Bonding curve account not found');
        }
        
        // Parse the bonding curve data
        const parsedData = parseBondingCurveData(bondingCurveAccount.data);
        
        if (!parsedData) {
            throw new Error('Failed to parse bonding curve data');
        }
        
        // Parse metadata if available
        let metadata = { name: null, symbol: null };
        if (metadataAccount) {
            metadata = parseMetadata(metadataAccount.data);
        }
  
        // Calculate market cap in SOL
        // Market cap = (virtual_sol_reserves / virtual_token_reserves) * token_total_supply
        const virtualSolReserves = BigInt(parsedData.virtual_sol_reserves);
        const virtualTokenReserves = BigInt(parsedData.virtual_token_reserves);
        const tokenTotalSupply = BigInt(parsedData.token_total_supply);
        
        // Calculate price per token in SOL (with 9 decimals)
        const pricePerToken = (virtualSolReserves * BigInt(1e9)) / virtualTokenReserves;
        
        // Calculate market cap in SOL (with 9 decimals)
        const marketCapSol = (pricePerToken * tokenTotalSupply) / BigInt(1e9);
        
        // Return data in the format you originally wanted
        return {
            virtual_sol_reserves: Number(parsedData.virtual_sol_reserves),
            virtual_token_reserves: Number(parsedData.virtual_token_reserves),
            bonding_curve: bondingCurvePDA.toBase58(),
            associated_bonding_curve: associatedBondingCurve.toBase58(),
            creator: parsedData.creator,
            // Market cap data
            market_cap: Number(marketCapSol / BigInt(1_000_000_000)),
            price_per_token_sol: pricePerToken.toString(),
            // Token metadata
            name: metadata.name,
            symbol: metadata.symbol,
            // Additional useful data
            real_sol_reserves: Number(parsedData.real_sol_reserves),
            real_token_reserves: Number(parsedData.real_token_reserves),
            total_supply: Number(parsedData.token_total_supply),
            complete: parsedData.complete
        };
    } catch (error) {
        console.error('Error fetching coin data:', error);
        throw error;
    }
}

async function tokenAccountExists(ownerPublicKey, tokenMintAddress) {
    try {
      const ownerPubkey = new PublicKey(ownerPublicKey);
      const mintPubkey = new PublicKey(tokenMintAddress);
      
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        ownerPubkey,
        { programId: TOKEN_PROGRAM_ID }
      );
  
      const associatedTokenAddress = getAssociatedTokenAddressSync(
        mintPubkey,
        ownerPubkey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
  
      return tokenAccounts.value.some(account => 
        account.pubkey.equals(associatedTokenAddress)
      );
    } catch (error) {
      console.log(`Error checking token account: ${error.message}`);
      return false;
    }
}
  
function calculateDynamicLP(currentSolReserves, currentTokenReserves, solAmountLamports) {
    // Step 1: Calculate the ideal price from virtual reserves
    const idealPrice = currentSolReserves / currentTokenReserves;
    // Step 2: Calculate new reserves after the swap (buying tokens)
    const newSolReserves = currentSolReserves + solAmountLamports;
    const newTokenReserves = (currentTokenReserves * currentSolReserves) / newSolReserves;
    // Step 3: Calculate the actual token output and price after swap
    const tokensReceived = Math.round(currentTokenReserves - newTokenReserves);
    const actualPrice = solAmountLamports / tokensReceived;
  
    return {
        tokensReceived,
        newSolReserves,
        newTokenReserves
    };
}
  
/**
    * Comprehensive calculator for PumpFun trades that handles both buy and sell calculations
    * @param {Object} options - Configuration options
    * @param {string} options.type - 'buy' or 'sell'
    * @param {number} options.solReserves - Current SOL reserves
    * @param {number} options.tokenReserves - Current token reserves
    * @param {number} options.amount - Amount of SOL (for buy) or tokens (for sell) to trade
    * @param {number} options.slippageDecimal - Slippage tolerance as decimal (e.g., 0.05 for 5%)
    * @param {number} options.marketCap - Market cap (required for sell)
    * @param {number} options.totalSupply - Total supply (required for sell)
    * @returns {Object} Calculation results including price impact, tokens received/sol received, etc.
*/
function calculatePumpSwap(options) {
    const {
        type = 'buy',
        solReserves,
        tokenReserves,
        amount,
        slippageDecimal = 0.05,
        marketCap,
        totalSupply
    } = options;
  
    // Handle buy calculation
    if (type === 'buy') {
        const solAmountLamports = amount * LAMPORTS_PER_SOL;
        
        // Use existing calculateDynamicLP function
        const { tokensReceived, newSolReserves, newTokenReserves } = calculateDynamicLP(
            solReserves,
            tokenReserves,
            solAmountLamports
        );
        
        // Calculate price impact
        const idealPrice = solReserves / tokenReserves;
        const actualPrice = solAmountLamports / tokensReceived;
        const priceImpact = ((actualPrice - idealPrice) / idealPrice);
        
        // Apply slippage protection
        const solBuyWithSlippage = solAmountLamports + (solAmountLamports * (priceImpact + slippageDecimal));
        const maxSolCost = Math.round(solBuyWithSlippage);
        
        return {
            tokensReceived,
            priceImpact: priceImpact * 100, // Convert to percentage
            maxSolCost,
            idealPrice,
            actualPrice,
            newSolReserves,
            newTokenReserves,
            newPrice: newSolReserves / newTokenReserves
        };
    }
    // Handle sell calculation
    else if (type === 'sell') {
        const tokenAmount = amount;
        
        // Calculate price impact
        const idealPrice = solReserves / tokenReserves;
        const newTokenReserves = tokenReserves + tokenAmount;
        const newSolReserves = Math.round(solReserves * tokenReserves / newTokenReserves);
        const solReceived = solReserves - newSolReserves;
        const actualPrice = solReceived / tokenAmount;
        const priceImpact = (1 - (actualPrice / idealPrice));
        
        // Calculate minimum SOL to receive with slippage
        const decimal = 6; // Token decimal places
        const pricePerToken = (marketCap * Math.pow(10, decimal)) / totalSupply;
        const minSolOut = Math.round(tokenAmount * pricePerToken);
        const slippage = 1 - (priceImpact + slippageDecimal);
        const minSolReceived = Math.round((minSolOut * slippage) * 1000);
        
        return {
            solReceived,
            minSolReceived,
            priceImpact: priceImpact * 100, // Convert to percentage
            idealPrice,
            actualPrice,
            newSolReserves,
            newTokenReserves,
            newPrice: newSolReserves / newTokenReserves
        };
    }
    
    throw new Error(`Invalid swap type: ${type}. Must be 'buy' or 'sell'`);
  }
  
  
  // Function to get Jito tip accounts
async function getTipAccounts() {
    try {
      const response = await axios.get('https://jito.apteka.wtf/api/tip-accounts');
      if (response.data.error) {
        throw new Error(response.data.error.message);
      }
  
      return response.data.result;
    } catch (error) {
      console.error("Error getting tip accounts:", error.message);
      throw error;
    }
  }
  
async function sendJitoTransaction(bundle) {
    try {
      const response = await axios.post(
        `${JITO_RPC_URL}/api/v1/transactions/?endpoint=tokyo`,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: bundle,
        },
        {
          headers: { "Content-Type": "application/json" },
        }
      );
  
      if (response.data.error) {
        throw new Error(response.data.error.message);
      }
  
      return response.data.result;
    } catch (error) {
      console.error("❌ Error sending Jito bundle:", error.message);
      throw error;
    }
}
  
/**
    * Get dynamic compute unit limit and price based on network demand
    * @returns {Promise<Object>} Object containing compute unit limit and price
*/
async function getDynamicComputeUnits() {
    try {
        // Default values as fallback
        const defaultValues = {
            limit: 200000, // Default compute unit limit
            priorityFee: 1000000 // Default priority fee (0.0001 SOL in micro-lamports)
        };
        
        // Get recent prioritization fees
        const recentPrioritizationFees = await connection.getRecentPrioritizationFees();
        
        if (!recentPrioritizationFees || recentPrioritizationFees.length === 0) {
            //console.log(`No recent prioritization fees available, using default: ${defaultValues.priorityFee}`);
            return defaultValues;
        }
        
        // Sort by slot in descending order to get the most recent fees
        recentPrioritizationFees.sort((a, b) => b.slot - a.slot);
        
        // Take the most recent 20 fees or all if less than 20
        const recentFees = recentPrioritizationFees.slice(0, 20);
        /*
        // Log all recent fees for debugging
        console.log(`Recent priority fees (microLamports): ${JSON.stringify(recentFees.map(item => ({
            slot: item.slot,
            fee: item.prioritizationFee
        })))}`);
        */
        // Calculate 75th percentile for fees to be competitive but not overpay
        const feeValues = recentFees.map(item => item.prioritizationFee);
        feeValues.sort((a, b) => a - b);
        const p75Index = Math.floor(feeValues.length * 0.75);
        const priorityFee = Math.max(feeValues[p75Index], defaultValues.priorityFee);
        
        //logging(`Using 75th percentile priority fee: ${priorityFee} microLamports (${priorityFee / 1000000} SOL)`);
        
        // Calculate dynamic limit based on network congestion
        // Higher priority fees indicate more congestion, so we increase the limit to ensure the transaction succeeds
        let computeUnitLimit = defaultValues.limit;
        if (priorityFee > 1000000) { // > 0.001 SOL
            computeUnitLimit = 300000; // Increase limit during high congestion
            //logging(`High network congestion detected, using increased compute unit limit: ${computeUnitLimit}`);
        } else if (priorityFee > 500000) { // > 0.0005 SOL
            computeUnitLimit = 250000; // Moderate increase during medium congestion
            //logging(`Medium network congestion detected, using moderate compute unit limit: ${computeUnitLimit}`);
        } else {
            //logging(`Low network congestion detected, using standard compute unit limit: ${computeUnitLimit}`);
        }
        
        return {
            limit: computeUnitLimit,
            priorityFee: priorityFee
        };
    } catch (error) {
        //console.error("Error fetching dynamic compute units:", error);
        // Return defaults if there's an error
        return {
            limit: 200000,
            priorityFee: 100000
        };
    }
}
  
function getCreatorVaultPDA(creatorPublicKey) {
    const [pda, _bump] = PublicKey.findProgramAddressSync(
      [CREATOR_VAULT_SEED, creatorPublicKey.toBuffer()],
      PUMP_FUN_PROGRAM
    );
  
    return pda;
}

//Buy/Sell Functions
function packIntegersToBuffer(integers) {
    const buffer = Buffer.alloc(integers.length * 8); // Each 64-bit integer is 8 bytes
    integers.forEach((int, index) => {
        buffer.writeBigUInt64LE(BigInt(int), index * 8); // Write each integer in Little Endian format
    });
    return buffer;
}

function formatNumber(number) {
  if (number >= 1e9) {
      return (number / 1e9).toFixed(2) + 'B';
  } else if (number >= 1e6) {
      return (number / 1e6).toFixed(2) + 'M';
  } else if (number >= 1e3) {
      return (number / 1e3).toFixed(2) + 'K';
  } else {
      return number.toFixed(2);
  }
}
  
async function pumpFunBuy(options) {
    const {
        tokenMintAddress,
        buyerPrivateKey,
        buyAmountSol = 0.0105,
        slippageDecimal = 0.05,
        useJito = true,
        createAccount = false,
        randomizePlatform = true,
        dynamicCompute = true,
        virtual_sol_reserves,
        virtual_token_reserves,
        bonding_curve,
        associated_bonding_curve,
        tokenCreator
    } = options;
    
    const startTime = Date.now();
    
    try {
        // Get token data
        /*
        const coinData = await fetchCoinData(tokenMintAddress);
  
        if (!coinData) {
            throw new Error("Failed to fetch coin data");
        }

        const virtual_sol_reserves = coinData.virtual_sol_reserves;
        const virtual_token_reserves = coinData.virtual_token_reserves;
        const bonding_curve = coinData.bonding_curve;
        const associated_bonding_curve = coinData.associated_bonding_curve;
        const tokenCreator = coinData.creator;
        */
        // Create all PublicKey objects at the start
        const creatorPubkey = new PublicKey(tokenCreator);
        const creatorVaultPDA = getCreatorVaultPDA(creatorPubkey);
        const mintPubkey = new PublicKey(tokenMintAddress);
        const bondingCurvePubkey = new PublicKey(bonding_curve);
        const associatedBondingCurvePubkey = new PublicKey(associated_bonding_curve);
        
        // Setup wallet and token accounts
        const decodedFromPrivateKeyBytes = bs58.decode(buyerPrivateKey);
        const buyerKeypair = Keypair.fromSecretKey(decodedFromPrivateKeyBytes);
        const buyerPubKey = buyerKeypair.publicKey;
        
        const associatedToken = getAssociatedTokenAddressSync(
            mintPubkey,
            buyerPubKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        
        // Check if we need to create a token account
        const accountExists = await tokenAccountExists(buyerPubKey.toString(), tokenMintAddress);
        const needAccountCreation = createAccount || !accountExists;
        // Check if buyer has enough SOL
        const solBalance = await getSOLBalance(buyerPubKey.toString());
        const estimatedFee = 0.000005; 
        const minRequiredBalance = buyAmountSol + estimatedFee + 0.002; // Extra for transaction fees
        
        if (solBalance < minRequiredBalance) {
            throw new Error(`Insufficient SOL balance: ${solBalance}, need at least ${minRequiredBalance}`);
        }
        
        // Use the calculator function for swap calculations
        const swapCalc = calculatePumpSwap({
            type: 'buy',
            solReserves: virtual_sol_reserves,
            tokenReserves: virtual_token_reserves,
            amount: buyAmountSol,
            slippageDecimal
        });
        
        const tokensReceived = swapCalc.tokensReceived;
        const maxSolCost = swapCalc.maxSolCost;
        const priceImpact = swapCalc.priceImpact / 100;
        
        // Create buy instruction
        const keys = [
            { pubkey: GLOBAL, isSigner: false, isWritable: false },
            { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
            { pubkey: mintPubkey, isSigner: false, isWritable: false },
            { pubkey: bondingCurvePubkey, isSigner: false, isWritable: true },
            { pubkey: associatedBondingCurvePubkey, isSigner: false, isWritable: true },
            { pubkey: associatedToken, isSigner: false, isWritable: true },
            { pubkey: buyerPubKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
            { pubkey: creatorVaultPDA, isSigner: false, isWritable: true },
            { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false },
            { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false }
        ];
        
        let buy = 16927863322537952870n;
        let integers = [buy, tokensReceived, maxSolCost];
        const data = packIntegersToBuffer(integers);
        
        const buyInstruction = new solanaWeb3.TransactionInstruction({
            programId: PUMP_FUN_PROGRAM,
            data: data,
            keys: keys
        });
        
        // Build transaction
        const transaction = new Transaction();
        
        // Get dynamic compute units if enabled
        let computeUnits = null;
        if (dynamicCompute) {
            computeUnits = await getDynamicComputeUnits();
            
            // Add compute unit limit instruction
            const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
                units: computeUnits.limit
            });
            
            // Add compute unit price instruction (prioritization fee)
            const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: computeUnits.priorityFee
            });
            
            transaction.add(computeLimitIx);
            transaction.add(computePriceIx);
        }
        
        // Add create account instruction if needed
        if (needAccountCreation) {
            transaction.add(
                createAssociatedTokenAccountInstruction(
                    buyerPubKey,
                    associatedToken,
                    buyerPubKey,
                    mintPubkey,
                    TOKEN_PROGRAM_ID,
                    ASSOCIATED_TOKEN_PROGRAM_ID
                )
            );
        }
        
        // Add buy instruction
        transaction.add(buyInstruction);
        
        /*
        // Add jito tip if using Jito
        if (useJito) {
            const tipAccounts = await getTipAccounts();
            if (!tipAccounts || tipAccounts.length === 0) {
                throw new Error("Failed to get Jito tip accounts");
            }
            
            const tipAccountPubkey = new PublicKey(
                tipAccounts[Math.floor(Math.random() * tipAccounts.length)]
            );
            
            let jitoTipLamport = await getJitoTipFloor();
            if (jitoTipLamport == null) {
                jitoTipLamport = jitoTipAmount * LAMPORTS_PER_SOL;
            } else {
                jitoTipLamport = jitoTipLamport * LAMPORTS_PER_SOL;
            }
            
            jitoTipLamport = Math.round(jitoTipLamport);
            
            const tipInstruction = SystemProgram.transfer({
                fromPubkey: buyerPubKey,
                toPubkey: tipAccountPubkey,
                lamports: jitoTipLamport,
            });
            
            transaction.add(tipInstruction);
        }
        */        
        // Finalize and sign transaction
        transaction.recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
        transaction.feePayer = buyerPubKey;
        transaction.sign(buyerKeypair);
        
        // Send transaction
        let txId;
        if (useJito) {
            const bundle = [transaction].map((tx) => {
                return bs58.encode(tx.serialize({ verifySignatures: false }));
            });
            txId = await sendJitoTransaction(bundle);
        } else {
            const txSerialized = transaction.serialize();
            txId = await connection.sendRawTransaction(txSerialized, {
                skipPreflight: true,
                preflightCommitment: 'processed',
            });
        }
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        const resultMessage = `${buyerPubKey.toString()} Buying ${formatNumber(tokensReceived/1000000)} for max cost of ${(maxSolCost/LAMPORTS_PER_SOL).toFixed(3)} SOL with price impact of ${(priceImpact * 10).toFixed(3)}% || Buy time: ${duration} seconds || TX ID => ${txId}`;
        console.log(resultMessage);
  
        console.log('✅ Transaction successful!');
        return {
            success: true,
            txId,
            tokensReceived,
            priceImpact: priceImpact * 100,
            maxSolCost: maxSolCost / LAMPORTS_PER_SOL,
            duration,
            computeUnits: computeUnits ? {
            limit: computeUnits.limit,
            priorityFee: computeUnits.priorityFee
          } : null
        };
        
    } catch (error) {
        const errorMessage = `Buy failed: ${error.message}`;
        //console.log(errorMessage);
        return {
            success: false,
            error: error.message
        };
    }
}
  
async function pumpFunSell(options) {
    const {
        tokenMintAddress,
        sellerPrivateKey,
        sellPercentage = 100, // Default to selling 100% of tokens
        slippageDecimal = 0.08,
        useJito = true,
        randomizePlatform = true, // Whether to randomize platform fee wallet
        dynamicCompute = true     // Whether to use dynamic compute units
    } = options;
  
    const startTime = Date.now();
    console.log(`Starting PumpFun sell for ${tokenMintAddress} with ${sellPercentage}% of tokens`);
    
    try {
        // Setup wallet and get SPL balance
        const decodedFromPrivateKeyBytes = bs58.decode(sellerPrivateKey);
        const sellerKeypair = solanaWeb3.Keypair.fromSecretKey(decodedFromPrivateKeyBytes);
        const sellerPubKey = sellerKeypair.publicKey;
        const sellerPubKeyBs58 = sellerPubKey.toBase58();
        
        // Get token account
        const tokenProgramID = TOKEN_PROGRAM_ID;
        const associatedTokenProgramID = ASSOCIATED_TOKEN_PROGRAM_ID;
        const associatedToken = getAssociatedTokenAddressSync(
            new PublicKey(tokenMintAddress), 
            sellerKeypair.publicKey, 
            false, 
            tokenProgramID, 
            associatedTokenProgramID
        );
        const tokenWallet = associatedToken.toBase58();
        
        // Check if token account exists and has balance
        const tokenBalance = await getSPLBalance(tokenWallet);
        if (!tokenBalance || tokenBalance === 0) {
            throw new Error(`No tokens to sell in wallet ${sellerPubKeyBs58}`);
        }
        
        // Calculate amount to sell
        const tokenAmount = Math.round((sellPercentage / 100) * tokenBalance);
        if (tokenAmount === 0) {
            throw new Error("Calculated sell amount is zero");
        }
        
        // Check if seller has enough SOL for fees
        const solBalance = await getSOLBalance(sellerPubKeyBs58);
        const estimatedFee = useJito ? await getJitoTipFloor() : 0.000005;
        const minRequiredBalance = estimatedFee + 0.002; // For transaction fees
        
        if (solBalance < minRequiredBalance) {
            throw new Error(`Insufficient SOL balance for fees: ${solBalance}, need at least ${minRequiredBalance}`);
        }
        
        // Get coin data
        const coinData = await fetchCoinData(tokenMintAddress);
        if (!coinData) {
            throw new Error("Failed to fetch coin data");
        }
        
        const totalSupply = coinData.total_supply;
        const marketCap = coinData.market_cap;
        const bonding_curve = coinData.bonding_curve;
        const associated_bonding_curve = coinData.associated_bonding_curve;
        const virtual_sol_reserves = coinData.virtual_sol_reserves;
        const virtual_token_reserves = coinData.virtual_token_reserves;
        const tokenCreator = coinData.creator;
        const creatorVaultPDA = getCreatorVaultPDA(new PublicKey(tokenCreator));
        
        // Set up token addresses
        const mintAddress = new solanaWeb3.PublicKey(tokenMintAddress);
        const bondingCurve = new solanaWeb3.PublicKey(bonding_curve);
        const associatedBondingCurve = new solanaWeb3.PublicKey(associated_bonding_curve);
        const associatedUser = new solanaWeb3.PublicKey(associatedToken);
        
        // Use the new calculator function for swap calculations
        const swapCalc = calculatePumpSwap({
            type: 'sell',
            solReserves: virtual_sol_reserves,
            tokenReserves: virtual_token_reserves,
            amount: tokenAmount,
            slippageDecimal,
            marketCap,
            totalSupply
        });
        
        const minSolReceived = swapCalc.minSolReceived;
        const priceImpact = swapCalc.priceImpact / 100; // Convert back to decimal for consistency
        const minSolReceivedUI = (minSolReceived / LAMPORTS_PER_SOL).toFixed(3);
        
        //logging(`Calculated price impact: ${swapCalc.priceImpact.toFixed(2)}%, min SOL to receive: ${minSolReceivedUI}`);
        
        // Create sell instruction
        const keys = [
            { pubkey: GLOBAL, isSigner: false, isWritable: false },
            { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
            { pubkey: mintAddress, isSigner: false, isWritable: false },
            { pubkey: bondingCurve, isSigner: false, isWritable: true },
            { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
            { pubkey: associatedUser, isSigner: false, isWritable: true },
            { pubkey: sellerPubKey, isSigner: true, isWritable: true },
            { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: creatorVaultPDA, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
            { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false },
            { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false }
        ];
        
        let sell = 12502976635542562355n;
        let integers = [sell, tokenAmount, minSolReceived];
        const data = packIntegersToBuffer(integers);
        
        const sellInstruction = new solanaWeb3.TransactionInstruction({
            programId: PUMP_FUN_PROGRAM,
            data: data,
            keys: keys
        });

        // Build transaction
        const transaction = new solanaWeb3.Transaction();
        
        // Get dynamic compute units if enabled
        let computeUnits = null;
        if (dynamicCompute) {
            computeUnits = await getDynamicComputeUnits();
            
            // Add compute unit limit instruction
            const computeLimitIx = solanaWeb3.ComputeBudgetProgram.setComputeUnitLimit({
                units: computeUnits.limit
            });
            
            // Add compute unit price instruction (prioritization fee)
            const computePriceIx = solanaWeb3.ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: computeUnits.priorityFee
            });
            
            transaction.add(computeLimitIx);
            transaction.add(computePriceIx);
            
            //logging(`Set dynamic compute units: limit=${computeUnits.limit}, priorityFee=${computeUnits.priorityFee} microLamports`);
        }
        
        // Add sell instruction
        transaction.add(sellInstruction);

        transaction.add(
            splToken.createCloseAccountInstruction(
                associatedUser,
                sellerPubKey,
                sellerPubKey
        ));
        /*
        // Add jito tip if using Jito
        if (useJito) {
            const tipAccounts = await getTipAccounts();
            if (!tipAccounts || tipAccounts.length === 0) {
                throw new Error("Failed to get Jito tip accounts");
            }
            
            const tipAccountPubkey = new PublicKey(
                tipAccounts[Math.floor(Math.random() * tipAccounts.length)]
            );
            
            let jitoTipLamport = await getJitoTipFloor();
            if (jitoTipLamport == null) {
                jitoTipLamport = jitoTipAmount * LAMPORTS_PER_SOL;
            } else {
                jitoTipLamport = jitoTipLamport * LAMPORTS_PER_SOL;
            }
            
            jitoTipLamport = Math.round(jitoTipLamport);
            
            const tipInstruction = solanaWeb3.SystemProgram.transfer({
                fromPubkey: sellerKeypair.publicKey,
                toPubkey: tipAccountPubkey,
                lamports: jitoTipLamport,
            });
            
            transaction.add(tipInstruction);
        }
        */        
        // Finalize and sign transaction
        transaction.recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
        transaction.feePayer = sellerKeypair.publicKey;
        transaction.sign(sellerKeypair);
        
        // Send transaction
        let txId;
        if (useJito) {
            const bundle = [transaction].map((tx) => {
                return bs58.encode(tx.serialize({ verifySignatures: false }));
            });
            txId = await sendJitoTransaction(bundle);
        } else {
            const txSerialized = transaction.serialize();
            txId = await connection.sendRawTransaction(txSerialized, {
                skipPreflight: true,
                preflightCommitment: 'processed',
            });
        }
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        const resultMessage = `${sellerPubKey} Selling ${formatNumber(tokenAmount/1000000)} tokens for min ${minSolReceivedUI} SOL with price impact of ${(priceImpact * 100).toFixed(2)}% || Sell time: ${duration} seconds || TX ID => ${txId}`;
        //logging(resultMessage);
        console.log(resultMessage);
        
        return {
            success: true,
            txId,
            tokensSold: tokenAmount,
            priceImpact: priceImpact * 100,
            minSolReceived: minSolReceived / LAMPORTS_PER_SOL,
            duration,
            computeUnits: computeUnits ? {
                limit: computeUnits.limit,
                priorityFee: computeUnits.priorityFee
            } : null
        };
        
    } catch (error) {
        const errorMessage = `Sell failed: ${error.message}`;
        //logging(errorMessage);
        //console.error(errorMessage);
        return {
            success: false,
            error: error.message
        };
    }
}

// Initial update of constants
//updateStrategyVariables();

/**
 * Checks if a token has a paid DexScreener enhanced profile
 * @param {string} tokenAddress - The token's mint address
 * @returns {Promise<boolean>} - Returns true if token has paid profile, false otherwise
 */
async function isDexPaid(tokenAddress) {
  try {
    const response = await fetch(`https://api.dexscreener.com/orders/v1/solana/${tokenAddress}`);
    const data = await response.json();
    return data?.[0]?.status === 'approved';
  } catch (error) {
    console.error('Error checking DexScreener enhanced status:', error);
    return false;
  }
}

async function checkTradeCooldown() {
    if (!TRADE_COOLDOWN_ENABLED) return false;

    // If cooldown is active, check if it's time to end it
    if (TRADE_COOLDOWN_ACTIVE) {
        const now = Math.floor(Date.now() / 1000);
        if (now - TRADE_COOLDOWN_START_TIME >= TRADE_COOLDOWN_DURATION) {
            console.log('Trade cooldown period ended');
            TRADE_COOLDOWN_ACTIVE = false;
            TRADE_COOLDOWN_START_TIME = null;
            return false;
        }
        return true;
    }

    // Check if we've reached the profit cap
    const stats = JSON.parse(await fs.readFile(STATS_FILE, 'utf8'));
    const totalPnL = stats.trades?.totalPnL || 0;

    if (totalPnL >= TRADE_COOLDOWN_PROFIT_CAP) {
        console.log(`Profit cap reached (${totalPnL} SOL). Starting trade cooldown for ${TRADE_COOLDOWN_DURATION} seconds`);
        TRADE_COOLDOWN_ACTIVE = true;
        TRADE_COOLDOWN_START_TIME = Math.floor(Date.now() / 1000);
        
        // Close all profitable positions
        const activeTrades = JSON.parse(await fs.readFile(ACTIVE_TRADES_FILE, 'utf8'));
        for (const trade of activeTrades.activeTrades || []) {
            if (trade.pnl > 0) {
                console.log(`Closing profitable position for ${trade.tokenSymbol} during cooldown`);
                await closeTrade(trade.tokenId, 'Cooldown: Profit cap reached', true);
            }
        }
        
        return true;
    }

    return false;
}

async function executeTrade(tokenId, token, buyTime) {
    // Add cooldown check at the start of executeTrade
    if (await checkTradeCooldown()) {
        console.log('Trade execution blocked due to cooldown period');
        return false;
    }

    try {
      let buyPrice = token.price;
      // Check if already trading this token
      if (activeTrades.has(tokenId)) return;

      // Get current trade count for this token
      const currentCount = stats.trades.tokenTradeCounts.get(tokenId) || 0;
      
      // Check if we've traded this token too many times
      if (currentCount >= MAX_TR) {
        console.log(`Skipping ${tokenId} - Max trades reached (${currentCount}/${MAX_TR})`);
        return;
      }

      // Check if we've traded this token recently
      const lastTradeTime = stats.trades.lastTradeTime.get(tokenId);
      if (lastTradeTime && Date.now() - lastTradeTime < TRADE_COOLDOWN) {
        console.log(`Skipping ${tokenId} - In cooldown period`);
        return;
      }

      // Update trade statistics
      stats.trades.tokenTradeCounts.set(tokenId, currentCount + 1);
      stats.trades.lastTradeTime.set(tokenId, buyTime);

      // Set active trade BEFORE executing buy
      activeTrades.set(tokenId, { 
        buyPrice, 
        buyTime, 
        amount: TRADE_AMOUNT,
        entryMc: buyPrice * TOKEN_SUPPLY * currentSolPrice,
        tradeCount: currentCount + 1
      });
      const buyResult = await pumpFunBuy({
        tokenMintAddress: tokenId,
        buyerPrivateKey: process.env.WALLET_PRIVATE_KEY,
        buyAmountSol: TRADE_AMOUNT,
        slippageDecimal: 0.05,
        useJito: false,
        createAccount: false,
        randomizePlatform: false,
        dynamicCompute: true,
        virtual_sol_reserves: token.virtual_sol_reserves,
        virtual_token_reserves: token.virtual_token_reserves,
        bonding_curve: token.bonding_curve,
        associated_bonding_curve: token.associated_bonding_curve,
        tokenCreator: token.creator
      });

      // Validate buy result
      if (!buyResult || !buyResult.txId) {
        console.log('Buy transaction failed - No transaction ID returned');
        activeTrades.delete(tokenId);
        return;
      }

      // Check transaction status with retries
      const txCheck = await checkTransactionStatus(buyResult.txId);
      
      if (!txCheck.success) {
        console.log(`Buy transaction failed: ${txCheck.error}`);
        activeTrades.delete(tokenId);
        return;
      }

      //check actual entry price
      const details = await extractTransactionDetails(txCheck.status, tokenId, BOT_PUBLIC_KEY_BASE58);
      const entryPrice = details.solChange / details.tokenChange;
      console.log(`Entry price: ${entryPrice.toFixed(12)} SOL per token`);
      console.log(`\n✅ Buy transaction successful! => ${buyResult.txId}`);
      
      // Update active trade with actual entry price and market cap
      const activeTrade = activeTrades.get(tokenId);
      if (activeTrade) {
        activeTrade.buyPrice = entryPrice;
        activeTrade.entryMc = entryPrice * TOKEN_SUPPLY * currentSolPrice;
        activeTrades.set(tokenId, activeTrade);
        console.log(`Updated active trade with actual entry price: ${entryPrice.toFixed(12)} SOL`);
      }

      // Start monitoring the trade
      monitorTrade(tokenId);
      
    } catch (error) {
      console.error(`Error executing trade: ${error.message}`);
      // Clean up active trade if it exists
      if (activeTrades.has(tokenId)) {
        activeTrades.delete(tokenId);
      }
    }
}

async function monitorTrade(tokenId) {
    // Add cooldown check in the updateTokenPrice function
    async function updateTokenPrice() {
        try {
            const currentTime = Date.now();
            // Only fetch if enough time has passed
            if (currentTime - lastFetchTime < PRICE_FETCH_INTERVAL) return;
            
            const coinData = await fetchAccurateCoinData(tokenId);
            if (!coinData) return;

            const token = tokenData.get(tokenId);
            if (!token) return;

            // Update token data with fetched price
            token.lastPrice = token.price;
            token.price = coinData.price;
            token.marketCap = coinData.marketCap;
            token.lastUpdate = currentTime;
            lastFetchTime = currentTime;

            // Save updated trade data
            await saveActiveTrades();

            // Check if we're in cooldown and the position is profitable
            if (TRADE_COOLDOWN_ACTIVE && trade.pnl > 0) {
                console.log(`Closing profitable position for ${trade.tokenSymbol} during cooldown`);
                await closeTrade(tokenId, 'Cooldown: Profit cap reached', true);
                return;
            }
        } catch (error) {
            console.error('Error updating token price:', error);
        }
    }

    const trade = activeTrades.get(tokenId);
    let lastPrice = trade.buyPrice;
    let lastPriceTime = trade.buyTime;
    let stagnantStartTime = null;
    let lastFetchTime = 0;
    let priceFetchInterval;
    let monitorInterval;
    let isClosing = false; // Add flag to prevent double closure
    
    // Start price fetch interval
    priceFetchInterval = setInterval(updateTokenPrice, PRICE_FETCH_INTERVAL);
    
    // Initial price fetch
    updateTokenPrice();
    
    monitorInterval = setInterval(async () => {
        const currentTime = Date.now();
        const token = tokenData.get(tokenId);
        if (!token || !trade || isClosing) {
            clearInterval(monitorInterval);
            clearInterval(priceFetchInterval);
            activeTrades.delete(tokenId);
            await saveActiveTrades();
            displayStats();
            return;
        }

        // Update active trades file
        await saveActiveTrades();

        const currentPrice = token.price;
        const profitLoss = (currentPrice - trade.buyPrice) / trade.buyPrice;
        const currentMc = currentPrice * TOKEN_SUPPLY * currentSolPrice;

        // Function to handle trade closure
        const closeTrade = async (reason, isWin = true) => {
            if (isClosing) return; // Prevent double closure
            isClosing = true;

            try {
                // Execute sell transaction
                const sellResult = await pumpFunSell({
                    tokenMintAddress: tokenId,
                    sellerPrivateKey: process.env.WALLET_PRIVATE_KEY,
                    sellPercentage: 100, // Sell entire position
                    slippageDecimal: 0.1,
                    useJito: false,
                    dynamicCompute: true
                });

                // Validate sell result
                if (!sellResult || !sellResult.txId) {
                    console.log('Sell transaction failed - No transaction ID returned');
                    isClosing = false;
                    return;
                }

                // Check transaction status with retries
                const txCheck = await checkTransactionStatus(sellResult.txId);
                if (!txCheck.success) {
                    console.log(`Sell transaction failed: ${txCheck.error}`);
                    
                    // Retry sell with exponential backoff
                    const maxRetries = 3;
                    const baseDelay = 200; // 2 seconds
                    
                    for (let attempt = 1; attempt <= maxRetries; attempt++) {
                        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
                        console.log(`Retrying sell transaction (attempt ${attempt}/${maxRetries}) after ${delay}ms delay...`);
                        
                        await new Promise(resolve => setTimeout(resolve, delay));
                        
                        try {
                            const retrySellResult = await pumpFunSell({
                                tokenMintAddress: tokenId,
                                sellerPrivateKey: process.env.WALLET_PRIVATE_KEY,
                                sellPercentage: 100,
                                slippageDecimal: 0.1,
                                useJito: false,
                                dynamicCompute: true
                            });
                            
                            if (retrySellResult && retrySellResult.txId) {
                                const retryTxCheck = await checkTransactionStatus(retrySellResult.txId);
                                if (retryTxCheck.success) {
                                    console.log(`Sell transaction succeeded on retry attempt ${attempt}`);
                                    // Get actual sell price from retry transaction
                                    const retryDetails = await extractTransactionDetails(retryTxCheck.status, tokenId, BOT_PUBLIC_KEY_BASE58);
                                    const actualSellPrice = Math.abs(retryDetails.solChange / retryDetails.tokenChange);
                                    console.log(`Actual sell price: ${actualSellPrice.toFixed(12)} SOL per token`);
                                    
                                    // Calculate PNL using actual sell price
                                    const actualProfitLoss = (actualSellPrice - trade.buyPrice) / trade.buyPrice;
                                    const actualGain = actualProfitLoss * trade.amount;
                                    const fees = 0;
                                    const net = actualGain - fees;
                                    const timeHeld = (currentTime - trade.buyTime) / 1000;
                                    const actualExitMc = actualSellPrice * TOKEN_SUPPLY * currentSolPrice;

                                    // Update trade statistics
                                    stats.trades.total++;
                                    if (isWin) stats.trades.wins++;
                                    else stats.trades.losses++;
                                    stats.trades.totalPnL += net;

                                    // Prepare trade data for saving
                                    const tradeData = {
                                      tokenId,
                                      tokenName: token.name,
                                      tokenSymbol: token.symbol,
                                      entryPrice: trade.buyPrice,
                                      exitPrice: actualSellPrice,
                                      entryMc: trade.entryMc,
                                      exitMc: actualExitMc,
                                      pnl: actualProfitLoss * 100,
                                      netPnL: net,
                                      timeHeld: Math.floor(timeHeld),
                                      reason,
                                      amount: trade.amount,
                                      tradeCount: trade.tradeCount,
                                      fees,
                                      marketCap: actualExitMc,
                                      volume: token.volume.reduce((sum, v) => sum + v.amount, 0),
                                      buysInWindow: token.buys.length,
                                      lastPriceUpdate: lastFetchTime,
                                      sellTxId: retrySellResult.txId
                                    };

                                    // Save trade data
                                    await saveTradeData(tradeData);
                                    await saveStats();

                                    // Add to trade history
                                    stats.trades.history.push({
                                      ...tradeData,
                                      timestamp: currentTime
                                    });

                                    // Keep only last 100 trades in history
                                    if (stats.trades.history.length > 100) {
                                      stats.trades.history.shift();
                                    }

                                    // Log trade closure
                                    await logToFile({
                                      type: 'TRADE_CLOSED',
                                      ...tradeData,
                                      timestamp: new Date().toISOString()
                                    });

                                    console.log(`\n=== Trade Closed: ${reason} ===`);
                                    console.log(`Token: ${token.name || tokenId} (${token.symbol || 'Unknown'})`);
                                    console.log(`Profit: ${(actualProfitLoss * 100).toFixed(2)}%`);
                                    console.log(`Net PNL: ${net.toFixed(4)} SOL`);
                                    console.log(`Time Held: ${Math.floor(timeHeld)}s`);
                                    console.log(`Sell TX: ${retrySellResult.txId}`);
                                    console.log('===========================\n');

                                    clearInterval(monitorInterval);
                                    clearInterval(priceFetchInterval);
                                    activeTrades.delete(tokenId);
                                    displayStats();
                                    break;
                                }
                            }
                            
                            if (attempt === maxRetries) {
                                console.log('All sell retry attempts failed');
                                isClosing = false;
                                return;
                            }
                        } catch (retryError) {
                            console.log(`Retry attempt ${attempt} failed:`, retryError);
                            if (attempt === maxRetries) {
                                console.log('All sell retry attempts failed');
                                isClosing = false;
                                return;
                            }
                        }
                    }
                } else {
                    // Get actual sell price from transaction
                    const details = await extractTransactionDetails(txCheck.status, tokenId, BOT_PUBLIC_KEY_BASE58);
                    const actualSellPrice = Math.abs(details.solChange / details.tokenChange);
                    console.log(`Actual sell price: ${actualSellPrice.toFixed(12)} SOL per token`);
                    
                    // Calculate PNL using actual sell price
                    const actualProfitLoss = (actualSellPrice - trade.buyPrice) / trade.buyPrice;
                    const actualGain = actualProfitLoss * trade.amount;
                    const fees = 0;
                    const net = actualGain - fees;
                    const timeHeld = (currentTime - trade.buyTime) / 1000;
                    const actualExitMc = actualSellPrice * TOKEN_SUPPLY * currentSolPrice;

                    // Update trade statistics
                    stats.trades.total++;
                    if (isWin) stats.trades.wins++;
                    else stats.trades.losses++;
                    stats.trades.totalPnL += net;

                    // Prepare trade data for saving
                    const tradeData = {
                      tokenId,
                      tokenName: token.name,
                      tokenSymbol: token.symbol,
                      entryPrice: trade.buyPrice,
                      exitPrice: actualSellPrice,
                      entryMc: trade.entryMc,
                      exitMc: actualExitMc,
                      pnl: actualProfitLoss * 100,
                      netPnL: net,
                      timeHeld: Math.floor(timeHeld),
                      reason,
                      amount: trade.amount,
                      tradeCount: trade.tradeCount,
                      fees,
                      marketCap: actualExitMc,
                      volume: token.volume.reduce((sum, v) => sum + v.amount, 0),
                      buysInWindow: token.buys.length,
                      lastPriceUpdate: lastFetchTime,
                      sellTxId: sellResult.txId
                    };

                    // Save trade data
                    await saveTradeData(tradeData);
                    await saveStats();

                    // Add to trade history
                    stats.trades.history.push({
                      ...tradeData,
                      timestamp: currentTime
                    });

                    // Keep only last 100 trades in history
                    if (stats.trades.history.length > 100) {
                      stats.trades.history.shift();
                    }

                    // Log trade closure
                    await logToFile({
                      type: 'TRADE_CLOSED',
                      ...tradeData,
                      timestamp: new Date().toISOString()
                    });

                    console.log(`\n=== Trade Closed: ${reason} ===`);
                    console.log(`Token: ${token.name || tokenId} (${token.symbol || 'Unknown'})`);
                    console.log(`Profit: ${(actualProfitLoss * 100).toFixed(2)}%`);
                    console.log(`Net PNL: ${net.toFixed(4)} SOL`);
                    console.log(`Time Held: ${Math.floor(timeHeld)}s`);
                    console.log(`Sell TX: ${sellResult.txId}`);
                    console.log('===========================\n');

                    clearInterval(monitorInterval);
                    clearInterval(priceFetchInterval);
                    activeTrades.delete(tokenId);
                    displayStats();
                }
            } catch (error) {
                console.error(`Error closing trade: ${error.message}`);
                isClosing = false;
            }
        };

        // Check for momentum stagnation
        if (profitLoss >= MOMENTUM_PROFIT_THRESHOLD) {
            const priceChange = Math.abs(currentPrice - lastPrice) / lastPrice;
            
            // Define price change thresholds based on profit level
            let priceChangeThreshold;
            if (profitLoss >= MOMENTUM_PROFIT_THRESHOLD_4) {
                priceChangeThreshold = MOMENTUM_PRICE_CHANGE_THRESHOLD_4; // 15% price change required at 80%+ profit
            } else if (profitLoss >= MOMENTUM_PROFIT_THRESHOLD_3) {
                priceChangeThreshold = MOMENTUM_PRICE_CHANGE_THRESHOLD_3; // 12% price change required at 60%+ profit
            } else if (profitLoss >= MOMENTUM_PROFIT_THRESHOLD_2) {
                priceChangeThreshold = MOMENTUM_PRICE_CHANGE_THRESHOLD_2; // 8% price change required at 30%+ profit
            } else if (profitLoss >= MOMENTUM_PROFIT_THRESHOLD_1) {
                priceChangeThreshold = MOMENTUM_PRICE_CHANGE_THRESHOLD_1; // 5% price change required at 15%+ profit
            } else {
                priceChangeThreshold = 0.01; // 1% price change required at 2%+ profit
            }

            // Check if price change is below threshold
            if (priceChange < priceChangeThreshold) {
                if (!stagnantStartTime) {
                    stagnantStartTime = currentTime;
                    console.log(`Price change (${(priceChange * 100).toFixed(2)}%) below threshold (${(priceChangeThreshold * 100).toFixed(2)}%) at ${(profitLoss * 100).toFixed(2)}% profit`);
                } else if (currentTime - stagnantStartTime >= MOMENTUM_STAGNANT_TIME) {
                    console.log(`Momentum faded: Price change (${(priceChange * 100).toFixed(2)}%) below threshold (${(priceChangeThreshold * 100).toFixed(2)}%) for ${MOMENTUM_STAGNANT_TIME/1000}s at ${(profitLoss * 100).toFixed(2)}% profit`);
                    await closeTrade('Momentum Faded', true);
                    return;
                }
            } else {
                // Reset stagnant timer if price change is above threshold
                if (stagnantStartTime) {
                    console.log(`Price change (${(priceChange * 100).toFixed(2)}%) above threshold (${(priceChangeThreshold * 100).toFixed(2)}%), resetting stagnant timer`);
                    stagnantStartTime = null;
                }
            }
        } else if (profitLoss >= 0) {
            // Monitor stagnation for small profits (0% to 2%)
            const priceChange = Math.abs(currentPrice - lastPrice) / lastPrice;
            
            if (priceChange < NEUTRAL_ZONE_PRICE_CHANGE_THRESHOLD) {
                if (!stagnantStartTime) {
                    stagnantStartTime = currentTime;
                    console.log(`Small profit stagnation: Price change (${(priceChange * 100).toFixed(2)}%) below threshold (${(NEUTRAL_ZONE_PRICE_CHANGE_THRESHOLD * 100).toFixed(2)}%) at ${(profitLoss * 100).toFixed(2)}% profit`);
                } else if (currentTime - stagnantStartTime >= MOMENTUM_STAGNANT_TIME) {
                    console.log(`Small profit exit: Price stagnant at ${(priceChange * 100).toFixed(2)}% for ${MOMENTUM_STAGNANT_TIME/1000}s with ${(profitLoss * 100).toFixed(2)}% profit`);
                    await closeTrade('Neutral Zone Stagnation', true);
                    return;
                }
            } else {
                // Reset stagnant timer if price is moving
                if (stagnantStartTime) {
                    console.log(`Small profit: Price change (${(priceChange * 100).toFixed(2)}%) above threshold (${(NEUTRAL_ZONE_PRICE_CHANGE_THRESHOLD * 100).toFixed(2)}%), resetting stagnant timer`);
                    stagnantStartTime = null;
                }
            }
        }

        if (profitLoss < 0 && profitLoss >= -LOSS_THRESHOLD_TRAIL) {
            const priceChange = Math.abs(currentPrice - lastPrice) / lastPrice;
            if (priceChange < LOSS_EARLY_PRICE_CHANGE_THRESHOLD) {
                if (!stagnantStartTime) {
                    stagnantStartTime = currentTime;
                    console.log(`Early loss protection: Price change (${(priceChange * 100).toFixed(2)}%) below threshold (${(LOSS_EARLY_PRICE_CHANGE_THRESHOLD * 100).toFixed(2)}%) at ${(profitLoss * 100).toFixed(2)}% loss`);
                } else if (currentTime - stagnantStartTime >= MOMENTUM_STAGNANT_TIME) {
                    console.log(`Early loss protection triggered: Price stagnant at ${(priceChange * 100).toFixed(2)}% for ${MOMENTUM_STAGNANT_TIME/1000}s with ${(profitLoss * 100).toFixed(2)}% loss`);
                    await closeTrade('Early loss Protection', false);
                    return;
                }
            } else {
                // Reset stagnant timer if price is moving
                if (stagnantStartTime) {
                    console.log(`Loss protection: Price change (${(priceChange * 100).toFixed(2)}%) above threshold (${(LOSS_EARLY_PRICE_CHANGE_THRESHOLD * 100).toFixed(2)}%), resetting stagnant timer`);
                    stagnantStartTime = null;
                }
            }
        }
        // Check for loss protection
        if (profitLoss < -LOSS_THRESHOLD_TRAIL) {
            const priceChange = Math.abs(currentPrice - lastPrice) / lastPrice;
            // If we're in loss and price is stagnant, sell
            if (priceChange < LOSS_PRICE_CHANGE_THRESHOLD_TRAIL) {
                if (!stagnantStartTime) {
                    stagnantStartTime = currentTime;
                    console.log(`Loss protection: Price change (${(priceChange * 100).toFixed(2)}%) below threshold (${(LOSS_PRICE_CHANGE_THRESHOLD_TRAIL * 100).toFixed(2)}%) at ${(profitLoss * 100).toFixed(2)}% loss`);
                } else if (currentTime - stagnantStartTime >= MOMENTUM_STAGNANT_TIME) {
                    console.log(`Loss protection triggered: Price stagnant at ${(priceChange * 100).toFixed(2)}% for ${MOMENTUM_STAGNANT_TIME/1000}s with ${(profitLoss * 100).toFixed(2)}% loss`);
                    await closeTrade('Loss Protection', false);
                    return;
                }
            } else {
                // Reset stagnant timer if price is moving
                if (stagnantStartTime) {
                    console.log(`Loss protection: Price change (${(priceChange * 100).toFixed(2)}%) above threshold (${(LOSS_PRICE_CHANGE_THRESHOLD_TRAIL * 100).toFixed(2)}%), resetting stagnant timer`);
                    stagnantStartTime = null;
                }
            }
        }

        // Update last price and time
        lastPrice = currentPrice;
        lastPriceTime = currentTime;

        // Regular exit conditions
        if (profitLoss >= PROFIT_THRESHOLD) {
            await closeTrade('Take Profit', true);
        } else if (profitLoss <= LOSS_THRESHOLD) {
            await closeTrade('Stop Loss', false);
        } else if (currentTime - trade.buyTime >= MAX_HOLD_TIME) {
            await closeTrade('Time Out', profitLoss > 0);
        }
    }, 100);

    // Add cleanup for price fetch interval
    process.on('SIGINT', () => {
        if (priceFetchInterval) {
            clearInterval(priceFetchInterval);
        }
        if (monitorInterval) {
            clearInterval(monitorInterval);
        }
    });
}

async function checkUnaccountedTokens() {
  try {
    // Get all token accounts owned by the bot
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      BOT_PUBLIC_KEY,
      { programId: TOKEN_PROGRAM_ID }
    );

    for (const { account } of tokenAccounts.value) {
      const tokenInfo = account.data.parsed.info;
      const tokenMint = tokenInfo.mint;
      const tokenBalance = tokenInfo.tokenAmount.uiAmount;

      // Skip if balance is 0 or if it's SOL
      if (tokenBalance <= 0 || tokenMint === NATIVE_MINT.toBase58()) continue;

      // Check if this token is in our active trades
      const isActiveTrade = Object.values(activeTrades).some(trade => trade.tokenId === tokenMint);
      
      if (!isActiveTrade) {
        console.log(`Found unaccounted token: ${tokenMint} with balance ${tokenBalance}`);
        
        // Get token metadata
        const tokenData = await fetchCoinData(tokenMint);
        if (!tokenData) {
          console.log(`Could not fetch data for unaccounted token ${tokenMint}, skipping...`);
          continue;
        }

        // Attempt to sell 100% of the unaccounted tokens
        console.log(`Attempting to sell unaccounted tokens for ${tokenMint}`);
        try {
          const sellResult = await pumpFunSell({
            tokenMint,
            tokenData,
            amount: tokenBalance,
            reason: 'Unaccounted token cleanup',
            dynamicCompute: true
          });

          if (sellResult && sellResult.txId) {
            const txCheck = await checkTransactionStatus(sellResult.txId);
            if (txCheck.success) {
              console.log(`Successfully sold unaccounted tokens for ${tokenMint}`);
            } else {
              console.log(`Failed to sell unaccounted tokens for ${tokenMint}`);
            }
          }
        } catch (error) {
          console.error(`Error selling unaccounted tokens for ${tokenMint}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error checking for unaccounted tokens:', error);
  }
}

// Add periodic check for unaccounted tokens
setInterval(checkUnaccountedTokens, 30000); // Check every 30 seconds