# Cải tiến chất lượng và UI/UX — 23/10/2026

Đợt này triển khai các cải tiến đã được chủ app chốt bằng “làm hết”, trên kiến trúc hiện có. Không thay Next/Node/JSON bằng hệ thống khác, không thêm API AI trả phí và không sửa môi trường Asset Forge. Đây là nghiệm thu từng phần, chưa phải hoàn thành toàn bộ master prompt.

## Giao diện và thao tác

| Hạng mục | Kết quả và phạm vi kiểm tra |
|---|---|
| Home: Việc tiếp theo | Đề xuất dựa trên trạng thái worker, công cụ, model, kế hoạch và bản dựng thật; dẫn đến đúng bước, không tự kích hoạt sản xuất/đăng |
| Điều hướng | Giữ 14 khu vực, nhóm Sáng tạo / Vận hành / Quản trị, lưu trạng thái thu gọn, skip link và focus bàn phím |
| Model & Công cụ | Bốn tab Thiết lập / Model đã cài / Giọng đọc / Kiểm tra máy; giữ nội dung đang nhập khi chuyển tab, deep link và phím mũi tên/Home/End |
| Editor | Danh sách cảnh có thumbnail, preview cố định, inspector lời đọc; chọn cảnh để seek. Bản đã cắt lấy clip/start/duration từ timeline thực, gồm clip bị tách; không dùng mốc narration gốc. Timeline, phụ đề/waveform, QA, so sánh và xuất là các tab riêng |
| Nháp đang sửa | Lời đọc Editor và dòng kế hoạch lưu nháp trên thiết bị, khôi phục sau reload; báo lỗi lưu/xung đột cửa sổ. Áp dụng vẫn tạo phiên bản bất biến riêng |
| So sánh | Hai video trước/sau, thumbnail, chỉ một nguồn phát tiếng, tùy chọn đồng bộ seek; hiện thay đổi lời/media/thời lượng và chi tiết thao tác. Quyền duyệt không chuyển sang bản mới |
| Lỗi và nút bị khóa | Thông báo có hướng xử lý và liên kết Settings/Models; các thao tác rủi ro hoặc chưa đủ điều kiện có lý do cụ thể |
| Cửa sổ hẹp | Browser kiểm tra 480/640/960/1280/1600 CSS px, VI/EN và không tràn trang. Chưa chứng nhận Windows DPI vật lý 125–200% |

## Chất lượng giọng, phụ đề và nhịp dựng

- **Waveform thật:** trình duyệt giải mã audio trong video hiện có khi người dùng yêu cầu, tối đa 64 MiB; không upload audio. Chọn cụm phụ đề, nghe sát ranh giới, sửa đầu/cuối bằng số hoặc slider bàn phím. Lưu bằng typed operation `set_caption_timing`, kiểm tra bounds/overlap và tạo child. Không tạo lại TTS hay sửa lời nói.
- **Căn từ English tùy chọn:** profile `wav2vec2-en-align`, bảy file cố định 377.614.626 byte, revision `22aad52d435eb6dbaf354bdad9b0da84ce7d6156`, trọng số SHA `8aa76ab2243c81747a1f832954586bc566090c83a0ac167df6f31f0fa917d74a`. Chạy CPU, offline, trong runtime ASR tương thích; không đổi dependency giọng. Chỉ nhận khi text/audio hash, acoustic decoding và mốc từ đạt các guard. Mismatch, số viết bằng chữ số hoặc score yếu giữ unknown/estimated. **Không hỗ trợ căn từ tiếng Việt.**
- **Đo nhịp từ audio:** `pacing.json` dùng thời lượng probe thật, tốc độ từng câu và độ lệch mục tiêu; tiếng Việt đếm đơn vị cách trắng riêng với English words. Đây là heuristic có nhãn, không phải điểm tự nhiên đã được người nghe xác nhận. Giữ số, phủ định và disclosure; không tự cắt claim hay thêm filler.
- **Bộ đánh giá giọng cố định:** 6 câu Việt + 6 câu Anh, US/UK dùng cùng bộ Anh. Có tên riêng, số/ngày, phủ định, disclosure và ngắt nghỉ. Tạo từng mẫu hoặc enqueue sáu mẫu, so cấu hình trước/sau, xuất JSON. Việc enqueue không có nghĩa inference đã xong; không tạo quyết định nghe duyệt thay chủ app.

Chi tiết engine, guard và bằng chứng tại [NARRATION_QUALITY.md](NARRATION_QUALITY.md).

## Media, chống lặp và gợi ý kế hoạch

- **Mô tả qua UI:** Library hiển thị media, tên import nếu có, tên dễ nhớ, mô tả và tối đa tám khoảng thời gian. Revision metadata gắn SHA, kiểm tra file/bounds và optimistic concurrency; không sửa file gốc hay `acs-media.json`. Có manifest tải xuống. Matching mới dùng mô tả đã chấp nhận; bản đã chạy giữ input cũ.
- **Vision keyframe local:** job bền vững, tối đa ba keyframe, snapshot cấu hình/hash, Qwen managed local và điều phối tài nguyên. Gợi ý luôn chờ người dùng xem ảnh và lưu; không tự thay mô tả được duyệt. Không gọi đây là OCR hay hiểu toàn bộ gameplay.
- **Chống lặp có giới hạn:** trigrams nội dung, token hook, SHA nguồn và giao khoảng thời gian trong tối đa 100 lineage ready độc lập; loại child/revision để tránh báo lặp giả. Chưa phát hiện mọi paraphrase hoặc video encode lại; không chặn tự động logo dùng chung.
- **Gợi ý từ kết quả:** chỉ so mẫu cùng content family/format/language/channel, có remote ID và public/available hợp lệ, cửa sổ quan sát ít nhất bảy ngày, dữ liệu gần đây và tối thiểu năm mẫu mỗi nhóm. Hiện ID bằng chứng, median và giới hạn/confounder. Thiếu metrics giữ unknown; chưa có account thật nên quy tắc học chỉ được test bằng fixture, không gọi là chiến lược tối ưu đã chứng minh.

Chi tiết tại [MEDIA_INTELLIGENCE_IMPLEMENTATION.md](MEDIA_INTELLIGENCE_IMPLEMENTATION.md).

## Brand kit và preset

Autopilot bước 5 và Create bước Media/Voice có preset dùng lại: font hỗ trợ tiếng Việt, màu nhấn/phụ đề, scale/safe margin, CTA/thời lượng, profile giọng VI/US/UK và logo tùy chọn có khai báo quyền. Logo decode bằng Sharp, giới hạn kích thước/pixel, không nhận SVG; copy và pin SHA vào artifact. Caption/CTA dựng bằng font pipeline, logo overlay bằng FFmpeg. Thay preset không viết lại phiên bản hay snapshot đã duyệt.

## Bằng chứng đã chạy

| Kiểm tra | Kết quả / evidence |
|---|---|
| Selected regression | 298/298 test, 63 files PASS; raw `.local/acs-all-improvements-tests.json`, summary `evidence/acs-improvements-tests.json`. Không suy ra toàn legacy suite PASS |
| TypeScript | Root và web tsconfig kiểm tra riêng; production Next build chạy SSR thực |
| Shell/Home/Models | `evidence/acs-ux-shell-ui.json`: browser thật, nhóm nav, deep link, tab/keyboard, nháp và VI/EN; lỗi FFprobe được inject có nhãn |
| Editor/Library/Brand/evaluation | `evidence/acs-improvements-ui.json`: browser thật, preview/seek, reload nháp, hai video, waveform, caption child, preset, catalog, sáu audition queued và responsive; không start worker/model trong harness này |
| English acoustic alignment | `evidence/acs-english-word-alignment.json`: inference CPU thật, mười từ aligned, WER acoustic 0 trên câu được đo; sai script bị từ chối, VI unsupported. Chưa có human word-boundary benchmark |
| Production thật | `evidence/acs-improvements-speech-e2e.json`: tái dùng WAV Kokoro thật nguyên byte; CPU aligner mới, brand/logo/CTA, nhịp đọc, FFmpeg/QA và child sửa timing; parent/video/audio gốc giữ nguyên, không TTS/ASR/LLM mới |
| Vision thật | `evidence/acs-media-vision.json`: Qwen3.5 CUDA, 7,666s model call / 13,122s executor. Model gọi hình chữ nhật là hình vuông: **FLAGGED**, không tự chấp nhận |

Raw output, ảnh và các lần thất bại được giữ riêng. Các kiểm tra fixture không thay thế gameplay thật, nghe duyệt, quyền sử dụng nội dung hay quyền đăng.

## Windows và phần còn thiếu

Bản **23/10/2026 22:54:22**, verifier **22:56:21 Asia/Saigon**, đã đạt portable/cài mới/native wizard/auth/close/worker recovery và controlled startup failure; trạng thái `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`. Packaged-backend UX/Editor/Library/Brand/P0 browser smokes đều PASS. Toàn bộ **9.857 file / 325.100.012 byte** bản cài và portable khớp SHA. Không dùng bằng chứng batch P0 21:13 thay cho đợt này.

| Artifact | SHA-256 |
|---|---|
| `dist/windows/AUTONOMOUS CREATIVE STUDIO.exe` | `847CC5D8A0169A5424E4D1D40AB582A7F01FD2ADB0838CDA225F86051A4DDA47` |
| `dist/windows/AUTONOMOUS CREATIVE STUDIO_0.2.0_x64-setup.exe` | `5EE70C45EF35B7D9B943FC2BB672C39A1C4AB5F306AB7D7F89D2B33B07AFEEAF` |
| Installed `.local/installed-smoke/Ứng dụng ACS-5ee70c45/autonomous-creative-studio.exe` | `105ee2eaf4bfbd3f24a0771f97eed051a13d1ed93ad4df6c21efbcf03fe60a8f` |

EXE cài và portable chỉ khác marker NSS/UNK của Tauri; verifier kiểm tra các byte còn lại. Tree SHA `456921ec7ec882a68a3fc61de4359645589c6373d5dd97529e51228cce8db083`, manifest tại `dist/windows/resource-manifest.json`. Report cuối tại `dist/windows/build-report.json`. Installer smoke bỏ qua inference giọng; model/voice evidence giữ riêng.

Vẫn thiếu: gameplay/logo thật của chủ app, listening/creative review, accuracy benchmark lớn, full Mandarin creator localization/feed, account/bot/metrics/upload thật, một số chức năng master prompt và clean Windows VM. English alignment không làm tiếng Việt trở thành aligned. Vision đã chạy không đồng nghĩa gợi ý đúng. Auto-post vẫn cần quyền và các gate hiện hành; chưa có đăng công khai trong đợt này.
