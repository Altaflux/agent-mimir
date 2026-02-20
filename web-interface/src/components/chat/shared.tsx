"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { ReactNode, useState } from "react";

/** An expandable section with icon + title. Used for tool calls, agent-to-agent, etc. */
export function CollapsibleSection({ title, icon, children, defaultOpen = false }: {
    title: string;
    icon: ReactNode;
    children: ReactNode;
    defaultOpen?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="rounded-xl border border-border/50 bg-secondary/30 overflow-hidden animate-msg-in">
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
