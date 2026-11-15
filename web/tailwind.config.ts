import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "var(--font-thai)", "Segoe UI", "Tahoma", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Consolas", "monospace"],
      },
      colors: {
        ink: "#0a0c0f",
        panel: "#111418",
        raised: "#161a1f",
        line: "#232830",
        accent: "#f5a524",
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1.1rem" }],
        sm: ["0.875rem", { lineHeight: "1.35rem" }],
        base: ["0.9375rem", { lineHeight: "1.5rem" }],
      },
    },
  },
  plugins: [],
} satisfies Config;
