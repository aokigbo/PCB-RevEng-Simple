const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const fflate = require("../vendor/fflate-0.8.3.js");

module.exports = async ({ page, out }) => {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.evaluate(() => {
    change(() => {
      State.name = "Datasheet board";
      const a = makeComponent("chip2", {}, 0, 0, "R");
      State.components.push(a);
      const b = makeComponent("chip2", {}, 120, 0, "R");
      State.components.push(b);
      a.value = b.value = "Sample part";
    });
    Editor.selection = { type: "component", object: State.components[0] };
    renderInspector();
  });
  assert.equal(await page.locator("#export-net").count(), 0);
  assert.equal(await page.getByLabel("KiCad footprint (optional)").count(), 0);
  const pdfA = Buffer.from("%PDF-1.4\n% Sample A\n%%EOF\n");
  const pdfB = Buffer.from("%PDF-1.4\n% Sample B\n%%EOF\n");
  async function pick(button, buffer, name = "shared.pdf") {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: button, exact: true }).click();
    await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer });
    await page.waitForFunction(
      () => !document.querySelector('input[accept=".pdf,application/pdf"]'),
    );
  }
  await pick("Attach PDF", pdfA);
  await page.waitForFunction(() => State.attachments.length === 1);
  assert.equal(
    await page.evaluate(() => State.components[0].datasheetId),
    await page.evaluate(() => State.attachments[0].id),
  );
  await page.evaluate(() => {
    Editor.selection = { type: "component", object: State.components[1] };
    renderInspector();
  });
  await pick("Attach PDF", pdfA);
  await page.waitForFunction(() => State.components[1].datasheetId !== undefined);
  assert.equal(await page.evaluate(() => State.attachments.length), 1);
  assert.equal(
    await page.evaluate(() => State.components[1].datasheetId),
    await page.evaluate(() => State.components[0].datasheetId),
  );
  await pick("Replace", pdfB);
  await page.waitForFunction(() => State.attachments.length === 2);
  const secondId = await page.evaluate(() => State.components[1].datasheetId);
  await page.getByRole("button", { name: "Undo" }).click();
  assert.equal(
    await page.evaluate(() => State.components[1].datasheetId),
    await page.evaluate(() => State.components[0].datasheetId),
  );
  assert.equal(await page.evaluate((id) => AttachmentAssets.has(id), secondId), true);
  await page.getByRole("button", { name: "Redo" }).click();
  assert.equal(await page.evaluate(() => State.components[1].datasheetId), secondId);
  await page.evaluate(() => {
    Editor.selection = { type: "component", object: State.components[1] };
    renderInspector();
  });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  assert.equal(await page.evaluate(() => State.components[1].datasheetId), undefined);
  await page.getByRole("button", { name: "Undo" }).click();
  assert.equal(await page.evaluate(() => State.components[1].datasheetId), secondId);
  await page.evaluate(() => {
    Editor.selection = { type: "component", object: State.components[1] };
    renderInspector();
    const create = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      window.openedBlobType = blob.type;
      return create.call(URL, blob);
    };
  });
  const popup = page.waitForEvent("popup");
  await page.locator("#inspector").getByRole("button", { name: "Open", exact: true }).click();
  assert.equal(await page.evaluate(() => window.openedBlobType), "application/pdf");
  assert.match((await popup).url(), /^blob:/);
  await page.evaluate(() =>
    change(() => {
      State.traces.push({
        id: nextId(),
        side: "front",
        width: 1,
        points: [
          { x: 300, y: 0 },
          { x: 310, y: 0 },
        ],
        netName: "GND",
      });
      State.traces.push({
        id: nextId(),
        side: "front",
        width: 1,
        points: [
          { x: 310, y: 0 },
          { x: 320, y: 0 },
        ],
        netName: "VBAT",
      });
    }),
  );
  assert.ok(await page.evaluate(() => Connectivity.issues.length));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => !isDirty());
  const saved = await page.evaluate(() => testFiles.text);
  const savedJSON = JSON.parse(saved);
  assert.equal(savedJSON.version, 1);
  assert.equal(savedJSON.attachments.length, 2);
  assert.equal(savedJSON.attachments[0].dataURL.startsWith("data:application/pdf;base64,"), true);
  assert.equal(JSON.stringify(savedJSON).includes('"kicad"'), false);
  await page.getByRole("button", { name: "New", exact: true }).click();
  assert.equal(await page.evaluate(() => AttachmentAssets.size), 0);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.waitForFunction(() => State.attachments.length === 2 && !ProjectFile.busy);
  assert.equal(await page.evaluate(() => AttachmentAssets.size), 2);
  assert.equal(await page.evaluate(() => State.components[1].datasheetId), secondId);
  await page.locator("#export-menu summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "AI package" }).click();
  const zipFile = path.join(out, "Datasheet-board-AI.zip");
  await (await download).saveAs(zipFile);
  const zip = fflate.unzipSync(new Uint8Array(await fs.readFile(zipFile)));
  assert.deepEqual(Object.keys(zip).sort(), [
    "context.md",
    "datasheets/shared-2.pdf",
    "datasheets/shared.pdf",
    "graph.json",
  ]);
  assert.deepEqual(Buffer.from(zip["datasheets/shared.pdf"]), pdfA);
  assert.deepEqual(Buffer.from(zip["datasheets/shared-2.pdf"]), pdfB);
  const graph = JSON.parse(fflate.strFromU8(zip["graph.json"]));
  assert.deepEqual(
    graph.components.map((c) => c.datasheet),
    ["datasheets/shared.pdf", "datasheets/shared-2.pdf"],
  );
  assert.ok(graph.warnings.some((w) => w.includes("conflicting names")));
  assert.match(fflate.strFromU8(zip["context.md"]), /Connectivity warnings/);
  assert.match(fflate.strFromU8(zip["context.md"]), /conflicting names/);
  assert.equal(JSON.stringify(graph).includes('"x"'), false);
  const before = await page.evaluate(() => snapshot());
  await page.evaluate((text) => {
    const parsed = JSON.parse(text);
    parsed.attachments[0].sha256 = "0".repeat(64);
    testFiles.text = JSON.stringify(parsed);
    testFiles.modified++;
  }, saved);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.waitForFunction(() => !ProjectFile.busy);
  assert.equal(await page.evaluate(() => snapshot()), before);
  assert.equal(await page.evaluate(() => AttachmentAssets.size), 2);
  console.log(
    "PASS: PDF attach/dedup/replace/remove/undo/open/save/reopen, ZIP paths and warnings, transactional invalid PDF.",
  );
};
