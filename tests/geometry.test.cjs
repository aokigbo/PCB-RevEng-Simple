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
test("body resizing uses local physical dimensions at every rotation and side", () => {
  const g = geometry();
  for (const side of ["front", "back"])
    for (const rot of [0, 37, 90, 180]) {
      const c = { x: 25, y: -30, rot, side };
      for (const [x, y] of [
        [-4, -3],
        [4, -3],
        [4, 3],
        [-4, 3],
      ]) {
        const size = g.resizeDimensions(c, g.compMmToWorld(c, x, y));
        assert.ok(Math.abs(size.w - 8) < 1e-9);
        assert.ok(Math.abs(size.h - 6) < 1e-9);
      }
    }
});
test("rectangular pads resize around their own local centre", () => {
  const g = geometry();
  const c = { x: 40, y: -20, rot: 37, side: "back" };
  const pad = { xmm: -3, ymm: 2, w: 1, h: 1, shape: "rect" };
  const before = JSON.stringify(pad);
  const size = g.resizeDimensions(c, g.compMmToWorld(c, -5, 5), pad);
  assert.ok(Math.abs(size.w - 4) < 1e-9);
  assert.ok(Math.abs(size.h - 6) < 1e-9);
  assert.equal(JSON.stringify(pad), before);
  const minimum = g.resizeDimensions(c, g.pinWorldPos(c, pad), pad);
  assert.equal(minimum.w, 0.01);
  assert.equal(minimum.h, 0.01);
});
test("round pads stay circular at every corner and keep copper beyond the drill", () => {
  const g = geometry();
  const c = { x: 0, y: 0, rot: 90, side: "back" };
  const pad = { xmm: 2, ymm: 1, w: 1.5, h: 1.5, shape: "circle", tht: true, hole: 0.8 };
  for (const [dx, dy] of [
    [-2, -1],
    [2, -1],
    [2, 1],
    [-2, 1],
  ]) {
    const size = g.resizeDimensions(c, g.compMmToWorld(c, 2 + dx, 1 + dy), pad);
    assert.equal(size.w, size.h);
    assert.ok(Math.abs(size.w - 4) < 1e-9);
  }
  const size = g.resizeDimensions(c, g.pinWorldPos(c, pad), pad);
  assert.equal(size.w, 0.9);
  assert.equal(size.h, 0.9);
  assert.equal(pad.hole, 0.8);
});
