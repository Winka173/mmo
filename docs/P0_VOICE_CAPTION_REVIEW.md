# P0 voice/caption — 23 October 2026

Đã triển khai cải thiện deterministic và đo mẫu thật; chưa nghiệm thu chất lượng nghe bởi chủ app.

## Thay đổi chạy trong app

- `reviewNarration` có `VOICE_REVIEW_POLICY_VERSION = 2`. WER thấp không còn che mất số bị đổi hoặc từ phủ định bị mất. Evidence lưu riêng dãy số, từ chỉ số lượng và từ phủ định. ASR đổi cách ghi số thành chữ được giữ để review; không tự suy ra phát âm đúng hay sửa thông tin gốc.
- Từ điển phát âm xử lý Unicode NFC và ranh giới combining mark. Một entry `12` không thay một phần của `12.5`, `12,500`, `2026-12-01`; chỉ tác động speech text, caption/script gốc giữ nguyên.
- Caption gộp câu ngắn ở đầu/giữa trong giới hạn kích thước để tránh flash dưới 0,8 giây khi có thể; dùng Unicode code points để chia thời gian. Nếu narration quá nhanh, QA tiếp tục flag, không kéo dài giả hoặc bỏ chữ.
- ASS hiển thị đường dẫn có `\N` và nội dung trong ngoặc nhọn dưới dạng literal; không chạy override tag từ caption. Caption QA vẫn dùng cách chia dòng giống renderer. Ngoặc nhọn dùng glyph fullwidth; backslash có word joiner vô hình để libass không diễn giải thành lệnh.
- Caption evidence có grouping version 2; timing vẫn `estimated`, word alignment `UNVERIFIED`. VAD chỉ xác định hoạt động speech/silence, không được ghi thành timestamp từng từ.

## Kết quả có evidence

| Kiểm tra | Kết quả | Evidence |
|---|---|---|
| Unit/contract cho pronunciation, captions và voice gate | 25/25 PASS, 4 files | `.local/acs-p0-voice-tests.json` |
| Worker voice-repair contract, mock AI + FFmpeg thật | 1/1 PASS, chỉ retry dòng lỗi, giữ dòng khác/caption spelling | `.local/acs-p0-voice-pipeline-test.json` |
| English CPU, Kokoro `af_heart` / `bf_emma`, Qwen ASR CPU + Silero VAD CPU | 5 mẫu cố định, 27,925 giây; 4 pass / 1 flag; 0 clipped sample, 0 caption readability finding | `docs/evidence/acs-p0-voice-cpu-evaluation.json` |
| Re-score speech VieNeu CUDA/ASR CUDA thật đã có | 5 dòng tiếng Việt, 26,47 giây; gate cũ pass 5, policy v2 pass 3 và flag 2 | `docs/evidence/acs-p0-voice-retained-vi.json` |
| FFmpeg/libass render thực tế | File PNG đã xem: `C:\New\Node` và `{\pos(0,0)}` hiện nguyên dạng, không nhảy vị trí | `docs/evidence/acs-p0-caption-literals.json` |
| Bộ 9 mẫu mới VI/EN-US/EN-GB chạy CUDA | BLOCKED: shared GPU lease đang do ứng dụng khác giữ; không đụng lock/process của ứng dụng đó | `docs/evidence/acs-p0-voice-first-attempt.json`, `acs-p0-voice-evaluation.json` |

Hai lỗi thật trong draft tiếng Việt cũ bị policy v2 phát hiện: `ESP32` → ASR `A532`, và ngày `2026` → ASR `2022`. WER trước đó chỉ khoảng 0,0556 và 0,0303 nên gate cũ vẫn pass. Re-score chỉ đọc WAV/receipt/transcript đã có, xác minh hash từng WAV; không chạy lại TTS/ASR và không sửa artifact gốc. Chưa thể kết luận lỗi thuộc TTS hay ASR nếu chưa nghe.

Mẫu English viết số thành chữ bị ASR chuẩn hóa thành chữ số và giữ flag. Không coi đây là chứng minh preset phát âm tốt hơn. US/UK sample nhỏ; một mẫu UK được ASR viết `harbor` thay `harbour`, vẫn lưu transcript nguyên trạng.

## Chạy lại

```powershell
# Bộ CPU English được chọn trước inference, không phải fallback tự động.
$env:ACS_VOICE_EVAL_DEVICE='cpu'
& node_modules/.bin/tsx.cmd scripts/p0-voice-evaluation.ts

# Chỉ tính lại deterministic QA từ actual outputs đã giữ; không inference.
& node_modules/.bin/tsx.cmd scripts/p0-voice-evaluation.ts --recheck
& node_modules/.bin/tsx.cmd scripts/p0-voice-retained-vi.ts

# Khi GPU lease rảnh: tiếp tục đúng bộ CUDA đã chọn, giữ raw/dictionary pairs.
$env:ACS_VOICE_EVAL_DEVICE='cuda'
$env:ACS_VOICE_EVAL_RESUME=(Get-Content docs/evidence/acs-p0-voice-evaluation.json -Raw -Encoding UTF8 | ConvertFrom-Json).folder
& node_modules/.bin/tsx.cmd scripts/p0-voice-evaluation.ts

# Render literal-caption proof mới.
& node_modules/.bin/tsx.cmd scripts/p0-caption-literals.ts
```

Script tạo WAV/SRT/ASS thật, model/runtime receipts, SHA, full decode, waveform clipping, ASR round trip và VAD evidence trong `.local/p0-voice`. Expected script không gửi làm ASR context. Resume TTS chỉ dùng receipt có cùng effective request/config identity và SHA audio. `--recheck` ghi rõ không inference; không được báo là lần chạy model mới.

## Giới hạn còn lại

Owner listening, độ tự nhiên, stress/emotion, mixed-language pronunciation rộng, WER calibration và actual word alignment chưa VERIFIED. Không thay runner hoặc package môi trường AI; runtime fingerprints trước đó còn nguyên.

Kokoro 0.9.4 đã cài có `KPipeline.Result.tokens.start_ts/end_ts` được tính từ `pred_dur`. Đây là dự đoán duration của TTS, không phải forced alignment hay bằng chứng từng từ khớp waveform. Chưa đưa metadata này vào production captions; không đổi runtime chỉ để đổi nhãn timing.

Theo [model card chính thức Qwen3-ForcedAligner-0.6B](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B), forced aligner liệt kê 11 ngôn ngữ gồm English và không có Vietnamese; Qwen ASR và forced aligner có phạm vi ngôn ngữ khác nhau. Checkpoint aligner này chưa được cài/benchmark/tích hợp trong app. Không dùng nhãn ASR hỗ trợ tiếng Việt để hứa word alignment tiếng Việt. English alignment vẫn cần checkpoint pin, setup profile, actual Windows/CPU/GPU benchmark và integration riêng trước khi đổi trạng thái caption sang aligned.
