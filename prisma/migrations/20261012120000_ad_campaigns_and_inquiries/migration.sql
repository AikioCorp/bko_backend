-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "advertiserName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ctaLabel" TEXT DEFAULT 'En savoir plus',
    "targetUrl" TEXT NOT NULL,
    "imageUrlDesktop" TEXT NOT NULL,
    "imageUrlMobile" TEXT,
    "altText" TEXT,
    "placement" TEXT NOT NULL DEFAULT 'EXPLORE_CATALOG',
    "isSponsored" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "impressionsCount" INTEGER NOT NULL DEFAULT 0,
    "clicksCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvertiserInquiry" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "targetPeriod" TEXT,
    "budget" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvertiserInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdCampaign_status_placement_idx" ON "AdCampaign"("status", "placement");

-- CreateIndex
CREATE INDEX "AdvertiserInquiry_status_createdAt_idx" ON "AdvertiserInquiry"("status", "createdAt");
