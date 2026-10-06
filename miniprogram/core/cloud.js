/**
 * core/cloud.js —— 云开发调用封装
 *
 * 【小白解释】云开发是什么？
 * 你不用自己买服务器、不用申请域名、不用做备案、不用运维，
 * 微信直接给你一台云服务器和一个数据库，接口是 JavaScript 调用的。
 * 对个人开发者来说，这把上线成本从"几千元 + 几天"降到"0 元 + 一小时"。
 *
 * 【本项目的云端只干三件事】
 *   1. 换取 openid（用户唯一标识，用来识别"这是同一个人"）
 *   2. 备份答题记录（万一用户换手机，本地进度不至于全丢）
 *   3. 统计数据（你在后台能看到有多少人、做了多少题）
 *
 * 【重要设计原则】
 * 云端出任何问题，都不能影响用户刷题。
 * 所以这个文件里所有函数都是"云端失败就返回默认值，绝不 reject"。
 * 弱网、没开通云开发、云函数部署失败——用户照样能正常做题。
 * 这是小程序的第一原则：本地能跑的，绝不依赖网络。
 */

/** 是否已初始化，避免重复初始化 */
let initialized = false;
/** 是否登录成功，登录失败就不反复重试（防止每次操作都白等一次超时） */
let loggedIn = false;
let openid = '';

/**
 * 初始化云开发
 * @param {string} env 云环境 ID
 */
function init(env) {
  if (initialized) return;

  /**
   * 【踩坑记录】wx.cloud.init 必须在 App 的 onLaunch 里调用且只能调一次，
   * 重复调用在新版基础库里会告警甚至报错。
   * 另外云环境 ID 填错时，调用云函数会报 "cloud env not found"，
   * 所以这里做了 env 有效性判断——没配置好就干脆不初始化，走本地模式。
   */
  if (!env || env === 'your-env-id') {
    console.warn('[cloud] 未配置云环境 ID，运行在本地模式（功能不受影响，只是数据不上云）');
    return;
  }

  try {
    wx.cloud.init({
      env: env,
      // traceUser 会记录"用户访问了哪个页面"，在云开发控制台能看到访问来源
      traceUser: true
    });
    initialized = true;
  } catch (e) {
    console.error('[cloud] 初始化失败', e);
  }
}

/**
 * 静默登录，换取 openid
 *
 * 【为什么要 openid】
 * openid 是微信给每个用户在这个小程序里的唯一编号。
 * 没有它，你只知道"有个用户做了题"，但不知道"这些题是不是同一个人做的"，
 * 也无法给他保存跨设备的数据。
 *
 * @returns {Promise<string>} 成功返回 openid，失败返回空字符串（不 reject）
 */
function login() {
  return new Promise((resolve) => {
    // 没初始化云开发就别试了，直接返回空
    if (!initialized) {
      resolve('');
      return;
    }
    // 已登录过就直接返回，不重复请求
    if (loggedIn && openid) {
      resolve(openid);
      return;
    }

    wx.cloud.callFunction({
      name: 'login',
      data: {}
    }).then((res) => {
      openid = (res && res.result && res.result.openid) || '';
      /**
       * 【踩坑记录】原来无条件写 loggedIn = true，
       * 结果云函数"调用成功但没返回 openid"时（比如云函数内部出错、
       * 权限不足），loggedIn 变成 true 而 openid 还是空串。
       * 之后每次 login() 都因为 loggedIn 为真而走缓存直接返回空串，
       * 登录从此再也不会重试——用户数据永远上不了云，且很难排查。
       * 修正：只有真的拿到 openid 才算登录成功。
       */
      loggedIn = !!openid;
      if (!openid) {
        console.warn('[cloud] 未取到 openid');
      }
      resolve(openid);
    }).catch((err) => {
      // 云函数没部署、或网络不通，都会走到这里
      // 注意：这里不能 reject，否则 App.onLaunch 的链会断，
      // 页面拿不到 examInfo 就渲染不出倒计时
      console.warn('[cloud] 登录失败，使用本地模式', err);
      loggedIn = false;
      resolve('');
    });
  });
}

/**
 * 调用云函数的通用封装
 *
 * 【为什么统一超时时间】
 * 弱网下云函数可能要 3-5 秒才响应。如果用户已经等不及关掉页面，
 * 请求还在跑，白白消耗流量。统一 8 秒超时，超了就放弃，
 * 数据留在本地队列里，下次再传。
 *
 * @param {string} name 云函数名
 * @param {Object} data 参数
 * @param {number} [timeout=8000]
 * @returns {Promise<any>} 失败返回 null，不 reject
 */
function callFunction(name, data, timeout) {
  timeout = timeout || 8000;

  return new Promise((resolve) => {
    if (!initialized) {
      resolve(null);
      return;
    }

    let settled = false;

    // 定时器：到点还没回，就判定失败
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn('[cloud] ' + name + ' 超时，放弃本次请求');
      resolve(null);
    }, timeout);

    wx.cloud.callFunction({
      name: name,
      data: data || {}
    }).then((res) => {
      if (settled) return;   // 已经超时了，忽略这次迟到的响应
      settled = true;
      clearTimeout(timer);
      resolve((res && res.result) || null);
    }).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 这里只记日志不抛错——云端挂了不该让用户看到报错弹窗
      console.warn('[cloud] ' + name + ' 调用失败', err);
      resolve(null);
    });
  });
}

/**
 * 上报一批答题记录
 * @param {Array} records 待同步记录数组
 * @returns {Promise<boolean>} 是否成功
 */
function submitRecords(records) {
  if (!records || !records.length) return Promise.resolve(false);
  if (!openid) return Promise.resolve(false);

  return callFunction('submitRecord', {
    openid: openid,
    records: records
  }).then((res) => {
    return !!(res && res.success);
  });
}

/**
 * 拉取云端统计数据（用于"数据"页的累计数据）
 * @returns {Promise<Object|null>}
 */
function fetchStats() {
  if (!openid) return Promise.resolve(null);
  return callFunction('getStats', { openid: openid }, 10000);
}

/**
 * 当前是否处于云端可用状态
 * @returns {boolean}
 */
function isOnline() {
  return initialized && loggedIn;
}

/**
 * 【预留】AI 判分云函数调用
 * 等你有收入后要接大模型时用这个入口。
 * @param {Object} payload { questionId, points, userAnswer, ... }
 * @returns {Promise<Object|null>}
 */
function callAI(payload) {
  return callFunction('gradeByAI', payload, 20000);
}

module.exports = {
  init,
  login,
  callFunction,
  submitRecords,
  fetchStats,
  callAI,
  isOnline,
  // 便于测试
  _reset: function () {
    initialized = false;
    loggedIn = false;
    openid = '';
  },
  _getOpenid: function () {
    return openid;
  }
};