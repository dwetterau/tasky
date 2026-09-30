export const ACCOUNT_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type AccountSnapshotPosition = {
  positionRecordId: string;
  ticker: string;
  name: string;
  quantity: number;
  costBasis: number;
  value: number;
};

export type AccountSnapshotPayload = {
  schemaVersion: typeof ACCOUNT_SNAPSHOT_SCHEMA_VERSION;
  accountRecordId: string;
  accountName: string;
  date: string;
  capturedAt: number;
  positions: AccountSnapshotPosition[];
  totalValue: number;
  totalCostBasis: number;
};

export type PortfolioSnapshotHistoryPoint = {
  date: string;
  totalValue: number;
  totalCostBasis: number;
  accounts: Array<{
    accountRecordId: string;
    accountName: string;
    value: number;
    costBasis: number;
  }>;
};

export type CompleteAccountSnapshotDay = {
  date: string;
  snapshots: AccountSnapshotPayload[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parsePosition(value: unknown): AccountSnapshotPosition | null {
  if (!isObject(value)) return null;
  if (
    typeof value.positionRecordId !== "string" ||
    typeof value.ticker !== "string" ||
    typeof value.name !== "string" ||
    !isFiniteNumber(value.quantity) ||
    !isFiniteNumber(value.costBasis) ||
    !isFiniteNumber(value.value)
  ) {
    return null;
  }
  return {
    positionRecordId: value.positionRecordId,
    ticker: value.ticker,
    name: value.name,
    quantity: value.quantity,
    costBasis: value.costBasis,
    value: value.value,
  };
}

export function createAccountSnapshotPayload(args: {
  accountRecordId: string;
  accountName: string;
  date: string;
  capturedAt: number;
  positions: AccountSnapshotPosition[];
}): AccountSnapshotPayload {
  const positions = [...args.positions].sort(
    (a, b) =>
      a.ticker.localeCompare(b.ticker) ||
      a.positionRecordId.localeCompare(b.positionRecordId),
  );
  return {
    schemaVersion: ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
    accountRecordId: args.accountRecordId,
    accountName: args.accountName,
    date: args.date,
    capturedAt: args.capturedAt,
    positions,
    totalValue: positions.reduce((sum, position) => sum + position.value, 0),
    totalCostBasis: positions.reduce(
      (sum, position) => sum + position.costBasis,
      0,
    ),
  };
}

export function parseAccountSnapshotPayload(
  value: unknown,
): AccountSnapshotPayload | null {
  if (
    !isObject(value) ||
    value.schemaVersion !== ACCOUNT_SNAPSHOT_SCHEMA_VERSION ||
    typeof value.accountRecordId !== "string" ||
    typeof value.accountName !== "string" ||
    typeof value.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
    !isFiniteNumber(value.capturedAt) ||
    !Array.isArray(value.positions) ||
    !isFiniteNumber(value.totalValue) ||
    !isFiniteNumber(value.totalCostBasis)
  ) {
    return null;
  }
  const positions = value.positions.map(parsePosition);
  if (positions.some((position) => position === null)) return null;
  return {
    schemaVersion: ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
    accountRecordId: value.accountRecordId,
    accountName: value.accountName,
    date: value.date,
    capturedAt: value.capturedAt,
    positions: positions.filter(
      (position): position is AccountSnapshotPosition => position !== null,
    ),
    totalValue: value.totalValue,
    totalCostBasis: value.totalCostBasis,
  };
}

export function buildCompleteAccountSnapshotDays(
  snapshots: AccountSnapshotPayload[],
  accountRecordIds: Iterable<string>,
): CompleteAccountSnapshotDay[] {
  const selectedAccounts = [...new Set(accountRecordIds)];
  if (selectedAccounts.length === 0) return [];
  const selectedAccountSet = new Set(selectedAccounts);

  const byDate = new Map<string, Map<string, AccountSnapshotPayload>>();
  for (const snapshot of snapshots) {
    if (!selectedAccountSet.has(snapshot.accountRecordId)) continue;
    const accounts = byDate.get(snapshot.date) ?? new Map();
    const existing = accounts.get(snapshot.accountRecordId);
    if (!existing || snapshot.capturedAt >= existing.capturedAt) {
      accounts.set(snapshot.accountRecordId, snapshot);
    }
    byDate.set(snapshot.date, accounts);
  }

  const days: CompleteAccountSnapshotDay[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const snapshotsByAccount = byDate.get(date)!;
    if (
      selectedAccounts.some(
        (accountRecordId) => !snapshotsByAccount.has(accountRecordId),
      )
    ) {
      continue;
    }
    days.push({
      date,
      snapshots: selectedAccounts.map(
        (accountRecordId) => snapshotsByAccount.get(accountRecordId)!,
      ),
    });
  }
  return days;
}

export function buildPortfolioSnapshotHistory(
  snapshots: AccountSnapshotPayload[],
  accountRecordIds: Iterable<string>,
): PortfolioSnapshotHistoryPoint[] {
  return buildCompleteAccountSnapshotDays(snapshots, accountRecordIds).map(
    ({ date, snapshots: accountSnapshots }) => {
      const accounts = accountSnapshots
        .map((snapshot) => ({
          accountRecordId: snapshot.accountRecordId,
          accountName: snapshot.accountName,
          value: snapshot.totalValue,
          costBasis: snapshot.totalCostBasis,
        }))
        .sort(
          (a, b) =>
            a.accountName.localeCompare(b.accountName) ||
            a.accountRecordId.localeCompare(b.accountRecordId),
        );
      return {
        date,
        totalValue: accounts.reduce((sum, account) => sum + account.value, 0),
        totalCostBasis: accounts.reduce(
          (sum, account) => sum + account.costBasis,
          0,
        ),
        accounts,
      };
    },
  );
}
