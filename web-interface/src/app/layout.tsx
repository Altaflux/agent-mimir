import type { Metadata } from "next";
import { Manrope, Sora } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const heading = Sora({
    subsets: ["latin"],
    variable: "--font-heading"
});

const body = Manrope({
    subsets: ["latin"],
    variable: "--font-body"
});

export const metadata: Metadata = {
    title: "Agent Mimir Web",
    description: "Web interface for Agent Mimir"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <html lang="en">
            <body className={`${heading.variable} ${body.variable} min-h-screen bg-background font-body text-foreground antialiased`}>
                {children}
            </body>
        </html>
    );
}
