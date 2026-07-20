# 003: 会話内容に応じた内蔵 Skill Pack

- Status: REVIEW
- 担当: Codex(思考最大)
- 目的: 料理などの依頼で、選択中の会話モデルが用途別の回答手順を自動参照し、汎用回答より実用的に答えられるようにする。

## スコープ

- 触ってよいファイル: `server/skills.mjs`, `server/skills.test.mjs`, `server/openai.mjs`, `server/openai.test.mjs`, `server.mjs`, `public/app.js`, `public/index.html`, `public/styles.css`, `public/settings.test.mjs`, `package.json`, `docs/tasks/003-skill-packs.md`, `docs/agent-handoff.md`
- 触ってはいけないもの: 外部の `SKILL.md`、Codex のスキルディレクトリ、外部ツール、ACTIVE ガイドライン本文、既存 localStorage キー名

## 受け入れ条件

- `/api/chat` の直近ユーザー発言から、固定allowlist内の Skill Pack を決定的なルールで最大1件選ぶ
- 初期パックは料理・段取り・文章・学習・トラブル解決とし、曖昧なら何も選ばない
- 「料理スキルを実装」「レシピを翻訳」などのメタ依頼を料理として誤判定しない
- 選ばれた固定指示だけを `server/openai.mjs` から Responses API の `instructions` へ注入し、ユーザー本文やクライアント指定の任意指示を昇格させない
- 日記・ニュース分類には適用しない
- APIレスポンスにID・表示名だけを返し、回答には使用パックを控えめに表示する
- 自動選択は設定から無効化できる。クライアントから特定パックを強制選択できない
- `gpt-4o-2024-11-20` 固定snapshotを既存のモデル選択肢へ追加する（既定モデルは変更しない）

## 制約

- 新規依存、追加LLM呼び出し、外部通信、任意ファイル読み込みは禁止
- Skill Pack は知識DBやツール権限ではなく、短い回答品質指針として実装する
- 健康・法律・金融など高リスクな専門パックは初版に含めない
- 新規・変更コードのコメントは日本語

## 検証

- `npm test` と `npm run check`
- 料理依頼・メタ依頼・翻訳依頼・無効化・日記/ニュース非適用のユニットテスト
- APIキーなしで `/api/chat` の `activeSkills` とモック表示をHTTPスモーク
- 幅375px・ダークモードでバッジと設定が崩れないこと（ブラウザ実行不能なら未確認として報告）

## 実装前メモ(担当が着手時に記入。小タスクは省略可)

- サーバー所有の固定レジストリを使い、直近user発言だけをNFKC正規化して判定する。追加課金と指示衝突を避けるため、同時適用は最大1件。
- 通常チャットだけが自動選択を呼び、日記・ニュースは明示的に無効化する。
- UIは選択結果のID/表示名だけを保存・表示し、内部プロンプトは返さない。

## 質問(あれば。作業は可能な範囲で続ける)

## 報告(実装者が記入)

- 変更ファイル: `server/skills.mjs`, `server/skills.test.mjs`, `server/openai.mjs`, `server/openai.test.mjs`, `server.mjs`, `public/app.js`, `public/index.html`, `public/styles.css`, `public/settings.test.mjs`, `package.json`, `docs/tasks/README.md`, `docs/tasks/003-skill-packs.md`, `docs/agent-handoff.md`
- 検証結果: `NODE_OPTIONS=--test-isolation=none npm test` は51/51成功、`npm run check` と `git diff --check` も成功。HTTPスモークで固定5パックとGPT-4oを確認し、後続タスク006で `gpt-4o-2024-11-20` 固定snapshotへ更新・旧設定移行を追加。料理・学習・明示無効化・設定OFFを確認。in-app browserで日本語の料理依頼に「🍳 料理」が表示され、幅375px・ダークモードで横スクロールなし、コンソール警告/エラーなしを確認。
- 未確認・懸念: APIキーがないため実OpenAI応答は未確認。判定は追加課金のない保守的な固定ルールで、曖昧な文面は意図的にパックなしへフォールバックする。

## レビュー(相手モデルが記入)
