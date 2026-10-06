/**
 * miniprogram/pages/subject/subject.js —— 科目/章节选择页
 *
 * 【页面职责】
 * 首页点"按章节专项练习"进来，这里让用户选：
 *   选科目（科目一 / 科目二）→ 选模块 → 选题量 → 开始
 *
 * 【为什么单独开一个页而不是在首页展开】
 * 首页要保持"3 秒内开始刷题"的效率。把科目选择这种低频操作
 * 收进二级页面，首页就能只留高频入口。
 */

const bank = require('../../core/bank.js');
const store = require('../../core/store.js');

Page({
  data: {
    /** 科目列表（卡片式） */
    subjects: [],
    /** 当前选中的科目 */
    activeSubject: 1,

    /** 当前科目的模块列表及各自进度 */
    modules: [],
    /** 已选模块 key，空字符串表示全部 */
    activeModule: '',

    /** 每组题量可选值 */
    countOptions: [10, 20, 30, 50],
    activeCount: 20,

    /** 当前科目的总体统计 */
    summary: { done: 0, total: 0, accuracy: 0 }
  },

  onLoad(options) {
    const subject = Number(options.subject) || store.getSettings().lastSubject || 1;

    this.setData({
      subjects: bank.getSubjects(),
      activeCount: store.getSettings().groupSize || 20
    });

    this._loadSubject(subject);
  },

  /**
   * 加载某科目的模块与统计
   * @param {number} subject
   */
  _loadSubject(subject) {
    const progress = store.getProgress();
    const detail = bank.getSubject(subject);
    const stats = bank.getStats(progress, subject);

    // 给每个模块补上进度数据，模板里直接用
    const modules = bank.getModules(subject).map((m) => {
      const qs = detail.questions.filter((q) => q.module === m.key);
      const done = qs.filter((q) => progress[q.id]).length;
      const correct = qs.filter((q) => progress[q.id] && progress[q.id].correct).length;
      return {
        key: m.key,
        name: m.name,
        desc: m.desc,
        total: qs.length,
        done: done,
        accuracy: done ? Math.round((correct / done) * 100) : 0,
        percent: qs.length ? Math.round((done / qs.length) * 100) : 0
      };
    });

    this.setData({
      activeSubject: subject,
      modules: modules,
      activeModule: '',
      summary: {
        done: stats.done,
        total: stats.total,
        accuracy: stats.accuracy
      }
    });

    wx.setNavigationBarTitle({
      title: detail ? detail.shortTitle + ' 章节' : '选择章节'
    });
  },

  /* ============ 交互事件 ============ */

  /**
   * 切换科目
   */
  onSwitchSubject(e) {
    const subject = e.currentTarget.dataset.subject;
    if (subject === this.data.activeSubject) return;
    this._loadSubject(subject);
  },

  /**
   * 选择模块
   * 【设计】再点一次已选中的模块 = 取消选择，回到"全部"
   */
  onPickModule(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({
      activeModule: this.data.activeModule === key ? '' : key
    });
  },

  /**
   * 选择题量
   */
  onPickCount(e) {
    const count = e.currentTarget.dataset.count;
    this.setData({ activeCount: count });
    store.saveSettings({ groupSize: count });
  },

  /**
   * 开始练习
   *
   * 【路由参数拼装】
   * mode 决定 practice 页怎么抽题：
   *   chapter + chapter=xxx  按模块顺序刷
   *   random                 全部随机
   * 数量不够时 bank.pickQuestions 会返回现有全部，不会报错
   */
  onStart() {
    const { activeSubject, activeModule, activeCount } = this.data;
    const mode = activeModule ? 'chapter' : 'random';

    let url = '/pages/practice/practice?subject=' + activeSubject +
      '&mode=' + mode + '&count=' + activeCount;
    if (activeModule) {
      url += '&chapter=' + activeModule;
    }

    // 记住用户的选择，下次进来还是这个
    store.saveSettings({
      lastSubject: activeSubject,
      groupSize: activeCount
    });

    wx.navigateTo({ url: url });
  }
});