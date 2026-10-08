import { StorageFactory } from "../../services/storage/storage.factory.js";
import { LocalMockStorageProvider } from "../../services/storage/local-mock-storage.provider.js";
import { EngagementController } from "../../modules/interactions/engagement.controller.js";
import { Router } from "express";
import { AuthController } from "../../modules/auth/auth.controller.js";
import { UserController } from "../../modules/users/user.controller.js";
import { InteractionController } from "../../modules/interactions/interaction.controller.js";
import { PlaylistController } from "../../modules/playlists/playlist.controller.js";
import { PodcastController } from "../../modules/podcasts/podcast.controller.js";
import { EpisodeController } from "../../modules/episodes/episode.controller.js";
import { SearchController } from "../../modules/search/search.controller.js";
import { DiscoveryController } from "../../modules/discovery/discovery.controller.js";
import { StudioOfferController } from "../../modules/studio/StudioOfferController.js";
import { ReferentialController } from "../../modules/referentials/referential.controller.js";
import { CreatorController } from "../../modules/creator/creator.controller.js";
import { UploadController } from "../../modules/media/upload.controller.js";
import { MarketController } from "../../modules/markets/market.controller.js";
import { RssController } from "../../modules/rss/rss.controller.js";
import { AdminController } from "../../modules/admin/admin.controller.js";
import { CollectionController } from "../../modules/collections/collection.controller.js";
import { ClaimController } from "../../modules/claims/claim.controller.js";
import { TranscriptController } from "../../modules/transcripts/transcript.controller.js";
import { NotificationController } from "../../modules/notifications/notification.controller.js";
import { CreatorManageController } from "../../modules/creator/creator-manage.controller.js";
import { AdminRssController } from "../../modules/admin/admin-rss.controller.js";
import { AdminClassificationController } from "../../modules/admin/admin-classification.controller.js";
import { AdminConsoleController } from "../../modules/admin/admin-console.controller.js";
import { requirePermission } from "../../middlewares/permission.middleware.js";
import { authenticateToken, optionalAuthenticateToken } from "../../middlewares/auth.middleware.js";
import rateLimit from "express-rate-limit";
import { prisma } from "../../config/prisma.js";

const router = Router();

// Rate-limiter strict pour les routes sensibles d'authentification (anti brute-force
// login / OTP). Bien plus serré que le limiteur global. Clé par IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "TOO_MANY_AUTH_ATTEMPTS",
      message: "Trop de tentatives. Réessayez dans quelques minutes.",
    },
  },
});

// Limiteur par compte (email/identifiant) : empêche le brute-force distribué de l'OTP
// et le spam d'envoi de codes, indépendamment de l'IP.
const accountLimiter = (max: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === "production" ? max : 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `acct:${(req as any).user?.id ?? (String(req.body?.email ?? req.body?.identifier ?? "").trim().toLowerCase() || "anon")}`,
    validate: { keyGeneratorIpFallback: false },
    message: {
      success: false,
      error: { code: "TOO_MANY_AUTH_ATTEMPTS", message: "Trop de tentatives. Réessayez dans quelques minutes." },
    },
  });

// Limiteur du suivi d'écoute : borne la pollution des statistiques (par IP et par épisode).
const playLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 30 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `play:${req.ip}:${req.params.id}`,
  validate: { keyGeneratorIpFallback: false },
  message: { success: false, error: { code: "TOO_MANY_REQUESTS", message: "Trop d'évènements d'écoute." } },
});

// Local development uploads are saved to disk, including audio/video range playback.
if (process.env.NODE_ENV !== "production") {
  router.put("/mock-storage/upload", async (req, res) => {
    const storage=StorageFactory.getProvider();
    if(!(storage instanceof LocalMockStorageProvider)) {res.sendStatus(404);return;}
    try {await storage.receiveUpload(String(req.query.token || ""),req);res.status(200).send("OK");}
    catch {if(!res.headersSent) res.status(400).json({success:false,message:"Transfert local refusé ou incomplet."});}
  });
  router.get("/mock-storage/file", (req,res) => {
    const storage=StorageFactory.getProvider();
    if(!(storage instanceof LocalMockStorageProvider)) {res.sendStatus(404);return;}
    try {res.sendFile(storage.filePath(String(req.query.key || "")),error=>{if(error && !res.headersSent) res.sendStatus(404);});}
    catch {res.sendStatus(400);}
  });
}

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
router.post("/auth/register", authLimiter, accountLimiter(5), AuthController.register);
router.post("/auth/verify-otp", authLimiter, accountLimiter(5), AuthController.verifyOtp);
router.post("/auth/forgot-password", authLimiter, accountLimiter(3), AuthController.forgotPassword);
router.post("/auth/reset-password", authLimiter, AuthController.resetPassword);
router.post("/auth/login", authLimiter, accountLimiter(10), AuthController.login);
router.post("/auth/refresh", authLimiter, AuthController.refreshToken);
router.post("/auth/logout", authLimiter, AuthController.logout);
router.post("/auth/logout-all", authenticateToken, AuthController.logoutAllDevices);

// --- PROFIL & PRÉFÉRENCES ---
router.get("/me", authenticateToken, UserController.getMe);
router.patch("/me", authenticateToken, UserController.updateMe);
router.patch("/me/preferences", authenticateToken, UserController.updatePreferences);
router.get("/me/devices", authenticateToken, UserController.getDevices);
router.delete("/me/devices/:id", authenticateToken, UserController.revokeDevice);

// --- NOTIFICATIONS DANS L'APPLICATION ---
router.get("/me/notifications", authenticateToken, NotificationController.list);
router.get("/me/notifications/unread-count", authenticateToken, NotificationController.unreadCount);
router.post("/me/notifications/read", authenticateToken, NotificationController.markRead);

// --- MARCHÉS & DISPONIBILITÉ GÉOGRAPHIQUE ---
router.get("/markets", MarketController.getPublicMarkets);
router.post("/creator/market-access-requests", authenticateToken, MarketController.requestBetaAccess);

router.get("/admin/markets", authenticateToken, requirePermission("markets.view"), MarketController.getAdminMarkets);
router.get("/admin/markets/:countryCode", authenticateToken, requirePermission("markets.view"), MarketController.getMarketByCountryCode);
router.patch("/admin/markets/:countryCode", authenticateToken, requirePermission("markets.edit"), MarketController.updateMarket);
router.post("/admin/markets/:countryCode/activate", authenticateToken, requirePermission("markets.edit"), MarketController.activateMarket);
router.post("/admin/markets/:countryCode/suspend", authenticateToken, requirePermission("markets.edit"), MarketController.suspendMarket);
router.patch("/admin/creator-market-access/:id", authenticateToken, requirePermission("markets.edit"), MarketController.updateCreatorAccess);

// --- TRANSCRIPTION & CHAPITRES (VERTICALE 8) ---
router.get("/episodes/:id/transcript", TranscriptController.getPublicTranscript);
router.get("/episodes/:id/chapters", TranscriptController.getChapters);
router.get("/episodes/:id/transcript/search", TranscriptController.searchEpisodeTranscript);

router.post("/creator/episodes/:episodeId/transcripts/import", authenticateToken, TranscriptController.importSubtitles);
router.post("/creator/episodes/:episodeId/transcripts/generate", authenticateToken, TranscriptController.generateTranscript);
router.patch("/creator/transcripts/segments/:id", authenticateToken, TranscriptController.updateSegment);
router.post("/creator/episodes/:episodeId/chapters", authenticateToken, TranscriptController.updateChapters);

// --- BACKOFFICE ADMIN & CMS
router.get("/admin/media", authenticateToken, requirePermission("catalog.view"), AdminMediaController.list);
router.delete("/admin/media/:id", authenticateToken, requirePermission("catalog.delete"), AdminMediaController.remove); 
router.get("/admin/dashboard", authenticateToken, requirePermission("dashboard.view"), AdminController.getDashboard);
router.get("/admin/catalog", authenticateToken, requirePermission("catalog.view"), AdminController.getCatalog);
router.get("/admin/episodes", authenticateToken, requirePermission("catalog.view"), AdminController.listAllEpisodes);
router.get("/admin/catalog/health", authenticateToken, requirePermission("catalog.view"), AdminController.getContentHealth);
router.get("/admin/podcasts/:id", authenticateToken, requirePermission("catalog.view"), AdminController.getPodcast);
router.get("/admin/podcasts/:id/episodes", authenticateToken, requirePermission("catalog.view"), AdminController.listEpisodes);
import { AdminMediaController } from "../../modules/admin/admin-media.controller.js";
import { AdminEpisodeController } from "../../modules/admin/admin-episode.controller.js";

// --- ADMIN EPISODES V2 (Création & Édition détaillée) ---
router.post("/admin/podcasts/:podcastId/episodes", authenticateToken, requirePermission("catalog.edit"), AdminEpisodeController.createDraft);
router.get("/admin/episodes/:id", authenticateToken, requirePermission("catalog.view"), AdminEpisodeController.get);
router.patch("/admin/episodes/:id", authenticateToken, requirePermission("catalog.edit"), AdminEpisodeController.update);
router.post("/admin/episodes/:id/audio/uploads", authenticateToken, requirePermission("catalog.edit"), AdminEpisodeController.createAudioUpload);
router.post("/admin/episodes/:id/audio/uploads/:uploadId/complete", authenticateToken, requirePermission("catalog.edit"), AdminEpisodeController.completeAudioUpload);
router.post("/admin/episodes/:id/audio/url", authenticateToken, requirePermission("catalog.edit"), AdminEpisodeController.setAudioUrl);
router.delete("/admin/episodes/:id", authenticateToken, requirePermission("catalog.delete"), AdminEpisodeController.remove);
router.delete("/admin/episodes/:id/audio", authenticateToken, requirePermission("catalog.edit"), AdminEpisodeController.removeAudio);
router.post("/admin/media/youtube/preview", authenticateToken, requirePermission("catalog.view"), AdminEpisodeController.previewYoutube);
router.post("/admin/episodes/:id/youtube", authenticateToken, requirePermission("catalog.edit"), AdminEpisodeController.setYoutube);
router.post("/admin/episodes/:id/youtube/check", authenticateToken, requirePermission("catalog.edit"), AdminEpisodeController.reportYoutubeCheck);
router.delete("/admin/episodes/:id/youtube", authenticateToken, requirePermission("catalog.edit"), AdminEpisodeController.removeYoutube);
router.post("/admin/episodes/bulk-publish", authenticateToken, requirePermission("catalog.edit"), AdminEpisodeController.bulkPublish);
router.post("/admin/episodes/:id/publish", authenticateToken, requirePermission("catalog.edit"), AdminEpisodeController.publish);

import { AdminEditorialController } from "../../modules/admin/admin-editorial.controller.js";

// --- ADMIN EDITORIAL (Sélections & Collections) ---
router.get("/admin/editorial/sections", authenticateToken, requirePermission("catalog.view"), AdminEditorialController.listSections);
router.post("/admin/editorial/sections", authenticateToken, requirePermission("catalog.edit"), AdminEditorialController.createSection);
router.post("/admin/editorial/sections/reorder", authenticateToken, requirePermission("catalog.edit"), AdminEditorialController.reorderSections);
router.get("/admin/editorial/sections/:id", authenticateToken, requirePermission("catalog.view"), AdminEditorialController.getSection);
router.patch("/admin/editorial/sections/:id", authenticateToken, requirePermission("catalog.edit"), AdminEditorialController.updateSection);
router.post("/admin/editorial/sections/:id/items", authenticateToken, requirePermission("catalog.edit"), AdminEditorialController.addSectionItem);
router.delete("/admin/editorial/sections/items/:itemId", authenticateToken, requirePermission("catalog.edit"), AdminEditorialController.removeSectionItem);
router.post("/admin/editorial/sections/:id/items/reorder", authenticateToken, requirePermission("catalog.edit"), AdminEditorialController.reorderSectionItems);

router.get("/admin/collections", authenticateToken, requirePermission("catalog.view"), AdminEditorialController.listCollections);
router.post("/admin/collections", authenticateToken, requirePermission("catalog.edit"), AdminEditorialController.createCollection);
router.get("/admin/collections/:id", authenticateToken, requirePermission("catalog.view"), AdminEditorialController.getCollection);
router.patch("/admin/collections/:id", authenticateToken, requirePermission("catalog.edit"), AdminEditorialController.updateCollection);
router.post("/admin/collections/:id/items", authenticateToken, requirePermission("catalog.edit"), AdminEditorialController.addCollectionItem);
router.delete("/admin/collections/items/:itemId", authenticateToken, requirePermission("catalog.edit"), AdminEditorialController.removeCollectionItem);
router.post("/admin/collections/:id/items/reorder", authenticateToken, requirePermission("catalog.edit"), AdminEditorialController.reorderCollectionItems);

// Note : L'ancienne route POST /admin/podcasts/:id/episodes du AdminController est supplantée
// On laisse l'ancienne /admin/episodes/:id en PUT pour l'instant (utilisée par la v1).
router.put("/admin/episodes/:id", authenticateToken, requirePermission("catalog.edit"), AdminController.updateEpisode);
router.post("/admin/podcasts", authenticateToken, requirePermission("catalog.create"), AdminController.createPodcast);
router.put("/admin/podcasts/:id", authenticateToken, requirePermission("catalog.edit"), AdminController.updatePodcast);
router.delete("/admin/podcasts/:id", authenticateToken, requirePermission("catalog.delete"), AdminController.deletePodcast);
router.post("/admin/podcasts/from-url", authenticateToken, requirePermission("catalog.create"), AdminController.addFromUrlPreview);
router.post("/admin/podcasts/detect-duplicates", authenticateToken, requirePermission("catalog.view"), AdminController.detectDuplicates);
router.post("/admin/podcasts/merge", authenticateToken, requirePermission("catalog.edit"), AdminController.mergePodcasts);

router.get("/admin/people", authenticateToken, requirePermission("catalog.view"), AdminController.listPeople);
router.post("/admin/people", authenticateToken, requirePermission("catalog.create"), AdminController.createPerson);
router.post("/admin/people/merge", authenticateToken, requirePermission("catalog.edit"), AdminController.mergePeople);

router.get("/admin/organizations", authenticateToken, requirePermission("catalog.view"), AdminController.listOrganizations);
router.post("/admin/organizations", authenticateToken, requirePermission("catalog.create"), AdminController.createOrganization);

router.get("/admin/claims", authenticateToken, requirePermission("claims.view"), ClaimController.getAdminClaims);
router.patch("/admin/claims/:id/review", authenticateToken, requirePermission("claims.edit"), ClaimController.reviewClaim);
router.get("/admin/audit", authenticateToken, requirePermission("audit.view"), AdminController.getAuditLogs);



// --- ADMIN RSS IMPORTS ---
router.post("/admin/rss/preview", authenticateToken, requirePermission("catalog.create"), AdminRssController.previewRss);
router.post("/admin/rss/imports", authenticateToken, requirePermission("catalog.create"), AdminRssController.createImport);
router.get("/admin/rss/imports/:id/status", authenticateToken, requirePermission("catalog.view"), AdminRssController.getImportStatus);
router.post("/admin/podcasts/:id/rss/sync", authenticateToken, requirePermission("catalog.edit"), AdminRssController.syncFeedNow);

// --- ADMIN CATEGORIES & LANGUAGES ---
router.get("/admin/categories", authenticateToken, AdminClassificationController.listCategories);
router.post("/admin/categories", authenticateToken, requirePermission("catalog.create"), AdminClassificationController.createCategory);
router.put("/admin/categories/:id", authenticateToken, requirePermission("catalog.edit"), AdminClassificationController.updateCategory);
router.delete("/admin/categories/:id", authenticateToken, requirePermission("catalog.delete"), AdminClassificationController.deleteCategory);


router.get("/admin/languages", authenticateToken, AdminClassificationController.listLanguages);
router.post("/admin/languages", authenticateToken, requirePermission("catalog.create"), AdminClassificationController.createLanguage);
router.put("/admin/languages/:code", authenticateToken, requirePermission("catalog.edit"), AdminClassificationController.updateLanguage);
router.delete("/admin/languages/:code", authenticateToken, requirePermission("catalog.delete"), AdminClassificationController.deleteLanguage);


// --- CONSOLE D'ADMINISTRATION : supervision, validation, modération, utilisateurs, stockage ---
router.get("/admin/overview", authenticateToken, requirePermission("dashboard.view"), AdminConsoleController.overview);
router.get("/admin/reviews", authenticateToken, requirePermission("reviews.view"), AdminConsoleController.reviewQueue);
router.post("/admin/reviews/episodes/:id", authenticateToken, requirePermission("reviews.edit"), AdminConsoleController.reviewEpisode);
router.post("/admin/reviews/podcasts/:id", authenticateToken, requirePermission("reviews.edit"), AdminConsoleController.reviewPodcast);
router.get("/admin/reports", authenticateToken, requirePermission("moderation.view"), AdminConsoleController.listReports);
router.patch("/admin/reports/:id", authenticateToken, requirePermission("moderation.edit"), AdminConsoleController.handleReport);
router.get("/admin/users", authenticateToken, requirePermission("users.view"), AdminConsoleController.listUsers);
router.put("/admin/users/:id/roles", authenticateToken, requirePermission("users.edit"), AdminConsoleController.setUserRoles);
router.post("/admin/users/:id/suspension", authenticateToken, requirePermission("users.edit"), AdminConsoleController.setUserSuspension);
router.post("/admin/users/:id/creator-verification", authenticateToken, requirePermission("users.edit"), AdminConsoleController.setCreatorVerification);
router.get("/admin/access", authenticateToken, AdminConsoleController.myAccess);
router.get("/admin/permissions", authenticateToken, requirePermission("roles.view"), AdminConsoleController.permissionsCatalog);
router.get("/admin/roles", authenticateToken, requirePermission("roles.view"), AdminConsoleController.listRoles);
router.get("/admin/assignable-roles", authenticateToken, requirePermission("users.edit"), AdminConsoleController.assignableRoles);
router.post("/admin/roles", authenticateToken, requirePermission("roles.create"), AdminConsoleController.createRole);
router.put("/admin/roles/:id", authenticateToken, requirePermission("roles.edit"), AdminConsoleController.updateRole);
router.delete("/admin/roles/:id", authenticateToken, requirePermission("roles.delete"), AdminConsoleController.deleteRole);
router.get("/admin/storage", authenticateToken, requirePermission("storage.view"), AdminConsoleController.storage);
router.post("/admin/jobs/:id/retry", authenticateToken, requirePermission("storage.edit"), AdminConsoleController.retryJob);
router.get("/admin/settings", authenticateToken, requirePermission("settings.view"), AdminConsoleController.settings);

// Signalement d'un contenu par un utilisateur connecté (limité pour éviter le spam)
router.post("/reports", authenticateToken, accountLimiter(10), AdminConsoleController.createReport);

// --- REVENDICATIONS DE PODCASTS (CLAIMS) ---
router.post("/podcasts/:podcastId/claims", authenticateToken, ClaimController.submitClaim);
router.get("/me/claims", authenticateToken, ClaimController.getUserClaims);

// --- COLLECTIONS 
router.get("/collections", CollectionController.listCollections);
router.get("/collections/:slug", CollectionController.getCollectionBySlug);
router.post("/admin/collections", authenticateToken, requirePermission("catalog.edit"), CollectionController.createCollection);
router.patch("/admin/collections/:id/items", authenticateToken, requirePermission("catalog.edit"), CollectionController.updateCollectionItems);

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
router.post("/media/images/upload-url", authenticateToken, UploadController.createImageUploadUrl);
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

router.get("/creator/episodes", authenticateToken, CreatorController.listAllEpisodes);
router.get("/creator/podcasts/:podcastId/episodes", authenticateToken, CreatorController.listEpisodes);
router.post("/creator/podcasts/:podcastId/episodes", authenticateToken, CreatorController.createEpisode);
router.post("/creator/episodes/:episodeId/media-sources", authenticateToken, CreatorController.addMediaSource);
router.post("/creator/episodes/:episodeId/publish", authenticateToken, CreatorController.publishEpisode);
router.post("/creator/episodes/:episodeId/schedule", authenticateToken, CreatorController.scheduleEpisode);

router.get("/creator/podcasts/:id/members", authenticateToken, CreatorController.getMembers);
// --- GESTION DES ÉPISODES (modifier, dépublier, programmer, archiver) ---
router.get("/creator/episodes/:episodeId", authenticateToken, CreatorManageController.getEpisode);
router.patch("/creator/episodes/:episodeId", authenticateToken, CreatorManageController.updateEpisode);
router.post("/creator/episodes/:episodeId/unpublish", authenticateToken, CreatorManageController.unpublish);
router.post("/creator/episodes/:episodeId/unschedule", authenticateToken, CreatorManageController.unschedule);
router.post("/creator/episodes/:episodeId/archive", authenticateToken, CreatorManageController.archive);
router.post("/creator/episodes/:episodeId/restore", authenticateToken, CreatorManageController.restore);
router.delete("/creator/episodes/:episodeId/media-sources/:sourceId", authenticateToken, CreatorManageController.removeSource);
router.post("/creator/episodes/:episodeId/media-sources/:sourceId/primary", authenticateToken, CreatorManageController.setPrimarySource);
router.post("/creator/media/preview", authenticateToken, accountLimiter(60), CreatorManageController.previewLink);

// --- SAISONS ---
router.get("/creator/podcasts/:podcastId/seasons", authenticateToken, CreatorManageController.listSeasons);
router.post("/creator/podcasts/:podcastId/seasons", authenticateToken, CreatorManageController.createSeason);
router.patch("/creator/seasons/:seasonId", authenticateToken, CreatorManageController.updateSeason);
router.delete("/creator/seasons/:seasonId", authenticateToken, CreatorManageController.deleteSeason);

// --- STATISTIQUES ---
router.get("/creator/podcasts/:podcastId/analytics", authenticateToken, CreatorManageController.analytics);
router.post("/episodes/:id/plays", playLimiter, optionalAuthenticateToken, CreatorManageController.recordPlay);

// --- ÉQUIPE & INVITATIONS ---
router.patch("/creator/podcasts/:podcastId/members/:userId", authenticateToken, CreatorManageController.updateMember);
router.delete("/creator/podcasts/:podcastId/members/:userId", authenticateToken, CreatorManageController.removeMember);
router.get("/creator/podcasts/:podcastId/invitations", authenticateToken, CreatorManageController.listInvitations);
router.delete("/creator/podcasts/:podcastId/invitations/:invitationId", authenticateToken, CreatorManageController.revokeInvitation);
router.post("/invitations/accept", authenticateToken, accountLimiter(10), CreatorManageController.acceptInvitation);

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
router.get("/home", optionalAuthenticateToken, DiscoveryController.getHome);
router.get("/trending", DiscoveryController.getTrending);

router.get("/podcasts", PodcastController.listPodcasts);
router.get("/podcasts/:slug", optionalAuthenticateToken, PodcastController.getPodcastBySlug);

router.get("/episodes/recent", EpisodeController.listRecentEpisodes);
router.get("/podcasts/:podcastSlug/episodes/:episodeSlug", optionalAuthenticateToken, EpisodeController.getEpisodeBySlug);

router.get("/categories", ReferentialController.getCategories);
router.get("/categories/:slug", ReferentialController.getCategoryBySlug);

router.get("/topics", ReferentialController.getTopics);
router.get("/topics/:slug", ReferentialController.getTopicBySlug);

router.get("/countries", ReferentialController.getCountries);
router.get("/countries/:code", ReferentialController.getCountryByCode);

router.get("/languages", ReferentialController.getLanguages);
router.get("/languages/:code", ReferentialController.getLanguageByCode);


// --- STUDIO OFFERS & PRICING ---
router.get("/studio-offers", StudioOfferController.getActiveOffers); // Public

// Admin routes
router.get("/admin/studio-offers", authenticateToken, StudioOfferController.getAllOffers);
router.post("/admin/studio-offers", authenticateToken, StudioOfferController.createOffer);
router.patch("/admin/studio-offers/:id", authenticateToken, StudioOfferController.updateOffer);
router.delete("/admin/studio-offers/:id", authenticateToken, StudioOfferController.deleteOffer);


// --- ENGAGEMENT (Likes, Ratings, Comments) ---
router.get("/podcasts/:id/ratings", optionalAuthenticateToken, EngagementController.getPodcastRatings);
router.post("/podcasts/:id/ratings", authenticateToken, EngagementController.ratePodcast);
router.delete("/podcasts/:id/ratings", authenticateToken, EngagementController.deletePodcastRating);

router.post("/episodes/:id/likes", authenticateToken, EngagementController.likeEpisode);
router.delete("/episodes/:id/likes", authenticateToken, EngagementController.unlikeEpisode);

router.get("/episodes/:id/comments", optionalAuthenticateToken, EngagementController.listComments);
router.post("/episodes/:id/comments", authenticateToken, accountLimiter(20), EngagementController.createComment);
router.delete("/comments/:id", authenticateToken, EngagementController.deleteComment);

router.patch("/creator/episodes/:episodeId/comments-settings", authenticateToken, EngagementController.updateCommentSettings);

export default router;
