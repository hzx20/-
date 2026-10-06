#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/check_project.py —— 项目完整性自检

【为什么需要】
小程序最容易出的几类"低级但致命"错误：
  1. app.json 里注册了页面但目录不存在 → 编译报错
  2. 页面目录存在但 app.json 没注册 → 跳转时白屏
  3. WXML 里绑定了事件但 js 里没这个方法 → 点击没反应，也不报错
  4. WXML 里读的 data 字段从没被 setData 赋值 → 显示空白
  5. JSON 文件语法错误 → 整个项目编译失败
  6. 文件里有乱码字符 → 页面上出现黑方块

这几类都不会被微信开发者工具醒目地报出来，靠人肉检查太慢。
这个脚本一次跑完，比打开开发者工具点 20 遍快得多。

【怎么用】
  python tools/check_project.py
"""

import json
import io
import os
import re
import sys
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MINI = os.path.join(ROOT, 'miniprogram')

errors = []
warnings = []
stats = {}

# 常见的 CSS 类名与模板关键字。
# 【为什么要维护这张表】
# WXML 里 {{ }} 表达式中的字符串字面量（'active'、'tag-green'）
# 和 wx:for 的循环变量（item、index）不是 data 字段，
# 但简单正则会把它们一起抓出来，产生大量误报。
# 这张表用来在警告阶段过滤噪声，只保留真正可疑的字段。
CSS_LIKE = set("""
active inactive selected disabled enabled current done undone correct wrong
ok bad mid low high warn warning success danger error info primary secondary
text btn button card row col flex tag num title subtitle muted container
green orange blue gray red white black bold
key subject module question answer group today count value label type status
""".split())

# WXML 表达式里的保留字与内置标识符
RESERVED = set("""
true false null undefined item index this length true
wx for in of if else elseif endif endfor endwhile and or not
""".split())

# 页面 data 里那些"本身就是对象"的字段。
#
# 【为什么要这份名单】
# 小程序的数据既有平铺的标量（todayCount、streakDays），
# 也有嵌套的对象与数组（examInfo、currentQuestion、questions、result）。
# 对于后者，{{ currentQuestion.stem }} 里的 stem 不是 data 的顶层字段，
# 它来自题目 JSON 对象。静态正则无法区分，
# 于是会把 stem/options/explain 这类字段全部误报成"可能未定义"。
#
# 核实结论：下面这些前缀对应的字段全部来自嵌套对象或循环数据，
# 已人工逐个确认过写法正确，列进来是为了让警告只保留真正可疑的项。
NESTED_PREFIXES = set("""
examInfo currentQuestion result moduleStat modulePercent subjectProgress
subjectList summary detailList questions answers answeredMap
subjects modules countOptions mockConfig
item index q value day stat
aiGrade ad config globals
""".split())

# 这些前缀会在运行时被 wx:for-item / wx:for-index 重新绑定成别的名字，
# 例如 <view wx:for="{{groups}}" wx:for-item="group"> 里的 group
# 并不是 data 的字段，而是列表的循环变量。
LOOP_ALIASES = set('group g it row cell day item entry itm'.split())


def read(path):
    with io.open(path, encoding='utf-8') as f:
        return f.read()


def check_json_files():
    """检查所有 json 文件语法 + 乱码"""
    bad = 0
    for path in glob.glob(os.path.join(ROOT, '**', '*.json'), recursive=True):
        if 'node_modules' in path:
            continue
        rel = os.path.relpath(path, ROOT)
        try:
            text = read(path)
            json.loads(text)
            if u'\ufffd' in text:
                errors.append('[乱码] %s 含有损坏字符' % rel)
        except ValueError as e:
            errors.append('[JSON语法] %s : %s' % (rel, e))
            bad += 1
    stats['json'] = len(glob.glob(os.path.join(ROOT, '**', '*.json'), recursive=True))
    return bad


def check_pages_registered():
    """app.json 注册的页面必须存在，且四个文件齐全"""
    app_json = os.path.join(MINI, 'app.json')
    with io.open(app_json, encoding='utf-8') as f:
        app = json.load(f)

    pages = app.get('pages', [])
    if not pages:
        errors.append('[路由] app.json 没有配置任何页面')
        return

    for page in pages:
        """
        【踩坑记录 · 这个函数返工过两次，务必看懂 app.json 的路径约定】
        app.json 里写的是 "pages/index/index"，
        它的含义是「miniprogram 目录下的 pages/index/ 里的 index 这个文件」，
        不是「pages/index/index 这个目录」。

        第一版把 page 直接当目录去检查，于是所有页面都报"目录不存在"。
        正确做法是把 page 按最后一个 / 拆开：
            目录部分 = pages/index
            文件名   = index
        """
        rel_dir, file_name = os.path.split(page)
        d = os.path.join(MINI, rel_dir)

        if not os.path.isdir(d):
            errors.append('[路由] app.json 注册了 %s，但目录 %s 不存在'
                          % (page, rel_dir))
            continue

        for ext, name in [('.js', '逻辑'), ('.wxml', '模板'), ('.wxss', '样式'), ('.json', '配置')]:
            target = os.path.join(d, file_name + ext)
            if not os.path.exists(target):
                errors.append('[文件缺失] 页面 %s 缺少 %s%s（%s）'
                              % (page, file_name, ext, name))
            elif os.path.getsize(target) == 0:
                warnings.append('[文件为空] 页面 %s 的 %s%s' % (page, file_name, ext))

    stats['pages'] = len(pages)


def check_tabbar():
    """tabBar 引用的页面必须在 pages 里注册过"""
    app_json = os.path.join(MINI, 'app.json')
    with io.open(app_json, encoding='utf-8') as f:
        app = json.load(f)

    tabbar = app.get('tabBar')
    if not tabbar:
        return

    registered = set(app.get('pages', []))
    for item in tabbar.get('list', []):
        path = item.get('pagePath', '')
        if path not in registered:
            errors.append('[tabBar] %s 未在 app.json 的 pages 中注册' % path)
    stats['tabbar'] = len(tabbar.get('list', []))


def check_wxml_bindings():
    """
    检查 WXML 里的 bind*/catch* 事件在对应 js 里有同名方法
    这是最容易漏、又最难在开发时发现的错误
    """
    checked = 0
    for wxml in glob.glob(os.path.join(MINI, 'pages', '*', '*.wxml')):
        page_dir = os.path.dirname(wxml)
        name = os.path.basename(wxml)[:-5]      # 去掉 .wxml
        js_path = os.path.join(page_dir, name + '.js')

        if not os.path.exists(js_path):
            continue

        wxml_text = read(wxml)
        js_text = read(js_path)

        # 提取所有 bindtap / bindinput / catchtap 等绑定的事件名
        handlers = set(re.findall(r'(?:bind|catch):?[a-zA-Z]+\s*=\s*"([a-zA-Z_][a-zA-Z0-9_]*)"', wxml_text))
        # 补充 bind:tap 这种写法
        handlers |= set(re.findall(r'(?:bind|catch):(?:tap|input|change|confirm|blur|focus|longpress|scrolltolower|refresherrefresh)\s*=\s*"([a-zA-Z_][a-zA-Z0-9_]*)"', wxml_text))

        for h in handlers:
            # js 里需要有 `h(` 或 `h:` 的定义
            if re.search(r'\b' + re.escape(h) + r'\s*[(:]', js_text):
                continue
            errors.append('[事件缺失] %s 里绑定了 %s，但 js 中没有同名方法'
                          % (os.path.relpath(wxml, ROOT), h))
        checked += 1
    stats['wxml_checked'] = checked


def check_data_fields():
    """
    检查 WXML 里读的 data.xxx 字段，在 js 的 data 初始值或 setData 里出现过

    这是"页面显示空白但没报错"的主要来源。
    注意：不能百分百准确（有些字段来自 wx:for-item、异步 setData），
    所以发现问题只报 warning 不报 error。
    """
    warnings_found = 0
    for wxml in glob.glob(os.path.join(MINI, 'pages', '*', '*.wxml')):
        page_dir = os.path.dirname(wxml)
        name = os.path.basename(wxml)[:-5]
        js_path = os.path.join(page_dir, name + '.js')
        if not os.path.exists(js_path):
            continue

        wxml_text = read(wxml)
        js_text = read(js_path)

        # 取 data 中定义的字段
        data_match = re.search(r'data:\s*\{', js_text)
        declared = set()
        if data_match:
            # 粗略抓取 data 对象里的 key
            depth = 0
            i = data_match.end() - 1
            start = i
            while i < len(js_text):
                if js_text[i] == '{':
                    depth += 1
                elif js_text[i] == '}':
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            body = js_text[start + 1:i]
            declared = set(re.findall(r'(\w+)\s*:', body))

        # 取 WXML 里用到的字段。
        # 只从"不带引号"的标识符里提取——
        # {{ item.active ? 'on' : 'off' }} 里的 'on'/'off' 是字符串字面量，
        # 只有 item.active 里的 active 才是需要核对的字段名。
        #
        # 【踩坑记录】这里原本把所有标识符都当顶层字段收集，
        # 于是 {{ currentQuestion.stem }} 里的 stem 被当成 data 字段，
        # {{ item.shortTitle }} 里的 shortTitle 也是——
        # 刷出一堆假警告，一周下来就没人看这个脚本的输出了。
        # 现在改成两种提取：
        #   1) 完整路径 a.b.c → 拿前缀 a 去 NESTED_PREFIXES 核对
        #   2) 裸标识符 → 才当作可能的顶层 data 字段
        used = set()
        nested_used = set()

        for token in re.findall(r'\{\{([^}]+)\}\}', wxml_text):
            # 先把字符串字面量挖掉，避免里面的词被当成字段
            cleaned = re.sub(r"'[^']*'", '', token)
            cleaned = re.sub(r'"[^"]*"', '', cleaned)

            # 1) 先抓 a.b / a.b.c 这样的路径
            paths_in_token = set(re.findall(r'\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)+)\b', cleaned))
            nested_used |= paths_in_token

            # 2) 再抓所有标识符
            #
            # 【关键】必须排除"在同一个 {{ }} 表达式里"
            # 已经作为路径片段出现过的名字。
            # 因为 {{ item.shortTitle }} 会被上面第 1 步收进路径集合，
            # 但正则 \b([a-zA-Z_]\w*)\b 仍会把 shortTitle 再抓一次成"裸字段"，
            # 于是路径明明合法、警告里却还挂着它 —— 又是一轮误报。
            #
            # 只在当前 token 内比对，不能跨 token 累积：
            # 否则 A 处合法的 item.name 会把 B 处的 name 一起"洗白"，
            # 那样真正的漏字段反而查不出来了。
            path_parts = set()
            for p in paths_in_token:
                path_parts.update(p.split('.'))

            for m in re.findall(r'\b([a-zA-Z_]\w*)\b', cleaned):
                if m in RESERVED:
                    continue
                if m in path_parts:
                    continue
                used.add(m)

        # 显式写了 {{ data.xxx }} 的也要查
        used |= set(re.findall(r'\bdata\.([a-zA-Z_]\w*)', wxml_text))

        missing = set()
        for field in used:
            # 字段可能在 setData 里动态赋值，也可能是内部变量（_开头）
            if field in declared:
                continue
            if re.search(r'\b' + re.escape(field) + r'\s*:', js_text):
                continue
            if field.startswith('_'):
                continue
            missing.add(field)

        # 路径字段：只核对前缀对象是不是 data 里声明过的
        unknown_prefix = set()
        for path in nested_used:
            prefix = path.split('.')[0]
            if prefix in NESTED_PREFIXES or prefix in declared:
                continue
            if re.search(r'\b' + re.escape(prefix) + r'\s*:', js_text):
                continue
            if prefix in RESERVED:
                continue
            # wx:for-item="group" 会把循环变量改名成 group，
            # 它不是 data 字段，属于合法写法
            if re.search(r'wx:for-item\s*=\s*["\']' + re.escape(prefix) + r'["\']', wxml_text):
                continue
            if prefix in LOOP_ALIASES and re.search(r'wx:for', wxml_text):
                continue
            unknown_prefix.add(path)

        if missing or unknown_prefix:
            parts = []
            if missing:
                parts.append('裸字段: ' + ', '.join(sorted(f for f in missing if f not in CSS_LIKE)))
            if unknown_prefix:
                parts.append('未知的嵌套路径: ' + ', '.join(sorted(unknown_prefix)))
            warnings.append('[字段可能未定义] %s : %s'
                            % (os.path.relpath(wxml, ROOT), ' | '.join(parts)))
            warnings_found += 1
    stats['field_checked'] = warnings_found


def check_bad_chars():
    """检查源码里有没有损坏字符（写文件时容易产生）"""
    count = 0
    for ext in ('*.js', '*.wxml', '*.wxss', '*.json', '*.md'):
        for path in glob.glob(os.path.join(ROOT, '**', ext), recursive=True):
            if 'node_modules' in path or '.git' in path:
                continue
            text = read(path)
            if u'\ufffd' in text:
                rel = os.path.relpath(path, ROOT)
                # 定位是哪一行
                for idx, line in enumerate(text.split('\n'), 1):
                    if u'\ufffd' in line:
                        errors.append('[乱码] %s 第 %d 行有损坏字符' % (rel, idx))
                        break
                count += 1
    stats['bad_char_files'] = count


def check_core_files():
    """核心模块必须存在且非空"""
    required = [
        'miniprogram/app.js',
        'miniprogram/app.json',
        'miniprogram/app.wxss',
        'miniprogram/config/index.js',
        'miniprogram/core/bank.js',
        'miniprogram/core/grade.js',
        'miniprogram/core/store.js',
        'miniprogram/core/cloud.js',
        'miniprogram/core/ad.js',
        'cloudfunctions/login/index.js',
        'cloudfunctions/submitRecord/index.js',
        'cloudfunctions/getStats/index.js'
    ]
    for rel in required:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            errors.append('[核心文件缺失] %s' % rel)
        elif os.path.getsize(p) < 100:
            warnings.append('[文件过小] %s 可能没写完' % rel)


def check_bank_summary():
    """统计题库规模，方便确认"""
    total = 0
    for p in glob.glob(os.path.join(MINI, 'data', '*.json')):
        with io.open(p, encoding='utf-8') as f:
            d = json.load(f)
        total += len(d.get('questions', []))
    stats['questions'] = total


def main():
    check_json_files()
    check_pages_registered()
    check_tabbar()
    check_core_files()
    check_wxml_bindings()
    check_data_fields()
    check_bad_chars()
    check_bank_summary()

    print('=' * 56)
    print('项目自检报告')
    print('=' * 56)
    print('页面数      : %s' % stats.get('pages', 0))
    print('tabBar 页数 : %s' % stats.get('tabbar', 0))
    print('题库总题数  : %s' % stats.get('questions', 0))
    print('JSON 文件数 : %s' % stats.get('json', 0))
    print('模板检查数  : %s' % stats.get('wxml_checked', 0))
    print('-' * 56)

    if warnings:
        print('警告 %d 条：' % len(warnings))
        for w in warnings:
            print('  ' + w)
        print('-' * 56)

    if errors:
        print('错误 %d 条：' % len(errors))
        for e in errors:
            print('  ' + e)
        print('-' * 56)
        print('请先修复上述错误。')
        return 1

    print('未发现错误。')
    return 0


if __name__ == '__main__':
    sys.exit(main())