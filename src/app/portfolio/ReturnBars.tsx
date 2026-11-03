"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ChartDatum = {
  id: string;
  name: string;
  ticker: string;
  value: number;
  returnPercent: number | null;
  returnAmount: number | null;
  fill: string;
};

const BAR_MARGIN = { top: 24, right: 12, bottom: 28, left: 52 };

function niceTicks(min: number, max: number, targetCount = 6): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const roughStep = span / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step =
    [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find(
      (candidate) => candidate >= roughStep,
    ) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (
    let tick = Math.ceil(min / step) * step;
    tick <= max + step * 1e-9;
    tick += step
  ) {
    ticks.push(Math.abs(tick) < step * 1e-9 ? 0 : tick);
  }
  return ticks;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

export function ReturnBars({
  data,
  hoveredId,
  onHover,
  getTitle,
}: {
  data: ChartDatum[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  getTitle: (datum: ChartDatum) => string;
}) {
  const [containerRef, { width, height }] = useElementSize<HTMLDivElement>();

  const layout = useMemo(() => {
    const plotWidth = Math.max(0, width - BAR_MARGIN.left - BAR_MARGIN.right);
    const plotHeight = Math.max(
      0,
      height - BAR_MARGIN.top - BAR_MARGIN.bottom,
    );
    const totalValue = data.reduce((sum, datum) => sum + datum.value, 0);
    const sorted = [...data].sort(
      (a, b) =>
        (a.returnPercent ?? 0) - (b.returnPercent ?? 0) ||
        b.value - a.value ||
        a.ticker.localeCompare(b.ticker),
    );
    const returns = sorted.map((datum) => datum.returnPercent ?? 0);
    const rawMin = Math.min(0, ...returns);
    const rawMax = Math.max(0, ...returns);
    const padding = (rawMax - rawMin) * 0.12 || 1;
    const domainMin = rawMin < 0 ? rawMin - padding : 0;
    const domainMax = rawMax > 0 ? rawMax + padding : 0;
    const domain =
      domainMin === domainMax ? [-1, 1] : [domainMin, domainMax];
    const yFor = (percent: number) =>
      BAR_MARGIN.top +
      ((domain[1]! - percent) / (domain[1]! - domain[0]!)) * plotHeight;

    const averageReturn =
      totalValue > 0
        ? data.reduce(
            (sum, datum) => sum + datum.value * (datum.returnPercent ?? 0),
            0,
          ) / totalValue
        : 0;

    const scaleX = totalValue > 0 ? plotWidth / totalValue : 0;
    const bars = [];
    let x = BAR_MARGIN.left;
    for (const datum of sorted) {
      const barWidth = datum.value * scaleX;
      const percent = datum.returnPercent ?? 0;
      bars.push({
        datum,
        x,
        width: barWidth,
        top: yFor(Math.max(0, percent)),
        bottom: yFor(Math.min(0, percent)),
        percent,
      });
      x += barWidth;
    }

    return {
      plotWidth,
      plotHeight,
      bars,
      zeroY: yFor(0),
      averageReturn,
      averageY: yFor(averageReturn),
      ticks: niceTicks(domain[0]!, domain[1]!).map((tick) => ({
        value: tick,
        y: yFor(tick),
      })),
    };
  }, [data, height, width]);

  return (
    <div ref={containerRef} className="h-full w-full">
      {width > 0 && height > 0 ? (
        <svg
          width={width}
          height={height}
          onMouseLeave={() => onHover(null)}
          role="img"
          aria-label="Holdings sorted by return, width proportional to position value"
        >
          {layout.ticks.map((tick) => (
            <g key={tick.value}>
              <line
                x1={BAR_MARGIN.left}
                x2={BAR_MARGIN.left + layout.plotWidth}
                y1={tick.y}
                y2={tick.y}
                stroke="var(--card-border)"
                strokeWidth={1}
              />
              <text
                x={BAR_MARGIN.left - 8}
                y={tick.y}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--muted)"
                fontSize={11}
              >
                {`${tick.value > 0 ? "+" : ""}${Number(tick.value.toFixed(2))}%`}
              </text>
            </g>
          ))}
          {[0, 25, 50, 75, 100].map((share) => (
            <text
              key={share}
              x={BAR_MARGIN.left + (share / 100) * layout.plotWidth}
              y={height - BAR_MARGIN.bottom + 18}
              textAnchor={share === 0 ? "start" : share === 100 ? "end" : "middle"}
              fill="var(--muted)"
              fontSize={11}
            >
              {share}%
            </text>
          ))}
          {layout.bars.map(({ datum, x, width: barWidth, top, bottom, percent }) => {
            const isPositive = percent >= 0;
            const barHeight = Math.max(bottom - top, 2);
            const barY = bottom - top < 2 ? layout.zeroY - 1 : top;
            const showTicker = barWidth >= datum.ticker.length * 7 + 6;
            const dimmed = hoveredId !== null && hoveredId !== datum.id;
            return (
              <g
                key={datum.id}
                onMouseEnter={() => onHover(datum.id)}
                opacity={dimmed ? 0.55 : 1}
              >
                <title>{getTitle(datum)}</title>
                <rect
                  x={x}
                  y={BAR_MARGIN.top}
                  width={barWidth}
                  height={layout.plotHeight}
                  fill="transparent"
                />
                <rect
                  x={x + 0.5}
                  y={barY}
                  width={Math.max(0, barWidth - 1)}
                  height={barHeight}
                  fill={datum.fill}
                />
                {showTicker ? (
                  <text
                    x={x + barWidth / 2}
                    y={isPositive ? barY - 6 : barY + barHeight + 6}
                    textAnchor="middle"
                    dominantBaseline={isPositive ? "auto" : "hanging"}
                    fill="var(--foreground)"
                    fontSize={11}
                    fontWeight={700}
                    pointerEvents="none"
                  >
                    {datum.ticker}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line
            x1={BAR_MARGIN.left}
            x2={BAR_MARGIN.left + layout.plotWidth}
            y1={layout.zeroY}
            y2={layout.zeroY}
            stroke="var(--muted)"
            strokeWidth={1}
            pointerEvents="none"
          />
          <g pointerEvents="none">
            <line
              x1={BAR_MARGIN.left}
              x2={BAR_MARGIN.left + layout.plotWidth}
              y1={layout.averageY}
              y2={layout.averageY}
              stroke="var(--foreground)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            {/* Bars sort ascending, so the leftmost never rises above the average and the rightmost never drops below it. */}
            <text
              x={
                layout.averageReturn >= 0
                  ? BAR_MARGIN.left + 6
                  : BAR_MARGIN.left + layout.plotWidth - 6
              }
              y={layout.averageY + (layout.averageReturn >= 0 ? -6 : 6)}
              textAnchor={layout.averageReturn >= 0 ? "start" : "end"}
              dominantBaseline={layout.averageReturn >= 0 ? "auto" : "hanging"}
              fill="var(--foreground)"
              fontSize={11}
              fontWeight={700}
            >
              {`Weighted avg ${layout.averageReturn >= 0 ? "+" : ""}${layout.averageReturn.toFixed(2)}%`}
            </text>
          </g>
        </svg>
      ) : null}
    </div>
  );
}
