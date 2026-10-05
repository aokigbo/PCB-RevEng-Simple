const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
module.exports = async ({ page, out, clickWorld }) => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.03, `${a} != ${b}`);
  const nearPoint = (a, b) => {
    near(a.x, b.x);
    near(a.y, b.y);
  };
  async function screen(p) {
    return page.evaluate((p) => {
      const q = worldToScreen(p.x, p.y),
        r = View.canvas.getBoundingClientRect();
      return { x: q.x + r.left, y: q.y + r.top };
    }, p);
  }
  async function hover(p) {
    const q = await screen(p);
    await page.mouse.move(q.x, q.y);
  }
  async function drag(a, b, shift = false) {
    const s = await screen(a),
      t = await screen(b);
    await page.mouse.move(s.x, s.y);
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.down();
    await page.mouse.move(t.x, t.y, { steps: 8 });
    await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
  }
  const state = () =>
    page.evaluate(() => ({ doc: JSON.parse(snapshot()), past: History.past.length }));
  const selection = () =>
    page.evaluate(() =>
      selectionItems().map((s) => ({
        type: s.type,
        id: s.object.id,
        ...(s.index === undefined ? {} : { index: s.index }),
      })),
    );
  const corners = () => page.evaluate(() => selectionResizeCorners());
  const pin = async (c, i) =>
    page.evaluate(
      ([c, i]) => pinWorldPos(State.components[c], State.components[c].pins[i]),
      [c, i],
    );
  async function labels() {
    return page.evaluate(() => {
      const text = [],
        ctx = View.ctx,
        draw = ctx.fillText;
      ctx.fillText = function (s, ...args) {
        text.push(s);
        draw.call(this, s, ...args);
      };
      try {
        renderCanvas();
      } finally {
        ctx.fillText = draw;
      }
      return text;
    });
  }
  async function fixture() {
    // Load a normal project fixture through Open; all interactions under test use the UI.
    await page.evaluate(() => {
      const body = { w: 10, h: 6 },
        pins = [
          { num: "1", name: "", xmm: -2, ymm: 0, w: 1.6, h: 1, shape: "rect", tht: false },
          {
            num: "2",
            name: "Sensor Ground",
            netName: "GND",
            xmm: 2,
            ymm: 0,
            w: 1.6,
            h: 1,
            shape: "rect",
            tht: false,
          },
        ];
      const a = {
        id: 1,
        ref: "R1",
        value: "10k",
        footprint: "Generic",
        kicad: "",
        x: -180,
        y: 0,
        rot: 0,
        side: "front",
        body,
        pins,
      };
      const b = structuredClone(a);
      b.id = 2;
      b.ref = "R2";
      b.x = 60;
      b.pins.forEach((p) => {
        delete p.netName;
        p.name = "";
      });
      const c = structuredClone(b);
      c.id = 3;
      c.ref = "U1";
      c.x = 260;
      c.y = 160;
      c.rot = 37;
      c.side = "back";
      c.body = { w: 14, h: 10 };
      c.pins = [
        {
          num: "1",
          name: "CAN_H",
          netName: "BUS",
          xmm: -3,
          ymm: -3,
          w: 1.6,
          h: 1.6,
          shape: "circle",
          tht: true,
          hole: 0.7,
        },
        { num: "2", name: "CAN_L", xmm: 3, ymm: 3, w: 1.5, h: 1, shape: "rect", tht: false },
      ];
      // Fixture uses 10 world pixels per mm.
      const pos = (c, p) => {
        const a = (c.rot * Math.PI) / 180,
          x = p.xmm * 10 * (c.side === "back" ? -1 : 1),
          y = p.ymm * 10;
        return {
          x: c.x + x * Math.cos(a) - y * Math.sin(a),
          y: c.y + x * Math.sin(a) + y * Math.cos(a),
        };
      };
      const traces = [
        {
          id: 4,
          side: "front",
          width: 2,
          points: [pos(a, pins[1]), { x: -70, y: 80 }, pos(b, b.pins[0])],
        },
        { id: 5, side: "back", width: 2, points: [pos(c, c.pins[1]), { x: 280, y: 250 }] },
      ];
      testFiles.text = JSON.stringify({
        app: "pcb-reveng-simple",
        version: 1,
        name: "Selection fixture",
        pxPerMm: 10,
        calibrated: true,
        nextId: 7,
        layers: [],
        components: [a, b, c],
        traces,
        vias: [{ id: 6, x: -70, y: 80, r: 4, hole: 2 }],
      });
      testFiles.modified++;
    });
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.waitForFunction(
      () =>
        State.name === "Selection fixture" &&
        State.components.length === 3 &&
        History.past.length === 0 &&
        !ProjectFile.busy,
    );
    assert.equal(await page.evaluate(() => State.components.some((c) => "kicad" in c)), false);
    await page.locator("[data-view=both]").click();
    const zoom = await page.evaluate(() => View.zoom);
    const canvas = await page.locator("#canvas").boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.wheel(0, 450);
    await page.waitForFunction((zoom) => View.zoom < zoom, zoom);
    assert.equal(await page.evaluate(() => Editor.clipboard), null);
  }
  await fixture();
  // Start outside the body and surround only the left pad, not the whole body.
  await drag({ x: -245, y: -20 }, { x: -190, y: 20 });
  assert.deepEqual(await selection(), [{ type: "pad", id: 1, index: 0 }]);
  assert.equal((await state()).past, 0);
  await page.locator("[data-tool=select]").click();
  await drag({ x: -245, y: -20 }, { x: -202, y: 20 });
  assert.deepEqual(await selection(), []); // touching only part of a pad isn't containment
  await drag({ x: -240, y: -40 }, { x: -120, y: 40 });
  assert.deepEqual(await selection(), [{ type: "component", id: 1 }]);
  assert.ok((await labels()).includes("Sensor Ground | 2"));
  // A single component moves its attached endpoint, but not the bend or its neighbour.
  const singleBefore = await state();
  await drag({ x: -180, y: -20 }, { x: -160, y: 0 });
  const singleAfter = await state();
  near(singleAfter.doc.components[0].x, singleBefore.doc.components[0].x + 20);
  nearPoint(singleAfter.doc.traces[0].points[0], {
    x: singleBefore.doc.traces[0].points[0].x + 20,
    y: 20,
  });
  assert.deepEqual(singleAfter.doc.traces[0].points[1], singleBefore.doc.traces[0].points[1]);
  assert.deepEqual(singleAfter.doc.components[1], singleBefore.doc.components[1]);
  await page.keyboard.press("Control+z");
  assert.deepEqual((await state()).doc, singleBefore.doc);
  // The region includes a trace and via; marquee still selects only components/pads.
  await drag({ x: -250, y: -70 }, { x: 130, y: 100 });
  assert.deepEqual(await selection(), [
    { type: "component", id: 1 },
    { type: "component", id: 2 },
  ]);
  assert.equal((await corners()).length, 0);
  assert.equal(await page.locator("#inspector h2").innerText(), "2 items selected");
  assert.ok(!(await labels()).includes("Sensor Ground | 2"));
  const groupBefore = await state();
  const gp = await screen({ x: -180, y: -20 }),
    gt = await screen({ x: -140, y: -40 });
  await page.mouse.move(gp.x, gp.y);
  await page.mouse.down();
  await page.mouse.move(gt.x, gt.y, { steps: 8 });
  await page.mouse.up();
  const groupAfter = await state();
  for (let i = 0; i < 2; i++) {
    near(groupAfter.doc.components[i].x, groupBefore.doc.components[i].x + 40);
    near(groupAfter.doc.components[i].y, groupBefore.doc.components[i].y - 20);
  }
  for (const i of [0, 2])
    nearPoint(groupAfter.doc.traces[0].points[i], {
      x: groupBefore.doc.traces[0].points[i].x + 40,
      y: groupBefore.doc.traces[0].points[i].y - 20,
    });
  assert.deepEqual(groupAfter.doc.traces[0].points[1], groupBefore.doc.traces[0].points[1]);
  assert.equal(groupAfter.past, groupBefore.past + 1);
  await page.keyboard.press("Control+z");
  assert.deepEqual((await state()).doc, groupBefore.doc);
  await page.keyboard.press("Control+Shift+z");
  assert.deepEqual((await state()).doc, groupAfter.doc);
  await page.keyboard.press("Control+z");
  // Copy a connected component, preserve its metadata, and start the copy unnamed.
  await drag({ x: -240, y: -40 }, { x: -120, y: 40 });
  const copyBefore = await state();
  await page.keyboard.press("Control+c");
  assert.deepEqual(await state(), copyBefore);
  await hover({ x: -120, y: -160 });
  await page.keyboard.press("Control+v");
  const pasted = await state(),
    copy = pasted.doc.components.at(-1),
    original = copyBefore.doc.components[0];
  assert.notEqual(copy.id, original.id);
  assert.notEqual(copy.ref, original.ref);
  assert.equal(copy.value, original.value);
  assert.equal(copy.footprint, original.footprint);
  assert.deepEqual(copy.body, original.body);
  assert.deepEqual(
    copy.pins,
    original.pins.map((p) => {
      const q = { ...p };
      delete q.netName;
      return q;
    }),
  );
  assert.deepEqual(pasted.doc.traces, copyBefore.doc.traces);
  assert.equal(pasted.past, copyBefore.past + 1);
  near(copy.x, -120);
  near(copy.y, -160);
  assert.equal(await page.evaluate(() => Connectivity.issues.length), 0);
  await page.keyboard.press("Control+z");
  assert.deepEqual((await state()).doc, copyBefore.doc);
  await page.keyboard.press("Control+Shift+z");
  assert.deepEqual((await state()).doc, pasted.doc);
  // Pad copy via Cmd shortcuts, into a rotated/back-side parent at the cursor.
  await clickWorld(...Object.values(await pin(2, 0)));
  const padBefore = await state();
  await page.keyboard.press("Meta+c");
  await hover({ x: 280, y: -120 });
  await page.keyboard.press("Meta+v");
  const padAfter = await state(),
    newPad = padAfter.doc.components[2].pins.at(-1),
    oldPad = padBefore.doc.components[2].pins[0];
  assert.equal(padAfter.doc.components.length, padBefore.doc.components.length);
  assert.notEqual(newPad.num, oldPad.num);
  assert.equal(newPad.name, "CAN_H");
  for (const key of ["shape", "w", "h", "tht", "hole"]) assert.equal(newPad[key], oldPad[key]);
  assert.equal(newPad.netName, undefined);
  nearPoint(await pin(2, 2), { x: 280, y: -120 });
  assert.equal(padAfter.past, padBefore.past + 1);
  await page.keyboard.press("Meta+z");
  assert.deepEqual((await state()).doc, padBefore.doc);
  // Reset and select two bodies plus a standalone pad inside a third body.
  await fixture();
  await drag({ x: -250, y: -70 }, { x: 270, y: 180 });
  assert.deepEqual(await selection(), [
    { type: "component", id: 1 },
    { type: "component", id: 2 },
    { type: "pad", id: 3, index: 1 },
  ]);
  await page.screenshot({ path: path.join(out, "group-selection.png") });
  const mixedBefore = await state(),
    bp = await pin(2, 1);
  await drag({ x: -180, y: -20 }, { x: -165, y: -10 });
  nearPoint(await pin(2, 1), { x: bp.x + 15, y: bp.y + 10 });
  const mixedAfter = await state();
  assert.deepEqual(mixedAfter.doc.traces[1].points[1], mixedBefore.doc.traces[1].points[1]);
  nearPoint(mixedAfter.doc.traces[1].points[0], { x: bp.x + 15, y: bp.y + 10 });
  assert.equal(mixedAfter.doc.components[2].x, mixedBefore.doc.components[2].x);
  await page.keyboard.press("Control+c");
  await hover({ x: 0, y: -80 });
  await page.keyboard.press("Control+v");
  const mixedPaste = await state();
  assert.equal(mixedPaste.doc.components.length, 5);
  assert.equal(mixedPaste.doc.components[2].pins.length, 3);
  assert.equal((await selection()).length, 3);
  assert.equal(mixedPaste.past, mixedAfter.past + 1);
  near(mixedPaste.doc.components[4].x - mixedPaste.doc.components[3].x, 240);
  assert.deepEqual(mixedPaste.doc.traces, mixedAfter.doc.traces);
  await page.keyboard.press("Delete");
  const deleted = await state();
  assert.equal(deleted.doc.components.length, 3);
  assert.equal(deleted.doc.components[2].pins.length, 2);
  assert.deepEqual(deleted.doc.traces, mixedAfter.doc.traces);
  assert.equal(deleted.past, mixedPaste.past + 1);
  await page.keyboard.press("Control+z");
  assert.deepEqual((await state()).doc, mixedPaste.doc);
  // Resize both a body and a pad; then repeat with Shift from their original geometry.
  await fixture();
  await drag({ x: -240, y: -40 }, { x: -120, y: 40 });
  const resizeBefore = await state(),
    oldCorners = await corners(),
    target = { x: -110, y: 40 };
  await drag(oldCorners[2], target);
  let bodyAfter = await state();
  nearPoint((await corners())[0], oldCorners[0]);
  nearPoint((await corners())[2], target);
  assert.deepEqual(bodyAfter.doc.components[0].pins, resizeBefore.doc.components[0].pins);
  assert.deepEqual(bodyAfter.doc.traces, resizeBefore.doc.traces);
  assert.notEqual(bodyAfter.doc.components[0].body.w / bodyAfter.doc.components[0].body.h, 10 / 6);
  await page.keyboard.press("Control+z");
  await drag({ x: -240, y: -40 }, { x: -120, y: 40 });
  await drag((await corners())[2], target, true);
  bodyAfter = await state();
  near(bodyAfter.doc.components[0].body.w / bodyAfter.doc.components[0].body.h, 10 / 6);
  nearPoint((await corners())[0], oldCorners[0]);
  assert.equal(bodyAfter.past, resizeBefore.past + 1);
  await page.getByRole("button", { name: "Pad 2", exact: true }).click();
  const padResizeBefore = await state(),
    padCorners = await corners(),
    padTarget = { x: -142, y: 16 };
  await drag(padCorners[2], padTarget);
  let resizedPad = await state();
  nearPoint((await corners())[0], padCorners[0]);
  nearPoint((await corners())[2], padTarget);
  nearPoint(resizedPad.doc.traces[0].points[0], await pin(0, 1));
  assert.notDeepEqual(resizedPad.doc.traces[0].points[0], padResizeBefore.doc.traces[0].points[0]);
  assert.deepEqual(resizedPad.doc.traces[0].points[1], padResizeBefore.doc.traces[0].points[1]);
  assert.equal(resizedPad.past, padResizeBefore.past + 1);
  await page.keyboard.press("Control+z");
  const p = await pin(0, 1);
  await clickWorld(p.x, p.y);
  await drag((await corners())[2], padTarget, true);
  resizedPad = await state();
  near(resizedPad.doc.components[0].pins[1].w / resizedPad.doc.components[0].pins[1].h, 1.6);
  nearPoint((await corners())[0], padCorners[0]);
  nearPoint(resizedPad.doc.traces[0].points[0], await pin(0, 1));
  assert.deepEqual(resizedPad.doc.traces[0].points[1], padResizeBefore.doc.traces[0].points[1]);
  await page.screenshot({ path: path.join(out, "anchored-pad-label.png") });
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => !isDirty());
  const saved = (await state()).doc;
  await page.getByRole("button", { name: "New", exact: true }).click();
  assert.equal(await page.evaluate(() => Editor.clipboard), null);
  await page.keyboard.press("Control+v");
  assert.equal(await page.evaluate(() => State.components.length), 0);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.waitForFunction(() => State.components.length === 3 && !ProjectFile.busy);
  assert.deepEqual((await state()).doc, saved);
  await page.locator("#export-menu summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "AI package" }).click();
  await (await download).saveAs(path.join(out, "Selection-AI.zip"));
  const zip = require("../vendor/fflate-0.8.3.js").unzipSync(
    new Uint8Array(await fs.readFile(path.join(out, "Selection-AI.zip"))),
  );
  const graph = JSON.parse(require("../vendor/fflate-0.8.3.js").strFromU8(zip["graph.json"]));
  assert.ok(graph.nets.some((n) => n.name === "GND"));
  assert.ok(graph.components.some((c) => c.reference === "R1"));
  console.log(
    "PASS: full-containment marquee, mixed groups, anchored endpoints, Ctrl/Cmd copy/paste, net stripping, multi-delete, opposite-corner/Shift resize, pin labels and save/reopen.",
  );
};
