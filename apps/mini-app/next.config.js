/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable development indicators (Next.js logo in bottom right)
  devIndicators: false,
  // Monorepo turbopack root
  turbopack: {
    root: '..',
  },
}

module.exports = nextConfig
