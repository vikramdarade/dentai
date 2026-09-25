/**
 * Resilient OpenAI-compatible engine for Open-Source Model Inference
 * (Groq Cloud, Ollama, llama.cpp, LocalAI, vLLM).
 *
 * This provides zero-cost, high-speed, high-accuracy clinical note generation
 * without being blocked by Google Gemini quota or billing limits.
 */

import type { NoteTemplate } from '../lib/dentalLibrary';
import { normalizeTemplateOutput, type NormalizedNoteOutput } from '../lib/normalizeNoteOutput';

export interface OpenAiCompatibleConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  provider: 'groq' | 'ollama' | 'llama-cpp' | 'openai-compatible';
  candidateModels?: string[];
}

export interface OpenAiCompatibleResult {
  ok: boolean;
  output?: NormalizedNoteOutput;
  error?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
}

/** Active candidate models on Groq in priority order */
export const GROQ_CANDIDATE_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

/**
 * Resolves the active OpenAI-compatible configuration from environment variables.
 */
export function resolveOpenAiCompatibleConfig(): OpenAiCompatibleConfig | null {
  const explicitProvider = (process.env.LLM_PROVIDER || '').toLowerCase().trim();

  // 1. Groq Cloud (Free tier frontier models)
  const groqKey = process.env.GROQ_API_KEY || process.env.GROQ_API_PROD_KEY;
  if (groqKey || explicitProvider === 'groq') {
    const specifiedModel = process.env.GROQ_MODEL || process.env.OPENAI_MODEL;
    return {
      endpoint: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: groqKey || 'gsk_dev',
      model: specifiedModel || GROQ_CANDIDATE_MODELS[0],
      provider: 'groq',
      candidateModels: specifiedModel ? [specifiedModel, ...GROQ_CANDIDATE_MODELS] : GROQ_CANDIDATE_MODELS,
    };
  }

  // 2. Local Ollama (e.g. http://localhost:11434/v1)
  const ollamaBase = process.env.OLLAMA_BASE_URL;
  if (ollamaBase || explicitProvider === 'ollama') {
    const base = (ollamaBase || 'http://127.0.0.1:11434/v1').replace(/\/$/, '');
    return {
      endpoint: `${base}/chat/completions`,
      apiKey: process.env.OLLAMA_API_KEY || 'ollama',
      model: process.env.OLLAMA_MODEL || process.env.OPENAI_MODEL || 'llama3.1:8b',
      provider: 'ollama',
    };
  }

  // 3. Local llama.cpp / llama-server (e.g. http://localhost:8080/v1)
  const llamaCppBase = process.env.LLAMA_CPP_BASE_URL;
  if (llamaCppBase || explicitProvider === 'llama-cpp') {
    const base = (llamaCppBase || 'http://127.0.0.1:8080/v1').replace(/\/$/, '');
    return {
      endpoint: `${base}/chat/completions`,
      apiKey: process.env.LLAMA_CPP_API_KEY || 'llama',
      model: process.env.LLAMA_CPP_MODEL || process.env.OPENAI_MODEL || 'llama-3.1-8b-instruct',
      provider: 'llama-cpp',
    };
  }

  // 4. Generic OpenAI-compatible endpoint
  const genericBase = process.env.OPENAI_BASE_URL;
  const genericKey = process.env.OPENAI_API_KEY;
  if (genericBase || genericKey || explicitProvider === 'openai-compatible') {
    const base = (genericBase || 'https://api.openai.com/v1').replace(/\/$/, '');
    return {
      endpoint: base.endsWith('/chat/completions') ? base : `${base}/chat/completions`,
      apiKey: genericKey || 'key',
      model: process.env.OPENAI_MODEL || 'llama-3.3-70b-versatile',
      provider: 'openai-compatible',
    };
  }

  return null;
}

/**
 * Strips markdown code block fences (e.g. ```json ... ```) from raw model output.
 */
export function stripMarkdownFences(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return match ? match[1].trim() : trimmed;
}

/**
 * Executes a single API call for a specific model.
 */
async function callOpenAiEndpoint(params: {
  endpoint: string;
  apiKey: string;
  model: string;
  systemInstruction: string;
  promptContext: string;
  timeoutMs: number;
}): Promise<{ ok: true; content: string } | { ok: false; status?: number; error: string }> {
  const { endpoint, apiKey, model, systemInstruction, promptContext, timeoutMs } = params;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `${systemInstruction}\n\nCRITICAL: Output raw JSON only. Do not wrap in markdown quotes.`,
          },
          {
            role: 'user',
            content: promptContext,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        // Free tier OTPM (output tokens per min) limits require <= 1000 max_tokens
        max_tokens: 1000,
      }),
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      return {
        ok: false,
        status: response.status,
        error: `Provider HTTP ${response.status}: ${errText.slice(0, 300)}`,
      };
    }

    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return {
        ok: false,
        error: 'Model response was empty or contained no message content.',
      };
    }

    return { ok: true, content };
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
    return {
      ok: false,
      error: isTimeout ? `Request timed out after ${timeoutMs / 1000}s` : err.message || 'Unknown network error',
    };
  }
}

/**
 * Executes a note generation call against an OpenAI-compatible endpoint with automatic model fallback.
 */
export async function generateNoteWithOpenAiCompatible(params: {
  systemInstruction: string;
  promptContext: string;
  template: NoteTemplate;
  config?: OpenAiCompatibleConfig;
  timeoutMs?: number;
}): Promise<OpenAiCompatibleResult> {
  const { systemInstruction, promptContext, template, timeoutMs = 25000 } = params;
  const config = params.config || resolveOpenAiCompatibleConfig();

  if (!config) {
    return {
      ok: false,
      error: 'No OpenAI-compatible or Groq configuration found in environment.',
    };
  }

  const startTime = Date.now();
  const modelsToTry = config.candidateModels?.length ? config.candidateModels : [config.model];
  let lastError = '';

  for (const candidateModel of modelsToTry) {
    const res = await callOpenAiEndpoint({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: candidateModel,
      systemInstruction,
      promptContext,
      timeoutMs,
    });

    if (res.ok === false) {
      lastError = res.error;
      // If it's a 404 (model not found) or 429 (rate/OTPM limit), seamlessly try the next candidate model
      const shouldTryNext = res.status === 404 || res.status === 429 || res.error.includes('model_not_found');
      if (!shouldTryNext) {
        break;
      }
      continue;
    }

    const cleaned = stripMarkdownFences(res.content);
    try {
      const parsed = JSON.parse(cleaned);
      const normalized = normalizeTemplateOutput(template, parsed);
      return {
        ok: true,
        output: normalized,
        provider: config.provider,
        model: candidateModel,
        latencyMs: Date.now() - startTime,
      };
    } catch (parseErr: any) {
      lastError = `Failed to parse model JSON: ${parseErr.message}`;
    }
  }

  return {
    ok: false,
    error: lastError || 'All candidate open models failed.',
    provider: config.provider,
    model: config.model,
  };
}
