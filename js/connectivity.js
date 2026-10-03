"use strict";

const Connectivity = { nets: [], byKey: new Map(), issues: [] };
const pinKey = (c, p) => "p" + c.id + ":" + p.num;
const through = (p) => p.shape === "circle" && p.tht !== false;
function conductors() {
  const out = [];
  for (const c of State.components)
    for (const p of c.pins) {
      const corners = padCornersWorld(c, p),
        wp = pinWorldPos(c, p),
        r = (p.w * State.pxPerMm * c.scale) / 2;
      const box =
        p.shape === "circle"
          ? { minX: wp.x - r, maxX: wp.x + r, minY: wp.y - r, maxY: wp.y + r }
          : bounds(corners);
      out.push({
        key: pinKey(c, p),
        type: "pad",
        c,
        p,
        object: p,
        sides: through(p) ? 3 : c.side === "front" ? 1 : 2,
        box,
      });
    }
  for (const t of State.traces)
    out.push({
      key: "t" + t.id,
      type: "trace",
      object: t,
      sides: t.side === "front" ? 1 : 2,
      box: bounds(t.points, t.width / 2),
    });
  for (const v of State.vias)
    out.push({
      key: "v" + v.id,
      type: "via",
      object: v,
      sides: 3,
      box: { minX: v.x - v.r, maxX: v.x + v.r, minY: v.y - v.r, maxY: v.y + v.r },
    });
  return out;
}
function bounds(points, grow = 0) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - grow, minY: minY - grow, maxX: maxX + grow, maxY: maxY + grow };
}
function copperTouches(a, b) {
  if (!(a.sides & b.sides)) return false;
  const x = a.box,
    y = b.box,
    eps = 1e-7;
  if (
    x.maxX + eps < y.minX ||
    y.maxX + eps < x.minX ||
    x.maxY + eps < y.minY ||
    y.maxY + eps < x.minY
  )
    return false;
  if (a.type === "pad" && b.type === "pad") return padsOverlap(a.c, a.p, b.c, b.p, eps);
  if (a.type === "pad" && b.type === "via")
    return pinEdgeDist(a.c, a.p, b.object.x, b.object.y) <= b.object.r + eps;
  if (a.type === "via" && b.type === "pad") return copperTouches(b, a);
  if (a.type === "via" && b.type === "via")
    return (
      Math.hypot(a.object.x - b.object.x, a.object.y - b.object.y) <= a.object.r + b.object.r + eps
    );
  if (a.type === "trace" && b.type !== "trace") return copperTouches(b, a);
  if (b.type === "trace") {
    const t = b.object;
    for (let j = 1; j < t.points.length; j++) {
      const p = t.points[j - 1],
        q = t.points[j];
      if (a.type === "pad" && padHitsSeg(a.c, a.p, p, q, t.width / 2, eps)) return true;
      if (
        a.type === "via" &&
        distToSeg(a.object.x, a.object.y, p, q) <= a.object.r + t.width / 2 + eps
      )
        return true;
      if (a.type === "trace")
        for (let i = 1; i < a.object.points.length; i++)
          if (
            minSegDist(p, q, a.object.points[i - 1], a.object.points[i]) <=
            (a.object.width + t.width) / 2 + eps
          )
            return true;
    }
  }
  return false;
}
function rebuildConnectivity() {
  const items = conductors(),
    parent = items.map((_, i) => i);
  const root = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  // Sweep by left edge: far apart copper never needs a detailed geometry check.
  const sorted = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.box.minX - b.item.box.minX);
  let active = [];
  for (const b of sorted) {
    active = active.filter((a) => a.item.box.maxX + 1e-7 >= b.item.box.minX);
    for (const a of active) if (copperTouches(a.item, b.item)) parent[root(b.i)] = root(a.i);
    active.push(b);
  }
  const groups = new Map();
  items.forEach((o, i) => {
    const r = root(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(o);
  });
  Connectivity.nets = [];
  Connectivity.byKey = new Map();
  Connectivity.issues = [];
  const usedNames = new Set(items.map((n) => n.object.netName?.trim()).filter(Boolean));
  for (const members of groups.values()) {
    const names = [...new Set(members.map((n) => n.object.netName?.trim()).filter(Boolean))].sort();
    const key = members.map((n) => n.key).sort()[0];
    let autoName = "NET_" + key.replace(":", "_");
    while (usedNames.has(autoName)) autoName += "_";
    if (!names.length) usedNames.add(autoName);
    const net = {
      id: key,
      name: names.join(" / ") || autoName,
      names,
      members,
      conflict: names.length > 1,
    };
    if (net.conflict)
      Connectivity.issues.push("Touching copper has conflicting names: " + names.join(" / "));
    Connectivity.nets.push(net);
    members.forEach((n) => Connectivity.byKey.set(n.key, net));
  }
  const named = new Map();
  for (const net of Connectivity.nets)
    for (const name of net.names) {
      if (named.has(name)) {
        Connectivity.issues.push(
          "Disconnected copper shares the name “" +
            name +
            "”. Rename one group or trace the missing connection.",
        );
        net.conflict = true;
        named.get(name).conflict = true;
      }
      named.set(name, net);
    }
  return Connectivity;
}
function nameNet(key, name) {
  const net = Connectivity.byKey.get(key);
  if (!net) return;
  name = name.trim();
  if (/[\x00-\x1f]/.test(name)) throw new Error("Use a single line for the net name.");
  if (name && Connectivity.nets.some((n) => n !== net && n.names.includes(name)))
    throw new Error("That name belongs to disconnected copper. Connect it with a trace first.");
  for (const member of net.members) delete member.object.netName;
  if (name) net.members.find((n) => n.key === key).object.netName = name;
}
