import { s as w, r as m } from "./index.DCp8qI1k.js";
const E = (function () {
    const n = typeof document < "u" && document.createElement("link").relList;
    return n && n.supports && n.supports("modulepreload") ? "modulepreload" : "preload";
  })(),
  y = function (a) {
    return "/" + a;
  },
  p = {},
  k = function (n, e, u) {
    let d = Promise.resolve();
    if (e && e.length > 0) {
      let f = function (t) {
        return Promise.all(
          t.map((c) =>
            Promise.resolve(c).then(
              (l) => ({ status: "fulfilled", value: l }),
              (l) => ({ status: "rejected", reason: l }),
            ),
          ),
        );
      };
      document.getElementsByTagName("link");
      const s = document.querySelector("meta[property=csp-nonce]"),
        r = s?.nonce || s?.getAttribute("nonce");
      d = f(
        e.map((t) => {
          if (((t = y(t)), t in p)) return;
          p[t] = !0;
          const c = t.endsWith(".css"),
            l = c ? '[rel="stylesheet"]' : "";
          if (document.querySelector(`link[href="${t}"]${l}`)) return;
          const o = document.createElement("link");
          if (
            ((o.rel = c ? "stylesheet" : E),
            c || (o.as = "script"),
            (o.crossOrigin = ""),
            (o.href = t),
            r && o.setAttribute("nonce", r),
            document.head.appendChild(o),
            c)
          )
            return new Promise((h, v) => {
              (o.addEventListener("load", h),
                o.addEventListener("error", () => v(new Error(`Unable to preload CSS for ${t}`))));
            });
        }),
      );
    }
    function i(s) {
      const r = new Event("vite:preloadError", { cancelable: !0 });
      if (((r.payload = s), window.dispatchEvent(r), !r.defaultPrevented)) throw s;
    }
    return d.then((s) => {
      for (const r of s || []) r.status === "rejected" && i(r.reason);
      return n().catch(i);
    });
  },
  P = () => !!document.querySelector('[name="astro-view-transitions-enabled"]');
if (P()) {
  const a = k(() => import("./client.LtOrxvrW.js"), []);
  (document.addEventListener("astro:before-swap", async (n) => {
    const e = n.newDocument,
      u = e?.head;
    if (!e || !u) return;
    const { swapFunctions: d } = await a;
    n.swap = () => {
      const i = document.querySelector("#clerk-components");
      (i && e.body.appendChild(i), w(d, e));
    };
  }),
    document.addEventListener("astro:page-load", async (n) => {
      const { navigate: e } = await a;
      await m({
        sdkMetadata: { version: "3.4.2", name: "@clerk/astro", environment: "production" },
        routerPush: e,
        routerReplace: (u) => e(u, { history: "replace" }),
      });
    }));
} else
  await m({ sdkMetadata: { version: "3.4.2", name: "@clerk/astro", environment: "production" } });
