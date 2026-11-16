const importColumns = [
  ["name", "姓名"],
  ["email", "Email"],
  ["hire_date", "到職日"],
  ["department", "部門"],
  ["job", "職務"],
  ["tenure_date", "接任日"],
  ["active", "啟用狀態"],
  ["systems", "系統資格"],
] as const;
async function library() {
  return (await import("exceljs")).default;
}
async function download(
  workbook: InstanceType<Awaited<ReturnType<typeof library>>["Workbook"]>,
  name: string,
) {
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function importTemplate() {
  const Excel = await library();
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet("員工名冊");
  ws.columns = importColumns
    .filter(([key]) => key !== "job" && key !== "tenure_date")
    .map(([key, header]) => ({
    key,
    header,
    width: 24,
    }));
  ws.addRow({
    name: "範例員工（請刪除此列）",
    email: "sample@example.test",
    hire_date: "2026-01-01",
    department: "請填既有部門名稱",
    active: "true",
    systems: "training",
  });
  ws.getRow(1).font = { bold: true };
  await download(wb, "人員與登入匯入範本.xlsx");
}
export async function readImport(file: File) {
  const Excel = await library();
  const wb = new Excel.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("找不到工作表");
  const headers = new Map<number, string>();
  ws.getRow(1).eachCell((cell, n) => {
    const found = importColumns.find(
      ([key, label]) => cell.text.trim() === label || cell.text.trim() === key,
    );
    if (found) headers.set(n, found[0]);
  });
  if (![...headers.values()].includes("email"))
    throw new Error("缺少 Email 欄");
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const v: Record<string, string> = {};
    headers.forEach((key, col) => {
      const cell = row.getCell(col);
      v[key] =
        cell.value instanceof Date
          ? cell.value.toISOString().slice(0, 10)
          : cell.text.trim();
    });
    if (Object.values(v).some(Boolean)) rows.push(v);
  });
  if (rows.length > 2000) throw new Error("每批最多 2,000 筆，請分批匯入");
  return rows;
}
const labels: Record<string, string> = {
  id: "紀錄識別碼",
  employee_id: "員工識別碼",
  name: "姓名",
  email: "Email",
  department_id: "部門識別碼",
  course_id: "課程識別碼",
  title: "課程名稱",
  cycle: "義務年度",
  batch: "訓練批次",
  course_version: "版本",
  seconds: "有效學習秒數",
  original_due: "原期限（翌日零時前）",
  due: "適用期限（翌日零時前）",
  completed_at: "完成時間",
  completed_due: "完成判定期限",
  lifecycle: "列管狀態",
  ever_overdue: "曾逾期",
  cancellation_reason: "取消原因",
  sources: "指派來源",
  rules: "規則快照",
  requirement_id: "訓練要求識別碼",
  started_at: "開始時間",
  expires_at: "測驗到期時間",
  submitted_at: "交卷時間",
  correct: "答對題數",
  total: "總題數",
  passed: "是否及格",
  score: "分數",
  old_due: "調整前期限",
  new_due: "調整後期限",
  reason: "原因",
  actor: "操作人",
  at: "操作時間",
  answers: "作答",
  pass_score: "及格門檻",
};
export async function exportWorkbook(
  rows: Record<string, unknown>[],
  name: string,
) {
  const Excel = await library();
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet("報表");
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const extra =
    name === "訓練總表"
      ? ["要求學習秒數", "完成狀態", "作答時長秒數"]
      : name === "歷次測驗"
        ? ["作答時長秒數"]
        : [];
  ws.columns = [
    ...keys.map((key) => ({ key, header: labels[key] || key, width: 24 })),
    ...extra.map((key) => ({ key, header: key, width: 24 })),
  ];
  for (const row of rows) {
    const r: Record<string, unknown> = {};
    for (const key of keys) {
      const v = row[key];
      r[key] =
        v === null
          ? ""
          : typeof v === "object"
            ? JSON.stringify(v)
            : typeof v === "string" && /T\d\d:\d\d:/.test(v)
              ? new Date(v).toLocaleString("zh-TW", {
                  timeZone: "Asia/Taipei",
                  hour12: false,
                })
              : v;
    }
    const rules = row.rules as { seconds?: number } | undefined;
    r["要求學習秒數"] = rules?.seconds ?? "";
    r["完成狀態"] = row.completed_at
      ? new Date(String(row.completed_at)) >=
        new Date(String(row.completed_due || row.due))
        ? "逾期完成"
        : "準時完成"
      : row.lifecycle === "cancelled"
        ? "已取消列管"
        : row.lifecycle === "exempt"
          ? "當年度免修"
          : Date.now() >= new Date(String(row.due)).getTime()
            ? "逾期未完成"
            : "未完成";
    r["作答時長秒數"] =
      row.submitted_at && row.started_at
        ? Math.round(
            (new Date(String(row.submitted_at)).getTime() -
              new Date(String(row.started_at)).getTime()) /
              1000,
          )
        : "";
    ws.addRow(r);
  }
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF284C46" },
  };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: Math.max(1, keys.length) },
  };
  await download(wb, `${name}.xlsx`);
}
