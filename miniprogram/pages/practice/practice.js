/**
 * miniprogram/pages/practice/practice.js —— 刷题页
 *
 * 【这个页面的状态机】
 *
 *   未作答 ──(选择题选项)──▶ 已选择 ──(点提交)──▶ 已判分 ──(点下一题)──▶ 下一题
 *      │
 *      └──(主观题输入)──▶ 已作答 ──(点提交)──▶ 已判分 ──(点下一题)──▶ 下一题
 *
 * 【三个容易写错的地方，这段代码专门处理了】
 *
 * 1. 中途退出
 *    用户做了 8 题退出，这 8 题的记录必须已经存好了。
 *    所以每次提交都立刻调 store.saveProgress()，不在 onUnload 里统一存。
 *    这样即使小程序被杀掉，进度也在。
 *
 * 2. 重复提交
 *    用户可能快速点两次"提交"。加 submitting 标志位，第二次点击直接忽略。
 *    主观题尤其重要——重复判分会把同一题算成两次。
 *
 * 3. 作答内容重置
 *    从上一题切到下一题时，userAnswer 和 showResult 必须重置。
 *    漏掉任何一个，页面上就会显示上一题的答案，非常迷惑。
 */

const bank = require('../../core/bank.js');
const store = require('../../core/store.js');
const grade = require('../../core/grade.js');

Page({
  data: {
    /** 本组题目 */
    questions: [],
    currentIndex: 0,
    currentQuestion: {},

    /** 作答状态 */
    userAnswer: [],
    showResult: false,
    result: { correct: false, score: 0, details: [] },
    rightAnswerText: '',
    optionClass: [],
    submitting: false,

    /** 统计 */
    correctCount: 0,
    answeredCount: 0,
    progressPercent: 0,

    /** 展示用 */
    isObjective: true,
    isLastQuestion: false,
    moduleName: '',
    subjectTitle: '',
    difficultyLabel: ''
  },

  /* 内部变量，用 _ 前缀表示"不进 data" */
  _subject: 1,
  _moduleName: '',
  _difficulty: 0,
  _mode: 'daily',
  /** 本次会话已作答的题目 id，防止同一组里重复计数 */
  _answeredIds: [],

  /**
   * onLoad —— 读取路由参数并抽题
   *
   * 【路由参数怎么来的】
   * 上个页面用 wx.navigateTo({ url: '...?...&key=value' }) 传过来。
   * 这里用 options.xxx 接收。注意：URL 里的参数全是字符串，
   * 需要 Number() 转成数字，否则 '1' !== 1 比较会失败。
   */
  onLoad(options) {
    const subject = Number(options.subject) || 1;
    const mode = options.mode || 'daily';
    const count = Number(options.count) || 20;
    const chapter = options.chapter || '';

    this._subject = subject;
    this._mode = mode;

    let questions = [];

    if (mode === 'chapter') {
      // 章节专项：按题库顺序刷，方便系统性过一遍
      questions = bank.pickQuestions({
        subject: subject,
        module: chapter,
        count: count,
        ordered: true
      });
      const mod = bank.getModules(subject).filter((m) => m.key === chapter)[0];
      this._moduleName = mod ? mod.name : '';
    } else if (mode === 'wrong') {
      // 错题重做
      const wrongIds = store.getWrongBook();
      questions = bank.getQuestionsByIds(wrongIds);
      this._moduleName = '错题本';
    } else if (mode === 'random') {
      // 全部随机
      questions = bank.pickQuestions({ subject: subject, count: count });
      this._moduleName = '随机练习';
    } else {
      // 今日推荐：优先薄弱模块
      const progress = store.getProgress();
      const weak = bank.recommendWeakModule(progress, subject);
      questions = bank.getDailyPlan(progress, subject, count);
      this._moduleName = weak ? weak.name : '今日推荐';
    }

    const detail = bank.getSubject(subject);

    this.setData({
      questions: questions,
      moduleName: this._moduleName,
      subjectTitle: detail ? detail.shortTitle : ''
    });

    // 【踩坑记录】原来忘了调 _loadCurrentQuestion()，
    // 页面能打开但一片空白，因为 currentQuestion 还是 {}。
    // 抽完题必须立刻加载第一题。
    if (questions.length > 0) {
      this._loadCurrentQuestion();
    }

    // 设置导航栏标题，让用户在页面上就知道自己在哪
    wx.setNavigationBarTitle({
      title: (detail ? detail.shortTitle : '刷题') + ' · ' + (this._moduleName || '练习')
    });
  },

  /* ============ 内部方法 ============ */

  /**
   * 加载当前题目的展示数据
   *
   * 【每次切题都必须完整重置所有状态】
   * 漏掉 showResult 重置，用户会看到上一题的解析。
   * 漏掉 optionClass 重置，上一题的颜色会留在新选项上。
   */
  _loadCurrentQuestion() {
    const idx = this.data.currentIndex;
    const q = this.data.questions[idx];
    if (!q) return;

    const isObjective = (q.type === 'single' || q.type === 'judge');
    const detail = bank.getSubject(this._subject);

    this.setData({
      currentQuestion: q,
      isObjective: isObjective,
      userAnswer: [],
      showResult: false,
      result: { correct: false, score: 0, details: [] },
      rightAnswerText: '',
      optionClass: isObjective ? q.options.map(() => '') : [],
      submitting: false,
      isLastQuestion: idx === this.data.questions.length - 1,
      difficultyLabel: this._difficultyLabel(q.difficulty),
      moduleName: detail && !this._moduleName
        ? (detail.modules.filter((m) => m.key === q.module)[0] || {}).name || ''
        : this._moduleName,
      progressPercent: this.data.questions.length
        ? Math.round((idx / this.data.questions.length) * 100)
        : 0
    });
  },

  /**
   * 难度转文字
   * @param {number} d 1/2/3
   * @returns {string}
   */
  _difficultyLabel(d) {
    if (d === 1) return '基础';
    if (d === 3) return '困难';
    return '中等';
  },

  /* ============ 交互事件 ============ */

  /**
   * 选择选项（仅客观题）
   * @param {object} e 事件对象
   *
   * 【为什么用 dataset 而不是闭包】
   * WXML 里 bindtap 只能传字符串或数字，不能传函数。
   * 所以用 data-index="{{index}}" 传索引，事件里再从 dataset 取。
   */
  onSelectOption(e) {
    // 已判分后禁止修改答案，否则会出现"先提交再改再提交"的混乱
    if (this.data.showResult) return;

    const index = e.currentTarget.dataset.index;
    const key = this.data.currentQuestion.options[index].key;

    this.setData({
      userAnswer: [key]
    });
  },

  /**
   * 主观题输入
   */
  onInput(e) {
    this.setData({ userAnswer: e.detail.value });
  },

  /**
   * 提交答案
   */
  onSubmit() {
    // 防重复提交
    if (this.data.submitting) return;
    // 已经判过分了
    if (this.data.showResult) return;

    const q = this.data.currentQuestion;
    const answer = this.data.userAnswer;

    // 客观题必须选了才能提交
    if (this.data.isObjective && !answer.length) return;
    // 主观题至少要有实质内容
    if (!this.data.isObjective && !/[一-龥a-zA-Z0-9]/.test(answer || '')) {
      wx.showToast({ title: '请先写下你的作答内容', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    // 【为什么用 setTimeout 延迟】
    // 判分是同步的，耗时不到 1ms。直接 setData 用户会觉得"点了没反应"。
    // 加一点点延迟，让"提交中"的状态可见，交互更自然。
    setTimeout(() => {
      const result = grade.grade(q, answer);

      // 【关键】立刻保存进度，不是等到这组做完才存
      store.saveProgress(q, result);

      // 本次会话内的计数（只统计本组，不含历史）
      const isNewInSession = this._answeredIds.indexOf(q.id) === -1;
      if (isNewInSession) {
        this._answeredIds.push(q.id);
      }

      // 累计本组答对数
      let correctCount = this.data.correctCount;
      if (result.correct && isNewInSession) {
        correctCount++;
      }
      const answeredCount = this._answeredIds.length;

      // 正确答案文本：把 ['A'] 转成 'A'，多选取 'AB'
      const rightAnswerText = (result.rightAnswer || []).join('');

      // 选项染色：选对全部绿，选错则正确答案绿、所选答案红
      const optionClass = this._calcOptionClass(q, answer, result);

      this.setData({
        showResult: true,
        result: result,
        rightAnswerText: rightAnswerText,
        optionClass: optionClass,
        correctCount: correctCount,
        answeredCount: answeredCount,
        submitting: false
      });
    }, 200);
  },

  /**
   * 计算每个选项的样式类
   *
   * 【视觉规则】
   * 未提交：全部中性
   * 提交后：正确选项绿底；用户选错的那个红底；其余灰
   *
   * @returns {Array<string>} 与 options 等长的类名数组
   */
  _calcOptionClass(q, userAnswer, result) {
    const classes = q.options.map(() => '');
    if (!result.correct) return classes;

    q.options.forEach((opt, i) => {
      const isRight = (result.rightAnswer || []).indexOf(opt.key) !== -1;
      const isChosen = (userAnswer || []).indexOf(opt.key) !== -1;

      if (isRight) {
        classes[i] = 'correct';
      } else if (isChosen) {
        classes[i] = 'wrong';
      } else {
        classes[i] = 'disabled';
      }
    });
    return classes;
  },

  /**
   * 下一题
   */
  onNext() {
    const nextIndex = this.data.currentIndex + 1;

    if (nextIndex >= this.data.questions.length) {
      // 做完这一组了 → 去结果页
      this._goResult();
      return;
    }

    this.setData({ currentIndex: nextIndex });
    this._loadCurrentQuestion();
  },

  /**
   * 跳到结果页
   */
  _goResult() {
    const correct = this.data.correctCount;
    const answered = this.data.answeredCount;

    wx.redirectTo({
      url: '/pages/result/result?correct=' + correct +
        '&answered=' + answered +
        '&subject=' + this._subject +
        '&moduleName=' + encodeURIComponent(this._moduleName || '练习')
    });
  },

  /**
   * 退出
   *
   * 【为什么要拦一道】
   * 用户可能手滑点到了退出。做了 5 题就走太可惜，
   * 所以做了 3 题以上才弹确认框。
   */
  onExit() {
    if (this.data.answeredCount >= 3) {
      wx.showModal({
        title: '退出练习？',
        content: '已完成 ' + this.data.answeredCount + ' 题，进度会自动保存。',
        confirmText: '退出',
        cancelText: '继续刷',
        success: (res) => {
          if (res.confirm) {
            wx.navigateBack({
              delta: 1,
              fail: () => wx.switchTab({ url: '/pages/index/index' })
            });
          }
        }
      });
    } else {
      wx.navigateBack({
        delta: 1,
        fail: () => wx.switchTab({ url: '/pages/index/index' })
      });
    }
  },

  /**
   * 【重要】离开页面时的清理
   *
   * 【踩坑记录】用户做题时把小程序切到后台（接电话、锁屏），
   * 30 分钟后微信可能把小程序的内存回收掉。
   * 如果用户再回来时页面状态被重置，正在输入的主观题答案就没了。
   * 所以在 onHide 时把当前输入暂存到内存变量，回 onShow 时恢复。
   */
  onHide() {
    this._draftAnswer = this.data.userAnswer;
    this._draftIndex = this.data.currentIndex;
  },

  onShow() {
    // 只有"还在同一题、还没提交"时才恢复草稿
    if (this._draftAnswer &&
        this._draftIndex === this.data.currentIndex &&
        !this.data.showResult) {
      this.setData({ userAnswer: this._draftAnswer });
    }
  },

  /* ============ 分享 ============ */
  onShareAppMessage() {
    return {
      title: '我在刷「' + (this._moduleName || '教资题库') + '」，一起练',
      path: '/pages/index/index'
    };
  }
});