"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name });

    setLoading(false);

    if (res.error) {
      setError(res.error.message ?? "Ha ocurrido un error");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">PocketCV</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            CVs en formato Harvard optimizados para ATS.
          </p>
        </div>

        <div className="rounded-2xl border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
          <div className="mb-6 flex rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`flex-1 rounded-full py-2 text-sm font-medium transition-colors ${
                mode === "signin"
                  ? "bg-white text-black shadow-sm dark:bg-zinc-800 dark:text-white"
                  : "text-zinc-500"
              }`}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-full py-2 text-sm font-medium transition-colors ${
                mode === "signup"
                  ? "bg-white text-black shadow-sm dark:bg-zinc-800 dark:text-white"
                  : "text-zinc-500"
              }`}
            >
              Crear cuenta
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Nombre</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-black dark:border-white/[.15]"
                  placeholder="Tu nombre"
                />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-black dark:border-white/[.15]"
                placeholder="tu@email.com"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Contraseña</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-black/[.1] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-black dark:border-white/[.15]"
                placeholder="Mínimo 8 caracteres"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-black py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              {loading
                ? "Cargando…"
                : mode === "signin"
                  ? "Iniciar sesión"
                  : "Crear cuenta"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
