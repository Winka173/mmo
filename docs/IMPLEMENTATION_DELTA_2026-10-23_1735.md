# AUTONOMOUS CREATIVE STUDIO — Create có kế hoạch thực

23/10/2026, Asia/Saigon. Tiếp nối delta 16:45. Đây là checkpoint theo phạm vi; master prompt vẫn chưa hoàn tất.

## Create và điểm dừng trước khi tạo giọng

- Với game/custom và facts/product đã chọn nguồn hợp lệ, bước 2 có hành động nghiên cứu/tạo kế hoạch thật. Worker thực hiện intake, ghim bản sao nguồn và hash, research khi phù hợp, tạo script và storyboard rồi dừng **trước TTS/render**. `plan.json` ghi snapshot/hash, lời từng cảnh, nguồn, ngôn ngữ và trạng thái thời gian chưa đo; không có QA hoặc preview giả.
- Job lập kế hoạch hoàn thành, run chờ tiếp tục và không giữ GPU. Bước 3 hiển thị script/storyboard thực; bước 2 đọc claim/quote/citation đã thu thập. Bộ chọn phiên bản và nháp được giữ sau reload. Chưa có biên tập trực tiếp từng dòng trong kế hoạch đã ghim; sửa đầu vào rồi tạo kế hoạch mới, hoặc dùng editor trên bản dựng.
- Bước 4 tiếp tục đúng phiên bản bằng cấu hình giọng đã ghim. Queue continuation dùng khóa/idempotency riêng; bấm lại không tạo job trùng. Crash trước enqueue có thể gọi lại. Worker dùng lại script/research và kiểm tra plan/source hash, vẫn cho phép thời gian cảnh được đo sau TTS. Quyền bị thu hồi, paused/cancelled và source hỏng vẫn giữ/chặn đúng boundary.
- Bước 5 có video thật khi render xong và liên kết Editor; bước 6 có QA của phiên bản cùng private ZIP. Nghiên cứu, kỹ thuật, quyền, fact, nghe giọng và quyền đăng vẫn riêng biệt. Không cấp approval hoặc đăng bài bằng hành động tiếp tục.
- Shorts/localization giữ pipeline lời gốc riêng; guided plan stop mới chưa hỗ trợ hai family đó. Lựa chọn chạy thẳng toàn bộ pipeline vẫn có khi không chọn kế hoạch.
- Child edit/cut/timeline xóa trạng thái continuation của parent, giữ ancestry. Corrupt pinned media chuyển job sang needs_review thay vì tự lặp inference. Python engine invocation tắt bytecode cache trong resource để không tạo file cache ngoài inventory đã đóng gói.

`apps/worker/test/studio-plan.test.ts` dùng mock AI có nhãn, file thật và FFmpeg thật: dừng trước speech/render, restart/continuation, idempotency, giữ script/plan và config cũ, child độc lập, tampered plan/text/media, thiếu quyền và cancelled plan. Không dùng các test này làm chứng nhận giọng/model.

## Kiểm tra và binary

- **234/234 test chọn lọc, 50 file PASS**; TypeScript và Next production build PASS. Evidence: `acs-selected-tests.json`.
- Full baseline trước sửa fixture: **309/335 PASS, 2 assertion lỗi, 24 không chạy**. Thiếu `espeak-ng` ở ba suite legacy; game fixture beforeAll timeout 300s. `acs-full-baseline.json` giữ lỗi và phạm vi, không đổi thành all-pass.
- Đã giới hạn filter threads=1, x264 threads=2 cho synthetic fixture game, giữ FPS/resolution/preset. Seed hoàn thành và **2 test FFmpeg mục tiêu PASS, 15 không được chọn**, `acs-game-fixture-fix.json`. Chưa dùng số này thay cho nghiệm thu toàn suite game.
- Batch **16:50** đã đóng gói/portable/cài mới Unicode-spaces/native wizard VI/EN/auth 200–401/close cleanup/resource full SHA PASS; worker-death/reopen và live-owner startup diagnostic PASS trên đúng binary. Portable SHA `2B15711E50A19A6DBD6DDAD705C51FBB6A3B3491F60FFC991507356A7B296072`; installer SHA `3E12CDE0D552E415EF824D52F524FAB6FFFE651FF33416310935B2915A5869C8`. Đây là **binary trước guided Create mới**, chưa chứa thay đổi ở trên.
- Guided Create đã qua UI bằng nguồn NASA/Qwen/Kokoro/ASR thật: plan dừng trước voice, continuation chờ GPU rồi tự chạy, video 27,397s với ba ASR pass, preview/QA/ZIP 1.032.048 byte, deep link không cache và VI/EN UI. QA giữ freeze/silence UNKNOWN; publication BLOCKED. `acs-create-guided-ui.json` ghi rõ lần UI sau dùng lại run đã dựng thật, không inference lại để che lỗi harness. Hai lần harness lỗi label locator và URL tải tương đối được giữ riêng; không phải model/render failure.
- Khi kiểm tra edit tiếp, phát hiện seek `-ss` trên ảnh tĩnh sau frame đầu tạo MP4 261 byte/zero streams dù FFmpeg exit 0. Renderer đã dùng loop ảnh có giới hạn thời gian, chỉ seek nguồn video. Regression FFmpeg thật cut 5–8s từ timeline ảnh 10s tạo H.264/AAC 7s giải mã đầy đủ, giữ nguồn. Batch tiếp theo chứa fix này đang đóng gói; UI prompt-cut từ bản NASA và native/install/resource hashes còn đang kiểm tra.

Clean-machine setup, genuine gameplay/logo, tài khoản/bot thật và người nghe duyệt vẫn thiếu. Optional models, semantic media/director/dedup, đầy đủ editor/repair, exception-only content authorization, remote creator localization, analytics/Steam và toàn bộ UI localization vẫn còn phần chưa làm hoặc chưa nghiệm thu.
