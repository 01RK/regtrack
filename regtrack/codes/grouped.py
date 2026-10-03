"""跨记录列表的统一分组：按标准分组、以标准组为分页单位、按登记时间排序。

草案、意见、事项列表共用本模块，保证同一套排序与分页语义。
"""

from flask import jsonify, request

import db


def response(item_sql: str, params: list, enrich=None):
    """把已经筛选过的明细查询按标准分组，并以标准组为分页单位。

    item_sql 必须返回 group_key、standard_id、std_no、name_cn、id、created_at。
    组间按各组最新登记时间及记录 id 降序；组内同样按登记时间、id 降序。
    """
    try:
        page = max(1, int(request.args.get("page", 1)))
        group_size = min(50, max(1, int(request.args.get("page_size", 10))))
    except ValueError:
        page, group_size = 1, 10
    offset = (page - 1) * group_size

    total = db.query_one(
        f"SELECT COUNT(*) AS c FROM ({item_sql}) AS matched", params
    )["c"]
    group_total = db.query_one(
        f"SELECT COUNT(DISTINCT group_key) AS c FROM ({item_sql}) AS matched", params
    )["c"]

    groups = db.query(
        f"""
        WITH ranked AS (
            SELECT matched.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY group_key
                       ORDER BY created_at DESC, id DESC
                   ) AS group_rank
              FROM ({item_sql}) AS matched
        )
        SELECT group_key,
               MAX(standard_id) AS standard_id,
               MAX(std_no) AS std_no,
               MAX(name_cn) AS name_cn,
               COUNT(*) AS item_count,
               MAX(CASE WHEN group_rank = 1 THEN created_at END) AS latest_created_at,
               MAX(CASE WHEN group_rank = 1 THEN id END) AS latest_id
          FROM ranked
         GROUP BY group_key
         ORDER BY latest_created_at DESC,
                  latest_id DESC,
                  std_no COLLATE NOCASE ASC,
                  group_key ASC
         LIMIT ? OFFSET ?
        """,
        params + [group_size, offset],
    )

    keys = [g["group_key"] for g in groups]
    rows = []
    if keys:
        marks = ", ".join("?" for _ in keys)
        rows = db.query(
            f"""SELECT * FROM ({item_sql}) AS matched
                  WHERE group_key IN ({marks})
                  ORDER BY created_at DESC, id DESC""",
            params + keys,
        )

    grouped_items = {key: [] for key in keys}
    for row in rows:
        key = row.pop("group_key")
        if enrich:
            enrich(row)
        grouped_items[key].append(row)

    flattened = []
    for group in groups:
        group.pop("latest_id", None)
        group["items"] = grouped_items[group["group_key"]]
        flattened.extend(group["items"])

    return jsonify(
        total=total,
        group_total=group_total,
        page=page,
        page_size=group_size,
        groups=groups,
        # items 与 groups 顺序完全一致，供不需要分组展示的调用方直接使用。
        items=flattened,
    )
