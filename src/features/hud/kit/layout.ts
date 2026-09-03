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
  narrow: boolean;
}

export interface ShellLayoutOptions {
  assetBrowserHidden?: boolean;
  leftPanelHidden?: boolean;
}

/** Pure layout math for the HUD overlay: full viewport, the bottom asset browser, and the left panel. */
export function computeShellLayout(width: number, height: number, options: ShellLayoutOptions = {}): ShellRects {
  const narrow = width < shellLayout.narrowBreakpoint;
  const expandedAssetBrowserHeight = narrow ? shellLayout.narrowAssetBrowserHeight : shellLayout.assetBrowserHeight;
  const assetBrowserHeight = options.assetBrowserHidden ? 0 : expandedAssetBrowserHeight;
  const viewportHeight = Math.max(height - assetBrowserHeight, 0);

  const leftPanelWidth = options.leftPanelHidden ? 0 : shellLayout.leftPanelWidth;
  const viewportWidth = Math.max(width - leftPanelWidth, 0);

  return {
    narrow,
    viewport: { x: leftPanelWidth, y: 0, width: viewportWidth, height: viewportHeight },
    assetBrowser: { x: 0, y: height - assetBrowserHeight, width, height: assetBrowserHeight },
    leftPanel: { x: 0, y: 0, width: leftPanelWidth, height: viewportHeight }
  };
}
