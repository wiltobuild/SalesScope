# SalesScope implementation notes

The first working version of the new SalesScope sales workspace is implemented locally. The interface now uses a navy navigation rail, restrained violet accents, warm white surfaces, a clear type hierarchy, responsive layouts, and focused record drawers.

Open the running preview at [SalesScope](http://127.0.0.1:4173). Source is in the cloned `SalesScope` directory within this chat workspace.

## Working features

- Today dashboard with calculated pipeline, quarterly bookings, closed-deal win rate, explained risk signals, team tasks, and target progress.
- Pipeline board and table with owner, stage, text, and attention filters; persistent saved views.
- Lead creation, editing, qualification, and conversion into a linked account, contact, opportunity, and first task.
- Deal creation and editing, configurable stages and probabilities, ownership, expected close dates, forecast categories, next steps, and loss reasons.
- Persistent activity notes, customer-contact dates, tasks, task completion, and change history.
- Accounts and buying contacts linked to opportunities.
- Quarter forecasts, targets, saved point-in-time snapshots, and changes since the last snapshot.
- Source and owner reports, loss reasons, CSV deal export, and workspace JSON export.
- CSV mapping, validation preview, rejected-row downloads, and repeat-import protection.
- Private workspaces, password sign-in, server sessions, single-use team invitations, role-based record access, and workspace switching.
- Workspace currency, timezone, inactivity threshold, stage configuration, and editable industry stage presets.
- Original transaction reporting available in a separate legacy screen.

The demo uses synthetic data and is labeled throughout. New private workspaces start empty. Records persist in a local SQLite database; signing out does not erase them. Demo access is tied to its browser session.

## Verification

Six automated tests pass, including one integration test covering many boundaries: registration and login, lead conversion and replay, related records, persistence after server restart, version conflicts, strict date parsing, import reconciliation and replay, frozen forecast snapshots, saved views, single-use invitations, record assignment, representative permissions, read-only permissions, and cross-workspace denial.

Browser checks confirmed a new deal persisted after reload; a lead converted with its account, buying contact, and task; a three-row CSV accepted one row and rejected a blank name and duplicate; and a forecast snapshot saved. Desktop and 390-pixel mobile layouts were inspected. The mobile dashboard had no page-level horizontal overflow. Final checks also cover task completion and saved pipeline views.

## Local release boundary

This implements the core sales workflow and premium visual direction. It does not complete every phase of the strategic roadmap. CRM synchronization, outbound email/calendar delivery, background imports at enterprise scale, automatic backups, password recovery, SSO, generalized custom fields, multiple independent pipelines, predictive models, cloud deployment, and production operational certification remain future work.

The server binds to `127.0.0.1` by default. Invitation links only work for recipients who can reach that server; no invitation email is sent. Before hosting for real teams, configure HTTPS and secure cookies, persistent storage, backups and restore procedures, and the remaining account lifecycle controls. The new application has no runtime package dependencies, but it requires Node.js 24 or newer with built-in SQLite support.

The legacy transaction report remains a reference module and retains the limitations identified in the original audit. The corrected parsing, identity validation, forecast definitions, role controls, and safe CSV exports apply to the new workspace.

## Run and verify

From the `SalesScope` repository:

```text
npm start
npm test
npm run check
```

The app serves at `http://127.0.0.1:4173`. `PORT` changes the port, `SALESSCOPE_DB` selects a different SQLite file, and `COOKIE_SECURE=1` enables secure cookies for an HTTPS deployment. The default database and local logs live in ignored `.data/` files and are excluded from the source archive.
