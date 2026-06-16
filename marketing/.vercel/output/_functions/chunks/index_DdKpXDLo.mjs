import { c as createComponent } from "./astro-component_Bvh79D0k.mjs";
import "piccolore";
import {
  I as renderTemplate,
  bi as defineScriptVars,
  _ as addAttribute,
  u as maybeRenderHead,
} from "./sequence_9Z-GG-XK.mjs";
import { r as renderComponent } from "./entrypoint_Ccz9lNni.mjs";
import { $ as $$Layout, r as renderScript } from "./Layout_C8lNXi4Q.mjs";
import "clsx";
import { g as generateSafeId } from "./index_CAl4q2AK.mjs";
var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) =>
  __freeze(__defProp(cooked, "raw", { value: __freeze(raw || cooked.slice()) }));
var _a;
const $$InternalUIComponentRenderer = createComponent(
  ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$InternalUIComponentRenderer;
    const { component, id, ...props } = Astro2.props;
    const safeId = id || generateSafeId();
    return renderTemplate(
      _a ||
        (_a = __template(
          [
            "",
            "<div",
            "></div> <script>(function(){",
            "\n  /**\n   * Store the id and the props for the Astro component in order to mount the correct UI component once clerk is loaded.\n   * The above is handled by `mountAllClerkAstroJSComponents`.\n   */\n  const setOrCreatePropMap = ({ category, id, props }) => {\n    if (!window.__astro_clerk_component_props) {\n      window.__astro_clerk_component_props = new Map();\n    }\n\n    if (!window.__astro_clerk_component_props.has(category)) {\n      const _ = new Map();\n      _.set(id, props);\n      window.__astro_clerk_component_props.set(category, _);\n    }\n\n    window.__astro_clerk_component_props.get(category)?.set(id, props);\n  };\n\n  setOrCreatePropMap({\n    category: component,\n    id: `clerk-${component}-${safeId}`,\n    props,\n  });\n})();<\/script>",
          ],
          [
            "",
            "<div",
            "></div> <script>(function(){",
            "\n  /**\n   * Store the id and the props for the Astro component in order to mount the correct UI component once clerk is loaded.\n   * The above is handled by \\`mountAllClerkAstroJSComponents\\`.\n   */\n  const setOrCreatePropMap = ({ category, id, props }) => {\n    if (!window.__astro_clerk_component_props) {\n      window.__astro_clerk_component_props = new Map();\n    }\n\n    if (!window.__astro_clerk_component_props.has(category)) {\n      const _ = new Map();\n      _.set(id, props);\n      window.__astro_clerk_component_props.set(category, _);\n    }\n\n    window.__astro_clerk_component_props.get(category)?.set(id, props);\n  };\n\n  setOrCreatePropMap({\n    category: component,\n    id: \\`clerk-\\${component}-\\${safeId}\\`,\n    props,\n  });\n})();<\/script>",
          ],
        )),
      maybeRenderHead(),
      addAttribute(`clerk-${component}-${safeId}`, "data-clerk-id"),
      defineScriptVars({ props, component, safeId }),
    );
  },
  "/Users/harshithpasupuleti/code/omni/marketing/node_modules/@clerk/astro/components/interactive/InternalUIComponentRenderer.astro",
  void 0,
);
const $$Waitlist = createComponent(
  ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$Waitlist;
    return renderTemplate`${renderComponent($$result, "InternalUIComponentRenderer", $$InternalUIComponentRenderer, { ...Astro2.props, component: "waitlist" })}`;
  },
  "/Users/harshithpasupuleti/code/omni/marketing/node_modules/@clerk/astro/components/interactive/Waitlist.astro",
  void 0,
);
const $$Index = createComponent(
  ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$Index;
    return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { title: "Pipper - Developer Agent Launcher", "data-astro-cid-j7pv25f6": true }, { default: ($$result2) => renderTemplate` ${maybeRenderHead()}<main class="shell" data-astro-cid-j7pv25f6> <section data-astro-cid-j7pv25f6> <h1 data-astro-cid-j7pv25f6>Pipper</h1> <h3 data-astro-cid-j7pv25f6>Building self<br data-astro-cid-j7pv25f6>improving IDE</h3> <button id="waitlist-trigger" class="waitlist-btn" data-astro-cid-j7pv25f6>Join Waitlist</button> </section> </main> <dialog id="waitlist-dialog" class="waitlist-dialog" data-astro-cid-j7pv25f6> <div class="dialog-content" data-astro-cid-j7pv25f6> <button id="waitlist-close" class="close-btn" aria-label="Close modal" data-astro-cid-j7pv25f6>&times;</button> ${renderComponent($$result2, "WaitlistAstro", $$Waitlist, { "data-astro-cid-j7pv25f6": true })} </div> </dialog> ` })} ${renderScript($$result, "/Users/harshithpasupuleti/code/omni/marketing/src/pages/index.astro?astro&type=script&index=0&lang.ts")}`;
  },
  "/Users/harshithpasupuleti/code/omni/marketing/src/pages/index.astro",
  void 0,
);
const $$file = "/Users/harshithpasupuleti/code/omni/marketing/src/pages/index.astro";
const $$url = "";
const _page = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      default: $$Index,
      file: $$file,
      url: $$url,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
const page = () => _page;
export { page };
