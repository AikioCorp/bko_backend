import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const updates = [
  { id: "cmv1chih5000210e2w0qq3cwc", country: "BF", cat: "cmv0x6o1w002tookcilewkjhc", lang: "fr" }, // Mouvement Sunnite (Religion, Burkina)
  { id: "cmv1chkd0000810e2938k00uk", country: "GH", cat: "cmv0xd04m0003uy9yelezqzbl", lang: "en" }, // Sincerely Accra (Comédie, Ghana, English)
  { id: "cmv1chld8000e10e23dic4fww", country: "GH", cat: "cmura536l000iv53oa54bxqlj", lang: "en" }  // Choral Music (Musique, Ghana, English)
];

async function main() {
  for (const u of updates) {
    await prisma.podcast.update({
      where: { id: u.id },
      data: { countryId: u.country, primaryLanguageCode: u.lang }
    });
    await prisma.podcastCategory.create({
      data: { podcastId: u.id, categoryId: u.cat }
    }).catch(e => { /* Ignore duplicates */ });
    console.log(`Updated ${u.id} to country ${u.country}, lang ${u.lang} and category ${u.cat}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
