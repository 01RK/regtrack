/**
 * 启动装配检查：用极简 DOM 桩在 Node 里跑一遍 core.js 的 boot()，
 * 确认请求头编码、/api/meta 与 /api/lookups 装配、操作人下拉填充都正常。
 *
 * 先启动服务：python codes/run.py --port 5099 --no-browser
 * 再执行：      node ../boot_check.mjs [端口]（在 regtrack 目录内）
 *
 * 这只覆盖启动路径，页面交互仍以浏览器为准。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "regtrack");
const PORT = process.argv[2] || "5099";
const BASE = `http://127.0.0.1:${PORT}`;

/* ------------------------------------------------ 极简 DOM / 浏览器桩 */
const store = new Map();
const el = (id) => ({
  id, innerHTML: "", value: "", onchange: null, dataset: {},
  classList: { add() {}, remove() {}, toggle() {} },
  appendChild() {}, remove() {}, addEventListener() {},
  querySelector: () => el("stub"), querySelectorAll: () => [],
});

globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  body: el("body"),
  getElementById: (id) => el(id),
  createElement: () => el("new"),
  querySelector: () => el("stub"),
  querySelectorAll: () => [],
  addEventListener() {},
  readyState: "complete",
};
globalThis.bootstrap = { Modal: class { show() {} hide() {} }, Toast: class { show() {} } };

// core.js 里的相对路径请求在 Node 里要补全成绝对地址
const rawFetch = globalThis.fetch;
globalThis.fetch = (url, opt) =>
  rawFetch(typeof url === "string" && url.startsWith("/") ? BASE + url : url, opt);

/* ------------------------------------------------------------ 执行 */
new Function(readFileSync(join(ROOT, "static/js/core.js"), "utf8"))();

const fails = [];
const check = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fails.push(label);
};

await new Promise((resolve) => {
  const origFail = App.fail;
  App.fail = (msg) => { fails.push(msg); console.log("✗ " + msg); };
  App.ready(() => {
    App.fail = origFail;
    check(!!App.meta && Array.isArray(App.meta.stages), "/api/meta 已装配，固定值可用");
    check(App.meta.stages.length === 9, "阶段固定值 9 项（含预研）");
    check(App.meta.stages[0].code === "PRE_RESEARCH", "首个阶段为 PRE_RESEARCH 预研");
    check(App.stageLabel("DRAFTING") === "起草", "阶段编码可翻译为显示名称");
    check(!!App.lookups && !!App.lookups.person, "/api/lookups 已装配");
    // 空库（首次启动）时人员字典还是空的，此时按「未署名」记账
    check(typeof App.user === "string", `当前操作人：${App.user || "未署名"}`);
    resolve();
  });
  setTimeout(() => { fails.push("boot 超时"); resolve(); }, 10000);
});

// 中文操作人经请求头往返后应原样还原
App.user = "张三";
const s = await App.post("/api/standards", {
  std_no: "GB/T 90001—2026", name_cn: "启动检查临时记录", stage_code: "PROJECT_APPROVAL",
  tc_wg: "TC999/SC9 启动检查",
});
check(s.created_by === "张三", `中文操作人写入还原：${s.created_by}`);
check(s.stage === "立项", `阶段编码按名称回显：${s.stage}`);

// 字典里没有的 TC/WG 应当随标准一起写入，而不是让保存失败
const tcwg = await App.get("/api/lookups/tc_wg");
check(tcwg.some((r) => r.value === "TC999/SC9 启动检查"), "新字典值随标准保存自动入库");

// 补录当前阶段之前的「预研」，并确认记录类型为历史补录
const back = await App.post(`/api/standards/${s.id}/stages`, {
  stage_code: "PRE_RESEARCH", effective_date: "2025-01-01", note: "启动检查补录",
});
check(back.record.record_type === "BACKFILL", "更早阶段记录为历史补录");
check(back.standard.stage_code === "PROJECT_APPROVAL", "补录不会改变当前阶段");

// 阶段记录不锁定：建档时写入的正常推进记录同样可以更正，
// 创建时间保持不变，最近修改时间与修改人另行记录。
const seeded = (await App.get(`/api/standards/${s.id}/stages`)).records
  .find((r) => r.record_type === "ADVANCE");
check(seeded.editable && !seeded.modified, "新阶段记录可修改且标记为未修改过");
const fixed = (await App.put(`/api/standards/${s.id}/stages/${seeded.id}`, {
  effective_date: "2025-06-30", note: "启动检查更正",
})).record;
check(fixed.effective_date === "2025-06-30", "正常推进的阶段记录可以更正日期");
check(fixed.created_at === seeded.created_at, "更正不改写创建时间");
check(fixed.modified && fixed.updated_by === "张三",
      `更正后记录最近修改人：${fixed.updated_by}`);

/* --------------------------------------------- 表单装配（不需要服务端） */
// 事项页的「新建 xx 事项」与会议行内派生都会锁死类型，此时 Item Type 只作
// 展示。表单必须仍把它提交上去，否则后端会报「Item Type 取值不合法」。
globalThis.CSS = { escape: (v) => v };
const fakeTs = (_el, opt = {}) => ({
  getValue: () => (opt.value === undefined || opt.value === null ? "" : opt.value),
  on() {}, focus() {}, reload() {},
});
globalThis.Fields = {
  destroyIn() {}, fixed: fakeTs, choices: fakeTs, lookup: fakeTs,
  standard: fakeTs, meeting: fakeTs, draft: fakeTs,
};
new Function(readFileSync(join(ROOT, "static/js/forms.js"), "utf8"))();
new Function(readFileSync(join(ROOT, "static/js/action-form.js"), "utf8"))();

for (const type of App.meta.action_types) {
  const values = { item_type: type, current_status: "Open", standard_id: 1 };
  const locked = { standard: "GB 38031—2025 电动汽车用动力蓄电池安全要求", standard_id: 1 };
  const payload = Forms.buildForm(
    document.getElementById("host"),
    ActionForm.spec(values, true, locked, true), values).read();
  check(payload.item_type === type, `类型锁定时仍提交 Item Type：${type}`);
  check(payload.standard_id === 1, `类型锁定时仍提交关联标准：${type}`);
}

// 未锁定类型时由下拉控件提供取值，同样不能丢
const free = Forms.buildForm(
  document.getElementById("host"),
  ActionForm.spec({ item_type: "Others" }, true, null, false),
  { item_type: "Others", current_status: "Open" }).read();
check(free.item_type === "Others", "类型可选时从下拉取值提交 Item Type");

/* ------------------------------------------- 登记概览的两块清单与筛选 */
// 总览默认只看当前操作人手上的事：不传 person 就按当前操作人过滤，
// 显式传空串才是「不限」。
const meeting = await App.post("/api/meetings", {
  title: "启动检查例会", meeting_date: App.today(), meeting_type: "内部例会",
  participants: "张三、李四", standard_ids: [s.id],
});
const board = await App.get("/api/dashboard");
check(board.by_stage.length === 9, `阶段分布输出九项：${board.by_stage.length}`);
check(board.by_risk === undefined, "风险等级统计已移除");
check(board.meetings.person === "张三", `会议清单默认按当前操作人过滤：${board.meetings.person}`);
check(board.meetings.from === `${new Date().getFullYear()}-01-01`,
      `会议默认从今年 1 月 1 日起：${board.meetings.from}`);
check(board.meetings.to === App.today(), `会议默认截至今天：${board.meetings.to}`);
check(board.meetings.items.some((m) => m.id === meeting.id), "登记人本人参加的会议在清单里");
check(board.due_actions.person === "张三", "在办事项默认按当前操作人过滤");
check(board.people.includes("张三"), "筛选下拉的候选里有当前操作人");

const others = await App.get(`/api/dashboard/meetings?person=${encodeURIComponent("查无此人")}`);
check(others.total === 0, "换成无关的人时清单为空");
check((await App.get("/api/dashboard/meetings?person=")).total >= 1, "选「不限」时能看到全部会议");
const older = await App.get("/api/dashboard/meetings?person=&from=2000-01-01&to=2000-12-31");
check(older.total === 0, "时间范围之外的会议不出现");
await App.del(`/api/meetings/${meeting.id}`);

/* ------------------------------------------------- 粘贴文本的清洗 */
// Word 公式里的 ≤ 其实是 Symbol 字体的私用区码位，落单的代理项则根本编不成 UTF-8。
const pasted = await App.put(`/api/standards/${s.id}`, {
  scope: "\uf068 \uf0a3 3\u2030 \ud83d\u0000",
});
check(pasted.scope === "η ≤ 3‰", `符号字体还原、存不下的字符剔除：${JSON.stringify(pasted.scope)}`);

/* --------------------------------------- 会议涉及标准的批注（桥表 note） */
// 一场会讨论多项标准时，每项的议论分开记；批注属于这条挂载关系，
// 取消挂载会连带删掉，所以后端要求先确认。
const noteMeeting = await App.post("/api/meetings", {
  title: "批注检查会", meeting_date: App.today(), meeting_type: "内部例会",
  standard_ids: [s.id],
});
let links = await App.put(`/api/meetings/${noteMeeting.id}/standards/${s.id}`,
                          { note: "  本会重点：过渡期  " });
check(links[0].note === "本会重点：过渡期", `批注已保存：${links[0].note}`);
let refused = null;
try {
  await App.del(`/api/meetings/${noteMeeting.id}/standards/${s.id}`);
} catch (e) { refused = e; }
check(refused !== null && /Note 也将丢失/.test(refused.message),
      "取消挂载带批注的标准时先给出提醒");
check((await App.get(`/api/meetings/${noteMeeting.id}`)).standards.length === 1,
      "未确认前批注与挂载都还在");
links = await App.del(`/api/meetings/${noteMeeting.id}/standards/${s.id}?drop_notes=1`);
check(links.length === 0, "确认后才真的取消挂载");
await App.del(`/api/meetings/${noteMeeting.id}`);

/* ------------------------------------------------- 数据交换的导入 */
// 旧做法保留原 id 后 INSERT OR IGNORE，id 一撞记录就被静默忽略：
// 报「导入 N 条」，界面上却什么也看不到。这里走一遍完整的导出 → 预检 → 导入。
// 先登记一条没有自然键的记录（事项），它在导入方应当作为新记录出现
await App.post("/api/actions", {
  item_type: "Others", standard_id: s.id, title: "启动检查事项",
  description: "导入后应当以新记录出现", current_status: "Open", coordinator: "张三",
});
const pkg = await (await fetch(`${BASE}/api/transfer/export?user=${encodeURIComponent("张三")}`,
                               { headers: { "X-User": encodeURIComponent("张三") } })).text();

async function sendPackage(path, fields = {}) {
  const form = new FormData();
  form.append("file", new Blob([pkg], { type: "application/json" }), "package.json");
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  const res = await fetch(BASE + path, {
    method: "POST", body: form, headers: { "X-User": encodeURIComponent("张三") },
  });
  return { status: res.status, body: await res.json() };
}

const preview = await sendPackage("/api/transfer/inspect");
check(preview.body.user === "张三", `预检读出数据包登记人：${preview.body.user}`);
check(preview.body.total > 0, `预检数出记录数：${preview.body.total}`);
check((await sendPackage("/api/transfer/import")).status === 400, "未确认登记人时拒绝导入");

const before = (await App.get("/api/standards?page_size=100")).total;
const done = await sendPackage("/api/transfer/import", { as_user: "Wang, Xuesong" });
check(done.status === 200, `导入返回 ${done.status}`);
check(done.body.merged > 0, `本机已有的记录按唯一约束合并：${done.body.merged} 条`);
const list = await App.get("/api/standards?page_size=100");
check(list.total === before, "合并不会把同一项标准变成两条");
// 标准按编号合并了，事项没有自然键则作为新记录进来，记在确认过的操作人名下
const imported = (await App.get("/api/actions?page_size=50")).items
  .filter((a) => a.created_by === "Wang, Xuesong");
check(imported.length === 1, `导入的事项以新记录出现：${imported.length} 条`);
check(imported[0] && imported[0].std_no === s.std_no, "新记录挂在本机已有的那条标准上");
check((await App.get("/api/lookups/person")).some((p) => p.value === "Wang, Xuesong"),
      "确认的操作人自动进入人员字典");

// 删除已调整为归档：记录仍在库里，只是不出现在正常列表
await App.del(`/api/standards/${s.id}`);
const archived = await App.get(`/api/standards/${s.id}`);
check(!!archived.archived_at, "删除操作实际执行的是归档");

console.log(fails.length ? `\n失败 ${fails.length} 项` : "\n全部通过");
process.exit(fails.length ? 1 : 0);
