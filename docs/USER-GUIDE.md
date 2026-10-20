# PCB inspection guide

Run the app in desktop Chrome or Edge on localhost or HTTPS. New creates a project
in a new empty folder. Open selects an existing project folder. Keep the folder's
`project.json`, `images/` and `datasheets/` together when moving or backing it up.
Save writes engineering edits; there is no browser autosave.

## Physical layers and scans

Physical layers describe actual PCB depth. L1/L2/L3 labels follow their order.
Click a layer row to work there, use its ⋯ button to edit its description or delete
it, and drag rows to reorder. Reordering asks before changing any via's physical
span. Deleting a layer asks about the affected scans, components and traces; via
spans are shortened or removed if fewer than two layers remain. Undo restores it.

Use + Add image inside a layer to choose a TIFF. The app copies it into the project
with progress and Cancel, then reads image information. There is no full-image
preprocessing wait. Detail loads as you pan/zoom, with coarse cached evidence used
while finer tiles arrive. The external original is unnecessary afterward. Several scans may describe the same layer:
populated, partially sanded, exposed copper, and so on. PNG/JPEG also work for
smaller images. Very large scans should use TIFF with reasonably sized strips/tiles.

Click a scan to make it primary. Its ⋯ properties rename it, adjust its transform,
flip it, align it or delete it. Source-backed scans also offer **Clear Derived
Image Cache**, which retains the source and copper; tiles regenerate as needed. Removing a scan leaves the layer's copper intact.
The first scan establishes the initial coordinate system, which survives its deletion.

## Inspection and alignment

**Scene rotation** in View turns the complete workspace in 90° steps. Reset returns
to 0°. The point at the viewport center stays fixed. Fit works at the current
rotation; pan stays screen-relative, and wheel always zooms even with Space held.
This rotates the camera only: alignment, copper geometry, nets and saved project
data remain unchanged. Opening a project resets scene rotation.

The primary scan always belongs to the active layer. Comparison can be another
scan from any layer. Blend at 0% shows primary; 100% shows comparison; near 50%
shows both. Drawing opacity separately fades the components, pads, traces, vias
and ordinary labels. Changing any view control does not dirty the project.
Switching layers restores the remembered primary and clears Comparison.

For alignment, select the target scan's properties, choose any other scan as
reference, and choose 3–5 point pairs. Select Align to reference, click the reference
landmarks, then Pick target landmarks and click those landmarks in the same order.
Spread them across the board. Review the blend preview and RMS error. Apply changes
only the target scan. Redo points starts over, and Cancel preserves its transform.
Alignment never moves reconstructed copper or unrelated scans.

Flip horizontally / vertically are explicit confirmed commands. A flip preserves
approximate placement but marks the scan for alignment checking. Perspective,
shear and warped scans are outside this tool's alignment model.

## Reconstruct copper

Components and traces belong to the active physical layer. Choose Component,
select a package and click to place. Catalog proportions are a starting point.
Select the body to edit its reference, value, layer, rotation and dimensions.
Custom components allow manually placed pads. No calibration is required.

Pads use Name | Number labels. Select one to edit its number, name, local
position, dimensions and shape. A visible hole does not connect through the board.
Add an explicit via at the pin to represent an established barrel connection.

Trace clicks start/add vertices; click copper or press Enter to finish. Escape
cancels unfinished work. Double-click a segment to insert a vertex. Select and
drag a vertex to edit it; Delete removes the chosen vertex or a two-point trace.
Trace width and actual pad geometry determine contact.

Place one via, then set its From layer and To layer in Properties. It appears on
every layer in that continuous physical span and joins touching copper there.
Moving it changes its one global position. Exactly attached endpoints on all its
participating layers follow; other bends stay fixed. Components and pads similarly
carry exact endpoint anchors on their own layer only.

Drag empty space to select fully enclosed components/pads. Whole bodies supersede
individual child pads. Move or delete a group in one undo step. Copy/paste preserves
source layers, spacing, component values, pin labels and datasheet relationships,
while generating new references/IDs and clearing copied net assignments. Traces
are not copied. A copied standalone pad remains on its original parent.

Single body/pad corner handles keep the opposite corner fixed. Shift preserves
aspect ratio. Round geometry stays round, and pad drills keep their diameter.
Escape cancels a drag. Undo/redo is conventional and grouped by completed edit.

## Calibration and electrical names

Measure works in board units until calibrated. Optional Calibrate millimeters uses
two points and their known separation. It changes conversion only: existing scans,
components, pads, traces and vias remain in the same positions and sizes.

Select a pad, trace or via to inspect its net and enter names such as GND or VBAT.
The inspector lists connected pads across layers. A name does not connect separated
copper. Warnings identify touching copper with conflicting names or disconnected
copper sharing a name. Correct geometry/names or inspect the incomplete evidence.
AI export includes warnings and remains available.

## Datasheets, save and export

Select a component to Attach PDF. Identical bytes reuse a hash-named project file.
Open PDF launches the browser's normal viewer in a new tab. Replace/Remove change
the component relationship; Undo can restore it. PDFs remain in the project folder.

Save / Ctrl+S writes only `project.json`. If that file changes externally, reopen
before saving. There is no Save As; duplicate the whole folder with your file
manager when needed. Import .pcbrev migrates old embedded-file projects into a
separate empty folder without modifying the source.

BOM CSV uses Reference, Value, Footprint and Layer. AI package writes one ZIP with
readable context, a multilayer net-centric graph and referenced PDFs. It excludes
scans and physical geometry. Keep the project directory as the full engineering
source. Clean unused assets removes orphaned app-owned files while retaining undo,
redo and clipboard references.

## Shortcuts

| Action                                     | Shortcut                        |
| ------------------------------------------ | ------------------------------- |
| New / Open / Save                          | Ctrl+N / Ctrl+O / Ctrl+S        |
| Undo / Redo                                | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y |
| Select / Component / Trace / Via / Measure | V / C / T / B / M               |
| Copy / Paste                               | Ctrl+C / Ctrl+V                 |
| Delete selection / finish trace / cancel   | Delete / Enter / Escape         |
| Previous / next physical layer             | Space+W / Space+S               |
| Previous / next scan in active layer       | Space+Z / Space+C               |
| Blend toward primary / comparison          | Space+A / Space+D               |
| Drawing opacity down / up                  | Space+Q / Space+E               |
| Pan                                        | Space+left drag, or middle drag |
| Zoom / fit                                 | Wheel / F                       |

Command is accepted instead of Ctrl on macOS. Inputs keep ordinary typing behavior.
Space alone starts no drag or edit. A short HUD reports view adjustments. Every
view shortcut also has a layer/scan row, dropdown, slider or mouse equivalent.
