import { prisma } from '../src/config/prisma.js';

async function main() {
  const result = await prisma.$queryRawUnsafe(`
    SELECT e.title AS episode_title, e.slug AS episode_slug, p.title AS podcast_title, p.slug AS podcast_slug 
    FROM episodes e 
    JOIN podcasts p ON e.podcast_id = p.id 
    WHERE p.title ILIKE '%senegal%' OR e.title ILIKE '%senegal%' OR e.description ILIKE '%senegal%' OR p.title ILIKE '%sénégal%' OR e.title ILIKE '%sénégal%' OR e.description ILIKE '%sénégal%' 
    LIMIT 2;
  `);

  console.log('Senegal query succeeded:', result);
}

main().catch(console.error).finally(() => prisma.$disconnect());
