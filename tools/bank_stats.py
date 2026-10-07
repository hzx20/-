#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/bank_stats.py —— 题库难度与结构统计

【为什么需要这个】
题库扩到 500+ 题后，光看"有多少题"没意义了。
真正要回答的是：新用户会不会一上来就刷到全难题？某个模块是不是全是硬茬？
所以这个脚本专门做三件事：
  1. 难度分级统计（每个模块的易/中/难分布）
  2. 质量体检（找出"只有难题"、"没有材料分析题"这类失衡模块）
  3. 给出扩充建议（该往哪个模块补多少题）

【怎么用】
python tools/bank_stats.py            # 看统计报表
python tools/bank_stats.py --json     # 机器可读格式，方便以后接页面
"""

import json
import os
import sys
from collections import Counter, defaultdict

# 强制标准输出为 UTF-8，避免 Windows 控制台输出中文乱码
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'miniprogram', 'data')

DIFF_NAMES = {1: '易', 2: '中', 3: '难'}
TYPE_NAMES = {'single': '单选', 'judge': '判断', 'material': '材料分析', 'essay': '写作'}


def load_banks():
    """读取 data/ 下所有题库文件"""
    banks = []
    for name in sorted(os.listdir(DATA_DIR)):
        if not name.startswith('subject') or not name.endswith('.json'):
            continue
        path = os.path.join(DATA_DIR, name)
        with open(path, encoding='utf-8') as f:
            banks.append(json.load(f))
    return banks


def analyze(bank):
    """统计单个科目的结构"""
    questions = bank['questions']
    mod_names = {m['key']: m for m in bank['modules']}

    # 汇总所有出现过的模块 key（防止有题目的 module 没在 modules 里声明）
    used_keys = set(q['module'] for q in questions)

    modules = []
    for key, mod in mod_names.items():
        qs = [q for q in questions if q['module'] == key]
        diff = Counter(q.get('difficulty', 1) for q in qs)
        types = Counter(q['type'] for q in qs)
        modules.append({
            'key': key,
            'name': mod['name'],
            'weight': mod.get('weight', 1),
            'total': len(qs),
            'difficulty': {d: diff.get(d, 0) for d in (1, 2, 3)},
            'types': dict(types),
            # 难度加权：越接近 1 越好上手
            'avg_difficulty': (
                round(sum((q.get('difficulty', 1)) for q in qs) / len(qs), 2)
                if qs else 0
            )
        })

    diff_all = Counter(q.get('difficulty', 1) for q in questions)
    types_all = Counter(q['type'] for q in questions)

    return {
        'subject': bank['subject'],
        'title': bank['title'],
        'total': len(questions),
        'difficulty': {d: diff_all.get(d, 0) for d in (1, 2, 3)},
        'types': dict(types_all),
        'modules': modules,
        # 数据体检：声明了模块但一题都没有的
        'empty_modules': [
            m['name'] for m in modules if m['total'] == 0
        ],
        'orphan_modules': [
            k for k in used_keys if k not in mod_names
        ]
    }


def print_report(results):
    """打印人类可读的统计报表"""
    grand_total = 0
    problems = []

    for r in results:
        total = r['total']
        grand_total += total
        print()
        print('=' * 62)
        print('  %s（%s）  共 %d 题' % (r['title'], r['subject'], total))
        print('=' * 62)

        # 题型分布
        type_str = '  '.join(
            '%s %d' % (TYPE_NAMES.get(t, t), c)
            for t, c in sorted(r['types'].items(), key=lambda x: -x[1])
        )
        print('  题型分布：%s' % type_str)

        # 难度总分布 + 占比
        diff = r['difficulty']
        print('  难度分布：', end='')
        for d in (1, 2, 3):
            pct = diff[d] / total * 100 if total else 0
            bar = '█' * int(pct / 5)
            print('%s %d (%.0f%%) %s' % (DIFF_NAMES[d], diff[d], pct, bar), end='')
        print()

        # 分模块明细
        print()
        print('  %-22s %5s %5s %5s %5s %8s' % ('模块', '题数', '易', '中', '难', '平均难度'))
        print('  ' + '-' * 58)
        for m in r['modules']:
            d = m['difficulty']
            print('  %-22s %5d %5d %5d %5d %8.2f' % (
                m['name'][:20], m['total'], d[1], d[2], d[3], m['avg_difficulty']
            ))

        # 质量体检：发现失衡
        for m in r['modules']:
            if m['total'] == 0:
                problems.append('%s「%s」模块 0 题' % (r['title'], m['name']))
                continue
            # 全是难题：新手打开这个模块会直接劝退
            if m['difficulty'][3] / m['total'] > 0.5 and m['total'] >= 3:
                problems.append(
                    '%s「%s」难题占比 %.0f%%，新手容易受挫（建议补易/中档题）'
                    % (r['title'], m['name'], m['difficulty'][3] / m['total'] * 100)
                )
            # 全是简单题：提分空间为零
            if m['difficulty'][1] / m['total'] > 0.8 and m['total'] >= 3:
                problems.append(
                    '%s「%s」易题占比 %.0f%%，缺少拔高题（建议补难题）'
                    % (r['title'], m['name'], m['difficulty'][1] / m['total'] * 100)
                )
            # 主客观题失衡：材料分析题太少练不到手
            if m['total'] >= 10 and m['types'].get('material', 0) == 0:
                problems.append(
                    '%s「%s」没有材料分析题（主观题判分是本项目卖点，建议补 2-3 道）'
                    % (r['title'], m['name'])
                )

        # 全科难度体检
        if total >= 20:
            hard_pct = diff[3] / total
            if hard_pct > 0.3:
                problems.append(
                    '%s 难题占比 %.0f%% 偏高（超过 30%% 会让新手开局挫败，建议整体降难度）'
                    % (r['title'], hard_pct * 100)
                )

        for k in r['orphan_modules']:
            problems.append('%s 有题目的 module="%s" 未在 modules 中声明' % (r['title'], k))

    # 总量体检
    print()
    print('=' * 62)
    print('  全部科目合计 %d 题' % grand_total)
    print('=' * 62)
    if grand_total < 500:
        print('  距500 题目标还差 %d 题' % (500 - grand_total))
    else:
        print('  已达成 500+ 题目标')

    # 问题汇总
    print()
    if problems:
        print('  发现 %d 个需要关注的问题：' % len(problems))
        for i, p in enumerate(problems, 1):
            print('   %d. %s' % (i, p))
    else:
        print('  数据体检通过，未发现结构性问题')

    print()
    return problems


def build_suggestions(results):
    """根据当前分布，给出该往哪扩的定量建议"""
    print('  扩充建议（按模块权重分配）')
    print('  ' + '-' * 58)
    for r in results:
        total = r['total']
        if total == 0:
            continue
        print()
        print('  %s（当前 %d 题，目标占比按 weight）' % (r['title'], total))
        for m in sorted(r['modules'], key=lambda x: -x['weight']):
            if m['total'] == 0:
                need = 40
                print('    %-20s 0 题   建议至少补 %d 题（空模块）' % (m['name'][:18], need))
            else:
                # 目标：权重越高题量越多，同时保证每模块至少 20 题
                share = m['weight'] / sum(x['weight'] for x in r['modules'])
                target = max(20, int(share * 250))
                gap = target - m['total']
                flag = '' if gap <= 0 else '  建议补 %d 题' % gap
                print('    %-20s %3d 题  目标 %3d%s' % (m['name'][:18], m['total'], target, flag))
    print()


def main():
    as_json = '--json' in sys.argv
    banks = load_banks()
    if not banks:
        print('未找到题库文件（miniprogram/data/subject*.json）')
        return 1

    results = [analyze(b) for b in banks]

    if as_json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return 0

    print_report(results)
    build_suggestions(results)
    return 0


if __name__ == '__main__':
    sys.exit(main())
