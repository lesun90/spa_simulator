import * as THREE from "three";
import { theme } from "../../app/theme";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import { disposeObject } from "../../engine/disposeObject";

export type ObjectTransformControlMode = "rotate" | "scale";

export interface ObjectTransformControlHandlers {
  onPointerDown(mode: ObjectTransformControlMode, event: { x: number; y: number }): void;
  onPointerMove(event: { x: number; y: number }): void;
  onPointerUp(event: { x: number; y: number }): void;
  onResizeHover(cursor: string): void;
}

/** Shared selection outline and ground-plane rotate/resize affordances for Studio objects. */
export class ObjectTransformControls {
  readonly root = new THREE.Group();

  private readonly outline: THREE.Box3Helper;
  private readonly rotateHandle = new RotateHandleControl();
  private readonly resizeEdges: ResizeEdgeControl[] = [];
  private readonly unregisters: Array<() => void> = [];

  constructor(box: THREE.Box3, interaction: InteractionSystem, handlers: ObjectTransformControlHandlers) {
    this.outline = new THREE.Box3Helper(box, theme.selectionHighlight.hex);
    this.root.add(this.outline, this.rotateHandle.root);
    this.unregisters.push(
      interaction.register(this.rotateHandle.root, {
        onPointerDown: (event) => handlers.onPointerDown("rotate", event),
        onPointerMove: (event) => handlers.onPointerMove(event),
        onPointerUp: (event) => handlers.onPointerUp(event),
        onHover: () => {
          this.rotateHandle.setHovered(true);
          handlers.onResizeHover("ew-resize");
        },
        onLeave: () => {
          this.rotateHandle.setHovered(false);
          handlers.onResizeHover("default");
        }
      })
    );

    for (let index = 0; index < 4; index += 1) {
      const edge = new ResizeEdgeControl();
      this.resizeEdges.push(edge);
      this.root.add(edge.mesh);
      this.unregisters.push(
        interaction.register(edge.mesh, {
          onPointerDown: (event) => handlers.onPointerDown("scale", event),
          onPointerMove: (event) => handlers.onPointerMove(event),
          onPointerUp: (event) => handlers.onPointerUp(event),
          onHover: () => {
            edge.setHovered(true);
            handlers.onResizeHover(edge.cursor);
          },
          onLeave: () => {
            edge.setHovered(false);
            handlers.onResizeHover("default");
          }
        })
      );
    }

    this.setBox(box);
  }

  setBox(box: THREE.Box3): void {
    this.outline.box.copy(box);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const y = box.max.y + 0.06;
    const halfX = Math.max(size.x / 2, 0.3);
    const halfZ = Math.max(size.z / 2, 0.3);
    const rotateRadius = Math.max(halfX, halfZ) + 0.18;

    this.rotateHandle.setTransform(center.x, box.max.y + 0.12, center.z, rotateRadius);
    this.resizeEdges[0].setTransform(center.x, y, center.z - halfZ, halfX * 2, 0, "ns-resize");
    this.resizeEdges[1].setTransform(center.x + halfX, y, center.z, halfZ * 2, Math.PI / 2, "ew-resize");
    this.resizeEdges[2].setTransform(center.x, y, center.z + halfZ, halfX * 2, 0, "ns-resize");
    this.resizeEdges[3].setTransform(center.x - halfX, y, center.z, halfZ * 2, Math.PI / 2, "ew-resize");
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const unregister of this.unregisters) unregister();
    disposeObject(this.root);
  }
}

class RotateHandleControl {
  readonly root = new THREE.Group();
  private readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    const material = new THREE.MeshBasicMaterial({
      color: theme.selectionHighlight.hex,
      transparent: true,
      opacity: 0.54,
      depthTest: false
    });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 8, 64), material);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.renderOrder = 2;
    const hitRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.11, 8, 64),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitRing.rotation.x = Math.PI / 2;
    this.root.add(hitRing, this.ring);
  }

  setTransform(x: number, y: number, z: number, radius: number): void {
    this.root.position.set(x, y, z);
    this.root.scale.setScalar(Math.max(radius, 0.42));
  }

  setHovered(hovered: boolean): void {
    this.ring.material.color.set(hovered ? theme.assetPlaceholderTemporary.hex : theme.selectionHighlight.hex);
    this.ring.material.opacity = hovered ? 0.86 : 0.54;
  }
}

class ResizeEdgeControl {
  readonly mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.1, 0.1),
    new THREE.MeshBasicMaterial({ color: theme.selectionHighlight.hex, transparent: true, opacity: 0.28 })
  );
  cursor = "ew-resize";

  setTransform(x: number, y: number, z: number, length: number, rotationY: number, cursor: string): void {
    this.cursor = cursor;
    this.mesh.position.set(x, y, z);
    this.mesh.scale.set(Math.max(length, 0.3), 1, 1);
    this.mesh.rotation.y = rotationY;
  }

  setHovered(hovered: boolean): void {
    this.mesh.material.color.set(hovered ? theme.assetPlaceholderTemporary.hex : theme.selectionHighlight.hex);
    this.mesh.material.opacity = hovered ? 0.85 : 0.28;
  }
}
