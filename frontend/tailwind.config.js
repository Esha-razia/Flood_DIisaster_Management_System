export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Public Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Fraunces'", "ui-serif", "Georgia", "serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        ink: {
          DEFAULT: "#0B1220",
          soft: "#101826",
        },
        surface: {
          DEFAULT: "#141D2E",
          line: "rgba(232,196,160,0.09)",
        },
        marigold: {
          50: "#FDF3E3", 200: "#F3CE8C", 400: "#EDB35C",
          500: "#E8A33D", 600: "#C97A1D", 700: "#A5601A",
        },
        teal: {
          400: "#3FBDB6", 500: "#2BA6A0", 600: "#1F857F",
        },
        parchment: "#F3EDE1",
        muted: "#93A0B4",
      },
    },
  },
  plugins: [],
}
