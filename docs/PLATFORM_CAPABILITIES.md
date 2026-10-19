# Khả năng nền tảng (cần kiểm chứng lại với tài liệu chính thức trước khi bật live)

Môi trường phát triển không truy cập được tài liệu chính thức, nên bảng dưới dựa trên hiểu biết hiện có và **phải được kiểm chứng lại** ở Phase 4.

| Nền tảng | Trạng thái trong code | Cơ chế | Link | Ghi chú |
|---|---|---|---|---|
| YouTube Shorts / video dài | **Đã viết adapter, chưa thử với tài khoản thật** | OAuth loopback + PKCE; `videos.insert` resumable; lưu session URI trước khi gửi byte; reconcile bằng `PUT bytes */size` hoặc `videos.list`; `commentThreads.insert` cho bình luận của chính kênh | Mô tả video dài: click được. Shorts: không hứa click được | Không có endpoint riêng cho Shorts; YouTube tự phân loại. Dự án API chưa xác minh có thể bị khóa ở chế độ private — báo đúng `privacyStatus` trả về. Quota mặc định có giới hạn. |
| Facebook Page | **Gói đăng thủ công** | Graph API Reels chưa triển khai | Caption/bình luận đầu của chính Page | Cần quyền Page + App Review |
| Instagram Reels | **Gói đăng thủ công** | Graph API container chưa triển khai | Link trong caption KHÔNG click được → bio/Story | Cần tài khoản Professional |
| TikTok | **Gói đăng thủ công (cố ý)** | Content Posting API Direct Post cần app được audit; app chưa audit bị giới hạn | Bio nếu đủ điều kiện | Không bao giờ dùng Selenium/cookie |

Trạng thái theo nền tảng: `NOT_CONFIGURED, READY, QUEUED, UPLOADING, PROCESSING, PUBLISHED, MANUAL_ACTION_REQUIRED, BLOCKED_RIGHTS, NEEDS_REVIEW, FAILED, SKIPPED`.
