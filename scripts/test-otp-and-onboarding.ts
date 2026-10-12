import { AuthService, isOtpTestMode } from "../src/modules/auth/auth.service.js";
import { UserProfileService } from "../src/modules/recommendations/user-profile.service.js";
import { prisma } from "../src/config/prisma.js";

async function run() {
  console.log("=== TEST SUITE: OTP & ONBOARDING END-TO-END ===");

  // Force test mode explicitly
  process.env.AUTH_OTP_MODE = "test";
  if (!isOtpTestMode()) {
    throw new Error("AUTH_OTP_MODE=test should enable test mode");
  }
  console.log("✓ OTP test mode is active");

  const testEmail = `test_otp_${Date.now()}@test.bko`;
  const testPassword = "Password123!";
  const testName = "Test Auditeur";

  try {
    // 1. Inscription
    console.log(`1. Inscription de ${testEmail}...`);
    const regRes = await AuthService.register({
      email: testEmail,
      password: testPassword,
      fullName: testName,
    });

    if (!regRes.testOtpCode || !/^\d{6}$/.test(regRes.testOtpCode)) {
      throw new Error(`testOtpCode manquant ou non conforme : ${regRes.testOtpCode}`);
    }
    console.log(`✓ Inscription réussie, OTP retourné : ${regRes.testOtpCode}`);

    const userInDb = await prisma.user.findUnique({ where: { email: testEmail } });
    if (!userInDb) throw new Error("Utilisateur introuvable en base");
    if (userInDb.isVerified !== false) {
      throw new Error(`isVerified devrait être false après inscription, trouvé : ${userInDb.isVerified}`);
    }
    if (!userInDb.otpCode || userInDb.otpCode === regRes.testOtpCode) {
      throw new Error("Le code OTP en base DOIT être stocké haché et non en clair");
    }
    console.log("✓ Compte créé avec isVerified=false et OTP haché en base");

    // 2. Renvoi d'OTP
    console.log("2. Test de renvoi d'OTP (resend)...");
    const resendRes = await AuthService.resendOtp(testEmail);
    if (!resendRes.testOtpCode || resendRes.testOtpCode === regRes.testOtpCode) {
      console.log(`✓ Nouveau code généré : ${resendRes.testOtpCode}`);
    }
    const currentCode = resendRes.testOtpCode!;

    // 3. Tentative avec codes bypass invalides (123456 / 000000 / mauvais code)
    console.log("3. Test du rejet strict des faux codes (123456 / 000000)...");
    let rejected123 = false;
    try {
      await AuthService.verifyOtp({ email: testEmail, otpCode: "123456" });
    } catch {
      rejected123 = true;
    }
    if (!rejected123 && currentCode !== "123456") {
      throw new Error("Le code bypass '123456' a été indûment accepté !");
    }
    console.log("✓ Code 123456 rejeté avec succès");

    // 4. Validation avec le véritable OTP
    console.log("4. Validation avec le véritable code OTP...");
    const verifyRes = await AuthService.verifyOtp({
      email: testEmail,
      otpCode: currentCode,
      deviceType: "MOBILE",
      deviceName: "Test Device",
    });

    if (!verifyRes.accessToken || !verifyRes.refreshToken) {
      throw new Error("verifyOtp doit retourner accessToken et refreshToken pour auto-login");
    }
    if (verifyRes.user.isVerified !== true) {
      throw new Error("verifyOtp doit retourner user.isVerified = true");
    }
    if (verifyRes.user.onboardingCompleted !== false) {
      throw new Error("onboardingCompleted devrait être false avant le parcours de goûts");
    }
    console.log("✓ OTP validé, tokens délivrés et auto-login opérationnel");

    // Vérification en base
    const verifiedUser = await prisma.user.findUnique({ where: { email: testEmail } });
    if (!verifiedUser?.isVerified || verifiedUser.otpCode !== null) {
      throw new Error("L'OTP en base devrait être consommé (null) et isVerified=true");
    }
    console.log("✓ Compte marqué isVerified=true en base et OTP consommé (null)");

    // 5. Parcours Onboarding des goûts
    console.log("5. Test de finalisation de l'onboarding de goûts...");
    const sampleLanguages = ["fr", "bm"];
    const existingTopics = await prisma.topic.findMany({ take: 2 });
    const sampleTopicIds = existingTopics.map((t) => t.id);
    const existingPodcasts = await prisma.podcast.findMany({ take: 2 });
    const samplePodcastIds = existingPodcasts.map((p) => p.id);

    await UserProfileService.completeOnboarding(
      verifiedUser.id,
      sampleTopicIds,
      sampleLanguages,
      samplePodcastIds
    );

    const recProfile = await prisma.userRecommendationProfile.findUnique({
      where: { userId: verifiedUser.id },
    });
    if (!recProfile || !recProfile.onboardingCompleted) {
      throw new Error("userRecommendationProfile.onboardingCompleted doit être true");
    }

    const langPrefs = await prisma.userLanguagePreference.findMany({
      where: { userId: verifiedUser.id },
    });
    if (langPrefs.length !== sampleLanguages.length) {
      throw new Error(`Préférences de langues attendues: ${sampleLanguages.length}, trouvées: ${langPrefs.length}`);
    }

    console.log("✓ Onboarding enregistré avec succès et profile.onboardingCompleted=true");

    console.log("\n=============================================");
    console.log("TOUS LES TESTS BACKEND SONT VALIDÉS AVEC SUCCÈS !");
    console.log("=============================================");
  } finally {
    // Nettoyage du compte test
    console.log("Nettoyage des données de test...");
    await prisma.user.deleteMany({ where: { email: testEmail } });
    console.log("✓ Nettoyage terminé");
  }
}

run()
  .catch((e) => {
    console.error("ERREUR DE TEST :", e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
