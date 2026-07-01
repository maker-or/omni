import { memo, useEffect, useMemo, useState } from "react";
import type { HighlighterCore } from "shiki/core";
import { cn } from "@/lib/utils";

interface ShikiCodeBlockProps {
  code: string;
  language?: string;
  isStreaming?: boolean;
}

const highlightedCodeCache = new Map<string, string>();
let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<string>();

const languageLoaders = {
  bash: () => import("shiki/langs/bash.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
};

type SupportedLanguage = keyof typeof languageLoaders;

function loadHighlighter() {
  highlighterPromise ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
  ]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
      langs: [],
    }),
  );

  return highlighterPromise;
}

async function ensureLanguage(highlighter: HighlighterCore, language: string) {
  if (language === "text" || loadedLanguages.has(language)) return language;

  const loadLanguage = languageLoaders[language as SupportedLanguage];
  if (!loadLanguage) return "text";

  await highlighter.loadLanguage(await loadLanguage());
  loadedLanguages.add(language);
  return language;
}

function normalizeLanguage(language: string | undefined): string {
  const normalized = language?.trim().toLowerCase() ?? "";
  if (!normalized) return "text";

  switch (normalized) {
    case "js":
      return "javascript";
    case "ts":
      return "typescript";
    case "sh":
    case "shell":
      return "bash";
    case "yml":
      return "yaml";
    case "md":
      return "markdown";
    default:
      return normalized;
  }
}

function getCacheKey(code: string, language: string) {
  return `${language}\u0000${code}`;
}

async function highlightCode(code: string, language: string): Promise<string> {
  const cacheKey = getCacheKey(code, language);
  const cached = highlightedCodeCache.get(cacheKey);
  if (cached) return cached;

  const highlighter = await loadHighlighter();
  const shikiLanguage = await ensureLanguage(highlighter, language);

  try {
    const html = highlighter.codeToHtml(code, {
      lang: shikiLanguage,
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
    });
    highlightedCodeCache.set(cacheKey, html);
    return html;
  } catch {
    if (language === "text") {
      const html = highlighter.codeToHtml(code, {
        lang: "text",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
        defaultColor: false,
      });
      highlightedCodeCache.set(cacheKey, html);
      return html;
    }

    return highlightCode(code, "text");
  }
}

function PlainCodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-hidden p-3 text-[12px] leading-5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      <code>{code}</code>
    </pre>
  );
}

function ShikiCodeBlockBase({
  code,
  language: languageProp,
  isStreaming = false,
}: ShikiCodeBlockProps) {
  const language = useMemo(() => normalizeLanguage(languageProp), [languageProp]);
  const cacheKey = useMemo(() => getCacheKey(code, language), [code, language]);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(
    () => highlightedCodeCache.get(cacheKey) ?? null,
  );

  useEffect(() => {
    if (isStreaming) {
      setHighlightedHtml(null);
      return;
    }

    const cached = highlightedCodeCache.get(cacheKey);
    if (cached) {
      setHighlightedHtml(cached);
      return;
    }

    let cancelled = false;
    setHighlightedHtml(null);

    highlightCode(code, language)
      .then((html) => {
        if (!cancelled) setHighlightedHtml(html);
      })
      .catch(() => {
        if (!cancelled) setHighlightedHtml(null);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, language, isStreaming]);

  return (
    <div className="group/code my-3 min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-surface-2 shadow-[var(--shadow-1)]">
      <div className="flex h-8 items-center justify-between border-border/70 border-b px-3">
        <span className="font-mono text-[11px] text-muted-foreground lowercase">{language}</span>
      </div>
      <div
        className={cn(
          "min-w-0 max-w-full font-mono text-[12px] leading-5 text-foreground",
          highlightedHtml && "markdown-shiki",
        )}
      >
        {highlightedHtml ? (
          <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <PlainCodeBlock code={code} />
        )}
      </div>
    </div>
  );
}

export const ShikiCodeBlock = memo(
  ShikiCodeBlockBase,
  (prev, next) =>
    prev.code === next.code &&
    prev.language === next.language &&
    prev.isStreaming === next.isStreaming,
);
