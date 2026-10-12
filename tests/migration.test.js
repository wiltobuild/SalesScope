import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Supabase migration creates the complete scoped persistence model", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261012210000_initial_sales_scope.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "workspaces", "users", "memberships", "sessions", "records",
    "events", "invitations", "imports",
  ])
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql, /create index if not exists records_scope/);
  assert.match(sql, /unique\(workspace_id, source_key\)/);
  assert.match(sql, /revoke all on all tables in schema public from anon, authenticated/);
});
