# -*- coding: utf-8 -*-
"""出题六项自查 + 近似查重（正式工具，长期保留）

【为什么需要它】前几批出题，每批都在自查环节逮到问题：
引号转义、中英混杂、选项重复、id 撞号、**考点与已入库题目重复**。
最后这类最危险 —— 用户刷到重复题会以为程序坏了，而它肉眼最难发现。

本工具一次性检查六项：
1. 乱码字符
2. 混入的英文单词
3. 选项与评分点结构
4. id 重复与撞号
5. 中文引号配对
6. 与已入库题目的近似重复（同模块 + 中文二元组重合度）

【怎么用】
把待导入的题目存成一个 JSON 文件（可以是题目数组，
也可以是 add_questions.py 那种 {"subject": "1", "questions": [...]} 结构），
然后执行：

    python tools/check_new_questions.py 待检查.json

六项全过再执行 add_questions.py 导入。
顺序不能反 —— 导入会直接改题库文件，先查后导才安全。
"""
import io
import json
import re
import sys

BANK = {
    'subject1': 'miniprogram/data/subject1.json',
    'subject2': 'miniprogram/data/subject2.json',
}
ALLOW_EN = {'Rome', 'Seligman', 'ZPD', 'Fuller', 'Brown', 'Comenius',
            'Swift', 'Bible', 'Comiskey'}


def toks(s):
    """提取中文二元组，用于粗略相似度"""
    s = re.sub(r'[（）()　\s「」【】《》"\'’,，。？！：、]', '', s)
    return set(s[i:i + 2] for i in range(len(s) - 1) if re.match('[一-鿿]', s[i:i + 2]))


def sim(a, b):
    ta, tb = toks(a), toks(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def check_quote_pair(text):
    """用栈检测中文引号是否配对"""
    st = []
    for ch in text:
        if ch == '「':
            st.append(1)
        elif ch == '」':
            if not st:
                return False
            st.pop()
    return not st


def check_quote_nested(text):
    """检测引号嵌套错误。

    【为什么单独加这项】
    栈式检测只管数量配不配平，但下面这种写法数量是配平的却是错的：
        「五岳「中被称为」西岳」的是
    外层引号被内层提前闭合，读起来完全不通。
    实测题库里真的出现过这道错题（s1-021c），而自查工具没拦住。

    中文正文里不该出现嵌套，正确写法是并列：
        「五岳」中被称为「西岳」的是
    """
    depth = 0
    for ch in text:
        if ch == '「':
            depth += 1
            if depth > 1:
                return False
        elif ch == '」':
            depth -= 1
    return True


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print('用法：python tools/check_new_questions.py 待检查.json [subject1|subject2]')
        return 2
    new_path = sys.argv[1]
    target = sys.argv[2] if len(sys.argv) > 2 else 'subject1'

    new = json.load(io.open(new_path, encoding='utf-8'))
    raw = io.open(new_path, encoding='utf-8').read()

    # 兼容两种输入格式：
    #   ① 裸数组 [ {...}, ... ]          —— 生成脚本的原始输出
    #   ② {"subject": "1", "questions": [...]} —— add_questions.py 期望的格式
    if isinstance(new, dict):
        new = new['questions']

    problems = []

    # 1 乱码
    n = raw.count('\ufffd')
    if n:
        problems.append('乱码字符 %d 个' % n)

    # 2 混入英文
    en = []
    for q in new:
        fields = [q.get('stem', ''), q.get('explain', '')]
        fields += q.get('points', [])
        fields += [o['text'] for o in q.get('options', [])]
        for f in fields:
            for w in re.findall(r'[a-zA-Z]{2,}', f):
                if w not in ALLOW_EN:
                    en.append('%s: %s' % (q['id'], w))
    if en:
        problems.append('混入英文 -> ' + ', '.join(sorted(set(en))))

    # 3 结构
    for q in new:
        if q['type'] == 'single':
            if len(q['options']) != 4:
                problems.append('%s 选项数=%d' % (q['id'], len(q['options'])))
            keys = [o['key'] for o in q['options']]
            if keys != ['A', 'B', 'C', 'D']:
                problems.append('%s 选项key序异常 %s' % (q['id'], keys))
            texts = [o['text'] for o in q['options']]
            if len(set(texts)) != len(texts):
                problems.append('%s 选项内容重复' % q['id'])
            if any(not t.strip() for t in texts):
                problems.append('%s 有空选项' % q['id'])
            if q['answer'][0] not in keys:
                problems.append('%s 答案越界' % q['id'])
        elif q['type'] == 'judge':
            if len(q['options']) != 2:
                problems.append('%s 判断题选项数异常' % q['id'])
            if q['answer'][0] not in ['A', 'B']:
                problems.append('%s 判断题答案不是A/B' % q['id'])
        elif q['type'] == 'material':
            if not q.get('points'):
                problems.append('%s 缺评分点' % q['id'])
            # 【修正】原先这里写了「材料题不应有 answer 字段」，
            # 与 add_questions.py 的「主观题必须有参考答案」正好矛盾。
            # 正确约定是两者都要：answer 给出参考答案要点，points 给判分引擎用。
            if not q.get('answer'):
                problems.append('%s 缺参考答案（answer）' % q['id'])
            # 题干必须含明确提问，否则学生不知道要答什么
            asks = ['请结合', '请回答', '请分析', '请评析', '请谈谈',
                    '试分析', '请说明', '简述']
            if not any(k in q.get('stem', '') for k in asks):
                problems.append('%s 材料题题干缺少明确提问' % q['id'])
        if q.get('difficulty') not in (1, 2, 3):
            problems.append('%s 难度非法' % q['id'])
        if not q.get('explain', '').strip():
            problems.append('%s 缺解析' % q['id'])

    # 4 id
    ids = [q['id'] for q in new]
    dup = [x for x in set(ids) if ids.count(x) > 1]
    if dup:
        problems.append('批内 id 重复: %s' % dup)

    # id 前缀必须与所在题库科目一致
    # 【真实教训】题库里出现过 s2-402L 混在 subject1.json 的 law 模块里，
    # 单看每个文件都合法（不重复、不撞号），但跨科目统计会把它算错科目，
    # 去重也会漏检。这类错误只有跨文件比对才看得出来。
    want_prefix = 's1-' if target == 'subject1' else 's2-'
    wrong = [q['id'] for q in new if not q['id'].startswith(want_prefix)]
    if wrong:
        problems.append('id 前缀与科目不符（%s 应以 %s 开头）: %s'
                        % (target, want_prefix, wrong))

    exist = set()
    for path in BANK.values():
        exist |= {x['id'] for x in json.load(io.open(path, encoding='utf-8'))['questions']}
    clash = [i for i in ids if i in exist]
    if clash:
        problems.append('与现有题库撞号: %s' % clash)

    # 5 引号配对
    for q in new:
        for f in ['stem', 'explain']:
            if not check_quote_pair(q.get(f, '')):
                problems.append('%s %s 中文引号未配对' % (q['id'], f))
            elif not check_quote_nested(q.get(f, '')):
                problems.append('%s %s 中文引号嵌套错误（应改用并列引号）'
                                % (q['id'], f))

    # 6 近似重复
    #
    # 【阈值说明】中文二元组对短题干极易撞词，阈值低了会大量误报。
    # 实测：「教育必须为社会主义现代化建设服务」与「我国教育基本制度不包括」
    # 都有"教育""制度"等常用词，二元组重合度 0.56，但考点完全不同。
    # 阈值定在 0.65：低于 0.65 基本是撞词，0.65 以上基本是真重复。
    #
    # 所以本工具报出的是「疑似」，每一处都必须人工核对题干与答案，
    # 核对后确认不同的可以在 KNOWN_DIFF 中登记，避免下次重复核对。
    #
    # 真正该拦的是「题干几乎一样、答案也一样」的，那会让用户以为程序坏了。
    KNOWN_DIFF = set()
    old = json.load(io.open(BANK[target], encoding='utf-8'))['questions']
    dups = []
    for a in new:
        if a['type'] == 'material':
            continue
        for b in old:
            if b['module'] != a['module'] or b['type'] == 'material':
                continue
            r = sim(a['stem'], b['stem'])
            # 更高阈值：短题干撞词在0.6 以下很常见，0.65 以上基本是真重复
            if r >= 0.65 and (a['id'], b['id']) not in KNOWN_DIFF:
                dups.append('%.2f %s ~ %s' % (r, a['id'], b['id']))
    # 批内互查用同样阈值
    for i, a in enumerate(new):
        if a['type'] == 'material':
            continue
        for b in new[i + 1:]:
            if b['module'] != a['module'] or b['type'] == 'material':
                continue
            r = sim(a['stem'], b['stem'])
            if r >= 0.65:
                dups.append('%.2f %s ~ %s (批内)' % (r, a['id'], b['id']))
    if dups:
        problems.append('疑似近似重复(需人工核对)-> ' + '; '.join(sorted(set(dups))))

    print('共 %d 题' % len(new))
    if problems:
        print('发现 %d 类问题：' % len(problems))
        for p in problems:
            print('  - %s' % p)
        return 1
    print('六项自查全部通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())