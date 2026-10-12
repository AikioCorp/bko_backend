import { RssParserService } from "../src/modules/rss/rss-parser.service.js";
import { SsrfProtectionService } from "../src/services/ssrf-protection.service.js";
import { prisma } from "../src/config/prisma.js";

async function importHouraye() {
  const url = "https://feeds.soundcloud.com/users/soundcloud:users:805672876/sounds.rss";
  console.log("Importing Houraye Dieye...");
  const fetchResult = await SsrfProtectionService.safeFetch(url);
  const parsed = RssParserService.parseXml(fetchResult.text);

  const slug = `le-jeu-de-la-vente-${Date.now()}`;

  const { podcast, rssFeed } = await prisma.$transaction(async (tx) => {
    const p = await tx.podcast.create({
      data: {
        name: parsed.title,
        slug,
        description: parsed.description || "",
        cover: parsed.image || "",
        primaryLanguageCode: "fr",
        countryId: "SN",
        status: "PUBLISHED",
        creationSource: "ADMIN",
        ownershipStatus: "UNCLAIMED",
        managedByBamakoPodcast: false,
        categories: {
          create: [{ categoryId: "cmv0xd1g70009uy9yzmzjn9im" }] // Voix de Femmes
        }
      }
    });

    const r = await tx.rssFeed.create({
      data: {
        url,
        podcastId: p.id,
        syncStatus: "PENDING",
        syncEnabled: true,
        sourceAuthor: "Houraye Dieye",
        importSettings: {}
      }
    });

    await tx.jobQueueItem.create({
      data: {
        queueName: "rss-importer",
        jobType: "import-feed",
        payload: { rssFeedId: r.id },
        status: "PENDING",
      }
    });

    return { podcast: p, rssFeed: r };
  });

  console.log(`✅ Import queued for "${podcast.name}" [ID: ${podcast.id}]`);
  await prisma.$disconnect();
}

importHouraye().catch(console.error);
