# 画像生成のコツ(GPT Image 2 世代)

対象: 画像生成を行うAI。出典: OpenAI公式ガイドおよび2026年時点の検証記事(fal.ai / Atlabs / Framia 等)。DALL-E時代の癖を引きずらないこと。

## 大原則: キーワード羅列をやめ、指示書を書く

GPT Image 2 は生成前にプロンプトを読んで構図を計画する(Thinking Mode)。「かわいい, ミント, キラキラ, 高品質」のようなDALL-E時代のタグ羅列は力を引き出せない。**主題/動作/場面/構図/光/スタイル/文字、をそれぞれ明確な文で書いた短い指示書**が正解。

```
悪い例: cute cat, mint color, sparkle, kawaii, high quality
良い例: A small round cat naps on a windowsill in a mint-green room.
Soft morning light from the left. Watercolor illustration with thin
ink outlines, pastel mint palette, generous white space.
Composition: subject in lower-right third, calm and uncluttered.
```

## 個別のコツ

1. **文字は「タイポグラフィ仕様」として扱う。** 入れたい文字列は引用符で正確に指定し、書体の雰囲気・位置も書く(例: `The banner reads "おはよう、マスター" in rounded handwritten Japanese`)。この世代は日本語含め文字描画が実用精度になったので、文字入りカード類は積極的に作れる。ただし長文は避け、短いフレーズに。
2. **否定形ではなく置き換えで書く。**「人を入れない」より「無人の部屋」。ネガティブ指定は事故りやすい。
3. **編集は「変える所/守る所」の2列で指示する。** 「背景だけ夕方に。猫のポーズ・画風・配色は維持」のように、維持リストを明示すると崩れない。
4. **参照画像は役割を明示する。**「1枚目=内容の参照、2枚目=画風の参照」とラベルしないとモデルが推測して外す。
5. **1プロンプト1主役。** 要素を詰め込むほど平凡になる。複数要素が必要なら主従を明記する。
6. **数を数えさせるときは明示的に**(「3匹の…それぞれ左から白・黒・トラ」)。暗黙の数は揺れる。
7. **リトライは全書き換えではなく1変数ずつ。** 構図が良くて色が違うなら色の行だけ直す。
8. **写実が欲しいときはカメラ語彙**(レンズ・被写界深度・光源)。イラストが欲しいときは**画材語彙**(水彩・フラットベクター・色数)。

## このアプリ専用: mint room スタイルブロック

アプリ内で生成する画像は世界観を揃える。以下を末尾に付けるのを既定とする(ui-recipes の思想と同じ「決定を減らす」):

```
Style: gentle watercolor-and-ink illustration, pastel mint/aqua palette
with soft cream, generous margins, no harsh contrast, calm dreamy mood,
no text unless specified. Avoid: neon colors, busy backgrounds, gradients.
```

## 安全・運用

- 実在人物の顔・ロゴ・作家の固有画風の模倣指定はしない(プロバイダ規約に従う。回避表現も試みない)
- 生成は有料API。1枚ごとのコストを意識し、リトライ前にプロンプトを直す
- 失敗しても「画像は作れなかった」と正直に言う。別の生成物で誤魔化さない
