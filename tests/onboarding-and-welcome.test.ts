import test from 'node:test';
import assert from 'node:assert/strict';
import { MailService } from '../src/services/mail/mail.service.js';
import { Emails } from '../src/services/mail/email-templates.js';
import { UserProfileService } from '../src/modules/recommendations/user-profile.service.js';
import { prisma } from '../src/config/prisma.js';

test('Welcome Email: templates, escaping, links, and transaction idempotency', async () => {
  // 1. Template validation
  const userName = 'Awa Traoré <test>';
  const template = Emails.welcome('awa@example.com', userName);

  assert.equal(template.to, 'awa@example.com');
  assert.ok(template.subject.includes('Bienvenue'));
  assert.ok(template.text.includes('Awa Traoré <test>'), 'Text contains unescaped name');
  assert.ok(template.html.includes('&lt;test&gt;'), 'HTML escapes special chars');
  assert.ok(template.html.includes('/onboarding'), 'HTML links to /onboarding');
  assert.ok(template.html.includes('/podcasts'), 'HTML links to /podcasts');
  assert.ok(template.html.includes('/support'), 'HTML links to /support');
  assert.ok(!template.html.includes('bg-gradient'), 'HTML strictly avoids gradient backgrounds');

  // 2. Idempotency test when welcomeEmailSentAt is already populated on the user object
  const existingUserWithEmail: any = {
    id: 'user_already_sent',
    email: 'already@example.com',
    fullName: 'Already Sent',
    welcomeEmailSentAt: new Date(),
  };

  const createdJobs: any[] = [];
  const originalTx = prisma.$transaction;

  try {
    const res1 = await MailService.enqueueWelcomeEmail(existingUserWithEmail);
    assert.equal(res1, false, 'Should return false when welcome email already sent');
    assert.equal(createdJobs.length, 0, 'No job should be enqueued');

    // 3. New user without welcomeEmailSentAt
    const newUser: any = {
      id: 'user_fresh',
      email: 'fresh@example.com',
      fullName: 'Fresh User',
      welcomeEmailSentAt: null,
    };

    let userUpdatedWithDate: Date | null = null;
    prisma.$transaction = (async (fn: any) => {
      return fn({
        user: {
          updateMany: async ({ where, data }: any) => {
            if (where.welcomeEmailSentAt === null) {
              userUpdatedWithDate = data.welcomeEmailSentAt;
              return { count: 1 };
            }
            return { count: 0 };
          },
        },
        jobQueueItem: {
          create: async ({ data }: any) => {
            createdJobs.push(data);
            return data;
          },
        },
      });
    }) as any;

    const res2 = await MailService.enqueueWelcomeEmail(newUser);
    assert.equal(res2, true, 'Should return true when email is enqueued');
    assert.ok(userUpdatedWithDate instanceof Date, 'User should be stamped with welcomeEmailSentAt');
    assert.equal(createdJobs.length, 1, 'Exactly one job should be enqueued');
    assert.equal(createdJobs[0].queueName, 'emails');
    assert.equal(createdJobs[0].payload.to, 'fresh@example.com');

    // 4. Calling again when DB already updated (count: 0) should be idempotent and not enqueue a second job
    prisma.$transaction = (async (fn: any) => {
      return fn({
        user: {
          updateMany: async () => ({ count: 0 }),
        },
        jobQueueItem: {
          create: async ({ data }: any) => {
            createdJobs.push(data);
            return data;
          },
        },
      });
    }) as any;

    const res3 = await MailService.enqueueWelcomeEmail(newUser);
    assert.equal(res3, false, 'Should be idempotent when updateMany finds 0 rows');
    assert.equal(createdJobs.length, 1, 'Job count must remain 1');
  } finally {
    prisma.$transaction = originalTx;
  }
});

test('UserProfileService.completeOnboarding: atomic validation, preferences persistence, omitted vs empty', async () => {
  const originalTx = prisma.$transaction;
  const originalFindUnique = prisma.userRecommendationProfile.findUnique;
  const originalTopicFindMany = prisma.topic.findMany;
  const originalLanguageFindMany = prisma.language.findMany;
  const originalPodcastFindMany = prisma.podcast.findMany;
  const originalRebuild = UserProfileService.rebuildProfile;
  const originalInvalidate = UserProfileService.invalidateProfile;

  const validTopics = [
    { id: 'top_tech', name: 'Tech' },
    { id: 'top_culture', name: 'Culture' },
  ];
  const validLanguages = [
    { code: 'bm', name: 'Bambara' },
    { code: 'fr', name: 'Français' },
  ];
  const validPodcasts = [
    { id: 'pod_1', name: 'Podcast 1' },
  ];

  let savedTopicPrefs: any[] = [];
  let savedLangPrefs: any[] = [];
  let savedFollows: any[] = [];
  let updatedProfileData: any = null;

  prisma.topic.findMany = (async ({ where }: any) => {
    return validTopics.filter(t => where.id.in.includes(t.id));
  }) as any;

  prisma.language.findMany = (async ({ where }: any) => {
    return validLanguages.filter(l => where.code.in.includes(l.code));
  }) as any;

  prisma.podcast.findMany = (async ({ where }: any) => {
    return validPodcasts.filter(p => where.id.in.includes(p.id));
  }) as any;

  UserProfileService.invalidateProfile = (async () => {}) as any;
  UserProfileService.rebuildProfile = (async (userId: string) => ({
    userId,
    personalizationActive: true,
    onboardingCompleted: true,
    preferencesVersion: 2,
    profileVersion: 1,
    topicScores: {},
    categoryScores: {},
    languageScores: {},
    recentSignals: {} as any,
    experimentVariant: 'control',
    computedAt: new Date(),
  })) as any;

  const mockTx: any = {
    userTopicPreference: {
      deleteMany: async () => { savedTopicPrefs = []; },
      createMany: async ({ data }: any) => { savedTopicPrefs.push(...data); },
    },
    userLanguagePreference: {
      deleteMany: async () => { savedLangPrefs = []; },
      createMany: async ({ data }: any) => { savedLangPrefs.push(...data); },
    },
    podcastFollow: {
      upsert: async ({ create }: any) => { savedFollows.push(create); return create; },
    },
    userRecommendationProfile: {
      upsert: async ({ create, update }: any) => {
        updatedProfileData = update;
        return { userId: 'u1', ...update };
      },
    },
  };

  prisma.$transaction = (async (fn: any) => fn(mockTx)) as any;

  try {
    // 1. Success case with valid referentials
    const res = await UserProfileService.completeOnboarding('u1', {
      topicIds: ['top_tech', 'top_culture'],
      languageCodes: ['bm', 'fr'],
      podcastIds: ['pod_1'],
    });

    assert.ok(res);
    assert.equal(res.onboardingCompleted, true);
    assert.equal(savedTopicPrefs.length, 2);
    assert.equal(savedLangPrefs.length, 2);
    assert.equal(savedFollows.length, 1);
    assert.equal(updatedProfileData.onboardingCompleted, true);
    assert.equal(updatedProfileData.onboardingState, 'COMPLETED');

    // 2. Reject unknown topic ID
    await assert.rejects(
      async () => {
        await UserProfileService.completeOnboarding('u1', {
          topicIds: ['top_invalid_id'],
        });
      },
      /inexistants/,
      'Should reject invalid topic IDs'
    );

    // 3. Reject unknown language code
    await assert.rejects(
      async () => {
        await UserProfileService.completeOnboarding('u1', {
          languageCodes: ['invalid_lang'],
        });
      },
      /inexistants/,
      'Should reject invalid language codes'
    );

    // 4. Distinction between omitted (undefined) and explicit empty array []
    // When topicIds is omitted, topic preferences are untouched
    savedTopicPrefs = [{ topicId: 'existing_topic' }];
    await UserProfileService.completeOnboarding('u1', {
      languageCodes: ['fr'],
      // topicIds omitted
    });
    assert.equal(savedTopicPrefs.length, 1, 'Omitted topicIds should NOT delete existing topic preferences');

    // When topicIds is explicit empty array [], topic preferences are cleared
    await UserProfileService.completeOnboarding('u1', {
      topicIds: [],
    });
    assert.equal(savedTopicPrefs.length, 0, 'Explicit empty topicIds array should clear topic preferences');
  } finally {
    prisma.$transaction = originalTx;
    prisma.userRecommendationProfile.findUnique = originalFindUnique;
    prisma.topic.findMany = originalTopicFindMany;
    prisma.language.findMany = originalLanguageFindMany;
    prisma.podcast.findMany = originalPodcastFindMany;
    UserProfileService.rebuildProfile = originalRebuild;
    UserProfileService.invalidateProfile = originalInvalidate;
  }
});

test('UserProfileService.updateOnboardingState: state machine transitions and preservation of COMPLETED', async () => {
  const originalFindUnique = prisma.userRecommendationProfile.findUnique;
  const originalUpsert = prisma.userRecommendationProfile.upsert;

  let currentProfile: any = {
    userId: 'u_state',
    onboardingState: 'NOT_PROMPTED',
    onboardingPromptedAt: null,
    onboardingDismissedAt: null,
  };

  prisma.userRecommendationProfile.findUnique = (async () => currentProfile) as any;
  prisma.userRecommendationProfile.upsert = (async ({ update }: any) => {
    currentProfile = { ...currentProfile, ...update };
    return currentProfile;
  }) as any;

  try {
    // 1. Transition NOT_PROMPTED -> PROMPTED
    const r1 = await UserProfileService.updateOnboardingState('u_state', 'PROMPTED');
    assert.equal(r1.onboardingState, 'PROMPTED');
    assert.ok(currentProfile.onboardingPromptedAt instanceof Date, 'Should record prompt timestamp');

    // 2. Transition PROMPTED -> DISMISSED
    const r2 = await UserProfileService.updateOnboardingState('u_state', 'DISMISSED');
    assert.equal(r2.onboardingState, 'DISMISSED');
    assert.ok(currentProfile.onboardingDismissedAt instanceof Date, 'Should record dismiss timestamp');

    // 3. When COMPLETED, subsequent PROMPTED or DISMISSED must NOT overwrite COMPLETED
    currentProfile.onboardingState = 'COMPLETED';
    currentProfile.onboardingCompleted = true;

    const r3 = await UserProfileService.updateOnboardingState('u_state', 'DISMISSED');
    assert.equal(r3.onboardingState, 'COMPLETED', 'Must not downgrade COMPLETED to DISMISSED');

    const r4 = await UserProfileService.updateOnboardingState('u_state', 'PROMPTED');
    assert.equal(r4.onboardingState, 'COMPLETED', 'Must not downgrade COMPLETED to PROMPTED');
  } finally {
    prisma.userRecommendationProfile.findUnique = originalFindUnique;
    prisma.userRecommendationProfile.upsert = originalUpsert;
  }
});
