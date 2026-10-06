-- Épisode : résumé court, type et contenu explicite
CREATE TYPE "EpisodeType" AS ENUM ('FULL', 'TRAILER', 'BONUS');

ALTER TABLE "Episode"
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "episodeType" "EpisodeType" NOT NULL DEFAULT 'FULL',
  ADD COLUMN "explicit" BOOLEAN NOT NULL DEFAULT false;
