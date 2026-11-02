"use client";
import type {Autopilot} from "@ttm/automation";

export function ProductSettingsFields({draft,en,update}:{draft:Partial<Autopilot>;en:boolean;update:(patch:Partial<Autopilot>)=>void}){
  if(draft.family!=="product")return null;
  const t=(vi:string,english:string)=>en?english:vi;
  const value=draft.productSettings??{affiliateEnabled:false,affiliateUrl:"",affiliateDisclosure:"",maxPriceAgeHours:24};
  const change=(patch:Partial<typeof value>)=>update({productSettings:{...value,...patch}});
  return <section className="acs-panel">
    <h3>{t("Sản phẩm và tiếp thị liên kết","Product and affiliate settings")}</h3>
    <p>{t("Chọn URL HTTPS công khai của một sản phẩm ở trên. Hiện hỗ trợ trang có một sản phẩm JSON-LD rõ ràng; chưa tự tìm sản phẩm trên sàn. Chỉ tổng hợp nguồn, không giả trải nghiệm thử sản phẩm.","Select one trusted public HTTPS product URL above. Supports a page with one identifiable JSON-LD product; marketplace discovery is not available. Drafts describe sourced information without claiming firsthand testing.")}</p>
    <label className="acs-field">{t("Thời hạn thông tin giá (giờ)","Maximum price information age (hours)")}
      <input type="number" min={1} max={168} value={value.maxPriceAgeHours} onChange={event=>change({maxPriceAgeHours:Number(event.target.value)})}/>
    </label>
    <label className="acs-check"><input type="checkbox" checked={value.affiliateEnabled} onChange={event=>change({affiliateEnabled:event.target.checked})}/>{t("Có liên kết tiếp thị đã được cấp quyền","Use an authorized affiliate link")}</label>
    {value.affiliateEnabled&&<>
      <label className="acs-field">{t("URL tiếp thị liên kết HTTPS","Affiliate HTTPS URL")}<input type="url" placeholder="https://" value={value.affiliateUrl} onChange={event=>change({affiliateUrl:event.target.value})}/></label>
      <label className="acs-field">{t("Công bố đọc trong video và ghi trong mô tả","Disclosure spoken in video and included in description")}<textarea value={value.affiliateDisclosure} placeholder={t("Tôi có thể nhận hoa hồng khi bạn mua qua liên kết tiếp thị này.","I may earn a commission if you buy through this affiliate link.")} onChange={event=>change({affiliateDisclosure:event.target.value})}/></label>
      <p>{t("Bạn tự cung cấp URL và quyền chương trình đối tác. Hệ thống không đăng ký chương trình, không mua hàng; mô tả xuất bản phải giữ URL và công bố này.","Supply the partner URL and program authorization yourself. The app does not enroll in programs or make purchases. The publication description must retain this URL and disclosure.")}</p>
    </>}
    <p>{t("Giá, thông số, nguồn và đích liên kết được kiểm tra lại ngay trước khi đăng. Thay đổi hoặc quá hạn sẽ chặn phiên bản đã duyệt; cần tạo bản nháp mới và duyệt lại. Quyền nội dung và kiểm tra sự thật vẫn bắt buộc.","Prices, specifications, sources and link destinations are checked again immediately before upload. Changed or expired evidence blocks the approved version and requires a new draft and review. Rights and factual review remain required.")}</p>
  </section>;
}
