"""CATARC public portal HTTP and HTML adapter; no database or scheduling concerns."""
from datetime import date, timedelta
import re
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup
import requests

from constants import APP_VERSION
from portal_http import create_session, certificate_error

BASE = 'https://zxd.catarc.org.cn'
SOURCES = {'plans': '/zxd/portal/jhxdtz', 'comments': '/zxd/portal/zqyj',
           'releases': '/zxd/portal/bzgg'}


def text(node):
    return ' '.join(node.get_text(' ', strip=True).split())


def soup(html):
    return BeautifulSoup(html, 'html.parser', from_encoding='utf-8' if isinstance(html, bytes) else None)


def safe_url(base, link):
    url = urljoin(base, link)
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.netloc != 'zxd.catarc.org.cn':
        raise ValueError(f'站点返回了非中汽中心 HTTPS 链接：{url}')
    return url


def iso_date(value):
    return date.fromisoformat(value.strip()).isoformat()


def parse_listing(html, url):
    page = soup(html)
    listing = page.select_one('ul.list3')
    if listing is None:
        raise ValueError(f'通知列表结构发生变化：{url}')
    notices = []
    for li in listing.select('li'):
        a, stamp = li.select_one('a[href]'), li.select_one('.date')
        if a is None or stamp is None:
            raise ValueError(f'通知缺少链接或日期：{url}')
        notices.append(dict(url=safe_url(url, a['href']), title=text(a), date=iso_date(text(stamp))))
    match = re.search(r"pages:\s*parseInt\('([0-9]+)'\)", str(page))
    if match is None:
        raise ValueError(f'通知分页结构发生变化：{url}')
    return notices, int(match[1])


def parse_notice_date(html, category):
    page = soup(html)
    if category == 'comments':
        meta = page.select_one('.zy')
        match = re.search(r'发布日期[：:]\s*(\d{4}-\d{2}-\d{2})', text(meta)) if meta else None
        if not match:
            raise ValueError('征求意见详情缺少发布日期')
        return iso_date(match[1])
    issued = page.select_one('.dialog1 .issue-date')
    if issued is None:
        raise ValueError('公告详情缺少发布日期')
    return iso_date(text(issued))


def parse_notice(html, notice, category):
    page = soup(html)
    table = next((t for t in page.select('table')
                  if '标准名称' in [text(th) for th in t.select('thead th')]), None)
    if table is None:
        raise ValueError(f'通知缺少标准表格：{notice["url"]}')
    headers = [text(th) for th in table.select('thead th')]
    number_header = {'plans': '计划号', 'comments': '计划号/标准号', 'releases': '标准号'}[category]
    required = [number_header, '标准名称']
    if any(h not in headers for h in required):
        raise ValueError(f'标准表格字段发生变化：{notice["url"]}')
    records = []
    for tr in table.select('tbody tr'):
        cells = tr.find_all('td', recursive=False)
        if len(cells) != len(headers):
            raise ValueError(f'标准行字段不完整：{notice["url"]}')
        row = dict(zip(headers, map(text, cells)))
        number, name = row[number_header], row['标准名称']
        if not number or not name:
            raise ValueError(f'标准缺少编号或名称：{notice["url"]}')
        a = cells[headers.index('标准名称')].select_one('a')
        detail_url = None
        if a and a.get('href'):
            detail_url = safe_url(notice['url'], a['href'])
        elif a and a.get('onclick'):
            project = re.fullmatch(r'showProjDetailInfo\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*;?', a['onclick'])
            if not project:
                raise ValueError(f'标准详情链接结构发生变化：{notice["url"]}')
            detail_url = safe_url(BASE, f'/zxd/seekPublicAdvice/std-query-detail?adviceBatchId={project[1]}&ybStdProjectId={project[2]}')
        records.append(dict(number=number, name_cn=name, source_url=notice['url'],
                            detail_url=detail_url,
                            notice_date=notice['date'],
                            published_date=iso_date(row.get('计划下达日期') or row.get('发布日期') or notice['date']),
                            effective_date=iso_date(row['实施日期']) if row.get('实施日期') else None))
    return records


def parse_standard_detail(html):
    page = soup(html)
    info = {}
    for dt in page.select('dt.basicInfo-item'):
        value = dt.find_next_sibling('dd')
        if value is None:
            raise ValueError('标准详情字段缺少内容')
        info[text(dt)] = text(value)
    if not info.get('计划号'):
        raise ValueError('标准详情缺少计划号')
    heading = next((h for h in page.select('h2.title-text') if text(h) == '起草单位'), None)
    orgs = text(heading.parent.find_next_sibling('p')) if heading else ''
    return {'plan_no': info['计划号'], 'tc_wg': info.get('技术归口'), 'leading_org': orgs}


class Portal:
    def __init__(self, heartbeat=lambda: None):
        self.session = create_session()
        self.session.headers['User-Agent'] = f'RegTrack/{APP_VERSION} standard monitoring'
        self.heartbeat = heartbeat

    def close(self):
        self.session.close()

    def fetch(self, url):
        self.heartbeat()
        # Public portal only; redirects must not silently switch to login/other sites.
        try:
            response = self.session.get(safe_url(BASE, url), timeout=(10, 40), allow_redirects=False)
        except requests.exceptions.SSLError as error:
            raise requests.exceptions.SSLError(certificate_error(url)) from error
        response.raise_for_status()
        if response.is_redirect:
            raise ValueError(f'网站重定向，请检查采集来源：{url}')
        return response.content

    def read_notice(self, notice, category):
        html = self.fetch(notice['url'])
        return dict(notice, html=html, date=parse_notice_date(html, category))

    def notices(self, category, today, lookback_days):
        root = BASE + SOURCES[category]
        page_no = 1
        cutoff = (today - timedelta(days=lookback_days - 1)).isoformat()
        while True:
            url = root + f'?pageNo={page_no}&pageSize=20'
            rows, pages = parse_listing(self.fetch(url), url)
            for row in rows:
                # The detail publication date is authoritative, even when listing dates differ.
                notice = self.read_notice(row, category)
                if notice['date'] < cutoff:
                    return
                if notice['date'] <= today.isoformat():
                    yield notice
            if page_no >= pages:
                return
            page_no += 1

    def records(self, notice, category):
        rows = parse_notice(notice['html'], notice, category)
        if category == 'plans':
            for row in rows:
                if row['detail_url']:
                    detail = parse_standard_detail(self.fetch(row['detail_url']))
                    if detail['plan_no'] != row['number']:
                        raise ValueError('计划通知与标准详情的计划号不一致')
                    row.update(detail)
        return rows
