import { z } from "zod";

export const extractionSchema = z.object({
  category: z.string().min(1).max(128),
  keywords: z
    .array(z.string().min(1).max(100))
    .max(15)
    .transform((items) => [...new Set(items)]),
  confidence: z.number().min(0).max(1),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;
