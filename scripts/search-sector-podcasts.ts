import { SsrfProtectionService } from "../src/services/ssrf-protection.service.js";
import { RssParserService } from "../src/modules/rss/rss-parser.service.js";
import { prisma } from "../src/config/prisma.js";

interface QuerySector {
  sector: string;
  catId: string;
  queries: string[];
}

const sectors: QuerySector[] = [
  {
    sector: "Comédie & Humour",
    catId: "cmv0xd04m0003uy9yelezqzbl",
    queries: [
      "humour afrique",
      "comedie africaine",
      "humour senegal",
      "humour abidjan",
      "stand up afrique",
      "afrique rigole",
      "chronique humour afrique"
    ]
  },
  {
    sector: "Éducation & Apprentissage",
    catId: "cmv0xd0sh0006uy9yk98urumg",
    queries: [
      "education afrique",
      "etudes en afrique",
      "apprendre le bamanankan",
      "langues africaines",
      "vulgarisation afrique",
      "recherche afrique",
      "campus afrique"
    ]
  },
  {
    sector: "Politique & Débats",
    catId: "cmv0xd0kl0005uy9yjcn0d647",
    queries: [
      "politique afrique",
      "debat afrique",
      "sahel politique",
      "geopolitique afrique",
      "afrique citoyens",
      "afrique de louest debat",
      "democratie afrique"
    ]
  },
  {
    sector: "Sport & Jeunesse",
    catId: "cmura533e000hv53obxufstwa",
    queries: [
      "football afrique",
      "sport afrique",
      "can afrique football",
      "ballon afrique",
      "jeunesse et sport afrique",
      "afrique sport podcast"
    ]
  },
  {
    sector: "Tradition Orale & Contes",
    catId: "cmv0xczwp0002uy9y59vfb3ks",
    queries: [
      "contes afrique",
      "contes africains",
      "tradition orale afrique",
      "legendes africaines",
      "griots afrique",
      "mythes afrique",
      "histoire mandingue"
    ]
  },
  {
    sector: "Agriculture & Environnement",
    catId: "cmv0xd10e0007uy9ycwn31l2e",
    queries: [
      "agriculture afrique",
      "agrobusiness afrique",
      "environnement afrique",
      "climat sahel",
      "ecologie afrique",
      "elevage afrique",
      "paysans afrique"
    ]
  }
];

async function main() {
  const existingFeeds = new Set((await prisma.rssFeed.findMany({ select: { url: true } })).map(f => f.url));
  const existingPodcasts = new Set((await prisma.podcast.findMany({ select: { name: true } })).map(p => p.name.toLowerCase()));

  console.log(`Podcasts existants: ${existingPodcasts.size}, Flux existants: ${existingFeeds.size}`);

  const candidates: any[] = [];

  for (const s of sectors) {
    console.log(`\n🔍 Recherche pour secteur : ${s.sector}...`);
    const foundForSector: any[] = [];

    for (const q of s.queries) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=podcast&country=FR&limit=15`;
      try {
        const resp = await fetch(url);
        const data = await resp.json();
        for (const item of (data.results || [])) {
          const feedUrl = item.feedUrl;
          const trackName = item.trackName;
          if (!feedUrl || !trackName) continue;
          if (existingFeeds.has(feedUrl)) continue;
          if (existingPodcasts.has(trackName.toLowerCase())) continue;
          if (foundForSector.some(c => c.feedUrl === feedUrl || c.trackName.toLowerCase() === trackName.toLowerCase())) continue;

          // Test feed
          try {
            const fetchRes = await SsrfProtectionService.safeFetch(feedUrl);
            const parsed = RssParserService.parseXml(fetchRes.text);
            if (parsed.items.length > 0) {
              // check if French or related to Africa
              const textContent = `${parsed.title} ${parsed.description}`.toLowerCase();
              foundForSector.push({
                sector: s.sector,
                catId: s.catId,
                trackName: parsed.title,
                feedUrl,
                itemsCount: parsed.items.length,
                description: parsed.description.slice(0, 150),
                image: parsed.image || item.artworkUrl600,
                author: parsed.author || item.artistName
              });
              console.log(`  [+] Trouvé pour ${s.sector}: "${parsed.title}" (${parsed.items.length} épisodes)`);
            }
          } catch (e: any) {
            // failed fetch or ssrf
          }
        }
      } catch (err: any) {
        console.error(`Erreur recherche "${q}":`, err.message);
      }
    }
    candidates.push(...foundForSector);
  }

  console.log(`\n✨ TOTAL CANDIDATS TROUVÉS : ${candidates.length}`);
  console.log(JSON.stringify(candidates, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
