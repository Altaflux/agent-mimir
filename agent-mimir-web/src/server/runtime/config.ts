import path from "path";
import { promises as fs } from "fs";
import { pathToFileURL } from "url";
import { AgentMimirConfig } from "@/server/runtime/types";

let cachedConfig: Promise<AgentMimirConfig> | null = null;

async function loadConfigModule(cfgFile: string): Promise<any> {
    const moduleUrl = pathToFileURL(cfgFile).href;
    const loaded = await import(/* webpackIgnore: true */ moduleUrl);
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
    return await Promise.resolve(configFunction);
}

export async function getConfig(): Promise<AgentMimirConfig> {
    if (!cachedConfig) {
        cachedConfig = loadConfig();
    }

    return await cachedConfig;
}

export function resetConfigCache() {
    cachedConfig = null;
}
