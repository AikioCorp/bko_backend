import { PersonalizationEngineService } from "../src/modules/recommendations/personalization-engine.service.js";
import { EpisodeService } from "../src/modules/episodes/episode.service.js";
import { PodcastService } from "../src/modules/podcasts/podcast.service.js";
import { prisma } from "../src/config/prisma.js";

async function run() {
  console.log("=== TEST SUITE: DISCOVERY CONTEXT & FILTERS END-TO-END ===");

  try {
    // 1. Get visitor sections
    console.log("1. Récupération des sections de recommandations visiteur...");
    const batch = await PersonalizationEngineService.getPersonalizedHome();

    console.log(`✓ Nombre total de sections reçues : ${batch.sections.length}`);
    if (batch.sections.length < 5) {
      throw new Error(`Attendu au moins 5 sections avec du contenu en base, reçu : ${batch.sections.length}`);
    }

    // 2. Vérifier que chaque section possède son discoveryContext complet
    console.log("2. Vérification des discoveryContext de chaque section...");
    for (const sec of batch.sections) {
      if (!sec.discoveryContext) {
        throw new Error(`Section sans discoveryContext : ${sec.slug} (${sec.title})`);
      }
      if (!sec.discoveryContext.targetUrl || !sec.discoveryContext.targetUrl.startsWith("/explore")) {
        throw new Error(`targetUrl invalide pour ${sec.slug} : ${sec.discoveryContext.targetUrl}`);
      }
      console.log(`  ✓ [${sec.slug}] -> ${sec.discoveryContext.targetUrl} (view: ${sec.discoveryContext.view})`);
    }

    // 3. Tester les filtres du catalogue Episode avec les contextes réels
    console.log("3. Test du catalogue Épisodes avec filtres...");
    const shortEpisodes = await EpisodeService.getCatalogEpisodes({
      duration: "SHORT",
      limit: 5,
    });
    console.log(`  ✓ Format court (<20 min) : ${shortEpisodes.episodes.length} épisode(s) trouvé(s)`);

    const popularEpisodes = await EpisodeService.getCatalogEpisodes({
      sort: "popular",
      limit: 5,
    });
    console.log(`  ✓ Tri populaire : ${popularEpisodes.episodes.length} épisode(s) trouvé(s)`);

    const oldestEpisodes = await EpisodeService.getCatalogEpisodes({
      sort: "oldest",
      limit: 5,
    });
    console.log(`  ✓ Tri anciens (début émission) : ${oldestEpisodes.episodes.length} épisode(s) trouvé(s)`);

    // 4. Tester le catalogue Podcasts avec filtres
    console.log("4. Test du catalogue Podcasts...");
    const popularPodcasts = await PodcastService.getPodcasts({
      sort: "popular",
      limit: 5,
    });
    console.log(`  ✓ Podcasts populaires : ${popularPodcasts.data.length} émission(s) trouvée(s)`);

    console.log("\n✅ TOUS LES TESTS DISCOVERY CONTEXT ONT RÉUSSI AVEC SUCCÈS !");
  } catch (err) {
    console.error("❌ Échec des tests :", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
