# Rewind — Developer Log

> AI-powered video call analyzer. Extracts keyframes, describes screen content with vision AI, aligns with a timestamped transcript, and synthesizes a narrative summary with inline citations.

---

## The Problem

Every meeting recorder gives you a transcript. But half of what happens in a call is visual — the Figma frame being walked through, the dashboard being pointed at, the slide being discussed. The transcript has no idea those things exist.

Tools like Otter, Fireflies, Fathom, and tl;dv are all transcript-first. Read.ai has some screen analysis but buries it. The gap is a clean, citation-forward UI where you can see **what was on screen when something was said**.

---

## The Stack

Decided upfront, not debated during build:

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Next.js on Vercel | App router, streaming-friendly, free tier |
| Auth + DB | Supabase | Auth + Postgres + Storage in one, generous free limits |
| Heavy processing | Modal (serverless) | Escapes Vercel's 10s timeout, pay-per-second, no idle cost |
| Transcription | Deepgram Nova-2 | Word-level timestamps out of the box, $200 free credit, ~$0.006/min |
| Frame description | Claude Haiku | ~10x cheaper than Sonnet, fast, handles screen content well enough |
| Narrative synthesis | Claude Sonnet | One call at the end where reasoning quality actually matters |
| Frame extraction | ffmpeg via Modal | Industry standard, handles every container format |
| Perceptual dedup | `imagehash` dhash | Fast, runs in-process, no GPU needed |

**Cost per 30-min call: ~$0.23.** Hard cap at 90 minutes per upload.

---

## Architecture Overview

```
Local video file
       │
       ▼
[local_entrypoint]  ← reads file into bytes, passes to Modal
       │
       ├─────────────────────────────────┐
       ▼                                 ▼
[extract_keyframes]              [transcribe_video]
  - ffmpeg at 1fps                - Deepgram Nova-2
  - dhash dedup                   - word-level timestamps
  - 60s floor guarantee           - speaker diarization
  - cap at 80 frames              - 147 utterances
       │                                 │
       └─────────────────┬───────────────┘
                         ▼
              [describe_all_keyframes]
                - Claude Haiku × 80
                - max 5 concurrent (rate limit)
                - 2–4 sentence screen description each
                         │
                         ▼
              [align_transcript_to_keyframes]
                - pure Python, runs locally
                - each utterance → nearest preceding keyframe
                         │
                         ▼
              [synthesize_summary]
                - Claude Sonnet (one call)
                - interleaved screen + transcript context
                - 400–600 word narrative
                - inline citations [42s] [screen@67s]
                         │
                         ▼
                    output.json
```

---

## Weekend 1 — The Processing Pipeline

**Goal:** `modal run pipeline.py --video <file>` → structured `output.json`. No frontend. No database. Just validate the pipeline works.

### What was built

`pipeline/pipeline.py` — five Modal functions:

1. **`extract_keyframes`** — downloads video, runs `ffmpeg` at 1fps, computes dhash on each frame (cropping center 80% first to ignore webcam thumbnails), collapses runs of perceptually identical frames (threshold: dhash diff > 10 = scene change), enforces a 60-second floor so slow document scrolls don't get collapsed entirely, caps at 80 keyframes.

2. **`transcribe_video`** — sends video to Deepgram Nova-2 with speaker diarization, returns word-level timestamps and utterance chunks.

3. **`describe_keyframe`** — sends one JPEG frame to Claude Haiku with a prompt focused on screen content (application type, visible text, UI state). Runs with `max_containers=5` to stay under Anthropic's concurrent connection rate limit.

4. **`describe_all_keyframes`** — orchestrates parallel Haiku calls via Modal's `.map()`.

5. **`synthesize_summary`** — builds a merged context string (screen descriptions interleaved with transcript) and sends it to Claude Sonnet for a 400–600 word narrative with inline timestamp citations.

`extract_keyframes` and `transcribe_video` are spawned in parallel via `.spawn()` — the biggest time save in the pipeline.

Local files are read in `@app.local_entrypoint()` and passed as bytes to Modal, since Modal containers run remotely and can't access the host filesystem.

Two improvements beyond the original plan:
- **Crop before hashing**: trims outer 10% of frame before dhash so webcam thumbnails in meeting recordings don't pollute the scene-change signal
- **60s keyframe floor**: forces at least one keyframe per 60 seconds even through slow document scrolls that never cross the hash threshold

---

### Errors encountered and fixes applied

**Error 1: `python-dotenv` not installed**
```
ImportError: Need the `dotenv` package installed.
```
`modal.Secret.from_dotenv()` requires `python-dotenv` in the local environment (not the Modal container). Added to `requirements.txt` and installed in venv.

---

**Error 2: `ffprobe` is not a separate Debian package**
```
E: Unable to locate package ffprobe
```
`ffprobe` ships inside the `ffmpeg` Debian package — it's not separately installable. Removed `"ffprobe"` from `.apt_install("ffmpeg", "ffprobe")`, leaving just `.apt_install("ffmpeg")`.

---

**Error 3: macOS Downloads folder permission denied**
```
PermissionError: [Errno 1] Operation not permitted: '/Users/VJ/Downloads/...'
```
macOS TCC (Transparency, Consent, and Control) blocks Terminal from reading the Downloads folder by default. Resolved by moving the video file into the project directory (`/Users/VJ/rewind/`) via Finder, which Terminal already has access to.

---

**Error 4: Filename with spaces causing shell newline injection**

The video file was named `Can Microsoft 365 Copilot Really Do All This?.publer.com.mp4`. When the long quoted path was rendered in the chat and run via `!`, the shell inserted a literal newline mid-filename, breaking the path. Renamed the file to `test_video.mp4` to avoid the issue entirely.

---

**Error 5: `deepgram-sdk` v6 removed `PrerecordedOptions`**
```
ImportError: cannot import name 'PrerecordedOptions' from 'deepgram'
```
The locally installed `deepgram-sdk` was v6.1.1, which completely rewrote the API. The code was written for the v3 SDK. Modal's container (running Python 3.9 initially) resolved `deepgram-sdk` to an older version that also lacked `PrerecordedOptions` due to Python version incompatibility.

Two fixes applied together:
- Pinned Modal container to `python_version="3.11"` in `modal.Image.debian_slim(python_version="3.11")`
- Pinned `deepgram-sdk==3.11.0` (the latest v3.x release) in the Modal pip install

---

**Error 6: Anthropic rate limit on concurrent connections**
```
anthropic.RateLimitError: 429 — Number of concurrent connections has exceeded your rate limit
```
The pipeline was spawning all 80 `describe_keyframe` calls simultaneously via `.map()`. The Anthropic API's concurrent connection limit (varies by tier) was exceeded on the very first call, cascading cancellations to all others.

Fix: added `max_containers=5` to the `describe_keyframe` function decorator, capping simultaneous Haiku calls at 5. This adds ~25 seconds to the keyframe description step but stays well within rate limits.

---

### Final successful run

**Test video:** Microsoft 365 Copilot tutorial (22 minutes, 34 MB)

```
=== Rewind Pipeline ===
[1/4] Extracting keyframes + transcribing (parallel)...
      1317 raw frames → 80 keyframes selected
      4135 words, 147 utterances transcribed

[2/4] Describing 80 keyframes with Claude Haiku (parallel, max 5)...

[3/4] Aligning transcript to keyframes...

[4/4] Synthesizing narrative with Claude Sonnet...

Done. Output written to: output.json (602 KB)
```

**Validation:**
- Keyframe timestamps: 0s–964s, even distribution across 22 minutes ✅
- Alignment accuracy: utterance @11s → keyframe@9s (2s drift — within spec) ✅
- Summary quality: correctly identified host name, channel, app being demoed, specific features shown on each screen ✅
- Inline citations present: `[11s]`, `[screen@23s]`, `[screen@30s]` ✅

**Weekend 1 exit criteria — all passed.**

---

## Weekend 2 — Full Stack (coming next)

**Goal:** Visit site → create account → upload video → wait → see formatted summary with keyframe thumbnails and clickable timestamps.

### What will be built

- **Next.js app** on Vercel (app router, TypeScript)
- **Supabase** schema: `analyses` + `keyframes` tables, Row Level Security policies, Storage bucket for keyframe images
- **Upload flow**: signed URL upload directly to Supabase Storage (browser → Supabase, never through Vercel)
- **Trigger flow**: Next.js API route → Modal REST API → pipeline runs asynchronously
- **Status polling**: browser polls `/api/analyses/{id}` every 3s; Modal updates `analyses.status` at each pipeline stage
- **Results UI**: TL;DR banner + narrative text with clickable citation spans + horizontal keyframe strip with thumbnails

### Sub-status progression
`pending` → `extracting_frames` → `transcribing` → `analyzing_screens` → `synthesizing` → `complete`

---

## Weekend 3 — Polish + Launch (planned)

- Error handling: bad format, too long, processing failure, empty transcript
- 3 pre-processed demo recordings (no upload required to see them)
- Mobile layout (`overflow-x: scroll` on keyframe strip)
- Cost validation: verify <$0.50 per analysis
- LinkedIn launch post

---

## Repository Structure

```
rewind/
├── pipeline/
│   ├── pipeline.py          # Modal processing pipeline (Weekend 1 ✅)
│   └── requirements.txt
├── web/                     # Next.js app (Weekend 2 — coming)
├── .env                     # ANTHROPIC_API_KEY, DEEPGRAM_API_KEY (not committed)
├── .env.example
├── .gitignore
└── DEVLOG.md                # this file
```

---

## Running the Pipeline

```bash
# 1. Create and activate venv
python3 -m venv .venv && source .venv/bin/activate

# 2. Install deps
pip install -r pipeline/requirements.txt

# 3. Authenticate with Modal (one-time)
modal setup

# 4. Add API keys to .env
cp .env.example .env
# edit .env with ANTHROPIC_API_KEY and DEEPGRAM_API_KEY

# 5. Run
modal run pipeline/pipeline.py --video /path/to/video.mp4
# Output: output.json in current directory
```

**First run:** ~3 min for Modal container image build (cached forever after).  
**Subsequent runs:** ~5–8 min for a 30-min video.

---

## Key Design Decisions

**Why not self-host Whisper?** Whisper on Modal requires a GPU container — cold starts, higher cost, comparable quality to Deepgram Nova-2 for meeting audio. Deepgram's per-minute pricing ($0.006/min) means a 30-min call costs $0.18 and you get word-level timestamps out of the box.

**Why Haiku for frames, Sonnet only for synthesis?** The frame description task is "what is on this screen?" — a visual lookup, not reasoning. Haiku is 10x cheaper and fast enough to run in parallel. Sonnet is reserved for the one call where coherence and narrative structure matter.

**Why crop before hashing?** Meeting recordings typically have a webcam feed in the corner. The face moves slightly every second, making every frame look "different" to dhash even when the shared screen is identical. Cropping the outer 10% before hashing anchors the comparison to the screen content, not the speaker's head.

**Why a 60-second keyframe floor?** The dhash threshold of 10 works well for screen transitions but gets fooled by slow document scrolls — the delta between consecutive frames is small enough to stay under the threshold, collapsing a 3-minute scroll into a single keyframe. The floor guarantees at least one sample per minute regardless.

**Why pass video bytes through Modal instead of a URL?** For local testing (Weekend 1), files live on the developer's machine. Modal runs remotely and can't access `localhost` or local filesystem paths. The local entrypoint reads the file and passes bytes; Modal receives them via its internal serialization. In production (Weekend 2+), Supabase Storage signed URLs replace this entirely.
