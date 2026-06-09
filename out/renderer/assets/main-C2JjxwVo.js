import { A as require_compiler_runtime, C as AnimatePresence, D as ArrowLeft, E as cn, M as require_react_dom, N as require_react, O as createLucideIcon, P as __toESM, S as motion, T as useTheme, a as useComposedRefs, b as useProximityHover, c as p$1, d as SelectItem, f as SelectTrigger, g as useSurface, h as SurfaceProvider, i as createSlottable, j as require_client, k as require_jsx_runtime, l as Select, m as surfaceClasses, n as Button, p as Elevated, r as createSlot, s as ProjectIcon, t as fontWeights, u as SelectContent, v as shapeMap, w as ThemeProvider, x as springs, y as useShape } from "./font-weight-Fkyh1dzw.js";
//#region node_modules/react-resizable-panels/dist/react-resizable-panels.js
var import_client = require_client();
var import_compiler_runtime = require_compiler_runtime();
var import_jsx_runtime = require_jsx_runtime();
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
function gt(e, t) {
	const n = getComputedStyle(e);
	return t * parseFloat(n.fontSize);
}
function yt(e, t) {
	const n = getComputedStyle(e.ownerDocument.documentElement);
	return t * parseFloat(n.fontSize);
}
function St(e) {
	return e / 100 * window.innerHeight;
}
function vt(e) {
	return e / 100 * window.innerWidth;
}
function bt(e) {
	switch (typeof e) {
		case "number": return [e, "px"];
		case "string": {
			const t = parseFloat(e);
			return e.endsWith("%") ? [t, "%"] : e.endsWith("px") ? [t, "px"] : e.endsWith("rem") ? [t, "rem"] : e.endsWith("em") ? [t, "em"] : e.endsWith("vh") ? [t, "vh"] : e.endsWith("vw") ? [t, "vw"] : [t, "%"];
		}
	}
}
function ie({ groupSize: e, panelElement: t, styleProp: n }) {
	let o;
	const [i, r] = bt(n);
	switch (r) {
		case "%":
			o = i / 100 * e;
			break;
		case "px":
			o = i;
			break;
		case "rem":
			o = yt(t, i);
			break;
		case "em":
			o = gt(t, i);
			break;
		case "vh":
			o = St(i);
			break;
		case "vw":
			o = vt(i);
			break;
	}
	return o;
}
function O(e) {
	return parseFloat(e.toFixed(3));
}
function ne({ group: e }) {
	const { orientation: t, panels: n } = e;
	return n.reduce((o, i) => (o += t === "horizontal" ? i.element.offsetWidth : i.element.offsetHeight, o), 0);
}
function ve(e) {
	const { panels: t } = e, n = ne({ group: e });
	return n === 0 ? t.map((o) => ({
		groupResizeBehavior: o.panelConstraints.groupResizeBehavior,
		collapsedSize: 0,
		collapsible: o.panelConstraints.collapsible === !0,
		defaultSize: void 0,
		disabled: o.panelConstraints.disabled,
		minSize: 0,
		maxSize: 100,
		panelId: o.id
	})) : t.map((o) => {
		const { element: i, panelConstraints: r } = o;
		let f = 0;
		if (r.collapsedSize !== void 0) f = O(ie({
			groupSize: n,
			panelElement: i,
			styleProp: r.collapsedSize
		}) / n * 100);
		let a;
		if (r.defaultSize !== void 0) a = O(ie({
			groupSize: n,
			panelElement: i,
			styleProp: r.defaultSize
		}) / n * 100);
		let s = 0;
		if (r.minSize !== void 0) s = O(ie({
			groupSize: n,
			panelElement: i,
			styleProp: r.minSize
		}) / n * 100);
		let l = 100;
		if (r.maxSize !== void 0) l = O(ie({
			groupSize: n,
			panelElement: i,
			styleProp: r.maxSize
		}) / n * 100);
		return {
			groupResizeBehavior: r.groupResizeBehavior,
			collapsedSize: f,
			collapsible: r.collapsible === !0,
			defaultSize: a,
			disabled: r.disabled,
			minSize: s,
			maxSize: l,
			panelId: o.id
		};
	});
}
function C(e, t = "Assertion error") {
	if (!e) throw Error(t);
}
function be(e, t) {
	return Array.from(t).sort(e === "horizontal" ? zt : xt);
}
function zt(e, t) {
	const n = e.element.offsetLeft - t.element.offsetLeft;
	return n !== 0 ? n : e.element.offsetWidth - t.element.offsetWidth;
}
function xt(e, t) {
	const n = e.element.offsetTop - t.element.offsetTop;
	return n !== 0 ? n : e.element.offsetHeight - t.element.offsetHeight;
}
function qe(e) {
	return e !== null && typeof e == "object" && "nodeType" in e && e.nodeType === Node.ELEMENT_NODE;
}
function Ye(e, t) {
	return {
		x: e.x >= t.left && e.x <= t.right ? 0 : Math.min(Math.abs(e.x - t.left), Math.abs(e.x - t.right)),
		y: e.y >= t.top && e.y <= t.bottom ? 0 : Math.min(Math.abs(e.y - t.top), Math.abs(e.y - t.bottom))
	};
}
function Pt({ orientation: e, rects: t, targetRect: n }) {
	const o = {
		x: n.x + n.width / 2,
		y: n.y + n.height / 2
	};
	let i, r = Number.MAX_VALUE;
	for (const f of t) {
		const { x: a, y: s } = Ye(o, f), l = e === "horizontal" ? a : s;
		l < r && (r = l, i = f);
	}
	return C(i, "No rect found"), i;
}
var fe;
function wt() {
	return fe === void 0 && (typeof matchMedia == "function" ? fe = !!matchMedia("(pointer:coarse)").matches : fe = !1), fe;
}
function Je(e) {
	const { element: t, orientation: n, panels: o, separators: i } = e, r = be(n, Array.from(t.children).filter(qe).map((z) => ({ element: z }))).map(({ element: z }) => z), f = [];
	let a = !1, s = !1, l = -1, u = -1, h = 0, d, S = [];
	{
		let z = -1;
		for (const c of r) c.hasAttribute("data-panel") && (z++, c.hasAttribute("data-disabled") || (h++, l === -1 && (l = z), u = z));
	}
	if (h > 1) {
		let z = -1;
		for (const c of r) if (c.hasAttribute("data-panel")) {
			z++;
			const p = o.find((m) => m.element === c);
			if (p) {
				if (d) {
					const m = d.element.getBoundingClientRect(), v = c.getBoundingClientRect();
					let b;
					if (s) {
						const y = n === "horizontal" ? new DOMRect(m.right, m.top, 0, m.height) : new DOMRect(m.left, m.bottom, m.width, 0), g = n === "horizontal" ? new DOMRect(v.left, v.top, 0, v.height) : new DOMRect(v.left, v.top, v.width, 0);
						switch (S.length) {
							case 0:
								b = [y, g];
								break;
							case 1: {
								const P = S[0];
								b = [P, Pt({
									orientation: n,
									rects: [m, v],
									targetRect: P.element.getBoundingClientRect()
								}) === m ? g : y];
								break;
							}
							default:
								b = S;
								break;
						}
					} else S.length ? b = S : b = [n === "horizontal" ? new DOMRect(m.right, v.top, v.left - m.right, v.height) : new DOMRect(v.left, m.bottom, v.width, v.top - m.bottom)];
					for (const y of b) {
						let g = "width" in y ? y : y.element.getBoundingClientRect();
						const P = wt() ? e.resizeTargetMinimumSize.coarse : e.resizeTargetMinimumSize.fine;
						if (g.width < P) {
							const w = P - g.width;
							g = new DOMRect(g.x - w / 2, g.y, g.width + w, g.height);
						}
						if (g.height < P) {
							const w = P - g.height;
							g = new DOMRect(g.x, g.y - w / 2, g.width, g.height + w);
						}
						!a && !(z <= l || z > u) && f.push({
							group: e,
							groupSize: ne({ group: e }),
							panels: [d, p],
							separator: "width" in y ? void 0 : y,
							rect: g
						}), a = !1;
					}
				}
				s = !1, d = p, S = [];
			}
		} else if (c.hasAttribute("data-separator")) {
			c.ariaDisabled !== null && (a = !0);
			const p = i.find((m) => m.element === c);
			p ? S.push(p) : (d = void 0, S = []);
		} else s = !0;
	}
	return f;
}
var Ze = class {
	#e = {};
	addListener(t, n) {
		const o = this.#e[t];
		return o === void 0 ? this.#e[t] = [n] : o.includes(n) || o.push(n), () => {
			this.removeListener(t, n);
		};
	}
	emit(t, n) {
		const o = this.#e[t];
		if (o !== void 0) if (o.length === 1) o[0].call(null, n);
		else {
			let i = !1, r = null;
			const f = Array.from(o);
			for (let a = 0; a < f.length; a++) {
				const s = f[a];
				try {
					s.call(null, n);
				} catch (l) {
					r === null && (i = !0, r = l);
				}
			}
			if (i) throw r;
		}
	}
	removeAllListeners() {
		this.#e = {};
	}
	removeListener(t, n) {
		const o = this.#e[t];
		if (o !== void 0) {
			const i = o.indexOf(n);
			i >= 0 && o.splice(i, 1);
		}
	}
};
var F = /* @__PURE__ */ new Map();
var Qe = new Ze();
function Lt(e) {
	F = new Map(F), F.delete(e);
}
function ke(e, t) {
	for (const [n] of F) if (n.id === e) return n;
}
function H(e, t) {
	for (const [n, o] of F) if (n.id === e) return o;
	if (t) throw Error(`Could not find data for Group with id ${e}`);
}
function X$1() {
	return F;
}
function ze(e, t) {
	return Qe.addListener("groupChange", (n) => {
		n.group.id === e && t(n);
	});
}
function $(e, t) {
	const n = F.get(e);
	F = new Map(F), F.set(e, t), Qe.emit("groupChange", {
		group: e,
		prev: n,
		next: t
	});
}
function Ct(e, t, n) {
	let o, i = {
		x: Infinity,
		y: Infinity
	};
	for (const r of t) {
		const f = Ye(n, r.rect);
		switch (e) {
			case "horizontal":
				f.x <= i.x && (o = r, i = f);
				break;
			case "vertical":
				f.y <= i.y && (o = r, i = f);
				break;
		}
	}
	return o ? {
		distance: i,
		hitRegion: o
	} : void 0;
}
function Rt(e) {
	return e !== null && typeof e == "object" && "nodeType" in e && e.nodeType === Node.DOCUMENT_FRAGMENT_NODE;
}
function Mt(e, t) {
	if (e === t) throw new Error("Cannot compare node with itself");
	const n = {
		a: Oe(e),
		b: Oe(t)
	};
	let o;
	for (; n.a.at(-1) === n.b.at(-1);) o = n.a.pop(), n.b.pop();
	C(o, "Stacking order can only be calculated for elements with a common ancestor");
	const i = {
		a: De(Ie(n.a)),
		b: De(Ie(n.b))
	};
	if (i.a === i.b) {
		const r = o.childNodes, f = {
			a: n.a.at(-1),
			b: n.b.at(-1)
		};
		let a = r.length;
		for (; a--;) {
			const s = r[a];
			if (s === f.a) return 1;
			if (s === f.b) return -1;
		}
	}
	return Math.sign(i.a - i.b);
}
var Et = /\b(?:position|zIndex|opacity|transform|webkitTransform|mixBlendMode|filter|webkitFilter|isolation)\b/;
function kt(e) {
	const t = getComputedStyle(et(e) ?? e).display;
	return t === "flex" || t === "inline-flex";
}
function It(e) {
	const t = getComputedStyle(e);
	return !!(t.position === "fixed" || t.zIndex !== "auto" && (t.position !== "static" || kt(e)) || +t.opacity < 1 || "transform" in t && t.transform !== "none" || "webkitTransform" in t && t.webkitTransform !== "none" || "mixBlendMode" in t && t.mixBlendMode !== "normal" || "filter" in t && t.filter !== "none" || "webkitFilter" in t && t.webkitFilter !== "none" || "isolation" in t && t.isolation === "isolate" || Et.test(t.willChange) || t.webkitOverflowScrolling === "touch");
}
function Ie(e) {
	let t = e.length;
	for (; t--;) {
		const n = e[t];
		if (C(n, "Missing node"), It(n)) return n;
	}
	return null;
}
function De(e) {
	return e && Number(getComputedStyle(e).zIndex) || 0;
}
function Oe(e) {
	const t = [];
	for (; e;) t.push(e), e = et(e);
	return t;
}
function et(e) {
	const { parentNode: t } = e;
	return Rt(t) ? t.host : t;
}
function Dt(e, t) {
	return e.x < t.x + t.width && e.x + e.width > t.x && e.y < t.y + t.height && e.y + e.height > t.y;
}
function Ot({ groupElement: e, hitRegion: t, pointerEventTarget: n }) {
	if (!qe(n) || n.contains(e) || e.contains(n)) return !0;
	if (Mt(n, e) > 0) {
		let o = n;
		for (; o;) {
			if (o.contains(e)) return !0;
			if (Dt(o.getBoundingClientRect(), t)) return !1;
			o = o.parentElement;
		}
	}
	return !0;
}
function xe(e, t) {
	const n = [];
	return t.forEach((o, i) => {
		if (i.disabled) return;
		const r = Je(i), f = Ct(i.orientation, r, {
			x: e.clientX,
			y: e.clientY
		});
		f && f.distance.x <= 0 && f.distance.y <= 0 && Ot({
			groupElement: i.element,
			hitRegion: f.hitRegion.rect,
			pointerEventTarget: e.target
		}) && n.push(f.hitRegion);
	}), n;
}
function Tt(e, t) {
	if (e.length !== t.length) return !1;
	for (let n = 0; n < e.length; n++) if (e[n] != t[n]) return !1;
	return !0;
}
function I$1(e, t, n = 0) {
	return Math.abs(O(e) - O(t)) <= n;
}
function A(e, t) {
	return I$1(e, t) ? 0 : e > t ? 1 : -1;
}
function Z({ overrideDisabledPanels: e, panelConstraints: t, prevSize: n, size: o }) {
	const { collapsedSize: i = 0, collapsible: r, disabled: f, maxSize: a = 100, minSize: s = 0 } = t;
	if (f && !e) return n;
	if (A(o, s) < 0) if (r) {
		const l = (i + s) / 2;
		A(o, l) < 0 ? o = i : o = s;
	} else o = s;
	return o = Math.min(a, o), o = O(o), o;
}
function le({ delta: e, initialLayout: t, panelConstraints: n, pivotIndices: o, prevLayout: i, trigger: r }) {
	if (I$1(e, 0)) return t;
	const f = r === "imperative-api", a = Object.values(t), s = Object.values(i), l = [...a], [u, h] = o;
	C(u != null, "Invalid first pivot index"), C(h != null, "Invalid second pivot index");
	let d = 0;
	switch (r) {
		case "keyboard":
			{
				const c = e < 0 ? h : u, p = n[c];
				C(p, `Panel constraints not found for index ${c}`);
				const { collapsedSize: m = 0, collapsible: v, minSize: b = 0 } = p;
				if (v) {
					const y = a[c];
					if (C(y != null, `Previous layout not found for panel index ${c}`), I$1(y, m)) {
						const g = b - y;
						A(g, Math.abs(e)) > 0 && (e = e < 0 ? 0 - g : g);
					}
				}
			}
			{
				const c = e < 0 ? u : h, p = n[c];
				C(p, `No panel constraints found for index ${c}`);
				const { collapsedSize: m = 0, collapsible: v, minSize: b = 0 } = p;
				if (v) {
					const y = a[c];
					if (C(y != null, `Previous layout not found for panel index ${c}`), I$1(y, b)) {
						const g = y - m;
						A(g, Math.abs(e)) > 0 && (e = e < 0 ? 0 - g : g);
					}
				}
			}
			break;
		default: {
			const c = e < 0 ? h : u, p = n[c];
			C(p, `Panel constraints not found for index ${c}`);
			const m = a[c], { collapsible: v, collapsedSize: b, minSize: y } = p;
			if (v && A(m, y) < 0) if (e > 0) {
				const g = y - b, P = g / 2;
				A(m + e, y) < 0 && (e = A(e, P) <= 0 ? 0 : g);
			} else {
				const g = y - b, P = 100 - g / 2;
				A(m - e, y) < 0 && (e = A(100 + e, P) > 0 ? 0 : -g);
			}
			break;
		}
	}
	{
		const c = e < 0 ? 1 : -1;
		let p = e < 0 ? h : u, m = 0;
		for (;;) {
			const b = a[p];
			C(b != null, `Previous layout not found for panel index ${p}`);
			const g = Z({
				overrideDisabledPanels: f,
				panelConstraints: n[p],
				prevSize: b,
				size: 100
			}) - b;
			if (m += g, p += c, p < 0 || p >= n.length) break;
		}
		const v = Math.min(Math.abs(e), Math.abs(m));
		e = e < 0 ? 0 - v : v;
	}
	{
		let p = e < 0 ? u : h;
		for (; p >= 0 && p < n.length;) {
			const m = Math.abs(e) - Math.abs(d), v = a[p];
			C(v != null, `Previous layout not found for panel index ${p}`);
			const b = v - m, y = Z({
				overrideDisabledPanels: f,
				panelConstraints: n[p],
				prevSize: v,
				size: b
			});
			if (!I$1(v, y) && (d += v - y, l[p] = y, d.toFixed(3).localeCompare(Math.abs(e).toFixed(3), void 0, { numeric: !0 }) >= 0)) break;
			e < 0 ? p-- : p++;
		}
	}
	if (Tt(s, l)) return i;
	{
		const c = e < 0 ? h : u, p = a[c];
		C(p != null, `Previous layout not found for panel index ${c}`);
		const m = p + d, v = Z({
			overrideDisabledPanels: f,
			panelConstraints: n[c],
			prevSize: p,
			size: m
		});
		if (l[c] = v, !I$1(v, m)) {
			let b = m - v, g = e < 0 ? h : u;
			for (; g >= 0 && g < n.length;) {
				const P = l[g];
				C(P != null, `Previous layout not found for panel index ${g}`);
				const M = P + b, w = Z({
					overrideDisabledPanels: f,
					panelConstraints: n[g],
					prevSize: P,
					size: M
				});
				if (I$1(P, w) || (b -= w - P, l[g] = w), I$1(b, 0)) break;
				e > 0 ? g-- : g++;
			}
		}
	}
	if (!I$1(Object.values(l).reduce((c, p) => p + c, 0), 100, .1)) return i;
	const z = Object.keys(i);
	return l.reduce((c, p, m) => (c[z[m]] = p, c), {});
}
function W(e, t) {
	if (Object.keys(e).length !== Object.keys(t).length) return !1;
	for (const n in e) if (t[n] === void 0 || A(e[n], t[n]) !== 0) return !1;
	return !0;
}
function U({ layout: e, panelConstraints: t }) {
	const n = Object.values(e), o = [...n], i = o.reduce((a, s) => a + s, 0);
	if (o.length !== t.length) throw Error(`Invalid ${t.length} panel layout: ${o.map((a) => `${a}%`).join(", ")}`);
	if (!I$1(i, 100) && o.length > 0) for (let a = 0; a < t.length; a++) {
		const s = o[a];
		C(s != null, `No layout data found for index ${a}`);
		o[a] = 100 / i * s;
	}
	let r = 0;
	for (let a = 0; a < t.length; a++) {
		const s = n[a];
		C(s != null, `No layout data found for index ${a}`);
		const l = o[a];
		C(l != null, `No layout data found for index ${a}`);
		const u = Z({
			overrideDisabledPanels: !0,
			panelConstraints: t[a],
			prevSize: s,
			size: l
		});
		l != u && (r += l - u, o[a] = u);
	}
	if (!I$1(r, 0)) for (let a = 0; a < t.length; a++) {
		const s = o[a];
		C(s != null, `No layout data found for index ${a}`);
		const l = s + r, u = Z({
			overrideDisabledPanels: !0,
			panelConstraints: t[a],
			prevSize: s,
			size: l
		});
		if (s !== u && (r -= u - s, o[a] = u, I$1(r, 0))) break;
	}
	const f = Object.keys(e);
	return o.reduce((a, s, l) => (a[f[l]] = s, a), {});
}
function tt({ groupId: e, panelId: t }) {
	const n = () => {
		const s = X$1();
		for (const [l, { defaultLayoutDeferred: u, derivedPanelConstraints: h, layout: d, groupSize: S, separatorToPanels: z }] of s) if (l.id === e) return {
			defaultLayoutDeferred: u,
			derivedPanelConstraints: h,
			group: l,
			groupSize: S,
			layout: d,
			separatorToPanels: z
		};
		throw Error(`Group ${e} not found`);
	}, o = () => {
		const s = n().derivedPanelConstraints.find((l) => l.panelId === t);
		if (s !== void 0) return s;
		throw Error(`Panel constraints not found for Panel ${t}`);
	}, i = () => {
		const s = n().group.panels.find((l) => l.id === t);
		if (s !== void 0) return s;
		throw Error(`Layout not found for Panel ${t}`);
	}, r = () => {
		const s = n().layout[t];
		if (s !== void 0) return s;
		throw Error(`Layout not found for Panel ${t}`);
	}, f = ({ nextSize: s, panels: l, prevLayout: u, derivedPanelConstraints: h }) => {
		const d = r(), S = l.findIndex((m) => m.id === t), z = S === 0, c = S === l.length - 1;
		if (c && s < d && (z || l.slice(0, S).every((m, v) => {
			const b = h[v];
			return b?.collapsible && I$1(b.collapsedSize, u[b.panelId]);
		}))) {
			const m = l.slice(0, S).reduce((v, b) => v + u[b.id], 0);
			return {
				...u,
				[t]: O(100 - m)
			};
		}
		return le({
			delta: c ? d - s : s - d,
			initialLayout: u,
			panelConstraints: h,
			pivotIndices: c ? [S - 1, S] : [S, S + 1],
			prevLayout: u,
			trigger: "imperative-api"
		});
	}, a = (s) => {
		if (s === r()) return;
		const { defaultLayoutDeferred: u, derivedPanelConstraints: h, group: d, groupSize: S, layout: z, separatorToPanels: c } = n(), m = U({
			layout: f({
				nextSize: s,
				panels: d.panels,
				prevLayout: z,
				derivedPanelConstraints: h
			}),
			panelConstraints: h
		});
		W(z, m) || $(d, {
			defaultLayoutDeferred: u,
			derivedPanelConstraints: h,
			groupSize: S,
			layout: m,
			separatorToPanels: c
		});
	};
	return {
		collapse: () => {
			const { collapsible: s, collapsedSize: l } = o(), { mutableValues: u } = i(), h = r();
			s && h !== l && (u.expandToSize = h, a(l));
		},
		expand: () => {
			const { collapsible: s, collapsedSize: l, minSize: u } = o(), { mutableValues: h } = i(), d = r();
			if (s && d === l) {
				let S = h.expandToSize ?? u;
				S === 0 && (S = 1), a(S);
			}
		},
		getSize: () => {
			const { group: s } = n(), l = r(), { element: u } = i();
			return {
				asPercentage: l,
				inPixels: s.orientation === "horizontal" ? u.offsetWidth : u.offsetHeight
			};
		},
		isCollapsed: () => {
			const { collapsible: s, collapsedSize: l } = o(), u = r();
			return s && I$1(l, u);
		},
		resize: (s) => {
			const { group: l } = n(), { element: u } = i(), h = ne({ group: l });
			a(O(ie({
				groupSize: h,
				panelElement: u,
				styleProp: s
			}) / h * 100));
		}
	};
}
function Te(e) {
	if (e.defaultPrevented) return;
	xe(e, X$1()).forEach((o) => {
		if (o.separator && !o.separator.disableDoubleClick) {
			const i = o.panels.find((r) => r.panelConstraints.defaultSize !== void 0);
			if (i) {
				const r = i.panelConstraints.defaultSize, f = tt({
					groupId: o.group.id,
					panelId: i.id
				});
				f && r !== void 0 && (f.resize(r), e.preventDefault());
			}
		}
	});
}
function pe(e) {
	const t = X$1();
	for (const [n] of t) if (n.separators.some((o) => o.element === e)) return n;
	throw Error("Could not find parent Group for separator element");
}
function nt({ groupId: e }) {
	const t = () => {
		const n = X$1();
		for (const [o, i] of n) if (o.id === e) return {
			group: o,
			...i
		};
		throw Error(`Could not find Group with id "${e}"`);
	};
	return {
		getLayout() {
			const { defaultLayoutDeferred: n, layout: o } = t();
			return n ? {} : o;
		},
		setLayout(n) {
			const { defaultLayoutDeferred: o, derivedPanelConstraints: i, group: r, groupSize: f, layout: a, separatorToPanels: s } = t(), l = U({
				layout: n,
				panelConstraints: i
			});
			return o ? a : (W(a, l) || $(r, {
				defaultLayoutDeferred: o,
				derivedPanelConstraints: i,
				groupSize: f,
				layout: l,
				separatorToPanels: s
			}), l);
		}
	};
}
function B(e, t) {
	const n = pe(e), o = H(n.id, !0), i = n.separators.find((h) => h.element === e);
	C(i, "Matching separator not found");
	const r = o.separatorToPanels.get(i);
	C(r, "Matching panels not found");
	const f = r.map((h) => n.panels.indexOf(h)), s = nt({ groupId: n.id }).getLayout(), u = U({
		layout: le({
			delta: t,
			initialLayout: s,
			panelConstraints: o.derivedPanelConstraints,
			pivotIndices: f,
			prevLayout: s,
			trigger: "keyboard"
		}),
		panelConstraints: o.derivedPanelConstraints
	});
	W(s, u) || $(n, {
		defaultLayoutDeferred: o.defaultLayoutDeferred,
		derivedPanelConstraints: o.derivedPanelConstraints,
		groupSize: o.groupSize,
		layout: u,
		separatorToPanels: o.separatorToPanels
	});
}
function Ge(e) {
	if (e.defaultPrevented) return;
	const t = e.currentTarget, n = pe(t);
	if (!n.disabled) switch (e.key) {
		case "ArrowDown":
			e.preventDefault(), n.orientation === "vertical" && B(t, 5);
			break;
		case "ArrowLeft":
			e.preventDefault(), n.orientation === "horizontal" && B(t, -5);
			break;
		case "ArrowRight":
			e.preventDefault(), n.orientation === "horizontal" && B(t, 5);
			break;
		case "ArrowUp":
			e.preventDefault(), n.orientation === "vertical" && B(t, -5);
			break;
		case "End":
			e.preventDefault(), B(t, 100);
			break;
		case "Enter": {
			e.preventDefault();
			const o = pe(t), { derivedPanelConstraints: r, layout: f, separatorToPanels: a } = H(o.id, !0), s = o.separators.find((d) => d.element === t);
			C(s, "Matching separator not found");
			const l = a.get(s);
			C(l, "Matching panels not found");
			const u = l[0], h = r.find((d) => d.panelId === u.id);
			if (C(h, "Panel metadata not found"), h.collapsible) {
				const d = f[u.id];
				B(t, (h.collapsedSize === d ? o.mutableState.expandedPanelSizes[u.id] ?? h.minSize : h.collapsedSize) - d);
			}
			break;
		}
		case "F6": {
			e.preventDefault();
			const i = pe(t).separators.map((s) => s.element), r = Array.from(i).findIndex((s) => s === e.currentTarget);
			C(r !== null, "Index not found");
			i[e.shiftKey ? r > 0 ? r - 1 : i.length - 1 : r + 1 < i.length ? r + 1 : 0].focus({ preventScroll: !0 });
			break;
		}
		case "Home":
			e.preventDefault(), B(t, -100);
			break;
	}
}
var ee = {
	cursorFlags: 0,
	state: "inactive"
};
var Pe = new Ze();
function K() {
	return ee;
}
function Gt(e) {
	return Pe.addListener("change", e);
}
function At(e) {
	const t = ee, n = { ...ee };
	n.cursorFlags = e, ee = n, Pe.emit("change", {
		prev: t,
		next: n
	});
}
function te(e) {
	const t = ee;
	ee = e, Pe.emit("change", {
		prev: t,
		next: e
	});
}
function Ae(e) {
	if (e.defaultPrevented) return;
	if (e.pointerType === "mouse" && e.button > 0) return;
	const t = X$1(), n = xe(e, t), o = /* @__PURE__ */ new Map();
	let i = !1;
	n.forEach((r) => {
		r.separator && (i || (i = !0, r.separator.element.focus({
			focusVisible: !1,
			preventScroll: !0
		})));
		const f = t.get(r.group);
		f && o.set(r.group, f.layout);
	}), te({
		cursorFlags: 0,
		hitRegions: n,
		initialLayoutMap: o,
		pointerDownAtPoint: {
			x: e.clientX,
			y: e.clientY
		},
		state: "active"
	}), n.length && e.preventDefault();
}
var Ft = (e) => e, ye = () => {}, ot = 1, it = 2, rt = 4, st = 8, Fe = 3, Ne = 12;
var de;
function _e() {
	return de === void 0 && (de = !1, typeof window < "u" && (window.navigator.userAgent.includes("Chrome") || window.navigator.userAgent.includes("Firefox")) && (de = !0)), de;
}
function Nt({ cursorFlags: e, groups: t, state: n }) {
	let o = 0, i = 0;
	switch (n) {
		case "active":
		case "hover": t.forEach((r) => {
			if (!r.mutableState.disableCursor) switch (r.orientation) {
				case "horizontal":
					o++;
					break;
				case "vertical":
					i++;
					break;
			}
		});
	}
	if (!(o === 0 && i === 0)) {
		switch (n) {
			case "active":
				if (e && _e()) {
					const r = (e & ot) !== 0, f = (e & it) !== 0, a = (e & rt) !== 0, s = (e & st) !== 0;
					if (r) return a ? "se-resize" : s ? "ne-resize" : "e-resize";
					if (f) return a ? "sw-resize" : s ? "nw-resize" : "w-resize";
					if (a) return "s-resize";
					if (s) return "n-resize";
				}
				break;
		}
		return _e() ? o > 0 && i > 0 ? "move" : o > 0 ? "ew-resize" : "ns-resize" : o > 0 && i > 0 ? "grab" : o > 0 ? "col-resize" : "row-resize";
	}
}
var $e = /* @__PURE__ */ new WeakMap();
function we(e) {
	if (e.defaultView === null || e.defaultView === void 0) return;
	let { prevStyle: t, styleSheet: n } = $e.get(e) ?? {};
	n === void 0 && (n = new e.defaultView.CSSStyleSheet(), e.adoptedStyleSheets && (Object.isExtensible(e.adoptedStyleSheets) ? e.adoptedStyleSheets.push(n) : e.adoptedStyleSheets = [...e.adoptedStyleSheets, n]));
	const o = K();
	switch (o.state) {
		case "active":
		case "hover": {
			const i = Nt({
				cursorFlags: o.cursorFlags,
				groups: o.hitRegions.map((f) => f.group),
				state: o.state
			}), r = `*, *:hover {cursor: ${i} !important; }`;
			if (t === r) return;
			t = r, i ? n.cssRules.length === 0 ? n.insertRule(r) : n.replaceSync(r) : n.cssRules.length === 1 && n.deleteRule(0);
			break;
		}
		case "inactive":
			t = void 0, n.cssRules.length === 1 && n.deleteRule(0);
			break;
	}
	$e.set(e, {
		prevStyle: t,
		styleSheet: n
	});
}
function at({ document: e, event: t, hitRegions: n, initialLayoutMap: o, mountedGroups: i, pointerDownAtPoint: r, prevCursorFlags: f }) {
	let a = 0;
	n.forEach((l) => {
		const { group: u, groupSize: h } = l, { orientation: d, panels: S } = u, { disableCursor: z } = u.mutableState;
		let c = 0;
		r ? d === "horizontal" ? c = (t.clientX - r.x) / h * 100 : c = (t.clientY - r.y) / h * 100 : d === "horizontal" ? c = t.clientX < 0 ? -100 : 100 : c = t.clientY < 0 ? -100 : 100;
		const p = o.get(u), m = i.get(u);
		if (!p || !m) return;
		const { defaultLayoutDeferred: v, derivedPanelConstraints: b, groupSize: y, layout: g, separatorToPanels: P } = m;
		if (b && g && P) {
			const M = le({
				delta: c,
				initialLayout: p,
				panelConstraints: b,
				pivotIndices: l.panels.map((w) => S.indexOf(w)),
				prevLayout: g,
				trigger: "mouse-or-touch"
			});
			if (W(M, g)) {
				if (c !== 0 && !z) switch (d) {
					case "horizontal":
						a |= c < 0 ? ot : it;
						break;
					case "vertical":
						a |= c < 0 ? rt : st;
						break;
				}
			} else $(l.group, {
				defaultLayoutDeferred: v,
				derivedPanelConstraints: b,
				groupSize: y,
				layout: M,
				separatorToPanels: P
			});
		}
	});
	let s = 0;
	t.movementX === 0 ? s |= f & Fe : s |= a & Fe, t.movementY === 0 ? s |= f & Ne : s |= a & Ne, At(s), we(e);
}
function je(e) {
	const t = X$1(), n = K();
	switch (n.state) {
		case "active": at({
			document: e.currentTarget,
			event: e,
			hitRegions: n.hitRegions,
			initialLayoutMap: n.initialLayoutMap,
			mountedGroups: t,
			prevCursorFlags: n.cursorFlags
		});
	}
}
function He(e) {
	if (e.defaultPrevented) return;
	const t = K(), n = X$1();
	switch (t.state) {
		case "active":
			if (e.buttons === 0) {
				te({
					cursorFlags: 0,
					state: "inactive"
				}), t.hitRegions.forEach((o) => {
					const i = H(o.group.id, !0);
					$(o.group, i);
				});
				return;
			}
			for (const o of t.hitRegions) if (o.separator) {
				const { element: i } = o.separator;
				i.hasPointerCapture?.(e.pointerId) || i.setPointerCapture?.(e.pointerId);
			}
			at({
				document: e.currentTarget,
				event: e,
				hitRegions: t.hitRegions,
				initialLayoutMap: t.initialLayoutMap,
				mountedGroups: n,
				pointerDownAtPoint: t.pointerDownAtPoint,
				prevCursorFlags: t.cursorFlags
			});
			break;
		default: {
			const o = xe(e, n);
			o.length === 0 ? t.state !== "inactive" && te({
				cursorFlags: 0,
				state: "inactive"
			}) : te({
				cursorFlags: 0,
				hitRegions: o,
				state: "hover"
			}), we(e.currentTarget);
			break;
		}
	}
}
function Ve(e) {
	if (e.relatedTarget instanceof HTMLIFrameElement) switch (K().state) {
		case "hover": te({
			cursorFlags: 0,
			state: "inactive"
		});
	}
}
function Be(e) {
	if (e.defaultPrevented) return;
	if (e.pointerType === "mouse" && e.button > 0) return;
	const t = K();
	switch (t.state) {
		case "active": te({
			cursorFlags: 0,
			state: "inactive"
		}), t.hitRegions.length > 0 && (we(e.currentTarget), t.hitRegions.forEach((n) => {
			const o = H(n.group.id, !0);
			$(n.group, o);
		}), e.preventDefault());
	}
}
function We(e) {
	let t = 0, n = 0;
	const o = {};
	for (const r of e) if (r.defaultSize !== void 0) {
		t++;
		const f = O(r.defaultSize);
		n += f, o[r.panelId] = f;
	} else o[r.panelId] = void 0;
	const i = e.length - t;
	if (i !== 0) {
		const r = O((100 - n) / i);
		for (const f of e) f.defaultSize === void 0 && (o[f.panelId] = r);
	}
	return o;
}
function _t(e, t, n) {
	if (!n[0]) return;
	const i = e.panels.find((l) => l.element === t);
	if (!i || !i.onResize) return;
	const r = ne({ group: e }), f = e.orientation === "horizontal" ? i.element.offsetWidth : i.element.offsetHeight, a = i.mutableValues.prevSize, s = {
		asPercentage: O(f / r * 100),
		inPixels: f
	};
	i.mutableValues.prevSize = s, i.onResize(s, i.id, a);
}
function $t(e, t) {
	if (Object.keys(e).length !== Object.keys(t).length) return !1;
	for (const o in e) if (e[o] !== t[o]) return !1;
	return !0;
}
function jt({ group: e, nextGroupSize: t, prevGroupSize: n, prevLayout: o }) {
	if (n <= 0 || t <= 0 || n === t) return o;
	let i = 0, r = 0, f = !1;
	const a = /* @__PURE__ */ new Map(), s = [];
	for (const h of e.panels) {
		const d = o[h.id] ?? 0;
		switch (h.panelConstraints.groupResizeBehavior) {
			case "preserve-pixel-size": {
				f = !0;
				const z = O(d / 100 * n / t * 100);
				a.set(h.id, z), i += z;
				break;
			}
			default:
				s.push(h.id), r += d;
				break;
		}
	}
	if (!f || s.length === 0) return o;
	const l = 100 - i, u = { ...o };
	if (a.forEach((h, d) => {
		u[d] = h;
	}), r > 0) for (const h of s) u[h] = O((o[h] ?? 0) / r * l);
	else {
		const h = O(l / s.length);
		for (const d of s) u[d] = h;
	}
	return u;
}
function Ht(e, t) {
	const n = e.map((i) => i.id), o = Object.keys(t);
	if (n.length !== o.length) return !1;
	for (const i of n) if (!o.includes(i)) return !1;
	return !0;
}
var J = /* @__PURE__ */ new Map();
function Vt(e) {
	let t = !0;
	C(e.element.ownerDocument.defaultView, "Cannot register an unmounted Group");
	const n = e.element.ownerDocument.defaultView.ResizeObserver, o = /* @__PURE__ */ new Set(), i = /* @__PURE__ */ new Set(), r = new n((c) => {
		for (const p of c) {
			const { borderBoxSize: m, target: v } = p;
			if (v === e.element) {
				if (t) {
					const b = ne({ group: e });
					if (b === 0) return;
					const y = H(e.id);
					if (!y) return;
					const g = ve(e), P = y.defaultLayoutDeferred ? We(g) : y.layout, w = U({
						layout: jt({
							group: e,
							nextGroupSize: b,
							prevGroupSize: y.groupSize,
							prevLayout: P
						}),
						panelConstraints: g
					});
					if (!y.defaultLayoutDeferred && W(y.layout, w) && $t(y.derivedPanelConstraints, g) && y.groupSize === b) return;
					$(e, {
						defaultLayoutDeferred: !1,
						derivedPanelConstraints: g,
						groupSize: b,
						layout: w,
						separatorToPanels: y.separatorToPanels
					});
				}
			} else _t(e, v, m);
		}
	});
	r.observe(e.element), e.panels.forEach((c) => {
		C(!o.has(c.id), `Panel ids must be unique; id "${c.id}" was used more than once`), o.add(c.id), c.onResize && r.observe(c.element);
	});
	const f = ne({ group: e }), a = ve(e), s = e.panels.map(({ id: c }) => c).join(",");
	let l = e.mutableState.defaultLayout;
	l && (Ht(e.panels, l) || (l = void 0));
	const h = U({
		layout: e.mutableState.layouts[s] ?? l ?? We(a),
		panelConstraints: a
	}), d = e.element.ownerDocument;
	J.set(d, (J.get(d) ?? 0) + 1);
	const S = /* @__PURE__ */ new Map();
	return Je(e).forEach((c) => {
		c.separator && S.set(c.separator, c.panels);
	}), $(e, {
		defaultLayoutDeferred: f === 0,
		derivedPanelConstraints: a,
		groupSize: f,
		layout: h,
		separatorToPanels: S
	}), e.separators.forEach((c) => {
		C(!i.has(c.id), `Separator ids must be unique; id "${c.id}" was used more than once`), i.add(c.id), c.element.addEventListener("keydown", Ge);
	}), J.get(d) === 1 && (d.addEventListener("dblclick", Te, !0), d.addEventListener("pointerdown", Ae, !0), d.addEventListener("pointerleave", je), d.addEventListener("pointermove", He), d.addEventListener("pointerout", Ve), d.addEventListener("pointerup", Be, !0)), function() {
		t = !1, J.set(d, Math.max(0, (J.get(d) ?? 0) - 1)), Lt(e), e.separators.forEach((p) => {
			p.element.removeEventListener("keydown", Ge);
		}), J.get(d) || (d.removeEventListener("dblclick", Te, !0), d.removeEventListener("pointerdown", Ae, !0), d.removeEventListener("pointerleave", je), d.removeEventListener("pointermove", He), d.removeEventListener("pointerout", Ve), d.removeEventListener("pointerup", Be, !0)), r.disconnect();
	};
}
function Bt() {
	const [e, t] = (0, import_react.useState)({});
	return [e, (0, import_react.useCallback)(() => t({}), [])];
}
function Le(e) {
	const t = (0, import_react.useId)();
	return `${e ?? t}`;
}
var q = typeof window < "u" ? import_react.useLayoutEffect : import_react.useEffect;
function se(e) {
	const t = (0, import_react.useRef)(e);
	return q(() => {
		t.current = e;
	}, [e]), (0, import_react.useCallback)((...n) => t.current?.(...n), [t]);
}
function Ce(...e) {
	return se((t) => {
		e.forEach((n) => {
			if (n) switch (typeof n) {
				case "function":
					n(t);
					break;
				case "object":
					n.current = t;
					break;
			}
		});
	});
}
function Re(e) {
	const t = (0, import_react.useRef)({ ...e });
	return q(() => {
		for (const n in e) t.current[n] = e[n];
	}, [e]), t.current;
}
var lt = (0, import_react.createContext)(null);
function Wt(e, t) {
	const n = (0, import_react.useRef)({
		getLayout: () => ({}),
		setLayout: Ft
	});
	(0, import_react.useImperativeHandle)(t, () => n.current, []), q(() => {
		Object.assign(n.current, nt({ groupId: e }));
	});
}
function Ut({ children: e, className: t, defaultLayout: n, disableCursor: o, disabled: i, elementRef: r, groupRef: f, id: a, onLayoutChange: s, onLayoutChanged: l, orientation: u = "horizontal", resizeTargetMinimumSize: h = {
	coarse: 20,
	fine: 10
}, style: d, ...S }) {
	const z = (0, import_react.useRef)({
		onLayoutChange: {},
		onLayoutChanged: {}
	}), c = se((x) => {
		W(z.current.onLayoutChange, x) || (z.current.onLayoutChange = x, s?.(x));
	}), p = se((x) => {
		W(z.current.onLayoutChanged, x) || (z.current.onLayoutChanged = x, l?.(x));
	}), m = Le(a), v = (0, import_react.useRef)(null), [b, y] = Bt(), g = (0, import_react.useRef)({
		lastExpandedPanelSizes: {},
		layouts: {},
		panels: [],
		resizeTargetMinimumSize: h,
		separators: []
	}), P = Ce(v, r);
	Wt(m, f);
	const M = se((x, L) => {
		const k = K(), R = ke(x), E = H(x);
		if (E) {
			let D = !1;
			switch (k.state) {
				case "active":
					D = k.hitRegions.some((V) => V.group === R);
					break;
			}
			return {
				flexGrow: E.layout[L] ?? 1,
				pointerEvents: D ? "none" : void 0
			};
		}
		if (n?.[L]) return { flexGrow: n?.[L] };
	}), w = Re({
		defaultLayout: n,
		disableCursor: o
	}), G = (0, import_react.useMemo)(() => ({
		get disableCursor() {
			return !!w.disableCursor;
		},
		getPanelStyles: M,
		id: m,
		orientation: u,
		registerPanel: (x) => {
			const L = g.current;
			return L.panels = be(u, [...L.panels, x]), y(), () => {
				L.panels = L.panels.filter((k) => k !== x), y();
			};
		},
		registerSeparator: (x) => {
			const L = g.current;
			return L.separators = be(u, [...L.separators, x]), y(), () => {
				L.separators = L.separators.filter((k) => k !== x), y();
			};
		},
		updatePanelProps: (x, { disabled: L }) => {
			const R = g.current.panels.find((V) => V.id === x);
			R && (R.panelConstraints.disabled = L);
			const E = ke(m), D = H(m);
			E && D && $(E, {
				...D,
				derivedPanelConstraints: ve(E)
			});
		},
		updateSeparatorProps: (x, { disabled: L, disableDoubleClick: k }) => {
			const E = g.current.separators.find((D) => D.id === x);
			E && (E.disabled = L, E.disableDoubleClick = k);
		}
	}), [
		M,
		m,
		y,
		u,
		w
	]), N = (0, import_react.useRef)(null);
	return q(() => {
		const x = v.current;
		if (x === null) return;
		const L = g.current;
		let k;
		if (w.defaultLayout !== void 0 && Object.keys(w.defaultLayout).length === L.panels.length) {
			k = {};
			for (const j of L.panels) {
				const Y = w.defaultLayout[j.id];
				Y !== void 0 && (k[j.id] = Y);
			}
		}
		const R = {
			disabled: !!i,
			element: x,
			id: m,
			mutableState: {
				defaultLayout: k,
				disableCursor: !!w.disableCursor,
				expandedPanelSizes: g.current.lastExpandedPanelSizes,
				layouts: g.current.layouts
			},
			orientation: u,
			panels: L.panels,
			resizeTargetMinimumSize: L.resizeTargetMinimumSize,
			separators: L.separators
		};
		N.current = R;
		const E = Vt(R), { defaultLayoutDeferred: D, derivedPanelConstraints: V, layout: ue } = H(R.id, !0);
		!D && V.length > 0 && (c(ue), p(ue));
		const oe = ze(m, (j) => {
			const { defaultLayoutDeferred: Y, derivedPanelConstraints: Ee, layout: ce } = j.next;
			if (Y || Ee.length === 0) return;
			const ut = R.panels.map(({ id: _ }) => _).join(",");
			R.mutableState.layouts[ut] = ce, Ee.forEach((_) => {
				if (_.collapsible) {
					const { layout: ge } = j.prev ?? {};
					if (ge) {
						const ft = I$1(_.collapsedSize, ce[_.panelId]), dt = I$1(_.collapsedSize, ge[_.panelId]);
						ft && !dt && (R.mutableState.expandedPanelSizes[_.panelId] = ge[_.panelId]);
					}
				}
			});
			const ct = K().state !== "active";
			c(ce), ct && p(ce);
		});
		return () => {
			N.current = null, E(), oe();
		};
	}, [
		i,
		m,
		p,
		c,
		u,
		b,
		w
	]), (0, import_react.useEffect)(() => {
		const x = N.current;
		x && (x.mutableState.defaultLayout = n, x.mutableState.disableCursor = !!o);
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(lt.Provider, {
		value: G,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			...S,
			className: t,
			"data-group": !0,
			"data-testid": m,
			id: m,
			ref: P,
			style: {
				height: "100%",
				width: "100%",
				overflow: "hidden",
				...d,
				display: "flex",
				flexDirection: u === "horizontal" ? "row" : "column",
				flexWrap: "nowrap",
				touchAction: u === "horizontal" ? "pan-y" : "pan-x"
			},
			children: e
		})
	});
}
Ut.displayName = "Group";
function Me() {
	const e = (0, import_react.useContext)(lt);
	return C(e, "Group Context not found; did you render a Panel or Separator outside of a Group?"), e;
}
function qt(e, t) {
	const { id: n } = Me(), o = (0, import_react.useRef)({
		collapse: ye,
		expand: ye,
		getSize: () => ({
			asPercentage: 0,
			inPixels: 0
		}),
		isCollapsed: () => !1,
		resize: ye
	});
	(0, import_react.useImperativeHandle)(t, () => o.current, []), q(() => {
		Object.assign(o.current, tt({
			groupId: n,
			panelId: e
		}));
	});
}
function Yt({ children: e, className: t, collapsedSize: n = "0%", collapsible: o = !1, defaultSize: i, disabled: r, elementRef: f, groupResizeBehavior: a = "preserve-relative-size", id: s, maxSize: l = "100%", minSize: u = "0%", onResize: h, panelRef: d, style: S, ...z }) {
	const c = !!s, p = Le(s), m = Re({ disabled: r }), v = (0, import_react.useRef)(null), b = Ce(v, f), { getPanelStyles: y, id: g, orientation: P, registerPanel: M, updatePanelProps: w } = Me(), G = h !== null, N = se((R, E, D) => {
		h?.(R, s, D);
	});
	q(() => {
		const R = v.current;
		if (R !== null) return M({
			element: R,
			id: p,
			idIsStable: c,
			mutableValues: {
				expandToSize: void 0,
				prevSize: void 0
			},
			onResize: G ? N : void 0,
			panelConstraints: {
				groupResizeBehavior: a,
				collapsedSize: n,
				collapsible: o,
				defaultSize: i,
				disabled: m.disabled,
				maxSize: l,
				minSize: u
			}
		});
	}, [
		a,
		n,
		o,
		i,
		G,
		p,
		c,
		l,
		u,
		N,
		M,
		m
	]), (0, import_react.useEffect)(() => {
		w(p, { disabled: r });
	}, [
		r,
		p,
		w
	]), qt(p, d);
	const x = () => {
		const R = y(g, p);
		if (R) return JSON.stringify(R);
	}, L = (0, import_react.useSyncExternalStore)((R) => ze(g, R), x, x);
	let k;
	return L ? k = JSON.parse(L) : i !== void 0 ? k = {
		flexGrow: void 0,
		flexShrink: void 0,
		flexBasis: i
	} : k = { flexGrow: 1 }, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		...z,
		"data-disabled": r || void 0,
		"data-panel": !0,
		"data-testid": p,
		id: p,
		ref: b,
		style: {
			...Jt,
			display: "flex",
			flexBasis: 0,
			flexShrink: 1,
			overflow: "visible",
			...k
		},
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: t,
			style: {
				maxHeight: "100%",
				maxWidth: "100%",
				flexGrow: 1,
				overflow: "auto",
				...S,
				touchAction: P === "horizontal" ? "pan-y" : "pan-x"
			},
			children: e
		})
	});
}
Yt.displayName = "Panel";
var Jt = {
	minHeight: 0,
	maxHeight: "100%",
	height: "auto",
	minWidth: 0,
	maxWidth: "100%",
	width: "auto",
	border: "none",
	borderWidth: 0,
	padding: 0,
	margin: 0
};
function Zt({ layout: e, panelConstraints: t, panelId: n, panelIndex: o }) {
	let i, r;
	const f = e[n], a = t.find((s) => s.panelId === n);
	if (a) {
		const s = a.maxSize, l = a.collapsible ? a.collapsedSize : a.minSize, u = [o, o + 1];
		r = U({
			layout: le({
				delta: l - f,
				initialLayout: e,
				panelConstraints: t,
				pivotIndices: u,
				prevLayout: e
			}),
			panelConstraints: t
		})[n], i = U({
			layout: le({
				delta: s - f,
				initialLayout: e,
				panelConstraints: t,
				pivotIndices: u,
				prevLayout: e
			}),
			panelConstraints: t
		})[n];
	}
	return {
		valueControls: n,
		valueMax: i,
		valueMin: r,
		valueNow: f
	};
}
function Qt({ children: e, className: t, disabled: n, disableDoubleClick: o, elementRef: i, id: r, style: f, ...a }) {
	const s = Le(r), l = Re({
		disabled: n,
		disableDoubleClick: o
	}), [u, h] = (0, import_react.useState)({}), [d, S] = (0, import_react.useState)("inactive"), [z, c] = (0, import_react.useState)(!1), p = (0, import_react.useRef)(null), m = Ce(p, i), { disableCursor: v, id: b, orientation: y, registerSeparator: g, updateSeparatorProps: P } = Me(), M = y === "horizontal" ? "vertical" : "horizontal";
	q(() => {
		const N = p.current;
		if (N !== null) {
			const x = {
				disabled: l.disabled,
				disableDoubleClick: l.disableDoubleClick,
				element: N,
				id: s
			}, L = g(x), k = Gt((E) => {
				S(E.next.state !== "inactive" && E.next.hitRegions.some((D) => D.separator === x) ? E.next.state : "inactive");
			}), R = ze(b, (E) => {
				const { derivedPanelConstraints: D, layout: V, separatorToPanels: ue } = E.next, oe = ue.get(x);
				if (oe) {
					const j = oe[0], Y = oe.indexOf(j);
					h(Zt({
						layout: V,
						panelConstraints: D,
						panelId: j.id,
						panelIndex: Y
					}));
				}
			});
			return () => {
				k(), R(), L();
			};
		}
	}, [
		b,
		s,
		g,
		l
	]), (0, import_react.useEffect)(() => {
		P(s, {
			disabled: n,
			disableDoubleClick: o
		});
	}, [
		n,
		o,
		s,
		P
	]);
	let w;
	n && !v && (w = "not-allowed");
	let G;
	if (n) G = "disabled";
	else switch (d) {
		case "active":
			G = "active";
			break;
		default: z ? G = "focus" : G = d;
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		...a,
		"aria-controls": u.valueControls,
		"aria-disabled": n || void 0,
		"aria-orientation": M,
		"aria-valuemax": u.valueMax,
		"aria-valuemin": u.valueMin,
		"aria-valuenow": u.valueNow,
		children: e,
		className: t,
		"data-separator": G,
		"data-testid": s,
		id: s,
		onBlur: () => c(!1),
		onFocus: () => c(!0),
		ref: m,
		role: "separator",
		style: {
			flexBasis: "auto",
			cursor: w,
			...f,
			flexGrow: 0,
			flexShrink: 0,
			touchAction: "none"
		},
		tabIndex: n ? void 0 : 0
	});
}
Qt.displayName = "Separator";
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var ArrowRight = createLucideIcon("arrow-right", [["path", {
	d: "M5 12h14",
	key: "1ays0h"
}], ["path", {
	d: "m12 5 7 7-7 7",
	key: "xquz4c"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var ArrowUp = createLucideIcon("arrow-up", [["path", {
	d: "m5 12 7-7 7 7",
	key: "hav0vg"
}], ["path", {
	d: "M12 19V5",
	key: "x0mq9r"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Bell = createLucideIcon("bell", [["path", {
	d: "M10.268 21a2 2 0 0 0 3.464 0",
	key: "vwvbt9"
}], ["path", {
	d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
	key: "11g9vi"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Brain = createLucideIcon("brain", [
	["path", {
		d: "M12 18V5",
		key: "adv99a"
	}],
	["path", {
		d: "M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4",
		key: "1e3is1"
	}],
	["path", {
		d: "M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5",
		key: "1gqd8o"
	}],
	["path", {
		d: "M17.997 5.125a4 4 0 0 1 2.526 5.77",
		key: "iwvgf7"
	}],
	["path", {
		d: "M18 18a4 4 0 0 0 2-7.464",
		key: "efp6ie"
	}],
	["path", {
		d: "M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517",
		key: "1gq6am"
	}],
	["path", {
		d: "M6 18a4 4 0 0 1-2-7.464",
		key: "k1g0md"
	}],
	["path", {
		d: "M6.003 5.125a4 4 0 0 0-2.526 5.77",
		key: "q97ue3"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Check = createLucideIcon("check", [["path", {
	d: "M20 6 9 17l-5-5",
	key: "1gmf2c"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var ChevronDown = createLucideIcon("chevron-down", [["path", {
	d: "m6 9 6 6 6-6",
	key: "qrunsl"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var ChevronRight = createLucideIcon("chevron-right", [["path", {
	d: "m9 18 6-6-6-6",
	key: "mthhwq"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Circle = createLucideIcon("circle", [["circle", {
	cx: "12",
	cy: "12",
	r: "10",
	key: "1mglay"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Clock = createLucideIcon("clock", [["circle", {
	cx: "12",
	cy: "12",
	r: "10",
	key: "1mglay"
}], ["path", {
	d: "M12 6v6l4 2",
	key: "mmk7yg"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Copy = createLucideIcon("copy", [["rect", {
	width: "14",
	height: "14",
	x: "8",
	y: "8",
	rx: "2",
	ry: "2",
	key: "17jyea"
}], ["path", {
	d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
	key: "zix9uf"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var CornerDownRight = createLucideIcon("corner-down-right", [["path", {
	d: "m15 10 5 5-5 5",
	key: "qqa56n"
}], ["path", {
	d: "M4 4v7a4 4 0 0 0 4 4h12",
	key: "z08zvw"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Dot = createLucideIcon("dot", [["circle", {
	cx: "12.1",
	cy: "12.1",
	r: "1",
	key: "18d7e5"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Globe = createLucideIcon("globe", [
	["circle", {
		cx: "12",
		cy: "12",
		r: "10",
		key: "1mglay"
	}],
	["path", {
		d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",
		key: "13o1zl"
	}],
	["path", {
		d: "M2 12h20",
		key: "9i4pu4"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Heart = createLucideIcon("heart", [["path", {
	d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
	key: "mvr1a0"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var House = createLucideIcon("house", [["path", {
	d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",
	key: "5wwlr5"
}], ["path", {
	d: "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
	key: "r6nss1"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Image = createLucideIcon("image", [
	["rect", {
		width: "18",
		height: "18",
		x: "3",
		y: "3",
		rx: "2",
		ry: "2",
		key: "1m3agn"
	}],
	["circle", {
		cx: "9",
		cy: "9",
		r: "2",
		key: "af1f0g"
	}],
	["path", {
		d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
		key: "1xmnt7"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Inbox = createLucideIcon("inbox", [["polyline", {
	points: "22 12 16 12 14 15 10 15 8 12 2 12",
	key: "o97t9d"
}], ["path", {
	d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
	key: "oot6mr"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Lightbulb = createLucideIcon("lightbulb", [
	["path", {
		d: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5",
		key: "1gvzjb"
	}],
	["path", {
		d: "M9 18h6",
		key: "x1upvd"
	}],
	["path", {
		d: "M10 22h4",
		key: "ceow96"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Link = createLucideIcon("link", [["path", {
	d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
	key: "1cjeqo"
}], ["path", {
	d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
	key: "19qd67"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Loader = createLucideIcon("loader", [
	["path", {
		d: "M12 2v4",
		key: "3427ic"
	}],
	["path", {
		d: "m16.2 7.8 2.9-2.9",
		key: "r700ao"
	}],
	["path", {
		d: "M18 12h4",
		key: "wj9ykh"
	}],
	["path", {
		d: "m16.2 16.2 2.9 2.9",
		key: "1bxg5t"
	}],
	["path", {
		d: "M12 18v4",
		key: "jadmvz"
	}],
	["path", {
		d: "m4.9 19.1 2.9-2.9",
		key: "bwix9q"
	}],
	["path", {
		d: "M2 12h4",
		key: "j09sii"
	}],
	["path", {
		d: "m4.9 4.9 2.9 2.9",
		key: "giyufr"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Lock = createLucideIcon("lock", [["rect", {
	width: "18",
	height: "11",
	x: "3",
	y: "11",
	rx: "2",
	ry: "2",
	key: "1w4ew1"
}], ["path", {
	d: "M7 11V7a5 5 0 0 1 10 0v4",
	key: "fwvmzm"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Mail = createLucideIcon("mail", [["path", {
	d: "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",
	key: "132q7q"
}], ["rect", {
	x: "2",
	y: "4",
	width: "20",
	height: "16",
	rx: "2",
	key: "izxlao"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Menu = createLucideIcon("menu", [
	["path", {
		d: "M4 5h16",
		key: "1tepv9"
	}],
	["path", {
		d: "M4 12h16",
		key: "1lakjw"
	}],
	["path", {
		d: "M4 19h16",
		key: "1djgab"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var MessageCircle = createLucideIcon("message-circle", [["path", {
	d: "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719",
	key: "1sd12s"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Monitor = createLucideIcon("monitor", [
	["rect", {
		width: "20",
		height: "14",
		x: "2",
		y: "3",
		rx: "2",
		key: "48i651"
	}],
	["line", {
		x1: "8",
		x2: "16",
		y1: "21",
		y2: "21",
		key: "1svkeh"
	}],
	["line", {
		x1: "12",
		x2: "12",
		y1: "17",
		y2: "21",
		key: "vw1qmm"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Moon = createLucideIcon("moon", [["path", {
	d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401",
	key: "kfwtm"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Paintbrush = createLucideIcon("paintbrush", [
	["path", {
		d: "m14.622 17.897-10.68-2.913",
		key: "vj2p1u"
	}],
	["path", {
		d: "M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z",
		key: "18tc5c"
	}],
	["path", {
		d: "M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15",
		key: "ytzfxy"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Palette = createLucideIcon("palette", [
	["path", {
		d: "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z",
		key: "e79jfc"
	}],
	["circle", {
		cx: "13.5",
		cy: "6.5",
		r: ".5",
		fill: "currentColor",
		key: "1okk4w"
	}],
	["circle", {
		cx: "17.5",
		cy: "10.5",
		r: ".5",
		fill: "currentColor",
		key: "f64h9f"
	}],
	["circle", {
		cx: "6.5",
		cy: "12.5",
		r: ".5",
		fill: "currentColor",
		key: "qy21gx"
	}],
	["circle", {
		cx: "8.5",
		cy: "7.5",
		r: ".5",
		fill: "currentColor",
		key: "fotxhn"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Pause = createLucideIcon("pause", [["rect", {
	x: "14",
	y: "3",
	width: "5",
	height: "18",
	rx: "1",
	key: "kaeet6"
}], ["rect", {
	x: "5",
	y: "3",
	width: "5",
	height: "18",
	rx: "1",
	key: "1wsw3u"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Pencil = createLucideIcon("pencil", [["path", {
	d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
	key: "1a8usu"
}], ["path", {
	d: "m15 5 4 4",
	key: "1mk7zo"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Pipette = createLucideIcon("pipette", [
	["path", {
		d: "m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12",
		key: "1y3wsu"
	}],
	["path", {
		d: "m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z",
		key: "110lr1"
	}],
	["path", {
		d: "m2 22 .414-.414",
		key: "jhxm08"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Play = createLucideIcon("play", [["path", {
	d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z",
	key: "10ikf1"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Plus = createLucideIcon("plus", [["path", {
	d: "M5 12h14",
	key: "1ays0h"
}], ["path", {
	d: "M12 5v14",
	key: "s699le"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var RectangleHorizontal = createLucideIcon("rectangle-horizontal", [["rect", {
	width: "20",
	height: "12",
	x: "2",
	y: "6",
	rx: "2",
	key: "9lu3g6"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Rocket = createLucideIcon("rocket", [
	["path", {
		d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
		key: "qeys4"
	}],
	["path", {
		d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09",
		key: "u4xsad"
	}],
	["path", {
		d: "M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z",
		key: "676m9"
	}],
	["path", {
		d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05",
		key: "92ym6u"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var RotateCcw = createLucideIcon("rotate-ccw", [["path", {
	d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
	key: "1357e3"
}], ["path", {
	d: "M3 3v5h5",
	key: "1xhq8a"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Search = createLucideIcon("search", [["path", {
	d: "m21 21-4.34-4.34",
	key: "14j7rj"
}], ["circle", {
	cx: "11",
	cy: "11",
	r: "8",
	key: "4ej97u"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Settings = createLucideIcon("settings", [["path", {
	d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
	key: "1i5ecw"
}], ["circle", {
	cx: "12",
	cy: "12",
	r: "3",
	key: "1v7zrd"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Shield = createLucideIcon("shield", [["path", {
	d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
	key: "oel41y"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var SkipForward = createLucideIcon("skip-forward", [["path", {
	d: "M21 4v16",
	key: "7j8fe9"
}], ["path", {
	d: "M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z",
	key: "zs4d6"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var SquareLibrary = createLucideIcon("square-library", [
	["rect", {
		width: "18",
		height: "18",
		x: "3",
		y: "3",
		rx: "2",
		key: "afitv7"
	}],
	["path", {
		d: "M7 7v10",
		key: "d5nglc"
	}],
	["path", {
		d: "M11 7v10",
		key: "pptsnr"
	}],
	["path", {
		d: "m15 7 2 10",
		key: "1m7qm5"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Star = createLucideIcon("star", [["path", {
	d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
	key: "r04s7s"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Sun = createLucideIcon("sun", [
	["circle", {
		cx: "12",
		cy: "12",
		r: "4",
		key: "4exip2"
	}],
	["path", {
		d: "M12 2v2",
		key: "tus03m"
	}],
	["path", {
		d: "M12 20v2",
		key: "1lh1kg"
	}],
	["path", {
		d: "m4.93 4.93 1.41 1.41",
		key: "149t6j"
	}],
	["path", {
		d: "m17.66 17.66 1.41 1.41",
		key: "ptbguv"
	}],
	["path", {
		d: "M2 12h2",
		key: "1t8f8n"
	}],
	["path", {
		d: "M20 12h2",
		key: "1q8mjw"
	}],
	["path", {
		d: "m6.34 17.66-1.41 1.41",
		key: "1m8zz5"
	}],
	["path", {
		d: "m19.07 4.93-1.41 1.41",
		key: "1shlcs"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var User = createLucideIcon("user", [["path", {
	d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",
	key: "975kel"
}], ["circle", {
	cx: "12",
	cy: "7",
	r: "4",
	key: "17ys0d"
}]]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Users = createLucideIcon("users", [
	["path", {
		d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
		key: "1yyitq"
	}],
	["path", {
		d: "M16 3.128a4 4 0 0 1 0 7.744",
		key: "16gr8j"
	}],
	["path", {
		d: "M22 21v-2a4 4 0 0 0-3-3.87",
		key: "kshegd"
	}],
	["circle", {
		cx: "9",
		cy: "7",
		r: "4",
		key: "nufk8"
	}]
]);
/**
* @license lucide-react v1.17.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var X = createLucideIcon("x", [["path", {
	d: "M18 6 6 18",
	key: "1bl5f8"
}], ["path", {
	d: "m6 6 12 12",
	key: "d8bk6v"
}]]);
//#endregion
//#region src/components/theme-toggle.tsx
var ICONS = {
	light: Sun,
	dark: Moon,
	system: Monitor
};
var LABELS = {
	light: "Light theme",
	dark: "Dark theme",
	system: "System theme"
};
function ThemeToggle(t0) {
	const $ = (0, import_compiler_runtime.c)(10);
	const { className } = t0;
	const { theme, cycleTheme } = useTheme();
	const Icon = ICONS[theme];
	const t1 = `${LABELS[theme]}. Click to cycle.`;
	const t2 = LABELS[theme];
	let t3;
	if ($[0] !== className) {
		t3 = cn("inline-flex size-8 items-center justify-center rounded-md", "text-muted-foreground hover:text-foreground hover:bg-accent", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", "transition-colors", className);
		$[0] = className;
		$[1] = t3;
	} else t3 = $[1];
	let t4;
	if ($[2] !== Icon) {
		t4 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { className: "size-4" });
		$[2] = Icon;
		$[3] = t4;
	} else t4 = $[3];
	let t5;
	if ($[4] !== cycleTheme || $[5] !== t1 || $[6] !== t2 || $[7] !== t3 || $[8] !== t4) {
		t5 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			onClick: cycleTheme,
			"aria-label": t1,
			title: t2,
			className: t3,
			children: t4
		});
		$[4] = cycleTheme;
		$[5] = t1;
		$[6] = t2;
		$[7] = t3;
		$[8] = t4;
		$[9] = t5;
	} else t5 = $[9];
	return t5;
}
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/ArrowCounterClockwise.es.js
var e$32 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M228,128a100,100,0,0,1-98.66,100H128a99.39,99.39,0,0,1-68.62-27.29,12,12,0,0,1,16.48-17.45,76,76,0,1,0-1.57-109c-.13.13-.25.25-.39.37L54.89,92H72a12,12,0,0,1,0,24H24a12,12,0,0,1-12-12V56a12,12,0,0,1,24,0V76.72L57.48,57.06A100,100,0,0,1,228,128Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M216,128a88,88,0,1,1-88-88A88,88,0,0,1,216,128Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L60.63,81.29l17,17A8,8,0,0,1,72,112H24a8,8,0,0,1-8-8V56A8,8,0,0,1,29.66,50.3L49.31,70,60.25,60A96,96,0,0,1,224,128Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M222,128a94,94,0,0,1-92.74,94H128a93.43,93.43,0,0,1-64.5-25.65,6,6,0,1,1,8.24-8.72A82,82,0,1,0,70,70l-.19.19L39.44,98H72a6,6,0,0,1,0,12H24a6,6,0,0,1-6-6V56a6,6,0,0,1,12,0V90.34L61.63,61.4A94,94,0,0,1,222,128Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M220,128a92,92,0,0,1-90.77,92H128a91.47,91.47,0,0,1-63.13-25.1,4,4,0,1,1,5.5-5.82A84,84,0,1,0,68.6,68.57l-.13.12L34.3,100H72a4,4,0,0,1,0,8H24a4,4,0,0,1-4-4V56a4,4,0,0,1,8,0V94.89l35-32A92,92,0,0,1,220,128Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/ArrowElbowDownRight.es.js
var a$21 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224.49,184.49l-48,48a12,12,0,0,1-17-17L187,188H72a12,12,0,0,1-12-12V32a12,12,0,0,1,24,0V164H187l-27.52-27.51a12,12,0,1,1,17-17l48,48A12,12,0,0,1,224.49,184.49Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M216,176l-48,48V128Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M221.66,170.34l-48-48A8,8,0,0,0,160,128v40H80V32a8,8,0,0,0-16,0V176a8,8,0,0,0,8,8h88v40a8,8,0,0,0,13.66,5.66l48-48A8,8,0,0,0,221.66,170.34ZM176,204.69V147.31L204.69,176Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M221.66,181.66l-48,48A8,8,0,0,1,160,224V184H72a8,8,0,0,1-8-8V32a8,8,0,0,1,16,0V168h80V128a8,8,0,0,1,13.66-5.66l48,48A8,8,0,0,1,221.66,181.66Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M220.24,180.24l-48,48a6,6,0,0,1-8.48-8.48L201.51,182H72a6,6,0,0,1-6-6V32a6,6,0,0,1,12,0V170H201.51l-37.75-37.76a6,6,0,1,1,8.48-8.48l48,48A6,6,0,0,1,220.24,180.24Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M221.66,181.66l-48,48a8,8,0,0,1-11.32-11.32L196.69,184H72a8,8,0,0,1-8-8V32a8,8,0,0,1,16,0V168H196.69l-34.35-34.34a8,8,0,0,1,11.32-11.32l48,48A8,8,0,0,1,221.66,181.66Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M218.83,178.83l-48,48a4,4,0,0,1-5.66-5.66L206.34,180H72a4,4,0,0,1-4-4V32a4,4,0,0,1,8,0V172H206.34l-41.17-41.17a4,4,0,1,1,5.66-5.66l48,48A4,4,0,0,1,218.83,178.83Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/ArrowLeft.es.js
var a$20 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M228,128a12,12,0,0,1-12,12H69l51.52,51.51a12,12,0,0,1-17,17l-72-72a12,12,0,0,1,0-17l72-72a12,12,0,0,1,17,17L69,116H216A12,12,0,0,1,228,128Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M112,56V200L40,128Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M216,120H120V56a8,8,0,0,0-13.66-5.66l-72,72a8,8,0,0,0,0,11.32l72,72A8,8,0,0,0,120,200V136h96a8,8,0,0,0,0-16ZM104,180.69,51.31,128,104,75.31Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,128a8,8,0,0,1-8,8H120v64a8,8,0,0,1-13.66,5.66l-72-72a8,8,0,0,1,0-11.32l72-72A8,8,0,0,1,120,56v64h96A8,8,0,0,1,224,128Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M222,128a6,6,0,0,1-6,6H54.49l61.75,61.76a6,6,0,1,1-8.48,8.48l-72-72a6,6,0,0,1,0-8.48l72-72a6,6,0,0,1,8.48,8.48L54.49,122H216A6,6,0,0,1,222,128Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M220,128a4,4,0,0,1-4,4H49.66l65.17,65.17a4,4,0,0,1-5.66,5.66l-72-72a4,4,0,0,1,0-5.66l72-72a4,4,0,0,1,5.66,5.66L49.66,124H216A4,4,0,0,1,220,128Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/ArrowRight.es.js
var a$19 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224.49,136.49l-72,72a12,12,0,0,1-17-17L187,140H40a12,12,0,0,1,0-24H187L135.51,64.48a12,12,0,0,1,17-17l72,72A12,12,0,0,1,224.49,136.49Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M216,128l-72,72V56Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M221.66,122.34l-72-72A8,8,0,0,0,136,56v64H40a8,8,0,0,0,0,16h96v64a8,8,0,0,0,13.66,5.66l72-72A8,8,0,0,0,221.66,122.34ZM152,180.69V75.31L204.69,128Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M221.66,133.66l-72,72A8,8,0,0,1,136,200V136H40a8,8,0,0,1,0-16h96V56a8,8,0,0,1,13.66-5.66l72,72A8,8,0,0,1,221.66,133.66Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M220.24,132.24l-72,72a6,6,0,0,1-8.48-8.48L201.51,134H40a6,6,0,0,1,0-12H201.51L139.76,60.24a6,6,0,0,1,8.48-8.48l72,72A6,6,0,0,1,220.24,132.24Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M218.83,130.83l-72,72a4,4,0,0,1-5.66-5.66L206.34,132H40a4,4,0,0,1,0-8H206.34L141.17,58.83a4,4,0,0,1,5.66-5.66l72,72A4,4,0,0,1,218.83,130.83Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/ArrowUp.es.js
var a$18 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208.49,120.49a12,12,0,0,1-17,0L140,69V216a12,12,0,0,1-24,0V69L64.49,120.49a12,12,0,0,1-17-17l72-72a12,12,0,0,1,17,0l72,72A12,12,0,0,1,208.49,120.49Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M200,112H56l72-72Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M205.66,106.34l-72-72a8,8,0,0,0-11.32,0l-72,72A8,8,0,0,0,56,120h64v96a8,8,0,0,0,16,0V120h64a8,8,0,0,0,5.66-13.66ZM75.31,104,128,51.31,180.69,104Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M207.39,115.06A8,8,0,0,1,200,120H136v96a8,8,0,0,1-16,0V120H56a8,8,0,0,1-5.66-13.66l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,207.39,115.06Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M204.24,116.24a6,6,0,0,1-8.48,0L134,54.49V216a6,6,0,0,1-12,0V54.49L60.24,116.24a6,6,0,0,1-8.48-8.48l72-72a6,6,0,0,1,8.48,0l72,72A6,6,0,0,1,204.24,116.24Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M205.66,117.66a8,8,0,0,1-11.32,0L136,59.31V216a8,8,0,0,1-16,0V59.31L61.66,117.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,205.66,117.66Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M202.83,114.83a4,4,0,0,1-5.66,0L132,49.66V216a4,4,0,0,1-8,0V49.66L58.83,114.83a4,4,0,0,1-5.66-5.66l72-72a4,4,0,0,1,5.66,0l72,72A4,4,0,0,1,202.83,114.83Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Bell.es.js
var e$31 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M225.29,165.93C216.61,151,212,129.57,212,104a84,84,0,0,0-168,0c0,25.58-4.59,47-13.27,61.93A20.08,20.08,0,0,0,30.66,186,19.77,19.77,0,0,0,48,196H84.18a44,44,0,0,0,87.64,0H208a19.77,19.77,0,0,0,17.31-10A20.08,20.08,0,0,0,225.29,165.93ZM128,212a20,20,0,0,1-19.6-16h39.2A20,20,0,0,1,128,212ZM54.66,172C63.51,154,68,131.14,68,104a60,60,0,0,1,120,0c0,27.13,4.48,50,13.33,68Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M208,192H48a8,8,0,0,1-6.88-12C47.71,168.6,56,139.81,56,104a72,72,0,0,1,144,0c0,35.82,8.3,64.6,14.9,76A8,8,0,0,1,208,192Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M221.8,175.94C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216ZM48,184c7.7-13.24,16-43.92,16-80a64,64,0,1,1,128,0c0,36.05,8.28,66.73,16,80Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M221.8,175.94C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M220.07,176.94C214.41,167.2,206,139.73,206,104a78,78,0,1,0-156,0c0,35.74-8.42,63.2-14.08,72.94A14,14,0,0,0,48,198H90.48a38,38,0,0,0,75,0H208a14,14,0,0,0,12.06-21.06ZM128,218a26,26,0,0,1-25.29-20h50.58A26,26,0,0,1,128,218Zm81.71-33a1.9,1.9,0,0,1-1.7,1H48a1.9,1.9,0,0,1-1.7-1,2,2,0,0,1,0-2C53.87,170,62,139.69,62,104a66,66,0,1,1,132,0c0,35.68,8.14,65.95,15.71,79A2,2,0,0,1,209.71,185Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M221.8,175.94C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216ZM48,184c7.7-13.24,16-43.92,16-80a64,64,0,1,1,128,0c0,36.05,8.28,66.73,16,80Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M218.35,178C212.58,168,204,140.13,204,104a76,76,0,1,0-152,0c0,36.13-8.59,64-14.36,73.95A12,12,0,0,0,48,196H92.23a36,36,0,0,0,71.54,0H208A12,12,0,0,0,218.35,178ZM128,220a28,28,0,0,1-27.71-24h55.42A28,28,0,0,1,128,220Zm83.45-34a3.91,3.91,0,0,1-3.44,2H48a3.91,3.91,0,0,1-3.44-2,4,4,0,0,1,0-4C52,169.17,60,139.32,60,104a68,68,0,1,1,136,0c0,35.31,8,65.17,15.44,78A4,4,0,0,1,211.45,186Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Books.es.js
var e$30 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M235.57,193.73,202.38,35.93a20,20,0,0,0-23.76-15.48L131.81,30.51a19.82,19.82,0,0,0-11,6.65A20,20,0,0,0,104,28H56A20,20,0,0,0,36,48V208a20,20,0,0,0,20,20h48a20,20,0,0,0,20-20V90.25l25.62,121.82A20,20,0,0,0,169.15,228a20.27,20.27,0,0,0,4.23-.45l46.81-10.06A20.1,20.1,0,0,0,235.57,193.73ZM148.19,88.65l39-8.38,2.53,12-39,8.38Zm7.46,35.5,39-8.38,9.16,43.58-39,8.38Zm24.06-79.39,2.53,12-39,8.38-2.53-12ZM60,88h40v80H60Zm40-36V64H60V52ZM60,204V192h40v12Zm112.29-.76-2.53-12,39-8.38,2.53,12Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M48,72h64V184H48ZM190.64,38.39a8,8,0,0,0-9.5-6.21l-46.81,10a8.07,8.07,0,0,0-6.15,9.57L139.79,107l62.46-13.42Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M231.65,194.55,198.46,36.75a16,16,0,0,0-19-12.39L132.65,34.42a16.08,16.08,0,0,0-12.3,19l33.19,157.8A16,16,0,0,0,169.16,224a16.25,16.25,0,0,0,3.38-.36l46.81-10.06A16.09,16.09,0,0,0,231.65,194.55ZM136,50.15c0-.06,0-.09,0-.09l46.8-10,3.33,15.87L139.33,66Zm6.62,31.47,46.82-10.05,3.34,15.9L146,97.53Zm6.64,31.57,46.82-10.06,13.3,63.24-46.82,10.06ZM216,197.94l-46.8,10-3.33-15.87L212.67,182,216,197.85C216,197.91,216,197.94,216,197.94ZM104,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V48A16,16,0,0,0,104,32ZM56,48h48V64H56Zm0,32h48v96H56Zm48,128H56V192h48v16Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M231.65,194.55,198.46,36.75a16,16,0,0,0-19-12.39L132.65,34.42a16.08,16.08,0,0,0-12.3,19l33.19,157.8A16,16,0,0,0,169.16,224a16.25,16.25,0,0,0,3.38-.36l46.81-10.06A16.09,16.09,0,0,0,231.65,194.55ZM136,50.15c0-.06,0-.09,0-.09l46.8-10,3.33,15.87L139.33,66Zm10,47.38-3.35-15.9,46.82-10.06,3.34,15.9Zm70,100.41-46.8,10-3.33-15.87L212.67,182,216,197.85C216,197.91,216,197.94,216,197.94ZM104,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V48A16,16,0,0,0,104,32ZM56,48h48V64H56Zm48,160H56V192h48v16Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M104,34H56A14,14,0,0,0,42,48V208a14,14,0,0,0,14,14h48a14,14,0,0,0,14-14V48A14,14,0,0,0,104,34ZM54,78h52V178H54Zm2-32h48a2,2,0,0,1,2,2V66H54V48A2,2,0,0,1,56,46Zm48,164H56a2,2,0,0,1-2-2V190h52v18A2,2,0,0,1,104,210Zm125.7-15L196.51,37.16a14,14,0,0,0-16.63-10.85L133.07,36.37A14.09,14.09,0,0,0,122.3,53l33.19,157.81a14,14,0,0,0,6.1,8.9,13.85,13.85,0,0,0,7.57,2.26,13.55,13.55,0,0,0,3-.32l46.81-10.05A14.09,14.09,0,0,0,229.7,195Zm-82.81-83.32,50.73-10.9,14.12,67.16L161,178.81Zm-6.63-31.56L191,69.19,195.15,89l-50.73,10.9Zm-4.66-32,46.8-10.05a2.18,2.18,0,0,1,.42,0,1.89,1.89,0,0,1,1.05.32,2,2,0,0,1,.89,1.31l3.75,17.82L137.79,68.34l-3.74-17.78A2.07,2.07,0,0,1,135.6,48.1Zm80.81,151.8L169.6,210a1.92,1.92,0,0,1-1.47-.27,2,2,0,0,1-.89-1.31l-3.75-17.82,50.72-10.9L218,197.43A2.07,2.07,0,0,1,216.41,199.9Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M231.65,194.55,198.46,36.75a16,16,0,0,0-19-12.39L132.65,34.42a16.08,16.08,0,0,0-12.3,19l33.19,157.8A16,16,0,0,0,169.16,224a16.25,16.25,0,0,0,3.38-.36l46.81-10.06A16.09,16.09,0,0,0,231.65,194.55ZM136,50.15c0-.06,0-.09,0-.09l46.8-10,3.33,15.87L139.33,66Zm6.62,31.47,46.82-10.05,3.34,15.9L146,97.53Zm6.64,31.57,46.82-10.06,13.3,63.24-46.82,10.06ZM216,197.94l-46.8,10-3.33-15.87L212.67,182,216,197.85C216,197.91,216,197.94,216,197.94ZM104,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V48A16,16,0,0,0,104,32ZM56,48h48V64H56Zm0,32h48v96H56Zm48,128H56V192h48v16Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M104,36H56A12,12,0,0,0,44,48V208a12,12,0,0,0,12,12h48a12,12,0,0,0,12-12V48A12,12,0,0,0,104,36ZM52,76h56V180H52Zm4-32h48a4,4,0,0,1,4,4V68H52V48A4,4,0,0,1,56,44Zm48,168H56a4,4,0,0,1-4-4V188h56v20A4,4,0,0,1,104,212Zm123.74-16.62L194.55,37.57a12,12,0,0,0-14.25-9.3L133.49,38.32a12.1,12.1,0,0,0-9.23,14.3l33.19,157.81a12,12,0,0,0,14.25,9.3l46.81-10.06h0A12.08,12.08,0,0,0,227.74,195.38Zm-83.21-85.27,54.63-11.73,15,71.07-54.63,11.74Zm-6.64-31.56,54.64-11.74,5,23.74-54.64,11.73Zm-2.71-32.4L182,36.09a4,4,0,0,1,.84-.09,3.94,3.94,0,0,1,2.14.64,4,4,0,0,1,1.76,2.58L190.88,59,136.24,70.72,132.09,51A4.07,4.07,0,0,1,135.18,46.15Zm81.65,155.7L170,211.91a4,4,0,0,1-3-.55,4,4,0,0,1-1.76-2.58L161.12,189l54.64-11.73L219.91,197A4.07,4.07,0,0,1,216.83,201.85Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Brain.es.js
var e$29 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M252,124a60.14,60.14,0,0,0-32-53.08,52,52,0,0,0-92-32.11A52,52,0,0,0,36,70.92a60,60,0,0,0,0,106.14,52,52,0,0,0,92,32.13,52,52,0,0,0,92-32.13A60.05,60.05,0,0,0,252,124ZM88,204a28,28,0,0,1-26.85-20.07c1,0,1.89.07,2.85.07h8a12,12,0,0,0,0-24H64A36,36,0,0,1,52,90.05a12,12,0,0,0,8-11.32V72a28,28,0,0,1,56,0v60.18a51.61,51.61,0,0,0-7.2-3.85,12,12,0,1,0-9.6,22A28,28,0,0,1,88,204Zm104-44h-8a12,12,0,0,0,0,24h8c1,0,1.9,0,2.85-.07a28,28,0,1,1-38-33.61,12,12,0,1,0-9.6-22,51.61,51.61,0,0,0-7.2,3.85V72a28,28,0,0,1,56,0v6.73a12,12,0,0,0,8,11.32,36,36,0,0,1-12,70Zm16-44a12,12,0,0,1-12,12,40,40,0,0,1-40-40V84a12,12,0,0,1,24,0v4a16,16,0,0,0,16,16A12,12,0,0,1,208,116ZM100,88a40,40,0,0,1-40,40,12,12,0,0,1,0-24A16,16,0,0,0,76,88V84a12,12,0,0,1,24,0Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M240,124a48,48,0,0,1-32,45.27h0V176a40,40,0,0,1-80,0,40,40,0,0,1-80,0v-6.73h0a48,48,0,0,1,0-90.54V72a40,40,0,0,1,80,0,40,40,0,0,1,80,0v6.73A48,48,0,0,1,240,124Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M212,76V72a44,44,0,0,0-74.86-31.31,3.93,3.93,0,0,0-1.14,2.8v88.72a4,4,0,0,0,6.2,3.33A47.67,47.67,0,0,1,167.68,128a8.18,8.18,0,0,1,8.31,7.58,8,8,0,0,1-8,8.42,32,32,0,0,0-32,32v33.88a4,4,0,0,0,1.49,3.12,47.92,47.92,0,0,0,74.21-17.16,4,4,0,0,0-4.49-5.56A68.06,68.06,0,0,1,192,192h-7.73a8.18,8.18,0,0,1-8.25-7.47,8,8,0,0,1,8-8.53h8a51.6,51.6,0,0,0,24-5.88v0A52,52,0,0,0,212,76Zm-12,36h-4a36,36,0,0,1-36-36V72a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4a8,8,0,0,1,0,16ZM88,28A44.05,44.05,0,0,0,44,72v4a52,52,0,0,0-4,94.12h0A51.6,51.6,0,0,0,64,176h7.73A8.18,8.18,0,0,1,80,183.47,8,8,0,0,1,72,192H64a67.48,67.48,0,0,1-15.21-1.73,4,4,0,0,0-4.5,5.55A47.93,47.93,0,0,0,118.51,213a4,4,0,0,0,1.49-3.12V176a32,32,0,0,0-32-32,8,8,0,0,1-8-8.42A8.18,8.18,0,0,1,88.32,128a47.67,47.67,0,0,1,25.48,7.54,4,4,0,0,0,6.2-3.33V43.49a4,4,0,0,0-1.14-2.81A43.85,43.85,0,0,0,88,28Zm8,48a36,36,0,0,1-36,36H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,76V72a8,8,0,0,1,16,0Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M246,124a54.13,54.13,0,0,0-32-49.33V72a46,46,0,0,0-86-22.67A46,46,0,0,0,42,72v2.67a54,54,0,0,0,0,98.63V176a46,46,0,0,0,86,22.67A46,46,0,0,0,214,176v-2.7A54.07,54.07,0,0,0,246,124ZM88,210a34,34,0,0,1-34-32.94A53.67,53.67,0,0,0,64,178h8a6,6,0,0,0,0-12H64A42,42,0,0,1,50,84.39a6,6,0,0,0,4-5.66V72a34,34,0,0,1,68,0v73.05A45.89,45.89,0,0,0,88,130a6,6,0,0,0,0,12,34,34,0,0,1,0,68Zm104-44h-8a6,6,0,0,0,0,12h8a53.67,53.67,0,0,0,10-.94A34,34,0,1,1,168,142a6,6,0,0,0,0-12,45.89,45.89,0,0,0-34,15.05V72a34,34,0,0,1,68,0v6.73a6,6,0,0,0,4,5.66A42,42,0,0,1,192,166Zm14-54a6,6,0,0,1-6,6h-4a34,34,0,0,1-34-34V80a6,6,0,0,1,12,0v4a22,22,0,0,0,22,22h4A6,6,0,0,1,206,112ZM60,118H56a6,6,0,0,1,0-12h4A22,22,0,0,0,82,84V80a6,6,0,0,1,12,0v4A34,34,0,0,1,60,118Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M244,124a52.1,52.1,0,0,0-32-48V72a44,44,0,0,0-84-18.3A44,44,0,0,0,44,72v4a52,52,0,0,0,0,96v4a44,44,0,0,0,84,18.3A44,44,0,0,0,212,176v-4A52.07,52.07,0,0,0,244,124ZM88,212a36,36,0,0,1-36-36v-1.41A52.13,52.13,0,0,0,64,176h8a4,4,0,0,0,0-8H64A44,44,0,0,1,49.33,82.5,4,4,0,0,0,52,78.73V72a36,36,0,0,1,72,0v78.75A44,44,0,0,0,88,132a4,4,0,0,0,0,8,36,36,0,0,1,0,72Zm104-44h-8a4,4,0,0,0,0,8h8a52.13,52.13,0,0,0,12-1.41V176a36,36,0,1,1-36-36,4,4,0,0,0,0-8,44,44,0,0,0-36,18.75V72a36,36,0,0,1,72,0v6.73a4,4,0,0,0,2.67,3.77A44,44,0,0,1,192,168Zm12-56a4,4,0,0,1-4,4h-4a32,32,0,0,1-32-32V80a4,4,0,0,1,8,0v4a24,24,0,0,0,24,24h4A4,4,0,0,1,204,112ZM92,84a32,32,0,0,1-32,32H56a4,4,0,0,1,0-8h4A24,24,0,0,0,84,84V80a4,4,0,0,1,8,0Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/CaretDown.es.js
var t$7 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M208,96l-80,80L48,96Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M215.39,92.94A8,8,0,0,0,208,88H48a8,8,0,0,0-5.66,13.66l80,80a8,8,0,0,0,11.32,0l80-80A8,8,0,0,0,215.39,92.94ZM128,164.69,67.31,104H188.69Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,48,88H208a8,8,0,0,1,5.66,13.66Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M212.24,100.24l-80,80a6,6,0,0,1-8.48,0l-80-80a6,6,0,0,1,8.48-8.48L128,167.51l75.76-75.75a6,6,0,0,1,8.48,8.48Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M210.83,98.83l-80,80a4,4,0,0,1-5.66,0l-80-80a4,4,0,0,1,5.66-5.66L128,170.34l77.17-77.17a4,4,0,1,1,5.66,5.66Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/CaretRight.es.js
var t$6 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M176,128,96,208V48Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M181.66,122.34l-80-80A8,8,0,0,0,88,48V208a8,8,0,0,0,13.66,5.66l80-80A8,8,0,0,0,181.66,122.34ZM104,188.69V67.31L164.69,128Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M181.66,133.66l-80,80A8,8,0,0,1,88,208V48a8,8,0,0,1,13.66-5.66l80,80A8,8,0,0,1,181.66,133.66Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M180.24,132.24l-80,80a6,6,0,0,1-8.48-8.48L167.51,128,91.76,52.24a6,6,0,0,1,8.48-8.48l80,80A6,6,0,0,1,180.24,132.24Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M178.83,130.83l-80,80a4,4,0,0,1-5.66-5.66L170.34,128,93.17,50.83a4,4,0,0,1,5.66-5.66l80,80A4,4,0,0,1,178.83,130.83Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/ChatCircle.es.js
var a$17 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,20A108,108,0,0,0,31.85,177.23L21,209.66A20,20,0,0,0,46.34,235l32.43-10.81A108,108,0,1,0,128,20Zm0,192a84,84,0,0,1-42.06-11.27,12,12,0,0,0-6-1.62,12.1,12.1,0,0,0-3.8.62l-29.79,9.93,9.93-29.79a12,12,0,0,0-1-9.81A84,84,0,1,1,128,212Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M224,128A96,96,0,0,1,79.93,211.11h0L42.54,223.58a8,8,0,0,1-10.12-10.12l12.47-37.39h0A96,96,0,1,1,224,128Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M232,128A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,26A102,102,0,0,0,38.35,176.69L26.73,211.56a14,14,0,0,0,17.71,17.71l34.87-11.62A102,102,0,1,0,128,26Zm0,192a90,90,0,0,1-45.06-12.08,6.09,6.09,0,0,0-3-.81,6.2,6.2,0,0,0-1.9.31L40.65,217.88a2,2,0,0,1-2.53-2.53L50.58,178a6,6,0,0,0-.5-4.91A90,90,0,1,1,128,218Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,28A100,100,0,0,0,40.53,176.5l-11.9,35.69a12,12,0,0,0,15.18,15.18l35.69-11.9A100,100,0,1,0,128,28Zm0,192a92,92,0,0,1-46.07-12.35,4.05,4.05,0,0,0-2-.54,3.93,3.93,0,0,0-1.27.21L41.28,219.78a4,4,0,0,1-5.06-5.06l12.46-37.38a4,4,0,0,0-.33-3.27A92,92,0,1,1,128,220Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Check.es.js
var a$16 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M232,56V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M205.66,85.66l-96,96a8,8,0,0,1-11.32,0l-40-40a8,8,0,0,1,11.32-11.32L104,164.69l90.34-90.35a8,8,0,0,1,11.32,11.32Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM205.66,85.66l-96,96a8,8,0,0,1-11.32,0l-40-40a8,8,0,0,1,11.32-11.32L104,164.69l90.34-90.35a8,8,0,0,1,11.32,11.32Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M228.24,76.24l-128,128a6,6,0,0,1-8.48,0l-56-56a6,6,0,0,1,8.48-8.48L96,191.51,219.76,67.76a6,6,0,0,1,8.48,8.48Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M226.83,74.83l-128,128a4,4,0,0,1-5.66,0l-56-56a4,4,0,0,1,5.66-5.66L96,194.34,221.17,69.17a4,4,0,1,1,5.66,5.66Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Circle.es.js
var t$5 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M232,128A104,104,0,1,1,128,24,104.13,104.13,0,0,1,232,128Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,28A100,100,0,1,0,228,128,100.11,100.11,0,0,0,128,28Zm0,192a92,92,0,1,1,92-92A92.1,92.1,0,0,1,128,220Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Clock.es.js
var a$15 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Zm68-84a12,12,0,0,1-12,12H128a12,12,0,0,1-12-12V72a12,12,0,0,1,24,0v44h44A12,12,0,0,1,196,128Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm56,112H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48a8,8,0,0,1,0,16Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218Zm62-90a6,6,0,0,1-6,6H128a6,6,0,0,1-6-6V72a6,6,0,0,1,12,0v50h50A6,6,0,0,1,190,128Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,28A100,100,0,1,0,228,128,100.11,100.11,0,0,0,128,28Zm0,192a92,92,0,1,1,92-92A92.1,92.1,0,0,1,128,220Zm60-92a4,4,0,0,1-4,4H128a4,4,0,0,1-4-4V72a4,4,0,0,1,8,0v52h52A4,4,0,0,1,188,128Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Copy.es.js
var e$28 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,28H88A12,12,0,0,0,76,40V76H40A12,12,0,0,0,28,88V216a12,12,0,0,0,12,12H168a12,12,0,0,0,12-12V180h36a12,12,0,0,0,12-12V40A12,12,0,0,0,216,28ZM156,204H52V100H156Zm48-48H180V88a12,12,0,0,0-12-12H100V52H204Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M216,40V168H168V88H88V40Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32Zm-8,128H176V88a8,8,0,0,0-8-8H96V48H208Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,34H88a6,6,0,0,0-6,6V82H40a6,6,0,0,0-6,6V216a6,6,0,0,0,6,6H168a6,6,0,0,0,6-6V174h42a6,6,0,0,0,6-6V40A6,6,0,0,0,216,34ZM162,210H46V94H162Zm48-48H174V88a6,6,0,0,0-6-6H94V46H210Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,36H88a4,4,0,0,0-4,4V84H40a4,4,0,0,0-4,4V216a4,4,0,0,0,4,4H168a4,4,0,0,0,4-4V172h44a4,4,0,0,0,4-4V40A4,4,0,0,0,216,36ZM164,212H44V92H164Zm48-48H172V88a4,4,0,0,0-4-4H92V44H212Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/DotOutline.es.js
var t$4 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,96a32,32,0,1,0,32,32A32,32,0,0,0,128,96Zm0,40a8,8,0,1,1,8-8A8,8,0,0,1,128,136Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M152,128a24,24,0,1,1-24-24A24,24,0,0,1,152,128Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M128,96a32,32,0,1,0,32,32A32,32,0,0,0,128,96Zm0,48a16,16,0,1,1,16-16A16,16,0,0,1,128,144Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M156,128a28,28,0,1,1-28-28A28,28,0,0,1,156,128Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,98a30,30,0,1,0,30,30A30,30,0,0,0,128,98Zm0,48a18,18,0,1,1,18-18A18,18,0,0,1,128,146Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,96a32,32,0,1,0,32,32A32,32,0,0,0,128,96Zm0,48a16,16,0,1,1,16-16A16,16,0,0,1,128,144Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,100a28,28,0,1,0,28,28A28,28,0,0,0,128,100Zm0,48a20,20,0,1,1,20-20A20,20,0,0,1,128,148Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Envelope.es.js
var a$14 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,44H32A12,12,0,0,0,20,56V192a20,20,0,0,0,20,20H216a20,20,0,0,0,20-20V56A12,12,0,0,0,224,44Zm-96,83.72L62.85,68h130.3ZM92.79,128,44,172.72V83.28Zm17.76,16.28,9.34,8.57a12,12,0,0,0,16.22,0l9.34-8.57L193.15,188H62.85ZM163.21,128,212,83.28v89.44Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M224,56l-96,88L32,56Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48Zm-96,85.15L52.57,64H203.43ZM98.71,128,40,181.81V74.19Zm11.84,10.85,12,11.05a8,8,0,0,0,10.82,0l12-11.05,58,53.15H52.57ZM157.29,128,216,74.18V181.82Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48ZM98.71,128,40,181.81V74.19Zm11.84,10.85,12,11.05a8,8,0,0,0,10.82,0l12-11.05,58,53.15H52.57ZM157.29,128,216,74.18V181.82Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,50H32a6,6,0,0,0-6,6V192a14,14,0,0,0,14,14H216a14,14,0,0,0,14-14V56A6,6,0,0,0,224,50Zm-96,85.86L47.42,62H208.58ZM101.67,128,38,186.36V69.64Zm8.88,8.14L124,148.42a6,6,0,0,0,8.1,0l13.4-12.28L208.58,194H47.43ZM154.33,128,218,69.64V186.36Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48Zm-96,85.15L52.57,64H203.43ZM98.71,128,40,181.81V74.19Zm11.84,10.85,12,11.05a8,8,0,0,0,10.82,0l12-11.05,58,53.15H52.57ZM157.29,128,216,74.18V181.82Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,52H32a4,4,0,0,0-4,4V192a12,12,0,0,0,12,12H216a12,12,0,0,0,12-12V56A4,4,0,0,0,224,52Zm-96,86.57L42.28,60H213.72ZM104.63,128,36,190.91V65.09Zm5.92,5.43L125.3,147a4,4,0,0,0,5.4,0l14.75-13.52L213.72,196H42.28ZM151.37,128,220,65.09V190.91Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Eyedropper.es.js
var l$2 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M228,67.24a39.77,39.77,0,0,0-12.51-28.52C199.91,24,174.71,24.5,159.29,39.93L142.48,56.84a28,28,0,0,0-35.64,3.29l-9,9a20,20,0,0,0-.73,27.49L48.9,144.84A43.76,43.76,0,0,0,37,185.28l-7.5,17.19a17.66,17.66,0,0,0,3.71,19.65,19.9,19.9,0,0,0,22.15,4.19l16.31-7.13a43.88,43.88,0,0,0,39.45-12.09l48.24-48.26a20,20,0,0,0,27.47-.73l9-9a28.06,28.06,0,0,0,3.26-35.72l17.23-17.33A39.69,39.69,0,0,0,228,67.24ZM94.15,190.11a20,20,0,0,1-20,5,11.93,11.93,0,0,0-8.32.47L57,199.38,60.69,191a12,12,0,0,0,.37-8.64,19.92,19.92,0,0,1,4.81-20.55l48.2-48.22,28.28,28.3Zm105.14-111-25.37,25.52a12,12,0,0,0,0,16.95l4.88,4.89a4,4,0,0,1,0,5.66l-6.14,6.15-55-55.05,6.14-6.14a4,4,0,0,1,5.65,0L134.35,82a12,12,0,0,0,8.49,3.51h0A12,12,0,0,0,151.34,82l24.94-25.08c6.3-6.3,16.48-6.63,22.71-.74a16,16,0,0,1,.3,23Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M207.8,87.6l-25.37,25.53,4.89,4.88a16,16,0,0,1,0,22.64l-9,9a8,8,0,0,1-11.32,0l-60.68-60.7a8,8,0,0,1,0-11.32l9-9a16,16,0,0,1,22.63,0l4.88,4.89,25-25.11c10.79-10.79,28.37-11.45,39.45-1A28,28,0,0,1,207.8,87.6Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M224,67.3a35.79,35.79,0,0,0-11.26-25.66c-14-13.28-36.72-12.78-50.62,1.13L142.8,62.2a24,24,0,0,0-33.14.77l-9,9a16,16,0,0,0,0,22.64l2,2.06-51,51a39.75,39.75,0,0,0-10.53,38l-8,18.41A13.68,13.68,0,0,0,36,219.3a15.92,15.92,0,0,0,17.71,3.35L71.23,215a39.89,39.89,0,0,0,37.06-10.75l51-51,2.06,2.06a16,16,0,0,0,22.62,0l9-9a24,24,0,0,0,.74-33.18l19.75-19.87A35.75,35.75,0,0,0,224,67.3ZM97,193a24,24,0,0,1-24,6,8,8,0,0,0-5.55.31l-18.1,7.91L57,189.41a8,8,0,0,0,.25-5.75A23.88,23.88,0,0,1,63,159l51-51,33.94,34ZM202.13,82l-25.37,25.52a8,8,0,0,0,0,11.3l4.89,4.89a8,8,0,0,1,0,11.32l-9,9L112,83.26l9-9a8,8,0,0,1,11.31,0l4.89,4.89a8,8,0,0,0,5.65,2.34h0a8,8,0,0,0,5.66-2.36l24.94-25.09c7.81-7.82,20.5-8.18,28.29-.81a20,20,0,0,1,.39,28.7Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,67.3a35.79,35.79,0,0,0-11.26-25.66c-14-13.28-36.72-12.78-50.62,1.13L138.8,66.2a24,24,0,0,0-33.14.77l-5,5a16,16,0,0,0,0,22.64l2,2.06-51,51a39.75,39.75,0,0,0-10.53,38l-8,18.41A13.68,13.68,0,0,0,36,219.3a15.92,15.92,0,0,0,17.71,3.35L71.23,215a39.89,39.89,0,0,0,37.06-10.75l51-51,2.06,2.06a16,16,0,0,0,22.62,0l5-5a24,24,0,0,0,.74-33.18l23.75-23.87A35.75,35.75,0,0,0,224,67.3ZM97,193a24,24,0,0,1-24,6,8,8,0,0,0-5.55.31l-18.1,7.91L57,189.41a8,8,0,0,0,.25-5.75A23.88,23.88,0,0,1,63,159l51-51,33.94,34Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M222,67.34a33.81,33.81,0,0,0-10.64-24.25C198.12,30.56,176.68,31,163.54,44.18L142.82,65l-.63-.63a22,22,0,0,0-31.11,0l-9,9a14,14,0,0,0,0,19.81l3.47,3.47L53.14,149.1a37.79,37.79,0,0,0-9.84,36.73l-8.31,19a11.68,11.68,0,0,0,2.46,13A13.91,13.91,0,0,0,47.32,222,14.15,14.15,0,0,0,53,220.82L71,212.92a37.92,37.92,0,0,0,35.84-10.07l52.44-52.46,3.47,3.48a14,14,0,0,0,19.8,0l9-9a22,22,0,0,0,0-31.12l-.66-.66L212,91.85A33.76,33.76,0,0,0,222,67.34Zm-123.61,127a26,26,0,0,1-26,6.47,6,6,0,0,0-4.16.24l-20,8.75a2,2,0,0,1-2.09-.31l9.12-20.9a5.94,5.94,0,0,0,.19-4.31,25.88,25.88,0,0,1,6.26-26.72l52.44-52.45,36.76,36.78Zm105.16-111L178.17,108.9a6,6,0,0,0,0,8.47l4.88,4.89a10,10,0,0,1,0,14.15l-9,9a2,2,0,0,1-2.82,0l-60.69-60.7a2,2,0,0,1,0-2.83l9-9a10,10,0,0,1,14.14,0l4.89,4.89a6,6,0,0,0,4.24,1.75h0a6,6,0,0,0,4.25-1.77L172,52.66c8.58-8.58,22.52-9,31.08-.85a22,22,0,0,1,.44,31.57Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,67.3a35.79,35.79,0,0,0-11.26-25.66c-14-13.28-36.72-12.78-50.62,1.13L142.8,62.2a24,24,0,0,0-33.14.77l-9,9a16,16,0,0,0,0,22.64l2,2.06-51,51a39.75,39.75,0,0,0-10.53,38l-8,18.41A13.68,13.68,0,0,0,36,219.3a15.92,15.92,0,0,0,17.71,3.35L71.23,215a39.89,39.89,0,0,0,37.06-10.75l51-51,2.06,2.06a16,16,0,0,0,22.62,0l9-9a24,24,0,0,0,.74-33.18l19.75-19.87A35.75,35.75,0,0,0,224,67.3ZM97,193a24,24,0,0,1-24,6,8,8,0,0,0-5.55.31l-18.1,7.91L57,189.41a8,8,0,0,0,.25-5.75A23.88,23.88,0,0,1,63,159l51-51,33.94,34ZM202.13,82l-25.37,25.52a8,8,0,0,0,0,11.3l4.89,4.89a8,8,0,0,1,0,11.32l-9,9L112,83.26l9-9a8,8,0,0,1,11.31,0l4.89,4.89a8,8,0,0,0,11.33,0l24.94-25.09c7.81-7.82,20.5-8.18,28.29-.81a20,20,0,0,1,.39,28.7Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M220,67.37a31.82,31.82,0,0,0-10-22.82c-12.46-11.8-32.66-11.33-45,1.05L142.82,67.86l-2-2a20,20,0,0,0-28.28,0l-9,9a12,12,0,0,0,0,17l4.89,4.89L54.55,150.52A35.81,35.81,0,0,0,45.42,186l-8.6,19.7a9.7,9.7,0,0,0,2,10.79A12,12,0,0,0,52.15,219l18.72-8.18a35.9,35.9,0,0,0,34.59-9.37l53.86-53.87,4.88,4.89a12,12,0,0,0,17,0l9-9a20,20,0,0,0,0-28.3l-2.06-2.06,22.55-22.69A31.75,31.75,0,0,0,220,67.37ZM99.81,195.78a28,28,0,0,1-28,7,4,4,0,0,0-2.78.15l-20,8.75a4,4,0,0,1-4.43-.84,1.73,1.73,0,0,1-.36-1.93l9.19-21.06a4,4,0,0,0,.12-2.88,27.87,27.87,0,0,1,6.74-28.77l53.85-53.87,39.6,39.61Zm79.78-85.47a4,4,0,0,0,0,5.65l4.89,4.89a12,12,0,0,1,0,17l-9,9a4,4,0,0,1-5.66,0L109.18,86.1a4,4,0,0,1,0-5.66l9-9a12,12,0,0,1,17,0L140,76.36a4,4,0,0,0,2.83,1.17h0a4,4,0,0,0,2.83-1.18l25-25.1c9.33-9.34,24.52-9.73,33.87-.89A24,24,0,0,1,205,84.79Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/FolderPlus.es.js
var e$27 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,68H133.39l-26-29.29a20,20,0,0,0-15-6.71H40A20,20,0,0,0,20,52V200.62A19.41,19.41,0,0,0,39.38,220H216.89A19.13,19.13,0,0,0,236,200.89V88A20,20,0,0,0,216,68ZM90.61,56l10.67,12H44V56ZM212,196H44V92H212Zm-72-76v12h12a12,12,0,0,1,0,24H140v12a12,12,0,0,1-24,0V156H104a12,12,0,0,1,0-24h12V120a12,12,0,0,1,24,0Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M128,80H32V56a8,8,0,0,1,8-8H92.69a8,8,0,0,1,5.65,2.34Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM92.69,56l16,16H40V56ZM216,200H40V88H216Zm-88-88a8,8,0,0,1,8,8v16h16a8,8,0,0,1,0,16H136v16a8,8,0,0,1-16,0V152H104a8,8,0,0,1,0-16h16V120A8,8,0,0,1,128,112Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,72H131.31L104,44.69A15.88,15.88,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.41,15.41,0,0,0,39.39,216h177.5A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40Zm112,96H136v16a8,8,0,0,1-16,0V152H104a8,8,0,0,1,0-16h16V120a8,8,0,0,1,16,0v16h16a8,8,0,0,1,0,16Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,74H130.49l-27.9-27.9a13.94,13.94,0,0,0-9.9-4.1H40A14,14,0,0,0,26,56V200.62A13.39,13.39,0,0,0,39.38,214H216.89A13.12,13.12,0,0,0,230,200.89V88A14,14,0,0,0,216,74ZM40,54H92.69a2,2,0,0,1,1.41.59L113.51,74H38V56A2,2,0,0,1,40,54ZM218,200.89a1.11,1.11,0,0,1-1.11,1.11H39.38A1.4,1.4,0,0,1,38,200.62V86H216a2,2,0,0,1,2,2ZM158,144a6,6,0,0,1-6,6H134v18a6,6,0,0,1-12,0V150H104a6,6,0,0,1,0-12h18V120a6,6,0,0,1,12,0v18h18A6,6,0,0,1,158,144Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM92.69,56l16,16H40V56ZM216,200H40V88H216Zm-88-88a8,8,0,0,1,8,8v16h16a8,8,0,0,1,0,16H136v16a8,8,0,0,1-16,0V152H104a8,8,0,0,1,0-16h16V120A8,8,0,0,1,128,112Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,76H129.66L101.17,47.52A11.9,11.9,0,0,0,92.69,44H40A12,12,0,0,0,28,56V200.62A11.4,11.4,0,0,0,39.38,212H216.89A11.12,11.12,0,0,0,228,200.89V88A12,12,0,0,0,216,76ZM40,52H92.69a4,4,0,0,1,2.82,1.17L118.34,76H36V56A4,4,0,0,1,40,52ZM220,200.89a3.12,3.12,0,0,1-3.11,3.11H39.38A3.39,3.39,0,0,1,36,200.62V84H216a4,4,0,0,1,4,4ZM156,144a4,4,0,0,1-4,4H132v20a4,4,0,0,1-8,0V148H104a4,4,0,0,1,0-8h20V120a4,4,0,0,1,8,0v20h20A4,4,0,0,1,156,144Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Gear.es.js
var l$1 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,76a52,52,0,1,0,52,52A52.06,52.06,0,0,0,128,76Zm0,80a28,28,0,1,1,28-28A28,28,0,0,1,128,156Zm92-27.21v-1.58l14-17.51a12,12,0,0,0,2.23-10.59A111.75,111.75,0,0,0,225,71.89,12,12,0,0,0,215.89,66L193.61,63.5l-1.11-1.11L190,40.1A12,12,0,0,0,184.11,31a111.67,111.67,0,0,0-27.23-11.27A12,12,0,0,0,146.3,22L128.79,36h-1.58L109.7,22a12,12,0,0,0-10.59-2.23A111.75,111.75,0,0,0,71.89,31.05,12,12,0,0,0,66,40.11L63.5,62.39,62.39,63.5,40.1,66A12,12,0,0,0,31,71.89,111.67,111.67,0,0,0,19.77,99.12,12,12,0,0,0,22,109.7l14,17.51v1.58L22,146.3a12,12,0,0,0-2.23,10.59,111.75,111.75,0,0,0,11.29,27.22A12,12,0,0,0,40.11,190l22.28,2.48,1.11,1.11L66,215.9A12,12,0,0,0,71.89,225a111.67,111.67,0,0,0,27.23,11.27A12,12,0,0,0,109.7,234l17.51-14h1.58l17.51,14a12,12,0,0,0,10.59,2.23A111.75,111.75,0,0,0,184.11,225a12,12,0,0,0,5.91-9.06l2.48-22.28,1.11-1.11L215.9,190a12,12,0,0,0,9.06-5.91,111.67,111.67,0,0,0,11.27-27.23A12,12,0,0,0,234,146.3Zm-24.12-4.89a70.1,70.1,0,0,1,0,8.2,12,12,0,0,0,2.61,8.22l12.84,16.05A86.47,86.47,0,0,1,207,166.86l-20.43,2.27a12,12,0,0,0-7.65,4,69,69,0,0,1-5.8,5.8,12,12,0,0,0-4,7.65L166.86,207a86.47,86.47,0,0,1-10.49,4.35l-16.05-12.85a12,12,0,0,0-7.5-2.62c-.24,0-.48,0-.72,0a70.1,70.1,0,0,1-8.2,0,12.06,12.06,0,0,0-8.22,2.6L99.63,211.33A86.47,86.47,0,0,1,89.14,207l-2.27-20.43a12,12,0,0,0-4-7.65,69,69,0,0,1-5.8-5.8,12,12,0,0,0-7.65-4L49,166.86a86.47,86.47,0,0,1-4.35-10.49l12.84-16.05a12,12,0,0,0,2.61-8.22,70.1,70.1,0,0,1,0-8.2,12,12,0,0,0-2.61-8.22L44.67,99.63A86.47,86.47,0,0,1,49,89.14l20.43-2.27a12,12,0,0,0,7.65-4,69,69,0,0,1,5.8-5.8,12,12,0,0,0,4-7.65L89.14,49a86.47,86.47,0,0,1,10.49-4.35l16.05,12.85a12.06,12.06,0,0,0,8.22,2.6,70.1,70.1,0,0,1,8.2,0,12,12,0,0,0,8.22-2.6l16.05-12.85A86.47,86.47,0,0,1,166.86,49l2.27,20.43a12,12,0,0,0,4,7.65,69,69,0,0,1,5.8,5.8,12,12,0,0,0,7.65,4L207,89.14a86.47,86.47,0,0,1,4.35,10.49l-12.84,16.05A12,12,0,0,0,195.88,123.9Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M207.86,123.18l16.78-21a99.14,99.14,0,0,0-10.07-24.29l-26.7-3a81,81,0,0,0-6.81-6.81l-3-26.71a99.43,99.43,0,0,0-24.3-10l-21,16.77a81.59,81.59,0,0,0-9.64,0l-21-16.78A99.14,99.14,0,0,0,77.91,41.43l-3,26.7a81,81,0,0,0-6.81,6.81l-26.71,3a99.43,99.43,0,0,0-10,24.3l16.77,21a81.59,81.59,0,0,0,0,9.64l-16.78,21a99.14,99.14,0,0,0,10.07,24.29l26.7,3a81,81,0,0,0,6.81,6.81l3,26.71a99.43,99.43,0,0,0,24.3,10l21-16.77a81.59,81.59,0,0,0,9.64,0l21,16.78a99.14,99.14,0,0,0,24.29-10.07l3-26.7a81,81,0,0,0,6.81-6.81l26.71-3a99.43,99.43,0,0,0,10-24.3l-16.77-21A81.59,81.59,0,0,0,207.86,123.18ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.6,107.6,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.29,107.29,0,0,0-26.25-10.86,8,8,0,0,0-7.06,1.48L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.6,107.6,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8.06,8.06,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8.06,8.06,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,130.16q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.6,107.6,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.29,107.29,0,0,0-26.25-10.86,8,8,0,0,0-7.06,1.48L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.6,107.6,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,82a46,46,0,1,0,46,46A46.06,46.06,0,0,0,128,82Zm0,80a34,34,0,1,1,34-34A34,34,0,0,1,128,162ZM214,130.84c.06-1.89.06-3.79,0-5.68L229.33,106a6,6,0,0,0,1.11-5.29A105.34,105.34,0,0,0,219.76,74.9a6,6,0,0,0-4.53-3l-24.45-2.71q-1.93-2.07-4-4l-2.72-24.46a6,6,0,0,0-3-4.53,105.65,105.65,0,0,0-25.77-10.66A6,6,0,0,0,150,26.68l-19.2,15.37c-1.89-.06-3.79-.06-5.68,0L106,26.67a6,6,0,0,0-5.29-1.11A105.34,105.34,0,0,0,74.9,36.24a6,6,0,0,0-3,4.53L69.23,65.22q-2.07,1.94-4,4L40.76,72a6,6,0,0,0-4.53,3,105.65,105.65,0,0,0-10.66,25.77A6,6,0,0,0,26.68,106l15.37,19.2c-.06,1.89-.06,3.79,0,5.68L26.67,150.05a6,6,0,0,0-1.11,5.29A105.34,105.34,0,0,0,36.24,181.1a6,6,0,0,0,4.53,3l24.45,2.71q1.94,2.07,4,4L72,215.24a6,6,0,0,0,3,4.53,105.65,105.65,0,0,0,25.77,10.66,6,6,0,0,0,5.29-1.11L125.16,214c1.89.06,3.79.06,5.68,0l19.21,15.38a6,6,0,0,0,3.75,1.31,6.2,6.2,0,0,0,1.54-.2,105.34,105.34,0,0,0,25.76-10.68,6,6,0,0,0,3-4.53l2.71-24.45q2.07-1.93,4-4l24.46-2.72a6,6,0,0,0,4.53-3,105.49,105.49,0,0,0,10.66-25.77,6,6,0,0,0-1.11-5.29Zm-3.1,41.63-23.64,2.63a6,6,0,0,0-3.82,2,75.14,75.14,0,0,1-6.31,6.31,6,6,0,0,0-2,3.82l-2.63,23.63A94.28,94.28,0,0,1,155.14,218l-18.57-14.86a6,6,0,0,0-3.75-1.31h-.36a78.07,78.07,0,0,1-8.92,0,6,6,0,0,0-4.11,1.3L100.87,218a94.13,94.13,0,0,1-17.34-7.17L80.9,187.21a6,6,0,0,0-2-3.82,75.14,75.14,0,0,1-6.31-6.31,6,6,0,0,0-3.82-2l-23.63-2.63A94.28,94.28,0,0,1,38,155.14l14.86-18.57a6,6,0,0,0,1.3-4.11,78.07,78.07,0,0,1,0-8.92,6,6,0,0,0-1.3-4.11L38,100.87a94.13,94.13,0,0,1,7.17-17.34L68.79,80.9a6,6,0,0,0,3.82-2,75.14,75.14,0,0,1,6.31-6.31,6,6,0,0,0,2-3.82l2.63-23.63A94.28,94.28,0,0,1,100.86,38l18.57,14.86a6,6,0,0,0,4.11,1.3,78.07,78.07,0,0,1,8.92,0,6,6,0,0,0,4.11-1.3L155.13,38a94.13,94.13,0,0,1,17.34,7.17l2.63,23.64a6,6,0,0,0,2,3.82,75.14,75.14,0,0,1,6.31,6.31,6,6,0,0,0,3.82,2l23.63,2.63A94.28,94.28,0,0,1,218,100.86l-14.86,18.57a6,6,0,0,0-1.3,4.11,78.07,78.07,0,0,1,0,8.92,6,6,0,0,0,1.3,4.11L218,155.13A94.13,94.13,0,0,1,210.85,172.47Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8,8,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,84a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,84Zm0,80a36,36,0,1,1,36-36A36,36,0,0,1,128,164Zm83.93-32.49q.13-3.51,0-7l15.83-19.79a4,4,0,0,0,.75-3.53A103.64,103.64,0,0,0,218,75.9a4,4,0,0,0-3-2l-25.19-2.8c-1.58-1.71-3.24-3.37-4.95-4.95L182.07,41a4,4,0,0,0-2-3A104,104,0,0,0,154.82,27.5a4,4,0,0,0-3.53.74L131.51,44.07q-3.51-.14-7,0L104.7,28.24a4,4,0,0,0-3.53-.75A103.64,103.64,0,0,0,75.9,38a4,4,0,0,0-2,3l-2.8,25.19c-1.71,1.58-3.37,3.24-4.95,4.95L41,73.93a4,4,0,0,0-3,2A104,104,0,0,0,27.5,101.18a4,4,0,0,0,.74,3.53l15.83,19.78q-.14,3.51,0,7L28.24,151.3a4,4,0,0,0-.75,3.53A103.64,103.64,0,0,0,38,180.1a4,4,0,0,0,3,2l25.19,2.8c1.58,1.71,3.24,3.37,4.95,4.95l2.8,25.2a4,4,0,0,0,2,3,104,104,0,0,0,25.28,10.46,4,4,0,0,0,3.53-.74l19.78-15.83q3.51.13,7,0l19.79,15.83a4,4,0,0,0,2.5.88,4,4,0,0,0,1-.13A103.64,103.64,0,0,0,180.1,218a4,4,0,0,0,2-3l2.8-25.19c1.71-1.58,3.37-3.24,4.95-4.95l25.2-2.8a4,4,0,0,0,3-2,104,104,0,0,0,10.46-25.28,4,4,0,0,0-.74-3.53Zm.17,42.83-24.67,2.74a4,4,0,0,0-2.55,1.32,76.2,76.2,0,0,1-6.48,6.48,4,4,0,0,0-1.32,2.55l-2.74,24.66a95.45,95.45,0,0,1-19.64,8.15l-19.38-15.51a4,4,0,0,0-2.5-.87h-.24a73.67,73.67,0,0,1-9.16,0,4,4,0,0,0-2.74.87l-19.37,15.5a95.33,95.33,0,0,1-19.65-8.13l-2.74-24.67a4,4,0,0,0-1.32-2.55,76.2,76.2,0,0,1-6.48-6.48,4,4,0,0,0-2.55-1.32l-24.66-2.74a95.45,95.45,0,0,1-8.15-19.64l15.51-19.38a4,4,0,0,0,.87-2.74,77.76,77.76,0,0,1,0-9.16,4,4,0,0,0-.87-2.74l-15.5-19.37A95.33,95.33,0,0,1,43.9,81.66l24.67-2.74a4,4,0,0,0,2.55-1.32,76.2,76.2,0,0,1,6.48-6.48,4,4,0,0,0,1.32-2.55l2.74-24.66a95.45,95.45,0,0,1,19.64-8.15l19.38,15.51a4,4,0,0,0,2.74.87,73.67,73.67,0,0,1,9.16,0,4,4,0,0,0,2.74-.87l19.37-15.5a95.33,95.33,0,0,1,19.65,8.13l2.74,24.67a4,4,0,0,0,1.32,2.55,76.2,76.2,0,0,1,6.48,6.48,4,4,0,0,0,2.55,1.32l24.66,2.74a95.45,95.45,0,0,1,8.15,19.64l-15.51,19.38a4,4,0,0,0-.87,2.74,77.76,77.76,0,0,1,0,9.16,4,4,0,0,0,.87,2.74l15.5,19.37A95.33,95.33,0,0,1,212.1,174.34Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Globe.es.js
var e$26 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,187a113.4,113.4,0,0,1-20.39-35h40.82a116.94,116.94,0,0,1-10,20.77A108.61,108.61,0,0,1,128,207Zm-26.49-59a135.42,135.42,0,0,1,0-40h53a135.42,135.42,0,0,1,0,40ZM44,128a83.49,83.49,0,0,1,2.43-20H77.25a160.63,160.63,0,0,0,0,40H46.43A83.49,83.49,0,0,1,44,128Zm84-79a113.4,113.4,0,0,1,20.39,35H107.59a116.94,116.94,0,0,1,10-20.77A108.61,108.61,0,0,1,128,49Zm50.73,59h30.82a83.52,83.52,0,0,1,0,40H178.75a160.63,160.63,0,0,0,0-40Zm20.77-24H173.71a140.82,140.82,0,0,0-15.5-34.36A84.51,84.51,0,0,1,199.52,84ZM97.79,49.64A140.82,140.82,0,0,0,82.29,84H56.48A84.51,84.51,0,0,1,97.79,49.64ZM56.48,172H82.29a140.82,140.82,0,0,0,15.5,34.36A84.51,84.51,0,0,1,56.48,172Zm101.73,34.36A140.82,140.82,0,0,0,173.71,172h25.81A84.51,84.51,0,0,1,158.21,206.36Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm88,104a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48ZM40,128a87.61,87.61,0,0,1,3.33-24H81.84a157.44,157.44,0,0,0,0,48H43.33A87.61,87.61,0,0,1,40,128ZM154,88H102a115.11,115.11,0,0,1,26-45A115.27,115.27,0,0,1,154,88Zm52.33,0H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM107.59,42.4A135.28,135.28,0,0,0,85.29,88H49.63A88.29,88.29,0,0,1,107.59,42.4ZM49.63,168H85.29a135.28,135.28,0,0,0,22.3,45.6A88.29,88.29,0,0,1,49.63,168Zm98.78,45.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm78.36,64H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM216,128a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM128,43a115.27,115.27,0,0,1,26,45H102A115.11,115.11,0,0,1,128,43ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48Zm50.35,61.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm81.57,64H169.19a132.58,132.58,0,0,0-25.73-50.67A90.29,90.29,0,0,1,209.57,90ZM218,128a89.7,89.7,0,0,1-3.83,26H171.81a155.43,155.43,0,0,0,0-52h42.36A89.7,89.7,0,0,1,218,128Zm-90,87.83a110,110,0,0,1-15.19-19.45A124.24,124.24,0,0,1,99.35,166h57.3a124.24,124.24,0,0,1-13.46,30.38A110,110,0,0,1,128,215.83ZM96.45,154a139.18,139.18,0,0,1,0-52h63.1a139.18,139.18,0,0,1,0,52ZM38,128a89.7,89.7,0,0,1,3.83-26H84.19a155.43,155.43,0,0,0,0,52H41.83A89.7,89.7,0,0,1,38,128Zm90-87.83a110,110,0,0,1,15.19,19.45A124.24,124.24,0,0,1,156.65,90H99.35a124.24,124.24,0,0,1,13.46-30.38A110,110,0,0,1,128,40.17Zm-15.46-.84A132.58,132.58,0,0,0,86.81,90H46.43A90.29,90.29,0,0,1,112.54,39.33ZM46.43,166H86.81a132.58,132.58,0,0,0,25.73,50.67A90.29,90.29,0,0,1,46.43,166Zm97,50.67A132.58,132.58,0,0,0,169.19,166h40.38A90.29,90.29,0,0,1,143.46,216.67Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm88,104a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48ZM40,128a87.61,87.61,0,0,1,3.33-24H81.84a157.44,157.44,0,0,0,0,48H43.33A87.61,87.61,0,0,1,40,128ZM154,88H102a115.11,115.11,0,0,1,26-45A115.27,115.27,0,0,1,154,88Zm52.33,0H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM107.59,42.4A135.28,135.28,0,0,0,85.29,88H49.63A88.29,88.29,0,0,1,107.59,42.4ZM49.63,168H85.29a135.28,135.28,0,0,0,22.3,45.6A88.29,88.29,0,0,1,49.63,168Zm98.78,45.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,28h0A100,100,0,1,0,228,128,100.11,100.11,0,0,0,128,28Zm0,190.61c-6.33-6.09-23-24.41-31.27-54.61h62.54C151,194.2,134.33,212.52,128,218.61ZM94.82,156a140.42,140.42,0,0,1,0-56h66.36a140.42,140.42,0,0,1,0,56ZM128,37.39c6.33,6.09,23,24.41,31.27,54.61H96.73C105,61.8,121.67,43.48,128,37.39ZM169.41,100h46.23a92.09,92.09,0,0,1,0,56H169.41a152.65,152.65,0,0,0,0-56Zm43.25-8h-45a129.39,129.39,0,0,0-29.19-55.4A92.25,92.25,0,0,1,212.66,92ZM117.54,36.6A129.39,129.39,0,0,0,88.35,92h-45A92.25,92.25,0,0,1,117.54,36.6ZM40.36,100H86.59a152.65,152.65,0,0,0,0,56H40.36a92.09,92.09,0,0,1,0-56Zm3,64h45a129.39,129.39,0,0,0,29.19,55.4A92.25,92.25,0,0,1,43.34,164Zm95.12,55.4A129.39,129.39,0,0,0,167.65,164h45A92.25,92.25,0,0,1,138.46,219.4Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Heart.es.js
var a$13 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M178,36c-20.09,0-37.92,7.93-50,21.56C115.92,43.93,98.09,36,78,36a66.08,66.08,0,0,0-66,66c0,72.34,105.81,130.14,110.31,132.57a12,12,0,0,0,11.38,0C138.19,232.14,244,174.34,244,102A66.08,66.08,0,0,0,178,36Zm-5.49,142.36A328.69,328.69,0,0,1,128,210.16a328.69,328.69,0,0,1-44.51-31.8C61.82,159.77,36,131.42,36,102A42,42,0,0,1,78,60c17.8,0,32.7,9.4,38.89,24.54a12,12,0,0,0,22.22,0C145.3,69.4,160.2,60,178,60a42,42,0,0,1,42,42C220,131.42,194.18,159.77,172.51,178.36Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M232,102c0,66-104,122-104,122S24,168,24,102A54,54,0,0,1,78,48c22.59,0,41.94,12.31,50,32,8.06-19.69,27.41-32,50-32A54,54,0,0,1,232,102Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M178,40c-20.65,0-38.73,8.88-50,23.89C116.73,48.88,98.65,40,78,40a62.07,62.07,0,0,0-62,62c0,70,103.79,126.66,108.21,129a8,8,0,0,0,7.58,0C136.21,228.66,240,172,240,102A62.07,62.07,0,0,0,178,40ZM128,214.8C109.74,204.16,32,155.69,32,102A46.06,46.06,0,0,1,78,56c19.45,0,35.78,10.36,42.6,27a8,8,0,0,0,14.8,0c6.82-16.67,23.15-27,42.6-27a46.06,46.06,0,0,1,46,46C224,155.61,146.24,204.15,128,214.8Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M240,102c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,228.66,16,172,16,102A62.07,62.07,0,0,1,78,40c20.65,0,38.73,8.88,50,23.89C139.27,48.88,157.35,40,178,40A62.07,62.07,0,0,1,240,102Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M178,42c-21,0-39.26,9.47-50,25.34C117.26,51.47,99,42,78,42a60.07,60.07,0,0,0-60,60c0,29.2,18.2,59.59,54.1,90.31a334.68,334.68,0,0,0,53.06,37,6,6,0,0,0,5.68,0,334.68,334.68,0,0,0,53.06-37C219.8,161.59,238,131.2,238,102A60.07,60.07,0,0,0,178,42ZM128,217.11C111.59,207.64,30,157.72,30,102A48.05,48.05,0,0,1,78,54c20.28,0,37.31,10.83,44.45,28.27a6,6,0,0,0,11.1,0C140.69,64.83,157.72,54,178,54a48.05,48.05,0,0,1,48,48C226,157.72,144.41,207.64,128,217.11Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M178,40c-20.65,0-38.73,8.88-50,23.89C116.73,48.88,98.65,40,78,40a62.07,62.07,0,0,0-62,62c0,70,103.79,126.66,108.21,129a8,8,0,0,0,7.58,0C136.21,228.66,240,172,240,102A62.07,62.07,0,0,0,178,40ZM128,214.8C109.74,204.16,32,155.69,32,102A46.06,46.06,0,0,1,78,56c19.45,0,35.78,10.36,42.6,27a8,8,0,0,0,14.8,0c6.82-16.67,23.15-27,42.6-27a46.06,46.06,0,0,1,46,46C224,155.61,146.24,204.15,128,214.8Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M178,44c-21.44,0-39.92,10.19-50,27.07C117.92,54.19,99.44,44,78,44a58.07,58.07,0,0,0-58,58c0,28.59,18,58.47,53.4,88.79a333.81,333.81,0,0,0,52.7,36.73,4,4,0,0,0,3.8,0,333.81,333.81,0,0,0,52.7-36.73C218,160.47,236,130.59,236,102A58.07,58.07,0,0,0,178,44ZM128,219.42c-14-8-100-59.35-100-117.42A50.06,50.06,0,0,1,78,52c21.11,0,38.85,11.31,46.3,29.51a4,4,0,0,0,7.4,0C139.15,63.31,156.89,52,178,52a50.06,50.06,0,0,1,50,50C228,160,142,211.46,128,219.42Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/House.es.js
var e$25 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M222.14,105.85l-80-80a20,20,0,0,0-28.28,0l-80,80A19.86,19.86,0,0,0,28,120v96a12,12,0,0,0,12,12h64a12,12,0,0,0,12-12V164h24v52a12,12,0,0,0,12,12h64a12,12,0,0,0,12-12V120A19.86,19.86,0,0,0,222.14,105.85ZM204,204H164V152a12,12,0,0,0-12-12H104a12,12,0,0,0-12,12v52H52V121.65l76-76,76,76Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M216,120v96H152V152H104v64H40V120a8,8,0,0,1,2.34-5.66l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,216,120Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M219.31,108.68l-80-80a16,16,0,0,0-22.62,0l-80,80A15.87,15.87,0,0,0,32,120v96a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V160h32v56a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V120A15.87,15.87,0,0,0,219.31,108.68ZM208,208H160V152a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8v56H48V120l80-80,80,80Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,120v96a8,8,0,0,1-8,8H160a8,8,0,0,1-8-8V164a4,4,0,0,0-4-4H108a4,4,0,0,0-4,4v52a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V120a16,16,0,0,1,4.69-11.31l80-80a16,16,0,0,1,22.62,0l80,80A16,16,0,0,1,224,120Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M217.9,110.1l-80-80a14,14,0,0,0-19.8,0l-80,80A13.92,13.92,0,0,0,34,120v96a6,6,0,0,0,6,6h64a6,6,0,0,0,6-6V158h36v58a6,6,0,0,0,6,6h64a6,6,0,0,0,6-6V120A13.92,13.92,0,0,0,217.9,110.1ZM210,210H158V152a6,6,0,0,0-6-6H104a6,6,0,0,0-6,6v58H46V120a2,2,0,0,1,.58-1.42l80-80a2,2,0,0,1,2.84,0l80,80A2,2,0,0,1,210,120Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M219.31,108.68l-80-80a16,16,0,0,0-22.62,0l-80,80A15.87,15.87,0,0,0,32,120v96a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V160h32v56a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V120A15.87,15.87,0,0,0,219.31,108.68ZM208,208H160V152a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8v56H48V120l80-80,80,80Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216.49,111.51l-80-80a12,12,0,0,0-17,0l-80,80A12,12,0,0,0,36,120v96a4,4,0,0,0,4,4h64a4,4,0,0,0,4-4V156h40v60a4,4,0,0,0,4,4h64a4,4,0,0,0,4-4V120A12,12,0,0,0,216.49,111.51ZM212,212H156V152a4,4,0,0,0-4-4H104a4,4,0,0,0-4,4v60H44V120a4,4,0,0,1,1.17-2.83l80-80a4,4,0,0,1,5.66,0l80,80A4,4,0,0,1,212,120Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Image.es.js
var e$24 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M144,96a16,16,0,1,1,16,16A16,16,0,0,1,144,96Zm92-40V200a20,20,0,0,1-20,20H40a20,20,0,0,1-20-20V56A20,20,0,0,1,40,36H216A20,20,0,0,1,236,56ZM44,60v79.72l33.86-33.86a20,20,0,0,1,28.28,0L147.31,147l17.18-17.17a20,20,0,0,1,28.28,0L212,149.09V60Zm0,136H162.34L92,125.66l-48,48Zm168,0V183l-33.37-33.37L164.28,164l32,32Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M224,56V178.06l-39.72-39.72a8,8,0,0,0-11.31,0L147.31,164,97.66,114.34a8,8,0,0,0-11.32,0L32,168.69V56a8,8,0,0,1,8-8H216A8,8,0,0,1,224,56Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM156,88a12,12,0,1,1-12,12A12,12,0,0,1,156,88Zm60,112H40V160.69l46.34-46.35a8,8,0,0,1,11.32,0h0L165,181.66a8,8,0,0,0,11.32-11.32l-17.66-17.65L173,138.34a8,8,0,0,1,11.31,0L216,170.07V200Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,42H40A14,14,0,0,0,26,56V200a14,14,0,0,0,14,14H216a14,14,0,0,0,14-14V56A14,14,0,0,0,216,42ZM40,54H216a2,2,0,0,1,2,2V163.57L188.53,134.1a14,14,0,0,0-19.8,0l-21.42,21.42L101.9,110.1a14,14,0,0,0-19.8,0L38,154.2V56A2,2,0,0,1,40,54ZM38,200V171.17l52.58-52.58a2,2,0,0,1,2.84,0L176.83,202H40A2,2,0,0,1,38,200Zm178,2H193.8l-38-38,21.41-21.42a2,2,0,0,1,2.83,0l38,38V200A2,2,0,0,1,216,202ZM146,100a10,10,0,1,1,10,10A10,10,0,0,1,146,100Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,44H40A12,12,0,0,0,28,56V200a12,12,0,0,0,12,12H216a12,12,0,0,0,12-12V56A12,12,0,0,0,216,44ZM40,52H216a4,4,0,0,1,4,4V168.4l-32.89-32.89a12,12,0,0,0-17,0l-22.83,22.83-46.82-46.83a12,12,0,0,0-17,0L36,159V56A4,4,0,0,1,40,52ZM36,200V170.34l53.17-53.17a4,4,0,0,1,5.66,0L181.66,204H40A4,4,0,0,1,36,200Zm180,4H193l-40-40,22.83-22.83a4,4,0,0,1,5.66,0L220,179.71V200A4,4,0,0,1,216,204ZM148,100a8,8,0,1,1,8,8A8,8,0,0,1,148,100Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Lightbulb.es.js
var e$23 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M180,232a12,12,0,0,1-12,12H88a12,12,0,0,1,0-24h80A12,12,0,0,1,180,232Zm40-128a91.51,91.51,0,0,1-35.17,72.35A12.26,12.26,0,0,0,180,186v2a20,20,0,0,1-20,20H96a20,20,0,0,1-20-20v-2a12,12,0,0,0-4.7-9.51A91.57,91.57,0,0,1,36,104.52C35.73,54.69,76,13.2,125.79,12A92,92,0,0,1,220,104Zm-24,0a68,68,0,0,0-69.65-68C89.56,36.88,59.8,67.55,60,104.38a67.71,67.71,0,0,0,26.1,53.19A35.87,35.87,0,0,1,100,184h56.1A36.13,36.13,0,0,1,170,157.49,67.68,67.68,0,0,0,196,104Zm-20.07-5.32a48.5,48.5,0,0,0-31.91-40,12,12,0,0,0-8,22.62,24.31,24.31,0,0,1,16.09,20,12,12,0,0,0,23.86-2.64Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M208,104a79.86,79.86,0,0,1-30.59,62.92A24.29,24.29,0,0,0,168,186v6a8,8,0,0,1-8,8H96a8,8,0,0,1-8-8v-6a24.11,24.11,0,0,0-9.3-19A79.87,79.87,0,0,1,48,104.45C47.76,61.09,82.72,25,126.07,24A80,80,0,0,1,208,104Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-16,0a72,72,0,0,0-73.74-72c-39,.92-70.47,33.39-70.26,72.39a71.65,71.65,0,0,0,27.64,56.3A32,32,0,0,1,96,186v6h64v-6a32.15,32.15,0,0,1,12.47-25.35A71.65,71.65,0,0,0,200,104Zm-16.11-9.34a57.6,57.6,0,0,0-46.56-46.55,8,8,0,0,0-2.66,15.78c16.57,2.79,30.63,16.85,33.44,33.45A8,8,0,0,0,176,104a9,9,0,0,0,1.35-.11A8,8,0,0,0,183.89,94.66Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-32.11-9.34a57.6,57.6,0,0,0-46.56-46.55,8,8,0,0,0-2.66,15.78c16.57,2.79,30.63,16.85,33.44,33.45A8,8,0,0,0,176,104a9,9,0,0,0,1.35-.11A8,8,0,0,0,183.89,94.66Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M174,232a6,6,0,0,1-6,6H88a6,6,0,0,1,0-12h80A6,6,0,0,1,174,232Zm40-128a85.56,85.56,0,0,1-32.88,67.64A18.23,18.23,0,0,0,174,186v6a14,14,0,0,1-14,14H96a14,14,0,0,1-14-14v-6a18,18,0,0,0-7-14.23h0a85.59,85.59,0,0,1-33-67.24C41.74,57.91,79.39,19.12,125.93,18A86,86,0,0,1,214,104Zm-12,0a74,74,0,0,0-75.79-74C86.17,31,53.78,64.34,54,104.42a73.67,73.67,0,0,0,28.4,57.87A29.92,29.92,0,0,1,94,186v6a2,2,0,0,0,2,2h64a2,2,0,0,0,2-2v-6a30.18,30.18,0,0,1,11.7-23.78A73.59,73.59,0,0,0,202,104Zm-20.08-9A55.58,55.58,0,0,0,137,50.08a6,6,0,1,0-2,11.84C152.38,64.84,167.13,79.6,170.08,97a6,6,0,0,0,5.91,5,6.87,6.87,0,0,0,1-.08A6,6,0,0,0,181.92,95Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-16,0a72,72,0,0,0-73.74-72c-39,.92-70.47,33.39-70.26,72.39a71.65,71.65,0,0,0,27.64,56.3A32,32,0,0,1,96,186v6h64v-6a32.15,32.15,0,0,1,12.47-25.35A71.65,71.65,0,0,0,200,104Zm-16.11-9.34a57.6,57.6,0,0,0-46.56-46.55,8,8,0,0,0-2.66,15.78c16.57,2.79,30.63,16.85,33.44,33.45A8,8,0,0,0,176,104a9,9,0,0,0,1.35-.11A8,8,0,0,0,183.89,94.66Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M172,232a4,4,0,0,1-4,4H88a4,4,0,0,1,0-8h80A4,4,0,0,1,172,232Zm40-128a83.59,83.59,0,0,1-32.11,66.06A20.2,20.2,0,0,0,172,186v6a12,12,0,0,1-12,12H96a12,12,0,0,1-12-12v-6a20,20,0,0,0-7.76-15.81A83.58,83.58,0,0,1,44,104.47C43.75,59,80.52,21.09,126,20a84,84,0,0,1,86,84Zm-8,0a76,76,0,0,0-77.83-76C85,29,51.77,63.27,52,104.43a75.62,75.62,0,0,0,29.17,59.43A28,28,0,0,1,92,186v6a4,4,0,0,0,4,4h64a4,4,0,0,0,4-4v-6a28.14,28.14,0,0,1,10.94-22.2A75.62,75.62,0,0,0,204,104ZM136.66,52.06a4,4,0,0,0-1.32,7.88C153.53,63,169,78.45,172.06,96.67A4,4,0,0,0,176,100a3.88,3.88,0,0,0,.67-.06,4,4,0,0,0,3.27-4.61A53.51,53.51,0,0,0,136.66,52.06Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Link.es.js
var e$22 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M117.18,188.74a12,12,0,0,1,0,17l-5.12,5.12A58.26,58.26,0,0,1,70.6,228h0A58.62,58.62,0,0,1,29.14,127.92L63.89,93.17a58.64,58.64,0,0,1,98.56,28.11,12,12,0,1,1-23.37,5.44,34.65,34.65,0,0,0-58.22-16.58L46.11,144.89A34.62,34.62,0,0,0,70.57,204h0a34.41,34.41,0,0,0,24.49-10.14l5.11-5.12A12,12,0,0,1,117.18,188.74ZM226.83,45.17a58.65,58.65,0,0,0-82.93,0l-5.11,5.11a12,12,0,0,0,17,17l5.12-5.12a34.63,34.63,0,1,1,49,49L175.1,145.86A34.39,34.39,0,0,1,150.61,156h0a34.63,34.63,0,0,1-33.69-26.72,12,12,0,0,0-23.38,5.44A58.64,58.64,0,0,0,150.56,180h.05a58.28,58.28,0,0,0,41.47-17.17l34.75-34.75a58.62,58.62,0,0,0,0-82.91Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M218.34,119.6,183.6,154.34a46.58,46.58,0,0,1-44.31,12.26c-.31.34-.62.67-.95,1L103.6,202.34A46.63,46.63,0,1,1,37.66,136.4L72.4,101.66A46.6,46.6,0,0,1,116.71,89.4c.31-.34.62-.67,1-1L152.4,53.66a46.63,46.63,0,0,1,65.94,65.94Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M240,88.23a54.43,54.43,0,0,1-16,37L189.25,160a54.27,54.27,0,0,1-38.63,16h-.05A54.63,54.63,0,0,1,96,119.84a8,8,0,0,1,16,.45A38.62,38.62,0,0,0,150.58,160h0a38.39,38.39,0,0,0,27.31-11.31l34.75-34.75a38.63,38.63,0,0,0-54.63-54.63l-11,11A8,8,0,0,1,135.7,59l11-11A54.65,54.65,0,0,1,224,48,54.86,54.86,0,0,1,240,88.23ZM109,185.66l-11,11A38.41,38.41,0,0,1,70.6,208h0a38.63,38.63,0,0,1-27.29-65.94L78,107.31A38.63,38.63,0,0,1,144,135.71a8,8,0,0,0,7.78,8.22H152a8,8,0,0,0,8-7.78A54.86,54.86,0,0,0,144,96a54.65,54.65,0,0,0-77.27,0L32,130.75A54.62,54.62,0,0,0,70.56,224h0a54.28,54.28,0,0,0,38.64-16l11-11A8,8,0,0,0,109,185.66Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM115.7,192.49a43.31,43.31,0,0,1-55-66.43l25.37-25.37a43.35,43.35,0,0,1,61.25,0,42.9,42.9,0,0,1,9.95,15.43,8,8,0,1,1-15,5.6A27.33,27.33,0,0,0,97.37,112L72,137.37a27.32,27.32,0,0,0,34.68,41.91,8,8,0,1,1,9,13.21Zm79.61-62.55-25.37,25.37A43,43,0,0,1,139.32,168h0a43.35,43.35,0,0,1-40.53-28.12,8,8,0,1,1,15-5.6A27.35,27.35,0,0,0,139.28,152h0a27.14,27.14,0,0,0,19.32-8L184,118.63a27.32,27.32,0,0,0-34.68-41.91,8,8,0,1,1-9-13.21,43.32,43.32,0,0,1,55,66.43Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M238,88.18a52.42,52.42,0,0,1-15.4,35.66l-34.75,34.75A52.28,52.28,0,0,1,150.62,174h-.05A52.63,52.63,0,0,1,98,119.9a6,6,0,0,1,6-5.84h.17a6,6,0,0,1,5.83,6.16A40.62,40.62,0,0,0,150.58,162h0a40.4,40.4,0,0,0,28.73-11.9l34.75-34.74A40.63,40.63,0,0,0,156.63,57.9l-11,11a6,6,0,0,1-8.49-8.49l11-11a52.62,52.62,0,0,1,74.43,0A52.83,52.83,0,0,1,238,88.18Zm-127.62,98.9-11,11A40.36,40.36,0,0,1,70.6,210h0a40.63,40.63,0,0,1-28.7-69.36L76.62,105.9A40.63,40.63,0,0,1,146,135.77a6,6,0,0,0,5.83,6.16H152a6,6,0,0,0,6-5.84A52.63,52.63,0,0,0,68.14,97.42L33.38,132.16A52.63,52.63,0,0,0,70.56,222h0a52.26,52.26,0,0,0,37.22-15.42l11-11a6,6,0,1,0-8.49-8.48Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M240,88.23a54.43,54.43,0,0,1-16,37L189.25,160a54.27,54.27,0,0,1-38.63,16h-.05A54.63,54.63,0,0,1,96,119.84a8,8,0,0,1,16,.45A38.62,38.62,0,0,0,150.58,160h0a38.39,38.39,0,0,0,27.31-11.31l34.75-34.75a38.63,38.63,0,0,0-54.63-54.63l-11,11A8,8,0,0,1,135.7,59l11-11A54.65,54.65,0,0,1,224,48,54.86,54.86,0,0,1,240,88.23ZM109,185.66l-11,11A38.41,38.41,0,0,1,70.6,208h0a38.63,38.63,0,0,1-27.29-65.94L78,107.31A38.63,38.63,0,0,1,144,135.71a8,8,0,0,0,16,.45A54.86,54.86,0,0,0,144,96a54.65,54.65,0,0,0-77.27,0L32,130.75A54.62,54.62,0,0,0,70.56,224h0a54.28,54.28,0,0,0,38.64-16l11-11A8,8,0,0,0,109,185.66Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M236,88.12a50.44,50.44,0,0,1-14.81,34.31l-34.75,34.74A50.33,50.33,0,0,1,150.62,172h-.05A50.63,50.63,0,0,1,100,120a4,4,0,0,1,4-3.89h.11a4,4,0,0,1,3.89,4.11A42.64,42.64,0,0,0,150.58,164h0a42.32,42.32,0,0,0,30.14-12.49l34.75-34.74a42.63,42.63,0,1,0-60.29-60.28l-11,11a4,4,0,0,1-5.66-5.65l11-11A50.64,50.64,0,0,1,236,88.12ZM111.78,188.49l-11,11A42.33,42.33,0,0,1,70.6,212h0a42.63,42.63,0,0,1-30.11-72.77l34.75-34.74A42.63,42.63,0,0,1,148,135.82a4,4,0,0,0,8,.23A50.64,50.64,0,0,0,69.55,98.83L34.8,133.57A50.63,50.63,0,0,0,70.56,220h0a50.33,50.33,0,0,0,35.81-14.83l11-11a4,4,0,1,0-5.65-5.66Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/List.es.js
var e$21 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M228,128a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128ZM40,76H216a12,12,0,0,0,0-24H40a12,12,0,0,0,0,24ZM216,180H40a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M216,64V192H40V64Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM192,184H64a8,8,0,0,1,0-16H192a8,8,0,0,1,0,16Zm0-48H64a8,8,0,0,1,0-16H192a8,8,0,0,1,0,16Zm0-48H64a8,8,0,0,1,0-16H192a8,8,0,0,1,0,16Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M222,128a6,6,0,0,1-6,6H40a6,6,0,0,1,0-12H216A6,6,0,0,1,222,128ZM40,70H216a6,6,0,0,0,0-12H40a6,6,0,0,0,0,12ZM216,186H40a6,6,0,0,0,0,12H216a6,6,0,0,0,0-12Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M220,128a4,4,0,0,1-4,4H40a4,4,0,0,1,0-8H216A4,4,0,0,1,220,128ZM40,68H216a4,4,0,0,0,0-8H40a4,4,0,0,0,0,8ZM216,188H40a4,4,0,0,0,0,8H216a4,4,0,0,0,0-8Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Lock.es.js
var e$20 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,76H180V56A52,52,0,0,0,76,56V76H48A20,20,0,0,0,28,96V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V96A20,20,0,0,0,208,76ZM100,56a28,28,0,0,1,56,0V76H100ZM204,204H52V100H204Zm-60-52a16,16,0,1,1-16-16A16,16,0,0,1,144,152Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M216,96V208a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V96a8,8,0,0,1,8-8H208A8,8,0,0,1,216,96Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Zm-68-56a12,12,0,1,1-12-12A12,12,0,0,1,140,152Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80Zm-80,84a12,12,0,1,1,12-12A12,12,0,0,1,128,164Zm32-84H96V56a32,32,0,0,1,64,0Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,82H174V56a46,46,0,0,0-92,0V82H48A14,14,0,0,0,34,96V208a14,14,0,0,0,14,14H208a14,14,0,0,0,14-14V96A14,14,0,0,0,208,82ZM94,56a34,34,0,0,1,68,0V82H94ZM210,208a2,2,0,0,1-2,2H48a2,2,0,0,1-2-2V96a2,2,0,0,1,2-2H208a2,2,0,0,1,2,2Zm-72-56a10,10,0,1,1-10-10A10,10,0,0,1,138,152Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Zm-68-56a12,12,0,1,1-12-12A12,12,0,0,1,140,152Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,84H172V56a44,44,0,0,0-88,0V84H48A12,12,0,0,0,36,96V208a12,12,0,0,0,12,12H208a12,12,0,0,0,12-12V96A12,12,0,0,0,208,84ZM92,56a36,36,0,0,1,72,0V84H92ZM212,208a4,4,0,0,1-4,4H48a4,4,0,0,1-4-4V96a4,4,0,0,1,4-4H208a4,4,0,0,1,4,4Zm-76-56a8,8,0,1,1-8-8A8,8,0,0,1,136,152Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/MagnifyingGlass.es.js
var a$12 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M232.49,215.51,185,168a92.12,92.12,0,1,0-17,17l47.53,47.54a12,12,0,0,0,17-17ZM44,112a68,68,0,1,1,68,68A68.07,68.07,0,0,1,44,112Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M192,112a80,80,0,1,1-80-80A80,80,0,0,1,192,112Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M229.66,218.34,179.6,168.28a88.21,88.21,0,1,0-11.32,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M168,112a56,56,0,1,1-56-56A56,56,0,0,1,168,112Zm61.66,117.66a8,8,0,0,1-11.32,0l-50.06-50.07a88,88,0,1,1,11.32-11.31l50.06,50.06A8,8,0,0,1,229.66,229.66ZM112,184a72,72,0,1,0-72-72A72.08,72.08,0,0,0,112,184Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M228.24,219.76l-51.38-51.38a86.15,86.15,0,1,0-8.48,8.48l51.38,51.38a6,6,0,0,0,8.48-8.48ZM38,112a74,74,0,1,1,74,74A74.09,74.09,0,0,1,38,112Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M226.83,221.17l-52.7-52.7a84.1,84.1,0,1,0-5.66,5.66l52.7,52.7a4,4,0,0,0,5.66-5.66ZM36,112a76,76,0,1,1,76,76A76.08,76.08,0,0,1,36,112Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Monitor.es.js
var e$19 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,36H48A28,28,0,0,0,20,64V176a28,28,0,0,0,28,28H208a28,28,0,0,0,28-28V64A28,28,0,0,0,208,36Zm4,140a4,4,0,0,1-4,4H48a4,4,0,0,1-4-4V64a4,4,0,0,1,4-4H208a4,4,0,0,1,4,4Zm-40,52a12,12,0,0,1-12,12H96a12,12,0,0,1,0-24h64A12,12,0,0,1,172,228Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M224,64V176a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V64A16,16,0,0,1,48,48H208A16,16,0,0,1,224,64Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M208,40H48A24,24,0,0,0,24,64V176a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V64A24,24,0,0,0,208,40Zm8,136a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V64a8,8,0,0,1,8-8H208a8,8,0,0,1,8,8Zm-48,48a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,224Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M232,64V176a24,24,0,0,1-24,24H48a24,24,0,0,1-24-24V64A24,24,0,0,1,48,40H208A24,24,0,0,1,232,64ZM160,216H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,42H48A22,22,0,0,0,26,64V176a22,22,0,0,0,22,22H208a22,22,0,0,0,22-22V64A22,22,0,0,0,208,42Zm10,134a10,10,0,0,1-10,10H48a10,10,0,0,1-10-10V64A10,10,0,0,1,48,54H208a10,10,0,0,1,10,10Zm-52,48a6,6,0,0,1-6,6H96a6,6,0,0,1,0-12h64A6,6,0,0,1,166,224Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,40H48A24,24,0,0,0,24,64V176a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V64A24,24,0,0,0,208,40Zm8,136a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V64a8,8,0,0,1,8-8H208a8,8,0,0,1,8,8Zm-48,48a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,224Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,44H48A20,20,0,0,0,28,64V176a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V64A20,20,0,0,0,208,44Zm12,132a12,12,0,0,1-12,12H48a12,12,0,0,1-12-12V64A12,12,0,0,1,48,52H208a12,12,0,0,1,12,12Zm-56,48a4,4,0,0,1-4,4H96a4,4,0,0,1,0-8h64A4,4,0,0,1,164,224Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Moon.es.js
var a$11 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M236.37,139.4a12,12,0,0,0-12-3A84.07,84.07,0,0,1,119.6,31.59a12,12,0,0,0-15-15A108.86,108.86,0,0,0,49.69,55.07,108,108,0,0,0,136,228a107.09,107.09,0,0,0,64.93-21.69,108.86,108.86,0,0,0,38.44-54.94A12,12,0,0,0,236.37,139.4Zm-49.88,47.74A84,84,0,0,1,68.86,69.51,84.93,84.93,0,0,1,92.27,48.29Q92,52.13,92,56A108.12,108.12,0,0,0,200,164q3.87,0,7.71-.27A84.79,84.79,0,0,1,186.49,187.14Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M227.89,147.89A96,96,0,1,1,108.11,28.11,96.09,96.09,0,0,0,227.89,147.89Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M235.54,150.21a104.84,104.84,0,0,1-37,52.91A104,104,0,0,1,32,120,103.09,103.09,0,0,1,52.88,57.48a104.84,104.84,0,0,1,52.91-37,8,8,0,0,1,10,10,88.08,88.08,0,0,0,109.8,109.8,8,8,0,0,1,10,10Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M232.13,143.64a6,6,0,0,0-6-1.49A90.07,90.07,0,0,1,113.86,29.85a6,6,0,0,0-7.49-7.48A102.88,102.88,0,0,0,54.48,58.68,102,102,0,0,0,197.32,201.52a102.88,102.88,0,0,0,36.31-51.89A6,6,0,0,0,232.13,143.64Zm-42,48.29a90,90,0,0,1-126-126A90.9,90.9,0,0,1,99.65,37.66,102.06,102.06,0,0,0,218.34,156.35,90.9,90.9,0,0,1,190.1,191.93Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M230.72,145.06a4,4,0,0,0-4-1A92.08,92.08,0,0,1,111.94,29.27a4,4,0,0,0-5-5A100.78,100.78,0,0,0,56.08,59.88a100,100,0,0,0,140,140,100.78,100.78,0,0,0,35.59-50.87A4,4,0,0,0,230.72,145.06ZM191.3,193.53A92,92,0,0,1,62.47,64.7a93,93,0,0,1,39.88-30.35,100.09,100.09,0,0,0,119.3,119.3A93,93,0,0,1,191.3,193.53Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/PaintBrush.es.js
var a$10 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M236,32a12,12,0,0,0-12-12c-44.78,0-90,48.54-115.9,82a64,64,0,0,0-80,62c0,12-3.1,22.71-9.23,31.76A43,43,0,0,1,9.4,206.05a11.88,11.88,0,0,0-4.91,13.38A12.07,12.07,0,0,0,16.11,228h76A64,64,0,0,0,154,148C187.49,122.05,236,76.8,236,32ZM209.62,46.39c-4,12.92-13.15,27.49-26.92,42.91-3,3.39-6.16,6.7-9.35,9.89a104.31,104.31,0,0,0-16.5-16.51c3.19-3.19,6.49-6.32,9.88-9.35C182.15,59.55,196.71,50.43,209.62,46.39ZM92.07,204H42a80.17,80.17,0,0,0,10.14-40,40,40,0,1,1,40,40Zm38.18-91.32c3.12-3.93,6.55-8.09,10.23-12.35a80.52,80.52,0,0,1,15.23,15.24c-4.26,3.68-8.42,7.11-12.35,10.23A64.43,64.43,0,0,0,130.25,112.68Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M224,32c0,32.81-31.64,67.43-58.64,91.05A84.39,84.39,0,0,0,133,90.64C156.57,63.64,191.19,32,224,32Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M232,32a8,8,0,0,0-8-8c-44.08,0-89.31,49.71-114.43,82.63A60,60,0,0,0,32,164c0,30.88-19.54,44.73-20.47,45.37A8,8,0,0,0,16,224H92a60,60,0,0,0,57.37-77.57C182.3,121.31,232,76.08,232,32ZM92,208H34.63C41.38,198.41,48,183.92,48,164a44,44,0,1,1,44,44Zm32.42-94.45q5.14-6.66,10.09-12.55A76.23,76.23,0,0,1,155,121.49q-5.9,4.94-12.55,10.09A60.54,60.54,0,0,0,124.42,113.55Zm42.7-2.68a92.57,92.57,0,0,0-22-22c31.78-34.53,55.75-45,69.9-47.91C212.17,55.12,201.65,79.09,167.12,110.87Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M232,32a8,8,0,0,0-8-8c-44.08,0-89.31,49.71-114.43,82.63A60,60,0,0,0,32,164c0,30.88-19.54,44.73-20.47,45.37A8,8,0,0,0,16,224H92a60,60,0,0,0,57.37-77.57C182.3,121.31,232,76.08,232,32ZM124.42,113.55q5.14-6.66,10.09-12.55A76.23,76.23,0,0,1,155,121.49q-5.9,4.94-12.55,10.09A60.54,60.54,0,0,0,124.42,113.55Zm42.7-2.68a92.57,92.57,0,0,0-22-22c31.78-34.53,55.75-45,69.9-47.91C212.17,55.12,201.65,79.09,167.12,110.87Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,26c-20.8,0-44.11,11.41-69.3,33.9C136.62,76.06,121,94.9,110.3,109A58,58,0,0,0,34,164c0,32.07-20.43,46.39-21.35,47A6,6,0,0,0,16,222H92a58,58,0,0,0,55-76.3c14.08-10.67,32.92-26.32,49.08-44.4C218.59,76.11,230,52.8,230,32A6,6,0,0,0,224,26ZM92,210H30.65C37.92,200.85,46,185.78,46,164a46,46,0,1,1,46,46Zm29.49-95.91c3.6-4.67,7.88-10,12.71-15.69a78.17,78.17,0,0,1,23.4,23.4c-5.67,4.83-11,9.11-15.69,12.71A58.38,58.38,0,0,0,121.49,114.09Zm45.2-.3a90.24,90.24,0,0,0-24.48-24.48C163.05,66.46,191,42,217.56,38.44,214,65,189.54,93,166.69,113.79Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M232,32a8,8,0,0,0-8-8c-44.08,0-89.31,49.71-114.43,82.63A60,60,0,0,0,32,164c0,30.88-19.54,44.73-20.47,45.37A8,8,0,0,0,16,224H92a60,60,0,0,0,57.37-77.57C182.3,121.31,232,76.08,232,32ZM92,208H34.63C41.38,198.41,48,183.92,48,164a44,44,0,1,1,44,44Zm32.42-94.45q5.14-6.66,10.09-12.55A76.23,76.23,0,0,1,155,121.49q-5.9,4.94-12.55,10.09A60.54,60.54,0,0,0,124.42,113.55Zm42.7-2.68a92.57,92.57,0,0,0-22-22c31.78-34.53,55.75-45,69.9-47.91C212.17,55.12,201.65,79.09,167.12,110.87Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,28c-20.29,0-43.16,11.24-68,33.4-18.47,16.49-34.39,35.83-45,49.93A56,56,0,0,0,36,164c0,33.22-21.26,48-22.22,48.68A4,4,0,0,0,16,220H92a56,56,0,0,0,52.67-75c14.11-10.63,33.44-26.55,49.93-45C216.76,75.16,228,52.29,228,32A4,4,0,0,0,224,28ZM92,212H26.35C33.91,203.69,44,188.08,44,164a48,48,0,1,1,48,48Zm26.52-97.31c4.13-5.44,9.32-12,15.29-18.9a80.08,80.08,0,0,1,26.4,26.4c-6.94,6-13.46,11.16-18.9,15.29A56.32,56.32,0,0,0,118.52,114.69Zm47.77,2.14a88.17,88.17,0,0,0-27.12-27.12C161,65.43,191.26,38.63,219.82,36.18,217.37,64.74,190.57,95,166.29,116.83Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Palette.es.js
var e$18 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M203.57,51A107.9,107.9,0,0,0,20,128c0,44.72,27.6,82.25,72,97.94A36,36,0,0,0,140,192a12,12,0,0,1,12-12h46.21a35.79,35.79,0,0,0,35.1-28A108.6,108.6,0,0,0,236,127.09,107.23,107.23,0,0,0,203.57,51Zm6.34,95.67a11.91,11.91,0,0,1-11.7,9.3H152a36,36,0,0,0-36,36,12,12,0,0,1-16,11.3c-16.65-5.88-30.65-15.76-40.48-28.56A76,76,0,0,1,44,128a84,84,0,0,1,83.13-84H128a84.35,84.35,0,0,1,84,83.29A84.72,84.72,0,0,1,209.91,146.71ZM144,76a16,16,0,1,1-16-16A16,16,0,0,1,144,76Zm-44,24A16,16,0,1,1,84,84,16,16,0,0,1,100,100Zm0,56a16,16,0,1,1-16-16A16,16,0,0,1,100,156Zm88-56a16,16,0,1,1-16-16A16,16,0,0,1,188,100Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M224,127.17a96.48,96.48,0,0,1-2.39,22.18A24,24,0,0,1,198.21,168H152a24,24,0,0,0-24,24,24,24,0,0,1-32,22.61C58.73,201.44,32,169.81,32,128a96,96,0,0,1,95-96C179.84,31.47,223.55,74.35,224,127.17Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M200.77,53.89A103.27,103.27,0,0,0,128,24h-1.07A104,104,0,0,0,24,128c0,43,26.58,79.06,69.36,94.17A32,32,0,0,0,136,192a16,16,0,0,1,16-16h46.21a31.81,31.81,0,0,0,31.2-24.88,104.43,104.43,0,0,0,2.59-24A103.28,103.28,0,0,0,200.77,53.89Zm13,93.71A15.89,15.89,0,0,1,198.21,160H152a32,32,0,0,0-32,32,16,16,0,0,1-21.31,15.07C62.49,194.3,40,164,40,128a88,88,0,0,1,87.09-88h.9a88.35,88.35,0,0,1,88,87.25A88.86,88.86,0,0,1,213.81,147.6ZM140,76a12,12,0,1,1-12-12A12,12,0,0,1,140,76ZM96,100A12,12,0,1,1,84,88,12,12,0,0,1,96,100Zm0,56a12,12,0,1,1-12-12A12,12,0,0,1,96,156Zm88-56a12,12,0,1,1-12-12A12,12,0,0,1,184,100Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M200.77,53.89A103.27,103.27,0,0,0,128,24h-1.07A104,104,0,0,0,24,128c0,43,26.58,79.06,69.36,94.17A32,32,0,0,0,136,192a16,16,0,0,1,16-16h46.21a31.81,31.81,0,0,0,31.2-24.88,104.43,104.43,0,0,0,2.59-24A103.28,103.28,0,0,0,200.77,53.89ZM84,168a12,12,0,1,1,12-12A12,12,0,0,1,84,168Zm0-56a12,12,0,1,1,12-12A12,12,0,0,1,84,112Zm44-24a12,12,0,1,1,12-12A12,12,0,0,1,128,88Zm44,24a12,12,0,1,1,12-12A12,12,0,0,1,172,112Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M199.37,55.31A101.32,101.32,0,0,0,128,26h-1A102,102,0,0,0,26,128c0,42.09,26.07,77.44,68,92.26A30.21,30.21,0,0,0,104.11,222,30.06,30.06,0,0,0,134,192a18,18,0,0,1,18-18h46.21a29.82,29.82,0,0,0,29.25-23.31A102.71,102.71,0,0,0,230,127.11,101.25,101.25,0,0,0,199.37,55.31ZM215.76,148a17.89,17.89,0,0,1-17.55,14H152a30,30,0,0,0-30,30,18,18,0,0,1-24,17C61,195.86,38,164.85,38,128a90,90,0,0,1,89.07-90H128a90.34,90.34,0,0,1,90,89.22A90.46,90.46,0,0,1,215.76,148ZM138,76a10,10,0,1,1-10-10A10,10,0,0,1,138,76ZM94,100A10,10,0,1,1,84,90,10,10,0,0,1,94,100Zm0,56a10,10,0,1,1-10-10A10,10,0,0,1,94,156Zm88-56a10,10,0,1,1-10-10A10,10,0,0,1,182,100Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M200.77,53.89A103.27,103.27,0,0,0,128,24h-1.07A104,104,0,0,0,24,128c0,43,26.58,79.06,69.36,94.17A32,32,0,0,0,136,192a16,16,0,0,1,16-16h46.21a31.81,31.81,0,0,0,31.2-24.88,104.43,104.43,0,0,0,2.59-24A103.28,103.28,0,0,0,200.77,53.89Zm13,93.71A15.89,15.89,0,0,1,198.21,160H152a32,32,0,0,0-32,32,16,16,0,0,1-21.31,15.07C62.49,194.3,40,164,40,128a88,88,0,0,1,87.09-88h.9a88.35,88.35,0,0,1,88,87.25A88.86,88.86,0,0,1,213.81,147.6ZM140,76a12,12,0,1,1-12-12A12,12,0,0,1,140,76ZM96,100A12,12,0,1,1,84,88,12,12,0,0,1,96,100Zm0,56a12,12,0,1,1-12-12A12,12,0,0,1,96,156Zm88-56a12,12,0,1,1-12-12A12,12,0,0,1,184,100Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M198,56.74A99.31,99.31,0,0,0,128,28h-1A100,100,0,0,0,28,128c0,41.22,25.55,75.85,66.69,90.38a28.34,28.34,0,0,0,9.42,1.63A28,28,0,0,0,132,192a20,20,0,0,1,20-20h46.21a27.84,27.84,0,0,0,27.3-21.76,100.37,100.37,0,0,0,2.49-23.1A99.26,99.26,0,0,0,198,56.74Zm19.74,91.72A19.89,19.89,0,0,1,198.21,164H152a28,28,0,0,0-28,28,20,20,0,0,1-26.64,18.83C59.51,197.46,36,165.72,36,128a92,92,0,0,1,91.05-92H128a92,92,0,0,1,89.72,112.46ZM136,76a8,8,0,1,1-8-8A8,8,0,0,1,136,76ZM92,100a8,8,0,1,1-8-8A8,8,0,0,1,92,100Zm0,56a8,8,0,1,1-8-8A8,8,0,0,1,92,156Zm88-56a8,8,0,1,1-8-8A8,8,0,0,1,180,100Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Pause.es.js
var e$17 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M200,28H160a20,20,0,0,0-20,20V208a20,20,0,0,0,20,20h40a20,20,0,0,0,20-20V48A20,20,0,0,0,200,28Zm-4,176H164V52h32ZM96,28H56A20,20,0,0,0,36,48V208a20,20,0,0,0,20,20H96a20,20,0,0,0,20-20V48A20,20,0,0,0,96,28ZM92,204H60V52H92Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M208,48V208a8,8,0,0,1-8,8H160a8,8,0,0,1-8-8V48a8,8,0,0,1,8-8h40A8,8,0,0,1,208,48ZM96,40H56a8,8,0,0,0-8,8V208a8,8,0,0,0,8,8H96a8,8,0,0,0,8-8V48A8,8,0,0,0,96,40Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M200,32H160a16,16,0,0,0-16,16V208a16,16,0,0,0,16,16h40a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm0,176H160V48h40ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Zm0,176H56V48H96Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M200,34H160a14,14,0,0,0-14,14V208a14,14,0,0,0,14,14h40a14,14,0,0,0,14-14V48A14,14,0,0,0,200,34Zm2,174a2,2,0,0,1-2,2H160a2,2,0,0,1-2-2V48a2,2,0,0,1,2-2h40a2,2,0,0,1,2,2ZM96,34H56A14,14,0,0,0,42,48V208a14,14,0,0,0,14,14H96a14,14,0,0,0,14-14V48A14,14,0,0,0,96,34Zm2,174a2,2,0,0,1-2,2H56a2,2,0,0,1-2-2V48a2,2,0,0,1,2-2H96a2,2,0,0,1,2,2Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M200,32H160a16,16,0,0,0-16,16V208a16,16,0,0,0,16,16h40a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm0,176H160V48h40ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Zm0,176H56V48H96Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M200,36H160a12,12,0,0,0-12,12V208a12,12,0,0,0,12,12h40a12,12,0,0,0,12-12V48A12,12,0,0,0,200,36Zm4,172a4,4,0,0,1-4,4H160a4,4,0,0,1-4-4V48a4,4,0,0,1,4-4h40a4,4,0,0,1,4,4ZM96,36H56A12,12,0,0,0,44,48V208a12,12,0,0,0,12,12H96a12,12,0,0,0,12-12V48A12,12,0,0,0,96,36Zm4,172a4,4,0,0,1-4,4H56a4,4,0,0,1-4-4V48a4,4,0,0,1,4-4H96a4,4,0,0,1,4,4Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Pencil.es.js
var a$9 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M230.14,70.54,185.46,25.85a20,20,0,0,0-28.29,0L33.86,149.17A19.85,19.85,0,0,0,28,163.31V208a20,20,0,0,0,20,20H92.69a19.86,19.86,0,0,0,14.14-5.86L230.14,98.82a20,20,0,0,0,0-28.28ZM93,180l71-71,11,11-71,71ZM76,163,65,152l71-71,11,11ZM52,173l15.51,15.51h0L83,204H52ZM192,103,153,64l18.34-18.34,39,39Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M221.66,90.34,192,120,136,64l29.66-29.66a8,8,0,0,1,11.31,0L221.66,79A8,8,0,0,1,221.66,90.34Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM51.31,160,136,75.31,152.69,92,68,176.68ZM48,179.31,76.69,208H48Zm48,25.38L79.31,188,164,103.31,180.69,120Zm96-96L147.31,64l24-24L216,84.68Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM51.31,160l90.35-90.35,16.68,16.69L68,176.68ZM48,179.31,76.69,208H48Zm48,25.38L79.31,188l90.35-90.35h0l16.68,16.69Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M225.9,74.78,181.21,30.09a14,14,0,0,0-19.8,0L38.1,153.41a13.94,13.94,0,0,0-4.1,9.9V208a14,14,0,0,0,14,14H92.69a13.94,13.94,0,0,0,9.9-4.1L225.9,94.58a14,14,0,0,0,0-19.8ZM48.49,160,136,72.48,155.51,92,68,179.51ZM46,208V174.48L81.51,210H48A2,2,0,0,1,46,208Zm50-.49L76.49,188,164,100.48,183.51,120ZM217.41,86.1,192,111.51,144.49,64,169.9,38.58a2,2,0,0,1,2.83,0l44.68,44.69a2,2,0,0,1,0,2.83Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM51.31,160,136,75.31,152.69,92,68,176.68ZM48,179.31,76.69,208H48Zm48,25.38L79.31,188,164,103.31,180.69,120Zm96-96L147.31,64l24-24L216,84.68Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224.49,76.2,179.8,31.51a12,12,0,0,0-17,0L39.52,154.83A11.9,11.9,0,0,0,36,163.31V208a12,12,0,0,0,12,12H92.69a12,12,0,0,0,8.48-3.51L224.48,93.17a12,12,0,0,0,0-17ZM45.66,160,136,69.65,158.34,92,68,182.34ZM44,208V169.66l21.17,21.17h0L86.34,212H48A4,4,0,0,1,44,208Zm52,2.34L73.66,188,164,97.65,186.34,120ZM218.83,87.51,192,114.34,141.66,64l26.82-26.83a4,4,0,0,1,5.66,0l44.69,44.68a4,4,0,0,1,0,5.66Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Play.es.js
var a$8 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M234.49,111.07,90.41,22.94A20,20,0,0,0,60,39.87V216.13a20,20,0,0,0,30.41,16.93l144.08-88.13a19.82,19.82,0,0,0,0-33.86ZM84,208.85V47.15L216.16,128Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M228.23,134.69,84.15,222.81A8,8,0,0,1,72,216.12V39.88a8,8,0,0,1,12.15-6.69l144.08,88.12A7.82,7.82,0,0,1,228.23,134.69Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M231.36,116.19,87.28,28.06a14,14,0,0,0-14.18-.27A13.69,13.69,0,0,0,66,39.87V216.13a13.69,13.69,0,0,0,7.1,12.08,14,14,0,0,0,14.18-.27l144.08-88.13a13.82,13.82,0,0,0,0-23.62Zm-6.26,13.38L81,217.7a2,2,0,0,1-2.06,0,1.78,1.78,0,0,1-1-1.61V39.87a1.78,1.78,0,0,1,1-1.61A2.06,2.06,0,0,1,80,38a2,2,0,0,1,1,.31L225.1,126.43a1.82,1.82,0,0,1,0,3.14Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M230.32,117.9,86.24,29.79a11.91,11.91,0,0,0-12.17-.23A11.71,11.71,0,0,0,68,39.89V216.11a11.71,11.71,0,0,0,6.07,10.33,11.91,11.91,0,0,0,12.17-.23L230.32,138.1a11.82,11.82,0,0,0,0-20.2Zm-4.18,13.37L82.06,219.39a4,4,0,0,1-4.07.07,3.77,3.77,0,0,1-2-3.35V39.89a3.77,3.77,0,0,1,2-3.35,4,4,0,0,1,4.07.07l144.08,88.12a3.8,3.8,0,0,1,0,6.54Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Plus.es.js
var a$7 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M228,128a12,12,0,0,1-12,12H140v76a12,12,0,0,1-24,0V140H40a12,12,0,0,1,0-24h76V40a12,12,0,0,1,24,0v76h76A12,12,0,0,1,228,128Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M216,56V200a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V56A16,16,0,0,1,56,40H200A16,16,0,0,1,216,56Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM184,136H136v48a8,8,0,0,1-16,0V136H72a8,8,0,0,1,0-16h48V72a8,8,0,0,1,16,0v48h48a8,8,0,0,1,0,16Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M222,128a6,6,0,0,1-6,6H134v82a6,6,0,0,1-12,0V134H40a6,6,0,0,1,0-12h82V40a6,6,0,0,1,12,0v82h82A6,6,0,0,1,222,128Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M220,128a4,4,0,0,1-4,4H132v84a4,4,0,0,1-8,0V132H40a4,4,0,0,1,0-8h84V40a4,4,0,0,1,8,0v84h84A4,4,0,0,1,220,128Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Rectangle.es.js
var a$6 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,36H40A20,20,0,0,0,20,56V200a20,20,0,0,0,20,20H216a20,20,0,0,0,20-20V56A20,20,0,0,0,216,36Zm-4,160H44V60H212Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M224,56V200a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V56a8,8,0,0,1,8-8H216A8,8,0,0,1,224,56Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M232,56V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,42H40A14,14,0,0,0,26,56V200a14,14,0,0,0,14,14H216a14,14,0,0,0,14-14V56A14,14,0,0,0,216,42Zm2,158a2,2,0,0,1-2,2H40a2,2,0,0,1-2-2V56a2,2,0,0,1,2-2H216a2,2,0,0,1,2,2Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M216,44H40A12,12,0,0,0,28,56V200a12,12,0,0,0,12,12H216a12,12,0,0,0,12-12V56A12,12,0,0,0,216,44Zm4,156a4,4,0,0,1-4,4H40a4,4,0,0,1-4-4V56a4,4,0,0,1,4-4H216a4,4,0,0,1,4,4Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Rocket.es.js
var e$16 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M156,228a12,12,0,0,1-12,12H112a12,12,0,0,1,0-24h32A12,12,0,0,1,156,228ZM128,116a16,16,0,1,0-16-16A16,16,0,0,0,128,116Zm99.53,40.7-12.36,55.63a19.9,19.9,0,0,1-12.88,14.53A20.16,20.16,0,0,1,195.6,228a19.87,19.87,0,0,1-12.29-4.27L157.17,204H98.83L72.69,223.74A19.87,19.87,0,0,1,60.4,228a20.16,20.16,0,0,1-6.69-1.15,19.9,19.9,0,0,1-12.88-14.53L28.47,156.7a20.1,20.1,0,0,1,4.16-17.14l27.83-33.4A127,127,0,0,1,69.11,69.7c13.27-33.25,37-54.1,46.64-61.52a20,20,0,0,1,24.5,0c9.6,7.42,33.37,28.27,46.64,61.52a127,127,0,0,1,8.65,36.46l27.83,33.4A20.1,20.1,0,0,1,227.53,156.7ZM101.79,180h52.42c19.51-35.7,23-69.78,10.39-101.4C154.4,53,136.2,35.9,128,29.12,119.8,35.9,101.6,53,91.4,78.6,78.78,110.22,82.28,144.3,101.79,180Zm-22.55,8.72a168,168,0,0,1-16.92-47.3l-10,12,10.58,47.64Zm124.43-35.31-10-12a168,168,0,0,1-16.92,47.3l16.33,12.33Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M94.81,192,65.36,214.24a8,8,0,0,1-12.81-4.51L40.19,154.1a8,8,0,0,1,1.66-6.86l30.31-36.33C71,134.25,76.7,161.43,94.81,192Zm119.34-44.76-30.31-36.33c1.21,23.34-4.54,50.52-22.65,81.09l29.45,22.24a8,8,0,0,0,12.81-4.51l12.36-55.63A8,8,0,0,0,214.15,147.24Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M152,224a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h32A8,8,0,0,1,152,224ZM128,112a12,12,0,1,0-12-12A12,12,0,0,0,128,112Zm95.62,43.83-12.36,55.63a16,16,0,0,1-25.51,9.11L158.51,200h-61L70.25,220.57a16,16,0,0,1-25.51-9.11L32.38,155.83a16.09,16.09,0,0,1,3.32-13.71l28.56-34.26a123.07,123.07,0,0,1,8.57-36.67c12.9-32.34,36-52.63,45.37-59.85a16,16,0,0,1,19.6,0c9.34,7.22,32.47,27.51,45.37,59.85a123.07,123.07,0,0,1,8.57,36.67l28.56,34.26A16.09,16.09,0,0,1,223.62,155.83ZM99.43,184h57.14c21.12-37.54,25.07-73.48,11.74-106.88C156.55,47.64,134.49,29,128,24c-6.51,5-28.57,23.64-40.33,53.12C74.36,110.52,78.31,146.46,99.43,184Zm-15,5.85Q68.28,160.5,64.83,132.16L48,152.36,60.36,208l.18-.13ZM208,152.36l-16.83-20.2q-3.42,28.28-19.56,57.69l23.85,18,.18.13Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M152,224a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h32A8,8,0,0,1,152,224Zm71.62-68.17-12.36,55.63a16,16,0,0,1-25.51,9.11L158.51,200h-61L70.25,220.57a16,16,0,0,1-25.51-9.11L32.38,155.83a16.09,16.09,0,0,1,3.32-13.71l28.56-34.26a123.07,123.07,0,0,1,8.57-36.67c12.9-32.34,36-52.63,45.37-59.85a16,16,0,0,1,19.6,0c9.34,7.22,32.47,27.51,45.37,59.85a123.07,123.07,0,0,1,8.57,36.67l28.56,34.26A16.09,16.09,0,0,1,223.62,155.83Zm-139.23,34Q68.28,160.5,64.83,132.16L48,152.36,60.36,208l.18-.13ZM140,100a12,12,0,1,0-12,12A12,12,0,0,0,140,100Zm68,52.36-16.83-20.2q-3.42,28.28-19.56,57.69l23.85,18,.18.13Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M150,224a6,6,0,0,1-6,6H112a6,6,0,0,1,0-12h32A6,6,0,0,1,150,224ZM128,110a10,10,0,1,0-10-10A10,10,0,0,0,128,110Zm93.67,45.4L209.31,211A14,14,0,0,1,187,219l-27.79-21H96.82L69,219a14,14,0,0,1-22.34-8L34.33,155.4a14.06,14.06,0,0,1,2.91-12l29-34.76a121.28,121.28,0,0,1,8.48-36.71c12.72-31.88,35.52-51.88,44.73-59a14,14,0,0,1,17.16,0c9.21,7.12,32,27.12,44.73,59a121.28,121.28,0,0,1,8.48,36.71l29,34.76A14.06,14.06,0,0,1,221.67,155.4ZM98.26,186h59.48c21.93-38.46,26.12-75.33,12.43-109.62-11.95-30-34.35-48.87-40.93-54a2,2,0,0,0-2.48,0c-6.58,5.09-29,24-40.93,54C72.14,110.67,76.33,147.54,98.26,186ZM87,190.4c-12-21.49-18.9-42.6-20.62-63.19L46.46,151.08a2,2,0,0,0-.42,1.71l12.37,55.64a2,2,0,0,0,3.2,1.13l.13-.11Zm122.57-39.32-19.89-23.87c-1.72,20.59-8.6,41.7-20.62,63.19l25.23,19,.13.11a2,2,0,0,0,3.2-1.13L210,152.79A2,2,0,0,0,209.54,151.08Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M152,224a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h32A8,8,0,0,1,152,224ZM128,112a12,12,0,1,0-12-12A12,12,0,0,0,128,112Zm95.62,43.83-12.36,55.63a16,16,0,0,1-25.51,9.11L158.51,200h-61L70.25,220.57a16,16,0,0,1-25.51-9.11L32.38,155.83a16.09,16.09,0,0,1,3.32-13.71l28.56-34.26a123.07,123.07,0,0,1,8.57-36.67c12.9-32.34,36-52.63,45.37-59.85a16,16,0,0,1,19.6,0c9.34,7.22,32.47,27.51,45.37,59.85a123.07,123.07,0,0,1,8.57,36.67l28.56,34.26A16.09,16.09,0,0,1,223.62,155.83ZM99.43,184h57.14c21.12-37.54,25.07-73.48,11.74-106.88C156.55,47.64,134.49,29,128,24c-6.51,5-28.57,23.64-40.33,53.12C74.36,110.52,78.31,146.46,99.43,184Zm-15,5.85Q68.28,160.5,64.83,132.16L48,152.36,60.36,208l.18-.13ZM208,152.36l-16.83-20.2q-3.42,28.28-19.56,57.69l23.85,18,.18.13Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M148,224a4,4,0,0,1-4,4H112a4,4,0,0,1,0-8h32A4,4,0,0,1,148,224ZM128,108a8,8,0,1,0-8-8A8,8,0,0,0,128,108Zm91.72,47L207.35,210.6a11.9,11.9,0,0,1-7.72,8.71,12.17,12.17,0,0,1-4,.69,11.94,11.94,0,0,1-7.43-2.6L159.85,196H96.15L67.81,217.4a11.94,11.94,0,0,1-7.43,2.6,12.17,12.17,0,0,1-4-.69,11.9,11.9,0,0,1-7.72-8.71L36.28,155a12,12,0,0,1,2.5-10.28l29.35-35.23c3.3-53.33,41.83-86.68,52.52-94.94a12,12,0,0,1,14.7,0c10.69,8.26,49.22,41.61,52.52,94.94l29.35,35.23A12,12,0,0,1,219.72,155ZM97.11,188h61.78C214.07,92.49,145,32.05,130.46,20.84a4,4,0,0,0-4.92,0C111,32.05,41.93,92.49,97.11,188Zm-7.52,2.93C75.12,165.56,68.93,142.52,68,122.06L44.92,149.8a4,4,0,0,0-.83,3.43l12.36,55.63a4,4,0,0,0,6.41,2.26l.09-.07ZM211.08,149.8,188,122.06c-.89,20.46-7.08,43.5-21.55,68.87l26.64,20.12.09.07a4,4,0,0,0,6.41-2.26l12.36-55.63A4,4,0,0,0,211.08,149.8Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Shield.es.js
var a$5 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,36H48A20,20,0,0,0,28,56v56c0,54.29,26.32,87.22,48.4,105.29,23.71,19.39,47.44,26,48.44,26.29a12.1,12.1,0,0,0,6.32,0c1-.28,24.73-6.9,48.44-26.29,22.08-18.07,48.4-51,48.4-105.29V56A20,20,0,0,0,208,36Zm-4,76c0,35.71-13.09,64.69-38.91,86.15A126.28,126.28,0,0,1,128,219.38a126.14,126.14,0,0,1-37.09-21.23C65.09,176.69,52,147.71,52,112V60H204Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M216,56v56c0,96-88,120-88,120S40,208,40,112V56a8,8,0,0,1,8-8H208A8,8,0,0,1,216,56Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.27,47,25.53a8,8,0,0,0,4.2,0c1-.26,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M224,56v56c0,52.72-25.52,84.67-46.93,102.19-23.06,18.86-46,25.27-47,25.53a8,8,0,0,1-4.2,0c-1-.26-23.91-6.67-47-25.53C57.52,196.67,32,164.72,32,112V56A16,16,0,0,1,48,40H208A16,16,0,0,1,224,56Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,42H48A14,14,0,0,0,34,56v56c0,51.94,25.12,83.4,46.2,100.64,22.73,18.6,45.27,24.89,46.22,25.15a6,6,0,0,0,3.16,0c.95-.26,23.49-6.55,46.22-25.15C196.88,195.4,222,163.94,222,112V56A14,14,0,0,0,208,42Zm2,70c0,37.76-13.94,68.39-41.44,91.06A131.17,131.17,0,0,1,128,225.72a130.94,130.94,0,0,1-40.56-22.66C59.94,180.39,46,149.76,46,112V56a2,2,0,0,1,2-2H208a2,2,0,0,1,2,2Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.27,47,25.53a8,8,0,0,0,4.2,0c1-.26,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,44H48A12,12,0,0,0,36,56v56c0,51.16,24.73,82.12,45.47,99.1,22.4,18.32,44.55,24.5,45.48,24.76a4,4,0,0,0,2.1,0c.93-.26,23.08-6.44,45.48-24.76,20.74-17,45.47-47.94,45.47-99.1V56A12,12,0,0,0,208,44Zm4,68c0,38.44-14.23,69.63-42.29,92.71A132.45,132.45,0,0,1,128,227.82a132.23,132.23,0,0,1-41.71-23.11C58.23,181.63,44,150.44,44,112V56a4,4,0,0,1,4-4H208a4,4,0,0,1,4,4Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/SkipForward.es.js
var a$4 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M200,28a12,12,0,0,0-12,12v62l-113.45-71A20,20,0,0,0,44,47.88V208.12A20,20,0,0,0,74.55,225L188,154v62a12,12,0,0,0,24,0V40A12,12,0,0,0,200,28ZM68,200.73V55.27L184.3,128Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M196.3,134.65,68.19,214.77A8,8,0,0,1,56,208.12V47.88a8,8,0,0,1,12.19-6.65L196.3,121.35A7.83,7.83,0,0,1,196.3,134.65Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M200,32a8,8,0,0,0-8,8v69.23L72.43,34.45A15.95,15.95,0,0,0,48,47.88V208.12a16,16,0,0,0,24.43,13.43L192,146.77V216a8,8,0,0,0,16,0V40A8,8,0,0,0,200,32ZM64,207.93V48.05l127.84,80Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,40V216a8,8,0,0,1-16,0V146.77L72.43,221.55A15.95,15.95,0,0,1,48,208.12V47.88A15.95,15.95,0,0,1,72.43,34.45L192,109.23V40a8,8,0,0,1,16,0Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M200,34a6,6,0,0,0-6,6v72.84L71.37,36.14a14,14,0,0,0-14.21-.37A13.69,13.69,0,0,0,50,47.88V208.12a13.69,13.69,0,0,0,7.16,12.11,14,14,0,0,0,14.21-.37L194,143.17V216a6,6,0,0,0,12,0V40A6,6,0,0,0,200,34Zm-6.88,95.56L65,209.69a2,2,0,0,1-2,.05,1.79,1.79,0,0,1-1-1.62V47.88a1.79,1.79,0,0,1,1-1.62A2.1,2.1,0,0,1,64,46a2,2,0,0,1,1,.31l128.12,80.13a1.82,1.82,0,0,1,0,3.12Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M200,32a8,8,0,0,0-8,8v69.23L72.43,34.45A15.95,15.95,0,0,0,48,47.88V208.12a16,16,0,0,0,24.43,13.43L192,146.77V216a8,8,0,0,0,16,0V40A8,8,0,0,0,200,32ZM64,207.93V48.05l127.84,80Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M200,36a4,4,0,0,0-4,4v76.44L70.31,37.84a12,12,0,0,0-12.18-.32A11.69,11.69,0,0,0,52,47.88V208.12a11.69,11.69,0,0,0,6.13,10.36,12,12,0,0,0,12.18-.32L196,139.56V216a4,4,0,0,0,8,0V40A4,4,0,0,0,200,36Zm-5.82,95.26L66.06,211.38a4,4,0,0,1-4.06.11,3.8,3.8,0,0,1-2-3.37V47.88a3.8,3.8,0,0,1,2-3.37A4,4,0,0,1,64,44a4,4,0,0,1,2.11.62l128.12,80.12a3.83,3.83,0,0,1,0,6.52Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Spinner.es.js
var e$15 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M140,32V64a12,12,0,0,1-24,0V32a12,12,0,0,1,24,0Zm33.25,62.75a12,12,0,0,0,8.49-3.52L204.37,68.6a12,12,0,0,0-17-17L164.77,74.26a12,12,0,0,0,8.48,20.49ZM224,116H192a12,12,0,0,0,0,24h32a12,12,0,0,0,0-24Zm-42.26,48.77a12,12,0,1,0-17,17l22.63,22.63a12,12,0,0,0,17-17ZM128,180a12,12,0,0,0-12,12v32a12,12,0,0,0,24,0V192A12,12,0,0,0,128,180ZM74.26,164.77,51.63,187.4a12,12,0,0,0,17,17l22.63-22.63a12,12,0,1,0-17-17ZM76,128a12,12,0,0,0-12-12H32a12,12,0,0,0,0,24H64A12,12,0,0,0,76,128ZM68.6,51.63a12,12,0,1,0-17,17L74.26,91.23a12,12,0,0,0,17-17Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M136,32V64a8,8,0,0,1-16,0V32a8,8,0,0,1,16,0Zm37.25,58.75a8,8,0,0,0,5.66-2.35l22.63-22.62a8,8,0,0,0-11.32-11.32L167.6,77.09a8,8,0,0,0,5.65,13.66ZM224,120H192a8,8,0,0,0,0,16h32a8,8,0,0,0,0-16Zm-45.09,47.6a8,8,0,0,0-11.31,11.31l22.62,22.63a8,8,0,0,0,11.32-11.32ZM128,184a8,8,0,0,0-8,8v32a8,8,0,0,0,16,0V192A8,8,0,0,0,128,184ZM77.09,167.6,54.46,190.22a8,8,0,0,0,11.32,11.32L88.4,178.91A8,8,0,0,0,77.09,167.6ZM72,128a8,8,0,0,0-8-8H32a8,8,0,0,0,0,16H64A8,8,0,0,0,72,128ZM65.78,54.46A8,8,0,0,0,54.46,65.78L77.09,88.4A8,8,0,0,0,88.4,77.09Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm33.94,58.75,17-17a8,8,0,0,1,11.32,11.32l-17,17a8,8,0,0,1-11.31-11.31ZM48,136a8,8,0,0,1,0-16H72a8,8,0,0,1,0,16Zm46.06,37.25-17,17a8,8,0,0,1-11.32-11.32l17-17a8,8,0,0,1,11.31,11.31Zm0-79.19a8,8,0,0,1-11.31,0l-17-17A8,8,0,0,1,77.09,65.77l17,17A8,8,0,0,1,94.06,94.06ZM136,208a8,8,0,0,1-16,0V184a8,8,0,0,1,16,0Zm0-136a8,8,0,0,1-16,0V48a8,8,0,0,1,16,0Zm54.23,118.23a8,8,0,0,1-11.32,0l-17-17a8,8,0,0,1,11.31-11.31l17,17A8,8,0,0,1,190.23,190.23ZM208,136H184a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M134,32V64a6,6,0,0,1-12,0V32a6,6,0,0,1,12,0Zm39.25,56.75A6,6,0,0,0,177.5,87l22.62-22.63a6,6,0,0,0-8.48-8.48L169,78.5a6,6,0,0,0,4.24,10.25ZM224,122H192a6,6,0,0,0,0,12h32a6,6,0,0,0,0-12Zm-46.5,47A6,6,0,0,0,169,177.5l22.63,22.62a6,6,0,0,0,8.48-8.48ZM128,186a6,6,0,0,0-6,6v32a6,6,0,0,0,12,0V192A6,6,0,0,0,128,186ZM78.5,169,55.88,191.64a6,6,0,1,0,8.48,8.48L87,177.5A6,6,0,1,0,78.5,169ZM70,128a6,6,0,0,0-6-6H32a6,6,0,0,0,0,12H64A6,6,0,0,0,70,128ZM64.36,55.88a6,6,0,0,0-8.48,8.48L78.5,87A6,6,0,1,0,87,78.5Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M136,32V64a8,8,0,0,1-16,0V32a8,8,0,0,1,16,0Zm37.25,58.75a8,8,0,0,0,5.66-2.35l22.63-22.62a8,8,0,0,0-11.32-11.32L167.6,77.09a8,8,0,0,0,5.65,13.66ZM224,120H192a8,8,0,0,0,0,16h32a8,8,0,0,0,0-16Zm-45.09,47.6a8,8,0,0,0-11.31,11.31l22.62,22.63a8,8,0,0,0,11.32-11.32ZM128,184a8,8,0,0,0-8,8v32a8,8,0,0,0,16,0V192A8,8,0,0,0,128,184ZM77.09,167.6,54.46,190.22a8,8,0,0,0,11.32,11.32L88.4,178.91A8,8,0,0,0,77.09,167.6ZM72,128a8,8,0,0,0-8-8H32a8,8,0,0,0,0,16H64A8,8,0,0,0,72,128ZM65.78,54.46A8,8,0,0,0,54.46,65.78L77.09,88.4A8,8,0,0,0,88.4,77.09Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M132,32V64a4,4,0,0,1-8,0V32a4,4,0,0,1,8,0Zm41.25,54.75a4,4,0,0,0,2.83-1.18L198.71,63a4,4,0,0,0-5.66-5.66L170.43,79.92a4,4,0,0,0,2.82,6.83ZM224,124H192a4,4,0,0,0,0,8h32a4,4,0,0,0,0-8Zm-47.92,46.43a4,4,0,1,0-5.65,5.65l22.62,22.63a4,4,0,0,0,5.66-5.66ZM128,188a4,4,0,0,0-4,4v32a4,4,0,0,0,8,0V192A4,4,0,0,0,128,188ZM79.92,170.43,57.29,193.05A4,4,0,0,0,63,198.71l22.62-22.63a4,4,0,1,0-5.65-5.65ZM68,128a4,4,0,0,0-4-4H32a4,4,0,0,0,0,8H64A4,4,0,0,0,68,128ZM63,57.29A4,4,0,0,0,57.29,63L79.92,85.57a4,4,0,1,0,5.65-5.65Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Star.es.js
var l = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M243,96a20.33,20.33,0,0,0-17.74-14l-56.59-4.57L146.83,24.62a20.36,20.36,0,0,0-37.66,0L87.35,77.44,30.76,82A20.45,20.45,0,0,0,19.1,117.88l43.18,37.24-13.2,55.7A20.37,20.37,0,0,0,79.57,233L128,203.19,176.43,233a20.39,20.39,0,0,0,30.49-22.15l-13.2-55.7,43.18-37.24A20.43,20.43,0,0,0,243,96ZM172.53,141.7a12,12,0,0,0-3.84,11.86L181.58,208l-47.29-29.08a12,12,0,0,0-12.58,0L74.42,208l12.89-54.4a12,12,0,0,0-3.84-11.86L41.2,105.24l55.4-4.47a12,12,0,0,0,10.13-7.38L128,41.89l21.27,51.5a12,12,0,0,0,10.13,7.38l55.4,4.47Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M229.06,108.79l-48.7,42,14.88,62.79a8.4,8.4,0,0,1-12.52,9.17L128,189.09,73.28,222.74a8.4,8.4,0,0,1-12.52-9.17l14.88-62.79-48.7-42A8.46,8.46,0,0,1,31.73,94L95.64,88.8l24.62-59.6a8.36,8.36,0,0,1,15.48,0l24.62,59.6L224.27,94A8.46,8.46,0,0,1,229.06,108.79Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.38,16.38,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Zm-15.34,5.47-48.7,42a8,8,0,0,0-2.56,7.91l14.88,62.8a.37.37,0,0,1-.17.48c-.18.14-.23.11-.38,0l-54.72-33.65a8,8,0,0,0-8.38,0L69.09,215.94c-.15.09-.19.12-.38,0a.37.37,0,0,1-.17-.48l14.88-62.8a8,8,0,0,0-2.56-7.91l-48.7-42c-.12-.1-.23-.19-.13-.5s.18-.27.33-.29l63.92-5.16A8,8,0,0,0,103,91.86l24.62-59.61c.08-.17.11-.25.35-.25s.27.08.35.25L153,91.86a8,8,0,0,0,6.75,4.92l63.92,5.16c.15,0,.24,0,.33.29S224,102.63,223.84,102.73Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M237.28,97.87A14.18,14.18,0,0,0,224.76,88l-60.25-4.87-23.22-56.2a14.37,14.37,0,0,0-26.58,0L91.49,83.11,31.24,88a14.18,14.18,0,0,0-12.52,9.89A14.43,14.43,0,0,0,23,113.32L69,152.93l-14,59.25a14.4,14.4,0,0,0,5.59,15,14.1,14.1,0,0,0,15.91.6L128,196.12l51.58,31.71a14.1,14.1,0,0,0,15.91-.6,14.4,14.4,0,0,0,5.59-15l-14-59.25L233,113.32A14.43,14.43,0,0,0,237.28,97.87Zm-12.14,6.37-48.69,42a6,6,0,0,0-1.92,5.92l14.88,62.79a2.35,2.35,0,0,1-.95,2.57,2.24,2.24,0,0,1-2.6.1L131.14,184a6,6,0,0,0-6.28,0L70.14,217.61a2.24,2.24,0,0,1-2.6-.1,2.35,2.35,0,0,1-1-2.57l14.88-62.79a6,6,0,0,0-1.92-5.92l-48.69-42a2.37,2.37,0,0,1-.73-2.65,2.28,2.28,0,0,1,2.07-1.65l63.92-5.16a6,6,0,0,0,5.06-3.69l24.63-59.6a2.35,2.35,0,0,1,4.38,0l24.63,59.6a6,6,0,0,0,5.06,3.69l63.92,5.16a2.28,2.28,0,0,1,2.07,1.65A2.37,2.37,0,0,1,225.14,104.24Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.38,16.38,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Zm-15.34,5.47-48.7,42a8,8,0,0,0-2.56,7.91l14.88,62.8a.37.37,0,0,1-.17.48c-.18.14-.23.11-.38,0l-54.72-33.65a8,8,0,0,0-8.38,0L69.09,215.94c-.15.09-.19.12-.38,0a.37.37,0,0,1-.17-.48l14.88-62.8a8,8,0,0,0-2.56-7.91l-48.7-42c-.12-.1-.23-.19-.13-.5s.18-.27.33-.29l63.92-5.16A8,8,0,0,0,103,91.86l24.62-59.61c.08-.17.11-.25.35-.25s.27.08.35.25L153,91.86a8,8,0,0,0,6.75,4.92l63.92,5.16c.15,0,.24,0,.33.29S224,102.63,223.84,102.73Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M235.36,98.49A12.21,12.21,0,0,0,224.59,90l-61.47-5L139.44,27.67a12.37,12.37,0,0,0-22.88,0L92.88,85,31.41,90a12.45,12.45,0,0,0-7.07,21.84l46.85,40.41L56.87,212.64a12.35,12.35,0,0,0,18.51,13.49L128,193.77l52.62,32.36a12.12,12.12,0,0,0,13.69-.51,12.28,12.28,0,0,0,4.82-13l-14.32-60.42,46.85-40.41A12.29,12.29,0,0,0,235.36,98.49Zm-8.93,7.26-48.68,42a4,4,0,0,0-1.28,3.95l14.87,62.79a4.37,4.37,0,0,1-1.72,4.65,4.24,4.24,0,0,1-4.81.18L130.1,185.67a4,4,0,0,0-4.2,0L71.19,219.32a4.24,4.24,0,0,1-4.81-.18,4.37,4.37,0,0,1-1.72-4.65L79.53,151.7a4,4,0,0,0-1.28-3.95l-48.68-42A4.37,4.37,0,0,1,28.25,101a4.31,4.31,0,0,1,3.81-3L96,92.79a4,4,0,0,0,3.38-2.46L124,30.73a4.35,4.35,0,0,1,8.08,0l24.62,59.6A4,4,0,0,0,160,92.79l63.9,5.15a4.31,4.31,0,0,1,3.81,3A4.37,4.37,0,0,1,226.43,105.75Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Sun.es.js
var e$14 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M116,36V20a12,12,0,0,1,24,0V36a12,12,0,0,1-24,0Zm80,92a68,68,0,1,1-68-68A68.07,68.07,0,0,1,196,128Zm-24,0a44,44,0,1,0-44,44A44.05,44.05,0,0,0,172,128ZM51.51,68.49a12,12,0,1,0,17-17l-12-12a12,12,0,0,0-17,17Zm0,119-12,12a12,12,0,0,0,17,17l12-12a12,12,0,1,0-17-17ZM196,72a12,12,0,0,0,8.49-3.51l12-12a12,12,0,0,0-17-17l-12,12A12,12,0,0,0,196,72Zm8.49,115.51a12,12,0,0,0-17,17l12,12a12,12,0,0,0,17-17ZM48,128a12,12,0,0,0-12-12H20a12,12,0,0,0,0,24H36A12,12,0,0,0,48,128Zm80,80a12,12,0,0,0-12,12v16a12,12,0,0,0,24,0V220A12,12,0,0,0,128,208Zm108-92H220a12,12,0,0,0,0,24h16a12,12,0,0,0,0-24Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M184,128a56,56,0,1,1-56-56A56,56,0,0,1,184,128Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm8,24a64,64,0,1,0,64,64A64.07,64.07,0,0,0,128,64ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M122,40V16a6,6,0,0,1,12,0V40a6,6,0,0,1-12,0Zm68,88a62,62,0,1,1-62-62A62.07,62.07,0,0,1,190,128Zm-12,0a50,50,0,1,0-50,50A50.06,50.06,0,0,0,178,128ZM59.76,68.24a6,6,0,1,0,8.48-8.48l-16-16a6,6,0,0,0-8.48,8.48Zm0,119.52-16,16a6,6,0,1,0,8.48,8.48l16-16a6,6,0,1,0-8.48-8.48ZM192,70a6,6,0,0,0,4.24-1.76l16-16a6,6,0,0,0-8.48-8.48l-16,16A6,6,0,0,0,192,70Zm4.24,117.76a6,6,0,0,0-8.48,8.48l16,16a6,6,0,0,0,8.48-8.48ZM46,128a6,6,0,0,0-6-6H16a6,6,0,0,0,0,12H40A6,6,0,0,0,46,128Zm82,82a6,6,0,0,0-6,6v24a6,6,0,0,0,12,0V216A6,6,0,0,0,128,210Zm112-88H216a6,6,0,0,0,0,12h24a6,6,0,0,0,0-12Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M124,40V16a4,4,0,0,1,8,0V40a4,4,0,0,1-8,0Zm64,88a60,60,0,1,1-60-60A60.07,60.07,0,0,1,188,128Zm-8,0a52,52,0,1,0-52,52A52.06,52.06,0,0,0,180,128ZM61.17,66.83a4,4,0,0,0,5.66-5.66l-16-16a4,4,0,0,0-5.66,5.66Zm0,122.34-16,16a4,4,0,0,0,5.66,5.66l16-16a4,4,0,0,0-5.66-5.66ZM192,68a4,4,0,0,0,2.83-1.17l16-16a4,4,0,1,0-5.66-5.66l-16,16A4,4,0,0,0,192,68Zm2.83,121.17a4,4,0,0,0-5.66,5.66l16,16a4,4,0,0,0,5.66-5.66ZM40,124H16a4,4,0,0,0,0,8H40a4,4,0,0,0,0-8Zm88,88a4,4,0,0,0-4,4v24a4,4,0,0,0,8,0V216A4,4,0,0,0,128,212Zm112-88H216a4,4,0,0,0,0,8h24a4,4,0,0,0,0-8Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Tray.es.js
var e$13 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,28H48A20,20,0,0,0,28,48V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V48A20,20,0,0,0,208,28Zm-4,24v92H179.31a19.86,19.86,0,0,0-14.14,5.86L147,168H109L90.83,149.86A19.86,19.86,0,0,0,76.69,144H52V52ZM52,204V168H75l18.14,18.14A19.86,19.86,0,0,0,107.31,192h41.38a19.86,19.86,0,0,0,14.14-5.86L181,168h23v36Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M216,48V160H179.31a8,8,0,0,0-5.66,2.34l-19.31,19.32a8,8,0,0,1-5.66,2.34H107.31a8,8,0,0,1-5.66-2.34L82.34,162.34A8,8,0,0,0,76.68,160H40V48a8,8,0,0,1,8-8H208A8,8,0,0,1,216,48Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,16V152h-28.7A15.86,15.86,0,0,0,168,156.69L148.69,176H107.31L88,156.68A15.89,15.89,0,0,0,76.69,152H48V48Zm0,160H48V168H76.69L96,187.32A15.89,15.89,0,0,0,107.31,192h41.38A15.86,15.86,0,0,0,160,187.31L179.31,168H208v40Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,176H48V168H76.69L96,187.32A15.89,15.89,0,0,0,107.31,192h41.38A15.86,15.86,0,0,0,160,187.31L179.31,168H208v40Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,34H48A14,14,0,0,0,34,48V208a14,14,0,0,0,14,14H208a14,14,0,0,0,14-14V48A14,14,0,0,0,208,34ZM48,46H208a2,2,0,0,1,2,2V154H179.31a13.94,13.94,0,0,0-9.9,4.1L150.1,177.41a2,2,0,0,1-1.41.59H107.31a2,2,0,0,1-1.41-.58L86.59,158.1a13.94,13.94,0,0,0-9.9-4.1H46V48A2,2,0,0,1,48,46ZM208,210H48a2,2,0,0,1-2-2V166H76.69a2,2,0,0,1,1.41.58L97.41,185.9a13.94,13.94,0,0,0,9.9,4.1h41.38a13.94,13.94,0,0,0,9.9-4.1l19.31-19.31a2,2,0,0,1,1.41-.59H210v42A2,2,0,0,1,208,210Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,16V152h-28.7A15.86,15.86,0,0,0,168,156.69L148.69,176H107.31L88,156.69A15.86,15.86,0,0,0,76.69,152H48V48Zm0,160H48V168H76.69L96,187.31A15.86,15.86,0,0,0,107.31,192h41.38A15.86,15.86,0,0,0,160,187.31L179.31,168H208v40Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,36H48A12,12,0,0,0,36,48V208a12,12,0,0,0,12,12H208a12,12,0,0,0,12-12V48A12,12,0,0,0,208,36ZM48,44H208a4,4,0,0,1,4,4V156H179.31a12,12,0,0,0-8.48,3.51l-19.32,19.32a4,4,0,0,1-2.82,1.17H107.31a4,4,0,0,1-2.82-1.17L85.17,159.51A12,12,0,0,0,76.69,156H44V48A4,4,0,0,1,48,44ZM208,212H48a4,4,0,0,1-4-4V164H76.69a4,4,0,0,1,2.82,1.17l19.32,19.32a12,12,0,0,0,8.48,3.51h41.38a12,12,0,0,0,8.48-3.51l19.32-19.32a4,4,0,0,1,2.82-1.17H212v44A4,4,0,0,1,208,212Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/User.es.js
var a$3 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M234.38,210a123.36,123.36,0,0,0-60.78-53.23,76,76,0,1,0-91.2,0A123.36,123.36,0,0,0,21.62,210a12,12,0,1,0,20.77,12c18.12-31.32,50.12-50,85.61-50s67.49,18.69,85.61,50a12,12,0,0,0,20.77-12ZM76,96a52,52,0,1,1,52,52A52.06,52.06,0,0,1,76,96Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M192,96a64,64,0,1,1-64-64A64,64,0,0,1,192,96Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M230.93,220a8,8,0,0,1-6.93,4H32a8,8,0,0,1-6.92-12c15.23-26.33,38.7-45.21,66.09-54.16a72,72,0,1,1,73.66,0c27.39,8.95,50.86,27.83,66.09,54.16A8,8,0,0,1,230.93,220Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M229.19,213c-15.81-27.32-40.63-46.49-69.47-54.62a70,70,0,1,0-63.44,0C67.44,166.5,42.62,185.67,26.81,213a6,6,0,1,0,10.38,6C56.4,185.81,90.34,166,128,166s71.6,19.81,90.81,53a6,6,0,1,0,10.38-6ZM70,96a58,58,0,1,1,58,58A58.07,58.07,0,0,1,70,96Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M227.46,214c-16.52-28.56-43-48.06-73.68-55.09a68,68,0,1,0-51.56,0c-30.64,7-57.16,26.53-73.68,55.09a4,4,0,0,0,6.92,4C55,184.19,89.62,164,128,164s73,20.19,92.54,54a4,4,0,0,0,3.46,2,3.93,3.93,0,0,0,2-.54A4,4,0,0,0,227.46,214ZM68,96a60,60,0,1,1,60,60A60.07,60.07,0,0,1,68,96Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/Users.es.js
var a$2 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M125.18,156.94a64,64,0,1,0-82.36,0,100.23,100.23,0,0,0-39.49,32,12,12,0,0,0,19.35,14.2,76,76,0,0,1,122.64,0,12,12,0,0,0,19.36-14.2A100.33,100.33,0,0,0,125.18,156.94ZM44,108a40,40,0,1,1,40,40A40,40,0,0,1,44,108Zm206.1,97.67a12,12,0,0,1-16.78-2.57A76.31,76.31,0,0,0,172,172a12,12,0,0,1,0-24,40,40,0,1,0-10.3-78.67,12,12,0,1,1-6.16-23.19,64,64,0,0,1,57.64,110.8,100.23,100.23,0,0,1,39.49,32A12,12,0,0,1,250.1,205.67Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M136,108A52,52,0,1,1,84,56,52,52,0,0,1,136,108Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.7a8,8,0,0,1-11.07-2.33A79.83,79.83,0,0,0,172,168a8,8,0,0,1,0-16,44,44,0,1,0-16.34-84.87,8,8,0,1,1-5.94-14.85,60,60,0,0,1,55.53,105.64,95.83,95.83,0,0,1,47.22,37.71A8,8,0,0,1,250.14,206.7Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M164.47,195.63a8,8,0,0,1-6.7,12.37H10.23a8,8,0,0,1-6.7-12.37,95.83,95.83,0,0,1,47.22-37.71,60,60,0,1,1,66.5,0A95.83,95.83,0,0,1,164.47,195.63Zm87.91-.15a95.87,95.87,0,0,0-47.13-37.56A60,60,0,0,0,144.7,54.59a4,4,0,0,0-1.33,6A75.83,75.83,0,0,1,147,150.53a4,4,0,0,0,1.07,5.53,112.32,112.32,0,0,1,29.85,30.83,23.92,23.92,0,0,1,3.65,16.47,4,4,0,0,0,3.95,4.64h60.3a8,8,0,0,0,7.73-5.93A8.22,8.22,0,0,0,252.38,195.48Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M112.6,158.43a58,58,0,1,0-57.2,0A93.83,93.83,0,0,0,5.21,196.72a6,6,0,0,0,10.05,6.56,82,82,0,0,1,137.48,0,6,6,0,0,0,10-6.56A93.83,93.83,0,0,0,112.6,158.43ZM38,108a46,46,0,1,1,46,46A46.06,46.06,0,0,1,38,108Zm211,97a6,6,0,0,1-8.3-1.74A81.8,81.8,0,0,0,172,166a6,6,0,0,1,0-12,46,46,0,1,0-17.08-88.73,6,6,0,1,1-4.46-11.14,58,58,0,0,1,50.14,104.3,93.83,93.83,0,0,1,50.19,38.29A6,6,0,0,1,249,205Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.7a8,8,0,0,1-11.07-2.33A79.83,79.83,0,0,0,172,168a8,8,0,0,1,0-16,44,44,0,1,0-16.34-84.87,8,8,0,1,1-5.94-14.85,60,60,0,0,1,55.53,105.64,95.83,95.83,0,0,1,47.22,37.71A8,8,0,0,1,250.14,206.7Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M107.19,159a56,56,0,1,0-46.38,0A91.83,91.83,0,0,0,6.88,197.81a4,4,0,1,0,6.7,4.37,84,84,0,0,1,140.84,0,4,4,0,1,0,6.7-4.37A91.83,91.83,0,0,0,107.19,159ZM36,108a48,48,0,1,1,48,48A48.05,48.05,0,0,1,36,108Zm212,95.35a4,4,0,0,1-5.53-1.17A83.81,83.81,0,0,0,172,164a4,4,0,0,1,0-8,48,48,0,1,0-17.82-92.58,4,4,0,1,1-3-7.43,56,56,0,0,1,44,103,91.83,91.83,0,0,1,53.93,38.86A4,4,0,0,1,248,203.35Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/defs/X.es.js
var a$1 = /* @__PURE__ */ new Map([
	["bold", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z" }))],
	["duotone", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", {
		d: "M216,56V200a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V56A16,16,0,0,1,56,40H200A16,16,0,0,1,216,56Z",
		opacity: "0.2"
	}), /* @__PURE__ */ import_react.createElement("path", { d: "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" }))],
	["fill", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM181.66,170.34a8,8,0,0,1-11.32,11.32L128,139.31,85.66,181.66a8,8,0,0,1-11.32-11.32L116.69,128,74.34,85.66A8,8,0,0,1,85.66,74.34L128,116.69l42.34-42.35a8,8,0,0,1,11.32,11.32L139.31,128Z" }))],
	["light", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z" }))],
	["regular", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" }))],
	["thin", /* @__PURE__ */ import_react.createElement(import_react.Fragment, null, /* @__PURE__ */ import_react.createElement("path", { d: "M202.83,197.17a4,4,0,0,1-5.66,5.66L128,133.66,58.83,202.83a4,4,0,0,1-5.66-5.66L122.34,128,53.17,58.83a4,4,0,0,1,5.66-5.66L128,122.34l69.17-69.17a4,4,0,1,1,5.66,5.66L133.66,128Z" }))]
]);
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/ArrowCounterClockwise.es.js
var r$10 = import_react.forwardRef((e, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...e,
	weights: e$32
}));
r$10.displayName = "ArrowCounterClockwiseIcon";
var i = r$10;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/ArrowElbowDownRight.es.js
var r$9 = import_react.forwardRef((t, w) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: w,
	...t,
	weights: a$21
}));
r$9.displayName = "ArrowElbowDownRightIcon";
var m$2 = r$9;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/ArrowLeft.es.js
var r$8 = import_react.forwardRef((e, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...e,
	weights: a$20
}));
r$8.displayName = "ArrowLeftIcon";
var s$14 = r$8;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/ArrowRight.es.js
var r$7 = import_react.forwardRef((t, e) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: e,
	...t,
	weights: a$19
}));
r$7.displayName = "ArrowRightIcon";
var s$13 = r$7;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/ArrowUp.es.js
var r$6 = import_react.forwardRef((e, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...e,
	weights: a$18
}));
r$6.displayName = "ArrowUpIcon";
var s$12 = r$6;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Bell.es.js
var o$16 = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: e$31
}));
o$16.displayName = "BellIcon";
var s$11 = o$16;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Books.es.js
var e$12 = import_react.forwardRef((r, s) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: s,
	...r,
	weights: e$30
}));
e$12.displayName = "BooksIcon";
var n$17 = e$12;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Brain.es.js
var r$5 = import_react.forwardRef((a, e) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: e,
	...a,
	weights: e$29
}));
r$5.displayName = "BrainIcon";
var c$8 = r$5;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/CaretDown.es.js
var e$11 = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: t$7
}));
e$11.displayName = "CaretDownIcon";
var s$10 = e$11;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/CaretRight.es.js
var e$10 = import_react.forwardRef((o, r) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: r,
	...o,
	weights: t$6
}));
e$10.displayName = "CaretRightIcon";
var s$9 = e$10;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/ChatCircle.es.js
var o$15 = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: a$17
}));
o$15.displayName = "ChatCircleIcon";
var s$8 = o$15;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Check.es.js
var o$14 = import_react.forwardRef((c, r) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: r,
	...c,
	weights: a$16
}));
o$14.displayName = "CheckIcon";
var n$16 = o$14;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Circle.es.js
var o$13 = import_react.forwardRef((r, c) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: c,
	...r,
	weights: t$5
}));
o$13.displayName = "CircleIcon";
var s$7 = o$13;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Clock.es.js
var c$7 = import_react.forwardRef((e, r) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: r,
	...e,
	weights: a$15
}));
c$7.displayName = "ClockIcon";
var n$15 = c$7;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Copy.es.js
var e$9 = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: e$28
}));
e$9.displayName = "CopyIcon";
var s$6 = e$9;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/DotOutline.es.js
var t$3 = import_react.forwardRef((e, r) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: r,
	...e,
	weights: t$4
}));
t$3.displayName = "DotOutlineIcon";
var c$6 = t$3;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Envelope.es.js
var o$12 = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: a$14
}));
o$12.displayName = "EnvelopeIcon";
var c$5 = o$12;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Eyedropper.es.js
var o$11 = import_react.forwardRef((r, p) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: p,
	...r,
	weights: l$2
}));
o$11.displayName = "EyedropperIcon";
var s$5 = o$11;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/FolderPlus.es.js
var e$8 = import_react.forwardRef((r, s) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: s,
	...r,
	weights: e$27
}));
e$8.displayName = "FolderPlusIcon";
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Gear.es.js
var o$10 = import_react.forwardRef((r, a) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: a,
	...r,
	weights: l$1
}));
o$10.displayName = "GearIcon";
var n$14 = o$10;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Globe.es.js
var e$7 = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: e$26
}));
e$7.displayName = "GlobeIcon";
var n$13 = e$7;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Heart.es.js
var o$9 = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: a$13
}));
o$9.displayName = "HeartIcon";
var n$12 = o$9;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/House.es.js
var e$6 = import_react.forwardRef((r, s) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: s,
	...r,
	weights: e$25
}));
e$6.displayName = "HouseIcon";
var n$11 = e$6;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Image.es.js
var o$8 = import_react.forwardRef((a, m) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: m,
	...a,
	weights: e$24
}));
o$8.displayName = "ImageIcon";
var I = o$8;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Lightbulb.es.js
var t$2 = import_react.forwardRef((e, r) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: r,
	...e,
	weights: e$23
}));
t$2.displayName = "LightbulbIcon";
var s$4 = t$2;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Link.es.js
var e$5 = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: e$22
}));
e$5.displayName = "LinkIcon";
var c$4 = e$5;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/List.es.js
var t$1 = import_react.forwardRef((e, r) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: r,
	...e,
	weights: e$21
}));
t$1.displayName = "ListIcon";
var c$3 = t$1;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Lock.es.js
var c$2 = import_react.forwardRef((e, r) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: r,
	...e,
	weights: e$20
}));
c$2.displayName = "LockIcon";
var n$10 = c$2;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/MagnifyingGlass.es.js
var o$7 = import_react.forwardRef((s, n) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: n,
	...s,
	weights: a$12
}));
o$7.displayName = "MagnifyingGlassIcon";
var f = o$7;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Monitor.es.js
var r$4 = import_react.forwardRef((t, e) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: e,
	...t,
	weights: e$19
}));
r$4.displayName = "MonitorIcon";
var c$1 = r$4;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Moon.es.js
var e$4 = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: a$11
}));
e$4.displayName = "MoonIcon";
var s$3 = e$4;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/PaintBrush.es.js
var r$3 = import_react.forwardRef((t, a) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: a,
	...t,
	weights: a$10
}));
r$3.displayName = "PaintBrushIcon";
var m$1 = r$3;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Palette.es.js
var t = import_react.forwardRef((o, a) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: a,
	...o,
	weights: e$18
}));
t.displayName = "PaletteIcon";
var n$9 = t;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Pause.es.js
var o$6 = import_react.forwardRef((a, r) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: r,
	...a,
	weights: e$17
}));
o$6.displayName = "PauseIcon";
var n$8 = o$6;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Pencil.es.js
var o$5 = import_react.forwardRef((c, r) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: r,
	...c,
	weights: a$9
}));
o$5.displayName = "PencilIcon";
var m = o$5;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Play.es.js
var a = import_react.forwardRef((e, r) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: r,
	...e,
	weights: a$8
}));
a.displayName = "PlayIcon";
var n$7 = a;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Plus.es.js
var e$3 = import_react.forwardRef((r, s) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: s,
	...r,
	weights: a$7
}));
e$3.displayName = "PlusIcon";
var n$6 = e$3;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Rectangle.es.js
var o$4 = import_react.forwardRef((t, a) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: a,
	...t,
	weights: a$6
}));
o$4.displayName = "RectangleIcon";
var s$2 = o$4;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Rocket.es.js
var e$2 = import_react.forwardRef((t, c) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: c,
	...t,
	weights: e$16
}));
e$2.displayName = "RocketIcon";
var n$5 = e$2;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Shield.es.js
var o$3 = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: a$5
}));
o$3.displayName = "ShieldIcon";
var s$1 = o$3;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/SkipForward.es.js
var r$2 = import_react.forwardRef((a, e) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: e,
	...a,
	weights: a$4
}));
r$2.displayName = "SkipForwardIcon";
var c = r$2;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Spinner.es.js
var o$2 = import_react.forwardRef((r, n) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: n,
	...r,
	weights: e$15
}));
o$2.displayName = "SpinnerIcon";
var p = o$2;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Star.es.js
var r$1 = import_react.forwardRef((t, a) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: a,
	...t,
	weights: l
}));
r$1.displayName = "StarIcon";
var n$4 = r$1;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Sun.es.js
var e$1 = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: e$14
}));
e$1.displayName = "SunIcon";
var s = e$1;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Tray.es.js
var r = import_react.forwardRef((a, e) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: e,
	...a,
	weights: e$13
}));
r.displayName = "TrayIcon";
var n$3 = r;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/User.es.js
var o$1 = import_react.forwardRef((r, s) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: s,
	...r,
	weights: a$3
}));
o$1.displayName = "UserIcon";
var n$2 = o$1;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/Users.es.js
var o = import_react.forwardRef((r, s) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: s,
	...r,
	weights: a$2
}));
o.displayName = "UsersIcon";
var n$1 = o;
//#endregion
//#region node_modules/@phosphor-icons/react/dist/csr/X.es.js
var e = import_react.forwardRef((r, t) => /* @__PURE__ */ import_react.createElement(p$1, {
	ref: t,
	...r,
	weights: a$1
}));
e.displayName = "XIcon";
var n = e;
//#endregion
//#region node_modules/zustand/esm/vanilla.mjs
var createStoreImpl = (createState) => {
	let state;
	const listeners = /* @__PURE__ */ new Set();
	const setState = (partial, replace) => {
		const nextState = typeof partial === "function" ? partial(state) : partial;
		if (!Object.is(nextState, state)) {
			const previousState = state;
			state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
			listeners.forEach((listener) => listener(state, previousState));
		}
	};
	const getState = () => state;
	const getInitialState = () => initialState;
	const subscribe = (listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	const api = {
		setState,
		getState,
		getInitialState,
		subscribe
	};
	const initialState = state = createState(setState, getState, api);
	return api;
};
var createStore = ((createState) => createState ? createStoreImpl(createState) : createStoreImpl);
//#endregion
//#region node_modules/zustand/esm/react.mjs
var identity = (arg) => arg;
function useStore(api, selector = identity) {
	const slice = import_react.useSyncExternalStore(api.subscribe, import_react.useCallback(() => selector(api.getState()), [api, selector]), import_react.useCallback(() => selector(api.getInitialState()), [api, selector]));
	import_react.useDebugValue(slice);
	return slice;
}
var createImpl = (createState) => {
	const api = createStore(createState);
	const useBoundStore = (selector) => useStore(api, selector);
	Object.assign(useBoundStore, api);
	return useBoundStore;
};
var create = ((createState) => createState ? createImpl(createState) : createImpl);
//#endregion
//#region src/store/project-store.ts
var useProjectStore = create((set) => ({
	activeProject: null,
	isLoading: false,
	error: null,
	loadActiveProject: async () => {
		set({
			isLoading: true,
			error: null
		});
		try {
			set({
				activeProject: await window.omni.projects.getActive(),
				isLoading: false
			});
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : "Failed to load active project",
				isLoading: false
			});
		}
	},
	clearActiveProject: () => set({ activeProject: null })
}));
//#endregion
//#region @/components/ui/dropdown.tsx
var shape$1 = shapeMap.rounded;
var DropdownContext = (0, import_react.createContext)(null);
function useDropdown() {
	const ctx = (0, import_react.useContext)(DropdownContext);
	if (!ctx) throw new Error("useDropdown must be used within a Dropdown");
	return ctx;
}
var Dropdown = (0, import_react.forwardRef)(({ children, checkedIndex, className, ...props }, ref) => {
	const containerRef = (0, import_react.useRef)(null);
	const { activeIndex, setActiveIndex, itemRects, sessionRef, handlers, registerItem, measureItems } = useProximityHover(containerRef);
	(0, import_react.useEffect)(() => {
		measureItems();
	}, [measureItems, children]);
	const [focusedIndex, setFocusedIndex] = (0, import_react.useState)(null);
	const activeRect = activeIndex !== null ? itemRects[activeIndex] : null;
	const checkedRect = checkedIndex != null ? itemRects[checkedIndex] : null;
	const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null;
	const isHoveringOther = activeIndex !== null && activeIndex !== checkedIndex;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DropdownContext.Provider, {
		value: {
			registerItem,
			activeIndex,
			checkedIndex
		},
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Elevated, {
			offset: 2,
			shadowLevel: 3,
			ref: (node) => {
				containerRef.current = node;
				if (typeof ref === "function") ref(node);
				else if (ref) ref.current = node;
			},
			onMouseEnter: handlers.onMouseEnter,
			onMouseMove: handlers.onMouseMove,
			onMouseLeave: handlers.onMouseLeave,
			onFocus: (e) => {
				const indexAttr = e.target.closest("[data-proximity-index]")?.getAttribute("data-proximity-index");
				if (indexAttr != null) {
					const idx = Number(indexAttr);
					setActiveIndex(idx);
					setFocusedIndex(e.target.matches(":focus-visible") ? idx : null);
				}
			},
			onBlur: (e_0) => {
				if (containerRef.current?.contains(e_0.relatedTarget)) return;
				setFocusedIndex(null);
				setActiveIndex(null);
			},
			onKeyDown: (e_1) => {
				const items = Array.from(containerRef.current?.querySelectorAll("[role=\"menuitemradio\"]") ?? []);
				const currentIdx = items.indexOf(e_1.target);
				if (currentIdx === -1) return;
				if ([
					"ArrowDown",
					"ArrowUp",
					"ArrowRight",
					"ArrowLeft"
				].includes(e_1.key)) {
					e_1.preventDefault();
					items[["ArrowDown", "ArrowRight"].includes(e_1.key) ? (currentIdx + 1) % items.length : (currentIdx - 1 + items.length) % items.length].focus();
				} else if (e_1.key === "Home") {
					e_1.preventDefault();
					items[0]?.focus();
				} else if (e_1.key === "End") {
					e_1.preventDefault();
					items[items.length - 1]?.focus();
				}
			},
			role: "menu",
			className: cn(`relative flex flex-col gap-0.5 w-72 max-w-full ${shape$1.container} p-1 select-none`, className),
			...props,
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AnimatePresence, { children: checkedRect && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
					className: `absolute ${shape$1.bg} bg-active pointer-events-none`,
					initial: false,
					animate: {
						top: checkedRect.top,
						left: checkedRect.left,
						width: checkedRect.width,
						height: checkedRect.height,
						opacity: isHoveringOther ? .8 : 1
					},
					exit: {
						opacity: 0,
						transition: { duration: .12 }
					},
					transition: {
						...springs.moderate,
						opacity: { duration: .08 }
					}
				}) }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AnimatePresence, { children: activeRect && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
					className: `absolute ${shape$1.bg} bg-hover pointer-events-none`,
					initial: {
						opacity: 0,
						top: checkedRect?.top ?? activeRect.top,
						left: checkedRect?.left ?? activeRect.left,
						width: checkedRect?.width ?? activeRect.width,
						height: checkedRect?.height ?? activeRect.height
					},
					animate: {
						opacity: 1,
						top: activeRect.top,
						left: activeRect.left,
						width: activeRect.width,
						height: activeRect.height
					},
					exit: {
						opacity: 0,
						transition: { duration: .06 }
					},
					transition: {
						...springs.fast,
						opacity: { duration: .08 }
					}
				}, sessionRef.current) }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AnimatePresence, { children: focusRect && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
					className: `absolute ${shape$1.focusRing} pointer-events-none z-20 border border-[#6B97FF]`,
					initial: false,
					animate: {
						left: focusRect.left - 2,
						top: focusRect.top - 2,
						width: focusRect.width + 4,
						height: focusRect.height + 4
					},
					exit: {
						opacity: 0,
						transition: { duration: .06 }
					},
					transition: {
						...springs.fast,
						opacity: { duration: .08 }
					}
				}) }),
				children
			]
		})
	});
});
Dropdown.displayName = "Dropdown";
var DropdownLabel = (0, import_react.forwardRef)((t0, ref) => {
	const $ = (0, import_compiler_runtime.c)(9);
	let className;
	let props;
	if ($[0] !== t0) {
		({className, ...props} = t0);
		$[0] = t0;
		$[1] = className;
		$[2] = props;
	} else {
		className = $[1];
		props = $[2];
	}
	let t1;
	if ($[3] !== className) {
		t1 = cn("px-2 py-1.5 text-[11px] text-muted-foreground", className);
		$[3] = className;
		$[4] = t1;
	} else t1 = $[4];
	let t2;
	if ($[5] !== props || $[6] !== ref || $[7] !== t1) {
		t2 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			ref,
			className: t1,
			...props
		});
		$[5] = props;
		$[6] = ref;
		$[7] = t1;
		$[8] = t2;
	} else t2 = $[8];
	return t2;
});
DropdownLabel.displayName = "DropdownLabel";
var DropdownSeparator = (0, import_react.forwardRef)((t0, ref) => {
	const $ = (0, import_compiler_runtime.c)(9);
	let className;
	let props;
	if ($[0] !== t0) {
		({className, ...props} = t0);
		$[0] = t0;
		$[1] = className;
		$[2] = props;
	} else {
		className = $[1];
		props = $[2];
	}
	let t1;
	if ($[3] !== className) {
		t1 = cn("my-1 -mx-1 h-px bg-border/60", className);
		$[3] = className;
		$[4] = t1;
	} else t1 = $[4];
	let t2;
	if ($[5] !== props || $[6] !== ref || $[7] !== t1) {
		t2 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			ref,
			role: "separator",
			className: t1,
			...props
		});
		$[5] = props;
		$[6] = ref;
		$[7] = t1;
		$[8] = t2;
	} else t2 = $[8];
	return t2;
});
DropdownSeparator.displayName = "DropdownSeparator";
//#endregion
//#region @/components/ui/menu-item.tsx
var shape = shapeMap.rounded;
var MenuItem = (0, import_react.forwardRef)(({ icon: Icon, label, index, checked, onSelect, className, ...props }, ref) => {
	const internalRef = (0, import_react.useRef)(null);
	const hasMounted = (0, import_react.useRef)(false);
	const { registerItem, activeIndex, checkedIndex } = useDropdown();
	(0, import_react.useEffect)(() => {
		registerItem(index, internalRef.current);
		return () => registerItem(index, null);
	}, [index, registerItem]);
	(0, import_react.useEffect)(() => {
		hasMounted.current = true;
	}, []);
	const isActive = activeIndex === index;
	const skipAnimation = !hasMounted.current;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		ref: (node) => {
			internalRef.current = node;
			if (typeof ref === "function") ref(node);
			else if (ref) ref.current = node;
		},
		"data-proximity-index": index,
		tabIndex: index === (checkedIndex ?? 0) ? 0 : -1,
		role: "menuitemradio",
		"aria-checked": !!checked,
		"aria-label": label,
		onClick: onSelect,
		onKeyDown: (e) => {
			if (e.key === " " || e.key === "Enter") {
				e.preventDefault();
				onSelect?.();
			}
		},
		className: cn(`relative z-10 flex items-center gap-2 ${shape.item} px-2 py-2 cursor-pointer outline-none`, className),
		...props,
		children: [
			Icon && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "inline-grid",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "col-start-1 row-start-1 invisible",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
						size: 16,
						strokeWidth: 2
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
					size: 16,
					strokeWidth: isActive || checked ? 2 : 1.5,
					className: cn("col-start-1 row-start-1 transition-[color,stroke-width] duration-80", isActive || checked ? "text-foreground" : "text-muted-foreground")
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "inline-grid flex-1 text-[13px]",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "col-start-1 row-start-1 invisible",
					style: { fontVariationSettings: fontWeights.semibold },
					"aria-hidden": "true",
					children: label
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: cn("col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80", isActive || checked ? "text-foreground" : "text-muted-foreground"),
					style: { fontVariationSettings: checked ? fontWeights.semibold : fontWeights.normal },
					children: label
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AnimatePresence, { children: checked && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.svg, {
				width: 16,
				height: 16,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 2,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				className: "text-foreground shrink-0",
				initial: { opacity: 1 },
				animate: { opacity: 1 },
				exit: { opacity: 1 },
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.path, {
					d: "M4 12L9 17L20 6",
					initial: { pathLength: skipAnimation ? 1 : 0 },
					animate: {
						pathLength: 1,
						transition: {
							duration: .08,
							ease: "easeOut"
						}
					},
					exit: {
						pathLength: 0,
						transition: {
							duration: .04,
							ease: "easeIn"
						}
					}
				})
			}, "check") })
		]
	});
});
MenuItem.displayName = "MenuItem";
//#endregion
//#region node_modules/@base-ui/utils/esm/useControlled.js
function useControlled({ controlled, default: defaultProp, name, state = "value" }) {
	const { current: isControlled } = import_react.useRef(controlled !== void 0);
	const [valueState, setValue] = import_react.useState(defaultProp);
	return [isControlled ? controlled : valueState, import_react.useCallback((newValue) => {
		if (!isControlled) setValue(newValue);
	}, [])];
}
//#endregion
//#region node_modules/@base-ui/utils/esm/useIsoLayoutEffect.js
var noop = () => {};
var useIsoLayoutEffect$1 = typeof document !== "undefined" ? import_react.useLayoutEffect : noop;
//#endregion
//#region node_modules/@base-ui/utils/esm/safeReact.js
/**
* A clone of the React namespace for reading APIs that may be missing in older
* supported React versions. Bundlers can rewrite direct `React.someNewApi`
* reads into named imports, which breaks React 17. Reading from this cloned
* object keeps those lookups optional.
*
* @see https://github.com/mui/material-ui/issues/41190#issuecomment-2040873379
*/
var SafeReact = { ...import_react };
//#endregion
//#region node_modules/@base-ui/utils/esm/useRefWithInit.js
var UNINITIALIZED = {};
/**
* A React.useRef() that is initialized with a function. Note that it accepts an optional
* initialization argument, so the initialization function doesn't need to be an inline closure.
*
* @usage
*   const ref = useRefWithInit(sortColumns, columns)
*/
function useRefWithInit(init, initArg) {
	const ref = import_react.useRef(UNINITIALIZED);
	if (ref.current === UNINITIALIZED) ref.current = init(initArg);
	return ref;
}
//#endregion
//#region node_modules/@base-ui/utils/esm/useStableCallback.js
var useInsertionEffect$1 = SafeReact.useInsertionEffect;
var useSafeInsertionEffect = useInsertionEffect$1 && useInsertionEffect$1 !== SafeReact.useLayoutEffect ? useInsertionEffect$1 : (fn) => fn();
/**
* Stabilizes the function passed so it's always the same between renders.
*
* The function becomes non-reactive to any values it captures.
* It can safely be passed as a dependency of `React.useMemo` and `React.useEffect` without re-triggering them if its captured values change.
*
* The function must only be called inside effects and event handlers, never during render (which throws an error).
*
* This hook is a more permissive version of React 19.2's `React.useEffectEvent` in that it can be passed through contexts and called in event handler props, not just effects.
*/
function useStableCallback(callback) {
	const stable = useRefWithInit(createStableCallback).current;
	stable.next = callback;
	useSafeInsertionEffect(stable.effect);
	return stable.trampoline;
}
function createStableCallback() {
	const stable = {
		next: void 0,
		callback: assertNotCalled,
		trampoline: (...args) => stable.callback?.(...args),
		effect: () => {
			stable.callback = stable.next;
		}
	};
	return stable;
}
function assertNotCalled() {}
//#endregion
//#region node_modules/@base-ui/utils/esm/formatErrorMessage.js
/**
* Creates a formatErrorMessage function with a custom URL and prefix.
* @param baseUrl - The base URL for the error page (e.g., 'https://base-ui.com/production-error')
* @param prefix - The prefix for the error message (e.g., 'Base UI')
* @returns A function that formats error messages with the given URL and prefix
*/
function createFormatErrorMessage(baseUrl, prefix) {
	return function formatErrorMessage(code, ...args) {
		const url = new URL(baseUrl);
		url.searchParams.set("code", code.toString());
		args.forEach((arg) => url.searchParams.append("args[]", arg));
		return `${prefix} error #${code}; visit ${url} for the full message.`;
	};
}
/**
* WARNING: Don't import this directly. It's imported by the code generated by
* `@mui/internal-babel-plugin-minify-errors`. Make sure to always use string literals in `Error`
* constructors to ensure the plugin works as expected. Supported patterns include:
*   throw new Error('My message');
*   throw new Error(`My message: ${foo}`);
*   throw new Error(`My message: ${foo}` + 'another string');
*   ...
*/
var formatErrorMessage = createFormatErrorMessage("https://base-ui.com/production-error", "Base UI");
//#endregion
//#region node_modules/@base-ui/utils/esm/useMergedRefs.js
/**
* Merges refs into a single memoized callback ref or `null`.
* This makes sure multiple refs are updated together and have the same value.
*
* This function accepts up to four refs. If you need to merge more, or have an unspecified number of refs to merge,
* use `useMergedRefsN` instead.
*/
function useMergedRefs(a, b, c, d) {
	const forkRef = useRefWithInit(createForkRef).current;
	if (didChange(forkRef, a, b, c, d)) update(forkRef, [
		a,
		b,
		c,
		d
	]);
	return forkRef.callback;
}
/**
* Merges an array of refs into a single memoized callback ref or `null`.
*
* If you need to merge a fixed number (up to four) of refs, use `useMergedRefs` instead for better performance.
*/
function useMergedRefsN(refs) {
	const forkRef = useRefWithInit(createForkRef).current;
	if (didChangeN(forkRef, refs)) update(forkRef, refs);
	return forkRef.callback;
}
function createForkRef() {
	return {
		callback: null,
		cleanup: null,
		refs: []
	};
}
function didChange(forkRef, a, b, c, d) {
	return forkRef.refs[0] !== a || forkRef.refs[1] !== b || forkRef.refs[2] !== c || forkRef.refs[3] !== d;
}
function didChangeN(forkRef, newRefs) {
	return forkRef.refs.length !== newRefs.length || forkRef.refs.some((ref, index) => ref !== newRefs[index]);
}
function update(forkRef, refs) {
	forkRef.refs = refs;
	if (refs.every((ref) => ref == null)) {
		forkRef.callback = null;
		return;
	}
	forkRef.callback = (instance) => {
		if (forkRef.cleanup) {
			forkRef.cleanup();
			forkRef.cleanup = null;
		}
		if (instance != null) {
			const cleanupCallbacks = Array(refs.length).fill(null);
			for (let i = 0; i < refs.length; i += 1) {
				const ref = refs[i];
				if (ref == null) continue;
				switch (typeof ref) {
					case "function": {
						const refCleanup = ref(instance);
						if (typeof refCleanup === "function") cleanupCallbacks[i] = refCleanup;
						break;
					}
					case "object":
						ref.current = instance;
						break;
					default:
				}
			}
			forkRef.cleanup = () => {
				for (let i = 0; i < refs.length; i += 1) {
					const ref = refs[i];
					if (ref == null) continue;
					switch (typeof ref) {
						case "function": {
							const cleanupCallback = cleanupCallbacks[i];
							if (typeof cleanupCallback === "function") cleanupCallback();
							else ref(null);
							break;
						}
						case "object":
							ref.current = null;
							break;
						default:
					}
				}
			};
		}
	};
}
//#endregion
//#region node_modules/@base-ui/utils/esm/reactVersion.js
var majorVersion = parseInt("19.2.7", 10);
function isReactVersionAtLeast(reactVersionToCheck) {
	return majorVersion >= reactVersionToCheck;
}
//#endregion
//#region node_modules/@base-ui/utils/esm/getReactElementRef.js
/**
* Extracts the `ref` from a React element, handling different React versions.
*/
function getReactElementRef(element) {
	if (!/*#__PURE__*/ import_react.isValidElement(element)) return null;
	const reactElement = element;
	const propsWithRef = reactElement.props;
	return (isReactVersionAtLeast(19) ? propsWithRef?.ref : reactElement.ref) ?? null;
}
//#endregion
//#region node_modules/@base-ui/utils/esm/mergeObjects.js
function mergeObjects(a, b) {
	if (a && !b) return a;
	if (!a && b) return b;
	if (a || b) return {
		...a,
		...b
	};
}
//#endregion
//#region node_modules/@base-ui/utils/esm/empty.js
var EMPTY_ARRAY$1 = Object.freeze([]);
var EMPTY_OBJECT = Object.freeze({});
//#endregion
//#region node_modules/@base-ui/react/esm/internals/getStateAttributesProps.js
function getStateAttributesProps(state, customMapping) {
	const props = {};
	for (const key in state) {
		const value = state[key];
		if (customMapping?.hasOwnProperty(key)) {
			const customProps = customMapping[key](value);
			if (customProps != null) Object.assign(props, customProps);
			continue;
		}
		if (value === true) props[`data-${key.toLowerCase()}`] = "";
		else if (value) props[`data-${key.toLowerCase()}`] = value.toString();
	}
	return props;
}
//#endregion
//#region node_modules/@base-ui/react/esm/utils/resolveClassName.js
/**
* If the provided className is a string, it will be returned as is.
* Otherwise, the function will call the className function with the state as the first argument.
*
* @param className
* @param state
*/
function resolveClassName(className, state) {
	return typeof className === "function" ? className(state) : className;
}
//#endregion
//#region node_modules/@base-ui/react/esm/utils/resolveStyle.js
/**
* If the provided style is an object, it will be returned as is.
* Otherwise, the function will call the style function with the state as the first argument.
*
* @param style
* @param state
*/
function resolveStyle(style, state) {
	return typeof style === "function" ? style(state) : style;
}
//#endregion
//#region node_modules/@base-ui/react/esm/merge-props/mergeProps.js
var EMPTY_PROPS = {};
/**
* Merges multiple sets of React props. It follows the Object.assign pattern where the rightmost object's fields overwrite
* the conflicting ones from others. This doesn't apply to event handlers, `className` and `style` props.
*
* Event handlers are merged and called in right-to-left order (rightmost handler executes first, leftmost last).
* For React synthetic events, the rightmost handler can prevent prior (left-positioned) handlers from executing
* by calling `event.preventBaseUIHandler()`. For non-synthetic events (custom events with primitive/object values),
* all handlers always execute without prevention capability.
*
* The `className` prop is merged by concatenating classes in right-to-left order (rightmost class appears first in the string).
* The `style` prop is merged with rightmost styles overwriting the prior ones.
*
* Props can either be provided as objects or as functions that take the previous props as an argument.
* The function will receive the merged props up to that point (going from left to right):
* so in the case of `(obj1, obj2, fn, obj3)`, `fn` will receive the merged props of `obj1` and `obj2`.
* The function is responsible for chaining event handlers if needed (that is, we don't run the merge logic).
*
* Event handlers returned by the functions are not automatically prevented when `preventBaseUIHandler` is called.
* They must check `event.baseUIHandlerPrevented` themselves and bail out if it's true.
*
* @important **`ref` is not merged.**
* @param a Props object to merge.
* @param b Props object to merge. The function will overwrite conflicting props from `a`.
* @param c Props object to merge. The function will overwrite conflicting props from previous parameters.
* @param d Props object to merge. The function will overwrite conflicting props from previous parameters.
* @param e Props object to merge. The function will overwrite conflicting props from previous parameters.
* @returns The merged props.
* @public
*/
function mergeProps(a, b, c, d, e) {
	if (!c && !d && !e && !a) return createInitialMergedProps(b);
	let merged = createInitialMergedProps(a);
	if (b) merged = mergeInto(merged, b);
	if (c) merged = mergeInto(merged, c);
	if (d) merged = mergeInto(merged, d);
	if (e) merged = mergeInto(merged, e);
	return merged;
}
/**
* Merges an arbitrary number of React props using the same logic as {@link mergeProps}.
* This function accepts an array of props instead of individual arguments.
*
* This has slightly lower performance than {@link mergeProps} due to accepting an array
* instead of a fixed number of arguments. Prefer {@link mergeProps} when merging 5 or
* fewer prop sets for better performance.
*
* @param props Array of props to merge.
* @returns The merged props.
* @see mergeProps
* @public
*/
function mergePropsN(props) {
	if (props.length === 0) return EMPTY_PROPS;
	if (props.length === 1) return createInitialMergedProps(props[0]);
	let merged = createInitialMergedProps(props[0]);
	for (let i = 1; i < props.length; i += 1) merged = mergeInto(merged, props[i]);
	return merged;
}
function createInitialMergedProps(inputProps) {
	if (isPropsGetter(inputProps)) return { ...resolvePropsGetter(inputProps, EMPTY_PROPS) };
	return copyInitialProps(inputProps);
}
function mergeInto(merged, inputProps) {
	if (isPropsGetter(inputProps)) return resolvePropsGetter(inputProps, merged);
	return mutablyMergeInto(merged, inputProps);
}
function copyInitialProps(inputProps) {
	const copiedProps = { ...inputProps };
	for (const propName in copiedProps) {
		const propValue = copiedProps[propName];
		if (isEventHandler(propName, propValue)) copiedProps[propName] = wrapEventHandler(propValue);
	}
	return copiedProps;
}
/**
* Merges two sets of props. In case of conflicts, the external props take precedence.
*/
function mutablyMergeInto(mergedProps, externalProps) {
	if (!externalProps) return mergedProps;
	for (const propName in externalProps) {
		const externalPropValue = externalProps[propName];
		switch (propName) {
			case "style":
				mergedProps[propName] = mergeObjects(mergedProps.style, externalPropValue);
				break;
			case "className":
				mergedProps[propName] = mergeClassNames(mergedProps.className, externalPropValue);
				break;
			default: if (isEventHandler(propName, externalPropValue)) mergedProps[propName] = mergeEventHandlers(mergedProps[propName], externalPropValue);
			else mergedProps[propName] = externalPropValue;
		}
	}
	return mergedProps;
}
function isEventHandler(key, value) {
	const code0 = key.charCodeAt(0);
	const code1 = key.charCodeAt(1);
	const code2 = key.charCodeAt(2);
	return code0 === 111 && code1 === 110 && code2 >= 65 && code2 <= 90 && (typeof value === "function" || typeof value === "undefined");
}
function isPropsGetter(inputProps) {
	return typeof inputProps === "function";
}
function resolvePropsGetter(inputProps, previousProps) {
	if (isPropsGetter(inputProps)) return inputProps(previousProps);
	return inputProps ?? EMPTY_PROPS;
}
function mergeEventHandlers(ourHandler, theirHandler) {
	if (!theirHandler) return ourHandler;
	if (!ourHandler) return wrapEventHandler(theirHandler);
	return (...args) => {
		const event = args[0];
		if (isSyntheticEvent(event)) {
			const baseUIEvent = event;
			makeEventPreventable(baseUIEvent);
			const result = theirHandler(...args);
			if (!baseUIEvent.baseUIHandlerPrevented) ourHandler?.(...args);
			return result;
		}
		const result = theirHandler(...args);
		ourHandler?.(...args);
		return result;
	};
}
function wrapEventHandler(handler) {
	if (!handler) return handler;
	return (...args) => {
		const event = args[0];
		if (isSyntheticEvent(event)) makeEventPreventable(event);
		return handler(...args);
	};
}
function makeEventPreventable(event) {
	event.preventBaseUIHandler = () => {
		event.baseUIHandlerPrevented = true;
	};
	return event;
}
function mergeClassNames(ourClassName, theirClassName) {
	if (theirClassName) {
		if (ourClassName) return theirClassName + " " + ourClassName;
		return theirClassName;
	}
	return ourClassName;
}
function isSyntheticEvent(event) {
	return event != null && typeof event === "object" && "nativeEvent" in event;
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/useRenderElement.js
/**
* Renders a Base UI element.
*
* @param element The default HTML element to render. Can be overridden by the `render` prop.
* @param componentProps An object containing the `render` and `className` props to be used for element customization. Other props are ignored.
* @param params Additional parameters for rendering the element.
*/
function useRenderElement(element, componentProps, params = {}) {
	const renderProp = componentProps.render;
	const outProps = useRenderElementProps(componentProps, params);
	if (params.enabled === false) return null;
	return evaluateRenderProp(element, renderProp, outProps, params.state ?? EMPTY_OBJECT);
}
/**
* Computes render element final props.
*/
function useRenderElementProps(componentProps, params = {}) {
	const { className: classNameProp, style: styleProp, render: renderProp } = componentProps;
	const { state = EMPTY_OBJECT, ref, props, stateAttributesMapping, enabled = true } = params;
	const className = enabled ? resolveClassName(classNameProp, state) : void 0;
	const style = enabled ? resolveStyle(styleProp, state) : void 0;
	const stateProps = enabled ? getStateAttributesProps(state, stateAttributesMapping) : EMPTY_OBJECT;
	const resolvedProps = enabled && props ? resolveRenderFunctionProps(props) : void 0;
	const outProps = enabled ? mergeObjects(stateProps, resolvedProps) ?? {} : EMPTY_OBJECT;
	if (typeof document !== "undefined") if (!enabled) useMergedRefs(null, null);
	else if (Array.isArray(ref)) outProps.ref = useMergedRefsN([
		outProps.ref,
		getReactElementRef(renderProp),
		...ref
	]);
	else outProps.ref = useMergedRefs(outProps.ref, getReactElementRef(renderProp), ref);
	if (!enabled) return EMPTY_OBJECT;
	if (className !== void 0) outProps.className = mergeClassNames(outProps.className, className);
	if (style !== void 0) outProps.style = mergeObjects(outProps.style, style);
	return outProps;
}
function resolveRenderFunctionProps(props) {
	if (Array.isArray(props)) return mergePropsN(props);
	return mergeProps(void 0, props);
}
var REACT_LAZY_TYPE = Symbol.for("react.lazy");
function evaluateRenderProp(element, render, props, state) {
	if (render) {
		if (typeof render === "function") return render(props, state);
		const mergedProps = mergeProps(props, render.props);
		mergedProps.ref = props.ref;
		let newElement = render;
		if (newElement?.$$typeof === REACT_LAZY_TYPE) newElement = import_react.Children.toArray(render)[0];
		return /*#__PURE__*/ import_react.cloneElement(newElement, mergedProps);
	}
	if (element) {
		if (typeof element === "string") return renderTag(element, props);
	}
	throw new Error(formatErrorMessage(8));
}
function renderTag(Tag, props) {
	if (Tag === "button") return /*#__PURE__*/ (0, import_react.createElement)("button", {
		type: "button",
		...props,
		key: props.key
	});
	if (Tag === "img") return /*#__PURE__*/ (0, import_react.createElement)("img", {
		alt: "",
		...props,
		key: props.key
	});
	return /*#__PURE__*/ import_react.createElement(Tag, props);
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/composite/list/CompositeListContext.js
var CompositeListContext = /*#__PURE__*/ import_react.createContext({
	register: () => {},
	unregister: () => {},
	subscribeMapChange: () => {
		return () => {};
	},
	elementsRef: { current: [] },
	nextIndexRef: { current: 0 }
});
function useCompositeListContext() {
	return import_react.useContext(CompositeListContext);
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/composite/list/CompositeList.js
/**
* Provides context for a list of items in a composite component.
* @internal
*/
function CompositeList(props) {
	const { children, elementsRef, labelsRef, onMapChange: onMapChangeProp } = props;
	const onMapChange = useStableCallback(onMapChangeProp);
	const nextIndexRef = import_react.useRef(0);
	const listeners = useRefWithInit(createListeners).current;
	const map = useRefWithInit(createMap).current;
	const [mapTick, setMapTick] = import_react.useState(0);
	const lastTickRef = import_react.useRef(mapTick);
	const register = useStableCallback((node, metadata) => {
		map.set(node, metadata ?? null);
		lastTickRef.current += 1;
		setMapTick(lastTickRef.current);
	});
	const unregister = useStableCallback((node) => {
		map.delete(node);
		lastTickRef.current += 1;
		setMapTick(lastTickRef.current);
	});
	const sortedMap = import_react.useMemo(() => {
		const newMap = /* @__PURE__ */ new Map();
		Array.from(map.keys()).filter((node) => node.isConnected).sort(sortByDocumentPosition).forEach((node, index) => {
			const metadata = map.get(node) ?? {};
			newMap.set(node, {
				...metadata,
				index
			});
		});
		return newMap;
	}, [map, mapTick]);
	useIsoLayoutEffect$1(() => {
		if (typeof MutationObserver !== "function" || sortedMap.size === 0) return;
		const mutationObserver = new MutationObserver((entries) => {
			const diff = /* @__PURE__ */ new Set();
			const updateDiff = (node) => diff.has(node) ? diff.delete(node) : diff.add(node);
			entries.forEach((entry) => {
				entry.removedNodes.forEach(updateDiff);
				entry.addedNodes.forEach(updateDiff);
			});
			if (diff.size === 0) {
				lastTickRef.current += 1;
				setMapTick(lastTickRef.current);
			}
		});
		sortedMap.forEach((_, node) => {
			if (node.parentElement) mutationObserver.observe(node.parentElement, { childList: true });
		});
		return () => {
			mutationObserver.disconnect();
		};
	}, [sortedMap]);
	useIsoLayoutEffect$1(() => {
		if (lastTickRef.current === mapTick) {
			if (elementsRef.current.length !== sortedMap.size) elementsRef.current.length = sortedMap.size;
			if (labelsRef && labelsRef.current.length !== sortedMap.size) labelsRef.current.length = sortedMap.size;
			nextIndexRef.current = sortedMap.size;
		}
		onMapChange(sortedMap);
	}, [
		onMapChange,
		sortedMap,
		elementsRef,
		labelsRef,
		mapTick
	]);
	useIsoLayoutEffect$1(() => {
		return () => {
			elementsRef.current = [];
		};
	}, [elementsRef]);
	useIsoLayoutEffect$1(() => {
		return () => {
			if (labelsRef) labelsRef.current = [];
		};
	}, [labelsRef]);
	const subscribeMapChange = useStableCallback((fn) => {
		listeners.add(fn);
		return () => {
			listeners.delete(fn);
		};
	});
	useIsoLayoutEffect$1(() => {
		listeners.forEach((l) => l(sortedMap));
	}, [listeners, sortedMap]);
	const contextValue = import_react.useMemo(() => ({
		register,
		unregister,
		subscribeMapChange,
		elementsRef,
		labelsRef,
		nextIndexRef
	}), [
		register,
		unregister,
		subscribeMapChange,
		elementsRef,
		labelsRef,
		nextIndexRef
	]);
	return /*#__PURE__*/ (0, import_jsx_runtime.jsx)(CompositeListContext.Provider, {
		value: contextValue,
		children
	});
}
function createMap() {
	return /* @__PURE__ */ new Map();
}
function createListeners() {
	return /* @__PURE__ */ new Set();
}
function sortByDocumentPosition(a, b) {
	const position = a.compareDocumentPosition(b);
	if (position & Node.DOCUMENT_POSITION_FOLLOWING || position & Node.DOCUMENT_POSITION_CONTAINED_BY) return -1;
	if (position & Node.DOCUMENT_POSITION_PRECEDING || position & Node.DOCUMENT_POSITION_CONTAINS) return 1;
	return 0;
}
//#endregion
//#region node_modules/@base-ui/react/esm/tabs/root/TabsRootContext.js
/**
* @internal
*/
var TabsRootContext = /*#__PURE__*/ import_react.createContext(void 0);
function useTabsRootContext() {
	const context = import_react.useContext(TabsRootContext);
	if (context === void 0) throw new Error(formatErrorMessage(64));
	return context;
}
//#endregion
//#region node_modules/@base-ui/react/esm/tabs/root/TabsRootDataAttributes.js
var TabsRootDataAttributes = /*#__PURE__*/ function(TabsRootDataAttributes) {
	/**
	* Indicates the direction of the activation (based on the previous active tab).
	* @type {'left' | 'right' | 'up' | 'down' | 'none'}
	*/
	TabsRootDataAttributes["activationDirection"] = "data-activation-direction";
	/**
	* Indicates the orientation of the tabs.
	* @type {'horizontal' | 'vertical'}
	*/
	TabsRootDataAttributes["orientation"] = "data-orientation";
	return TabsRootDataAttributes;
}({});
//#endregion
//#region node_modules/@base-ui/react/esm/tabs/root/stateAttributesMapping.js
var tabsStateAttributesMapping = { tabActivationDirection: (dir) => ({ [TabsRootDataAttributes.activationDirection]: dir }) };
//#endregion
//#region node_modules/@base-ui/react/esm/internals/reason-parts.js
var none = "none";
var disabled = "disabled";
var missing = "missing";
var initial = "initial";
//#endregion
//#region node_modules/@base-ui/react/esm/internals/createBaseUIEventDetails.js
/**
* Maps a change `reason` string to the corresponding native event type.
*/
/**
* Details of custom change events emitted by Base UI components.
*/
/**
* Details of custom generic events emitted by Base UI components.
*/
/**
* Creates a Base UI event details object with the given reason and utilities
* for preventing Base UI's internal event handling.
*/
function createChangeEventDetails(reason, event, trigger, customProperties) {
	let canceled = false;
	let allowPropagation = false;
	const custom = customProperties ?? EMPTY_OBJECT;
	return {
		reason,
		event: event ?? new Event("base-ui"),
		cancel() {
			canceled = true;
		},
		allowPropagation() {
			allowPropagation = true;
		},
		get isCanceled() {
			return canceled;
		},
		get isPropagationAllowed() {
			return allowPropagation;
		},
		trigger,
		...custom
	};
}
//#endregion
//#region node_modules/@base-ui/react/esm/tabs/root/TabsRoot.js
/**
* Groups the tabs and the corresponding panels.
* Renders a `<div>` element.
*
* Documentation: [Base UI Tabs](https://base-ui.com/react/components/tabs)
*/
var TabsRoot = /*#__PURE__*/ import_react.forwardRef(function TabsRoot(componentProps, forwardedRef) {
	const { className, defaultValue: defaultValueProp = 0, onValueChange: onValueChangeProp, orientation = "horizontal", render, value: valueProp, style, ...elementProps } = componentProps;
	const hasExplicitDefaultValueProp = componentProps.defaultValue !== void 0;
	const tabPanelRefs = import_react.useRef([]);
	const [mountedTabPanels, setMountedTabPanels] = import_react.useState(() => /* @__PURE__ */ new Map());
	const [value, setValue] = useControlled({
		controlled: valueProp,
		default: defaultValueProp,
		name: "Tabs",
		state: "value"
	});
	const isControlled = valueProp !== void 0;
	const [tabMap, setTabMap] = import_react.useState(() => /* @__PURE__ */ new Map());
	const getTabElementBySelectedValue = import_react.useCallback((selectedValue) => {
		if (selectedValue === void 0) return null;
		for (const [tabElement, tabMetadata] of tabMap.entries()) if (tabMetadata != null && selectedValue === (tabMetadata.value ?? tabMetadata.index)) return tabElement;
		return null;
	}, [tabMap]);
	const [activationDirectionState, setActivationDirectionState] = import_react.useState(() => ({
		previousValue: value,
		tabActivationDirection: "none"
	}));
	const { previousValue, tabActivationDirection: committedTabActivationDirection } = activationDirectionState;
	let tabActivationDirection = committedTabActivationDirection;
	let directionComputationIncomplete = false;
	if (previousValue !== value) {
		tabActivationDirection = computeActivationDirection(previousValue, value, orientation, tabMap);
		directionComputationIncomplete = previousValue != null && value != null && getTabElementBySelectedValue(value) == null;
	}
	const nextPreviousValue = directionComputationIncomplete ? previousValue : value;
	const shouldSyncActivationDirectionState = previousValue !== nextPreviousValue || committedTabActivationDirection !== tabActivationDirection;
	useIsoLayoutEffect$1(() => {
		if (!shouldSyncActivationDirectionState) return;
		setActivationDirectionState({
			previousValue: nextPreviousValue,
			tabActivationDirection
		});
	}, [
		nextPreviousValue,
		shouldSyncActivationDirectionState,
		tabActivationDirection
	]);
	const onValueChange = useStableCallback((newValue, eventDetails) => {
		eventDetails.activationDirection = computeActivationDirection(value, newValue, orientation, tabMap);
		onValueChangeProp?.(newValue, eventDetails);
		if (eventDetails.isCanceled) return;
		setValue(newValue);
	});
	const notifyAutomaticValueChange = useStableCallback((nextValue, reason) => {
		onValueChangeProp?.(nextValue, createChangeEventDetails(reason, void 0, void 0, { activationDirection: "none" }));
	});
	const registerMountedTabPanel = useStableCallback((panelValue, panelId) => {
		setMountedTabPanels((prev) => {
			if (prev.get(panelValue) === panelId) return prev;
			const next = new Map(prev);
			next.set(panelValue, panelId);
			return next;
		});
	});
	const unregisterMountedTabPanel = useStableCallback((panelValue, panelId) => {
		setMountedTabPanels((prev) => {
			if (!prev.has(panelValue) || prev.get(panelValue) !== panelId) return prev;
			const next = new Map(prev);
			next.delete(panelValue);
			return next;
		});
	});
	const getTabPanelIdByValue = import_react.useCallback((tabValue) => {
		return mountedTabPanels.get(tabValue);
	}, [mountedTabPanels]);
	const getTabIdByPanelValue = import_react.useCallback((tabPanelValue) => {
		for (const tabMetadata of tabMap.values()) if (tabPanelValue === tabMetadata?.value) return tabMetadata?.id;
	}, [tabMap]);
	const tabsContextValue = import_react.useMemo(() => ({
		getTabElementBySelectedValue,
		getTabIdByPanelValue,
		getTabPanelIdByValue,
		onValueChange,
		orientation,
		registerMountedTabPanel,
		setTabMap,
		unregisterMountedTabPanel,
		tabActivationDirection,
		value
	}), [
		getTabElementBySelectedValue,
		getTabIdByPanelValue,
		getTabPanelIdByValue,
		onValueChange,
		orientation,
		registerMountedTabPanel,
		setTabMap,
		unregisterMountedTabPanel,
		tabActivationDirection,
		value
	]);
	const selectedTabMetadata = import_react.useMemo(() => {
		for (const tabMetadata of tabMap.values()) if (tabMetadata != null && tabMetadata.value === value) return tabMetadata;
	}, [tabMap, value]);
	const firstEnabledTabValue = import_react.useMemo(() => {
		for (const tabMetadata of tabMap.values()) if (tabMetadata != null && !tabMetadata.disabled) return tabMetadata.value;
	}, [tabMap]);
	const shouldNotifyInitialValueChangeRef = import_react.useRef(!hasExplicitDefaultValueProp);
	const shouldHonorDisabledDefaultValueRef = import_react.useRef(hasExplicitDefaultValueProp);
	const didRegisterTabsRef = import_react.useRef(false);
	useIsoLayoutEffect$1(() => {
		if (isControlled) return;
		function commitAutomaticValueChange(fallbackValue, fallbackReason) {
			setValue(fallbackValue);
			setActivationDirectionState((prev) => {
				if (prev.previousValue === fallbackValue && prev.tabActivationDirection === "none") return prev;
				return {
					previousValue: fallbackValue,
					tabActivationDirection: "none"
				};
			});
			notifyAutomaticValueChange(fallbackValue, fallbackReason);
			shouldNotifyInitialValueChangeRef.current = false;
		}
		if (tabMap.size === 0) {
			if (!didRegisterTabsRef.current || value === null) return;
			commitAutomaticValueChange(null, missing);
			return;
		}
		didRegisterTabsRef.current = true;
		const selectionIsDisabled = selectedTabMetadata?.disabled;
		const selectionIsMissing = selectedTabMetadata == null && value !== null;
		if (!selectionIsDisabled && value === defaultValueProp) shouldHonorDisabledDefaultValueRef.current = false;
		if (shouldHonorDisabledDefaultValueRef.current && selectionIsDisabled && value === defaultValueProp) return;
		const shouldNotifyInitialValueChange = shouldNotifyInitialValueChangeRef.current;
		if (selectionIsDisabled || selectionIsMissing) {
			const fallbackValue = firstEnabledTabValue ?? null;
			if (value === fallbackValue) {
				shouldNotifyInitialValueChangeRef.current = false;
				return;
			}
			let fallbackReason = missing;
			if (shouldNotifyInitialValueChange) fallbackReason = initial;
			else if (selectionIsDisabled) fallbackReason = disabled;
			commitAutomaticValueChange(fallbackValue, fallbackReason);
			return;
		}
		if (shouldNotifyInitialValueChange && selectedTabMetadata != null) {
			notifyAutomaticValueChange(value, initial);
			shouldNotifyInitialValueChangeRef.current = false;
		}
	}, [
		defaultValueProp,
		firstEnabledTabValue,
		isControlled,
		notifyAutomaticValueChange,
		selectedTabMetadata,
		setValue,
		tabMap,
		value
	]);
	const element = useRenderElement("div", componentProps, {
		state: {
			orientation,
			tabActivationDirection
		},
		ref: forwardedRef,
		props: elementProps,
		stateAttributesMapping: tabsStateAttributesMapping
	});
	return /*#__PURE__*/ (0, import_jsx_runtime.jsx)(TabsRootContext.Provider, {
		value: tabsContextValue,
		children: /*#__PURE__*/ (0, import_jsx_runtime.jsx)(CompositeList, {
			elementsRef: tabPanelRefs,
			children: element
		})
	});
});
function computeActivationDirection(oldValue, newValue, orientation, tabMap) {
	if (oldValue == null || newValue == null) return "none";
	let oldTab = null;
	let newTab = null;
	for (const [tabElement, tabMetadata] of tabMap.entries()) {
		if (tabMetadata == null) continue;
		const tabValue = tabMetadata.value ?? tabMetadata.index;
		if (oldValue === tabValue) oldTab = tabElement;
		if (newValue === tabValue) newTab = tabElement;
		if (oldTab != null && newTab != null) break;
	}
	if (oldTab == null || newTab == null) {
		if (oldTab !== newTab && (typeof oldValue === "number" || typeof oldValue === "string") && typeof oldValue === typeof newValue) {
			if (orientation === "horizontal") return newValue > oldValue ? "right" : "left";
			return newValue > oldValue ? "down" : "up";
		}
		return "none";
	}
	const oldRect = oldTab.getBoundingClientRect();
	const newRect = newTab.getBoundingClientRect();
	if (orientation === "horizontal") {
		if (newRect.left < oldRect.left) return "left";
		if (newRect.left > oldRect.left) return "right";
	} else {
		if (newRect.top < oldRect.top) return "up";
		if (newRect.top > oldRect.top) return "down";
	}
	return "none";
}
//#endregion
//#region node_modules/@floating-ui/utils/dist/floating-ui.utils.dom.mjs
var import_react_dom = /* @__PURE__ */ __toESM(require_react_dom());
function hasWindow() {
	return typeof window !== "undefined";
}
function getNodeName(node) {
	if (isNode(node)) return (node.nodeName || "").toLowerCase();
	return "#document";
}
function getWindow(node) {
	var _node$ownerDocument;
	return (node == null || (_node$ownerDocument = node.ownerDocument) == null ? void 0 : _node$ownerDocument.defaultView) || window;
}
function getDocumentElement(node) {
	var _ref;
	return (_ref = (isNode(node) ? node.ownerDocument : node.document) || window.document) == null ? void 0 : _ref.documentElement;
}
function isNode(value) {
	if (!hasWindow()) return false;
	return value instanceof Node || value instanceof getWindow(value).Node;
}
function isElement(value) {
	if (!hasWindow()) return false;
	return value instanceof Element || value instanceof getWindow(value).Element;
}
function isHTMLElement(value) {
	if (!hasWindow()) return false;
	return value instanceof HTMLElement || value instanceof getWindow(value).HTMLElement;
}
function isShadowRoot(value) {
	if (!hasWindow() || typeof ShadowRoot === "undefined") return false;
	return value instanceof ShadowRoot || value instanceof getWindow(value).ShadowRoot;
}
function isOverflowElement(element) {
	const { overflow, overflowX, overflowY, display } = getComputedStyle$1(element);
	return /auto|scroll|overlay|hidden|clip/.test(overflow + overflowY + overflowX) && display !== "inline" && display !== "contents";
}
function isTableElement(element) {
	return /^(table|td|th)$/.test(getNodeName(element));
}
function isTopLayer(element) {
	try {
		if (element.matches(":popover-open")) return true;
	} catch (_e) {}
	try {
		return element.matches(":modal");
	} catch (_e) {
		return false;
	}
}
var willChangeRe = /transform|translate|scale|rotate|perspective|filter/;
var containRe = /paint|layout|strict|content/;
var isNotNone = (value) => !!value && value !== "none";
var isWebKitValue;
function isContainingBlock(elementOrCss) {
	const css = isElement(elementOrCss) ? getComputedStyle$1(elementOrCss) : elementOrCss;
	return isNotNone(css.transform) || isNotNone(css.translate) || isNotNone(css.scale) || isNotNone(css.rotate) || isNotNone(css.perspective) || !isWebKit() && (isNotNone(css.backdropFilter) || isNotNone(css.filter)) || willChangeRe.test(css.willChange || "") || containRe.test(css.contain || "");
}
function getContainingBlock(element) {
	let currentNode = getParentNode(element);
	while (isHTMLElement(currentNode) && !isLastTraversableNode(currentNode)) {
		if (isContainingBlock(currentNode)) return currentNode;
		else if (isTopLayer(currentNode)) return null;
		currentNode = getParentNode(currentNode);
	}
	return null;
}
function isWebKit() {
	if (isWebKitValue == null) isWebKitValue = typeof CSS !== "undefined" && CSS.supports && CSS.supports("-webkit-backdrop-filter", "none");
	return isWebKitValue;
}
function isLastTraversableNode(node) {
	return /^(html|body|#document)$/.test(getNodeName(node));
}
function getComputedStyle$1(element) {
	return getWindow(element).getComputedStyle(element);
}
function getNodeScroll(element) {
	if (isElement(element)) return {
		scrollLeft: element.scrollLeft,
		scrollTop: element.scrollTop
	};
	return {
		scrollLeft: element.scrollX,
		scrollTop: element.scrollY
	};
}
function getParentNode(node) {
	if (getNodeName(node) === "html") return node;
	const result = node.assignedSlot || node.parentNode || isShadowRoot(node) && node.host || getDocumentElement(node);
	return isShadowRoot(result) ? result.host : result;
}
function getNearestOverflowAncestor(node) {
	const parentNode = getParentNode(node);
	if (isLastTraversableNode(parentNode)) return node.ownerDocument ? node.ownerDocument.body : node.body;
	if (isHTMLElement(parentNode) && isOverflowElement(parentNode)) return parentNode;
	return getNearestOverflowAncestor(parentNode);
}
function getOverflowAncestors(node, list, traverseIframes) {
	var _node$ownerDocument2;
	if (list === void 0) list = [];
	if (traverseIframes === void 0) traverseIframes = true;
	const scrollableAncestor = getNearestOverflowAncestor(node);
	const isBody = scrollableAncestor === ((_node$ownerDocument2 = node.ownerDocument) == null ? void 0 : _node$ownerDocument2.body);
	const win = getWindow(scrollableAncestor);
	if (isBody) {
		const frameElement = getFrameElement(win);
		return list.concat(win, win.visualViewport || [], isOverflowElement(scrollableAncestor) ? scrollableAncestor : [], frameElement && traverseIframes ? getOverflowAncestors(frameElement) : []);
	} else return list.concat(scrollableAncestor, getOverflowAncestors(scrollableAncestor, [], traverseIframes));
}
function getFrameElement(win) {
	return win.parent && Object.getPrototypeOf(win.parent) ? win.frameElement : null;
}
//#endregion
//#region node_modules/@base-ui/utils/esm/owner.js
function ownerDocument(node) {
	return node?.ownerDocument || document;
}
//#endregion
//#region node_modules/@base-ui/utils/esm/useId.js
var globalId = 0;
function useGlobalId(idOverride, prefix = "mui") {
	const [defaultId, setDefaultId] = import_react.useState(idOverride);
	const id = idOverride || defaultId;
	import_react.useEffect(() => {
		if (defaultId == null) {
			globalId += 1;
			setDefaultId(`${prefix}-${globalId}`);
		}
	}, [defaultId, prefix]);
	return id;
}
var maybeReactUseId = SafeReact.useId;
/**
*
* @example <div id={useId()} />
* @param idOverride
* @returns {string}
*/
function useId$1(idOverride, prefix) {
	if (maybeReactUseId !== void 0) {
		const reactId = maybeReactUseId();
		return idOverride ?? (prefix ? `${prefix}-${reactId}` : reactId);
	}
	return useGlobalId(idOverride, prefix);
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/useBaseUiId.js
/**
* Wraps `useId` and prefixes generated `id`s with `base-ui-`
* @param {string | undefined} idOverride overrides the generated id when provided
* @returns {string | undefined}
*/
function useBaseUiId(idOverride) {
	return useId$1(idOverride, "base-ui");
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/composite/root/CompositeRootContext.js
var CompositeRootContext = /*#__PURE__*/ import_react.createContext(void 0);
function useCompositeRootContext(optional = false) {
	const context = import_react.useContext(CompositeRootContext);
	if (context === void 0 && !optional) throw new Error(formatErrorMessage(16));
	return context;
}
//#endregion
//#region node_modules/@base-ui/react/esm/utils/useFocusableWhenDisabled.js
function useFocusableWhenDisabled(parameters) {
	const { focusableWhenDisabled, disabled, composite = false, tabIndex: tabIndexProp = 0, isNativeButton } = parameters;
	const isFocusableComposite = composite && focusableWhenDisabled !== false;
	const isNonFocusableComposite = composite && focusableWhenDisabled === false;
	return { props: import_react.useMemo(() => {
		const additionalProps = { onKeyDown(event) {
			if (disabled && focusableWhenDisabled && event.key !== "Tab") event.preventDefault();
		} };
		if (!composite) {
			additionalProps.tabIndex = tabIndexProp;
			if (!isNativeButton && disabled) additionalProps.tabIndex = focusableWhenDisabled ? tabIndexProp : -1;
		}
		if (isNativeButton && (focusableWhenDisabled || isFocusableComposite) || !isNativeButton && disabled) additionalProps["aria-disabled"] = disabled;
		if (isNativeButton && (!focusableWhenDisabled || isNonFocusableComposite)) additionalProps.disabled = disabled;
		return additionalProps;
	}, [
		composite,
		disabled,
		focusableWhenDisabled,
		isFocusableComposite,
		isNonFocusableComposite,
		isNativeButton,
		tabIndexProp
	]) };
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/use-button/useButton.js
function useButton(parameters = {}) {
	const { disabled = false, focusableWhenDisabled, tabIndex = 0, native: isNativeButton = true, composite: compositeProp } = parameters;
	const elementRef = import_react.useRef(null);
	const compositeRootContext = useCompositeRootContext(true);
	const isCompositeItem = compositeProp ?? compositeRootContext !== void 0;
	const { props: focusableWhenDisabledProps } = useFocusableWhenDisabled({
		focusableWhenDisabled,
		disabled,
		composite: isCompositeItem,
		tabIndex,
		isNativeButton
	});
	const updateDisabled = import_react.useCallback(() => {
		const element = elementRef.current;
		if (!isButtonElement(element)) return;
		if (isCompositeItem && disabled && focusableWhenDisabledProps.disabled === void 0 && element.disabled) element.disabled = false;
	}, [
		disabled,
		focusableWhenDisabledProps.disabled,
		isCompositeItem
	]);
	useIsoLayoutEffect$1(updateDisabled, [updateDisabled]);
	return {
		getButtonProps: import_react.useCallback((externalProps = {}) => {
			const { onClick: externalOnClick, onMouseDown: externalOnMouseDown, onKeyUp: externalOnKeyUp, onKeyDown: externalOnKeyDown, onPointerDown: externalOnPointerDown, ...otherExternalProps } = externalProps;
			return mergeProps({
				onClick(event) {
					if (disabled) {
						event.preventDefault();
						return;
					}
					externalOnClick?.(event);
				},
				onMouseDown(event) {
					if (!disabled) externalOnMouseDown?.(event);
				},
				onKeyDown(event) {
					if (disabled) return;
					makeEventPreventable(event);
					externalOnKeyDown?.(event);
					if (event.baseUIHandlerPrevented) return;
					const isCurrentTarget = event.target === event.currentTarget;
					const currentTarget = event.currentTarget;
					const isButton = isButtonElement(currentTarget);
					const isLink = !isNativeButton && isValidLinkElement(currentTarget);
					const shouldClick = isCurrentTarget && (isNativeButton ? isButton : !isLink);
					const isEnterKey = event.key === "Enter";
					const isSpaceKey = event.key === " ";
					const role = currentTarget.getAttribute("role");
					const isTextNavigationRole = role?.startsWith("menuitem") || role === "option" || role === "gridcell";
					if (isCurrentTarget && isCompositeItem && isSpaceKey) {
						if (event.defaultPrevented && isTextNavigationRole) return;
						event.preventDefault();
						if (isLink || isNativeButton && isButton) {
							currentTarget.click();
							event.preventBaseUIHandler();
						} else if (shouldClick) {
							externalOnClick?.(event);
							event.preventBaseUIHandler();
						}
						return;
					}
					if (shouldClick) {
						if (!isNativeButton && (isSpaceKey || isEnterKey)) event.preventDefault();
						if (!isNativeButton && isEnterKey) externalOnClick?.(event);
					}
				},
				onKeyUp(event) {
					if (disabled) return;
					makeEventPreventable(event);
					externalOnKeyUp?.(event);
					if (event.target === event.currentTarget && isNativeButton && isCompositeItem && isButtonElement(event.currentTarget) && event.key === " ") {
						event.preventDefault();
						return;
					}
					if (event.baseUIHandlerPrevented) return;
					if (event.target === event.currentTarget && !isNativeButton && !isCompositeItem && event.key === " ") externalOnClick?.(event);
				},
				onPointerDown(event) {
					if (disabled) {
						event.preventDefault();
						return;
					}
					externalOnPointerDown?.(event);
				}
			}, isNativeButton ? { type: "button" } : { role: "button" }, focusableWhenDisabledProps, otherExternalProps);
		}, [
			disabled,
			focusableWhenDisabledProps,
			isCompositeItem,
			isNativeButton
		]),
		buttonRef: useStableCallback((element) => {
			elementRef.current = element;
			updateDisabled();
		})
	};
}
function isButtonElement(elem) {
	return isHTMLElement(elem) && elem.tagName === "BUTTON";
}
function isValidLinkElement(elem) {
	return Boolean(elem?.tagName === "A" && elem?.href);
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/composite/constants.js
var ACTIVE_COMPOSITE_ITEM = "data-composite-item-active";
//#endregion
//#region node_modules/@base-ui/react/esm/internals/composite/list/useCompositeListItem.js
var IndexGuessBehavior = /*#__PURE__*/ function(IndexGuessBehavior) {
	IndexGuessBehavior[IndexGuessBehavior["None"] = 0] = "None";
	IndexGuessBehavior[IndexGuessBehavior["GuessFromOrder"] = 1] = "GuessFromOrder";
	return IndexGuessBehavior;
}({});
/**
* Used to register a list item and its index (DOM position) in the `CompositeList`.
*/
function useCompositeListItem(params = {}) {
	const { label, metadata, textRef, indexGuessBehavior, index: externalIndex } = params;
	const { register, unregister, subscribeMapChange, elementsRef, labelsRef, nextIndexRef } = useCompositeListContext();
	const indexRef = import_react.useRef(-1);
	const [index, setIndex] = import_react.useState(externalIndex ?? (indexGuessBehavior === IndexGuessBehavior.GuessFromOrder ? () => {
		if (indexRef.current === -1) {
			const newIndex = nextIndexRef.current;
			nextIndexRef.current += 1;
			indexRef.current = newIndex;
		}
		return indexRef.current;
	} : -1));
	const componentRef = import_react.useRef(null);
	const ref = import_react.useCallback((node) => {
		componentRef.current = node;
		if (index !== -1 && node !== null) {
			elementsRef.current[index] = node;
			if (labelsRef) {
				const isLabelDefined = label !== void 0;
				labelsRef.current[index] = isLabelDefined ? label : textRef?.current?.textContent ?? node.textContent;
			}
		}
	}, [
		index,
		elementsRef,
		labelsRef,
		label,
		textRef
	]);
	useIsoLayoutEffect$1(() => {
		if (externalIndex != null) return;
		const node = componentRef.current;
		if (node) {
			register(node, metadata);
			return () => {
				unregister(node);
			};
		}
	}, [
		externalIndex,
		register,
		unregister,
		metadata
	]);
	useIsoLayoutEffect$1(() => {
		if (externalIndex != null) return;
		return subscribeMapChange((map) => {
			const i = componentRef.current ? map.get(componentRef.current)?.index : null;
			if (i != null) setIndex(i);
		});
	}, [
		externalIndex,
		subscribeMapChange,
		setIndex
	]);
	return import_react.useMemo(() => ({
		ref,
		index
	}), [index, ref]);
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/composite/item/useCompositeItem.js
function useCompositeItem(params = {}) {
	const { highlightItemOnHover, highlightedIndex, onHighlightedIndexChange } = useCompositeRootContext();
	const { ref, index } = useCompositeListItem(params);
	const isHighlighted = highlightedIndex === index;
	const itemRef = import_react.useRef(null);
	const mergedRef = useMergedRefs(ref, itemRef);
	return {
		compositeProps: import_react.useMemo(() => ({
			tabIndex: isHighlighted ? 0 : -1,
			onFocus() {
				onHighlightedIndexChange(index);
			},
			onMouseMove() {
				const item = itemRef.current;
				if (!highlightItemOnHover || !item) return;
				const disabled = item.hasAttribute("disabled") || item.ariaDisabled === "true";
				if (!isHighlighted && !disabled) item.focus();
			}
		}), [
			isHighlighted,
			onHighlightedIndexChange,
			index,
			highlightItemOnHover
		]),
		compositeRef: mergedRef,
		index
	};
}
//#endregion
//#region node_modules/@base-ui/react/esm/tabs/list/TabsListContext.js
var TabsListContext$1 = /*#__PURE__*/ import_react.createContext(void 0);
function useTabsListContext() {
	const context = import_react.useContext(TabsListContext$1);
	if (context === void 0) throw new Error(formatErrorMessage(65));
	return context;
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/shadowDom.js
function activeElement(doc) {
	let element = doc.activeElement;
	while (element?.shadowRoot?.activeElement != null) element = element.shadowRoot.activeElement;
	return element;
}
function contains(parent, child) {
	if (!parent || !child) return false;
	const rootNode = child.getRootNode?.();
	if (parent.contains(child)) return true;
	if (rootNode && isShadowRoot(rootNode)) {
		let next = child;
		while (next) {
			if (parent === next) return true;
			next = next.parentNode || next.host;
		}
	}
	return false;
}
function getTarget(event) {
	if ("composedPath" in event) return event.composedPath()[0];
	return event.target;
}
//#endregion
//#region node_modules/@base-ui/react/esm/floating-ui-react/utils/event.js
function stopEvent(event) {
	event.preventDefault();
	event.stopPropagation();
}
//#endregion
//#region node_modules/@floating-ui/utils/dist/floating-ui.utils.mjs
/**
* Custom positioning reference element.
* @see https://floating-ui.com/docs/virtual-elements
*/
var sides = [
	"top",
	"right",
	"bottom",
	"left"
];
var min = Math.min;
var max = Math.max;
var round = Math.round;
var floor = Math.floor;
var createCoords = (v) => ({
	x: v,
	y: v
});
var oppositeSideMap = {
	left: "right",
	right: "left",
	bottom: "top",
	top: "bottom"
};
function clamp(start, value, end) {
	return max(start, min(value, end));
}
function evaluate(value, param) {
	return typeof value === "function" ? value(param) : value;
}
function getSide(placement) {
	return placement.split("-")[0];
}
function getAlignment(placement) {
	return placement.split("-")[1];
}
function getOppositeAxis(axis) {
	return axis === "x" ? "y" : "x";
}
function getAxisLength(axis) {
	return axis === "y" ? "height" : "width";
}
function getSideAxis(placement) {
	const firstChar = placement[0];
	return firstChar === "t" || firstChar === "b" ? "y" : "x";
}
function getAlignmentAxis(placement) {
	return getOppositeAxis(getSideAxis(placement));
}
function getAlignmentSides(placement, rects, rtl) {
	if (rtl === void 0) rtl = false;
	const alignment = getAlignment(placement);
	const alignmentAxis = getAlignmentAxis(placement);
	const length = getAxisLength(alignmentAxis);
	let mainAlignmentSide = alignmentAxis === "x" ? alignment === (rtl ? "end" : "start") ? "right" : "left" : alignment === "start" ? "bottom" : "top";
	if (rects.reference[length] > rects.floating[length]) mainAlignmentSide = getOppositePlacement(mainAlignmentSide);
	return [mainAlignmentSide, getOppositePlacement(mainAlignmentSide)];
}
function getExpandedPlacements(placement) {
	const oppositePlacement = getOppositePlacement(placement);
	return [
		getOppositeAlignmentPlacement(placement),
		oppositePlacement,
		getOppositeAlignmentPlacement(oppositePlacement)
	];
}
function getOppositeAlignmentPlacement(placement) {
	return placement.includes("start") ? placement.replace("start", "end") : placement.replace("end", "start");
}
var lrPlacement = ["left", "right"];
var rlPlacement = ["right", "left"];
var tbPlacement = ["top", "bottom"];
var btPlacement = ["bottom", "top"];
function getSideList(side, isStart, rtl) {
	switch (side) {
		case "top":
		case "bottom":
			if (rtl) return isStart ? rlPlacement : lrPlacement;
			return isStart ? lrPlacement : rlPlacement;
		case "left":
		case "right": return isStart ? tbPlacement : btPlacement;
		default: return [];
	}
}
function getOppositeAxisPlacements(placement, flipAlignment, direction, rtl) {
	const alignment = getAlignment(placement);
	let list = getSideList(getSide(placement), direction === "start", rtl);
	if (alignment) {
		list = list.map((side) => side + "-" + alignment);
		if (flipAlignment) list = list.concat(list.map(getOppositeAlignmentPlacement));
	}
	return list;
}
function getOppositePlacement(placement) {
	const side = getSide(placement);
	return oppositeSideMap[side] + placement.slice(side.length);
}
function expandPaddingObject(padding) {
	return {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		...padding
	};
}
function getPaddingObject(padding) {
	return typeof padding !== "number" ? expandPaddingObject(padding) : {
		top: padding,
		right: padding,
		bottom: padding,
		left: padding
	};
}
function rectToClientRect(rect) {
	const { x, y, width, height } = rect;
	return {
		width,
		height,
		top: y,
		left: x,
		right: x + width,
		bottom: y + height,
		x,
		y
	};
}
//#endregion
//#region node_modules/@base-ui/react/esm/floating-ui-react/utils/composite.js
function isDifferentGridRow(index, cols, prevRow) {
	return Math.floor(index / cols) !== prevRow;
}
function isIndexOutOfListBounds(list, index) {
	return index < 0 || index >= list.length;
}
function getMinListIndex(listRef, disabledIndices) {
	return findNonDisabledListIndex(listRef.current, { disabledIndices });
}
function getMaxListIndex(listRef, disabledIndices) {
	return findNonDisabledListIndex(listRef.current, {
		decrement: true,
		startingIndex: listRef.current.length,
		disabledIndices
	});
}
function findNonDisabledListIndex(list, { startingIndex = -1, decrement = false, disabledIndices, amount = 1 } = {}) {
	let index = startingIndex;
	do
		index += decrement ? -amount : amount;
	while (index >= 0 && index <= list.length - 1 && isListIndexDisabled(list, index, disabledIndices));
	return index;
}
function getGridNavigatedIndex(list, { event, orientation, loopFocus, onLoop, rtl, cols, disabledIndices, minIndex, maxIndex, prevIndex, stopEvent: stop = false }) {
	let nextIndex = prevIndex;
	let verticalDirection;
	if (event.key === "ArrowUp") verticalDirection = "up";
	else if (event.key === "ArrowDown") verticalDirection = "down";
	if (verticalDirection) {
		const rows = [];
		const rowIndexMap = [];
		let hasRoleRow = false;
		let visibleItemCount = 0;
		{
			let currentRowEl = null;
			let currentRowIndex = -1;
			list.forEach((el, idx) => {
				if (el == null) return;
				visibleItemCount += 1;
				const rowEl = el.closest("[role=\"row\"]");
				if (rowEl) hasRoleRow = true;
				if (rowEl !== currentRowEl || currentRowIndex === -1) {
					currentRowEl = rowEl;
					currentRowIndex += 1;
					rows[currentRowIndex] = [];
				}
				rows[currentRowIndex].push(idx);
				rowIndexMap[idx] = currentRowIndex;
			});
		}
		let hasDomRows = false;
		let inferredDomCols = 0;
		if (hasRoleRow) for (const row of rows) {
			const rowLength = row.length;
			if (rowLength > inferredDomCols) inferredDomCols = rowLength;
			if (rowLength !== cols) hasDomRows = true;
		}
		const hasVirtualizedGaps = hasDomRows && visibleItemCount < list.length;
		const verticalCols = inferredDomCols || cols;
		const navigateVertically = (direction) => {
			if (!hasDomRows || prevIndex === -1) return;
			const currentRow = rowIndexMap[prevIndex];
			if (currentRow == null) return;
			const colInRow = rows[currentRow].indexOf(prevIndex);
			const step = direction === "up" ? -1 : 1;
			for (let nextRow = currentRow + step, i = 0; i < rows.length; i += 1, nextRow += step) {
				if (nextRow < 0 || nextRow >= rows.length) {
					if (!loopFocus || hasVirtualizedGaps) return;
					nextRow = nextRow < 0 ? rows.length - 1 : 0;
					if (onLoop) {
						const clampedCol = Math.min(colInRow, rows[nextRow].length - 1);
						nextRow = rowIndexMap[onLoop(event, prevIndex, rows[nextRow][clampedCol] ?? rows[nextRow][0])] ?? nextRow;
					}
				}
				const targetRow = rows[nextRow];
				for (let col = Math.min(colInRow, targetRow.length - 1); col >= 0; col -= 1) {
					const candidate = targetRow[col];
					if (!isListIndexDisabled(list, candidate, disabledIndices)) return candidate;
				}
			}
		};
		const navigateVerticallyWithInferredRows = (direction) => {
			if (!hasVirtualizedGaps || prevIndex === -1) return;
			const colInRow = prevIndex % verticalCols;
			const rowStep = direction === "up" ? -verticalCols : verticalCols;
			const lastRowStart = maxIndex - maxIndex % verticalCols;
			const rowCount = floor(maxIndex / verticalCols) + 1;
			for (let rowStart = prevIndex - colInRow + rowStep, i = 0; i < rowCount; i += 1, rowStart += rowStep) {
				if (rowStart < 0 || rowStart > maxIndex) {
					if (!loopFocus) return;
					rowStart = rowStart < 0 ? lastRowStart : 0;
				}
				const rowEnd = Math.min(rowStart + verticalCols - 1, maxIndex);
				for (let candidate = Math.min(rowStart + colInRow, rowEnd); candidate >= rowStart; candidate -= 1) if (!isListIndexDisabled(list, candidate, disabledIndices)) return candidate;
			}
		};
		if (stop) stopEvent(event);
		const verticalCandidate = navigateVertically(verticalDirection) ?? navigateVerticallyWithInferredRows(verticalDirection);
		if (verticalCandidate !== void 0) nextIndex = verticalCandidate;
		else if (prevIndex === -1) nextIndex = verticalDirection === "up" ? maxIndex : minIndex;
		else {
			nextIndex = findNonDisabledListIndex(list, {
				startingIndex: prevIndex,
				amount: verticalCols,
				decrement: verticalDirection === "up",
				disabledIndices
			});
			if (loopFocus) {
				if (verticalDirection === "up" && (prevIndex - verticalCols < minIndex || nextIndex < 0)) {
					const col = prevIndex % verticalCols;
					const maxCol = maxIndex % verticalCols;
					const offset = maxIndex - (maxCol - col);
					if (maxCol === col) nextIndex = maxIndex;
					else nextIndex = maxCol > col ? offset : offset - verticalCols;
					if (onLoop) nextIndex = onLoop(event, prevIndex, nextIndex);
				}
				if (verticalDirection === "down" && prevIndex + verticalCols > maxIndex) {
					nextIndex = findNonDisabledListIndex(list, {
						startingIndex: prevIndex % verticalCols - verticalCols,
						amount: verticalCols,
						disabledIndices
					});
					if (onLoop) nextIndex = onLoop(event, prevIndex, nextIndex);
				}
			}
		}
		if (isIndexOutOfListBounds(list, nextIndex)) nextIndex = prevIndex;
	}
	if (orientation === "both") {
		const prevRow = floor(prevIndex / cols);
		if (event.key === (rtl ? "ArrowLeft" : "ArrowRight")) {
			if (stop) stopEvent(event);
			if (prevIndex % cols !== cols - 1) {
				nextIndex = findNonDisabledListIndex(list, {
					startingIndex: prevIndex,
					disabledIndices
				});
				if (loopFocus && isDifferentGridRow(nextIndex, cols, prevRow)) {
					nextIndex = findNonDisabledListIndex(list, {
						startingIndex: prevIndex - prevIndex % cols - 1,
						disabledIndices
					});
					if (onLoop) nextIndex = onLoop(event, prevIndex, nextIndex);
				}
			} else if (loopFocus) {
				nextIndex = findNonDisabledListIndex(list, {
					startingIndex: prevIndex - prevIndex % cols - 1,
					disabledIndices
				});
				if (onLoop) nextIndex = onLoop(event, prevIndex, nextIndex);
			}
			if (isDifferentGridRow(nextIndex, cols, prevRow)) nextIndex = prevIndex;
		}
		if (event.key === (rtl ? "ArrowRight" : "ArrowLeft")) {
			if (stop) stopEvent(event);
			if (prevIndex % cols !== 0) {
				nextIndex = findNonDisabledListIndex(list, {
					startingIndex: prevIndex,
					decrement: true,
					disabledIndices
				});
				if (loopFocus && isDifferentGridRow(nextIndex, cols, prevRow)) {
					nextIndex = findNonDisabledListIndex(list, {
						startingIndex: prevIndex + (cols - prevIndex % cols),
						decrement: true,
						disabledIndices
					});
					if (onLoop) nextIndex = onLoop(event, prevIndex, nextIndex);
				}
			} else if (loopFocus) {
				nextIndex = findNonDisabledListIndex(list, {
					startingIndex: prevIndex + (cols - prevIndex % cols),
					decrement: true,
					disabledIndices
				});
				if (onLoop) nextIndex = onLoop(event, prevIndex, nextIndex);
			}
			if (isDifferentGridRow(nextIndex, cols, prevRow)) nextIndex = prevIndex;
		}
		const lastRow = floor(maxIndex / cols) === prevRow;
		if (isIndexOutOfListBounds(list, nextIndex)) if (loopFocus && lastRow) {
			nextIndex = event.key === (rtl ? "ArrowRight" : "ArrowLeft") ? maxIndex : findNonDisabledListIndex(list, {
				startingIndex: prevIndex - prevIndex % cols - 1,
				disabledIndices
			});
			if (onLoop) nextIndex = onLoop(event, prevIndex, nextIndex);
		} else nextIndex = prevIndex;
	}
	return nextIndex;
}
/** For each cell index, gets the item index that occupies that cell */
function createGridCellMap(sizes, cols, dense) {
	const cellMap = [];
	let startIndex = 0;
	sizes.forEach(({ width, height }, index) => {
		if (width > cols) {}
		let itemPlaced = false;
		if (dense) startIndex = 0;
		while (!itemPlaced) {
			const targetCells = [];
			for (let i = 0; i < width; i += 1) for (let j = 0; j < height; j += 1) targetCells.push(startIndex + i + j * cols);
			if (startIndex % cols + width <= cols && targetCells.every((cell) => cellMap[cell] == null)) {
				targetCells.forEach((cell) => {
					cellMap[cell] = index;
				});
				itemPlaced = true;
			} else startIndex += 1;
		}
	});
	return [...cellMap];
}
/** Gets cell index of an item's corner or -1 when index is -1. */
function getGridCellIndexOfCorner(index, sizes, cellMap, cols, corner) {
	if (index === -1) return -1;
	const firstCellIndex = cellMap.indexOf(index);
	const sizeItem = sizes[index];
	switch (corner) {
		case "tl": return firstCellIndex;
		case "tr":
			if (!sizeItem) return firstCellIndex;
			return firstCellIndex + sizeItem.width - 1;
		case "bl":
			if (!sizeItem) return firstCellIndex;
			return firstCellIndex + (sizeItem.height - 1) * cols;
		case "br": return cellMap.lastIndexOf(index);
		default: return -1;
	}
}
/** Gets all cell indices that correspond to the specified indices */
function getGridCellIndices(indices, cellMap) {
	return cellMap.flatMap((index, cellIndex) => indices.includes(index) ? [cellIndex] : []);
}
function isListIndexDisabled(list, index, disabledIndices) {
	if (typeof disabledIndices === "function" ? disabledIndices(index) : disabledIndices?.includes(index) ?? false) return true;
	const element = list[index];
	if (!element) return false;
	if (!isElementVisible(element)) return true;
	return !disabledIndices && (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true");
}
function isHiddenByStyles(styles) {
	return styles.visibility === "hidden" || styles.visibility === "collapse";
}
function isElementVisible(element, styles = element ? getComputedStyle$1(element) : null) {
	if (!element || !element.isConnected || !styles || isHiddenByStyles(styles)) return false;
	if (typeof element.checkVisibility === "function") return element.checkVisibility();
	return styles.display !== "none" && styles.display !== "contents";
}
//#endregion
//#region node_modules/@base-ui/react/esm/tabs/tab/TabsTab.js
/**
* An individual interactive tab button that toggles the corresponding panel.
* Renders a `<button>` element.
*
* Documentation: [Base UI Tabs](https://base-ui.com/react/components/tabs)
*/
var TabsTab = /*#__PURE__*/ import_react.forwardRef(function TabsTab(componentProps, forwardedRef) {
	const { className, disabled = false, render, value, id: idProp, nativeButton = true, style, ...elementProps } = componentProps;
	const { value: activeTabValue, getTabPanelIdByValue, orientation } = useTabsRootContext();
	const { activateOnFocus, highlightedTabIndex, onTabActivation, registerTabResizeObserverElement, setHighlightedTabIndex, tabsListElement } = useTabsListContext();
	const id = useBaseUiId(idProp);
	const { compositeProps, compositeRef, index } = useCompositeItem({ metadata: import_react.useMemo(() => ({
		disabled,
		id,
		value
	}), [
		disabled,
		id,
		value
	]) });
	const active = value === activeTabValue;
	const isNavigatingRef = import_react.useRef(false);
	const tabElementRef = import_react.useRef(null);
	import_react.useEffect(() => {
		const tabElement = tabElementRef.current;
		if (!tabElement) return;
		return registerTabResizeObserverElement(tabElement);
	}, [registerTabResizeObserverElement]);
	useIsoLayoutEffect$1(() => {
		if (isNavigatingRef.current) {
			isNavigatingRef.current = false;
			return;
		}
		if (!(active && index > -1 && highlightedTabIndex !== index)) return;
		const listElement = tabsListElement;
		if (listElement != null) {
			const activeEl = activeElement(ownerDocument(listElement));
			if (activeEl && contains(listElement, activeEl)) return;
		}
		if (!disabled) setHighlightedTabIndex(index);
	}, [
		active,
		index,
		highlightedTabIndex,
		setHighlightedTabIndex,
		disabled,
		tabsListElement
	]);
	const { getButtonProps, buttonRef } = useButton({
		disabled,
		native: nativeButton,
		focusableWhenDisabled: true
	});
	const tabPanelId = getTabPanelIdByValue(value);
	const isPressingRef = import_react.useRef(false);
	const isMainButtonRef = import_react.useRef(false);
	function onClick(event) {
		if (active || disabled) return;
		onTabActivation(value, createChangeEventDetails(none, event.nativeEvent, void 0, { activationDirection: "none" }));
	}
	function onFocus(event) {
		if (active) return;
		if (index > -1 && !disabled) setHighlightedTabIndex(index);
		if (disabled) return;
		if (activateOnFocus && (!isPressingRef.current || isPressingRef.current && isMainButtonRef.current)) onTabActivation(value, createChangeEventDetails(none, event.nativeEvent, void 0, { activationDirection: "none" }));
	}
	function onPointerDown(event) {
		if (active || disabled) return;
		isPressingRef.current = true;
		function handlePointerUp() {
			isPressingRef.current = false;
			isMainButtonRef.current = false;
		}
		if (!event.button || event.button === 0) {
			isMainButtonRef.current = true;
			ownerDocument(event.currentTarget).addEventListener("pointerup", handlePointerUp, { once: true });
		}
	}
	return useRenderElement("button", componentProps, {
		state: {
			disabled,
			active,
			orientation
		},
		ref: [
			forwardedRef,
			buttonRef,
			compositeRef,
			tabElementRef
		],
		props: [
			compositeProps,
			{
				role: "tab",
				"aria-controls": tabPanelId,
				"aria-selected": active,
				id,
				onClick,
				onFocus,
				onPointerDown,
				[ACTIVE_COMPOSITE_ITEM]: active ? "" : void 0,
				onKeyDownCapture() {
					isNavigatingRef.current = true;
				}
			},
			elementProps,
			getButtonProps
		]
	});
});
//#endregion
//#region node_modules/@base-ui/utils/esm/inertValue.js
function inertValue(value) {
	if (isReactVersionAtLeast(19)) return value;
	return value ? "true" : void 0;
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/stateAttributesMapping.js
var TransitionStatusDataAttributes = /*#__PURE__*/ function(TransitionStatusDataAttributes) {
	/**
	* Present when the component is animating in.
	*/
	TransitionStatusDataAttributes["startingStyle"] = "data-starting-style";
	/**
	* Present when the component is animating out.
	*/
	TransitionStatusDataAttributes["endingStyle"] = "data-ending-style";
	return TransitionStatusDataAttributes;
}({});
var STARTING_HOOK = { [TransitionStatusDataAttributes.startingStyle]: "" };
var ENDING_HOOK = { [TransitionStatusDataAttributes.endingStyle]: "" };
var transitionStatusMapping = { transitionStatus(value) {
	if (value === "starting") return STARTING_HOOK;
	if (value === "ending") return ENDING_HOOK;
	return null;
} };
//#endregion
//#region node_modules/@base-ui/utils/esm/useOnMount.js
var EMPTY$1 = [];
/**
* A React.useEffect equivalent that runs once, when the component is mounted.
*/
function useOnMount(fn) {
	import_react.useEffect(fn, EMPTY$1);
}
//#endregion
//#region node_modules/@base-ui/utils/esm/useAnimationFrame.js
/** Unlike `setTimeout`, rAF doesn't guarantee a positive integer return value, so we can't have
* a monomorphic `uint` type with `0` meaning empty.
* See warning note at:
* https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame#return_value */
var EMPTY = null;
globalThis.requestAnimationFrame;
var Scheduler = class {
	callbacks = [];
	callbacksCount = 0;
	nextId = 1;
	startId = 1;
	isScheduled = false;
	tick = (timestamp) => {
		this.isScheduled = false;
		const currentCallbacks = this.callbacks;
		const currentCallbacksCount = this.callbacksCount;
		this.callbacks = [];
		this.callbacksCount = 0;
		this.startId = this.nextId;
		if (currentCallbacksCount > 0) for (let i = 0; i < currentCallbacks.length; i += 1) currentCallbacks[i]?.(timestamp);
	};
	request(fn) {
		const id = this.nextId;
		this.nextId += 1;
		this.callbacks.push(fn);
		this.callbacksCount += 1;
		if (!this.isScheduled || false) {
			requestAnimationFrame(this.tick);
			this.isScheduled = true;
		}
		return id;
	}
	cancel(id) {
		const index = id - this.startId;
		if (index < 0 || index >= this.callbacks.length) return;
		this.callbacks[index] = null;
		this.callbacksCount -= 1;
	}
};
var scheduler = new Scheduler();
var AnimationFrame = class AnimationFrame {
	static create() {
		return new AnimationFrame();
	}
	static request(fn) {
		return scheduler.request(fn);
	}
	static cancel(id) {
		return scheduler.cancel(id);
	}
	currentId = EMPTY;
	/**
	* Executes `fn` after `delay`, clearing any previously scheduled call.
	*/
	request(fn) {
		this.cancel();
		this.currentId = scheduler.request(() => {
			this.currentId = EMPTY;
			fn();
		});
	}
	cancel = () => {
		if (this.currentId !== EMPTY) {
			scheduler.cancel(this.currentId);
			this.currentId = EMPTY;
		}
	};
	disposeEffect = () => {
		return this.cancel;
	};
};
/**
* A `requestAnimationFrame` with automatic cleanup and guard.
*/
function useAnimationFrame() {
	const timeout = useRefWithInit(AnimationFrame.create).current;
	useOnMount(timeout.disposeEffect);
	return timeout;
}
//#endregion
//#region node_modules/@base-ui/react/esm/utils/resolveRef.js
/**
* If the provided argument is a ref object, returns its `current` value.
* Otherwise, returns the argument itself.
*/
function resolveRef(maybeRef) {
	if (maybeRef == null) return maybeRef;
	return "current" in maybeRef ? maybeRef.current : maybeRef;
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/useAnimationsFinished.js
/**
* Executes a function once all animations have finished on the provided element.
* @param elementOrRef - The element to watch for animations.
* @param waitForStartingStyleRemoved - Whether to wait for [data-starting-style] to be removed before checking for animations.
* @param treatAbortedAsFinished - Whether to treat aborted animations as finished. If `false`, and there are aborted animations,
*   the function will check again if any new animations have started and wait for them to finish.
* @returns A function that takes a callback to execute once all animations have finished, and an optional AbortSignal to abort the callback
*/
function useAnimationsFinished(elementOrRef, waitForStartingStyleRemoved = false, treatAbortedAsFinished = true) {
	const frame = useAnimationFrame();
	return useStableCallback((fnToExecute, signal = null) => {
		frame.cancel();
		const element = resolveRef(elementOrRef);
		if (element == null) return;
		const resolvedElement = element;
		const done = () => {
			import_react_dom.flushSync(fnToExecute);
		};
		if (typeof resolvedElement.getAnimations !== "function" || globalThis.BASE_UI_ANIMATIONS_DISABLED) {
			fnToExecute();
			return;
		}
		function exec() {
			Promise.all(resolvedElement.getAnimations().map((animation) => animation.finished)).then(() => {
				if (!signal?.aborted) done();
			}).catch(() => {
				if (treatAbortedAsFinished) {
					if (!signal?.aborted) done();
					return;
				}
				const currentAnimations = resolvedElement.getAnimations();
				if (!signal?.aborted && currentAnimations.length > 0 && currentAnimations.some((animation) => animation.pending || animation.playState !== "finished")) exec();
			});
		}
		if (waitForStartingStyleRemoved) {
			const startingStyleAttribute = TransitionStatusDataAttributes.startingStyle;
			if (!resolvedElement.hasAttribute(startingStyleAttribute)) {
				frame.request(exec);
				return;
			}
			const attributeObserver = new MutationObserver(() => {
				if (!resolvedElement.hasAttribute(startingStyleAttribute)) {
					attributeObserver.disconnect();
					exec();
				}
			});
			attributeObserver.observe(resolvedElement, {
				attributes: true,
				attributeFilter: [startingStyleAttribute]
			});
			signal?.addEventListener("abort", () => attributeObserver.disconnect(), { once: true });
			return;
		}
		frame.request(exec);
	});
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/useOpenChangeComplete.js
/**
* Calls the provided function when the CSS open/close animation or transition completes.
*/
function useOpenChangeComplete(parameters) {
	const { enabled = true, open, ref, onComplete: onCompleteParam } = parameters;
	const onComplete = useStableCallback(onCompleteParam);
	const runOnceAnimationsFinish = useAnimationsFinished(ref, open, false);
	import_react.useEffect(() => {
		if (!enabled) return;
		const abortController = new AbortController();
		runOnceAnimationsFinish(onComplete, abortController.signal);
		return () => {
			abortController.abort();
		};
	}, [
		enabled,
		open,
		onComplete,
		runOnceAnimationsFinish
	]);
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/useTransitionStatus.js
/**
* Provides a status string for CSS animations.
* @param open - a boolean that determines if the element is open.
* @param enableIdleState - a boolean that enables the `'idle'` state between `'starting'` and `'ending'`
*/
function useTransitionStatus(open, enableIdleState = false, deferEndingState = false) {
	const [transitionStatus, setTransitionStatus] = import_react.useState(open && enableIdleState ? "idle" : void 0);
	const [mounted, setMounted] = import_react.useState(open);
	if (open && !mounted) {
		setMounted(true);
		setTransitionStatus("starting");
	}
	if (!open && mounted && transitionStatus !== "ending" && !deferEndingState) setTransitionStatus("ending");
	if (!open && !mounted && transitionStatus === "ending") setTransitionStatus(void 0);
	useIsoLayoutEffect$1(() => {
		if (!open && mounted && transitionStatus !== "ending" && deferEndingState) {
			const frame = AnimationFrame.request(() => {
				setTransitionStatus("ending");
			});
			return () => {
				AnimationFrame.cancel(frame);
			};
		}
	}, [
		open,
		mounted,
		transitionStatus,
		deferEndingState
	]);
	useIsoLayoutEffect$1(() => {
		if (!open || enableIdleState) return;
		const frame = AnimationFrame.request(() => {
			setTransitionStatus(void 0);
		});
		return () => {
			AnimationFrame.cancel(frame);
		};
	}, [enableIdleState, open]);
	useIsoLayoutEffect$1(() => {
		if (!open || !enableIdleState) return;
		if (open && mounted && transitionStatus !== "idle") setTransitionStatus("starting");
		const frame = AnimationFrame.request(() => {
			setTransitionStatus("idle");
		});
		return () => {
			AnimationFrame.cancel(frame);
		};
	}, [
		enableIdleState,
		open,
		mounted,
		transitionStatus
	]);
	return {
		mounted,
		setMounted,
		transitionStatus
	};
}
//#endregion
//#region node_modules/@base-ui/react/esm/tabs/panel/TabsPanelDataAttributes.js
var TabsPanelDataAttributes = function(TabsPanelDataAttributes) {
	/**
	* Indicates the index of the tab panel.
	*/
	TabsPanelDataAttributes["index"] = "data-index";
	/**
	* Indicates the direction of the activation (based on the previous active tab).
	* @type {'left' | 'right' | 'up' | 'down' | 'none'}
	*/
	TabsPanelDataAttributes["activationDirection"] = "data-activation-direction";
	/**
	* Indicates the orientation of the tabs.
	* @type {'horizontal' | 'vertical'}
	*/
	TabsPanelDataAttributes["orientation"] = "data-orientation";
	/**
	* Present when the panel is hidden.
	*/
	TabsPanelDataAttributes["hidden"] = "data-hidden";
	/**
	* Present when the panel is animating in.
	*/
	TabsPanelDataAttributes[TabsPanelDataAttributes["startingStyle"] = TransitionStatusDataAttributes.startingStyle] = "startingStyle";
	/**
	* Present when the panel is animating out.
	*/
	TabsPanelDataAttributes[TabsPanelDataAttributes["endingStyle"] = TransitionStatusDataAttributes.endingStyle] = "endingStyle";
	return TabsPanelDataAttributes;
}({});
//#endregion
//#region node_modules/@base-ui/react/esm/tabs/panel/TabsPanel.js
var stateAttributesMapping = {
	...tabsStateAttributesMapping,
	...transitionStatusMapping
};
/**
* A panel displayed when the corresponding tab is active.
* Renders a `<div>` element.
*
* Documentation: [Base UI Tabs](https://base-ui.com/react/components/tabs)
*/
var TabsPanel = /*#__PURE__*/ import_react.forwardRef(function TabsPanel(componentProps, forwardedRef) {
	const { className, value, render, keepMounted = false, style, ...elementProps } = componentProps;
	const { value: selectedValue, getTabIdByPanelValue, orientation, tabActivationDirection, registerMountedTabPanel, unregisterMountedTabPanel } = useTabsRootContext();
	const id = useBaseUiId();
	const { ref: listItemRef, index } = useCompositeListItem({ metadata: import_react.useMemo(() => ({
		id,
		value
	}), [id, value]) });
	const open = value === selectedValue;
	const { mounted, transitionStatus, setMounted } = useTransitionStatus(open);
	const hidden = !mounted;
	const correspondingTabId = getTabIdByPanelValue(value);
	const state = {
		hidden,
		orientation,
		tabActivationDirection,
		transitionStatus
	};
	const panelRef = import_react.useRef(null);
	const element = useRenderElement("div", componentProps, {
		state,
		ref: [
			forwardedRef,
			listItemRef,
			panelRef
		],
		props: [{
			"aria-labelledby": correspondingTabId,
			hidden,
			id,
			role: "tabpanel",
			tabIndex: open ? 0 : -1,
			inert: inertValue(!open),
			[TabsPanelDataAttributes.index]: index
		}, elementProps],
		stateAttributesMapping
	});
	useOpenChangeComplete({
		open,
		ref: panelRef,
		onComplete() {
			if (!open) setMounted(false);
		}
	});
	useIsoLayoutEffect$1(() => {
		if (hidden && !keepMounted) return;
		if (id == null) return;
		registerMountedTabPanel(value, id);
		return () => {
			unregisterMountedTabPanel(value, id);
		};
	}, [
		hidden,
		keepMounted,
		value,
		id,
		registerMountedTabPanel,
		unregisterMountedTabPanel
	]);
	if (!(keepMounted || mounted)) return null;
	return element;
});
//#endregion
//#region node_modules/@base-ui/utils/esm/isElementDisabled.js
function isElementDisabled(element) {
	return element == null || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/composite/composite.js
var ARROW_UP = "ArrowUp";
var ARROW_DOWN = "ArrowDown";
var ARROW_LEFT = "ArrowLeft";
var ARROW_RIGHT = "ArrowRight";
var HOME = "Home";
var HORIZONTAL_KEYS = new Set([ARROW_LEFT, ARROW_RIGHT]);
var HORIZONTAL_KEYS_WITH_EXTRA_KEYS = new Set([
	ARROW_LEFT,
	ARROW_RIGHT,
	HOME,
	"End"
]);
var VERTICAL_KEYS = new Set([ARROW_UP, ARROW_DOWN]);
var VERTICAL_KEYS_WITH_EXTRA_KEYS = new Set([
	ARROW_UP,
	ARROW_DOWN,
	HOME,
	"End"
]);
var ARROW_KEYS = new Set([...HORIZONTAL_KEYS, ...VERTICAL_KEYS]);
var COMPOSITE_KEYS = new Set([
	...ARROW_KEYS,
	HOME,
	"End"
]);
var MODIFIER_KEYS = new Set([
	"Shift",
	"Control",
	"Alt",
	"Meta"
]);
function isInputElement(element) {
	return isHTMLElement(element) && element.tagName === "INPUT";
}
function isNativeInput(element) {
	if (isInputElement(element) && element.selectionStart != null) return true;
	if (isHTMLElement(element) && element.tagName === "TEXTAREA") return true;
	return false;
}
function scrollIntoViewIfNeeded(scrollContainer, element, direction, orientation) {
	if (!scrollContainer || !element || !element.scrollTo) return;
	let targetX = scrollContainer.scrollLeft;
	let targetY = scrollContainer.scrollTop;
	const isOverflowingX = scrollContainer.clientWidth < scrollContainer.scrollWidth;
	const isOverflowingY = scrollContainer.clientHeight < scrollContainer.scrollHeight;
	if (isOverflowingX && orientation !== "vertical") {
		const elementOffsetLeft = getOffset(scrollContainer, element, "left");
		const containerStyles = getStyles(scrollContainer);
		const elementStyles = getStyles(element);
		if (direction === "ltr") {
			if (elementOffsetLeft + element.offsetWidth + elementStyles.scrollMarginRight > scrollContainer.scrollLeft + scrollContainer.clientWidth - containerStyles.scrollPaddingRight) targetX = elementOffsetLeft + element.offsetWidth + elementStyles.scrollMarginRight - scrollContainer.clientWidth + containerStyles.scrollPaddingRight;
			else if (elementOffsetLeft - elementStyles.scrollMarginLeft < scrollContainer.scrollLeft + containerStyles.scrollPaddingLeft) targetX = elementOffsetLeft - elementStyles.scrollMarginLeft - containerStyles.scrollPaddingLeft;
		}
		if (direction === "rtl") {
			if (elementOffsetLeft - elementStyles.scrollMarginRight < scrollContainer.scrollLeft + containerStyles.scrollPaddingLeft) targetX = elementOffsetLeft - elementStyles.scrollMarginLeft - containerStyles.scrollPaddingLeft;
			else if (elementOffsetLeft + element.offsetWidth + elementStyles.scrollMarginRight > scrollContainer.scrollLeft + scrollContainer.clientWidth - containerStyles.scrollPaddingRight) targetX = elementOffsetLeft + element.offsetWidth + elementStyles.scrollMarginRight - scrollContainer.clientWidth + containerStyles.scrollPaddingRight;
		}
	}
	if (isOverflowingY && orientation !== "horizontal") {
		const elementOffsetTop = getOffset(scrollContainer, element, "top");
		const containerStyles = getStyles(scrollContainer);
		const elementStyles = getStyles(element);
		if (elementOffsetTop - elementStyles.scrollMarginTop < scrollContainer.scrollTop + containerStyles.scrollPaddingTop) targetY = elementOffsetTop - elementStyles.scrollMarginTop - containerStyles.scrollPaddingTop;
		else if (elementOffsetTop + element.offsetHeight + elementStyles.scrollMarginBottom > scrollContainer.scrollTop + scrollContainer.clientHeight - containerStyles.scrollPaddingBottom) targetY = elementOffsetTop + element.offsetHeight + elementStyles.scrollMarginBottom - scrollContainer.clientHeight + containerStyles.scrollPaddingBottom;
	}
	scrollContainer.scrollTo({
		left: targetX,
		top: targetY,
		behavior: "auto"
	});
}
function getOffset(ancestor, element, side) {
	const propName = side === "left" ? "offsetLeft" : "offsetTop";
	let result = 0;
	while (element.offsetParent) {
		result += element[propName];
		if (element.offsetParent === ancestor) break;
		element = element.offsetParent;
	}
	return result;
}
function getStyles(element) {
	const styles = getComputedStyle(element);
	return {
		scrollMarginTop: parseFloat(styles.scrollMarginTop) || 0,
		scrollMarginRight: parseFloat(styles.scrollMarginRight) || 0,
		scrollMarginBottom: parseFloat(styles.scrollMarginBottom) || 0,
		scrollMarginLeft: parseFloat(styles.scrollMarginLeft) || 0,
		scrollPaddingTop: parseFloat(styles.scrollPaddingTop) || 0,
		scrollPaddingRight: parseFloat(styles.scrollPaddingRight) || 0,
		scrollPaddingBottom: parseFloat(styles.scrollPaddingBottom) || 0,
		scrollPaddingLeft: parseFloat(styles.scrollPaddingLeft) || 0
	};
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/composite/root/useCompositeRoot.js
var EMPTY_ARRAY = [];
function useCompositeRoot(params) {
	const { itemSizes, cols = 1, loopFocus = true, onLoop, dense = false, orientation = "both", direction, highlightedIndex: externalHighlightedIndex, onHighlightedIndexChange: externalSetHighlightedIndex, rootRef: externalRef, enableHomeAndEndKeys = false, stopEventPropagation = false, disabledIndices, modifierKeys = EMPTY_ARRAY } = params;
	const [internalHighlightedIndex, internalSetHighlightedIndex] = import_react.useState(0);
	const isGrid = cols > 1;
	const rootRef = import_react.useRef(null);
	const mergedRef = useMergedRefs(rootRef, externalRef);
	const elementsRef = import_react.useRef([]);
	const hasSetDefaultIndexRef = import_react.useRef(false);
	const highlightedIndex = externalHighlightedIndex ?? internalHighlightedIndex;
	const onHighlightedIndexChange = useStableCallback((index, shouldScrollIntoView = false) => {
		(externalSetHighlightedIndex ?? internalSetHighlightedIndex)(index);
		if (shouldScrollIntoView) {
			const newActiveItem = elementsRef.current[index];
			scrollIntoViewIfNeeded(rootRef.current, newActiveItem, direction, orientation);
		}
	});
	const onMapChange = useStableCallback((map) => {
		if (map.size === 0 || hasSetDefaultIndexRef.current) return;
		hasSetDefaultIndexRef.current = true;
		const sortedElements = Array.from(map.keys());
		const activeItem = sortedElements.find((compositeElement) => compositeElement?.hasAttribute("data-composite-item-active")) ?? null;
		const activeIndex = activeItem ? sortedElements.indexOf(activeItem) : -1;
		if (activeIndex !== -1) onHighlightedIndexChange(activeIndex);
		scrollIntoViewIfNeeded(rootRef.current, activeItem, direction, orientation);
	});
	const wrappedOnLoop = useStableCallback((event, prevIndex, nextIndex) => {
		if (!onLoop) return nextIndex;
		return onLoop?.(event, prevIndex, nextIndex, elementsRef);
	});
	const props = import_react.useMemo(() => ({
		"aria-orientation": orientation === "both" ? void 0 : orientation,
		ref: mergedRef,
		onFocus(event) {
			const element = rootRef.current;
			const target = getTarget(event.nativeEvent);
			if (!element || target == null || !isNativeInput(target)) return;
			target.setSelectionRange(0, target.value.length ?? 0);
		},
		onKeyDown(event) {
			const RELEVANT_KEYS = enableHomeAndEndKeys ? COMPOSITE_KEYS : ARROW_KEYS;
			if (!RELEVANT_KEYS.has(event.key)) return;
			if (isModifierKeySet(event, modifierKeys)) return;
			if (!rootRef.current) return;
			const isRtl = direction === "rtl";
			const horizontalForwardKey = isRtl ? ARROW_LEFT : ARROW_RIGHT;
			const forwardKey = {
				horizontal: horizontalForwardKey,
				vertical: ARROW_DOWN,
				both: horizontalForwardKey
			}[orientation];
			const horizontalBackwardKey = isRtl ? ARROW_RIGHT : ARROW_LEFT;
			const backwardKey = {
				horizontal: horizontalBackwardKey,
				vertical: ARROW_UP,
				both: horizontalBackwardKey
			}[orientation];
			const target = getTarget(event.nativeEvent);
			if (target != null && isNativeInput(target) && !isElementDisabled(target)) {
				const selectionStart = target.selectionStart;
				const selectionEnd = target.selectionEnd;
				const textContent = target.value ?? "";
				if (selectionStart == null || event.shiftKey || selectionStart !== selectionEnd) return;
				if (event.key !== backwardKey && selectionStart < textContent.length) return;
				if (event.key !== forwardKey && selectionStart > 0) return;
			}
			let nextIndex = highlightedIndex;
			const minIndex = getMinListIndex(elementsRef, disabledIndices);
			const maxIndex = getMaxListIndex(elementsRef, disabledIndices);
			if (isGrid) {
				const sizes = itemSizes || Array.from({ length: elementsRef.current.length }, () => ({
					width: 1,
					height: 1
				}));
				const cellMap = createGridCellMap(sizes, cols, dense);
				const minGridIndex = cellMap.findIndex((index) => index != null && !isListIndexDisabled(elementsRef.current, index, disabledIndices));
				const maxGridIndex = cellMap.reduce((foundIndex, index, cellIndex) => index != null && !isListIndexDisabled(elementsRef.current, index, disabledIndices) ? cellIndex : foundIndex, -1);
				nextIndex = cellMap[getGridNavigatedIndex(cellMap.map((itemIndex) => itemIndex != null ? elementsRef.current[itemIndex] : null), {
					event,
					orientation,
					loopFocus,
					onLoop: wrappedOnLoop,
					cols,
					disabledIndices: getGridCellIndices([...disabledIndices || elementsRef.current.map((_, index) => isListIndexDisabled(elementsRef.current, index) ? index : void 0), void 0], cellMap),
					minIndex: minGridIndex,
					maxIndex: maxGridIndex,
					prevIndex: getGridCellIndexOfCorner(highlightedIndex > maxIndex ? minIndex : highlightedIndex, sizes, cellMap, cols, event.key === "ArrowDown" ? "bl" : event.key === "ArrowRight" ? "tr" : "tl"),
					rtl: isRtl
				})];
			}
			const forwardKeys = {
				horizontal: [horizontalForwardKey],
				vertical: [ARROW_DOWN],
				both: [horizontalForwardKey, ARROW_DOWN]
			}[orientation];
			const backwardKeys = {
				horizontal: [horizontalBackwardKey],
				vertical: [ARROW_UP],
				both: [horizontalBackwardKey, ARROW_UP]
			}[orientation];
			const preventedKeys = isGrid ? RELEVANT_KEYS : {
				horizontal: enableHomeAndEndKeys ? HORIZONTAL_KEYS_WITH_EXTRA_KEYS : HORIZONTAL_KEYS,
				vertical: enableHomeAndEndKeys ? VERTICAL_KEYS_WITH_EXTRA_KEYS : VERTICAL_KEYS,
				both: RELEVANT_KEYS
			}[orientation];
			if (enableHomeAndEndKeys) {
				if (event.key === "Home") nextIndex = minIndex;
				else if (event.key === "End") nextIndex = maxIndex;
			}
			if (nextIndex === highlightedIndex && (forwardKeys.includes(event.key) || backwardKeys.includes(event.key))) if (loopFocus && nextIndex === maxIndex && forwardKeys.includes(event.key)) {
				nextIndex = minIndex;
				if (onLoop) nextIndex = onLoop(event, highlightedIndex, nextIndex, elementsRef);
			} else if (loopFocus && nextIndex === minIndex && backwardKeys.includes(event.key)) {
				nextIndex = maxIndex;
				if (onLoop) nextIndex = onLoop(event, highlightedIndex, nextIndex, elementsRef);
			} else nextIndex = findNonDisabledListIndex(elementsRef.current, {
				startingIndex: nextIndex,
				decrement: backwardKeys.includes(event.key),
				disabledIndices
			});
			if (nextIndex !== highlightedIndex && !isIndexOutOfListBounds(elementsRef.current, nextIndex)) {
				if (stopEventPropagation) event.stopPropagation();
				if (preventedKeys.has(event.key)) event.preventDefault();
				onHighlightedIndexChange(nextIndex, true);
				queueMicrotask(() => {
					elementsRef.current[nextIndex]?.focus();
				});
			}
		}
	}), [
		cols,
		dense,
		direction,
		disabledIndices,
		elementsRef,
		enableHomeAndEndKeys,
		highlightedIndex,
		isGrid,
		itemSizes,
		loopFocus,
		onLoop,
		wrappedOnLoop,
		mergedRef,
		modifierKeys,
		onHighlightedIndexChange,
		orientation,
		stopEventPropagation
	]);
	return import_react.useMemo(() => ({
		props,
		highlightedIndex,
		onHighlightedIndexChange,
		elementsRef,
		disabledIndices,
		onMapChange,
		relayKeyboardEvent: props.onKeyDown
	}), [
		props,
		highlightedIndex,
		onHighlightedIndexChange,
		elementsRef,
		disabledIndices,
		onMapChange
	]);
}
function isModifierKeySet(event, ignoredModifierKeys) {
	for (const key of MODIFIER_KEYS.values()) {
		if (ignoredModifierKeys.includes(key)) continue;
		if (event.getModifierState(key)) return true;
	}
	return false;
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/direction-context/DirectionContext.js
/**
* @internal
*/
var DirectionContext = /*#__PURE__*/ import_react.createContext(void 0);
function useDirection() {
	return import_react.useContext(DirectionContext)?.direction ?? "ltr";
}
//#endregion
//#region node_modules/@base-ui/react/esm/internals/composite/root/CompositeRoot.js
/**
* @internal
*/
function CompositeRoot(componentProps) {
	const { render, className, style, refs = EMPTY_ARRAY$1, props = EMPTY_ARRAY$1, state = EMPTY_OBJECT, stateAttributesMapping, highlightedIndex: highlightedIndexProp, onHighlightedIndexChange: onHighlightedIndexChangeProp, orientation, dense, itemSizes, loopFocus, onLoop, cols, enableHomeAndEndKeys, onMapChange: onMapChangeProp, stopEventPropagation = true, rootRef, disabledIndices, modifierKeys, highlightItemOnHover = false, tag = "div", ...elementProps } = componentProps;
	const { props: defaultProps, highlightedIndex, onHighlightedIndexChange, elementsRef, onMapChange: onMapChangeUnwrapped, relayKeyboardEvent } = useCompositeRoot({
		itemSizes,
		cols,
		loopFocus,
		onLoop,
		dense,
		orientation,
		highlightedIndex: highlightedIndexProp,
		onHighlightedIndexChange: onHighlightedIndexChangeProp,
		rootRef,
		stopEventPropagation,
		enableHomeAndEndKeys,
		direction: useDirection(),
		disabledIndices,
		modifierKeys
	});
	const element = useRenderElement(tag, componentProps, {
		state,
		ref: refs,
		props: [
			defaultProps,
			...props,
			elementProps
		],
		stateAttributesMapping
	});
	const contextValue = import_react.useMemo(() => ({
		highlightedIndex,
		onHighlightedIndexChange,
		highlightItemOnHover,
		relayKeyboardEvent
	}), [
		highlightedIndex,
		onHighlightedIndexChange,
		highlightItemOnHover,
		relayKeyboardEvent
	]);
	return /*#__PURE__*/ (0, import_jsx_runtime.jsx)(CompositeRootContext.Provider, {
		value: contextValue,
		children: /*#__PURE__*/ (0, import_jsx_runtime.jsx)(CompositeList, {
			elementsRef,
			onMapChange: (newMap) => {
				onMapChangeProp?.(newMap);
				onMapChangeUnwrapped(newMap);
			},
			children: element
		})
	});
}
//#endregion
//#region node_modules/@base-ui/react/esm/tabs/list/TabsList.js
/**
* Groups the individual tab buttons.
* Renders a `<div>` element.
*
* Documentation: [Base UI Tabs](https://base-ui.com/react/components/tabs)
*/
var TabsList$1 = /*#__PURE__*/ import_react.forwardRef(function TabsList(componentProps, forwardedRef) {
	const { activateOnFocus = false, className, loopFocus = true, render, style, ...elementProps } = componentProps;
	const { onValueChange, orientation, value, setTabMap, tabActivationDirection } = useTabsRootContext();
	const [highlightedTabIndex, setHighlightedTabIndex] = import_react.useState(0);
	const [tabsListElement, setTabsListElement] = import_react.useState(null);
	const indicatorUpdateListenersRef = import_react.useRef(/* @__PURE__ */ new Set());
	const tabResizeObserverElementsRef = import_react.useRef(/* @__PURE__ */ new Set());
	const resizeObserverRef = import_react.useRef(null);
	import_react.useEffect(() => {
		if (typeof ResizeObserver === "undefined") return;
		const resizeObserver = new ResizeObserver(() => {
			indicatorUpdateListenersRef.current.forEach((listener) => {
				listener();
			});
		});
		resizeObserverRef.current = resizeObserver;
		if (tabsListElement) resizeObserver.observe(tabsListElement);
		tabResizeObserverElementsRef.current.forEach((element) => {
			resizeObserver.observe(element);
		});
		return () => {
			resizeObserver.disconnect();
			resizeObserverRef.current = null;
		};
	}, [tabsListElement]);
	const registerIndicatorUpdateListener = useStableCallback((listener) => {
		indicatorUpdateListenersRef.current.add(listener);
		return () => {
			indicatorUpdateListenersRef.current.delete(listener);
		};
	});
	const registerTabResizeObserverElement = useStableCallback((element) => {
		tabResizeObserverElementsRef.current.add(element);
		resizeObserverRef.current?.observe(element);
		return () => {
			tabResizeObserverElementsRef.current.delete(element);
			resizeObserverRef.current?.unobserve(element);
		};
	});
	const onTabActivation = useStableCallback((newValue, eventDetails) => {
		if (newValue !== value) onValueChange(newValue, eventDetails);
	});
	const state = {
		orientation,
		tabActivationDirection
	};
	const defaultProps = {
		"aria-orientation": orientation === "vertical" ? "vertical" : void 0,
		role: "tablist"
	};
	const tabsListContextValue = import_react.useMemo(() => ({
		activateOnFocus,
		highlightedTabIndex,
		registerIndicatorUpdateListener,
		registerTabResizeObserverElement,
		onTabActivation,
		setHighlightedTabIndex,
		tabsListElement
	}), [
		activateOnFocus,
		highlightedTabIndex,
		registerIndicatorUpdateListener,
		registerTabResizeObserverElement,
		onTabActivation,
		setHighlightedTabIndex,
		tabsListElement
	]);
	return /*#__PURE__*/ (0, import_jsx_runtime.jsx)(TabsListContext$1.Provider, {
		value: tabsListContextValue,
		children: /*#__PURE__*/ (0, import_jsx_runtime.jsx)(CompositeRoot, {
			render,
			className,
			style,
			state,
			refs: [forwardedRef, setTabsListElement],
			props: [defaultProps, elementProps],
			stateAttributesMapping: tabsStateAttributesMapping,
			highlightedIndex: highlightedTabIndex,
			enableHomeAndEndKeys: true,
			loopFocus,
			orientation,
			onHighlightedIndexChange: setHighlightedTabIndex,
			onMapChange: setTabMap,
			disabledIndices: EMPTY_ARRAY$1
		})
	});
});
//#endregion
//#region src/components/ui/tabs.tsx
var TabsValueOrderContext = (0, import_react.createContext)(null);
var TabsListContext = (0, import_react.createContext)(null);
function useTabsList() {
	const ctx = (0, import_react.useContext)(TabsListContext);
	if (!ctx) throw new Error("TabItem must be used within a TabsList");
	return ctx;
}
var Tabs = (0, import_react.forwardRef)((t0, ref) => {
	const $ = (0, import_compiler_runtime.c)(29);
	let children;
	let defaultValue;
	let onSelect;
	let onValueChange;
	let props;
	let selectedIndex;
	let value;
	if ($[0] !== t0) {
		({value, onValueChange, selectedIndex, onSelect, defaultValue, children, ...props} = t0);
		$[0] = t0;
		$[1] = children;
		$[2] = defaultValue;
		$[3] = onSelect;
		$[4] = onValueChange;
		$[5] = props;
		$[6] = selectedIndex;
		$[7] = value;
	} else {
		children = $[1];
		defaultValue = $[2];
		onSelect = $[3];
		onValueChange = $[4];
		props = $[5];
		selectedIndex = $[6];
		value = $[7];
	}
	let t1;
	if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
		t1 = [];
		$[8] = t1;
	} else t1 = $[8];
	const [valueOrder, setValueOrder] = (0, import_react.useState)(t1);
	const [uncontrolledValue, setUncontrolledValue] = (0, import_react.useState)(defaultValue);
	let t2;
	if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
		t2 = (order) => {
			setValueOrder((current) => {
				if (current.length === order.length && current.every((v, i) => v === order[i])) return current;
				return order;
			});
		};
		$[9] = t2;
	} else t2 = $[9];
	const updateValueOrder = t2;
	const resolvedValue = value ?? (selectedIndex != null ? valueOrder[selectedIndex] : uncontrolledValue);
	let t3;
	if ($[10] !== onSelect || $[11] !== onValueChange || $[12] !== selectedIndex || $[13] !== value || $[14] !== valueOrder) {
		t3 = (newValue) => {
			const v_0 = newValue;
			if (value === void 0 && selectedIndex == null) setUncontrolledValue(v_0);
			onValueChange?.(v_0);
			if (onSelect) {
				const idx = valueOrder.indexOf(v_0);
				if (idx !== -1) onSelect(idx);
			}
		};
		$[10] = onSelect;
		$[11] = onValueChange;
		$[12] = selectedIndex;
		$[13] = value;
		$[14] = valueOrder;
		$[15] = t3;
	} else t3 = $[15];
	const handleValueChange = t3;
	let t4;
	if ($[16] !== resolvedValue || $[17] !== valueOrder) {
		t4 = {
			valueOrder,
			setValueOrder: updateValueOrder,
			selectedValue: resolvedValue
		};
		$[16] = resolvedValue;
		$[17] = valueOrder;
		$[18] = t4;
	} else t4 = $[18];
	const t5 = resolvedValue == null ? defaultValue : void 0;
	let t6;
	if ($[19] !== children || $[20] !== handleValueChange || $[21] !== props || $[22] !== ref || $[23] !== resolvedValue || $[24] !== t5) {
		t6 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsRoot, {
			ref,
			value: resolvedValue,
			onValueChange: handleValueChange,
			defaultValue: t5,
			...props,
			children
		});
		$[19] = children;
		$[20] = handleValueChange;
		$[21] = props;
		$[22] = ref;
		$[23] = resolvedValue;
		$[24] = t5;
		$[25] = t6;
	} else t6 = $[25];
	let t7;
	if ($[26] !== t4 || $[27] !== t6) {
		t7 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsValueOrderContext.Provider, {
			value: t4,
			children: t6
		});
		$[26] = t4;
		$[27] = t6;
		$[28] = t7;
	} else t7 = $[28];
	return t7;
});
Tabs.displayName = "Tabs";
var TabsList = (0, import_react.forwardRef)(({ children, className, ...props }, ref) => {
	const containerRef = (0, import_react.useRef)(null);
	const isMouseInside = (0, import_react.useRef)(false);
	const shape = useShape();
	const substrate = useSurface();
	const indicatorLevel = Math.min(substrate + 3, 8);
	const valueOrderCtx = (0, import_react.useContext)(TabsValueOrderContext);
	const [optimisticIdx, setOptimisticIdx] = (0, import_react.useState)(null);
	const values = import_react.Children.toArray(children).filter(import_react.isValidElement).map((child) => child.props.value).filter((v) => typeof v === "string");
	const valueOrderKey = values.join(",");
	const setValueOrder = valueOrderCtx?.setValueOrder;
	(0, import_react.useLayoutEffect)(() => {
		setValueOrder?.(values);
	}, [setValueOrder, valueOrderKey]);
	const { activeIndex: hoveredIndex, setActiveIndex: setHoveredIndex, itemRects, handlers, registerItem, measureItems } = useProximityHover(containerRef, { axis: "x" });
	const registerTab = (0, import_react.useCallback)((index, _value, el) => {
		registerItem(index, el);
	}, [registerItem]);
	(0, import_react.useEffect)(() => {
		measureItems();
	}, [measureItems, children]);
	(0, import_react.useEffect)(() => {
		const el_0 = containerRef.current;
		if (!el_0) return;
		const ro = new ResizeObserver(() => measureItems());
		ro.observe(el_0);
		return () => ro.disconnect();
	}, [measureItems]);
	const handleMouseMove = (0, import_react.useCallback)((e) => {
		isMouseInside.current = true;
		handlers.onMouseMove(e);
	}, [handlers]);
	const handleMouseLeave = (0, import_react.useCallback)(() => {
		isMouseInside.current = false;
		handlers.onMouseLeave();
	}, [handlers]);
	const [focusedIndex, setFocusedIndex] = (0, import_react.useState)(null);
	const selectedValue = valueOrderCtx?.selectedValue;
	const selectedIdx = selectedValue !== void 0 ? values.indexOf(selectedValue) : -1;
	(0, import_react.useEffect)(() => {
		setOptimisticIdx(selectedIdx >= 0 ? selectedIdx : null);
	}, [selectedIdx]);
	const activeSelectedIdx = optimisticIdx;
	const selectedRect = activeSelectedIdx !== null ? itemRects[activeSelectedIdx] : null;
	const hoverRect = hoveredIndex !== null ? itemRects[hoveredIndex] : null;
	const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null;
	const isHoveringSelected = hoveredIndex === activeSelectedIdx;
	const isHovering = hoveredIndex !== null && !isHoveringSelected;
	const indexedChildren = import_react.Children.map(children, (child_0, i) => {
		if ((0, import_react.isValidElement)(child_0)) return (0, import_react.cloneElement)(child_0, { _index: i });
		return child_0;
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsListContext.Provider, {
		value: {
			registerTab,
			hoveredIndex,
			selectedValue,
			setOptimisticIdx
		},
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(TabsList$1, {
			activateOnFocus: true,
			ref: (node) => {
				containerRef.current = node;
				if (typeof ref === "function") ref(node);
				else if (ref) ref.current = node;
			},
			onMouseMove: handleMouseMove,
			onMouseLeave: handleMouseLeave,
			onFocus: (e_0) => {
				const trigger = e_0.target.closest("[role=\"tab\"]");
				if (!trigger) return;
				const indexAttr = trigger.getAttribute("data-proximity-index");
				if (indexAttr != null) {
					const idx = Number(indexAttr);
					setHoveredIndex(idx);
					setFocusedIndex(e_0.target.matches(":focus-visible") ? idx : null);
				}
			},
			onBlur: (e_1) => {
				if (containerRef.current?.contains(e_1.relatedTarget)) return;
				setFocusedIndex(null);
				if (isMouseInside.current) return;
				setHoveredIndex(null);
			},
			className: cn("relative inline-flex items-center gap-0.5 p-1 select-none bg-muted", shape.container, className),
			...props,
			children: [
				selectedRect && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
					className: cn("absolute pointer-events-none", surfaceClasses(indicatorLevel), shape.bg),
					initial: false,
					animate: {
						left: selectedRect.left,
						width: selectedRect.width,
						top: selectedRect.top,
						height: selectedRect.height,
						opacity: isHovering ? .85 : 1
					},
					transition: {
						...springs.moderate,
						opacity: { duration: .08 }
					}
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AnimatePresence, { children: hoverRect && !isHoveringSelected && selectedRect && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
					className: cn("absolute pointer-events-none bg-hover", shape.bg),
					initial: {
						left: selectedRect.left,
						width: selectedRect.width,
						top: selectedRect.top,
						height: selectedRect.height,
						opacity: 0
					},
					animate: {
						left: hoverRect.left,
						width: hoverRect.width,
						top: hoverRect.top,
						height: hoverRect.height,
						opacity: .4
					},
					exit: !isMouseInside.current && selectedRect ? {
						left: selectedRect.left,
						width: selectedRect.width,
						top: selectedRect.top,
						height: selectedRect.height,
						opacity: 0,
						transition: {
							...springs.moderate,
							opacity: { duration: .06 }
						}
					} : {
						opacity: 0,
						transition: { duration: .06 }
					},
					transition: {
						...springs.fast,
						opacity: { duration: .08 }
					}
				}) }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AnimatePresence, { children: focusRect && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
					className: cn("absolute pointer-events-none z-20 border border-[#6B97FF]", shape.focusRing),
					initial: false,
					animate: {
						left: focusRect.left - 2,
						top: focusRect.top - 2,
						width: focusRect.width + 4,
						height: focusRect.height + 4
					},
					exit: {
						opacity: 0,
						transition: { duration: .06 }
					},
					transition: {
						...springs.fast,
						opacity: { duration: .08 }
					}
				}) }),
				indexedChildren
			]
		})
	});
});
TabsList.displayName = "TabsList";
var TabItem = (0, import_react.forwardRef)((t0, ref) => {
	const $ = (0, import_compiler_runtime.c)(49);
	let Icon;
	let className;
	let label;
	let onClose;
	let props;
	let t1;
	let value;
	if ($[0] !== t0) {
		({value, icon: Icon, label, onClose, _index: t1, className, ...props} = t0);
		$[0] = t0;
		$[1] = Icon;
		$[2] = className;
		$[3] = label;
		$[4] = onClose;
		$[5] = props;
		$[6] = t1;
		$[7] = value;
	} else {
		Icon = $[1];
		className = $[2];
		label = $[3];
		onClose = $[4];
		props = $[5];
		t1 = $[6];
		value = $[7];
	}
	const _index = t1 === void 0 ? 0 : t1;
	const internalRef = (0, import_react.useRef)(null);
	const { registerTab, hoveredIndex, selectedValue, setOptimisticIdx } = useTabsList();
	let t2;
	let t3;
	if ($[8] !== _index || $[9] !== registerTab || $[10] !== value) {
		t2 = () => {
			registerTab(_index, value, internalRef.current);
			return () => registerTab(_index, value, null);
		};
		t3 = [
			_index,
			value,
			registerTab
		];
		$[8] = _index;
		$[9] = registerTab;
		$[10] = value;
		$[11] = t2;
		$[12] = t3;
	} else {
		t2 = $[11];
		t3 = $[12];
	}
	(0, import_react.useEffect)(t2, t3);
	const isSelected = selectedValue === value;
	const isActive = hoveredIndex === _index || isSelected;
	let t4;
	if ($[13] !== _index || $[14] !== setOptimisticIdx) {
		t4 = () => setOptimisticIdx(_index);
		$[13] = _index;
		$[14] = setOptimisticIdx;
		$[15] = t4;
	} else t4 = $[15];
	let t5;
	if ($[16] !== ref) {
		t5 = (node) => {
			internalRef.current = node;
			if (typeof ref === "function") ref(node);
			else if (ref) ref.current = node;
		};
		$[16] = ref;
		$[17] = t5;
	} else t5 = $[17];
	let t6;
	if ($[18] !== className) {
		t6 = cn("relative z-10 flex items-center gap-2 px-3 py-1.5 cursor-pointer bg-transparent border-none outline-none", className);
		$[18] = className;
		$[19] = t6;
	} else t6 = $[19];
	let t7;
	if ($[20] !== Icon || $[21] !== isActive) {
		t7 = Icon && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
			size: 16,
			strokeWidth: isActive ? 2 : 1.5,
			className: cn("transition-[color,stroke-width] duration-80", isActive ? "text-foreground" : "text-muted-foreground")
		});
		$[20] = Icon;
		$[21] = isActive;
		$[22] = t7;
	} else t7 = $[22];
	let t8;
	if ($[23] === Symbol.for("react.memo_cache_sentinel")) {
		t8 = { fontVariationSettings: fontWeights.semibold };
		$[23] = t8;
	} else t8 = $[23];
	let t9;
	if ($[24] !== label) {
		t9 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "col-start-1 row-start-1 invisible",
			style: t8,
			"aria-hidden": "true",
			children: label
		});
		$[24] = label;
		$[25] = t9;
	} else t9 = $[25];
	const t10 = isActive ? "text-foreground" : "text-muted-foreground";
	let t11;
	if ($[26] !== t10) {
		t11 = cn("col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80", t10);
		$[26] = t10;
		$[27] = t11;
	} else t11 = $[27];
	const t12 = isSelected ? fontWeights.semibold : fontWeights.normal;
	let t13;
	if ($[28] !== t12) {
		t13 = { fontVariationSettings: t12 };
		$[28] = t12;
		$[29] = t13;
	} else t13 = $[29];
	let t14;
	if ($[30] !== label || $[31] !== t11 || $[32] !== t13) {
		t14 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: t11,
			style: t13,
			children: label
		});
		$[30] = label;
		$[31] = t11;
		$[32] = t13;
		$[33] = t14;
	} else t14 = $[33];
	let t15;
	if ($[34] !== t14 || $[35] !== t9) {
		t15 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "inline-grid text-[13px] whitespace-nowrap",
			children: [t9, t14]
		});
		$[34] = t14;
		$[35] = t9;
		$[36] = t15;
	} else t15 = $[36];
	let t16;
	if ($[37] !== onClose) {
		t16 = onClose && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			role: "button",
			tabIndex: 0,
			onClick: (e) => {
				e.stopPropagation();
				onClose();
			},
			onKeyDown: (e_0) => {
				if (e_0.key === "Enter" || e_0.key === " ") {
					e_0.stopPropagation();
					e_0.preventDefault();
					onClose();
				}
			},
			className: "relative z-20 ml-1 p-0.5 rounded-full hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 text-muted-foreground hover:text-foreground transition-colors border-none bg-transparent cursor-pointer flex items-center justify-center",
			title: "Close Tab",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(n, { size: 12 })
		});
		$[37] = onClose;
		$[38] = t16;
	} else t16 = $[38];
	let t17;
	if ($[39] !== _index || $[40] !== props || $[41] !== t15 || $[42] !== t16 || $[43] !== t4 || $[44] !== t5 || $[45] !== t6 || $[46] !== t7 || $[47] !== value) {
		t17 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(TabsTab, {
			onClick: t4,
			ref: t5,
			value,
			"data-proximity-index": _index,
			className: t6,
			...props,
			children: [
				t7,
				t15,
				t16
			]
		});
		$[39] = _index;
		$[40] = props;
		$[41] = t15;
		$[42] = t16;
		$[43] = t4;
		$[44] = t5;
		$[45] = t6;
		$[46] = t7;
		$[47] = value;
		$[48] = t17;
	} else t17 = $[48];
	return t17;
});
TabItem.displayName = "TabItem";
var TabPanel = (0, import_react.forwardRef)((t0, ref) => {
	const $ = (0, import_compiler_runtime.c)(9);
	let className;
	let props;
	if ($[0] !== t0) {
		({className, ...props} = t0);
		$[0] = t0;
		$[1] = className;
		$[2] = props;
	} else {
		className = $[1];
		props = $[2];
	}
	let t1;
	if ($[3] !== className) {
		t1 = cn("outline-none", className);
		$[3] = className;
		$[4] = t1;
	} else t1 = $[4];
	let t2;
	if ($[5] !== props || $[6] !== ref || $[7] !== t1) {
		t2 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsPanel, {
			ref,
			className: t1,
			...props
		});
		$[5] = props;
		$[6] = ref;
		$[7] = t1;
		$[8] = t2;
	} else t2 = $[8];
	return t2;
});
TabPanel.displayName = "TabPanel";
//#endregion
//#region src/store/thread-store.ts
var useThreadStore = create((set, get) => ({
	threads: [],
	activeThreadId: null,
	isLoading: false,
	error: null,
	loadThreads: async () => {
		set({
			isLoading: true,
			error: null
		});
		try {
			const list = await window.omni.threads.list();
			set({
				threads: list,
				isLoading: false
			});
			if (list.length > 0 && !get().activeThreadId) set({ activeThreadId: list[0].id });
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : "Failed to load threads",
				isLoading: false
			});
		}
	},
	setActiveThreadId: (id) => set({ activeThreadId: id }),
	createThread: async (projectId, title) => {
		try {
			const thread = await window.omni.threads.create(projectId, title);
			set((state) => ({
				threads: [...state.threads, thread],
				activeThreadId: thread.id
			}));
			return thread;
		} catch (err) {
			console.error("Failed to create thread:", err);
			return null;
		}
	},
	deleteThread: async (id) => {
		try {
			await window.omni.threads.delete(id);
			set((state) => {
				const nextThreads = state.threads.filter((t) => t.id !== id);
				let nextActiveId = state.activeThreadId;
				if (state.activeThreadId === id) nextActiveId = nextThreads.length > 0 ? nextThreads[0].id : null;
				return {
					threads: nextThreads,
					activeThreadId: nextActiveId
				};
			});
		} catch (err) {
			console.error("Failed to delete thread:", err);
		}
	}
}));
//#endregion
//#region node_modules/@tabler/icons-react/dist/esm/defaultAttributes.mjs
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var defaultAttributes$1 = {
	outline: {
		xmlns: "http://www.w3.org/2000/svg",
		width: 24,
		height: 24,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 2,
		strokeLinecap: "round",
		strokeLinejoin: "round"
	},
	filled: {
		xmlns: "http://www.w3.org/2000/svg",
		width: 24,
		height: 24,
		viewBox: "0 0 24 24",
		fill: "currentColor",
		stroke: "none"
	}
};
//#endregion
//#region node_modules/@tabler/icons-react/dist/esm/createReactComponent.mjs
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var createReactComponent = (type, iconName, iconNamePascal, iconNode) => {
	const Component = (0, import_react.forwardRef)(({ color = "currentColor", size = 24, stroke = 2, title, className, children, ...rest }, ref) => (0, import_react.createElement)("svg", {
		ref,
		...defaultAttributes$1[type],
		width: size,
		height: size,
		className: [
			`tabler-icon`,
			`tabler-icon-${iconName}`,
			className
		].join(" "),
		...type === "filled" ? { fill: color } : {
			strokeWidth: stroke,
			stroke: color
		},
		...rest
	}, [
		title && (0, import_react.createElement)("title", { key: "svg-title" }, title),
		...iconNode.map(([tag, attrs]) => (0, import_react.createElement)(tag, attrs)),
		...Array.isArray(children) ? children : [children]
	]));
	Component.displayName = `${iconNamePascal}`;
	return Component;
};
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconArrowLeft = createReactComponent("outline", "arrow-left", "ArrowLeft", [
	["path", {
		"d": "M5 12l14 0",
		"key": "svg-0"
	}],
	["path", {
		"d": "M5 12l6 6",
		"key": "svg-1"
	}],
	["path", {
		"d": "M5 12l6 -6",
		"key": "svg-2"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconArrowRight = createReactComponent("outline", "arrow-right", "ArrowRight", [
	["path", {
		"d": "M5 12l14 0",
		"key": "svg-0"
	}],
	["path", {
		"d": "M13 18l6 -6",
		"key": "svg-1"
	}],
	["path", {
		"d": "M13 6l6 6",
		"key": "svg-2"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconArrowUp = createReactComponent("outline", "arrow-up", "ArrowUp", [
	["path", {
		"d": "M12 5l0 14",
		"key": "svg-0"
	}],
	["path", {
		"d": "M18 11l-6 -6",
		"key": "svg-1"
	}],
	["path", {
		"d": "M6 11l6 -6",
		"key": "svg-2"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconBell = createReactComponent("outline", "bell", "Bell", [["path", {
	"d": "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6",
	"key": "svg-0"
}], ["path", {
	"d": "M9 17v1a3 3 0 0 0 6 0v-1",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconBrain = createReactComponent("outline", "brain", "Brain", [
	["path", {
		"d": "M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8",
		"key": "svg-0"
	}],
	["path", {
		"d": "M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8",
		"key": "svg-1"
	}],
	["path", {
		"d": "M17.5 16a3.5 3.5 0 0 0 0 -7h-.5",
		"key": "svg-2"
	}],
	["path", {
		"d": "M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0",
		"key": "svg-3"
	}],
	["path", {
		"d": "M6.5 16a3.5 3.5 0 0 1 0 -7h.5",
		"key": "svg-4"
	}],
	["path", {
		"d": "M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10",
		"key": "svg-5"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconBrush = createReactComponent("outline", "brush", "Brush", [
	["path", {
		"d": "M3 21v-4a4 4 0 1 1 4 4h-4",
		"key": "svg-0"
	}],
	["path", {
		"d": "M21 3a16 16 0 0 0 -12.8 10.2",
		"key": "svg-1"
	}],
	["path", {
		"d": "M21 3a16 16 0 0 1 -10.2 12.8",
		"key": "svg-2"
	}],
	["path", {
		"d": "M10.6 9a9 9 0 0 1 4.4 4.4",
		"key": "svg-3"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconBulb = createReactComponent("outline", "bulb", "Bulb", [
	["path", {
		"d": "M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7",
		"key": "svg-0"
	}],
	["path", {
		"d": "M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3",
		"key": "svg-1"
	}],
	["path", {
		"d": "M9.7 17l4.6 0",
		"key": "svg-2"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconCheck = createReactComponent("outline", "check", "Check", [["path", {
	"d": "M5 12l5 5l10 -10",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconChevronDown = createReactComponent("outline", "chevron-down", "ChevronDown", [["path", {
	"d": "M6 9l6 6l6 -6",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconChevronRight = createReactComponent("outline", "chevron-right", "ChevronRight", [["path", {
	"d": "M9 6l6 6l-6 6",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconCircle = createReactComponent("outline", "circle", "Circle", [["path", {
	"d": "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconClock = createReactComponent("outline", "clock", "Clock", [["path", {
	"d": "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0",
	"key": "svg-0"
}], ["path", {
	"d": "M12 7v5l3 3",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconColorPicker = createReactComponent("outline", "color-picker", "ColorPicker", [["path", {
	"d": "M11 7l6 6",
	"key": "svg-0"
}], ["path", {
	"d": "M4 16l11.7 -11.7a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-11.7 11.7h-4v-4",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconCopy = createReactComponent("outline", "copy", "Copy", [["path", {
	"d": "M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666",
	"key": "svg-0"
}], ["path", {
	"d": "M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconCornerDownRight = createReactComponent("outline", "corner-down-right", "CornerDownRight", [["path", {
	"d": "M6 6v6a3 3 0 0 0 3 3h10l-4 -4m0 8l4 -4",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconDeviceDesktop = createReactComponent("outline", "device-desktop", "DeviceDesktop", [
	["path", {
		"d": "M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10",
		"key": "svg-0"
	}],
	["path", {
		"d": "M7 20h10",
		"key": "svg-1"
	}],
	["path", {
		"d": "M9 16v4",
		"key": "svg-2"
	}],
	["path", {
		"d": "M15 16v4",
		"key": "svg-3"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconGlobe = createReactComponent("outline", "globe", "Globe", [
	["path", {
		"d": "M7 9a4 4 0 1 0 8 0a4 4 0 0 0 -8 0",
		"key": "svg-0"
	}],
	["path", {
		"d": "M5.75 15a8.015 8.015 0 1 0 9.25 -13",
		"key": "svg-1"
	}],
	["path", {
		"d": "M11 17v4",
		"key": "svg-2"
	}],
	["path", {
		"d": "M7 21h8",
		"key": "svg-3"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconHeart = createReactComponent("outline", "heart", "Heart", [["path", {
	"d": "M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconHome = createReactComponent("outline", "home", "Home", [
	["path", {
		"d": "M5 12l-2 0l9 -9l9 9l-2 0",
		"key": "svg-0"
	}],
	["path", {
		"d": "M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7",
		"key": "svg-1"
	}],
	["path", {
		"d": "M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6",
		"key": "svg-2"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconInbox = createReactComponent("outline", "inbox", "Inbox", [["path", {
	"d": "M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12",
	"key": "svg-0"
}], ["path", {
	"d": "M4 13h3l3 3h4l3 -3h3",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconLibrary = createReactComponent("outline", "library", "Library", [
	["path", {
		"d": "M7 5.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666",
		"key": "svg-0"
	}],
	["path", {
		"d": "M4.012 7.26a2.005 2.005 0 0 0 -1.012 1.737v10c0 1.1 .9 2 2 2h10c.75 0 1.158 -.385 1.5 -1",
		"key": "svg-1"
	}],
	["path", {
		"d": "M11 7h5",
		"key": "svg-2"
	}],
	["path", {
		"d": "M11 10h6",
		"key": "svg-3"
	}],
	["path", {
		"d": "M11 13h3",
		"key": "svg-4"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconLink = createReactComponent("outline", "link", "Link", [
	["path", {
		"d": "M9 15l6 -6",
		"key": "svg-0"
	}],
	["path", {
		"d": "M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464",
		"key": "svg-1"
	}],
	["path", {
		"d": "M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463",
		"key": "svg-2"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconLoader2 = createReactComponent("outline", "loader-2", "Loader2", [["path", {
	"d": "M12 3a9 9 0 1 0 9 9",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconLock = createReactComponent("outline", "lock", "Lock", [
	["path", {
		"d": "M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6",
		"key": "svg-0"
	}],
	["path", {
		"d": "M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0",
		"key": "svg-1"
	}],
	["path", {
		"d": "M8 11v-4a4 4 0 1 1 8 0v4",
		"key": "svg-2"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconMail = createReactComponent("outline", "mail", "Mail", [["path", {
	"d": "M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10",
	"key": "svg-0"
}], ["path", {
	"d": "M3 7l9 6l9 -6",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconMenu2 = createReactComponent("outline", "menu-2", "Menu2", [
	["path", {
		"d": "M4 6l16 0",
		"key": "svg-0"
	}],
	["path", {
		"d": "M4 12l16 0",
		"key": "svg-1"
	}],
	["path", {
		"d": "M4 18l16 0",
		"key": "svg-2"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconMessageCircle = createReactComponent("outline", "message-circle", "MessageCircle", [["path", {
	"d": "M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconMoon = createReactComponent("outline", "moon", "Moon", [["path", {
	"d": "M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconPalette = createReactComponent("outline", "palette", "Palette", [
	["path", {
		"d": "M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25",
		"key": "svg-0"
	}],
	["path", {
		"d": "M7.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
		"key": "svg-1"
	}],
	["path", {
		"d": "M11.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
		"key": "svg-2"
	}],
	["path", {
		"d": "M15.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
		"key": "svg-3"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconPencil = createReactComponent("outline", "pencil", "Pencil", [["path", {
	"d": "M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4",
	"key": "svg-0"
}], ["path", {
	"d": "M13.5 6.5l4 4",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconPhoto = createReactComponent("outline", "photo", "Photo", [
	["path", {
		"d": "M15 8h.01",
		"key": "svg-0"
	}],
	["path", {
		"d": "M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12",
		"key": "svg-1"
	}],
	["path", {
		"d": "M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5",
		"key": "svg-2"
	}],
	["path", {
		"d": "M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3",
		"key": "svg-3"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconPlayerPause = createReactComponent("outline", "player-pause", "PlayerPause", [["path", {
	"d": "M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12",
	"key": "svg-0"
}], ["path", {
	"d": "M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconPlayerPlay = createReactComponent("outline", "player-play", "PlayerPlay", [["path", {
	"d": "M7 4v16l13 -8l-13 -8",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconPlayerSkipForward = createReactComponent("outline", "player-skip-forward", "PlayerSkipForward", [["path", {
	"d": "M4 5v14l12 -7l-12 -7",
	"key": "svg-0"
}], ["path", {
	"d": "M20 5l0 14",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconPlus = createReactComponent("outline", "plus", "Plus", [["path", {
	"d": "M12 5l0 14",
	"key": "svg-0"
}], ["path", {
	"d": "M5 12l14 0",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconPoint = createReactComponent("outline", "point", "Point", [["path", {
	"d": "M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconRocket = createReactComponent("outline", "rocket", "Rocket", [
	["path", {
		"d": "M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3",
		"key": "svg-0"
	}],
	["path", {
		"d": "M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3",
		"key": "svg-1"
	}],
	["path", {
		"d": "M14 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
		"key": "svg-2"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconRotate2 = createReactComponent("outline", "rotate-2", "Rotate2", [
	["path", {
		"d": "M15 4.55a8 8 0 0 0 -6 14.9m0 -4.45v5h-5",
		"key": "svg-0"
	}],
	["path", {
		"d": "M18.37 7.16l0 .01",
		"key": "svg-1"
	}],
	["path", {
		"d": "M13 19.94l0 .01",
		"key": "svg-2"
	}],
	["path", {
		"d": "M16.84 18.37l0 .01",
		"key": "svg-3"
	}],
	["path", {
		"d": "M19.37 15.1l0 .01",
		"key": "svg-4"
	}],
	["path", {
		"d": "M19.94 11l0 .01",
		"key": "svg-5"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconSearch = createReactComponent("outline", "search", "Search", [["path", {
	"d": "M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0",
	"key": "svg-0"
}], ["path", {
	"d": "M21 21l-6 -6",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconSettings = createReactComponent("outline", "settings", "Settings", [["path", {
	"d": "M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065",
	"key": "svg-0"
}], ["path", {
	"d": "M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconShield = createReactComponent("outline", "shield", "Shield", [["path", {
	"d": "M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconSquare = createReactComponent("outline", "square", "Square", [["path", {
	"d": "M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconStar = createReactComponent("outline", "star", "Star", [["path", {
	"d": "M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245",
	"key": "svg-0"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconSun = createReactComponent("outline", "sun", "Sun", [["path", {
	"d": "M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
	"key": "svg-0"
}], ["path", {
	"d": "M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconUser = createReactComponent("outline", "user", "User", [["path", {
	"d": "M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0",
	"key": "svg-0"
}], ["path", {
	"d": "M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2",
	"key": "svg-1"
}]]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconUsers = createReactComponent("outline", "users", "Users", [
	["path", {
		"d": "M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
		"key": "svg-0"
	}],
	["path", {
		"d": "M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2",
		"key": "svg-1"
	}],
	["path", {
		"d": "M16 3.13a4 4 0 0 1 0 7.75",
		"key": "svg-2"
	}],
	["path", {
		"d": "M21 21v-2a4 4 0 0 0 -3 -3.85",
		"key": "svg-3"
	}]
]);
/**
* @license @tabler/icons-react v3.44.0 - MIT
*
* This source code is licensed under the MIT license.
* See the LICENSE file in the root directory of this source tree.
*/
var IconX = createReactComponent("outline", "x", "X", [["path", {
	"d": "M18 6l-12 12",
	"key": "svg-0"
}], ["path", {
	"d": "M6 6l12 12",
	"key": "svg-1"
}]]);
//#endregion
//#region node_modules/@hugeicons/react/dist/esm/HugeiconsIcon.js
var defaultAttributes = {
	xmlns: "http://www.w3.org/2000/svg",
	width: 24,
	height: 24,
	viewBox: "0 0 24 24",
	fill: "none"
};
var HugeiconsIcon = (0, import_react.forwardRef)(({ color = "currentColor", size = 24, strokeWidth, absoluteStrokeWidth = false, className = "", altIcon, showAlt = false, icon, primaryColor, secondaryColor, disableSecondaryOpacity = false, ...rest }, ref) => {
	const calculatedStrokeWidth = strokeWidth !== void 0 ? absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth : void 0;
	const strokeProps = calculatedStrokeWidth !== void 0 ? {
		strokeWidth: calculatedStrokeWidth,
		stroke: "currentColor"
	} : {};
	return (0, import_react.createElement)("svg", {
		ref,
		...defaultAttributes,
		width: size,
		height: size,
		color: primaryColor || color,
		className,
		...strokeProps,
		...rest
	}, [...showAlt && altIcon ? altIcon : icon].sort(([, a], [, b]) => {
		const hasOpacityA = a.opacity !== void 0;
		return b.opacity !== void 0 ? 1 : hasOpacityA ? -1 : 0;
	}).map(([tag, attrs]) => {
		const isSecondaryPath = attrs.opacity !== void 0;
		const pathOpacity = isSecondaryPath && !disableSecondaryOpacity ? attrs.opacity : void 0;
		const fillProps = secondaryColor ? { ...attrs.stroke !== void 0 ? { stroke: isSecondaryPath ? secondaryColor : primaryColor || color } : { fill: isSecondaryPath ? secondaryColor : primaryColor || color } } : {};
		return (0, import_react.createElement)(tag, {
			...attrs,
			...strokeProps,
			...fillProps,
			opacity: pathOpacity,
			key: attrs.key
		});
	}));
});
HugeiconsIcon.displayName = "HugeiconsIcon";
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/ArrowRight01Icon.js
var ArrowRight01Icon = [["path", {
	d: "M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/ArrowDown01Icon.js
var ArrowDown01Icon = [["path", {
	d: "M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/DropperIcon.js
var DropperIcon = [["path", {
	d: "M11.2872 8.00018L4.68174 14.6057C4.05287 15.2345 3.72789 16.0522 3.70679 16.8762C3.67836 17.9861 3.66415 18.5411 3.57991 18.7373C3.49566 18.9336 3.30358 19.1257 2.91944 19.5098L2.32535 20.1039C1.89155 20.5377 1.89155 21.241 2.32535 21.6748C2.75915 22.1086 3.46247 22.1086 3.89627 21.6748L4.49036 21.0807C4.87451 20.6966 5.06658 20.5045 5.26283 20.4203C5.45909 20.336 6.01406 20.3218 7.12396 20.2934C7.94797 20.2723 8.76565 19.9473 9.39451 19.3184L11.3227 17.3903M14.4291 14.2839L16 12.713M14.4291 14.2839L12.8582 12.713M14.4291 14.2839L11.3227 17.3903M11.3227 17.3903L9.75177 15.8193",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M21.068 7.43213L19.5002 8.99992C18.6718 9.82837 18.6718 11.1715 19.5002 12L12 4.49979C12.8285 5.32824 14.1716 5.32824 15.0001 4.49979L16.5679 2.93201C17.8105 1.68933 19.8253 1.68933 21.068 2.93201C22.3107 4.17468 22.3107 6.18946 21.068 7.43213Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Cancel01Icon.js
var Cancel01Icon = [["path", {
	d: "M18 6L6.00081 17.9992M17.9992 18L6 6.00085",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Copy01Icon.js
var Copy01Icon = [["path", {
	d: "M9 15C9 12.1716 9 10.7574 9.87868 9.87868C10.7574 9 12.1716 9 15 9L16 9C18.8284 9 20.2426 9 21.1213 9.87868C22 10.7574 22 12.1716 22 15V16C22 18.8284 22 20.2426 21.1213 21.1213C20.2426 22 18.8284 22 16 22H15C12.1716 22 10.7574 22 9.87868 21.1213C9 20.2426 9 18.8284 9 16L9 15Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M16.9999 9C16.9975 6.04291 16.9528 4.51121 16.092 3.46243C15.9258 3.25989 15.7401 3.07418 15.5376 2.90796C14.4312 2 12.7875 2 9.5 2C6.21252 2 4.56878 2 3.46243 2.90796C3.25989 3.07417 3.07418 3.25989 2.90796 3.46243C2 4.56878 2 6.21252 2 9.5C2 12.7875 2 14.4312 2.90796 15.5376C3.07417 15.7401 3.25989 15.9258 3.46243 16.092C4.51121 16.9528 6.04291 16.9975 9 16.9999",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Menu01Icon.js
var Menu01Icon = [
	["path", {
		d: "M4 5L20 5",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "0"
	}],
	["path", {
		d: "M4 12L20 12",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "1"
	}],
	["path", {
		d: "M4 19L20 19",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "2"
	}]
];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/CircleIcon.js
var CircleIcon = [["circle", {
	cx: "12",
	cy: "12",
	r: "10",
	stroke: "currentColor",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/ComputerIcon.js
var ComputerIcon = [["path", {
	d: "M14 21H16M14 21C13.1716 21 12.5 20.3284 12.5 19.5V17L12 17M14 21H10M10 21H8M10 21C10.8284 21 11.5 20.3284 11.5 19.5V17L12 17M12 17V21",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M16 3H8C5.17157 3 3.75736 3 2.87868 3.87868C2 4.75736 2 6.17157 2 9V11C2 13.8284 2 15.2426 2.87868 16.1213C3.75736 17 5.17157 17 8 17H16C18.8284 17 20.2426 17 21.1213 16.1213C22 15.2426 22 13.8284 22 11V9C22 6.17157 22 4.75736 21.1213 3.87868C20.2426 3 18.8284 3 16 3Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Sun01Icon.js
var Sun01Icon = [["path", {
	d: "M16.9991 12C16.9991 14.7614 14.7605 17 11.9991 17C9.23766 17 6.99908 14.7614 6.99908 12C6.99908 9.23858 9.23766 7 11.9991 7C14.7605 7 16.9991 9.23858 16.9991 12Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M12.1247 3.25H11.9997M12.1242 20.75H11.9992M20.75 12.125V12M3.25 12.125V12M18.2752 5.90098L18.1868 5.81259M5.90051 18.275L5.81212 18.1866M18.0987 18.2756L18.187 18.1872M5.72429 5.9012L5.81267 5.81282M12.2497 3.25C12.2497 3.38807 12.1378 3.5 11.9997 3.5C11.8616 3.5 11.7497 3.38807 11.7497 3.25C11.7497 3.11193 11.8616 3 11.9997 3C12.1378 3 12.2497 3.11193 12.2497 3.25ZM12.2492 20.75C12.2492 20.8881 12.1373 21 11.9992 21C11.8611 21 11.7492 20.8881 11.7492 20.75C11.7492 20.6119 11.8611 20.5 11.9992 20.5C12.1373 20.5 12.2492 20.6119 12.2492 20.75ZM20.75 12.25C20.6119 12.25 20.5 12.1381 20.5 12C20.5 11.8619 20.6119 11.75 20.75 11.75C20.8881 11.75 21 11.8619 21 12C21 12.1381 20.8881 12.25 20.75 12.25ZM3.25 12.25C3.11193 12.25 3 12.1381 3 12C3 11.8619 3.11193 11.75 3.25 11.75C3.38807 11.75 3.5 11.8619 3.5 12C3.5 12.1381 3.38807 12.25 3.25 12.25ZM18.3636 5.98937C18.266 6.087 18.1077 6.087 18.01 5.98937C17.9124 5.89174 17.9124 5.73345 18.01 5.63582C18.1077 5.53819 18.266 5.53819 18.3636 5.63582C18.4612 5.73345 18.4612 5.89174 18.3636 5.98937ZM5.9889 18.3634C5.89127 18.461 5.73297 18.461 5.63534 18.3634C5.53771 18.2658 5.53771 18.1075 5.63534 18.0099C5.73297 17.9122 5.89127 17.9122 5.9889 18.0099C6.08653 18.1075 6.08653 18.2658 5.9889 18.3634ZM18.0103 18.364C17.9126 18.2663 17.9126 18.108 18.0103 18.0104C18.1079 17.9128 18.2662 17.9128 18.3638 18.0104C18.4614 18.108 18.4614 18.2663 18.3638 18.364C18.2662 18.4616 18.1079 18.4616 18.0103 18.364ZM5.6359 5.98959C5.53827 5.89196 5.53827 5.73367 5.6359 5.63604C5.73353 5.53841 5.89182 5.53841 5.98945 5.63604C6.08708 5.73367 6.08708 5.89196 5.98945 5.98959C5.89182 6.08722 5.73353 6.08722 5.6359 5.98959Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Moon01Icon.js
var Moon01Icon = [
	["path", {
		d: "M21.0985 7.84477C20.458 8.55417 19.5311 9 18.5 9C16.567 9 15 7.433 15 5.5C15 4.46895 15.4458 3.54203 16.1552 2.90149M16.1552 2.90149C18.3384 3.90018 20.0998 5.66155 21.0985 7.84477C21.6774 9.11025 22 10.5174 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C13.4826 2 14.8898 2.32262 16.1552 2.90149Z",
		stroke: "currentColor",
		strokeWidth: "1.5",
		key: "0"
	}],
	["path", {
		d: "M16 16C16 17.1046 15.1046 18 14 18C12.8954 18 12 17.1046 12 16C12 14.8954 12.8954 14 14 14C15.1046 14 16 14.8954 16 16Z",
		stroke: "currentColor",
		strokeWidth: "1.5",
		key: "1"
	}],
	["path", {
		d: "M7.13086 14H7.00586M7.25586 14C7.25586 14.1381 7.14393 14.25 7.00586 14.25C6.86779 14.25 6.75586 14.1381 6.75586 14C6.75586 13.8619 6.86779 13.75 7.00586 13.75C7.14393 13.75 7.25586 13.8619 7.25586 14Z",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "2"
	}],
	["path", {
		d: "M10.1309 8H10.0059M10.2559 8C10.2559 8.13807 10.1439 8.25 10.0059 8.25C9.86779 8.25 9.75586 8.13807 9.75586 8C9.75586 7.86193 9.86779 7.75 10.0059 7.75C10.1439 7.75 10.2559 7.86193 10.2559 8Z",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "3"
	}]
];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/DashboardCircleIcon.js
var DashboardCircleIcon = [
	["path", {
		d: "M21 6.75C21 4.67893 19.3211 3 17.25 3C15.1789 3 13.5 4.67893 13.5 6.75C13.5 8.82107 15.1789 10.5 17.25 10.5C19.3211 10.5 21 8.82107 21 6.75Z",
		stroke: "currentColor",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "0"
	}],
	["path", {
		d: "M10.5 6.75C10.5 4.67893 8.82107 3 6.75 3C4.67893 3 3 4.67893 3 6.75C3 8.82107 4.67893 10.5 6.75 10.5C8.82107 10.5 10.5 8.82107 10.5 6.75Z",
		stroke: "currentColor",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "1"
	}],
	["path", {
		d: "M21 17.25C21 15.1789 19.3211 13.5 17.25 13.5C15.1789 13.5 13.5 15.1789 13.5 17.25C13.5 19.3211 15.1789 21 17.25 21C19.3211 21 21 19.3211 21 17.25Z",
		stroke: "currentColor",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "2"
	}],
	["path", {
		d: "M10.5 17.25C10.5 15.1789 8.82107 13.5 6.75 13.5C4.67893 13.5 3 15.1789 3 17.25C3 19.3211 4.67893 21 6.75 21C8.82107 21 10.5 19.3211 10.5 17.25Z",
		stroke: "currentColor",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "3"
	}]
];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/LibraryIcon.js
var LibraryIcon = [
	["path", {
		d: "M2 7C2 5.59987 2 4.8998 2.27248 4.36502C2.51217 3.89462 2.89462 3.51217 3.36502 3.27248C3.8998 3 4.59987 3 6 3C7.40013 3 8.1002 3 8.63498 3.27248C9.10538 3.51217 9.48783 3.89462 9.72752 4.36502C10 4.8998 10 5.59987 10 7V17C10 18.4001 10 19.1002 9.72752 19.635C9.48783 20.1054 9.10538 20.4878 8.63498 20.7275C8.1002 21 7.40013 21 6 21C4.59987 21 3.8998 21 3.36502 20.7275C2.89462 20.4878 2.51217 20.1054 2.27248 19.635C2 19.1002 2 18.4001 2 17V7Z",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "0"
	}],
	["path", {
		d: "M6.125 17H6M6.25 17C6.25 17.1381 6.13807 17.25 6 17.25C5.86193 17.25 5.75 17.1381 5.75 17C5.75 16.8619 5.86193 16.75 6 16.75C6.13807 16.75 6.25 16.8619 6.25 17Z",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "1"
	}],
	["path", {
		d: "M17.9062 16.6934H17.7812M18.0312 16.6934C18.0312 16.8314 17.9193 16.9434 17.7812 16.9434C17.6432 16.9434 17.5312 16.8314 17.5312 16.6934C17.5312 16.5553 17.6432 16.4434 17.7812 16.4434C17.9193 16.4434 18.0312 16.5553 18.0312 16.6934Z",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "2"
	}],
	["path", {
		d: "M2 7H10",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "3"
	}],
	["path", {
		d: "M11.4486 8.26843C11.0937 6.93838 10.9163 6.27336 11.0385 5.69599C11.146 5.18812 11.4108 4.72747 11.7951 4.38005C12.2319 3.98508 12.8942 3.80689 14.2187 3.4505C15.5432 3.09412 16.2055 2.91593 16.7804 3.03865C17.2862 3.1466 17.7449 3.41256 18.0909 3.79841C18.4842 4.23706 18.6617 4.90209 19.0166 6.23213L21.5514 15.7316C21.9063 17.0616 22.0837 17.7266 21.9615 18.304C21.854 18.8119 21.5892 19.2725 21.2049 19.62C20.7681 20.0149 20.1058 20.1931 18.7813 20.5495C17.4568 20.9059 16.7945 21.0841 16.2196 20.9614C15.7138 20.8534 15.2551 20.5874 14.9091 20.2016C14.5158 19.7629 14.3383 19.0979 13.9834 17.7679L11.4486 8.26843Z",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "4"
	}],
	["path", {
		d: "M12 8.00019L18.5001 6",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "5"
	}]
];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Clock01Icon.js
var Clock01Icon = [["circle", {
	cx: "12",
	cy: "12",
	r: "10",
	stroke: "currentColor",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M12 8V12L14 14",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/StarIcon.js
var StarIcon = [["path", {
	d: "M13.7276 3.44418L15.4874 6.99288C15.7274 7.48687 16.3673 7.9607 16.9073 8.05143L20.0969 8.58575C22.1367 8.92853 22.6167 10.4206 21.1468 11.8925L18.6671 14.3927C18.2471 14.8161 18.0172 15.6327 18.1471 16.2175L18.8571 19.3125C19.417 21.7623 18.1271 22.71 15.9774 21.4296L12.9877 19.6452C12.4478 19.3226 11.5579 19.3226 11.0079 19.6452L8.01827 21.4296C5.8785 22.71 4.57865 21.7522 5.13859 19.3125L5.84851 16.2175C5.97849 15.6327 5.74852 14.8161 5.32856 14.3927L2.84884 11.8925C1.389 10.4206 1.85895 8.92853 3.89872 8.58575L7.08837 8.05143C7.61831 7.9607 8.25824 7.48687 8.49821 6.99288L10.258 3.44418C11.2179 1.51861 12.7777 1.51861 13.7276 3.44418Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Settings01Icon.js
var Settings01Icon = [["path", {
	d: "M21.3175 7.14139L20.8239 6.28479C20.4506 5.63696 20.264 5.31305 19.9464 5.18388C19.6288 5.05472 19.2696 5.15664 18.5513 5.36048L17.3311 5.70418C16.8725 5.80994 16.3913 5.74994 15.9726 5.53479L15.6357 5.34042C15.2766 5.11043 15.0004 4.77133 14.8475 4.37274L14.5136 3.37536C14.294 2.71534 14.1842 2.38533 13.9228 2.19657C13.6615 2.00781 13.3143 2.00781 12.6199 2.00781H11.5051C10.8108 2.00781 10.4636 2.00781 10.2022 2.19657C9.94085 2.38533 9.83106 2.71534 9.61149 3.37536L9.27753 4.37274C9.12465 4.77133 8.84845 5.11043 8.48937 5.34042L8.15249 5.53479C7.73374 5.74994 7.25259 5.80994 6.79398 5.70418L5.57375 5.36048C4.85541 5.15664 4.49625 5.05472 4.17867 5.18388C3.86109 5.31305 3.67445 5.63696 3.30115 6.28479L2.80757 7.14139C2.45766 7.74864 2.2827 8.05227 2.31666 8.37549C2.35061 8.69871 2.58483 8.95918 3.05326 9.48012L4.0843 10.6328C4.3363 10.9518 4.51521 11.5078 4.51521 12.0077C4.51521 12.5078 4.33636 13.0636 4.08433 13.3827L3.05326 14.5354C2.58483 15.0564 2.35062 15.3168 2.31666 15.6401C2.2827 15.9633 2.45766 16.2669 2.80757 16.8741L3.30114 17.7307C3.67443 18.3785 3.86109 18.7025 4.17867 18.8316C4.49625 18.9608 4.85542 18.8589 5.57377 18.655L6.79394 18.3113C7.25263 18.2055 7.73387 18.2656 8.15267 18.4808L8.4895 18.6752C8.84851 18.9052 9.12464 19.2442 9.2775 19.6428L9.61149 20.6403C9.83106 21.3003 9.94085 21.6303 10.2022 21.8191C10.4636 22.0078 10.8108 22.0078 11.5051 22.0078H12.6199C13.3143 22.0078 13.6615 22.0078 13.9228 21.8191C14.1842 21.6303 14.294 21.3003 14.5136 20.6403L14.8476 19.6428C15.0004 19.2442 15.2765 18.9052 15.6356 18.6752L15.9724 18.4808C16.3912 18.2656 16.8724 18.2055 17.3311 18.3113L18.5513 18.655C19.2696 18.8589 19.6288 18.9608 19.9464 18.8316C20.264 18.7025 20.4506 18.3785 20.8239 17.7307L21.3175 16.8741C21.6674 16.2669 21.8423 15.9633 21.8084 15.6401C21.7744 15.3168 21.5402 15.0564 21.0718 14.5354L20.0407 13.3827C19.7887 13.0636 19.6098 12.5078 19.6098 12.0077C19.6098 11.5078 19.7888 10.9518 20.0407 10.6328L21.0718 9.48012C21.5402 8.95918 21.7744 8.69871 21.8084 8.37549C21.8423 8.05227 21.6674 7.74864 21.3175 7.14139Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M15.5195 12C15.5195 13.933 13.9525 15.5 12.0195 15.5C10.0865 15.5 8.51953 13.933 8.51953 12C8.51953 10.067 10.0865 8.5 12.0195 8.5C13.9525 8.5 15.5195 10.067 15.5195 12Z",
	stroke: "currentColor",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/PlusSignIcon.js
var PlusSignIcon = [["path", {
	d: "M12 4V20M20 12H4",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/ArrowLeft01Icon.js
var ArrowLeft01Icon = [["path", {
	d: "M15 6C15 6 9.00001 10.4189 9 12C8.99999 13.5812 15 18 15 18",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/ArrowUp01Icon.js
var ArrowUp01Icon = [["path", {
	d: "M17.9998 15C17.9998 15 13.5809 9.00001 11.9998 9C10.4187 8.99999 5.99985 15 5.99985 15",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Search01Icon.js
var Search01Icon = [["path", {
	d: "M17 17L21 21",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19C15.4183 19 19 15.4183 19 11Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Loading01Icon.js
var Loading01Icon = [["path", {
	d: "M17.2014 2H6.79876C5.341 2 4.06202 2.9847 4.0036 4.40355C3.93009 6.18879 5.18564 7.37422 6.50435 8.4871C8.32861 10.0266 9.24075 10.7964 9.33642 11.7708C9.35139 11.9233 9.35139 12.0767 9.33642 12.2292C9.24075 13.2036 8.32862 13.9734 6.50435 15.5129C5.14932 16.6564 3.9263 17.7195 4.0036 19.5964C4.06202 21.0153 5.341 22 6.79876 22L17.2014 22C18.6591 22 19.9381 21.0153 19.9965 19.5964C20.043 18.4668 19.6244 17.342 18.7352 16.56C18.3298 16.2034 17.9089 15.8615 17.4958 15.5129C15.6715 13.9734 14.7594 13.2036 14.6637 12.2292C14.6487 12.0767 14.6487 11.9233 14.6637 11.7708C14.7594 10.7964 15.6715 10.0266 17.4958 8.4871C18.8366 7.35558 20.0729 6.25809 19.9965 4.40355C19.9381 2.9847 18.6591 2 17.2014 2Z",
	stroke: "currentColor",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M9 21.6381C9 21.1962 9 20.9752 9.0876 20.7821C9.10151 20.7514 9.11699 20.7214 9.13399 20.6923C9.24101 20.509 9.42211 20.3796 9.78432 20.1208C10.7905 19.4021 11.2935 19.0427 11.8652 19.0045C11.955 18.9985 12.045 18.9985 12.1348 19.0045C12.7065 19.0427 13.2095 19.4021 14.2157 20.1208C14.5779 20.3796 14.759 20.509 14.866 20.6923C14.883 20.7214 14.8985 20.7514 14.9124 20.7821C15 20.9752 15 21.1962 15 21.6381V22H9V21.6381Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/UserGroupIcon.js
var UserGroupIcon = [
	["path", {
		d: "M15.5 11C15.5 9.067 13.933 7.5 12 7.5C10.067 7.5 8.5 9.067 8.5 11C8.5 12.933 10.067 14.5 12 14.5C13.933 14.5 15.5 12.933 15.5 11Z",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "0"
	}],
	["path", {
		d: "M15.4827 11.3499C15.8047 11.4475 16.1462 11.5 16.5 11.5C18.433 11.5 20 9.933 20 8C20 6.067 18.433 4.5 16.5 4.5C14.6851 4.5 13.1928 5.8814 13.0173 7.65013",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "1"
	}],
	["path", {
		d: "M10.9827 7.65013C10.8072 5.8814 9.31492 4.5 7.5 4.5C5.567 4.5 4 6.067 4 8C4 9.933 5.567 11.5 7.5 11.5C7.85381 11.5 8.19535 11.4475 8.51727 11.3499",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "2"
	}],
	["path", {
		d: "M22 16.5C22 13.7386 19.5376 11.5 16.5 11.5",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "3"
	}],
	["path", {
		d: "M17.5 19.5C17.5 16.7386 15.0376 14.5 12 14.5C8.96243 14.5 6.5 16.7386 6.5 19.5",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "4"
	}],
	["path", {
		d: "M7.5 11.5C4.46243 11.5 2 13.7386 2 16.5",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "5"
	}]
];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/LockIcon.js
var LockIcon = [["path", {
	d: "M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z",
	stroke: "currentColor",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M12 13C13.1046 13 14 12.1046 14 11C14 9.89543 13.1046 9 12 9C10.8954 9 10 9.89543 10 11C10 12.1046 10.8954 13 12 13ZM12 13L12 16",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Mail01Icon.js
var Mail01Icon = [["path", {
	d: "M2 6L8.91302 9.91697C11.4616 11.361 12.5384 11.361 15.087 9.91697L22 6",
	stroke: "currentColor",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M2.01577 13.4756C2.08114 16.5412 2.11383 18.0739 3.24496 19.2094C4.37608 20.3448 5.95033 20.3843 9.09883 20.4634C11.0393 20.5122 12.9607 20.5122 14.9012 20.4634C18.0497 20.3843 19.6239 20.3448 20.7551 19.2094C21.8862 18.0739 21.9189 16.5412 21.9842 13.4756C22.0053 12.4899 22.0053 11.5101 21.9842 10.5244C21.9189 7.45886 21.8862 5.92609 20.7551 4.79066C19.6239 3.65523 18.0497 3.61568 14.9012 3.53657C12.9607 3.48781 11.0393 3.48781 9.09882 3.53656C5.95033 3.61566 4.37608 3.65521 3.24495 4.79065C2.11382 5.92608 2.08114 7.45885 2.01576 10.5244C1.99474 11.5101 1.99475 12.4899 2.01577 13.4756Z",
	stroke: "currentColor",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Notification01Icon.js
var Notification01Icon = [["path", {
	d: "M15.5 18C15.5 19.933 13.933 21.5 12 21.5C10.067 21.5 8.5 19.933 8.5 18",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M19.2311 18H4.76887C3.79195 18 3 17.208 3 16.2311C3 15.762 3.18636 15.3121 3.51809 14.9803L4.12132 14.3771C4.68393 13.8145 5 13.0514 5 12.2558V9.5C5 5.63401 8.13401 2.5 12 2.5C15.866 2.5 19 5.634 19 9.5V12.2558C19 13.0514 19.3161 13.8145 19.8787 14.3771L20.4819 14.9803C20.8136 15.3121 21 15.762 21 16.2311C21 17.208 20.208 18 19.2311 18Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Shield01Icon.js
var Shield01Icon = [["path", {
	d: "M18.7088 3.49534C16.8165 2.55382 14.5009 2 12 2C9.4991 2 7.1835 2.55382 5.29116 3.49534C4.36318 3.95706 3.89919 4.18792 3.4496 4.91378C3 5.63965 3 6.34248 3 7.74814V11.2371C3 16.9205 7.54236 20.0804 10.173 21.4338C10.9067 21.8113 11.2735 22 12 22C12.7265 22 13.0933 21.8113 13.8269 21.4338C16.4576 20.0804 21 16.9205 21 11.2371L21 7.74814C21 6.34249 21 5.63966 20.5504 4.91378C20.1008 4.18791 19.6368 3.95706 18.7088 3.49534Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/PaintBrush01Icon.js
var PaintBrush01Icon = [["path", {
	d: "M3.89089 20.8727L3 21L3.12727 20.1091C3.32086 18.754 3.41765 18.0764 3.71832 17.4751C4.01899 16.8738 4.50296 16.3898 5.47091 15.4218L16.9827 3.91009C17.4062 3.48654 17.618 3.27476 17.8464 3.16155C18.2811 2.94615 18.7914 2.94615 19.2261 3.16155C19.4546 3.27476 19.6663 3.48654 20.0899 3.91009C20.5135 4.33365 20.7252 4.54543 20.8385 4.77389C21.0539 5.20856 21.0539 5.71889 20.8385 6.15356C20.7252 6.38201 20.5135 6.59379 20.0899 7.01735L8.57816 18.5291C7.61022 19.497 7.12625 19.981 6.52491 20.2817C5.92357 20.5823 5.246 20.6791 3.89089 20.8727Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M6 15L9 18M8.5 12.5L11.5 15.5",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/BulbIcon.js
var BulbIcon = [
	["path", {
		d: "M5.14286 14C4.41735 12.8082 4 11.4118 4 9.91886C4 5.54539 7.58172 2 12 2C16.4183 2 20 5.54539 20 9.91886C20 11.4118 19.5827 12.8082 18.8571 14",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeWidth: "1.5",
		key: "0"
	}],
	["path", {
		d: "M14 10C13.3875 10.6432 12.7111 11 12 11C11.2889 11 10.6125 10.6432 10 10",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeWidth: "1.5",
		key: "1"
	}],
	["path", {
		d: "M7.38287 17.0982C7.291 16.8216 7.24507 16.6833 7.25042 16.5713C7.26174 16.3343 7.41114 16.1262 7.63157 16.0405C7.73579 16 7.88105 16 8.17157 16H15.8284C16.119 16 16.2642 16 16.3684 16.0405C16.5889 16.1262 16.7383 16.3343 16.7496 16.5713C16.7549 16.6833 16.709 16.8216 16.6171 17.0982C16.4473 17.6094 16.3624 17.8651 16.2315 18.072C15.9572 18.5056 15.5272 18.8167 15.0306 18.9408C14.7935 19 14.525 19 13.9881 19H10.0119C9.47495 19 9.2065 19 8.96944 18.9408C8.47283 18.8167 8.04281 18.5056 7.7685 18.072C7.63755 17.8651 7.55266 17.6094 7.38287 17.0982Z",
		stroke: "currentColor",
		strokeWidth: "1.5",
		key: "2"
	}],
	["path", {
		d: "M15 19L14.8707 19.6466C14.7293 20.3537 14.6586 20.7072 14.5001 20.9866C14.2552 21.4185 13.8582 21.7439 13.3866 21.8994C13.0816 22 12.7211 22 12 22C11.2789 22 10.9184 22 10.6134 21.8994C10.1418 21.7439 9.74484 21.4185 9.49987 20.9866C9.34144 20.7072 9.27073 20.3537 9.12932 19.6466L9 19",
		stroke: "currentColor",
		strokeWidth: "1.5",
		key: "3"
	}],
	["path", {
		d: "M12 15.5V11",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "4"
	}]
];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Rocket01Icon.js
var Rocket01Icon = [
	["path", {
		d: "M11.8013 6.48949L13.2869 5.00392C14.9596 3.3312 17.1495 2.63737 19.4671 2.52399C20.3686 2.47989 20.8193 2.45784 21.1807 2.81928C21.5422 3.18071 21.5201 3.63143 21.476 4.53289C21.3626 6.8505 20.6688 9.04042 18.9961 10.7131L17.5105 12.1987C16.2871 13.4221 15.9393 13.77 16.1961 15.097C16.4496 16.1107 16.6949 17.0923 15.9578 17.8294C15.0637 18.7235 14.2481 18.7235 13.354 17.8294L6.17058 10.646C5.27649 9.75188 5.27646 8.9363 6.17058 8.04219C6.90767 7.30509 7.88929 7.55044 8.90297 7.80389C10.23 8.06073 10.5779 7.71289 11.8013 6.48949Z",
		stroke: "currentColor",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "0"
	}],
	["path", {
		d: "M2.5 21.5L7.5 16.5",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeWidth: "1.5",
		key: "1"
	}],
	["path", {
		d: "M8.5 21.5L10.5 19.5",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeWidth: "1.5",
		key: "2"
	}],
	["path", {
		d: "M2.5 15.5L4.5 13.5",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeWidth: "1.5",
		key: "3"
	}],
	["path", {
		d: "M17.125 7H17M17.25 7C17.25 7.13807 17.1381 7.25 17 7.25C16.8619 7.25 16.75 7.13807 16.75 7C16.75 6.86193 16.8619 6.75 17 6.75C17.1381 6.75 17.25 6.86193 17.25 7Z",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "4"
	}]
];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/FavouriteIcon.js
var FavouriteIcon = [["path", {
	d: "M10.4107 19.9677C7.58942 17.858 2 13.0348 2 8.69444C2 5.82563 4.10526 3.5 7 3.5C8.5 3.5 10 4 12 6C14 4 15.5 3.5 17 3.5C19.8947 3.5 22 5.82563 22 8.69444C22 13.0348 16.4106 17.858 13.5893 19.9677C12.6399 20.6776 11.3601 20.6776 10.4107 19.9677Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/PaintBrush02Icon.js
var PaintBrush02Icon = [
	["path", {
		d: "M4 5C4 4.25579 4 3.88369 4.08912 3.58019C4.30005 2.86183 4.86183 2.30005 5.58019 2.08912C5.88369 2 6.25579 2 7 2H14C14.7442 2 15.1163 2 15.4198 2.08912C16.1382 2.30005 16.7 2.86183 16.9109 3.58019C17 3.88369 17 4.25579 17 5C17 5.74421 17 6.11631 16.9109 6.41981C16.7 7.13817 16.1382 7.69995 15.4198 7.91088C15.1163 8 14.7442 8 14 8H7C6.25579 8 5.88369 8 5.58019 7.91088C4.86183 7.69995 4.30005 7.13817 4.08912 6.41981C4 6.11631 4 5.74421 4 5Z",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeWidth: "1.5",
		key: "0"
	}],
	["path", {
		d: "M12 17.5C12 17.0341 12 16.8011 12.0761 16.6173C12.1776 16.3723 12.3723 16.1776 12.6173 16.0761C12.8011 16 13.0341 16 13.5 16C13.9659 16 14.1989 16 14.3827 16.0761C14.6277 16.1776 14.8224 16.3723 14.9239 16.6173C15 16.8011 15 17.0341 15 17.5V20.5C15 20.9659 15 21.1989 14.9239 21.3827C14.8224 21.6277 14.6277 21.8224 14.3827 21.9239C14.1989 22 13.9659 22 13.5 22C13.0341 22 12.8011 22 12.6173 21.9239C12.3723 21.8224 12.1776 21.6277 12.0761 21.3827C12 21.1989 12 20.9659 12 20.5V17.5Z",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeWidth: "1.5",
		key: "1"
	}],
	["path", {
		d: "M17.249 5C18.1037 5 18.531 5 18.8681 5.15224C19.9978 5.6624 20.0005 6.86278 20.0005 8.00422C20.0005 8.96065 20.0005 9.43886 19.8701 9.84219C19.4513 11.1378 17.7387 11.768 16.0836 12.2373C14.9006 12.5727 14.3091 12.7404 13.9045 13.2756C13.5 13.8107 13.5 14.4389 13.5 15.6952V16",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "2"
	}]
];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/BrainIcon.js
var BrainIcon = [["path", {
	d: "M16.998 7.12652C17.3182 7.04393 17.654 7 18 7C20.2091 7 22 8.79086 22 11C22 13.2091 20.2091 15 18 15C17.6451 15 17.3009 14.9538 16.9733 14.867M16.998 7.12652C16.9993 7.08451 17 7.04233 17 7C17 4.79086 15.2091 3 13 3C11.0824 3 9.47994 4.34939 9.09041 6.15043M16.998 7.12652C16.9769 7.80763 16.7854 8.44584 16.4649 9M16.9733 14.867C16.9909 14.7472 17 14.6247 17 14.5C17 13.2905 16.1411 12.2816 15 12.05M16.9733 14.867C16.7957 16.0737 15.756 17 14.5 17H14C11.7909 17 10 18.7909 10 21M9.09041 6.15043C8.74377 6.05243 8.37801 6 8 6C5.79086 6 4 7.79086 4 10C4 10.3886 4.05542 10.7643 4.15878 11.1195M9.09041 6.15043C10.1015 6.43625 10.9498 7.10965 11.4649 8M4.15878 11.1195C2.9114 11.4832 2 12.6352 2 14C2 15.6569 3.34315 17 5 17C6.30622 17 7.41746 16.1652 7.82929 15M4.15878 11.1195C4.24921 11.4303 4.37632 11.7255 4.53513 12",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M11.8361 11.7435C11.3257 12.2353 10.453 12.3202 9.70713 11.9008C8.9612 11.4814 8.58031 10.6917 8.73535 10",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/GlobeIcon.js
var GlobeIcon = [
	["path", {
		d: "M12.5 19L12.5 22",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "0"
	}],
	["path", {
		d: "M10.5 22H14.5",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "1"
	}],
	["circle", {
		cx: "7",
		cy: "7",
		r: "7",
		transform: "matrix(-1 0 0 1 20.5 2)",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeWidth: "1.5",
		key: "2"
	}],
	["path", {
		d: "M8.5 4C9.15431 4.0385 9.49236 4.35899 10.0735 4.97301C11.1231 6.08206 12.1727 6.1746 12.8724 5.80492C13.922 5.2504 13.04 4.35221 14.2719 3.86409C15.0748 3.54595 15.1868 2.68026 14.7399 2",
		stroke: "currentColor",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "3"
	}],
	["path", {
		d: "M20 10C18.5 10 18.2338 11.2468 17 11C14.5 10.5 13.7916 11.0589 13.7916 12.2511C13.7916 13.4432 13.7916 13.4432 13.2717 14.3373C12.9335 14.9189 12.8153 15.5004 13.4894 16",
		stroke: "currentColor",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "4"
	}],
	["path", {
		d: "M6.5 2C4.64864 3.79995 3.5 6.3082 3.5 9.08251C3.5 14.5598 7.97715 19 13.5 19C16.2255 19 18.6962 17.9187 20.5 16.165",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeWidth: "1.5",
		key: "5"
	}]
];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/UserIcon.js
var UserIcon = [["path", {
	d: "M17 8.5C17 5.73858 14.7614 3.5 12 3.5C9.23858 3.5 7 5.73858 7 8.5C7 11.2614 9.23858 13.5 12 13.5C14.7614 13.5 17 11.2614 17 8.5Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M19 20.5C19 16.634 15.866 13.5 12 13.5C8.13401 13.5 5 16.634 5 20.5",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Image01Icon.js
var Image01Icon = [
	["circle", {
		cx: "7.5",
		cy: "7.5",
		r: "1.5",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "0"
	}],
	["path", {
		d: "M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z",
		stroke: "currentColor",
		strokeWidth: "1.5",
		key: "1"
	}],
	["path", {
		d: "M5 21C9.37246 15.775 14.2741 8.88406 21.4975 13.5424",
		stroke: "currentColor",
		strokeWidth: "1.5",
		key: "2"
	}]
];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Link01Icon.js
var Link01Icon = [["path", {
	d: "M9.14339 10.691L9.35031 10.4841C11.329 8.50532 14.5372 8.50532 16.5159 10.4841C18.4947 12.4628 18.4947 15.671 16.5159 17.6497L13.6497 20.5159C11.671 22.4947 8.46279 22.4947 6.48405 20.5159C4.50532 18.5372 4.50532 15.329 6.48405 13.3503L6.9484 12.886",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M17.0516 11.114L17.5159 10.6497C19.4947 8.67095 19.4947 5.46279 17.5159 3.48405C15.5372 1.50532 12.329 1.50532 10.3503 3.48405L7.48405 6.35031C5.50532 8.32904 5.50532 11.5372 7.48405 13.5159C9.46279 15.4947 12.671 15.4947 14.6497 13.5159L14.8566 13.309",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Tick02Icon.js
var Tick02Icon = [["path", {
	d: "M5 14L8.5 17.5L19 6.5",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/ArrowReloadHorizontalIcon.js
var ArrowReloadHorizontalIcon = [
	["path", {
		d: "M20.5 5.5H9.5C5.78672 5.5 3 8.18503 3 12",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "0"
	}],
	["path", {
		d: "M3.5 18.5H14.5C18.2133 18.5 21 15.815 21 12",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "1"
	}],
	["path", {
		d: "M18.5 3C18.5 3 21 4.84122 21 5.50002C21 6.15882 18.5 8 18.5 8",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "2"
	}],
	["path", {
		d: "M5.49998 16C5.49998 16 3.00001 17.8412 3 18.5C2.99999 19.1588 5.5 21 5.5 21",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: "1.5",
		key: "3"
	}]
];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/Home01Icon.js
var Home01Icon = [["path", {
	d: "M3 11.9896V14.5C3 17.7998 3 19.4497 4.02513 20.4749C5.05025 21.5 6.70017 21.5 10 21.5H14C17.2998 21.5 18.9497 21.5 19.9749 20.4749C21 19.4497 21 17.7998 21 14.5V11.9896C21 10.3083 21 9.46773 20.6441 8.74005C20.2882 8.01237 19.6247 7.49628 18.2976 6.46411L16.2976 4.90855C14.2331 3.30285 13.2009 2.5 12 2.5C10.7991 2.5 9.76689 3.30285 7.70242 4.90855L5.70241 6.46411C4.37533 7.49628 3.71179 8.01237 3.3559 8.74005C3 9.46773 3 10.3083 3 11.9896Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M15.0002 17C14.2007 17.6224 13.1504 18 12.0002 18C10.8499 18 9.79971 17.6224 9.00018 17",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/BubbleChatIcon.js
var BubbleChatIcon = [["path", {
	d: "M21.5 12C21.5 17.2467 17.2467 21.5 12 21.5C10.3719 21.5 8.8394 21.0904 7.5 20.3687C5.63177 19.362 4.37462 20.2979 3.26592 20.4658C3.09774 20.4913 2.93024 20.4302 2.80997 20.31C2.62741 20.1274 2.59266 19.8451 2.6935 19.6074C3.12865 18.5818 3.5282 16.6382 2.98341 15C2.6698 14.057 2.5 13.0483 2.5 12C2.5 6.75329 6.75329 2.5 12 2.5C17.2467 2.5 21.5 6.75329 21.5 12Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M12.1257 12H12.0007M8.125 12H8M16.125 12H16M12.2507 12C12.2507 12.1381 12.1388 12.25 12.0007 12.25C11.8627 12.25 11.7507 12.1381 11.7507 12C11.7507 11.8619 11.8627 11.75 12.0007 11.75C12.1388 11.75 12.2507 11.8619 12.2507 12ZM8.25 12C8.25 12.1381 8.13807 12.25 8 12.25C7.86193 12.25 7.75 12.1381 7.75 12C7.75 11.8619 7.86193 11.75 8 11.75C8.13807 11.75 8.25 11.8619 8.25 12ZM16.25 12C16.25 12.1381 16.1381 12.25 16 12.25C15.8619 12.25 15.75 12.1381 15.75 12C15.75 11.8619 15.8619 11.75 16 11.75C16.1381 11.75 16.25 11.8619 16.25 12Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/InboxIcon.js
var InboxIcon = [["path", {
	d: "M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M21.5 13.5H16.5743C15.7322 13.5 15.0706 14.2036 14.6995 14.9472C14.2963 15.7551 13.4889 16.5 12 16.5C10.5111 16.5 9.70373 15.7551 9.30054 14.9472C8.92942 14.2036 8.26777 13.5 7.42566 13.5H2.5",
	stroke: "currentColor",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/PencilEdit01Icon.js
var PencilEdit01Icon = [["path", {
	d: "M15.2141 5.98239L16.6158 4.58063C17.39 3.80646 18.6452 3.80646 19.4194 4.58063C20.1935 5.3548 20.1935 6.60998 19.4194 7.38415L18.0176 8.78591M15.2141 5.98239L6.98023 14.2163C5.93493 15.2616 5.41226 15.7842 5.05637 16.4211C4.70047 17.058 4.3424 18.5619 4 20C5.43809 19.6576 6.94199 19.2995 7.57889 18.9436C8.21579 18.5877 8.73844 18.0651 9.78375 17.0198L18.0176 8.78591M15.2141 5.98239L18.0176 8.78591",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M11 20H17",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/NextIcon.js
var NextIcon = [["path", {
	d: "M15.9351 12.6258C15.6807 13.8374 14.327 14.7077 11.6198 16.4481C8.67528 18.3411 7.20303 19.2876 6.01052 18.9229C5.60662 18.7994 5.23463 18.5823 4.92227 18.2876C4 17.4178 4 15.6118 4 12C4 8.38816 4 6.58224 4.92227 5.71235C5.23463 5.41773 5.60662 5.20057 6.01052 5.07707C7.20304 4.71243 8.67528 5.6589 11.6198 7.55186C14.327 9.29233 15.6807 10.1626 15.9351 11.3742C16.0216 11.7865 16.0216 12.2135 15.9351 12.6258Z",
	stroke: "currentColor",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M20 5V19",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region node_modules/@hugeicons/core-free-icons/dist/esm/ArrowMoveDownRightIcon.js
var ArrowMoveDownRightIcon = [["path", {
	d: "M4 3V5.07692C4 7.07786 4 8.07833 4.14533 8.91545C4.94529 13.5235 8.90656 17.1376 13.9574 17.8674C14.8749 18 16.8068 18 19 18",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "0"
}], ["path", {
	d: "M17 21C17.6068 20.4102 20 18.8403 20 18C20 17.1597 17.6068 15.5898 17 15",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	strokeWidth: "1.5",
	key: "1"
}]];
//#endregion
//#region @/lib/icon-map.tsx
function tabler(Icon) {
	return function TablerAdapter({ size, strokeWidth, className }) {
		return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
			size,
			stroke: strokeWidth,
			className
		});
	};
}
function phosphor(Icon) {
	return function PhosphorAdapter({ size, strokeWidth, className }) {
		return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
			size,
			weight: strokeWidth != null && strokeWidth >= 1.75 ? "regular" : "light",
			className
		});
	};
}
function hugeicons(iconDef) {
	return function HugeIconsAdapter({ size, strokeWidth, className }) {
		return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HugeiconsIcon, {
			icon: iconDef,
			size,
			strokeWidth,
			className
		});
	};
}
var iconMap = {
	lucide: {
		"chevron-right": ChevronRight,
		"chevron-down": ChevronDown,
		"pipette": Pipette,
		"x": X,
		"copy": Copy,
		"menu": Menu,
		"dot": Dot,
		"monitor": Monitor,
		"sun": Sun,
		"moon": Moon,
		"rectangle-horizontal": RectangleHorizontal,
		"circle": Circle,
		"square-library": SquareLibrary,
		"clock": Clock,
		"star": Star,
		"settings": Settings,
		"plus": Plus,
		"arrow-left": ArrowLeft,
		"arrow-right": ArrowRight,
		"arrow-up": ArrowUp,
		"search": Search,
		"loader": Loader,
		"users": Users,
		"lock": Lock,
		"mail": Mail,
		"bell": Bell,
		"shield": Shield,
		"palette": Palette,
		"lightbulb": Lightbulb,
		"rocket": Rocket,
		"heart": Heart,
		"paintbrush": Paintbrush,
		"brain": Brain,
		"globe": Globe,
		"user": User,
		"image": Image,
		"link": Link,
		"check": Check,
		"rotate-ccw": RotateCcw,
		"play": Play,
		"pause": Pause,
		"home": House,
		"message-circle": MessageCircle,
		"inbox": Inbox,
		"pencil": Pencil,
		"skip-forward": SkipForward,
		"corner-down-right": CornerDownRight
	},
	tabler: {
		"chevron-right": tabler(IconChevronRight),
		"chevron-down": tabler(IconChevronDown),
		"pipette": tabler(IconColorPicker),
		"x": tabler(IconX),
		"copy": tabler(IconCopy),
		"menu": tabler(IconMenu2),
		"dot": tabler(IconPoint),
		"monitor": tabler(IconDeviceDesktop),
		"sun": tabler(IconSun),
		"moon": tabler(IconMoon),
		"rectangle-horizontal": tabler(IconSquare),
		"circle": tabler(IconCircle),
		"square-library": tabler(IconLibrary),
		"clock": tabler(IconClock),
		"star": tabler(IconStar),
		"settings": tabler(IconSettings),
		"plus": tabler(IconPlus),
		"arrow-left": tabler(IconArrowLeft),
		"arrow-right": tabler(IconArrowRight),
		"arrow-up": tabler(IconArrowUp),
		"search": tabler(IconSearch),
		"loader": tabler(IconLoader2),
		"users": tabler(IconUsers),
		"lock": tabler(IconLock),
		"mail": tabler(IconMail),
		"bell": tabler(IconBell),
		"shield": tabler(IconShield),
		"palette": tabler(IconPalette),
		"lightbulb": tabler(IconBulb),
		"rocket": tabler(IconRocket),
		"heart": tabler(IconHeart),
		"paintbrush": tabler(IconBrush),
		"brain": tabler(IconBrain),
		"globe": tabler(IconGlobe),
		"user": tabler(IconUser),
		"image": tabler(IconPhoto),
		"link": tabler(IconLink),
		"check": tabler(IconCheck),
		"rotate-ccw": tabler(IconRotate2),
		"play": tabler(IconPlayerPlay),
		"pause": tabler(IconPlayerPause),
		"home": tabler(IconHome),
		"message-circle": tabler(IconMessageCircle),
		"inbox": tabler(IconInbox),
		"pencil": tabler(IconPencil),
		"skip-forward": tabler(IconPlayerSkipForward),
		"corner-down-right": tabler(IconCornerDownRight)
	},
	phosphor: {
		"chevron-right": phosphor(s$9),
		"chevron-down": phosphor(s$10),
		"pipette": phosphor(s$5),
		"x": phosphor(n),
		"copy": phosphor(s$6),
		"menu": phosphor(c$3),
		"dot": phosphor(c$6),
		"monitor": phosphor(c$1),
		"sun": phosphor(s),
		"moon": phosphor(s$3),
		"rectangle-horizontal": phosphor(s$2),
		"circle": phosphor(s$7),
		"square-library": phosphor(n$17),
		"clock": phosphor(n$15),
		"star": phosphor(n$4),
		"settings": phosphor(n$14),
		"plus": phosphor(n$6),
		"arrow-left": phosphor(s$14),
		"arrow-right": phosphor(s$13),
		"arrow-up": phosphor(s$12),
		"search": phosphor(f),
		"loader": phosphor(p),
		"users": phosphor(n$1),
		"lock": phosphor(n$10),
		"mail": phosphor(c$5),
		"bell": phosphor(s$11),
		"shield": phosphor(s$1),
		"palette": phosphor(n$9),
		"lightbulb": phosphor(s$4),
		"rocket": phosphor(n$5),
		"heart": phosphor(n$12),
		"paintbrush": phosphor(m$1),
		"brain": phosphor(c$8),
		"globe": phosphor(n$13),
		"user": phosphor(n$2),
		"image": phosphor(I),
		"link": phosphor(c$4),
		"check": phosphor(n$16),
		"rotate-ccw": phosphor(i),
		"play": phosphor(n$7),
		"pause": phosphor(n$8),
		"home": phosphor(n$11),
		"message-circle": phosphor(s$8),
		"inbox": phosphor(n$3),
		"pencil": phosphor(m),
		"skip-forward": phosphor(c),
		"corner-down-right": phosphor(m$2)
	},
	hugeicons: {
		"chevron-right": hugeicons(ArrowRight01Icon),
		"chevron-down": hugeicons(ArrowDown01Icon),
		"pipette": hugeicons(DropperIcon),
		"x": hugeicons(Cancel01Icon),
		"copy": hugeicons(Copy01Icon),
		"menu": hugeicons(Menu01Icon),
		"dot": hugeicons(CircleIcon),
		"monitor": hugeicons(ComputerIcon),
		"sun": hugeicons(Sun01Icon),
		"moon": hugeicons(Moon01Icon),
		"rectangle-horizontal": hugeicons(DashboardCircleIcon),
		"circle": hugeicons(CircleIcon),
		"square-library": hugeicons(LibraryIcon),
		"clock": hugeicons(Clock01Icon),
		"star": hugeicons(StarIcon),
		"settings": hugeicons(Settings01Icon),
		"plus": hugeicons(PlusSignIcon),
		"arrow-left": hugeicons(ArrowLeft01Icon),
		"arrow-right": hugeicons(ArrowRight01Icon),
		"arrow-up": hugeicons(ArrowUp01Icon),
		"search": hugeicons(Search01Icon),
		"loader": hugeicons(Loading01Icon),
		"users": hugeicons(UserGroupIcon),
		"lock": hugeicons(LockIcon),
		"mail": hugeicons(Mail01Icon),
		"bell": hugeicons(Notification01Icon),
		"shield": hugeicons(Shield01Icon),
		"palette": hugeicons(PaintBrush01Icon),
		"lightbulb": hugeicons(BulbIcon),
		"rocket": hugeicons(Rocket01Icon),
		"heart": hugeicons(FavouriteIcon),
		"paintbrush": hugeicons(PaintBrush02Icon),
		"brain": hugeicons(BrainIcon),
		"globe": hugeicons(GlobeIcon),
		"user": hugeicons(UserIcon),
		"image": hugeicons(Image01Icon),
		"link": hugeicons(Link01Icon),
		"check": hugeicons(Tick02Icon),
		"rotate-ccw": hugeicons(ArrowReloadHorizontalIcon),
		"play": Play,
		"pause": Pause,
		"home": hugeicons(Home01Icon),
		"message-circle": hugeicons(BubbleChatIcon),
		"inbox": hugeicons(InboxIcon),
		"pencil": hugeicons(PencilEdit01Icon),
		"skip-forward": hugeicons(NextIcon),
		"corner-down-right": hugeicons(ArrowMoveDownRightIcon)
	}
};
//#endregion
//#region @/lib/icon-context.tsx
var IconContext = (0, import_react.createContext)(null);
/**
* Returns a single icon component for the given name.
* Falls back to Lucide if no provider is present.
*/
function useIcon(name) {
	const ctx = (0, import_react.useContext)(IconContext);
	if (!ctx) return iconMap.lucide[name];
	return iconMap[ctx.iconLibrary][name];
}
//#endregion
//#region \0vite/preload-helper.js
var scriptRel = /* @__PURE__ */ function detectScriptRel() {
	const relList = typeof document < "u" && document.createElement("link").relList;
	return relList && relList.supports && relList.supports("modulepreload") ? "modulepreload" : "preload";
}();
var assetsURL = function(dep, importerUrl) {
	return new URL(dep, importerUrl).href;
};
var seen = {};
var __vitePreload = function preload(baseModule, deps, importerUrl) {
	let promise = Promise.resolve();
	if (deps && deps.length > 0) {
		let allSettled = function(promises) {
			return Promise.all(promises.map((p) => Promise.resolve(p).then((value) => ({
				status: "fulfilled",
				value
			}), (reason) => ({
				status: "rejected",
				reason
			}))));
		};
		const links = document.getElementsByTagName("link"), cspNonceMeta = document.querySelector("meta[property=csp-nonce]"), cspNonce = cspNonceMeta?.nonce || cspNonceMeta?.getAttribute("nonce");
		promise = allSettled(deps.map((dep) => {
			dep = assetsURL(dep, importerUrl);
			if (dep in seen) return;
			seen[dep] = !0;
			const isCss = dep.endsWith(".css"), cssSelector = isCss ? "[rel=\"stylesheet\"]" : "";
			if (importerUrl) for (let i = links.length - 1; i >= 0; i--) {
				const link = links[i];
				if (link.href === dep && (!isCss || link.rel === "stylesheet")) return;
			}
			else if (document.querySelector(`link[href="${dep}"]${cssSelector}`)) return;
			const link = document.createElement("link");
			link.rel = isCss ? "stylesheet" : scriptRel;
			if (!isCss) link.as = "script";
			link.crossOrigin = "";
			link.href = dep;
			if (cspNonce) link.setAttribute("nonce", cspNonce);
			document.head.appendChild(link);
			if (isCss) return new Promise((res, rej) => {
				link.addEventListener("load", res);
				link.addEventListener("error", () => rej(Error(`Unable to preload CSS for ${dep}`)));
			});
		}));
	}
	function handlePreloadError(err) {
		const e = new Event("vite:preloadError", { cancelable: !0 });
		e.payload = err;
		window.dispatchEvent(e);
		if (!e.defaultPrevented) throw err;
	}
	return promise.then((res) => {
		for (const item of res || []) {
			if (item.status !== "rejected") continue;
			handlePreloadError(item.reason);
		}
		return baseModule().catch(handlePreloadError);
	});
};
//#endregion
//#region @/components/ui/file-thumbnail.tsx
var pdfjsPromise = null;
async function loadPdfjs() {
	if (!pdfjsPromise) pdfjsPromise = __vitePreload(() => import("./pdf-CvgNq6y_.js").then((mod) => {
		if (!mod.GlobalWorkerOptions.workerSrc) mod.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${mod.version}/build/pdf.worker.min.mjs`;
		return mod;
	}), [], import.meta.url);
	return pdfjsPromise;
}
async function renderPdfFirstPage(file, targetWidth) {
	const pdfjs = await loadPdfjs();
	const buffer = await file.arrayBuffer();
	const page = await (await pdfjs.getDocument({ data: buffer }).promise).getPage(1);
	const baseViewport = page.getViewport({ scale: 1 });
	const scale = targetWidth * 2 / baseViewport.width;
	const viewport = page.getViewport({ scale });
	const canvas = document.createElement("canvas");
	canvas.width = viewport.width;
	canvas.height = viewport.height;
	await page.render({
		canvas,
		viewport
	}).promise;
	return canvas.toDataURL("image/png");
}
function FileThumbnail(t0) {
	const $ = (0, import_compiler_runtime.c)(23);
	const { file, size, className } = t0;
	const shape = useShape();
	let t1;
	if ($[0] !== file.type) {
		t1 = file.type.startsWith("image/");
		$[0] = file.type;
		$[1] = t1;
	} else t1 = $[1];
	const isImage = t1;
	const isPdf = file.type === "application/pdf";
	const [imageUrl, setImageUrl] = (0, import_react.useState)(null);
	let t2;
	let t3;
	if ($[2] !== file || $[3] !== isImage) {
		t2 = () => {
			if (!isImage) return;
			const url = URL.createObjectURL(file);
			setImageUrl(url);
			return () => URL.revokeObjectURL(url);
		};
		t3 = [isImage, file];
		$[2] = file;
		$[3] = isImage;
		$[4] = t2;
		$[5] = t3;
	} else {
		t2 = $[4];
		t3 = $[5];
	}
	(0, import_react.useEffect)(t2, t3);
	const [pdfUrl, setPdfUrl] = (0, import_react.useState)(null);
	let t4;
	let t5;
	if ($[6] !== file || $[7] !== isPdf || $[8] !== size) {
		t4 = () => {
			if (!isPdf) return;
			let cancelled = false;
			renderPdfFirstPage(file, size).then((url_0) => {
				if (!cancelled) setPdfUrl(url_0);
			}).catch(_temp$2);
			return () => {
				cancelled = true;
			};
		};
		t5 = [
			file,
			isPdf,
			size
		];
		$[6] = file;
		$[7] = isPdf;
		$[8] = size;
		$[9] = t4;
		$[10] = t5;
	} else {
		t4 = $[9];
		t5 = $[10];
	}
	(0, import_react.useEffect)(t4, t5);
	const previewUrl = imageUrl ?? pdfUrl;
	let t6;
	if ($[11] !== className || $[12] !== shape.bg) {
		t6 = cn("relative shrink-0 overflow-hidden bg-accent border border-border", shape.bg, className);
		$[11] = className;
		$[12] = shape.bg;
		$[13] = t6;
	} else t6 = $[13];
	let t7;
	if ($[14] !== size) {
		t7 = {
			width: size,
			height: size
		};
		$[14] = size;
		$[15] = t7;
	} else t7 = $[15];
	let t8;
	if ($[16] !== file.name || $[17] !== previewUrl) {
		t8 = previewUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
			src: previewUrl,
			alt: file.name,
			className: "absolute inset-0 w-full h-full object-cover"
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "absolute inset-0 flex items-center justify-center",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "w-6 h-6 rounded-full border-2 border-border border-t-muted-foreground animate-spin",
				"aria-label": "Loading preview",
				role: "status"
			})
		});
		$[16] = file.name;
		$[17] = previewUrl;
		$[18] = t8;
	} else t8 = $[18];
	let t9;
	if ($[19] !== t6 || $[20] !== t7 || $[21] !== t8) {
		t9 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: t6,
			style: t7,
			children: t8
		});
		$[19] = t6;
		$[20] = t7;
		$[21] = t8;
		$[22] = t9;
	} else t9 = $[22];
	return t9;
}
function _temp$2() {}
typeof window !== "undefined" && window.document && window.document.createElement;
function composeEventHandlers(originalEventHandler, ourEventHandler, { checkForDefaultPrevented = true } = {}) {
	return function handleEvent(event) {
		originalEventHandler?.(event);
		if (checkForDefaultPrevented === false || !event.defaultPrevented) return ourEventHandler?.(event);
	};
}
//#endregion
//#region node_modules/@radix-ui/react-context/dist/index.mjs
function createContextScope(scopeName, createContextScopeDeps = []) {
	let defaultContexts = [];
	function createContext3(rootComponentName, defaultContext) {
		const BaseContext = import_react.createContext(defaultContext);
		BaseContext.displayName = rootComponentName + "Context";
		const index = defaultContexts.length;
		defaultContexts = [...defaultContexts, defaultContext];
		const Provider = (props) => {
			const { scope, children, ...context } = props;
			const Context = scope?.[scopeName]?.[index] || BaseContext;
			const value = import_react.useMemo(() => context, Object.values(context));
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Context.Provider, {
				value,
				children
			});
		};
		Provider.displayName = rootComponentName + "Provider";
		function useContext2(consumerName, scope) {
			const Context = scope?.[scopeName]?.[index] || BaseContext;
			const context = import_react.useContext(Context);
			if (context) return context;
			if (defaultContext !== void 0) return defaultContext;
			throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
		}
		return [Provider, useContext2];
	}
	const createScope = () => {
		const scopeContexts = defaultContexts.map((defaultContext) => {
			return import_react.createContext(defaultContext);
		});
		return function useScope(scope) {
			const contexts = scope?.[scopeName] || scopeContexts;
			return import_react.useMemo(() => ({ [`__scope${scopeName}`]: {
				...scope,
				[scopeName]: contexts
			} }), [scope, contexts]);
		};
	};
	createScope.scopeName = scopeName;
	return [createContext3, composeContextScopes(createScope, ...createContextScopeDeps)];
}
function composeContextScopes(...scopes) {
	const baseScope = scopes[0];
	if (scopes.length === 1) return baseScope;
	const createScope = () => {
		const scopeHooks = scopes.map((createScope2) => ({
			useScope: createScope2(),
			scopeName: createScope2.scopeName
		}));
		return function useComposedScopes(overrideScopes) {
			const nextScopes = scopeHooks.reduce((nextScopes2, { useScope, scopeName }) => {
				const currentScope = useScope(overrideScopes)[`__scope${scopeName}`];
				return {
					...nextScopes2,
					...currentScope
				};
			}, {});
			return import_react.useMemo(() => ({ [`__scope${baseScope.scopeName}`]: nextScopes }), [nextScopes]);
		};
	};
	createScope.scopeName = baseScope.scopeName;
	return createScope;
}
//#endregion
//#region node_modules/@radix-ui/react-primitive/dist/index.mjs
var Primitive = [
	"a",
	"button",
	"div",
	"form",
	"h2",
	"h3",
	"img",
	"input",
	"label",
	"li",
	"nav",
	"ol",
	"p",
	"select",
	"span",
	"svg",
	"ul"
].reduce((primitive, node) => {
	const Slot = createSlot(`Primitive.${node}`);
	const Node = import_react.forwardRef((props, forwardedRef) => {
		const { asChild, ...primitiveProps } = props;
		const Comp = asChild ? Slot : node;
		if (typeof window !== "undefined") window[Symbol.for("radix-ui")] = true;
		return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Comp, {
			...primitiveProps,
			ref: forwardedRef
		});
	});
	Node.displayName = `Primitive.${node}`;
	return {
		...primitive,
		[node]: Node
	};
}, {});
function dispatchDiscreteCustomEvent(target, event) {
	if (target) import_react_dom.flushSync(() => target.dispatchEvent(event));
}
//#endregion
//#region node_modules/@radix-ui/react-use-callback-ref/dist/index.mjs
function useCallbackRef(callback) {
	const callbackRef = import_react.useRef(callback);
	import_react.useEffect(() => {
		callbackRef.current = callback;
	});
	return import_react.useMemo(() => ((...args) => callbackRef.current?.(...args)), []);
}
//#endregion
//#region node_modules/@radix-ui/react-use-escape-keydown/dist/index.mjs
function useEscapeKeydown(onEscapeKeyDownProp, ownerDocument = globalThis?.document) {
	const onEscapeKeyDown = useCallbackRef(onEscapeKeyDownProp);
	import_react.useEffect(() => {
		const handleKeyDown = (event) => {
			if (event.key === "Escape") onEscapeKeyDown(event);
		};
		ownerDocument.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => ownerDocument.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [onEscapeKeyDown, ownerDocument]);
}
//#endregion
//#region node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs
var DISMISSABLE_LAYER_NAME = "DismissableLayer";
var CONTEXT_UPDATE = "dismissableLayer.update";
var POINTER_DOWN_OUTSIDE = "dismissableLayer.pointerDownOutside";
var FOCUS_OUTSIDE = "dismissableLayer.focusOutside";
var originalBodyPointerEvents;
var DismissableLayerContext = import_react.createContext({
	layers: /* @__PURE__ */ new Set(),
	layersWithOutsidePointerEventsDisabled: /* @__PURE__ */ new Set(),
	branches: /* @__PURE__ */ new Set()
});
var DismissableLayer = import_react.forwardRef((props, forwardedRef) => {
	const { disableOutsidePointerEvents = false, onEscapeKeyDown, onPointerDownOutside, onFocusOutside, onInteractOutside, onDismiss, ...layerProps } = props;
	const context = import_react.useContext(DismissableLayerContext);
	const [node, setNode] = import_react.useState(null);
	const ownerDocument = node?.ownerDocument ?? globalThis?.document;
	const [, force] = import_react.useState({});
	const composedRefs = useComposedRefs(forwardedRef, (node2) => setNode(node2));
	const layers = Array.from(context.layers);
	const [highestLayerWithOutsidePointerEventsDisabled] = [...context.layersWithOutsidePointerEventsDisabled].slice(-1);
	const highestLayerWithOutsidePointerEventsDisabledIndex = layers.indexOf(highestLayerWithOutsidePointerEventsDisabled);
	const index = node ? layers.indexOf(node) : -1;
	const isBodyPointerEventsDisabled = context.layersWithOutsidePointerEventsDisabled.size > 0;
	const isPointerEventsEnabled = index >= highestLayerWithOutsidePointerEventsDisabledIndex;
	const pointerDownOutside = usePointerDownOutside((event) => {
		const target = event.target;
		const isPointerDownOnBranch = [...context.branches].some((branch) => branch.contains(target));
		if (!isPointerEventsEnabled || isPointerDownOnBranch) return;
		onPointerDownOutside?.(event);
		onInteractOutside?.(event);
		if (!event.defaultPrevented) onDismiss?.();
	}, ownerDocument);
	const focusOutside = useFocusOutside((event) => {
		const target = event.target;
		if ([...context.branches].some((branch) => branch.contains(target))) return;
		onFocusOutside?.(event);
		onInteractOutside?.(event);
		if (!event.defaultPrevented) onDismiss?.();
	}, ownerDocument);
	useEscapeKeydown((event) => {
		if (!(index === context.layers.size - 1)) return;
		onEscapeKeyDown?.(event);
		if (!event.defaultPrevented && onDismiss) {
			event.preventDefault();
			onDismiss();
		}
	}, ownerDocument);
	import_react.useEffect(() => {
		if (!node) return;
		if (disableOutsidePointerEvents) {
			if (context.layersWithOutsidePointerEventsDisabled.size === 0) {
				originalBodyPointerEvents = ownerDocument.body.style.pointerEvents;
				ownerDocument.body.style.pointerEvents = "none";
			}
			context.layersWithOutsidePointerEventsDisabled.add(node);
		}
		context.layers.add(node);
		dispatchUpdate();
		return () => {
			if (disableOutsidePointerEvents) {
				context.layersWithOutsidePointerEventsDisabled.delete(node);
				if (context.layersWithOutsidePointerEventsDisabled.size === 0) ownerDocument.body.style.pointerEvents = originalBodyPointerEvents;
			}
		};
	}, [
		node,
		ownerDocument,
		disableOutsidePointerEvents,
		context
	]);
	import_react.useEffect(() => {
		return () => {
			if (!node) return;
			context.layers.delete(node);
			context.layersWithOutsidePointerEventsDisabled.delete(node);
			dispatchUpdate();
		};
	}, [node, context]);
	import_react.useEffect(() => {
		const handleUpdate = () => force({});
		document.addEventListener(CONTEXT_UPDATE, handleUpdate);
		return () => document.removeEventListener(CONTEXT_UPDATE, handleUpdate);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Primitive.div, {
		...layerProps,
		ref: composedRefs,
		style: {
			pointerEvents: isBodyPointerEventsDisabled ? isPointerEventsEnabled ? "auto" : "none" : void 0,
			...props.style
		},
		onFocusCapture: composeEventHandlers(props.onFocusCapture, focusOutside.onFocusCapture),
		onBlurCapture: composeEventHandlers(props.onBlurCapture, focusOutside.onBlurCapture),
		onPointerDownCapture: composeEventHandlers(props.onPointerDownCapture, pointerDownOutside.onPointerDownCapture)
	});
});
DismissableLayer.displayName = DISMISSABLE_LAYER_NAME;
var BRANCH_NAME = "DismissableLayerBranch";
var DismissableLayerBranch = import_react.forwardRef((props, forwardedRef) => {
	const context = import_react.useContext(DismissableLayerContext);
	const ref = import_react.useRef(null);
	const composedRefs = useComposedRefs(forwardedRef, ref);
	import_react.useEffect(() => {
		const node = ref.current;
		if (node) {
			context.branches.add(node);
			return () => {
				context.branches.delete(node);
			};
		}
	}, [context.branches]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Primitive.div, {
		...props,
		ref: composedRefs
	});
});
DismissableLayerBranch.displayName = BRANCH_NAME;
function usePointerDownOutside(onPointerDownOutside, ownerDocument = globalThis?.document) {
	const handlePointerDownOutside = useCallbackRef(onPointerDownOutside);
	const isPointerInsideReactTreeRef = import_react.useRef(false);
	const handleClickRef = import_react.useRef(() => {});
	import_react.useEffect(() => {
		const handlePointerDown = (event) => {
			if (event.target && !isPointerInsideReactTreeRef.current) {
				let handleAndDispatchPointerDownOutsideEvent2 = function() {
					handleAndDispatchCustomEvent(POINTER_DOWN_OUTSIDE, handlePointerDownOutside, eventDetail, { discrete: true });
				};
				const eventDetail = { originalEvent: event };
				if (event.pointerType === "touch") {
					ownerDocument.removeEventListener("click", handleClickRef.current);
					handleClickRef.current = handleAndDispatchPointerDownOutsideEvent2;
					ownerDocument.addEventListener("click", handleClickRef.current, { once: true });
				} else handleAndDispatchPointerDownOutsideEvent2();
			} else ownerDocument.removeEventListener("click", handleClickRef.current);
			isPointerInsideReactTreeRef.current = false;
		};
		const timerId = window.setTimeout(() => {
			ownerDocument.addEventListener("pointerdown", handlePointerDown);
		}, 0);
		return () => {
			window.clearTimeout(timerId);
			ownerDocument.removeEventListener("pointerdown", handlePointerDown);
			ownerDocument.removeEventListener("click", handleClickRef.current);
		};
	}, [ownerDocument, handlePointerDownOutside]);
	return { onPointerDownCapture: () => isPointerInsideReactTreeRef.current = true };
}
function useFocusOutside(onFocusOutside, ownerDocument = globalThis?.document) {
	const handleFocusOutside = useCallbackRef(onFocusOutside);
	const isFocusInsideReactTreeRef = import_react.useRef(false);
	import_react.useEffect(() => {
		const handleFocus = (event) => {
			if (event.target && !isFocusInsideReactTreeRef.current) handleAndDispatchCustomEvent(FOCUS_OUTSIDE, handleFocusOutside, { originalEvent: event }, { discrete: false });
		};
		ownerDocument.addEventListener("focusin", handleFocus);
		return () => ownerDocument.removeEventListener("focusin", handleFocus);
	}, [ownerDocument, handleFocusOutside]);
	return {
		onFocusCapture: () => isFocusInsideReactTreeRef.current = true,
		onBlurCapture: () => isFocusInsideReactTreeRef.current = false
	};
}
function dispatchUpdate() {
	const event = new CustomEvent(CONTEXT_UPDATE);
	document.dispatchEvent(event);
}
function handleAndDispatchCustomEvent(name, handler, detail, { discrete }) {
	const target = detail.originalEvent.target;
	const event = new CustomEvent(name, {
		bubbles: false,
		cancelable: true,
		detail
	});
	if (handler) target.addEventListener(name, handler, { once: true });
	if (discrete) dispatchDiscreteCustomEvent(target, event);
	else target.dispatchEvent(event);
}
//#endregion
//#region node_modules/@radix-ui/react-use-layout-effect/dist/index.mjs
var useLayoutEffect2 = globalThis?.document ? import_react.useLayoutEffect : () => {};
//#endregion
//#region node_modules/@radix-ui/react-id/dist/index.mjs
var useReactId = import_react[" useId ".trim().toString()] || (() => void 0);
var count = 0;
function useId(deterministicId) {
	const [id, setId] = import_react.useState(useReactId());
	useLayoutEffect2(() => {
		if (!deterministicId) setId((reactId) => reactId ?? String(count++));
	}, [deterministicId]);
	return deterministicId || (id ? `radix-${id}` : "");
}
//#endregion
//#region node_modules/@floating-ui/core/dist/floating-ui.core.mjs
function computeCoordsFromPlacement(_ref, placement, rtl) {
	let { reference, floating } = _ref;
	const sideAxis = getSideAxis(placement);
	const alignmentAxis = getAlignmentAxis(placement);
	const alignLength = getAxisLength(alignmentAxis);
	const side = getSide(placement);
	const isVertical = sideAxis === "y";
	const commonX = reference.x + reference.width / 2 - floating.width / 2;
	const commonY = reference.y + reference.height / 2 - floating.height / 2;
	const commonAlign = reference[alignLength] / 2 - floating[alignLength] / 2;
	let coords;
	switch (side) {
		case "top":
			coords = {
				x: commonX,
				y: reference.y - floating.height
			};
			break;
		case "bottom":
			coords = {
				x: commonX,
				y: reference.y + reference.height
			};
			break;
		case "right":
			coords = {
				x: reference.x + reference.width,
				y: commonY
			};
			break;
		case "left":
			coords = {
				x: reference.x - floating.width,
				y: commonY
			};
			break;
		default: coords = {
			x: reference.x,
			y: reference.y
		};
	}
	switch (getAlignment(placement)) {
		case "start":
			coords[alignmentAxis] -= commonAlign * (rtl && isVertical ? -1 : 1);
			break;
		case "end":
			coords[alignmentAxis] += commonAlign * (rtl && isVertical ? -1 : 1);
			break;
	}
	return coords;
}
/**
* Resolves with an object of overflow side offsets that determine how much the
* element is overflowing a given clipping boundary on each side.
* - positive = overflowing the boundary by that number of pixels
* - negative = how many pixels left before it will overflow
* - 0 = lies flush with the boundary
* @see https://floating-ui.com/docs/detectOverflow
*/
async function detectOverflow(state, options) {
	var _await$platform$isEle;
	if (options === void 0) options = {};
	const { x, y, platform, rects, elements, strategy } = state;
	const { boundary = "clippingAncestors", rootBoundary = "viewport", elementContext = "floating", altBoundary = false, padding = 0 } = evaluate(options, state);
	const paddingObject = getPaddingObject(padding);
	const element = elements[altBoundary ? elementContext === "floating" ? "reference" : "floating" : elementContext];
	const clippingClientRect = rectToClientRect(await platform.getClippingRect({
		element: ((_await$platform$isEle = await (platform.isElement == null ? void 0 : platform.isElement(element))) != null ? _await$platform$isEle : true) ? element : element.contextElement || await (platform.getDocumentElement == null ? void 0 : platform.getDocumentElement(elements.floating)),
		boundary,
		rootBoundary,
		strategy
	}));
	const rect = elementContext === "floating" ? {
		x,
		y,
		width: rects.floating.width,
		height: rects.floating.height
	} : rects.reference;
	const offsetParent = await (platform.getOffsetParent == null ? void 0 : platform.getOffsetParent(elements.floating));
	const offsetScale = await (platform.isElement == null ? void 0 : platform.isElement(offsetParent)) ? await (platform.getScale == null ? void 0 : platform.getScale(offsetParent)) || {
		x: 1,
		y: 1
	} : {
		x: 1,
		y: 1
	};
	const elementClientRect = rectToClientRect(platform.convertOffsetParentRelativeRectToViewportRelativeRect ? await platform.convertOffsetParentRelativeRectToViewportRelativeRect({
		elements,
		rect,
		offsetParent,
		strategy
	}) : rect);
	return {
		top: (clippingClientRect.top - elementClientRect.top + paddingObject.top) / offsetScale.y,
		bottom: (elementClientRect.bottom - clippingClientRect.bottom + paddingObject.bottom) / offsetScale.y,
		left: (clippingClientRect.left - elementClientRect.left + paddingObject.left) / offsetScale.x,
		right: (elementClientRect.right - clippingClientRect.right + paddingObject.right) / offsetScale.x
	};
}
var MAX_RESET_COUNT = 50;
/**
* Computes the `x` and `y` coordinates that will place the floating element
* next to a given reference element.
*
* This export does not have any `platform` interface logic. You will need to
* write one for the platform you are using Floating UI with.
*/
var computePosition$1 = async (reference, floating, config) => {
	const { placement = "bottom", strategy = "absolute", middleware = [], platform } = config;
	const platformWithDetectOverflow = platform.detectOverflow ? platform : {
		...platform,
		detectOverflow
	};
	const rtl = await (platform.isRTL == null ? void 0 : platform.isRTL(floating));
	let rects = await platform.getElementRects({
		reference,
		floating,
		strategy
	});
	let { x, y } = computeCoordsFromPlacement(rects, placement, rtl);
	let statefulPlacement = placement;
	let resetCount = 0;
	const middlewareData = {};
	for (let i = 0; i < middleware.length; i++) {
		const currentMiddleware = middleware[i];
		if (!currentMiddleware) continue;
		const { name, fn } = currentMiddleware;
		const { x: nextX, y: nextY, data, reset } = await fn({
			x,
			y,
			initialPlacement: placement,
			placement: statefulPlacement,
			strategy,
			middlewareData,
			rects,
			platform: platformWithDetectOverflow,
			elements: {
				reference,
				floating
			}
		});
		x = nextX != null ? nextX : x;
		y = nextY != null ? nextY : y;
		middlewareData[name] = {
			...middlewareData[name],
			...data
		};
		if (reset && resetCount < MAX_RESET_COUNT) {
			resetCount++;
			if (typeof reset === "object") {
				if (reset.placement) statefulPlacement = reset.placement;
				if (reset.rects) rects = reset.rects === true ? await platform.getElementRects({
					reference,
					floating,
					strategy
				}) : reset.rects;
				({x, y} = computeCoordsFromPlacement(rects, statefulPlacement, rtl));
			}
			i = -1;
		}
	}
	return {
		x,
		y,
		placement: statefulPlacement,
		strategy,
		middlewareData
	};
};
/**
* Provides data to position an inner element of the floating element so that it
* appears centered to the reference element.
* @see https://floating-ui.com/docs/arrow
*/
var arrow$3 = (options) => ({
	name: "arrow",
	options,
	async fn(state) {
		const { x, y, placement, rects, platform, elements, middlewareData } = state;
		const { element, padding = 0 } = evaluate(options, state) || {};
		if (element == null) return {};
		const paddingObject = getPaddingObject(padding);
		const coords = {
			x,
			y
		};
		const axis = getAlignmentAxis(placement);
		const length = getAxisLength(axis);
		const arrowDimensions = await platform.getDimensions(element);
		const isYAxis = axis === "y";
		const minProp = isYAxis ? "top" : "left";
		const maxProp = isYAxis ? "bottom" : "right";
		const clientProp = isYAxis ? "clientHeight" : "clientWidth";
		const endDiff = rects.reference[length] + rects.reference[axis] - coords[axis] - rects.floating[length];
		const startDiff = coords[axis] - rects.reference[axis];
		const arrowOffsetParent = await (platform.getOffsetParent == null ? void 0 : platform.getOffsetParent(element));
		let clientSize = arrowOffsetParent ? arrowOffsetParent[clientProp] : 0;
		if (!clientSize || !await (platform.isElement == null ? void 0 : platform.isElement(arrowOffsetParent))) clientSize = elements.floating[clientProp] || rects.floating[length];
		const centerToReference = endDiff / 2 - startDiff / 2;
		const largestPossiblePadding = clientSize / 2 - arrowDimensions[length] / 2 - 1;
		const minPadding = min(paddingObject[minProp], largestPossiblePadding);
		const maxPadding = min(paddingObject[maxProp], largestPossiblePadding);
		const min$1 = minPadding;
		const max = clientSize - arrowDimensions[length] - maxPadding;
		const center = clientSize / 2 - arrowDimensions[length] / 2 + centerToReference;
		const offset = clamp(min$1, center, max);
		const shouldAddOffset = !middlewareData.arrow && getAlignment(placement) != null && center !== offset && rects.reference[length] / 2 - (center < min$1 ? minPadding : maxPadding) - arrowDimensions[length] / 2 < 0;
		const alignmentOffset = shouldAddOffset ? center < min$1 ? center - min$1 : center - max : 0;
		return {
			[axis]: coords[axis] + alignmentOffset,
			data: {
				[axis]: offset,
				centerOffset: center - offset - alignmentOffset,
				...shouldAddOffset && { alignmentOffset }
			},
			reset: shouldAddOffset
		};
	}
});
/**
* Optimizes the visibility of the floating element by flipping the `placement`
* in order to keep it in view when the preferred placement(s) will overflow the
* clipping boundary. Alternative to `autoPlacement`.
* @see https://floating-ui.com/docs/flip
*/
var flip$2 = function(options) {
	if (options === void 0) options = {};
	return {
		name: "flip",
		options,
		async fn(state) {
			var _middlewareData$arrow, _middlewareData$flip;
			const { placement, middlewareData, rects, initialPlacement, platform, elements } = state;
			const { mainAxis: checkMainAxis = true, crossAxis: checkCrossAxis = true, fallbackPlacements: specifiedFallbackPlacements, fallbackStrategy = "bestFit", fallbackAxisSideDirection = "none", flipAlignment = true, ...detectOverflowOptions } = evaluate(options, state);
			if ((_middlewareData$arrow = middlewareData.arrow) != null && _middlewareData$arrow.alignmentOffset) return {};
			const side = getSide(placement);
			const initialSideAxis = getSideAxis(initialPlacement);
			const isBasePlacement = getSide(initialPlacement) === initialPlacement;
			const rtl = await (platform.isRTL == null ? void 0 : platform.isRTL(elements.floating));
			const fallbackPlacements = specifiedFallbackPlacements || (isBasePlacement || !flipAlignment ? [getOppositePlacement(initialPlacement)] : getExpandedPlacements(initialPlacement));
			const hasFallbackAxisSideDirection = fallbackAxisSideDirection !== "none";
			if (!specifiedFallbackPlacements && hasFallbackAxisSideDirection) fallbackPlacements.push(...getOppositeAxisPlacements(initialPlacement, flipAlignment, fallbackAxisSideDirection, rtl));
			const placements = [initialPlacement, ...fallbackPlacements];
			const overflow = await platform.detectOverflow(state, detectOverflowOptions);
			const overflows = [];
			let overflowsData = ((_middlewareData$flip = middlewareData.flip) == null ? void 0 : _middlewareData$flip.overflows) || [];
			if (checkMainAxis) overflows.push(overflow[side]);
			if (checkCrossAxis) {
				const sides = getAlignmentSides(placement, rects, rtl);
				overflows.push(overflow[sides[0]], overflow[sides[1]]);
			}
			overflowsData = [...overflowsData, {
				placement,
				overflows
			}];
			if (!overflows.every((side) => side <= 0)) {
				var _middlewareData$flip2, _overflowsData$filter;
				const nextIndex = (((_middlewareData$flip2 = middlewareData.flip) == null ? void 0 : _middlewareData$flip2.index) || 0) + 1;
				const nextPlacement = placements[nextIndex];
				if (nextPlacement) {
					if (!(checkCrossAxis === "alignment" ? initialSideAxis !== getSideAxis(nextPlacement) : false) || overflowsData.every((d) => getSideAxis(d.placement) === initialSideAxis ? d.overflows[0] > 0 : true)) return {
						data: {
							index: nextIndex,
							overflows: overflowsData
						},
						reset: { placement: nextPlacement }
					};
				}
				let resetPlacement = (_overflowsData$filter = overflowsData.filter((d) => d.overflows[0] <= 0).sort((a, b) => a.overflows[1] - b.overflows[1])[0]) == null ? void 0 : _overflowsData$filter.placement;
				if (!resetPlacement) switch (fallbackStrategy) {
					case "bestFit": {
						var _overflowsData$filter2;
						const placement = (_overflowsData$filter2 = overflowsData.filter((d) => {
							if (hasFallbackAxisSideDirection) {
								const currentSideAxis = getSideAxis(d.placement);
								return currentSideAxis === initialSideAxis || currentSideAxis === "y";
							}
							return true;
						}).map((d) => [d.placement, d.overflows.filter((overflow) => overflow > 0).reduce((acc, overflow) => acc + overflow, 0)]).sort((a, b) => a[1] - b[1])[0]) == null ? void 0 : _overflowsData$filter2[0];
						if (placement) resetPlacement = placement;
						break;
					}
					case "initialPlacement":
						resetPlacement = initialPlacement;
						break;
				}
				if (placement !== resetPlacement) return { reset: { placement: resetPlacement } };
			}
			return {};
		}
	};
};
function getSideOffsets(overflow, rect) {
	return {
		top: overflow.top - rect.height,
		right: overflow.right - rect.width,
		bottom: overflow.bottom - rect.height,
		left: overflow.left - rect.width
	};
}
function isAnySideFullyClipped(overflow) {
	return sides.some((side) => overflow[side] >= 0);
}
/**
* Provides data to hide the floating element in applicable situations, such as
* when it is not in the same clipping context as the reference element.
* @see https://floating-ui.com/docs/hide
*/
var hide$2 = function(options) {
	if (options === void 0) options = {};
	return {
		name: "hide",
		options,
		async fn(state) {
			const { rects, platform } = state;
			const { strategy = "referenceHidden", ...detectOverflowOptions } = evaluate(options, state);
			switch (strategy) {
				case "referenceHidden": {
					const offsets = getSideOffsets(await platform.detectOverflow(state, {
						...detectOverflowOptions,
						elementContext: "reference"
					}), rects.reference);
					return { data: {
						referenceHiddenOffsets: offsets,
						referenceHidden: isAnySideFullyClipped(offsets)
					} };
				}
				case "escaped": {
					const offsets = getSideOffsets(await platform.detectOverflow(state, {
						...detectOverflowOptions,
						altBoundary: true
					}), rects.floating);
					return { data: {
						escapedOffsets: offsets,
						escaped: isAnySideFullyClipped(offsets)
					} };
				}
				default: return {};
			}
		}
	};
};
var originSides = /*#__PURE__*/ new Set(["left", "top"]);
async function convertValueToCoords(state, options) {
	const { placement, platform, elements } = state;
	const rtl = await (platform.isRTL == null ? void 0 : platform.isRTL(elements.floating));
	const side = getSide(placement);
	const alignment = getAlignment(placement);
	const isVertical = getSideAxis(placement) === "y";
	const mainAxisMulti = originSides.has(side) ? -1 : 1;
	const crossAxisMulti = rtl && isVertical ? -1 : 1;
	const rawValue = evaluate(options, state);
	let { mainAxis, crossAxis, alignmentAxis } = typeof rawValue === "number" ? {
		mainAxis: rawValue,
		crossAxis: 0,
		alignmentAxis: null
	} : {
		mainAxis: rawValue.mainAxis || 0,
		crossAxis: rawValue.crossAxis || 0,
		alignmentAxis: rawValue.alignmentAxis
	};
	if (alignment && typeof alignmentAxis === "number") crossAxis = alignment === "end" ? alignmentAxis * -1 : alignmentAxis;
	return isVertical ? {
		x: crossAxis * crossAxisMulti,
		y: mainAxis * mainAxisMulti
	} : {
		x: mainAxis * mainAxisMulti,
		y: crossAxis * crossAxisMulti
	};
}
/**
* Modifies the placement by translating the floating element along the
* specified axes.
* A number (shorthand for `mainAxis` or distance), or an axes configuration
* object may be passed.
* @see https://floating-ui.com/docs/offset
*/
var offset$2 = function(options) {
	if (options === void 0) options = 0;
	return {
		name: "offset",
		options,
		async fn(state) {
			var _middlewareData$offse, _middlewareData$arrow;
			const { x, y, placement, middlewareData } = state;
			const diffCoords = await convertValueToCoords(state, options);
			if (placement === ((_middlewareData$offse = middlewareData.offset) == null ? void 0 : _middlewareData$offse.placement) && (_middlewareData$arrow = middlewareData.arrow) != null && _middlewareData$arrow.alignmentOffset) return {};
			return {
				x: x + diffCoords.x,
				y: y + diffCoords.y,
				data: {
					...diffCoords,
					placement
				}
			};
		}
	};
};
/**
* Optimizes the visibility of the floating element by shifting it in order to
* keep it in view when it will overflow the clipping boundary.
* @see https://floating-ui.com/docs/shift
*/
var shift$2 = function(options) {
	if (options === void 0) options = {};
	return {
		name: "shift",
		options,
		async fn(state) {
			const { x, y, placement, platform } = state;
			const { mainAxis: checkMainAxis = true, crossAxis: checkCrossAxis = false, limiter = { fn: (_ref) => {
				let { x, y } = _ref;
				return {
					x,
					y
				};
			} }, ...detectOverflowOptions } = evaluate(options, state);
			const coords = {
				x,
				y
			};
			const overflow = await platform.detectOverflow(state, detectOverflowOptions);
			const crossAxis = getSideAxis(getSide(placement));
			const mainAxis = getOppositeAxis(crossAxis);
			let mainAxisCoord = coords[mainAxis];
			let crossAxisCoord = coords[crossAxis];
			if (checkMainAxis) {
				const minSide = mainAxis === "y" ? "top" : "left";
				const maxSide = mainAxis === "y" ? "bottom" : "right";
				const min = mainAxisCoord + overflow[minSide];
				const max = mainAxisCoord - overflow[maxSide];
				mainAxisCoord = clamp(min, mainAxisCoord, max);
			}
			if (checkCrossAxis) {
				const minSide = crossAxis === "y" ? "top" : "left";
				const maxSide = crossAxis === "y" ? "bottom" : "right";
				const min = crossAxisCoord + overflow[minSide];
				const max = crossAxisCoord - overflow[maxSide];
				crossAxisCoord = clamp(min, crossAxisCoord, max);
			}
			const limitedCoords = limiter.fn({
				...state,
				[mainAxis]: mainAxisCoord,
				[crossAxis]: crossAxisCoord
			});
			return {
				...limitedCoords,
				data: {
					x: limitedCoords.x - x,
					y: limitedCoords.y - y,
					enabled: {
						[mainAxis]: checkMainAxis,
						[crossAxis]: checkCrossAxis
					}
				}
			};
		}
	};
};
/**
* Built-in `limiter` that will stop `shift()` at a certain point.
*/
var limitShift$2 = function(options) {
	if (options === void 0) options = {};
	return {
		options,
		fn(state) {
			const { x, y, placement, rects, middlewareData } = state;
			const { offset = 0, mainAxis: checkMainAxis = true, crossAxis: checkCrossAxis = true } = evaluate(options, state);
			const coords = {
				x,
				y
			};
			const crossAxis = getSideAxis(placement);
			const mainAxis = getOppositeAxis(crossAxis);
			let mainAxisCoord = coords[mainAxis];
			let crossAxisCoord = coords[crossAxis];
			const rawOffset = evaluate(offset, state);
			const computedOffset = typeof rawOffset === "number" ? {
				mainAxis: rawOffset,
				crossAxis: 0
			} : {
				mainAxis: 0,
				crossAxis: 0,
				...rawOffset
			};
			if (checkMainAxis) {
				const len = mainAxis === "y" ? "height" : "width";
				const limitMin = rects.reference[mainAxis] - rects.floating[len] + computedOffset.mainAxis;
				const limitMax = rects.reference[mainAxis] + rects.reference[len] - computedOffset.mainAxis;
				if (mainAxisCoord < limitMin) mainAxisCoord = limitMin;
				else if (mainAxisCoord > limitMax) mainAxisCoord = limitMax;
			}
			if (checkCrossAxis) {
				var _middlewareData$offse, _middlewareData$offse2;
				const len = mainAxis === "y" ? "width" : "height";
				const isOriginSide = originSides.has(getSide(placement));
				const limitMin = rects.reference[crossAxis] - rects.floating[len] + (isOriginSide ? ((_middlewareData$offse = middlewareData.offset) == null ? void 0 : _middlewareData$offse[crossAxis]) || 0 : 0) + (isOriginSide ? 0 : computedOffset.crossAxis);
				const limitMax = rects.reference[crossAxis] + rects.reference[len] + (isOriginSide ? 0 : ((_middlewareData$offse2 = middlewareData.offset) == null ? void 0 : _middlewareData$offse2[crossAxis]) || 0) - (isOriginSide ? computedOffset.crossAxis : 0);
				if (crossAxisCoord < limitMin) crossAxisCoord = limitMin;
				else if (crossAxisCoord > limitMax) crossAxisCoord = limitMax;
			}
			return {
				[mainAxis]: mainAxisCoord,
				[crossAxis]: crossAxisCoord
			};
		}
	};
};
/**
* Provides data that allows you to change the size of the floating element —
* for instance, prevent it from overflowing the clipping boundary or match the
* width of the reference element.
* @see https://floating-ui.com/docs/size
*/
var size$2 = function(options) {
	if (options === void 0) options = {};
	return {
		name: "size",
		options,
		async fn(state) {
			var _state$middlewareData, _state$middlewareData2;
			const { placement, rects, platform, elements } = state;
			const { apply = () => {}, ...detectOverflowOptions } = evaluate(options, state);
			const overflow = await platform.detectOverflow(state, detectOverflowOptions);
			const side = getSide(placement);
			const alignment = getAlignment(placement);
			const isYAxis = getSideAxis(placement) === "y";
			const { width, height } = rects.floating;
			let heightSide;
			let widthSide;
			if (side === "top" || side === "bottom") {
				heightSide = side;
				widthSide = alignment === (await (platform.isRTL == null ? void 0 : platform.isRTL(elements.floating)) ? "start" : "end") ? "left" : "right";
			} else {
				widthSide = side;
				heightSide = alignment === "end" ? "top" : "bottom";
			}
			const maximumClippingHeight = height - overflow.top - overflow.bottom;
			const maximumClippingWidth = width - overflow.left - overflow.right;
			const overflowAvailableHeight = min(height - overflow[heightSide], maximumClippingHeight);
			const overflowAvailableWidth = min(width - overflow[widthSide], maximumClippingWidth);
			const noShift = !state.middlewareData.shift;
			let availableHeight = overflowAvailableHeight;
			let availableWidth = overflowAvailableWidth;
			if ((_state$middlewareData = state.middlewareData.shift) != null && _state$middlewareData.enabled.x) availableWidth = maximumClippingWidth;
			if ((_state$middlewareData2 = state.middlewareData.shift) != null && _state$middlewareData2.enabled.y) availableHeight = maximumClippingHeight;
			if (noShift && !alignment) {
				const xMin = max(overflow.left, 0);
				const xMax = max(overflow.right, 0);
				const yMin = max(overflow.top, 0);
				const yMax = max(overflow.bottom, 0);
				if (isYAxis) availableWidth = width - 2 * (xMin !== 0 || xMax !== 0 ? xMin + xMax : max(overflow.left, overflow.right));
				else availableHeight = height - 2 * (yMin !== 0 || yMax !== 0 ? yMin + yMax : max(overflow.top, overflow.bottom));
			}
			await apply({
				...state,
				availableWidth,
				availableHeight
			});
			const nextDimensions = await platform.getDimensions(elements.floating);
			if (width !== nextDimensions.width || height !== nextDimensions.height) return { reset: { rects: true } };
			return {};
		}
	};
};
//#endregion
//#region node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs
function getCssDimensions(element) {
	const css = getComputedStyle$1(element);
	let width = parseFloat(css.width) || 0;
	let height = parseFloat(css.height) || 0;
	const hasOffset = isHTMLElement(element);
	const offsetWidth = hasOffset ? element.offsetWidth : width;
	const offsetHeight = hasOffset ? element.offsetHeight : height;
	const shouldFallback = round(width) !== offsetWidth || round(height) !== offsetHeight;
	if (shouldFallback) {
		width = offsetWidth;
		height = offsetHeight;
	}
	return {
		width,
		height,
		$: shouldFallback
	};
}
function unwrapElement(element) {
	return !isElement(element) ? element.contextElement : element;
}
function getScale(element) {
	const domElement = unwrapElement(element);
	if (!isHTMLElement(domElement)) return createCoords(1);
	const rect = domElement.getBoundingClientRect();
	const { width, height, $ } = getCssDimensions(domElement);
	let x = ($ ? round(rect.width) : rect.width) / width;
	let y = ($ ? round(rect.height) : rect.height) / height;
	if (!x || !Number.isFinite(x)) x = 1;
	if (!y || !Number.isFinite(y)) y = 1;
	return {
		x,
		y
	};
}
var noOffsets = /*#__PURE__*/ createCoords(0);
function getVisualOffsets(element) {
	const win = getWindow(element);
	if (!isWebKit() || !win.visualViewport) return noOffsets;
	return {
		x: win.visualViewport.offsetLeft,
		y: win.visualViewport.offsetTop
	};
}
function shouldAddVisualOffsets(element, isFixed, floatingOffsetParent) {
	if (isFixed === void 0) isFixed = false;
	if (!floatingOffsetParent || isFixed && floatingOffsetParent !== getWindow(element)) return false;
	return isFixed;
}
function getBoundingClientRect(element, includeScale, isFixedStrategy, offsetParent) {
	if (includeScale === void 0) includeScale = false;
	if (isFixedStrategy === void 0) isFixedStrategy = false;
	const clientRect = element.getBoundingClientRect();
	const domElement = unwrapElement(element);
	let scale = createCoords(1);
	if (includeScale) if (offsetParent) {
		if (isElement(offsetParent)) scale = getScale(offsetParent);
	} else scale = getScale(element);
	const visualOffsets = shouldAddVisualOffsets(domElement, isFixedStrategy, offsetParent) ? getVisualOffsets(domElement) : createCoords(0);
	let x = (clientRect.left + visualOffsets.x) / scale.x;
	let y = (clientRect.top + visualOffsets.y) / scale.y;
	let width = clientRect.width / scale.x;
	let height = clientRect.height / scale.y;
	if (domElement) {
		const win = getWindow(domElement);
		const offsetWin = offsetParent && isElement(offsetParent) ? getWindow(offsetParent) : offsetParent;
		let currentWin = win;
		let currentIFrame = getFrameElement(currentWin);
		while (currentIFrame && offsetParent && offsetWin !== currentWin) {
			const iframeScale = getScale(currentIFrame);
			const iframeRect = currentIFrame.getBoundingClientRect();
			const css = getComputedStyle$1(currentIFrame);
			const left = iframeRect.left + (currentIFrame.clientLeft + parseFloat(css.paddingLeft)) * iframeScale.x;
			const top = iframeRect.top + (currentIFrame.clientTop + parseFloat(css.paddingTop)) * iframeScale.y;
			x *= iframeScale.x;
			y *= iframeScale.y;
			width *= iframeScale.x;
			height *= iframeScale.y;
			x += left;
			y += top;
			currentWin = getWindow(currentIFrame);
			currentIFrame = getFrameElement(currentWin);
		}
	}
	return rectToClientRect({
		width,
		height,
		x,
		y
	});
}
function getWindowScrollBarX(element, rect) {
	const leftScroll = getNodeScroll(element).scrollLeft;
	if (!rect) return getBoundingClientRect(getDocumentElement(element)).left + leftScroll;
	return rect.left + leftScroll;
}
function getHTMLOffset(documentElement, scroll) {
	const htmlRect = documentElement.getBoundingClientRect();
	return {
		x: htmlRect.left + scroll.scrollLeft - getWindowScrollBarX(documentElement, htmlRect),
		y: htmlRect.top + scroll.scrollTop
	};
}
function convertOffsetParentRelativeRectToViewportRelativeRect(_ref) {
	let { elements, rect, offsetParent, strategy } = _ref;
	const isFixed = strategy === "fixed";
	const documentElement = getDocumentElement(offsetParent);
	const topLayer = elements ? isTopLayer(elements.floating) : false;
	if (offsetParent === documentElement || topLayer && isFixed) return rect;
	let scroll = {
		scrollLeft: 0,
		scrollTop: 0
	};
	let scale = createCoords(1);
	const offsets = createCoords(0);
	const isOffsetParentAnElement = isHTMLElement(offsetParent);
	if (isOffsetParentAnElement || !isOffsetParentAnElement && !isFixed) {
		if (getNodeName(offsetParent) !== "body" || isOverflowElement(documentElement)) scroll = getNodeScroll(offsetParent);
		if (isOffsetParentAnElement) {
			const offsetRect = getBoundingClientRect(offsetParent);
			scale = getScale(offsetParent);
			offsets.x = offsetRect.x + offsetParent.clientLeft;
			offsets.y = offsetRect.y + offsetParent.clientTop;
		}
	}
	const htmlOffset = documentElement && !isOffsetParentAnElement && !isFixed ? getHTMLOffset(documentElement, scroll) : createCoords(0);
	return {
		width: rect.width * scale.x,
		height: rect.height * scale.y,
		x: rect.x * scale.x - scroll.scrollLeft * scale.x + offsets.x + htmlOffset.x,
		y: rect.y * scale.y - scroll.scrollTop * scale.y + offsets.y + htmlOffset.y
	};
}
function getClientRects(element) {
	return Array.from(element.getClientRects());
}
function getDocumentRect(element) {
	const html = getDocumentElement(element);
	const scroll = getNodeScroll(element);
	const body = element.ownerDocument.body;
	const width = max(html.scrollWidth, html.clientWidth, body.scrollWidth, body.clientWidth);
	const height = max(html.scrollHeight, html.clientHeight, body.scrollHeight, body.clientHeight);
	let x = -scroll.scrollLeft + getWindowScrollBarX(element);
	const y = -scroll.scrollTop;
	if (getComputedStyle$1(body).direction === "rtl") x += max(html.clientWidth, body.clientWidth) - width;
	return {
		width,
		height,
		x,
		y
	};
}
var SCROLLBAR_MAX = 25;
function getViewportRect(element, strategy) {
	const win = getWindow(element);
	const html = getDocumentElement(element);
	const visualViewport = win.visualViewport;
	let width = html.clientWidth;
	let height = html.clientHeight;
	let x = 0;
	let y = 0;
	if (visualViewport) {
		width = visualViewport.width;
		height = visualViewport.height;
		const visualViewportBased = isWebKit();
		if (!visualViewportBased || visualViewportBased && strategy === "fixed") {
			x = visualViewport.offsetLeft;
			y = visualViewport.offsetTop;
		}
	}
	const windowScrollbarX = getWindowScrollBarX(html);
	if (windowScrollbarX <= 0) {
		const doc = html.ownerDocument;
		const body = doc.body;
		const bodyStyles = getComputedStyle(body);
		const bodyMarginInline = doc.compatMode === "CSS1Compat" ? parseFloat(bodyStyles.marginLeft) + parseFloat(bodyStyles.marginRight) || 0 : 0;
		const clippingStableScrollbarWidth = Math.abs(html.clientWidth - body.clientWidth - bodyMarginInline);
		if (clippingStableScrollbarWidth <= SCROLLBAR_MAX) width -= clippingStableScrollbarWidth;
	} else if (windowScrollbarX <= SCROLLBAR_MAX) width += windowScrollbarX;
	return {
		width,
		height,
		x,
		y
	};
}
function getInnerBoundingClientRect(element, strategy) {
	const clientRect = getBoundingClientRect(element, true, strategy === "fixed");
	const top = clientRect.top + element.clientTop;
	const left = clientRect.left + element.clientLeft;
	const scale = isHTMLElement(element) ? getScale(element) : createCoords(1);
	return {
		width: element.clientWidth * scale.x,
		height: element.clientHeight * scale.y,
		x: left * scale.x,
		y: top * scale.y
	};
}
function getClientRectFromClippingAncestor(element, clippingAncestor, strategy) {
	let rect;
	if (clippingAncestor === "viewport") rect = getViewportRect(element, strategy);
	else if (clippingAncestor === "document") rect = getDocumentRect(getDocumentElement(element));
	else if (isElement(clippingAncestor)) rect = getInnerBoundingClientRect(clippingAncestor, strategy);
	else {
		const visualOffsets = getVisualOffsets(element);
		rect = {
			x: clippingAncestor.x - visualOffsets.x,
			y: clippingAncestor.y - visualOffsets.y,
			width: clippingAncestor.width,
			height: clippingAncestor.height
		};
	}
	return rectToClientRect(rect);
}
function hasFixedPositionAncestor(element, stopNode) {
	const parentNode = getParentNode(element);
	if (parentNode === stopNode || !isElement(parentNode) || isLastTraversableNode(parentNode)) return false;
	return getComputedStyle$1(parentNode).position === "fixed" || hasFixedPositionAncestor(parentNode, stopNode);
}
function getClippingElementAncestors(element, cache) {
	const cachedResult = cache.get(element);
	if (cachedResult) return cachedResult;
	let result = getOverflowAncestors(element, [], false).filter((el) => isElement(el) && getNodeName(el) !== "body");
	let currentContainingBlockComputedStyle = null;
	const elementIsFixed = getComputedStyle$1(element).position === "fixed";
	let currentNode = elementIsFixed ? getParentNode(element) : element;
	while (isElement(currentNode) && !isLastTraversableNode(currentNode)) {
		const computedStyle = getComputedStyle$1(currentNode);
		const currentNodeIsContaining = isContainingBlock(currentNode);
		if (!currentNodeIsContaining && computedStyle.position === "fixed") currentContainingBlockComputedStyle = null;
		if (elementIsFixed ? !currentNodeIsContaining && !currentContainingBlockComputedStyle : !currentNodeIsContaining && computedStyle.position === "static" && !!currentContainingBlockComputedStyle && (currentContainingBlockComputedStyle.position === "absolute" || currentContainingBlockComputedStyle.position === "fixed") || isOverflowElement(currentNode) && !currentNodeIsContaining && hasFixedPositionAncestor(element, currentNode)) result = result.filter((ancestor) => ancestor !== currentNode);
		else currentContainingBlockComputedStyle = computedStyle;
		currentNode = getParentNode(currentNode);
	}
	cache.set(element, result);
	return result;
}
function getClippingRect(_ref) {
	let { element, boundary, rootBoundary, strategy } = _ref;
	const clippingAncestors = [...boundary === "clippingAncestors" ? isTopLayer(element) ? [] : getClippingElementAncestors(element, this._c) : [].concat(boundary), rootBoundary];
	const firstRect = getClientRectFromClippingAncestor(element, clippingAncestors[0], strategy);
	let top = firstRect.top;
	let right = firstRect.right;
	let bottom = firstRect.bottom;
	let left = firstRect.left;
	for (let i = 1; i < clippingAncestors.length; i++) {
		const rect = getClientRectFromClippingAncestor(element, clippingAncestors[i], strategy);
		top = max(rect.top, top);
		right = min(rect.right, right);
		bottom = min(rect.bottom, bottom);
		left = max(rect.left, left);
	}
	return {
		width: right - left,
		height: bottom - top,
		x: left,
		y: top
	};
}
function getDimensions(element) {
	const { width, height } = getCssDimensions(element);
	return {
		width,
		height
	};
}
function getRectRelativeToOffsetParent(element, offsetParent, strategy) {
	const isOffsetParentAnElement = isHTMLElement(offsetParent);
	const documentElement = getDocumentElement(offsetParent);
	const isFixed = strategy === "fixed";
	const rect = getBoundingClientRect(element, true, isFixed, offsetParent);
	let scroll = {
		scrollLeft: 0,
		scrollTop: 0
	};
	const offsets = createCoords(0);
	function setLeftRTLScrollbarOffset() {
		offsets.x = getWindowScrollBarX(documentElement);
	}
	if (isOffsetParentAnElement || !isOffsetParentAnElement && !isFixed) {
		if (getNodeName(offsetParent) !== "body" || isOverflowElement(documentElement)) scroll = getNodeScroll(offsetParent);
		if (isOffsetParentAnElement) {
			const offsetRect = getBoundingClientRect(offsetParent, true, isFixed, offsetParent);
			offsets.x = offsetRect.x + offsetParent.clientLeft;
			offsets.y = offsetRect.y + offsetParent.clientTop;
		} else if (documentElement) setLeftRTLScrollbarOffset();
	}
	if (isFixed && !isOffsetParentAnElement && documentElement) setLeftRTLScrollbarOffset();
	const htmlOffset = documentElement && !isOffsetParentAnElement && !isFixed ? getHTMLOffset(documentElement, scroll) : createCoords(0);
	return {
		x: rect.left + scroll.scrollLeft - offsets.x - htmlOffset.x,
		y: rect.top + scroll.scrollTop - offsets.y - htmlOffset.y,
		width: rect.width,
		height: rect.height
	};
}
function isStaticPositioned(element) {
	return getComputedStyle$1(element).position === "static";
}
function getTrueOffsetParent(element, polyfill) {
	if (!isHTMLElement(element) || getComputedStyle$1(element).position === "fixed") return null;
	if (polyfill) return polyfill(element);
	let rawOffsetParent = element.offsetParent;
	if (getDocumentElement(element) === rawOffsetParent) rawOffsetParent = rawOffsetParent.ownerDocument.body;
	return rawOffsetParent;
}
function getOffsetParent(element, polyfill) {
	const win = getWindow(element);
	if (isTopLayer(element)) return win;
	if (!isHTMLElement(element)) {
		let svgOffsetParent = getParentNode(element);
		while (svgOffsetParent && !isLastTraversableNode(svgOffsetParent)) {
			if (isElement(svgOffsetParent) && !isStaticPositioned(svgOffsetParent)) return svgOffsetParent;
			svgOffsetParent = getParentNode(svgOffsetParent);
		}
		return win;
	}
	let offsetParent = getTrueOffsetParent(element, polyfill);
	while (offsetParent && isTableElement(offsetParent) && isStaticPositioned(offsetParent)) offsetParent = getTrueOffsetParent(offsetParent, polyfill);
	if (offsetParent && isLastTraversableNode(offsetParent) && isStaticPositioned(offsetParent) && !isContainingBlock(offsetParent)) return win;
	return offsetParent || getContainingBlock(element) || win;
}
var getElementRects = async function(data) {
	const getOffsetParentFn = this.getOffsetParent || getOffsetParent;
	const getDimensionsFn = this.getDimensions;
	const floatingDimensions = await getDimensionsFn(data.floating);
	return {
		reference: getRectRelativeToOffsetParent(data.reference, await getOffsetParentFn(data.floating), data.strategy),
		floating: {
			x: 0,
			y: 0,
			width: floatingDimensions.width,
			height: floatingDimensions.height
		}
	};
};
function isRTL(element) {
	return getComputedStyle$1(element).direction === "rtl";
}
var platform = {
	convertOffsetParentRelativeRectToViewportRelativeRect,
	getDocumentElement,
	getClippingRect,
	getOffsetParent,
	getElementRects,
	getClientRects,
	getDimensions,
	getScale,
	isElement,
	isRTL
};
function rectsAreEqual(a, b) {
	return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
function observeMove(element, onMove) {
	let io = null;
	let timeoutId;
	const root = getDocumentElement(element);
	function cleanup() {
		var _io;
		clearTimeout(timeoutId);
		(_io = io) == null || _io.disconnect();
		io = null;
	}
	function refresh(skip, threshold) {
		if (skip === void 0) skip = false;
		if (threshold === void 0) threshold = 1;
		cleanup();
		const elementRectForRootMargin = element.getBoundingClientRect();
		const { left, top, width, height } = elementRectForRootMargin;
		if (!skip) onMove();
		if (!width || !height) return;
		const insetTop = floor(top);
		const insetRight = floor(root.clientWidth - (left + width));
		const insetBottom = floor(root.clientHeight - (top + height));
		const insetLeft = floor(left);
		const options = {
			rootMargin: -insetTop + "px " + -insetRight + "px " + -insetBottom + "px " + -insetLeft + "px",
			threshold: max(0, min(1, threshold)) || 1
		};
		let isFirstUpdate = true;
		function handleObserve(entries) {
			const ratio = entries[0].intersectionRatio;
			if (ratio !== threshold) {
				if (!isFirstUpdate) return refresh();
				if (!ratio) timeoutId = setTimeout(() => {
					refresh(false, 1e-7);
				}, 1e3);
				else refresh(false, ratio);
			}
			if (ratio === 1 && !rectsAreEqual(elementRectForRootMargin, element.getBoundingClientRect())) refresh();
			isFirstUpdate = false;
		}
		try {
			io = new IntersectionObserver(handleObserve, {
				...options,
				root: root.ownerDocument
			});
		} catch (_e) {
			io = new IntersectionObserver(handleObserve, options);
		}
		io.observe(element);
	}
	refresh(true);
	return cleanup;
}
/**
* Automatically updates the position of the floating element when necessary.
* Should only be called when the floating element is mounted on the DOM or
* visible on the screen.
* @returns cleanup function that should be invoked when the floating element is
* removed from the DOM or hidden from the screen.
* @see https://floating-ui.com/docs/autoUpdate
*/
function autoUpdate(reference, floating, update, options) {
	if (options === void 0) options = {};
	const { ancestorScroll = true, ancestorResize = true, elementResize = typeof ResizeObserver === "function", layoutShift = typeof IntersectionObserver === "function", animationFrame = false } = options;
	const referenceEl = unwrapElement(reference);
	const ancestors = ancestorScroll || ancestorResize ? [...referenceEl ? getOverflowAncestors(referenceEl) : [], ...floating ? getOverflowAncestors(floating) : []] : [];
	ancestors.forEach((ancestor) => {
		ancestorScroll && ancestor.addEventListener("scroll", update, { passive: true });
		ancestorResize && ancestor.addEventListener("resize", update);
	});
	const cleanupIo = referenceEl && layoutShift ? observeMove(referenceEl, update) : null;
	let reobserveFrame = -1;
	let resizeObserver = null;
	if (elementResize) {
		resizeObserver = new ResizeObserver((_ref) => {
			let [firstEntry] = _ref;
			if (firstEntry && firstEntry.target === referenceEl && resizeObserver && floating) {
				resizeObserver.unobserve(floating);
				cancelAnimationFrame(reobserveFrame);
				reobserveFrame = requestAnimationFrame(() => {
					var _resizeObserver;
					(_resizeObserver = resizeObserver) == null || _resizeObserver.observe(floating);
				});
			}
			update();
		});
		if (referenceEl && !animationFrame) resizeObserver.observe(referenceEl);
		if (floating) resizeObserver.observe(floating);
	}
	let frameId;
	let prevRefRect = animationFrame ? getBoundingClientRect(reference) : null;
	if (animationFrame) frameLoop();
	function frameLoop() {
		const nextRefRect = getBoundingClientRect(reference);
		if (prevRefRect && !rectsAreEqual(prevRefRect, nextRefRect)) update();
		prevRefRect = nextRefRect;
		frameId = requestAnimationFrame(frameLoop);
	}
	update();
	return () => {
		var _resizeObserver2;
		ancestors.forEach((ancestor) => {
			ancestorScroll && ancestor.removeEventListener("scroll", update);
			ancestorResize && ancestor.removeEventListener("resize", update);
		});
		cleanupIo?.();
		(_resizeObserver2 = resizeObserver) == null || _resizeObserver2.disconnect();
		resizeObserver = null;
		if (animationFrame) cancelAnimationFrame(frameId);
	};
}
/**
* Modifies the placement by translating the floating element along the
* specified axes.
* A number (shorthand for `mainAxis` or distance), or an axes configuration
* object may be passed.
* @see https://floating-ui.com/docs/offset
*/
var offset$1 = offset$2;
/**
* Optimizes the visibility of the floating element by shifting it in order to
* keep it in view when it will overflow the clipping boundary.
* @see https://floating-ui.com/docs/shift
*/
var shift$1 = shift$2;
/**
* Optimizes the visibility of the floating element by flipping the `placement`
* in order to keep it in view when the preferred placement(s) will overflow the
* clipping boundary. Alternative to `autoPlacement`.
* @see https://floating-ui.com/docs/flip
*/
var flip$1 = flip$2;
/**
* Provides data that allows you to change the size of the floating element —
* for instance, prevent it from overflowing the clipping boundary or match the
* width of the reference element.
* @see https://floating-ui.com/docs/size
*/
var size$1 = size$2;
/**
* Provides data to hide the floating element in applicable situations, such as
* when it is not in the same clipping context as the reference element.
* @see https://floating-ui.com/docs/hide
*/
var hide$1 = hide$2;
/**
* Provides data to position an inner element of the floating element so that it
* appears centered to the reference element.
* @see https://floating-ui.com/docs/arrow
*/
var arrow$2 = arrow$3;
/**
* Built-in `limiter` that will stop `shift()` at a certain point.
*/
var limitShift$1 = limitShift$2;
/**
* Computes the `x` and `y` coordinates that will place the floating element
* next to a given reference element.
*/
var computePosition = (reference, floating, options) => {
	const cache = /* @__PURE__ */ new Map();
	const mergedOptions = {
		platform,
		...options
	};
	const platformWithCache = {
		...mergedOptions.platform,
		_c: cache
	};
	return computePosition$1(reference, floating, {
		...mergedOptions,
		platform: platformWithCache
	});
};
//#endregion
//#region node_modules/@floating-ui/react-dom/dist/floating-ui.react-dom.mjs
var index = typeof document !== "undefined" ? import_react.useLayoutEffect : function noop() {};
function deepEqual(a, b) {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a === "function" && a.toString() === b.toString()) return true;
	let length;
	let i;
	let keys;
	if (a && b && typeof a === "object") {
		if (Array.isArray(a)) {
			length = a.length;
			if (length !== b.length) return false;
			for (i = length; i-- !== 0;) if (!deepEqual(a[i], b[i])) return false;
			return true;
		}
		keys = Object.keys(a);
		length = keys.length;
		if (length !== Object.keys(b).length) return false;
		for (i = length; i-- !== 0;) if (!{}.hasOwnProperty.call(b, keys[i])) return false;
		for (i = length; i-- !== 0;) {
			const key = keys[i];
			if (key === "_owner" && a.$$typeof) continue;
			if (!deepEqual(a[key], b[key])) return false;
		}
		return true;
	}
	return a !== a && b !== b;
}
function getDPR(element) {
	if (typeof window === "undefined") return 1;
	return (element.ownerDocument.defaultView || window).devicePixelRatio || 1;
}
function roundByDPR(element, value) {
	const dpr = getDPR(element);
	return Math.round(value * dpr) / dpr;
}
function useLatestRef(value) {
	const ref = import_react.useRef(value);
	index(() => {
		ref.current = value;
	});
	return ref;
}
/**
* Provides data to position a floating element.
* @see https://floating-ui.com/docs/useFloating
*/
function useFloating(options) {
	if (options === void 0) options = {};
	const { placement = "bottom", strategy = "absolute", middleware = [], platform, elements: { reference: externalReference, floating: externalFloating } = {}, transform = true, whileElementsMounted, open } = options;
	const [data, setData] = import_react.useState({
		x: 0,
		y: 0,
		strategy,
		placement,
		middlewareData: {},
		isPositioned: false
	});
	const [latestMiddleware, setLatestMiddleware] = import_react.useState(middleware);
	if (!deepEqual(latestMiddleware, middleware)) setLatestMiddleware(middleware);
	const [_reference, _setReference] = import_react.useState(null);
	const [_floating, _setFloating] = import_react.useState(null);
	const setReference = import_react.useCallback((node) => {
		if (node !== referenceRef.current) {
			referenceRef.current = node;
			_setReference(node);
		}
	}, []);
	const setFloating = import_react.useCallback((node) => {
		if (node !== floatingRef.current) {
			floatingRef.current = node;
			_setFloating(node);
		}
	}, []);
	const referenceEl = externalReference || _reference;
	const floatingEl = externalFloating || _floating;
	const referenceRef = import_react.useRef(null);
	const floatingRef = import_react.useRef(null);
	const dataRef = import_react.useRef(data);
	const hasWhileElementsMounted = whileElementsMounted != null;
	const whileElementsMountedRef = useLatestRef(whileElementsMounted);
	const platformRef = useLatestRef(platform);
	const openRef = useLatestRef(open);
	const update = import_react.useCallback(() => {
		if (!referenceRef.current || !floatingRef.current) return;
		const config = {
			placement,
			strategy,
			middleware: latestMiddleware
		};
		if (platformRef.current) config.platform = platformRef.current;
		computePosition(referenceRef.current, floatingRef.current, config).then((data) => {
			const fullData = {
				...data,
				isPositioned: openRef.current !== false
			};
			if (isMountedRef.current && !deepEqual(dataRef.current, fullData)) {
				dataRef.current = fullData;
				import_react_dom.flushSync(() => {
					setData(fullData);
				});
			}
		});
	}, [
		latestMiddleware,
		placement,
		strategy,
		platformRef,
		openRef
	]);
	index(() => {
		if (open === false && dataRef.current.isPositioned) {
			dataRef.current.isPositioned = false;
			setData((data) => ({
				...data,
				isPositioned: false
			}));
		}
	}, [open]);
	const isMountedRef = import_react.useRef(false);
	index(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);
	index(() => {
		if (referenceEl) referenceRef.current = referenceEl;
		if (floatingEl) floatingRef.current = floatingEl;
		if (referenceEl && floatingEl) {
			if (whileElementsMountedRef.current) return whileElementsMountedRef.current(referenceEl, floatingEl, update);
			update();
		}
	}, [
		referenceEl,
		floatingEl,
		update,
		whileElementsMountedRef,
		hasWhileElementsMounted
	]);
	const refs = import_react.useMemo(() => ({
		reference: referenceRef,
		floating: floatingRef,
		setReference,
		setFloating
	}), [setReference, setFloating]);
	const elements = import_react.useMemo(() => ({
		reference: referenceEl,
		floating: floatingEl
	}), [referenceEl, floatingEl]);
	const floatingStyles = import_react.useMemo(() => {
		const initialStyles = {
			position: strategy,
			left: 0,
			top: 0
		};
		if (!elements.floating) return initialStyles;
		const x = roundByDPR(elements.floating, data.x);
		const y = roundByDPR(elements.floating, data.y);
		if (transform) return {
			...initialStyles,
			transform: "translate(" + x + "px, " + y + "px)",
			...getDPR(elements.floating) >= 1.5 && { willChange: "transform" }
		};
		return {
			position: strategy,
			left: x,
			top: y
		};
	}, [
		strategy,
		transform,
		elements.floating,
		data.x,
		data.y
	]);
	return import_react.useMemo(() => ({
		...data,
		update,
		refs,
		elements,
		floatingStyles
	}), [
		data,
		update,
		refs,
		elements,
		floatingStyles
	]);
}
/**
* Provides data to position an inner element of the floating element so that it
* appears centered to the reference element.
* This wraps the core `arrow` middleware to allow React refs as the element.
* @see https://floating-ui.com/docs/arrow
*/
var arrow$1 = (options) => {
	function isRef(value) {
		return {}.hasOwnProperty.call(value, "current");
	}
	return {
		name: "arrow",
		options,
		fn(state) {
			const { element, padding } = typeof options === "function" ? options(state) : options;
			if (element && isRef(element)) {
				if (element.current != null) return arrow$2({
					element: element.current,
					padding
				}).fn(state);
				return {};
			}
			if (element) return arrow$2({
				element,
				padding
			}).fn(state);
			return {};
		}
	};
};
/**
* Modifies the placement by translating the floating element along the
* specified axes.
* A number (shorthand for `mainAxis` or distance), or an axes configuration
* object may be passed.
* @see https://floating-ui.com/docs/offset
*/
var offset = (options, deps) => {
	const result = offset$1(options);
	return {
		name: result.name,
		fn: result.fn,
		options: [options, deps]
	};
};
/**
* Optimizes the visibility of the floating element by shifting it in order to
* keep it in view when it will overflow the clipping boundary.
* @see https://floating-ui.com/docs/shift
*/
var shift = (options, deps) => {
	const result = shift$1(options);
	return {
		name: result.name,
		fn: result.fn,
		options: [options, deps]
	};
};
/**
* Built-in `limiter` that will stop `shift()` at a certain point.
*/
var limitShift = (options, deps) => {
	return {
		fn: limitShift$1(options).fn,
		options: [options, deps]
	};
};
/**
* Optimizes the visibility of the floating element by flipping the `placement`
* in order to keep it in view when the preferred placement(s) will overflow the
* clipping boundary. Alternative to `autoPlacement`.
* @see https://floating-ui.com/docs/flip
*/
var flip = (options, deps) => {
	const result = flip$1(options);
	return {
		name: result.name,
		fn: result.fn,
		options: [options, deps]
	};
};
/**
* Provides data that allows you to change the size of the floating element —
* for instance, prevent it from overflowing the clipping boundary or match the
* width of the reference element.
* @see https://floating-ui.com/docs/size
*/
var size = (options, deps) => {
	const result = size$1(options);
	return {
		name: result.name,
		fn: result.fn,
		options: [options, deps]
	};
};
/**
* Provides data to hide the floating element in applicable situations, such as
* when it is not in the same clipping context as the reference element.
* @see https://floating-ui.com/docs/hide
*/
var hide = (options, deps) => {
	const result = hide$1(options);
	return {
		name: result.name,
		fn: result.fn,
		options: [options, deps]
	};
};
/**
* Provides data to position an inner element of the floating element so that it
* appears centered to the reference element.
* This wraps the core `arrow` middleware to allow React refs as the element.
* @see https://floating-ui.com/docs/arrow
*/
var arrow = (options, deps) => {
	const result = arrow$1(options);
	return {
		name: result.name,
		fn: result.fn,
		options: [options, deps]
	};
};
//#endregion
//#region node_modules/@radix-ui/react-arrow/dist/index.mjs
var NAME$1 = "Arrow";
var Arrow$1 = import_react.forwardRef((props, forwardedRef) => {
	const { children, width = 10, height = 5, ...arrowProps } = props;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Primitive.svg, {
		...arrowProps,
		ref: forwardedRef,
		width,
		height,
		viewBox: "0 0 30 10",
		preserveAspectRatio: "none",
		children: props.asChild ? children : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("polygon", { points: "0,0 30,0 15,10" })
	});
});
Arrow$1.displayName = NAME$1;
var Root$1 = Arrow$1;
//#endregion
//#region node_modules/@radix-ui/react-use-size/dist/index.mjs
function useSize(element) {
	const [size, setSize] = import_react.useState(void 0);
	useLayoutEffect2(() => {
		if (element) {
			setSize({
				width: element.offsetWidth,
				height: element.offsetHeight
			});
			const resizeObserver = new ResizeObserver((entries) => {
				if (!Array.isArray(entries)) return;
				if (!entries.length) return;
				const entry = entries[0];
				let width;
				let height;
				if ("borderBoxSize" in entry) {
					const borderSizeEntry = entry["borderBoxSize"];
					const borderSize = Array.isArray(borderSizeEntry) ? borderSizeEntry[0] : borderSizeEntry;
					width = borderSize["inlineSize"];
					height = borderSize["blockSize"];
				} else {
					width = element.offsetWidth;
					height = element.offsetHeight;
				}
				setSize({
					width,
					height
				});
			});
			resizeObserver.observe(element, { box: "border-box" });
			return () => resizeObserver.unobserve(element);
		} else setSize(void 0);
	}, [element]);
	return size;
}
//#endregion
//#region node_modules/@radix-ui/react-popper/dist/index.mjs
var POPPER_NAME = "Popper";
var [createPopperContext, createPopperScope] = createContextScope(POPPER_NAME);
var [PopperProvider, usePopperContext] = createPopperContext(POPPER_NAME);
var Popper = (props) => {
	const { __scopePopper, children } = props;
	const [anchor, setAnchor] = import_react.useState(null);
	const [placementState, setPlacementState] = import_react.useState(void 0);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PopperProvider, {
		scope: __scopePopper,
		anchor,
		onAnchorChange: setAnchor,
		placementState,
		setPlacementState,
		children
	});
};
Popper.displayName = POPPER_NAME;
var ANCHOR_NAME = "PopperAnchor";
var PopperAnchor = import_react.forwardRef((props, forwardedRef) => {
	const { __scopePopper, virtualRef, ...anchorProps } = props;
	const context = usePopperContext(ANCHOR_NAME, __scopePopper);
	const ref = import_react.useRef(null);
	const onAnchorChange = context.onAnchorChange;
	const composedRefs = useComposedRefs(forwardedRef, import_react.useCallback((node) => {
		ref.current = node;
		if (node) onAnchorChange(node);
	}, [onAnchorChange]));
	const anchorRef = import_react.useRef(null);
	import_react.useEffect(() => {
		if (!virtualRef) return;
		const previousAnchor = anchorRef.current;
		anchorRef.current = virtualRef.current;
		if (previousAnchor !== anchorRef.current) onAnchorChange(anchorRef.current);
	});
	const sideAndAlign = context.placementState && getSideAndAlignFromPlacement(context.placementState);
	const placedSide = sideAndAlign?.[0];
	const placedAlign = sideAndAlign?.[1];
	return virtualRef ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Primitive.div, {
		"data-radix-popper-side": placedSide,
		"data-radix-popper-align": placedAlign,
		...anchorProps,
		ref: composedRefs
	});
});
PopperAnchor.displayName = ANCHOR_NAME;
var CONTENT_NAME$1 = "PopperContent";
var [PopperContentProvider, useContentContext] = createPopperContext(CONTENT_NAME$1);
var PopperContent = import_react.forwardRef((props, forwardedRef) => {
	const { __scopePopper, side = "bottom", sideOffset = 0, align = "center", alignOffset = 0, arrowPadding = 0, avoidCollisions = true, collisionBoundary, collisionPadding: collisionPaddingProp = 0, sticky = "partial", hideWhenDetached = false, updatePositionStrategy = "optimized", onPlaced, ...contentProps } = props;
	const context = usePopperContext(CONTENT_NAME$1, __scopePopper);
	const [content, setContent] = import_react.useState(null);
	const composedRefs = useComposedRefs(forwardedRef, (node) => setContent(node));
	const [arrow$4, setArrow] = import_react.useState(null);
	const arrowSize = useSize(arrow$4);
	const arrowWidth = arrowSize?.width ?? 0;
	const arrowHeight = arrowSize?.height ?? 0;
	const desiredPlacement = side + (align !== "center" ? "-" + align : "");
	const collisionPadding = typeof collisionPaddingProp === "number" ? collisionPaddingProp : {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		...collisionPaddingProp
	};
	const boundary = collisionBoundary ? Array.isArray(collisionBoundary) ? collisionBoundary : [collisionBoundary] : void 0;
	const hasExplicitBoundaries = boundary !== void 0 && boundary.length > 0;
	const detectOverflowOptions = {
		padding: collisionPadding,
		boundary: boundary?.filter(isNotNull),
		altBoundary: hasExplicitBoundaries
	};
	const { refs, floatingStyles, placement, isPositioned, middlewareData } = useFloating({
		strategy: "fixed",
		placement: desiredPlacement,
		whileElementsMounted: (...args) => {
			return autoUpdate(...args, { animationFrame: updatePositionStrategy === "always" });
		},
		elements: { reference: context.anchor },
		middleware: [
			offset({
				mainAxis: sideOffset + arrowHeight,
				alignmentAxis: alignOffset
			}),
			avoidCollisions && shift({
				mainAxis: true,
				crossAxis: false,
				limiter: sticky === "partial" ? limitShift() : void 0,
				...detectOverflowOptions
			}),
			avoidCollisions && flip({ ...detectOverflowOptions }),
			size({
				...detectOverflowOptions,
				apply: ({ elements, rects, availableWidth, availableHeight }) => {
					const { width: anchorWidth, height: anchorHeight } = rects.reference;
					const contentStyle = elements.floating.style;
					contentStyle.setProperty("--radix-popper-available-width", `${availableWidth}px`);
					contentStyle.setProperty("--radix-popper-available-height", `${availableHeight}px`);
					contentStyle.setProperty("--radix-popper-anchor-width", `${anchorWidth}px`);
					contentStyle.setProperty("--radix-popper-anchor-height", `${anchorHeight}px`);
				}
			}),
			arrow$4 && arrow({
				element: arrow$4,
				padding: arrowPadding
			}),
			transformOrigin({
				arrowWidth,
				arrowHeight
			}),
			hideWhenDetached && hide({
				strategy: "referenceHidden",
				...detectOverflowOptions
			})
		]
	});
	const setPlacementState = context.setPlacementState;
	useLayoutEffect2(() => {
		setPlacementState(placement);
		return () => {
			setPlacementState(void 0);
		};
	}, [placement, setPlacementState]);
	const [placedSide, placedAlign] = getSideAndAlignFromPlacement(placement);
	const handlePlaced = useCallbackRef(onPlaced);
	useLayoutEffect2(() => {
		if (isPositioned) handlePlaced?.();
	}, [isPositioned, handlePlaced]);
	const arrowX = middlewareData.arrow?.x;
	const arrowY = middlewareData.arrow?.y;
	const cannotCenterArrow = middlewareData.arrow?.centerOffset !== 0;
	const [contentZIndex, setContentZIndex] = import_react.useState();
	useLayoutEffect2(() => {
		if (content) setContentZIndex(window.getComputedStyle(content).zIndex);
	}, [content]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		ref: refs.setFloating,
		"data-radix-popper-content-wrapper": "",
		style: {
			...floatingStyles,
			transform: isPositioned ? floatingStyles.transform : "translate(0, -200%)",
			minWidth: "max-content",
			zIndex: contentZIndex,
			"--radix-popper-transform-origin": [middlewareData.transformOrigin?.x, middlewareData.transformOrigin?.y].join(" "),
			...middlewareData.hide?.referenceHidden && {
				visibility: "hidden",
				pointerEvents: "none"
			}
		},
		dir: props.dir,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PopperContentProvider, {
			scope: __scopePopper,
			placedSide,
			placedAlign,
			onArrowChange: setArrow,
			arrowX,
			arrowY,
			shouldHideArrow: cannotCenterArrow,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Primitive.div, {
				"data-side": placedSide,
				"data-align": placedAlign,
				...contentProps,
				ref: composedRefs,
				style: {
					...contentProps.style,
					animation: !isPositioned ? "none" : void 0
				}
			})
		})
	});
});
PopperContent.displayName = CONTENT_NAME$1;
var ARROW_NAME$1 = "PopperArrow";
var OPPOSITE_SIDE = {
	top: "bottom",
	right: "left",
	bottom: "top",
	left: "right"
};
var PopperArrow = import_react.forwardRef(function PopperArrow2(props, forwardedRef) {
	const { __scopePopper, ...arrowProps } = props;
	const contentContext = useContentContext(ARROW_NAME$1, __scopePopper);
	const baseSide = OPPOSITE_SIDE[contentContext.placedSide];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		ref: contentContext.onArrowChange,
		style: {
			position: "absolute",
			left: contentContext.arrowX,
			top: contentContext.arrowY,
			[baseSide]: 0,
			transformOrigin: {
				top: "",
				right: "0 0",
				bottom: "center 0",
				left: "100% 0"
			}[contentContext.placedSide],
			transform: {
				top: "translateY(100%)",
				right: "translateY(50%) rotate(90deg) translateX(-50%)",
				bottom: `rotate(180deg)`,
				left: "translateY(50%) rotate(-90deg) translateX(50%)"
			}[contentContext.placedSide],
			visibility: contentContext.shouldHideArrow ? "hidden" : void 0
		},
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Root$1, {
			...arrowProps,
			ref: forwardedRef,
			style: {
				...arrowProps.style,
				display: "block"
			}
		})
	});
});
PopperArrow.displayName = ARROW_NAME$1;
function isNotNull(value) {
	return value !== null;
}
var transformOrigin = (options) => ({
	name: "transformOrigin",
	options,
	fn(data) {
		const { placement, rects, middlewareData } = data;
		const isArrowHidden = middlewareData.arrow?.centerOffset !== 0;
		const arrowWidth = isArrowHidden ? 0 : options.arrowWidth;
		const arrowHeight = isArrowHidden ? 0 : options.arrowHeight;
		const [placedSide, placedAlign] = getSideAndAlignFromPlacement(placement);
		const noArrowAlign = {
			start: "0%",
			center: "50%",
			end: "100%"
		}[placedAlign];
		const arrowXCenter = (middlewareData.arrow?.x ?? 0) + arrowWidth / 2;
		const arrowYCenter = (middlewareData.arrow?.y ?? 0) + arrowHeight / 2;
		let x = "";
		let y = "";
		if (placedSide === "bottom") {
			x = isArrowHidden ? noArrowAlign : `${arrowXCenter}px`;
			y = `${-arrowHeight}px`;
		} else if (placedSide === "top") {
			x = isArrowHidden ? noArrowAlign : `${arrowXCenter}px`;
			y = `${rects.floating.height + arrowHeight}px`;
		} else if (placedSide === "right") {
			x = `${-arrowHeight}px`;
			y = isArrowHidden ? noArrowAlign : `${arrowYCenter}px`;
		} else if (placedSide === "left") {
			x = `${rects.floating.width + arrowHeight}px`;
			y = isArrowHidden ? noArrowAlign : `${arrowYCenter}px`;
		}
		return { data: {
			x,
			y
		} };
	}
});
function getSideAndAlignFromPlacement(placement) {
	const [side, align = "center"] = placement.split("-");
	return [side, align];
}
var Root2 = Popper;
var Anchor = PopperAnchor;
var Content = PopperContent;
var Arrow = PopperArrow;
//#endregion
//#region node_modules/@radix-ui/react-portal/dist/index.mjs
var PORTAL_NAME$1 = "Portal";
var Portal$1 = import_react.forwardRef((props, forwardedRef) => {
	const { container: containerProp, ...portalProps } = props;
	const [mounted, setMounted] = import_react.useState(false);
	useLayoutEffect2(() => setMounted(true), []);
	const container = containerProp || mounted && globalThis?.document?.body;
	return container ? import_react_dom.createPortal(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Primitive.div, {
		...portalProps,
		ref: forwardedRef
	}), container) : null;
});
Portal$1.displayName = PORTAL_NAME$1;
//#endregion
//#region node_modules/@radix-ui/react-presence/dist/index.mjs
function useStateMachine(initialState, machine) {
	return import_react.useReducer((state, event) => {
		return machine[state][event] ?? state;
	}, initialState);
}
var Presence = (props) => {
	const { present, children } = props;
	const presence = usePresence(present);
	const child = typeof children === "function" ? children({ present: presence.isPresent }) : import_react.Children.only(children);
	const ref = useStableComposedRefs(presence.ref, getElementRef(child));
	return typeof children === "function" || presence.isPresent ? import_react.cloneElement(child, { ref }) : null;
};
Presence.displayName = "Presence";
function usePresence(present) {
	const [node, setNode] = import_react.useState();
	const stylesRef = import_react.useRef(null);
	const prevPresentRef = import_react.useRef(present);
	const prevAnimationNameRef = import_react.useRef("none");
	const [state, send] = useStateMachine(present ? "mounted" : "unmounted", {
		mounted: {
			UNMOUNT: "unmounted",
			ANIMATION_OUT: "unmountSuspended"
		},
		unmountSuspended: {
			MOUNT: "mounted",
			ANIMATION_END: "unmounted"
		},
		unmounted: { MOUNT: "mounted" }
	});
	import_react.useEffect(() => {
		const currentAnimationName = getAnimationName(stylesRef.current);
		prevAnimationNameRef.current = state === "mounted" ? currentAnimationName : "none";
	}, [state]);
	useLayoutEffect2(() => {
		const styles = stylesRef.current;
		const wasPresent = prevPresentRef.current;
		if (wasPresent !== present) {
			const prevAnimationName = prevAnimationNameRef.current;
			const currentAnimationName = getAnimationName(styles);
			if (present) send("MOUNT");
			else if (currentAnimationName === "none" || styles?.display === "none") send("UNMOUNT");
			else if (wasPresent && prevAnimationName !== currentAnimationName) send("ANIMATION_OUT");
			else send("UNMOUNT");
			prevPresentRef.current = present;
		}
	}, [present, send]);
	useLayoutEffect2(() => {
		if (node) {
			let timeoutId;
			const ownerWindow = node.ownerDocument.defaultView ?? window;
			const handleAnimationEnd = (event) => {
				const isCurrentAnimation = getAnimationName(stylesRef.current).includes(CSS.escape(event.animationName));
				if (event.target === node && isCurrentAnimation) {
					send("ANIMATION_END");
					if (!prevPresentRef.current) {
						const currentFillMode = node.style.animationFillMode;
						node.style.animationFillMode = "forwards";
						timeoutId = ownerWindow.setTimeout(() => {
							if (node.style.animationFillMode === "forwards") node.style.animationFillMode = currentFillMode;
						});
					}
				}
			};
			const handleAnimationStart = (event) => {
				if (event.target === node) prevAnimationNameRef.current = getAnimationName(stylesRef.current);
			};
			node.addEventListener("animationstart", handleAnimationStart);
			node.addEventListener("animationcancel", handleAnimationEnd);
			node.addEventListener("animationend", handleAnimationEnd);
			return () => {
				ownerWindow.clearTimeout(timeoutId);
				node.removeEventListener("animationstart", handleAnimationStart);
				node.removeEventListener("animationcancel", handleAnimationEnd);
				node.removeEventListener("animationend", handleAnimationEnd);
			};
		} else send("ANIMATION_END");
	}, [node, send]);
	return {
		isPresent: ["mounted", "unmountSuspended"].includes(state),
		ref: import_react.useCallback((node2) => {
			stylesRef.current = node2 ? getComputedStyle(node2) : null;
			setNode(node2);
		}, [])
	};
}
function setRef(ref, value) {
	if (typeof ref === "function") return ref(value);
	else if (ref !== null && ref !== void 0) ref.current = value;
}
function useStableComposedRefs(...refs) {
	const refsRef = import_react.useRef(refs);
	refsRef.current = refs;
	return import_react.useCallback((node) => {
		const currentRefs = refsRef.current;
		let hasCleanup = false;
		const cleanups = currentRefs.map((ref) => {
			const cleanup = setRef(ref, node);
			if (!hasCleanup && typeof cleanup === "function") hasCleanup = true;
			return cleanup;
		});
		if (hasCleanup) return () => {
			for (let i = 0; i < cleanups.length; i++) {
				const cleanup = cleanups[i];
				if (typeof cleanup === "function") cleanup();
				else setRef(currentRefs[i], null);
			}
		};
	}, []);
}
function getAnimationName(styles) {
	return styles?.animationName || "none";
}
function getElementRef(element) {
	let getter = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
	let mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
	if (mayWarn) return element.ref;
	getter = Object.getOwnPropertyDescriptor(element, "ref")?.get;
	mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
	if (mayWarn) return element.props.ref;
	return element.props.ref || element.ref;
}
//#endregion
//#region node_modules/@radix-ui/react-use-controllable-state/dist/index.mjs
var useInsertionEffect = import_react[" useInsertionEffect ".trim().toString()] || useLayoutEffect2;
function useControllableState({ prop, defaultProp, onChange = () => {}, caller }) {
	const [uncontrolledProp, setUncontrolledProp, onChangeRef] = useUncontrolledState({
		defaultProp,
		onChange
	});
	const isControlled = prop !== void 0;
	const value = isControlled ? prop : uncontrolledProp;
	{
		const isControlledRef = import_react.useRef(prop !== void 0);
		import_react.useEffect(() => {
			const wasControlled = isControlledRef.current;
			if (wasControlled !== isControlled) console.warn(`${caller} is changing from ${wasControlled ? "controlled" : "uncontrolled"} to ${isControlled ? "controlled" : "uncontrolled"}. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using a controlled or uncontrolled value for the lifetime of the component.`);
			isControlledRef.current = isControlled;
		}, [isControlled, caller]);
	}
	return [value, import_react.useCallback((nextValue) => {
		if (isControlled) {
			const value2 = isFunction(nextValue) ? nextValue(prop) : nextValue;
			if (value2 !== prop) onChangeRef.current?.(value2);
		} else setUncontrolledProp(nextValue);
	}, [
		isControlled,
		prop,
		setUncontrolledProp,
		onChangeRef
	])];
}
function useUncontrolledState({ defaultProp, onChange }) {
	const [value, setValue] = import_react.useState(defaultProp);
	const prevValueRef = import_react.useRef(value);
	const onChangeRef = import_react.useRef(onChange);
	useInsertionEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);
	import_react.useEffect(() => {
		if (prevValueRef.current !== value) {
			onChangeRef.current?.(value);
			prevValueRef.current = value;
		}
	}, [value, prevValueRef]);
	return [
		value,
		setValue,
		onChangeRef
	];
}
function isFunction(value) {
	return typeof value === "function";
}
//#endregion
//#region node_modules/@radix-ui/react-visually-hidden/dist/index.mjs
var VISUALLY_HIDDEN_STYLES = Object.freeze({
	position: "absolute",
	border: 0,
	width: 1,
	height: 1,
	padding: 0,
	margin: -1,
	overflow: "hidden",
	clip: "rect(0, 0, 0, 0)",
	whiteSpace: "nowrap",
	wordWrap: "normal"
});
var NAME = "VisuallyHidden";
var VisuallyHidden = import_react.forwardRef((props, forwardedRef) => {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Primitive.span, {
		...props,
		ref: forwardedRef,
		style: {
			...VISUALLY_HIDDEN_STYLES,
			...props.style
		}
	});
});
VisuallyHidden.displayName = NAME;
var Root = VisuallyHidden;
//#endregion
//#region node_modules/@radix-ui/react-tooltip/dist/index.mjs
var [createTooltipContext, createTooltipScope] = createContextScope("Tooltip", [createPopperScope]);
var usePopperScope = createPopperScope();
var PROVIDER_NAME = "TooltipProvider";
var DEFAULT_DELAY_DURATION = 700;
var TOOLTIP_OPEN = "tooltip.open";
var [TooltipProviderContextProvider, useTooltipProviderContext] = createTooltipContext(PROVIDER_NAME);
var TooltipProvider = (props) => {
	const { __scopeTooltip, delayDuration = DEFAULT_DELAY_DURATION, skipDelayDuration = 300, disableHoverableContent = false, children } = props;
	const isOpenDelayedRef = import_react.useRef(true);
	const isPointerInTransitRef = import_react.useRef(false);
	const skipDelayTimerRef = import_react.useRef(0);
	import_react.useEffect(() => {
		const skipDelayTimer = skipDelayTimerRef.current;
		return () => window.clearTimeout(skipDelayTimer);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TooltipProviderContextProvider, {
		scope: __scopeTooltip,
		isOpenDelayedRef,
		delayDuration,
		onOpen: import_react.useCallback(() => {
			if (skipDelayDuration <= 0) return;
			window.clearTimeout(skipDelayTimerRef.current);
			isOpenDelayedRef.current = false;
		}, [skipDelayDuration]),
		onClose: import_react.useCallback(() => {
			if (skipDelayDuration <= 0) return;
			window.clearTimeout(skipDelayTimerRef.current);
			skipDelayTimerRef.current = window.setTimeout(() => isOpenDelayedRef.current = true, skipDelayDuration);
		}, [skipDelayDuration]),
		isPointerInTransitRef,
		onPointerInTransitChange: import_react.useCallback((inTransit) => {
			isPointerInTransitRef.current = inTransit;
		}, []),
		disableHoverableContent,
		children
	});
};
TooltipProvider.displayName = PROVIDER_NAME;
var TOOLTIP_NAME = "Tooltip";
var [TooltipContextProvider, useTooltipContext] = createTooltipContext(TOOLTIP_NAME);
var Tooltip$1 = (props) => {
	const { __scopeTooltip, children, open: openProp, defaultOpen, onOpenChange, disableHoverableContent: disableHoverableContentProp, delayDuration: delayDurationProp } = props;
	const providerContext = useTooltipProviderContext(TOOLTIP_NAME, props.__scopeTooltip);
	const popperScope = usePopperScope(__scopeTooltip);
	const [trigger, setTrigger] = import_react.useState(null);
	const contentId = useId();
	const openTimerRef = import_react.useRef(0);
	const disableHoverableContent = disableHoverableContentProp ?? providerContext.disableHoverableContent;
	const delayDuration = delayDurationProp ?? providerContext.delayDuration;
	const wasOpenDelayedRef = import_react.useRef(false);
	const [open, setOpen] = useControllableState({
		prop: openProp,
		defaultProp: defaultOpen ?? false,
		onChange: (open2) => {
			if (open2) {
				providerContext.onOpen();
				document.dispatchEvent(new CustomEvent(TOOLTIP_OPEN));
			} else providerContext.onClose();
			onOpenChange?.(open2);
		},
		caller: TOOLTIP_NAME
	});
	const stateAttribute = import_react.useMemo(() => {
		return open ? wasOpenDelayedRef.current ? "delayed-open" : "instant-open" : "closed";
	}, [open]);
	const handleOpen = import_react.useCallback(() => {
		window.clearTimeout(openTimerRef.current);
		openTimerRef.current = 0;
		wasOpenDelayedRef.current = false;
		setOpen(true);
	}, [setOpen]);
	const handleClose = import_react.useCallback(() => {
		window.clearTimeout(openTimerRef.current);
		openTimerRef.current = 0;
		setOpen(false);
	}, [setOpen]);
	const handleDelayedOpen = import_react.useCallback(() => {
		window.clearTimeout(openTimerRef.current);
		openTimerRef.current = window.setTimeout(() => {
			wasOpenDelayedRef.current = true;
			setOpen(true);
			openTimerRef.current = 0;
		}, delayDuration);
	}, [delayDuration, setOpen]);
	import_react.useEffect(() => {
		return () => {
			if (openTimerRef.current) {
				window.clearTimeout(openTimerRef.current);
				openTimerRef.current = 0;
			}
		};
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Root2, {
		...popperScope,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TooltipContextProvider, {
			scope: __scopeTooltip,
			contentId,
			open,
			stateAttribute,
			trigger,
			onTriggerChange: setTrigger,
			onTriggerEnter: import_react.useCallback(() => {
				if (providerContext.isOpenDelayedRef.current) handleDelayedOpen();
				else handleOpen();
			}, [
				providerContext.isOpenDelayedRef,
				handleDelayedOpen,
				handleOpen
			]),
			onTriggerLeave: import_react.useCallback(() => {
				if (disableHoverableContent) handleClose();
				else {
					window.clearTimeout(openTimerRef.current);
					openTimerRef.current = 0;
				}
			}, [handleClose, disableHoverableContent]),
			onOpen: handleOpen,
			onClose: handleClose,
			disableHoverableContent,
			children
		})
	});
};
Tooltip$1.displayName = TOOLTIP_NAME;
var TRIGGER_NAME = "TooltipTrigger";
var TooltipTrigger = import_react.forwardRef((props, forwardedRef) => {
	const { __scopeTooltip, ...triggerProps } = props;
	const context = useTooltipContext(TRIGGER_NAME, __scopeTooltip);
	const providerContext = useTooltipProviderContext(TRIGGER_NAME, __scopeTooltip);
	const popperScope = usePopperScope(__scopeTooltip);
	const composedRefs = useComposedRefs(forwardedRef, import_react.useRef(null), context.onTriggerChange);
	const isPointerDownRef = import_react.useRef(false);
	const hasPointerMoveOpenedRef = import_react.useRef(false);
	const handlePointerUp = import_react.useCallback(() => isPointerDownRef.current = false, []);
	import_react.useEffect(() => {
		return () => document.removeEventListener("pointerup", handlePointerUp);
	}, [handlePointerUp]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Anchor, {
		asChild: true,
		...popperScope,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Primitive.button, {
			"aria-describedby": context.open ? context.contentId : void 0,
			"data-state": context.stateAttribute,
			...triggerProps,
			ref: composedRefs,
			onPointerMove: composeEventHandlers(props.onPointerMove, (event) => {
				if (event.pointerType === "touch") return;
				if (!hasPointerMoveOpenedRef.current && !providerContext.isPointerInTransitRef.current) {
					context.onTriggerEnter();
					hasPointerMoveOpenedRef.current = true;
				}
			}),
			onPointerLeave: composeEventHandlers(props.onPointerLeave, () => {
				context.onTriggerLeave();
				hasPointerMoveOpenedRef.current = false;
			}),
			onPointerDown: composeEventHandlers(props.onPointerDown, () => {
				if (context.open) context.onClose();
				isPointerDownRef.current = true;
				document.addEventListener("pointerup", handlePointerUp, { once: true });
			}),
			onFocus: composeEventHandlers(props.onFocus, () => {
				if (!isPointerDownRef.current) context.onOpen();
			}),
			onBlur: composeEventHandlers(props.onBlur, context.onClose),
			onClick: composeEventHandlers(props.onClick, context.onClose)
		})
	});
});
TooltipTrigger.displayName = TRIGGER_NAME;
var PORTAL_NAME = "TooltipPortal";
var [PortalProvider, usePortalContext] = createTooltipContext(PORTAL_NAME, { forceMount: void 0 });
var TooltipPortal = (props) => {
	const { __scopeTooltip, forceMount, children, container } = props;
	const context = useTooltipContext(PORTAL_NAME, __scopeTooltip);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PortalProvider, {
		scope: __scopeTooltip,
		forceMount,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Presence, {
			present: forceMount || context.open,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Portal$1, {
				asChild: true,
				container,
				children
			})
		})
	});
};
TooltipPortal.displayName = PORTAL_NAME;
var CONTENT_NAME = "TooltipContent";
var TooltipContent = import_react.forwardRef((props, forwardedRef) => {
	const portalContext = usePortalContext(CONTENT_NAME, props.__scopeTooltip);
	const { forceMount = portalContext.forceMount, side = "top", ...contentProps } = props;
	const context = useTooltipContext(CONTENT_NAME, props.__scopeTooltip);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Presence, {
		present: forceMount || context.open,
		children: context.disableHoverableContent ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TooltipContentImpl, {
			side,
			...contentProps,
			ref: forwardedRef
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TooltipContentHoverable, {
			side,
			...contentProps,
			ref: forwardedRef
		})
	});
});
var TooltipContentHoverable = import_react.forwardRef((props, forwardedRef) => {
	const context = useTooltipContext(CONTENT_NAME, props.__scopeTooltip);
	const providerContext = useTooltipProviderContext(CONTENT_NAME, props.__scopeTooltip);
	const ref = import_react.useRef(null);
	const composedRefs = useComposedRefs(forwardedRef, ref);
	const [pointerGraceArea, setPointerGraceArea] = import_react.useState(null);
	const { trigger, onClose } = context;
	const content = ref.current;
	const { onPointerInTransitChange } = providerContext;
	const handleRemoveGraceArea = import_react.useCallback(() => {
		setPointerGraceArea(null);
		onPointerInTransitChange(false);
	}, [onPointerInTransitChange]);
	const handleCreateGraceArea = import_react.useCallback((event, hoverTarget) => {
		const currentTarget = event.currentTarget;
		const exitPoint = {
			x: event.clientX,
			y: event.clientY
		};
		const paddedExitPoints = getPaddedExitPoints(exitPoint, getExitSideFromRect(exitPoint, currentTarget.getBoundingClientRect()));
		const hoverTargetPoints = getPointsFromRect(hoverTarget.getBoundingClientRect());
		setPointerGraceArea(getHull([...paddedExitPoints, ...hoverTargetPoints]));
		onPointerInTransitChange(true);
	}, [onPointerInTransitChange]);
	import_react.useEffect(() => {
		return () => handleRemoveGraceArea();
	}, [handleRemoveGraceArea]);
	import_react.useEffect(() => {
		if (trigger && content) {
			const handleTriggerLeave = (event) => handleCreateGraceArea(event, content);
			const handleContentLeave = (event) => handleCreateGraceArea(event, trigger);
			trigger.addEventListener("pointerleave", handleTriggerLeave);
			content.addEventListener("pointerleave", handleContentLeave);
			return () => {
				trigger.removeEventListener("pointerleave", handleTriggerLeave);
				content.removeEventListener("pointerleave", handleContentLeave);
			};
		}
	}, [
		trigger,
		content,
		handleCreateGraceArea,
		handleRemoveGraceArea
	]);
	import_react.useEffect(() => {
		if (pointerGraceArea) {
			const handleTrackPointerGrace = (event) => {
				const target = event.target;
				const pointerPosition = {
					x: event.clientX,
					y: event.clientY
				};
				const hasEnteredTarget = trigger?.contains(target) || content?.contains(target);
				const isPointerOutsideGraceArea = !isPointInPolygon(pointerPosition, pointerGraceArea);
				if (hasEnteredTarget) handleRemoveGraceArea();
				else if (isPointerOutsideGraceArea) {
					handleRemoveGraceArea();
					onClose();
				}
			};
			document.addEventListener("pointermove", handleTrackPointerGrace);
			return () => document.removeEventListener("pointermove", handleTrackPointerGrace);
		}
	}, [
		trigger,
		content,
		pointerGraceArea,
		onClose,
		handleRemoveGraceArea
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TooltipContentImpl, {
		...props,
		ref: composedRefs
	});
});
var [VisuallyHiddenContentContextProvider, useVisuallyHiddenContentContext] = createTooltipContext(TOOLTIP_NAME, { isInside: false });
var Slottable = createSlottable("TooltipContent");
var TooltipContentImpl = import_react.forwardRef((props, forwardedRef) => {
	const { __scopeTooltip, children, "aria-label": ariaLabel, onEscapeKeyDown, onPointerDownOutside, ...contentProps } = props;
	const context = useTooltipContext(CONTENT_NAME, __scopeTooltip);
	const popperScope = usePopperScope(__scopeTooltip);
	const { onClose } = context;
	import_react.useEffect(() => {
		document.addEventListener(TOOLTIP_OPEN, onClose);
		return () => document.removeEventListener(TOOLTIP_OPEN, onClose);
	}, [onClose]);
	import_react.useEffect(() => {
		if (context.trigger) {
			const handleScroll = (event) => {
				if (event.target instanceof Node && event.target.contains(context.trigger)) onClose();
			};
			window.addEventListener("scroll", handleScroll, { capture: true });
			return () => window.removeEventListener("scroll", handleScroll, { capture: true });
		}
	}, [context.trigger, onClose]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DismissableLayer, {
		asChild: true,
		disableOutsidePointerEvents: false,
		onEscapeKeyDown,
		onPointerDownOutside,
		onFocusOutside: (event) => event.preventDefault(),
		onDismiss: onClose,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Content, {
			"data-state": context.stateAttribute,
			...popperScope,
			...contentProps,
			ref: forwardedRef,
			style: {
				...contentProps.style,
				"--radix-tooltip-content-transform-origin": "var(--radix-popper-transform-origin)",
				"--radix-tooltip-content-available-width": "var(--radix-popper-available-width)",
				"--radix-tooltip-content-available-height": "var(--radix-popper-available-height)",
				"--radix-tooltip-trigger-width": "var(--radix-popper-anchor-width)",
				"--radix-tooltip-trigger-height": "var(--radix-popper-anchor-height)"
			},
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Slottable, { children }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VisuallyHiddenContentContextProvider, {
				scope: __scopeTooltip,
				isInside: true,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Root, {
					id: context.contentId,
					role: "tooltip",
					children: ariaLabel || children
				})
			})]
		})
	});
});
TooltipContent.displayName = CONTENT_NAME;
var ARROW_NAME = "TooltipArrow";
var TooltipArrow = import_react.forwardRef((props, forwardedRef) => {
	const { __scopeTooltip, ...arrowProps } = props;
	const popperScope = usePopperScope(__scopeTooltip);
	return useVisuallyHiddenContentContext(ARROW_NAME, __scopeTooltip).isInside ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {
		...popperScope,
		...arrowProps,
		ref: forwardedRef
	});
});
TooltipArrow.displayName = ARROW_NAME;
function getExitSideFromRect(point, rect) {
	const top = Math.abs(rect.top - point.y);
	const bottom = Math.abs(rect.bottom - point.y);
	const right = Math.abs(rect.right - point.x);
	const left = Math.abs(rect.left - point.x);
	switch (Math.min(top, bottom, right, left)) {
		case left: return "left";
		case right: return "right";
		case top: return "top";
		case bottom: return "bottom";
		default: throw new Error("unreachable");
	}
}
function getPaddedExitPoints(exitPoint, exitSide, padding = 5) {
	const paddedExitPoints = [];
	switch (exitSide) {
		case "top":
			paddedExitPoints.push({
				x: exitPoint.x - padding,
				y: exitPoint.y + padding
			}, {
				x: exitPoint.x + padding,
				y: exitPoint.y + padding
			});
			break;
		case "bottom":
			paddedExitPoints.push({
				x: exitPoint.x - padding,
				y: exitPoint.y - padding
			}, {
				x: exitPoint.x + padding,
				y: exitPoint.y - padding
			});
			break;
		case "left":
			paddedExitPoints.push({
				x: exitPoint.x + padding,
				y: exitPoint.y - padding
			}, {
				x: exitPoint.x + padding,
				y: exitPoint.y + padding
			});
			break;
		case "right":
			paddedExitPoints.push({
				x: exitPoint.x - padding,
				y: exitPoint.y - padding
			}, {
				x: exitPoint.x - padding,
				y: exitPoint.y + padding
			});
			break;
	}
	return paddedExitPoints;
}
function getPointsFromRect(rect) {
	const { top, right, bottom, left } = rect;
	return [
		{
			x: left,
			y: top
		},
		{
			x: right,
			y: top
		},
		{
			x: right,
			y: bottom
		},
		{
			x: left,
			y: bottom
		}
	];
}
function isPointInPolygon(point, polygon) {
	const { x, y } = point;
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const ii = polygon[i];
		const jj = polygon[j];
		const xi = ii.x;
		const yi = ii.y;
		const xj = jj.x;
		const yj = jj.y;
		if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}
function getHull(points) {
	const newPoints = points.slice();
	newPoints.sort((a, b) => {
		if (a.x < b.x) return -1;
		else if (a.x > b.x) return 1;
		else if (a.y < b.y) return -1;
		else if (a.y > b.y) return 1;
		else return 0;
	});
	return getHullPresorted(newPoints);
}
function getHullPresorted(points) {
	if (points.length <= 1) return points.slice();
	const upperHull = [];
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		while (upperHull.length >= 2) {
			const q = upperHull[upperHull.length - 1];
			const r = upperHull[upperHull.length - 2];
			if ((q.x - r.x) * (p.y - r.y) >= (q.y - r.y) * (p.x - r.x)) upperHull.pop();
			else break;
		}
		upperHull.push(p);
	}
	upperHull.pop();
	const lowerHull = [];
	for (let i = points.length - 1; i >= 0; i--) {
		const p = points[i];
		while (lowerHull.length >= 2) {
			const q = lowerHull[lowerHull.length - 1];
			const r = lowerHull[lowerHull.length - 2];
			if ((q.x - r.x) * (p.y - r.y) >= (q.y - r.y) * (p.x - r.x)) lowerHull.pop();
			else break;
		}
		lowerHull.push(p);
	}
	lowerHull.pop();
	if (upperHull.length === 1 && lowerHull.length === 1 && upperHull[0].x === lowerHull[0].x && upperHull[0].y === lowerHull[0].y) return upperHull;
	else return upperHull.concat(lowerHull);
}
var Provider = TooltipProvider;
var Root3 = Tooltip$1;
var Trigger = TooltipTrigger;
var Portal = TooltipPortal;
var Content2 = TooltipContent;
//#endregion
//#region src/components/ui/tooltip.tsx
var TooltipPortalContainerContext = (0, import_react.createContext)(null);
function getSlideOffset(side) {
	switch (side) {
		case "top": return { y: 4 };
		case "bottom": return { y: -4 };
		case "left": return { x: 4 };
		case "right": return { x: -4 };
	}
}
function Tooltip(t0) {
	const $ = (0, import_compiler_runtime.c)(30);
	const { content, children, side: t1, sideOffset: t2, delayDuration: t3, className, forceOpen, onOpenChange: onOpenChangeProp } = t0;
	const side = t1 === void 0 ? "top" : t1;
	const sideOffset = t2 === void 0 ? 8 : t2;
	const delayDuration = t3 === void 0 ? 200 : t3;
	const [internalOpen, setInternalOpen] = (0, import_react.useState)(false);
	const open = forceOpen !== void 0 ? forceOpen : internalOpen;
	const [mounted, setMounted] = (0, import_react.useState)(false);
	const shape = useShape();
	const portalContainer = (0, import_react.useContext)(TooltipPortalContainerContext);
	let t4;
	let t5;
	if ($[0] !== open) {
		t4 = () => {
			if (open) setMounted(true);
		};
		t5 = [open];
		$[0] = open;
		$[1] = t4;
		$[2] = t5;
	} else {
		t4 = $[1];
		t5 = $[2];
	}
	(0, import_react.useEffect)(t4, t5);
	let t6;
	if ($[3] !== open) {
		t6 = () => {
			if (!open) setMounted(false);
		};
		$[3] = open;
		$[4] = t6;
	} else t6 = $[4];
	const handleExitComplete = t6;
	let t7;
	if ($[5] !== side) {
		t7 = getSlideOffset(side);
		$[5] = side;
		$[6] = t7;
	} else t7 = $[6];
	const slideOffset = t7;
	let t8;
	if ($[7] !== onOpenChangeProp) {
		t8 = (v) => {
			setInternalOpen(v);
			onOpenChangeProp?.(v);
		};
		$[7] = onOpenChangeProp;
		$[8] = t8;
	} else t8 = $[8];
	let t9;
	if ($[9] !== children) {
		t9 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trigger, { children });
		$[9] = children;
		$[10] = t9;
	} else t9 = $[10];
	let t10;
	if ($[11] !== className || $[12] !== content || $[13] !== handleExitComplete || $[14] !== mounted || $[15] !== open || $[16] !== portalContainer || $[17] !== shape || $[18] !== side || $[19] !== sideOffset || $[20] !== slideOffset) {
		t10 = mounted && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Portal, {
			forceMount: true,
			container: portalContainer ?? void 0,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Content2, {
				side,
				sideOffset,
				forceMount: true,
				className: "z-50",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
					className: cn("bg-foreground text-background text-[12px] px-2 py-1", shape.bg, className),
					style: { fontVariationSettings: fontWeights.medium },
					initial: {
						opacity: 0,
						...slideOffset
					},
					animate: {
						opacity: open ? 1 : 0,
						x: 0,
						y: 0
					},
					transition: open ? springs.fast : { duration: .1 },
					onAnimationComplete: handleExitComplete,
					children: content
				})
			})
		});
		$[11] = className;
		$[12] = content;
		$[13] = handleExitComplete;
		$[14] = mounted;
		$[15] = open;
		$[16] = portalContainer;
		$[17] = shape;
		$[18] = side;
		$[19] = sideOffset;
		$[20] = slideOffset;
		$[21] = t10;
	} else t10 = $[21];
	let t11;
	if ($[22] !== open || $[23] !== t10 || $[24] !== t8 || $[25] !== t9) {
		t11 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Root3, {
			open,
			onOpenChange: t8,
			children: [t9, t10]
		});
		$[22] = open;
		$[23] = t10;
		$[24] = t8;
		$[25] = t9;
		$[26] = t11;
	} else t11 = $[26];
	let t12;
	if ($[27] !== delayDuration || $[28] !== t11) {
		t12 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Provider, {
			delayDuration,
			children: t11
		});
		$[27] = delayDuration;
		$[28] = t11;
		$[29] = t12;
	} else t12 = $[29];
	return t12;
}
//#endregion
//#region @/components/ui/input-message.tsx
var useIsoLayoutEffect = typeof window !== "undefined" ? import_react.useLayoutEffect : import_react.useEffect;
var DEFAULT_ACCEPT = "image/png,image/jpeg,application/pdf";
function FilePreviewTile(t0) {
	const $ = (0, import_compiler_runtime.c)(17);
	const { file, onRemove, size } = t0;
	const XIcon = useIcon("x");
	let t1;
	let t2;
	if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
		t1 = {
			opacity: 0,
			scale: .9
		};
		t2 = {
			opacity: 1,
			scale: 1
		};
		$[0] = t1;
		$[1] = t2;
	} else {
		t1 = $[0];
		t2 = $[1];
	}
	let t3;
	if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
		t3 = {
			opacity: 0,
			scale: .9,
			transition: { duration: .06 }
		};
		$[2] = t3;
	} else t3 = $[2];
	let t4;
	if ($[3] !== file || $[4] !== size) {
		t4 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileThumbnail, {
			file,
			size
		});
		$[3] = file;
		$[4] = size;
		$[5] = t4;
	} else t4 = $[5];
	let t5;
	if ($[6] !== onRemove) {
		t5 = (e) => {
			e.stopPropagation();
			onRemove();
		};
		$[6] = onRemove;
		$[7] = t5;
	} else t5 = $[7];
	const t6 = `Remove ${file.name}`;
	let t7;
	if ($[8] !== XIcon) {
		t7 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(XIcon, {
			size: 12,
			strokeWidth: 2.5
		});
		$[8] = XIcon;
		$[9] = t7;
	} else t7 = $[9];
	let t8;
	if ($[10] !== t5 || $[11] !== t6 || $[12] !== t7) {
		t8 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tooltip, {
			content: "Remove",
			side: "top",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: t5,
				"aria-label": t6,
				className: "absolute top-1 right-1 w-5 h-5 rounded-full bg-neutral-900 text-white opacity-0 group-hover/tile:opacity-100 transition-opacity duration-80 flex items-center justify-center cursor-pointer outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[#6B97FF]",
				children: t7
			})
		});
		$[10] = t5;
		$[11] = t6;
		$[12] = t7;
		$[13] = t8;
	} else t8 = $[13];
	let t9;
	if ($[14] !== t4 || $[15] !== t8) {
		t9 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(motion.div, {
			layout: true,
			initial: t1,
			animate: t2,
			exit: t3,
			transition: springs.fast,
			className: "relative shrink-0 cursor-default group/tile",
			children: [t4, t8]
		});
		$[14] = t4;
		$[15] = t8;
		$[16] = t9;
	} else t9 = $[16];
	return t9;
}
var InputMessage = (0, import_react.forwardRef)(({ value, onValueChange, onSend, placeholder = "Ask me anything…", leftSlot, rightSlot, disabled, minRows = 1, maxRows = 8, clickToFocus = true, sendLabel = "Send", files, onFilesChange, accept = DEFAULT_ACCEPT, maxFiles, filePreviewSize = 80, textareaProps, className, style, ...props }, ref) => {
	const shape = useShape();
	const ArrowUpIcon = useIcon("arrow-up");
	const textareaRef = (0, import_react.useRef)(null);
	const fileInputRef = (0, import_react.useRef)(null);
	const [focusVisible, setFocusVisible] = (0, import_react.useState)(false);
	const [dragOver, setDragOver] = (0, import_react.useState)(false);
	const [hovered, setHovered] = (0, import_react.useState)(false);
	const filesArr = (0, import_react.useMemo)(() => files ?? [], [files]);
	const supportsFiles = onFilesChange !== void 0;
	useIsoLayoutEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		const computed = getComputedStyle(el);
		const lineHeight = parseFloat(computed.lineHeight);
		if (Number.isNaN(lineHeight)) return;
		const min = lineHeight * minRows;
		const max = lineHeight * maxRows;
		const next = Math.min(Math.max(el.scrollHeight, min), max);
		el.style.height = `${next}px`;
		el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
	}, [
		value,
		minRows,
		maxRows
	]);
	const trimmed = value.trim();
	const canSend = !disabled && (trimmed.length > 0 || filesArr.length > 0);
	const EDGE_DROP = "0 1px 1px -0.5px var(--shadow-color)";
	const edgeShadow = dragOver ? `0 0 0 1px #6B97FF, ${EDGE_DROP}` : focusVisible ? `0 0 0 1px color-mix(in oklab, var(--foreground) 20%, transparent), ${EDGE_DROP}` : hovered && clickToFocus && !disabled ? `0 0 0 1px var(--border), ${EDGE_DROP}` : void 0;
	const handleSend = (0, import_react.useCallback)(() => {
		if (!canSend) return;
		onSend?.(trimmed, filesArr);
	}, [
		canSend,
		onSend,
		trimmed,
		filesArr
	]);
	const handleKeyDown = (0, import_react.useCallback)((e) => {
		if (e.nativeEvent.isComposing) return;
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}, [handleSend]);
	const handleContainerMouseDown = (0, import_react.useCallback)((e_0) => {
		if (!clickToFocus || disabled) return;
		const target = e_0.target;
		if (target === textareaRef.current) return;
		if (target.closest("button, a, input, select, textarea, [contenteditable], [role=\"button\"]")) return;
		e_0.preventDefault();
		textareaRef.current?.focus();
	}, [clickToFocus, disabled]);
	const acceptTokens = (0, import_react.useMemo)(() => accept.split(",").map((s) => s.trim()).filter(Boolean), [accept]);
	const matchesAccept = (0, import_react.useCallback)((file) => acceptTokens.some((token) => {
		if (token.endsWith("/*")) return file.type.startsWith(token.slice(0, -1));
		if (token.startsWith(".")) return file.name.toLowerCase().endsWith(token.toLowerCase());
		return file.type === token;
	}), [acceptTokens]);
	const addFiles = (0, import_react.useCallback)((incoming) => {
		if (!onFilesChange) return;
		const fingerprint = (f) => `${f.name}-${f.size}-${f.lastModified}`;
		const existing = new Set(filesArr.map(fingerprint));
		const accepted = [];
		for (const f_0 of incoming) {
			if (!matchesAccept(f_0)) continue;
			const fp = fingerprint(f_0);
			if (existing.has(fp)) continue;
			existing.add(fp);
			accepted.push(f_0);
		}
		if (!accepted.length) return;
		const next_0 = [...filesArr, ...accepted];
		onFilesChange(maxFiles != null ? next_0.slice(0, maxFiles) : next_0);
	}, [
		onFilesChange,
		filesArr,
		matchesAccept,
		maxFiles
	]);
	const removeFile = (0, import_react.useCallback)((idx) => {
		if (!onFilesChange) return;
		onFilesChange(filesArr.filter((_, i) => i !== idx));
	}, [onFilesChange, filesArr]);
	const openFilePicker = (0, import_react.useCallback)((overrideAccept) => {
		const el_0 = fileInputRef.current;
		if (!el_0) return;
		if (overrideAccept) {
			el_0.accept = overrideAccept;
			el_0.click();
			queueMicrotask(() => {
				if (fileInputRef.current) fileInputRef.current.accept = accept;
			});
			return;
		}
		el_0.click();
	}, [accept]);
	const slotCtx = (0, import_react.useMemo)(() => ({
		openFilePicker,
		files: filesArr
	}), [openFilePicker, filesArr]);
	const leftContent = typeof leftSlot === "function" ? leftSlot(slotCtx) : leftSlot;
	const rightContent = typeof rightSlot === "function" ? rightSlot(slotCtx) : rightSlot;
	const handleDragOver = (0, import_react.useCallback)((e_1) => {
		if (!supportsFiles || disabled) return;
		if (!Array.from(e_1.dataTransfer.types).includes("Files")) return;
		e_1.preventDefault();
		e_1.dataTransfer.dropEffect = "copy";
		setDragOver(true);
	}, [supportsFiles, disabled]);
	const handleDragLeave = (0, import_react.useCallback)((e_2) => {
		const wrapper = e_2.currentTarget;
		const next_1 = e_2.relatedTarget;
		if (next_1 && wrapper.contains(next_1)) return;
		setDragOver(false);
	}, []);
	const handleDrop = (0, import_react.useCallback)((e_3) => {
		e_3.preventDefault();
		setDragOver(false);
		if (!supportsFiles || disabled) return;
		addFiles(Array.from(e_3.dataTransfer.files));
	}, [
		supportsFiles,
		disabled,
		addFiles
	]);
	const handleFileInputChange = (0, import_react.useCallback)((e_4) => {
		if (!e_4.target.files) return;
		addFiles(Array.from(e_4.target.files));
		e_4.target.value = "";
	}, [addFiles]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		ref,
		onMouseDown: handleContainerMouseDown,
		onDragOver: handleDragOver,
		onDragLeave: handleDragLeave,
		onDrop: handleDrop,
		className: cn("flex flex-col gap-1 p-2 transition-[box-shadow,color] duration-80", surfaceClasses(2, 2), shape.container, clickToFocus && !disabled && "cursor-text", disabled && "opacity-50 pointer-events-none", className),
		style: edgeShadow ? {
			boxShadow: edgeShadow,
			...style
		} : style,
		onMouseEnter: () => setHovered(true),
		onMouseLeave: () => setHovered(false),
		...props,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(SurfaceProvider, {
			value: 2,
			children: [
				supportsFiles && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					ref: fileInputRef,
					type: "file",
					accept,
					multiple: maxFiles == null || maxFiles > 1,
					className: "hidden",
					onChange: handleFileInputChange,
					"aria-hidden": "true",
					tabIndex: -1
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AnimatePresence, {
					initial: false,
					children: filesArr.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
						initial: {
							height: 0,
							opacity: 0
						},
						animate: {
							height: "auto",
							opacity: 1
						},
						exit: {
							height: 0,
							opacity: 0
						},
						transition: {
							...springs.moderate,
							bounce: 0
						},
						className: "overflow-hidden",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "flex flex-wrap gap-2 pb-1",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AnimatePresence, {
								initial: false,
								mode: "popLayout",
								children: filesArr.map((file_0, i_0) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FilePreviewTile, {
									file: file_0,
									onRemove: () => removeFile(i_0),
									size: filePreviewSize
								}, `${file_0.name}-${file_0.size}-${file_0.lastModified}`))
							})
						})
					}, "preview-row")
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
					ref: textareaRef,
					value,
					onChange: (e_5) => onValueChange(e_5.target.value),
					onKeyDown: handleKeyDown,
					onFocus: (e_6) => {
						if (e_6.target.matches(":focus-visible")) setFocusVisible(true);
					},
					onBlur: () => setFocusVisible(false),
					placeholder: dragOver && supportsFiles ? "Drop files here to add to chat" : placeholder,
					disabled,
					rows: minRows,
					"aria-label": textareaProps?.["aria-label"] ?? "Message",
					className: cn("w-full resize-none bg-transparent outline-none", "text-[14px] text-foreground placeholder:text-muted-foreground", "px-2 py-2"),
					style: { fontVariationSettings: fontWeights.normal },
					...textareaProps
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center justify-between gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "flex items-center gap-1.5 min-w-0",
						children: leftContent
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-1.5 shrink-0",
						children: [rightContent, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "button",
							variant: "primary",
							size: "icon-sm",
							onClick: handleSend,
							disabled: !canSend,
							"aria-label": sendLabel,
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowUpIcon, {})
						})]
					})]
				})
			]
		})
	});
});
InputMessage.displayName = "InputMessage";
//#endregion
//#region @/components/ui/chat-message.tsx
var ChatMessage = (0, import_react.forwardRef)((t0, ref) => {
	const $ = (0, import_compiler_runtime.c)(36);
	let actions;
	let children;
	let className;
	let files;
	let from;
	let props;
	let t1;
	let time;
	if ($[0] !== t0) {
		({from, files, thumbnailSize: t1, time, actions, children, className, ...props} = t0);
		$[0] = t0;
		$[1] = actions;
		$[2] = children;
		$[3] = className;
		$[4] = files;
		$[5] = from;
		$[6] = props;
		$[7] = t1;
		$[8] = time;
	} else {
		actions = $[1];
		children = $[2];
		className = $[3];
		files = $[4];
		from = $[5];
		props = $[6];
		t1 = $[7];
		time = $[8];
	}
	const thumbnailSize = t1 === void 0 ? 64 : t1;
	const shape = useShape();
	const isUser = from === "user";
	const showTime = isUser && time != null;
	let t2;
	let t3;
	if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
		t2 = {
			opacity: 0,
			y: 8,
			scale: .96
		};
		t3 = {
			opacity: 1,
			y: 0,
			scale: 1
		};
		$[9] = t2;
		$[10] = t3;
	} else {
		t2 = $[9];
		t3 = $[10];
	}
	const t4 = isUser ? "bottom right" : "bottom left";
	let t5;
	if ($[11] !== t4) {
		t5 = { transformOrigin: t4 };
		$[11] = t4;
		$[12] = t5;
	} else t5 = $[12];
	const t6 = isUser ? "items-end self-end" : "items-start self-start";
	let t7;
	if ($[13] !== className || $[14] !== t6) {
		t7 = cn("group flex max-w-[80%] flex-col gap-1.5", t6, className);
		$[13] = className;
		$[14] = t6;
		$[15] = t7;
	} else t7 = $[15];
	let t8;
	if ($[16] !== files || $[17] !== isUser || $[18] !== thumbnailSize) {
		t8 = files && files.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: cn("flex flex-wrap gap-1.5", isUser ? "justify-end" : "justify-start"),
			children: files.map((file, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileThumbnail, {
				file,
				size: thumbnailSize
			}, `${file.name}-${file.size}-${file.lastModified}-${i}`))
		});
		$[16] = files;
		$[17] = isUser;
		$[18] = thumbnailSize;
		$[19] = t8;
	} else t8 = $[19];
	let t9;
	if ($[20] !== children || $[21] !== isUser || $[22] !== shape) {
		t9 = children != null && children !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: cn("py-2 text-[14px] whitespace-pre-wrap break-words text-pretty", isUser ? cn(shape.bg, "px-3.5 bg-[color-mix(in_oklab,var(--accent),var(--background)_45%)] text-accent-foreground") : "text-foreground"),
			children
		});
		$[20] = children;
		$[21] = isUser;
		$[22] = shape;
		$[23] = t9;
	} else t9 = $[23];
	let t10;
	if ($[24] !== actions || $[25] !== showTime || $[26] !== time) {
		t10 = (showTime || actions != null) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: cn("flex items-center gap-2 px-1 text-[12px] leading-none text-muted-foreground select-none", "opacity-0 pointer-events-none transition-opacity duration-150", "group-hover:opacity-100 group-hover:pointer-events-auto", "group-focus-within:opacity-100 group-focus-within:pointer-events-auto"),
			children: [showTime && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "tabular-nums",
				children: time
			}), actions != null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "flex items-center gap-0.5",
				children: actions
			})]
		});
		$[24] = actions;
		$[25] = showTime;
		$[26] = time;
		$[27] = t10;
	} else t10 = $[27];
	let t11;
	if ($[28] !== props || $[29] !== ref || $[30] !== t10 || $[31] !== t5 || $[32] !== t7 || $[33] !== t8 || $[34] !== t9) {
		t11 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(motion.div, {
			ref,
			layout: "position",
			initial: t2,
			animate: t3,
			transition: springs.moderate,
			style: t5,
			className: t7,
			...props,
			children: [
				t8,
				t9,
				t10
			]
		});
		$[28] = props;
		$[29] = ref;
		$[30] = t10;
		$[31] = t5;
		$[32] = t7;
		$[33] = t8;
		$[34] = t9;
		$[35] = t11;
	} else t11 = $[35];
	return t11;
});
ChatMessage.displayName = "ChatMessage";
//#endregion
//#region src/store/terminal-store.ts
var useTerminalStore = create((set, get) => ({
	sessions: [],
	activeSessionId: null,
	createSession: (cwd) => {
		const id = crypto.randomUUID();
		const newSession = {
			id,
			title: `Terminal ${get().sessions.length + 1}`,
			cwd
		};
		set({
			sessions: [...get().sessions, newSession],
			activeSessionId: id
		});
	},
	closeSession: (id) => {
		if (window.omni?.terminal?.kill) window.omni.terminal.kill(id);
		const { sessions, activeSessionId } = get();
		const filteredSessions = sessions.filter((s) => s.id !== id);
		let nextActiveId = activeSessionId;
		if (activeSessionId === id) nextActiveId = filteredSessions.length > 0 ? filteredSessions[filteredSessions.length - 1].id : null;
		set({
			sessions: filteredSessions,
			activeSessionId: nextActiveId
		});
	},
	setActiveSessionId: (id) => {
		set({ activeSessionId: id });
	}
}));
//#endregion
//#region node_modules/@wterm/core/dist/wasm-inline.js
var WASM_BASE64 = "AGFzbQEAAAABMAlgAAF/YAAAYAF/AX9gAX8AYAJ/fwBgBH9/f38AYAN/f38AYAJ/fwF/YAN/f38BfwMwLwAAAAAAAQAAAgICAAAAAAAAAAAAAAAAAQAAAwMEBAUFBQYHAQYBAQQIBAQDAAQEBAUBcAEBAQUDAQBYBgkBfwFBgIDAAAsH7wMfBm1lbW9yeQIACmdldE1heENvbHMAAAtnZXRDZWxsU2l6ZQABDmdldERlYnVnTG9nTWF4AAIUZ2V0RGVidWdMb2dFbnRyeVNpemUAARBnZXREZWJ1Z0xvZ0NvdW50AAMOZ2V0RGVidWdMb2dQdHIABA1jbGVhclJlc3BvbnNlAAUOZ2V0UmVzcG9uc2VMZW4ABg5nZXRSZXNwb25zZVB0cgAHFGdldFNjcm9sbGJhY2tMaW5lTGVuAAgRZ2V0U2Nyb2xsYmFja0xpbmUAChJnZXRTY3JvbGxiYWNrQ291bnQACw9nZXRUaXRsZUNoYW5nZWQADAtnZXRUaXRsZUxlbgANC2dldFRpdGxlUHRyAA4RZ2V0VXNpbmdBbHRTY3JlZW4ADxFnZXRCcmFja2V0ZWRQYXN0ZQAQEGdldEN1cnNvcktleXNBcHAAEQdnZXRSb3dzABIHZ2V0Q29scwATEGdldEN1cnNvclZpc2libGUAFAxnZXRDdXJzb3JDb2wAFQxnZXRDdXJzb3JSb3cAFgpjbGVhckRpcnR5ABcLZ2V0RGlydHlQdHIAGApnZXRHcmlkUHRyABkKd3JpdGVCeXRlcwAaDmdldFdyaXRlQnVmZmVyACwOcmVzaXplVGVybWluYWwALQRpbml0AC4K+V8vBQBBgAILBABBDAsEAEEgCwsAQQAoAuSEwIAACwgAQfSG8IAACw0AQQBBADoA2IzwgAALCwBBAC0A2IzwgAALCABBmIzwgAALGgACQCAAEImAgIAAIgANAEEADwsgAC8BgBgLXAECf0EAIQECQCAAQQAoAvyFrIIAIgJPDQACQAJAIAJB6AdPDQAgAiAAQX9zaiEADAELQQAoAoCGrIIAIABrQecHakHoB3AhAAsgAEGEGGxB3KbwgABqIQELIAELFQAgABCJgICAACIAQdyO8IAAIAAbCwsAQQAoAvyFrIIACygBAX9BACEAAkBBAC0Al4zwgABFDQBBAEEAOgCXjPCAAEEBIQALIAALCwBBAC8B/InwgAALCABBlorwgAALCwBBAC0AlYrwgAALCwBBAC0AkIrwgAALCwBBAC0AkYrwgAALCwBBAC8B7obwgAALCwBBAC8B7IbwgAALCwBBAC0A24zwgAALCwBBAC8B8obwgAALCwBBAC8B8IbwgAALNwECf0EALwHqhPCAACEAQQAhAQJAA0AgACABRg0BIAFB7ITwgABqQQA6AAAgAUEBaiEBDAALCwsIAEHshPCAAAsIAEHohMCAAAvVOwMFfwF+Bn8jgICAgABBwABrIgEkgICAgAAgAEGAwAAgAEGAwABJGyECQZyAwIAAQQJqIQNBACEAA0ACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkAgACACRg0AAkACQAJAAkACQAJAAkACQAJAAkACQCAALQCEhqyCACIEQWhqDgQCAQIAAQtBAC0AwoDAgAAhBEEAQQI6AMKAwIAAIARBB3FBB0YNA0EAQQA7AdiAwIAADCcLAkACQAJAAkACQAJAQQAtAMKAwIAAQQdxDggLAAECAwQFBwsLIATAQb9/Sg0JQQAtAN+EwIAAQQAtAN6EwIAAa0EHcUHahMCAAGogBDoAAEEAQQAtAN6EwIAAQX9qQQdxIgQ6AN6EwIAAIAQNK0H9/wMhBAJAAkACQAJAQQAtAN+EwIAAQQdxQX5qDgMAAQIDC0EALQDahMCAAEEfcUEGdEEALQDbhMCAAEE/cXIhBAwCC0EALQDbhMCAAEE/cUEGdEEALQDahMCAAEEPcUEMdHJBAC0A3ITAgABBP3FyIQQMAQtBAC0A24TAgABBP3FBDHRBAC0A2oTAgABBEnRyQQAtANyEwIAAQT9xQQZ0ckEALQDdhMCAAEE/cXIhBAtBACAEOwGcgMCAACADIARBgID8AHFBEHY6AABBAEEAOgDCgMCAAAwLCwJAAkACQCAEQaV/ag4DAAIBAgtBAEEEOgDCgMCAAEEAQQA7AdiAwIAAQQBBADoAxYDAgABBAEEAOgDEgMCAAEHGgMCAACEFQQghBANAIARBKEYNLSAEQZiAwIAAakEAOwEAIAVBADoAACAEQQJqIQQgBUEBaiEFDAALC0EAQQc6AMKAwIAAQQBBADsBwIDAgAAMKwsCQCAEQfABcUEgRw0AAkBBAC0A2IDAgAAiBUEBSw0AIAUgBDoA1oDAgABBAEEALQDYgMCAAEEBajoA2IDAgAALQQBBAzoAwoDAgAAMKwsgBEFQakH/AXFBzwBJDQ8gBEEgSQ0jDAQLAkAgBEHwAXFBIEcNAEEALQDYgMCAACIFQQFLDSogBSAEOgDWgMCAAEEAQQAtANiAwIAAQQFqOgDYgMCAAAwqCyAEQVBqQf8BcUHPAEkNDiAEQSBJDSIMAwsCQAJAAkACQAJAAkAgBEFQakH/AXEiBUEJSw0AQQAtAMWAwIAADS5BAC0AxIDAgAAiBA0BQQAhBEEAQQE6AMSAwIAADAILIARBRmoOBgICBAQsLAMLIARBf2pB/wFxIQQLIARBAXQiBEF/IAQvAaCAwIAAQRB0rUIKfiIGpyAGQiCIpxtBEHYgBWoiBEH//wMgBEH//wNJGzsBoIDAgAAMKwtBAC0AxIDAgAAiBUEPSw0qQQAgBUEBIAVBAUsbIgVBAWo6AMSAwIAAIARBOkcNKiAFQQE6AMaAwIAADCoLIARBIUYNKAsCQCAEQfABcUEgRw0AAkBBAC0A2IDAgAAiBUEBSw0AIAUgBDoA1oDAgABBAEEALQDYgMCAAEEBajoA2IDAgAALQQBBBToAwoDAgAAMKQsgBEFAakH/AXFBP0kNCSAEQSBJDSEMJgsCQCAEQfABcUEgRw0AQQAtANiAwIAAIgVBAUsNKCAFIAQ6ANaAwIAAQQBBAC0A2IDAgABBAWo6ANiAwIAADCgLIARBQGpB/wFxQT9JDQggBEEgTw0lDCALIARBQGpB/wFxQT5LDSYLQQBBADoAwoDAgAAMJQsgBEEHRw0BQQBBADoAwoDAgAALQQAvAcCAwIAAIgRBAkkNI0EALQDagMCAAEFQag4DByMHIwsgBEFgakH/AXFB3gBLDSJBAC8BwIDAgAAiBUH/A0sNIiAFIAQ6ANqAwIAAQQAgBUEBajsBwIDAgAAMIgtBAEEAOgDCgMCAAAsgBEEgSQ0ZAkAgBEH/AEkNAAJAIARB/wBHDQBBAEH/ADoAw4DAgAAMHAsCQCAEQeABcUHAAUcNAEEAQQI6AN+EwIAAQQAgBDoA2oTAgABBAEEBOgDehMCAAEEAQQE6AMKAwIAADCILAkAgBEHwAXFB4AFHDQBBAEEDOgDfhMCAAEEAIAQ6ANqEwIAAQQBBAjoA3oTAgABBAEEBOgDCgMCAAAwiCyAEQfgBcUHwAUcNIUEAQQQ6AN+EwIAAQQAgBDoA2oTAgABBAEEDOgDehMCAAEEAQQE6AMKAwIAADCELQQAgBDsBnIDAgAAgA0EAOgAAC0EAKAKcgMCAACEEQQAtANmM8IAADQEMFwtBACAEOgDDgMCAAEEAQQA6AMKAwIAAAkBBAC0A2YDAgAAiBUE/Rw0AAkACQAJAIARBmH9qDgUAAgICAQILQQEQm4CAgAAMIQtBABCbgICAAAwgCyAEQT8QnICAgAAMHwsCQCAEQfAARw0AIAVBIUcNAEEAQQE6AJKK8IAAQQBBAToA24zwgABBAEGAgoAINgH+ifCAAEEAQQAvAe6G8IAAOwGGivCAAEEAQQA6AI6K8IAAQQBBADoAkYrwgABBAEEAOgCQivCAAEEAQQA7AYSK8IAAQQBBADoAk4rwgAAMHwsCQCAFQT5HDQAgBEE+EJyAgIAADB8LAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAIARBQGoONiQAAQIDBAUGIiEHCAkKISELISEMDSEhIQ4hISEhISEhIw8hIRARIhIhISEhIRMmISEhJRkzGiELQQBBAEEALwHwhvCAACIEQQAvAaCAwIAAIgVBASAFQQFLG0EBQQAtAMSAwIAAG2siBSAFIARLGzsB8IbwgABBAEEAOgDZjPCAAAwyC0EAQQAvAfCG8IAAQQAvAaCAwIAAIgRBASAEQQFLG0EBQQAtAMSAwIAAG2pB//8DcSIEQQAvAe6G8IAAQX9qQf//A3EiBSAEIAVJGzsB8IbwgABBAEEAOgDZjPCAAAwxC0EAQQAvAfKG8IAAQQAvAaCAwIAAIgRBASAEQQFLG0EBQQAtAMSAwIAAG2pB//8DcSIEQQAvAeyG8IAAQX9qQf//A3EiBSAEIAVJGzsB8obwgABBAEEAOgDZjPCAAAwwC0EAQQBBAC8B8obwgAAiBEEALwGggMCAACIFQQEgBUEBSxtBAUEALQDEgMCAABtrIgUgBSAESxs7AfKG8IAAQQBBADoA2YzwgAAMLwtBAEEALwHwhvCAAEEALwGggMCAACIEQQEgBEEBSxtBAUEALQDEgMCAABtqQf//A3EiBEEALwHuhvCAAEF/akH//wNxIgUgBCAFSRs7AfCG8IAAQQBBADoA2YzwgABBAEEAOwHyhvCAAAwuC0EAQQBBAC8B8IbwgAAiBEEALwGggMCAACIFQQEgBUEBSxtBAUEALQDEgMCAABtrIgUgBSAESxs7AfCG8IAAQQBBADoA2YzwgABBAEEAOwHyhvCAAAwtC0EAQQBBAC8BoIDAgAAiBEF/aiIFIAUgBEsbQQBBAC0AxIDAgAAbIgRBAC8B7IbwgAAiBUF/aiAEIAVJGzsB8obwgABBAEEAOgDZjPCAAAwsCwJAQQAtAMSAwIAADQAgAUGAAjsBBCABQSA2AgAgAUEANgIIIAFBAC8BgIrwgAA7AQYMIwtBAC8BoIDAgAAhBSABQQA2AgggAUEALwGAivCAADsBBiABQYACOwEEIAFBIDYCAAJAAkAgBQ4EJAABAS0LQQAhBAJAA0AgBEH//wNxQQAvAfCG8IAAIgVPDQEgBCABEJ2AgIAAIARBAWohBAwACwsgBUEAQQAvAfKG8IAAQQFqIAEQnoCAgAAMLAtBACEEAkADQCAEQf//A3FBAC8B7obwgABPDQEgBCABEJ2AgIAAIARBAWohBAwACwsgBUEDRw0rQQAoAuCEwIAAIgRFDSsgBEIANwKg37sBDCsLQQAtAMSAwIAADQsgAUGAAjsBBCABQSA2AgAgAUEANgIIIAFBAC8BgIrwgAA7AQYMIAtBAC8B8IbwgAAiBEEALwGEivCAAEkNKSAEQQAvAYaK8IAAIgVPDSlBAC8BoIDAgAAhB0EALQDEgMCAACEIIAFBgAI7AQQgAUEgNgIAIAFBADYCCCABQQAvAYCK8IAAOwEGIAQgBSAHQQEgB0EBSxtBASAIGyABEJ+AgIAADCkLQQAvAfCG8IAAIgRBAC8BhIrwgABJDSggBEEALwGGivCAACIFTw0oQQAvAaCAwIAAIQdBAC0AxIDAgAAhCCABQYACOwEEIAFBIDYCACABQQA2AgggAUEALwGAivCAADsBBiAEIAUgB0EBIAdBAUsbQQEgCBsgARCggICAAAwoC0EALwHyhvCAACIEQQxsIghB8ITAgABqIQVBAC8BoIDAgAAiB0EBIAdBAUsbQQFBAC0AxIDAgAAbIglBDGxB6ITAgABqIQpBAC8BgIrwgAAhCwJAA0AgCSAEakEALwHshvCAACIHTw0BIAhBAC8B8IbwgABBgBhsaiIHQeiEwIAAaiAKIAdqIgwpAgA3AgAgB0HwhMCAAGogDEEIaigCADYCACAFQQxqIQUgCEEMaiEIIARBAWohBAwACwsCQANAQQAvAfCG8IAAIQggBCAHQf//A3FPDQEgBSAIQYAYbGoiB0EANgIAIAdBfmogCzsBACAHQXxqQYACOwEAIAdBeGpBIDYCACAFQQxqIQUgBEEBaiEEQQAvAeyG8IAAIQcMAAsLIAhBAToA7ITwgAAMJwtBAC8BoIDAgAAiBEEBIARBAUsbQQFBAC0AxIDAgAAbIQhBAC8BhIrwgAAhBQJAQQAtAJWK8IAADQAgBUH//wNxDQBBACEFQQAoAuCEwIAAIgxFDQBBACEFQQAhBANAIARB//8DcSIHIAhPDQEgB0EALwGGivCAACAFa0H//wNxTw0BIAwgBCAFakH//wNxQYAYbEHohMCAAGpBAC8B7IbwgAAQoYCAgAAgBEEBaiEEQQAvAYSK8IAAIQUMAAsLIAFBgAI7AQQgAUEgNgIAIAFBADYCCCABQQAvAYCK8IAAOwEGIAVBAC8BhorwgAAgCCABEKCAgIAADCYLQQAtAMSAwIAAIQVBAC8BoIDAgAAhBCABQQA2AgggAUEALwGAivCAADsBBiABQYACOwEEIAFBIDYCAEEALwGEivCAAEEALwGGivCAACAEQQEgBEEBSxtBASAFGyABEJ+AgIAADCULQQAtAMSAwIAAIQVBAC8BoIDAgAAhBCABQQA2AgggAUEALwGAivCAADsBBiABQYACOwEEIAFBIDYCAEEALwHwhvCAAEEALwHyhvCAACIHIAcgBEEBIARBAUsbQQEgBRtqQf//A3EiBEEALwHshvCAACIFIAQgBUkbIAEQnoCAgAAMJAtBAEEALwHyhvCAAEEALwGggMCAACIEQQEgBEEBSxtBAUEALQDEgMCAABtqQf//A3EiBEEALwHshvCAAEF/akH//wNxIgUgBCAFSRs7AfKG8IAAQQBBADoA2YzwgAAMIwtBAEEAQQAvAaCAwIAAIgRBf2oiBSAFIARLG0EAQQAtAMSAwIAAGyIEQQAvAe6G8IAAIgVBf2ogBCAFSRs7AfCG8IAAQQBBADoA2YzwgAAMIgtBAEEALwHwhvCAAEEALwGggMCAACIEQQEgBEEBSxtBAUEALQDEgMCAABtqQf//A3EiBEEALwHuhvCAAEF/akH//wNxIgUgBCAFSRs7AfCG8IAAQQBBADoA2YzwgAAMIQsCQAJAQQAtAMSAwIAARQ0AQQAvAaCAwIAADgQAIiIBIgtBAC8B8obwgAAiBEH/AUsNISAEQQA6ANyM8IAADCELQcSMMCEEA0AgBEHEjjBGDSEgBEGYgMCAAGpBADoAACAEQQFqIQQMAAsLQQAhBAJAQQAtAMSAwIAAIgUNAEEAQYCCgAg2Af6J8IAAQQBBADoAk4rwgAAMIAsDQCAEQf8BcSIHIAVB/wFxTw0gAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQCAHQQF0LwGggMCAACIIDjIAAQIDBAUUBgcIFBQUFBQUFBQUFBQUCQoLDBQNDg8UFBQUFBQUFBARFBQUFBQUFBQSExQLQQBBgIKACDYB/onwgABBAEEAOgCTivCAAAwbC0EAQQAtAJOK8IAAQQFyOgCTivCAAAwaC0EAQQAtAJOK8IAAQQJyOgCTivCAAAwZC0EAQQAtAJOK8IAAQQRyOgCTivCAAAwYCyAEQQFqIghB/wFxIgcgBUH/AXFJDRBBAC0Ak4rwgAAhBQwVC0EAQQAtAJOK8IAAQRByOgCTivCAAAwWC0EAQQAtAJOK8IAAQSByOgCTivCAAAwVC0EAQQAtAJOK8IAAQcAAcjoAk4rwgAAMFAtBAEEALQCTivCAAEGAAXI6AJOK8IAADBMLQQBBAC0Ak4rwgABB/AFxOgCTivCAAAwSC0EAQQAtAJOK8IAAQfsBcToAk4rwgAAMEQtBAEEALQCTivCAAEH3AXE6AJOK8IAADBALQQBBAC0Ak4rwgABB7wFxOgCTivCAAAwPC0EAQQAtAJOK8IAAQd8BcToAk4rwgAAMDgtBAEEALQCTivCAAEG/AXE6AJOK8IAADA0LQQBBAC0Ak4rwgABB/wBxOgCTivCAAAwMCyAEQf6J8IAAEKKAgIAAQf8BcSAEaiEEDAsLQQBBgAI7Af6J8IAADAoLIARBgIrwgAAQooCAgABB/wFxIARqIQQMCQtBAEGAAjsBgIrwgAAMCAsgCEFiaiIMQf//A3FBCEkNBCAIQfj/A3FBKEYNAyAIQaZ/akH//wNxQQhJDQIgCEGcf2pB//8DcUEISQ0BIAVBf2ohBCAFQf8BcUF/aiEIA0AgCCAHRg0IIAdBx4DAgABqIQUgB0EBaiIMIQcgBS0AAEUNBwwACwtBAC0Ak4rwgAAhBSAHLQDGgMCAAEUNBEEAQQhBACAHQQF0LwGggMCAABsgBUH3AXFyOgCTivCAACAIIQQMBgtBACAIQaR/ajsBgIrwgAAMBQtBACAIQa5/ajsB/onwgAAMBAtBACAIQVhqOwGAivCAAAwDC0EAIAw7Af6J8IAADAILQQAgBUEIcjoAk4rwgAAMAQsgDEF/aiEECyAEQQFqIQRBAC0AxIDAgAAhBQwACwtBAC8BoIDAgAAhBCABQQA2AgggAUEALwGAivCAADsBBiABQYACOwEEIAFBIDYCACAEDgMUExIeC0EAQQA7AfKG8IAAEKOAgIAAQQBBADoA2YzwgAAMFQsgAUHAAGokgICAgAAPC0EALQDbgMCAAEE7Rw0bIARBfmoiBEGAAiAEQYACSRshBUEAIQQCQANAIAUgBEYNASAEQZaK8IAAaiAEQdyAwIAAai0AADoAACAEQQFqIQQMAAsLQQBBAToAl4zwgABBACAFOwH8ifCAAAwbC0EAIAQ6AMOAwIAAQQBBADoAwoDAgAACQEEALQDYgMCAAEUNAEEALQDWgMCAAEH/AXFBI0cNAAJAIARBvH9qDgoFBBwcCRwcHBwGAAsCQCAEQUlqDgICAAcLQQAhBQJAA0AgBUH//wNxQQAvAe6G8IAATw0BQQAhBAJAA0AgBEH//wNxQQAvAeyG8IAATw0BIAUgBEGMgMCAABCkgICAACAEQQFqIQQMAAsLIAVBAWohBQwACwtBAEEANgLwhvCAAAwbCwJAIARBvH9qDgoEAxsbCBsbGxsFAAsCQCAEQUlqDgIBAgALIARB4wBGDQYMGgsQpYCAgAAMGQsQpoCAgAAMGAtBAEEAOgDZjPCAAEEAQQA7AfKG8IAACxCjgICAAAwWCwJAQQAvAfCG8IAAIgRBAC8BhIrwgABHDQAgAUGAAjsBBCABQSA2AgAgAUEANgIIIAFBAC8BgIrwgAA7AQYgBEEALwGGivCAAEEBIAEQn4CAgAAMFgsgBEUNFUEAIARBf2o7AfCG8IAADBULIARB4wBHDRQLQQAvAeyG8IAAQQAvAe6G8IAAEKeAgIAADBMLQQAvAfKG8IAAIgRB/wFLDRIgBEEBOgDcjPCAAAwSCyAEQQAQnICAgAAMEQtBAEEAQQAvAaCAwIAAIgRBf2oiBSAFIARLG0EAQQAtAMSAwIAAIgQbIgVBAC8B7obwgAAiB0F/aiAFIAdJGzsB8IbwgABBAEEAQQAvAaKAwIAAIgVBf2oiByAHIAVLG0EAIARBAUsbIgRBAC8B7IbwgAAiBUF/aiAEIAVJGzsB8obwgABBAEEAOgDZjPCAAAwQC0EAQQBBAC8BoIDAgAAiBEF/aiIFIAUgBEsbQQBBAC0AxIDAgAAbIgRBAC8B7IbwgAAiBUF/aiAEIAVJGzsB8obwgABBAEEAOgDZjPCAAAwPC0EALQDEgMCAACEHQQAvAaCAwIAAIQQgAUEANgIIIAFBAC8BgIrwgAA7AQYgAUGAAjsBBCABQSA2AgACQEEALwHyhvCAACIFIARBASAEQQFLG0EBIAcbIgdqQf//A3FBAC8B7IbwgAAiBEkNAEEALwHwhvCAACAFIAQgARCegICAAAwPCwJAA0AgBEF/aiIEQf//A3EgBSAHaiIIQf//A3FJDQFBAC8B8IbwgABBgBhsQeiEwIAAaiIFIAQgB2tB//8DcUEMbGoiCCkCACEGIAUgBEH//wNxQQxsaiIFQQhqIAhBCGooAgA2AgAgBSAGNwIAQQAvAfKG8IAAIQUMAAsLQQAgCEH//wNxIgRBAC8B7IbwgAAiByAEIAdJGyIEIAVB//8DcSIFayIHIAcgBEsbIQQgBUEMbEHohMCAAGohBQJAA0BBAC8B8IbwgAAhByAERQ0BIAUgB0GAGGxqIgcgASkCADcCACAHQQhqIAFBCGooAgA2AgAgBEF/aiEEIAVBDGohBQwACwsgB0EBOgDshPCAAAwOC0EAQQAvAaCAwIAAIgRBf2oiBSAFIARLG0EAQQAtAMSAwIAAIgcbIghBAC8BooDAgAAiBUEALwHuhvCAACIEIAUgBEkbIAQgBRsgBCAHQQFLGyIETw0NQQAgBDsBhorwgABBACAIOwGEivCAAEEAIAhBAEEALQCOivCAABs7AfCG8IAAQQBBADoA2YzwgABBAEEAOwHyhvCAAAwNC0EALQDEgMCAAEUNDEEALwGggMCAAEH//wNxQQZHDQwgAUGbtgE7AABBAC8B8obwgAAhBCABIAFBAkEALwHwhvCAAEEBahCogICAACIFQf8BcWpBOzoAACABIAEgBUEBaiAEQQFqEKiAgIAAIgRB/wFxakHSADoAAAJAQcAARQ0AQZiM8IAAIAFBwAD8CgAAC0EAIARBAWo6ANiM8IAADAwLQQAvAfCG8IAAIAEQnYCAgAAMCwtBAC8B8IbwgABBAEEALwHyhvCAAEEBaiABEJ6AgIAADAoLQQAvAfCG8IAAQQAvAfKG8IAAQQAvAeyG8IAAIAEQnoCAgAAMCQtBAC8B8IbwgABBAC8B8obwgABBAC8B7IbwgAAgARCegICAAEEALwHwhvCAACEEA0AgBEEBaiIEQf//A3FBAC8B7obwgABPDQkgBCABEJ2AgIAADAALCyABQQA6AAsgAUEAOwAJIAFBAC0Ak4rwgAA6AAggAUEAKAH+ifCAADYCBCABIARB////AHE2AgBBAC8B8IbwgABBAC8B8obwgAAgARCkgICAAAJAQQAvAfKG8IAAIgRBAC8B7IbwgABBf2pB//8DcU8NAEEAIARBAWo7AfKG8IAADAgLQQAtAJKK8IAARQ0HQQBBAToA2YzwgAAMBwtBACEFQQAgBDoAw4DAgAAgBEF4ag4GAAECAgIDBgtBAC8B8obwgAAiBEUNBSAEQX9qIQUMAgtBAC8B7IbwgAAiCEEALwHyhvCAACIEQQFqQf//A3EiBSAIIAVLGyEMAkADQCAEQQFqIgUgCE8NASAEQd2M8IAAaiEHIAUhBCAHLQAAQQFHDQALIAUhDAsgDCAIQX9qIAUgCEkbIQUMAQsQo4CAgABBACEFQQAtAI+K8IAARQ0DC0EAIAU7AfKG8IAAQQBBADoA2YzwgAAMAgtBAEEGOgDCgMCAAAwBC0EAIAQ6ANmAwIAACyAAQQFqIQAMAAsLsQIBA39BAC0AxIDAgAAiAUEBIAFBAUsbQQF0IQJBACEBA0ACQAJAAkAgAiABRg0AAkACQAJAAkACQAJAAkACQAJAAkAgAUGggMCAAGovAQAiA0F/ag4HAQwMDAwCAwALAkAgA0Hpd2oOAwYJBwALIANBFEYNAyADQRlGDQQgA0EvRg0FIANB1A9GDQcMCwtBACAAQQFxOgCRivCAAAwKC0EAIABBAXE6AI6K8IAADAkLQQAgAEEBcToAkorwgAAMCAtBACAAQQFxOgCPivCAAAwHC0EAIABBAXE6ANuM8IAADAYLIABBABCpgICAAAwFCyAAQQEQqYCAgAAMBAtBACAAQQFxOgCQivCAAAwDCyAAQQFxDQEQpoCAgAAMAgsPCxClgICAAAsgAUECaiEBDAALC+sBAQJ/I4CAgIAAQRBrIgIkgICAgABBACEDIAJBADoACyACIAE6AAkgAiAAOgAIIAJCADcDACACQQAtAMSAwIAAIgE6AAogAUEEIAFBBEkbQQF0IQECQANAIAEgA0YNASACIANqIANBoIDAgABqLwEAOwEAIANBAmohAwwACwtBAC0A2ozwgABBDGwiA0H8hvCAAGogAkEIaigCADYCACADIAIpAwA3AvSG8IAAQQBBACgC5ITAgABBAWoiA0F/IAMbNgLkhMCAAEEAQQAtANqM8IAAQQFqQR9xOgDajPCAACACQRBqJICAgIAAC3gBAn8CQCAAQf//A3EiAkEALwHqhPCAAE8NACACQYAYbEHohMCAAGohAEEAIQMCQANAIANBAC8B6ITwgABPDQEgACABKQIANwIAIABBCGogAUEIaigCADYCACAAQQxqIQAgA0EBaiEDDAALCyACQQE6AOyE8IAACwujAQEBfwJAIABB//8DcSIEQQAvAeqE8IAATw0AQQAgAkH//wNxIgBBAC8B6ITwgAAiAiAAIAJJGyIAIAFB//8DcSIBayICIAIgAEsbIQIgBEGAGGwgAUEMbGpB6ITAgABqIQACQANAIAJFDQEgACADKQIANwIAIABBCGogA0EIaigCADYCACAAQQxqIQAgAkF/aiECDAALCyAEQQE6AOyE8IAACwvhAQEEfwJAIAJB//8DcUUNACABQf//A3EgAEH//wNxTQ0AIAEgAGsiBCACQf//A3EiAiAEQf//A3EiBCACIARJGyIFa0H//wNxIQZBACECA0ACQCAGIAJHDQAgBSAAakH//wNxIQIDQCAAQf//A3EgAk8NAyAAIAMQnYCAgAAgAEEBaiEADAALCyABIAJBf3NqIgdB//8DcSEEAkBBgBhFDQAgBEGAGGxB6ITAgABqIAcgBWtB//8DcUGAGGxB6ITAgABqQYAY/AoAAAsgBEEBOgDshPCAACACQQFqIQIMAAsLC9gBAQN/AkAgAkH//wNxRQ0AIAFB//8DcSAAQf//A3FNDQAgAkH//wNxIgIgASAAa0H//wNxIgQgAiAESRsiBEGAGGxB6ITAgABqIQUgAUH//wNxIQYgAEH//wNxIgBBgBhsIQIDQAJAIAQgAGogBkkNAANAIABB//8DcSABQf//A3FPDQMgACADEJ2AgIAAIABBAWohAAwACwsCQEGAGEUNACACQeiEwIAAaiAFIAJqQYAY/AoAAAsgAEHshPCAAGpBAToAACACQYAYaiECIABBAWohAAwACwsLoQECA38BfiACQf//A3EhAyAAIAAoAqTfuwFBhBhsaiIEIQUCQANAIANFDQEgASkCACEGIAVBCGogAUEIaigCADYCACAFIAY3AgAgAUEMaiEBIAVBDGohBSADQX9qIQMMAAsLIAQgAjsBgBggACAAKAKk37sBQQFqQegHcDYCpN+7AQJAIAAoAqDfuwEiAUHoB08NACAAIAFBAWo2AqDfuwELC90CAQN/QQAhAgJAIABBAWpB/wFxIgNBAC0AxIDAgAAiBE8NAAJAAkACQCADQQF0LwGggMCAAEF+ag4EAQMDAAMLIABBAmpB/wFxIgAgBE8NAiAAQQF0LwGggMCAACEAQQIhAgwBCyAAQQRqQf8BcSIDIARPDQEgA0EBdC8BoIDAgAAhAgJAIABBAmpB/wFxQQF0LwGggMCAACIDIABBA2pB/wFxQQF0LwGggMCAACIARw0AIAAgAkH//wNxRw0AQQQhAgJAIANB/wFxIgBBCE8NAEEQIQAMAgsCQCAAQfgBTQ0AQecBIQAMAgsgA0F4akH/AXFBCm5B6AFqIgBB/wEgAEH/AUkbIQAMAQsgA0EFbEH/AGpB//8DcUH/AW5BJGwgAEEFbEH/AGpB//8DcUH/AW5BBmxqIAJBBWxB/wBqQf//A3FB/wFuakEQaiEAQQQhAgsgASAAOwEACyACC+wBAQR/I4CAgIAAQRBrIgAkgICAgAACQAJAAkBBAC8B8IbwgABBAWoiAUH//wNxQQAvAYaK8IAAIgJJDQBBAC8BhIrwgAAhAUEALQCVivCAAA0BIAFB//8DcQ0BQQAhAUEAKALghMCAACIDRQ0BIANB6ITAgABBAC8B7IbwgAAQoYCAgABBAC8BhorwgAAhAkEALwGEivCAACEBDAELQQAgATsB8IbwgAAMAQsgAEGAAjsBCCAAQSA2AgQgAEEANgIMIABBAC8BgIrwgAA7AQogASACQQEgAEEEahCggICAAAsgAEEQaiSAgICAAAt1AAJAIABB//8DcUEALwHqhPCAAE8NACABQf//A3FBAC8B6ITwgABB//8DcU8NACAAQf//A3EiAEGAGGwgAUH//wNxQQxsaiIBIAIpAgA3AuiEwIAAIAFB8ITAgABqIAJBCGooAgA2AgAgAEEBOgDshPCAAAsLOABBAEEAKALwhvCAADYC9InwgABBAEEAKAH+ifCAADYC+InwgABBAEEALQCTivCAADoAlozwgAALQwBBAEEAKAL0ifCAADYC8IbwgABBAEEAKAL4ifCAADYB/onwgABBAEEALQCWjPCAADoAk4rwgABBAEEAOgDZjPCAAAvcAgEBfyOAgICAAEGAAmsiAiSAgICAACAAIAEQqoCAgAACQEHEBEUNAEGcgMCAAEEAQcQE/AsAC0EAQQE6ANuM8IAAQQAgATsB7obwgABBACAAOwHshvCAAEEAQoCAgICAoICAATcC9InwgABBAEEBOgCSivCAAEEAIAE7AYaK8IAAQQBCgIKAiIAgNwH+ifCAAEEAQgA3AYqK8IAAQQBBgAI7AYiK8IAAQQBBADYC8IbwgABBAEEAOgDZjPCAAEEAQQA6AJaM8IAAQQBBADsAk4rwgABBAEEAOgCVivCAAEEAQQA7AfyJ8IAAQQBBADoAl4zwgABBAEEAOgDYjPCAAAJAQYACRQ0AIAJBAEGAAvwLAAtBCCEBAkADQCABQf8BSw0BIAIgAWpBAToAACABQQhqIQEMAAsLAkBBgAJFDQBB3IzwgAAgAkGAAvwKAAALIAJBgAJqJICAgIAAC50BAQN/I4CAgIAAQRBrIgMkgICAgABBACEEA38CQCACQf//A3EiBQ0AIAFB/wFxIQIgA0ELakF/aiEFAkADQCAERQ0BIAAgAmogBSAEai0AADoAACACQQFqIQIgBEF/aiEEDAALCyADQRBqJICAgIAAIAIPCyADQQtqIARqIAIgBUEKbiIFQQpsa0EwcjoAACAEQQFqIQQgBSECDAALC7YDAQF/AkAgAEEBcUEALQCVivCAAEYNAEEAKAKYgMCAACICRQ0AAkACQAJAAkAgAEEBcUUNACABQQFxDQEMAgsCQEGEgjBFDQBB6ITAgAAgAkGEgjD8CgAAC0EAQQA6AJWK8IAAAkAgAUEBcUUNAEEAQQAvAYiK8IAAOwH+ifCAAEEAQQAvAYKK8IAAOwGAivCAAEEAQQAtAJSK8IAAOgCTivCAAEEAQQAoAYqK8IAAQRB3NgLwhvCAAEEAQQA6ANmM8IAAC0HUhDAhAANAIABBrPtPakEALwHuhvCAACIBTw0DIABBmIDAgABqQQE6AAAgAEEBaiEADAALC0EAQQAvAfCG8IAAOwGMivCAAEEAQQAvAfKG8IAAOwGKivCAAEEAQQAvAf6J8IAAOwGIivCAAEEAQQAvAYCK8IAAOwGCivCAAEEAQQAtAJOK8IAAOgCUivCAAAsCQEGEgjBFDQAgAkHohMCAAEGEgjD8CgAAC0EALwHshvCAAEEALwHuhvCAABCqgICAAEEAQQE6AJWK8IAAQQAvAe6G8IAAIQELQQAgATsBhorwgABBAEEAOwGEivCAAAsLTwBBACABOwHqhPCAAEEAIAA7AeiE8IAAQQAhAAJAA0AgAEH//wNxIAFB//8DcU8NASAAEKuAgIAAIABBAWohAEEALwHqhPCAACEBDAALCwsQACAAQYCAwIAAEJ2AgIAACwgAQYSGrIIAC4QGAQh/QYACIAFB//8DcSICQQEgAkEBSxsiAkGAAiACQYACSRsgAUGAAksbIQNBAC8B7obwgAAhBAJAAkBBgAIgAEH//wNxIgFBASABQQFLGyIBQYACIAFBgAJJGyAAQYACSxsiBUEALwHshvCAACICRw0AIAMgBEH//wNxRg0BCwJAIAUgAkkiBkUNACADIARB//8DcSIBIAMgAUkbIQcgBUEMbEHohMCAAGohCEEAIQkDQCAJIAdGDQEgCCEBIAUhAAJAA0AgAiAAQf//A3FGDQEgAUEIakEAKAKIgMCAADYCACABQQApAoCAwIAANwIAIAFBDGohASAAQQFqIQAMAAsLIAhBgBhqIQggCUEBaiEJDAALCwJAIAMgBEH//wNxIghPDQBBAC0AlYrwgAANAEEAKALghMCAAEUNACAFIAIgBhshCSADQYAYbEHohMCAAGohACADIQEDQCAEQf//A3EgAUH//wNxRg0BQQAoAuCEwIAAIAAgCRChgICAACAAQYAYaiEAIAFBAWohAQwACwtBACADOwHuhvCAAEEAIAU7AeyG8IAAQQAgAzsB6oTwgABBACAFOwHohPCAAAJAIAMgCE0NACAEIQEDQCABQf//A3EgA08NASABEKuAgIAAIAFBAWohAQwACwsCQCAFIAJNDQAgAyAEQf//A3EiASADIAFJGyEIIAUgAmshByACQQxsQeiEwIAAaiEJQQAhAgNAIAIgCEYNASAHIQAgCSEBAkADQCAARQ0BIAFBCGpBACgCiIDAgAA2AgAgAUEAKQKAgMCAADcCACAAQX9qIQAgAUEMaiEBDAALCyACQQE6AOyE8IAAIAlBgBhqIQkgAkEBaiECDAALC0EAIAM7AYaK8IAAQQBBADsBhIrwgAACQEEALwHyhvCAACAFSQ0AQQAgBUF/ajsB8obwgAALAkBBAC8B8IbwgAAgA0kNAEEAIANBf2o7AfCG8IAAC0EAIQEDQCADIAFGDQEgAUHshPCAAGpBAToAACABQQFqIQEMAAsLC1MAQYACIABBASAAGyAAQYACSxtBgAIgAUEBIAEbIAFBgAJLGxCngICAAEEAQYTGrIIANgKYgMCAAEEAQdym8IAANgLghMCAAEEAQgA3AvyFrIIACwshAQBBgIDAAAsYIAAAAAABAAEAAAAARQAAAAABAAEAAAAA";
//#endregion
//#region node_modules/@wterm/core/dist/wasm-bridge.js
function decodeBase64(base64) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}
var WasmBridge = class WasmBridge {
	constructor(instance) {
		this.gridPtr = 0;
		this.dirtyPtr = 0;
		this.writeBufferPtr = 0;
		this.cellSize = 12;
		this.maxCols = 256;
		this.encoder = new TextEncoder();
		this.decoder = new TextDecoder();
		this.exports = instance.exports;
		this.memory = this.exports.memory;
	}
	static async load(url) {
		let bytes;
		if (url) {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`[wterm] Failed to load WASM from ${url}: ${response.status} ${response.statusText}`);
			bytes = await response.arrayBuffer();
		} else bytes = decodeBase64(WASM_BASE64);
		const { instance } = await WebAssembly.instantiate(bytes);
		return new WasmBridge(instance);
	}
	init(cols, rows) {
		this.exports.init(cols, rows);
		this._updatePointers();
	}
	_updatePointers() {
		this.gridPtr = this.exports.getGridPtr();
		this.dirtyPtr = this.exports.getDirtyPtr();
		this.writeBufferPtr = this.exports.getWriteBuffer();
		this.cellSize = this.exports.getCellSize();
		this.maxCols = this.exports.getMaxCols();
		this._dv = new DataView(this.memory.buffer);
	}
	writeString(str) {
		const encoded = this.encoder.encode(str);
		this.writeRaw(encoded);
	}
	writeRaw(data) {
		const buf = new Uint8Array(this.memory.buffer, this.writeBufferPtr, 8192);
		let offset = 0;
		while (offset < data.length) {
			const chunk = Math.min(data.length - offset, 8192);
			buf.set(data.subarray(offset, offset + chunk));
			this.exports.writeBytes(chunk);
			offset += chunk;
		}
	}
	getCell(row, col) {
		const offset = this.gridPtr + (row * this.maxCols + col) * this.cellSize;
		const dv = this._dv;
		return {
			char: dv.getUint32(offset, true),
			fg: dv.getUint16(offset + 4, true),
			bg: dv.getUint16(offset + 6, true),
			flags: dv.getUint8(offset + 8)
		};
	}
	isDirtyRow(row) {
		return new Uint8Array(this.memory.buffer, this.dirtyPtr, 256)[row] !== 0;
	}
	clearDirty() {
		this.exports.clearDirty();
	}
	getCursor() {
		return {
			row: this.exports.getCursorRow(),
			col: this.exports.getCursorCol(),
			visible: this.exports.getCursorVisible() !== 0
		};
	}
	getCols() {
		return this.exports.getCols();
	}
	getRows() {
		return this.exports.getRows();
	}
	cursorKeysApp() {
		return this.exports.getCursorKeysApp() !== 0;
	}
	bracketedPaste() {
		return this.exports.getBracketedPaste() !== 0;
	}
	usingAltScreen() {
		return this.exports.getUsingAltScreen() !== 0;
	}
	getTitle() {
		if (this.exports.getTitleChanged() === 0) return null;
		const ptr = this.exports.getTitlePtr();
		const len = this.exports.getTitleLen();
		const bytes = new Uint8Array(this.memory.buffer, ptr, len);
		return this.decoder.decode(bytes);
	}
	getResponse() {
		const len = this.exports.getResponseLen();
		if (len === 0) return null;
		const ptr = this.exports.getResponsePtr();
		const bytes = new Uint8Array(this.memory.buffer, ptr, len);
		const str = this.decoder.decode(bytes);
		this.exports.clearResponse();
		return str;
	}
	getScrollbackCount() {
		return this.exports.getScrollbackCount();
	}
	getScrollbackCell(offset, col) {
		const off = this.exports.getScrollbackLine(offset) + col * this.cellSize;
		const dv = this._dv;
		return {
			char: dv.getUint32(off, true),
			fg: dv.getUint16(off + 4, true),
			bg: dv.getUint16(off + 6, true),
			flags: dv.getUint8(off + 8)
		};
	}
	getScrollbackLineLen(offset) {
		return this.exports.getScrollbackLineLen(offset);
	}
	getUnhandledSequences() {
		const count = this.exports.getDebugLogCount();
		if (count === 0) return [];
		const ptr = this.exports.getDebugLogPtr();
		const entrySize = this.exports.getDebugLogEntrySize();
		const maxEntries = this.exports.getDebugLogMax();
		const total = Math.min(count, maxEntries);
		const dv = new DataView(this.memory.buffer);
		const entries = [];
		const startIdx = count >= maxEntries ? count % maxEntries : 0;
		for (let i = 0; i < total; i++) {
			const off = ptr + (startIdx + i) % maxEntries * entrySize;
			const finalByte = dv.getUint8(off);
			if (finalByte === 0) continue;
			const privateByte = dv.getUint8(off + 1);
			const paramCount = dv.getUint8(off + 2);
			const params = [];
			for (let p = 0; p < Math.min(paramCount, 4); p++) params.push(dv.getUint16(off + 4 + p * 2, true));
			entries.push({
				final: String.fromCharCode(finalByte),
				private: privateByte ? String.fromCharCode(privateByte) : "",
				paramCount,
				params
			});
		}
		return entries;
	}
	resize(cols, rows) {
		this.exports.resizeTerminal(cols, rows);
		this._updatePointers();
	}
};
//#endregion
//#region node_modules/@wterm/dom/dist/renderer.js
var DEFAULT_COLOR$1 = 256;
var FLAG_BOLD = 1;
var FLAG_DIM = 2;
var FLAG_ITALIC = 4;
var FLAG_UNDERLINE = 8;
var FLAG_REVERSE = 32;
var FLAG_INVISIBLE = 64;
var FLAG_STRIKETHROUGH = 128;
function rgbToCSS(packed) {
	return `rgb(${packed >> 16 & 255},${packed >> 8 & 255},${packed & 255})`;
}
function colorToCSS(index) {
	if (index === DEFAULT_COLOR$1) return null;
	if (index < 16) return `var(--term-color-${index})`;
	if (index < 232) {
		const n = index - 16;
		return `rgb(${Math.floor(n / 36) * 51},${Math.floor(n / 6) % 6 * 51},${n % 6 * 51})`;
	}
	const level = (index - 232) * 10 + 8;
	return `rgb(${level},${level},${level})`;
}
function cellFgCSS(fg, fgRgb) {
	if (fgRgb !== void 0) return rgbToCSS(fgRgb);
	return colorToCSS(fg);
}
function cellBgCSS(bg, bgRgb) {
	if (bgRgb !== void 0) return rgbToCSS(bgRgb);
	return colorToCSS(bg);
}
function buildCellStyle(fg, bg, flags, fgRgb, bgRgb) {
	let fgIdx = fg, bgIdx = bg, fgR = fgRgb, bgR = bgRgb;
	if (flags & FLAG_REVERSE) {
		const tmpIdx = fgIdx;
		fgIdx = bgIdx;
		bgIdx = tmpIdx;
		const tmpR = fgR;
		fgR = bgR;
		bgR = tmpR;
		if (fgR === void 0 && fgIdx === DEFAULT_COLOR$1) fgIdx = 0;
		if (bgR === void 0 && bgIdx === DEFAULT_COLOR$1) bgIdx = 7;
	}
	const fgCSS = cellFgCSS(fgIdx, fgR);
	const bgCSS = cellBgCSS(bgIdx, bgR);
	let style = "";
	if (fgCSS) style += `color:${fgCSS};`;
	if (bgCSS) style += `background:${bgCSS};`;
	if (flags & FLAG_BOLD) style += "font-weight:bold;";
	if (flags & FLAG_DIM) style += "opacity:0.5;";
	if (flags & FLAG_ITALIC) style += "font-style:italic;";
	const decorations = [];
	if (flags & FLAG_UNDERLINE) decorations.push("underline");
	if (flags & FLAG_STRIKETHROUGH) decorations.push("line-through");
	if (decorations.length) style += `text-decoration:${decorations.join(" ")};`;
	if (flags & FLAG_INVISIBLE) style += "visibility:hidden;";
	return style;
}
function escapeHTML(text) {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function resolveColors(fg, bg, flags, fgRgb, bgRgb) {
	let fgIdx = fg, bgIdx = bg, fgR = fgRgb, bgR = bgRgb;
	if (flags & FLAG_REVERSE) {
		[fgIdx, bgIdx] = [bgIdx, fgIdx];
		[fgR, bgR] = [bgR, fgR];
		if (fgR === void 0 && fgIdx === DEFAULT_COLOR$1) fgIdx = 0;
		if (bgR === void 0 && bgIdx === DEFAULT_COLOR$1) bgIdx = 7;
	}
	return {
		fg: cellFgCSS(fgIdx, fgR) || "var(--term-fg)",
		bg: cellBgCSS(bgIdx, bgR) || "var(--term-bg)"
	};
}
function getBlockBackground(cp, fg, bg) {
	switch (cp) {
		case 9600: return `linear-gradient(${fg} 50%,${bg} 50%)`;
		case 9601: return `linear-gradient(${bg} 87.5%,${fg} 87.5%)`;
		case 9602: return `linear-gradient(${bg} 75%,${fg} 75%)`;
		case 9603: return `linear-gradient(${bg} 62.5%,${fg} 62.5%)`;
		case 9604: return `linear-gradient(${bg} 50%,${fg} 50%)`;
		case 9605: return `linear-gradient(${bg} 37.5%,${fg} 37.5%)`;
		case 9606: return `linear-gradient(${bg} 25%,${fg} 25%)`;
		case 9607: return `linear-gradient(${bg} 12.5%,${fg} 12.5%)`;
		case 9608: return fg;
		case 9609: return `linear-gradient(to right,${fg} 87.5%,${bg} 87.5%)`;
		case 9610: return `linear-gradient(to right,${fg} 75%,${bg} 75%)`;
		case 9611: return `linear-gradient(to right,${fg} 62.5%,${bg} 62.5%)`;
		case 9612: return `linear-gradient(to right,${fg} 50%,${bg} 50%)`;
		case 9613: return `linear-gradient(to right,${fg} 37.5%,${bg} 37.5%)`;
		case 9614: return `linear-gradient(to right,${fg} 25%,${bg} 25%)`;
		case 9615: return `linear-gradient(to right,${fg} 12.5%,${bg} 12.5%)`;
		case 9616: return `linear-gradient(to right,${bg} 50%,${fg} 50%)`;
		case 9617: return `color-mix(in srgb,${fg} 25%,${bg})`;
		case 9618: return `color-mix(in srgb,${fg} 50%,${bg})`;
		case 9619: return `color-mix(in srgb,${fg} 75%,${bg})`;
		case 9620: return `linear-gradient(${fg} 12.5%,${bg} 12.5%)`;
		case 9621: return `linear-gradient(to right,${bg} 87.5%,${fg} 87.5%)`;
		default: {
			const q = {
				9622: [
					false,
					false,
					true,
					false
				],
				9623: [
					false,
					false,
					false,
					true
				],
				9624: [
					true,
					false,
					false,
					false
				],
				9625: [
					true,
					false,
					true,
					true
				],
				9626: [
					true,
					false,
					false,
					true
				],
				9627: [
					true,
					true,
					true,
					false
				],
				9628: [
					true,
					true,
					false,
					true
				],
				9629: [
					false,
					true,
					false,
					false
				],
				9630: [
					false,
					true,
					true,
					false
				],
				9631: [
					false,
					true,
					true,
					true
				]
			}[cp];
			if (!q) return fg;
			const [tl, tr, bl, br] = q;
			if (tl && tr && bl && br) return fg;
			const layers = [];
			const POS = [
				"0 0",
				"100% 0",
				"0 100%",
				"100% 100%"
			];
			q.forEach((filled, i) => {
				if (filled) layers.push(`linear-gradient(${fg},${fg}) ${POS[i]}/50% 50% no-repeat`);
			});
			layers.push(bg);
			return layers.join(",");
		}
	}
}
var Renderer = class {
	constructor(container) {
		this.rows = 0;
		this.cols = 0;
		this.rowEls = [];
		this.prevCursorRow = -1;
		this.prevCursorCol = -1;
		this.prevContainerBg = "";
		this.prevRowBg = [];
		this._scrollbackRowEls = [];
		this._renderedScrollbackCount = 0;
		this.container = container;
	}
	setup(cols, rows) {
		this.cols = cols;
		this.rows = rows;
		this.container.innerHTML = "";
		this.rowEls = [];
		this.prevRowBg = [];
		this._scrollbackRowEls = [];
		this._renderedScrollbackCount = 0;
		const fragment = document.createDocumentFragment();
		for (let r = 0; r < rows; r++) {
			const rowEl = document.createElement("div");
			rowEl.className = "term-row";
			fragment.appendChild(rowEl);
			this.rowEls.push(rowEl);
		}
		this.container.appendChild(fragment);
		this.prevCursorRow = -1;
		this.prevCursorCol = -1;
	}
	_buildRowContent(rowEl, getCell, lineLen, cursorCol, rowIndex) {
		let html = "";
		let runStyle = "";
		let runText = "";
		let runStart = 0;
		const flushRun = (endCol) => {
			if (!runText) return;
			const escaped = escapeHTML(runText);
			if (cursorCol >= runStart && cursorCol < endCol) {
				const offset = cursorCol - runStart;
				const chars = [...runText];
				const before = chars.slice(0, offset).join("");
				const cursorChar = chars[offset] || " ";
				const after = chars.slice(offset + 1).join("");
				if (before) html += runStyle ? `<span style="${runStyle}">${escapeHTML(before)}</span>` : `<span>${escapeHTML(before)}</span>`;
				html += runStyle ? `<span class="term-cursor" style="${runStyle}">${escapeHTML(cursorChar)}</span>` : `<span class="term-cursor">${escapeHTML(cursorChar)}</span>`;
				if (after) html += runStyle ? `<span style="${runStyle}">${escapeHTML(after)}</span>` : `<span>${escapeHTML(after)}</span>`;
			} else html += runStyle ? `<span style="${runStyle}">${escaped}</span>` : `<span>${escaped}</span>`;
		};
		for (let col = 0; col < this.cols; col++) {
			const cell = getCell(col);
			const inBounds = col < lineLen;
			const cp = inBounds ? cell.char : 0;
			if (inBounds && cp >= 9600 && cp <= 9631) {
				flushRun(col);
				const colors = resolveColors(cell.fg, cell.bg, cell.flags, cell.fgRgb, cell.bgRgb);
				const cls = col === cursorCol ? "term-block term-cursor" : "term-block";
				const bg = getBlockBackground(cp, colors.fg, colors.bg);
				const dim = cell.flags & FLAG_DIM ? "opacity:0.5;" : "";
				html += `<span class="${cls}" style="background:${bg};${dim}"></span>`;
				runStyle = "";
				runText = "";
				runStart = col + 1;
			} else {
				const ch = inBounds && cp >= 32 ? String.fromCodePoint(cp) : " ";
				const style = inBounds ? buildCellStyle(cell.fg, cell.bg, cell.flags, cell.fgRgb, cell.bgRgb) : "";
				if (style !== runStyle) {
					flushRun(col);
					runStyle = style;
					runText = ch;
					runStart = col;
				} else runText += ch;
			}
		}
		flushRun(this.cols);
		rowEl.innerHTML = html;
		let bgCss = "";
		if (lineLen >= this.cols && this.cols > 0) {
			const lastCell = getCell(this.cols - 1);
			let bgIdx = lastCell.bg;
			let bgR = lastCell.bgRgb;
			if (lastCell.flags & FLAG_REVERSE) {
				bgIdx = lastCell.fg;
				bgR = lastCell.fgRgb;
				if (bgR === void 0 && bgIdx === DEFAULT_COLOR$1) bgIdx = 7;
			}
			bgCss = cellBgCSS(bgIdx, bgR) || "";
		}
		const boxShadow = bgCss ? `0 1px 0 ${bgCss}` : "";
		if (rowIndex >= 0) {
			if (bgCss !== (this.prevRowBg[rowIndex] ?? "")) {
				rowEl.style.background = bgCss;
				rowEl.style.boxShadow = boxShadow;
				this.prevRowBg[rowIndex] = bgCss;
			}
		} else {
			rowEl.style.background = bgCss;
			rowEl.style.boxShadow = boxShadow;
		}
	}
	_buildScrollbackRowEl(core, sbOffset) {
		const rowEl = document.createElement("div");
		rowEl.className = "term-row term-scrollback-row";
		const lineLen = core.getScrollbackLineLen(sbOffset);
		this._buildRowContent(rowEl, (col) => core.getScrollbackCell(sbOffset, col), lineLen, -1, -1);
		return rowEl;
	}
	syncScrollback(core) {
		const scrollbackCount = core.getScrollbackCount();
		if (scrollbackCount === this._renderedScrollbackCount) return;
		if (scrollbackCount > this._renderedScrollbackCount) {
			const newCount = scrollbackCount - this._renderedScrollbackCount;
			const firstGridRow = this.rowEls[0] ?? null;
			const fragment = document.createDocumentFragment();
			for (let i = newCount - 1; i >= 0; i--) {
				const rowEl = this._buildScrollbackRowEl(core, i);
				fragment.appendChild(rowEl);
				this._scrollbackRowEls.push(rowEl);
			}
			this.container.insertBefore(fragment, firstGridRow);
		} else {
			const removeCount = this._renderedScrollbackCount - scrollbackCount;
			for (let i = 0; i < removeCount; i++) {
				const el = this._scrollbackRowEls.shift();
				if (el) el.remove();
			}
		}
		this._renderedScrollbackCount = scrollbackCount;
	}
	render(core) {
		const rows = core.getRows();
		const cols = core.getCols();
		let resized = false;
		if (rows !== this.rows || cols !== this.cols) {
			this.setup(cols, rows);
			resized = true;
		}
		this.syncScrollback(core);
		const cursor = core.getCursor();
		const cursorVisible = cursor.visible;
		const needsCursorUpdate = cursor.row !== this.prevCursorRow || cursor.col !== this.prevCursorCol;
		for (let r = 0; r < this.rows; r++) {
			const isDirty = resized || core.isDirtyRow(r);
			const hadCursor = r === this.prevCursorRow && needsCursorUpdate;
			const hasCursor = r === cursor.row;
			if (isDirty || hadCursor || hasCursor && needsCursorUpdate) {
				const cCol = hasCursor && cursorVisible ? cursor.col : -1;
				this._buildRowContent(this.rowEls[r], (col) => core.getCell(r, col), this.cols, cCol, r);
			}
		}
		this.prevCursorRow = cursor.row;
		this.prevCursorCol = cursor.col;
		if (resized || core.isDirtyRow(this.rows - 1)) {
			const bottomRight = core.getCell(this.rows - 1, this.cols - 1);
			let gridBgIdx = bottomRight.bg;
			let gridBgRgb = bottomRight.bgRgb;
			if (bottomRight.flags & FLAG_REVERSE) {
				gridBgIdx = bottomRight.fg;
				gridBgRgb = bottomRight.fgRgb;
				if (gridBgRgb === void 0 && gridBgIdx === DEFAULT_COLOR$1) gridBgIdx = 7;
			}
			const containerBg = cellBgCSS(gridBgIdx, gridBgRgb) || "";
			if (containerBg !== this.prevContainerBg) {
				this.container.style.background = containerBg;
				this.prevContainerBg = containerBg;
			}
		}
		core.clearDirty();
	}
};
//#endregion
//#region node_modules/@wterm/dom/dist/input.js
var NORMAL_KEYS = {
	ArrowUp: "\x1B[A",
	ArrowDown: "\x1B[B",
	ArrowRight: "\x1B[C",
	ArrowLeft: "\x1B[D",
	Home: "\x1B[H",
	End: "\x1B[F"
};
var APP_KEYS = {
	ArrowUp: "\x1BOA",
	ArrowDown: "\x1BOB",
	ArrowRight: "\x1BOC",
	ArrowLeft: "\x1BOD",
	Home: "\x1BOH",
	End: "\x1BOF"
};
var FIXED_KEYS = {
	Enter: "\r",
	Backspace: "",
	Tab: "	",
	Escape: "\x1B",
	Insert: "\x1B[2~",
	Delete: "\x1B[3~",
	PageUp: "\x1B[5~",
	PageDown: "\x1B[6~",
	F1: "\x1BOP",
	F2: "\x1BOQ",
	F3: "\x1BOR",
	F4: "\x1BOS",
	F5: "\x1B[15~",
	F6: "\x1B[17~",
	F7: "\x1B[18~",
	F8: "\x1B[19~",
	F9: "\x1B[20~",
	F10: "\x1B[21~",
	F11: "\x1B[23~",
	F12: "\x1B[24~"
};
var InputHandler = class {
	constructor(element, onData, getBridge) {
		this.composing = false;
		this.element = element;
		this.onData = onData;
		this.getBridge = getBridge;
		this.textarea = document.createElement("textarea");
		this.textarea.setAttribute("autocapitalize", "off");
		this.textarea.setAttribute("autocomplete", "off");
		this.textarea.setAttribute("autocorrect", "off");
		this.textarea.setAttribute("spellcheck", "false");
		this.textarea.setAttribute("enterkeyhint", "send");
		this.textarea.setAttribute("tabindex", "0");
		this.textarea.setAttribute("aria-hidden", "true");
		const s = this.textarea.style;
		s.position = "absolute";
		s.left = "-9999px";
		s.top = "0";
		s.width = "1px";
		s.height = "1px";
		s.opacity = "0";
		s.overflow = "hidden";
		s.border = "0";
		s.padding = "0";
		s.margin = "0";
		s.outline = "none";
		s.resize = "none";
		s.pointerEvents = "none";
		s.caretColor = "transparent";
		s.color = "transparent";
		s.background = "transparent";
		element.appendChild(this.textarea);
		this._onKeyDown = this.handleKeyDown.bind(this);
		this._onPaste = this.handlePaste.bind(this);
		this._onCompositionStart = this.handleCompositionStart.bind(this);
		this._onCompositionEnd = this.handleCompositionEnd.bind(this);
		this._onInput = this.handleInput.bind(this);
		this._onFocus = () => this.element.classList.add("focused");
		this._onBlur = () => this.element.classList.remove("focused");
		this.textarea.addEventListener("keydown", this._onKeyDown);
		this.textarea.addEventListener("paste", this._onPaste);
		this.textarea.addEventListener("compositionstart", this._onCompositionStart);
		this.textarea.addEventListener("compositionend", this._onCompositionEnd);
		this.textarea.addEventListener("input", this._onInput);
		this.textarea.addEventListener("focus", this._onFocus);
		this.textarea.addEventListener("blur", this._onBlur);
	}
	focus() {
		this.textarea.focus({ preventScroll: true });
	}
	destroy() {
		this.textarea.removeEventListener("keydown", this._onKeyDown);
		this.textarea.removeEventListener("paste", this._onPaste);
		this.textarea.removeEventListener("compositionstart", this._onCompositionStart);
		this.textarea.removeEventListener("compositionend", this._onCompositionEnd);
		this.textarea.removeEventListener("input", this._onInput);
		this.textarea.removeEventListener("focus", this._onFocus);
		this.textarea.removeEventListener("blur", this._onBlur);
		this.element.classList.remove("focused");
		this.textarea.remove();
	}
	handleKeyDown(e) {
		if (this.composing) return;
		if ((e.metaKey || e.ctrlKey) && e.key === "c") {
			const sel = window.getSelection();
			if (sel && sel.toString().length > 0) return;
		}
		if ((e.metaKey || e.ctrlKey) && e.key === "v") {
			this.textarea.focus();
			return;
		}
		if (e.metaKey && !e.ctrlKey) {
			if (e.key === "Backspace") {
				e.preventDefault();
				this.onData("");
			} else if (e.key === "a") {
				e.preventDefault();
				const sel = window.getSelection();
				if (sel) {
					const range = document.createRange();
					range.selectNodeContents(this.element);
					sel.removeAllRanges();
					sel.addRange(range);
				}
			}
			return;
		}
		e.preventDefault();
		const seq = this.keyToSequence(e);
		if (seq) this.onData(seq);
	}
	handlePaste(e) {
		e.preventDefault();
		const text = e.clipboardData?.getData("text");
		if (!text) return;
		const bridge = this.getBridge();
		if (bridge && bridge.bracketedPaste()) {
			const safe = text.replace(/\x1b/g, "");
			this.onData("\x1B[200~" + safe + "\x1B[201~");
		} else this.onData(text);
	}
	handleCompositionStart() {
		this.composing = true;
	}
	handleCompositionEnd(e) {
		this.composing = false;
		if (e.data) this.onData(e.data);
		this.textarea.value = "";
	}
	handleInput() {
		if (this.composing) return;
		const value = this.textarea.value;
		if (value) {
			this.onData(value);
			this.textarea.value = "";
		}
	}
	keyToSequence(e) {
		if (e.ctrlKey && !e.altKey && !e.metaKey) {
			if (e.key.length === 1) {
				const code = e.key.toLowerCase().charCodeAt(0);
				if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
			}
			if (e.key === "[") return "\x1B";
			if (e.key === "\\") return "";
			if (e.key === "]") return "";
			if (e.key === "^") return "";
			if (e.key === "_") return "";
		}
		if (e.key === "Enter" && e.shiftKey) return "\x1B[13;2u";
		if (e.key === "Tab" && e.shiftKey) return "\x1B[Z";
		const fixed = FIXED_KEYS[e.key];
		if (fixed) return e.altKey ? "\x1B" + fixed : fixed;
		const bridge = this.getBridge();
		const nav = (bridge && bridge.cursorKeysApp() ? APP_KEYS : NORMAL_KEYS)[e.key];
		if (nav) return e.altKey ? "\x1B" + nav : nav;
		if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return e.altKey ? "\x1B" + e.key : e.key;
		return null;
	}
};
//#endregion
//#region node_modules/@wterm/dom/dist/debug.js
var FLAG_NAMES = {
	1: "bold",
	2: "dim",
	4: "italic",
	8: "underline",
	16: "blink",
	32: "reverse",
	64: "invisible",
	128: "strikethrough"
};
function flagsToNames(flags) {
	const names = [];
	for (const [bit, name] of Object.entries(FLAG_NAMES)) if (flags & Number(bit)) names.push(name);
	return names;
}
var ESC = 27;
function scanSequences(data) {
	const entries = [];
	const ts = Date.now();
	let i = 0;
	let textStart = 0;
	const flushText = () => {
		if (i > textStart) {
			const raw = data.slice(textStart, i);
			if (raw.length > 0 && !/^[\x00-\x1f]+$/.test(raw)) entries.push({
				ts,
				type: "text",
				raw: raw.slice(0, 60)
			});
		}
	};
	while (i < data.length) {
		if (data.charCodeAt(i) !== ESC) {
			i++;
			continue;
		}
		flushText();
		const seqStart = i;
		i++;
		if (i >= data.length) break;
		const next = data[i];
		if (next === "[") {
			i++;
			let priv = "";
			if (i < data.length && (data[i] === "?" || data[i] === ">" || data[i] === "!")) {
				priv = data[i];
				i++;
			}
			let paramStr = "";
			while (i < data.length && (data.charCodeAt(i) >= 48 && data.charCodeAt(i) <= 59 || data[i] === ":")) {
				paramStr += data[i];
				i++;
			}
			while (i < data.length && data.charCodeAt(i) >= 32 && data.charCodeAt(i) <= 47) i++;
			let final = "";
			if (i < data.length && data.charCodeAt(i) >= 64 && data.charCodeAt(i) <= 126) {
				final = data[i];
				i++;
			}
			const raw = data.slice(seqStart, i);
			const params = paramStr ? paramStr.split(/[;:]/).map(Number).filter((n) => !isNaN(n)) : [];
			const type = final === "m" ? "sgr" : "csi";
			entries.push({
				ts,
				type,
				raw,
				params: params.length > 0 ? params : void 0,
				private: priv || void 0,
				final
			});
		} else if (next === "]") {
			i++;
			while (i < data.length && data.charCodeAt(i) !== 7 && !(data.charCodeAt(i) === ESC && i + 1 < data.length && data[i + 1] === "\\")) i++;
			if (i < data.length) {
				if (data.charCodeAt(i) === 7) i++;
				else if (data.charCodeAt(i) === ESC) i += 2;
			}
			const raw = data.slice(seqStart, i);
			entries.push({
				ts,
				type: "osc",
				raw: raw.slice(0, 80)
			});
		} else if (next >= " " && next <= "~") {
			i++;
			entries.push({
				ts,
				type: "esc",
				raw: data.slice(seqStart, i),
				final: next
			});
		} else i++;
		textStart = i;
	}
	flushText();
	return entries;
}
var MAX_TRACES = 500;
var DebugAdapter = class {
	constructor() {
		this._traces = [];
		this._bridge = null;
		this._perf = {
			frameCount: 0,
			totalRenderMs: 0,
			avgRenderMs: 0,
			maxRenderMs: 0,
			lastDirtyRows: 0
		};
	}
	get traces() {
		return this._traces;
	}
	get perf() {
		return this._perf;
	}
	setBridge(bridge) {
		this._bridge = bridge;
	}
	traceWrite(data) {
		const entries = scanSequences(typeof data === "string" ? data : new TextDecoder().decode(data));
		for (const entry of entries) this._traces.push(entry);
		if (this._traces.length > MAX_TRACES) this._traces = this._traces.slice(-500);
	}
	recordRender(renderMs, dirtyRows) {
		this._perf.frameCount++;
		this._perf.totalRenderMs += renderMs;
		this._perf.avgRenderMs = this._perf.totalRenderMs / this._perf.frameCount;
		if (renderMs > this._perf.maxRenderMs) this._perf.maxRenderMs = renderMs;
		this._perf.lastDirtyRows = dirtyRows;
	}
	resetPerf() {
		this._perf = {
			frameCount: 0,
			totalRenderMs: 0,
			avgRenderMs: 0,
			maxRenderMs: 0,
			lastDirtyRows: 0
		};
	}
	cell(row, col) {
		if (!this._bridge) return null;
		const c = this._bridge.getCell(row, col);
		return {
			...c,
			charStr: c.char >= 32 ? String.fromCodePoint(c.char) : "",
			flagNames: flagsToNames(c.flags)
		};
	}
	row(row) {
		if (!this._bridge) return null;
		const cols = this._bridge.getCols();
		const cells = [];
		for (let c = 0; c < cols; c++) cells.push(this.cell(row, c));
		return cells;
	}
	grid() {
		if (!this._bridge) return null;
		const cursor = this._bridge.getCursor();
		return {
			rows: this._bridge.getRows(),
			cols: this._bridge.getCols(),
			cursor,
			altScreen: this._bridge.usingAltScreen(),
			scrollbackCount: this._bridge.getScrollbackCount()
		};
	}
	unhandled() {
		if (!this._bridge) return [];
		return this._bridge.getUnhandledSequences();
	}
	dump(count = 50) {
		const entries = this._traces.slice(-count);
		console.group(`%cwterm debug — last ${entries.length} traces`, "color: #569cd6; font-weight: bold");
		for (const e of entries) {
			const badge = e.type === "sgr" ? "%cSGR" : e.type === "csi" ? "%cCSI" : e.type === "osc" ? "%cOSC" : e.type === "esc" ? "%cESC" : "%cTXT";
			const color = e.type === "sgr" ? "background:#2d5a27;color:#fff;padding:1px 4px;border-radius:2px" : e.type === "csi" ? "background:#1e4a7a;color:#fff;padding:1px 4px;border-radius:2px" : "background:#555;color:#fff;padding:1px 4px;border-radius:2px";
			const detail = [
				e.private ? `private=${e.private}` : "",
				e.params ? `params=[${e.params}]` : "",
				e.final ? `final=${e.final}` : ""
			].filter(Boolean).join(" ");
			console.log(`${badge} ${e.raw.slice(0, 40)}`, color, detail ? `  ${detail}` : "");
		}
		console.groupEnd();
	}
	dumpUnhandled() {
		const entries = this.unhandled();
		if (entries.length === 0) {
			console.log("%cwterm debug — no unhandled sequences", "color: #6a9955");
			return;
		}
		console.group(`%cwterm debug — ${entries.length} unhandled sequences`, "color: #d7ba7d; font-weight: bold");
		for (const e of entries) console.log(`  final=${e.final} private=${e.private || "-"} params=[${e.params.slice(0, e.paramCount)}]`);
		console.groupEnd();
	}
};
//#endregion
//#region node_modules/@wterm/dom/dist/wterm.js
var WTerm = class {
	constructor(element, options = {}) {
		this.bridge = null;
		this.debug = null;
		this.renderer = null;
		this.input = null;
		this.rafId = null;
		this._renderTimer = null;
		this.resizeObserver = null;
		this._destroyed = false;
		this._shouldScrollToBottom = false;
		this._rowHeight = 0;
		this.element = element;
		this._coreOption = options.core;
		this.wasmUrl = options.wasmUrl;
		this.cols = options.cols || 80;
		this.rows = options.rows || 24;
		this.autoResize = options.autoResize !== false;
		this._debugEnabled = options.debug ?? false;
		this.onData = options.onData || null;
		this.onTitle = options.onTitle || null;
		this.onResize = options.onResize || null;
		this._container = document.createElement("div");
		this._container.className = "term-grid";
		this.element.appendChild(this._container);
		this.element.classList.add("wterm");
		if (options.cursorBlink) this.element.classList.add("cursor-blink");
		this._onClickFocus = () => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) this.input?.focus();
		};
		this.element.addEventListener("click", this._onClickFocus);
	}
	async init() {
		try {
			if (this._coreOption) this.bridge = this._coreOption;
			else this.bridge = await WasmBridge.load(this.wasmUrl);
			if (this._destroyed) return this;
			this.bridge.init(this.cols, this.rows);
			if (this._debugEnabled) {
				this.debug = new DebugAdapter();
				this.debug.setBridge(this.bridge);
				globalThis.__wterm = this;
			}
			this._setRowHeight();
			this.renderer = new Renderer(this._container);
			this.renderer.setup(this.cols, this.rows);
			this.input = new InputHandler(this.element, (data) => {
				this._scrollToBottom();
				if (this.onData) this.onData(data);
				else this.write(data);
			}, () => this.bridge);
			if (this.autoResize) this._setupResizeObserver();
			else this._lockHeight();
			this.input.focus();
			this._initialRender();
		} catch (err) {
			this.destroy();
			throw new Error(`wterm: failed to initialize: ${err instanceof Error ? err.message : err}`);
		}
		return this;
	}
	_isScrolledToBottom() {
		const el = this.element;
		return el.scrollHeight - el.scrollTop - el.clientHeight < 5;
	}
	_scrollToBottom() {
		const el = this.element;
		const maxScroll = el.scrollHeight - el.clientHeight;
		if (maxScroll <= 0) {
			el.scrollTop = 0;
			return;
		}
		const rh = this._rowHeight || 17;
		el.scrollTop = Math.floor(maxScroll / rh) * rh;
	}
	write(data) {
		if (!this.bridge) return;
		if (this.debug) this.debug.traceWrite(data);
		this._shouldScrollToBottom = this._isScrolledToBottom();
		if (typeof data === "string") this.bridge.writeString(data);
		else this.bridge.writeRaw(data);
		this._scheduleRender();
	}
	resize(cols, rows) {
		if (!this.bridge) return;
		this._shouldScrollToBottom = this._isScrolledToBottom();
		this.cols = cols;
		this.rows = rows;
		this.bridge.resize(cols, rows);
		this.renderer?.setup(cols, rows);
		this._scheduleRender();
		if (this.onResize) this.onResize(cols, rows);
	}
	focus() {
		if (this.input) this.input.focus();
		else this.element.focus();
	}
	_scheduleRender() {
		if (this._renderTimer != null) return;
		this._renderTimer = setTimeout(() => {
			this._renderTimer = null;
			if (this.rafId == null) this.rafId = requestAnimationFrame(() => {
				this.rafId = null;
				this._doRender();
			});
		}, 0);
	}
	_initialRender() {
		this._doRender();
	}
	_doRender() {
		if (!this.bridge || !this.renderer) return;
		let dirtyCount = 0;
		const t0 = this.debug ? performance.now() : 0;
		if (this.debug) {
			for (let r = 0; r < this.rows; r++) if (this.bridge.isDirtyRow(r)) dirtyCount++;
		}
		this.renderer.render(this.bridge);
		if (this.debug) this.debug.recordRender(performance.now() - t0, dirtyCount);
		const hasScrollback = this.bridge.getScrollbackCount() > 0;
		this.element.classList.toggle("has-scrollback", hasScrollback);
		if (this._shouldScrollToBottom) this._scrollToBottom();
		else if (!hasScrollback && this.element.scrollTop !== 0) this.element.scrollTop = 0;
		const title = this.bridge.getTitle();
		if (title !== null && this.onTitle) this.onTitle(title);
		const response = this.bridge.getResponse();
		if (response !== null && this.onData) this.onData(response);
	}
	_lockHeight() {
		const rh = this._rowHeight || 17;
		const gridHeight = this.rows * rh;
		const cs = getComputedStyle(this.element);
		let extra = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
		if (cs.boxSizing === "border-box") extra += (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
		this.element.style.height = `${gridHeight + extra}px`;
	}
	_setRowHeight() {
		const probe = document.createElement("div");
		probe.className = "term-row";
		probe.style.visibility = "hidden";
		probe.style.position = "absolute";
		probe.textContent = "W";
		this._container.appendChild(probe);
		const h = probe.getBoundingClientRect().height;
		probe.remove();
		if (h > 0) {
			const rh = Math.ceil(h);
			this._rowHeight = rh;
			this.element.style.setProperty("--term-row-height", `${rh}px`);
		}
	}
	_measureCharSize() {
		const row = document.createElement("div");
		row.className = "term-row";
		row.style.visibility = "hidden";
		row.style.position = "absolute";
		const probe = document.createElement("span");
		probe.textContent = "W";
		row.appendChild(probe);
		this._container.appendChild(row);
		const charWidth = probe.getBoundingClientRect().width;
		const rowHeight = row.getBoundingClientRect().height;
		row.remove();
		if (charWidth === 0 || rowHeight === 0) return null;
		this._rowHeight = rowHeight;
		return {
			charWidth,
			rowHeight
		};
	}
	_setupResizeObserver() {
		const initial = this._measureCharSize();
		if (!initial) return;
		let { charWidth, rowHeight } = initial;
		this.resizeObserver = new ResizeObserver((entries) => {
			const measured = this._measureCharSize();
			if (measured) {
				charWidth = measured.charWidth;
				rowHeight = measured.rowHeight;
			}
			for (const entry of entries) {
				const { width, height } = entry.contentRect;
				const newCols = Math.max(1, Math.floor(width / charWidth));
				const newRows = Math.max(1, Math.floor(height / rowHeight));
				if (newCols !== this.cols || newRows !== this.rows) this.resize(newCols, newRows);
			}
		});
		this.resizeObserver.observe(this.element);
	}
	destroy() {
		this._destroyed = true;
		if (this._renderTimer != null) clearTimeout(this._renderTimer);
		if (this.rafId != null) cancelAnimationFrame(this.rafId);
		if (this.resizeObserver) this.resizeObserver.disconnect();
		if (this.input) this.input.destroy();
		this.element.removeEventListener("click", this._onClickFocus);
		this.element.innerHTML = "";
		if (this.debug && globalThis.__wterm === this) delete globalThis.__wterm;
		this.debug = null;
	}
};
//#endregion
//#region node_modules/@wterm/react/dist/Terminal.js
var Terminal = (0, import_react.forwardRef)(function Terminal({ cols = 80, rows = 24, core, wasmUrl, theme, autoResize = false, cursorBlink = false, debug = false, onData, onTitle, onResize, onReady, onError, className, style, ...htmlProps }, ref) {
	const wtermRef = (0, import_react.useRef)(null);
	const callbacksRef = (0, import_react.useRef)({
		onData,
		onTitle,
		onResize,
		onReady,
		onError
	});
	const autoResizeRef = (0, import_react.useRef)(autoResize);
	callbacksRef.current = {
		onData,
		onTitle,
		onResize,
		onReady,
		onError
	};
	autoResizeRef.current = autoResize;
	(0, import_react.useImperativeHandle)(ref, () => ({
		write(data) {
			wtermRef.current?.write(data);
		},
		resize(c, r) {
			wtermRef.current?.resize(c, r);
		},
		focus() {
			wtermRef.current?.focus();
		},
		get instance() {
			return wtermRef.current;
		}
	}));
	const containerRef = (0, import_react.useCallback)((el) => {
		if (!el) return;
		const wt = new WTerm(el, {
			cols,
			rows,
			core,
			wasmUrl,
			autoResize: autoResizeRef.current,
			cursorBlink,
			debug,
			onData: callbacksRef.current.onData ? (data) => callbacksRef.current.onData?.(data) : void 0,
			onTitle: (title) => callbacksRef.current.onTitle?.(title),
			onResize: (c, r) => callbacksRef.current.onResize?.(c, r)
		});
		wtermRef.current = wt;
		wt.init().then(() => {
			callbacksRef.current.onReady?.(wt);
		}).catch((err) => {
			if (callbacksRef.current.onError) callbacksRef.current.onError(err);
			else console.error(err);
		});
		return () => {
			wt.destroy();
			wtermRef.current = null;
		};
	}, [core, wasmUrl]);
	const wt = wtermRef.current;
	if (wt?.bridge) {
		if (!autoResizeRef.current && (wt.cols !== cols || wt.rows !== rows)) wt.resize(cols, rows);
		const el = wt.element;
		if (cursorBlink && !el.classList.contains("cursor-blink")) el.classList.add("cursor-blink");
		else if (!cursorBlink && el.classList.contains("cursor-blink")) el.classList.remove("cursor-blink");
		if (onData && !wt.onData) wt.onData = (data) => callbacksRef.current.onData?.(data);
		else if (!onData && wt.onData) wt.onData = null;
	}
	const classes = [
		"wterm",
		theme ? `theme-${theme}` : "",
		className
	].filter(Boolean).join(" ");
	const mergedStyle = {
		...autoResize ? void 0 : { height: rows * 17 + 24 },
		...style
	};
	return (0, import_jsx_runtime.jsx)("div", {
		ref: containerRef,
		className: classes || void 0,
		style: mergedStyle,
		role: "textbox",
		"aria-label": "Terminal",
		"aria-multiline": "true",
		"aria-roledescription": "terminal",
		...htmlProps
	});
});
//#endregion
//#region node_modules/@wterm/react/dist/useTerminal.js
function useTerminal() {
	const ref = (0, import_react.useRef)(null);
	return {
		ref,
		write: (0, import_react.useCallback)((data) => {
			ref.current?.write(data);
		}, []),
		resize: (0, import_react.useCallback)((cols, rows) => {
			ref.current?.resize(cols, rows);
		}, []),
		focus: (0, import_react.useCallback)(() => {
			ref.current?.focus();
		}, [])
	};
}
//#endregion
//#region node_modules/@wterm/ghostty/dist/wasm-bindings.js
var DEFAULT_WASM_PATH = new URL("" + new URL("ghostty-vt-BG4Ub6dk.wasm", import.meta.url).href, "" + import.meta.url).href;
/**
* Load the ghostty-vt WASM module.
*
* @param wasmUrl - URL or path to the .wasm file. Defaults to the
*   committed binary at `../wasm/ghostty-vt.wasm`.
*/
async function loadGhosttyWasm(wasmUrl) {
	const bytes = await (await fetch(wasmUrl ?? DEFAULT_WASM_PATH)).arrayBuffer();
	let wasmMemory;
	const { instance } = await WebAssembly.instantiate(bytes, { env: { log(ptr, len) {
		const text = new TextDecoder().decode(new Uint8Array(wasmMemory.buffer, ptr, len));
		console.log("[ghostty-vt]", text);
	} } });
	wasmMemory = instance.exports.memory;
	return {
		exports: instance.exports,
		instance
	};
}
/**
* Parse a single cell from the viewport buffer at the given byte offset.
* The buffer layout matches the 16-byte struct from wasm_api.zig.
*/
function parseCell(view, byteOffset) {
	return {
		codepoint: view.getUint32(byteOffset, true),
		fgR: view.getUint8(byteOffset + 4),
		fgG: view.getUint8(byteOffset + 5),
		fgB: view.getUint8(byteOffset + 6),
		bgR: view.getUint8(byteOffset + 7),
		bgG: view.getUint8(byteOffset + 8),
		bgB: view.getUint8(byteOffset + 9),
		flags: view.getUint8(byteOffset + 10),
		width: view.getUint8(byteOffset + 11),
		colorFlags: view.getUint8(byteOffset + 12)
	};
}
/**
* Allocate a buffer in WASM memory and return its pointer.
* The caller must free it with freeBuffer when done.
*/
function allocBuffer(wasm, size) {
	return wasm.exports.alloc_buffer(size);
}
/** Free a buffer previously allocated with allocBuffer. */
function freeBuffer(wasm, ptr, size) {
	wasm.exports.free_buffer(ptr, size);
}
/**
* Write a UTF-8 string into WASM memory and call the terminal's write
* function. Handles allocation/deallocation of the transfer buffer.
*/
function writeString(wasm, termPtr, str) {
	writeBytes(wasm, termPtr, new TextEncoder().encode(str));
}
/**
* Write raw bytes into the terminal. Handles allocation/deallocation
* of the transfer buffer.
*/
function writeBytes(wasm, termPtr, data) {
	if (data.length === 0) return;
	const bufPtr = allocBuffer(wasm, data.length);
	if (bufPtr === 0) return;
	new Uint8Array(wasm.exports.memory.buffer, bufPtr, data.length).set(data);
	wasm.exports.write(termPtr, bufPtr, data.length);
	freeBuffer(wasm, bufPtr, data.length);
}
//#endregion
//#region node_modules/@wterm/ghostty/dist/ghostty-core.js
var DEFAULT_COLOR = 256;
function packRgb(r, g, b) {
	return r << 16 | g << 8 | b;
}
var BLANK_CELL = {
	char: 32,
	fg: DEFAULT_COLOR,
	bg: DEFAULT_COLOR,
	flags: 0
};
/**
* Terminal core powered by libghostty built from source. Implements the
* same `TerminalCore` interface as wterm's built-in Zig core, providing
* full-featured VT emulation including proper Unicode grapheme handling,
* all SGR attributes, terminal modes, and more.
*
* @example
* ```ts
* import { WTerm } from '@wterm/dom';
* import { GhosttyCore } from '@wterm/ghostty';
*
* const core = await GhosttyCore.load();
* const term = new WTerm(el, { core });
* await term.init();
* ```
*/
var GhosttyCore = class GhosttyCore {
	constructor(wasm, options) {
		this.termPtr = 0;
		this._viewportBufPtr = 0;
		this._viewportBufSize = 0;
		this._viewportView = null;
		this._viewportStale = true;
		this._cols = 0;
		this._rows = 0;
		this.wasm = wasm;
		this._options = options;
	}
	/**
	* Load the ghostty-vt WASM binary and create a new `GhosttyCore`.
	* The returned core is ready to be passed as the `core` option to `WTerm`.
	*/
	static async load(options = {}) {
		return new GhosttyCore(await loadGhosttyWasm(options.wasmPath), options);
	}
	init(cols, rows) {
		this._cols = cols;
		this._rows = rows;
		const scrollback = this._options.scrollbackLimit ?? 1e4;
		this.termPtr = this.wasm.exports.init(cols, rows, scrollback);
		this._allocViewportBuffer();
		this._invalidate();
	}
	resize(cols, rows) {
		this._cols = cols;
		this._rows = rows;
		this.wasm.exports.resize(this.termPtr, cols, rows);
		this._allocViewportBuffer();
		this._invalidate();
	}
	writeString(str) {
		writeString(this.wasm, this.termPtr, str);
		this._invalidate();
	}
	writeRaw(data) {
		writeBytes(this.wasm, this.termPtr, data);
		this._invalidate();
	}
	getCell(row, col) {
		this._ensureViewport();
		const view = this._viewportView;
		if (!view) return BLANK_CELL;
		const byteOffset = (row * this._cols + col) * 16;
		if (byteOffset + 16 > this._viewportBufSize) return BLANK_CELL;
		const cell = parseCell(view, byteOffset);
		if (cell.codepoint === 0 && cell.flags === 0 && cell.colorFlags === 0) return BLANK_CELL;
		const result = {
			char: cell.codepoint || 32,
			fg: DEFAULT_COLOR,
			bg: DEFAULT_COLOR,
			flags: cell.flags
		};
		if (cell.colorFlags & 1) result.fgRgb = packRgb(cell.fgR, cell.fgG, cell.fgB);
		if (cell.colorFlags & 2) result.bgRgb = packRgb(cell.bgR, cell.bgG, cell.bgB);
		return result;
	}
	isDirtyRow(row) {
		this._ensureViewport();
		return this.wasm.exports.is_dirty_row(this.termPtr, row) !== 0;
	}
	clearDirty() {
		this.wasm.exports.clear_dirty(this.termPtr);
		this._viewportStale = true;
	}
	getCols() {
		return this._cols;
	}
	getRows() {
		return this._rows;
	}
	getCursor() {
		this._ensureViewport();
		return {
			row: this.wasm.exports.get_cursor_row(this.termPtr),
			col: this.wasm.exports.get_cursor_col(this.termPtr),
			visible: this.wasm.exports.get_cursor_visible(this.termPtr) !== 0
		};
	}
	cursorKeysApp() {
		return this.wasm.exports.cursor_keys_app(this.termPtr) !== 0;
	}
	bracketedPaste() {
		return this.wasm.exports.bracketed_paste(this.termPtr) !== 0;
	}
	usingAltScreen() {
		return this.wasm.exports.using_alt_screen(this.termPtr) !== 0;
	}
	getTitle() {
		return null;
	}
	getResponse() {
		const bufSize = 4096;
		const bufPtr = allocBuffer(this.wasm, bufSize);
		if (bufPtr === 0) return null;
		const len = this.wasm.exports.read_response(this.termPtr, bufPtr, bufSize);
		if (len === 0) {
			freeBuffer(this.wasm, bufPtr, bufSize);
			return null;
		}
		const bytes = new Uint8Array(this.wasm.exports.memory.buffer, bufPtr, len);
		const text = new TextDecoder().decode(bytes);
		freeBuffer(this.wasm, bufPtr, bufSize);
		return text;
	}
	getScrollbackCount() {
		return this.wasm.exports.get_scrollback_count(this.termPtr);
	}
	getScrollbackCell(offset, col) {
		const maxCols = this._cols;
		const lineSize = maxCols * 16;
		const bufPtr = allocBuffer(this.wasm, lineSize);
		if (bufPtr === 0) return BLANK_CELL;
		const len = this.wasm.exports.get_scrollback_line(this.termPtr, offset, bufPtr, maxCols);
		if (len === 0 || col >= len) {
			freeBuffer(this.wasm, bufPtr, lineSize);
			return BLANK_CELL;
		}
		const cell = parseCell(new DataView(this.wasm.exports.memory.buffer, bufPtr, lineSize), col * 16);
		freeBuffer(this.wasm, bufPtr, lineSize);
		return {
			char: cell.codepoint || 32,
			fg: DEFAULT_COLOR,
			bg: DEFAULT_COLOR,
			flags: cell.flags,
			fgRgb: packRgb(cell.fgR, cell.fgG, cell.fgB),
			bgRgb: packRgb(cell.bgR, cell.bgG, cell.bgB)
		};
	}
	getScrollbackLineLen(offset) {
		const maxCols = this._cols;
		const lineSize = maxCols * 16;
		const bufPtr = allocBuffer(this.wasm, lineSize);
		if (bufPtr === 0) return 0;
		const len = this.wasm.exports.get_scrollback_line(this.termPtr, offset, bufPtr, maxCols);
		freeBuffer(this.wasm, bufPtr, lineSize);
		return len;
	}
	getUnhandledSequences() {
		return [];
	}
	_invalidate() {
		this._viewportStale = true;
	}
	_allocViewportBuffer() {
		if (this._viewportBufPtr !== 0) freeBuffer(this.wasm, this._viewportBufPtr, this._viewportBufSize);
		this._viewportBufSize = this._cols * this._rows * 16;
		this._viewportBufPtr = allocBuffer(this.wasm, this._viewportBufSize);
		this._viewportView = null;
		this._viewportStale = true;
	}
	_ensureViewport() {
		if (!this._viewportStale) return;
		this.wasm.exports.update(this.termPtr);
		this.wasm.exports.get_viewport(this.termPtr, this._viewportBufPtr);
		this._viewportView = new DataView(this.wasm.exports.memory.buffer, this._viewportBufPtr, this._viewportBufSize);
		this._viewportStale = false;
	}
};
//#endregion
//#region src/components/terminal-session.tsx
function TerminalSession(t0) {
	const $ = (0, import_compiler_runtime.c)(6);
	const { sessionId, cwd } = t0;
	const containerRef = (0, import_react.useRef)(null);
	const [dimensions, setDimensions] = (0, import_react.useState)(null);
	let t1;
	let t2;
	if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
		t1 = () => {
			const el = containerRef.current;
			if (!el) return;
			const observer = new ResizeObserver((entries) => {
				for (const entry of entries) {
					const { width, height } = entry.contentRect;
					if (width > 0 && height > 0) setDimensions({
						width,
						height
					});
				}
			});
			observer.observe(el);
			const rect = el.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) setDimensions({
				width: rect.width,
				height: rect.height
			});
			return () => observer.disconnect();
		};
		t2 = [];
		$[0] = t1;
		$[1] = t2;
	} else {
		t1 = $[0];
		t2 = $[1];
	}
	(0, import_react.useEffect)(t1, t2);
	let t3;
	if ($[2] !== cwd || $[3] !== dimensions || $[4] !== sessionId) {
		t3 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			ref: containerRef,
			className: "h-full w-full overflow-hidden",
			children: dimensions ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TerminalInner, {
				sessionId,
				cwd
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "h-full w-full flex items-center justify-center text-neutral-400 font-mono text-sm",
				children: "Measuring layout…"
			})
		});
		$[2] = cwd;
		$[3] = dimensions;
		$[4] = sessionId;
		$[5] = t3;
	} else t3 = $[5];
	return t3;
}
function TerminalInner(t0) {
	const $ = (0, import_compiler_runtime.c)(27);
	const { sessionId, cwd } = t0;
	const { ref, write } = useTerminal();
	const [core, setCore] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)(null);
	const [isReady, setIsReady] = (0, import_react.useState)(false);
	const createdRef = (0, import_react.useRef)(false);
	let t1;
	let t2;
	if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
		t1 = () => {
			let active = true;
			GhosttyCore.load({ wasmPath: "./ghostty-vt.wasm" }).then((loadedCore) => {
				if (active) setCore(loadedCore);
			}).catch((err) => {
				console.error("Failed to load GhosttyCore:", err);
				if (active) setError(err instanceof Error ? err.message : String(err));
			});
			return () => {
				active = false;
			};
		};
		t2 = [];
		$[0] = t1;
		$[1] = t2;
	} else {
		t1 = $[0];
		t2 = $[1];
	}
	(0, import_react.useEffect)(t1, t2);
	let t3;
	let t4;
	if ($[2] !== core || $[3] !== cwd || $[4] !== isReady || $[5] !== sessionId || $[6] !== write) {
		t3 = () => {
			if (!core || !isReady) return;
			console.log(`[Terminal Session] Terminal ready. Initializing PTY session ${sessionId} - CWD: ${cwd}`);
			if (!createdRef.current) {
				createdRef.current = true;
				console.log("Connecting to shell process..");
				window.omni.terminal.create(sessionId, cwd).then(_temp$1).catch((err_0) => {
					console.error("[Terminal Session] Failed to create backend PTY:", err_0);
					setError(err_0 instanceof Error ? err_0.message : String(err_0));
					write(`\r\nError: Failed to connect to shell backend. ${err_0 instanceof Error ? err_0.message : String(err_0)}\r\n`);
				});
			}
			const unsubscribeData = window.omni.terminal.onData((payload) => {
				if (payload.sessionId === sessionId) {
					console.log(`[Terminal Session] stdout data received (${payload.data.length} bytes)`);
					write(payload.data);
				}
			});
			const unsubscribeExit = window.omni.terminal.onExit((payload_0) => {
				if (payload_0.sessionId === sessionId) {
					console.log("[Terminal Session] Shell process exited.");
					write("\r\n[Process completed]\r\n");
				}
			});
			return () => {
				unsubscribeData();
				unsubscribeExit();
			};
		};
		t4 = [
			core,
			isReady,
			sessionId,
			cwd,
			write
		];
		$[2] = core;
		$[3] = cwd;
		$[4] = isReady;
		$[5] = sessionId;
		$[6] = write;
		$[7] = t3;
		$[8] = t4;
	} else {
		t3 = $[7];
		t4 = $[8];
	}
	(0, import_react.useEffect)(t3, t4);
	let t5;
	if ($[9] !== sessionId) {
		t5 = (data) => {
			window.omni.terminal.write(sessionId, data);
		};
		$[9] = sessionId;
		$[10] = t5;
	} else t5 = $[10];
	const handleData = t5;
	let t6;
	if ($[11] !== sessionId) {
		t6 = (cols, rows) => {
			window.omni.terminal.resize(sessionId, cols, rows);
		};
		$[11] = sessionId;
		$[12] = t6;
	} else t6 = $[12];
	const handleResize = t6;
	let t7;
	if ($[13] !== isReady || $[14] !== ref) {
		t7 = () => {
			if (isReady) {
				const timer = setTimeout(() => {
					ref.current?.focus();
				}, 150);
				return () => clearTimeout(timer);
			}
		};
		$[13] = isReady;
		$[14] = ref;
		$[15] = t7;
	} else t7 = $[15];
	let t8;
	if ($[16] !== isReady) {
		t8 = [isReady];
		$[16] = isReady;
		$[17] = t8;
	} else t8 = $[17];
	(0, import_react.useEffect)(t7, t8);
	if (error) {
		let t9;
		if ($[18] !== error) {
			t9 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "h-full w-full flex items-center justify-center text-red-500 font-mono text-sm p-4",
				children: ["Error loading terminal: ", error]
			});
			$[18] = error;
			$[19] = t9;
		} else t9 = $[19];
		return t9;
	}
	if (!core) {
		let t9;
		if ($[20] === Symbol.for("react.memo_cache_sentinel")) {
			t9 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "h-full w-full flex items-center justify-center text-neutral-400 font-mono text-sm",
				children: "Initializing Ghostty Core…"
			});
			$[20] = t9;
		} else t9 = $[20];
		return t9;
	}
	let t9;
	if ($[21] === Symbol.for("react.memo_cache_sentinel")) {
		t9 = () => setIsReady(true);
		$[21] = t9;
	} else t9 = $[21];
	let t10;
	if ($[22] !== core || $[23] !== handleData || $[24] !== handleResize || $[25] !== ref) {
		t10 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Terminal, {
			ref,
			core,
			autoResize: true,
			onData: handleData,
			onResize: handleResize,
			onReady: t9,
			className: "h-full w-full outline-none"
		});
		$[22] = core;
		$[23] = handleData;
		$[24] = handleResize;
		$[25] = ref;
		$[26] = t10;
	} else t10 = $[26];
	return t10;
}
function _temp$1() {
	console.log("[Terminal Session] Backend PTY created successfully.");
}
//#endregion
//#region src/App.tsx
function App() {
	const $ = (0, import_compiler_runtime.c)(19);
	const { activeProject, loadActiveProject, isLoading } = useProjectStore();
	let t0;
	let t1;
	if ($[0] !== loadActiveProject) {
		t0 = () => {
			loadActiveProject();
		};
		t1 = [loadActiveProject];
		$[0] = loadActiveProject;
		$[1] = t0;
		$[2] = t1;
	} else {
		t0 = $[1];
		t1 = $[2];
	}
	(0, import_react.useEffect)(t0, t1);
	if (isLoading) {
		let t2;
		if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
			t2 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "h-screen w-screen flex items-center justify-center bg-surface-1 text-muted-foreground text-sm font-mono",
				children: "Loading project context…"
			});
			$[3] = t2;
		} else t2 = $[3];
		return t2;
	}
	let t2;
	if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
		t2 = { WebkitAppRegion: "drag" };
		$[4] = t2;
	} else t2 = $[4];
	let t3;
	if ($[5] !== activeProject) {
		t3 = activeProject && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProjectIcon, {
			name: activeProject.icon,
			className: "size-4 text-muted-foreground"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-[13px] font-medium tracking-tight text-foreground",
			children: activeProject.name
		})] });
		$[5] = activeProject;
		$[6] = t3;
	} else t3 = $[6];
	let t4;
	if ($[7] !== t3) {
		t4 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "flex items-center gap-2",
			"data-pipper-id": "Project Name",
			children: t3
		});
		$[7] = t3;
		$[8] = t4;
	} else t4 = $[8];
	let t5;
	if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
		t5 = { WebkitAppRegion: "no-drag" };
		$[9] = t5;
	} else t5 = $[9];
	let t6;
	if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
		t6 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			style: t5,
			"data-pipper-id": "Theme Toggle",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ThemeToggle, {})
		});
		$[10] = t6;
	} else t6 = $[10];
	let t7;
	if ($[11] !== t4) {
		t7 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "h-8 flex items-center justify-between pl-20 pr-4 border-b border-border/60 bg-surface-1 select-none shrink-0",
			style: t2,
			"data-pipper-id": "header",
			children: [t4, t6]
		});
		$[11] = t4;
		$[12] = t7;
	} else t7 = $[12];
	let t8;
	if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
		t8 = {
			agent: 40,
			others: 60
		};
		$[13] = t8;
	} else t8 = $[13];
	let t9;
	if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
		t9 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Yt, {
			"data-pipper-id": "agent panel",
			minSize: "40%",
			className: "overflow-hidden",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AgentView, {})
		});
		$[14] = t9;
	} else t9 = $[14];
	let t10;
	if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
		t10 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Qt, {
			className: "group relative w-px bg-border data-[separator-state=hover]:bg-foreground/20 data-[separator-state=drag]:bg-foreground/30 transition-colors",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute inset-y-0 -left-1 -right-1 cursor-col-resize" })
		});
		$[15] = t10;
	} else t10 = $[15];
	let t11;
	if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
		t11 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Ut, {
			orientation: "horizontal",
			defaultLayout: t8,
			className: "flex-1 flex min-h-0",
			"data-pipper-id": "workspace panel",
			children: [
				t9,
				t10,
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Yt, {
					"data-pipper-id": "others panel",
					minSize: "40%",
					className: "overflow-hidden",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(OthersView, {})
				})
			]
		});
		$[16] = t11;
	} else t11 = $[16];
	let t12;
	if ($[17] !== t7) {
		t12 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "relative h-screen w-screen flex flex-col bg-surface-1 text-foreground",
			children: [t7, t11]
		});
		$[17] = t7;
		$[18] = t12;
	} else t12 = $[18];
	return t12;
}
function AgentView() {
	const $ = (0, import_compiler_runtime.c)(108);
	const { activeProject, loadActiveProject } = useProjectStore();
	const { threads, activeThreadId, loadThreads, setActiveThreadId, createThread } = useThreadStore();
	let t0;
	if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
		t0 = [];
		$[0] = t0;
	} else t0 = $[0];
	const [projectsList, setProjectsList] = (0, import_react.useState)(t0);
	const [isDropdownOpen, setIsDropdownOpen] = (0, import_react.useState)(false);
	const [inputValue, setInputValue] = (0, import_react.useState)("");
	let t1;
	if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
		t1 = [];
		$[1] = t1;
	} else t1 = $[1];
	const [messages, setMessages] = (0, import_react.useState)(t1);
	const dropdownRef = (0, import_react.useRef)(null);
	const buttonRef = (0, import_react.useRef)(null);
	const ChevronDownIcon = useIcon("chevron-down");
	let t2;
	let t3;
	if ($[2] !== loadThreads) {
		t2 = () => {
			loadThreads();
		};
		t3 = [loadThreads];
		$[2] = loadThreads;
		$[3] = t2;
		$[4] = t3;
	} else {
		t2 = $[3];
		t3 = $[4];
	}
	(0, import_react.useEffect)(t2, t3);
	let t4;
	let t5;
	if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
		t4 = () => {
			(async function loadProjects() {
				if (window.omni?.projects?.list) setProjectsList(await window.omni.projects.list());
			})();
		};
		t5 = [];
		$[5] = t4;
		$[6] = t5;
	} else {
		t4 = $[5];
		t5 = $[6];
	}
	(0, import_react.useEffect)(t4, t5);
	let t6;
	if ($[7] !== activeProject?.id || $[8] !== activeThreadId || $[9] !== loadActiveProject || $[10] !== threads) {
		t6 = () => {
			if (activeThreadId && threads.length > 0) {
				const activeThread = threads.find((t) => t.id === activeThreadId);
				if (activeThread && activeThread.project_id !== activeProject?.id) window.omni.projects.setActive(activeThread.project_id).then(() => {
					loadActiveProject();
				});
			}
		};
		$[7] = activeProject?.id;
		$[8] = activeThreadId;
		$[9] = loadActiveProject;
		$[10] = threads;
		$[11] = t6;
	} else t6 = $[11];
	let t7;
	if ($[12] !== activeProject || $[13] !== activeThreadId || $[14] !== loadActiveProject || $[15] !== threads) {
		t7 = [
			activeThreadId,
			threads,
			activeProject,
			loadActiveProject
		];
		$[12] = activeProject;
		$[13] = activeThreadId;
		$[14] = loadActiveProject;
		$[15] = threads;
		$[16] = t7;
	} else t7 = $[16];
	(0, import_react.useEffect)(t6, t7);
	let t8;
	let t9;
	if ($[17] !== activeThreadId) {
		t8 = () => {
			if (!activeThreadId) {
				setMessages([]);
				return;
			}
			let active = true;
			window.omni.messages.list(activeThreadId).then((msgs) => {
				if (!active) return;
				setMessages(msgs);
			});
			return () => {
				active = false;
			};
		};
		t9 = [activeThreadId];
		$[17] = activeThreadId;
		$[18] = t8;
		$[19] = t9;
	} else {
		t8 = $[18];
		t9 = $[19];
	}
	(0, import_react.useEffect)(t8, t9);
	let t10;
	if ($[20] !== activeProject?.id || $[21] !== loadActiveProject || $[22] !== setActiveThreadId || $[23] !== threads) {
		t10 = async (threadId) => {
			setActiveThreadId(threadId);
			const selectedThread = threads.find((t_0) => t_0.id === threadId);
			if (selectedThread && selectedThread.project_id !== activeProject?.id) {
				if (window.omni?.projects?.setActive) {
					await window.omni.projects.setActive(selectedThread.project_id);
					await loadActiveProject();
				}
			}
		};
		$[20] = activeProject?.id;
		$[21] = loadActiveProject;
		$[22] = setActiveThreadId;
		$[23] = threads;
		$[24] = t10;
	} else t10 = $[24];
	const handleSelectThread = t10;
	let t11;
	if ($[25] !== activeProject || $[26] !== activeThreadId || $[27] !== createThread || $[28] !== setActiveThreadId || $[29] !== threads) {
		t11 = async (text) => {
			if (!text.trim() || !activeProject) return;
			let targetThreadId = activeThreadId;
			if (!targetThreadId) {
				const title = `${activeProject.name} #${threads.filter((t_1) => t_1.project_id === activeProject.id).length + 1}`;
				if (createThread) {
					const thread = await createThread(activeProject.id, title);
					if (thread) {
						targetThreadId = thread.id;
						setActiveThreadId(thread.id);
					}
				}
			}
			if (!targetThreadId) return;
			const userMsg = await window.omni.messages.create({
				thread_id: targetThreadId,
				role: "user",
				content: text.trim()
			});
			if (targetThreadId === activeThreadId) setMessages((current) => [...current, userMsg]);
			setInputValue("");
			setTimeout(async () => {
				const assistantMsg = await window.omni.messages.create({
					thread_id: targetThreadId,
					role: "assistant",
					content: `I received your message: "${text.trim()}". I am ready to help you with the project "${activeProject.name}".`
				});
				const currentActiveId = useThreadStore.getState().activeThreadId;
				if (targetThreadId === currentActiveId) setMessages((current_0) => [...current_0, assistantMsg]);
			}, 1e3);
		};
		$[25] = activeProject;
		$[26] = activeThreadId;
		$[27] = createThread;
		$[28] = setActiveThreadId;
		$[29] = threads;
		$[30] = t11;
	} else t11 = $[30];
	const handleSend = t11;
	let t12;
	if ($[31] === Symbol.for("react.memo_cache_sentinel")) {
		t12 = async () => {
			setIsDropdownOpen(false);
			if (window.omni?.launch?.show) await window.omni.launch.show("add");
		};
		$[31] = t12;
	} else t12 = $[31];
	const handleAddProject = t12;
	let t13;
	let t14;
	if ($[32] !== isDropdownOpen) {
		t13 = () => {
			const handleClickOutside = function handleClickOutside(event) {
				if (isDropdownOpen && dropdownRef.current && !dropdownRef.current.contains(event.target) && buttonRef.current && !buttonRef.current.contains(event.target)) setIsDropdownOpen(false);
			};
			document.addEventListener("mousedown", handleClickOutside);
			return () => document.removeEventListener("mousedown", handleClickOutside);
		};
		t14 = [isDropdownOpen];
		$[32] = isDropdownOpen;
		$[33] = t13;
		$[34] = t14;
	} else {
		t13 = $[33];
		t14 = $[34];
	}
	(0, import_react.useEffect)(t13, t14);
	let T0;
	let t15;
	let t16;
	let t17;
	let t18;
	let t19;
	let t20;
	let t21;
	let t22;
	let t23;
	let t24;
	if ($[35] !== activeProject?.id || $[36] !== activeThreadId || $[37] !== createThread || $[38] !== handleSelectThread || $[39] !== isDropdownOpen || $[40] !== loadActiveProject || $[41] !== projectsList || $[42] !== setActiveThreadId || $[43] !== threads) {
		const projectItems = projectsList.map(_temp);
		let t25;
		if ($[55] !== activeProject?.id) {
			t25 = (p) => p.id === activeProject?.id;
			$[55] = activeProject?.id;
			$[56] = t25;
		} else t25 = $[56];
		const activeIdx = projectItems.findIndex(t25);
		const checkedIndex = activeIdx !== -1 ? activeIdx : void 0;
		const addProjectIdx = projectItems.length;
		let t26;
		if ($[57] !== projectsList) {
			t26 = (projectId) => {
				const p_0 = projectsList.find((proj) => proj.id === projectId);
				return p_0 ? p_0.icon : null;
			};
			$[57] = projectsList;
			$[58] = t26;
		} else t26 = $[58];
		const getProjectIcon = t26;
		t24 = "h-full w-full flex flex-col bg-surface-1";
		T0 = Tabs;
		t20 = activeThreadId || "";
		t21 = handleSelectThread;
		t22 = "flex-1 flex flex-col min-h-0";
		t23 = "threads panel";
		t18 = "h-11  flex items-center justify-between px-4 select-none shrink-0 bg-surface-1";
		let t27;
		if ($[59] !== getProjectIcon || $[60] !== threads) {
			let t28;
			if ($[62] !== getProjectIcon) {
				t28 = (thread_0) => {
					const projIcon = getProjectIcon(thread_0.project_id);
					const ProjectIconComp = (props_0) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProjectIcon, {
						name: projIcon,
						className: props_0.className
					});
					return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabItem, {
						value: thread_0.id,
						label: thread_0.title,
						icon: ProjectIconComp
					}, thread_0.id);
				};
				$[62] = getProjectIcon;
				$[63] = t28;
			} else t28 = $[63];
			t27 = threads.map(t28);
			$[59] = getProjectIcon;
			$[60] = threads;
			$[61] = t27;
		} else t27 = $[61];
		if ($[64] !== t27) {
			t19 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsList, {
				className: "p-0 gap-1 overflow-x-auto max-w-[calc(100%-40px)]",
				children: t27
			});
			$[64] = t27;
			$[65] = t19;
		} else t19 = $[65];
		t15 = "relative";
		let t28;
		let t29;
		if ($[66] === Symbol.for("react.memo_cache_sentinel")) {
			t28 = () => setIsDropdownOpen(_temp2);
			t29 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(e$3, { size: 16 });
			$[66] = t28;
			$[67] = t29;
		} else {
			t28 = $[66];
			t29 = $[67];
		}
		if ($[68] !== isDropdownOpen) {
			t16 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				ref: buttonRef,
				variant: "ghost",
				size: "icon-sm",
				active: isDropdownOpen,
				onClick: t28,
				children: t29
			});
			$[68] = isDropdownOpen;
			$[69] = t16;
		} else t16 = $[69];
		t17 = isDropdownOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			ref: dropdownRef,
			className: "absolute right-0 top-full mt-1.5 z-50 origin-top-right",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Dropdown, {
				checkedIndex,
				children: [
					projectItems.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuItem, {
						index: item.index,
						label: item.name,
						icon: item.icon,
						checked: activeProject?.id === item.id,
						onSelect: async () => {
							setIsDropdownOpen(false);
							const title_0 = `${item.name} #${threads.filter((t_2) => t_2.project_id === item.id).length + 1}`;
							if (createThread) {
								const thread_1 = await createThread(item.id, title_0);
								if (thread_1) {
									setActiveThreadId(thread_1.id);
									if (window.omni?.projects?.setActive) {
										await window.omni.projects.setActive(item.id);
										await loadActiveProject();
									}
								}
							}
						}
					}, item.id)),
					projectItems.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DropdownSeparator, {}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuItem, {
						index: addProjectIdx,
						label: "Add Project",
						icon: e$8,
						onSelect: handleAddProject
					})
				]
			})
		});
		$[35] = activeProject?.id;
		$[36] = activeThreadId;
		$[37] = createThread;
		$[38] = handleSelectThread;
		$[39] = isDropdownOpen;
		$[40] = loadActiveProject;
		$[41] = projectsList;
		$[42] = setActiveThreadId;
		$[43] = threads;
		$[44] = T0;
		$[45] = t15;
		$[46] = t16;
		$[47] = t17;
		$[48] = t18;
		$[49] = t19;
		$[50] = t20;
		$[51] = t21;
		$[52] = t22;
		$[53] = t23;
		$[54] = t24;
	} else {
		T0 = $[44];
		t15 = $[45];
		t16 = $[46];
		t17 = $[47];
		t18 = $[48];
		t19 = $[49];
		t20 = $[50];
		t21 = $[51];
		t22 = $[52];
		t23 = $[53];
		t24 = $[54];
	}
	let t25;
	if ($[70] !== t15 || $[71] !== t16 || $[72] !== t17) {
		t25 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: t15,
			children: [t16, t17]
		});
		$[70] = t15;
		$[71] = t16;
		$[72] = t17;
		$[73] = t25;
	} else t25 = $[73];
	let t26;
	if ($[74] !== t18 || $[75] !== t19 || $[76] !== t25) {
		t26 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: t18,
			children: [t19, t25]
		});
		$[74] = t18;
		$[75] = t19;
		$[76] = t25;
		$[77] = t26;
	} else t26 = $[77];
	let t27;
	if ($[78] !== activeProject?.id || $[79] !== loadActiveProject || $[80] !== messages || $[81] !== projectsList) {
		t27 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "flex-1 overflow-y-auto min-h-0",
			children: messages.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "h-full flex flex-col items-center justify-center gap-6 p-6",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", {
					className: "text-xl font-semibold tracking-tight text-foreground/60 flex items-center gap-2 flex-wrap justify-center select-none",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "What should we cook in" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: activeProject?.id || "",
							onValueChange: async (val) => {
								if (window.omni?.projects?.setActive) {
									await window.omni.projects.setActive(val);
									await loadActiveProject();
								}
							},
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SelectTrigger, {
								className: cn("min-w-0 h-auto p-0 border-0 bg-transparent hover:bg-transparent shadow-none rounded-none", "text-xl font-semibold text-foreground tracking-tight", "underline underline-offset-4 decoration-border/60 hover:decoration-[#6B97FF]/60", "[&>svg]:hidden"),
								placeholder: "Select project"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SelectContent, { children: projectsList.map(_temp3) })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "?" })
					]
				})
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex flex-col gap-3 p-4",
				children: messages.map(_temp4)
			})
		});
		$[78] = activeProject?.id;
		$[79] = loadActiveProject;
		$[80] = messages;
		$[81] = projectsList;
		$[82] = t27;
	} else t27 = $[82];
	const t28 = messages.length > 0 && "border-t border-border/60";
	let t29;
	if ($[83] !== t28) {
		t29 = cn("p-3 shrink-0 bg-surface-1", t28);
		$[83] = t28;
		$[84] = t29;
	} else t29 = $[84];
	let t30;
	if ($[85] !== ChevronDownIcon) {
		t30 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
			variant: "ghost",
			size: "sm",
			trailingIcon: ChevronDownIcon,
			children: "Sonnet 4.6"
		});
		$[85] = ChevronDownIcon;
		$[86] = t30;
	} else t30 = $[86];
	let t31;
	if ($[87] !== handleSend || $[88] !== inputValue || $[89] !== t30) {
		t31 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "w-full max-w-2xl mx-auto",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InputMessage, {
				value: inputValue,
				onValueChange: setInputValue,
				placeholder: "Ask me anything to start a thread...",
				rightSlot: t30,
				onSend: handleSend
			})
		});
		$[87] = handleSend;
		$[88] = inputValue;
		$[89] = t30;
		$[90] = t31;
	} else t31 = $[90];
	let t32;
	if ($[91] !== t29 || $[92] !== t31) {
		t32 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: t29,
			children: t31
		});
		$[91] = t29;
		$[92] = t31;
		$[93] = t32;
	} else t32 = $[93];
	let t33;
	if ($[94] !== t27 || $[95] !== t32) {
		t33 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex-1 overflow-hidden min-h-0 flex flex-col bg-surface-1",
			children: [t27, t32]
		});
		$[94] = t27;
		$[95] = t32;
		$[96] = t33;
	} else t33 = $[96];
	let t34;
	if ($[97] !== T0 || $[98] !== t20 || $[99] !== t21 || $[100] !== t22 || $[101] !== t23 || $[102] !== t26 || $[103] !== t33) {
		t34 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(T0, {
			value: t20,
			onValueChange: t21,
			className: t22,
			"data-pipper-id": t23,
			children: [t26, t33]
		});
		$[97] = T0;
		$[98] = t20;
		$[99] = t21;
		$[100] = t22;
		$[101] = t23;
		$[102] = t26;
		$[103] = t33;
		$[104] = t34;
	} else t34 = $[104];
	let t35;
	if ($[105] !== t24 || $[106] !== t34) {
		t35 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
			className: t24,
			children: t34
		});
		$[105] = t24;
		$[106] = t34;
		$[107] = t35;
	} else t35 = $[107];
	return t35;
}
function _temp4(msg) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChatMessage, {
		from: msg.role === "user" ? "user" : "assistant",
		children: msg.content
	}, msg.id);
}
function _temp3(project_0, idx_0) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SelectItem, {
		value: project_0.id,
		index: idx_0,
		children: project_0.name
	}, project_0.id);
}
function _temp2(prev) {
	return !prev;
}
function _temp(project, idx) {
	const ProjectIconWrapper = (props) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProjectIcon, {
		name: project.icon,
		className: props.className
	});
	return {
		id: project.id,
		name: project.name,
		icon: ProjectIconWrapper,
		index: idx
	};
}
function OthersView() {
	const $ = (0, import_compiler_runtime.c)(38);
	const { activeProject } = useProjectStore();
	const { sessions, activeSessionId, createSession, closeSession, setActiveSessionId } = useTerminalStore();
	const [activeTabId, setActiveTabId] = (0, import_react.useState)(null);
	const [isDropdownOpen, setIsDropdownOpen] = (0, import_react.useState)(false);
	const dropdownRef = (0, import_react.useRef)(null);
	const buttonRef = (0, import_react.useRef)(null);
	let t0;
	let t1;
	if ($[0] !== activeSessionId || $[1] !== sessions) {
		t0 = () => {
			if (activeSessionId) setActiveTabId(activeSessionId);
			else if (sessions.length > 0) setActiveTabId(sessions[sessions.length - 1].id);
			else setActiveTabId(null);
		};
		t1 = [activeSessionId, sessions];
		$[0] = activeSessionId;
		$[1] = sessions;
		$[2] = t0;
		$[3] = t1;
	} else {
		t0 = $[2];
		t1 = $[3];
	}
	(0, import_react.useEffect)(t0, t1);
	let t2;
	if ($[4] !== setActiveSessionId) {
		t2 = (val) => {
			setActiveTabId(val);
			setActiveSessionId(val);
		};
		$[4] = setActiveSessionId;
		$[5] = t2;
	} else t2 = $[5];
	const handleTabChange = t2;
	let t3;
	let t4;
	if ($[6] !== isDropdownOpen) {
		t3 = () => {
			const handleClickOutside = function handleClickOutside(event) {
				if (isDropdownOpen && dropdownRef.current && !dropdownRef.current.contains(event.target) && buttonRef.current && !buttonRef.current.contains(event.target)) setIsDropdownOpen(false);
			};
			document.addEventListener("mousedown", handleClickOutside);
			return () => document.removeEventListener("mousedown", handleClickOutside);
		};
		t4 = [isDropdownOpen];
		$[6] = isDropdownOpen;
		$[7] = t3;
		$[8] = t4;
	} else {
		t3 = $[7];
		t4 = $[8];
	}
	(0, import_react.useEffect)(t3, t4);
	const t5 = activeTabId || "";
	let t6;
	if ($[9] !== closeSession || $[10] !== sessions) {
		let t7;
		if ($[12] !== closeSession) {
			t7 = (session) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabItem, {
				value: session.id,
				label: session.title,
				onClose: () => closeSession(session.id)
			}, session.id);
			$[12] = closeSession;
			$[13] = t7;
		} else t7 = $[13];
		t6 = sessions.map(t7);
		$[9] = closeSession;
		$[10] = sessions;
		$[11] = t6;
	} else t6 = $[11];
	let t7;
	if ($[14] !== t6) {
		t7 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsList, {
			className: "p-0 gap-1 overflow-x-auto max-w-[calc(100%-40px)]",
			children: t6
		});
		$[14] = t6;
		$[15] = t7;
	} else t7 = $[15];
	let t8;
	let t9;
	if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
		t8 = () => setIsDropdownOpen(_temp5);
		t9 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(e$3, { size: 16 });
		$[16] = t8;
		$[17] = t9;
	} else {
		t8 = $[16];
		t9 = $[17];
	}
	let t10;
	if ($[18] !== isDropdownOpen) {
		t10 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
			ref: buttonRef,
			variant: "ghost",
			size: "icon-sm",
			active: isDropdownOpen,
			onClick: t8,
			children: t9
		});
		$[18] = isDropdownOpen;
		$[19] = t10;
	} else t10 = $[19];
	let t11;
	if ($[20] !== activeProject?.path || $[21] !== createSession || $[22] !== isDropdownOpen) {
		t11 = isDropdownOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			ref: dropdownRef,
			className: "absolute right-0 top-full mt-1.5 z-50 origin-top-right",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dropdown, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuItem, {
				index: 0,
				label: "Terminal",
				onSelect: () => {
					setIsDropdownOpen(false);
					createSession(activeProject?.path);
				}
			}) })
		});
		$[20] = activeProject?.path;
		$[21] = createSession;
		$[22] = isDropdownOpen;
		$[23] = t11;
	} else t11 = $[23];
	let t12;
	if ($[24] !== t10 || $[25] !== t11) {
		t12 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "relative",
			children: [t10, t11]
		});
		$[24] = t10;
		$[25] = t11;
		$[26] = t12;
	} else t12 = $[26];
	let t13;
	if ($[27] !== t12 || $[28] !== t7) {
		t13 = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "h-11  flex items-center justify-between px-4  select-none shrink-0 bg-surface-1",
			"data-pipper-id": "others-tab-panel",
			children: [t7, t12]
		});
		$[27] = t12;
		$[28] = t7;
		$[29] = t13;
	} else t13 = $[29];
	let t14;
	if ($[30] !== activeTabId || $[31] !== sessions) {
		t14 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "flex-1 overflow-hidden min-h-0 flex flex-col bg-surface-1 p-2",
			"data-pipper-id": "others-content-panel",
			children: sessions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "h-full w-full flex flex-col items-center justify-center bg-surface-1 p-6 select-none",
				"data-pipper-id": "others-emptyView-panel",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "flex flex-col items-center gap-2 text-muted-foreground",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-[13px] font-medium tracking-tight",
						children: "Click the plus icon to add new views"
					})
				})
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex-1 overflow-hidden min-h-0",
				children: sessions.map((session_0) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabPanel, {
					value: session_0.id,
					className: "h-full w-full outline-none",
					children: activeTabId === session_0.id && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TerminalSession, {
						sessionId: session_0.id,
						cwd: session_0.cwd
					})
				}, session_0.id))
			})
		});
		$[30] = activeTabId;
		$[31] = sessions;
		$[32] = t14;
	} else t14 = $[32];
	let t15;
	if ($[33] !== handleTabChange || $[34] !== t13 || $[35] !== t14 || $[36] !== t5) {
		t15 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
			className: "h-full w-full flex flex-col bg-surface-1",
			"data-pipper-id": "others-panel",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Tabs, {
				value: t5,
				onValueChange: handleTabChange,
				className: "flex-1 flex flex-col min-h-0",
				children: [t13, t14]
			})
		});
		$[33] = handleTabChange;
		$[34] = t13;
		$[35] = t14;
		$[36] = t5;
		$[37] = t15;
	} else t15 = $[37];
	return t15;
}
function _temp5(prev) {
	return !prev;
}
//#endregion
//#region src/main.tsx
(0, import_client.createRoot)(document.getElementById("root")).render(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.StrictMode, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ThemeProvider, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(App, {}) }) }));
//#endregion
export { __vitePreload as t };
