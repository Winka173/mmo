# Soak test — 7 ngày tăng tốc (dry-run render, nền tảng giả lập)

Chạy lúc 2026-10-20T10:51:13.296Z · DATA_DIR tạm: `/tmp/ttm-soak-rBWAkU` · tổng upload lên YouTube giả lập: 6

| Ngày | Ngày (VN) | Đăng (xác nhận) | Tổng upload | Gói thủ công | Sự cố bơm vào | Khôi phục | Báo cáo | Hàng đợi cuối ngày |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-02 | 1 | 1 | 0 | — | — | có | queued=0 running=0 succeeded=4 failed=0 needs_review=1 manual_action=0 |
| 2 | 2026-11-03 | 1 | 2 | 0 | upload mơ hồ (mất mạng sau khi YouTube đã nhận) | — | có | queued=0 running=0 succeeded=8 failed=0 needs_review=2 manual_action=0 |
| 3 | 2026-11-04 | 1 | 3 | 0 | YouTube 429 | — | có | queued=0 running=0 succeeded=12 failed=0 needs_review=3 manual_action=0 |
| 4 | 2026-11-05 | 1 | 4 | 0 | worker chết khi đang giữ DAILY_PLAN | {"deduped":0,"requeued":1,"failed":0} | có | queued=0 running=0 succeeded=16 failed=0 needs_review=4 manual_action=0 |
| 5 | 2026-11-06 | 1 | 5 | 0 | lịch chạy trùng (tạo job mới: false) | — | có | queued=0 running=0 succeeded=20 failed=0 needs_review=5 manual_action=0 |
| 6 | 2026-11-07 | 1 | 6 | 0 | file job JSON hỏng trong hàng đợi | — | có | queued=0 running=0 succeeded=24 failed=0 needs_review=6 manual_action=0 |
| 7 | 2026-11-08 | 0 | 6 | 0 | kill switch bật lúc 07:00 | — | có | queued=0 running=0 succeeded=27 failed=0 needs_review=8 manual_action=0 |

## Bất biến

- ✅ noDuplicateRemotePosts
- ✅ dailyCapRespected
- ✅ everyDayReported
- ✅ noPaidSpend
- ✅ tiktokNeverMarkedPublished
- ✅ corruptJobQuarantined
- ✅ telegramOutboxQueued

Ghi chú: render được thay bằng MP4 mẫu đã dựng sẵn để tăng tốc (dry-run). Một vòng E2E thật có dựng video xem `docs/TEST_RESULTS.md`.
