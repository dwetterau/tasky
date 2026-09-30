import { expect, it } from "vitest";
import {
  buildPortfolioSnapshotHistory,
  createAccountSnapshotPayload,
  parseAccountSnapshotPayload,
} from "./lib/accountSnapshots";

const position = (
  positionRecordId: string,
  value: number,
  costBasis: number,
) => ({
  positionRecordId,
  ticker: positionRecordId === "cash" ? "" : "VTI",
  name: positionRecordId === "cash" ? "Cash" : "Vanguard Total Market",
  quantity: positionRecordId === "cash" ? 0 : 2,
  costBasis,
  value,
});

it("creates and parses an account snapshot with totals", () => {
  const snapshot = createAccountSnapshotPayload({
    accountRecordId: "rec-account-a",
    accountName: "Brokerage",
    date: "2026-09-29",
    capturedAt: 100,
    positions: [position("vti", 250, 200), position("cash", 50, 50)],
  });

  expect(snapshot).toMatchObject({
    totalValue: 300,
    totalCostBasis: 250,
  });
  expect(
    parseAccountSnapshotPayload(JSON.parse(JSON.stringify(snapshot))),
  ).toEqual(snapshot);
});

it("builds only complete portfolio days and keeps the newest duplicate", () => {
  const accountA = createAccountSnapshotPayload({
    accountRecordId: "account-a",
    accountName: "Brokerage",
    date: "2026-09-29",
    capturedAt: 100,
    positions: [position("vti-a", 200, 150)],
  });
  const accountANewer = createAccountSnapshotPayload({
    accountRecordId: "account-a",
    accountName: "Brokerage",
    date: "2026-09-29",
    capturedAt: 200,
    positions: [position("vti-a", 250, 150)],
  });
  const accountB = createAccountSnapshotPayload({
    accountRecordId: "account-b",
    accountName: "IRA",
    date: "2026-09-29",
    capturedAt: 100,
    positions: [position("vti-b", 300, 275)],
  });
  const incompleteNextDay = createAccountSnapshotPayload({
    accountRecordId: "account-a",
    accountName: "Brokerage",
    date: "2026-09-30",
    capturedAt: 300,
    positions: [position("vti-a", 260, 150)],
  });

  expect(
    buildPortfolioSnapshotHistory(
      [accountA, accountANewer, accountB, incompleteNextDay],
      ["account-a", "account-b"],
    ),
  ).toEqual([
    {
      date: "2026-09-29",
      totalValue: 550,
      totalCostBasis: 425,
      accounts: [
        {
          accountRecordId: "account-a",
          accountName: "Brokerage",
          value: 250,
          costBasis: 150,
        },
        {
          accountRecordId: "account-b",
          accountName: "IRA",
          value: 300,
          costBasis: 275,
        },
      ],
    },
  ]);
});
