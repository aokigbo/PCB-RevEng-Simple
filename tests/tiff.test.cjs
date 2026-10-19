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
