const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function geometry() {
  const ctx = vm.createContext({ State: { pxPerMm: 10 }, View: { zoom: 1 } });
  vm.runInContext(fs.readFileSync("js/geometry.js", "utf8"), ctx);
  return ctx;
}
test("back-side pads mirror before component rotation", () => {
  const g = geometry();
  const p = g.pinWorldPos({ x: 100, y: 50, rot: 90, side: "back" }, { xmm: 2, ymm: 1 });
  assert.ok(Math.abs(p.x - 90) < 1e-9);
  assert.ok(Math.abs(p.y - 30) < 1e-9);
});
test("narrow rectangular pads do not falsely contact neighboring copper", () => {
  const g = geometry(),
    c = { x: 0, y: 0, rot: 0, side: "front" };
  const pad = { xmm: 0, ymm: 0, w: 0.3, h: 2, shape: "rect" };
  assert.equal(g.pinEdgeDist(c, pad, 4, 0), 2.5);
  assert.equal(g.padHitsSeg(c, pad, { x: 4, y: -20 }, { x: 4, y: 20 }, 0.5), false);
  assert.equal(g.padHitsSeg(c, pad, { x: 0, y: -20 }, { x: 0, y: 20 }, 0.5), true);
});
test("pad positions round trip through rotated and mirrored local coordinates", () => {
  const g = geometry();
  for (const side of ["front", "back"])
    for (const rot of [0, 37, 90, 180]) {
      const c = { x: 25, y: -30, rot, side };
      const w = g.compMmToWorld(c, 3, -4),
        p = g.compWorldToMm(c, w.x, w.y);
      assert.ok(Math.abs(p.x - 3) < 1e-9);
      assert.ok(Math.abs(p.y + 4) < 1e-9);
    }
});
test("segment distances handle crossing, collinear and zero-length segments", () => {
  const g = geometry();
  assert.equal(g.minSegDist({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }), 0);
  assert.equal(g.minSegDist({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 20, y: 0 }), 0);
  assert.equal(g.distToSeg(3, 4, { x: 0, y: 0 }, { x: 0, y: 0 }), 5);
});

test("body and pad corners follow rotation and back-side mirroring", () => {
  const g = geometry();
  for (const side of ["front", "back"]) {
    const c = { x: 100, y: 50, rot: 90, side, body: { w: 4, h: 2 } };
    const corners = g.bodyCornersWorld(c);
    const expected =
      side === "front"
        ? [
            [110, 30],
            [110, 70],
            [90, 70],
            [90, 30],
          ]
        : [
            [110, 70],
            [110, 30],
            [90, 30],
            [90, 70],
          ];
    corners.forEach((p, i) => {
      assert.ok(Math.hypot(p.x - expected[i][0], p.y - expected[i][1]) < 1e-9);
    });
    const p = { xmm: 3, ymm: -2, w: 2, h: 1 };
    const padCorners = g.padCornersWorld(c, p);
    assert.ok(Math.abs(padCorners[0].x - 125) < 1e-9);
    assert.ok(Math.abs(padCorners[0].y - (side === "front" ? 70 : 30)) < 1e-9);
  }
});
test("anchored resizing keeps the opposite corner fixed for rotated and mirrored bodies", () => {
  const g = geometry();
  for (const side of ["front", "back"])
    for (const rot of [0, 37, 90, 180]) {
      const c = { x: 25, y: -30, rot, side, body: { w: 4, h: 2, xmm: 3, ymm: -1 }, pins: [] };
      const old = g.bodyCornersWorld(c);
      for (let i = 0; i < 4; i++) {
        const anchor = g.compWorldToMm(c, old[(i + 2) % 4].x, old[(i + 2) % 4].y);
        const target = {
          x: anchor.x + ([0, 3].includes(i) ? -8 : 8),
          y: anchor.y + (i < 2 ? -6 : 6),
        };
        const resized = g.resizeGeometry(
          c,
          g.compMmToWorld(c, target.x, target.y),
          anchor,
          c.body,
          i,
        );
        const corners = g.bodyCornersWorld({ ...c, body: resized });
        assert.ok(
          Math.hypot(
            corners[(i + 2) % 4].x - old[(i + 2) % 4].x,
            corners[(i + 2) % 4].y - old[(i + 2) % 4].y,
          ) < 1e-9,
        );
        assert.ok(Math.abs(resized.w - 8) < 1e-9);
        assert.ok(Math.abs(resized.h - 6) < 1e-9);
      }
      assert.ok(g.compRadius(c) >= Math.hypot(50, -20));
      assert.ok(g.compBoxHalf(c).hx > 0);
    }
});
test("rectangular pad resize moves its centre while leaving its opposite corner anchored", () => {
  const g = geometry(),
    c = { x: 40, y: -20, rot: 37, side: "back" };
  const pad = { xmm: -3, ymm: 2, w: 2, h: 1, shape: "rect" },
    anchor = { x: -4, y: 1.5 };
  const size = g.resizeGeometry(c, g.compMmToWorld(c, 2, 4), anchor, pad, 2);
  assert.ok(Math.abs(size.w - 6) < 1e-9);
  assert.ok(Math.abs(size.h - 2.5) < 1e-9);
  assert.ok(Math.abs(size.xmm + 1) < 1e-9);
  assert.ok(Math.abs(size.ymm - 2.75) < 1e-9);
});
test("Shift preserves the original ratio using the larger relative grow or shrink change", () => {
  const g = geometry(),
    c = { x: 0, y: 0, rot: 0, side: "front" },
    original = { w: 4, h: 2 },
    anchor = { x: 0, y: 0 };
  for (const [x, y, w, h] of [
    [8, 3, 8, 4],
    [3, 4, 8, 4],
    [2, 1.8, 2, 1],
    [3.5, 0.5, 1, 0.5],
  ]) {
    const size = g.resizeGeometry(c, { x: x * 10, y: y * 10 }, anchor, original, 2, true);
    assert.equal(size.w, w);
    assert.equal(size.h, h);
    assert.equal(size.w / size.h, 2);
    assert.equal(size.xmm - size.w / 2, 0);
    assert.equal(size.ymm - size.h / 2, 0);
  }
  const free = g.resizeGeometry(c, { x: 80, y: 30 }, anchor, original, 2);
  assert.notEqual(free.w / free.h, 2);
});
test("circular pads and bodies keep a square anchored box and the drill stays fixed", () => {
  const g = geometry(),
    c = { x: 0, y: 0, rot: 90, side: "back" };
  const original = { w: 1.5, h: 1.5, shape: "circle", hole: 0.8 },
    anchor = { x: 2, y: 1 };
  for (const shift of [false, true])
    for (let i = 0; i < 4; i++) {
      const dx = [0, 3].includes(i) ? -4 : 4,
        dy = i < 2 ? -2 : 2;
      const size = g.resizeGeometry(
        c,
        g.compMmToWorld(c, 2 + dx, 1 + dy),
        anchor,
        original,
        i,
        shift,
        0.9,
      );
      assert.equal(size.w, size.h);
      assert.ok(Math.abs(size.w - 4) < 1e-9);
      assert.ok(Math.abs(size.xmm - (Math.sign(dx) * size.w) / 2 - anchor.x) < 1e-9);
      assert.ok(Math.abs(size.ymm - (Math.sign(dy) * size.h) / 2 - anchor.y) < 1e-9);
    }
  const size = g.resizeGeometry(c, g.compMmToWorld(c, 2, 1), anchor, original, 0, false, 0.9);
  assert.ok(Math.abs(size.w - 0.9) < 1e-9);
  assert.equal(original.hole, 0.8);
});
test("body offsets affect hit testing and bounds without changing pads", () => {
  const g = geometry(),
    c = { x: 0, y: 0, rot: 0, side: "front", body: { w: 4, h: 2, xmm: 10, ymm: 5 }, pins: [] };
  assert.equal(g.pointInComp(c, 100, 50), true);
  assert.equal(g.pointInComp(c, 0, 0), false);
  assert.equal(g.compBoxHalf(c).hx, 120);
  assert.equal(g.compBoxHalf(c).hy, 60);
  const corner = g.bodyCornersWorld(c)[2];
  assert.equal(corner.x, 120);
  assert.equal(corner.y, 60);
  assert.ok(g.compRadius(c) >= Math.hypot(120, 60));
});
