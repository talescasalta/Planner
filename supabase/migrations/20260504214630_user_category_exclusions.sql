-- Let each user hide official suggested categories/subcategories from their
-- personal gabarito without deleting the shared taxonomy or historical data.

CREATE TABLE IF NOT EXISTS public.user_category_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (household_id, user_id, category_id)
);

ALTER TABLE public.user_category_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_category_exclusions_select_own" ON public.user_category_exclusions;
CREATE POLICY "user_category_exclusions_select_own"
  ON public.user_category_exclusions
  FOR SELECT
  USING (
    user_id = (select auth.uid())
    AND private.is_member_of_household(household_id)
  );

DROP POLICY IF EXISTS "user_category_exclusions_insert_own" ON public.user_category_exclusions;
CREATE POLICY "user_category_exclusions_insert_own"
  ON public.user_category_exclusions
  FOR INSERT
  WITH CHECK (
    user_id = (select auth.uid())
    AND private.is_member_of_household(household_id)
  );

DROP POLICY IF EXISTS "user_category_exclusions_delete_own" ON public.user_category_exclusions;
CREATE POLICY "user_category_exclusions_delete_own"
  ON public.user_category_exclusions
  FOR DELETE
  USING (
    user_id = (select auth.uid())
    AND private.is_member_of_household(household_id)
  );
