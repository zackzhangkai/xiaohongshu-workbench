import sys
import json
import re
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import urlparse


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        elif tag in ('p', 'br', 'div', 'li'):
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def plain(value):
    parser = Text()
    parser.feed(value or '')
    return re.sub(r'\s+', ' ', ''.join(parser.parts)).strip()


def parse(raw):
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('不支持包含实体声明的订阅源')
    root = ET.fromstring(raw)
    if root.tag != 'rss':
        raise ValueError('来源没有返回 RSS 内容')
    output = []
    for item in root.findall('./channel/item')[:100]:
        title = plain(item.findtext('title'))
        link = (item.findtext('link') or '').strip()
        url = urlparse(link)
        if not title or url.scheme not in ('https', 'http') or not url.netloc or url.username or url.password:
            continue
        output.append({'title': title[:500], 'url': link, 'summary': plain(item.findtext('description'))[:3000], 'publishedAt': item.findtext('pubDate') or ''})
    return output


if __name__ == '__main__':
    try:
        print(json.dumps(parse(sys.stdin.buffer.read(2_000_001)), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
