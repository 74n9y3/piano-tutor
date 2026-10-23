import { api, sleep } from "./api";
import { bootLocale, dictionaries, onLocale, setLocale, t, type MessageKey } from "./i18n";
import { ensureIcon, setButtonFace, type IconName } from "./icons";
import { loadPiano, PitchListener, Player, TakeRecorder, playMidi } from "./audio";
import { decideFollow, decideFollowNote, initialListen, type ListenState } from "./follow";
import { syncKeyboard, type KeyHand } from "./keyboard";
import { midiLabel, midiName, pitchLabel } from "./pitch";
import { accidentalCaption, dotCaption, symbolCaption, ScoreView } from "./score";
import type { AskRecord, NoteHead, Piece, ScoreMark, TakeResult } from "./types";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const welcome = el("welcome");
const workspace = el("workspace");
const status = el("status");
const pieceList = el("pieceList");
const scoreRoot = el("score");
const scoreView = new ScoreView(scoreRoot);
const listener = new PitchListener();
const recorder = new TakeRecorder();

let piece: Piece | null = null;
let photoPage = 1;
let photoFollowId: string | null = null;
let pageDraft: Array<{ id: string; file: File; url: string }> = [];
let replacePageIndex = 0;
let catalog: Piece[] = [];
let libraryQuery = "";
let libraryFilter = "all";
let renamingId: string | null = null;
let pendingDelete: string | null = null;
let listTimer = 0;
let xml = "";
let zoom = 1;
let selectedId: string | null = null;
let player: Player | null = null;
let review = new Map<string, string>();
let reviewText = new Map<string, string>();
let current = new Set<string>();
let followList: NoteHead[] = [];
let followIndex = 0;
let listen: ListenState = initialListen();
let following = false;
let keyboardOctave = 4;
let micIgnoreUntil = 0;
const MIC_IGNORE_MS = 1800;
const COMPUTER_STEPS: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
};
let recording = false;
let recordStarted = 0;
let recordClock = 0;
let improvising = false;
let improvSession = 0;
let improvStarted = 0;
let improvClock = 0;
let asking = false;
let ignoreTitleBlur = false;
let asks: AskRecord[] = [];
let bubbleText = "";
let bubbleNoteId: string | null = null;
let bubbleAnchor: { left: number; top: number; width: number; height: number } | null = null;
let openAskId: string | null = null;
let ignoreScoreClick = false;
let drag: { x: number; y: number; left: number; top: number } | null = null;

function durationChoices(): Array<[string, string]> {
  return [
    ["whole", t("whole")],
    ["half", t("half")],
    ["quarter", t("quarter")],
    ["eighth", t("eighth")],
  ];
}

type StatusParams = Record<string, string | number>;

let statusKey: MessageKey | null = null;
let statusParams: StatusParams | undefined;

function statusKeyFor(message: string): MessageKey | null {
  const books = dictionaries();
  for (const key of Object.keys(books["zh-CN"]) as MessageKey[]) {
    if (books["zh-CN"][key] === message || books.en[key] === message) return key;
  }
  return null;
}

function setStatus(message: string): void {
  statusKey = statusKeyFor(message);
  statusParams = undefined;
  status.textContent = message;
}

function setStatusKey(key: MessageKey, params?: StatusParams): void {
  statusKey = key;
  statusParams = params;
  status.textContent = t(key, params);
}

function refreshStatus(): void {
  if (statusKey) {
    status.textContent = t(statusKey, statusParams);
    return;
  }
  if (!welcome.hidden) setStatusKey("tagline");
}

function showRead(open: boolean): void {
  el("readSheet").hidden = !open;
  el("readToggle").setAttribute("aria-pressed", String(open));
}

function syncPhotoToggle(): void {
  const button = el<HTMLButtonElement>("photoToggle");
  const open = Boolean(piece?.hasPhoto) && !el("stage").classList.contains("photo-collapsed");
  el("photoToggleItem").hidden = !piece?.hasPhoto;
  setButtonFace(button, open ? "eye" : "photo", open ? t("hidePhoto") : t("showPhoto"));
  button.setAttribute("aria-pressed", String(open));
}

function syncRangeLabel(): void {
  const { start, end } = range();
  el("rangeLabel").textContent = start === end ? t("measureOne", { n: start }) : t("measureRange", { start, end });
}

function resetDeleteConfirm(): void {
  el("deleteItem").hidden = false;
  el("deleteConfirm").hidden = true;
}

function notes(): NoteHead[] {
  return piece?.notes ?? [];
}

function range(): { start: number; end: number } {
  const start = Number(el<HTMLInputElement>("fromMeasure").value) || 1;
  const end = Number(el<HTMLInputElement>("toMeasure").value) || start;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function notesInRange(): NoteHead[] {
  const { start, end } = range();
  return notes().filter((note) => note.measure >= start && note.measure <= end);
}

function paint(): void {
  scoreView.paint(current, review, selectedId);
  syncPhotoPage();
  if (!el("keyboard").hidden) {
    syncKeyboard(el("keysHost"), notes(), activeKeys(), onScreenKey);
  }
  repositionBubble();
}

function activeKeys(): Map<number, KeyHand> {
  const active = new Map<number, KeyHand>();
  const press = (id: string): void => {
    const note = notes().find((item) => item.id === id);
    if (!note) return;
    const hand: KeyHand = note.part === 0 ? "right" : "left";
    const before = active.get(note.midi);
    active.set(note.midi, before && before !== hand ? "both" : hand);
  };
  for (const id of current) press(id);
  if (selectedId) press(selectedId);
  return active;
}

function stopPlayback(): void {
  player?.stop();
  current = new Set();
  const playButton = el<HTMLButtonElement>("play");
  setButtonFace(playButton, "play", t("play"));
  playButton.setAttribute("aria-label", t("play"));
  playButton.classList.remove("is-live");
}

async function stopFollow(): Promise<void> {
  following = false;
  micIgnoreUntil = 0;
  listener.stop();
  el("followBanner").hidden = true;
  const follow = el<HTMLButtonElement>("follow");
  setButtonFace(follow, "note", t("follow"));
  follow.setAttribute("aria-label", t("follow"));
  follow.classList.remove("is-live");
}

function stopRecordClock(): void {
  window.clearInterval(recordClock);
  const record = el<HTMLButtonElement>("record");
  setButtonFace(record, "mic", t("record"));
  record.setAttribute("aria-label", t("record"));
  record.classList.remove("is-live");
}

function setAskMode(on: boolean): void {
  asking = on;
  drag = null;
  el("scoreBox").hidden = true;
  el("askHint").hidden = !on;
  el("scoreSheet").classList.toggle("asking", on);
  const button = el<HTMLButtonElement>("askMark");
  setButtonFace(button, on ? "x" : "viewfinder", on ? t("cancelCircle") : t("circle"));
  button.setAttribute("aria-pressed", String(on));
  if (on) setStatus(t("circleHint"));
}

async function stopActivities(): Promise<void> {
  setAskMode(false);
  stopPlayback();
  await stopFollow();
  if (recording) {
    recording = false;
    recorder.stop();
    stopRecordClock();
  }
}

let catalogKey = "";

async function refreshList(): Promise<void> {
  if (renamingId || pendingDelete) return;
  const next = await api.pieces();
  const key = JSON.stringify(next);
  catalog = next;
  if (key !== catalogKey) {
    catalogKey = key;
    renderCatalog();
  }
  watchList();
}

function watchList(): void {
  window.clearInterval(listTimer);
  if (welcome.hidden || !catalog.some((item) => item.status === "recognizing")) return;
  listTimer = window.setInterval(() => void refreshList(), 2000);
}

function pieceKind(item: Piece): string {
  if (item.hasPhoto) return t("kindPhoto");
  if (item.source === "midi") return "MIDI";
  if (item.source === "improv") return t("kindImprov");
  return t("kindScore");
}

function pieceKindKey(item: Piece): string {
  if (item.hasPhoto) return "photo";
  if (item.source === "midi") return "midi";
  if (item.source === "improv") return "improv";
  return "score";
}

function pieceWhen(created: string): string {
  const date = new Date(created);
  if (Number.isNaN(date.getTime())) return "";
  return t("date", { month: date.getMonth() + 1, day: date.getDate() });
}

function pageCountLabel(item: Piece): string {
  return (item.pageCount ?? 0) > 1 ? t("pagesCount", { count: item.pageCount ?? 0 }) : "";
}

function pieceState(item: Piece): string {
  const busy = item.status === "recognizing" || (item.pages ?? []).some((page) => page.status === "waiting" || page.status === "recognizing");
  if (busy) {
    if ((item.pageCount ?? 0) > 1) {
      const done = (item.pages ?? []).filter((page) => page.status === "ready" || page.status === "failed").length;
      return t("recognizingPages", { done, total: item.pageCount ?? 0 });
    }
    return item.source === "improv" ? t("writingScore") : t("readingScore");
  }
  if (item.status === "partial") return t("partial");
  if (item.status === "failed") return t("failed");
  return "";
}

function recognizeStatus(item: Piece): void {
  const total = item.pageCount ?? 0;
  if (total > 1) {
    const done = (item.pages ?? []).filter((page) => page.status === "ready" || page.status === "failed").length;
    const currentPage = Math.min(total, done + 1);
    setStatusKey("readingPage", { page: currentPage, total });
    return;
  }
  setStatusKey(item.source === "improv" ? "writingLong" : "readingLong");
}

function visiblePieces(): Piece[] {
  const query = libraryQuery.trim().toLowerCase();
  return catalog.filter((item) => {
    if (libraryFilter !== "all" && pieceKindKey(item) !== libraryFilter) return false;
    return !query || item.title.toLowerCase().includes(query);
  });
}

function renderCatalog(): void {
  const shown = visiblePieces();
  const count = el("libraryCount");
  count.textContent = catalog.length ? t("pieceCount", { count: shown.length }) : "";
  pieceList.replaceChildren();
  if (!catalog.length) {
    const empty = document.createElement("p");
    empty.className = "hint catalog-empty";
    empty.textContent = t("emptyLibrary");
    pieceList.append(empty);
    return;
  }
  if (!shown.length) {
    const empty = document.createElement("p");
    empty.className = "hint catalog-empty";
    empty.textContent = t("noMatches");
    pieceList.append(empty);
    return;
  }
  for (const item of shown) {
    pieceList.append(catalogRow(item));
  }
  if (renamingId) pieceList.querySelector<HTMLInputElement>(".catalog-rename")?.focus();
}

function catalogRow(item: Piece): HTMLElement {
  const row = document.createElement("article");
  row.className = "catalog-row";
  row.dataset.id = item.id;
  const main = document.createElement("div");
  main.className = "catalog-main";
  let input: HTMLInputElement | null = null;
  if (renamingId === item.id) {
    input = document.createElement("input");
    input.className = "input input-bordered input-sm catalog-rename";
    input.value = item.title;
    input.maxLength = 40;
    input.setAttribute("aria-label", t("pieceTitle"));
    const field = input;
    let cancel = false;
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        cancel = true;
        void commitLibraryRename(item.id, field.value);
      } else if (event.key === "Escape") {
        cancel = true;
        renamingId = null;
        renderCatalog();
      }
    });
    field.addEventListener("blur", () => {
      if (cancel || renamingId !== item.id) return;
      void commitLibraryRename(item.id, field.value);
    });
    main.append(field);
  } else {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "catalog-open";
    const name = document.createElement("strong");
    name.textContent = item.title;
    const meta = document.createElement("span");
    meta.className = "catalog-meta";
    const state = pieceState(item);
    meta.textContent = [pieceKind(item), pageCountLabel(item), pieceWhen(item.created), state].filter(Boolean).join(" · ");
    open.append(name, meta);
    open.addEventListener("click", () => void openPiece(item.id));
    main.append(open);
  }
  const actions = document.createElement("div");
  actions.className = "catalog-actions";
  if (pendingDelete === item.id) {
    actions.append(
      actionButton(t("confirmDeleteButton"), "trash", "btn btn-error btn-xs", () => void removeFromLibrary(item.id)),
      actionButton(t("cancel"), "x", "btn btn-ghost btn-xs", () => {
        pendingDelete = null;
        renderCatalog();
      }),
    );
  } else if (renamingId === item.id) {
    const save = actionButton(t("save"), "check", "btn btn-primary btn-xs", () => {
      if (input) void commitLibraryRename(item.id, input.value);
    });
    const cancelEdit = actionButton(t("cancel"), "x", "btn btn-ghost btn-xs", () => {
      renamingId = null;
      renderCatalog();
    });
    save.addEventListener("mousedown", (event) => event.preventDefault());
    cancelEdit.addEventListener("mousedown", (event) => event.preventDefault());
    actions.append(save, cancelEdit);
  } else {
    actions.append(rowMenu(item));
  }
  row.append(main, actions);
  return row;
}

function actionButton(text: string, name: IconName, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  setButtonFace(button, name, text);
  button.addEventListener("click", onClick);
  return button;
}

function menuButton(text: string, name: IconName, className: string, onClick: () => void): HTMLLIElement {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  if (className) button.className = className;
  setButtonFace(button, name, text);
  button.addEventListener("click", onClick);
  item.append(button);
  return item;
}

function rowMenu(item: Piece): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dropdown dropdown-end";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "btn btn-ghost btn-sm btn-square";
  trigger.setAttribute("aria-label", t("moreOf", { title: item.title }));
  trigger.title = t("more");
  setButtonFace(trigger, "ellipsis");
  const menu = document.createElement("ul");
  menu.tabIndex = 0;
  menu.className = "dropdown-content menu more-menu";
  const rule = document.createElement("li");
  rule.className = "menu-rule";
  rule.setAttribute("aria-hidden", "true");
  menu.append(
    menuButton(t("export"), "download", "", () => void exportScore(item.id, item.title)),
    menuButton(t("openFolder"), "folder", "", () => void revealFolder(item.id)),
    menuButton(t("rename"), "pencil", "", () => {
      pendingDelete = null;
      renamingId = item.id;
      renderCatalog();
    }),
    rule,
    menuButton(t("delete"), "trash", "text-error", () => {
      renamingId = null;
      pendingDelete = item.id;
      renderCatalog();
    }),
  );
  wrap.append(trigger, menu);
  return wrap;
}

function scoreFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || t("fallbackTitle");
  return `${cleaned}.musicxml`;
}

async function exportScore(id: string, title: string): Promise<void> {
  try {
    const xml = await api.score(id);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = scoreFilename(title);
    link.click();
    URL.revokeObjectURL(url);
    setStatus(t("exported"));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("exportFailed"));
  }
}

async function revealFolder(id: string): Promise<void> {
  try {
    await api.reveal(id);
    setStatus(t("folderOpened"));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("folderFailed"));
  }
}
async function commitLibraryRename(id: string, title: string): Promise<void> {
  const next = title.trim();
  if (renamingId === id) renamingId = null;
  if (!next) {
    renderCatalog();
    return;
  }
  try {
    await api.rename(id, next);
    if (piece?.id === id) piece = { ...piece, title: next };
    setStatus(t("renamed"));
    await refreshList();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("renameFailed"));
    renderCatalog();
  }
}

async function removeFromLibrary(id: string): Promise<void> {
  pendingDelete = null;
  try {
    await api.remove(id);
    if (piece?.id === id) piece = null;
    setStatus(t("removedFromLibrary"));
    await refreshList();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("removeFailed"));
  }
}

async function openPiece(id: string): Promise<void> {
  await stopActivities();
  window.clearInterval(listTimer);
  piece = await api.piece(id);
  welcome.hidden = true;
  workspace.hidden = false;
  el("keyboard").hidden = true;
  el("keysHost").dataset.signature = "";
  hideBubble();
  asks = [];
  renderAsks();
  review = new Map();
  selectedId = null;
  el("editor").hidden = true;
  el("reviewBar").hidden = true;
  showRead(false);
  renderPieceChrome();
  photoPage = 1;
  photoFollowId = null;
  if (piece.status === "recognizing" || (piece.pages ?? []).some((page) => page.status === "waiting" || page.status === "recognizing")) {
    recognizeStatus(piece);
    showPhoto();
    await pollPiece(id);
    return;
  }
  if (piece.status === "failed") {
    setStatus(piece.error || t("recognizeFailed"));
    showPhoto();
    return;
  }
  await showScore();
}

function renderPieceChrome(): void {
  if (!piece) return;
  el("pieceTitle").textContent = piece.title;
  const start = piece.measureStart ?? 1;
  const end = piece.measureEnd ?? start;
  el<HTMLInputElement>("fromMeasure").value = String(start);
  el<HTMLInputElement>("toMeasure").value = String(end);
  updateSpeedLabel();
  updateZoomLabel();
  syncRangeLabel();
  el("pageManageItem").hidden = !piece.hasPhoto;
  renderPageManager();
  renderExplain();
  renderSelection();
  renderReview();
}

function beginTitleEdit(): void {
  if (!piece || (piece.status !== "ready" && piece.status !== "partial")) return;
  const input = el<HTMLInputElement>("pieceTitleInput");
  el("pieceTitle").hidden = true;
  input.hidden = false;
  input.value = piece.title;
  input.focus();
  input.select();
  setStatus(t("titleHint"));
}

async function commitTitle(): Promise<void> {
  const input = el<HTMLInputElement>("pieceTitleInput");
  if (input.hidden || !piece) return;
  const next = input.value.trim().replace(/\s+/g, " ");
  input.hidden = true;
  el("pieceTitle").hidden = false;
  if (!next || next === piece.title) return;
  try {
    piece = await api.rename(piece.id, next);
    renderPieceChrome();
    await showScore();
    setStatus(t("titleSaved"));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("titleFailed"));
  }
}

function clickedScoreTitle(event: MouseEvent): boolean {
  if (!piece) return false;
  const node = event.target instanceof Element ? event.target.closest("text") : null;
  return (node?.textContent ?? "").trim() === piece.title;
}

function showPhoto(): void {
  const pane = el("photoPane");
  const stage = el("stage");
  if (!piece?.hasPhoto) {
    pane.hidden = true;
    stage.classList.remove("with-photo", "photo-collapsed");
    syncPhotoToggle();
    return;
  }
  pane.hidden = false;
  stage.classList.add("with-photo");
  showPhotoPage(photoPage);
  syncPhotoToggle();
}

function showPhotoPage(page: number): void {
  if (!piece?.hasPhoto) return;
  const total = Math.max(1, piece.pageCount || piece.pages?.length || 1);
  photoPage = Math.min(total, Math.max(1, page));
  el<HTMLImageElement>("photo").src = `/api/pieces/${piece.id}/photo?page=${photoPage}&t=${Date.now()}`;
  el("photoPageLabel").textContent = t("pageOf", { page: photoPage, total });
  el("photoPager").hidden = total < 2;
  el<HTMLButtonElement>("photoPrev").disabled = photoPage <= 1;
  el<HTMLButtonElement>("photoNext").disabled = photoPage >= total;
}

function pageForMeasure(measure: number): number | null {
  for (const page of piece?.pages ?? []) {
    if (page.measureStart == null || page.measureEnd == null) continue;
    if (measure >= page.measureStart && measure <= page.measureEnd) return page.index;
  }
  return null;
}

function syncPhotoPage(): void {
  const id = [...current][0] ?? selectedId;
  if (!id || id === photoFollowId) return;
  const note = notes().find((item) => item.id === id);
  if (!note) return;
  const page = pageForMeasure(note.measure);
  photoFollowId = id;
  if (page && page !== photoPage) showPhotoPage(page);
}

async function showScore(): Promise<void> {
  if (!piece || (piece.status !== "ready" && piece.status !== "partial")) return;
  showPhoto();
  el("keyboard").hidden = false;
  xml = await api.score(piece.id);
  await scoreView.load(xml, notes(), zoom);
  const matched = scoreView.matchedCount();
  if (notes().length && matched < notes().length) {
    setStatus(t("scoreOpenedRough"));
  } else {
    setStatus(t("scoreOpened"));
  }
  paint();
  renderExplain();
  renderSelection();
  await loadAsks();
}

async function pollPiece(id: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    await sleep(1500);
    if (piece?.id !== id) return;
    const latest = await api.piece(id);
    const busy = latest.status === "recognizing" || (latest.pages ?? []).some((page) => page.status === "waiting" || page.status === "recognizing");
    if (busy) {
      piece = latest;
      recognizeStatus(latest);
      renderPageManager();
      const active = (latest.pages ?? []).find((page) => page.status === "recognizing");
      if (active) showPhotoPage(active.index);
      continue;
    }
    piece = latest;
    renderPieceChrome();
    if (latest.status === "ready" || latest.status === "partial") {
      setStatus(
        latest.status === "partial"
          ? latest.error || t("partialReady")
          : latest.source === "improv"
            ? t("improvReady")
            : t("photoReady"),
      );
      await showScore();
    } else {
      setStatus(latest.error || t("recognizeFailed"));
      showPhoto();
    }
    await refreshList();
    return;
  }
}

function renderExplain(): void {
  const facts = el("facts");
  const glossary = el("glossary");
  facts.replaceChildren();
  glossary.replaceChildren();
  for (const fact of piece?.explain?.facts ?? []) {
    const block = document.createElement("section");
    const title = document.createElement("h3");
    title.textContent = fact.label;
    const text = document.createElement("p");
    text.textContent = fact.text;
    block.append(title, text);
    facts.append(block);
  }
  for (const item of piece?.explain?.glossary ?? []) {
    const paragraph = document.createElement("p");
    const name = document.createElement("strong");
    name.textContent = `${item.name}：`;
    paragraph.append(name, document.createTextNode(item.text));
    glossary.append(paragraph);
  }
}

function renderSelection(): void {
  const note = notes().find((item) => item.id === selectedId);
  el("editor").hidden = !note;
  if (!note) return;
  const where = note.measure === 0 ? t("pickup") : t("measureOne", { n: note.measure });
  el("selectionName").textContent = `${where} · ${pitchLabel(note.name)}`;
  const mapped = scoreView.mapped.find((item) => item.id === note.id);
  const caption = [mapped ? symbolCaption(mapped) : "", mapped ? accidentalCaption(mapped) : "", mapped ? dotCaption(mapped) : ""]
    .filter(Boolean)
    .join("");
  const dotHint = el("dotHint");
  dotHint.hidden = !caption;
  dotHint.textContent = caption;
  setButtonFace(el("askNote"), "chat", t("askNote"));
  const row = el("durations");
  row.replaceChildren();
  for (const [value, label] of durationChoices()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm join-item";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(note.duration === value));
    button.addEventListener("click", () => void edit({ duration: value }));
    row.append(button);
  }
}

function renderReview(): void {
  const empty = review.size === 0 && reviewText.size === 0;
  el("review").hidden = empty;
  el("reviewBar").hidden = empty;
}

function showTake(result: TakeResult): void {
  review = new Map(result.notes.map((note) => [note.id, note.status]));
  reviewText = new Map(result.notes.filter((note) => note.detail).map((note) => [note.id, note.detail]));
  el("review").hidden = false;
  el("reviewBar").hidden = false;
  const summary = result.summary;
  const tempo = result.heardBpm ? t("reviewTempo", { bpm: result.heardBpm }) : "";
  el("reviewSummary").textContent = t("reviewSummary", {
    ok: summary.ok,
    wrong: summary.wrong_pitch,
    missing: summary.missing,
    rhythm: summary.rhythm,
    extra: summary.extra,
    tempo,
  });
  const extras = el("reviewExtras");
  extras.replaceChildren();
  for (const extra of result.extras) {
    const item = document.createElement("li");
    item.textContent = t("extraNote", { name: midiLabel(extra.midi), onset: extra.onset.toFixed(1) });
    extras.append(item);
  }
  let legend = el("review").querySelector(".legend");
  if (!legend) {
    legend = document.createElement("div");
    legend.className = "legend";
    for (const [name, label] of [
      ["wrong", t("wrongPitch")],
      ["missing", t("missingNote")],
      ["rhythm", t("rhythmOff")],
    ] as const) {
      const chip = document.createElement("span");
      chip.className = name;
      chip.textContent = label;
      legend.append(chip);
    }
    el("review").append(legend);
  }
  paint();
}

function updateZoomLabel(): void {
  el("zoomLabel").textContent = `${Math.round(zoom * 100)}%`;
}

function updateSpeedLabel(): void {
  const speed = Number(el<HTMLInputElement>("speed").value);
  const bpm = Math.round((piece?.bpm ?? 72) * speed);
  el("speedLabel").textContent = String(bpm);
  el("speedLabel").title = t("bpmTitle", { bpm });
  el("speed").title = t("bpmTitle", { bpm });
}

function showImprov(open: boolean): void {
  el("libraryHome").hidden = open;
  el("improvPanel").hidden = !open;
  if (open) el<HTMLButtonElement>("improvStop").disabled = true;
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

async function startImprov(): Promise<void> {
  if (improvising) return;
  const session = ++improvSession;
  showImprov(true);
  el("improvClock").textContent = "0:00";
  setStatus(t("openingMic"));
  try {
    await recorder.start();
  } catch {
    if (session !== improvSession) return;
    showImprov(false);
    setStatus(t("micSettings"));
    return;
  }
  if (session !== improvSession) {
    recorder.stop();
    return;
  }
  improvising = true;
  improvStarted = performance.now();
  el<HTMLButtonElement>("improvStop").disabled = false;
  setStatus(t("recordingNow"));
  window.clearInterval(improvClock);
  improvClock = window.setInterval(() => {
    const seconds = Math.floor((performance.now() - improvStarted) / 1000);
    el("improvClock").textContent = formatClock(seconds);
    if (seconds >= 180) void finishImprov();
  }, 250);
}

async function finishImprov(): Promise<void> {
  if (!improvising) return;
  improvising = false;
  improvSession += 1;
  window.clearInterval(improvClock);
  const wav = recorder.stop();
  showImprov(false);
  setStatus(t("writingImprov"));
  try {
    const created = await api.improv(wav);
    await refreshList();
    await openPiece(created.id);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("improvFailed"));
  }
}

function cancelImprov(): void {
  improvising = false;
  improvSession += 1;
  window.clearInterval(improvClock);
  recorder.stop();
  showImprov(false);
  setStatus(t("recordingCancelled"));
}

async function edit(change: { semitone?: number; duration?: string }): Promise<void> {
  if (!piece || !selectedId) return;
  const keep = selectedId;
  try {
    piece = await api.edit(piece.id, selectedId, change);
    selectedId = piece.notes?.some((note) => note.id === keep) ? keep : null;
    renderPieceChrome();
    await showScore();
    setStatus(t("edited"));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("editFailed"));
  }
}

async function removeSelected(): Promise<void> {
  if (!piece || !selectedId) return;
  try {
    piece = await api.removeNote(piece.id, selectedId);
    selectedId = null;
    renderPieceChrome();
    await showScore();
    setStatus(t("noteRemoved"));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("removeNoteFailed"));
  }
}

async function play(): Promise<void> {
  if (player?.playing) {
    stopPlayback();
    paint();
    return;
  }
  await stopFollow();
  if (recording) return;
  const selected = notesInRange().filter((note) => note.attack);
  if (!selected.length) {
    setStatus(t("noNotesInRange"));
    return;
  }
  setStatus(t("preparingPiano"));
  try {
    player = new Player(await loadPiano());
    const playButton = el<HTMLButtonElement>("play");
    setButtonFace(playButton, "stop", t("stop"));
    playButton.setAttribute("aria-label", t("stop"));
    playButton.classList.add("is-live");
    setStatus(t("playingRange"));
    await player.play(selected, piece?.bpm ?? 72, Number(el<HTMLInputElement>("speed").value), (ids) => {
      current = new Set(ids);
      paint();
      if (!ids.length && !player?.playing) {
        const done = el<HTMLButtonElement>("play");
        setButtonFace(done, "play", t("play"));
        done.setAttribute("aria-label", t("play"));
        done.classList.remove("is-live");
        setStatus(t("playDone"));
      }
    });
  } catch (error) {
    stopPlayback();
    setStatus(error instanceof Error ? error.message : t("pianoFailed"));
  }
}

async function toggleFollow(): Promise<void> {
  if (following) {
    await stopFollow();
    current = new Set();
    paint();
    setStatus(t("followStopped"));
    return;
  }
  stopPlayback();
  if (recording) return;
  followList = notesInRange().filter((note) => note.attack);
  if (!followList.length) {
    setStatus(t("noFollowNotes"));
    return;
  }
  followIndex = 0;
  listen = initialListen();
  review = new Map();
  following = true;
  const followButton = el<HTMLButtonElement>("follow");
  setButtonFace(followButton, "stop", t("stop"));
  followButton.setAttribute("aria-label", t("stopFollow"));
  followButton.classList.add("is-live");
  updateFollowBanner(null, null);
  setStatus(t("openingMic"));
  try {
    await listener.start((midi) => onFollowPitch(midi));
    updateFollowBanner(null, null);
    setStatus(t("followReady"));
  } catch {
    updateFollowBanner(null, null);
    setStatus(t("noMicFollow"));
  }
}

function onFollowPitch(midi: number | null): void {
  if (!following || performance.now() < micIgnoreUntil) return;
  const target = followList[followIndex];
  if (!target) return;
  const next = followList[followIndex + 1] ?? null;
  const decision = decideFollow(listen, target.midi, next?.midi ?? null, midi);
  listen = decision.state;
  applyFollowDecision(target, decision.action, decision.heard, decision.hint);
}

function onFollowNote(midi: number): void {
  if (!following) return;
  const target = followList[followIndex];
  if (!target) return;
  micIgnoreUntil = performance.now() + MIC_IGNORE_MS;
  listen = initialListen();
  const next = followList[followIndex + 1] ?? null;
  const decision = decideFollowNote(target.midi, next?.midi ?? null, midi);
  applyFollowDecision(target, decision.action, decision.heard, decision.hint);
}

function applyFollowDecision(
  target: NoteHead,
  action: "wait" | "advance" | "wrong",
  heard: number | null,
  hint: string | null,
): void {
  if (action === "advance") {
    review.delete(target.id);
    followIndex += 1;
    listen = initialListen();
    if (followIndex >= followList.length) {
      void stopFollow();
      current = new Set();
      paint();
      setStatus(t("followDone"));
      return;
    }
  } else if (action === "wrong") {
    review.set(target.id, "wrong_pitch");
  }
  updateFollowBanner(hint, action === "wrong" ? heard : null);
  paint();
}

function onScreenKey(midi: number): void {
  void playMidi(midi);
  if (following) onFollowNote(midi);
}

const LETTER_STEPS: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
};

function computerMidi(code: string, key: string): number | null {
  const step = COMPUTER_STEPS[code] ?? LETTER_STEPS[key];
  if (step === undefined) return null;
  const midi = (keyboardOctave + 1) * 12 + step;
  if (midi < 21 || midi > 108) return null;
  return midi;
}

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function shiftKeyboardOctave(delta: number): void {
  keyboardOctave = Math.min(7, Math.max(1, keyboardOctave + delta));
  setStatusKey("keyboardFrom", { name: midiName((keyboardOctave + 1) * 12) });
}

function updateFollowBanner(hint: string | null, heard: number | null): void {
  const target = followList[followIndex];
  const banner = el("followBanner");
  if (!target) {
    banner.hidden = true;
    return;
  }
  current = new Set([target.id]);
  const where = target.measure === 0 ? t("pickup") : t("measureOne", { n: target.measure });
  const same = followList[followIndex - 1] && Math.abs(followList[followIndex - 1].offset - target.offset) < 0.01
    ? t("chordTogether")
    : "";
  const heardText = heard !== null ? t("heard", { name: midiLabel(heard) }) : "";
  const hintText = hint === "same-note" ? t("repeatHint") : (hint ?? "");
  banner.hidden = false;
  el("followPrompt").textContent = `${t("playThis", { name: pitchLabel(target.name), where })}${same}${heardText}${hintText}`;
}

async function toggleRecord(): Promise<void> {
  if (recording) {
    recording = false;
    const wav = recorder.stop();
    stopRecordClock();
    await analyze(wav);
    return;
  }
  stopPlayback();
  await stopFollow();
  try {
    await recorder.start();
  } catch {
    setStatus(t("micDenied"));
    return;
  }
  recording = true;
  recordStarted = performance.now();
  const button = el<HTMLButtonElement>("record");
  button.classList.add("is-live");
  const showRecordClock = () => {
    const seconds = Math.round((performance.now() - recordStarted) / 1000);
    setButtonFace(button, "stop", formatClock(seconds));
    button.setAttribute("aria-label", t("stopRecord", { seconds }));
  };
  showRecordClock();
  recordClock = window.setInterval(showRecordClock, 250);
  setStatus(t("recording"));
}

async function analyze(wav: Blob): Promise<void> {
  if (!piece) return;
  const { start, end } = range();
  setStatus(t("listening"));
  try {
    const created = await api.take(piece.id, wav, start, end);
    let take = created;
    while (take.status === "analyzing") {
      await sleep(1000);
      take = await api.takeStatus(piece.id, take.id);
    }
    if (take.status !== "ready" || !take.result) {
      setStatus(take.error || t("analyzeFailed"));
      return;
    }
    showTake(take.result);
    setStatus(t("marked"));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("analyzeFailed"));
  }
}

function sheetPoint(event: PointerEvent): { x: number; y: number } | null {
  const sheet = el("scoreSheet");
  const rect = sheet.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

async function explainMarks(
  marks: ReturnType<ScoreView["marksIn"]>,
  noteId: string | null,
  anchor?: DOMRect,
): Promise<void> {
  if (!piece) return;
  if (noteId) {
    selectedId = noteId;
    renderSelection();
    paint();
  }
  const spot = anchorFor(noteId) ?? anchor;
  if (spot) showBubble(spot, t("explaining"), noteId);
  setStatus(t("explainingStatus"));
  try {
    const result = await api.marks(piece.id, marks);
    const answer = result.text || result.message || t("noExplanation");
    const where = anchorFor(noteId) ?? spot;
    if (where) showBubble(where, answer, noteId);
    const saved = await api.saveAsk(piece.id, { label: askLabel(marks), text: answer, noteId });
    asks = [saved, ...asks.filter((item) => item.id !== saved.id)].slice(0, 40);
    openAskId = saved.id;
    renderAsks();
    setStatus(result.mode === "model" ? t("explainedModel") : t("explainedLocal"));
  } catch (error) {
    hideBubble();
    setStatus(error instanceof Error ? error.message : t("explainFailed"));
  }
}

function askLabel(marks: ScoreMark[]): string {
  const first = marks[0];
  if (!first) return t("mark");
  if (first.kind === "note" || first.kind === "dot") {
    const hand = first.hand === "left" ? t("leftHand") : first.hand === "right" ? t("rightHand") : "";
    const measure = first.measure ? t("measureHand", { measure: first.measure }) : "";
    const name = first.name ?? t("note");
    const extra = marks.length > 1 ? t("andMore", { count: marks.length }) : "";
    return `${measure} ${hand} ${name}${extra}`.replace(/\s+/g, " ").trim();
  }
  if (first.kind === "clef") return first.clef === "bass" ? t("bassClef") : t("trebleClef");
  if (first.kind === "time") return first.time ? t("timeSignature", { time: first.time }) : t("timeSignaturePlain");
  if (first.kind === "key") return t("keySignature");
  return marks.length > 1 ? t("marksAndMore", { count: marks.length }) : t("mark");
}

function anchorFor(noteId: string | null): DOMRect | null {
  if (!noteId) return null;
  const note = scoreView.mapped.find((item) => item.id === noteId);
  const rect = note?.element?.getBoundingClientRect();
  if (!rect || rect.width < 1) return null;
  return rect;
}

function showBubble(anchor: DOMRect, text: string, noteId: string | null): void {
  bubbleText = text;
  bubbleNoteId = noteId;
  const sheet = el("scoreSheet").getBoundingClientRect();
  bubbleAnchor = {
    left: anchor.left - sheet.left,
    top: anchor.top - sheet.top,
    width: anchor.width,
    height: anchor.height,
  };
  el("askBubbleText").textContent = text;
  el("askBubble").hidden = false;
  moveBubble(anchor);
}

function hideBubble(): void {
  bubbleText = "";
  bubbleNoteId = null;
  bubbleAnchor = null;
  openAskId = null;
  el("askBubble").hidden = true;
  renderAsks();
}

function moveBubble(anchor: DOMRect): void {
  const sheet = el("scoreSheet").getBoundingClientRect();
  const pane = el("scorePane").getBoundingClientRect();
  const bubble = el("askBubble");
  const width = Math.min(288, Math.max(160, sheet.width - 16));
  bubble.style.width = `${width}px`;
  let left = anchor.right - sheet.left + 12;
  let top = anchor.top - sheet.top - 6;
  if (left + width > sheet.width - 8) left = anchor.left - sheet.left - width - 12;
  if (left < 8) left = 8;
  const bubbleHeight = 160;
  const visibleTop = Math.max(8, pane.top - sheet.top + 8);
  const visibleBottom = pane.bottom - sheet.top - 8;
  if (top + bubbleHeight > visibleBottom) top = anchor.top - sheet.top - bubbleHeight - 8;
  if (top < visibleTop) top = visibleTop;
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function repositionBubble(): void {
  const bubble = el("askBubble");
  if (bubble.hidden || !bubbleText) return;
  const noteRect = anchorFor(bubbleNoteId);
  if (noteRect) {
    moveBubble(noteRect);
    return;
  }
  if (!bubbleAnchor) return;
  const sheet = el("scoreSheet").getBoundingClientRect();
  moveBubble(
    new DOMRect(
      sheet.left + bubbleAnchor.left,
      sheet.top + bubbleAnchor.top,
      bubbleAnchor.width,
      bubbleAnchor.height,
    ),
  );
}

function renderAsks(): void {
  const list = el("askHistoryList");
  const empty = el("askHistoryEmpty");
  list.replaceChildren();
  empty.hidden = asks.length > 0;
  for (const item of asks) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost btn-sm btn-block h-auto justify-start";
    button.setAttribute("aria-pressed", String(item.id === openAskId));
    const when = document.createElement("small");
    const date = new Date(item.at);
    when.textContent = Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const label = document.createElement("span");
    label.textContent = item.label;
    button.append(when, label);
    button.addEventListener("click", () => openSavedAsk(item));
    row.append(button);
    list.append(row);
  }
}

function openSavedAsk(item: AskRecord): void {
  openAskId = item.id;
  renderAsks();
  const note = item.noteId ? scoreView.mapped.find((mapped) => mapped.id === item.noteId) : null;
  note?.element?.scrollIntoView({ block: "nearest", inline: "nearest" });
  const rect = note?.element?.getBoundingClientRect();
  if (rect && rect.width > 0) {
    showBubble(rect, item.text, item.noteId);
    return;
  }
  const sheet = el("scoreSheet").getBoundingClientRect();
  const pane = el("scorePane");
  showBubble(new DOMRect(sheet.left + 16, sheet.top + pane.scrollTop + 16, 24, 24), item.text, item.noteId);
}

async function loadAsks(): Promise<void> {
  if (!piece) return;
  try {
    asks = await api.asks(piece.id);
  } catch {
    asks = [];
  }
  renderAsks();
}

async function finishAsk(): Promise<void> {
  if (!drag || !piece) return;
  drag = null;
  ignoreScoreClick = true;
  const box = el("scoreBox");
  const rect = box.getBoundingClientRect();
  const tiny = rect.width < 28 && rect.height < 28;
  const picked = tiny
    ? scoreView.marksAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
    : { marks: scoreView.marksIn(rect), noteId: null as string | null };
  const sheetBefore = el("scoreSheet").getBoundingClientRect();
  const relative = {
    left: rect.left - sheetBefore.left,
    top: rect.top - sheetBefore.top,
    width: rect.width,
    height: rect.height,
  };
  box.hidden = true;
  setAskMode(false);
  const sheetAfter = el("scoreSheet").getBoundingClientRect();
  const anchor = new DOMRect(
    sheetAfter.left + relative.left,
    sheetAfter.top + relative.top,
    relative.width,
    relative.height,
  );
  if (!picked.marks.length) {
    setStatus(t("missedMark"));
    return;
  }
  if (picked.marks.length > 8) {
    setStatus(t("tooManyMarks"));
    return;
  }
  await explainMarks(picked.marks, picked.noteId, anchor);
}

async function askSelected(): Promise<void> {
  if (!piece || !selectedId) return;
  const marks = scoreView.marksFor(selectedId);
  if (!marks.length) {
    setStatus(t("clickNoteFirst"));
    return;
  }
  await explainMarks(marks, selectedId);
}

let importAppend = false;

function clearPageDraft(): void {
  for (const page of pageDraft) URL.revokeObjectURL(page.url);
  pageDraft = [];
}

function takeImageFiles(list: FileList | File[]): File[] {
  return Array.from(list).filter((file) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name));
}

function openPageImport(files: File[], append: boolean): void {
  const images = files;
  if (!images.length) {
    setStatus(t("chooseImage"));
    return;
  }
  if (!append) clearPageDraft();
  if (pageDraft.length + images.length > 12) {
    setStatus(t("maxPages"));
    return;
  }
  for (const file of images) {
    pageDraft.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
  }
  if (!append) {
    const stem = images[0].name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    el<HTMLInputElement>("pageImportTitle").value = stem.slice(0, 40);
  }
  renderPageDraft();
  el<HTMLDialogElement>("pageImport").showModal();
}

function renderPageDraft(): void {
  const list = el("pageImportList");
  list.replaceChildren();
  pageDraft.forEach((page, index) => {
    const item = document.createElement("li");
    item.className = "page-draft-row";
    item.draggable = true;
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", String(index));
    });
    item.addEventListener("dragover", (event) => event.preventDefault());
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer?.getData("text/plain"));
      if (Number.isNaN(from) || from === index) return;
      const [moved] = pageDraft.splice(from, 1);
      pageDraft.splice(index, 0, moved);
      renderPageDraft();
    });
    const thumb = document.createElement("img");
    thumb.src = page.url;
    thumb.alt = "";
    const label = document.createElement("span");
    label.textContent = t("draftPage", { n: index + 1, name: page.file.name });
    const actions = document.createElement("div");
    const up = actionButton(t("moveUp"), "arrowUp", "btn btn-ghost btn-xs", () => moveDraft(index, -1));
    const down = actionButton(t("moveDown"), "arrowDown", "btn btn-ghost btn-xs", () => moveDraft(index, 1));
    const remove = actionButton(t("removePage"), "trash", "btn btn-ghost btn-xs text-error", () => {
      URL.revokeObjectURL(page.url);
      pageDraft.splice(index, 1);
      renderPageDraft();
    });
    up.disabled = index === 0;
    down.disabled = index === pageDraft.length - 1;
    actions.append(up, down, remove);
    item.append(thumb, label, actions);
    list.append(item);
  });
  el<HTMLButtonElement>("pageImportStart").disabled = pageDraft.length === 0;
}

function moveDraft(index: number, delta: number): void {
  const next = index + delta;
  if (next < 0 || next >= pageDraft.length) return;
  const [moved] = pageDraft.splice(index, 1);
  pageDraft.splice(next, 0, moved);
  renderPageDraft();
}

function renderPageManager(): void {
  const list = el("pageManagerList");
  if (!list) return;
  list.replaceChildren();
  const pages = piece?.pages ?? [];
  if (!pages.length) {
    const empty = document.createElement("li");
    empty.textContent = t("noPagedPhotos");
    list.append(empty);
    return;
  }
  for (const page of pages) {
    const item = document.createElement("li");
    item.className = "page-draft-row";
    const thumb = document.createElement("img");
    thumb.src = piece ? `/api/pieces/${piece.id}/photo?page=${page.index}&t=${page.status}` : "";
    thumb.alt = "";
    const label = document.createElement("span");
    const where = page.measureStart && page.measureEnd ? t("measureRange", { start: page.measureStart, end: page.measureEnd }) : "";
    const state = page.status === "ready" ? t("pageStateReady") : page.status === "failed" ? t("pageStateFailed") : page.status === "recognizing" ? t("pageStateBusy") : t("pageStateWait");
    label.textContent = [t("pageLine", { n: page.index }), state, where, page.error || ""].filter(Boolean).join(" · ");
    const actions = document.createElement("div");
    const again = actionButton(t("redoPage"), "refresh", "btn btn-ghost btn-xs", () => void redoScorePage(page.index));
    const swap = actionButton(t("swapImage"), "camera", "btn btn-ghost btn-xs", () => {
      replacePageIndex = page.index;
      el<HTMLInputElement>("pageReplaceFile").click();
    });
    actions.append(again, swap);
    item.append(thumb, label, actions);
    list.append(item);
  }
}

async function redoScorePage(index: number): Promise<void> {
  if (!piece) return;
  try {
    piece = await api.redoPage(piece.id, index);
    renderPageManager();
    setStatusKey("redoing", { n: index });
    await pollPiece(piece.id);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("redoFailed"));
  }
}

async function startPageImport(): Promise<void> {
  const title = el<HTMLInputElement>("pageImportTitle").value.trim();
  const files = pageDraft.map((page) => page.file);
  if (!files.length) return;
  el<HTMLButtonElement>("pageImportStart").disabled = true;
  try {
    const created = await api.uploadPhotos(files, title);
    el<HTMLDialogElement>("pageImport").close();
    clearPageDraft();
    await refreshList();
    await openPiece(created.id);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("importFailed"));
    el<HTMLButtonElement>("pageImportStart").disabled = false;
  }
}

function paintIcons(): void {
  setButtonFace(el("addMenu"), "plus", t("addPiece"));
  ensureIcon(el("pickXml"), "document");
  ensureIcon(el("pickMidi"), "queue");
  ensureIcon(el("pickPhoto"), "camera");
  ensureIcon(el("improvStart"), "mic");
  setButtonFace(el("improvStop"), "stop", t("improvStop"));
  setButtonFace(el("improvCancel"), "x", t("cancel"));
  setButtonFace(el("back"), "arrowLeft");
  setButtonFace(el("play"), "play", t("play"));
  setButtonFace(el("follow"), "note", t("follow"));
  setButtonFace(el("record"), "mic", t("record"));
  setButtonFace(el("jianpuToggle"), "hash");
  setButtonFace(el("readToggle"), "book");
  setButtonFace(el("moreMenu"), "ellipsis");
  setButtonFace(el("zoomOut"), "minus");
  setButtonFace(el("zoomIn"), "plus");
  setButtonFace(el("askMark"), "viewfinder", t("circle"));
  setButtonFace(el("photoToggle"), "photo", t("showPhoto"));
  setButtonFace(el("pageManage"), "photo", t("managePages"));
  setButtonFace(el("pageImportAdd"), "plus", t("addMore"));
  setButtonFace(el("pageImportStart"), "camera", t("startRead"));
  setButtonFace(el("pageImportCancel"), "x", t("cancel"));
  setButtonFace(el("pageManagerClose"), "x", t("close"));
  setButtonFace(el("photoPrev"), "arrowLeft", t("prevPage"));
  setButtonFace(el("photoNext"), "arrowRight", t("nextPage"));
  setButtonFace(el("clearMarks"), "undo", t("clearMarks"));
  setButtonFace(el("exportPiece"), "download", t("export"));
  setButtonFace(el("revealPiece"), "folder", t("openFolder"));
  setButtonFace(el("removePiece"), "trash", t("delete"));
  setButtonFace(el("confirmRemove"), "trash", t("confirmDeleteButton"));
  setButtonFace(el("cancelRemove"), "x", t("cancel"));
  setButtonFace(el("down"), "arrowDown", t("lower"));
  setButtonFace(el("up"), "arrowUp", t("higher"));
  setButtonFace(el("askNote"), "chat", t("explanation"));
  setButtonFace(el("removeNote"), "trash", t("removeNote"));
}

function bind(): void {
  paintIcons();
  setButtonFace(el("langButton"), "globe");
  bootLocale();
  setStatusKey("tagline");
  el("langZh").addEventListener("click", () => setLocale("zh-CN"));
  el("langEn").addEventListener("click", () => setLocale("en"));
  onLocale(() => {
    paintIcons();
    setButtonFace(el("langButton"), "globe");
    syncPhotoToggle();
    syncRangeLabel();
    updateSpeedLabel();
    renderSelection();
    renderPageManager();
    if (following) updateFollowBanner(null, null);
    hideBubble();
    refreshStatus();
    void refreshList();
    if (!piece) return;
    const id = piece.id;
    void api.piece(id).then((latest) => {
      if (piece?.id === id) {
        piece = latest;
        renderExplain();
        renderSelection();
      }
    });
    void loadAsks();
  });
  el("libraryQuery").addEventListener("input", () => {
    libraryQuery = el<HTMLInputElement>("libraryQuery").value;
    pendingDelete = null;
    renderCatalog();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      libraryFilter = button.dataset.filter || "all";
      document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((item) => {
        item.setAttribute("aria-selected", String(item === button));
      });
      pendingDelete = null;
      renderCatalog();
    });
  });
  el("pickXml").addEventListener("click", () => el<HTMLInputElement>("xmlFile").click());
  el("pickMidi").addEventListener("click", () => el<HTMLInputElement>("midiFile").click());
  el("pickPhoto").addEventListener("click", () => {
    importAppend = false;
    el<HTMLInputElement>("photoFile").click();
  });
  el("improvStart").addEventListener("click", () => void startImprov());
  el("improvStop").addEventListener("click", () => void finishImprov());
  el("improvCancel").addEventListener("click", () => cancelImprov());
  el<HTMLInputElement>("xmlFile").addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const created = await api.uploadXml(file);
      await refreshList();
      await openPiece(created.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("scoreOpenFailed"));
    }
  });
  el<HTMLInputElement>("midiFile").addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setStatus(t("writingMidi"));
    try {
      const created = await api.uploadMidi(file);
      await refreshList();
      await openPiece(created.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("midiFailed"));
    }
  });
  el<HTMLInputElement>("photoFile").addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    const files = takeImageFiles(input.files ?? []);
    input.value = "";
    if (!files.length) return;
    openPageImport(files, importAppend);
    importAppend = false;
  });
  el("pageImportAdd").addEventListener("click", () => {
    importAppend = true;
    el<HTMLInputElement>("photoFile").click();
  });
  el("pageImportCancel").addEventListener("click", () => {
    el<HTMLDialogElement>("pageImport").close();
    clearPageDraft();
  });
  el("pageImportStart").addEventListener("click", () => void startPageImport());
  el("pageManage").addEventListener("click", () => {
    renderPageManager();
    el<HTMLDialogElement>("pageManager").showModal();
  });
  el("pageManagerClose").addEventListener("click", () => el<HTMLDialogElement>("pageManager").close());
  el("photoPrev").addEventListener("click", () => showPhotoPage(photoPage - 1));
  el("photoNext").addEventListener("click", () => showPhotoPage(photoPage + 1));
  el<HTMLInputElement>("pageReplaceFile").addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !piece || !replacePageIndex) return;
    try {
      piece = await api.replacePage(piece.id, replacePageIndex, file);
      renderPageManager();
      setStatusKey("redoing", { n: replacePageIndex });
      await pollPiece(piece.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("swapFailed"));
    }
  });
  el("pieceTitle").addEventListener("click", () => beginTitleEdit());
  const titleInput = el<HTMLInputElement>("pieceTitleInput");
  titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      titleInput.blur();
    } else if (event.key === "Escape") {
      ignoreTitleBlur = true;
      titleInput.blur();
    }
  });
  titleInput.addEventListener("blur", () => {
    if (ignoreTitleBlur) {
      ignoreTitleBlur = false;
      titleInput.hidden = true;
      el("pieceTitle").hidden = false;
      return;
    }
    void commitTitle();
  });
  el("askBubbleClose").addEventListener("click", () => hideBubble());
  el("back").addEventListener("click", async () => {
    await stopActivities();
    workspace.hidden = true;
    el("keyboard").hidden = true;
    hideBubble();
    asks = [];
    welcome.hidden = false;
    piece = null;
    await refreshList();
    setStatus(t("tagline"));
  });
  el("photoToggle").addEventListener("click", async () => {
    el("stage").classList.toggle("photo-collapsed");
    syncPhotoToggle();
    if (xml && piece?.status === "ready") {
      await scoreView.load(xml, notes(), zoom);
      paint();
    }
  });
  el("readToggle").addEventListener("click", () => showRead(el("readSheet").hidden));
  el("readClose").addEventListener("click", () => showRead(false));
  el("play").addEventListener("click", () => void play());
  el("follow").addEventListener("click", () => void toggleFollow());
  el("record").addEventListener("click", () => void toggleRecord());
  el("clearMarks").addEventListener("click", () => {
    review = new Map();
    reviewText = new Map();
    el("review").hidden = true;
    el("reviewBar").hidden = true;
    paint();
  });
  el("speed").addEventListener("input", updateSpeedLabel);
  el("fromMeasure").addEventListener("input", syncRangeLabel);
  el("toMeasure").addEventListener("input", syncRangeLabel);
  el("moreMenu").addEventListener("click", () => resetDeleteConfirm());
  el("zoomIn").addEventListener("click", async () => {
    zoom = Math.min(1.8, Math.round((zoom + 0.2) * 10) / 10);
    updateZoomLabel();
    if (xml) await scoreView.load(xml, notes(), zoom);
    paint();
  });
  el("jianpuToggle").addEventListener("click", () => {
    const button = el<HTMLButtonElement>("jianpuToggle");
    const on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    scoreView.setJianpu(on);
    paint();
  });
  el("zoomOut").addEventListener("click", async () => {
    zoom = Math.max(0.6, Math.round((zoom - 0.2) * 10) / 10);
    updateZoomLabel();
    if (xml) await scoreView.load(xml, notes(), zoom);
    paint();
  });
  el("exportPiece").addEventListener("click", () => {
    if (piece) void exportScore(piece.id, piece.title);
  });
  el("revealPiece").addEventListener("click", () => {
    if (piece) void revealFolder(piece.id);
  });
  el("removePiece").addEventListener("click", () => {
    if (!piece) return;
    el("deleteItem").hidden = true;
    el("deleteConfirm").hidden = false;
    el("confirmRemove").focus();
  });
  el("cancelRemove").addEventListener("click", () => resetDeleteConfirm());
  el("confirmRemove").addEventListener("click", async () => {
    if (!piece) return;
    const id = piece.id;
    resetDeleteConfirm();
    await stopActivities();
    await api.remove(id);
    piece = null;
    workspace.hidden = true;
    el("keyboard").hidden = true;
    hideBubble();
    asks = [];
    welcome.hidden = false;
    await refreshList();
    setStatus(t("deletedPiece"));
  });
  el("up").addEventListener("click", () => void edit({ semitone: 1 }));
  el("down").addEventListener("click", () => void edit({ semitone: -1 }));
  el("removeNote").addEventListener("click", () => void removeSelected());
  el("askNote").addEventListener("click", () => void askSelected());
  el("askMark").addEventListener("click", () => {
    if (!piece || (piece.status !== "ready" && piece.status !== "partial")) {
      setStatus(t("circleNeedsScore"));
      return;
    }
    setAskMode(!asking);
  });
  scoreRoot.addEventListener("click", (event) => {
    if (ignoreScoreClick) {
      ignoreScoreClick = false;
      return;
    }
    if (asking) return;
    if (clickedScoreTitle(event)) {
      beginTitleEdit();
      return;
    }
    const id = scoreView.hit(event.clientX, event.clientY);
    if (!id) return;
    selectedId = id;
    const detail = reviewText.get(id);
    renderSelection();
    paint();
    const mapped = scoreView.mapped.find((item) => item.id === id);
    if (mapped && (mapped.symbols.length > 0 || mapped.accidental || mapped.dots > 0)) {
      void explainMarks(scoreView.marksFor(id), id);
    }
    if (detail) setStatus(detail);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && asking) setAskMode(false);
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (typingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (event.code === "KeyZ" || event.code === "KeyX" || key === "z" || key === "x") {
      shiftKeyboardOctave(event.code === "KeyX" || key === "x" ? 1 : -1);
      event.preventDefault();
      return;
    }
    const midi = computerMidi(event.code, key);
    if (midi === null) return;
    event.preventDefault();
    void playMidi(midi);
    if (following) onFollowNote(midi);
  });
  const sheet = el("scoreSheet");
  sheet.addEventListener("pointerdown", (event) => {
    if (!asking) return;
    const point = sheetPoint(event);
    if (!point) return;
    drag = { ...point, left: point.x, top: point.y };
    const box = el("scoreBox");
    box.hidden = false;
    box.style.left = `${point.x}px`;
    box.style.top = `${point.y}px`;
    box.style.width = "0px";
    box.style.height = "0px";
    try {
      sheet.setPointerCapture(event.pointerId);
    } catch {
      // Capture is optional; the drag still follows the pointer over the score.
    }
  });
  sheet.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const point = sheetPoint(event);
    if (!point) return;
    const box = el("scoreBox");
    const left = Math.min(drag.left, point.x);
    const top = Math.min(drag.top, point.y);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${Math.abs(point.x - drag.left)}px`;
    box.style.height = `${Math.abs(point.y - drag.top)}px`;
  });
  sheet.addEventListener("pointerup", () => void finishAsk());
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      el("keysHost").dataset.signature = "";
      if (xml && piece?.status === "ready") void scoreView.load(xml, notes(), zoom).then(paint);
    }, 250);
  });
}

let resizeTimer = 0;

bind();
void refreshList().catch((error: unknown) => {
  setStatus(error instanceof Error ? error.message : t("serverDown"));
});
void api.health().then((health) => {
  if (!health.transcribe) {
    setStatus(t("transcribeMissing"));
  }
});
