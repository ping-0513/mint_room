# 008: 自動CIと引き継ぎ記録の同期

- Status: REVIEW
- 担当: Codex(思考最大)
- 目的: PRごとの検証を手動報告だけに依存せず、次のエージェントが現在のmainと未完了タスクを誤認しない状態にする。

## スコープ

- 触ってよいファイル: `.github/workflows/ci.yml`, `docs/tasks/008-ci-and-handoff-sync.md`, `docs/tasks/README.md`, `docs/agent-handoff.md`
- 触ってはいけないもの: 製品コード、既存テスト、既存チケットのレビュー欄、ブランチ保護設定

## 受け入れ条件

- PRとmainへのpushでNode 22/24の`npm ci`、`npm test`、`npm run check`が自動実行される
- workflowの権限は`contents: read`だけに限定する
- `docs/agent-handoff.md`からマージ前ブランチの古い記述を除き、チケット状態とCIの有無を現在の実態へ同期する
- チケット001のレビュー欄は相手モデル用なので、Codexが代理記入しない

## 制約

- 新規依存・CIシークレット・デプロイ処理を追加しない
- GitHub公式Actionの現行メジャーを使用し、確認したrelease commitの完全SHAへ固定する
- AGENTS.md全ルール適用

## 検証

- `npm test`
- `npm run check`
- `git diff --check`
- Draft PR作成後、Node 22/24の両jobが起動し成功することを確認する

## 実装前メモ(担当が着手時に記入。小タスクは省略可)

- 製品コードと依存関係は変えず、読み取り専用権限の最小workflowにする。
- Node 22は既存の検証環境、Node 24は現在の実行環境を守る。片方の失敗で他方を打ち切らない。
- チケット001は実装済みだがレビュー欄が空なのでREVIEWのまま維持し、Fableのレビュー対象として残す。

## 質問(あれば。作業は可能な範囲で続ける)

## 報告(実装者が記入)

- 変更ファイル: `.github/workflows/ci.yml`, `docs/tasks/008-ci-and-handoff-sync.md`, `docs/tasks/README.md`, `docs/agent-handoff.md`
- 検証結果: `node --test --test-isolation=none` 88/88 pass、`npm run check` pass、stage後の`git diff --cached --check` pass。設定したworkflowはNode 22/24を独立実行し、checkout後の認証情報を保持しない。公式Actionはcheckout v7.0.1 / setup-node v6.4.0の確認済み完全SHAへ固定した。
- 未確認・懸念: このWindows sandboxでは通常の`npm test`が全test fileの子process生成時に`spawn EPERM`となるため、同じtest suiteをprocess分離なしで実行した。Draft PR上のUbuntu CIで通常の`npm test`を確認する。

## レビュー(相手モデルが記入)
