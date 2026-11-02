# Sử dụng AUTONOMOUS CREATIVE STUDIO

Đây là hướng dẫn cho phần đã triển khai, không phải chứng nhận toàn bộ master prompt. Đối chiếu `IMPLEMENTATION_STATUS.md`, `RELEASE_QA.md` và `dist/windows/build-report.json` để biết bản EXE nào đã kiểm tra.

## Cài và mở

Chạy `dist/windows/AUTONOMOUS CREATIVE STUDIO_0.2.0_x64-setup.exe`. Bản portable cần giữ EXE cạnh `backend`, `runtime`, `engines`. App tự mở Next UI và worker; không cần mở terminal khi sử dụng bản đã cài.

Trong **Cài đặt & Chẩn đoán → Ứng dụng Windows**, chọn đóng cửa sổ để giữ chạy nền hoặc thoát. Tray → Quit luôn thoát. Autostart chỉ bật khi người dùng chọn và lưu; công cụ kiểm thử chưa bật autostart. Tác vụ bị ngắt phục hồi từ checkpoint còn hợp lệ khi mở lại.

Dữ liệu mặc định ở `%LOCALAPPDATA%/AutonomousCreativeStudio/data`. Nếu có dữ liệu cũ tại `%LOCALAPPDATA%/TuToMoFactory/data`, app tiếp tục dùng thư mục đó. Đường dẫn thực hiển thị trong Settings; không xóa thư mục dữ liệu để nâng phiên bản.

## Sao lưu

Tạm dừng **Production**, chờ tác vụ đang chạy kết thúc, mở **Cài đặt & Chẩn đoán → Sao lưu dữ liệu** rồi chọn **Tạo bản sao lưu**. Mặc định lưu metadata: Autopilot, phiên bản, timeline, cấu hình và bằng chứng. Chọn kèm media nếu muốn chép cả ảnh/âm thanh/video nằm trong thư mục dữ liệu. Credential, model và footage ở thư mục nguồn bên ngoài cần phương án sao lưu riêng.

**Kiểm tra checksum & đối chiếu** báo số file khớp, hỏng/thiếu, khác với dữ liệu hiện tại và metadata sẽ xóa; thao tác kiểm tra không ghi đè dữ liệu. Trong app Windows, tích xác nhận phạm vi rồi **Khôi phục bản đã kiểm tra**. App dừng web/worker thuộc chính nó, tạo bản an toàn, khôi phục và tự kết nối lại. Giữ app mở trong lúc bảo trì; lỗi giữa chừng được rollback, lần mở sau xử lý journal trước khi chạy worker. Metadata-only giữ media hiện có, không phục hồi video đã mất. Backup cần checksum đầy đủ, cùng data version; credential/model/nguồn ngoài DATA_DIR không nằm trong luồng này.

Khi hoàn tất, sản xuất/đăng bị khóa, Telegram và Autopilot tắt để kiểm tra lại. **Hoàn tác khôi phục** trả lại dữ liệu trước đó nếu chưa có thay đổi mới; app từ chối ghi đè công việc mới. Đường dẫn bản an toàn hiện tại kết quả bảo trì. Web-only không có nút restore hoạt động. Chép backup sang ổ khác để phòng hỏng ổ. Chi tiết phạm vi, giới hạn dung lượng và recovery: [RESTORE_AND_RECOVERY.md](RESTORE_AND_RECOVERY.md).

App Windows hiện tự restart web/worker đã thoát tối đa ba lần mỗi dịch vụ trong một phiên, với khoảng chờ 2/5/10 giây. Không cần mở lại sau lỗi đơn lẻ; nếu hết budget hoặc bảo trì cần xử lý, trạng thái **RECOVERY_BLOCKED** nêu lý do. Xem log/Chẩn đoán trước khi mở lại. Heartbeat trễ không đồng nghĩa process đã chết; không tự xóa lock.

## Chuẩn bị AI local

**Model & Công cụ** hiện chia bốn tab: **Thiết lập**, **Model đã cài**, **Giọng đọc**, **Kiểm tra máy**. Chuyển tab giữ nội dung đang nhập. Tab Giọng đọc có bộ sáu câu Việt hoặc Anh để so giọng trước/sau đổi model; tạo mẫu là tác vụ local có thể chờ trong queue, không tự được đánh dấu đã nghe duyệt.

Profile tùy chọn **wav2vec2-en-align** dùng khoảng 378 MB checkpoint để căn từ English trên CPU, cần runtime ASR tương thích. Sau cài và áp dụng, chỉ bản narration mới đủ điều kiện mới dùng căn từ; câu không đạt guard giữ ước lượng. Không hỗ trợ căn từ Việt. Không cần cài profile này để cắt/dựng video hoặc chỉnh mốc phụ đề bằng tay.

Đợt P0 bổ sung wizard 4 bước: **Chọn profile → Kiểm tra máy trước → Cài profile → Áp dụng & Kiểm chứng**. Checklist nêu GPU/disk/runtime/model và cách xử lý từng mục thiếu; preflight không tải hoặc nạp model. Thư mục và profile được giữ khi đóng/mở. Nếu thiếu FFmpeg/FFprobe, chọn đường dẫn của chúng trong Settings trước khi dựng. Xem [P0_IMPLEMENTATION.md](P0_IMPLEMENTATION.md) để biết các bước sửa kế hoạch, nghe thử từng câu và Repair Planner.

Mở **Model & Công cụ**. Chọn thư mục setup riêng của ACS, ví dụ `C:\Users\Winka\Projects\mmo` trên máy hiện tại. Có thể tìm đường dẫn đã cài, xem kết quả rồi áp dụng. Cài theo từng profile cần dùng: Qwen3.5-9B, Kokoro, VieNeu và Qwen3-ASR. Không tải toàn bộ model tùy chọn mặc định.

Qwen hiện cần Ollama executable cùng thư mục `lib` sẵn trong `.local/tools/ollama`, hoặc đường dẫn `llmBinary` riêng. Máy hiện tại đã có runtime ACS và model store riêng, dùng loopback 11435. Chưa có quy trình tải runtime Ollama mới hoàn toàn qua UI; không coi đó là cài sạch đã nghiệm thu. Không chọn thư mục env/model của Asset Forge để cài hoặc sửa.

Silero VAD là profile nhỏ tùy chọn chạy CPU, dùng runtime Torch/SciPy có sẵn trong env ASR và checkpoint đã pin riêng. Cài profile → áp dụng cấu hình → tạo mẫu giọng → kiểm tra VAD trên mẫu giọng và im lặng. VAD đo hoạt động tiếng nói, không nhận dạng ngôn ngữ hoặc canh từng từ.

Trong Voice Studio chọn Việt, Anh–Mỹ hoặc Anh–Anh để tạo/nghe WAV. Giọng đã thử trên máy: Minh Quân, `af_heart`, `bf_emma`. ASR khớp lời không thay thế việc nghe duyệt. Chỉ đánh dấu đã nghe khi thực sự kiểm tra đúng audio đang hiển thị.

## Tạo một video

**Tạo nội dung** có 6 bước: đầu vào → nghiên cứu → script/storyboard → media/voice → preview/edit → QA/export. **Autopilot** là cấu hình lặp lại, được tạo bằng 7 bước riêng và có lịch riêng. Lưu nháp giữa bước; có thể quay lại sửa.

Với game/custom và facts/product, ở bước 2 chọn **Nghiên cứu và tạo kế hoạch thật**. App ghim nguồn/cấu hình, tạo script/storyboard rồi dừng trước lời đọc. Xem claim/citation ở bước 2, từng cảnh ở bước 3; chọn phiên bản/ngôn ngữ đã tạo trong danh sách. Bước 4 **Dựng preview từ kế hoạch này** tiếp tục TTS/captions/QA; bước 5 phát video thật và mở Editor; bước 6 xem QA và tải ZIP. Kế hoạch đã chọn giữ nguyên; sửa nháp rồi tạo kế hoạch mới nếu muốn đổi đầu vào/giọng. Thời gian cảnh trước TTS chưa được đo. Shorts/localization vẫn dùng Production đầy đủ. Liên kết `/studio/create?id=<run>` có thể mở lại bản nháp từ server, không cần có local cache trước đó.

- **Game:** nhập gameplay/ảnh/logo có quyền và brief mô tả chức năng đã xác nhận. Hiện chủ app chưa cung cấp bộ nguồn thật nên chưa có nghiệm thu game thật.
- **Facts:** thêm URL công khai đáng tin cậy và góc giải thích. App lấy văn bản, lưu quote/citation, tạo script riêng theo ngôn ngữ, đồ họa chữ gốc và narration. Quote khớp nguồn vẫn cần kiểm tra nghĩa, mức cập nhật và quyền trích dẫn trước khi đăng.
- **Product:** thêm URL một sản phẩm có Product/Offers JSON-LD rõ ràng. Pipeline ghi nguồn/ngày tra cứu, disclosure đọc và description, affiliate URL nếu được khai hợp lệ. Preflight lấy lại nguồn để đối chiếu giá/spec/link và hạn; nguồn đổi làm hold/invalidate, không tự sửa approval. Có bản nháp VI/EN CUDA thật với warning thời lượng/caption còn cần review. Chưa có account/affiliate program thật; quyền hình ảnh và public use vẫn cần duyệt. Có thể xuất gói thủ công.
- **Localization có quyền:** chọn nguồn video local do creator cung cấp hợp lệ; khai riêng quyền cắt, dịch, lồng tiếng, phân phối và hạn dùng. Chọn VI và/hoặc EN. App ASR lời gốc, dịch riêng từng ngôn ngữ, TTS và retime footage. Không clone người nói. File có subtitle burn sẵn cần xem chồng chữ. Mandarin full-flow vẫn cần nguồn có quyền để nghiệm thu.
- **Long-to-Shorts:** chọn video có tiếng nói và quyền cắt/phân phối. App dùng ASR + lựa chọn đoạn, giữ video/lời nói gốc, không TTS thay lời. Timing theo chunk còn ước lượng; kiểm tra đầu/cuối và ý nghĩa trước khi dùng.

Từ điển phát âm ở bước ngôn ngữ/voice nâng cao chỉ thay lời đọc, giữ chính tả script/caption. Mỗi locale có mục riêng; nghe kiểm tra cách đọc mới.

## Theo dõi thư mục nguồn

Trong Autopilot loại Localization/Long-to-Shorts, mở lựa chọn theo dõi thư mục ở bước nguồn. Thư mục chứa các video hoàn chỉnh do chủ nguồn cung cấp; mọi file phải thuộc phạm vi giấy phép đã khai báo. Khi kích hoạt, worker quan sát theo chu kỳ, hash chống trùng và pin một nguồn riêng cho mỗi lượt sản xuất, tạo các bản ngôn ngữ còn thiếu.

File đổi tên nhưng giữ nguyên bytes không tự tạo lại nội dung. File đang ghi được chờ ổn định. Hiện giới hạn 40 video cấp thư mục đầu và 2 GiB mỗi file/lượt đọc; archive các nguồn đã dùng sang thư mục khác khi cần. Nút quét lại ép đọc lại hash nếu metadata file không phản ánh thay đổi. Watcher này không tải video từ URL hay vượt xác thực của website.

## Biên tập và duyệt

**Sản xuất** hiển thị từng stage, lỗi và artifact. Có pause/resume/cancel ở ranh giới an toàn; cancel giữ file đã hoàn thành. GPU bận sẽ chờ, không tự đổi model/preset hoặc dùng API cloud.

**Biên tập:** chọn phiên bản, xem Preview/Transcript/Timeline/Audio/Quality/Versions/Publish. `Cut 00:05–00:08` cắt deterministic và tạo child version; sửa caption, zoom trong khoảng, mix gain, title và nhập music/SFX có bằng chứng quyền. Restore tạo phiên bản mới, giữ parent. Sửa một câu narration được hỗ trợ trên bản narration chưa cắt; chưa có đầy đủ word alignment hay re-narration tùy ý sau mọi timeline edit.

**Duyệt & Ngoại lệ** tách bốn phạm vi editorial, voice, facts, rights. Ghi bằng chứng và chỉ xác nhận sau khi xem/nghe. Approval gắn đúng hash video/snapshot/evidence; child không tự kế thừa. Thiếu quote nguồn không thể được thay bằng một checkbox. QA kỹ thuật pass không đồng nghĩa nội dung đã hay, có quyền hoặc được phép đăng.

## Kênh và lệnh đăng

Trong **Kênh & Tài khoản**, mục đăng nhập YouTube nhận OAuth client loại Desktop và expected Channel ID. Chuẩn bị phiên local, rồi tự bấm mở trình duyệt hệ thống để chọn tài khoản/cấp quyền tại Google. Hủy hoặc thử lại không xóa credential đang có. Callback dùng loopback/PKCE/state riêng; sau xác minh danh tính và đủ scopes, refresh token được lưu DPAPI theo kênh/revision, không trả token về UI và kênh vẫn tắt. Cũng có form nhập credential thủ công. Cần tạo OAuth app và bật YouTube Data API theo hướng dẫn Google; chưa có tài khoản thật để nghiệm thu login.

Kiểm tra kết nối, đối chiếu danh tính rồi bật kênh. Bật chức năng đăng Studio khi muốn sử dụng; cấu hình này không bật publisher legacy. Chọn phiên bản đã đủ bốn phạm vi duyệt, kênh đích, privacy, title/description/disclosure rồi cho phép gửi đúng phiên bản đó. Worker kiểm tra lại quyền hiện tại, hạn dùng/embargo, hash và tài khoản trước upload. Session/remote ID được lưu để đối soát trước retry. `available` chỉ nói video tồn tại trên nền tảng; actual privacy hiển thị riêng, không mặc định là public.

Mục **Tự giao bản đã duyệt đến kênh** lưu phạm vi cho một Autopilot/kênh/revision, ngôn ngữ, privacy, timezone/giờ, hạn dùng và giới hạn ngày/tuần. Mỗi video vẫn cần đủ bốn phạm vi duyệt cho đúng hash; policy chỉ bỏ lệnh gửi lặp lại sau khi đã duyệt, không tự duyệt nội dung. Có mô phỏng không enqueue và nút thu hồi. Sửa cấu hình/kênh cần cấp lại quyền. Không có policy nào mặc định; chưa có kết nối tài khoản hoặc bài đăng thật được nghiệm thu. Meta/TikTok dùng gói xuất thủ công.

## Hồ sơ, sản phẩm và hình minh họa

**Dự án & Thương hiệu:** tạo hồ sơ game/thương hiệu/chủ đề/đối tác/tùy chỉnh, ngôn ngữ, brief và từ điển phát âm. Tạo Autopilot từ hồ sơ sẽ ghim revision và mở wizard; luôn là nháp đang tắt/chờ quyền. Sửa hồ sơ không đổi các Autopilot cũ. Lịch sử hồ sơ giữ các mặc định cũ.

**Sản phẩm:** bước nguồn nhận một URL HTTPS có một Product JSON-LD rõ ràng. Chưa tự tìm sản phẩm trên marketplace. Khai báo affiliate nếu có quyền, URL và công bố hoa hồng; công bố được đọc và xuất trong `product-publication-description.txt`. Chọn thời lượng đủ cả lời giải thích và công bố. Giá/spec/nguồn/đích affiliate được kiểm tra lại trước upload; thay đổi hoặc quá hạn giữ phiên bản cũ để xem và yêu cầu bản mới. Cắt/mute mất lời công bố cũng chặn đăng. Không tự nhận đã dùng/thử sản phẩm.

**Model & Công cụ → ảnh:** chọn profile FLUX, cài riêng, áp dụng config rồi chạy kiểm chứng. Nhập prompt, kích thước gốc và seed để xếp hàng. Ảnh có nhãn AI/chưa duyệt; tìm theo ID/prompt và tải đúng PNG từ Library. Xem ảnh trước khi dùng: mẫu vuông từng có nét giống chữ ký không mong muốn, không có bảo đảm chữ hoặc sự thật trong ảnh. Tên/tiêu đề chính xác tiếp tục dùng pipeline font. Không tự chèn ảnh AI thành bằng chứng gameplay/sản phẩm.

**Transcript:** các phrase có timestamp/clip liên quan và nút seek đầu/cuối. Chọn cụm cần bỏ để xem duration/lời xóa/lời giữ, nghe hai đầu rồi xác nhận và tạo phiên bản con. Cắt đồng bộ mọi track; không gọi AI hoặc viết lại lời. Mốc VAD/phrase vẫn là ước lượng, có thể cắt âm tiết; cần duyệt lại ý nghĩa sau cắt. `caption-quality.json` ghi tốc độ đọc, bounds và layout ước lượng.

**Tìm theo ý nghĩa:** trong Model & Công cụ, chọn Qwen Embedding, cài checkpoint riêng, áp dụng các trường embedding rồi kiểm tra. Profile dùng runtime ASR tương thích đã cài hoặc Python isolated do bạn cấu hình, không sửa package runtime đó. GPU là mặc định; không tự chuyển CPU khi GPU bận. Library → dựng/làm mới chỉ mục → nhập truy vấn Việt/Anh → tìm bằng model local. Chỉ mục phụ bao gồm tối đa 100 bản gốc ready gần nhất, không lập lại child/cut. Khi model/runtime/thư viện đổi, dựng lại trước khi tìm. Điểm tương đồng giúp tìm kịch bản; không xác minh sự thật, quyền hoặc chứng minh nội dung độc đáo. JSON/JSONL gốc giữ nguyên.

**Worker đã dừng:** Overview/Production/Editor/Models phân biệt worker sống với file khóa còn sót. Khi worker đã chết, thoát hẳn app rồi mở lại để khôi phục checkpoint; không xóa khóa chỉ vì heartbeat chậm. UI vẫn cho xem nháp và bản xuất. App hiện chưa tự khởi động lại mọi worker bị lỗi sau lúc mở.

## Lịch, Telegram và số liệu

**Feed facts công khai:** trong bước nguồn của Autopilot kiến thức, bật khám phá từ feed RSS/Atom được phép đọc, nhập URL feed, từ khóa và chu kỳ. Không nhập thư mục media hoặc script cố định cho chế độ này. Quét thử để xem metadata/điểm độ mới và từ khóa, rồi kích hoạt khi cấu hình đã đúng. App đọc bài gốc để nghiên cứu, không dùng RSS summary làm bằng chứng và không tải video/enclosure. Nguồn hết hoặc quá cũ thì bỏ slot. Feed không cấp quyền dùng lại ảnh/video hoặc tự duyệt facts.

**Footage game:** tab Quality có scene boundary, màn đen, phần nguồn đã quét, source hash/đường dẫn và các khoảng gợi ý theo motion/audio. Đây là gợi ý để xem lại footage; chưa tự thay shot hay chứng minh cơ chế game. Chỉ quét tối đa bốn video, 300 giây mỗi video; phần chưa đo ghi rõ. OCR/debug detection chưa được bật trong flow này.

**Tải gói thủ công:** chọn phiên bản ready → Publish → tạo gói ZIP. Gói chứa đúng MP4/phụ đề/thumbnail/citations và manifest metadata/review nháp; không chứa credential, model, log hoặc media gốc. Có SHA để đối chiếu. Tạo lại cùng phiên bản dùng lại archive; nếu file bị sửa, app giữ file và báo lỗi thay vì coi là thành công. Các scope duyệt còn thiếu được giữ nguyên; xuất ZIP không cho quyền đăng. Xem/nghe, rà soát nguồn/quyền và metadata trước khi tự đăng ngoài app.

Planner đặt giờ/weekday/timezone, embargo/expiry và giới hạn sản xuất. Mô phỏng 7/14/30 ngày không tạo job hoặc cấp quyền đăng. Nguồn không mới hoặc không đủ điều kiện sẽ bị bỏ/dời, không tạo filler cho đủ số lượng.

Telegram: nhập bot token mã hóa, Chat IDs và User IDs được phép, chọn bật; thay token cần khởi động lại worker. Cả chat và user phải hợp lệ. Studio có preview đóng băng theo hash và xác nhận duyệt scoped; unknown user bị chặn. Chưa gửi bot thật trong nghiệm thu. Không có bảo đảm exactly-once ở nhà cung cấp khi mất response mạng.

Số liệu chỉ gắn với remote ID có thật. Adapter có views/likes/comments khi nền tảng cung cấp; giá trị thiếu là unknown, không tự suy ra doanh thu, wishlist, lượt mua hoặc Steam attribution. Những phần này còn cần account/quyền dữ liệu thực để nghiệm thu.

## Editor, nháp và so sánh mới

Mở **Biên tập**, chọn video/phiên bản ở trên. Cột trái chọn cảnh và seek preview; giữa là video; bên phải sửa lời đọc. Nội dung đang gõ lưu nháp trên thiết bị và khôi phục sau reload. **Đọc lại cảnh thành bản mới** mới tạo child và queue TTS; bản gốc giữ nguyên. Bản đã cắt hoặc lời nói gốc không cho viết lại tùy ý bằng TTS; nút nêu lý do và hướng về bản narration gốc.

Tab **Phụ đề & Sóng âm → Hiện waveform** đọc audio video hiện có ngay trong trình duyệt. Chọn cụm, nghe ranh giới, chỉnh đầu/cuối rồi **Lưu mốc thành phiên bản mới**. Chỉ phụ đề đổi; lời nói không được tạo lại. Waveform có giới hạn 64 MiB; nếu browser không decode được vẫn sửa số và nghe video bình thường.

Tab **So sánh phiên bản** chọn bản trước để xem hai video/thời lượng/đoạn lời thay đổi. Bật đồng bộ để seek cùng vị trí; chỉ video đang điều khiển phát tiếng. So sánh không cấp duyệt cho phiên bản mới. Tab **Chất lượng** có đo nhịp đọc, cảnh báo nội dung lặp và Repair Planner. Tab **Xuất & Đăng** mở gói thủ công và kiểm tra kênh/quyền.

## Media, preset và gợi ý

Trong **Thư viện → Mô tả và chọn media**, đặt tên dễ nhớ, mô tả ảnh/clip và khoảng scene rồi lưu. Metadata gắn hash, không đổi media gốc; matching kế hoạch mới dùng mô tả đã lưu. Có thể yêu cầu Qwen local gợi ý từ keyframe: luôn xem ảnh trước khi dùng làm nháp rồi lưu rõ ràng. Gợi ý AI có thể sai và không xác nhận quyền/claim.

**Autopilot bước 5** hoặc **Create bước Media/Voice** cho lưu/chọn bộ nhận diện: font, màu, scale/margin phụ đề, CTA, giọng theo ngôn ngữ và logo có khai báo quyền. Logo được copy/pin vào bản dựng; thay preset không ghi đè phiên bản cũ.

**Tổng quan → Việc tiếp theo** dẫn đến chỗ cần xử lý theo dữ liệu hiện có. **Hiệu quả** có kiểm tra trùng nội dung/nguồn và gợi ý kế hoạch khi đủ số liệu remote phù hợp; thiếu số liệu hiển thị unknown, không giả hiệu quả. Xem phạm vi và giới hạn tại [QUALITY_UX_IMPROVEMENTS.md](QUALITY_UX_IMPROVEMENTS.md).
