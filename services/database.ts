import * as SQLite from 'expo-sqlite';

import { BIBLE_METADATA } from '../constants/bibleMetadata';
import type { PendingChapter } from './esvApi';

export interface BibleVerse {
  translation_code: string;
  book: string;
  book_number: number;
  chapter: number;
  verse: number;
  text: string;
  retrieved_at: string;
  source: string | null;
}

export interface VerseInput {
  verse: number;
  text: string;
}

export interface InsertChapterParams {
  translationCode: string;
  book: string;
  bookNumber: number;
  chapter: number;
  verses: VerseInput[];
  expectedVerseCount: number;
  source?: string;
}

export type PendingChapterRecord = PendingChapter;

const CREATE_TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS bible_verses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      translation_code TEXT NOT NULL,
      book TEXT NOT NULL,
      book_number INTEGER NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      text TEXT NOT NULL,
      retrieved_at DATETIME,
      source TEXT,
      UNIQUE(translation_code, book, chapter, verse)
    )`,
  `CREATE TABLE IF NOT EXISTS bible_chapter_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      translation_code TEXT NOT NULL,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      expected_verse_count INTEGER,
      downloaded_verse_count INTEGER,
      is_complete BOOLEAN DEFAULT 0,
      fetch_status TEXT,
      last_fetched_at DATETIME,
      error_message TEXT,
      UNIQUE(translation_code, book, chapter)
    )`,
  `CREATE TABLE IF NOT EXISTS kardia_translations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_translation_code TEXT,
      book TEXT,
      chapter INTEGER,
      verse INTEGER,
      source_text TEXT,
      kardia_text TEXT,
      hebrew_word TEXT,
      hebrew_category TEXT,
      why_this_matters TEXT,
      kardia_version TEXT,
      generation_status TEXT,
      last_error TEXT,
      created_at DATETIME,
      updated_at DATETIME,
      UNIQUE(source_translation_code, book, chapter, verse)
    )`,
  `CREATE TABLE IF NOT EXISTS word_recovery_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hebrew_word TEXT,
      hebrew_transliteration TEXT,
      greek_word TEXT,
      greek_transliteration TEXT,
      english_esv_rendering TEXT,
      kardia_rendering TEXT,
      full_hebrew_category TEXT,
      first_seen_passage TEXT,
      date_added DATETIME
    )`,
  `CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME
    )`,
];

let db: SQLite.SQLiteDatabase | null = null;

export function initializeDatabase(): void {
  if (db) {
    return;
  }
  db = SQLite.openDatabaseSync('kardia.db');
  db.withTransactionSync(() => {
    for (const sql of CREATE_TABLES_SQL) {
      db!.execSync(sql);
    }
  });
}

function getDbOrThrow(): SQLite.SQLiteDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

function now(): string {
  return new Date().toISOString();
}

export function getPendingChapters(translationCode: string): PendingChapterRecord[] {
  const database = getDbOrThrow();
  const rows = database.getAllSync<{ book: string; chapter: number; is_complete: number; fetch_status: string | null }>(
    'SELECT book, chapter, is_complete, fetch_status FROM bible_chapter_cache WHERE translation_code = ?',
    [translationCode],
  );

  const cache = new Map<string, { isComplete: boolean; fetchStatus: string | null }>();
  for (const row of rows) {
    cache.set(`${row.book}|${row.chapter}`, {
      isComplete: row.is_complete === 1,
      fetchStatus: row.fetch_status,
    });
  }

  const pending: PendingChapterRecord[] = [];
  for (const bookMeta of BIBLE_METADATA) {
    for (let chapter = 1; chapter <= bookMeta.chapters.length; chapter += 1) {
      const key = `${bookMeta.name}|${chapter}`;
      const existing = cache.get(key);
      if (existing?.isComplete) {
        continue;
      }
      pending.push({
        translationCode,
        book: bookMeta.name,
        bookNumber: bookMeta.bookNumber,
        chapter,
        expectedVerseCount: bookMeta.chapters[chapter - 1],
        isFailed: existing?.fetchStatus === 'failed',
      });
    }
  }

  return pending;
}

export function insertChapterVerses(params: InsertChapterParams): void {
  const database = getDbOrThrow();
  database.withTransactionSync(() => {
    const statement = database.prepareSync(
      `INSERT INTO bible_verses
         (translation_code, book, book_number, chapter, verse, text, retrieved_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(translation_code, book, chapter, verse)
       DO UPDATE SET text = excluded.text, retrieved_at = excluded.retrieved_at, source = excluded.source`,
    );

    try {
      const retrievedAt = now();
      for (const verse of params.verses) {
        statement.executeSync([
          params.translationCode,
          params.book,
          params.bookNumber,
          params.chapter,
          verse.verse,
          verse.text,
          retrievedAt,
          params.source ?? 'esv_api',
        ]);
      }
    } finally {
      statement.finalizeSync();
    }

    database.runSync(
      `INSERT INTO bible_chapter_cache
         (translation_code, book, chapter, expected_verse_count, downloaded_verse_count, is_complete, fetch_status, last_fetched_at, error_message)
       VALUES (?, ?, ?, ?, ?, 0, 'persisting', ?, NULL)
       ON CONFLICT(translation_code, book, chapter)
       DO UPDATE SET
         expected_verse_count = excluded.expected_verse_count,
         downloaded_verse_count = excluded.downloaded_verse_count,
         fetch_status = 'persisting',
         last_fetched_at = excluded.last_fetched_at,
         error_message = NULL`,
      [
        params.translationCode,
        params.book,
        params.chapter,
        params.expectedVerseCount,
        params.verses.length,
        now(),
      ],
    );
  });
}

export function markChapterComplete(translationCode: string, book: string, chapter: number): void {
  const database = getDbOrThrow();
  database.runSync(
    `INSERT INTO bible_chapter_cache
       (translation_code, book, chapter, expected_verse_count, downloaded_verse_count, is_complete, fetch_status, last_fetched_at, error_message)
     VALUES (?, ?, ?, NULL, NULL, 1, 'complete', ?, NULL)
     ON CONFLICT(translation_code, book, chapter)
     DO UPDATE SET
       is_complete = 1,
       fetch_status = 'complete',
       last_fetched_at = excluded.last_fetched_at,
       error_message = NULL`,
    [translationCode, book, chapter, now()],
  );
}

export function markChapterFailed(
  translationCode: string,
  book: string,
  chapter: number,
  errorMessage: string,
): void {
  const database = getDbOrThrow();
  database.runSync(
    `INSERT INTO bible_chapter_cache
       (translation_code, book, chapter, expected_verse_count, downloaded_verse_count, is_complete, fetch_status, last_fetched_at, error_message)
     VALUES (?, ?, ?, NULL, NULL, 0, 'failed', ?, ?)
     ON CONFLICT(translation_code, book, chapter)
     DO UPDATE SET
       is_complete = 0,
       fetch_status = 'failed',
       error_message = excluded.error_message,
       last_fetched_at = excluded.last_fetched_at`,
    [translationCode, book, chapter, now(), errorMessage],
  );
}

export function isBibleDownloadComplete(): boolean {
  return getAppConfig('bible_download_complete') === 'true';
}

export function setBibleDownloadComplete(complete: boolean): void {
  setAppConfig('bible_download_complete', complete ? 'true' : 'false');
}

export function removeTranslationData(translationCode: string): void {
  const database = getDbOrThrow();
  database.withTransactionSync(() => {
    database.runSync('DELETE FROM bible_verses WHERE translation_code = ?', [translationCode]);
    database.runSync('DELETE FROM bible_chapter_cache WHERE translation_code = ?', [translationCode]);
    database.runSync('DELETE FROM kardia_translations WHERE source_translation_code = ?', [translationCode]);
  });
  setBibleDownloadComplete(false);
}

export function getChapterVerses(
  translationCode: string,
  book: string,
  chapter: number,
): BibleVerse[] {
  const database = getDbOrThrow();
  return database.getAllSync<BibleVerse>(
    `SELECT translation_code, book, book_number, chapter, verse, text, retrieved_at, source
     FROM bible_verses
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
  const database = getDbOrThrow();
  const row = database.getFirstSync<{ is_complete: number }>(
    'SELECT is_complete FROM bible_chapter_cache WHERE translation_code = ? AND book = ? AND chapter = ?',
    [translationCode, book, chapter],
  );
  return row?.is_complete === 1;
}

export function getAppConfig(key: string): string | null {
  const database = getDbOrThrow();
  const row = database.getFirstSync<{ value: string }>(
    'SELECT value FROM app_config WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export function setAppConfig(key: string, value: string): void {
  const database = getDbOrThrow();
  database.runSync(
    `INSERT INTO app_config (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now()],
  );
}

export const insertVerses = insertChapterVerses;
