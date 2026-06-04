import type { PluginStateAssetInput } from "@mimir/agent-core/plugins";
import type { PluginStateDetail, PluginStateSummary } from "../contracts.js";
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type PluginStateInput = {
    markdown: string;
    assets?: PluginStateAssetInput[];
};

export type StoredPluginStateDetail = PluginStateDetail & {
    assets: PluginStateAssetRecord[];
};

export type PluginStateAssetRecord = {
    id: string;
    fileName: string;
    contentType: string;
    storedFileName: string;
};

export type PluginStateAssetFile = {
    absolutePath: string;
    fileName: string;
    contentType: string;
};

type PluginStateManifest = {
    pluginName: string;
    agentName: string;
    updatedAt: string;
    revision: string;
    markdown: string;
    assets: PluginStateAssetRecord[];
};

export class DiskPluginStateStore {
    constructor(private readonly rootDirectory: string) {
    }

    async writeState(pluginName: string, agentName: string, input: PluginStateInput): Promise<PluginStateSummary> {
        const revision = crypto.randomUUID();
        const updatedAt = new Date().toISOString();
        const pluginDirectory = this.pluginDirectory(pluginName);
        const currentDirectory = path.join(pluginDirectory, "current");
        const nextDirectory = path.join(pluginDirectory, `next-${revision}`);
        const assetsDirectory = path.join(nextDirectory, "assets");
        const assetRecords: PluginStateAssetRecord[] = [];

        try {
            await fs.mkdir(assetsDirectory, { recursive: true });

            const seenAssetIds = new Set<string>();
            for (const asset of input.assets ?? []) {
                const assetId = this.validateAssetId(asset.id);
                if (seenAssetIds.has(assetId)) {
                    throw new Error(`Duplicate plugin state asset id "${assetId}".`);
                }
                seenAssetIds.add(assetId);

                const fileName = this.sanitizeFileName(asset.fileName ?? assetId);
                const storedFileName = `${assetId}-${fileName}`;
                const destination = path.join(assetsDirectory, storedFileName);
                if (asset.bytes !== undefined) {
                    await fs.writeFile(destination, Buffer.from(asset.bytes));
                } else {
                    await fs.copyFile(asset.filePath, destination);
                }

                assetRecords.push({
                    id: assetId,
                    fileName,
                    contentType: asset.contentType?.trim() || "application/octet-stream",
                    storedFileName
                });
            }

            const manifest: PluginStateManifest = {
                pluginName,
                agentName,
                updatedAt,
                revision,
                markdown: input.markdown,
                assets: assetRecords
            };
            await fs.writeFile(path.join(nextDirectory, "state.json"), JSON.stringify(manifest), "utf8");

            await fs.rm(currentDirectory, { recursive: true, force: true });
            await fs.rename(nextDirectory, currentDirectory);

            return {
                pluginName,
                agentName,
                updatedAt,
                revision
            };
        } catch (error) {
            await fs.rm(nextDirectory, { recursive: true, force: true }).catch(() => {
                return;
            });
            throw error;
        }
    }

    async listStates(): Promise<PluginStateSummary[]> {
        const pluginDirectories = await fs.readdir(this.rootDirectory, { withFileTypes: true }).catch(() => []);
        const states: PluginStateSummary[] = [];

        for (const directory of pluginDirectories) {
            if (!directory.isDirectory()) {
                continue;
            }

            const manifest = await this.readManifestFromDirectory(path.join(this.rootDirectory, directory.name, "current"));
            if (!manifest) {
                continue;
            }

            states.push({
                pluginName: manifest.pluginName,
                agentName: manifest.agentName,
                updatedAt: manifest.updatedAt,
                revision: manifest.revision
            });
        }

        states.sort((left, right) => left.pluginName.localeCompare(right.pluginName));
        return states;
    }

    async readState(pluginName: string): Promise<StoredPluginStateDetail | null> {
        const currentDirectory = path.join(this.pluginDirectory(pluginName), "current");
        const manifest = await this.readManifestFromDirectory(currentDirectory);
        if (!manifest) {
            return null;
        }

        return {
            pluginName: manifest.pluginName,
            agentName: manifest.agentName,
            updatedAt: manifest.updatedAt,
            revision: manifest.revision,
            markdown: manifest.markdown,
            assets: manifest.assets
        };
    }

    async resolveAsset(pluginName: string, revision: string, assetId: string): Promise<PluginStateAssetFile | null> {
        const currentDirectory = path.join(this.pluginDirectory(pluginName), "current");
        const manifest = await this.readManifestFromDirectory(currentDirectory);
        if (!manifest || manifest.revision !== revision) {
            return null;
        }

        const asset = manifest.assets.find((candidate) => candidate.id === assetId);
        if (!asset) {
            return null;
        }

        const absolutePath = path.join(currentDirectory, "assets", asset.storedFileName);
        return {
            absolutePath,
            fileName: asset.fileName,
            contentType: asset.contentType
        };
    }

    async clear(): Promise<void> {
        await fs.rm(this.rootDirectory, { recursive: true, force: true });
        await fs.mkdir(this.rootDirectory, { recursive: true });
    }

    private async readManifestFromDirectory(directory: string): Promise<PluginStateManifest | null> {
        try {
            const raw = await fs.readFile(path.join(directory, "state.json"), "utf8");
            return JSON.parse(raw) as PluginStateManifest;
        } catch {
            return null;
        }
    }

    private pluginDirectory(pluginName: string): string {
        const digest = crypto.createHash("sha256").update(pluginName).digest("hex");
        return path.join(this.rootDirectory, digest);
    }

    private validateAssetId(assetId: string): string {
        const trimmed = assetId.trim();
        if (!/^[A-Za-z0-9._-]+$/.test(trimmed) || trimmed === "." || trimmed === "..") {
            throw new Error(`Invalid plugin state asset id "${assetId}". Asset ids must be URL-safe.`);
        }
        return trimmed;
    }

    private sanitizeFileName(fileName: string): string {
        const candidate = path.basename(fileName);
        const cleaned = candidate.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
        return cleaned.length > 0 ? cleaned : "asset";
    }
}
