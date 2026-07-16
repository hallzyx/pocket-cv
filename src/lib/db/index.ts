import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "./schema";

// Pool único por proceso (Next.js reusa módulos en server side).
declare global {
  // eslint-disable-next-line no-var
  var __pocketcvDb: DbClient | undefined;
}

export type DbClient = ReturnType<typeof createDb>;

// Parseamos la DATABASE_URL a mano para garantizar host/port correctos.
// En este entorno mysql2 ignora el puerto si se pasa la uri como string
// cuando hay un MySQL nativo escuchando en 3306.
function parseDbUrl(url: string) {
  const m = url.match(/^mysql:\/\/([^:]+):([^@]*)@([^:]+):(\d+)\/(.+)$/);
  if (!m) throw new Error(`DATABASE_URL inválida: ${url}`);
  return {
    user: decodeURIComponent(m[1]),
    password: decodeURIComponent(m[2]),
    host: m[3],
    port: Number(m[4]),
    database: m[5],
  };
}

/**
 * mysql2's typeCast callback receives a `Field` object whose `.type`
 * property is a human-readable string (e.g. "BLOB", "VAR_STRING").
 * This differs from `FieldPacket.type` which is a numeric enum.
 * We match on the string form to detect BLOB columns sent by MariaDB
 * for its JSON-column alias.
 *
 * Only columns in this set — our known JSON schema columns — are candidates
 * for automatic JSON parsing. This avoids corrupting LONGTEXT columns like
 * `job_offers.raw_text` whose content happens to start with `{` or `[`.
 */
const MYSQL_FIELD_TYPE_BLOB = "BLOB";

/** Known JSON column names in the schema (MariaDB reports these as BLOB). */
const KNOWN_JSON_COLUMNS = new Set([
  "personal_info",
  "experiences",
  "education",
  "skills",
  "projects",
  "achievements",
  "preferences",
  "transcript",
  "extracted_keywords",
  "content_json",
  "payload",
  "questions_json",
  "selection_json",
  "overrides_json",
  "suggestions",
]);

/** mysql2-style Pool.query overload that accepts object options. */
type PoolQueryFn = {
  <T extends mysql.QueryResult>(sql: string, values?: mysql.QueryValues): Promise<[T, mysql.FieldPacket[]]>;
  <T extends mysql.QueryResult>(options: mysql.QueryOptions, values?: mysql.QueryValues): Promise<[T, mysql.FieldPacket[]]>;
};

/** The internal query wrapper receives the same shapes. */
type QueryOptionsArg = mysql.QueryOptions | string;

function createDb() {
  // Usamos POCKETCV_DATABASE_URL (propia) en lugar de DATABASE_URL, porque
  // el shell del entorno puede tener una DATABASE_URL global de otro proyecto
  // que Next.js prioriza sobre el .env local.
  const url = process.env.POCKETCV_DATABASE_URL!;
  const cfg = parseDbUrl(url);
  const pool = mysql.createPool({
    ...cfg,
    // utf8mb4 para soporte completo de caracteres (acentos, emojis, etc.)
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
  });

  // Drizzle ORM's MySQL driver sets its own typeCast that only handles
  // TIMESTAMP/DATETIME/DATE fields and falls through to the default mysql2
  // behaviour for everything else. The default mysql2 behaviour for BLOB
  // columns (which is what MariaDB reports JSON as) returns a Buffer.
  //
  // We patch `pool.query` so that after Drizzle's typeCast runs (or the
  // default mysql2 casting), any string that looks like valid JSON
  // gets parsed into a JavaScript object. This makes JSON columns work
  // transparently regardless of whether the database is real MySQL or
  // MariaDB, and without modifying any route handler.
  const origPoolQuery = pool.query.bind(pool) as PoolQueryFn;

  function patchQueryOptions(
    opts: string | mysql.QueryOptions,
  ): mysql.QueryOptions {
    const opt =
      typeof opts === "string" ? ({ sql: opts } as mysql.QueryOptions) : { ...opts };
    const origTC = opt.typeCast as ((field: unknown, next: () => void) => unknown) | undefined;

    if (origTC) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      opt.typeCast = function wrappedTypeCast(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        field: any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        next: any,
      ) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        const result = origTC(field, next);
        if (
          field &&
          typeof field.type === "string" &&
          field.type === MYSQL_FIELD_TYPE_BLOB &&
          typeof result === "string" &&
          typeof field.name === "string" &&
          KNOWN_JSON_COLUMNS.has(field.name)
        ) {
          try {
            return JSON.parse(result as string);
          } catch {
            return result;
          }
        }
        return result;
      } as NonNullable<typeof opt.typeCast>;
    }

    return opt;
  }

  pool.query = ((options: QueryOptionsArg, values?: mysql.QueryValues) => {
    return origPoolQuery(patchQueryOptions(options), values);
  }) as PoolQueryFn;

  return drizzle(pool, { schema, mode: "default" });
}

export const db = globalThis.__pocketcvDb ?? (globalThis.__pocketcvDb = createDb());

if (process.env.NODE_ENV !== "production") globalThis.__pocketcvDb = db;
