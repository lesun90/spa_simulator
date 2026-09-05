import * as THREE from "three";

export interface GridVisibilityColors {
  center: number;
  grid: number;
}

const LIGHT_GRID: GridVisibilityColors = { center: 0x9fb0c7, grid: 0xe6edf7 };
const DARK_GRID: GridVisibilityColors = { center: 0x2f3948, grid: 0x4a5566 };

export function gridColorsForGroundColor(color: string): GridVisibilityColors {
  if (!/^#[\da-f]{6}$/i.test(color)) return LIGHT_GRID;

  const ground = new THREE.Color(color);
  return ground.getHSL({ h: 0, s: 0, l: 0 }).l > 0.45 ? DARK_GRID : LIGHT_GRID;
}

export function applyGridVisibilityColors(grid: THREE.GridHelper, colors: GridVisibilityColors): void {
  const attribute = grid.geometry.getAttribute("color");
  if (!(attribute instanceof THREE.BufferAttribute)) return;

  const center = new THREE.Color(colors.center);
  const line = new THREE.Color(colors.grid);
  const divisions = attribute.count / 4 - 1;
  const centerLineIndex = divisions / 2;

  for (let index = 0; index <= divisions; index += 1) {
    const color = index === centerLineIndex ? center : line;
    const base = index * 4;
    attribute.setXYZ(base, color.r, color.g, color.b);
    attribute.setXYZ(base + 1, color.r, color.g, color.b);
    attribute.setXYZ(base + 2, color.r, color.g, color.b);
    attribute.setXYZ(base + 3, color.r, color.g, color.b);
  }

  attribute.needsUpdate = true;
}
