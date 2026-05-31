# Qwen TTS Local

One-command local text-to-speech using Qwen3-TTS on Apple Silicon macOS.

## Requirements

- Apple Silicon Mac
- Python 3.11+
- Speakers/audio output

## Quick start

```bash
git clone <this-repo>
cd agi-hack
./run "Hello world" --voice ryan
```

`./run` will:

1. create `.venv` if needed
2. install Python dependencies
3. download/cache the Qwen3-TTS MLX model from Hugging Face if it is not already available through LM Studio
4. generate and play audio directly from Python

## Examples

Play speech:

```bash
./run "Hello world"
```

Use a different voice:

```bash
./run "Hello. This is Ryan." --voice ryan
```

Save to a file without playing:

```bash
./run "Hello world" --output hello.wav --no-play
```

Use an explicit model path or repo:

```bash
./run "Hello world" --model mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit
```

## Voices

```text
serena, vivian, uncle_fu, ryan, aiden, ono_anna, sohee, eric, dylan
```

## Linux/Windows

The current working backend uses MLX, which is Apple Silicon/macOS focused.
See:

```text
feature-gaps/windows-and-linux-support
```

for findings on the official `qwen-tts` PyTorch route for Linux/Windows.
