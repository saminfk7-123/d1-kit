import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CATEGORY_TEXT, CAUSE_TEXT, KIND_NOTE, KIND_TEXT, NOUL_TEXT, REVIEW_LEVELS } from "./labels.ts";
import type { CdResult, DemoItem, Kind, ReviewResult, RunResult } from "./types.ts";

type Mode = "cached" | "live";
const KINDS: Kind[] = ["review", "aws", "snowflake"];
const YEN_PER_USD = 150;
const PRICE_PER_MILLION_INPUT = 0.04;

export function App() {
  const [demos, setDemos] = useState<DemoItem[]>([]);
  const [selected, setSelected] = useState<DemoItem | null>(null);
  const [mode, setMode] = useState<Mode>("cached");
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadDemos = () =>
    fetch("/api/demos")
      .then((r) => r.json())
      .then(setDemos);

  useEffect(() => {
    loadDemos();
  }, []);

  useEffect(() => {
    if (!selected) return;
    setResult(null);
    setError(null);
    fetch(`/api/input?kind=${selected.kind}&id=${selected.id}`)
      .then((r) => r.json())
      .then((d) => setLines(d.lines));
  }, [selected]);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [running]);

  async function run() {
    if (!selected) return;
    setRunning(true);
    setElapsed(0);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: selected.kind, id: selected.id, mode }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setResult(body);
      if (mode === "live") loadDemos();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const highlight = useMemo(() => {
    if (!result || result.kind === "review") return null;
    return { picked: result.pick.line, root: new Set(result.rootLines) };
  }, [result]);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>d1 ユースケース デモ</h1>
          <p className="sub">判定専用モデル Liquid AI d1 で、PR レビューの重さと CD 失敗の原因を判定する</p>
        </div>
        <div className="mode" role="radiogroup" aria-label="実行モード">
          <button className={mode === "cached" ? "on" : ""} onClick={() => setMode("cached")}>
            保存済みの結果
          </button>
          <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>
            ライブ実行
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar">
          {KINDS.map((kind) => (
            <section key={kind}>
              <h2>{KIND_TEXT[kind]}</h2>
              <p className="note">{KIND_NOTE[kind]}</p>
              <ul>
                {demos
                  .filter((d) => d.kind === kind)
                  .map((d) => (
                    <li key={d.id}>
                      <button
                        className={selected?.kind === d.kind && selected.id === d.id ? "item active" : "item"}
                        onClick={() => setSelected(d)}
                      >
                        <span className="item-title">{d.title}</span>
                        <span className="item-meta">
                          {d.id}
                          {d.cached && <span className="dot" title="保存済みの結果あり" />}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </nav>

        <main className="main">
          {!selected ? (
            <div className="empty">左からデモを選んでください</div>
          ) : (
            <>
              <div className="title-row">
                <div>
                  <span className="kind-badge">{KIND_TEXT[selected.kind]}</span>
                  <h2>{selected.title}</h2>
                  <p className="expected">
                    正解: <strong>{selected.expected}</strong>
                  </p>
                </div>
                <button className="run" onClick={run} disabled={running}>
                  {running ? "実行中…" : mode === "live" ? "d1 で実行" : "結果を表示"}
                </button>
              </div>

              <div className="columns">
                <InputView lines={lines} highlight={highlight} />
                <div className="results">
                  {running && (
                    <div className="card running">
                      <div className="spinner" />
                      <div>
                        d1 に問い合わせ中… {elapsed} 秒
                        <p className="hint">無料版はレート制限があるため、1 件 10〜60 秒かかることがあります</p>
                      </div>
                    </div>
                  )}
                  {error && <div className="card error">{error}</div>}
                  {result?.kind === "review" && <ReviewView r={result} />}
                  {result && result.kind !== "review" && <CdView r={result} />}
                  {!running && !result && !error && (
                    <div className="card placeholder">
                      {mode === "live" ? "「d1 で実行」を押すと、d1 に問い合わせます" : "「結果を表示」を押すと、保存済みの結果を出します"}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function InputView({ lines, highlight }: { lines: string[]; highlight: { picked: number; root: Set<number> } | null }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlight) return;
    box.current?.querySelector(`[data-line="${highlight.picked}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);

  return (
    <div className="input card">
      <h3>
        d1 に渡した入力 <span className="muted">{lines.length} 行</span>
      </h3>
      <div className="code" ref={box}>
        {lines.map((line, i) => {
          const n = i + 1;
          const cls = highlight?.picked === n ? "line picked" : highlight?.root.has(n) ? "line root" : "line";
          return (
            <div key={n} className={cls} data-line={n}>
              <span className="ln">{n}</span>
              <span className="lt">{line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Bar({ label, value, strong, mark }: { label: string; value: number; strong?: boolean; mark?: string }) {
  return (
    <div className={strong ? "bar strong" : "bar"}>
      <span className="bar-label">
        {label}
        {mark && <span className="bar-mark">{mark}</span>}
      </span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${Math.max(1, value * 100)}%` }} />
      </span>
      <span className="bar-value">{value.toFixed(2)}</span>
    </div>
  );
}

function Step({ n, title, sub, children }: { n: number; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="card step">
      <h3>
        <span className="step-n">{n}</span>
        {title}
        <span className="muted"> {sub}</span>
      </h3>
      {children}
    </div>
  );
}

function sortedEntries(p: Record<string, number>) {
  return Object.entries(p).sort((a, b) => b[1] - a[1]);
}

function Meta({ tokens, seconds, ranAt }: { tokens: number; seconds: number; ranAt: string }) {
  const usd = (tokens * PRICE_PER_MILLION_INPUT) / 1_000_000;
  return (
    <p className="meta">
      入力 {tokens.toLocaleString()} トークン ・ d1 の処理 {seconds.toFixed(2)} 秒 ・ 有料版なら ${usd.toFixed(6)}（約 {(usd * YEN_PER_USD).toFixed(3)} 円）
      ・ 実行日時 {new Date(ranAt).toLocaleString("ja-JP")}
    </p>
  );
}

function ReviewView({ r }: { r: ReviewResult }) {
  const ev = r.evaluation;
  return (
    <>
      <Verdict
        ok={r.correct}
        needsHuman={r.needsHuman}
        rows={[{ label: "レビューの重さ", got: REVIEW_LEVELS[r.level], want: REVIEW_LEVELS[r.expected], ok: r.correct }]}
      />
      <Step n={1} title="状況と評価" sub="1 回目の呼び出し。6 つの質問を同時に聞く">
        <h4>変更の種類（Choice・上位 5 件）</h4>
        {sortedEntries(ev.category.probabilities)
          .slice(0, 5)
          .map(([k, v]) => (
            <Bar key={k} label={CATEGORY_TEXT[k] ?? k} value={v} strong={k === ev.category.choice} />
          ))}
        <h4>影響の評価（Noul・Yes の確率）</h4>
        {(Object.keys(NOUL_TEXT) as (keyof typeof NOUL_TEXT)[]).map((k) => (
          <Bar key={k} label={NOUL_TEXT[k]} value={(ev as any)[k].noul} strong={(ev as any)[k].noul >= 0.5} />
        ))}
      </Step>
      <Step n={2} title="重さの判定" sub="2 回目の呼び出し。1 の結果を書き添えて Score で聞く">
        {REVIEW_LEVELS.map((label, i) => (
          <Bar key={i} label={label} value={r.decision.probabilities[String(i)] ?? 0} strong={i === r.d1Level} mark={i === r.expected ? "正解" : undefined} />
        ))}
        <p className="small">
          score = {r.decision.score.toFixed(2)}（四捨五入して {r.d1Level}）・ 確信度 {r.decision.confidence.toFixed(2)}
        </p>
      </Step>
      <Step n={3} title="ルール" sub="ファイルの場所で確実に分かることは d1 に聞かない">
        <p className="small">
          {r.floor > 0
            ? `リリース用ワークフローの変更なので、下限を ${r.floor} にしました（d1 の判定 ${r.d1Level} → 最終 ${r.level}）`
            : "当てはまるルールはありません。d1 の判定をそのまま使います"}
        </p>
      </Step>
      <Meta tokens={r.tokens} seconds={r.seconds} ranAt={r.ranAt} />
    </>
  );
}

function CdView({ r }: { r: CdResult }) {
  const lineText = { ok: "最初の原因の行", repeat: "同じ内容のくり返しの行", ng: "原因ではない行", unknown: "正解の行は未設定" }[r.lineMark];
  const rows = [
    {
      label: "原因の分類",
      got: CAUSE_TEXT[r.cause.choice] ?? r.cause.choice,
      want: r.expected.map((c) => CAUSE_TEXT[c] ?? c).join(" / "),
      ok: r.causeCorrect,
    },
  ];
  if (r.lineMark !== "unknown") {
    rows.push({ label: "原因の行", got: `${r.pick.line} 行目（${lineText}）`, want: `${r.rootLines.join(", ")} 行目`, ok: r.lineMark === "ok" });
  }
  const topCandidates = [...r.pick.candidates].sort((a, b) => b.probability - a.probability).slice(0, 8);
  return (
    <>
      <Verdict ok={rows.every((x) => x.ok)} needsHuman={r.needsHuman} rows={rows} />
      <Step n={1} title="原因の分類" sub="ログを渡して Choice で聞く">
        {sortedEntries(r.cause.probabilities).map(([k, v]) => (
          <Bar key={k} label={CAUSE_TEXT[k] ?? k} value={v} strong={k === r.cause.choice} mark={r.expected.includes(k) ? "正解" : undefined} />
        ))}
        <p className="small">確信度 {r.cause.confidence.toFixed(2)}</p>
      </Step>
      <Step n={2} title="原因の行" sub={`コードがエラーらしい行を ${r.pick.candidates.length} 行抜き出し、d1 が選ぶ（上位 8 件）`}>
        {topCandidates.map((c) => (
          <div key={c.line} className={c.line === r.pick.line ? "cand picked" : "cand"}>
            <Bar
              label={`${c.line} 行目`}
              value={c.probability}
              strong={c.line === r.pick.line}
              mark={r.rootLines.includes(c.line) ? "正解" : r.repeatLines.includes(c.line) ? "くり返し" : undefined}
            />
            <code className="cand-text">{c.text}</code>
          </div>
        ))}
        <p className="small">確信度 {r.pick.confidence.toFixed(2)}・左のログで、選んだ行を青、正解の行を緑で示しています</p>
      </Step>
      <Meta tokens={r.tokens} seconds={r.seconds} ranAt={r.ranAt} />
    </>
  );
}

function Verdict({ ok, needsHuman, rows }: { ok: boolean; needsHuman: boolean; rows: { label: string; got: string; want: string; ok: boolean }[] }) {
  return (
    <div className={ok ? "card verdict ok" : "card verdict ng"}>
      <div className="verdict-head">
        <span className="verdict-icon">{ok ? "✓" : "✗"}</span>
        <span>{ok ? "正解" : "不正解"}</span>
        {needsHuman && <span className="human">要人間（確信度が低い）</span>}
      </div>
      <table>
        <thead>
          <tr>
            <th />
            <th>d1 の判定</th>
            <th>正解</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th>{row.label}</th>
              <td className={row.ok ? "good" : "bad"}>{row.got}</td>
              <td>{row.want}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
