import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

function slugify(text: string) {
  return text.toString().toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  console.log("Ajout de thématiques d'exemple...");
  
  const episodes = await db.episode.findMany({
    include: { podcast: true }
  });

  for (const ep of episodes) {
    let keywords = ["Podcast", "Afrique"];
    
    // Simple logique pour donner des mots-clés selon le podcast
    const pName = ep.podcast.name.toLowerCase();
    const eTitle = ep.title.toLowerCase();
    
    if (pName.includes("vox") || pName.includes("tech") || eTitle.includes("tech") || eTitle.includes("ia") || eTitle.includes("digital")) {
      keywords.push("Technologie", "Innovation", "Startup");
    } else if (pName.includes("bar") || pName.includes("culture") || eTitle.includes("culture")) {
      keywords.push("Culture", "Société", "Débat");
    } else {
      keywords.push("Actualité", "Découverte");
    }

    for (const keyword of keywords) {
      const kSlug = slugify(keyword);
      if (!kSlug) continue;
      
      let topic = await db.topic.findUnique({ where: { slug: kSlug } });
      if (!topic) {
        topic = await db.topic.create({ data: { name: keyword, slug: kSlug } });
      }
      
      // Check if link exists
      const link = await db.episodeTopic.findUnique({
        where: { episodeId_topicId: { episodeId: ep.id, topicId: topic.id } }
      });
      
      if (!link) {
        await db.episodeTopic.create({
          data: { episodeId: ep.id, topicId: topic.id }
        });
      }
    }
    console.log(`- Épisode "${ep.title}" -> ${keywords.join(', ')}`);
  }
  
  console.log("Terminé ! Des thématiques ont été ajoutées pour faire de belles démonstrations.");
}

main()
  .catch(console.error)
  .finally(async () => {
    await db.$disconnect();
    process.exit(0);
  });
