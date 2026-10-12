import { SsrfProtectionService } from "./src/services/ssrf-protection.service.js";
import { RssParserService } from "./src/modules/rss/rss-parser.service.js";

const candidates = [
  "https://anchor.fm/s/10f903570/podcast/rss",
  "https://anchor.fm/s/63538294/podcast/rss",
  "https://feeds.feedburner.com/FULYA_AWR",
  "https://podcasts.awr.org/xml/WOLDK_AWR.xml",
  "https://feeds.acast.com/public/shows/ce8a4c5c-fd96-4664-97ca-33da2d34df59",
  "https://anchor.fm/s/d41c8ca0/podcast/rss",
  "https://feeds.simplecast.com/HJ8ImVXV",
  "https://www.spreaker.com/show/6813607/episodes/feed",
  "https://anchor.fm/s/4e0331c8/podcast/rss",
  "https://anchor.fm/s/57ae8e5c/podcast/rss",
  "https://anchor.fm/s/22688414/podcast/rss",
  "https://feed.ausha.co/RWd86CQr9WK3",
  "https://anchor.fm/s/3e0d8a0c/podcast/rss",
  "https://anchor.fm/s/1058f2d9c/podcast/rss",
  "https://anchor.fm/s/6bf486c8/podcast/rss",
  "https://anchor.fm/s/1f78aa4/podcast/rss",
  "https://feeds.soundcloud.com/users/soundcloud:users:640800558/sounds.rss",
  "https://feed.ausha.co/qxrNLI1v9rkV",
  "https://feed.ausha.co/qxdQ7F4lmZRX",
  "https://feed.ausha.co/x5RKPsdZDgA7",
  "https://feeds.transistor.fm/odil-le-podcast",
  "https://anchor.fm/s/1053ce848/podcast/rss",
  "https://media.rss.com/generationsn/feed.xml",
  "https://anchor.fm/s/6f3eb664/podcast/rss",
  "https://api.riverside.com/hosting/ovie6yWw.rss",
  "https://rss.buzzsprout.com/2538204.rss",
  "https://anchor.fm/s/420336d4/podcast/rss",
  "https://anchor.fm/s/f43e2c0/podcast/rss",
  "https://anchor.fm/s/e189deec/podcast/rss",
  "https://anchor.fm/s/5a4b6e0/podcast/rss",
  "http://feeds.feedburner.com/afropop/podcast",
  "https://feed.podbean.com/shethrivespodcast/feed.xml",
  "https://anchor.fm/s/253945c0/podcast/rss",
  "https://anchor.fm/s/597a270/podcast/rss",
  "https://anchor.fm/s/1061e786c/podcast/rss",
  "https://anchor.fm/s/11e96234/podcast/rss",
  "https://anchor.fm/s/c01d2700/podcast/rss"
];

async function main() {
  console.log(`Testing ${candidates.length} candidate feeds...`);
  let valid = 0;
  let invalid = 0;
  for (const url of candidates) {
    try {
      const res = await SsrfProtectionService.safeFetch(url);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const parsed = RssParserService.parseXml(res.text);
      if (!parsed.title) throw new Error("No title");
      console.log(`✅ [OK] "${parsed.title}" (${parsed.items.length} eps) -> ${url}`);
      valid++;
    } catch (e: any) {
      console.log(`❌ [ERR] ${e.message} -> ${url}`);
      invalid++;
    }
  }
  console.log(`\nRESULTS: ${valid} valid, ${invalid} invalid`);
}

main();
