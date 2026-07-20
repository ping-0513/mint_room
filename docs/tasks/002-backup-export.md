# 002: 全データのエクスポート/インポート(バックアップ)

- Status: REVIEW
- 担当: Codex(思考最大)
- 目的: 全データが localStorage のみの現状、ブラウザのデータ消去で会話・設定・Life・日記・ニュース設定が全消失する。信頼を一発で壊す最大リスクへの対策(feature-ideas §7 の最優先項目)。

## スコープ

- 触ってよいファイル: `public/app.js`, `public/index.html`, `public/styles.css`, `public/backup.js`, `public/backup.test.mjs`, `public/settings.test.mjs`, `package.json`, `docs/tasks/002-backup-export.md`, `docs/agent-handoff.md`, `docs/ux-design-testing-principles.md`
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

- ユーザー動作: SettingsでExportすると全`mintroom.*` raw値が1ファイルへ保存され、Importでは本文を見せず件数だけを確認してから上書き・再読み込みできる。
- バックアップ本文はparse/reserializeせずraw文字列を保持する。既知6キーは未保存状態も記録し、未知の`mintroom.*`キーも将来データとして失わない。非prefixキーとAPIキーは対象外。
- Importは全件schema検証後までwriteしない。確認時には現在の全`mintroom.*`を別ファイルへ先に保存し、書込み後のread-back、途中失敗時のraw単位rollback、preview後の別タブ更新検知を行う。
- 破損cost台帳は通常データと分ける。JSON構造を読める場合は有効かつ一意なイベントだけを救出して除外件数を表示し、読めない場合はrawをバックアップに残したまま履歴だけを明示リセットする。どちらもcheckbox同意なしでは実行しない。
- Tradeoff: Importに含まれない既存の未知キーは削除せず保持する。完全なnamespace置換よりも、古いバックアップが将来データを消す事故の防止を優先する。
- 同じ未知キーが現在値とバックアップで衝突する場合も現在値を保護する。壊れた既知カテゴリはrawをファイルに残し、明示同意のうえそのカテゴリだけImport対象外にして、正常カテゴリの救出を続ける。
- 復元前バックアップは最新状態を再確認してからダウンロードを開始し、利用者がダウンロード表示を確認する2段階確認にする。進行中のChat/日記/ニュースがある間は確定できず、復元write後は古い非同期応答の保存を遮断して即reloadする。

## 質問(あれば。作業は可能な範囲で続ける)

## 報告(実装者が記入)

- 変更ファイル: `public/app.js`, `public/index.html`, `public/styles.css`, `public/backup.js`, `public/backup.test.mjs`, `public/settings.test.mjs`, `package.json`, `docs/tasks/002-backup-export.md`, `docs/agent-handoff.md`, `docs/ux-design-testing-principles.md`
- 検証結果: `node --test --test-isolation=none` 117/117 pass、`npm run check` pass、`git diff --check` pass。28件のbackup純ロジックtestで、全6スキーマの非空fixture（Skill Pack・利用額参照・ニュースcache・非空台帳を含む）のbyte単位往復、破損カテゴリskip、利用料金イベント救出後の新規追記/Import時点reset、未知キー衝突保護、別タブ変更検知、costのremove→set通知、容量解放順を考慮したrollbackと再試行を検証。source回帰testで検証前download禁止、進行中AIの確定禁止、復元後の古いsave遮断、即reload、失敗/中止後のfocus復帰を固定した。初版のin-app browser smokeではSettings表示、Export開始表示、件数だけのImport preview、Cancel後の非変更、console errorなしを確認した。
- 未確認・懸念: このWindows sandboxでは通常の`npm test`がtest worker生成時に`spawn EPERM`となるため、同じsuiteをprocess分離なしで実行した。最終安全修正後の2段階確認→実write→即reload、破損fixture、375pxダークモードを再確認しようとしたが、このタスクではin-app Browser bindingが利用不可（一覧も空）で実行できなかったため、相手モデルのレビューとDraft PR CI/手動smokeが必要。localStorageはtransactionを持たないため、UIの案内どおりImport前に他のmint roomタブを閉じる必要がある。

## レビュー(相手モデルが記入)
