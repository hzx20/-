/**
 * config/index.js —— 全局配置中心
 *
 * 【小白解释】这是整个小程序的"设置面板"。
 * 以后你想改考试日期、改广告开关、改云环境，都只动这一个文件，
 * 不用去十几个页面里翻。
 *
 * 【重要】adsEnabled 现在是 false。
 * 微信流量主需要累计 500 个独立访客才能开通，到时候你审核通过、
 * 拿到广告位 ID，把 adsEnabled 改成 true 就行，代码不用动。
 * 先 false 是为了避免广告位没填 ID 导致开发阶段报错。
 */

/** 云开发环境 ID —— 你在开发者工具里开通云开发后，把真实 ID 填在这里 */
const cloudEnv = 'your-env-id';

/**
 * 考试日期配置
 *
 * 【小白解释】倒计时依赖这里。微信官方每年会公布考试时间，
 * 公布后你把official 改成 true，全站倒计时自动变成"精确日期"。
 *
 *科目一 + 科目二 笔试通常一年两次：上半年 3 月中旬、下半年 9 月上旬。
 * 面试在笔试之后约两个月，由当地考区自行安排时间。
 *
 * 【official 字段是什么意思 —— 很重要】
 *   true  = 这个日期是教育部官方公告确认过的，可以当准数告诉用户。
 *   false = 官方还没公布，这是我们按往年规律推的估算值。
 *
 * 【为什么必须区分】
 *   假设 2027 年官方最后定的是 3 月 20 日，我们却写着 3 月 13 日，
 *   用户按这个日期安排复习，最后发现错了 —— 这是产品信任度的一次透支，
 *   比少显示一个倒计时伤害大得多。
 *   所以未确认的场次，界面上会明确标注"暂估"，不装作很确定。
 *
 * 【实测规律】笔试基本都落在周六。2026-03-14、2026-09-12 都是周六，
 *   所以 2027 上半年按规律推最近的周六 03-13，官方公告出来后替换即可。
 */
const examDates = {
  // 笔试场次列表，按时间先后排列
  written: [
    // 官方公告已确认（教育部 Ntce 报名系统）
    { key: 'w2026h1', name: '2026上半年笔试', written: '2026-03-14', interview: '2026-05-16', official: true },
    { key: 'w2026h2', name: '2026下半年笔试', written: '2026-09-12', interview: '2026-11-14', official: true },
    // 官方尚未公布，按往年规律估算，界面会标"暂估"
    { key: 'w2027h1', name: '2027上半年笔试', written: '2027-03-13', interview: '2027-05-15', official: false }
  ],
  // 报名一般提前 1 个月开通，笔试提前 2 周截止，这里用于首页提示"报名即将开始"
  signupLeadDays: 30,
  // 报名截止通常在笔试前 15 天左右
  signupEndLeadDays: 15
};

/**
 * 广告配置
 *
 * 【收益排序】激励视频 > 插屏 > banner。
 * 激励视频适合放在"解锁一次模考""解锁一次 AI 批改"这种
 * 用户本来就想用的地方，不看广告就拿不到，收益最高也不招人烦。
 */
const ad = {
  /** 总开关。达到 500 UV、流量主审核通过后改成 true */
  adsEnabled: false,
  /** 激励视频广告位 ID —— 在微信公众平台"流量主"后台获取，形如 adunit-xxxxxxxx */
  rewardedVideoId: '',
  /** 插屏广告位 ID */
  interstitialId: '',
  /** 底部 banner 广告位 ID */
  bannerId: ''
};

/** 分享配置 —— 好友分享时的标题，关键词直接影响搜一搜权重 */
const share = {
  title: '教资刷题 - 教师资格证笔试免费题库',
  path: '/pages/index/index',
  imageUrl: ''
};

/** 存储键名统一管理，避免各处硬编码字符串写错 */
const storageKeys = {
  progress: 'jz_progress_v1',       // 各题作答记录
  wrongBook: 'jz_wrongbook_v1',     // 错题本
  examInfo: 'jz_exam_info_v1',      // 倒计时缓存
  dailyStats: 'jz_daily_stats_v1',  // 每日做题量
  userSettings: 'jz_user_settings_v1', // 用户偏好（默认科目、每组题量）
  syncQueue: 'jz_sync_queue_v1'     // 待上报云端的记录队列
};

/**
 * AI 批改开关（预留，第一版关闭）
 *
 * 【为什么默认关闭】三个原因：
 *   1. 微信审核对调用外部 AI 接口管得较严，个人主体有被拒风险
 *   2. 每次调用都要花钱，你 500 UV 之前没有收入，投入产出比为负
 *   3. 关键词命中率已能给出可用的参考分，不接也不影响留存
 * 等小程序上了规模、有收入后再改 true，届时需先部署 gradeByAI 云函数。
 */
const aiGrade = {
  enabled: false,
  /** 正式接入时填入大模型的 API Key（不要提交到 git！） */
  apiKey: ''
};

module.exports = {
  cloudEnv,
  examDates,
  ad,
  share,
  aiGrade,
  storageKeys
};