# Chi phí

| Thành phần | Mặc định | Trả phí? |
|---|---|---|
| Dựng video (FFmpeg + Sharp, CPU/NVENC) | Có | Không |
| TTS eSpeak NG | Có | Không |
| TTS Piper (tùy chọn) | Không | Không (kiểm tra license từng giọng) |
| LLM runtime | Không cấu hình → template xác định | Chỉ khi bạn cấu hình API riêng (`LLM_USD_PER_1K`) |
| Cloud AI video/ảnh | Không có | — |
| YouTube Data API | Miễn phí theo quota | Không |
| Telegram Bot API | Miễn phí | Không |

Claude Max / Claude Code là công cụ **phát triển**, không phải runtime API. Không có tín dụng khuyến mãi nào được giả định. Trần chi phí: `budgets.monthlyUsdCap` / `perVideoUsdCap` (mặc định 0 ⇒ chặn mọi chi phí trả phí); chi phí ghi `costs/YYYY-MM.jsonl`.
