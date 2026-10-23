export interface ListenState {
  pendingMidi: number | null;
  pendingCount: number;
  latched: number | null;
  quiet: number;
}

export interface ListenDecision {
  state: ListenState;
  action: "wait" | "advance" | "wrong";
  heard: number | null;
  hint: string | null;
}

const FRAMES_TO_ACCEPT = 4;
const QUIET_FRAMES_TO_REARM = 3;

export function initialListen(): ListenState {
  return { pendingMidi: null, pendingCount: 0, latched: null, quiet: 0 };
}

export function decideFollow(
  state: ListenState,
  targetMidi: number,
  nextMidi: number | null,
  heardMidi: number | null,
): ListenDecision {
  const next: ListenState = { ...state };
  const repeatHint =
    nextMidi === targetMidi ? "same-note" : null;

  if (heardMidi === null) {
    next.quiet += 1;
    next.pendingMidi = null;
    next.pendingCount = 0;
    if (next.quiet >= QUIET_FRAMES_TO_REARM) next.latched = null;
    return {
      state: next,
      action: "wait",
      heard: null,
      hint: next.latched === targetMidi ? repeatHint : null,
    };
  }

  next.quiet = 0;
  if (heardMidi === next.pendingMidi) next.pendingCount += 1;
  else {
    next.pendingMidi = heardMidi;
    next.pendingCount = 1;
  }
  if (next.pendingCount < FRAMES_TO_ACCEPT) {
    return { state: next, action: "wait", heard: null, hint: null };
  }
  if (next.latched === heardMidi) {
    return {
      state: next,
      action: "wait",
      heard: heardMidi,
      hint: heardMidi === targetMidi ? repeatHint : null,
    };
  }

  next.latched = heardMidi;
  next.pendingCount = 0;
  if (heardMidi === targetMidi) {
    return { state: next, action: "advance", heard: heardMidi, hint: nextMidi === targetMidi ? repeatHint : null };
  }
  return { state: next, action: "wrong", heard: heardMidi, hint: null };
}

/** One key press. Correct advances immediately; wrong reports the played pitch. */
export function decideFollowNote(
  targetMidi: number,
  nextMidi: number | null,
  heardMidi: number,
): ListenDecision {
  const repeatHint =
    nextMidi === targetMidi ? "same-note" : null;
  if (heardMidi === targetMidi) {
    return { state: initialListen(), action: "advance", heard: heardMidi, hint: repeatHint };
  }
  return { state: initialListen(), action: "wrong", heard: heardMidi, hint: null };
}
