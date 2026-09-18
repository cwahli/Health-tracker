-- Add image_url to brand_menu_items for brand food images
alter table public.brand_menu_items
  add column if not exists image_url text;
