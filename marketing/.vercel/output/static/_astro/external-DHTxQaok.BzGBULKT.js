let u = [],
  d = 0;
const m = 4;
let h = 0,
  I = (e) => {
    let n = [],
      s = {
        get() {
          return (s.lc || s.listen(() => {})(), s.value);
        },
        lc: 0,
        listen(i) {
          return (
            (s.lc = n.push(i)),
            () => {
              for (let r = d + m; r < u.length; ) u[r] === i ? u.splice(r, m) : (r += m);
              let o = n.indexOf(i);
              ~o && (n.splice(o, 1), --s.lc || s.off());
            }
          );
        },
        notify(i, o) {
          h++;
          let r = !u.length;
          for (let t of n) u.push(t, s.value, i, o);
          if (r) {
            for (d = 0; d < u.length; d += m) u[d](u[d + 1], u[d + 2], u[d + 3]);
            u.length = 0;
          }
        },
        off() {},
        set(i) {
          let o = s.value;
          o !== i && ((s.value = i), s.notify(o));
        },
        subscribe(i) {
          let o = s.listen(i);
          return (i(s.value), o);
        },
        value: e,
      };
    return s;
  };
const C = 5,
  p = 6,
  E = 10;
let V = (e, n, s, i) => (
    (e.events = e.events || {}),
    e.events[s + E] ||
      (e.events[s + E] = i((o) => {
        e.events[s].reduceRight((r, t) => (t(r), r), { shared: {}, ...o });
      })),
    (e.events[s] = e.events[s] || []),
    e.events[s].push(n),
    () => {
      let o = e.events[s],
        r = o.indexOf(n);
      (o.splice(r, 1), o.length || (delete e.events[s], e.events[s + E](), delete e.events[s + E]));
    }
  ),
  x = 1e3,
  R = (e, n) =>
    V(
      e,
      (i) => {
        let o = n(i);
        o && e.events[p].push(o);
      },
      C,
      (i) => {
        let o = e.listen;
        e.listen = (...t) => (!e.lc && !e.active && ((e.active = !0), i()), o(...t));
        let r = e.off;
        return (
          (e.events[p] = []),
          (e.off = () => {
            (r(),
              setTimeout(() => {
                if (e.active && !e.lc) {
                  e.active = !1;
                  for (let t of e.events[p]) t();
                  e.events[p] = [];
                }
              }, x));
          }),
          () => {
            ((e.listen = o), (e.off = r));
          }
        );
      },
    ),
  U = (e, n, s) => {
    Array.isArray(e) || (e = [e]);
    let i,
      o,
      r = () => {
        if (o === h) return;
        o = h;
        let f = e.map((l) => l.get());
        if (!i || f.some((l, c) => l !== i[c])) {
          i = f;
          let l = n(...f);
          l && l.then && l.t
            ? l.then((c) => {
                i === f && t.set(c);
              })
            : (t.set(l), (o = h));
        }
      },
      t = I(void 0),
      T = t.get;
    t.get = () => (r(), T());
    let v,
      g = s
        ? () => {
            (clearTimeout(v), (v = setTimeout(r)));
          }
        : r;
    return (
      R(t, () => {
        let f = e.map((l) => l.listen(g));
        return (
          r(),
          () => {
            for (let l of f) l();
          }
        );
      }),
      t
    );
  },
  a = (e, n) => U(e, n),
  D = (e, n) => U(e, n, !0),
  _ = (e = {}) => {
    let n = I(e);
    return (
      (n.setKey = function (s, i) {
        let o = n.value;
        typeof i > "u" && s in n.value
          ? ((n.value = { ...n.value }), delete n.value[s], n.notify(o, s))
          : n.value[s] !== i && ((n.value = { ...n.value, [s]: i }), n.notify(o, s));
      }),
      n
    );
  };
const P = (e, n, s) => (!e && s ? Q(s) : $(n)),
  Q = (e) => {
    const n = e.userId,
      s = e.user,
      i = e.sessionId,
      o = e.sessionStatus,
      r = e.sessionClaims;
    return {
      userId: n,
      user: s,
      sessionId: i,
      session: e.session,
      sessionStatus: o,
      sessionClaims: r,
      organization: e.organization,
      orgId: e.orgId,
      orgRole: e.orgRole,
      orgPermissions: e.orgPermissions,
      orgSlug: e.orgSlug,
      actor: e.actor,
      factorVerificationAge: e.factorVerificationAge,
    };
  },
  $ = (e) => {
    const n = e.user ? e.user.id : e.user,
      s = e.user,
      i = e.session ? e.session.id : e.session,
      o = e.session,
      r = e.session?.status,
      t = e.session ? e.session.lastActiveToken?.jwt?.claims : null,
      T = e.session ? e.session.factorVerificationAge : null,
      v = o?.actor,
      g = e.organization,
      f = e.organization ? e.organization.id : e.organization,
      l = g?.slug,
      c = g && s?.organizationMemberships?.find((O) => O.organization.id === f),
      N = c && c.permissions;
    return {
      userId: n,
      user: s,
      sessionId: i,
      session: o,
      sessionStatus: r,
      sessionClaims: t,
      organization: g,
      orgId: f,
      orgRole: c && c.role,
      orgSlug: l,
      orgPermissions: N,
      actor: v,
      factorVerificationAge: T,
    };
  },
  F = "METHOD_CALLED",
  H = 0.1;
function q(e, n) {
  return { event: F, eventSamplingRate: H, payload: { method: e, ...n } };
}
const S = _({ isLoaded: !1, client: void 0, user: void 0, session: void 0, organization: void 0 }),
  G = _(),
  z = I(null),
  J = a([S], (e) => e.isLoaded),
  A = D([S, G], (e, n) =>
    P(
      e.isLoaded,
      { session: e.session, user: e.user, organization: e.organization, client: e.client },
      n,
    ),
  );
a([A], (e) => e.user);
const W = a([A], (e) => e.session),
  Y = a([A], (e) => e.organization),
  L = a([S], (e) => e.client),
  X = a([z], (e) => e);
a([L], (e) => e?.sessions);
const w = a([L], (e) => e?.signIn),
  B = a([L], (e) => e?.signUp);
a([z], (e) => e?.billing);
const M = (e, n) => {
  R(e, () => {
    z.get()?.telemetry?.record(q(n));
  });
};
M(w, "$signInStore");
M(B, "$signUpStore");
M(Y, "$organizationStore");
export { J as $, A as a, W as b, z as c, S as d, X as e, G as f };
