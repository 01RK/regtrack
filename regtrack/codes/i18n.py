"""界面语言：中文界面（英文字段名 + 中文小字）或纯英文界面。

语言保存在 Cookie 中，由 base.html 与前端 core.js 共同读取；业务数据不翻译。
"""

from flask import Flask, request
from markupsafe import Markup, escape

COOKIE = "regtrack_lang"


def current() -> str:
    return "en" if request.cookies.get(COOKIE) == "en" else "zh"


def register(app: Flask) -> None:
    @app.context_processor
    def _language():
        lang = current()

        def t(zh: str, en: str) -> str:
            return en if lang == "en" else zh

        def label(en: str, zh: str) -> Markup:
            hidden = Markup(' aria-hidden="true"') if lang == "en" else Markup('')
            return escape(en) + Markup('<small class="cn-sub"%s>%s</small>') % (hidden, zh)

        def ui_text(zh: str, en: str) -> Markup:
            # 两种文字占同一网格单元，尺寸由较长的一种决定。
            return Markup('<span class="ui-text"><span%s>%s</span><span%s>%s</span></span>') % (
                Markup(' aria-hidden="true"') if lang == "en" else Markup(''), zh,
                Markup(' aria-hidden="true"') if lang == "zh" else Markup(''), en)

        return {"lang": lang, "t": t, "L": label, "U": ui_text}
