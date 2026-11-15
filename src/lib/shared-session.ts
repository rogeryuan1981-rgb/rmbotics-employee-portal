import { useEffect } from "react";
import { getSessionMode, supabase } from "./supabase";
const activityKey = "employee-portal-last-activity";
export function markSharedActivity() {
  if (document.visibilityState === "visible" && document.hasFocus())
    localStorage.setItem(activityKey, String(Date.now()));
}
export function useSharedSession(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    if (!localStorage.getItem(activityKey)) markSharedActivity();
    const onActivity = (event: Event) => {
      const el = event.target instanceof Element ? event.target : null;
      if (
        (event.type === "pointerdown" ||
          event.type === "touchstart" ||
          (event.type === "keydown" &&
            (event as KeyboardEvent).key === "Enter")) &&
        el?.closest('a[href^="#/"]')
      )
        return;
      markSharedActivity();
    };
    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }),
    );
    const check = () => {
      if (
        getSessionMode() === "shared" &&
        Date.now() - Number(localStorage.getItem(activityKey) || 0) >=
          30 * 60 * 1000
      )
        void supabase.auth.signOut({ scope: "local" });
    };
    const timer = window.setInterval(check, 5000);
    check();
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [userId]);
}
