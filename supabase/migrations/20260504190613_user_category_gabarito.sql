-- Track which user created custom categories/subcategories so each member can
-- maintain a personal taxonomy on top of the shared starter gabarito.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

UPDATE public.categories
SET is_default = true
WHERE created_by_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS categories_parent_name_owner_idx
  ON public.categories (
    household_id,
    lower(name),
    coalesce(created_by_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS categories_child_name_owner_idx
  ON public.categories (
    household_id,
    parent_id,
    lower(name),
    coalesce(created_by_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE parent_id IS NOT NULL;

DROP POLICY IF EXISTS "categories_insert" ON public.categories;
CREATE POLICY "categories_insert"
  ON public.categories
  FOR INSERT
  WITH CHECK (
    private.is_member_of_household(household_id)
    AND created_by_user_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "categories_update" ON public.categories;
CREATE POLICY "categories_update"
  ON public.categories
  FOR UPDATE
  USING (
    private.is_member_of_household(household_id)
    AND created_by_user_id = (select auth.uid())
  )
  WITH CHECK (
    private.is_member_of_household(household_id)
    AND created_by_user_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "categories_delete" ON public.categories;
CREATE POLICY "categories_delete"
  ON public.categories
  FOR DELETE
  USING (
    private.is_member_of_household(household_id)
    AND created_by_user_id = (select auth.uid())
  );
