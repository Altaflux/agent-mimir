# Message Content Retention

This document explains how message enrichment and retention works across plugin context injection and agent history.

## Purpose

The system separates two concerns:

- What the model should see right now (`displayMessage`)
- What should be persisted in chat history (`persistentMessage`) and for how long (`retentionPolicy`)

This allows plugins to inject transient context without polluting long-term history.

## Core Types

Defined/used across:

- `agent-core/src/plugins/context-provider.ts`
- `agent-core/src/plugins/index.ts`
- `agent-core/src/agent-manager/tool-agent/agent.ts`
- `agent-core/src/agent-manager/code-agent/agent.ts`

Key contracts:

- `AdditionalContent`
  - `displayOnCurrentMessage: boolean`
  - `saveToChatHistory: boolean | number`
  - `content: ComplexMessageContent[]`
- `RetentionAwareMessageContent`
  - `displayMessage: InputAgentMessage`
  - `persistentMessage.message: InputAgentMessage`
  - `persistentMessage.retentionPolicy: (number | null)[]`

## End-to-End Flow

1. Incoming user/tool input is converted to `InputAgentMessage`.
2. `PluginContextProvider.additionalMessageContent(...)` collects plugin additions.
3. Two message variants are produced:
   - `displayMessage`: sent to the model for the current turn.
   - `persistentMessage`: stored in history for future turns.
4. The persisted message stores two aligned arrays in `additional_kwargs`:
   - `original_content: ComplexMessageContent[]`
   - `persistentMessageRetentionPolicy: (number | null)[]`
5. On later turns, `messageRetentionNode` prunes `original_content` by applying `persistentMessageRetentionPolicy`.
6. If content was pruned:
   - message is rewritten with updated content + updated policy, or
   - message is removed when no content remains.

## Retention Semantics

`persistentMessageRetentionPolicy` is parallel to `original_content`.

- `null`: permanent relative to this policy (not auto-pruned by retention node)
- `N` (number): keep while `N > idx`, where `idx` is the message position in reverse order among messages with retention metadata

Because the node iterates messages in reverse order (newest first):

- `idx = 0` means most recent retained message
- larger `idx` means older retained messages

Example with policy value `2`:

- kept when `idx` is `0` or `1`
- pruned when `idx >= 2`

## How `context-provider` builds policy

For each plugin customization block:

- If `displayOnCurrentMessage` is true, content is appended to `displayMessage`.
- If `saveToChatHistory` is set:
  - content is appended to `persistentMessage`
  - matching retention entries are appended to the policy

Headers and spacing are also content blocks and receive policy entries.

Policy assignment rules:

- Original user content always gets `null`.
- Plugin header retention is:
  - `null` if any customization from that plugin uses `saveToChatHistory: true`
  - otherwise the maximum numeric retention declared by that plugin in the turn
- Each customization body uses its own retention value:
  - `true -> null`
  - `number -> number`
- Spacing blocks inherit the same retention as the customization they follow.

## `original_content` vs `original_ai_content`

The codebase intentionally uses two fields with different semantics:

- `original_content`
  - used for retention-managed Human/Tool messages
  - must remain `ComplexMessageContent[]`
  - consumed by `messageRetentionNode`
- `original_ai_content`
  - used for replaying AI messages back to the LLM
  - stores LangChain-native message content blocks
  - preserves provider-specific metadata/elements that may be lost in `ComplexMessageContent` conversion

Important: AI messages are not retention-managed (`persistentMessageRetentionPolicy` is not used for them).

## Critical Invariants

To avoid retention bugs:

1. Keep `original_content.length === persistentMessageRetentionPolicy.length`.
2. Do not transform `original_content` into a lossy representation.
3. Do not merge or reorder blocks after policy is attached.
4. When pruning, update both content and policy together.
5. Keep AI replay content isolated in `original_ai_content`.

## Common Pitfalls

- Storing retention-managed content as LangChain blocks can break block-level policy alignment.
- Collapsing adjacent text blocks can silently change policy indexing.
- Reusing `original_content` for AI replay can drop provider metadata/tool-tracking elements.

## Validation Checklist for Changes

When modifying retention or message conversion code:

1. Confirm retention-managed writes store `ComplexMessageContent[]` in `original_content`.
2. Confirm AI replay reads/writes use `original_ai_content`.
3. Confirm pruning logic still maps 1:1 over content/policy.
4. Test a scenario with mixed plugin policies (`true`, `number`, and `display only`).
5. Test at least one message containing non-text AI content blocks.
