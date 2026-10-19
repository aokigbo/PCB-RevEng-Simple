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
  assert.equal(d.version, 2);
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
    `State.scans.push({id:nextId(),layerId:1,name:'Missing scan',sourceName:'source.tif',width:20000,height:30000,tileSize:512,levels:pyramidLevels(20000,30000).length,flipX:false,flipY:false,aligned:false,transform:{tx:0,ty:0,scale:1,rotation:0}});`,
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
