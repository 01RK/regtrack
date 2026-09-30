"""跨模块共用的服务层工具：错误、当前用户、字段清洗与校验。"""

import re
from datetime import date, datetime
from urllib.parse import unquote

from flask import request

# --------------------------------------------------------------------- #
# 文本清洗
#
# 同事经常直接从 Word / PDF 里复制条款和公式。这类文本里混着三种麻烦东西：
#   1. 落单的代理项（lone surrogate）——UTF-8 根本编不出来，写库时抛
#      UnicodeEncodeError，整个请求变成 500，用户只看到一句「请求失败」；
#   2. 控制字符（NUL、垂直制表符等）——能存进去，但检索和显示都会出问题；
#   3. Symbol / MT Extra 等符号字体的私用区码位（U+F020–U+F0FF）——
#      复制出来的「≤」其实是 U+F0A3，任何正常字体都画不出来，就是
#      「公式符号解析成乱码」的由来。
# 这里在请求入口统一处理：能还原的还原成真字符，不能存的去掉，
# 让保存这件事不再因为一个符号失败。
# --------------------------------------------------------------------- #

# Adobe Symbol 字体的编码表：私用区码位 = 0xF000 + 该字体内的字节值。
# 只登记含义明确的数学符号与希腊字母；其余私用区码位原样保留，
# 宁可让它显示成方块，也不猜成别的字符。
_SYMBOL_FONT = {
    0x20: " ", 0x22: "∀", 0x24: "∃", 0x2D: "−", 0x40: "≅",
    0x41: "Α", 0x42: "Β", 0x43: "Χ", 0x44: "Δ", 0x45: "Ε", 0x46: "Φ",
    0x47: "Γ", 0x48: "Η", 0x49: "Ι", 0x4B: "Κ", 0x4C: "Λ", 0x4D: "Μ",
    0x4E: "Ν", 0x4F: "Ο", 0x50: "Π", 0x51: "Θ", 0x52: "Ρ", 0x53: "Σ",
    0x54: "Τ", 0x55: "Υ", 0x57: "Ω", 0x58: "Ξ", 0x59: "Ψ", 0x5A: "Ζ",
    0x61: "α", 0x62: "β", 0x63: "χ", 0x64: "δ", 0x65: "ε", 0x66: "φ",
    0x67: "γ", 0x68: "η", 0x69: "ι", 0x6B: "κ", 0x6C: "λ", 0x6D: "μ",
    0x6E: "ν", 0x6F: "ο", 0x70: "π", 0x71: "θ", 0x72: "ρ", 0x73: "σ",
    0x74: "τ", 0x75: "υ", 0x77: "ω", 0x78: "ξ", 0x79: "ψ", 0x7A: "ζ",
    0xA3: "≤", 0xA5: "∞", 0xB0: "°", 0xB1: "±", 0xB2: "″", 0xB3: "≥",
    0xB4: "×", 0xB5: "∝", 0xB6: "∂", 0xB7: "•", 0xB8: "÷", 0xB9: "≠",
    0xBA: "≡", 0xBB: "≈", 0xBC: "…", 0xC5: "⊕", 0xC7: "∩", 0xC8: "∪",
    0xCE: "⊆", 0xD0: "∈", 0xD1: "∉", 0xD6: "√", 0xD7: "⋅",
    0xDB: "⇔", 0xDC: "⇐", 0xDD: "⇑", 0xDE: "⇒", 0xDF: "⇓",
    0xE5: "∑", 0xF2: "∫",
}
SYMBOL_FONT_MAP = {chr(0xF000 + code): text for code, text in _SYMBOL_FONT.items()}

# 落单的代理项：合法的 UTF-16 代理对在 Python 里早已合成一个字符，
# 还留在字符串里的都是配不上对的，只能丢掉。
_LONE_SURROGATE = re.compile("[\ud800-\udfff]")
# 控制字符：保留换行与制表符，其余（含 NUL）一律去掉。
_CONTROL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_text(value: str) -> str:
    """把一段从外部粘进来的文本整理成可以安全入库、正常显示的形式。"""
    if not value:
        return value
    for bad, good in SYMBOL_FONT_MAP.items():
        if bad in value:
            value = value.replace(bad, good)
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = _LONE_SURROGATE.sub("", value)
    return _CONTROL.sub("", value)


def sanitize(data):
    """递归清洗请求体里的每一个字符串（含子表数组与嵌套对象）。"""
    if isinstance(data, str):
        return sanitize_text(data)
    if isinstance(data, list):
        return [sanitize(item) for item in data]
    if isinstance(data, dict):
        return {key: sanitize(value) for key, value in data.items()}
    return data


class ApiError(Exception):
    """业务校验错误，由 create_app 统一转成 JSON 响应。

    field  出错字段，前端据此把焦点移到该控件；
    detail 追加的定位信息（具体取值、约束、数据库原文），保证用户看到的
           永远是「哪一项、为什么不行」，而不是一句笼统的失败。
    """

    def __init__(self, message: str, status: int = 400,
                 field: str | None = None, detail: str | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.field = field
        self.detail = detail

    def payload(self) -> dict:
        return {"error": self.message, "field": self.field, "detail": self.detail}


def current_user() -> str:
    """当前操作人。

    本系统单机内网使用，不做账号体系：顶栏选定的姓名随请求头下发，
    用于「Recorded By / Created By」等系统自动字段。

    HTTP 头只允许 ISO-8859-1，中文姓名由前端 encodeURIComponent 后传入，
    这里统一解码；未编码的纯英文名原样通过。
    """
    raw = (request.headers.get("X-User") or "").strip()
    return unquote(raw).strip() or "未署名"


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today() -> str:
    return date.today().isoformat()


def payload_of(req) -> dict:
    """解析请求体。请求体不是合法 JSON 时给出可定位的说明。"""
    data = req.get_json(silent=True)
    if data is None:
        if not (req.data or req.form):
            return {}
        raise ApiError("请求内容不是合法的 JSON", detail="请刷新页面后重试")
    if not isinstance(data, dict):
        raise ApiError("请求内容应为 JSON 对象", detail=f"实际收到 {type(data).__name__}")
    return sanitize(data)


def clean(payload: dict, fields: list[str]) -> dict:
    """只保留白名单字段；空串统一转 None，避免库里出现 '' 与 NULL 两种空值。"""
    out = {}
    for f in fields:
        if f not in payload:
            continue
        v = payload[f]
        if isinstance(v, str):
            v = v.strip()
            v = v or None
        out[f] = v
    return out


def require(data: dict, fields: list[tuple[str, str]]) -> None:
    """必填校验。fields 为 (字段名, 展示名) 列表，一次性报出全部缺失项。"""
    missing = [(name, label) for name, label in fields
               if data.get(name) in (None, "", [])]
    if not missing:
        return
    labels = "、".join(f"「{label}」" for _, label in missing)
    raise ApiError(
        f"{labels}为必填项",
        field=missing[0][0],
        detail="缺失字段：" + ", ".join(name for name, _ in missing),
    )


def check_enum(data: dict, name: str, allowed: list[str], label: str,
               required: bool = False) -> None:
    v = data.get(name)
    if v in (None, ""):
        if required:
            raise ApiError(f"「{label}」为必填项", field=name)
        return
    if v not in allowed:
        raise ApiError(f"「{label}」取值不合法：{v}", field=name,
                       detail="可选值：" + "、".join(allowed))


def check_date(data: dict, name: str, label: str) -> None:
    v = data.get(name)
    if not v:
        return
    try:
        date.fromisoformat(str(v))
    except ValueError:
        raise ApiError(f"「{label}」日期格式应为 YYYY-MM-DD", field=name,
                       detail=f"实际收到：{v}") from None


def stamp_create(data: dict) -> dict:
    user = current_user()
    data.update(created_by=user, created_at=now())
    return data


def stamp_update(data: dict) -> dict:
    data.update(updated_by=current_user(), updated_at=now())
    return data


def paginate(args) -> tuple[int, int]:
    """从 query string 取分页参数，返回 (limit, offset)。"""
    try:
        page = max(1, int(args.get("page", 1)))
        size = min(200, max(1, int(args.get("page_size", 25))))
    except ValueError:
        page, size = 1, 25
    return size, (page - 1) * size
