export interface BookMetadata {
  name: string;
  abbreviation: string;
  book_number: number;
  testament: 'OT' | 'NT';
  section: string;
  chapters: number;
}

export const BIBLE_BOOKS: BookMetadata[] = [
  // ── Torah ─────────────────────────────────────────────────────────────────
  { name: 'Genesis',      abbreviation: 'Gen',   book_number:  1, testament: 'OT', section: 'Torah',           chapters: 50 },
  { name: 'Exodus',       abbreviation: 'Exod',  book_number:  2, testament: 'OT', section: 'Torah',           chapters: 40 },
  { name: 'Leviticus',    abbreviation: 'Lev',   book_number:  3, testament: 'OT', section: 'Torah',           chapters: 27 },
  { name: 'Numbers',      abbreviation: 'Num',   book_number:  4, testament: 'OT', section: 'Torah',           chapters: 36 },
  { name: 'Deuteronomy',  abbreviation: 'Deut',  book_number:  5, testament: 'OT', section: 'Torah',           chapters: 34 },

  // ── History ───────────────────────────────────────────────────────────────
  { name: 'Joshua',       abbreviation: 'Josh',  book_number:  6, testament: 'OT', section: 'History',         chapters: 24 },
  { name: 'Judges',       abbreviation: 'Judg',  book_number:  7, testament: 'OT', section: 'History',         chapters: 21 },
  { name: 'Ruth',         abbreviation: 'Ruth',  book_number:  8, testament: 'OT', section: 'History',         chapters:  4 },
  { name: '1 Samuel',     abbreviation: '1 Sam', book_number:  9, testament: 'OT', section: 'History',         chapters: 31 },
  { name: '2 Samuel',     abbreviation: '2 Sam', book_number: 10, testament: 'OT', section: 'History',         chapters: 24 },
  { name: '1 Kings',      abbreviation: '1 Kgs', book_number: 11, testament: 'OT', section: 'History',         chapters: 22 },
  { name: '2 Kings',      abbreviation: '2 Kgs', book_number: 12, testament: 'OT', section: 'History',         chapters: 25 },
  { name: '1 Chronicles', abbreviation: '1 Chr', book_number: 13, testament: 'OT', section: 'History',         chapters: 29 },
  { name: '2 Chronicles', abbreviation: '2 Chr', book_number: 14, testament: 'OT', section: 'History',         chapters: 36 },
  { name: 'Ezra',         abbreviation: 'Ezra',  book_number: 15, testament: 'OT', section: 'History',         chapters: 10 },
  { name: 'Nehemiah',     abbreviation: 'Neh',   book_number: 16, testament: 'OT', section: 'History',         chapters: 13 },
  { name: 'Esther',       abbreviation: 'Esth',  book_number: 17, testament: 'OT', section: 'History',         chapters: 10 },

  // ── Poetry ────────────────────────────────────────────────────────────────
  { name: 'Job',             abbreviation: 'Job',  book_number: 18, testament: 'OT', section: 'Poetry', chapters: 42  },
  { name: 'Psalms',          abbreviation: 'Ps',   book_number: 19, testament: 'OT', section: 'Poetry', chapters: 150 },
  { name: 'Proverbs',        abbreviation: 'Prov', book_number: 20, testament: 'OT', section: 'Poetry', chapters: 31  },
  { name: 'Ecclesiastes',    abbreviation: 'Eccl', book_number: 21, testament: 'OT', section: 'Poetry', chapters: 12  },
  { name: 'Song of Solomon', abbreviation: 'Song', book_number: 22, testament: 'OT', section: 'Poetry', chapters:  8  },

  // ── Major Prophets ────────────────────────────────────────────────────────
  { name: 'Isaiah',      abbreviation: 'Isa',  book_number: 23, testament: 'OT', section: 'Major Prophets', chapters: 66 },
  { name: 'Jeremiah',    abbreviation: 'Jer',  book_number: 24, testament: 'OT', section: 'Major Prophets', chapters: 52 },
  { name: 'Lamentations',abbreviation: 'Lam',  book_number: 25, testament: 'OT', section: 'Major Prophets', chapters:  5 },
  { name: 'Ezekiel',     abbreviation: 'Ezek', book_number: 26, testament: 'OT', section: 'Major Prophets', chapters: 48 },
  { name: 'Daniel',      abbreviation: 'Dan',  book_number: 27, testament: 'OT', section: 'Major Prophets', chapters: 12 },

  // ── Minor Prophets ────────────────────────────────────────────────────────
  { name: 'Hosea',     abbreviation: 'Hos',   book_number: 28, testament: 'OT', section: 'Minor Prophets', chapters: 14 },
  { name: 'Joel',      abbreviation: 'Joel',  book_number: 29, testament: 'OT', section: 'Minor Prophets', chapters:  3 },
  { name: 'Amos',      abbreviation: 'Amos',  book_number: 30, testament: 'OT', section: 'Minor Prophets', chapters:  9 },
  { name: 'Obadiah',   abbreviation: 'Obad',  book_number: 31, testament: 'OT', section: 'Minor Prophets', chapters:  1 },
  { name: 'Jonah',     abbreviation: 'Jonah', book_number: 32, testament: 'OT', section: 'Minor Prophets', chapters:  4 },
  { name: 'Micah',     abbreviation: 'Mic',   book_number: 33, testament: 'OT', section: 'Minor Prophets', chapters:  7 },
  { name: 'Nahum',     abbreviation: 'Nah',   book_number: 34, testament: 'OT', section: 'Minor Prophets', chapters:  3 },
  { name: 'Habakkuk',  abbreviation: 'Hab',   book_number: 35, testament: 'OT', section: 'Minor Prophets', chapters:  3 },
  { name: 'Zephaniah', abbreviation: 'Zeph',  book_number: 36, testament: 'OT', section: 'Minor Prophets', chapters:  3 },
  { name: 'Haggai',    abbreviation: 'Hag',   book_number: 37, testament: 'OT', section: 'Minor Prophets', chapters:  2 },
  { name: 'Zechariah', abbreviation: 'Zech',  book_number: 38, testament: 'OT', section: 'Minor Prophets', chapters: 14 },
  { name: 'Malachi',   abbreviation: 'Mal',   book_number: 39, testament: 'OT', section: 'Minor Prophets', chapters:  4 },

  // ── Gospels ───────────────────────────────────────────────────────────────
  { name: 'Matthew', abbreviation: 'Matt', book_number: 40, testament: 'NT', section: 'Gospels', chapters: 28 },
  { name: 'Mark',    abbreviation: 'Mark', book_number: 41, testament: 'NT', section: 'Gospels', chapters: 16 },
  { name: 'Luke',    abbreviation: 'Luke', book_number: 42, testament: 'NT', section: 'Gospels', chapters: 24 },
  { name: 'John',    abbreviation: 'John', book_number: 43, testament: 'NT', section: 'Gospels', chapters: 21 },

  // ── Acts ──────────────────────────────────────────────────────────────────
  { name: 'Acts', abbreviation: 'Acts', book_number: 44, testament: 'NT', section: 'Acts', chapters: 28 },

  // ── Pauline Epistles ──────────────────────────────────────────────────────
  { name: 'Romans',          abbreviation: 'Rom',     book_number: 45, testament: 'NT', section: 'Pauline Epistles', chapters: 16 },
  { name: '1 Corinthians',   abbreviation: '1 Cor',   book_number: 46, testament: 'NT', section: 'Pauline Epistles', chapters: 16 },
  { name: '2 Corinthians',   abbreviation: '2 Cor',   book_number: 47, testament: 'NT', section: 'Pauline Epistles', chapters: 13 },
  { name: 'Galatians',       abbreviation: 'Gal',     book_number: 48, testament: 'NT', section: 'Pauline Epistles', chapters:  6 },
  { name: 'Ephesians',       abbreviation: 'Eph',     book_number: 49, testament: 'NT', section: 'Pauline Epistles', chapters:  6 },
  { name: 'Philippians',     abbreviation: 'Phil',    book_number: 50, testament: 'NT', section: 'Pauline Epistles', chapters:  4 },
  { name: 'Colossians',      abbreviation: 'Col',     book_number: 51, testament: 'NT', section: 'Pauline Epistles', chapters:  4 },
  { name: '1 Thessalonians', abbreviation: '1 Thess', book_number: 52, testament: 'NT', section: 'Pauline Epistles', chapters:  5 },
  { name: '2 Thessalonians', abbreviation: '2 Thess', book_number: 53, testament: 'NT', section: 'Pauline Epistles', chapters:  3 },
  { name: '1 Timothy',       abbreviation: '1 Tim',   book_number: 54, testament: 'NT', section: 'Pauline Epistles', chapters:  6 },
  { name: '2 Timothy',       abbreviation: '2 Tim',   book_number: 55, testament: 'NT', section: 'Pauline Epistles', chapters:  4 },
  { name: 'Titus',           abbreviation: 'Titus',   book_number: 56, testament: 'NT', section: 'Pauline Epistles', chapters:  3 },
  { name: 'Philemon',        abbreviation: 'Phlm',    book_number: 57, testament: 'NT', section: 'Pauline Epistles', chapters:  1 },

  // ── General Epistles ──────────────────────────────────────────────────────
  { name: 'Hebrews', abbreviation: 'Heb',    book_number: 58, testament: 'NT', section: 'General Epistles', chapters: 13 },
  { name: 'James',   abbreviation: 'Jas',    book_number: 59, testament: 'NT', section: 'General Epistles', chapters:  5 },
  { name: '1 Peter', abbreviation: '1 Pet',  book_number: 60, testament: 'NT', section: 'General Epistles', chapters:  5 },
  { name: '2 Peter', abbreviation: '2 Pet',  book_number: 61, testament: 'NT', section: 'General Epistles', chapters:  3 },
  { name: '1 John',  abbreviation: '1 John', book_number: 62, testament: 'NT', section: 'General Epistles', chapters:  5 },
  { name: '2 John',  abbreviation: '2 John', book_number: 63, testament: 'NT', section: 'General Epistles', chapters:  1 },
  { name: '3 John',  abbreviation: '3 John', book_number: 64, testament: 'NT', section: 'General Epistles', chapters:  1 },
  { name: 'Jude',    abbreviation: 'Jude',   book_number: 65, testament: 'NT', section: 'General Epistles', chapters:  1 },

  // ── Revelation ────────────────────────────────────────────────────────────
  { name: 'Revelation', abbreviation: 'Rev', book_number: 66, testament: 'NT', section: 'Revelation', chapters: 22 },
];

// ─── Section order ────────────────────────────────────────────────────────────

const OT_SECTIONS: string[] = ['Torah', 'History', 'Poetry', 'Major Prophets', 'Minor Prophets'];
const NT_SECTIONS: string[] = ['Gospels', 'Acts', 'Pauline Epistles', 'General Epistles', 'Revelation'];

// ─── Helper functions ─────────────────────────────────────────────────────────

export function getBooksByTestament(testament: 'OT' | 'NT'): BookMetadata[] {
  return BIBLE_BOOKS.filter((b) => b.testament === testament);
}

export function getBooksBySection(section: string): BookMetadata[] {
  return BIBLE_BOOKS.filter((b) => b.section === section);
}

export function getSectionsByTestament(testament: 'OT' | 'NT'): string[] {
  return testament === 'OT' ? OT_SECTIONS : NT_SECTIONS;
}

export function getBookByName(name: string): BookMetadata | undefined {
  return BIBLE_BOOKS.find((b) => b.name === name);
}

export function getTotalChapters(): number {
  return BIBLE_BOOKS.reduce((sum, b) => sum + b.chapters, 0);
}
