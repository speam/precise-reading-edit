import assert from "node:assert/strict";
import test from "node:test";
import { captureReadingHit, findReadingBlock } from "../src/reading-dom";

type Rect = { left: number; right: number; top: number; bottom: number };
type FakeText = { nodeType: 3; data: string; parentElement?: FakeElement; rect: Rect };
type FakeNode = FakeElement | FakeText;

class FakeDocument {
	caret: { offsetNode: FakeNode; offset: number } | null = null;
	caretPositionFromPoint = () => this.caret;

	createRange() {
		let selected: FakeText;
		return {
			selectNode(node: FakeText) { selected = node; },
			getClientRects() { return [selected.rect]; },
		};
	}
}

class FakeElement {
	readonly nodeType = 1;
	readonly tagName: string;
	readonly classList: { contains: (name: string) => boolean };
	readonly childNodes: FakeNode[] = [];
	parentElement?: FakeElement;

	constructor(readonly ownerDocument: FakeDocument, tag: string, classes: string[] = []) {
		this.tagName = tag.toUpperCase();
		this.classList = { contains: name => classes.includes(name) };
	}

	append(...children: FakeNode[]) {
		for (const child of children) child.parentElement = this;
		this.childNodes.push(...children);
		return this;
	}

	matches(selectors: string): boolean {
		return selectors.split(",").some(selector => {
			const [tag, ...classes] = selector.trim().split(".");
			return (!tag || this.tagName === tag.toUpperCase()) && classes.every(cls => this.classList.contains(cls));
		});
	}

	closest(selectors: string): FakeElement | null {
		return this.matches(selectors) ? this : this.parentElement?.closest(selectors) ?? null;
	}

	contains(node: FakeNode): boolean {
		return node === this || (node.parentElement !== undefined && this.contains(node.parentElement));
	}
}

function text(data: string, left = 0, right = 100): FakeText {
	return { nodeType: 3, data, rect: { left, right, top: 10, bottom: 28 } };
}

function fixture() {
	const document = new FakeDocument();
	const element = (tag: string, ...classes: string[]) => new FakeElement(document, tag, classes);
	const reading = element("div", "markdown-reading-view");
	return { document, element, reading };
}

function find(target: FakeElement) {
	return findReadingBlock(target as unknown as HTMLElement);
}

function capture(block: FakeElement, target: FakeElement, x = 10, y = 18) {
	return captureReadingHit(block as unknown as HTMLElement, target as unknown as HTMLElement, x, y);
}

test("公式内点击由公式容器决定，公式渲染文本不会混入段落", () => {
	const { element, reading } = fixture();
	const glyph = element("mjx-mi").append(text("𝑥"));
	const formula = element("span", "math", "math-inline").append(element("mjx-container").append(glyph));
	const block = element("p").append(text("计算 "), formula, text(" 的值。"));
	reading.append(block);

	assert.equal(find(glyph)?.block, block);
	assert.deepEqual(capture(block, glyph), {
		segments: [{ kind: "text", text: "计算 " }, { kind: "math", display: false }, { kind: "text", text: " 的值。" }],
		hit: { index: 1 },
	});
});

test("普通文字的点击偏移按实际文本节点累计，公式后的文本重新计数", () => {
	const { document, element, reading } = fixture();
	const after = text("，得到结果。", 40, 120);
	const block = element("p").append(
		text("先"),
		element("strong").append(text("计算 ")),
		element("span", "math", "math-inline").append(text("公式")),
		text(" 的值"),
		after,
	);
	reading.append(block);
	document.caret = { offsetNode: after, offset: 2 };

	assert.deepEqual(capture(block, block, 55), {
		segments: [{ kind: "text", text: "先计算 " }, { kind: "math", display: false }, { kind: "text", text: " 的值，得到结果。" }],
		hit: { index: 2, offset: 5 },
	});
});

test("标题折叠指示器既不参与文本映射，也不触发编辑", () => {
	const { document, element, reading } = fixture();
	const indicator = element("span", "collapse-indicator", "heading-collapse-indicator").append(text("↓"));
	const label = text("一个标题");
	const block = element("h2").append(indicator, label);
	reading.append(block);
	document.caret = { offsetNode: label, offset: 2 };

	assert.equal(find(indicator), null);
	assert.deepEqual(capture(block, block), {
		segments: [{ kind: "text", text: "一个标题" }],
		hit: { index: 0, offset: 2 },
	});
});

test("链接和嵌入文档不进入候选，引用、列表和表格走结构化定位", () => {
	const { element, reading } = fixture();
	const link = element("a").append(element("span").append(text("笔记链接")));
	const embedded = element("p").append(text("其他文件的文字"));
	const item = element("p").append(text("列表项"));
	const tableCell = element("p").append(text("表格内容"));
	const callout = element("p").append(text("引用内容"));
	reading.append(
		element("p").append(link),
		element("div", "markdown-embed").append(embedded),
		element("ul").append(element("li").append(item)),
		element("table").append(element("td").append(tableCell)),
		element("div", "callout").append(callout),
	);

	for (const target of [link, embedded, element("p")]) {
		assert.equal(find(target), null);
	}
	for (const target of [item, tableCell, callout]) {
		assert.equal(find(target)?.structured, true);
	}
});

test("浏览器在空白处给出相邻光标时仍拒绝跳转", () => {
	const { document, element, reading } = fixture();
	const label = text("正文", 10, 50);
	const block = element("p").append(label);
	reading.append(block);
	document.caret = { offsetNode: label, offset: 2 };

	assert.equal(capture(block, block, 80, 18), null);
	assert.equal(capture(block, block, 20, 50), null);
	assert.notEqual(capture(block, block, 20, 18), null);
});

test("有嵌套列表的任务项只映射自己的文字，不计入复选框和排版换行", () => {
	const { document, element, reading } = fixture();
	const label = text("外层任务\n");
	const item = element("li").append(
		element("input", "task-list-item-checkbox"), label,
		element("ul").append(element("li").append(text("内层任务"))),
		text("\n"),
	);
	reading.append(element("ul").append(item));
	document.caret = { offsetNode: label, offset: 2 };
	assert.deepEqual(capture(item, item), {
		segments: [{ kind: "text", text: "外层任务" }],
		hit: { index: 0, offset: 2 },
	});
});

test("来自另一区块或窗口的浏览器光标不能被借用", () => {
	const { document, element, reading } = fixture();
	const label = text("当前区块");
	const block = element("p").append(label);
	const other = text("其他区块");
	reading.append(block, element("p").append(other));
	document.caret = { offsetNode: other, offset: 2 };

	assert.equal(capture(block, block), null);
	assert.equal(capture(block, block, 0, 0), null);
});
