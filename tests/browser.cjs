const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const fflate = require("../vendor/fflate-0.8.3.js");
const tiff = require("./tiff-fixture.cjs");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const out = process.env.TEST_OUTPUT || "test-results";
  await fs.mkdir(out, { recursive: true });
  try {
    await page.addInitScript(() => {
      window.showDirectoryPicker = async () => window.testDirectory;
      window.showSaveFilePicker = async (options) => {
        window.exportOptions = options;
        return testDirectory.getFileHandle("analysis.zip", { create: true });
      };
    });
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:8080");
    await page.waitForSelector("#layer-stack h2");
    async function freshFolder() {
      await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        window.testDirectory = await root.getDirectoryHandle("pcb-test-" + crypto.randomUUID(), {
          create: true,
        });
      });
    }
    await freshFolder();
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.waitForFunction(() => ProjectFile.root && !ProjectFile.busy);
    assert.equal(await page.evaluate(() => isDirty()), false);
    assert.equal(
      await page.evaluate(
        async () =>
          JSON.parse(
            await (await (await testDirectory.getFileHandle("project.json")).getFile()).text(),
          ).version,
      ),
      3,
    );
    await page.getByRole("button", { name: "+ Add layer", exact: true }).click();
    await page.waitForFunction(() => State.physicalLayers.length === 3);
    async function upload(file) {
      const chooser = page.waitForEvent("filechooser");
      await page
        .locator("#layer-stack .layer-group")
        .first()
        .getByRole("button", { name: "+ Add image", exact: true })
        .click();
      await (await chooser).setFiles(file);
    }
    await page.evaluate(() => {
      window.savedTileView = Tiles.view;
      Tiles.view = () => {};
    });
    const source = tiff(1025, 769, { metadataPadding: 8192 });
    await upload({ name: "copper.tif", mimeType: "image/tiff", buffer: source });
    await page.waitForFunction(
      () => State.scans.length === 1 && !ProjectFile.busy,
      {},
      { timeout: 60000 },
    );
    const imported = await page.evaluate(async () => {
      const scan = State.scans[0],
        dir = await scanDirectory(scan.id),
        entries = [];
      for await (const [name] of dir.entries()) entries.push(name);
      return {
        entries: entries.sort(),
        manifest: JSON.parse(
          await (await (await dir.getFileHandle("manifest.json")).getFile()).text(),
        ),
        sourceSize: (await (await dir.getFileHandle("source.tif")).getFile()).size,
      };
    });
    assert.deepEqual(imported.entries, ["manifest.json", "source.tif"]);
    assert.equal(imported.sourceSize, source.length);
    assert.equal(imported.manifest.schema, "pcb-reveng-scan-v1");
    assert.equal(imported.manifest.maxLogicalLevel, 2);
    const fidelity = await page.evaluate(async () => {
      const scan = State.scans[0],
        img = await ImageEngine.tile(tileSpec(scan, 0, 2, 1)),
        c = new OffscreenCanvas(img.width, img.height),
        ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const rgba = Array.from(ctx.getImageData(0, 1, 1, 1).data),
        edge = [img.width, img.height];
      img.close();
      return { rgba, edge };
    });
    assert.deepEqual(fidelity.edge, [1, 257]);
    assert.deepEqual(fidelity.rgba, [0, 1, 1, 255]);
    await page.evaluate(() => {
      Tiles.view = window.savedTileView;
      requestRender();
    });
    await page.waitForFunction(() => Tiles.cache.bytes > 0);
    assert.ok(await page.evaluate(() => Tiles.cache.bytes < 512 * 1024 * 1024));
    for (const [name, options] of [
      ["tiled-deflate", { tiled: true, compression: 8 }],
      ["stripped-lzw", { compression: 5 }],
      ["big-tiff", { big: true }],
      ["deferred-strips", { metadataPadding: 8192 }],
      ["deferred-tiles", { tiled: true, compression: 8, metadataPadding: 8192 }],
      ["deferred-big-tiff", { big: true, metadataPadding: 8192 }],
    ]) {
      await upload({
        name: name + ".tif",
        mimeType: "image/tiff",
        buffer: tiff(513, 515, options),
      });
      await page.waitForFunction(
        () => State.scans.length === 2 && !ProjectFile.busy,
        {},
        { timeout: 60000 },
      );
      const mismatches = await page.evaluate(async () => {
        const scan = State.scans[1],
          dir = await scanDirectory(scan.id);
        let bad = 0;
        for (let ty = 0; ty < Math.ceil(scan.height / 512); ty++)
          for (let tx = 0; tx < Math.ceil(scan.width / 512); tx++) {
            const img = await ImageEngine.tile(tileSpec(scan, 0, tx, ty)),
              c = new OffscreenCanvas(img.width, img.height),
              ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const bytes = ctx.getImageData(0, 0, img.width, img.height).data;
            for (let y = 0; y < img.height; y++)
              for (let x = 0; x < img.width; x++) {
                const p = (y * img.width + x) * 4,
                  gx = tx * 512 + x,
                  gy = ty * 512 + y;
                if (
                  bytes[p] !== gx % 256 ||
                  bytes[p + 1] !== gy % 256 ||
                  bytes[p + 2] !== (gx + gy) % 256 ||
                  bytes[p + 3] !== 255
                )
                  bad++;
              }
            img.close();
          }
        return bad;
      });
      assert.equal(mismatches, 0, name + " L0 pixels");
      await page.getByRole("button", { name: "Properties scan " + name, exact: true }).click();
      await page.getByRole("button", { name: "Delete scan", exact: true }).click();
      assert.equal(await page.evaluate(() => State.scans.length), 1);
    }
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 96;
      const x = c.getContext("2d");
      x.fillStyle = "#557766";
      x.fillRect(0, 0, 128, 96);
      return c.toDataURL("image/png");
    });
    await upload({
      name: "populated.png",
      mimeType: "image/png",
      buffer: Buffer.from(png.split(",")[1], "base64"),
    });
    await page.waitForFunction(() => State.scans.length === 2 && !ProjectFile.busy);
    await page
      .getByLabel("Comparison", { exact: true })
      .selectOption(await page.evaluate(() => String(State.scans[0].id)));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => !isDirty() && !ProjectFile.busy);
    const clean = await page.evaluate(() => snapshot());
    await page.keyboard.down("Space");
    await page.keyboard.press("s");
    await page.keyboard.press("w");
    await page.keyboard.press("c");
    await page.keyboard.press("z");
    await page.keyboard.press("q");
    await page.keyboard.up("Space");
    await page.getByLabel("Drawing opacity", { exact: true }).fill("0.5");
    assert.equal(await page.evaluate(() => snapshot()), clean);
    assert.equal(await page.evaluate(() => isDirty()), false);
    await page.evaluate(() => {
      View.panX = 500;
      View.panY = 350;
      View.zoom = 1;
      setPrimaryScan(State.scans[0].id);
      change(() => {
        const c = makeComponent(
          "free",
          {
            w: 10,
            h: 6,
            pinList: [
              { num: 1, x: -2, y: 0, w: 1, h: 1, shape: "rect", tht: false },
              { num: 2, x: 2, y: 0, w: 1, h: 1, shape: "rect", tht: false },
            ],
          },
          100,
          100,
          "U",
          View.activeLayerId,
        );
        State.components.push(c);
      });
    });
    async function clickWorld(x, y) {
      const p = await page.evaluate(
        ({ x, y }) => {
          const q = worldToScreen(x, y),
            r = View.canvas.getBoundingClientRect();
          return { x: q.x + r.left, y: q.y + r.top };
        },
        { x, y },
      );
      await page.mouse.click(p.x, p.y);
    }
    await clickWorld(100, 100);
    await page.getByLabel("Value", { exact: true }).fill("MC35XS3400DH");
    await page.getByLabel("Value", { exact: true }).press("Tab");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Attach PDF", exact: true }).click();
    const pdf = Buffer.from("%PDF-1.4\n% test datasheet\n%%EOF");
    await (await chooser).setFiles({ name: "part.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.waitForFunction(() => State.attachments.length === 1 && !ProjectFile.busy);
    await page.keyboard.press("Escape");
    await clickWorld(100, 100);
    await page.keyboard.press("Control+c");
    await page.mouse.move(900, 600);
    await page.keyboard.press("Control+v");
    assert.equal(await page.evaluate(() => State.components.length), 2);
    assert.equal(
      await page.evaluate(
        () => State.components[0].datasheetId === State.components[1].datasheetId,
      ),
      true,
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => !isDirty() && !ProjectFile.busy);
    const before = await page.evaluate(() => snapshot());
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.waitForFunction(() => !ProjectFile.busy);
    assert.equal(await page.evaluate(() => snapshot()), before);
    await page.locator("#export-menu summary").click();
    await page.getByRole("button", { name: "AI package" }).click();
    await page.waitForFunction(() => !ProjectFile.busy && window.exportOptions);
    const zip = Buffer.from(
      await page.evaluate(async () =>
        Array.from(
          new Uint8Array(
            await (
              await (await testDirectory.getFileHandle("analysis.zip")).getFile()
            ).arrayBuffer(),
          ),
        ),
      ),
    );
    const files = fflate.unzipSync(zip),
      graph = JSON.parse(fflate.strFromU8(files["graph.json"]));
    assert.equal(graph.schema, "pcb-reveng-ai-graph-v2");
    assert.equal(graph.components[0].layer, "L1");
    assert.equal(Object.keys(files).filter((p) => p.endsWith(".pdf")).length, 1);
    assert.equal(graph.scans, undefined);
    assert.equal(graph.components[0].x, undefined);
    assert.match(await page.evaluate(() => exportOptions.suggestedName), /-AI\.zip$/);
    await page.waitForFunction(
      () =>
        [...Tiles.wanted.values()]
          .filter((s) => s.priority === 0)
          .every((s) => Tiles.cache.entries.has(s.key)),
      {},
      { timeout: 15000 },
    );
    await page.screenshot({ path: path.join(out, "multilayer-workspace.png") });
    await require("./browser-advanced.cjs")({ page, png, tiff, clickWorld, freshFolder });
    await require("./sparse-browser.cjs")({ page, tiff, freshFolder });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: directory New/Open/Save, sparse TIFF source copy/lazy L0 pixels, multiple scans, view shortcuts, components/copy/datasheets and streaming AI ZIP.",
    );
  } catch (e) {
    console.error("Browser errors:", errors);
    console.error(
      "Toast:",
      await page
        .locator("#toast")
        .textContent()
        .catch(() => ""),
    );
    await page.screenshot({ path: path.join(out, "failure.png") });
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
