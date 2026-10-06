/**
 * core/bank.js —— 题库引擎
 *
 * 【小白解释】这个文件是"题库管理员"，负责回答四个问题：
 *   1. 有哪些科目？        → getSubjects()
 *   2. 某个科目有哪些模块？ → getModules(subject)
 *   3. 怎么从几道题里随机抽 20 道？ → pickQuestions()
 *   4. 我做了多少题、正确率多少？    → getStats()
 *
 * 【为什么题库直接 require JSON，不走云数据库】
 * 见 data/README.md 的解释：本地读取是毫秒级，弱网也能用。
 *
 * 【扩展题库时改哪里】
 * 新增科目：在 data/ 下建 subject3.json，然后在 SUBJECTS 数组里加一项。
 */

const subject1 = require('../data/subject1.json');
const subject2 = require('../data/subject2.json');

/** 已注册科目表。想加科目只改这里和上面的 require。 */
const SUBJECTS = [subject1, subject2];

// 按科目代号建索引，避免每次遍历数组
const SUBJECT_MAP = {};
SUBJECTS.forEach((s) => {
  SUBJECT_MAP[s.subject] = s;
});

/**
 * 获取所有科目（页面上的科目切换器用）
 * @returns {Array} 科目列表
 */
function getSubjects() {
  return SUBJECTS.map((s) => ({
    subject: s.subject,
    code: s.code,
    title: s.title,
    shortTitle: s.shortTitle,
    moduleCount: s.modules.length,
    questionCount: s.questions.length
  }));
}

/**
 * 获取某个科目详情（含模块列表）
 * @param {number} subject 科目代号，1 或 2
 * @returns {Object|null}
 */
function getSubject(subject) {
  return SUBJECT_MAP[subject] || null;
}

/**
 * 获取某科目的模块列表
 * @param {number} subject 科目代号
 * @returns {Array} 模块数组，没有该科目时返回空数组
 */
function getModules(subject) {
  const s = SUBJECT_MAP[subject];
  return s ? s.modules : [];
}

/**
 * 按条件筛选题目
 *
 * 【重要】这是整个引擎最核心的函数，所有出题场景都走它。
 *
 * @param {Object} opts
 * @param {number} [opts.subject] 科目代号，不传则不限科目
 * @param {string} [opts.module]  模块 key，不传则该科目全部
 * @param {number} [opts.difficulty] 难度 1/2/3，不传则不限
 * @param {Array<string>} [opts.ids]  指定题目 id 列表（错题本重做时用）
 * @param {Array<string>} [opts.excludeIds] 要排除的 id 列表（刷下一组时排除做过的）
 * @returns {Array} 符合条件的题目数组
 */
function filterQuestions(opts) {
  opts = opts || {};

  // 先把要考虑的科目范围确定下来
  let pool = [];
  if (opts.subject) {
    const s = SUBJECT_MAP[opts.subject];
    if (!s) return [];
    pool = s.questions;
  } else {
    pool = SUBJECTS.reduce((acc, s) => acc.concat(s.questions), []);
  }

  return pool.filter((q) => {
    // 按模块筛
    if (opts.module && q.module !== opts.module) return false;
    // 按难度筛
    if (opts.difficulty && q.difficulty !== opts.difficulty) return false;
    // 按 id 白名单筛（错题本重做）
    if (opts.ids && opts.ids.length && opts.ids.indexOf(q.id) === -1) return false;
    // 按 id 黑名单筛
    if (opts.excludeIds && opts.excludeIds.length &&
        opts.excludeIds.indexOf(q.id) !== -1) return false;
    return true;
  });
}

/**
 * 随机抽题（Fisher-Yates 洗牌后取前 N 道）
 *
 * 【小白解释】为什么要自己写洗牌，而不用 Math.random 排序？
 * 因为 Array.sort 的排序函数不是随机数分布均匀的引擎，
 * 自己写洗牌能保证每一道题被抽到的概率完全相同。
 *
 * @param {Array} list 候选题目
 * @param {number} count 要抽多少道
 * @returns {Array} 抽中的题目
 */
function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // 交换两个位置的元素
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * 抽一组题
 * @param {Object} opts 同 filterQuestions，另外支持：
 * @param {number} [opts.count=20] 要抽多少道
 * @param {boolean} [opts.ordered=false] true=按题库顺序（刷章节题用），false=随机
 * @returns {Array}
 */
function pickQuestions(opts) {
  opts = opts || {};
  const count = opts.count || 20;
  let pool = filterQuestions(opts);

  // 按顺序出题：主要用于章节专项练习，做完一遍再乱序
  if (opts.ordered) {
    return pool.slice(0, count);
  }
  // 抽不出足够题目就全给出去，总比白屏好
  return shuffle(pool).slice(0, count);
}

/**
 * 按 id 列表取题（错题本要用，顺序必须和 id 列表一致）
 * @param {Array<string>} ids
 * @returns {Array}
 */
function getQuestionsByIds(ids) {
  if (!ids || !ids.length) return [];
  // 建全量索引，保证跨科目也能查到
  const all = {};
  SUBJECTS.forEach((s) => {
    s.questions.forEach((q) => {
      all[q.id] = q;
    });
  });
  return ids.map((id) => all[id]).filter(Boolean);
}

/**
 * 找出某个模块里用户还没做过的题
 * @param {number} subject
 * @param {string} moduleKey
 * @param {Object} progress 进度对象，key 是题目 id
 * @returns {Array} 未做过的题
 */
function getUndoneQuestions(subject, moduleKey, progress) {
  const pool = filterQuestions({ subject, module: moduleKey });
  return pool.filter((q) => !progress || !progress[q.id]);
}

/**
 * 统计某个科目（或全部）的完成情况
 *
 * 【这个函数的返回值直接喂给「我的」页面的进度条】
 *
 * @param {Object} progress 作答记录，形如 { 's1-001': {correct:true, ts:123} }
 * @param {number} [subject] 不传则统计全部科目
 * @returns {Object} { total, done, correct, accuracy, byModule: {...} }
 */
function getStats(progress, subject) {
  progress = progress || {};
  const subjects = subject ? [SUBJECT_MAP[subject]] : SUBJECTS;
  const result = {
    total: 0,
    done: 0,
    correct: 0,
    accuracy: 0,
    byModule: {}
  };

  subjects.forEach((s) => {
    if (!s) return;
    const subStat = { total: s.questions.length, done: 0, correct: 0 };

    s.questions.forEach((q) => {
      const rec = progress[q.id];
      if (rec) {
        subStat.done++;
        result.done++;
        if (rec.correct) {
          subStat.correct++;
          result.correct++;
        }
      }
    });

    // 分模块统计
    s.modules.forEach((m) => {
      const qs = s.questions.filter((q) => q.module === m.key);
      const done = qs.filter((q) => progress[q.id]).length;
      const correct = qs.filter((q) => progress[q.id] && progress[q.id].correct).length;
      result.byModule[m.key] = {
        name: m.name,
        total: qs.length,
        done: done,
        correct: correct,
        accuracy: done ? Math.round((correct / done) * 100) : 0
      };
    });

    result.total += subStat.total;
    /**
     * 【踩坑记录】这里原来还有一行 result.correct += subStat.correct，
     * 但循环里第 206 行已经 result.correct++ 过一次了，导致正确数被算两遍。
     * 后果：只做对 1 道题，首页总正确率会显示 200%。
     * 分模块的 accuracy 用的是局部变量 subStat/correct，一直是对的，
     * 所以只有全局正确率错——这种 bug 极难从界面上看出来。
     * 修正：删掉重复累加，循环里已经累计过了。
     */
  });

  // 正确率保留一位小数，做除法前先判断分母，避免除以 0 得 NaN
  result.accuracy = result.done ? Math.round((result.correct / result.done) * 1000) / 10 : 0;
  return result;
}

/**
 * 推荐薄弱模块（正确率最低的，做得最多的模块优先）
 *
 * 【小白解释】首页的"推荐练习"用这个。
 * 逻辑很朴素：已经做了 10 道以上、正确率低于 60% 的模块，
 * 说明这块没学扎实，优先让你练。
 *
 * @param {Object} progress
 * @param {number} [subject]
 * @returns {Object|null} { subject, module, name, accuracy }
 */
function recommendWeakModule(progress, subject) {
  const subjects = subject ? [SUBJECT_MAP[subject]] : SUBJECTS;
  let worst = null;

  subjects.forEach((s) => {
    if (!s) return;
    const stats = getStats(progress, s.subject);
    Object.keys(stats.byModule).forEach((key) => {
      const m = stats.byModule[key];
      // 样本太少的模块不推荐，否则「只做了 1 道且做错」会被误判为最薄弱
      if (m.done < 5) return;
      if (m.accuracy >= 60) return;
      if (!worst || m.accuracy < worst.accuracy) {
        worst = {
          subject: s.subject,
          subjectTitle: s.shortTitle,
          module: key,
          name: m.name,
          accuracy: m.accuracy
        };
      }
    });
  });

  return worst;
}

/**
 * 今日推荐：给首页凑够一天的题量
 * 逻辑：优先推荐薄弱模块；没有薄弱模块就随机推
 * @param {Object} progress
 * @param {number} [subject]
 * @param {number} [count=10]
 * @returns {Array} 题目数组
 */
function getDailyPlan(progress, subject, count) {
  count = count || 10;
  const weak = recommendWeakModule(progress, subject);
  if (weak) {
    return pickQuestions({
      subject: weak.subject,
      module: weak.module,
      count: count
    });
  }
  return pickQuestions({ subject: subject, count: count });
}

module.exports = {
  getSubjects,
  getSubject,
  getModules,
  filterQuestions,
  pickQuestions,
  getQuestionsByIds,
  getUndoneQuestions,
  getStats,
  recommendWeakModule,
  getDailyPlan,
  shuffle
};