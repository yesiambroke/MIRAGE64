import React, { useState } from 'react';
import {
  Box,
  Container,
  VStack,
  Heading,
  Input,
  Button,
  Text,
  useToast,
  InputGroup,
  InputRightElement,
  IconButton,
} from '@chakra-ui/react';
import { ViewIcon, ViewOffIcon } from '@chakra-ui/icons';
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
`;

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));

    if (AUTH_CONFIG.credentials[username] === password) {
      // Store auth state
      localStorage.setItem(AUTH_CONFIG.session.keys.isAuthenticated, 'true');
      localStorage.setItem(AUTH_CONFIG.session.keys.username, username);
      localStorage.setItem(AUTH_CONFIG.session.keys.lastActivity, Date.now().toString());
      
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
          >
            <Text color="green.400" fontWeight="bold">
              Login successful! Redirecting...
            </Text>
          </Box>
        ),
        duration: 2000,
        isClosable: true,
        position: 'top',
      });

      // Redirect to dashboard
      router.push(AUTH_CONFIG.routes.dashboard);
    } else {
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
          >
            <Text color="red.400" fontWeight="bold">
              Invalid credentials
            </Text>
          </Box>
        ),
        duration: 3000,
        isClosable: true,
        position: 'top',
      });
    }

    setIsLoading(false);
  };

  return (
    <>
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

        <Container maxW="400px" py={20} position="relative" zIndex={2}>
          <VStack
            spacing={6}
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
              color="green.400"
              fontWeight={700}
              letterSpacing="0.05em"
              fontSize="2xl"
              userSelect="none"
              textAlign="center"
              sx={{
                animation: 'neonPulse 2s ease-in-out infinite',
                '&:hover': {
                  animation: 'glitch 0.2s ease-in-out infinite',
                  cursor: 'none',
                }
              }}
            >
              MIRAGE64
            </Heading>

            <Text color="gray.400" textAlign="center" fontSize="xs">
            veľká čierna mačka je skutočná
            </Text>

            <form onSubmit={handleLogin} style={{ width: '100%' }}>
              <VStack spacing={3} width="100%">
                <Input
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  bg="rgba(31, 41, 55, 0.9)"
                  borderColor="rgba(0, 255, 157, 0.2)"
                  color="white"
                  size="sm"
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

                <InputGroup size="sm">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    bg="rgba(31, 41, 55, 0.9)"
                    borderColor="rgba(0, 255, 157, 0.2)"
                    color="white"
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
                  <InputRightElement>
                    <IconButton
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                      variant="ghost"
                      color="gray.400"
                      size="sm"
                      onClick={() => setShowPassword(!showPassword)}
                      _hover={{
                        color: "green.400",
                      }}
                    />
                  </InputRightElement>
                </InputGroup>

                <Button
                  type="submit"
                  width="100%"
                  bg="rgba(0, 255, 157, 0.1)"
                  color="green.400"
                  borderWidth={1}
                  borderColor="rgba(0, 255, 157, 0.2)"
                  isLoading={isLoading}
                  size="sm"
                  _hover={{
                    bg: 'rgba(0, 255, 157, 0.2)',
                    transform: 'translateY(-1px)',
                    boxShadow: '0 0 20px rgba(0, 255, 157, 0.3)',
                    borderColor: 'rgba(0, 255, 157, 0.4)',
                  }}
                  _active={{
                    bg: 'rgba(0, 255, 157, 0.3)',
                  }}
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
                  Login
                </Button>
              </VStack>
            </form>
          </VStack>
        </Container>
      </Box>
    </>
  );
};

export default Login; 