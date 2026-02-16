import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const config = {
    preprocess: vitePreprocess(),
    kit: {
        adapter: adapter(),
        csrf: {
            checkOrigin: false
        },
        alias: {
            "@": "./src"
        }
    }
};

export default config;
