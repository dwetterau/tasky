# Portfolio account snapshots

Tasky's portfolio sync reads every configured Airtable view in `Positions`,
deduplicates Position records by Airtable record ID, refreshes each non-empty
ticker once, and writes one snapshot per Investment Account per day.

Each Position must link to exactly one record through its `Account` field. The
linked records must live in the `Investment Accounts` table.

## Airtable setup

Create a table named `Account Snapshots` with these exact fields:

- `Name`: single line text (primary field)
- `Account`: link to another record in `Investment Accounts`
- `Date`: date
- `Snapshot JSON`: long text
- `Total Value`: currency or number
- `Total Cost Basis`: currency or number
- `Position Count`: number (integer)
- `Schema Version`: number (integer)

The Airtable token configured in Tasky needs record read/write access to this
table, plus read access to `Investment Accounts` and read/write access to
`Positions`.

Snapshot names are deterministic:

```text
<Investment Account record ID>:<YYYY-MM-DD>
```

Running sync more than once on the same day updates the existing account/day
rows. The JSON payload preserves every raw Position record, including positions
with the same ticker and positions with an empty ticker (cash). It stores each
Position's record ID, ticker, name, quantity, cost basis, and value, along with
account-level totals and a schema version.

The old `Price History` table is no longer read or written and can remain as
archival data.
