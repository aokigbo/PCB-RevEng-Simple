const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const fflate = require("../vendor/fflate-0.8.3.js");
function harness() {
  const c = vm.createContext({ structuredClone, atob, btoa, crypto: webcrypto, fflate });
  for (const file of ["catalog", "document", "geometry", "connectivity", "attachments", "export"])
    vm.runInContext(fs.readFileSync("js/" + file + ".js", "utf8"), c, { filename: file });
  return (code) => vm.runInContext(code, c);
}
test("v1 PDF serialization survives chunk boundaries and old KiCad values are discarded", async () => {
  const run = harness();
  run(`State.components.push(makeComponent('chip2',{},0,0));
    const bytes=new Uint8Array(100000);bytes.set([37,80,68,70,45]);
    const id=nextId();AttachmentAssets.set(id,bytes);
    State.components[0].datasheetId=id;
    State.attachments.push({id,name:'part.pdf',mime:'application/pdf',size:bytes.length,sha256:''});`);
  const digest = await run("sha256(AttachmentAssets.get(State.attachments[0].id))");
  run(`State.attachments[0].sha256=${JSON.stringify(digest)};`);
  assert.equal(run("pdfBytes(documentPayload().attachments[0].dataURL).length"), 100000);
  run(
    "const old=documentPayload();old.components[0].kicad='Library:Package';const restored=validateDocument(old)",
  );
  assert.equal(run("'kicad' in restored.components[0]"), false);
  assert.equal(run("restored.components[0].datasheetId"), 2);
  assert.equal(run("restored.attachments.length"), 1);
  assert.equal(run("old.version"), 1);
  assert.equal(
    run(
      "validateDocument({...old,components:old.components.map(({datasheetId,...c})=>c),attachments:undefined}).attachments.length",
    ),
    0,
  );
});
test("AI ZIP omits unreferenced PDFs, handles duplicate names and emits a two-file package without PDFs", () => {
  const run = harness();
  run(`const a=makeComponent('chip2',{},0,0);State.components.push(a);
    const b=makeComponent('chip2',{},100,0);State.components.push(b);
    const first=nextId(),second=nextId();
    State.attachments=[
      {id:first,name:'../part.pdf',mime:'application/pdf',size:6,sha256:'0'.repeat(64)},
      {id:second,name:'..\\\\part.pdf',mime:'application/pdf',size:6,sha256:'1'.repeat(64)}];
    AttachmentAssets.set(first,new Uint8Array([37,80,68,70,45,65]));
    AttachmentAssets.set(second,new Uint8Array([37,80,68,70,45,66]));
    a.datasheetId=first;b.datasheetId=second;`);
  const names = run("[...datasheetPaths().values()]");
  assert.deepEqual([...names], ["datasheets/__part.pdf", "datasheets/__part-2.pdf"]);
  assert.equal(run("JSON.stringify(buildElectricalExportModel()).includes('\\\"x\\\"')"), false);
  const zip = fflate.unzipSync(run("buildAIPackage().zip"));
  assert.deepEqual(Object.keys(zip).sort(), [
    "context.md",
    "datasheets/__part-2.pdf",
    "datasheets/__part.pdf",
    "graph.json",
  ]);
  run("State.components.forEach((c)=>delete c.datasheetId);State.attachments=[]");
  assert.deepEqual(Object.keys(fflate.unzipSync(run("buildAIPackage().zip"))).sort(), [
    "context.md",
    "graph.json",
  ]);
});
