const assert = require("node:assert/strict");
const path = require("node:path");
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
module.exports = async ({ page, tiff, freshFolder, clickWorld, out }) => {
  await freshFolder();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.waitForFunction(() => !ProjectFile.busy);
  const bytes = tiff(1025, 769, { compression: 8, metadataPadding: 8192 });
  for (const name of ["rotation-reference", "rotation-target"]) {
    const chooser = page.waitForEvent("filechooser");
    await page
      .locator("#layer-stack .layer-group")
      .first()
      .getByRole("button", { name: "+ Add image", exact: true })
      .click();
    await (await chooser).setFiles({ name: name + ".tif", mimeType: "image/tiff", buffer: bytes });
    await page.waitForFunction(
      (n) => State.scans.some((s) => s.name === n) && !ProjectFile.busy,
      name,
    );
  }
  await page.evaluate(() => {
    change(() => {
      for (const s of State.scans) s.transform = { tx: -512, ty: -384, scale: 1, rotation: 0 };
    });
    setPrimaryScan(State.scans[0].id);
    View.comparisonId = State.scans[1].id;
    syncViewControls();
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => !isDirty() && !ProjectFile.busy);
  const before = await page.evaluate(() => ({
    doc: serializeProject(),
    history: History.past.length,
    center: screenToWorld(View.width / 2, View.height / 2),
  }));
  await page.evaluate(() => {
    window.originalConnectivity = Connectivity.nets;
  });
  for (const expected of [90, -180, -90, 0]) {
    const generation = await page.evaluate(() => Tiles.generation);
    await page.getByRole("button", { name: "Rotate scene right 90 degrees", exact: true }).click();
    await page.waitForFunction((g) => Tiles.generation > g, generation);
    const state = await page.evaluate(() => ({
      rotation: View.rotation,
      center: screenToWorld(View.width / 2, View.height / 2),
      doc: serializeProject(),
      history: History.past.length,
      dirty: isDirty(),
      sameNets: Connectivity.nets === window.originalConnectivity,
    }));
    assert.equal(state.rotation, expected);
    near(state.center.x, before.center.x);
    near(state.center.y, before.center.y);
    assert.equal(state.doc, before.doc);
    assert.equal(state.history, before.history);
    assert.equal(state.dirty, false);
    assert.equal(state.sameNets, true);
    assert.equal(
      await page.getByLabel("Scene rotation angle", { exact: true }).textContent(),
      expected + "°",
    );
  }
  assert.equal(await page.getByRole("button", { name: "Reset", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Rotate scene left 90 degrees", exact: true }).click();
  assert.equal(await page.evaluate(() => View.rotation), -90);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  assert.equal(await page.evaluate(() => View.rotation), 0);
  async function screen(x, y) {
    return page.evaluate(
      ({ x, y }) => {
        const p = worldToScreen(x, y),
          r = View.canvas.getBoundingClientRect();
        return { x: p.x + r.left, y: p.y + r.top };
      },
      { x, y },
    );
  }
  async function drag(a, b) {
    const p = await screen(...a),
      q = await screen(...b);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(q.x, q.y, { steps: 4 });
    await page.mouse.up();
  }
  async function current() {
    return page.evaluate(() => ({ x: View.panX, y: View.panY }));
  }
  for (const angle of [0, 90, 180, 270]) {
    await page.evaluate((a) => {
      rotateView(a - View.rotation);
      fitBoard();
    }, angle);
    const fitted = await page.evaluate(() =>
      State.scans
        .flatMap((s) =>
          [
            [0, 0],
            [s.width, 0],
            [s.width, s.height],
            [0, s.height],
          ].map(([x, y]) => worldToScreen(...Object.values(imageToWorld(s, { x, y })))),
        )
        .map((p) => ({
          ok:
            p.x >= 49.99 && p.x <= View.width - 49.99 && p.y >= 49.99 && p.y <= View.height - 49.99,
        })),
    );
    assert.ok(fitted.every((p) => p.ok));
    // Pointer landmarks must stay in board/image coordinates at every quarter turn.
    await page.evaluate((a) => {
      rotateView(a - View.rotation);
      View.zoom = 1;
      View.panX = View.width / 2;
      View.panY = View.height / 2;
      beginAlignment(State.scans[1], State.scans[0].id, 3);
    }, angle);
    const alignmentBefore = await page.evaluate(() => snapshot());
    for (const p of [
      [-50, 0],
      [150, 0],
      [-50, 200],
    ])
      await clickWorld(...p);
    await page.getByRole("button", { name: "Pick target landmarks", exact: true }).click();
    for (const p of [
      [-112, -84],
      [88, -84],
      [-112, 116],
    ])
      await clickWorld(...p);
    assert.equal(await page.evaluate(() => Editor.mode.phase), "preview");
    assert.equal(await page.evaluate(() => snapshot()), alignmentBefore);
    await page.getByRole("button", { name: "Apply alignment", exact: true }).click();
    const aligned = await page.evaluate(() => State.scans[1].transform);
    near(aligned.tx, -450);
    near(aligned.ty, -300);
    near(aligned.scale, 1);
    near(aligned.rotation, 0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(await page.evaluate(() => snapshot()), alignmentBefore);
  }
  for (const angle of [0, 90, 180, 270]) {
    await page.evaluate((a) => {
      setTool("select");
      change(() => {
        State.components = [];
        State.traces = [];
        State.vias = [];
        State.components.push(
          makeComponent(
            "free",
            {
              w: 6,
              h: 4,
              pinList: [
                { num: 1, x: -1.5, y: 0, w: 0.8, h: 0.8, shape: "rect", tht: false },
                { num: 2, x: 1.5, y: 0, w: 0.8, h: 0.8, shape: "rect", tht: false },
              ],
            },
            -100,
            -100,
            "U",
            1,
          ),
        );
      });
      rotateView(a - View.rotation);
      View.zoom = 1;
      View.panX = View.width / 2;
      View.panY = View.height / 2;
      View.grid = true;
      requestRender();
    }, angle);
    await clickWorld(-100, -100);
    assert.equal(await page.evaluate(() => Editor.selection.type), "component");
    await drag([-100, -100], [-70, -80]);
    const moved = await page.evaluate(() => ({
      x: State.components[0].x,
      y: State.components[0].y,
    }));
    near(moved.x, -70);
    near(moved.y, -80);
    await clickWorld(-85, -80);
    assert.equal(await page.evaluate(() => Editor.selection.type), "pad");
    await drag([-85, -80], [-75, -75]);
    const pad = await page.evaluate(() =>
      pinWorldPos(State.components[0], State.components[0].pins[0]),
    );
    near(pad.x, -75);
    near(pad.y, -75);
    const padResize = await page.evaluate(() => ({
      corner: padCornersWorld(State.components[0], State.components[0].pins[0])[0],
      opposite: padCornersWorld(State.components[0], State.components[0].pins[0])[2],
      w: State.components[0].pins[0].w,
    }));
    await drag(
      [padResize.corner.x, padResize.corner.y],
      [padResize.corner.x - 5, padResize.corner.y - 3],
    );
    const resizedPad = await page.evaluate(() => ({
      opposite: padCornersWorld(State.components[0], State.components[0].pins[0])[2],
      w: State.components[0].pins[0].w,
    }));
    assert.ok(resizedPad.w > padResize.w);
    near(resizedPad.opposite.x, padResize.opposite.x);
    near(resizedPad.opposite.y, padResize.opposite.y);
    await clickWorld(-70, -97);
    assert.equal(await page.evaluate(() => Editor.selection.type), "component");
    const bodyResize = await page.evaluate(() => ({
      corner: bodyCornersWorld(State.components[0])[0],
      opposite: bodyCornersWorld(State.components[0])[2],
      pins: JSON.stringify(State.components[0].pins),
    }));
    await drag(
      [bodyResize.corner.x, bodyResize.corner.y],
      [bodyResize.corner.x - 10, bodyResize.corner.y - 6],
    );
    const resizedBody = await page.evaluate(() => ({
      opposite: bodyCornersWorld(State.components[0])[2],
      pins: JSON.stringify(State.components[0].pins),
    }));
    near(resizedBody.opposite.x, bodyResize.opposite.x);
    near(resizedBody.opposite.y, bodyResize.opposite.y);
    assert.equal(resizedBody.pins, bodyResize.pins);
    await page.evaluate(() => setTool("component"));
    await clickWorld(100, -150);
    const placed = await page.evaluate(() => State.components.at(-1));
    near(placed.x, 100);
    near(placed.y, -150);
    await page.evaluate(() => setTool("via"));
    await clickWorld(-150, 120);
    const via = await page.evaluate(() => State.vias.at(-1));
    near(via.x, -150);
    near(via.y, 120);
    await page.evaluate(() => setTool("trace"));
    for (const p of [
      [80, 50],
      [160, 50],
      [160, 130],
    ])
      await clickWorld(...p);
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => State.traces.at(-1).points.length), 3);
    await page.evaluate(() => setTool("select"));
    await clickWorld(120, 50);
    assert.equal(await page.evaluate(() => Editor.selection.type), "trace");
    await drag([160, 50], [180, 70]);
    const vertex = await page.evaluate(() => State.traces.at(-1).points[1]);
    near(vertex.x, 180);
    near(vertex.y, 70);
    // The visible rectangle, not its larger world bounding box, defines selection.
    const rect = await page.evaluate(() => {
      const p = bodyCornersWorld(State.components[0]).map((p) => worldToScreen(p.x, p.y)),
        b = bounds(p),
        r = View.canvas.getBoundingClientRect();
      return {
        x: b.minX + r.left - 10,
        y: b.minY + r.top - 10,
        x2: b.maxX + r.left + 10,
        y2: b.maxY + r.top + 10,
      };
    });
    await page.mouse.move(rect.x, rect.y);
    await page.mouse.down();
    await page.mouse.move(rect.x2, rect.y2, { steps: 4 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => Editor.selection.type), "component");
    assert.equal(
      await page.evaluate(() => Editor.selection.object.id === State.components[0].id),
      true,
    );
    await page.evaluate(() => setTool("measure"));
    await page.getByRole("button", { name: "Measure distance", exact: true }).click();
    const measureBefore = await page.evaluate(() => snapshot());
    await clickWorld(0, 0);
    await clickWorld(30, 40);
    const measured = await page.evaluate(() =>
      Math.hypot(
        Editor.mode.points[1].x - Editor.mode.points[0].x,
        Editor.mode.points[1].y - Editor.mode.points[0].y,
      ),
    );
    near(measured, 50);
    assert.equal(await page.evaluate(() => snapshot()), measureBefore);
    assert.match(await page.locator("#coordinates").textContent(), /30\.00.*40\.00/);
    await page.evaluate(() => setTool("select"));
    const p = await screen(0, 0),
      panBefore = await current();
    await page.mouse.move(p.x, p.y);
    await page.keyboard.down("Space");
    await page.mouse.down();
    await page.mouse.move(p.x + 100, p.y + 40, { steps: 4 });
    let pan = await current();
    near(pan.x - panBefore.x, 100);
    near(pan.y - panBefore.y, 40);
    await page.mouse.wheel(0, -100);
    assert.equal(await page.evaluate(() => Editor.drag.type), "pan");
    const panZoom = await current();
    await page.mouse.move(p.x + 120, p.y + 40);
    pan = await current();
    near(pan.x - panZoom.x, 20);
    near(pan.y, panZoom.y);
    await page.mouse.up();
    await page.keyboard.up("Space");
    if (angle === 90) await page.screenshot({ path: path.join(out, "scene-rotation.png") });
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => !isDirty() && !ProjectFile.busy);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.waitForFunction(() => !ProjectFile.busy);
  assert.equal(await page.evaluate(() => View.rotation), 0);
  assert.equal(await page.getByLabel("Scene rotation angle", { exact: true }).textContent(), "0°");
  console.log(
    "PASS: camera controls/integrity, rotated TIFF viewport/fit, alignment at four angles, editing/resize/measurement/marquee/pan at four angles, Space-wheel zoom and reset on Open.",
  );
};
