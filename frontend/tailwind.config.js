/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"BIZ UDPGothic"', '"Hiragino Kaku Gothic ProN"', '"Yu Gothic"', 'Meiryo', 'sans-serif'],
        exam: ['"Shippori Mincho"', '"Yu Mincho"', '"Hiragino Mincho ProN"', 'serif'],
      },
    },
  },
  plugins: [],
};
