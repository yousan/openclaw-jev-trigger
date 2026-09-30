#!/usr/bin/env python3
"""Writes bench/cases.jsonl: synthetic, hand-written observations with labels.

Everything here is made up for the benchmark: no real threads, repos, shops,
hosts, or people. Each case is one watcher tick: `evidence` (and `previous`
for change conditions) plus the label `expected` (should the model be woken?).
"""
import json, pathlib

TASKS = {
    "thread-done": {
        "when": "The work in this thread is finished and the assistant has delivered its final result",
        "notWhen": "The assistant is only paused: waiting for a reply, an approval, a CI run, or a background job, or it is still working",
    },
    "ci-red": {
        "when": "The latest CI run has failed",
        "notWhen": "The latest run passed, was skipped, or is still queued or running",
    },
    "price-drop": {
        "when": "The product's price went down compared with the previous observation",
        "notWhen": "The price is the same or higher, or only the wording, layout, stock, or shipping changed",
    },
}

T = lambda *lines: "\n".join(lines)

thread = [
    # ---- finished (True)
    (True, "en", T("[user] can you bump the lodash version and open a PR?",
                   "[assistant] Opened PR #41 (lodash 4.17.21 -> 4.17.23). CI is green and I merged it into main.",
                   "[assistant] Done. Summary: 1 file changed, no API changes. Nothing left on my side.")),
    (True, "en", T("[assistant] Migration finished: 12,480 rows copied, row counts match on both sides.",
                   "[assistant] I removed the temporary table and closed issue #7. That's everything for this task.")),
    (True, "en", T("[user] please write the release notes",
                   "[assistant] Here are the release notes for v2.3.0:",
                   "- Faster search index rebuild",
                   "- Fixed timezone bug in the weekly report",
                   "[assistant] They're also committed as CHANGELOG.md in PR #88, merged.")),
    (True, "en", T("[assistant] Deployed to production at 14:05. Health checks pass and error rate is flat.",
                   "[assistant] Final report: the cache fix is live; p95 latency went from 820ms to 310ms.")),
    (True, "en", T("[assistant] I checked all 30 links in the docs. 3 were broken; I fixed them in PR #19 and it's merged.",
                   "[user] thanks!",
                   "[assistant] You're welcome — closing this out.")),
    (True, "en", T("[assistant] Investigation result: the nightly job failed because the disk on the build runner was full.",
                   "[assistant] I cleaned old artifacts, added a retention rule, and re-ran the job; it succeeded. Root cause and fix are written up in the issue. Done.")),
    (True, "en", T("[assistant] All three translations are complete (ja, de, fr) and uploaded to the shared folder.",
                   "[assistant] Task complete.")),
    (True, "en", T("[assistant] Benchmarks finished. Results table:",
                   "| model | acc | p50 |",
                   "| a | 0.91 | 120ms |",
                   "| b | 0.88 | 45ms |",
                   "[assistant] Recommendation: use b for the watcher. That wraps up this request.")),
    (True, "ja", T("[user] README の誤字を直して PR 出して",
                   "[assistant] PR #12 を出して、CI 通過後にマージしました。直したのは 4 箇所です。",
                   "[assistant] 以上で完了です。")),
    (True, "ja", T("[assistant] 本番へのデプロイが終わりました。ヘルスチェック・ログともに問題ありません。",
                   "[assistant] 変更点: 画像の遅延読み込み、キャッシュ期間を 1 日に延長。作業はこれで終わりです。")),
    (True, "ja", T("[assistant] 調査結果です。原因は cron の時刻が UTC のままだったことでした。",
                   "[assistant] TZ を Asia/Tokyo に直して再実行し、正しい時刻に届くのを確認しました。issue も閉じました。")),
    (True, "ja", T("[assistant] 請求書のダミーデータ 50 件を作成し、テスト環境に投入しました。",
                   "[assistant] 投入件数と合計金額の突き合わせも一致しています。ご依頼の作業は完了です。")),
    (True, "ja", T("[user] ありがとう、助かった",
                   "[assistant] どういたしまして。最終版のスライドは共有フォルダに置いてあります。これで締めます。")),
    (True, "ja", T("[assistant] 依存パッケージの更新 8 件、すべてマージ済みです。壊れたテストはありませんでした。",
                   "[assistant] 報告は以上です。")),
    (True, "en", T("[assistant] The flaky test is fixed: it relied on wall-clock time; now it uses a fake clock.",
                   "[assistant] 50 consecutive CI runs passed. Merged in #203. Closing the thread.")),
    (True, "ja", T("[assistant] ドメインの DNS 切り替え完了。新しいサーバーで応答していることを 3 拠点から確認しました。",
                   "[assistant] 旧サーバーの停止は不要とのことなので、ここで作業終了です。")),
    # ---- paused / still working (False) — the look-alikes that broke the JS watcher
    (False, "en", T("[assistant] Opened PR #41 (lodash 4.17.21 -> 4.17.23).",
                    "[assistant] Waiting for CI to finish before I merge. I'll report back when it's green.")),
    (False, "en", T("[assistant] The migration script is done copying the first batch (4,000 of 12,480 rows).",
                    "[assistant] Continuing with the next batch now.")),
    (False, "en", T("[assistant] I drafted the release notes. Before I commit them: should the timezone fix be listed under 'Fixes' or 'Breaking changes'?")),
    (False, "en", T("[assistant] Done with step 1 of 3 (backup finished).",
                    "[assistant] Starting step 2: schema migration. This takes ~20 minutes.")),
    (False, "en", T("[assistant] Deploy is ready. I need your approval to push to production — reply 'go' when ready.")),
    (False, "en", T("[assistant] I finished reading the logs. Next I'll reproduce the failure locally.",
                    "[tool] running: npm test -- --grep nightly ...")),
    (False, "en", T("[assistant] Translations for ja and de are complete. fr is still being generated by the background job; I'll check again in 10 minutes.")),
    (False, "en", T("[assistant] Kicked off the benchmark run (job id bench-2291). It usually takes about 15 minutes.",
                    "[assistant] I'll post the results table when it completes.")),
    (False, "ja", T("[assistant] PR #12 を出しました。CI の結果待ちです。通ったらマージします。")),
    (False, "ja", T("[assistant] デプロイの準備ができました。本番に反映してよいか、ご確認をお願いします。")),
    (False, "ja", T("[assistant] 原因の候補を 2 つに絞りました。これから再現手順を試します。")),
    (False, "ja", T("[assistant] 50 件中 20 件の投入が完了しました。残りを続けて投入しています。")),
    (False, "ja", T("[assistant] スライドの下書きができました。3 枚目のグラフは棒と折れ線どちらがよいですか？")),
    (False, "ja", T("[assistant] 依存パッケージの更新 8 件のうち 5 件をマージしました。残り 3 件はテストが落ちているので調べています。")),
    (False, "en", T("[assistant] Task complete for the frontend part.",
                    "[assistant] Now moving on to the backend changes you asked for in the second message.")),
    (False, "ja", T("[assistant] DNS の切り替えを申請しました。反映まで最大 1 時間かかるので、反映を確認してから報告します。")),
]

def run(status, conclusion, name="ci", branch="main", when="2026-09-12T10:0{}:00Z", i=0, extra=None):
    row = {"name": name, "headBranch": branch, "status": status, "conclusion": conclusion,
           "createdAt": when.format(i % 10)}
    if extra: row.update(extra)
    return row

ci = [
    (True, "en", json.dumps([run("completed", "failure", i=3), run("completed", "success", i=1)])),
    (True, "en", json.dumps([run("completed", "failure", name="test", i=5)])),
    (True, "en", "X ci  main  push  failed  3m12s  about 2 minutes ago\n✓ ci  main  push  success  3m01s  about 1 hour ago"),
    (True, "en", "Run #482 (main): build ✓  lint ✓  test ✗ (2 failed, 311 passed)\nOverall: FAILED"),
    (True, "en", json.dumps({"workflow_runs": [{"run_number": 91, "status": "completed", "conclusion": "failure", "head_branch": "main"}]})),
    (True, "ja", "最新の CI（main, #217）: テスト失敗 — 3 件のテストが落ちました。"),
    (True, "en", "Pipeline #1043 for main: failed at stage 'test' (job unit-tests exited with code 1)"),
    (True, "en", json.dumps([run("completed", "failure", branch="main", i=7), run("in_progress", None, branch="feature/x", i=8)])),
    (True, "ja", "CI 結果: ✗ 失敗（lint は通過、e2e で 1 件タイムアウト）"),
    (True, "en", "status: completed\nconclusion: failure\nfailed jobs: e2e (chromium)"),
    (False, "en", json.dumps([run("completed", "success", i=3), run("completed", "failure", i=1)])),
    (False, "en", json.dumps([run("in_progress", None, i=4), run("completed", "failure", i=2)])),
    (False, "en", "✓ ci  main  push  success  3m05s  less than a minute ago\nX ci  main  push  failed  3m12s  about 1 hour ago"),
    (False, "en", "Run #483 (main): build ✓  lint ✓  test ✓ (313 passed)\nOverall: PASSED"),
    (False, "en", json.dumps({"workflow_runs": [{"run_number": 92, "status": "queued", "conclusion": None, "head_branch": "main"}]})),
    (False, "ja", "最新の CI（main, #218）: すべて成功しました。"),
    (False, "en", "Pipeline #1044 for main: running (stage 'test', 2 of 3 jobs done, 0 failed so far)"),
    (False, "en", json.dumps([run("completed", "skipped", i=6), run("completed", "success", i=5)])),
    (False, "ja", "CI 結果: 実行中…（build 完了、test 実行中）"),
    (False, "en", "status: completed\nconclusion: success\nnote: 2 flaky tests were retried and passed"),
]

def page(name, price, extra=""):
    return f"{name}\nPrice: {price}\n{extra}".strip()

price = [
    # (label, lang, previous, current)
    (True, "en", page("Trail Runner 5 (men's)", "$129.00", "In stock"), page("Trail Runner 5 (men's)", "$109.00", "In stock")),
    (True, "en", page("Espresso grinder G2", "$249.99"), page("Espresso grinder G2", "$229.99", "Limited-time deal")),
    (True, "en", page("4K monitor 27in", "USD 399"), page("4K monitor 27in", "USD 379", "Free shipping")),
    (True, "ja", page("ワイヤレスイヤホン Z3", "¥12,800（税込）"), page("ワイヤレスイヤホン Z3", "¥9,980（税込）", "タイムセール")),
    (True, "ja", page("電気ケトル 1.0L", "4,380円"), page("電気ケトル 1.0L", "3,980円")),
    (True, "en", page("Backpack 30L", "$89.00", "Was $99.00"), page("Backpack 30L", "$79.00", "Was $99.00")),
    (True, "en", '{"sku":"KB-104","price":{"amount":74.5,"currency":"EUR"}}', '{"sku":"KB-104","price":{"amount":69.0,"currency":"EUR"}}'),
    (True, "ja", page("ロボット掃除機 R7", "¥39,800", "在庫あり"), page("ロボット掃除機 R7", "¥34,800", "在庫あり・ポイント10%")),
    (True, "en", page("Desk lamp", "$45"), page("Desk lamp", "$44.50")),
    (True, "ja", page("文庫本セット（全5巻）", "3,300円"), page("文庫本セット（全5巻）", "2,970円（10%オフ）")),
    (True, "en", page("Gaming mouse", "$59.99", "Was $69.99 — save $10"), page("Gaming mouse", "$49.99", "Was $69.99 — save $20")),
    (True, "en", page("Tent 2P", "$199.00", "Sale ends Sunday"), page("Tent 2P", "$179.00", "Sale ends Sunday")),
    (False, "en", page("Trail Runner 5 (men's)", "$109.00", "In stock"), page("Trail Runner 5 (men's)", "$109.00", "Only 3 left")),
    (False, "en", page("Espresso grinder G2", "$229.99"), page("Espresso grinder G2", "$249.99", "Deal ended")),
    (False, "en", page("4K monitor 27in", "USD 379"), page("4K monitor 27in", "USD 379.00", "Free shipping — arrives Tue")),
    (False, "ja", page("ワイヤレスイヤホン Z3", "¥9,980（税込）"), page("ワイヤレスイヤホン Z3", "¥12,800（税込）", "セール終了")),
    (False, "ja", page("電気ケトル 1.0L", "3,980円"), page("電気ケトル 1.0L", "3,980円", "送料無料になりました")),
    (False, "en", page("Backpack 30L", "$79.00", "Was $99.00"), page("Backpack 30L", "$79.00", "Was $99.00 — 20% off!")),
    (False, "en", '{"sku":"KB-104","price":{"amount":69.0,"currency":"EUR"}}', '{"sku":"KB-104","price":{"amount":69.0,"currency":"EUR"},"stock":2}'),
    (False, "ja", page("ロボット掃除機 R7", "¥34,800", "在庫あり"), page("ロボット掃除機 R7", "¥34,800", "在庫切れ")),
    (False, "en", page("Desk lamp", "$44.50"), page("Desk lamp", "$44.50", "New: now in white")),
    (False, "ja", page("文庫本セット（全5巻）", "2,970円"), page("文庫本セット（全5巻）", "3,300円")),
    (False, "en", page("Gaming mouse", "$49.99", "Was $69.99"), page("Gaming mouse", "$49.99", "Was $79.99 — save $30")),
    (False, "en", page("Tent 2P", "$179.00", "Sale ends Sunday"), page("Tent 2P", "$179.00", "Sale ends TODAY — hurry, prices go up tomorrow")),
]

out = pathlib.Path(__file__).with_name("cases.jsonl")
rows = []
for i, (label, lang, ev) in enumerate(thread):
    rows.append({"id": f"thread-{i:02d}", "task": "thread-done", "lang": lang, "expected": label, "evidence": ev})
for i, (label, lang, ev) in enumerate(ci):
    rows.append({"id": f"ci-{i:02d}", "task": "ci-red", "lang": lang, "expected": label, "evidence": ev})
for i, (label, lang, prev, cur) in enumerate(price):
    rows.append({"id": f"price-{i:02d}", "task": "price-drop", "lang": lang, "expected": label, "previous": prev, "evidence": cur})
with out.open("w") as f:
    for r in rows:
        r.update({k: v for k, v in TASKS[r["task"]].items()})
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(f"wrote {len(rows)} cases to {out}")
