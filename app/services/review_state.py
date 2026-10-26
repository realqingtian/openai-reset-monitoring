"""人工判断优先于自动分析，仅影响派生视图；保留原始 AI 结论与推送事实。"""

from app.repositories import event_reviews


async def state() -> tuple[dict, dict, list[dict]]:
    overrides: dict = {}
    withdrawn: dict = {}
    reviews = await event_reviews.all_reviews()
    for review in reviews:
        payload = review["payload"]
        for identifier in payload["source_ids"]:
            if review["action"] == "classify":
                overrides[identifier] = {
                    "kind": payload["kind"],
                    "phase": payload["phase"],
                    "explicit": False,
                    "start": None,
                    "end": None,
                    "reason": "人工复核",
                    "manual": True,
                }
            elif review["action"] in {"withdraw", "restore"}:
                withdrawn[identifier] = review["action"] == "withdraw"
    return overrides, withdrawn, reviews


async def apply_analysis(
    rows: list[dict], analysis: list[dict], collapse_merges: bool = False
) -> tuple[list[dict], dict]:
    overrides, withdrawn, reviews = await state()
    known = {event["id"]: event for event in analysis}
    for row in rows:
        identifier = row["id"]
        if withdrawn.get(identifier):
            known[identifier] = {
                "id": identifier,
                "kind": "other",
                "phase": "unknown",
                "explicit": False,
                "start": None,
                "end": None,
                "reason": "人工撤回",
            }
        elif identifier in overrides:
            known[identifier] = {"id": identifier, **overrides[identifier]}
    if collapse_merges:
        active: dict = {}
        by_id = {row["id"]: row for row in rows}
        for review in reviews:
            if review["action"] in {"merge", "unmerge"}:
                active[review["event_id"]] = review if review["action"] == "merge" else None
        parents: dict[str, str] = {}

        def root(identifier: str) -> str:
            parents.setdefault(identifier, identifier)
            while parents[identifier] != identifier:
                identifier = parents[identifier]
            return identifier

        for merge in active.values():
            if not merge:
                continue
            target = merge["payload"]["target_id"]
            for identifier in merge["payload"]["source_ids"]:
                parents[root(identifier)] = root(target)
        components: dict[str, list[str]] = {}
        for identifier in parents:
            if identifier in by_id and identifier in known:
                components.setdefault(root(identifier), []).append(identifier)
        for identifiers in components.values():
            completed = [
                identifier
                for identifier in identifiers
                if known[identifier]["kind"] == "quota" and known[identifier]["phase"] == "completed"
            ]
            keep = (
                min(completed, key=lambda identifier: by_id[identifier]["created_at"])
                if completed
                else max(identifiers, key=lambda identifier: by_id[identifier]["created_at"])
            )
            for identifier in identifiers:
                if identifier != keep:
                    known[identifier] = {
                        **known[identifier],
                        "kind": "other",
                        "phase": "unknown",
                        "reason": "人工合并的关联证据",
                    }
    return list(known.values()), withdrawn


async def suppressed_ids() -> set[str]:
    overrides, withdrawn, _ = await state()
    return {identifier for identifier, removed in withdrawn.items() if removed} | {
        identifier for identifier, metadata in overrides.items() if metadata["kind"] == "other"
    }
