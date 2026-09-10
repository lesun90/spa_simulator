import type { RoadTopologyKind } from "./socketTypes";

/**
 * Route-capable road tiles reviewed against the pack's established road patterns.
 * Other catalog tiles may appear in scenic WFC palettes but cannot fulfill routes.
 */
export const reviewedRoadTopologyKinds: Readonly<Record<string, RoadTopologyKind>> = {
  "025": "straight", "026": "dead-end", "031": "straight", "032": "t-junction",
  "038": "dead-end", "041": "t-junction", "043": "t-junction", "048": "curve",
  "141": "four-way", "142": "straight", "153": "corner", "154": "straight",
  "156": "t-junction", "161": "straight", "162": "straight",
  "164": "straight", "165": "straight", "170": "straight", "171": "straight",
  "179": "straight", "180": "straight", "181": "straight", "182": "straight",
  "183": "straight", "184": "straight", "187": "straight", "188": "straight",
  "191": "straight", "192": "straight", "193": "straight", "194": "four-way",
  "197": "straight", "207": "straight",
  "217": "straight", "231": "straight", "233": "straight"
};
