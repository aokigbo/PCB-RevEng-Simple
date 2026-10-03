// Run against npm start: NODE_PATH=/path/to/playwright/node_modules node tests/browser.cjs
// File pickers use deterministic handles; every edit below goes through browser UI.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => {
    window.testFiles = { text: "", picks: 0, writes: 0, modified: 1 };
    const handle = {
      name: "Amplifier.pcbrev",
      getFile: async () => ({
        lastModified: testFiles.modified,
        size: testFiles.text.length,
        text: async () => testFiles.text,
      }),
      createWritable: async () => ({
        write: async (text) => {
          testFiles.text = text;
          testFiles.writes++;
        },
        close: async () => {
          testFiles.modified++;
        },
        abort: async () => {},
      }),
    };
    window.showSaveFilePicker = async () => {
      testFiles.picks++;
      return handle;
    };
    window.showOpenFilePicker = async () => [handle];
  });
  const out = process.env.TEST_OUTPUT || "test-results";
  await fs.mkdir(out, { recursive: true });
  try {
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:8080");
    await page.waitForSelector("#inspector h2");
    await page.screenshot({ path: path.join(out, "empty.png") });
    const imageURL = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1000;
      c.height = 650;
      const x = c.getContext("2d");
      x.fillStyle = "#165347";
      x.fillRect(0, 0, 1000, 650);
      x.strokeStyle = "#799b71";
      x.lineWidth = 12;
      x.strokeRect(45, 45, 910, 560);
      x.fillStyle = "#e5b965";
      for (const [a, b] of [
        [100, 100],
        [900, 100],
        [100, 550],
        [900, 550],
      ]) {
        x.beginPath();
        x.arc(a, b, 16, 0, Math.PI * 2);
        x.fill();
      }
      x.fillStyle = "#c9e7bc";
      x.font = "20px sans-serif";
      x.fillText("REV A   ·   AMPLIFIER", 100, 590);
      x.font = "14px sans-serif";
      x.fillText("TEST FIXTURE — SYNTHETIC BOARD PHOTO", 100, 620);
      return c.toDataURL("image/png");
    });
    const backURL = await page.evaluate(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext("2d");
      x.translate(c.width, 0);
      x.scale(-1, 1);
      x.drawImage(img, 0, 0);
      return c.toDataURL("image/png");
    }, imageURL);
    const photo = {
      name: "front.png",
      mimeType: "image/png",
      buffer: Buffer.from(imageURL.split(",")[1], "base64"),
    };
    async function upload(side) {
      if (side === "back") await page.locator("[data-tool=select]").click();
      const chooser = page.waitForEvent("filechooser");
      await page
        .getByRole("button", { name: "Add " + side + " photo", exact: true })
        .first()
        .click();
      await (
        await chooser
      ).setFiles({
        ...photo,
        name: side + ".png",
        buffer: Buffer.from((side === "back" ? backURL : imageURL).split(",")[1], "base64"),
      });
      await page.waitForFunction((side) => State.layers.some((l) => l.side === side), side);
    }
    async function clickWorld(x, y) {
      const p = await page.evaluate(
        ({ x, y }) => {
          const p = worldToScreen(x, y),
            r = View.canvas.getBoundingClientRect();
          return { x: p.x + r.left, y: p.y + r.top };
        },
        { x, y },
      );
      await page.mouse.click(p.x, p.y);
    }
    async function setField(label, value) {
      await page.getByLabel(label, { exact: true }).fill(String(value));
      await page.getByLabel(label, { exact: true }).press("Tab");
    }
    await upload("front");
    await upload("back");
    await page.locator("[data-tool=measure]").click();
    await page.getByRole("button", { name: "Set scale · two points" }).click();
    await clickWorld(-100, 0);
    await clickWorld(100, 0);
    await setField("Known distance (mm)", 20);
    await page.getByRole("button", { name: "Apply scale" }).click();
    assert.ok(Math.abs((await page.evaluate(() => State.pxPerMm)) - 10) < 0.02);
    await page.getByRole("button", { name: "Align front & back" }).click();
    await clickWorld(-400, -225);
    await clickWorld(400, -225);
    await clickWorld(-400, -225);
    await clickWorld(400, -225);
    await page.getByRole("button", { name: "Apply alignment" }).click();
    assert.ok(
      await page.evaluate(() => {
        const a = imageToWorld(State.layers[0], { x: 100, y: 100 }),
          b = imageToWorld(State.layers[1], { x: 900, y: 100 });
        return Math.hypot(a.x - b.x, a.y - b.y) < 3;
      }),
    );
    await page.locator("[data-view=front]").click();
    await page.locator("[data-tool=component]").click();
    await page.getByLabel("Size", { exact: true }).selectOption("1206");
    await clickWorld(-150, 0);
    await clickWorld(150, 0);
    await page.locator("[data-tool=select]").click();
    await clickWorld(-150, 0);
    await setField("Value", "10k");
    const endpoints = await page.evaluate(() => [
      pinWorldPos(State.components[0], State.components[0].pins[1]),
      pinWorldPos(State.components[1], State.components[1].pins[0]),
    ]);
    await page.locator("[data-tool=trace]").click();
    await clickWorld(endpoints[0].x, endpoints[0].y);
    await clickWorld(0, 50);
    await clickWorld(endpoints[1].x, endpoints[1].y);
    assert.equal(await page.evaluate(() => State.traces.length), 1);
    await page.locator("[data-tool=via]").click();
    await clickWorld(0, 50);
    assert.equal(await page.evaluate(() => State.vias.length), 1);
    await page.locator("[data-tool=select]").click();
    await clickWorld(0, 50);
    await setField("Net name", "GND");
    await page.locator("[data-view=back]").click();
    await page.locator("[data-tool=trace]").click();
    await clickWorld(0, 50);
    await clickWorld(0, 150);
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => Connectivity.byKey.get("t" + State.traces[1].id).name),
      "GND",
    );
    await page.locator("[data-view=front]").click();
    await page.locator("[data-tool=component]").click();
    await page.getByLabel("Component", { exact: true }).selectOption("custom");
    await clickWorld(-200, -150);
    await page.locator("[data-tool=select]").click();
    await clickWorld(-200, -150);
    await page.getByRole("button", { name: "Add pad", exact: true }).click();
    await clickWorld(-200, -150);
    await setField("Width (mm)", 2);
    await setField("Height (mm)", 1.2);
    assert.equal(await page.evaluate(() => State.components.at(-1).pins.length), 1);
    await setField("Project name", "Amplifier Board");
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => !isDirty());
    assert.equal(await page.evaluate(() => testFiles.picks), 1);
    await page.getByLabel("Project name", { exact: true }).fill("Amplifier");
    assert.equal(await page.locator("#save-state").innerText(), "Unsaved");
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => !isDirty());
    assert.equal(await page.evaluate(() => testFiles.picks), 1);
    assert.equal(await page.evaluate(() => testFiles.writes), 2);
    // Delete the via, then verify undo and redo change cross-side connectivity.
    await page.locator("[data-tool=select]").click();
    await clickWorld(0, 50);
    await page.keyboard.press("Delete");
    assert.equal(await page.evaluate(() => State.vias.length), 0);
    await page.keyboard.press("Control+z");
    assert.equal(await page.evaluate(() => State.vias.length), 1);
    await page.keyboard.press("Control+Shift+z");
    assert.equal(await page.evaluate(() => State.vias.length), 0);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => !isDirty());
    const saved = await page.evaluate(() => testFiles.text);
    await fs.writeFile(path.join(out, "Amplifier.pcbrev"), saved);
    await page.getByRole("button", { name: "New", exact: true }).click();
    assert.equal(await page.evaluate(() => State.components.length), 0);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.waitForFunction(() => State.components.length === 3);
    assert.equal(await page.evaluate(() => State.layers.length), 2);
    assert.equal(await page.evaluate(() => Connectivity.issues.length), 0);
    assert.equal(await page.evaluate(() => isDirty()), false);
    await page.locator("[data-view=both]").click();
    await page.locator("#export-menu summary").click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "KiCad netlist (.net)" }).click();
    await (await download).saveAs(path.join(out, "Amplifier.net"));
    const netlist = await fs.readFile(path.join(out, "Amplifier.net"), "utf8");
    assert.match(netlist, /GND/);
    assert.match(netlist, /\(ref R1\)/);
    await clickWorld(0, 50);
    await page.screenshot({ path: path.join(out, "workspace.png") });
    await require("./browser-resize.cjs")({ page, out, clickWorld, setField });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: photo import, calibration, alignment, placement, trace/via connectivity, custom pads, naming, undo/redo, save/reopen, KiCad netlist, no browser errors.",
    );
  } catch (err) {
    console.error("Browser errors:", errors);
    await page.screenshot({ path: path.join(out, "failure.png") });
    throw err;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
