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

Dates use the Tasky user's stored IANA timezone. If no user setting exists,
Tasky falls back to the homepage enrollment timezone and then UTC. Running sync
more than once on the same day updates the existing account/day rows. The JSON
payload preserves every raw Position record, including positions with the same
ticker and positions with an empty ticker (cash). It stores each Position's
record ID, ticker, name, quantity, cost basis, value, and prior market value
when available, along with account-level totals and a schema version.

The old `Price History` table is no longer read or written and can remain as
archival data.

## Live 1D view

On the 1D horizon the portfolio page does not wait for the daily snapshot. It
polls `portfolioLive.getIntraday`, which reads Alpaca snapshots and 5-minute
bars for the tickers on screen and stores nothing. Share counts still come from
Airtable `Positions`; each holding is repriced at the latest trade and measured
from the previous close.

- Polling runs every 5 seconds while trades are arriving and the tab is
  visible, every two minutes otherwise, and stops in a
  background tab.
- Prices use Alpaca's IEX feed (the free plan), so they can differ by a few
  cents from the consolidated tape.
- Holdings Alpaca cannot price (cash, mutual funds) keep their snapshot value.
- If Alpaca is unreachable or returns nothing, the page falls back to the
  snapshot-based 1D figures.
- The latest price includes pre-market and after-hours trades, so 1D figures
  keep moving outside regular hours. Regular and extended hours come from
  Alpaca's market calendar, which also handles early-close days.
