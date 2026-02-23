/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Static export for Cloudflare Pages
  output: 'export',
  // Disable image optimization (not supported in static export)
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig
