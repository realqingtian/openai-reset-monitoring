"""公开事件的标准订阅格式；只读、不调用模型，不把推算窗口伪装成官方精确时间。"""

import re
from datetime import datetime, timezone
from email.utils import format_datetime
from html import escape
from typing import Optional
from urllib.parse import urlparse
from xml.etree.ElementTree import Element, SubElement, tostring

from app.schemas.event import ResetEventOut
from app.services.reset_forecast import parse_time

_XML_INVALID = re.compile(r"[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\U00010000-\U0010FFFF]")


def clean(value: str) -> str:
    return _XML_INVALID.sub("", value)


def escape_calendar(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
        .replace("\r", "\\n")
        .replace(";", "\\;")
        .replace(",", "\\,")
    )


def fold(line: str) -> str:
    output = []
    current = ""
    size = 0
    for char in line:
        width = len(char.encode("utf-8"))
        if size + width > 75:
            output.append(current)
            current, size = " ", 1
        current += char
        size += width
    output.append(current)
    return "\r\n".join(output)


def title(event: ResetEventOut, lang: str) -> str:
    kind = (
        {"quota": "额度重置", "card": "重置卡", "other": "其他更新"}
        if lang == "zh"
        else {"quota": "Quota reset", "card": "Banked reset", "other": "Other update"}
    )
    phase = (
        {"completed": "完成公告", "scheduled": "预告", "unknown": "阶段未确认"}
        if lang == "zh"
        else {"completed": "completion announcement", "scheduled": "preview", "unknown": "unconfirmed stage"}
    )
    return f"{kind[event.kind]} · {phase[event.phase]} · @{event.account}"


def safe_link(event: ResetEventOut) -> str:
    value = event.evidence[-1].url if event.evidence else ""
    return value if urlparse(value).scheme in {"https", "http"} else ""


def calendar(events: list[ResetEventOut], lang: str) -> str:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Codex Reset Monitor//Announcements//EN", "CALSCALE:GREGORIAN"]

    def stamp(date: datetime) -> str:
        return date.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    boundary = (
        "公告发布时间，非个人账号到账时间。"
        if lang == "zh"
        else "Announcement publication time, not individual account delivery."
    )
    for event in events:
        # 已完成仅导出公告时间；未完成只导出有明确时区的公告窗口，未知和推算不导出。
        at = (
            parse_time(event.completed_at)
            if event.phase == "completed"
            else parse_time(event.window_start)
            if event.phase == "scheduled"
            else None
        )
        if at is None:
            continue
        updated = parse_time(event.updated_at) or at
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{escape_calendar(event.id)}@codex-reset-monitor.local",
                f"DTSTAMP:{stamp(updated)}",
                f"DTSTART:{stamp(at)}",
                f"SUMMARY:{escape_calendar(title(event, lang))}",
                f"DESCRIPTION:{escape_calendar(boundary + chr(10) + safe_link(event))}",
            ]
        )
        end = parse_time(event.window_end) if event.phase == "scheduled" else None
        if end and end > at:
            lines.append(f"DTEND:{stamp(end)}")
        if safe_link(event):
            lines.append(f"URL:{escape_calendar(safe_link(event))}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"


def text_node(parent: Element, tag: str, text: str) -> Element:
    node = SubElement(parent, tag)
    node.text = clean(text)
    return node


def feed(events: list[ResetEventOut], base: str, kind: str, lang: str) -> bytes:
    name = "Codex 重置公告" if lang == "zh" else "Codex reset announcements"
    now = datetime.now(timezone.utc)
    if kind == "atom":
        root = Element("feed", {"xmlns": "http://www.w3.org/2005/Atom"})
        text_node(root, "title", name)
        text_node(root, "id", base + "/feed.atom")
        text_node(root, "updated", events[0].updated_at if events else now.isoformat())
        SubElement(root, "link", {"href": base + f"/feed.atom?lang={lang}", "rel": "self"})
        SubElement(root, "link", {"href": base + "/"})
        text_node(SubElement(root, "author"), "name", "Codex Reset Monitor")
        for event in events:
            entry = SubElement(root, "entry")
            text_node(entry, "id", "urn:codex-reset-monitor:event:" + event.id)
            text_node(entry, "title", title(event, lang))
            text_node(entry, "updated", event.updated_at)
            text_node(entry, "published", event.announced_at)
            if safe_link(event):
                SubElement(entry, "link", {"href": safe_link(event)})
            text_node(entry, "content", "\n\n".join(source.text for source in event.evidence)).set("type", "text")
    else:
        root = Element("rss", {"version": "2.0"})
        channel = SubElement(root, "channel")
        text_node(channel, "title", name)
        text_node(channel, "link", base + "/")
        text_node(channel, "description", name)
        for event in events:
            item = SubElement(channel, "item")
            text_node(item, "title", title(event, lang))
            text_node(item, "guid", "urn:codex-reset-monitor:event:" + event.id).set("isPermaLink", "false")
            text_node(item, "link", safe_link(event))
            date: Optional[datetime] = parse_time(event.announced_at)
            if date:
                text_node(item, "pubDate", format_datetime(date))
            text_node(item, "description", escape("\n\n".join(source.text for source in event.evidence)))
    return tostring(root, encoding="utf-8", xml_declaration=True)
