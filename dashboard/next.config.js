const path = require('path');
const { config } = require('dotenv');

// Load environment variables from parent directory
config({ path: path.resolve(__dirname, '../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  env: {
    // Explicitly load the environment variables we need
    NEXT_PUBLIC_AUTH_ADMIN_USERNAME: process.env.NEXT_PUBLIC_AUTH_ADMIN_USERNAME,
    NEXT_PUBLIC_AUTH_ADMIN_PASSWORD: process.env.NEXT_PUBLIC_AUTH_ADMIN_PASSWORD,
    NEXT_PUBLIC_AUTH_USER_USERNAME: process.env.NEXT_PUBLIC_AUTH_USER_USERNAME,
    NEXT_PUBLIC_AUTH_USER_PASSWORD: process.env.NEXT_PUBLIC_AUTH_USER_PASSWORD,
  },
}

module.exports = nextConfig 