export interface NoteHead {
  id: string;
  part: number;
  measure: number;
  offset: number;
  quarterLength: number;
  duration: string;
  midi: number;
  name: string;
  attack: boolean;
}

export interface ExplainFact {
  label: string;
  text: string;
}

export interface GlossaryItem {
  name: string;
  text: string;
}

export interface ScorePage {
  index: number;
  status: "waiting" | "recognizing" | "ready" | "failed" | string;
  error: string | null;
  measureStart: number | null;
  measureEnd: number | null;
}

export interface Piece {
  id: string;
  title: string;
  status: "ready" | "recognizing" | "failed" | "partial" | string;
  error: string | null;
  created: string;
  hasPhoto: boolean;
  source?: "score" | "improv" | string;
  pageCount?: number;
  pages?: ScorePage[];
  bpm?: number;
  notes?: NoteHead[];
  measureStart?: number;
  measureEnd?: number;
  explain?: { facts: ExplainFact[]; glossary: GlossaryItem[] };
}

export interface ReviewNote {
  id: string;
  status: "ok" | "wrong_pitch" | "missing" | "rhythm" | string;
  detail: string;
}

export interface TakeResult {
  notes: ReviewNote[];
  extras: { onset: number; midi: number; name: string }[];
  summary: {
    ok: number;
    wrong_pitch: number;
    missing: number;
    rhythm: number;
    extra: number;
  };
  heardBpm?: number;
}

export interface AskRecord {
  id: string;
  at: string;
  label: string;
  text: string;
  noteId: string | null;
  lang?: string;
}

export interface Take {
  id: string;
  status: "analyzing" | "ready" | "failed" | string;
  error: string | null;
  startMeasure: number;
  endMeasure: number;
  result: TakeResult | null;
}

export interface ScoreMark {
  kind: "clef" | "time" | "key" | "note" | "rest" | "dot" | "symbol";
  clef?: "treble" | "bass" | "alto" | "tenor";
  time?: string;
  sharps?: number;
  name?: string;
  duration?: string;
  dots?: number;
  quarters?: number;
  accidental?: "sharp" | "flat" | "natural" | "double-sharp" | "double-flat";
  symbols?: ScoreSymbol[];
  measure?: number;
  hand?: "right" | "left";
}

export interface ScoreSymbol {
  code: string;
  detail?: string;
}

export interface RegionResult {
  mode: "marks" | "model" | "glossary" | "vision" | "error";
  message?: string;
  text?: string;
  glossary: GlossaryItem[];
}
