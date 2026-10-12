import { RssParserService } from "../src/modules/rss/rss-parser.service.js";
import { SsrfProtectionService } from "../src/services/ssrf-protection.service.js";
import { prisma } from "../src/config/prisma.js";

interface PodcastToImport {
  titleHint: string;
  url: string;
  categoryId: string;
  countryId: string;
  languageCode: string;
}

const list: PodcastToImport[] = [
  {
    titleHint: "Basic Bambara",
    url: "https://www.ankataa.com/basicbambarapodcast-blog?format=rss",
    categoryId: "cmv0xd0sh0006uy9yk98urumg", // Éducation & Apprentissage
    countryId: "ML",
    languageCode: "bm"
  },
  {
    titleHint: "The Sahel Untold",
    url: "https://the-sahel-untold.podigee.io/feed/mp3",
    categoryId: "cmura52wy000fv53oz63vn9go", // Culture & Société
    countryId: "ML",
    languageCode: "fr"
  },
  {
    titleHint: "GuineeCheck",
    url: "https://anchor.fm/s/3e9737c0/podcast/rss",
    categoryId: "cmura539t000jv53ogrg4cejt", // Actualité & Médias
    countryId: "GN",
    languageCode: "fr"
  },
  {
    titleHint: "I Said What I Said (ISWIS)",
    url: "https://feeds.acast.com/public/shows/65b8e90cdfd9eb0015e2e6cd",
    categoryId: "cmv0xd04m0003uy9yelezqzbl", // Comédie & Humour
    countryId: "NG",
    languageCode: "en"
  },
  {
    titleHint: "Afrobeats Intelligence",
    url: "https://feeds.megaphone.fm/afrobeats-intelligence",
    categoryId: "cmura536l000iv53oa54bxqlj", // Musique & Création
    countryId: "NG",
    languageCode: "en"
  },
  {
    titleHint: "The Flip",
    url: "https://anchor.fm/s/114238e48/podcast/rss",
    categoryId: "cmura5306000gv53obg6sjvfa", // Innovation & Technologie
    countryId: "NG",
    languageCode: "en"
  },
  {
    titleHint: "The Mali Empire: The Richest Civilization in History",
    url: "https://feeds.fexingo.com/history/the-mali-empire.xml",
    categoryId: "cmv0xczos0001uy9ys6ippu5v", // Histoire & Patrimoine
    countryId: "ML",
    languageCode: "en"
  },
  {
    titleHint: "Tea With Tay Podcast",
    url: "https://feeds.acast.com/public/shows/62e25976555dfd001285fe2f",
    categoryId: "cmuzhdd500005kmw7psq2fhsh", // Podcast Interview
    countryId: "NG",
    languageCode: "en"
  }
];

async function main() {
  for (const item of list) {
    console.log(`Processing: ${item.titleHint} (${item.url})`);

    const existingFeed = await prisma.rssFeed.findFirst({
      where: { url: item.url }
    });

    if (existingFeed) {
      console.log(`⚠️ Already imported: ${item.titleHint}`);
      continue;
    }

    try {
      const fetchResult = await SsrfProtectionService.safeFetch(item.url);
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
            primaryLanguageCode: item.languageCode,
            countryId: item.countryId,
            status: "PUBLISHED",
            creationSource: "ADMIN",
            ownershipStatus: "UNCLAIMED",
            managedByBamakoPodcast: false,
            categories: {
              create: [
                { categoryId: item.categoryId }
              ]
            }
          }
        });

        const r = await tx.rssFeed.create({
          data: {
            url: item.url,
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

      console.log(`✅ Queued import for "${podcast.name}" [ID: ${podcast.id}] | Cat: ${item.categoryId} | Country: ${item.countryId} | Lang: ${item.languageCode}`);
    } catch (err: any) {
      console.error(`❌ Error importing ${item.titleHint}:`, err.message || err);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
