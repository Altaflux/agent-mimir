import Database from "better-sqlite3";
import path from "path";
import { promises as fs } from "fs";
import type { SessionEvent } from "../contracts.js";
import type { PluginNotification } from "@mimir/agent-core/plugins";

export type StoredPluginRuntimeEvent = {
    sequence: number;
    event: Extract<SessionEvent, { type: "plugin_event" | "plugin_notification" }>;
};

export type StoredPluginNotification = {
    notification: PluginNotification;
};

type PluginSessionActivity = {
    earliestTimestampMs: number;
    latestTimestampMs: number;
};

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
            );

            CREATE TABLE IF NOT EXISTS plugin_runtime_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                session_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                timestamp_ms INTEGER NOT NULL,
                type TEXT NOT NULL,
                tool_call_id TEXT,
                tool_name TEXT,
                notification_id TEXT,
                plugin_name TEXT NOT NULL,
                agent_name TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_plugin_runtime_events_session_sequence
                ON plugin_runtime_events(session_id, sequence);
            CREATE INDEX IF NOT EXISTS idx_plugin_runtime_events_tool_call
                ON plugin_runtime_events(session_id, tool_call_id);

            CREATE TABLE IF NOT EXISTS plugin_notifications (
                session_id TEXT NOT NULL,
                notification_id TEXT NOT NULL,
                plugin_name TEXT NOT NULL,
                agent_name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                deduplication_id TEXT,
                content_json TEXT NOT NULL,
                PRIMARY KEY (session_id, notification_id)
            );

            CREATE INDEX IF NOT EXISTS idx_plugin_notifications_session_created
                ON plugin_notifications(session_id, created_at, notification_id);
            CREATE INDEX IF NOT EXISTS idx_plugin_notifications_session_deduplication
                ON plugin_notifications(session_id, deduplication_id);
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

        this.db.prepare("DELETE FROM plugin_runtime_events WHERE session_id = ?").run(sessionId);
        this.db.prepare("DELETE FROM plugin_notifications WHERE session_id = ?").run(sessionId);
        this.db.prepare("DELETE FROM conversations WHERE id = ?").run(sessionId);
    }

    getPluginSessionActivity(): Map<string, PluginSessionActivity> {
        if (!this.db) {
            return new Map();
        }

        const rows = this.db.prepare(`
            SELECT session_id, MIN(timestamp_ms) AS earliestTimestampMs, MAX(timestamp_ms) AS latestTimestampMs
            FROM (
                SELECT session_id, timestamp_ms FROM plugin_runtime_events
                UNION ALL
                SELECT session_id, created_at AS timestamp_ms FROM plugin_notifications
            )
            GROUP BY session_id
        `).all() as { session_id: string; earliestTimestampMs: number; latestTimestampMs: number }[];

        const activity = new Map<string, PluginSessionActivity>();
        for (const row of rows) {
            activity.set(row.session_id, {
                earliestTimestampMs: row.earliestTimestampMs,
                latestTimestampMs: row.latestTimestampMs
            });
        }
        return activity;
    }

    appendPluginRuntimeEvent(
        sessionId: string,
        event: Extract<SessionEvent, { type: "plugin_event" | "plugin_notification" }>,
        options: { retentionLimit: number }
    ): void {
        if (!this.db) {
            return;
        }

        const timestampMs = Date.parse(event.timestamp);
        const normalizedTimestampMs = Number.isFinite(timestampMs) ? timestampMs : Date.now();

        this.db.prepare(`
            INSERT INTO plugin_runtime_events (
                event_id,
                session_id,
                timestamp,
                timestamp_ms,
                type,
                tool_call_id,
                tool_name,
                notification_id,
                plugin_name,
                agent_name,
                payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(event_id) DO NOTHING
        `).run(
            event.id,
            sessionId,
            event.timestamp,
            normalizedTimestampMs,
            event.type,
            event.type === "plugin_event" ? event.toolCallId : null,
            event.type === "plugin_event" ? event.toolName : null,
            event.type === "plugin_notification" ? event.notificationId : null,
            event.pluginName,
            event.agentName,
            JSON.stringify(event)
        );

        this.prunePluginRuntimeEvents(sessionId, options.retentionLimit);
    }

    listPluginRuntimeEvents(sessionId: string): StoredPluginRuntimeEvent[] {
        if (!this.db) {
            return [];
        }

        const rows = this.db.prepare(`
            SELECT sequence, payload_json
            FROM plugin_runtime_events
            WHERE session_id = ?
            ORDER BY sequence ASC
        `).all(sessionId) as { sequence: number; payload_json: string }[];

        return rows.map((row) => ({
            sequence: row.sequence,
            event: JSON.parse(row.payload_json) as Extract<SessionEvent, { type: "plugin_event" | "plugin_notification" }>
        }));
    }

    clearPluginRuntimeEvents(sessionId: string): void {
        if (!this.db) {
            return;
        }

        this.db.prepare("DELETE FROM plugin_runtime_events WHERE session_id = ?").run(sessionId);
    }

    savePluginNotification(sessionId: string, notification: PluginNotification): void {
        if (!this.db) {
            return;
        }

        this.db.prepare(`
            INSERT INTO plugin_notifications (
                session_id,
                notification_id,
                plugin_name,
                agent_name,
                created_at,
                title,
                summary,
                deduplication_id,
                content_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id, notification_id) DO UPDATE SET
                plugin_name = excluded.plugin_name,
                agent_name = excluded.agent_name,
                created_at = excluded.created_at,
                title = excluded.title,
                summary = excluded.summary,
                deduplication_id = excluded.deduplication_id,
                content_json = excluded.content_json
        `).run(
            sessionId,
            notification.id,
            notification.pluginName,
            notification.agentName,
            notification.createdAt,
            notification.title,
            notification.summary ?? null,
            notification.deduplicationId ?? null,
            JSON.stringify(notification.content)
        );
    }

    listPluginNotifications(sessionId: string): StoredPluginNotification[] {
        if (!this.db) {
            return [];
        }

        const rows = this.db.prepare(`
            SELECT
                notification_id,
                plugin_name,
                agent_name,
                created_at,
                title,
                summary,
                deduplication_id,
                content_json
            FROM plugin_notifications
            WHERE session_id = ?
            ORDER BY created_at ASC, notification_id ASC
        `).all(sessionId) as Array<{
            notification_id: string;
            plugin_name: string;
            agent_name: string;
            created_at: number;
            title: string;
            summary: string | null;
            deduplication_id: string | null;
            content_json: string;
        }>;

        return rows.map((row) => ({
            notification: {
                id: row.notification_id,
                pluginName: row.plugin_name,
                agentName: row.agent_name,
                createdAt: row.created_at,
                title: row.title,
                summary: row.summary ?? undefined,
                deduplicationId: row.deduplication_id ?? undefined,
                content: JSON.parse(row.content_json)
            }
        }));
    }

    deletePluginNotifications(sessionId: string, notificationIds: string[]): void {
        if (!this.db || notificationIds.length === 0) {
            return;
        }

        const remove = this.db.prepare("DELETE FROM plugin_notifications WHERE session_id = ? AND notification_id = ?");
        const transaction = this.db.transaction((ids: string[]) => {
            for (const id of ids) {
                remove.run(sessionId, id);
            }
        });
        transaction(notificationIds);
    }

    clearPluginNotifications(sessionId: string): void {
        if (!this.db) {
            return;
        }

        this.db.prepare("DELETE FROM plugin_notifications WHERE session_id = ?").run(sessionId);
    }

    close(): void {
        this.db?.close();
        this.db = null;
    }

    private prunePluginRuntimeEvents(sessionId: string, retentionLimit: number): void {
        if (!this.db || retentionLimit <= 0) {
            return;
        }

        this.db.prepare(`
            DELETE FROM plugin_runtime_events
            WHERE session_id = ?
              AND sequence NOT IN (
                  SELECT sequence
                  FROM plugin_runtime_events
                  WHERE session_id = ?
                  ORDER BY sequence DESC
                  LIMIT ?
              )
        `).run(sessionId, sessionId, retentionLimit);
    }
}
