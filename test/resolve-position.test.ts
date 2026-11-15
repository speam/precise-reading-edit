import assert from "node:assert/strict";
import test from "node:test";
import { resolvePosition, type RenderedSegment } from "../src/resolve-position";

const text = (value: string): RenderedSegment => ({ kind: "text", text: value });
const math = (tex?: string, display = false): RenderedSegment => ({ kind: "math", tex, display });

test("标题和选项的光标都对应到实际字符位置", () => {
	const title = "练习 1：判断图形的类型";
	const options = "A. 直线　B. 圆　C. 椭圆　D. 抛物线";
	const markdown = [`### ${title}`, "", options].join("\n");

	assert.deepEqual(resolvePosition({ text: markdown, lineStart: 0, lineEnd: 0 }, [text(title)], { index: 0, offset: 7 }), { line: 0, ch: 11 });
	const c = options.indexOf("C.");
	assert.deepEqual(resolvePosition({ text: markdown, lineStart: 2, lineEnd: 2 }, [text(options)], { index: 0, offset: c }), { line: 2, ch: c });
});

test("公式定位到起始美元符号，左右的中文定位到字符", () => {
	const prefix = "怎样描述这个函数 ";
	const tex = String.raw`h(t)=\cos t\,e^{t^2}`;
	const suffix = " 的行为？";
	const markdown = `${prefix}$${tex}$${suffix}`;
	const section = { text: markdown, lineStart: 0, lineEnd: 0 };
	const rendered = [text(prefix), math(), text(suffix)];

	assert.deepEqual(resolvePosition(section, rendered, { index: 0, offset: 3 }), { line: 0, ch: 3 });
	assert.deepEqual(resolvePosition(section, rendered, { index: 1 }), { line: 0, ch: prefix.length });
	assert.deepEqual(resolvePosition(section, rendered, { index: 2, offset: 2 }), { line: 0, ch: prefix.length + tex.length + 4 });
});

test("完全重复的段落只在当前区块处理，同一区块的重复公式按完整渲染顺序定位", () => {
	const paragraph = "甲 $x$ 乙 $x$ 丙";
	const markdown = [paragraph, "", paragraph].join("\n");
	const section = { text: markdown, lineStart: 2, lineEnd: 2 };
	const rendered = [text("甲 "), math("x"), text(" 乙 "), math("x"), text(" 丙")];

	assert.deepEqual(resolvePosition(section, rendered, { index: 3 }), { line: 2, ch: paragraph.lastIndexOf("$x$") });
});

test("同一区块重复的普通文字按实际 DOM 字符偏移而非首个匹配定位", () => {
	const markdown = "重复出现，重复出现，再重复出现。";
	const section = { text: markdown, lineStart: 0, lineEnd: 0 };
	const offset = markdown.lastIndexOf("重复出现");
	assert.deepEqual(resolvePosition(section, [text(markdown)], { index: 0, offset }), { line: 0, ch: offset });
});

test("区块内候选结构对不上时保持阅读，例如多行列表中只有一项的文本", () => {
	const markdown = "- 第一项 $x$\n- 第一项 $x$";
	const section = { text: markdown, lineStart: 0, lineEnd: 1 };
	assert.equal(resolvePosition(section, [text("第一项 "), math("x")], { index: 1 }), null);
});

test("普通跨行区块完全对得上时用 CRLF 文档的真实行和列", () => {
	const markdown = "其他段落\r\n\r\n题干第一行\r\n题干第二行 $v$。\r\n";
	const section = { text: markdown, lineStart: 2, lineEnd: 3 };
	const rendered = [text("题干第一行\n题干第二行 "), math("v"), text("。")];

	assert.deepEqual(resolvePosition(section, rendered, { index: 0, offset: "题干第一行\n题干".length }), { line: 3, ch: 2 });
	assert.deepEqual(resolvePosition(section, rendered, { index: 1 }), { line: 3, ch: 6 });
});

test("保留 escaped 美元与符号的列偏移，跳过公式中的 escaped 美元", () => {
	const markdown = String.raw`转义 \$ 与 \*，公式 $a\$b$ 正常。`;
	const section = { text: markdown, lineStart: 0, lineEnd: 0 };
	assert.deepEqual(resolvePosition(section, [text("转义 $ 与 *，公式 "), math(String.raw`a\$b`), text(" 正常。")], { index: 0, offset: 4 }), { line: 0, ch: 5 });
	assert.deepEqual(resolvePosition(section, [text("转义 $ 与 *，公式 "), math(String.raw`a\$b`), text(" 正常。")], { index: 1 }), { line: 0, ch: markdown.indexOf("$a") });
});

test("行内代码中的美元属于普通文本，代码字面字符保持源码列偏移", () => {
	const markdown = `令 \`$x$\` 表示文本，另有 $x$`;
	const section = { text: markdown, lineStart: 0, lineEnd: 0 };
	const rendered = [text("令 $x$ 表示文本，另有 "), math("x")];
	assert.deepEqual(resolvePosition(section, rendered, { index: 0, offset: 3 }), { line: 0, ch: markdown.indexOf("x") });
	assert.deepEqual(resolvePosition(section, rendered, { index: 1 }), { line: 0, ch: markdown.lastIndexOf("$x$") });
});

test("公式数目、已知公式内容、渲染类型或旁边文字不一致时都拒绝", () => {
	const section = { text: "证明 $a$ 得 $b$", lineStart: 0, lineEnd: 0 };
	const hit = { index: 1 };
	assert.equal(resolvePosition(section, [text("证明 "), math("a")], hit), null);
	assert.equal(resolvePosition(section, [text("证明 "), math("b"), text(" 得 "), math("a")], hit), null);
	assert.equal(resolvePosition(section, [text("证明 "), math("a", true), text(" 得 "), math("b")], hit), null);
	assert.equal(resolvePosition(section, [text("证明 "), math("a"), text(" 可得 "), math("b")], hit), null);
});

test("简单强调文字的内部列能对应，落在隐藏格式前后交界处时拒绝", () => {
	const markdown = "引出 **重点部分** 说明。";
	const section = { text: markdown, lineStart: 0, lineEnd: 0 };
	const rendered = [text("引出 重点部分 说明。")];
	assert.deepEqual(resolvePosition(section, rendered, { index: 0, offset: 5 }), { line: 0, ch: 7 });
	assert.equal(resolvePosition(section, rendered, { index: 0, offset: 3 }), null);
});

test("已校验的 HTML 实体和 emoji 使用 UTF-16 列，并拒绝拆分代理对", () => {
	const markdown = "甲 &amp; &#x1f642; 乙";
	const section = { text: markdown, lineStart: 0, lineEnd: 0 };
	const rendered = [text("甲 & 🙂 乙")];
	assert.deepEqual(resolvePosition(section, rendered, { index: 0, offset: 3 }), { line: 0, ch: 7 });
	assert.equal(resolvePosition(section, rendered, { index: 0, offset: 5 }), null);
	assert.deepEqual(resolvePosition(section, rendered, { index: 0, offset: 7 }), { line: 0, ch: markdown.indexOf("乙") });
});

test("不完整或失效的区块行号、点击段与字符偏移不会产生坐标", () => {
	const rendered = [text("普通文字")];
	const section = { text: "普通文字", lineStart: 0, lineEnd: 0 };
	for (const hit of [{ index: 1, offset: 0 }, { index: 0, offset: 6 }, { index: 0 }, { index: 0, offset: 1.5 }]) {
		assert.equal(resolvePosition(section, rendered, hit), null);
	}
	assert.equal(resolvePosition({ ...section, lineEnd: 2 }, rendered, { index: 0, offset: 0 }), null);
});
