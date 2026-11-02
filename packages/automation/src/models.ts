/** Quality text model, installed by the qwen-quality setup profile (docs/AI_MODEL_DECISIONS.md). Change only with bake-off evidence. */
export const QUALITY_MODEL_TAG = "gemma4:31b";

export const MODEL_CATALOG = [
  { id: "qwen3.5-9b", name: "Qwen3.5-9B", task: "Script / Vision / Translation · verify on this machine", languages: "VI / EN tested; vision / ZH require benchmarks", license: "Apache-2.0", source: "https://huggingface.co/Qwen/Qwen3.5-9B", status: "IMPLEMENTED_UNVERIFIED" },
  { id: "qwen-quality", name: "Gemma 4 31B (quality text)", task: "Final scripts, translation, fact reasoning, judging, vision · CPU, about 20 GB RAM", languages: "VI / EN measured on a small bake-off; ZH unverified", license: "Apache-2.0", source: "https://huggingface.co/google/gemma-4-31B-it", status: "IMPLEMENTED_UNVERIFIED" },
  { id: "vieneu", name: "VieNeu-TTS v3 Turbo", task: "Vietnamese narration", languages: "VI", license: "Checkpoint audit required", source: "https://github.com/pnnbao97/VieNeu-TTS", status: "IMPLEMENTED_UNVERIFIED" },
  { id: "kokoro", name: "Kokoro-82M", task: "English narration", languages: "EN-US / EN-GB", license: "Apache-2.0", source: "https://huggingface.co/hexgrad/Kokoro-82M", status: "IMPLEMENTED_UNVERIFIED" },
  { id: "chatterbox", name: "Chatterbox / Turbo", task: "Expressive English narration", languages: "EN", license: "MIT; voice provenance required", source: "https://github.com/resemble-ai/chatterbox", status: "NOT_IMPLEMENTED" },
  { id: "qwen-asr", name: "Qwen3-ASR-1.7B", task: "Transcription / narration QA (local engine required)", languages: "VI / EN fixtures; one ZH sample tested, broad WER unverified", license: "Apache-2.0", source: "https://huggingface.co/Qwen/Qwen3-ASR-1.7B", status: "IMPLEMENTED_UNVERIFIED" },
  { id: "embedding", name: "Qwen3-Embedding-0.6B", task: "Derived local script search; not truth/rights/originality certification", languages: "VI / EN require local validation", license: "Apache-2.0; pinned model card", source: "https://huggingface.co/Qwen/Qwen3-Embedding-0.6B", status: "IMPLEMENTED_UNVERIFIED" },
  { id: "flux", name: "FLUX.2 klein 4B", task: "Local text-to-image illustrations · image editing not implemented", languages: "English prompt preferred", license: "Apache-2.0; pinned model card/license", source: "https://huggingface.co/black-forest-labs/FLUX.2-klein-4B", status: "IMPLEMENTED_UNVERIFIED" },
  { id: "z-image", name: "Z-Image-Turbo", task: "Illustrations (alternative)", languages: "Image", license: "Apache-2.0", source: "https://huggingface.co/Tongyi-MAI/Z-Image-Turbo", status: "NOT_IMPLEMENTED" },
  { id: "ocr", name: "PP-OCRv5", task: "Text / debug detection", languages: "VI / EN / ZH components", license: "Apache-2.0", source: "https://github.com/PaddlePaddle/PaddleOCR", status: "NOT_IMPLEMENTED" },
  { id: "vad", name: "Silero VAD", task: "CPU speech activity / silence QA · optional pinned installer", languages: "Speech activity; no language recognition or word timing", license: "MIT", source: "https://github.com/snakers4/silero-vad", status: "IMPLEMENTED_UNVERIFIED" },
  { id: "wan", name: "Wan2.1-T2V-1.3B", task: "Optional short illustration video", languages: "Video", license: "Apache-2.0", source: "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B", status: "NOT_IMPLEMENTED" },
] as const;
