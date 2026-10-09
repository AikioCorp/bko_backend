import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
prisma.category.findMany().then(res => {
  console.log(JSON.stringify(res, null, 2));
  prisma.$disconnect();
});
