import { prisma } from "./src/config/prisma.js";

async function checkLangs() {
  const langs = await prisma.language.findMany();
  console.log("LANGUAGES IN DB:", JSON.stringify(langs, null, 2));
  const countries = await prisma.country.findMany();
  console.log("COUNTRIES IN DB:", JSON.stringify(countries.map(c => ({ id: c.id, name: c.name })), null, 2));
  await prisma.$disconnect();
}

checkLangs().catch(console.error);
