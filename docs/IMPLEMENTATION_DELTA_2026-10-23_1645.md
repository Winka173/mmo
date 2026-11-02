# AUTONOMOUS CREATIVE STUDIO — local retrieval và production QA

23/10/2026, Asia/Saigon. Tiếp nối delta 15:30 và 16:15. Chưa hoàn tất master prompt; không thay người dùng duyệt nội dung, cấp quyền hoặc nghe giọng.

## Qwen Embedding có inference và UI thật

- Thêm profile **Qwen3-Embedding-0.6B** theo nhu cầu: revision `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`, bảy file/1.207.486.477 byte; weights SHA `0437e45c94563b09e13cb7a64478fc406947a93cb34a7e05870fc8dcd48e23fd`. Card đã pin khai Apache-2.0. Tái sử dụng runtime ASR isolated tương thích, không pip/install hay sửa package runtime đó. Cài profile chỉ tải model đã chọn, không cài toàn bộ catalog.
- Engine riêng, offline/no remote code, last-token pooling, vector L2 1024 chiều. Hash text/query, file checkpoint, tokenizer, runtime, instruction, pooling, device/dtype; từ chối silent truncation, vectors sai hoặc runtime đổi giữa batch. CUDA mặc định; CPU chỉ khi chọn tường minh. Không cloud/fallback khi GPU bận.
- `acs-semantic-inference.json`: ba **bản nháp đã dựng thật** được chép đúng hash (NASA Venus VI/EN và calibration có nhãn không-gameplay), ba truy vấn cố định trên CPU. Đúng nhóm đứng đầu trong ba truy vấn; similarity VI Venus 0,5667, EN Venus 0,7835, calibration 0,6749. Đây không phải benchmark recall tổng quát hoặc factual/rights/originality approval.
- `acs-semantic-cuda.json`: CUDA thật, ba text VI/EN kiểm soát, 1,532s load/inference, 9,438s toàn process, 1.149,52 MiB PyTorch peak allocated; matching Venus 0,6623 so với library 0,1259. Không dùng số này làm ETA mọi kịch bản.
- `acs-semantic-ui.json`: cài/reuse/apply đúng profile, verification thật, dựng index và truy vấn VI/EN qua UI SSR/worker production, liên kết đúng phiên bản, không lỗi browser; anonymous 401/Origin lạ 403. UI test dùng CPU được chọn trước trong data riêng; không đổi config production.
- Index `studio/semantic/index.json` chỉ là dẫn xuất, JSON/JSONL gốc giữ nguyên. Tối đa 100 bản gốc ready gần nhất/600 chunk, dừng ở ranh giới bản gốc, không cắt mất script đã index; hiển thị số được index/tổng đủ điều kiện. Child/cut loại ra vì narration gốc có thể không còn nguyên. Corpus/config/runtime thay đổi thì giữ truy vấn để yêu cầu rebuild. Failed rebuild không đè index hợp lệ; GPU busy giữ task queued. Chưa incremental cache, auto refresh, semantic dedup gate hoặc originality certificate.

Xem [SEMANTIC_SEARCH.md](SEMANTIC_SEARCH.md). Contract mới kiểm tra file thật/vector giả có nhãn: ranking, root/child coverage, thư viện lớn không truncate script, stale/runtime change, malformed vector, GPU wait/resume và source/config không đổi.

## Product VI/EN trên GPU

GPU nhả khóa; đã resume run Việt đang chờ và dùng lại research/script đã lưu, không dựng lại thành công giả. `acs-product-e2e.json`:

| Locale | Run | MP4 | Voice/ASR | Còn cần review |
|---|---|---|---|---|
| VI | `64b9dea9-0d71-457a-a5e3-da1cf41a321c` | 28,073s | VieNeu CUDA, local ASR khớp lời | Hai caption khoảng 21,22 ký tự/giây so với ngưỡng heuristic 20 |
| EN | `e1bc5c12-67fe-4159-adb5-00972e42f138` | 40,003s | Kokoro CUDA, local ASR khớp lời | Dài hơn mục tiêu 30s; creative duration UNKNOWN, caption readability heuristic pass |

Hai bản dùng nguồn Adafruit thật, quote/citation, đồ họa font gốc, disclosure đọc và description theo ngày; fresh-source preflight trả UNCHANGED_RETRIEVED_EVIDENCE. Không affiliate link/program thật, không trải nghiệm dùng thử, không đăng hoặc human approval. File nằm dưới `.local/product-e2e/1792739049254/data/studio/artifacts/<run>/final.mp4`. Source/value hiện tại có thể đổi sau benchmark; lần đăng vẫn phải kiểm tra lại.

QA mới hiển thị stage **flagged** cho mọi warning chưa pass (thời lượng sáng tạo, freeze/black/silence/loudness và captions); không chỉ giữ warning trong JSON rồi hiện technical pass. Regression dùng FFmpeg thật cho MP4 encode/captions pass nhưng lệch target, xác nhận QA flagged và eligibility blocked. Các bản đã xuất trước fix giữ trạng thái/lịch sử cũ, finding vẫn có trong qa.json.

## ASR trên cùng chín audio FLEURS bằng CUDA

`acs-asr-corpus-cuda.json`: đúng byte/hash của chín audio đã đo CPU, CC-BY-4.0/revision/attribution giữ nguyên. Ngôn ngữ đúng 9/9, 98,24s audio; runner 31,246s, process 59,110s, PyTorch peak 4.480,79 MiB. VI 4/105 lỗi âm tiết (3,81%), EN 7/69 lỗi từ (10,14%), Mandarin 1/105 lỗi ký tự (0,95%). Kết quả CPU trước đó vẫn giữ riêng: EN 6/69, Mandarin 3/105. Không chọn chỉ số đẹp hơn để thay kết quả; precision/device có sai khác. Chín clip vẫn không đủ hiệu chỉnh ngưỡng 0,15 hoặc chứng nhận dịch/TTS/word timing.

## Reliability và đóng gói

- `acs-worker-health-ui.json` đã ngắt **worker của data bài test riêng**: native/web vẫn sống, API worker=null/dead dù lock còn, UI VI/EN có hướng dẫn mở lại; mở lại có worker mới và hash nháp không đổi. Không hứa automatic restart mọi lỗi.
- Timer heartbeat mới không làm worker thoát vì lỗi ghi tạm thời, không chạy chồng heartbeat, release chờ heartbeat đang ghi để tránh hồi sinh lock sau thoát. Regression gây lỗi ghi thật đạt.
- Full resource comparison đã phát hiện race khi source engine mới/pycache thay đổi giữa NSIS build lâu và portable copy. Không dùng native page smoke để che lỗi resource. Đã chuyển Tauri/portable sang **snapshot `desktop/engines`**, chụp trước build và loại Python cache; hai gói lấy cùng snapshot. Thư mục `.pnpm` trùng vẫn được flatten/remove để tránh MAX_PATH. Verification thất bại giờ ghi FAILED_RESOURCE_OR_SMOKE_VERIFICATION rõ trong build-report.
- Đang build/đóng gói đồng bộ batch này. Chỉ gán native/install/hash/resource acceptance cho đúng binary sau khi command thực đạt. Clean-machine setup và mọi in-place upgrade vẫn chưa được chứng minh.

Master prompt vẫn còn phần UI Create từng bước thực sự điều khiển intermediate production, semantic media/director/dedup nâng cao, full repair/editor, exception-only content authorization, các adapter/model tùy chọn, analytics/Steam và localization toàn UI. Gameplay/logo, bot/account thực và owner listening chưa có; không thay bằng fixture hoặc approval giả.
