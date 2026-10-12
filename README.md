# SalesScope 2

A focused workspace for leads, deals, and the next action that moves them forward.

## Run locally

Requires Node.js 24 or newer. No runtime dependency installation is required.

```text
npm start
```

Open http://127.0.0.1:4173. The first visit creates a separate synthetic demo workspace. Use the account menu to create a private empty workspace or sign in. Your records are saved in `.data/salesscope.sqlite`; they survive browser and server restarts.

```text
npm test
npm run check
```

## What works

- Today: pipeline, quarterly bookings, win rate, target progress, explained deal risks, and task completion.
- Leads: create, edit, qualify, and convert into linked accounts, contacts, deals, and tasks.
- Pipeline: board/table, owner/stage/search/attention filters, saved views, stage changes, forecast categories, and next steps.
- Accounts: companies, buying contacts, owners, and related opportunities.
- Forecast: quarterly scenarios, point-in-time snapshots, and changes since the last review.
- Reports: source performance, owner pipeline, loss reasons, safe CSV export, and legacy transaction reporting.
- Settings: workspace preferences, currency, timezone, industry stage presets, probabilities, import/export, and team invitation links.
- Data: CSV mapping and validation preview, rejected-row downloads, duplicate protection, and replay-safe imports.
- Access: password authentication, HTTP-only sessions, workspace-scoped queries, admin/manager/rep/viewer roles, and single-use invitations.

The demo is explicitly synthetic. A private workspace starts empty. Demo teammates are sample owners; create invitations for real users. Invitation links are shared manually and only work for people who can reach the server. There is no email sender.

## Data and metric semantics

Amounts use the workspace currency. The app accepts plain amounts or US-formatted strings such as `1,200.00`; ambiguous foreign-locale formatting is rejected. Dates must be real calendar dates in `YYYY-MM-DD` format. Currency changes are blocked once deals exist.

Booked wins use the actual date marked Won. Open forecasts use expected close dates. Commit outlook is booked wins plus open Commit deals in the quarter; best case additionally includes open Best case deals. Stage probabilities are editable scenario assumptions, not trained predictions. Source reports use all recorded outcomes, while dashboard figures use the current quarter. A customer interaction resets inactivity; an internal note does not.

Sales data is stored in workspace-scoped SQLite records. Optimistic record versions reject concurrent stale writes. Imports reconcile accepted and rejected records, and identical replays do not duplicate them. The pilot import limit is 5,000 rows and 4 MB per request. Deal duplicate detection uses name, linked account, and expected close date; lead matching prefers email. Review these heuristics for your exports.

Representatives can see their own records and buying context linked to their assigned deals and tasks. Linked records owned by someone else remain read-only to them. Managers can manage all workspace records and forecasts. Viewers cannot write. Administrators manage configuration and invitations. All access is enforced in the API.

## Project structure

- `server.js`: HTTP API, authentication, invitations, role checks, persistence, and static serving.
- `src/domain.js`: validation, metric definitions, defaults, and synthetic seed data.
- `public/app.js`: workspace screens, forms, CSV mapping, navigation, and accessible dialogs.
- `public/style.css`: responsive visual system.
- `tests/`: domain and end-to-end HTTP integration tests with isolated temporary databases.
- `docs/`: overhaul plan and implementation notes.
- `legacy/`: original transaction-reporting interface. Its original documentation is `legacy/README.md`.
- Original root `script.js`, `style.css`, data files, and dataset utilities remain as the historical baseline. The new app uses `public/` assets through the server.

## Configuration and operations

Defaults: `HOST=127.0.0.1`, `PORT=4173`, `SALESSCOPE_DB=.data/salesscope.sqlite`. Set `COOKIE_SECURE=1` behind HTTPS. The server uses no hosted databases or external credentials. The primary workspace UI has no CDN dependencies; the legacy report still loads SheetJS externally.

This is a local implementation of the core workflow, not a production SaaS deployment. Before real hosted operation, add HTTPS termination, backup/restore operations, account recovery, monitoring, and load testing. CRM sync, email/calendar integrations, SSO, arbitrary custom fields, independent multiple pipelines, predictive forecasting, and large asynchronous import jobs are not implemented. No public deployment has been created.

The original report is preserved as a reference module and retains the limitations described in the overhaul audit. The new domain layer fixes strict date handling, blank identifiers, import review, currency semantics, and protected text exports for the new workflow.
