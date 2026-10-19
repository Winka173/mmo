# Runbook (Windows 11)

## Cài đặt
1. Node.js ≥ 20 và pnpm (`corepack enable`).
2. FFmpeg: `winget install Gyan.FFmpeg` (hoặc đặt `FFMPEG_PATH`/`FFPROBE_PATH`).
3. TTS tiếng Việt offline: `winget install eSpeak-NG.eSpeak-NG` (hoặc đặt `ESPEAK_PATH`). Tùy chọn Piper: đặt `PIPER_MODEL`, `PIPER_BIN`, `PIPER_VOICE_LICENSE`, `PIPER_COMMERCIAL_OK=1` **chỉ sau khi đọc MODEL_CARD**.
4. `pnpm install` → `pnpm doctor` → `pnpm e2e:offline`.
5. GPU RTX: `pnpm doctor` sẽ chạy `nvidia-smi` và thử mã hóa NVENC 1 giây; chỉ dùng NVENC khi thử thành công.

## Chạy worker nền độc lập với UI
```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows-task.ps1
```
Tạo task "TuToMoWorker" chạy khi đăng nhập, tự khởi động lại khi dừng. Worker có khóa đơn thể hiện; instance thứ hai tự thoát.

## Telegram
1. Tạo bot với @BotFather.
2. `pnpm --filter @ttm/worker cli secrets set telegram.botToken` (nhập token, lưu bằng DPAPI).
3. `pnpm --filter @ttm/worker cli telegram-allow <chat_id>`. `/start` không cấp quyền.
4. Worker dùng long polling (không mở cổng). `/approve`, `/retry`, `/resume` cần `/confirm <mã>` trong 2 phút.

## YouTube (Phase 4 — thử với kênh test, video private trước)
1. Google Cloud: bật YouTube Data API v3, tạo OAuth client loại *Desktop app*.
2. `cli secrets set youtube.clientId`, `cli secrets set youtube.clientSecret`, rồi `cli youtube-auth`.
3. Ghi `config/channels.json` → `{"youtube":{"expectedChannelId":"UC..."}}` để chặn đăng nhầm kênh.
4. Bật `externalPostingEnabled` trong Cài đặt **chỉ sau khi** đã kiểm thử.

## Kiểm chứng fact
`pnpm --filter @ttm/worker cli factcheck fixture-fact-venus` — truy xuất nguồn thật và tìm cụm bằng chứng; chỉ khi đủ nguồn độc lập mới chuyển `VERIFIED`.

## Sự cố
| Triệu chứng | Xử lý |
|---|---|
| Worker crash giữa chừng | Khởi động lại: `recover()` dọn file trùng, đưa job treo về hàng đợi, job đăng bài sẽ reconcile trước |
| File JSON hỏng | Tự phục hồi từ `.bak`; bản hỏng ở `quarantine/` |
| Ổ đĩa thấp | Job dựng bị hoãn + cảnh báo; xóa `projects/*/work/` (dữ liệu tạm, dựng lại được) |
| Token hết hạn | Job → `manual_action` + Telegram; chạy lại `youtube-auth` |
| Muốn dừng khẩn | `cli kill-switch on` hoặc nút trong Cài đặt |
| Sao lưu/khôi phục | `cli backup`, `cli backups`, `cli restore <tên>` (tự tạo bản an toàn trước khi khôi phục) |
