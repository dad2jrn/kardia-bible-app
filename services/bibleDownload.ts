import { fetchChapter } from './esvApi';
import { insertVerses, getChapterCacheStatus, setAppConfig, getAppConfig } from './database';
import { BIBLE_BOOKS, getTotalChapters } from '../constants/bibleMetadata';
import { TRANSLATION_CODE } from '../constants/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DownloadProgressCallback = (progress: {
  currentBook: string;
  currentBookNumber: number;
  totalBooks: number;
  currentChapter: number;
  totalChaptersInBook: number;
  overallChaptersCompleted: number;
  overallTotalChapters: number;
}) => void;

// ─── Constants ────────────────────────────────────────────────────────────────

const INTER_REQUEST_DELAY_MS = 300;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Downloads all 66 Bible books from the ESV API into the local SQLite database.
 *
 * - Skips chapters that are already fully cached (resumable).
 * - Individual chapter failures are logged and skipped; the overall download continues.
 * - On completion, sets the app config flag 'bible_download_complete' to 'true'.
 */
export async function downloadAllBooks(onProgress: DownloadProgressCallback): Promise<void> {
  const totalBooks = BIBLE_BOOKS.length;
  const overallTotalChapters = getTotalChapters();
  let overallChaptersCompleted = 0;

  for (const book of BIBLE_BOOKS) {
    for (let chapter = 1; chapter <= book.chapters; chapter++) {
      // ── Check cache before fetching ────────────────────────────────────────
      let alreadyCached = false;
      try {
        const cacheStatus = await getChapterCacheStatus(TRANSLATION_CODE, book.name, chapter);
        if (cacheStatus?.is_complete) {
          alreadyCached = true;
        }
      } catch (cacheError) {
        console.warn(
          `[bibleDownload] Cache check failed for ${book.name} ${chapter}:`,
          cacheError,
        );
        // Treat as not cached; attempt download
      }

      if (!alreadyCached) {
        try {
          const { verses } = await fetchChapter(book.name, chapter);

          const verseInputs = verses.map((v) => ({
            verse: v.verse,
            book_number: book.book_number,
            text: v.text,
            source: 'esv_api',
          }));

          await insertVerses(TRANSLATION_CODE, book.name, chapter, verseInputs);

          await delay(INTER_REQUEST_DELAY_MS);
        } catch (downloadError) {
          console.error(
            `[bibleDownload] Failed to download ${book.name} ${chapter}:`,
            downloadError,
          );
          // Skip this chapter; it remains incomplete and can be retried later
        }
      }

      overallChaptersCompleted += 1;

      onProgress({
        currentBook: book.name,
        currentBookNumber: book.book_number,
        totalBooks,
        currentChapter: chapter,
        totalChaptersInBook: book.chapters,
        overallChaptersCompleted,
        overallTotalChapters,
      });
    }
  }

  try {
    await setAppConfig('bible_download_complete', 'true');
  } catch (configError) {
    console.error('[bibleDownload] Failed to set bible_download_complete config:', configError);
  }
}

/**
 * Returns true if the full Bible download has been marked complete.
 */
export async function isBibleDownloadComplete(): Promise<boolean> {
  const value = await getAppConfig('bible_download_complete');
  return value === 'true';
}

/**
 * Counts how many chapters have been fully cached so far.
 * Useful for displaying resume progress after an interrupted download.
 */
export async function getDownloadProgress(): Promise<{
  completedChapters: number;
  totalChapters: number;
}> {
  const totalChapters = getTotalChapters();
  let completedChapters = 0;

  for (const book of BIBLE_BOOKS) {
    for (let chapter = 1; chapter <= book.chapters; chapter++) {
      try {
        const cacheStatus = await getChapterCacheStatus(TRANSLATION_CODE, book.name, chapter);
        if (cacheStatus?.is_complete) {
          completedChapters += 1;
        }
      } catch {
        // Treat as incomplete on error
      }
    }
  }

  return { completedChapters, totalChapters };
}
