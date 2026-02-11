import { App, TFile, MarkdownView, Component, WorkspaceLeaf } from 'obsidian';

/**
 * 基于百分比的同步滚动管理器
 */
export class ScrollSyncManager extends Component {
    private app: App;
    private previewEl: HTMLElement | null = null;
    private currentFile: TFile | null = null;
    private syncEnabled: boolean = false;
    private isSyncing: boolean = false;
    private lastSyncTime: number = 0;
    private editorScrollHandler: (() => void) | null = null;

    constructor(app: App) {
        super();
        this.app = app;
    }

    setEnabled(enabled: boolean): void {
        this.syncEnabled = enabled;
        if (enabled) {
            this.startSync();
        } else {
            this.stopSync();
        }
    }

    isEnabled(): boolean {
        return this.syncEnabled;
    }
    
    initialize(previewEl: HTMLElement, currentFile: TFile): void {
        this.previewEl = previewEl;
        this.currentFile = currentFile;
    }

    private startSync(): void {
        if (!this.previewEl) return;
        
        this.previewEl.addEventListener('scroll', this.handlePreviewScroll, { passive: true });
        this.startEditorScrollSync();
        
        console.log('[ScrollSync] 同步已开启');
    }

    private stopSync(): void {
        if (!this.previewEl) return;
        this.previewEl.removeEventListener('scroll', this.handlePreviewScroll);
        this.stopEditorScrollSync();
    }

    private startEditorScrollSync(): void {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || !this.currentFile) return;
        if (activeView.file?.path !== this.currentFile.path) return;

        // 获取 CodeMirror 实例 (CM5 或 CM6)
        const cm = this.getCodeMirror(activeView);
        if (!cm) {
            console.log('[ScrollSync] 无法获取 CodeMirror');
            return;
        }

        this.editorScrollHandler = () => {
            if (!this.syncEnabled || this.isSyncing || !this.previewEl) return;
            
            const scrollInfo = this.getScrollInfo(cm);
            if (!scrollInfo) return;
            
            const percentage = scrollInfo.height > 0 ? scrollInfo.top / scrollInfo.height : 0;
            this.syncPreviewToPercentage(percentage);
        };

        // 绑定滚动事件
        if (cm.on) {
            cm.on('scroll', this.editorScrollHandler);
        }
    }

    private stopEditorScrollSync(): void {
        if (!this.editorScrollHandler) return;
        
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;
        
        const cm = this.getCodeMirror(activeView);
        if (cm && cm.off && this.editorScrollHandler) {
            cm.off('scroll', this.editorScrollHandler);
        }
        
        this.editorScrollHandler = null;
    }

    /**
     * 获取 CodeMirror 实例（兼容 CM5 和 CM6）
     */
    private getCodeMirror(view: MarkdownView): any {
        // 尝试多种方式获取 CodeMirror
        const editor = view.editor as any;
        
        // 方式1: 直接访问 cm
        if (editor.cm) return editor.cm;
        
        // 方式2: 通过 editor 的 cm 属性（CM6 可能不同）
        if (editor.editor) return editor.editor;
        
        // 方式3: 查找 DOM 中的 CodeMirror 元素
        const container = view.containerEl;
        const cmEl = container.querySelector('.cm-editor, .CodeMirror');
        if (cmEl) {
            // @ts-ignore
            return cmEl.CodeMirror || (cmEl as any).cm;
        }
        
        return null;
    }

    /**
     * 获取滚动信息（兼容 CM5 和 CM6）
     */
    private getScrollInfo(cm: any): { top: number; height: number; clientHeight: number } | null {
        try {
            // CM5: scrollInfo() 方法
            if (typeof cm.scrollInfo === 'function') {
                return cm.scrollInfo();
            }
            
            // CM6: 通过 view 对象
            if (cm.view && cm.view.viewState) {
                const { top, height, clientHeight } = cm.view.viewState;
                return { top, height, clientHeight };
            }
            
            // 直接访问 scrollTop 等属性
            if (cm.scrollTop !== undefined) {
                return {
                    top: cm.scrollTop,
                    height: cm.scrollHeight || cm.getScrollHeight?.(),
                    clientHeight: cm.clientHeight
                };
            }
        } catch (e) {
            console.error('[ScrollSync] 获取滚动信息失败:', e);
        }
        
        return null;
    }

    /**
     * 设置编辑器滚动位置
     */
    private setEditorScroll(cm: any, top: number): void {
        try {
            // CM5: scrollTo(x, y)
            if (typeof cm.scrollTo === 'function') {
                cm.scrollTo(null, top);
                return;
            }
            
            // CM6: 通过 dispatch
            if (cm.view && cm.view.dispatch) {
                cm.view.dispatch({ effects: [] }); // 需要特定的 scroll effect
                cm.view.scrollDOM.scrollTop = top;
                return;
            }
            
            // 直接设置
            if (cm.scrollTop !== undefined) {
                cm.scrollTop = top;
            }
        } catch (e) {
            console.error('[ScrollSync] 设置滚动位置失败:', e);
        }
    }

    private handlePreviewScroll = (): void => {
        if (!this.syncEnabled || this.isSyncing || !this.previewEl) return;
        
        const now = Date.now();
        if (now - this.lastSyncTime < 50) return;
        this.lastSyncTime = now;
        
        this.isSyncing = true;
        
        const scrollTop = this.previewEl.scrollTop;
        const scrollHeight = this.previewEl.scrollHeight - this.previewEl.clientHeight;
        const percentage = scrollHeight > 0 ? scrollTop / scrollHeight : 0;
        
        this.syncEditorToPercentage(percentage);
        
        setTimeout(() => {
            this.isSyncing = false;
        }, 50);
    };

    private syncEditorToPercentage(percentage: number): void {
        if (!this.currentFile) return;
        
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || activeView.file?.path !== this.currentFile.path) return;

        const cm = this.getCodeMirror(activeView);
        if (!cm) return;

        const scrollInfo = this.getScrollInfo(cm);
        if (!scrollInfo) return;

        const targetScrollTop = percentage * scrollInfo.height;
        this.setEditorScroll(cm, targetScrollTop);
    }

    private syncPreviewToPercentage(percentage: number): void {
        if (!this.previewEl) return;
        
        const scrollHeight = this.previewEl.scrollHeight - this.previewEl.clientHeight;
        if (scrollHeight > 0) {
            this.isSyncing = true;
            this.previewEl.scrollTop = percentage * scrollHeight;
            setTimeout(() => {
                this.isSyncing = false;
            }, 50);
        }
    }

    destroy(): void {
        this.stopSync();
        super.unload();
    }
}
