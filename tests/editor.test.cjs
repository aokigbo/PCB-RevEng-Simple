const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function editor() {
  const c = vm.createContext({ structuredClone, notify() {} });
  for (const f of ["catalog", "document", "geometry", "connectivity", "canvas", "editor"])
    vm.runInContext(fs.readFileSync("js/" + f + ".js", "utf8"), c, { filename: f });
  const run = (s) => vm.runInContext(s, c);
  run(`afterEdit=()=>rebuildConnectivity();setTool=()=>{Editor.tool='select';Editor.selection=null;};
    const a=makeComponent('free',{w:10,h:6,pinList:[{num:1,x:-2,y:0,w:1,h:1,shape:'rect',tht:false},{num:2,x:2,y:0,w:1,h:1,shape:'rect',tht:false}]},0,0,'U');
    const b=structuredClone(a);b.id=nextId();b.ref='U2';b.x=150;
    State.components=[a,b];`);
  return run;
}
test("marquee uses full containment and parent selection supersedes child pads", () => {
  const run = editor();
  run("Editor.selection=marqueeSelection({x:10,y:-10},{x:30,y:10})");
  assert.equal(run("Editor.selection.type"), "pad");
  assert.equal(run("Editor.selection.index"), 1);
  run("Editor.selection=marqueeSelection({x:21,y:-10},{x:30,y:10})");
  assert.equal(run("Editor.selection"), null);
  run("Editor.selection=marqueeSelection({x:-60,y:-40},{x:60,y:40})");
  assert.equal(run("Editor.selection.type"), "component");
  run("Editor.selection=marqueeSelection({x:-60,y:-40},{x:210,y:40})");
  assert.equal(run("selectionItems().length"), 2);
  assert.equal(run("selectionResizeCorners().length"), 0);
  assert.equal(
    run(
      "selectionItems(canonicalSelection([{type:'pad',object:a,index:0},{type:'component',object:a},{type:'component',object:a}])).length",
    ),
    1,
  );
  run("View.components=false");
  assert.equal(run("marqueeSelection({x:-100,y:-100},{x:300,y:100})"), null);
});
test("moving rotated/back pads and components applies one deduplicated trace anchor per point", () => {
  const run = editor();
  run(`b.side='back';b.rot=37;
    const ap=pinWorldPos(a,a.pins[1]),bp=pinWorldPos(b,b.pins[0]);
    State.traces=[{id:nextId(),side:'front',width:1,points:[ap,{x:70,y:80}, {x:90,y:80}]},
      {id:nextId(),side:'back',width:1,points:[bp,{x:90,y:80}]}];
    Editor.selection=canonicalSelection([{type:'component',object:a},{type:'pad',object:b,index:0}]);
    const oldB=JSON.stringify(b),oldAP={...ap},oldBP={...bp};
    const anchors=anchorsFor(Editor.selection);
    const records=selectionItems().map(s=>({selection:s,original:structuredClone(s.object),padPosition:s.type==='pad'?pinWorldPos(s.object,s.object.pins[s.index]):null}));
    editDocument(()=>{moveSelectionRecords(records,30,-20);applyAnchors(anchors);});`);
  assert.equal(run("anchors.length"), 2);
  assert.equal(run("State.traces[0].points[0].x"), run("oldAP.x+30"));
  assert.equal(run("State.traces[0].points[1].x"), 70);
  assert.ok(run("Math.abs(State.traces[1].points[0].x-oldBP.x-30)<1e-9"));
  assert.ok(run("Math.abs(State.traces[1].points[0].y-oldBP.y+20)<1e-9"));
  assert.equal(run("b.x"), 150);
  assert.equal(run("JSON.stringify(b.pins[1])"), run("JSON.stringify(JSON.parse(oldB).pins[1])"));
  assert.equal(run("History.past.length"), 1);
  run("undo()");
  assert.equal(run("JSON.stringify(State.components[1])"), run("oldB"));
  run("redo()");
  assert.equal(run("State.components[0].x"), 30);
  run(
    "Editor.selection={type:'group',items:[{type:'component',object:a},{type:'pad',object:a,index:1}]}",
  );
  assert.equal(
    run("new Set(anchorsFor(Editor.selection).map(a=>a.point)).size"),
    run("anchorsFor(Editor.selection).length"),
  );
});
test("component copy has fresh IDs/references, preserves data and strips all net assignments", () => {
  const run = editor();
  run(`a.value='LM358';a.pins[0].name='Sensor Ground';a.pins[0].netName='GND';
    State.traces=[{id:nextId(),side:'front',width:1,points:[pinWorldPos(a,a.pins[0]),{x:0,y:50}],netName:'GND'}];
    Editor.selection={type:'component',object:a};const before=snapshot();copySelected();`);
  assert.equal(run("snapshot()"), run("before"));
  assert.equal(run("History.past.length"), 0);
  run("Editor.cursor={x:400,y:100};pasteClipboard();const pasted=State.components[2]");
  assert.notEqual(run("pasted.id"), run("a.id"));
  assert.equal(run("pasted.ref"), "U3");
  assert.equal(run("pasted.value"), "LM358");
  assert.equal(run("pasted.footprint"), run("a.footprint"));
  assert.equal(run("pasted.pins[0].name"), "Sensor Ground");
  assert.equal(run("pasted.pins[0].num"), "1");
  assert.equal(run("pasted.pins.some(p=>'netName' in p)"), false);
  assert.equal(run("State.traces.length"), 1);
  assert.equal(run("Connectivity.issues.length"), 0);
  assert.equal(run("History.past.length"), 1);
  assert.equal(run("pasted.x"), 400);
  assert.equal(run("pasted.y"), 100);
  run("undo()");
  assert.equal(run("snapshot()"), run("before"));
  run("redo()");
  assert.equal(run("State.components.length"), 3);
});
test("mixed paste retains spacing and gives copied pads new numbers on their original parent", () => {
  const run = editor();
  run(`b.rot=90;b.side='back';b.pins[0].name='Signal';b.pins[0].netName='BUS';
    Editor.selection=canonicalSelection([{type:'component',object:a},{type:'pad',object:b,index:0}]);
    const bp=pinWorldPos(b,b.pins[0]);copySelected();const offset={x:500-Editor.clipboard.origin.x,y:150-Editor.clipboard.origin.y};
    Editor.cursor={x:500,y:150};pasteClipboard();const pad=b.pins[2],pos=pinWorldPos(b,pad);`);
  assert.equal(run("State.components.length"), 3);
  assert.equal(run("pad.num"), "3");
  assert.equal(run("pad.name"), "Signal");
  assert.equal(run("pad.netName"), undefined);
  assert.equal(run("pad.w"), run("b.pins[0].w"));
  assert.equal(run("pad.h"), run("b.pins[0].h"));
  assert.ok(run("Math.hypot(pos.x-bp.x-offset.x,pos.y-bp.y-offset.y)<1e-9"));
  assert.equal(run("State.components[2].x"), run("offset.x"));
  assert.equal(run("selectionItems().length"), 2);
  assert.equal(run("History.past.length"), 1);
});
test("pad paste skips deleted parents and multi-delete removes the correct pad indices once", () => {
  const run = editor();
  run(
    "Editor.selection={type:'pad',object:b,index:0};copySelected();State.components.pop();const before=snapshot();pasteClipboard()",
  );
  assert.equal(run("snapshot()"), run("before"));
  assert.equal(run("History.past.length"), 0);
  run(
    "Editor.selection=canonicalSelection([{type:'pad',object:a,index:0},{type:'pad',object:a,index:1}]);deleteSelected()",
  );
  assert.equal(run("a.pins.length"), 0);
  assert.equal(run("History.past.length"), 1);
  run("undo()");
  assert.equal(run("State.components[0].pins.length"), 2);
});

test("pin display labels combine the trimmed name and number, without an empty separator", () => {
  const run = editor();
  assert.equal(run("pinDisplayLabel({name:' GND ',num:'12'})"), "GND | 12");
  assert.equal(run("pinDisplayLabel({name:'',num:'12'})"), "12");
  assert.equal(run("pinDisplayLabel({name:'   ',num:'3'})"), "3");
  assert.equal(run("pinDisplayLabel({num:'7'})"), "7");
});
test("body offsets default on load, round-trip and scale with legacy physical geometry", () => {
  const run = editor();
  run(
    "const raw=documentPayload();delete raw.components[0].body.xmm;delete raw.components[0].body.ymm;const loaded=validateDocument(raw)",
  );
  assert.equal(run("loaded.components[0].body.xmm"), 0);
  assert.equal(run("loaded.components[0].body.ymm"), 0);
  run(
    "raw.components[0].scale=2;raw.components[0].body.xmm=3;raw.components[0].body.ymm=-4;State=validateDocument(raw)",
  );
  assert.equal(run("State.components[0].body.xmm"), 6);
  assert.equal(run("State.components[0].body.ymm"), -8);
  assert.equal(run("JSON.stringify(validateDocument(documentPayload()))"), run("snapshot()"));
  assert.throws(() => run("raw.components[0].body.xmm=null;validateDocument(raw)"), /body offset/);
});
