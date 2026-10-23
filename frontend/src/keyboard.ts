import type { NoteHead } from "./types";
import { jianpuOf, midiName } from "./pitch";

export type KeyHand = "right" | "left" | "both";

const BLACK = new Set([1, 3, 6, 8, 10]);
const BLACK_WIDTH = 0.62;
const PIANO_LOW = 21;
const PIANO_HIGH = 108;
let keyObserver: ResizeObserver | null = null;

export function syncKeyboard(
  container: HTMLElement,
  notes: NoteHead[],
  active: Map<number, KeyHand>,
  onPlay: (midi: number) => void,
): void {
  const signature = `${PIANO_LOW}:${PIANO_HIGH}:${notes.map((note) => note.name).join(",")}`;
  const rebuilt = container.dataset.signature !== signature;
  if (rebuilt) {
    container.dataset.signature = signature;
    container.dataset.focus = "";
    container.replaceChildren(buildKeys(PIANO_LOW, PIANO_HIGH, notes, onPlay));
    const row = container.querySelector<HTMLElement>("#keys");
    if (row) watchKeys(row);
  }
  const row = container.querySelector<HTMLElement>("#keys");
  if (row) {
    requestAnimationFrame(() => {
      placeBlackKeys(row);
      const focus = [...active.keys()][0] ?? 60;
      const token = String(focus);
      if (rebuilt || container.dataset.focus !== token) {
        container.dataset.focus = token;
        revealKey(row, focus);
      }
    });
  }
  container.querySelectorAll<HTMLElement>(".key").forEach((key) => {
    const midi = Number(key.dataset.midi);
    const hand = active.get(midi);
    key.classList.toggle("is-on", hand === "right");
    key.classList.toggle("is-left", hand === "left");
    key.classList.toggle("is-both", hand === "both");
  });
}

function revealKey(row: HTMLElement, _midi: number): void {
  row.scrollLeft = 0;
}

function buildKeys(low: number, high: number, notes: NoteHead[], onPlay: (midi: number) => void): HTMLElement {
  const row = document.createElement("div");
  row.id = "keys";
  const whites: number[] = [];
  for (let midi = low; midi <= high; midi += 1) {
    if (!BLACK.has(((midi % 12) + 12) % 12)) whites.push(midi);
  }
  for (const midi of whites) row.append(keyButton(midi, "white", notes, onPlay));
  for (const midi of whites) {
    const black = midi + 1;
    if (black > high || !BLACK.has(black % 12)) continue;
    row.append(keyButton(black, "black", notes, onPlay));
  }
  requestAnimationFrame(() => placeBlackKeys(row));
  return row;
}

function watchKeys(row: HTMLElement): void {
  keyObserver?.disconnect();
  keyObserver = new ResizeObserver(() => placeBlackKeys(row));
  keyObserver.observe(row);
}

function placeBlackKeys(row: HTMLElement): void {
  const whites = Array.from(row.querySelectorAll<HTMLElement>(".key.white"));
  const gap = Number.parseFloat(getComputedStyle(row).columnGap || getComputedStyle(row).gap) || 0;
  row.querySelectorAll<HTMLElement>(".key.black").forEach((black) => {
    const white = whites.find((key) => Number(key.dataset.midi) === Number(black.dataset.midi) - 1);
    if (!white || white.offsetWidth < 1) return;
    const width = white.offsetWidth * BLACK_WIDTH;
    const boundary = white.offsetLeft + white.offsetWidth + gap / 2;
    black.style.width = `${width}px`;
    black.style.left = `${boundary - width / 2}px`;
  });
}

function keyButton(midi: number, kind: "white" | "black", notes: NoteHead[], onPlay: (midi: number) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `key ${kind}${midi === 60 ? " is-middle" : ""}`;
  button.dataset.midi = String(midi);
  const spelling = notes.find((note) => note.midi === midi)?.name ?? midiName(midi);
  const mark = jianpuOf(spelling);
  button.setAttribute("aria-label", spelling);
  if (mark) {
    const caption = document.createElement("span");
    caption.className = "key-name";
    if (mark.above) caption.append(keyDots(mark.above));
    const text = document.createElement("b");
    text.textContent = `${mark.accidental}${mark.number}`;
    caption.append(text);
    if (mark.below) caption.append(keyDots(mark.below));
    button.append(caption);
  }
  button.addEventListener("click", () => onPlay(midi));
  return button;
}

function keyDots(count: number): HTMLElement {
  const dots = document.createElement("span");
  dots.className = "key-dots";
  for (let index = 0; index < count; index += 1) dots.append(document.createElement("i"));
  return dots;
}
