# SalesScope

SalesScope lets sales coordinators upload weekly sales data and get a report: totals and profit, a current-vs-previous-week comparison, product/customer/promotion performance, and alerts for declines or low margin.

Required columns: `Date`, `Order ID`, `Customer`, `Product`, `Quantity`, `Revenue`, `Cost`, and `Promotion`. `Promotion` may be blank.

## Run locally

Open `index.html` in a web browser. Try it with `sample-sales-data.csv`.

## How it works

- `index.html` / `style.css` - page structure and the design system.
- `script.js` - everything else, in order: file upload + validation, SheetJS parsing/normalization, grouping helpers, report calculations (`buildReport`), rendering (`renderReport`), CSV export (`buildReportCsv`), and reset.

No backend, framework, or build step - just static files and SheetJS via CDN.

## Scope

This is an MVP. Deliberately out of scope for now: accounts, cloud storage/persistence, manager dashboards, live data connections, charts, forecasting, and sharing integrations.
