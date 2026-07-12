import { z } from 'zod';

const optionalUuid = z.preprocess(
	(value) => (value === '' ? null : value),
	z.string().uuid().nullable().optional()
);

export const transactionSchema = z.object({
	date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
	description: z.string().min(1, 'Descrição é obrigatória'),
	merchant: z.string().optional().nullable(),
	amount: z.coerce.number().refine((n) => n !== 0, 'Valor não pode ser zero'),
	currency: z.string().default('BRL'),
	source_name: z.string().optional().nullable(),
	source_type: z
		.enum(['credit_card', 'bank_account', 'vale_alimentacao', 'vale_refeicao'])
		.optional()
		.nullable(),
	reference_month: z
		.string()
		.regex(/^\d{4}-\d{2}$/)
		.optional()
		.nullable(),
	paid_by_user_id: optionalUuid,
	owner_profile_id: optionalUuid,
	split_method: z
		.enum(['income_proportional', 'equal'])
		.default('income_proportional'),
	category_id: optionalUuid,
	subcategory_id: optionalUuid,
	classification_method: z.string().default('manual'),
	review_status: z.string().default('confirmed')
});

export const transactionUpdateSchema = transactionSchema.partial();

export type TransactionInput = z.infer<typeof transactionSchema>;
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;
