// Authentication configuration
export const AUTH_CONFIG = {
  // Valid credentials (in a real app, this would be in a secure backend)
  credentials: {
    [process.env.NEXT_PUBLIC_AUTH_ADMIN_USERNAME || 'admin']: process.env.NEXT_PUBLIC_AUTH_ADMIN_PASSWORD || 'mirage64',
    [process.env.NEXT_PUBLIC_AUTH_USER_USERNAME || 'user']: process.env.NEXT_PUBLIC_AUTH_USER_PASSWORD || 'mirage64user',
  },
  
  // Session configuration
  session: {
    // Session timeout in milliseconds (30 minutes)
    timeout: 30 * 60 * 1000,
    
    // Storage keys
    keys: {
      isAuthenticated: 'mirage64_auth',
      username: 'mirage64_username',
      lastActivity: 'mirage64_last_activity'
    }
  },
  
  // Routes
  routes: {
    login: '/login',
    dashboard: '/',
    logout: '/login'
  }
};

// Validate environment variables
const validateEnvVars = () => {
  const requiredVars = [
    'NEXT_PUBLIC_AUTH_ADMIN_USERNAME',
    'NEXT_PUBLIC_AUTH_ADMIN_PASSWORD',
    'NEXT_PUBLIC_AUTH_USER_USERNAME',
    'NEXT_PUBLIC_AUTH_USER_PASSWORD',
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.warn('Warning: Missing environment variables for authentication:', missingVars);
    console.warn('Using default credentials. This is not recommended for production.');
  }
};

// Run validation
validateEnvVars(); 