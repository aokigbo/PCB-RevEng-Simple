const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function editor() {
  const c = vm.createContext({
    structuredClone,
    ProjectFile: { root: {}, busy: false },
    notify() {},
    confirm: () => true,
  });
  for (const f of [
    "image-pyramid",
    "catalog",
    "document",
    "geometry",
    "connectivity",
    "registration",
    "canvas",
    "editor",
  ])
    vm.runInContext(fs.readFileSync("js/" + f + ".js", "utf8"), c, { filename: f });
  const run = (s) => vm.runInContext(s, c);
  run(
    `afterEdit=()=>rebuildConnectivity();setTool=()=>{Editor.tool='select';Editor.selection=null;};View.activeLayerId=1;const a=makeComponent('free',{w:10,h:6,pinList:[{num:1,x:-2,y:0,w:1,h:1,shape:'rect',tht:false},{num:2,x:2,y:0,w:1,h:1,shape:'rect',tht:false}]},0,0,'U',1);State.components.push(a);`,
  );
  return run;
}
test("marquee full containment and group normalization respect the active layer", () => {
  const r = editor();
  r(
    `const b=structuredClone(a);b.id=nextId();b.ref='U2';b.layerId=2;State.components.push(b);const selection=marqueeSelection({x:-60,y:-40},{x:60,y:40});`,
  );
  assert.equal(r("selection.object.id"), r("a.id"));
  r(
    `Editor.selection=canonicalSelection([{type:'component',object:a},{type:'pad',object:a,index:0}]);`,
  );
  assert.equal(r("selectionItems().length"), 1);
  assert.equal(r("pinDisplayLabel({name:' GND ',num:'4'})"), "GND | 4");
});
test("component copy keeps source layer and datasheet reference, gives fresh identity and no net assignments", () => {
  const r = editor();
  r(
    `a.layerId=2;a.value='Part';a.datasheetId=nextId();State.attachments=[{id:a.datasheetId}];a.pins[0].netName='GND';Editor.selection={type:'component',object:a};copySelected();Editor.cursor={x:100,y:100};pasteClipboard();const b=State.components[1];`,
  );
  assert.equal(r("b.layerId"), 2);
  assert.equal(r("b.datasheetId"), r("a.datasheetId"));
  assert.notEqual(r("b.id"), r("a.id"));
  assert.notEqual(r("b.ref"), r("a.ref"));
  assert.equal(r("'netName' in b.pins[0]"), false);
  assert.equal(r("History.past.length"), 1);
});
test("moving a pad stretches only exact endpoint anchors on its physical layer", () => {
  const r = editor();
  r(
    `const p=pinWorldPos(a,a.pins[0]);State.traces=[{id:nextId(),layerId:1,width:1,points:[{...p},{...p},{x:100,y:0}]},{id:nextId(),layerId:2,width:1,points:[{...p},{x:100,y:0}]}];const original=structuredClone(State.traces);const anchors=anchorsFor({type:'pad',object:a,index:0});a.pins[0].x+=10;applyAnchors(anchors);`,
  );
  assert.equal(r("State.traces[0].points[0].x"), r("original[0].points[0].x+10"));
  assert.equal(r("State.traces[0].points[1].x"), r("original[0].points[1].x"));
  assert.equal(r("State.traces[1].points[0].x"), r("original[1].points[0].x"));
});
test("one moved via anchors participating layers and keeps bends/outside-span traces fixed", () => {
  const r = editor();
  r(
    `State.physicalLayers.push({id:nextId(),description:'Inner'});const third=State.physicalLayers[2].id;const via={id:nextId(),x:0,y:0,r:2,hole:1,fromLayerId:1,toLayerId:2};State.vias=[via];State.traces=[1,2,third].map(layerId=>({id:nextId(),layerId,width:1,points:[{x:0,y:0},{x:50,y:0},{x:100,y:50}]}));const anchors=anchorsFor({type:'via',object:via});via.x=20;via.y=10;applyAnchors(anchors);`,
  );
  assert.equal(r("State.traces[0].points[0].x"), 20);
  assert.equal(r("State.traces[1].points[0].x"), 20);
  assert.equal(r("State.traces[2].points[0].x"), 0);
  assert.equal(r("State.traces[0].points[1].x"), 50);
  assert.equal(r("State.vias.length"), 1);
});
test("clipboard restores lightweight shared datasheet metadata after deleting the source", () => {
  const r = editor();
  r(
    `a.datasheetId=nextId();State.attachments=[{id:a.datasheetId,name:'part.pdf'}];Editor.selection={type:'component',object:a};copySelected();deleteSelected();Editor.cursor={x:100,y:100};pasteClipboard();`,
  );
  assert.equal(r("State.attachments.length"), 1);
  assert.equal(r("State.components[0].datasheetId"), r("State.attachments[0].id"));
});
