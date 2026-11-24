// 使用 Obsidian 提供的同一渲染快照及区块行号。行、列和文本偏移均从 0 开始。
export interface SourceSection {
	text: string;
	lineStart: number;
	lineEnd: number;
}

export type RenderedSegment =
	| { kind: "text"; text: string }
	| { kind: "math"; tex?: string; display?: boolean };

export interface SegmentHit {
	index: number;
	offset?: number;
}

export interface SourcePosition {
	line: number;
	ch: number;
}

interface SourceText {
	kind: "text";
	text: string;
	boundaries: Array<number | null>;
}

interface SourceMath {
	kind: "math";
	tex: string;
	display: boolean;
	start: number;
	end: number;
}

type SourceSegment = SourceText | SourceMath;

export function resolvePosition(
	section: SourceSection,
	rendered: readonly RenderedSegment[],
	hit: SegmentHit,
): SourcePosition | null {
	const { text, lineStart, lineEnd } = section;
	if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 0 || lineEnd < lineStart) return null;
	const lines = text.split(/\r\n|\n|\r/);
	if (lineEnd >= lines.length) return null;
	const source = lines.slice(lineStart, lineEnd + 1).join("\n");
	const offset = resolveBlockOffset(source, rendered, hit);
	return offset === null ? null : toPosition(source, lineStart, offset);
}

export function resolveBlockOffset(
	source: string,
	rendered: readonly RenderedSegment[],
	hit: SegmentHit,
	literal = false,
): number | null {
	if (!Number.isInteger(hit.index) || hit.index < 0 || hit.index >= rendered.length) return null;
	const segments = matchBlock(source, rendered, literal);
	if (!segments) return null;

	const selected = segments[hit.index];
	if (selected.kind === "math") return selected.start;
	const offset = hit.offset;
	if (offset === undefined || !Number.isInteger(offset) || offset < 0 || offset >= selected.boundaries.length) return null;
	if (splitsSurrogatePair(selected.text, offset)) return null;
	return selected.boundaries[offset];
}

export function matchesBlock(source: string, rendered: readonly RenderedSegment[], literal = false): boolean {
	return matchBlock(source, rendered, literal) !== null;
}

function matchBlock(source: string, rendered: readonly RenderedSegment[], literal: boolean): SourceSegment[] | null {
	const { start, end } = contentBounds(source);
	let segments: SourceSegment[] = [];
	if (literal) appendText(segments, source, 0, source.length);
	else appendInline(segments, source, start, end);

	if (!segmentsMatch(segments, rendered)) {
		if (literal) return null;
		// Obsidian 会隐藏行末块锚点。仅在原样核对失败后，尝试匹配其前面的可见内容。
		const anchor = /(?<=\S)([ \t]+)\^[a-zA-Z0-9-]+[ \t]*$/.exec(source.slice(start, end));
		if (!anchor) return null;
		const beforeAnchor = start + anchor.index;
		// 前导空白有时仍保留在渲染后的文本节点中，仍须校验整段。
		for (const visibleEnd of [beforeAnchor, beforeAnchor + anchor[1].length]) {
			segments = [];
			appendInline(segments, source, start, visibleEnd);
			if (segmentsMatch(segments, rendered)) break;
		}
		if (!segmentsMatch(segments, rendered)) return null;
	}

	return segments;
}

function segmentsMatch(source: readonly SourceSegment[], rendered: readonly RenderedSegment[]): boolean {
	// 逐段校验整个区块。某一小段碰巧相同不足以确认来源。
	return source.length === rendered.length && source.every((segment, index) => segmentMatches(segment, rendered[index]));
}

function segmentMatches(source: SourceSegment, rendered: RenderedSegment): boolean {
	if (source.kind === "text" && rendered.kind === "text") return source.text === rendered.text;
	if (source.kind !== "math" || rendered.kind !== "math") return false;
	return (rendered.tex === undefined || rendered.tex === source.tex)
		&& (rendered.display === undefined || rendered.display === source.display);
}

function contentBounds(source: string): { start: number; end: number } {
	const atx = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(source);
	if (atx && !source.includes("\n")) {
		const start = atx[0].length;
		const body = source.slice(start).replace(/[ \t]+$/, "");
		const closingHashes = /(?:^|[ \t]+)#+$/.exec(body);
		return { start, end: start + (closingHashes?.index ?? body.length) };
	}

	const setext = /\n {0,3}(?:=+|-+)[ \t]*$/.exec(source);
	if (setext) return { start: 0, end: setext.index };
	return { start: 0, end: source.length };
}

function appendInline(segments: SourceSegment[], source: string, start: number, end: number): void {
	let cursor = start;
	while (cursor < end) {
		const char = source[cursor];
		const next = source[cursor + 1];
		if (char === "\\" && cursor + 1 < end && isAsciiPunctuation(next)) {
			appendText(segments, next, cursor, cursor + 2);
			cursor += 2;
			continue;
		}
		if (char === "$") {
			const formula = readMath(source, cursor, end);
			if (formula) {
				segments.push(formula);
				cursor = formula.end;
				continue;
			}
		}
		if (char === "`") {
			const code = readCode(source, cursor, end);
			if (code) {
				for (let index = code.contentStart; index < code.contentEnd; index++) {
					appendText(segments, source[index] === "\n" ? " " : source[index], index, index + 1);
				}
				cursor = code.end;
				continue;
			}
			const length = charRunLength(source, cursor, end, "`");
			appendText(segments, source.slice(cursor, cursor + length), cursor, cursor + length);
			cursor += length;
			continue;
		}
		if (char === "&") {
			const entity = readEntity(source, cursor, end);
			if (entity) {
				appendText(segments, entity.value, cursor, entity.end);
				cursor = entity.end;
				continue;
			}
		}
		if (char === "*" || char === "_" || char === "~" || char === "=") {
			const formatting = readSimpleFormatting(source, cursor, end);
			if (formatting) {
				appendInline(segments, source, formatting.contentStart, formatting.contentEnd);
				cursor = formatting.end;
				continue;
			}
		}
		appendText(segments, char, cursor, cursor + 1);
		cursor++;
	}
}

function readMath(source: string, start: number, limit: number): SourceMath | null {
	const size = charRunLength(source, start, limit, "$");
	if (size > 2) return null;
	const contentStart = start + size;
	if (contentStart >= limit || (size === 1 && /\s/.test(source[contentStart]))) return null;

	let cursor = contentStart;
	while (cursor < limit) {
		const char = source[cursor];
		if (char === "\n" && size === 1) return null;
		if (char === "\\" && cursor + 1 < limit) {
			cursor += 2;
			continue;
		}
		if (char !== "$") {
			cursor++;
			continue;
		}
		const closingSize = charRunLength(source, cursor, limit, "$");
		const validInlineClose = cursor > contentStart && !/\s/.test(source[cursor - 1]) && !/[0-9]/.test(source[cursor + 1] ?? "");
		if (closingSize === size && cursor > contentStart && (size === 2 || validInlineClose)) {
			return {
				kind: "math",
				tex: source.slice(contentStart, cursor),
				display: size === 2,
				start,
				end: cursor + size,
			};
		}
		cursor += closingSize;
	}
	return null;
}

function readCode(source: string, start: number, limit: number): { contentStart: number; contentEnd: number; end: number } | null {
	const size = charRunLength(source, start, limit, "`");
	const opening = start + size;
	for (let cursor = source.indexOf("`", opening); cursor !== -1 && cursor < limit;) {
		const closingSize = charRunLength(source, cursor, limit, "`");
		if (closingSize === size) {
			const content = source.slice(opening, cursor);
			const trim = /^[ \n]/.test(content) && /[ \n]$/.test(content) && /[^ \n]/.test(content) ? 1 : 0;
			return { contentStart: opening + trim, contentEnd: cursor - trim, end: cursor + size };
		}
		cursor = source.indexOf("`", cursor + closingSize);
	}
	return null;
}

const namedEntities: Readonly<Record<string, string>> = {
	amp: "&", apos: "'", gt: ">", lt: "<", nbsp: "\u00a0", quot: '"',
};

function readEntity(source: string, start: number, limit: number): { value: string; end: number } | null {
	const matched = /^&(?:#(x[\da-fA-F]{1,6}|[0-9]{1,7})|([a-zA-Z]+));/.exec(source.slice(start, Math.min(start + 12, limit)));
	if (!matched) return null;
	const end = start + matched[0].length;
	if (!matched[1]) {
		const name = matched[2];
		return Object.prototype.hasOwnProperty.call(namedEntities, name) ? { value: namedEntities[name], end } : null;
	}
	const numeric = matched[1];
	const codePoint = numeric.startsWith("x") ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric, 10);
	// 控制码、代理区和解析器特定替换规则交给更严格的整段对照。
	if (codePoint < 32 || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff) return null;
	return { value: String.fromCodePoint(codePoint), end };
}

function readSimpleFormatting(source: string, start: number, limit: number): { contentStart: number; contentEnd: number; end: number } | null {
	const char = source[start];
	const size = charRunLength(source, start, limit, char);
	if ((char === "~" || char === "=") ? size !== 2 : size > 2) return null;
	if (source[start - 1] === char) return null;
	const marker = source.slice(start, start + size);
	const contentStart = start + size;
	const contentEnd = source.indexOf(marker, contentStart);
	if (contentEnd <= contentStart || contentEnd + size > limit) return null;
	if (source[contentEnd - 1] === char || source[contentEnd + size] === char) return null;
	const content = source.slice(contentStart, contentEnd);
	// 只处理明确的外层格式，允许正文里有行内公式与代码。
	if (content !== content.trim() || /[\[\]<>\n]/.test(content)) return null;
	return { contentStart, contentEnd, end: contentEnd + size };
}

function isAsciiPunctuation(char: string | undefined): boolean {
	if (!char) return false;
	const cp = char.charCodeAt(0);
	return (cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126);
}

function charRunLength(source: string, start: number, limit: number, char: string): number {
	let end = start;
	while (end < limit && source[end] === char) end++;
	return end - start;
}

function appendText(segments: SourceSegment[], text: string, start: number, end: number): void {
	const previous = segments[segments.length - 1];
	let segment: SourceText;
	if (previous?.kind === "text") {
		segment = previous;
		const boundary = segment.boundaries.length - 1;
		if (segment.boundaries[boundary] !== start) segment.boundaries[boundary] = null;
	} else {
		segment = { kind: "text", text: "", boundaries: [start] };
		segments.push(segment);
	}
	segment.text += text;
	for (let offset = 1; offset < text.length; offset++) {
		segment.boundaries.push(text.length === end - start ? start + offset : null);
	}
	segment.boundaries.push(end);
}

function splitsSurrogatePair(text: string, offset: number): boolean {
	const previous = text.charCodeAt(offset - 1);
	const current = text.charCodeAt(offset);
	return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff;
}

export function toPosition(source: string, lineStart: number, offset: number): SourcePosition {
	const lines = source.slice(0, offset).split("\n");
	return { line: lineStart + lines.length - 1, ch: lines[lines.length - 1].length };
}
