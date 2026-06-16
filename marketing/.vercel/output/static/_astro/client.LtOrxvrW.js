const K = {},
  T = "data-astro-transition-persist",
  z = ["data-astro-transition", "data-astro-transition-fallback"],
  I = new Set();
function F(e) {
  const t = e.src ? new URL(e.src, location.href).href : e.textContent;
  return I.has(t) ? !0 : (I.add(t), !1);
}
function H(e) {
  for (const t of e.scripts)
    !t.hasAttribute("data-astro-rerun") && F(t) && (t.dataset.astroExec = "");
}
function _(e) {
  const t = document.documentElement,
    n = [...t.attributes].filter(({ name: o }) => (t.removeAttribute(o), z.includes(o)));
  [...e.documentElement.attributes, ...n].forEach(({ name: o, value: r }) => t.setAttribute(o, r));
}
function C(e) {
  for (const t of Array.from(document.head.children)) {
    const n = J(t, e);
    n ? n.remove() : t.remove();
  }
  document.head.append(...e.head.children);
}
function M(e, t) {
  const n = [],
    o = t.ownerDocument.documentElement,
    r = typeof o.moveBefore == "function" ? (s, i, l) => s.moveBefore(i, l) : null;
  for (const s of t.querySelectorAll(`[${T}]`)) {
    const i = s.getAttribute(T),
      l = e.querySelector(`[${T}="${i}"]`);
    l && (n.push({ old: s, newTarget: l }), r ? r(o, s, null) : o.appendChild(s));
  }
  t.replaceWith(e);
  for (const { old: s, newTarget: i } of n)
    (r ? (r(i.parentNode, s, i), i.remove()) : i.replaceWith(s),
      i.localName === "astro-island" &&
        Q(s) &&
        !Z(s, i) &&
        (s.setAttribute("ssr", ""), s.setAttribute("props", i.getAttribute("props"))));
  B(e);
}
function B(e) {
  e.querySelectorAll("template[shadowrootmode]").forEach((t) => {
    const n = t.getAttribute("shadowrootmode"),
      o = t.parentNode;
    if ((n === "closed" || n === "open") && o instanceof HTMLElement) {
      if (o.shadowRoot) {
        t.remove();
        return;
      }
      const r = o.attachShadow({ mode: n });
      (r.appendChild(t.content), t.remove(), B(r));
    }
  });
}
const Y = () => {
    const e = document.activeElement;
    if (e?.closest(`[${T}]`)) {
      if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) {
        const t = e.selectionStart,
          n = e.selectionEnd;
        return () => E({ activeElement: e, start: t, end: n });
      }
      return () => E({ activeElement: e });
    } else return () => E({ activeElement: null });
  },
  E = ({ activeElement: e, start: t, end: n }) => {
    e &&
      (e.focus(),
      (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) &&
        (typeof t == "number" && (e.selectionStart = t),
        typeof n == "number" && (e.selectionEnd = n)));
  },
  J = (e, t) => {
    const n = e.getAttribute(T),
      o = n && t.head.querySelector(`[${T}="${n}"]`);
    if (o) return o;
    if (e.matches("link[rel=stylesheet]")) {
      const r = e.getAttribute("href");
      return t.head.querySelector(`link[rel=stylesheet][href="${r}"]`);
    }
    if (e.tagName === "STYLE" && e.textContent) {
      const r = t.head.querySelectorAll("style");
      for (const s of r) if (s.textContent === e.textContent) return s;
    }
    if (e.matches("link[rel=preload][as=font]")) {
      const r = e.getAttribute("href");
      return t.head.querySelector(`link[rel=preload][as=font][href="${r}"]`);
    }
    return null;
  },
  Q = (e) => {
    const t = e.dataset.astroTransitionPersistProps;
    return t == null || t === "false";
  },
  Z = (e, t) => e.getAttribute("props") === t.getAttribute("props"),
  fe = {
    deselectScripts: H,
    swapRootAttributes: _,
    swapHeadElements: C,
    swapBodyElement: M,
    saveFocus: Y,
  },
  ee = (e) => {
    (H(e), _(e), C(e));
    const t = Y();
    (M(e.body, document.body), t());
  },
  te = "astro:before-preparation",
  me = "astro:after-preparation",
  he = "astro:before-swap",
  pe = "astro:after-swap",
  we = "astro:page-load",
  R = (e) => document.dispatchEvent(new Event(e)),
  X = () => R("astro:page-load");
class q extends Event {
  from;
  to;
  direction;
  navigationType;
  sourceElement;
  info;
  newDocument;
  signal;
  constructor(t, n, o, r, s, i, l, c, u, w) {
    (super(t, n),
      (this.from = o),
      (this.to = r),
      (this.direction = s),
      (this.navigationType = i),
      (this.sourceElement = l),
      (this.info = c),
      (this.newDocument = u),
      (this.signal = w),
      Object.defineProperties(this, {
        from: { enumerable: !0 },
        to: { enumerable: !0, writable: !0 },
        direction: { enumerable: !0, writable: !0 },
        navigationType: { enumerable: !0 },
        sourceElement: { enumerable: !0 },
        info: { enumerable: !0 },
        newDocument: { enumerable: !0, writable: !0 },
        signal: { enumerable: !0 },
      }));
  }
}
const ye = (e) => e.type === te;
class ne extends q {
  formData;
  loader;
  constructor(t, n, o, r, s, i, l, c, u, w) {
    (super("astro:before-preparation", { cancelable: !0 }, t, n, o, r, s, i, l, c),
      (this.formData = u),
      (this.loader = w.bind(this, this)),
      Object.defineProperties(this, {
        formData: { enumerable: !0 },
        loader: { enumerable: !0, writable: !0 },
      }));
  }
}
const be = (e) => e.type === "astro:before-swap";
class oe extends q {
  direction;
  viewTransition;
  swap;
  constructor(t, n) {
    (super(
      "astro:before-swap",
      void 0,
      t.from,
      t.to,
      t.direction,
      t.navigationType,
      t.sourceElement,
      t.info,
      t.newDocument,
      t.signal,
    ),
      (this.direction = t.direction),
      (this.viewTransition = n),
      (this.swap = () => ee(this.newDocument)),
      Object.defineProperties(this, {
        direction: { enumerable: !0 },
        viewTransition: { enumerable: !0 },
        swap: { enumerable: !0, writable: !0 },
      }));
  }
}
async function re(e, t, n, o, r, s, i, l, c) {
  const u = new ne(e, t, n, o, r, s, window.document, i, l, c);
  return (
    document.dispatchEvent(u) &&
      (await u.loader(),
      u.defaultPrevented ||
        (R("astro:after-preparation"), u.navigationType !== "traverse" && x({ scrollX, scrollY }))),
    u
  );
}
const x = (e) => {
  history.state &&
    ((history.scrollRestoration = "manual"), history.replaceState({ ...history.state, ...e }, ""));
};
async function se(e, t, n) {
  const o = new oe(e, t);
  return (document.dispatchEvent(o), n && (await n()), o.swap(), o);
}
const $ = !!document.startViewTransition,
  P = () => !!document.querySelector('[name="astro-view-transitions-enabled"]'),
  j = (e, t) => e.pathname === t.pathname && e.search === t.search;
let f, y, g;
const ie = () => {
    let e = document.createElement("div");
    (e.setAttribute("aria-live", "assertive"),
      e.setAttribute("aria-atomic", "true"),
      (e.className = "astro-route-announcer"),
      document.body.append(e),
      setTimeout(() => {
        let t = document.title || document.querySelector("h1")?.textContent || location.pathname;
        e.textContent = t;
      }, 60));
  },
  k = "data-astro-transition-persist",
  L = "data-astro-transition",
  S = "data-astro-transition-fallback";
let D,
  v = 0;
history.state
  ? ((v = history.state.index),
    scrollTo({ left: history.state.scrollX, top: history.state.scrollY }))
  : P() &&
    (history.replaceState({ index: v, scrollX, scrollY }, ""),
    (history.scrollRestoration = "manual"));
async function ae(e, t) {
  try {
    const n = new Headers(t?.headers);
    for (const [l, c] of Object.entries(K)) n.set(l, c);
    const o = await fetch(e, { ...t, headers: n }),
      s = (o.headers.get("content-type") ?? "").split(";", 1)[0].trim();
    return s !== "text/html" && s !== "application/xhtml+xml"
      ? null
      : { html: await o.text(), redirected: o.redirected ? o.url : void 0, mediaType: s };
  } catch {
    return null;
  }
}
function W() {
  const e = document.querySelector('[name="astro-view-transitions-fallback"]');
  return e ? e.getAttribute("content") : "animate";
}
function ce() {
  let e = Promise.resolve(),
    t = !1;
  for (const n of document.getElementsByTagName("script"))
    n.dataset.astroExec === void 0 &&
      n.getAttribute("type") === "module" &&
      (t = n.getAttribute("src") === null);
  t &&
    document.body.insertAdjacentHTML(
      "beforeend",
      '<script type="module" src="data:application/javascript,"/>',
    );
  for (const n of document.getElementsByTagName("script")) {
    if (n.dataset.astroExec === "") continue;
    const o = n.getAttribute("type");
    if (o && o !== "module" && o !== "text/javascript") continue;
    const r = document.createElement("script");
    r.innerHTML = n.innerHTML;
    for (const s of n.attributes) {
      if (s.name === "src") {
        const i = new Promise((l) => {
          r.onload = r.onerror = l;
        });
        e = e.then(() => i);
      }
      r.setAttribute(s.name, s.value);
    }
    ((r.dataset.astroExec = ""), n.replaceWith(r));
  }
  return e;
}
const U = (e, t, n, o, r) => {
  const s = j(t, e),
    i = document.title;
  document.title = o;
  let l = !1;
  if (e.href !== location.href && !r)
    if (n.history === "replace") {
      const c = history.state;
      history.replaceState(
        { ...n.state, index: c.index, scrollX: c.scrollX, scrollY: c.scrollY },
        "",
        e.href,
      );
    } else history.pushState({ ...n.state, index: ++v, scrollX: 0, scrollY: 0 }, "", e.href);
  if (
    ((document.title = i),
    (g = e),
    s || (scrollTo({ left: 0, top: 0, behavior: "instant" }), (l = !0)),
    r)
  )
    scrollTo(r.scrollX, r.scrollY);
  else {
    if (e.hash) {
      history.scrollRestoration = "auto";
      const c = history.state;
      ((location.href = e.href),
        history.state ||
          (history.replaceState(c, ""), s && window.dispatchEvent(new PopStateEvent("popstate"))));
    } else l || scrollTo({ left: 0, top: 0, behavior: "instant" });
    history.scrollRestoration = "manual";
  }
};
function le(e) {
  const t = [];
  for (const n of e.querySelectorAll("head link[rel=stylesheet]"))
    if (
      !document.querySelector(
        `[${k}="${n.getAttribute(k)}"], link[rel=stylesheet][href="${n.getAttribute("href")}"]`,
      )
    ) {
      const o = document.createElement("link");
      (o.setAttribute("rel", "preload"),
        o.setAttribute("as", "style"),
        o.setAttribute("href", n.getAttribute("href")),
        t.push(
          new Promise((r) => {
            (["load", "error"].forEach((s) => o.addEventListener(s, r)), document.head.append(o));
          }),
        ));
    }
  return t;
}
async function N(e, t, n, o, r) {
  async function s(u) {
    function w(h) {
      const m = h.effect;
      return !m || !(m instanceof KeyframeEffect) || !m.target
        ? !1
        : window.getComputedStyle(m.target, m.pseudoElement).animationIterationCount === "infinite";
    }
    const d = document.getAnimations();
    document.documentElement.setAttribute(S, u);
    const p = document.getAnimations().filter((h) => !d.includes(h) && !w(h));
    return Promise.allSettled(p.map((h) => h.finished));
  }
  const i = async () => {
      if (r === "animate" && !n.transitionSkipped && !e.signal.aborted)
        try {
          await s("old");
        } catch {}
    },
    l = document.title,
    c = await se(e, n.viewTransition, i);
  (U(c.to, c.from, t, l, o),
    R("astro:after-swap"),
    r === "animate" && !n.transitionSkipped && !c.signal.aborted
      ? s("new").finally(() => n.viewTransitionFinished())
      : n.viewTransitionFinished?.());
}
function ue() {
  return (f?.controller.abort(), (f = { controller: new AbortController() }));
}
async function V(e, t, n, o, r, s = !1) {
  const i = ue();
  if (!P() || location.origin !== n.origin) {
    (i === f && (f = void 0), (location.href = n.href));
    return;
  }
  const l = r ? "traverse" : o.history === "replace" ? "replace" : "push";
  if (
    (l !== "traverse" && x({ scrollX, scrollY }),
    j(t, n) && !o.formData && ((e !== "back" && n.hash) || (e === "back" && t.hash)))
  ) {
    (U(n, t, o, document.title, r), i === f && (f = void 0));
    return;
  }
  const c = await re(t, n, e, l, o.sourceElement, o.info, i.controller.signal, o.formData, u);
  if (c.defaultPrevented || c.signal.aborted) {
    (i === f && (f = void 0), c.signal.aborted || (location.href = n.href));
    return;
  }
  async function u(a) {
    const p = a.to.href,
      h = { signal: a.signal };
    if (a.formData) {
      h.method = "POST";
      const b =
        a.sourceElement instanceof HTMLFormElement
          ? a.sourceElement
          : a.sourceElement instanceof HTMLElement && "form" in a.sourceElement
            ? a.sourceElement.form
            : a.sourceElement?.closest("form");
      h.body =
        t !== void 0 &&
        Reflect.get(HTMLFormElement.prototype, "attributes", b).getNamedItem("enctype")?.value ===
          "application/x-www-form-urlencoded"
          ? new URLSearchParams(a.formData)
          : a.formData;
    }
    const m = await ae(p, h);
    if (m === null) {
      a.preventDefault();
      return;
    }
    if (m.redirected) {
      const b = new URL(m.redirected);
      if (b.origin !== a.to.origin) {
        a.preventDefault();
        return;
      }
      const G = a.to.hash;
      ((a.to = b), (a.to.hash = G));
    }
    if (
      ((D ??= new DOMParser()),
      (a.newDocument = D.parseFromString(m.html, m.mediaType)),
      a.newDocument.querySelectorAll("noscript").forEach((b) => b.remove()),
      !a.newDocument.querySelector('[name="astro-view-transitions-enabled"]') && !a.formData)
    ) {
      a.preventDefault();
      return;
    }
    const A = le(a.newDocument);
    A.length && !a.signal.aborted && (await Promise.all(A));
  }
  async function w() {
    if (y && y.viewTransition) {
      try {
        y.viewTransition.skipTransition();
      } catch {}
      try {
        await y.viewTransition.updateCallbackDone;
      } catch {}
    }
    return (y = { transitionSkipped: !1 });
  }
  const d = await w();
  if (c.signal.aborted) {
    i === f && (f = void 0);
    return;
  }
  if ((document.documentElement.setAttribute(L, c.direction), $ && !s))
    d.viewTransition = document.startViewTransition(async () => await N(c, o, d, r));
  else {
    const a = (async () => {
      (await Promise.resolve(), await N(c, o, d, r, s ? "swap" : W()));
    })();
    d.viewTransition = {
      updateCallbackDone: a,
      ready: a,
      finished: new Promise((p) => (d.viewTransitionFinished = p)),
      skipTransition: () => {
        ((d.transitionSkipped = !0), document.documentElement.removeAttribute(S));
      },
      types: new Set(),
    };
  }
  (d.viewTransition?.updateCallbackDone.finally(async () => {
    (await ce(), X(), ie());
  }),
    d.viewTransition?.finished.finally(() => {
      ((d.viewTransition = void 0),
        d === y && (y = void 0),
        i === f && (f = void 0),
        document.documentElement.removeAttribute(L),
        document.documentElement.removeAttribute(S));
    }));
  try {
    await d.viewTransition?.updateCallbackDone;
  } catch (a) {
    const p = a;
    console.log("[astro]", p.name, p.message, p.stack);
  }
}
async function Te(e, t) {
  await V("forward", g, new URL(e, location.href), t ?? {});
}
function de(e) {
  if (!P() && e.state) {
    location.reload();
    return;
  }
  if (e.state === null) return;
  const t = history.state,
    n = t.index,
    o = n > v ? "forward" : "back";
  ((v = n), V(o, g, new URL(location.href), {}, t, e.hasUAVisualTransition));
}
const O = () => {
  history.state &&
    (scrollX !== history.state.scrollX || scrollY !== history.state.scrollY) &&
    x({ scrollX, scrollY });
};
{
  if ($ || W() !== "none")
    if (
      ((g = new URL(location.href)),
      addEventListener("popstate", de),
      addEventListener("load", X),
      "onscrollend" in window)
    )
      addEventListener("scrollend", O);
    else {
      let e, t, n, o;
      const r = () => {
        if (o !== history.state?.index) {
          (clearInterval(e), (e = void 0));
          return;
        }
        if (t === scrollY && n === scrollX) {
          (clearInterval(e), (e = void 0), O());
          return;
        } else ((t = scrollY), (n = scrollX));
      };
      addEventListener(
        "scroll",
        () => {
          e === void 0 &&
            ((o = history.state?.index),
            (t = scrollY),
            (n = scrollX),
            (e = window.setInterval(r, 50)));
        },
        { passive: !0 },
      );
    }
  for (const e of document.getElementsByTagName("script")) (F(e), (e.dataset.astroExec = ""));
}
export {
  me as TRANSITION_AFTER_PREPARATION,
  pe as TRANSITION_AFTER_SWAP,
  te as TRANSITION_BEFORE_PREPARATION,
  he as TRANSITION_BEFORE_SWAP,
  we as TRANSITION_PAGE_LOAD,
  ne as TransitionBeforePreparationEvent,
  oe as TransitionBeforeSwapEvent,
  ye as isTransitionBeforePreparationEvent,
  be as isTransitionBeforeSwapEvent,
  Te as navigate,
  $ as supportsViewTransitions,
  fe as swapFunctions,
  P as transitionEnabledOnThisPage,
};
