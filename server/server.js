import { createServer as createHttpServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DIMENSIONS } from "../src/dimensions.js";
import { buildReport, getSortedPeriodKeys } from "../src/report.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDirectory, "..");
const defaultDatabasePath = resolve(projectRoot, "data", "salesscope.db");
const maxBodyBytes = 10 * 1024 * 1024;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

function createDatabase(databasePath) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      row_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rows (
      upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      order_id TEXT NOT NULL,
      customer TEXT NOT NULL,
      product TEXT NOT NULL,
      quantity REAL NOT NULL,
      revenue REAL NOT NULL,
      cost REAL NOT NULL,
      promotion TEXT,
      category TEXT,
      sub_category TEXT,
      region TEXT,
      state TEXT,
      city TEXT,
      segment TEXT,
      ship_mode TEXT,
      delivery_days INTEGER
    );
    CREATE INDEX IF NOT EXISTS rows_upload_id_date ON rows(upload_id, date);
  `);
  return database;
}

function dateToStorageValue(value) {
  // JSON turns browser Date instances into ISO strings. A bare date is also accepted
  // for API callers, but must not be parsed as UTC and shifted back a day locally.
  if (typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromStorageValue(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function requiredString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeUploadRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return null;
  }

  const date = dateToStorageValue(row.date);
  const quantity = finiteNumber(row.quantity);
  const revenue = finiteNumber(row.revenue);
  const cost = finiteNumber(row.cost);
  const deliveryDays = row.deliveryDays === undefined || row.deliveryDays === null
    ? null
    : Number.isInteger(row.deliveryDays) && row.deliveryDays >= 0 && row.deliveryDays <= 7
      ? row.deliveryDays
      : null;

  if (!date || !requiredString(row.orderId) || !requiredString(row.customer)
    || !requiredString(row.product) || quantity === null || revenue === null || cost === null) {
    return null;
  }

  return {
    date,
    orderId: row.orderId.trim(),
    customer: row.customer.trim(),
    product: row.product.trim(),
    quantity,
    revenue,
    cost,
    promotion: nullableString(row.promotion),
    category: nullableString(row.category),
    subCategory: nullableString(row.subCategory),
    region: nullableString(row.region),
    state: nullableString(row.state),
    city: nullableString(row.city),
    segment: nullableString(row.segment),
    shipMode: nullableString(row.shipMode),
    deliveryDays,
  };
}

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    let tooLarge = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(new Error("Upload body exceeds the 10 MB limit."));
        return;
      }
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Upload body must be valid JSON."));
      }
    });
    request.on("error", () => reject(new Error("Unable to read upload body.")));
  });
}

function rowFromDatabase(row) {
  const date = dateFromStorageValue(row.date);
  const discountMatch = row.promotion && row.promotion.match(/^(\d+(?:\.\d+)?)% discount$/i);
  return {
    date,
    orderId: row.order_id,
    customer: row.customer,
    product: row.product,
    quantity: row.quantity,
    revenue: row.revenue,
    cost: row.cost,
    promotion: row.promotion,
    category: row.category,
    subCategory: row.sub_category,
    region: row.region,
    state: row.state,
    city: row.city,
    segment: row.segment,
    shipMode: row.ship_mode,
    deliveryDays: row.delivery_days,
    discountPercent: discountMatch ? Number(discountMatch[1]) : null,
    isLoss: row.revenue - row.cost < 0,
  };
}

function availableDimensions(rows) {
  const keys = new Set(DIMENSIONS.filter((dimension) => dimension.required).map((dimension) => dimension.key));
  DIMENSIONS.filter((dimension) => !dimension.required).forEach((dimension) => {
    if (rows.some((row) => row[dimension.key] !== null && row[dimension.key] !== undefined)) {
      keys.add(dimension.key);
    }
  });
  return keys;
}

function isInside(root, candidate) {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !pathRelative.includes("..\\"));
}

function staticPathFor(rawPath) {
  const encodedPath = rawPath.split("?")[0];
  let pathname;
  try {
    pathname = decodeURIComponent(encodedPath);
  } catch {
    return { badRequest: "Invalid URL encoding." };
  }

  if (pathname.split("/").some((part) => part === "." || part === ".." || part.includes("\\"))) {
    return { forbidden: "Path traversal is not allowed." };
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  // sample-sales-data.csv is served so a deployed instance can offer the sample
  // file the README tells people to try; a visitor has no checkout to take it from.
  const rootAssets = new Set(["index.html", "style.css", "superstore-data.js", "sample-sales-data.csv"]);
  if (!relativePath.startsWith("src/") && !rootAssets.has(relativePath)) {
    // Outside the allowlist is "absent", not "forbidden" - a browser asking for
    // /favicon.ico should not be told it lacks permission.
    return { missing: "Not found." };
  }

  const allowedRoot = relativePath.startsWith("src/") ? resolve(projectRoot, "src") : projectRoot;
  const localPath = resolve(allowedRoot, relativePath.startsWith("src/") ? relativePath.slice(4) : relativePath);

  if (!isInside(allowedRoot, localPath)) {
    return { forbidden: "Path traversal is not allowed." };
  }
  return { localPath };
}

async function serveStatic(request, response) {
  const staticPath = staticPathFor(request.url || "/");
  if (staticPath.badRequest) {
    sendError(response, 400, staticPath.badRequest);
    return;
  }
  if (staticPath.forbidden) {
    sendError(response, 403, staticPath.forbidden);
    return;
  }
  if (staticPath.missing) {
    sendError(response, 404, staticPath.missing);
    return;
  }

  try {
    const fileStats = await stat(staticPath.localPath);
    if (!fileStats.isFile()) {
      sendError(response, 404, "Not found.");
      return;
    }
    const contents = await readFile(staticPath.localPath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(staticPath.localPath)] || "application/octet-stream" });
    response.end(contents);
  } catch {
    sendError(response, 404, "Not found.");
  }
}

function createAppServer(database) {
  const insertUpload = database.prepare("INSERT INTO uploads (name, source, uploaded_at, row_count) VALUES (?, ?, ?, ?)");
  const insertRow = database.prepare(`INSERT INTO rows (
    upload_id, date, order_id, customer, product, quantity, revenue, cost, promotion,
    category, sub_category, region, state, city, segment, ship_mode, delivery_days
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  return createHttpServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    const reportMatch = url.pathname.match(/^\/api\/uploads\/(\d+)\/report$/);
    const uploadMatch = url.pathname.match(/^\/api\/uploads\/(\d+)$/);

    try {
      if (request.method === "POST" && url.pathname === "/api/uploads") {
        const payload = await readJsonBody(request);
        const name = requiredString(payload.name);
        const source = requiredString(payload.source) || "browser";
        if (!name || !Array.isArray(payload.rows) || !payload.rows.length) {
          sendError(response, 400, "Upload requires a name and at least one normalized row.");
          return;
        }
        const rows = payload.rows.map(normalizeUploadRow);
        if (rows.some((row) => row === null)) {
          sendError(response, 400, "Every uploaded row must be normalized and valid.");
          return;
        }

        database.exec("BEGIN");
        try {
          const upload = insertUpload.run(name, source, new Date().toISOString(), rows.length);
          rows.forEach((row) => insertRow.run(upload.lastInsertRowid, row.date, row.orderId, row.customer,
            row.product, row.quantity, row.revenue, row.cost, row.promotion, row.category,
            row.subCategory, row.region, row.state, row.city, row.segment, row.shipMode, row.deliveryDays));
          database.exec("COMMIT");
          sendJson(response, 201, { id: Number(upload.lastInsertRowid), name, rowCount: rows.length });
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/uploads") {
        const uploads = database.prepare(`
          SELECT uploads.id, uploads.name, uploads.source, uploads.uploaded_at, uploads.row_count,
            substr(MAX(rows.date), 1, 7) AS latest_period
          FROM uploads LEFT JOIN rows ON rows.upload_id = uploads.id
          GROUP BY uploads.id
          ORDER BY uploads.uploaded_at DESC, uploads.id DESC
        `).all().map((upload) => ({ id: upload.id, name: upload.name, source: upload.source,
          uploadedAt: upload.uploaded_at, rowCount: upload.row_count, latestPeriod: upload.latest_period }));
        sendJson(response, 200, { uploads });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/uploads/trends") {
        const trendRows = database.prepare(`
          SELECT upload_id, substr(date, 1, 7) AS period, SUM(revenue) AS revenue
          FROM rows
          GROUP BY upload_id, period
          ORDER BY period, upload_id
        `).all();
        const byPeriod = new Map();
        trendRows.forEach((row) => {
          if (!byPeriod.has(row.period)) byPeriod.set(row.period, []);
          byPeriod.get(row.period).push({ uploadId: Number(row.upload_id), revenue: row.revenue });
        });
        const periods = [...byPeriod.entries()]
          .filter(([, values]) => values.length >= 2)
          .map(([key, values]) => ({
            key,
            revenueByUpload: Object.fromEntries(values.map((value) => [value.uploadId, value.revenue])),
          }));
        const uploadIds = new Set(periods.flatMap((period) => Object.keys(period.revenueByUpload)));
        const uploads = uploadIds.size
          ? database.prepare("SELECT id, name FROM uploads WHERE id IN (" + [...uploadIds].map(() => "?").join(", ") + ") ORDER BY id").all(...uploadIds)
          : [];
        sendJson(response, 200, { granularity: "month", uploads, periods });
        return;
      }

      if (request.method === "GET" && reportMatch) {
        const uploadId = Number(reportMatch[1]);
        const granularity = url.searchParams.get("granularity");
        const periodKey = url.searchParams.get("period");
        if (!new Set(["month", "week"]).has(granularity) || !periodKey) {
          sendError(response, 400, "Report requires granularity (month or week) and period.");
          return;
        }
        const upload = database.prepare("SELECT id FROM uploads WHERE id = ?").get(uploadId);
        if (!upload) {
          sendError(response, 404, "Upload not found.");
          return;
        }
        const rows = database.prepare("SELECT * FROM rows WHERE upload_id = ? ORDER BY date").all(uploadId).map(rowFromDatabase);
        // This is deliberately the browser's report module, keeping server and client figures identical.
        const report = buildReport(rows, { granularity, periodKey }, { availableDimensionKeys: availableDimensions(rows) });
        // A stored report has no browser-side row set. Return the selectable periods
        // so its controls behave exactly like reports generated in the browser.
        sendJson(response, 200, {
          ...report,
          periodKeysByGranularity: {
            month: getSortedPeriodKeys(rows, "month"),
            week: getSortedPeriodKeys(rows, "week"),
          },
        });
        return;
      }

      if (request.method === "DELETE" && uploadMatch) {
        const result = database.prepare("DELETE FROM uploads WHERE id = ?").run(Number(uploadMatch[1]));
        if (!result.changes) {
          sendError(response, 404, "Upload not found.");
          return;
        }
        sendJson(response, 200, { deleted: Number(uploadMatch[1]) });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        sendError(response, 404, "Not found.");
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendError(response, 405, "Method not allowed.");
        return;
      }
      await serveStatic(request, response);
    } catch (error) {
      if (error.message === "Upload body exceeds the 10 MB limit." || error.message === "Upload body must be valid JSON.") {
        sendError(response, 400, error.message);
        return;
      }
      console.error(error);
      sendError(response, 500, "Server error.");
    }
  });
}

async function startServer({ port = Number(process.env.PORT) || 3000, databasePath = process.env.SALESSCOPE_DB || defaultDatabasePath } = {}) {
  await mkdir(dirname(databasePath), { recursive: true });
  const database = createDatabase(databasePath);
  const server = createAppServer(database);
  server.on("close", () => database.close());
  await new Promise((resolveListening) => server.listen(port, resolveListening));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then((server) => {
    const address = server.address();
    console.log(`SalesScope server listening at http://localhost:${address.port}`);
  });
}

export { createAppServer, createDatabase, startServer };
