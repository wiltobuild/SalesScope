import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

test("Postgres schema preserves JSONB, booleans, timestamps and atomic version checks", async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec(`create table records (id uuid primary key, data jsonb not null, done boolean not null, created_at timestamptz not null, version integer not null)`);
  const id = "00000000-0000-0000-0000-000000000001";
  await db.query("insert into records values ($1, $2, $3, $4, $5)", [id, { label: "safe" }, true, "2026-10-12T12:00:00Z", 1]);
  const updated = await db.query("update records set data=$1, version=version+1 where id=$2 and version=$3 returning version, data, done, created_at", [{ label: "updated" }, id, 1]);
  assert.equal(updated.rows[0].version, 2);
  assert.equal(updated.rows[0].data.label, "updated");
  assert.equal(updated.rows[0].done, true);
  assert.equal(updated.rows[0].created_at.toISOString(), "2026-10-12T12:00:00.000Z");
  const conflict = await db.query("update records set version=version+1 where id=$1 and version=$2 returning version", [id, 1]);
  assert.equal(conflict.rows.length, 0);
});
