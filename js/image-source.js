"use strict";
const IMAGE_CACHE_VERSION = 1;
const MAX_TIFF_BLOCK = 128 * 1024 * 1024;
function scanMaxLevel(scan) {
  return scan.maxLogicalLevel ?? scan.levels - 1;
}
function tileGeometry(scan, level, x, y) {
  const factor = 2 ** level,
    width = Math.ceil(scan.width / factor),
    height = Math.ceil(scan.height / factor),
    w = Math.min(512, width - x * 512),
    h = Math.min(512, height - y * 512);
  if (
    !Number.isInteger(level) ||
    level < 0 ||
    level > scanMaxLevel(scan) ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    w < 1 ||
    h < 1
  )
    throw new Error("Invalid logical image tile.");
  return { factor, width: w, height: h, left: x * 512 * factor, top: y * 512 * factor };
}
function sourceOverviewLevel(base, width, height) {
  const level = Math.round(Math.log2(base.width / width));
  return level > 0 &&
    level < 32 &&
    Math.abs(Math.ceil(base.width / 2 ** level) - width) <= 1 &&
    Math.abs(Math.ceil(base.height / 2 ** level) - height) <= 1
    ? level
    : null;
}
function imageDecodeSlots(blockBytes, cores = 4, memory = 8) {
  let slots = cores <= 4 ? 2 : cores <= 8 ? 3 : cores <= 16 ? 4 : 6;
  if (memory <= 8) slots = Math.min(slots, 3);
  return blockBytes > 64 * 1024 * 1024
    ? 1
    : blockBytes > 32 * 1024 * 1024
      ? Math.min(2, slots)
      : slots;
}
function checkTiffImage(image) {
  const fd = image.getFileDirectory(),
    bits = Array.from(fd.getValue("BitsPerSample") || []),
    photo = fd.getValue("PhotometricInterpretation"),
    width = image.getWidth(),
    height = image.getHeight(),
    samples = image.getSamplesPerPixel(),
    compression = fd.getValue("Compression") || 1;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 1e7 ||
    height > 1e7
  )
    throw new Error("Invalid scan dimensions.");
  if (
    !bits.length ||
    bits.some((n) => n !== 8) ||
    ![0, 1, 2, 3].includes(photo) ||
    samples > 4 ||
    samples < 1 ||
    (photo === 2 && samples < 3) ||
    image.getSampleFormat() !== 1
  )
    throw new Error("This TIFF is not a supported 8-bit RGB/grayscale/palette scan.");
  if (![1, 5, 7, 8, 32946, 32773].includes(compression))
    throw new Error(
      "Unsupported TIFF compression: " +
        compression +
        ". Export an RGB TIFF with LZW, Deflate or no compression.",
    );
  const blockBytes = image.getTileWidth() * image.getTileHeight() * samples;
  if (!Number.isSafeInteger(blockBytes) || blockBytes < 1 || blockBytes > MAX_TIFF_BLOCK)
    throw new Error(
      "This TIFF uses unusually large image strips/tiles that cannot be decoded safely. Export it with shorter strips or tiled TIFF storage.",
    );
  return {
    width,
    height,
    samplesPerPixel: samples,
    bitsPerSample: 8,
    photometricInterpretation: photo,
    blockBytes,
  };
}
async function tiffMetadata(file) {
  const source = await GeoTIFF.fromBlob(file);
  let base, image, baseImage, lastError;
  for (let page = 0; page < 32; page++) {
    let candidate;
    try {
      candidate = await source.getImage(page);
    } catch {
      break;
    }
    try {
      base = checkTiffImage(candidate);
      image = candidate;
      baseImage = page;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!base) throw lastError || new Error("No supported TIFF image page.");
  const sourceOverviews = [],
    seen = new Set();
  const consider = (candidate, address) => {
    try {
      const meta = checkTiffImage(candidate),
        level = sourceOverviewLevel(base, meta.width, meta.height);
      if (level && !seen.has(level)) {
        seen.add(level);
        sourceOverviews.push({ ...address, level, width: meta.width, height: meta.height });
      }
    } catch {
      /* Unrelated/unsupported TIFF pages are not overview evidence. */
    }
  };
  for (let page = baseImage + 1; page < 32; page++) {
    try {
      consider(await source.getImage(page), { page });
    } catch {
      break;
    }
  }
  const fd = image.getFileDirectory();
  if (fd.hasTag("SubIFDs"))
    for (let i = 0; i < 32; i++) {
      let offset;
      try {
        offset = Number(await fd.loadValueIndexed("SubIFDs", i));
      } catch {
        break;
      }
      if (!Number.isSafeInteger(offset) || offset <= 0) break;
      try {
        consider(
          new GeoTIFF.GeoTIFFImage(
            await source.parser.parseFileDirectoryAt(offset),
            source.littleEndian,
            false,
            source.source,
          ),
          { offset },
        );
      } catch {
        /* Ignore unrelated SubIFDs. */
      }
    }
  sourceOverviews.sort((a, b) => a.level - b.level);
  return { source, image, metadata: { ...base, baseImage, sourceOverviews } };
}
