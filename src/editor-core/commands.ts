import type { Scene, SceneObject } from "./scene";
import { cloneScene } from "./scene";

export interface SceneCommand {
  label: string;
  execute(scene: Scene): Scene;
  undo(scene: Scene): Scene;
}

export interface HistoryState {
  scene: Scene;
  undoStack: SceneCommand[];
  redoStack: SceneCommand[];
}

export function createHistory(scene: Scene): HistoryState {
  return { scene: cloneScene(scene), undoStack: [], redoStack: [] };
}

export function executeCommand(history: HistoryState, command: SceneCommand): HistoryState {
  return {
    scene: command.execute(history.scene),
    undoStack: [...history.undoStack, command],
    redoStack: []
  };
}

export function undo(history: HistoryState): HistoryState {
  const command = history.undoStack.at(-1);
  if (!command) {
    return history;
  }

  return {
    scene: command.undo(history.scene),
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [command, ...history.redoStack]
  };
}

export function redo(history: HistoryState): HistoryState {
  const command = history.redoStack[0];
  if (!command) {
    return history;
  }

  return {
    scene: command.execute(history.scene),
    undoStack: [...history.undoStack, command],
    redoStack: history.redoStack.slice(1)
  };
}

export function addObjectCommand(object: SceneObject): SceneCommand {
  return {
    label: "Place object",
    execute(scene) {
      return { ...cloneScene(scene), objects: [...scene.objects, cloneObject(object)] };
    },
    undo(scene) {
      return { ...cloneScene(scene), objects: scene.objects.filter((item) => item.id !== object.id) };
    }
  };
}

export function deleteObjectCommand(objectId: string): SceneCommand {
  let deleted: SceneObject | undefined;

  return {
    label: "Delete object",
    execute(scene) {
      deleted = scene.objects.find((object) => object.id === objectId);
      return { ...cloneScene(scene), objects: scene.objects.filter((object) => object.id !== objectId) };
    },
    undo(scene) {
      if (!deleted) {
        return scene;
      }

      return { ...cloneScene(scene), objects: [...scene.objects, cloneObject(deleted)] };
    }
  };
}

export function duplicateObjectCommand(objectId: string, duplicateId: string): SceneCommand {
  let duplicate: SceneObject | undefined;

  return {
    label: "Duplicate object",
    execute(scene) {
      const source = scene.objects.find((object) => object.id === objectId);
      if (!source) {
        return scene;
      }

      duplicate = {
        ...cloneObject(source),
        id: duplicateId,
        name: `${source.name} copy`,
        position: { x: source.position.x + 1, y: 0, z: source.position.z + 1 }
      };

      return { ...cloneScene(scene), objects: [...scene.objects, duplicate] };
    },
    undo(scene) {
      return { ...cloneScene(scene), objects: scene.objects.filter((object) => object.id !== duplicateId) };
    }
  };
}

export function updateObjectCommand(
  objectId: string,
  patch: Partial<Pick<SceneObject, "name" | "position" | "rotationY" | "scale">>
): SceneCommand {
  let previous: SceneObject | undefined;

  return {
    label: "Update object",
    execute(scene) {
      previous = scene.objects.find((object) => object.id === objectId);
      return updateObject(scene, objectId, patch);
    },
    undo(scene) {
      if (!previous) {
        return scene;
      }

      return updateObject(scene, objectId, {
        name: previous.name,
        position: previous.position,
        rotationY: previous.rotationY,
        scale: previous.scale
      });
    }
  };
}

function updateObject(
  scene: Scene,
  objectId: string,
  patch: Partial<Pick<SceneObject, "name" | "position" | "rotationY" | "scale">>
) {
  return {
    ...cloneScene(scene),
    objects: scene.objects.map((object) =>
      object.id === objectId
        ? {
            ...object,
            ...patch,
            position: normalizeObjectPosition(patch.position ?? object.position)
          }
        : cloneObject(object)
    )
  };
}

function cloneObject(object: SceneObject): SceneObject {
  return { ...object, position: { ...object.position } };
}

function normalizeObjectPosition(position: SceneObject["position"]): SceneObject["position"] {
  return {
    x: Number.isFinite(position.x) ? position.x : 0,
    y: Number.isFinite(position.y) ? position.y : 0,
    z: Number.isFinite(position.z) ? position.z : 0
  };
}
