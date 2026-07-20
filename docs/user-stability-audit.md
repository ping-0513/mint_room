# ユーザー目線の将来安定性監査

監査日: 2026-07-20

目的: 今は動いても、モデル・料金・外部状態が変わった時に利用者が理由の分からない挙動変更、課金、データ消失へ遭わないかを定期的に確認する。ここは実装済み機能の監査記録であり、未実装項目を完成済みとは扱わない。

## 今回解消したもの

| 優先度 | リスク | 対応 |
|---|---|---|
| P1 | `gpt-4o` 可変aliasの中身が将来変わる | `gpt-4o-2024-11-20` へ固定。旧aliasが保存されている場合だけ、防御的な安全網として同snapshotへ移行 |
| P1 | 削除・未知モデルを黙って既定モデルへ変更し、そのまま課金する | サーバーはprovider呼び出し前に `invalid_model`。UIも選択を勝手に変更せず、選び直しを表示 |
| P1 | `service_tier` がProject設定に追従して料金前提が変わる | `default` をリクエストへ明示。実tierも記録し、default以外へ標準料金を推測しない |
| P1 | OpenAI応答のusageを捨て、利用額を確認できない | Response ID・usage・実モデル・tierを内容非保持の `usageEvents[]` へ変換。Chat/Diary/Newsを記録 |
| P1 | Newsタブを開くだけで有料AI分類が発火する | 自動更新を廃止。Refreshを押した時だけ更新を開始し、有料分類の可能性を画面に明記 |
| P1 | News分類失敗をすべて「no API key」と誤表示する | `no_key` / `provider_error` / `invalid_json` / `invalid_model` を区別。JSON不正でも発生済みusageは保存 |
| P1 | コスト保存失敗・破損を0件として黙って扱う | 専用台帳はスキーマを検証。破損rawを上書きせず、quota等の保存失敗も画面に警告 |
| P2 | 後日の料金・為替で過去額が勝手に変わる | pricing version、呼び出し時の料金、手動FXをイベントごとに固定。過去分は再計算しない |

## 残っているもの

| 優先度 | リスク | 推奨する次の対応 |
|---|---|---|
| P1 | Chat・Life・Diary・Newsの汎用 `loadJSON` / `save` は破損・quotaをまだ無言で握りつぶす | タスク002の安全なバックアップ/復旧と合わせ、既知キー別schema検証、永続エラー表示、importの全件事前検証とrollbackを実装 |
| P1 | OpenAI処理中の通信断では、provider側で課金済みか端末から確定できない。Retryが新しい課金になる可能性も分かりにくい | timeout/Abortと「Retryは新しいAPI呼び出し」の表示。Response ID重複排除は実装済みだが、応答未受信分は請求画面を正本と案内 |
| P2 | `gpt-4.1-mini`（既定）、`gpt-4.1`、`gpt-4o-mini`、`o4-mini` は可変alias | 廃止状況を公式ページで再確認し、snapshotへ段階移行するかUIに「可変」と明記。今回は依頼された4oだけを勝手に広げず固定 |
| P2 | 全モデル共通でmax output 32,768を許し、4o公式上限16,384と一致しない | `MODELS` にモデル別上限を持たせ、UI max・説明・server validationを一致させる |
| P2 | 選択モデルがChatだけでなくDiary/Newsにも使われ、用途別コスト差が見えにくい | 用途別モデル設定、またはNews用の安価な固定snapshotを製品判断後に追加。現状はNews Refresh説明と用途別料金履歴で可視化 |
| P2 | 台帳はlocalStorageの個別イベントを保持するため、長期・大量利用で容量に近づく | 日次集計を残した可逆なcompaction、export、容量予告を設計。件数を黙って切り捨てて「全体」を壊さない |
| P2 | 複数タブのlocalStorage書き込みはtransactionではない | 書き込み前の再読込mergeとstorage eventで和集合を再保存する収束策は実装済み。強い同時実行保証が必要になったらIndexedDB transactionへ移行 |
| P2 | 料金表は外部で改定される | 既存イベントは固定したまま、新規呼び出し用pricing versionだけを更新するレビュー手順とテストを用意 |
| P2 | 手動USD/JPYを入れ忘れると過去イベントの円額は復元されない | USDは必ず保存済み。自動FXは提供元・障害・利用条件を決めた別タスクにし、黙った古い既定レートは入れない |
| P2 | 「全期間」はOpenAIアカウント全体の実請求ではない | 現在の限定範囲をUIへ明記済み。Admin権限・秘密分離を設計できる場合だけ、Usage/Costs管理API連携を別機能として検討 |
| P3 | 期間フィルタは再読み込み時に今月へ戻る | 利用者需要を見て表示範囲だけを別の非課金設定として保存。料金イベント自体には影響させない |

## 監査時の確認観点

- 可変alias、`latest`、暗黙default、外部設定追従を再現性が必要な箇所で使っていないか
- 未知値・provider失敗・usage欠落を、既定値や0円へ黙って置き換えていないか
- 画面を開く、タブを切り替える、再読み込みするといった非課金に見える操作が有料APIを起動しないか
- 保存失敗・移行失敗・別端末差を「データなし」と誤表示しないか
- 「今回」「全体」「実額」の範囲が、ユーザーの自然な理解と一致しているか

## 公式根拠

- GPT-4oのsnapshotは特定バージョンを固定する用途で、`gpt-4o-2024-11-20` とStandard料金が掲載されている: https://developers.openai.com/api/docs/models/gpt-4o
- Responses APIのusage、cached tokens、実モデル、service tier: https://developers.openai.com/api/reference/resources/responses/methods/create
- 他モデルの料金確認先: https://developers.openai.com/api/docs/models/gpt-4.1 / https://developers.openai.com/api/docs/models/gpt-4.1-mini / https://developers.openai.com/api/docs/models/gpt-4o-mini / https://developers.openai.com/api/docs/models/o4-mini
