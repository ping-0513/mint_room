# 001: チャット回答のコピー ボタン

- Status: REVIEW
- 担当: Codex(思考最大)
- 目的: 回答(レシピ・手順・住所など)を他アプリで使うため、各アシスタントメッセージを1タップでコピーできるようにする。パリティ表の未実装項目❌の解消第1弾。

## スコープ

- 触ってよいファイル: `public/app.js`, `public/styles.css`, `public/index.html`(必要なら), `docs/agent-handoff.md`, `docs/ux-design-testing-principles.md`(パリティ表の1行のみ)
- 触ってはいけないもの: `server/` 全部、設定スキーマ、既存のチャット送信ロジック、ACTIVE ガイドライン群(パリティ表の該当行以外)

## 受け入れ条件

- 各アシスタントメッセージにコピー ボタンが表示される(ユーザーメッセージには不要)
- 押すと本文がクリップボードに入り、ボタンが約1.5秒「✓ copied」等の完了表示に変わって戻る(無言禁止)
- ホバー時のみ表示 or 常時控えめ表示のどちらでもよいが、`docs/ui-recipes.md` の部品(btn small ghost 等)を使い、新しい色・角丸・アニメを発明しない
- 生成中(pending)のメッセージには出ない
- ダークモード・幅375pxで崩れない。レイアウトシフトを起こさない

## 制約

- `navigator.clipboard.writeText` を使用。失敗時(非https等)は無言で失敗せず、短いエラー表示
- 新規依存の追加禁止
- 新規コードのコメントは日本語で意図を書く(`docs/master-preferences.md` §6)
- AGENTS.md 全ルール適用(特に Rule 1: スコープ外のリファクタ禁止)

## 検証

- `npm run check` が通る(このタスクでユニットテスト追加は不要 — DOM操作のみのため。理由を報告欄に記載すること)
- スモーク: 送信→回答のコピー ボタン→ペーストで一致 / 連打で壊れない / pending中に出ない / ダークモード確認
- `docs/ux-design-testing-principles.md` §1 パリティ表の「回答のコピーボタン」を ✅ に更新

## 実装前メモ(担当が着手時に記入。小タスクは省略可)

## 質問(あれば。作業は可能な範囲で続ける)

## 報告(実装者が記入)

- 変更ファイル: `public/app.js`, `public/styles.css`, `docs/tasks/001-copy-button.md`, `docs/agent-handoff.md`, `docs/ux-design-testing-principles.md`（パリティ表の該当1行のみ）
- 検証結果: `npm run check` と `git diff --check` 成功。in-app browserで、保存済み回答にもボタンが表示されること、回答本文だけがクリップボードと完全一致すること、成功時「✓ copied」・拒否時「Copy failed」から約1.5秒で復帰すること、処理中はdisabledになること、pending/userには表示されないことを確認。幅375px・ダークモードで横スクロールなし、成功表示中もボタン幅116px・吹き出し高不変を確認。
- 未確認・懸念: なし。チケット指定どおり、DOM操作だけのためユニットテストは追加せず実ブラウザの成功・拒否・遅延レスポンスで検証した。

## レビュー(相手モデルが記入)
