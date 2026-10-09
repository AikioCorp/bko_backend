import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const updates = [
  { id: "cmv1bzyy400089y3ew26sb4u7", country: "SN", cat: "cmura52qi000ev53o5ri1rhod" }, // Histoires d'Audace (Business)
  { id: "cmv1c00ep000e9y3ea6gekpt7", country: "CI", cat: "cmura539t000jv53ogrg4cejt" }, // Abidjan Talk Live (Actualité)
  { id: "cmv1c01vn000k9y3ejqb36rox", country: "SN", cat: "cmura536l000iv53oa54bxqlj" }  // Senegal Dal (Musique)
];

async function main() {
  for (const u of updates) {
    await prisma.podcast.update({
      where: { id: u.id },
      data: { countryId: u.country }
    });
    await prisma.podcastCategory.create({
      data: { podcastId: u.id, categoryId: u.cat }
    }).catch(e => { /* Ignore duplicates */ });
    console.log(`Updated ${u.id} to country ${u.country} and category ${u.cat}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
