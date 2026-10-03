/* ===== view/geom.js — component/pad geometry & pin-world helpers ===== */
"use strict";

/* ---------- component geometry ---------- */
/* pin position in world coords. Back-side components are mirrored in X (as seen from front). */
function pinWorldPos(comp, pin) {
  const s = State.pxPerMm;
  let x = pin.xmm * s,
    y = pin.ymm * s;
  if (comp.side === "back") x = -x;
  const a = (comp.rot * Math.PI) / 180;
  const ca = Math.cos(a),
    sa = Math.sin(a);
  return { x: comp.x + x * ca - y * sa, y: comp.y + x * sa + y * ca };
}

function compFootprint(comp) {
  return { pins: comp.pins, body: comp.body, label: comp.footprint, kicad: comp.kicad };
}

/* footprint-local mm ⇄ world px (same rotate/mirror convention as pinWorldPos) — used by
   the visual pad editor to place handles and read the cursor back into pad coordinates */
function compMmToWorld(comp, mx, my) {
  const s = State.pxPerMm;
  let x = mx * s,
    y = my * s;
  if (comp.side === "back") x = -x;
  const a = (comp.rot * Math.PI) / 180,
    ca = Math.cos(a),
    sa = Math.sin(a);
  return { x: comp.x + x * ca - y * sa, y: comp.y + x * sa + y * ca };
}
function compWorldToMm(comp, wx, wy) {
  const s = State.pxPerMm;
  let dx = wx - comp.x,
    dy = wy - comp.y;
  const a = (-comp.rot * Math.PI) / 180,
    ca = Math.cos(a),
    sa = Math.sin(a);
  let lx = dx * ca - dy * sa,
    ly = dx * sa + dy * ca;
  if (comp.side === "back") lx = -lx;
  return { x: lx / s, y: ly / s };
}
/* the pad's 4 corners in world px (its oriented bounding box) */
function padCornersWorld(comp, fpin) {
  const hw = fpin.w / 2,
    hh = fpin.h / 2,
    x = fpin.xmm,
    y = fpin.ymm;
  return [
    compMmToWorld(comp, x - hw, y - hh),
    compMmToWorld(comp, x + hw, y - hh),
    compMmToWorld(comp, x + hw, y + hh),
    compMmToWorld(comp, x - hw, y + hh),
  ];
}

function cornersContained(box, corners) {
  return corners.every(
    (p) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY,
  );
}
function bodyCornersWorld(comp) {
  return padCornersWorld(comp, { ...comp.body, xmm: comp.body.xmm || 0, ymm: comp.body.ymm || 0 });
}

// Anchor and original dimensions are captured once when the corner drag starts.
function resizeGeometry(
  comp,
  point,
  anchor,
  original,
  cornerIndex,
  keepAspect = false,
  minimum = 0.01,
) {
  const q = compWorldToMm(comp, point.x, point.y);
  const dx = q.x - anchor.x,
    dy = q.y - anchor.y;
  const sx = Math.sign(dx) || ([0, 3].includes(cornerIndex) ? -1 : 1);
  const sy = Math.sign(dy) || (cornerIndex < 2 ? -1 : 1);
  let w = Math.abs(dx),
    h = Math.abs(dy);
  if (original.shape === "circle" || keepAspect) {
    const ow = original.w,
      oh = original.shape === "circle" ? original.w : original.h;
    // The greater relative change drives both dimensions, for growing or shrinking.
    let factor = Math.abs(w / ow - 1) >= Math.abs(h / oh - 1) ? w / ow : h / oh;
    factor = Math.max(Math.max(minimum / ow, minimum / oh), factor);
    factor = Math.min(factor, 1e7 / Math.max(ow, oh));
    w = ow * factor;
    h = oh * factor;
  } else {
    w = Math.max(minimum, Math.min(1e7, w));
    h = Math.max(minimum, Math.min(1e7, h));
  }
  return { w, h, xmm: anchor.x + (sx * w) / 2, ymm: anchor.y + (sy * h) / 2 };
}

/* distance in world pixels from a world point to a pad's ACTUAL edge (0 when the
   point is inside the pad). Rectangular SMD pads use their real rectangle,
   respecting component rotation and back-side mirror, instead of a round
   max(w,h)/2 hitbox. This stops long rectangular pads from behaving like big
   circles that grab traces they do not really touch. */
function pinEdgeDist(comp, fpin, wx, wy) {
  const s = State.pxPerMm;
  let dx = wx - comp.x,
    dy = wy - comp.y;
  const a = (-comp.rot * Math.PI) / 180,
    ca = Math.cos(a),
    sa = Math.sin(a);
  let lx = dx * ca - dy * sa,
    ly = dx * sa + dy * ca; // undo component rotation
  if (comp.side === "back") lx = -lx; // undo back-side mirror
  const px = lx - fpin.xmm * s,
    py = ly - fpin.ymm * s; // offset from pad centre, world px
  if (fpin.shape === "circle") return Math.max(0, Math.hypot(px, py) - (fpin.w * s) / 2);
  const ex = Math.max(Math.abs(px) - (fpin.w * s) / 2, 0);
  const ey = Math.max(Math.abs(py) - (fpin.h * s) / 2, 0);
  return Math.hypot(ex, ey);
}

/* a pad as an oriented box in world px: centre, the two (unit) edge axes rotated by the
   component, and the half-extents. (Back-side mirror flips an axis sign, which doesn't
   change the box, so it's ignored here.) */
function pinOBB(comp, fpin) {
  const s = State.pxPerMm;
  const wp = pinWorldPos(comp, fpin);
  const a = (comp.rot * Math.PI) / 180,
    ca = Math.cos(a),
    sa = Math.sin(a);
  return {
    cx: wp.x,
    cy: wp.y,
    ux: ca,
    uy: sa,
    vx: -sa,
    vy: ca,
    hw: (fpin.w * s) / 2,
    hh: (fpin.h * s) / 2,
  };
}

/* separating-axis test for two oriented boxes — true when they overlap (within tol px) */
function obbOverlap(A, B, tol) {
  tol = tol || 0;
  const dx = B.cx - A.cx,
    dy = B.cy - A.cy;
  const axes = [
    [A.ux, A.uy],
    [A.vx, A.vy],
    [B.ux, B.uy],
    [B.vx, B.vy],
  ];
  for (const [lx, ly] of axes) {
    const rA = Math.abs(A.hw * (A.ux * lx + A.uy * ly)) + Math.abs(A.hh * (A.vx * lx + A.vy * ly));
    const rB = Math.abs(B.hw * (B.ux * lx + B.uy * ly)) + Math.abs(B.hh * (B.vx * lx + B.vy * ly));
    if (Math.abs(dx * lx + dy * ly) > rA + rB + tol) return false; // found a separating axis
  }
  return true;
}

/* do two pads' copper actually overlap? Uses the real rectangle (SAT) for rect pads, and
   an exact centre-to-edge distance when either pad is round — never the max(w,h) circle
   approximation that makes tall thin pads look like they reach into their neighbours. */
function padsOverlap(cA, fA, cB, fB, tol) {
  tol = tol || 0;
  if (fA.shape === "circle") {
    const c = pinWorldPos(cA, fA);
    return pinEdgeDist(cB, fB, c.x, c.y) <= (fA.w * State.pxPerMm) / 2 + tol;
  }
  if (fB.shape === "circle") {
    const c = pinWorldPos(cB, fB);
    return pinEdgeDist(cA, fA, c.x, c.y) <= (fB.w * State.pxPerMm) / 2 + tol;
  }
  return obbOverlap(pinOBB(cA, fA), pinOBB(cB, fB), tol);
}

/* a trace segment (thick line) as an oriented box: centred on the segment midpoint,
   long axis along it, half-width = the trace's half copper width */
function segOBB(p0, p1, halfW) {
  let dx = p1.x - p0.x,
    dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  return {
    cx: (p0.x + p1.x) / 2,
    cy: (p0.y + p1.y) / 2,
    ux: dx,
    uy: dy,
    vx: -dy,
    vy: dx,
    hw: len / 2,
    hh: halfW,
  };
}

/* does a pad's copper actually overlap a trace segment of half-width halfW? Rectangular
   pads use the real rectangle-vs-rectangle (SAT) test instead of a centre-projection with
   a fat tolerance, so a trace landing on its own pad isn't reported as touching the
   0.5 mm-pitch neighbour beside it. */
function padHitsSeg(comp, fpin, p0, p1, halfW, tol) {
  tol = tol || 0;
  if (fpin.shape === "circle") {
    const c = pinWorldPos(comp, fpin);
    const pr = projectOnSeg(c.x, c.y, p0, p1);
    return pr.d <= (fpin.w * State.pxPerMm) / 2 + halfW + tol;
  }
  // Copper traces have round end caps, including zero-length segments.
  if (
    pinEdgeDist(comp, fpin, p0.x, p0.y) <= halfW + tol ||
    pinEdgeDist(comp, fpin, p1.x, p1.y) <= halfW + tol
  )
    return true;
  if (p0.x === p1.x && p0.y === p1.y) return false;
  return obbOverlap(pinOBB(comp, fpin), segOBB(p0, p1, halfW), tol);
}
function compRadius(comp) {
  const fp = compFootprint(comp);
  const s = State.pxPerMm;
  let r =
    (Math.hypot(fp.body.xmm || 0, fp.body.ymm || 0) + Math.hypot(fp.body.w, fp.body.h) / 2) * s;
  for (const p of fp.pins) r = Math.max(r, (Math.hypot(p.xmm, p.ymm) + Math.max(p.w, p.h)) * s);
  return r;
}

/* world-px half-extents of the part's rotated bounding box (body ∪ pads). Unlike
   compRadius — a circle around the farthest diagonal corner — these hug the actual
   top/side edges, so a floating tag over a WIDE part sits just above the box instead
   of way out at the diagonal radius. */
function compBoxHalf(comp) {
  const fp = compFootprint(comp);
  const s = State.pxPerMm;
  let hw = Math.abs(fp.body.xmm || 0) + fp.body.w / 2,
    hh = Math.abs(fp.body.ymm || 0) + fp.body.h / 2;
  for (const p of fp.pins) {
    hw = Math.max(hw, Math.abs(p.xmm) + p.w / 2);
    hh = Math.max(hh, Math.abs(p.ymm) + p.h / 2);
  }
  // AABB of the hw×hh box after rotating by comp.rot (mirroring doesn't change extent)
  const a = (comp.rot * Math.PI) / 180,
    ca = Math.abs(Math.cos(a)),
    sa = Math.abs(Math.sin(a));
  return { hx: (hw * ca + hh * sa) * s, hy: (hh * ca + hw * sa) * s };
}

/* point-in-component test using the actual outline (body shape + pads),
   not a bounding circle — so a wide connector is only clickable on its body. */
function pointInComp(comp, wx, wy) {
  const fp = compFootprint(comp);
  const s = State.pxPerMm;
  // world → component-local mm
  let dx = wx - comp.x,
    dy = wy - comp.y;
  const a = (-comp.rot * Math.PI) / 180,
    ca = Math.cos(a),
    sa = Math.sin(a);
  let lx = dx * ca - dy * sa,
    ly = dx * sa + dy * ca;
  if (comp.side === "back") lx = -lx;
  const mx = lx / s,
    my = ly / s;
  const tol = 5 / View.zoom / s; // a few screen px, expressed in mm
  const bx = mx - (fp.body.xmm || 0),
    by = my - (fp.body.ymm || 0);
  if (fp.body.shape === "circle") {
    if (Math.hypot(bx / (fp.body.w / 2 + tol), by / (fp.body.h / 2 + tol)) <= 1) return true;
  } else if (Math.abs(bx) <= fp.body.w / 2 + tol && Math.abs(by) <= fp.body.h / 2 + tol) {
    return true;
  }
  for (const p of fp.pins)
    if (Math.abs(mx - p.xmm) <= p.w / 2 + tol && Math.abs(my - p.ymm) <= p.h / 2 + tol) return true;
  return false;
}

function distToSeg(px, py, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

function projectOnSeg(px, py, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + dx * t,
    y = a.y + dy * t;
  return { x, y, d: Math.hypot(px - x, py - y) };
}

function segsIntersect(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = o(a, b, c),
    o2 = o(a, b, d),
    o3 = o(c, d, a),
    o4 = o(c, d, b);
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

function minSegDist(a, b, c, d) {
  if (segsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distToSeg(c.x, c.y, a, b),
    distToSeg(d.x, d.y, a, b),
    distToSeg(a.x, a.y, c, d),
    distToSeg(b.x, b.y, c, d),
  );
}
