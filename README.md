# SalesScope

SalesScope lets sales coordinators upload sales data and get a scoped week or month report: totals and profit, period comparison, product/customer/promotion performance, and alerts for declines or low margin.

Required columns: `Date`, `Order ID`, `Customer`, `Product`, `Quantity`, and `Revenue`, plus either `Cost` or `Profit` (`Cost = Revenue − Profit`). `Promotion` may be blank; when it is absent, `Discount` is converted to discount bands.

## Run locally

Open `index.html` in a web browser. There are three ways to get data in:

- **Upload a file** - any CSV/XLS/XLSX with the columns above. Try `sample-sales-data.csv`.
- **Load Superstore Data** - the bundled Kaggle Superstore dataset (9,994 rows, 2014–2017), read instantly from `superstore-data.js`. Works offline.
- **Fetch Live from Kaggle API** - calls the Kaggle dataset API over HTTPS at runtime, unzips and parses the response in the browser, then loads it. Needs an internet connection.

The period controls default to the latest month and switch between month and week without re-uploading. Product and customer tables show the top 10 by revenue and can expand; downloads always include all rows.

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

## How it works

- `index.html` / `style.css` - page structure and the design system.
- `script.js` - everything else, in order: data sources (upload, embedded, live API fetch) + validation, SheetJS parsing/normalization, grouping helpers, report calculations (`buildReport`), rendering (`renderReport`), CSV export (`buildReportCsv`), and reset.
- `superstore-data.js` - the bundled offline copy of the dataset, generated - do not edit by hand.
- `Superstore.csv` - the raw Kaggle download, kept as the converter's input.
- `tools/build-superstore-data.mjs` - converts the Windows-1252 source CSV into `superstore-data.js`.
- `tools/refresh-superstore.mjs` - re-downloads from the Kaggle API and regenerates the bundled copy. Run with `node tools/refresh-superstore.mjs`. It validates row count, order count and total sales before overwriting anything, so a failed download cannot destroy a working dataset.

No backend, framework, or build step - just static files and SheetJS via CDN.

## Scope

This is an MVP. Deliberately out of scope for now: accounts, cloud storage/persistence, manager dashboards, charts, forecasting, and sharing integrations.
