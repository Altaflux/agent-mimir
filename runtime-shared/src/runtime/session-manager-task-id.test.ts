import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "./session-manager.js";

type HydratedTaskIdAccessor = {
    getHydratedTaskId(
        session: { sessionId: string },
        requestAttributes: Record<string, unknown>,
        messageId: string | undefined,
        taskIndex: number
    ): string;
};

type TaskIdentityAccessor = HydratedTaskIdAccessor & {
    beginTask(session: { currentTaskId: string | null }, taskId: string): string;
    requireTaskId(session: { currentTaskId: string | null }): string;
    getNotificationAnchorTaskId(session: { currentTaskId: string | null }): string | null;
};

test("hydrated task ids prefer runtimeTaskId over human message ids", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as HydratedTaskIdAccessor;

    const taskId = manager.getHydratedTaskId(
        { sessionId: "session-1" },
        { runtimeTaskId: "runtime-task-1" },
        "human-message-1",
        0
    );

    assert.equal(taskId, "runtime-task-1");
});

test("hydrated task ids fall back to human message id and then stable generated ids", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as HydratedTaskIdAccessor;

    assert.equal(
        manager.getHydratedTaskId({ sessionId: "session-1" }, {}, "human-message-1", 0),
        "human-message-1"
    );
    assert.equal(
        manager.getHydratedTaskId({ sessionId: "session-1" }, {}, undefined, 1),
        "hydrated-session-1-1"
    );
});

test("current task id is both runtime task identity and notification anchor", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as TaskIdentityAccessor;
    const session = { currentTaskId: null };

    assert.equal(manager.getNotificationAnchorTaskId(session), null);
    assert.equal(manager.beginTask(session, "task-1"), "task-1");
    assert.equal(manager.requireTaskId(session), "task-1");
    assert.equal(manager.getNotificationAnchorTaskId(session), "task-1");
});
