import type { ValidationResult } from "../editor-core/validation";
import { readGlbInfo } from "./glb";
import { sha256Hex } from "./manifestEncoder";
import type {
  EnvironmentManifest,
  EnvironmentManifestCell,
  EnvironmentManifestNavigationEdge,
  EnvironmentManifestNavigationNode,
  EnvironmentManifestObject,
  Vector3,
  WorldBounds
} from "./types";

type UnknownRecord = Record<string, unknown>;

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

  let navigation: UnknownRecord | undefined;
  if (manifest.navigation !== undefined) {
    if (!manifest.navigation || typeof manifest.navigation !== "object" || Array.isArray(manifest.navigation)) {
      diagnostics.push("Manifest navigation must be an object.");
    } else {
      navigation = manifest.navigation as UnknownRecord;
    }
  }

  // Sanitize every untrusted collection once, up front: wrong-typed collections and non-object
  // elements are recorded as diagnostics here so every loop below can assume well-shaped records.
  const chunkRecords = recordList(manifest.chunks, diagnostics, "chunks");
  const assetRecords = recordList(manifest.assets, diagnostics, "assets");
  const cellRecords = recordList(manifest.cells, diagnostics, "cells") as unknown as readonly EnvironmentManifestCell[];
  const objectRecords = recordList(manifest.objects, diagnostics, "objects") as unknown as readonly EnvironmentManifestObject[];
  const nodeRecords = recordList(navigation?.nodes, diagnostics, "navigation.nodes") as unknown as readonly EnvironmentManifestNavigationNode[];
  const edgeRecords = recordList(navigation?.edges, diagnostics, "navigation.edges") as unknown as readonly EnvironmentManifestNavigationEdge[];

  const chunkIds = idSet(chunkRecords, diagnostics, "chunk");
  const assetIds = idSet(assetRecords, diagnostics, "asset");
  const cellIds = idSet(cellRecords, diagnostics, "cell");
  idSet(objectRecords, diagnostics, "object");
  const nodeIds = idSet(nodeRecords, diagnostics, "navigation node");
  idSet(edgeRecords, diagnostics, "navigation edge");
  const nodesById = new Map(nodeRecords.map((node) => [node.id, node] as const));

  for (const cell of cellRecords) {
    validatePlacedRecord(cell, "Cell", diagnostics);
    if (manifest.grid && (cell.column < 0 || cell.column >= manifest.grid.width || cell.row < 0 || cell.row >= manifest.grid.depth)) {
      diagnostics.push(`Cell ${cell.id} coordinate (${cell.column}, ${cell.row}) is outside the grid bounds.`);
    }
    if (!chunkIds.has(cell.chunkId)) diagnostics.push(`Cell ${cell.id} references unknown chunk ${cell.chunkId}.`);
    if (!assetIds.has(cell.sourceAssetId)) diagnostics.push(`Cell ${cell.id} references unknown asset ${cell.sourceAssetId}.`);
  }

  for (const object of objectRecords) {
    validatePlacedRecord(object, "Object", diagnostics);
    if (!chunkIds.has(object.chunkId)) diagnostics.push(`Object ${object.id} references unknown chunk ${object.chunkId}.`);
    if (!assetIds.has(object.sourceAssetId)) diagnostics.push(`Object ${object.id} references unknown asset ${object.sourceAssetId}.`);
  }

  for (const node of nodeRecords) {
    if (!cellIds.has(node.cellId)) diagnostics.push(`Navigation node ${node.id} references unknown cell ${node.cellId}.`);
  }

  for (const edge of edgeRecords) {
    if (!nodeIds.has(edge.fromNodeId)) diagnostics.push(`Navigation edge ${edge.id} references unknown node ${edge.fromNodeId}.`);
    if (!nodeIds.has(edge.toNodeId)) diagnostics.push(`Navigation edge ${edge.id} references unknown node ${edge.toNodeId}.`);
    if (!isFiniteNumber(edge.cost) || edge.cost < 0) diagnostics.push(`Navigation edge ${edge.id} must have a non-negative finite cost.`);
    if (typeof edge.channel !== "string" || !edge.channel) diagnostics.push(`Navigation edge ${edge.id} requires a channel.`);

    for (const endpointId of new Set([edge.fromNodeId, edge.toNodeId])) {
      const node = nodesById.get(endpointId);
      if (node && (!Array.isArray(node.channels) || !node.channels.includes(edge.channel))) {
        diagnostics.push(`Navigation edge ${edge.id} channel ${edge.channel} is not compatible with node ${node.id}'s channels.`);
      }
    }
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

/**
 * Sanitizes an untrusted field expected to be an array of objects: an absent field is treated as
 * empty, a wrong-typed field is reported and treated as empty, and any non-object element (including
 * null) is dropped and reported rather than left to crash a downstream `.field` access.
 */
function recordList(value: unknown, diagnostics: string[], label: string): readonly UnknownRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(`Manifest ${label} must be an array.`);
    return [];
  }
  const records = value.filter((item) => !!item && typeof item === "object" && !Array.isArray(item));
  if (records.length !== value.length) diagnostics.push(`Manifest ${label} contains a non-object entry.`);
  return records as readonly UnknownRecord[];
}

function idSet(items: readonly unknown[], diagnostics: string[], label: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const id = item && typeof item === "object" ? (item as UnknownRecord).id : undefined;
    if (typeof id !== "string") continue;
    if (ids.has(id)) diagnostics.push(`Duplicate ${label} ID ${id}.`);
    ids.add(id);
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
