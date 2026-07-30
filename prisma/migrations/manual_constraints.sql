-- ==============================================================================
-- MIGRATION MANUELLE POSTGRESQL : EXTENSION PG_TRGM & INDEXES TRIGRAMMES
-- ==============================================================================

-- 1. Activation de l'extension pg_trgm (Recherche floue et insensible aux accents)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Index Trigrammes GIN sur les Podcasts (Nom et Titres alternatifs Bamanankan)
CREATE INDEX IF NOT EXISTS idx_podcast_name_trgm ON "Podcast" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_podcast_alt_title_trgm ON "PodcastAlternateTitle" USING gin (title gin_trgm_ops);

-- 3. Index Trigrammes GIN sur les Personnes & Animateurs (Noms et Alias)
CREATE INDEX IF NOT EXISTS idx_person_name_trgm ON "Person" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_person_alias_trgm ON "PersonAlias" USING gin (alias gin_trgm_ops);

-- 4. Index Trigrammes GIN sur les Sujets & Topics (Noms et Alias)
CREATE INDEX IF NOT EXISTS idx_topic_name_trgm ON "Topic" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_topic_alias_trgm ON "TopicAlias" USING gin (alias gin_trgm_ops);

-- 5. Index Trigrammes GIN sur les Épisodes (Titres)
CREATE INDEX IF NOT EXISTS idx_episode_title_trgm ON "Episode" USING gin (title gin_trgm_ops);

-- 6. Index Trigrammes GIN sur les Organisations
CREATE INDEX IF NOT EXISTS idx_organization_name_trgm ON "Organization" USING gin (name gin_trgm_ops);

-- 7. Index Partiels d'Unicité pour les Sources Médias Principales Audio & Vidéo
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_source_primary_audio 
ON "MediaSource" ("episodeId") 
WHERE "isPrimaryAudio" = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_source_primary_video 
ON "MediaSource" ("episodeId") 
WHERE "isPrimaryVideo" = TRUE;
