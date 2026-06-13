import type {
  PluginRuntimeBindingIdentity,
  PluginStateAssetInput,
} from "@mimir/agent-core/plugins";
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
  pluginInstanceId: string;
  pluginId: string;
  pluginPrefix?: string;
  pluginNamespace: string;
  agentName: string;
  updatedAt: string;
  revision: string;
  markdown: string;
  assets: PluginStateAssetRecord[];
};

export class DiskPluginStateStore {
  constructor(private readonly rootDirectory: string) {}

  async writeState(
    pluginInstanceId: string,
    identity: PluginRuntimeBindingIdentity,
    agentName: string,
    input: PluginStateInput,
  ): Promise<PluginStateSummary> {
    const revision = crypto.randomUUID();
    const updatedAt = new Date().toISOString();
    const pluginDirectory = this.pluginDirectory(pluginInstanceId);
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
          storedFileName,
        });
      }

      const manifest: PluginStateManifest = {
        pluginInstanceId,
        pluginId: identity.pluginId,
        pluginPrefix: identity.pluginPrefix,
        pluginNamespace: identity.pluginNamespace,
        agentName,
        updatedAt,
        revision,
        markdown: input.markdown,
        assets: assetRecords,
      };
      await fs.writeFile(
        path.join(nextDirectory, "state.json"),
        JSON.stringify(manifest),
        "utf8",
      );

      await fs.rm(currentDirectory, { recursive: true, force: true });
      await fs.rename(nextDirectory, currentDirectory);

      return {
        pluginInstanceId,
        pluginId: identity.pluginId,
        pluginPrefix: identity.pluginPrefix,
        pluginNamespace: identity.pluginNamespace,
        agentName,
        updatedAt,
        revision,
      };
    } catch (error) {
      await fs.rm(nextDirectory, { recursive: true, force: true }).catch(() => {
        return;
      });
      throw error;
    }
  }

  async listStates(): Promise<PluginStateSummary[]> {
    const pluginDirectories = await fs
      .readdir(this.rootDirectory, { withFileTypes: true })
      .catch(() => []);
    const states: PluginStateSummary[] = [];

    for (const directory of pluginDirectories) {
      if (!directory.isDirectory()) {
        continue;
      }

      const manifest = await this.readManifestFromDirectory(
        path.join(this.rootDirectory, directory.name, "current"),
      );
      if (!manifest) {
        continue;
      }

      states.push({
        pluginInstanceId: manifest.pluginInstanceId,
        pluginId: manifest.pluginId,
        pluginPrefix: manifest.pluginPrefix,
        pluginNamespace: manifest.pluginNamespace,
        agentName: manifest.agentName,
        updatedAt: manifest.updatedAt,
        revision: manifest.revision,
      });
    }

    states.sort((left, right) => {
      const pluginNamespaceComparison = left.pluginNamespace.localeCompare(
        right.pluginNamespace,
      );
      if (pluginNamespaceComparison !== 0) {
        return pluginNamespaceComparison;
      }

      const agentNameComparison = left.agentName.localeCompare(right.agentName);
      if (agentNameComparison !== 0) {
        return agentNameComparison;
      }

      return left.pluginInstanceId.localeCompare(right.pluginInstanceId);
    });
    return states;
  }

  async readState(
    pluginInstanceId: string,
  ): Promise<StoredPluginStateDetail | null> {
    const currentDirectory = path.join(
      this.pluginDirectory(pluginInstanceId),
      "current",
    );
    const manifest = await this.readManifestFromDirectory(currentDirectory);
    if (!manifest) {
      return null;
    }

    return {
      pluginInstanceId: manifest.pluginInstanceId,
      pluginId: manifest.pluginId,
      pluginPrefix: manifest.pluginPrefix,
      pluginNamespace: manifest.pluginNamespace,
      agentName: manifest.agentName,
      updatedAt: manifest.updatedAt,
      revision: manifest.revision,
      markdown: manifest.markdown,
      assets: manifest.assets,
    };
  }

  async resolveAsset(
    pluginInstanceId: string,
    revision: string,
    assetId: string,
  ): Promise<PluginStateAssetFile | null> {
    const currentDirectory = path.join(
      this.pluginDirectory(pluginInstanceId),
      "current",
    );
    const manifest = await this.readManifestFromDirectory(currentDirectory);
    if (!manifest || manifest.revision !== revision) {
      return null;
    }

    const asset = manifest.assets.find((candidate) => candidate.id === assetId);
    if (!asset) {
      return null;
    }

    const absolutePath = path.join(
      currentDirectory,
      "assets",
      asset.storedFileName,
    );
    return {
      absolutePath,
      fileName: asset.fileName,
      contentType: asset.contentType,
    };
  }

  async clear(): Promise<void> {
    await fs.rm(this.rootDirectory, { recursive: true, force: true });
    await fs.mkdir(this.rootDirectory, { recursive: true });
  }

  private async readManifestFromDirectory(
    directory: string,
  ): Promise<PluginStateManifest | null> {
    try {
      const raw = await fs.readFile(path.join(directory, "state.json"), "utf8");
      return JSON.parse(raw) as PluginStateManifest;
    } catch {
      return null;
    }
  }

  private pluginDirectory(pluginInstanceId: string): string {
    return path.join(
      this.rootDirectory,
      this.validatePathSegment(pluginInstanceId, "plugin instance id"),
    );
  }

  private validateAssetId(assetId: string): string {
    return this.validatePathSegment(assetId, "plugin state asset id");
  }

  private validatePathSegment(value: string, label: string): string {
    const trimmed = value.trim();
    if (
      !/^[A-Za-z0-9._-]+$/.test(trimmed) ||
      trimmed === "." ||
      trimmed === ".."
    ) {
      throw new Error(`Invalid ${label} "${value}". Values must be URL-safe.`);
    }
    return trimmed;
  }

  private sanitizeFileName(fileName: string): string {
    const candidate = path.basename(fileName);
    const cleaned = candidate.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
    return cleaned.length > 0 ? cleaned : "asset";
  }
}
