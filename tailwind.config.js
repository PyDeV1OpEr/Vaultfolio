/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#05060a', // OLED-black app background
          900: '#0b0f16', // primary card surface
          875: '#0d1218', // between 900 and 850
          850: '#0e131c', // raised card / modal footer
          800: '#121926', // inputs, raised surface
          750: '#162030', // hover on inputs
          700: '#1a2232', // borders / dividers
          650: '#1f2a3e', // hover borders
          600: '#232d40', // strong borders
          550: '#2a3650', // subtle accent fill
          500: '#31405a', // mid-tone text
        },
        txt: {
          DEFAULT: '#f2f5fa',   // primary text
          muted: '#8b95a8',     // secondary text
          dim: '#5d6779',       // tertiary text / placeholders
          faint: '#3d4858',     // disabled text
        },
        accent: {
          DEFAULT: '#4d8dff',
          hover: '#6ba3ff',
          soft: 'rgba(77,141,255,0.12)',
          border: 'rgba(77,141,255,0.28)',
          glow: 'rgba(77,141,255,0.08)',
        },
        positive: {
          DEFAULT: '#34d399',
          soft: 'rgba(52,211,153,0.10)',
          border: 'rgba(52,211,153,0.25)',
        },
        negative: {
          DEFAULT: '#fb7185',
          soft: 'rgba(251,113,133,0.10)',
          border: 'rgba(251,113,133,0.25)',
        },
        warning: {
          DEFAULT: '#fbbf24',
          soft: 'rgba(251,191,36,0.10)',
          border: 'rgba(251,191,36,0.25)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }], // 10px
        xs: ['0.6875rem', { lineHeight: '1rem' }],        // 11px
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],     // 13px
        base: ['0.9375rem', { lineHeight: '1.5rem' }],    // 15px
        lg: ['1.0625rem', { lineHeight: '1.625rem' }],    // 17px
        xl: ['1.25rem', { lineHeight: '1.75rem' }],       // 20px
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
      },
      borderRadius: {
        sm: '0.375rem',   // 6px
        DEFAULT: '0.5rem', // 8px
        md: '0.625rem',   // 10px
        lg: '0.75rem',    // 12px
        xl: '1rem',       // 16px
        '2xl': '1.25rem', // 20px
        '3xl': '1.5rem',  // 24px
      },
      boxShadow: {
        // Elevation system
        'elev-0': 'none',
        'elev-1': '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
        'elev-2': '0 4px 12px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.3)',
        'elev-3': '0 8px 24px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.35)',
        'elev-4': '0 16px 40px rgba(0,0,0,0.7), 0 8px 16px rgba(0,0,0,0.4)',
        // Accent glows
        'accent-sm': '0 0 0 1px rgba(77,141,255,0.2), 0 0 12px rgba(77,141,255,0.08)',
        'accent-md': '0 0 0 1px rgba(77,141,255,0.3), 0 0 20px rgba(77,141,255,0.12)',
        // Inner shadow for inset depth
        'inner-sm': 'inset 0 1px 3px rgba(0,0,0,0.3)',
        'inner-md': 'inset 0 2px 6px rgba(0,0,0,0.4)',
        // Button gloss
        'btn-primary': '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 8px rgba(77,141,255,0.25)',
        'btn-primary-hover': '0 1px 0 rgba(255,255,255,0.12) inset, 0 4px 12px rgba(77,141,255,0.35)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeDown: {
          '0%': { opacity: '0', transform: 'translateY(-6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        spin: {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.15s ease-out both',
        fadeUp: 'fadeUp 0.22s ease-out both',
        fadeDown: 'fadeDown 0.18s ease-out both',
        scaleIn: 'scaleIn 0.15s ease-out both',
        slideInLeft: 'slideInLeft 0.2s ease-out both',
        shimmer: 'shimmer 1.8s linear infinite',
        pulse: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
        spin: 'spin 1s linear infinite',
        // Staggered delays for lists
        'fadeUp-1': 'fadeUp 0.22s 0.05s ease-out both',
        'fadeUp-2': 'fadeUp 0.22s 0.10s ease-out both',
        'fadeUp-3': 'fadeUp 0.22s 0.15s ease-out both',
        'fadeUp-4': 'fadeUp 0.22s 0.20s ease-out both',
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'swift': 'cubic-bezier(0.55, 0, 0.1, 1)',
      },
      transitionDuration: {
        '80': '80ms',
        '120': '120ms',
        '180': '180ms',
        '250': '250ms',
        '350': '350ms',
      },
      spacing: {
        '0.5': '2px',
        '1': '4px',
        '1.5': '6px',
        '2': '8px',
        '2.5': '10px',
        '3': '12px',
        '3.5': '14px',
        '4': '16px',
        '4.5': '18px',
        '5': '20px',
        '6': '24px',
        '7': '28px',
        '8': '32px',
        '9': '36px',
        '10': '40px',
        '11': '44px',
        '12': '48px',
        '14': '56px',
        '16': '64px',
        '18': '72px',
        '20': '80px',
        '24': '96px',
        '28': '112px',
        '32': '128px',
        '36': '144px',
        '40': '160px',
        '44': '176px',
        '48': '192px',
        '52': '208px',
        '56': '224px',
        '60': '240px',
        '64': '256px',
        '72': '288px',
        '80': '320px',
        '96': '384px',
      },
    },
  },
  plugins: [],
};
