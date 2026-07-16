const fs = require("fs");
const mysql = require("mysql2/promise");
const path = require("path");

/**
 * Apply a Drizzle migration SQL file to the given connection.
 * Handles MariaDB compatibility and statement-breakpoint splitting.
 */
async function applyMigration(conn, filePath, label) {
  let sql = fs.readFileSync(filePath, "utf8");

  // MariaDB 10.4 compatibility fixes
  sql = sql.replace(/DEFAULT\s*\(\s*now\(\s*\)\s*\)/gi, "DEFAULT CURRENT_TIMESTAMP");
  sql = sql.replace(/DEFAULT\s*\(\s*'(\[\]|\[\{\}\])\s*\)/g, "DEFAULT '$1'");
  sql = sql.replace(/DEFAULT\s*\(\s*''\s*\)/g, "DEFAULT ''");

  const fixTimestampCol = (colName) => {
    const re = new RegExp(
      "`" + colName + "`\\s+timestamp\\(\\d+\\),(?!\\s*NULL|\\s*NOT)",
      "gi"
    );
    sql = sql.replace(re, "`" + colName + "` timestamp(3) NULL DEFAULT NULL,");
  };
  fixTimestampCol("access_token_expires_at");
  fixTimestampCol("refresh_token_expires_at");

  const statements = sql.split("--> statement-breakpoint");
  let count = 0;

  for (let i = 0; i < statements.length; i++) {
    const trimmed = statements[i].trim();
    if (trimmed) {
      try {
        await conn.query(trimmed);
        count++;
      } catch (e) {
        // Ignore "Duplicate column" / "Duplicate table" errors for idempotency
        if (
          e.errno === 1060 || // ER_DUP_FIELDNAME
          e.errno === 1050 || // ER_TABLE_EXISTS_ERROR
          e.errno === 1061   // ER_DUP_KEYNAME (duplicate index)
        ) {
          console.log(`  [idempotent] ${e.message}`);
        } else {
          console.error(`  Statement ${i} failed: ${e.message}`);
          console.error(`  ${trimmed.substring(0, 120)}`);
          throw e;
        }
      }
    }
  }

  console.log(`  ${label}: ${count} statements applied`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: "localhost", port: 33065, user: "root", password: "",
    charset: "utf8mb4", multipleStatements: true,
  });

  // Drop and recreate clean database
  await conn.query("DROP DATABASE IF EXISTS pocketcv_test");
  await conn.query(
    "CREATE DATABASE pocketcv_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
  );
  await conn.query("USE pocketcv_test");

  const migrationsDir = path.join(__dirname, "..", "db", "migrations");

  // Apply 0000 (base schema + auth tables)
  const m0Path = path.join(migrationsDir, "0000_funny_tempest.sql");
  await applyMigration(conn, m0Path, "Migration 0000");

  // Apply 0001 (M2 Interview Agent: interview_events, extended columns)
  const m1Path = path.join(migrationsDir, "0001_m2_interview.sql");
  await applyMigration(conn, m1Path, "Migration 0001");

  // Apply 0002 (M3 Job Offers: extended job_offers, generations, ai_runs linkage)
  const m2Path = path.join(migrationsDir, "0002_m3_job_offers.sql");
  await applyMigration(conn, m2Path, "Migration 0002");

  // Verify
  const [tables] = await conn.query("SHOW TABLES");
  console.log("Tables:", tables.map((t) => Object.values(t)[0]).join(", "));

  // Verify M2 columns exist
  const [aiCols] = await conn.query("SHOW COLUMNS FROM ai_runs");
  const aiColNames = aiCols.map((c) => c.Field).join(", ");
  console.log("ai_runs columns:", aiColNames);

  const [intCols] = await conn.query("SHOW COLUMNS FROM interviews");
  const intColNames = intCols.map((c) => c.Field).join(", ");
  console.log("interviews columns:", intColNames);

  // Verify M3 columns exist
  const [offerCols] = await conn.query("SHOW COLUMNS FROM job_offers");
  const offerColNames = offerCols.map((c) => c.Field).join(", ");
  console.log("job_offers columns:", offerColNames);

  const [genTables] = await conn.query("SHOW TABLES LIKE 'job_offer_generations'");
  console.log("job_offer_generations exists:", genTables.length > 0 ? "yes" : "NO");

  await conn.end();
  console.log("\npocketcv_test is ready with all three migrations.");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
