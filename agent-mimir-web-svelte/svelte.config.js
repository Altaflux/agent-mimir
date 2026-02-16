import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const config = {
    preprocess: vitePreprocess(),
    kit: {
        adapter: adapter(),
        csrf: {
            trustedOrigins: [
                'http://localhost:5173',
                'http://localhost:3000'
            ]
        },
        alias: {
            "@": "./src"
        }
    }
};

export default config;
