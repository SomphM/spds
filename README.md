# TPLUS Package Purchase Monitor

An Express 5 application with a responsive operations dashboard and SQL Server integration. It reads the existing `dbo.Transactions`, `dbo.Alerts`, and `dbo.Users` tables. Purchase outcomes remain separate from operator handling decisions.

## Appearance and language

Use the header selectors to choose Light/Dark and English/ລາວ. Both preferences are saved in this browser. On first visit, the theme follows the operating system. Controls are available on the sign-in screen as well as the dashboard. Lao translations cover navigation, filters, metrics, status labels, transaction details, and common errors; package names, customer data, and database alert messages retain their original content. Changing language preserves active filters and the English status values sent to the API. Lao display uses installed Lao-capable fonts such as Phetsarath OT or Lao UI.

The supplied `Black-Tplus-logo.png` is copied unchanged to `public/tplus-logo.png` and displayed in the sidebar in both themes.

## Quick preview

Requires Node.js 22 or newer and npm.

```powershell
npm.cmd install --cache .npm-cache
npm.cmd run demo
```

Open http://127.0.0.1:3000. Demo mode reads all 1,000 transactions directly from `demo.xlsx`; no SQL connection or login is required. Handling edits live in memory and reset on restart. It never falls back from SQL mode to demo automatically. Your `.env`, workbook, and schema are not served publicly.

## Connect SQL Server

The existing `.env` is preserved. Use `.env.example` as a reference, and configure `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Enable SQL authentication and TCP/IP on the server. The database must already exist.

Encryption defaults to enabled with certificate verification. For a local SQL Server with a self-signed certificate, explicitly set `DB_TRUST_CERTIFICATE=true` only if appropriate for your local environment.

If connecting reports `ESOCKET` with `unsupported protocol`, the server's TLS configuration is incompatible with modern Node.js. Enable TLS 1.2 or newer and install applicable SQL Server/Windows updates on the database host, then configure a trusted certificate. Trusting a certificate does not fix an unsupported TLS protocol. The app keeps encrypted connections enabled and does not silently fall back to workbook data. `npm.cmd start` uses `.env`; `npm.cmd run demo` explicitly opts into workbook mode.

If the tables already exist, skip initialization. For a fresh, empty database:

```powershell
npm.cmd run db:init
```

Initialization uses `schema.txt`, creates Users before its dependent foreign key, and runs within a transaction. It refuses to run if any of the three tables exists. It targets `DB_NAME` instead of the schema's hard-coded `USE [SPDS]`. No existing data is changed and no workbook data is imported.

Create an operator using this application's scrypt password format:

```powershell
$env:TPLUS_INITIAL_PASSWORD = 'choose-a-unique-long-password'
npm.cmd run user:create -- operator
Remove-Item Env:TPLUS_INITIAL_PASSWORD
npm.cmd start
```

Existing hashes from another application may use a different algorithm and will not automatically be compatible. Sign in using the newly created operator. All operators currently have the same access. Runtime permissions need SELECT on all three tables and UPDATE on Transactions; use separate credentials for initialization and account creation when deploying.

## Features

- Purchase totals, success rate, checking transactions, and unresolved failures.
- Laos-time (UTC+7) date ranges, phone/package search, status/channel/handling filters, and paginated results.
- Daily purchase activity, channel distribution, failure reasons, and popular packages.
- Latest 20 persisted database alerts in the selected date range, with the full matching alert count.
- Purchase details and pending/fixed/closing handling, attributed to the signed-in operator.
- Automatic 30-second refresh, explicit refresh, and clear empty/error states.

Handling changes do not retry purchases, contact a telecom service, alter purchase status, or create automated alerts. `closing` and `fixed` are excluded from the unresolved-failure count. Null handling is displayed as `pending`. Workbook Excel serial timestamps are interpreted as UTC; confirm this assumption against the upstream data producer.

## API

All endpoints except health and login require an operator session in SQL mode.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Process status and mode; does not probe SQL |
| POST | `/api/login` | `{ "username": "operator", "password": "..." }` |
| POST | `/api/logout` | End the current session |
| GET | `/api/me` | Current operator and mode |
| GET | `/api/options` | Distinct purchase channels |
| GET | `/api/dashboard` | Filtered metrics and latest global alerts |
| GET | `/api/transactions` | Filtered transactions; `page`, `pageSize` (1–100) |
| PATCH | `/api/transactions/:id/handling` | `{ "handleStatus": "fixed" }` |

Shared filters: `search`, `status`, `channel`, `handle`, `failureReason`, `autoRenew`, `from`, `to`. Click a failure reason to filter failed transactions by that exact reason, keeping the current date range and other filters. Use Review for purchase details and Reset to clear filters. `Unspecified` includes missing or empty failure reasons. Dates use `YYYY-MM-DD`, inclusive Laos calendar days (UTC+7). When omitted, both dates default to today in Laos. Purchase counts and the transaction-based System alerts use `CreatedAt`. Stored SQL timestamps are interpreted as UTC, as defined by the schema defaults. Send same-origin JSON for mutations. SQL values are parameterized; session cookies are HttpOnly and SameSite=Strict. API responses are not cached.

## Development and verification

```powershell
npm.cmd run dev
npm.cmd test
npm.cmd audit --cache .npm-cache
```

Tests cover workbook totals, filtering, date validation, pagination, password verification, authentication, logout, handling attribution, and cross-origin write rejection. Tests use demo or stub stores and do not write to SQL Server.

`src/` contains the API, data access, authentication, and metrics. `public/` contains the dashboard. `scripts/` contains explicit database/account setup commands. `test/` contains Node's built-in test suite.

For deployment, use HTTPS and `NODE_ENV=production` so cookies are Secure; the default listener is localhost. Sessions are in memory, expire after eight hours, and reset on restart; use a shared persistent session store before multi-instance deployment. Dashboard metrics cover all transactions in the selected date range, defaulting to today in Laos (UTC+7), with no 200-row cap. SQL Server calculates totals and chart groups and returns only the requested 25-row transaction page. Counts and pagination share the same filters. Alerts share the date range and display a separate total, with up to 20 latest alert details. The date inputs can select another day or a historical range; Reset restores today. Browser visual verification and live SQL integration must be completed in the deployment environment.



## SOC monitoring dashboard

Failure reasons and auto-renew visibility are the primary investigation panels. The headline cards show failed purchases, unresolved failures, recorded auto-renew-off purchases, and checking results. Purchase totals and success rate remain available in the context strip.

Click a failure reason, a headline action, or an auto-renew card to investigate matching transactions while preserving the date range and other filters. `autoRenew=on|off` filters the stored purchase flag; the failed/auto-renew-off shortcut applies both conditions. Reset restores today's unfiltered view. Failure-reason percentages use the filtered failed-purchase count as their denominator.

Auto-renew figures count transaction records, not unique subscribers or active subscriptions. They do not establish whether a renewal attempt failed or whether auto-renew off is abnormal. No automatic retry or subscription changes occur.

System alerts now lists the latest 20 failed purchases in the selected date range, excluding `balance is not enough` (case-insensitive, trimmed). The badge shows the full matching count. This panel uses Transactions, includes missing failure reasons, and does not change or insert database records. Other purchase filters do not restrict this date-scoped alert feed.

Click any System alerts item to open its full purchase details and handling controls. Details are fetched by transaction ID through the authenticated `GET /api/transactions/:id` endpoint, independently of the currently visible transaction page.

When an operator saves Handling status as `fixed`, the same transaction update sets `AutoRenewOff = 0`, sets `isFixed = 1`, and records the handler and timestamp. Other handling statuses preserve the current auto-renew flag. This applies to future saves, not a bulk rewrite of previously fixed records; it updates the stored purchase record without calling a telecom provisioning API.

The Purchase transactions ID / CREATED AT column displays `CreatedAt` exactly as stored in SQL Server, without a timezone offset. Purchase date filters, metrics, and ordering use `CreatedAt`.

Dashboard date filtering, daily aggregates, transaction ordering, and System alerts now use `CreatedAt` as stored in the database. A selected date includes midnight through just before the next database midnight, with no timezone offset applied to those bounds. The default date is today in Laos.


## Resolution dashboard

Open `/resolutions.html` or choose Resolution dashboard in the sidebar. It shares the existing login session, theme, and English/Lao preferences. The report shows all failed purchases created in the selected database-date range, the number currently marked fixed, fixed/all-failed rate, and actionable unresolved failures (excluding insufficient balance). Operator totals use DisplayName with username fallback, grouped by user ID. Missing handlers are shown as Unassigned.

The fixed-purchase table is ordered by HandledAt and paginated at 25 records. A purchase is counted as fixed only when its stored HandleStatus is fixed; automatic success display labels do not count. This is a current-state report by purchase creation date, not a history of every handling action or a count of fixes performed during the date range. Data is read through the authenticated `GET /api/resolutions?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1` endpoint.
