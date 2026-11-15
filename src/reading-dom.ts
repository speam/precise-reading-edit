import type { RenderedSegment, SegmentHit } from "./resolve-position";

const readableBlocks = "p, h1, h2, h3, h4, h5, h6, .math.math-block";
const mathSelector = ".math.math-inline, .math.math-block";
const interactive = "a, button, input, textarea, select, [contenteditable], [role='button'], .collapse-indicator, .internal-embed, .markdown-embed";
const inlineTags = new Set(["B", "CODE", "DEL", "EM", "I", "MARK", "S", "SPAN", "STRONG", "SUB", "SUP", "U"]);

export function findReadingBlock(eventTarget: EventTarget | null) {
	const target = eventTarget as HTMLElement | null;
	if (!target || target.nodeType !== 1 || target.closest(interactive)) return null;
	const readingView = target.closest(".markdown-reading-view");
	if (!readingView) return null;
	const block = target.closest(readableBlocks) as HTMLElement | null;
	if (!block || !readingView.contains(block) || block.closest("blockquote, .callout, li, table, pre")) return null;
	return { target, block, readingView };
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
		if (element !== block && (!inlineTags.has(element.tagName) || element.matches(interactive))) return false;
		return Array.from(element.childNodes).every(visit);
	};

	if (!visit(block)) return null;
	flushText();
	if (!hit) return null;
	return { segments, hit };
}
