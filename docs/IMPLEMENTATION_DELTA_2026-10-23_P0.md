# P0 quality — bản Windows ngày 23/10/2026

Asia/Saigon. Yêu cầu hiện tại: triển khai năm mục P0 đã chốt. Chi tiết cách dùng, kết quả từng mục và giới hạn tại [P0_IMPLEMENTATION.md](P0_IMPLEMENTATION.md).

## Chức năng trong bản build mới

- Ghép narration với mô tả media/scene bằng Qwen Embedding local, source SHA, interval bounds và hạn chế lặp. Ảnh/scene chưa mô tả giữ UNKNOWN; không gọi đây là hiểu pixel hoặc xác minh gameplay.
- Voice review policy v2 chặn số và phủ định bị đổi dù aggregate WER thấp. Runtime cache có policy version; khi có transcript/audio identity phù hợp, tính lại QA mà không inference ASR lại. Unicode dictionary, caption grouping v2 và ASS literal được kiểm tra.
- Create bước 3 sửa từng câu, chọn media đã ghim, xem nguồn/đổi khoảng video, lưu thành kế hoạch con và nghe thử một câu bằng cấu hình đóng băng. URL/reload giữ đúng child. Product disclosure bắt buộc không được xóa/đổi; facts/rights vẫn cần duyệt riêng.
- Repair Planner từ saved QA: caption regroup, mix normalization, timeline encode. Child giữ parent, bounded hai lượt mỗi loại trong chuỗi, stale/hash/idempotency guards, chạy lại QA. Audio repair stream-copy hình, không AI mới.
- Models & Tools wizard VI/EN 4 bước, preflight GPU/disk/runtime/model có hướng xử lý. Ollama private bootstrap pin/resume/SHA và safe extraction; downloader speech kiểm upstream LFS/Git checksum.

## Bằng chứng thực

- **268/268 selected tests, 54 files PASS**; TypeScript và Next production build PASS. Full baseline legacy không được gọi là all-pass.
- [acs-p0-ui.json](evidence/acs-p0-ui.json): browser trên backend đã đóng gói; immutable edit/reload/source preview, pinned audition queue, repair queue và setup VI/EN. Không chạy model hoặc public post trong fixture UI.
- [acs-media-matching.json](evidence/acs-media-matching.json): embedding CPU thật, 3/3 mô tả/shot trong fixture có annotation; không gameplay acceptance.
- [acs-p0-voice-cpu-evaluation.json](evidence/acs-p0-voice-cpu-evaluation.json): năm mẫu English CPU mới, 27,925s, 4 pass/1 flag. [acs-p0-voice-retained-vi.json](evidence/acs-p0-voice-retained-vi.json): re-score đủ năm dòng VI thật đã có, phát hiện hai lỗi số trước đó được gate cũ cho PASS. Không sửa artifacts gốc hoặc giả owner listening.
- [acs-p0-repair-e2e.json](evidence/acs-p0-repair-e2e.json): real-speech copy bị giảm gain có kiểm soát; integrated loudness −44,42 → −16,16 LUFS, QA loudness PASS sau repair. Không gọi AI, original SHA giữ nguyên; freeze/pause flags vẫn tồn tại.
- [acs-p0-setup-preflight.json](evidence/acs-p0-setup-preflight.json): bốn profile trên Windows hiện tại, read-only. Resume/checksum/ZIP traversal/Unicode tests và upstream checksum thật có report riêng.

## Binary

Build **21:13:54**, `dist/windows/build-report.json` là nguồn trạng thái nghiệm thu hiện tại. Portable SHA-256 `D50A5D332636B5ADF594F38FA8B33C0EF0D2FA2985B1784DA8C8500AA2C5AC4F`; installer SHA-256 `37B7DE3FF7991864B6046156389E56F7E15E5A24AC9D61D53609FB562620C776`.

**Verifier PASS lúc 21:16:57:** trạng thái `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`. Portable và bản cài mới đạt native auth 200/401, wizard draft VI/EN, hide giữ nền/Quit dọn process, worker forced-death → normal Quit → reopen và controlled live-owner startup failure. Không bật autostart, không cấp approval/post hoặc chạy voice inference lại trong installer smoke.

Bản cài thử: `.local/installed-smoke/Ứng dụng ACS-37b7de3f/autonomous-creative-studio.exe`, SHA-256 `87693D975A7751FEB1DCF478927122DC86DA313929954FE0091C8E18B0740B4F`. EXE cài/portable khác đúng marker NSS/UNK của Tauri; phần còn lại khớp. Installer **92.344.458 byte**. Toàn bộ **9.840 file**, **324.655.977 byte** tài nguyên backend/runtime/engines khớp SHA, tree hash `21ee191406834e0047f5e5d18d6e573845b8487f2ae8b7a4e92750305aa911f1`; manifest trong `dist/windows/resource-manifest.json`. Không dùng report batch 18:56 thay cho bản này.

## Giới hạn còn lại

Chưa gameplay/logo thật, tài khoản/bot/quyền đăng, owner listening, genuine word alignment, pixel-based shot matching, clean Windows VM hoặc full Ollama ZIP bootstrap acceptance. Bộ voice CUDA mới bị GPU_BUSY; giữ report và không tác động workload ứng dụng khác. FFmpeg auto-bootstrap chưa làm. Chatterbox/OCR/Wan/music và các phần master prompt khác vẫn theo KNOWN_ISSUES.

Ba agent P0 đã hoàn tất và ngừng. Source và dữ liệu được giữ, không commit/push. Intermediate packaging đã bị dừng có chủ đích để sửa UI stepper trước khi tạo batch cuối; chỉ batch có verifier PASS mới là bản bàn giao.
