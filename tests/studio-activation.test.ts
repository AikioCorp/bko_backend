import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma.js';
import { CreatorProfileService } from '../src/modules/creator/creator-profile.service.js';
import { CreatorPodcastService } from '../src/modules/creator/creator-podcast.service.js';

test('activation is atomic, repeatable, and does not trust stale roles', async () => {
  const originalTransaction = prisma.$transaction;
  const originalProfile = prisma.creatorProfile.findUnique;
  const originalMember = prisma.podcastMember.findFirst;
  const originalRoles = prisma.userRole.findMany;
  let stored: any = null;
  let roleAssigned = false;
  let personCount = 0;
  let roleAvailable = true;
  const tx: any = {
    $queryRaw: async () => [],
    creatorProfile: {
      findUnique: async ({ where }: any) => where.userId ? stored : null,
      create: async ({ data }: any) => (stored = { id: 'profile', ...data }),
    },
    person: { findUnique: async () => null, create: async () => ({ id: `person-${++personCount}` }) },
    role: { findUnique: async () => roleAvailable ? { id: 'creator-role' } : null },
    userRole: { upsert: async () => { roleAssigned = true; } },
  };
  try {
    prisma.$transaction = (async (callback: any) => {
      const snapshot = { stored, roleAssigned, personCount };
      try { return await callback(tx); } catch (error) {
        ({ stored, roleAssigned, personCount } = snapshot); throw error;
      }
    }) as any;
    const first = await CreatorProfileService.createProfile('user', { displayName: ' Mon Studio ', createPerson: true });
    assert.equal(first.displayName, 'Mon Studio');
    assert.equal(roleAssigned, true);
    roleAssigned = false;
    const retry = await CreatorProfileService.createProfile('user', { displayName: 'Autre nom', createPerson: true });
    assert.equal(retry.id, first.id);
    assert.equal(retry.displayName, 'Mon Studio');
    assert.equal(personCount, 1);
    assert.equal(roleAssigned, true, 'retry repairs the server role');
    stored = null; roleAvailable = false; roleAssigned = false;
    await assert.rejects(() => CreatorProfileService.createProfile('user', { displayName: 'Studio', createPerson: true }), /CREATOR_ROLE_UNAVAILABLE/);
    assert.equal(stored, null, 'failure rolls back the profile');
    assert.equal(personCount, 1, 'failure rolls back the person');
    await assert.rejects(() => CreatorProfileService.createProfile('user', { displayName: ' ' }), /INVALID_CREATOR_NAME/);
    await assert.rejects(() => CreatorProfileService.createProfile('user', { displayName: 'Studio', website: 'javascript:alert(1)' }), /INVALID_URL/);
    prisma.creatorProfile.findUnique = (async () => null) as any;
    prisma.podcastMember.findFirst = (async () => null) as any;
    prisma.userRole.findMany = (async () => [{ role: { name: 'CREATOR' } }]) as any;
    assert.equal((await CreatorProfileService.getStudioAccess('user')).canAccess, false);
    await assert.rejects(() => CreatorPodcastService.createPodcast('user', { name: 'Show', description: 'Test', cover: '', countryId: 'FR' }), /CREATOR_PROFILE_REQUIRED/);
    prisma.podcastMember.findFirst = (async () => ({ id: 'member' })) as any;
    const memberAccess = await CreatorProfileService.getStudioAccess('user');
    assert.equal(memberAccess.canAccess, true);
    assert.equal(memberAccess.canCreatePodcast, false);
    prisma.podcastMember.findFirst = (async () => null) as any;
    prisma.userRole.findMany = (async () => [{ role: { name: 'ADMIN' } }]) as any;
    assert.equal((await CreatorProfileService.getStudioAccess('user')).canAccess, true);
  } finally {
    prisma.$transaction = originalTransaction;
    prisma.creatorProfile.findUnique = originalProfile;
    prisma.podcastMember.findFirst = originalMember;
    prisma.userRole.findMany = originalRoles;
  }
});
