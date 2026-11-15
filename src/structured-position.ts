import { GFM, parser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import type { BlockKind, BlockShape } from "./reading-dom";
import { resolveBlockOffset, toPosition, type RenderedSegment, type SegmentHit, type SourceSection } from "./resolve-position";

const markdown = parser.configure(GFM);
const calloutMarker = /^\[![\w-]+(?:\|[^\]\n]*)?\][+-]?(?=[ \t]|$)/;
const hiddenParagraph = /^(?:\^[\w-]+|%%(?:(?!%%)[\s\S])*%%)$/;
const standaloneComment = /^[ \t]*%%(?:(?!%%).)*%%[ \t]*$/;

interface SourceBlock extends BlockShape {
	text: string;
	offsets: number[];
}

export function resolveStructuredPosition(
	section: SourceSection,
	shape: readonly BlockShape[],
	selectedIndex: number,
	rendered: readonly RenderedSegment[],
	hit: SegmentHit,
) {
	const { text, lineStart, lineEnd } = section;
	const lines = text.split(/\r\n|\n|\r/);
	if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 0 || lineEnd < lineStart ||
		lineEnd >= lines.length || selectedIndex < 0 || selectedIndex >= shape.length) return null;

	const sectionSource = lines.slice(lineStart, lineEnd + 1).join("\n");
	const blocks = collectSourceBlocks(sectionSource);
	// 整个区块的顺序和容器层级必须一致，避免重复段落或相似公式跳到另一处。
	if (blocks.length !== shape.length || blocks.some((block, index) =>
		block.kind !== shape[index].kind || block.quotes !== shape[index].quotes || block.items !== shape[index].items
	)) return null;

	const block = blocks[selectedIndex];
	const offset = resolveBlockOffset(block.text, rendered, hit, block.kind === "code");
	if (offset === null || block.offsets[offset] === undefined) return null;
	return toPosition(sectionSource, lineStart, block.offsets[offset]);
}

function collectSourceBlocks(source: string): SourceBlock[] {
	const blocks: SourceBlock[] = [];
	const add = (kind: BlockKind, text: string, offsets: number[], quotes: number, items: number): void => {
		blocks.push({ kind, text, offsets, quotes, items });
	};

	const visit = (node: SyntaxNode, quotes: number, items: number): void => {
		const { name } = node;
		if (name === "Blockquote") quotes++;
		if (name === "ListItem") items++;
		if (name === "FencedCode" || name === "CodeBlock") {
			if (name === "FencedCode" && node.getChildren("CodeMark").length !== 2) return;
			const body = node.getChildren("CodeText");
			if (!body.length) return;
			let text = "";
			const offsets: number[] = [];
			for (const child of body) {
				text += source.slice(child.from, child.to);
				for (let offset = child.from; offset < child.to; offset++) offsets.push(offset);
			}
			offsets.push(body[body.length - 1].to);
			add("code", text, offsets, quotes, items);
			return;
		}

		if (name === "Paragraph" || name === "Task" || /^(ATX|Setext)Heading[1-6]$/.test(name)) {
			let from = node.from;
			const newline = source.indexOf("\n", from);
			const firstLineEnd = newline < 0 ? node.to : Math.min(newline, node.to);
			const header = node.parent?.name === "Blockquote" && node.parent.getChild("Paragraph")?.from === from &&
				!source.slice(node.parent.from, from).includes("\n") && calloutMarker.test(source.slice(from, firstLineEnd));
			if (header) {
				if (newline < 0 || newline >= node.to) return;
				const prefix = continuationPrefix(source.slice(newline + 1, node.to), quotes, true);
				if (prefix === null) return;
				from = newline + 1 + prefix;
			}
			if (name === "Task") {
				const marker = /^\[[ xX]\][ \t]+/.exec(source.slice(from, node.to));
				if (!marker) return;
				from += marker[0].length;
			}
			const isHeading = name !== "Paragraph" && name !== "Task";
			const projected = projectLines(source, from, node.to, quotes, true, !isHeading);
			if (!projected || !projected.text || hiddenParagraph.test(projected.text.trim())) return;
			const kind = isHeading ? "heading" : /^\$\$(?!\$)[\s\S]*\$\$[ \t]*$/.test(projected.text) ? "math" : "paragraph";
			add(kind, projected.text, projected.offsets, quotes, items);
			return;
		}

		if (name === "TableCell") {
			const projected = projectLines(source, node.from, node.to, quotes, false);
			if (projected) add(node.parent?.name === "TableHeader" ? "th" : "td", projected.text, projected.offsets, quotes, items);
			return;
		}

		if (["Document", "Blockquote", "OrderedList", "BulletList", "ListItem", "Table", "TableHeader", "TableRow"].includes(name)) {
			for (let child = node.firstChild; child; child = child.nextSibling) visit(child, quotes, items);
		}
	};
	visit(markdown.parse(source).topNode, 0, 0);
	return blocks;
}

function continuationPrefix(line: string, quotes: number, trimIndent: boolean): number | null {
	let offset = 0;
	for (let depth = 0; depth < quotes; depth++) {
		const marker = /^ {0,3}>[ \t]?/.exec(line.slice(offset));
		if (!marker) return null;
		offset += marker[0].length;
	}
	if (trimIndent) offset += /^[ \t]*/.exec(line.slice(offset))![0].length;
	return offset;
}

function projectLines(source: string, from: number, to: number, quotes: number, trimIndent: boolean, skipComments = false) {
	const lines = source.slice(from, to).split("\n");
	let text = "";
	const offsets: number[] = [];
	let position = from;
	let previousEnd: number | null = null;
	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index];
		const prefix = index === 0 ? 0 : continuationPrefix(raw, quotes, trimIndent);
		if (prefix === null) return null;
		const content = raw.slice(prefix);
		if (!skipComments || !standaloneComment.test(content)) {
			if (previousEnd !== null) {
				text += "\n";
				offsets.push(previousEnd);
			}
			text += content;
			for (let column = prefix; column < raw.length; column++) offsets.push(position + column);
			previousEnd = position + raw.length;
		}
		position += raw.length + 1;
	}
	offsets.push(previousEnd ?? from);
	return { text, offsets };
}
