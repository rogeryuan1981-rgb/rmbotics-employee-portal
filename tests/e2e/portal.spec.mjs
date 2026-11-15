import { test, expect } from "@playwright/test";
test.describe.configure({ mode: "serial" });
const courseName = "瀏覽器驗證課程 " + Date.now();
async function login(
  page,
  request,
  email = "learner@example.test",
  shared = false,
) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  if (shared) await page.getByRole("switch", { name: /共用電腦/ }).click();
  await page.getByRole("button", { name: "寄送登入信", exact: true }).click();
  await page
    .getByRole("button", { name: "確認並寄送登入信", exact: true })
    .click();
  await expect(page.getByLabel("登入驗證碼")).toBeVisible();
  const inbox = await (
    await request.get("http://127.0.0.1:4174/local/inbox")
  ).json();
  const code = inbox.find((x) => x.email === email && x.code)?.code;
  await page.getByLabel("登入驗證碼").fill(code);
  await page.getByRole("button", { name: "驗證並登入", exact: true }).click();
  await expect(page.getByRole("heading", { name: /歡迎回來/ })).toBeVisible();
}
test("A01/B16 single OTP across training/snack and tabs, logout synchronizes", async ({
  page,
  context,
  request,
}) => {
  await login(page, request);
  await page.getByRole("link", { name: /教育訓練.*進入系統/ }).click();
  await expect(
    page.getByRole("heading", { name: "我的學習", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回員工入口", exact: true }).click();
  await page.getByRole("link", { name: /零食投票.*進入系統/ }).click();
  await expect(page.getByRole("link", { name: "本期活動" })).toBeVisible();
  const other = await context.newPage();
  await other.goto("/#/training");
  await expect(
    other.getByRole("heading", { name: "我的學習", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(other.getByLabel("Email", { exact: true })).toBeVisible();
});
test("B16 shared mode new tab SSO stays out of localStorage", async ({
  page,
  context,
  request,
}) => {
  await login(page, request, "learner@example.test", true);
  const other = await context.newPage();
  await other.goto("/#/training");
  await expect(
    other.getByRole("heading", { name: "我的學習", exact: true }),
  ).toBeVisible();
  const tokens = await other.evaluate(() =>
    Object.entries(localStorage).filter(([k]) => k.startsWith("sb-")),
  );
  expect(tokens).toEqual([]);
  await other.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});
test("admin creates and publishes a course, assigns it and exports real XLSX", async ({
  page,
  request,
}) => {
  await login(page, request, "admin@example.test");
  await page.getByRole("link", { name: "訓練後台", exact: true }).click();
  await page.getByRole("button", { name: "課程與題庫", exact: true }).click();
  await page.getByRole("button", { name: "新增課程", exact: true }).click();
  const editor = page.locator("section").filter({
    has: page.getByRole("heading", { name: "新增課程", exact: true }),
  });
  await editor.getByLabel("課程名稱", { exact: true }).fill(courseName);
  await editor.getByLabel("總學習分鐘數").fill("0.1");
  await editor.getByRole("button", { name: "新增教材", exact: true }).click();
  await editor.getByLabel("教材名稱", { exact: true }).fill("操作說明");
  await editor
    .getByLabel("教材內容", { exact: true })
    .fill("請閱讀本文後完成測驗。");
  await editor.getByRole("button", { name: "新增題目", exact: true }).click();
  await editor.getByLabel("題幹", { exact: true }).fill("是否已閱讀操作說明？");
  await editor.getByLabel("第 1 題選項 1").fill("是");
  await editor.getByLabel("第 1 題選項 2").fill("否");
  await editor.getByLabel("發布摘要", { exact: true }).fill("瀏覽器測試");
  await editor
    .getByRole("button", { name: "發布／僅更新內容", exact: true })
    .click();
  await expect(editor.getByRole("status")).toContainText("已發布");
  await page.getByRole("button", { name: "指派與期限", exact: true }).click();
  const assignment = page.locator("section").filter({
    has: page.getByRole("heading", { name: "個別指派訓練", exact: true }),
  });
  await assignment
    .getByRole("combobox", { name: "員工", exact: true })
    .selectOption({ label: "測試學員" });
  await assignment
    .getByRole("combobox", { name: "課程", exact: true })
    .selectOption({ label: courseName });
  await assignment
    .getByRole("button", { name: "指派訓練", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: new RegExp("測試學員.*" + courseName) }),
  ).toBeVisible();
  await page.getByRole("button", { name: "報表", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出訓練總表", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("訓練總表.xlsx");
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const Excel = (await import("exceljs")).default;
  const wb = new Excel.Workbook();
  await wb.xlsx.load(Buffer.concat(chunks));
  expect(wb.worksheets[0].rowCount).toBeGreaterThan(1);
  expect(wb.worksheets[0].getRow(1).values).toContain("原期限（翌日零時前）");
});
test("real learning heartbeat, auto-save answer, submit and persisted completion", async ({
  page,
  request,
}) => {
  await login(page, request);
  await page.goto("/#/training");
  await page
    .locator(".course-card")
    .filter({
      has: page.getByRole("heading", { name: courseName, exact: true }),
    })
    .getByRole("link")
    .click();
  await expect(
    page.getByRole("button", { name: "開始測驗", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "開始／接續計時", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "開始測驗", exact: true }),
  ).toBeEnabled({ timeout: 35000 });
  await page.getByRole("button", { name: "開始測驗", exact: true }).click();
  await page.getByLabel("是", { exact: true }).check();
  await expect(page.getByRole("status")).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "交卷", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /本次 100.00 分 · 及格/ }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(/完成時間：/)).toBeVisible();
});
test("mobile portal and learner permissions", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, request);
  await expect(
    page.getByRole("link", { name: "訓練後台", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/#/training/admin");
  await expect(
    page.getByRole("heading", { name: "無教育訓練管理權限" }),
  ).toBeVisible();
});
function pdfFixture() {
  const text = "BT /F1 14 Tf 20 150 Td (Local training PDF fixture) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let result = "%PDF-1.4\n",
    offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result);
  result +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(result);
}
test("PDF.js renders a PDF fixture and reports load failures without counting", async ({
  page,
  request,
}) => {
  await login(page, request, "admin@example.test");
  const token = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([k]) => k.startsWith("sb-"))
      .map(([, v]) => {
        try {
          return JSON.parse(v).access_token;
        } catch {
          return null;
        }
      })
      .find(Boolean),
  );
  const rpc = async (action, p) => {
    const response = await request.post(
      "http://127.0.0.1:4174/rest/v1/rpc/portal_rpc",
      { headers: { Authorization: "Bearer " + token }, data: { action, p } },
    );
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const content = {
    title: "PDF 實際繪製驗證",
    seconds: 60,
    pass_score: 80,
    question_count: 1,
    minutes: 0,
    cycle: "once",
    departments: [],
    start: "",
    end: "",
    materials: [
      {
        id: "pdf",
        title: "PDF 範例",
        kind: "pdf",
        content: "https://training.example.test/material.pdf",
      },
      {
        id: "broken",
        title: "異常 PDF",
        kind: "pdf",
        content: "https://training.example.test/broken.pdf",
      },
    ],
    questions: [
      {
        id: "q",
        kind: "single",
        prompt: "範例",
        options: ["是", "否"],
        correct: [0],
        explanation: "範例",
        material_id: "pdf",
      },
    ],
  };
  const c = await rpc("course_save", { content });
  await rpc("course_publish", { id: c.id, summary: "PDF 瀏覽器驗證" });
  const r = await rpc("assign", {
    employee_id: "30000000-0000-0000-0000-000000000001",
    course_id: c.id,
    key: courseName,
    deadline: { mode: "assigned", days: 30 },
  });
  await page.route("https://training.example.test/material.pdf", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: pdfFixture(),
    }),
  );
  await page.route("https://training.example.test/broken.pdf", (route) =>
    route.fulfill({
      status: 404,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: "missing",
    }),
  );
  await page.goto("/#/training/" + r.id);
  await expect(page.locator(".pdf-material")).toBeVisible();
  await expect
    .poll(() => page.locator(".pdf-material").evaluate((el) => el.width))
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "異常 PDF PDF 文件", exact: true })
    .click();
  await expect(page.getByText(/PDF 無法載入/)).toBeVisible();
  await page.getByRole("button", { name: "開始／接續計時" }).click();
  await expect(
    page.getByText("已暫停：背景、未載入、影片未播放或文字閒置", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await rpc("requirement", { id: r.id })).requirement.seconds).toBe(0);
});
test("shared idle logout survives switching modules", async ({
  page,
  request,
}) => {
  await login(page, request, "learner@example.test", true);
  await page.evaluate(() => {
    localStorage.setItem(
      "employee-portal-last-activity",
      String(Date.now() - 31 * 60 * 1000),
    );
    location.hash = "#/training";
  });
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible({
    timeout: 10000,
  });
});
test("HR imports XLSX through preview, rejects one bad row, then commits the whole valid batch", async ({
  page,
  request,
}) => {
  await login(page, request, "hr@example.test");
  await page.getByRole("link", { name: "訓練後台", exact: true }).click();
  await page.getByRole("button", { name: "員工名冊", exact: true }).click();
  const panel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Excel 整批匯入", exact: true }),
  });
  const Excel = (await import("exceljs")).default;
  const email = "import-" + Date.now() + "@example.test";
  async function upload(valid) {
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet("名冊");
    ws.addRow(["姓名", "Email", "部門"]);
    ws.addRow(["匯入學員", email, "行政部"]);
    ws.addRow(["第二學員", valid ? "second-" + email : "invalid", "行政部"]);
    await panel.getByLabel("選擇 .xlsx 檔", { exact: true }).setInputFiles({
      name: "名冊.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    });
  }
  await upload(false);
  await expect(
    panel.getByText("2 筆；1 筆錯誤", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "確認整批匯入" }),
  ).toBeDisabled();
  await upload(true);
  await expect(
    panel.getByText("2 筆；0 筆錯誤", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "確認整批匯入" }).click();
  await expect(panel.getByRole("status")).toContainText(
    "整批匯入完成，共 2 筆",
  );
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await login(page, request, email);
  await expect(
    page.getByText("目前尚未開通系統使用資格，請洽管理員。"),
  ).toBeVisible();
});
