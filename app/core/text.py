"""文本归一化、相似度判定与内容指纹。"""
import hashlib
import re


def normalize_text(text):
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def texts_similar(a, b, threshold=0.8):
    """判断两段归一化文本是否高度相似（同一公告被发布/转发多条的场景）。

    用重叠系数 M/min(len_a, len_b)：对"一条是另一条的子集/转发修正版"更稳健。
    autojunk 必须关闭，否则长文本里的高频字符会被当作垃圾导致相似度失真。
    """
    from difflib import SequenceMatcher
    if not a or not b:
        return False
    sm = SequenceMatcher(None, a, b, autojunk=False)
    matched = sum(block.size for block in sm.get_matching_blocks())
    overlap = matched / min(len(a), len(b))
    return overlap >= threshold


def content_hash(text):
    """推文内容指纹：归一化空白与大小写后取哈希，用于"同内容不同推文"的去重。"""
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()
