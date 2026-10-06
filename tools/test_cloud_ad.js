/**
 * tools/test_cloud_ad.js —— 云调用与广告的降级测试
 *
 * 【这个测试在验证什么】
 * 本项目的第一原则是：云端挂了、广告没开通，用户照样能正常刷题。
 * 这类"降级逻辑"是最容易被写坏、又最难靠肉眼发现的部分——
 * 代码看着没问题，但一旦云函数没部署，页面白屏，用户直接卸载。
 * 所以必须用测试把它钉死。
 *
 * 跑法：node tools/test_cloud_ad.js
 */

// ===== 假 wx 环境 =====
let callFunctionImpl = function () {
  return Promise.reject(new Error('cloud function not deployed'));
};

global.wx = {
  getSystemInfoSync: function () {
    return { SDKVersion: '2.30.0' };
  },
  cloud: {
    init: function () { /* 模拟初始化成功 */ },
    callFunction: function (opts) {
      return callFunctionImpl(opts);
    }
  }
};

const path = require('path');
const cloud = require(path.join(__dirname, '..', 'miniprogram', 'core', 'cloud.js'));
const ad = require(path.join(__dirname, '..', 'miniprogram', 'core', 'ad.js'));

let pass = 0, fail = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else {
    fail++; failures.push(name);
    console.log('  FAIL  ' + name);
    console.log('        实际: ' + JSON.stringify(actual));
    console.log('        期望: ' + JSON.stringify(expected));
  }
}
function checkTrue(name, cond) { check(name, !!cond, true); }

(async function () {

  console.log('\n=== 1. 云环境未配置时的降级 ===');
  cloud._reset();
  cloud.init('your-env-id');
  check('未配置 env 时 isOnline 为 false', cloud.isOnline(), false);

  const oid1 = await cloud.login();
  check('未配置 env 时 login 返回空字符串', oid1, '');
  check('未配置 env 时 login 不抛错（关键）', true, true);

  const r1 = await cloud.callFunction('getStats', {});
  check('未初始化时 callFunction 返回 null', r1, null);

  const sub1 = await cloud.submitRecords([{ qid: 'x', correct: true }]);
  check('未初始化时 submitRecords 返回 false', sub1, false);

  const ai1 = await cloud.callAI({ test: 1 });
  check('AI 接口降级返回 null', ai1, null);

  console.log('\n=== 2. 云函数部署失败时的降级（关键场景）===');
  cloud._reset();
  cloud.init('real-env-id');
  // 此时 init 成功，但调用会失败——这是最常见的"配了一半"状态
  callFunctionImpl = function () {
    return Promise.reject(new Error('cloud function not deployed'));
  };

  const start = Date.now();
  const r2 = await cloud.callFunction('getStats', {}, 1000);
  const elapsed = Date.now() - start;
  check('云函数失败时返回 null', r2, null);
  checkTrue('云函数失败时不 reject（否则页面崩）', true);
  checkTrue('失败返回足够快（未等满超时）: ' + elapsed + 'ms', elapsed < 800);

  const oid2 = await cloud.login();
  check('云函数失败时 login 返回空字符串', oid2, '');

  console.log('\n=== 3. 超时保护 ===');
  cloud._reset();
  cloud.init('real-env-id');
  // 模拟一个永远不返回的云函数
  callFunctionImpl = function () { return new Promise(function () { }); };

  const t0 = Date.now();
  const r3 = await cloud.callFunction('getStats', {}, 200);
  const t3 = Date.now() - t0;
  check('超时后返回 null', r3, null);
  checkTrue('超时时间可配置（200ms 实际约 ' + t3 + 'ms）', t3 < 600);

  console.log('\n=== 4. 迟到的响应不能污染结果 ===');
  cloud._reset();
  cloud.init('real-env-id');
  // 模拟"超时后才返回"的请求
  callFunctionImpl = function () {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve({ result: { ok: true } }); }, 400);
    });
  };
  const r4 = await cloud.callFunction('getStats', {}, 100);
  check('超时后忽略迟到响应', r4, null);

  console.log('\n=== 5. 云端正常时能取到数据 ===');
  cloud._reset();
  cloud.init('real-env-id');
  callFunctionImpl = function (opts) {
    if (opts.name === 'login') {
      return Promise.resolve({ result: { openid: 'o6_test_openid' } });
    }
    if (opts.name === 'getStats') {
      return Promise.resolve({
        result: { success: true, stats: { totalAnswered: 30, accuracy: 73 } }
      });
    }
    return Promise.resolve({ result: { success: true, count: 2 } });
  };

  const oid3 = await cloud.login();
  check('正常时拿到 openid', oid3, 'o6_test_openid');
  check('登录成功后 isOnline 为 true', cloud.isOnline(), true);

  // 【回归用例】曾出现过"调用成功但没返回 openid"导致登录永久失效的 bug。
  // 关键点：拿不到 openid 时不能标记为已登录，否则之后永远走缓存返回空串。
  cloud._reset();
  cloud.init('real-env-id');
  let attempt = 0;
  callFunctionImpl = function (opts) {
    if (opts.name === 'login') {
      attempt++;
      // 第一次：云函数"成功"但没返回 openid（模拟内部出错）
      if (attempt === 1) return Promise.resolve({ result: { openid: '' } });
      // 第二次：恢复正常
      return Promise.resolve({ result: { openid: 'o6_recovered' } });
    }
    return Promise.resolve({ result: { success: true, stats: { totalAnswered: 30 } } });
  };
  const badOid = await cloud.login();
  check('空 openid 返回空字符串', badOid, '');
  check('空 openid 不标记为已登录', cloud.isOnline(), false);

  // 关键：必须能重试成功，而不是永久返回空
  const retryOid = await cloud.login();
  check('下一次登录能重试成功（不永久失效）', retryOid, 'o6_recovered');
  check('确实发起了第二次请求', attempt, 2);

  // 重复登录应走缓存，不重复发请求
  let callCount = 0;
  callFunctionImpl = function () {
    callCount++;
    return Promise.resolve({ result: { openid: 'o6_cached' } });
  };
  const a = await cloud.login();
  const b = await cloud.login();
  check('重复登录不重复发请求（用缓存）', callCount, 0);
  check('缓存的 openid 一致', a, b);

  // fetchStats 依赖 openid。
  // 【踩坑记录】这一段最初连着失败三次，原因依次是：
  //   1. _reset() 后忘了重新 init，initialized=false 直接短路
  //   2. _reset() 后没重新登录，openid 为空 fetchStats 短路
  //   3. 上一段用例改写了 callFunctionImpl，这一段没有覆盖回支持 login 的版本
  // 所以 _reset 之后必须完整重做三件事：init → 设 mock → login
  cloud._reset();
  cloud.init('real-env-id');
  callFunctionImpl = function (opts) {
    if (opts.name === 'login') {
      return Promise.resolve({ result: { openid: 'o6_for_stats' } });
    }
    return Promise.resolve({
      result: { success: true, stats: { totalAnswered: 30, accuracy: 73 } }
    });
  };
  await cloud.login();
  const st = await cloud.fetchStats();
  check('能取到云端统计', st && st.stats && st.stats.totalAnswered, 30);
  check('fetchStats 后 openid 有效', cloud.isOnline(), true);

  console.log('\n=== 6. 广告开关逻辑 ===');
  check('adsEnabled=false 时 isAvailable 为 false', ad.isAvailable(), false);
  check('SDK 2.30.0 支持流量主', ad.isSupported(), true);

  global.wx.getSystemInfoSync = function () { return { SDKVersion: '1.9.0' }; };
  check('SDK 1.9.0 不支持流量主', ad.isSupported(), false);
  global.wx.getSystemInfoSync = function () { return { SDKVersion: '1.9.88' }; };
  check('SDK 1.9.88 支持流量主', ad.isSupported(), true);
  global.wx.getSystemInfoSync = function () { return { SDKVersion: '2.30.0' }; };

  // getSystemInfoSync 抛异常时不能崩
  global.wx.getSystemInfoSync = function () { throw new Error('fail'); };
  check('SDK 查询异常时安全返回 false', ad.isSupported(), false);
  global.wx.getSystemInfoSync = function () { return { SDKVersion: '2.30.0' }; };

  console.log('\n=== 7. 广告不可用时不阻塞流程（关键）===');
  let rewarded = false;
  ad.showRewardedVideo({ onSuccess: function () { rewarded = true; } });
  await new Promise(function (r) { setTimeout(r, 60); });
  checkTrue('激励视频不可用时仍触发 onSuccess（不卡住用户）', rewarded);

  let interstitial = false;
  ad.showInterstitial(function () { interstitial = true; });
  await new Promise(function (r) { setTimeout(r, 60); });
  checkTrue('插屏不可用时仍触发 onClose', interstitial);

  console.log('\n=== 8. 奖励判定逻辑 ===');
  check('看完广告才给奖励', ad.shouldReward({ isEnded: true }), true);
  check('中途关闭不给奖励', ad.shouldReward({ isEnded: false }), false);
  check('无参数不给奖励', ad.shouldReward(), false);
  check('无参数不给奖励（空对象）', ad.shouldReward({}), false);

  console.log('\n' + '='.repeat(46));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail > 0) {
    console.log('失败：' + failures.join(', '));
    process.exit(1);
  }
  console.log('全部通过。');
  process.exit(0);

})();