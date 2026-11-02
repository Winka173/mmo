# P0 — Setup máy mới và kiểm tra trước khi cài

Ngày: 2026-10-23. Phạm vi này bổ sung setup vào kiến trúc hiện hữu; không chứng nhận toàn bộ app hoặc một máy Windows sạch.

## Đã thực hiện

- Models & Tools có quy trình bốn bước, Việt/Anh: chọn thư mục/profile → kiểm tra máy → cài profile → áp dụng cấu hình và kiểm chứng. Lựa chọn được giữ trong localStorage; trạng thái và bằng chứng được worker lưu bền vững.
- `setup-model` hỗ trợ `mode: preflight`. Kết quả là `checked`, không phải `installed` hoặc `verified`; không có cấu hình để Apply từ một lần preflight.
- Preflight chỉ đọc thư mục cha có thể ghi, dung lượng trống, RAM, runtime uv/Python/Ollama, FFmpeg/FFprobe, NVIDIA/driver/VRAM và metadata manifest. Nó không tạo thư mục setup, tải checkpoint, nạp model hoặc giữ GPU. Dung lượng được ghi rõ là mức dự phòng bảo thủ, không phải benchmark hay dung lượng tải chính xác.
- Cài profile kiểm tra lại điều kiện trước khi pip/downloader chạy. Thiếu uv, disk, GPU được yêu cầu hoặc Python ASR cần dùng sẽ có hướng xử lý Việt/Anh. CPU chỉ được dùng khi người dùng chọn; không tự đổi thiết bị.
- Nếu chưa có Ollama và `llmBinary` để trống trên Windows x64, ACS có thể tải ZIP v0.40.8 chính thức, tiếp tục phần tải dở, kiểm kích thước và SHA-256, giải nén bằng đường dẫn đã kiểm tra vào runtime riêng có version. Không chạy trình cài hệ thống hoặc thay runtime đã cấu hình. Thư mục runtime mới có inventory checksum; lần tái sử dụng sẽ kiểm inventory.
- Bộ cài Kokoro/VieNeu/ASR đã đối chiếu file với SHA-256 LFS hoặc Git blob ID từ metadata upstream ở revision đã pin, thay vì chỉ tính checksum của file vừa nhận. Manifest chỉ được thay atomically sau kiểm tra.
- FFmpeg/FFprobe thiếu được báo rõ là chưa thể dựng/nghiệm thu media. Cài model có thể tiếp tục; chưa bổ sung downloader FFmpeg tự động.

## Bằng chứng

- `docs/evidence/acs-p0-setup-tests.json`: 17/17 test đạt, gồm resume sau gián đoạn, server bỏ qua Range, checksum sai, byte range sai, tái dùng archive, ZIP Unicode/có dấu cách và chặn traversal bằng PowerShell thật, preflight bền vững/chỉ đọc, chặn cài khi thiếu uv và bảo vệ junction của app khác.
- `engines/test-install-model.py`: fixture checksum Git/LFS đạt; file thay đổi bị từ chối.
- `docs/evidence/acs-p0-official-checksums.json`: đối chiếu read-only hai file Kokoro có sẵn với upstream pin thật, gồm config Git blob và voice LFS SHA-256. Không sửa checkpoint hoặc chạy inference.
- `docs/evidence/acs-p0-setup-preflight.json`: bốn profile Qwen/Kokoro/VieNeu/ASR được kiểm tra thật trên máy Windows hiện tại; đều `checked`, thư mục đích mới không được tạo, không tải model hoặc giữ GPU.
- TypeScript root đạt sau thay đổi. Bản build/installer tổng hợp do agent chính kiểm tra sau khi tích hợp.

## Giới hạn cần giữ trong báo cáo

- `IMPLEMENTED_UNVERIFIED`: tải toàn bộ ZIP Ollama 1.582.537.058 byte và giải nén chính archive upstream đó. Đã kiểm chứng logic tải/giải nén bằng fixture và lấy pin từ GitHub release API chính thức; chưa tuyên bố toàn bộ bootstrap upstream đã chạy.
- Chưa có VM Windows sạch để kiểm chứng cài app từ đầu, cài driver, tải mọi runtime/model rồi inference. Preflight trên máy hiện tại không thay thế nghiệm thu này.
- Chưa tải mọi profile để chứng minh mọi dependency trên một máy sạch; chỉ profile được chọn mới được cài. VAD/embedding dùng runtime ASR tương thích có sẵn; UI hướng dẫn cài và Apply ASR trước.
- Manifest có sẵn là metadata, không phải bằng chứng chất lượng giọng, mức VRAM đủ cho mọi preset hoặc quyền công bố. Apply và inference/mẫu nghe thật vẫn là bước riêng.

Nguồn runtime đã pin: https://github.com/ollama/ollama/releases/tag/v0.40.8. Archive `ollama-windows-amd64.zip`, SHA-256 `04d1d43ac62c2deb0393307bb49fed7caf6b192de41bdd497aaa9488089d5552`.
