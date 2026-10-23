import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { jianpuOf } from "./pitch";
import type { NoteHead, ScoreMark, ScoreSymbol } from "./types";

interface DrawableNote {
  sourceNote: {
    isRest(): boolean;
    IsGraceNote: boolean;
    halfTone: number;
  };
  setColor(color: string, options: { applyToNoteheads?: boolean; applyToStem?: boolean }): void;
}

export interface MappedNote extends NoteHead {
  graphical: DrawableNote | null;
  element: SVGElement | null;
  dots: number;
  accidental?: ScoreMark["accidental"];
  symbols: ScoreSymbol[];
}

interface StoredSymbol {
  element: Element;
  aim: Element;
  mark: ScoreMark;
  extendRight: number;
  extendLeft: number;
  extendTop: number;
  extendBottom: number;
  pad: number;
  noteId?: string;
}

interface SeenNote {
  midi: number;
  raw: number;
  staff: number;
  graphical: DrawableNote;
  element: SVGElement | null;
}

const COLORS: Record<string, string> = {
  wrong_pitch: "#dc2626",
  missing: "#94a3b8",
  rhythm: "#9333ea",
  ink: "#1e293b",
};

function handColor(part: number): string {
  const name = part === 0 ? "--hand-right" : "--hand-left";
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || (part === 0 ? "#2563eb" : "#ea580c");
}

export class ScoreView {
  private osmd: OpenSheetMusicDisplay | null = null;
  private symbols: StoredSymbol[] = [];
  mapped: MappedNote[] = [];
  private jianpuOn = true;
  private heads: NoteHead[] = [];

  constructor(private container: HTMLElement) {}

  async load(xml: string, heads: NoteHead[], zoom: number): Promise<MappedNote[]> {
    this.container.replaceChildren();
    this.heads = heads;
    const osmd = new OpenSheetMusicDisplay(this.container, {
      backend: "svg",
      autoResize: false,
      drawTitle: true,
      drawComposer: false,
      drawPartNames: false,
      drawMeasureNumbers: true,
      drawFingerings: true,
      drawLyrics: false,
    });
    await osmd.load(xml);
    // load() resets zoom to 1. Set it again or the buttons appear to do nothing.
    osmd.Zoom = zoom;
    this.layoutScore(osmd);
    this.osmd = osmd;
    this.mapped = matchNotes(collect(osmd), heads);
    this.symbols = indexSymbols(osmd, this.container, this.mapped);
    this.drawJianpu();
    return this.mapped;
  }

  setJianpu(on: boolean): void {
    this.jianpuOn = on;
    const osmd = this.osmd;
    if (!osmd) return;
    this.layoutScore(osmd);
    this.mapped = matchNotes(collect(osmd), this.heads);
    this.symbols = indexSymbols(osmd, this.container, this.mapped);
    this.drawJianpu();
  }

  paint(current: Set<string>, review: Map<string, string>, selected: string | null): void {
    const hands = [handColor(0), handColor(1)];
    for (const note of this.mapped) {
      if (!note.graphical) continue;
      const status = review.get(note.id);
      const hand = hands[note.part === 0 ? 0 : 1];
      let color = COLORS.ink;
      if (status && COLORS[status]) color = COLORS[status];
      if (current.has(note.id)) color = hand;
      note.graphical.setColor(color, { applyToNoteheads: true, applyToStem: true });
      if (note.element) {
        note.element.style.filter = note.id === selected ? `drop-shadow(0 0 3px ${hand})` : "";
      }
    }
    this.container.querySelectorAll<HTMLElement>(".jianpu-label").forEach((label) => {
      const ids = (label.dataset.noteId ?? "").split(" ").filter(Boolean);
      label.classList.toggle("is-current", ids.some((id) => current.has(id) || id === selected));
    });
  }

  hit(clientX: number, clientY: number): string | null {
    let bestId: string | null = null;
    let bestDistance = 36;
    for (const note of this.mapped) {
      if (!note.element) continue;
      const head = note.element.getBoundingClientRect();
      const points: Array<[number, number]> = [
        [head.left + head.width / 2, head.top + head.height / 2],
        [head.right + (note.dots > 0 ? 18 : 8), head.top + head.height / 2],
      ];
      if (note.accidental) points.push([head.left - 16, head.top + head.height / 2]);
      if (note.symbols.length) {
        points.push([head.left + head.width / 2, head.top - 18]);
        points.push([head.left + head.width / 2, head.bottom + 16]);
      }
      for (const [x, y] of points) {
        const distance = Math.hypot(clientX - x, clientY - y);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestId = note.id;
        }
      }
    }
    return bestId;
  }

  matchedCount(): number {
    return this.mapped.filter((note) => note.element).length;
  }

  marksIn(box: { left: number; top: number; right: number; bottom: number }): ScoreMark[] {
    return attachWords(rankMarks(this.symbols.filter((symbol) => overlaps(symbol, box)).map((symbol) => symbol.mark)), this.wordsIn(box));
  }

  marksAt(x: number, y: number): { marks: ScoreMark[]; noteId: string | null } {
    let best: StoredSymbol | null = null;
    let bestDistance = 40;
    for (const symbol of this.symbols) {
      const distance = aimDistance(symbol, x, y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = symbol;
      }
    }
    const words = this.wordsAt(x, y);
    if (!best) {
      return words.length ? { marks: [{ kind: "symbol", symbols: words }], noteId: null } : { marks: [], noteId: null };
    }
    return { marks: attachWords([best.mark], words), noteId: best.noteId ?? null };
  }

  marksFor(noteId: string): ScoreMark[] {
    return rankMarks(this.symbols.filter((symbol) => symbol.noteId === noteId).map((symbol) => symbol.mark));
  }

  private wordsAt(x: number, y: number): ScoreSymbol[] {
    return this.wordsIn({ left: x - 28, top: y - 28, right: x + 28, bottom: y + 28 });
  }

  private wordsIn(box: { left: number; top: number; right: number; bottom: number }): ScoreSymbol[] {
    const found: ScoreSymbol[] = [];
    this.container.querySelectorAll("text").forEach((node) => {
      const text = node.textContent?.trim() ?? "";
      if (!text || text.length > 24) return;
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      if (rect.right < box.left || rect.left > box.right || rect.bottom < box.top || rect.top > box.bottom) return;
      found.push({ code: "word", detail: text });
    });
    return found.slice(0, 4);
  }

  private layoutScore(osmd: OpenSheetMusicDisplay): void {
    this.applyJianpuSpacing(osmd);
    osmd.updateGraphic();
    osmd.render();
  }

  private applyJianpuSpacing(osmd: OpenSheetMusicDisplay): void {
    const on = this.jianpuOn;
    const extra = on ? Math.max(0, chordDepth(this.heads) - 1) : 0;
    const targets = [osmd.EngravingRules];
    if (osmd.Sheet?.Rules && osmd.Sheet.Rules !== osmd.EngravingRules) targets.push(osmd.Sheet.Rules);
    for (const rules of targets) {
      // The two hands are separate parts, so the gap under the treble staff is StaffDistance.
      rules.BetweenStaffDistance = on ? 8 + extra * 2 : 5;
      rules.StaffDistance = on ? 12 + extra * 4 : 7;
      rules.MinSkyBottomDistBetweenStaves = on ? 3 + extra : 1;
      rules.MinSkyBottomDistBetweenSystems = on ? 9 + extra * 2 : 5;
      rules.MinimumDistanceBetweenSystems = on ? 11 + extra * 3 : 7;
    }
    this.container.style.paddingBottom = on ? `${2.4 + extra * 1.15}rem` : "";
  }

  private drawJianpu(): void {
    this.container.querySelectorAll(".jianpu-label").forEach((label) => label.remove());
    if (!this.jianpuOn) return;
    const origin = this.container.getBoundingClientRect();
    const rows = new Map<Element, { floor: number; notes: MappedNote[] }>();
    for (const note of this.mapped) {
      if (!note.element) continue;
      const staff = note.element.closest(".staffline");
      if (!staff) continue;
      let row = rows.get(staff);
      if (!row) {
        row = { floor: staffFloor(staff), notes: [] };
        rows.set(staff, row);
      }
      row.notes.push(note);
    }
    for (const row of rows.values()) {
      for (const column of groupChords(row.notes)) {
        const placed = column.filter((note) => note.element && jianpuOf(note.name));
        if (!placed.length) continue;
        const centers = placed.map((note) => {
          const head = note.element!.getBoundingClientRect();
          return head.left + head.width / 2;
        });
        const label = document.createElement("div");
        label.className = placed.length > 1 ? "jianpu-label jianpu-chord" : "jianpu-label";
        label.dataset.noteId = placed.map((note) => note.id).join(" ");
        label.dataset.hand = placed[0].part === 0 ? "right" : "left";
        label.style.left = `${centers.reduce((sum, value) => sum + value, 0) / centers.length - origin.left}px`;
        label.style.top = `${row.floor - origin.top + 8}px`;
        for (const note of placed) {
          const mark = jianpuOf(note.name);
          if (!mark) continue;
          const tone = document.createElement("span");
          tone.className = "jianpu-tone";
          tone.append(jianpuDots(mark.above), jianpuNumber(mark), jianpuDots(mark.below));
          label.append(tone);
        }
        this.container.append(label);
      }
    }
  }
}

function chordDepth(notes: NoteHead[]): number {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const key = `${note.part}:${note.measure}:${Math.round(note.offset * 1000)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(1, ...counts.values());
}

function groupChords(notes: MappedNote[]): MappedNote[][] {
  const groups = new Map<string, MappedNote[]>();
  for (const note of notes) {
    const key = `${note.measure}:${Math.round(note.offset * 1000)}`;
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => group.sort((left, right) => right.midi - left.midi));
}

function staffFloor(staff: Element): number {
  let floor = 0;
  staff.querySelectorAll(".vf-notehead, .vf-stem").forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) floor = Math.max(floor, rect.bottom);
  });
  staff.querySelectorAll("path").forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width > 80 && rect.height < 3) floor = Math.max(floor, rect.bottom);
  });
  return floor;
}

function jianpuDots(count: number): HTMLElement {
  const dots = document.createElement("span");
  dots.className = "jianpu-dots";
  for (let index = 0; index < count; index += 1) dots.append(document.createElement("i"));
  return dots;
}

function jianpuNumber(mark: { accidental: string; number: string }): HTMLElement {
  const number = document.createElement("span");
  number.className = "jianpu-num";
  if (mark.accidental) {
    const accidental = document.createElement("sup");
    accidental.textContent = mark.accidental;
    number.append(accidental);
  }
  number.append(mark.number);
  return number;
}

function attachWords(marks: ScoreMark[], words: ScoreSymbol[]): ScoreMark[] {
  if (!words.length) return marks;
  if (!marks.length) return [{ kind: "symbol", symbols: words }];
  const host = marks.find((mark) => mark.kind === "note" || mark.kind === "dot") ?? marks[0];
  const merged = [...(host.symbols ?? [])];
  for (const word of words) {
    if (!merged.some((item) => item.code === word.code && item.detail === word.detail)) merged.push(word);
  }
  host.symbols = merged.slice(0, 8);
  return marks;
}

function indexSymbols(
  osmd: OpenSheetMusicDisplay,
  container: HTMLElement,
  mapped: MappedNote[],
): StoredSymbol[] {
  const symbols: StoredSymbol[] = [];
  const svgGroups = new Map<string, Element[]>();
  container.querySelectorAll(".vf-measure").forEach((node) => {
    const list = svgGroups.get(node.id) ?? [];
    list.push(node);
    svgGroups.set(node.id, list);
  });
  for (const nodes of svgGroups.values()) {
    nodes.sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
  }
  const graphicGroups = new Map<number, Array<{ measure: GraphicMeasure; staff: number }>>();
  for (const staves of osmd.GraphicSheet.MeasureList ?? []) {
    staves?.forEach((measure, staff) => {
      if (!measure || measure.MeasureNumber < 1) return;
      const list = graphicGroups.get(measure.MeasureNumber) ?? [];
      list.push({ measure: measure as unknown as GraphicMeasure, staff });
      graphicGroups.set(measure.MeasureNumber, list);
    });
  }
  for (const [number, entries] of graphicGroups) {
    const nodes = svgGroups.get(String(number)) ?? [];
    entries.forEach((entry, index) => {
      const node = nodes[index];
      if (!node) return;
      const clef = node.querySelector(".vf-clef");
      const clefMark = clef ? clefOf(entry) : null;
      if (clef && clefMark) symbols.push(symbolOf(clef, clefMark));
      const time = node.querySelector(".vf-timesignature");
      const timeMark = time ? timeOf(entry) : null;
      if (time && timeMark) symbols.push(symbolOf(time, timeMark));
      const key = node.querySelector(".vf-keysignature");
      const keyMark = key ? keyOf(entry) : null;
      if (key && keyMark) symbols.push(symbolOf(key, keyMark));
    });
  }
  for (const note of mapped) {
    if (!note.element) continue;
    const dots = note.dots;
    const written = dots > 0 ? writtenDuration(note.quarterLength, dots) : note.duration;
    symbols.push({
      element: note.element.closest(".vf-stavenote") ?? note.element,
      aim: note.element,
      mark: {
        kind: dots > 0 ? "dot" : "note",
        name: note.name,
        duration: written === "other" ? note.duration : written,
        dots: dots > 0 ? dots : undefined,
        quarters: note.quarterLength,
        accidental: note.accidental,
        symbols: note.symbols,
        measure: note.measure,
        hand: note.part === 0 ? "right" : "left",
      },
      extendRight: dots > 0 ? 28 : 10,
      extendLeft: note.accidental ? 28 : 0,
      extendTop: note.symbols.length ? 22 : 0,
      extendBottom: note.symbols.length ? 22 : 0,
      pad: 12,
      noteId: note.id,
    });
  }
  for (const staves of osmd.GraphicSheet.MeasureList ?? []) {
    staves?.forEach((measure, staff) => {
      if (!measure || measure.MeasureNumber < 1) return;
      for (const entry of measure.staffEntries) {
        for (const voice of entry.graphicalVoiceEntries) {
          for (const graphical of voice.notes) {
            const source = graphical.sourceNote;
            if (!source?.isRest() || source.IsGraceNote) continue;
            const element = svgOf(graphical as DrawableNote);
            if (!element) continue;
            const restElement = element.closest(".vf-stavenote") ?? element;
            symbols.push(symbolOf(restElement, {
              kind: "rest",
              duration: durationKind(source.Length?.RealValue ?? 0),
              measure: measure.MeasureNumber,
              hand: staff === 0 ? "right" : "left",
            }));
          }
        }
      }
    });
  }
  return symbols;
}

interface GraphicMeasure {
  MeasureNumber: number;
  InitiallyActiveClef?: { ClefType: number; Line: number };
  parentSourceMeasure?: {
    RhythmPrinted?: { numerator?: number; denominator?: number };
    getKeyInstruction?: (staff: number) => { Key: number } | null;
  };
}

function clefOf(entry: { measure: GraphicMeasure; staff: number }): ScoreMark | null {
  const type = entry.measure.InitiallyActiveClef?.ClefType;
  const line = entry.measure.InitiallyActiveClef?.Line ?? 0;
  const hand = entry.staff === 0 ? "right" : "left";
  const measure = entry.measure.MeasureNumber;
  if (type === 0) return { kind: "clef", clef: "treble", hand, measure };
  if (type === 1) return { kind: "clef", clef: "bass", hand, measure };
  if (type === 2) return { kind: "clef", clef: line >= 4 ? "tenor" : "alto", hand, measure };
  return null;
}

function timeOf(entry: { measure: GraphicMeasure; staff: number }): ScoreMark | null {
  const printed = entry.measure.parentSourceMeasure?.RhythmPrinted;
  const numerator = printed?.numerator;
  const denominator = printed?.denominator;
  if (!numerator || !denominator) return null;
  return { kind: "time", time: `${numerator}/${denominator}`, measure: entry.measure.MeasureNumber };
}

function keyOf(entry: { measure: GraphicMeasure; staff: number }): ScoreMark | null {
  const sharps = entry.measure.parentSourceMeasure?.getKeyInstruction?.(entry.staff)?.Key;
  if (typeof sharps !== "number") return null;
  return { kind: "key", sharps, measure: entry.measure.MeasureNumber, hand: entry.staff === 0 ? "right" : "left" };
}

function symbolOf(element: Element, mark: ScoreMark): StoredSymbol {
  return { element, aim: element, mark, extendRight: 0, extendLeft: 0, extendTop: 0, extendBottom: 0, pad: 10 };
}

function overlaps(symbol: StoredSymbol, box: { left: number; top: number; right: number; bottom: number }): boolean {
  const rect = symbol.element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const left = rect.left - symbol.pad - symbol.extendLeft;
  const top = rect.top - symbol.pad - symbol.extendTop;
  const right = rect.right + symbol.pad + symbol.extendRight;
  const bottom = rect.bottom + symbol.pad + symbol.extendBottom;
  return right >= box.left && left <= box.right && bottom >= box.top && top <= box.bottom;
}

function aimDistance(symbol: StoredSymbol, x: number, y: number): number {
  const head = symbol.aim.getBoundingClientRect();
  if (head.width < 1 || head.height < 1) return Number.POSITIVE_INFINITY;
  const points: Array<[number, number]> = [[head.left + head.width / 2, head.top + head.height / 2]];
  if (symbol.mark.dots) points.push([head.right + 18, head.top + head.height / 2]);
  if (symbol.mark.accidental) points.push([head.left - 16, head.top + head.height / 2]);
  if (symbol.mark.symbols?.length) {
    points.push([head.left + head.width / 2, head.top - 18]);
    points.push([head.left + head.width / 2, head.bottom + 16]);
  }
  return Math.min(...points.map(([aimX, aimY]) => Math.hypot(x - aimX, y - aimY)));
}

function rankMarks(marks: ScoreMark[]): ScoreMark[] {
  const found: ScoreMark[] = [];
  const seen = new Set<string>();
  for (const mark of marks) {
    const key = JSON.stringify(mark);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(mark);
  }
  const rank: Record<ScoreMark["kind"], number> = { clef: 0, key: 1, time: 2, rest: 3, symbol: 4, dot: 5, note: 6 };
  found.sort((left, right) => rank[left.kind] - rank[right.kind] || (left.measure ?? 0) - (right.measure ?? 0));
  return found;
}

export function symbolCaption(note: MappedNote): string {
  return note.symbols
    .map((item) => {
      if (item.code === "staccato" && item.detail === "below") return "下面这个小圆点是跳音。这个音不要按满，点一下就松开。";
      if (item.code === "staccato") return "这个小圆点是跳音。这个音不要按满，点一下就松开。";
      return SYMBOL_CAPTION[item.code] ?? "";
    })
    .filter((line, index, all) => line && all.indexOf(line) === index)
    .join("");
}

const SYMBOL_CAPTION: Record<string, string> = {
  staccatissimo: "这个小楔子是顿音。比跳音更短，点一下马上松开。",
  accent: "这个尖角是重音。这个音要比旁边的音更突出一点。",
  strongaccent: "这个尖角是很重的音。这个音要明显重一些。",
  tenuto: "这条短横线是保持音。这个音要按满，不要弹短。",
  fermata: "这个弧线和点是延长记号。这个音可以停久一点再走。",
  tie: "连着同一个音的弧线是延音线。按住不要弹第二次。",
  slur: "这条弧线是连线。连着的音要连着弹，中间不要断开。",
  trill: "tr 是颤音。这个音和上面的音快速交替。",
  turn: "这个弯钩是回音。上面、本身、下面、再回到本身。",
  mordent: "这个波纹是波音。很快碰一下旁边的音再回来。",
  fingering: "旁边的小数字是指法。1 是大拇指，5 是小指。",
};

export function accidentalCaption(note: MappedNote): string {
  if (note.accidental === "sharp") return "左边那个像小格子的是升号。这个音改弹右边紧挨着的琴键，常常是黑键。";
  if (note.accidental === "flat") return "左边那个像小写 b 的是降号。这个音改弹左边紧挨着的琴键，常常是黑键。";
  if (note.accidental === "natural") return "左边那个像小方框的是还原号。这个音回到白键，不再升高，也不再降低。";
  if (note.accidental === "double-sharp") return "左边的记号是重升号。这个音要再高一些，弹右边第二个键。";
  if (note.accidental === "double-flat") return "左边的记号是重降号。这个音要再低一些，弹左边第二个键。";
  return "";
}

export function dotCaption(note: MappedNote): string {
  if (note.dots < 1) return "";
  const written = writtenDuration(note.quarterLength, note.dots);
  const hold: Record<string, string> = {
    "quarter:1": "本来唱 1 拍，加上这个点一共唱 1 拍半",
    "half:1": "本来唱 2 拍，加上这个点一共唱 3 拍",
    "whole:1": "本来唱 4 拍，加上这个点一共唱 6 拍",
    "eighth:1": "本来唱半拍，加上这个点一共唱 3/4 拍",
    "quarter:2": "两个点，一共唱 1 又 3/4 拍",
  };
  const text = hold[`${written}:${note.dots}`] ?? "这个音再延长自己的一半";
  const contrast = note.symbols.some((item) => item.code === "staccato") ? "" : "，不是跳音";
  return `右边的小点是附点${contrast}。${text}。按住不要太早松开。`;
}

function collectSymbols(graphical: DrawableNote | null): ScoreSymbol[] {
  if (!graphical) return [];
  const raw = graphical as DrawableNote & {
    parentVoiceEntry?: { parentVoiceEntry?: SourceVoice };
    sourceNote?: { NoteTie?: unknown; NoteSlurs?: unknown[] };
  };
  const voice = raw.parentVoiceEntry?.parentVoiceEntry;
  const symbols: ScoreSymbol[] = [];
  for (const art of voice?.Articulations ?? []) {
    const code = ARTICULATION_CODE[art.articulationEnum ?? -1];
    if (!code || code === "otherarticulation") continue;
    const detail = art.placement !== undefined && art.placement <= 3 ? PLACEMENT[art.placement] : undefined;
    symbols.push({ code, detail });
  }
  for (const tech of voice?.TechnicalInstructions ?? []) {
    if (tech.type === 0 && tech.value) symbols.push({ code: "fingering", detail: tech.value.slice(0, 8) });
  }
  const ornament = voice?.OrnamentContainer?.GetOrnament;
  if (typeof ornament === "number" && ORNAMENT_CODE[ornament]) symbols.push({ code: ORNAMENT_CODE[ornament] });
  if (raw.sourceNote?.NoteTie) symbols.push({ code: "tie" });
  if ((raw.sourceNote?.NoteSlurs?.length ?? 0) > 0) symbols.push({ code: "slur" });
  return symbols.slice(0, 6);
}

const ARTICULATION_CODE = [
  "accent",
  "strongaccent",
  "softaccent",
  "marcatoup",
  "marcatodown",
  "invertedstrongaccent",
  "staccato",
  "staccatissimo",
  "spiccato",
  "tenuto",
  "fermata",
  "invertedfermata",
  "breathmark",
  "caesura",
  "lefthandpizzicato",
  "naturalharmonic",
  "snappizzicato",
  "upbow",
  "downbow",
  "scoop",
  "plop",
  "doit",
  "falloff",
  "stress",
  "unstress",
  "detachedlegato",
  "otherarticulation",
  "bend",
];
const ORNAMENT_CODE = ["trill", "turn", "invertedturn", "delayedturn", "delayedinvertedturn", "mordent", "invertedmordent"];
const PLACEMENT = ["above", "below", "left", "right"];

interface SourceVoice {
  Articulations?: Array<{ articulationEnum?: number; placement?: number }>;
  TechnicalInstructions?: Array<{ type?: number; value?: string }>;
  OrnamentContainer?: { GetOrnament?: number };
}

function drawnAccidental(graphical: DrawableNote | null): ScoreMark["accidental"] {
  if (!graphical) return undefined;
  const value = (graphical as DrawableNote & { DrawnAccidental?: number }).DrawnAccidental;
  if (value === 0) return "sharp";
  if (value === 1) return "flat";
  if (value === 3) return "natural";
  if (value === 4) return "double-sharp";
  if (value === 5) return "double-flat";
  return undefined;
}

function dotCount(graphical: DrawableNote | null): number {
  if (!graphical) return 0;
  const raw = graphical as DrawableNote & { numberOfDots?: number; sourceNote: { DotsXml?: number } };
  const count = raw.numberOfDots || raw.sourceNote?.DotsXml || 0;
  if (!Number.isFinite(count) || count < 1) return 0;
  return Math.min(3, Math.round(count));
}

function writtenDuration(quarterLength: number, dots: number): string {
  const factor = dots === 1 ? 1.5 : dots === 2 ? 1.75 : dots === 3 ? 1.875 : 1;
  return durationKind(quarterLength / factor / 4);
}

function durationKind(wholeNotes: number): string {
  const quarters = wholeNotes * 4;
  if (Math.abs(quarters - 4) < 0.08) return "whole";
  if (Math.abs(quarters - 2) < 0.08) return "half";
  if (Math.abs(quarters - 1) < 0.08) return "quarter";
  if (Math.abs(quarters - 0.5) < 0.08) return "eighth";
  return "other";
}

function collect(osmd: OpenSheetMusicDisplay): SeenNote[] {
  const seen: SeenNote[] = [];
  for (const staves of osmd.GraphicSheet.MeasureList) {
    if (!staves) continue;
    staves.forEach((measure, staff) => {
      if (!measure) return;
      for (const entry of measure.staffEntries) {
        const raw = entry.sourceStaffEntry?.AbsoluteTimestamp?.RealValue ?? entry.relInMeasureTimestamp?.RealValue ?? 0;
        for (const voice of entry.graphicalVoiceEntries) {
          for (const graphical of voice.notes) {
            const source = graphical.sourceNote;
            if (!source || source.isRest() || source.IsGraceNote) continue;
            const element = svgOf(graphical);
            // OSMD counts middle C as 48. MIDI, and the soundfont, count it as 60.
            seen.push({ midi: source.halfTone + 12, raw, staff, graphical, element });
          }
        }
      }
    });
  }
  return seen;
}

function svgOf(graphical: DrawableNote): SVGElement | null {
  const candidate = graphical as DrawableNote & {
    getNoteheadSVGs?: () => HTMLElement[];
    getSVGGElement?: () => SVGElement | undefined;
  };
  const notehead = candidate.getNoteheadSVGs?.()[0];
  if (notehead) return notehead as unknown as SVGElement;
  if (typeof candidate.getSVGGElement === "function") return candidate.getSVGGElement() ?? null;
  return null;
}

function matchNotes(seen: SeenNote[], heads: NoteHead[]): MappedNote[] {
  let best: MappedNote[] = heads.map((head) => ({ ...head, graphical: null, element: null, dots: 0, symbols: [] }));
  let bestHits = -1;
  for (const scale of [4, 1]) {
    for (const useStaff of [true, false]) {
      const mapped = assign(seen, heads, scale, useStaff);
      const hits = mapped.filter((note) => note.element).length;
      if (hits > bestHits) {
        best = mapped;
        bestHits = hits;
      }
    }
  }
  return best;
}

function assign(seen: SeenNote[], heads: NoteHead[], scale: number, useStaff: boolean): MappedNote[] {
  const used = new Set<number>();
  return heads.map((head) => {
    let choice = -1;
    let distance = 0.26;
    seen.forEach((note, index) => {
      if (used.has(index) || note.midi !== head.midi) return;
      if (useStaff && note.staff !== head.part) return;
      const gap = Math.abs(note.raw * scale - head.offset);
      if (gap < distance) {
        distance = gap;
        choice = index;
      }
    });
    if (choice < 0) return { ...head, graphical: null, element: null, dots: 0, symbols: [] };
    used.add(choice);
    const graphical = seen[choice].graphical;
    return {
      ...head,
      graphical,
      element: seen[choice].element,
      dots: dotCount(graphical),
      accidental: drawnAccidental(graphical),
      symbols: collectSymbols(graphical),
    };
  });
}
