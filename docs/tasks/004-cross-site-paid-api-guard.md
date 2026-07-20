# 004: localhost有料APIのクロスサイト課金防止

- Status: REVIEW
- 担当: Codex(思考最大)
- 目的: 外部サイトからlocalhostの有料APIへ単純POSTされ、回答を読めなくてもAPI利用料だけ発生する経路を閉じる。

## スコープ

- 触ってよいファイル: `server/access.mjs`, `server/access.test.mjs`, `server.mjs`, `docs/tasks/004-cross-site-paid-api-guard.md`, `docs/agent-handoff.md`
- 触ってはいけないもの: OpenAIペイロード、公開認証の新設、CORS許可、フロントエンド、依存関係

## 受け入れ条件

- 有料プロバイダー系POSTは `application/json` だけを受け付ける
- APIキー設定時、ブラウザの `Origin` があるリクエストはHostと同じlocalhostオリジンだけを許可する
- `Origin` のないCLI/同端末サーバー間リクエストは、既存のloopback+localhost Host条件を満たせば維持する
- 外部Origin、異なるポート、`Origin: null`、`text/plain` はOpenAI呼び出し前に拒否する

## 制約

- 新規依存禁止。公開アクセスは引き続き未対応
- エラーはHTTPステータスと短い理由を返し、秘密情報を含めない
- 新規・変更コードのコメントは日本語

## 検証

- 純関数テストでloopback、Host、Origin、Content-Typeの組合せを網羅
- `npm test` と `npm run check`
- 偽APIキーで外部Origin/text/plainがプロバイダー到達前に拒否されるHTTPスモーク

## 実装前メモ(担当が着手時に記入。小タスクは省略可)

- JSON必須化でブラウザの単純リクエストを除外し、JSON fetchに必要なpreflightはCORS未許可のため通さない。さらにOriginが届く場合はHostとの一致を検証する。
- Originなしはcurl等との互換性のため許可するが、既存のremoteAddress/Host二重確認は必須のままにする。

## 質問(あれば。作業は可能な範囲で続ける)

## 報告(実装者が記入)

- 変更ファイル: `server/access.mjs`, `server/access.test.mjs`, `server.mjs`, `docs/tasks/004-cross-site-paid-api-guard.md`, `docs/agent-handoff.md`
- 検証結果: `NODE_OPTIONS=--test-isolation=none npm test` 34/34 pass、`npm run check` pass。偽APIキーを設定したHTTPスモークで通常のstatusは200、外部サイトの `text/plain` POSTは415、外部OriginのJSON POSTと `Sec-Fetch-Site: cross-site` は403。サーバーの既定bind先が `127.0.0.1` であることも `server.address()` で確認。
- 未確認・懸念: 実OpenAI APIは呼んでいない。公開/LANアクセスは意図的に未対応で、必要な場合だけ `HOST` を明示設定するが、有料APIのloopback制限は残る。

## レビュー(相手モデルが記入)
