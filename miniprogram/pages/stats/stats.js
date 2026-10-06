/**
 * miniprogram/pages/stats/stats.js —— 学习数据页
 *
 * 【这个页面的目标】
 * 让用户在 10 秒内看懂三件事：
 *   1. 我今天做了多少？（有没有在坚持）
 *   2. 我最近一周的节奏稳不稳？（连续打卡 + 柱状图）
 *   3. 我哪个模块最弱？（模块正确率排行）
 *
 * 【一条重要的产品原则：云端失败必须静默】
 * 云端数据只是"锦上添花"——用户看不到也不会损失什么。
 * 如果在页面上弹"云端连接失败"，只会让用户以为自己的数据丢了，
 * 反而制造焦虑。所以 fetchStats 失败时整块隐藏，一个字都不提示。
 *
 * 【为什么柱状图用 WXML 而不是 canvas】
 * canvas 需要引组件、监听 touch、算坐标，代码量大且容易出比例 bug。
 * 而这个柱状图是纯静态展示（不响应点击、不需要 tooltip），
 * 用 flex + 百分比高度就能实现，还天然适配不同屏幕宽度。
 */

const bank = require('../../core/bank.js');
const store = require('../../core/store.js');
const cloud = require('../../core/cloud.js');

/** 图表最长天数，与需求一致 */
const CHART_DAYS = 7;

/**
 * 图表区最大高度，单位 rpx
 *
 * 【为什么定 200rpx】
 * rpx 是小程序的自适应单位：750rpx = 屏幕宽度。
 * 200rpx 在 iPhone 上约等于 106px，在小屏安卓上也不会把页面撑得太长。
 */
const CHART_MAX_HEIGHT = 200;

Page({
  /* ============ 页面数据 ============ */
  data: {
    /** 顶部四个数字 */
    todayCount: 0,
    totalDone: 0,
    totalAll: 0,
    accuracy: 0,
    streakDays: 0,
    /** 题库整体完成百分比，0-100 */
    overallPercent: 0,

    /** 柱状图数据：[{label, count, percent, isToday}] */
    chart: [],
    /** 七天里有做题的天数 */
    activeDays: 0,

    /** 各模块正确率：[{key, name, done, total, accuracy, percent, low}] */
    moduleList: [],

    /** 云端数据，为 null 时整块不渲染 */
    cloudStats: null,
    /** 是否已尝试过云端请求（避免重复请求） */
    cloudRequested: false
  },

  /* ============ 生命周期 ============ */

  /**
   * onLoad —— 只做初始化
   */
  onLoad() {
    this._loadLocal();
  },

  /**
   * onShow —— 每次进入都刷新
   *
   * 【为什么每次都要刷新】
   * 用户从刷题页返回时，多做了几十道题，
   * 数据页必须立刻反映出来，否则用户会怀疑自己的题白做了。
   */
  onShow() {
    this._loadLocal();
    this._loadCloud();
  },

  /**
   * 下拉刷新
   */
  onPullDownRefresh() {
    this._loadLocal();
    this._loadCloud();
    setTimeout(() => {
      wx.stopPullDownRefresh();
    }, 300);
  },

  /* ============ 私有方法 ============ */

  /**
   * 载入全部本地数据
   *
   * 【为什么全部包在 try 里】
   * 存储读取失败不应该让整页白屏。
   * store.js 内部已经做了降级（读不到返回空值），
   * 这里再包一层是为了防御 bank.getStats 之类的计算异常
   * （比如题库文件结构被改坏），保证界面至少还能显示框架。
   */
  _loadLocal() {
    try {
      const progress = store.getProgress();
      // 不传 subject 表示统计全部科目
      const stats = bank.getStats(progress);

      /**
       * 【为什么整体完成百分比放在 JS 里算】
       * 小程序的 WXML 表达式不支持调用 JS 函数（不能写 toFixed），
       * 只能做加减乘除和三元判断。四舍五入用 Math.round，
       * 它输出的是数字，拼接字符串时微信会自动转成整数文本，
       * 不会出现 "33.333333333" 这种长小数。
       */
      const overallPercent = stats.total
        ? Math.round((stats.done / stats.total) * 100)
        : 0;

      this.setData({
        todayCount: store.getTodayCount(),
        totalDone: stats.done,
        totalAll: stats.total,
        accuracy: stats.accuracy,
        streakDays: store.getStreakDays(),
        overallPercent: overallPercent,
        chart: this._buildChart(),
        moduleList: this._buildModuleList(stats)
      });
    } catch (e) {
      console.error('[stats] 本地数据统计失败', e);
      // 保持界面显示 0 值，不弹错误提示打扰用户
    }
  },

  /**
   * 生成最近 7 天柱状图数据
   *
   * 【柱高的计算方式】
   * 百分比高度 = 本天题数 / 最高那天的题数 * 100。
   * 这样最高的柱子正好占满图表区，视觉上"填满"最舒服。
   *
   * 【为什么要设最小高度】
   * 做了 1 道题的柱子如果严格按比例，可能只有 1rpx，
   * 几乎看不见，用户会以为数据没加载出来。
   * 所以给非 0 的柱子一个 6% 的保底高度。
   *
   * @returns {Array}
   */
  _buildChart() {
    const days = store.getRecentDays(CHART_DAYS);
    if (!days.length) return [];

    // 先找出这 7 天里的最高题数，作为缩放基准
    let max = 0;
    days.forEach((d) => {
      if (d.count > max) max = d.count;
    });

    // 今天是最后一天（store.getRecentDays 保证按日期升序）
    const todayIndex = days.length - 1;

    let activeDays = 0;
    const chart = days.map((d, i) => {
      if (d.count > 0) activeDays++;
      return {
        label: d.label,
        count: d.count,
        // max 为 0 说明这 7 天完全没做题，百分比全部按 0 处理，
        // 此时直接给 0，避免出现 0/0 = NaN
        percent: max ? Math.round((d.count / max) * 100) : 0,
        isToday: i === todayIndex
      };
    });

    this.setData({ activeDays: activeDays });
    return chart;
  },

  /**
   * 生成模块正确率列表
   *
   * 【为什么按正确率从低到高排】
   * 用户来这个页面是为了找弱点。
   * 如果按题库顺序排，最弱的模块可能藏在最下面，用户根本看不到。
   * 排序 + 红色高亮，等于直接把"该补哪里"摆在眼前。
   *
   * @param {Object} stats bank.getStats 的返回值
   * @returns {Array}
   */
  _buildModuleList(stats) {
    const list = [];
    const byModule = stats.byModule || {};

    Object.keys(byModule).forEach((key) => {
      const m = byModule[key];
      // 【关键】一道题都没做的模块不显示
      // done 为 0 时 accuracy 恒为 0，会被误判成"最薄弱"，
      // 让用户以为自己在一个完全没碰过的模块上只有 0% 正确率。
      if (!m.done) return;

      list.push({
        key: key,
        name: m.name,
        done: m.done,
        total: m.total,
        accuracy: m.accuracy,
        // 进度条按"刷题完成度"还是"正确率"？
        // 这里用正确率，因为这一页的主题是"掌握得怎么样"。
        percent: m.accuracy,
        // 低于 60 分标红，与首页的 .module-accuracy.low 规则一致
        low: m.accuracy < 60
      });
    });

    list.sort((a, b) => a.accuracy - b.accuracy);
    return list;
  },

  /**
   * 尝试拉取云端统计
   *
   * 【本项目最重要的一条错误处理原则】
   * 云端失败 = 什么都不做。
   * 不弹 toast、不显示"加载失败"、不显示红色感叹号。
   * 因为对用户来说云端数据可有可无，报错只会让他担心数据丢了。
   *
   * cloud.fetchStats() 本身在 core/cloud.js 里已经保证"失败返回 null 不抛异常"，
   * 这里再做一层判断，收到 null 就保持 cloudStats 为 null（界面不渲染）。
   */
  _loadCloud() {
    // 未登录或没开通云开发，直接不请求，省一次无效等待
    if (!cloud.isOnline()) return;

    cloud.fetchStats()
      .then((res) => {
        // 【静默失败】res 为 null 表示超时/云函数没部署/权限不足，
        // 一律不处理，界面保持不显示云端区块
        if (!res || typeof res !== 'object') return;

        /**
         * 【为什么要逐个字段做兜底】
         * 云函数 getStats 返回的字段结构由云端决定，
         * 万一某个字段缺失，直接取会得到 undefined，
         * 在 WXML 里渲染成 "undefined" 很难看。
         * 这里统一给 0，界面最多显示 0，不会出现异常文本。
         */
        const total = Number(res.total || res.done || 0);
        const correct = Number(res.correct || 0);
        const accuracy = res.accuracy !== undefined
          ? Number(res.accuracy)
          : (total ? Math.round((correct / total) * 100) : 0);

        this.setData({
          cloudStats: {
            total: total,
            correct: correct,
            accuracy: accuracy
          },
          cloudRequested: true
        });
      })
      .catch((err) => {
        /**
         * 【为什么要写这个 catch】
         * core/cloud.js 已经保证不 reject 了，正常走不到这里。
         * 但如果以后有人改了 cloud.js，或者 fetchStats 被换掉，
         * 没有 catch 就会出现"未捕获的 Promise 拒绝"警告。
         * 加一层空 catch 是防御性编程，成本几乎为零。
         */
        console.warn('[stats] 云端统计获取失败，已忽略', err);
      });
  },

  /* ============ 交互事件 ============ */

  /**
   * 点柱状图某一天
   *
   * 【为什么只弹个 toast 而不是跳页面】
   * 单天的题量没什么可深挖的，给个即时的数字反馈就够了。
   * 做成可交互的好处是让用户知道"这图是真的，不是装饰"。
   *
   * @param {object} e 事件对象
   */
  onTapBar(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.chart[index];
    if (!item) return;

    const suffix = item.isToday ? '（今天）' : '';
    wx.showToast({
      title: item.label + '：' + item.count + ' 题' + suffix,
      icon: 'none'
    });
  },

  /**
   * 点模块行 → 去刷这个模块
   *
   * 【跳首页而不是直接进练习】
   * 模块 key 属于某个科目，直接跳练习页需要先知道科目代号。
   * 错题本/数据页都有跨科目的问题，回到首页由用户选科目更清晰。
   * 这里用 switchTab 回首页，避免页面栈越堆越深。
   */
  onTapModule() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});