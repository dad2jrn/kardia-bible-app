/**
 * bibleDownloadService.ts
 *
 * Orchestration layer between the ESV API batched downloader and SQLite.
 *
 * Responsibilities:
 *   - Query bible_chapter_cache to determine which chapters are pending
 *   - Drive downloadBibleBatched with onChapterReady / onChapterFailed hooks
 *   - Write each valid chapter to bible_verses via database.ts
 *   - Mark chapters complete or failed in bible_chapter_cache
 *   - Set the global bible_download_complete flag only when fully done
 *   - Expose a simple surface for the FirstLaunch screen to attach progress UI
 *
 * This service does NOT touch the UI. Progress is communicated via callback.
 */

import { downloadBibleBatched, ParsedChapter, DownloadProgressEvent, PendingChapter } from './esvApi';
import { BIBLE_METADATA, getExpectedVerseCount } from '../constants/bibleMetadata';
import {
  getPendingChapters,
  insertChapterVerses,
  markChapterComplete,
  markChapterFailed,
  setBibleDownloadComplete,
  isBibleDownloadComplete,
} from './database';

export interface DownloadSummary {
  completed: number;
  failed: number;
  alreadyComplete: boolean;
}

/**
 * runBibleDownload
 *
 * Entry point called from the FirstLaunch screen (and optionally from
 * the retry path in Settings).
 *
 * @param apiKey     ESV API key from constants/config.ts
 * @param onProgress Progress callback for UI updates
 */
export async function runBibleDownload(
  apiKey: string,
  onProgress?: (event: DownloadProgressEvent) => void,
): Promise<DownloadSummary> {
  // Fast path: already complete
  const alreadyDone = await isBibleDownloadComplete();
  if (alreadyDone) {
    return { completed: 0, failed: 0, alreadyComplete: true };
  }

  // Build the pending chapter list from cache state
  const pendingChapters = await buildPendingChapterList();

  if (pendingChapters.length === 0) {
    // All chapters marked complete — set the global flag and return
    await setBibleDownloadComplete(true);
    return { completed: 0, failed: 0, alreadyComplete: true };
  }

  console.log(`[bibleDownload] ${pendingChapters.length} chapters pending download`);

  const { completed, failed } = await downloadBibleBatched({
    apiKey,
    pendingChapters,
    onProgress,

    onChapterReady: async (chapter: ParsedChapter) => {
      // Write all verses for this chapter in one transaction
      await insertChapterVerses({
        translationCode: 'ESV',
        book: chapter.book,
        bookNumber: chapter.bookNumber,
        chapter: chapter.chapter,
        verses: chapter.verses.map(v => ({
          verse: v.verse,
          text: v.text,
        })),
        expectedVerseCount: getExpectedVerseCount(chapter.book, chapter.chapter) ?? chapter.verses.length,
      });

      // Mark the chapter complete in cache
      await markChapterComplete('ESV', chapter.book, chapter.chapter);
    },

    onChapterFailed: async (book: string, chapter: number, error: string) => {
      await markChapterFailed('ESV', book, chapter, error);
    },
  });

  // Only set the global completion flag when nothing failed
  if (failed === 0) {
    await setBibleDownloadComplete(true);
    console.log('[bibleDownload] Full Bible download complete ✓');
  } else {
    console.warn(`[bibleDownload] Download finished with ${failed} failed chapters — not marking complete`);
  }

  return { completed, failed, alreadyComplete: false };
}

/**
 * buildPendingChapterList
 *
 * Returns all chapters not yet marked complete in bible_chapter_cache.
 * On first launch this is all 1,189 chapters.
 * On resume after a partial failure it is only the failed or never-attempted ones.
 */
async function buildPendingChapterList(): Promise<PendingChapter[]> {
  // Get the set of completed chapters from the database
  const completedSet = await getPendingChapters('ESV'); // returns non-complete chapters

  return completedSet;
}

/**
 * getDownloadProgress
 *
 * Synchronous-friendly summary for the Settings screen to display
 * download status after the initial launch.
 */
export async function getDownloadStatus(): Promise<{
  isComplete: boolean;
  completedChapters: number;
  totalChapters: number;
  failedChapters: number;
}> {
  const isComplete = await isBibleDownloadComplete();
  const pending = await getPendingChapters('ESV');

  const totalChapters = BIBLE_METADATA.reduce((sum, b) => sum + b.chapters.length, 0);
  const completedChapters = totalChapters - pending.length;

  // Count chapters marked as failed specifically
  // (getPendingChapters returns all non-complete; failed is a subset)
  const failedChapters = pending.filter(p => p.isFailed).length;

  return {
    isComplete,
    completedChapters,
    totalChapters,
    failedChapters,
  };
}