# V4 Audit — trạng thái repo trước khi nâng cấp V4–V7

Ngày audit: 2026-10-20. Môi trường: Linux container, Node 22.22, pnpm 10.28, FFmpeg 6.1, eSpeak NG 1.51 (cài trong phiên này), **không GPU**, mạng chỉ tới npm/apt. Commit gốc: `fa2939e` (Phase 0 + Phase 1).

## 1. Kết quả chạy thử baseline
| Lệnh | Kết quả |
|---|---|
| `pnpm install` | OK (100 package) |
| `pnpm test` (trước khi cài eSpeak) | 61/62 — test render thất bại vì thiếu `espeak-ng` (lỗi `BINARY_MISSING` có thông báo rõ ràng, đúng thiết kế) |
| `pnpm test` (sau khi cài eSpeak) | **62/62 pass**, 9 file |
| `pnpm typecheck` | OK |

## 2. Đối chiếu A–AG (trước V4)
Ký hiệu: ✅ có & chạy · 🟡 một phần · ❌ chưa có · 🔒 bị chặn bởi credential/quyền bên ngoài

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| A/B Hard rules, demo vs live | ✅ | `mode: demo` không bao giờ đăng; kill switch; externalPostingEnabled=false mặc định |
| C File-only storage, queue, lock | ✅ | atomic write + .bak + quarantine; FileQueue + idempotency + recover |
| C Scheduler cron + catch-up | ✅ | catch-up đúng 1 lần |
| C Remotion | ❌ | renderer là FFmpeg+Sharp (đã ghi rõ trong ARCHITECTURE) |
| D1 Content types | 🟡 | thiếu các type game generic (GAME_MECHANIC, GAME_CHARACTER, …) |
| D2 Planner | ✅ | planDay với tỉ lệ cuộn |
| D3 Claim/rights | ✅ | gate quyền/fact/affiliate |
| E Render/QA | 🟡 | QA kỹ thuật có (kích thước, codec, black, silence, LUFS, SRT); **không** có chấm điểm biên tập, không lấy mẫu khung hình, không auto-repair |
| F Publish | 🟡 | YouTube adapter (chưa thử API thật 🔒); Meta/TikTok = gói thủ công |
| G Storage layout | 🟡 | `game/machine-brigade/` hard-code; không có `games/<gameId>/` |
| H Telegram | 🟡 | thiếu `/emergency_stop /budget /games /game /campaigns /review /doctor` |
| I UI | 🟡 | 4 trang: tổng quan, dự án, jobs, cài đặt |
| J Cost | 🟡 | ghi costs JSONL, trần tháng; không có BudgetRouter, trần ngày/tuần/video thực thi |
| O Discovery | ✅ | ladder, dừng CAPTCHA, chống trùng URL/ảnh/văn bản |
| P Game | 🟡 | **chỉ Machine Brigade**: `ProjectPlan.brand` enum `tutomo | machine-brigade`, `MACHINE_BRIGADE_BRAND` hằng số, đường dẫn `game/machine-brigade` cứng; không nhận gameplay video/thumbnail người dùng |
| Q Edge matrix | 🟡 | ~20 case có test; chưa có ma trận tài liệu |
| T Migration | ❌ | `SCHEMA_VERSION` có nhưng `migrations.ts` được tham chiếu trong comment **không tồn tại** |
| U Quality judge / brand kit | ❌ | brand kit là hằng số code, không version, không theo game |
| V Originality / FactAgent / License registry | 🟡 | dedup ảnh/text có; không có video-frame/audio fingerprint, không có registry revoke→hold |
| W Analytics / learning / A/B / smart schedule | ❌ | `metrics: null` trong báo cáo |
| X Radar / multilingual / long→shorts / thumbnail optimizer | 🟡 | chỉ `deriveCutdownBrief` thủ công |
| Y Multi-game | ❌ | không có GameProject generic, wizard, intake, build intelligence, campaign |
| Z Affiliate recheck / comment / lifecycle / multi-account | 🟡 | affiliate gate tĩnh; còn lại chưa có |
| AA Cost/revenue optimizer | ❌ | |
| AB doctor/verify/backup/restore --dry-run, GPU manager | 🟡 | doctor + backup/restore có; không có verify, dry-run, backup mã hóa, GPU manager |
| AC Edge-case matrix | ❌ | |
| AD UI V4 | ❌ | |

## 3. Phụ thuộc runtime phát hiện
FFmpeg/FFprobe (bắt buộc), eSpeak NG (TTS offline), Sharp (ảnh), Next.js 16 (UI), zod, vitest. Tùy chọn: Piper, `nvidia-smi`, LLM OpenAI-compatible. Không DB/Redis.

## 4. Schema file hiện có
`config/settings.json` (Settings v1), `projects/<id>/{project,brief,plan,claims,rights-manifest,storyboard.*,qa-report.*,publications,metadata,gates}.json`, `jobs/<state>/<id>.json`, `discovery/candidates/*.json`, `discovery/checksums/history.jsonl`, `audit/*.jsonl`, `costs/*.jsonl`, `telegram/outbox`.

## 5. Quota / chi phí / tuân thủ — rủi ro
| Rủi ro | Mức | Xử lý V4 |
|---|---|---|
| YouTube quota 10 000 unit/ngày (upload ≈1 600) | TB | SmartSchedule giới hạn; reconcile trước retry |
| Gọi cloud trả phí ngoài ý muốn | Cao | BudgetRouter: allowlist + trần ngày/tuần/tháng/video, mặc định $0 ⇒ chặn |
| Đăng nhầm kênh game ↔ Tủ Tò Mò | Cao | MultiAccountManager + destinationAllowlist theo gameId, chặn cứng |
| Quảng bá tính năng game chưa có | Cao | GameBuildIntelligence + gate claim theo build |
| Footage AI/concept bị coi là gameplay | Cao | kind `ai_concept` không bao giờ được gắn nhãn gameplay; gate |
| Re-up nội dung người khác | Cao | rights gate + originality engine + registry revoke |
| Metric bịa | TB | `null` = không biết; không bao giờ điền 0 |

## 6. Kế hoạch triển khai (bounded, không rewrite)
Wave 1 nền tảng → Wave 2 multi-game → Wave 3 quality/originality/fact/rights → Wave 4 distribution/lifecycle → Wave 5 analytics/learning → Wave 6 intelligence → Wave 7 soak. Kết quả thực tế từng wave ghi ở `docs/TEST_RESULTS.md` và `docs/STATUS.md`.
