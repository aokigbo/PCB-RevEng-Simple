const assert = require("node:assert/strict");
const crypto = require("node:crypto");
module.exports = async ({ page, png, tiff, clickWorld, freshFolder }) => {
  const pngFile = {
    name: "inner.png",
    mimeType: "image/png",
    buffer: Buffer.from(png.split(",")[1], "base64"),
  };
  const chooser = page.waitForEvent("filechooser");
  await page
    .locator("#layer-stack .layer-group")
    .nth(1)
    .getByRole("button", { name: "+ Add image", exact: true })
    .click();
  await (await chooser).setFiles(pngFile);
  await page.waitForFunction(() => State.scans.length === 3 && !ProjectFile.busy);
  await page.locator('.layer-row[data-layer-id="1"] .layer-name').click();
  await page
    .getByLabel("Comparison", { exact: true })
    .selectOption(await page.evaluate(() => String(State.scans.find((s) => s.layerId === 2).id)));
  const baseline = await page.evaluate(() => snapshot()),
    view = await page.evaluate(() => ({
      zoom: View.zoom,
      x: View.panX,
      y: View.panY,
      scan: View.primaryByLayer.get(1),
    }));
  const box = await page.locator("#canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Space");
  assert.notEqual(await page.evaluate(() => View.canvas.style.cursor), "grab");
  assert.equal(await page.evaluate(() => Editor.drag), null);
  await page.mouse.wheel(0, 100);
  await page.waitForFunction((zoom) => View.zoom !== zoom, view.zoom);
  assert.equal(await page.evaluate(() => View.primaryByLayer.get(1)), view.scan);
  await page.keyboard.press("c");
  assert.notEqual(await page.evaluate(() => View.primaryByLayer.get(1)), view.scan);
  await page.keyboard.press("z");
  assert.equal(await page.evaluate(() => View.primaryByLayer.get(1)), view.scan);
  await page.keyboard.press("d");
  await page.keyboard.press("e");
  await page.keyboard.up("Space");
  const panAfterWheel = await page.evaluate(() => ({ x: View.panX, y: View.panY }));
  await page.locator('.layer-row[data-layer-id="2"] .layer-name').click();
  assert.equal(await page.evaluate(() => View.comparisonId), null);
  await page.locator('.layer-row[data-layer-id="1"] .layer-name').click();
  assert.equal(await page.evaluate(() => View.panX), panAfterWheel.x);
  assert.equal(await page.evaluate(() => View.panY), panAfterWheel.y);
  assert.equal(await page.evaluate(() => snapshot()), baseline);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const beforeNormalWheel = await page.evaluate(() => View.zoom);
  await page.mouse.wheel(0, -100);
  await page.waitForFunction((zoom) => View.zoom !== zoom, beforeNormalWheel);
  await page.evaluate(() => {
    View.panX = 350;
    View.panY = 240;
    View.zoom = 1;
    setTool("measure");
  });
  const copper = await page.evaluate(() =>
    JSON.stringify({
      components: State.components,
      traces: State.traces,
      vias: State.vias,
      scans: State.scans,
    }),
  );
  await page.getByRole("button", { name: "Calibrate millimeters", exact: true }).click();
  await clickWorld(0, 0);
  await clickWorld(200, 0);
  await page.getByLabel("Known distance (mm)", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Apply calibration", exact: true }).click();
  assert.equal(await page.evaluate(() => State.calibration.boardUnitsPerMm), 100);
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify({
        components: State.components,
        traces: State.traces,
        vias: State.vias,
        scans: State.scans,
      }),
    ),
    copper,
  );
  await page.keyboard.press("Escape");
  await clickWorld(100, 100);
  const resizeBefore = await page.evaluate(() => ({
    pins: JSON.stringify(State.components[0].pins),
    opposite: bodyCornersWorld(State.components[0])[2],
    doc: snapshot(),
  }));
  const corner = await page.evaluate(() => {
    const p = worldToScreen(...Object.values(bodyCornersWorld(State.components[0])[0])),
      r = View.canvas.getBoundingClientRect();
    return { x: p.x + r.left, y: p.y + r.top };
  });
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x - 40, corner.y - 20, { steps: 4 });
  await page.mouse.up();
  assert.equal(
    await page.evaluate(() => JSON.stringify(State.components[0].pins)),
    resizeBefore.pins,
  );
  assert.deepEqual(
    await page.evaluate(() => bodyCornersWorld(State.components[0])[2]),
    resizeBefore.opposite,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.evaluate(() => snapshot()), resizeBefore.doc);
  // Use three known synthetic landmark pairs, inspect preview, then commit only the target.
  await page.getByRole("button", { name: "Properties scan populated", exact: true }).click();
  await page.getByRole("button", { name: "Align to reference", exact: true }).click();
  await page.evaluate(() => {
    View.panX = 350;
    View.panY = 240;
    View.zoom = 1;
  });
  const before = await page.evaluate(() => snapshot());
  for (const p of [
    [90, 80],
    [210, 80],
    [90, 180],
  ])
    await clickWorld(...p);
  await page.getByRole("button", { name: "Pick target landmarks", exact: true }).click();
  for (const p of [
    [20, 20],
    [80, 20],
    [20, 70],
  ])
    await clickWorld(...p);
  assert.equal(await page.evaluate(() => Editor.mode.phase), "preview");
  assert.equal(await page.evaluate(() => snapshot()), before);
  await page.getByRole("button", { name: "Apply alignment", exact: true }).click();
  const aligned = await page.evaluate(
    () => State.scans.find((s) => s.name === "populated").transform,
  );
  assert.ok(Math.abs(aligned.tx - 50) < 1e-6);
  assert.ok(Math.abs(aligned.ty - 40) < 1e-6);
  assert.ok(Math.abs(aligned.scale - 2) < 1e-6);
  assert.equal(
    await page.evaluate(() => JSON.stringify(State.components)),
    JSON.stringify(JSON.parse(copper).components),
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.evaluate(() => snapshot()), before);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("button", { name: "Properties scan populated", exact: true }).click();
  await page.getByRole("button", { name: "Flip horizontally", exact: true }).click();
  assert.equal(
    await page.evaluate(() => State.scans.find((s) => s.name === "populated").aligned),
    false,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  // Reorder through the real draggable layer rows; then verify delete/undo and stable IDs.
  const dialogs = [];
  page.on("dialog", (d) => dialogs.push(d.message()));
  await page.evaluate(() =>
    change(() =>
      State.vias.push({
        id: nextId(),
        x: 500,
        y: 500,
        r: 10,
        hole: 5,
        fromLayerId: 1,
        toLayerId: State.physicalLayers[2].id,
      }),
    ),
  );
  const dragPositions = await page.evaluate(() => {
    window.layerDragEvents = [];
    for (const type of ["dragstart", "drop", "dragend"])
      document.getElementById("layer-stack").addEventListener(type, (e) => {
        layerDragEvents.push({
          type,
          layer: e.target.closest(".layer-row")?.dataset.layerId,
          value: e.dataTransfer.getData("text/plain"),
        });
      });
    return [2, 1].map((id) => {
      const row = document.querySelector(`.layer-row[data-layer-id="${id}"]`),
        r = row.getBoundingClientRect(),
        name = row.querySelector(".layer-name").getBoundingClientRect(),
        menu = row.querySelector(".layer-menu").getBoundingClientRect();
      // Grab the row's gap, not either nested button (whose drag behavior differs by platform).
      return { x: (name.right + menu.left) / 2 - r.left, y: r.height / 2 };
    });
  });
  await page
    .locator('.layer-row[data-layer-id="2"]')
    .dragTo(page.locator('.layer-row[data-layer-id="1"]'), {
      sourcePosition: dragPositions[0],
      targetPosition: dragPositions[1],
      steps: 8,
    });
  // Native drop/confirmation can finish after the input command is acknowledged.
  await page.waitForFunction(() => State.physicalLayers[0].id === 2);
  assert.equal(await page.evaluate(() => State.physicalLayers[0].id), 2);
  assert.ok(dialogs.some((x) => x.includes("physical span")));
  assert.equal(await page.evaluate(() => State.components[0].layerId), 1);
  await page.locator('.layer-row[data-layer-id="2"] .layer-menu').click();
  await page.getByRole("button", { name: "Delete physical layer", exact: true }).click();
  assert.equal(await page.evaluate(() => State.scans.some((s) => s.layerId === 2)), false);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.evaluate(() => State.scans.some((s) => s.layerId === 2)), true);
  // Cancel a real preprocessing job, leaving document metadata untouched.
  const cancelledBefore = await page.evaluate(() => snapshot());
  const cancelChooser = page.waitForEvent("filechooser");
  await page
    .locator("#layer-stack .layer-group")
    .first()
    .getByRole("button", { name: "+ Add image", exact: true })
    .click();
  await (
    await cancelChooser
  ).setFiles({ name: "cancel.tif", mimeType: "image/tiff", buffer: tiff(4097, 2049) });
  await page.getByRole("button", { name: "Cancel import", exact: true }).click();
  await page.waitForFunction(() => !ProjectFile.busy);
  assert.equal(await page.evaluate(() => snapshot()), cancelledBefore);
  // Import a small real v1 project into a separate directory, including its embedded PDF.
  const pdf = Buffer.from("%PDF-1.4\nlegacy datasheet\n%%EOF"),
    hash = crypto.createHash("sha256").update(pdf).digest("hex");
  const legacy = {
    app: "pcb-reveng-simple",
    version: 1,
    name: "Migrated board",
    nextId: 10,
    pxPerMm: 10,
    calibrated: true,
    layers: [
      {
        id: 1,
        side: "front",
        name: "old.png",
        width: 128,
        height: 96,
        dataURL: png,
        tx: 0,
        ty: 0,
        scale: 1,
        rot: 0,
        mirror: false,
        opacity: 0.3,
      },
    ],
    components: [
      {
        id: 3,
        ref: "J1",
        value: "Legacy",
        footprint: "Custom",
        side: "back",
        x: 100,
        y: 100,
        rot: 0,
        body: { w: 10, h: 6 },
        datasheetId: 5,
        pins: [
          {
            num: "1",
            name: "GND",
            xmm: 2,
            ymm: 0,
            w: 2,
            h: 2,
            shape: "circle",
            hole: 0.8,
            tht: true,
          },
        ],
      },
    ],
    traces: [],
    vias: [{ id: 4, x: 80, y: 100, r: 5, hole: 2 }],
    attachments: [
      {
        id: 5,
        name: "legacy.pdf",
        size: pdf.length,
        mime: "application/pdf",
        sha256: hash,
        dataURL: "data:application/pdf;base64," + pdf.toString("base64"),
      },
    ],
  };
  const original = JSON.stringify(legacy);
  await freshFolder();
  const importChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import .pcbrev", exact: true }).click();
  await (
    await importChooser
  ).setFiles({ name: "old.pcbrev", mimeType: "application/json", buffer: Buffer.from(original) });
  await page.waitForFunction(
    () => State.name === "Migrated board" && !ProjectFile.busy,
    {},
    { timeout: 60000 },
  );
  assert.equal(JSON.stringify(legacy), original);
  assert.equal(await page.evaluate(() => State.vias.length), 2);
  assert.equal(await page.evaluate(() => State.components[0].pins[0].x), -20);
  assert.equal(await page.evaluate(() => State.calibration.boardUnitsPerMm), 10);
  assert.equal(
    await page.evaluate(
      async () =>
        JSON.parse(
          await (await (await testDirectory.getFileHandle("project.json")).getFile()).text(),
        ).version,
    ),
    3,
  );
  await page.evaluate(() => {
    activateLayer(State.components[0].layerId);
    inspect("component", State.components[0]);
    window.savedOpen = window.open;
    window.open = () => {
      window.pdfTab = { opener: window, location: {}, close() {} };
      return pdfTab;
    };
    const create = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      window.pdfMime = blob.type;
      return create.call(URL, blob);
    };
  });
  await page.getByRole("button", { name: "Open PDF", exact: true }).click();
  await page.waitForFunction(() => window.pdfTab?.location.href?.startsWith("blob:"));
  assert.equal(await page.evaluate(() => pdfTab.opener), null);
  assert.equal(await page.evaluate(() => pdfMime), "application/pdf");
  await page.evaluate(() => (window.open = window.savedOpen));
  console.log(
    "PASS: view isolation, wheel zoom/Space navigation, calibration, alignment preview/apply/undo, flip, layer drag/delete, cancel and v1 directory migration/PDF opening.",
  );
};
