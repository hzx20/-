/**
 * miniprogram/pages/mine/mine.js —— 我的
 *
 * 【这个页面的定位】
 * 放三样东西：我的数据、我的设置、关于本项目。
 *
 * 【一个重要的坑：为什么不用 wx.getUserProfile 取头像昵称】
 * 微信 2022 年起收紧了隐私授权，getUserProfile 必须由用户主动点击触发，
 * 而且 2022 年 11 月后新提交的小程序已经拿不到头像昵称了。
 * 个人主体的小程序基本无法通过这个接口。
 * 所以这里用"文字头像"——不请求任何权限，零风险，
 * 视觉上用一个圆形色块 + 首字实现，成本几乎为零。
 *
 * 【设置项为什么都用 ActionSheet 而不是自己写弹层】
 * wx.showActionSheet 是系统原生弹层，样式统一、滑动体验好、
 * 自动适配刘海屏，不需要自己写定位和动画。
 * 自己写 select 组件要处理的边界情况（滚动、点击遮罩、
 * 键盘弹出）比想象的多得多，不划算。
 */

const store = require('../../core/store.js');
const bank = require('../../core/bank.js');
const cloud = require('../../core/cloud.js');
const config = require('../../config/index.js');

/** 版本号，唯一需要每次发版手动改的地方 */
const APP_VERSION = '1.0.0';

/** 可选的每组题量 */
const GROUP_SIZES = [10, 20, 30, 50];

Page({
  /* ============ 页面数据 ============ */
  data: {
    /** 版本号 */
    version: APP_VERSION,

    /** 数据概览 */
    totalDone: 0,
    accuracy: 0,
    streakDays: 0,
    todayCount: 0,
    wrongCount: 0,

    /** 当前设置值，用于在列表右侧展示 */
    examName: '未设置',
    groupSize: 20,

    /** 云端是否可用，false 时显示"本地模式"提示 */
    online: false,

    /**
     * 功能列表
     * 【为什么用数据驱动而不是在 WXML 里写死五个 view】
     * 这样以后加一项功能只改这个数组，不用动 WXML，
     * 而且每一项的点击靠 data-key 分发，逻辑集中在一个方法里。
     * key 是约定的跳转标识，onMenuTap 里 switch 分发。
     * desc（右侧说明文字）需要读实时数据，所以由 _refresh 统一重建。
     */
    menuList: []
  },

  /* ============ 生命周期 ============ */

  /**
   * onLoad —— 初始化
   */
  onLoad() {
    this._refresh();
  },

  /**
   * onShow —— 每次进入都刷新
   *
   * 【为什么不能只在 onLoad 读数据】
   * 用户可能刚在"学习数据"页或刷题页操作完，
   * 回到"我的"必须看到最新的数字和设置值。
   */
  onShow() {
    this._refresh();
  },

  /* ============ 私有方法 ============ */

  /**
   * 刷新所有展示数据
   *
   * 【为什么要整体包 try】
   * 云端状态、云端倒计时、本地进度，
   * 任何一个环节读失败都不该让整页白屏。
   * store.js 内部已经做了降级，这里再包一层是防御性编程。
   */
  _refresh() {
    try {
      const progress = store.getProgress();
      const stats = bank.getStats(progress);
      const settings = store.getSettings();
      const examInfo = store.getExamInfo();

      /**
       * 【倒计时名称的取值逻辑】
       * 优先用 App 里算好的（app.js 在登录成功后会重新计算，
       * 避免用户改本地时间导致倒计时不准），
       * App 里没有就退回本地缓存，再没有就显示"未设置"。
       *
       * 【坑】用户刚点过"清除全部数据"时，
       * localStorage 里的缓存被清空了，但 App.globalData.examInfo
       * 还留着清除前的那份，页面会显示一个已经不存在的场次。
       * 所以加一条判断：App 里的那份如果没有可用场次，就用本地缓存。
       */
      let examName = '未设置';
      const app = getApp();
      let info = (app && app.globalData && app.globalData.examInfo) || null;
      if (!info || !info.available) {
        // App 里没有可用信息，退回本地缓存
        info = examInfo;
      }
      if (info && info.available && info.name) {
        examName = info.name;
      }

      const groupSize = settings.groupSize || 20;
      const wrongCount = store.getWrongBook().length;

      this.setData({
        totalDone: stats.done,
        accuracy: stats.accuracy,
        streakDays: store.getStreakDays(),
        todayCount: store.getTodayCount(),
        wrongCount: wrongCount,
        examName: examName,
        groupSize: groupSize,
        online: cloud.isOnline(),
        /**
         * 【注意】菜单里的错题数要用本次刚读到的 wrongCount，
         * 不能读 this.data.wrongCount——
         * 那还是上一次刷新的值，用户刚做完题回来会看到旧数字。
         */
        menuList: this._buildMenu(examName, groupSize, wrongCount)
      });
    } catch (e) {
      console.error('[mine] 刷新数据失败', e);
    }
  },

  /**
   * 构建功能列表
   *
   * 【为什么每次刷新都要重建这个数组】
   * 因为列表右侧的说明文字（当前场次、当前题量、错题数）
   * 都是会变的。如果只在初始化时建一次数组，
   * 用户改了设置之后列表右侧还是旧值，会以为设置没生效。
   *
   * @param {string} examName 当前考试场次名
   * @param {number} groupSize 当前每组题量
   * @param {number} wrongCount 当前错题数
   * @returns {Array}
   */
  _buildMenu(examName, groupSize, wrongCount) {
    return [
      { key: 'exam', label: '考试倒计时设置', value: examName },
      { key: 'groupSize', label: '每组题量', value: groupSize + ' 题' },
      { key: 'wrongbook', label: '错题本', value: wrongCount + ' 道' },
      { key: 'stats', label: '学习数据', value: '' },
      { key: 'guide', label: '使用说明', value: '' }
    ];
  },

  /* ============ 交互事件 ============ */

  /**
   * 功能列表点击分发
   *
   * 【为什么用一个方法而不是五个】
   * WXML 的 bindtap 只能传字符串参数，
   * 所以用 data-key 区分是哪一项，在 JS 里 switch 分发。
   * 这样新增功能时只改 menuList 数组，不用改 WXML 和事件绑定。
   *
   * 【为什么用 switch 而不是一串 if】
   * 一串 if 也能跑，但项目变大后不好维护，
   * switch 意图更清晰，加新分支时不容易漏。
   *
   * @param {object} e 事件对象
   */
  onMenuTap(e) {
    const key = e.currentTarget.dataset.key;
    switch (key) {
      case 'exam':
        this._pickExam();
        break;
      case 'groupSize':
        this._pickGroupSize();
        break;
      case 'wrongbook':
        // 【为什么用 switchTab】错题本是 tabBar 页，必须用 switchTab
        wx.switchTab({ url: '/pages/wrongbook/wrongbook' });
        break;
      case 'stats':
        wx.switchTab({ url: '/pages/stats/stats' });
        break;
      case 'guide':
        this._goGuide();
        break;
      default:
        // 未知 key 说明 menuList 和分发逻辑不同步，记日志便于排查
        console.warn('[mine] 未知的菜单项：' + key);
        break;
    }
  },

  /**
   * 选择考试场次
   *
   * 【为什么用 store.pickExamSession 而不是自己算倒计时】
   * 倒计时的计算规则（考试当天算 0 天、过期场次自动降级到下一场、
   * 报名阶段判断）都写在 store.buildExamInfo 里，
   * 页面里重复实现一遍必然出现两套逻辑不一致的 bug。
   * 正确做法是：页面只负责收集用户选择，计算交给 store。
   */
  _pickExam() {
    const list = config.examDates.written;
    if (!list || !list.length) {
      wx.showToast({ title: '暂无可选场次', icon: 'none' });
      return;
    }

    const currentKey = this.data.examName;

    /**
     * 【ActionSheet 的 itemList 有长度上限】
     * 微信规定 itemList 最多 6 项，超出会直接失败。
     * 现在只有 3 场考试，安全。
     * 以后如果要加到 7 场以上，得改成自绘弹层。
     */
    wx.showActionSheet({
      itemList: list.map((d) => d.name + '（' + d.written + '）'),
      success: (res) => {
        const picked = list[res.tapIndex];
        if (!picked) return;
        // 选了当前场次就不用做任何事，避免无意义的写入
        if (picked.name === currentKey) return;

        // 交给 store 算倒计时，页面不重复实现业务规则
        const info = store.pickExamSession(picked.key, config.examDates);

        /**
         * 【踩坑记录】store.pickExamSession 返回的对象里没有 pickedKey 字段，
         * 但 app.js 的 onShow 是靠 info.pickedKey 来记住用户选了哪一场的。
         * 不手动补上这个字段，用户下次冷启动会又回到"最近一场"，
         * 选了上半年却显示下半年。
         * 所以这里显式挂上 pickedKey 再存回去。
         */
        info.pickedKey = picked.key;
        store.setExamInfo(info);

        /**
         * 【踩坑记录】这里必须用 info.name 而不是 picked.name。
         * store.buildExamInfo 有一条规则：用户选的场次如果已经考完了，
         * 会自动降级到"最近一场未过期的"。
         * 比如今天已经是 10 月，用户还选"2026上半年笔试"（3 月已考），
         * store 返回的其实是"2027上半年笔试"。
         * 如果 toast 显示 picked.name（用户选的），而界面显示 info.name
         * （实际生效的），两处对不上，用户会以为程序有 bug。
         * 所以统一用 info.name，用户看到的和实际生效的始终一致。
         */
        const realName = info.available ? info.name : picked.name;

        /**
         * 【顺序很关键：先更新全局副本，再刷新界面】
         * _refresh() 里读的是 App.globalData.examInfo，
         * 如果先刷新再更新全局副本，_refresh 读到的还是旧值，
         * 界面会显示旧场次。所以必须反过来的顺序。
         *
         * 【为什么要更新全局副本】
         * 首页的倒计时读的是globalData.examInfo，不是本地缓存。
         * 用户在"我的"页换了场次后回首页，
         * 不更新全局副本的话首页会显示的还是旧场次。
         */
        const app = getApp();
        if (app && app.globalData) {
          app.globalData.examInfo = info;
        }

        /**
         * 【关键】这里必须调 _refresh()，不能只 setData({ examName })
         * 因为菜单列表（menuList）里也存了一份场次名称，
         * 只改 examName 的话，用户会看到"标题变成了新场次，
         * 但列表右侧还是旧值"这种自相矛盾的界面。
         * _refresh() 会统一从最新的数据重建所有展示字段。
         */
        this._refresh();

        // 选中的场次和实际生效的不一致时，额外说明原因
        if (realName !== picked.name) {
          wx.showToast({ title: '该场已过，已切换到' + realName, icon: 'none', duration: 2000 });
        } else {
          wx.showToast({ title: '已切换到' + realName, icon: 'none' });
        }
      }
    });
  },

  /**
   * 选择每组题量
   */
  _pickGroupSize() {
    wx.showActionSheet({
      itemList: GROUP_SIZES.map((n) => n + ' 题'),
      success: (res) => {
        const size = GROUP_SIZES[res.tapIndex];
        if (!size) return;
        if (size === this.data.groupSize) return;

        // saveSettings 是"合并保存"，只传要改的字段，
        // 不会把 lastSubject 等其他设置覆盖掉
        store.saveSettings({ groupSize: size });

        /**
         * 【为什么要调 _refresh() 而不是只 setData({ groupSize })】
         * 菜单列表右侧也显示着"20 题"这样的题量文字，
         * 只改 groupSize 会出现"标题变了、列表没变"的自相矛盾。
         * _refresh() 会把groupSize 和 menuList 一起更新。
         */
        this._refresh();
        wx.showToast({ title: '每组 ' + size + ' 题', icon: 'none' });
      }
    });
  },

  /**
   * 跳到使用说明
   *
   * 【为什么要判断 guide 页面存不存在】
   * app.json 里注册了 pages/guide/guide，
   * 但如果那个页面的文件还没写，navigateTo 会静默失败，
   * 用户点了没有任何反应，以为按钮坏了。
   * 这里加一个 fail 回调给出提示，把问题暴露出来而不是石沉大海。
   */
  _goGuide() {
    wx.navigateTo({
      url: '/pages/guide/guide',
      fail: () => {
        wx.showToast({ title: '使用说明页面建设中', icon: 'none' });
      }
    });
  },

  /**
   * 清除全部本地数据
   *
   * 【为什么必须二次确认，而且要说清后果】
   * store.clearAll() 调的是 wx.clearStorageSync()，
   * 会删掉本小程序的所有本地数据：答题进度、错题本、每日题量、设置。
   * 这些数据没有任何备份（云端同步要等开通后才有），
   * 删掉就只能从头再来。这种不可逆操作一定要让用户清楚后果。
   */
  onClearAll() {
    wx.showModal({
      title: '清除全部数据？',
      content: '将删除答题进度、错题本、每日题量和所有设置，且无法恢复。',
      confirmText: '确认清除',
      confirmColor: '#F04438',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;

        const ok = store.clearAll();
        if (!ok) {
          wx.showToast({ title: '清除失败，请重试', icon: 'none' });
          return;
        }

        /**
         * 【关键】清除后必须重新初始化，否则界面还是旧数据。
         * clearAll 顺带把考试场次选择也清了，
         * 所以这里要重新算一次倒计时并写回缓存。
         *
         * 【为什么要额外更新 App.globalData】
         * App.globalData.examInfo 是全站共用的倒计时副本，
         * 首页读的是它而不是本地缓存。
         * 只更新本地缓存的话，用户回首页会看到清除前的老倒计时，
         * 而且这个脏数据会一直留在内存里，直到小程序重启。
         */
        const info = store.buildExamInfo(config.examDates, Date.now());
        store.setExamInfo(info);

        // 同步更新全局副本，保证首页等页面读到的是新值
        const app = getApp();
        if (app && app.globalData) {
          app.globalData.examInfo = info;
        }

        this._refresh();
        wx.showToast({ title: '已清除', icon: 'success' });
      }
    });
  },

  /**
   * 意见反馈
   *
   * 【为什么只弹窗不给跳转】
   * 个人主体小程序没法直接发邮件、也不能内嵌网页。
   * 微信官方推荐的方式就是引导用户去代码仓库提 issue。
   * showModal 用 showCancel:false 强制用户点"知道了"，
   * 相当于一个"已读回执"。
   */
  onFeedback() {
    wx.showModal({
      title: '意见反馈',
      content: '这个版本还在开发中，遇到问题或想要新功能，请在项目代码仓库提交 issue，我会尽快处理。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /**
   * 分享
   *
   * 【为什么这里也做分享】
   * 个人开发者没有投放预算，分享是唯一能立刻带来新用户的手段。
   * 用户在"我的"页看到自己的数据时分享意愿最高
   * （"我刷了 500 题"本身就是社交货币）。
   */
  onShareAppMessage() {
    const days = this.data.streakDays;
    return {
      title: '我已连续刷题 ' + days + ' 天，一起来练教资',
      path: config.share.path
    };
  }
});