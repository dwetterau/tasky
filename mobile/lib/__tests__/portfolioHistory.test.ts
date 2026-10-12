import { expect, test } from "@jest/globals";
import { buildHoldingSeries, holdingSeriesKey } from "../portfolioHistory";

test("keeps exited positions available as historical chart series", () => {
  const series = buildHoldingSeries([
    {
      holdings: [
        {
          ticker: "VTI",
          name: "Total Stock Market",
          value: 100,
          costBasis: 80,
        },
        {
          ticker: "SOLD",
          name: "Exited position",
          value: 50,
          costBasis: 40,
        },
      ],
    },
    {
      holdings: [
        {
          ticker: "VTI",
          name: "Total Stock Market",
          value: 110,
          costBasis: 80,
        },
      ],
    },
  ]);

  expect(series.map(({ ticker }) => ticker)).toEqual(["VTI", "SOLD"]);
  expect(series.find(({ ticker }) => ticker === "SOLD")).toMatchObject({
    latestValue: 0,
    maxValue: 50,
  });
});

test("sorts series from largest value on the most recent day to smallest", () => {
  const series = buildHoldingSeries([
    {
      holdings: [
        { ticker: "PEAK", name: "Peaked earlier", value: 500, costBasis: 100 },
        { ticker: "NOW", name: "Largest now", value: 10, costBasis: 10 },
        { ticker: "MID", name: "Middle now", value: 40, costBasis: 40 },
      ],
    },
    {
      holdings: [
        { ticker: "PEAK", name: "Peaked earlier", value: 20, costBasis: 100 },
        { ticker: "NOW", name: "Largest now", value: 80, costBasis: 10 },
        { ticker: "MID", name: "Middle now", value: 40, costBasis: 40 },
      ],
    },
  ]);

  expect(
    series.map(({ ticker, latestValue }) => ({ ticker, latestValue })),
  ).toEqual([
    { ticker: "NOW", latestValue: 80 },
    { ticker: "MID", latestValue: 40 },
    { ticker: "PEAK", latestValue: 20 },
  ]);
});

test("uses one stable series for cash across snapshots", () => {
  expect(holdingSeriesKey("")).toBe("__tasky_cash__");
  expect(
    buildHoldingSeries([
      {
        holdings: [
          { ticker: "", name: "Cash", value: 25, costBasis: 25 },
        ],
      },
      {
        holdings: [
          { ticker: "", name: "Cash", value: 30, costBasis: 30 },
        ],
      },
    ]),
  ).toHaveLength(1);
});

test("hides positions that are zero for the entire history range", () => {
  expect(
    buildHoldingSeries([
      {
        holdings: [
          { ticker: "EMPTY", name: "Empty position", value: 0, costBasis: 0 },
          { ticker: "HELD", name: "Held position", value: 10, costBasis: 8 },
        ],
      },
      {
        holdings: [
          { ticker: "EMPTY", name: "Empty position", value: 0, costBasis: 0 },
          { ticker: "HELD", name: "Held position", value: 12, costBasis: 8 },
        ],
      },
    ]).map(({ ticker }) => ticker),
  ).toEqual(["HELD"]);
});
