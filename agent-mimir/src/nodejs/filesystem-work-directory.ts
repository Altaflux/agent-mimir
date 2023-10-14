import path from "path";
import { WorkspaceManager } from "../schema.js";
import { promises as fs } from 'fs';

export class FileSystemWorkspaceManager implements WorkspaceManager {

    workingDirectory: string;

    constructor(agentRootDirectory: string) {
        this.workingDirectory = path.join(agentRootDirectory, "workspace");
    }

    async clearWorkspace(): Promise<void> {
        const files = await fs.readdir(this.workingDirectory);
        for (const file of files) {
            await fs.unlink(path.join(this.workingDirectory, file));
        }
    }

    async listFiles(): Promise<string[]> {
        const files = await fs.readdir(this.workingDirectory);
        return files;
    }
    async loadFileToWorkspace(fileName: string, url: string): Promise<void> {
        const destination = path.join(this.workingDirectory, fileName);
        await fs.copyFile(url, destination);
        console.debug(`Copied file ${url} to ${destination}`);
    }

    async getUrlForFile(fileName: string): Promise<string> {
        const file = path.join(this.workingDirectory, fileName);
        return file;
    }
}