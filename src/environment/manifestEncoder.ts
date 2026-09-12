import { createHash } from "node:crypto";
import type { EnvironmentManifest } from "./types";

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Sorts every identifier-keyed array so re-exporting the same logical content produces the same manifest. */
export function encodeManifest(manifest: EnvironmentManifest): EnvironmentManifest {
  return {
    ...manifest,
    chunks: sortById(manifest.chunks),
    assets: sortById(manifest.assets),
    cells: sortById(manifest.cells),
    objects: sortById(manifest.objects),
    ground: manifest.ground ? { ...manifest.ground, chunkIds: [...manifest.ground.chunkIds].sort(byCodepoint) } : manifest.ground,
    provenance: { ...manifest.provenance, generationRuns: [...manifest.provenance.generationRuns].sort((a, b) => a.seed - b.seed) },
    navigation: {
      nodes: sortById(manifest.navigation.nodes),
      edges: sortById(manifest.navigation.edges)
    },
    diagnostics: [...manifest.diagnostics].sort(byCodepoint)
  };
}

/** Deterministic JSON with alphabetically sorted object keys, so byte-for-byte diffs reflect real content changes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

/** Plain UTF-16 codepoint comparison, independent of host locale/ICU — required for byte-identical output. */
function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortById<T extends { id: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((a, b) => byCodepoint(a.id, b.id));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => byCodepoint(a, b)).map(([key, entry]) => [key, sortKeys(entry)]));
  }
  return value;
}
