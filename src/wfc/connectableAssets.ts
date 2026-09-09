import * as THREE from "three";
import type { AssetCatalogEntry } from "../editor-core/assets";
import type { SceneObject } from "../editor-core/scene";
import { oppositeDirections, type WfcDirection, type WfcVariant } from "./metadata/socketTypes";

const CONNECTABLE_DIRECTIONS = ["north", "east", "south", "west"] as const;

export function connectableAssetIdsForObject(object: SceneObject | null, assets: AssetCatalogEntry[]): Set<string> {
  if (!object) return new Set();
  const sourceAsset = assets.find((asset) => asset.id === object.assetId);
  const variant = sourceAsset ? variantForRotation(sourceAsset.wfc?.variants, object.rotationY) : null;
  if (!variant) return new Set();

  const connectableIds = new Set<string>();
  for (const asset of assets) {
    if (asset.id === object.assetId || !asset.wfc?.variants?.length) continue;
    if (CONNECTABLE_DIRECTIONS.some((direction) => connectsInDirection(variant, direction, asset))) connectableIds.add(asset.id);
  }

  return connectableIds;
}

function variantForRotation(variants: WfcVariant[] | undefined, radians: number): WfcVariant | null {
  if (!variants?.length) return null;
  const degrees = normalizedDegrees(Math.round(THREE.MathUtils.radToDeg(radians) / 90) * 90);
  return (
    variants.find((variant) => normalizedDegrees(variant.rotationDegrees) === degrees) ??
    variants.find((variant) => normalizedDegrees(variant.rotationDegrees) === 0) ??
    variants[0]
  );
}

function connectsInDirection(source: WfcVariant, direction: WfcDirection, candidate: AssetCatalogEntry): boolean {
  const sourceSocket = source.sockets[direction];
  const candidateDirection = oppositeDirections[direction];
  return candidate.wfc?.variants.some((variant) => variant.sockets[candidateDirection] === sourceSocket) ?? false;
}

function normalizedDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
