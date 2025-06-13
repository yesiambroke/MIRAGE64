import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Grid,
  Heading,
  Text,
  VStack,
  HStack,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  useColorModeValue,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Input,
  Button,
  useToast,
  Tooltip,
  Collapse,
  IconButton,
  Select,
  Checkbox,
} from '@chakra-ui/react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { ChevronDownIcon, ChevronUpIcon } from '@chakra-ui/icons';
import withAuth from '../components/withAuth';
import { useRouter } from 'next/router';
import { AUTH_CONFIG } from '../config/auth';

const globalStyles = `
  @keyframes scanline {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  @keyframes pulse {
    0% {
      opacity: 0.5;
      transform: scale(1);
    }
    50% {
      opacity: 0.8;
      transform: scale(1.1);
    }
    100% {
      opacity: 0.5;
      transform: scale(1);
    }
  }

  @keyframes glitch {
    0% {
      transform: translate(0);
      text-shadow: 0 0 20px rgba(0, 255, 157, 0.5);
    }
    20% {
      transform: translate(-1px, 1px);
      text-shadow: 1px 1px 20px rgba(157, 78, 221, 0.5);
    }
    40% {
      transform: translate(-1px, -1px);
      text-shadow: 1px -1px 20px rgba(0, 255, 157, 0.5);
    }
    60% {
      transform: translate(1px, 1px);
      text-shadow: -1px 1px 20px rgba(157, 78, 221, 0.5);
    }
    80% {
      transform: translate(1px, -1px);
      text-shadow: -1px -1px 20px rgba(0, 255, 157, 0.5);
    }
    100% {
      transform: translate(0);
      text-shadow: 0 0 20px rgba(0, 255, 157, 0.5);
    }
  }

  @keyframes neonPulse {
    0% {
      text-shadow: 0 0 10px rgba(0, 255, 157, 0.5),
                   0 0 20px rgba(0, 255, 157, 0.3);
    }
    50% {
      text-shadow: 0 0 15px rgba(0, 255, 157, 0.6),
                   0 0 25px rgba(0, 255, 157, 0.4);
    }
    100% {
      text-shadow: 0 0 10px rgba(0, 255, 157, 0.5),
                   0 0 20px rgba(0, 255, 157, 0.3);
    }
  }

  @keyframes borderGlow {
    0% {
      box-shadow: 0 0 5px rgba(0, 255, 157, 0.3);
    }
    50% {
      box-shadow: 0 0 10px rgba(0, 255, 157, 0.5);
    }
    100% {
      box-shadow: 0 0 5px rgba(0, 255, 157, 0.3);
    }
  }
`;

const ConfigCard = ({ title, children }) => (
  <Box
    bg="rgba(31, 41, 55, 0.8)"
    p={4}
    borderRadius="lg"
    borderWidth={1}
    borderColor="rgba(0, 255, 157, 0.2)"
    position="relative"
    overflow="hidden"
    _before={{
      content: '""',
      position: 'absolute',
      inset: 0,
      bg: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
      opacity: 0,
      transition: 'opacity 0.3s ease',
      zIndex: 0,
      pointerEvents: 'none'
    }}
    _hover={{
      _before: {
        opacity: 1,
      },
      transform: 'translateY(-2px)',
      boxShadow: '0 0 20px rgba(0, 255, 157, 0.1)',
    }}
  >
    <Text
      color="gray.400"
      fontSize="sm"
      fontWeight="bold"
      mb={3}
      textTransform="uppercase"
      letterSpacing="0.05em"
    >
      {title}
    </Text>
    {children}
  </Box>
);

const ConfigInput = ({ label, value, onChange, unit, width = "60px" }) => {
  // Format the value to avoid floating point issues
  const displayValue = typeof value === 'number' ? Number(value.toFixed(2)) : value;
  
  const handleChange = (e) => {
    const input = e.target.value;
    // Allow empty string, numbers, single comma, and single dot
    if (input === '' || /^-?\d*[,.]?\d*$/.test(input)) {
      // Create a new event with the processed value
      const processedEvent = {
        ...e,
        target: {
          ...e.target,
          value: input === '' ? '' : input.replace(',', '.')
        }
      };
      onChange(processedEvent);
    }
  };
  
  return (
  <HStack spacing={2} mb={2} justify="space-between">
    <Text color="gray.300" fontSize="sm" minW="120px">{label}</Text>
    <HStack spacing={1} justify="flex-end" minW="90px">
      <Input
        size="sm"
        value={displayValue || ''}
        onChange={handleChange}
        width={width}
        textAlign="right"
        color="white"
        bg="rgba(31, 41, 55, 0.9)"
        borderColor="rgba(0, 255, 157, 0.2)"
        _hover={{
          borderColor: "rgba(0, 255, 157, 0.4)",
        }}
        _focus={{
          borderColor: "green.400",
          boxShadow: "0 0 0 1px rgba(0, 255, 157, 0.2)",
        }}
        _placeholder={{
          color: "gray.500",
        }}
      />
      {unit && <Text color="gray.400" fontSize="sm" minW="15px">{unit}</Text>}
    </HStack>
  </HStack>
);
};

const Dashboard = () => {
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [trades, setTrades] = useState([]);
  const [activeTrades, setActiveTrades] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [solPrice, setSolPrice] = useState(null);
  const [walletBalance, setWalletBalance] = useState(null);
  const [editingConfig, setEditingConfig] = useState({});
  const [config, setConfig] = useState({});
  const [ws, setWs] = useState(null);
  const [botStatus, setBotStatus] = useState('stopped');
  const [currentTime, setCurrentTime] = useState(null);
  const toast = useToast();
  const [expandedSections, setExpandedSections] = useState({
    momentumProfit: false,
    momentumPriceChange: false
  });

  // Add time update effect
  useEffect(() => {
    // Set initial time
    setCurrentTime(new Date());
    
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Format time for different timezones
  const formatTime = (date, timezone) => {
    if (!date) return '--:--:--';
    return date.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  useEffect(() => {
    const websocket = new WebSocket('ws://m64.apteka.wtf');
    setWs(websocket);

    websocket.onopen = () => {
      console.log('Connected to WebSocket');
      setWsConnected(true);
    };

    websocket.onclose = () => {
      console.log('Disconnected from WebSocket');
      setWsConnected(false);
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'initial':
          setStats(data.data.stats || null);
          setConfig(data.data.stats?.config || {});
          setTrades(Array.isArray(data.data.trades) ? data.data.trades : []);
          setActiveTrades(Array.isArray(data.data.activeTrades?.activeTrades) ? data.data.activeTrades.activeTrades : []);
          if (data.data.solPrice) {
            setSolPrice(data.data.solPrice);
          }
          if (data.data.wallet) {
            setWalletBalance(data.data.wallet);
          }
          if (data.data.botStatus) {
            setBotStatus(data.data.botStatus);
          }
          break;
        case 'stats':
          setStats(data.data || null);
          setConfig(data.data?.config || {});
          break;
        case 'trades':
          setTrades(Array.isArray(data.data) ? data.data : []);
          break;
        case 'activeTrades':
          setActiveTrades(Array.isArray(data.data?.activeTrades) ? data.data.activeTrades : []);
          if (data.data?.solPrice) {
            setSolPrice(data.data.solPrice);
          }
          break;
        case 'solPrice':
          setSolPrice(data.data);
          break;
        case 'wallet':
          setWalletBalance(data.data);
          break;
        case 'botStatus':
          setBotStatus(data.data);
          break;
      }
    };

    return () => {
      websocket.close();
    };
  }, []);

  const handleConfigChange = (key, value) => {
    // Convert empty string to undefined
    if (value === '') {
      setEditingConfig(prev => {
        const newConfig = { ...prev };
        delete newConfig[key];
        return newConfig;
      });
      return;
    }

    // Handle numeric values
    if (typeof value === 'string') {
      // Replace comma with dot for decimal numbers
      value = value.replace(',', '.');
      
      // Try to convert to number if it's a valid numeric string
      if (/^-?\d*\.?\d*$/.test(value)) {
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
          // For maxHoldTime and momentumStagnantTime, store the raw seconds value
          if (key === 'maxHoldTime' || key === 'momentumStagnantTime') {
            value = numValue;
          } else {
            value = numValue;
          }
        }
      }
    }

    console.log(`handleConfigChange - ${key}:`, { value, type: typeof value }); // Debug log

    setEditingConfig(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleConfigSave = async () => {
    if (!ws) return;

    try {
      // Start with original config and merge with edited values
      const processedConfig = { ...config };

      // Convert string values to proper numeric values
      Object.entries(editingConfig).forEach(([key, value]) => {
        console.log(`Processing ${key}:`, { value, type: typeof value }); // Debug log

        if (value === '' || value === undefined) {
          // Empty values become undefined (let backend handle defaults)
          processedConfig[key] = undefined;
        } else if (key === 'maxHoldTime') {
          // Convert seconds to milliseconds
          const numValue = parseFloat(value);
          processedConfig[key] = numValue * 1000;
        } else if (key === 'momentumStagnantTime') {
          // Convert seconds to milliseconds
          const numValue = parseFloat(value);
          processedConfig[key] = numValue * 1000;
        } else if (key === 'tradeAmount' || key === 'minVolume') {
          // Direct numeric values
          processedConfig[key] = parseFloat(value);
        } else if (key === 'maxTrades' || key === 'maxTradesPerToken' || key === 'buyThreshold') {
          // Integer values
          processedConfig[key] = parseInt(value);
        } else if (key === 'tradeCooldown') {
          // Convert minutes to milliseconds
          processedConfig[key] = parseFloat(value)  * 60 * 1000;
        } else if (key === 'tradeCooldownProfitCap') {
          // Direct numeric value for profit cap in SOL
          processedConfig[key] = parseFloat(value);
        } else if (key === 'tradeCooldownDuration') {
          // Convert minutes to seconds for cooldown duration
          processedConfig[key] = parseFloat(value) * 60 * 1000;
        } else if(key === 'profitThreshold' || key === 'lossThreshold' || key === 'momentumProfitThreshold' || key === 'pumpThreshold'){
          processedConfig[key] = parseFloat(value) / 100;
        } else if (key === 'tradeCooldownEnabled' || key === 'useDexScreenerFilter') {
          // Handle boolean values
          processedConfig[key] = Boolean(value);
          console.log(`Processed boolean ${key}:`, processedConfig[key]); // Debug log
        } else if (key === 'marketCapLimits') {
          // Handle nested object
          processedConfig[key] = {
            ...config.marketCapLimits,
            ...Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, v === '' ? undefined : parseFloat(v)])
            )
          };
        } else if (key === 'momentumProfitThresholds' || key === 'momentumPriceChangeThresholds') {
          // Handle momentum thresholds - convert percentages to decimals
          processedConfig[key] = {
            ...(config[key] || {}),
            ...Object.fromEntries(
              Object.entries(value).map(([k, v]) => {
                if (v === '' || v === undefined) return [k, undefined];
                const num = parseFloat(String(v).replace(',', '.'));
                return [k, isNaN(num) ? undefined : num / 100];
              })
            )
          };
        }
      });

      console.log('Sending config update:', processedConfig); // Add logging to debug

      ws.send(JSON.stringify({
        type: 'updateConfig',
        config: processedConfig
      }));

      toast({
        render: () => (
          <Box
            position="relative"
            bg="rgba(157, 78, 221, 0.15)"
            p={4}
            borderRadius="md"
            borderWidth={1}
            borderColor="green.400"
            boxShadow="0 0 30px rgba(0, 255, 157, 0.3)"
            backdropFilter="blur(8px)"
            overflow="hidden"
            _before={{
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '1px',
              background: 'linear-gradient(90deg, transparent, rgba(157, 78, 221, 0.5), transparent)',
              animation: 'scanline 2s linear infinite',
            }}
            _after={{
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'linear-gradient(45deg, rgba(157, 78, 221, 0.2), rgba(0, 255, 157, 0.1))',
              opacity: 0.05,
              animation: 'pulse 2s ease-in-out infinite',
            }}
          >
            <HStack spacing={3}>
              <Box
                w={2}
                h={2}
                borderRadius="full"
                bg="green.400"
                boxShadow="0 0 10px rgba(0, 255, 157, 0.5)"
                position="relative"
                _before={{
                  content: '""',
                  position: 'absolute',
                  top: '-4px',
                  left: '-4px',
                  right: '-4px',
                  bottom: '-4px',
                  borderRadius: 'full',
                  border: '1px solid rgba(0, 255, 157, 0.5)',
                  opacity: 0.5,
                  animation: 'pulse 2s ease-in-out infinite',
                }}
              />
              <VStack align="start" spacing={1}>
                <Text
                  color="green.400"
                  fontWeight="bold"
                  fontSize="sm"
                  textShadow="0 0 10px rgba(0, 255, 157, 0.5)"
                  letterSpacing="0.05em"
                  opacity={0.9}
                >
                  Config Updated
                </Text>
                <Text color="gray.300" fontSize="xs" opacity={0.8}>
                  Strategy configuration has been updated successfully.
                </Text>
              </VStack>
            </HStack>
          </Box>
        ),
        duration: 3000,
        isClosable: true,
        position: 'bottom-left',
      });

      setEditingConfig({});
    } catch (error) {
      toast({
        render: () => (
          <Box
            position="relative"
            bg="rgba(157, 78, 221, 0.15)"
            p={4}
            borderRadius="md"
            borderWidth={1}
            borderColor="red.400"
            boxShadow="0 0 30px rgba(239, 68, 68, 0.3)"
            backdropFilter="blur(8px)"
            overflow="hidden"
            _before={{
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '1px',
              background: 'linear-gradient(90deg, transparent, rgba(239, 68, 68, 0.5), transparent)',
              animation: 'scanline 2s linear infinite',
            }}
            _after={{
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'linear-gradient(45deg, rgba(157, 78, 221, 0.2), rgba(239, 68, 68, 0.1))',
              opacity: 0.05,
              animation: 'pulse 2s ease-in-out infinite',
            }}
          >
            <HStack spacing={3}>
              <Box
                w={2}
                h={2}
                borderRadius="full"
                bg="red.400"
                boxShadow="0 0 10px rgba(239, 68, 68, 0.5)"
                position="relative"
                _before={{
                  content: '""',
                  position: 'absolute',
                  top: '-4px',
                  left: '-4px',
                  right: '-4px',
                  bottom: '-4px',
                  borderRadius: 'full',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  opacity: 0.5,
                  animation: 'pulse 2s ease-in-out infinite',
                }}
              />
              <VStack align="start" spacing={1}>
                <Text
                  color="red.400"
                  fontWeight="bold"
                  fontSize="sm"
                  textShadow="0 0 10px rgba(239, 68, 68, 0.5)"
                  letterSpacing="0.05em"
                  opacity={0.9}
                >
                  Error
                </Text>
                <Text color="gray.300" fontSize="xs" opacity={0.8}>
                  Failed to update strategy configuration.
                </Text>
              </VStack>
            </HStack>
          </Box>
        ),
        duration: 3000,
        isClosable: true,
        position: 'bottom-left',
      });
    }
  };

  const handleBotControl = async (action) => {
    if (!ws) return;

    try {
      ws.send(JSON.stringify({
        type: 'botControl',
        action: action
      }));

      toast({
        render: () => (
          <Box
            position="relative"
            bg="rgba(157, 78, 221, 0.15)"
            p={4}
            borderRadius="md"
            borderWidth={1}
            borderColor="green.400"
            boxShadow="0 0 30px rgba(0, 255, 157, 0.3)"
            backdropFilter="blur(8px)"
            overflow="hidden"
            _before={{
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '1px',
              background: 'linear-gradient(90deg, transparent, rgba(157, 78, 221, 0.5), transparent)',
              animation: 'scanline 2s linear infinite',
            }}
            _after={{
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'linear-gradient(45deg, rgba(157, 78, 221, 0.2), rgba(0, 255, 157, 0.1))',
              opacity: 0.05,
              animation: 'pulse 2s ease-in-out infinite',
            }}
          >
            <HStack spacing={3}>
              <Box
                w={2}
                h={2}
                borderRadius="full"
                bg="green.400"
                boxShadow="0 0 10px rgba(0, 255, 157, 0.5)"
                position="relative"
                _before={{
                  content: '""',
                  position: 'absolute',
                  top: '-4px',
                  left: '-4px',
                  right: '-4px',
                  bottom: '-4px',
                  borderRadius: 'full',
                  border: '1px solid rgba(0, 255, 157, 0.5)',
                  opacity: 0.5,
                  animation: 'pulse 2s ease-in-out infinite',
                }}
              />
              <VStack align="start" spacing={1}>
                <Text
                  color="green.400"
                  fontWeight="bold"
                  fontSize="sm"
                  textShadow="0 0 10px rgba(0, 255, 157, 0.5)"
                  letterSpacing="0.05em"
                  opacity={0.9}
                >
                  Bot Control
                </Text>
                <Text color="gray.300" fontSize="xs" opacity={0.8}>
                  Bot {action} command sent successfully.
                </Text>
              </VStack>
            </HStack>
          </Box>
        ),
        duration: 3000,
        isClosable: true,
        position: 'bottom-left',
      });
    } catch (error) {
      toast({
        render: () => (
          <Box
            position="relative"
            bg="rgba(157, 78, 221, 0.15)"
            p={4}
            borderRadius="md"
            borderWidth={1}
            borderColor="red.400"
            boxShadow="0 0 30px rgba(239, 68, 68, 0.3)"
            backdropFilter="blur(8px)"
            overflow="hidden"
            _before={{
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '1px',
              background: 'linear-gradient(90deg, transparent, rgba(239, 68, 68, 0.5), transparent)',
              animation: 'scanline 2s linear infinite',
            }}
            _after={{
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'linear-gradient(45deg, rgba(157, 78, 221, 0.2), rgba(239, 68, 68, 0.1))',
              opacity: 0.05,
              animation: 'pulse 2s ease-in-out infinite',
            }}
          >
            <HStack spacing={3}>
              <Box
                w={2}
                h={2}
                borderRadius="full"
                bg="red.400"
                boxShadow="0 0 10px rgba(239, 68, 68, 0.5)"
                position="relative"
                _before={{
                  content: '""',
                  position: 'absolute',
                  top: '-4px',
                  left: '-4px',
                  right: '-4px',
                  bottom: '-4px',
                  borderRadius: 'full',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  opacity: 0.5,
                  animation: 'pulse 2s ease-in-out infinite',
                }}
              />
              <VStack align="start" spacing={1}>
                <Text
                  color="red.400"
                  fontWeight="bold"
                  fontSize="sm"
                  textShadow="0 0 10px rgba(239, 68, 68, 0.5)"
                  letterSpacing="0.05em"
                  opacity={0.9}
                >
                  Error
                </Text>
                <Text color="gray.300" fontSize="xs" opacity={0.8}>
                  Failed to {action} bot.
                </Text>
              </VStack>
            </HStack>
          </Box>
        ),
        duration: 3000,
        isClosable: true,
        position: 'bottom-left',
      });
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const renderConfigSection = () => {
    const currentConfig = { ...config, ...editingConfig };
    
    return (
      <Grid templateColumns="repeat(2, 1fr)" gap={4}>
        {/* Trade Settings */}
        <ConfigCard title="Trade Settings">
          <VStack align="stretch" spacing={2}>
            <ConfigInput
              label="Trade Amount (SOL)"
              value={editingConfig.tradeAmount !== undefined ? editingConfig.tradeAmount : (config.tradeAmount || '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, tradeAmount: e.target.value }))}
            />
            <ConfigInput
              label="Max Trades"
              value={editingConfig.maxTrades !== undefined ? editingConfig.maxTrades : (config.maxTrades || '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, maxTrades: e.target.value }))}
            />
            <ConfigInput
              label="Max Trades/Token"
              value={editingConfig.maxTradesPerToken !== undefined ? editingConfig.maxTradesPerToken : (config.maxTradesPerToken || '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, maxTradesPerToken: e.target.value }))}
            />
            <ConfigInput
              label="Trade Cooldown (min)"
              value={editingConfig.tradeCooldown !== undefined ? editingConfig.tradeCooldown : (config.tradeCooldown ? config.tradeCooldown / (1000 * 60) : '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, tradeCooldown: e.target.value }))}
            />
            <ConfigInput
              label="Max Hold Time (s)"
              value={editingConfig.maxHoldTime !== undefined 
                ? editingConfig.maxHoldTime 
                : (config.maxHoldTime ? Math.round(config.maxHoldTime / 1000) : '')}
              onChange={(e) => {
                const value = e.target.value;
                // Only allow positive numbers
                if (value === '' || /^\d*\.?\d*$/.test(value)) {
                  setEditingConfig(prev => ({ ...prev, maxHoldTime: value === '' ? '' : parseFloat(value) }));
                }
              }}
            />
            <HStack spacing={2} mb={2} justify="space-between">
              <Text color="gray.300" fontSize="sm" minW="120px">Enable Profit Cooldown</Text>
              <Checkbox
                isChecked={editingConfig.tradeCooldownEnabled !== undefined ? editingConfig.tradeCooldownEnabled : (config.tradeCooldownEnabled || false)}
                onChange={(e) => setEditingConfig(prev => ({ ...prev, tradeCooldownEnabled: e.target.checked }))}
                colorScheme="green"
                size="sm"
                borderColor="rgba(0, 255, 157, 0.2)"
                _hover={{
                  borderColor: "rgba(0, 255, 157, 0.4)",
                }}
                _checked={{
                  bg: "rgba(0, 255, 157, 0.2)",
                  borderColor: "green.400",
                  _hover: {
                    bg: "rgba(0, 255, 157, 0.3)",
                    borderColor: "green.400",
                  }
                }}
              />
            </HStack>
            <ConfigInput
              label="Profit Cap (SOL)"
              value={editingConfig.tradeCooldownProfitCap !== undefined ? editingConfig.tradeCooldownProfitCap : (config.tradeCooldownProfitCap || '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, tradeCooldownProfitCap: e.target.value }))}
            />
            <ConfigInput
              label="Cooldown Duration (min)"
              value={editingConfig.tradeCooldownDuration !== undefined ? editingConfig.tradeCooldownDuration : (config.tradeCooldownDuration ? config.tradeCooldownDuration / 60 : '')}
              onChange={(e) => {
                const value = e.target.value;
                // Only allow positive numbers
                if (value === '' || /^\d*\.?\d*$/.test(value)) {
                  const numValue = value === '' ? '' : parseFloat(value);
                  setEditingConfig(prev => ({ ...prev, tradeCooldownDuration: numValue }));
                }
              }}
            />
          </VStack>
        </ConfigCard>

        {/* Profit/Loss Settings */}
        <ConfigCard title="Profit/Loss Settings">
          <VStack align="stretch" spacing={2}>
            <ConfigInput
              label="Profit Threshold (%)"
              value={editingConfig.profitThreshold !== undefined ? editingConfig.profitThreshold : (config.profitThreshold ? Number((config.profitThreshold * 100).toFixed(2)) : '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, profitThreshold: e.target.value }))}
            />
            <ConfigInput
              label="Loss Threshold (%)"
              value={editingConfig.lossThreshold !== undefined ? editingConfig.lossThreshold : (config.lossThreshold ? Number((config.lossThreshold * 100).toFixed(2)) : '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, lossThreshold: e.target.value }))}
            />
            <ConfigInput
              label="Momentum Profit (%)"
              value={editingConfig.momentumProfitThreshold !== undefined ? editingConfig.momentumProfitThreshold : (config.momentumProfitThreshold ? Number((config.momentumProfitThreshold * 100).toFixed(2)) : '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, momentumProfitThreshold: e.target.value }))}
            />
            <ConfigInput
              label="Loss Threshold Trail (%)"
              value={editingConfig.lossThresholdTrail !== undefined ? editingConfig.lossThresholdTrail : (config.lossThresholdTrail ? Number((config.lossThresholdTrail * 100).toFixed(2)) : '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, lossThresholdTrail: e.target.value }))}
            />
            <ConfigInput
              label="Loss Price Change Trail (%)"
              value={editingConfig.lossPriceChangeThresholdTrail !== undefined ? editingConfig.lossPriceChangeThresholdTrail : (config.lossPriceChangeThresholdTrail ? Number((config.lossPriceChangeThresholdTrail * 100).toFixed(2)) : '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, lossPriceChangeThresholdTrail: e.target.value }))}
            />
          </VStack>
        </ConfigCard>

        {/* Market Settings */}
        <ConfigCard title="Market Settings">
          <VStack align="stretch" spacing={2}>
            <ConfigInput
              label="Market Cap Min (SOL)"
              value={editingConfig.marketCapLimits?.min !== undefined ? editingConfig.marketCapLimits.min : (config.marketCapLimits?.min || '')}
              onChange={(e) => setEditingConfig(prev => ({ 
                ...prev, 
                marketCapLimits: { 
                  ...(prev.marketCapLimits || config.marketCapLimits || {}), 
                  min: e.target.value 
                } 
              }))}
            />
            <ConfigInput
              label="Market Cap Max (SOL)"
              value={editingConfig.marketCapLimits?.max !== undefined ? editingConfig.marketCapLimits.max : (config.marketCapLimits?.max || '')}
              onChange={(e) => setEditingConfig(prev => ({ 
                ...prev, 
                marketCapLimits: { 
                  ...(prev.marketCapLimits || config.marketCapLimits || {}), 
                  max: e.target.value 
                } 
              }))}
            />
            <ConfigInput
              label="Buy Threshold (count)"
              value={editingConfig.buyThreshold !== undefined ? editingConfig.buyThreshold : (config.buyThreshold || '')}
              onChange={(e) => {
                const value = e.target.value;
                // Only allow positive integers
                if (value === '' || /^\d+$/.test(value)) {
                  setEditingConfig(prev => ({ ...prev, buyThreshold: parseInt(value) || '' }));
                }
              }}
            />
            <ConfigInput
              label="Pump Threshold (%)"
              value={editingConfig.pumpThreshold !== undefined ? editingConfig.pumpThreshold : (config.pumpThreshold ? Number((config.pumpThreshold * 100).toFixed(2)) : '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, pumpThreshold: e.target.value }))}
            />
            <ConfigInput
              label="Volume Threshold (%)"
              value={editingConfig.volumeThreshold !== undefined ? editingConfig.volumeThreshold : (config.volumeThreshold || '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, volumeThreshold: e.target.value }))}
            />
            <ConfigInput
              label="Min Volume (SOL)"
              value={editingConfig.minVolume !== undefined ? editingConfig.minVolume : (config.minVolume || '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, minVolume: e.target.value }))}
            />
            <ConfigInput
              label="Dev Hold Max (%)"
              value={editingConfig.creatorOwnershipMax !== undefined ? editingConfig.creatorOwnershipMax : (config.creatorOwnershipMax ? config.creatorOwnershipMax * 100 : '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, creatorOwnershipMax: e.target.value }))}
            />
            <HStack spacing={2} mb={2} justify="space-between">
              <Text color="gray.300" fontSize="sm" minW="120px">Dex Paid</Text>
              <Checkbox
                isChecked={editingConfig.useDexScreenerFilter !== undefined ? editingConfig.useDexScreenerFilter : (config.useDexScreenerFilter || false)}
                onChange={(e) => setEditingConfig(prev => ({ ...prev, useDexScreenerFilter: e.target.checked }))}
                colorScheme="green"
                size="sm"
                borderColor="rgba(0, 255, 157, 0.2)"
                _hover={{
                  borderColor: "rgba(0, 255, 157, 0.4)",
                }}
                _checked={{
                  bg: "rgba(0, 255, 157, 0.2)",
                  borderColor: "green.400",
                  _hover: {
                    bg: "rgba(0, 255, 157, 0.3)",
                    borderColor: "green.400",
                  }
                }}
              />
            </HStack>
          </VStack>
        </ConfigCard>

        {/* Momentum Settings */}
        <ConfigCard title="Momentum Settings">
          <VStack align="stretch" spacing={2}>
            <Box>
              <HStack 
                spacing={2} 
                cursor="pointer" 
                onClick={() => toggleSection('momentumProfit')}
                _hover={{ opacity: 0.8 }}
                mb={2}
              >
                <Text color="gray.400" fontSize="sm" fontWeight="bold">Profit Thresholds</Text>
                <IconButton
                  aria-label={expandedSections.momentumProfit ? 'Collapse' : 'Expand'}
                  icon={expandedSections.momentumProfit ? <ChevronUpIcon /> : <ChevronDownIcon />}
                  size="xs"
                  variant="ghost"
                  color="gray.400"
                />
              </HStack>
              <Collapse in={expandedSections.momentumProfit}>
                <VStack align="stretch" spacing={2} pl={4}>
                  {Object.entries(config.momentumProfitThresholds || {}).map(([key, value]) => (
                    <ConfigInput
                      key={key}
                      label={key}
                      value={editingConfig.momentumProfitThresholds?.[key] !== undefined 
                        ? editingConfig.momentumProfitThresholds[key]
                        : (value ? Number((value * 100).toFixed(2)) : '')}
                      onChange={(e) => {
                        setEditingConfig(prev => ({
                          ...prev,
                          momentumProfitThresholds: {
                            ...(prev.momentumProfitThresholds || {}),
                            [key]: e.target.value
                          }
                        }));
                      }}
                    />
                  ))}
                </VStack>
              </Collapse>
            </Box>

            <Box>
              <HStack 
                spacing={2} 
                cursor="pointer" 
                onClick={() => toggleSection('momentumPriceChange')}
                _hover={{ opacity: 0.8 }}
                mb={2}
              >
                <Text color="gray.400" fontSize="sm" fontWeight="bold">Price Change Thresholds</Text>
                <IconButton
                  aria-label={expandedSections.momentumPriceChange ? 'Collapse' : 'Expand'}
                  icon={expandedSections.momentumPriceChange ? <ChevronUpIcon /> : <ChevronDownIcon />}
                  size="xs"
                  variant="ghost"
                  color="gray.400"
                />
              </HStack>
              <Collapse in={expandedSections.momentumPriceChange}>
                <VStack align="stretch" spacing={2} pl={4}>
                  {Object.entries(config.momentumPriceChangeThresholds || {}).map(([key, value]) => (
                    <ConfigInput
                      key={key}
                      label={key}
                      value={editingConfig.momentumPriceChangeThresholds?.[key] !== undefined 
                        ? editingConfig.momentumPriceChangeThresholds[key]
                        : (value ? Number((value * 100).toFixed(2)) : '')}
                      onChange={(e) => {
                        setEditingConfig(prev => ({
                          ...prev,
                          momentumPriceChangeThresholds: {
                            ...(prev.momentumPriceChangeThresholds || {}),
                            [key]: e.target.value
                          }
                        }));
                      }}
                    />
                  ))}
                </VStack>
              </Collapse>
            </Box>

            <ConfigInput
              label="Stagnant Time (s)"
              value={editingConfig.momentumStagnantTime !== undefined ? editingConfig.momentumStagnantTime : (config.momentumStagnantTime ? config.momentumStagnantTime / 1000 : '')}
              onChange={(e) => setEditingConfig(prev => ({ ...prev, momentumStagnantTime: e.target.value }))}
            />
          </VStack>
        </ConfigCard>
      </Grid>
    );
  };

  // Helper function to safely format numbers
  const formatNumber = (value, decimals = 6) => {
    return value ? Number(value).toFixed(decimals) : '0';
  };

  const formatDateTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleLogout = () => {
    // Clear all auth-related items
    Object.values(AUTH_CONFIG.session.keys).forEach(key => {
      localStorage.removeItem(key);
    });
    router.push(AUTH_CONFIG.routes.logout);
  };

  return (
    <>
    <title>MIRAGE64</title>
      <style>{globalStyles}</style>
    <Box bg="gray.900" minH="100vh" position="relative">
      {/* Scan lines overlay */}
      <Box
        position="fixed"
        top={0}
        left={0}
        w="100%"
        h="100%"
        bg="linear-gradient(to bottom, transparent 50%, rgba(0, 255, 157, 0.02) 50%)"
        bgSize="100% 4px"
        pointerEvents="none"
        zIndex={1}
      />
      
      {/* Grid pattern overlay */}
      <Box
        position="fixed"
        top={0}
        left={0}
        w="100%"
        h="100%"
        bgImage="linear-gradient(rgba(0, 255, 157, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 157, 0.1) 1px, transparent 1px)"
        bgSize="20px 20px"
        pointerEvents="none"
        zIndex={1}
      />

      {/* Gradient overlay */}
      <Box
        position="fixed"
        top={0}
        left={0}
        w="100%"
        h="100%"
        bg="linear-gradient(to bottom, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))"
        pointerEvents="none"
      />

      <Container maxW="container.xl" py={8} position="relative" zIndex={2}>
        <VStack spacing={8} align="stretch">
          {/* Header */}
          <Box
            bg="rgba(31, 41, 55, 0.8)"
            p={6}
            borderRadius="lg"
            borderWidth={1}
            borderColor="rgba(0, 255, 157, 0.2)"
            position="relative"
            overflow="hidden"
            _before={{
              content: '""',
              position: 'absolute',
              inset: 0,
              bg: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
              opacity: 0,
              transition: 'opacity 0.3s ease',
            }}
            _hover={{
              _before: {
                opacity: 1,
              },
            }}
          >
            <HStack justify="space-between">
              <Heading
                position="relative"
                color="green.400"
                fontWeight={700}
                letterSpacing="0.05em"
                fontSize="2xl"
                userSelect="none"
                _before={{
                  content: '""',
                  position: 'absolute',
                  top: '-10px',
                  left: '-10px',
                  right: '-10px',
                  bottom: '-10px',
                  background: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
                  filter: 'blur(10px)',
                  zIndex: -1,
                  borderRadius: 'lg',
                  animation: 'borderGlow 2s ease-in-out infinite',
                }}
                _after={{
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '1px',
                  background: 'linear-gradient(90deg, transparent, rgba(0, 255, 157, 0.3), transparent)',
                  animation: 'scanline 2s linear infinite',
                }}
                sx={{
                  animation: 'neonPulse 2s ease-in-out infinite',
                  '&:hover': {
                    animation: 'glitch 0.2s ease-in-out infinite',
                    cursor: 'none',
                  }
                }}
              >
                <Text as="span" color="green.400" sx={{ animation: 'pulse 2s ease-in-out infinite' }}></Text>
                MIRAGE64
                <Text as="span" color="green.400" sx={{ animation: 'pulse 2s ease-in-out infinite' }}></Text>
              </Heading>
              <HStack spacing={4}>
                <HStack spacing={2}>
                  <Text color="gray.400" fontSize="sm">{wsConnected ? 'Connected' : 'Disconnected'}</Text>
                  <Box
                    w={2}
                    h={2}
                    borderRadius="full"
                    bg={wsConnected ? 'green.500' : 'red.500'}
                    mr={2}
                  />
                </HStack>
                <HStack spacing={4} color="gray.400" fontSize="xs">
                  <VStack spacing={0} align="start">
                    <Text color="gray.500" fontSize="2xs">LOCAL</Text>
                    <Text fontFamily="mono">{currentTime ? formatTime(currentTime, Intl.DateTimeFormat().resolvedOptions().timeZone) : '--:--:--'}</Text>
                  </VStack>
                  <VStack spacing={0} align="start">
                    <Text color="gray.500" fontSize="2xs">New York</Text>
                    <Text fontFamily="mono">{currentTime ? formatTime(currentTime, 'America/New_York') : '--:--:--'}</Text>
                  </VStack>
                  <VStack spacing={0} align="start">
                    <Text color="gray.500" fontSize="2xs">London</Text>
                    <Text fontFamily="mono">{currentTime ? formatTime(currentTime, 'Europe/London') : '--:--:--'}</Text>
                  </VStack>
                  <VStack spacing={0} align="start">
                    <Text color="gray.500" fontSize="2xs">Hong Kong</Text>
                    <Text fontFamily="mono">{currentTime ? formatTime(currentTime, 'Asia/Hong_Kong') : '--:--:--'}</Text>
                  </VStack>
                </HStack>
                <HStack spacing={2}>
                  <Button
                    size="sm"
                    bg="rgba(0, 255, 157, 0.1)"
                    color="green.400"
                    borderWidth={1}
                    borderColor="rgba(0, 255, 157, 0.2)"
                    _hover={{
                      bg: 'rgba(0, 255, 157, 0.2)',
                      transform: 'translateY(-1px)',
                      boxShadow: '0 0 20px rgba(0, 255, 157, 0.3)',
                      borderColor: 'rgba(0, 255, 157, 0.4)',
                      _before: {
                        opacity: 1,
                      },
                    }}
                    _active={{
                      bg: 'rgba(0, 255, 157, 0.3)',
                    }}
                    isDisabled={botStatus === 'running'}
                    opacity={botStatus === 'running' ? 0.5 : 1}
                    onClick={() => handleBotControl('start')}
                    position="relative"
                    overflow="hidden"
                    _before={{
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
                      opacity: 0,
                      transition: 'opacity 0.3s ease',
                    }}
                  >
                    ▶
                  </Button>
                  <Button
                    size="sm"
                    bg="rgba(239, 68, 68, 0.1)"
                    color="red.400"
                    borderWidth={1}
                    borderColor="rgba(239, 68, 68, 0.2)"
                    _hover={{
                      bg: 'rgba(239, 68, 68, 0.2)',
                      transform: 'translateY(-1px)',
                      boxShadow: '0 0 20px rgba(239, 68, 68, 0.3)',
                      borderColor: 'rgba(239, 68, 68, 0.4)',
                      _before: {
                        opacity: 1,
                      },
                    }}
                    _active={{
                      bg: 'rgba(239, 68, 68, 0.3)',
                    }}
                    isDisabled={botStatus === 'stopped'}
                    opacity={botStatus === 'stopped' ? 0.5 : 1}
                    onClick={() => handleBotControl('stop')}
                    position="relative"
                    overflow="hidden"
                    _before={{
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'linear-gradient(45deg, rgba(239, 68, 68, 0.1), rgba(157, 78, 221, 0.1))',
                      opacity: 0,
                      transition: 'opacity 0.3s ease',
                    }}
                  >
                    ◼︎
                  </Button>
                  <Button
                    size="sm"
                    bg="rgba(66, 153, 225, 0.1)"
                    color="blue.400"
                    borderWidth={1}
                    borderColor="rgba(66, 153, 225, 0.2)"
                    _hover={{
                      bg: 'rgba(66, 153, 225, 0.2)',
                      transform: 'translateY(-1px)',
                      boxShadow: '0 0 20px rgba(66, 153, 225, 0.3)',
                      borderColor: 'rgba(66, 153, 225, 0.4)',
                      _before: {
                        opacity: 1,
                      },
                    }}
                    _active={{
                      bg: 'rgba(66, 153, 225, 0.3)',
                    }}
                    onClick={() => handleBotControl('restart')}
                    position="relative"
                    overflow="hidden"
                    _before={{
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'linear-gradient(45deg, rgba(66, 153, 225, 0.1), rgba(157, 78, 221, 0.1))',
                      opacity: 0,
                      transition: 'opacity 0.3s ease',
                    }}
                  >
                    ↻
                  </Button>
                  <Button
                    size="sm"
                    bg="rgba(157, 78, 221, 0.1)"
                    color="purple.400"
                    borderWidth={1}
                    borderColor="rgba(157, 78, 221, 0.2)"
                    _hover={{
                      bg: 'rgba(157, 78, 221, 0.2)',
                      transform: 'translateY(-1px)',
                      boxShadow: '0 0 20px rgba(157, 78, 221, 0.3)',
                      borderColor: 'rgba(157, 78, 221, 0.4)',
                      _before: {
                        opacity: 1,
                      },
                    }}
                    _active={{
                      bg: 'rgba(157, 78, 221, 0.3)',
                    }}
                    onClick={handleLogout}
                    position="relative"
                    overflow="hidden"
                    _before={{
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'linear-gradient(45deg, rgba(157, 78, 221, 0.1), rgba(157, 78, 221, 0.1))',
                      opacity: 0,
                      transition: 'opacity 0.3s ease',
                    }}
                  >
                    Logout
                  </Button>
                </HStack>
              </HStack>
            </HStack>
          </Box>

          {/* Stats Overview */}
          <Grid templateColumns="repeat(5, 1fr)" gap={6}>
            {[
              {
                label: 'SOL/USDT',
                value: solPrice ? `$${formatNumber(solPrice, 2)}` : 'Loading...',
                help: 'Current Market Price',
                  color: 'rgba(157, 78, 221, 0.9)'
              },
              {
                label: 'Total Trades',
                value: stats?.trades?.total || 0,
                help: `Win Rate: ${stats?.trades?.wins && stats?.trades?.total ? formatNumber((stats.trades.wins / stats.trades.total) * 100, 2) : '0'}%`,
                  color: 'rgba(0, 255, 157, 0.9)'
              },
              {
                label: 'Total Profit',
                value: `${formatNumber(stats?.trades?.totalPnL || 0, 4)} SOL`,
                help: `Avg Profit: ${stats?.trades?.wins ? formatNumber(stats.trades.totalPnL / stats.trades.wins, 4) : '0'} SOL`,
                  color: 'rgba(0, 255, 157, 0.9)'
              },
              {
                label: 'Trade Performance',
                value: `${stats?.trades?.wins || 0}W / ${stats?.trades?.losses || 0}L`,
                help: `Avg Win: ${stats?.trades?.wins ? formatNumber((stats.trades.totalPnL / stats.trades.wins) * 100, 2) : '0'}% `,
                  color: stats?.trades?.wins > stats?.trades?.losses ? 'rgba(0, 255, 157, 0.9)' : 'rgba(239, 68, 68, 0.9)'
              },
              {
                label: 'Wallet Balance',
                value: `${formatNumber(walletBalance?.balance || 0, 4)} SOL`,
                help: `Available: ${formatNumber(walletBalance?.available || 0, 4)} SOL`,
                  color: 'rgba(157, 78, 221, 0.9)'
              },
            ].map((stat, index) => (
              <Box
                key={index}
                bg="rgba(31, 41, 55, 0.8)"
                p={4}
                borderRadius="lg"
                  borderWidth="0.5px"
                  borderColor={stat.color.replace('0.9', '0.3')}
                position="relative"
                overflow="hidden"
                  height="120px"
                  display="flex"
                  flexDirection="column"
                  justifyContent="center"
                _before={{
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                    bg: 'linear-gradient(45deg, rgba(0, 255, 157, 0.05), rgba(157, 78, 221, 0.05))',
                  opacity: 0,
                  transition: 'opacity 0.3s ease',
                }}
                _hover={{
                  _before: {
                    opacity: 1,
                  },
                    transform: 'translateY(-2px)',
                    boxShadow: `0 0 15px ${stat.color.replace('0.9', '0.3')}`,
                    borderColor: stat.color.replace('0.9', '0.3'),
                }}
              >
                <Stat>
                    <StatLabel 
                      color="gray.300" 
                      textTransform="uppercase" 
                      letterSpacing="0.1em" 
                      fontSize="sm"
                      mb={2}
                    >
                    {stat.label}
                  </StatLabel>
                  <StatNumber
                      color={stat.color}
                      textShadow={`0 0 8px ${stat.color.replace('0.9', '0.3')}`}
                    fontSize="xl"
                    fontWeight="bold"
                      mb={1}
                  >
                    {stat.value}
                  </StatNumber>
                    <StatHelpText 
                      color="gray.300" 
                      fontSize="sm"
                      mt={0}
                    >
                    {stat.help}
                  </StatHelpText>
                </Stat>
              </Box>
            ))}
          </Grid>

          {/* Active Trades and Strategy Config */}
          <Grid templateColumns="repeat(2, 1fr)" gap={6}>
            {/* Active Trades */}
            <Box
              bg="rgba(31, 41, 55, 0.8)"
              p={6}
              borderRadius="lg"
              borderWidth={1}
              borderColor="rgba(0, 255, 157, 0.2)"
              position="relative"
              overflow="hidden"
              _before={{
                content: '""',
                position: 'absolute',
                inset: 0,
                bg: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
                opacity: 0,
                transition: 'opacity 0.3s ease',
                zIndex: 0,
                pointerEvents: 'none'
              }}
              _hover={{
                _before: {
                  opacity: 1,
                },
              }}
            >
              <Heading
                size="md"
                mb={4}
                color="green.400"
                textShadow="0 0 20px rgba(0, 255, 157, 0.3)"
                position="relative"
                zIndex={1}
                _before={{
                  content: '""',
                  position: 'absolute',
                  top: '-10px',
                  left: '-10px',
                  right: '-10px',
                  bottom: '-10px',
                  background: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
                  filter: 'blur(10px)',
                  zIndex: -1,
                  borderRadius: 'lg',
                  opacity: 0,
                  transition: 'opacity 0.3s ease',
                }}
                _hover={{
                  _before: {
                    opacity: 1,
                  },
                  textShadow: '0 0 30px rgba(0, 255, 157, 0.5)',
                }}
              >
                Active Trades ({activeTrades.length})
              </Heading>
              <Grid templateColumns="repeat(3, 1fr)" gap={4} position="relative" zIndex={1}>
                {activeTrades.map((trade) => (
                  <Box
                    key={trade?.tokenId || Math.random()}
                    p={3}
                    borderWidth={1}
                    borderRadius="md"
                    borderColor="rgba(0, 255, 157, 0.2)"
                    bg="rgba(31, 41, 55, 0.8)"
                    transition="all 0.3s ease"
                    _hover={{
                      transform: 'translateY(-2px)',
                      borderColor: 'rgba(0, 255, 157, 0.4)',
                      boxShadow: '0 0 20px rgba(0, 255, 157, 0.1)',
                    }}
                  >
                    <VStack align="start" spacing={1}>
                      <HStack justify="space-between" w="100%">
                        <Text fontWeight="bold" color="white" fontSize="sm">
                          <a href={`https://pump.fun/coin/${trade?.tokenId}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                            {trade?.tokenSymbol || 'Unknown'}
                          </a>
                        </Text>
                        <Text color="gray.400" fontSize="xs">{trade?.timeLeft}s</Text>
                      </HStack>
                      <HStack justify="space-between" w="100%" fontSize="xs">
                        <Text color="gray.300">Entry: ${formatNumber(trade?.entryPrice*1_000_000_000*solPrice, 2)}</Text>
                        <Text color="gray.300">Current: ${formatNumber(trade?.currentPrice*1_000_000_000*solPrice, 2)}</Text>
                      </HStack>
                      <HStack justify="space-between" w="100%" fontSize="xs">
                        <Text
                          color={(trade?.pnl || 0) >= 0 ? 'green.400' : 'red.400'}
                          textShadow={(trade?.pnl || 0) >= 0 ? '0 0 10px rgba(0, 255, 157, 0.3)' : '0 0 10px rgba(239, 68, 68, 0.3)'}
                        >
                          P/L: {formatNumber(trade?.pnl, 2)}%
                        </Text>
                        <Text color="gray.400">Net: {formatNumber(trade?.netPnL, 4)} SOL</Text>
                      </HStack>
                    </VStack>
                  </Box>
                ))}
              </Grid>
            </Box>

            {/* Strategy Configuration */}
            <Box
              bg="rgba(31, 41, 55, 0.8)"
              p={6}
              borderRadius="lg"
              borderWidth={1}
              borderColor="rgba(0, 255, 157, 0.2)"
              position="relative"
              overflow="hidden"
              height="calc(100vh - 400px)"
              _before={{
                content: '""',
                position: 'absolute',
                inset: 0,
                bg: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
                opacity: 0,
                transition: 'opacity 0.3s ease',
                zIndex: 0,
                pointerEvents: 'none'
              }}
              _hover={{
                _before: {
                  opacity: 1,
                },
              }}
            >
              <HStack justify="space-between" mb={4}>
                <Heading
                  size="md"
                  color="green.400"
                  textShadow="0 0 20px rgba(0, 255, 157, 0.3)"
                  position="relative"
                  zIndex={1}
                  _before={{
                    content: '""',
                    position: 'absolute',
                    top: '-10px',
                    left: '-10px',
                    right: '-10px',
                    bottom: '-10px',
                    background: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
                    filter: 'blur(10px)',
                    zIndex: -1,
                    borderRadius: 'lg',
                    opacity: 0,
                    transition: 'opacity 0.3s ease',
                  }}
                  _hover={{
                    _before: {
                      opacity: 1,
                    },
                    textShadow: '0 0 30px rgba(0, 255, 157, 0.5)',
                  }}
                >
                  Strategy Configuration
                </Heading>
                {Object.keys(editingConfig).length > 0 && (
                  <Button
                    size="sm"
                      bg="rgba(0, 255, 157, 0.1)"
                      color="green.400"
                      borderWidth={1}
                      borderColor="rgba(0, 255, 157, 0.2)"
                    _hover={{
                        bg: 'rgba(0, 255, 157, 0.2)',
                      transform: 'translateY(-1px)',
                        boxShadow: '0 0 20px rgba(0, 255, 157, 0.3)',
                        borderColor: 'rgba(0, 255, 157, 0.4)',
                        _before: {
                          opacity: 1,
                        },
                      }}
                      _active={{
                        bg: 'rgba(0, 255, 157, 0.3)',
                      }}
                      onClick={handleConfigSave}
                      position="relative"
                      overflow="hidden"
                      _before={{
                        content: '""',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
                        opacity: 0,
                        transition: 'opacity 0.3s ease',
                    }}
                  >
                    Save Changes
                  </Button>
                )}
              </HStack>
              <Box 
                position="relative" 
                zIndex={1} 
                height="calc(100% - 60px)"
                overflowY="auto"
                sx={{
                  '&::-webkit-scrollbar': {
                    width: '4px',
                  },
                  '&::-webkit-scrollbar-track': {
                    width: '6px',
                    background: 'rgba(31, 41, 55, 0.8)',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    background: 'rgba(0, 255, 157, 0.3)',
                    borderRadius: '24px',
                    '&:hover': {
                      background: 'rgba(0, 255, 157, 0.5)',
                    },
                  },
                }}
              >
                {renderConfigSection()}
              </Box>
            </Box>
          </Grid>

          {/* Recent Trades */}
          <Box
            bg="rgba(31, 41, 55, 0.8)"
            p={6}
            borderRadius="lg"
            borderWidth={1}
            borderColor="rgba(0, 255, 157, 0.2)"
            position="relative"
            overflow="hidden"
            _before={{
              content: '""',
              position: 'absolute',
              inset: 0,
              bg: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
              opacity: 0,
              transition: 'opacity 0.3s ease',
              zIndex: 0,
              pointerEvents: 'none'
            }}
            _hover={{
              _before: {
                opacity: 1,
              },
            }}
          >
            <Heading
              size="md"
              mb={4}
              color="green.400"
              textShadow="0 0 20px rgba(0, 255, 157, 0.3)"
              position="relative"
              zIndex={1}
              _before={{
                content: '""',
                position: 'absolute',
                top: '-10px',
                left: '-10px',
                right: '-10px',
                bottom: '-10px',
                background: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
                filter: 'blur(10px)',
                zIndex: -1,
                borderRadius: 'lg',
                opacity: 0,
                transition: 'opacity 0.3s ease',
              }}
              _hover={{
                _before: {
                  opacity: 1,
                },
                textShadow: '0 0 30px rgba(0, 255, 157, 0.5)',
              }}
            >
              Recent Trades
            </Heading>
            <Box position="relative" zIndex={1} overflowX="auto">
              <Box
                as="table"
                w="100%"
                borderCollapse="separate"
                borderSpacing="0"
                sx={{
                  'th, td': {
                    borderBottom: '1px solid',
                    borderColor: 'rgba(0, 255, 157, 0.2)',
                    p: 2,
                    fontSize: 'sm',
                    whiteSpace: 'nowrap',
                  },
                  'th': {
                    color: 'gray.400',
                    textTransform: 'uppercase',
                    fontSize: 'xs',
                    letterSpacing: '0.1em',
                    fontWeight: 'bold',
                    bg: 'rgba(31, 41, 55, 0.9)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    py: 3,
                  },
                  'tr': {
                    transition: 'all 0.2s ease',
                    _hover: {
                      bg: 'rgba(0, 255, 157, 0.05)',
                    },
                  },
                  'td': {
                    color: 'gray.300',
                    py: 2,
                  },
                }}
              >
                <Box as="thead">
                  <Box as="tr">
                    <Box as="th" w="18%" textAlign="left">Token</Box>
                    <Box as="th" w="11%" textAlign="center">Entry</Box>
                    <Box as="th" w="11%" textAlign="center">Exit</Box>
                    <Box as="th" w="9%" textAlign="center">P/L %</Box>
                    <Box as="th" w="11%" textAlign="center">Net P/L</Box>
                    <Box as="th" w="9%" textAlign="center">Time Held</Box>
                    <Box as="th" w="20%" textAlign="center">Reason</Box>
                    <Box as="th" w="11%" textAlign="center">Date/Time</Box>
                  </Box>
                </Box>
                <Box as="tbody">
                  {trades.slice(0, 10).map((trade, index) => (
                    <Box
                      as="tr"
                      key={trade?.tradeId || index}
                      _hover={{
                        transform: 'translateY(-1px)',
                        boxShadow: '0 0 20px rgba(0, 255, 157, 0.1)',
                      }}
                    >
                      <Box as="td" textAlign="left">
                        <VStack align="start" spacing={0.5}>
                          <a 
                            href={`https://pump.fun/coin/${trade?.tokenId}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            style={{ textDecoration: 'none' }}
                          >
                            <Text 
                              fontWeight="bold" 
                              color="white"
                              _hover={{ color: 'green.400' }}
                            >
                              {trade?.tokenSymbol || 'Unknown'}
                            </Text>
                          </a>
                          <Text fontSize="xs" color="gray.500" fontFamily="mono">
                            {trade?.tokenId ? `${trade.tokenId.slice(0, 4)}...${trade.tokenId.slice(-4)}` : 'N/A'}
                          </Text>
                        </VStack>
                      </Box>
                      <Box as="td" textAlign="center">${formatNumber(trade?.entryPrice*1_000_000_000*solPrice, 2)}</Box>
                      <Box as="td" textAlign="center">${formatNumber(trade?.exitPrice*1_000_000_000*solPrice, 2)}</Box>
                      <Box
                        as="td"
                        textAlign="center"
                        color={(trade?.pnl || 0) >= 0 ? 'green.400' : 'red.400'}
                        textShadow={(trade?.pnl || 0) >= 0 ? '0 0 10px rgba(0, 255, 157, 0.3)' : '0 0 10px rgba(239, 68, 68, 0.3)'}
                        fontWeight="bold"
                      >
                        {formatNumber(trade?.pnl, 2)}%
                      </Box>
                      <Box
                        as="td"
                        textAlign="center"
                        color={(trade?.netPnL || 0) >= 0 ? 'green.400' : 'red.400'}
                        textShadow={(trade?.netPnL || 0) >= 0 ? '0 0 10px rgba(0, 255, 157, 0.3)' : '0 0 10px rgba(239, 68, 68, 0.3)'}
                        fontWeight="bold"
                      >
                        {formatNumber(trade?.netPnL, 4)} SOL
                      </Box>
                      <Box as="td" textAlign="center" color="gray.300">
                        {trade?.timeHeld ? `${trade.timeHeld}s` : 'N/A'}
                      </Box>
                      <Box as="td" textAlign="center" color="gray.500" fontSize="xs">
                        {trade?.reason || 'No reason provided'}
                      </Box>
                       <Box as="td" textAlign="center" color="gray.300" fontSize="xs">
                        {trade?.timestamp ? new Date(trade.timestamp).toLocaleString(undefined, {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'}) : 'N/A'}
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          </Box>

          {/* Profit/Loss Chart */}
          <Box
            bg="rgba(31, 41, 55, 0.8)"
            p={6}
            borderRadius="lg"
            borderWidth={1}
            borderColor="rgba(0, 255, 157, 0.2)"
            position="relative"
            overflow="hidden"
            _before={{
              content: '""',
              position: 'absolute',
              inset: 0,
              bg: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
              opacity: 0,
              transition: 'opacity 0.3s ease',
            }}
            _hover={{
              _before: {
                opacity: 1,
              },
            }}
          >
            <Heading
              size="md"
              mb={4}
              color="green.400"
              textShadow="0 0 20px rgba(0, 255, 157, 0.3)"
              position="relative"
              zIndex={1}
              _before={{
                content: '""',
                position: 'absolute',
                top: '-10px',
                left: '-10px',
                right: '-10px',
                bottom: '-10px',
                background: 'linear-gradient(45deg, rgba(0, 255, 157, 0.1), rgba(157, 78, 221, 0.1))',
                filter: 'blur(10px)',
                zIndex: -1,
                borderRadius: 'lg',
                opacity: 0,
                transition: 'opacity 0.3s ease',
              }}
              _hover={{
                _before: {
                  opacity: 1,
                },
                textShadow: '0 0 30px rgba(0, 255, 157, 0.5)',
              }}
            >
              Profit/Loss Over Time
            </Heading>
            <Box h="300px">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trades}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 255, 157, 0.1)" />
                  <XAxis
                    dataKey="timestamp"
                    stroke="#9CA3AF"
                    tick={{ fill: '#9CA3AF' }}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
                    }}
                  />
                  <YAxis
                    stroke="#9CA3AF"
                    tick={{ fill: '#9CA3AF' }}
                    tickFormatter={(value) => `${value.toFixed(2)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(31, 41, 55, 0.9)',
                      border: '1px solid rgba(0, 255, 157, 0.2)',
                      borderRadius: '0.5rem',
                    }}
                    formatter={(value) => [`${value.toFixed(2)}%`, 'P/L']}
                    labelFormatter={(label) => {
                      const date = new Date(label);
                      return `${date.toLocaleTimeString()}`;
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="pnl"
                    stroke="#00ff9d"
                    strokeWidth={2}
                    dot={{ fill: '#00ff9d', stroke: '#00ff9d' }}
                    isAnimationActive={true}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </Box>
        </VStack>
      </Container>
    </Box>
    </>
  );
};

export default withAuth(Dashboard); 