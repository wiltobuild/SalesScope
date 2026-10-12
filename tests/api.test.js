import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";

test("persistent lead-to-deal workflow, imports, history, concurrency and tenant boundaries", async (t) => {
  const folder = mkdtempSync(join(tmpdir(), "salesscope-test-")),
    dbPath = join(folder, "test.sqlite");
  let child, base;
  async function start() {
    child = spawn(process.execPath, ["server.js"], {
      cwd: new URL("../", import.meta.url),
      env: { ...process.env, PORT: "0", SALESSCOPE_DB: dbPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Server startup timed out")),
        15000,
      );
      child.stdout.on("data", (b) => {
        output += b;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (!base) reject(new Error("Server exited " + code));
      });
    });
  }
  t.after(() => child?.kill());
  await start();
  function client() {
    let cookie = "";
    return async (path, method = "GET", data) => {
      const res = await fetch(base + "/api" + path, {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      if (res.headers.get("set-cookie"))
        cookie = res.headers.get("set-cookie").split(";")[0];
      return { status: res.status, data: await res.json() };
    };
  }
  const a = client(),
    b = client();
  assert.equal((await a("/bootstrap")).status, 401);
  assert.equal((await a("/demo", "POST")).status, 200);
  let state = (await a("/bootstrap")).data;
  assert.equal(state.data.deals.length, 12);
  assert.equal(
    (
      await b("/auth/register", "POST", {
        name: "QA Rep",
        email: "qa@example.com",
        password: "test-only-secret-1234",
      })
    ).status,
    200,
  );
  const empty = (await b("/bootstrap")).data;
  assert.equal(empty.data.deals.length, 0);
  const lead = (
    await a("/records/leads", "POST", {
      name: "Test buyer",
      company: "Test company",
      email: "test@example.com",
      status: "New",
      source: "QA",
      ownerId: state.user.id,
    })
  ).data;
  assert.ok(lead.id);
  const conversion = await a("/convert", "POST", {
    id: lead.id,
    version: lead.version,
    amount: 12345,
    closeDate: "2026-12-10",
    nextStep: "Run discovery",
    nextDate: "2026-10-15",
  });
  assert.equal(conversion.status, 200);
  const id = conversion.data.dealId;
  assert.equal(
    (
      await a("/convert", "POST", {
        id: lead.id,
        version: lead.version,
        amount: 9,
      })
    ).data.dealId,
    id,
  );
  state = (await a("/bootstrap")).data;
  let deal = state.data.deals.find((d) => d.id === id);
  assert.equal(deal.amount, 12345);
  assert.ok(state.data.accounts.find((x) => x.id === deal.accountId));
  assert.ok(state.data.contacts.find((x) => x.id === deal.contactId));
  assert.ok(state.data.tasks.find((x) => x.dealId === id));
  const initialTask = state.data.tasks.find((x) => x.dealId === id);
  assert.equal(
    (
      await a("/records/tasks/" + initialTask.id, "PATCH", {
        ...initialTask,
        done: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await a("/bootstrap")).data.data.deals.find((d) => d.id === id).nextStep,
    "",
  );
  deal = (await a("/bootstrap")).data.data.deals.find((d) => d.id === id);
  assert.equal(
    (
      await b("/records/deals/" + id, "PATCH", {
        ...deal,
        name: "Cross tenant",
      })
    ).status,
    404,
  );
  const updated = await a("/records/deals/" + id, "PATCH", {
    ...deal,
    stage: "Proposal",
  });
  assert.equal(updated.status, 200);
  assert.equal(
    (
      await a("/records/deals/" + id, "PATCH", {
        ...deal,
        stage: "Negotiation",
      })
    ).status,
    409,
  );
  deal = updated.data;
  assert.equal(
    (
      await a("/records/deals/" + id, "PATCH", {
        ...deal,
        closeDate: "2026-02-31",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await a("/records/activities", "POST", {
        dealId: id,
        ownerId: state.user.id,
        text: "Internal note",
        kind: "Internal note",
      })
    ).status,
    200,
  );
  assert.equal(
    (await a("/bootstrap")).data.data.deals.find((d) => d.id === id)
      .lastContact,
    "",
  );
  await a("/records/activities", "POST", {
    dealId: id,
    ownerId: state.user.id,
    text: "Customer call",
    kind: "Customer interaction",
  });
  assert.ok(
    (await a("/bootstrap")).data.data.deals.find((d) => d.id === id)
      .lastContact,
  );
  const snap = (
    await a("/snapshots", "POST", { name: "Review one", notes: "Baseline" })
  ).data;
  assert.ok(snap.id);
  assert.equal(snap.deals.find((d) => d.id === id).stage, "Proposal");
  deal = (await a("/bootstrap")).data.data.deals.find((d) => d.id === id);
  await a("/records/deals/" + id, "PATCH", { ...deal, stage: "Negotiation" });
  assert.equal(
    (await a("/bootstrap")).data.data.snapshots[0].deals.find(
      (d) => d.id === id,
    ).stage,
    "Proposal",
  );
  const rows = [
    {
      name: "Imported buyer",
      email: "new@example.com",
      company: "Import Co",
      ownerId: state.user.id,
    },
    { name: "", ownerId: state.user.id },
    {
      name: "Imported duplicate",
      email: "new@example.com",
      ownerId: state.user.id,
    },
  ];
  const preview = (
    await a("/import", "POST", { kind: "leads", rows, preview: true })
  ).data;
  assert.equal(preview.accepted, 1);
  assert.equal(preview.rejected, 2);
  const committed = (await a("/import", "POST", { kind: "leads", rows })).data;
  assert.equal(committed.accepted, 1);
  assert.equal(
    (await a("/import", "POST", { kind: "leads", rows })).data.replayed,
    true,
  );
  const savedView = await a("/records/views", "POST", {
    name: "My proposal deals",
    ownerId: state.user.id,
    ownerFilter: state.user.id,
    stageFilter: "Proposal",
    query: "",
    mode: "table",
  });
  assert.equal(savedView.status, 200);
  assert.equal(
    (await a("/bootstrap")).data.data.views[0].name,
    "My proposal deals",
  );
  const invitation = await a("/invitations", "POST", {
    email: "invited@example.com",
    role: "rep",
  });
  assert.equal(invitation.status, 200);
  const token = invitation.data.token;
  const c = client();
  assert.equal((await c("/invitation?token=" + token)).data.role, "rep");
  assert.equal(
    (
      await c("/auth/join", "POST", {
        token,
        name: "Invited Seller",
        password: "test-only-password-5678",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await c("/auth/join", "POST", {
        token,
        name: "Invited Seller",
        password: "test-only-password-5678",
      })
    ).status,
    404,
  );
  let inviteState = (await c("/bootstrap")).data;
  assert.equal(inviteState.data.deals.length, 0);
  let assign = (await a("/bootstrap")).data.data.deals.find((d) => d.id === id);
  assert.equal(
    (
      await a("/records/deals/" + id, "PATCH", {
        ...assign,
        ownerId: inviteState.user.id,
      })
    ).status,
    200,
  );
  inviteState = (await c("/bootstrap")).data;
  assert.equal(inviteState.data.deals.length, 1);
  assert.ok(inviteState.data.accounts.some((x) => x.id === assign.accountId));
  assert.ok(inviteState.data.contacts.some((x) => x.id === assign.contactId));
  const linked = inviteState.data.accounts.find(
    (x) => x.id === assign.accountId,
  );
  assert.equal(
    (
      await c("/records/accounts/" + linked.id, "PATCH", {
        ...linked,
        name: "Not owned",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await c("/records/deals/" + id, "PATCH", {
        ...inviteState.data.deals[0],
        nextStep: "Seller follow-up",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await c("/invitations", "POST", {
        email: "blocked@example.com",
        role: "manager",
      })
    ).status,
    403,
  );
  assert.equal(
    (await c("/workspace", "POST", { id: empty.workspace.id })).status,
    404,
  );
  const count = (await a("/bootstrap")).data.data.leads.length;
  const exited = once(child, "exit");
  child.kill();
  await exited;
  await start();
  assert.equal((await a("/bootstrap")).data.data.leads.length, count);
  // Exercise record scoping with the same real account after restricting its role.
  const db = new DatabaseSync(dbPath);
  db.prepare(
    "UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?",
  ).run("rep", state.workspace.id, state.user.id);
  db.close();
  const rep = (await a("/bootstrap")).data;
  assert.ok(
    rep.data.deals.every(
      (d) =>
        d.ownerId === state.user.id ||
        rep.data.tasks.some(
          (t) => t.ownerId === state.user.id && t.dealId === d.id,
        ),
    ),
  );
  assert.equal(rep.data.snapshots.length, 0);
  const foreign = state.data.deals.find((d) => d.ownerId !== state.user.id);
  assert.equal(
    (
      await a("/records/deals/" + foreign.id, "PATCH", {
        ...foreign,
        name: "Forbidden",
      })
    ).status,
    404,
  );
  assert.equal((await a("/settings", "PATCH", { target: 10 })).status, 403);
  assert.equal(
    (await a("/snapshots", "POST", { name: "Forbidden" })).status,
    403,
  );
  const exported = (await a("/export")).data;
  assert.ok(
    exported.data.deals.every(
      (d) =>
        d.ownerId === state.user.id ||
        exported.data.tasks.some(
          (t) => t.ownerId === state.user.id && t.dealId === d.id,
        ),
    ),
  );
  const db2 = new DatabaseSync(dbPath);
  db2
    .prepare("UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?")
    .run("viewer", state.workspace.id, state.user.id);
  db2.close();
  assert.equal(
    (
      await a("/records/leads", "POST", {
        name: "Forbidden",
        ownerId: state.user.id,
      })
    ).status,
    403,
  );
  assert.equal((await b("/auth/logout", "POST")).status, 200);
  assert.equal((await b("/bootstrap")).status, 401);
  assert.equal(
    (
      await b("/auth/login", "POST", {
        email: "qa@example.com",
        password: "wrong",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await b("/auth/login", "POST", {
        email: "qa@example.com",
        password: "test-only-secret-1234",
      })
    ).status,
    200,
  );
});
