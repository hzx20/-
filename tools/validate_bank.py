#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/validate_bank.py —— 题库格式校验脚本

【什么时候用】每次手动编辑 miniprogram/data/*.json 之后、提交代码之前，跑一遍。
【为什么需要】题库 JSON 有几百上千道题，手写时极容易出现：
  - 多打一个逗号（JSON 解析直接报错，整个小程序白屏）
  - 题目 id 重复（作答记录会串到别的题上）
  - 答案写了选项里不存在的字母（用户永远看不到正确答案）
  - 漏写 fields 导致页面渲染出 undefined
这类错误在小程序里表现是「白屏」或「答案永远不对」，非常难定位。
所以在提交前用脚本拦住，是最省事的做法。

【怎么用】在项目根目录执行：
  python tools/validate_bank.py

【退出码】0 = 全部通过；1 = 有问题（问题清单会打印在终端）
"""

import json
import io
import glob
import os
import sys

# 题库文件所在目录
DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'miniprogram', 'data'
)

# 单选题必须有 4 个选项，判断题必须有 2 个
REQUIRED_OPTION_COUNT = {
    'single': 4,
    'judge': 2,
    'material': 0,
    'essay': 0
}

# 每道题必须具备的字段
REQUIRED_FIELDS = ['id', 'module', 'type', 'stem', 'explain', 'difficulty']


def validate_file(path):
    """校验单个题库文件，返回问题列表"""
    problems = []

    # 第一步：先确认 JSON 本身能解析。这一步挂了后面的检查都做不了。
    try:
        with io.open(path, encoding='utf-8') as f:
            data = json.load(f)
    except ValueError as e:
        return ['JSON 语法错误：%s（多半是多了个逗号或中文引号）' % e]

    # 第二步：检查顶层结构
    for key in ['subject', 'code', 'title', 'modules', 'questions']:
        if key not in data:
            problems.append('顶层缺少字段：%s' % key)
    if problems:
        return problems

    module_keys = set()
    for m in data['modules']:
        for key in ['key', 'name', 'desc', 'weight']:
            if key not in m:
                problems.append('模块 %s 缺少字段 %s' % (m.get('key', '?'), key))
        module_keys.add(m['key'])

    # 第三步：逐题检查
    seen_ids = set()
    for q in data['questions']:
        qid = q.get('id', '<无 id>')

        # id 重复检查：重复会导致两条作答记录互相覆盖
        if qid in seen_ids:
            problems.append('%s 题目 id 重复' % qid)
        seen_ids.add(qid)

        # 必填字段
        for field in REQUIRED_FIELDS:
            if field not in q:
                problems.append('%s 缺少字段 %s' % (qid, field))

        # 所属模块必须真实存在，否则页面上按模块分组时这题会消失
        if q.get('module') not in module_keys:
            problems.append('%s 的 module 值 "%s" 在 modules 里不存在'
                            % (qid, q.get('module')))

        qtype = q.get('type')
        if qtype not in REQUIRED_OPTION_COUNT:
            problems.append('%s 的 type 值 "%s" 不合法' % (qid, qtype))
            continue

        options = q.get('options', [])
        answer = q.get('answer', [])

        # 选择题：选项数量与选项键唯一性
        if qtype in ('single', 'judge'):
            if len(options) != REQUIRED_OPTION_COUNT[qtype]:
                problems.append('%s 是 %s 题，选项数应为 %d，实际 %d'
                                % (qid, qtype, REQUIRED_OPTION_COUNT[qtype], len(options)))

            keys = [o.get('key') for o in options]
            if len(keys) != len(set(keys)):
                problems.append('%s 选项 key 重复' % qid)
            for o in options:
                if 'key' not in o or 'text' not in o:
                    problems.append('%s 存在缺少 key 或 text 的选项' % qid)

            # 答案必须落在选项里，且选择题只能有一个答案
            if set(answer) - set(keys):
                problems.append('%s 的答案 %s 里有选项里不存在的字母（选项：%s）'
                                % (qid, answer, keys))
            if qtype == 'single' and len(answer) != 1:
                problems.append('%s 是单选题，答案必须只有 1 个' % qid)

        # 材料分析题 / 写作题：必须有评分点，否则无法自动判分
        if qtype in ('material', 'essay'):
            if not q.get('points'):
                problems.append('%s 是 %s 题，必须提供 points 评分点' % (qid, qtype))

        # 题干和解析不能为空字符串
        for field in ['stem', 'explain']:
            if field in q and not str(q[field]).strip():
                problems.append('%s 的 %s 是空的' % (qid, field))

        # 难度取值范围
        if 'difficulty' in q and q['difficulty'] not in (1, 2, 3):
            problems.append('%s 的 difficulty 只能是 1/2/3，实际 %s'
                            % (qid, q['difficulty']))

    return problems


def main():
    files = sorted(glob.glob(os.path.join(DATA_DIR, '*.json')))
    if not files:
        print('没有找到题库文件，检查路径：%s' % DATA_DIR)
        return 1

    total_questions = 0
    total_problems = 0

    for path in files:
        name = os.path.basename(path)
        problems = validate_file(path)

        try:
            with io.open(path, encoding='utf-8') as f:
                count = len(json.load(f)['questions'])
            total_questions += count
        except Exception:
            count = 0

        if problems:
            total_problems += len(problems)
            print('[FAIL] %s（%d 题）' % (name, count))
            for p in problems:
                print('       - %s' % p)
        else:
            print('[ OK ] %s（%d 题）' % (name, count))

    print('-' * 46)
    print('题库合计 %d 题，发现问题 %d 处' % (total_questions, total_problems))
    if total_problems == 0:
        print('校验通过，可以提交代码。')
        return 0
    print('请先修掉上面的问题再提交。')
    return 1


if __name__ == '__main__':
    sys.exit(main())