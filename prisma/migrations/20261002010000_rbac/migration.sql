-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "presetApplied" BOOLEAN NOT NULL DEFAULT false;

