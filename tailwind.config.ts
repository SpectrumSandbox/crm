import type { Config } from "tailwindcss";

/**
 * Spectrum Group design tokens — extracted from spectrumgroup.id (:root custom
 * properties, computed styles). Values live as RGB triplets in globals.css so
 * every token supports Tailwind's `/opacity` modifier.
 */
const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem" },
    extend: {
      colors: {
        // shadcn/ui semantic slots, mapped to Spectrum tokens
        background: rgb("--sg-bg"),
        foreground: rgb("--sg-text"),
        border: "var(--sg-line)",
        input: "var(--sg-line-2)",
        ring: rgb("--sg-white"),
        card: { DEFAULT: rgb("--sg-card"), foreground: rgb("--sg-text") },
        popover: { DEFAULT: rgb("--sg-card-2"), foreground: rgb("--sg-text") },
        primary: { DEFAULT: rgb("--sg-white"), foreground: rgb("--sg-bg") },
        secondary: { DEFAULT: rgb("--sg-card-2"), foreground: rgb("--sg-text") },
        muted: { DEFAULT: rgb("--sg-card-2"), foreground: rgb("--sg-muted") },
        accent: { DEFAULT: rgb("--sg-card-3"), foreground: rgb("--sg-white") },
        destructive: { DEFAULT: rgb("--sg-red"), foreground: rgb("--sg-white") },

        // raw Spectrum tokens
        sg: {
          bg: rgb("--sg-bg"),
          card: rgb("--sg-card"),
          "card-2": rgb("--sg-card-2"),
          "card-3": rgb("--sg-card-3"),
          text: rgb("--sg-text"),
          muted: rgb("--sg-muted"),
          dim: rgb("--sg-dim"),
          white: rgb("--sg-white"),
          line: "var(--sg-line)",
          "line-2": "var(--sg-line-2)",
        },
        // the spectrum — saturated (brand bars) and soft (data / status)
        spectrum: {
          magenta: rgb("--sg-magenta"),
          blue: rgb("--sg-blue"),
          cyan: rgb("--sg-cyan"),
          green: rgb("--sg-green"),
          yellow: rgb("--sg-yellow"),
          orange: rgb("--sg-orange"),
          red: rgb("--sg-red"),
        },
        soft: {
          magenta: rgb("--sg-s-magenta"),
          blue: rgb("--sg-s-blue"),
          cyan: rgb("--sg-s-cyan"),
          green: rgb("--sg-s-green"),
          yellow: rgb("--sg-s-yellow"),
          orange: rgb("--sg-s-orange"),
          red: rgb("--sg-s-red"),
        },
      },
      fontFamily: {
        sans: ["Gotham", "var(--font-montserrat)", "Montserrat", "system-ui", "sans-serif"],
        display: ["var(--font-montserrat)", "Montserrat", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["10.5px", { lineHeight: "14px" }],
        xs: ["11.5px", { lineHeight: "16px" }],
        sm: ["12.5px", { lineHeight: "18px" }],
        base: ["13.5px", { lineHeight: "20px" }],
        lg: ["16px", { lineHeight: "22px" }],
        xl: ["19px", { lineHeight: "21px", letterSpacing: "-0.015em" }],
        "2xl": ["24px", { lineHeight: "28px", letterSpacing: "-0.015em" }],
        "3xl": ["36px", { lineHeight: "40px", letterSpacing: "-0.015em" }],
      },
      borderRadius: {
        none: "0",
        sm: "2px",
        DEFAULT: "3px", // site's rectangular CTA ("Our capabilities →")
        md: "6px",
        lg: "8px",
        xl: "12px", // site's cards
        pill: "100px", // site's pill CTA ("Let's collaborate →")
      },
      letterSpacing: {
        cta: "0.04em", // 0.52px @ 13px on the site's buttons
      },
      boxShadow: {
        pop: "0 12px 40px -12px rgb(0 0 0 / 0.65), 0 0 0 1px var(--sg-line)",
        drawer: "-24px 0 60px -20px rgb(0 0 0 / 0.7)",
      },
      transitionTimingFunction: {
        sg: "cubic-bezier(.2,.7,.2,1)",
      },
      keyframes: {
        "slide-in-right": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        "slide-out-right": { from: { transform: "translateX(0)" }, to: { transform: "translateX(100%)" } },
      },
      animation: {
        "slide-in-right": "slide-in-right 260ms cubic-bezier(.2,.7,.2,1)",
        "slide-out-right": "slide-out-right 200ms cubic-bezier(.2,.7,.2,1)",
      },
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  plugins: [require("tailwindcss-animate")],
};

export default config;
