# Piano Tutor · 钢琴陪练

**English** | [中文](README.zh-CN.md)

A piano practice helper that runs entirely on your own computer: import the sheet music your teacher sent, listen to it first, play along, then let it point out the wrong notes.

![Library](docs/images/library-en.png)

![Practice page: playing "Scarborough Fair" next to the original photo](docs/images/practice-en.png)

**In short:** it runs completely locally, so your pieces and recordings never leave your computer; it can turn a photo of sheet music into a playable score; and the interface is available in English and Chinese.

## Features

**Library**

- Search titles and filter by source (All / Score / Photo / MIDI / Improv).
- Add, rename, delete, export as MusicXML, and open a piece's folder in Finder.

**Import**

- MusicXML (`.musicxml` / `.xml`).
- MIDI (`.mid`), automatically converted to staff notation.
- Photo recognition (OMR): up to 12 pages at once. Reorder them by dragging or with Move up / Move down, and they are joined into one piece with continuous measure numbers. If one page comes out wrong, you can redo just that page or replace its photo. Recognition uses [homr](https://github.com/liebharc/homr), run through `uvx` in its own environment.
- **Improvise**: play anything at the piano (up to 3 minutes); when you stop, it is written out as a score.

**Practice**

- Scores are rendered with OpenSheetMusicDisplay and played back with a built-in piano sound. You can change the tempo, choose a range of measures, and zoom.
- Numbered notation (Jianpu) toggle: the numbers are shown under each line of the staff.
- An 88-key keyboard lights up the keys being played: blue for the right hand, orange for the left.
- **Follow** (play-along): listens through the microphone one note at a time and only moves on when you play the right note. You can also tap the on-screen keys or use your computer keyboard.
- **Check a recording**: record a whole passage of the selected measures; it is transcribed in the background, and wrong notes, missed notes, and unsteady rhythm are marked on the score.
- **How to read this**: explains the clefs, key signature, time signature, tempo, note values, and common markings of the piece in plain language.
- **Circle a marking**: draw a box on the score to learn what the markings inside mean and how to play them. Clicking a note that has a marking explains it too. Every explanation is kept under "Markings you asked about".
- **Show the photo**: for pieces imported from photos, view the original image side by side with the score.
- Simple editing: click a note to **Raise a semitone** or **Lower a semitone**, change its duration (Whole, Half, Quarter, Eighth), or **Remove** it. Click the title on the score to rename the piece.

## Requirements

- macOS ("Open folder" uses the macOS `open` command)
- Python 3.12
- Node.js (to build the frontend; `tests/follow.test.ts` needs a Node version that runs `.ts` files directly, 22.18 or later)
- [uv](https://docs.astral.sh/uv/) (provides `uvx`, needed for photo recognition)

## Install and run

```bash
cd piano-tutor

# 1. Python environment
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
# Check a recording and Improvise need the piano transcription package (includes torch, fairly large)
.venv/bin/pip install -r requirements-ml.txt

# 2. Frontend
cd frontend
npm install
npm run build
cd ..

# 3. Start
MPLCONFIGDIR=.mpl .venv/bin/python -m backend
```

Then open <http://127.0.0.1:8765/> in your browser.

Without `requirements-ml.txt` you can still import, view, and play back scores; only Check a recording and Improvise are unavailable.

## Usage

**Language**

Click the globe icon on the right of the top bar and choose **中文** or **English**. Until you choose, the app follows your browser: Chinese if the browser language is Chinese, English otherwise. Your choice is remembered in this browser. AI answers follow the interface language too.

**Import a piece**

1. In the library, click **Add a piece** in the top right.
2. Pick a method:
   - **MusicXML / MIDI**: choose a file and you can start practicing right away.
   - **Photo or score image**: you can choose several pages at once; put them in order (drag, or **Move up** / **Move down**), then click **Start reading**. Progress is shown in the library. For best results, take photos flat and evenly lit, with the staves filling the frame.
   - **Improvise**: put the computer near the piano, play, then click **Stop and write the score**.

**Practice**

- Click a title to open the practice page. Click **Play** to listen; drag the **Tempo** slider to slow down; click **Measures x–y** to practice only certain measures.
- In the top right, `#` toggles numbered notation (Jianpu), the book icon opens **How to read this**, and the **More** menu (**⋯**) has **Circle a marking**, **Show the photo**, **Clear marks**, **Manage pages**, **Export**, **Open folder**, and **Delete**.

**Follow (play-along)**

- Choose the measures, click **Follow**, and play one note at a time at the piano. A banner tells you which note to play, and the note is also highlighted on the score and the keyboard. It moves on only when it hears the right note; if you play a wrong one, it tells you which note it heard. Notes of a chord are checked one at a time.
- You can play along without a real piano or a microphone: tap the on-screen keys, or use your computer keyboard. The layout starts at middle C by default:

  | Computer key | A | W | S | E | D | F | T | G | Y | H | U | J | K |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Note | C | C♯ | D | D♯ | E | F | F♯ | G | G♯ | A | A♯ | B | C (octave up) |

  `Z` / `X` shift down / up an octave. These keys and the on-screen keys also make sound when Follow is off.
- The microphone can stay on at the same time: after you tap or press a key, the microphone is ignored for a moment so the speaker's sound isn't mistaken for your playing. Without microphone permission, Follow still works.

**Check a recording**

- Choose the measures, click **Check a recording**, play those measures all the way through, then click stop.
- After a short wait, wrong notes, missed notes, and unsteady rhythm are marked on the score, following the legend. Use **More → Clear marks** to remove them.

**Simple edits**

- Click a note to **Raise a semitone** / **Lower a semitone**, change its duration, or **Remove** it. Changes are saved straight to the piece's `score.musicxml`.

**Detailed editing with MuseScore**

This app only handles the simple edits above. For detailed editing, such as adding or removing measures, changing key or time signatures, fixing slurs, ties, and expression markings, correcting large recognition errors, or rearranging voices, we recommend the free [MuseScore](https://musescore.org):

1. Click **Export** from the **⋯** next to a title in the library, or from the **More** menu on the practice page. You get a `.musicxml` file (uncompressed MusicXML). Alternatively, click **Open folder** and use the `score.musicxml` inside.
2. Open the file in MuseScore and edit it.
3. In MuseScore, choose **File → Export**, pick MusicXML, and select uncompressed `.musicxml`. This app only imports `.musicxml` and `.xml`; compressed `.mxl` is not supported.
4. Back in the library, import it with **Add a piece → MusicXML**.

Notes:

- There is no "replace score" feature, so re-importing creates a new piece. The original photos (Show the photo), the markings you asked about, and recording-check history do not carry over.
- Once you're happy with the new piece, you can delete the old one.

**Microphone permission**

Browsers only allow microphone access on secure addresses. Open the app at `http://127.0.0.1:8765/`. If you open it via a LAN IP (for example `http://192.168.x.x:8765/`), Check a recording, Improvise, and listening during Follow won't work; Follow will only accept on-screen keys or the computer keyboard.

## Configuration

The language model is only used for **Circle a marking** and for explaining markings when you click a note (**Explain with AI**). Settings go in a `.env` file in the project root, which is not committed to git.

```bash
cp .env.example .env
```

Then edit `.env`:

| Variable | Description |
| --- | --- |
| `PIANO_AI_API_KEY` | API key for the language model. If empty, only the explanations the app reads from the score are shown and nothing goes online. |
| `PIANO_AI_BASE_URL` | Base URL of an OpenAI-compatible `/chat/completions` API. |
| `PIANO_AI_MODEL` | Model name. |

For example, with DeepSeek:

```bash
PIANO_AI_API_KEY=<your API key>
PIANO_AI_BASE_URL=https://api.deepseek.com/v1
PIANO_AI_MODEL=deepseek-chat
```

Variables with the same names already exported in your environment take precedence over `.env`. Settings from older versions in `data/config.json` are still read; if the same setting has a value in `.env`, `.env` wins.

Note: the markings are identified by the app from the score itself. Only a text description of those marks is sent to the model, never images, so an ordinary chat model is enough. Don't commit `.env`.

## Data storage

All data stays on this computer in the `data/` directory (set the `PIANO_DATA` environment variable to use another location):

```text
data/
├── models/                  # Piano transcription model weights, downloaded automatically if missing (about 170 MB)
└── pieces/
    └── <piece id>/
        ├── meta.json        # Title, source, status, per-page recognition progress
        ├── score.musicxml   # The current score (overwritten when edited)
        ├── pages/           # Photo imports: 001.png, 001.musicxml, … one set per page
        ├── improv.wav       # Original improv recording
        ├── takes/           # Recording checks: each take's .wav and analysis .json
        └── asks.json        # Markings you asked about (up to 40)
```

Deleting a piece removes its whole `<piece id>/` directory.

## FAQ

**What if recognition gets a lot wrong?**

For a few mistakes, click the notes on the practice page and fix them there. For many mistakes, export the score, fix it in MuseScore, and import it again; see "Detailed editing with MuseScore" above.

**Why is the first photo recognition so slow?**

On the first run, `uvx` has to set up a Python 3.12 environment for homr, and homr downloads its recognition models from GitHub (about 180 MB). The models are stored inside the homr package in the uv cache (`$(uv cache dir)/archive-v0/<hash>/lib/python3.12/site-packages/homr/`) and are not downloaded again.

Later recognitions still take a while: each page starts a new homr process, which loads the models into memory again before recognizing. It is not downloading them again. Multiple pages are recognized one after another; a single page is abandoned after 20 minutes.

The models are downloaded once more after you clear the uv cache (`uv cache clean`) or after homr is upgraded.

**Why does the first recording check take so long?**

The first time, the piano transcription model is downloaded from Zenodo into `data/models/`. If the download fails you'll see a message; just record again.

**I changed the frontend code but the page didn't change?**

The backend serves `frontend/dist/` directly, so rebuild after frontend changes:

```bash
cd frontend && npm run build
```

Then refresh the browser.

**The page only says the interface hasn't been built?**

Same as above: run `npm install` and `npm run build` in the `frontend` directory.

## Development

**Tests**

```bash
.venv/bin/python -m pytest
node tests/follow.test.ts
```

**Frontend development**

```bash
cd frontend
npm run dev      # http://127.0.0.1:5173/, proxies /api to 127.0.0.1:8765; start the backend first
npm run build    # Type-checks and builds into frontend/dist/
```

Frontend: Vite + TypeScript, OpenSheetMusicDisplay (score rendering), soundfont-player (piano sound; samples in `frontend/public/soundfonts/`), pitchy (pitch detection for play-along), Tailwind CSS 4 + daisyUI.

Backend: FastAPI + music21, homr for recognition, piano-transcription-inference for transcription.

**Project layout**

```text
piano-tutor/
├── backend/
│   ├── __main__.py      # Entry point: python -m backend, listens on 127.0.0.1:8765
│   ├── main.py          # HTTP API; also serves the frontend/dist pages
│   ├── store.py         # Library: import, recognition jobs, editing, recording checks
│   ├── omr.py           # Runs homr for photo recognition
│   ├── pages.py         # Joins multi-page recognition results into one piece
│   ├── midi_score.py    # MIDI to score
│   ├── transcribe.py    # Piano recording transcription; downloads the model automatically
│   ├── notate.py        # Writes transcribed notes as a score (Improvise)
│   ├── align.py         # Check a recording: compares the score with the performance
│   ├── score_ops.py     # MusicXML read/write, note IDs, editing
│   ├── explain.py       # "How to read this" and marking explanations
│   ├── vision.py        # Reads settings and calls the language model to explain markings
│   └── paths.py         # Paths such as data/
├── frontend/
│   ├── index.html
│   ├── src/             # main.ts, score.ts, keyboard.ts, audio.ts, pitch.ts, follow.ts, …
│   └── public/soundfonts/
├── tests/               # pytest tests and follow.test.ts
├── .env.example         # Language model settings template (copy to .env and fill in; don't commit .env)
├── data/                # Local data (see above)
├── requirements.txt
└── requirements-ml.txt
```

---

<div align="center">
<h3>☕ Buy me a coffee</h3>
<p>This app is free. If it has helped a child practice piano, tips in <strong>USDT</strong> are warmly appreciated.<br/>
<sub>Please double-check the chain and network before sending; funds sent on the wrong network cannot be credited.</sub></p>
<p>
  <img alt="BSC USDT" src="https://img.shields.io/badge/BSC-USDT%20BEP--20-F3BA2F?style=for-the-badge&logo=binance&logoColor=white" />
  <img alt="Solana USDT" src="https://img.shields.io/badge/Solana-USDT-9945FF?style=for-the-badge&logo=solana&logoColor=white" />
  <img alt="Tron USDT" src="https://img.shields.io/badge/Tron-USDT%20TRC--20-FF060A?style=for-the-badge&logo=tron&logoColor=white" />
</p>
</div>

| Network | Address |
|:-----|:---------|
| ![BSC](https://img.shields.io/badge/BSC-F3BA2F?style=flat-square&logo=binance&logoColor=white) **USDT · BEP-20** | `0x6E7359A42C466893E9A835fD6aFdb82E0D1Ed32d` |
| ![Solana](https://img.shields.io/badge/Solana-9945FF?style=flat-square&logo=solana&logoColor=white) **USDT** | `Hm7f6wGdvcmLmbcXV7sdLYGJKBdwGoFrJTZPzeN8dpan` |
| ![Tron](https://img.shields.io/badge/Tron-FF060A?style=flat-square&logo=tron&logoColor=white) **USDT · TRC-20** | `TGNrpZBqD8jnfNCb7B9W93qMmVHycoFsKJ` |
