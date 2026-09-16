import React from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

/**
 * In-app privacy notice and terms of service.
 *
 * These are the user-facing legal documents a dental practice is asked to
 * accept, so they must stay accurate about how DentAI actually behaves —
 * especially about AI processing and where data goes. If processing changes,
 * update src/lib/compliance.ts (disclosure versions) and this file together.
 *
 * Entity details are read from LEGAL_ENTITY below. Fill these in before a
 * clinic signs: they are the "who is the data controller / who do I contact"
 * answers, and a clinic's own privacy policy will point at them.
 */
const LEGAL_ENTITY = {
  tradingName: 'DentAI',
  legalName: 'DentAI (sole trader)',
  abn: 'ABN to be inserted before commercial use',
  address: 'Victoria, Australia',
  contactEmail: 'privacy@dentai.app',
  governingJurisdiction: 'Victoria, Australia',
  lastUpdated: '16 September 2026',
};

interface LegalPageProps {
  page: 'privacy' | 'terms';
  onExit: () => void;
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-7">
    <h2 className="text-base font-extrabold tracking-tight text-slate-800">{title}</h2>
    <div className="mt-2 flex flex-col gap-2 text-sm leading-relaxed text-slate-600">{children}</div>
  </section>
);

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="ml-4 list-disc flex flex-col gap-1">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

export default function LegalPage({ page, onExit }: LegalPageProps) {
  return (
    <div className="min-h-screen w-full bg-[#F8F7F5] px-4 py-12 font-sans">
      <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-7 shadow-sm md:p-10">
        <button
          onClick={onExit}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>

        <div className="mt-5 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">
              {page === 'privacy' ? 'Privacy notice' : 'Terms of service'}
            </h1>
            <p className="text-xs text-slate-500">
              {LEGAL_ENTITY.tradingName} · Last updated {LEGAL_ENTITY.lastUpdated}
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
          <strong>Important:</strong> DentAI drafts clinical documentation. It does not diagnose, prescribe, or replace
          clinical judgement. The treating practitioner reviews, corrects and remains responsible for every record and
          every communication sent to a patient.
        </div>

        {page === 'privacy' ? (
          <>
            <Section title="Who we are">
              <p>
                {LEGAL_ENTITY.legalName} ({LEGAL_ENTITY.abn}), trading as {LEGAL_ENTITY.tradingName}, {LEGAL_ENTITY.address}.
                We provide clinical documentation software to dental practices. Questions or requests can be sent to{' '}
                <a className="underline" href={`mailto:${LEGAL_ENTITY.contactEmail}`}>{LEGAL_ENTITY.contactEmail}</a>.
              </p>
              <p>
                Your dental practice is the entity responsible for the patient records it holds. DentAI is the software
                provider that processes that information on the practice's behalf.
              </p>
            </Section>

            <Section title="What we collect">
              <Bullets
                items={[
                  'Clinician account details: name, specialty, PIN (stored only as a salted PBKDF2 hash — never in plain text) and clinic memberships.',
                  'Patient details entered for a consultation: name, date of birth, appointment type, clinical notes, transcripts of the consultation, generated drafts and any patient correspondence.',
                  'Consent evidence: whether AI-assist consent was obtained, when, and which disclosure wording was shown.',
                  'Access and change logs: who signed in, who opened a patient record, who changed a note, and when. Logs contain identifiers and event types, not clinical content.',
                ]}
              />
            </Section>

            <Section title="How the information is used">
              <p>
                Patient information is processed to transcribe a consultation and draft a clinical note for the treating
                practitioner to review, and to store the resulting record for the practice. We do not sell information,
                do not use patient records to train third-party models, and do not use them for advertising.
              </p>
            </Section>

            <Section title="AI processing and where data goes">
              <Bullets
                items={[
                  'Consultation content (transcript plus intake details) is sent to Google (Gemini / Vertex AI) to draft the note. Google processes it only to return the draft.',
                  'Where configured, processing runs in an Australian region. If the Australian route is unavailable, processing may occur outside Australia — the app records which engine produced each draft, and clinicians are told when a draft was produced by an offline fallback on their own device.',
                  'Live transcription from a microphone is performed by the browser engine or by Google Cloud Speech-to-Text; where the browser engine is used, audio is processed by the browser vendor. A non-AI offline draft engine can be used instead, which keeps the content on the device.',
                  'Records are stored in our managed Postgres database (Neon) and the application is hosted on Vercel. Both are contracted service providers bound to use the data only to deliver the service.',
                ]}
              />
            </Section>

            <Section title="Security">
              <p>
                Access requires an individual clinician profile and PIN, sessions expire, repeated failed attempts lock
                an account, sessions can be revoked remotely, and every credential change is logged. Data is encrypted in
                transit and at rest by our hosting and database providers. We keep an append-only access log so a
                practice owner can see who accessed which record.
              </p>
            </Section>

            <Section title="Retention and deletion">
              <p>
                Records are retained for the practice's retention period (default seven years for adult patients, in line
                with Australian dental record-keeping expectations) and then deleted or de-identified. A practice can
                export its records, and can request deletion of a clinician account or a patient record by contacting{' '}
                {LEGAL_ENTITY.contactEmail}. Deleting a clinician account signs them out and removes their access; it does
                not delete the practice's patient records.
              </p>
            </Section>

            <Section title="Your rights and complaints">
              <Bullets
                items={[
                  'Patients and clinicians may request access to information we hold about them, and ask for corrections.',
                  'A patient who wants a copy of, or a correction to, their clinical record should contact their dental practice first — the practice holds the record.',
                  'If you believe your privacy has been interfered with, contact us first. If you are not satisfied, you may complain to the Office of the Australian Information Commissioner (oaic.gov.au).',
                  'If a data breach occurs that is likely to result in serious harm, we notify affected individuals and the Commissioner under the Notifiable Data Breaches scheme.',
                ]}
              />
            </Section>
          </>
        ) : (
          <>
            <Section title="Agreement">
              <p>
                These terms govern use of {LEGAL_ENTITY.tradingName} software by a dental practice and its clinicians. By
                creating an account or using the software, you agree to them on behalf of yourself and, where applicable,
                the practice you work for.
              </p>
            </Section>

            <Section title="What the service does">
              <p>
                DentAI records a consultation, produces a draft clinical note and patient correspondence, and stores the
                reviewed record. Drafts may be produced by a hosted AI model or, where the hosted model is unavailable, by
                a deterministic offline engine or a model running on the device. Every draft carries a note of which engine
                produced it.
              </p>
            </Section>

            <Section title="Clinical responsibility">
              <Bullets
                items={[
                  'DentAI is documentation software. It is not a diagnostic device and does not provide clinical advice.',
                  'The treating practitioner must review and correct every draft before it is saved or sent, and remains solely responsible for the content of the clinical record and any patient communication.',
                  'Where a draft is flagged for review, it must not be relied upon until it has been reviewed.',
                  'The practice is responsible for obtaining patient consent to AI-assisted documentation and for complying with its own record-keeping and privacy obligations.',
                ]}
              />
            </Section>

            <Section title="Your account and access">
              <Bullets
                items={[
                  'Keep your PIN confidential. Do not share a profile; each clinician has their own account, and the access log attributes activity to the account used.',
                  'Report a suspected compromise immediately; an administrator can issue a single-use recovery code and sign out all sessions.',
                  'A practice owner administers clinic membership. One account is intended for one person.',
                ]}
              />
            </Section>

            <Section title="Availability, fees and changes">
              <p>
                We aim to keep the service available but do not promise uninterrupted service. Where a hosted AI provider is
                unavailable or a daily usage allowance is reached, the software offers an offline draft rather than blocking
                the consultation. Fees, usage allowances and plan limits are those agreed with your practice or shown in the
                product. We may change these terms; material changes will be notified in the product.
              </p>
            </Section>

            <Section title="Liability">
              <p>
                Nothing in these terms excludes rights that cannot be excluded under the Australian Consumer Law. Subject to
                that, our liability is limited to the fees paid for the service in the twelve months before a claim, and we
                are not liable for indirect or consequential loss.
              </p>
            </Section>

            <Section title="Termination and governing law">
              <p>
                You may stop using the service at any time; a practice may export its records before closing its account.
                These terms are governed by the laws of {LEGAL_ENTITY.governingJurisdiction}, and the courts of that
                jurisdiction have non-exclusive jurisdiction.
              </p>
            </Section>
          </>
        )}

        <p className="mt-8 text-[11px] leading-relaxed text-slate-400">
          Entity details, fees and retention periods in this document must match the practice's agreement. Questions:{' '}
          <a className="underline" href={`mailto:${LEGAL_ENTITY.contactEmail}`}>{LEGAL_ENTITY.contactEmail}</a>.
        </p>
      </div>
    </div>
  );
}
