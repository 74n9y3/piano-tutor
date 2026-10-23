import { t } from "./i18n";

const LETTERS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const SOLFEGE = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Si"];

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function stableMidi(hz: number, clarity: number): number | null {
  if (clarity < 0.9 || hz < 50 || hz > 2000) return null;
  const exact = hzToMidi(hz);
  const midi = Math.round(exact);
  if (Math.abs(exact - midi) * 100 > 45) return null;
  return midi;
}

export function midiLabel(midi: number): string {
  const name = `${LETTERS[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return pitchLabel(name);
}

export function pitchLabel(name: string): string {
  const match = /^([A-G])([♯#♭b-]?)(-?\d+)$/.exec(name);
  if (!match) return name;
  const step = match[1];
  const accidental = match[2];
  const index = "CDEFGAB".indexOf(step);
  let solfege = SOLFEGE[index] ?? "";
  if (accidental === "♯" || accidental === "#") solfege += "♯";
  if (accidental === "♭" || accidental === "b" || accidental === "-") solfege += "♭";
  const middle = name === "C4" ? t("middleC") : "";
  return t("pitchZh", { name, solfege, middle });
}

export interface Jianpu {
  accidental: "" | "♯" | "♭";
  number: string;
  above: number;
  below: number;
}

const STEP_NUMBER = [1, 2, 3, 4, 5, 6, 7];

export function jianpuOf(name: string): Jianpu | null {
  const match = /^([A-G])([♯#♭b-]?)(-?\d+)$/.exec(name);
  if (!match) return null;
  const step = "CDEFGAB".indexOf(match[1]);
  if (step < 0) return null;
  let accidental: Jianpu["accidental"] = "";
  if (match[2] === "♯" || match[2] === "#") accidental = "♯";
  if (match[2] === "♭" || match[2] === "b" || match[2] === "-") accidental = "♭";
  const shift = Number(match[3]) - 4;
  return {
    accidental,
    number: String(STEP_NUMBER[step]),
    above: shift > 0 ? Math.min(3, shift) : 0,
    below: shift < 0 ? Math.min(3, -shift) : 0,
  };
}

export function midiName(midi: number): string {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const pitch = ((midi % 12) + 12) % 12;
  return `${names[pitch]}${Math.floor(midi / 12) - 1}`;
}
