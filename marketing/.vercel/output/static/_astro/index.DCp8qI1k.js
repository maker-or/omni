import { c as y, d as f, e as N, f as Y } from "./external-DHTxQaok.BzGBULKT.js";
const q = [
    ".lcl.dev",
    ".stg.dev",
    ".lclstage.dev",
    ".stgstage.dev",
    ".dev.lclclerk.com",
    ".stg.lclclerk.com",
    ".accounts.lclclerk.com",
    "accountsstage.dev",
    "accounts.dev",
  ],
  I = (e) =>
    typeof atob < "u" && typeof atob == "function"
      ? atob(e)
      : typeof globalThis.Buffer < "u"
        ? globalThis.Buffer.from(e, "base64").toString()
        : e,
  P = "pk_live_",
  H = "pk_test_";
function A(e) {
  if (!e.endsWith("$")) return !1;
  const r = e.slice(0, -1);
  return r.includes("$") ? !1 : r.includes(".");
}
function b(e, r = {}) {
  if (((e = e || ""), !e || !E(e))) {
    if (r.fatal && !e)
      throw new Error(
        "Publishable key is missing. Ensure that your publishable key is correctly configured. Double-check your environment configuration for your keys, or access them here: https://dashboard.clerk.com/last-active?path=api-keys",
      );
    if (r.fatal && !E(e)) throw new Error("Publishable key not valid.");
    return null;
  }
  const t = e.startsWith(P) ? "production" : "development";
  let n;
  try {
    n = I(e.split("_")[2]);
  } catch {
    if (r.fatal) throw new Error("Publishable key not valid: Failed to decode key.");
    return null;
  }
  if (!A(n)) {
    if (r.fatal) throw new Error("Publishable key not valid: Decoded key has invalid format.");
    return null;
  }
  let i = n.slice(0, -1);
  return (
    r.proxyUrl
      ? (i = r.proxyUrl)
      : t !== "development" && r.domain && r.isSatellite && (i = `clerk.${r.domain}`),
    { instanceType: t, frontendApi: i }
  );
}
function E(e = "") {
  try {
    if (!(e.startsWith(P) || e.startsWith(H))) return !1;
    const r = e.split("_");
    if (r.length !== 3) return !1;
    const t = r[2];
    return t ? A(I(t)) : !1;
  } catch {
    return !1;
  }
}
function G() {
  const e = new Map();
  return {
    isDevOrStagingUrl: (r) => {
      if (!r) return !1;
      const t = typeof r == "string" ? r : r.hostname;
      let n = e.get(t);
      return (n === void 0 && ((n = q.some((i) => t.endsWith(i))), e.set(t, n)), n);
    },
  };
}
function _(e) {
  return !1;
}
var X = class K extends Error {
    static kind = "ClerkError";
    clerkError = !0;
    code;
    longMessage;
    docsUrl;
    cause;
    get name() {
      return this.constructor.name;
    }
    constructor(r) {
      (super(new.target.formatMessage(new.target.kind, r.message, r.code, r.docsUrl), {
        cause: r.cause,
      }),
        Object.setPrototypeOf(this, K.prototype),
        (this.code = r.code),
        (this.docsUrl = r.docsUrl),
        (this.longMessage = r.longMessage),
        (this.cause = r.cause));
    }
    toString() {
      return `[${this.name}]
Message:${this.message}`;
    }
    static formatMessage(r, t, n, i) {
      const s = "Clerk:",
        o = new RegExp(s.replace(" ", "\\s*"), "i");
      return (
        (t = t.replace(o, "")),
        (t = `${s} ${t.trim()}

(code="${n}")

`),
        i &&
          (t += `

Docs: ${i}`),
        t
      );
    }
  },
  R = class M extends X {
    static kind = "ClerkRuntimeError";
    clerkRuntimeError = !0;
    constructor(r, t) {
      (super({ ...t, message: r }), Object.setPrototypeOf(this, M.prototype));
    }
  };
const Z = Object.freeze({
  InvalidProxyUrlErrorMessage:
    "The proxyUrl passed to Clerk is invalid. The expected value for proxyUrl is an absolute URL or a relative path with a leading '/'. (key={{url}})",
  InvalidPublishableKeyErrorMessage:
    "The publishableKey passed to Clerk is invalid. You can get your Publishable key at https://dashboard.clerk.com/last-active?path=api-keys. (key={{key}})",
  MissingPublishableKeyErrorMessage:
    "Missing publishableKey. You can get your key at https://dashboard.clerk.com/last-active?path=api-keys.",
  MissingSecretKeyErrorMessage:
    "Missing secretKey. You can get your key at https://dashboard.clerk.com/last-active?path=api-keys.",
  MissingClerkProvider:
    "{{source}} can only be used within the <ClerkProvider /> component. Learn more: https://clerk.com/docs/components/clerk-provider",
});
function Q({ packageName: e, customMessages: r }) {
  let t = e;
  function n(s, o) {
    if (!o) return `${t}: ${s}`;
    let c = s;
    const l = s.matchAll(/{{([a-zA-Z0-9-_]+)}}/g);
    for (const u of l) {
      const a = (o[u[1]] || "").toString();
      c = c.replace(`{{${u[1]}}}`, a);
    }
    return `${t}: ${c}`;
  }
  const i = { ...Z, ...r };
  return {
    setPackageName({ packageName: s }) {
      return (typeof s == "string" && (t = s), this);
    },
    setMessages({ customMessages: s }) {
      return (Object.assign(i, s || {}), this);
    },
    throwInvalidPublishableKeyError(s) {
      throw new Error(n(i.InvalidPublishableKeyErrorMessage, s));
    },
    throwInvalidProxyUrl(s) {
      throw new Error(n(i.InvalidProxyUrlErrorMessage, s));
    },
    throwMissingPublishableKeyError() {
      throw new Error(n(i.MissingPublishableKeyErrorMessage));
    },
    throwMissingSecretKeyError() {
      throw new Error(n(i.MissingSecretKeyErrorMessage));
    },
    throwMissingClerkProviderError(s) {
      throw new Error(n(i.MissingClerkProvider, s));
    },
    throw(s) {
      throw new Error(n(s));
    },
  };
}
const ee = {
    initialDelay: 125,
    maxDelayBetweenRetries: 0,
    factor: 2,
    shouldRetry: (e, r) => r < 5,
    retryImmediately: !1,
    jitter: !0,
  },
  re = 100,
  T = async (e) => new Promise((r) => setTimeout(r, e)),
  x = (e, r) => (r ? e * (1 + Math.random()) : e),
  te = (e) => {
    let r = 0;
    const t = () => {
      const n = e.initialDelay,
        i = e.factor;
      let s = n * Math.pow(i, r);
      return ((s = x(s, e.jitter)), Math.min(e.maxDelayBetweenRetries || s, s));
    };
    return async () => {
      (await T(t()), r++);
    };
  },
  ne = async (e, r = {}) => {
    let t = 0;
    const {
        shouldRetry: n,
        initialDelay: i,
        maxDelayBetweenRetries: s,
        factor: o,
        retryImmediately: c,
        jitter: l,
        onBeforeRetry: u,
      } = { ...ee, ...r },
      a = te({ initialDelay: i, maxDelayBetweenRetries: s, factor: o, jitter: l });
    for (;;)
      try {
        return await e();
      } catch (d) {
        if ((t++, !n(d, t))) throw d;
        (u && (await u(t)), c && t === 1 ? await T(x(re, l)) : await a());
      }
  },
  ie = "loadScript cannot be called when document does not exist",
  se = "loadScript cannot be called without a src";
async function $(e = "", r) {
  const { async: t, defer: n, beforeLoad: i, crossOrigin: s, nonce: o } = r || {};
  return ne(
    () =>
      new Promise((l, u) => {
        (e || u(new Error(se)), (!document || !document.body) && u(new Error(ie)));
        const a = document.createElement("script");
        (s && a.setAttribute("crossorigin", s),
          (a.async = t || !1),
          (a.defer = n || !1),
          a.addEventListener("load", () => {
            (a.remove(), l(a));
          }),
          a.addEventListener("error", (d) => {
            (a.remove(), u(d.error ?? new Error(`failed to load script: ${e}`)));
          }),
          (a.src = e),
          o && (a.nonce = o),
          i?.(a),
          document.body.appendChild(a));
      }),
    { shouldRetry: (l, u) => u <= 5 },
  );
}
function oe(e) {
  return e ? ae(e) || h(e) : !0;
}
function ae(e) {
  return /^http(s)?:\/\//.test(e || "");
}
function h(e) {
  return e.startsWith("/");
}
function le(e) {
  return e
    ? !h(e) || typeof window > "u" || !window.location?.origin
      ? e
      : new URL(e, window.location.origin).toString()
    : "";
}
function ce(e) {
  if (!e) return "";
  let r;
  if (e.match(/^(clerk\.)+\w*$/)) r = /(clerk\.)*(?=clerk\.)/;
  else {
    if (e.match(/\.clerk.accounts/)) return e;
    r = /^(clerk\.)*/gi;
  }
  return `clerk.${e.replace(r, "")}`;
}
const O = (e, r = "6.16.1") => {
    if (e) return e;
    const t = ue(r);
    return t ? (t === "snapshot" ? r : t) : de(r);
  },
  ue = (e) =>
    e
      .trim()
      .replace(/^v/, "")
      .match(/-(.+?)(\.|$)/)?.[1],
  de = (e) => e.trim().replace(/^v/, "").split(".")[0],
  { isDevOrStagingUrl: fe } = G(),
  S = Q({ packageName: "@clerk/shared" });
function L(e) {
  return typeof window > "u" || !window[e] ? !1 : !!window[e];
}
const w = () => L("Clerk"),
  U = () => L("__internal_ClerkUICtor");
function D(e) {
  if (typeof window > "u" || !window.performance) return !1;
  const r = performance.getEntriesByName(e, "resource");
  if (r.length === 0) return !1;
  const t = r[r.length - 1];
  return (
    t.transferSize === 0 &&
    t.decodedBodySize === 0 &&
    (t.responseEnd === 0 ||
      (t.responseEnd > 0 && t.responseStart > 0) ||
      ("responseStatus" in t && (t.responseStatus >= 400 || t.responseStatus === 0)))
  );
}
const he = async (e) => {
    const r = e?.scriptLoadTimeout ?? 15e3,
      t = (o) =>
        new R("Failed to load Clerk JS" + (o?.message ? `, ${o.message}` : ""), {
          code: "failed_to_load_clerk_js",
          cause: o,
        });
    if (w()) return null;
    if (!e?.publishableKey) return (S.throwMissingPublishableKeyError(), null);
    const n = pe(e),
      i = document.querySelector("script[data-clerk-js-script]");
    if (i)
      if (D(n)) i.remove();
      else
        try {
          return (await p(r, w, t(), i), null);
        } catch {
          i.remove();
        }
    const s = p(r, w, t());
    return (
      $(n, { async: !0, crossOrigin: "anonymous", nonce: e.nonce, beforeLoad: j(J(e)) }).catch(
        (o) => {
          throw t(o);
        },
      ),
      s
    );
  },
  ye = async (e) => {
    const r = e?.scriptLoadTimeout ?? 15e3,
      t = (o) =>
        new R("Failed to load Clerk UI" + (o?.message ? `, ${o.message}` : ""), {
          code: "failed_to_load_clerk_ui",
          cause: o,
        });
    if (U()) return null;
    if (!e?.publishableKey) return (S.throwMissingPublishableKeyError(), null);
    const n = me(e),
      i = document.querySelector("script[data-clerk-ui-script]");
    if (i)
      if (D(n)) i.remove();
      else
        try {
          return (await p(r, U, t(), i), null);
        } catch {
          i.remove();
        }
    const s = p(r, U, t());
    return (
      $(n, { async: !0, crossOrigin: "anonymous", nonce: e.nonce, beforeLoad: j(ke(e)) }).catch(
        (o) => {
          throw t(o);
        },
      ),
      s
    );
  },
  pe = (e) => {
    const {
      __internal_clerkJSUrl: r,
      __internal_clerkJSVersion: t,
      proxyUrl: n,
      domain: i,
      publishableKey: s,
    } = e;
    if (r) return r;
    const o = O(t);
    return n && h(n)
      ? B(n, "clerk-js", o, "clerk.browser.js")
      : `https://${W({ publishableKey: s, proxyUrl: n, domain: i })}/npm/@clerk/clerk-js@${o}/dist/clerk.browser.js`;
  },
  me = (e) => {
    const {
      __internal_clerkUIUrl: r,
      __internal_clerkUIVersion: t,
      proxyUrl: n,
      domain: i,
      publishableKey: s,
    } = e;
    if (r) return r;
    const o = O(t, "1.16.1");
    return n && h(n)
      ? B(n, "ui", o, "ui.browser.js")
      : `https://${W({ publishableKey: s, proxyUrl: n, domain: i })}/npm/@clerk/ui@${o}/dist/ui.browser.js`;
  },
  J = (e) => {
    const r = {};
    return (
      e.publishableKey && (r["data-clerk-publishable-key"] = e.publishableKey),
      e.proxyUrl && (r["data-clerk-proxy-url"] = e.proxyUrl),
      e.domain && (r["data-clerk-domain"] = e.domain),
      e.nonce && (r.nonce = e.nonce),
      r
    );
  },
  ke = (e) => J(e),
  j = (e) => (r) => {
    for (const t in e) r.setAttribute(t, e[t]);
  },
  ge = (e) => {
    for (; e.endsWith("/"); ) e = e.slice(0, -1);
    return e;
  },
  B = (e, r, t, n) => `${ge(e)}/npm/@clerk/${r}@${t}/dist/${n}`,
  W = (e) => {
    const { proxyUrl: r, domain: t, publishableKey: n } = e;
    if (r && oe(r)) {
      const i = le(r);
      return h(i) ? b(n)?.frontendApi || "" : i.replace(/http(s)?:\/\//, "");
    } else return t && !fe(b(n)?.frontendApi || "") ? ce(t) : b(n)?.frontendApi || "";
  };
function p(e, r, t, n) {
  return new Promise((i, s) => {
    let o = !1;
    const c = (m, k) => {
      (clearTimeout(m), clearInterval(k));
    };
    n?.addEventListener("error", () => {
      (c(a, d), s(t));
    });
    const l = () => {
        o || (r() && ((o = !0), c(a, d), i(null)));
      },
      a = setTimeout(() => {
        o || ((o = !0), c(a, d), r() ? i(null) : s(t));
      }, e);
    l();
    const d = setInterval(() => {
      if (o) {
        clearInterval(d);
        return;
      }
      l();
    }, 100);
  });
}
function be(e) {
  S.setPackageName({ packageName: e });
}
const V = () => {
    ["handleRedirectCallback"].forEach((e) => {
      document.querySelectorAll(`[data-clerk-function-id^="clerk-${e}"]`).forEach((r) => {
        const t = r.getAttribute("data-clerk-function-id"),
          n = window.__astro_clerk_function_props?.get(e)?.get(t) ?? {};
        y.get()?.[e]?.(n);
      });
    });
  },
  z = () => {
    Object.entries({
      "create-organization": "mountCreateOrganization",
      "organization-list": "mountOrganizationList",
      "organization-profile": "mountOrganizationProfile",
      "organization-switcher": "mountOrganizationSwitcher",
      "user-avatar": "mountUserAvatar",
      "user-button": "mountUserButton",
      "user-profile": "mountUserProfile",
      "sign-in": "mountSignIn",
      "sign-up": "mountSignUp",
      "google-one-tap": "openGoogleOneTap",
      waitlist: "mountWaitlist",
      "pricing-table": "mountPricingTable",
      "api-keys": "mountAPIKeys",
    }).forEach(([e, r]) => {
      document.querySelectorAll(`[data-clerk-id^="clerk-${e}"]`).forEach((t) => {
        const n = t.getAttribute("data-clerk-id"),
          i = window.__astro_clerk_component_props?.get(e)?.get(n);
        t && y.get()?.[r](t, i);
      });
    });
  },
  _e = (e) => {
    let r = !1;
    return (t) => {
      if (r) {
        const n = window.Clerk;
        return new Promise((i) => (n ? (n.loaded && (z(), V()), i(n.loaded)) : i(!1)));
      }
      return ((r = !0), e(t));
    };
  };
be("@clerk/astro");
function C(e) {
  return (r, t) => {
    t?.__internal_metadata?.navigationType === "internal"
      ? e(history.state, "", r)
      : t?.windowNavigate(r);
  };
}
const we = _e(Ue);
async function Ue(e) {
  const r = Se(e),
    t = Ee(e);
  if ((await r, !window.Clerk))
    throw new Error("Failed to download latest ClerkJS. Contact support@clerk.com.");
  const n = window.Clerk;
  y.get() || y.set(n);
  const i = e,
    s = i.__internal_keylessClaimUrl,
    o = i.__internal_keylessApiKeysUrl,
    c = {
      routerPush: C(window.history.pushState.bind(window.history)),
      routerReplace: C(window.history.replaceState.bind(window.history)),
      ...e,
      ui: { ...e?.ui, ClerkUI: t },
      ...(s && { __internal_keyless_claimKeylessApplicationUrl: s }),
      ...(o && { __internal_keyless_copyInstanceKeysUrl: o }),
    };
  return n
    .load(c)
    .then(() => {
      (f.setKey("isLoaded", !0),
        N.notify(),
        z(),
        V(),
        n.addListener((l) => {
          (f.setKey("client", l.client),
            f.setKey("user", l.user),
            f.setKey("session", l.session),
            f.setKey("organization", l.organization));
        }));
    })
    .catch(() => {});
}
async function Se(e) {
  await he(e);
}
async function Ee(e) {
  if (e?.ui?.ClerkUI) return e.ui.ClerkUI;
  if (!(e?.ui || e?.prefetchUI === !1)) {
    if ((await ye(e), !window.__internal_ClerkUICtor))
      throw new Error("Failed to download latest Clerk UI. Contact support@clerk.com.");
    return window.__internal_ClerkUICtor;
  }
}
function Ce(e) {
  if (e === !1) return !1;
}
const ve = (e) => {
  const {
      signInUrl: r,
      signUpUrl: t,
      isSatellite: n,
      proxyUrl: i,
      domain: s,
      publishableKey: o,
      telemetry: c,
      __internal_clerkJSUrl: l,
      __internal_clerkJSVersion: u,
      __internal_clerkUIUrl: a,
      __internal_clerkUIVersion: d,
      prefetchUI: m,
      unsafe_disableDevelopmentModeConsoleWarning: k,
      ...F
    } = e || {},
    g = e;
  return {
    signInUrl: r || void 0,
    signUpUrl: t || void 0,
    isSatellite: n || void 0,
    proxyUrl: i || void 0,
    domain: s || void 0,
    publishableKey:
      o || g?.publishableKey || "pk_test_c3dlZXBpbmctbW90aC01Mi5jbGVyay5hY2NvdW50cy5kZXYk",
    __internal_clerkJSUrl: l || void 0,
    __internal_clerkJSVersion: u || void 0,
    __internal_clerkUIUrl: a || void 0,
    __internal_clerkUIVersion: d || void 0,
    prefetchUI: Ce(m),
    telemetry: c || { disabled: _(), debug: _() },
    unsafe_disableDevelopmentModeConsoleWarning: k ?? _(),
    __internal_keylessClaimUrl: g?.keylessClaimUrl,
    __internal_keylessApiKeysUrl: g?.keylessApiKeysUrl,
    ...F,
  };
};
function Ie(e) {
  async function r(t) {
    const n = document.getElementById("__CLERK_ASTRO_DATA__");
    n && Y.set(JSON.parse(n.textContent || "{}"));
    const i = document.getElementById("__CLERK_ASTRO_SAFE_VARS__");
    let s = {};
    (i && (s = JSON.parse(i.textContent || "{}")), await e({ ...ve({ ...t, ...s }) }));
  }
  return r;
}
const v = "data-astro-transition-persist",
  Pe = "data-emotion";
function Me(e, r) {
  (e.deselectScripts(r), e.swapRootAttributes(r));
  const t = document.querySelectorAll(`style[${Pe}]`);
  Ae(r, Array.from(t));
  const n = e.saveFocus();
  (e.swapBodyElement(r.body, document.body), n());
}
function Ae(e, r) {
  for (const t of Array.from(document.head.children)) {
    const n = Ke(t, e);
    n ? n.remove() : r.includes(t) || t.remove();
  }
  document.head.append(...e.head.children);
}
function Ke(e, r) {
  const t = e.getAttribute(v),
    n = t && r.head.querySelector(`[${v}="${t}"]`);
  if (n) return n;
  if (e.matches("link[rel=stylesheet]")) {
    const i = e.getAttribute("href");
    return r.head.querySelector(`link[rel=stylesheet][href="${i}"]`);
  }
  return null;
}
const Te = Ie(we);
export { Te as r, Me as s };
