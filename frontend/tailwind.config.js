/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: '#b8336a', dark: '#7d1f47', light: '#f7e3ec' } },
    },
  },
  plugins: [],
};
