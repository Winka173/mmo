# Mô hình chi phí

**Claude Max / Claude Code là công cụ PHÁT TRIỂN, không phải API runtime miễn phí cho vận hành tự động.** Runtime chỉ dùng công cụ local hoặc provider API riêng bạn tự cấu hình, có ngân sách.

| Thành phần | Mặc định | Trả phí? | Ghi sổ |
|---|---|---|---|
| Dựng video (FFmpeg/Sharp, CPU; NVENC khi đã thử thành công) | có | không | thời gian encode (ước tính điện nếu bạn nhập giá kWh) |
| TTS eSpeak NG (GPL engine, audio dùng thương mại được) | có | không | — |
| Piper (tùy chọn) | không | không — kiểm tra license từng giọng | — |
| OCR Tesseract (tùy chọn) | nếu cài | không | — |
| Quality Judge FAST/STANDARD | có | không | — |
| Quality Judge PREMIUM | không | có, qua BudgetRouter | reservation + receipt |
| LLM (chuyển ngữ, kịch bản) | NEEDS_PROVIDER | chỉ khi bạn cấu hình (`LLM_USD_PER_1K`) | reservation + receipt |
| Cloud video/ảnh AI | không có adapter bật sẵn | có | — |
| YouTube/Meta/TikTok/Telegram API | miễn phí theo quota | không | — |

## BudgetRouter
1. Ưu tiên công cụ **local** có năng lực đủ.
2. Cloud chỉ khi: tác vụ được phép dùng cloud (theo cảnh), provider nằm trong `spend.paidProviderAllowlist`, có credential, và **trần ngày/tuần/tháng/video** cho phép ước tính.
3. Ghi `reservation` (ước tính) **trước** khi gọi; `guard()` ngay trước request (kill switch/hết trần ⇒ hủy); ghi `receipt` (số thực provider báo; nếu không báo thì đánh dấu ước tính) sau khi gọi. Tiền tệ khác ⇒ lưu tỷ giá + nguồn + thời điểm.
4. Mặc định mọi trần = 0 ⇒ chặn mọi chi phí trả phí.

Chi phí/bài = tổng chi tháng ÷ bài **đã đăng xác nhận** (không phải số lần thử). Không có bài ⇒ "không rõ".

## Doanh thu
Chỉ từ báo cáo/API affiliate được cấp quyền (`factory revenue-import`). Giai đoạn `pending → approved → paid`, hủy/hoàn trừ ra; net = approved + paid. Không suy doanh thu từ lượt xem. Không có dữ liệu ⇒ "KHÔNG RÕ". Doanh thu affiliate không bị trộn với KPI game.
