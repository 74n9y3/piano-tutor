import Soundfont, { type Instrument } from "soundfont-player";
import { PitchDetector } from "pitchy";
import { stableMidi } from "./pitch";
import type { NoteHead } from "./types";

let pianoPromise: Promise<Instrument> | null = null;

export function loadPiano(): Promise<Instrument> {
  if (!pianoPromise) {
    const context = new AudioContext();
    void context.resume();
    pianoPromise = Soundfont.instrument(context, "acoustic_grand_piano", {
      format: "mp3",
      soundfont: "MusyngKite",
      nameToUrl: (name, _soundfont, format) => `/soundfonts/${name}-${format}.js`,
    }).catch((error: unknown) => {
      pianoPromise = null;
      throw error;
    });
  }
  return pianoPromise;
}

export async function playMidi(midi: number): Promise<void> {
  const instrument = await loadPiano();
  const context = instrument.context;
  if (context.state === "suspended") await context.resume();
  instrument.play(midi, context.currentTime, { duration: 0.7, gain: 0.8 });
}

export class Player {
  private nodes: Array<{ stop: (when?: number) => void }> = [];
  private frame = 0;
  playing = false;

  constructor(private instrument: Instrument) {}

  async play(
    notes: NoteHead[],
    bpm: number,
    speed: number,
    onActive: (ids: string[]) => void,
  ): Promise<void> {
    this.stop();
    const attacks = notes.filter((note) => note.attack);
    if (!attacks.length) return;
    const context = this.instrument.context;
    if (context.state === "suspended") await context.resume();
    const secondsPerQuarter = 60 / (bpm * speed);
    const origin = Math.min(...attacks.map((note) => note.offset));
    const begin = context.currentTime + 0.12;
    this.playing = true;
    for (const note of attacks) {
      const when = begin + (note.offset - origin) * secondsPerQuarter;
      const duration = Math.max(0.16, note.quarterLength * secondsPerQuarter * 0.92);
      this.nodes.push(this.instrument.play(note.midi, when, { duration, gain: 0.82 }));
    }
    const end = Math.max(...attacks.map((note) => (note.offset - origin + note.quarterLength) * secondsPerQuarter));
    const started = performance.now();
    const tick = () => {
      if (!this.playing) return;
      const elapsed = (performance.now() - started) / 1000 - 0.12;
      const ids = attacks
        .filter((note) => {
          const on = (note.offset - origin) * secondsPerQuarter;
          return elapsed >= on && elapsed < on + note.quarterLength * secondsPerQuarter;
        })
        .map((note) => note.id);
      onActive(ids);
      if (elapsed < end + 0.05) this.frame = requestAnimationFrame(tick);
      else this.finish(onActive);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    this.playing = false;
    cancelAnimationFrame(this.frame);
    for (const node of this.nodes) node.stop();
    this.nodes = [];
  }

  private finish(onActive: (ids: string[]) => void): void {
    this.playing = false;
    onActive([]);
  }
}

export class PitchListener {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private timer = 0;

  async start(onMidi: (midi: number | null) => void): Promise<void> {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(this.stream);
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const detector = PitchDetector.forFloat32Array(analyser.fftSize);
    const buffer = new Float32Array(analyser.fftSize);
    const sampleRate = this.context.sampleRate;
    const tick = () => {
      if (!this.context) return;
      analyser.getFloatTimeDomainData(buffer);
      const [hz, clarity] = detector.findPitch(buffer, sampleRate);
      onMidi(stableMidi(hz, clarity));
      this.timer = window.setTimeout(tick, 50);
    };
    tick();
  }

  stop(): void {
    window.clearTimeout(this.timer);
    this.context?.close();
    this.context = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

export class TakeRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = 48000;

  async start(): Promise<void> {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.context = new AudioContext();
    this.sampleRate = this.context.sampleRate;
    const source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.processor.onaudioprocess = (event) => {
      this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    const silent = this.context.createGain();
    silent.gain.value = 0;
    source.connect(this.processor);
    this.processor.connect(silent);
    silent.connect(this.context.destination);
  }

  stop(): Blob {
    const blob = encodeWav(this.chunks, this.sampleRate);
    this.processor?.disconnect();
    this.context?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.processor = null;
    this.context = null;
    this.stream = null;
    this.chunks = [];
    return blob;
  }
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeText(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(view, 8, "WAVE");
  writeText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  let index = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(index, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    index += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeText(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
