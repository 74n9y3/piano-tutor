declare module "soundfont-player" {
  export interface PlayingNote {
    stop(when?: number): void;
  }

  export interface Instrument {
    play(note: number | string, when?: number, options?: { duration?: number; gain?: number }): PlayingNote;
    stop(when?: number): void;
    context: AudioContext;
  }

  const Soundfont: {
    instrument(
      audioContext: AudioContext,
      name: string,
      options?: {
        format?: string;
        soundfont?: string;
        nameToUrl?: (name: string, soundfont: string, format: string) => string;
      },
    ): Promise<Instrument>;
  };

  export default Soundfont;
}
