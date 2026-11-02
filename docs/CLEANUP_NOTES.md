# Dọn dữ liệu sinh ra — 25/10/2026

Theo yêu cầu xóa data test và file dư trong repo, đã xóa **164 mục, 13,708 GiB file**. Dung lượng trống ổ C tăng khoảng **13,79 GiB** trong thời gian thực hiện (có thể bao gồm hoạt động nền của hệ thống).

Đã xóa:

- Toàn bộ cây dữ liệu kiểm thử/benchmark/smoke đã xác định trong `.local`: video/audio/ảnh mẫu sinh ra, job/config test, snapshot, WebView test profiles, bản cài smoke test và các lần thử cũ.
- Cache Rust `src-tauri/target`, Next `apps/web/.next`, TypeScript build info, bản staging `desktop/backend`, `desktop/runtime`, `desktop/engines` và bytecode Python sinh ra.
- Hai file Hugging Face `.incomplete` bị tải dở, tổng khoảng **5,06 GiB**. Checkpoint đã cài và manifest không bị sửa.
- Screenshot, log, HTML và `.bak` kiểm thử dưới `docs/evidence`. Giữ các báo cáo JSON/Markdown nhỏ để tra cứu lịch sử.

Đã giữ:

- Source, mã test, fixture nguồn nhỏ, package manifests/lockfiles và `.git`; không commit/reset hoặc dùng `git clean`.
- `.local/models`, `.local/engines`, `.local/tools` để tiếp tục inference. Không sửa môi trường/model Asset Forge.
- Dependencies phát triển `node_modules` và bản Windows mới nhất đầy đủ tại `dist/windows` gồm installer, portable và tài nguyên kèm theo.
- Dữ liệu sử dụng thực, backup và credential ngoài workspace/LocalAppData; không xóa hoặc di chuyển chúng.

Kết quả đối chiếu: **585 file source/tài liệu giữ nguyên SHA**, **7 manifest model giữ nguyên**, **9.858 file tài nguyên release khớp checksum**; các file trong manifest FLUX đủ và đúng kích thước. Không chạy lại app/model/test để tránh sinh lại data vừa xóa. Kiểm tra `git diff --check` đạt (chỉ cảnh báo LF/CRLF đã có ở package/lockfile).

Repo sau dọn khoảng **60,39 GiB**, đo không đi theo junction/symlink. Phần lớn còn lại là checkpoint AI và môi trường Python. Lượt thống kê ban đầu 77,6 GiB có thể đếm lặp dependency qua junction; số file đã xóa và dung lượng trống ổ đĩa ở trên là số đo trực tiếp của đợt dọn.

Các đường dẫn `.local/...` và ảnh/log cũ trong báo cáo nghiệm thu nay là **tham chiếu lịch sử**, không phải artifact đang còn trên máy. Muốn chạy lại harness dùng media có sẵn từ benchmark cũ cần tạo lại fixture/inference tương ứng; không coi report JSON cũ là lần kiểm thử mới. `scripts/verify-desktop-build.mjs` cần cài/smoke lại nếu muốn đối chiếu bản installed đã bị dọn; tài nguyên `dist/windows` đã được kiểm tra độc lập và còn nguyên.

Để build desktop lần sau, chạy `scripts/desktop-build.ps1` bình thường để tái tạo Next/staging/Rust; không dùng `-SkipWebBuild` ngay sau đợt dọn này. Bản Windows đã đóng gói vẫn có thể dùng trực tiếp.

Một bước xóa bổ sung cache Vitest `node_modules/.vite` bị automatic approval review chặn, không trả lý do chi tiết. Cache này được giữ nguyên; không thử xóa bằng đường khác.

Danh sách và kết quả chi tiết: `CLEANUP_REPORT.json`, `CLEANUP_VERIFICATION.json`, `CLEANUP_SIZE_AFTER.json`, `CLEANUP_PRESERVED_HASHES.json`. Công cụ dọn có allowlist/kiểm tra workspace và không duyệt xuyên junction: `scripts/cleanup-generated.ps1` (mặc định chỉ xem kế hoạch; `-Apply` mới xóa).
