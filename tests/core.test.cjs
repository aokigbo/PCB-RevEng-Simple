const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function core(extra = {}) {
  const c = vm.createContext({ structuredClone, ...extra });
  for (const f of ["catalog", "document", "geometry", "connectivity", "registration"])
    vm.runInContext(fs.readFileSync("js/" + f + ".js", "utf8"), c, { filename: f });
  return (s) => vm.runInContext(s, c);
}
const setup = `State=emptyDocument();
 const t=(id,side,points,width=1)=>({id,side,points,width});
 const p=(x,y)=>({x,y});`;
test("same-side crossings connect; opposite-side crossings require a via", () => {
  const run = core();
  run(setup);
  run(
    `State.traces=[t(1,'front',[p(-10,0),p(10,0)]),t(2,'back',[p(0,-10),p(0,10)])];rebuildConnectivity()`,
  );
  assert.equal(run("Connectivity.nets.length"), 2);
  run(`State.vias=[{id:3,x:0,y:0,r:2,hole:1}];rebuildConnectivity()`);
  assert.equal(run("Connectivity.nets.length"), 1);
  run(`State.vias=[];State.traces[1].side='front';rebuildConnectivity()`);
  assert.equal(run("Connectivity.nets.length"), 1);
});
test("deleting a bridge splits connectivity, and undo/redo restore it", () => {
  const run = core();
  run(setup);
  run(
    `State.traces=[t(1,'front',[p(-10,0),p(0,0)]),t(2,'front',[p(5,0),p(15,0)]),t(3,'front',[p(0,0),p(5,0)])];rebuildConnectivity()`,
  );
  assert.equal(run("Connectivity.nets.length"), 1);
  run(`editDocument(()=>State.traces.pop());rebuildConnectivity()`);
  assert.equal(run("Connectivity.nets.length"), 2);
  run("undo();rebuildConnectivity()");
  assert.equal(run("Connectivity.nets.length"), 1);
  run("redo();rebuildConnectivity()");
  assert.equal(run("Connectivity.nets.length"), 2);
});
test("round SMD pads stay on their side while plated pads connect both sides", () => {
  const run = core();
  run(setup);
  run(
    `State.components=[makeComponent('pad1',{tht:false,dia:1.5},0,0)];State.traces=[t(2,'back',[p(-10,0),p(10,0)])];rebuildConnectivity()`,
  );
  assert.equal(run("Connectivity.nets.length"), 2);
  run("State.components[0].pins[0].tht=true;rebuildConnectivity()");
  assert.equal(run("Connectivity.nets.length"), 1);
});
test("touching copper never conceals conflicting named nets", () => {
  const run = core();
  run(setup);
  run(
    `State.traces=[{...t(1,'front',[p(-10,0),p(0,0)]),netName:'GND'},{...t(2,'front',[p(0,0),p(10,0)]),netName:'+5V'}];rebuildConnectivity()`,
  );
  assert.equal(run("Connectivity.nets.length"), 1);
  assert.equal(run("Connectivity.issues.length"), 1);
  run(`editDocument(()=>nameNet('t1','GND'));rebuildConnectivity()`);
  assert.equal(run("Connectivity.issues.length"), 0);
  run("undo();rebuildConnectivity()");
  assert.equal(run("Connectivity.issues.length"), 1);
});
test("near parallel copper does not connect until actual extents touch", () => {
  const run = core();
  run(setup);
  run(
    `State.traces=[t(1,'front',[p(0,0),p(10,0)],2),t(2,'front',[p(0,2.1),p(10,2.1)],2)];rebuildConnectivity()`,
  );
  assert.equal(run("Connectivity.nets.length"), 2);
  run("State.traces[1].points.forEach(p=>p.y=2);rebuildConnectivity()");
  assert.equal(run("Connectivity.nets.length"), 1);
});
test("rectangular pad contact includes rounded trace caps", () => {
  const run = core();
  run(setup);
  run(`const c={x:0,y:0,rot:0,scale:1,side:'front'};const pad={xmm:0,ymm:0,w:1,h:1,shape:'rect'};`);
  assert.equal(run("padHitsSeg(c,pad,p(6,0),p(20,0),1.1)"), true);
  assert.equal(run("padHitsSeg(c,pad,p(6.2,0),p(20,0),1.1)"), false);
});
test("similarity alignment maps mirrored photo points exactly", () => {
  const run = core();
  run(
    `const layer={tx:0,ty:0,rot:0,scale:1,mirror:true};const src=[{x:10,y:20},{x:100,y:70}],dst=[{x:40,y:50},{x:-30,y:120}];alignImage(layer,src,dst);`,
  );
  assert.ok(
    run(
      "src.every((p,i)=>{const q=imageToWorld(layer,p);return Math.hypot(q.x-dst[i].x,q.y-dst[i].y)<1e-8})",
    ),
  );
  assert.throws(() => run("alignImage(layer,[src[0],src[0]],dst)"), /distinct/);
});
test("project round trip and history preserve explicit custom pads and net labels", () => {
  const run = core();
  run(setup);
  run(
    `State.components=[makeComponent('chip2',{size:'0805'},0,0)];State.components[0].pins[0].netName='GND';const json=serializeProject();const restored=validateDocument(JSON.parse(json));`,
  );
  assert.equal(run("JSON.stringify(restored)"), run("snapshot()"));
  assert.throws(() => run(`validateDocument({...JSON.parse(json),version:999})`), /version/);
  assert.throws(() => run(`validateDocument({...JSON.parse(json),pxPerMm:0})`), /scale/);
  assert.throws(
    () => run(`const bad=JSON.parse(json);bad.components[0].pins[0].w=-1;validateDocument(bad)`),
    /pad width/,
  );
});
test("legacy conversion refuses unsupported data without changing State", () => {
  const run = core();
  run(setup);
  const before = run("snapshot()");
  assert.throws(
    () => run(`migrateLegacy({app:'pcb-reveng',version:2,boards:[{},{}]})`),
    /multiple boards/,
  );
  assert.throws(
    () => run(`migrateLegacy({app:'pcb-reveng',version:1,schWires:[{}]})`),
    /schematic/,
  );
  assert.equal(run("snapshot()"), before);
});
test("failed edits roll back and do not create undo entries", () => {
  const run = core();
  const before = run("snapshot()");
  assert.throws(() => run(`editDocument(()=>{State.name='Oops';throw Error('failed')})`));
  assert.equal(run("snapshot()"), before);
  assert.equal(run("History.past.length"), 0);
});
test("automatic net names cannot collide with an explicit name", () => {
  const run = core();
  run(setup);
  run(
    `State.traces=[t(1,'front',[p(-10,0),p(0,0)]),{...t(2,'front',[p(30,0),p(40,0)]),netName:'NET_t1'}];rebuildConnectivity()`,
  );
  assert.equal(run("new Set(Connectivity.nets.map(n=>n.name)).size"), 2);
  assert.equal(run("Connectivity.issues.length"), 0);
});
test("opposite-side rectangular pads do not connect; plated pads do", () => {
  const run = core();
  run(setup);
  run(
    `State.components=[makeComponent('chip2',{},0,0),makeComponent('chip2',{},0,0)];State.components[1].side='back';rebuildConnectivity()`,
  );
  assert.equal(run("Connectivity.nets.length"), 4);
  run(`State.components[0].pins.forEach(p=>{p.shape='circle';p.tht=true;});rebuildConnectivity()`);
  assert.equal(run("Connectivity.nets.length"), 2);
});
test("all offered packages materialize valid pad geometry", () => {
  const run = core();
  assert.equal(
    run(`Footprints.catalog.every(def=>{
    State=emptyDocument();State.components.push(makeComponent(def.id,{},0,0));
    validateDocument(documentPayload());return true;
  })`),
    true,
  );
});
test("KiCad export contains exactly the reconstructed component pins, with escaped values", () => {
  const run = core();
  run(fs.readFileSync("js/export.js", "utf8"));
  run(setup);
  run(`State.components=[makeComponent('chip2',{},0,0),makeComponent('chip2',{},50,0)];
    State.components[0].value='10k "precision"';
    const a=pinWorldPos(State.components[0],State.components[0].pins[1]),b=pinWorldPos(State.components[1],State.components[1].pins[0]);
    State.traces=[{id:3,side:'front',points:[a,b],width:1,netName:'GND'}];rebuildConnectivity();`);
  const text = run("exportKiCad()");
  assert.match(text, /\(name GND\)/);
  assert.equal((text.match(/\(node /g) || []).length, 4);
  assert.ok(text.includes('\\"precision\\"'));
  // Independent minimal S-expression reader checks balanced/escaped structure.
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/g);
  let depth = 0;
  for (const token of tokens) {
    if (token === "(") depth++;
    if (token === ")") depth--;
    assert.ok(depth >= 0);
  }
  assert.equal(depth, 0);
  assert.equal(
    run("_toCSV(" + JSON.stringify([["a,b", 'x"y', "a\rb"]]) + ")"),
    '"a,b","x""y","a\rb"',
  );
});
