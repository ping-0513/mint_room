# 006: GPT-4o固定版と端末内API利用額台帳

- Status: REVIEW
- 担当: Codex(思考最大)
- 目的: GPT-4oの中身が将来変わらないモデル指定にし、各API呼び出しと期間・全期間の概算利用額をUSD/JPYで確認できるようにする。

## スコープ

- 触ってよいファイル: `server/costs.mjs`, `server/costs.test.mjs`, `server/openai.mjs`, `server/openai.test.mjs`, `server.mjs`, `public/costs.js`, `public/costs.test.mjs`, `public/app.js`, `public/index.html`, `public/styles.css`, `public/settings.test.mjs`, `package.json`, `README.md`, `docs/tasks/003-skill-packs.md`, `docs/tasks/006-stable-gpt4o-and-cost-ledger.md`, `docs/tasks/README.md`, `docs/user-stability-audit.md`, `docs/ux-design-testing-principles.md` のスモーク台本、`docs/agent-handoff.md`
- 触ってはいけないもの: APIキー、外部請求データ、既存会話本文の複製、依存パッケージ、ACTIVEガイドライン本文（生きたスモーク記録を除く）

## 受け入れ条件

- モデル一覧の `gpt-4o` を `gpt-4o-2024-11-20` へ置き換え、既存保存設定の旧aliasは同snapshotへ1回移行する
- 未知・削除済みモデルを既定モデルへ黙って課金フォールバックせず、provider呼び出し前に明示エラーにする
- Responses APIの実usage、Response ID、実モデル、service tierを内容非保持の `usageEvents[]` として返す
- cached inputを通常inputと二重課金せず、版付きサーバー料金表と整数計算でUSD概算を出す。usage・料金・標準service tierが不明なら0円扱いしない
- Chat・Diary・News分類の利用額を専用localStorage台帳へ重複なく保存し、本文・回答・instructionsは台帳へ保存しない
- Settingsで手動USD/JPY、新しい呼び出しの金額、開始日〜終了日（両端を含む）の期間計、このブラウザで記録した全期間計、個別履歴を確認できる
- 為替と料金表はイベント発生時点で固定し、後の設定変更で過去金額を再計算しない。未設定時はUSDを残し「¥0」と表示しない
- 台帳破損・容量超過を無言で上書きせず、画面へ警告する
- Newsタブを開くだけの暗黙AI分類を止め、Refreshを明示起点にする。keyword fallback理由をno keyと決めつけない
- 概算の範囲（このブラウザ・記録開始後・受信できた応答のみ）と請求書との差を画面に明記する

## 制約

- 新規依存・自動為替API・OpenAI Admin Usage/Costs API連携は追加しない
- 料金の正本はnano-USD整数文字列、円はmicro-JPY整数文字列とし、各呼び出しを丸めてから累計しない
- `service_tier: "default"` を明示し、実tierがそれ以外なら標準料金を推測しない
- 新規・変更コードのコメントは日本語

## 検証

- `NODE_OPTIONS=--test-isolation=none npm test`
- `npm run check` と `git diff --check`
- APIキーなしのmockが台帳を増やさないこと
- fixture usageでChatの今回額、期間の両端、全期間、再読み込み後の保持、逆転日付エラーをブラウザ確認
- 幅375px以下・dark modeで横スクロールがないこと

## 実装前メモ(担当が着手時に記入。小タスクは省略可)

- OpenAI公式モデルページのsnapshot・Standard料金とResponses APIのusage構造を確認。料金表はサーバー所有の版付きallowlistにし、クライアント指定を信用しない。
- 「全体」はOpenAIアカウントの請求総額ではなく、このブラウザが導入後に受信できたmint room応答の概算とする。Admin API・他端末・通信断・税・契約割引は別スコープとして明示する。
- 古くなる為替を暗黙設定しないため初期値は空欄。ユーザーが入力したレートだけを新規イベントへ固定する。

## 質問(あれば。作業は可能な範囲で続ける)

## 報告(実装者が記入)

- 変更ファイル: スコープ記載のコード・テスト・ドキュメント。新規 `server/costs.mjs` と `public/costs.js` に料金計算と台帳純ロジックを分離。
- 検証結果: 最終 `NODE_OPTIONS=--test-isolation=none npm test` は87/87成功。`npm run check` と `git diff --check` も成功。cached token、実モデル料金、複数タブ台帳merge、記録時タイムゾーンも回帰テスト化。in-app browserで固定モデル表示、mock非計上、fixtureの各回 `¥0.48 ($0.003)`、2回累計 `¥0.96 ($0.006)`、2026-07-20だけの期間計 `¥0.48`、逆転日付エラー、リロード保持を確認。dark mode・幅360pxで `scrollWidth === clientWidth` を確認。
- 未確認・懸念: 実OpenAIキーと実請求書は利用できないため未確認。料金は公式ページを2026-07-20に確認したStandard料金の概算で、料金改定時は新しいpricing versionを追加する必要がある。自動為替・アカウント全体実額・別端末同期は意図的に含めない。

## レビュー(相手モデルが記入)
