export type FeedbackTargetType = "EPISODE" | "PODCAST";
export type FeedbackAction = "NOT_INTERESTED" | "HIDE_PODCAST" | "EXCLUDE_FROM_PROFILE";

export type InteractionTargetType = "EPISODE" | "PODCAST";
export type InteractionActionType =
  | "CLICK"
  | "PLAY_START"
  | "QUALIFIED_PLAY"
  | "FAVORITE"
  | "LIKE"
  | "FOLLOW";

export interface UserInterestProfile {
  userId: string;
  personalizationActive: boolean;
  onboardingCompleted: boolean;
  preferencesVersion: number;
  profileVersion: number;
  topicScores: Record<string, number>;
  categoryScores: Record<string, number>;
  languageScores: Record<string, number>;
  recentSignals: {
    lastInteractedCategory?: string;
    lastInteractedPodcast?: string;
    repeatedListens: Record<string, number>;
    recentCompletions: string[];
    quickAbandons: string[];
  };
  experimentVariant: string;
  computedAt: Date;
}

export interface RecommendationCandidateEpisode {
  id: string;
  title: string;
  slug: string;
  cover?: string | null;
  summary?: string | null;
  durationSeconds: number;
  publishedAt?: Date | null;
  episodeType: string;
  podcastId: string;
  podcast: {
    id: string;
    name: string;
    slug: string;
    cover: string;
    primaryLanguageCode?: string;
    categories?: Array<{ categoryId: string; category?: { id: string; name: string; slug: string } }>;
  };
  mediaSources?: any[];
  language?: any;
  candidateSource: string;
  score?: number;
  matchReason?: string;
}

export interface RecommendationCandidatePodcast {
  id: string;
  name: string;
  slug: string;
  cover: string;
  description?: string;
  countryId?: string;
  primaryLanguageCode?: string;
  primaryLanguage?: any;
  categories?: Array<{ categoryId: string; category?: { id: string; name: string; slug: string } }>;
  _count?: { episodes: number; followers: number };
  candidateSource: string;
  score?: number;
  matchReason?: string;
}

export interface NormalizedScores {
  popularityScore: number;       // 0..1 (Bayesian smoothed)
  affinityScore: number;         // 0..1 (based on topic/category/lang preferences)
  semanticScore: number;         // 0..1 (cosine similarity via embedding)
  recencyScore: number;          // 0..1 (exponential decay)
  collaborativeScore: number;    // 0..1 (co-listening similarity)
  finalScore: number;
}

export interface RankingFeatures {
  popularityPlays: number;
  qualifiedPlays: number;
  completionRate: number;
  followersCount: number;
  recencyHours: number;
  topicAffinity: number;
  categoryAffinity: number;
  languageAffinity: number;
  semanticSimilarity: number;
  collaborativeAffinity: number;
  isFollowedPodcast: boolean;
  isRecentAbandon: boolean;
}

export interface RankingStrategy {
  name: string;
  scoreEpisode(candidate: RecommendationCandidateEpisode, profile: UserInterestProfile | null): number;
  scorePodcast(candidate: RecommendationCandidatePodcast, profile: UserInterestProfile | null): number;
}

export interface RecommendationItemDto {
  id: string;
  targetType: "EPISODE" | "PODCAST";
  position: number;
  reason?: string;
  attribution: {
    batchId: string;
    engineVersion: string;
    variant: string;
    sectionSlug: string;
  };
  episode?: any;
  podcast?: any;
}

export interface RecommendationSectionDto {
  id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  type: string;
  sourceMode: "MANUAL" | "AUTOMATIC" | "HYBRID";
  position: number;
  isFixedPlacement: boolean;
  priority: number;
  reason?: string;
  items: RecommendationItemDto[];
}

export interface RecommendationBatchResponse {
  batchId: string;
  engineVersion: string;
  variant: string;
  personalizationActive: boolean;
  sections: RecommendationSectionDto[];
  heroSlides?: any[];
  heroEpisode?: any;
  trending?: any[];
  latestEpisodes?: any[];
  categoryShelves?: any[];
  feed?: {
    items: any[];
    nextCursor: string | null;
    hasMore: boolean;
  };
}
