/**
 * miniprogram/pages/index/index.js —— 首页
 *
 * 【首页要解决什么问题】
 * 用户打开小程序，3 秒内要能开始刷题。
 * 所以首页只做三件事：
 *   1. 告诉他还剩多少天（紧迫感）
 *   2. 给他一个"现在就能点"的按钮
 *   3. 如果不知道从哪下手，给个推荐（薄弱模块）
 *
 * 【不做的事】首页不放新闻、不放公告、不放题库浏览器的层级嵌套。
 * 这些都会增加决策成本。备考用户的目标很单一。
 */

const bank = require('../../core/bank.js');
const store = require('../../core/store.js');
const cloud = require('../../core/cloud.js');
const config = require('../../config/index.js');
const ad = require('../../core/ad.js');

Page({

  /* ============ 页面数据 ============ */
  /**
   * 【为什么数据要放 data 里】
   * data 里的字段才能被 WXML 读取并触发视图更新。
   * 放在 this 上（W 开头）的字段是纯 JS 变量，页面里看不到。
   * 例如 this._cache 只是内部变量，不会影响界面。
   */
  data: {
    /** 倒计时信息，来自 store.buildExamInfo() */
    examInfo: { available: false },
    showSignupTip: false,
    signupTipText: '',

    /** 今日题量与连续打卡 */
    todayCount: 0,
    streakDays: 0,

    /** 统计：done/total/accuracy */
    stats: { total: 0, done: 0, correct: 0, accuracy: 0 },
    overallPercent: 0,

    /** 科目列表 */
    subjects: [],
    currentSubject: 1,
    currentSubjectTitle: '',

    /** 模块列表与各模块统计 */
    modules: [],
    moduleStat: {},
    modulePercent: {},
    subjectProgress: {},

    /** 推荐提示语 */
    weakTip: '',

    /** 今日推荐题量 */
    dailyCount: 10,

    /** 广告 */
    adEnabled: false,
    adBannerId: ''
  },

  /* ============ 生命周期 ============ */

  /**
   * onLoad —— 页面创建时执行一次
   * 【和 onShow 的区别】onLoad 只跑一次，onShow 每次进入都跑。
   * 初始化数据的活放 onLoad，刷新数据的活放 onShow。
   */
  onLoad() {
    this._initSubject();
    this._refreshStats();
    this._initAd();
  },

  /**
   * onShow —— 每次从其他页面返回都会执行
   * 用户刷完题回首页，这里要显示最新的进度。
   */
  onShow() {
    const app = getApp();
    // 用 App 里算好的倒计时（登录后才有服务器时间校准）
    if (app.globalData.examInfo) {
      this._setExamInfo(app.globalData.examInfo);
    }
    this._refreshStats();
    this._trySyncToCloud();
  },

  /**
   * 下拉刷新
   * 需要在 index.json 里配 enablePullDownRefresh: true
   */
  onPullDownRefresh() {
    this._refreshStats();
    this._loadModules(this.data.currentSubject);
    // 【踩坑记录】不调 stopPullDownRefresh 的话刷新动画会一直转，
    // 用户以为卡死了。做完任何异步操作都要关掉它。
    setTimeout(() => {
      wx.stopPullDownRefresh();
    }, 300);
  },

  /* ============ 私有方法 ============ */

  /**
   * 初始化科目与模块
   * 内部方法以 _ 开头是社区约定，表示"这是内部方法，页面模板里别用"
   */
  _initSubject() {
    const subjects = bank.getSubjects();
    const settings = store.getSettings();

    // 用户上次学的科目优先，找不到就默认科目一
    let current = settings.lastSubject;
    const exists = subjects.some((s) => s.subject === current);
    if (!exists) current = subjects[0].subject;

    this.setData({
      subjects: subjects,
      currentSubject: current
    });
    this._loadModules(current);
  },

  /**
   * 加载某科目的模块列表与统计
   * @param {number} subject
   */
  _loadModules(subject) {
    const progress = store.getProgress();
    const modules = bank.getModules(subject);
    const detail = bank.getSubject(subject);

    // 各模块统计
    const moduleStat = {};
    const modulePercent = {};
    const subjectProgress = {};

    modules.forEach((m) => {
      const qs = detail.questions.filter((q) => q.module === m.key);
      const done = qs.filter((q) => progress[q.id]).length;
      const correct = qs.filter((q) => progress[q.id] && progress[q.id].correct).length;
      moduleStat[m.key] = {
        total: qs.length,
        done: done,
        correct: correct,
        accuracy: done ? Math.round((correct / done) * 100) : 0
      };
      // 进度条百分比。模块没做完时，至少显示 2%，否则空进度条像坏了
      modulePercent[m.key] = qs.length
        ? Math.max(done ? 2 : 0, Math.round((done / qs.length) * 100))
        : 0;
    });

    // 各科目整体完成百分比，首页科目切换器上显示
    bank.getSubjects().forEach((s) => {
      const st = bank.getStats(progress, s.subject);
      subjectProgress[s.subject] = st.total ? Math.round((st.done / st.total) * 100) : 0;
    });

    // 推荐提示语：找出最弱的模块告诉用户
    const weak = bank.recommendWeakModule(progress, subject);
    let weakTip = '按模块专项练习，正确率低的会自动排在推荐里';
    if (weak) {
      weakTip = '检测到「' + weak.name + '」正确率仅 ' + weak.accuracy +
        '%，建议先攻克这块';
    } else if (store.getTodayCount() === 0) {
      weakTip = '每天 10 题，坚持比刷得多更重要';
    }

    this.setData({
      modules: modules,
      moduleStat: moduleStat,
      modulePercent: modulePercent,
      subjectProgress: subjectProgress,
      currentSubjectTitle: detail.shortTitle + ' · ' + detail.title,
      weakTip: weakTip
    });
  },

  /**
   * 刷新统计数字
   */
  _refreshStats() {
    const progress = store.getProgress();
    const subject = this.data.currentSubject;
    const stats = bank.getStats(progress, subject);

    const total = stats.total || 1;   // 防止除以 0
    const percent = Math.round((stats.done / total) * 100);

    // 更新倒计时
    const examInfo = store.getExamInfo() || store.buildExamInfo(config.examDates, Date.now());
    this._setExamInfo(examInfo);

    this.setData({
      todayCount: store.getTodayCount(),
      streakDays: store.getStreakDays(),
      stats: stats,
      overallPercent: percent
    });
  },

  /**
   * 设置倒计时与报名提示
   * @param {Object} examInfo
   */
  _setExamInfo(examInfo) {
    let showSignupTip = false;
    let signupTipText = '';

    if (examInfo && examInfo.available && !examInfo.isPassed) {
      if (examInfo.official === false) {
        /**
         * 【重要】日期还没官方公布，这条提示优先级最高。
         * 如果这里也去说"报名即将截止"，用户会拿一个估算日期当真，
         * 白跑一趟考场。所以先说清楚"日子还没定"。
         */
        showSignupTip = true;
        signupTipText = '今年笔试日期官方还没公布，这里按往年规律暂估，请以教育部公告为准';
      } else if (examInfo.stage === 'signing') {
        showSignupTip = true;
        signupTipText = '笔试报名即将截止，别错过';
      } else {
        showSignupTip = true;
        signupTipText = '注意关注各省考试院公告，报名开放时间每年略有差异';
      }
    } else if (examInfo && examInfo.isPassed) {
      showSignupTip = true;
      signupTipText = '本场笔试已结束，下一场倒计时将自动更新';
    }

    this.setData({
      examInfo: examInfo,
      showSignupTip: showSignupTip,
      signupTipText: signupTipText
    });
  },

  /**
   * 初始化广告配置
   * 【设计】adsEnabled 为 false 时不渲染任何广告元素，
   * 页面不会因为"广告位 ID 为空"报错或留白块。
   */
  _initAd() {
    const available = ad.isAvailable();
    this.setData({
      adEnabled: available,
      adBannerId: available ? config.ad.bannerId : ''
    });
  },

  /**
   * 尝试把本地队列同步到云端
   *
   * 【时机选择】只在 onShow 时尝试，也就是"用户从别的页面回来"时。
   * 为什么不每做一题就同步？因为云函数调用有 1-3 秒冷启动延迟，
   * 用户每做一题等 2 秒会直接把人逼走。攒着一起传，体验好得多。
   */
  _trySyncToCloud() {
    if (!cloud.isOnline()) return;

    const queue = store.takeSyncQueue();
    if (!queue.length) return;

    cloud.submitRecords(queue).then((ok) => {
      if (ok) {
        // 同步成功，无需额外处理
      } else {
        // 失败就把记录放回队列，下次再试
        queue.forEach((r) => store.queueSync(r));
      }
    });
  },

  /* ============ 交互事件 ============ */

  /**
   * 点击倒计时卡片 → 切换考试场次
   * 弹一个 ActionSheet 让用户选
   */
  onSwitchExam() {
    const list = config.examDates.written;
    const current = this.data.examInfo.key;
    // 未官方确认的场次，选项里直接带"（暂估）"，别等选完才知道
    const labels = list.map((d) => d.name + '（' + d.written + '）' +
      (d.official === false ? ' 暂估' : ''));

    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        const picked = list[res.tapIndex];
        if (!picked) return;
        if (picked.key === current) return;

        const info = store.pickExamSession(picked.key, config.examDates);
        store.saveSettings({ lastExamKey: picked.key });
        this._setExamInfo(info);
      }
    });
  },

  /**
   * 切换科目
   */
  onSwitchSubject(e) {
    const subject = e.currentTarget.dataset.subject;
    if (subject === this.data.currentSubject) return;

    store.saveSettings({ lastSubject: subject });
    this.setData({ currentSubject: subject });
    this._loadModules(subject);
    this._refreshStats();
  },

  /** 开始今日推荐 */
  onStartDaily() {
    const count = this.data.dailyCount;
    wx.navigateTo({
      url: '/pages/practice/practice?subject=' + this.data.currentSubject +
        '&mode=daily&count=' + count
    });
  },

  /**
   * 按章节专项练习 → 跳到科目选择页
   */
  onStartChapter() {
    wx.navigateTo({
      url: '/pages/subject/subject?subject=' + this.data.currentSubject
    });
  },

  /** 开始模考 */
  onStartMock() {
    wx.navigateTo({
      url: '/pages/mock/mock?subject=' + this.data.currentSubject
    });
  },

  /**
   * 全部随机刷题
   */
  onStartRandom() {
    const settings = store.getSettings();
    wx.navigateTo({
      url: '/pages/practice/practice?subject=' + this.data.currentSubject +
        '&mode=random&count=' + (settings.groupSize || 20)
    });
  },

  /**
   * 点某个模块开始专项练习
   * @param {object} e 事件对象
   */
  onStartModule(e) {
    const moduleKey = e.currentTarget.dataset.module;
    const settings = store.getSettings();

    wx.navigateTo({
      url: '/pages/practice/practice?subject=' + this.data.currentSubject +
        '&mode=chapter&chapter=' + moduleKey + '&count=' + (settings.groupSize || 20)
    });
  },

  /* ============ 分享 ============ */
  /**
   * 分享给好友
   *
   * 【为什么分享对小程序冷启动特别重要】
   * 个人开发者没有投放预算，微信搜一搜见效慢（4-8 周），
   * 而分享是唯一能立刻带来新用户的手段。
   * 所以"把小程序分享给同学"要做得顺手。
   */
  onShareAppMessage() {
    const stats = this.data.stats;
    const days = this.data.examInfo.available ? this.data.examInfo.days : '—';

    return {
      title: config.share.title + '｜距笔试还有 ' + days + ' 天',
      path: config.share.path,
      imageUrl: config.share.imageUrl || ''
    };
  },

  /**
   * 分享到朋友圈
   * 注意：朋友圈分享需要页面在特定场景下才能用，
   * 这里返回标题与路径即可
   */
  onShareTimeline() {
    return {
      title: config.share.title,
      query: ''
    };
  }
});