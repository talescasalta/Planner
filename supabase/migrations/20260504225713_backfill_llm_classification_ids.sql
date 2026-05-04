-- Older LLM classifications sometimes stored the text suggestion but left the
-- category_id/subcategory_id empty, which made confirmed rows appear blank in
-- the transactions UI. Backfill ids from the saved suggestion names.

WITH suggested AS (
  SELECT
    t.id,
    t.household_id,
    nullif(trim(t.classification_suggestion ->> 'category'), '') AS category_name,
    nullif(trim(t.classification_suggestion ->> 'subcategory'), '') AS subcategory_name
  FROM public.transactions t
  WHERE t.category_id IS NULL
    AND t.classification_suggestion ? 'category'
),
matched AS (
  SELECT
    s.id,
    c.id AS category_id,
    sc.id AS subcategory_id
  FROM suggested s
  JOIN public.categories c
    ON c.household_id = s.household_id
   AND c.parent_id IS NULL
   AND lower(trim(c.name)) = lower(trim(s.category_name))
  LEFT JOIN public.categories sc
    ON sc.household_id = s.household_id
   AND sc.parent_id = c.id
   AND lower(trim(sc.name)) = lower(trim(s.subcategory_name))
)
UPDATE public.transactions t
SET
  category_id = matched.category_id,
  subcategory_id = matched.subcategory_id,
  review_status = CASE
    WHEN (t.classification_suggestion ->> 'subcategory') IS NOT NULL
      AND matched.subcategory_id IS NULL
      THEN 'needs_review'
    ELSE t.review_status
  END,
  updated_at = now()
FROM matched
WHERE t.id = matched.id;
