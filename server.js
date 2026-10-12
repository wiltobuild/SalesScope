import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collections,
  defaultSettings,
  seedWorkspace,
  validateRecord,
  metrics,
  today,
} from "./src/domain.js";

const root = dirname(fileURLToPath(import.meta.url));
const dbPath =
  process.env.SALESSCOPE_DB || join(root, ".data", "salesscope.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,settings TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT NOT NULL,password TEXT);
CREATE TABLE IF NOT EXISTS memberships(workspace_id TEXT,user_id TEXT,role TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id),FOREIGN KEY(workspace_id) REFERENCES workspaces(id),FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT,workspace_id TEXT,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(workspace_id) REFERENCES workspaces(id));
CREATE INDEX IF NOT EXISTS records_scope ON records(workspace_id,kind);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,record_id TEXT,actor_id TEXT,action TEXT,data TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS event_scope ON events(workspace_id,record_id);
CREATE TABLE IF NOT EXISTS invitations(token TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,source_key TEXT NOT NULL,result TEXT NOT NULL,UNIQUE(workspace_id,source_key));`);
const run = (sql, ...params) => db.prepare(sql).run(...params);
const one = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);
const hashToken = (t) => createHash("sha256").update(t).digest("hex");
const passwordHash = (p) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(p, salt, 64).toString("hex")}`;
};
const passwordMatch = (p, h) => {
  if (!h) return false;
  const [salt, value] = h.split(":");
  return timingSafeEqual(scryptSync(p, salt, 64), Buffer.from(value, "hex"));
};
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function unpack(r) {
  return {
    ...JSON.parse(r.data),
    id: r.id,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function list(workspace, kind) {
  return all(
    "SELECT * FROM records WHERE workspace_id=? AND kind=? ORDER BY created_at DESC",
    workspace,
    kind,
  ).map(unpack);
}
function getRecord(workspace, kind, id) {
  const row = one(
    "SELECT * FROM records WHERE workspace_id=? AND kind=? AND id=?",
    workspace,
    kind,
    id,
  );
  if (!row) throw fail("Record not found.", 404);
  return unpack(row);
}
function writeRecord(workspace, kind, data, old = null) {
  const id = old?.id || data.id || randomUUID(),
    createdAt = old?.createdAt || data.createdAt || new Date().toISOString(),
    updatedAt = new Date().toISOString(),
    version = (old?.version || 0) + 1;
  const clean = { ...data };
  delete clean.version;
  delete clean.id;
  delete clean.createdAt;
  delete clean.updatedAt;
  run(
    "INSERT INTO records(id,workspace_id,kind,data,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at",
    id,
    workspace,
    kind,
    JSON.stringify(clean),
    version,
    createdAt,
    updatedAt,
  );
  return { ...clean, id, version, createdAt, updatedAt };
}
function event(session, recordId, action, data = {}) {
  run(
    "INSERT INTO events VALUES(?,?,?,?,?,?,?)",
    randomUUID(),
    session.workspace_id,
    recordId,
    session.user_id,
    action,
    JSON.stringify(data),
    new Date().toISOString(),
  );
}
function startSession(res, userId, workspaceId) {
  const token = randomBytes(32).toString("hex");
  run(
    "INSERT INTO sessions VALUES(?,?,?,?)",
    hashToken(token),
    userId,
    workspaceId,
    Date.now() + 7 * 86400000,
  );
  res.setHeader(
    "Set-Cookie",
    `salesscope=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === "1" ? "; Secure" : ""}`,
  );
}
function sessionFor(req) {
  const token = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("salesscope="))
    ?.slice(11);
  if (!token) return null;
  return one(
    "SELECT s.*,m.role,u.name,u.email,w.settings,w.demo FROM sessions s JOIN memberships m ON m.workspace_id=s.workspace_id AND m.user_id=s.user_id JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=s.workspace_id WHERE s.token=? AND s.expires>?",
    hashToken(token),
    Date.now(),
  );
}
const ownerIds = (s) =>
  all(
    "SELECT user_id FROM memberships WHERE workspace_id=?",
    s.workspace_id,
  ).map((x) => x.user_id);
function requireWrite(s) {
  if (s.role === "viewer")
    throw fail("This workspace is read-only for your role.", 403);
}
function requireAdmin(s) {
  if (s.role !== "admin") throw fail("Workspace admin access required.", 403);
}
function canAccess(s, r) {
  if (["admin", "manager"].includes(s.role) || r.ownerId === s.user_id)
    return true;
  // A seller needs the buying context and activity of their assigned deals.
  const assignedTasks = list(s.workspace_id, "tasks").filter(
    (t) => t.ownerId === s.user_id,
  );
  const owned = list(s.workspace_id, "deals").filter(
    (d) =>
      d.ownerId === s.user_id || assignedTasks.some((t) => t.dealId === d.id),
  );
  return owned.some(
    (d) =>
      d.id === r.id ||
      d.accountId === r.id ||
      d.contactId === r.id ||
      d.id === r.dealId,
  );
}
function assertAccess(s, r) {
  if (!canAccess(s, r)) throw fail("Record not found.", 404);
}
function scoped(s, kind) {
  return list(s.workspace_id, kind).filter((r) => canAccess(s, r));
}
function validateRefs(s, kind, data) {
  for (const [key, type] of [
    ["accountId", "accounts"],
    ["contactId", "contacts"],
    ["dealId", "deals"],
  ])
    if (data[key]) assertAccess(s, getRecord(s.workspace_id, type, data[key]));
  if (
    data.contactId &&
    data.accountId &&
    getRecord(s.workspace_id, "contacts", data.contactId).accountId !==
      data.accountId
  )
    throw fail("The contact must belong to the selected account.");
  if (s.role === "rep" && data.ownerId !== s.user_id)
    throw fail("Representatives can only own their own records.", 403);
}
async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 4e6)
      throw fail(
        "Request too large. Import at most 5,000 rows at a time.",
        413,
      );
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw fail("Invalid JSON.");
  }
}
const attempts = new Map();
function rateLimit(req) {
  const key = req.socket.remoteAddress,
    now = Date.now();
  const item = attempts.get(key) || { count: 0, until: now + 60000 };
  if (now > item.until) {
    item.count = 0;
    item.until = now + 60000;
  }
  if (++item.count > 40)
    throw fail("Too many attempts. Try again in a minute.", 429);
  attempts.set(key, item);
}
function createWorkspace(name, email, password, demo = false) {
  const userId = randomUUID(),
    workspaceId = randomUUID();
  run(
    "INSERT INTO users VALUES(?,?,?,?)",
    userId,
    email,
    name,
    password ? passwordHash(password) : null,
  );
  run(
    "INSERT INTO workspaces VALUES(?,?,?)",
    workspaceId,
    JSON.stringify({
      ...defaultSettings,
      name: demo ? "Northstar Studio" : `${name.split(" ")[0]}'s workspace`,
    }),
    demo ? 1 : 0,
  );
  run("INSERT INTO memberships VALUES(?,?,?)", workspaceId, userId, "admin");
  if (demo) {
    const others = ["Alex Morgan", "Sophie Chen"].map((name) => {
      const id = randomUUID();
      run("INSERT INTO users VALUES(?,?,?,?)", id, null, name, null);
      run("INSERT INTO memberships VALUES(?,?,?)", workspaceId, id, "rep");
      return id;
    });
    const data = seedWorkspace(userId, others);
    for (const kind of collections)
      for (const r of data[kind]) writeRecord(workspaceId, kind, r);
  }
  return { userId, workspaceId };
}
function bootstrap(s) {
  const settings = JSON.parse(s.settings),
    data = Object.fromEntries(
      collections.map((k) => [
        k,
        k === "snapshots"
          ? ["admin", "manager"].includes(s.role)
            ? list(s.workspace_id, k)
            : []
          : scoped(s, k),
      ]),
    );
  const visibleIds = new Set(
    Object.values(data)
      .flat()
      .map((r) => r.id),
  );
  const events = all(
    "SELECT e.*,u.name as actor FROM events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.workspace_id=? ORDER BY e.created_at DESC LIMIT 300",
    s.workspace_id,
  )
    .filter(
      (e) =>
        ["admin", "manager"].includes(s.role) || visibleIds.has(e.record_id),
    )
    .map((e) => ({ ...e, data: JSON.parse(e.data) }));
  return {
    user: { id: s.user_id, name: s.name, email: s.email, role: s.role },
    workspace: { id: s.workspace_id, demo: !!s.demo, settings },
    workspaces: all(
      "SELECT w.id,w.settings,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=?",
      s.user_id,
    ).map((w) => ({
      id: w.id,
      name: JSON.parse(w.settings).name,
      role: w.role,
    })),
    members: all(
      "SELECT u.id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?",
      s.workspace_id,
    ),
    data,
    events,
    metrics: metrics(data.deals, settings, today(settings.timezone)),
    today: today(settings.timezone),
  };
}
async function api(req, res, path) {
  if (
    req.method !== "GET" &&
    req.headers.origin &&
    req.headers.origin !== `http://${req.headers.host}` &&
    req.headers.origin !== `https://${req.headers.host}`
  )
    throw fail("Cross-origin writes are not allowed.", 403);
  const s = sessionFor(req);
  if (path === "/api/invitation" && req.method === "GET") {
    const token =
      new URL(req.url, "http://localhost").searchParams.get("token") || "";
    const invitation = one(
      "SELECT i.*,w.settings FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token=? AND i.used=0 AND i.expires>?",
      hashToken(token),
      Date.now(),
    );
    if (!invitation)
      throw fail("This invitation is expired or has already been used.", 404);
    return {
      name: JSON.parse(invitation.settings).name,
      email: invitation.email,
      role: invitation.role,
    };
  }
  if (path === "/api/auth/join" && req.method === "POST") {
    rateLimit(req);
    const p = await body(req);
    const invitation = one(
      "SELECT * FROM invitations WHERE token=? AND used=0 AND expires>?",
      hashToken(String(p.token || "")),
      Date.now(),
    );
    if (!invitation)
      throw fail("This invitation is expired or has already been used.", 404);
    const name = String(p.name || "")
      .trim()
      .slice(0, 100);
    if (
      !name ||
      typeof p.password !== "string" ||
      p.password.length < 12 ||
      p.password.length > 256
    )
      throw fail("Enter your name and a password of 12–256 characters.");
    const existing = one("SELECT * FROM users WHERE email=?", invitation.email);
    if (existing && !passwordMatch(p.password, existing.password))
      throw fail(
        "This email already has an account. Enter its existing password to join.",
        401,
      );
    const userId = transaction(() => {
      const id = existing?.id || randomUUID();
      if (!existing)
        run(
          "INSERT INTO users VALUES(?,?,?,?)",
          id,
          invitation.email,
          name,
          passwordHash(p.password),
        );
      run(
        "INSERT INTO memberships VALUES(?,?,?) ON CONFLICT(workspace_id,user_id) DO NOTHING",
        invitation.workspace_id,
        id,
        invitation.role,
      );
      run("UPDATE invitations SET used=1 WHERE token=?", invitation.token);
      event(
        { workspace_id: invitation.workspace_id, user_id: id },
        null,
        "Joined workspace",
        { role: invitation.role },
      );
      return id;
    });
    startSession(res, userId, invitation.workspace_id);
    return { ok: true };
  }
  if (path === "/api/demo" && req.method === "POST") {
    if (!s) {
      rateLimit(req);
      const ids = transaction(() =>
        createWorkspace("Jordan Davis", null, null, true),
      );
      startSession(res, ids.userId, ids.workspaceId);
    }
    return { ok: true };
  }
  if (path === "/api/auth/register" && req.method === "POST") {
    rateLimit(req);
    const p = await body(req);
    const name = String(p.name || "")
        .trim()
        .slice(0, 100),
      email = String(p.email || "")
        .trim()
        .toLowerCase();
    if (
      !name ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      typeof p.password !== "string" ||
      p.password.length < 12 ||
      p.password.length > 256
    )
      throw fail(
        "Enter a name, valid email, and a password of 12–256 characters.",
      );
    if (one("SELECT id FROM users WHERE email=?", email))
      throw fail("An account already exists for this email.");
    const ids = transaction(() => createWorkspace(name, email, p.password));
    startSession(res, ids.userId, ids.workspaceId);
    return { ok: true };
  }
  if (path === "/api/auth/login" && req.method === "POST") {
    rateLimit(req);
    const p = await body(req);
    if (typeof p.password !== "string" || p.password.length > 256)
      throw fail("Invalid email or password.", 401);
    const user = one(
      "SELECT * FROM users WHERE email=?",
      String(p.email || "")
        .toLowerCase()
        .trim(),
    );
    if (!user || !passwordMatch(p.password, user.password))
      throw fail("Invalid email or password.", 401);
    const member = one(
      "SELECT * FROM memberships WHERE user_id=? ORDER BY rowid DESC",
      user.id,
    );
    startSession(res, user.id, member.workspace_id);
    return { ok: true };
  }
  if (!s) throw fail("Sign in to continue.", 401);
  if (path === "/api/auth/logout" && req.method === "POST") {
    run("DELETE FROM sessions WHERE token=?", s.token);
    res.setHeader(
      "Set-Cookie",
      "salesscope=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    return { ok: true };
  }
  if (path === "/api/bootstrap" && req.method === "GET") return bootstrap(s);
  if (path === "/api/workspace" && req.method === "POST") {
    const p = await body(req);
    if (
      !one(
        "SELECT user_id FROM memberships WHERE user_id=? AND workspace_id=?",
        s.user_id,
        p.id,
      )
    )
      throw fail("Workspace not found.", 404);
    run("UPDATE sessions SET workspace_id=? WHERE token=?", p.id, s.token);
    return { ok: true };
  }
  if (path === "/api/invitations" && req.method === "POST") {
    requireAdmin(s);
    const p = await body(req),
      email = String(p.email || "")
        .trim()
        .toLowerCase();
    if (
      !/^\S+@\S+\.\S+$/.test(email) ||
      !["manager", "rep", "viewer"].includes(p.role)
    )
      throw fail("Enter a valid email and choose a role.");
    const existing = one(
      "SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=? AND m.workspace_id=?",
      email,
      s.workspace_id,
    );
    if (existing) throw fail("This person is already a member.");
    const token = randomBytes(32).toString("hex");
    run(
      "INSERT INTO invitations VALUES(?,?,?,?,?,0)",
      hashToken(token),
      s.workspace_id,
      email,
      p.role,
      Date.now() + 7 * 86400000,
    );
    event(s, null, "Created team invitation", { email, role: p.role });
    return { token, email, role: p.role };
  }
  const match = path.match(/^\/api\/records\/(\w+)(?:\/([\w-]+))?$/);
  if (match) {
    const [, kind, id] = match;
    if (!collections.includes(kind) || kind === "snapshots")
      throw fail("Unknown record type.", 404);
    requireWrite(s);
    if (req.method === "POST" || req.method === "PATCH") {
      const input = await body(req),
        old = id ? getRecord(s.workspace_id, kind, id) : null;
      if (old) {
        assertAccess(s, old);
        if (s.role === "rep" && old.ownerId !== s.user_id)
          throw fail(
            "You can read this linked record, but only its owner or a manager can edit it.",
            403,
          );
        if (input.version !== old.version)
          throw fail(
            "This record changed. Refresh it before saving again.",
            409,
          );
        if (old.convertedDealId)
          throw fail("Converted leads are read-only. Open the linked deal.");
      }
      const settings = JSON.parse(s.settings),
        data = validateRecord(
          kind,
          {
            ...old,
            ...input,
            ownerId: input.ownerId || old?.ownerId || s.user_id,
          },
          settings,
          ownerIds(s),
        );
      validateRefs(s, kind, data);
      if (kind === "deals")
        data.closedAt = ["Won", "Lost"].includes(data.stage)
          ? old?.stage === data.stage
            ? old.closedAt
            : new Date().toISOString()
          : null;
      return transaction(() => {
        const record = writeRecord(s.workspace_id, kind, data, old);
        event(
          s,
          record.id,
          old ? `Updated ${kind.slice(0, -1)}` : `Created ${kind.slice(0, -1)}`,
          { before: old, after: record },
        );
        if (
          kind === "activities" &&
          data.kind === "Customer interaction" &&
          data.dealId
        ) {
          const deal = getRecord(s.workspace_id, "deals", data.dealId);
          writeRecord(
            s.workspace_id,
            "deals",
            { ...deal, lastContact: today(JSON.parse(s.settings).timezone) },
            deal,
          );
        }
        if (kind === "tasks" && data.dealId && data.done && !old?.done) {
          const deal = getRecord(s.workspace_id, "deals", data.dealId);
          if (deal.nextStep === data.title && deal.nextDate === data.dueDate) {
            const next = list(s.workspace_id, "tasks")
              .filter((t) => t.dealId === deal.id && !t.done)
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
            const after = writeRecord(
              s.workspace_id,
              "deals",
              {
                ...deal,
                nextStep: next?.title || "",
                nextDate: next?.dueDate || "",
              },
              deal,
            );
            event(s, deal.id, "Completed next step", { before: deal, after });
          }
        }
        return record;
      });
    }
    if (req.method === "DELETE" && id) {
      const old = getRecord(s.workspace_id, kind, id);
      assertAccess(s, old);
      if (s.role === "rep" && old.ownerId !== s.user_id)
        throw fail("Only the owner or a manager can remove this record.", 403);
      if (["deals", "accounts", "contacts"].includes(kind))
        throw fail(
          "Keep sales history intact: close the deal or update its status.",
        );
      run(
        "DELETE FROM records WHERE workspace_id=? AND id=?",
        s.workspace_id,
        id,
      );
      event(s, id, `Deleted ${kind.slice(0, -1)}`);
      return { ok: true };
    }
  }
  if (path === "/api/convert" && req.method === "POST") {
    requireWrite(s);
    const p = await body(req),
      lead = getRecord(s.workspace_id, "leads", p.id);
    assertAccess(s, lead);
    if (lead.convertedDealId) return { dealId: lead.convertedDealId };
    if (p.version !== lead.version)
      throw fail("This lead changed. Refresh and try again.", 409);
    return transaction(() => {
      let account = scoped(s, "accounts").find(
        (a) => a.name.toLowerCase() === lead.company?.toLowerCase(),
      );
      if (!account)
        account = writeRecord(s.workspace_id, "accounts", {
          name: lead.company || lead.name,
          industry: "",
          ownerId: lead.ownerId,
        });
      let contact = scoped(s, "contacts").find(
        (c) => c.accountId === account.id && c.email && c.email === lead.email,
      );
      if (!contact)
        contact = writeRecord(s.workspace_id, "contacts", {
          name: lead.name,
          email: lead.email || "",
          accountId: account.id,
          ownerId: lead.ownerId,
        });
      const data = validateRecord(
        "deals",
        {
          name: p.name || `${account.name} opportunity`,
          accountId: account.id,
          contactId: contact.id,
          amount: p.amount,
          stage: JSON.parse(s.settings).stages[0],
          ownerId: lead.ownerId,
          closeDate: p.closeDate,
          nextStep: p.nextStep || "Schedule discovery",
          nextDate: p.nextDate || today(),
          lastContact: "",
          source: lead.source,
          forecast: "Pipeline",
          notes: lead.notes || "",
        },
        JSON.parse(s.settings),
        ownerIds(s),
      );
      const deal = writeRecord(s.workspace_id, "deals", data);
      writeRecord(
        s.workspace_id,
        "leads",
        { ...lead, status: "Qualified", convertedDealId: deal.id },
        lead,
      );
      writeRecord(s.workspace_id, "tasks", {
        title: deal.nextStep,
        dealId: deal.id,
        ownerId: deal.ownerId,
        dueDate: deal.nextDate,
        done: false,
      });
      event(s, deal.id, "Converted lead", { leadId: lead.id });
      return { dealId: deal.id };
    });
  }
  if (path === "/api/snapshots" && req.method === "POST") {
    if (!["admin", "manager"].includes(s.role))
      throw fail("Manager access required.", 403);
    const p = await body(req);
    return transaction(() => {
      const value = writeRecord(s.workspace_id, "snapshots", {
        name: String(p.name || "Forecast review").slice(0, 200),
        ownerId: s.user_id,
        metrics: metrics(
          list(s.workspace_id, "deals"),
          JSON.parse(s.settings),
          today(JSON.parse(s.settings).timezone),
        ),
        deals: list(s.workspace_id, "deals").map((d) => ({
          id: d.id,
          name: d.name,
          stage: d.stage,
          amount: d.amount,
          closeDate: d.closeDate,
          forecast: d.forecast,
        })),
        notes: String(p.notes || "").slice(0, 5000),
      });
      event(s, value.id, "Saved forecast snapshot");
      return value;
    });
  }
  if (path === "/api/settings" && req.method === "PATCH") {
    requireAdmin(s);
    const p = await body(req),
      settings = JSON.parse(s.settings);
    if (p.name !== undefined) {
      if (typeof p.name !== "string" || !p.name.trim())
        throw fail("Workspace name is required.");
      settings.name = p.name.trim().slice(0, 100);
    }
    if (p.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: p.timezone }).format();
      } catch {
        throw fail("Invalid timezone.");
      }
      settings.timezone = p.timezone;
    }
    if (p.target !== undefined) {
      if (!Number.isFinite(p.target) || p.target < 0 || p.target > 1e12)
        throw fail("Enter a valid quarterly target.");
      settings.target = p.target;
    }
    if (p.staleDays !== undefined) {
      if (
        !Number.isInteger(p.staleDays) ||
        p.staleDays < 1 ||
        p.staleDays > 365
      )
        throw fail("Inactivity threshold must be 1–365 days.");
      settings.staleDays = p.staleDays;
    }
    if (p.currency !== undefined) {
      if (!["USD", "EUR", "GBP", "CAD", "AUD"].includes(p.currency))
        throw fail("Unsupported currency.");
      if (
        p.currency !== settings.currency &&
        list(s.workspace_id, "deals").length
      )
        throw fail(
          "Currency cannot change while deals exist; this would relabel amounts without conversion.",
        );
      settings.currency = p.currency;
    }
    if (p.stages !== undefined) {
      if (
        !Array.isArray(p.stages) ||
        p.stages.length < 3 ||
        p.stages.length > 10 ||
        p.stages.some(
          (v) => typeof v !== "string" || !v.trim() || v.length > 30,
        ) ||
        new Set(p.stages).size !== p.stages.length ||
        p.stages.at(-2) !== "Won" ||
        p.stages.at(-1) !== "Lost"
      )
        throw fail("Use 1–8 unique open stages followed by Won and Lost.");
      if (
        list(s.workspace_id, "deals").some((d) => !p.stages.includes(d.stage))
      )
        throw fail("Move existing deals before removing their stage.");
      settings.stages = p.stages;
    }
    if (p.probabilities !== undefined) {
      for (const stage of settings.stages) {
        const n = p.probabilities[stage];
        if (typeof n !== "number" || n < 0 || n > 1)
          throw fail("Every stage needs a probability between 0 and 1.");
      }
      settings.probabilities = { ...p.probabilities, Won: 1, Lost: 0 };
    }
    if (p.template !== undefined) {
      if (
        ![
          "Services",
          "B2B software",
          "Manufacturing",
          "Commercial services",
        ].includes(p.template)
      )
        throw fail("Unknown template.");
      settings.template = p.template;
    }
    run(
      "UPDATE workspaces SET settings=? WHERE id=?",
      JSON.stringify(settings),
      s.workspace_id,
    );
    event(s, null, "Updated workspace settings");
    return settings;
  }
  if (path === "/api/import" && req.method === "POST") {
    requireWrite(s);
    const p = await body(req);
    if (
      !["deals", "leads"].includes(p.kind) ||
      !Array.isArray(p.rows) ||
      !p.rows.length ||
      p.rows.length > 5000
    )
      throw fail("Import 1–5,000 leads or deals per batch.");
    const key = createHash("sha256")
      .update(JSON.stringify({ actor: s.user_id, kind: p.kind, rows: p.rows }))
      .digest("hex");
    const previous = one(
      "SELECT result FROM imports WHERE workspace_id=? AND source_key=?",
      s.workspace_id,
      key,
    );
    if (previous) return { ...JSON.parse(previous.result), replayed: true };
    const settings = JSON.parse(s.settings),
      owners = ownerIds(s),
      accepted = [],
      errors = [],
      seen = new Set(),
      existing = list(s.workspace_id, p.kind);
    p.rows.forEach((row, i) => {
      try {
        const d = validateRecord(
          p.kind,
          { ...row, ownerId: row.ownerId || s.user_id },
          settings,
          owners,
        );
        validateRefs(s, p.kind, d);
        const identity =
          p.kind === "leads"
            ? d.email?.toLowerCase() || `${d.name}|${d.company}`.toLowerCase()
            : `${d.name}|${d.accountId || ""}|${d.closeDate}`.toLowerCase();
        if (
          seen.has(identity) ||
          existing.some(
            (e) =>
              (p.kind === "leads"
                ? e.email?.toLowerCase() ||
                  `${e.name}|${e.company}`.toLowerCase()
                : `${e.name}|${e.accountId || ""}|${e.closeDate}`.toLowerCase()) ===
              identity,
          )
        )
          throw new Error(
            "Possible duplicate. No record was added; adjust identity or edit the existing record.",
          );
        seen.add(identity);
        accepted.push(d);
      } catch (e) {
        errors.push({ row: i + 2, reason: e.message });
      }
    });
    if (p.preview)
      return {
        accepted: accepted.length,
        rejected: errors.length,
        errors,
        total: p.rows.length,
      };
    return transaction(() => {
      const ids = accepted.map(
        (d) =>
          writeRecord(s.workspace_id, p.kind, {
            ...d,
            ...(p.kind === "deals" && ["Won", "Lost"].includes(d.stage)
              ? { closedAt: new Date().toISOString() }
              : {}),
          }).id,
      );
      const result = {
        id: randomUUID(),
        accepted: ids.length,
        rejected: errors.length,
        total: p.rows.length,
        errors,
        ids,
      };
      run(
        "INSERT INTO imports VALUES(?,?,?,?)",
        result.id,
        s.workspace_id,
        key,
        JSON.stringify(result),
      );
      event(s, null, "Imported records", { kind: p.kind, ...result });
      return result;
    });
  }
  if (path === "/api/export" && req.method === "GET")
    return { ...bootstrap(s), exportedAt: new Date().toISOString() };
  throw fail("API route not found.", 404);
}
const assets = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "public/app.js",
  "/style.css": "public/style.css",
  "/legacy/": "legacy/index.html",
  "/legacy/index.html": "legacy/index.html",
  "/legacy/style.css": "legacy/style.css",
  "/legacy/script.js": "legacy/script.js",
  "/superstore-data.js": "superstore-data.js",
  "/sample-sales-data.csv": "sample-sales-data.csv",
};
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  const path = new URL(req.url, "http://localhost").pathname;
  try {
    if (path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      const value = await api(req, res, path);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
      return;
    }
    if (!assets[path]) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const content = readFileSync(join(root, assets[path]));
    res.setHeader(
      "Content-Type",
      path.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : path.endsWith(".css")
          ? "text/css; charset=utf-8"
          : path.endsWith(".csv")
            ? "text/csv; charset=utf-8"
            : "text/html; charset=utf-8",
    );
    if (!path.startsWith("/legacy"))
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
    res.setHeader("Cache-Control", "no-cache");
    res.end(content);
  } catch (error) {
    res.writeHead(error.status || 400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.message || "Request failed." }));
  }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `SalesScope running at http://${process.env.HOST || "127.0.0.1"}:${server.address().port}`,
  ),
);
process.on("SIGTERM", () =>
  server.close(() => {
    db.close();
    process.exit(0);
  }),
);
