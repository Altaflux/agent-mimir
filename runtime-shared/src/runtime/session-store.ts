import Database from "better-sqlite3";
import path from "path";
import { promises as fs } from "fs";
import type { SessionEvent } from "../contracts.js";
import type { RuntimePluginNotification } from "./plugin-runtime.js";

export type StoredPluginRuntimeEvent = {
  sequence: number;
  event: Extract<
    SessionEvent,
    { type: "plugin_event" | "plugin_notification" }
  >;
};

export type StoredPluginNotification = {
  notification: RuntimePluginNotification;
};

export type StoredSessionRecord = {
  sessionId: string;
  name: string;
  createdAtMs: number;
  lastActivityAtMs: number;
  agentName: string;
  continuousMode: boolean;
};

export class SessionStore {
  private db: Database.Database | null = null;

  async init(directory: string): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
    const dbPath = path.join(directory, "mimir-sessions.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                last_activity_at_ms INTEGER NOT NULL,
                agent_name TEXT NOT NULL,
                continuous_mode INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_last_activity
                ON sessions(last_activity_at_ms DESC, id ASC);

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
                plugin_instance_id TEXT NOT NULL,
                plugin_id TEXT NOT NULL,
                plugin_prefix TEXT,
                plugin_namespace TEXT NOT NULL,
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
                plugin_instance_id TEXT NOT NULL,
                plugin_id TEXT NOT NULL,
                plugin_prefix TEXT,
                plugin_namespace TEXT NOT NULL,
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
    this.ensureColumn(
      "plugin_runtime_events",
      "plugin_instance_id",
      "TEXT NOT NULL DEFAULT 'legacy'",
    );
    this.ensureColumn(
      "plugin_runtime_events",
      "plugin_id",
      "TEXT NOT NULL DEFAULT 'legacy'",
    );
    this.ensureColumn("plugin_runtime_events", "plugin_prefix", "TEXT");
    this.ensureColumn(
      "plugin_runtime_events",
      "plugin_namespace",
      "TEXT NOT NULL DEFAULT 'legacy'",
    );
    this.ensureColumn(
      "plugin_notifications",
      "plugin_instance_id",
      "TEXT NOT NULL DEFAULT 'legacy'",
    );
    this.ensureColumn(
      "plugin_notifications",
      "plugin_id",
      "TEXT NOT NULL DEFAULT 'legacy'",
    );
    this.ensureColumn("plugin_notifications", "plugin_prefix", "TEXT");
    this.ensureColumn(
      "plugin_notifications",
      "plugin_namespace",
      "TEXT NOT NULL DEFAULT 'legacy'",
    );
  }

  listSessions(): StoredSessionRecord[] {
    if (!this.db) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
            SELECT id, name, created_at_ms, last_activity_at_ms, agent_name, continuous_mode
            FROM sessions
            ORDER BY last_activity_at_ms DESC, id ASC
        `,
      )
      .all() as Array<{
      id: string;
      name: string;
      created_at_ms: number;
      last_activity_at_ms: number;
      agent_name: string;
      continuous_mode: number;
    }>;

    return rows.map((row) => ({
      sessionId: row.id,
      name: row.name,
      createdAtMs: row.created_at_ms,
      lastActivityAtMs: row.last_activity_at_ms,
      agentName: row.agent_name,
      continuousMode: row.continuous_mode !== 0,
    }));
  }

  getSession(sessionId: string): StoredSessionRecord | null {
    if (!this.db) {
      return null;
    }

    const row = this.db
      .prepare(
        `
            SELECT id, name, created_at_ms, last_activity_at_ms, agent_name, continuous_mode
            FROM sessions
            WHERE id = ?
        `,
      )
      .get(sessionId) as
      | {
          id: string;
          name: string;
          created_at_ms: number;
          last_activity_at_ms: number;
          agent_name: string;
          continuous_mode: number;
        }
      | undefined;
    if (!row) {
      return null;
    }

    return {
      sessionId: row.id,
      name: row.name,
      createdAtMs: row.created_at_ms,
      lastActivityAtMs: row.last_activity_at_ms,
      agentName: row.agent_name,
      continuousMode: row.continuous_mode !== 0,
    };
  }

  upsertSession(record: StoredSessionRecord): void {
    if (!this.db) {
      return;
    }

    this.db
      .prepare(
        `
            INSERT INTO sessions (
                id,
                name,
                created_at_ms,
                last_activity_at_ms,
                agent_name,
                continuous_mode
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                created_at_ms = excluded.created_at_ms,
                last_activity_at_ms = excluded.last_activity_at_ms,
                agent_name = excluded.agent_name,
                continuous_mode = excluded.continuous_mode
        `,
      )
      .run(
        record.sessionId,
        record.name,
        record.createdAtMs,
        record.lastActivityAtMs,
        record.agentName,
        record.continuousMode ? 1 : 0,
      );
  }

  updateSessionActivity(sessionId: string, lastActivityAtMs: number): void {
    if (!this.db) {
      return;
    }

    this.db
      .prepare("UPDATE sessions SET last_activity_at_ms = ? WHERE id = ?")
      .run(lastActivityAtMs, sessionId);
  }

  updateSessionContinuousMode(
    sessionId: string,
    continuousMode: boolean,
  ): void {
    if (!this.db) {
      return;
    }

    this.db
      .prepare("UPDATE sessions SET continuous_mode = ? WHERE id = ?")
      .run(continuousMode ? 1 : 0, sessionId);
  }

  deleteSession(sessionId: string): void {
    if (!this.db) {
      return;
    }

    this.db
      .prepare("DELETE FROM plugin_runtime_events WHERE session_id = ?")
      .run(sessionId);
    this.db
      .prepare("DELETE FROM plugin_notifications WHERE session_id = ?")
      .run(sessionId);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  appendPluginRuntimeEvent(
    sessionId: string,
    event: Extract<
      SessionEvent,
      { type: "plugin_event" | "plugin_notification" }
    >,
    options: { retentionLimit: number },
  ): void {
    if (!this.db) {
      return;
    }

    const timestampMs = Date.parse(event.timestamp);
    const normalizedTimestampMs = Number.isFinite(timestampMs)
      ? timestampMs
      : Date.now();

    this.db
      .prepare(
        `
            INSERT INTO plugin_runtime_events (
                event_id,
                session_id,
                timestamp,
                timestamp_ms,
                type,
                tool_call_id,
                tool_name,
                notification_id,
                plugin_instance_id,
                plugin_id,
                plugin_prefix,
                plugin_namespace,
                agent_name,
                payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(event_id) DO NOTHING
        `,
      )
      .run(
        event.id,
        sessionId,
        event.timestamp,
        normalizedTimestampMs,
        event.type,
        event.type === "plugin_event" ? event.toolCallId : null,
        event.type === "plugin_event" ? event.toolName : null,
        event.type === "plugin_notification" ? event.notificationId : null,
        event.pluginInstanceId,
        event.pluginId,
        event.pluginPrefix ?? null,
        event.pluginNamespace,
        event.agentName,
        JSON.stringify(event),
      );

    this.prunePluginRuntimeEvents(sessionId, options.retentionLimit);
  }

  listPluginRuntimeEvents(sessionId: string): StoredPluginRuntimeEvent[] {
    if (!this.db) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
            SELECT sequence, payload_json
            FROM plugin_runtime_events
            WHERE session_id = ?
            ORDER BY sequence ASC
        `,
      )
      .all(sessionId) as { sequence: number; payload_json: string }[];

    return rows.map((row) => ({
      sequence: row.sequence,
      event: JSON.parse(row.payload_json) as Extract<
        SessionEvent,
        { type: "plugin_event" | "plugin_notification" }
      >,
    }));
  }

  clearPluginRuntimeEvents(sessionId: string): void {
    if (!this.db) {
      return;
    }

    this.db
      .prepare("DELETE FROM plugin_runtime_events WHERE session_id = ?")
      .run(sessionId);
  }

  savePluginNotification(
    sessionId: string,
    notification: RuntimePluginNotification,
  ): void {
    if (!this.db) {
      return;
    }

    this.db
      .prepare(
        `
            INSERT INTO plugin_notifications (
                session_id,
                notification_id,
                plugin_instance_id,
                plugin_id,
                plugin_prefix,
                plugin_namespace,
                agent_name,
                created_at,
                title,
                summary,
                deduplication_id,
                content_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id, notification_id) DO UPDATE SET
                plugin_instance_id = excluded.plugin_instance_id,
                plugin_id = excluded.plugin_id,
                plugin_prefix = excluded.plugin_prefix,
                plugin_namespace = excluded.plugin_namespace,
                agent_name = excluded.agent_name,
                created_at = excluded.created_at,
                title = excluded.title,
                summary = excluded.summary,
                deduplication_id = excluded.deduplication_id,
                content_json = excluded.content_json
        `,
      )
      .run(
        sessionId,
        notification.id,
        notification.pluginInstanceId,
        notification.pluginId,
        notification.pluginPrefix ?? null,
        notification.pluginNamespace,
        notification.agentName,
        notification.createdAt,
        notification.title,
        notification.summary ?? null,
        notification.deduplicationId ?? null,
        JSON.stringify(notification.content),
      );
  }

  listPluginNotifications(sessionId: string): StoredPluginNotification[] {
    if (!this.db) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
            SELECT
                notification_id,
                plugin_instance_id,
                plugin_id,
                plugin_prefix,
                plugin_namespace,
                agent_name,
                created_at,
                title,
                summary,
                deduplication_id,
                content_json
            FROM plugin_notifications
            WHERE session_id = ?
            ORDER BY created_at ASC, notification_id ASC
        `,
      )
      .all(sessionId) as Array<{
      notification_id: string;
      plugin_instance_id: string;
      plugin_id: string;
      plugin_prefix: string | null;
      plugin_namespace: string;
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
        pluginInstanceId: row.plugin_instance_id,
        pluginId: row.plugin_id,
        pluginPrefix: row.plugin_prefix ?? undefined,
        pluginNamespace: row.plugin_namespace,
        agentName: row.agent_name,
        createdAt: row.created_at,
        title: row.title,
        summary: row.summary ?? undefined,
        deduplicationId: row.deduplication_id ?? undefined,
        content: JSON.parse(row.content_json),
      },
    }));
  }

  deletePluginNotifications(
    sessionId: string,
    notificationIds: string[],
  ): void {
    if (!this.db || notificationIds.length === 0) {
      return;
    }

    const remove = this.db.prepare(
      "DELETE FROM plugin_notifications WHERE session_id = ? AND notification_id = ?",
    );
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

    this.db
      .prepare("DELETE FROM plugin_notifications WHERE session_id = ?")
      .run(sessionId);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private prunePluginRuntimeEvents(
    sessionId: string,
    retentionLimit: number,
  ): void {
    if (!this.db || retentionLimit <= 0) {
      return;
    }

    this.db
      .prepare(
        `
            DELETE FROM plugin_runtime_events
            WHERE session_id = ?
              AND sequence NOT IN (
                  SELECT sequence
                  FROM plugin_runtime_events
                  WHERE session_id = ?
                  ORDER BY sequence DESC
                  LIMIT ?
              )
        `,
      )
      .run(sessionId, sessionId, retentionLimit);
  }

  private ensureColumn(
    tableName: string,
    columnName: string,
    definition: string,
  ): void {
    if (!this.db) {
      return;
    }

    const columns = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
    );
  }
}
