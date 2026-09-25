import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveOpenAiCompatibleConfig,
  stripMarkdownFences,
  generateNoteWithOpenAiCompatible,
} from '../src/server/openAiCompatible';
import { BUILT_IN_TEMPLATES } from '../src/lib/dentalLibrary';

describe('OpenAI-Compatible Engine (Groq / Ollama / llama.cpp)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('resolveOpenAiCompatibleConfig', () => {
    it('resolves Groq when GROQ_API_KEY is present', () => {
      process.env.GROQ_API_KEY = 'gsk_test123';
      const config = resolveOpenAiCompatibleConfig();
      expect(config).not.toBeNull();
      expect(config?.provider).toBe('groq');
      expect(config?.apiKey).toBe('gsk_test123');
      expect(config?.model).toBe('openai/gpt-oss-120b');
      expect(config?.endpoint).toContain('api.groq.com');
    });

    it('resolves Ollama when OLLAMA_BASE_URL is present', () => {
      delete process.env.GROQ_API_KEY;
      process.env.OLLAMA_BASE_URL = 'http://localhost:11434/v1';
      const config = resolveOpenAiCompatibleConfig();
      expect(config).not.toBeNull();
      expect(config?.provider).toBe('ollama');
      expect(config?.model).toBe('llama3.1:8b');
      expect(config?.endpoint).toBe('http://localhost:11434/v1/chat/completions');
    });

    it('resolves llama.cpp when LLAMA_CPP_BASE_URL is present', () => {
      delete process.env.GROQ_API_KEY;
      delete process.env.OLLAMA_BASE_URL;
      process.env.LLAMA_CPP_BASE_URL = 'http://127.0.0.1:8080/v1';
      const config = resolveOpenAiCompatibleConfig();
      expect(config).not.toBeNull();
      expect(config?.provider).toBe('llama-cpp');
      expect(config?.endpoint).toBe('http://127.0.0.1:8080/v1/chat/completions');
    });

    it('returns null when no provider environment variables are set', () => {
      delete process.env.GROQ_API_KEY;
      delete process.env.OLLAMA_BASE_URL;
      delete process.env.LLAMA_CPP_BASE_URL;
      delete process.env.OPENAI_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.LLM_PROVIDER;
      expect(resolveOpenAiCompatibleConfig()).toBeNull();
    });
  });

  describe('stripMarkdownFences', () => {
    it('strips json code fences', () => {
      const raw = '```json\n{"subjective":"pain on 16"}\n```';
      expect(stripMarkdownFences(raw)).toBe('{"subjective":"pain on 16"}');
    });

    it('strips generic code fences', () => {
      const raw = '```\n{"objective":"caries"}\n```';
      expect(stripMarkdownFences(raw)).toBe('{"objective":"caries"}');
    });

    it('leaves clean JSON untouched', () => {
      const raw = '{"plan":"restore 16"}';
      expect(stripMarkdownFences(raw)).toBe('{"plan":"restore 16"}');
    });
  });

  describe('generateNoteWithOpenAiCompatible', () => {
    const template = BUILT_IN_TEMPLATES[0]; // General Examination

    it('returns error if no config is available', async () => {
      delete process.env.GROQ_API_KEY;
      delete process.env.OPENAI_BASE_URL;
      delete process.env.OLLAMA_BASE_URL;
      delete process.env.LLAMA_CPP_BASE_URL;
      delete process.env.LLM_PROVIDER;

      const result = await generateNoteWithOpenAiCompatible({
        systemInstruction: 'You are a dental scribe',
        promptContext: 'Tooth 16 filling',
        template,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('No OpenAI-compatible or Groq configuration found');
    });

    it('successfully generates and normalizes clinical note from mock OpenAI response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chiefComplaint: 'Tooth 16 sensitive to cold',
                  history: 'Started 2 days ago',
                  toothFindings: 'Deep distal occlusal caries on tooth 16',
                  findingsGingival: 'Mild gingivitis',
                  diagnosis: 'Reversible pulpitis 16',
                  treatmentPerformed: 'Composite resin restoration 16 DO',
                  recommendations: 'Soft diet today, warm salt mouthwash',
                  recallRequirements: '6 months routine recall',
                  adaCodes: '531, 521',
                  patientSummary: 'Treated tooth 16 with composite restoration.',
                }),
              },
            },
          ],
        }),
      });

      global.fetch = mockFetch;

      const result = await generateNoteWithOpenAiCompatible({
        systemInstruction: 'You are a dental scribe',
        promptContext: 'Tooth 16 filling',
        template,
        config: {
          endpoint: 'https://api.groq.com/openai/v1/chat/completions',
          apiKey: 'gsk_mock',
          model: 'llama-3.3-70b-versatile',
          provider: 'groq',
        },
      });

      expect(result.ok).toBe(true);
      expect(result.output?.chiefComplaint).toBe('Tooth 16 sensitive to cold');
      expect(result.output?.treatmentPerformed).toBe('Composite resin restoration 16 DO');
      expect(result.provider).toBe('groq');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('handles HTTP error responses gracefully without crashing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded on provider',
      });

      global.fetch = mockFetch;

      const result = await generateNoteWithOpenAiCompatible({
        systemInstruction: 'You are a dental scribe',
        promptContext: 'Tooth 16 filling',
        template,
        config: {
          endpoint: 'https://api.groq.com/openai/v1/chat/completions',
          apiKey: 'gsk_mock',
          model: 'llama-3.3-70b-versatile',
          provider: 'groq',
        },
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Provider HTTP 429');
    });
  });
});
