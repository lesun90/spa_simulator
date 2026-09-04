import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { AssetManager } from "../engine/AssetManager";
import type { AssetCatalogEntry } from "../editor-core/assets";
import { listAssets } from "../api/client";
import { type AssetViewAngle, parseAssetViewerParams, viewDirectionForAngle } from "./viewerParams";
import "./style.css";

const canvas = document.getElementById("asset-viewer") as HTMLCanvasElement | null;

if (!canvas) {
  throw new Error("Asset viewer canvas was not found.");
}

class AssetViewer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly assetManager = new AssetManager();
  private readonly assetRoot = new THREE.Group();
  private readonly grid = new THREE.GridHelper(12, 24, 0x6f7b85, 0x30363d);
  private readonly axes = new THREE.AxesHelper(1.4);
  private readonly boundsHelper = new THREE.Box3Helper(new THREE.Box3(), 0x8fd0ff);
  private readonly panel = createPanel();
  private readonly params = parseAssetViewerParams(window.location.search);
  private assets: AssetCatalogEntry[] = [];
  private selectedAsset: AssetCatalogEntry | null = null;
  private angle: AssetViewAngle = this.params.angle;
  private spin = this.params.spin;
  private debug = this.params.debug;
  private lastTime = performance.now();
  private animationId = 0;

  constructor(private readonly hostCanvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas: hostCanvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x151719, 1);

    this.controls = new OrbitControls(this.camera, hostCanvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0.5, 0);

    this.scene.background = new THREE.Color(0x151719);
    this.scene.add(this.assetRoot);
    this.scene.add(this.grid);
    this.scene.add(this.axes);
    this.scene.add(this.boundsHelper);
    this.addLights();
    this.addGround();

    this.grid.visible = this.params.grid;
    this.axes.visible = this.debug;
    this.boundsHelper.visible = this.debug;

    if (this.params.ui) document.body.appendChild(this.panel.root);
    this.bindPanel();
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  async start() {
    try {
      this.setStatus("Loading catalog");
      this.assets = await listAssets();
      this.populateAssetSelect();
      const initialAsset = this.assets.find((asset) => asset.id === this.params.assetId) ?? this.assets[0] ?? null;

      if (!initialAsset) {
        this.setStatus("No assets found", "error");
        this.setAgentStatus("empty");
      } else {
        await this.loadAsset(initialAsset);
      }
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "Asset viewer failed", "error");
      this.setAgentStatus("error");
    }

    this.animate();
  }

  private async loadAsset(asset: AssetCatalogEntry) {
    this.selectedAsset = asset;
    this.panel.asset.value = asset.id;
    this.setAgentStatus("loading");
    this.setStatus(`Loading ${asset.label}`);

    clearObject(this.assetRoot);
    const object = await this.assetManager.instantiate(asset);
    object.name = asset.label;
    prepareForViewing(object);
    this.assetRoot.add(object);
    this.frameAsset();

    this.setStatus(`${asset.label} ready`);
    this.setAgentStatus("ready", asset.id);
  }

  private frameAsset() {
    const bounds = new THREE.Box3().setFromObject(this.assetRoot);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z, 0.5);
    const distance = maxSize * 2.45;
    const direction = new THREE.Vector3(...viewDirectionForAngle(this.angle)).normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center).add(direction.multiplyScalar(distance));
    this.camera.near = Math.max(0.01, distance / 100);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(0.2, maxSize * 0.35);
    this.controls.maxDistance = Math.max(4, maxSize * 8);
    this.controls.update();

    this.boundsHelper.box.copy(bounds);
    const gridSize = Math.max(4, Math.ceil(maxSize * 3));
    this.grid.scale.setScalar(gridSize / 12);
  }

  private addLights() {
    this.scene.add(new THREE.HemisphereLight(0xd8edf5, 0x30363a, 1.3));

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    this.scene.add(key.target);

    const fill = new THREE.DirectionalLight(0xb8d7ff, 0.9);
    fill.position.set(-5, 3, -4);
    this.scene.add(fill);
  }

  private addGround() {
    const geometry = new THREE.PlaneGeometry(80, 80);
    const material = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.24 });
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private bindPanel() {
    this.panel.asset.addEventListener("change", () => {
      const asset = this.assets.find((entry) => entry.id === this.panel.asset.value);
      if (asset) void this.loadAsset(asset);
    });

    this.panel.angle.addEventListener("change", () => {
      this.angle = this.panel.angle.value as AssetViewAngle;
      this.frameAsset();
    });

    this.panel.grid.addEventListener("click", () => {
      this.grid.visible = !this.grid.visible;
      this.panel.grid.setAttribute("aria-pressed", String(this.grid.visible));
    });

    this.panel.spin.addEventListener("click", () => {
      this.spin = !this.spin;
      this.panel.spin.setAttribute("aria-pressed", String(this.spin));
    });

    this.panel.debug.addEventListener("click", () => {
      this.debug = !this.debug;
      this.axes.visible = this.debug;
      this.boundsHelper.visible = this.debug;
      this.panel.debug.setAttribute("aria-pressed", String(this.debug));
    });

    this.panel.reset.addEventListener("click", () => this.frameAsset());
  }

  private populateAssetSelect() {
    this.panel.asset.replaceChildren();
    for (const asset of this.assets) {
      const option = document.createElement("option");
      option.value = asset.id;
      option.textContent = `${asset.label} (${asset.id})`;
      this.panel.asset.appendChild(option);
    }
    this.panel.angle.value = this.angle;
    this.panel.grid.setAttribute("aria-pressed", String(this.grid.visible));
    this.panel.spin.setAttribute("aria-pressed", String(this.spin));
    this.panel.debug.setAttribute("aria-pressed", String(this.debug));
  }

  private resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  private animate = () => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.spin) this.assetRoot.rotation.y += dt * 0.75;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationId = requestAnimationFrame(this.animate);
  };

  private setStatus(message: string, tone: "neutral" | "error" = "neutral") {
    this.panel.status.textContent = message;
    this.panel.status.dataset.tone = tone;
  }

  private setAgentStatus(status: string, assetId = "") {
    document.body.dataset.viewerStatus = status;
    document.body.dataset.assetId = assetId;
  }

  dispose() {
    cancelAnimationFrame(this.animationId);
    this.controls.dispose();
    clearObject(this.assetRoot);
    this.renderer.dispose();
    this.panel.root.remove();
  }
}

function createPanel() {
  const root = document.createElement("section");
  root.className = "viewer-panel";
  root.setAttribute("aria-label", "Asset viewer controls");

  const asset = document.createElement("select");
  asset.className = "viewer-select";
  asset.setAttribute("aria-label", "Asset");

  const angle = document.createElement("select");
  angle.className = "viewer-select";
  angle.setAttribute("aria-label", "Camera angle");
  for (const value of ["iso", "front", "side", "top"] satisfies AssetViewAngle[]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    angle.appendChild(option);
  }

  const grid = createButton("Grid", true);
  const spin = createButton("Spin", false);
  const debug = createButton("Debug", false);
  const reset = createButton("Reset", false);
  const status = document.createElement("div");
  status.className = "viewer-status";

  root.append(
    createRow("Asset", asset),
    createRow("Angle", angle),
    createActions(grid, spin, debug, reset),
    status
  );

  return { root, asset, angle, grid, spin, debug, reset, status };
}

function createRow(labelText: string, control: HTMLElement) {
  const row = document.createElement("label");
  row.className = "viewer-row";
  const label = document.createElement("span");
  label.className = "viewer-label";
  label.textContent = labelText;
  row.append(label, control);
  return row;
}

function createActions(...buttons: HTMLButtonElement[]) {
  const actions = document.createElement("div");
  actions.className = "viewer-actions";
  actions.append(...buttons);
  return actions;
}

function createButton(label: string, pressed: boolean) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "viewer-button";
  button.textContent = label;
  button.setAttribute("aria-pressed", String(pressed));
  return button;
}

function prepareForViewing(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!isMesh(child)) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

function clearObject(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
  }
  group.rotation.set(0, 0, 0);
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

void new AssetViewer(canvas).start();
