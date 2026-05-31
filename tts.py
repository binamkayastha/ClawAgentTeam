#!/usr/bin/env python3
"""Text-to-speech using Qwen3-TTS with MLX.

Examples:
  ./run
  ./run "Hello world" --voice vivian
  ./run "Hello world" --output hello.wav --no-play
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

MODEL_REPO = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"
LM_STUDIO_MODEL_PATH = Path.home() / ".lmstudio/models/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"
DEFAULT_VOICE = "serena"
SUPPORTED_VOICES = "serena, vivian, uncle_fu, ryan, aiden, ono_anna, sohee, eric, dylan"


def venv_python() -> Path:
    return Path(__file__).resolve().parent / ".venv/bin/python"


def resolve_model_path(model: str | None) -> Path:
    if model:
        model_path = Path(model).expanduser()
        if model_path.exists():
            return model_path.resolve()
        repo = model
    elif LM_STUDIO_MODEL_PATH.exists() and (LM_STUDIO_MODEL_PATH / "speech_tokenizer").exists():
        return LM_STUDIO_MODEL_PATH
    else:
        repo = MODEL_REPO

    from huggingface_hub import snapshot_download

    print(f"Downloading/loading model from Hugging Face: {repo}")
    return Path(snapshot_download(
        repo_id=repo,
        allow_patterns=[
            "config.json",
            "generation_config.json",
            "model.safetensors",
            "model.safetensors.index.json",
            "tokenizer_config.json",
            "vocab.json",
            "merges.txt",
            "preprocessor_config.json",
            "speech_tokenizer/*",
        ],
    ))


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate speech with Qwen3-TTS.")
    parser.add_argument("text", nargs="?", default="Hello world", help="Text to speak")
    parser.add_argument("--output", "-o", help="Optional output audio path")
    parser.add_argument("--voice", "-v", default=DEFAULT_VOICE, help=f"Voice. Supported: {SUPPORTED_VOICES}")
    parser.add_argument("--model", help=f"Local model path or Hugging Face repo. Default: LM Studio model if present, else {MODEL_REPO}")
    parser.add_argument("--no-play", action="store_true", help="Do not play audio after generation")
    parser.add_argument("--max-tokens", type=int, default=512, help="Maximum generation tokens")
    args = parser.parse_args()

    py = venv_python()
    venv_dir = Path(__file__).resolve().parent / ".venv"
    if Path(sys.prefix).resolve() != venv_dir.resolve():
        if not py.exists():
            print(f"Missing virtualenv: {py}", file=sys.stderr)
            print("Create it with: python3 -m venv .venv && .venv/bin/pip install mlx-audio", file=sys.stderr)
            return 1
        return subprocess.run([str(py), str(Path(__file__).resolve()), *sys.argv[1:]]).returncode

    # Hide a harmless Transformers architecture warning printed while mlx-audio
    # loads Qwen3-TTS through its own model registry.
    os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")

    import mlx.core as mx
    import numpy as np
    import sounddevice as sd
    from mlx_audio.audio_io import write as audio_write
    from mlx_audio.tts.utils import load_model

    model_path = resolve_model_path(args.model)
    print(f"Loading Qwen3-TTS from {model_path}")
    model = load_model(model_path)

    print(f"Text: {args.text}")
    print(f"Voice: {args.voice}")

    chunks = []
    sample_rate = model.sample_rate
    for result in model.generate(
        text=args.text,
        voice=args.voice,
        lang_code="en",
        max_tokens=args.max_tokens,
        verbose=False,
    ):
        chunks.append(result.audio)
        sample_rate = result.sample_rate

    if not chunks:
        print("No audio generated", file=sys.stderr)
        return 1

    audio = mx.concatenate(chunks, axis=0) if len(chunks) > 1 else chunks[0]
    audio_np = np.asarray(audio, dtype=np.float32)

    if args.output:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        audio_format = output.suffix.lstrip(".") or "wav"
        audio_write(str(output), audio_np, sample_rate, format=audio_format)
        print(f"Wrote {output}")

    if not args.no_play:
        print("Playing audio...")
        sd.play(audio_np, sample_rate)
        sd.wait()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
