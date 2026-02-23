import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        yellow: '#F3FF97',
        black: '#030206',
        white: '#FFFFFC',
        lilac: '#D5A5E3',
        purple: '#875CFF',
        taupe: '#A89F91',
      },
      fontFamily: {
        sans: ['Space Grotesk', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config
