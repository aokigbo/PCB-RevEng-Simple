const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
class Directory {
  constructor(name = "root") {
    this.name = name;
    this.kind = "directory";
    this.children = new Map();
    this.reads = [];
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.children.has(name)) {
      if (!create) throw Object.assign(Error("missing directory"), { name: "NotFoundError" });
      this.children.set(name, new Directory(name));
    }
    return this.children.get(name);
  }
  async getFileHandle(name, { create = false } = {}) {
    this.reads.push(name);
    if (!this.children.has(name)) {
      if (!create) throw Object.assign(Error("missing file"), { name: "NotFoundError" });
      this.children.set(name, new FileHandle(name));
    }
    return this.children.get(name);
  }
  async *values() {
    yield* this.children.values();
  }
  async *entries() {
    yield* this.children.entries();
  }
  async removeEntry(name) {
    this.children.delete(name);
  }
}
class FileHandle {
  constructor(name) {
    this.name = name;
    this.kind = "file";
    this.blob = new Blob([]);
    this.modified = 1;
    this.writes = 0;
  }
  async getFile() {
    const b = this.blob;
    b.lastModified = this.modified;
    return b;
  }
  async createWritable() {
    let parts = [];
    return {
      write: async (data) => {
        parts.push(data);
        this.writes++;
      },
      close: async () => {
        this.blob = new Blob(parts);
        this.modified++;
      },
      abort: async () => {
        parts = [];
      },
    };
  }
}
function harness(root = new Directory()) {
  const messages = [],
    c = vm.createContext({
      structuredClone,
      AbortController,
      DOMException,
      Blob,
      atob,
      crypto: webcrypto,
      window: { showDirectoryPicker: async () => root },
      Editor: { fieldDirty: false, trace: [] },
      Tiles: { clear() {} },
      refreshSaveState() {},
      resetWorkspace() {},
      showImportProgress() {},
      confirm: () => true,
      notify: (s) => messages.push(s),
    });
  for (const f of [
    "image-pyramid",
    "catalog",
    "document",
    "geometry",
    "connectivity",
    "registration",
    "attachments",
    "files",
  ])
    vm.runInContext(fs.readFileSync("js/" + f + ".js", "utf8"), c, { filename: f });
  vm.runInContext("function change(fn){return editDocument(fn)}", c);
  return { run: (s) => vm.runInContext(s, c), root, c, messages };
}
test("New creates portable folder and Save rewrites only project metadata", async () => {
  const h = harness();
  await h.run("newProject()");
  assert.deepEqual([...h.root.children.keys()].sort(), ["datasheets", "images", "project.json"]);
  const images = await h.root.getDirectoryHandle("images"),
    scan = await images.getDirectoryHandle("scan-9", { create: true }),
    tile = await scan.getFileHandle("tile.png", { create: true });
  await h.run("editDocument(()=>State.name='Revised');saveProject()");
  assert.equal(tile.writes, 0);
  assert.equal(h.run("isDirty()"), false);
  const d = JSON.parse(await (await (await h.root.getFileHandle("project.json")).getFile()).text());
  assert.equal(d.name, "Revised");
  assert.equal(d.version, 3);
});
test("Open rejects invalid metadata transactionally and retains original directory/checkpoint", async () => {
  const h = harness();
  await h.run("newProject()");
  h.run("State.name='Existing';ProjectFile.saved=snapshot()");
  const before = h.run("snapshot()"),
    file = await h.root.getFileHandle("project.json");
  file.blob = new Blob(["{broken"]);
  await h.run("openProject()");
  assert.equal(h.run("snapshot()"), before);
  assert.equal(h.run("ProjectFile.root"), h.root);
  assert.equal(h.run("isDirty()"), false);
});
test("missing manifest keeps engineering metadata inspectable and does not enumerate tiles", async () => {
  const h = harness();
  await h.run("newProject()");
  h.run(
    `State.scans.push({id:nextId(),layerId:1,name:'Missing scan',sourceName:'source.tif',width:20000,height:30000,tileSize:512,maxLogicalLevel:pyramidLevels(20000,30000).length-1,assetMode:"legacy-pyramid",flipX:false,flipY:false,aligned:false,transform:{tx:0,ty:0,scale:1,rotation:0}});`,
  );
  await h.run("saveProject();");
  await h.run("openProject()");
  assert.equal(h.run("State.scans.length"), 1);
  assert.match(h.messages.at(-1), /unavailable/);
  assert.ok(h.root.reads.every((p) => !p.endsWith(".png")));
});
test("Save refuses an externally changed metadata file", async () => {
  const h = harness();
  await h.run("newProject()");
  const file = await h.root.getFileHandle("project.json");
  file.modified++;
  h.run("State.name='Unsaved'");
  assert.equal(await h.run("saveProject()"), false);
  assert.equal(h.run("isDirty()"), true);
});
test("PDF files deduplicate by hash and survive replace/remove/undo without byte snapshots", async () => {
  const h = harness();
  await h.run("newProject()");
  h.run(
    "State.components.push(makeComponent('chip2',{},0,0));State.components.push(makeComponent('chip2',{},100,0));",
  );
  const a = new Blob(["%PDF-1.4\nA"], { type: "application/pdf" });
  a.name = "a.pdf";
  const b = new Blob(["%PDF-1.4\nB"], { type: "application/pdf" });
  b.name = "b.pdf";
  h.c.fileA = a;
  h.c.fileB = b;
  await h.run("attachDatasheet(State.components[0].id,fileA)");
  await h.run("attachDatasheet(State.components[1].id,fileA)");
  assert.equal(h.run("State.attachments.length"), 1);
  await h.run("attachDatasheet(State.components[0].id,fileB)");
  assert.equal(h.run("State.attachments.length"), 2);
  const dir = await h.root.getDirectoryHandle("datasheets");
  assert.equal(dir.children.size, 2);
  h.run("removeDatasheet(State.components[0]);undo()");
  assert.equal(h.run("State.attachments.length"), 2);
  assert.equal(h.run("snapshot().includes('base64')"), false);
  assert.equal(dir.children.size, 2);
});
test("asset cleanup retains undo/redo references and touches only app-owned names", async () => {
  const h = harness();
  await h.run("newProject()");
  const images = await h.root.getDirectoryHandle("images");
  await images.getDirectoryHandle("scan-20", { create: true });
  await images.getDirectoryHandle("scan-21", { create: true });
  await images.getFileHandle("my-notes.txt", { create: true });
  h.run("State.scans=[{id:20}];History.past.push(snapshot());State.scans=[];");
  await h.run("collectGarbage()");
  assert.equal(images.children.has("scan-20"), true);
  assert.equal(images.children.has("scan-21"), false);
  assert.equal(images.children.has("my-notes.txt"), true);
});
test("TIFF copying uses bounded slices, never whole-file ArrayBuffer", async () => {
  const h = harness();
  await h.run("newProject()");
  h.c.testFile = {
    size: 33 * 1024 * 1024,
    arrayBuffer() {
      throw Error("whole-file read");
    },
    slice(start, end) {
      const size = Math.min(end, this.size) - start;
      assert.ok(size <= 16 * 1024 * 1024);
      return { arrayBuffer: async () => new ArrayBuffer(size) };
    },
  };
  await h.run("copyImageSource(testFile,ProjectFile.root,new AbortController().signal,()=>{})");
  assert.equal((await (await h.root.getFileHandle("source.tif")).getFile()).size, 33 * 1024 * 1024);
  assert.equal((await h.root.getFileHandle("source.tif")).writes, 3);
});
test("copy cancellation aborts before subsequent chunks and leaves document unchanged", async () => {
  const h = harness();
  await h.run("newProject()");
  const before = h.run("snapshot()");
  h.c.testFile = new Blob([new Uint8Array(20 * 1024 * 1024)]);
  await assert.rejects(
    h.run(
      "const cancel=new AbortController();copyImageSource(testFile,ProjectFile.root,cancel.signal,()=>cancel.abort())",
    ),
    { name: "AbortError" },
  );
  assert.equal(h.run("snapshot()"), before);
  assert.equal((await (await h.root.getFileHandle("source.tif")).getFile()).size, 0);
});
test("v2 opening migrates only metadata and preserves legacy pyramid storage", async () => {
  const h = harness();
  await h.run("newProject()");
  const old = JSON.parse(h.run("serializeProject()"));
  old.version = 2;
  old.nextId = 5;
  old.scans = [
    {
      id: 4,
      layerId: 1,
      name: "Legacy",
      sourceName: "old.tif",
      width: 512,
      height: 512,
      tileSize: 512,
      levels: 1,
      flipX: false,
      flipY: false,
      aligned: true,
      transform: { tx: 0, ty: 0, scale: 1, rotation: 0 },
    },
  ];
  const scan = await (
    await h.root.getDirectoryHandle("images")
  ).getDirectoryHandle("scan-4", { create: true });
  (await scan.getFileHandle("manifest.json", { create: true })).blob = new Blob([
    JSON.stringify({
      complete: true,
      tileSize: 512,
      width: 512,
      height: 512,
      levels: [{ level: 0, width: 512, height: 512 }],
    }),
  ]);
  const tiles = await scan.getDirectoryHandle("L0", { create: true });
  tiles.entries = () => {
    throw Error("cache enumeration");
  };
  (await h.root.getFileHandle("project.json")).blob = new Blob([JSON.stringify(old)]);
  await h.run("openProject()");
  assert.equal(h.run("State.scans[0].assetMode"), "legacy-pyramid");
  assert.equal(h.run("State.scans[0].maxLogicalLevel"), 0);
  assert.equal(h.run("isDirty()"), true);
  await h.run("saveProject()");
  assert.equal(
    JSON.parse(await (await (await h.root.getFileHandle("project.json")).getFile()).text()).version,
    3,
  );
  assert.equal(scan.children.has("source.tif"), false);
});
test("failed source metadata inspection never writes a manifest or changes engineering state", async () => {
  const h = harness();
  await h.run("newProject()");
  const before = h.run("snapshot()");
  h.c.ImageEngine = {
    request: async () => {
      throw Error("invalid TIFF metadata");
    },
  };
  h.c.testFile = new Blob([new Uint8Array([73, 73, 42, 0, 0, 0, 0, 0])]);
  await assert.rejects(h.run("prepareScanAsset(testFile,99,()=>{})"), /invalid TIFF/);
  assert.equal(h.run("snapshot()"), before);
  assert.equal((await h.root.getDirectoryHandle("images")).children.has("scan-99"), false);
});
test("missing authoritative source preserves copper and Open never walks sparse cache", async () => {
  const h = harness();
  await h.run("newProject()");
  h.run(
    `State.nextId=12;State.traces=[{id:11,layerId:1,width:1,points:[{x:0,y:0},{x:1,y:1}]}];State.scans=[{id:10,layerId:1,name:'Sparse',sourceName:'large.tif',width:30000,height:20000,tileSize:512,maxLogicalLevel:6,assetMode:'tiff-source',flipX:false,flipY:false,aligned:true,transform:{tx:0,ty:0,scale:1,rotation:0}}];`,
  );
  const dir = await (
    await h.root.getDirectoryHandle("images")
  ).getDirectoryHandle("scan-10", { create: true });
  (await dir.getFileHandle("manifest.json", { create: true })).blob = new Blob([
    JSON.stringify({
      schema: "pcb-reveng-scan-v1",
      complete: true,
      source: "source.tif",
      sourceSize: 100,
      width: 30000,
      height: 20000,
      tileSize: 512,
      maxLogicalLevel: 6,
      cacheVersion: 1,
      sourceOverviews: [],
    }),
  ]);
  const cache = await dir.getDirectoryHandle("cache-v1", { create: true });
  for (let i = 0; i < 3000; i++) cache.children.set(i + ".png", null);
  cache.entries = () => {
    throw Error("must not walk cached tiles");
  };
  cache.values = cache.entries;
  await h.run("(async()=>{await saveProject();await openProject();})()");
  assert.equal(h.run("State.traces.length"), 1);
  assert.equal(h.run("State.scans.length"), 1);
  assert.match(h.messages.at(-1), /unavailable/);
});
