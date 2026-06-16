import { c as createComponent } from "./astro-component_Bvh79D0k.mjs";
import "piccolore";
import {
  I as renderTemplate,
  bi as defineScriptVars,
  bg as unescapeHTML,
  F as Fragment,
  u as maybeRenderHead,
  _ as addAttribute,
  bj as renderSlot,
} from "./sequence_9Z-GG-XK.mjs";
import { r as renderComponent, s as spreadAttributes } from "./entrypoint_Ccz9lNni.mjs";
import { $ as $$Layout } from "./Layout_C8lNXi4Q.mjs";
import { g as generateSafeId } from "./index_CAl4q2AK.mjs";
function addUnstyledAttributeToFirstTag(html, attributeValue) {
  return html.replace(/(<[^>]+)>/, `$1 data-clerk-unstyled-id="${attributeValue}">`);
}
var __freeze$1 = Object.freeze;
var __defProp$1 = Object.defineProperty;
var __template$1 = (cooked, raw) =>
  __freeze$1(__defProp$1(cooked, "raw", { value: __freeze$1(raw || cooked.slice()) }));
var _a$1;
const $$SignInButton = createComponent(
  async ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$SignInButton;
    const safeId = generateSafeId();
    const {
      asChild,
      forceRedirectUrl,
      fallbackRedirectUrl,
      signUpFallbackRedirectUrl,
      signUpForceRedirectUrl,
      mode,
      ...props
    } = Astro2.props;
    const signInOptions = {
      forceRedirectUrl,
      fallbackRedirectUrl,
      signUpFallbackRedirectUrl,
      signUpForceRedirectUrl,
    };
    let htmlElement = "";
    if (asChild) {
      htmlElement = await Astro2.slots.render("default");
      htmlElement = addUnstyledAttributeToFirstTag(htmlElement, safeId);
    }
    return renderTemplate(
      _a$1 ||
        (_a$1 = __template$1(
          [
            "",
            "<script>(function(){",
            "\n  const btn = document.querySelector(`[data-clerk-unstyled-id=\"${safeId}\"]`);\n\n  btn.addEventListener('click', () => {\n    const clerk = window.Clerk;\n\n    if (mode === 'modal') {\n      return clerk.openSignIn({ ...signInOptions, appearance: props.appearance });\n    }\n\n    return clerk.redirectToSignIn({\n      ...signInOptions,\n      signInFallbackRedirectUrl: signInOptions.fallbackRedirectUrl,\n      signInForceRedirectUrl: signInOptions.forceRedirectUrl,\n    });\n  });\n})();<\/script>",
          ],
          [
            "",
            "<script>(function(){",
            "\n  const btn = document.querySelector(\\`[data-clerk-unstyled-id=\"\\${safeId}\"]\\`);\n\n  btn.addEventListener('click', () => {\n    const clerk = window.Clerk;\n\n    if (mode === 'modal') {\n      return clerk.openSignIn({ ...signInOptions, appearance: props.appearance });\n    }\n\n    return clerk.redirectToSignIn({\n      ...signInOptions,\n      signInFallbackRedirectUrl: signInOptions.fallbackRedirectUrl,\n      signInForceRedirectUrl: signInOptions.forceRedirectUrl,\n    });\n  });\n})();<\/script>",
          ],
        )),
      asChild
        ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { default: async ($$result2) => renderTemplate`${unescapeHTML(htmlElement)}` })}`
        : renderTemplate`${maybeRenderHead()}<button${spreadAttributes(props)}${addAttribute(safeId, "data-clerk-unstyled-id")}>${renderSlot($$result, $$slots["default"], renderTemplate`Sign in`)}</button>`,
      defineScriptVars({ props, signInOptions, mode, safeId }),
    );
  },
  "/Users/harshithpasupuleti/code/omni/marketing/node_modules/@clerk/astro/components/unstyled/SignInButton.astro",
  void 0,
);
var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) =>
  __freeze(__defProp(cooked, "raw", { value: __freeze(raw || cooked.slice()) }));
var _a;
const $$SignUpButton = createComponent(
  async ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$SignUpButton;
    const safeId = generateSafeId();
    const {
      asChild,
      fallbackRedirectUrl,
      forceRedirectUrl,
      signInFallbackRedirectUrl,
      signInForceRedirectUrl,
      mode,
      unsafeMetadata,
      ...props
    } = Astro2.props;
    const signUpOptions = {
      fallbackRedirectUrl,
      forceRedirectUrl,
      signInFallbackRedirectUrl,
      signInForceRedirectUrl,
      unsafeMetadata,
    };
    let htmlElement = "";
    if (asChild) {
      htmlElement = await Astro2.slots.render("default");
      htmlElement = addUnstyledAttributeToFirstTag(htmlElement, safeId);
    }
    return renderTemplate(
      _a ||
        (_a = __template(
          [
            "",
            "<script>(function(){",
            "\n  const btn = document.querySelector(`[data-clerk-unstyled-id=\"${safeId}\"]`);\n\n  btn.addEventListener('click', () => {\n    const clerk = window.Clerk;\n\n    if (mode === 'modal') {\n      return clerk.openSignUp({ ...signUpOptions, appearance: props.appearance });\n    }\n\n    return clerk.redirectToSignUp({\n      ...signUpOptions,\n      signUpFallbackRedirectUrl: signUpOptions.fallbackRedirectUrl,\n      signUpForceRedirectUrl: signUpOptions.forceRedirectUrl,\n    });\n  });\n})();<\/script>",
          ],
          [
            "",
            "<script>(function(){",
            "\n  const btn = document.querySelector(\\`[data-clerk-unstyled-id=\"\\${safeId}\"]\\`);\n\n  btn.addEventListener('click', () => {\n    const clerk = window.Clerk;\n\n    if (mode === 'modal') {\n      return clerk.openSignUp({ ...signUpOptions, appearance: props.appearance });\n    }\n\n    return clerk.redirectToSignUp({\n      ...signUpOptions,\n      signUpFallbackRedirectUrl: signUpOptions.fallbackRedirectUrl,\n      signUpForceRedirectUrl: signUpOptions.forceRedirectUrl,\n    });\n  });\n})();<\/script>",
          ],
        )),
      asChild
        ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { default: async ($$result2) => renderTemplate`${unescapeHTML(htmlElement)}` })}`
        : renderTemplate`${maybeRenderHead()}<button${spreadAttributes(props)}${addAttribute(safeId, "data-clerk-unstyled-id")}>${renderSlot($$result, $$slots["default"], renderTemplate`Sign up`)}</button>`,
      defineScriptVars({ props, signUpOptions, mode, safeId }),
    );
  },
  "/Users/harshithpasupuleti/code/omni/marketing/node_modules/@clerk/astro/components/unstyled/SignUpButton.astro",
  void 0,
);
const $$Auth = createComponent(
  ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$Auth;
    const returnTo = Astro2.url.searchParams.get("return_to") ?? "";
    const callbackUrl = new URL("/auth/complete", Astro2.url);
    if (returnTo) {
      callbackUrl.searchParams.set("return_to", returnTo);
    }
    return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { title: "Pipper auth", "data-astro-cid-5ndk7oiz": true }, { default: ($$result2) => renderTemplate` ${maybeRenderHead()}<main class="shell" data-astro-cid-5ndk7oiz> <section class="hero" data-astro-cid-5ndk7oiz> <div class="actions" data-astro-cid-5ndk7oiz> ${renderComponent($$result2, "SignInButton", $$SignInButton, { mode: "redirect", forceRedirectUrl: callbackUrl.toString(), fallbackRedirectUrl: callbackUrl.toString(), "data-astro-cid-5ndk7oiz": true })} ${renderComponent($$result2, "SignUpButton", $$SignUpButton, { mode: "redirect", forceRedirectUrl: callbackUrl.toString(), fallbackRedirectUrl: callbackUrl.toString(), "data-astro-cid-5ndk7oiz": true })} </div> </section> </main> ` })}`;
  },
  "/Users/harshithpasupuleti/code/omni/marketing/src/pages/auth.astro",
  void 0,
);
const $$file = "/Users/harshithpasupuleti/code/omni/marketing/src/pages/auth.astro";
const $$url = "/auth";
const _page = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      default: $$Auth,
      file: $$file,
      url: $$url,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
const page = () => _page;
export { page };
