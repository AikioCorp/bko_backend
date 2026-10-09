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
    "https://media.rss.com/africatechsummit/feed.xml",
    "https://anchor.fm/s/222060e4/podcast/rss",
    "https://anchor.fm/s/2d7d800c/podcast/rss",
    "https://anchor.fm/s/5cbf0674/podcast/rss",
    "https://anchor.fm/s/f2b89ab4/podcast/rss",
    "https://www.spreaker.com/show/4091143/episodes/feed"
  ];

  for (const url of urls) {
    await importPodcast(url);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
