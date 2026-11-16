export const materialBucket = "training-materials";
export const maxPdfBytes = 20 * 1024 * 1024;

export function isOneDriveShareLink(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "1drv.ms" ||
      (url.hostname.endsWith(".sharepoint.com") && /^\/:[a-z]:\//i.test(url.pathname)) ||
      (url.hostname === "onedrive.live.com" && !url.pathname.startsWith("/download"));
  } catch { return false; }
}

export function validatePdfUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("請上傳 PDF 檔案，或填入有效的 PDF HTTPS 網址。"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("PDF 網址須使用 HTTPS。");
  if (isOneDriveShareLink(url.href)) throw new Error("這是 OneDrive 分享頁面，無法作為 PDF 檔案直接載入。請先下載 PDF，再使用「上傳 PDF」。");
  return url.href;
}

export function materialFilePath(content: string, projectUrl: string) {
  try {
    const url = new URL(content);
    const project = new URL(projectUrl);
    const prefix = `/storage/v1/object/authenticated/${materialBucket}/`;
    if (url.origin !== project.origin || !url.pathname.startsWith(prefix)) return null;
    const objectPath = decodeURIComponent(url.pathname.slice(prefix.length));
    return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(objectPath) ? objectPath : null;
  } catch { return null; }
}

export async function validatePdfFile(file: File) {
  if (!/\.pdf$/i.test(file.name)) throw new Error("請選擇 PDF 檔案。");
  if (file.size === 0 || file.size > maxPdfBytes) throw new Error("PDF 檔案大小須介於 1 位元組至 20 MB。");
  const header = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (header !== "%PDF-") throw new Error("檔案內容不是有效的 PDF，請重新匯出後上傳。");
}
