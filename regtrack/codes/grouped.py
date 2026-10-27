"""跨记录列表的统一分组：按标准分组、以标准组为分页单位、按登记时间排序。

草案、意见、事项列表共用本模块，保证同一套排序与分页语义。
"""

from flask import jsonify, request


def _newest_first(row: dict) -> tuple:
    return row["created_at"], row["id"]


def response(rows: list[dict], enrich=None, max_group_size=50):
    """把已经筛选过的明细按标准分组，并以标准组为分页单位。

    每行必须带 standard_id、std_no、name_cn、id、created_at；standard_id 为空的行归入 0 组。
    组间按各组最新登记时间及记录 id 降序，再按标准号（不区分大小写）升序；
    组内按登记时间、id 降序。enrich(page_rows) 可选：为当前页明细批量补充关联数据。
    """
    try:
        page = max(1, int(request.args.get("page", 1)))
        group_size = min(max_group_size, max(1, int(request.args.get("page_size", 10))))
    except ValueError:
        page, group_size = 1, 10
    offset = (page - 1) * group_size

    by_key: dict = {}
    for row in rows:
        by_key.setdefault(row["standard_id"] or 0, []).append(row)
    for items in by_key.values():
        items.sort(key=_newest_first, reverse=True)

    keys = sorted(by_key, key=lambda key: (by_key[key][0]["std_no"] is not None,
                                           (by_key[key][0]["std_no"] or "").casefold(), key))
    keys.sort(key=lambda key: _newest_first(by_key[key][0]), reverse=True)

    groups, flattened = [], []
    for key in keys[offset:offset + group_size]:
        items = by_key[key]
        first = items[0]
        groups.append({
            "group_key": key,
            "standard_id": first["standard_id"],
            "std_no": first["std_no"],
            "name_cn": first["name_cn"],
            "item_count": len(items),
            "latest_created_at": first["created_at"],
            "items": items,
        })
        flattened.extend(items)
    if enrich:
        # 只补当前页的明细，由调用方一次批量查询
        enrich(flattened)

    return jsonify(
        total=len(rows),
        group_total=len(by_key),
        page=page,
        page_size=group_size,
        groups=groups,
        # items 与 groups 顺序完全一致，供不需要分组展示的调用方直接使用。
        items=flattened,
    )
