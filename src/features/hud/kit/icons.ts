import * as THREE from "three";
import { configureHudCanvasTexture } from "./textures";

export type IconDrawer = (ctx: CanvasRenderingContext2D, size: number, color: string) => void;

export interface RasterizedIcon {
  texture: THREE.CanvasTexture;
  size: number;
}

const iconCache = new Map<string, RasterizedIcon>();
const ICON_SUPERSAMPLE = 2;

/** Rasterizes one of the icons below to a cached CanvasTexture, keyed by (icon,size,color). */
export function rasterizeIcon(key: string, size: number, color: string): RasterizedIcon {
  const cacheKey = `${key}|${size}|${color}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = size * ICON_SUPERSAMPLE;
  canvas.height = size * ICON_SUPERSAMPLE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(ICON_SUPERSAMPLE, ICON_SUPERSAMPLE);
  icons[key]?.(ctx, size, color);

  const texture = configureHudCanvasTexture(new THREE.CanvasTexture(canvas));
  const rasterized: RasterizedIcon = { texture, size };
  iconCache.set(cacheKey, rasterized);
  return rasterized;
}

function setup(ctx: CanvasRenderingContext2D, size: number, color: string) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(size * 0.09, 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

export const icons: Record<string, IconDrawer> = {
  refresh: (ctx, size, color) => {
    setup(ctx, size, color);
    const c = size / 2;
    const r = size * 0.32;
    ctx.beginPath();
    ctx.arc(c, c, r, -Math.PI * 0.15, Math.PI * 1.5);
    ctx.stroke();
    const tipAngle = Math.PI * 1.5;
    const tipX = c + Math.cos(tipAngle) * r;
    const tipY = c + Math.sin(tipAngle) * r;
    ctx.beginPath();
    ctx.moveTo(tipX - size * 0.12, tipY - size * 0.03);
    ctx.lineTo(tipX + size * 0.08, tipY - size * 0.14);
    ctx.lineTo(tipX + size * 0.1, tipY + size * 0.08);
    ctx.closePath();
    ctx.fill();
  },
  chevronDown: (ctx, size, color) => {
    setup(ctx, size, color);
    ctx.beginPath();
    ctx.moveTo(size * 0.25, size * 0.4);
    ctx.lineTo(size * 0.5, size * 0.65);
    ctx.lineTo(size * 0.75, size * 0.4);
    ctx.stroke();
  },
  chevronUp: (ctx, size, color) => {
    setup(ctx, size, color);
    ctx.beginPath();
    ctx.moveTo(size * 0.25, size * 0.6);
    ctx.lineTo(size * 0.5, size * 0.35);
    ctx.lineTo(size * 0.75, size * 0.6);
    ctx.stroke();
  }
};
