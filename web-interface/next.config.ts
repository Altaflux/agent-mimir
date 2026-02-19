import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
    eslint: {
        ignoreDuringBuilds: true
    },
    outputFileTracingRoot: repoRoot
};

export default nextConfig;
