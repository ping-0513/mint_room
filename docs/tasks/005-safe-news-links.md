# 005: RSSニュースリンクの安全な許可リスト

- Status: DONE
- 担当: Codex(思考最大)
- 目的: RSSや端末内の古いキャッシュに危険なURLが混ざっても、ニュース見出しからスクリプトやローカルURLを開かないようにする。

## スコープ

- 触ってよいファイル: `server/news.mjs`, `server/news.test.mjs`, `public/app.js`, `public/styles.css`, `public/news-links.test.mjs`, `docs/tasks/005-safe-news-links.md`, `docs/tasks/README.md`, `docs/agent-handoff.md`
- 触ってはいけないもの: 既定RSS一覧、OpenAI分類プロンプト、設定/localStorageキー、他のACTIVEガイドライン

## 受け入れ条件

- サーバーは記事URLをURLパーサーで正規化し、`http:` / `https:` だけを保持する
- 相対URLは取得元フィードURLを基準に解決し、正規化後URLから安定IDを作る
- `javascript:`, `data:`, `file:`, `blob:`, `mailto:`、壊れたURLの記事はサーバーで除外する
- クライアントも独立に同じプロトコル許可リストを確認し、危険・不正なURLはリンクではない見出しとして表示する
- 既にlocalStorageへ残った古い危険データでもクリック可能なリンクを作らない

## 制約

- 新規依存・外部通信・既定フィード変更は禁止
- URLの文字列prefix判定ではなく `URL` で構文解析する
- 新規・変更コードのコメントは日本語

## 検証

- `npm test`, `npm run check`, `git diff --check`
- URL純関数とRSS/Atom fixtureで安全・危険・相対URLをテスト
- ブラウザで安全URLだけが `<a>`、危険URLがリンクなし要素になることを確認

## 実装前メモ(担当が着手時に記入。小タスクは省略可)

- サーバーで外部入力を落とし、クライアントでは既存キャッシュと将来の境界ミスに備える二重防御にする。

## 質問(あれば。作業は可能な範囲で続ける)

## 報告(実装者が記入)

- 変更ファイル: `server/news.mjs`, `server/news.test.mjs`, `public/app.js`, `public/styles.css`, `public/news-links.test.mjs`, `docs/tasks/005-safe-news-links.md`, `docs/tasks/README.md`, `docs/agent-handoff.md`
- 検証結果: 対象テスト13/13、全体 `NODE_OPTIONS=--test-isolation=none npm test` 55/55、`npm run check`、`git diff --check` が成功。in-app browserへ安全URLと `javascript:` / `data:` / `file:` を同時投入し、安全URLだけが `<a>`、危険URLはhrefなしの `<span>` になることを確認。再読み込み後のlocalStorageキャッシュでも同じ結果を確認。
- 未確認・懸念: 実RSS取得はネットワーク制限のため未確認だが、RSS2.0/Atomのfixtureで相対URL解決・危険URL除外・正規化後IDを検証済み。

## レビュー(相手モデルが記入)

- レビュアー: Claude(PR #4 レビュー、2026-07-20)。サーバー側 `normalizeNewsUrl`(取り込み時、相対URLはフィードURL基準で解決)とクライアント側の表示直前再検査(`<a>` / hrefなし `<span>` の分岐)の二重防御をコードで確認。テスト88/88成功を独立再確認。
- 文字列prefixではなく `URL` パーサーでの構文解析+`http:`/`https:` 許可リストという方式が要件どおりで、難読化 `javascript:` 等のfixture網羅も適切。DOM構築が全て `textContent` ベースでXSS経路がないことも合わせて確認。
- 軽微な注意(対応不要): URL正規化により相対URLだった既存キャッシュ記事のIDが変わり、一度だけ再分類コストが発生し得る。1回限りで金額も小さいため許容。DONE。