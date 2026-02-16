import { sveltekit } from "@sveltejs/kit/vite";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.join(__dirname, "..");

const agentMimirAliases = {
    "agent-mimir/agent/tool-agent": path.join(repoRoot, "agent-mimir", "dist", "agent-manager", "tool-agent", "index.js"),
    "agent-mimir/agent/code-agent": path.join(repoRoot, "agent-mimir", "dist", "agent-manager", "code-agent", "index.js"),
    "agent-mimir/agent": path.join(repoRoot, "agent-mimir", "dist", "agent-manager", "index.js"),
    "agent-mimir/communication/multi-agent": path.join(repoRoot, "agent-mimir", "dist", "communication", "multi-agent.js"),
    "agent-mimir/nodejs": path.join(repoRoot, "agent-mimir", "dist", "nodejs", "index.js"),
    "agent-mimir/plugins": path.join(repoRoot, "agent-mimir", "dist", "plugins", "index.js"),
    "agent-mimir/schema": path.join(repoRoot, "agent-mimir", "dist", "schema.js"),
    "agent-mimir/utils/format": path.join(repoRoot, "agent-mimir", "dist", "utils", "format.js")
};

export default defineConfig({
    plugins: [sveltekit()],
    resolve: {
        alias: {
            "@": path.join(__dirname, "src"),
            ...agentMimirAliases
        }
    }
});
