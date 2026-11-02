# AUTONOMOUS CREATIVE STUDIO — guided Create và timing theo frame

23/10/2026, Asia/Saigon. Tiếp nối [delta 17:35](IMPLEMENTATION_DELTA_2026-10-23_1735.md). Master prompt vẫn chưa hoàn tất; chưa tạo public post hoặc approval của chủ app.

## Kết quả có thể kiểm tra

- Create sáu bước có research/quote/citation, script/storyboard thật rồi dừng trước voice/render. Kế hoạch, nguồn và cấu hình được ghim/hash; tiếp tục có lock/idempotency, không viết lại research/script, không tạo job trùng. Preview thật, QA và ZIP nằm trong các bước riêng. Xem `acs-create-guided-ui.json` và các ảnh `acs-create-*-ui.png`.
- Mẫu NASA English dùng Qwen/Kokoro/ASR CUDA thật, 27,397333s; ba ASR checks pass. Lần UI sau dùng lại đúng run đã dựng, kiểm tra metadata CUDA/hash, không chạy inference lại để che lỗi harness. Reload, liên kết server không local cache, VI/EN, tải ZIP và prompt-cut đã đạt. QA vẫn giữ freeze/silence UNKNOWN và quyền đăng BLOCKED.
- Liên kết Create trỏ tới Autopilot đang bật mở handoff sang Production/Editor, không lưu đè/tắt cấu hình lặp lại. UI test dùng fixture có lịch 2099 để kiểm tra JSON không đổi/no new production rồi tắt lại; không cấp content/publishing approval.
- Renderer ảnh tĩnh không dùng seek làm mất frame đầu; loop ảnh trong thời gian clip. Regression thực xác nhận timeline ảnh 10s cắt 5–8s tạo H.264/AAC 7s giải mã đầy đủ, giữ file gốc.

## Timing mới, giữ nguyên phiên bản cũ

`renderTimingVersion=2` cho production narration mới (Shorts lời gốc giữ phiên bản timing riêng). Dùng độ dài WAV thực cho dialogue/caption; làm tròn video lên frame 30 fps, ghi duration từng segment trong concat, chuẩn hóa timestamp và giới hạn số frame khi encode. Có một frame hold cuối để tránh mất frame do PTS/AAC; không cắt bớt lời hoặc tự thêm nội dung. QA có gate **frame_timing** so sánh số frame kế hoạch với MP4 thật. Các run cũ mặc định version 1; bản đã hoàn thành/parent không bị sửa hoặc dựng lại.

- `acs-frame-timing.json`: mock TTS tone có nhãn + FFmpeg thật. Ba đoạn WAV không tròn frame cho 141/141 frame, timeline/video/container **4,7s**. Sửa một câu chỉ thêm một lần TTS; segment 0/2 và video parent giữ nguyên byte. Đây là test tính đúng của cache/timing, không phải chất lượng giọng.
- `acs-frame-speech-e2e.json`: giữ nguyên WAV **Kokoro CUDA thật đã có** và checkpoint metadata, dựng lại bằng timing mới ở data riêng. Không TTS/ASR inference mới, không đổi config production. **819/819 frame**, video/container/timeline **27,3s**; cut 5–8s tạo **729 frame / 24,3s**, giảm đúng 3s ở cả timeline và container, giữ nguyên hai parent cũ/mới. ASR/rights/facts/listening không được tự chuyển thành pass.
- Parent cũ 27,397333s/27,275s timeline vẫn giữ nguyên để xem lịch sử. UI-cut trên parent cũ giảm đúng 3 timeline seconds; chênh container cũ 3,130666s được ghi rõ trong `acs-create-guided-cut-ui.json`. Không dùng tolerance để gọi parent cũ là frame accurate.

## Kiểm tra và đóng gói

- **235/235 test chọn lọc, 50 file PASS**, gồm plan stop/resume/tamper, quyền/cancel, actual FFmpeg still cut, frame timing và one-line cache. Root TypeScript và Next production build PASS. Evidence: `acs-selected-tests.json`.
- Full baseline trước đó: 309/335 pass, hai assertion lỗi và 24 không chạy vì thiếu `espeak-ng` hoặc game fixture setup timeout. Fixture timeout đã sửa thread limit và hai test mục tiêu đạt riêng. Đây không phải toàn suite hiện tại all-pass.
- Batch guided Create + guard trước timing mới đã có native portable wizard/auth/close PASS. Batch cuối chứa timing mới đang đóng gói/kiểm tra; chỉ dùng `dist/windows/build-report.json` sau đối chiếu native, installer và resource SHA cho đúng binary. Không gán kết quả binary cũ sang bộ cài mới.
- Bài fault/reopen đã phát hiện WebView2 panic `0x800700AA` ở lần mở thứ hai khi profile mặc định còn bị giữ sau forced shell termination; log Rust đã lưu trong thư mục bài test, failed report giữ riêng. Native nay tách browser profile dưới `ACS_CONFIG_DIR/webview` khi có override rõ ràng, giữ profile mặc định của người dùng nếu không override. Harness vẫn buộc worker chết, sau đó dùng Quit thật cho shell rồi mở lại. Bản sửa đang được đóng gói để kiểm chứng; chưa gọi lỗi này đã nghiệm thu xong.

## Giới hạn còn lại

Plan đã ghim hiện chỉ xem; muốn đổi phải tạo plan mới. Guided stop chưa áp dụng Shorts/localization lời gốc. Chưa full semantic director/media matching/dedup, full repair/editor, custom templates, exception-only content approval, remote creator feed/localization, advanced analytics/Steam, optional model stack hoặc toàn bộ VI/EN UI. Clean-machine setup, gameplay/logo, account/bot thật và người nghe duyệt vẫn chưa có. Xem `KNOWN_ISSUES.md` và `ACCEPTANCE_MATRIX.md`.
