import type { AssetCatalogEntry } from "../../editor-core/assets";
import type { PlanarWfcPalette } from "../planarWfc";
import type { WfcVariant } from "./socketTypes";
import type { AssetSelector, ScenicRecipe, WfcPackDeclaration, WfcPackProfile } from "./packTypes";
import roadPackData from "../../../assets/scene_element/3d-road-tiles/wfc-pack.json";
import { validatePackShape } from "./packShape";

const roadPack = roadPackData as unknown as WfcPackDeclaration & { triggerCategory: string; inferredRoles: string[] };
export const defaultRoadProfile = roadPack.profiles["road-scene"];
/** Every real material token used anywhere in the road-tile pack, derived by scripts/computeMaterialCatalog.ts. */
export const packMaterials: readonly string[] = roadPack.materials ?? [];
export function legacyRoadScene(assets: readonly AssetCatalogEntry[]) { return assets.some((asset) => asset.category === roadPack.triggerCategory); }
export function legacyRoles(asset: AssetCatalogEntry) { return asset.category === roadPack.triggerCategory ? roadPack.inferredRoles : undefined; }

export function matchesAsset(assetId: string, selector: AssetSelector): boolean {
  return Boolean(selector.assetIds?.includes(assetId) || selector.assetIdSuffixes?.some((suffix) => assetId.endsWith(suffix)));
}
export function scenicAssetId(assetId: string, recipe: ScenicRecipe): string {
  return Object.entries(recipe.aliases ?? {}).find(([, selector]) => matchesAsset(assetId, selector))?.[0] ?? assetId;
}
export interface NormalizedPackProfile {
  profile: WfcPackProfile;
  profileName: string;
  dimensions: WfcPackDeclaration["dimensions"];
  legacy: boolean;
  independentPlacementDimensions: boolean;
}
const byPalette = new WeakMap<PlanarWfcPalette, NormalizedPackProfile>();
export function registerPaletteProfile(palette: PlanarWfcPalette, profile: NormalizedPackProfile) { byPalette.set(palette, profile); }
export function paletteProfile(palette: PlanarWfcPalette) { return byPalette.get(palette); }
export function scenicRecipeForPalette(palette: PlanarWfcPalette): ScenicRecipe {
  const recipe = byPalette.get(palette)?.profile.scenic;
  if (!recipe) throw new Error("Scenic planning requires a palette with a selected scenic pack profile or an explicit recipe.");
  return recipe;
}
export function eligibleForProfile(asset: AssetCatalogEntry, variant: WfcVariant, profile: WfcPackProfile): boolean {
  const rule = profile.eligibility;
  return !rule || (!rule.exclude || !matchesAsset(asset.id, rule.exclude)) && (!rule.assetIds || rule.assetIds.includes(asset.id)) && (!rule.requireTopologyOrRole || Boolean(variant.roadTopology || asset.semantics?.roles.includes(rule.requireTopologyOrRole)));
}
/** Resolve declarations at the catalog boundary; no solver sees pack identity. */
export function resolvePackProfile(assets: readonly AssetCatalogEntry[], requested?: string, automatic = false): NormalizedPackProfile {
  const declarations = new Map<string, WfcPackDeclaration>();
  const checked = new Set<WfcPackDeclaration>();
  for (const asset of assets) if (asset.wfcPack !== undefined) {
    if (!checked.has(asset.wfcPack)) { validatePackShape(asset.wfcPack, requested); checked.add(asset.wfcPack); }
    const existing = declarations.get(asset.wfcPack.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(asset.wfcPack)) throw new Error(`Conflicting WFC pack declarations for ${asset.wfcPack.id}.`);
    declarations.set(asset.wfcPack.id, asset.wfcPack);
  }
  const packs = [...declarations.values()];
  if (!packs.length) {
    if (requested && requested !== "road-scene" && requested !== "tiling") throw new Error(`Unsupported legacy WFC profile ${requested}.`);
    const road = requested === "road-scene" || !requested && automatic && legacyRoadScene(assets);
    return { profile: road ? defaultRoadProfile : roadPack.profiles.tiling, profileName: road ? "road-scene" : "tiling", dimensions: roadPack.dimensions, legacy: true, independentPlacementDimensions: true };
  }
  const first = packs[0];
  if (assets.some((asset) => !asset.wfcPack && asset.wfc?.variants.length)) throw new Error("Declared and undeclared WFC packs require an explicit shared pack declaration.");
  if (packs.length > 1) {
    if (!requested && new Set(packs.map((pack) => pack.defaultProfile)).size > 1) throw new Error("Ambiguous WFC pack defaults; select a shared profile explicitly.");
    if (!first.socketNamespace || packs.some((pack) => pack.socketNamespace !== first.socketNamespace)) throw new Error("Combined WFC packs require an explicit shared socket namespace.");
    if (packs.some((pack) => pack.dimensions.sourceTileWidth !== first.dimensions.sourceTileWidth || pack.dimensions.sourceTileDepth !== first.dimensions.sourceTileDepth || Boolean(pack.independentPlacementDimensions) !== Boolean(first.independentPlacementDimensions))) throw new Error("Combined WFC packs have incompatible source dimensions.");
  }
  const profileName = requested ?? (first.catalogProfiles ? automatic ? first.catalogProfiles.automatic : first.catalogProfiles.generic : first.defaultProfile);
  for (const pack of packs) validatePackDeclaration(pack, assets, profileName);
  const profile = first.profiles[profileName];
  if (packs.some((pack) => JSON.stringify(pack.profiles[profileName]) !== JSON.stringify(profile))) throw new Error(`Combined WFC packs disagree on profile ${profileName}.`);
  return { profile, profileName, dimensions: first.dimensions, legacy: false, independentPlacementDimensions: first.independentPlacementDimensions ?? false };
}
export function validatePackDeclaration(pack: WfcPackDeclaration, assets: readonly AssetCatalogEntry[], requestedProfile?: string): void {
  validatePackShape(pack, requestedProfile);
  const profileName = requestedProfile ?? pack.defaultProfile;
  const fail = (message: string): never => { throw new Error(`WFC pack ${pack.id}, profile ${profileName}: ${message}`); };
  if (pack.version !== 1 || !pack.id) fail("requires a version 1 declaration and nonempty id.");
  if (!pack.dimensions || ![pack.dimensions.sourceTileWidth, pack.dimensions.sourceTileDepth].every((value) => Number.isFinite(value) && value > 0)) fail("tiling capability requires positive source dimensions.");
  const profile = pack.profiles?.[profileName];
  if (!profile) fail("unsupported profile.");
  if (!pack.profiles[pack.defaultProfile]) fail(`missing default profile ${pack.defaultProfile}.`);
  for (const name of Object.values(pack.catalogProfiles ?? {})) if (!pack.profiles[name]) fail(`missing catalog profile ${name}.`);
  if (!Array.isArray(pack.capabilities) || !Array.isArray(profile.requires)) fail("capabilities and profile requirements must be arrays.");
  const capabilities = new Set(["tiling", "road", "water", "terrain", "elevation", "boundary", "scenic"]);
  for (const capability of pack.capabilities) if (!capabilities.has(capability)) fail(`unknown capability ${capability}.`);
  for (const capability of profile.requires) if (!pack.capabilities.includes(capability)) fail(`missing required capability ${capability}.`);
  const members = assets.filter((asset) => asset.wfcPack?.id === pack.id);
  const variants = members.flatMap((asset) => asset.wfc?.variants ?? []);
  if (!variants.length || variants.some((variant) => ["north", "east", "south", "west"].some((direction) => !variant.sockets?.[direction as "north"]))) fail("tiling capability requires nonempty planar sockets.");
  const roles = new Set(members.flatMap((asset) => asset.semantics?.roles ?? pack.inferredRoles ?? []));
  const channels = new Set(members.flatMap((asset) => Object.values(asset.semantics?.sockets ?? {}).map((socket) => socket.type)));
  if (variants.some((variant) => variant.roadTopology && Object.keys(variant.roadTopology.edges).length)) channels.add("road");
  for (const capability of profile.requires) {
    if (capability === "road" && !channels.has("road")) fail("road capability is missing road channel/topology references.");
    if (capability === "water" && (!channels.has("water") || !roles.has("terrain.water"))) fail("water capability is missing water channel or terrain.water role references.");
    if (capability === "terrain" && !roles.has("terrain.ground")) fail("terrain capability is missing terrain.ground role references.");
    if (capability === "elevation" && !profile.scenic?.terrain.length) fail("elevation capability is missing terrain corner-mask assemblies.");
    if (capability === "boundary" && !profile.references?.channels?.length) fail("boundary capability is missing channel references.");
    if (capability === "scenic" && !profile.scenic) fail("scenic capability is missing ordered assembly recipes.");
  }
  for (const role of profile.references?.roles ?? []) if (!roles.has(role)) fail(`missing role reference ${role}.`);
  for (const channel of profile.references?.channels ?? []) if (!channels.has(channel)) fail(`missing channel reference ${channel}.`);
  for (const id of profile.references?.variantIds ?? []) if (!variants.some((variant) => variant.variantId === id)) fail(`missing variant reference ${id}.`);
  const allIds = new Set(assets.map((asset) => asset.id));
  const usableIds = new Set(assets.filter((asset) => asset.wfc?.variants.length).map((asset) => asset.id));
  for (const [name, selector] of Object.entries(profile.adjacency ?? {})) {
    for (const id of selector.assetIds ?? []) if (!allIds.has(id)) fail(`adjacency ${name} missing asset reference ${id}.`);
    for (const suffix of selector.assetIdSuffixes ?? []) if (![...allIds].some((id) => id.endsWith(suffix))) fail(`adjacency ${name} missing selector ${suffix}.`);
  }
  if (profile.worldPlan && (profile.worldPlan.roadCoverage < 0 || profile.worldPlan.roadCoverage > 1)) fail("worldPlan.roadCoverage must be between 0 and 1.");
  if (profile.worldPlan && !pack.capabilities.includes("road")) fail("world plan requires road capability.");
  if (profile.worldPlan?.scenic && !profile.scenic) fail("scenic world plan is missing scenic assembly recipes.");
  if (profile.scenic && !pack.capabilities.includes("scenic")) fail("assembly recipes require scenic capability.");
  if (profile.scenic) {
    const r = profile.scenic;
    const refs = [r.ground, r.straightRoad, r.crosswalk, r.junction, r.crossing, r.mountainPass, ...r.ordinaryRoads, ...r.lakeRoads, ...r.lakeMargins, ...r.terrain.map((part) => part.assetId), r.roundabout.island, r.roundabout.corner, r.roundabout.entrance, r.roundabout.closedExit, ...r.smoothCorner.map((part) => part.id), r.overpass.deck, ...r.overpass.members, ...r.overpass.supports, ...r.overpass.approaches, ...r.overpass.transverseCuts, r.water.core, ...r.water.banks, ...r.water.exclusions, ...r.water.bridges.flatMap((bridge) => [bridge.id, ...bridge.approaches])];
    for (const id of refs) if (!allIds.has(id)) fail(`scenic capability missing assembly member ${id}.`);
    for (const id of [r.ground, r.straightRoad, r.crosswalk, r.junction, r.crossing, r.mountainPass, r.roundabout.island, r.roundabout.corner, r.roundabout.entrance, r.roundabout.closedExit, ...r.smoothCorner.map((part) => part.id), r.overpass.deck, r.water.core, ...r.water.bridges.map((part) => part.id)]) if (!usableIds.has(id)) fail(`scenic capability assembly member ${id} has no usable variants.`);
    if (!r.stages.length || !r.water.bridges.length || !r.terrain.length || !r.smoothCorner.length) fail("scenic capability requires ordered stages, bridges, terrain and corner assemblies.");
    for (const part of r.terrain) if (!/^[01]{4}$/.test(part.cornerMask)) fail(`elevation assembly ${part.assetId} requires a four-corner mask.`);
    if (!(r.water.coreWeightMultiplier > 0) || !Number.isFinite(r.water.coreWeightMultiplier)) fail("water core weight multiplier must be finite and positive.");
    for (const bridge of r.water.bridges) if (![bridge.clearance, bridge.coreDistance, bridge.minimumSpan].every((value) => Number.isInteger(value) && value > 0)) fail(`bridge ${bridge.id} requires positive integer selection parameters.`);
    const operations = new Set(["addStreets", "bridgeLakes", "growStreets", "junctions", "overpasses", "roundabouts", "bendRoads", "smoothCorners", "mountainPasses", "standaloneLakes", "terrain"]);
    for (const stage of r.stages) if (!operations.has(stage.operation)) fail(`unknown scenic operation ${stage.operation}.`);
    for (const part of r.smoothCorner) if (![part.column, part.row].every(Number.isInteger) || part.before.some((direction) => !["north", "east", "south", "west"].includes(direction))) fail(`smooth corner ${part.id} requires integer offsets and planar directions.`);
    for (const stage of r.stages) {
      if (stage.minimum !== undefined && (!Number.isInteger(stage.minimum) || stage.minimum < 0)) fail(`scenic stage ${stage.operation} requires a nonnegative integer minimum.`);
      if (stage.elevation !== undefined && stage.elevation !== "high" && stage.elevation !== "low") fail(`scenic stage ${stage.operation} requires high or low elevation.`);
    }
    for (const stage of r.stages) if (stage.areaDivisor !== undefined && !(stage.areaDivisor > 0)) fail(`scenic stage ${stage.operation} requires positive area divisor.`);
  }
}
