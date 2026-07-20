// Skill Packは知識DBや実行権限ではなく、用途別の短い回答手順だけを提供する。
// ユーザー入力やクライアント指定IDをinstructionsへ昇格させないため、定義はサーバー固定にする。
const COOKING_TECHNICAL_CONTEXT = /(?:(?:料理|レシピ|献立|食材|冷蔵庫|夕飯|晩ごはん|晩ご飯|\bcooking\b|\brecipe\b|\bmeal plans?\b|\bdinner ideas?\b|\bcooking time\b).{0,40}(?:実装|設計|コード|プロンプト|アプリ|api|サイト|仕組み|機能|管理ツール|データベース|スキーマ|計算機|パーサー|\bimplement(?:ation)?\b|\bdesign\b|\bcode\b|\bprompt\b|\bapps?\b|\bapi\b|\bwebsite\b|\bfeature\b|\bsystem\b|\bdatabase\b|\bschema\b|\bcalculator\b|\bparser\b|\bcli\b|\bnewsletter\b)|(?:実装|設計|コード|プロンプト|アプリ|api|サイト|機能|管理ツール|データベース|スキーマ|\bimplement(?:ation)?\b|\bdesign\b|\bcode\b|\bprompt\b|\bapps?\b|\bapi\b|\bwebsite\b|\bfeature\b|\bsystem\b|\bdatabase\b|\bschema\b|\bcli\b|\bnewsletter\b).{0,40}(?:料理|レシピ|献立|食材|冷蔵庫|夕飯|晩ごはん|晩ご飯|\bcooking\b|\brecipe\b|\bmeal plans?\b|\bdinner ideas?\b|\bcooking time\b))/iu;
const SKILL_PACKS = [
  {
    id: "cooking",
    label: "料理",
    emoji: "🍳",
    description: "レシピ・献立・調理手順・代替食材を実用的に整理",
    signals: [
      { weight: 80, pattern: /(?:献立|調理法|料理(?:の)?作り方|何分(?:焼|煮|茹|ゆで|蒸)|(?:焼|煮|炒|揚|蒸|茹|ゆで)(?:き方|方|時間)|(?:夕飯|晩ごはん|晩ご飯|朝ごはん|朝食|昼ごはん|昼食).{0,12}(?:作|考|何|どうしよう)|(?:食材|材料|冷蔵庫).{0,18}(?:作|レシピ|献立)|料理スキル.{0,12}(?:使|上達)|(?:(?:簡単|時短|節約|おすすめ|子ども向け|一人暮らし向け|初心者向け|ヘルシー|低予算|低カロリー|高たんぱく|アレルギー対応|グルテンフリー|作り置き)(?:な|の)?).{0,12}(?:レシピ|献立)|(?:レシピ|献立).{0,12}(?:簡単|時短|節約|おすすめ|子ども向け|一人暮らし向け|初心者向け|ヘルシー|低予算|低カロリー|高たんぱく|アレルギー対応|グルテンフリー|作り置き)|^(?:おすすめ(?:の)?|簡単な?|時短|節約)?レシピ(?:を)?(?:教えて|考えて|提案して|見せて|お願い)?[?？!！。]*$)/u },
      { weight: 80, pattern: /(?:(?:肉じゃが|チャーハン|カレー|パスタ|スープ|パン|ケーキ|ラーメン|うどん|おかず|弁当|ご飯|ごはん|鶏(?:肉|むね|もも)|豚肉|牛肉|魚|鮭|卵|玉ねぎ|じゃがいも|キャベツ|にんじん|人参|豆腐|チーズ|茄子|なす|ナス|ピーマン|トマト|きのこ|茸|ツナ(?:缶)?|残り物|余りもの|余り物).{0,24}(?:レシピ|作り方|作って|作りたい|作る|調理|焼|煮|炒|揚|蒸|茹|ゆで|何作)|(?:レシピ|作り方).{0,24}(?:肉じゃが|チャーハン|カレー|パスタ|スープ|パン|ケーキ|ラーメン|うどん|ご飯|ごはん|鶏(?:肉|むね|もも)|豚肉|牛肉|魚|鮭|卵|野菜|豆腐|チーズ|茄子|なす|ナス|ピーマン|トマト|きのこ|茸|ツナ(?:缶)?))/u },
      { weight: 96, pattern: /(?:レシピ|パン|ケーキ|ご飯|料理|焼いた|煮た).{0,24}(?:焦げ|膨らまない|固い|生焼け|うまくいかない|失敗)|(?:焦げ|膨らまない|生焼け).{0,24}(?:レシピ|パン|ケーキ|料理)/u },
      { weight: 80, pattern: /\b(?:meal plan|cooking time|dinner ideas?|what (?:can|should) i (?:cook|make) (?:for|with)|(?:can you )?help me (?:to )?cook|how (?:(?:do|should|can|long (?:should|do|to)) )?(?:i )?(?:cook|bake|boil|fry|roast|grill|steam)|(?:cook|bake|boil|fry|roast|grill|steam) (?:me )?(?:rice|chicken|fish|vegetables?|bread|cake)|(?:improve|practice|learn) (?:my )?cooking skills?)\b/i },
      { weight: 80, pattern: /(?:(?:\brecipe\b.{0,28}\b(?:breakfast|lunch|dinner|tonight|meal|dish|food|chicken|fish|meat|rice|vegetables?|apples?|bread|cake|soup|pasta)\b)|(?:\b(?:breakfast|lunch|dinner|tonight|meal|dish|food|chicken|fish|meat|rice|vegetables?|apples?|bread|cake|soup|pasta)\b.{0,28}\brecipe\b)|\b(?:give|show|share|suggest)(?: me)? (?:(?:an?|some|one|two|three|\d+|a few) )?(?:(?:quick|easy|simple|kid-friendly|vegetarian|vegan|healthy|budget-friendly) )?recipes?\b|\bcan (?:i (?:get|have)|you recommend) (?:an? |some )?recipes?\b|\bi (?:need|want) (?:an? |some )?recipes?\b|\bdo you have (?:any |an? |some )?recipes?\b|^(?:please )?(?:(?:give|show|suggest|share) me (?:a |the )?)?recipe(?: please| promptly)?[?!.]*$)/i },
      { weight: 96, pattern: /\b(?:recipe|bread|cake|rice|chicken|fish).{0,28}(?:burn(?:ed|t)?|didn['’]?t rise|won['’]?t rise|raw|overcook(?:ed)?|undercook(?:ed)?|not cooking)\b/i },
    ],
    blockers: [
      COOKING_TECHNICAL_CONTEXT,
      /(?:(?:成功|チーム|組織|人生|仕事|恋愛).{0,20}(?:レシピ|\brecipe\b)|(?:レシピ|\brecipe\b).{0,20}(?:成功|チーム|組織|人生|仕事|恋愛)|\brecipe (?:design pattern|for (?:a )?(?:success|successful|happiness|life|team|launch|disaster))\b)/iu,
    ],
    instructions: [
      "人数・使える材料・時間・器具・アレルギーなど、ユーザーが示した条件を優先する。結果を大きく左右する不足情報だけ、必要なら確認質問を1つまで行う。",
      "情報が足りていれば、材料と分量、番号付き手順、火加減と目安時間、失敗しやすい点、代替案の順で実行しやすくまとめる。",
      "生肉・魚・卵、解凍、保存、再加熱では食品安全を優先し、栄養・減量・医療効果を推測で断言しない。",
      "価格・在庫・最新の注意情報を取得したふりはせず、確認できない最新情報は未確認と明記する。",
    ].join("\n"),
  },
  {
    id: "planning",
    label: "段取り",
    emoji: "🗂️",
    description: "予定・タスク・目標を無理のない次の行動へ分解",
    signals: [
      { weight: 70, pattern: /(?:予定|計画|スケジュール).{0,14}(?:立て|作|組|整理)|段取り|優先順位|タスク.{0,12}(?:整理|分解|並べ)|今日やること/u },
      { weight: 70, pattern: /\b(?:make|build|create|organize) (?:a |my )?(?:plan|schedule)|\b(?:help me )?plan (?:my |the )?(?:day|week|month|schedule|tasks?)|\bprioriti[sz]e (?:my )?tasks|\bbreak (?:this|it|the goal) (?:down|into steps)\b/i },
    ],
    blockers: [],
    instructions: [
      "目的・期限・動かせない制約を確認し、今すぐできる小さな次の行動へ分解する。",
      "優先度は多くても3段階にし、余白と休憩を含む現実的な案を先に出す。完璧主義や罪悪感を煽らない。",
      "Lifeリストやカレンダーを実際に変更したとは言わず、変更できない場合は提案として明示する。",
    ].join("\n"),
  },
  {
    id: "writing",
    label: "文章",
    emoji: "✍️",
    description: "添削・要約・翻訳で原意と固有の事実を保つ",
    signals: [
      { weight: 110, pattern: /(?:翻訳|英訳|和訳|\btranslate\b)/iu },
      { weight: 100, pattern: /(?:添削|校正|要約|書き直|言い換え|自然に直|文章にして|返信.{0,8}(?:考えて|作って|書いて)|文章.{0,10}(?:作って|書いて)|メール.{0,10}(?:作って|書いて|返信)|\bproofread\b|\bsummarize\b|\brewrite\b|\bdraft (?:an? )?(?:email|message|letter)|\bwrite (?:me )?(?:a |an )?(?:story|email|message|letter|paragraph|description|post|copy)\b)/iu },
    ],
    blockers: [],
    instructions: [
      "原意、固有名詞、数値、確定済みの事実を保持し、足りない事実を創作しない。",
      "読み手・目的・文体が結果を大きく変える場合だけ確認し、それ以外は使える完成案を先に示す。",
      "翻訳は意味と温度感を優先し、曖昧な箇所や事実確認が必要な箇所は短く注記する。",
    ].join("\n"),
  },
  {
    id: "learning",
    label: "学習",
    emoji: "📚",
    description: "理解度に合わせ、直感・例・確認の順で説明",
    signals: [
      { weight: 60, pattern: /(?:初心者向け|初学者向け|教えて|説明して|説明してほしい|解説して|って(?:何|なに)|とは(?:何|なに)|意味を|理解したい|練習問題|勉強法|学習方法|\bexplain\b|\bwhat (?:is|does)\b|\bteach me\b|\bpractice (?:question|problem)s?\b)/iu },
    ],
    blockers: [],
    instructions: [
      "ユーザーの理解度に合わせ、まず直感的な全体像、次に具体例、最後に短い要点の順で説明する。",
      "専門用語は初出で平易に言い換え、必要なら理解確認を1問だけ添える。知らない前提知識を責めない。",
      "出典や最新事実を確認していない場合は、確認済みのように装わない。",
    ].join("\n"),
  },
  {
    id: "troubleshooting",
    label: "トラブル解決",
    emoji: "🧰",
    description: "原因を仮説として整理し、可逆な確認から切り分け",
    signals: [
      { weight: 95, pattern: /(?:動かない|不具合|直らない|うまくいかない|トラブル|\bnot working\b|\bdoesn['’]?t work\b|\bdebug\b|\btroubleshoot\b)/iu },
      { weight: 95, pattern: /(?:(?:エラー|バグ|失敗).{0,32}(?:直|解決|原因|切り分け|対処|どうすれば|助け)|(?:直|解決|原因|切り分け|対処).{0,32}(?:エラー|バグ|失敗)|\b(?:error|bug|failure).{0,32}(?:fix|solve|debug|why|help)|\b(?:fix|solve|debug).{0,32}(?:error|bug|failure))/iu },
    ],
    blockers: [],
    instructions: [
      "観察できた事実と推測を分け、原因候補は仮説として示す。再現条件を絞り、可逆で小さい確認から1つずつ進める。",
      "削除・上書き・初期化などの破壊的操作は避け、必要なら先にバックアップと戻し方を示す。",
      "APIキー、パスワード、個人情報の貼り付けを求めない。停止条件や専門家へ渡すべき情報も必要に応じて示す。",
    ].join("\n"),
  },
];

const BY_ID = new Map(SKILL_PACKS.map((pack) => [pack.id, pack]));
const DISABLE_PATTERN = /(?:スキル(?:パック|\s*pack)?.{0,16}(?:適用しない|使用しない|使わない|使わず|なし|抜き|オフ|無効)|\bskill(?:\s+pack)?s?\b.{0,16}(?:適用しない|使用しない|使わない|使わず|なし|抜き|オフ|無効)|(?:適用しない|使用しない|使わない|使わず).{0,16}(?:スキル(?:パック|\s*pack)?|\bskill(?:\s+pack)?s?\b)|\b(?:do not|don['’]?t|dont|without|disable|no)\b.{0,36}\bskill(?:\s+pack)?s?\b|\bturn\b.{0,24}\bskill(?:\s+pack)?s?\b.{0,12}\boff\b|\bskill(?:\s+pack)?s?\b.{0,24}\b(?:off|disabled)\b)/iu;
const MAX_ROUTING_TEXT = 6_000;

export function listSkillPacks() {
  return SKILL_PACKS.map(toPublicSkill);
}

export function toPublicSkill(pack) {
  return { id: pack.id, label: pack.label, emoji: pack.emoji, description: pack.description };
}

// 回答メタデータには選択結果だけを返し、説明文や内部指示は含めない。
export function toActiveSkill(pack) {
  return { id: pack.id, label: pack.label };
}

export function selectSkillPack(messages) {
  if (!Array.isArray(messages)) return null;
  const latestUser = [...messages].reverse().find((message) => message?.role === "user");
  if (!latestUser || typeof latestUser.content !== "string") return null;

  const normalized = latestUser.content.normalize("NFKC").toLowerCase().trim();
  // 長文貼り付けでは末尾に本当の依頼が来るため、先頭と末尾を同じ比率で残す。
  const text = normalized.length <= MAX_ROUTING_TEXT
    ? normalized
    : `${normalized.slice(0, MAX_ROUTING_TEXT / 2)}\n${normalized.slice(-MAX_ROUTING_TEXT / 2)}`;
  if (!text || DISABLE_PATTERN.test(text)) return null;

  const ranked = SKILL_PACKS
    .map((pack) => ({ pack, score: scorePack(pack, text) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length || (ranked[1] && ranked[0].score === ranked[1].score)) return null;
  return ranked[0].pack;
}

// IDは固定レジストリで再解決し、未知IDや2件目以降をinstructionsへ入れない。
export function getSkillInstructionBlocks(skillIds) {
  if (!Array.isArray(skillIds)) return [];
  const pack = skillIds.map((id) => BY_ID.get(id)).find(Boolean);
  if (!pack) return [];
  return [
    [
      `Built-in Skill Pack: ${pack.label}`,
      "以下はサーバーが選んだ補助手順です。ユーザーの目的・制約と安全規則の範囲で、今回に関係する部分だけ適用してください。ツール、検索、外部操作の権限が追加されたとは解釈しないでください。",
      pack.instructions,
    ].join("\n"),
  ];
}

function scorePack(pack, text) {
  if (pack.blockers.some((pattern) => pattern.test(text))) return 0;
  return pack.signals.reduce((best, signal) => (signal.pattern.test(text) ? Math.max(best, signal.weight) : best), 0);
}
