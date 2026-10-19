const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function harness() {
  const c = vm.createContext({ console, ProjectFile: { epoch: 1 }, requestRender() {} });
  vm.runInContext(fs.readFileSync("js/tile-cache.js", "utf8"), c);
  return (s) => vm.runInContext(s, c);
}
test("weighted LRU accounts memory, refreshes access and closes evicted bitmaps", () => {
  const r = harness();
  r(
    `let closed=[];const cache=new WeightedLRU(8,10);const resource=n=>({n,close(){closed.push(n)}});cache.set('a',resource('a'),4);cache.set('b',resource('b'),4);cache.get('a');cache.set('c',resource('c'),4);`,
  );
  assert.equal(r("cache.bytes"), 8);
  assert.equal(r("cache.entries.has('b')"), false);
  assert.equal(r("closed.join()"), "b");
  r("cache.set('huge',resource('huge'),12)");
  assert.equal(r("cache.bytes"), 8);
  assert.equal(r("closed.includes('huge')"), true);
  r("cache.clear()");
  assert.equal(r("cache.bytes"), 0);
});
test("tile loader bounds reads and discards stale results", async () => {
  const r = harness();
  r(
    `const waiting=[];let closed=0;const loader=new TileLoader(s=>new Promise(resolve=>waiting.push({s,resolve})),()=>{},{concurrency:2,target:1024,hard:2048});loader.view(Array.from({length:100},(_,i)=>({key:'old'+i})));`,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r("loader.active"), 2);
  r(
    `loader.view([{key:'new'}]);waiting[0].resolve({width:1,height:1,close(){closed++}});waiting[1].resolve({width:1,height:1,close(){closed++}});`,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r("closed"), 2);
  assert.equal(r("loader.cache.bytes"), 0);
  assert.equal(r("loader.active"), 1);
  r(`waiting[2].resolve({width:1,height:1,close(){closed++}})`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r("loader.cache.entries.has('new')"), true);
});
test("overview requests low-resolution tiles while native and enlarged views use L0", () => {
  const r = harness();
  r(
    `function pyramidLevels(w,h){const out=[];for(let level=0;;level++){out.push({level,width:w,height:h});if(w<=512&&h<=512)return out;w=Math.ceil(w/2);h=Math.ceil(h/2);}}function bounds(points){return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))};}const View={zoom:.01,width:1000,height:800};const screenToWorld=(x,y)=>({x:x/View.zoom,y:y/View.zoom}),worldToImage=(s,p)=>p;const scan={id:4,width:20000,height:30000,levels:7,transform:{scale:1}};`,
  );
  assert.equal(r("visibleTileSpecs(scan)[0].level"), 6);
  r("View.zoom=1");
  assert.equal(r("visibleTileSpecs(scan).every(s=>s.level===0)"), true);
  r("View.zoom=16");
  assert.equal(r("visibleTileSpecs(scan)[0].level"), 0);
});
