/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // AutoProtect Master brand theme (navy primary) — matches repairer_network
        brand: {
          50: "#F0F2F5",
          100: "#DDE0E7",
          200: "#BBC1D0",
          300: "#929CB3",
          400: "#5A698C",
          500: "#31446F",
          600: "#0D2356",
          700: "#0B1D47",
          800: "#081738",
          900: "#06122B",
        },
        // Brand highlight/accent colours
        highlight: "#CF043C",
        periwinkle: "#5E68CC",
        // RAG status colours
        rag: {
          green: "#1E8E3E",
          amber: "#B8860B",
          red: "#C5221F",
          none: "#6B7280",
        },
      },
      fontFamily: {
        sans: ["Lato", "Segoe UI", "DejaVu Sans", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
