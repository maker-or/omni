import { c as createComponent } from "./astro-component_Bvh79D0k.mjs";
import "piccolore";
import {
  I as renderTemplate,
  u as maybeRenderHead,
  bi as defineScriptVars,
} from "./sequence_9Z-GG-XK.mjs";
import { r as renderComponent } from "./entrypoint_Ccz9lNni.mjs";
import { $ as $$Layout } from "./Layout_C8lNXi4Q.mjs";
import { a as clerkClient } from "./index_CxuIVsDj.mjs";
var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) =>
  __freeze(__defProp(cooked, "raw", { value: __freeze(raw || cooked.slice()) }));
var _a;
const $$Complete = createComponent(
  async ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$Complete;
    const { isAuthenticated, userId, redirectToSignIn } = Astro2.locals.auth();
    if (!isAuthenticated) {
      return redirectToSignIn();
    }
    const user = await clerkClient(Astro2).users.getUser(userId);
    const callbackUrl = Astro2.url.searchParams.get("return_to") ?? "";
    const payload = user
      ? {
          providerUserId: user.id,
          email: user.emailAddresses?.[0]?.emailAddress ?? null,
          name: user.fullName ?? user.firstName ?? user.username ?? null,
          avatarUrl: user.imageUrl ?? null,
        }
      : null;
    return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { title: "Completing sign in", "data-astro-cid-n2p7yvsj": true }, { default: async ($$result2) => renderTemplate` ${maybeRenderHead()}<main class="shell" data-astro-cid-n2p7yvsj> <section data-astro-cid-n2p7yvsj> ${payload ? renderTemplate`<p data-astro-cid-n2p7yvsj>Returning you to the Pipper.</p>` : renderTemplate`<p data-astro-cid-n2p7yvsj>Unable to read the Clerk session.</p>`} </section> </main> ${payload && callbackUrl ? renderTemplate(_a || (_a = __template(["<script>(function(){", '\n        const params = new URLSearchParams({\n          userId: payload.providerUserId,\n          email: payload.email ?? "",\n          name: payload.name ?? "",\n          avatarUrl: payload.avatarUrl ?? "",\n        });\n        window.location.replace(`${callbackUrl}?${params.toString()}`);\n      })();<\/script>'], ["<script>(function(){", '\n        const params = new URLSearchParams({\n          userId: payload.providerUserId,\n          email: payload.email ?? "",\n          name: payload.name ?? "",\n          avatarUrl: payload.avatarUrl ?? "",\n        });\n        window.location.replace(\\`\\${callbackUrl}?\\${params.toString()}\\`);\n      })();<\/script>'])), defineScriptVars({ callbackUrl, payload })) : null}` })}`;
  },
  "/Users/harshithpasupuleti/code/omni/marketing/src/pages/auth/complete.astro",
  void 0,
);
const $$file = "/Users/harshithpasupuleti/code/omni/marketing/src/pages/auth/complete.astro";
const $$url = "/auth/complete";
const _page = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      default: $$Complete,
      file: $$file,
      url: $$url,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
const page = () => _page;
export { page };
