# Hướng dẫn sử dụng (V4)

## Cài đặt nhanh (Windows 11)
1. Node ≥ 20, `corepack enable` (pnpm), FFmpeg (`winget install Gyan.FFmpeg`), eSpeak NG (`winget install eSpeak-NG.eSpeak-NG`).
2. Tùy chọn: Tesseract OCR (`winget install UB-Mannheim.TesseractOCR`) để tự phát hiện chữ debug trong gameplay; không có ⇒ hệ thống yêu cầu bạn xem lại bằng mắt.
3. `pnpm install` → `pnpm doctor` → `pnpm e2e:offline` (dựng mọi fixture thật) → `pnpm dev` (http://127.0.0.1:3077) → `pnpm worker`.

## Màn hình
| Trang | Dùng để |
|---|---|
| Tổng quan `/` | trạng thái, dự án |
| Game `/games` | thư viện game, lọc 2D/3D/trạng thái; tạo/sửa game; media; build; tính năng; chiến dịch; wizard video |
| Duyệt `/review` | mọi mục bị giữ + lý do; duyệt/từ chối; link tới bằng chứng |
| Kiểm tra `/inspect/<id>` | claim & nguồn (trích đoạn, độc lập), độ trùng (bằng chứng từng mức, xác nhận với lý do), chuỗi quyền, Quality Judge |
| Kế hoạch `/planner` | lịch đề xuất (nhịp từng game/brand, ngày lễ đã xác minh, giãn cách Shorts cùng lineage), Opportunity Radar |
| Phân tích `/analytics` | số liệu (? = chưa biết), doanh thu affiliate theo giai đoạn, bài học, đề xuất, hoàn tác thiết lập học |
| A/B `/experiments` | tạo/đánh giá thử nghiệm (không đăng trùng cùng kênh) |
| Ngân sách `/budget` | trần ngày/tuần/tháng/video, allowlist provider trả phí, sổ chi phí, chi phí/bài |
| Vận hành `/ops` | hàng đợi, heartbeat, GPU, ổ đĩa, toàn vẹn dữ liệu, cảnh báo quyền, sổ đăng bài, trace job lỗi |
| Telegram `/telegram` | allowlist, tin thử, danh sách lệnh |
| Tài khoản `/accounts` | tài khoản theo brand/game, xác nhận điểm đăng |
| Cài đặt `/settings` | kill switch, đăng ngoài, tính năng V4, chế độ QA, khám phá/đóng băng học |

## CLI (`pnpm factory <lệnh>`)
`doctor · verify [--fix] · migrate [--dry-run] · backup [--with-secrets] · restore <tên> [--dry-run] · gpu · games · game-import · game-readiness · game-produce [--demo] · game-approve [--roadmap] · accounts [confirm <id>] · rights [audit|revoke|chain] · originality-override · factcheck <id> · analytics-import <csv> · revenue-import <csv> · learn [undo] · schedule · trends · lifecycle · affiliate-recheck · long2shorts <id> [k] · soak [ngày] [--out=…] · approve/reject/retry · pause/resume · kill-switch [on|off] · secrets set <tên> · telegram-allow <chatId> · youtube-auth`

## Telegram
`/status /today /queue /report /cost /budget /channels /games /game ID /campaigns /review PROJECT_ID /doctor /pause /resume /emergency_stop /approve /reject /retry /posted`. `/approve /retry /resume` cần `/confirm <mã>` trong 2 phút. `/emergency_stop` dừng ngay (không cần xác nhận).

## Kết nối nền tảng (chỉ khi bạn sẵn sàng)
- YouTube: `factory secrets set youtube.clientId` + `youtube.clientSecret` → `factory youtube-auth` → `config/channels.json` `youtube.expectedChannelId`.
- Meta: `factory secrets set meta.pageToken`; `config/channels.json` → `meta.pageId`, `meta.igUserId`, `meta.publishState` (mặc định `DRAFT`). Adapter viết theo tài liệu Graph API nhưng **chưa thử với tài khoản thật** — thử Page/IG test trước.
- TikTok: chỉ khi app đã audit: `secrets set tiktok.accessToken`, `tiktok.audited=true`. Mặc định: gói đăng thủ công.
- Sau đó thêm tài khoản ở `/accounts`, xác nhận, rồi bật **Đăng ra ngoài** trong Cài đặt.
