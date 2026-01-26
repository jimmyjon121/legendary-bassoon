/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./src/index.html"
  ],
  theme: {
    extend: {
      colors: {
        // Premium surfaces
        surface: {
          base: '#050507',
          0: '#08080b',
          1: '#0c0c10',
          2: '#111116',
          3: '#16161c',
          4: '#1c1c24',
          5: '#22222c',
        },
        // Glass backgrounds
        glass: {
          1: 'rgba(255, 255, 255, 0.02)',
          2: 'rgba(255, 255, 255, 0.04)',
          3: 'rgba(255, 255, 255, 0.06)',
          4: 'rgba(255, 255, 255, 0.08)',
          5: 'rgba(255, 255, 255, 0.10)',
        },
        // Border colors
        border: {
          subtle: 'rgba(255, 255, 255, 0.04)',
          muted: 'rgba(255, 255, 255, 0.06)',
          DEFAULT: 'rgba(255, 255, 255, 0.08)',
          emphasis: 'rgba(255, 255, 255, 0.12)',
        },
        // Legacy forge colors
        forge: {
          bg: '#050507',
          surface: '#0c0c10',
          elevated: '#111116',
          border: '#1a1a2e',
          hover: '#16162a',
        },
        // Workspace accents
        workspace: {
          casual: '#818cf8',
          work: '#10b981',
          code: '#f59e0b',
          nsfw: '#f472b6',
        },
        // Accents
        accent: {
          primary: '#8b5cf6',
          success: '#10b981',
          warning: '#f59e0b',
          error: '#f43f5e',
          'primary-subtle': 'rgba(139, 92, 246, 0.15)',
          'success-subtle': 'rgba(16, 185, 129, 0.15)',
          'warning-subtle': 'rgba(245, 158, 11, 0.15)',
          'error-subtle': 'rgba(244, 63, 94, 0.15)',
        },
        // Text colors
        text: {
          primary: '#f8f8fc',
          secondary: '#a0a0b8',
          muted: '#606078',
        },
        // Status colors
        status: {
          success: '#10b981',
          warning: '#f59e0b',
          error: '#f43f5e',
          info: '#38bdf8',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
        'xs': ['0.6875rem', { lineHeight: '1rem' }],
        'sm': ['0.8125rem', { lineHeight: '1.25rem' }],
        'base': ['0.875rem', { lineHeight: '1.5rem' }],
        'lg': ['1rem', { lineHeight: '1.75rem' }],
      },
      borderRadius: {
        'sm': '4px',
        'DEFAULT': '6px',
        'md': '6px',
        'lg': '8px',
        'xl': '12px',
        '2xl': '16px',
      },
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
      },
      transitionTimingFunction: {
        'out': 'cubic-bezier(0, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
}
