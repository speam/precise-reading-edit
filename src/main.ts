import { MarkdownView, Plugin, type EditorPosition, type MarkdownPostProcessorContext } from "obsidian";
import { captureReadingHit, collectReadingBlocks, findReadingBlock, readRenderedSegments } from "./reading-dom";
import { resolvePosition } from "./resolve-position";
import { resolveStructuredPosition } from "./structured-position";

export default class PreciseReadingEdit extends Plugin {
	private readonly renderContexts = new WeakMap<Element, MarkdownPostProcessorContext>();
	private readonly boundDocuments = new WeakSet<Document>();
	private readonly pending = new WeakSet<MarkdownView>();
	private running = false;

	onload(): void {
		this.running = true;
		this.registerMarkdownPostProcessor((element, context) => {
			this.renderContexts.set(element, context);
		});
		this.bindDocument(document);
		const { workspace } = this.app;
		workspace.onLayoutReady(() => {
			if (!this.running) return;
			workspace.iterateAllLeaves(leaf => this.bindDocument(leaf.view.containerEl.ownerDocument));
		});
		this.registerEvent(workspace.on("window-open", (_workspaceWindow, window) => {
			this.bindDocument(window.document);
		}));
		this.registerEvent(workspace.on("active-leaf-change", leaf => {
			if (leaf) this.bindDocument(leaf.view.containerEl.ownerDocument);
		}));
	}

	onunload(): void {
		this.running = false;
	}

	private bindDocument(doc: Document): void {
		if (this.boundDocuments.has(doc)) return;
		this.boundDocuments.add(doc);
		this.registerDomEvent(doc, "dblclick", this.handleDoubleClick);
	}

	private readonly handleDoubleClick = (event: MouseEvent): void => {
		if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const found = findReadingBlock(event.target);
		if (!found) return;
		const { target, block, readingView, structured } = found;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!view || !file || view.getMode() !== "preview" || !view.containerEl.contains(readingView) || this.pending.has(view)) return;

		let context: MarkdownPostProcessorContext | undefined;
		let root: Element | null = block;
		for (; root && root !== readingView; root = root.parentElement) {
			context = this.renderContexts.get(root);
			if (context) break;
		}
		if (!root || !context || context.sourcePath !== file.path) return;
		const section = context.getSectionInfo(block);
		if (!section || section.text !== view.getViewData()) return;

		const hit = captureReadingHit(block, target, event.clientX, event.clientY);
		if (!hit) return;
		const blocks = structured ? collectReadingBlocks(root) : null;
		const position = blocks
			? resolveStructuredPosition(
				section, blocks, blocks.findIndex(candidate => candidate.element === block),
				hit.segments, hit.hit, index => readRenderedSegments(blocks[index].element),
			)
			: resolvePosition(section, hit.segments, hit.hit);
		if (!position) return;

		event.preventDefault();
		this.pending.add(view);
		void this.editAt(view, section.text, position).finally(() => this.pending.delete(view));
	};

	private async editAt(view: MarkdownView, source: string, position: EditorPosition): Promise<void> {
		const { leaf, file } = view;
		const state = view.getState();
		const scroll = view.previewMode.getScroll();
		const isCurrent = () => this.running && leaf.view === view && view.file === file &&
			this.app.workspace.getActiveViewOfType(MarkdownView) === view;
		try {
			await view.setState({ ...state, mode: "source" }, { history: false });
			if (!isCurrent() || view.getMode() !== "source") return;
			const { editor } = view;
			if (editor.getValue() === source) {
				editor.setCursor(position);
				const cursor = editor.getCursor();
				if (cursor.line === position.line && cursor.ch === position.ch) {
					editor.focus();
					editor.scrollIntoView({ from: position, to: position });
					return;
				}
			}
		} catch (error) {
			console.error("Precise Reading Edit 切换失败", error);
		}

		// 渲染后到切换完成之间有可能发生外部同步。只恢复仍由本次操作控制的笔记。
		if (!isCurrent() || view.getMode() !== "source") return;
		try {
			await view.setState(state, { history: false });
			if (isCurrent() && view.getMode() === "preview" && scroll !== null) {
				view.previewMode.applyScroll(scroll);
			}
		} catch (error) {
			console.error("Precise Reading Edit 恢复阅读视图失败", error);
		}
	}
}
