import { prisma } from "../../config/prisma.js";

export class AdminDashboardService {
  static async getDashboardMetrics() {
    const [
      usersCount,
      creatorsCount,
      podcastsCount,
      episodesCount,
      unclaimedPodcastsCount,
      pendingClaimsCount,
      openReportsCount,
      rssErrorsCount,
      mediaErrorsCount,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.creatorProfile.count(),
      prisma.podcast.count(),
      prisma.episode.count(),
      prisma.podcast.count({ where: { ownershipStatus: "UNCLAIMED" } }),
      prisma.claim.count({ where: { status: "PENDING" } }),
      prisma.report.count({ where: { status: "OPEN" } }),
      prisma.rssFeed.count({ where: { syncStatus: "ERROR" } }),
      prisma.mediaAsset.count({ where: { status: "FAILED" } }),
    ]);

    // Métriques géographiques et linguistiques
    const podcastsByCountryRaw = await prisma.podcast.groupBy({
      by: ["countryId"],
      _count: { id: true },
    });

    const podcastsByLanguageRaw = await prisma.podcast.groupBy({
      by: ["primaryLanguageCode"],
      _count: { id: true },
    });

    // Alertes opérationnelles
    const alerts = [];
    if (pendingClaimsCount > 0) {
      alerts.push({ level: "WARNING", message: `${pendingClaimsCount} revendications de podcasts en attente d'examen.` });
    }
    if (rssErrorsCount > 0) {
      alerts.push({ level: "ERROR", message: `${rssErrorsCount} flux RSS en erreur nécessitent une intervention.` });
    }
    if (mediaErrorsCount > 0) {
      alerts.push({ level: "ERROR", message: `${mediaErrorsCount} fichiers médias natifs en échec d'analyse.` });
    }
    if (openReportsCount > 0) {
      alerts.push({ level: "INFO", message: `${openReportsCount} signalements d'utilisateurs ouverts.` });
    }

    return {
      overview: {
        usersCount,
        creatorsCount,
        podcastsCount,
        episodesCount,
        unclaimedPodcastsCount,
        pendingClaimsCount,
        openReportsCount,
        rssErrorsCount,
        mediaErrorsCount,
      },
      podcastsByCountry: podcastsByCountryRaw.map((p) => ({ countryId: p.countryId, count: p._count.id })),
      podcastsByLanguage: podcastsByLanguageRaw.map((p) => ({ languageCode: p.primaryLanguageCode, count: p._count.id })),
      alerts,
    };
  }
}
