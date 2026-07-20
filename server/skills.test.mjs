import { test } from "node:test";
import assert from "node:assert/strict";
import { getSkillInstructionBlocks, listSkillPacks, selectSkillPack } from "./skills.mjs";

const user = (content) => [{ role: "user", content }];

test("公開用Skill Pack一覧は固定5件で内部instructionsを含まない", () => {
  const packs = listSkillPacks();
  assert.deepEqual(packs.map((pack) => pack.id), ["cooking", "planning", "writing", "learning", "troubleshooting"]);
  assert.equal(new Set(packs.map((pack) => pack.id)).size, packs.length);
  assert.ok(packs.every((pack) => !("instructions" in pack)));
});

test("料理の実行依頼だけを料理Skill Packへ振り分ける", () => {
  for (const prompt of [
    "鶏むね肉とキャベツで夕飯のレシピを考えて",
    "卵は何分ゆでれば半熟になる？",
    "What can I cook with chicken and cabbage?",
    "ＲＥＣＩＰＥ for a quick dinner",
    "鶏肉と玉ねぎで何作れる？",
    "肉じゃがを作りたい",
    "チャーハン作って",
    "晩ご飯どうしよう",
    "How to cook chicken?",
    "How long should I bake chicken?",
    "Give me a recipe for apples",
    "Improve my cooking skills",
    "料理スキルを使って鶏肉のレシピを考えて",
    "Can you help me cook dinner?",
    "簡単なレシピを教えて",
    "時短レシピ",
    "おすすめレシピ",
    "一人暮らし向けの節約レシピ",
    "茄子とピーマンで何作れる？",
    "トマトときのこで何作れる？",
    "ツナ缶で何作れる？",
    "残り物で何作れる？",
    "料理の作り方を初心者向けに説明して",
    "Give me a quick recipe",
    "Share a simple recipe",
    "Can I get a recipe?",
    "Suggest a kid-friendly recipe",
    "Show me a vegetarian recipe",
    "Do you have any recipes?",
    "低カロリーなレシピを教えて",
    "アレルギー対応レシピを教えて",
    "Suggest three easy recipes",
    "Can you recommend a recipe?",
    "I need a recipe for tonight",
    "レシピお願い",
  ]) {
    assert.equal(selectSkillPack(user(prompt))?.id, "cooking", prompt);
  }
});

test("料理のメタ言及・比喩・創作題材では料理Packを誤発火させない", () => {
  for (const prompt of [
    "料理スキルを実装する方法",
    "レシピアプリのコードを書いて",
    "料理は好き？",
    "成功するチームのレシピ",
    "recipe for a successful launch",
    "SNS運用のレシピ",
    "recipe for productivity",
    "recipe for reliable software",
    "Build a meal plan app",
    "Design a meal plan API",
    "Build a dinner ideas website",
    "Create a cooking time calculator",
    "献立アプリを実装したい",
    "献立機能の設計",
    "冷蔵庫管理アプリの作り方",
    "夕飯提案アプリを作りたい",
    "献立管理ツールを作って",
    "Build a meal plan CLI",
    "Create a dinner ideas newsletter",
  ]) {
    assert.equal(selectSkillPack(user(prompt)), null, prompt);
  }
  assert.equal(selectSkillPack(user("Explain the recipe design pattern"))?.id, "learning");
  assert.equal(selectSkillPack(user("Write a story about a secret recipe"))?.id, "writing");
});

test("レシピの翻訳・添削は料理ではなく文章Packを選ぶ", () => {
  assert.equal(selectSkillPack(user("このレシピを英訳して"))?.id, "writing");
  assert.equal(selectSkillPack(user("料理メモを読みやすく添削して"))?.id, "writing");
});

test("段取り・文章・学習・トラブル解決をそれぞれ選べる", () => {
  assert.equal(selectSkillPack(user("今日のタスクを優先順位順に整理して"))?.id, "planning");
  assert.equal(selectSkillPack(user("このメールを丁寧に書き直して"))?.id, "writing");
  assert.equal(selectSkillPack(user("初心者向けに仕組みを説明して"))?.id, "learning");
  assert.equal(selectSkillPack(user("Nodeのテストが動かない。切り分けて"))?.id, "troubleshooting");
  assert.equal(selectSkillPack(user("量子力学を教えて"))?.id, "learning");
  assert.equal(selectSkillPack(user("HTTPってなに？"))?.id, "learning");
  assert.equal(selectSkillPack(user("メールの返信を考えて"))?.id, "writing");
  assert.equal(selectSkillPack(user("失敗した経験を文章にして"))?.id, "writing");
  assert.equal(selectSkillPack(user("バグという言葉の意味を教えて"))?.id, "learning");
  assert.equal(selectSkillPack(user("エラー文を要約して"))?.id, "writing");
  assert.equal(selectSkillPack(user("Nodeのエラーの直し方を教えて"))?.id, "troubleshooting");
  assert.equal(selectSkillPack(user("バグの原因を教えて"))?.id, "troubleshooting");
  assert.equal(selectSkillPack(user("Explain why this code doesn't work"))?.id, "troubleshooting");
  assert.equal(selectSkillPack(user("Teach me how to debug this error"))?.id, "troubleshooting");
  assert.equal(selectSkillPack(user("Fix this error and explain the cause"))?.id, "troubleshooting");
  assert.equal(selectSkillPack(user("Help me plan my day"))?.id, "planning");
  assert.equal(selectSkillPack(user("Plan my week"))?.id, "planning");
});

test("recipeを含む技術依頼は料理ではなく依頼意図へ振り分ける", () => {
  assert.equal(selectSkillPack(user("What is a recipe API?"))?.id, "learning");
  assert.equal(selectSkillPack(user("Compare two recipe apps")), null);
  assert.equal(selectSkillPack(user("Build a recipe website")), null);
  assert.equal(selectSkillPack(user("Create a recipe database schema")), null);
  assert.equal(selectSkillPack(user("Fix this recipe API error"))?.id, "troubleshooting");
  assert.equal(selectSkillPack(user("The recipe parser is not working"))?.id, "troubleshooting");
});

test("料理中の失敗は食品安全を含む料理Packを優先する", () => {
  assert.equal(selectSkillPack(user("レシピ通りなのに焦げてうまくいかない"))?.id, "cooking");
  assert.equal(selectSkillPack(user("パンが膨らまない"))?.id, "cooking");
});

test("直近のuser発言だけで判定し、明示的な無効化を尊重する", () => {
  assert.equal(
    selectSkillPack([
      { role: "user", content: "夕飯のレシピを考えて" },
      { role: "assistant", content: "材料は？" },
      { role: "user", content: "ありがとう、もう大丈夫" },
    ]),
    null
  );
  assert.equal(selectSkillPack(user("スキルは使わず、夕飯のレシピを短く教えて")), null);
  for (const prompt of [
    "Don't use any skills. What can I cook with chicken?",
    "Do not use any Skill Packs. Give me a recipe",
    "スキルなしで夕飯のレシピを教えて",
    "Skill Packを適用しないでレシピを教えて",
    "do not apply any Skill Packs; give me a dinner recipe",
    "without using any built-in Skill Packs, give me a recipe",
    "turn Skill Packs off and suggest a recipe",
    "disable all Skill Packs and suggest dinner",
    "スキルパックなしで夕飯を考えて",
    "スキルパック抜きでレシピを教えて",
  ]) {
    assert.equal(selectSkillPack(user(prompt)), null, prompt);
  }
});

test("長文の末尾にある変換依頼や無効化を優先する", () => {
  const longRecipe = `recipe ${"ingredient ".repeat(900)}`;
  assert.equal(selectSkillPack(user(`${longRecipe}\nTranslate this into Japanese`))?.id, "writing");
  assert.equal(selectSkillPack(user(`${longRecipe}\nDo not use any Skill Packs`)), null);
});

test("不正・空・長大な入力でも例外にならない", () => {
  for (const messages of [undefined, [], [{ role: "user", content: null }], [{ role: "user", content: {} }]]) {
    assert.equal(selectSkillPack(messages), null);
  }
  assert.equal(selectSkillPack(user("x".repeat(10_000))), null);
});

test("instructionsは固定IDを再解決し、未知IDと2件目を注入しない", () => {
  assert.deepEqual(getSkillInstructionBlocks(["unknown"]), []);
  const blocks = getSkillInstructionBlocks(["unknown", "cooking", "planning"]);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /Built-in Skill Pack: 料理/);
  assert.doesNotMatch(blocks[0], /段取り/);
});
