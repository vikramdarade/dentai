/**
 * Transactional email.
 *
 * There was no email path at all, which had three visible consequences:
 * invitations were copied out of the UI by hand, PIN recovery codes had to be
 * read aloud by the founder, and no receipt or onboarding message ever reached a
 * practice. Email is also what makes self-serve recovery possible.
 *
 * Provider: **Resend**, called over plain `fetch` (no SDK, no new dependency,
 * nothing to keep updated). It is chosen because the free tier covers a solo
 * founder's onboarding volume, the API is one POST, and the sending domain setup
 * (SPF/DKIM/DMARC) is the standard one.
 *
 * Key handling: the API key is read from the environment inside the server
 * process and never leaves it — the client only learns whether email is
 * available via the operator endpoints.
 *
 * Without RESEND_API_KEY and DENTAI_EMAIL_FROM, `send()` reports
 * `provider: 'disabled'` rather than throwing, so every caller has exactly one
 * behaviour to handle and the product still works (codes are shown in the UI).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface EmailResult {
  sent: boolean;
  provider: 'resend' | 'disabled';
  id?: string;
  error?: string;
}

export interface EmailerDeps {
  env?: Record<string, string | undefined>;
  logger: {
    info: (message: string, context?: Record<string, any>) => void;
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface Emailer {
  configured: boolean;
  from: string | null;
  send(message: EmailMessage): Promise<EmailResult>;
  /** True when the recipient is at least shaped like an address. */
  canSendTo: (address: unknown) => boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function defaultFrom(env: Record<string, string | undefined> = process.env): string | null {
  const address = env.DENTAI_EMAIL_FROM;
  return address && address.trim() ? address.trim() : null;
}

export function isEmailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.RESEND_API_KEY && !!defaultFrom(env);
}

export function createEmailer(deps: EmailerDeps): Emailer {
  const env = deps.env || process.env;
  const apiKey = env.RESEND_API_KEY || '';
  const from = defaultFrom(env);
  const configured = !!apiKey && !!from;
  const fetchImpl = deps.fetchImpl || fetch;
  const timeoutMs = deps.timeoutMs ?? 8000;

  return {
    configured,
    from,
    canSendTo(address: unknown) {
      return typeof address === 'string' && EMAIL_PATTERN.test(address.trim());
    },
    async send(message) {
      if (!configured) {
        // Not an error: this is a supported deployment state (email off), and
        // callers surface codes in the UI instead.
        deps.logger.info('Email is not configured; message not sent.', {
          subject: message.subject,
        });
        return { sent: false, provider: 'disabled' };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            reply_to: message.replyTo,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          deps.logger.error('Transactional email was rejected by the provider.', undefined, {
            status: response.status,
            // The provider's message can echo the recipient; keep it short.
            body: body.slice(0, 300),
          });
          return { sent: false, provider: 'resend', error: `provider_status_${response.status}` };
        }

        const payload: any = await response.json().catch(() => ({}));
        return { sent: true, provider: 'resend', id: payload?.id };
      } catch (err: any) {
        clearTimeout(timer);
        deps.logger.error('Transactional email failed to send:', err?.message || err, {
          subject: message.subject,
        });
        return { sent: false, provider: 'resend', error: err?.message || 'send_failed' };
      }
    },
  };
}

/* ---------------------------------------------------------------------------
 * Templates
 *
 * Pure functions so wording can be tested and reviewed as text rather than
 * discovered in a sent message. None of them contain patient information.
 * ------------------------------------------------------------------------- */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(heading: string, paragraphs: string[], action?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(action.url)}" style="background:#0f766e;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>`
    : '';
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">
<h2 style="margin:0 0 16px;font-size:19px">${escapeHtml(heading)}</h2>
${body}${button}
<p style="margin:22px 0 0;color:#64748b;font-size:13px">DentAI — AI-assisted clinical notes for Australian dental practices. This message contains no patient information.</p>
</div>`;
}

export function welcomeEmail(params: { name: string; practiceName: string; signInUrl: string }): RenderedEmail {
  const first = params.name.split(' ')[0] || 'there';
  const paragraphs = [
    `Hi ${first},`,
    `Your DentAI workspace for ${params.practiceName} is ready. Record or type a consultation, review the generated draft, and save it to the patient record — the treating practitioner always has the final say.`,
    'Set your PIN, then record a short test consultation so you know what to expect before your next patient.',
  ];
  return {
    subject: `Your DentAI workspace for ${params.practiceName} is ready`,
    text: paragraphs.join('\n\n') + `\n\nSign in: ${params.signInUrl}`,
    html: layout('Welcome to DentAI', paragraphs, { label: 'Sign in', url: params.signInUrl }),
  };
}

export function inviteEmail(params: {
  practiceName: string;
  invitedByName: string;
  inviteCode: string;
  signUpUrl: string;
}): RenderedEmail {
  const paragraphs = [
    `${params.invitedByName} has invited you to join ${params.practiceName} on DentAI.`,
    `Use invite code ${params.inviteCode} when you create your profile. The practice owner approves your access, so you can start your first consultation as soon as that is done.`,
    'DentAI drafts clinical notes from a consultation recording or a typed transcript. Every draft is reviewed and signed off by you before it is saved.',
  ];
  return {
    subject: `${params.invitedByName} invited you to ${params.practiceName} on DentAI`,
    text:
      paragraphs.join('\n\n') +
      `\n\nCreate your profile: ${params.signUpUrl}\nInvite code: ${params.inviteCode}`,
    html: layout(`Join ${params.practiceName} on DentAI`, paragraphs, {
      label: 'Create your profile',
      url: params.signUpUrl,
    }),
  };
}

export function recoveryCodeEmail(params: {
  name: string;
  recoveryCode: string;
  expiresMinutes: number;
}): RenderedEmail {
  const paragraphs = [
    `Hi ${params.name.split(' ')[0] || 'there'},`,
    `A recovery code has been issued for your DentAI profile. Use it to set a new PIN from the sign-in screen. It works once and expires in ${params.expiresMinutes} minutes.`,
    'If you did not ask for this, tell your practice administrator — someone may have requested access to your profile.',
  ];
  return {
    subject: 'Your DentAI recovery code',
    text: paragraphs.join('\n\n') + `\n\nRecovery code: ${params.recoveryCode}`,
    html: layout('Your DentAI recovery code', paragraphs) +
      `<p style="font-size:20px;letter-spacing:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(params.recoveryCode)}</p>`,
  };
}

export function receiptEmail(params: {
  practiceName: string;
  planName: string;
  amountAud: number;
  periodEnd: string;
  invoiceUrl?: string;
  abn?: string;
}): RenderedEmail {
  const abn = params.abn || process.env.DENTAI_ABN || '';
  const header = abn ? `PAYMENT RECEIPT — DentAI (ABN: ${abn})` : 'PAYMENT RECEIPT — DentAI';

  const paragraphs = [
    header,
    `Customer: ${params.practiceName}`,
    `Subscription: ${params.planName} Plan (current period ends ${params.periodEnd})`,
    `Total Paid: A$${params.amountAud.toFixed(2)} AUD`,
    'This receipt confirms your monthly subscription payment. You can view past payments or update billing details anytime via the practice billing portal.',
  ];
  return {
    subject: `Payment Receipt — DentAI ${params.planName} for ${params.practiceName}`,
    text: paragraphs.join('\n\n') + (params.invoiceUrl ? `\n\nReceipt: ${params.invoiceUrl}` : ''),
    html: layout('Payment Receipt', paragraphs, params.invoiceUrl
      ? { label: 'View Receipt in Stripe', url: params.invoiceUrl }
      : undefined),
  };
}

export function accessChangedEmail(params: {
  name: string;
  practiceName: string;
  change: 'joined' | 'approved' | 'declined' | 'removed';
}): RenderedEmail {
  const lines: Record<typeof params.change, string> = {
    joined: `Your request to join ${params.practiceName} has been sent to the practice owner.`,
    approved: `Your access to ${params.practiceName} has been approved. You can record consultations for this practice now.`,
    declined: `Your request to join ${params.practiceName} was declined. Ask the practice owner if this looks wrong.`,
    removed: `Your access to ${params.practiceName} has been removed. Your own patients and records are unaffected.`,
  };
  const text = lines[params.change];
  return {
    subject: `DentAI access update — ${params.practiceName}`,
    text: `${text}\n\nThis message contains no patient information.`,
    html: layout('Access update', [text]),
  };
}
