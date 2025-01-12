import path from "path";
import { AgentWorkspace } from "../schema.js";
import { promises as fs } from 'fs';

export class FileSystemAgentWorkspace implements AgentWorkspace {

    get workingDirectory() {
        return path.join(this.agentRootDirectory, "workspace");
    }   
    
    get rootDirectory() {
        return this.agentRootDirectory;
    }

    constructor(private agentRootDirectory: string) {
    }

    async fileAsBuffer(fileName: string): Promise<Buffer | undefined> {
        if ((await this.listFiles()).includes(fileName)) {
            const fileData = await fs.readFile(path.join(this.workingDirectory, fileName));
            return fileData;
        }
        return undefined;
    }


    async reset(): Promise<void> {
        const files = await fs.readdir(this.workingDirectory);
        for (const file of files) {
            await fs.unlink(path.join(this.workingDirectory, file));
        }
    }

    async pluginDirectory(pluginName: string): Promise<string> {
        const pluginPath = path.join(this.agentRootDirectory, "plugins", pluginName);
        await fs.mkdir(pluginPath, { recursive: true });
        return pluginPath;
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