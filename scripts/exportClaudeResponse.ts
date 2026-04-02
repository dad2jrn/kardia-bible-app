import fs from 'fs';
import path from 'path';

import { initializeDatabase, getKardiaTranslation } from '../services/database';

interface Args {
  book: string;
  chapter: number;
  verse: number;
  translation: string;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part.startsWith('--')) {
      const key = part.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = value;
      i += 1;
    }
  }

  if (!args.book || !args.chapter || !args.verse) {
    throw new Error('Usage: ts-node scripts/exportClaudeResponse.ts --book "Genesis" --chapter 1 --verse 1 [--translation ESV]');
  }

  return {
    book: args.book,
    chapter: Number(args.chapter),
    verse: Number(args.verse),
    translation: args.translation ?? 'ESV',
  };
}

async function main() {
  const { book, chapter, verse, translation } = parseArgs(process.argv.slice(2));
  initializeDatabase();
  const record = getKardiaTranslation({
    sourceTranslationCode: translation,
    book,
    chapter,
    verse,
  });

  if (!record) {
    throw new Error('No translation found for the specified reference.');
  }

  if (!record.raw_response_json) {
    throw new Error('No raw Claude response stored for this verse. Generate it again to capture the payload.');
  }

  const safeBook = book.replace(/\s+/g, '-').toLowerCase();
  const outputPath = path.resolve(process.cwd(), `claude-response-${safeBook}-${chapter}-${verse}.json`);
  fs.writeFileSync(outputPath, record.raw_response_json, 'utf8');
  console.log(`Saved raw Claude response to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
