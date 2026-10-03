import { useState, useCallback, useRef } from 'react';
import type { Consultation, TranscriptItem } from '../types';
import { NOTE_JOB_CLIENT_POLL } from '../lib/noteJobs';
import { reformatNoteIntoTemplate, DENTAL_TEMPLATES } from '../lib/templateEngine';
import { extractBaselineFacts } from '../lib/clinicalEvaluation/deterministicExtractor';
import { createCanonicalClinicalFact, isFactConstructionFailure } from '../lib/clinicalFactMigration';
import { renderClinicalNote, type RenderedClinicalNote } from '../lib/factRenderer';
import { matchProcedureToAdaCode } from '../lib/adaScheduleEngine';

export type NotePipelineTier = 'direct' | 'queued' | 'offline' | 'idle';

export interface NoteGenerationParams {
  consultation: Consultation;
  templateId?: string;
  context?: string;
  transcript?: TranscriptItem[];
  dentistName?: string;
  patientName?: string;
}

export interface UseNotePipelineReturn {
  isGenerating: boolean;
  activeTier: NotePipelineTier;
  statusMessage: string | null;
  generateNote: (params: NoteGenerationParams) => Promise<string>;
  cancelGeneration: () => void;
}

/**
 * Headless React hook implementing Chairside's resilient 3-Tier Note Generation Ladder (Phase 13 / J7).
 *
 * Tier 1: Direct synchronous call (POST /api/generate-notes or /api/copilot/ask)
 * Tier 2: Resilient background job queue (POST /api/notes/jobs) with bounded polling budget
 * Tier 3: Deterministic offline synthesis engine (reformatNoteIntoTemplate / zero network required)
 */
export function useNotePipeline(authToken: string | null): UseNotePipelineReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTier, setActiveTier] = useState<NotePipelineTier>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const isCancelledRef = useRef(false);

  const cancelGeneration = useCallback(() => {
    isCancelledRef.current = true;
    setIsGenerating(false);
    setActiveTier('idle');
    setStatusMessage('Generation cancelled.');
  }, []);

  const generateNote = useCallback(async (params: NoteGenerationParams): Promise<string> => {
    const {
      consultation,
      templateId = 'ahpra-standard',
      context = '',
      transcript = consultation.transcript || [],
      dentistName = consultation.dentistName || 'Dentist',
      patientName = consultation.firstName ? `${consultation.firstName} ${consultation.lastName || ''}`.trim() : 'Patient',
    } = params;

    isCancelledRef.current = false;
    setIsGenerating(true);
    setActiveTier('direct');
    setStatusMessage('Connecting to direct note generation engine (Tier 1)...');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    };

    let synthesizedNote = '';

    const cleanCurrentNote =
      consultation.clinicalProgressNote &&
      (consultation.clinicalProgressNote.includes('Pending examination findings') ||
       consultation.clinicalProgressNote.includes('Extraoral: WNL. Intraoral soft tissues healthy') ||
       (consultation.clinicalProgressNote.includes('014: Consultation') && !consultation.clinicalProgressNote.includes('Tooth ')))
        ? ''
        : (consultation.clinicalProgressNote || '');

    // =========================================================================
    // Tier 1: Direct Synchronous Generation
    // =========================================================================
    try {
      const directRes = await fetch('/api/copilot/ask', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: `Generate an Australian AHPRA-compliant clinical progress note using template "${templateId}". STRICT CLINICAL GROUNDING: Extract ONLY findings, tooth numbers, symptoms, diagnoses, procedures, and ADA item codes that were explicitly evidenced in the transcript or context. Do NOT invent, assume, or extrapolate routine examinations (e.g. soft tissues, radiographs) or treatments that did not take place.`,
          currentNote: cleanCurrentNote,
          context,
          transcript,
          patientName,
          dentistName,
          appointmentType: templateId,
          consultationId: consultation.id,
        }),
      });

      if (isCancelledRef.current) return '';

      if (directRes.status === 409) {
        // Direct generation already in progress for this consultation (concurrent tab or peer)
        setStatusMessage('Generation already in progress on another device/tab. Reusing latest draft.');
        return consultation.clinicalProgressNote || '';
      }

      if (directRes.ok) {
        const data = await directRes.json();
        if (data && data.result) {
          synthesizedNote = data.result;
          setStatusMessage('Clinical note generated via Direct Engine (Tier 1).');
          return synthesizedNote;
        }
      }
    } catch (directErr) {
      console.warn('[NotePipeline] Direct Tier 1 attempt failed, cascading to background job queue:', directErr);
    }

    if (isCancelledRef.current) return '';

    // =========================================================================
    // Tier 2: Resilient Background Worker Job Queue
    // =========================================================================
    setActiveTier('queued');
    setStatusMessage('Direct route busy; queued to background processing worker (Tier 2)...');

    try {
      const jobRes = await fetch('/api/notes/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          intakeData: {
            firstName: consultation.firstName || 'Patient',
            lastName: consultation.lastName || '',
            dob: consultation.dob || '',
            appointmentType: consultation.appointmentType || 'examination',
            templateId,
          },
          transcript,
          consultationId: consultation.id,
        }),
      });

      if (jobRes.ok) {
        const jobData = await jobRes.json();
        const jobId = jobData.jobId;

        if (jobId) {
          // Bounded polling ladder covering retry budget
          const pollDeadline = Date.now() + Math.min(NOTE_JOB_CLIENT_POLL.deadlineMs, 30_000);

          while (Date.now() < pollDeadline && !isCancelledRef.current) {
            await new Promise((r) => setTimeout(r, NOTE_JOB_CLIENT_POLL.intervalMs));

            if (isCancelledRef.current) return '';

            const pollRes = await fetch(`/api/notes/jobs/${jobId}`, { headers });
            if (pollRes.ok) {
              const jobState = await pollRes.json();
              if (jobState.status === 'done' && jobState.result) {
                const noteContent = typeof jobState.result === 'string'
                  ? jobState.result
                  : jobState.result.clinicalProgressNote || JSON.stringify(jobState.result);
                synthesizedNote = noteContent;
                setStatusMessage('Clinical note completed via Background Job Queue (Tier 2).');
                return synthesizedNote;
              }
              if (jobState.status === 'failed') {
                console.warn('[NotePipeline] Background job marked failed by server worker:', jobState.error);
                break;
              }
            }
          }
        }
      }
    } catch (jobErr) {
      console.warn('[NotePipeline] Job queue Tier 2 error, cascading to offline engine:', jobErr);
    }

    if (isCancelledRef.current) return '';

    // =========================================================================
    // Tier 3: Deterministic ClinicalFact Extraction & Offline Draft Engine
    // =========================================================================
    setActiveTier('offline');
    setStatusMessage('Generating deterministic clinical note from ClinicalFacts (Tier 3)...');

    // 1. Extract ClinicalFacts from transcript
    let renderedFacts: RenderedClinicalNote | null = null;
    let adaCodes = '';
    try {
      if (transcript.length > 0) {
        const extractorUtterances = transcript.map((t, idx) => ({
          utteranceId: `u-${idx + 1}`,
          speaker: t.sender || 'Dialogue',
          text: t.text,
        }));
        const rawCandidates = extractBaselineFacts(extractorUtterances);
        const facts = rawCandidates
          .map((c) => createCanonicalClinicalFact(c))
          .filter((r) => !isFactConstructionFailure(r))
          .map((r) => (r as { fact: any }).fact);
        renderedFacts = renderClinicalNote(facts);

        // Map performed procedures to ADA codes
        const codeList: string[] = [];
        for (const t of transcript) {
          const match = matchProcedureToAdaCode(t.text);
          if (match && !codeList.some((c) => c.startsWith(match.itemCode))) {
            codeList.push(`${match.itemCode}: ${match.itemName}`);
          }
        }
        if (codeList.length > 0) {
          adaCodes = codeList.map((c) => `- ${c}`).join('\n');
        }
      }
    } catch (factErr) {
      console.warn('[NotePipeline] ClinicalFact extraction error:', factErr);
    }

    const examFindings = renderedFacts
      ? [renderedFacts.sections.toothFindings, renderedFacts.sections.findingsGingival].filter(Boolean).join('\n')
      : transcript.map((t) => `${t.sender}: ${t.text}`).join('\n');

    const treatmentPerformed = renderedFacts ? renderedFacts.sections.treatmentPerformed : '';

    const plans = renderedFacts
      ? [renderedFacts.sections.treatmentPlanned, renderedFacts.sections.consent, renderedFacts.sections.treatmentDeclined]
          .filter(Boolean)
          .join('\n')
      : '';

    const advice = renderedFacts
      ? [renderedFacts.sections.recommendations, renderedFacts.sections.recallRequirements, renderedFacts.sections.referral]
          .filter(Boolean)
          .join('\n')
      : '';

    const offlineSynthesis = reformatNoteIntoTemplate(
      templateId,
      {
        complaint: renderedFacts?.sections.chiefComplaint || context,
        medicalHistory: renderedFacts?.sections.history || (context ? `Context: ${context}` : ''),
        examination: examFindings,
        diagnosis: renderedFacts?.sections.diagnosis || '',
        treatmentPerformed,
        treatmentPlan: [plans, advice].filter(Boolean).join('\n'),
        itemCodes: adaCodes,
      },
      cleanCurrentNote
    );

    synthesizedNote = offlineSynthesis;
    setStatusMessage('Clinical note drafted via Deterministic ClinicalFact Engine (Tier 3).');
    return synthesizedNote;
  }, [authToken]);

  return {
    isGenerating,
    activeTier,
    statusMessage,
    generateNote: async (params) => {
      try {
        return await generateNote(params);
      } finally {
        setIsGenerating(false);
      }
    },
    cancelGeneration,
  };
}
