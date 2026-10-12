-- Migration: 20261012130000_personalization_recommendations
-- Architecture de recommandations et personnalisation BKO Podcast

-- 1. Create Enums
DO $$ BEGIN
  CREATE TYPE "FeedbackTargetType" AS ENUM ('EPISODE', 'PODCAST');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FeedbackAction" AS ENUM ('NOT_INTERESTED', 'HIDE_PODCAST', 'EXCLUDE_FROM_PROFILE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "InteractionTargetType" AS ENUM ('EPISODE', 'PODCAST');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "InteractionActionType" AS ENUM ('CLICK', 'PLAY_START', 'QUALIFIED_PLAY', 'FAVORITE', 'LIKE', 'FOLLOW');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Alter EditorialSection with personalization fields
ALTER TABLE "EditorialSection" 
  ADD COLUMN IF NOT EXISTS "maxItems" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "isFixedPlacement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "selectionStrategy" TEXT DEFAULT 'DEFAULT',
  ADD COLUMN IF NOT EXISTS "strategyParams" JSONB;

-- 3. Create Table UserContentFeedback
CREATE TABLE IF NOT EXISTS "UserContentFeedback" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetType" "FeedbackTargetType" NOT NULL,
  "podcastId" TEXT,
  "episodeId" TEXT,
  "action" "FeedbackAction" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserContentFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserContentFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserContentFeedback_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserContentFeedback_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserContentFeedback_unique_target" 
  ON "UserContentFeedback"("userId", "targetType", "podcastId", "episodeId", "action");
CREATE INDEX IF NOT EXISTS "UserContentFeedback_userId_targetType_idx" 
  ON "UserContentFeedback"("userId", "targetType");
CREATE INDEX IF NOT EXISTS "UserContentFeedback_podcastId_idx" 
  ON "UserContentFeedback"("podcastId");
CREATE INDEX IF NOT EXISTS "UserContentFeedback_episodeId_idx" 
  ON "UserContentFeedback"("episodeId");

-- 4. Create Table UserRecommendationProfile
CREATE TABLE IF NOT EXISTS "UserRecommendationProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "personalizationActive" BOOLEAN NOT NULL DEFAULT true,
  "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
  "preferencesVersion" INTEGER NOT NULL DEFAULT 1,
  "profileVersion" INTEGER NOT NULL DEFAULT 1,
  "topicScores" JSONB NOT NULL DEFAULT '{}',
  "categoryScores" JSONB NOT NULL DEFAULT '{}',
  "languageScores" JSONB NOT NULL DEFAULT '{}',
  "recentSignals" JSONB NOT NULL DEFAULT '{}',
  "experimentVariant" TEXT NOT NULL DEFAULT 'control',
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserRecommendationProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserRecommendationProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserRecommendationProfile_userId_key" 
  ON "UserRecommendationProfile"("userId");
CREATE INDEX IF NOT EXISTS "UserRecommendationProfile_userId_idx" 
  ON "UserRecommendationProfile"("userId");

-- 5. Create Table ListeningSession
CREATE TABLE IF NOT EXISTS "ListeningSession" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT,
  "anonymousId" TEXT,
  "episodeId" TEXT NOT NULL,
  "playSource" TEXT NOT NULL DEFAULT 'home',
  "recommendationId" TEXT,
  "sectionId" TEXT,
  "positionSeconds" INTEGER NOT NULL DEFAULT 0,
  "listenedSeconds" INTEGER NOT NULL DEFAULT 0,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ListeningSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ListeningSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ListeningSession_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ListeningSession_sessionId_key" 
  ON "ListeningSession"("sessionId");
CREATE INDEX IF NOT EXISTS "ListeningSession_userId_lastActiveAt_idx" 
  ON "ListeningSession"("userId", "lastActiveAt");
CREATE INDEX IF NOT EXISTS "ListeningSession_anonymousId_lastActiveAt_idx" 
  ON "ListeningSession"("anonymousId", "lastActiveAt");
CREATE INDEX IF NOT EXISTS "ListeningSession_episodeId_idx" 
  ON "ListeningSession"("episodeId");

-- 6. Create Table ListeningEvent
CREATE TABLE IF NOT EXISTS "ListeningEvent" (
  "id" TEXT NOT NULL,
  "clientEventId" TEXT NOT NULL,
  "listeningSessionId" TEXT,
  "userId" TEXT,
  "anonymousId" TEXT,
  "episodeId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "positionSeconds" INTEGER NOT NULL DEFAULT 0,
  "deltaSeconds" INTEGER NOT NULL DEFAULT 0,
  "playbackRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "playSource" TEXT,
  "recommendationId" TEXT,
  "sectionId" TEXT,
  "occurredAtClient" TIMESTAMP(3) NOT NULL,
  "receivedAtServer" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ListeningEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ListeningEvent_listeningSessionId_fkey" FOREIGN KEY ("listeningSessionId") REFERENCES "ListeningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ListeningEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ListeningEvent_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ListeningEvent_clientEventId_key" 
  ON "ListeningEvent"("clientEventId");
CREATE INDEX IF NOT EXISTS "ListeningEvent_episodeId_occurredAtClient_idx" 
  ON "ListeningEvent"("episodeId", "occurredAtClient");
CREATE INDEX IF NOT EXISTS "ListeningEvent_userId_occurredAtClient_idx" 
  ON "ListeningEvent"("userId", "occurredAtClient");
CREATE INDEX IF NOT EXISTS "ListeningEvent_anonymousId_occurredAtClient_idx" 
  ON "ListeningEvent"("anonymousId", "occurredAtClient");

-- 7. Create Table RecommendationBatch
CREATE TABLE IF NOT EXISTS "RecommendationBatch" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "userId" TEXT,
  "anonymousId" TEXT,
  "engineVersion" TEXT NOT NULL DEFAULT 'v1.0.0',
  "variant" TEXT NOT NULL DEFAULT 'control',
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecommendationBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecommendationBatch_batchId_key" 
  ON "RecommendationBatch"("batchId");
CREATE INDEX IF NOT EXISTS "RecommendationBatch_userId_createdAt_idx" 
  ON "RecommendationBatch"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RecommendationBatch_anonymousId_createdAt_idx" 
  ON "RecommendationBatch"("anonymousId", "createdAt");

-- 8. Create Table RecommendationImpression
CREATE TABLE IF NOT EXISTS "RecommendationImpression" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "sectionSlug" TEXT NOT NULL,
  "targetType" "InteractionTargetType" NOT NULL,
  "episodeId" TEXT,
  "podcastId" TEXT,
  "position" INTEGER NOT NULL,
  "reason" TEXT,
  "userId" TEXT,
  "anonymousId" TEXT,
  "visibleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecommendationImpression_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecommendationImpression_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RecommendationBatch"("batchId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecommendationImpression_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecommendationImpression_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecommendationImpression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecommendationImpression_unique_slot" 
  ON "RecommendationImpression"("batchId", "sectionId", "targetType", "episodeId", "podcastId", "position");
CREATE INDEX IF NOT EXISTS "RecommendationImpression_sectionSlug_visibleAt_idx" 
  ON "RecommendationImpression"("sectionSlug", "visibleAt");
CREATE INDEX IF NOT EXISTS "RecommendationImpression_episodeId_idx" 
  ON "RecommendationImpression"("episodeId");
CREATE INDEX IF NOT EXISTS "RecommendationImpression_podcastId_idx" 
  ON "RecommendationImpression"("podcastId");
CREATE INDEX IF NOT EXISTS "RecommendationImpression_userId_visibleAt_idx" 
  ON "RecommendationImpression"("userId", "visibleAt");

-- 9. Create Table RecommendationInteraction
CREATE TABLE IF NOT EXISTS "RecommendationInteraction" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "sectionSlug" TEXT NOT NULL,
  "targetType" "InteractionTargetType" NOT NULL,
  "episodeId" TEXT,
  "podcastId" TEXT,
  "action" "InteractionActionType" NOT NULL,
  "position" INTEGER,
  "userId" TEXT,
  "anonymousId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecommendationInteraction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecommendationInteraction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RecommendationBatch"("batchId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecommendationInteraction_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecommendationInteraction_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecommendationInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RecommendationInteraction_batchId_action_idx" 
  ON "RecommendationInteraction"("batchId", "action");
CREATE INDEX IF NOT EXISTS "RecommendationInteraction_episodeId_idx" 
  ON "RecommendationInteraction"("episodeId");
CREATE INDEX IF NOT EXISTS "RecommendationInteraction_podcastId_idx" 
  ON "RecommendationInteraction"("podcastId");
CREATE INDEX IF NOT EXISTS "RecommendationInteraction_userId_occurredAt_idx" 
  ON "RecommendationInteraction"("userId", "occurredAt");

-- 10. Create Table EpisodeEmbedding
CREATE TABLE IF NOT EXISTS "EpisodeEmbedding" (
  "id" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'bge-m3',
  "model" TEXT NOT NULL DEFAULT 'BAAI/bge-m3',
  "dimensions" INTEGER NOT NULL DEFAULT 1024,
  "modelVersion" TEXT NOT NULL DEFAULT 'v1',
  "contentHash" TEXT NOT NULL,
  "vector" DOUBLE PRECISION[] NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'COMPLETED',
  "errorReason" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EpisodeEmbedding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EpisodeEmbedding_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "EpisodeEmbedding_episodeId_key" 
  ON "EpisodeEmbedding"("episodeId");
CREATE INDEX IF NOT EXISTS "EpisodeEmbedding_status_idx" 
  ON "EpisodeEmbedding"("status");
CREATE INDEX IF NOT EXISTS "EpisodeEmbedding_provider_modelVersion_idx" 
  ON "EpisodeEmbedding"("provider", "modelVersion");

-- 11. Create Table PodcastEmbedding
CREATE TABLE IF NOT EXISTS "PodcastEmbedding" (
  "id" TEXT NOT NULL,
  "podcastId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'bge-m3',
  "model" TEXT NOT NULL DEFAULT 'BAAI/bge-m3',
  "dimensions" INTEGER NOT NULL DEFAULT 1024,
  "modelVersion" TEXT NOT NULL DEFAULT 'v1',
  "contentHash" TEXT NOT NULL,
  "vector" DOUBLE PRECISION[] NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'COMPLETED',
  "errorReason" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PodcastEmbedding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PodcastEmbedding_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PodcastEmbedding_podcastId_key" 
  ON "PodcastEmbedding"("podcastId");
CREATE INDEX IF NOT EXISTS "PodcastEmbedding_status_idx" 
  ON "PodcastEmbedding"("status");
CREATE INDEX IF NOT EXISTS "PodcastEmbedding_provider_modelVersion_idx" 
  ON "PodcastEmbedding"("provider", "modelVersion");

-- 12. Create Table RecommendationDailyMetric
CREATE TABLE IF NOT EXISTS "RecommendationDailyMetric" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "variant" TEXT NOT NULL DEFAULT 'control',
  "sectionSlug" TEXT NOT NULL,
  "impressionsCount" INTEGER NOT NULL DEFAULT 0,
  "clicksCount" INTEGER NOT NULL DEFAULT 0,
  "playsCount" INTEGER NOT NULL DEFAULT 0,
  "qualifiedPlaysCount" INTEGER NOT NULL DEFAULT 0,
  "uniqueUsersExposed" INTEGER NOT NULL DEFAULT 0,
  "uniqueUsersEngaged" INTEGER NOT NULL DEFAULT 0,
  "negativeFeedbackCount" INTEGER NOT NULL DEFAULT 0,
  "followsGeneratedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecommendationDailyMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecommendationDailyMetric_date_variant_sectionSlug_key" 
  ON "RecommendationDailyMetric"("date", "variant", "sectionSlug");
CREATE INDEX IF NOT EXISTS "RecommendationDailyMetric_date_idx" 
  ON "RecommendationDailyMetric"("date");
