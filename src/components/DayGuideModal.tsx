import React from 'react';
import { LifeBuoy, Play, X, Send, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';

export interface DayGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  guideActiveTab: 'phases' | 'hotkeys' | 'dictation' | 'pms' | 'github';
  setGuideActiveTab: (tab: 'phases' | 'hotkeys' | 'dictation' | 'pms' | 'github') => void;
  guideGhTitle: string;
  setGuideGhTitle: (val: string) => void;
  guideGhDescription: string;
  setGuideGhDescription: (val: string) => void;
  guideGhCategory: string;
  setGuideGhCategory: (val: string) => void;
  guideGhPriority: string;
  setGuideGhPriority: (val: string) => void;
  guideGhToken: string;
  setGuideGhToken: (val: string) => void;
  guideGhSubmitting: boolean;
  guideGhResult: { ok: boolean; issueNumber?: number; issueUrl?: string; error?: string } | null;
  handleSubmitChairsideGitHubIssue: (e: React.FormEvent) => void;
}

export const DayGuideModal: React.FC<DayGuideModalProps> = ({
  isOpen,
  onClose,
  guideActiveTab,
  setGuideActiveTab,
  guideGhTitle,
  setGuideGhTitle,
  guideGhDescription,
  setGuideGhDescription,
  guideGhCategory,
  setGuideGhCategory,
  guideGhPriority,
  setGuideGhPriority,
  guideGhToken,
  setGuideGhToken,
  guideGhSubmitting,
  guideGhResult,
  handleSubmitChairsideGitHubIssue,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 sm:p-8 text-left relative my-8 animate-in fade-in duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-800 text-white flex items-center justify-center shadow-xs">
              <LifeBuoy className="w-5 h-5 text-teal-200" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                Clinician Operatory Guide & Support
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Apple Medical Grade workflow reference, hands-free hotkeys & direct GitHub dispatch
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <a
              href="#/demo"
              target="_blank"
              rel="noreferrer"
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100/80 text-primary text-xs font-bold border border-indigo-200 transition cursor-pointer"
              title="Watch narrated 3-minute product demo"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Watch 3-Min Demo</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center space-x-1.5 mt-4 pb-2 border-b border-slate-100 overflow-x-auto text-xs font-bold">
          <button
            type="button"
            onClick={() => setGuideActiveTab('phases')}
            className={`px-3.5 py-1.5 rounded-xl transition ${guideActiveTab === 'phases' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            4-Phase Day Flow
          </button>
          <button
            type="button"
            onClick={() => setGuideActiveTab('hotkeys')}
            className={`px-3.5 py-1.5 rounded-xl transition ${guideActiveTab === 'hotkeys' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            Operatory Hotkeys
          </button>
          <button
            type="button"
            onClick={() => setGuideActiveTab('dictation')}
            className={`px-3.5 py-1.5 rounded-xl transition ${guideActiveTab === 'dictation' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            Dental Phonetics
          </button>
          <button
            type="button"
            onClick={() => setGuideActiveTab('pms')}
            className={`px-3.5 py-1.5 rounded-xl transition ${guideActiveTab === 'pms' ? 'bg-teal-800 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            PMS 1-Click Paste
          </button>
          <button
            type="button"
            onClick={() => setGuideActiveTab('github')}
            className={`px-3.5 py-1.5 rounded-xl transition flex items-center space-x-1.5 ${guideActiveTab === 'github' ? 'bg-teal-700 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            <Send className="w-3 h-3" />
            <span>Request Feature (GitHub)</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="mt-4 text-xs text-slate-600 space-y-4 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
          {guideActiveTab === 'phases' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-800 block mb-1">
                  PHASE 1 • MORNING CLINICAL SETUP
                </span>
                <h4 className="text-xs font-bold text-slate-900 mb-1">Operatory Roster & Audio Verification</h4>
                <p className="leading-relaxed text-slate-600">
                  Verify your day's patient roster in the left rail. For walk-in patients, click <strong>+ Encounter</strong> to add them in 5 seconds. The microphone defaults to <span className="font-mono text-sky-700 font-bold">STANDBY (00:00)</span> with zero runaway audio.
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-800 block mb-1">
                  PHASE 2 • CHAIRSIDE APPOINTMENT
                </span>
                <h4 className="text-xs font-bold text-slate-900 mb-1">Hands-Free Audio & Noise Filter</h4>
                <p className="leading-relaxed text-slate-600">
                  Seat the patient and tap <kbd className="px-1 py-0.5 bg-white border rounded font-mono text-[10px]">Spacebar</kbd>. The ascending chime confirms listening. The smart noise filter automatically quiets dental drills and background sounds.
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-800 block mb-1">
                  PHASE 3 • POST-OP TURNOVER
                </span>
                <h4 className="text-xs font-bold text-slate-900 mb-1">Inline Notes & 1-Click Clipboard Copy</h4>
                <p className="leading-relaxed text-slate-600">
                  Click directly into Subjective, Objective, Assessment, or Plan to customize any sentence with zero lag. Press <kbd className="px-1 py-0.5 bg-white border rounded font-mono text-[10px]">⌘C</kbd> to copy the formatted note for immediate insertion into your practice software.
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-800 block mb-1">
                  PHASE 4 • END-OF-DAY RECONCILIATION
                </span>
                <h4 className="text-xs font-bold text-slate-900 mb-1">End-of-Day Notes Review</h4>
                <p className="leading-relaxed text-slate-600">
                  Press <kbd className="px-1 py-0.5 bg-white border rounded font-mono text-[10px]">⌘B</kbd> to open End-of-Day Notes. Verify all encounters are completed and billed. Leave the practice on time with zero evening charting backlog.
                </p>
              </div>
            </div>
          )}

          {guideActiveTab === 'hotkeys' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                <h4 className="font-bold text-slate-900 mb-1">Hands-Free Keyboard Shortcuts</h4>
                <p className="text-slate-600">
                  Designed so you can navigate quickly using a keyboard or foot pedal without touching the mouse.
                </p>
              </div>

              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                    <tr>
                      <th className="p-3">Shortcut</th>
                      <th className="p-3">Action</th>
                      <th className="p-3">Clinical Benefit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    <tr>
                      <td className="p-3 font-mono font-bold text-teal-800">Spacebar</td>
                      <td className="p-3 font-bold text-slate-800">Toggle Audio (Start / Pause / Resume / Keep Listening)</td>
                      <td className="p-3 text-slate-500">Hands-free foot pedal or keyboard tap</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono font-bold text-teal-800">⌘C / Ctrl+C</td>
                      <td className="p-3 font-bold text-slate-800">Copy Formatted Note for PMS</td>
                      <td className="p-3 text-slate-500">Pasting into Dentrix / Cliniko / Exact</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono font-bold text-teal-800">⌘B / Ctrl+B</td>
                      <td className="p-3 font-bold text-slate-800">Open / Close End-of-Day Notes</td>
                      <td className="p-3 text-slate-500">Review and copy all today's notes</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono font-bold text-teal-800">⌘→ / Ctrl+→</td>
                      <td className="p-3 font-bold text-slate-800">Advance to Next Patient</td>
                      <td className="p-3 text-slate-500">Instant patient switch without mouse</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono font-bold text-teal-800">⌘V / Ctrl+V</td>
                      <td className="p-3 font-bold text-slate-800">Import Appointment Schedule</td>
                      <td className="p-3 text-slate-500">Quickly load today's schedule</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono font-bold text-teal-800">?</td>
                      <td className="p-3 font-bold text-slate-800">Open Guide & Shortcuts</td>
                      <td className="p-3 text-slate-500">Instant access to shortcuts and help</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {guideActiveTab === 'dictation' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-teal-50/50 rounded-2xl border border-teal-100">
                <h4 className="font-bold text-slate-900 mb-1">Acoustic & Dental Phonetic Recognition</h4>
                <p className="text-slate-600">
                  DentAI's operatory phonetic lexicon automatically maps spoken colloquial dental terms into standardized clinical notations.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Tooth Notation</span>
                  <p className="font-bold text-slate-800 text-xs">FDI & Universal System</p>
                  <p className="text-slate-500 mt-1 text-[11px]">Say: <em>"Tooth 14 occlusal"</em> or <em>"FDI 33 and 46"</em>. Both are recognized and mapped.</p>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Anesthetic Phrasing</span>
                  <p className="font-bold text-slate-800 text-xs">Carpule & Epinephrine</p>
                  <p className="text-slate-500 mt-1 text-[11px]">Say: <em>"1 carpule 2% Lidocaine 1 to 100,000 epi via IANB"</em>. Mapped to D9215 / ADA 921.</p>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Restorative Materials</span>
                  <p className="font-bold text-slate-800 text-xs">Composites & Cements</p>
                  <p className="text-slate-500 mt-1 text-[11px]">Say: <em>"Filtek Supreme A2 composite"</em>, <em>"Theracal liner"</em>, or <em>"RelyX Luting Plus"</em>.</p>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Periodontal Probing</span>
                  <p className="font-bold text-slate-800 text-xs">Six-Point Probing</p>
                  <p className="text-slate-500 mt-1 text-[11px]">Say: <em>"Pocket depths 3-2-3 on buccal, bleeding on probing"</em>.</p>
                </div>
              </div>
            </div>
          )}

          {guideActiveTab === 'pms' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-sky-50/50 rounded-2xl border border-sky-100">
                <h4 className="font-bold text-slate-900 mb-1">1-Click Practice Management Paste</h4>
                <p className="text-slate-600">
                  When you click <strong>Copy Note</strong> (<kbd className="px-1 py-0.5 bg-white border rounded font-mono text-[10px]">⌘C</kbd>), DentAI formats the note with clinical delimiters compatible with every PMS:
                </p>
              </div>

              <div className="space-y-2">
                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <p className="font-bold text-slate-800 text-xs">Dentrix (G6 / G7 / Ascend)</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">Open <em>Patient Chart &rarr; Clinical Notes</em>, press <kbd className="px-1 py-0.2 bg-slate-100 border rounded font-mono text-[10px]">Ctrl+V</kbd>. Headers and billing codes paste automatically into note lines.</p>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <p className="font-bold text-slate-800 text-xs">Eaglesoft</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">Open <em>Treatment &rarr; Clinical Notes tab</em>, press <kbd className="px-1 py-0.2 bg-slate-100 border rounded font-mono text-[10px]">Ctrl+V</kbd>.</p>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <p className="font-bold text-slate-800 text-xs">Exact / Software of Excellence</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">Open patient clinical file &rarr; Charting notes &rarr; Paste.</p>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <p className="font-bold text-slate-800 text-xs">Cliniko & Titanium</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">Open Treatment Notes &rarr; Add Note &rarr; Paste.</p>
                </div>
              </div>
            </div>
          )}

          {guideActiveTab === 'github' && (
            <form onSubmit={handleSubmitChairsideGitHubIssue} className="space-y-3">
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
                  <Send className="w-3.5 h-3.5 text-teal-700" />
                  Direct GitHub Issue Dispatcher
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Directly submits an issue to repository (<span className="font-mono text-slate-700">vikramdarade/dentai</span>) via API without opening browser tabs.
                </p>
              </div>

              {guideGhResult && (
                <div className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 ${guideGhResult.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}>
                  <div className="flex items-center gap-2">
                    {guideGhResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
                    <span>{guideGhResult.ok ? `Issue #${guideGhResult.issueNumber} created directly in GitHub!` : guideGhResult.error}</span>
                  </div>
                  {guideGhResult.issueUrl && (
                    <a
                      href={guideGhResult.issueUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 underline flex items-center gap-1 shrink-0"
                    >
                      <span>View Issue</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Issue Title</label>
                <input
                  type="text"
                  placeholder="e.g. Add support for ADA item 611 ceramic crown fee schedule"
                  value={guideGhTitle}
                  onChange={e => setGuideGhTitle(e.target.value)}
                  required
                  className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:border-teal-700 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Category</label>
                  <select
                    value={guideGhCategory}
                    onChange={e => setGuideGhCategory(e.target.value)}
                    className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:border-teal-700 outline-none"
                  >
                    <option value="feature-request">Feature Request</option>
                    <option value="clinical-audio">Microphone & Noise Filter</option>
                    <option value="dental-lexicon">Dental Lexicon & Codes</option>
                    <option value="pms-clipboard">PMS Clipboard & Export</option>
                    <option value="operatory-bug">Bug Report</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Priority</label>
                  <select
                    value={guideGhPriority}
                    onChange={e => setGuideGhPriority(e.target.value)}
                    className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:border-teal-700 outline-none"
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High (Active operatory)</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Clinical Context & Observation</label>
                <textarea
                  rows={3}
                  placeholder="Describe what occurred chairside or the feature improvement desired..."
                  value={guideGhDescription}
                  onChange={e => setGuideGhDescription(e.target.value)}
                  required
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:border-teal-700 outline-none resize-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400 block mb-0.5">
                  GitHub Token (Optional override if not in server .env)
                </label>
                <input
                  type="password"
                  placeholder="ghp_..."
                  value={guideGhToken}
                  onChange={e => setGuideGhToken(e.target.value)}
                  className="w-full h-8 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={guideGhSubmitting || !guideGhTitle.trim() || !guideGhDescription.trim()}
                className="w-full h-10 rounded-xl bg-teal-800 hover:bg-teal-900 disabled:opacity-50 text-white text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                {guideGhSubmitting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    <span>Creating issue via GitHub API…</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Submit Directly to GitHub</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
