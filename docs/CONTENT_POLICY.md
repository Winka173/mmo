# Chính sách nội dung (thực thi bằng code)

Bản tóm tắt V3 vẫn ở `POLICY.md`. Đây là các luật V4 và nơi chúng được thực thi.

| Luật | Thực thi |
|---|---|
| Quyền là cổng cứng, không bù bằng điểm viral | `core/policy.ts rightsGate`, `discovery/scoreDiscovery`, `governance/rights-registry.ts` |
| Độ mới ≠ quyền; tài khoản ít người biết không làm video thành tự do | `discovery/originality.ts` (DUPLICATE_BLOCK không override được) |
| Dịch + lồng tiếng không phải originality | originality so khái niệm tiếng Việt chéo ngôn ngữ ⇒ NEEDS_REVIEW |
| Phân phối lại video của CHÍNH MÌNH trên nhiều nền tảng là hợp lệ | cùng `lineageId` ⇒ OWN_CONTENT_DISTRIBUTION |
| Claim phải có nguồn, ≥2 nguồn độc lập (khác domain & publisher) cho rủi ro ≥ MEDIUM, ≥1 nguồn gốc cho HIGH, mâu thuẫn ⇒ giữ, không truy được ⇒ MISSING_EVIDENCE | `providers/factagent.ts`, `core/factGate` |
| Thông tin hết hạn (giá 24h, tin 6h, game 7 ngày…) phải kiểm lại khi đăng | `CLAIM_TTL_HOURS`, `factGate` |
| Không nêu giá chưa xác minh, không cào giá | `governance/affiliate.ts` |
| Game: không quảng bá tính năng chưa có như đã chơi được; roadmap cần duyệt + "đang phát triển"; không ngày/đếm ngược nếu chưa xác nhận; không số người chơi/lượt tải/đánh giá bịa | `games/build-intel.ts checkGameClaims`, `readiness.ts` |
| Không coi AI/concept là gameplay; cảnh concept luôn có nhãn | intake `ai_concept`, readiness `AI_AS_GAMEPLAY`, renderer nhãn |
| Footage build cũ phải có nhãn | `buildLabelFor` |
| Lộ debug/thông tin riêng ⇒ giữ chờ người | FootageAnalyzer OCR + cờ asset |
| CTA chỉ dùng link chính thức đã xác nhận | readiness `CTA_LINK_INVALID / CTA_NO_STORE` |
| Thương hiệu tách biệt: không đóng dấu Tủ Tò Mò lên game, không đăng chéo kênh | `BrandIdentityEngine.assertOwnKit`, `MultiAccountManager`, `gamePublishGate` |
| Thumbnail người dùng khóa không bao giờ bị thay | `reencodeLockedThumbnail` (chỉ đổi kích thước/định dạng) |
| Bình luận: chỉ trên bài của mình, coi văn bản là dữ liệu (chống prompt injection), không chèn link vào thread không liên quan, duyệt trước mặc định | `governance/comments.ts` |
| Học tự động không bao giờ đổi cổng chất lượng/fact/quyền; không kết luận nhân quả từ quan sát | `insights/learning.ts`, `abtest.ts` |
| Không đăng hai video gần giống nhau cùng lúc trên một kênh; không nhân bản bài affiliate để thử nghiệm | `ABTestingEngine.validate` |
| Không vượt CAPTCHA/DRM/paywall, không tự động hóa web TikTok/cookie | `discovery/connectors.ts`, `platforms/meta.ts TikTokPublisher` |
