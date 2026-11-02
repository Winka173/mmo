# AUTONOMOUS CREATIVE STUDIO — bản review thiết kế ban đầu

**Ghi chú 23/10/2026:** phần dưới lưu đề xuất ngày 22/10, trước triển khai. App đã đổi tên và có bản Windows/local AI chạy thực tế trong phạm vi đã kiểm tra. Xem [trạng thái hiện tại](IMPLEMENTATION_STATUS.md), [delta mới](IMPLEMENTATION_DELTA_2026-10-23_1530.md) và [master prompt thực thi](AUTONOMOUS_CREATIVE_STUDIO_MASTER_PROMPT.md). Những câu “chưa triển khai/chưa tải model” trong bản review lịch sử không mô tả trạng thái source hiện tại.

Bản tổng hợp sản phẩm, công nghệ, model và luồng vận hành để review.

- Ngày tổng hợp: **22/10/2026**.
- Trạng thái: repo đã có pipeline nội dung, dashboard web và worker. Các phần app Windows, AI local và cải thiện trong tài liệu này đã thống nhất về hướng thiết kế nhưng **chưa triển khai**.
- Bộ model mới chưa được tải hay benchmark trong phiên nghiên cứu này.
- Tạo tài liệu này không đồng nghĩa bắt đầu triển khai app.

## 1. Mục tiêu sản phẩm

App Windows chạy trên máy cá nhân để quản lý toàn bộ quy trình:

**Ý tưởng/tài liệu/footage → kịch bản → storyboard → giọng đọc → dựng video → kiểm tra → duyệt → đăng bài → theo dõi kết quả.**

Có hai nhóm nội dung:

- **Tủ Tò Mò:** kiến thức, giải thích, nội dung chuyển thể có quyền và affiliate.
- **Marketing nhiều game:** teaser, gameplay highlight, devlog, cập nhật build, chiến dịch wishlist/demo/phát hành.

Mỗi game có tài liệu, asset, brand kit, chiến dịch và tài khoản riêng.

Nguyên tắc vận hành:

- AI chạy local, ưu tiên GPU NVIDIA.
- Không phụ thuộc API AI trả phí.
- Không tự chuyển sang AI cloud khi lỗi hoặc thiếu tài nguyên.
- Mọi cấu hình thực hiện bằng giao diện.
- Điều khiển và nhận báo cáo qua Telegram.
- Nội dung, quyền sử dụng và kênh đích được kiểm tra trước khi đăng.

Máy đã kiểm tra: **RTX 5070 Ti 16 GB VRAM, khoảng 62 GB RAM hệ thống khả dụng**.

## 2. Kiến trúc tổng thể

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| App Windows | **Tauri 2, Rust, WebView2** — dự kiến | Cửa sổ app, tray, thông báo, quản lý backend |
| Giao diện | **Next.js 16, React 19, TypeScript, Tailwind 4** | Dashboard và các màn hình quản lý |
| Backend nghiệp vụ | **Node.js, TypeScript** | Dữ liệu, API nội bộ, tài khoản, dự án |
| Worker | **Node.js/TypeScript** | Scheduler, queue, dựng và đăng video |
| Engine AI | **Python, uv, PyTorch/CUDA** — bổ sung | Chạy các model local |
| Runtime model | **Transformers; llama.cpp hoặc Ollama; Diffusers; PaddleOCR** | Runtime theo từng loại tác vụ |
| Media | **FFmpeg, FFprobe, NVENC, Sharp, libass** | Dựng, xử lý ảnh/âm thanh/phụ đề |
| Dữ liệu | **File JSON/JSONL + file media** | Không dùng database ở kiến trúc hiện tại |
| Secret | **Windows DPAPI** | Mã hóa credential |
| Đóng gói | **Tauri/NSIS + backend đi kèm** — dự kiến | Bộ cài Windows |

Next.js hiện có xử lý phía server, nên app phải đóng gói và quản lý backend local; không thể chỉ xuất giao diện tĩnh rồi bỏ backend.

Luồng giữa các thành phần:

**App Windows → backend local → scheduler/queue → worker → engine AI hoặc media → artifact/QA → review → publisher.**

Backend chỉ nghe localhost. Giao tiếp nội bộ cần xác thực. Engine AI chạy trong môi trường riêng để tránh xung đột dependency.

## 3. Cấu trúc repo hiện có

| Thư mục/package | Trách nhiệm |
|---|---|
| `apps/web` | Control Center |
| `apps/worker` | Daemon, CLI, orchestration |
| `packages/core` | Schema Zod, trạng thái job, chính sách và cổng kiểm tra |
| `packages/storage` | Lưu file atomic, lock, audit, backup, migration, secrets |
| `packages/automation` | Queue bền vững, scheduler, planner |
| `packages/media` | TTS, renderer, gameplay, phụ đề, thumbnail, GPU utilities |
| `packages/providers` | Kịch bản, LLM adapter, fact verification, chuyển ngữ, long-to-shorts |
| `packages/discovery` | Thu thập nguồn, provenance và chống trùng |
| `packages/games` | Registry, asset intake, build intelligence, readiness, campaigns |
| `packages/quality` | Quality Judge và vòng tự sửa |
| `packages/governance` | Tài khoản, ngân sách, quyền nguồn, lifecycle, affiliate, comment assistant |
| `packages/insights` | Analytics, A/B, learning, smart schedule, opportunity radar |
| `packages/platforms` | YouTube, Meta, TikTok, mock và gói đăng thủ công |
| `packages/telegram` | Bot client, command router, outbox và báo cáo |

## 4. Danh mục model local

Đây là bộ ứng viên ưu tiên. Khả năng chạy và chất lượng phải được kiểm tra bằng đúng checkpoint, runtime và preset trên máy.

| Model | Chức năng | Quyết định |
|---|---|---|
| **Qwen3.5-9B** | Viết kịch bản, hook, caption, dịch; hiểu ảnh/video, hỗ trợ phân tích footage và đánh giá biên tập | Model trung tâm; thử lượng tử hóa phù hợp 16 GB |
| **VieNeu-TTS v3 Turbo** | Giọng Việt, biểu cảm, câu có thuật ngữ tiếng Anh | TTS ưu tiên; nghiệm thu từng giọng |
| **Qwen3-ASR-1.7B** | Chép lời footage, nhận voice note, đối chiếu lời đọc | ASR ưu tiên |
| **Qwen3-Embedding-0.6B** | Tìm tài liệu, tìm asset qua mô tả, truy xuất kiến thức, chống trùng nghĩa | Model truy xuất |
| **FLUX.2 klein 4B** | Sinh ảnh, chỉnh ảnh theo tham chiếu, nền và biến thể thumbnail | Model ảnh ưu tiên |
| **PP-OCRv5 mobile detector** | Tìm vùng chữ trên khung hình | Thành phần OCR |
| **latin_PP-OCRv5_mobile_rec** | Đọc chữ Latin/tiếng Việt, phát hiện debug và thông tin nhạy cảm | Thành phần OCR |
| **Silero VAD** | Xác định đoạn có lời nói và khoảng nghỉ | Phụ trợ audio |
| **Z-Image-Turbo** | Sinh ảnh minh họa | Đối chiếu với FLUX; không bắt buộc giữ cả hai |
| **Wan2.1-T2V-1.3B** | Sinh clip minh họa ngắn | Tùy chọn sau nghiệm thu |

Nguồn chính thức:

- [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B)
- [VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS)
- [Qwen3-ASR-1.7B](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)
- [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)
- [FLUX.2 klein 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)
- [OCR đa ngôn ngữ](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.en.md)
- [Silero VAD](https://github.com/snakers4/silero-vad)
- [Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)
- [Wan2.1-T2V-1.3B](https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B)

Các giới hạn quan trọng:

- Qwen3-ASR hỗ trợ tiếng Việt, nhưng **ForcedAligner đi kèm chưa công bố hỗ trợ tiếng Việt**. Căn phụ đề từng từ là hạng mục riêng cần nghiệm thu. [Nguồn](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)
- Không chọn Qwen3-TTS làm giọng Việt mặc định vì danh sách ngôn ngữ hiện chưa có tiếng Việt. [Nguồn](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base)
- Wan2.2-TI2V-5B chưa được chọn cho GPU 16 GB; cấu hình tham chiếu yêu cầu ít nhất 24 GB. [Nguồn](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)
- Model 3D như TRELLIS/TripoSG tiếp tục thuộc Asset Forge. MMO nhận ảnh, render và asset đã xuất từ đó.
- License phải kiểm tra ở đúng checkpoint, dependency và giọng sử dụng; không chỉ nhìn license SDK.
- Model không thay thế bằng chứng fact, bản quyền hay tính năng game đã được xác nhận.

## 5. Tool và kỹ thuật xử lý

| Nhóm | Tool/kỹ thuật |
|---|---|
| Quản lý Python | `uv`, môi trường riêng, dependency lock |
| AI GPU | PyTorch/CUDA, dtype/quantization được cấu hình |
| LLM local | llama.cpp hoặc Ollama; chọn theo khả năng text/vision thực tế |
| Sinh ảnh/video | Diffusers |
| OCR | PaddlePaddle GPU/PaddleOCR |
| Model nhỏ | ONNX Runtime khi phù hợp |
| Dựng video | FFmpeg, filter graph, cache theo cảnh |
| Kiểm tra media | FFprobe, black/freeze/silence detection, loudness/peak analysis |
| Mã hóa GPU | NVENC sau test encode thực tế |
| Thumbnail | Sharp, khung hình thật, font và logo |
| Phụ đề | ASS/libass, SRT |
| Tài nguyên | nvidia-smi, đo RAM/VRAM/nhiệt độ/dung lượng |
| Kiểm thử | Vitest, Playwright, test engine Python, smoke test EXE |
| Bảo vệ dữ liệu | Atomic write, fsync, rename, backup, checksum, audit |

Không phải mọi tác vụ đều chạy GPU. File, giao diện, mạng, queue và nhiều bước compositing vẫn cần CPU.

## 6. Flow sản xuất nội dung chung

1. Nhận ý tưởng, tài liệu hoặc yêu cầu.
2. Chọn thương hiệu/game, mục tiêu, ngôn ngữ, nền tảng và preset.
3. Truy xuất nguồn đã xác nhận.
4. Tạo brief, hook và kịch bản có nguồn.
5. Duyệt kịch bản/storyboard.
6. Chọn footage hoặc tạo ảnh minh họa.
7. Tạo giọng đọc.
8. Tạo và căn phụ đề.
9. Dựng preview nhẹ.
10. Chỉnh nội dung, âm thanh, nhịp và bố cục.
11. Xuất bản cuối.
12. QA kỹ thuật và đánh giá biên tập.
13. Tự sửa giới hạn hoặc chuyển người dùng xử lý.
14. Duyệt đúng phiên bản và kênh đích.
15. Lập lịch đăng hoặc xuất gói thủ công.
16. Thu thập số liệu thực và đánh giá phiên bản.

Đầu ra:

- MP4 dọc **9:16**, ngang **16:9**.
- Thumbnail và phụ đề SRT.
- Metadata theo nền tảng.
- Nguồn/citation, manifest quyền sử dụng.
- Báo cáo QA, lịch sử sửa và cấu hình dựng.
- Gói đăng thủ công khi không dùng API.

## 7. Flow marketing game

**Tạo game → nhập tài liệu/build/asset → xác nhận thông tin → lập chiến dịch → chọn footage → sản xuất video → duyệt → đăng.**

Mỗi game quản lý riêng:

- Tên, mô tả, đối tượng và mục tiêu marketing.
- Brand kit: logo, font, palette, giọng và cách viết.
- Build, changelog, roadmap và tính năng đã xác nhận.
- Gameplay, screenshot, ảnh render, nhạc và thumbnail.
- Store link, wishlist/demo/install CTA.
- Ngày phát hành, embargo và link đã xác nhận.
- Chiến dịch, lịch và tài khoản được phép đăng.

Nguồn ưu tiên là **gameplay và asset thật**. AI hỗ trợ chọn cảnh, viết nội dung và minh họa; không tự sáng tạo tính năng rồi mô tả như có trong game.

## 8. Các kỹ thuật tăng chất lượng

- Nhiều hook ứng viên, đánh giá độ rõ và tính phù hợp.
- Kiểm tra thông tin khẳng định bằng nguồn, không dùng ý kiến model thay bằng chứng.
- Phân tích đổi cảnh, chuyển động, loading, đứng hình, màn đen.
- Model thị giác mô tả cảnh và đề xuất highlight có mức tin cậy.
- Đối chiếu lời đọc với hình đang chiếu.
- Từ điển phát âm tên game, thuật ngữ, số và đơn vị.
- Điều chỉnh nhịp nghỉ; chuẩn hóa loudness, peak và ducking nhạc.
- Phụ đề chia theo ý, giới hạn dòng và tốc độ đọc.
- Preset riêng cho kiến thức, affiliate, gameplay, teaser, devlog và video dài.
- Thumbnail có nhiều ứng viên, xem thử ở kích thước nhỏ.
- Chữ Việt được vẽ bằng font, không phụ thuộc model sinh chữ.
- Preview nhẹ trước khi xuất cuối.
- Cache theo cảnh và dựng lại phần thay đổi.
- Long-to-shorts giữ ý trọn vẹn, viết lại hook/CTA và kiểm tra trùng.
- Không nâng độ phân giải rồi coi đó là bằng chứng chất lượng.

## 9. Quality Lock, phiên bản và duyệt

Mỗi lần sản xuất lưu snapshot:

- Kịch bản/storyboard.
- Asset và hash đầu vào.
- Model, revision, checkpoint hash.
- Seed, dtype, quantization và tham số.
- Giọng đọc, từ điển, brand kit.
- Cấu hình dựng, phụ đề và xuất.

Nguyên tắc:

- Retry giữ nguyên snapshot.
- Thay cấu hình tạo phiên bản mới.
- Giữ bản gốc, bản sửa và bản được chọn.
- So sánh video/thumbnail trước–sau.
- Thay nội dung quan trọng làm mất hiệu lực duyệt cũ.
- Lỗi có timestamp, cảnh liên quan và bằng chứng.
- Tự sửa giới hạn số vòng, có lịch sử và hoàn tác.

Ba lớp đánh giá tách biệt:

1. **QA kỹ thuật:** file, codec, FPS, âm thanh, phụ đề…
2. **Đánh giá biên tập:** hook, hình–lời, phát âm, nhịp, CTA…
3. **Người dùng duyệt:** nội dung và phiên bản được phép đăng.

Điểm AI hỗ trợ quyết định; QA PASS không có nghĩa video hay hoặc sẽ viral.

## 10. GPU scheduler và vận hành không phí AI

- AI local-only, chặn AI cloud.
- Một tác vụ AI nặng tại một thời điểm theo mặc định.
- Kiểm tra VRAM, RAM, nhiệt độ và dung lượng trước chạy.
- Nạp/giải phóng model theo giai đoạn.
- Phối hợp tài nguyên với Asset Forge.
- Không sửa môi trường/model của Asset Forge.
- Thiếu tài nguyên thì chờ hoặc báo lỗi.
- Không âm thầm giảm chất lượng hay đổi engine.
- Offload và lượng tử hóa nằm trong preset đã chọn.
- Ghi thời gian, tài nguyên thực; ETA chỉ có khi đủ dữ liệu.

Không mất phí thuê bao hay phí gọi AI khi vận hành local. Vẫn cần điện, lưu trữ và Internet cho kết nối bên ngoài.

## 11. Giao diện app Windows

Các màn hình dự kiến:

- **Setup:** kiểm tra công cụ, GPU, model, dữ liệu và xuất thử.
- **Overview:** hệ thống, dự án, việc chờ xử lý.
- **Projects/Games:** tài liệu, asset, build, chiến dịch.
- **Create:** brief, kịch bản, storyboard.
- **Production:** queue, preview, tiến độ, log, QA và thao tác.
- **Review/Compare:** duyệt và so phiên bản.
- **Media Library:** tìm asset, nguồn/license, nơi sử dụng, file thiếu.
- **Planner:** lịch sản xuất và lịch đăng.
- **Accounts:** kết nối, xác nhận kênh.
- **Analytics/A-B:** số liệu và thử nghiệm.
- **Models & Tools:** model, runtime, license, benchmark.
- **Telegram:** kết nối, quyền, báo cáo.
- **Settings/Diagnostics:** cấu hình, backup, dung lượng và lỗi.

App tự quản lý backend; có tray, thông báo và tùy chọn khởi động cùng Windows. Đóng cửa sổ phải phân biệt rõ tiếp tục chạy nền với thoát hoàn toàn.

## 12. Cấu hình tập trung và key/API

Toàn bộ cấu hình đi qua giao diện, chia thành nhóm cơ bản và nâng cao.

| Nhóm | Nội dung |
|---|---|
| App | Thư mục, múi giờ, ngôn ngữ, autostart, hành vi đóng |
| Model/runtime | Engine, executable/base URL local, checkpoint, hash, tham số |
| GPU | Thiết bị, VRAM dự phòng, nhiệt độ, concurrency, offload |
| TTS/ASR | Giọng, reference audio, ngôn ngữ, phát âm, phân đoạn |
| Render | Độ phân giải, FPS, encoder, chất lượng, âm thanh, phụ đề |
| QA | Ngưỡng, số vòng sửa, mục bắt buộc duyệt |
| Game/brand | Brand kit, nguồn xác nhận, asset, CTA, embargo |
| Scheduler | Lịch, quota nội bộ, ưu tiên, catch-up |
| Storage | Cache, retention, dung lượng, backup/restore |
| Telegram | Token, chat/user allowlist, quyền, báo cáo, preview |
| Analytics | Nguồn dữ liệu, chỉ số, cửa sổ đo, A/B, learning |

Các tích hợp bên ngoài:

- **Telegram:** bot token, chat/user ID, topic nếu dùng.
- **YouTube:** OAuth client, token, channel ID, scope và hạn token.
- **Meta:** token, Page ID, IG user ID, Graph version; cấu hình app nếu tích hợp OAuth.
- **TikTok:** client credentials nếu OAuth, access/refresh token, định danh và trạng thái app.
- **AI local:** không cần key cloud.

Credential lưu mã hóa **theo từng tài khoản**, có nút kiểm tra và hiển thị đúng kênh đang kết nối. Token được lấy qua đăng nhập không bắt nhập tay.

Không còn dùng con số 29 làm tổng field toàn app: phạm vi mới có cấu hình lặp theo model, game và tài khoản.

## 13. Telegram

Telegram đóng vai trò điều khiển từ xa và nhận thông báo.

Phạm vi:

- Xem status, queue, job, game, campaign, kết nối và tài nguyên.
- Báo cáo ngày/tuần, việc chờ duyệt, kết quả đăng và lỗi.
- Pause/resume, retry/cancel và dừng khẩn.
- Nhận preview, thumbnail, caption và kênh đích.
- Duyệt/từ chối bằng nút; xác nhận thao tác quan trọng.
- Nhận ý tưởng, link, ảnh, footage và voice note trong giới hạn.
- Chọn đúng game trước khi tạo job.
- Phân quyền cả chat và user.
- Thông báo theo loại sự kiện, giờ yên lặng và mức ưu tiên.
- Outbox bền vững, lưu offset, chống xử lý trùng, retry và chống spam.
- Tạo preview nhẹ cho file lớn.

Dùng long polling, không cần mở cổng Internet vào máy. Không bật broadcast trả phí. [Telegram FAQ](https://core.telegram.org/bots/faq)

Máy phải bật và worker hoạt động để bot xử lý lệnh. Dừng khẩn cần phân biệt ngừng nhận việc mới, chặn đăng và hủy tác vụ đang chạy; không mô tả tất cả là dừng tức thì khi backend chưa hỗ trợ.

**Danh sách yêu cầu Telegram riêng của chủ app chưa được cung cấp đầy đủ; phần này chưa được đối chiếu nghiệm thu từng yêu cầu.**

## 14. Đăng bài, analytics và learning

- Adapter cho YouTube, Facebook, Instagram và TikTok.
- Kiểm tra đúng tài khoản/game trước khi có tác động bên ngoài.
- Kiểm tra lại quyền, fact, originality, embargo và duyệt ngay trước đăng.
- Lưu phiên upload, reconcile và idempotency để giảm đăng trùng.
- Không có quyền API thì xuất gói đăng thủ công.
- Analytics/doanh thu lấy từ API được cấp quyền hoặc CSV.
- Dữ liệu thiếu hiển thị “chưa có”, không tự biến thành 0.
- A/B gắn với phiên bản cụ thể và cửa sổ đo.
- Learning có mẫu tối thiểu, giới hạn thay đổi, đóng băng và hoàn tác.
- Comment assistant tạo đề xuất; tự trả lời chỉ khi được bật và có quyền.
- Không suy doanh thu từ lượt xem.
- Discovery lưu nguồn/license/provenance, không vượt quyền truy cập hay CAPTCHA.

## 15. Lưu trữ, phục hồi và kiểm thử

Dữ liệu:

- Ghi atomic, khóa file, heartbeat.
- Backup `.bak`, quarantine file hỏng.
- Audit JSONL.
- Migration có version.
- Backup/restore có checksum.
- Quản lý retention và dọn cache.
- Không đưa checkpoint, token hay dữ liệu lớn vào Git.

Nghiệm thu:

- Unit/integration cho queue, policy, quyền, tài khoản, publish.
- UI test và smoke test **EXE Windows thật**.
- Engine test bằng dữ liệu Việt và footage thật.
- Đo VRAM đỉnh, RAM, thời gian và dung lượng.
- Thử hết VRAM, đầy đĩa, mất mạng, crash và restart.
- Thử token hết hạn/thu hồi và lỗi giữa upload.
- Thử backup rồi restore vào dữ liệu kiểm thử.
- Thử Telegram thật.
- Phân biệt fixture, kết quả kỹ thuật và duyệt chất lượng của người dùng.

## 16. Hiện trạng và những điểm reviewer cần tập trung

Repo hiện có pipeline offline, video mẫu, file queue/storage, dashboard, QA và adapter nền tảng. Các báo cáo kiểm thử trong repo là bằng chứng lịch sử; chưa được chạy lại trên cấu hình mới.

Phần cần làm hoặc hoàn thiện:

- Đóng gói Windows và quản lý vòng đời backend.
- Nối bộ AI local vào pipeline thực.
- Cấu hình tập trung và credential theo tài khoản.
- Production workspace, so phiên bản và Quality Lock xuyên suốt.
- GPU coordination với Asset Forge.
- Telegram mở rộng và sửa các phần chưa nối.
- Kiểm thử platform bằng tài khoản thật.

Những quyết định chưa thể khóa trước benchmark:

- Runtime và lượng tử hóa Qwen.
- Checkpoint/giọng VieNeu cụ thể.
- Căn phụ đề tiếng Việt, đặc biệt từng từ.
- Chọn FLUX hay Z-Image làm mặc định.
- Mức chất lượng/thời gian Wan trên 16 GB.
- Cách đóng gói Next.js, Node và engine Python.
- Quyền sử dụng của đúng bộ weights, dependency và giọng.
- Khả năng API thực tế của từng tài khoản.
- Toàn bộ yêu cầu Telegram riêng.

**Phạm vi hiện tại là bản thiết kế để review; chưa bắt đầu triển khai.**
