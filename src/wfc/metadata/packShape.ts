import type { WfcPackDeclaration } from "./packTypes";

type Shape = "string" | "number" | "boolean" | { array: Shape } | { record: Shape } | { fields: Record<string, Shape>; optional?: readonly string[] };
const strings: Shape = { array: "string" };
const selector: Shape = { fields: { assetIds: strings, assetIdSuffixes: strings }, optional: ["assetIds", "assetIdSuffixes"] };
const recipe: Shape = { fields: {
  ground: "string", groundDiagnostic: "string", straightRoad: "string", ordinaryRoads: strings,
  lakeRoads: strings, lakeMargins: strings, crosswalk: "string", junction: "string", crossing: "string",
  terrain: { array: { fields: { assetId: "string", cornerMask: "string" } } }, mountainPass: "string",
  roundabout: { fields: { island: "string", corner: "string", entrance: "string", closedExit: "string", selectors: { record: selector } }, optional: ["selectors"] },
  smoothCorner: { array: { fields: { id: "string", column: "number", row: "number", before: strings } } },
  overpass: { fields: { deck: "string", members: strings, supports: strings, approaches: strings, transverseCuts: strings } },
  water: { fields: { core: "string", coreWeightMultiplier: "number", banks: strings, exclusions: strings,
    bridges: { array: { fields: { id: "string", approaches: strings, clearance: "number", coreDistance: "number", minimumSpan: "number", raisedBanks: "boolean" } } } } },
  stages: { array: { fields: { operation: "string", minimum: "number", areaDivisor: "number", subtractEarlyBridges: "boolean", elevation: "string" }, optional: ["minimum", "areaDivisor", "subtractEarlyBridges", "elevation"] } },
  aliases: { record: selector }
}, optional: ["aliases"] };
const profile: Shape = { fields: {
  requires: strings,
  eligibility: { fields: { exclude: selector, requireTopologyOrRole: "string", assetIds: strings }, optional: ["exclude", "requireTopologyOrRole", "assetIds"] },
  adjacency: { fields: Object.fromEntries(["structures", "centers", "crosswalks", "ground", "water", "mouths", "caps"].map((key) => [key, selector])) },
  scenic: recipe,
  worldPlan: { fields: { roadCoverage: "number", scenic: "boolean" } },
  references: { fields: { roles: strings, channels: strings, variantIds: strings }, optional: ["roles", "channels", "variantIds"] }
}, optional: ["eligibility", "adjacency", "scenic", "worldPlan", "references"] };
const declaration: Shape = { fields: {
  id: "string", version: "number", dimensions: { fields: { sourceTileWidth: "number", sourceTileDepth: "number" } },
  capabilities: strings, defaultProfile: "string", profiles: { record: profile }, socketNamespace: "string",
  catalogProfiles: { fields: { generic: "string", automatic: "string" } }, triggerCategory: "string", inferredRoles: strings,
  independentPlacementDimensions: "boolean", roadWidthFraction: "number"
}, optional: ["socketNamespace", "catalogProfiles", "triggerCategory", "inferredRoles", "independentPlacementDimensions", "roadWidthFraction"] };

/** Reject malformed authored JSON before semantic validation dereferences any nested fields. */
export function validatePackShape(value: unknown, selectedProfile?: string): asserts value is WfcPackDeclaration {
  const header = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const context = `WFC pack ${typeof header.id === "string" ? header.id : "<unknown>"}, profile ${selectedProfile ?? header.defaultProfile ?? "<unknown>"}`;
  inspect(value, declaration, "declaration", (path, expected) => { throw new Error(`${context}: ${path} ${expected}.`); });
}

function inspect(value: unknown, shape: Shape, path: string, fail: (path: string, expected: string) => never): void {
  if (typeof shape === "string") {
    if (typeof value !== shape || shape === "number" && !Number.isFinite(value) || shape === "string" && !(value as string).length) fail(path, `must be a ${shape === "number" ? "finite number" : shape === "string" ? "nonempty string" : "boolean"}`);
    return;
  }
  if ("array" in shape) {
    if (!Array.isArray(value)) fail(path, "must be an array");
    (value as unknown[]).forEach((item, index) => inspect(item, shape.array, `${path}[${index}]`, fail));
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  const object = value as Record<string, unknown>;
  if ("record" in shape) {
    for (const [key, item] of Object.entries(object)) inspect(item, shape.record, `${path}.${key}`, fail);
    return;
  }
  for (const key of Object.keys(object)) if (!Object.hasOwn(shape.fields, key)) fail(`${path}.${key}`, "is not a supported field");
  for (const [key, child] of Object.entries(shape.fields)) {
    if (object[key] === undefined && shape.optional?.includes(key)) continue;
    inspect(object[key], child, `${path}.${key}`, fail);
  }
}

/** Worker transport reuses the authored recipe shape before planning dereferences it. */
export function validateScenicRecipeShape(value: unknown): void {
  inspect(value, recipe, "scenicRecipe", (path, expected) => { throw new Error(`Invalid WFC worker message: ${path} ${expected}.`); });
}
