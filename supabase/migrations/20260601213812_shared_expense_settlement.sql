ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS monthly_income numeric NOT NULL DEFAULT 0
  CHECK (monthly_income >= 0);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS split_method text NOT NULL DEFAULT 'income_proportional'
  CHECK (split_method IN ('income_proportional', 'equal'));

COMMENT ON COLUMN public.household_members.monthly_income IS
  'Renda mensal manual usada para calcular a divisão proporcional das despesas compartilhadas.';

COMMENT ON COLUMN public.transactions.split_method IS
  'Modo de divisão para despesas compartilhadas: income_proportional por renda mensal ou equal para 50/50.';
