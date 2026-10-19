# Chính sách nội dung & an toàn (được thực thi trong code)

| Quy tắc | Nơi thực thi |
|---|---|
| Media phải có quyền rõ ràng; UNKNOWN/REVOKED/EXPIRED/không thương mại/thiếu bằng chứng → HOLD_RIGHTS | `core/policy.ts › rightsGate` |
| Dịch/repost cần quyền phái sinh + phân phối lại + ghi nhận giá trị gốc | `rightsGate` (REUSE_TYPES, originalityChecklist) |
| Claim chưa kiểm chứng → HOLD; rủi ro ≠ LOW cần ≥2 nguồn độc lập đã truy xuất; tin theo thời gian phải kiểm lại | `factGate`, `providers/factcheck.ts` |
| Cảnh khẳng định phải gắn claim | `worker/produce.ts › claimCoverageGate` |
| Affiliate: link hợp lệ đã kiểm tra, không nêu giá/tính năng chưa xác minh, có công bố; DEMO không bao giờ đăng | `affiliateGate` |
| AUTO_SAFE: opt-in theo `platform:contentType`, live, không chủ đề nhạy cảm, không NEWS/dịch/repost, QA đạt, đã kết nối | `autoSafeEligibility` |
| Duyệt thủ công không thay được bằng chứng quyền/fact | `canApprove`, `publish.ts` |
| Kill switch, tạm dừng, đăng ngoài tắt mặc định, giới hạn bài/ngày, không retry vô hạn | `Settings`, `queue.fail`, `publish.ts` |
| Không vượt CAPTCHA/DRM/paywall, không lấy cookie, không tự động hóa UI TikTok | `discovery/connectors.ts`, `platforms/manual.ts` |
| "Tải được" ≠ "được đăng" | `discovery/acquire.ts` |
| Game: tính năng `planned/prototype` luôn được ghi rõ; thiếu gameplay thật → WAITING_FOR_CAPTURE; ảnh render được gắn nhãn | `discovery/game.ts` |
| Token không bao giờ vào log/báo cáo | `storage/secrets.ts › redact`, outbox |
| Bình luận tự động: tối đa 1 bình luận trên bài của chính mình, không tự ghim | `PlatformPublisher.tryOwnComment`, `canPin: false` |

Nhạc nền: hiện **không dùng** (chưa cấu hình nhạc có license thương mại). Giọng đọc mặc định eSpeak NG (GPL-3.0 cho engine; audio đầu ra không thuộc phạm vi GPL) được ghi vào `rights-manifest.json`. Video được đánh dấu `containsSyntheticMedia: true` khi gửi lên YouTube.
