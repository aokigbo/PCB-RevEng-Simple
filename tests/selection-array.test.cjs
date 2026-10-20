const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function editor() {
  const c = vm.createContext({ structuredClone, ProjectFile: { root: {}, busy: false } });
  for (const f of [
    "image-pyramid",
    "catalog",
    "document",
    "geometry",
    "connectivity",
    "registration",
    "canvas",
    "pad-array",
    "editor",
    "export",
  ])
    vm.runInContext(fs.readFileSync("js/" + f + ".js", "utf8"), c, { filename: f });
  const r = (s) => vm.runInContext(s, c);
  r(`State.physicalLayers=Array.from({length:6},(_,i)=>({id:i+1,description:''}));State.nextId=idFloor=7;
    View.zoom=1;View.panX=View.panY=200;View.activeLayerId=1;
    const component=(x=0,y=0,rot=0)=>{const c=makeComponent('free',{w:1,h:1,pinList:[]},x,y,'J');c.rot=rot;State.components.push(c);return c;};
    const pad=(x=0,y=0)=>({num:'1',name:'A',x,y,w:4,h:2,shape:'rect',tht:false});
    const trace=(layerId,points,width=2)=>({id:nextId(),layerId,points,width});
    const settings={rows:24,columns:2,numbering:'dip',startPin:1,increment:1,physicalType:'surface',shape:'rect',w:4,h:2,fromLayerId:1,toLayerId:6,diameter:6,hole:2};`);
  return r;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
for (const angle of [0, 30, 90, 180, 270])
  test("marquee includes mixed copper with canonical pads at " + angle + " degrees", () => {
    const r = editor();
    r(`View.rotation=${angle};const a=component(),b=component(300,300),hidden=component();hidden.layerId=2;
      a.pins=[pad(20,0)];b.body.w=b.body.h=500;b.pins=[pad(-290,-300)];
      const via={id:nextId(),x:-15,y:15,r:3,hole:1,fromLayerId:1,toLayerId:6};
      State.vias=[via,{...via,id:nextId(),fromLayerId:2}];
      const t=trace(1,[{x:-20,y:-18},{x:20,y:-18}]);State.traces=[t,trace(2,t.points)];
      const selection=marqueeSelection({x:150,y:150},{x:250,y:250});`);
    assert.deepEqual(JSON.parse(r("JSON.stringify(selection.items.map(s=>s.type).sort())")), [
      "component",
      "pad",
      "trace",
      "via",
    ]);
    assert.equal(r("selection.items.filter(s=>s.object===a).length"), 1);
    assert.equal(r("selection.items.some(s=>s.object===hidden)"), false);
    r("View.vias=View.traces=View.components=false");
    assert.equal(r("marqueeSelection({x:150,y:150},{x:250,y:250})"), null);
  });
test("marquee contains the full round-capped trace width and the true screen-space via circle", () => {
  const r = editor();
  r(`State.traces=[trace(1,[{x:-10,y:0},{x:10,y:0}],4)];`);
  assert.equal(r("marqueeSelection({x:188,y:199},{x:212,y:201})"), null);
  assert.equal(r("marqueeSelection({x:188,y:198},{x:212,y:202}).type"), "trace");
  r(
    `State.traces=[];View.rotation=30;State.vias=[{id:nextId(),x:0,y:0,r:5,hole:1,fromLayerId:1,toLayerId:6}];`,
  );
  assert.equal(r("marqueeSelection({x:195,y:195},{x:205,y:205}).type"), "via");
  assert.equal(r("marqueeSelection({x:195.1,y:195},{x:205,y:205})"), null);
});
test("group bounds include protruding pads, barrels, via circles and full trace strokes", () => {
  const r = editor();
  r(`const c=component();c.body.h=6;c.pins=[pad(15,0)];c.pins[0].barrel={fromLayerId:1,toLayerId:6,diameter:10,hole:2};
    const v={id:nextId(),x:40,y:0,r:3,hole:1,fromLayerId:1,toLayerId:6},t=trace(1,[{x:45,y:20},{x:50,y:20}],6);
    Editor.selection=canonicalSelection([{type:'component',object:c},{type:'pad',object:c,index:0},{type:'via',object:v},{type:'trace',object:t}]);
    const b=selectionGeometryBounds(selectionItems());`);
  assert.deepEqual(JSON.parse(r("JSON.stringify(b)")), { minX: -5, minY: -5, maxX: 53, maxY: 23 });
  assert.equal(r("selectionItems().length"), 3);
  r("View.components=false");
  assert.equal(r("selectionResizeCorners().length"), 4);
});
test("mixed group scaling moves anchors on all barrel layers, scales copper once and undoes once", () => {
  const r = editor();
  r(`const c=component(10,10,30);c.value='Connector';c.pins=[pad(5,0)];c.pins[0].barrel={fromLayerId:1,toLayerId:6,diameter:6,hole:2};
    const pos=pinWorldPos(c,c.pins[0]),v={id:nextId(),x:40,y:20,r:3,hole:1,fromLayerId:1,toLayerId:6};State.vias=[v];
    const t=trace(1,[{x:20,y:40},{x:30,y:50}],4),a3=trace(3,[{...pos},{x:80,y:10},{x:100,y:0}]),a5=trace(5,[{...pos},{x:100,y:0}]),av=trace(4,[{x:40,y:20},{x:100,y:20}]);State.traces=[t,a3,a5,av];
    Editor.selection=canonicalSelection([{type:'component',object:c},{type:'pad',object:c,index:0},{type:'trace',object:t},{type:'via',object:v}]);
    const before=snapshot(),records=selectionRecords(),anchors=anchorsFor(Editor.selection),rotation=c.rot;
    editDocument(()=>{scaleSelectionRecords(records,{x:0,y:0},2,2);applyAnchors(anchors);});rebuildConnectivity();`);
  assert.equal(r("groupNeedsUniformScale(selectionItems())"), true);
  assert.equal(r("c.x"), 20);
  assert.equal(r("c.body.w"), 20);
  near(r("c.pins[0].x"), 10);
  near(r("c.pins[0].w"), 8);
  assert.equal(r("c.pins[0].barrel.diameter"), 12);
  assert.equal(r("c.pins[0].barrel.hole"), 4);
  assert.equal(r("c.pins[0].barrel.toLayerId"), 6);
  assert.equal(r("c.rot"), 30);
  assert.equal(r("c.value"), "Connector");
  assert.equal(r("t.width"), 8);
  assert.equal(r("v.r"), 6);
  assert.equal(r("v.hole"), 2);
  near(r("a3.points[0].x"), r("pos.x*2"));
  near(r("a5.points[0].y"), r("pos.y*2"));
  assert.equal(r("a3.points[1].x"), 80);
  assert.equal(r("av.points[0].x"), 80);
  assert.equal(r("History.past.length"), 1);
  assert.equal(
    r("Connectivity.byKey.get(pinKey(c,c.pins[0]))===Connectivity.byKey.get('t'+a3.id)"),
    true,
  );
  assert.equal(r("validateDocument(documentPayload()).components.length"), 1);
  r("undo()");
  assert.equal(r("snapshot()"), r("before"));
  r("redo()");
  assert.equal(r("State.components[0].pins[0].barrel.diameter"), 12);
});
test("free group scaling of pads in a 90-degree component uses local dimensions and shared snapshots", () => {
  const r = editor();
  r(`const c=component(10,20,90);c.pins=[pad(-10,0),{...pad(10,0),num:'2'}, {...pad(30,0),num:'3'}];
    const selection=canonicalSelection([{type:'pad',object:c,index:0},{type:'pad',object:c,index:1}]),records=selectionRecords(selection),p0=pinWorldPos(c,c.pins[0]),p1=pinWorldPos(c,c.pins[1]);
    scaleSelectionRecords(records,{x:0,y:0},2,3);`);
  assert.equal(r("records[0].original===records[1].original"), true);
  assert.equal(r("groupNeedsUniformScale(selection.items)"), false);
  near(r("pinWorldPos(c,c.pins[0]).x"), r("p0.x*2"));
  near(r("pinWorldPos(c,c.pins[1]).y"), r("p1.y*3"));
  near(r("c.pins[0].w"), 12);
  near(r("c.pins[0].h"), 4);
  assert.equal(r("c.pins[2].x"), 30);
  assert.equal(r("c.x"), 10);
  assert.equal(r("c.rot"), 90);
  const factors = r("groupResizeFactors({x:20,y:10},{x:0,y:0},{x:40,y:30},true)");
  assert.equal(factors.sx, factors.sy);
});
for (const [rows, columns] of [
  [1, 8],
  [24, 2],
  [4, 4],
])
  for (const numbering of ["row", "column", "serpentine", ...(columns === 2 ? ["dip"] : [])])
    test(`${columns} columns × ${rows} rows: ${numbering} numbering and local spacing`, () => {
      const r = editor();
      r(`const c=component(100,200,37),before=snapshot(),s={...settings,rows:${rows},columns:${columns},numbering:'${numbering}'};
        const pins=generatePadArray(c,s,{x:-10,y:-20},{x:50,y:210});`);
      const pins = JSON.parse(r("JSON.stringify(pins)"));
      assert.equal(pins.length, rows * columns);
      assert.equal(new Set(pins.map((p) => p.num)).size, rows * columns);
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < columns; x++) {
          const p = pins[y * columns + x];
          const serial =
            numbering === "column"
              ? x * rows + y
              : numbering === "dip"
                ? x
                  ? 2 * rows - y - 1
                  : y
                : y * columns + (numbering === "serpentine" && y % 2 ? columns - x - 1 : x);
          assert.equal(Number(p.num), serial + 1);
          near(p.x, -10 + (x * 60) / Math.max(1, columns - 1));
          near(p.y, -20 + (y * 230) / Math.max(1, rows - 1));
          assert.equal(p.barrel, undefined);
        }
      assert.equal(r("snapshot()"), r("before"));
    });
test("2×24 DIP through array creates 48 logical pins and barrels without duplicated vias", () => {
  const r = editor();
  r(
    `const c=component(),before=snapshot();const pins=generatePadArray(c,{...settings,physicalType:'through'}, {x:-50,y:-115},{x:50,y:115});`,
  );
  assert.deepEqual(
    JSON.parse(r("JSON.stringify(pins.filter((p,i)=>i%2===0).map(p=>Number(p.num)))")),
    Array.from({ length: 24 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    JSON.parse(r("JSON.stringify(pins.filter((p,i)=>i%2===1).map(p=>Number(p.num)))")),
    Array.from({ length: 24 }, (_, i) => 48 - i),
  );
  assert.equal(r("pins.filter(p=>p.barrel).length"), 48);
  assert.equal(r("snapshot()"), r("before"));
  r("editDocument(()=>c.pins.push(...pins));rebuildConnectivity()");
  assert.equal(r("conductors().filter(o=>o.type==='pad').length"), 48);
  assert.equal(r("State.vias.length"), 0);
  assert.equal(r("validateDocument(documentPayload()).components[0].pins.length"), 48);
  assert.equal(r("buildElectricalExportModel().components[0].pins.length"), 48);
  r("undo()");
  assert.equal(r("snapshot()"), r("before"));
});
test("array rejects conflicts, invalid bounds, limits and invalid barrels without mutation", () => {
  const r = editor();
  r(`const c=component(),before=snapshot();`);
  for (const bad of [
    "{rows:0}",
    "{columns:1}",
    "{rows:2001}",
    "{increment:0}",
    "{physicalType:'through',fromLayerId:6}",
    "{physicalType:'through',hole:6}",
    "{physicalType:'through',diameter:0}",
  ])
    assert.throws(() => r(`generatePadArray(c,{...settings,...${bad}},{x:0,y:0},{x:10,y:100})`));
  assert.throws(() => r("generatePadArray(c,settings,{x:0,y:0},{x:0,y:100})"), /Drag/);
  assert.equal(r("snapshot()"), r("before"));
  r("c.pins=[pad()]");
  assert.throws(() => r("generatePadArray(c,settings,{x:0,y:0},{x:10,y:100})"), /already exists/);
  assert.equal(r("c.pins.length"), 1);
});
test("through-pin joins touching inner copper, pads, vias and other pins, excluding distant copper", () => {
  const r = editor();
  r(`const c=component();c.pins=[{...pad(),w:20,barrel:{fromLayerId:1,toLayerId:6,diameter:4,hole:1}}];
    const a=trace(3,[{x:0,y:0},{x:0,y:10}]),b=trace(5,[{x:0,y:0},{x:0,y:-10}]),distant=trace(2,[{x:30,y:30},{x:40,y:30}]),outsideContact=trace(4,[{x:8,y:0},{x:8,y:4}]);State.traces=[a,b,distant,outsideContact];
    const other=component(1,0);other.layerId=3;other.pins=[pad()];
    const through=component(-2,0);through.layerId=2;through.pins=[{...pad(),barrel:{fromLayerId:4,toLayerId:6,diameter:2,hole:0}}];
    const v={id:nextId(),x:0,y:0,r:1,hole:0,fromLayerId:2,toLayerId:4};State.vias=[v];rebuildConnectivity();
    const net=Connectivity.byKey.get(pinKey(c,c.pins[0]));`);
  for (const key of [
    "'t'+a.id",
    "'t'+b.id",
    "'v'+v.id",
    "pinKey(other,other.pins[0])",
    "pinKey(through,through.pins[0])",
  ])
    assert.equal(r(`Connectivity.byKey.get(${key})===net`), true);
  for (const key of ["'t'+distant.id", "'t'+outsideContact.id"])
    assert.equal(r(`Connectivity.byKey.get(${key})===net`), false);
  assert.equal(r("net.members.filter(m=>m.key===pinKey(c,c.pins[0])).length"), 1);
  r("View.activeLayerId=4");
  assert.equal(r("padVisible(c,c.pins[0])"), true);
  assert.equal(r("hitTest({x:0,y:0}).type"), "via");
  r("View.vias=false");
  assert.equal(r("hitTest({x:0,y:0}).type"), "pad");
  assert.equal(r("snapPoint({x:0,y:0}).x"), 0);
});
test("a drilled appearance without a barrel never connects to other layers", () => {
  const r = editor();
  r(
    `const c=component();c.pins=[{...pad(),shape:'circle',w:4,h:4,tht:true,hole:2}];State.traces=[trace(3,[{x:0,y:0},{x:10,y:0}])];rebuildConnectivity();`,
  );
  assert.equal(r("Connectivity.nets.length"), 2);
  assert.equal(r("validateDocument(documentPayload()).components[0].pins[0].barrel"), undefined);
  r("View.activeLayerId=3");
  assert.equal(!!r("padVisible(c,c.pins[0])"), false);
});
test("layer reorder counts connector spans, can cancel and preserves pin identity", () => {
  const r = editor();
  r(`const c=component();c.pins=generatePadArray(c,{...settings,physicalType:'through',toLayerId:4},{x:0,y:0},{x:10,y:230});const before=snapshot(),keys=c.pins.map(p=>pinKey(c,p));let counts;
    const ids=[1,5,2,3,4,6];reorderLayers(ids,(vias,pins)=>{counts=[vias,pins];return false;});`);
  assert.deepEqual(Array.from(r("counts")), [0, 48]);
  assert.equal(r("snapshot()"), r("before"));
  r("reorderLayers(ids,()=>true)");
  assert.equal(r("viaLayerIds(c.pins[0].barrel).includes(5)"), true);
  assert.equal(r("JSON.stringify(c.pins.map(p=>pinKey(c,p)))===JSON.stringify(keys)"), true);
  r("undo()");
  assert.equal(r("snapshot()"), r("before"));
});
test("deleting endpoint layers shortens surviving pin spans, collapses to ordinary pads and undoes", () => {
  const r = editor();
  r(
    `const c=component();c.layerId=3;c.pins=[pad(),{...pad(20,0),num:'2'}];c.pins[0].barrel={fromLayerId:1,toLayerId:6,diameter:4,hole:1};c.pins[1].barrel={fromLayerId:1,toLayerId:2,diameter:4,hole:1};const before=snapshot();deletePhysicalLayer(1);`,
  );
  assert.equal(r("c.pins.length"), 2);
  assert.equal(r("c.pins[0].barrel.fromLayerId"), 2);
  assert.equal(r("c.pins[0].barrel.toLayerId"), 6);
  assert.equal(r("c.pins[1].barrel"), undefined);
  assert.equal(r("validateDocument(documentPayload()).components[0].pins.length"), 2);
  r("undo()");
  assert.equal(r("snapshot()"), r("before"));
});
test("v3 validates optional pin barrels strictly and round-trips existing projects", () => {
  for (const bad of [
    "{fromLayerId:9}",
    "{toLayerId:1}",
    "{diameter:0}",
    "{hole:-1}",
    "{hole:4}",
    "{hole:5}",
    "{extra:1}",
  ]) {
    const r = editor();
    r(
      `const c=component();c.pins=[{...pad(),barrel:{fromLayerId:1,toLayerId:6,diameter:4,hole:1,...${bad}}}];`,
    );
    assert.throws(() => r("validateDocument(documentPayload())"), /Invalid project/);
  }
  const r = editor();
  r(
    `const c=component();c.pins=generatePadArray(c,{...settings,physicalType:'through'},{x:0,y:0},{x:10,y:230});const text=serializeProject();State=validateDocument(JSON.parse(text));`,
  );
  assert.equal(r("serializeProject()"), r("text"));
});
