/**
 * tools/test_store.js —— 本地存储逻辑测试
 *
 * 【为什么要单独测】
 * store.js 是整个 App 里唯一直接读写用户数据的地方。
 * 这里出 bug 的后果特别严重：
 *   - 进度没存上 → 用户刷了两小时一关就没了 → 卸载
 *   - 错题本乱跳 → 用户不信任这个产品
 *   - 倒计时算错 → 白跑一趟考场
 * 这些都是"一测到底"的问题，必须写测试。
 *
 * 【怎么解决 wx 不存在的问题】
 * 小程序代码里 wx 是全局对象，Node 里没有。
 * 我们在跑测试前造一个最小可用的假 wx，数据存在内存对象里，
 * 行为对齐真实的 Storage（存的是字符串）。
 *
 * 跑法：node tools/test_store.js
 */

// ===== 造一个假的 wx 环境 =====
const _mem = {};
global.wx = {
  setStorageSync(key, val) { _mem[key] = val; },
  getStorageSync(key) { return _mem[key] === undefined ? '' : _mem[key]; },
  removeStorageSync(key) { delete _mem[key]; },
  clearStorageSync() { Object.keys(_mem).forEach(k => delete _mem[k]); },
  showToast(opts) { /* 测试里不弹窗 */ }
};

const path = require('path');
const store = require(path.join(__dirname, '..', 'miniprogram', 'core', 'store.js'));
const config = require(path.join(__dirname, '..', 'miniprogram', 'config', 'index.js'));

let pass = 0, fail = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else {
    fail++; failures.push(name);
    console.log('  FAIL  ' + name);
    console.log('        实际: ' + JSON.stringify(actual));
    console.log('        期望: ' + JSON.stringify(expected));
  }
}
function checkTrue(name, cond) { check(name, !!cond, true); }

const Q = (id, type) => ({ id: id, type: type || 'single', module: 'career' });

console.log('\n=== 1. 作答进度 ===');
store.clearAll();
check('初始进度为空', store.getProgress(), {});

store.saveProgress(Q('q1'), { correct: true, score: 100 });
check('记录已保存', !!store.getProgress().q1, true);
check('记录标记为正确', store.getProgress().q1.correct, true);
check('记录含时间戳', typeof store.getProgress().q1.ts, 'number');

// 重复做同一题应该覆盖而不是新增
store.saveProgress(Q('q1'), { correct: false, score: 0 });
check('重复做覆盖而非新增', Object.keys(store.getProgress()).length, 1);
check('覆盖后为错误', store.getProgress().q1.correct, false);

console.log('\n=== 2. 错题本进出规则 ===');
store.clearAll();
store.saveProgress(Q('w1'), { correct: false, score: 0 });
check('做错自动进错题本', store.getWrongBook(), ['w1']);

// 重复做错不应重复添加
store.saveProgress(Q('w1'), { correct: false, score: 0 });
check('重复做错不重复添加', store.getWrongBook(), ['w1']);

// 做对了应该移出
store.saveProgress(Q('w1'), { correct: true, score: 100 });
check('做对后移出错题本', store.getWrongBook(), []);

// 第一次就做对，不该进错题本
store.saveProgress(Q('w2'), { correct: true, score: 100 });
check('首次做对不进错题本', store.getWrongBook(), []);

// 错 → 对 → 再错，应该能重新进
store.saveProgress(Q('w3'), { correct: false, score: 0 });
store.saveProgress(Q('w3'), { correct: true, score: 100 });
store.saveProgress(Q('w3'), { correct: false, score: 0 });
check('错对错后重新进错题本', store.getWrongBook(), ['w3']);

// 未做过的题做错
store.saveProgress(Q('w4'), { correct: false, score: 0 });
store.saveProgress(Q('w5'), { correct: false, score: 0 });
check('多道错题都收录', store.getWrongBook().length, 3);

check('清空错题本', store.clearWrongBook(), []);
check('清空后仍为空', store.getWrongBook(), []);

console.log('\n=== 3. 每日统计 ===');
store.clearAll();
check('今日初始 0 题', store.getTodayCount(), 0);
store.saveProgress(Q('d1', 'single'), { correct: true, score: 100 });
store.saveProgress(Q('d2', 'single'), { correct: true, score: 100 });
store.saveProgress(Q('d3', 'material'), { correct: false, score: 20 });
check('今日累计 3 题', store.getTodayCount(), 3);

const days = store.getRecentDays(7);
check('返回 7 天', days.length, 7);
// 按日期升序，最后一天是今天
check('最后一天是今天', days[6].date, store.todayKey());
check('今天计数正确', days[6].count, 3);
check('其余日期为 0', days[0].count, 0);

check('连续打卡 1 天', store.getStreakDays(), 1);

console.log('\n=== 4. 考试倒计时 ===');
const oneDay = 24 * 60 * 60 * 1000;
const now = Date.now();

// 造一场 10 天后的考试
const future = new Date(Date.now() + 10 * oneDay);
const y = future.getFullYear();
const m = String(future.getMonth() + 1).padStart(2, '0');
const d = String(future.getDate()).padStart(2, '0');
const dates = {
  written: [{ key: 'test1', name: '测试场次', written: `${y}-${m}-${d}`, interview: '2026-05-01' }],
  signupLeadDays: 30,
  signupEndLeadDays: 15
};

let info = store.buildExamInfo(dates, Date.now());
check('自动选中最近场次', info.key, 'test1');
check('倒计时天数正确', info.days, 10);
check('未过期', info.isPassed, false);
// 10 天 ≤ signupEndLeadDays(15)，处于报名截止前的"报名中"阶段
check('临近报名截止状态为 signing', info.stage, 'signing');

// 距考试 30 天以上才是"开放报名"
const far = new Date(Date.now() + 40 * oneDay);
const fy = far.getFullYear();
const fm = String(far.getMonth() + 1).padStart(2, '0');
const fd = String(far.getDate()).padStart(2, '0');
info = store.buildExamInfo({
  written: [{ key: 'far', name: '远期', written: `${fy}-${fm}-${fd}`, interview: '2026-05-01' }],
  signupEndLeadDays: 15
}, Date.now());
check('距考试40天状态为 open', info.stage, 'open');
check('距考试40天倒计时正确', info.days, 40);

// 指定场次
const dates2 = {
  written: [
    { key: 'far1', name: '远期场次', written: '2099-01-01', interview: '2099-03-01' },
    { key: 'test1', name: '测试场次', written: `${y}-${m}-${d}`, interview: '2026-05-01' }
  ]
};
info = store.buildExamInfo(dates2, Date.now(), 'far1');
check('按用户选择取场次', info.key, 'far1');

// 用户选的已过期 → 自动降级到最近未过期场次
const past = new Date(Date.now() - 5 * oneDay);
const py = past.getFullYear();
const pm = String(past.getMonth() + 1).padStart(2, '0');
const pd = String(past.getDate()).padStart(2, '0');
const dates3 = {
  written: [
    { key: 'past1', name: '已过期', written: `${py}-${pm}-${pd}`, interview: '2020-05-01' },
    { key: 'test1', name: '测试场次', written: `${y}-${m}-${d}`, interview: '2026-05-01' }
  ]
};
info = store.buildExamInfo(dates3, Date.now(), 'past1');
check('已过期场次自动降级', info.key, 'test1');

// 报名后期状态应为 signing
const soon = new Date(Date.now() + 5 * oneDay);
const sy = soon.getFullYear();
const sm = String(soon.getMonth() + 1).padStart(2, '0');
const sd = String(soon.getDate()).padStart(2, '0');
info = store.buildExamInfo({
  written: [{ key: 'soon', name: '临近', written: `${sy}-${sm}-${sd}`, interview: '2026-05-01' }],
  signupEndLeadDays: 15
}, Date.now());
check('临近考试状态为报名中', info.stage, 'signing');

// 全部过期
info = store.buildExamInfo({
  written: [{ key: 'old', name: '已过期', written: '2000-01-01', interview: '2000-03-01' }]
}, Date.now());
check('全部过期时标记 closed', info.stage, 'closed');
check('全部过期时 isPassed', info.isPassed, true);

// 无配置不崩
check('无考试配置不崩溃', store.buildExamInfo({}, Date.now()).available, false);
check('空数组不崩溃', store.buildExamInfo({ written: [] }, Date.now()).available, false);

/**
 * 【新增】official 标记：官方没公布日期的场次，必须能被识别出来。
 *
 * 【为什么必须测】这是防止"把估算日期当官方日期骗用户"的护栏。
 * 假如以后有人改config 时把 official:false 漏掉了，
 * 界面上"暂估"标签和提示条就都不显示了，测试能立刻抓到。
 */
console.log('\n=== 4.1 日期是否为官方确认 ===');
info = store.buildExamInfo({
  written: [{ key: 'est', name: '估算场次', written: `${y}-${m}-${d}`, official: false }]
}, Date.now());
check('official 为 false 时透传 false', info.official, false);

info = store.buildExamInfo({
  written: [{ key: 'conf', name: '官方场次', written: `${y}-${m}-${d}`, official: true }]
}, Date.now());
check('official 为 true 时透传 true', info.official, true);

// 老配置根本没写 official 字段 → 按已确认处理，避免历史数据显示成未知
info = store.buildExamInfo({
  written: [{ key: 'legacy', name: '老配置', written: `${y}-${m}-${d}` }]
}, Date.now());
check('缺省 official 时按 true 处理', info.official, true);

// 真实配置里必须至少有一场未确认的2027 场次（现在还没到公告时间）
const realConf = require('../miniprogram/config/index.js');
const unconfirmed = realConf.examDates.written.filter((d) => d.official === false);
check('真实配置中未公布场次已标为暂估', unconfirmed.length >= 1, true);
const confirmed = realConf.examDates.written.filter((d) => d.official === true);
check('真实配置中已公布场次标为确认', confirmed.length >= 1, true);
// 所有场次的日期字段都不能为空，否则倒计时会算出 NaN
check('所有场次都有笔试日期', realConf.examDates.written.every((d) => !!d.written), true);

console.log('\n=== 5. 用户设置 ===');
store.clearAll();
const s = store.getSettings();
check('默认科目为 1', s.lastSubject, 1);
check('默认每组 20 题', s.groupSize, 20);
store.saveSettings({ groupSize: 30 });
check('设置已更新', store.getSettings().groupSize, 30);
check('未改动的设置保留', store.getSettings().lastSubject, 1);

console.log('\n=== 6. 云端同步队列 ===');
store.clearAll();
store.saveProgress(Q('s1', 'single'), { correct: true, score: 100 });
check('答题产生 1 条待同步', store.takeSyncQueue().length, 1);
check('取出后队列清空', store.takeSyncQueue().length, 0);

// 队列上限保护
store.clearAll();
for (let i = 0; i < 250; i++) store.queueSync({ qid: 'x' + i });
check('队列不超过 200', store.takeSyncQueue().length, 200);

console.log('\n=== 7. 损坏数据容错 ===');
// 模拟数据被截断：直接塞非法 JSON
const keys = require(path.join(__dirname, '..', 'miniprogram', 'config', 'index.js')).storageKeys;
global.wx.setStorageSync(keys.progress, '{坏掉的JSON');
check('损坏的进度数据降级为空', store.getProgress(), {});
check('损坏数据不影响写新数据', (function () {
  store.saveProgress(Q('ok1'), { correct: true, score: 100 });
  return store.getProgress().ok1.correct;
})(), true);

// 错题本存成了对象而非数组
global.wx.setStorageSync(keys.wrongBook, JSON.stringify({ bad: true }));
check('非数组错题本降级为空数组', store.getWrongBook(), []);

console.log('\n=== 8. 清空数据 ===');
store.clearAll();
store.saveProgress(Q('c1'), { correct: true, score: 100 });
check('清空前有数据', Object.keys(store.getProgress()).length, 1);
check('清空成功', store.clearAll(), true);
check('清空后无数据', store.getProgress(), {});
check('清空后错题本也清空', store.getWrongBook(), []);
check('清空后今日计数归零', store.getTodayCount(), 0);

console.log('\n' + '='.repeat(46));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail > 0) {
  console.log('失败：' + failures.join(', '));
  process.exit(1);
}
console.log('全部通过。');
process.exit(0);