/**
 * On-device model tier (WebLLM) — the "model" half of the offline fallback.
 *
 * When hosted AI routes are exhausted and the dentist is on a WebGPU-capable
 * browser, a small language model can be downloaded and run entirely on the
 * device (first use downloads ~1 GB of weights; subsequent visits load from
 * cache). The module degrades gracefully:
 *  - no WebGPU            -> { ok: false, reason: 'unsupported' }
 *  - download/parse fails -> { ok: false, reason: 'error' }
 *
 * Output quality here is LOWER than hosted Gemini — the caller (LiveRecording)
 * must clearly flag the note as needing review (noteOrigin.needsReview).
 *
 * Safety mirrors the hosted tier: the model is instructed to output ONLY the
 * template sections and is never allowed to fabricate content; the caller
 * still normalises through normalizeTemplateOutput().
 */
import type { NoteTemplate } from './dentalLibrary';
import type { TranscriptItem } from '../types';
import { normalizeTemplateOutput, NormalizedNoteOutput } from './normalizeNoteOutput';

/** Small models tried in order. Filtered against WebLLM's prebuilt registry at runtime. */
const MODEL_CANDIDATES = [
  'Llama-3.2-1B-Instruct-q4f32_1-MLC',
  'Phi-3.5-mini-instruct-q4f16_1-MLC',
  'gemma-2-2b-it-q4f16_1-MLC',
];

export interface OnDeviceProgress {
  phase: 'starting' | 'loading' | 'ready' | 'generating' | 'done';
  /** Human status line shown in the UI. */
  message: string;
  /** 0..1 download progress when loading. */
  progress?: number;
}

export type OnDeviceResult =
  | { ok: true; output: NormalizedNoteOutput; modelId: string }
  | { ok: false; reason: 'unsupported' | 'error'; message: string };

export function isWebGpuAvailable(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  } catch {
    return false;
  }
}

const stripFences = (raw: string): string => {
  const cleaned = raw.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenceMatch ? fenceMatch[1].trim() : cleaned;
};

export async function generateWithOnDeviceModel(params: {
  template: NoteTemplate;
  patientName: string;
  dob: string;
  appointmentTypeLabel: string;
  transcript: TranscriptItem[];
  onProgress?: (p: OnDeviceProgress) => void;
}): Promise<OnDeviceResult> {
  const { template, patientName, dob, appointmentTypeLabel, transcript, onProgress } = params;

  if (!isWebGpuAvailable()) {
    return {
      ok: false,
      reason: 'unsupported',
      message: 'This browser/device does not expose WebGPU, which the on-device model requires. Use the offline draft instead.',
    };
  }

  let webllm: typeof import('@mlc-ai/web-llm');
  try {
    webllm = await import('@mlc-ai/web-llm');
  } catch (err: any) {
    return { ok: false, reason: 'error', message: `Could not load the on-device engine: ${err?.message || 'unknown error'}` };
  }

  const available = new Set(webllm.prebuiltAppConfig.model_list.map((m) => m.model_id));
  const modelId = MODEL_CANDIDATES.find((candidate) => available.has(candidate));
  if (!modelId) {
    return {
      ok: false,
      reason: 'error',
      message: 'No prebuilt on-device model is available in this build of WebLLM.',
    };
  }

  let engine: Awaited<ReturnType<typeof webllm.CreateMLCEngine>>;
  try {
    onProgress?.({ phase: 'loading', message: 'Downloading the on-device dental AI model (first run only, ~1 GB)...', progress: 0 });
    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        onProgress?.({
          phase: 'loading',
          message: `Downloading on-device model — ${report.text || 'loading'}...`,
          progress: report.progress,
        });
      },
    });
  } catch (err: any) {
    return {
      ok: false,
      reason: 'error',
      message: `The on-device model could not start (${err?.message || 'unknown error'}). This can happen when WebGPU memory is insufficient or the download was interrupted.`,
    };
  }

  try {
    onProgress?.({ phase: 'generating', message: 'Structuring the clinical note on this device...' });

    const sectionGuide = template.sections
      .map((s) => `"${s.key}" — ${s.label}. ${s.placeholder}`)
      .join('\n');

    const completion = await engine.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'You are a dental charting assistant for Australian practice. Convert the consultation transcript into the requested JSON note. Rules: use FDI two-digit tooth numbers; correct phonetic transcriptions; use en-AU spelling; NEVER invent a diagnosis, treatment, drug, test result or recall interval that was not stated; leave a section as an empty string when the transcript does not support it; patientSummary is a warm plain-English letter to the patient; adaCodes lists ADA 3-digit item codes only when actually mentioned or clearly performed, else an empty string. Return ONLY a single JSON object, no markdown fences, no commentary.',
        },
        {
          role: 'user',
          content: [
            `Patient: ${patientName} (DOB ${dob})`,
            `Appointment type: ${appointmentTypeLabel}`,
            `Note template: ${template.name}`,
            `Sections to fill:\n${sectionGuide}`,
            `Transcript:\n${transcript.map((t) => `${t.sender}: ${t.text}`).join('\n')}`,
          ].join('\n'),
        },
      ],
      temperature: 0.2,
      max_tokens: 2048,
    });

    const text = completion.choices?.[0]?.message?.content;
    if (!text) {
      return { ok: false, reason: 'error', message: 'The on-device model returned an empty response.' };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(stripFences(text));
    } catch {
      return {
        ok: false,
        reason: 'error',
        message: 'The on-device model returned text that could not be parsed as a structured note. Try the offline draft instead.',
      };
    }

    onProgress?.({ phase: 'done', message: 'Note generated on-device.' });
    return { ok: true, output: normalizeTemplateOutput(template, parsed), modelId };
  } catch (err: any) {
    return {
      ok: false,
      reason: 'error',
      message: `On-device generation failed (${err?.message || 'unknown error'}). Try the offline draft instead.`,
    };
  }
}
