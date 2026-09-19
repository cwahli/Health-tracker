-- Saved-meal lineage: id of the saved meal a log was restaged/duplicated from.
alter table public.food_logs
  add column if not exists source_meal_id text default '';
