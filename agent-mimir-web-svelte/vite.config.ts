import { sveltekit } from "@sveltejs/kit/vite";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    plugins: [sveltekit()],
    resolve: {
        alias: {
            "@": path.join(__dirname, "src")
        }
    }
});
