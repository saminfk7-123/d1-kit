"""PR のレビューの重さを d1 で判定する（0〜3 の 4 段階）。

流れ:
  1. Situation + Evaluation: 変更の種類と、影響を表す 5 つの Yes/No を同時に聞く（前の答えに引っ張られないように）
  2. Decision: 1 の結果を PR に書き添えて、重さを判定させる
  3. ルール: ファイルの場所で確実に分かることは、d1 に聞かずに下限を決める

使い方:
  python3 review_weight/review_weight.py                      # data/express の 7 件を判定して正解と比べる
  python3 review_weight/review_weight.py path/to/dataset_dir  # 自分のデータセット（labels.json と <id>.txt、任意で context.txt）
  python3 review_weight/review_weight.py path/to/pr.txt       # PR 1 件だけ判定する（正解との比較なし）
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from d1client import LOW_CONFIDENCE, cost_usd, load_env, request  # noqa: E402

HERE = Path(__file__).resolve().parent

# ---- ここから下が「チームのレビュー方針」。自分の repo に合わせて書き換える ----

# 重さの基準（0 が最も軽い）。方針: 全員が使う部分の挙動が変わるなら、条件付きでも 3
DECISION_CRITERIA = [
    "No one is affected.",
    "Affects only maintainers, or the behavior users see does not change.",
    "Changes behavior only in a part that some users run, such as one optional feature or module.",
    "Changes behavior in a part that every user runs, even if the change only happens under a specific condition; or relates to security; or a mistake would be hard to undo.",
]

# ファイルの場所で決める判定の下限（正規表現, 下限）。差分の "diff --git a/<path>" 行に当てる
PATH_FLOORS = [
    (r"^diff --git a/\.github/workflows/\S*(publish|release|deploy)", 3),
]

# ---- ここまで ----

CATEGORIES = {
    "typo_comment": "Typo fixes or comment edits only. No code behavior changes.",
    "dev_docs": "Developer-facing docs: README, setup steps, contributing guide, directory layout, workflow rules.",
    "reference_docs": "Docs for users or integrators: API reference, specs, user guides.",
    "tests_only": "Adds, changes, or removes tests without touching production code.",
    "ui_style": "Visual changes: layout, spacing, colors, styles.",
    "feature_add": "Adds a new feature, screen, endpoint, or option.",
    "logic_change": "Changes how an existing feature behaves.",
    "shared_code": "Changes shared utilities, common components, or API contracts used from many places.",
    "refactor": "Restructures code without intending to change behavior.",
    "logging_monitoring": "Adds or changes logs, metrics, or alerts.",
    "build_infra": "Build, CI, dependencies, configuration, deployment, or environment.",
    "critical": "Authentication, permissions, payments, deletion of data, or database migrations.",
}

SITUATION_AND_EVALUATION = {
    "category": {
        "type": "choice",
        "instructions": "What kind of change is the main purpose of this pull request?",
        "criteria": CATEGORIES,
    },
    "behavior": {
        "type": "noul",
        "instructions": "Does this pull request change how the software behaves for its users at runtime?",
    },
    "used_by_everyone": {
        "type": "noul",
        "instructions": "Does the changed part run in, or get shipped to, every user's app or install?",
    },
    "conditional": {
        "type": "noul",
        "instructions": (
            "Does the behavior change happen only under a specific condition, "
            "such as a particular HTTP method, header, option, or input? "
            "Answer no if the behavior does not change at all."
        ),
    },
    "security": {
        "type": "noul",
        "instructions": "Does this pull request fix or affect security, such as a vulnerability, authentication, permissions, or secrets?",
    },
    "hard_to_undo": {
        "type": "noul",
        "instructions": "If this pull request contains a mistake, would it be hard to undo, such as deleted data, moved money, or a package version already published to users?",
    },
}

UNSURE = (0.3, 0.7)  # この範囲の Noul は「迷っている」とみなす


def path_floor(text):
    floors = [level for pattern, level in PATH_FLOORS if re.search(pattern, text, re.MULTILINE | re.IGNORECASE)]
    return max(floors, default=0)


def findings_text(ev):
    return (
        "Review findings from earlier checks:\n"
        f"- Type of change: {ev['category']['choice']}\n"
        f"- Probability that runtime behavior changes for users: {ev['behavior']['noul']:.2f}\n"
        f"- Probability that the changed part runs in or ships to every user's app: {ev['used_by_everyone']['noul']:.2f}\n"
        f"- Probability that the change happens only under a specific condition: {ev['conditional']['noul']:.2f}\n"
        f"- Probability that it relates to security: {ev['security']['noul']:.2f}\n"
        f"- Probability that a mistake would be hard to undo: {ev['hard_to_undo']['noul']:.2f}"
    )


def judge(env, text):
    """PR 1 件を判定して、(段階, 要人間か, 詳細) を返す"""
    first = request(env, text, SITUATION_AND_EVALUATION)
    ev = first["answers"]
    second = request(env, text + "\n\n" + findings_text(ev), {
        "decision": {
            "type": "score",
            "instructions": (
                "How carefully does a reviewer need to review this pull request? "
                "Use the review findings. Judge by who is affected and how badly."
            ),
            "criteria": DECISION_CRITERIA,
        },
    })
    decision = second["answers"]["decision"]

    floor = path_floor(text)
    level = max(round(decision["score"]), floor)
    everyone_unsure = UNSURE[0] <= ev["used_by_everyone"]["noul"] <= UNSURE[1]
    # ルールで下限を決めた PR は、d1 が迷っていても人に回さない
    needs_human = floor == 0 and (decision["confidence"] < LOW_CONFIDENCE or everyone_unsure)
    detail = {
        "evaluation": ev,
        "decision": decision,
        "floor": floor,
        "tokens": first["usage"]["input_tokens"] + second["usage"]["input_tokens"],
        "seconds": first["elapsed_sec"] + second["elapsed_sec"],
    }
    return level, needs_human, detail


def describe(detail):
    ev, d = detail["evaluation"], detail["decision"]
    lines = [
        f"    種類={ev['category']['choice']}  動作変化={ev['behavior']['noul']:.2f}"
        f"  全員が使う={ev['used_by_everyone']['noul']:.2f}  条件付き={ev['conditional']['noul']:.2f}"
        f"  セキュリティ={ev['security']['noul']:.2f}  取り返し困難={ev['hard_to_undo']['noul']:.2f}",
        f"    d1 の score={d['score']:.2f} 確信度={d['confidence']:.2f}"
        + (f"  ルールで下限={detail['floor']}" if detail["floor"] else "")
        + f"  入力 {detail['tokens']} トークン  d1 処理 {detail['seconds']:.2f} 秒  有料版なら ${cost_usd(detail['tokens']):.6f}",
    ]
    return "\n".join(lines)


def load_dataset(folder):
    labels = json.loads((folder / "labels.json").read_text())
    context_file = folder / "context.txt"
    context = context_file.read_text() + "\n\n" if context_file.exists() else ""
    return [
        {"id": pr_id, "expected": expected, "text": context + (folder / f"{pr_id}.txt").read_text()}
        for pr_id, expected in labels.items()
    ]


def main():
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "data" / "express"
    env = load_env()

    if target.is_file():
        level, needs_human, detail = judge(env, target.read_text())
        print(f"{target.name}  判定={level}{'  要人間' if needs_human else ''}\n{describe(detail)}")
        return

    prs = load_dataset(target)
    exact = near = flagged = tokens = 0
    for pr in prs:
        level, needs_human, detail = judge(env, pr["text"])
        exact += level == pr["expected"]
        near += abs(level - pr["expected"]) <= 1
        flagged += needs_human
        tokens += detail["tokens"]
        mark = "OK" if level == pr["expected"] else "NG"
        print(f"{pr['id']}  正解={pr['expected']}  判定={level}  {mark}{'  要人間' if needs_human else ''}\n{describe(detail)}", flush=True)

    n = len(prs)
    print(
        f"\n完全一致: {exact}/{n}   ±1 以内: {near}/{n}   要人間: {flagged}/{n}\n"
        f"1 件あたり: 入力 {tokens / n:.0f} トークン  有料版なら ${cost_usd(tokens / n):.6f}"
    )


if __name__ == "__main__":
    main()
