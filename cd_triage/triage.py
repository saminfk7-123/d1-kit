"""CD 失敗ログの原因を d1 で判定する。

  classify : 原因の大分類（認証 / 認可 / 設定値 / ビルド / 一時的 …）を Choice で選ぶ
  pick-line: コードでエラーらしい行を候補に抜き出し、根本原因の行を Choice で選ぶ（選択肢のキー = 行番号）

使い方:
  python3 cd_triage/triage.py classify snowflake   # data/snowflake の 14 件（短いログ）
  python3 cd_triage/triage.py classify aws         # data/aws の 12 件（長いログを丸ごと）
  python3 cd_triage/triage.py pick-line aws        # data/aws の 12 件で、原因の行を当てる
  python3 cd_triage/triage.py log path/to/failed.log aws   # ログ 1 件を分類し、原因の行も出す
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from d1client import LOW_CONFIDENCE, cost_usd, load_env, request  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"

# ---- ここから下が「自分の CD に合わせて書き換える」部分 ----

PROFILES = {
    "snowflake": {
        "tail_lines": 200,
        # 失敗したステップ名はログの先頭に STEP: として入っている前提（本番では GitHub の API から取る）
        "context": (
            "This is the log of a failed CD job. The pipeline deploys to Snowflake using "
            "schemachange (SQL migration scripts), Terraform with the Snowflake provider, "
            "and Snowflake CLI (snow app deploy) for a Snowflake Native App."
        ),
        "categories": {
            "auth": "Authentication: cannot log in. Wrong or expired password, key pair, JWT, or OAuth token.",
            "authorization": "Authorization: logged in, but the role lacks a privilege. Missing grant, warehouse usage, or object ownership.",
            "config": "Configuration: a missing or wrong environment variable, secret, variable value, or object name in the pipeline settings.",
            "build": "Build: the code or artifacts themselves are broken. SQL syntax errors, invalid manifest or project definition, missing files.",
            "transient": "Transient: a temporary problem that may succeed on retry. Timeouts, network errors, service unavailable.",
        },
    },
    "aws": {
        "tail_lines": None,  # 長いログの途中に原因があるので、丸ごと渡す（d1 の上限は 32,768 トークン）
        "context": (
            "This is the full log of a failed CD job on GitHub Actions. It deploys 4 apps to AWS: "
            "order-api (API Gateway, Lambda, SQS) and report-batch (Step Functions, Lambda, ECS task) with AWS CDK, "
            "web-backend (ECS Fargate service behind an ALB) with docker build and the ECS deploy action, "
            "and notification (SQS, Lambda) with Terraform. Most lines are normal successful output. "
            "Find the first error that actually caused the failure; later errors and rollback lines are often consequences."
        ),
        "categories": {
            "auth": "Authentication: cannot obtain credentials or log in. OIDC role assumption rejected, expired or invalid credentials.",
            "authorization": "Authorization: credentials work, but a role lacks a permission. AccessDenied, not authorized to perform an action, iam:PassRole.",
            "config": "Configuration: a missing or wrong environment variable, secret, parameter, ARN, or name in the pipeline or app settings.",
            "build": "Build: the code or artifacts themselves are broken. Compile errors, Docker or npm build failures, invalid templates or state machine definitions.",
            "transient": "Transient: a temporary problem that may succeed on retry. Throttling, rate exceeded, timeouts, 5xx, network errors.",
            "runtime": "Runtime: the deploy itself went through, but the app fails to start or pass health checks. Containers exiting, failing health checks.",
            "resource_state": "Resource state: conflicts with existing resources or their state. Already exists, stack stuck in a failed state, quota or limit exceeded.",
        },
    },
}

# 原因の行の候補にする行（エラーらしい語を含む行）
ERRORISH = re.compile(
    r"error|fail|denied|not authorized|exception|fatal|refused|invalid|exceeded|timed out|timeout"
    r"|unhealthy|stopped|exit code|already exists|can't|cannot|not found|missing|unable|rate exceeded|\b(403|429|5\d\d)\b",
    re.IGNORECASE,
)

# ---- ここまで ----

TIMESTAMP = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z ?")
MAX_CHOICES = 255  # d1 の Choice の選択肢の上限
MAX_CHARS = 300


def read_log(path, profile):
    lines = path.read_text().splitlines()
    if profile["tail_lines"]:
        lines = lines[-profile["tail_lines"]:]
    return lines


def classify(env, lines, profile):
    res = request(env, profile["context"] + "\n\n" + "\n".join(lines), {
        "cause": {
            "type": "choice",
            "instructions": "What is the most likely root cause of this CD failure?",
            "criteria": profile["categories"],
        },
    })
    return res["answers"]["cause"], res["usage"]["input_tokens"]


def candidates(lines):
    found = {}
    for i, line in enumerate(lines, start=1):
        body = TIMESTAMP.sub("", line).strip()
        if body and ERRORISH.search(body):
            found[f"L{i}"] = body[:MAX_CHARS]
    return dict(list(found.items())[:MAX_CHOICES])


def pick_line(env, lines, profile):
    choices = candidates(lines)
    numbered = "\n".join(f"{i}: {TIMESTAMP.sub('', l)}" for i, l in enumerate(lines, start=1))
    res = request(env, profile["context"] + "\n\n" + numbered, {
        "root_line": {
            "type": "choice",
            "instructions": (
                "Which line is the first error that actually caused this CD failure? "
                "Lines that repeat it in a summary, cancelled resources, rollback lines, "
                "and generic 'exit code' lines are consequences, not the root cause."
            ),
            "criteria": choices,
        },
    })
    answer = res["answers"]["root_line"]
    return int(answer["choice"][1:]), choices[answer["choice"]], answer["confidence"], len(choices)


def top2(probabilities):
    pairs = sorted(probabilities.items(), key=lambda kv: -kv[1])[:2]
    return "  ".join(f"{k}={v:.2f}" for k, v in pairs)


def run_classify(env, name):
    profile = PROFILES[name]
    labels = json.loads((DATA / name / "labels.json").read_text())
    correct = flagged = tokens = 0
    for log_id, expected in labels.items():
        lines = read_log(DATA / name / f"{log_id}.log", profile)
        answer, used = classify(env, lines, profile)
        tokens += used
        ok = answer["choice"] in expected
        needs_human = answer["confidence"] < LOW_CONFIDENCE
        correct += ok
        flagged += needs_human
        print(
            f"{log_id:13}  正解={'/'.join(expected):22}  判定={answer['choice']:14} ({answer['confidence']:.2f})"
            f"  {'OK' if ok else 'NG'}{'  要人間' if needs_human else ''}   上位2: {top2(answer['probabilities'])}"
            f"   [{len(lines)} 行 / {used} トークン]",
            flush=True,
        )
    n = len(labels)
    print(f"\n正解: {correct}/{n}   要人間: {flagged}/{n}\n1 件あたり: 入力 {tokens / n:.0f} トークン  有料版なら ${cost_usd(tokens / n):.6f}")


def run_pick_line(env, name):
    profile = PROFILES[name]
    truth = json.loads((DATA / name / "root_lines.json").read_text())
    exact = repeat = flagged = 0
    for log_id, roots in truth["root"].items():
        lines = read_log(DATA / name / f"{log_id}.log", profile)
        picked, text, confidence, n_choices = pick_line(env, lines, profile)
        if picked in roots:
            mark = "OK"
            exact += 1
        elif picked in truth["repeat"].get(log_id, []):
            mark = "△ くり返しの行"
            repeat += 1
        else:
            mark = "NG"
        needs_human = confidence < LOW_CONFIDENCE
        flagged += needs_human
        print(
            f"{log_id}  候補 {n_choices:3} 行  正解 {roots}  選んだ行 {picked} ({confidence:.2f})"
            f"  {mark}{'  要人間' if needs_human else ''}\n    → {text[:160]}",
            flush=True,
        )
    n = len(truth["root"])
    print(f"\n最初の原因の行: {exact}/{n}   くり返しの行: {repeat}/{n}   要人間: {flagged}/{n}")


def run_single(env, path, name):
    profile = PROFILES[name]
    lines = read_log(Path(path), profile)
    answer, _ = classify(env, lines, profile)
    picked, text, confidence, _ = pick_line(env, lines, profile)
    needs_human = min(answer["confidence"], confidence) < LOW_CONFIDENCE
    print(
        f"原因: {answer['choice']} (確信度 {answer['confidence']:.2f})   上位2: {top2(answer['probabilities'])}\n"
        f"原因の行: {picked} 行目 (確信度 {confidence:.2f})\n    {text}"
        + ("\n要人間: 確信度が低いので、人が確認してください" if needs_human else "")
    )


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    env = load_env()
    command = sys.argv[1]
    if command == "classify":
        run_classify(env, sys.argv[2])
    elif command == "pick-line":
        run_pick_line(env, sys.argv[2])
    elif command == "log":
        run_single(env, sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "aws")
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
