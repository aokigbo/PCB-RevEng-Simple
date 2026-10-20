const assert = require("node:assert/strict");
module.exports = async ({ page, tiff, freshFolder }) => {
  // Suppress viewport requests to distinguish importing from genuinely demanded tiles.
  await page.evaluate(() => {
    window.sparseTileView = Tiles.view;
    Tiles.clear();
    Tiles.view = () => {};
  });
  await freshFolder();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.waitForFunction(() => !ProjectFile.busy);
  async function add(bytes, name = "sparse.tif") {
    return page.evaluate(
      async ({ base64, name }) => {
        const file = new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name),
          id = reserveId(),
          m = await prepareScanAsset(file, id, () => {}),
          scan = {
            id,
            layerId: 1,
            name,
            sourceName: name,
            width: m.width,
            height: m.height,
            tileSize: 512,
            maxLogicalLevel: m.maxLogicalLevel,
            assetMode: "tiff-source",
            flipX: false,
            flipY: false,
            aligned: true,
            transform: { tx: 0, ty: 0, scale: 1, rotation: 0 },
          };
        change(() => {
          State.nextId = Math.max(State.nextId, id + 1);
          State.scans.push(scan);
        });
        return { id, manifest: m };
      },
      { base64: bytes.toString("base64"), name },
    );
  }
  async function request(id, level, x = 0, y = 0) {
    return page.evaluate(
      async ({ id, level, x, y }) => {
        const scan = State.scans.find((s) => s.id === id),
          img = await ImageEngine.tile(tileSpec(scan, level, x, y)),
          canvas = new OffscreenCanvas(img.width, img.height),
          ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const result = {
          width: img.width,
          height: img.height,
          pixel: Array.from(
            ctx.getImageData(Math.min(1, img.width - 1), Math.min(1, img.height - 1), 1, 1).data,
          ),
        };
        img.close();
        return result;
      },
      { id, level, x, y },
    );
  }
  async function waitDisk(id, level, x = 0, y = 0) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const ready = await page.evaluate(
        async ({ id, level, x, y }) => {
          try {
            const dir = await (
              await (await scanDirectory(id)).getDirectoryHandle("cache-v1")
            ).getDirectoryHandle("L" + level);
            return (await (await dir.getFileHandle(x + "_" + y + ".png")).getFile()).size > 0;
          } catch {
            return false;
          }
        },
        { id, level, x, y },
      );
      if (ready) return;
      await page.waitForTimeout(50);
    }
    throw Error(
      "Derived tile was not persisted: " +
        JSON.stringify({ id, level, x, y }) +
        "; " +
        (await page.locator("#toast").textContent()),
    );
  }
  const asset = await add(tiff(4097, 2049, { compression: 8, metadataPadding: 8192 })),
    before = await page.evaluate(() => snapshot());
  assert.equal((await request(asset.id, 3)).width, 512);
  await waitDisk(asset.id, 3);
  assert.deepEqual(
    await page.evaluate(async (id) => {
      const dir = await (await scanDirectory(id)).getDirectoryHandle("cache-v1"),
        names = [];
      for await (const [name] of dir.entries()) names.push(name);
      return names;
    }, asset.id),
    ["L3"],
  );
  const statsBefore = await page.evaluate(() => ({ ...TileStats }));
  await request(asset.id, 3);
  const statsAfter = await page.evaluate(() => ({ ...TileStats }));
  assert.equal(statsAfter.sourceMisses, statsBefore.sourceMisses);
  assert.equal(statsAfter.diskHits, statsBefore.diskHits + 1);
  await page.evaluate(async (id) => {
    const scan = State.scans.find((s) => s.id === id);
    let calls = 0;
    const loader = new TileLoader(
      (s, signal) => {
        calls++;
        return ImageEngine.tile(s, signal);
      },
      () => {},
    );
    const spec = tileSpec(scan, 3, 0, 0);
    loader.view([spec]);
    while (loader.active) await new Promise((r) => setTimeout(r, 10));
    loader.view([spec]);
    await new Promise((r) => setTimeout(r, 20));
    if (calls !== 1) throw Error("memory miss on repeated tile");
    loader.clear();
  }, asset.id);
  const native = await request(asset.id, 0, 3, 2);
  assert.deepEqual(native.pixel, [1, 1, 2, 255]);
  await waitDisk(asset.id, 0, 3, 2);
  await page.evaluate(
    (id) => clearDerivedImageCache(State.scans.find((s) => s.id === id)),
    asset.id,
  );
  const entries = await page.evaluate(async (id) => {
    const names = [];
    for await (const [name] of (await scanDirectory(id)).entries()) names.push(name);
    return names.sort();
  }, asset.id);
  assert.deepEqual(entries, ["manifest.json", "source.tif"]);
  assert.equal(await page.evaluate(() => snapshot()), before);
  await request(asset.id, 0, 0, 0);
  await waitDisk(asset.id, 0);
  // Persisting is optional: simulate a filesystem that denies only derived PNG writes.
  await page.route("**/js/tile-worker.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `\nconst originalWritable=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=async function(...args){if(this.name.endsWith('.png'))throw new DOMException('Read-only cache','NotAllowedError');return originalWritable.apply(this,args);};`,
    });
  });
  await page.evaluate(() => {
    ImageEngine.reset();
    window.cacheWarnings = 0;
    window.savedNotify = notify;
    notify = (s, ...args) => {
      if (s.startsWith("Derived image cache")) cacheWarnings++;
      savedNotify(s, ...args);
    };
    ProjectFile.cacheWarning = false;
  });
  assert.equal((await request(asset.id, 0, 1, 0)).width, 512);
  await page.waitForFunction(() => cacheWarnings === 1);
  await request(asset.id, 0, 2, 0);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => cacheWarnings), 1);
  assert.equal(await page.evaluate(() => snapshot()), before);
  await page.evaluate(() => {
    ImageEngine.reset();
    notify = window.savedNotify;
  });
  await page.unroute("**/js/tile-worker.js");
  // The presence of a cached PNG must never hide a changed/missing source TIFF.
  const changed = await page.evaluate(async (id) => {
    const dir = await scanDirectory(id),
      w = await (await dir.getFileHandle("source.tif")).createWritable();
    await w.write(new Uint8Array([73, 73, 42, 0]));
    await w.close();
    try {
      await ImageEngine.tile(
        tileSpec(
          State.scans.find((s) => s.id === id),
          0,
          0,
          0,
        ),
      );
      return "no error";
    } catch (e) {
      return e.message;
    }
  }, asset.id);
  assert.match(changed, /changed unexpectedly/);
  await page.evaluate((id) => {
    const scan = State.scans.find((s) => s.id === id),
      spec = tileSpec(scan, 0, 0, 0);
    Tiles.cache.set(spec.key, { width: 1, height: 1, close() {} }, 4);
    ImageEngine.checked.clear();
    ImageEngine.verifySource(scan);
  }, asset.id);
  await page.waitForFunction((id) => Tiles.unavailable.has(id), asset.id);
  assert.equal(
    await page.evaluate(
      (id) =>
        [...Tiles.cache.entries.keys()].some((k) =>
          k.startsWith(ProjectFile.epoch + "/" + id + "/"),
        ),
      asset.id,
    ),
    false,
  );
  await page.evaluate(async (id) => {
    await (await scanDirectory(id)).removeEntry("source.tif");
    change(() =>
      State.traces.push({
        id: nextId(),
        layerId: 1,
        width: 1,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      }),
    );
    await saveProject();
    await openProject();
  }, asset.id);
  assert.equal(await page.evaluate(() => State.traces.length), 1);
  assert.equal(await page.evaluate(() => State.scans.length), 1);
  assert.match(await page.locator("#toast").textContent(), /unavailable/);
  await freshFolder();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.waitForFunction(() => !ProjectFile.busy);
  const overview = await add(
    tiff.withPages([
      [1025, 769],
      [1025, 769],
      [513, 385],
      [257, 193],
    ]),
    "overview.tif",
  );
  assert.deepEqual(
    overview.manifest.sourceOverviews.map((o) => [o.page, o.level]),
    [
      [2, 1],
      [3, 2],
    ],
  );
  assert.deepEqual((await request(overview.id, 2)).pixel, [1, 1, 2, 255]);
  const sub = await add(
    tiff.withPages(
      [
        [1025, 769],
        [513, 385],
      ],
      { subIFDs: true },
    ),
    "subifd.tif",
  );
  assert.ok(sub.manifest.sourceOverviews[0].offset);
  assert.deepEqual((await request(sub.id, 1)).pixel, [1, 1, 2, 255]);
  await page.evaluate(() => {
    Tiles.view = window.sparseTileView;
    requestRender();
  });
  console.log(
    "PASS: direct L3 generation without children, sparse persistence/disk reuse/memory reuse, native pixels, clear/regenerate, optional cache writes, source identity/missing source, TIFF page and SubIFD overview selection.",
  );
};
