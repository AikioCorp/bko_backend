import { Router } from "express";
import { AuthController } from "../../modules/auth/auth.controller.js";
import { UserController } from "../../modules/users/user.controller.js";
import { InteractionController } from "../../modules/interactions/interaction.controller.js";
import { PlaylistController } from "../../modules/playlists/playlist.controller.js";
import { PodcastController } from "../../modules/podcasts/podcast.controller.js";
import { EpisodeController } from "../../modules/episodes/episode.controller.js";
import { SearchController } from "../../modules/search/search.controller.js";
import { DiscoveryController } from "../../modules/discovery/discovery.controller.js";
import { ReferentialController } from "../../modules/referentials/referential.controller.js";
import { CreatorController } from "../../modules/creator/creator.controller.js";
import { UploadController } from "../../modules/media/upload.controller.js";
import { MarketController } from "../../modules/markets/market.controller.js";
import { RssController } from "../../modules/rss/rss.controller.js";
import { AdminController } from "../../modules/admin/admin.controller.js";
import { CollectionController } from "../../modules/collections/collection.controller.js";
import { ClaimController } from "../../modules/claims/claim.controller.js";
import { TranscriptController } from "../../modules/transcripts/transcript.controller.js";
import { authenticateToken, optionalAuthenticateToken, requireAdmin } from "../../middlewares/auth.middleware.js";
import { prisma } from "../../config/prisma.js";

const router = Router();

// Healthchecks
router.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString(), service: "Bko_backend API v1" });
});

router.get("/health/storage", (req, res) => {
  res.json({ status: "OK", provider: process.env.R2_ENDPOINT ? "CloudflareR2" : "LocalMock", bucket: process.env.R2_BUCKET_MEDIA || "bamako-podcast-media" });
});

router.get("/health/worker", (req, res) => {
  res.json({ status: "OK", worker: "PostgreSQL JobQueueItem Worker", queues: ["media-processing", "episodes-publisher", "rss-importer", "transcript-worker"] });
});

// --- AUTHENTIFICATION ---
router.post("/auth/register", AuthController.register);
router.post("/auth/verify-otp", AuthController.verifyOtp);
router.post("/auth/login", AuthController.login);
router.post("/auth/refresh", AuthController.refreshToken);
router.post("/auth/logout", AuthController.logout);
router.post("/auth/logout-all", authenticateToken, AuthController.logoutAllDevices);

// --- PROFIL & PRÉFÉRENCES ---
router.get("/me", authenticateToken, UserController.getMe);
router.patch("/me", authenticateToken, UserController.updateMe);
router.patch("/me/preferences", authenticateToken, UserController.updatePreferences);
router.get("/me/devices", authenticateToken, UserController.getDevices);
router.delete("/me/devices/:id", authenticateToken, UserController.revokeDevice);

// --- MARCHÉS & DISPONIBILITÉ GÉOGRAPHIQUE ---
router.get("/markets", MarketController.getPublicMarkets);
router.post("/creator/market-access-requests", authenticateToken, MarketController.requestBetaAccess);

router.get("/admin/markets", authenticateToken, requireAdmin, MarketController.getAdminMarkets);
router.get("/admin/markets/:countryCode", authenticateToken, requireAdmin, MarketController.getMarketByCountryCode);
router.patch("/admin/markets/:countryCode", authenticateToken, requireAdmin, MarketController.updateMarket);
router.post("/admin/markets/:countryCode/activate", authenticateToken, requireAdmin, MarketController.activateMarket);
router.post("/admin/markets/:countryCode/suspend", authenticateToken, requireAdmin, MarketController.suspendMarket);
router.patch("/admin/creator-market-access/:id", authenticateToken, requireAdmin, MarketController.updateCreatorAccess);

// --- TRANSCRIPTION & CHAPITRES (VERTICALE 8) ---
router.get("/episodes/:id/transcript", TranscriptController.getPublicTranscript);
router.get("/episodes/:id/chapters", TranscriptController.getChapters);
router.get("/episodes/:id/transcript/search", TranscriptController.searchEpisodeTranscript);

router.post("/creator/episodes/:episodeId/transcripts/import", authenticateToken, TranscriptController.importSubtitles);
router.post("/creator/episodes/:episodeId/transcripts/generate", authenticateToken, TranscriptController.generateTranscript);
router.patch("/creator/transcripts/segments/:id", authenticateToken, TranscriptController.updateSegment);
router.post("/creator/episodes/:episodeId/chapters", authenticateToken, TranscriptController.updateChapters);

// --- BACKOFFICE ADMIN & CMS ÉDITORIAL ---
router.get("/admin/dashboard", authenticateToken, requireAdmin, AdminController.getDashboard);
router.get("/admin/catalog", authenticateToken, requireAdmin, AdminController.getCatalog);
router.get("/admin/catalog/health", authenticateToken, requireAdmin, AdminController.getContentHealth);
router.post("/admin/podcasts", authenticateToken, requireAdmin, AdminController.createPodcast);
router.post("/admin/podcasts/from-url", authenticateToken, requireAdmin, AdminController.addFromUrlPreview);
router.post("/admin/podcasts/detect-duplicates", authenticateToken, requireAdmin, AdminController.detectDuplicates);
router.post("/admin/podcasts/merge", authenticateToken, requireAdmin, AdminController.mergePodcasts);

router.get("/admin/people", authenticateToken, requireAdmin, AdminController.listPeople);
router.post("/admin/people", authenticateToken, requireAdmin, AdminController.createPerson);
router.post("/admin/people/merge", authenticateToken, requireAdmin, AdminController.mergePeople);

router.get("/admin/organizations", authenticateToken, requireAdmin, AdminController.listOrganizations);
router.post("/admin/organizations", authenticateToken, requireAdmin, AdminController.createOrganization);

router.get("/admin/claims", authenticateToken, requireAdmin, ClaimController.getAdminClaims);
router.patch("/admin/claims/:id/review", authenticateToken, requireAdmin, ClaimController.reviewClaim);
router.get("/admin/audit", authenticateToken, requireAdmin, AdminController.getAuditLogs);

// --- REVENDICATIONS DE PODCASTS (CLAIMS) ---
router.post("/podcasts/:podcastId/claims", authenticateToken, ClaimController.submitClaim);
router.get("/me/claims", authenticateToken, ClaimController.getUserClaims);

// --- COLLECTIONS ÉDITORIALES ---
router.get("/collections", CollectionController.listCollections);
router.get("/collections/:slug", CollectionController.getCollectionBySlug);
router.post("/admin/collections", authenticateToken, requireAdmin, CollectionController.createCollection);
router.patch("/admin/collections/:id/items", authenticateToken, requireAdmin, CollectionController.updateCollectionItems);

// --- ORGANISATIONS PUBLIQUES ---
router.get("/organizations/:slug", async (req, res) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { slug: req.params.slug },
      include: {
        country: true,
        podcasts: { include: { country: true, primaryLanguage: true } },
      },
    });
    if (!org) return res.status(404).json({ success: false, message: "Organisation introuvable" });
    res.json({ success: true, data: org });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// --- UPLOAD MÉDIA NATIF ---
router.post("/creator/uploads", authenticateToken, UploadController.createUploadSession);
router.post("/creator/uploads/:id/complete", authenticateToken, UploadController.completeUploadSession);
router.get("/creator/uploads/:id", authenticateToken, UploadController.getUploadSessionStatus);

// --- SYNCHRONISATION & IMPORT FLUX RSS ---
router.post("/creator/podcasts/:podcastId/rss/preview", authenticateToken, RssController.previewFeed);
router.post("/creator/podcasts/:podcastId/rss/connect", authenticateToken, RssController.connectFeed);
router.post("/creator/podcasts/:podcastId/rss/sync", authenticateToken, RssController.syncFeedNow);
router.delete("/creator/podcasts/:podcastId/rss", authenticateToken, RssController.disconnectFeed);
router.get("/creator/podcasts/:podcastId/rss", authenticateToken, RssController.getFeedStatus);

// --- ESPACE CRÉATEUR (CREATOR STUDIO) ---
router.get("/me/creator-profile", authenticateToken, CreatorController.getProfile);
router.post("/me/creator-profile", authenticateToken, CreatorController.createProfile);
router.patch("/me/creator-profile", authenticateToken, CreatorController.updateProfile);
router.get("/creators/:slug", CreatorController.getPublicProfile);

router.get("/creator/dashboard", authenticateToken, CreatorController.getDashboard);
router.get("/creator/podcasts", authenticateToken, CreatorController.listPodcasts);
router.post("/creator/podcasts", authenticateToken, CreatorController.createPodcast);
router.get("/creator/podcasts/:id", authenticateToken, CreatorController.getPodcastById);
router.patch("/creator/podcasts/:id", authenticateToken, CreatorController.updatePodcast);
router.delete("/creator/podcasts/:id", authenticateToken, CreatorController.archivePodcast);

router.get("/creator/podcasts/:podcastId/episodes", authenticateToken, CreatorController.listEpisodes);
router.post("/creator/podcasts/:podcastId/episodes", authenticateToken, CreatorController.createEpisode);
router.post("/creator/episodes/:episodeId/media-sources", authenticateToken, CreatorController.addMediaSource);
router.post("/creator/episodes/:episodeId/publish", authenticateToken, CreatorController.publishEpisode);
router.post("/creator/episodes/:episodeId/schedule", authenticateToken, CreatorController.scheduleEpisode);

router.get("/creator/podcasts/:id/members", authenticateToken, CreatorController.getMembers);
router.post("/creator/podcasts/:id/invitations", authenticateToken, CreatorController.inviteMember);

// --- INTERACTIONS (FOLLOW, SAVE, HISTORY) ---
router.post("/podcasts/:id/follow", authenticateToken, InteractionController.followPodcast);
router.delete("/podcasts/:id/follow", authenticateToken, InteractionController.unfollowPodcast);

router.post("/episodes/:id/save", authenticateToken, InteractionController.saveEpisode);
router.delete("/episodes/:id/save", authenticateToken, InteractionController.unsaveEpisode);
router.get("/me/saved", authenticateToken, InteractionController.getSavedEpisodes);

router.post("/me/history", authenticateToken, InteractionController.updatePlaybackHistory);
router.get("/me/history", authenticateToken, InteractionController.getHistory);
router.delete("/me/history", authenticateToken, InteractionController.clearHistory);
router.get("/me/continue-listening", authenticateToken, InteractionController.getContinueListening);

// --- PLAYLISTS ---
router.get("/me/playlists", authenticateToken, PlaylistController.getUserPlaylists);
router.post("/playlists", authenticateToken, PlaylistController.createPlaylist);
router.get("/playlists/:id", optionalAuthenticateToken, PlaylistController.getPlaylistById);
router.patch("/playlists/:id", authenticateToken, PlaylistController.updatePlaylist);
router.delete("/playlists/:id", authenticateToken, PlaylistController.deletePlaylist);
router.post("/playlists/:id/items", authenticateToken, PlaylistController.addItemToPlaylist);
router.delete("/playlists/:id/items/:episodeId", authenticateToken, PlaylistController.removeItemFromPlaylist);

// --- RECHERCHE, DÉCOUVERTE & CATALOGUE ---
router.get("/search", SearchController.search);
router.get("/search/suggestions", SearchController.suggestions);

router.get("/explore", DiscoveryController.getExplore);
router.get("/home", DiscoveryController.getHome);
router.get("/trending", DiscoveryController.getTrending);

router.get("/podcasts", PodcastController.listPodcasts);
router.get("/podcasts/:slug", PodcastController.getPodcastBySlug);

router.get("/episodes/recent", EpisodeController.listRecentEpisodes);
router.get("/podcasts/:podcastSlug/episodes/:episodeSlug", EpisodeController.getEpisodeBySlug);

router.get("/categories", ReferentialController.getCategories);
router.get("/categories/:slug", ReferentialController.getCategoryBySlug);

router.get("/topics", ReferentialController.getTopics);
router.get("/topics/:slug", ReferentialController.getTopicBySlug);

router.get("/countries", ReferentialController.getCountries);
router.get("/countries/:code", ReferentialController.getCountryByCode);

router.get("/languages", ReferentialController.getLanguages);
router.get("/languages/:code", ReferentialController.getLanguageByCode);

export default router;
