import { ESV_API_KEY } from '../constants/config';

// ─── API response types ───────────────────────────────────────────────────────

interface EsvPassageMeta {
  canonical: string;
  chapter_start: number[];
  chapter_end: number[];
  prev_verse: number | null;
  next_verse: number | null;
  prev_chapter: number[] | null;
  next_chapter: number[] | null;
}

interface EsvApiResponse {
  query: string;
  canonical: string;
  parsed: number[][];
  passage_meta: EsvPassageMeta[];
  passages: string[];
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ParsedVerse {
  verse: number;
  text: string;
}

export interface FetchChapterResult {
  verses: ParsedVerse[];
  copyright: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.esv.org/v3/passage/html/';

const FIXED_PARAMS: Record<string, string> = {
  'include-passage-references': 'false',
  'include-verse-numbers': 'true',
  'include-first-verse-numbers': 'true',
  'include-footnotes': 'false',
  'include-footnote-body': 'false',
  'include-headings': 'false',
  'include-subheadings': 'false',
  'include-chapter-numbers': 'true',
  'include-verse-anchors': 'true',
  'include-crossrefs': 'false',
  'include-short-copyright': 'true',
  'include-copyright': 'false',
  'include-audio-link': 'false',
  'wrapping-div': 'false',
  'inline-styles': 'false',
};

// ─── HTML parser ──────────────────────────────────────────────────────────────

/**
 * Strips all HTML tags from a string, collapses whitespace, and trims.
 */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts the copyright line from the passage HTML.
 * The ESV API emits a <p class="copyright"> element when include-short-copyright=true.
 */
function extractCopyright(html: string): string {
  const match = html.match(/<p[^>]*class="copyright"[^>]*>([\s\S]*?)<\/p>/i);
  if (match) {
    return stripTags(match[1]);
  }
  // Fallback: look for the inline (c) notation that appears at the end of the last verse block
  const inlineMatch = html.match(/\(ESV\)|©[^<]*/);
  return inlineMatch ? inlineMatch[0].trim() : '';
}

/**
 * Removes the copyright block from HTML before verse parsing so it doesn't
 * bleed into the final verse's text content.
 */
function removeCopyrightBlock(html: string): string {
  return html.replace(/<p[^>]*class="copyright"[^>]*>[\s\S]*?<\/p>/gi, '');
}

/**
 * Parses ESV passage HTML into individual verses.
 *
 * Strategy:
 *   - The ESV API with include-verse-anchors=true inserts an anchor before
 *     every verse: <a name="vBBBCCCVVV"></a>
 *   - Verse 1 of a chapter gets a <sup class="chapter-num">C:1</sup> label.
 *   - All other verses get a <sup class="verse-num">N</sup> label.
 *   - We split the HTML on these anchors, then for each segment extract the
 *     verse number from the sup tag and strip the remaining markup.
 */
function parsePassageHtml(html: string): ParsedVerse[] {
  const cleaned = removeCopyrightBlock(html);

  // Split on verse anchor tags. parts[0] is pre-first-anchor preamble and is
  // discarded. parts[1..] each contain the HTML content of one verse.
  const parts = cleaned.split(/<a\s[^>]*name="v\d{9}"[^>]*><\/a>/i);
  const verseHtmlSegments = parts.slice(1);

  if (verseHtmlSegments.length === 0) {
    throw new Error('[esvApi] No verse anchors found in passage HTML — cannot parse verses.');
  }

  const verses: ParsedVerse[] = [];

  for (const segment of verseHtmlSegments) {
    // Extract verse number from <sup class="chapter-num">C:V</sup> (verse 1)
    // or <sup class="verse-num">V</sup> (verses 2+)
    let verseNumber: number | null = null;

    const chapterNumMatch = segment.match(/<sup[^>]*class="chapter-num"[^>]*>(\d+):(\d+)<\/sup>/i);
    if (chapterNumMatch) {
      verseNumber = parseInt(chapterNumMatch[2], 10);
    } else {
      const verseNumMatch = segment.match(/<sup[^>]*class="verse-num"[^>]*>(\d+)<\/sup>/i);
      if (verseNumMatch) {
        verseNumber = parseInt(verseNumMatch[1], 10);
      }
    }

    if (verseNumber === null) {
      // Could be trailing whitespace or a structural tag with no verse — skip
      continue;
    }

    // Remove the verse number sup tag itself so it doesn't appear in the text
    const textHtml = segment
      .replace(/<sup[^>]*class="chapter-num"[^>]*>[\s\S]*?<\/sup>/gi, '')
      .replace(/<sup[^>]*class="verse-num"[^>]*>[\s\S]*?<\/sup>/gi, '');

    const text = stripTags(textHtml);

    if (text.length === 0) {
      continue;
    }

    verses.push({ verse: verseNumber, text });
  }

  return verses;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches a Bible chapter from the ESV API and parses it into individual verses.
 *
 * @param book    Book name, e.g. "John" or "Genesis"
 * @param chapter Chapter number
 * @returns Parsed verses and the copyright string
 * @throws On network failure, non-200 response, empty passages, or parse failure
 */
export async function fetchChapter(book: string, chapter: number): Promise<FetchChapterResult> {
  const query = `${book} ${chapter}`;

  const params = new URLSearchParams({ q: query, ...FIXED_PARAMS });
  const url = `${BASE_URL}?${params.toString()}`;

  // ── Network call ──────────────────────────────────────────────────────────
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Token ${ESV_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (networkError) {
    throw new Error(
      `[esvApi] Network failure fetching "${query}": ${String(networkError)}`,
    );
  }

  // ── HTTP status check ─────────────────────────────────────────────────────
  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      // ignore secondary read failure
    }
    throw new Error(
      `[esvApi] HTTP ${response.status} for "${query}": ${body.slice(0, 200)}`,
    );
  }

  // ── JSON parsing ──────────────────────────────────────────────────────────
  let data: EsvApiResponse;
  try {
    data = (await response.json()) as EsvApiResponse;
  } catch (jsonError) {
    throw new Error(
      `[esvApi] Failed to parse JSON response for "${query}": ${String(jsonError)}`,
    );
  }

  // ── Validate passages array ───────────────────────────────────────────────
  if (!Array.isArray(data.passages) || data.passages.length === 0) {
    throw new Error(
      `[esvApi] Empty passages array returned for "${query}". The reference may be invalid.`,
    );
  }

  const passageHtml = data.passages[0];

  if (typeof passageHtml !== 'string' || passageHtml.trim().length === 0) {
    throw new Error(`[esvApi] First passage entry is empty for "${query}".`);
  }

  // ── Extract copyright before parsing verses ───────────────────────────────
  const copyright = extractCopyright(passageHtml);

  // ── HTML → verses ─────────────────────────────────────────────────────────
  let verses: ParsedVerse[];
  try {
    verses = parsePassageHtml(passageHtml);
  } catch (parseError) {
    throw new Error(
      `[esvApi] HTML parse failed for "${query}": ${String(parseError)}`,
    );
  }

  if (verses.length === 0) {
    throw new Error(
      `[esvApi] Parser produced zero verses for "${query}". HTML may have changed structure.`,
    );
  }

  return { verses, copyright };
}
