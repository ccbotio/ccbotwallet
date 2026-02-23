const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable development indicators (Next.js logo in bottom right)
  devIndicators: false,
  // Monorepo settings - both must match
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
}

module.exports = nextConfig
