/**
 * All HUD content is coplanar-ish (small z offsets, not a real 3D stage), rendered with standard depth
 * testing scoped to the HUD's own render pass (world/HUD separation is via renderer.clearDepth(), see
 * Renderer.renderLayers). These z steps give both correct visual stacking AND correct raycasting order
 * (Raycaster sorts by actual distance, so same-z siblings would be an ordering coin-flip otherwise).
 *
 * The HUD camera sits on the +Z side looking toward -Z, so a LARGER z is closer to the camera and
 * renders on top — these values increase from background panel to topmost popover accordingly.
 */
export const hudZ = {
  panel: 0,
  control: 0.1,
  glyph: 0.2,
  active: 0.3,
  popover: 5,
  tooltip: 6
} as const;
