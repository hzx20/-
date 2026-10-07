#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/add_questions.py —— 往题库里追加题目的工具

【为什么要有这个脚本】
直接手改subject1.json 有两个危险：
  1. 手写 JSON 容易漏逗号、少引号，改坏整个题库
  2. 新增题目没有自动查重，可能出现重复 id

这个脚本用 Python 的 json 模块来写文件（保证语法绝对正确），
并且写完自动跑一遍校验，把"手改 JSON"变成"写数据"。

【怎么用】
python tools/add_questions.py subject1_职业理念.json
"""

import json
import os
import sys
import subprocess

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'miniprogram', 'data')

# 科目代号 → 文件名
BANK_FILES = {'1': 'subject1.json', '2': 'subject2.json'}


def check_duplicates(new_qs, existing):
    """检查 id 重复和题干重复"""
    errors = []
    old_ids = set(q.get('id') for q in existing)
    old_stems = set(q.get('stem', '').strip() for q in existing)

    seen_ids = set()
    seen_stems = set()
    for q in new_qs:
        qid = q.get('id', '')
        if not qid:
            errors.append('有题目缺少 id')
            continue
        if qid in old_ids:
            errors.append('id 与现有题库重复：%s' % qid)
        if qid in seen_ids:
            errors.append('新增题目内部 id 重复：%s' % qid)
        seen_ids.add(qid)

        stem = q.get('stem', '').strip()
        if stem in old_stems:
            errors.append('题干与现有题库重复：%s...' % stem[:30])
        if stem in seen_stems:
            errors.append('新增题目内部题干重复：%s...' % stem[:30])
        seen_stems.add(stem)
    return errors


def validate_structure(new_qs, valid_modules):
    """结构校验，规则与 validate_bank.py 保持一致"""
    errors = []
    for q in new_qs:
        qid = q.get('id', '(无id)')
        if q.get('module') not in valid_modules:
            errors.append('%s的 module="%s" 不在 modules 声明中' % (qid, q.get('module')))
        if q.get('type') not in ('single', 'judge', 'material', 'essay'):
            errors.append('%s 的 type="%s" 非法' % (qid, q.get('type')))

        diff = q.get('difficulty')
        if diff not in (1, 2, 3):
            errors.append('%s 的 difficulty=%s 非法（只能是 1/2/3）' % (qid, diff))

        if not q.get('stem', '').strip():
            errors.append('%s 的题干为空' % qid)

        if not q.get('explain', '').strip():
            errors.append('%s 缺少解析' % qid)

        qtype = q.get('type')
        options = q.get('options', [])

        if qtype == 'single':
            if len(options) != 4:
                errors.append('%s 单选题必须有 4 个选项，实际 %d 个' % (qid, len(options)))
            keys = [o.get('key') for o in options]
            if keys != ['A', 'B', 'C', 'D']:
                errors.append('%s 选项 key 必须是 A/B/C/D，实际 %s' % (qid, keys))
        elif qtype == 'judge':
            if len(options) != 2:
                errors.append('%s 判断题必须有 2 个选项，实际 %d 个' % (qid, len(options)))

        if qtype in ('single', 'judge'):
            ans = q.get('answer', [])
            if not ans:
                errors.append('%s 缺少答案' % qid)
            valid_keys = set(o.get('key') for o in options)
            for a in ans:
                if a not in valid_keys:
                    errors.append('%s 的答案 "%s" 不在选项内' % (qid, a))
        else:
            # 主观题：必须有 points（评分点），判分引擎靠它打分
            if not q.get('points'):
                errors.append('%s 主观题必须写points（评分点），否则判分恒为 0 分' % qid)
            if not q.get('answer'):
                errors.append('%s 主观题必须有参考答案' % qid)
    return errors


def main():
    if len(sys.argv) < 2:
        print('用法: python tools/add_questions.py <待导入的题目JSON>')
        print()
        print('待导入文件格式：')
        print(json.dumps({
            "subject": 1,
            "questions": [{
                "id": "s1-031",
                "module": "career",
                "type": "single",
                "stem": "题干（　）。",
                "options": [
                    {"key": "A", "text": "选项A"},
                    {"key": "B", "text": "选项B"},
                    {"key": "C", "text": "选项C"},
                    {"key": "D", "text": "选项D"}
                ],
                "answer": ["A"],
                "explain": "解析（必填，学生靠这个学）",
                "difficulty": 1,
                "source": "考纲要点"
            }]
        }, ensure_ascii=False, indent=2))
        return 1

    src = sys.argv[1]
    if not os.path.exists(src):
        print('文件不存在：%s' % src)
        return 1

    with open(src, encoding='utf-8') as f:
        payload = json.load(f)

    subject = str(payload['subject'])
    new_qs = payload['questions']
    bank_file = os.path.join(DATA_DIR, BANK_FILES[subject])

    with open(bank_file, encoding='utf-8') as f:
        bank = json.load(f)

    existing = bank['questions']
    valid_modules = set(m['key'] for m in bank['modules'])

    print('目标题库：%s' % bank['title'])
    print('现有题量：%d 题' % len(existing))
    print('待导入：%d 题' % len(new_qs))
    print()

    # 全部校验
    errors = check_duplicates(new_qs, existing)
    errors += validate_structure(new_qs, valid_modules)

    if errors:
        print('发现 %d 个问题，已中止导入（未改动题库）：' % len(errors))
        for i, e in enumerate(errors, 1):
            print('  %d. %s' % (i, e))
        return 1

    print('校验通过，开始合并...')
    before = len(existing)
    existing.extend(new_qs)

    # 写回文件：ensure_ascii=False 保证中文正常显示，indent=2 保持可读
    with open(bank_file, 'w', encoding='utf-8') as f:
        json.dump(bank, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print('导入完成：%d → %d 题（+%d）' % (before, len(existing), len(new_qs)))
    print()

    # 自动跑一遍题库格式校验
    print('自动运行题库格式校验...')
    r = subprocess.run(
        [sys.executable, os.path.join(ROOT, 'tools', 'validate_bank.py')],
        capture_output=True, text=True, encoding='utf-8'
    )
    print(r.stdout[-1500:] if r.stdout else '(无输出)')
    if r.stderr:
        print(r.stderr[-500:])
    return 0


if __name__ == '__main__':
    sys.exit(main())
