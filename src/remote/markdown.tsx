import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

/** Lightweight phone markdown: same engine as desktop (GFM + sanitize),
 *  plain <pre> code blocks (no Shiki — keeps the phone bundle small). */

function Code({ className, children }: { className?: string; children?: React.ReactNode }) {
  const text = String(children ?? "").replace(/\n$/, "");
  const isBlock = text.includes("\n") || /language-/.test(className ?? "");
  if (isBlock) {
    return (
      <pre className="md-pre">
        <code>{text}</code>
      </pre>
    );
  }
  return <code className="md-code">{children}</code>;
}

function PhoneMarkdownBase({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          code: Code,
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const PhoneMarkdown = memo(PhoneMarkdownBase);
