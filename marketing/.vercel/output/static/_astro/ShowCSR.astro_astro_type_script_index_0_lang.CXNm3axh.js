import { $ as h, a as d, b as u } from "./external-DHTxQaok.BzGBULKT.js";
class c extends HTMLElement {
  constructor() {
    (super(), (this.authStoreListener = null), (this.isLoadedStoreListener = null));
  }
  connectedCallback() {
    this.isLoadedStoreListener = h.subscribe((t) => {
      t && this.toggleContentVisibility();
    });
  }
  disconnectedCallback() {
    (this.authStoreListener?.(), this.isLoadedStoreListener?.());
  }
  toggleContentVisibility() {
    this.authStoreListener = d.subscribe((t) => {
      this.onAuthStateChange(t);
    });
  }
  onAuthStateChange(t) {}
}
class S extends c {
  constructor() {
    (super(...arguments), (this.defaultSlot = null), (this.fallbackSlot = null));
  }
  onAuthStateChange(t) {
    ((this.defaultSlot = this.querySelector("[data-clerk-control-slot-default]")),
      (this.fallbackSlot = this.querySelector("[data-clerk-control-slot-fallback]")));
    const r = u.get()?.checkAuthorization,
      s = this.dataset.when,
      i = this.dataset.role,
      l = this.dataset.permission,
      o = this.dataset.feature,
      a = this.dataset.plan;
    let e = !1;
    (s === "signed-in"
      ? (e = !!t.userId)
      : s === "signed-out"
        ? (e = !t.userId)
        : i || l || o || a
          ? (e = !!t.userId && !!r?.({ role: i, permission: l, feature: o, plan: a }))
          : (e = !!t.userId),
      this.defaultSlot &&
        (e
          ? this.defaultSlot.removeAttribute("hidden")
          : this.defaultSlot.setAttribute("hidden", "")),
      this.fallbackSlot &&
        (e
          ? this.fallbackSlot.setAttribute("hidden", "")
          : this.fallbackSlot.removeAttribute("hidden")));
  }
}
customElements.define("clerk-show", S);
