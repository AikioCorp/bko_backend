import { RssParserService } from "../src/modules/rss/rss-parser.service.js";
import { SsrfProtectionService } from "../src/services/ssrf-protection.service.js";
import { RssWorkerService } from "../src/modules/rss/rss-worker.service.js";
import { prisma } from "../src/config/prisma.js";

interface PodcastDef {
  url: string;
  catId: string;
  countryId: string;
  langCode: string;
}

const list: PodcastDef[] = [
  // 1. Sahel & Diaspora Soninké / Peul / Wolof / Sahel
  {
    url: "https://anchor.fm/s/10f903570/podcast/rss", // Soninke Islamic Voice
    catId: "cmv0x6o1w002tookcilewkjhc", // Religion
    countryId: "ML",
    langCode: "bm" // Langue locale du Sahel
  },
  {
    url: "https://anchor.fm/s/63538294/podcast/rss", // Soninke
    catId: "cmura52wy000fv53oz63vn9go", // Culture & Société
    countryId: "ML",
    langCode: "bm"
  },
  {
    url: "https://feeds.feedburner.com/FULYA_AWR", // AWR Fulfulde, Fula, Pulaar
    catId: "cmura52wy000fv53oz63vn9go", // Culture & Société
    countryId: "ML",
    langCode: "pl" // Peul
  },
  {
    url: "https://podcasts.awr.org/xml/WOLDK_AWR.xml", // AWR Wolof
    catId: "cmura52wy000fv53oz63vn9go", // Culture & Société
    countryId: "SN",
    langCode: "fr"
  },
  {
    url: "https://feeds.acast.com/public/shows/ce8a4c5c-fd96-4664-97ca-33da2d34df59", // Le Paris Noir
    catId: "cmura53d0000kv53o0hqw4s11", // Diaspora & Immersion
    countryId: "FR",
    langCode: "fr"
  },
  {
    url: "https://anchor.fm/s/d41c8ca0/podcast/rss", // African Diaspora News Channel
    catId: "cmura53d0000kv53o0hqw4s11", // Diaspora & Immersion
    countryId: "US",
    langCode: "en"
  },
  {
    url: "https://feeds.simplecast.com/HJ8ImVXV", // New Books in African Studies
    catId: "cmv0xd18d0008uy9y88xluc5d", // Arts, Cinéma & Littérature
    countryId: "US",
    langCode: "en"
  },
  {
    url: "https://www.spreaker.com/show/6813607/episodes/feed", // West African Folk Tales
    catId: "cmv0xczwp0002uy9y59vfb3ks", // Tradition Orale & Contes
    countryId: "ML",
    langCode: "en"
  },

  // 2. Burkina Faso / Guinée / Côte d'Ivoire / Sénégal (Francophone)
  {
    url: "https://anchor.fm/s/4e0331c8/podcast/rss", // FATWAS ISLAMIQUE AU BURKINA FASO
    catId: "cmv0x6o1w002tookcilewkjhc", // Religion
    countryId: "BF",
    langCode: "fr"
  },
  {
    url: "https://anchor.fm/s/57ae8e5c/podcast/rss", // ISLAM AU BURKINA FASO
    catId: "cmv0x6o1w002tookcilewkjhc", // Religion
    countryId: "BF",
    langCode: "fr"
  },
  {
    url: "https://feed.ausha.co/RWd86CQr9WK3", // Le 8ème jour
    catId: "cmv0xd0kl0005uy9yjcn0d647", // Politique & Débats
    countryId: "CI",
    langCode: "fr"
  },
  {
    url: "https://anchor.fm/s/3e0d8a0c/podcast/rss", // Littérature Africaine
    catId: "cmv0xd18d0008uy9y88xluc5d", // Arts, Cinéma & Littérature
    countryId: "SN",
    langCode: "fr"
  },
  {
    url: "https://anchor.fm/s/1058f2d9c/podcast/rss", // Le Salon Du Livre - Littérature africaine
    catId: "cmv0xd18d0008uy9y88xluc5d", // Arts, Cinéma & Littérature
    countryId: "CI",
    langCode: "fr"
  },
  {
    url: "https://anchor.fm/s/6bf486c8/podcast/rss", // Oser Leader Podcast
    catId: "cmv0xd0cm0004uy9y6v4feote", // Développement Personnel
    countryId: "SN",
    langCode: "fr"
  },
  {
    url: "https://anchor.fm/s/1f78aa4/podcast/rss", // Le Jeune Entrepreneur Africain
    catId: "cmura52qi000ev53o5ri1rhod", // Business & Entrepreneuriat
    countryId: "CI",
    langCode: "fr"
  },
  {
    url: "https://feed.ausha.co/qxrNLI1v9rkV", // Creatips
    catId: "cmura52qi000ev53o5ri1rhod", // Business & Entrepreneuriat
    countryId: "CI",
    langCode: "fr"
  },
  {
    url: "https://feed.ausha.co/qxdQ7F4lmZRX", // Orange Lab B2B
    catId: "cmura5306000gv53obg6sjvfa", // Innovation & Technologie
    countryId: "CI",
    langCode: "fr"
  },
  {
    url: "https://feed.ausha.co/x5RKPsdZDgA7", // Pour Chaque Enfant
    catId: "cmura52wy000fv53oz63vn9go", // Culture & Société
    countryId: "CI",
    langCode: "fr"
  },
  {
    url: "https://feeds.transistor.fm/odil-le-podcast", // ODIL Le Podcast
    catId: "cmura539t000jv53ogrg4cejt", // Actualité & Médias
    countryId: "ML",
    langCode: "fr"
  },
  {
    url: "https://anchor.fm/s/1053ce848/podcast/rss", // Echoes of Senegal
    catId: "cmv0xczos0001uy9ys6ippu5v", // Histoire & Patrimoine
    countryId: "SN",
    langCode: "fr"
  },
  {
    url: "https://media.rss.com/generationsn/feed.xml", // Jamonoy Taay / sunu senegal
    catId: "cmura52wy000fv53oz63vn9go", // Culture & Société
    countryId: "SN",
    langCode: "fr"
  },

  // 3. Afrique de l'Ouest Anglophone & Diaspora (Nigéria, Ghana)
  {
    url: "https://anchor.fm/s/6f3eb664/podcast/rss", // Founders Connect
    catId: "cmura52qi000ev53o5ri1rhod", // Business & Entrepreneuriat
    countryId: "NG",
    langCode: "en"
  },
  {
    url: "https://api.riverside.com/hosting/ovie6yWw.rss", // The Sound of Accra Podcast
    catId: "cmura52qi000ev53o5ri1rhod", // Business & Entrepreneuriat
    countryId: "GH",
    langCode: "en"
  },
  {
    url: "https://rss.buzzsprout.com/2538204.rss", // African Football Pulse
    catId: "cmura533e000hv53obxufstwa", // Sport & Jeunesse
    countryId: "NG",
    langCode: "en"
  },
  {
    url: "https://anchor.fm/s/420336d4/podcast/rss", // JotNaija Podcast
    catId: "cmura536l000iv53oa54bxqlj", // Musique & Création
    countryId: "NG",
    langCode: "en"
  },
  {
    url: "https://anchor.fm/s/f43e2c0/podcast/rss", // RAP CITY NAIJA PODCAST
    catId: "cmura536l000iv53oa54bxqlj", // Musique & Création
    countryId: "NG",
    langCode: "en"
  },
  {
    url: "https://anchor.fm/s/e189deec/podcast/rss", // ALICE IN LAGOS PODCAST
    catId: "cmv0xd0cm0004uy9y6v4feote", // Développement Personnel
    countryId: "NG",
    langCode: "en"
  },
  {
    url: "https://anchor.fm/s/5a4b6e0/podcast/rss", // The Muyiwa Lagos Podcast
    catId: "cmura52qi000ev53o5ri1rhod", // Business & Entrepreneuriat
    countryId: "NG",
    langCode: "en"
  },
  {
    url: "http://feeds.feedburner.com/afropop/podcast", // Afropop Worldwide
    catId: "cmura536l000iv53oa54bxqlj", // Musique & Création
    countryId: "ML",
    langCode: "en"
  },
  {
    url: "https://feed.podbean.com/shethrivespodcast/feed.xml", // She Thrives
    catId: "cmv0xd1g70009uy9yzmzjn9im", // Voix de Femmes
    countryId: "NG",
    langCode: "en"
  },
  {
    url: "https://anchor.fm/s/253945c0/podcast/rss", // African Women in Europe Podcast
    catId: "cmura53d0000kv53o0hqw4s11", // Diaspora & Immersion
    countryId: "UK",
    langCode: "en"
  },
  {
    url: "https://anchor.fm/s/597a270/podcast/rss", // Dads Dey: The African Fatherhood Podcast
    catId: "cmv0xd0sh0006uy9yk98urumg", // Éducation & Apprentissage
    countryId: "GH",
    langCode: "en"
  },
  {
    url: "https://anchor.fm/s/1061e786c/podcast/rss", // Suite Ghana Podcast
    catId: "cmura52wy000fv53oz63vn9go", // Culture & Société
    countryId: "GH",
    langCode: "en"
  },
  {
    url: "https://anchor.fm/s/11e96234/podcast/rss", // Ghana Podcast
    catId: "cmura539t000jv53ogrg4cejt", // Actualité & Médias
    countryId: "GH",
    langCode: "en"
  },
  {
    url: "https://anchor.fm/s/c01d2700/podcast/rss", // Backend by Gerald Black
    catId: "cmura5306000gv53obg6sjvfa", // Innovation & Technologie
    countryId: "NG",
    langCode: "en"
  }
];

async function main() {
  console.log(`Starting import for ${list.length} shows...`);
  let importedCount = 0;

  for (const item of list) {
    const existing = await prisma.rssFeed.findFirst({
      where: { url: item.url }
    });

    if (existing) {
      console.log(`⏩ Skipping existing: ${item.url}`);
      continue;
    }

    try {
      const res = await SsrfProtectionService.safeFetch(item.url);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const parsed = RssParserService.parseXml(res.text);

      const slugBase = parsed.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const slug = `${slugBase}-${Date.now()}`;

      await prisma.$transaction(async (tx) => {
        const p = await tx.podcast.create({
          data: {
            name: parsed.title,
            slug,
            description: parsed.description || "",
            cover: parsed.image || "",
            primaryLanguageCode: item.langCode,
            countryId: item.countryId,
            status: "PUBLISHED",
            creationSource: "ADMIN",
            ownershipStatus: "UNCLAIMED",
            managedByBamakoPodcast: false,
            categories: {
              create: [{ categoryId: item.catId }]
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
            status: "PENDING"
          }
        });
      });

      importedCount++;
      console.log(`✅ [${importedCount}] Created & Queued: "${parsed.title}" (${item.langCode}/${item.countryId})`);
    } catch (err: any) {
      console.error(`❌ Failed ${item.url}:`, err.message);
    }
  }

  console.log(`\n🎉 Total newly imported: ${importedCount}`);

  // Now process queued jobs
  console.log("⚡ Processing queued RSS episode imports...");
  let jobsDone = 0;
  while (true) {
    const processed = await RssWorkerService.processNextJob();
    if (!processed) break;
    jobsDone++;
    if (jobsDone % 5 === 0) console.log(`Processed ${jobsDone} jobs...`);
  }

  console.log(`🏁 All done! Processed ${jobsDone} RSS import jobs.`);
  await prisma.$disconnect();
}

main().catch(console.error);
