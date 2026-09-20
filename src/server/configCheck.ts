/**
 * Configuration contract.
 *
 * A solo founder's most expensive failure is a deployment that is *up* but not
 * actually operational: no database, no ops secret, no scheduler secret, so the
 * queue never drains and nothing can alert anybody. The app previously only
 * enforced two variables (DATABASE_URL and SESSION_SECRET), both at the moment
 * of a crash, and silently accepted everything else.
 *
 * This file declares every variable the product reads, what happens without it,
 * and how to get it. `checkConfiguration()` is used in three places:
 *   - at boot, to log one honest readiness block;
 *   - at `GET /api/health`, as a count only (never values, it is public);
 *   - at `GET /api/ops/config`, in full, for the operator.
 *
 * It never reads or prints a secret value — only whether one is set.
 */

export type ConfigSeverity = 'fatal' | 'required' | 'recommended' | 'optional';

export interface EnvRequirement {
  key: string;
  severity: ConfigSeverity;
  /** What it does, in one line. */
  purpose: string;
  /** What breaks without it. */
  impact: string;
  /** Where to get it or how to generate it. */
  howTo: string;
  /** Restrict the finding to these environments; omitted means all. */
  envs?: Array<'production' | 'development' | 'test'>;
}

export const ENV_REQUIREMENTS: EnvRequirement[] = [
  {
    key: 'DATABASE_URL',
    severity: 'fatal',
    purpose: 'Postgres connection string (Neon, Sydney region).',
    impact: 'Boot fails in production. Patient records would otherwise land in a JSON file on a read-only filesystem.',
    howTo: 'Neon project in ap-southeast-2; copy the pooled connection string.',
  },
  {
    key: 'SESSION_SECRET',
    severity: 'fatal',
    purpose: 'Signs and verifies clinician session tokens.',
    impact: 'Boot fails in production. With the development fallback in place, anyone reading the source could forge a session for any account.',
    howTo: 'Generate 32+ random bytes: openssl rand -base64 48',
  },
  {
    key: 'DENTAI_OPS_SECRET',
    severity: 'required',
    purpose: 'Authenticates operator endpoints (support actions, telemetry, audit verification).',
    impact: 'Operator endpoints return 503, so support, lockouts and audit verification are unavailable.',
    howTo: 'Generate 32+ random bytes and store it in a password manager.',
  },
  {
    key: 'CRON_SECRET',
    severity: 'required',
    purpose: 'Authenticates the scheduled queue drain at /api/cron/drain.',
    impact: 'Queued notes only advance when a signed-in browser happens to be polling. A note submitted on a closed laptop can sit queued indefinitely — the durability claim is not true without it.',
    howTo: 'Generate 32+ random bytes; the value the scheduler sends as x-cron-secret / Bearer.',
  },
  {
    key: 'GEMINI_API_KEY',
    severity: 'required',
    purpose: 'Primary model access for note generation.',
    impact: 'Hosted generation is unavailable; every note falls back to the on-device/offline draft engine and is flagged for review.',
    howTo: 'Google AI Studio API key, restricted to the Generative Language API.',
  },
  {
    key: 'DENTAI_ABN',
    severity: 'required',
    purpose: 'Australian Business Number (ABN) displayed on tax invoices and receipts.',
    impact: 'Tax invoices cannot be issued legally under Australian GST law without a valid supplier ABN.',
    howTo: '11-digit Australian Business Number, e.g. "12 345 678 901".',
  },
  {
    key: 'GCP_PROJECT_ID',
    severity: 'required',
    purpose: 'Enables the Vertex AI route, which is the Australian-region path.',
    impact: 'Generation uses the global Gemini endpoint, so content may be processed outside Australia — which contradicts sovereign processing commitments.',
    howTo: 'GCP project with Vertex AI enabled in australia-southeast1.',
  },
  {
    key: 'ERROR_WEBHOOK_URL',
    severity: 'recommended',
    purpose: 'Outbound alerting for ERROR-level events.',
    impact: 'Nothing tells you that something is broken. Errors only exist in logs nobody is watching.',
    howTo: 'Slack/Teams/Discord incoming webhook URL.',
  },
  {
    key: 'DENTAI_DISABLE_PROFILE_DIRECTORY',
    severity: 'required',
    purpose: 'Hides the staff directory (GET /api/auth/profiles).',
    impact: 'Every clinician name and id is enumerable by anyone who can reach the sign-in screen. Must be set for production governance.',
    howTo: 'Set to "true".',
  },
  {
    key: 'DENTAI_REQUIRE_CONSENT',
    severity: 'required',
    purpose: 'Refuses to store a transcript without recorded patient consent.',
    impact: 'Records can be saved without the AI-assist consent being captured — violating privacy disclosures.',
    howTo: 'Set to "true" once all clinicians are on the current client build.',
  },
  {
    key: 'DENTAI_DAILY_NOTE_LIMIT',
    severity: 'recommended',
    purpose: 'Global ceiling on AI notes per clinic per day (operator cost cap).',
    impact: 'Cost control relies on plan limits alone; a plan mistake becomes an invoice.',
    howTo: 'Integer, e.g. 60.',
  },
  {
    key: 'DENTAI_DAILY_TOKEN_LIMIT',
    severity: 'recommended',
    purpose: 'Global ceiling on transcript tokens per clinic per day (the real cost bound).',
    impact: 'One very long transcript can cost more than a day of short consults, and nothing stops it.',
    howTo: 'Integer, e.g. 200000.',
  },
  {
    key: 'DENTAI_DATA_DIR',
    severity: 'optional',
    purpose: 'Location of the JSON fallback store.',
    impact: 'Defaults to ./data. Never used when DATABASE_URL is set.',
    howTo: 'Absolute path; used by tests and operator tooling.',
  },
  {
    key: 'DENTAI_QUEUE_INTERVAL_MS',
    severity: 'optional',
    purpose: 'In-process queue drain interval for long-running hosts.',
    impact: 'Containers and VMs need this (or an external scheduler) or the queue only advances on traffic. Not used on serverless.',
    howTo: 'e.g. 60000.',
  },
  {
    key: 'DENTAI_RETENTION_ENABLED',
    severity: 'optional',
    purpose: 'Enables the retention sweep to actually change records.',
    impact: 'The 7-year retention promise in the privacy notice stays unexecuted; the sweep only reports.',
    howTo: 'Set to "true" after reviewing a dry run.',
  },
  {
    key: 'DENTAI_RETENTION_ACTION',
    severity: 'optional',
    purpose: 'What happens past the retention horizon: delete (default) or deidentify.',
    impact: 'Defaults to delete, which is the safer choice; de-identification of free text is only best-effort.',
    howTo: 'Set to "deidentify" only if a registry requires retained records.',
  },
  {
    key: 'STRIPE_SECRET_KEY',
    severity: 'optional',
    purpose: 'Creates subscription checkout sessions.',
    impact: 'Invoices must be raised manually; entitlements can still be activated from the operator console.',
    howTo: 'Stripe secret key (sk_live_…).',
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET',
    severity: 'optional',
    purpose: 'Verifies the signature on Stripe webhooks.',
    impact: 'Webhook processing is refused (fail-closed) so nobody can grant themselves a plan. Billing state must be entered manually.',
    howTo: 'Stripe webhook endpoint signing secret (whsec_…).',
  },
  {
    key: 'RESEND_API_KEY',
    severity: 'optional',
    purpose: 'Transactional email: invitations, recovery codes, receipts.',
    impact: 'Invite codes and recovery codes must be copied out of the UI by hand, and no receipt is sent.',
    howTo: 'Resend API key with the sending domain verified.',
  },
  {
    key: 'DENTAI_EMAIL_FROM',
    severity: 'optional',
    purpose: 'From address for transactional email.',
    impact: 'Email is disabled unless both this and RESEND_API_KEY are set.',
    howTo: 'e.g. DentAI <notifications@yourdomain.com.au> (SPF/DKIM/DMARC configured).',
  },
  {
    key: 'DENTAI_API_RATE_LIMIT',
    severity: 'optional',
    purpose: 'Global API rate limit per 15-minute window (default: 1500 in prod, 10000 in dev/test).',
    impact: 'Defaults to 1500 requests per 15 minutes per session or IP address.',
    howTo: 'Integer, e.g. 2000 or 3000.',
  },
];

export interface ConfigFinding {
  key: string;
  severity: ConfigSeverity;
  purpose: string;
  impact: string;
  howTo: string;
}

export interface ConfigCheckResult {
  environment: 'production' | 'development' | 'test';
  /** fatal + required problems (production only). */
  blocking: ConfigFinding[];
  /** recommended problems. */
  advisories: ConfigFinding[];
  /**
   * Optional integrations that are simply switched off. Reported so the
   * operator can see them, but they never affect readiness — a deployment that
   * invoices by hand is a legitimate business, not a broken one.
   */
  optional: ConfigFinding[];
  /** Set variables, for the operator view. */
  configured: string[];
  readiness: 'ready' | 'limited' | 'not_ready';
  summary: string;
}

export type EnvLike = Record<string, string | undefined>;

function environmentOf(nodeEnv: string | undefined): ConfigCheckResult['environment'] {
  if (nodeEnv === 'production') return 'production';
  if (nodeEnv === 'test') return 'test';
  return 'development';
}

/**
 * Evaluates the environment.
 *
 * In production, `required` problems make the deployment "not_ready" — the app
 * still runs (a clinic mid-consult must not lose a note because the founder
 * forgot a webhook URL), but health reports it and boot logs it loudly. Only
 * `fatal` findings throw.
 */
export function checkConfiguration(
  env: EnvLike = process.env,
  nodeEnv: string | undefined = env.NODE_ENV
): ConfigCheckResult {
  const environment = environmentOf(nodeEnv);
  const blocking: ConfigFinding[] = [];
  const advisories: ConfigFinding[] = [];
  const optional: ConfigFinding[] = [];
  const configured: string[] = [];

  for (const requirement of ENV_REQUIREMENTS) {
    if (requirement.envs && !requirement.envs.includes(environment)) continue;
    const value = env[requirement.key];
    const isSet = typeof value === 'string' && value.trim().length > 0;
    if (isSet) {
      configured.push(requirement.key);
      continue;
    }
    const finding: ConfigFinding = {
      key: requirement.key,
      severity: requirement.severity,
      purpose: requirement.purpose,
      impact: requirement.impact,
      howTo: requirement.howTo,
    };

    // Outside production nothing blocks: a missing DATABASE_URL locally is the
    // point of the JSON store, and nobody is owed an ops secret on a laptop.
    // Every finding is still reported, so the same list drives the go-live
    // checklist without pretending a dev machine is a deployment.
    if (requirement.severity === 'optional') optional.push(finding);
    else if (environment !== 'production') advisories.push(finding);
    else if (requirement.severity === 'fatal' || requirement.severity === 'required') {
      blocking.push(finding);
    } else advisories.push(finding);
  }

  const readiness: ConfigCheckResult['readiness'] =
    environment !== 'production'
      ? 'limited'
      : blocking.length > 0
        ? 'not_ready'
        : advisories.length > 0
          ? 'limited'
          : 'ready';

  const summary =
    readiness === 'ready'
      ? 'Configuration complete.'
      : `${blocking.length} blocking and ${advisories.length} advisory configuration item(s) outstanding.`;

  return { environment, blocking, advisories, optional, configured, readiness, summary };
}

/**
 * Throws only on `fatal` findings — a deployment that cannot store or sign
 * anything must not serve a patient record at all.
 */
export function assertStartupConfiguration(result: ConfigCheckResult): void {
  const fatal = result.blocking.filter((f) => f.severity === 'fatal');
  if (result.environment === 'production' && fatal.length > 0) {
    throw new Error(
      `Refusing to start: ${fatal.map((f) => f.key).join(', ')} must be set in production. ` +
        fatal.map((f) => `${f.key}: ${f.purpose} ${f.howTo}`).join(' | ')
    );
  }
}

/** One-line log block an operator can read at a glance in the deploy output. */
export function describeConfiguration(result: ConfigCheckResult): string {
  const parts = [
    `DentAI configuration (${result.environment}): ${result.readiness}`,
    `${result.configured.length} variable(s) set`,
  ];
  if (result.blocking.length) {
    parts.push(`BLOCKING: ${result.blocking.map((f) => f.key).join(', ')}`);
  }
  if (result.advisories.length) {
    parts.push(`Advisory: ${result.advisories.map((f) => f.key).join(', ')}`);
  }
  return parts.join(' | ');
}
