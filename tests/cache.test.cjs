const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function harness() {
  const c = vm.createContext({
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    ProjectFile: { epoch: 1 },
    requestRender() {},
  });
  vm.runInContext(fs.readFileSync("js/image-source.js", "utf8"), c);
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
test("visible work is center-first, fair across comparisons, and ahead of prefetch/warming", () => {
  const r = harness();
  const order = r(`prioritizeTileJobs([
    {key:'A-edge',scanId:1,priority:0,distance:20}, {key:'B-edge',scanId:2,priority:0,distance:30},
    {key:'A-center',scanId:1,priority:0,distance:1}, {key:'B-center',scanId:2,priority:0,distance:2},
    {key:'warm',scanId:1,priority:4}, {key:'ring',scanId:1,priority:2}, {key:'fallback',scanId:1,priority:1}
  ]).map(s=>s.key).join()`);
  assert.equal(order, "A-center,B-center,A-edge,B-edge,fallback,ring,warm");
});
test("blend endpoints request only contributing imagery", () => {
  const r = harness();
  assert.equal(r("imageContributions([{id:1},{id:2}],0).map(s=>s.scan.id).join()"), "1");
  assert.equal(r("imageContributions([{id:1},{id:2}],1).map(s=>s.scan.id).join()"), "2");
  assert.equal(r("imageContributions([{id:1},{id:2}],.5).length"), 2);
});
test("coarse fallback is available until native tile arrives; coarse retention is weighted", () => {
  const r = harness();
  r(
    `const scan={id:8,width:8192,height:8192,maxLogicalLevel:4};const spec=tileSpec(scan,0,5,6);const cache=new WeightedLRU(8,10);cache.set(tileSpec(scan,3,0,0).key,{width:512,height:512},4,1);cache.set('detail',{width:1,height:1},4);cache.set('new-detail',{width:1,height:1},4);`,
  );
  assert.equal(r("cache.entries.has('detail')"), false);
  assert.equal(r("parentTileFallback(cache,scan,spec).factor"), 8);
  assert.equal(r("parentTileFallback(cache,scan,spec).x"), 0);
});
test("viewport cancellation aborts obsolete reads and dispatches new visible work", async () => {
  const r = harness();
  r(
    `const starts=[],signals=[];const loader=new TileLoader((s,signal)=>{starts.push(s.key);signals.push(signal);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('cancel'),{name:'AbortError'}))));},()=>{},{concurrency:1});loader.view([{key:'old',priority:0},{key:'old-queued',priority:0}]);`,
  );
  await new Promise((resolve) => setImmediate(resolve));
  r(`loader.view([{key:'new',priority:0}]);`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r("signals[0].aborted"), true);
  assert.equal(r("starts.join()"), "old,new");
  r("loader.clear()");
});
test("decode concurrency shrinks for large TIFF blocks", () => {
  const r = harness();
  assert.equal(r("imageDecodeSlots(70*1024*1024,32,8)"), 1);
  assert.equal(r("imageDecodeSlots(40*1024*1024,32,8)"), 2);
  assert.equal(r("imageDecodeSlots(1024,32,8)"), 3);
  assert.equal(r("sourceOverviewLevel({width:30000,height:20000},15000,10000)"), 1);
  assert.equal(r("sourceOverviewLevel({width:30000,height:20000},15000,12000)"), null);
});
test("current viewport retries a source block aborted by an older overlapping request", async () => {
  const r = harness();
  r(
    `let calls=0;const loader=new TileLoader(async()=>{if(!calls++)throw Object.assign(Error('old block aborted'),{name:'AbortError'});return {width:1,height:1,close(){}};},()=>{});loader.view([{key:'current',priority:0}]);`,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r("calls"), 2);
  assert.equal(r("loader.cache.entries.has('current')"), true);
});
