import type { WfcMetadata, WfcVariant } from "./metadata/socketTypes";

export function resolveVariantWeight(metadata: WfcMetadata, variant: WfcVariant) {
  return variant.weight ?? metadata.defaultWeight ?? 1;
}

export function validateWfcWeights(metadata: WfcMetadata | undefined) {
  if (!metadata) return [];
  const diagnostics: string[] = [];
  validateWeight(metadata.defaultWeight, "WFC default weight", diagnostics);
  for (const variant of metadata.variants) {
    validateWeight(variant.weight, `WFC variant ${variant.variantId} weight`, diagnostics);
  }
  return diagnostics;
}

function validateWeight(value: number | undefined, label: string, diagnostics: string[]) {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) diagnostics.push(`${label} must be a positive finite number.`);
}
