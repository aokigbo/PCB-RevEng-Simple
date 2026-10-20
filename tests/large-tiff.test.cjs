const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function harness() {
  const calls = [],
    messages = [];
  class Canvas {
    constructor(w, h) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return {
        putImageData: (image) => {
          this.pixels = image.data;
        },
      };
    }
  }
  const context = vm.createContext({
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    performance,
    navigator: { hardwareConcurrency: 4, deviceMemory: 8 },
    importScripts() {},
    GeoTIFF: { Pool: class {} },
    OffscreenCanvas: Canvas,
    ImageData: class {
      constructor(data, w, h) {
        this.data = data;
        this.width = w;
        this.height = h;
      }
    },
    self: { postMessage: (m) => messages.push(m) },
  });
  vm.runInContext(fs.readFileSync("js/image-source.js", "utf8"), context);
  vm.runInContext(
    fs.readFileSync(process.env.TILE_WORKER_TEST_SOURCE || "js/tile-worker.js", "utf8"),
    context,
  );
  const image = {
    getWidth: () => 20400,
    getHeight: () => 28080,
    async readRGB({ window: [x0, y0, x1, y1] }) {
      calls.push([x0, y0, x1, y1]);
      assert.ok(y1 - y0 <= 2, "reduced reads must not enqueue hundreds of one-row strips");
      assert.ok(x1 - x0 <= 65536, "source row allocation must stay bounded");
      const rgb = new Uint8Array((x1 - x0) * (y1 - y0) * 3);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = ((y - y0) * (x1 - x0) + x - x0) * 3;
          rgb[i] = x % 251;
          rgb[i + 1] = y % 253;
          rgb[i + 2] = (x + y) % 255;
        }
      return rgb;
    },
  };
  context.testImage = image;
  vm.runInContext("imageFor=async()=>testImage", context);
  return { calls, run: (s) => vm.runInContext(s, context) };
}
test("28,080 one-row strips: reduced display reads only the sampled row pairs", async () => {
  const h = harness();
  const canvas = await h.run(
    `pixels({manifest:{sourceOverviews:[]}}, {width:20400,height:28080,maxLogicalLevel:6}, {level:6,x:0,y:0},new AbortController().signal)`,
  );
  assert.equal(canvas.width, 319);
  assert.equal(canvas.height, 439);
  assert.equal(h.calls.length, 439);
  assert.ok(
    h.calls.reduce((n, [x0, y0, x1, y1]) => n + (x1 - x0) * (y1 - y0), 0) < 20400 * 439 * 2,
  );
  assert.deepEqual(
    Array.from(canvas.pixels.slice((319 + 1) * 4, (319 + 1) * 4 + 4)),
    [64, 64, 128, 255],
  );
});
test("decode permits wake only available jobs, preserving FIFO order", async () => {
  const h = harness();
  h.run("blockLimit=2");
  await h.run("acquireBlock()");
  await h.run("acquireBlock()");
  h.run(
    "const order=[];const waiting=Array.from({length:100},(_,i)=>acquireBlock().then(()=>order.push(i)));",
  );
  assert.equal(h.run("blockWaiters.length"), 100);
  h.run("releaseBlock()");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.run("blockWaiters.length"), 99);
  assert.equal(h.run("blockActive"), 2);
  assert.equal(h.run("order.join()"), "0");
  for (let i = 0; i < 100; i++) h.run("releaseBlock()");
  await h.run("Promise.all(waiting)");
  assert.equal(h.run("blockWaiters.length"), 0);
  h.run("releaseBlock()");
});
test("obsolete strip waiters abort immediately without occupying decoder permits", async () => {
  const h = harness();
  h.run("blockLimit=1");
  await h.run("acquireBlock()");
  h.run(
    `const stop=new AbortController();const pending=acquireBlock(stop.signal).catch(e=>e.name);stop.abort();`,
  );
  assert.equal(await h.run("pending"), "AbortError");
  assert.equal(h.run("blockWaiters.length"), 0);
  assert.equal(h.run("blockActive"), 1);
  h.run("releaseBlock()");
  assert.equal(h.run("blockActive"), 0);
});
