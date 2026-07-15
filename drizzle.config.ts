import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Schema de dominio + schema de auth (Better-Auth) en archivos separados.
  schema: ["./src/lib/db/schema.ts", "./src/lib/db/auth-schema.ts"],
  out: "./db/migrations",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.POCKETCV_DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
