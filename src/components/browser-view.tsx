import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  GlobeIcon,
  NewspaperIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { PixelGridLoader } from "@/components/ui/pixel-grid-loader";
import { useBrowserStore, type BrowserTab } from "@/store/browser-store";

/** Partition shared with main (`electron/brief/electron-integration.ts`). */
export const BROWSER_PARTITION = "persist:pipper-browser";

/** The subset of Electron's `WebviewTag` this view uses. */
interface WebviewElement extends HTMLElement {
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  loadURL(url: string): Promise<void>;
  getURL(): string;
}

/** Accept bare hosts ("github.com") and full http(s) URLs; reject everything else. */
export function normalizeAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

interface BrowserViewProps {
  tab: BrowserTab;
  isActive: boolean;
}

/**
 * One tab of Pipper's lightweight embedded browser: a sandboxed `<webview>`
 * plus back/forward/reload and an address field. Every webview attach is
 * hardened in the main process; popups and `target=_blank` links open in the
 * system browser.
 */
export function BrowserView({ tab, isActive }: BrowserViewProps) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const readyRef = useRef(false);
  const lastReloadTokenRef = useRef(tab.reloadToken);
  const setPageInfo = useBrowserStore((state) => state.setPageInfo);
  const [loading, setLoading] = useState(true);
  const [nav, setNav] = useState({ back: false, forward: false });
  const [address, setAddress] = useState(tab.currentUrl);
  const [editing, setEditingState] = useState(false);
  // Read by navigation listeners without re-subscribing on every keystroke.
  const editingRef = useRef(false);
  const setEditing = (value: boolean) => {
    editingRef.current = value;
    setEditingState(value);
  };
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    const syncNav = () => {
      if (!readyRef.current) return;
      setNav({ back: webview.canGoBack(), forward: webview.canGoForward() });
    };
    const onNavigate = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (url) {
        setPageInfo(tab.id, { url });
        if (!editingRef.current) setAddress(url);
      }
      setFailure(null);
      syncNav();
    };
    const onTitle = (event: Event) => {
      const title = (event as Event & { title?: string }).title;
      if (title) setPageInfo(tab.id, { title });
    };
    const onStart = () => setLoading(true);
    const onStop = () => {
      setLoading(false);
      syncNav();
    };
    const onReady = () => {
      readyRef.current = true;
      syncNav();
    };
    const onFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      // -3 is ERR_ABORTED (superseded navigation) — not a user-facing failure.
      if (detail.isMainFrame && detail.errorCode !== -3) {
        setFailure(detail.errorDescription || "The page could not be loaded.");
      }
    };
    webview.addEventListener("did-navigate", onNavigate);
    webview.addEventListener("did-navigate-in-page", onNavigate);
    webview.addEventListener("page-title-updated", onTitle);
    webview.addEventListener("did-start-loading", onStart);
    webview.addEventListener("did-stop-loading", onStop);
    webview.addEventListener("dom-ready", onReady);
    webview.addEventListener("did-fail-load", onFail);
    return () => {
      webview.removeEventListener("did-navigate", onNavigate);
      webview.removeEventListener("did-navigate-in-page", onNavigate);
      webview.removeEventListener("page-title-updated", onTitle);
      webview.removeEventListener("did-start-loading", onStart);
      webview.removeEventListener("did-stop-loading", onStop);
      webview.removeEventListener("dom-ready", onReady);
      webview.removeEventListener("did-fail-load", onFail);
    };
  }, [tab.id, setPageInfo]);

  // External reloads (a fresh brief is ready, the brief was re-opened).
  useEffect(() => {
    if (tab.reloadToken === lastReloadTokenRef.current) return;
    lastReloadTokenRef.current = tab.reloadToken;
    const webview = webviewRef.current;
    if (!webview || !readyRef.current) return;
    setFailure(null);
    void webview.loadURL(tab.url).catch(() => {});
  }, [tab.reloadToken, tab.url]);

  const isBrief = tab.kind === "brief";
  const isHttp = /^https?:/i.test(tab.currentUrl);

  const navigate = (value: string) => {
    const url = normalizeAddress(value);
    const webview = webviewRef.current;
    if (!url || !webview || !readyRef.current) return;
    setEditing(false);
    setAddress(url);
    void webview.loadURL(url).catch(() => {});
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md border border-border/60 bg-surface-1">
      <div
        className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-1.5"
        data-pipper-id={`browser-toolbar-${tab.id}`}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          disabled={!nav.back}
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Forward"
          disabled={!nav.forward}
          onClick={() => webviewRef.current?.goForward()}
        >
          <ArrowRightIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reload"
          onClick={() => {
            setFailure(null);
            webviewRef.current?.reload();
          }}
        >
          <ArrowClockwiseIcon />
        </Button>
        <form
          className="mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(address);
          }}
        >
          {loading ? (
            <PixelGridLoader size={12} className="shrink-0" />
          ) : isBrief && !isHttp ? (
            <NewspaperIcon weight="duotone" className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <GlobeIcon weight="duotone" className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <input
            value={isBrief && !isHttp && !editing ? "Morning Brief" : address}
            onFocus={(event) => {
              setEditing(true);
              if (isBrief && !isHttp) setAddress("");
              requestAnimationFrame(() => event.target.select());
            }}
            onBlur={() => {
              setEditing(false);
              setAddress(tab.currentUrl);
            }}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Enter a URL"
            aria-label="Address"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </form>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open in your browser"
          title="Open in your browser"
          disabled={!isHttp}
          onClick={() => void window.omni.shell.openExternal(tab.currentUrl)}
        >
          <ArrowSquareOutIcon />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <webview
          ref={(node) => {
            webviewRef.current = node as unknown as WebviewElement | null;
          }}
          src={tab.url}
          partition={BROWSER_PARTITION}
          // React only forwards unknown attributes as strings; Electron reads
          // presence. Needed so target=_blank reaches the main-process
          // window-open handler (which opens the system browser).
          {...({ allowpopups: "true" } as object)}
          className="absolute inset-0 h-full w-full bg-surface-1"
          style={{ display: "flex" }}
          aria-hidden={!isActive}
          data-pipper-id={`browser-webview-${tab.id}`}
        />
        {failure && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-1 text-center">
            <GlobeIcon weight="duotone" className="size-6 text-muted-foreground" />
            <div className="text-[13px] font-medium text-foreground">This page didn't load</div>
            <div className="max-w-sm text-[12px] text-muted-foreground">{failure}</div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFailure(null);
                webviewRef.current?.reload();
              }}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
