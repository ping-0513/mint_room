# 002: 全データのエクスポート/インポート(バックアップ)

- Status: TODO
- 担当: Codex(思考最大)
- 目的: 全データが localStorage のみの現状、ブラウザのデータ消去で会話・設定・Life・日記・ニュース設定が全消失する。信頼を一発で壊す最大リスクへの対策(feature-ideas §7 の最優先項目)。

## スコープ

- 触ってよいファイル: `public/app.js`, `public/index.html`, `public/styles.css`, `docs/agent-handoff.md`
- 触ってはいけないもの: `server/` 全部(この機能は完全クライアント完結)、既存の localStorage キー名・スキーマ(読むだけ。変えない)

## 受け入れ条件

- Settings タブの General カードに「Export data」「Import data」ボタンが並ぶ
- Export: `mintroom.*` の全キーを1つのJSONにまとめ、`mint-room-backup-YYYY-MM-DD.json` としてダウンロードされる。中身に形式バージョン(`formatVersion: 1`)とエクスポート日時を含む
- Import: ファイル選択 → 中身のプレビュー(何のデータが何件あるか)と**上書き確認**を表示 → OKで localStorage に書き込み、画面を再読み込み
- 壊れたファイル・別形式のJSONを食わせても優しいエラーで拒否し、既存データは無傷
- ボタン5状態設計(`ux-design-testing-principles.md` §2)。特にインポートの確認は必須(破壊的操作)
- 【高優先度・006レビュー起因】API利用額台帳(`mintroom.costs.v1`)もエクスポート/インポート対象に含める。台帳は1件の破損イベントで記録を停止する設計(データ保護のため意図的)だが、現状アプリ内に復旧手段がない。エクスポート→初期化→インポートの流れで記録を再開できる復旧経路を本チケットで提供すること

## 制約

- 新規依存の追加禁止(Blob + URL.createObjectURL + input[type=file] で足りる)
- APIキー等の秘密は localStorage に存在しない設計なので含まれないはずだが、エクスポート対象は `mintroom.` プレフィクスのキーのみに限定すること(将来他サイト由来のキーを巻き込まない)
- 新規コードのコメントは日本語
- AGENTS.md 全ルール適用

## 検証

- `npm run check` が通る
- エクスポート→localStorage 全消去→インポート→会話・設定・Life・日記が完全復元されることを手動確認し、手順を報告欄に記載
- 壊れたJSON・空ファイル・巨大ファイルでの拒否動作を確認
- 利用額台帳キーを故意に破損させて記録停止警告を出し、エクスポート→localStorage初期化→インポートで台帳の記録が再開することを確認
- `docs/agent-handoff.md` の What works now に追記

## 実装前メモ(担当が着手時に記入)

## 質問(あれば。作業は可能な範囲で続ける)

## 報告(実装者が記入)

- 変更ファイル:
- 検証結果:
- 未確認・懸念:

## レビュー(相手モデルが記入)
