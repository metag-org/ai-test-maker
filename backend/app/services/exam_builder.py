import random
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.question import Question, QuestionGroup
from app.schemas import ExamGenerateRequest


def _matches_filters(group: QuestionGroup, source_filter: str, tag_filter: str) -> bool:
    if source_filter and source_filter.lower() not in (group.source_name or "").lower():
        return False
    if tag_filter:
        tags_lower = [str(t).lower() for t in (group.tags or [])]
        if not any(tag_filter.lower() in t for t in tags_lower):
            return False
    return True


def _question_sort_key(q: Question, prioritize_wrong: bool) -> tuple[int, int, int, float, float]:
    """小さいほど優先度が高いキーを返す。同優先度内はランダム。"""
    wrong_priority = 0 if (prioritize_wrong and q.needs_review) else 1
    history_wrong = 0 if (prioritize_wrong and q.wrong_count > 0) else 1
    never_tested = 0 if q.tested_count == 0 else 1
    last_ts = q.last_tested_at.timestamp() if q.last_tested_at else 0.0
    return (wrong_priority, history_wrong, never_tested, last_ts, random.random())


def _group_sort_key(group: QuestionGroup, prioritize_wrong: bool) -> tuple[int, int, int, float, float]:
    qs = group.questions or []
    any_review = any(q.needs_review for q in qs)
    any_wrong = any(q.wrong_count > 0 for q in qs)
    all_new = all(q.tested_count == 0 for q in qs) if qs else False
    latest_ts = max((q.last_tested_at.timestamp() for q in qs if q.last_tested_at), default=0.0)

    wrong_priority = 0 if (prioritize_wrong and any_review) else 1
    history_wrong = 0 if (prioritize_wrong and any_wrong) else 1
    never_tested = 0 if all_new else 1
    return (wrong_priority, history_wrong, never_tested, latest_ts, random.random())


def generate_exam_candidates(db: Session, req: ExamGenerateRequest) -> dict[str, Any]:
    """
    国語は「小問単位」、理科・社会は「大問（グループ）単位」で候補をスマート抽出する。
    """
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=req.exclude_days)
        if req.exclude_days > 0
        else None
    )

    stmt = (
        select(QuestionGroup)
        .where(QuestionGroup.status == "published")
        .options(
            selectinload(QuestionGroup.questions),
            selectinload(QuestionGroup.images),
        )
    )
    all_groups = list(db.scalars(stmt).all())

    filtered_groups = [
        g
        for g in all_groups
        if g.questions and _matches_filters(g, req.source_filter.strip(), req.tag_filter.strip())
    ]

    selections: list[dict[str, Any]] = []

    # 1. 国語: 小問単位で抽出（同じグループに属する小問はまとめる）
    if req.kokugo_count > 0:
        kokugo_groups = [g for g in filtered_groups if g.subject == "kokugo"]
        group_map = {g.id: g for g in kokugo_groups}
        all_kq = [q for g in kokugo_groups for q in g.questions]

        eligible = [
            q for q in all_kq if cutoff is None or q.last_tested_at is None or q.last_tested_at < cutoff
        ]
        fallback = [q for q in all_kq if q not in eligible]

        eligible.sort(key=lambda q: _question_sort_key(q, req.prioritize_wrong))
        fallback.sort(key=lambda q: _question_sort_key(q, req.prioritize_wrong))

        picked = (eligible + fallback)[: req.kokugo_count]

        by_group: dict[Any, list[Question]] = {}
        for q in picked:
            by_group.setdefault(q.group_id, []).append(q)

        for gid, qs in by_group.items():
            grp = group_map[gid]
            qs.sort(key=lambda x: x.sort_order)
            selections.append(
                {
                    "group": grp,
                    "selected_question_ids": [q.id for q in qs],
                }
            )

    # 2. 理科・社会: 大問（グループ）単位で抽出
    for subj, target_count in (("rika", req.rika_count), ("shakai", req.shakai_count)):
        if target_count <= 0:
            continue
        subj_groups = [g for g in filtered_groups if g.subject == subj]

        def is_group_eligible(g: QuestionGroup) -> bool:
            if cutoff is None:
                return True
            latest = max((q.last_tested_at for q in g.questions if q.last_tested_at), default=None)
            return latest is None or latest < cutoff

        eligible_g = [g for g in subj_groups if is_group_eligible(g)]
        fallback_g = [g for g in subj_groups if g not in eligible_g]

        eligible_g.sort(key=lambda g: _group_sort_key(g, req.prioritize_wrong))
        fallback_g.sort(key=lambda g: _group_sort_key(g, req.prioritize_wrong))

        picked_groups = (eligible_g + fallback_g)[:target_count]
        for grp in picked_groups:
            selections.append(
                {
                    "group": grp,
                    "selected_question_ids": [q.id for q in grp.questions],
                }
            )

    return {"selections": selections}
