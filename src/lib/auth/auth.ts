import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import { user, session, account, verification } from "@/lib/db/auth-schema";

// Tablas de auth (user, session, account, verification) en src/lib/db/auth-schema.ts.
// Migraciones generadas vía Drizzle junto a las de dominio.
// En M0 usamos email/password simple. Invitaciones de usuarios se añaden en M4.
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "mysql",
    schema: { user, session, account, verification },
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
});

export type Session = typeof auth.$Infer.Session;
