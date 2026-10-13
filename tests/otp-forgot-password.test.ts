import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { prisma } from "../src/config/prisma.js";
import { AuthService } from "../src/modules/auth/auth.service.js";

test("OTP Forgot Password & Reset Lifecycle", async (t) => {
  const testEmail = `test-reset-otp-${Date.now()}@bko-test.ml`;
  const initialPassword = "InitialPassword123!";
  const newPassword = "NewSecretPassword2026!";

  // 1. Créer un utilisateur de test
  const initialHash = await bcrypt.hash(initialPassword, 10);
  const user = await prisma.user.create({
    data: {
      email: testEmail,
      fullName: "Testeur Reset OTP",
      passwordHash: initialHash,
      isVerified: true,
    },
  });

  t.after(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
  });

  // 2. Demande de réinitialisation (envoi OTP)
  process.env.AUTH_OTP_MODE = "test";
  const forgotResult = await AuthService.forgotPassword(testEmail);
  assert.ok(forgotResult.otpCode, "Un code OTP doit être retourné en mode test");
  assert.match(forgotResult.otpCode!, /^\d{6}$/, "Le code OTP doit comporter 6 chiffres");

  const otpCode = forgotResult.otpCode!;

  // 3. Vérification de l'OTP
  const verifyResult = await AuthService.verifyResetOtp(testEmail, otpCode);
  assert.equal(verifyResult.valid, true);

  // Vérifier qu'un faux code échoue
  await assert.rejects(
    async () => AuthService.verifyResetOtp(testEmail, "000000"),
    /RESET_CODE_INVALID/
  );

  // 4. Réinitialisation avec l'OTP
  const resetResult = await AuthService.resetPassword({
    email: testEmail,
    otpCode,
    password: newPassword,
  });
  assert.ok(resetResult.message.includes("modifié"), "Message de confirmation attendu");

  // 5. Vérifier en base que le mot de passe est mis à jour et que le token est consommé
  const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
  assert.ok(updatedUser);
  assert.equal(updatedUser.passwordResetToken, null, "Le token reset doit être consommé");
  assert.equal(updatedUser.passwordResetExpiresAt, null);

  const isMatch = await bcrypt.compare(newPassword, updatedUser.passwordHash!);
  assert.equal(isMatch, true, "Le nouveau mot de passe doit être valide");

  const oldMatch = await bcrypt.compare(initialPassword, updatedUser.passwordHash!);
  assert.equal(oldMatch, false, "L'ancien mot de passe ne doit plus être valide");
});
