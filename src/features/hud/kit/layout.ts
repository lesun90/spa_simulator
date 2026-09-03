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
  narrow: boolean;
}

export interface ShellLayoutOptions {
  assetBrowserHidden?: boolean;
}

/** Pure layout math for the HUD overlay: full viewport plus the bottom asset browser. */
export function computeShellLayout(width: number, height: number, options: ShellLayoutOptions = {}): ShellRects {
  const narrow = width < shellLayout.narrowBreakpoint;
  const expandedAssetBrowserHeight = narrow ? shellLayout.narrowAssetBrowserHeight : shellLayout.assetBrowserHeight;
  const assetBrowserHeight = options.assetBrowserHidden ? 0 : expandedAssetBrowserHeight;
  const viewportHeight = Math.max(height - assetBrowserHeight, 0);

  return {
    narrow,
    viewport: { x: 0, y: 0, width, height: viewportHeight },
    assetBrowser: { x: 0, y: height - assetBrowserHeight, width, height: assetBrowserHeight }
  };
}
