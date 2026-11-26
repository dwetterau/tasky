/**
 * Splits a holding's change in value into the part caused by its price moving
 * and the part caused by the number of shares changing.
 *
 * The split is accumulated snapshot by snapshot: between two consecutive
 * snapshots the shares held at the start earn the price move, and any shares
 * added or removed are valued at the later price. The two parts always sum to
 * the change in value exactly.
 */

export type AttributionHolding = {
  ticker: string;
  quantity: number;
  value: number;
};

export type AttributionPoint = {
  date: string;
  holdings: AttributionHolding[];
};

export type HoldingAttribution = {
  /** Upper-cased ticker; the empty string is cash. */
  key: string;
  startValue: number;
  endValue: number;
  startQuantity: number;
  endQuantity: number;
  /** Value per share, or null when the holding has no meaningful price. */
  startPrice: number | null;
  endPrice: number | null;
  priceEffect: number;
  quantityEffect: number;
};

export type Attribution = {
  startDate: string | null;
  endDate: string | null;
  holdings: HoldingAttribution[];
  total: {
    startValue: number;
    endValue: number;
    priceEffect: number;
    quantityEffect: number;
  };
};

type Position = { quantity: number; value: number };

const NONE: Position = { quantity: 0, value: 0 };

/** A share count that jumps while the value stays put is a split, not a trade. */
const SPLIT_MIN_QUANTITY_CHANGE = 0.3;
const SPLIT_MAX_VALUE_CHANGE = 0.02;

export function holdingKey(ticker: string): string {
  return ticker.trim().toUpperCase();
}

/** Cash and positions without a share count have no per-share price. */
export function unitPrice(key: string, position: Position): number | null {
  return key !== "" && position.quantity > 0 && position.value > 0
    ? position.value / position.quantity
    : null;
}

export function positionsByKey(point: AttributionPoint): Map<string, Position> {
  const positions = new Map<string, Position>();
  for (const holding of point.holdings) {
    const key = holdingKey(holding.ticker);
    const existing = positions.get(key);
    if (existing) {
      existing.quantity += holding.quantity;
      existing.value += holding.value;
    } else {
      positions.set(key, { quantity: holding.quantity, value: holding.value });
    }
  }
  return positions;
}

export function attributeStep(
  key: string,
  previous: Position,
  next: Position,
): { priceEffect: number; quantityEffect: number } {
  const change = next.value - previous.value;
  const previousPrice = unitPrice(key, previous);
  const nextPrice = unitPrice(key, next);
  if (previousPrice === null || nextPrice === null) {
    // Opening, closing, or a cash balance: nothing was held at a price across
    // the step, so the whole change is money moving in or out.
    return { priceEffect: 0, quantityEffect: change };
  }
  const quantityChange = Math.abs(next.quantity / previous.quantity - 1);
  const valueChange = Math.abs(next.value / previous.value - 1);
  if (
    quantityChange > SPLIT_MIN_QUANTITY_CHANGE &&
    valueChange < SPLIT_MAX_VALUE_CHANGE
  ) {
    return { priceEffect: change, quantityEffect: 0 };
  }
  const priceEffect = previous.quantity * (nextPrice - previousPrice);
  return { priceEffect, quantityEffect: change - priceEffect };
}

/** Attributes each holding's change between the first and last point given. */
export function attributeChanges(points: AttributionPoint[]): Attribution {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const snapshots = sorted.map(positionsByKey);
  const first = snapshots[0];
  const last = snapshots.at(-1);
  if (!first || !last) {
    return {
      startDate: null,
      endDate: null,
      holdings: [],
      total: { startValue: 0, endValue: 0, priceEffect: 0, quantityEffect: 0 },
    };
  }

  const keys = new Set<string>();
  for (const snapshot of snapshots) {
    for (const key of snapshot.keys()) keys.add(key);
  }

  const holdings: HoldingAttribution[] = [...keys].map((key) => {
    let priceEffect = 0;
    let quantityEffect = 0;
    for (let index = 1; index < snapshots.length; index += 1) {
      const step = attributeStep(
        key,
        snapshots[index - 1]!.get(key) ?? NONE,
        snapshots[index]!.get(key) ?? NONE,
      );
      priceEffect += step.priceEffect;
      quantityEffect += step.quantityEffect;
    }
    const start = first.get(key) ?? NONE;
    const end = last.get(key) ?? NONE;
    return {
      key,
      startValue: start.value,
      endValue: end.value,
      startQuantity: start.quantity,
      endQuantity: end.quantity,
      startPrice: unitPrice(key, start),
      endPrice: unitPrice(key, end),
      priceEffect,
      quantityEffect,
    };
  });
  holdings.sort(
    (a, b) =>
      Math.abs(b.endValue - b.startValue) -
        Math.abs(a.endValue - a.startValue) || a.key.localeCompare(b.key),
  );

  return {
    startDate: sorted[0]!.date,
    endDate: sorted.at(-1)!.date,
    holdings,
    total: holdings.reduce(
      (total, holding) => ({
        startValue: total.startValue + holding.startValue,
        endValue: total.endValue + holding.endValue,
        priceEffect: total.priceEffect + holding.priceEffect,
        quantityEffect: total.quantityEffect + holding.quantityEffect,
      }),
      { startValue: 0, endValue: 0, priceEffect: 0, quantityEffect: 0 },
    ),
  };
}
