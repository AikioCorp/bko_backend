-- Existing installations receive Benin without changing market availability.
INSERT INTO "Country" ("id", "code", "name", "flagEmoji")
VALUES ('BJ', 'BJ', 'Bénin', '🇧🇯')
ON CONFLICT DO NOTHING;
