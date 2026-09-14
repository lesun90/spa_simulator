import type { PlanarPolicySpec, PlanarWfcPalette, PlanarWfcResult } from "./planarWfc";
import type { SceneObject } from "../editor-core/scene";

export const GENERATED_WFC_NAME_PREFIX = "WFC layout";
export const DEFAULT_WFC_TILE_SIZE = 3;
export interface GenerateWfcLayoutRequest { width: number; depth: number; seed: number; tileWidth?: number; tileDepth?: number; maxBacktracks?: number; policies?: readonly PlanarPolicySpec[]; profile?: string; }
export type GenerateWfcLayoutResult = | { status: "solved"; seed: number; objects: readonly SceneObject[]; palette: PlanarWfcPalette; decisions: number; backtracks: number } | Exclude<PlanarWfcResult, { status: "solved" }>;
export type WfcGenerationProgress = | { status: "building-palette" } | { status: "solving"; cells: number; variants: number; decisions: number; backtracks: number; collapsedCells: number; objects: readonly SceneObject[]; checkpoint?: string } | { status: "placing"; cells: number };
