import {
  mysqlTable,
  bigint,
  varchar,
  text,
  longtext,
  json,
  int,
  decimal,
  datetime,
  mysqlEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { createId } from "@paralleldrive/cuid2";

const now = () => new Date();
// drizzle-orm 0.45: datetime default con función requiere .$defaultFn,
// y el auto-update en UPDATE requiere .$onUpdate.

// Better-Auth gestiona users/sessions/accounts/verification en sus tablas.
// Aquí definimos SOLO las tablas de dominio de PocketCV.
// Las tablas de auth se generan vía `npx @better-auth/cli@latest generate`.

// ─────────────────────────────────────────────────────────────────────────────
// Perfil profesional — la fuente de verdad sobre el usuario.
// Secciones como arrays JSON: el perfil es un documento, no relaciones.
// ─────────────────────────────────────────────────────────────────────────────
export const professionalProfile = mysqlTable(
  "professional_profile",
  {
    id: varchar("id", { length: 128 }).$defaultFn(() => createId()).primaryKey(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    personalInfo: json("personal_info").$type<PersonalInfo>(),
    experiences: json("experiences").$type<Experience[]>().default([]),
    education: json("education").$type<Education[]>().default([]),
    skills: json("skills").$type<Skill[]>().default([]),
    projects: json("projects").$type<Project[]>().default([]),
    achievements: json("achievements").$type<Achievement[]>().default([]),
    preferences: json("preferences").$type<ProfilePreferences>(),
    createdAt: datetime("created_at").$defaultFn(now).notNull(),
    updatedAt: datetime("updated_at").$defaultFn(now).$onUpdate(() => new Date()).notNull(),
  },
  (table) => [uniqueIndex("professional_profile_user_unique").on(table.userId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Entrevistas — sesiones transitorias del agente en modo entrevista.
// ─────────────────────────────────────────────────────────────────────────────
export const interviews = mysqlTable(
  "interviews",
  {
    id: varchar("id", { length: 128 }).$defaultFn(() => createId()).primaryKey(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    status: mysqlEnum("status", ["active", "completed", "paused"]).default("active").notNull(),
    purpose: varchar("purpose", { length: 512 }),
    transcript: json("transcript").$type<InterviewMessage[]>().default([]),
    transcriptVersion: int("transcript_version").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: datetime("created_at").$defaultFn(now).notNull(),
    updatedAt: datetime("updated_at").$defaultFn(now).$onUpdate(() => new Date()).notNull(),
  },
  (table) => [index("interviews_user_idx").on(table.userId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Ofertas de trabajo — pegadas por el usuario para adaptar CVs.
// ─────────────────────────────────────────────────────────────────────────────
export const jobOffers = mysqlTable(
  "job_offers",
  {
    id: varchar("id", { length: 128 }).$defaultFn(() => createId()).primaryKey(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    rawText: longtext("raw_text").notNull(),
    extractedKeywords: json("extracted_keywords").$type<string[]>().default([]),
    detectedCategory: varchar("detected_category", { length: 128 }),
    createdAt: datetime("created_at").$defaultFn(now).notNull(),
  },
  (table) => [index("job_offers_user_idx").on(table.userId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// CVs — derivaciones a medida, vinculadas opcionalmente a una oferta.
// content_json = fuente de verdad (data). tex_source = .tex cacheable.
// El PDF NUNCA se persiste: se compila on-demand al descargar.
// ─────────────────────────────────────────────────────────────────────────────
export const cvs = mysqlTable(
  "cvs",
  {
    id: varchar("id", { length: 128 }).$defaultFn(() => createId()).primaryKey(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    jobOfferId: varchar("job_offer_id", { length: 128 }), // NULL = CV general
    title: varchar("title", { length: 255 }).notNull(),
    contentJson: json("content_json").$type<CvContent>().notNull(),
    texSource: longtext("tex_source"),
    atsScore: int("ats_score"),
    source: mysqlEnum("source", ["manual", "ai"]).default("manual").notNull(),
    createdAt: datetime("created_at").$defaultFn(now).notNull(),
    updatedAt: datetime("updated_at").$defaultFn(now).$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    index("cvs_user_idx").on(table.userId),
    index("cvs_job_offer_idx").on(table.jobOfferId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// interview_events — durable event log (replay authority for M2).
// UNIQUE(interview_id, version) ensures idempotent replay.
// ─────────────────────────────────────────────────────────────────────────────
export const interviewEvents = mysqlTable(
  "interview_events",
  {
    id: varchar("id", { length: 128 }).$defaultFn(() => createId()).primaryKey(),
    interviewId: varchar("interview_id", { length: 128 }).notNull(),
    version: int("version").notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: datetime("created_at").$defaultFn(now).notNull(),
  },
  (table) => [
    uniqueIndex("interview_events_interview_version_unique").on(table.interviewId, table.version),
    index("interview_events_interview_idx").on(table.interviewId, table.version),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// ai_runs — auditoría y control de coste de llamadas a DeepSeek.
// ─────────────────────────────────────────────────────────────────────────────
export const aiRuns = mysqlTable(
  "ai_runs",
  {
    id: varchar("id", { length: 128 }).$defaultFn(() => createId()).primaryKey(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    interviewId: varchar("interview_id", { length: 128 }),
    model: varchar("model", { length: 128 }).notNull(),
    task: varchar("task", { length: 128 }).notNull(),
    status: mysqlEnum("status", ["running", "completed", "failed", "cancelled"]).default("running").notNull(),
    error: text("error"),
    providerResponseId: varchar("provider_response_id", { length: 255 }),
    tokensIn: int("tokens_in").default(0).notNull(),
    tokensOut: int("tokens_out").default(0).notNull(),
    costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).default("0").notNull(),
    createdAt: datetime("created_at").$defaultFn(now).notNull(),
  },
  (table) => [
    index("ai_runs_user_idx").on(table.userId),
    index("ai_runs_created_idx").on(table.createdAt),
    index("ai_runs_interview_idx").on(table.interviewId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de dominio (compartidos por schema, tools del agente y templates LaTeX)
// ─────────────────────────────────────────────────────────────────────────────

export type PersonalInfo = {
  fullName?: string;
  headline?: string; // p.ej. "Senior Frontend Engineer"
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  linkedin?: string;
  github?: string;
  otherLinks?: { label: string; url: string }[];
};

export type Experience = {
  id: string;
  company: string;
  title: string;
  startDate: string; // ISO o "2022-01"
  endDate?: string; // ISO, "Present" si es actual
  location?: string;
  bullets: string[]; // logros en formato de impacto
};

export type Education = {
  id: string;
  institution: string;
  degree: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  details?: string; // honores, GPA, cursos relevantes
};

export type Skill = {
  id: string;
  category: string; // "Languages", "Frameworks", "Tools"...
  items: string[];
};

export type Project = {
  id: string;
  name: string;
  description: string;
  url?: string;
  tags: string[]; // temática → para inclusión condicional según oferta
  bullets?: string[];
};

export type Achievement = {
  id: string;
  title: string;
  description?: string;
  date?: string;
};

export type ProfilePreferences = {
  seniority?: "junior" | "mid" | "senior" | "lead" | "staff";
  languages?: { language: string; level: string }[];
  // orden de secciones para el CV Harvard (si se quiere personalizar)
  sectionOrder?: string[];
};

// Estructura del contenido de un CV derivado (puede ser un subconjunto del perfil).
export type CvContent = {
  personalInfo: PersonalInfo;
  summary?: string;
  experiences: Experience[];
  education: Education[];
  skills: Skill[];
  projects?: Project[];
  achievements?: Achievement[];
  languages?: { language: string; level: string }[];
};

export type InterviewMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  level?: "critical" | "optional";
  timestamp: string;
};
