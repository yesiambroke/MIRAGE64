const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const dotenv = require('dotenv');
const bs58 = require('bs58');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
dotenv.config();

const STATS_FILE = path.join(__dirname, 'stats.json');
const TRADES_FILE = path.join(__dirname, 'trades.json');
const ACTIVE_TRADES_FILE = path.join(__dirname, 'active-trades.json');
const WALLET_FILE = path.join(__dirname, 'wallet.json');
const STRATEGY_CONFIG_FILE = path.join(__dirname, 'strategy-config.json');

// Initial wallet data structure
const INITIAL_WALLET_DATA = {
    balance: 0,
    available: 0,
    totalValue: 0,
    lastUpdated: new Date().toISOString()
};

class BotWebSocketServer {
    constructor(port = 8080) {
        this.wss = new WebSocket.Server({ port });
        this.clients = new Set();
        this.lastStats = null;
        this.lastTrades = null;
        this.lastActiveTrades = null;
        this.lastSolPrice = null;
        this.lastWalletBalance = null;
        this.lastStrategyConfig = null;
        this.botStatus = 'stopped'; // Add bot status tracking
        
        // Initialize Solana connection
        this.connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, 'processed');
        
        // Initialize wallet from private key
        const privateKey = bs58.decode(process.env.WALLET_PRIVATE_KEY);
        this.wallet = Keypair.fromSecretKey(privateKey);
        console.log('Wallet address:', this.wallet.publicKey.toString());
        
        console.log(`WebSocket server started on port ${port}`);
        this.walletSubscription = null; // Add this line to store the subscription
        this.initializeFiles().then(() => {
            this.setupWebSocket();
            this.startFileMonitoring();
            this.startWalletMonitoring();
            this.checkBotStatus(); // Initial status check
        });
    }

    async initializeFiles() {
        try {
            // Check if wallet.json exists, if not create it
            try {
                await fs.access(WALLET_FILE);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    console.log('Creating initial wallet.json file...');
                    await fs.writeFile(WALLET_FILE, JSON.stringify(INITIAL_WALLET_DATA, null, 2));
                }
            }
        } catch (error) {
            console.error('Error initializing files:', error);
        }
    }

    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            console.log('New client connected');
            this.clients.add(ws);

            // Send initial data
            this.sendInitialData(ws);

            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    switch(data.type) {
                        case 'updateConfig':
                            await this.updateStrategyConfig(data.config);
                            break;
                        case 'botControl':
                            const success = await this.controlBot(data.action);
                            if (!success) {
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    data: `Failed to ${data.action} bot`
                                }));
                            }
                            break;
                    }
                } catch (error) {
                    console.error('Error handling message:', error);
                }
            });

            ws.on('close', () => {
                console.log('Client disconnected');
                this.clients.delete(ws);
            });
        });
    }

    async sendInitialData(ws) {
        try {
            // Fetch fresh wallet data from blockchain
            const accountInfo = await this.connection.getAccountInfo(this.wallet.publicKey);
            const solBalance = accountInfo.lamports / 1e9;
            
            // Get token accounts
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(this.wallet.publicKey, {
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            });

            // Calculate total value including tokens
            let totalValue = solBalance;
            const tokenBalances = {};
            for (const { account } of tokenAccounts.value) {
                const parsedInfo = account.data.parsed.info;
                const tokenBalance = parsedInfo.tokenAmount.uiAmount;
                if (tokenBalance > 0) {
                    const mint = parsedInfo.mint;
                    tokenBalances[mint] = tokenBalance;
                    totalValue += tokenBalance;
                }
            }

            // Create fresh wallet data
            const walletData = {
                balance: solBalance,
                available: solBalance,
                totalValue: totalValue,
                lastUpdated: new Date().toISOString(),
                address: this.wallet.publicKey.toString(),
                tokenBalances
            };

            // Write fresh data to file
            await fs.writeFile(WALLET_FILE, JSON.stringify(walletData, null, 2));
            this.lastWalletBalance = walletData;

            // Read other data from files
            const [stats, trades, activeTrades, strategyConfig] = await Promise.all([
                this.readFile(STATS_FILE),
                this.readFile(TRADES_FILE),
                this.readFile(ACTIVE_TRADES_FILE),
                this.readFile(STRATEGY_CONFIG_FILE)
            ]);

            // Extract SOL price from active trades
            const solPrice = activeTrades?.solPrice || null;
            console.log('Sending initial SOL price:', solPrice);

            ws.send(JSON.stringify({
                type: 'initial',
                data: {
                    stats: {
                        ...stats,
                        config: strategyConfig
                    },
                    trades,
                    activeTrades,
                    solPrice,
                    wallet: walletData, // Use fresh wallet data instead of file data
                    botStatus: this.botStatus
                }
            }));
        } catch (error) {
            console.error('Error sending initial data:', error);
            // If blockchain fetch fails, fall back to file data
            try {
                const [stats, trades, activeTrades, wallet, strategyConfig] = await Promise.all([
                    this.readFile(STATS_FILE),
                    this.readFile(TRADES_FILE),
                    this.readFile(ACTIVE_TRADES_FILE),
                    this.readFile(WALLET_FILE),
                    this.readFile(STRATEGY_CONFIG_FILE)
                ]);

                ws.send(JSON.stringify({
                    type: 'initial',
                    data: {
                        stats: {
                            ...stats,
                            config: strategyConfig
                        },
                        trades,
                        activeTrades,
                        solPrice: activeTrades?.solPrice || null,
                        wallet,
                        botStatus: this.botStatus
                    }
                }));
            } catch (fallbackError) {
                console.error('Error sending fallback initial data:', fallbackError);
            }
        }
    }

    async readFile(filePath) {
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`File ${filePath} not found, returning null`);
                return null;
            }
            console.error(`Error reading file ${filePath}:`, error);
            return null;
        }
    }

    async startFileMonitoring() {
        setInterval(async () => {
            try {
                const [stats, trades, activeTrades, wallet, strategyConfig] = await Promise.all([
                    this.readFile(STATS_FILE),
                    this.readFile(TRADES_FILE),
                    this.readFile(ACTIVE_TRADES_FILE),
                    this.readFile(WALLET_FILE),
                    this.readFile(STRATEGY_CONFIG_FILE)
                ]);

                // Process trades to remove duplicates and sort by timestamp
                if (trades) {
                    // Create a Map to store unique trades by tradeId
                    const uniqueTrades = new Map();
                    trades.forEach(trade => {
                        if (trade.tradeId) {
                            uniqueTrades.set(trade.tradeId, trade);
                        }
                    });

                    // Convert back to array and sort by timestamp (most recent first)
                    const sortedTrades = Array.from(uniqueTrades.values())
                        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                    // Update trades file if there were duplicates
                    if (sortedTrades.length !== trades.length) {
                        await fs.writeFile(TRADES_FILE, JSON.stringify(sortedTrades, null, 2));
                    }

                    // Check for changes and broadcast
                    if (JSON.stringify(sortedTrades) !== JSON.stringify(this.lastTrades)) {
                        this.broadcast({ type: 'trades', data: sortedTrades });
                        this.lastTrades = sortedTrades;
                    }
                }

                // Check for stats changes
                if (JSON.stringify(stats) !== JSON.stringify(this.lastStats)) {
                    this.broadcast({ 
                        type: 'stats', 
                        data: {
                            ...stats,
                            config: strategyConfig
                        }
                    });
                    this.lastStats = stats;
                }

                // Check for strategy config changes
                if (JSON.stringify(strategyConfig) !== JSON.stringify(this.lastStrategyConfig)) {
                    console.log('Broadcasting strategy config update');
                    this.broadcast({ 
                        type: 'stats', 
                        data: {
                            ...stats,
                            config: strategyConfig
                        }
                    });
                    this.lastStrategyConfig = strategyConfig;
                }

                // Check for active trades changes
                if (JSON.stringify(activeTrades) !== JSON.stringify(this.lastActiveTrades)) {
                    this.broadcast({ type: 'activeTrades', data: activeTrades });
                    this.lastActiveTrades = activeTrades;

                    // Check for SOL price updates
                    const currentSolPrice = activeTrades?.solPrice;
                    if (currentSolPrice !== this.lastSolPrice) {
                        console.log('Broadcasting SOL price update:', currentSolPrice);
                        this.broadcast({ type: 'solPrice', data: currentSolPrice });
                        this.lastSolPrice = currentSolPrice;
                    }
                }

                // Check for wallet balance updates
                if (JSON.stringify(wallet) !== JSON.stringify(this.lastWalletBalance)) {
                    console.log('Broadcasting wallet balance update:', wallet);
                    this.broadcast({ type: 'wallet', data: wallet });
                    this.lastWalletBalance = wallet;
                }
            } catch (error) {
                console.error('Error monitoring files:', error);
            }
        }, 200); // Check every 200ms
    }

    async startWalletMonitoring() {
        try {
            // Subscribe to account changes with 'processed' commitment for faster updates
            this.walletSubscription = this.connection.onAccountChange(
                this.wallet.publicKey,
                async (accountInfo) => {
                    try {
                        const solBalance = accountInfo.lamports / 1e9; // Convert lamports to SOL
                        
                        // Get token accounts for the wallet
                        const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(this.wallet.publicKey, {
                            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                        });

                        // Calculate total value including tokens
                        let totalValue = solBalance;
                        let availableBalance = solBalance;

                        // Process token accounts
                        const tokenBalances = {};
                        for (const { account } of tokenAccounts.value) {
                            const parsedInfo = account.data.parsed.info;
                            const tokenBalance = parsedInfo.tokenAmount.uiAmount;
                            if (tokenBalance > 0) {
                                const mint = parsedInfo.mint;
                                tokenBalances[mint] = tokenBalance;
                                // Add token balance to total value (assuming 1:1 for now)
                                totalValue += tokenBalance;
                            }
                        }

                        // Write wallet data to file
                        const walletData = {
                            balance: solBalance,
                            available: availableBalance,
                            totalValue: totalValue,
                            lastUpdated: new Date().toISOString(),
                            address: this.wallet.publicKey.toString(),
                            tokenBalances
                        };

                        // Write to wallet.json file
                        await fs.writeFile(WALLET_FILE, JSON.stringify(walletData, null, 2));

                        // Update last wallet balance and broadcast if changed
                        if (JSON.stringify(walletData) !== JSON.stringify(this.lastWalletBalance)) {
                            console.log('Broadcasting wallet balance update:', walletData);
                            this.broadcast({ type: 'wallet', data: walletData });
                            this.lastWalletBalance = walletData;
                        }
                    } catch (error) {
                        console.error('Error processing wallet update:', error);
                    }
                },
                'processed'  // Changed from 'confirmed' to 'processed' for faster updates
            );

            // Also subscribe to token account changes
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(this.wallet.publicKey, {
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            });

            // Subscribe to each token account
            for (const { pubkey } of tokenAccounts.value) {
                this.connection.onAccountChange(
                    pubkey,
                    async () => {
                        // When a token account changes, trigger a full wallet update
                        const accountInfo = await this.connection.getAccountInfo(this.wallet.publicKey);
                        if (accountInfo) {
                            const solBalance = accountInfo.lamports / 1e9;
                            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(this.wallet.publicKey, {
                                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                            });

                            let totalValue = solBalance;
                            const tokenBalances = {};
                            for (const { account } of tokenAccounts.value) {
                                const parsedInfo = account.data.parsed.info;
                                const tokenBalance = parsedInfo.tokenAmount.uiAmount;
                                if (tokenBalance > 0) {
                                    const mint = parsedInfo.mint;
                                    tokenBalances[mint] = tokenBalance;
                                    totalValue += tokenBalance;
                                }
                            }

                            const walletData = {
                                balance: solBalance,
                                available: solBalance,
                                totalValue: totalValue,
                                lastUpdated: new Date().toISOString(),
                                address: this.wallet.publicKey.toString(),
                                tokenBalances
                            };

                            await fs.writeFile(WALLET_FILE, JSON.stringify(walletData, null, 2));
                            this.broadcast({ type: 'wallet', data: walletData });
                            this.lastWalletBalance = walletData;
                        }
                    },
                    'processed'
                );
            }

            console.log('Wallet monitoring started via WebSocket subscription');
        } catch (error) {
            console.error('Error starting wallet monitoring:', error);
        }
    }

    async updateStrategyConfig(newConfig) {
        try {
            // Read current config
            const configData = await this.readFile(STRATEGY_CONFIG_FILE);
            const currentConfig = typeof configData === 'string' ? JSON.parse(configData) : configData;
            console.log('Current config tradeCooldownEnabled:', currentConfig.tradeCooldownEnabled); // Debug log
            console.log('New config tradeCooldownEnabled:', newConfig.tradeCooldownEnabled); // Debug log

            // Process the new config values
            const processedConfig = { ...currentConfig };
            Object.entries(newConfig).forEach(([key, value]) => {
                if (value === undefined) {
                    // Skip undefined values
                    return;
                }

                if (key === 'tradeCooldownEnabled') {
                    // Explicitly handle boolean value
                    const newValue = value === true || value === 'true' || value === 1;
                    console.log(`Processing tradeCooldownEnabled: input=${value}, converted=${newValue}`); // Debug log
                    processedConfig[key] = newValue;
                } else if (key === 'tradeCooldownProfitCap') {
                    // Direct numeric value (SOL)
                    processedConfig[key] = parseFloat(value);
                } else if (key === 'tradeCooldownDuration') {
                    // Convert minutes to seconds
                    processedConfig[key] = parseFloat(value);
                } else if (key === 'tradeCooldown') { 
                    // Convert minutes to milliseconds
                    processedConfig[key] = parseFloat(value);
                } else if (key === 'maxHoldTime') {
                    // Value is already in milliseconds from dashboard
                    processedConfig[key] = parseFloat(value);
                } else if (key === 'momentumStagnantTime') {
                    // Value is already in milliseconds from dashboard
                    processedConfig[key] = parseFloat(value);
                } else if (key === 'profitThreshold' || key === 'lossThreshold' || 
                         key === 'momentumProfitThreshold' || key === 'lossThresholdTrail' || 
                         key === 'lossPriceChangeThresholdTrail' || key === 'creatorOwnershipMax' ||
                         key === 'pumpThreshold') {
                    // Convert percentage to decimal
                    processedConfig[key] = parseFloat(value);
                } else if (key === 'marketCapLimits') {
                    // Handle nested object
                    processedConfig[key] = {
                        ...currentConfig.marketCapLimits,
                        ...Object.fromEntries(
                            Object.entries(value).map(([k, v]) => [k, v === '' ? undefined : parseFloat(v)])
                        )
                    };
                } else if (key === 'momentumProfitThresholds' || key === 'momentumPriceChangeThresholds') {
                    // Handle momentum thresholds - convert percentages to decimals
                    processedConfig[key] = {
                        ...(currentConfig[key] || {}),
                        ...Object.fromEntries(
                            Object.entries(value).map(([k, v]) => {
                                if (v === '' || v === undefined) return [k, undefined];
                                const num = parseFloat(String(v).replace(',', '.'));
                                return [k, isNaN(num) ? undefined : num];
                            })
                        )
                    };
                } else if (key === 'useDexScreenerFilter') {
                    // Boolean value
                    processedConfig[key] = value === true || value === 'true' || value === 1;
                } else if (key === 'buyThreshold') {
                    // Integer value
                    processedConfig[key] = parseInt(value);
                } else {
                    // Direct numeric values for other fields
                    processedConfig[key] = parseFloat(value);
                }
            });

            console.log('Final processed config tradeCooldownEnabled:', processedConfig.tradeCooldownEnabled); // Debug log

            // Write updated config
            await fs.writeFile(
                STRATEGY_CONFIG_FILE,
                JSON.stringify(processedConfig, null, 2)
            );

            // Verify the file was written correctly
            const verifyConfig = await this.readFile(STRATEGY_CONFIG_FILE);
            console.log('Verified config tradeCooldownEnabled:', verifyConfig.tradeCooldownEnabled); // Debug log

            // Broadcast the update
            const stats = await this.getStats();
            this.broadcast({
                type: 'stats',
                data: {
                    ...stats,
                    config: processedConfig
                }
            });

            return true;
        } catch (error) {
            console.error('Error updating strategy config:', error);
            return false;
        }
    }

    broadcast(data) {
        const message = JSON.stringify(data);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    // Add new method to check bot status
    async checkBotStatus() {
        try {
            const { stdout } = await execPromise('pm2 jlist');
            const processes = JSON.parse(stdout);
            const botProcess = processes.find(p => p.name === 'algo');
            
            if (botProcess) {
                this.botStatus = botProcess.pm2_env.status === 'online' ? 'running' : 'stopped';
            } else {
                this.botStatus = 'stopped';
            }
            
            // Broadcast status to all clients
            this.broadcast({
                type: 'botStatus',
                data: this.botStatus
            });
        } catch (error) {
            console.error('Error checking bot status:', error);
            this.botStatus = 'stopped';
        }
    }

    // Add new method to control bot
    async controlBot(action) {
        try {
            switch(action) {
                case 'start':
                    await execPromise('pm2 start algo');
                    break;
                case 'stop':
                    await execPromise('pm2 stop algo');
                    break;
                case 'restart':
                    await execPromise('pm2 restart algo');
                    break;
                default:
                    throw new Error(`Invalid action: ${action}`);
            }
            
            // Wait a moment for PM2 to update
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check and broadcast new status
            await this.checkBotStatus();
            
            return true;
        } catch (error) {
            console.error(`Error ${action}ing bot:`, error);
            return false;
        }
    }

    // Add cleanup method for subscription
    async cleanup() {
        if (this.walletSubscription) {
            try {
                await this.connection.removeAccountChangeListener(this.walletSubscription);
                this.walletSubscription = null;
                console.log('Wallet subscription cleaned up');
            } catch (error) {
                console.error('Error cleaning up wallet subscription:', error);
            }
        }
    }

    async getStats() {
        try {
            const stats = await this.readFile(STATS_FILE);
            return stats || {};
        } catch (error) {
            console.error('Error getting stats:', error);
            return {};
        }
    }
}

// Start the server
const server = new BotWebSocketServer(8080); 