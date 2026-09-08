/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          950: '#0a0b0f',
          900: '#111218',
          850: '#161822',
          800: '#1c1f2b',
          700: '#262a3a',
          600: '#34384c',
        },
        accent: {
          DEFAULT: '#8b5cf6',
          soft: '#a78bfa',
          dim: '#6d28d9',
        },
        ink: {
          DEFAULT: '#e8e6f0',
          muted: '#9b97ad',
          faint: '#6b6780',
        },
      },
      fontFamily: {
        sans: [
          '"Noto Sans SC"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
