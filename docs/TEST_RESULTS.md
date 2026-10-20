# Kết quả kiểm thử V4 (2026-10-20)

Môi trường: Linux container, Node 22, FFmpeg 6.1, eSpeak NG 1.51, Tesseract 5, Chromium (Playwright) — **không GPU, không tài khoản nền tảng thật**.

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| Unit + integration | `pnpm test` | **151/151 pass** (25 file) |
| Edge-case matrix | `pnpm test:report` → `docs/EDGE_CASE_MATRIX.md` | **39/39 pass**, mọi case bị chặn có side effect ngoài = 0 |
| Build | `pnpm build` (mọi package + Next.js 16) | thành công |
| E2E offline | `pnpm e2e:offline` | 11 MP4 dựng thật, FFprobe QA + Quality Judge **PASS** cả 11; 636 s CPU |
| Soak 7 ngày (tăng tốc) | `pnpm factory soak 7` | mọi bất biến ✅ — `docs/evidence/SOAK_REPORT.md` |
| UI smoke (Playwright) | `node apps/web/e2e/ui-smoke.mjs` | 9/9 pass (thư viện game, lọc 2D/3D, chi tiết game, wizard sửa/hoàn tác/clip in-out, upload, review, tạo game qua form, mobile 390px không tràn) — ảnh `docs/evidence/*.png` |

## Video mẫu (`docs/samples/`)
| File | Kích thước | Thời lượng | Judge | Trạng thái đăng (đúng thiết kế) |
|---|---|---|---|---|
| game-mb-highlight.short_9x16.mp4 (Machine Brigade, 3D) | 1080×1920 | 23 s | PASS | chờ duyệt game / tài khoản của game |
| game-mb-highlight.long_16x9.mp4 | 1920×1080 | 26 s | PASS | như trên |
| game-lh-teaser.short_9x16.mp4 (Lantern Hollow, 2D) | 1080×1920 | 14 s | PASS | như trên |
| game-lh-teaser.long_16x9.mp4 | 1920×1080 | 16 s | PASS | như trên |
| fixture-fact-venus.short_9x16.mp4 | 1080×1920 | 36 s | PASS | HOLD: claim SOURCED_UNFETCHED (không có Internet để kiểm chứng) |
| fixture-long-venus.long_16x9.mp4 (có chương) | 1920×1080 | 84 s | PASS | HOLD fact |
| fixture-long-venus-cut1.short_9x16.mp4 (long→short) | 1080×1920 | 38 s | PASS | HOLD fact + originality NEEDS_REVIEW (gần short fact) |
| fixture-adaptation-owned.short_9x16.mp4 | 1080×1920 | 29 s | PASS | — |
| fixture-game-devlog.short_9x16.mp4 | 1080×1920 | 26 s | PASS | — |
| fixture-remake-egg.short_9x16.mp4 | 1080×1920 | 25 s | PASS | demo, originality NEEDS_REVIEW |
| fixture-affiliate-demo.short_9x16.mp4 | 1080×1920 | 30 s | PASS | demo affiliate, không đăng |

Mỗi video có `*.judge.json` (báo cáo Quality Judge đầy đủ), `*.frame.jpg`; video game có `*.thumbnail.jpg`. Footage game là **video tổng hợp có nhãn FIXTURE** (xem `KNOWN_LIMITATIONS.md`).
