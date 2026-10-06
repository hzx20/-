/**
 * core/store.js —— 本地数据存储
 *
 * 【小白解释】相当于小程序自己的"笔记本"。
 * 用户每做一题、做对做错、错题有哪些，都存在这里。
 *
 * 【为什么先存本地、以后再同步云端】
 * 1. 即开即用：不用等网络，写完立刻存
 * 2. 不丢数据：用户中途退出，再进来进度还在
 * 3. 省流量：本地读写几乎是零成本
 * 云端只做两件事：统计（方便你在后台看数据）+ 备份。
 * 同步策略是"攒够一批再传"，而不是每做一题就发一次请求——
 * 那样会浪费用户的流量和电池，也容易触发接口限频。
 *
 * 【关键 API】
 * wx.setStorageSync(key, value) —— 写
 * wx.getStorageSync(key)        —— 读
 * wx.removeStorageSync(key)     —— 删
 *
 * 微信规定单个 key 上限 1MB、总上限 10MB，够我们用很多年。
 */

const { storageKeys, examDates } = require('../config/index.js');

/**
 * 安全读取：解析失败时返回兜底值，不让页面崩
 *
 * 【踩坑记录】早期版本直接 JSON.parse(wx.getStorageSync(key))，
 * 某次用户清缓存时数据被截断，解析抛异常，整个"我的"页面白屏。
 * 现在所有读取都走这里，坏数据一律降级成空值。
 */
function readJSON(key, fallback) {
  try {
    const raw = wx.getStorageSync(key);
    if (!raw) return fallback;
    if (typeof raw === 'object') return raw;   // 部分基础库返回的是对象而非字符串
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[store] 读取失败，已重置：' + key, e);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    wx.setStorageSync(key, JSON.stringify(value));
    return true;
  } catch (e) {
    // 存储满是最常见的原因，这时必须让用户知道"进度没存上"
    console.error('[store] 写入失败：' + key, e);
    wx.showToast({
      title: '存储空间已满，进度未保存',
      icon: 'none'
    });
    return false;
  }
}

/* ==================== 作答进度 ==================== */

/**
 * 读取全部作答记录
 * @returns {Object} { '题目id': { correct, ts, type } }
 */
function getProgress() {
  return readJSON(storageKeys.progress, {});
}

/**
 * 保存一条作答记录
 *
 * 【重要设计】同一道题可以反复做，这里保存的是"最新一次"结果。
 * 但错题本不是——错题本只在"第一次做错"时加入，
 * 之后做对了就移出，这样错题本能真正反映"还没掌握"的题。
 *
 * @param {Object} question 题目
 * @param {Object} result 判分结果（含 correct）
 * @returns {Object} 更新后的进度
 */
function saveProgress(question, result) {
  const progress = getProgress();
  const isFirstTime = !progress[question.id];

  progress[question.id] = {
    correct: !!result.correct,
    score: result.score,
    type: question.type,
    ts: Date.now()
  };

  writeJSON(storageKeys.progress, progress);

  // 首次做题或再次做错 → 进错题本；做对且之前做错过 → 移出错题本
  if (!result.correct) {
    addWrong(question.id);
  } else if (!isFirstTime) {
    removeWrong(question.id);
  }

  // 累加今日做题数
  bumpDailyCount(question.subject);

  // 记录一条待同步数据，攒批上传
  queueSync({
    qid: question.id,
    subject: question.subject,
    correct: !!result.correct,
    score: result.score,
    ts: Date.now()
  });

  return progress;
}

/* ==================== 错题本 ==================== */

function getWrongBook() {
  const book = readJSON(storageKeys.wrongBook, []);
  return Array.isArray(book) ? book : [];
}

/**
 * 加入错题本（不重复添加）
 * @param {string} questionId
 */
function addWrong(questionId) {
  const book = getWrongBook();
  if (book.indexOf(questionId) !== -1) return book;
  book.push(questionId);
  writeJSON(storageKeys.wrongBook, book);
  return book;
}

/**
 * 移出错题本（做对了）
 * @param {string} questionId
 */
function removeWrong(questionId) {
  const book = getWrongBook();
  const idx = book.indexOf(questionId);
  if (idx === -1) return book;
  book.splice(idx, 1);
  writeJSON(storageKeys.wrongBook, book);
  return book;
}

/** 清空错题本 */
function clearWrongBook() {
  writeJSON(storageKeys.wrongBook, []);
  return [];
}

/* ==================== 每日做题量 ==================== */

/**
 * 获取今日做题量
 * 用的是"日期字符串"做 key，跨天自然隔离，不需要定时清理。
 * @returns {Object} { '2026-10-06': 20, ... }
 */
function getDailyStats() {
  return readJSON(storageKeys.dailyStats, {});
}

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 今日做题数 +1
 * @param {number} [subject] 科目代号，可不传
 */
function bumpDailyCount(subject) {
  const stats = getDailyStats();
  const key = todayKey();
  const cur = stats[key] || { total: 0, bySubject: {} };
  cur.total = (cur.total || 0) + 1;
  if (subject) {
    cur.bySubject[subject] = (cur.bySubject[subject] || 0) + 1;
  }
  stats[key] = cur;
  writeJSON(storageKeys.dailyStats, stats);
  return cur.total;
}

/**
 * 今日做题数
 * @returns {number}
 */
function getTodayCount() {
  const stats = getDailyStats();
  return (stats[todayKey()] || {}).total || 0;
}

/**
 * 最近 N 天的做题量，用于"数据"页画柱状图
 * @param {number} [days=7]
 * @returns {Array} [{ date, label, count }]，按日期升序
 */
function getRecentDays(days) {
  days = days || 7;
  const stats = getDailyStats();
  const out = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${d.getFullYear()}-${m}-${day}`;
    out.push({
      date: key,
      // 只显示"月/日"，图表空间有限
      label: `${Number(m)}/${Number(day)}`,
      count: (stats[key] || {}).total || 0
    });
  }
  return out;
}

/**
 * 连续打卡天数
 *
 * 【小白解释】今天做了 → 连续天数 +1；
 * 昨天做了但今天没做 → 连续天数归零（不算断签，给用户留一天缓冲）。
 *
 * @returns {number}
 */
function getStreakDays() {
  const stats = getDailyStats();
  let streak = 0;
  const d = new Date();

  for (let i = 0; i < 400; i++) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${d.getFullYear()}-${m}-${day}`;
    if (stats[key] && stats[key].total > 0) {
      streak++;
    } else if (i === 0) {
      // 今天还没做，不算断签，从昨天继续往前数
      d.setDate(d.getDate() - 1);
      continue;
    } else {
      break;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/* ==================== 考试倒计时 ==================== */

/**
 * 计算倒计时
 *
 * 【设计】用户可以选考哪一场笔试（下上半年）。选哪场，
 * 首页就显示哪场的倒计时。
 *
 * @param {Array} dates 考试日期配置
 * @param {number} now 当前时间戳
 * @param {string} [pickedKey] 用户已选的场次，不传则自动选最近的一场
 * @returns {Object} { key, name, days, isPassed, stage }
 */
function buildExamInfo(dates, now, pickedKey) {
  const list = (dates && dates.written) || [];
  const today = now || Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  let target = null;
  const picked = pickedKey ? list.filter((d) => d.key === pickedKey)[0] : null;

  /**
   * 【踩坑记录】原来写成 if (!target) 才去找未过期场次，
   * 结果用户选了某一场、那场考完后再打开小程序，首页会一直显示
   * 一场已经过期的考试，倒计时变成"已结束 xxx 天"，看着很诡异。
   * 修正：用户选的场次如果已过期，同样要降级到最近一场未过期的。
   */
  if (picked) {
    const pickedTime = new Date(picked.written + ' 09:00:00').getTime();
    if (pickedTime >= today) {
      target = picked;
    }
  }

  // 没选、选的已过期 → 自动取最近一场未过期的
  if (!target) {
    target = list.filter((d) => {
      return new Date(d.written + ' 09:00:00').getTime() >= today;
    })[0];
  }
  // 全部过期 → 展示最后一场，标记已结束
  if (!target) {
    target = list[list.length - 1];
  }
  if (!target) {
    return { available: false };
  }

  const writeTime = new Date(target.written + ' 09:00:00').getTime();
  const diff = writeTime - today;
  // 用向上取整，剩 3.2 天显示 4 天，体感更符合"还有几天"
  const days = diff > 0 ? Math.ceil(diff / oneDay) : Math.floor(-diff / oneDay);
  const isPassed = diff <= 0;

  return {
    available: true,
    key: target.key,
    name: target.name,
    written: target.written,
    interview: target.interview,
    days: days,
    isPassed: isPassed,
    /** 报名开放状态提示 */
    stage: isPassed ? 'closed' : (days <= (examDates.signupEndLeadDays || 15) ? 'signing' : 'open')
  };
}

/**
 * 读取缓存的倒计时信息
 * @returns {Object|null}
 */
function getExamInfo() {
  return readJSON(storageKeys.examInfo, null);
}

function setExamInfo(info) {
  writeJSON(storageKeys.examInfo, info);
}

/**
 * 用户主动切换考试场次
 * @param {string} key 场次 key
 * @param {Array} dates 考试日期配置
 * @returns {Object} 新的倒计时信息
 */
function pickExamSession(key, dates) {
  return buildExamInfo(dates, Date.now(), key);
}

/* ==================== 用户设置 ==================== */

function getSettings() {
  return readJSON(storageKeys.userSettings, {
    lastSubject: 1,      // 上次学的科目
    groupSize: 20,       // 每组题量
    showExplainFirst: false, // 是否先看解析再看答案
    autoNext: true       // 答完自动下一题
  });
}

function saveSettings(patch) {
  const cur = getSettings();
  const next = Object.assign({}, cur, patch);
  writeJSON(storageKeys.userSettings, next);
  return next;
}

/* ==================== 云端同步队列 ==================== */

/**
 * 把一条记录加入待同步队列
 *
 * 【为什么要队列】
 * 每做一题就发一次网络请求 → 100 道题发 100 次请求，浪费且容易限频。
 * 攒到一定数量或用户下次进入小程序时再批量上传，请求数能降一个数量级。
 *
 * 队列上限 200 条，超了就丢掉最旧的——本地进度已经存好了，
 * 丢的只是云端统计副本，不影响用户使用。
 */
function queueSync(record) {
  const queue = readJSON(storageKeys.syncQueue, []);
  queue.push(record);
  while (queue.length > 200) queue.shift();
  writeJSON(storageKeys.syncQueue, queue);
  return queue.length;
}

/**
 * 取出并清空待同步队列
 * @returns {Array} 待上传记录
 */
function takeSyncQueue() {
  const queue = readJSON(storageKeys.syncQueue, []);
  writeJSON(storageKeys.syncQueue, []);
  return queue;
}

/**
 * 清空全部本地数据（"我的"页面里的"清除数据"按钮）
 * @returns {boolean}
 */
function clearAll() {
  try {
    wx.clearStorageSync();
    return true;
  } catch (e) {
    console.error('[store] 清空失败', e);
    return false;
  }
}

module.exports = {
  getProgress,
  saveProgress,
  getWrongBook,
  addWrong,
  removeWrong,
  clearWrongBook,
  getDailyStats,
  getTodayCount,
  bumpDailyCount,
  getRecentDays,
  getStreakDays,
  buildExamInfo,
  getExamInfo,
  setExamInfo,
  pickExamSession,
  getSettings,
  saveSettings,
  queueSync,
  takeSyncQueue,
  clearAll,
  todayKey
};