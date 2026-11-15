import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MAIL_MODE = "sink",
  MAIL_SINK_DIR = "./work/mail",
  RESEND_API_KEY,
  MAIL_FROM,
  PORTAL_URL,
} = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
  throw Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
if (MAIL_MODE !== "sink" && MAIL_MODE !== "resend")
  throw Error("MAIL_MODE must be sink or resend");
if (
  MAIL_MODE === "resend" &&
  (!RESEND_API_KEY ||
    !MAIL_FROM ||
    !PORTAL_URL ||
    process.env.ALLOW_REAL_MAIL !== "true")
)
  throw Error(
    "Real delivery requires RESEND_API_KEY, MAIL_FROM, PORTAL_URL and explicit ALLOW_REAL_MAIL=true",
  );
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function rpc(name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export function digestText(items, base) {
  return [...new Set(items.map((x) => x.department || "我的訓練"))]
    .map(
      (department) =>
        department +
        "\n" +
        items
          .filter((x) => (x.department || "我的訓練") === department)
          .map(
            (x) =>
              `${x.learner_name || ""} ${x.title}\n截止：${new Date(new Date(x.due).getTime() - 1).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}；有效學習 ${Math.floor(Number(x.seconds || 0) / 60)} 分鐘${x.days_overdue > 0 ? "；逾期 " + x.days_overdue + " 天" : ""}\n${base || ""}${x.entry || "#/training"}`,
          )
          .join("\n\n"),
    )
    .join("\n\n");
}
async function run() {
  for (let i = 0; i < 100; i++) {
    const o = await rpc("training_mail_claim");
    if (!o) break;
    try {
      const message = {
        to: [o.email],
        from: MAIL_FROM || "local@example.test",
        subject: "員工教育訓練每日彙整",
        text: digestText(o.body, PORTAL_URL),
      };
      if (MAIL_MODE === "sink") {
        await mkdir(MAIL_SINK_DIR, { recursive: true });
        await writeFile(
          `${MAIL_SINK_DIR}/${o.id}.json`,
          JSON.stringify(message, null, 2),
        );
      } else {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `training-${o.id}`,
          },
          body: JSON.stringify(message),
        });
        if (!response.ok)
          throw Error(
            `Email provider ${response.status}: ${await response.text()}`,
          );
      }
      await rpc("training_mail_ack", { p_id: o.id, p_error: null });
    } catch (e) {
      await rpc("training_mail_ack", { p_id: o.id, p_error: e.message });
      console.error("Email failed", o.id, e.message);
      break;
    }
  }
}
await run();
if (!process.argv.includes("--once"))
  setInterval(() => run().catch((e) => console.error(e.message)), 60000);
