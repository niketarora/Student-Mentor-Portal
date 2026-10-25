/**
 * Tailwind theme for SSMP.
 *
 * Retuned to the SSMP Nexus design: warm off-white canvas, WHITE sidebar
 * with a solid-orange active pill, white cards with soft peach section
 * headers, and generous rounding.
 *
 * The token NAMES are unchanged from the previous theme on purpose — every
 * screen keeps working, only the values move.
 */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ── Shell ─────────────────────────────────────────────────────
        sidebar: {
          DEFAULT: '#ffffff',       // the rail itself is white now
          hover: '#fdf1ea',         // soft peach hover
          active: '#c2410c',        // solid orange pill for the current page
          border: '#f2e4dc',
          text: '#57534e',          // stone-600 for inactive items
          muted: '#a8a29e'
        },
        topbar: {
          DEFAULT: '#ffffff',
          border: '#f2e4dc'
        },

        // ── Brand ─────────────────────────────────────────────────────
        primary: '#c2410c',
        'primary-container': '#ea580c',
        'on-primary': '#ffffff',
        'on-primary-container': '#ffffff',
        'primary-fixed': '#fdece3',        // peach panel headers + icon chips
        'primary-fixed-dim': '#fbd9c8',
        'on-primary-fixed': '#9a3412',
        'on-primary-fixed-variant': '#b4470e',
        secondary: '#ea580c',
        'secondary-container': '#fb923c',
        'on-secondary': '#ffffff',
        'on-secondary-container': '#9a3412',
        tertiary: '#a8a29e',
        'tertiary-container': '#d6d3d1',
        'on-tertiary': '#ffffff',

        // ── Status ────────────────────────────────────────────────────
        error: '#dc2626',
        'error-container': '#fee2e2',
        'on-error': '#ffffff',
        'on-error-container': '#991b1b',
        success: '#16a34a',
        'success-container': '#dcfce7',
        'on-success-container': '#166534',
        warning: '#d97706',
        'warning-container': '#fef3c7',
        'on-warning-container': '#92400e',
        info: '#2563eb',
        'info-container': '#dbeafe',
        'on-info-container': '#1e40af',

        // ── Surfaces ──────────────────────────────────────────────────
        background: '#fdfaf8',                 // warm canvas
        surface: '#ffffff',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#fdf7f4',
        'surface-container': '#faf1ec',
        'surface-container-high': '#f5e9e2',
        'surface-container-highest': '#efdfd6',
        'surface-variant': '#f5e9e2',
        'on-surface': '#1c1917',
        'on-surface-variant': '#57534e',
        'inverse-surface': '#292524',
        'inverse-on-surface': '#fafaf9',
        outline: '#a8a29e',
        'outline-variant': '#e7ddd6'
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        md: '0.625rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.25rem'
      },
      spacing: {
        base: '4px',
        xs: '8px',
        sm: '16px',
        md: '24px',
        lg: '32px',
        xl: '48px',
        gutter: '20px',
        sidebar: '264px'
      },
      fontFamily: {
        headline: ['Manrope', 'system-ui', 'sans-serif'],
        body: ['"Hanken Grotesk"', 'system-ui', 'sans-serif']
      },
      fontSize: {
        'display-lg': ['44px', { lineHeight: '52px', letterSpacing: '-0.02em', fontWeight: '800' }],
        'headline-lg': ['32px', { lineHeight: '40px', fontWeight: '700' }],
        'headline-md': ['26px', { lineHeight: '34px', fontWeight: '700' }],
        'headline-sm': ['19px', { lineHeight: '27px', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px' }],
        'body-md': ['16px', { lineHeight: '24px' }],
        'body-sm': ['14px', { lineHeight: '21px' }],
        'label-md': ['14px', { lineHeight: '20px', fontWeight: '600' }],
        'label-sm': ['12px', { lineHeight: '16px', fontWeight: '500' }]
      },
      boxShadow: {
        card: '0 1px 3px rgba(28, 25, 23, 0.05)',
        raised: '0 6px 18px rgba(194, 65, 12, 0.10)',
        dropdown: '0 12px 32px rgba(28, 25, 23, 0.14)'
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96) translateY(6px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' }
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' }
        },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } }
      },
      animation: {
        'fade-in': 'fade-in 0.22s ease-out both',
        'scale-in': 'scale-in 0.18s ease-out both',
        'slide-in-right': 'slide-in-right 0.22s ease-out both',
        shimmer: 'shimmer 1.6s linear infinite'
      }
    }
  },
  plugins: [require('@tailwindcss/forms')]
};
