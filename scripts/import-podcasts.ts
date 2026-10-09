import { RssParserService } from "../src/modules/rss/rss-parser.service.js";
import { SsrfProtectionService } from "../src/services/ssrf-protection.service.js";
import { prisma } from "../src/config/prisma.js";

async function importPodcast(url: string) {
  console.log(`Importing: ${url}`);
  try {
    const fetchResult = await SsrfProtectionService.safeFetch(url);
    if (fetchResult.status !== 200) throw new Error(`HTTP ${fetchResult.status}`);
    const parsed = RssParserService.parseXml(fetchResult.text);

    const slugBase = parsed.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const slug = `${slugBase}-${Date.now()}`;

    const { podcast, rssFeed } = await prisma.$transaction(async (tx) => {
      const p = await tx.podcast.create({
        data: {
          name: parsed.title,
          slug,
          description: parsed.description || "",
          cover: parsed.image || "",
          primaryLanguageCode: "fr",
          countryId: "ML",
          status: "DRAFT",
          creationSource: "ADMIN",
          ownershipStatus: "UNCLAIMED",
          managedByBamakoPodcast: false
        }
      });

      const r = await tx.rssFeed.create({
        data: {
          url,
          podcastId: p.id,
          syncStatus: "PENDING",
          syncEnabled: true,
          sourceAuthor: parsed.author || null,
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

    console.log(`✅ Queued import for ${parsed.title} (Podcast ID: ${podcast.id})`);
  } catch (e) {
    console.error(`❌ Failed to import ${url}:`, e);
  }
}

async function main() {
  const urls = [
    "https://feed.ausha.co/26gAqHq3G9nR",
    "https://feeds.acast.com/public/shows/660e40a0acbcaf0017522be9",
    "https://feed.ausha.co/RD65jCX6l8Dq",
    "https://feed.ausha.co/3PK66SPpXQ2R",
    "https://revolutiondescoeurs.lepodcast.fr/rss"
  ];

  for (const url of urls) {
    await importPodcast(url);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
