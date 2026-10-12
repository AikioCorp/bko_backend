import { SsrfProtectionService } from "./src/services/ssrf-protection.service.js";
import { RssParserService } from "./src/modules/rss/rss-parser.service.js";

const feeds = [
  "https://feeds.podcastics.com/podcastics/podcasts/rss/6502_bf5d1df5869f5a743f013f341177e5b0.rss", // Les Femmes Capables
  "https://feeds.acast.com/public/shows/621dd33a14afa4001277dedb", // Afrotopiques
  "https://feeds.audiomeans.fr/feed/b4a5ee3a-9230-4f9f-988d-2ae156a2d5a9.xml", // GDIY
  "https://feeds.acast.com/public/shows/66057de88268a800162cadf2", // Choses a savoir
  "https://feeds.acast.com/public/shows/65294b6074eb720012379a6a", // InPower
  "https://feeds.audiomeans.fr/feed/f02d124c-01fa-4ddc-a6fe-9363f52c58bc.xml", // Transfert
  "https://anchor.fm/s/6b3296bc/podcast/rss", // Afrique Santé
  "https://feed.ausha.co/yOAjZqcKX2pw" // Le Grand Forum
];

async function testFeeds() {
  for (const url of feeds) {
    try {
      const res = await SsrfProtectionService.safeFetch(url);
      const parsed = RssParserService.parseXml(res.text);
      console.log(`✅ [OK] "${parsed.title}" (Items: ${parsed.items.length})`);
    } catch (e: any) {
      console.log(`❌ [ERR] ${url}: ${e.message}`);
    }
  }
}

testFeeds();
