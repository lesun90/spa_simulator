import * as THREE from "three";
import { theme } from "../../../app/theme";
import { configureHudCanvasTexture } from "./textures";

export interface TextStyle {
  size?: number;
  color?: string;
  weight?: string;
  align?: CanvasTextAlign;
  font?: string;
}

export interface RasterizedText {
  texture: THREE.CanvasTexture;
  width: number;
  height: number;
}

const MAX_CACHE_ENTRIES = 300;
const SUPERSAMPLE = 2;
const cache = new Map<string, RasterizedText>();
const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d")!;

/** Rasterizes text to a CanvasTexture, cached by (text,style) so repeated labels don't re-draw every frame. */
export function rasterizeText(text: string, style: TextStyle = {}): RasterizedText {
  const size = style.size ?? 13;
  const color = style.color ?? theme.text.css;
  const weight = style.weight ?? "500";
  const align = style.align ?? "left";
  const font = style.font ?? theme.font;
  const key = `${text}|${size}|${color}|${weight}|${align}|${font}`;

  const cached = cache.get(key);
  if (cached) return cached;

  measureCtx.font = `${weight} ${size}px ${font}`;
  const metrics = measureCtx.measureText(text || " ");
  const width = Math.max(Math.ceil(metrics.width) + 4, 1);
  const height = Math.ceil(size * 1.5);

  const canvas = document.createElement("canvas");
  canvas.width = width * SUPERSAMPLE;
  canvas.height = height * SUPERSAMPLE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SUPERSAMPLE, SUPERSAMPLE);
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = align;
  const x = align === "left" ? 2 : align === "right" ? width - 2 : width / 2;
  ctx.fillText(text, x, height / 2 + 1);

  const texture = configureHudCanvasTexture(new THREE.CanvasTexture(canvas));
  const rasterized: RasterizedText = { texture, width, height };

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.get(oldestKey)?.texture.dispose();
      cache.delete(oldestKey);
    }
  }
  cache.set(key, rasterized);
  return rasterized;
}
