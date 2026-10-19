# Trạng thái triển khai

Cập nhật: 2026-10-19. Môi trường build/test: Linux container (Node 22, FFmpeg 6.1, eSpeak NG 1.51, **không GPU**, không truy cập Internet ngoài npm/Google API).

## Đã hoàn thành & đã chạy thật
| Hạng mục | Bằng chứng |
|---|---|
| Phase 0: tài liệu kiến trúc/chính sách/nền tảng/nguồn/runbook/chi phí | `docs/*` |
| Lưu trữ file-only (atomic, .bak, quarantine, khóa, audit JSONL, backup/restore, secrets mã hóa) | `packages/storage`, test |
| Hàng đợi file bền vững + phục hồi sau crash + idempotency + backoff + GPU semaphore | `packages/automation`, test |
| Scheduler theo múi giờ, catch-up đúng 1 lần, chống chạy trùng | test + chạy daemon thật |
| Phase 1 E2E offline: 6 short 9:16 + 1 video 16:9 (84.7 s, có chương) MP4 H.264/AAC thật, phụ đề tiếng Việt, QA FFprobe đạt | `pnpm e2e:offline` (~4–5 phút CPU) |
| Cổng quyền/fact/affiliate/AUTO_SAFE; giữ fact chưa kiểm chứng, affiliate DEMO, bản dịch thiếu quyền | test + kết quả e2e |
| Gói đăng thủ công (TikTok/Meta), chặn đăng nhầm tài khoản, reconcile khi crash sau upload | test tích hợp với mock |
| Telegram: allowlist, xác nhận 2 bước, outbox bền vững (429, chia nhỏ, fallback file lớn, che token), báo cáo ngày JSON/MD | test |
| Discovery: ladder, dừng ở CAPTCHA, bỏ qua nguồn chưa duyệt, demo "không có quyền tải → video gốc", chống trùng URL/ảnh lật-crop-nén/khái niệm | test + e2e (`decision-trace.json`) |
| Machine Brigade: đọc thư mục local (whitelist, bỏ `.env`), claim ledger theo trạng thái, WAITING_FOR_CAPTURE | test + e2e |
| Dashboard Next.js (localhost): tổng quan, xem/tải MP4/SRT, duyệt/từ chối, kill switch | `pnpm build` + smoke test HTTP |

Kết quả `pnpm test`: 62/62 test pass (9 file).

## Chưa làm / bị chặn (nói thẳng)
| Hạng mục | Lý do / cần gì |
|---|---|
| Đăng YouTube thật | Adapter đã viết nhưng **chưa thử với API thật**. Cần: OAuth client, kênh test, `youtube-auth`. |
| Facebook/Instagram Graph API | Chưa triển khai (đang dùng gói đăng thủ công). Cần App Meta + quyền + review. |
| TikTok tự động | Cố ý dùng gói thủ công cho đến khi có app được audit. |
| Kiểm chứng nguồn fact | Container không truy cập được NASA/Britannica ⇒ claim vẫn `SOURCED_UNFETCHED` ⇒ video fact đang HOLD. Chạy `cli factcheck` trên máy có Internet. |
| Giọng đọc tự nhiên | eSpeak NG nghe máy móc; Piper bị chặn tải trong môi trường build. Cấu hình `PIPER_MODEL` sau khi đọc license giọng. |
| Remotion Player/editor timeline | Chưa có; renderer hiện là FFmpeg+Sharp. Phase 3. |
| Playwright thật cho discovery | Chỉ có interface `PageDriver` + test giả lập; chưa cài Playwright. |
| LLM runtime, dịch Trung→Việt, ASR | Chưa cấu hình (NEEDS_PROVIDER); discovery dựa vào ghi chú tiếng Việt của bạn. |
| Analytics, nhập báo cáo Shopee, test Playwright UI | Phase 5 / chưa làm. |
| Kiểm thử trên Windows 11 + RTX 5070 Ti | Chưa chạy; NVENC chỉ bật sau khi `doctor` thử mã hóa thành công. |

## Phase tiếp theo đề xuất
Phase 2 phần còn lại: chạy worker bằng Task Scheduler trên máy thật + bot Telegram thật. Phase 4 bước đầu: kết nối YouTube với kênh test, upload private, kiểm tra reconcile.
