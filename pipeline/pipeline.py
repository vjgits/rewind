import modal
import os
import json
import tempfile
import subprocess
from pathlib import Path

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
        "supabase",
        "fastapi",
    )
)

api_secrets = modal.Secret.from_dotenv()


# ---------------------------------------------------------------------------
# Step 1: Extract keyframes + perceptual-hash dedup
# ---------------------------------------------------------------------------

@app.function(image=image, timeout=600, memory=2048, secrets=[api_secrets])
def extract_keyframes(video_url: str = "", video_bytes: bytes = b"") -> dict:
    import urllib.request
    import imagehash
    from PIL import Image

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, "input.mp4")
        frames_dir = os.path.join(tmpdir, "frames")
        os.makedirs(frames_dir)

        if video_bytes:
            with open(video_path, "wb") as f:
                f.write(video_bytes)
        else:
            print("Downloading video...")
            urllib.request.urlretrieve(video_url, video_path)

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

        if duration_seconds > 30 * 60:
            raise ValueError(
                f"Video is {duration_seconds / 60:.0f} min. Maximum supported length is 30 minutes."
            )

        print("Extracting frames at 1fps...")
        subprocess.run(
            [
                "ffmpeg", "-i", video_path,
                "-vf", "fps=1",
                "-q:v", "2",
                f"{frames_dir}/%04d.jpg",
            ],
            check=True,
            capture_output=True,
        )

        frames = []
        for fname in sorted(os.listdir(frames_dir)):
            if not fname.endswith(".jpg"):
                continue
            timestamp = int(fname.replace(".jpg", "")) - 1
            path = os.path.join(frames_dir, fname)
            img = Image.open(path)
            w, h = img.size
            crop_box = (int(w * 0.1), int(h * 0.1), int(w * 0.9), int(h * 0.9))
            frame_hash = imagehash.dhash(img.crop(crop_box), hash_size=8)
            frames.append({"timestamp": timestamp, "path": path, "hash": frame_hash})

        if not frames:
            raise ValueError("No frames extracted — is the video file valid?")

        print(f"Extracted {len(frames)} raw frames. Running dedup...")

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

        # Floor: guarantee at least one keyframe per 60 seconds
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

        if len(scenes) > 80:
            step = len(scenes) // 80
            scenes = scenes[::step][:80]
            for i, s in enumerate(scenes):
                s["scene_index"] = i

        print(f"Selected {len(scenes)} keyframes after dedup.")

        result_keyframes = []
        for scene in scenes:
            with open(scene["path"], "rb") as f:
                result_keyframes.append({
                    "timestamp": scene["timestamp"],
                    "scene_index": scene["scene_index"],
                    "image_bytes": f.read(),
                })

        return {"keyframes": result_keyframes, "duration_s": int(duration_seconds)}


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
        {"word": w.word, "start": w.start, "end": w.end, "speaker": w.speaker}
        for w in channel.words
    ]
    utterances = [
        {"start": u.start, "end": u.end, "speaker": u.speaker, "transcript": u.transcript}
        for u in response.results.utterances
    ]

    print(f"Transcribed {len(words)} words across {len(utterances)} utterances.")
    return {"words": words, "utterances": utterances}


# ---------------------------------------------------------------------------
# Step 2b: Describe each keyframe with Claude Haiku (parallel)
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
# Step 3: Align transcript utterances to nearest preceding keyframe
# ---------------------------------------------------------------------------

def align_transcript_to_keyframes(utterances: list[dict], keyframes: list[dict]) -> list[dict]:
    keyframe_times = [kf["timestamp"] for kf in keyframes]
    aligned = []
    for u in utterances:
        applicable = [t for t in keyframe_times if t <= u["start"]]
        nearest_time = max(applicable) if applicable else keyframe_times[0]
        nearest_kf = next(kf for kf in keyframes if kf["timestamp"] == nearest_time)
        aligned.append({**u, "keyframe_timestamp": nearest_kf["timestamp"], "keyframe_scene_index": nearest_kf["scene_index"]})
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
# Web endpoint: called by Next.js after upload; spawns pipeline asynchronously
# ---------------------------------------------------------------------------

@app.function(image=image, secrets=[api_secrets])
@modal.fastapi_endpoint(method="POST")
def trigger(payload: dict):
    """Receives {analysis_id, video_url} and spawns the pipeline asynchronously."""
    run_pipeline_job.spawn(
        analysis_id=payload["analysis_id"],
        video_url=payload["video_url"],
    )
    return {"status": "started", "analysis_id": payload["analysis_id"]}


# ---------------------------------------------------------------------------
# Main pipeline job: runs in Modal, updates Supabase throughout
# ---------------------------------------------------------------------------

@app.function(image=image, timeout=1800, secrets=[api_secrets])
def run_pipeline_job(analysis_id: str, video_url: str):
    from supabase import create_client as sb_create

    sb = sb_create(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    def set_status(status: str, **extra):
        sb.table("analyses").update({"status": status, **extra}).eq("id", analysis_id).execute()

    try:
        set_status("extracting_frames")

        # Parallel: extract keyframes + transcribe
        kf_call = extract_keyframes.spawn(video_url=video_url)
        tr_call = transcribe_video.spawn(video_url=video_url)

        kf_result = kf_call.get()
        keyframes = kf_result["keyframes"]
        duration_s = kf_result["duration_s"]

        transcript = tr_call.get()

        set_status("analyzing_screens", duration_s=duration_s)

        # Describe keyframes with Claude Haiku
        keyframes_with_descriptions = describe_all_keyframes.remote(keyframes)

        # Upload each keyframe image to Supabase Storage + save DB record
        for kf in keyframes_with_descriptions:
            image_path = f"{analysis_id}/{kf['timestamp']}.jpg"
            sb.storage.from_("keyframes").upload(
                image_path,
                kf["image_bytes"],
                {"content-type": "image/jpeg", "upsert": "true"},
            )
            sb.table("keyframes").insert({
                "analysis_id": analysis_id,
                "timestamp_s": kf["timestamp"],
                "image_path": image_path,
                "description": kf["description"],
            }).execute()

        set_status("synthesizing")

        aligned = align_transcript_to_keyframes(transcript["utterances"], keyframes_with_descriptions)
        summary = synthesize_summary.remote(aligned, keyframes_with_descriptions)

        set_status("complete", summary=summary)
        print(f"Done — analysis {analysis_id} complete.")

        # Delete the original video — keyframes and text are all we need going forward.
        # Wrapped in its own try/except so a storage error never corrupts a completed result.
        try:
            row = sb.table("analyses").select("video_path").eq("id", analysis_id).single().execute()
            video_path = (row.data or {}).get("video_path")
            if video_path:
                sb.storage.from_("videos").remove([video_path])
                sb.table("analyses").update({"video_path": None}).eq("id", analysis_id).execute()
                print(f"Deleted video from storage: {video_path}")
        except Exception as del_err:
            print(f"Warning: could not delete video from storage: {del_err}")

    except Exception as e:
        sb.table("analyses").update({
            "status": "error",
            "error_message": str(e)[:500],
        }).eq("id", analysis_id).execute()
        raise


# ---------------------------------------------------------------------------
# Local entrypoint — for CLI testing: modal run pipeline.py --video <path>
# ---------------------------------------------------------------------------

@app.local_entrypoint()
def main(video: str, output: str = "output.json"):
    print(f"\n=== Rewind Pipeline ===\nInput: {video}\n")

    is_local = not video.startswith("http://") and not video.startswith("https://")
    video_bytes = b""
    if is_local:
        local_path = Path(video).expanduser().resolve()
        if not local_path.exists():
            raise FileNotFoundError(f"File not found: {local_path}")
        size_mb = local_path.stat().st_size / 1_000_000
        print(f"Local file: {local_path.name} ({size_mb:.0f} MB)")
        video_bytes = local_path.read_bytes()
        video_url = ""
    else:
        video_url = video

    print("[1/4] Extracting keyframes + transcribing (parallel)...")
    keyframes_call = extract_keyframes.spawn(video_url=video_url, video_bytes=video_bytes)
    transcript_call = transcribe_video.spawn(video_url=video_url, video_bytes=video_bytes)

    kf_result = keyframes_call.get()
    keyframes = kf_result["keyframes"]
    transcript = transcript_call.get()

    print(f"      {len(keyframes)} keyframes, {len(transcript['utterances'])} utterances\n")

    print("[2/4] Describing keyframes with Claude Haiku (parallel)...")
    keyframes_with_descriptions = describe_all_keyframes.remote(keyframes)

    print("[3/4] Aligning transcript to keyframes...")
    aligned = align_transcript_to_keyframes(transcript["utterances"], keyframes_with_descriptions)

    print("[4/4] Synthesizing narrative summary with Claude Sonnet...")
    summary = synthesize_summary.remote(aligned, keyframes_with_descriptions)

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
    print(f"\n--- Summary preview ---\n{summary[:600]}\n...")
