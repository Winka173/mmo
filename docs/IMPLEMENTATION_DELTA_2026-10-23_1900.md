# AUTONOMOUS CREATIVE STUDIO — nghiệm thu batch Create/timing/native

23/10/2026, Asia/Saigon. Tiếp nối [delta 18:10](IMPLEMENTATION_DELTA_2026-10-23_1810.md), giữ toàn bộ lịch sử lỗi/test. **Chưa hoàn tất master prompt.**

## Bộ cài hiện tại đã đối chiếu

Build **18:56**, portable smoke 18:57, cài mới 18:57 và full resource verifier PASS trên cùng batch. `dist/windows/build-report.json` hiện là `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`.

| Artifact | SHA-256 |
|---|---|
| `dist/windows/AUTONOMOUS CREATIVE STUDIO.exe` | `8E48770CA0BEA4DBDE6A7B15FFCAB88C347C4D5E924907F577AB222AC142C22D` |
| `dist/windows/AUTONOMOUS CREATIVE STUDIO_0.2.0_x64-setup.exe` | `ED322A726EC95F54A8751A822B097C7E7A8C2DBBC06B140D48DDF40BE1B72A1F` |
| `.local/installed-smoke/Ứng dụng ACS-ed322a72/autonomous-creative-studio.exe` | `BC37759E875B2A5D510BDDAEB94195FB360046C4FA705F1E1E9BE81B18BFB0E0` |

Installer và portable khác đúng marker NSS/UNK của Tauri; phần EXE còn lại khớp. Toàn bộ danh sách và SHA file backend/runtime/engines được đối chiếu, lưu `resource-manifest.json`; không chỉ kiểm tra server wrapper. Native auth 200/anonymous 401, bảy bước Autopilot VI/EN, sáu bước Create draft/reload/missing-source guard, hide giữ nền, Quit dọn process đều PASS. Native wizard chỉ là kiểm tra draft, không tự tạo content approval hoặc post. Giọng không inference lại trong smoke installer này; có bằng chứng model riêng.

## Lỗi WebView2 đã sửa và kiểm tra đúng phạm vi

- `acs-worker-profile-failure.json`: giữ Rust panic `0x800700AA` của batch trước. Không bỏ qua failure vì smoke khác pass.
- Khi có `ACS_CONFIG_DIR`, native dùng WebView builder và profile riêng `<config>/webview`. Không override thì giữ default profile hiện có; không xóa hoặc di chuyển browser data của chủ app.
- `acs-worker-health-ui.json` trên EXE mới: buộc worker của data test paused dừng; lock còn nhưng API báo dead/null, UI VI/EN vẫn dùng được. Sau **Quit shell đúng cách**, mở lại tạo worker mới và hash nháp giữ nguyên. Profile riêng thực sự tồn tại. Không claim shell forced-crash recovery mọi trường hợp hoặc automatic worker restart.
- `acs-startup-failure.json`: worker đang có live owner không bị lấy khóa, không tạo READY giả; UI/log đúng config root và dọn owned process. PASS trên đúng EXE mới.
- Verifier nay bắt buộc hai report fault/recovery thành công và trùng EXE hash trước khi chấp nhận build, ngoài native/install/resource checks.

## Chức năng đã có trong batch

Guided Create research/plan stop, xem script/storyboard thực, hash/pinned/idempotent continuation, preview/QA/ZIP, server-backed deep link, bảo vệ recurring Autopilot; still-image ripple cut; frame timing v2 với số frame QA và cache một câu. Chi tiết/tests/scope tại delta 17:35 và 18:10, `acs-create-guided-ui.json`, `acs-create-guided-cut-ui.json`, `acs-frame-timing.json`, `acs-frame-speech-e2e.json`.

**235/235 test chọn lọc, 50 file PASS**, TypeScript/Next build PASS. Full baseline cũ không all-pass: 309 pass, hai assertion lỗi, 24 chưa chạy vì thiếu eSpeak/fixture setup timeout. Fixture thread fix có hai test mục tiêu PASS riêng; không gọi 15 test không chọn là đã chạy. Các mock AI trong contracts không chứng minh inference; model/UI có evidence riêng.

## Tiếp tục

Chưa có genuine gameplay/logo, account/bot/quyền đăng hoặc owner listening. Chưa nghiệm thu máy sạch và mọi in-place upgrade. Vẫn còn plan-line editing, guided original-speech steps, full semantic director/media matching/dedup, full repair/editor/custom templates, exception-only content approval, remote creator localization, optional models, advanced analytics/Steam và toàn bộ VI/EN localization. Theo dõi `KNOWN_ISSUES.md`, `WORKFLOW_MATRIX.md`, `ACCEPTANCE_MATRIX.md`; không đánh dấu toàn master đã hoàn thành. Source/evidence đã lưu; không commit/push và không sửa môi trường Asset Forge.
