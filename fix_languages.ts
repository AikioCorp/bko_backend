import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const englishIds = [
  "cmv1b2jmn000214kvv71fydut", // Africa Tech Summit
  "cmv1b2l61000814kvwcv86em2", // Afrobility
  "cmv1b2n4s000q14kv70dy7i8d", // My African Startup Story
  "cmv1b2lsu000e14kv56xsy5f9", // African Folktales
  "cmv1b2o30000w14kv87hadwtz", // The Opportunity is Africa
  "cmv1b2mfi000k14kvhlc3olm3", // African History Club
  "cmv1brp0f000e7gqywrae3kcl", // African Aunties
  "cmv1brrjp000k7gqy43u5two9", // Focus on Africa
  "cmv1brnsj00087gqywwvb3s30"  // Africa Health Ventures (probably English)
];
async function main() {
  await prisma.podcast.updateMany({
    where: { id: { in: englishIds } },
    data: { primaryLanguageCode: "en" }
  });
  console.log("Updated languages to 'en' for English podcasts");
}
main().catch(console.error).finally(() => prisma.$disconnect());
