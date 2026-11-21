import type { GlassRect } from "./api";

/** The camera notch of the screen the islands are on, in CSS px. */
export interface Notch {
  width: number;
  height: number;
}

export interface IslandInput {
  id: string;
  /** Height of the island's content row. */
  height: number;
  /** Collapsed natural width. */
  base: number;
  /** Extra width revealed on hover (actions). */
  extra: number;
  open: boolean;
}

export interface IslandRect extends GlassRect {
  /** Space above the content, hidden behind the notch. */
  pad: number;
  /** Space left of the content when the island is wider than it. */
  inset: number;
  /** Attached to the notch: flat top edge, rounded bottom corners. */
  notched: boolean;
}

interface Options {
  /** Window width; islands are centred in it. */
  width: number;
  top: number;
  gap: number;
  notch: Notch | null;
}

/** How far a notched island reaches past each side of the notch. */
const SHOULDER = 24;

/** Lays out islands top to bottom; with a notch the first one grows out of it. */
export function layoutIslands(items: IslandInput[], { width, top, gap, notch }: Options): IslandRect[] {
  let y = notch ? 0 : top;
  return items.map((item, index) => {
    const natural = item.base + (item.open ? item.extra : 0);
    const notched = notch !== null && index === 0;
    const w = notched ? Math.max(natural, notch.width + 2 * SHOULDER) : natural;
    const pad = notched ? notch.height : 0;
    const h = item.height + pad;
    const rect: IslandRect = {
      id: item.id,
      x: (width - w) / 2,
      y,
      w,
      h,
      radius: item.height / 2,
      pad,
      inset: (w - natural) / 2,
      notched,
    };
    y += h + gap;
    return rect;
  });
}
