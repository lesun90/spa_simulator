import { shellLayout } from "../../../app/config";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShellRects {
  viewport: Rect;
  assetBrowser: Rect;
  leftPanel: Rect;
  inspectorPanel: Rect;
  narrow: boolean;
}

export interface ShellLayoutOptions {
  assetBrowserHidden?: boolean;
  leftPanelHidden?: boolean;
  inspectorPanelHidden?: boolean;
  assetBrowserHeight?: number;
  leftPanelWidth?: number;
  inspectorPanelWidth?: number;
}

/** Pure layout math for the HUD overlay: full viewport, bottom asset browser, left panel, and inspector. */
export function computeShellLayout(width: number, height: number, options: ShellLayoutOptions = {}): ShellRects {
  const narrow = width < shellLayout.narrowBreakpoint;
  const expandedAssetBrowserHeight = options.assetBrowserHeight ?? (narrow ? shellLayout.narrowAssetBrowserHeight : shellLayout.assetBrowserHeight);
  const assetBrowserHeight = options.assetBrowserHidden ? 0 : expandedAssetBrowserHeight;
  const viewportHeight = Math.max(height - assetBrowserHeight, 0);

  const expandedLeftPanelWidth = options.leftPanelWidth ?? shellLayout.leftPanelWidth;
  const leftPanelWidth = options.leftPanelHidden ? 0 : expandedLeftPanelWidth;
  const expandedInspectorPanelWidth = narrow ? 0 : options.inspectorPanelWidth ?? shellLayout.inspectorPanelWidth;
  const inspectorPanelWidth = options.inspectorPanelHidden ? 0 : expandedInspectorPanelWidth;
  const viewportWidth = Math.max(width - leftPanelWidth - inspectorPanelWidth, 0);

  return {
    narrow,
    viewport: { x: leftPanelWidth, y: 0, width: viewportWidth, height: viewportHeight },
    assetBrowser: { x: 0, y: height - assetBrowserHeight, width, height: assetBrowserHeight },
    leftPanel: { x: 0, y: 0, width: leftPanelWidth, height: viewportHeight },
    inspectorPanel: { x: width - inspectorPanelWidth, y: 0, width: inspectorPanelWidth, height: viewportHeight }
  };
}
