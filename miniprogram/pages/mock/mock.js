/**
 * miniprogram/pages/mock/mock.js —— 模考页
 *
 * 【模考和普通刷题的三点区别】
 *
 * 1. 限时：真实笔试有严格时间限制，模考必须练出时间感
 *    - 科目一：120 分钟（实际考试时长）
 *    - 交卷后统一看分数，中途不显示对错
 *
 * 2. 不显示即时反馈：真实考试中你看不到对错，
 *    所以模考过程中不告诉用户这题对不对
 *
 * 3. 交卷后一次性出成绩：包括总分、各模块得分、错题回顾
 *
 * 【为什么限时是默认选项】
 * 很多刷题 App 不计时，用户永远不知道自己考试时做不完。
 * 时间压力必须提前适应，否则真考试会慌。
 */

const bank = require('../../core/bank.js');
const store = require('../../core/store.js');
const grade = require('../../core/grade.js');
const ad = require('../../core/ad.js');

/**
 * 模考配置
 * 题量和时长按真实考试的题量比例设定
 */
const MOCK_CONFIG = {
  1: { name: '科目一 综合素质', count: 20, minutes: 30, total: 120 },
  2: { name: '科目二 教育知识与能力', count: 20, minutes: 30, total: 120 }
};

Page({
  data: {
    /* 阶段：ready（选配置）→ doing（答题中）→ done（已交卷） */
    phase: 'ready',

    subject: 1,
    subjectName: '',
    questions: [],
    currentIndex: 0,
    currentQuestion: {},
    isObjective: true,

    /** 给视图层用的答题卡状态：{ 题目id: true } */
    answeredMap: {},
    /** 当前题已选项的字母（客观题用） */
    currentChoice: '',
    /** 当前题的主观题草稿（主观题用） */
    currentDraft: '',
    /** 当前题所属模块名 */
    currentModule: '',
    /** 模考配置（ready 阶段用） */
    mockCount: 20,
    mockMinutes: 30,
    mockTotal: 120,

    /* 计时 */
    remainSeconds: 0,
    remainText: '30:00',
    timeWarning: false,

    /* 结果 */
    score: 0,
    correctCount: 0,
    showExplain: false,
    detailList: [],

    /* 广告 */
    adEnabled: false,
    adRewardedId: '',
    rewardedUnlocked: false
  },

  /** 计时器句柄。clearInterval 需要用它 */
  _timer: null,
  /** 每一题的判分结果，交卷时统一用 */
  _results: {},
  /**
   * 作答记录 { 题目id: 答案 }
   *
   * 【为什么不用 data 里的 answers】
   * 小程序的 setData 会把数据从逻辑层传到视图层，有一定开销。
   * 作答过程中频繁改 answers 会造成不必要的性能损耗。
   * 所以内部用普通变量 _answers 记录，只有需要在页面上显示当前题答案时
   * 才把单个值通过 currentChoice / currentDraft 传出去。
   * 答题卡上"哪些题做过"的状态则单独用一个 answeredMap 传给视图层。
   */
  _answers: {},
  /** 给视图层用的：{ 题目id: true }，只表示做过，不含答案内容 */
  _answeredMap: {},

  onLoad(options) {
    const subject = Number(options.subject) || 1;
    const detail = bank.getSubject(subject);
    const cfg = MOCK_CONFIG[subject] || MOCK_CONFIG[1];

    this.setData({
      subject: subject,
      subjectName: detail ? detail.shortTitle + ' · ' + detail.title : '模考',
      mockCount: cfg.count,
      mockMinutes: cfg.minutes,
      mockTotal: cfg.total,
      adEnabled: ad.isAvailable(),
      adRewardedId: ad.isAvailable() ? (require('../../config/index.js').ad.rewardedVideoId) : ''
    });
  },

  onUnload() {
    // 【重要】离开页面必须停掉计时器
    // 否则定时器会一直跑，耗电，严重时导致小程序崩溃
    this._stopTimer();
  },

  onHide() {
    // 切到后台也要停，回来时按剩余时间续跑（详见 _startTimer 注释）
    this._pauseTimer();
  },

  onShow() {
    // 从后台回来，重新计时
    if (this.data.phase === 'doing') {
      this._resumeTimer();
    }
  },

  /* ============ 内部方法 ============ */

  /**
   * 开始模考
   */
  _startMock() {
    const cfg = MOCK_CONFIG[this.data.subject] || MOCK_CONFIG[1];
    // 【设计决策】题库里题目不够时，取全部而不是报错
    const questions = bank.pickQuestions({
      subject: this.data.subject,
      count: cfg.count
    });

    if (questions.length === 0) {
      wx.showToast({ title: '题库暂无题目', icon: 'none' });
      return;
    }

    this._results = {};
    this._answers = {};
    this._answeredMap = {};

    this.setData({
      phase: 'doing',
      questions: questions,
      currentIndex: 0,
      answeredMap: {},
      showExplain: false,
      score: 0,
      correctCount: 0,
      remainSeconds: cfg.minutes * 60,
      remainText: this._formatTime(cfg.minutes * 60),
      timeWarning: false
    });

    this._loadQuestion(0);
    this._startTimer();
  },

  /**
   * 加载第 index 题
   * @param {number} index
   */
  _loadQuestion(index) {
    const q = this.data.questions[index];
    if (!q) return;

    const isObjective = (q.type === 'single' || q.type === 'judge');
    const detail = bank.getSubject(this.data.subject);
    const mod = detail ? detail.modules.filter((m) => m.key === q.module)[0] : null;

    this.setData({
      currentQuestion: q,
      currentIndex: index,
      isObjective: isObjective,
      currentModule: mod ? mod.name : '',
      // 进度条百分比
      progressPercent: this.data.questions.length
        ? Math.round(((index + 1) / this.data.questions.length) * 100)
        : 0,
      // 【关键】WXML 的表达式引擎不支持 answers[currentQuestion.id] 这种
      // "用变量当对象键名"的写法（小程序不支持动态 key 访问），
      // 写了也取不到值，表现为选项高亮永远不生效。
      // 所以在 JS 里把"当前题已选的答案"算好，单独存成一个字段给模板用。
      currentChoice: this._answers[q.id] !== undefined
        ? (this._answers[q.id][0] || '')
        : '',
      currentDraft: typeof this._answers[q.id] === 'string' ? this._answers[q.id] : ''
    });

    // 重要：切题时把页面滚回顶部，否则用户会以为题目没换
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  /**
   * 时间格式化：秒 → "MM:SS"
   * @param {number} sec
   * @returns {string}
   */
  _formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  },

  /**
   * 启动计时器
   *
   * 【设计决策】为什么每秒更新一次界面？
   * 因为用户需要随时知道还剩多少时间，这是模考的核心压力来源。
   * 但 setData 每秒调用是有成本的，所以只在秒数真的变化时才 setData。
   */
  _startTimer() {
    this._stopTimer();
    this._pauseTimer();

    const self = this;
    this._timer = setInterval(function () {
      const remain = self.data.remainSeconds - 1;

      if (remain <= 0) {
        self._stopTimer();
        self.setData({ remainSeconds: 0, remainText: '00:00' });
        self._autoSubmit();
        return;
      }

      // 剩 5 分钟时变色提醒
      const warning = remain <= 300;

      self.setData({
        remainSeconds: remain,
        remainText: self._formatTime(remain),
        timeWarning: warning
      });
    }, 1000);
  },

  _pauseTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  _stopTimer() {
    this._pauseTimer();
  },

  _resumeTimer() {
    // 切后台再回来，重新起一个计时器继续扣
    this._startTimer();
  },

  /* ============ 交互事件 ============ */

  /**
   * 开始模考（ready 阶段的按钮）
   * 内部转调 _startMock，把"点击事件"和"实际逻辑"分开，
   * 这样模板里直接绑 onStart 即可。
   */
  onStart() {
    this._startMock();
  },

  /**
   * 选择答案
   * 【注意】模考中不判分，只记录答案
   */
  onSelect(e) {
    const index = e.currentTarget.dataset.index;
    const key = this.data.currentQuestion.options[index].key;
    const qid = this.data.currentQuestion.id;

    this._answers[qid] = [key];
    this._answeredMap[qid] = true;

    // 只传"答题卡状态"和"当前题选择"两个小对象，不传全量答案
    this.setData({
      answeredMap: Object.assign({}, this._answeredMap),
      currentChoice: key
    });
  },

  /**
   * 主观题输入
   */
  onInput(e) {
    const qid = this.data.currentQuestion.id;
    this._answers[qid] = e.detail.value;
    this._answeredMap[qid] = true;

    this.setData({
      answeredMap: Object.assign({}, this._answeredMap),
      currentDraft: e.detail.value
    });
  },

  /**
   * 上一题
   */
  onPrev() {
    const idx = this.data.currentIndex - 1;
    if (idx >= 0) this._loadQuestion(idx);
  },

  /**
   * 下一题
   */
  onNext() {
    const idx = this.data.currentIndex + 1;
    if (idx < this.data.questions.length) {
      this._loadQuestion(idx);
    } else {
      // 最后一题的"下一题"变成"交卷"
      this._confirmSubmit();
    }
  },

  /**
   * 跳转到指定题（答题卡）
   * @param {object} e
   */
  onJump(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx >= 0 && idx < this.data.questions.length) {
      this._loadQuestion(idx);
    }
  },

  /**
   * 确认交卷
   */
  _confirmSubmit() {
    const answered = Object.keys(this._answeredMap).length;
    const total = this.data.questions.length;
    const unanswered = total - answered;

    const tip = unanswered > 0
      ? '还有 ' + unanswered + ' 题没作答，未作答的题目不得分。确定交卷？'
      : '所有题目已作答，确定交卷？';

    wx.showModal({
      title: '确认交卷',
      content: tip,
      confirmText: '交卷',
      cancelText: '继续答',
      success: (res) => {
        if (res.confirm) this._submit();
      }
    });
  },

  /**
   * 超时自动交卷
   */
  _autoSubmit() {
    wx.showModal({
      title: '时间到',
      content: '考试时间已结束，系统自动交卷。',
      showCancel: false,
      confirmText: '查看成绩'
    });
    this._submit();
  },

  /**
   * 交卷并判分
   *
   * 【与刷题页的关键区别】
   * 这里统一一次性判分，并把每道题的结果存起来给"解析"页用。
   */
  _submit() {
    this._stopTimer();

    const questions = this.data.questions;
    const answers = this._answers;
    const results = {};
    let correctCount = 0;
    let scoreSum = 0;

    questions.forEach((q) => {
      const myAnswer = answers[q.id] !== undefined ? answers[q.id] : [];
      const r = grade.grade(q, myAnswer);
      results[q.id] = r;

      if (r.correct) correctCount++;
      scoreSum += r.score;

      // 【关键】模考也要保存进度：
      // 用户在模考里做错的题，真实考试也可能错，必须进错题本
      store.saveProgress(q, r);
    });

    this._results = results;

    // 平均分作为模考成绩
    const avgScore = questions.length ? Math.round(scoreSum / questions.length) : 0;

    this.setData({
      phase: 'done',
      correctCount: correctCount,
      score: avgScore,
      showExplain: false
    });
  },

  /**
   * 切换解析显示
   */
  onToggleExplain() {
    if (this.data.showExplain) {
      this.setData({ showExplain: false });
      return;
    }

    // 组装解析列表
    const questions = this.data.questions;
    const answers = this._answers;
    const detailList = questions.map((q) => {
      const myAnswer = answers[q.id] !== undefined ? answers[q.id] : [];
      const r = this._results[q.id] || grade.grade(q, myAnswer);
      return {
        id: q.id,
        stem: q.stem.length > 100 ? q.stem.slice(0, 100) + '…' : q.stem,
        moduleName: this._moduleNameOf(q),
        correct: r.correct,
        score: r.score,
        rightAnswer: (r.rightAnswer || []).join(''),
        myAnswer: Array.isArray(myAnswer) ? myAnswer.join('') : (myAnswer ? '已作答' : '未作答'),
        explain: q.explain
      };
    });

    this.setData({ showExplain: true, detailList: detailList });

    // 交卷后弹插屏广告（此时是用户最放松的时刻，不会打扰做题）
    if (ad.isAvailable()) {
      ad.showInterstitial();
    }
  },

  /**
   * 查模块名
   */
  _moduleNameOf(q) {
    const detail = bank.getSubject(this.data.subject);
    if (!detail) return '';
    const mod = detail.modules.filter((m) => m.key === q.module)[0];
    return mod ? mod.name : '';
  },

  /**
   * 重做模考
   */
  onRetry() {
    this._startMock();
  },

  /**
   * 返回首页
   */
  onBackHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  /**
   * 看广告解锁完整解析
   *
   * 【变现设计 · 核心】
   * 激励视频放在这里，是收益最高的位置：
   *   - 用户刚做完模考，最想知道"我为什么错"，需求最强
   *   - 完整解析是有价值的"奖励"，不给也不影响正常使用（基础解析免费）
   *   - 用户是主动点击，不是被强弹，不会有抵触
   *
   * 【重要】广告不可用时（还没满 500 UV），必须直接给奖励。
   * 否则用户看到"看广告解锁"却点不出广告，体验极差。
   */
  onWatchAd() {
    if (this.data.rewardedUnlocked) {
      this.setData({ showExplain: true });
      return;
    }

    if (!ad.isAvailable()) {
      // 广告还没开通，直接解锁，不卡住用户
      this.setData({ rewardedUnlocked: true });
      this.onToggleExplain();
      return;
    }

    ad.showRewardedVideo({
      onSuccess: () => {
        this.setData({ rewardedUnlocked: true, showExplain: true });
        wx.showToast({ title: '已解锁完整解析', icon: 'success' });
      },
      onClose: () => {
        wx.showToast({ title: '未看完广告，基础解析仍可查看', icon: 'none' });
      },
      onFail: () => {
        wx.showToast({ title: '广告加载失败，已直接解锁', icon: 'none' });
        this.setData({ rewardedUnlocked: true });
        this.onToggleExplain();
      }
    });
  }
});