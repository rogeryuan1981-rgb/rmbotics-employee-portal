import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
export const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

const sessionModeKey = "snack-vote-session-mode";
export type SessionMode = "personal" | "shared";
export function getSessionMode(): SessionMode {
  return localStorage.getItem(sessionModeKey) === "shared"
    ? "shared"
    : "personal";
}
export function setSessionMode(mode: SessionMode) {
  localStorage.setItem(sessionModeKey, mode);
}
// Shared mode stays in sessionStorage, with a same-origin tab bridge for SSO.
// Tokens are never copied into localStorage in shared mode.
const bridge =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("employee-portal-storage")
    : null;
bridge?.addEventListener("message", (event) => {
  const { type, key, value, requestId } = event.data;
  if (typeof key !== "string" || !key.startsWith("sb-")) return;
  if (type === "get") {
    const value = sessionStorage.getItem(key);
    if (value) bridge.postMessage({ type: "reply", key, value, requestId });
  }
  if (type === "set" && getSessionMode() === "shared") {
    localStorage.removeItem(key);
    sessionStorage.setItem(key, value);
  }
  if (type === "remove") {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
});
const browserAuthStorage = {
  async getItem(key: string) {
    if (getSessionMode() !== "shared") return localStorage.getItem(key);
    const existing = sessionStorage.getItem(key);
    if (existing || !bridge) return existing;
    return new Promise<string | null>((resolve) => {
      const requestId = crypto.randomUUID();
      const handle = (event: MessageEvent) => {
        if (event.data.type === "reply" && event.data.requestId === requestId) {
          clearTimeout(timer);
          bridge.removeEventListener("message", handle);
          sessionStorage.setItem(key, event.data.value);
          resolve(event.data.value);
        }
      };
      const timer = setTimeout(() => {
        bridge.removeEventListener("message", handle);
        resolve(null);
      }, 300);
      bridge.addEventListener("message", handle);
      bridge.postMessage({ type: "get", key, requestId });
    });
  },
  setItem(key: string, value: string) {
    if (getSessionMode() === "shared") {
      localStorage.removeItem(key);
      sessionStorage.setItem(key, value);
      bridge?.postMessage({ type: "set", key, value });
    } else {
      sessionStorage.removeItem(key);
      localStorage.setItem(key, value);
    }
  },
  removeItem(key: string) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    localStorage.removeItem("employee-portal-last-activity");
    bridge?.postMessage({ type: "remove", key });
  },
};

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseKey || "placeholder",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: browserAuthStorage,
    },
  },
);
