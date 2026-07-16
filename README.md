# PocketCV

CVs en formato Harvard optimizados para ATS, generados con IA.

## Requisitos

- Node.js 20+
- Docker (para MySQL local con docker-compose)
- DeepSeek API key (para el agente de entrevista M2)

## Configuración

1. Copia `.env.example` a `.env` y completa los valores:

```bash
cp .env.example .env
```

2. Inicia la base de datos:

```bash
docker compose up -d
```

3. Ejecuta las migraciones:

```bash
npx drizzle-kit push
```

4. Para el agente de entrevista (M2), asegúrate de haber configurado:

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `POCKETCV_DATABASE_URL` | Cadena de conexión MySQL | `mysql://pocketcv:pocketcvpass@localhost:3307/pocketcv` |
| `DEEPSEEK_API_KEY` | API key de DeepSeek | `sk-...` |
| `DEEPSEEK_MODEL` | Modelo DeepSeek (default: `deepseek-chat`) | `deepseek-chat` |

Si la API key no está configurada, la ruta de mensajes devuelve un error controlado.

### Límites del agente

| Parámetro | Valor |
|-----------|-------|
| Tool calls máximos por run | 6 |
| Timeout por turno | 60s |
| Reintentos de provider (pre-output) | 1 |
| Mensajes de transcript en contexto | 100 (~100k chars) |
| Caracteres máximos por mensaje usuario | 8,000 |

## Desarrollo

```bash
npm run dev
# o
bun dev
```

Abre [http://localhost:3000](http://localhost:3000).

### Tests

```bash
# Tests unitarios y de componentes
npx vitest run

# Tests de integración con MySQL (requiere docker compose up -d)
npx vitest run src/app/api/interviews
```

### Migraciones

Las migraciones de base de datos están en `db/migrations/`. Se aplican con:

```bash
npx drizzle-kit push
```

Para crear una nueva migración:

```bash
npx drizzle-kit generate
```

## Estructura

| Ruta | Descripción |
|------|-------------|
| `src/app/page.tsx` | Landing page |
| `src/app/dashboard/` | Dashboard con lista de CVs |
| `src/app/profile/` | Editor de perfil profesional |
| `src/app/interview/` | Entrevista conversacional con IA (M2) |
| `src/app/editor/[cvId]/` | Editor de CV individual |
| `src/lib/ai/` | Core del agente: provider, tools, SSE, runs |
| `src/lib/db/schema.ts` | Esquema de base de datos (Drizzle) |
| `src/lib/profile/sync.ts` | Fusión canónica de perfil con dedup semántico |

## Stack

- [Next.js 16](https://nextjs.org) (App Router)
- [Drizzle ORM](https://orm.drizzle.team) + MySQL
- [Better Auth](https://better-auth.com)
- [DeepSeek API](https://platform.deepseek.com) (agente conversacional)
- [Vitest](https://vitest.dev) (tests)
- LaTeX (compilación de PDF vía `lualatex`)
