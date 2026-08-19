import { requireAdmin } from "../../../../lib/member-auth";

type SqliteObject = { name: string; sql: string | null };
type TableInfo = { name: string };
type D1Result<T> = { results?: T[] };
type RuntimeDatabase = {
  prepare(query: string): { all<T>(): Promise<D1Result<T>> };
};

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteBlob(bytes: Uint8Array) {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `X'${hex}'`;
}

function quoteValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Uint8Array) return quoteBlob(value);
  if (value instanceof ArrayBuffer) return quoteBlob(new Uint8Array(value));
  return `'${String(value).replaceAll("'", "''")}'`;
}

function ensureStatement(sql: string) {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

async function runtimeDatabase() {
  const runtime = await import("cloudflare:workers") as { env?: { DB?: RuntimeDatabase } };
  if (!runtime.env?.DB) throw new Error("Cloudflare D1 binding DB is unavailable");
  return runtime.env.DB;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const database = await runtimeDatabase();
  const objects = (await database.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '_cf_%'
      AND sql IS NOT NULL
    ORDER BY name
  `).all<SqliteObject>()).results ?? [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (value: string) => controller.enqueue(encoder.encode(`${value}\n`));
      try {
        write("-- silu-mentor database export");
        write("-- Generated for a one-time migration; keep this file private.");
        write("PRAGMA foreign_keys=OFF;");
        write("");

        for (const object of objects) write(ensureStatement(object.sql!));
        write("");

        for (const object of objects) {
          const table = quoteIdentifier(object.name);
          const columns = ((await database.prepare(`PRAGMA table_info(${table})`).all<TableInfo>()).results ?? []).map((column) => column.name);
          if (!columns.length) continue;
          const columnSql = columns.map(quoteIdentifier).join(", ");
          let offset = 0;
          while (true) {
            const page = (await database.prepare(`SELECT * FROM ${table} LIMIT 500 OFFSET ${offset}`).all<Record<string, unknown>>()).results ?? [];
            if (!page.length) break;
            for (const row of page) {
              const values = columns.map((column) => quoteValue(row[column])).join(", ");
              write(`INSERT INTO ${table} (${columnSql}) VALUES (${values});`);
            }
            offset += page.length;
            if (page.length < 500) break;
          }
        }

        const secondaryObjects = (await database.prepare(`
          SELECT sql
          FROM sqlite_master
          WHERE type IN ('index', 'trigger', 'view')
            AND name NOT LIKE 'sqlite_%'
            AND name NOT LIKE '_cf_%'
            AND sql IS NOT NULL
          ORDER BY type, name
        `).all<{ sql: string }>()).results ?? [];
        write("");
        for (const object of secondaryObjects) write(ensureStatement(object.sql));
        write("PRAGMA foreign_keys=ON;");
        controller.close();
      } catch (error) {
        controller.error(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate",
      "content-type": "application/sql; charset=utf-8",
      "content-disposition": 'attachment; filename="silu-mentor-source.sql"',
    },
  });
}
