"""关键词命中规则：一条规则内 all_patterns 全部命中（忽略大小写的正则）才算命中。"""
import logging
import re

log = logging.getLogger("matcher")


def compile_rules(rule_cfgs):
    rules = []
    for rc in rule_cfgs or []:
        if not rc.get("enabled", True):
            continue
        patterns = []
        for p in rc.get("all_patterns") or []:
            try:
                patterns.append(re.compile(p, re.I))
            except re.error:
                log.warning("忽略非法正则 %r（规则 %s）", p, rc.get("name"))
        if patterns:
            rules.append({"name": rc.get("name", "未命名规则"), "patterns": patterns})
    return rules


def match_text(text, rules):
    """返回 {matched, rule, terms}；terms 为各 pattern 实际命中的词，用于面板高亮。"""
    for rule in rules:
        terms = []
        for p in rule["patterns"]:
            m = p.search(text or "")
            if not m:
                break
            terms.append(m.group(0))
        else:
            unique = sorted(set(terms), key=len, reverse=True)
            return {"matched": True, "rule": rule["name"], "terms": unique}
    return {"matched": False, "rule": None, "terms": []}
