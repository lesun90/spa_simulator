import type { EditorTool } from "../../state/types";

export interface GroundClickSelectionContext {
  activeTool: EditorTool;
  placementAssetId: string | null;
  hasGroundPoint: boolean;
}

export function shouldClearSelectionOnGroundClick(context: GroundClickSelectionContext): boolean {
  return context.activeTool === "select" && !context.placementAssetId && context.hasGroundPoint;
}
