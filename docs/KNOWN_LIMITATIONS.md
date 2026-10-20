# Giới hạn & vấn đề còn tồn tại (nói thẳng)

## Cần credential/quyền của bạn — chưa thể kiểm chứng trong môi trường build
| Hạng mục | Trạng thái thật | Cần gì |
|---|---|---|
| YouTube upload thật | adapter + reconcile + kiểm tra scope có test với HTTP giả lập; **chưa upload thật** | OAuth client Desktop, kênh test, `factory youtube-auth`, `expectedChannelId` |
| Facebook Page Reels / Instagram Reels | adapter theo tài liệu Graph API (start→rupload→finish; container resumable→FINISHED→publish), test với HTTP giả lập; **chưa chạy với tài khoản thật**, phiên bản Graph (mặc định v21.0) và scope cần xác minh lại | App Meta + quyền (pages_manage_posts, instagram_content_publish…), review, Page/IG test |
| TikTok | mặc định gói thủ công; adapter Content Posting (creator_info→init→PUT chunk→status) chỉ bật khi app **đã audit** | App audit + token |
| Số liệu nền tảng | MetaPublisher có `fetchMetrics` (insights); YouTube Analytics API chưa nối; mặc định nhập CSV | scope `yt-analytics.readonly` / quyền insights |
| Bình luận | không có API liệt kê bình luận được nối; dùng `comments/inbox.jsonl` (nhập) | quyền đọc bình luận từng nền tảng |
| Doanh thu Shopee | chỉ nhập CSV báo cáo | quyền API affiliate nếu có |
| LLM runtime / chuyển ngữ tự động | NEEDS_PROVIDER; chuyển ngữ hiện dùng file người dịch | Ollama hoặc API riêng có ngân sách |
| Premium Quality Judge | hook có, chưa nối provider | provider + allowlist + trần |

## Giới hạn kỹ thuật
- **Footage game trong fixture là video tổng hợp** (FFmpeg vẽ sprite chuyển động) đứng thay cho bản quay thật để chạy offline; mọi bản dựng fixture có nhãn "FIXTURE" và `mode=demo`.
- FootageAnalyzer dùng tín hiệu rẻ (đổi cảnh, đứng hình, âm lượng, chuyển động, OCR); không "hiểu" gameplay — khi độ tin thấp nó yêu cầu bạn ghi chú.
- OCR phát hiện lộ debug chỉ hoạt động khi cài Tesseract; không có ⇒ cảnh báo "cần người xem". OCR không đọc tiếng Việt có dấu (chỉ dùng cho chuỗi debug/email/đường dẫn).
- Dấu vân tay âm thanh là đường năng lượng thô (không phải Chromaprint); pHash video lấy mẫu 1 khung/giây — đủ bắt bản crop/lật/nén lại, không thay thế Content ID.
- Chống trùng chéo ngôn ngữ dựa trên khái niệm tiếng Việt (ghi chú/bản dịch); không có bộ dịch thì nguồn tiếng Trung chỉ so được qua số/tên.
- Giọng eSpeak NG nghe máy móc; Piper/cloud TTS cần bạn xác nhận license giọng.
- Renderer là FFmpeg+Sharp (không phải Remotion); không có trình chỉnh timeline kéo-thả đầy đủ — wizard cho in/out theo playhead, sắp xếp, chú thích; xem trước là MP4 đã dựng.
- Vùng an toàn TikTok/Shorts/Reels trong preview là **ước lượng** — kiểm tra lại trong app chính thức.
- SmartSchedule chưa có dữ liệu giờ hoạt động follower thật (cần analytics có quyền); ngày lễ chỉ lấy từ `config/calendar.json` có nguồn bạn xác nhận.
- Học tự động/A-B là quan sát, cần đủ mẫu; với kênh mới sẽ ở chế độ khám phá trong thời gian dài.
- Upload trong UI nạp cả file vào bộ nhớ server (localhost) — file rất lớn (>2 GB) nên dùng `factory game-import` hoặc nhập thư mục.
- Next.js `next build` cảnh báo dữ liệu baseline-browser-mapping cũ — chỉ là cảnh báo.
- Kiểm thử chạy trên Linux container (không GPU); chưa chạy trên Windows 11 + RTX 5070 Ti. `factory gpu` sẽ đo thực tế; NVENC chỉ dùng khi thử mã hóa thành công.
