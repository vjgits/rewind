import modal
import os
import json
import tempfile
import subprocess
from pathlib import Path

# Local files are read in the local_entrypoint and passed as bytes to Modal,
# since Modal containers run remotely and cannot access the host filesystem.

app = modal.App("rewind-pipeline")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "ffmpeg-python",
        "imagehash",
        "Pillow",
        "numpy",
        "anthropic",
        "deepgram-sdk==3.11.0",
        "httpx",
    )
)

api_secrets = modal.Secret.from_dotenv()


# ---------------------------------------------------------------------------
# Step 1: Extract keyframes + perceptual-hash dedup
# ---------------------------------------------------------------------------

@app.function(image=image, timeout=600, memory=2048, secrets=[api_secrets])
def extract_keyframes(video_url: str = "", video_bytes: bytes = b"") -> list[dict]:
    import urllib.request
    import imagehash
    from PIL import Image

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, "input.mp4")
        frames_dir = os.path.join(tmpdir, "frames")
        os.makedirs(frames_dir)

        if video_bytes:
            print("Writing uploaded video bytes to disk...")
            with open(video_path, "wb") as f:
                f.write(video_bytes)
        else:
            print("Downloading video...")
            urllib.request.urlretrieve(video_url, video_path)

        # Validate duration before doing any expensive work
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            capture_output=True, text=True, check=True,
        )
        duration_seconds = float(probe.stdout.strip())
        print(f"Video duration: {duration_seconds / 60:.1f} min")

        if duration_seconds > 90 * 60:
            raise ValueError(
                f"Video is {duration_seconds / 60:.0f} min. Maximum supported length is 90 minutes."
            )

        print("Extracting frames at 1fps...")
        subprocess.run(
            [
                "ffmpeg", "-i", video_path,
                "-vf", "fps=1",
                "-q:v", "2",   # highest JPEG quality — helps vision model read small text
                f"{frames_dir}/%04d.jpg",
            ],
            check=True,
            capture_output=True,
        )

        # Build frame list with perceptual hashes
        frames = []
        for fname in sorted(os.listdir(frames_dir)):
            if not fname.endswith(".jpg"):
                continue
            # ffmpeg numbers from 0001, so subtract 1 for 0-indexed seconds
            timestamp = int(fname.replace(".jpg", "")) - 1
            path = os.path.join(frames_dir, fname)
            img = Image.open(path)
            w, h = img.size
            # Crop center 80% before hashing to ignore webcam thumbnail noise
            crop_box = (int(w * 0.1), int(h * 0.1), int(w * 0.9), int(h * 0.9))
            frame_hash = imagehash.dhash(img.crop(crop_box), hash_size=8)
            frames.append({"timestamp": timestamp, "path": path, "hash": frame_hash})

        if not frames:
            raise ValueError("No frames extracted — is the video file valid?")

        print(f"Extracted {len(frames)} raw frames. Running dedup...")

        # Collapse runs of perceptually identical frames.
        # dhash diff > 10 = scene change; keep the first frame of each scene.
        scenes = []
        current_scene_start = 0
        prev_hash = frames[0]["hash"]

        for i, frame in enumerate(frames[1:], 1):
            if (frame["hash"] - prev_hash) > 10:
                scenes.append({
                    "timestamp": frames[current_scene_start]["timestamp"],
                    "path": frames[current_scene_start]["path"],
                    "scene_index": len(scenes),
                })
                current_scene_start = i
            prev_hash = frame["hash"]

        scenes.append({
            "timestamp": frames[current_scene_start]["timestamp"],
            "path": frames[current_scene_start]["path"],
            "scene_index": len(scenes),
        })

        # Floor: guarantee at least one keyframe per 60 seconds even through
        # slow scrolls that defeat the dedup threshold.
        existing_timestamps = {s["timestamp"] for s in scenes}
        last_ts = frames[-1]["timestamp"]
        for floor_ts in range(0, last_ts + 1, 60):
            if floor_ts not in existing_timestamps:
                closest = min(frames, key=lambda f, t=floor_ts: abs(f["timestamp"] - t))
                if closest["timestamp"] not in existing_timestamps:
                    scenes.append({
                        "timestamp": closest["timestamp"],
                        "path": closest["path"],
                        "scene_index": -1,
                    })
                    existing_timestamps.add(closest["timestamp"])

        scenes.sort(key=lambda s: s["timestamp"])
        for i, s in enumerate(scenes):
            s["scene_index"] = i

        # Hard cap — keeps Haiku cost bounded
        if len(scenes) > 80:
            step = len(scenes) // 80
            scenes = scenes[::step][:80]
            for i, s in enumerate(scenes):
                s["scene_index"] = i

        print(f"Selected {len(scenes)} keyframes after dedup.")

        # Read bytes now — they won't survive the tmpdir cleanup otherwise
        result = []
        for scene in scenes:
            with open(scene["path"], "rb") as f:
                result.append({
                    "timestamp": scene["timestamp"],
                    "scene_index": scene["scene_index"],
                    "image_bytes": f.read(),
                })

        return result


# ---------------------------------------------------------------------------
# Step 2a: Transcribe audio via Deepgram Nova-2
# ---------------------------------------------------------------------------

@app.function(image=image, timeout=300, secrets=[api_secrets])
def transcribe_video(video_url: str = "", video_bytes: bytes = b"") -> dict:
    import io
    from deepgram import DeepgramClient, PrerecordedOptions

    print("Transcribing with Deepgram Nova-2...")
    client = DeepgramClient(os.environ["DEEPGRAM_API_KEY"])
    options = PrerecordedOptions(
        model="nova-2",
        smart_format=True,
        utterances=True,
        punctuate=True,
        diarize=True,
    )
    if video_bytes:
        source = {"buffer": io.BytesIO(video_bytes), "mimetype": "video/mp4"}
        response = client.listen.rest.v("1").transcribe_file(source, options)
    else:
        response = client.listen.rest.v("1").transcribe_url({"url": video_url}, options)

    channel = response.results.channels[0].alternatives[0]
    words = [
        {
            "word": w.word,
            "start": w.start,
            "end": w.end,
            "speaker": w.speaker,
        }
        for w in channel.words
    ]

    utterances = [
        {
            "start": u.start,
            "end": u.end,
            "speaker": u.speaker,
            "transcript": u.transcript,
        }
        for u in response.results.utterances
    ]

    print(f"Transcribed {len(words)} words across {len(utterances)} utterances.")
    return {"words": words, "utterances": utterances}


# ---------------------------------------------------------------------------
# Step 2b: Describe each keyframe with Claude Haiku (run in parallel)
# ---------------------------------------------------------------------------

@app.function(image=image, timeout=60, secrets=[api_secrets], max_containers=5)
def describe_keyframe(image_bytes: bytes, timestamp: int) -> str:
    import anthropic
    import base64

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": base64.standard_b64encode(image_bytes).decode("utf-8"),
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "You are analyzing a frame from a recorded video call.\n"
                            "Describe what is visible on screen in 2–4 sentences. Be specific about:\n"
                            "- What application or content is shown (Figma, slides, code, dashboard, browser, terminal, etc.)\n"
                            "- What specific content is visible (slide title, function name, chart type, UI component, etc.)\n"
                            "- Any notable actions (cursor location, highlighted section, annotation)\n"
                            "If text is too small to read clearly, say so rather than guessing.\n"
                            "Do not describe the speaker's face or video feed — focus on screen content only."
                        ),
                    },
                ],
            }
        ],
    )
    return response.content[0].text


@app.function(image=image, timeout=600, secrets=[api_secrets])
def describe_all_keyframes(keyframes: list[dict]) -> list[dict]:
    print(f"Describing {len(keyframes)} keyframes in parallel with Claude Haiku...")
    descriptions = list(
        describe_keyframe.map(
            [kf["image_bytes"] for kf in keyframes],
            [kf["timestamp"] for kf in keyframes],
        )
    )
    return [{**kf, "description": desc} for kf, desc in zip(keyframes, descriptions)]


# ---------------------------------------------------------------------------
# Step 3: Align transcript utterances to the nearest preceding keyframe
# ---------------------------------------------------------------------------

def align_transcript_to_keyframes(utterances: list[dict], keyframes: list[dict]) -> list[dict]:
    keyframe_times = [kf["timestamp"] for kf in keyframes]
    aligned = []

    for u in utterances:
        # Latest keyframe that started at or before this utterance began
        applicable = [t for t in keyframe_times if t <= u["start"]]
        nearest_time = max(applicable) if applicable else keyframe_times[0]
        nearest_kf = next(kf for kf in keyframes if kf["timestamp"] == nearest_time)
        aligned.append({
            **u,
            "keyframe_timestamp": nearest_kf["timestamp"],
            "keyframe_scene_index": nearest_kf["scene_index"],
        })

    return aligned


# ---------------------------------------------------------------------------
# Step 4: Synthesize narrative summary with Claude Sonnet
# ---------------------------------------------------------------------------

@app.function(image=image, timeout=120, secrets=[api_secrets])
def synthesize_summary(aligned_transcript: list[dict], keyframes: list[dict]) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    context_parts = []
    current_scene = -1

    for segment in aligned_transcript:
        if segment["keyframe_scene_index"] != current_scene:
            current_scene = segment["keyframe_scene_index"]
            kf = next(k for k in keyframes if k["scene_index"] == current_scene)
            context_parts.append(f"\n[{kf['timestamp']}s — Screen: {kf['description']}]\n")
        context_parts.append(
            f"[{segment['start']:.0f}s] Speaker {segment.get('speaker', '?')}: {segment['transcript']}"
        )

    full_context = "\n".join(context_parts)

    print("Synthesizing narrative with Claude Sonnet...")
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1500,
        messages=[
            {
                "role": "user",
                "content": (
                    "You are summarizing a recorded video call. Below is a combined log of what was on "
                    "screen and what was said, with timestamps.\n\n"
                    "Write a clear narrative summary (400–600 words) that:\n"
                    "1. Opens with a 1-sentence TL;DR of the meeting's purpose and outcome\n"
                    "2. Covers the key topics discussed in order, noting what was on screen when relevant\n"
                    "3. Highlights any decisions made, action items assigned, or open questions\n"
                    "4. Uses inline timestamp citations like [42s] and [screen@67s] to reference moments\n\n"
                    "Format: Short paragraphs. No bullet lists. Write for someone who needs to understand "
                    "what happened without watching the recording.\n\n"
                    f"--- MEETING LOG ---\n{full_context}\n--- END LOG ---"
                ),
            }
        ],
    )
    return response.content[0].text


# ---------------------------------------------------------------------------
# Local entrypoint — run with: modal run pipeline.py --video <url>
# ---------------------------------------------------------------------------

@app.local_entrypoint()
def main(video: str, output: str = "output.json"):
    print(f"\n=== Rewind Pipeline ===")
    print(f"Input: {video}\n")

    # Detect local file vs URL. Modal runs remotely so we read local files
    # here (in the local_entrypoint) and pass bytes to the remote functions.
    is_local = not video.startswith("http://") and not video.startswith("https://")
    video_bytes = b""
    if is_local:
        local_path = Path(video).expanduser().resolve()
        if not local_path.exists():
            raise FileNotFoundError(f"File not found: {local_path}")
        size_mb = local_path.stat().st_size / 1_000_000
        print(f"Local file: {local_path.name} ({size_mb:.0f} MB)")
        print("Reading file into memory to transfer to Modal...")
        video_bytes = local_path.read_bytes()
        video_url = ""
    else:
        video_url = video

    # Frame extraction and transcription run in parallel — biggest time saver
    print("\n[1/4] Extracting keyframes + transcribing (parallel)...")
    keyframes_call = extract_keyframes.spawn(video_url=video_url, video_bytes=video_bytes)
    transcript_call = transcribe_video.spawn(video_url=video_url, video_bytes=video_bytes)

    keyframes = keyframes_call.get()
    transcript = transcript_call.get()

    print(f"      {len(keyframes)} keyframes, {len(transcript['utterances'])} utterances\n")

    print("[2/4] Describing keyframes with Claude Haiku (parallel)...")
    keyframes_with_descriptions = describe_all_keyframes.remote(keyframes)

    print("[3/4] Aligning transcript to keyframes...")
    aligned = align_transcript_to_keyframes(transcript["utterances"], keyframes_with_descriptions)

    print("[4/4] Synthesizing narrative summary with Claude Sonnet...")
    summary = synthesize_summary.remote(aligned, keyframes_with_descriptions)

    # Strip binary image_bytes before serializing — not useful in JSON output
    serializable_keyframes = [
        {k: v for k, v in kf.items() if k != "image_bytes"}
        for kf in keyframes_with_descriptions
    ]

    result = {
        "summary": summary,
        "keyframes": serializable_keyframes,
        "transcript": transcript,
        "aligned_segments": aligned,
    }

    output_path = Path(output)
    output_path.write_text(json.dumps(result, indent=2))

    print(f"\nDone. Output written to: {output_path.resolve()}")
    print(f"Keyframes: {len(serializable_keyframes)}")
    print(f"Utterances: {len(transcript['utterances'])}")
    print(f"\n--- Summary preview ---\n{summary[:600]}\n...")
