/**
 * miniprogram/pages/guide/guide.js —— 使用说明页
 *
 * 【为什么要单独做一个说明页】
 * 备考类工具有个特点：用户不是"随便逛逛"，而是"有明确目的来学习"。
 * 但他第一次打开时不知道有哪些功能，可能只用"刷题"一个按钮就走了，
 * 错题本、模考、数据分析这些功能白白浪费。
 *
 * 所以这里要解决"让用户在 30 秒内明白每个功能怎么用"。
 * 也是把"主观题怎么答才能拿分"这种关键信息讲清楚的地方——
 * 直接影响留存。
 */

const bank = require('../../core/bank.js');

Page({
  data: {
    totalQuestions: 0,
    totalModules: 0,
    subjectList: []
  },

  onLoad() {
    const subjects = bank.getSubjects();

    // 汇总题库规模，在页面上展示，顺便让用户知道题库在扩充
    let totalQuestions = 0;
    let totalModules = 0;
    subjects.forEach((s) => {
      totalQuestions += s.questionCount;
      totalModules += s.moduleCount;
    });

    this.setData({
      totalQuestions: totalQuestions,
      totalModules: totalModules,
      subjectList: subjects
    });
  },

  /**
   * 复制微信号（用于反馈）
   */
  onCopyFeedback() {
    wx.setClipboardData({
      data: 'jiaozi-shuati-feedback',
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  /**
   * 分享
   */
  onShareAppMessage() {
    return {
      title: '教资刷题 - 教师资格证笔试免费题库',
      path: '/pages/index/index'
    };
  }
});