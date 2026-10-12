import { RssParserService } from "../src/modules/rss/rss-parser.service.js";
import { SsrfProtectionService } from "../src/services/ssrf-protection.service.js";
import { prisma } from "../src/config/prisma.js";

interface PodcastToImport {
  titleHint: string;
  url: string;
  categoryId: string;
  countryId: string;
}

const list: PodcastToImport[] = [
  {
    titleHint: "Les Femmes Capables",
    url: "https://feeds.podcastics.com/podcastics/podcasts/rss/6502_bf5d1df5869f5a743f013f341177e5b0.rss",
    categoryId: "cmv0xd1g70009uy9yzmzjn9im", // Voix de Femmes
    countryId: "CI"
  },
  {
    titleHint: "Afrotopiques",
    url: "https://feeds.acast.com/public/shows/621dd33a14afa4001277dedb",
    categoryId: "cmura52wy000fv53oz63vn9go", // Culture & Société
    countryId: "SN"
  },
  {
    titleHint: "Culture 2000",
    url: "https://feed.ausha.co/B4L18FD3Zw38",
    categoryId: "cmv0xczos0001uy9ys6ippu5v", // Histoire & Patrimoine
    countryId: "FR"
  },
  {
    titleHint: "InPower par Louise Aubery",
    url: "https://feeds.acast.com/public/shows/65294b6074eb720012379a6a",
    categoryId: "cmv0xd0cm0004uy9y6v4feote", // Développement Personnel
    countryId: "FR"
  },
  {
    titleHint: "Transfert",
    url: "https://feeds.audiomeans.fr/feed/f02d124c-01fa-4ddc-a6fe-9363f52c58bc.xml",
    categoryId: "cmura52wy000fv53oz63vn9go", // Culture & Société
    countryId: "FR"
  },
  {
    titleHint: "Afrique Santé",
    url: "https://anchor.fm/s/6b3296bc/podcast/rss",
    categoryId: "cmv0xczcv0000uy9yulfpoaot", // Santé & Bien-être
    countryId: "ML"
  },
  {
    titleHint: "Le Grand Forum - #LGF",
    url: "https://feed.ausha.co/yOAjZqcKX2pw",
    categoryId: "cmv0xd0kl0005uy9yjcn0d647", // Politique & Débats
    countryId: "CI"
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
            primaryLanguageCode: "fr",
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

      console.log(`✅ Queued import for "${podcast.name}" [ID: ${podcast.id}] | Cat: ${item.categoryId} | Country: ${item.countryId} | Lang: fr`);
    } catch (err: any) {
      console.error(`❌ Error importing ${item.titleHint}:`, err.message || err);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
