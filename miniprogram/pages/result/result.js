/**
 * miniprogram/pages/result/result.js —— 本组结果页
 *
 * 【这个页面要解决什么问题】
 * 刷完一组题，用户最想知道三件事：
 *   1. 我答对了多少？（一个醒目的大数字）
 *   2. 错在哪？（错题预览，让他知道下一步该干什么）
 *   3. 接下来做什么？（三个按钮：重做错题 / 看错题本 / 继续刷题）
 *
 * 【路由参数从哪来】
 * 由 practice.js 刷完最后一道题时用 wx.redirectTo 跳过来：
 *   /pages/result/result?correct=5&answered=10&subject=1&moduleName=xxx
 * 注意：URL 里的参数全是字符串，所以下面每个都要 Number() 转换。
 *
 * 【一个重要的设计取舍】
 * practice.js 只传了"答对数/总题数"，没传具体是哪几道题做错了。
 * 那这里怎么知道本组错题？
 * 做法：store.getProgress() 里每道题的记录都带 ts（最后一次作答时间戳），
 * 而 practice.js 是"每提交一题立刻存一次"，所以按 ts 倒序取前 answered 条，
 * 就是刚刚这一组做的题。这是推断而非准确值，但对本页面展示足够用了。
 * 想做到完全准确，需要改 practice.js 多传一个 ids 列表，
 * 但那样要把几十道题的 id 拼进 URL，长度容易超限，所以保持现状。
 */

const bank = require('../../core/bank.js');
const store = require('../../core/store.js');
const ad = require('../../core/ad.js');
const config = require('../../config/index.js');

/** 错题预览最多显示几条，避免页面被拉得太长 */
const MAX_PREVIEW = 5;

Page({
  /* ============ 页面数据 ============ */
  data: {
    /** 本组统计，直接来自路由参数 */
    answered: 0,
    correct: 0,
    wrongCount: 0,
    /** 正确率整数，0-100，展示用 */
    accuracy: 0,
    /** 评价文案，如"很扎实" */
    commentText: '',
    /** 评价配色对应的样式类：lv4/lv3/lv2/lv1 */
    commentClass: '',
    /** 本组副标题，如"科目一 · 职业理念" */
    groupTitle: '',

    /** 错题预览列表，最多 MAX_PREVIEW 条 */
    wrongList: [],
    /** 本组做错且当前留在错题本里的题数 */
    newWrongCount: 0,
    /** 错题本当前总题数 */
    wrongBookTotal: 0,
    /** 错题数超过预览上限时，剩余多少条，用于"还有 N 道"提示 */
    wrongMore: 0,
    /** 参数缺失或 answered 为 0 时为 true，界面改显示友好提示 */
    invalid: false,

    /** 广告 */
    adEnabled: false,
    adBannerId: ''
  },

  /* 内部变量：科目代号，用 _ 前缀表示不进 data */
  _subject: 1,

  /* ============ 生命周期 ============ */

  /**
   * onLoad —— 页面创建时执行一次
   * @param {Object} options 路由参数
   */
  onLoad(options) {
    options = options || {};

    /**
     * 【为什么每个参数都要兜底】
     * 万一有人直接在小程序里手动打开这个页面（没有参数），
     * Number(undefined) 是 NaN，NaN 参与算术会得到 NaN，
     * 页面上就会显示"NaN%"。所以统一给默认值 0。
     */
    const answered = Number(options.answered) || 0;
    const correct = Math.min(Number(options.correct) || 0, answered);
    const subject = Number(options.subject) || 1;

    /**
     * 【踩坑记录】moduleName 是 practice.js 用 encodeURIComponent 编码过的，
     * 这里必须 decodeURIComponent 还原。
     * 但如果参数被手工改坏，decodeURIComponent 会直接抛异常，
     * 导致整个页面白屏。所以要 try 一层，失败就用兜底文案。
     */
    let moduleName = '本组练习';
    if (options.moduleName) {
      try {
        moduleName = decodeURIComponent(options.moduleName) || '本组练习';
      } catch (e) {
        console.warn('[result] moduleName 解码失败，使用默认值', e);
        moduleName = '本组练习';
      }
    }

    this._subject = subject;

    // 正确率：分母为 0 时直接给 0，不能让除法产生 NaN
    const accuracy = answered ? Math.round((correct / answered) * 100) : 0;

    this.setData({
      answered: answered,
      correct: correct,
      wrongCount: answered - correct,
      accuracy: accuracy,
      commentText: this._commentText(accuracy),
      commentClass: this._commentClass(accuracy),
      groupTitle: this._groupTitle(subject, moduleName),
      // 【兜底】没有作答记录时不显示"0%"和"需要加强"，
      // 那会让用户以为考得很差，实际是根本没做题
      invalid: answered === 0
    });

    this._loadWrongPreview();
    this._initAd();
  },

  /* ============ 私有方法 ============ */

  /**
   * 根据正确率给一句评价
   *
   * 【为什么要分四档】
   * 只有"对/错"两个状态的话，用户看完没有下一步的动力。
   * 分档之后，"刚及格"的人会有压力去补错题，
   * "很扎实"的人会有成就感愿意继续，这比单纯报个数字有用得多。
   *
   * @param {number} accuracy 0-100
   * @returns {string}
   */
  _commentText(accuracy) {
    if (accuracy >= 90) return '很扎实';
    if (accuracy >= 70) return '不错，继续保持';
    if (accuracy >= 60) return '刚及格，重点看错题';
    return '需要加强';
  },

  /**
   * 根据正确率取配色类名
   *
   * 【色彩心理学在备考场景的应用】
   * 绿=安全、蓝=正常、橙=警告、红=危险。
   * 低于 60 分用红色，是想制造一点紧迫感；
   * 但注意别用更刺眼的纯红满屏，否则焦虑感会劝退用户。
   *
   * @param {number} accuracy 0-100
   * @returns {string} 对应 result.wxss 里的样式类
   */
  _commentClass(accuracy) {
    if (accuracy >= 90) return 'lv4';
    if (accuracy >= 70) return 'lv3';
    if (accuracy >= 60) return 'lv2';
    return 'lv1';
  },

  /**
   * 组装副标题："科目一 · 职业理念"
   * @param {number} subject 科目代号
   * @param {string} moduleName 模块名
   * @returns {string}
   */
  _groupTitle(subject, moduleName) {
    const detail = bank.getSubject(subject);
    const shortTitle = detail ? detail.shortTitle : '';
    if (!shortTitle) return moduleName;
    return shortTitle + ' · ' + moduleName;
  },

  /**
   * 载入本组错题预览
   *
   * 【推断本组题目的方法，见文件头部注释】
   * progress 里每条记录 { correct, score, type, ts }，
   * ts 越大表示越晚做的。按 ts 倒序取前 answered 条即本组。
   */
  _loadWrongPreview() {
    const progress = store.getProgress();
    const book = store.getWrongBook();

    /**
     * 【为什么 store.js 里已经处理过读失败，这里还要判空】
     * store.getProgress() 读失败会返回空对象 {}，
     * 虽然不会抛错，但空对象上取不到任何题目，这里就直接跳过。
     */
    const ids = Object.keys(progress);
    if (!ids.length) {
      this.setData({ wrongList: [], newWrongCount: 0, wrongBookTotal: book.length, wrongMore: 0 });
      return;
    }

    // 按最后作答时间从新到旧排序
    const sortedIds = ids.sort((a, b) => {
      return (progress[b].ts || 0) - (progress[a].ts || 0);
    });

    // 取最近 answered 条 = 刚刚这一组
    let groupIds = sortedIds.slice(0, this.data.answered);
    /**
     * 【兜底】如果记录条数比 answered 还少（极端情况：
     * 刚清过数据、或用户改过系统时间导致 ts 乱序），
     * 那就把全部记录都当成本组的，不做更复杂的猜测。
     */
    if (!groupIds.length) groupIds = sortedIds;

    // 挑出做错的那部分
    const wrongIds = groupIds.filter((id) => {
      return progress[id] && !progress[id].correct;
    });

    // 【重点】"本组新增错题数"只能算近似值
    // store 的规则是：做错才留在错题本，做对了自动移出。
    // 所以"本组做错且现在还在错题本里"的题数，就是本次实际新留下的错题。
    const newWrongCount = wrongIds.filter((id) => book.indexOf(id) !== -1).length;

    // 取题目对象，生成预览列表（最多 5 条）
    const questions = bank.getQuestionsByIds(wrongIds.slice(0, MAX_PREVIEW));
    // 【注意】映射表在方法内现建，让这个方法自包含、不依赖调用顺序
    const moduleNameMap = this._buildModuleNameMap();
    const wrongList = questions.map((q) => {
      return this._toPreviewItem(q, moduleNameMap);
    });

    this.setData({
      wrongList: wrongList,
      newWrongCount: newWrongCount,
      wrongBookTotal: book.length,
      /** 实际预览条数，用于显示"还有 N 道" */
      wrongMore: Math.max(0, wrongIds.length - wrongList.length)
    });
  },

  /**
   * 把题目对象转成 WXML 用的展示对象
   *
   * 【为什么要转一层】
   * 原始题目对象里 stem 可能几百字，直接扔进列表会把页面撑爆。
   * 这里只保留前 80 字做摘要，另外补上模块名和难度文字。
   *
   * @param {Object} q 题目
   * @param {Object} moduleNameMap 模块 key → 模块名 的映射表
   * @returns {Object}
   */
  _toPreviewItem(q, moduleNameMap) {
    return {
      id: q.id,
      brief: this._brief(q.stem, 80),
      moduleName: moduleNameMap[q.module] || '',
      difficultyLabel: this._difficultyLabel(q.difficulty),
      /** 主观题（材料分析）额外标一下，用户预期不同 */
      typeLabel: bank.getTypeLabel(q.type)
    };
  },

  /**
   * 建立"模块 key → 模块名"的映射表
   *
   * 【踩坑记录】一开始这里写的是 bank.getSubject(q.subject).modules，
   * 结果发现所有题目的字段只有 id/module/type/stem/options/answer/explain/
   * difficulty/source/points，压根没有 subject 字段，
   * bank.getSubject(undefined) 返回 null，一执行就报
   * "Cannot read property 'modules' of null"。
   *
   * 【为什么全科目建一张表是安全的】
   * 模块 key 是人工写死的，两个科目的 key 互不重复
   * （科目一是 career/law/ethics/culture/ability，科目二是 edu/psy/class/subject_zh），
   * 所以同一个 key 只可能对应一个模块名，可以直接建扁平映射。
   * 如果以后新增科目时出现重复 key，这里要改成"按科目分开建表"。
   *
   * @returns {Object} { career: '职业理念', law: '教育法律法规', ... }
   */
  _buildModuleNameMap() {
    const map = {};
    bank.getSubjects().forEach((s) => {
      const detail = bank.getSubject(s.subject);
      if (!detail || !detail.modules) return;
      detail.modules.forEach((m) => {
        map[m.key] = m.name;
      });
    });
    return map;
  },

  /**
   * 截取文本摘要
   *
   * 【为什么要自己截而不直接用 CSS 的 line-clamp】
   * CSS 截断在多行时需要固定行数，看起来是"省略号结尾"，
   * 但用户没法判断后面还有多少内容。
   * 做成"前 80 字 + 省略号"，用户对信息完整度有明确预期。
   *
   * @param {string} text 原文
   * @param {number} max 最大字数
   * @returns {string}
   */
  _brief(text, max) {
    const str = String(text || '').replace(/\s+/g, ' ').trim();
    if (str.length <= max) return str;
    return str.slice(0, max) + '…';
  },

  /**
   * 难度数字转文字（与 practice 页保持一致）
   * @param {number} d 1/2/3
   * @returns {string}
   */
  _difficultyLabel(d) {
    if (d === 1) return '基础';
    if (d === 3) return '困难';
    return '中等';
  },

  /**
   * 初始化广告
   *
   * 【设计】adsEnabled 为 false 或广告位 ID 没填时，整个广告块不渲染。
   * 这样开发阶段不会因为"ID 为空"报组件错误导致白屏。
   */
  _initAd() {
    const available = ad.isAvailable();
    this.setData({
      adEnabled: available,
      adBannerId: available ? config.ad.bannerId : ''
    });
  },

  /* ============ 交互事件 ============ */

  /**
   * 重做本组错题
   *
   * 【注意】这里跳的是 mode=wrong，也就是"重做错题本里的全部错题"。
   * 因为 practice.js 只支持按 mode 取题，没有接受 ids 列表的能力。
   * 好处是行为简单、不会算错；代价是如果错题本里有很多历史错题，
   * 用户会多做一些。这里在界面上说明清楚，避免用户觉得点错了。
   */
  onRedoWrong() {
    if (!this.data.newWrongCount && !this.data.wrongList.length) {
      wx.showToast({ title: '本组没有错题，继续保持', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/practice/practice?subject=' + this._subject + '&mode=wrong'
    });
  },

  /**
   * 查看全部错题本
   *
   * 【为什么用 switchTab 而不是 navigateTo】
   * 错题本是 tabBar 页（底部标签栏），
   * tabBar 页必须用 wx.switchTab 跳转，用 navigateTo 会跳转失败并报
   * "navigateTo:fail can not navigate to a tabbar page"。
   */
  onViewWrongBook() {
    wx.switchTab({ url: '/pages/wrongbook/wrongbook' });
  },

  /**
   * 继续刷题 → 回首页
   */
  onContinue() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  /**
   * 点击单条错题预览
   *
   * 【交互设计】不跳页，只提示"去错题本看详情"。
   * 原因：这里只有题干摘要，没有选项和解析，跳过去也没什么可看的；
   * 而打断用户去另一个页面，会让人忘了"这组还没处理完"。
   */
  onTapWrongItem() {
    wx.showToast({
      title: '在错题本里可查看完整解析',
      icon: 'none',
      duration: 1600
    });
  }
});