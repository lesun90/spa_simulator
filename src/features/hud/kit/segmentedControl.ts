import type { Rect } from "./layout";

export function segmentButtonRect(rect: Rect, index: 0 | 1, gap = 6): Rect {
  const width = (rect.width - gap) / 2;
  return { x: rect.x + index * (width + gap), y: rect.y, width, height: rect.height };
}
