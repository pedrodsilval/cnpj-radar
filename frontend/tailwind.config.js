/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#2563eb',
        depth:   '#0D1B3E',
        accent:  '#D4AF37',
        danger:  '#D94F2B',
        surface: '#FFFFFF',
      },
      fontFamily: {
        display: ['Satoshi', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
