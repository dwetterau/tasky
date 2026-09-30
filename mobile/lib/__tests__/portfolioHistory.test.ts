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
