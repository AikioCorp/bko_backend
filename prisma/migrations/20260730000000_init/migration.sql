-- CreateEnum
CREATE TYPE "PodcastStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNLISTED', 'ARCHIVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('DRAFT', 'PROCESSING', 'SCHEDULED', 'PUBLISHED', 'UNLISTED', 'ARCHIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('PENDING', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('DISABLED', 'CATALOG_ONLY', 'CREATOR_BETA', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CreatorMarketAccessStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PodcastOwnershipStatus" AS ENUM ('UNCLAIMED', 'CLAIMED', 'MANAGED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('EMAIL_DOMAIN', 'WEBSITE', 'RSS_CHALLENGE', 'SOCIAL', 'DOCUMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CreationSource" AS ENUM ('CREATOR', 'ADMIN', 'RSS_IMPORT', 'EXTERNAL_IMPORT');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaSourceType" AS ENUM ('UPLOAD', 'EXTERNAL', 'RSS_FEED');

-- CreateEnum
CREATE TYPE "ExternalProvider" AS ENUM ('YOUTUBE', 'SPOTIFY', 'APPLE_PODCASTS', 'DEEZER', 'SOUNDCLOUD', 'VIMEO', 'RSS', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "PlaybackMode" AS ENUM ('NATIVE', 'EMBED', 'EXTERNAL_REDIRECT');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'PRIVATE', 'UNLISTED');

-- CreateEnum
CREATE TYPE "TranscriptType" AS ENUM ('ORIGINAL', 'TRANSLATION');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TranscriptSource" AS ENUM ('MANUAL', 'UPLOAD', 'AUTO_GENERATED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "TranscriptVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ChapterSource" AS ENUM ('MANUAL', 'IMPORTED', 'AUTO_GENERATED');

-- CreateEnum
CREATE TYPE "SuggestionType" AS ENUM ('TOPIC', 'PERSON', 'ORGANIZATION', 'CHAPTER', 'KEYWORD', 'SUMMARY');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EditorialSectionType" AS ENUM ('HERO', 'PODCAST_ROW', 'EPISODE_ROW', 'PERSON_ROW', 'COLLECTION_ROW', 'TOPIC_ROW');

-- CreateEnum
CREATE TYPE "EditorialSourceMode" AS ENUM ('MANUAL', 'AUTOMATIC', 'HYBRID');

-- CreateEnum
CREATE TYPE "PodcastMemberRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'ANALYST');

-- CreateEnum
CREATE TYPE "OrganizationMemberRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'ANALYST');

-- CreateEnum
CREATE TYPE "PodcastPersonRole" AS ENUM ('HOST', 'CO_HOST', 'PRODUCER', 'REGULAR_GUEST', 'CONTRIBUTOR');

-- CreateEnum
CREATE TYPE "EpisodePersonRole" AS ENUM ('HOST', 'CO_HOST', 'GUEST', 'INTERVIEWER', 'INTERVIEWEE', 'PRODUCER', 'SOUND_ENGINEER');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('PODCAST', 'EPISODE', 'PERSON', 'COMMENT', 'CREATOR_PROFILE');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('COPYRIGHT', 'INAPPROPRIATE', 'SPAM', 'IMPERSONATION', 'MISINFORMATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "passwordHash" TEXT,
    "fullName" TEXT NOT NULL,
    "avatar" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationToken" TEXT,
    "passwordResetToken" TEXT,
    "passwordResetExpiresAt" TIMESTAMP(3),
    "otpCode" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceFingerprint" TEXT,
    "deviceType" TEXT NOT NULL,
    "deviceName" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'FCM',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT,
    "displayName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bio" TEXT,
    "avatar" TEXT,
    "banner" TEXT,
    "countryId" TEXT,
    "website" TEXT,
    "socialLinks" JSONB,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'DISABLED',
    "discoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "creatorSignupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "podcastCreationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publishingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "uploadEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rssImportEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monetizationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "launchDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorMarketAccess" (
    "id" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "status" "CreatorMarketAccessStatus" NOT NULL DEFAULT 'PENDING',
    "canCreatePodcast" BOOLEAN NOT NULL DEFAULT false,
    "canPublish" BOOLEAN NOT NULL DEFAULT false,
    "canUpload" BOOLEAN NOT NULL DEFAULT false,
    "canImportRss" BOOLEAN NOT NULL DEFAULT false,
    "canMonetize" BOOLEAN NOT NULL DEFAULT false,
    "grantedById" TEXT,
    "grantedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorMarketAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "photo" TEXT,
    "bio" TEXT,
    "countryId" TEXT,
    "city" TEXT,
    "website" TEXT,
    "socialLinks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonAlias" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "languageCode" TEXT,

    CONSTRAINT "PersonAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "description" TEXT,
    "website" TEXT,
    "countryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganizationMemberRole" NOT NULL DEFAULT 'EDITOR',

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Podcast" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" TEXT,
    "cover" TEXT NOT NULL,
    "banner" TEXT,
    "countryId" TEXT NOT NULL DEFAULT 'ML',
    "city" TEXT,
    "primaryLanguageCode" TEXT NOT NULL,
    "organizationId" TEXT,
    "status" "PodcastStatus" NOT NULL DEFAULT 'PUBLISHED',
    "ownershipStatus" "PodcastOwnershipStatus" NOT NULL DEFAULT 'UNCLAIMED',
    "creationSource" "CreationSource" NOT NULL DEFAULT 'ADMIN',
    "managedByBamakoPodcast" BOOLEAN NOT NULL DEFAULT false,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "qualityScore" INTEGER NOT NULL DEFAULT 70,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Podcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodcastAlternateTitle" (
    "id" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "languageCode" TEXT,

    CONSTRAINT "PodcastAlternateTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodcastLanguage" (
    "podcastId" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,

    CONSTRAINT "PodcastLanguage_pkey" PRIMARY KEY ("podcastId","languageCode")
);

-- CreateTable
CREATE TABLE "PodcastMember" (
    "id" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PodcastMemberRole" NOT NULL DEFAULT 'EDITOR',

    CONSTRAINT "PodcastMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodcastInvitation" (
    "id" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "PodcastMemberRole" NOT NULL DEFAULT 'EDITOR',
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PodcastInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodcastPerson" (
    "id" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "PodcastPersonRole" NOT NULL DEFAULT 'HOST',

    CONSTRAINT "PodcastPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodcastExternalSource" (
    "id" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "provider" "ExternalProvider" NOT NULL,
    "externalId" TEXT,
    "url" TEXT NOT NULL,
    "isOfficial" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PodcastExternalSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "cover" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "seasonId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cover" TEXT,
    "episodeNumber" INTEGER,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "status" "EpisodeStatus" NOT NULL DEFAULT 'PUBLISHED',
    "creationSource" "CreationSource" NOT NULL DEFAULT 'CREATOR',
    "isManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "languageCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "episodeId" TEXT,
    "mediaType" "MediaType" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "mediaAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaSource" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "sourceType" "MediaSourceType" NOT NULL,
    "provider" "ExternalProvider",
    "playbackMode" "PlaybackMode" NOT NULL DEFAULT 'NATIVE',
    "isPrimaryAudio" BOOLEAN NOT NULL DEFAULT false,
    "isPrimaryVideo" BOOLEAN NOT NULL DEFAULT false,
    "externalUrl" TEXT,
    "embedUrl" TEXT,
    "externalId" TEXT,
    "mediaAssetId" TEXT,
    "durationSeconds" INTEGER,
    "mimeType" TEXT,
    "quality" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastCheckedAt" TIMESTAMP(3),
    "lastHttpStatus" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "uploaderId" TEXT,
    "storageProvider" TEXT NOT NULL DEFAULT 'R2',
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "codec" TEXT,
    "bitrateKbps" INTEGER,
    "durationSeconds" INTEGER,
    "sampleRateHz" INTEGER,
    "channels" INTEGER,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "type" "TranscriptType" NOT NULL DEFAULT 'ORIGINAL',
    "status" "TranscriptStatus" NOT NULL DEFAULT 'READY',
    "source" "TranscriptSource" NOT NULL DEFAULT 'MANUAL',
    "visibility" "TranscriptVisibility" NOT NULL DEFAULT 'PUBLIC',
    "provider" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "isReviewed" BOOLEAN NOT NULL DEFAULT false,
    "lastEditedBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "sourceTranscriptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "startTimeMs" INTEGER NOT NULL,
    "endTimeMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "speakerId" TEXT,
    "speakerLabel" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSpeaker" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "displayName" TEXT,
    "personId" TEXT,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "TranscriptSpeaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeChapter" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startTimeMs" INTEGER NOT NULL,
    "endTimeMs" INTEGER,
    "source" "ChapterSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EpisodeChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentSuggestion" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "type" "SuggestionType" NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'AI_ENRICHMENT',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RssFeed" (
    "id" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "nextSyncAt" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'IDLE',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RssFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RssSyncRun" (
    "id" TEXT NOT NULL,
    "rssFeedId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "episodesDiscovered" INTEGER NOT NULL DEFAULT 0,
    "episodesImported" INTEGER NOT NULL DEFAULT 0,
    "episodesUpdated" INTEGER NOT NULL DEFAULT 0,
    "episodesSkipped" INTEGER NOT NULL DEFAULT 0,
    "episodesFailed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RssSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RssImportedEpisode" (
    "id" TEXT NOT NULL,
    "rssFeedId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "enclosureUrl" TEXT NOT NULL,
    "enclosureType" TEXT,
    "enclosureLength" BIGINT,
    "sourcePublishedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "sourceHash" TEXT,
    "localEpisodeId" TEXT,

    CONSTRAINT "RssImportedEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialSection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "subtitle" TEXT,
    "type" "EditorialSectionType" NOT NULL,
    "sourceMode" "EditorialSourceMode" NOT NULL DEFAULT 'MANUAL',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "marketId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialSectionItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "podcastId" TEXT,
    "episodeId" TEXT,
    "personId" TEXT,
    "collectionId" TEXT,
    "topicId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EditorialSectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "cover" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionItem" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "podcastId" TEXT,
    "episodeId" TEXT,
    "personId" TEXT,
    "topicId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeDailyStats" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "plays" INTEGER NOT NULL DEFAULT 0,
    "qualifiedPlays" INTEGER NOT NULL DEFAULT 0,
    "completedPlays" INTEGER NOT NULL DEFAULT 0,
    "totalPlayTimeSeconds" BIGINT NOT NULL DEFAULT 0,
    "uniqueListeners" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EpisodeDailyStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobQueueItem" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlugRedirect" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "oldSlug" TEXT NOT NULL,
    "newSlug" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlugRedirect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "flagEmoji" TEXT,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Language" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nativeName" TEXT NOT NULL,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicAlias" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "languageCode" TEXT,

    CONSTRAINT "TopicAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLanguagePreference" (
    "userId" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,

    CONSTRAINT "UserLanguagePreference_pkey" PRIMARY KEY ("userId","languageCode")
);

-- CreateTable
CREATE TABLE "UserTopicPreference" (
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "UserTopicPreference_pkey" PRIMARY KEY ("userId","topicId")
);

-- CreateTable
CREATE TABLE "UserCountryPreference" (
    "userId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,

    CONSTRAINT "UserCountryPreference_pkey" PRIMARY KEY ("userId","countryId")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "emailNewEpisodes" BOOLEAN NOT NULL DEFAULT true,
    "pushNewEpisodes" BOOLEAN NOT NULL DEFAULT true,
    "editorialHighlights" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PodcastCategory" (
    "podcastId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "PodcastCategory_pkey" PRIMARY KEY ("podcastId","categoryId")
);

-- CreateTable
CREATE TABLE "PodcastTopic" (
    "podcastId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "PodcastTopic_pkey" PRIMARY KEY ("podcastId","topicId")
);

-- CreateTable
CREATE TABLE "EpisodeTopic" (
    "episodeId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "EpisodeTopic_pkey" PRIMARY KEY ("episodeId","topicId")
);

-- CreateTable
CREATE TABLE "EpisodePerson" (
    "episodeId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "EpisodePersonRole" NOT NULL DEFAULT 'GUEST',

    CONSTRAINT "EpisodePerson_pkey" PRIMARY KEY ("episodeId","personId")
);

-- CreateTable
CREATE TABLE "PodcastFollow" (
    "userId" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PodcastFollow_pkey" PRIMARY KEY ("userId","podcastId")
);

-- CreateTable
CREATE TABLE "CreatorFollow" (
    "userId" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorFollow_pkey" PRIMARY KEY ("userId","creatorProfileId")
);

-- CreateTable
CREATE TABLE "SavedEpisode" (
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedEpisode_pkey" PRIMARY KEY ("userId","episodeId")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistItem" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybackHistory" (
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "positionSeconds" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "lastPlayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybackHistory_pkey" PRIMARY KEY ("userId","episodeId")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proofDescription" TEXT NOT NULL,
    "proofDocumentUrl" TEXT,
    "verificationMethod" "VerificationMethod" NOT NULL DEFAULT 'MANUAL',
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "description" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "previousState" JSONB,
    "newState" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_tokenHash_idx" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_deviceId_idx" ON "PushToken"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_tokenHash_idx" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_userId_key" ON "CreatorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_personId_key" ON "CreatorProfile"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_slug_key" ON "CreatorProfile"("slug");

-- CreateIndex
CREATE INDEX "CreatorProfile_slug_idx" ON "CreatorProfile"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Market_countryId_key" ON "Market"("countryId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorMarketAccess_creatorProfileId_marketId_key" ON "CreatorMarketAccess"("creatorProfileId", "marketId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_slug_key" ON "Person"("slug");

-- CreateIndex
CREATE INDEX "Person_slug_idx" ON "Person"("slug");

-- CreateIndex
CREATE INDEX "PersonAlias_alias_idx" ON "PersonAlias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Podcast_slug_key" ON "Podcast"("slug");

-- CreateIndex
CREATE INDEX "Podcast_slug_idx" ON "Podcast"("slug");

-- CreateIndex
CREATE INDEX "Podcast_countryId_idx" ON "Podcast"("countryId");

-- CreateIndex
CREATE INDEX "Podcast_status_idx" ON "Podcast"("status");

-- CreateIndex
CREATE INDEX "Podcast_ownershipStatus_idx" ON "Podcast"("ownershipStatus");

-- CreateIndex
CREATE INDEX "PodcastAlternateTitle_title_idx" ON "PodcastAlternateTitle"("title");

-- CreateIndex
CREATE UNIQUE INDEX "PodcastMember_podcastId_userId_key" ON "PodcastMember"("podcastId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PodcastInvitation_tokenHash_key" ON "PodcastInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "PodcastInvitation_podcastId_idx" ON "PodcastInvitation"("podcastId");

-- CreateIndex
CREATE INDEX "PodcastInvitation_email_idx" ON "PodcastInvitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PodcastPerson_podcastId_personId_key" ON "PodcastPerson"("podcastId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "PodcastExternalSource_podcastId_provider_key" ON "PodcastExternalSource"("podcastId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Season_podcastId_number_key" ON "Season"("podcastId", "number");

-- CreateIndex
CREATE INDEX "Episode_publishedAt_idx" ON "Episode"("publishedAt");

-- CreateIndex
CREATE INDEX "Episode_status_idx" ON "Episode"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_podcastId_slug_key" ON "Episode"("podcastId", "slug");

-- CreateIndex
CREATE INDEX "UploadSession_userId_idx" ON "UploadSession"("userId");

-- CreateIndex
CREATE INDEX "UploadSession_status_idx" ON "UploadSession"("status");

-- CreateIndex
CREATE INDEX "MediaSource_episodeId_idx" ON "MediaSource"("episodeId");

-- CreateIndex
CREATE INDEX "Transcript_episodeId_idx" ON "Transcript"("episodeId");

-- CreateIndex
CREATE INDEX "Transcript_languageCode_idx" ON "Transcript"("languageCode");

-- CreateIndex
CREATE INDEX "Transcript_status_idx" ON "Transcript"("status");

-- CreateIndex
CREATE INDEX "TranscriptSegment_transcriptId_idx" ON "TranscriptSegment"("transcriptId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_startTimeMs_idx" ON "TranscriptSegment"("startTimeMs");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSpeaker_transcriptId_label_key" ON "TranscriptSpeaker"("transcriptId", "label");

-- CreateIndex
CREATE INDEX "EpisodeChapter_episodeId_idx" ON "EpisodeChapter"("episodeId");

-- CreateIndex
CREATE INDEX "ContentSuggestion_episodeId_status_idx" ON "ContentSuggestion"("episodeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RssFeed_podcastId_key" ON "RssFeed"("podcastId");

-- CreateIndex
CREATE UNIQUE INDEX "RssImportedEpisode_rssFeedId_guid_key" ON "RssImportedEpisode"("rssFeedId", "guid");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialSection_slug_key" ON "EditorialSection"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");

-- CreateIndex
CREATE INDEX "EpisodeDailyStats_date_idx" ON "EpisodeDailyStats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeDailyStats_episodeId_date_key" ON "EpisodeDailyStats"("episodeId", "date");

-- CreateIndex
CREATE INDEX "JobQueueItem_status_runAt_idx" ON "JobQueueItem"("status", "runAt");

-- CreateIndex
CREATE INDEX "JobQueueItem_queueName_status_idx" ON "JobQueueItem"("queueName", "status");

-- CreateIndex
CREATE INDEX "SlugRedirect_oldSlug_idx" ON "SlugRedirect"("oldSlug");

-- CreateIndex
CREATE UNIQUE INDEX "SlugRedirect_entityType_oldSlug_key" ON "SlugRedirect"("entityType", "oldSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_slug_key" ON "Topic"("slug");

-- CreateIndex
CREATE INDEX "TopicAlias_alias_idx" ON "TopicAlias"("alias");

-- CreateIndex
CREATE INDEX "Claim_podcastId_idx" ON "Claim"("podcastId");

-- CreateIndex
CREATE INDEX "Claim_userId_idx" ON "Claim"("userId");

-- CreateIndex
CREATE INDEX "Claim_status_idx" ON "Claim"("status");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorMarketAccess" ADD CONSTRAINT "CreatorMarketAccess_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorMarketAccess" ADD CONSTRAINT "CreatorMarketAccess_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonAlias" ADD CONSTRAINT "PersonAlias_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Podcast" ADD CONSTRAINT "Podcast_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Podcast" ADD CONSTRAINT "Podcast_primaryLanguageCode_fkey" FOREIGN KEY ("primaryLanguageCode") REFERENCES "Language"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Podcast" ADD CONSTRAINT "Podcast_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastAlternateTitle" ADD CONSTRAINT "PodcastAlternateTitle_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastLanguage" ADD CONSTRAINT "PodcastLanguage_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastLanguage" ADD CONSTRAINT "PodcastLanguage_languageCode_fkey" FOREIGN KEY ("languageCode") REFERENCES "Language"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastMember" ADD CONSTRAINT "PodcastMember_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastMember" ADD CONSTRAINT "PodcastMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastInvitation" ADD CONSTRAINT "PodcastInvitation_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastInvitation" ADD CONSTRAINT "PodcastInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastPerson" ADD CONSTRAINT "PodcastPerson_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastPerson" ADD CONSTRAINT "PodcastPerson_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastExternalSource" ADD CONSTRAINT "PodcastExternalSource_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_languageCode_fkey" FOREIGN KEY ("languageCode") REFERENCES "Language"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSource" ADD CONSTRAINT "MediaSource_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSource" ADD CONSTRAINT "MediaSource_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_languageCode_fkey" FOREIGN KEY ("languageCode") REFERENCES "Language"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_sourceTranscriptId_fkey" FOREIGN KEY ("sourceTranscriptId") REFERENCES "Transcript"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSpeaker" ADD CONSTRAINT "TranscriptSpeaker_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSpeaker" ADD CONSTRAINT "TranscriptSpeaker_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeChapter" ADD CONSTRAINT "EpisodeChapter_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentSuggestion" ADD CONSTRAINT "ContentSuggestion_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialSection" ADD CONSTRAINT "EditorialSection_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialSectionItem" ADD CONSTRAINT "EditorialSectionItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "EditorialSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialSectionItem" ADD CONSTRAINT "EditorialSectionItem_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialSectionItem" ADD CONSTRAINT "EditorialSectionItem_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialSectionItem" ADD CONSTRAINT "EditorialSectionItem_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialSectionItem" ADD CONSTRAINT "EditorialSectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialSectionItem" ADD CONSTRAINT "EditorialSectionItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeDailyStats" ADD CONSTRAINT "EpisodeDailyStats_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RssFeed" ADD CONSTRAINT "RssFeed_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RssSyncRun" ADD CONSTRAINT "RssSyncRun_rssFeedId_fkey" FOREIGN KEY ("rssFeedId") REFERENCES "RssFeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RssImportedEpisode" ADD CONSTRAINT "RssImportedEpisode_rssFeedId_fkey" FOREIGN KEY ("rssFeedId") REFERENCES "RssFeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RssImportedEpisode" ADD CONSTRAINT "RssImportedEpisode_localEpisodeId_fkey" FOREIGN KEY ("localEpisodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicAlias" ADD CONSTRAINT "TopicAlias_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLanguagePreference" ADD CONSTRAINT "UserLanguagePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLanguagePreference" ADD CONSTRAINT "UserLanguagePreference_languageCode_fkey" FOREIGN KEY ("languageCode") REFERENCES "Language"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTopicPreference" ADD CONSTRAINT "UserTopicPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTopicPreference" ADD CONSTRAINT "UserTopicPreference_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCountryPreference" ADD CONSTRAINT "UserCountryPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCountryPreference" ADD CONSTRAINT "UserCountryPreference_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastCategory" ADD CONSTRAINT "PodcastCategory_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastCategory" ADD CONSTRAINT "PodcastCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastTopic" ADD CONSTRAINT "PodcastTopic_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastTopic" ADD CONSTRAINT "PodcastTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeTopic" ADD CONSTRAINT "EpisodeTopic_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeTopic" ADD CONSTRAINT "EpisodeTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodePerson" ADD CONSTRAINT "EpisodePerson_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodePerson" ADD CONSTRAINT "EpisodePerson_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastFollow" ADD CONSTRAINT "PodcastFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodcastFollow" ADD CONSTRAINT "PodcastFollow_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorFollow" ADD CONSTRAINT "CreatorFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorFollow" ADD CONSTRAINT "CreatorFollow_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedEpisode" ADD CONSTRAINT "SavedEpisode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedEpisode" ADD CONSTRAINT "SavedEpisode_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackHistory" ADD CONSTRAINT "PlaybackHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackHistory" ADD CONSTRAINT "PlaybackHistory_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_podcastId_fkey" FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
