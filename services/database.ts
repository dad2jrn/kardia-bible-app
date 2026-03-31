import * as SQLite from 'expo-sqlite';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface BibleVerse {
  id?: number;
  translation_code: string;
  book: string;
  book_number: number;
  chapter: number;
  verse: number;
  text: string;
  retrieved_at: string | null;
  source: string | null;
}

export interface BibleChapterCache {
  id?: number;
  translation_code: string;
  book: string;
  chapter: number;
  expected_verse_count: number | null;
  downloaded_verse_count: number | null;
  is_complete: boolean;
  fetch_status: string | null;
  last_fetched_at: string | null;
  error_message: string | null;
}

export interface KardiaTranslation {
  id?: number;
  source_translation_code: string | null;
  book: string | null;
  chapter: number | null;
  verse: number | null;
  source_text: string | null;
  kardia_text: string | null;
  hebrew_word: string | null;
  hebrew_category: string | null;
  why_this_matters: string | null;
  kardia_version: string | null;
  generation_status: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface WordRecoveryLog {
  id?: number;
  hebrew_word: string | null;
  hebrew_transliteration: string | null;
  greek_word: string | null;
  greek_transliteration: string | null;
  english_esv_rendering: string | null;
  kardia_rendering: string | null;
  full_hebrew_category: string | null;
  first_seen_passage: string | null;
  date_added: string | null;
}

export interface AppConfig {
  key: string;
  value: string | null;
  updated_at: string | null;
}

export interface VerseInput {
  verse: number;
  book_number: number;
  text: string;
  source?: string;
}

export interface ChapterCacheUpdate {
  expected_verse_count?: number;
  downloaded_verse_count?: number;
  is_complete?: boolean;
  fetch_status?: string;
  error_message?: string | null;
}

// ─── Database singleton ───────────────────────────────────────────────────────

let db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const CREATE_TABLES_SQL: string[] = [
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Opens the SQLite database and creates all tables if they don't exist.
 * Must be called once at app startup before any other database function.
 */
export async function initializeDatabase(): Promise<void> {
  try {
    db = await SQLite.openDatabaseAsync('kardia.db');
    for (const sql of CREATE_TABLES_SQL) {
      await db.execAsync(sql);
    }
  } catch (error) {
    console.error('[database] initializeDatabase failed:', error);
    throw error;
  }
}

/**
 * Bulk-inserts verses for a chapter within a single transaction.
 * On success, marks the chapter cache as complete with the final verse count.
 */
export async function insertVerses(
  translationCode: string,
  book: string,
  chapter: number,
  verses: VerseInput[],
): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();

  try {
    await database.withTransactionAsync(async () => {
      for (const v of verses) {
        await database.runAsync(
          `INSERT INTO bible_verses
             (translation_code, book, book_number, chapter, verse, text, retrieved_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(translation_code, book, chapter, verse)
           DO UPDATE SET
             text = excluded.text,
             book_number = excluded.book_number,
             retrieved_at = excluded.retrieved_at,
             source = excluded.source`,
          [translationCode, book, v.book_number, chapter, v.verse, v.text, now, v.source ?? null],
        );
      }

      // Only mark complete after all inserts succeed
      await database.runAsync(
        `INSERT INTO bible_chapter_cache
           (translation_code, book, chapter, expected_verse_count, downloaded_verse_count,
            is_complete, fetch_status, last_fetched_at, error_message)
         VALUES (?, ?, ?, ?, ?, 1, 'complete', ?, NULL)
         ON CONFLICT(translation_code, book, chapter)
         DO UPDATE SET
           downloaded_verse_count = excluded.downloaded_verse_count,
           is_complete = 1,
           fetch_status = 'complete',
           last_fetched_at = excluded.last_fetched_at,
           error_message = NULL`,
        [translationCode, book, chapter, verses.length, verses.length, now],
      );
    });
  } catch (error) {
    console.error(
      `[database] insertVerses failed for ${translationCode} ${book} ${chapter}:`,
      error,
    );
    throw error;
  }
}

/**
 * Returns all verses for a chapter ordered by verse number.
 */
export async function getChapterVerses(
  translationCode: string,
  book: string,
  chapter: number,
): Promise<BibleVerse[]> {
  const database = await getDb();

  try {
    const rows = await database.getAllAsync<BibleVerse>(
      `SELECT * FROM bible_verses
       WHERE translation_code = ? AND book = ? AND chapter = ?
       ORDER BY verse ASC`,
      [translationCode, book, chapter],
    );
    return rows;
  } catch (error) {
    console.error(
      `[database] getChapterVerses failed for ${translationCode} ${book} ${chapter}:`,
      error,
    );
    throw error;
  }
}

/**
 * Returns the cache record for a chapter, or null if never fetched.
 */
export async function getChapterCacheStatus(
  translationCode: string,
  book: string,
  chapter: number,
): Promise<BibleChapterCache | null> {
  const database = await getDb();

  try {
    const row = await database.getFirstAsync<BibleChapterCache>(
      `SELECT * FROM bible_chapter_cache
       WHERE translation_code = ? AND book = ? AND chapter = ?`,
      [translationCode, book, chapter],
    );
    return row ?? null;
  } catch (error) {
    console.error(
      `[database] getChapterCacheStatus failed for ${translationCode} ${book} ${chapter}:`,
      error,
    );
    throw error;
  }
}

/**
 * Upserts cache tracking metadata for a chapter after a fetch attempt.
 * Pass is_complete: true only once verse inserts have fully succeeded.
 */
export async function updateChapterCache(
  translationCode: string,
  book: string,
  chapter: number,
  status: ChapterCacheUpdate,
): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();

  try {
    await database.runAsync(
      `INSERT INTO bible_chapter_cache
         (translation_code, book, chapter, expected_verse_count, downloaded_verse_count,
          is_complete, fetch_status, last_fetched_at, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(translation_code, book, chapter)
       DO UPDATE SET
         expected_verse_count   = COALESCE(excluded.expected_verse_count,   expected_verse_count),
         downloaded_verse_count = COALESCE(excluded.downloaded_verse_count, downloaded_verse_count),
         is_complete     = excluded.is_complete,
         fetch_status    = excluded.fetch_status,
         last_fetched_at = excluded.last_fetched_at,
         error_message   = excluded.error_message`,
      [
        translationCode,
        book,
        chapter,
        status.expected_verse_count ?? null,
        status.downloaded_verse_count ?? null,
        status.is_complete ? 1 : 0,
        status.fetch_status ?? null,
        now,
        status.error_message ?? null,
      ],
    );
  } catch (error) {
    console.error(
      `[database] updateChapterCache failed for ${translationCode} ${book} ${chapter}:`,
      error,
    );
    throw error;
  }
}

/**
 * Retrieves a config value by key. Returns null if the key does not exist.
 */
export async function getAppConfig(key: string): Promise<string | null> {
  const database = await getDb();

  try {
    const row = await database.getFirstAsync<AppConfig>(
      `SELECT value FROM app_config WHERE key = ?`,
      [key],
    );
    return row?.value ?? null;
  } catch (error) {
    console.error(`[database] getAppConfig failed for key "${key}":`, error);
    throw error;
  }
}

/**
 * Inserts or updates a config value by key.
 */
export async function setAppConfig(key: string, value: string): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();

  try {
    await database.runAsync(
      `INSERT INTO app_config (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, now],
    );
  } catch (error) {
    console.error(`[database] setAppConfig failed for key "${key}":`, error);
    throw error;
  }
}
