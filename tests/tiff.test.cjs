const test = require("node:test");
const assert = require("node:assert/strict");
const GeoTIFF = require("../vendor/geotiff-3.0.4.js");
const tiff = require("./tiff-fixture.cjs");

for (const [name, options, tag, length] of [
  ["strips", {}, "StripByteCounts", 17],
  ["tiles", { tiled: true, compression: 8 }, "TileByteCounts", 9],
  ["BigTIFF strips", { big: true }, "StripByteCounts", 17],
]) {
  test("TIFF regression fixture defers " + name + " metadata", async () => {
    const bytes = tiff(513, 515, { ...options, metadataPadding: 8192 }),
      source = await GeoTIFF.fromArrayBuffer(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      ),
      image = await source.getImage(),
      directory = image.getFileDirectory();
    assert.throws(() => directory.getValue(tag), /is deferred/);
    const counts = await directory.loadValue(tag);
    assert.equal(counts.length, length);
    assert.ok(Array.from(counts).every((n) => n > 0));
  });
}
test("TIFF metadata finds consistent page overviews and ignores unrelated full-size pages", async () => {
  const fs = require("node:fs"),
    vm = require("node:vm");
  const c = vm.createContext({ GeoTIFF, console });
  vm.runInContext(fs.readFileSync("js/image-source.js", "utf8"), c);
  // Metadata uses fromBlob in browsers; adapt only the test's Blob read transport.
  c.GeoTIFF = { ...GeoTIFF, fromBlob: async (b) => GeoTIFF.fromArrayBuffer(await b.arrayBuffer()) };
  c.file = new Blob([
    tiff.withPages([
      [1025, 769],
      [1025, 769],
      [513, 385],
      [257, 193],
    ]),
  ]);
  const result = await vm.runInContext("tiffMetadata(file)", c);
  assert.deepEqual(
    Array.from(result.metadata.sourceOverviews, (o) => [o.page, o.level]),
    [
      [2, 1],
      [3, 2],
    ],
  );
});
test("TIFF metadata recognizes SubIFD overviews", async () => {
  const fs = require("node:fs"),
    vm = require("node:vm"),
    c = vm.createContext({
      GeoTIFF: {
        ...GeoTIFF,
        fromBlob: async (b) => GeoTIFF.fromArrayBuffer(await b.arrayBuffer()),
      },
      console,
    });
  vm.runInContext(fs.readFileSync("js/image-source.js", "utf8"), c);
  c.file = new Blob([
    tiff.withPages(
      [
        [1025, 769],
        [513, 385],
      ],
      { subIFDs: true },
    ),
  ]);
  const result = await vm.runInContext("tiffMetadata(file)", c);
  assert.equal(result.metadata.sourceOverviews.length, 1);
  assert.equal(result.metadata.sourceOverviews[0].level, 1);
  assert.ok(result.metadata.sourceOverviews[0].offset > 0);
});
