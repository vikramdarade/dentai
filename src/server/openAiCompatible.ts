/**
 * Resilient OpenAI-compatible engine for Open-Source Model Inference
 * (Groq Cloud Llama-3.3-70B, Ollama, llama.cpp, LocalAI, vLLM).
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
}

export interface OpenAiCompatibleResult {
  ok: boolean;
  output?: NormalizedNoteOutput;
  error?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
}

/**
 * Resolves the active OpenAI-compatible configuration from environment variables.
 */
export function resolveOpenAiCompatibleConfig(): OpenAiCompatibleConfig | null {
  const explicitProvider = (process.env.LLM_PROVIDER || '').toLowerCase().trim();

  // 1. Groq Cloud (Free tier Llama-3.3-70B at 500 tokens/sec)
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey || explicitProvider === 'groq') {
    return {
      endpoint: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: groqKey || 'gsk_dev',
      model: process.env.GROQ_MODEL || process.env.OPENAI_MODEL || 'llama-3.3-70b-versatile',
      provider: 'groq',
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
 * Executes a note generation call against an OpenAI-compatible endpoint (Groq, Ollama, llama.cpp, etc.)
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: `${systemInstruction}\n\nCRITICAL REQUIREMENT: Return ONLY a raw JSON object matching the requested schema. Do not enclose in markdown ticks. Do not add introductory or explanatory text.`,
          },
          {
            role: 'user',
            content: promptContext,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 3500,
      }),
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      return {
        ok: false,
        error: `Provider HTTP ${response.status}: ${errText.slice(0, 300)}`,
        provider: config.provider,
        model: config.model,
      };
    }

    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return {
        ok: false,
        error: 'Model response was empty or contained no message content.',
        provider: config.provider,
        model: config.model,
      };
    }

    const cleaned = stripMarkdownFences(content);
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr: any) {
      return {
        ok: false,
        error: `Failed to parse model JSON: ${parseErr.message}. Output was: ${cleaned.slice(0, 200)}`,
        provider: config.provider,
        model: config.model,
      };
    }

    const normalized = normalizeTemplateOutput(template, parsed);
    return {
      ok: true,
      output: normalized,
      provider: config.provider,
      model: config.model,
      latencyMs: Date.now() - startTime,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
    return {
      ok: false,
      error: isTimeout ? `Request timed out after ${timeoutMs / 1000}s` : err.message || 'Unknown network error',
      provider: config.provider,
      model: config.model,
    };
  }
}
