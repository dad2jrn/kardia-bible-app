/**
 * esvApi.ts
 *
 * ESV API service for the Kardia Bible App.
 *
 * Download strategy (v2):
 *   - Network unit of work: a batch of contiguous chapters from the same book,
 *     packed as tightly as possible within the 500-verse API ceiling.
 *   - Persistence unit of work: one chapter, written and marked complete
 *     independently in SQLite — identical to v1.
 *   - Request pacing: one request every 1,500 ms (~40/minute, well under the
 *     60/minute limit).
 *   - Endpoint: /v3/passage/text/ with verse markers for reliable ingestion.
 *     HTML remains documented but is not used for storage.
 *
 * This file owns:
 *   - Batch computation from pending chapter list
 *   - ESV API request construction and execution
 *   - Plain-text response parsing into per-chapter verse arrays
 *   - Chapter-level validation against canonical metadata
 *   - Progress reporting via callback
 *
 * Database writes are handled by database.ts (insertVerses / markChapterComplete).
 */

import { BIBLE_METADATA, BookMeta, getExpectedVerseCount, verseCountForRange } from '../constants/bibleMetadata';

// ─── Configuration ────────────────────────────────────────────────────────────

const ESV_API_BASE = 'https://api.esv.org';
const ESV_TEXT_ENDPOINT = '/v3/passage/text/';

// Maximum verses the ESV API allows per single request.
const MAX_VERSES_PER_REQUEST = 500;

// Maximum chapters per batch — "half a book" ceiling approximated conservatively.
// In practice the verse ceiling will constrain long books before this matters.
const MAX_CHAPTERS_PER_BATCH = 50;

// Milliseconds between HTTP requests. 1500 ms ≈ 40 requests/minute.
const REQUEST_INTERVAL_MS = 1500;

// Maximum retry attempts for a single batch on transient failure.
const MAX_RETRIES = 3;

// Base delay for exponential backoff on retry (ms).
const RETRY_BASE_DELAY_MS = 3000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedVerse {
  book: string;
  bookNumber: number;
  chapter: number;
  verse: number;
  text: string;
}

export interface ParsedChapter {
  book: string;
  bookNumber: number;
  chapter: number;
  verses: ParsedVerse[];
  isValid: boolean;
  validationError?: string;
}

export interface BatchDescriptor {
  book: BookMeta;
  fromChapter: number;   // 1-indexed, inclusive
  toChapter: number;     // 1-indexed, inclusive
  expectedVerseCount: number;
}

export interface DownloadProgressEvent {
  completedChapters: number;
  totalChapters: number;
  failedChapters: number;
  currentBook: string;
  currentBatch: string;
  phase: 'building_batches' | 'downloading' | 'complete' | 'failed';
}

export type ProgressCallback = (event: DownloadProgressEvent) => void;

export interface PendingChapter {
  book: string;
  bookNumber: number;
  chapter: number;
}

// ─── ESV Request Parameters ───────────────────────────────────────────────────

function buildTextRequestParams(passageQuery: string): URLSearchParams {
  const params = new URLSearchParams({
    q: passageQuery,
    'include-passage-references': 'false',
    'include-verse-numbers': 'true',
    'include-first-verse-numbers': 'true',
    'include-footnotes': 'false',
    'include-footnote-body': 'false',
    'include-headings': 'false',
    'include-subheadings': 'false',
    'include-chapter-numbers': 'false',  // chapter known from batch descriptor
    'include-crossrefs': 'false',
    'include-short-copyright': 'false',  // excluded from stored text; attribution handled in About
    'include-copyright': 'false',
    'include-audio-link': 'false',
    'indent-poetry': 'false',
    'indent-poetry-lines': '0',
    'indent-declares': '0',
    'indent-psalm-doxology': '0',
    'line-length': '0',              // disable line wrapping for clean single-line verses
  });
  return params;
}

// ─── Batch Builder ────────────────────────────────────────────────────────────

/**
 * Given a list of pending chapters (not yet in SQLite), produce an ordered list
 * of BatchDescriptors. Batches are contiguous within a single book and stay
 * within MAX_VERSES_PER_REQUEST and MAX_CHAPTERS_PER_BATCH.
 */
export function buildBatches(pendingChapters: PendingChapter[]): BatchDescriptor[] {
  if (pendingChapters.length === 0) return [];

  // Group pending chapters by bookNumber preserving order
  const byBook = new Map<number, { book: BookMeta; chapters: number[] }>();

  for (const pending of pendingChapters) {
    const bookMeta = BIBLE_METADATA.find(b => b.bookNumber === pending.bookNumber);
    if (!bookMeta) {
      console.warn(`[esvApi] Unknown book number ${pending.bookNumber} — skipping`);
      continue;
    }
    if (!byBook.has(pending.bookNumber)) {
      byBook.set(pending.bookNumber, { book: bookMeta, chapters: [] });
    }
    byBook.get(pending.bookNumber)!.chapters.push(pending.chapter);
  }

  const batches: BatchDescriptor[] = [];

  for (const [, { book, chapters }] of byBook) {
    // Sort chapters ascending so contiguous runs are detectable
    const sorted = [...new Set(chapters)].sort((a, b) => a - b);

    let batchStart = 0;

    while (batchStart < sorted.length) {
      let batchEnd = batchStart;
      let verseCount = book.chapters[sorted[batchStart] - 1] ?? 0;

      // Extend the batch as long as chapters are contiguous and limits hold
      while (batchEnd + 1 < sorted.length) {
        const nextChapter = sorted[batchEnd + 1];
        const prevChapter = sorted[batchEnd];

        // Must be contiguous
        if (nextChapter !== prevChapter + 1) break;

        // Must not exceed chapter count limit
        if (batchEnd - batchStart + 1 >= MAX_CHAPTERS_PER_BATCH) break;

        const nextVerses = book.chapters[nextChapter - 1] ?? 0;
        if (verseCount + nextVerses > MAX_VERSES_PER_REQUEST) break;

        verseCount += nextVerses;
        batchEnd++;
      }

      batches.push({
        book,
        fromChapter: sorted[batchStart],
        toChapter: sorted[batchEnd],
        expectedVerseCount: verseCountForRange(book.name, sorted[batchStart], sorted[batchEnd]),
      });

      batchStart = batchEnd + 1;
    }
  }

  return batches;
}

// ─── ESV API Fetch ────────────────────────────────────────────────────────────

async function fetchBatch(
  apiKey: string,
  batch: BatchDescriptor,
): Promise<string> {
  const { book, fromChapter, toChapter } = batch;

  // Build passage query: "Genesis 1-3" or "Genesis 5" (single chapter)
  const passageQuery =
    fromChapter === toChapter
      ? `${book.name} ${fromChapter}`
      : `${book.name} ${fromChapter}-${toChapter}`;

  const params = buildTextRequestParams(passageQuery);
  const url = `${ESV_API_BASE}${ESV_TEXT_ENDPOINT}?${params.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`[esvApi] HTTP ${response.status} for "${passageQuery}": ${body}`);
  }

  const json = await response.json();

  if (!json.passages || !Array.isArray(json.passages) || json.passages.length === 0) {
    throw new Error(`[esvApi] Empty passages array for "${passageQuery}"`);
  }

  // The text endpoint may return multiple passage strings; join them.
  return json.passages.join('\n');
}

// ─── Plain-Text Verse Parser ──────────────────────────────────────────────────

/**
 * Parse the plain-text response from the ESV text endpoint into individual
 * ParsedChapter objects.
 *
 * The ESV text endpoint with include-verse-numbers=true produces lines like:
 *
 *   [1] In the beginning God created the heavens and the earth.
 *   [2] The earth was without form and void...
 *
 * When multiple chapters are requested, the API inserts a blank line between
 * chapters but does NOT insert chapter headings when include-headings=false and
 * include-chapter-numbers=false. We track chapter boundaries using the verse
 * number resetting to [1].
 *
 * This parser is deliberately conservative: if verse [1] appears again after
 * other verses have been seen in the current chapter, it advances to the next
 * expected chapter.
 */
export function parseBatchText(
  rawText: string,
  batch: BatchDescriptor,
): ParsedChapter[] {
  const { book, fromChapter, toChapter } = batch;

  // Initialize one ParsedChapter per expected chapter
  const chapterMap = new Map<number, ParsedVerse[]>();
  for (let c = fromChapter; c <= toChapter; c++) {
    chapterMap.set(c, []);
  }

  let currentChapter = fromChapter;
  let lastVerseNumber = 0;

  // Normalize line endings and split
  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Accumulate multi-line verses (poetry line continuation)
  let pendingVerseNumber: number | null = null;
  let pendingText = '';

  const flushPending = () => {
    if (pendingVerseNumber === null) return;
    const verses = chapterMap.get(currentChapter);
    if (verses) {
      verses.push({
        book: book.name,
        bookNumber: book.bookNumber,
        chapter: currentChapter,
        verse: pendingVerseNumber,
        text: normalizeText(pendingText),
      });
    }
    pendingVerseNumber = null;
    pendingText = '';
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Match a verse marker: [N] at the start of a line
    const verseMatch = line.match(/^\[(\d+)\]\s*(.*)/);
    if (!verseMatch) {
      // Continuation of the previous verse (poetry, wrapped text)
      if (pendingVerseNumber !== null) {
        pendingText += ' ' + line;
      }
      // Otherwise ignore (copyright line, blank, etc.)
      continue;
    }

    const verseNumber = parseInt(verseMatch[1], 10);
    const verseText = verseMatch[2];

    // Flush the previous accumulated verse
    flushPending();

    // Detect chapter boundary: verse number resets to 1 after we've seen
    // at least one verse in the current chapter.
    if (verseNumber === 1 && lastVerseNumber > 1) {
      currentChapter++;
      if (currentChapter > toChapter) {
        // Unexpected extra chapter — stop parsing
        console.warn(`[esvApi] Unexpected chapter overflow past ${toChapter} in ${book.name}`);
        break;
      }
    }

    lastVerseNumber = verseNumber;
    pendingVerseNumber = verseNumber;
    pendingText = verseText;
  }

  // Flush the final verse
  flushPending();

  // Build ParsedChapter results with validation
  const results: ParsedChapter[] = [];

  for (let c = fromChapter; c <= toChapter; c++) {
    const verses = chapterMap.get(c) ?? [];
    const expected = getExpectedVerseCount(book.name, c);
    const actual = verses.length;

    let isValid = true;
    let validationError: string | undefined;

    if (expected === null) {
      isValid = false;
      validationError = `No canonical verse count for ${book.name} ${c}`;
    } else if (actual !== expected) {
      isValid = false;
      validationError =
        `${book.name} ${c}: expected ${expected} verses, parsed ${actual}`;
    } else {
      // Verify verse numbering is sequential 1..N
      for (let i = 0; i < verses.length; i++) {
        if (verses[i].verse !== i + 1) {
          isValid = false;
          validationError =
            `${book.name} ${c}: verse sequence broken at index ${i} (got ${verses[i].verse})`;
          break;
        }
      }
    }

    results.push({
      book: book.name,
      bookNumber: book.bookNumber,
      chapter: c,
      verses,
      isValid,
      validationError,
    });
  }

  return results;
}

function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')   // collapse internal whitespace
    .replace(/\u00a0/g, ' ') // non-breaking spaces
    .trim();
}

// ─── Pacing Utility ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main Download Orchestrator ───────────────────────────────────────────────

/**
 * downloadBibleBatched
 *
 * Orchestrates a full (or resumable) Bible download.
 *
 * @param apiKey        ESV API key
 * @param pendingChapters  Chapters not yet marked complete in bible_chapter_cache
 * @param onProgress    Optional callback for UI progress updates
 * @param onChapterReady  Called after each valid chapter is parsed — caller
 *                        writes to SQLite and marks complete.
 * @param onChapterFailed Called when a chapter fails validation or the batch
 *                        request fails — caller marks the chapter as failed.
 *
 * Returns a summary: { completed, failed }
 */
export async function downloadBibleBatched(params: {
  apiKey: string;
  pendingChapters: PendingChapter[];
  onProgress?: ProgressCallback;
  onChapterReady: (chapter: ParsedChapter) => Promise<void>;
  onChapterFailed: (book: string, chapter: number, error: string) => Promise<void>;
}): Promise<{ completed: number; failed: number }> {
  const { apiKey, pendingChapters, onProgress, onChapterReady, onChapterFailed } = params;

  const totalChapters = pendingChapters.length;
  let completedChapters = 0;
  let failedChapters = 0;

  if (totalChapters === 0) {
    onProgress?.({
      completedChapters: 0,
      totalChapters: 0,
      failedChapters: 0,
      currentBook: '',
      currentBatch: '',
      phase: 'complete',
    });
    return { completed: 0, failed: 0 };
  }

  // Step 1: Build batches
  onProgress?.({
    completedChapters,
    totalChapters,
    failedChapters,
    currentBook: '',
    currentBatch: '',
    phase: 'building_batches',
  });

  const batches = buildBatches(pendingChapters);

  console.log(
    `[esvApi] ${totalChapters} chapters → ${batches.length} batches ` +
    `(~${Math.round(totalChapters / batches.length * 10) / 10} chapters/batch avg)`
  );

  // Step 2: Execute batches serially
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchLabel =
      batch.fromChapter === batch.toChapter
        ? `${batch.book.name} ${batch.fromChapter}`
        : `${batch.book.name} ${batch.fromChapter}–${batch.toChapter}`;

    onProgress?.({
      completedChapters,
      totalChapters,
      failedChapters,
      currentBook: batch.book.name,
      currentBatch: batchLabel,
      phase: 'downloading',
    });

    // Attempt with retry
    let rawText: string | null = null;
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        rawText = await fetchBatch(apiKey, batch);
        break; // success
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`[esvApi] Batch "${batchLabel}" attempt ${attempt} failed: ${lastError}`);

        if (attempt < MAX_RETRIES) {
          const backoff = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`[esvApi] Retrying "${batchLabel}" in ${backoff}ms…`);
          await sleep(backoff);
        }
      }
    }

    // If all retries failed, mark every chapter in the batch as failed
    if (rawText === null) {
      for (let c = batch.fromChapter; c <= batch.toChapter; c++) {
        await onChapterFailed(batch.book.name, c, lastError);
        failedChapters++;
      }
      // Pace even on failure to avoid hammering a struggling API
      if (batchIndex < batches.length - 1) await sleep(REQUEST_INTERVAL_MS);
      continue;
    }

    // Step 3: Parse the batch text into per-chapter results
    let parsedChapters: ParsedChapter[];
    try {
      parsedChapters = parseBatchText(rawText, batch);
    } catch (parseErr) {
      const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      console.error(`[esvApi] Parse error for batch "${batchLabel}": ${errMsg}`);
      for (let c = batch.fromChapter; c <= batch.toChapter; c++) {
        await onChapterFailed(batch.book.name, c, `Parse error: ${errMsg}`);
        failedChapters++;
      }
      if (batchIndex < batches.length - 1) await sleep(REQUEST_INTERVAL_MS);
      continue;
    }

    // Step 4: Validate and persist each chapter independently
    for (const parsedChapter of parsedChapters) {
      if (!parsedChapter.isValid) {
        console.error(
          `[esvApi] Validation failed for ${parsedChapter.book} ${parsedChapter.chapter}: ` +
          parsedChapter.validationError
        );
        await onChapterFailed(
          parsedChapter.book,
          parsedChapter.chapter,
          parsedChapter.validationError ?? 'Validation failed'
        );
        failedChapters++;
      } else {
        try {
          await onChapterReady(parsedChapter);
          completedChapters++;
          console.log(
            `[esvApi] ✓ ${parsedChapter.book} ${parsedChapter.chapter} ` +
            `(${parsedChapter.verses.length} verses)`
          );
        } catch (dbErr) {
          const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
          console.error(
            `[esvApi] DB write failed for ${parsedChapter.book} ${parsedChapter.chapter}: ${errMsg}`
          );
          await onChapterFailed(parsedChapter.book, parsedChapter.chapter, `DB error: ${errMsg}`);
          failedChapters++;
        }
      }
    }

    onProgress?.({
      completedChapters,
      totalChapters,
      failedChapters,
      currentBook: batch.book.name,
      currentBatch: batchLabel,
      phase: 'downloading',
    });

    // Pace between requests
    if (batchIndex < batches.length - 1) {
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  const phase = failedChapters === 0 ? 'complete' : 'failed';

  onProgress?.({
    completedChapters,
    totalChapters,
    failedChapters,
    currentBook: '',
    currentBatch: '',
    phase,
  });

  console.log(
    `[esvApi] Download complete — ${completedChapters} succeeded, ${failedChapters} failed ` +
    `out of ${totalChapters} total chapters`
  );

  return { completed: completedChapters, failed: failedChapters };
}

// ─── Single-Chapter Fetch (Study Screen) ─────────────────────────────────────

/**
 * fetchSingleChapter
 *
 * Used by the Chapter Reading screen when a chapter is requested on demand
 * (cache miss during normal use, after the initial download is complete).
 * This is a single-chapter fetch — the batch strategy is only for the
 * full-Bible initial download.
 */
export async function fetchSingleChapter(
  apiKey: string,
  bookName: string,
  bookNumber: number,
  chapter: number,
): Promise<ParsedChapter> {
  const bookMeta = BIBLE_METADATA.find(b => b.bookNumber === bookNumber);
  if (!bookMeta) {
    throw new Error(`[esvApi] Unknown book number ${bookNumber}`);
  }

  const batch: BatchDescriptor = {
    book: bookMeta,
    fromChapter: chapter,
    toChapter: chapter,
    expectedVerseCount: getExpectedVerseCount(bookName, chapter) ?? 0,
  };

  const rawText = await fetchBatch(apiKey, batch);
  const parsed = parseBatchText(rawText, batch);

  if (parsed.length === 0) {
    throw new Error(`[esvApi] No chapters parsed for ${bookName} ${chapter}`);
  }

  return parsed[0];
}