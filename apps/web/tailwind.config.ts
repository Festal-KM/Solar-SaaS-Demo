import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // Brand — 青系（PlayStation 系）。単一アクセントのブランドブルー。
        primary: { DEFAULT: "#0070d1", foreground: "#ffffff", pressed: "#0064b7", active: "#004d8d" },
        commerce: { DEFAULT: "#d53b00", foreground: "#ffffff", pressed: "#aa2f00" },

        // Named palette — コンポーネントが参照する名前付きトークン。
        "electric-blue": "#0070d1", // アクセント = ブランドブルー
        "carbon-dark": "#1a1a1a", // 見出し / 強調テキスト（off-black）
        graphite: "#3f3f46", // 本文上の濃いニュートラル（バッジ/ラベル）
        pewter: "#6b6b6b", // ミュート二次テキスト
        "light-ash": "#f3f3f3", // 明るいニュートラル面 / チップ背景
        "cloud-gray": "#e2e2e2", // 控えめな境界 / divider
        "mist-light": "#f7f8fa", // ごく薄い行 / ホバー面
        "silver-fog": "#9ca3af", // プレースホルダ

        // Surfaces
        "canvas-dark": "#000000",
        "surface-dark": "#121314",
        "surface-dark-card": "#181818",
        "canvas-light": "#ffffff",
        "surface-soft": "#f3f3f3",
        "surface-card": "#f5f7fa",

        // Text
        ink: "#000000",
        "body-light": "rgba(0,0,0,0.6)",
        "mute-light": "#6b6b6b",
        "ash-light": "#cccccc",
        "on-dark": "#ffffff",
        "body-dark": "rgba(255,255,255,0.7)",

        // Hairlines
        "hairline-light": "#f3f3f3",
        "hairline-dark": "rgba(229,229,229,0.2)",

        // Semantic
        warning: "#c81b3a",
        "link-light": "#0064b7",
        "link-dark": "#53b1ff",

        // Legacy compat (keep so existing classes don't break)
        background: "#ffffff",
        foreground: "#000000",
        border: "#f3f3f3",
        ring: "#0070d1",
        destructive: { DEFAULT: "#c81b3a", foreground: "#ffffff" },
        muted: { DEFAULT: "#f5f7fa", foreground: "#6b6b6b" },
        accent: { DEFAULT: "#f5f7fa", foreground: "#000000" },
        secondary: { DEFAULT: "#f3f3f3", foreground: "#000000" },
        card: { DEFAULT: "#ffffff", foreground: "#000000" },
        popover: { DEFAULT: "#ffffff", foreground: "#000000" },
        input: "#f3f3f3",
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "16px",
        full: "9999px",
        DEFAULT: "8px",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      transitionDuration: {
        DEFAULT: "330ms",
      },
    },
  },
  plugins: [animate],
};

export default config;
