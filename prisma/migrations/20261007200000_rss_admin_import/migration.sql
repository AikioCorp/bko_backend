-- Import RSS administrateur : réglages persistés, synchronisation automatique planifiable, auteur source.
-- Migration additive : colonnes avec valeur par défaut ou nullables, aucune donnée existante modifiée.
ALTER TABLE "RssFeed"
  ADD COLUMN "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "importSettings" JSONB,
  ADD COLUMN "sourceAuthor" TEXT;

CREATE INDEX "RssFeed_url_idx" ON "RssFeed"("url");
CREATE INDEX "RssFeed_syncEnabled_nextSyncAt_idx" ON "RssFeed"("syncEnabled", "nextSyncAt");
