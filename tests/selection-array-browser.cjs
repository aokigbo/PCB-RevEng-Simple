const assert = require("node:assert/strict");
const path = require("node:path");
// Native pointer coordinates are quantized; this is well below one screen pixel.
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} != ${b}`);
module.exports = async ({ page, freshFolder, clickWorld, out }) => {
  async function fresh() {
    await freshFolder();
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.waitForFunction(() => !ProjectFile.busy);
  }
  async function fill(label, value) {
    const input = page.getByLabel(label, { exact: true });
    await input.fill(String(value));
    await input.press("Tab");
  }
  async function screen(p) {
    return page.evaluate((p) => {
      const q = worldToScreen(p.x, p.y),
        r = View.canvas.getBoundingClientRect();
      return { x: q.x + r.left, y: q.y + r.top };
    }, p);
  }
  async function drag(a, b, modifiers = []) {
    const x = await screen(a),
      y = await screen(b);
    for (const k of modifiers) await page.keyboard.down(k);
    await page.mouse.move(x.x, x.y);
    await page.mouse.down();
    await page.mouse.move(y.x, y.y, { steps: 8 });
    await page.mouse.up();
    for (const k of modifiers) await page.keyboard.up(k);
  }
  async function arrayDrag(a, b) {
    const points = await page.evaluate(
      ([a, b]) => [a, b].map((p) => localToWorld(Editor.mode.component, p.x, p.y)),
      [a, b],
    );
    await drag(points[0], points[1]);
  }
  async function layer(id) {
    await page.locator(`.layer-row[data-layer-id="${id}"] .layer-name`).click();
    assert.equal(await page.evaluate(() => View.activeLayerId), id);
  }
  await fresh();
  await page.evaluate(() => {
    change(() => {
      State.physicalLayers = Array.from({ length: 6 }, (_, i) => ({
        id: i + 1,
        description: "Depth " + (i + 1),
      }));
      State.nextId = Math.max(State.nextId, 7);
      const c = makeComponent("free", { w: 18, h: 54, pinList: [] }, 0, 0, "J", 1);
      c.rot = 30;
      State.components.push(c);
    });
    View.rotation = 90;
    View.zoom = 1.2;
    View.panX = View.width / 2;
    View.panY = View.height / 2;
    inspect("component", State.components[0]);
    syncViewControls();
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => !ProjectFile.busy && !isDirty());
  const baseline = await page.evaluate(() => ({ doc: snapshot(), history: History.past.length }));
  await page.getByRole("button", { name: "Add pad array", exact: true }).click();
  await page.getByLabel("Physical type", { exact: true }).selectOption("through");
  await fill("Pad width (units)", 10);
  await fill("Pad height (units)", 8);
  await fill("Outer diameter (units)", 12);
  await fill("Hole diameter (units)", 4);
  assert.equal(await page.evaluate(() => isDirty()), false);
  await arrayDrag({ x: -50, y: -230 }, { x: 50, y: 230 });
  assert.equal(await page.evaluate(() => Editor.mode.preview.length), 48);
  assert.equal(await page.evaluate(() => State.components[0].pins.length), 0);
  assert.equal(await page.evaluate(() => snapshot()), baseline.doc);
  assert.equal(await page.evaluate(() => History.past.length), baseline.history);
  assert.equal(await page.evaluate(() => isDirty()), false);
  assert.match(await page.locator("#pad-array-status").textContent(), /48 pins ready/);
  await page.getByLabel("Rows", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "pad-array-preview.png") });
  await page.locator("#canvas").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => State.components[0].pins.length), 48);
  assert.equal(
    await page.evaluate(() => State.components[0].pins.filter((p) => p.barrel).length),
    48,
  );
  assert.equal(await page.evaluate(() => State.vias.length), 0);
  assert.equal(await page.evaluate(() => History.past.length), baseline.history + 1);
  near(await page.evaluate(() => State.components[0].pins[0].x), -50);
  near(await page.evaluate(() => State.components[0].pins[0].y), -230);
  assert.deepEqual(
    await page.evaluate(() =>
      State.components[0].pins.filter((p, i) => i % 2 === 1).map((p) => Number(p.num)),
    ),
    Array.from({ length: 24 }, (_, i) => 48 - i),
  );
  const committed = await page.evaluate(() => snapshot());
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.evaluate(() => snapshot()), baseline.doc);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  assert.equal(await page.evaluate(() => snapshot()), committed);

  // A single row can be previewed and cancelled without touching existing pins or history.
  await page.evaluate(() => inspect("component", State.components[0]));
  await page.getByRole("button", { name: "Add pad array", exact: true }).click();
  await page.getByLabel("Numbering", { exact: true }).selectOption("row");
  await fill("Rows", 1);
  await fill("Columns", 8);
  await arrayDrag({ x: -70, y: 0 }, { x: 70, y: 20 });
  assert.equal(await page.evaluate(() => Editor.mode.preview.length), 8);
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => snapshot()), committed);
  assert.equal(await page.evaluate(() => Editor.mode), null);
  assert.equal(await page.evaluate(() => History.past.length), baseline.history + 1);
  // A surface grid uses the same normal pad model, and the explicit Place button also works.
  await page.evaluate(() => inspect("component", State.components[0]));
  await page.getByRole("button", { name: "Add pad array", exact: true }).click();
  await page.getByLabel("Numbering", { exact: true }).selectOption("serpentine");
  await fill("Rows", 4);
  await fill("Columns", 4);
  await arrayDrag({ x: -40, y: -40 }, { x: 40, y: 40 });
  assert.equal(await page.evaluate(() => Editor.mode.preview.length), 16);
  await page.getByRole("button", { name: "Place array", exact: true }).click();
  assert.equal(await page.evaluate(() => State.components[0].pins.length), 64);
  assert.equal(
    await page.evaluate(() => State.components[0].pins.slice(48).some((p) => p.barrel)),
    false,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.evaluate(() => snapshot()), committed);

  await layer(3);
  const pin1 = await page.evaluate(() =>
    pinWorldPos(State.components[0], State.components[0].pins[0]),
  );
  await clickWorld(pin1.x, pin1.y);
  assert.equal(await page.evaluate(() => Editor.selection.type), "pad");
  await page.getByLabel("To layer", { exact: true }).selectOption("2");
  await fill("Pin name", "Terminal 1");
  assert.equal(await page.evaluate(() => State.components[0].pins[0].barrel.toLayerId), 2);
  assert.equal(await page.evaluate(() => State.components[0].pins[1].barrel.toLayerId), 6);
  assert.equal(
    await page.evaluate(() => !!padVisible(State.components[0], State.components[0].pins[0])),
    false,
  );
  // Reordering nearby rows changes only pin 1's shortened span and reports connector pins.
  const dialogs = [];
  page.on("dialog", (d) => dialogs.push(d.message()));
  const beforeReorder = await page.evaluate(() => snapshot());
  await page.locator("#sidebar, #layer-stack").evaluateAll((panels) => {
    for (const p of panels) p.scrollTop = 0;
  });
  await page
    .locator('.layer-row[data-layer-id="3"]')
    .dragTo(page.locator('.layer-row[data-layer-id="2"]'), { steps: 8 });
  await page.waitForFunction(() => State.physicalLayers[1].id === 3);
  assert.ok(dialogs.some((d) => d.includes("0 vias and 1 connector pins")));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.evaluate(() => snapshot()), beforeReorder);

  const pin17 = await page.evaluate(() =>
    pinWorldPos(
      State.components[0],
      State.components[0].pins.find((p) => p.num === "17"),
    ),
  );
  for (const [id, dx] of [
    [3, 40],
    [5, -40],
  ]) {
    await layer(id);
    await page.locator('[data-tool="trace"]').click();
    await fill("Trace width (units)", 2);
    await clickWorld(pin17.x, pin17.y);
    await clickWorld(pin17.x + dx, pin17.y);
    await page.keyboard.press("Enter");
  }
  assert.equal(
    await page.evaluate(
      () =>
        Connectivity.byKey.get("t" + State.traces[0].id) ===
        Connectivity.byKey.get("t" + State.traces[1].id),
    ),
    true,
  );
  assert.equal(
    await page.evaluate(
      () =>
        Connectivity.byKey.get("t" + State.traces[0].id).members.filter((m) => m.type === "pad")
          .length,
    ),
    1,
  );
  await page.locator('[data-tool="select"]').click();
  await clickWorld(pin17.x, pin17.y);
  assert.equal(
    await page.evaluate(() => Editor.selection.object.pins[Editor.selection.index].num),
    "17",
  );
  const resizePin = await page.evaluate(() => ({
    doc: snapshot(),
    history: History.past.length,
    original: structuredClone(Editor.selection.object.pins[Editor.selection.index]),
    corner: selectionResizeCorners()[2],
    end: localToWorld(
      Editor.selection.object,
      Editor.selection.object.pins[Editor.selection.index].x + 10,
      Editor.selection.object.pins[Editor.selection.index].y + 10,
    ),
  }));
  await drag(resizePin.corner, resizePin.end);
  near(
    await page.evaluate(() => State.components[0].pins.find((p) => p.num === "17").barrel.diameter),
    16,
  );
  assert.equal(
    await page.evaluate(() => State.components[0].pins.find((p) => p.num === "17").w),
    resizePin.original.w,
  );
  assert.equal(await page.evaluate(() => History.past.length), resizePin.history + 1);
  assert.equal(
    await page.evaluate(
      () =>
        Connectivity.byKey.get("t" + State.traces[0].id) ===
        Connectivity.byKey.get("t" + State.traces[1].id),
    ),
    true,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.evaluate(() => snapshot()), resizePin.doc);
  await layer(1);
  await clickWorld(0, 0);
  const bodyResize = await page.evaluate(() => ({
    doc: snapshot(),
    pins: JSON.stringify(State.components[0].pins),
    corner: selectionResizeCorners()[2],
    end: localToWorld(State.components[0], 100, 280),
  }));
  await drag(bodyResize.corner, bodyResize.end);
  assert.equal(
    await page.evaluate(() => JSON.stringify(State.components[0].pins)),
    bodyResize.pins,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.evaluate(() => snapshot()), bodyResize.doc);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => !ProjectFile.busy && !isDirty());
  const saved = await page.evaluate(() => snapshot());
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.waitForFunction(() => !ProjectFile.busy);
  assert.equal(await page.evaluate(() => snapshot()), saved);
  assert.equal(
    await page.evaluate(() => State.components[0].pins.filter((p) => p.barrel).length),
    48,
  );
  assert.equal(await page.evaluate(() => "padArrays" in documentPayload()), false);

  // Mixed geometry: all four camera quarter turns, native marquee and one pointer-drag Undo.
  await fresh();
  await page.evaluate(() =>
    change(() => {
      State.physicalLayers = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, description: "" }));
      State.nextId = Math.max(State.nextId, 7);
      const c = makeComponent("free", { w: 4, h: 3, pinList: [] }, 0, 0, "J", 1);
      c.pins = [
        {
          num: "1",
          x: -30,
          y: 0,
          w: 8,
          h: 6,
          shape: "rect",
          tht: false,
          barrel: { fromLayerId: 1, toLayerId: 6, diameter: 8, hole: 4 },
        },
      ];
      State.components = [c];
      State.vias = [{ id: nextId(), x: 90, y: 40, r: 8, hole: 3, fromLayerId: 1, toLayerId: 6 }];
      State.traces = [
        {
          id: nextId(),
          layerId: 1,
          width: 6,
          points: [
            { x: 10, y: 70 },
            { x: 70, y: 70 },
          ],
        },
        {
          id: nextId(),
          layerId: 3,
          width: 2,
          points: [
            { x: -30, y: 0 },
            { x: -80, y: 40 },
            { x: -100, y: 80 },
          ],
        },
        {
          id: nextId(),
          layerId: 5,
          width: 2,
          points: [
            { x: 90, y: 40 },
            { x: 140, y: 40 },
            { x: 140, y: 80 },
          ],
        },
      ];
    }),
  );
  async function marqueeGroup(expected = ["component", "trace", "via"]) {
    const rect = await page.evaluate(() => {
      const points = [
          ...State.components.map((object) => ({ type: "component", object })),
          ...State.vias
            .filter((v) => viaOnLayer(v, View.activeLayerId))
            .map((object) => ({ type: "via", object })),
          ...State.traces
            .filter((t) => layerVisible(t.layerId))
            .map((object) => ({ type: "trace", object })),
        ]
          .flatMap(selectionGeometryPoints)
          .map((p) => worldToScreen(p.x, p.y)),
        b = bounds(points, 12),
        r = View.canvas.getBoundingClientRect();
      return { x1: b.minX + r.left, y1: b.minY + r.top, x2: b.maxX + r.left, y2: b.maxY + r.top };
    });
    await page.mouse.move(rect.x1, rect.y1);
    await page.mouse.down();
    await page.mouse.move(rect.x2, rect.y2, { steps: 8 });
    await page.mouse.up();
    assert.deepEqual(
      await page.evaluate(() =>
        selectionItems()
          .map((s) => s.type)
          .sort(),
      ),
      expected,
    );
  }
  for (const rotation of [0, 90, 180, 270]) {
    await page.evaluate((rotation) => {
      setTool("select");
      View.rotation = rotation;
      View.zoom = 2;
      View.panX = View.width / 2;
      View.panY = View.height / 2;
      requestRender();
    }, rotation);
    await marqueeGroup();
    const before = await page.evaluate(() => ({
      doc: snapshot(),
      history: History.past.length,
      corners: selectionResizeCorners(),
      c: structuredClone(State.components[0]),
      via: structuredClone(State.vias[0]),
      traces: structuredClone(State.traces),
    }));
    assert.equal(before.corners.length, 4);
    const anchor = before.corners[0],
      corner = before.corners[2];
    await drag(corner, {
      x: anchor.x + (corner.x - anchor.x) * 1.5,
      y: anchor.y + (corner.y - anchor.y) * 1.2,
    });
    const scaled = await page.evaluate(() => ({
      doc: snapshot(),
      c: State.components[0],
      via: State.vias[0],
      traces: State.traces,
      history: History.past.length,
      anchor: selectionResizeCorners()[0],
    }));
    near(scaled.anchor.x, anchor.x);
    near(scaled.anchor.y, anchor.y);
    near(scaled.c.body.w, before.c.body.w * 1.5);
    near(scaled.c.pins[0].x, before.c.pins[0].x * 1.5);
    near(scaled.c.pins[0].barrel.diameter, 12);
    near(scaled.c.pins[0].barrel.hole, 6);
    near(scaled.via.r, 12);
    near(scaled.via.hole, 4.5);
    near(scaled.traces[0].width, 9);
    near(scaled.traces[1].points[0].x, anchor.x + (-30 - anchor.x) * 1.5);
    near(scaled.traces[2].points[0].x, anchor.x + (90 - anchor.x) * 1.5);
    assert.deepEqual(scaled.traces[1].points[1], before.traces[1].points[1]);
    assert.equal(scaled.history, before.history + 1);
    assert.equal(
      await page.evaluate(
        () =>
          Connectivity.byKey.get(pinKey(State.components[0], State.components[0].pins[0])) ===
          Connectivity.byKey.get("t" + State.traces[1].id),
      ),
      true,
    );
    if (rotation === 90) await page.screenshot({ path: path.join(out, "mixed-group-resize.png") });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(await page.evaluate(() => snapshot()), before.doc);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    assert.equal(await page.evaluate(() => snapshot()), scaled.doc);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await marqueeGroup();
    const a = await screen(corner),
      b = await screen({ x: corner.x + 20, y: corner.y + 20 });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await page.evaluate(() => snapshot()), before.doc);
    assert.equal(await page.evaluate(() => History.past.length), before.history);
  }
  // Rectangular copper can scale independently along X/Y; Shift retains proportions.
  await page.evaluate(() =>
    change(() => {
      State.vias = [];
      State.traces = [];
      State.components = [-45, 45].map((x, i) => {
        const c = makeComponent("free", { w: 2, h: 1, pinList: [] }, x, 0, "U", 1);
        c.rot = i * 90;
        c.pins = [{ num: "1", x: 15, y: 0, w: 6, h: 4, shape: "rect", tht: false }];
        return c;
      });
    }),
  );
  for (const rotation of [90, 270])
    for (const shift of [false, true]) {
      await page.evaluate((r) => {
        setTool("select");
        View.rotation = r;
        View.zoom = 2;
        View.panX = View.width / 2;
        View.panY = View.height / 2;
      }, rotation);
      await marqueeGroup(["component", "component"]);
      const before = await page.evaluate(() => ({
        doc: snapshot(),
        c: structuredClone(State.components),
        corners: selectionResizeCorners(),
        history: History.past.length,
      }));
      const anchor = before.corners[0],
        corner = before.corners[2];
      await drag(
        corner,
        { x: anchor.x + (corner.x - anchor.x) * 1.5, y: anchor.y + (corner.y - anchor.y) * 2 },
        shift ? ["Shift"] : [],
      );
      const resized = await page.evaluate(() => ({
        c: State.components,
        corners: selectionResizeCorners(),
        history: History.past.length,
      }));
      near(resized.corners[0].x, anchor.x);
      near(resized.corners[0].y, anchor.y);
      near(resized.c[0].body.w, before.c[0].body.w * (shift ? 2 : 1.5));
      near(resized.c[0].body.h, before.c[0].body.h * 2);
      near(resized.c[1].body.w, before.c[1].body.w * 2);
      near(resized.c[1].body.h, before.c[1].body.h * (shift ? 2 : 1.5));
      assert.equal(resized.c[1].rot, 90);
      assert.equal(resized.history, before.history + 1);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(await page.evaluate(() => snapshot()), before.doc);
    }
  console.log(
    "PASS: mixed marquee/resize at four rotations, free X/Y and Shift group resize, shared bounds/anchors/Undo/cancel, 48-pin through array and surface previews, numbering, inner-layer tracing, per-pin spans, barrel resize, layer reorder and save/reopen.",
  );
};
