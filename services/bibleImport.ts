import { insertVerses, setAppConfig, getAppConfig } from './database';
import { BIBLE_BOOKS } from '../constants/bibleMetadata';
import type { BookMetadata } from '../constants/bibleMetadata';

export type ImportProgressCallback = (progress: {
  currentBook: string;
  currentBookNumber: number;
  totalBooks: number;
  booksCompleted: number;
}) => void;

export interface ImportResult {
  booksImported: number;
  chaptersImported: number;
  versesImported: number;
  warnings: string[];
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BOOK_NAME_ALIASES: Record<string, string> = {
  psalm: 'psalms',
  songofsongs: 'songofsolomon',
  canticles: 'songofsolomon',
};

function findBookInJson(
  book: BookMetadata,
  jsonData: Record<string, unknown>,
): Record<string, unknown> | null {
  // Direct match first
  if (jsonData[book.name] && typeof jsonData[book.name] === 'object') {
    return jsonData[book.name] as Record<string, unknown>;
  }

  // Normalized match
  const target = normalize(book.name);
  const resolvedTarget = BOOK_NAME_ALIASES[target] ?? target;

  for (const key of Object.keys(jsonData)) {
    if (key === 'Info') continue;
    const normalizedKey = normalize(key);
    const resolvedKey = BOOK_NAME_ALIASES[normalizedKey] ?? normalizedKey;
    if (resolvedKey === resolvedTarget && typeof jsonData[key] === 'object') {
      return jsonData[key] as Record<string, unknown>;
    }
  }

  return null;
}

export async function importBibleFromJson(
  translationCode: string,
  jsonData: Record<string, unknown>,
  onProgress: ImportProgressCallback,
): Promise<ImportResult> {
  const warnings: string[] = [];
  let booksImported = 0;
  let chaptersImported = 0;
  let versesImported = 0;
  let skippedBooks = 0;
  const totalBooks = BIBLE_BOOKS.length;

  for (let i = 0; i < BIBLE_BOOKS.length; i++) {
    const book = BIBLE_BOOKS[i];
    const bookData = findBookInJson(book, jsonData);

    if (!bookData) {
      const msg = `Book "${book.name}" not found in JSON data.`;
      console.warn('[bibleImport]', msg);
      warnings.push(msg);
      skippedBooks++;
      onProgress({
        currentBook: book.name,
        currentBookNumber: book.bookNumber,
        totalBooks,
        booksCompleted: i + 1,
      });
      continue;
    }

    let bookHadSuccessfulInsert = false;

    // Get chapter keys, filter to numeric only, sort numerically
    const chapterKeys = Object.keys(bookData)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));

    for (const chapterKey of chapterKeys) {
      const chapterNumber = Number(chapterKey);
      const chapterData = bookData[chapterKey];

      if (!chapterData || typeof chapterData !== 'object') {
        warnings.push(`${book.name} chapter ${chapterNumber}: invalid structure, skipping.`);
        continue;
      }

      const chapterRecord = chapterData as Record<string, unknown>;
      const verseKeys = Object.keys(chapterRecord)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b));

      if (verseKeys.length === 0) {
        warnings.push(`${book.name} chapter ${chapterNumber}: no verses found, skipping.`);
        continue;
      }

      const verses = verseKeys.map((vk) => ({
        verse: Number(vk),
        book_number: book.bookNumber,
        text: String(chapterRecord[vk]),
        source: 'json_import',
      }));

      try {
        insertVerses({
          translationCode,
          book: book.name,
          bookNumber: book.bookNumber,
          chapter: chapterNumber,
          verses: verses.map(({ verse, text }) => ({ verse, text })),
          expectedVerseCount: book.chapters?.[chapterNumber - 1] ?? verses.length,
          source: 'json_import',
        });
        bookHadSuccessfulInsert = true;
        chaptersImported++;
        versesImported += verses.length;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[bibleImport] Failed to insert ${book.name} ${chapterNumber}:`, error);
        warnings.push(`Failed to insert ${book.name} ${chapterNumber}: ${errMsg}`);
      }
    }

    if (bookHadSuccessfulInsert) {
      booksImported++;
    }

    onProgress({
      currentBook: book.name,
      currentBookNumber: book.bookNumber,
      totalBooks,
      booksCompleted: i + 1,
    });
  }

  if (skippedBooks === 0) {
    try {
      setAppConfig('bible_download_complete', 'true');
    } catch (error) {
      console.error('[bibleImport] Failed to set completion flag:', error);
    }
  } else {
    console.warn(`[bibleImport] Finished with ${skippedBooks} skipped books — not marking complete.`);
  }

  return { booksImported, chaptersImported, versesImported, warnings };
}

export function isBibleImportComplete(): boolean {
  return getAppConfig('bible_download_complete') === 'true';
}
