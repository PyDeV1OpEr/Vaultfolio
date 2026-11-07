/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#08090B', // Near-black main app background (Quantix reference)
          900: '#0D0E13', // Deep charcoal with dark-purple undertone (sidebar & rails)
          875: '#101116', // Primary cards & panels base
          850: '#14151E', // Raised card surface / dropdowns / popovers
          800: '#191B26', // Component surface, inputs, secondary buttons
          750: '#202230', // Hover surface on cards & inputs
          700: '#24252C', // Subtle hairline borders & separators
          650: '#2F3244', // Active/hover borders
          600: '#3D4158', // Strong borders / outlines
          550: '#4D526E', // Tertiary borders
          500: '#646A88', // Mid-tone muted
        },
        txt: {
          DEFAULT: '#F2F2F5',   // Soft white primary typography
          muted: '#85899B',     // Muted blue-grey secondary typography
          dim: '#5D6073',       // Tertiary typography / meta / captions
          faint: '#3E4152',     // Disabled / faint borders
        },
        accent: {
          DEFAULT: '#A99BFF',   // Elegant lavender/purple accent
          hover: '#BFB4FF',
          muted: '#7047EB',
          deep: '#5B35D5',
          soft: 'rgba(169, 155, 255, 0.12)',
          border: 'rgba(169, 155, 255, 0.28)',
          glow: 'rgba(169, 155, 255, 0.20)',
        },
        positive: {
          DEFAULT: '#10B981',   // Restrained green
          soft: 'rgba(16, 185, 129, 0.12)',
          border: 'rgba(16, 185, 129, 0.28)',
        },
        negative: {
          DEFAULT: '#EF4444',   // Restrained red
          soft: 'rgba(239, 68, 68, 0.12)',
          border: 'rgba(239, 68, 68, 0.28)',
        },
        warning: {
          DEFAULT: '#F59E0B',
          soft: 'rgba(245, 158, 11, 0.12)',
          border: 'rgba(245, 158, 11, 0.28)',
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
        xl: '0.875rem',   // 14px
        '2xl': '1.125rem', // 18px (Quantix reference card radius)
        '3xl': '1.375rem', // 22px
      },
      boxShadow: {
        // Refined depth with subtle purple/charcoal undertones
        'elev-0': 'none',
        'elev-1': '0 1px 2px rgba(0,0,0,0.6)',
        'elev-2': '0 4px 16px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.03)',
        'elev-3': '0 8px 30px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
        'elev-4': '0 16px 48px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06)',
        // Ambient purple & lavender highlights (Quantix style)
        'card-purple': '0 8px 32px -4px rgba(112,71,235,0.18), inset 0 1px 0 rgba(169,155,255,0.18)',
        'glow-lavender': '0 0 20px -2px rgba(169,155,255,0.22)',
        'glow-pill': '0 0 12px rgba(169,155,255,0.25)',
        // Button gloss / highlights
        'btn-primary': '0 2px 12px rgba(112,71,235,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
        'btn-primary-hover': '0 4px 20px rgba(112,71,235,0.50), inset 0 1px 0 rgba(255,255,255,0.35)',
        'btn-secondary': '0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
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
        'default': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'spring': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'smooth': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'swift': 'cubic-bezier(0.22, 1, 0.36, 1)',
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
