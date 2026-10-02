import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

async function main() {
  console.log("🚀 Initialisation du compte Admin...");

  // 1. S'assurer que les rôles existent
  const roles = ["USER", "CREATOR", "EDITOR", "ADMIN", "SUPER_ADMIN"];
  const roleMap: Record<string, any> = {};

  for (const r of roles) {
    const roleRecord = await prisma.role.upsert({
      where: { name: r },
      update: {},
      create: { name: r, description: `Rôle système ${r}` },
    });
    roleMap[r] = roleRecord;
  }

  const defaultAdminPassword = "Admin@Bamako2026!";
  const passwordHash = await bcrypt.hash(defaultAdminPassword, BCRYPT_ROUNDS);

  // 2. Créer ou mettre à jour le compte admin dédié
  const adminEmail = "admin@bamakopodcast.ml";
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      fullName: "Admin Bamako Podcast",
      username: "admin",
      phoneNumber: "+22370000000",
      isVerified: true,
      isSuspended: false,
    },
    create: {
      email: adminEmail,
      username: "admin",
      fullName: "Admin Bamako Podcast",
      phoneNumber: "+22370000000",
      passwordHash,
      isVerified: true,
      isSuspended: false,
    },
  });

  // Associer les rôles ADMIN, SUPER_ADMIN, CREATOR à l'admin
  const adminRoleNames = ["SUPER_ADMIN", "ADMIN", "CREATOR"];
  for (const rName of adminRoleNames) {
    const roleObj = roleMap[rName];
    if (roleObj) {
      await prisma.userRole.upsert({
        where: {
          userId_roleId: {
            userId: adminUser.id,
            roleId: roleObj.id,
          },
        },
        update: {},
        create: {
          userId: adminUser.id,
          roleId: roleObj.id,
        },
      });
    }
  }

  // 3. Mettre à jour également salika.famanta@gmail.com avec le même mot de passe
  const salikaUser = await prisma.user.findUnique({
    where: { email: "salika.famanta@gmail.com" },
  });

  if (salikaUser) {
    await prisma.user.update({
      where: { id: salikaUser.id },
      data: {
        passwordHash,
        isVerified: true,
        isSuspended: false,
      },
    });

    for (const rName of adminRoleNames) {
      const roleObj = roleMap[rName];
      if (roleObj) {
        await prisma.userRole.upsert({
          where: {
            userId_roleId: {
              userId: salikaUser.id,
              roleId: roleObj.id,
            },
          },
          update: {},
          create: {
            userId: salikaUser.id,
            roleId: roleObj.id,
          },
        });
      }
    }
  }

  console.log("✅ Compte Admin configuré avec succès !");
  console.log("-----------------------------------------");
  console.log("Compte 1 :");
  console.log("  Email    : admin@bamakopodcast.ml");
  console.log("  Identifiant : admin ou admin@bamakopodcast.ml ou +22370000000");
  console.log("  Password : " + defaultAdminPassword);
  console.log("  Rôles    : SUPER_ADMIN, ADMIN, CREATOR");
  console.log("-----------------------------------------");
  console.log("Compte 2 (Personnel) :");
  console.log("  Email    : salika.famanta@gmail.com");
  console.log("  Password : " + defaultAdminPassword);
  console.log("  Rôles    : SUPER_ADMIN, ADMIN, CREATOR");
  console.log("-----------------------------------------");
}

main()
  .catch((e) => {
    console.error("❌ Erreur :", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
