# Scenic road generation

## Current design

- **Enclosed lakes, no rivers.** Each seeded lake contains more than eight
  connected water-containing cells, including shore and bridge cells. Water
  never exits the scene, and disconnected puddles are removed only when every
  surrounding tile seam remains valid.
- **Prefer shore tiles.** Lake shapes favor rotated shoreline and corner tiles
  over plain water. Both natural and stone-edged shores are available, including
  042, 243, 251, 252, 265, 272, 273 and compatible beach variants. River
  tiles 176, 215, 242 and 244 are excluded from generated scenes. Tiles **168
  and 264** are also excluded in every rotation; they remain available for
  manual placement.
- **High bridges cross lakes.** Tiles 197/207 form spans of two to four deck
  tiles, with matching 154/161/165/171/180 ramps. Bank transitions stay beside
  the bridge rather than extending into canals.
- **More road bends.** Seeded offsets replace selected straight segments with
  four curved corners. Their outside connections and primary-route portals
  remain intact. Junction crosswalks and elevated approaches are not moved.
- **Keep overpasses.** Where space permits, 194 sits between two elevated
  164/170 deck tiles, with full-height ramps and 191/231 lower-road approaches.
  Ordinary junctions retain 027/034 centers and 025 crosswalks.

The first connecting street is positioned relative to the existing road loop,
not the scene center. This leaves room for lake banks even when the loop lies
near one end of a rectangular scene.

## Try in the editor

- **10 × 10, seed 13:** an enclosed shoreline lake, a high bridge, and extra
  curved road corners.
- **16 × 16, seed 17:** lake bridge, bends, junctions, and an overpass.
- **24 × 24, seed 3:** a larger road network with both bridge and overpass.

Scenery planning and concrete solving run in the same worker. Failed plans
leave the previous scene unchanged. Small layouts may lack room for all
features; the generator reports an infeasible plan rather than opening a
lake into a river or dropping its bridge.

## Verification

`npm run wfc:world-plan:verify` exercises real assets on square and rectangular
worlds. It checks closed, connected water; excluded river tiles and tiles
168/264; shoreline
preference; additional road bends; road connectivity and seams; and elevated
spans with two ramp approaches. A known-feasible scene must retain tile 194.
The `--synthetic` variant covers the abstract primary-route planner.

The generic catalog retains exact boundary matching. Reviewed road-scene
exceptions allow structural pieces with identical top surfaces but different
hidden supports, and the authored 027/034-to-025 curb terminations. No new seam
exceptions were added for enclosed lakes or road bends.
