import { prisma } from '../src/config/prisma.js';

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE VIEW episodes AS 
    SELECT 
      id, 
      title, 
      slug, 
      description, 
      "podcastId" AS podcast_id, 
      "podcastId",
      status, 
      "publishedAt" AS published_at 
    FROM "Episode";
  `);
  console.log('View "episodes" created/updated.');

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE VIEW podcasts AS 
    SELECT 
      id, 
      name AS title, 
      name, 
      slug, 
      description, 
      status 
    FROM "Podcast";
  `);
  console.log('View "podcasts" created/updated.');

  // Test the exact query Gemini tried to run!
  const result = await prisma.$queryRawUnsafe(`
    SELECT e.title AS episode_title, e.slug AS episode_slug, p.title AS podcast_title, p.slug AS podcast_slug 
    FROM episodes e 
    JOIN podcasts p ON e.podcast_id = p.id 
    WHERE p.title ILIKE '%afro%' OR e.title ILIKE '%afro%' 
    LIMIT 2;
  `);

  console.log('Test query succeeded:', result);
}

main().catch(console.error).finally(() => prisma.$disconnect());
