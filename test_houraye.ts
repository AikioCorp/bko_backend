import { SsrfProtectionService } from "./src/services/ssrf-protection.service.js";
import { RssParserService } from "./src/modules/rss/rss-parser.service.js";

async function testHouraye() {
  const url = "https://feeds.soundcloud.com/users/soundcloud:users:805672876/sounds.rss";
  try {
    const res = await SsrfProtectionService.safeFetch(url);
    const parsed = RssParserService.parseXml(res.text);
    console.log(`✅ [OK] "${parsed.title}" (Items: ${parsed.items.length})`);
  } catch (e: any) {
    console.log(`❌ [ERR]: ${e.message}`);
  }
}

testHouraye();
