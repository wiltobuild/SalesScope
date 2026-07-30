# SalesScope

SalesScope lets sales coordinators upload sales data and get a scoped week or month report: totals and profit, period and year-over-year comparison, performance breakdowns, customer intelligence, charts, and actionable alerts.

Required columns: `Date`, `Order ID`, `Customer`, `Product`, `Quantity`, and `Revenue`, plus either `Cost` or `Profit` (`Cost = Revenue − Profit`). `Promotion` may be blank; when it is absent, `Discount` is converted to discount bands.

When available, SalesScope also uses `Category`, `Sub-Category`, `Region`, `State`, `City`, `Segment`, `Ship Mode`, and `Ship Date`. These are optional, so generic uploads such as `sample-sales-data.csv` continue to work without empty sections. `Ship Date` enables delivery-day metrics; the bundled Superstore data includes all of these dimensions.

## Run locally

For development, serve or open `index.html` in a modern web browser. There are three ways to get data in:

- **Upload a file** - any CSV/XLS/XLSX with the columns above. Try `sample-sales-data.csv`.
- **Load Superstore Data** - the bundled Kaggle Superstore dataset (9,994 rows, 2014–2017), read instantly from `superstore-data.js`. Works offline.
- **Fetch Live from Kaggle API** - calls the Kaggle dataset API over HTTPS at runtime, unzips and parses the response in the browser, then loads it. Needs an internet connection.

The period controls default to the latest month and switch between month and week without re-uploading. The report includes product, customer, promotion, and any available optional-dimension breakdowns. Tables start with the top 10 by revenue, can expand, and can be sorted by their columns; product and customer tables also have name search. Downloads always include all rows and sections.

## Offline demo

Build the self-contained `file://` demo with `node tools/build-demo.mjs` (or `npm run build:demo`). Open `demo/index.html` directly from disk, then select **Load Superstore Data** and **Generate Report**. The generated directory is intentionally ignored by Git.

Click a breakdown row to focus the full report on that value; focus chips can be removed, and period changes or Reset clear them. Report sections are collapsible (expanded by default), with a Collapse all / Expand all control. Charts are likewise shown by default and can be hidden for a compact text-only brief.

## Data source

The app treats the Kaggle Superstore dataset as its upstream database. All three routes above converge on the same `ingestRows()` function, so header matching, `Profit → Cost` derivation and `Discount → Promotion` banding behave identically no matter where the rows came from.

**Fetch Live from Kaggle API** is a genuine runtime API call:

1. `fetch()` the dataset endpoint - Kaggle sends `Access-Control-Allow-Origin: *`, so the browser is allowed to call it directly with no backend, proxy, or API key.
2. Confirm the response is really a ZIP (`PK` magic bytes) - a sign-in redirect can arrive as HTTP 200.
3. Read the ZIP64 local header. Both size fields read `0xFFFFFFFF`, so the real 64-bit sizes come from the ZIP64 extra field.
4. Inflate with the browser's built-in `DecompressionStream("deflate-raw")` - no unzip library.
5. Decode as Windows-1252, not UTF-8, or the non-breaking spaces in several product names corrupt.
6. Parse with SheetJS and hand off to `ingestRows()`.

If the fetch fails - offline, Kaggle down, CORS policy changed - the app says so and points at the bundled copy, which always works. That cached-copy-plus-live-refresh split is the same pattern most reporting tools use.

Note the dataset itself is static: it is a fixed historical extract, so a live fetch returns the same 9,994 rows each time. The live path demonstrates the integration, not changing data.

## Report and alerts

The comparison section shows both the prior period and the same period last year when that data exists. Revenue-decline alerts use the year-over-year baseline in preference to period-over-period, avoiding false seasonal alarms.

Alerts cover revenue decline, low margin, skipped invalid rows, discount drag at 30% or more, below-cost products, churn among prior-period top customers, and customer-concentration risk. The fulfilment alert is deliberately limited to Same Day orders that take more than zero delivery days: the dataset has no meaningful late-delivery tail for the other ship modes, so alerting against their averages would mostly create noise. Instead, the Ship Mode breakdown reports average and maximum delivery days.

Customer intelligence shows the revenue held by the top 10%, 20%, and 50% of customers, at-risk customers who ordered in the prior period but not the current one, and unprofitable customers.

## Charts

Charts are hand-rolled inline SVG and stay next to the tables that contain the same values. The three chart forms are a discount-versus-margin diverging bar chart, an interactive revenue-over-time line chart with the selected period emphasized, and horizontal bars for each breakdown. Breakdown charts use a sequential revenue ramp or positive/negative profit bars as appropriate.

The palette is validated for the report surface: categorical data uses blue, orange, aqua, then yellow; profit uses blue for positive and red for negative. Brand green (`#34734a`) is intentionally reserved for UI chrome, not data marks, because it does not meet the validated chart-colour rule.

## How it works

- `index.html` / `style.css` - page structure and the design system.
- `script.js` - everything else, in order: data sources (upload, embedded, live API fetch) + validation, SheetJS parsing/normalization, grouping helpers, report calculations (`buildReport`), rendering (`renderReport`), CSV export (`buildReportCsv`), and reset.
- `superstore-data.js` - the bundled offline copy of the dataset, generated - do not edit by hand.
- `Superstore.csv` - the raw Kaggle download, kept as the converter's input.
- `tools/build-superstore-data.mjs` - converts the Windows-1252 source CSV into `superstore-data.js`.
- `tools/refresh-superstore.mjs` - re-downloads from the Kaggle API and regenerates the bundled copy. Run with `node tools/refresh-superstore.mjs`. It validates row count, order count and total sales before overwriting anything, so a failed download cannot destroy a working dataset.

No backend, framework, or build step - just static files and SheetJS via CDN.

## Scope

The MVP shipped a weekly report over uploaded data. Since then the app gained the full Superstore dimension set, year-over-year comparison, charts, drill-down and customer intelligence, so it is no longer an MVP - charts and live data connections have both moved from "out of scope" to shipped.

Still deliberately out of scope: accounts, cloud storage/persistence, manager dashboards, forecasting, and sharing integrations.

One known limitation worth stating plainly: the bundled dataset is a fixed historical extract covering 2014-2017. The API integration is real, but the data behind it does not change.
