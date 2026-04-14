import { z } from "zod"

const TopicSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  referenced_in: z.array(z.string()),
})

export const ExtractionSchema = z.object({
  entities: z.array(TopicSchema),
  concepts: z.array(TopicSchema),
})

export type Extraction = z.infer<typeof ExtractionSchema>

export const JudgementSchema = z.object({
  present: z.array(z.string()),
  missing: z.array(z.string()),
  hallucinated: z.array(z.string()),
  notes: z.string(),
})

export type JudgementRaw = z.infer<typeof JudgementSchema>

export const HealthResponseSchema = z.object({
  healthy: z.boolean(),
  issues: z.array(z.string()),
})

export type HealthResponse = z.infer<typeof HealthResponseSchema>

const SmartDocEntrySchema = z.object({
  description: z.string(),
  type: z.enum(["compiled", "health-check"]),
  sources: z.array(z.string()),
  context_files: z.array(z.string()).optional(),
})

export const SmartInitSchema = z.object({
  docs: z.record(z.string(), SmartDocEntrySchema),
})

export type SmartInit = z.infer<typeof SmartInitSchema>
