/**
 * database.ts — Bible download functions
 *
 * These functions support the batched Bible download pipeline.
 * They are intended to be merged into your existing database.ts.
 *
 * Assumes expo-sqlite and that initializeDatabase() has already been called,
 * creating the following tables:
 *
 *   bible_verses (translation_code, book, book_number, chapter, verse, text,
 *                 retrieved_at, source)
 *   bible_chapter_cache (translation_code, book, chapter, expected_verse_count,
 *                        downloaded_verse_count, is_complete, fetch_status,
 *                        last_fetched_at, error_message)
 *   app_config (key PRIMARY KEY, value, updated_at)
 */

import * as SQLite from 'expo-sqlite';
import { BIBLE_METADATA, getExpectedVerseCount } from '../constants/bibleMetadata';
import { PendingChapter } from './esvApi';

// Open (or reuse) the database — match the name used in your existing database.ts
const db = SQLite.openDatabaseSync('kardia.db');

// ─── Schema Initialization ────────────────────────────────────────────────────

/**
 * Ensures all required tables exist.
 * Call once at app startup before any other database function.
 */
export function initializeDatabase(): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS bible_verses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      translation_code  TEXT NOT NULL,
      book              TEXT NOT NULL,
      book_number       INTEGER NOT NULL,
      chapter           INTEGER NOT NULL,
      verse             INTEGER NOT NULL,
      text              TEXT NOT NULL,
      retrieved_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      source            TEXT DEFAULT 'ESV API',
      UNIQUE(translation_code, book, chapter, verse)
    );

    CREATE TABLE IF NOT EXISTS bible_chapter_cache (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      translation_code      TEXT NOT NULL,
      book                  TEXT NOT NULL,
      chapter               INTEGER NOT NULL,
      expected_verse_count  INTEGER,
      downloaded_verse_count INTEGER DEFAULT 0,
      is_complete           INTEGER DEFAULT 0,
      fetch_status          TEXT DEFAULT 'pending',
      last_fetched_at       DATETIME,
      error_message         TEXT,
      UNIQUE(translation_code, book, chapter)
    );

    CREATE TABLE IF NOT EXISTS app_config (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS kardia_translations (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      source_translation_code TEXT,
      book                    TEXT,
      chapter                 INTEGER,
      verse                   INTEGER,
      source_text             TEXT,
      kardia_text             TEXT,
      hebrew_word             TEXT,
      hebrew_category         TEXT,
      why_this_matters        TEXT,
      kardia_version          TEXT,
      generation_status       TEXT DEFAULT 'generated',
      last_error              TEXT,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_translation_code, book, chapter, verse)
    );

    CREATE TABLE IF NOT EXISTS word_recovery_log (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      hebrew_word           TEXT,
      hebrew_transliteration TEXT,
      greek_word            TEXT,
      greek_transliteration  TEXT,
      english_esv_rendering TEXT,
      kardia_rendering      TEXT,
      full_hebrew_category  TEXT,
      first_seen_passage    TEXT,
      date_added            DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ─── Pending Chapter Query ────────────────────────────────────────────────────

export interface PendingChapterRecord extends PendingChapter {
  isFailed: boolean;
}

/**
 * Returns all chapters for a given translation that are NOT yet complete.
 * On first launch, bible_chapter_cache is empty, so we derive pending
 * chapters from BIBLE_METADATA directly.
 */
export async function getPendingChapters(
  translationCode: string,
): Promise<PendingChapterRecord[]> {
  // Get all chapters already marked complete
  const completedRows = db.getAllSync<{ book: string; chapter: number }>(
    `SELECT book, chapter FROM bible_chapter_cache
     WHERE translation_code = ? AND is_complete = 1`,
    [translationCode],
  );

  const completedSet = new Set(
    completedRows.map(r => `${r.book}::${r.chapter}`)
  );

  // Get failed chapters to tag them
  const failedRows = db.getAllSync<{ book: string; chapter: number }>(
    `SELECT book, chapter FROM bible_chapter_cache
     WHERE translation_code = ? AND fetch_status = 'failed'`,
    [translationCode],
  );
  const failedSet = new Set(
    failedRows.map(r => `${r.book}::${r.chapter}`)
  );

  const pending: PendingChapterRecord[] = [];

  for (const bookMeta of BIBLE_METADATA) {
    for (let chapterIndex = 0; chapterIndex < bookMeta.chapters.length; chapterIndex++) {
      const chapter = chapterIndex + 1;
      const key = `${bookMeta.name}::${chapter}`;

      if (!completedSet.has(key)) {
        pending.push({
          book: bookMeta.name,
          bookNumber: bookMeta.bookNumber,
          chapter,
          isFailed: failedSet.has(key),
        });
      }
    }
  }

  return pending;
}

// ─── Chapter Insert ───────────────────────────────────────────────────────────

export interface InsertChapterParams {
  translationCode: string;
  book: string;
  bookNumber: number;
  chapter: number;
  verses: Array<{ verse: number; text: string }>;
  expectedVerseCount: number;
}

/**
 * Inserts all verses for a chapter in a single transaction.
 * Only marks the chapter complete after all inserts succeed.
 * Uses ON CONFLICT REPLACE so re-downloads are safe.
 */
export function insertChapterVerses(params: InsertChapterParams): void {
  const { translationCode, book, bookNumber, chapter, verses, expectedVerseCount } = params;

  db.withTransactionSync(() => {
    // Upsert each verse
    const stmt = db.prepareSync(`
      INSERT INTO bible_verses
        (translation_code, book, book_number, chapter, verse, text, retrieved_at, source)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'ESV API')
      ON CONFLICT(translation_code, book, chapter, verse)
      DO UPDATE SET text = excluded.text, retrieved_at = excluded.retrieved_at
    `);

    try {
      for (const v of verses) {
        stmt.executeSync([translationCode, book, bookNumber, chapter, v.verse, v.text]);
      }
    } finally {
      stmt.finalizeSync();
    }

    // Upsert chapter cache row — NOT marked complete yet (markChapterComplete does that)
    db.runSync(`
      INSERT INTO bible_chapter_cache
        (translation_code, book, chapter, expected_verse_count, downloaded_verse_count,
         is_complete, fetch_status, last_fetched_at)
      VALUES (?, ?, ?, ?, ?, 0, 'persisting', CURRENT_TIMESTAMP)
      ON CONFLICT(translation_code, book, chapter)
      DO UPDATE SET
        downloaded_verse_count = excluded.downloaded_verse_count,
        expected_verse_count   = excluded.expected_verse_count,
        fetch_status           = 'persisting',
        last_fetched_at        = CURRENT_TIMESTAMP,
        error_message          = NULL
    `, [translationCode, book, chapter, expectedVerseCount, verses.length]);
  });
}

// ─── Chapter Status Updates ───────────────────────────────────────────────────

export function markChapterComplete(
  translationCode: string,
  book: string,
  chapter: number,
): void {
  db.runSync(`
    UPDATE bible_chapter_cache
    SET is_complete    = 1,
        fetch_status   = 'complete',
        last_fetched_at = CURRENT_TIMESTAMP,
        error_message  = NULL
    WHERE translation_code = ? AND book = ? AND chapter = ?
  `, [translationCode, book, chapter]);
}

export function markChapterFailed(
  translationCode: string,
  book: string,
  chapter: number,
  errorMessage: string,
): void {
  db.runSync(`
    INSERT INTO bible_chapter_cache
      (translation_code, book, chapter, is_complete, fetch_status,
       last_fetched_at, error_message)
    VALUES (?, ?, ?, 0, 'failed', CURRENT_TIMESTAMP, ?)
    ON CONFLICT(translation_code, book, chapter)
    DO UPDATE SET
      is_complete    = 0,
      fetch_status   = 'failed',
      last_fetched_at = CURRENT_TIMESTAMP,
      error_message  = excluded.error_message
  `, [translationCode, book, chapter, errorMessage]);
}

// ─── Global Completion Flag ───────────────────────────────────────────────────

export function isBibleDownloadComplete(): boolean {
  const row = db.getFirstSync<{ value: string }>(
    `SELECT value FROM app_config WHERE key = 'bible_download_complete'`
  );
  return row?.value === 'true';
}

export function setBibleDownloadComplete(complete: boolean): void {
  db.runSync(`
    INSERT INTO app_config (key, value, updated_at)
    VALUES ('bible_download_complete', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `, [complete ? 'true' : 'false']);
}

// ─── Verse Lookup (Chapter Reading Screen) ────────────────────────────────────

export interface VerseRow {
  verse: number;
  text: string;
}

export function getChapterVerses(
  translationCode: string,
  book: string,
  chapter: number,
): VerseRow[] {
  return db.getAllSync<VerseRow>(
    `SELECT verse, text FROM bible_verses
     WHERE translation_code = ? AND book = ? AND chapter = ?
     ORDER BY verse ASC`,
    [translationCode, book, chapter],
  );
}

export function isChapterCached(
  translationCode: string,
  book: string,
  chapter: number,
): boolean {
  const row = db.getFirstSync<{ is_complete: number }>(
    `SELECT is_complete FROM bible_chapter_cache
     WHERE translation_code = ? AND book = ? AND chapter = ?`,
    [translationCode, book, chapter],
  );
  return row?.is_complete === 1;
}