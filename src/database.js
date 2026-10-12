import postgres from "postgres";

// The production adapter deliberately speaks PostgreSQL directly.  It keeps a
// client pinned for the lifetime of a transaction so concurrent requests never
// leak transaction state into one another.
export function createPostgresDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL.");
  const sql = postgres(connectionString, { max: Number(process.env.DB_POOL_SIZE || 10) });
  const query = async (text, params = [], client = sql) => {
    const rows = await client.unsafe(text, params);
    return rows;
  };
  return {
    async one(text, params = [], client) {
      return (await query(text, params, client))[0] || null;
    },
    all: query,
    async run(text, params = [], client) {
      const rows = await query(text, params, client);
      return { count: rows.count || 0, rows };
    },
    async transaction(work) {
      return sql.begin(async (client) => work({
        one: (text, params = []) => this.one(text, params, client),
        all: (text, params = []) => this.all(text, params, client),
        run: (text, params = []) => this.run(text, params, client),
      }));
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

export const postgresPlaceholders = (text) => text.replace(/\?/g, (_, offset) => {
  const before = text.slice(0, offset);
  return `$${(before.match(/\?/g) || []).length + 1}`;
});
