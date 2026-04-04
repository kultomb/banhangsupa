/**
 * SePay / ngân hàng VN thường gửi số tiền dạng "99.000" (dấu chấm phân cách nghìn).
 * Number("99.000") === 99 — sai; cần chuẩn hóa trước khi so khớp với PAYMENT_AMOUNT.
 */
export function parseIncomingTransferAmount(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.round(v);
  }
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const noSpaces = raw.replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+$/.test(noSpaces)) {
    const n = Number(noSpaces.replace(/\./g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(noSpaces.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
