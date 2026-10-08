"""Liquid AI d1 を呼ぶための共通部分。.env の読み込みと、レート制限を考慮したリクエスト。"""
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent

LOW_CONFIDENCE = 0.6  # これ未満の確信度は「要人間」とする
PRICE_PER_MILLION_INPUT = 0.04  # 有料版 d1 の料金（USD / 入力 100 万トークン）。出力は 0


def load_env():
    env = {}
    env_file = ROOT / ".env"
    if not env_file.exists():
        raise SystemExit(".env がありません。env.example を .env にコピーして LIQUID_API_KEY を設定してください。")
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key] = value
    return env


def request(env, state, questions):
    """d1 を呼んでレスポンス全体を返す。待ち時間を除いた処理時間を elapsed_sec に入れる"""
    body = json.dumps({
        "model": env["LIQUID_MODEL"],
        "state": state,
        "questions": questions,
    }).encode()
    req = urllib.request.Request(
        env["LIQUID_BASE_URL"] + "/decisions/v1/systemone",
        data=body,
        headers={
            "Authorization": "Bearer " + env["LIQUID_API_KEY"],
            "Content-Type": "application/json",
        },
    )
    # d1:free のレート制限は厳しいので、間隔を空けつつ待ち時間を倍々に伸ばして粘る
    for wait in (5, 10, 20, 40, 60, None):
        try:
            started = time.monotonic()
            with urllib.request.urlopen(req) as res:
                data = json.load(res)
            data["elapsed_sec"] = time.monotonic() - started
            return data
        except urllib.error.HTTPError as e:
            if e.code == 429 and wait is not None:
                print(f"  レート制限にかかったので {wait} 秒待って再試行", flush=True)
                time.sleep(wait)
                continue
            raise
        finally:
            time.sleep(3)


def cost_usd(tokens):
    return tokens * PRICE_PER_MILLION_INPUT / 1_000_000
