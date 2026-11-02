# AUTONOMOUS CREATIVE STUDIO — Kiến trúc

## Lớp Studio Windows (đang triển khai)

- Đợt restore/recovery 24/10: `src-tauri/src/supervisor.rs` quản lý web/worker bằng Job Object riêng, retry exit thật với budget 3/dịch vụ/phiên và backoff 2/5/10s; giữ loopback session và không retry khi maintenance/Quit. `maintenance.mjs` chạy ngoài web/worker, giành worker lock và phục hồi journal trước DataStore.init khi startup. Restore UI pin SHA manifest + fingerprint dữ liệu; staging/old copies/journal nằm tại `.restore/<uuid>`, checksum và atomic copy có rollback. Helper chỉ nhận action restore/rollback cố định, không chạy command do request cung cấp. Xem RESTORE_AND_RECOVERY.md.

- Tauri/WebView2 quản lý Next SSR và Node worker bằng Windows Job Object; portable và NSIS chứa Node runtime, backend và mã engine. Python env/model weights cài riêng.
- Khi đặt `ACS_CONFIG_DIR`, shell tạo WebView bằng builder với profile riêng `<config>/webview`; tránh dùng chung browser cache với native instance khác có debug arguments khác. Chạy bình thường không override giữ nguyên profile cũ của người dùng. Khác biệt này không di chuyển JSON/JSONL nguồn; crash-worker recovery vẫn cần xác thực owner/heartbeat và mở lại app.
- Proxy dùng capability cookie HttpOnly theo mỗi lần mở app, loopback host/origin checks; giữ địa chỉ127.0.0.1 qua `skipProxyUrlNormalize`.
- `packages/automation/src/studio.ts` lưu Autopilot và StudioRun dưới `studio/`; snapshot có hash, queue job `STUDIO_RUN` vẫn dùng file store hiện có.
- Guided Create dùng `StudioRun.planning`: requested → ready → continuing. Job plan-only dừng trước voice/render; `plan.json` giữ script/source/snapshot hash. Continuation có lock/idempotency riêng, không biến việc tiếp tục dựng thành approval. Duration được đo về sau không làm thay đổi identity lời/media. Child versions không kế thừa trạng thái planning của parent.
- Qwen Embedding lưu index JSON dẫn xuất theo corpus/config/runtime fingerprint; chỉ original ready roots và chunk nguyên cảnh trong giới hạn công bố. Index stale hoặc malformed không được dùng để suy ra factual/rights/originality approval. Xem `SEMANTIC_SEARCH.md`.
- Scheduler kiểm tra hash media/brief và identity nguồn theo ngôn ngữ; có IANA timezone/windows/quota/backlog/embargo và dry-run. Facts feed dùng bounded RSS/Atom metadata, lexical/recency ranking và ghim bài gốc; bỏ slot khi nguồn hết/stale thay vì tạo filler. Chưa semantic director hoặc full publishing calendar.
- Python runner inference offline, OS byte lock dùng chung GPU lease với Asset Forge; CPU Kokoro không giữ GPU lock. Không đụng weights/env/dữ liệu của app khác.
- Worker pin bản sao media, cache voice/segment, xuất MP4/phụ đề/thumbnail/QA/manual package; phiên bản con cắt hoặc sửa một đoạn narration giữ parent.
- Stage QA/facts/rights độc lập; export kỹ thuật không cho quyền đăng. Auto-publish Studio chưa được nghiệm thu.
- `STUDIO_VOICE` lưu yêu cầu nghe thử bền vững dưới `studio/voices`, WAV dưới `studio/voice-audio`; metadata giữ hash audio, checkpoint và quyết định nghe duyệt riêng.
- Qwen3-ASR chạy trong env riêng, đọc WAV local sau TTS để so lời/ngôn ngữ. Không dùng expected script làm context ASR; không giả định word timing tiếng Việt.
- Aligner English tùy chọn là Python entry riêng `alignment_engine.py`, CPU/local-only, checkpoint/tokenizer/runner/audio hash và acoustic agreement guards; không đổi voice runner/fingerprint. Pipeline chỉ dùng word evidence đã khớp; mixed/unsupported giữ estimated. Manual `set_caption_timing` tạo child với `manually_edited`, không sửa speech.
- Catalog mô tả media lưu revision bất biến theo SHA và atomic head trong `studio/media-catalog`; matching pin metadata tại lần chạy đầu. `STUDIO_MEDIA_VISION` lưu task/keyframe/config/hash riêng, gọi managed Qwen và trả gợi ý chưa duyệt. Insights chống lặp dùng lineage + lexical/source intervals; performance learning chỉ đưa đề xuất khi đủ metric remote hợp lệ, không tự cấp quyền đăng.
- Brand schema/preset revision pin font, subtitle style, CTA, voice profiles và logo có SHA/quyền. Logo được copy vào artifact trước render. Editor tách working draft local khỏi immutable run/version; bản cắt dựng danh sách cảnh từ video clips của saved timeline, không lấy thời gian shot gốc.
- Scene/black/freeze/motion/audio analysis tái sử dụng package games/FFmpeg, lưu source SHA/coverage và flag OCR/semantic/authenticity chưa xác minh. Gợi ý không tự thay shot; child giữ report.
- Private ZIP đóng gói artifact whitelist cùng manifest/review snapshot, byte-bound technical QA và CRC/SHA; durable temp/recovery, authenticated download/range. Export không cấp quyền đăng, không đóng raw sources/secrets/logs/models.
- FileLock chỉ thu hồi PID còn tồn tại khi probe thời điểm sinh chứng minh PID đã được tái sử dụng; owner nonce bảo vệ heartbeat/release. Native startup yêu cầu web health và live worker giữ đúng lock; lỗi cleanup/diagnostic hiện trong splash và config folder đã chọn.
- Adapter LLM dùng chung của cả UI cũ và Studio chặn endpoint ngoài HTTP loopback và chặn redirect; cache phân biệt endpoint/model/request. Không có nhánh fallback AI cloud.
- Kết quả thật và giới hạn xem `RELEASE_QA.md`, `KNOWN_ISSUES.md`; phần V4 dưới đây là nền tảng cũ, không chứng nhận toàn bộ tính năng mới hoàn tất.

## Nguyên tắc
- **Không database.** Nguồn sự thật = file JSON/JSONL dưới `DATA_DIR` (mặc định `%LOCALAPPDATA%/TuToMoFactory/data`). `index/`, `analytics/aggregates.json` chỉ là dữ liệu dẫn xuất, xóa được và dựng lại được.
- **Ghi atomic**: file tạm → `fsync` → `rename` (thử lại khi antivirus khóa), giữ `.bak`. File hỏng → khôi phục từ `.bak`, bản hỏng vào `quarantine/`. File đã bị xóa **không bao giờ** được hồi sinh từ `.bak` (sửa lỗi V3: job "ma").
- **Migration theo phiên bản dữ liệu** (`config/schema-version.json.dataVersion`, hiện tại 2): chạy tự động khi khởi động, có backup trước, không phá hủy (chỉ sao chép/bổ sung), từ chối dữ liệu mới hơn mã nguồn. `factory migrate --dry-run`.
- **Demo/live tách bạch**; fixture luôn `mode=demo` và có nhãn "FIXTURE".
- **Mọi cổng (quyền, fact, originality, game truth, tài khoản) được kiểm tra lại ngay lúc đăng.** Duyệt chỉ là quyết định biên tập.

## Package
| Package | Vai trò |
|---|---|
| `core` | Zod schema, state machine job, cổng quyền/fact/affiliate/AUTO_SAFE, TTL claim |
| `storage` | Atomic file, khóa, audit JSONL, backup có checksum + secrets mã hóa (scrypt+AES-GCM), restore `--dry-run`, migrations, `factory verify` |
| `automation` | Hàng đợi file bền vững, cron theo múi giờ, DailyTopicPlanner |
| `media` | TTS, frame, renderer storyboard (cache theo cảnh), **renderer gameplay**, QA, BrandIdentityEngine (brand kit có phiên bản), GPU Resource Manager, thumbnail (khóa/ứng viên/chấm điểm), probe chi tiết |
| `quality` | **Quality Judge** đa tín hiệu trên MP4 thật + vòng **tự sửa** giới hạn |
| `games` | **Multi-game factory**: registry, intake (ZIP/thư mục/manifest/CSV), GameBuildIntelligence, FootageAnalyzer (OCR), readiness, producer, campaign manager, fixtures 2 thể loại, schedule preview |
| `governance` | BudgetRouter, MultiAccountManager, SourceLicenseRegistry, affiliate recheck, Comment Assistant, LifecycleManager |
| `insights` | Analytics (unknown ≠ 0), doanh thu theo giai đoạn, SelfLearning, A/B, SmartSchedule, OpportunityRadar |
| `discovery` | Connector ladder, thu thập hợp pháp, chống trùng V3 + **CrossPlatformOriginalityEngine** |
| `providers` | LLM (OpenAI-compatible/NEEDS_PROVIDER), kịch bản template, **FactVerificationAgent**, Long→Shorts, Multilingual |
| `platforms` | YouTube Data API, **Meta (FB/IG Reels)**, **TikTok Content Posting**, gói thủ công, mock |
| `telegram` | Bot API, outbox bền vững, lệnh có allowlist + xác nhận 2 bước |
| `apps/worker` | Daemon (scheduler + hàng đợi + Telegram), CLI `factory …`, soak |
| `apps/web` | Control Center Next.js (localhost) |

## Dữ liệu (DATA_DIR)
```
config/{settings,channels,accounts,calendar,schema-version}.json, config/brand-kits/<brand>/brand-kit.json (+ brand-kit-versions/)
games/<gameId>/{game.json, brand-kit.json, verified-features.json, roadmap.json}
games/<gameId>/builds/<buildId>/{manifest.json, changelog.md, checksums.json}
games/<gameId>/media/{<kind>/<sha256>.<ext>, proxy/, analysis/<sha256>.json, index.json}
games/<gameId>/uploads/<uploadId>/import-manifest.json
games/<gameId>/campaigns/<id>/{brief,schedule,kpis}.json
games/<gameId>/projects/<projectId>/{input.json, history/, readiness.json, footage-map.json, render-plan.json, review.json, rights.json, storyboard.json}
projects/<projectId>/… (dự án dùng chung pipeline đăng; video game có gameId)
  renders/<format>/{<format>.mp4, .vi.srt, .thumbnail.jpg, thumbnails.json, judge-report.json, repair-log.json, render-proof.json, v1/, v2/}
  originality-report.json, fact-check.json, citations.md, lifecycle.json, gates.json
registry/{rights/<assetKey>.json, provenance.jsonl, originality/index.jsonl}
analytics/{snapshots/YYYY-MM.jsonl, revenue.jsonl, aggregates.json}
learning/{lessons,hypotheses,failed-experiments,learned-settings}.json, learning/history/
experiments/<id>.json · comments/{inbox.jsonl, decisions.jsonl, faq.json}
jobs/{queued,running,succeeded,failed,needs_review,manual_action}/ · audit/ · costs/ · reports/ · backups/ · quarantine/
```
Lý do giữ `projects/<id>` cho video game: hàng đợi, cổng và publisher dùng chung một đường đi; thông tin riêng của game nằm ở `games/<gameId>/projects/<id>` theo mục Y4.

## Luồng video game
`Create Game Video` (UI/CLI) → `input.json` (lưu nháp, hoàn tác) → `gameReadiness` (asset thuộc đúng game, gameplay thật, nhãn build, claim tính năng/ngày/số liệu, CTA chỉ link đã xác nhận, nhạc có license, embargo, tài khoản) → job `GAME_PRODUCE` → FootageAnalyzer (cache theo SHA) → `renderGameplayVideo` 9:16 và 16:9 (fill hoặc nền mờ, không crop gây hiểu nhầm; logo/tên game/nhãn build/chú thích; TTS theo brand kit game; CTA outro) → thumbnail (khóa người dùng ưu tiên tuyệt đối; nếu không thì ≥3 ứng viên từ khung thật + chấm điểm) → QA + Quality Judge → `Project` (gameId) + metadata riêng game (UTM nếu có) → job PUBLISH (key `gameId:projectId:rN:platform`) → **gamePublishGate**: kiểm tra lại readiness, dấu vân tay duyệt (đổi thumbnail ⇒ hủy duyệt), tài khoản thuộc game + allowlist + đã xác nhận + đúng remote id.

## Luồng nội dung Tủ Tò Mò
brief → storyboard → TTS (cache) → frame → segment (cache theo cảnh) → concat → loudnorm → phụ đề → MP4 → QA → **Judge + tự sửa ≤2 vòng** (chỉ cảnh/phụ đề bị lỗi) → cổng quyền/fact/coverage/affiliate/**originality** → registry nguồn gốc → metadata → PUBLISH.

## Đăng bài
Thứ tự lúc đăng: kill switch → demo → cổng (gồm originality) → QA → game gate / tài khoản → duyệt/AUTO_SAFE → `externalPostingEnabled` → kiểm tra năng lực publisher (đúng tài khoản/scope) → giới hạn ngày → reconcile → upload. Chỉ khi API xác nhận mới `PUBLISHED`; mơ hồ ⇒ reconcile trước, không đăng lại. Không có quyền API ⇒ gói thủ công + Telegram, người dùng xác nhận bằng `/posted`.

## Lịch (worker)
daily-plan 07:00 · trend-scan 07:20 · rights-audit 06:15 · lifecycle 06:25 · affiliate-recheck 06:35 · metrics mỗi 6 giờ · comment-poll mỗi giờ · learning CN 18:40 · daily-report 19:00 · backup 03:30. Slot bị lỡ chạy đúng 1 lần; key theo slot nên không chạy trùng.
