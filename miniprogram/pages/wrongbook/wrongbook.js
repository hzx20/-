/**
 * miniprogram/pages/wrongbook/wrongbook.js —— 错题本
 *
 * 【这个页面的定位】
 * 错题本是备考类小程序里"复盘价值最高"的页面。
 * 用户之所以愿意反复回来看，不是因为界面好看，
 * 而是因为这里装着"我到底哪里没学会"的答案。
 *
 * 【核心指标：掌握率】
 * 错题总数 - 已掌握数 = 还没掌握的。
 * 掌握率这个数字会随着用户重做错题而上涨，
 * 给用户一个"我的薄弱面在缩小"的正反馈，这是留存的关键。
 *
 * 【一个重要取舍：不做"单条重做"】
 * 需求里提过想按 ids 传单条重做，但 practice.js 目前只支持
 * mode=wrong（加载错题本全部题目），没有接受 ids 列表的能力。
 * 而改 practice.js 会影响已完成的刷题页逻辑。
 * 所以这里的做法是：
 *   - 单条点击 → 弹出题目详情（含答案与解析），供"看"不供"做"
 *   - 重做 → 走 mode=wrong 全量重做
 * 详见下面 onTapItem 和 onRedoAll 的注释。
 */

const bank = require('../../core/bank.js');
const store = require('../../core/store.js');

Page({
  /* ============ 页面数据 ============ */
  data: {
    /** 错题总数 */
    total: 0,
    /** 已掌握的错题数（后来做对过的） */
    mastered: 0,
    /** 尚未掌握 = total - mastered */
    unmastered: 0,
    /** 掌握率，0-100 */
    masterRate: 0,

    /** 按科目分组的错题：[{subject, subjectTitle, items: [...]}] */
    groups: [],
    /** 没有错题时为 true，显示空状态 */
    empty: true,

    /** 详情弹层 */
    showDetail: false,
    detail: {}
  },

  /* ============ 生命周期 ============ */

  /**
   * onShow —— 每次进入都重新读数据
   *
   * 【为什么必须放 onShow 而不是 onLoad】
   * 用户在刷题页把错题做对后，错题本会少题。
   * 如果只在 onLoad 读数据，从刷题页返回错题本时看到的还是旧的。
   * onShow 每次页面显示都会跑，所以数据永远是最新的。
   */
  onShow() {
    this._refresh();
  },

  /**
   * 下拉刷新
   *
   * 【为什么错题本也需要下拉刷新】
   * 虽然 onShow 已经会重读数据，但用户下拉是一个明确的
   * "我要看最新状态"的信号，给一个即时反馈体验更好。
   * 记得调 stopPullDownRefresh，否则刷新动画一直转。
   */
  onPullDownRefresh() {
    this._refresh();
    setTimeout(() => {
      wx.stopPullDownRefresh();
    }, 300);
  },

  /* ============ 私有方法 ============ */

  /**
   * 读取并组装错题数据
   *
   * 【为什么要分三步】
   * 第一步读错题 id 列表（store）
   * 第二步把 id 变成题目对象并按科目归类（bank）
   * 第三步算出掌握情况（用 progress 判断每题最近一次做得对不对）
   * 分开写每一步都能单独判空，出问题时好定位。
   */
  _refresh() {
    const book = store.getWrongBook();
    const progress = store.getProgress();

    /**
     * 【为什么模块名映射表在_refresh 里现建，而不是在 onLoad 建一次】
     * 映射表依赖 bank 的题库数据，而这两个都是同步读取、几乎零耗时
     * （就是读一个 JSON 文件），每次刷新重建一次开销可以忽略。
     * 换来的是这个方法"自包含"——不管谁调用、什么顺序调用都能拿到正确结果。
     * 如果放在 onLoad 里建，一旦有别的入口先调了 _refresh，
     * 就会拿到空映射表，列表里所有模块名都变成空白。
     */
    const moduleNameMap = this._buildModuleNameMap();

    // 没有任何错题 → 空状态，不做任何多余计算
    if (!book.length) {
      this.setData({
        total: 0,
        mastered: 0,
        unmastered: 0,
        masterRate: 0,
        groups: [],
        empty: true
      });
      return;
    }

    const groups = this._groupBySubject(book, progress, moduleNameMap);

    /**
     * 【掌握率怎么算才合理】
     * 注意错题本里的题都是"曾经做错"的，
     * 但用户重做做对之后，store 会自动把它移出错题本，
     * 所以错题本里剩下的题应该都是还没掌握的。
     * 那 mastered 为什么可能不为 0？
     * 因为 store 的规则是"做对且之前做过才移出"，
     * 而 progress 里记录的是最近一次结果，
     * 这里额外统计一遍是为了应对 progress 有、错题本还没同步的短暂不一致，
     * 同时也让"已掌握"这个数字在用户重做过程中能实时变化。
     */
    let mastered = 0;
    book.forEach((id) => {
      const rec = progress[id];
      if (rec && rec.correct) mastered++;
    });

    const total = book.length;
    const unmastered = total - mastered;
    const masterRate = total ? Math.round((mastered / total) * 100) : 0;

    this.setData({
      total: total,
      mastered: mastered,
      unmastered: unmastered,
      masterRate: masterRate,
      groups: groups,
      // 有 id 但一道题都取不到（题库更新后 id 失效）时，也走空状态
      empty: groups.length === 0
    });
  },

  /**
   * 把错题按科目分组
   *
   * 【为什么用 filterQuestions 而不自己遍历题库】
   * bank.filterQuestions({ subject, ids }) 已经封装了
   * "在这个科目里挑出这些 id 的题"，跨科目也能正确工作。
   * 自己遍历题库写一遍不仅冗余，还容易漏掉边界情况。
   *
   * @param {Array<string>} book 错题 id 列表
   * @param {Object} progress 作答记录
   * @param {Object} moduleNameMap 模块 key → 模块名 的映射表
   * @returns {Array} 分组数组
   */
  _groupBySubject(book, progress, moduleNameMap) {
    const groups = [];

    bank.getSubjects().forEach((s) => {
      // 从错题本里挑出属于这个科目的题
      const questions = bank.filterQuestions({ subject: s.subject, ids: book });
      if (!questions.length) return;

      const items = questions.map((q) => {
        const rec = progress[q.id];
        return {
          id: q.id,
          // 题干摘要，80 字，见 _brief 的说明
          brief: this._brief(q.stem, 80),
          moduleName: moduleNameMap[q.module] || '',
          difficultyLabel: this._difficultyLabel(q.difficulty),
          /** 是否已掌握：最近一次做对了就是掌握 */
          mastered: !!(rec && rec.correct),
          /** 主客观题标签，影响用户预期（材料分析要做大题） */
          typeLabel: bank.getTypeLabel(q.type)
        };
      });

      // 组内按"未掌握优先"排，用户打开就看到最该复习的
      items.sort((a, b) => {
        if (a.mastered === b.mastered) return 0;
        return a.mastered ? 1 : -1;
      });

      groups.push({
        subject: s.subject,
        subjectTitle: s.shortTitle + ' · ' + s.title,
        count: items.length,
        items: items
      });
    });

    return groups;
  },

  /**
   * 建立"模块 key → 模块名"的映射表
   *
   * 【踩坑记录】题目对象里没有 subject 字段，
   * 所以不能用 bank.getSubject(q.subject) 反查模块名，
   * 只能一次性把所有科目的模块名汇总成一张表。
   * 两个科目的模块 key 互不重复，可以直接建扁平映射。
   *
   * @returns {Object}
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
   * 截取题干摘要
   *
   * 【为什么固定 80 字】
   * 错题可能有几十上百条，每条都显示完整题干会让页面极长，
   * 用户滚动到一半就放弃。80 字大约两三行，够认出是哪道题了。
   * 完整题干在详情弹层里看。
   *
   * @param {string} text 原文
   * @param {number} max 最大字数
   * @returns {string}
   */
  _brief(text, max) {
    // 【为什么要 replace(/\s+/g, ' ')】
    // 材料分析题的题干里有换行符，直接显示会把列表撑得很乱，
    // 统一压成空格，摘要读起来才连贯。
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
   * 组装详情弹层需要的数据
   *
   * 【注意答案的格式化】
   * 题目里的 answer 是数组（['A'] 或 ['AB']），直接渲染会显示成 "A,B"，
   * 这里 join('') 拼成 "AB"，符合用户看答案的习惯。
   *
   * @param {Object} q 题目
   * @param {Object} moduleNameMap 模块 key → 模块名 的映射表
   */
  _buildDetail(q, moduleNameMap) {
    const answerText = (q.answer || []).join('');

    return {
      id: q.id,
      stem: q.stem,
      options: q.options || [],
      answerText: answerText,
      explain: q.explain || '暂无解析',
      moduleName: moduleNameMap[q.module] || '',
      difficultyLabel: this._difficultyLabel(q.difficulty),
      /** 是否有选项，材料分析题没有选项 */
      hasOptions: !!(q.options && q.options.length),
      typeLabel: bank.getTypeLabel(q.type)
    };
  },

  /* ============ 交互事件 ============ */

  /**
   * 点击某条错题 → 打开详情弹层
   *
   * 【为什么不给"单条重做"入口】
   * 见文件头部说明：practice.js 只支持 mode=wrong 全量重做，
   * 传单条 id 会退化成全量重做，行为和用户预期不符，
   * 不如明确只提供"看详情"和"重做全部"两个动作。
   *
   * @param {object} e 事件对象
   */
  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;

    const questions = bank.getQuestionsByIds([id]);
    // 【兜底】题目可能在题库更新后被删除，这时不弹空层
    if (!questions.length) {
      wx.showToast({ title: '题目已失效，可在错题本中清除', icon: 'none' });
      return;
    }

    this.setData({
      showDetail: true,
      detail: this._buildDetail(questions[0], this._buildModuleNameMap())
    });
  },

  /**
   * 关闭详情弹层
   *
   * 【为什么要单独处理遮罩点击】
   * 弹层内容可能很长（材料分析题），用户需要能点遮罩空白处关闭，
   * 否则滚动半天找不到关闭按钮。
   */
  onCloseDetail() {
    this.setData({ showDetail: false, detail: {} });
  },

  /**
   * 阻止弹层内部点击冒泡
   *
   * 【为什么需要这个空函数】
   * 弹层内是一个整体 view，点它不该触发外层遮罩的关闭事件。
   * WXML 里用 catchtap（而不是 bindtap）就能阻止冒泡。
   */
  onStopPropagation() {
    // 故意留空，只借用 catchtap 的阻止冒泡能力
  },

  /**
   * 重做全部错题
   *
   * 【为什么跳到 practice 用 mode=wrong】
   * practice.js 的 mode=wrong 分支会做两件事：
   * 从 store 读错题本 → bank.getQuestionsByIds 取题。
   * 正是我们需要的。
   */
  onRedoAll() {
    if (!this.data.total) {
      wx.showToast({ title: '错题本是空的，先去刷题吧', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/practice/practice?mode=wrong'
    });
  },

  /**
   * 清空错题本
   *
   * 【为什么要二次确认】
   * 这是不可撤销的操作——清空了只能靠重做错题重新积累，
   * 辛苦积累的复习成果全丢。所以必须弹确认框，
   * 并且把"会影响什么"讲清楚。
   */
  onClearBook() {
    if (!this.data.total) {
      wx.showToast({ title: '错题本已经是空的', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '清空错题本？',
      content: '将删除 ' + this.data.total + ' 道错题的记录，此操作无法撤销。已掌握的进度不受影响。',
      confirmText: '清空',
      confirmColor: '#F04438',
      cancelText: '再想想',
      success: (res) => {
        // 用户点了"清空"
        if (!res.confirm) return;

        store.clearWrongBook();
        this._refresh();
        wx.showToast({ title: '已清空', icon: 'success' });
      }
    });
  },

  /**
   * 空状态里的"去刷题"
   *
   * 【为什么用 switchTab】
   * 首页是 tabBar 页，必须用 wx.switchTab 跳转。
   * 用 navigateTo 跳 tabBar 页会直接失败。
   */
  onGoPractice() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});