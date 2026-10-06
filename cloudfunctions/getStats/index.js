/**
 * cloudfunctions/getStats/index.js —— 学习数据统计云函数
 *
 * 【这个云函数干什么】
 * 汇总某个用户的学习数据：累计做题、正确率、连续天数、各科目分布、
 * 最近 7 天的做题趋势。用于"数据"页面的展示。
 *
 * 【性能考虑】
 * 云开发数据库单次查询上限 100 条，直接拉全部答题记录再统计
 * 在用户做了几千题后会超时。所以这里用 users 表里已经维护好的
 * 累计字段做总量统计，只对小范围的"最近 7 天"做明细查询。
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { openid } = event;

  if (!openid) {
    return { success: false, error: 'missing openid' };
  }

  try {
    // 1. 取累计统计（users 表，读一条，很快）
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .limit(1)
      .get();

    const user = userRes.data[0] || {};

    // 2. 取最近 7 天的明细（有时间范围，量可控）
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentRes = await db.collection('answers')
      .where({
        userId: openid,
        answeredAt: _.gte(sevenDaysAgo)
      })
      .limit(100)
      .get();

    const recent = recentRes.data || [];

    // 3. 在云端把最近 7 天聚合成"每天做了几题"
    const dailyMap = {};
    recent.forEach((r) => {
      const key = dateKey(r.answeredAt);
      if (!dailyMap[key]) {
        dailyMap[key] = { date: key, count: 0, correct: 0 };
      }
      dailyMap[key].count++;
      if (r.correct) dailyMap[key].correct++;
    });

    // 按日期升序，缺失的日期补 0，保证图表 x 轴连续
    const daily = [];
    for (let i = 6; i >= 0; i--) {
      const key = dateKey(Date.now() - i * 24 * 60 * 60 * 1000);
      daily.push(dailyMap[key] || { date: key, count: 0, correct: 0 });
    }

    // 4. 各科目正确率
    const subjectMap = {};
    recent.forEach((r) => {
      const s = r.subject || 1;
      if (!subjectMap[s]) subjectMap[s] = { total: 0, correct: 0 };
      subjectMap[s].total++;
      if (r.correct) subjectMap[s].correct++;
    });

    const bySubject = Object.keys(subjectMap).map((k) => ({
      subject: Number(k),
      total: subjectMap[k].total,
      correct: subjectMap[k].correct,
      accuracy: subjectMap[k].total
        ? Math.round((subjectMap[k].correct / subjectMap[k].total) * 100)
        : 0
    }));

    // 5. 汇总
    const totalAnswered = user.totalAnswered || 0;
    const totalCorrect = user.totalCorrect || 0;

    return {
      success: true,
      stats: {
        totalAnswered: totalAnswered,
        totalCorrect: totalCorrect,
        totalScore: user.totalScore || 0,
        // 总正确率。分母要判断，避免除以 0 得到 NaN
        accuracy: totalAnswered
          ? Math.round((totalCorrect / totalAnswered) * 100)
          : 0,
        loginDays: user.loginDays || 1,
        registerAt: user.registerAt || 0,
        daily: daily,
        bySubject: bySubject
      }
    };
  } catch (err) {
    console.error('[getStats] 查询失败', err);
    // 返回空结构而不是抛错，前端可以无缝降级到本地数据
    return {
      success: false,
      error: err.message || 'query failed',
      stats: null
    };
  }
};

/**
 * 时间戳转日期字符串 YYYY-MM-DD
 * 用东八区手动处理，避免云函数时区配置问题导致日期错位
 * @param {number} ts
 * @returns {string}
 */
function dateKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}