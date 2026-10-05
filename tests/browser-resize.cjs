// Direct resizing and its movement/save regressions, driven through the Select UI.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
module.exports = async ({ page, out, clickWorld, setField }) => {
  const near = (actual, expected) =>
    assert.ok(Math.abs(actual - expected) < 0.015, `${actual} != ${expected}`);
  async function screen(p) {
    return page.evaluate((p) => {
      const q = worldToScreen(p.x, p.y),
        r = View.canvas.getBoundingClientRect();
      return { x: q.x + r.left, y: q.y + r.top };
    }, p);
  }
  async function drag(a, b, options = {}) {
    const start = await screen(a),
      end = await screen(b);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down(options);
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up(options);
  }
  const state = () =>
    page.evaluate(() => ({
      components: State.components,
      traces: State.traces,
      vias: State.vias,
      past: History.past.length,
      nets: Connectivity.nets.length,
    }));
  const corners = () => page.evaluate(() => selectionResizeCorners());
  async function selectBody(index = 0) {
    await page.locator("[data-tool=select]").click();
    const p = await page.evaluate(
      (i) =>
        compMmToWorld(
          State.components[i],
          State.components[i].body.xmm || 0,
          (State.components[i].body.ymm || 0) + State.components[i].body.h * 0.45,
        ),
      index,
    );
    await clickWorld(p.x, p.y);
    assert.equal(await page.evaluate(() => Editor.selection?.type), "component");
  }
  async function padCenter(index = 1) {
    return page.evaluate(
      (i) => pinWorldPos(State.components[0], State.components[0].pins[i]),
      index,
    );
  }
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.locator("[data-tool=component]").click();
  await page.getByLabel("Component", { exact: true }).selectOption("smd");
  await clickWorld(-150, -80);
  await page.getByLabel("Component", { exact: true }).selectOption("tht");
  await clickWorld(180, -80);
  await page.locator("[data-tool=trace]").click();
  await clickWorld(-110, -100);
  await clickWorld(-110, -40);
  await page.keyboard.press("Enter");
  await page.locator("[data-tool=via]").click();
  await clickWorld(-110, -40);
  await selectBody();
  assert.equal(await page.getByLabel("Package scale", { exact: true }).count(), 0);
  assert.equal((await corners()).length, 4);
  const before = await state();
  const handle = (await corners())[2];
  const hp = await screen(handle);
  await page.mouse.move(hp.x, hp.y);
  assert.equal(await page.locator("#canvas").evaluate((el) => el.style.cursor), "nwse-resize");
  await drag(handle, { x: -80, y: -40 }); // anchored NW (-5,-2.5), dragged SE (7,4) → 12×6.5 mm
  const resized = await state();
  near(resized.components[0].body.w, 12);
  near(resized.components[0].body.h, 6.5);
  assert.deepEqual(resized.components[0].pins, before.components[0].pins);
  assert.equal(resized.components[0].x, before.components[0].x);
  assert.equal(resized.components[0].y, before.components[0].y);
  assert.deepEqual(resized.traces, before.traces);
  assert.deepEqual(resized.vias, before.vias);
  assert.equal(resized.nets, before.nets);
  assert.equal(resized.past, before.past + 1);
  await page.keyboard.press("Control+z");
  assert.deepEqual((await state()).components, before.components);
  await page.keyboard.press("Control+Shift+z");
  assert.deepEqual((await state()).components, resized.components);
  await selectBody();
  await setField("Body width (mm)", 12.5);
  await setField("Body height (mm)", 7.5);
  const numericBody = await state();
  assert.equal(numericBody.components[0].body.w, 12.5);
  assert.equal(numericBody.components[0].body.h, 7.5);
  assert.deepEqual(numericBody.components[0].pins, before.components[0].pins);
  // Clicking without dragging must neither change dimensions nor add history.
  const still = await state(),
    corner = (await corners())[0];
  await clickWorld(corner.x, corner.y);
  assert.deepEqual(await state(), still);
  // Space and middle-button panning take priority even directly over a handle.
  for (const space of [true, false]) {
    const old = await page.evaluate(() => ({ x: View.panX, y: View.panY, doc: snapshot() }));
    const p = (await corners())[0];
    if (space) await page.keyboard.down("Space");
    await drag(p, { x: p.x + 30, y: p.y + 20 }, space ? {} : { button: "middle" });
    if (space) await page.keyboard.up("Space");
    const next = await page.evaluate(() => ({ x: View.panX, y: View.panY, doc: snapshot() }));
    assert.notEqual(old.x, next.x);
    assert.notEqual(old.y, next.y);
    assert.equal(old.doc, next.doc);
  }
  // Resize a pad into the nearby trace; connectivity only changes on pointer-up.
  await page.getByRole("button", { name: "Pad 2", exact: true }).click();
  const padBefore = await state(),
    pc = await padCenter();
  const start = await screen((await corners())[2]),
    end = await screen({ x: pc.x + 30, y: pc.y + 20 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  assert.equal((await state()).nets, padBefore.nets);
  await page.mouse.up();
  const padAfter = await state();
  const p0 = padBefore.components[0].pins[1],
    p1 = padAfter.components[0].pins[1];
  near(p1.w, 3.75);
  near(p1.h, 2.75);
  near(p1.xmm, p0.xmm + 1.125);
  near(p1.ymm, p0.ymm + 0.625);
  assert.deepEqual(padAfter.traces, padBefore.traces);
  assert.deepEqual(padAfter.components[0].body, padBefore.components[0].body);
  assert.equal(padAfter.past, padBefore.past + 1);
  assert.ok(
    await page.evaluate(
      () =>
        Connectivity.byKey.get(pinKey(State.components[0], State.components[0].pins[1])) ===
        Connectivity.byKey.get("t" + State.traces[0].id),
    ),
  );
  await page.keyboard.press("Control+z");
  assert.deepEqual((await state()).components, padBefore.components);
  assert.equal((await state()).nets, padBefore.nets);
  await page.keyboard.press("Control+Shift+z");
  assert.deepEqual((await state()).components, padAfter.components);
  // Every corner also works after rotating and mirroring the component.
  await selectBody();
  await setField("Rotation (degrees)", 37);
  await page.getByLabel("Side", { exact: true }).selectOption("back");
  assert.equal((await corners()).length, 0);
  await page.locator("[data-view=both]").click();
  for (let i = 0; i < 4; i++) {
    const old = await state();
    const [x, y] = [
      [-8, -5],
      [9, -5],
      [9, 6],
      [-10, 6],
    ][i];
    const target = await page.evaluate(
      ([x, y]) => compMmToWorld(State.components[0], x, y),
      [x, y],
    );
    const oldCorners = await corners();
    await drag(oldCorners[i], target);
    const after = await state(),
      newCorners = await corners();
    near(newCorners[(i + 2) % 4].x, oldCorners[(i + 2) % 4].x);
    near(newCorners[(i + 2) % 4].y, oldCorners[(i + 2) % 4].y);
    near(newCorners[i].x, target.x);
    near(newCorners[i].y, target.y);
    assert.deepEqual(after.components[0].pins, old.components[0].pins);
    assert.deepEqual(after.traces, old.traces);
  }
  await page.screenshot({ path: path.join(out, "resized-body.png") });
  // Interior movement retains pad geometry and moves the component's centre.
  const moveBefore = await state();
  const moveFrom = await page.evaluate(() => compMmToWorld(State.components[0], 0, 4));
  await drag(moveFrom, { x: moveFrom.x + 20, y: moveFrom.y + 15 });
  const moveAfter = await state();
  near(moveAfter.components[0].x, moveBefore.components[0].x + 20);
  near(moveAfter.components[0].y, moveBefore.components[0].y + 15);
  assert.deepEqual(moveAfter.components[0].body, moveBefore.components[0].body);
  assert.deepEqual(moveAfter.components[0].pins, moveBefore.components[0].pins);
  await page.getByRole("button", { name: "Pad 2", exact: true }).click();
  const oldPad = (await state()).components[0].pins[1],
    from = await padCenter();
  const to = await page.evaluate(() => compMmToWorld(State.components[0], 8, 3));
  await drag(from, to);
  const movedPad = (await state()).components[0].pins[1];
  near(movedPad.xmm, 8);
  near(movedPad.ymm, 3);
  assert.equal(movedPad.w, oldPad.w);
  assert.equal(movedPad.h, oldPad.h);
  await page.getByLabel("Pad type", { exact: true }).selectOption("tht");
  await setField("Hole diameter (mm)", 0.8);
  const opposite = (await corners())[2];
  await drag((await corners())[0], opposite);
  const round = (await state()).components[0].pins[1];
  near(round.w, 0.9);
  assert.equal(round.w, round.h);
  assert.equal(round.hole, 0.8);
  await page.getByLabel("Pad type", { exact: true }).selectOption("circle");
  const bigger = await page.evaluate(() => {
    const c = State.components[0],
      p = c.pins[1];
    return compMmToWorld(c, p.xmm - p.w / 2 + 4, p.ymm - p.h / 2 + 2);
  });
  await drag((await corners())[2], bigger);
  const smd = (await state()).components[0].pins[1];
  near(smd.w, 4);
  assert.equal(smd.w, smd.h);
  // Pad handles remain four small screen-space squares after zooming.
  const focus = await screen(await padCenter());
  await page.mouse.move(focus.x, focus.y);
  await page.mouse.wheel(0, -600);
  assert.equal((await corners()).length, 4);
  const at = await screen((await corners())[1]);
  await page.mouse.move(at.x + 4, at.y);
  assert.match(
    await page.locator("#canvas").evaluate((el) => el.style.cursor),
    /^(nwse|nesw)-resize$/,
  );
  // Escape cancels a resize without creating an undo entry.
  const cancelBefore = await state();
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 20, at.y + 20, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual(await state(), cancelBefore);
  // Existing trace vertex dragging remains independent of resize handles.
  await page.locator("[data-view=front]").click();
  const trace = await page.evaluate(() => structuredClone(State.traces[0]));
  await clickWorld(trace.points[0].x, trace.points[0].y);
  const vertex = { x: trace.points[0].x - 20, y: trace.points[0].y - 15 };
  await drag(trace.points[0], vertex);
  const updated = await page.evaluate(() => State.traces[0].points[0]);
  near(updated.x, vertex.x);
  near(updated.y, vertex.y);
  // Persist and reopen the actual resized, rotated, mirrored physical geometry.
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => !isDirty());
  const saved = await state();
  assert.ok(
    await page.evaluate(() => JSON.parse(testFiles.text).components.every((c) => !("scale" in c))),
  );
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.waitForFunction(() => State.components.length === 2);
  const reopened = await state();
  assert.deepEqual(reopened.components, saved.components);
  assert.deepEqual(reopened.traces, saved.traces);
  assert.deepEqual(reopened.vias, saved.vias);
  assert.equal(reopened.nets, saved.nets);
  await page.locator("#export-menu summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "AI package" }).click();
  await (await download).saveAs(path.join(out, "Resized-AI.zip"));
  const zip = require("../vendor/fflate-0.8.3.js").unzipSync(
    new Uint8Array(await fs.readFile(path.join(out, "Resized-AI.zip"))),
  );
  const graph = JSON.parse(require("../vendor/fflate-0.8.3.js").strFromU8(zip["graph.json"]));
  assert.equal(
    graph.components.reduce((n, c) => n + c.pins.length, 0),
    4,
  );
  assert.ok(graph.components.some((c) => c.reference === "U1"));
  assert.ok(graph.components.some((c) => c.reference === "U2"));
  await page.locator("[data-view=both]").click();
  await selectBody();
  await page.getByRole("button", { name: "Pad 2", exact: true }).click();
  await page.screenshot({ path: path.join(out, "resized-pad.png") });
  console.log(
    "PASS: anchored body/pad resizing, all rotated/back corners, fixed drills, undo/redo/cancel, panning, movement, connectivity and save/reopen.",
  );
};
