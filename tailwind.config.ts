import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta Colégio Leibniz — azul royal do logo (átomo), com navy
        // para texto (700) e tons claros para superfícies (50/100).
        brand: {
          DEFAULT: '#1e3372',
          50: '#f4f6fb',
          100: '#e6ebf7',
          200: '#c7d3ee',
          300: '#97acdd',
          400: '#5f7cc4',
          500: '#3558ab',
          600: '#274392',
          700: '#1e3372',
          800: '#15234e',
          900: '#0c1530',
        },
        canvas: '#f4f6fb',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
