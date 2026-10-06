/**
 * tools/test_grade.js —— 判分逻辑测试脚本
 *
 * 【为什么需要这个文件】
 * 判分代码写错了，页面上不会报错，只会静默地"判错题"——
 * 正确率显示 20%、错题本乱成一团，但你很难定位是哪里出了问题。
 * 所以逻辑部分必须能在本地跑测试，改完立刻验证。
 *
 * 【怎么跑】
 * node tools/test_grade.js
 *
 * 【这些测试用例对应的真实风险】
 * - 客观题判错 → 用户做的题全部显示错误
 * - 主观题给 0 分 → 学生写了字却拿 0 分，直接差评
 * - 主观题给满分 → 白送分，错题本没东西可复习
 * - 空答案不判 0 → 用户不答题也能进错题本
 */

// 注意：grade.js 里 require 了 ../config/index.js，
// config 里没有 wx.* 调用，所以可以直接在 Node 里跑，不用模拟小程序环境。
const path = require('path');
const grade = require(path.join(__dirname, '..', 'miniprogram', 'core', 'grade.js'));

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    failures.push({ name: name, actual: actual, expected: expected });
    console.log('  FAIL  ' + name);
    console.log('        实际: ' + JSON.stringify(actual));
    console.log('        期望: ' + JSON.stringify(expected));
  }
}

console.log('\n=== 1. 客观题判分 ===');

const singleQ = {
  id: 'test-1',
  type: 'single',
  stem: '素质教育的核心是（　）。',
  options: [
    { key: 'A', text: '面向全体学生' },
    { key: 'B', text: '促进学生全面发展' },
    { key: 'C', text: '促进学生个性发展' },
    { key: 'D', text: '以培养创新精神和实践能力为重点' }
  ],
  answer: ['D'],
  explain: '测试用题',
  difficulty: 1
};

check('选对 D 应判正确', grade.grade(singleQ, ['D']).correct, true);
check('选对 D 得分 100', grade.grade(singleQ, ['D']).score, 100);
check('选错 A 应判错误', grade.grade(singleQ, ['A']).correct, false);
check('选错时返回正确答案', grade.grade(singleQ, ['A']).rightAnswer, ['D']);
check('不选答案应判错误', grade.grade(singleQ, []).correct, false);

const judgeQ = {
  id: 'test-2', type: 'judge', stem: '判断题', difficulty: 1,
  options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }],
  answer: ['A'], explain: '测试用题'
};
check('判断题选对', grade.grade(judgeQ, ['A']).correct, true);
check('判断题选错', grade.grade(judgeQ, ['B']).correct, false);

console.log('\n=== 2. 主观题：交白卷 ===');

const materialQ = {
  id: 'test-3',
  type: 'material',
  stem: '材料：小王调整了课堂方式，学生投票支持率上升。',
  options: [],
  answer: ['体现引导者角色'],
  points: [
    '教师是学生学习的引导者和促进者：小王把课堂交给小组讨论',
    '学生是具有独立意义的人：她意识到学生要的是被尊重',
    '教师是教育教学的研究者：她从投票变化中反思自己的教学方式'
  ],
  explain: '测试用题',
  difficulty: 3
};

const emptyResult = grade.grade(materialQ, '');
check('空答案得 0 分', emptyResult.score, 0);
check('空答案标记 tooShort', emptyResult.tooShort, true);
check('空答案仍返回全部评分点', emptyResult.details.length, 3);

// 判空标准已从"长度<10"改为"是否含实义字符"，见 grade.js 踩坑记录
check('6字短答案不再判未作答（已修复短文判死问题）',
  grade.grade(materialQ, '不会写').tooShort, false);
check('6字短答案仍给低分', grade.grade(materialQ, '不会写').score < 60, true);

console.log('\n=== 3. 主观题：踩点作答（核心场景）===');

// 这段答案覆盖了 3 个评分点的主体内容，应得较高分
const goodAnswer =
  '小王的做法体现了教师是学生学习的引导者和促进者，她把课堂交给小组讨论，' +
  '引导学生自主探究。同时体现了学生是具有独立意义的人，' +
  '她意识到学生要的是被尊重。她还从投票变化中反思自己的教学方式，' +
  '体现了教师是教育教学的研究者。';

const goodResult = grade.grade(materialQ, goodAnswer);
console.log('        踩点作答得分: ' + goodResult.score);
check('踩点作答不应为 0 分', goodResult.score > 0, true);
check('踩点作答应判为正确（>=60）', goodResult.correct, true);
check('踩点作答标记为非 AI 评分', goodResult.aiScored, false);

console.log('\n=== 4. 主观题：离题作答 ===');

const offTopicAnswer =
  '我觉得小王这个人挺好的，他人缘不错，办公室里大家都喜欢他，' +
  '他平时还会做饭菜，味道也不错，我们经常一起吃饭聊天。';

const offTopicResult = grade.grade(materialQ, offTopicAnswer);
console.log('        离题作答得分: ' + offTopicResult.score);
check('离题作答不应得高分', offTopicResult.score < 60, true);
check('离题作答判为错误', offTopicResult.correct, false);

console.log('\n=== 5. 主观题：部分作答（半对）===');

const halfAnswer = '小王把课堂交给小组讨论，体现了教师是学生学习的引导者和促进者。';

const halfResult = grade.grade(materialQ, halfAnswer);
console.log('        部分作答得分: ' + halfResult.score);
check('只踩 1 个点应得分低于 60', halfResult.score < 60, true);
check('只踩 1 个点得分应大于 0', halfResult.score > 0, true);
check('评分点明细数量正确', halfResult.details.length, 3);

// 检查明细里应该有已答到和未提及两种状态
const commentSet = halfResult.details.map(function (d) { return d.comment; });
check('明细含"已答到"', commentSet.indexOf('已答到') !== -1, true);
check('明细含"未提及"', commentSet.indexOf('未提及') !== -1, true);

console.log('\n=== 6. 片段提取 ===');

// extractKeywords 现在返回的是 3 字滑动片段，不是词
check('3 字文本产出 1 个片段', grade.extractKeywords('引导者').length, 1);
check('"引导者"原样保留', grade.extractKeywords('引导者')[0], '引导者');
// 8 字文本，3 字片段 → 8-3+1 = 6 个
check('长句产出 N-2 个片段', grade.extractKeywords('学生学习的引导者').length, 6);
check('纯符号不产出片段', grade.extractKeywords('！！！？？？……').length, 0);
check('空文本返回空数组', grade.extractKeywords('').length, 0);
check('null 不报错', grade.extractKeywords(null).length, 0);

// 短文本自适应：2 字文本应产出 1 个 2 字片段，而不是空数组
check('2字文本产出1个片段', grade.extractKeywords('教师').length, 1);
check('2字文本片段内容正确', grade.extractKeywords('教师')[0], '教师');

// 教资答题的核心主语不能被过滤掉（曾因误列为停用词导致全盘误判）
check('保留"教师"', grade.extractKeywords('教师').length, 1);
check('保留"学生"', grade.extractKeywords('学生').length, 1);

console.log('\n=== 7. 边界与容错 ===');

// 题目缺 points 字段时不应崩溃
const noPointsQ = {
  id: 'test-4', type: 'material', stem: '测试',
  options: [], answer: [], explain: '测试', difficulty: 2
};
check('缺 points 不崩溃', grade.grade(noPointsQ, '这是一段测试答案').score, 0);

// 评分点为空的题目
const emptyPointsQ = {
  id: 'test-5', type: 'material', stem: '测试',
  options: [], answer: [], points: [], explain: '测试', difficulty: 2
};
check('空 points 不崩溃', grade.grade(emptyPointsQ, '这是一段测试答案内容').score, 0);

// 超长文本不崩溃
const hugeAnswer = new Array(3000).join('教师是学生学习的引导者和促进者');
check('超长文本不崩溃', grade.grade(materialQ, hugeAnswer).score >= 0, true);

// 纯符号不含实义字符，按新规则（看是否含实义字符，而非长度）
// 应判为"未作答"，这正是修复的 bug：原来长度够就当成作答过了
check('纯符号判为未作答', grade.grade(materialQ, '！！！？？？……').tooShort, true);
check('纯符号得 0 分', grade.grade(materialQ, '！！！？？？……').score, 0);

// AI 开关当前应为关闭
check('AI 判分当前关闭', grade.isAIEnabled(), false);

console.log('\n=== 8. 用真实题库跑一遍回归 ===');

const bank = require(path.join(__dirname, '..', 'miniprogram', 'core', 'bank.js'));
const subjects = bank.getSubjects();
console.log('        科目数: ' + subjects.length);
subjects.forEach(function (s) {
  const st = bank.getStats({}, s.subject);
  console.log('        ' + s.shortTitle + ' ' + s.title +
    '：' + st.total + ' 题，' + s.moduleCount + ' 个模块');
  if (st.total !== s.questionCount) {
    check(s.shortTitle + ' 题数一致', st.total, s.questionCount);
  }
});

// 逐题跑判分，确保真实题库里没有畸形数据
let graded = 0;
let broken = 0;
subjects.forEach(function (s) {
  const detail = bank.getSubject(s.subject);
  detail.questions.forEach(function (q) {
    let r;
    if (q.type === 'single' || q.type === 'judge') {
      // 用标准答案去判，必须 100 分
      r = grade.grade(q, q.answer);
      if (r.score !== 100) {
        broken++;
        console.log('        !! ' + q.id + ' 用标准答案判分未得满分');
      }
    } else {
      // 主观题用 explain 拼答案，至少不能崩溃
      r = grade.grade(q, q.explain);
      if (typeof r.score !== 'number') {
        broken++;
        console.log('        !! ' + q.id + ' 判分返回值异常');
      }
    }
    graded++;
  });
});
check('真实题库标准答案判分无异常', broken, 0);
console.log('        共判分 ' + graded + ' 题');

console.log('\n--- 抽题功能 ---');
const picked = bank.pickQuestions({ subject: 1, count: 10 });
check('抽题数量正确', picked.length, 10);
check('抽题无重复', new Set(picked.map(function (q) { return q.id; })).size, 10);

const byModule = bank.pickQuestions({ subject: 1, module: 'career', count: 5 });
check('按模块抽题生效', byModule.every(function (q) { return q.module === 'career'; }), true);

// career 模块共 9 题，顺序模式应按题库顺序全部返回
const careerCount = bank.filterQuestions({ subject: 1, module: 'career' }).length;
const ordered = bank.pickQuestions({ subject: 1, module: 'career', ordered: true, count: 5 });
check('顺序出题取前 N 道', ordered.length, 5);
check('顺序出题第一题是模块首题', ordered[0].module, 'career');

// 顺序模式下的完整顺序应与题库中的顺序一致（不能被打乱）
const careerPool = bank.filterQuestions({ subject: 1, module: 'career' });
check('顺序出题与题库顺序一致',
  ordered.map(function (q) { return q.id; }),
  careerPool.slice(0, 5).map(function (q) { return q.id; }));

const undone = bank.getUndoneQuestions(1, 'career', { [ordered[0].id]: { correct: true } });
check('未做题排除已完成', undone.every(function (q) { return q.id !== ordered[0].id; }), true);

console.log('\n--- 薄弱模块推荐 ---');
check('无数据时返回 null', bank.recommendWeakModule({}), null);

// 构造一个薄弱场景：career 模块做 5 题全错
const careerQs = bank.filterQuestions({ subject: 1, module: 'career' }).slice(0, 5);
const badProgress = {};
careerQs.forEach(function (q) { badProgress[q.id] = { correct: false, ts: Date.now() }; });
const weak = bank.recommendWeakModule(badProgress, 1);
check('能识别出薄弱模块', weak && weak.module, 'career');

// 样本不足的模块不应被推荐
const oneWrong = {};
oneWrong[bank.filterQuestions({ subject: 1, module: 'law' })[0].id] = { correct: false };
check('样本不足的模块不推荐', bank.recommendWeakModule(oneWrong, 1), null);

console.log('\n--- 统计正确率 ---');
const st = bank.getStats(badProgress, 1);
check('正确率算对（0%）', st.accuracy, 0);
check('完成数算对', st.done, 5);
check('分模块统计存在', st.byModule.career.done, 5);

/**
 * 【回归用例】曾经出现过一个很隐蔽的 bug：
 * getStats 循环里已经 result.correct++，函数末尾又 += 了一次分科目正确数，
 * 导致正确数翻倍——只做对 1 道题，总正确率显示 200%。
 * 这类 bug 界面不会报错，只是数字离谱，必须靠测试拦住。
 */
console.log('\n--- 正确率回归测试（防翻倍）---');

// 场景 1：1 道题做对 → 应为 100%，不能是 200%
const oneQ = bank.filterQuestions({ subject: 1 })[0];
const p1 = { [oneQ.id]: { correct: true } };
const st1 = bank.getStats(p1, 1);
check('1题做对 → 正确数=1', st1.correct, 1);
check('1题做对 → 正确率=100%', st1.accuracy, 100);

// 场景 2：2 题 1 对 → 应为 50%
const qs2 = bank.filterQuestions({ subject: 1 }).slice(0, 2);
const p2 = { [qs2[0].id]: { correct: true }, [qs2[1].id]: { correct: false } };
const st2 = bank.getStats(p2, 1);
check('2题1对 → 正确数=1', st2.correct, 1);
check('2题1对 → 正确率=50%', st2.accuracy, 50);

// 场景 3：全对
const p3 = {};
qs2.forEach(function (q) { p3[q.id] = { correct: true }; });
const st3 = bank.getStats(p3, 1);
check('2题全对 → 正确率=100%', st3.accuracy, 100);

// 场景 4：正确率永不超过 100%（这是最重要的断言）
const allQ = bank.filterQuestions({ subject: 1 });
const p4 = {};
allQ.forEach(function (q) { p4[q.id] = { correct: true }; });
const st4 = bank.getStats(p4, 1);
check('全题做对 → 正确率=100%（不能>100）', st4.accuracy, 100);
check('全题做对 → 正确数=题目总数', st4.correct, allQ.length);

// 场景 5：全错 → 0%
const p5 = {};
allQ.forEach(function (q) { p5[q.id] = { correct: false }; });
const st5 = bank.getStats(p5, 1);
check('全错 → 正确率=0%', st5.accuracy, 0);

// 场景 6：跨科目统计（两个科目都要累加，不能只算一个）
const st6 = bank.getStats(p3);
check('跨科目统计正确数正确', st6.correct, st3.correct);
check('跨科目正确率在 0-100 之间', st6.accuracy <= 100 && st6.accuracy >= 0, true);

console.log('\n' + '='.repeat(46));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail > 0) {
  console.log('\n失败明细：');
  failures.forEach(function (f) {
    console.log('  - ' + f.name + '：实际 ' + JSON.stringify(f.actual) +
      '，期望 ' + JSON.stringify(f.expected));
  });
  process.exit(1);
}
console.log('全部通过。');
process.exit(0);