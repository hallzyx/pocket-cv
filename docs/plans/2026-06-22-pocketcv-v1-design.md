# PocketCV — Diseño v1

**Fecha:** 2026-06-22
**Estado:** Aprobado para implementación

## Visión

PocketCV es una aplicación web que genera CVs en formato Harvard vía LaTeX,
optimizados para superar filtros ATS. Está **dirigida por un agente autónomo**
con acceso a la base de datos del usuario: el agente entrevista, almacena el
perfil profesional, y deriva CVs a medida para cada oferta de trabajo.

Empieza como app personal local (localhost) y migra sin refactor a producción
(Docker/VPS) cuando se invite a otros usuarios.

## Requisitos (v1)

1. **Generar CV** desde el perfil del usuario en formato Harvard.
2. **Adaptar a vacante**: pegar oferta → el agente selecciona contenido óptimo.
3. **Importar CV previo** (PDF) para pre-llenar el perfil vía IA multimodal.
4. **Agente autónomo** con acceso a MySQL, que entrevista y consulta al usuario.
5. **Score ATS en vivo** durante la edición.
6. **Auth**: uso personal inicial, escalable a invitados.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| Estilos | Tailwind CSS |
| Auth | Better-Auth |
| Base de datos | MySQL 8 |
| IA | DeepSeek API (`deepseek-v4-flash` y `deepseek-v4-pro`) |
| Compilación LaTeX | `node-latex-compiler` (Tectonic auto-descargado) |
| Agente | Function calling (interfaz MCP-compatible para futuro) |

**Justificación del motor PDF:** LaTeX justificado por ATS-friendliness
(gold standard para extracción de texto) y autenticidad tipográfica Harvard.
`node-latex-compiler` elimina la fricción de instalar una distribución LaTeX
completa: es un binario Tectonic autocontenido, mismo código local y en
producción (Docker/VPS).

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│  Navegador (Next.js)                                     │
│  • Login (Better-Auth)                                   │
│  • Editor inline + preview LaTeX + score ATS en vivo     │
│  • Chat con agente                                       │
│  • Pegar oferta / subir CV existente                     │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP / SSE (localhost)
┌───────────────────────────▼─────────────────────────────┐
│  Backend Next.js (App Router)                            │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐ │
│  │  Auth    │ │  CV      │ │ Agente  │ │ LaTeX        │ │
│  │Better-Auth│ │ CRUD    │ │ loop +  │ │ Compiler     │ │
│  │          │ │          │ │ tools   │ │ (Tectonic)   │ │
│  └──────────┘ └──────────┘ └────┬────┘ └──────┬───────┘ │
└─────────────────────────────────┼─────────────┼─────────┘
                          ┌───────┘             │
                  ┌───────▼────────┐    ┌───────▼────────┐
                  │ DeepSeek API   │    │  Tectonic      │
                  │ v4-flash / pro │    │  (npm binario) │
                  │  multimodal    │    │  on-demand PDF │
                  └────────────────┘    └────────────────┘
                          │
                  ┌───────▼────────┐
                  │   MySQL 8      │
                  │ (perfil, CVs,  │
                  │  ofertas, runs)│
                  └────────────────┘
```

**El PDF nunca se persiste.** Se compila on-demand desde `tex_source`.
La fuente de verdad es siempre la data en MySQL.

## Modelo de datos

El perfil profesional del usuario es la **fuente de verdad**. Cada CV es una
**derivación** a medida, opcionalmente vinculada a una oferta.

```sql
-- Better-Auth gestiona users (id, email, name, ...)

professional_profile          -- master record de cada usuario
  id, user_id (unique)
  personal_info   JSON        -- nombre, contacto, links
  experiences     JSON        -- [] todas (incluso las que no entran en un CV)
  education       JSON
  skills          JSON        -- [] todas las skills, agrupadas por categoría
  projects        JSON        -- [] con tags de temática para inclusión condicional
  achievements    JSON
  preferences     JSON        -- seniority, idiomas, config del agente
  created_at, updated_at

interviews                   -- sesiones de entrevista (estado transitorio)
  id, user_id
  status           ENUM('active','completed','paused')
  transcript       JSON       -- historial de la conversación
  created_at, updated_at

job_offers                   -- ofertas pegadas por el usuario
  id, user_id
  raw_text         TEXT
  extracted_keywords JSON []
  detected_category VARCHAR  -- para decidir inclusión de projects
  created_at

cvs                          -- CVs derivados, vinculados a oferta
  id, user_id
  job_offer_id     BIGINT NULL  -- NULL = CV general (no atado a vacante)
  title            VARCHAR
  content_json     JSON        -- la fuente de verdad (data, no PDF)
  tex_source       LONGTEXT    -- .tex derivado (cacheable)
  ats_score        INT         -- resultado del validador ATS
  source           ENUM('manual','ai')
  created_at, updated_at

ai_runs                      -- auditoría y control de coste
  id, user_id
  model            ENUM('v4-flash','v4-pro')
  task             VARCHAR     -- 'interview','keyword_extract','generate_tex',...
  tokens_in, tokens_out INT
  cost_usd         DECIMAL(10,4)
  created_at
```

**Decisiones clave:**
- Las secciones del perfil son **arrays JSON**, no tablas relacionales. Un
  perfil es un documento. Simplifica el CRUD y el paso de contexto al agente.
- `cvs.job_offer_id` **vincula** cada CV con la oferta que lo originó. Así se
  puede consultar "esta oferta generó estos N CVs". `NULL` = CV general.
- `tex_source` se guarda pero **el PDF no**. Se compila on-demand (1-2s con
  Tectonic, irrelevante para uso personal).
- `ai_runs` permite ver el **coste real** por usuario/tarea — crítico cuando
  se invite a otros.

## El agente autónomo

### Bucle agéntico

```
LLM (DeepSeek) ──► texto Y/O tool_calls
      ▲                  │
      │                  ▼
      └─── resultados ── ejecutar tools contra MySQL
                        (repetir hasta respuesta final)
```

### Tools disponibles

```
ACCESO AL PERFIL (lectura)
  query_experiences(filters)       -- "dame exp. con React, 2020-2023"
  query_skills(category?)
  query_projects(tags?)            -- clave para inclusión condicional
  search_profile(texto_libre)      -- "¿tengo algo de fintech?"

ESCRITURA (durante entrevista)
  add_experience / add_skill / add_project / add_education
  update_profile_field

GENERACIÓN DE CV
  find_relevant_content(offer_keywords)   -- selección inteligente
  save_cv(content_json, tex_source, ats_score)
  extract_keywords_from_offer(raw_text)

ESCALAR AL HUMANO
  ask_user(question, level: 'critical' | 'optional')
    -- 'critical': bloquea el flujo hasta respuesta
    -- 'optional': sugerencia no bloqueante
```

Las tools se definen con interfaz MCP-compatible
(`name`, `description`, `input_schema`) para migrar a servidor MCP sin
reescribir la lógica de negocio.

### Dos modos del mismo agente

- **Modo entrevista** (setup inicial): guía al usuario para poblar
  `professional_profile`. Usa tools de escritura.
- **Modo adaptación** (con una oferta): lee perfil + keywords → selecciona
  contenido óptimo → decide inclusión de projects → genera `.tex` →
  consulta huecos críticos/opcionales vía `ask_user`.

Mismo loop, distinto system prompt y set de tools.

### Memoria

**Stateless.** El agente carga contexto fresco desde MySQL al inicio de cada
sesión (perfil + oferta relevante + historial de entrevistas previas si hace
falta). Sin estado de agente persistente que sincronizar.

### Router de modelos (DeepSeek)

| Tarea | Modelo | Razón |
|---|---|---|
| Extraer keywords de oferta | `v4-flash` | Tarea estructurada, barata |
| Leer perfil y seleccionar | `v4-flash` | RAG simple sobre JSON |
| Entrevista interactiva | `v4-flash` | Conversación guiada |
| **Redacción de bullets** | `v4-pro` | Calidad de escritura |
| **Generación del `.tex`** | `v4-pro` | Precisión estructural |
| **Adaptación ATS sofisticada** | `v4-pro` | Razonamiento sobre keywords |

## Editor manual (UX)

Editor **estructurado por secciones** con:

- **Click-to-edit inline**: cada campo se edita in situ, sin formularios
  modales pesados.
- **Preview LaTeX en vivo** en panel lateral derecho: refresca el `.tex` y el
  score ATS al editar.
- **Score ATS first-class**: visible siempre mientras editas, no al final.
  Si baja de umbral, sugiere correcciones.

Justificación: el agente hace el trabajo grueso. El editor manual es solo para
retoques de control. Click-to-edit + preview vivo es el balance óptimo entre
control y velocidad.

## Flujo end-to-end (oferta → PDF)

```
1. [Entrevista inicial, una sola vez]
   Usuario ◄──► Agente (modo entrevista)
                   │ tools: add_experience, add_skill, ...
                   ▼
              professional_profile poblado en MySQL

2. [Pegas una oferta de trabajo]
   job_offers ◄── raw_text
                   │ tool: extract_keywords_from_offer
                   ▼
              keywords[] + categoría detectada

3. [El agente selecciona contenido]
   Agente lee professional_profile + keywords
      │ tool: find_relevant_content
      │ decide: ¿projects relevantes? → incluye/omite
      ▼
   ¿Falta algo crítico? ──► ask_user(critical) → BLOQUEA
   ¿Hay algo opcional?  ──► ask_user(optional) → puede saltar

4. [Generación del .tex]
   Agente compone el .tex Harvard (deepseek-v4-pro)
      │ validador ATS en bucle: si score < umbral, autocorrige
      ▼
   node-latex-compiler (Tectonic) ──► PDF Buffer (on-demand)

5. [Persistencia]
   cvs ◄── {content_json, tex_source, ats_score, job_offer_id, source:'ai'}
   (el PDF NO se guarda; se compila al descargar)
```

## Estructura del proyecto

```
pocketcv/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (auth)/               # login, signup
│   │   ├── dashboard/            # lista de CVs y ofertas
│   │   ├── editor/[cvId]/        # editor inline + chat agente + preview
│   │   └── api/
│   │       ├── agent/            # endpoint de chat (SSE)
│   │       └── pdf/[cvId]/       # compila y descarga PDF on-demand
│   ├── lib/
│   │   ├── db/                   # schema, migraciones, consultas
│   │   ├── auth/                 # Better-Auth config
│   │   ├── latex/                # plantilla Harvard + compilación
│   │   │   ├── template.ts       # generador de .tex desde JSON
│   │   │   └── compile.ts        # wrapper de node-latex-compiler
│   │   ├── ai/
│   │   │   ├── deepseek.ts       # cliente + router flash/pro
│   │   │   ├── agent.ts          # agent loop (tool-use)
│   │   │   ├── prompts/          # system prompts (entrevista, adaptación)
│   │   │   └── tools/            # definición de tools (interfaz MCP-compatible)
│   │   └── ats/                  # validador ATS (score + sugerencias)
│   └── components/               # UI (editor, chat, preview, score gauge)
├── db/
│   ├── schema.sql
│   └── migrations/
├── docs/plans/
└── docker-compose.yml            # MySQL local (producción después)
```

## Roadmap

```
M0 — Fundaciones (semana 1)
   Next.js + Better-Auth + MySQL + docker-compose
   Estructura del proyecto y schema inicial

M1 — Editor manual + LaTeX + score ATS (semana 2)
   CRUD del CV → plantilla Harvard → PDF descargable on-demand
   Validador ATS con score en vivo durante la edición
   (sin IA todavía; validamos el motor PDF y el feedback ATS)

M2 — Agente en modo entrevista (semana 3)
   Tools de escritura + chat SSE → puebla professional_profile

M3 — Adaptación a oferta (semana 4)
   Pegar oferta → extract_keywords → selección → .tex → PDF
   + tool ask_user (critical/optional)
   + inclusión condicional de projects por categoría

M4 — Pulido (semana 5)
   Importar CV existente (IA multimodal) para pre-llenar perfil
   Dashboard de coste (ai_runs) y versiones de CV
   Invitaciones a otros usuarios
```

## Decisiones registradas

- **LaTeX vía Tectonic** (no Puppeteer/react-pdf): ATS gold standard + estética
  Harvard + mismo código local/producción.
- **Tools directas, no MCP**: arrancar rápido; interfaz MCP-compatible para
  migrar sin reescribir.
- **Stateless**: el agente lee de MySQL, sin estado que sincronizar.
- **PDF no persistido**: la data es la fuente de verdad; el PDF es vista efímera.
- **CVs vinculados a ofertas** vía `cvs.job_offer_id`.
- **Score ATS first-class** desde M1, no al final.
- **Projects con inclusión condicional**: el agente decide según categoría de oferta.
- **JSON en secciones del perfil**, no tablas relacionales: el perfil es documento.
