import type { RenderedSegment, SegmentHit } from "./resolve-position";

const readableBlocks = "p, h1, h2, h3, h4, h5, h6, .math.math-block, li, th, td, code";
const mathSelector = ".math.math-inline, .math.math-block";
const interactive = "a, button, input, textarea, select, [contenteditable], [role='button'], .collapse-indicator, .internal-embed, .markdown-embed, .callout-title";
const inlineTags = new Set(["B", "CODE", "DEL", "EM", "I", "MARK", "S", "SPAN", "STRONG", "SUB", "SUP", "U"]);
const listChildren = "p, ol, ul, blockquote, .callout, table, pre";

export type BlockKind = "paragraph" | "heading" | "math" | "code" | "th" | "td";

function blockKind(element: Element): BlockKind | null {
	if (element.matches(".math.math-block")) return "math";
	if (element.tagName === "P" && Array.from(element.childNodes).some(node =>
		node.nodeType === 1 || (node.nodeType === 3 && /\S/.test((node as Text).data))
	)) return "paragraph";
	if (/^H[1-6]$/.test(element.tagName)) return "heading";
	if (element.tagName === "TH") return "th";
	if (element.tagName === "TD") return "td";
	if (element.tagName === "CODE" && element.parentElement?.tagName === "PRE") return "code";
	if (element.tagName === "LI" && Array.from(element.childNodes).some(node =>
		(node.nodeType === 3 && /\S/.test((node as Text).data)) ||
		(node.nodeType === 1 && inlineTags.has((node as Element).tagName))
	)) return "paragraph";
	return null;
}

export interface BlockShape {
	kind: BlockKind;
	quotes: number;
	items: number;
}

export function findReadingBlock(eventTarget: EventTarget | null) {
	const target = eventTarget as HTMLElement | null;
	if (!target || target.nodeType !== 1 || target.closest(interactive)) return null;
	const readingView = target.closest(".markdown-reading-view");
	if (!readingView) return null;
	for (let node: Element | null = target.closest(readableBlocks); node && node !== readingView; node = node.parentElement) {
		const kind = blockKind(node);
		if (kind && readingView.contains(node)) {
			return {
				target,
				block: node as HTMLElement,
				readingView,
				structured: Boolean(node.closest("blockquote, .callout, li, table, pre")),
			};
		}
	}
	return null;
}

export function collectReadingBlocks(root: Element): Array<BlockShape & { element: Element }> {
	const blocks: Array<BlockShape & { element: Element }> = [];
	const visit = (element: Element, quotes: number, items: number): void => {
		if (element.matches(interactive)) return;
		if (element.matches("blockquote, .callout")) quotes++;
		if (element.tagName === "LI") items++;
		const kind = blockKind(element);
		if (kind) blocks.push({ element, kind, quotes, items });
		if (!kind || element.tagName === "LI") {
			for (const child of Array.from(element.children)) visit(child, quotes, items);
		}
	};
	visit(root, 0, 0);
	return blocks;
}

type Caret = { node: Node; offset: number };

function caretAtPoint(doc: Document, x: number, y: number): Caret | null {
	const position = doc.caretPositionFromPoint?.(x, y);
	if (position) return { node: position.offsetNode, offset: position.offset };
	const legacy = doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
	const range = legacy.caretRangeFromPoint?.(x, y);
	return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

function pointsToText(caret: Caret, doc: Document, x: number, y: number): boolean {
	if (caret.node.nodeType !== 3) return false;
	const range = doc.createRange();
	range.selectNode(caret.node);
	return Array.from(range.getClientRects()).some(rect =>
		x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
}

export function captureReadingHit(block: HTMLElement, target: HTMLElement, x: number, y: number): {
	segments: RenderedSegment[];
	hit: SegmentHit;
} | null {
	const math = target.closest(mathSelector);
	if (math && (math === target || target.tagName === "MJX-CONTAINER")) {
		const rendered = math.querySelector("mjx-math");
		if (!rendered || !Array.from(rendered.getClientRects()).some(rect =>
			x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
		)) return null;
	}
	const code = block.tagName === "CODE" && block.parentElement?.tagName === "PRE";
	const doc = block.ownerDocument;
	const caret = math ? null : caretAtPoint(doc, x, y);
	if (!math && (!caret || !block.contains(caret.node) || !pointsToText(caret, doc, x, y))) return null;

	const segments: RenderedSegment[] = [];
	let text = "";
	let hit: SegmentHit | null = null;

	const flushText = (): void => {
		if (!text) return;
		segments.push({ kind: "text", text });
		text = "";
	};

	const visit = (node: Node): boolean => {
		if (node.nodeType === 3) {
			if (caret?.node === node) hit = { index: segments.length, offset: text.length + caret.offset };
			text += (node as Text).data;
			return true;
		}
		if (node.nodeType === 8) return true;
		if (node.nodeType !== 1) return false;
		const element = node as HTMLElement;
		if (element.matches(mathSelector)) {
			flushText();
			if (element === math) hit = { index: segments.length };
			segments.push({ kind: "math", display: element.classList.contains("math-block") });
			return true;
		}
		if (element.matches(".collapse-indicator, .heading-collapse-indicator")) return true;
		if (element !== block && block.tagName === "LI" &&
			(element.matches(listChildren) || element.matches(".task-list-item-checkbox"))) return true;
		if (element !== block && (!inlineTags.has(element.tagName) || element.matches(interactive))) return false;
		return Array.from(element.childNodes).every(visit);
	};

	if (!visit(block)) return null;
	// 跳过 Obsidian 在代码和嵌套列表周围产生的排版换行。
	if (code && text.endsWith("\n")) text = text.slice(0, -1);
	if (block.tagName === "LI") text = text.trimEnd();
	flushText();
	if (!hit) return null;
	return { segments, hit };
}
