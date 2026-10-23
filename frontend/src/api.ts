import type { AskRecord, Piece, RegionResult, ScoreMark, Take } from "./types";

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
  } catch {
    /* The server sometimes returns an empty body. */
  }
  return "请求没有成功";
}

async function send<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<T>;
}

export const api = {
  health: () => send<{ ok: boolean; omr: boolean; transcribe: boolean }>("/api/health"),
  pieces: () => send<Piece[]>("/api/pieces"),
  sample: () => send<Piece>("/api/pieces/sample", { method: "POST" }),
  piece: (id: string) => send<Piece>(`/api/pieces/${id}`),
  remove: (id: string) => send<{ ok: boolean }>(`/api/pieces/${id}`, { method: "DELETE" }),
  score: async (id: string) => {
    const response = await fetch(`/api/pieces/${id}/score`);
    if (!response.ok) throw new Error(await parseError(response));
    return response.text();
  },
  reveal: (id: string) => send<{ ok: boolean }>(`/api/pieces/${id}/folder`, { method: "POST" }),
  uploadXml: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return send<Piece>("/api/pieces/musicxml", { method: "POST", body });
  },
  uploadMidi: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return send<Piece>("/api/pieces/midi", { method: "POST", body });
  },
  uploadPhotos: (files: File[], title: string) => {
    const body = new FormData();
    body.append("title", title);
    for (const file of files) body.append("files", file, file.name);
    return send<Piece>("/api/pieces/photo", { method: "POST", body });
  },
  redoPage: (id: string, page: number) =>
    send<Piece>(`/api/pieces/${id}/pages/${page}/recognize`, { method: "POST" }),
  replacePage: (id: string, page: number, file: File) => {
    const body = new FormData();
    body.append("file", file, file.name);
    return send<Piece>(`/api/pieces/${id}/pages/${page}/image`, { method: "POST", body });
  },
  improv: (wav: Blob) => {
    const body = new FormData();
    body.append("file", wav, "improv.wav");
    return send<Piece>("/api/pieces/improv", { method: "POST", body });
  },
  removeNote: (id: string, noteId: string) =>
    send<Piece>(`/api/pieces/${id}/notes/${encodeURIComponent(noteId)}`, { method: "DELETE" }),
  edit: (id: string, noteId: string, change: { semitone?: number; duration?: string }) =>
    send<Piece>(`/api/pieces/${id}/notes/${encodeURIComponent(noteId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    }),
  rename: (id: string, title: string) =>
    send<Piece>(`/api/pieces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  marks: (id: string, marks: ScoreMark[]) =>
    send<RegionResult>(`/api/pieces/${id}/explain/marks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marks }),
    }),
  asks: (id: string) => send<AskRecord[]>(`/api/pieces/${id}/asks`),
  saveAsk: (id: string, body: { label: string; text: string; noteId: string | null }) =>
    send<AskRecord>(`/api/pieces/${id}/asks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  take: (id: string, wav: Blob, startMeasure: number, endMeasure: number) => {
    const body = new FormData();
    body.append("file", wav, "take.wav");
    body.append("start_measure", String(startMeasure));
    body.append("end_measure", String(endMeasure));
    return send<Take>(`/api/pieces/${id}/takes`, { method: "POST", body });
  },
  takeStatus: (id: string, takeId: string) => send<Take>(`/api/pieces/${id}/takes/${takeId}`),
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
