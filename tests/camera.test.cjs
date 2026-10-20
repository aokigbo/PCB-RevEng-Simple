const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function camera() {
  const c = vm.createContext({
    structuredClone,
    AbortController,
    setTimeout,
    clearTimeout,
    ProjectFile: { root: {}, busy: false },
    syncViewRotation() {},
    hud() {},
  });
  for (const f of [
    "image-source",
    "image-pyramid",
    "catalog",
    "document",
    "geometry",
    "connectivity",
    "registration",
    "canvas",
    "editor",
    "tile-cache",
  ])
    vm.runInContext(fs.readFileSync("js/" + f + ".js", "utf8"), c);
  const r = (s) => vm.runInContext(s, c);
  r(
    `requestRender=()=>{};visibleScans=()=>State.scans;View.width=1200;View.height=800;View.zoom=2.3;View.panX=430;View.panY=-125;`,
  );
  return r;
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);
}
for (const angle of [0, 30, 90, 180, 270])
  test("camera round trip and cursor zoom at " + angle + " degrees", () => {
    const r = camera();
    r(`View.rotation=${angle};`);
    for (const [x, y] of [
      [0, 0],
      [12, -430],
      [-200, 315],
      [19000, 28000],
    ]) {
      const p = r(`screenToWorld(...Object.values(worldToScreen(${x},${y})))`);
      near(p.x, x);
      near(p.y, y);
    }
    const p = r("screenToWorld(270,350)");
    r("zoomAt(270,350,1.7)");
    const q = r("screenToWorld(270,350)");
    near(p.x, q.x);
    near(p.y, q.y);
    r("zoomAt(270,350,1/1.7)");
    const back = r("screenToWorld(270,350)");
    near(back.x, p.x);
    near(back.y, p.y);
  });
test("rotation preserves viewport center, normalizes and never edits engineering data or nets", () => {
  const r = camera();
  r(
    `State.components.push(makeComponent('chip2',{},20,40));rebuildConnectivity();const serialized=serializeProject(),history=History.past.length,nets=Connectivity.nets;const p=screenToWorld(View.width/2,View.height/2);`,
  );
  const original = r("({x:View.panX,y:View.panY})");
  for (let i = 0; i < 4; i++) {
    r("rotateView(90)");
    const p = r("p"),
      q = r("screenToWorld(View.width/2,View.height/2)");
    near(p.x, q.x);
    near(p.y, q.y);
  }
  near(r("View.panX"), original.x);
  near(r("View.panY"), original.y);
  assert.equal(r("View.rotation"), 0);
  assert.equal(r("serializeProject()===serialized"), true);
  assert.equal(r("History.past.length===history"), true);
  assert.equal(r("Connectivity.nets===nets"), true);
  r("rotateView(-450)");
  assert.equal(r("View.rotation"), -90);
  r("resetViewRotation()");
  assert.equal(r("View.rotation"), 0);
});
for (const angle of [0, 30, 90, 180, 270])
  test("Fit contains the aligned rectangular scan at " + angle + " degrees", () => {
    const r = camera();
    r(
      `View.rotation=${angle};State.scans=[{width:900,height:300,flipX:true,flipY:false,transform:{tx:100,ty:30,rotation:19,scale:1.3}}];fitBoard();`,
    );
    assert.equal(r("View.rotation"), angle);
    for (const [x, y] of [
      [0, 0],
      [900, 0],
      [900, 300],
      [0, 300],
    ]) {
      const p = r(`worldToScreen(...Object.values(imageToWorld(State.scans[0],{x:${x},y:${y}})))`);
      assert.ok(p.x >= 50 - 1e-8 && p.x <= 1150 + 1e-8);
      assert.ok(p.y >= 50 - 1e-8 && p.y <= 750 + 1e-8);
    }
  });
test("screen marquee excludes components inside only the rotated world bounding box", () => {
  const r = camera();
  r(`View.zoom=1;View.panX=0;View.panY=0;View.rotation=45;
 const inside=makeComponent('free',{w:1,h:1,pinList:[]},100,0,'U',1),outside=makeComponent('free',{w:1,h:1,pinList:[]},90,30,'U',1);State.components=[inside,outside];
 const selection=marqueeSelection({x:50,y:50},{x:100,y:100});`);
  assert.equal(r("selection.object.id"), r("inside.id"));
  const corners = r(
    "marqueeWorldCorners({x:50,y:50},{x:100,y:100}).map(p=>worldToScreen(p.x,p.y))",
  );
  for (let i = 0; i < 4; i++) {
    near(corners[i].x, [50, 100, 100, 50][i]);
    near(corners[i].y, [50, 50, 100, 100][i]);
  }
});
test("resize cursor follows scene orientation and wheel zoom keeps an active pan continuous", () => {
  const r = camera();
  r(
    `const c=makeComponent('free',{w:10,h:6,pinList:[]},0,0);State.components=[c];Editor.selection={type:'component',object:c};View.zoom=2;View.panX=300;View.panY=300;const corner=bodyCornersWorld(c)[0];`,
  );
  r("View.rotation=0");
  const cursor = r("resizeHandleAt(corner).cursor");
  r("View.rotation=90");
  assert.notEqual(r("resizeHandleAt(corner).cursor"), cursor);
  r(
    `Editor.drag={type:'pan',x:View.panX,y:View.panY,start:{x:250,y:200}};const before={x:View.panX,y:View.panY};zoomAt(400,200,2);`,
  );
  near(r("Editor.drag.x-before.x"), r("View.panX-before.x"));
  near(r("Editor.drag.y-before.y"), r("View.panY-before.y"));
});
test("rotated viewport requests cover every corner and grid bounds include all four corners", () => {
  const r = camera();
  r(
    `const scan={id:7,width:30000,height:20000,maxLogicalLevel:6,flipX:false,flipY:false,transform:{tx:0,ty:0,scale:1,rotation:0}};View.zoom=.15;`,
  );
  for (const angle of [0, 30, 90, 180, 270]) {
    r(
      `View.rotation=${angle};View.panX=0;View.panY=0;keepWorldAt({x:15000,y:10000},View.width/2,View.height/2);`,
    );
    const corners = r("viewportWorldCorners()"),
      specs = r("visibleTileSpecs(scan)"),
      factor = specs[0].factor;
    for (const p of corners) {
      const x = Math.floor(p.x / factor / 512),
        y = Math.floor(p.y / factor / 512);
      assert.ok(specs.some((s) => s.x === x && s.y === y));
    }
    assert.equal(corners.length, 4);
  }
});
