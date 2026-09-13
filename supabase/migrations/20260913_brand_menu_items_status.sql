-- F-11.1: soft-quarantine for brand catalog self-clean.
-- Live rows stay status IS NULL or 'ready'. Matchers skip quarantined/merged.
ALTER TABLE brand_menu_items
  ADD COLUMN IF NOT EXISTS status TEXT;

CREATE INDEX IF NOT EXISTS brand_menu_items_status_idx
  ON brand_menu_items (country_code, chain_key, status);
