/**
 * core/grade.js —— 判分引擎
 *
 * 【本项目最值得你讲清楚的技术点】
 *
 * 问题：材料分析题、写作题没有标准选项，怎么判分？
 *
 * 常见做法有三种，我们用的是第 3 种：
 *   方案 1 只显示参考答案，不判分 —— 用户不知道自己答得对不对，价值大打折扣
 *   方案 2 用固定模板匹配 —— 只认某几句标准答案表述，灵活改写就误判
 *   方案 3 【评分点命中匹配】（本项目采用）
 *        事先把参考答案拆成若干"评分点"（points 数组）。
 *        学生作答后，把答案切成词组，和每个评分点做命中率计算，
 *        命中比例越高则得分越多，再换算成分数。
 *
 * 方案 3 的优点：
 *   - 完全离线，不花钱、不审核风险、毫秒出结果
 *   - 学生用不同措辞表达也能被判到分，比死记硬背答案友好
 *   - 代码里预留了 AI 接口 gradeByAI()，以后想上大模型只改配置不改流程
 *
 * 【局限要说清楚】这是"关键词命中率"而非真正的语义理解。
 * 写得通顺但完全跑题的答案可能被误判得高分。所以 UI 上我们
 * 明确写"参考得分"，并把评分点逐条展示给学生看，让他自己判断。
 * 这一点在面试里主动说出来，比被面试官问出来好得多。
 */

const config = require('../config/index.js');

/**
 * 停用词：中文里高频但对判分没意义的虚词
 *
 * 【踩坑记录】最初这里错误地把"学生""教师""老师"也放进来了，
 * 结果把教资答题里最核心的主语删干净了——学生写"教师是学生学习的引导者"
 * 明明踩了评分点，却判成未提及。
 * 教资答题里"教师""学生""教学""教育"恰恰是评分点主体，必须保留。
 * 只过滤纯虚词和常见口头语。
 */
const STOP_WORDS = [
  '的', '了', '是', '在', '和', '与', '及', '也', '就', '都', '而',
  '被', '把', '对', '从', '到', '为', '以', '于', '其', '之', '并',
  '因为', '所以', '如果', '那么', '这个', '那个', '一些', '可以', '应该',
  '需要', '通过', '进行', '能够', '以及', '我们', '我认为', '我认为的'
];

/** 主观题按评分点命中比例折算，命中多少比例算满分 */
const HIT_FULL_RATIO = 0.6;

/** 片段长度默认值 */
const FRAGMENT_LEN = 3;

/** 文本短于此长度时，把片段长度下调，保证短文本也能被匹配 */
const MIN_FRAGMENT_LEN = 2;

/** 片段覆盖率超过这个比例算命中 */
const HIT_THRESHOLD = 0.5;

/**
 * 根据文本长度决定用几个字的片段
 *
 * 【踩坑记录 · 第二个坑】
 * 固定 3 字片段有个致命问题：文本比 3 字短就一个片段都产不出来。
 * 学生答"教师是引路人"只有 6 字，答案是 6 字，片段集合全空 → 恒判 0 分。
 * 而"只写了半句"恰恰是主观题最常见的真实场景，不能判死。
 *
 * 修正：按长度自适应。短文本用 2 字片段（能产出），长文本仍用 3 字（更精确）。
 * 两边都调用同一个函数，所以切法永远一致。
 *
 * @param {string} text
 * @returns {number} 片段长度
 */
function fragmentLenOf(text) {
  const len = String(text || '').length;
  if (len < FRAGMENT_LEN) return Math.max(MIN_FRAGMENT_LEN, len);
  return FRAGMENT_LEN;
}

/**
 * 把一段文本切成用于匹配的片段
 *
 * 【踩坑记录 · 重要】这个函数返工过一次，务必看懂为什么这么设计。
 *
 * 第一版按 /[一-龥]{2,10}/g 切词块，问题在于它切的是"连续 2-10 个汉字"，
 * 而中文的语义词长并不固定：
 *   输入"学生学习的引导者和促进者"（10 字，刚好等于上限）
 *   → 切出 ["学生学习的引导者和促进者"]
 *   → 再用停用词从中间删字 → ["学习引导促", "进者"]
 *   "进者"这种碎片，压根不在任何评分点里出现，命中率直接归零。
 * 更糟的是删字后还可能造出原句里根本不存在的组合，导致误判。
 *
 * 修正后的思路：不猜词边界，直接生成"滑动片段"。
 *   文本每个位置向后取 N 个字，作为候选片段。
 *   "引导者"、"促进者"、"的学习" 都能原样出现在片段集合里，
 *   而"进者"这种跨词边界的碎片也不会造成漏判——
 *   因为匹配的双方（评分点、答案）用的是完全相同的切法，比较的是同一套片段。
 *
 * 一致性是关键：两边用同一个长度规则，自然就能对上。
 *
 * @param {string} text 用户作答文本
 * @returns {Array<string>} 片段数组
 */
function extractKeywords(text) {
  if (!text) return [];

  const raw = String(text);
  const FL = fragmentLenOf(raw);
  const fragments = [];

  for (let i = 0; i + FL <= raw.length; i++) {
    const frag = raw.slice(i, i + FL);
    // 片段里全是标点/空格/拉丁字母数字的没有判别力，跳过
    if (!/[一-龥]/.test(frag)) continue;
    fragments.push(frag);
  }

  return fragments;
}

/**
 * 计算某个评分点被用户答案命中的比例（0 ~ 1）
 *
 * 命中判定用的是"字符覆盖率"，而不是数关键词个数：
 *   评分点 "教师是学生学习的引导者" 共 12 字，
 *   用户答案里出现了其中 9 个连续字，覆盖率 75%，就算命中。
 *
 * 为什么要用连续片段？
 *   因为国语习惯是语序固定，"引导者"三个字连着出现，
 *   比孤立地出现"引导""生"更有说服力，能减少误判。
 *
 * @param {string} point 评分点文本
 * @param {Array<string>} userKeywords 用户答案的关键词
 * @returns {number} 0 ~ 1 的命中比例
 */
function calcPointHit(point, userKeywords, pointFragLen) {
  if (!point || !userKeywords.length) return 0;

  const pointText = String(point);

  // 评分点自己按同一规则生成片段集合
  const FL = pointFragLen || fragmentLenOf(pointText);
  const fragments = [];
  for (let i = 0; i + FL <= pointText.length; i++) {
    const frag = pointText.slice(i, i + FL);
    if (!/[一-龥]/.test(frag)) continue;
    fragments.push(frag);
  }

  if (!fragments.length) return 0;

  // 命中数
  let hitCount = 0;
  fragments.forEach((frag) => {
    if (userKeywords.indexOf(frag) !== -1) {
      hitCount++;
    }
  });

  const ratio = hitCount / fragments.length;
  return ratio >= HIT_THRESHOLD ? ratio : ratio * 0.5;
}

/**
 * 判主观题（材料分析题 / 写作题）
 *
 * @param {Object} question 题目对象，需含 points 数组
 * @param {string} userAnswer 用户作答文本
 * @returns {Object} {
 *   score: 参考得分（0~100）,
 *   hits: 命中数,
 *   total: 评分点总数,
 *   details: [ { point, hit, comment } ]  逐条反馈
 * }
 */
function gradeSubjective(question, userAnswer) {
  const points = question.points || [];
  const answerText = String(userAnswer || '').trim();

  /**
   * 【踩坑记录】原来这里判断的是 answerText.length < 10，
   * 结果学生输入"！！！？？？……"这种纯符号，长度够但一个字没写，照样被判 0 分，
   * 而且还进了错题本——用户会看到一堆自己根本没答过的"错题"。
   * 正确的判空标准是"有没有实义字符"：只要含中文或字母数字，就说明真写了东西。
   */
  const hasRealContent = /[一-龥a-zA-Z0-9]/.test(answerText);

  // 交白卷直接 0 分，别浪费时间计算
  if (!answerText || !hasRealContent) {
    return {
      score: 0,
      hits: 0,
      total: points.length,
      details: points.map((p) => ({
        point: p,
        hit: 0,
        comment: '未作答'
      })),
      tooShort: true
    };
  }

  const userKeywords = extractKeywords(answerText);
  // 评分点片段长度统一按答案长度决定，保证两侧切片一致
  const pointFragLen = fragmentLenOf(answerText);

  const details = [];
  let hitSum = 0;

  points.forEach((point) => {
    const ratio = calcPointHit(point, userKeywords, pointFragLen);
    hitSum += ratio;
    // 命中比例 ≥60% 视为该评分点答到
    const hit = ratio >= HIT_FULL_RATIO ? 1 : (ratio > 0 ? 0.5 : 0);
    details.push({
      point: point,
      hit: hit,
      comment: hit === 1 ? '已答到' : (hit === 0.5 ? '部分相关' : '未提及')
    });
  });

  // 总分 = 平均命中率 × 100
  const score = points.length
    ? Math.round((hitSum / points.length) * 100)
    : 0;

  return {
    score: score,
    hits: details.filter((d) => d.hit === 1).length,
    total: points.length,
    details: details
  };
}

/**
 * 判客观题（单选 / 判断）
 *
 * @param {Object} question
 * @param {Array<string>} userAnswer 用户选的选项，如 ['B']
 * @returns {Object} { correct, score, rightAnswer }
 */
function gradeObjective(question, userAnswer) {
  const right = question.answer || [];
  const mine = userAnswer || [];

  // 逐个比较：长度必须一致，且每一位都要相同
  const correct = right.length === mine.length &&
    right.every((a, i) => a === mine[i]);

  return {
    correct: correct,
    score: correct ? 100 : 0,
    rightAnswer: right
  };
}

/**
 * 统一判分入口
 *
 * 【为什么要有统一入口】
 * 以后如果接入 AI 批改，只要改 gradeByAI 的调用条件，
 * 页面上的代码一行都不用动。这是"面向接口编程"的好处。
 *
 * @param {Object} question
 * @param {string|Array<string>} userAnswer
 * @returns {Object} 统一格式的判分结果
 */
function grade(question, userAnswer) {
  if (question.type === 'single' || question.type === 'judge') {
    const r = gradeObjective(question, userAnswer);
    return {
      type: 'objective',
      correct: r.correct,
      score: r.score,
      rightAnswer: r.rightAnswer,
      userAnswer: userAnswer,
      details: [],
      aiScored: false
    };
  }

  const r = gradeSubjective(question, userAnswer);
  return {
    type: 'subjective',
    // 主观题约定：60 分及格
    correct: r.score >= 60,
    score: r.score,
    details: r.details,
    tooShort: !!r.tooShort,
    aiScored: false
  };
}

/**
 * 【预留接口】AI 批改
 *
 * 【为什么现在不接】
 * 1. 微信小程序审核对调用外部 AI 接口管得较严，个人主体有被拒风险
 * 2. 每次调用都要花钱，你 500 UV 之前没有收入，ROI 为负
 * 3. 关键词命中率已经能给出可用的参考分，不接也不影响留存
 *
 * 【以后怎么接】
 * 等你小程序上了规模、有收入了，再做这三件事：
 *   1. 在开发者工具里开通「云开发」，新建云函数 gradeByAI
 *   2. 在云函数里调用大模型（混元 / DeepSeek / 智谱都行），写好 Prompt：
 *      "你是教资阅卷老师，下面是评分标准和学生答案，
 *       按评分点逐条判断并给出 0-2 分，返回 JSON"
 *   3. 把下面 enableAI 改成 true
 * 代码结构已经留好了，届时切换只改 config，不动页面。
 *
 * @param {Object} question
 * @param {string} userAnswer
 * @param {Function} cloudCall 调云函数的函数，由调用方注入，方便测试时替换
 * @returns {Promise<Object>} 与 grade() 相同结构的 Promise
 */
function gradeByAI(question, userAnswer, cloudCall) {
  return cloudCall({
    name: 'gradeByAI',
    data: {
      questionId: question.id,
      subject: question.subject,
      type: question.type,
      points: question.points,
      referenceAnswer: question.explain,
      userAnswer: userAnswer
    }
  }).then((res) => {
    const ai = (res && res.result) || {};

    // AI 返回的评分点明细，用它覆盖本地算出来的
    const local = gradeSubjective(question, userAnswer);
    return {
      type: 'subjective',
      correct: (ai.score || 0) >= 60,
      score: ai.score || local.score,
      details: (ai.details && ai.details.length)
        ? ai.details
        : local.details,
      aiComment: ai.comment || '',
      aiScored: true
    };
  });
}

/**
 * 是否启用 AI 判分
 * 现在是 false。改成 true 前请先确保云函数已部署并能正常返回。
 */
function isAIEnabled() {
  return !!config.aiGrade && config.aiGrade.enabled;
}

module.exports = {
  grade,
  gradeObjective,
  gradeSubjective,
  gradeByAI,
  isAIEnabled,
  extractKeywords,
  calcPointHit,
  // 导出常量，方便测试和文档说明
  STOP_WORDS
};