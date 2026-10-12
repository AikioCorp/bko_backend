import { SsrfProtectionService } from "../src/services/ssrf-protection.service.js";
import { RssParserService } from "../src/modules/rss/rss-parser.service.js";
import { prisma } from "../src/config/prisma.js";

interface SearchTask {
  sector: string;
  catId: string;
  queries: string[];
}

const tasks: SearchTask[] = [
  {
    sector: "Comédie & Humour",
    catId: "cmv0xd04m0003uy9yelezqzbl",
    queries: ["Gondwana", "humour africain", "Mamane", "comedie afrique", "stand up afrique", "humour abidjan", "rire afrique"]
  },
  {
    sector: "Éducation & Apprentissage",
    catId: "cmv0xd0sh0006uy9yk98urumg",
    queries: ["etudes en afrique", "etudiants africains", "education afrique", "apprendre bambara", "campus afrique", "afrique apprentissage", "pedagogie afrique"]
  },
  {
    sector: "Politique & Débats",
    catId: "cmv0xd0kl0005uy9yjcn0d647",
    queries: ["WADR", "geopolitique afrique", "debat afrique", "afrique politique", "sahel debat", "democratie afrique", "gouvernance afrique"]
  },
  {
    sector: "Sport & Jeunesse",
    catId: "cmura533e000hv53obxufstwa",
    queries: ["football africain", "sport afrique", "CAN football", "talents afrique", "afrik foot", "ballon rond afrique", "afrique sports"]
  },
  {
    sector: "Tradition Orale & Contes",
    catId: "cmv0xczwp0002uy9y59vfb3ks",
    queries: ["contes africains", "contes dafrique", "legendes africaines", "mythes africains", "griots", "mandingue", "paroles dafrique"]
  },
  {
    sector: "Agriculture & Environnement",
    catId: "cmv0xd10e0007uy9ycwn31l2e",
    queries: ["agriculture africaine", "agrobusiness afrique", "paysans afrique", "climat afrique", "environnement afrique", "sahel environnement", "agroecologie afrique"]
  }
];

async function main() {
  const existingUrls = new Set((await prisma.rssFeed.findMany({ select: { url: true } })).map(f => f.url));
  const existingNames = new Set((await prisma.podcast.findMany({ select: { name: true } })).map(p => p.name.toLowerCase()));

  console.log("=== RECHERCHE CIBLÉE PAR SECTEUR ===");

  for (const t of tasks) {
    console.log(`\n========================================`);
    console.log(`🎯 SECTEUR : ${t.sector}`);
    console.log(`========================================`);
    const found: any[] = [];

    for (const q of t.queries) {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=podcast&country=FR&limit=15`;
      try {
        const resp = await fetch(itunesUrl);
        const data = await resp.json();
        for (const item of (data.results || [])) {
          const feedUrl = item.feedUrl;
          const trackName = item.trackName;
          if (!feedUrl || !trackName) continue;
          if (existingUrls.has(feedUrl)) continue;
          if (existingNames.has(trackName.toLowerCase())) continue;
          if (found.some(x => x.feedUrl === feedUrl || x.title.toLowerCase() === trackName.toLowerCase())) continue;

          try {
            const fetchRes = await SsrfProtectionService.safeFetch(feedUrl);
            const parsed = RssParserService.parseXml(fetchRes.text);
            if (parsed.items.length >= 2) {
              const fullText = `${parsed.title} ${parsed.description}`.toLowerCase();
              // Check if relevant to Africa / West Africa / Sahel / target sector
              found.push({
                title: parsed.title,
                feedUrl,
                episodes: parsed.items.length,
                author: parsed.author || item.artistName,
                desc: parsed.description.substring(0, 160).replace(/\n/g, ' '),
                image: parsed.image || item.artworkUrl600,
                catId: t.catId
              });
              console.log(`  * [${parsed.items.length} eps] ${parsed.title} (${parsed.author || item.artistName})`);
              console.log(`    URL: ${feedUrl}`);
              console.log(`    DESC: ${parsed.description.substring(0, 120).replace(/\n/g, ' ')}...`);
            }
          } catch (e: any) {
            // failed fetch/ssrf
          }
        }
      } catch (e: any) {
        console.error(`Erreur query "${q}":`, e.message);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
