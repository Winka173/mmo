# AUTONOMOUS CREATIVE STUDIO

Studio sáng tạo và marketing Windows dùng AI local, nhiều dự án/thương hiệu/game và tiếng Việt/Anh. Giữ kiến trúc **Next.js + Node worker + JSON/JSONL**; không chuyển dữ liệu cũ sang database.

**Đang triển khai, chưa hoàn thành toàn bộ master prompt.** Bản Windows: `dist/windows/AUTONOMOUS CREATIVE STUDIO.exe` (giữ các thư mục đi kèm); bộ cài NSIS cùng thư mục. Python/model weights được cài riêng và cấu hình tại Settings. Xem [nghiệm thu thực tế](docs/RELEASE_QA.md), [vấn đề còn lại](docs/KNOWN_ISSUES.md), [model](docs/MODEL_COMPATIBILITY.md), [checkpoint](docs/IMPLEMENTATION_RESUME.md).

Build Windows: `pnpm desktop:build`. Kiểm tra: `pnpm desktop:smoke`, `node desktop/ui-smoke.mjs`. Không tự đăng bài khi chưa có policy/quyền/kênh được xác minh. Tủ Tò Mò và Machine Brigade dưới đây là nội dung/fixture legacy, không phải giới hạn sản phẩm.

Tiến độ và cách mở app: [IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md). Hướng dẫn thao tác Studio hiện tại: [USER_GUIDE.vi.md](docs/USER_GUIDE.vi.md). Models & Tools có thể tìm setup folder, cấu hình engine và tạo mẫu giọng VI/US/UK thật để nghe duyệt; Qwen3-ASR local hỗ trợ đối chiếu lời đọc. Python/model/FFmpeg vẫn cài riêng. Adapter LLM dùng chung chặn endpoint cloud và redirect.

V4 (2026-10): multi-game (gameplay/thumbnail/ảnh/logo/build/changelog/CTA/tài khoản riêng mỗi game), Quality Judge + tự sửa, Originality chéo nền tảng/ngôn ngữ, FactVerificationAgent, Source License Registry, BudgetRouter, MultiAccount, Meta/TikTok adapters, Analytics/Self-learning/A-B/Smart schedule/Opportunity radar, Long→Shorts, Multilingual, Lifecycle, Comment assistant, soak 7 ngày. Xem [STATUS](docs/STATUS.md) và [KNOWN_LIMITATIONS](docs/KNOWN_LIMITATIONS.md).

```bash
pnpm install
pnpm doctor          # kiểm tra FFmpeg, GPU/NVENC, TTS, kênh, Telegram
pnpm e2e:offline     # seed fixture hợp lệ → dựng MP4 9:16 + 16:9 thật → QA FFprobe → báo cáo ngày
pnpm test            # Vitest: storage/lock/queue/scheduler/policy/rights/fact/discovery/telegram/publish/render
pnpm dev             # dashboard http://127.0.0.1:3077 (chỉ localhost)
pnpm worker          # worker nền (scheduler + hàng đợi + Telegram), độc lập với UI
pnpm build           # typecheck + build Next.js
pnpm factory games   # CLI V4 (xem docs/USER_GUIDE.md)
pnpm test:report     # test + docs/EDGE_CASE_MATRIX.md
pnpm factory soak 7  # 7 chu kỳ ngày tăng tốc có bơm lỗi
```

| Thư mục | Vai trò |
|---|---|
| `packages/core` | Zod domain schemas, state machine job, cổng quyền/fact/affiliate/AUTO_SAFE, chấm điểm |
| `packages/storage` | Ghi atomic (temp+fsync+rename+.bak), khóa file PID/heartbeat, JSONL audit, backup/restore, secrets (DPAPI) |
| `packages/automation` | Hàng đợi file bền vững, cron theo múi giờ + catch-up, DailyTopicPlanner |
| `packages/media` | TTS (eSpeak NG/Piper), khung hình Sharp, dựng FFmpeg, phụ đề ASS/SRT, chương YouTube, QA |
| `packages/providers` | LLM (OpenAI-compatible / NEEDS_PROVIDER), kịch bản template xác định, kiểm chứng nguồn |
| `packages/platforms` | `PlatformPublisher`: YouTube Data API (resumable + reconcile), gói đăng thủ công, mock |
| `packages/telegram` | Bot API, outbox bền vững, allowlist + xác nhận 2 bước, báo cáo ngày |
| `packages/discovery` | Connector ladder, thu thập hợp pháp, chống trùng V3 + CrossPlatformOriginalityEngine |
| `packages/games` | Multi-game: registry, intake, build intelligence, footage analyzer, readiness, producer, campaigns |
| `packages/quality` | Quality Judge trên MP4 thật + tự sửa giới hạn |
| `packages/governance` | BudgetRouter, MultiAccountManager, SourceLicenseRegistry, affiliate recheck, comment assistant, lifecycle |
| `packages/insights` | Analytics, self-learning, A/B, smart schedule, opportunity radar |
| `apps/worker` | Tiến trình nền + CLI |
| `apps/web` | Control Center (Next.js) |

Tài liệu V4: [V4_AUDIT](docs/V4_AUDIT.md) · [USER_GUIDE](docs/USER_GUIDE.md) · [GAME_ONBOARDING](docs/GAME_ONBOARDING.md) · [CONTENT_POLICY](docs/CONTENT_POLICY.md) · [RIGHTS_REGISTRY](docs/RIGHTS_REGISTRY.md) · [COST_MODEL](docs/COST_MODEL.md) · [EDGE_CASE_MATRIX](docs/EDGE_CASE_MATRIX.md) · [TEST_RESULTS](docs/TEST_RESULTS.md) · [KNOWN_LIMITATIONS](docs/KNOWN_LIMITATIONS.md)

Tài liệu: [ARCHITECTURE](docs/ARCHITECTURE.md) · [POLICY](docs/POLICY.md) · [PLATFORM_CAPABILITIES](docs/PLATFORM_CAPABILITIES.md) · [SOURCE_CAPABILITIES](docs/SOURCE_CAPABILITIES.md) · [RUNBOOK](docs/RUNBOOK.md) · [COSTS](docs/COSTS.md) · [STATUS](docs/STATUS.md)
