import { PrismaClient } from '@prisma/client';
import { RssParserService } from './src/modules/rss/rss-parser.service.js';

const db = new PrismaClient();

function slugify(text: string) {
  return text.toString().toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  console.log("Démarrage de la mise à jour rétroactive des thématiques...");
  const feeds = await db.rssFeed.findMany();
  
  let episodesUpdated = 0;
  let topicsAdded = 0;

  for (const feed of feeds) {
    console.log(`Analyse du flux: ${feed.url}`);
    try {
      const res = await fetch(feed.url);
      const xmlText = await res.text();
      const parsed = RssParserService.parseXml(xmlText);
      for (const item of parsed.items) {
        if (!item.keywords || item.keywords.length === 0) continue;
        
        const imported = await db.rssImportedEpisode.findFirst({
          where: { rssFeedId: feed.id, guid: item.guid },
        });

        if (imported && imported.localEpisodeId) {
          let updatedThisEpisode = false;
          
          for (const keyword of item.keywords) {
            const kSlug = slugify(keyword);
            if (!kSlug) continue;
            
            let topic = await db.topic.findUnique({ where: { slug: kSlug } });
            if (!topic) {
              topic = await db.topic.create({ data: { name: keyword, slug: kSlug } });
            }
            
            // Check if link exists
            const link = await db.episodeTopic.findUnique({
              where: { episodeId_topicId: { episodeId: imported.localEpisodeId, topicId: topic.id } }
            });
            
            if (!link) {
              await db.episodeTopic.create({
                data: { episodeId: imported.localEpisodeId, topicId: topic.id }
              });
              topicsAdded++;
              updatedThisEpisode = true;
            }
          }
          if (updatedThisEpisode) episodesUpdated++;
        }
      }
    } catch (err: any) {
      console.error(`Erreur sur le flux ${feed.url}:`, err.message);
    }
  }
  
  console.log(`Terminé ! ${topicsAdded} mots-clés ont été rattachés rétroactivement sur ${episodesUpdated} épisodes existants.`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await db.$disconnect();
    process.exit(0);
  });
