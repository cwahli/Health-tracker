-- F-11.1: soft-quarantine column for brand catalog self-clean.
-- Spellings locked by plan/FOOD.md §10.2 + plan/RELIABILITY.md §13.2:
-- candidate / active / merged / quarantined.
-- Read-side exclusion of quarantined/merged lives in
-- serverBrandMenu.ts (fetchAllBrandMenuItems); the TS cleaner
-- (cleanBrandDatabase) probes this column and skips writes until it exists.
-- Applied to live Supabase by hand 2026-09-14 (102 rows → active).

alter table public.brand_menu_items
  add column if not exists status text not null default 'active';

update public.brand_menu_items
  set status = 'active'
  where status is null or status = '';

do $$ begin
  alter table public.brand_menu_items
    add constraint brand_menu_items_status_chk
    check (status in ('candidate', 'active', 'merged', 'quarantined'));
exception when duplicate_object then null;
end $$;

create index if not exists brand_menu_items_status_idx
  on public.brand_menu_items (status);
