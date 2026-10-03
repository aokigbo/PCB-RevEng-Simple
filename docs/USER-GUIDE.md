# A short guide

Start the app in desktop Chrome or Edge using localhost or HTTPS. Open an existing
`.pcbrev` project, or add a board photograph to a new project. Work is saved only
when you choose Save; there is no hidden browser project database.

## Photographs

Add the front and/or back of the board. The back photo is mirrored automatically
so its copper shares the front's coordinate system. If your scan is already
mirrored, select the back photo in Board setup and clear Mirror horizontally.
Use Front / Back / Both and the opacity sliders along the bottom to inspect them.
To reposition a photo, select it from Board setup and drag it. Its properties
also provide rotation and scale. Do this before tracing: photos move independently
of existing copper annotations.

Choose Measure → Set scale, click two points with a known separation, enter the
separation in millimetres and Apply. Then choose Align front & back: click two
landmarks on the front and the corresponding landmarks on the back **in the same
order**. Choose points far apart. Apply, then inspect Both to check the overlay.
Two-point alignment cannot correct perspective: use perpendicular photos or scans.

## Reconstruct the board

Component offers a small package list. Click to place. Select the body to edit its
reference, value, rotation, side, body width or body height. Drag the body to move
it; drag one of its four corner squares to resize it with the opposite corner
fixed. Hold Shift to preserve the original width:height ratio. Body resizing leaves
all pads, traces and vias in place.

A custom body starts with no pads: select it, choose Add pad and click the board.
Select a pad to set its number, name, dimensions, local coordinates and type.
Drag its interior to move it; drag a corner to resize its copper with the opposite
corner fixed. The pad centre moves and any trace vertices attached there follow
it, while other trace bends stay fixed. Hold Shift to preserve a rectangle's ratio.
Round pads and bodies stay circular during corner resizing. Through-hole pads keep their drill unchanged
and mouse resizing leaves at least 0.1 mm between outer and drill diameters
(0.05 mm of copper per side). Numeric fields remain available for precision.
Each drag is one undo step; Escape cancels it. Connectivity updates on release.
Pads store real dimensions and numbering; the catalog is only a starting point.

A single selected component or pad shows pin labels as **Name | Number**, or just
the number when no name is set. Group selections hide pin labels to avoid clutter.

Drag from empty canvas space to select components and pads inside a rectangle.
Only fully enclosed objects are selected. Enclosing a whole component body selects
it once, including its pads. Enclosing only pads selects those pads individually.
Traces, vias and photos keep their direct-click selection behavior. Drag any selected
item to move the group; only trace points attached to moved pad centres follow.
Other bends stay fixed, even when both ends of a trace move. Delete removes the
selected objects together, with one Undo to restore them. Groups have no resize handles.

Use **Ctrl+C / Ctrl+V** (Command on macOS) to copy components and individual pads.
Paste places the selection's centre at the current mouse position and keeps its
relative spacing. Components get new IDs and references; individual pads stay in
their original component and get new pin numbers. Names, dimensions and values are
retained; electrical net names and attached traces are not copied. The clipboard
is internal to this app and clears on New/Open. Each paste is one undo step.

Trace draws on the side selected by Draw on. Click to start, click corners, and
click a conductor or press Enter to finish. A pale circle marks a snap target.
Escape cancels an unfinished trace. Select a trace and drag its squares to change
corners; double-click a segment to insert a corner. Delete removes a selected
corner, or the entire trace when it has only two points. Drag a trace segment to
move the whole trace. Vias join front and back copper wherever their lands touch.

Select pads, traces or vias to inspect their connected net. Set a name such as
GND or +5V in Properties. Naming does not create a hidden connection. Physical
contact determines nets; deleting a bridge splits them. Attached trace vertices
follow moved component pads and vias when they coincide exactly with their centers.
Moving other geometry can disconnect it, so inspect the highlighted net afterward.

Orange warnings mean names conflict on touching copper or an imported name is
repeated on disconnected copper. Select and rename the affected group, correct
its geometry, or Undo. The netlist export remains blocked until warnings are resolved.

## Save and export

Save As chooses a `.pcbrev` file anywhere, including an Obsidian vault. Save and
Ctrl+S then update that file directly. Failed or canceled saves leave work Unsaved.
If an external editor changes the file, ordinary Save refuses to overwrite it:
Save As preserves your version separately, or reopen to load the disk version.
New and Open ask before discarding unsaved edits; a browser close warns too.

Export → KiCad netlist produces a `.net` file with component references, values,
optional KiCad footprint identifiers and pad connectivity. Import it into KiCad's
PCB Editor using the netlist import command available in your KiCad version.
Assign or verify footprint identifiers there. Export → BOM writes a CSV component
list. Neither export creates a finished schematic or transfers photographed copper
as a routed KiCad board.

## Shortcuts

| Action                                     | Shortcut                          |
| ------------------------------------------ | --------------------------------- |
| New / Open                                 | Ctrl+N / Ctrl+O                   |
| Save / Save As                             | Ctrl+S / Ctrl+Shift+S             |
| Undo / Redo                                | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y   |
| Select / Component / Trace / Via / Measure | V / C / T / B / M                 |
| Delete selected objects or trace corner    | Delete                            |
| Finish trace                               | Enter                             |
| Cancel / return to Select                  | Escape                            |
| Copy / Paste components or pads            | Ctrl+C / Ctrl+V                   |
| Select multiple components/pads            | Drag from empty canvas            |
| Preserve ratio during corner resize        | Shift + drag                      |
| Fit board                                  | F                                 |
| Zoom                                       | Mouse wheel                       |
| Pan                                        | Middle mouse drag or Space + drag |

Command is accepted in place of Ctrl on macOS. The browser may reserve some
shortcuts; all file actions are also available in the top bar. Text fields keep
normal text-editing shortcuts. Save commits the field being edited and finishes
a trace with at least two points before writing.
