import path from "path";
import { promises as fs } from "fs";
import { pathToFileURL } from "url";
import { createRequire } from "module";
import type { AgentMimirConfig } from "./types.js";

let cachedConfig: Promise<AgentMimirConfig> | null = null;
const nodeRequire = createRequire(import.meta.url);
const DEFAULT_CONFIG_LOAD_TIMEOUT_MS = 60000;

function getConfigLoadTimeoutMs(): number {
    const raw = process.env.MIMIR_CONFIG_LOAD_TIMEOUT_MS;
    if (!raw) {
        return DEFAULT_CONFIG_LOAD_TIMEOUT_MS;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_CONFIG_LOAD_TIMEOUT_MS;
    }

    return parsed;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error(`${operation} timed out after ${timeoutMs}ms.`));
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}

async function loadConfigModule(cfgFile: string): Promise<any> {
    try {
        const loaded = nodeRequire(cfgFile);
        return loaded?.default ?? loaded;
    } catch (error) {
        const moduleError = error as NodeJS.ErrnoException;
        if (moduleError.code !== "ERR_REQUIRE_ESM") {
            throw error;
        }
    }

    const moduleUrl = pathToFileURL(cfgFile).href;
    const loaded = await import(/* @vite-ignore */ moduleUrl);
    return loaded?.default ?? loaded;
}

async function loadConfig(): Promise<AgentMimirConfig> {
    if (!process.env.MIMIR_CFG_PATH) {
        throw new Error("MIMIR_CFG_PATH is not set. A staged mimir-cfg.js is required to start.");
    }

    const cfgFile = path.join(process.env.MIMIR_CFG_PATH, "mimir-cfg.js");
    const configFileExists = await fs
        .access(cfgFile, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);

    if (!configFileExists) {
        throw new Error(`Could not find required configuration file at ${cfgFile}.`);
    }

    const loadedConfigModule = await loadConfigModule(cfgFile);
    const configFunction: Promise<AgentMimirConfig> | AgentMimirConfig =
        typeof loadedConfigModule === "function" ? loadedConfigModule() : loadedConfigModule;
    return await withTimeout(
        Promise.resolve(configFunction),
        getConfigLoadTimeoutMs(),
        "Loading mimir-cfg.js"
    );
}

export async function getConfig(): Promise<AgentMimirConfig> {
    if (!cachedConfig) {
        cachedConfig = loadConfig();
    }

    try {
        return await cachedConfig;
    } catch (error) {
        cachedConfig = null;
        throw error;
    }
}

export function resetConfigCache() {
    cachedConfig = null;
}
