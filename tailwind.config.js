/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        rc: {
          bg: 'var(--rc-bg)',
          card: 'var(--rc-card)',
          card2: 'var(--rc-card2)',
          line: 'var(--rc-line)',
          ink: 'var(--rc-ink)',
          ink2: 'var(--rc-ink2)',
          ink3: 'var(--rc-ink3)',
          accent: 'var(--rc-accent)',
          accentInk: 'var(--rc-accent-ink)',
          onAccent: 'var(--rc-on-accent)',
          onRed: 'var(--rc-on-red)',
          accentSoft: 'var(--rc-accent-soft)',
          green: 'var(--rc-green)',
          greenSoft: 'var(--rc-green-soft)',
          red: 'var(--rc-red)',
          redSoft: 'var(--rc-red-soft)',
          amber: 'var(--rc-amber)',
          amberSoft: 'var(--rc-amber-soft)',
          pink: 'var(--rc-pink)',
          pinkInk: 'var(--rc-pink-ink)',
        },
        purple: {
          light: '#e9d5ff',
          lighter: '#f3e8ff',
        },
      },
      animation: {
        'bounce-soft': 'bounce-soft 2s ease-in-out infinite',
      },
      keyframes: {
        'bounce-soft': {
          '0%, 100%': {
            transform: 'translateY(0)',
          },
          '50%': {
            transform: 'translateY(-4px)',
          },
        },
      },
    },
  },
  plugins: [],
}

