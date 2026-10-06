/**
 * app.js —— 小程序入口，全局生命周期与全局状态都在这里
 *
 * 【小白解释】app.js 相当于整个小程序的"总开关"。
 * 小程序启动时只会执行一次 onLaunch，我们在这里做三件事：
 *   1. 初始化云开发（相当于给你的小程序接上一台免费的云服务器）
 *   2. 静默登录（拿到用户唯一标识 openid，用于记录学习数据）
 *   3. 读取本地缓存的学习进度，先把界面渲染出来，不等网络
 */
const store = require('./core/store.js');
const cloud = require('./core/cloud.js');
const config = require('./config/index.js');

App({
  /** 全局数据，任何页面都能通过 getApp().globalData 拿到 */
  globalData: {
    /** 用户唯一标识，登录成功后才有值 */
    openid: '',
    /** 考试倒计时信息，见 core/store.js */
    examInfo: null,
    /** 广告位配置 */
    adConfig: config.ad,
    /** 今日推荐题目的缓存 */
    todayPlan: null
  },

  onLaunch() {
    // 用配置里的云环境 ID 初始化云开发
    cloud.init(config.cloudEnv);

    // 先把本地进度读出来，界面可以立刻显示（离线也能看到历史记录）
    this.globalData.examInfo = store.getExamInfo();

    // 静默登录：失败也不打扰用户，下次进小程序会再试
    cloud.login()
      .then((openid) => {
        this.globalData.openid = openid;
        // 登录成功后才同步考试倒计时（拿到服务器时间，避免用户改本地时间）
        this.globalData.examInfo = store.buildExamInfo(config.examDates, Date.now());
        store.setExamInfo(this.globalData.examInfo);
      })
      .catch((err) => {
        console.warn('[login] 登录失败，本次使用本地模式', err);
      });
  },

  onShow() {
    // 从后台切回前台时，刷新倒计时（用户可能跨天了）
    this.globalData.examInfo = store.buildExamInfo(
      config.examDates,
      Date.now(),
      this.globalData.examInfo && this.globalData.examInfo.pickedKey
    );
  }
});