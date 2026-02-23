const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable development indicators (Next.js logo in bottom right)
  devIndicators: false,
  // Monorepo turbopack root - must be absolute
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
}

module.exports = nextConfig
