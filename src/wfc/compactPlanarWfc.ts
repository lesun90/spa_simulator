import { type PlanarDirection, planarDirections, type PlanarWfcPalette, type PlanarWfcVariant } from "./planarWfc";

export interface CompactPlanarPalette {
  variantCount: number;
  socketIds: Uint32Array;
  weights: Float64Array;
  compatibility: Uint32Array;
  roles: readonly (readonly string[])[];
  semanticPorts: readonly (Partial<Record<PlanarDirection, readonly string[]>> | undefined)[];
}

export interface CompactPlanarDescriptor {
  id: string;
  assetId: string;
  rotationDegrees: number;
}

export interface PreparedPlanarPalette {
  palette: PlanarWfcPalette;
  compact: CompactPlanarPalette;
  descriptors: readonly CompactPlanarDescriptor[];
  byteLength: number;
}

export function preparePlanarPalette(palette: PlanarWfcPalette): PreparedPlanarPalette {
  const variants = [...palette.variants].sort((a, b) => a.id.localeCompare(b.id));
  const socketValues = [...new Set(variants.flatMap((variant) => planarDirections.map((direction) => variant.sockets[direction])))].sort();
  const socketId = new Map(socketValues.map((socket, index) => [socket, index]));
  const socketIds = new Uint32Array(variants.length * planarDirections.length);
  const weights = new Float64Array(variants.length);
  const indexes = new Map(variants.map((variant, index) => [variant.id, index]));
  const words = Math.ceil(variants.length / 32);
  const compatibility = new Uint32Array(variants.length * planarDirections.length * words);
  for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
    const variant = variants[variantIndex];
    weights[variantIndex] = variant.weight;
    for (let directionIndex = 0; directionIndex < planarDirections.length; directionIndex++) {
      const direction = planarDirections[directionIndex];
      socketIds[variantIndex * planarDirections.length + directionIndex] = socketId.get(variant.sockets[direction])!;
      for (const candidateId of palette.adjacency[variant.id]?.[direction] ?? []) {
        const candidate = indexes.get(candidateId);
        if (candidate === undefined) continue;
        const offset = (variantIndex * planarDirections.length + directionIndex) * words + (candidate >>> 5);
        compatibility[offset] |= 1 << (candidate & 31);
      }
    }
  }
  const compact = { variantCount: variants.length, socketIds, weights, compatibility, roles: variants.map((variant) => variant.roles ?? []), semanticPorts: variants.map((variant) => variant.semanticPorts) };
  return {
    palette: { ...palette, variants }, compact,
    descriptors: variants.map(({ id, assetId, rotationDegrees }) => ({ id, assetId, rotationDegrees })),
    byteLength: socketIds.byteLength + weights.byteLength + compatibility.byteLength
  };
}

export function cloneCompactPalette(compact: CompactPlanarPalette): CompactPlanarPalette {
  return { variantCount: compact.variantCount, socketIds: compact.socketIds.slice(), weights: compact.weights.slice(), compatibility: compact.compatibility.slice(), roles: compact.roles, semanticPorts: compact.semanticPorts };
}

export function compactDirectionIndex(direction: PlanarDirection) { return planarDirections.indexOf(direction); }
