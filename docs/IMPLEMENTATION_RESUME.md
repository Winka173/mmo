# AUTONOMOUS CREATIVE STUDIO — trạng thái để tiếp tục

**Checkpoint 03/11/2026 — vòng tiếp theo (đang làm):** chủ duyệt toàn bộ: (1) bài không phải video trên mọi nền tảng có API chính thức (FB text/link/ảnh/nhiều ảnh, IG ảnh/carousel, TikTok photo; YouTube community không có API → xuất thủ công); (2) inbox/bình luận Facebook Page với trợ lý trả lời chống injection, chủ duyệt trước khi gửi; (3) A/B và Ngân sách vào menu Studio, VI/EN; (4) từ điển phát âm dự án/toàn cục + gợi ý từ voice check (Lane Keeper), sửa luật phụ đề để đạt thật, chạy lại trial; (5) chọn giọng theo dự án/brand và từng lần Create, nghe thử, ghi vào run; (6) espeak-ng trong one-click installer; (7) chờ RAM chạy Gemma 4 31B (`apps/worker/tools/gemma-window.ts`, evidence `docs/evidence/gemma-window.json`). Trạng thái từng mục cập nhật bên dưới khi xong. **Tiến độ (chưa build/commit):** (7) Gemma 4 31B ĐÃ chạy thật lúc RAM trống 31,8 GB (`docs/evidence/gemma-window.json`, 43 s, CPU); (3) `/studio/experiments`, `/studio/budget` (`StudioOps.tsx`, `/api/studio/ops`); (4) từ điển phát âm chung `GlobalPronunciationStore` + gợi ý `pronunciation-suggestions.json` + `PronunciationTools.tsx`, phụ đề `relaxCueTiming` (9→0 lỗi trên cue trial); (5) `VoicePicker.tsx` + `/api/studio/voice-catalog` (25 giọng VieNeu, Kokoro theo file .pt); (1)(2) `packages/platforms/src/social-posts.ts`, `studio-posts.ts` (automation + worker), `/studio/posts`, `/studio/inbox`, test `studio-posts.test.ts`. (6) espeak-ng xong (4 file test legacy pass), (8) Meta Muse xong (driver + fake page, chờ đăng nhập). Build cuối 34/34 UI check PASS; trial 03/11 trên app: Gemma viết kịch bản, phụ đề 9→0 lỗi, voice dòng 1 WER 0,33→0,19. Xem RELEASE_QA mục 03/11.

**Checkpoint 02/11/2026 (nhánh `feature/ai-model-decisions`, v0.2.0) — xem [RELEASE_QA.md](RELEASE_QA.md) mục 02/11:**
- UI 6 trang (Kênh, Kế hoạch, Duyệt, Autopilot, Sản xuất, Thư viện) đã review trên app native và sửa; nhãn VI/EN chung ở `apps/web/app/components/labels.ts`.
- **Cài đặt › Tài khoản & Khóa** (`AccountsKeys.tsx`, `/api/studio/accounts`, `packages/automation/src/accounts.ts`) là nơi duy nhất nhập khóa (DPAPI, chỉ ghi, trạng thái, Test connection chỉ đọc, Xóa).
- Kênh Studio: YouTube + Facebook Page Reels + Instagram Reels + TikTok, cùng flow duyệt/cho phép/upload/đối soát, xuất thủ công là dự phòng; test fake HTTP. Số liệu theo nền tảng + tự lấy số liệu mỗi ngày (chỉ đọc).
- Xây kênh theo chiến lược (mục 12 ALL_APP_FLOWS): `channel-strategy.ts`, `ChannelStrategy.tsx`, `/api/studio/strategy` — chiến lược → pillar/series → kế hoạch tuần → chủ duyệt từng ý tưởng → Autopilot nháp → số liệu theo series; chỉ Reels/video.
- Telegram e2e với fake Bot API loopback (`telegram-loop.ts`); semantic index làm mới tăng dần + tự xếp hàng; sửa lời tự do sau cut (re-narrate bản chưa cắt rồi replay cut, dừng khi độ dài đổi trước điểm cắt).
- Trial thật qua app đóng gói: `docs/evidence/trial-2026-11-02/` PASS (Qwen3.5-9B CPU, VieNeu CUDA, Qwen3-ASR CUDA, FFmpeg, QA, Library). Gemma 4 31B chưa chạy được vì RAM trống 14–17 GB < 26 GB.
- Native UI check `desktop/ui-rules-check.mjs`; full vitest chỉ còn 4 lỗi do thiếu `espeak-ng` (legacy).
- Còn mở: chạy Gemma 4 31B khi RAM đủ; nghe duyệt giọng; bài chữ/ảnh Facebook; kiểm chứng live mọi nền tảng (chờ tài khoản); trang A/B/ngân sách legacy chỉ có tiếng Việt và không nằm trong menu Studio.


**Đã nghiệm thu bản hiện tại 24/10 01:01:59, verifier 01:05:03:** `dist/windows/build-report.json` = `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`; portable/cài mới/auth/wizard/hide-quit PASS, UI restore/undo + actual interrupted journal recovery + bounded automatic worker/web restart (3 attempts, fourth-fault block) PASS; 9.858 resource files khớp SHA. Installer SHA `364F1D03F14810412A5FB21324890BE7DB35ABF0D12F815A70C810266E58D62F`. Source không đổi sau đóng gói; không cần build lại nếu chưa sửa source. 303/303 test/64 files. Hướng dẫn và giới hạn: RESTORE_AND_RECOVERY.md. Không có subagent đang chạy, không commit/push. Phần dưới giữ làm lịch sử.

**Checkpoint 24/10/2026 — hạng mục 2 & 3:** [RESTORE_AND_RECOVERY.md](RESTORE_AND_RECOVERY.md). UI native restore/undo, checksum/current fingerprint/disk preflight, staging/safety copies/journal và crash rollback đã triển khai; web-only không restore. Native tự restart web/worker exit thật 2/5/10s tối đa ba lần/dịch vụ/phiên, giữ session, maintenance/Quit không retry. **303 tests/64 files PASS**, Next/root types/build PASS, actual process-kill journal recovery, native restore/undo, worker/web automatic restart + fourth-fault block PASS. Bản đóng gói mới batch 24/10 01:01:59 ở dist/windows; cần đọc build-report cho verifier cùng batch. Không inference/post/bot, không sửa dữ liệu user/Asset Forge, không commit. Các agent phụ không được khởi động lại. **Toàn bộ checkpoint dưới là lịch sử.**

**Checkpoint mới tối 23/10/2026:** [QUALITY_UX_IMPROVEMENTS.md](QUALITY_UX_IMPROVEMENTS.md). Đã thực hiện đợt “làm hết” về chất lượng/UI/UX: Home guidance/nav nhóm/Models tabs, Editor ba vùng/recoverable drafts/so sánh, waveform/manual caption timing, English CPU CTC tùy chọn, pacing/fixed voice evaluation, catalog/vision/duplicate/learning và brand kit. Có thêm sửa scene seek sau cut: dùng video clips/start/duration thực, test UI seek clip cuối sau cắt. **298 test/63 files PASS**, root/web tsc và Next build PASS; browser workflow, real CPU alignment và branded speech render/child timing có evidence. Không auto-accept vision fixture sai hình; không tạo owner listening. **Batch Windows 22:54:22, verifier 22:56:21: portable/cài mới/native wizard/auth/close/worker recovery/startup failure PASS; toàn bộ 9.857 file khớp SHA, status VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE.** Installer hash `5EE70C45EF35B7D9B943FC2BB672C39A1C4AB5F306AB7D7F89D2B33B07AFEEAF`. Xem `dist/windows/build-report.json` và IMPLEMENTATION_STATUS; không cần build lại nếu source chưa đổi. Các agent đã xong, không agent phụ đang chạy. Không commit/push, không sửa Asset Forge. **Các checkpoint bên dưới là lịch sử.**

**Checkpoint hiện tại ngày 23/10/2026: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), [delta P0](IMPLEMENTATION_DELTA_2026-10-23_P0.md), [phạm vi/cách dùng P0](P0_IMPLEMENTATION.md).** Đợt mới thêm immutable plan edit/source preview/pinned line audition, semantic media matching theo mô tả, bounded caption/mix/encode Repair Planner, voice policy v2 và setup preflight 4 bước. **268 test/54 files PASS**, TypeScript/Next và packaged-backend UI đạt. Actual repair từ giọng thật đạt loudness/no-AI/parent preservation; CPU English mới, retained VI re-score và real embedding CPU có evidence riêng. Batch **21:13:54** đã portable/cài mới/native wizard/auth/close/worker-fault-normalQuit-reopen/live-owner failure PASS; verifier toàn tài nguyên ở `dist/windows/build-report.json`. Không suy kết quả cũ batch 18:56 thay cho P0. Full baseline legacy vẫn thiếu eSpeak. Word alignment, owner listening, genuine gameplay, full runtime bootstrap/clean Windows VM và account/bot/post thật chưa verified; CUDA voice mới chờ GPU app khác. Các agent đã hoàn tất/ngừng, không restart agent hết giới hạn. Không commit/push hoặc sửa Asset Forge. **Toàn bộ phần dưới là lịch sử.**

## Yêu cầu và đầu vào

- Đổi tên thành AUTONOMOUS CREATIVE STUDIO; triển khai app Windows theo `docs/AUTONOMOUS_CREATIVE_STUDIO_MASTER_PROMPT.md` (bản sao master prompt được người dùng cung cấp).
- Giữ Next.js/Node/TypeScript, file JSON/JSONL và DPAPI; không viết lại bằng FastAPI/SQLite.
- AI local-only, VI/EN thực, wizard nhiều bước, Autopilot bền vững, version/QA và quyền đăng riêng.
- Chủ app xác nhận **hiện chưa có gameplay/ảnh/logo thật**. Nghiệm thu game thật bị thiếu đầu vào; chỉ dùng fixture có nhãn, không gọi là gameplay thật.
- Các thay đổi đã lưu trên đĩa; **chưa commit**, không yêu cầu commit/push.

## Đã thêm/sửa trong source

- Đổi tên package/app; shell giao diện sidebar, chọn VI/EN, Overview.
- `packages/automation/src/studio.ts`: schema cấu hình, Autopilot, StudioRun, stage, snapshot hash; lưu nháp, scheduler có khóa/idempotency, enqueue theo ngôn ngữ, cut tạo phiên bản con.
- `packages/automation/src/models.ts`: catalog ứng viên với trạng thái trung thực; không coi catalog là engine đã chạy.
- API `/api/studio`, upload media, phục vụ artifact có range; nhập credential DPAPI; config/probe local tools.
- UI `/studio/autopilots`, `/studio/create`, `/studio/production`, `/studio/editor`, `/studio/library`, `/studio/models`, `/studio/settings`, `/studio/telegram`.
- Wizard Autopilot 7 bước; one-off có 6 nhãn bước nhưng **nội dung vẫn tái sử dụng setup**, chưa đạt đầy đủ yêu cầu editor/Create trong master prompt. Có lưu server giữa bước và bổ sung localStorage để giữ phần đang nhập (bản mới cần test lại).
- `apps/worker/src/studio.ts`: worker STUDIO_RUN: pin file nguồn, script local/được nhập sẵn, narration từng segment, subtitle phrase ước lượng, FFmpeg render, technical QA cơ bản, artifact/manual export; chặn publication chưa xác minh. Cut deterministic trên MP4, giữ parent. Chưa nghiệm thu end-to-end.
- `engines/runner.py`: adapter LLM loopback + JSON schema, Kokoro, nhánh VieNeu **chưa đúng SDK đầy đủ**, GPU lease OS tương thích lock Asset Forge, metadata heartbeat riêng ACS.
- Daemon tick Autopilot, không claim khi paused; Telegram cần enabled + chat/user allowlist; lưu offset trước command để tránh replay. Đây là at-most-once receipt, chưa bảo đảm exactly-once xử lý command.
- Next standalone SSR; `scripts/windows-links.cjs` dùng junction/copy khi Windows chặn symlink; `desktop/prepare.mjs` flatten production deps pnpm cho bundle.
- `src-tauri`: Tauri/Rust Windows app + tray, Next/worker/Node resources, Windows Job Object quản lý process tree; đóng cửa sổ giữ chạy nền, Quit qua tray.
- Proxy cookie auth per-launch; vừa sửa lỗi redirect/Origin từ Next chuẩn hóa `127.0.0.1` thành `localhost`, **cần build và test lại**.
- Không thay đổi môi trường AI, checkpoint hoặc dữ liệu Asset Forge.

## Đã chạy và kết quả

1. Cài dependencies bằng `npx --yes pnpm@10.28.0 install --frozen-lockfile`.
2. `pnpm typecheck`: PASS ở lần kiểm tra trước các thay đổi cuối; cần chạy lại sau khi tiếp tục.
3. Next production standalone build: đã PASS sau junction fix. Build cuối sau auth fix đã dừng theo yêu cầu, có thể để `.next` chưa hoàn chỉnh.
4. Test mới `packages/automation/test/studio.test.ts`: 3/3 PASS (cloud restriction, policy block, draft persistence, concurrent schedule, snapshot reuse).
5. Test chọn lọc `studio.test.ts + publish.test.ts + soak.test.ts`: **10/10 PASS** sau đặt FFmpeg/FFprobe environment.
6. Full baseline suite: có lỗi môi trường thiếu eSpeak, một test gọi `ffmpeg` trực tiếp ngoài PATH; chưa tuyên bố toàn suite PASS. Một hồi quy outbox đã sửa bằng cách giữ enqueue notification và chỉ gate delivery theo Telegram enabled; publish/soak đã chạy lại PASS.
7. Tauri release EXE + NSIS installer build được. Lần đầu thiếu `styled-jsx` do pnpm alias; đã sửa flatten dependency và cập nhật backend portable.
8. `desktop/smoke.mjs`: **native launch + web + worker alive + unauthorized HTTP 401 PASS** trên portable sau dependency fix. Chưa smoke bản cài đặt; chưa chứng minh native visual UI. Evidence: `docs/evidence/acs-native-smoke.json`.
9. `desktop/ui-smoke.mjs`: thất bại tại pairing redirect localhost/cookie. Đã xác định và sửa source proxy + API Origin; **chưa test lại bản build mới**. Không có UI PASS report.
10. Local LLM đã inference bằng model **đang có** `qwen3-vl:4b-instruct-q4_K_M` tại `127.0.0.1:11434`, không phải Qwen3.5-9B. Sau ép JSON schema, trả 3 đoạn có cấu trúc, ~7.48 giây; chưa duyệt fact/editorial. Evidence: `docs/evidence/acs-script-inference.json`.
11. Kokoro thực: tạo WAV English US `af_heart`, **CPU**, 9.2 giây audio, khoảng 25.05 giây cả load/inference, checkpoint SHA-256 có trong evidence. **Chưa nghe duyệt, chưa ASR round-trip; chưa GPU verified**. Evidence: `docs/evidence/acs-english-inference.json`; WAV `.local/benchmarks/english-kokoro.wav`.
12. GPU contention đã xảy ra giữa hai request, adapter trả GPU_BUSY; chưa có automated two-process crash/recovery test hoàn chỉnh.

## Artifact và môi trường hiện có

- Portable: `dist/windows/AUTONOMOUS CREATIVE STUDIO.exe` + thư mục `backend`, `runtime`, `engines` bên cạnh.
- Installer: `dist/windows/AUTONOMOUS CREATIVE STUDIO_0.2.0_x64-setup.exe`.
- **Installer là build cũ hơn dependency/auth fixes; portable backend cũng chưa chứa source fixes cuối. Phải rebuild đồng bộ trước khi giao dùng.**
- Build tooling: `scripts/desktop-build.ps1`, `desktop/prepare.mjs`, `desktop/smoke.mjs`, `desktop/ui-smoke.mjs`.
- Tauri toolchain đang dùng read-only binaries trong `C:/Users/Winka/Projects/Asset-Forge-Studio/.local/desktop-tools/{cargo,rustup}`. Build cache ACS ở `src-tauri/target`.
- `.local/engines/speech`: env Kokoro/soundfile/torch CPU; đã cài `en_core_web_sm`.
- `.local/models/kokoro`: config, weights, `af_heart`, `bf_emma`.
- `.local/engines/vieneu`: SDK `vieneu==3.8.3` + dependency CPU; **chưa tải model/codec và chưa chạy**.
- Lệnh tải torch CUDA 2.8.0 + torchaudio cu128 (~3.2 GiB) đang tải lâu và đã yêu cầu dừng. **Kiểm tra env thật trước khi tiếp tục; không giả định CUDA torch đã cài thành công.**
- FFmpeg local test: `.local/tools/ffmpeg.exe` (copy từ tool có sẵn).
- FFprobe có sẵn: `C:/Users/Winka/Tools/trellis2/tools/python/ffprobe.exe`.
- Model Ollama có sẵn thuộc dịch vụ local của chủ máy; không dừng dịch vụ Ollama khi pause công việc ACS.
- eSpeak chưa cài. Automatic approval review chặn lệnh `msiexec` giải nén MSI; không lách chính sách, không gọi test thiếu công cụ là PASS.
- Data default legacy vẫn ở `%LOCALAPPDATA%/TuToMoFactory/data`; native dùng legacy nếu tồn tại, nếu không dùng `%LOCALAPPDATA%/AutonomousCreativeStudio/data`. Không xóa hay di chuyển dữ liệu cũ.

## Các việc cần làm ngay khi được tiếp tục

1. Đọc git status/diff và master prompt, giữ mọi thay đổi hiện có. Không khởi động lại toàn bộ từ đầu.
2. Kiểm tra process/download đã dừng và tình trạng dependency CPU/CUDA thực tế.
3. Hoàn thiện tài liệu audit/matrix/release yêu cầu trong master prompt; file này là checkpoint tạm, chưa thay thế các tài liệu đó.
4. Build Next lại sau fix host/origin; prepare lại dependency graph; chạy UI smoke, xem screenshot thực.
5. Rebuild installer/portable đồng bộ, smoke native có visual, test shutdown process tree và bản cài.
6. Sửa nhánh VieNeu theo SDK thật: constructor `Vieneu(mode='v3turbo', backbone_repo=<local dir>, model_subfolder='update', moss_tokenizer=<local codec>, device=..., backend=...)`, không dùng `model_name` như code hiện tại. Inspect `.local/engines/vieneu/Lib/site-packages/vieneu/v3turbo.py` và `_v3_turbo_engine`.
7. Tải model/codec có license phù hợp trong bước setup rõ ràng; production offline. Runtime VieNeu dùng remote code cần audit/pin source thực. GPU torch chưa xong không được gọi VI/EN GPU verified.
8. Nghiệm thu fixture end-to-end VI/EN + deterministic cut, checkpoint/resume, targeted sentence edit. Chưa có gameplay thật, chưa có account/token đăng nên không đăng ra ngoài.
9. Hoàn thiện 7-step/6-step đúng nội dung, editor multi-track/transcript, QA stage-level, runtime registry/installation/voice audition. Hiện nhiều phần mới là vertical slice, không được đánh dấu toàn spec hoàn tất.
10. Thêm routing từng content family, source watcher, research/fact verification, semantic matching, account-specific credential/publish policy, Telegram preview/buttons, analytics/Steam attribution, circuit breaker, cross-process failure tests.

## Cảnh báo tính đúng đắn cho lần tiếp tục

- Technical export không phải permission/editorial approval; pipeline ACS hiện giữ publication BLOCKED và xuất manual package.
- Stage research/semantic media/subtitle timing đang flagged/unknown, không coi là fully automated research hoặc word alignment.
- Config snapshot hash chưa đủ để đảm bảo toàn bộ model checkpoint bất biến; cần pin/check weights thực xuyên suốt retry và version.
- Scheduler hiện theo khoảng ngày; chưa hỗ trợ đầy đủ timezone/calendar/quota/novelty/backlog/policy của master prompt. Cần chống lặp nguồn đã hết thay vì sản xuất filler mỗi slot.
- UI legacy game/analytics/review còn tên/chuỗi VI và chủ sở hữu cũ; chưa localization/project-independent toàn diện.
- Credential form hiện chủ yếu global; chưa nối đầy đủ credential theo account.
- Dừng khẩn hiện chặn việc mới/đăng, không cam kết hủy tức thì subprocess đang chạy.
- Portable native smoke trước sửa auth chỉ chứng minh process/backend/401, chưa chứng minh trang app render sau pairing; phải test lại.

## Tiến độ sau khi tiếp tục

- Studio tests tăng lên 8/8 PASS: chống lặp nguồn, stale save, legacy snapshot, narration child.
- Create có component 6 bước riêng; Transcript có sửa câu, server lưu phiên bản con.
- English fixture đã kiểm chứng MP4/SRT/thumbnail/cut và sửa một đoạn giọng, giữ nguyên byte audio đoạn khác (`acs-e2e.json`).
- Đã cài PyTorch CUDA 2.8/cu128 và checkpoint VieNeu/codec có revision/hash; GPU được nhận nhưng audio Việt đang BLOCKED do Asset Forge giữ shared GPU lease.
- Shared OS GPU lease hai process/crash/recovery PASS (`acs-gpu-lease.json`).
- Đã tìm lỗi NextURL chuẩn hóa127.0.0.1→localhost; thêm skipProxyUrlNormalize để giữ origin/cookie. Bản app mới cần chạy lại smoke theo evidence cập nhật.
- Đã tạo đủ audit, workflow, model compatibility, quality gates, release QA và known issues.
- Đang chuẩn bị lại installer đồng bộ. Không dùng installer cũ làm bản nghiệm thu của source mới.
