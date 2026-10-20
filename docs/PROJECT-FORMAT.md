# PCB RevEng Simple project format v3

A project is a directory, with UTF-8 `project.json` as its engineering document:

```json
{
  "app": "pcb-reveng-simple",
  "version": 3,
  "name": "Board",
  "nextId": 3,
  "calibration": null,
  "physicalLayers": [
    { "id": 1, "description": "Top" },
    { "id": 2, "description": "Bottom" }
  ],
  "scans": [],
  "components": [],
  "traces": [],
  "vias": [],
  "attachments": []
}
```

IDs are positive unique integers across object collections. `nextId` exceeds all
current IDs. Physical-layer array order defines depth; displayed L1/L2 numbering
is derived from this order. Components and traces retain stable `layerId` values
when the physical stack is reordered. A reorder requires confirmation when a
via or connector pin's effective participating layers change.

## Board geometry

All geometry uses one global board coordinate system, with X right and Y down.
Calibration is either null or `{ "boardUnitsPerMm": 94.488 }`. It is a display
conversion only and never changes geometry.

A component contains `id`, unique `ref`, `value`, `footprint` (package description),
`layerId`, `x`, `y`, `rot` (degrees), `body`, `pins` and optional `datasheetId`.
Body geometry is `{x,y,w,h,shape?}` in local board units. Pin geometry is
`{num,name?,x,y,w,h,shape,tht?,hole?,netName?,barrel?}` in the same local units. Component
rotation maps local coordinates into the board; no physical layer automatically
mirrors component geometry. Round pads have equal dimensions. `hole` is a diameter;
`tht` is retained only as a visual drill flag and has no cross-layer electrical meaning.

An optional pin `barrel` is `{fromLayerId,toLayerId,diameter,hole}`. Its endpoints
must be distinct existing layer IDs, diameter positive and `0 <= hole < diameter`.
The pin has its regular pad contact on the component's layer and a round barrel
on every layer between the endpoints, inclusive. Both geometries share the same
local pin center and a single conductor/net identity. No barrel means an ordinary
layer-local pad, including existing drilled-looking pads; no migration is needed.
Layer reorder uses current physical order. Deleting an endpoint shortens the
surviving span; fewer than two remaining span layers removes only the barrel.
Deleting a component's owning layer still deletes that component as before.

Arrays are a creation tool only: generated pins use the normal schema above.
Group selection, resize bounds and array settings/previews are transient editor
state and are never serialized. Undo records metadata for each complete edit.

A trace contains `id`, `layerId`, `width` and two or more `{x,y}` `points`.
A via contains `id`, global `x`, `y`, `r`, `hole` (both radii), `fromLayerId`,
`toLayerId`, and optional `netName`. It is one conductor participating on every
physical layer between the two endpoint IDs, inclusive. At least two layers are
required. Contact on participating layers joins its one union-find node.

Pin/trace/via `netName` labels do not create invisible links. Geometry determines
physical connectivity; conflicting names on touching copper or repeated names on
disconnected copper produce warnings. Derived nets are never stored.

## Scan files

Each scan contains `id`, `layerId`, `name`, `sourceName`, integer `width`, `height`,
`tileSize:512`, integer `maxLogicalLevel`, `assetMode`, `flipX`, `flipY`, `aligned`,
and `transform:{tx,ty,scale,rotation}`. Reflection acts in source pixels, followed
by positive uniform scale, rotation, and translation. Alignment and blending never
change cached source pixels.

New TIFF scans use `assetMode:"tiff-source"`:

```text
images/scan-21/source.tif                 authoritative, project-owned copy
images/scan-21/manifest.json              completion/identity metadata
images/scan-21/cache-v1/L0/0_0.png         optional derived native pixels
images/scan-21/cache-v1/L3/0_0.png         optional direct reduced tile
```

The source copy is streaming (16 MiB slices), cancellable and completed before
metadata inspection. The manifest is written last, before the scan enters State:

```json
{
  "schema": "pcb-reveng-scan-v1",
  "complete": true,
  "source": "source.tif",
  "sourceName": "PCB_Layer_04.tif",
  "sourceSize": 1784293376,
  "sourceLastModified": 1792440000000,
  "width": 28500,
  "height": 19800,
  "samplesPerPixel": 3,
  "bitsPerSample": 8,
  "photometricInterpretation": 2,
  "baseImage": 0,
  "tileSize": 512,
  "maxLogicalLevel": 6,
  "cacheVersion": 1,
  "sourceOverviews": []
}
```

`complete` describes authoritative data, never cache completeness. Logical level z
uses factor 2^z; dimensions use ceil division. L0 is exact native RGB; reduced
levels use bounded-window bilinear sampling directly from the source/closest
suitable TIFF overview. Overview descriptors contain `{page,level,width,height}`
or `{offset,level,width,height}` for SubIFDs. Unrelated full-size pages are ignored.
Cache tiles are lossless PNGs and may all be absent/deleted. A missing/corrupt
cache tile regenerates. Source size/timestamp mismatch prevents stale disk-cache
use and reports an image error; missing sources leave copper available.

Opening v2 migrates scan `levels` to `maxLogicalLevel:levels-1` and assigns
`assetMode:"legacy-pyramid"`. Save writes v3 metadata; existing `L0/`, `L1/` folders
and original completion manifests are preserved without manufacturing a TIFF.
Small PNG/JPEG imports and v1 photograph migration also use this legacy mode.
They retain the bounded-size materialized-pyramid importer. Cache clearing is
available only for source-backed scans, since legacy tiles are authoritative.

Open reads project metadata, manifests and cheap source file attributes; it never
walks tile directories, hashes TIFFs, or opens all TIFF decoders. Save/Undo never
include source bytes, cache contents or tile lists. Cache work never changes dirty
state. Cleanup removes entire unreferenced scan folders only after history releases
them. Keep the complete project directory when moving/backing it up.

## Datasheets

Attachments contain only `{id,name,mime,size,sha256}`, with
`mime:"application/pdf"` and a lowercase SHA-256. The PDF lives at
`datasheets/<sha256>.pdf`. Components share IDs for identical bytes. Data URLs,
PDF bytes and image tiles never belong in `project.json` or undo snapshots.

## Persistence and history

New asks for a new empty folder and creates the document and asset directories.
Open validates metadata transactionally. Save rewrites only `project.json` using
the directory handle and checks for external metadata modifications first.
A failed/cancelled action preserves the current project. File picker permissions
are not stored in the project.

Undo/redo retains 60 geometry/metadata snapshots. Asset IDs are not reused during
a session. Files remain on disk until explicit cleanup; cleanup also retains
assets referenced by undo/redo and the component clipboard. Only numeric scan
folder names and hash-named PDFs under the app-owned asset directories are eligible.

Active physical layer, remembered primary scans, comparison, blend, scene rotation, drawing
opacity, selection, clipboard, alignment preview, zoom and pan are session state.
They never mark the document dirty or appear in JSON.

## Legacy import

`Import .pcbrev` accepts Simple v1, and the previously supported conservative
original-upstream conversion subset. It writes a separate new directory.
Front/back become two stable physical layers; photo transforms are preserved as
scan transforms, and opacity is discarded. Local millimeter geometry is multiplied
by the old `pxPerMm`. Back mirroring is baked into local X offsets. Existing world
trace/via positions stay fixed. Each old plated pad gains an explicit L1–L2 barrel
via to preserve its former electrical behavior. Embedded PDFs become hash-named
files. The original JSON is never overwritten. Calibration remains null if the
old project had not been calibrated.

## AI export

The streamed ZIP contains `context.md`, `graph.json`, and referenced PDFs only.
Graph schema `pcb-reveng-ai-graph-v2` contains project name, physical-layer IDs,
indices/descriptions, components with displayed layer names, pin/net membership,
net naming flags, copper counts and connectivity warnings. Coordinates and scans
are omitted. Paths for PDFs are sanitized and disambiguated. AI data is derived
from live connectivity at export time and is never stored in the document.
