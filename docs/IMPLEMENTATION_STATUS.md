# AUTONOMOUS CREATIVE STUDIO — Tiến độ hiện tại

Cập nhật **24/10/2026**, Asia/Saigon. App Windows đã có bản chạy thực tế; **chưa hoàn tất toàn bộ master prompt**. Không commit/push và không sửa dữ liệu/môi trường Asset Forge.

Đợt hiện tại: [RESTORE_AND_RECOVERY.md](RESTORE_AND_RECOVERY.md). **303/303 test chọn lọc / 64 files PASS**, root/Next TypeScript và production build đạt. Đã thêm khôi phục backup qua UI Windows với fingerprint/checksum/preview, staging/safety copies/journal, rollback lỗi/crash và nút hoàn tác có guard. Supervisor tự phục hồi web/worker đã thoát tối đa ba lần mỗi dịch vụ (2/5/10s), giữ phiên local và dừng retry khi hết budget. Thử ngắt restore process thật, restore/undo native và worker/web death/retry limit đều đạt với fixture riêng. Bản hiện tại là batch **24/10 01:01:59**; nghiệm thu cài mới và toàn tài nguyên được ghi tại `dist/windows/build-report.json`. **Các batch 23/10 bên dưới là lịch sử, không phải bản giao hiện tại.**

Đợt mới: [QUALITY_UX_IMPROVEMENTS.md](QUALITY_UX_IMPROVEMENTS.md). **298/298 test chọn lọc, 63 files PASS**, root/web TypeScript và Next production build PASS. Đã triển khai Home/nhóm điều hướng/Models tabs, Editor ba vùng + nháp khôi phục + so sánh, waveform/manual timing, căn từ English CPU tùy chọn, đo pacing/bộ đánh giá giọng, catalog media/vision gợi ý, chống lặp/gợi ý theo dữ liệu và brand preset. Browser workflow và render với giọng thật có evidence riêng. Tiếng Việt chưa căn từ; vision fixture có lỗi hình nên giữ FLAGGED; owner listening/account/gameplay thật vẫn thiếu. **Batch Windows 22:54:22 đã portable/cài mới/native wizard/auth/close/worker recovery/startup failure PASS; verifier 22:56:21 xác nhận toàn bộ 9.857 file tài nguyên khớp.** `dist/windows/build-report.json` = `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`. Đoạn P0 dưới là lịch sử.

Đợt P0 mới: [P0_IMPLEMENTATION.md](P0_IMPLEMENTATION.md), [delta nghiệm thu](IMPLEMENTATION_DELTA_2026-10-23_P0.md). **268/268 test chọn lọc, 54 files PASS**, TypeScript/Next build và packaged-backend UI đạt. Bổ sung sửa kế hoạch/preview nguồn/nghe riêng câu, matching theo mô tả bằng embedding local, Repair Planner và setup preflight 4 bước. Actual mix repair trên giọng thật đạt, không AI mới. **Batch 21:13:54** đã portable/cài mới/native wizard/auth/close/worker recovery/startup failure PASS; toàn bộ **9.840 file tài nguyên khớp SHA**, verifier 21:16:57. `dist/windows/build-report.json` = `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`. Full baseline vẫn có prerequisite legacy chưa đạt. Delta 19:00 là lịch sử batch 18:56. [Hướng dẫn UI](USER_GUIDE.vi.md), [ma trận 22 tình huống](ACCEPTANCE_MATRIX.md).

## Bản Windows

- **Bản hiện tại 24/10 01:01:59, verifier 01:05:03:** `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`. Installer SHA `364F1D03F14810412A5FB21324890BE7DB35ABF0D12F815A70C810266E58D62F`, portable SHA `B470E39F5B874A402A0BE19F20C7B069220220C24B108EEF26DE64C53FE21DCA`. Toàn bộ 9.858 file / 325.312.361 byte tài nguyên bản cài/portable khớp; restore/undo và bounded automatic recovery có evidence cùng EXE. Các dòng batch 23/10 dưới đây là lịch sử.

- Bộ cài: `dist/windows/AUTONOMOUS CREATIVE STUDIO_0.2.0_x64-setup.exe`.
- Portable: `dist/windows/AUTONOMOUS CREATIVE STUDIO.exe`, giữ `backend`, `runtime`, `engines` bên cạnh.
- Tauri 2/WebView2 khởi động Next SSR và Node worker. Đóng cửa sổ có thể giữ chạy nền; chọn Quit để dừng cả backend. Credentials dùng DPAPI; web chỉ loopback với cookie/session riêng.
- Bản hiện tại **22:54:22** chứa đợt quality/UX và sửa scene seek sau cut. Installer SHA `5EE70C45EF35B7D9B943FC2BB672C39A1C4AB5F306AB7D7F89D2B33B07AFEEAF`; portable SHA `847CC5D8A0169A5424E4D1D40AB582A7F01FD2ADB0838CDA225F86051A4DDA47`. So toàn bộ tài nguyên bản cài/portable khớp 325.100.012 byte; giọng không inference lại trong installer smoke. Hướng dẫn mới ở USER_GUIDE.vi.md.
- Batch **21:13:54** chứa P0 plan/media edits, matching, repair, voice/caption policy và setup preflight, ngoài guided Create/frame timing/WebView isolation có trước. Portable/cài mới/native wizard/auth/cleanup, worker-death/normal-Quit/reopen, controlled live-owner failure và full resource SHA đã đạt. Hash tại delta P0 và `dist/windows/build-report.json`. Giọng không inference lại trong installer smoke; model evidence riêng giữ đúng scope.
- Các bộ cài trước đã kiểm tra đường dẫn Unicode/có khoảng trắng, 200/401, hide giữ worker và quit dọn process tree. Chưa chứng minh máy sạch, mọi tray action, autostart opt-in hoặc mọi trường hợp ngắt model.

## Đã triển khai và kiểm tra theo phạm vi

| Nhóm | Chạy được | Giới hạn còn lại |
|---|---|---|
| UI và hồ sơ | Sidebar 14 khu vực; Autopilot 7 bước, Create 6 bước, immutable plan line/media edits, source preview, pinned line audition và selected-child reload; preview/QA/ZIP; Projects & Brands revision | Chưa dịch đủ mọi màn/error legacy; guided stop chưa áp dụng cho Shorts/localization |
| Production | Queue/checkpoint, pause/resume/cancel, snapshot/hash, stage/artifact, phục hồi worker thực | Chưa nghiệm thu mất điện mọi stage, forced GPU OOM thật hoặc mọi loại input |
| Model local | Qwen3.5:9b Q4_K_M riêng ACS; VieNeu VI, Kokoro US/UK, Qwen ASR, Silero VAD, FLUX ảnh, Qwen Embedding; selected-profile setup qua UI | Chatterbox, PaddleOCR, Wan/music chưa tích hợp; clean-machine setup chưa xác minh |
| Giọng/QA | WAV CUDA thật; Voice Studio/ASR/VAD; policy v2 chặn số/phủ định sai; caption grouping/literal; bounded line retry; QA-directed caption/mix/encode repair | Chưa người nghe duyệt, phrase timing ước lượng. Bộ CUDA mới chờ GPU app khác; CPU English mới và retained VI re-score được ghi riêng |
| Facts | NASA HTTPS thật → quote/citation → script VI/EN riêng → đồ họa chữ gốc → local voice → MP4 | VI có voice flags; quote khớp không chứng minh entailment; facts/editorial/rights vẫn cần duyệt |
| Product | Adafruit thật → research/disclosure/đồ họa gốc → VI 28,073s/EN 40,003s CUDA + ASR khớp; fresh-source preflight và static price/spec/link/expiry gates | VI có hai caption warnings, EN lệch mục tiêu 30s; chưa owner review, marketplace discovery, affiliate/account thật |
| Discovery | RSS/Atom metadata facts công khai, consent, lexical/recency ranking, pin bài gốc, dedup và bổ sung ngôn ngữ còn thiếu; feed NASA/UI thật | Không tải video feed/enclosure, chưa semantic director hoặc watcher creator Trung đầy đủ |
| Footage | FFmpeg scene/black/freeze/motion/audio; local semantic matching narration với mô tả nguồn/scene đã pin SHA, bounds và hạn chế lặp | Fixture sở hữu, không gameplay thật; thiếu mô tả giữ UNKNOWN; chưa OCR/hiểu pixel/gameplay tự động |
| Localization/Shorts | VI→EN, EN→VI local source ASR/dịch/TTS/retime; Shorts giữ lời gốc; folder watcher có quyền/hash | Chưa full Mandarin creator feed→VI/EN, word timing hoặc owner translation/meaning approval |
| Editor | Timeline đa track, cut/zoom/gain/title/caption/audio import/restore; transcript phrase selection/seek/ripple; child giữ parent | Chưa semantic prompts tổng quát, full word-aligned transcript hoặc sửa lời tùy ý sau mọi cut |
| Library search | Index dẫn xuất Qwen Embedding, tối đa 100 original ready/600 chunk đầy đủ; tìm VI/EN bằng model local, config/runtime/corpus invalidation | Không index child/cut, chưa incremental refresh hoặc semantic dedup/originality gate |
| Export | MP4/SRT/ASS/thumbnail/citations và private ZIP có hash/CRC/manifest/review trạng thái; tải auth/Range, phục hồi đóng gói | Gói xuất luôn là draft, không cấp quyền đăng. Không đóng model/secret/log/nguồn thô |
| Review/kênh | Bốn scope review gắn fingerprint; YouTube OAuth loopback/PKCE, DPAPI theo channel revision; reviewed-delivery policy | Chưa login/upload thật. Policy chỉ tự giao SAU bốn review, chưa exception-only content approval; Meta/TikTok manual |
| Lịch/Telegram/Insights | Timezone/windows/quota/backlog/dry-run; bot inbox/outbox/auth/scoped confirmation contracts; metric unknown/null/remote ID | Chưa bot/account/metrics thật, Steam attribution hoặc advanced learning/A-B đầy đủ |
| Backup/tài nguyên | Metadata/media-choice backup, UI native restore/undo với journal/safety/checksum/current fingerprint và held production; bounded web/worker exit recovery; GPU lease/circuit breaker | Không bao gồm credential/model/original bên ngoài; UI không restore dữ liệu khác version/encrypted credentials; chưa whole-machine recovery/hung-process watchdog/fairness mọi app |

## Model và số đo thật

- **Qwen3.5:9b** riêng ACS tại loopback 11435; digest `56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90`; VI/EN text CUDA đạt. Vision đọc sai chữ trong fixture và được giữ FLAGGED.
- **VieNeu 3.8.3 / Minh Quân**, **Kokoro 0.9.4 / af_heart, bf_emma**: sample CUDA thật, ASR đối chiếu. Owner listening NOT_REVIEWED. Không fallback giọng khác ngôn ngữ hoặc API cloud.
- **FLUX.2 klein 4B**: 768 vuông 12,97s; 768×1344 20,66s; CUDA CPU offload, PyTorch peak 7.990,4 MiB. Square có nét giống chữ ký không mong muốn, giữ flag. PNG/UI/Library/hash đã kiểm tra; chưa image editing hoặc per-shot image pipeline.
- **ASR FLEURS**: chín mẫu nói thật có license CC-BY-4.0, ba/ngôn ngữ; đúng ngôn ngữ 9/9. Việt 4/105 lỗi theo âm tiết (3,81%), Anh 6/69 từ (8,70%), Mandarin 3/105 ký tự (2,86%). CPU chọn riêng, bốn thread, 98,24s audio; runner 170,85s, toàn process 208,83s. Không đổi GPU production. Tập nhỏ không chứng nhận chất lượng tổng quát, TTS/dịch hoặc ngưỡng QA.
- Cùng chín file FLEURS đã đo lại **CUDA**: runner 31,246s, toàn process 59,110s, PyTorch peak 4.480,79 MiB. Việt 4/105 (3,81%), Anh 7/69 (10,14%), Mandarin 1/105 (0,95%); đúng ngôn ngữ 9/9. Giữ cả số CPU trước đó, không chọn số đẹp hơn; tập rất nhỏ không chứng nhận độ chính xác tổng quát.
- **Qwen3-Embedding-0.6B**: revision `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`, bảy file/1,207 GB; CUDA probe 1,532s inference, 9,438s process, PyTorch peak 1.149,52 MiB. Có CPU index/search trên ba bản xuất thật và UI cài/apply/verify/index/query VI/EN; không chứng nhận sự thật/quyền/độc đáo.
- GPU đã nhả khóa cho lượt product VI/EN, embedding và ASR mới. Các lần chờ trước vẫn giữ trong evidence. Không dừng app khác hoặc âm thầm hạ preset để lấy PASS.

Chi tiết checkpoint/license/runtime và phạm vi benchmark: [MODEL_COMPATIBILITY.md](MODEL_COMPATIBILITY.md), [IMAGE_ENGINE.md](IMAGE_ENGINE.md).

## Kiểm tra mới nhất

- **235/235 test chọn lọc / 50 file PASS**; `docs/evidence/acs-selected-tests.json` và `.local/acs-frame-selected-tests.json`. Không phải toàn suite legacy. Có storage/health, semantic stale/corpus, plan stop/resume/tamper/rights/cancel và actual FFmpeg still-image ripple-cut regression. Full baseline trước đó còn 2 assertion lỗi, 24 không chạy do prerequisite/fixture; xem delta.
- TypeScript/Next production build PASS sau sửa startup/khóa.
- Browser baseline 12 kiểm tra; expansion bốn nhóm; management ba nhóm; image/feed/footage/manual-export UI có evidence riêng. Không coi mock AI/transport trong contract là inference/account thật.
- `acs-manual-export-ui.json`: ZIP từ MP4 thật, FFmpeg revalidation, UTF-8 và file whitelist, auth/Range/hash/idempotency; archive bị sửa được giữ và trả 409. Không tạo approval hoặc post.
- `acs-asr-corpus.json`, `acs-asr-corpus-cuda.json`: raw references/transcripts, audio/model hashes giống nhau, license/attribution và measurements CPU/CUDA riêng; lỗi WAV parser lần đầu giữ riêng.
- `acs-semantic-inference.json`, `acs-semantic-cuda.json`, `acs-semantic-ui.json`: CPU/CUDA thực và selected-profile/Library UI; không tạo human approval hoặc post.
- `acs-worker-health-ui.json`: ngắt worker thật của bài test, UI/API báo dead dù lock còn; mở lại có worker mới và hash nháp giữ nguyên. Không tự restart mọi lỗi hoặc xóa lock của owner sống.
- `acs-create-guided-ui.json`: nguồn NASA/Qwen/Kokoro/ASR CUDA, plan stop/reload, server deep link, preview/QA/ZIP, repeated continuation và recurring-Autopilot handoff. Không thay thế approval/fact review.
- `acs-frame-timing.json`, `acs-frame-speech-e2e.json`: frame count thực, timeline/container khớp, một câu sửa chỉ invalidates segment đó, WAV/segment/parent khác giữ nguyên; real-speech test tái dùng WAV CUDA đã có, không claim inference mới.
- Native wizard VI/EN, controlled startup failure và worker fault/reopen đã PASS trên batch 18:56; verifier bắt buộc status và EXE hash trùng trước khi nhận build. Không claim automatic sidecar restart hoặc mọi forced-shell crash.

## Điều kiện ngoài repo và việc còn thiếu

Chủ app xác nhận **chưa có gameplay/ảnh/logo thật**; không thể nghiệm thu game 20–45s từ fixture. Chưa có account/token/quyền đăng, bot thật, dữ liệu Steam hoặc người nghe duyệt. Không phát sinh bài đăng công khai, tin nhắn hoặc approval giả.

Vẫn còn phần triển khai độc lập: semantic content director/dedup và visual matching, model tùy chọn, semantic repair/editor đầy đủ, custom templates, exception-only content authorization, remote creator adapters, complete VI/EN UX, advanced learning/attribution và clean Windows VM/full runtime bootstrap acceptance. Danh sách có phạm vi tại [KNOWN_ISSUES.md](KNOWN_ISSUES.md); không đánh dấu toàn master prompt hoàn thành.

## Tiếp tục

Giữ toàn bộ source/data hiện có, đọc delta và evidence mới trước. Các agent phụ đã ngừng, không tự khởi động lại agent đã hết giới hạn. Ưu tiên reliability và flow có thể nghiệm thu; không dùng việc thiếu asset/account để bỏ qua các phần code vẫn làm độc lập được. Chạy packaging xong mới smoke native; cập nhật hash/resource đối chiếu cùng binary đã test.
