-- AlterTable User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "welcomeEmailSentAt" TIMESTAMP(3);

-- AlterTable UserRecommendationProfile
ALTER TABLE "UserRecommendationProfile" ADD COLUMN IF NOT EXISTS "onboardingState" TEXT NOT NULL DEFAULT 'NOT_PROMPTED';
ALTER TABLE "UserRecommendationProfile" ADD COLUMN IF NOT EXISTS "onboardingPromptedAt" TIMESTAMP(3);
ALTER TABLE "UserRecommendationProfile" ADD COLUMN IF NOT EXISTS "onboardingDismissedAt" TIMESTAMP(3);
