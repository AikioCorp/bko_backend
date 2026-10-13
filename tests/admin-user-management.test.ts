import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { prisma } from "../src/config/prisma.js";
import { AdminRbacService } from "../src/modules/admin/admin-rbac.service.js";

test("Super Admin User Management & Password Reset Lifecycles", async (t) => {
  const timestamp = Date.now();
  const superAdminEmail = `superadmin-${timestamp}@bko-test.ml`;
  const targetUserEmail = `target-user-${timestamp}@bko-test.ml`;

  // 1. Create a Super Admin role and user
  let superAdminRole = await prisma.role.findUnique({ where: { name: "SUPER_ADMIN" } });
  if (!superAdminRole) {
    superAdminRole = await prisma.role.create({ data: { name: "SUPER_ADMIN", description: "Super Administrator" } });
  }

  const superAdmin = await prisma.user.create({
    data: {
      email: superAdminEmail,
      fullName: "Super Admin Test",
      passwordHash: await bcrypt.hash("SuperPass123!", 10),
      isVerified: true,
      userRoles: {
        create: {
          roleId: superAdminRole.id,
        },
      },
    },
  });

  // 2. Create target user
  const targetUser = await prisma.user.create({
    data: {
      email: targetUserEmail,
      fullName: "Target User Before Update",
      username: `user_${timestamp}`,
      phoneNumber: `+2237000${timestamp.toString().slice(-4)}`,
      passwordHash: await bcrypt.hash("OldPassword123!", 10),
      isVerified: false,
    },
  });

  t.after(async () => {
    await prisma.userRole.deleteMany({ where: { userId: superAdmin.id } });
    await prisma.user.deleteMany({ where: { id: { in: [superAdmin.id, targetUser.id] } } });
  });

  const actor = { id: superAdmin.id, email: superAdmin.email };

  // 3. Test updateUser
  const updatedEmail = `target-updated-${timestamp}@bko-test.ml`;
  const updatedUser = await AdminRbacService.updateUser(actor, targetUser.id, {
    fullName: "Target User Modifié",
    email: updatedEmail,
    phoneNumber: "+22371234567",
    username: `updated_${timestamp}`,
    isVerified: true,
  });

  assert.equal(updatedUser.fullName, "Target User Modifié");
  assert.equal(updatedUser.email, updatedEmail);
  assert.equal(updatedUser.phoneNumber, "+22371234567");
  assert.equal(updatedUser.username, `updated_${timestamp}`);
  assert.equal(updatedUser.isVerified, true);

  // 4. Test adminResetPassword - SEND_EMAIL
  const sendEmailRes = await AdminRbacService.adminResetPassword(actor, targetUser.id, {
    mode: "SEND_EMAIL",
  });
  assert.equal(sendEmailRes.success, true);
  assert.equal(sendEmailRes.mode, "SEND_EMAIL");

  const checkUserAfterOtp = await prisma.user.findUnique({ where: { id: targetUser.id } });
  assert.ok(checkUserAfterOtp?.passwordResetToken, "Un token de reset hashé doit être présent");
  assert.ok(checkUserAfterOtp?.passwordResetExpiresAt, "Une date d'expiration doit être présente");

  // 5. Test adminResetPassword - GENERATE
  const generateRes = await AdminRbacService.adminResetPassword(actor, targetUser.id, {
    mode: "GENERATE",
    revokeSessions: true,
    notifyUser: false,
  });
  assert.equal(generateRes.success, true);
  assert.equal(generateRes.mode, "GENERATE");
  assert.ok(generateRes.generatedPassword, "Un mot de passe généré doit être renvoyé");
  assert.ok(generateRes.generatedPassword.startsWith("Bko#"), "Le mot de passe doit respecter le préfixe sécurisé");

  const checkUserAfterGen = await prisma.user.findUnique({ where: { id: targetUser.id } });
  assert.equal(checkUserAfterGen?.passwordResetToken, null, "Le token reset doit être nettoyé");
  const isMatchGenerated = await bcrypt.compare(generateRes.generatedPassword, checkUserAfterGen!.passwordHash!);
  assert.equal(isMatchGenerated, true, "Le mot de passe généré doit matcher le hash stocké");

  // 6. Test adminResetPassword - DIRECT
  const customDirectPassword = "CustomSmartAdminPass2026!";
  const directRes = await AdminRbacService.adminResetPassword(actor, targetUser.id, {
    mode: "DIRECT",
    password: customDirectPassword,
    revokeSessions: true,
  });
  assert.equal(directRes.success, true);
  assert.equal(directRes.mode, "DIRECT");

  const checkUserAfterDirect = await prisma.user.findUnique({ where: { id: targetUser.id } });
  const isMatchDirect = await bcrypt.compare(customDirectPassword, checkUserAfterDirect!.passwordHash!);
  assert.equal(isMatchDirect, true, "Le mot de passe direct doit matcher le hash stocké");
});
