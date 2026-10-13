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
    positions: [
      {
        ...position("vti", 250, 200),
        marketDate: "2026-09-29",
        previousMarketDate: "2026-09-28",
        previousValue: 245,
      },
      position("cash", 50, 50),
    ],
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
    positions: [position("vti-b", 300, 275), position("cash", 50, 50)],
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
      totalValue: 600,
      totalCostBasis: 475,
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
          value: 350,
          costBasis: 325,
        },
      ],
      holdings: [
        {
          ticker: "VTI",
          name: "Vanguard Total Market",
          value: 550,
          costBasis: 425,
        },
        {
          ticker: "",
          name: "Cash",
          value: 50,
          costBasis: 50,
        },
      ],
    },
  ]);
});

it("does not require an account before its first snapshot", () => {
  const snapshot = (
    accountRecordId: string,
    date: string,
    value: number,
  ) =>
    createAccountSnapshotPayload({
      accountRecordId,
      accountName: accountRecordId,
      date,
      capturedAt: 100,
      positions: [position(`${accountRecordId}-${date}`, value, value)],
    });

  const history = buildPortfolioSnapshotHistory(
    [
      snapshot("existing-account", "2026-10-07", 600),
      snapshot("existing-account", "2026-10-08", 610),
      snapshot("new-account", "2026-10-08", 160),
      snapshot("existing-account", "2026-10-09", 620),
      snapshot("new-account", "2026-10-09", 165),
    ],
    ["existing-account", "new-account", "never-snapshotted-account"],
  );

  expect(
    history.map(({ date, totalValue, accounts }) => ({
      date,
      totalValue,
      accountIds: accounts.map((account) => account.accountRecordId),
    })),
  ).toEqual([
    {
      date: "2026-10-07",
      totalValue: 600,
      accountIds: ["existing-account"],
    },
    {
      date: "2026-10-08",
      totalValue: 770,
      accountIds: ["existing-account", "new-account"],
    },
    {
      date: "2026-10-09",
      totalValue: 785,
      accountIds: ["existing-account", "new-account"],
    },
  ]);
});
