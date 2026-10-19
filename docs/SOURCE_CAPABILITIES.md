# Ma trận nguồn (discovery)

Mặc định **mọi nguồn Trung Quốc có `automationPermitted: false`** cho đến khi chủ dự án tự đọc điều khoản/robots và ghi `reviewedAt`. Khi chưa được phép: `SOURCE_SKIPPED` → dùng `USER_EXPORT` / `MANUAL_IMPORT`.

| Nguồn | API chính thức | Tự động hóa trình duyệt | Tải media | Mặc định |
|---|---|---|---|---|
| Taobao | Open Platform (cần duyệt) | Chưa duyệt; có CAPTCHA | Không | MANUAL_IMPORT, metadata/ý tưởng |
| Douyin | Open Platform (đối tác) | Chưa duyệt | Không có quyền phân phối lại | IDEA_ONLY → ORIGINAL_REMAKE |
| Xiaohongshu | Không công khai | Thường cần đăng nhập → dừng | Không | MANUAL_IMPORT |
| Bilibili | Không dùng endpoint không chính thức | Chưa duyệt | Chỉ khi video ghi license phù hợp (kiểm từng video) | IDEA_ONLY |
| RSS nhà xuất bản | Có | Không cần | Không (chỉ metadata) | `RssConnector` |
| Nhập thủ công | — | — | Chỉ file bạn có quyền | `UserImportConnector` |
| Thư mục game Machine Brigade | — | — | Asset chính chủ, whitelist đuôi file, bỏ qua `.env/.git/keys` | `GameProjectProvider` |

Playwright thật (headed, phiên đăng nhập do người dùng) được cắm qua interface `PageDriver`; bản hiện tại chưa cài Playwright vào dự án — luồng được kiểm thử bằng driver giả lập.
