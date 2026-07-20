import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        mint: {
          50: "#f1fdf9",
          100: "#dcfaf0",
          200: "#b8f3e2",
          300: "#8ce8d0",
          400: "#5cd9bb",
          500: "#33c6a3",
          600: "#22a189",
          700: "#1c8070",
          800: "#1a655a",
          900: "#17534b",
        },
        aqua: {
          50: "#f0fbfe",
          100: "#dcf5fb",
          200: "#b9eaf7",
          300: "#87d9ee",
          400: "#4fc0dd",
          500: "#2ba3c4",
          600: "#2183a2",
          700: "#1f6883",
          800: "#20566c",
          900: "#1e485c",
        },
      },
      boxShadow: {
        glow: "0 0 24px rgba(92, 217, 187, 0.35)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
