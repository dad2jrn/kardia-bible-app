import type { ParsedKardiaPayload } from '../types/kardia';

export function looksLikeKardiaJson(raw: string | null | undefined): boolean {
  if (!raw) {
    return false;
  }
  const trimmed = raw.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('```');
}

export function normalizeKardiaJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const withoutOpening = trimmed.replace(/^```(?:json)?\s*/i, '');
    if (withoutOpening.endsWith('```')) {
      return sanitizeQuotes(withoutOpening.slice(0, -3));
    }
    return sanitizeQuotes(withoutOpening);
  }
  return sanitizeQuotes(trimmed);
}

function sanitizeQuotes(value: string): string {
  return value
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00a0/g, ' ')
    .trim();
}

export function parseKardiaJson(raw: string): ParsedKardiaPayload | null {
  const normalized = normalizeKardiaJson(raw);
  try {
    const payload = safeJsonParse(normalized);
    if (payload && typeof payload === 'object') {
      if (typeof (payload as any).error === 'string') {
        throw new Error((payload as any).error as string);
      }
      const kardiaText = getString((payload as any).kardia_translation) ?? getString((payload as any).kardiaText);
      if (!kardiaText) {
        return null;
      }
      const keyTerm = (payload as any).key_term ?? (payload as any).keyTerm ?? null;
      const extraNotesArray = ((payload as any).extra_notes ?? (payload as any).extraNotes) as unknown;
      const parsedExtraNotes = Array.isArray(extraNotesArray)
        ? extraNotesArray
            .filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
            .map((note) => note.trim())
        : [];

      return {
        kardiaText: kardiaText.trim(),
        sourceText: getString((payload as any).source_translation) ?? getString((payload as any).sourceTranslation) ?? null,
        kardiaVersion: getString((payload as any).kardia_version) ?? getString((payload as any).kardiaVersion) ?? null,
        keyTerm: keyTerm
          ? {
              term: getString(keyTerm.term) ?? null,
              hebrew: getString(keyTerm.hebrew) ?? null,
              notes: getString(keyTerm.notes) ?? null,
            }
          : null,
        hebrewWord: getString(keyTerm?.hebrew) ?? null,
        hebrewCategory: getString((payload as any).hebrew_category) ?? getString((payload as any).hebrewCategory) ?? null,
        whyThisMatters: getString((payload as any).why_this_matters) ?? getString((payload as any).whyThisMatters) ?? null,
        extraNotes: parsedExtraNotes.length > 0 ? parsedExtraNotes : null,
      };
    }
  } catch (error) {
    console.debug('[KardiaParser] Failed to parse JSON payload', error);
  }

  return fallbackParseLooseJson(normalized);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function safeJsonParse(value: string): any | null {
  try {
    return JSON.parse(value);
  } catch {
    const firstBrace = value.indexOf('{');
    const lastBrace = value.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(value.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function fallbackParseLooseJson(normalized: string): ParsedKardiaPayload | null {
  const kardiaText = extractQuotedValue(normalized, 'kardia_translation') ?? extractQuotedValue(normalized, 'kardiaText');
  if (!kardiaText) {
    return null;
  }

  const sourceText = extractQuotedValue(normalized, 'source_translation') ?? extractQuotedValue(normalized, 'sourceTranslation');
  const hebrewWord = extractQuotedValue(normalized, 'hebrew');
  const hebrewCategory = extractQuotedValue(normalized, 'hebrew_category') ?? extractQuotedValue(normalized, 'hebrewCategory');
  const whyThisMatters = extractQuotedValue(normalized, 'why_this_matters') ?? extractQuotedValue(normalized, 'whyThisMatters');
  const keyTermTerm = extractQuotedValue(normalized, 'term');
  const keyTermNotes = extractQuotedValue(normalized, 'notes');
  const extraNotesMatches = [...normalized.matchAll(/"extra_notes"\s*:\s*\[(.*?)\]/gis)];
  let extraNotes: string[] | null = null;
  if (extraNotesMatches.length > 0) {
    const body = extraNotesMatches[0][1];
    const noteMatches = body.match(/"([\s\S]*?)"/g);
    if (noteMatches) {
      extraNotes = noteMatches.map((match) => match.slice(1, -1)).filter((note) => note.trim().length > 0);
    }
  }

  return {
    kardiaText,
    sourceText,
    keyTerm: keyTermTerm || keyTermNotes || hebrewWord
      ? {
          term: keyTermTerm ?? null,
          hebrew: hebrewWord ?? null,
          notes: keyTermNotes ?? null,
        }
      : null,
    hebrewWord: hebrewWord ?? null,
    hebrewCategory: hebrewCategory ?? null,
    whyThisMatters: whyThisMatters ?? null,
    extraNotes,
  };
}

function extractQuotedValue(text: string, key: string): string | null {
  const regex = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"`, 'i');
  const match = text.match(regex);
  return match ? match[1].replace(/\\"/g, '"').trim() : null;
}
