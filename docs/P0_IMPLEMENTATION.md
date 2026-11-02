# P0 — AUTONOMOUS CREATIVE STUDIO

Ngày 23/10/2026. Đây là đợt P0 chất lượng đã chốt: ghép media theo nội dung, voice/caption, sửa kế hoạch trước khi dựng, sửa theo stage và setup máy mới. Không phải tuyên bố hoàn tất toàn bộ master prompt.

## Những thay đổi sử dụng được

| Mục | Đã thực hiện | Phạm vi nghiệm thu |
|---|---|---|
| Ghép cảnh | Qwen Embedding local đối chiếu lời đọc với mô tả nguồn/scene; pin SHA, kiểm khoảng bằng FFprobe, hạn chế lặp, tránh khoảng đen/đứng hình đã đo; báo nguồn thiếu mô tả | 6 contract tests; actual CPU embedding 3/3 trên ảnh tự tạo có metadata. Không nhận biết pixel/gameplay tự động |
| Voice/caption | Gate v2 bảo vệ số/phủ định; Unicode pronunciation; caption grouping v2; ASS literal; cache QA có version và tính lại từ transcript đã ghim khi có thể | 5 mẫu English CPU mới; re-score đủ 5 dòng VieNeu CUDA cũ; phát hiện hai lỗi số bị gate cũ cho qua; FFmpeg/libass thật |
| Sửa trước khi dựng | Create bước 3 sửa riêng lời đọc, chọn media đã ghim, đổi điểm bắt đầu video; Save tạo kế hoạch con, giữ bản gốc/research/config. Nghe thử riêng câu đã lưu bằng cấu hình đóng băng | Contract worker/disk/FFmpeg; UI có harness riêng. Đổi global config sau đó không thay mẫu thử hay kế hoạch đã chọn |
| Repair Planner | Đọc QA và đề xuất caption regroup / audio normalization / encode; xem stage chạy lại, lịch sử, hai lượt mỗi loại trong chuỗi. Mỗi sửa tạo child; facts/rights không được giải quyết bằng retry | Giữ lời/caption và nguồn; mix stream-copy hình; không gọi AI; kiểm hash kế hoạch/timeline, chống stale, idempotency và retry budget |
| Setup | Models & Tools có 4 bước VI/EN, GPU/disk/RAM/runtime/model checklist, hướng xử lý, persist. Runtime Ollama riêng có version/resume/SHA; speech downloader kiểm checksum upstream | Preflight thực trên Windows hiện tại và các contract download/extraction. Full Ollama ZIP và VM Windows sạch chưa nghiệm thu |

## Cách dùng qua UI

1. **Models & Tools:** chọn thư mục ACS riêng và profile → **Kiểm tra máy trước** → xử lý mục đỏ → cài profile → Apply → kiểm chứng inference/nghe mẫu. Chỉ tải profile được chọn. FFmpeg/FFprobe hiện cần đường dẫn đã có trong Settings.
2. **Create:** chọn nguồn và brief → tạo kế hoạch ở bước 2 → bước 3 sửa câu/chọn media → **Lưu thành phiên bản kế hoạch mới**. Bản gốc được giữ. Có thể nghe thử riêng câu đã lưu; không cần dựng cả video để thử câu.
3. **Create bước 4:** tiếp tục đúng kế hoạch đã chọn để dựng lời, caption, preview và QA. Thay câu trong bản nháp không sửa âm thầm kế hoạch đã ghim.
4. **Editor → Quality → Repair Planner:** phân tích QA của đúng phiên bản, xem stage bị ảnh hưởng và chạy sửa thành phiên bản mới. Không có đề xuất phù hợp hoặc đã hết lượt thì sửa trực tiếp/duyệt bằng chứng; app không chạy vô hạn.
5. Với local media có mô tả, đặt `acs-media.json` cùng thư mục nguồn; schema và ví dụ trong [P0_MEDIA_MATCHING.md](P0_MEDIA_MATCHING.md). Đây là mô tả của chủ nguồn, không phải chứng minh hình hoặc quyền. Nguồn không có metadata vẫn dựng draft nhưng agreement giữ UNKNOWN. Đồ họa nghiên cứu vẫn gắn đúng câu đã tạo.

## Kiểm tra và bằng chứng

- [acs-p0-tests.json](evidence/acs-p0-tests.json): **268/268 test chọn lọc, 54 files PASS**. Không thay kết quả baseline legacy còn thiếu eSpeak. Tests có mock AI được ghi rõ; không gọi đó là model inference.
- [acs-media-matching.json](evidence/acs-media-matching.json): checkpoint/runtime, source SHA và kết quả embedding CPU thật.
- [P0_VOICE_CAPTION_REVIEW.md](P0_VOICE_CAPTION_REVIEW.md): WAV/transcript/word-error, lỗi số, caption render và giới hạn.
- [P0_SETUP_HANDOFF.md](P0_SETUP_HANDOFF.md): preflight thực, checksum official, downloader/extractor tests và giới hạn clean-machine.
- [acs-p0-ui.json](evidence/acs-p0-ui.json): harness UI riêng, scope và kết quả thực; không chạy worker hay cấp quyền đăng trong fixture UI này.
- [acs-p0-repair-e2e.json](evidence/acs-p0-repair-e2e.json): bản sao video có giọng thật được giảm gain xuống 4% để tạo lỗi âm lượng có kiểm soát; QA phát hiện, mix repair đạt loudness PASS, hình stream-copy, không AI mới, cả parent thử nghiệm và bản gốc trước đó giữ nguyên SHA. Cảnh tĩnh/pause vẫn giữ flag, không gọi thành biên tập hoàn hảo.
- Trạng thái binary/hash sau đóng gói: `dist/windows/build-report.json`; đối chiếu bằng `scripts/verify-desktop-build.mjs`. Không suy từ TypeScript/Next build ra installer đã chạy.
- Batch Windows **21:13:54** đã portable/cài mới/native wizard/auth/close/worker-fault-reopen/startup-failure và toàn tài nguyên **9.840 file khớp SHA**; verifier 21:16:57 PASS, trạng thái `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`. Hash và đường dẫn cài thử tại [delta P0](IMPLEMENTATION_DELTA_2026-10-23_P0.md).

## Những phần chưa thể gọi là hoàn tất

- Chưa có gameplay/ảnh/logo game thật do chủ app cung cấp; matching hiện dựa vào metadata, chưa visual scene understanding/OCR hoặc đánh giá gameplay thật.
- Caption vẫn là phrase timing ước lượng; chưa word alignment thực hoặc owner listening. English CPU là bộ mẫu nhỏ; Vietnamese mới chỉ re-score artifact thật đã có, không phải bộ CUDA mới.
- Bộ voice CUDA mới đang `GPU_BUSY` bởi ứng dụng khác. Không dừng workload, xóa lock hay đổi môi trường của ứng dụng đó. CPU English là lựa chọn benchmark riêng được ghi rõ, không fallback âm thầm trong app.
- Runtime Ollama bootstrap có code/tests và checksum upstream; chưa tải/giải nén/chạy trọn ZIP 1,58 GB trong lần này. Chưa tự tải FFmpeg hoặc nghiệm thu Windows VM sạch.
- Repair Planner hiện ba tác vụ deterministic và bounded voice repair đã có; chưa phải AI tự sửa mọi lỗi biên tập/ý nghĩa, missing license hoặc footage bất kỳ. QA được chạy lại và publication vẫn bị chặn khi thiếu bằng chứng/quyền.
- Chưa có account/bot/quyền đăng thực. Không có owner approval, public post hoặc chứng nhận giọng/fact được tự tạo.

Các agent của đợt này đã hoàn tất và dừng. Không commit/push.
