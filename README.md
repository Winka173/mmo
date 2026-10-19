# Tủ Tò Mò — Autonomous Content Factory

Nhà máy nội dung tự vận hành cho kênh **Tủ Tò Mò** (+ marketing game **Machine Brigade**), **local-first, không database**: toàn bộ trạng thái là file JSON/JSONL dưới `DATA_DIR`.

```bash
pnpm install
pnpm doctor          # kiểm tra FFmpeg, GPU/NVENC, TTS, kênh, Telegram
pnpm e2e:offline     # seed fixture hợp lệ → dựng MP4 9:16 + 16:9 thật → QA FFprobe → báo cáo ngày
pnpm test            # Vitest: storage/lock/queue/scheduler/policy/rights/fact/discovery/telegram/publish/render
pnpm dev             # dashboard http://127.0.0.1:3077 (chỉ localhost)
pnpm worker          # worker nền (scheduler + hàng đợi + Telegram), độc lập với UI
pnpm build           # typecheck + build Next.js
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
| `packages/discovery` | Connector ladder, quyết định thu thập media hợp pháp, chống trùng đa tín hiệu, GameProjectProvider |
| `apps/worker` | Tiến trình nền + CLI |
| `apps/web` | Control Center (Next.js) |

Tài liệu: [ARCHITECTURE](docs/ARCHITECTURE.md) · [POLICY](docs/POLICY.md) · [PLATFORM_CAPABILITIES](docs/PLATFORM_CAPABILITIES.md) · [SOURCE_CAPABILITIES](docs/SOURCE_CAPABILITIES.md) · [RUNBOOK](docs/RUNBOOK.md) · [COSTS](docs/COSTS.md) · [STATUS](docs/STATUS.md)
