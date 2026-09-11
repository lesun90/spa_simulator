# Scenic road generation

## Map layout

Roads start from the accepted primary route and grow through **uniformly
sampled land positions**, not equally spaced rows or fixed district quotas.
New blocks may share a street or cross another block. Samples outside the
existing network can attach a loop to a nearby usable street, so growth is
not confined to the original route's footprint. Block dimensions, connecting
streets and occasional offsets are seeded and irregular.

Candidates are rejected when they would break connectivity, overlap protected
features, or leave insufficient junction clearance. Thus the result is a
connected, loosely grid-like network with random variation, not independent
unconstrained road fragments.

### Broad road curves

Tiles **144, 041, 156 and 147** form a reviewed 2×2 broad corner. The planner
rotates the complete assembly and preserves all outside road connections.
The small shared road portions inside this assembly are not additional
junctions and do not receive crosswalks. Longer offsets leave room for broad
corners rather than adding tightly packed zigzags.

144 and 147 now have reviewed route metadata. Curve seams use the same
strict **visible geometry, material and absolute-height profile** comparison
as structural transitions; differences in buried curb geometry are allowed
only for the reviewed assets. The generic catalog retains full-boundary
socket matching.

### Lakes

Bridge lakes and standalone lakes are enclosed, connected water bodies with
more than eight water-containing cells and at least one plain-water core.
Shorelines close against land; water cannot leave the scene. Incidental
disconnected puddles are replaced with grass only if all resulting seams
remain compatible.

High bridge decks **197/207** span two to four tiles, with compatible ramps
and bank transitions. Low bridges **187/188** span one to four tiles and meet
flat road approaches directly. The planner reserves an early high crossing,
then alternates low and high styles, trying the other height when a site
cannot fit the preferred one. Open-water cores sit on both sides of each span.
Standalone lakes require a free parcel but no road or bridge. Their sizes,
outlines and shoreline variants vary by seed.

River tiles 176, 215, 242 and 244, and excluded tiles **168 and 264**, remain
unavailable to scenic generation. They remain available for manual placement.

### Hills

Each hill samples a shared field of raised and low corner elevations.
Random footprints, aspect ratios, lean and boundary variation produce small
peaks, asymmetric mounds and elongated ridges. Authored slope pieces join
those shared vertices, rather than surrounding a forced square plateau.

Hills use the available terrain heights; this does not stretch models or
introduce unsupported elevation levels. A successful local solve still has
to meet ordinary ground on its perimeter.

Mountain passes use two opposing **231** road cuts, with their high ends
meeting at the ridge. Matching slopes enclose the road on both sides and
return to ordinary grass at the feature boundary. These passes are placed
independently of overpasses and keep the road at ground level.

### Roundabouts

Roundabouts replace suitable straight roads, corners or junctions with a
complete 3×3 ring. **039** forms the island, four rotated **049** pieces form
the corners, and **043** provides each external entrance. **048** closes the
unused exits. All one-, two-, three- and four-entrance arrangements are
supported, including adjacent and opposite two-entrance configurations.

A one-entrance roundabout attaches to a street via a short spur and acts as a
turning circle. Assemblies preserve the primary route's portals, leave room
for nearby crosswalks and cannot overwrite a protected lake or overpass.

## Feature density and placement

Placement targets scale with scene area:

| Feature | Target |
| --- | --- |
| Bridge lakes | Approximately one per 450 cells |
| Overpasses | Approximately one per 500 cells |
| Roundabouts | Approximately one per 350 cells |
| Mountain passes | Approximately one per 600 cells |
| Additional standalone lakes | Approximately one per 600 cells |
| Hills | Approximately one per 160 cells |

Each target is rounded, with at least one attempted placement. Targets are
not guarantees: small, narrow or constrained maps may support fewer features.
The planner reserves an early bridge lake, extends the road network, places
separated overpasses, then fits additional bridge lakes, roundabouts, mountain
passes, standalone lakes and hills. Dry streets around a lake remain available
for later planning.

Ordinary junctions use **150** for three ways and **141** for four ways, with
025 crosswalk approaches. Tiles **027/034** are excluded from the road-scene
palette but remain available for manual placement. Overpass
194 has two raised deck tiles, full-height ramps and 191/231 lower-road
approaches. Overpass centers have a minimum nine-cell separation.

## Try in the editor

With cell size 1, try:

- **16 × 16, seed 17:** broad corners, a bridge lake and small hills.
- **24 × 24, seed 3:** broad curves, a bridge and an overpass.
- **40 × 40, seed 17:** both low bridge tiles, high bridges, three overpasses,
  mountain passes and roundabouts with one to four entrances.

Scenery planning and concrete solving run in the same worker. Generation is
deterministic for a given catalog, size and seed. Failed generation leaves
the previous scene unchanged. Lack of room for an optional scenic feature
does not, on its own, make the whole map infeasible.

## Verification

- `npm run wfc:world-plan:verify`: 24 real-catalog layouts, including 40×40
  and 100×100 maps and narrow rectangular scenes. Checks road connectivity,
  concrete seams, complete broad-curve assemblies, each lake's enclosure and
  open-water core, excluded assets, elevated spans and ramp approaches.
  All 15 roundabout exit arrangements are checked against the real catalog.
  Complete scenes also check roundabout assemblies, flat low-bridge approaches,
  mountain passes and coverage of every requested tile. The 40×40 cases check
  geographic coverage and multiple crossings.
- `npm run wfc:world-plan:verify -- --synthetic`: abstract primary-route
  planner checks.
- `npm run assets:road-wfc:verify`: generic full-boundary socket verification.
- `npm run build:check`: TypeScript and production build.

Browser verification uses the real editor, worker and GLB assets. It covers
10×10, 16×16, 24×24 and several 40×40 seeds without changing saved user scenes.
