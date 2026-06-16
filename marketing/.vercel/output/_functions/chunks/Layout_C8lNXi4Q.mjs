import { c as createComponent } from "./astro-component_Bvh79D0k.mjs";
import "piccolore";
import {
  J as createRenderInstruction,
  u as maybeRenderHead,
  _ as addAttribute,
  I as renderTemplate,
  bk as renderHead,
  bj as renderSlot,
} from "./sequence_9Z-GG-XK.mjs";
import { d as defineStyleVars, r as renderComponent } from "./entrypoint_Ccz9lNni.mjs";
import "clsx";
async function renderScript(result, id) {
  const inlined = result.inlinedScripts.get(id);
  let content = "";
  if (inlined != null) {
    if (inlined) {
      content = `<script type="module">${inlined}<\/script>`;
    }
  } else {
    const resolved = await result.resolve(id);
    content = `<script type="module" src="${result.userAssetsBase ? (result.base === "/" ? "" : result.base) + result.userAssetsBase : ""}${resolved}"><\/script>`;
  }
  return createRenderInstruction({ type: "script", id, content });
}
const $$AmbientPixelField = createComponent(
  ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$AmbientPixelField;
    const {
      pixelSize = 6,
      gap = 4,
      intensity = 0.35,
      fadeStart = 0.8,
      animated = true,
    } = Astro2.props;
    const $$definedVars = defineStyleVars([{ pixelSize, gap, fadeStart }]);
    return renderTemplate`${maybeRenderHead()}<div class="ambient-pixel-field"${addAttribute(pixelSize, "data-pixel-size")}${addAttribute(gap, "data-gap")}${addAttribute(intensity, "data-intensity")}${addAttribute(fadeStart, "data-fade-start")}${addAttribute(String(animated), "data-animated")} data-astro-cid-z7e2xysf${addAttribute($$definedVars, "style")}> <!-- Background Glows --> <div class="glow-container" data-astro-cid-z7e2xysf${addAttribute($$definedVars, "style")}> <div class="glow-field glow-left animate-glow-left" data-astro-cid-z7e2xysf${addAttribute($$definedVars, "style")}></div> <div class="glow-field glow-right animate-glow-right" data-astro-cid-z7e2xysf${addAttribute($$definedVars, "style")}></div> </div> <!-- Pixel Grid (Populated on Client-Side) --> <div class="pixel-grid" data-astro-cid-z7e2xysf${addAttribute($$definedVars, "style")}></div> </div>  ${renderScript($$result, "/Users/harshithpasupuleti/code/omni/marketing/src/components/AmbientPixelField.astro?astro&type=script&index=0&lang.ts")}`;
  },
  "/Users/harshithpasupuleti/code/omni/marketing/src/components/AmbientPixelField.astro",
  void 0,
);
const $$Layout = createComponent(
  ($$result, $$props, $$slots) => {
    const Astro2 = $$result.createAstro($$props, $$slots);
    Astro2.self = $$Layout;
    const { title = "Pipper auth" } = Astro2.props;
    return renderTemplate`<html lang="en" data-astro-cid-sckkx6r4> <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator"${addAttribute(Astro2.generator, "content")}><title>${title}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Averia+Serif+Libre:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700&display=swap" rel="stylesheet">${renderHead()}</head> <body data-astro-cid-sckkx6r4> ${renderComponent($$result, "AmbientPixelField", $$AmbientPixelField, { intensity: 0.4, fadeStart: 0.8, "data-astro-cid-sckkx6r4": true })} ${renderSlot($$result, $$slots["default"])}</body></html>`;
  },
  "/Users/harshithpasupuleti/code/omni/marketing/src/layouts/Layout.astro",
  void 0,
);
export { $$Layout as $, renderScript as r };
