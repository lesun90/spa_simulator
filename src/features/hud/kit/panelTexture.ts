import * as THREE from "three";
import { theme } from "../../../app/theme";
import { configureHudCanvasTexture } from "./textures";

export type PanelShadowLevel = "none" | "sm" | "md" | "lg";

export interface PanelCornerRadius {
  topLeft?: number;
  topRight?: number;
  bottomLeft?: number;
  bottomRight?: number;
}

export interface PanelRasterOptions {
  width: number;
  height: number;
  radius?: number | PanelCornerRadius;
  fill: number;
  fillOpacity?: number;
  border?: number;
  borderWidth?: number;
  shadow?: PanelShadowLevel;
}

export interface RasterizedPanel {
  texture: THREE.CanvasTexture;
  /** Transparent bleed drawn around the rect on every side, to fit shadow blur/offset. */
  padding: number;
}

interface ShadowSpec {
  blur: number;
  offsetY: number;
  alpha: number;
}

const SHADOW_LEVELS: Record<Exclude<PanelShadowLevel, "none">, ShadowSpec> = {
  sm: { blur: 6, offsetY: 2, alpha: 0.12 },
  md: { blur: 14, offsetY: 5, alpha: 0.16 },
  lg: { blur: 28, offsetY: 10, alpha: 0.2 }
};

const SUPERSAMPLE = 2;
const MAX_CACHE_ENTRIES = 200;
const cache = new Map<string, RasterizedPanel>();

/** Total transparent bleed a given shadow level needs around the drawn rect so blur isn't clipped. */
export function panelShadowPadding(level: PanelShadowLevel = "none"): number {
  if (level === "none") return 0;
  const spec = SHADOW_LEVELS[level];
  return Math.ceil(spec.blur + Math.abs(spec.offsetY)) + 2;
}

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

function resolveRadius(
  radius: number | PanelCornerRadius | undefined,
  width: number,
  height: number
): { tl: number; tr: number; bl: number; br: number } {
  const max = Math.max(Math.min(width, height) / 2, 0);
  const clamp = (value: number) => Math.min(Math.max(value, 0), max);
  if (typeof radius === "object") {
    return {
      tl: clamp(radius.topLeft ?? 0),
      tr: clamp(radius.topRight ?? 0),
      bl: clamp(radius.bottomLeft ?? 0),
      br: clamp(radius.bottomRight ?? 0)
    };
  }
  const uniform = clamp(radius ?? theme.radius.md);
  return { tl: uniform, tr: uniform, bl: uniform, br: uniform };
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: { tl: number; tr: number; bl: number; br: number }
) {
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.arcTo(x + w, y, x + w, y + r.tr, r.tr);
  ctx.lineTo(x + w, y + h - r.br);
  ctx.arcTo(x + w, y + h, x + w - r.br, y + h, r.br);
  ctx.lineTo(x + r.bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - r.bl, r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.arcTo(x, y, x + r.tl, y, r.tl);
  ctx.closePath();
}

/**
 * Rasterizes a rounded rect (fill + optional border + optional drop shadow) to a CanvasTexture,
 * cached by its draw parameters — the same technique `TextRenderer`/`icons` use for glyphs, applied to
 * panel chrome so every `Panel`-based widget (buttons, tiles, fields, the dock) shares one look.
 */
export function rasterizePanel(options: PanelRasterOptions): RasterizedPanel {
  const width = Math.max(Math.round(options.width), 1);
  const height = Math.max(Math.round(options.height), 1);
  const radius = resolveRadius(options.radius, width, height);
  const shadow = options.shadow ?? "none";
  const fillOpacity = options.fillOpacity ?? 1;
  const borderWidth = options.borderWidth ?? 1;

  const key = [
    width,
    height,
    radius.tl,
    radius.tr,
    radius.bl,
    radius.br,
    options.fill,
    fillOpacity,
    options.border ?? "none",
    options.border !== undefined ? borderWidth : 0,
    shadow
  ].join("|");

  const cached = cache.get(key);
  if (cached) return cached;

  const pad = panelShadowPadding(shadow);
  const canvasWidth = width + pad * 2;
  const canvasHeight = height + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth * SUPERSAMPLE;
  canvas.height = canvasHeight * SUPERSAMPLE;
  // A headless/non-browser DOM (e.g. jsdom in unit tests) has no canvas 2D backend and returns null
  // here — degrade to a blank texture rather than crash, since only real browsers render this HUD.
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(SUPERSAMPLE, SUPERSAMPLE);

    tracePath(ctx, pad, pad, width, height, radius);
    if (shadow !== "none") {
      const spec = SHADOW_LEVELS[shadow];
      ctx.save();
      ctx.shadowColor = `rgba(${theme.shadowRgb}, ${spec.alpha})`;
      ctx.shadowBlur = spec.blur;
      ctx.shadowOffsetY = spec.offsetY;
      ctx.fillStyle = hexToCss(options.fill);
      ctx.globalAlpha = fillOpacity;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = hexToCss(options.fill);
      ctx.globalAlpha = fillOpacity;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (options.border !== undefined && borderWidth > 0) {
      const inset = borderWidth / 2;
      const borderRadius = {
        tl: Math.max(radius.tl - inset, 0),
        tr: Math.max(radius.tr - inset, 0),
        bl: Math.max(radius.bl - inset, 0),
        br: Math.max(radius.br - inset, 0)
      };
      tracePath(ctx, pad + inset, pad + inset, width - borderWidth, height - borderWidth, borderRadius);
      ctx.lineWidth = borderWidth;
      ctx.strokeStyle = hexToCss(options.border);
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
  }

  const texture = configureHudCanvasTexture(new THREE.CanvasTexture(canvas));
  const rasterized: RasterizedPanel = { texture, padding: pad };

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
