"use client";

import { ChevronDown, ChevronRight, Check, Copy } from "lucide-react";
import { type ReactNode, useState, useRef, useEffect } from "react";

/** An expandable section with icon + title. Used for tool calls, agent-to-agent, etc. */
export function CollapsibleSection({ title, icon, children, defaultOpen = false, className }: {
    title: string;
    icon: ReactNode;
    children: ReactNode;
    defaultOpen?: boolean;
    className?: string;
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className={`rounded-xl border border-border/50 bg-secondary/30 overflow-hidden animate-msg-in ${className || ""}`}>
            <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-secondary/50 transition-colors"
                onClick={() => setIsOpen((o) => !o)}
            >
                {icon}
                <span className="flex-1">{title}</span>
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {isOpen ? <div className="border-t border-border/30 px-3 py-2">{children}</div> : null}
        </div>
    );
}

/** Scrollable preformatted text block for raw tool output. */
export function ScrollableCodeBlock({ text }: { text: string }) {
    return (
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-[hsl(0,0%,10%)] p-3 text-xs text-foreground/90 font-mono">
            {text}
        </pre>
    );
}

/** Renders a list of file download links. */
export function DownloadLinks({ files }: { files: import("@/lib/contracts").DownloadableFile[] }) {
    if (files.length === 0) return null;
    return (
        <div className="mt-2 flex flex-wrap gap-1.5">
            {files.map((file) => (
                <a
                    key={file.fileId}
                    href={file.href}
                    className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                    📎 {file.fileName}
                </a>
            ))}
        </div>
    );
}

/** A small button to copy text to clipboard */
export function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button
            onClick={handleCopy}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Copy to clipboard"
        >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>
    );
}

/** Wraps long text to collapse it by default, with an option to expand */
export function ExpandableMessage({ children, isStreaming = false }: { children: ReactNode; isStreaming?: boolean }) {
    const [isExpanded, setIsExpanded] = useState(isStreaming);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-update expanded state when streaming state changes
    useEffect(() => {
        setIsExpanded(isStreaming);
    }, [isStreaming]);

    useEffect(() => {
        const el = contentRef.current;
        if (!el) return;

        const checkOverflow = () => {
            setIsOverflowing(el.scrollHeight > 160);
        };

        const observer = new ResizeObserver(checkOverflow);
        observer.observe(el);

        checkOverflow();

        return () => {
            observer.disconnect();
        };
    }, []);

    // Check overflow securely whenever children updates
    useEffect(() => {
        if (contentRef.current) {
            setIsOverflowing(contentRef.current.scrollHeight > 160);
        }
    }, [children]);

    return (
        <div className="space-y-1">
            <div
                className={(!isOverflowing || isExpanded) ? "" : "max-h-[160px] overflow-hidden relative"}
            >
                <div
                    ref={contentRef}
                    style={{
                        WebkitMaskImage: (isOverflowing && !isExpanded) ? 'linear-gradient(to bottom, black 60%, transparent 100%)' : 'none',
                        maskImage: (isOverflowing && !isExpanded) ? 'linear-gradient(to bottom, black 60%, transparent 100%)' : 'none'
                    }}
                >
                    {children}
                </div>
            </div>
            {isOverflowing && (
                <button
                    onClick={(e) => {
                        e.preventDefault();
                        setIsExpanded((prev) => !prev);
                    }}
                    type="button"
                    className="text-[11px] font-medium text-emerald-500 hover:text-emerald-400 transition-colors relative z-10 cursor-pointer select-none py-1"
                >
                    {isExpanded ? "Show less" : "Show more"}
                </button>
            )}
        </div>
    );
}
