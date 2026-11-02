# Khôi phục dữ liệu và tự phục hồi tiến trình — 24/10/2026

Phạm vi: hai hạng mục chủ app chọn — khôi phục backup qua UI có kiểm tra/rollback và phục hồi worker/backend có retry giới hạn. Giữ nguyên file JSON/JSONL, Node/Next/Tauri; không thêm AI API hoặc sửa Asset Forge. Không commit/push.

## Khôi phục qua UI

1. Tạm dừng Production và chờ tất cả job đang chạy kết thúc.
2. Mở **Cài đặt & Chẩn đoán → Sao lưu & Khôi phục dữ liệu**. Chọn backup rồi **Kiểm tra checksum & đối chiếu**.
3. Xem số file thêm/ghi đè/không đổi, số metadata sẽ xóa và các đường dẫn ví dụ. Backup metadata không phục hồi media đã mất; nó giữ media hiện có. Backup có media thay phạm vi media trong bản sao.
4. Tích xác nhận phạm vi rồi **Khôi phục bản đã kiểm tra**. App Windows dừng web/worker cùng các tiến trình con thuộc chính app, chạy restore riêng rồi tự nối lại. Giữ app mở; khoảng mất kết nối UI trong lúc bảo trì là có chủ đích.
5. Kiểm tra kết quả, dự án, nguồn và quyền. Sản xuất/đăng bị khóa, Telegram và Autopilot tắt sau restore. Không tự bật lại các tác vụ công khai.
6. Nếu chưa có thay đổi mới, chọn xác nhận và **Hoàn tác khôi phục** để trả lại dữ liệu trước đó. Nếu file liên quan đã đổi sau restore, thao tác bị chặn để tránh ghi đè công việc mới.

UI restore chỉ chạy trong app Windows có supervisor sống và đúng DATA_DIR; web-only vẫn tạo/đối chiếu backup. Chỉ nhận backup có checksum đầy đủ, data version hiện tại và không chứa bundle credential mã hóa. Backup cũ cần công cụ/migration offline. Credential/model và media ngoài DATA_DIR không được khôi phục bởi luồng này.

## Cách giữ và phục hồi dữ liệu

- Preview gắn SHA manifest và fingerprint của dữ liệu hiện tại, gồm cả trường hợp nội dung thay đổi nhưng số file ghi đè không đổi. API kiểm tra lại khi yêu cầu; công cụ restore kiểm tra lần nữa sau khi web/worker dừng.
- Yêu cầu bảo trì lưu trong thư mục cấu hình native; API chặn các thao tác khác khi đã có yêu cầu. Native không tự khởi động lại dịch vụ khi bảo trì đang chạy.
- Công cụ restore giành `locks/worker.lock`. File/junction ngoài phạm vi bị từ chối; không xóa lock của owner còn sống.
- Tạo staged files và bản an toàn từng file tại `DATA_DIR/.restore/<transaction-id>/new` và `old`. Journal giữ SHA cũ/mới, phạm vi và phase; không thay dữ liệu trước khi staging/safety copy hoàn tất.
- Kiểm tra dung lượng trước, copy media qua đĩa thay vì gom video vào RAM; ghi file tạm, fsync rồi rename. JSON/JSONL được parse trước khi áp dụng; UI có giới hạn 64 MiB metadata mỗi file.
- Xác minh checksum sau ghi. Nếu lỗi giữa chừng, rollback từ bản an toàn. Nếu rollback cũng thất bại, giữ journal và chặn khởi động worker để chẩn đoán.
- Khi mở app sau ngắt/crash, helper xử lý journal **trước** khi web/worker hoặc DataStore.init chạy. Restore dang dở được rollback; bản đã commit không bị áp dụng lần nữa. Rollback sau crash tiếp tục được thực hiện từ journal.
- Undo có guard so SHA hiện tại với bản vừa commit. Khôi phục/hoàn tác giữ production/posting bị khóa; không tái cấp authorization.

## Tự phục hồi web/worker

- Tauri giám sát exit thật của hai tiến trình trực tiếp. Web và worker có Windows Job Object riêng; chỉ dọn process tree do app sở hữu, không tác động ứng dụng khác.
- Mỗi dịch vụ có tối đa **3 lần restart trong một phiên app**, chờ **2 / 5 / 10 giây**. Health web và PID giữ worker lock phải hợp lệ trước khi báo READY. Budget không được reset chỉ vì một lần khởi động lại thành công.
- Web dùng lại loopback port/token trong bộ nhớ để giữ phiên; UI reload sau reconnect. Worker tiếp tục dùng cơ chế checkpoint/queue recovery hiện có.
- Lần lỗi tiếp theo sau ba lần restart chuyển **RECOVERY_BLOCKED**, hiện chẩn đoán và giữ trạng thái trên đĩa; không retry vô hạn. Bộ đếm xuất hiện ở trạng thái worker.
- Heartbeat chậm hoặc process còn sống nhưng bận không tự bị kill/restart. Hỗ trợ này chưa phải watchdog cho mọi trường hợp treo/OOM/hỏng driver.
- Maintenance và Quit không tiêu thụ retry hay làm supervisor sinh lại worker. Đóng ẩn vẫn chạy nền theo preference; Quit dọn các tiến trình thuộc app.

## Bằng chứng và giới hạn

**303/303 test chọn lọc / 64 files PASS**, root/Next TypeScript và production build PASS. Batch Windows **24/10/2026 01:01:59 Asia/Saigon**, verifier **01:05:03**: portable/cài mới/native auth/wizard/close, restore/undo, bounded worker/web restart và live-owner failure PASS. Packaged-backend backup/quality-UX/shell browser regression PASS. Cài mới trong đường dẫn Unicode/có khoảng trắng; toàn bộ **9.858 file / 325.312.361 byte** tài nguyên khớp.

| Artifact | SHA-256 |
|---|---|
| `dist/windows/AUTONOMOUS CREATIVE STUDIO.exe` | `B470E39F5B874A402A0BE19F20C7B069220220C24B108EEF26DE64C53FE21DCA` |
| `dist/windows/AUTONOMOUS CREATIVE STUDIO_0.2.0_x64-setup.exe` | `364F1D03F14810412A5FB21324890BE7DB35ABF0D12F815A70C810266E58D62F` |
| Installed `.local/installed-smoke/Ứng dụng ACS-364f1d03/autonomous-creative-studio.exe` | `c0a3cc9aeafd36132b1f5aefab71bd8cac1cae3460e51ab863627d61b931e21d` |

Tree SHA `4cd2815489504e13082d1845715f662f525d31ce1de06fee286f3f041b7c5fa0`; installed/portable chỉ khác marker NSS/UNK của Tauri, các byte khác khớp. `build-report.json` = `VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE`. Restore/undo và fault tests chạy trên portable với dữ liệu cô lập; installed smoke kiểm tra native wizard/auth/close, toàn resource được so độc lập. Không inference lại model trong bộ cài.

- `acs-restore-recovery-tests.json`: summary bộ test chọn lọc; raw `.local/acs-restore-recovery-tests.json`.
- `acs-restore-crash.json`: ngắt process restore thật sau hai lần ghi, journal phase applying, trả lại marker/project và giữ paused. Không phải mất điện vật lý.
- `acs-restore-native.json`: WebView Windows thật, inspect/xác nhận/restore/undo, giữ media loại trừ và kiểm tra khóa sản xuất, VI/EN. Fixture riêng; không thay dữ liệu chủ app.
- `acs-worker-health-ui.json`: dừng worker và web thật của fixture, tự restart không cần mở lại app, giữ phiên/dữ liệu, kiểm tra hết budget sau ba lần.
- `acs-startup-failure.json`: owner đang sống vẫn giữ lock, không khởi động worker thứ hai.
- Bản cuối và hash đọc tại `dist/windows/build-report.json`. Không dùng evidence của EXE trước để nghiệm thu source mới.

Vẫn chưa nghiệm thu clean Windows VM, mất điện vật lý, hỏng ổ, mọi antivirus/network filesystem, process bị treo nhưng chưa exit hoặc mọi model crash. Backup/safety copy cùng ổ không bảo vệ khi ổ hỏng; cần sao chép backup sang thiết bị khác. Không inference AI, đăng bài hoặc gửi Telegram trong kiểm tra này.
