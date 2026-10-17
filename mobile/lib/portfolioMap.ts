export const PORTFOLIO_RETURN_COLORS = {
  lossStrong: "#dc2626",
  lossMedium: "#991b1b",
  lossMild: "#5f1d1d",
  flat: "#475569",
  gainMild: "#164e2b",
  gainMedium: "#166534",
  gainStrong: "#16a34a",
} as const;

export function portfolioReturnColor(value: number | null): string {
  if (value === null || Math.abs(value) < 0.1) {
    return PORTFOLIO_RETURN_COLORS.flat;
  }
  if (value < -5) return PORTFOLIO_RETURN_COLORS.lossStrong;
  if (value <= -1) return PORTFOLIO_RETURN_COLORS.lossMedium;
  if (value <= -0.1) return PORTFOLIO_RETURN_COLORS.lossMild;
  if (value > 5) return PORTFOLIO_RETURN_COLORS.gainStrong;
  if (value >= 1) return PORTFOLIO_RETURN_COLORS.gainMedium;
  return PORTFOLIO_RETURN_COLORS.gainMild;
}

type WeightedItem<T> = {
  item: T;
  area: number;
};

export type TreemapRect<T> = {
  item: T;
  x: number;
  y: number;
  width: number;
  height: number;
};

type RemainingRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function worstAspectRatio<T>(
  row: WeightedItem<T>[],
  shortSide: number,
): number {
  if (row.length === 0 || shortSide <= 0) return Number.POSITIVE_INFINITY;
  const total = row.reduce((sum, node) => sum + node.area, 0);
  const smallest = Math.min(...row.map((node) => node.area));
  const largest = Math.max(...row.map((node) => node.area));
  if (total <= 0 || smallest <= 0) return Number.POSITIVE_INFINITY;
  const sideSquared = shortSide * shortSide;
  const totalSquared = total * total;
  return Math.max(
    (sideSquared * largest) / totalSquared,
    totalSquared / (sideSquared * smallest),
  );
}

function placeRow<T>(
  row: WeightedItem<T>[],
  remaining: RemainingRect,
  output: TreemapRect<T>[],
): RemainingRect {
  const rowArea = row.reduce((sum, node) => sum + node.area, 0);
  const rowHeight = rowArea / remaining.width;
  let x = remaining.x;
  for (const node of row) {
    const width = rowHeight > 0 ? node.area / rowHeight : 0;
    output.push({
      item: node.item,
      x,
      y: remaining.y,
      width,
      height: rowHeight,
    });
    x += width;
  }
  return {
    x: remaining.x,
    y: remaining.y + rowHeight,
    width: remaining.width,
    height: Math.max(0, remaining.height - rowHeight),
  };
}

export function layoutTreemap<T>(
  items: { item: T; value: number }[],
  width: number,
  height: number,
): TreemapRect<T>[] {
  if (width <= 0 || height <= 0) return [];
  const positive = items
    .filter(({ value }) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b.value - a.value);
  const total = positive.reduce((sum, entry) => sum + entry.value, 0);
  if (total <= 0) return [];

  const availableArea = width * height;
  const pending: WeightedItem<T>[] = positive.map(({ item, value }) => ({
    item,
    area: (value / total) * availableArea,
  }));
  const output: TreemapRect<T>[] = [];
  let remaining: RemainingRect = { x: 0, y: 0, width, height };
  let row: WeightedItem<T>[] = [];

  while (pending.length > 0) {
    const next = pending[0]!;
    const shortSide = remaining.width;
    const candidate = [...row, next];
    if (
      row.length === 0 ||
      worstAspectRatio(candidate, shortSide) <=
        worstAspectRatio(row, shortSide)
    ) {
      row = candidate;
      pending.shift();
    } else {
      remaining = placeRow(row, remaining, output);
      row = [];
    }
  }
  if (row.length > 0) {
    placeRow(row, remaining, output);
  }
  return output;
}
