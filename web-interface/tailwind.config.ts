import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
    darkMode: ["class"],
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/**/*.{js,ts,jsx,tsx,mdx}"
    ],
    theme: {
        extend: {
            colors: {
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                card: "hsl(var(--card))",
                "card-foreground": "hsl(var(--card-foreground))",
                popover: "hsl(var(--popover))",
                "popover-foreground": "hsl(var(--popover-foreground))",
                primary: "hsl(var(--primary))",
                "primary-foreground": "hsl(var(--primary-foreground))",
                secondary: "hsl(var(--secondary))",
                "secondary-foreground": "hsl(var(--secondary-foreground))",
                muted: "hsl(var(--muted))",
                "muted-foreground": "hsl(var(--muted-foreground))",
                accent: "hsl(var(--accent))",
                "accent-foreground": "hsl(var(--accent-foreground))",
                destructive: "hsl(var(--destructive))",
                "destructive-foreground": "hsl(var(--destructive-foreground))",
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                sidebar: "hsl(var(--sidebar))",
                "user-bubble": "hsl(var(--user-bubble))"
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)"
            },
            animation: {
                "msg-in": "msg-in 300ms ease-out",
                "dot-bounce": "dot-bounce 1.4s infinite ease-in-out both",
                "pulse-glow": "pulse-glow 2s ease-in-out infinite",
                shimmer: "shimmer 1.5s ease-in-out infinite",
                spin: "spin 0.7s linear infinite"
            },
            keyframes: {
                "msg-in": {
                    from: { opacity: "0", transform: "translateY(8px)" },
                    to: { opacity: "1", transform: "translateY(0)" }
                },
                "dot-bounce": {
                    "0%, 80%, 100%": { transform: "scale(0.6)", opacity: "0.4" },
                    "40%": { transform: "scale(1)", opacity: "1" }
                },
                "pulse-glow": {
                    "0%, 100%": { opacity: "0.5" },
                    "50%": { opacity: "1" }
                },
                shimmer: {
                    "0%": { backgroundPosition: "-200% 0" },
                    "100%": { backgroundPosition: "200% 0" }
                }
            }
        }
    },
    plugins: [typography]
};

export default config;
