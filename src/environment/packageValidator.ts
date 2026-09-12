import type { ValidationResult } from "../editor-core/validation";
import { readGlbInfo } from "./glb";
import { sha256Hex } from "./manifestEncoder";
import type { EnvironmentManifest, EnvironmentManifestCell, EnvironmentManifestObject, Vector3, WorldBounds } from "./types";

export function validateEnvironmentPackage(manifestJson: unknown, glbBytes: Uint8Array): ValidationResult {
  const diagnostics: string[] = [];
  const manifest = manifestJson as Partial<EnvironmentManifest> | null;

  if (!manifest || typeof manifest !== "object") {
    return { valid: false, diagnostics: ["environment.json must be an object."] };
  }
  if (manifest.format !== "steerlab-environment") diagnostics.push("Unsupported package format.");
  if (manifest.formatVersion !== 1) diagnostics.push("Unsupported package format version.");
  if (!manifest.model || manifest.model.file !== "environment.glb") diagnostics.push("Manifest model.file must be environment.glb.");

  const glbInfo = readGlbInfo(glbBytes);
  if (!glbInfo.valid) diagnostics.push(glbInfo.error ?? "environment.glb is not a valid GLB file.");
  if (manifest.model && glbInfo.valid && manifest.model.sha256 !== sha256Hex(glbBytes)) {
    diagnostics.push("environment.glb does not match the hash recorded in the manifest.");
  }
  if (glbInfo.valid && manifest.model && !new Set(glbInfo.nodeNames).has(manifest.model.rootNode)) {
    diagnostics.push("environment.glb does not contain the root node named in the manifest.");
  }

  if (!manifest.grid || !isPositiveNumber(manifest.grid.cellSize) || !isPositiveNumber(manifest.grid.width) || !isPositiveNumber(manifest.grid.depth)) {
    diagnostics.push("Manifest grid must define positive width, depth, and cellSize.");
  }
  if (manifest.grid && !isValidBounds(manifest.grid.bounds)) {
    diagnostics.push("Manifest grid bounds must be finite with min not exceeding max on every axis.");
  }

  const chunkIds = idSet(manifest.chunks, diagnostics, "chunk");
  const assetIds = idSet(manifest.assets, diagnostics, "asset");
  const cellIds = idSet(manifest.cells, diagnostics, "cell");
  idSet(manifest.objects, diagnostics, "object");
  const nodeIds = idSet(manifest.navigation?.nodes, diagnostics, "navigation node");

  for (const cell of manifest.cells ?? []) {
    validatePlacedRecord(cell, "Cell", diagnostics);
    if (manifest.grid && (cell.column < 0 || cell.column >= manifest.grid.width || cell.row < 0 || cell.row >= manifest.grid.depth)) {
      diagnostics.push(`Cell ${cell.id} coordinate (${cell.column}, ${cell.row}) is outside the grid bounds.`);
    }
    if (!chunkIds.has(cell.chunkId)) diagnostics.push(`Cell ${cell.id} references unknown chunk ${cell.chunkId}.`);
    if (!assetIds.has(cell.sourceAssetId)) diagnostics.push(`Cell ${cell.id} references unknown asset ${cell.sourceAssetId}.`);
  }

  for (const object of manifest.objects ?? []) {
    validatePlacedRecord(object, "Object", diagnostics);
    if (!chunkIds.has(object.chunkId)) diagnostics.push(`Object ${object.id} references unknown chunk ${object.chunkId}.`);
    if (!assetIds.has(object.sourceAssetId)) diagnostics.push(`Object ${object.id} references unknown asset ${object.sourceAssetId}.`);
  }

  for (const node of manifest.navigation?.nodes ?? []) {
    if (!cellIds.has(node.cellId)) diagnostics.push(`Navigation node ${node.id} references unknown cell ${node.cellId}.`);
  }

  for (const edge of manifest.navigation?.edges ?? []) {
    if (!nodeIds.has(edge.fromNodeId)) diagnostics.push(`Navigation edge ${edge.id} references unknown node ${edge.fromNodeId}.`);
    if (!nodeIds.has(edge.toNodeId)) diagnostics.push(`Navigation edge ${edge.id} references unknown node ${edge.toNodeId}.`);
    if (!isFiniteNumber(edge.cost) || edge.cost < 0) diagnostics.push(`Navigation edge ${edge.id} must have a non-negative finite cost.`);
    if (typeof edge.channel !== "string" || !edge.channel) diagnostics.push(`Navigation edge ${edge.id} requires a channel.`);
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

function idSet(items: readonly { id: string }[] | undefined, diagnostics: string[], label: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items ?? []) {
    if (ids.has(item.id)) diagnostics.push(`Duplicate ${label} ID ${item.id}.`);
    ids.add(item.id);
  }
  return ids;
}

function validatePlacedRecord(record: EnvironmentManifestCell | EnvironmentManifestObject, label: string, diagnostics: string[]) {
  const transform = record.transform;
  if (!transform || !isFiniteVector(transform.position) || !isFiniteNumber(transform.rotationY) || !isFiniteNumber(transform.scale) || transform.scale <= 0) {
    diagnostics.push(`${label} ${record.id} has an invalid transform.`);
  }
}

function isFiniteVector(value: Vector3 | undefined): value is Vector3 {
  return !!value && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}

function isValidBounds(bounds: WorldBounds | undefined): boolean {
  if (!bounds || !isFiniteVector(bounds.min) || !isFiniteVector(bounds.max)) return false;
  return bounds.min.x <= bounds.max.x && bounds.min.y <= bounds.max.y && bounds.min.z <= bounds.max.z;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}
