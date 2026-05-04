-- Migration 002: Add reference_month to transaction_imports

ALTER TABLE public.transaction_imports
ADD COLUMN reference_month text;

COMMENT ON COLUMN public.transaction_imports.reference_month IS 'Mês de referência da fatura (formato YYYY-MM). Usado para agrupar transações por mês.';
