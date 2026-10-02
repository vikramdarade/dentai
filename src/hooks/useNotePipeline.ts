import { useState, useCallback, useRef } from 'react';
import type { Consultation, TranscriptItem } from '../types';
import { NOTE_JOB_CLIENT_POLL } from '../lib/noteJobs';
import { reformatNoteIntoTemplate, DENTAL_TEMPLATES } from '../lib/templateEngine';

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

    // =========================================================================
    // Tier 1: Direct Synchronous Generation
    // =========================================================================
    try {
      const directRes = await fetch('/api/copilot/ask', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: `Generate an Australian AHPRA-compliant clinical progress note using template "${templateId}". Extract findings, tooth numbers, and ADA item codes from the transcript and context.`,
          currentNote: consultation.clinicalProgressNote || '',
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
    // Tier 3: Deterministic Offline Draft Engine (Zero-Network Fallback)
    // =========================================================================
    setActiveTier('offline');
    setStatusMessage('Network unavailable; generating deterministic offline clinical draft (Tier 3)...');

    const offlineSynthesis = reformatNoteIntoTemplate(
      templateId,
      {
        complaint: context,
        medicalHistory: context,
        examination: transcript.map((t) => `${t.sender}: ${t.text}`).join('\n'),
      },
      consultation.clinicalProgressNote || ''
    );

    synthesizedNote = offlineSynthesis;
    setStatusMessage('Clinical note drafted via Offline Deterministic Engine (Tier 3).');
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
