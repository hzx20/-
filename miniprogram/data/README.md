/**
 * data/README.md —— 题库结构设计说明
 *
 * 【为什么题库放本地 JSON 而不是云数据库】
 * 云数据库每次都要联网拉，弱网下打开就是白屏；本地 JSON 打进小程序包里，
 * 打开秒出。170 道题的 JSON 约 60KB，距离主包 2MB 上限还很远。
 * 后续题库涨到几千题时，再改成"本地留核心包 + 云端增量下发"的方案。
 *
 * 【单文件结构】
 * {
 *   subject: 科目代号 1=综合素质 2=教育知识与能力,
 *   title: 科目全名,
 *   modules: [ { key, name, desc, weight } ],   ← 模块，页面上按模块分组
 *   questions: [ ... ]                            ← 题目数组
 * }
 *
 * 【单题结构】
 * {
 *   id: 's1-001',            唯一编号，同一科目内不能重复
 *   module: 'career',        所属模块 key
 *   type: 'single',          single=单选 material=材料分析 essay=写作 judge=判断
 *   stem: '题干',             材料分析题时这里是完整材料文本
 *   options: [               选项，single 用 4 个，judge 用 2 个
 *     { key:'A', text:'选项内容' }
 *   ],
 *   answer: ['A'],           数组形式，材料题/写作题放评分点
 *   points: ['评分点1','评分点2'],  仅材料题/写作题使用
 *   explain: '解析',          为什么选/为什么错
 *   difficulty: 2,           1=简单 2=中等 3=困难
 *   source: '2024上真题'     出处，标注清楚，也方便后续补真题时区分
 * }
 *
 * 【后续怎么扩充题库】
 * 1. 直接在本目录新建 subject3.json（科目三/面试），然后在 bank.js 里注册
 * 2. 用 tools/ 目录下的脚本做格式校验，避免手写 JSON 打错括号导致整个页面崩溃
 * 3. 真题来源建议：教育部考试中心官网、各省考试院公告、公开真题汇编
 */

{
  "subject": 1,
  "code": "subject1",
  "title": "综合素质",
  "shortTitle": "科目一",
  "modules": [
    { "key": "career", "name": "职业理念", "desc": "教育观 / 学生观 / 教师观，笔试性价比最高的一块", "weight": 3 },
    { "key": "law", "name": "教育法律法规", "desc": "宪法、教育法、义务教育法、教师法、未成年人保护法", "weight": 2 },
    { "key": "ethics", "name": "教师职业道德", "desc": "三爱两人一终身 + 中小学教师职业行为十项准则", "weight": 2 },
    { "key": "culture", "name": "文化素养", "desc": "历史文化常识、科技常识、传统文化，范围广靠积累", "weight": 2 },
    { "key": "ability", "name": "基本能力", "desc": "阅读理解、逻辑推理、信息处理、写作", "weight": 2 }
  ],
  "questions": []
}