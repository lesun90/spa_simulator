import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { AgentAssetReference, AgentChoice, Vector3Value, WheelDescriptor } from "../../src/scenario-studio/domain/agent";
import { findDuplicateIds, readJsonAssetMetadata, type AssetMetadata } from "../assetCatalog";

interface VehicleWheelMetadata {
  id?: unknown;
  wheelNode?: unknown;
  steeringNode?: unknown;
  suspensionNode?: unknown;
  position?: unknown;
  radius?: unknown;
  width?: unknown;
  steerable?: unknown;
}

interface VehicleMetadata {
  model?: unknown;
  units?: unknown;
  bounds?: { min?: unknown; max?: unknown };
  collision?: { type?: unknown; center?: unknown; halfExtents?: unknown };
  wheels?: unknown;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Discovers Scenario Studio agents exclusively below assets/agents. */
export class PublishedAgents {
  constructor(private readonly root: string) {}

  async list(): Promise<AgentChoice[]> {
    const root = await realpath(this.root);
    const folders: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
      if (directory !== root && files.some((name) => name === "asset.json" || name === "vehicle.json" || extname(name).toLowerCase() === ".glb")) folders.push(directory);
      await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => visit(join(directory, entry.name))));
    };
    await visit(root);
    const choices = await Promise.all(folders.map((folder) => this.readChoice(root, folder)));
    const duplicates = findDuplicateIds(choices.map((choice) => ({ id: choice.asset.id })));
    return choices.map((choice) => duplicates.has(choice.asset.id)
      ? unavailable(choice, `Duplicate agent asset ID ${choice.asset.id}.`)
      : choice).sort((a, b) => a.asset.label.localeCompare(b.asset.label));
  }

  async source(relativePath: string): Promise<Buffer> {
    const root = await realpath(this.root);
    const target = await realpath(resolve(root, relativePath));
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Asset path is outside the published agent directory.");
    return readFile(target);
  }

  private async readChoice(root: string, folder: string): Promise<AgentChoice> {
    const key = relative(root, folder).split(sep).join("/");
    const diagnostics: string[] = [];
    const assetBytes = await readFile(join(folder, "asset.json")).catch(() => null);
    const metadataDiagnosticStart = diagnostics.length;
    let assetMetadata: AssetMetadata = assetBytes ? await readJsonAssetMetadata(join(folder, "asset.json"), diagnostics) : {};
    if (assetBytes && diagnostics.length > metadataDiagnosticStart) diagnostics.splice(metadataDiagnosticStart, diagnostics.length - metadataDiagnosticStart, "asset.json is not valid JSON.");
    if (!assetBytes) diagnostics.push("asset.json is missing.");
    if (!assetMetadata || typeof assetMetadata !== "object" || Array.isArray(assetMetadata)) {
      diagnostics.push("asset.json must contain an object."); assetMetadata = {};
    }

    const names = await readdir(folder);
    const vehicleBytes = names.includes("vehicle.json") ? await readFile(join(folder, "vehicle.json")).catch(() => null) : null;
    let vehicle: VehicleMetadata = {};
    if (vehicleBytes) {
      try { vehicle = JSON.parse(vehicleBytes.toString("utf8")) as VehicleMetadata; }
      catch { diagnostics.push("vehicle.json is not valid JSON."); }
    }
    if (!vehicleBytes) diagnostics.push("vehicle.json is missing.");
    if (!vehicle || typeof vehicle !== "object" || Array.isArray(vehicle)) {
      diagnostics.push("vehicle.json must contain an object."); vehicle = {};
    }

    const requestedModel = typeof vehicle.model === "string" ? vehicle.model : names.find((name) => extname(name).toLowerCase() === ".glb");
    if (!requestedModel || basename(requestedModel) !== requestedModel || extname(requestedModel).toLowerCase() !== ".glb") diagnostics.push("vehicle.json must name a contained GLB model.");
    const modelBytes = requestedModel ? await readFile(join(folder, requestedModel)).catch(() => null) : null;
    if (requestedModel && !modelBytes) diagnostics.push(`Agent model ${requestedModel} is missing.`);
    if (vehicle.units !== "meters") diagnostics.push("Agent vehicle units must be meters.");

    const boundsMin = vector(vehicle.bounds?.min, "Vehicle bounds min", diagnostics, { x: -0.5, y: 0, z: -0.5 });
    const boundsMax = vector(vehicle.bounds?.max, "Vehicle bounds max", diagnostics, { x: 0.5, y: 1, z: 0.5 });
    if (boundsMax.x <= boundsMin.x || boundsMax.y <= boundsMin.y || boundsMax.z <= boundsMin.z) diagnostics.push("Vehicle bounds must have positive dimensions.");
    if (vehicle.collision?.type !== "box") diagnostics.push("Only box agent collision metadata is supported.");
    const collisionCenter = vector(vehicle.collision?.center, "Collision center", diagnostics, { x: 0, y: 0.5, z: 0 });
    const collisionHalfExtents = vector(vehicle.collision?.halfExtents, "Collision half-extents", diagnostics, { x: 0.5, y: 0.5, z: 0.5 }, true);
    const wheels = Array.isArray(vehicle.wheels) ? vehicle.wheels.map((item, index) => wheelDescriptor(item as VehicleWheelMetadata, index, diagnostics)).filter((item): item is WheelDescriptor => item !== null) : undefined;
    const id = typeof assetMetadata.id === "string" && assetMetadata.id.trim() ? assetMetadata.id.trim() : key.replaceAll("/", ".");
    if (typeof assetMetadata.id !== "string" || !assetMetadata.id.trim()) diagnostics.push("asset.json id is required.");
    const label = typeof assetMetadata.label === "string" && assetMetadata.label.trim() ? assetMetadata.label.trim() : basename(folder).replace(/[-_]/g, " ");
    const category = typeof assetMetadata.category === "string" && assetMetadata.category.trim() ? assetMetadata.category.trim() : key.split("/")[0] ?? "agents";
    const thumbnail = names.includes("preview.png") ? "preview.png" : names.find((name) => extname(name).toLowerCase() === ".png") ?? null;
    const urlBase = `/scenario-assets/agents/${key.split("/").map(encodeURIComponent).join("/")}`;
    const asset: AgentAssetReference = {
      id, key, label, category,
      modelUrl: requestedModel ? `${urlBase}/${encodeURIComponent(requestedModel)}` : "",
      thumbnailUrl: thumbnail ? `${urlBase}/${encodeURIComponent(thumbnail)}` : null,
      modelSha256: modelBytes ? sha256(modelBytes) : "",
      metadataSha256: sha256(Buffer.concat([assetBytes ?? Buffer.alloc(0), vehicleBytes ?? Buffer.alloc(0)])),
      unitsPerMeter: 1,
      bounds: { min: boundsMin, max: boundsMax },
      collision: { center: collisionCenter, halfExtents: collisionHalfExtents },
      ...(wheels?.length ? { wheels } : {})
    };
    return { asset, available: diagnostics.length === 0, diagnostics };
  }
}

function vector(value: unknown, label: string, diagnostics: string[], fallback: Vector3Value, positive = false): Vector3Value {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== "number" || !Number.isFinite(item)) || (positive && value.some((item) => item <= 0))) {
    diagnostics.push(`${label} must contain three ${positive ? "positive " : ""}finite numbers.`);
    return fallback;
  }
  return { x: value[0], y: value[1], z: value[2] };
}

function wheelDescriptor(value: VehicleWheelMetadata, index: number, diagnostics: string[]): WheelDescriptor | null {
  const label = `Vehicle wheel #${index}`;
  if (typeof value.id !== "string" || !value.id.trim()) { diagnostics.push(`${label} id is required.`); return null; }
  if (typeof value.wheelNode !== "string" || !value.wheelNode.trim()) { diagnostics.push(`${label} wheelNode is required.`); return null; }
  if (typeof value.steeringNode !== "string" || !value.steeringNode.trim()) { diagnostics.push(`${label} steeringNode is required.`); return null; }
  if (typeof value.suspensionNode !== "string" || !value.suspensionNode.trim()) { diagnostics.push(`${label} suspensionNode is required.`); return null; }
  const position = vector(value.position, `${label} position`, diagnostics, { x: 0, y: 0.3, z: 0 });
  if (typeof value.radius !== "number" || !Number.isFinite(value.radius) || value.radius <= 0) { diagnostics.push(`${label} radius must be a positive number.`); return null; }
  if (typeof value.steerable !== "boolean") { diagnostics.push(`${label} steerable must be a boolean.`); return null; }
  const widthValid = typeof value.width === "number" && Number.isFinite(value.width) && value.width > 0;
  if (value.width !== undefined && !widthValid) diagnostics.push(`${label} width must be a positive number; using a fallback derived from radius.`);
  const width = widthValid ? (value.width as number) : value.radius * 0.7;
  return { id: value.id, wheelNode: value.wheelNode, steeringNode: value.steeringNode, suspensionNode: value.suspensionNode, position, radius: value.radius, width, steerable: value.steerable };
}

function unavailable(choice: AgentChoice, diagnostic: string): AgentChoice {
  return { ...choice, available: false, diagnostics: [...choice.diagnostics, diagnostic] };
}
