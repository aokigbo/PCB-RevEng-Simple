const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function core(extra = {}) {
  const c = vm.createContext({ structuredClone, ...extra });
  for (const f of [
    "image-pyramid",
    "catalog",
    "document",
    "legacy-import",
    "geometry",
    "connectivity",
    "registration",
    "export",
  ])
    vm.runInContext(fs.readFileSync("js/" + f + ".js", "utf8"), c, { filename: f });
  return (s) => vm.runInContext(s, c);
}
const setup = `State.physicalLayers=Array.from({length:6},(_,i)=>({id:i+1,description:''}));State.nextId=7;idFloor=7;
const trace=(layerId,y=0)=>({id:nextId(),layerId,width:1,points:[{x:-10,y},{x:10,y}]});`;
test("arbitrary stable layers validate and calibration never changes geometry", () => {
  const r = core();
  r(
    `State.physicalLayers=Array.from({length:80},(_,i)=>({id:i+1,description:''}));State.nextId=81;State.components.push(makeComponent('chip2',{},1,2,'R',78));const before=JSON.stringify(State.components);State.calibration={boardUnitsPerMm:95};`,
  );
  assert.equal(r("JSON.stringify(State.components)"), r("before"));
  assert.equal(r("validateDocument(documentPayload()).physicalLayers.length"), 80);
  assert.equal(r("State.components[0].layerId"), 78);
});
test("preview does not allocate IDs or dirty the project", () => {
  const r = core();
  r(`const before=snapshot();makeComponent('chip2',{},0,0,'R',1,true)`);
  assert.equal(r("snapshot()"), r("before"));
});
test("different layers never collide without an explicit via", () => {
  const r = core();
  r(setup + `State.traces=[trace(2),trace(3)];rebuildConnectivity()`);
  assert.equal(r("Connectivity.nets.length"), 2);
  r("State.traces[1].layerId=2;rebuildConnectivity()");
  assert.equal(r("Connectivity.nets.length"), 1);
});
test("one via joins its endpoint and intermediate layers, excludes outside layers", () => {
  const r = core();
  r(
    setup +
      `State.traces=[trace(2),trace(3),trace(5),trace(6)];State.vias=[{id:nextId(),x:0,y:0,r:2,hole:1,fromLayerId:2,toLayerId:5}];rebuildConnectivity()`,
  );
  assert.equal(r("Connectivity.nets.length"), 2);
  assert.equal(
    r(
      'Connectivity.byKey.get("t"+State.traces[0].id)===Connectivity.byKey.get("t"+State.traces[2].id)',
    ),
    true,
  );
  assert.equal(r("Connectivity.nets[0].members.length"), 4);
});
test("visible drilled pads remain on their layer until an explicit via is added", () => {
  const r = core();
  r(
    setup +
      `State.components.push(makeComponent('pad1',{tht:true,dia:2,hole:1},0,0,'TP',1));State.traces=[trace(2)];rebuildConnectivity()`,
  );
  assert.equal(r("Connectivity.nets.length"), 2);
  r(
    "State.vias.push({id:nextId(),x:0,y:0,r:10,hole:5,fromLayerId:1,toLayerId:2});rebuildConnectivity()",
  );
  assert.equal(r("Connectivity.nets.length"), 1);
});
test("via-via overlap only connects overlapping spans", () => {
  const r = core();
  r(
    setup +
      `State.vias=[{id:nextId(),x:0,y:0,r:2,hole:1,fromLayerId:1,toLayerId:2},{id:nextId(),x:0,y:0,r:2,hole:1,fromLayerId:3,toLayerId:5}];rebuildConnectivity()`,
  );
  assert.equal(r("Connectivity.nets.length"), 2);
  r("State.vias[1].fromLayerId=2;rebuildConnectivity()");
  assert.equal(r("Connectivity.nets.length"), 1);
});
test("layer reorder asks before changing intermediate via membership and preserves all IDs", () => {
  const r = core();
  r(
    setup +
      `State.components.push(makeComponent('chip2',{},0,0,'R',3));State.vias.push({id:nextId(),x:0,y:0,r:2,hole:1,fromLayerId:2,toLayerId:5});let asked=0;const original=snapshot();reorderLayers([1,2,6,3,4,5],n=>{asked=n;return false;});`,
  );
  assert.equal(r("asked"), 1);
  assert.equal(r("snapshot()"), r("original"));
  r("reorderLayers([1,2,6,3,4,5],()=>true)");
  assert.equal(r("State.components[0].layerId"), 3);
  assert.equal(r("layerName(6)"), "L3");
  assert.equal(r("viaLayerIds(State.vias[0]).includes(6)"), true);
  r("undo()");
  assert.equal(r("snapshot()"), r("original"));
});
test("layer deletion cleans local engineering data and adjusts/collapses via spans", () => {
  const r = core();
  r(
    setup +
      `State.components.push(makeComponent('chip2',{},0,0,'R',2));State.traces=[trace(2),trace(3)];State.scans=[{id:nextId(),layerId:2}];State.vias=[{id:nextId(),fromLayerId:2,toLayerId:5},{id:nextId(),fromLayerId:1,toLayerId:2}];deletePhysicalLayer(2);`,
  );
  assert.equal(r("State.components.length"), 0);
  assert.equal(r("State.scans.length"), 0);
  assert.equal(r("State.traces[0].layerId"), 3);
  assert.equal(r("State.vias.length"), 1);
  assert.equal(r("State.vias[0].fromLayerId"), 3);
  r("undo()");
  assert.equal(r("State.components.length"), 1);
});
test("copper conflict warnings survive AI derivation and disconnected names do not join", () => {
  const r = core();
  r(
    setup +
      `State.traces=[{...trace(1),netName:'GND'},{...trace(2),netName:'GND'}];const model=buildElectricalExportModel();`,
  );
  assert.equal(r("model.nets.length"), 2);
  assert.equal(r("model.warnings.length"), 1);
  assert.match(r("buildContextMarkdown(model)"), /Disconnected copper/);
  assert.equal(JSON.parse(r("buildGraphJSON(model)")).schema, "pcb-reveng-ai-graph-v2");
});
test("AI graph includes physical layer and omits scan/geometry data; BOM uses Layer", () => {
  const r = core();
  r(
    `State.components.push(makeComponent('chip2',{},100,200,'R',2));const model=buildElectricalExportModel();`,
  );
  const g = JSON.parse(r("buildGraphJSON(model)"));
  assert.equal(g.components[0].layer, "L2");
  assert.equal(g.layers[1].id, 2);
  assert.equal("x" in g.components[0], false);
  assert.equal("scans" in g, false);
  assert.match(r("exportBOM()"), /^Reference,Value,Footprint,Layer/);
});
test("all offered catalog packages produce valid board-unit geometry", () => {
  const r = core();
  r(
    `for(const fp of Footprints.catalog){State.components.push(makeComponent(fp.id,{},0,0));}validateDocument(documentPayload());`,
  );
});
test("v2 rejects binary payloads, missing layers, duplicate IDs and invalid spans", () => {
  for (const bad of [
    `State.components[0].dataURL='data:x';`,
    `State.components[0].layerId=999;`,
    `State.components[0].id=1;`,
    `State.vias.push({id:nextId(),x:0,y:0,r:2,hole:1,fromLayerId:1,toLayerId:1});`,
  ]) {
    const r = core();
    r(`State.components.push(makeComponent('chip2',{},0,0));` + bad);
    assert.throws(() => r("validateDocument(documentPayload())"), /Invalid project/);
  }
});
test("3–5 point least squares fit recovers positive similarity with explicit flips", () => {
  for (const flipX of [false, true])
    for (const flipY of [false, true]) {
      const r = core();
      r(
        `const scan={flipX:${flipX},flipY:${flipY},transform:{tx:0,ty:0,scale:1,rotation:0}};const expected={...scan,transform:{tx:152,ty:-49,scale:1.7,rotation:38}};const source=[{x:0,y:0},{x:200,y:0},{x:0,y:300},{x:200,y:300},{x:75,y:130}],target=source.map(p=>imageToWorld(expected,p));const fit=fitSimilarity(scan,source,target);`,
      );
      assert.ok(r("fit.rms") < 1e-9);
      assert.ok(Math.abs(r("fit.transform.scale") - 1.7) < 1e-9);
      assert.equal(r("scan.transform.scale"), 1);
    }
});
test("flips preserve approximate center and only change the chosen scan", () => {
  const r = core();
  r(
    `const scan={width:100,height:80,flipX:false,flipY:false,aligned:true,transform:{tx:5,ty:8,scale:2,rotation:32}},before=imageToWorld(scan,{x:50,y:40});flipScan(scan,'flipY');const after=imageToWorld(scan,{x:50,y:40});`,
  );
  assert.ok(r("Math.hypot(before.x-after.x,before.y-after.y)") < 1e-9);
  assert.equal(r("scan.aligned"), false);
});
test("component geometry on internal layers has no automatic mirror", () => {
  const r = core();
  r(
    `State.components.push(makeComponent('chip2',{},0,0,'U',2));const c=State.components[0],p=c.pins[0],a=pinWorldPos(c,p);c.layerId=1;const b=pinWorldPos(c,p);`,
  );
  assert.equal(r("JSON.stringify(a)"), r("JSON.stringify(b)"));
});
test("corner resize fixes the opposite corner on rotated geometry and Shift keeps ratio", () => {
  const r = core();
  r(
    `const c={x:100,y:80,rot:37},anchor={x:-5,y:-3},p=localToWorld(c,15,8),result=resizeGeometry(c,p,anchor,{w:10,h:6},2,true);`,
  );
  assert.ok(Math.abs(r("result.w/result.h") - 10 / 6) < 1e-9);
  assert.ok(Math.abs(r("result.x-result.w/2") + 5) < 1e-9);
});
test("v1 import preserves mirrored pad positions and adds explicit plated barrels", () => {
  const r = core();
  r(
    `const old={app:'pcb-reveng-simple',version:1,name:'Old',pxPerMm:10,calibrated:false,nextId:8,layers:[],components:[{id:3,ref:'J1',value:'',footprint:'Custom',kicad:'unused',side:'back',x:100,y:50,rot:30,body:{w:4,h:3},pins:[{num:'1',name:'A',xmm:2,ymm:1,w:2,h:2,shape:'circle',tht:true,hole:.8,netName:'GND'}]}],traces:[{id:4,side:'front',width:2,points:[{x:0,y:0},{x:1,y:1}]}],vias:[{id:5,x:10,y:10,r:3,hole:1}]};const before=JSON.stringify(old);const converted=convertV1(old);State=validateDocument({app:'pcb-reveng-simple',version:2,...converted.document});const pos=pinWorldPos(State.components[0],State.components[0].pins[0]);`,
  );
  assert.equal(r("JSON.stringify(old)"), r("before"));
  assert.equal(r("State.calibration"), null);
  assert.equal(r("State.vias.length"), 2);
  assert.ok(
    Math.abs(r("pos.x") - (100 - 20 * Math.cos(Math.PI / 6) - 10 * Math.sin(Math.PI / 6))) < 1e-9,
  );
  assert.equal(r("State.components[0].body.w"), 40);
});
