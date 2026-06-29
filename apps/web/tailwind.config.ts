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
        "light-ash": "#f1f5f9", // 明るいニュートラル面 / チップ背景 (slate-100)
        "cloud-gray": "#e2e8f0", // 控えめな境界 / divider (slate-200)
        "mist-light": "#f8fafc", // ごく薄い行 / ホバー面 (slate-50)
        "silver-fog": "#94a3b8", // プレースホルダ (slate-400)

        // Surfaces — light page を slate-50 にティントし、カード/入力は白で浮かせる
        "canvas-dark": "#000000",
        "surface-dark": "#121314",
        "surface-dark-card": "#181818",
        "canvas-light": "#ffffff",
        page: "#f8fafc", // アプリのページ/キャンバス背景ティント (slate-50)
        "surface-soft": "#f1f5f9", // hover 行 / ソフトパネル (slate-100)
        "surface-card": "#f8fafc", // テーブルヘッダ等 (slate-50)

        // Text
        ink: "#000000",
        "body-light": "#334155", // 本文 (slate-700, AA 余裕)
        "mute-light": "#64748b", // 二次テキスト (slate-500, AA)
        "ash-light": "#cbd5e1", // 入力境界 (slate-300)
        "on-dark": "#ffffff",
        "body-dark": "rgba(255,255,255,0.7)",

        // Hairlines
        "hairline-light": "#e2e8f0", // 境界 (slate-200)
        "hairline-dark": "rgba(229,229,229,0.2)",

        // Semantic
        warning: "#c81b3a",
        "link-light": "#0064b7",
        "link-dark": "#53b1ff",

        // Legacy compat (keep so existing classes don't break)
        // NOTE: background/card/popover は白を維持（bg-background は textarea/tabs/sheet/toast
        // 等の白サーフェスで使われるため）。ページティントは body と shell main の bg-page で担保。
        background: "#ffffff",
        foreground: "#000000",
        border: "#e2e8f0",
        ring: "#0070d1",
        destructive: { DEFAULT: "#c81b3a", foreground: "#ffffff" },
        muted: { DEFAULT: "#f1f5f9", foreground: "#64748b" },
        accent: { DEFAULT: "#f1f5f9", foreground: "#000000" },
        secondary: { DEFAULT: "#f1f5f9", foreground: "#000000" },
        card: { DEFAULT: "#ffffff", foreground: "#000000" },
        popover: { DEFAULT: "#ffffff", foreground: "#000000" },
        input: "#cbd5e1",
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
