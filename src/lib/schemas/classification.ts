import { z } from 'zod';

export const classificationResultSchema = z.object({
	category: z.string().nullable().optional(),
	subcategory: z.string().nullable().optional(),
	confidence: z.number().min(0).max(1),
	needs_review: z.boolean(),
	reason_code: z.string().optional()
});

export type ClassificationResult = z.infer<typeof classificationResultSchema>;
