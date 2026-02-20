import Database from "better-sqlite3";
import path from "path";
import { promises as fs } from "fs";

export class SessionStore {
    private db: Database.Database | null = null;

    async init(directory: string): Promise<void> {
        await fs.mkdir(directory, { recursive: true });
        const dbPath = path.join(directory, "mimir-sessions.db");
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            )
        `);
    }

    getAllNames(): Map<string, string> {
        if (!this.db) {
            return new Map();
        }

        const names = this.db.prepare("SELECT id, name FROM conversations").all() as { id: string; name: string }[];
        const nameMap = new Map<string, string>();
        for (const row of names) {
            nameMap.set(row.id, row.name);
        }

        return nameMap;
    }

    getName(sessionId: string): string | null {
        if (!this.db) {
            return null;
        }

        const result = this.db.prepare("SELECT name FROM conversations WHERE id = ?").get(sessionId) as
            | { name: string }
            | undefined;
        return result?.name ?? null;
    }

    upsertName(sessionId: string, name: string): void {
        if (!this.db) {
            return;
        }

        this.db
            .prepare("INSERT INTO conversations (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name")
            .run(sessionId, name);
    }

    deleteSession(sessionId: string): void {
        if (!this.db) {
            return;
        }

        this.db.prepare("DELETE FROM conversations WHERE id = ?").run(sessionId);
    }

    close(): void {
        this.db?.close();
        this.db = null;
    }
}
