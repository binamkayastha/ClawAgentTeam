#!/usr/bin/env python3
"""Text-to-speech using the local Qwen3-TTS MLX model from LM Studio.

Setup already done in this folder:
  .venv with mlx-audio installed

Examples:
  ./tts.py
  ./tts.py "Hello world" --output hello.wav
  ./tts.py "Hello world" --voice vivian --play
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

MODEL_PATH = Path.home() / ".lmstudio/models/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"
DEFAULT_VOICE = "serena"
SUPPORTED_VOICES = "serena, vivian, uncle_fu, ryan, aiden, ono_anna, sohee, eric, dylan"


def venv_python() -> Path:
    return Path(__file__).resolve().parent / ".venv/bin/python"


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate speech with local Qwen3-TTS.")
    parser.add_argument("text", nargs="?", default="Hello world", help="Text to speak")
    parser.add_argument("--output", "-o", default="hello.wav", help="Output audio path")
    parser.add_argument("--voice", "-v", default=DEFAULT_VOICE, help=f"Voice. Supported: {SUPPORTED_VOICES}")
    parser.add_argument("--play", action="store_true", help="Play the audio after writing it")
    parser.add_argument("--max-tokens", default="512", help="Maximum generation tokens")
    args = parser.parse_args()

    py = venv_python()
    if not py.exists():
        print(f"Missing virtualenv: {py}", file=sys.stderr)
        print("Create it with: python3 -m venv .venv && .venv/bin/pip install mlx-audio", file=sys.stderr)
        return 1

    if not MODEL_PATH.exists():
        print(f"Missing model: {MODEL_PATH}", file=sys.stderr)
        return 1

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    prefix = output.stem
    audio_format = output.suffix.lstrip(".") or "wav"

    generated = output.parent / f"{prefix}_000.{audio_format}"
    if generated.exists():
        generated.unlink()

    command = [
        str(py),
        "-m",
        "mlx_audio.tts.generate",
        "--model",
        str(MODEL_PATH),
        "--text",
        args.text,
        "--output_path",
        str(output.parent),
        "--file_prefix",
        prefix,
        "--audio_format",
        audio_format,
        "--voice",
        args.voice,
        "--max_tokens",
        args.max_tokens,
    ]

    subprocess.run(command, check=True)

    if generated.exists() and generated != output:
        if output.exists():
            output.unlink()
        generated.rename(output)

    print(f"Wrote {output}")

    if args.play:
        subprocess.run(["afplay", str(output)], check=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
