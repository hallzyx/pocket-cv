import { headers } from "next/headers";
import { auth } from "./auth";

// Helper para obtener la sesión en Server Components / Server Actions.
// Devuelve { user, session } o null si no hay sesión.
export async function getSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session;
}

// Devuelve el usuario o lanza (en server component) para forzar login.
// Úsalo en páginas protegidas:
//   const user = await requireUser();
export async function requireUser() {
  const session = await getSession();
  if (!session) {
    // En server components, redirect lanza y nunca retorna.
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  return session!.user;
}

// API-friendly auth check: returns the user or null (no redirect).
// Úsalo en API route handlers:
//   const user = await getUserOrNull();
//   if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
export async function getUserOrNull() {
  const session = await getSession();
  return session?.user ?? null;
}
