/**
 * core/ad.js —— 广告封装
 *
 * 【现在为什么是关的】
 * 微信流量主要求累计 500 个独立访客（UV）才能申请。
 * 现在的题目是 500 UV 门槛，不是"访问量 500 次"——
 * 同一个人反复打开只算 1 个 UV，所以真实拉新要求比你想象的更高。
 *
 * 【为什么要封装一层】
 * 直接在页面里写 <ad> 组件会有个问题：
 * 广告位 ID 没填、或还没开通流量主时，广告组件会占位但不显示，
 * 甚至在部分基础库上直接报组件错误，导致页面白屏。
 * 封装成"先判断能不能用，再用"，就没这些问题。
 *
 * 【三种广告的收益与用法】
 *   激励视频（eCPM 50-120 元）：用户主动点击才播，看完给奖励。
 *     → 用在"看广告解锁一次模考""解锁一次 AI 批改"
 *   插屏（15-40 元）：页面切换时全屏弹一次。
 *     → 用在模考结束页，注意别在答题中途弹，会打断思路
 *   banner（8-20 元）：页面底部常驻一条。
 *     → 用在首页、结果页，位置固定不影响体验
 *
 * 【什么时候开】
 * 满 500 UV 后：
 *   1. 微信公众平台 → 广告与服务 → 流量主 → 申请开通
 *   2. 创建广告位，记录激励视频/插屏/banner 的 ID
 *   3. 把 ID 填到 config/index.js 的 ad 对象里
 *   4. 把 adsEnabled 改成 true
 * 代码一行都不用改。
 */

const config = require('../config/index.js');

/**
 * 当前是否可以展示广告
 *
 * @returns {boolean} 三个条件都满足才返回 true：
 *   总开关打开、广告位 ID 已填、微信已支持流量主（基础库版本够）
 */
function isAvailable() {
  const ad = config.ad;
  if (!ad.adsEnabled) return false;
  // 至少要有一个广告位 ID 才有意义
  if (!ad.rewardedVideoId && !ad.interstitialId && !ad.bannerId) return false;
  return true;
}

/**
 * 判断当前微信版本是否支持流量主
 *
 * 【原理】广告组件是微信后来加的能力。老版本微信没有这个组件，
 * 强行用会报错。getSystemInfoSync 返回的 SDKVersion 形如 "2.30.0"，
 * 转成数字数组比较即可。1.9.88 以下不支持。
 */
function isSupported() {
  try {
    const info = wx.getSystemInfoSync();
    const parts = String(info.SDKVersion || '0').split('.').map(Number);
    if (!parts[0]) return false;
    // 主版本 >= 2：全都支持
    if (parts[0] >= 2) return true;
    if (parts[0] !== 1) return false;

    /**
     * 【踩坑记录】原来写的是 parts[0] === 1 && parts[1] >= 9，
     * 结果 1.9.0 也被判为支持。但流量主的最低要求是 1.9.88，
     * 不是 1.9.0。版本号要按"位"比，不能只比次版本。
     * 现在改成：次版本 > 9 支持；等于 9 时再看修订号是否 >= 88。
     */
    if (parts[1] > 9) return true;
    if (parts[1] === 9) return (parts[2] || 0) >= 88;
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * 展示激励视频广告
 *
 * 【使用场景的诀窍】
 * 激励视频收益最高的前提是"用户真的有动力看"。
 * 无理由弹 = 用户被骚扰 = 体验下降 = 可能被投诉。
 * 所以只在用户主动点击"看广告解锁"时才调这个函数。
 *
 * @param {Object} opts
 * @param {Function} opts.onSuccess 看完整段广告的回调
 * @param {Function} [opts.onClose] 关闭广告的回调（无论是否看完都会触发）
 * @param {Function} [opts.onFail] 广告加载失败时的回调
 */
function showRewardedVideo(opts) {
  opts = opts || {};

  if (!isAvailable() || !config.ad.rewardedVideoId) {
    // 广告不可用时直接当"看完了"处理，保证流程能往下走
    // 但业务侧最好也做降级——见 mock.js 的处理
    if (opts.onSuccess) opts.onSuccess();
    if (opts.onClose) opts.onClose();
    return;
  }

  if (!isSupported()) {
    if (opts.onSuccess) opts.onSuccess();
    if (opts.onClose) opts.onClose();
    return;
  }

  const videoAd = wx.createRewardedVideoAd({
    adUnitId: config.ad.rewardedVideoId
  });

  // 【踩坑记录】激励视频组件会缓存，同一个 ad 实例第二次 show 常常报
  // "广告组件还未初始化完成"。标准做法是：
  // 先 load() 预加载，失败时 reject 时再 load 一次重试 show。
  let loaded = false;

  videoAd.load()
    .then(() => {
      loaded = true;
      return videoAd.show();
    })
    .then(() => {
      // 用户完整看完了
      if (opts.onSuccess) opts.onSuccess();
    })
    .catch((err) => {
      // 走到这里通常是"还没加载完就调 show"，需要重新 load 再试
      if (!loaded) {
        videoAd.load()
          .then(() => videoAd.show())
          .then(() => {
            if (opts.onSuccess) opts.onSuccess();
          })
          .catch((err2) => {
            console.warn('[ad] 激励视频加载失败', err2);
            if (opts.onFail) opts.onFail(err2);
            if (opts.onClose) opts.onClose();
          });
      } else {
        // 用户提前关闭，err 里有 isEnded 字段
        if (opts.onClose) opts.onClose();
      }
    });

  // 关闭回调统一挂在实例上
  videoAd.onClose((res) => {
    // res.isEnded 为 true 表示看完了
    if (res && res.isEnded) {
      if (opts.onSuccess) opts.onSuccess();
    } else if (opts.onClose) {
      opts.onClose();
    }
  });

  videoAd.onError((err) => {
    console.warn('[ad] 激励视频出错', err);
    if (opts.onFail) opts.onFail(err);
  });
}

/**
 * 展示插屏广告
 *
 * @param {Function} [onClose]
 */
function showInterstitial(onClose) {
  if (!isAvailable() || !config.ad.interstitialId || !isSupported()) {
    if (onClose) onClose();
    return;
  }

  const interstitialAd = wx.createInterstitialAd({ adUnitId: config.ad.interstitialId });

  interstitialAd.load()
    .then(() => interstitialAd.show())
    .catch(() => {
      // 拉取失败就跳过，用户不该看到报错
      if (onClose) onClose();
    });

  if (onClose) {
    interstitialAd.onClose(() => onClose());
  }
}

/**
 * 供页面判断"要不要给奖励"
 *
 * 【为什么要区分"看完"和"关闭"】
 * 只有看完才能解锁。只点了关闭不给奖励，否则用户会发现"直接关掉也有奖励"，
 * 那激励视频就变成了强制广告，收益和体验双输。
 *
 * @param {Object} res 激励视频的 onClose 返回值
 * @returns {boolean} 是否应给奖励
 */
function shouldReward(res) {
  return !!(res && res.isEnded);
}

module.exports = {
  isAvailable,
  isSupported,
  showRewardedVideo,
  showInterstitial,
  shouldReward
};