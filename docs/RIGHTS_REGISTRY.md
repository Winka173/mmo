# Sổ đăng ký quyền & nguồn gốc (SourceLicenseRegistry)

- Bản ghi hiện tại: `registry/rights/<assetKey>.json` — `assetKey` = SHA256 của file (hoặc `<projectId>/<assetId>` khi không có hash). Trường: chủ sở hữu, loại sở hữu, license ID + bằng chứng, thương mại, phái sinh, phân phối lại, nền tảng, ghi công, địa lý, hạn, trạng thái `ACTIVE | REVIEW | REVOKED | EXPIRED`.
- Chuỗi bất biến (append-only): `registry/provenance.jsonl` với các bước `source → rights_proof → asset → transformation → scene → publish` (+ `revoke`, `expire`). Đồng bộ lại không tạo bản ghi trùng (khóa sự kiện).
- Đồng bộ: sau mỗi lần dựng (`produce`) và hằng ngày (job `RIGHTS_AUDIT` 06:15).

## Thu hồi / hết hạn
`pnpm factory rights revoke <assetKey> <lý do>` hoặc tự động khi hết hạn:
1. Bản ghi → `REVOKED/EXPIRED`; mọi rights manifest phụ thuộc đánh dấu asset tương ứng ⇒ **rights gate chặn** lúc đăng.
2. Job PUBLISH đang chờ/đang giữ của các dự án đó ⇒ `failed` (hủy).
3. Bài đã đăng ⇒ cờ trong `projects/<id>/lifecycle.json` + Telegram: xem xét gỡ/sửa (chỉ làm qua API khi nền tảng hỗ trợ và bạn bật; mặc định là việc thủ công).

## Kiểm tra
`pnpm factory rights` (đồng bộ + audit + danh sách), `pnpm factory rights chain <assetKey>`, trang `/inspect/<projectId>` mục "Quyền & chuỗi nguồn gốc".

## Giới hạn
Registry không tự biết license bị chủ quyền rút ngoài đời — bạn phải gọi `revoke` (hoặc cập nhật hạn). Địa lý license chỉ có khi bạn khai báo.
