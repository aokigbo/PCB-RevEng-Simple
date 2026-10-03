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
  const p = g.pinWorldPos({ x: 100, y: 50, rot: 90, side: "back", scale: 1 }, { xmm: 2, ymm: 1 });
  assert.ok(Math.abs(p.x - 90) < 1e-9);
  assert.ok(Math.abs(p.y - 30) < 1e-9);
});
test("narrow rectangular pads do not falsely contact neighboring copper", () => {
  const g = geometry(),
    c = { x: 0, y: 0, rot: 0, side: "front", scale: 1 };
  const pad = { xmm: 0, ymm: 0, w: 0.3, h: 2, shape: "rect" };
  assert.equal(g.pinEdgeDist(c, pad, 4, 0), 2.5);
  assert.equal(g.padHitsSeg(c, pad, { x: 4, y: -20 }, { x: 4, y: 20 }, 0.5), false);
  assert.equal(g.padHitsSeg(c, pad, { x: 0, y: -20 }, { x: 0, y: 20 }, 0.5), true);
});
test("pad positions round trip through rotated and mirrored local coordinates", () => {
  const g = geometry();
  for (const side of ["front", "back"])
    for (const rot of [0, 37, 90, 180]) {
      const c = { x: 25, y: -30, rot, side, scale: 1.4 };
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
