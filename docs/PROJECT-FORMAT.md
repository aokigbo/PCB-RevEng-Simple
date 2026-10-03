# Project format: PCB RevEng Simple v1

A UTF-8, indented JSON file with extension `.pcbrev`:

```json
{
  "app": "pcb-reveng-simple",
  "version": 1,
  "name": "Amplifier Board",
  "pxPerMm": 10,
  "calibrated": false,
  "nextId": 1,
  "layers": [],
  "components": [],
  "traces": [],
  "vias": []
}
```

All object IDs are positive, unique integers. `nextId` exceeds the largest ID.
World coordinates are image-space pixels; divide by `pxPerMm` to obtain mm.
The positive X axis points right and positive Y points down. Both sides share a
front-view coordinate system. Back components mirror local X before rotation.

## Photos

At most one layer per `side` (`front` or `back`). A layer contains `id`, `name`,
`side`, `width`, `height` (decoded pixels), embedded `dataURL` (PNG/JPEG/WebP),
`tx`, `ty` (world pixels), `scale` (world pixels per image pixel), `rot` (degrees),
`mirror` (boolean) and `opacity` (0–1).

The transform is: optionally negate image X, multiply by scale, rotate, then
translate by tx/ty. No external paths or URLs are necessary. Photos are larger
in JSON because of base64 encoding, but remain portable and backed up with the file.

## Components and pads

A component has `id`, `ref`, `value`, `footprint` (display name), `kicad` (optional
library-qualified footprint string), `x`, `y`, `rot`, `side`, `body`
(`w`, `h`, `xmm`, `ymm`, optional `shape`) and `pins`.
Body `xmm`/`ymm` are its local centre in mm, independent of the component's pad
origin. Older files default these offsets to zero. They let corner resizing keep
the opposite body corner fixed without moving the component origin or its pads.
Body offsets are internal geometry, not separate inspector controls.

Each pin has unique string `num`, optional `name`, `xmm`, `ymm` (component-local mm),
`w`, `h` (mm), and `shape` (`rect` or `circle`). A circle with `tht` other than
false is a plated through-hole pad; `tht:false` is a one-sided round SMD land.
Rectangles are SMD pads. `hole` is the drill **diameter** in mm for plated pads.
Round pads always use equal width/height. Body and pad dimensions are physical mm;
there is no component-scale transform. Body resizing does not change pad geometry.
Round bodies preserve a 1:1 ratio during corner resizing.
The app stores explicit pad geometry: future catalog changes cannot move saved pads.
Resize handles, selections, the internal clipboard and active drags are UI state
and are never serialized. Copied components get new IDs and references; copied pads
get new numbers on their existing parent. Paste never carries `netName` or traces.

Existing v1 files with `component.scale` remain supported. On load, the multiplier
is baked into body dimensions/offsets, pad offsets, pad dimensions and any drill diameter,
then removed. Round pads normalize height to their visible width. Older round
bodies preserve their visible diameter (the larger dimension). A missing or zero
plated-pad drill is materialized from the old display default, 40% of outer width,
so later copper resizing cannot resize the drill. Normalization happens once at
load; saved projects use explicit geometry without a format-version change.

## Traces and vias

A trace has `id`, `side`, `width` (world pixels), and two or more `points` (`x`,`y`).
It represents round-capped copper, not an invisible net connection.

A via has `id`, `x`, `y`, `r` and `hole` (outer and drill **radii**, world pixels).
Every via connects both sides. Blind/buried vias are intentionally unsupported.

## Electrical names

A pin, trace or via may have `netName`, a user-assigned name anchored to that
conductor. Derived net IDs, colors, selections and transient connection maps are
not serialized. Physical connected components are recalculated from the geometry.
SMD copper only joins its own side. Plated pads and vias join both sides.

Naming a net places one name anchor on the selected conductor and clears other
names in that physical group. If copper is disconnected, the name stays with its
anchor. If the anchor itself is deleted, its name is deleted too; Undo restores it.
Different names on touching copper are conflicts. Repeated names on disconnected
copper are conflicts rather than implicit electrical links. Auto-generated names
are deterministic and cannot collide with explicitly assigned names.

## Loading and saving

Unsupported versions, invalid dimensions, duplicate references/IDs/pin numbers,
invalid layer counts and undecodable photos reject the entire open operation.
The current document remains intact. File handles and Saved checkpoints change
only on a successful Open or completed Save. Existing-file Save checks modification
time and size before writing; it cannot eliminate a race with an external writer
changing the file between that check and the final close.

A successful Open starts a fresh in-memory undo history. Save does not save view
state or undo history. Images referenced by current or historical states remain
in memory; unreachable images are released when history advances.

## Legacy conversion

`app: "pcb-reveng"`, version 1 or 2 is accepted only for a single two-sided board
with supported embedded photos and known small-catalog footprints. Geometry is
materialized and existing net assignments are retained as labels on conductors.
Disconnected legacy assignments become warnings that require review before export.

Multi-board, schematic, notes, custom BOM, off-page links, inner copper, blind vias,
warps, external/downscaled images, unknown packages, inconsistent pads and explicit
no-connect data are refused. The original stays usable in upstream PCB RevEng.
A converted document has no overwrite handle and is Unsaved until Save As.
