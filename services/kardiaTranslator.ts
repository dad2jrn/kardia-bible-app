import { CLAUDE_API_KEY, GIST_URL } from '../constants/config';
import {
  getKardiaTranslation,
  saveKardiaTranslation,
  type KardiaTranslationRecord,
} from './database';
import type { KeyTermDetails } from '../types/kardia';
import { parseKardiaJson, normalizeKardiaJson } from './kardiaParser';

// Prompt caching temporarily disabled to make iterative prompt edits easier.
// const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_MODEL = 'claude-opus-4-6';
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';

export interface GenerateKardiaTranslationParams {
  sourceTranslationCode: string;
  book: string;
  chapter: number;
  verse: number;
  sourceText: string;
}

interface ClaudeTranslationPayload {
  kardiaText: string;
  hebrewWord?: string | null;
  hebrewCategory?: string | null;
  whyThisMatters?: string | null;
  kardiaVersion?: string | null;
  keyTermDetails?: KeyTermDetails | null;
  extraNotes?: string[] | null;
  rawJson: string;
}

export async function getOrCreateKardiaTranslation(
  params: GenerateKardiaTranslationParams,
): Promise<KardiaTranslationRecord> {
  const existing = getKardiaTranslation({
    sourceTranslationCode: params.sourceTranslationCode,
    book: params.book,
    chapter: params.chapter,
    verse: params.verse,
  });
  if (existing && existing.kardia_text) {
    return existing;
  }

  const promptTemplate = await getPromptTemplate();
  const claudeResult = await callClaude(promptTemplate, params);

  return saveKardiaTranslation({
    sourceTranslationCode: params.sourceTranslationCode,
    book: params.book,
    chapter: params.chapter,
    verse: params.verse,
    sourceText: params.sourceText,
    kardiaText: claudeResult.kardiaText,
    hebrewWord: claudeResult.hebrewWord ?? null,
    hebrewCategory: claudeResult.hebrewCategory ?? null,
    whyThisMatters: claudeResult.whyThisMatters ?? null,
    kardiaVersion: claudeResult.kardiaVersion ?? '1.0',
    generationStatus: 'completed',
    lastError: null,
    keyTermDetails: claudeResult.keyTermDetails ?? null,
    extraNotes: claudeResult.extraNotes ?? null,
    rawResponseJson: claudeResult.rawJson,
  });
}

async function getPromptTemplate(): Promise<string> {
  // Always fetch the latest prompt so edits in the gist apply immediately.
  return fetchPromptFromGist();
}

async function fetchPromptFromGist(): Promise<string> {
  if (!GIST_URL) {
    throw new Error('Gist URL is not configured.');
  }
  const normalizedUrl = GIST_URL.endsWith('/raw') ? GIST_URL : `${GIST_URL.replace(/\/$/, '')}/raw`;
  const response = await fetch(normalizedUrl);
  if (!response.ok) {
    throw new Error(`Failed to download prompt (status ${response.status}).`);
  }
  return await response.text();
}

async function callClaude(
  promptTemplate: string,
  params: GenerateKardiaTranslationParams,
): Promise<ClaudeTranslationPayload> {
  if (!CLAUDE_API_KEY) {
    throw new Error('Claude API key is not configured.');
  }

  const reference = `${params.book} ${params.chapter}:${params.verse}`;
  const userContent = `Reference: ${reference}\nSource translation (${params.sourceTranslationCode}): ${params.sourceText}`;

  const response = await fetch(CLAUDE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      temperature: 0.2,
      system: promptTemplate,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userContent,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    let message = `Claude API request failed with status ${response.status}.`;
    try {
      const errorData = await response.json();
      if (typeof errorData?.error?.message === 'string') {
        message = errorData.error.message;
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  const data = await response.json();
  const rawJson = JSON.stringify(data, null, 2);
  const combinedText = extractTextFromClaudeResponse(data);
  if (!combinedText) {
    throw new Error('Claude returned an empty response.');
  }

  const parsed = parseClaudePayload(combinedText);
  return { ...parsed, rawJson };
}

function extractTextFromClaudeResponse(payload: any): string {
  if (!payload?.content || !Array.isArray(payload.content)) {
    return '';
  }
  const chunks: string[] = [];
  for (const block of payload.content) {
    if (block && block.type === 'text' && typeof block.text === 'string') {
      chunks.push(block.text);
    }
  }
  return chunks.join('\n').trim();
}

function parseClaudePayload(text: string): Omit<ClaudeTranslationPayload, 'rawJson'> {
  const parsed = parseKardiaJson(text);
  if (parsed) {
    const keyTermDetails: KeyTermDetails | null =
      parsed.keyTerm && (parsed.keyTerm.term || parsed.keyTerm.notes)
        ? {
            term: parsed.keyTerm.term ?? null,
            notes: parsed.keyTerm.notes ?? null,
          }
        : null;
    return {
      kardiaText: parsed.kardiaText,
      hebrewWord: parsed.hebrewWord ?? parsed.keyTerm?.hebrew ?? null,
      hebrewCategory: parsed.hebrewCategory ?? null,
      whyThisMatters: parsed.whyThisMatters ?? null,
      kardiaVersion: parsed.kardiaVersion ?? '1.0',
      keyTermDetails,
      extraNotes: parsed.extraNotes ?? null,
    };
  }

  return {
    kardiaText: normalizeKardiaJson(text),
  };
}
