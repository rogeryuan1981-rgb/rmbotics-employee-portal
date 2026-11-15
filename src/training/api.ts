import { supabase } from "../lib/supabase";
export class PortalApiError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
export async function api<T>(action: string, p: object = {}): Promise<T> {
  const { data, error } = await supabase.rpc("portal_rpc", { action, p });
  if (error) throw new PortalApiError(error.message, error.code);
  return data as T;
}
export function dateTime(s: string | null | undefined) {
  return s
    ? new Date(s).toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
        hour12: false,
      })
    : "—";
}
export function deadlineLabel(s: string) {
  return dateTime(new Date(new Date(s).getTime() - 1).toISOString());
}
export function duration(s: number) {
  return `${(Number(s) / 60).toFixed(1)} 分鐘`;
}
export function youtubeId(input: string) {
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") throw new Error();
    const host = u.hostname.replace(/^www\./, "");
    const id =
      host === "youtu.be"
        ? u.pathname.slice(1).split("/")[0]
        : ["youtube.com", "m.youtube.com"].includes(host)
          ? u.pathname === "/watch"
            ? u.searchParams.get("v")
            : u.pathname.split("/")[2]
          : null;
    if (id && /^[\w-]{11}$/.test(id)) return id;
  } catch {
    /* Validation message below. */
  }
  throw new Error("請填有效的 YouTube HTTPS 影片網址或 11 碼影片識別碼");
}
