# AUTONOMOUS CREATIVE STUDIO — delta chiều 23/10

Đây là trạng thái triển khai từng phần, chưa hoàn tất master prompt. Không có gameplay/logo thật, account đăng, bot Telegram hoặc quyết định nghe duyệt của chủ app. Không tạo thay các đầu vào đó. Các bản đo cũ giữ nguyên phạm vi riêng.

## Feed, footage và gói xuất

- **RSS/Atom công khai:** metadata từ feed cho phép đọc, giới hạn dung lượng, kiểm tra URL/DNS/redirect, không tải enclosure/video. Autopilot facts chọn theo từ khóa và độ mới, ghim bài gốc để research, tránh lặp theo identity và bổ sung ngôn ngữ còn thiếu sau gián đoạn. Không có nguồn phù hợp thì bỏ slot. `acs-feed-discovery.json`, `acs-feed-ui.json` kiểm tra feed NASA thật và UI VI/EN. Đây chưa phải semantic director hoặc watcher video Trung có quyền.
- **Footage:** tái sử dụng analyzer FFmpeg trong repo, ghim hash và đường dẫn công cụ, đo scene/black/freeze/motion/audio, ghi phần đã quét và phần chưa đo. Worker giới hạn bốn video, mỗi video 300 giây; OCR/ý nghĩa gameplay vẫn chưa xác minh. Quality hiển thị các khoảng gợi ý, không tự thay shot. `acs-footage-analysis.json`, `acs-footage-ui.json` dùng pattern sở hữu được tạo bằng FFmpeg, không gọi đó là gameplay thật. Regression kiểm tra audio 16kHz vẫn được tổng hợp theo giây, nguồn đổi hash bị giữ, child giữ report và không chạy AI lại.
- **ZIP riêng tư:** Publish → xuất gói thủ công, gồm MP4/SRT/ASS/thumbnail/citations, manifest nguồn/quyền/review và metadata nháp. Không đóng gói credential/config/log/model hoặc nguồn thô. Hash/CRC, UTF-8, giới hạn file/dung lượng, kiểm tra symlink/junction, ghi tạm/checkpoint/rename, khôi phục sau ngắt và giữ archive bị sửa để chẩn đoán. Cùng phiên bản/bằng chứng cho cùng archive. QA gắn SHA của MP4; output cũ phải decode kiểm tra thật trước xuất.
- `acs-manual-export-ui.json`: MP4 thật được kiểm tra lại bằng FFmpeg; tải ZIP 1.039.224 byte, SHA `25152ad180b89769550d41f1b52b289e531079e5d2a248d2e9424eda9f0033ac`; Range 206, ASS 200, không session 401, Origin lạ 403, byte MP4 không đổi. Bài test sau đó cố ý sửa archive trong data riêng và xác nhận 409/giữ file; không trình bày archive đã bị sửa là file còn hợp lệ. Không model/worker/account/publication/human approval nào được gọi để xuất.

## ASR trên tiếng nói độc lập

`scripts/asr-corpus-benchmark.py`, chạy bằng Python env ASR hiện có. Chọn trước ba utterance ID khác nhau trong các hàng validation đầu tiên của mỗi ngôn ngữ; đối chiếu viewer với metadata gốc và revision cố định trước khi tải WAV.

Nguồn: [Google FLEURS](https://huggingface.co/datasets/google/fleurs), revision `70bb2e84b976b7e960aa89f1c648e09c59f894dd`, card khai CC-BY-4.0. Giữ attribution, card/metadata SHA, URL không chứa query có chữ ký, audio hash và lời chuẩn; không clone hoặc đăng lại giọng. API split test lỗi giới hạn scan; benchmark dùng validation, ghi rõ lựa chọn này.

| Tập nhỏ | Số clip / tổng audio | Metric | Lỗi / đơn vị chuẩn | Tỷ lệ |
|---|---|---|---|---|
| Việt | 3 / 34,02s | WER theo âm tiết cách trắng | 4 / 105 | 3,81% |
| Anh | 3 / 30,84s | WER | 6 / 69 | 8,70% |
| Mandarin | 3 / 33,38s | CER | 3 / 105 | 2,86% |

Nhận đúng ngôn ngữ 9/9. Chế độ **CPU được chọn tường minh**, bốn thread, 98,24 giây audio; runner load/inference 170,85 giây, toàn process 208,83 giây. Không đổi config sản xuất GPU, không fallback hoặc gọi cloud. Qwen3-ASR dùng checkpoint SHA `b73be080615a190b42848b04271de85a51fbe8b40113d82561b6b35d5359850c`. Evidence `acs-asr-corpus.json`. Giữ chữ có dấu; punctuation/case chuẩn hóa, dạng số viết chữ và chữ số chưa đồng nhất. Chín clip không đại diện phân bố giọng, không hiệu chỉnh được ngưỡng QA 0,15, không chứng nhận TTS/dịch/word alignment. Human review vẫn NOT_REVIEWED.

Lần đầu dùng bộ đọc WAV chuẩn Python không nhận IEEE float WAV; ghi `acs-asr-corpus-first-attempt.json`. Sửa benchmark dùng soundfile trong env có sẵn, không sửa runner/model hay cài dependency mới.

## Khởi động và khóa process

Lượt native của build 15:28 phát hiện worker thoát vì khóa cũ vẫn bị coi là đang có chủ. Không giữ PASS cũ cho binary đó: `acs-native-smoke-latest-attempt.json` lưu lần thất bại. Đã thêm đối chiếu thời điểm tạo process khi một khóa local hết heartbeat nhưng PID vẫn tồn tại; chỉ thu hồi khi process hiện tại sinh sau lúc khóa được tạo, giữ khóa nếu không đọc được identity. TTL không cho phép cướp khóa của process đang tạm ngưng. Owner nonce ngăn một instance heartbeat/release bản ghi đã bị thay dù PID giống nhau.

Storage regression 14/14 đạt, gồm probe process Windows độc lập: thu hồi identity giả lập đã chết, giữ owner thật và không dừng process được kiểm tra. Native startup mới yêu cầu worker còn sống và thực sự giữ worker lock trước READY; lỗi được ghi trong config folder đã chọn và hiện trực tiếp ở splash VI/EN, dọn backend đã khởi chạy.

## Build / nghiệm thu đang cập nhật

- TypeScript/Next production build sau sửa khóa đạt. **217/217 test chọn lọc / 46 file đạt**, summary bền vững `acs-selected-tests.json`; không gọi đây là toàn bộ baseline suite.
- Build 15:38 qua portable/installed WebView/auth/Projects/OAuth/Insights; native wizard VI/EN đủ bảy bước, reload, failed save, Create sáu bước và guard thiếu nguồn đều đạt. Không model/account/publication/human approval mới. Hide/quit process cleanup đạt; autostart vẫn tắt. Voice không chạy lại trên installer này vì GPU busy, giữ bằng chứng model riêng.
- `acs-startup-failure.json`: tạo owner lock đang sống trong fixture riêng, app từ chối duplicate worker, không báo READY, hiện lỗi ở splash VI/EN và config folder đã chọn, dọn web/worker vừa mở; lock/process owner không đổi. Đã xem screenshot thật. Lượt installed wizard đầu bị ảnh hưởng bởi voice backlog cũ được lưu ở `acs-native-wizard-isolation-first-attempt.json`; sửa harness dùng data riêng đã pause trước launch, không sửa app để né lỗi.
- Sau đối chiếu toàn resource tree, đã sửa build preparation để không trộn chunk/dependency cũ khi chép đè. Chỉ dọn bốn đường dẫn generated whitelisted, xác minh realpath trong workspace và từ chối junction ngoài; safety probe thật giữ nguyên file lân cận (`acs-build-folders.json`). Portable resources được stage lại chính xác theo các thư mục resource của NSIS. Splash lỗi có giới hạn độ rộng/wrap/contrast tốt hơn. Đang build lại để nghiệm thu gói cuối; hash 15:28 là bản lỗi, không dùng làm bản giao.

Các phần còn thiếu gồm editor semantic/word alignment, exception-only content approval, discovery/adapters và model tùy chọn chưa tích hợp, analytics/Steam thực, UI legacy chưa dịch đủ, clean-machine setup và các điều kiện chủ app phải cung cấp. Xem `IMPLEMENTATION_STATUS.md`, `KNOWN_ISSUES.md`, `ACCEPTANCE_MATRIX.md`.
