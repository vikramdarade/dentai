import { type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  ClipboardCheck,
  Clock,
  FileText,
  Languages,
  LayoutTemplate,
  Lock,
  Mic,
  ShieldCheck,
  Sparkles,
  WifiOff
} from 'lucide-react';

interface LandingProps {
  onGetStarted: () => void;
}

const NAV_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#formats', label: 'Formats' },
  { href: '#/demo', label: 'Watch 3-Min Demo' }
];

function ToothMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 5.6C10.2 4.3 7.2 4.4 5.8 6.9c-1 1.7-.9 4.1.3 6.7.8 1.8 1.4 3 2.1 4.1.5.8 1 .9 1.3.9.7 0 .6-2.9 1.3-2.9.8 0 .6 2.9 1.3 2.9.8 0 .6-2.9 1.4-2.9.7 0 .6 2.9 1.3 2.9.3 0 .9-.2 1.4-1.1.7-1 1.4-2.4 2.1-4.2 1.1-2.6 1.1-5 .2-6.6-1.4-2.4-4.3-2.7-6.4-1.3z" />
    </svg>
  );
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white px-4 py-1.5 shadow-sm">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-primary">{children}</span>
    </div>
  );
}

function SectionHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
      <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-relaxed text-slate-500">{sub}</p>
    </div>
  );
}

export default function Landing({ onGetStarted }: LandingProps) {
  return (
    <div className="min-h-screen bg-[#F8F7F5] font-sans text-on-surface">
      {/* ---------- Nav ---------- */}
      <header className="sticky top-0 z-50 border-b border-slate-200/60 bg-[#F8F7F5]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:px-8">
          <a href="#top" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-md shadow-primary/25">
              <ToothMark className="h-5 w-5" />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-slate-900">
              Dent<span className="text-primary">AI</span>
            </span>
          </a>

          <nav className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map(link => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-semibold text-slate-500 transition-colors hover:text-primary"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <button
            onClick={onGetStarted}
            className="flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-white shadow-md shadow-primary/25 transition-all hover:bg-primary-dark cursor-pointer"
          >
            Open the app
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section id="top" className="relative overflow-hidden">
        {/* Soft grid + glow backdrop */}
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(15,82,186,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,82,186,0.045)_1px,transparent_1px)] bg-[size:52px_52px]"
          style={{
            maskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, black 40%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, black 40%, transparent 100%)'
          }}
        />
        <div className="pointer-events-none absolute -top-32 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-indigo-200/40 blur-[130px]" />
        <div className="pointer-events-none absolute -left-24 top-40 h-72 w-72 rounded-full bg-sky-200/30 blur-[110px]" />

        <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-5 pb-20 pt-16 md:px-8 md:pt-24 lg:grid-cols-2">
          {/* Copy */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
          >
            <SectionEyebrow>Ambient clinical documentation</SectionEyebrow>

            <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 md:text-6xl">
              Your clinical notes,{' '}
              <span className="bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent">
                written while you treat.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-500 md:text-lg">
              DentAI turns the dentist–patient conversation into structured, compliance-aligned
              clinical notes — with ADA billing codes and a plain-language patient care letter —
              in seconds, not evenings.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                onClick={onGetStarted}
                className="group flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-7 text-sm font-bold text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary-dark cursor-pointer"
              >
                Try DentAI free
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <a
                href="#how-it-works"
                className="flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-7 text-sm font-bold text-slate-700 shadow-sm transition-all hover:border-indigo-200 hover:text-primary"
              >
                See how it works
              </a>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-400">
              <span className="flex items-center gap-1.5">
                <BadgeCheck className="h-4 w-4 text-emerald-500" /> No credit card
              </span>
              <span className="flex items-center gap-1.5">
                <BadgeCheck className="h-4 w-4 text-emerald-500" /> No setup fee
              </span>
              <span className="flex items-center gap-1.5">
                <BadgeCheck className="h-4 w-4 text-emerald-500" /> First note in minutes
              </span>
            </div>
          </motion.div>

          {/* Product mock */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.32, 0.72, 0, 1] }}
            className="relative mx-auto w-full max-w-md"
          >
            {/* Floating accent chips */}
            <div className="glass-panel absolute -left-6 top-8 z-20 hidden items-center gap-2 rounded-2xl px-4 py-2.5 sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-light text-primary">
                <Languages className="h-4 w-4" />
              </span>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">FDI notation</span>
                <span className="text-xs font-bold text-slate-800">“dirty tree” → 33</span>
              </div>
            </div>
            <div className="glass-panel absolute -right-4 -top-4 z-20 hidden items-center gap-2 rounded-2xl px-4 py-2.5 sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <ClipboardCheck className="h-4 w-4" />
              </span>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ADA codes</span>
                <span className="text-xs font-bold text-slate-800">011 · 111 · 511</span>
              </div>
            </div>

            {/* Summary card */}
            <div className="relative z-10 rounded-[2rem] border border-slate-200/70 bg-white p-6 shadow-2xl shadow-primary/10">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-sm font-extrabold text-primary">
                    SM
                  </div>
                  <div>
                    <p className="text-sm font-extrabold text-slate-800">Sarah M.</p>
                    <p className="text-[11px] font-semibold text-slate-400">Scale & clean · 09:45 AM</p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-emerald-600">
                  In review
                </span>
              </div>

              <div className="mt-4 space-y-3.5">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-primary">Chief complaint</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Bleeding gums when brushing, sensitivity on cold drinks.
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-primary">Findings</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Tooth 16 — 3-2-3 mm pocket depths. Moderate supragingival calculus (FDI 33–43 region).
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-primary">Treatment performed</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Scale and clean, ultrasonic + hand instrumentation, fluoride application.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-1.5">
                {['011', '111', '114', '121'].map(code => (
                  <span
                    key={code}
                    className="rounded-md border border-indigo-100 bg-indigo-50/70 px-2 py-1 font-mono text-[10px] font-bold text-indigo-600"
                  >
                    ADA {code}
                  </span>
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-slate-100 bg-[#F8F7F5] p-3.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Patient letter</p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  “Hi Sarah — we cleaned your teeth today and found some early signs of gum
                  inflammation. Keep up the daily flossing around the back molars…”
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ---------- Stats strip ---------- */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
          className="relative mx-auto max-w-7xl px-5 pb-20 md:px-8"
        >
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-200/60 shadow-sm sm:grid-cols-3">
            {[
              { icon: Clock, value: '5–10 min', label: 'saved per patient note — no more evening charting backlog' },
              { icon: CalendarClock, value: '8 templates', label: 'One tailored note template per treatment type — exam, hygiene, emergency, restorative, endo, surgical, crown & bridge, paediatric' },
              { icon: Sparkles, value: '1 click', label: 'from conversation to structured notes, ADA codes & patient letter' }
            ].map(stat => (
              <div key={stat.label} className="flex flex-col gap-2 bg-white p-6">
                <stat.icon className="h-5 w-5 text-primary" />
                <p className="text-2xl font-extrabold tracking-tight text-slate-900">{stat.value}</p>
                <p className="text-sm leading-relaxed text-slate-500">{stat.label}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how-it-works" className="relative py-20 md:py-24">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <SectionHeading
            title="From consultation to charted in three steps"
            sub="No typing while you treat. No shorthand to remember. No notes left for the end of the day."
          />

          <div className="relative mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="pointer-events-none absolute left-[16%] right-[16%] top-9 hidden border-t-2 border-dashed border-indigo-100 md:block" />
            {[
              {
                icon: FileText,
                step: '01',
                title: 'Start a consult',
                body: 'Enter the patient’s name, DOB and appointment type — exam, scale & clean or emergency.'
              },
              {
                icon: Mic,
                step: '02',
                title: 'Treat & talk',
                body: 'The consultation flows in as a live transcript while you work. Recordings survive idle time and even a session timeout.'
              },
              {
                icon: ClipboardCheck,
                step: '03',
                title: 'Review & paste',
                body: 'AI structures the findings, ADA item codes and a patient letter. Edit, save, and you’re done.'
              }
            ].map((item, i) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="relative rounded-2xl border border-slate-200/70 bg-white p-7 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-white shadow-md shadow-primary/25">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <span className="font-mono text-sm font-extrabold text-slate-200">{item.step}</span>
                </div>
                <h3 className="mt-5 text-lg font-extrabold tracking-tight text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{item.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section id="features" className="bg-white py-20 md:py-24">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <SectionHeading
            title="Built for the way clinics actually work"
            sub="Every feature exists to get one thing done: a complete, compliant clinical note with zero typing during the appointment."
          />

          <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: FileText,
                title: 'Structured clinical notes',
                body: 'Chief complaint, history, tooth findings in FDI notation, gingival state, diagnosis, treatment, recommendations and recall — every time.'
              },
              {
                icon: ClipboardCheck,
                title: 'ADA billing codes extracted',
                body: 'Item codes like 011, 111 and 511 are pulled straight from the conversation, so billing capture stops being guesswork.'
              },
              {
                icon: Sparkles,
                title: 'Patient care letter',
                body: 'A warm, jargon-free summary the patient can read, print or take home — building trust and follow-through on every plan.'
              },
              {
                icon: LayoutTemplate,
                title: 'Your clinic’s template',
                body: 'Match AHPRA 8-point, SOAP or restorative formats — or define custom section headings that mirror your practice macros.'
              },
              {
                icon: Languages,
                title: 'Accent-resilient parsing',
                body: 'Phonetic variants of tooth numbers and clinical terms are resolved to correct FDI notation — “dirty tree” becomes 33, every time.'
              },
              {
                icon: ShieldCheck,
                title: 'Offline-safe & secure',
                body: 'PIN-protected profiles, an audit log and session lock. Notes queue locally when the network drops and sync when it returns.'
              }
            ].map((feat, i) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.45, delay: (i % 3) * 0.08 }}
                className="group rounded-2xl border border-slate-200/70 bg-[#F8F7F5] p-6 transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:bg-white hover:shadow-lg hover:shadow-primary/5"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-primary shadow-sm ring-1 ring-slate-200/70 transition-colors group-hover:bg-primary group-hover:text-white">
                  <feat.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-base font-extrabold tracking-tight text-slate-900">{feat.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{feat.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Formats / compatibility ---------- */}
      <section id="formats" className="py-20 md:py-24">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5 }}
            >
              <SectionEyebrow>Fits your workflow</SectionEyebrow>
              <h2 className="mt-5 text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">
                One note, ready for your system and your standards.
              </h2>
              <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-500">
                DentAI doesn’t force a new documentation religion on your practice. It adapts to
                the formats your clinic already uses, writes in en-AU clinical English, and
                keeps records aligned with the Dental Board of Australia’s record-keeping
                guidelines.
              </p>
              <div className="mt-8 flex flex-wrap gap-2.5">
                {[
                  'AHPRA 8-point standard',
                  'SOAP format',
                  'Restorative & endo focus',
                  'Custom clinic templates',
                  'FDI tooth notation',
                  'ADA item codes',
                  'en-AU spelling'
                ].map(tag => (
                  <span
                    key={tag}
                    className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-600 shadow-sm"
                  >
                    <BadgeCheck className="h-3.5 w-3.5 text-primary" />
                    {tag}
                  </span>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5 }}
              className="glass-panel rounded-3xl p-7"
            >
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-400">
                <Lock className="h-3.5 w-3.5 text-primary" />
                Clinical data handling
              </div>
              <ul className="mt-5 space-y-4">
                {[
                  { icon: Lock, text: 'PIN-protected dentist profiles — no shared logins, full audit trail' },
                  { icon: WifiOff, text: 'Notes save locally first and sync when the network returns' },
                  { icon: ShieldCheck, text: 'Prompt-injection sanitization and payload limits at the API edge' },
                  { icon: FileText, text: 'Patient records never logged in cleartext; keys stay server-side' }
                ].map(item => (
                  <li key={item.text} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
                      <item.icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-sm leading-relaxed text-slate-600">{item.text}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ---------- CTA band ---------- */}
      <section className="px-5 pb-20 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.55 }}
          className="relative mx-auto max-w-7xl overflow-hidden rounded-[2.5rem] bg-[#0B1F3A] px-6 py-16 text-center shadow-2xl shadow-primary/20 md:py-20"
        >
          <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/30 blur-[100px]" />
          <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-indigo-500/20 blur-[100px]" />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35] bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:44px_44px]"
          />

          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.18em] text-white/90 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Free to try · No card · No setup fee
            </span>
            <h2 className="mx-auto mt-6 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight text-white md:text-5xl">
              See your next note written for you.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-300">
              Create a dentist profile, start a consultation, and watch the conversation become a
              complete clinical note — in minutes, not evenings.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                onClick={onGetStarted}
                className="group flex h-13 items-center justify-center gap-2 rounded-xl bg-white px-8 text-sm font-extrabold text-[#0B1F3A] shadow-lg transition-all hover:bg-indigo-50 cursor-pointer"
              >
                Open the app — it’s free
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <a
                href="#features"
                className="flex h-13 items-center justify-center rounded-xl border border-white/20 px-8 text-sm font-bold text-white transition-colors hover:bg-white/10"
              >
                Explore features
              </a>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="border-t border-slate-200/70 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-5 py-10 md:flex-row md:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
              <ToothMark className="h-4.5 w-4.5" />
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-extrabold tracking-tight text-slate-900">
                Dent<span className="text-primary">AI</span>
              </span>
              <span className="text-[11px] font-semibold text-slate-400">
                Clinical documentation copilot
              </span>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-slate-400">
            Built for dental practices. Your data stays yours.
          </p>

          <div className="flex items-center gap-6 text-xs font-semibold text-slate-400">
            <a href="#top" className="transition-colors hover:text-primary">Back to top</a>
            <span>© {new Date().getFullYear()} DentAI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
