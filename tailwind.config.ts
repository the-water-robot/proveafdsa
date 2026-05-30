import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palette della band: cielo acceso, flamingo, giallo solare, arancio, violetto, lime
        sky: "#29C5EE",
        flamingo: "#FF5F8F",
        solar: "#FFD000",
        tangerine: "#FF7B29",
        violet: "#9B59E8",
        lime: "#7ED93A",
        coral: "#FF4757",
        sand: "#FFFBF2",
        ink: "#0E1420",
        "dark-bg": "#0B1120",
        "dark-card": "#141C2E",
        "dark-border": "#1E2D45",
      },
      fontFamily: {
        display: ['"Space Grotesk"', "ui-sans-serif", "system-ui", "sans-serif"],
        body: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.95)", opacity: "0.7" },
          "70%": { transform: "scale(1.25)", opacity: "0" },
          "100%": { transform: "scale(1.25)", opacity: "0" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.6s cubic-bezier(0.215,0.61,0.355,1) infinite",
        "slide-down": "slide-down 0.25s ease",
      },
    },
  },
  plugins: [],
};

export default config;
