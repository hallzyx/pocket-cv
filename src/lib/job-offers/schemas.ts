import { z } from "zod";

const identifier = z.string().trim().min(1).max(128);
export const offerQuestionSchema = z.object({ questionId: identifier, type: z.enum(["critical", "optional"]), prompt: z.string().trim().min(1).max(2000), status: z.enum(["pending", "answered", "skipped"]).default("pending"), answer: z.string().trim().max(10000).optional() }).strict();
export const offerQuestionsSchema = z.object({ questions: z.array(offerQuestionSchema).min(1).max(100) }).strict();
export const answerQuestionSchema = z.object({ answer: z.string().trim().min(1).max(10000) }).strict();
export const offerOverrideSchema = z.object({ profileItemId: identifier, section: z.enum(["personalInfo", "experiences", "education", "skills", "projects", "achievements", "languages"]), action: z.enum(["include", "exclude"]), reason: z.string().trim().min(1).max(2000) }).strict();
export const deleteOverrideSchema = z.object({ profileItemId: identifier, section: z.enum(["personalInfo", "experiences", "education", "skills", "projects", "achievements", "languages"]) }).strict();

export const extractionSchema = z.object({
  category: z.string().min(1).max(128),
  keywords: z
    .array(z.string().min(1).max(100))
    .max(15)
    .transform((items) => [...new Set(items)]),
  confidence: z.number().min(0).max(1),
});

export type OfferExtraction = z.infer<typeof extractionSchema>;
export type ExtractionResult = OfferExtraction;

export type SelectionResult = Pick<import("@/lib/db/schema").CvContent,
  "experiences" | "education" | "skills"> & Required<Pick<import("@/lib/db/schema").CvContent,
  "projects" | "achievements">> & {
  lowConfidenceOmissions: { profileItemId: string; section: string; reason: string }[];
};
