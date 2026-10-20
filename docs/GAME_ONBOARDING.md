# Đưa một game mới vào nhà máy (không cần sửa code)

Hệ thống hỗ trợ **không giới hạn số game độc lập**. Machine Brigade chỉ là một game (đã migrate, alias `mb`, `machinebrigade`). Mỗi game có brand kit, giọng đọc, lịch, tài khoản đăng, link CTA, build và thư viện media riêng — nội dung game **không bao giờ** đi ra kênh Tủ Tò Mò hay kênh của game khác.

## 1. Tạo game
UI: **Game → + Tạo game** (`/games/new`). Có thể lưu nháp khi mới nhập một phần.

| Nhóm | Trường |
|---|---|
| Định danh | `gameId` (slug, cố định), tên công khai/tiếng Anh/nội bộ, tagline, mô tả, studio, publisher |
| Thể loại | genres, tags, chế độ chơi, 2D/2.5D/3D, engine, nền tảng (`Android:in_development, PC:planned`), trạng thái (prototype → released) |
| Thị trường | khán giả, khu vực, ngôn ngữ, độ tuổi (nếu biết) |
| Phát hành | ngày phát hành + ô "đã xác nhận" (chưa xác nhận ⇒ hệ thống chặn mọi ngày/đếm ngược), embargo |
| CTA | mục tiêu (follow/wishlist/demo…), link chính thức `Nhãn|loại|https://…|1` (1 = đã xác nhận), UTM tùy chọn |
| Quyền | chủ sở hữu + tuyên bố quyền (bắt buộc trước khi đăng) |
| Kênh | chọn tài khoản thuộc game (thêm ở **Tài khoản**, owner = `game:<gameId>`, rồi bấm **Xác nhận**) |
| Brand kit | 6 màu, giọng (espeak voice/tốc độ/cao độ), cụm từ cấm, phát âm (`Tên => cách đọc`), giọng biên tập — mỗi lần lưu tạo phiên bản mới |

CLI tương đương: `pnpm factory game-seed-fixtures` (2 game mẫu), `pnpm factory games`.

## 2. Nhập media
UI: trang game → kéo-thả (có thanh tiến trình). Hoặc CLI: `pnpm factory game-import <gameId> <file|thư mục|zip|manifest.json> [--kind=gameplay]`.

- Gameplay MP4/MOV/WEBM/MKV (nhiều file), thumbnail PNG/JPG/WEBP (tick **Khóa thumbnail** nếu muốn dùng nguyên ảnh), ảnh chụp, logo, key art, nhân vật, render 3D, trailer chính chủ, nhạc **có license**, SFX.
- Mỗi file: SHA256 → lưu `games/<gameId>/media/<loại>/<sha>.<đuôi>` (bất biến), kiểm tra nội dung khớp đuôi, giải mã đầu/cuối (file hỏng/0 byte bị từ chối kèm lý do), probe FPS/VFR/HDR/10-bit/xoay. Nguồn khác chuẩn ⇒ tạo **proxy 30fps 8-bit đúng 1 lần**, giữ nguyên bản gốc.
- ZIP: chặn zip-slip, symlink, file thực thi/.env, zip bomb. Thư mục: chỉ trong thư mục bạn chỉ định; bỏ `.git`, `.env`, khóa, node_modules, cache engine.
- CSV shot list (`asset,in,out,annotation,caption`) → danh sách clip đã kiểm tra.
- Sửa từng asset: loại, build, ghi chú "điều thực sự xảy ra", được đăng?, giữ tiếng game?, spoiler, bug lộ, **đã kiểm tra lộ debug/thông tin riêng**.
- File AI/concept: loại `ai_concept` — không bao giờ được coi là gameplay; chỉ dùng khi bật "cảnh concept có nhãn".

## 3. Build & tính năng
Thêm build (`buildId`, phiên bản, ngày, changelog Markdown kiểu Keep-a-Changelog tiếng Anh/Việt: `### Added/Thêm`, `### Planned/Dự kiến`, `### In development/Đang phát triển`, `### Removed/Đã bỏ`, tag dòng `[planned]`, `[wip]`). **GameBuildIntelligence** dựng bản đồ tính năng; `verified-features.json` (nhập tay) luôn ưu tiên. Kịch bản nhắc tính năng chưa có mà không ghi "đang phát triển/dự kiến" ⇒ chặn; nhắc roadmap ⇒ cần duyệt riêng. Footage build cũ ⇒ nhãn "Footage bản cũ vX".

## 4. Tạo video
Trang game → **+ Tạo video game** → wizard:
1. Loại (GAMEPLAY_HIGHLIGHT, GAME_DEVLOG, GAME_TRAILER, GAME_TEASER, GAME_MECHANIC, … 18 loại), tiêu đề, hook, định dạng 9:16 / 16:9, nền tảng, ngôn ngữ, lời đọc, giữ tiếng game.
2. Clip: xem video thật, **đặt điểm vào/ra từ playhead**, sắp xếp, chú thích, lời đọc; gợi ý điểm nhấn từ FootageAnalyzer.
3. Ảnh/logo/thumbnail: `LOCK_USER_THUMBNAIL` / `AUTO_ENHANCE` / `GENERATE_CANDIDATES`, khung hero, chữ trên thumbnail, nhạc.
4. Build, CTA (chỉ link đã xác nhận; không có store ⇒ CTA theo dõi).
5. Kênh (chỉ tài khoản của game).

Bảng **Mức sẵn sàng** liệt kê: thiếu / chặn dựng / chặn đăng / cần duyệt / lưu ý. **Hoàn tác lần sửa cuối** luôn có. **Dựng 9:16 / 16:9** đưa job vào hàng đợi (worker dựng). Xem trước: video, thumbnail đã chọn + ứng viên có điểm, vùng an toàn TikTok/Shorts/Reels, phụ đề, QA.

## 5. Duyệt & đăng
Duyệt ghi dấu vân tay (input + hash mọi asset). Đổi thumbnail/clip sau khi duyệt ⇒ **duyệt bị hủy**. Lúc đăng hệ thống kiểm tra lại toàn bộ; sai tài khoản/game ⇒ dừng, không có side effect.

## 6. Chiến dịch
Trang game → Chiến dịch: mục tiêu, trụ cột, thông điệp, persona, kênh. Đếm ngược/ra mắt chỉ khi ngày đã xác nhận; mục tiêu wishlist khi chưa có store ⇒ tự hạ về follow. KPI mặc định là **không rõ** (null) cho tới khi có tích hợp được cấp quyền.
