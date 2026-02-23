/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable development indicators (Next.js logo in bottom right)
  devIndicators: false,
  // Required for Cloudflare Pages
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}

module.exports = nextConfig
