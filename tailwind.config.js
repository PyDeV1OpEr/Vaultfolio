/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#05060a', // OLED-black app background
          900: '#0b0f16', // card surface
          850: '#0e131c',
          800: '#121926', // raised surface / inputs
          700: '#1a2232', // borders
          600: '#232d40',
          500: '#31405a',
        },
        txt: {
          DEFAULT: '#f2f5fa',
          muted: '#8b95a8',
          dim: '#5d6779',
        },
        accent: {
          DEFAULT: '#4d8dff',
          soft: 'rgba(77,141,255,0.12)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        fadeUp: 'fadeUp 0.25s ease-out both',
      },
    },
  },
  plugins: [],
};
