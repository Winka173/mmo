# AUTONOMOUS CREATIVE STUDIO — worker health và Windows packaging

23/10/2026, Asia/Saigon. Tiếp nối [delta 15:30](IMPLEMENTATION_DELTA_2026-10-23_1530.md). Chưa hoàn tất master prompt; không tạo quyền đăng/approval giả hoặc sửa môi trường Asset Forge.

## Những gì đã kiểm tra thực

- **Packaging sạch:** chuẩn bị lại thư mục backend generated thay vì chép đè giữ chunk/dependency cũ. Chỉ xóa các đường dẫn build whitelisted sau kiểm tra absolute/realpath và từ chối junction ra ngoài workspace. Safety fixture giữ nguyên file bên cạnh (`acs-build-folders.json`).
- **Đường dẫn Windows dài:** so sánh đầy đủ tài nguyên phát hiện ba file trong cây `.pnpm` trùng bị NSIS bỏ sót khi thư mục cài Unicode dài thêm suffix. Bản Next/worker vẫn chạy nên smoke trang đơn thuần chưa phát hiện được. Đã bỏ cây `.pnpm` sau khi dereference/flatten production dependencies, rồi build và thử lại.
- **Build 16:08:** portable SHA `8718810212a791c132f996880dbe95047b65a694eb955418e4732919242c480d`; NSIS SHA `dd837e2cd441d96e12f6cb77ab344aa32eea5c2eb8248e4ba7a1641ce14311b8`. Bản cài vào `.local/installed-smoke/Ứng dụng ACS-dd837e2c`, portable/native wizard VI/EN và hide/quit cleanup đều đạt. Đây là mốc trước UI worker health mới, không dùng hash này cho binary mới hơn.
- `scripts/verify-desktop-build.mjs` đã đối chiếu **toàn bộ resource file list và SHA** của bản cài với portable, ngoài kiểm tra marker NSS/UNK duy nhất khác giữa hai EXE. Tạo `resource-manifest.json`; build-report gắn đúng binary đã thử. Check tree đầy đủ đạt sau flatten. Chưa coi reinstall trên mọi phiên bản cũ hoặc máy sạch là đã nghiệm thu.
- **221/221 test chọn lọc / 47 file đạt**, `acs-selected-tests.json`; TypeScript/Next production build đạt. Không phải toàn baseline legacy hoặc platform/model acceptance.

## Worker health trong source

`FileLock.health()` là phép đọc; không sửa/xóa/steal khóa. Phân biệt missing, malformed/invalid, process đã chết, heartbeat quá hạn, remote host, thời gian tương lai hoặc identity chưa chắc và worker local còn sống. Khi heartbeat quá hạn, probe process birth giúp nhận PID tái sử dụng; process bận/tạm ngưng không bị tự gọi là đã chết. Bốn contract test mới gồm process Node độc lập thật bị ngắt, file khóa vẫn còn nhưng trạng thái chuyển online→dead.

API Studio chỉ trả `worker` hoạt động khi health online, có `workerHealth` riêng cho diagnostics. Overview/Production/Editor/Models có thông báo VI/EN; nếu worker đã dừng, hướng dẫn thoát hẳn app rồi mở lại để phục hồi checkpoint. Không giả hứa automatic restart hoặc cho phép xóa lock chỉ vì heartbeat chậm.

Bộ cài đang build lại để chứa source này. `desktop/worker-health-ui.mjs` sẽ ngắt đúng worker trong data bài test đã pause, kiểm tra native UI/API báo dead dù lock còn, rồi mở lại để kiểm tra worker mới và hash nháp không đổi. Chỉ nâng trạng thái VERIFIED sau command thực đạt.

## Ngoài phạm vi đã nghiệm thu

GPU vẫn bị workload khác giữ trong lần probe gần nhất. VieNeu/pipeline product mới vẫn có job chờ, không tự giảm preset hoặc đụng app khác. ASR chín sample CPU là benchmark được chọn tường minh, không đổi production GPU config. Chưa có gameplay/logo thật, account đăng, bot Telegram hoặc người nghe duyệt. Semantic director/matching, editor/repair nâng cao, optional engines, exception-only content approval và analytics/Steam vẫn chưa hoàn chỉnh.
