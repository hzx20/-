/**
 * cloudfunctions/submitRecord/index.js —— 答题记录上报云函数
 *
 * 【这个云函数干什么】
 * 把用户本地攒下的答题记录批量存到云数据库。
 *
 * 【为什么批量而不是一条一条存】
 * 1. 云函数单次调用有冷启动延迟（约 1-3 秒），批量能省下大量时间
 * 2. 避免触发接口限频。云开发对单个集合的写入有频率限制，
 *    100 道题发 100 个请求很容易撞上限
 * 3. 弱网环境下批量失败可以下次重试，单条丢了就真丢了
 *
 * 【数据表设计】
 * answers 集合，一条记录 = 用户做一道题
 * 唯一索引：userId + questionId + ts（用服务端时间，不信客户端时间）
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 单次最多接收多少条
 * 设上限是为了防止有人伪造超长请求把数据库打爆，也避免超时。
 * 前端队列上限是 200，200 条一次写完约 1-2 秒，安全。
 */
const MAX_RECORDS = 200;

exports.main = async (event) => {
  const { openid, records } = event;

  // 基本参数校验：这一层挡掉明显异常的调用
  if (!openid) {
    return { success: false, error: 'missing openid' };
  }
  if (!Array.isArray(records) || records.length === 0) {
    // 没有数据不算错误，前端会当成"同步成功"清空队列
    return { success: true, count: 0 };
  }

  // 截断到上限，多余的丢弃
  const batch = records.slice(0, MAX_RECORDS);
  const now = Date.now();

  try {
    /**
     * 【批量写入的正确姿势】
     * 云开发的 db.collection().insert() 只能一条一条写，
     * 循环 200 次在云函数里约需 1-2 秒（云端不受用户网速影响，很快）。
     *
     * 用 Promise.all 并发写，比 for 循环 await 串行快得多：
     *   串行：200 次请求累加延迟
     *   并发：一批请求同时发出，总耗时接近最慢的那一次
     * 但并发太高也会被限频，所以分批，每批 50 条。
     */
    const BATCH_SIZE = 50;
    let written = 0;

    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      const chunk = batch.slice(i, i + BATCH_SIZE);

      const tasks = chunk.map((r) => {
        // 数据校验与清洗：不可信输入一律过滤
        if (!r || typeof r.qid !== 'string' || !r.qid) return null;

        return db.collection('answers').add({
          data: {
            userId: openid,
            questionId: r.qid,
            subject: Number(r.subject) || 1,
            correct: !!r.correct,
            score: Number(r.score) || 0,
            // 用服务端时间，客户端时间可能被改
            answeredAt: now,
            // 保留客户端时间仅作参考
            clientTs: Number(r.ts) || 0
          }
        });
      }).filter(Boolean);

      await Promise.all(tasks);
      written += tasks.length;
    }

    // 同步更新 users 表的累计统计
    // 【为什么放在这里而不是每次答题都更新】
    // 放在上报时统一算，避免每题一次写放大。哪怕同步失败也不影响
    // 用户刷题——因为用户的数据在 answers 表里是完整的，users 只是汇总视图。
    await updateUserStats(openid, batch);

    return {
      success: true,
      count: written
    };
  } catch (err) {
    console.error('[submitRecord] 写入失败', err);
    return {
      success: false,
      error: err.message || 'write failed',
      // 返回已成功的数量，前端可以把成功的部分从队列移除
      written: 0
    };
  }
};

/**
 * 更新用户累计统计
 *
 * 用 db.command.inc() 做原子自增。
 * 【为什么不能用"读出来 +1 再写回去"】
 * 那样如果两次调用同时发生，会互相覆盖（丢失更新）。
 * inc() 是数据库层面的原子操作，不会出现这个问题。
 *
 * @param {string} openid
 * @param {Array} records 本批记录
 */
async function updateUserStats(openid, records) {
  const answered = records.length;
  const correct = records.filter((r) => r && r.correct).length;
  const scoreSum = records.reduce(
    (sum, r) => sum + (Number(r && r.score) || 0), 0
  );

  const _ = db.command;

  try {
    await db.collection('users').where({ _openid: openid }).update({
      data: {
        totalAnswered: _.inc(answered),
        totalCorrect: _.inc(correct),
        totalScore: _.inc(scoreSum),
        lastAnswerAt: Date.now()
      }
    });
  } catch (err) {
    // 汇总失败不影响主流程，answers 表数据是完整的
    console.warn('[submitRecord] 更新汇总统计失败（可忽略）', err);
  }
}