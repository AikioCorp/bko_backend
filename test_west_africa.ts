import { SsrfProtectionService } from "./src/services/ssrf-protection.service.js";
import { RssParserService } from "./src/modules/rss/rss-parser.service.js";

const testList = [
  "https://www.ankataa.com/basicbambarapodcast-blog?format=rss",
  "https://the-sahel-untold.podigee.io/feed/mp3",
  "https://anchor.fm/s/3e9737c0/podcast/rss",
  "https://feeds.acast.com/public/shows/65b8e90cdfd9eb0015e2e6cd",
  "https://feeds.megaphone.fm/afrobeats-intelligence",
  "https://anchor.fm/s/114238e48/podcast/rss",
  "https://feeds.fexingo.com/history/the-mali-empire.xml",
  "https://feeds.acast.com/public/shows/62e25976555dfd001285fe2f"
];

async function run() {
  for (const url of testList) {
    try {
      const res = await SsrfProtectionService.safeFetch(url);
      const parsed = RssParserService.parseXml(res.text);
      console.log(`✅ [OK] "${parsed.title}" (Items: ${parsed.items.length})`);
    } catch (e: any) {
      console.log(`❌ [ERR] ${url}: ${e.message}`);
    }
  }
}

run();
