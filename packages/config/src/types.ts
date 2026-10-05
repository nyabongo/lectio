/**
 * The typed shape of `config/lectio.config.json` after defaults are applied.
 *
 * Every owner decision is a value here with a default (see `defaults.ts` and
 * `config/README.md`). Keys that later roadmap issues read are declared up front
 * so no later issue needs to edit this package.
 */

/** Model families that can back an LLM role. `fake` is the deterministic test double. */
export type LlmFamily = 'anthropic' | 'openai' | 'google' | 'fake';

/** A model choice: the family (used to keep verifiers independent) and the model id (priced in `pricing`). */
export interface ModelChoice {
  readonly family: LlmFamily;
  readonly model: string;
}

export interface SiteConfig {
  /** Absolute URL of the deployed site, ending in `/`. */
  readonly baseUrl: string;
  /** Path prefix the site is served under (`''` at a domain root). */
  readonly basePath: string;
  /** Custom domain for CNAME and `.well-known` files; `''` means none (open decision L-206). */
  readonly customDomain: string;
  /** IANA time zone that decides "today". */
  readonly timezone: string;
  /** Regional calendar to apply (L-015). */
  readonly region: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly features: {
    /** Show the Listen (narration) UI. */
    readonly listen: boolean;
  };
}

export interface ContentConfig {
  /** Content repository root (holds `passages/`, `calendar/`), relative to the repository root. */
  readonly root: string;
}

/**
 * A link-out target. Exactly one of `builtin` or `template` is set.
 * Template tokens (L-007): `{book}`, `{bookName}`, `{bookSlug}`, `{chapter}`, `{verse}`,
 * `{query}`, `{osis}`, `{usfm}`, `{date}`.
 */
export interface LinkoutProvider {
  readonly label: string;
  readonly enabled: boolean;
  /** A provider implemented in code (`drbo`: public-domain Douay-Rheims per chapter). */
  readonly builtin?: 'drbo';
  /** A URL template filled by the generic template provider. */
  readonly template?: string;
  /** Versification the target site uses (for example `vulgate`); defaults to the reference's own. */
  readonly versification?: string;
}

export interface LinkoutConfig {
  /** The active provider: a key of `providers`, which must be enabled. */
  readonly provider: string;
  readonly providers: Readonly<Record<string, LinkoutProvider>>;
  /** Study text shown beside notes. `none`: no reading text is shown or stored (L-201). */
  readonly studyText: 'none';
}

export interface ReviewerConfig {
  /** GitHub handles whose `approved` label or `/approve` comment counts as human approval. */
  readonly githubHandles: readonly string[];
  /** Passages the reviewers can review per week; caps how much research is opened. */
  readonly weeklyCapacity: number;
  /** Research stops opening PRs while this many review PRs are open. */
  readonly maxOpenReviewPrs: number;
  readonly approvalLabel: string;
  readonly approvalCommand: string;
}

export interface AutoMergeConfig {
  readonly enabled: boolean;
  /** Minimum support score from each verifier on every claim. */
  readonly minSupport: number;
  readonly requireBothVerifiers: boolean;
  readonly maxRefutations: number;
  readonly sensitiveClaimsRequireReview: boolean;
  readonly flagsRequireReview: boolean;
  /** Only PRs that touch nothing but `passages/` may auto-merge. */
  readonly passagesOnly: boolean;
}

export interface ResearchConfig {
  /** Research runs on the owner's machine as a CLI; CI never runs research (L-201). */
  readonly runner: 'local-cli';
  readonly defaultDays: number;
  /** One PR per passage. */
  readonly prGrouping: 'passage';
  /** Repair attempts after a failed gate before giving up on a passage. */
  readonly maxRepairs: number;
  readonly budget: {
    readonly perPassageUsd: number;
    readonly perRunUsd: number;
    /** Back-fill ceiling. `0` means back-fill only ever runs as a dry run. */
    readonly backfillTotalUsd: number;
  };
  readonly models: {
    readonly generator: ModelChoice;
    readonly repair: ModelChoice;
  };
}

export interface RunwayConfig {
  /** Days ahead the runway monitor checks. */
  readonly windowDays: number;
  /** Missing days within the window that raise the alarm. */
  readonly maxMissingDays: number;
}

export interface VerifiersConfig {
  readonly confirmer: ModelChoice;
  readonly refuter: ModelChoice;
  /** `auto`: live when the secret is present, otherwise skipped (never auto-merges). */
  readonly mode: 'auto' | 'live' | 'fake' | 'skip';
}

export interface TtsConfig {
  readonly provider: 'fake' | 'azure';
  /** Voice per locale. */
  readonly voices: Readonly<Record<string, string>>;
  readonly monthlyCharBudget: number;
  readonly storage: {
    readonly provider: 'fs' | 's3';
    /** Public URL prefix of the audio bucket; `''` until storage exists. */
    readonly publicBaseUrl: string;
  };
}

export interface LicenceGuardConfig {
  readonly maxQuotedWords: number;
  readonly maxExcerptWords: number;
  readonly maxCommentaryRunWords: number;
  readonly maxBibleRunWords: number;
  /** Words per shingle in the hash-only text index (L-013). */
  readonly shingleSize: number;
}

export interface LectionaryConfig {
  /** Lectionary edition the readings follow. */
  readonly edition: string;
  /** Where reading citations come from. */
  readonly primarySource: string;
  /** Independent source for the 100% cross-check. */
  readonly crossCheckSource: string;
  /** `true` until the owner settles L-211. */
  readonly provisional: boolean;
}

/** USD prices per million tokens (and per thousand web searches) for one model id. */
export interface ModelPrice {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly cachedInputPerMTok?: number;
  readonly webSearchPerThousand?: number;
}

export interface LectioConfig {
  readonly site: SiteConfig;
  readonly content: ContentConfig;
  readonly linkout: LinkoutConfig;
  readonly reviewer: ReviewerConfig;
  readonly autoMerge: AutoMergeConfig;
  readonly research: ResearchConfig;
  readonly runway: RunwayConfig;
  readonly verifiers: VerifiersConfig;
  readonly tts: TtsConfig;
  readonly licenceGuard: LicenceGuardConfig;
  readonly lectionary: LectionaryConfig;
  /** Token prices by model id, used by the cost meter. */
  readonly pricing: Readonly<Record<string, ModelPrice>>;
}

/** A recursive partial: what a config file may contain. */
export type DeepPartial<T> = T extends readonly (infer _U)[]
  ? T
  : T extends object
    ? { -readonly [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type PartialLectioConfig = DeepPartial<LectioConfig>;
