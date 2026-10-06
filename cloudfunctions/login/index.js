/**
 * cloudfunctions/login/index.js —— 登录云函数
 *
 * 【这个云函数干什么】
 * 用微信静默登录换取用户的 openid，全程用户无感知，不用点授权按钮。
 *
 * 【openid 是什么】
 * 微信给每个用户在你这个小程序里的唯一编号，形如 o6_bmjrPTlm6_2sgVt7hMZOPfL2M。
 * 它不是手机号，也不是微信号，泄露出去也定位不到具体用户。
 *
 * 【为什么必须用它】
 * 没有 openid，你只能知道"有个人做了题"，但没法把多次做题记录串成一个人，
 * 也无法做跨设备的数据恢复。
 *
 * 【部署方式】
 * 右键这个文件夹 → "上传并部署：云端安装依赖"。不需要额外依赖包。
 */

const cloud = require('wx-server-sdk');

// 初始化云开发。用环境变量拿环境 ID，比写死更灵活
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 云函数的入口
 *
 * 【和前端调用的对应关系】
 * 前端 wx.cloud.callFunction({ name: 'login' }) 调的就是这里
 *
 * @param {object} event 前端传来的参数
 * @param {object} context 云函数运行环境信息
 * @returns {object} 返回值会包在 res.result 里给前端
 */
exports.main = async (event, context) => {
  // context 里有微信传入的用户信息，OPENID 就在里面
  const { OPENID, UNIONID, APPID } = context;

  // 云开发环境内置能力：从轻量数据库读用户表
  const db = cloud.database();
  const users = db.collection('users');

  try {
    const now = Date.now();

    /**
     * 【设计决策】为什么用「查询再更新」而不是直接 upsert？
     *
     * 直接 collection.add() 会在用户第二次登录时抛"重复键"错误，
     * 用 where + update 在没有记录时再 add，这个模式叫"幂等"——
     * 同一操作执行多少次，结果都一样，不会因为重复执行而出错。
     * 云函数有可能被重复触发（超时重试），幂等是必须考虑的。
     */
    const existing = await users.where({ _openid: OPENID }).get();

    if (existing.data.length > 0) {
      // 老用户：只更新登录时间，不动其他字段
      await users.where({ _openid: OPENID }).update({
        data: {
          lastLoginAt: now
        }
      });

      // 累计登录天数
      const rec = existing.data[0];
      const days = (rec.loginDays || 0) + (isSameDay(rec.lastLoginAt, now) ? 0 : 1);
      await users.where({ _openid: OPENID }).update({
        data: { loginDays: days, lastLoginAt: now }
      });

      return {
        openid: OPENID,
        unionid: UNIONID || '',
        isNew: false,
        loginDays: days,
        registerAt: rec.registerAt || now
      };
    }

    // 新用户：插入记录
    await users.add({
      data: {
        _openid: OPENID,
        unionid: UNIONID || '',
        appid: APPID,
        registerAt: now,
        lastLoginAt: now,
        loginDays: 1,
        // 初始统计字段，方便后台直接看
        totalAnswered: 0,
        totalCorrect: 0
      }
    });

    // 记录注册事件，方便你之后统计每日新增
    console.log('[login] 新用户注册: ' + OPENID);

    return {
      openid: OPENID,
      unionid: UNIONID || '',
      isNew: true,
      loginDays: 1,
      registerAt: now
    };
  } catch (err) {
    // 【重要】云函数出错时也要返回结构一致的结果，
    // 前端 core/cloud.js 才能安全地处理 null，不会崩
    console.error('[login] 失败', err);
    return {
      openid: OPENID || '',
      error: err.message || 'login failed'
    };
  }
};

/**
 * 判断两个时间戳是不是同一天
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
function isSameDay(a, b) {
  if (!a) return false;
  const da = new Date(a);
  const db2 = new Date(b);
  return da.getFullYear() === db2.getFullYear() &&
         da.getMonth() === db2.getMonth() &&
         da.getDate() === db2.getDate();
}