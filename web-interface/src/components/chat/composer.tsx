"use client";

import {
    type ApprovalRequest,
    type ElicitationPropertySchema,
    type ElicitationRequestedSchema,
    type PluginElicitationPayload,
    type PluginElicitationResponseRequest,
} from "@/lib/contracts";
import { fileFingerprint } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    ArrowUp,
    Bell,
    ExternalLink,
    Loader2,
    Paperclip,
    ShieldAlert,
    Square,
    Wrench,
    X,
} from "lucide-react";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";

export interface ComposerProps {
    activeSessionId: string | null;
    isSubmitting: boolean;
    hasPendingToolRequest: boolean;
    hasPendingElicitation: boolean;
    pendingElicitations: PluginElicitationPayload[];
    pendingNotificationCount: number;
    errorMessage: string | null;
    onSendMessage: (message: string, files: File[]) => void;
    onProcessNotifications: () => void;
    onSubmitApproval: (action: ApprovalRequest["action"], feedback?: string) => void;
    onSubmitElicitationResponse: (
        elicitationRequestId: string,
        payload: PluginElicitationResponseRequest,
    ) => void | Promise<void>;
    onClearError: () => void;
    onStopSession: () => void;
}

export function Composer({
    activeSessionId,
    isSubmitting,
    hasPendingToolRequest,
    hasPendingElicitation,
    pendingElicitations,
    pendingNotificationCount,
    errorMessage,
    onSendMessage,
    onProcessNotifications,
    onSubmitApproval,
    onSubmitElicitationResponse,
    onClearError,
    onStopSession
}: ComposerProps) {
    const [message, setMessage] = useState("");
    const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
    const [isComposerDragOver, setIsComposerDragOver] = useState(false);
    const [disapproveMessage, setDisapproveMessage] = useState("");
    const [showDisapproveBox, setShowDisapproveBox] = useState(false);
    const [submittingElicitationId, setSubmittingElicitationId] = useState<string | null>(null);

    const dragDepthRef = useRef(0);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const disableComposer = isSubmitting || hasPendingToolRequest || hasPendingElicitation;

    const handleSubmitElicitationResponse = useCallback(
        async (
            elicitationRequestId: string,
            payload: PluginElicitationResponseRequest,
        ) => {
            setSubmittingElicitationId(elicitationRequestId);
            try {
                await onSubmitElicitationResponse(elicitationRequestId, payload);
            } finally {
                setSubmittingElicitationId(null);
            }
        },
        [onSubmitElicitationResponse],
    );

    /* ── File management ─────────────────────────────── */

    const addFiles = useCallback((incomingFiles: File[]) => {
        if (incomingFiles.length === 0) return;
        setAttachedFiles((current) => {
            const existingFingerprints = new Set(current.map((f) => fileFingerprint(f)));
            const uniqueIncoming = incomingFiles.filter((f) => !existingFingerprints.has(fileFingerprint(f)));
            return [...current, ...uniqueIncoming];
        });
    }, []);

    const removeAttachedFile = useCallback((fingerprint: string) => {
        setAttachedFiles((current) => {
            let removed = false;
            return current.filter((file) => {
                if (!removed && fileFingerprint(file) === fingerprint) {
                    removed = true;
                    return false;
                }
                return true;
            });
        });
    }, []);

    /* ── Drag & drop ─────────────────────────────────── */

    const handleDragEnter = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            if (disableComposer || !activeSessionId) return;
            if (!event.dataTransfer.types.includes("Files")) return;
            dragDepthRef.current += 1;
            setIsComposerDragOver(true);
        },
        [activeSessionId, disableComposer]
    );

    const handleDragOver = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            if (disableComposer || !activeSessionId) return;
            event.dataTransfer.dropEffect = "copy";
        },
        [activeSessionId, disableComposer]
    );

    const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsComposerDragOver(false);
    }, []);

    const handleDrop = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            dragDepthRef.current = 0;
            setIsComposerDragOver(false);
            if (disableComposer || !activeSessionId) return;
            addFiles(Array.from(event.dataTransfer.files ?? []));
        },
        [activeSessionId, addFiles, disableComposer]
    );

    /* ── Send ────────────────────────────────────────── */

    const handleSend = useCallback(() => {
        if (!activeSessionId || disableComposer) return;
        if (message.trim().length === 0 && attachedFiles.length === 0) return;
        onSendMessage(message, attachedFiles);
        setMessage("");
        setAttachedFiles([]);
    }, [activeSessionId, attachedFiles, disableComposer, message, onSendMessage]);

    /* ── Auto-resize textarea ────────────────────────── */

    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }, [message]);

    return (
        <div className="shrink-0 border-t border-border/20 bg-background">
            <div className="mx-auto max-w-3xl px-4 py-3 space-y-2">
                {pendingElicitations.map((elicitation) => (
                    <ElicitationCard
                        key={elicitation.elicitationRequestId}
                        elicitation={elicitation}
                        disabled={
                            submittingElicitationId ===
                            elicitation.elicitationRequestId
                        }
                        onSubmit={handleSubmitElicitationResponse}
                    />
                ))}

                {pendingNotificationCount > 0 ? (
                    <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-3 animate-msg-in">
                        <div className="flex flex-wrap items-center gap-3">
                            <Bell className="h-4 w-4 text-cyan-400" />
                            <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                                {pendingNotificationCount === 1
                                    ? "1 plugin notification is waiting"
                                    : `${pendingNotificationCount} plugin notifications are waiting`}
                            </span>
                            <Button
                                size="sm"
                                onClick={onProcessNotifications}
                                disabled={!activeSessionId || isSubmitting || hasPendingToolRequest || hasPendingElicitation}
                                className="rounded-lg"
                            >
                                {isSubmitting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                                Process next
                            </Button>
                        </div>
                    </div>
                ) : null}

                {/* Approval bar */}
                {hasPendingToolRequest ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 animate-msg-in">
                        <div className="flex items-center gap-2 mb-2">
                            <Wrench className="h-4 w-4 text-amber-400" />
                            <span className="text-sm font-medium text-foreground">Tool request awaiting your decision</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                size="sm"
                                onClick={() => onSubmitApproval("approve")}
                                disabled={isSubmitting}
                                className="rounded-lg"
                            >
                                {isSubmitting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                                Approve
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setShowDisapproveBox((c) => !c)}
                                disabled={isSubmitting}
                                className="rounded-lg"
                            >
                                Disapprove
                            </Button>
                        </div>
                        {showDisapproveBox ? (
                            <div className="mt-3 space-y-2">
                                <Textarea
                                    value={disapproveMessage}
                                    onChange={(e) => setDisapproveMessage(e.target.value)}
                                    placeholder="Explain why this should not run..."
                                    className="min-h-[60px] rounded-lg bg-background/50 text-sm"
                                />
                                <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => {
                                        onSubmitApproval("disapprove", disapproveMessage);
                                        setDisapproveMessage("");
                                        setShowDisapproveBox(false);
                                    }}
                                    disabled={isSubmitting}
                                    className="rounded-lg"
                                >
                                    Send Disapproval
                                </Button>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {/* Error message */}
                {errorMessage ? (
                    <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                        <span className="flex-1">{errorMessage}</span>
                        <button
                            onClick={onClearError}
                            className="shrink-0 rounded-md p-0.5 hover:bg-red-500/20 transition-colors"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ) : null}

                {/* Composer input */}
                <div
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`relative rounded-2xl border transition-all ${isComposerDragOver
                        ? "border-emerald-500/50 bg-emerald-500/5 shadow-lg shadow-emerald-500/10"
                        : "border-border/60 bg-secondary/40 hover:border-border"
                        }`}
                >
                    {/* Attached files */}
                    {attachedFiles.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                            {attachedFiles.map((file, index) => {
                                const fp = fileFingerprint(file);
                                return (
                                    <div
                                        key={`${fp}-${index}`}
                                        className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1 text-xs text-muted-foreground"
                                    >
                                        <Paperclip className="h-3 w-3" />
                                        <span className="max-w-[180px] truncate">{file.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeAttachedFile(fp)}
                                            className="rounded p-0.5 hover:bg-accent hover:text-foreground transition-colors"
                                            aria-label={`Remove ${file.name}`}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}

                    <div className="flex items-end gap-2 p-2">
                        <button
                            type="button"
                            className="shrink-0 rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={disableComposer || !activeSessionId}
                            title="Attach files"
                        >
                            <Paperclip className="h-4 w-4" />
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                                addFiles(Array.from(e.target.files ?? []));
                                if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                        />

                        <textarea
                            ref={textareaRef}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            onKeyDown={(event) => {
                                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                                event.preventDefault();
                                handleSend();
                            }}
                            placeholder={activeSessionId ? "Message Agent Mimir..." : "Create a conversation first..."}
                            disabled={disableComposer || !activeSessionId}
                            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50 py-2 max-h-[200px]"
                            rows={1}
                        />

                        {isSubmitting ? (
                            <button
                                type="button"
                                onClick={onStopSession}
                                className="shrink-0 rounded-full bg-red-500 p-2 text-white transition-all hover:bg-red-600"
                                title="Stop generating"
                            >
                                <Square fill="currentColor" className="h-4 w-4" />
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleSend}
                                disabled={!activeSessionId || disableComposer || (message.trim().length === 0 && attachedFiles.length === 0)}
                                className="shrink-0 rounded-full bg-foreground p-2 text-background transition-all hover:bg-foreground/90 disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Send message"
                            >
                                <ArrowUp className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </div>

                <p className="text-center text-[11px] text-muted-foreground/50">
                    Agent Mimir may produce inaccurate information. Drag files into the input to attach.
                </p>
            </div>
        </div>
    );
}

type FormValue = string | boolean | string[];

function ElicitationCard({
    elicitation,
    disabled,
    onSubmit,
}: {
    elicitation: PluginElicitationPayload;
    disabled: boolean;
    onSubmit: (
        elicitationRequestId: string,
        payload: PluginElicitationResponseRequest,
    ) => void | Promise<void>;
}) {
    if (elicitation.request.mode === "url") {
        return (
            <UrlElicitationCard
                elicitation={elicitation}
                disabled={disabled}
                onSubmit={onSubmit}
            />
        );
    }

    return (
        <FormElicitationCard
            elicitation={elicitation}
            disabled={disabled}
            onSubmit={onSubmit}
        />
    );
}

function FormElicitationCard({
    elicitation,
    disabled,
    onSubmit,
}: {
    elicitation: PluginElicitationPayload;
    disabled: boolean;
    onSubmit: (
        elicitationRequestId: string,
        payload: PluginElicitationResponseRequest,
    ) => void | Promise<void>;
}) {
    const schema = elicitation.request.requestedSchema;
    const [values, setValues] = useState<Record<string, FormValue>>(() =>
        defaultFormValues(schema),
    );
    const [errors, setErrors] = useState<Record<string, string>>({});

    const updateValue = useCallback((name: string, value: FormValue) => {
        setValues((current) => ({ ...current, [name]: value }));
        setErrors((current) => {
            const { [name]: _removed, ...rest } = current;
            return rest;
        });
    }, []);

    const submitAccept = useCallback(() => {
        const result = validateAndNormalizeForm(schema, values);
        if (!result.ok) {
            setErrors(result.errors);
            return;
        }

        void onSubmit(elicitation.elicitationRequestId, {
            action: "accept",
            content: result.content,
        });
    }, [elicitation.elicitationRequestId, onSubmit, schema, values]);

    return (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 animate-msg-in">
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Wrench className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium text-foreground">
                    {pluginLabel(elicitation)} needs information
                </span>
            </div>
            <p className="mb-3 whitespace-pre-wrap text-sm text-foreground">
                {elicitation.request.message}
            </p>
            <div className="space-y-3">
                {Object.entries(schema.properties).map(([name, property]) => (
                    <FormField
                        key={name}
                        name={name}
                        schema={property}
                        required={(schema.required ?? []).includes(name)}
                        value={values[name]}
                        error={errors[name]}
                        disabled={disabled}
                        onChange={(value) => updateValue(name, value)}
                    />
                ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                    size="sm"
                    onClick={submitAccept}
                    disabled={disabled}
                    className="rounded-lg"
                >
                    {disabled ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    Submit
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                        onSubmit(elicitation.elicitationRequestId, {
                            action: "decline",
                        })
                    }
                    disabled={disabled}
                    className="rounded-lg"
                >
                    Decline
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                        onSubmit(elicitation.elicitationRequestId, {
                            action: "cancel",
                        })
                    }
                    disabled={disabled}
                    className="rounded-lg"
                >
                    Cancel
                </Button>
            </div>
        </div>
    );
}

function UrlElicitationCard({
    elicitation,
    disabled,
    onSubmit,
}: {
    elicitation: PluginElicitationPayload;
    disabled: boolean;
    onSubmit: (
        elicitationRequestId: string,
        payload: PluginElicitationResponseRequest,
    ) => void | Promise<void>;
}) {
    const urlInfo = parseUrlInfo(elicitation.request.url);

    return (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 animate-msg-in">
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <ExternalLink className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-medium text-foreground">
                    {pluginLabel(elicitation)} requests a URL interaction
                </span>
                {urlInfo.host ? (
                    <span className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {urlInfo.host}
                    </span>
                ) : null}
            </div>
            <p className="mb-3 whitespace-pre-wrap text-sm text-foreground">
                {elicitation.request.message}
            </p>
            <div className="rounded-lg border border-border/50 bg-background/50 px-3 py-2 font-mono text-xs text-muted-foreground break-all">
                {elicitation.request.url}
            </div>
            {!urlInfo.safe ? (
                <div className="mt-2 flex items-start gap-2 text-xs text-amber-300">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{urlInfo.warning}</span>
                </div>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                    size="sm"
                    onClick={() => {
                        window.open(
                            elicitation.request.url,
                            "_blank",
                            "noopener,noreferrer",
                        );
                        void onSubmit(elicitation.elicitationRequestId, {
                            action: "accept",
                        });
                    }}
                    disabled={disabled}
                    className="rounded-lg"
                >
                    {disabled ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Open and Continue
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                        onSubmit(elicitation.elicitationRequestId, {
                            action: "decline",
                        })
                    }
                    disabled={disabled}
                    className="rounded-lg"
                >
                    Decline
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                        onSubmit(elicitation.elicitationRequestId, {
                            action: "cancel",
                        })
                    }
                    disabled={disabled}
                    className="rounded-lg"
                >
                    Cancel
                </Button>
            </div>
        </div>
    );
}

function FormField({
    name,
    schema,
    required,
    value,
    error,
    disabled,
    onChange,
}: {
    name: string;
    schema: ElicitationPropertySchema;
    required: boolean;
    value: FormValue | undefined;
    error: string | undefined;
    disabled: boolean;
    onChange: (value: FormValue) => void;
}) {
    const label = schema.title ?? name;
    const description = schema.description;

    return (
        <label className="block space-y-1.5">
            <span className="flex items-center gap-1 text-xs font-medium text-foreground">
                {label}
                {required ? <span className="text-emerald-300">*</span> : null}
            </span>
            {description ? (
                <span className="block text-[11px] text-muted-foreground">
                    {description}
                </span>
            ) : null}
            <FieldControl
                name={name}
                schema={schema}
                value={value}
                disabled={disabled}
                onChange={onChange}
            />
            {error ? <span className="block text-xs text-red-300">{error}</span> : null}
        </label>
    );
}

function FieldControl({
    name,
    schema,
    value,
    disabled,
    onChange,
}: {
    name: string;
    schema: ElicitationPropertySchema;
    value: FormValue | undefined;
    disabled: boolean;
    onChange: (value: FormValue) => void;
}) {
    if (schema.type === "boolean") {
        return (
            <input
                type="checkbox"
                checked={value === true}
                disabled={disabled}
                onChange={(event) => onChange(event.currentTarget.checked)}
                className="h-4 w-4 rounded border-border bg-background"
            />
        );
    }

    if (schema.type === "array") {
        const selected = Array.isArray(value) ? value : [];
        return (
            <div className="grid gap-1.5 sm:grid-cols-2">
                {arrayOptions(schema).map((option) => (
                    <label
                        key={option.value}
                        className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/40 px-2 py-1.5 text-xs text-foreground"
                    >
                        <input
                            type="checkbox"
                            checked={selected.includes(option.value)}
                            disabled={disabled}
                            onChange={(event) => {
                                const next = event.currentTarget.checked
                                    ? [...selected, option.value]
                                    : selected.filter((item) => item !== option.value);
                                onChange(next);
                            }}
                            className="h-3.5 w-3.5 rounded border-border bg-background"
                        />
                        <span>{option.label}</span>
                    </label>
                ))}
            </div>
        );
    }

    if (schema.type === "string" && stringOptions(schema).length > 0) {
        return (
            <select
                value={typeof value === "string" ? value : ""}
                disabled={disabled}
                onChange={(event) => onChange(event.currentTarget.value)}
                className="w-full rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-foreground"
            >
                <option value="">Select...</option>
                {stringOptions(schema).map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        );
    }

    if (schema.type === "number" || schema.type === "integer") {
        return (
            <input
                type="number"
                step={schema.type === "integer" ? 1 : "any"}
                value={typeof value === "string" ? value : ""}
                disabled={disabled}
                onChange={(event) => onChange(event.currentTarget.value)}
                className="w-full rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-foreground"
            />
        );
    }

    return (
        <input
            type={inputTypeForString(schema)}
            value={typeof value === "string" ? value : ""}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.value)}
            className="w-full rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-foreground"
            name={name}
        />
    );
}

function defaultFormValues(
    schema: ElicitationRequestedSchema,
): Record<string, FormValue> {
    return Object.fromEntries(
        Object.entries(schema.properties).map(([name, property]) => {
            if (property.type === "array") {
                return [name, property.default ?? []];
            }
            if (property.type === "boolean") {
                return [name, property.default ?? false];
            }
            if (property.type === "number" || property.type === "integer") {
                return [name, property.default === undefined ? "" : String(property.default)];
            }
            return [name, property.default ?? ""];
        }),
    );
}

function validateAndNormalizeForm(
    schema: ElicitationRequestedSchema,
    values: Record<string, FormValue>,
):
    | {
          ok: true;
          content: Record<string, unknown>;
      }
    | {
          ok: false;
          errors: Record<string, string>;
      } {
    const errors: Record<string, string> = {};
    const content: Record<string, unknown> = {};
    const required = new Set(schema.required ?? []);

    for (const [name, property] of Object.entries(schema.properties)) {
        const value = values[name];
        if (property.type === "boolean") {
            if (required.has(name) || value === true || value === false) {
                content[name] = value === true;
            }
            continue;
        }

        if (property.type === "array") {
            const selected = Array.isArray(value) ? value : [];
            if (required.has(name) && selected.length === 0) {
                errors[name] = "Select at least one option.";
                continue;
            }
            if (property.minItems !== undefined && selected.length < property.minItems) {
                errors[name] = `Select at least ${property.minItems}.`;
                continue;
            }
            if (property.maxItems !== undefined && selected.length > property.maxItems) {
                errors[name] = `Select at most ${property.maxItems}.`;
                continue;
            }
            if (selected.length > 0) {
                content[name] = selected;
            }
            continue;
        }

        const text = typeof value === "string" ? value : "";
        if (text.length === 0) {
            if (required.has(name)) {
                errors[name] = "Required.";
            }
            continue;
        }

        if (property.type === "number" || property.type === "integer") {
            const numberValue = Number(text);
            if (!Number.isFinite(numberValue)) {
                errors[name] = "Enter a number.";
                continue;
            }
            if (property.type === "integer" && !Number.isInteger(numberValue)) {
                errors[name] = "Enter an integer.";
                continue;
            }
            content[name] = numberValue;
            continue;
        }

        content[name] = text;
    }

    return Object.keys(errors).length > 0
        ? { ok: false, errors }
        : { ok: true, content };
}

function stringOptions(schema: Extract<ElicitationPropertySchema, { type: "string" }>) {
    if (schema.oneOf) {
        return schema.oneOf.map((option) => ({
            value: option.const,
            label: option.title ?? option.const,
        }));
    }
    if (schema.enum) {
        return schema.enum.map((option) => ({ value: option, label: option }));
    }
    return [];
}

function arrayOptions(schema: Extract<ElicitationPropertySchema, { type: "array" }>) {
    if ("enum" in schema.items) {
        return schema.items.enum.map((option) => ({ value: option, label: option }));
    }

    return schema.items.anyOf.map((option) => ({
        value: option.const,
        label: option.title ?? option.const,
    }));
}

function inputTypeForString(schema: ElicitationPropertySchema) {
    if (schema.type !== "string") return "text";
    if (schema.format === "email") return "email";
    if (schema.format === "uri") return "url";
    if (schema.format === "date") return "date";
    return "text";
}

function parseUrlInfo(url: string): {
    host?: string;
    safe: boolean;
    warning?: string;
} {
    try {
        const parsed = new URL(url);
        const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
        const safe = parsed.protocol === "https:" || localHosts.has(parsed.hostname);
        return {
            host: parsed.host,
            safe,
            warning: safe
                ? undefined
                : "This URL is not HTTPS. Continue only if you trust this local or development endpoint.",
        };
    } catch {
        return {
            safe: false,
            warning: "This URL could not be parsed.",
        };
    }
}

function pluginLabel(elicitation: PluginElicitationPayload): string {
    return elicitation.pluginPrefix
        ? `${elicitation.pluginPrefix} / ${elicitation.pluginId}`
        : elicitation.pluginId;
}
