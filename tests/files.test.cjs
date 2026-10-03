const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function harness(window = {}) {
  const messages = [];
  const c = vm.createContext({
    structuredClone,
    window,
    confirm: () => true,
    refreshSaveState: () => {},
    resetWorkspace: () => {},
    notify: (m) => messages.push(m),
  });
  for (const f of ["document", "files"])
    vm.runInContext(fs.readFileSync("js/" + f + ".js", "utf8"), c);
  return { run: (s) => vm.runInContext(s, c), messages, c };
}
function handle({ fail = false, onWrite = () => {} } = {}) {
  let text = "",
    modified = 1,
    writes = 0;
  return {
    name: "Board.pcbrev",
    get writes() {
      return writes;
    },
    get text() {
      return text;
    },
    externalChange() {
      modified++;
    },
    async getFile() {
      return { lastModified: modified, size: text.length, text: async () => text };
    },
    async createWritable() {
      return {
        async write(s) {
          writes++;
          onWrite();
          if (fail) throw Error("disk full");
          text = s;
        },
        async close() {
          modified++;
        },
        async abort() {},
      };
    },
  };
}
test("Save As chooses once; subsequent Save updates the same handle", async () => {
  const file = handle();
  let picks = 0;
  const h = harness({
    showSaveFilePicker: async () => {
      picks++;
      return file;
    },
  });
  assert.equal(await h.run("saveProject()"), true);
  h.run(`State.name='Edited'`);
  assert.equal(await h.run("saveProject()"), true);
  assert.equal(picks, 1);
  assert.equal(file.writes, 2);
  assert.equal(h.run("isDirty()"), false);
  assert.equal(JSON.parse(file.text).name, "Edited");
});
test("write failure preserves unsaved state and original Save As destination", async () => {
  const file = handle({ fail: true }),
    h = harness({ showSaveFilePicker: async () => file });
  assert.equal(await h.run("saveProject()"), false);
  assert.equal(h.run("isDirty()"), true);
  assert.equal(h.run("ProjectFile.handle"), null);
  assert.match(h.messages[0], /disk full/);
});
test("canceling a picker changes neither saved checkpoint nor handle", async () => {
  const h = harness({
    showSaveFilePicker: async () => {
      throw Object.assign(Error("cancel"), { name: "AbortError" });
    },
  });
  assert.equal(await h.run("saveProject()"), false);
  assert.equal(h.run("ProjectFile.handle"), null);
  assert.equal(h.messages.length, 0);
});
test("edits made during write remain unsaved", async () => {
  let h;
  const file = handle({ onWrite: () => h.run(`State.name='Changed during write'`) });
  h = harness({ showSaveFilePicker: async () => file });
  assert.equal(await h.run("saveProject()"), true);
  assert.equal(h.run("isDirty()"), true);
  assert.equal(JSON.parse(file.text).name, "Untitled board");
});
test("Save refuses an externally modified file", async () => {
  const file = handle(),
    h = harness({ showSaveFilePicker: async () => file });
  await h.run("saveProject()");
  file.externalChange();
  h.run(`State.name='New edits'`);
  assert.equal(await h.run("saveProject()"), false);
  assert.equal(file.writes, 1);
  assert.equal(h.run("isDirty()"), true);
  assert.match(h.messages.at(-1), /changed on disk/);
});
test("invalid Open is transactional and leaves the original handle and history intact", async () => {
  const file = handle(),
    h = harness({
      showSaveFilePicker: async () => file,
      showOpenFilePicker: async () => [{ getFile: async () => ({ text: async () => "{broken" }) }],
    });
  await h.run("saveProject()");
  const before = h.run("snapshot()");
  await h.run("requestOpen()");
  assert.equal(h.run("snapshot()"), before);
  assert.equal(h.run("ProjectFile.handle"), file);
  assert.equal(h.run("isDirty()"), false);
});
