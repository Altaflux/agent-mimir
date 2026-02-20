"use client";

import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const CHAT_MARKDOWN_CLASS =
    "prose prose-sm prose-invert max-w-none break-words text-foreground " +
    "prose-headings:my-2 prose-p:my-1 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 " +
    "prose-pre:my-2 prose-pre:max-h-96 prose-pre:overflow-auto prose-pre:rounded-lg prose-pre:bg-[hsl(0,0%,10%)] prose-pre:p-0 " +
    "prose-code:before:content-none prose-code:after:content-none";

const markdownComponents: Components = {
    table: ({ children, ...props }) => (
        <div className="my-2 overflow-x-auto rounded-lg border border-border/50">
            <table className="min-w-full text-sm" {...props}>{children}</table>
        </div>
    ),
    thead: ({ children, ...props }) => (
        <thead className="bg-secondary/60 text-left text-xs font-medium text-muted-foreground" {...props}>{children}</thead>
    ),
    th: ({ children, ...props }) => (
        <th className="px-3 py-2 font-semibold" {...props}>{children}</th>
    ),
    td: ({ children, ...props }) => (
        <td className="border-t border-border/30 px-3 py-2" {...props}>{children}</td>
    ),
    tr: ({ children, ...props }) => (
        <tr className="transition-colors hover:bg-secondary/30" {...props}>{children}</tr>
    ),
    code: ({ className, children, ...props }) => {
        const isBlock = /language-(\w+)/.test(className || "");
        if (isBlock) {
            return (
                <code className={`block rounded-lg bg-[hsl(0,0%,10%)] p-4 text-xs font-mono overflow-auto ${className || ""}`} {...props}>
                    {children}
                </code>
            );
        }
        return (
            <code className="rounded-md bg-[hsl(0,0%,18%)] px-1.5 py-0.5 text-[0.85em] font-mono" {...props}>
                {children}
            </code>
        );
    },
    a: ({ children, ...props }) => (
        <a className="text-blue-400 underline underline-offset-2 hover:text-blue-300 transition-colors" target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
    ),
    blockquote: ({ children, ...props }) => (
        <blockquote className="border-l-2 border-muted-foreground/40 pl-4 italic text-muted-foreground" {...props}>{children}</blockquote>
    ),
    hr: (props) => (
        <hr className="my-4 border-border/40" {...props} />
    ),
};

/** Renders markdown content with GFM support and custom-styled elements. */
export function MarkdownContent({ children }: { children: string }) {
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} className={CHAT_MARKDOWN_CLASS} components={markdownComponents}>
            {children}
        </ReactMarkdown>
    );
}
