# PCB RevEng Simple project format v2

A project is a directory, with UTF-8 `project.json` as its engineering document:

```json
{
  "app": "pcb-reveng-simple",
  "version": 2,
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
via's effective participating layers change.

## Board geometry

All geometry uses one global board coordinate system, with X right and Y down.
Calibration is either null or `{ "boardUnitsPerMm": 94.488 }`. It is a display
conversion only and never changes geometry.

A component contains `id`, unique `ref`, `value`, `footprint` (package description),
`layerId`, `x`, `y`, `rot` (degrees), `body`, `pins` and optional `datasheetId`.
Body geometry is `{x,y,w,h,shape?}` in local board units. Pin geometry is
`{num,name?,x,y,w,h,shape,tht?,hole?,netName?}` in the same local units. Component
rotation maps local coordinates into the board; no physical layer automatically
mirrors component geometry. Round pads have equal dimensions. `hole` is a diameter;
`tht` is retained only as a visual drill flag and has no cross-layer electrical meaning.

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
`tileSize:512`, integer `levels`, `flipX`, `flipY`, `aligned`, and
`transform:{tx,ty,scale,rotation}`. Reflection acts in source pixels, followed by
positive uniform scale, rotation, and translation into board units. Alignment
stores the resulting transform only; there are no dependencies between scans.

The path is derived exclusively from the numeric ID:

```text
images/scan-21/manifest.json
images/scan-21/L0/0_0.png
images/scan-21/L0/1_0.png
images/scan-21/L1/0_0.png
```

L0 has the source dimensions. Each subsequent level uses ceil(width/2),
ceil(height/2), until both dimensions fit within 512 pixels. Edge tiles contain
only their valid source extent. All levels use PNG; L0 is lossless.

The manifest is the completion marker and is written after every required tile:

```json
{
  "complete": true,
  "width": 1025,
  "height": 769,
  "tileSize": 512,
  "levels": [
    { "level": 0, "width": 1025, "height": 769 },
    { "level": 1, "width": 513, "height": 385 },
    { "level": 2, "width": 257, "height": 193 }
  ]
}
```

Incomplete imports are never adopted into the document. Original TIFF paths and
file handles are not stored. Open checks manifests, while individual tiles are
checked on demand. Missing scan files do not discard engineering metadata.

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

Active physical layer, remembered primary scans, comparison, blend, drawing
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
