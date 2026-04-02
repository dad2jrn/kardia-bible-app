export interface KeyTermDetails {
  term: string | null;
  notes: string | null;
}

export interface ParsedKardiaPayload {
  kardiaText: string;
  sourceText?: string | null;
  kardiaVersion?: string | null;
  keyTerm?: {
    term: string | null;
    hebrew?: string | null;
    notes?: string | null;
  } | null;
  hebrewWord?: string | null;
  hebrewCategory?: string | null;
  whyThisMatters?: string | null;
  extraNotes?: string[] | null;
}
