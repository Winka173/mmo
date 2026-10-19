# Kiến trúc

## Nguyên tắc
- **Không database.** Nguồn sự thật = file dưới `DATA_DIR` (mặc định `%LOCALAPPDATA%/TuToMoFactory/data`). `index/` chỉ là dữ liệu dẫn xuất, dựng lại được (`DataStore.rebuildIndex`).
- **Mọi ghi đều atomic**: file tạm cùng thư mục → `fsync` → `rename` (thử lại khi antivirus khóa file trên Windows), giữ bản `.bak`. Đọc lỗi/hỏng → tự phục hồi từ `.bak`, chuyển bản hỏng vào `quarantine/`.
- **Audit append-only** `audit/YYYY-MM-DD.jsonl`; dòng cuối bị cắt do crash được bỏ qua.
- **Chế độ demo/live tách bạch**: dự án `demo` không bao giờ được đăng.

## Hàng đợi (packages/automation/src/queue.ts)
Mỗi job là một file trong `jobs/{queued,running,succeeded,failed,needs_review,manual_action}/`. Mọi thao tác chạy dưới `locks/queue.lock` (khóa file PID + heartbeat + TTL, tự chiếm khóa khi chủ cũ chết).
- Di chuyển = ghi đích trước, xóa nguồn sau → crash chỉ để lại bản trùng, `recover()` giữ bản mới hơn.
- Job `running` mất heartbeat → đưa lại hàng đợi; job PUBLISH/OWN_COMMENT gắn `needsReconcile` để publisher **kiểm tra phía nền tảng trước khi thử lại**.
- Idempotency key `brand:contentId:rN:destination` được ghi vào `state/idempotency.json` **trước** khi tạo job.
- Lỗi phân loại: `RETRYABLE` (backoff mũ + jitter, tôn trọng `retryAfter`, giới hạn `maxAttempts`), `BLOCKED` → `needs_review`, `HUMAN_REQUIRED` → `manual_action`, `PERMANENT` → `failed`. Bản ghi lỗi có đủ trường của mục Q.
- Giới hạn đồng thời + semaphore GPU + phụ thuộc giữa job.

## Scheduler
Cron 5 trường đánh giá theo giờ tường của múi giờ IANA (`Asia/Ho_Chi_Minh`, an toàn DST). Slot đã chạy lưu ở `state/schedules.json`; khi máy ngủ/tắt, slot gần nhất bị lỡ chạy **đúng một lần**. Callback chỉ enqueue job có key theo slot ⇒ hai instance không chạy trùng; worker còn có khóa `locks/worker.lock`.

## Pipeline sản xuất (apps/worker/src/produce.ts)
`brief.json` → storyboard (template xác định) → TTS từng cảnh (cache WAV) → khung hình Sharp/SVG → clip từng cảnh (pan + fade) → concat → loudnorm −14 LUFS → phụ đề ASS burn-in → MP4 H.264/AAC `+faststart` (ghi file `.partial` rồi rename) → poster/thumbnail → **QA** (kích thước, fps, codec, thời lượng, blackdetect, silencedetect, LUFS, peak, độ dài phụ đề, dấu tiếng Việt) → cổng quyền/fact/coverage/affiliate → `metadata.json` theo nền tảng → `sources-ledger.md` → job PUBLISH theo từng nền tảng.

Khác biệt so với đặc tả (có chủ ý, ghi rõ): bộ dựng hiện là **FFmpeg + Sharp** (CPU, chạy offline, không cần tải Chromium). Remotion Player/template cho preview tương tác là việc của Phase 3.

## Đăng bài (apps/worker/src/publish.ts)
Thứ tự kiểm tra **ngay lúc đăng**: kill switch → demo → cổng quyền/fact/affiliate (tính lại) → QA → duyệt/AUTO_SAFE → `externalPostingEnabled` → kiểm tra tài khoản đích → giới hạn ngày → reconcile → upload. Chỉ kết quả API xác nhận mới thành `PUBLISHED`. Nếu nền tảng không cho phép → gói đăng thủ công + nhiệm vụ Telegram; người dùng xác nhận bằng `/posted <job> <url>`.

## Discovery
`SourceConnector` (api/rss/webPublic/browserManualLogin/userImport/metadataOnly/unsupported) chạy theo ladder; nguồn chưa được duyệt điều khoản bị `SOURCE_SKIPPED`; CAPTCHA/đăng nhập → dừng, `USER_ACTION_REQUIRED`. `decideAcquisition` không có nhánh nào cho stream ripping/DRM/xóa watermark. Chống trùng: canonical URL, SHA256, dHash (kèm lật/crop), độ tương đồng văn bản, product key. Mỗi lượt chạy ghi `decision-trace.json`.
