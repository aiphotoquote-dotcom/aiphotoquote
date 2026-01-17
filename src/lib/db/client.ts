// src/lib/db/client.ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

// Prefer NON_POOLING for serverless/route handlers to avoid pool weirdness.
// Fall back to DATABASE_URL, then POSTGRES_URL.
const connectionString =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    [
      "Database connection string missing.",
      "Set one of: POSTGRES_URL_NON_POOLING, DATABASE_URL, POSTGRES_URL.",
    ].join(" ")
  );
}

// In dev/hot-reload, avoid creating multiple clients.
const globalForDb = globalThis as unknown as {
  __pg?: ReturnType<typeof postgres>;
};

export const sql =
  globalForDb.__pg ??
  postgres(connectionString, {
    ssl: "require",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__pg = sql;
}

export const db = drizzle(sql);
