"""按登记人交换数据。

导出包是自包含 JSON。导入分两步：先 `/inspect` 预检，让用户确认这批数据
记到哪位操作人名下，再 `/import` 真正写入——写入时重新编号并按唯一约束合并，
详见下面「导入」一节的说明。
"""

import io
import json
import sqlite3

from flask import Blueprint, jsonify, request, send_file

import db
import lookups_service
from common import ApiError, payload_of, sanitize, today
from constants import LOOKUP_CATEGORIES

bp = Blueprint("transfer", __name__, url_prefix="/api/transfer")
ROOT_TABLES = ("standard", "draft", "meeting", "action_item", "comment")
CHILD_RULES = {
    "standard": (("standard_impact_area", "standard_id"), ("standard_stage_history", "standard_id"),
                 ("meeting_standard", "standard_id")),
    "draft": (("draft_import", "draft_id"), ("draft_chapter", "draft_id"),
              ("draft_chapter_image", "draft_id"), ("draft_annotation", "draft_id")),
    "meeting": (("meeting_standard", "meeting_id"),),
    "action_item": (("action_status_history", "action_item_id"), ("feedback_recipient", "action_item_id")),
    "comment": (("comment_status_history", "comment_id"),),
}
GRANDCHILD_RULES = {"feedback_recipient": (("recipient_status_history", "feedback_recipient_id"),)}

# 每张表的外键列 → 指向的表。导出时据此把引用到的记录一并带上，
# 导入时据此改写 id（见下面「导入」一节的 IMPORT_PLAN）。
REF_COLUMNS = {
    "draft": {"standard_id": "standard"},
    "action_item": {"standard_id": "standard", "meeting_id": "meeting", "draft_id": "draft"},
    "feedback_recipient": {"action_item_id": "action_item"},
    "comment": {"standard_id": "standard", "draft_id": "draft",
                "source_recipient_id": "feedback_recipient"},
    "standard_impact_area": {"standard_id": "standard"},
    "standard_stage_history": {"standard_id": "standard"},
    "meeting_standard": {"meeting_id": "meeting", "standard_id": "standard"},
    "draft_import": {"draft_id": "draft"},
    "draft_chapter": {"draft_id": "draft", "import_batch_id": "draft_import"},
    "draft_chapter_image": {"draft_id": "draft", "chapter_id": "draft_chapter"},
    "draft_annotation": {"draft_id": "draft", "chapter_id": "draft_chapter"},
    "action_status_history": {"action_item_id": "action_item"},
    "recipient_status_history": {"feedback_recipient_id": "feedback_recipient"},
    "comment_status_history": {"comment_id": "comment"},
}
PARENT_TABLES = ("draft_import", "draft_chapter", "standard", "meeting", "draft", "action_item", "feedback_recipient", "comment")


def _table_rows(table, where="", params=()):
    return db.query(f"SELECT * FROM {table}{where}", params)


def _close_over_references(tables: dict) -> dict:
    """把包里引用到、但不属于这位登记人的记录一并带上。

    按登记人切出来的数据天然是残缺的：他登记的事项可能挂在别人建的标准上，
    他的意见可能指向别人的草案。少了这些父记录，导入方要么外键落空、
    要么撞上「事项必须关联标准」这类约束整批失败。所以导出时沿外键做一次闭包，
    把引用到的标准、会议、草案等补进来（标准再带上它的影响领域与阶段历史，
    否则对方看到的是一条没有时间轴的标准）。
    """
    have = {table: {r["id"] for r in tables.get(table, [])} for table in PARENT_TABLES}
    growing = True
    while growing:
        growing = False
        for table, refs in REF_COLUMNS.items():
            for row in list(tables.get(table, [])):
                for column, parent in refs.items():
                    row_id = row.get(column)
                    if row_id is None or row_id in have[parent]:
                        continue
                    parent_row = db.query_one(
                        f"SELECT * FROM {parent} WHERE id = ?", (row_id,))
                    if not parent_row:
                        continue
                    tables.setdefault(parent, []).append(parent_row)
                    have[parent].add(row_id)
                    growing = True
                    if parent == "standard":
                        for child in ("standard_impact_area", "standard_stage_history"):
                            tables.setdefault(child, []).extend(_table_rows(
                                child, " WHERE standard_id = ?", (row_id,)))
    return tables


def _dedupe(tables: dict) -> dict:
    """同一条记录可能被两条收集规则各带出一次（如会议涉及标准），去重后再出包。"""
    for table, rows in tables.items():
        seen, unique = set(), []
        for row in rows:
            key = row["id"] if "id" in row else tuple(sorted(row.items()))
            if key in seen:
                continue
            seen.add(key)
            unique.append(row)
        tables[table] = unique
    return tables

@bp.get("/users")
def users():
    rows = db.query("""SELECT created_by AS user, COUNT(*) AS record_count
                      FROM (SELECT created_by FROM standard UNION ALL SELECT created_by FROM draft
                            UNION ALL SELECT created_by FROM meeting UNION ALL SELECT created_by FROM action_item
                            UNION ALL SELECT created_by FROM comment)
                     WHERE created_by IS NOT NULL AND created_by <> '' GROUP BY created_by ORDER BY created_by""")
    return jsonify(rows)

@bp.get("/export")
def export_user():
    user = (request.args.get("user") or "").strip()
    if not user:
        raise ApiError("请选择登记人", field="user")
    data = {"format": "regtrack-user-data", "version": 1, "user": user, "tables": {}}
    selected = {}
    for table in ROOT_TABLES:
        rows = _table_rows(table, " WHERE created_by = ?", (user,))
        data["tables"][table] = rows
        selected[table] = {r["id"] for r in rows}
    for parent, rules in CHILD_RULES.items():
        for table, fk in rules:
            ids = selected.get(parent, set())
            rows = [] if not ids else _table_rows(table, f" WHERE {fk} IN ({','.join('?' * len(ids))})", tuple(ids))
            data["tables"].setdefault(table, []).extend(rows)
            if table in GRANDCHILD_RULES:
                child_ids = {r["id"] for r in rows}
                for gt, gfk in GRANDCHILD_RULES[table]:
                    data["tables"].setdefault(gt, []).extend([] if not child_ids else _table_rows(gt, f" WHERE {gfk} IN ({','.join('?' * len(child_ids))})", tuple(child_ids)))
    _dedupe(_close_over_references(data["tables"]))
    # 字典值不按登记人隔离，但一并带出，方便跨电脑交换后下拉框可用
    data["tables"]["lookup_value"] = _table_rows("lookup_value")
    payload = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    return send_file(io.BytesIO(payload), mimetype="application/json", as_attachment=True,
                     download_name=f"regtrack-{user}.json")

# --------------------------------------------------------------------- #
# 导入
#
# 旧做法是「保留原 id，INSERT OR IGNORE」。两台机器各自从 1 开始编号，
# 对方的标准 1 和本机的标准 1 本来就是两回事，id 一撞整行被静默忽略——
# 界面上什么也看不到，却还报了「导入 N 条」（实际进去的只是几个字典值）。
#
# 现在改成重新编号：父表拿新 id，子表按映射改写外键；命中唯一约束的记录
# （标准编号、草案版本、字典值、同一天的同名会议…）沿用本机已有的那条，
# 子表跟着挂上去，等于把两边的数据合并。导入前还要先确认登记人，
# 所有记录统一记到选定的人名下——「Wang, Xuesong」和「王学松」
# 这种同一个人的两种写法，就不会被拆成两个操作人。
# --------------------------------------------------------------------- #

# 记录「谁登记的」的列。导入时一律改写成选定的操作人；原本为空的保持为空。
OWNER_COLUMNS = ("created_by", "updated_by", "recorded_by", "archived_by")

TABLE_LABELS = {
    "lookup_value": "字典值", "standard": "标准主档", "meeting": "工作组会议",
    "draft": "草案版本", "action_item": "事项", "feedback_recipient": "反馈对象",
    "comment": "正式意见", "standard_impact_area": "影响领域",
    "standard_stage_history": "阶段历史", "meeting_standard": "会议涉及标准",
    "draft_import": "章节导入批次", "draft_chapter": "草案章节", "draft_chapter_image": "章节附图",
    "draft_annotation": "草案批注", "action_status_history": "事项状态历史",
    "recipient_status_history": "反馈状态历史", "comment_status_history": "意见状态历史",
}


class Spec:
    """一张表的导入规则。

    fks       外键列 → 指向的表，按 id 映射改写
    required  这些外键映射不到时整行丢弃（NOT NULL，留着会破坏外键）
    natural   自然键：命中本机已有记录就沿用它的 id，不再插入
    serial    业务编号列 (列名, 前缀, 取年份的日期列)，重号时本机重新取号
    keyless   复合主键、没有自增 id 的关联表，直接 INSERT OR IGNORE
    """

    def __init__(self, table, fks=(), required=(), natural=(), serial=None, keyless=False):
        self.table = table
        self.fks = dict(fks)
        self.required = set(required)
        self.natural = tuple(natural)
        self.serial = serial
        self.keyless = keyless


# 顺序即依赖顺序：父表先进，子表才找得到映射
IMPORT_PLAN = (
    Spec("lookup_value", natural=("category", "value")),
    Spec("standard", natural=("std_no",)),
    Spec("meeting", natural=("meeting_date", "title"),
         serial=("meeting_no", "MTG", "meeting_date")),
    Spec("draft", fks={"standard_id": "standard"}, required=("standard_id",),
         natural=("standard_id", "version_name", "sub_version_no")),
    Spec("action_item",
         fks={"standard_id": "standard", "meeting_id": "meeting", "draft_id": "draft"},
         serial=("item_no", "AI", "created_at")),
    Spec("feedback_recipient", fks={"action_item_id": "action_item"},
         required=("action_item_id",)),
    Spec("comment",
         fks={"standard_id": "standard", "draft_id": "draft",
              "source_recipient_id": "feedback_recipient"},
         required=("standard_id",), serial=("comment_no", "CM", "created_at")),
    Spec("standard_impact_area", fks={"standard_id": "standard"},
         required=("standard_id",), keyless=True),
    Spec("standard_stage_history", fks={"standard_id": "standard"},
         required=("standard_id",), natural=("standard_id", "stage_code")),
    Spec("meeting_standard", fks={"meeting_id": "meeting", "standard_id": "standard"},
         required=("meeting_id", "standard_id"), keyless=True),
    Spec("draft_import", fks={"draft_id": "draft"}, required=("draft_id",)),
    Spec("draft_chapter", fks={"draft_id": "draft", "import_batch_id": "draft_import"}, required=("draft_id", "import_batch_id")),
    Spec("draft_chapter_image", fks={"draft_id": "draft", "chapter_id": "draft_chapter"},
         required=("draft_id", "chapter_id")),
    Spec("draft_annotation", fks={"draft_id": "draft", "chapter_id": "draft_chapter"}, required=("draft_id",)),
    Spec("action_status_history", fks={"action_item_id": "action_item"},
         required=("action_item_id",)),
    Spec("recipient_status_history", fks={"feedback_recipient_id": "feedback_recipient"},
         required=("feedback_recipient_id",)),
    Spec("comment_status_history", fks={"comment_id": "comment"},
         required=("comment_id",)),
)


def _read_bundle():
    """取出上传的数据交换包并做格式校验。"""
    uploaded = request.files.get("file")
    raw = uploaded.read() if uploaded else (payload_of(request)).get("data", "")
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if not raw:
        raise ApiError("没有收到数据包文件", field="file")
    try:
        bundle = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise ApiError("导入文件不是有效的 UTF-8 JSON") from None
    if bundle.get("format") != "regtrack-user-data" or not isinstance(bundle.get("tables"), dict):
        raise ApiError("不是法规跟踪系统的数据交换包")
    # 包可能被人手工编辑过，文本按请求入口的同一套规则清洗
    return sanitize(bundle)


def _known_people() -> list[str]:
    rows = db.query(
        """SELECT DISTINCT name FROM (
               SELECT created_by AS name FROM standard
               UNION ALL SELECT created_by FROM draft
               UNION ALL SELECT created_by FROM meeting
               UNION ALL SELECT created_by FROM action_item
               UNION ALL SELECT created_by FROM comment
               UNION ALL SELECT value FROM lookup_value WHERE category = 'person')
            WHERE name IS NOT NULL AND name <> '' ORDER BY name""")
    return [r["name"] for r in rows]


@bp.post("/inspect")
def inspect():
    """导入前的预检：包里有什么、该记到谁名下，交给用户确认后再真正导入。"""
    bundle = _read_bundle()
    tables = bundle["tables"]
    counts = [{"table": spec.table, "label": TABLE_LABELS[spec.table],
               "count": len(tables.get(spec.table, []))}
              for spec in IMPORT_PLAN if tables.get(spec.table)]
    people = _known_people()
    declared = (bundle.get("user") or "").strip()
    return jsonify(user=declared, people=people,
                   matched=declared in people,
                   total=sum(c["count"] for c in counts), counts=counts)


def _row_for(spec, row, idmap, as_user, columns):
    """把包里的一行整理成可以插进本机的样子；返回 None 表示这行要丢弃。"""
    data = {k: v for k, v in row.items() if k in columns and k != "id"}
    for column, parent in spec.fks.items():
        old = data.get(column)
        if old is None:
            continue
        mapped = idmap[parent].get(old)
        if mapped is None:
            # 父记录没进来（包本身不完整，或父行被丢弃）
            if column in spec.required:
                return None
            data[column] = None
        else:
            data[column] = mapped
    for column in OWNER_COLUMNS:
        if data.get(column):
            data[column] = as_user
    return data


def _existing_id(conn, spec, data):
    """自然键命中本机已有记录时返回它的 id。"""
    natural = spec.natural
    if spec.table == 'standard' and (not data.get('std_no') or 'XXXX' in data['std_no'].upper()):
        natural = ('name_cn',)
    if not natural or any(data.get(k) is None for k in natural):
        return None
    where = " AND ".join(f"{k} = ?" for k in natural)
    found = conn.execute(f"SELECT id FROM {spec.table} WHERE {where}",
                         [data[k] for k in natural]).fetchone()
    return found["id"] if found else None


def _note(stat, reason: str) -> None:
    """记下被丢弃的行及其原因（同一种原因只留一条，最多三种）。"""
    stat["skipped"] += 1
    if reason not in stat["reasons"] and len(stat["reasons"]) < 3:
        stat["reasons"].append(reason)


def _unique_serial(conn, spec, data):
    """业务编号在本机已被占用时重新取号，原号留不住也不能顶掉别人的。"""
    column, prefix, date_column = spec.serial
    value = data.get(column)
    taken = value and conn.execute(
        f"SELECT 1 FROM {spec.table} WHERE {column} = ?", (value,)).fetchone()
    if value and not taken:
        return value
    year = (data.get(date_column) or today())[:4]
    return db.next_serial(spec.table, column, prefix, year)


@bp.post("/import")
def import_data():
    bundle = _read_bundle()
    as_user = (request.form.get("as_user") or "").strip()
    if not as_user:
        raise ApiError("请先确认这批数据记到哪位操作人名下", field="as_user",
                       detail="先调用 /api/transfer/inspect 让用户确认登记人")

    conn = db.get_db()
    idmap = {spec.table: {} for spec in IMPORT_PLAN}
    stats = {}
    tables = bundle["tables"]
    latest_source_batches = {}
    for row in tables.get("draft_import", []):
        if isinstance(row, dict) and row.get("id") is not None:
            draft_id = row.get("draft_id")
            latest_source_batches[draft_id] = max(row["id"], latest_source_batches.get(draft_id, row["id"]))
    current_source_chapters = {row["id"] for row in tables.get("draft_chapter", [])
                               if isinstance(row, dict) and row.get("id") is not None
                               and row.get("import_batch_id") == latest_source_batches.get(row.get("draft_id"))}
    protected_source_drafts = set()
    try:
        conn.execute("BEGIN")
        lookups_service.ensure_values("person", [as_user])
        for spec in IMPORT_PLAN:
            rows = bundle["tables"].get(spec.table) or []
            if not rows:
                continue
            columns = {r["name"] for r in conn.execute(
                f"PRAGMA table_info({spec.table})")}
            stat = stats.setdefault(spec.table, {"inserted": 0, "merged": 0,
                                                 "skipped": 0, "reasons": []})
            for row in rows:
                if not isinstance(row, dict):
                    raise ApiError(f"{TABLE_LABELS[spec.table]}的数据格式不对")
                if spec.table in ("draft_import", "draft_chapter", "draft_chapter_image", "draft_annotation"):
                    if row.get("draft_id") in protected_source_drafts:
                        _note(stat, "本机草案已有章节，保留本机章节与批注")
                        continue
                    if ((spec.table == "draft_import" and row.get("id") != latest_source_batches.get(row.get("draft_id")))
                            or (spec.table == "draft_chapter" and row.get("import_batch_id") != latest_source_batches.get(row.get("draft_id")))
                            or (spec.table == "draft_chapter_image" and row.get("chapter_id") not in current_source_chapters)
                            or (spec.table == "draft_annotation" and row.get("chapter_id") is not None
                                and row.get("chapter_id") not in current_source_chapters)):
                        _note(stat, "只导入来源草案当前章节及对应批注")
                        continue
                data = _row_for(spec, row, idmap, as_user, columns)
                if data is None:
                    _note(stat, "引用的父记录不在数据包里")
                    continue
                if spec.keyless:
                    marks = ",".join("?" * len(data))
                    cur = conn.execute(
                        f"INSERT OR IGNORE INTO {spec.table} ({','.join(data)}) "
                        f"VALUES ({marks})", list(data.values()))
                    stat["inserted" if cur.rowcount else "merged"] += 1
                    continue
                existing = _existing_id(conn, spec, data)
                if existing is not None:
                    idmap[spec.table][row.get("id")] = existing
                    stat["merged"] += 1
                    if spec.table == "draft" and conn.execute(
                            "SELECT 1 FROM draft_chapter WHERE draft_id = ? LIMIT 1", (existing,)).fetchone():
                        protected_source_drafts.add(row.get("id"))
                    continue
                if spec.serial:
                    data[spec.serial[0]] = _unique_serial(conn, spec, data)
                marks = ",".join("?" * len(data))
                try:
                    cur = conn.execute(
                        f"INSERT INTO {spec.table} ({','.join(data)}) VALUES ({marks})",
                        list(data.values()))
                except sqlite3.IntegrityError as exc:
                    # 单行违反约束（父记录没带全、包里本身就不合规）只丢这一行，
                    # 不连累整批；原因带回给用户，不做无声吞掉。
                    _note(stat, str(exc))
                    continue
                idmap[spec.table][row.get("id")] = cur.lastrowid
                stat["inserted"] += 1
        conn.commit()
    except ApiError:
        conn.rollback()
        raise
    except sqlite3.Error as exc:
        conn.rollback()
        raise ApiError("导入失败：数据包与当前版本的表结构不匹配",
                       detail=f"{type(exc).__name__}：{exc}") from None

    detail = [{"table": table, "label": TABLE_LABELS[table], **stat}
              for table, stat in stats.items()
              if stat["inserted"] or stat["merged"] or stat["skipped"]]
    return jsonify(ok=True, user=as_user,
                   inserted=sum(s["inserted"] for s in stats.values()),
                   merged=sum(s["merged"] for s in stats.values()),
                   skipped=sum(s["skipped"] for s in stats.values()),
                   tables=detail)


@bp.get("/lookup/<category>/export")
def export_lookup(category):
    if category not in LOOKUP_CATEGORIES:
        raise ApiError("未知字典类别", 404)
    rows = db.query("SELECT value, note, sort_order, is_active FROM lookup_value WHERE category = ? ORDER BY sort_order, value", (category,))
    payload = json.dumps({"format": "regtrack-lookup", "version": 1, "category": category, "items": rows}, ensure_ascii=False, indent=2).encode("utf-8")
    return send_file(io.BytesIO(payload), mimetype="application/json", as_attachment=True, download_name=f"lookup-{category}.json")

@bp.post("/lookup/<category>/import")
def import_lookup(category):
    if category not in LOOKUP_CATEGORIES:
        raise ApiError("未知字典类别", 404)
    uploaded = request.files.get("file")
    raw = uploaded.read() if uploaded else b""
    try: bundle = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError): raise ApiError("导入文件不是有效的 UTF-8 JSON")
    items = bundle.get("items") if bundle.get("format") == "regtrack-lookup" else None
    if bundle.get("category") != category or not isinstance(items, list):
        raise ApiError("字典导入包与当前主题不匹配")
    clean_items = []
    for item in items:
        value = str(item.get("value") or "").strip()
        try: order = int(item.get("sort_order"))
        except (TypeError, ValueError): raise ApiError("每条字典记录都必须填写整数排序")
        if not value or order < 0: raise ApiError("字典值不能为空，排序必须是非负整数")
        clean_items.append({"value": value, "note": item.get("note"), "sort_order": order, "is_active": 1 if item.get("is_active", 1) else 0})
    orders = [x["sort_order"] for x in clean_items]
    if len(set(orders)) != len(orders): raise ApiError("导入包内存在重复排序，请重写顺序")
    mode = request.form.get("mode", "append")
    if mode not in ("append", "replace"): raise ApiError("导入方式只能是补充或完全替换")
    existing = db.query("SELECT value, sort_order FROM lookup_value WHERE category = ?", (category,))
    if mode == "append":
        conflicts = {x["sort_order"] for x in existing} & set(orders)
        duplicate_values = {x["value"] for x in existing} & {x["value"] for x in clean_items}
        if conflicts: raise ApiError("补充导入的展示顺序与现有记录冲突，请重写排序后再导入")
        if duplicate_values: raise ApiError("补充导入包含已存在的字典值，请删除重复项后再导入")
    conn = db.get_db()
    try:
        conn.execute("BEGIN")
        if mode == "replace": conn.execute("DELETE FROM lookup_value WHERE category = ?", (category,))
        for x in clean_items:
            conn.execute("INSERT INTO lookup_value (category, value, note, sort_order, is_active) VALUES (?, ?, ?, ?, ?)", (category, x["value"], x["note"], x["sort_order"], x["is_active"]))
        conn.commit()
    except Exception:
        conn.rollback(); raise ApiError("字典导入失败")
    return jsonify(ok=True, count=len(clean_items), mode=mode)
