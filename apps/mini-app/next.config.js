const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Monorepo - required for Cloudflare Pages
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
}

module.exports = nextConfig
