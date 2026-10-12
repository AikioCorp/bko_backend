import { SsrfProtectionService } from "./src/services/ssrf-protection.service.js";
import { RssParserService } from "./src/modules/rss/rss-parser.service.js";

async function testOne(url: string) {
  try {
    const res = await SsrfProtectionService.safeFetch(url);
    const parsed = RssParserService.parseXml(res.text);
    console.log(`✅ [OK] "${parsed.title}" (Items: ${parsed.items.length})`);
  } catch (e: any) {
    console.log(`❌ [ERR] ${url}: ${e.message}`);
  }
}

testOne("https://feed.ausha.co/B4L18FD3Zw38");
