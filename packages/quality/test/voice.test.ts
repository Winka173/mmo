import { describe, expect, it } from "vitest";
import { reviewNarration, VOICE_REVIEW_POLICY_VERSION } from "../src/voice.js";
describe("Narration round-trip evidence", () => {
  it("ignores punctuation/case while preserving Vietnamese diacritics", () => {
    expect(reviewNarration("Đây là bản gốc, đã lưu.", "đây là bản gốc đã lưu", "vi-VN", "Vietnamese").status).toBe("pass");
    expect(reviewNarration("The original remains available.", "THE ORIGINAL REMAINS AVAILABLE!", "en-GB", "English").status).toBe("pass");
    expect(reviewNarration("Đây là bản gốc đã lưu", "day la ban goc da luu", "vi-VN", "Vietnamese").status).toBe("fail");
  });
  it("flags truncated speech and a different detected language", () => {
    const result = reviewNarration("Ứng dụng giữ bản gốc và xuất video trên máy", "Ứng dụng giữ bản gốc", "vi-VN", "Vietnamese");
    expect(result.status).toBe("fail"); expect(result.wordErrorRate).toBeGreaterThan(0.4);
    expect(reviewNarration("Hello world", "Hello world", "en-US", "Chinese").status).toBe("fail");
  });
  it("leaves empty ASR evidence unknown", () => {
    expect(reviewNarration("Hello world", "", "en-US", "").status).toBe("unknown");
    expect(reviewNarration("Hello world", "", "en-US", "").policyVersion).toBe(VOICE_REVIEW_POLICY_VERSION);
    expect(reviewNarration("Hello world", "Hello world", "en-US", "English").policyVersion).toBe(VOICE_REVIEW_POLICY_VERSION);
  });
  it("never approves a changed number solely because aggregate WER is low",()=>{
    const expected="The updated game includes 12 levels and preserves all original gameplay features.";
    const review=reviewNarration(expected,expected.replace("12","13"),"en-US","English");
    expect(review.wordErrorRate).toBeLessThan(0.15);expect(review.status).toBe("fail");
    expect(review.numericEvidence?.status).toBe("mismatch");
    expect(reviewNarration("Version 2.5 remains available for all players.","Version 2,5 remains available for all players.","en-US","English").status).toBe("fail");
    const spelled="The updated game includes twelve levels and preserves all original gameplay features.";
    expect(reviewNarration(spelled,spelled.replace("twelve","thirteen"),"en-US","English").status).toBe("fail");
    const vietnamese="Bản cập nhật này có mười hai màn chơi và giữ nguyên tất cả tính năng gốc.";
    expect(reviewNarration(vietnamese,vietnamese.replace("hai","ba"),"vi-VN","Vietnamese").status).toBe("fail");
  });
  it("keeps number-word formatting changes unknown instead of claiming correct pronunciation",()=>{
    const review=reviewNarration("The game includes twelve levels and preserves the original gameplay features.","The game includes 12 levels and preserves the original gameplay features.","en-US","English");
    expect(review.wordErrorRate).toBeLessThan(0.15);expect(review.status).toBe("unknown");expect(review.numericEvidence?.status).toBe("format_review");
  });
  it("blocks dropped negation in both languages even when one token is under the WER limit",()=>{
    const english="This update does not change any of the original gameplay features or levels.";
    expect(reviewNarration(english,english.replace("not ",""),"en-US","English").status).toBe("fail");
    const vietnamese="Bản cập nhật này không thay đổi bất kỳ tính năng hay màn chơi gốc nào.";
    const review=reviewNarration(vietnamese,vietnamese.replace("không ",""),"vi-VN","Vietnamese");
    expect(review.wordErrorRate).toBeLessThan(0.15);expect(review.status).toBe("fail");expect(review.negationEvidence?.match).toBe(false);
    expect(reviewNarration("It cannot change the original file.","It can't change the original file.","en-US","English").negationEvidence?.match).toBe(true);
  });
});
