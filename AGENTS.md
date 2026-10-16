# Repository Guidelines

## Project Structure & Module Organization

This is a Node.js and Express package purchase monitor for TPLUS. `src/server.js` defines HTTP routes and session handling; `src/db.js` manages the SQL Server pool; `src/store.js` provides SQL and workbook data access; `src/domain.js` validates filters and calculates metrics; `src/auth.js` handles scrypt passwords.

`public/` contains the dashboard HTML, CSS, and browser JavaScript. `scripts/` contains database initialization and operator creation. `test/` contains automated tests. Preserve `schema.txt` as the supplied SQL Server schema and `demo.xlsx` as the reference dataset.

## Build, Test, and Development Commands

Use Node.js 22 or newer. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

- `npm.cmd install --cache .npm-cache`: install locked project dependencies.
- `npm.cmd run demo`: run with workbook data and temporary in-memory handling edits.
- `npm.cmd run dev`: run SQL mode with Node's file watcher.
- `npm.cmd start`: start SQL mode without file watching.
- `npm.cmd test`: run Node's built-in test suite.
- `npm.cmd audit --cache .npm-cache`: check dependency advisories.

There is no frontend build step. See `README.md` for explicit database and account setup. Never run initialization against an existing populated database.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, camelCase functions and variables, and descriptive filenames. Preserve PascalCase database field names in API records and existing SQL column spelling. Use parameterized SQL for all user values. Match the schema's uppercase SQL keywords and descriptive constraint names. No formatter or linter is configured.

## Testing Guidelines

Add meaningful `*.test.js` tests under `test/` for changes to validation, authentication, metrics, and handling behavior. Use demo or stub stores; automated tests must not modify a live database. Test empty results, invalid input, date boundaries, and session authorization. No coverage percentage is mandated. Verify dashboard changes in a browser at desktop and mobile widths.

## Commit & Pull Request Guidelines

No Git history was available to establish conventions. Use concise, imperative commit messages, such as `Add channel filtering`. Describe behavior changes, affected endpoints, validation results, and configuration or migration requirements. Link related issues and include screenshots for dashboard changes.

## Security & Configuration

Keep `.env`, credentials, customer records, and production password material out of commits. Preserve the existing local configuration. Use synthetic fixtures. Keep demo mode explicit, protect SQL endpoints with authentication, and never log database passwords or session tokens.
