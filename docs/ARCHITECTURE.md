# Kiến trúc (V4)

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
