# Toàn bộ flow AUTONOMOUS CREATIVE STUDIO

Cập nhật 24/10/2026 theo source hiện có. Tài liệu này phục vụ review sản phẩm và thiết kế flow xây kênh Facebook; **không phải xác nhận mọi tính năng đã hoàn tất**. Không thay đổi code hoặc kết nối/đăng lên tài khoản trong lần rà soát này.

## 1. Phân biệt ba lớp

1. **Sản xuất nội dung:** game, kiến thức, sản phẩm, dịch/lồng tiếng, cắt video dài. Các flow này tạo artifact và phiên bản local.
2. **Quản lý chiến dịch/kênh:** dự án, brand, nguồn, lịch, review, phân phối, đo hiệu quả. Một kênh có thể dùng nhiều flow sản xuất.
3. **Publisher:** chuyển bản đã đủ điều kiện lên từng nền tảng hoặc giao gói đăng thủ công. Tạo được video không đồng nghĩa đăng được.

Repo còn hai tầng triển khai publisher: **Studio mới** có channel/account/review theo phiên bản, hiện schema channel chỉ nhận YouTube Long/Shorts; **backend nền tảng/legacy** có thêm MetaPublisher, TikTokPublisher và manual handoff. Có adapter trong code không đồng nghĩa đã nối đầy đủ vào app Studio hay đăng thật thành công.

## 2. Bản đồ tổng

```text
Projects & Brands + nguồn + ngôn ngữ + preset
        |
        +-- Create một lần ------------------------------+
        |                                                |
        +-- Autopilot -> lịch / theo dõi nguồn -> chọn nguồn
                                                         |
                         Chọn flow sản xuất theo family  |
                      game / facts / product / localization / shorts
                                                         |
                 Pin nguồn + snapshot/hash + queue/checkpoint
                                                         |
                      Kế hoạch -> giọng/media -> dựng
                                                         |
              Editor -> phiên bản con -> QA / targeted repair
                                                         |
                 Review riêng: biên tập / giọng / facts / quyền
                                                         |
             +-----------------------+------------------------+
             |                       |                        |
       Gói xuất thủ công      YouTube Studio            Meta / TikTok
       MP4 + phụ đề + ZIP     request/policy            adapter legacy
             |                       |                 chưa nối Studio đủ
        Tự đăng ngoài app      upload/reconcile                |
             |                       |                 manual là đường rõ
             +------ URL / remote ID / trạng thái / metrics ---+
```

## 3. Flow chuẩn bị app và dự án

**Mở EXE → native khởi động Next UI + worker → Models & Tools → chọn profile → preflight → cài model cần dùng → áp dụng cấu hình → tạo mẫu kiểm tra.**

- AI local: Qwen3.5 cho script/dịch/review gợi ý; Qwen ASR; VieNeu tiếng Việt; Kokoro US/UK; Qwen Embedding; Silero VAD tùy chọn; FLUX ảnh riêng; English CTC aligner CPU tùy chọn.
- Không tải mọi model mặc định. Model cài xong không tự được công nhận chất lượng tốt.
- **Projects & Brands → tạo hồ sơ → lưu ngôn ngữ/brand/nguồn → gắn vào Autopilot.**
- Brand preset: font, màu, phụ đề, CTA, giọng VI/US/UK, logo có quyền. Snapshot đã chạy giữ phiên bản cũ.
- Thiết lập trên Windows hiện tại có evidence; máy Windows sạch và mọi runtime bootstrap chưa nghiệm thu đầy đủ.

## 4. Flow tạo một video — Create

**Bước 1 Mục tiêu & đầu vào → 2 Nghiên cứu/kế hoạch → 3 Kịch bản/storyboard → 4 Media/giọng → 5 Preview/chỉnh → 6 QA/xuất hoặc chuyển sang đăng.**

Trong luồng có hỗ trợ plan-only:

```text
Nhập nguồn/brief hoặc script
 -> chạy nghiên cứu/lập kế hoạch local
 -> dừng trước TTS/render
 -> xem nguồn và sửa từng dòng/media thành plan revision
 -> nghe thử riêng dòng đã lưu nếu cần
 -> Continue với cấu hình/nguồn đã pin
 -> tạo giọng từng đoạn, phụ đề, video, QA
 -> xem/chỉnh trong Editor
 -> xuất ZIP hoặc mở Channels để xét đăng
```

- Create và nút Continue không tự cấp quyền đăng.
- Script nhập tay có thể được dùng nguyên văn cho các ngôn ngữ đã chọn; muốn dịch độc lập phải đi flow localization hoặc tạo script ngôn ngữ riêng. Không mặc định coi script nhập tay đã được dịch.
- Plan-stop tương tác đầy đủ chưa áp dụng cho original-speech Shorts/localization; xem transcript/bản dịch ở artifact Production sau khi chạy.

## 5. Flow Autopilot — chạy lặp lại

**7 bước:** Loại nội dung → Nguồn → Đối tượng/ngôn ngữ → Nền tảng/tần suất → Sáng tạo/brand → Chế độ/quyền → Xem lại & kích hoạt.

```text
Autopilot bền vững
 -> đến cửa sổ sản xuất theo timezone/ngày/giờ/embargo
 -> kiểm tra backlog và giới hạn ngày/tuần
 -> tìm nguồn mới đủ điều kiện
 -> tạo job riêng theo ngôn ngữ
 -> chạy factory
 -> lưu draft/QA/review
 -> phân phối nếu publisher/policy/gate hiện hành cho phép
 -> chu kỳ tiếp theo
```

- Nguồn không mới/đủ điều kiện thì bỏ hoặc dời slot, không tạo filler.
- Có pause/resume/cancel/checkpoint và mô phỏng lịch không tạo job.
- Lịch sản xuất khác lịch đăng. Chế độ `AUTHORIZED_AUTO_PUBLISH` trong cấu hình không tự biến mọi publisher thành khả dụng.
- Chưa có content director hoàn chỉnh tự xây chiến lược kênh và chỉ hỏi người dùng khi có ngoại lệ. Delivery hiện vẫn cần bốn review nội dung của từng video.

## 6. Các factory sản xuất

### 6.1 Game marketing

**Gameplay/ảnh/logo + brief có bằng chứng → pin file/hash → phân tích scene/black/freeze/motion/audio → script nhập tay hoặc Qwen → chọn media → storyboard → giọng VI/EN → phụ đề → brand/logo/CTA → FFmpeg → thumbnail/QA → Library/Editor.**

- Matching có thể dùng embedding so lời với mô tả nguồn/scene đã chấp nhận, không phải chứng nhận hiểu cơ chế game từ pixel.
- Library cho sửa mô tả/tên dễ nhớ/khoảng scene; Qwen có thể gợi ý keyframe nhưng cần người xem và lưu.
- Chỉ dùng footage thật để đưa claim gameplay thật. Asset Forge tích hợp qua file/manifest được công bố, không sửa kho nội bộ của nó.
- Thiếu gameplay/logo thật do chủ app chưa có; bằng chứng hiện là fixture có nhãn, không phải nghiệm thu marketing game thật.

### 6.2 Kiến thức/facts

**Chủ đề + URL đáng tin, hoặc feed RSS/Atom đã cấu hình → lấy bài gốc → lưu quote/citation/ngày/hash → lập claim → Qwen viết script riêng từng ngôn ngữ → đồ họa chữ gốc hoặc media được phép → local TTS → dựng/phụ đề/QA → review facts → xuất/đăng đủ quyền.**

- Feed hiện lấy metadata bài viết, xếp hạng heuristic theo từ khóa/độ mới; không tải video/enclosure.
- Quote trùng với nguồn không chứng minh suy luận/claim đúng; claim thiếu evidence chặn review phù hợp.
- Đã chạy technical drafts từ nguồn NASA thật; facts/editorial/listening vẫn là review độc lập.

### 6.3 Product/affiliate

**URL sản phẩm được phép + cấu hình partner/marketplace → lấy thông tin có nguồn/ngày → pin giá/spec/link → script dạng nghiên cứu, không giả đã dùng → disclosure/CTA → đồ họa/media được phép → VI/EN TTS → dựng/QA → kiểm lại freshness/giá/link/settings trước đăng → review/xuất.**

- Có probe/draft thật từ Adafruit; thiếu trải nghiệm campaign/affiliate/account thật và discovery marketplace rộng.
- Không tự mua hàng, không tạo review trải nghiệm giả. Duration/caption warnings còn phải xử lý theo từng output.

### 6.4 Dịch/lồng tiếng video có quyền — localization

```text
Creator cung cấp file / người dùng lấy file qua phương thức được phép
 -> import thư mục có đúng một video, hoặc local folder watcher
 -> ghi riêng quyền cắt + dịch + lồng tiếng + phân phối, evidence và hạn
 -> pin video gốc/hash
 -> FFprobe kiểm audio/thời lượng
 -> tách audio mono 16k theo chunk
 -> Qwen ASR chép lời thật
 -> Qwen dịch riêng từng đích VI/US/UK, giữ tên/số/ý/ngữ cảnh
 -> VieNeu hoặc Kokoro đọc bản dịch
 -> căn thời lượng đoạn hình với lời dịch
 -> tạo phụ đề / render / lưu transcript, translation, nguồn và quyền
 -> nghe/xem duyệt ý nghĩa và quyền
 -> xuất hoặc xét đăng theo kênh
```

**Phạm vi thực:** một file nguồn/video, tối đa 10 phút trong adapter localization; timestamp nguồn là chunk ước lượng, không căn từng từ. Các bản VI→EN và EN→VI có technical evidence. Mandarin ASR có sample riêng; full Mandarin creator feed → VI/EN chưa nghiệm thu.

**Chưa có flow dán URL Bilibili/Douyin/YouTube/Facebook rồi tự tải video về.** `sourceUrl` không phải downloader. Không có remote creator watcher/downloader hoàn chỉnh. Local watcher chỉ đọc file mới đã nằm trong thư mục được phép.

**Âm thanh:** nhánh này thay lời gốc bằng giọng tổng hợp đã chọn; chưa tự tách và bảo toàn nhạc/SFX gốc bằng source separation; không clone giọng người nói. Cần review các đoạn speech cắt ngang chunk và retiming.

### 6.5 Long-to-Shorts

**Một video dài có quyền → pin file → ASR chunk → Qwen đề xuất đoạn có ý trọn vẹn → chọn excerpt → cắt/reframe/subtitle → giữ lời nói gốc → QA/meaning review → xuất.**

- Không viết thêm câu nói rồi giả là speaker gốc đã nói.
- Chọn ngôn ngữ đúng lời gốc; muốn đổi ngôn ngữ dùng localization.
- Có đề xuất nhiều candidate, không đồng nghĩa đã có factory hàng loạt hoàn chỉnh xuất mọi candidate thành campaign Shorts.

### 6.6 Custom

Có family/config chung và nhánh script/media cơ bản. **Chưa có trình tạo workflow/template tùy ý đầy đủ** để kéo-thả ghép mọi stage và chạy production được nghiệm thu.

## 7. Các flow nguồn và thư viện

| Flow | Luồng hiện có | Giới hạn |
|---|---|---|
| Import local | File/folder → copy/pin/hash → artifact/version | Upload UI giới hạn mỗi lượt; đường dẫn nguồn ngoài dữ liệu vẫn phải tự giữ |
| Watch folder có quyền | Quét file ổn định → hash/dedup → pin intake → tạo ngôn ngữ còn thiếu → chạy | Không download từ website; không suy quyền từ tên thư mục |
| RSS/Atom facts | Feed cho phép → metadata/độ mới/từ khóa → bài gốc → research | Chỉ facts; không lấy video trong enclosure |
| Catalog media | Preview → tên/mô tả/scene → lưu SHA revision → matching bản mới | Không đổi nguồn gốc, không viết lại input của run cũ |
| Vision keyframe | Chọn frame giới hạn → Qwen local → hiện gợi ý/evidence → dùng làm nháp → người dùng lưu | Fixture nhận sai hình, giữ FLAGGED; không OCR/gameplay certification |
| Semantic search | Index dẫn xuất từ tối đa 100 original ready → query VI/EN → kết quả theo similarity | Không phải chứng minh nguồn đúng/quyền/độc đáo; chưa refresh incremental đầy đủ |
| Image Studio | Prompt → FLUX local → PNG → Library | Chạy riêng; chưa phải auto tạo mọi shot hay image editing engine hoàn chỉnh |

## 8. Editor, QA, sửa và phiên bản

**Chọn version → chọn cảnh/preview → lời đọc/timeline/phụ đề/QA/so sánh/xuất → lưu thay đổi → child version → chạy stage cần thiết → QA lại.**

- Cut `00:05–00:08`, zoom, gain, title, caption, import nhạc có quyền và restore version là thao tác typed/deterministic.
- Sửa một câu narration ở bản chưa cắt: TTS lại câu đó, cập nhật timing/phụ đề/render phụ thuộc và giữ đoạn khác. Sửa lời tùy ý sau mọi cut chưa hoàn chỉnh.
- Waveform decode local; chỉnh boundary phụ đề tạo child, không tạo lại lời. English aligner tùy chọn chỉ ghi aligned khi guard đạt; Việt vẫn estimated/manual.
- Repair Planner: regroup caption, normalize mix hoặc encode lại; retry budget giới hạn; không sửa thiếu quyền bằng workaround.
- Nháp đang gõ được giữ local; bản server áp dụng là version riêng. So trước/sau không kế thừa approval.
- QA technical tách editorial/voice/facts/rights. Technical PASS không đủ điều kiện tự đăng.

## 9. Flow review và xuất thủ công

**Ready output → technical QA → review 4 scope `editorial / voice / facts / rights` → quyết định gắn fingerprint video/evidence → chọn xuất hoặc xét publisher.**

**Manual export:** MP4 + thumbnail + phụ đề SRT/ASS + metadata/citations + manifest/review trạng thái → ZIP có checksum/CRC → tải từ app → người dùng đăng bằng công cụ chính thức.

- Export vẫn là draft nếu còn gate thiếu; không tự cấp quyền.
- Không gói model/credential/log/raw original. Gói cũ không tự cập nhật khi quyền hết hạn.
- Legacy có manual-kit gồm MP4/caption/checklist và `/posted JOB_ID URL`; đây không phải xác nhận API đã đăng hay phần kết nối tài khoản đầy đủ của Studio mới.

## 10. Flow đăng từng nền tảng

### 10.1 YouTube Long / Shorts — Studio mới

```text
Channels & Accounts
 -> tạo channel, expected Channel ID
 -> OAuth loopback/PKCE hoặc credential được cấu hình theo channel revision
 -> mã hóa credential DPAPI
 -> kiểm tra account identity/quyền
 -> chọn output version + 4 content reviews + technical QA
 -> title/description/tags/privacy/AI disclosure
 -> cấp quyền cho đúng version + channel
 -> freeze video/hash/evidence
 -> preflight quyền/nguồn/account/policy hiện tại
 -> resumable upload, lưu session và remote ID
 -> nếu lỗi mạng: reconcile trạng thái cũ trước retry
 -> kiểm tra processing/privacy/availability
 -> lưu URL/remote ID/trạng thái
 -> metrics khi API/account thực cung cấp
```

Có hai cách kích hoạt: yêu cầu một version/một channel hoặc **persistent delivery policy SAU bốn review từng video**, có giới hạn/phạm vi/revision. Không phải “cài một lần rồi miễn mọi content review”. Lịch sản xuất và delivery policy có guard; không suy đã có full multichannel autonomous publishing calendar.

**Trạng thái:** UI/contracts và transport thử có evidence; chưa owner OAuth/login/upload thật. Shorts là đích `youtube_shorts`, không phải cam kết video nào cũng được nền tảng phân loại như mong muốn.

### 10.2 Facebook Page Reels — adapter backend/legacy

**Nhánh có adapter:** cấu hình Page ID/token → kiểm tra đúng Page → tạo phiên Reels (`start`) → lưu video ID/upload URL → upload bytes → `finish` draft/published theo cấu hình → reconcile/status → URL/metrics nếu trả về.

**Nhánh thiếu cấu hình:** tạo manual kit → người dùng đăng thủ công → ghi nhận URL theo flow legacy.

**Studio hiện tại:** schema Channels mới chưa nhận Facebook, chưa có đầy đủ onboarding Page, quyền theo account, scoped authorization/delivery và nghiệm thu live tương đương YouTube. Adapter có kiểm tra identity nhưng không phải kiểm chứng đầy đủ scopes/app review. Version API trong repo là cấu hình/code hiện có, không coi là đã xác minh với tài liệu Meta hiện hành.

**Chưa có “xây kênh Facebook” hoàn chỉnh:** chiến lược Page, pillar/series, lịch phối hợp text/ảnh/Reels, vòng cải thiện theo số liệu thật và quản lý cộng đồng chưa phải một flow end-to-end được triển khai.

### 10.3 Instagram Reels — adapter backend/legacy

**Có cấu hình:** IG identity/token → tạo media container → upload → chờ container ready → publish container → lưu media ID/permalink → reconcile/status/metrics nếu khả dụng.

**Thiếu cấu hình/quyền:** manual kit/ZIP → người dùng đăng thủ công.

**Trạng thái:** adapter/code/tests giới hạn, chưa nối Channels Studio đầy đủ và chưa live-account acceptance. Không suy đã có flow Stories/carousel/feed hoặc quản trị kênh IG hoàn chỉnh.

### 10.4 TikTok — adapter backend/legacy

**Nhánh adapter được bật trong code:** token + cờ audited cấu hình → creator-info/capability → init upload → lưu publish ID/upload URL → upload chunks → fetch/reconcile publication status.

**Nhánh mặc định không đủ cấu hình:** manual handoff → tự đăng trong ứng dụng chính thức.

**Trạng thái:** không có TikTok channel/account flow đầy đủ trong Studio mới, chưa live posting. Cờ audited do cấu hình không phải bằng chứng nền tảng đã phê duyệt. Điều kiện tài khoản/API thực tế cần kiểm chứng riêng khi tích hợp; không dùng browser cookie automation thay cho publisher.

### 10.5 So sánh nhanh

| Đích | Studio mới có channel flow? | Adapter backend? | Đã đăng account thật? | Đường dùng rõ hiện tại |
|---|---|---|---|---|
| YouTube Long/Shorts | Có, review + authorization + upload/reconcile | Có | Chưa | Chuẩn bị/review trong app; kết nối/test account riêng hoặc xuất |
| Facebook Page Reels | Có (02/11), chờ tài khoản | Có | Chưa | Review + authorization + upload/reconcile như YouTube; test fake HTTP |
| Instagram Reels | Có (02/11), chờ tài khoản; chỉ công khai | Có | Chưa | Container FINISHED mới publish; test fake HTTP |
| TikTok | Có (02/11), chờ tài khoản + app đã audit | Có | Chưa | App chưa audit ⇒ giữ lại, dùng gói đăng thủ công |

## 11. Telegram, analytics và vận hành

- **Telegram:** bật bot + allowlist user/chat → durable inbox/outbox → status/queue/report/pause, preview/review/publish_status → approve/reject scope theo hash + confirmation. Duyệt nội dung không tự cấp quyền đăng. `/posted` thuộc đường manual legacy. Chưa có bot/message live acceptance.
- **Analytics:** chỉ gắn metric với remote ID xác nhận → lưu snapshot → hiện unknown cho dữ liệu thiếu → thống kê/gợi ý khi đủ mẫu tương thích. Chưa có dữ liệu account thật, retention/Steam attribution đầy đủ hoặc learning tự chứng minh tăng trưởng.
- **Chống lặp:** hash/source overlap + lexical script/hook/lineage → gợi ý xem lại; chưa semantic originality gate tổng quát.
- **Queue/GPU:** job bền vững → khóa tài nguyên/1 heavy GPU → checkpoint → retry/circuit breaker → lỗi một engine không làm hỏng mọi job.
- **Native recovery:** web/worker exit → chờ 2/5/10s, tối đa ba restart mỗi dịch vụ/phiên → reconnect; hết budget thì blocked. Không watchdog mọi process bị treo.
- **Backup:** pause/chờ job → tạo backup → inspect/checksum/current fingerprint → xác nhận restore → dừng services → journal/safety/staging → restore hoặc rollback → reconnect → kiểm tra trước khi mở lại production/posting; có guarded undo.

## 12. Flow xây kênh Facebook — ĐÃ TRIỂN KHAI phần Reels (02/11/2026)

**Cập nhật 02/11/2026:** Trang Kênh có mục “Xây kênh theo chiến lược” (`packages/automation/src/channel-strategy.ts`): hồ sơ kênh → pillar/series/backlog ý tưởng → đề xuất kế hoạch tuần (không lặp ý tưởng, bỏ chủ đề cấm) → **chủ duyệt từng ý tưởng** → tạo Autopilot nháp (tắt) ở factory phù hợp → duyệt 4 phạm vi + cho phép đăng từng phiên bản như YouTube → số liệu thật theo series, gợi ý chỉ khi ≥2 series × 5 bài có lượt xem. Facebook Page Reels / Instagram Reels / TikTok đã có trong Channels Studio, review, publish, đối soát và số liệu; nhập khóa ở **Cài đặt › Tài khoản & Khóa**. Mọi đường live đều **chờ tài khoản** (chỉ test với fake server). Bài chữ/ảnh/carousel, cộng đồng/inbox chưa xây.

Nội dung đề xuất gốc giữ bên dưới để đối chiếu.

Nên bổ sung một **lớp quản lý chiến lược/campaign của Page**, dùng lại các factory hiện có và mở rộng publisher Studio. Không cần tạo thêm một nhánh “tạo video Facebook” tách rời rồi lặp code.

```text
Chọn Page người dùng quản lý
 -> hồ sơ kênh: mục tiêu/chủ đề/đối tượng/ngôn ngữ/tone/brand/CTA
 -> content pillars + series + nguồn được phép + tiêu chí tránh lặp
 -> kế hoạch tuần: ý tưởng -> brief -> loại bài -> lịch -> resource budget
 -> router nội dung:
      Reels/video -> facts/game/product/localization/shorts factory
      text/ảnh/carousel -> các stage còn phải xây và nghiệm thu
 -> viết caption/title/thumbnail theo Page
 -> biên tập/QA/facts/rights/disclosure
 -> review hoặc policy đủ phạm vi
 -> manual export hoặc Facebook publisher đủ quyền
 -> reconcile đúng Page/post ID/trạng thái
 -> metrics thật theo post/series
 -> đề xuất chủ đề/hook/tần suất cho vòng kế tiếp
```

Những phần tái dùng: Projects/brand, media catalog, source/hash/rights, local models, factory video, editor/version/QA, scheduler, queue/GPU, review, backup và notification.

Những phần cần bổ sung rõ ràng:

1. `Facebook Page` trong schema Channels/credential/capability của Studio, onboarding và reconnect có kiểm chứng quyền/account; rà lại API chính thức tại thời điểm triển khai.
2. `Channel Strategy / Content Pillars / Series / Goals` và editorial plan; liên kết một ý tưởng với nhiều format/post/version thay vì chỉ run video.
3. Hợp đồng `Post` chung cho Reel/video/text/image/carousel; chỉ bật format được connector/account thực hỗ trợ và đã test. Post text/ảnh không đi qua TTS/render không cần thiết.
4. Facebook publication state/idempotency/reconciliation/frozen approval và quota/account-specific policy tương đương nguyên tắc YouTube; không chỉ gọi adapter cũ trực tiếp từ UI.
5. Lịch đăng Page khác lịch sản xuất, có backlog/expiry và giới hạn phối hợp các loại bài.
6. Import metrics thật, dashboard theo pillar/series/format và vòng đề xuất có sample size; không suy revenue/followers/conversion từ views.
7. Nếu cần quản lý cộng đồng: inbox/comment suggestion + quyền duyệt trước phản hồi; không mặc định tự nhắn, auto-seeding hay tạo engagement.

Tạm hiểu “build kênh” là phát triển nội dung cho Page do chủ app quản lý. Tạo Page mới, Group, profile cá nhân, inbox/CRM, ads và monetization là các phạm vi riêng; chưa mặc định bao gồm.

## 13. Source và bằng chứng để review

- Orchestration/schema: `packages/automation/src/studio.ts`, `apps/worker/src/studio.ts`.
- Localization/Shorts: `apps/worker/src/studio-localization.ts`, `studio-shorts.ts`, `packages/automation/src/source-watch.ts`.
- Studio publishing: `packages/automation/src/studio-publishing.ts`, `studio-delivery-policy.ts`, `apps/worker/src/studio-publishing.ts`.
- Legacy platform wiring: `apps/worker/src/context.ts`; adapter Meta/TikTok tại `packages/platforms/src/meta.ts`; manual handoff tại `manual.ts`.
- Review: `packages/automation/src/review.ts`.
- Trạng thái/evidence: `IMPLEMENTATION_STATUS.md`, `ACCEPTANCE_MATRIX.md`, `QUALITY_UX_IMPROVEMENTS.md`, `RESTORE_AND_RECOVERY.md` và `dist/windows/build-report.json`.

Tài liệu mô tả code/repo hiện có; không xác nhận điều kiện API hoặc chính sách nền tảng mới nhất. Khi thực hiện tích hợp account thật phải kiểm tra tài liệu chính thức, scope/account và nghiệm thu lại.

## 14. Cập nhật 03/11/2026 — bài không phải video, hộp thư Page, Meta Muse

- **Bài chữ/link/ảnh/carousel** (`/studio/posts`): tạo → duyệt 2 phạm vi (nội dung, quyền) gắn fingerprint → cho phép đăng từng bài + kênh → job `STUDIO_POST_PUBLISH` → đối soát → số liệu; luôn có gói xuất thủ công (ZIP: ảnh, caption, manifest). Facebook Page: chữ, link, 1 ảnh, nhiều ảnh (`/feed`, `/photos`). Instagram: 1 ảnh, carousel (Content Publishing API; ảnh lấy URL công khai bằng cách tải ảnh không đăng lên Facebook Page liên kết). TikTok: bài ảnh/carousel (photo mode, PULL_FROM_URL từ tên miền đã xác minh, cần app đã audit). **YouTube bài cộng đồng: không có API chính thức → chỉ xuất thủ công.** Tất cả **chờ tài khoản**; chỉ test với fake server.
- **Hộp thư & bình luận Facebook Page** (`/studio/inbox`): đồng bộ tin nhắn/bình luận (chỉ đọc), nội dung người khác là dữ liệu (lệnh chèn gắn cờ), bản nháp từ CommentAssistant, **chủ sửa và duyệt từng câu** rồi worker mới gửi (`STUDIO_INBOX_SEND`), dừng khi tạm dừng/dừng khẩn. Chờ tài khoản.
- **Tạo qua Muse AI**: chế độ “Nguồn video” trong Create/Autopilot; AI local viết prompt, chủ sửa; driver trình duyệt meta.ai (một tài khoản, hồ sơ riêng `%LOCALAPPDATA%\AutonomousCreativeStudio\muse-profile`, nhịp như người, giới hạn/ngày, captcha/checkpoint/đăng nhập/giới hạn ⇒ dừng + Paused (Needs user) + thông báo; không giải captcha, không stealth/proxy/xoay vòng); video lưu nguyên bản bất biến + provenance (prompt, thời điểm, nguồn Meta Muse, nhãn AI), không sửa mặc định (logo tùy chọn; phụ đề Muse chưa hỗ trợ) → QA kỹ thuật → duyệt → đăng mọi nền tảng với cờ AI. Interface `MuseGenerator` để thay bằng API chính thức sau này; selector gom ở `MUSE_SELECTORS`, layout đổi ⇒ “driver needs update”. **Chờ đăng nhập**; giới hạn thời lượng/khung hình Muse CHƯA KIỂM CHỨNG.
