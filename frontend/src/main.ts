import { api, sleep } from "./api";
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

const DURATIONS: Array<[string, string]> = [
  ["whole", "全音符"],
  ["half", "二分音符"],
  ["quarter", "四分音符"],
  ["eighth", "八分音符"],
];

function setStatus(message: string): void {
  status.textContent = message;
}

function showRead(open: boolean): void {
  el("readSheet").hidden = !open;
  el("readToggle").setAttribute("aria-pressed", String(open));
}

function syncPhotoToggle(): void {
  const button = el<HTMLButtonElement>("photoToggle");
  const open = Boolean(piece?.hasPhoto) && !el("stage").classList.contains("photo-collapsed");
  el("photoToggleItem").hidden = !piece?.hasPhoto;
  setButtonFace(button, open ? "eye" : "photo", open ? "只看谱" : "对照原图");
  button.setAttribute("aria-pressed", String(open));
}

function syncRangeLabel(): void {
  const { start, end } = range();
  el("rangeLabel").textContent = start === end ? `第 ${start} 小节` : `第 ${start}–${end} 小节`;
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
  setButtonFace(playButton, "play", "播放");
  playButton.setAttribute("aria-label", "播放");
  playButton.classList.remove("is-live");
}

async function stopFollow(): Promise<void> {
  following = false;
  micIgnoreUntil = 0;
  listener.stop();
  el("followBanner").hidden = true;
  const follow = el<HTMLButtonElement>("follow");
  setButtonFace(follow, "note", "跟弹");
  follow.setAttribute("aria-label", "跟弹");
  follow.classList.remove("is-live");
}

function stopRecordClock(): void {
  window.clearInterval(recordClock);
  const record = el<HTMLButtonElement>("record");
  setButtonFace(record, "mic", "录音检查");
  record.setAttribute("aria-label", "录音检查");
  record.classList.remove("is-live");
}

function setAskMode(on: boolean): void {
  asking = on;
  drag = null;
  el("scoreBox").hidden = true;
  el("askHint").hidden = !on;
  el("scoreSheet").classList.toggle("asking", on);
  const button = el<HTMLButtonElement>("askMark");
  setButtonFace(button, on ? "x" : "viewfinder", on ? "取消圈选" : "圈记号");
  button.setAttribute("aria-pressed", String(on));
  if (on) setStatus("点一下谱上的记号。音符旁边的点、线、数字和字都会说明。");
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
  if (item.hasPhoto) return "照片";
  if (item.source === "midi") return "MIDI";
  if (item.source === "improv") return "即兴";
  return "乐谱";
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
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function pageCountLabel(item: Piece): string {
  return (item.pageCount ?? 0) > 1 ? `${item.pageCount} 页` : "";
}

function pieceState(item: Piece): string {
  const busy = item.status === "recognizing" || (item.pages ?? []).some((page) => page.status === "waiting" || page.status === "recognizing");
  if (busy) {
    if ((item.pageCount ?? 0) > 1) {
      const done = (item.pages ?? []).filter((page) => page.status === "ready" || page.status === "failed").length;
      return `识别中 ${done}/${item.pageCount} 页`;
    }
    return item.source === "improv" ? "写谱中" : "识谱中";
  }
  if (item.status === "partial") return "部分失败";
  if (item.status === "failed") return "未成功";
  return "";
}

function recognizeStatus(item: Piece): string {
  const total = item.pageCount ?? 0;
  if (total > 1) {
    const done = (item.pages ?? []).filter((page) => page.status === "ready" || page.status === "failed").length;
    const currentPage = Math.min(total, done + 1);
    return `正在识谱，第 ${currentPage} 页，共 ${total} 页。`;
  }
  return item.source === "improv"
    ? "正在把弹的写成谱。第一次听音会久一点。"
    : "正在识谱。第一次会下载模型，可能要几分钟。";
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
  count.textContent = catalog.length ? `${shown.length} 首` : "";
  pieceList.replaceChildren();
  if (!catalog.length) {
    const empty = document.createElement("p");
    empty.className = "hint catalog-empty";
    empty.textContent = "曲库是空的。用右上角的新增曲子放进第一首。";
    pieceList.append(empty);
    return;
  }
  if (!shown.length) {
    const empty = document.createElement("p");
    empty.className = "hint catalog-empty";
    empty.textContent = "没有符合的曲子。";
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
    input.setAttribute("aria-label", "曲名");
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
      actionButton("确认删除", "trash", "btn btn-error btn-xs", () => void removeFromLibrary(item.id)),
      actionButton("取消", "x", "btn btn-ghost btn-xs", () => {
        pendingDelete = null;
        renderCatalog();
      }),
    );
  } else if (renamingId === item.id) {
    const save = actionButton("保存", "check", "btn btn-primary btn-xs", () => {
      if (input) void commitLibraryRename(item.id, input.value);
    });
    const cancelEdit = actionButton("取消", "x", "btn btn-ghost btn-xs", () => {
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
  trigger.setAttribute("aria-label", `${item.title}的更多操作`);
  trigger.title = "更多";
  setButtonFace(trigger, "ellipsis");
  const menu = document.createElement("ul");
  menu.tabIndex = 0;
  menu.className = "dropdown-content menu more-menu";
  const rule = document.createElement("li");
  rule.className = "menu-rule";
  rule.setAttribute("aria-hidden", "true");
  menu.append(
    menuButton("导出", "download", "", () => void exportScore(item.id, item.title)),
    menuButton("打开目录", "folder", "", () => void revealFolder(item.id)),
    menuButton("改名", "pencil", "", () => {
      pendingDelete = null;
      renamingId = item.id;
      renderCatalog();
    }),
    rule,
    menuButton("删除", "trash", "text-error", () => {
      renamingId = null;
      pendingDelete = item.id;
      renderCatalog();
    }),
  );
  wrap.append(trigger, menu);
  return wrap;
}

function scoreFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "曲子";
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
    setStatus("谱子已导出。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "没有导出");
  }
}

async function revealFolder(id: string): Promise<void> {
  try {
    await api.reveal(id);
    setStatus("已在访达中打开这首曲子的文件夹。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "文件夹没有打开");
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
    setStatus("曲名改好了。");
    await refreshList();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "曲名没改成");
    renderCatalog();
  }
}

async function removeFromLibrary(id: string): Promise<void> {
  pendingDelete = null;
  try {
    await api.remove(id);
    if (piece?.id === id) piece = null;
    setStatus("这首已经从曲库删掉。");
    await refreshList();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "没有删掉");
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
    setStatus(recognizeStatus(piece));
    showPhoto();
    await pollPiece(id);
    return;
  }
  if (piece.status === "failed") {
    setStatus(piece.error || "识谱没有成功");
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
  setStatus("改完按回车。不想改就按 Esc。");
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
    setStatus("标题改好了。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "标题没改成");
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
  el("photoPageLabel").textContent = `第 ${photoPage}/${total} 页`;
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
    setStatus("谱子打开了。有的音符点不中时，可以先听播放，再改能点到的音。");
  } else {
    setStatus("点一个音，下面的琴键会亮。简谱数字在每行五线谱的下面。");
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
      setStatus(recognizeStatus(latest));
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
          ? latest.error || "有的页没有识别成功。"
          : latest.source === "improv"
            ? "写成谱了。中央 C 和更高的音在上面一行。听一遍，点不对的音可以改，多出来的音可以去掉。"
            : "认完了。请对着原图听一遍，再改不对的音。",
      );
      await showScore();
    } else {
      setStatus(latest.error || "识谱没有成功");
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
  const where = note.measure === 0 ? "弱起" : `第 ${note.measure} 小节`;
  el("selectionName").textContent = `${where} · ${pitchLabel(note.name)}`;
  const mapped = scoreView.mapped.find((item) => item.id === note.id);
  const caption = [mapped ? symbolCaption(mapped) : "", mapped ? accidentalCaption(mapped) : "", mapped ? dotCaption(mapped) : ""]
    .filter(Boolean)
    .join("");
  const dotHint = el("dotHint");
  dotHint.hidden = !caption;
  dotHint.textContent = caption;
  setButtonFace(el("askNote"), "chat", "让 AI 说明");
  const row = el("durations");
  row.replaceChildren();
  for (const [value, label] of DURATIONS) {
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
  const tempo = result.heardBpm ? `按这一遍自己的速度，大约每分钟 ${result.heardBpm} 拍。慢一点但均匀的音不会被标出来。` : "";
  el("reviewSummary").textContent =
    `${summary.ok} 个音对上了，${summary.wrong_pitch} 个音高不对，${summary.missing} 个没听到，${summary.rhythm} 个节奏差得比较多，多弹了 ${summary.extra} 个。${tempo}`;
  const extras = el("reviewExtras");
  extras.replaceChildren();
  for (const extra of result.extras) {
    const item = document.createElement("li");
    item.textContent = `多弹了 ${midiLabel(extra.midi)}，大约在第 ${extra.onset.toFixed(1)} 秒。`;
    extras.append(item);
  }
  let legend = el("review").querySelector(".legend");
  if (!legend) {
    legend = document.createElement("div");
    legend.className = "legend";
    for (const [name, label] of [
      ["wrong", "音高不对"],
      ["missing", "没听到"],
      ["rhythm", "节奏差一截"],
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
  el("speedLabel").title = `约每分钟 ${bpm} 拍`;
  el("speed").title = `约每分钟 ${bpm} 拍`;
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
  setStatus("正在打开麦克风…");
  try {
    await recorder.start();
  } catch {
    if (session !== improvSession) return;
    showImprov(false);
    setStatus("没有用上麦克风。请允许使用麦克风后再试。");
    return;
  }
  if (session !== improvSession) {
    recorder.stop();
    return;
  }
  improvising = true;
  improvStarted = performance.now();
  el<HTMLButtonElement>("improvStop").disabled = false;
  setStatus("正在录音。弹完点停止。");
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
  setStatus("正在把弹的写成谱…");
  try {
    const created = await api.improv(wav);
    await refreshList();
    await openPiece(created.id);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "没能写成谱，请再录一次。");
  }
}

function cancelImprov(): void {
  improvising = false;
  improvSession += 1;
  window.clearInterval(improvClock);
  recorder.stop();
  showImprov(false);
  setStatus("录音取消了。");
}

async function edit(change: { semitone?: number; duration?: string }): Promise<void> {
  if (!piece || !selectedId) return;
  const keep = selectedId;
  try {
    piece = await api.edit(piece.id, selectedId, change);
    selectedId = piece.notes?.some((note) => note.id === keep) ? keep : null;
    renderPieceChrome();
    await showScore();
    setStatus("改好了。再听一遍确认。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "没有改成");
  }
}

async function removeSelected(): Promise<void> {
  if (!piece || !selectedId) return;
  try {
    piece = await api.removeNote(piece.id, selectedId);
    selectedId = null;
    renderPieceChrome();
    await showScore();
    setStatus("这个音去掉了。再听一遍确认。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "没有去掉");
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
    setStatus("这个小节范围里没有音。");
    return;
  }
  setStatus("正在准备钢琴声音…");
  try {
    player = new Player(await loadPiano());
    const playButton = el<HTMLButtonElement>("play");
    setButtonFace(playButton, "stop", "停止");
    playButton.setAttribute("aria-label", "停止");
    playButton.classList.add("is-live");
    setStatus("正在播放选定的小节。");
    await player.play(selected, piece?.bpm ?? 72, Number(el<HTMLInputElement>("speed").value), (ids) => {
      current = new Set(ids);
      paint();
      if (!ids.length && !player?.playing) {
        const done = el<HTMLButtonElement>("play");
        setButtonFace(done, "play", "播放");
        done.setAttribute("aria-label", "播放");
        done.classList.remove("is-live");
        setStatus("播放结束。");
      }
    });
  } catch (error) {
    stopPlayback();
    setStatus(error instanceof Error ? error.message : "钢琴声音没有准备好");
  }
}

async function toggleFollow(): Promise<void> {
  if (following) {
    await stopFollow();
    current = new Set();
    paint();
    setStatus("跟弹停了。");
    return;
  }
  stopPlayback();
  if (recording) return;
  followList = notesInRange().filter((note) => note.attack);
  if (!followList.length) {
    setStatus("这个小节范围里没有可以跟的单音。");
    return;
  }
  followIndex = 0;
  listen = initialListen();
  review = new Map();
  following = true;
  const followButton = el<HTMLButtonElement>("follow");
  setButtonFace(followButton, "stop", "停止");
  followButton.setAttribute("aria-label", "停止跟弹");
  followButton.classList.add("is-live");
  updateFollowBanner(null, null);
  setStatus("正在打开麦克风…");
  try {
    await listener.start((midi) => onFollowPitch(midi));
    updateFollowBanner(null, null);
    setStatus("一次对一个音。弹对了会走到下一个。");
  } catch {
    updateFollowBanner(null, null);
    setStatus("没有麦克风，可以点屏幕琴键或用电脑键盘弹");
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
      setStatus("这一遍跟弹完成。");
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
  setStatus(`电脑键盘从 ${midiName((keyboardOctave + 1) * 12)} 开始。`);
}

function updateFollowBanner(hint: string | null, heard: number | null): void {
  const target = followList[followIndex];
  const banner = el("followBanner");
  if (!target) {
    banner.hidden = true;
    return;
  }
  current = new Set([target.id]);
  const where = target.measure === 0 ? "弱起" : `第 ${target.measure} 小节`;
  const same = followList[followIndex - 1] && Math.abs(followList[followIndex - 1].offset - target.offset) < 0.01
    ? "这个音和前一个音写在一起，跟弹时分开对。"
    : "";
  const heardText = heard !== null ? `听到的是 ${midiLabel(heard)}。` : "";
  banner.hidden = false;
  el("followPrompt").textContent = `请弹 ${pitchLabel(target.name)}。${where}。${same}${heardText}${hint ?? ""}`;
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
    setStatus("没有拿到麦克风。请在系统设置里允许使用麦克风。");
    return;
  }
  recording = true;
  recordStarted = performance.now();
  const button = el<HTMLButtonElement>("record");
  button.classList.add("is-live");
  const showRecordClock = () => {
    const seconds = Math.round((performance.now() - recordStarted) / 1000);
    setButtonFace(button, "stop", formatClock(seconds));
    button.setAttribute("aria-label", `停止并检查，已录 ${seconds} 秒`);
  };
  showRecordClock();
  recordClock = window.setInterval(showRecordClock, 250);
  setStatus("正在录音。弹完选定的小节后再停止。");
}

async function analyze(wav: Blob): Promise<void> {
  if (!piece) return;
  const { start, end } = range();
  setStatus("正在听刚才那一遍。第一次会下载钢琴模型，请稍等。");
  try {
    const created = await api.take(piece.id, wav, start, end);
    let take = created;
    while (take.status === "analyzing") {
      await sleep(1000);
      take = await api.takeStatus(piece.id, take.id);
    }
    if (take.status !== "ready" || !take.result) {
      setStatus(take.error || "听音分析没有完成");
      return;
    }
    showTake(take.result);
    setStatus("标记好了。红色是音高，灰色是没听到，紫色是节奏差得比较多。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "听音分析没有完成");
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
  if (spot) showBubble(spot, "正在说明…", noteId);
  setStatus("正在说明这个记号…");
  try {
    const result = await api.marks(piece.id, marks);
    const answer = result.text || result.message || "没有解释出来。";
    const where = anchorFor(noteId) ?? spot;
    if (where) showBubble(where, answer, noteId);
    const saved = await api.saveAsk(piece.id, { label: askLabel(marks), text: answer, noteId });
    asks = [saved, ...asks.filter((item) => item.id !== saved.id)].slice(0, 40);
    openAskId = saved.id;
    renderAsks();
    setStatus(result.mode === "model" ? "说明在记号旁边。问过的都留在读谱栏。" : "没连上 AI，先显示谱上认出来的说明。");
  } catch (error) {
    hideBubble();
    setStatus(error instanceof Error ? error.message : "这个记号没有解释出来");
  }
}

function askLabel(marks: ScoreMark[]): string {
  const first = marks[0];
  if (!first) return "记号";
  if (first.kind === "note" || first.kind === "dot") {
    const hand = first.hand === "left" ? "左手" : first.hand === "right" ? "右手" : "";
    const measure = first.measure ? `第${first.measure}小节` : "";
    const name = first.name ?? "音符";
    const extra = marks.length > 1 ? ` 等${marks.length}个` : "";
    return `${measure} ${hand} ${name}${extra}`.replace(/\s+/g, " ").trim();
  }
  if (first.kind === "clef") return first.clef === "bass" ? "低音谱号" : "高音谱号";
  if (first.kind === "time") return first.time ? `${first.time} 拍号` : "拍号";
  if (first.kind === "key") return "调号";
  return marks.length > 1 ? `记号 等${marks.length}个` : "记号";
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
    setStatus("没有点到谱号、拍号或音符。点一下音符，或它左边的记号、右边的小圆点。");
    return;
  }
  if (picked.marks.length > 8) {
    setStatus("框里记号太多。点一下要问的那个音。");
    return;
  }
  await explainMarks(picked.marks, picked.noteId, anchor);
}

async function askSelected(): Promise<void> {
  if (!piece || !selectedId) return;
  const marks = scoreView.marksFor(selectedId);
  if (!marks.length) {
    setStatus("先点谱上的符头，再问这个音。");
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
    setStatus("请选择图片。");
    return;
  }
  if (!append) clearPageDraft();
  if (pageDraft.length + images.length > 12) {
    setStatus("一次最多 12 页。");
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
    label.textContent = `第 ${index + 1} 页 · ${page.file.name}`;
    const actions = document.createElement("div");
    const up = actionButton("上移", "arrowUp", "btn btn-ghost btn-xs", () => moveDraft(index, -1));
    const down = actionButton("下移", "arrowDown", "btn btn-ghost btn-xs", () => moveDraft(index, 1));
    const remove = actionButton("删掉", "trash", "btn btn-ghost btn-xs text-error", () => {
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
    empty.textContent = "这首没有分页照片。";
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
    const where = page.measureStart && page.measureEnd ? `第 ${page.measureStart}–${page.measureEnd} 小节` : "";
    const state = page.status === "ready" ? "完成" : page.status === "failed" ? "失败" : page.status === "recognizing" ? "识别中" : "等待";
    label.textContent = [`第 ${page.index} 页`, state, where, page.error || ""].filter(Boolean).join(" · ");
    const actions = document.createElement("div");
    const again = actionButton("重新识别", "refresh", "btn btn-ghost btn-xs", () => void redoScorePage(page.index));
    const swap = actionButton("换图片", "camera", "btn btn-ghost btn-xs", () => {
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
    setStatus(`正在重新识别第 ${index} 页。`);
    await pollPiece(piece.id);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "这一页没有重新开始");
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
    setStatus(error instanceof Error ? error.message : "这些照片没有导入");
    el<HTMLButtonElement>("pageImportStart").disabled = false;
  }
}

function paintIcons(): void {
  setButtonFace(el("addMenu"), "plus", "新增曲子");
  ensureIcon(el("pickXml"), "document");
  ensureIcon(el("pickMidi"), "queue");
  ensureIcon(el("pickPhoto"), "camera");
  ensureIcon(el("improvStart"), "mic");
  setButtonFace(el("improvStop"), "stop", "停止并写成谱");
  setButtonFace(el("improvCancel"), "x", "取消");
  setButtonFace(el("back"), "arrowLeft");
  setButtonFace(el("play"), "play", "播放");
  setButtonFace(el("follow"), "note", "跟弹");
  setButtonFace(el("record"), "mic", "录音检查");
  setButtonFace(el("jianpuToggle"), "hash");
  setButtonFace(el("readToggle"), "book");
  setButtonFace(el("moreMenu"), "ellipsis");
  setButtonFace(el("zoomOut"), "minus");
  setButtonFace(el("zoomIn"), "plus");
  setButtonFace(el("askMark"), "viewfinder", "圈记号");
  setButtonFace(el("photoToggle"), "photo", "对照原图");
  setButtonFace(el("pageManage"), "photo", "管理页面");
  setButtonFace(el("pageImportAdd"), "plus", "继续添加");
  setButtonFace(el("pageImportStart"), "camera", "开始识别");
  setButtonFace(el("pageImportCancel"), "x", "取消");
  setButtonFace(el("pageManagerClose"), "x", "关闭");
  setButtonFace(el("photoPrev"), "arrowLeft", "上一页");
  setButtonFace(el("photoNext"), "arrowRight", "下一页");
  setButtonFace(el("clearMarks"), "undo", "清除标记");
  setButtonFace(el("exportPiece"), "download", "导出");
  setButtonFace(el("revealPiece"), "folder", "打开目录");
  setButtonFace(el("removePiece"), "trash", "删除");
  setButtonFace(el("confirmRemove"), "trash", "确认删除");
  setButtonFace(el("cancelRemove"), "x", "取消");
  setButtonFace(el("down"), "arrowDown", "低半音");
  setButtonFace(el("up"), "arrowUp", "高半音");
  setButtonFace(el("askNote"), "chat", "说明");
  setButtonFace(el("removeNote"), "trash", "去掉");
}

function bind(): void {
  paintIcons();
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
      setStatus(error instanceof Error ? error.message : "这份谱子打不开");
    }
  });
  el<HTMLInputElement>("midiFile").addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setStatus("正在把 MIDI 写成谱。");
    try {
      const created = await api.uploadMidi(file);
      await refreshList();
      await openPiece(created.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "这个 MIDI 打不开");
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
      setStatus(`正在重新识别第 ${replacePageIndex} 页。`);
      await pollPiece(piece.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "这一页没有换上");
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
    setStatus("把老师发的谱子拍下来，先听，再跟着弹。");
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
    setStatus("这首已经删掉，只存在这台电脑上的那份也去掉了。");
  });
  el("up").addEventListener("click", () => void edit({ semitone: 1 }));
  el("down").addEventListener("click", () => void edit({ semitone: -1 }));
  el("removeNote").addEventListener("click", () => void removeSelected());
  el("askNote").addEventListener("click", () => void askSelected());
  el("askMark").addEventListener("click", () => {
    if (!piece || (piece.status !== "ready" && piece.status !== "partial")) {
      setStatus("谱子准备好之后，才能在谱上圈记号。");
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
  setStatus(error instanceof Error ? error.message : "本地服务还没连上");
});
void api.health().then((health) => {
  if (!health.transcribe) {
    setStatus("谱子和播放可以用。整段听音还要先安装 requirements-ml.txt 里的组件。");
  }
});
