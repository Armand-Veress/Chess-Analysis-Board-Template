import { Component, ViewChild, ElementRef, AfterViewInit, AfterViewChecked, ChangeDetectorRef, HostListener, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chessground } from 'chessground';
import { Api } from 'chessground/api';
import { Color, PieceType, Annotation } from '../models/chess-enums';
import { MoveNode } from '../models/move-node.model';
import { MoveTree } from '../models/move-tree.model';
import { Chess, Square } from 'chess.js';
import { EngineService } from '../services/engine.service';
import { Key } from 'chessground/types';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-chess-board',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './chess-board.component.html',
    styleUrl: './chess-board.component.css'
})
export class ChessBoardComponent implements OnInit, AfterViewInit, AfterViewChecked {
    @ViewChild('startNode') startNodeElement!: ElementRef;
    @ViewChild('engineBtn') engineBtnElement!: ElementRef;
    @ViewChild('jpgBtn') jpgBtnElement!: ElementRef;
    @ViewChild('pgnBtn') pgnBtnElement!: ElementRef;
    @ViewChild('copyPgnBtn') copyPgnBtnElement!: ElementRef;
    @ViewChild('copyFenBtn') copyFenBtnElement!: ElementRef;
    @ViewChild('setupBtn') setupBtnElement!: ElementRef;
    @ViewChild('importBtn') importBtnElement!: ElementRef;
    @ViewChild('coordsBtn') coordsBtnElement!: ElementRef;
    @ViewChild('orientationBtn') orientationBtnElement!: ElementRef;
    @ViewChild('settingsBtn') settingsBtnElement!: ElementRef;

    // --- API PUBLIC (Plug & Play) ---
    @Input() startingFen: string = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    @Input() autoStartEngine: boolean = false;
    
    @Output() onMoveMade = new EventEmitter<{ orig: string, dest: string, fen: string }>();
    // --------------------------------

    private cgApi?: Api;
    private game = new Chess();
    readonly Annotation = Annotation;
    drawingsVisible = false;
    showCoordinates = false;
    isEngineEnabled = false;
    currentEval: string = '0.0';
    showVariationPicker = false;
    pendingVariations: MoveNode[] = [];
    selectedIndex = 0;
    readonly Color = Color;
    public analysisLines: any[] = [];
    showImportModal = false;
    importValue = '';
    importPlaceholder = '';
    importType: 'FEN' | 'PGN' = 'FEN';
    fenValue = '';
    pgnValue = '';
    isSetupMode: boolean = false;
    selectedSetupPiece: string | null = null;
    isSetupFlipped: boolean = false;
    setupTurn: 'w' | 'b' = 'w';
    castling = { wK: true, wQ: true, bK: true, bQ: true };
    enPassantSquare: string = '-';
    private engineTimeout: any;
    setupCgApi?: Api;
    enPassantOptions: string[] = ['-'];
    setupError: boolean = false;

    isFenCopied = false;
    isPgnCopied = false;

    private isDrawingGesture = false;
    private touchStartSquare: string | null = null;
    private lastTouchSquare: string | null = null;
    private longPressActive = false;

    activeTooltipButtonId: string | null = null;
    private tooltipShowTimer: any;
    private tooltipHideTimer: any;

    private _showBoardSettings = false;
    
    get showBoardSettings(): boolean {
        return this._showBoardSettings;
    }
    
    set showBoardSettings(value: boolean) {
        this._showBoardSettings = value;
        this.recalculateBoardBounds();
    }
    
    private boundsAnimFrame: any;
    private lastBoardTop: number = 0;
    
    private recalculateBoardBounds() {
        if (this.boundsAnimFrame) {
            cancelAnimationFrame(this.boundsAnimFrame);
        }
        
        const startTime = Date.now();
        const boardEl = document.getElementById('chessground-board');
        
        const update = () => {
            if (boardEl) {
                const currentTop = boardEl.getBoundingClientRect().top;
                if (currentTop !== this.lastBoardTop) {
                    this.lastBoardTop = currentTop;
                    this.cgApi?.redrawAll();
                }
            }
            if (Date.now() - startTime < 350) {
                this.boundsAnimFrame = requestAnimationFrame(update);
            }
        };
        this.boundsAnimFrame = requestAnimationFrame(update);
    }

    moveTree: MoveTree = {
        root: {
            isRoot: true,
            from: '' as any,
            to: '' as any,
            piece: '' as any,
            color: Color.WHITE,
            fen: this.startingFen,
            san: 'START',
            children: [],
            parent: null,
            drawings: []
        },
        currentNode: null,
        moveNumber: 1,
        color: Color.WHITE
    };

    contextMenu = {
        visible: false,
        x: 0,
        y: 0,
        node: null as MoveNode | null,
        showAnnotations: false,
        isLowSpace: false
    };

    promotionData: {
        from: string,
        to: string,
        color: 'w' | 'b',
        x: number,
        y: number,
        isWhite: boolean
    } | null = null;
    showPromotionPopup = false;

    private readonly promoOrder = ['q', 'n', 'r', 'b'];

    constructor(private cdr: ChangeDetectorRef, private engineService: EngineService) { }

    @ViewChild('setupBoard') set setupBoardContent(content: ElementRef) {
        if (content && !this.setupCgApi) {
            this.initSetupBoard(content.nativeElement);
        }
    }

    @HostListener('window:resize')
    onResize() {
        if (this.cgApi) {
            this.cgApi.redrawAll();
        }
    }

    ngOnInit(): void {
        if (this.startingFen) {
            this.game.load(this.startingFen);
            this.updateTreeFromFen(this.startingFen); 
        }
        this.moveTree.currentNode = this.moveTree.root;

        if (this.autoStartEngine) {
            this.toggleEngine();
        }

        this.engineService.bestMove$.subscribe(move => {
            if (this.isEngineEnabled) {
                this.cgApi?.set({
                    drawable: {
                        autoShapes: [{
                            orig: move.orig as any,
                            dest: move.dest as any,
                            brush: 'blue',
                            modifiers: { lineWidth: 8 }
                        }]
                    }
                });
            }
        });

        this.engineService.multiPV$.subscribe(lines => {
            if (this.isEngineEnabled) {
                this.analysisLines = [
                    lines[0] || null,
                    lines[1] || null
                ];
                this.cdr.detectChanges();
            }
        });

        this.engineService.evaluation$.subscribe(ev => {
            this.currentEval = ev;
            this.cdr.detectChanges();
        });
    }

    ngAfterViewInit(): void {
        this.initBoard();
        this.setupMobileDrawing();
        this.initPassiveListeners();
    }

    private initPassiveListeners(): void {
        if (this.startNodeElement) {
            this.startNodeElement.nativeElement.addEventListener('touchstart', (e: TouchEvent) => {
                this.handlePressStart(e, this.moveTree.root);
            }, { passive: true });
        }

        const buttons = [
            { el: this.engineBtnElement, tip: 'Toggle Engine Analysis' },
            { el: this.jpgBtnElement, tip: 'Save as JPG' },
            { el: this.pgnBtnElement, tip: 'Save as PGN' },
            { el: this.copyPgnBtnElement, tip: 'Copy PGN Analysis' },
            { el: this.copyFenBtnElement, tip: 'Copy FEN' },
            { el: this.setupBtnElement, tip: 'Setup board' },
            { el: this.importBtnElement, tip: 'Import FEN / PGN' },
            { el: this.coordsBtnElement, tip: 'Toggle Coordinates' },
            { el: this.orientationBtnElement, tip: 'Rotate Board' },
            { el: this.settingsBtnElement, tip: 'Settings Menu' }
        ];

        buttons.forEach(btn => {
            if (btn.el) {
                btn.el.nativeElement.addEventListener('touchstart', (e: TouchEvent) => {
                    this.handleTooltipPress(e, btn.tip);
                    e.stopPropagation();
                }, { passive: true });
            }
        });
    }

    ngAfterViewInitChecked(): void {
        this.scrollToActive();
    }

    ngAfterViewChecked(): void {
        this.scrollToActive();
    }

    isStartIconGlowing(): boolean {
        return this.moveTree.currentNode === this.moveTree.root && this.drawingsVisible;
    }

    hasDrawingsOnRoot(): boolean {
        return !!this.moveTree.root.drawings?.length;
    }

    private initBoard(fen?: string): void {
        const container = document.getElementById('chessground-board');
        if (container) {
            container.innerHTML = '';
            this.cgApi = Chessground(container, this.getBoardOptions(fen));
        }
    }

    private getDests(): Map<Square, Square[]> {
        const dests = new Map();
        this.game.moves({ verbose: true }).forEach(m => {
            const ms = dests.get(m.from) || [];
            ms.push(m.to);
            dests.set(m.from, ms);
        });
        return dests;
    }

    private handleMove(orig: string, dest: string): void {
        if (this.isDrawingGesture) {
            return;
        }
        
        const piece = this.game.get(orig as any);
        const isPawn = piece?.type === 'p';
        const isPromotionRank = (piece?.color === 'w' && dest[1] === '8') || (piece?.color === 'b' && dest[1] === '1');

        if (isPawn && isPromotionRank) {
            this.cgApi?.set({
                lastMove: [orig as any, dest as any],
                movable: { color: undefined }
            });

            const boardEl = document.getElementById('chessground-board');
            if (boardEl) {
                const rect = boardEl.getBoundingClientRect();
                const colIndex = dest.charCodeAt(0) - 97;
                const squareSize = rect.width / 8;
                const isWhite = piece.color === 'w';

                this.promotionData = {
                    from: orig,
                    to: dest,
                    color: piece.color as 'w' | 'b',
                    x: rect.left + (colIndex * squareSize),
                    y: isWhite ? rect.top : rect.top + (4 * squareSize),
                    isWhite: isWhite
                };
                this.showPromotionPopup = true;
                this.cdr.detectChanges();
                return;
            }
        }
        this.executeMove(orig, dest, 'q');
    }

    executeMove(orig: string, dest: string, promotionPiece: string): void {
        this.analysisLines = [];
        this.currentEval = '...';
        this.cdr.detectChanges();

        try {
            const move = this.game.move({ from: orig, to: dest, promotion: promotionPiece });
            if (move) {
                const newNode: MoveNode = {
                    isRoot: false,
                    from: orig as any,
                    to: dest as any,
                    piece: move.piece.toUpperCase() as PieceType,
                    color: move.color === 'w' ? Color.WHITE : Color.BLACK,
                    fen: this.game.fen(),
                    san: move.san,
                    children: [],
                    parent: this.moveTree.currentNode
                };

                if (this.moveTree.currentNode) {
                    const exists = this.moveTree.currentNode.children.find(c => c.fen === newNode.fen);
                    if (exists) {
                        this.moveTree.currentNode = exists;
                    } else {
                        this.moveTree.currentNode.children.push(newNode);
                        this.moveTree.currentNode = newNode;
                    }
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            this.showPromotionPopup = false;
            this.promotionData = null;
            this.drawingsVisible = true;
            this.syncBoard();
            this.onMoveMade.emit({ orig, dest, fen: this.game.fen() });
        }
    }

    cancelPromotion(): void {
        this.showPromotionPopup = false;
        this.promotionData = null;
        this.syncBoard();
    }

    private syncBoard(): void {
        const targetFen = this.moveTree.currentNode?.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        try {
            this.game.load(targetFen);
        } catch (e) {
            console.error("FEN invalid în syncBoard:", targetFen);
            return;
        }

        this.analysisLines = [null, null];
        this.currentEval = '...';

        this.cgApi?.set({
            fen: targetFen,
            turnColor: this.game.turn() === 'w' ? 'white' : 'black',
            movable: { color: 'both', dests: this.getDests() },
            drawable: {
                shapes: this.drawingsVisible ? (this.moveTree.currentNode?.drawings || []) : []
            },
            lastMove: this.moveTree.currentNode?.parent ? [this.moveTree.currentNode.from as any, this.moveTree.currentNode.to as any] : undefined
        });

        if (this.isEngineEnabled) {
            clearTimeout(this.engineTimeout);
            this.engineTimeout = setTimeout(() => {
                this.engineService.analyze(this.game.fen());
            }, 150);
        }

        this.cdr.detectChanges();
    }

    toggleEngine(): void {
        if (this.longPressActive) {
            this.longPressActive = false;
            return;
        }
        this.isEngineEnabled = !this.isEngineEnabled;

        if (this.isEngineEnabled) {
            const currentFen = this.game.fen();
            this.engineService.analyze(currentFen);
        } else {
            this.engineService.stop();
            this.analysisLines = [null, null];
            this.currentEval = '0.0';
            this.cgApi?.set({ drawable: { autoShapes: [] } });
        }

        this.cdr.detectChanges();
    }

    onContextMenu(event: MouseEvent | TouchEvent, node: MoveNode): void {
        if (event instanceof MouseEvent) {
            event.preventDefault();
        }
        event.stopPropagation();

        const target = event.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const menuHeight4x6 = 320;
        const menuWidth6x4 = 300;

        let xPos = rect.right + 8;
        let yPos = rect.top;
        let lowSpace = false;

        if (yPos + menuHeight4x6 > window.innerHeight) {
            lowSpace = true;
            yPos = window.innerHeight - 200;
        }

        const currentWidth = lowSpace ? menuWidth6x4 : 200;
        if (xPos + currentWidth > window.innerWidth) {
            xPos = rect.left - currentWidth - 8;
        }

        xPos = Math.max(10, Math.min(xPos, window.innerWidth - currentWidth - 10));

        this.contextMenu = {
            visible: true,
            x: xPos,
            y: yPos,
            node: node,
            showAnnotations: false,
            isLowSpace: lowSpace
        };

        this.cdr.detectChanges();
    }

    keepOrder = (a: any, b: any) => 0;

    toggleAnnotationMenu(event: MouseEvent): void {
        event.stopPropagation();
        this.contextMenu.showAnnotations = true;
        
        const menuWidth = 260; 
        const spaceRight = window.innerWidth - this.contextMenu.x;
        const spaceLeft = this.contextMenu.x;
        
        if (spaceRight < menuWidth) {
            this.contextMenu.x = window.innerWidth - menuWidth - 20;
        } else if (spaceLeft < 20) {
            this.contextMenu.x = 20;
        }
        
        this.cdr.detectChanges();
        
        const menuEl = document.querySelector('.context-menu') as HTMLElement;
        if (menuEl) {
            const needsSmallGrid = window.innerWidth < 400;
            menuEl.style.setProperty('--grid-cols', needsSmallGrid ? '4' : '6');
        }
    }

    setAnnotation(node: MoveNode, annotation: Annotation): void {
        if (this.longPressActive) {
            this.longPressActive = false;
            return;
        }
        if (!node) return;
        
        node.annotation = (annotation === Annotation.EMPTY) ? undefined : annotation;
        this.syncBoard();
        this.contextMenu.visible = false;
    }

    @HostListener('document:click')
    closeContextMenu(): void {
        this.contextMenu.visible = false;
    }

    selectMove(node: MoveNode): void {
        if (this.longPressActive) {
            this.longPressActive = false;
            return;
        }
        this.cancelPromotion();
        this.moveTree.currentNode = node;
        this.drawingsVisible = false;
        this.syncBoard();
    }

    goBack(): void {
        this.cancelPromotion();
        
        if (this.showVariationPicker) {
            this.showVariationPicker = false;
            this.cdr.detectChanges();
            return;
        }
        
        const currentNode = this.moveTree.currentNode;
        if (!currentNode || currentNode === this.moveTree.root) {
            this.drawingsVisible = false;
            this.syncBoard();
            return;
        }
        
        if (currentNode.drawings?.length && this.drawingsVisible) {
            this.drawingsVisible = false;
            this.syncBoard();
            return;
        }
        
        this.moveTree.currentNode = currentNode.parent;
        this.drawingsVisible = false;
        this.syncBoard();
    }

    goForward(): void {
        this.cancelPromotion();
        
        if (this.showVariationPicker) {
            this.pickVariation(this.pendingVariations[this.selectedIndex]);
            return;
        }
        
        const currentNode = this.moveTree.currentNode;
        if (!currentNode) return;
        
        if (currentNode.children.length === 0) {
            if (this.drawingsVisible === false) {
                this.drawingsVisible = true;
                this.syncBoard();
            }
            return;
        }
        
        if (currentNode.drawings?.length && !this.drawingsVisible) {
            this.drawingsVisible = true;
            this.syncBoard();
            return;
        }
        
        const children = currentNode.children;
        if (children.length === 1) {
            this.selectMove(children[0]);
        } else {
            this.pendingVariations = children;
            this.selectedIndex = 0;
            this.showVariationPicker = true;
            this.cdr.detectChanges();
        }
    }

    handleVariationKeydown(event: KeyboardEvent): void {
        if (!this.showVariationPicker) return;
        
        switch (event.key) {
            case 'ArrowDown':
                this.selectedIndex = (this.selectedIndex + 1) % this.pendingVariations.length;
                break;
            case 'ArrowUp':
                this.selectedIndex = (this.selectedIndex - 1 + this.pendingVariations.length) % this.pendingVariations.length;
                break;
            case 'ArrowRight':
            case 'Enter':
                this.pickVariation(this.pendingVariations[this.selectedIndex]);
                break;
            case 'ArrowLeft':
            case 'Escape':
                this.showVariationPicker = false;
                break;
        }
        
        event.preventDefault();
        this.cdr.detectChanges();
    }

    pickVariation(node: MoveNode): void {
        this.showVariationPicker = false;
        this.selectMove(node);
    }

    goToRoot(): void {
        this.cancelPromotion();
        this.moveTree.currentNode = this.moveTree.root;
        this.drawingsVisible = false;
        this.syncBoard();
    }

    goToLast(): void {
        this.cancelPromotion();
        while (this.canGoForward()) {
            this.goForward();
        }
        this.drawingsVisible = false;
        this.syncBoard();
    }

    canGoForward(): boolean {
        const node = this.moveTree.currentNode;
        if (node && node.drawings && node.drawings.length > 0 && !this.drawingsVisible) {
            return true;
        }
        return !!(this.moveTree.root && (!node || node.children.length > 0));
    }

    deleteMove(node: MoveNode): void {
        if (!node || node === this.moveTree.root) return;
        
        this.cancelPromotion();
        const parent = node.parent;
        
        if (parent) {
            parent.children = parent.children.filter(c => c !== node);
            if (this.moveTree.currentNode === node || this.isDescendant(node, this.moveTree.currentNode)) {
                this.moveTree.currentNode = parent;
            }
        }
        this.syncBoard();
    }

    promoteLine(node: MoveNode): void {
        if (!node || !node.parent) return;
        
        let currentNode = node;
        let parent = node.parent;
        
        while (parent) {
            const index = parent.children.indexOf(currentNode);
            if (index > 0) {
                const [targetMove] = parent.children.splice(index, 1);
                parent.children.unshift(targetMove);
            }
            if (!parent.parent) break;
            currentNode = parent;
            parent = parent.parent;
        }
        
        this.syncBoard();
        this.contextMenu.visible = false;
        this.cdr.detectChanges();
    }

    private isDescendant(parent: MoveNode, current: MoveNode | null): boolean {
        let node = current;
        while (node) {
            if (node === parent) return true;
            node = node.parent;
        }
        return false;
    }

    private scrollToActive(): void {
        if (this.contextMenu.visible) return;
        const activeMove = document.querySelector('.move-item-container.active');
        activeMove?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }

    @HostListener('window:keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent): void {
        const target = event.target as HTMLElement;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) {
            return;
        }
        
        if (this.showVariationPicker) {
            this.handleVariationKeydown(event);
            return;
        }
        
        switch (event.key) {
            case 'ArrowLeft': 
                this.goBack(); 
                event.preventDefault(); 
                break;
            case 'ArrowRight': 
                this.goForward(); 
                event.preventDefault(); 
                break;
            case 'ArrowUp': 
                this.goToRoot(); 
                event.preventDefault(); 
                break;
            case 'ArrowDown': 
                this.goToLast(); 
                event.preventDefault(); 
                break;
        }
    }

    startEditingComment(node: MoveNode): void {
        if (!node) return;
        
        node.comment = node.comment || '';
        this.contextMenu.visible = false;
        this.cdr.detectChanges();
        
        setTimeout(() => {
            const span = document.querySelector(`[data-fen="${node.fen}"]`) as HTMLElement;
            if (span) {
                span.focus();
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(span);
                range.collapse(false);
                selection?.removeAllRanges();
                selection?.addRange(range);
            }
        }, 50);
    }

    onCommentInput(node: MoveNode, event: any): void { }

    onCommentBlur(node: MoveNode): void {
        const span = document.querySelector(`[data-fen="${node.fen}"]`) as HTMLElement;
        if (span) {
            const text = span.textContent?.trim() || '';
            node.comment = text === '' ? undefined : text;
            this.cdr.detectChanges();
        }
    }

    clearNodeArrows(): void {
        if (this.contextMenu.node) {
            this.contextMenu.node.drawings = [];
            if (this.contextMenu.node === this.moveTree.currentNode) {
                this.cgApi?.set({ drawable: { shapes: [] } });
            }
            this.contextMenu.visible = false;
            this.cdr.detectChanges();
        }
    }

    onRootLabelBlur(event: any): void {
        const newText = event.target.textContent?.trim();
        this.moveTree.root.san = newText || 'START';
        if (!newText) {
            event.target.textContent = 'START';
        }
        this.cdr.detectChanges();
    }

    toggleOrientation(): void {
        if (this.longPressActive) {
            this.longPressActive = false;
            return;
        }
        
        if (this.cgApi) {
            const current = this.cgApi.state.orientation;
            this.cgApi.set({ orientation: current === 'white' ? 'black' : 'white' });
        }
    }

    copyFEN(): void {
        if (this.longPressActive) {
            this.longPressActive = false;
            return;
        }
        
        navigator.clipboard.writeText(this.game.fen()).then(() => {
            this.isFenCopied = true;
            this.cdr.detectChanges();
            setTimeout(() => {
                this.isFenCopied = false;
                this.cdr.detectChanges();
            }, 2000);
        });
    }

    getFallbackMoveNumber(node: MoveNode): string {
        if (node.isRoot) return '';
        
        const fenParts = node.parent?.fen.split(' ') || [];
        const moveNum = fenParts[5] ? fenParts[5] : '1';
        const isBlack = node.color === Color.BLACK;
        
        return isBlack ? `${moveNum}...` : `${moveNum}.`;
    }

    async downloadDiagram(): Promise<void> {
        if (this.longPressActive) {
            this.longPressActive = false;
            return;
        }
        
        const boardElement = document.querySelector('cg-board') as HTMLElement;
        if (!boardElement || !this.cgApi) return;
        
        const size = boardElement.clientWidth;
        const canvas = document.createElement('canvas');
        canvas.width = size * 2;
        canvas.height = size * 2;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.scale(2, 2);
        
        const isBlackOriented = this.cgApi.state.orientation === 'black';
        const lightColor = '#ebecd0';
        const darkColor = '#b5b993';
        const squareSize = size / 8;
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                ctx.fillStyle = (row + col) % 2 === 1 ? darkColor : lightColor;
                ctx.fillRect(col * squareSize, row * squareSize, squareSize, squareSize);
            }
        }
        
        if (this.showCoordinates) {
            ctx.fillStyle = '#000';
            ctx.font = 'bold 10px sans-serif';
            const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
            const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];
            
            for (let i = 0; i < 8; i++) {
                const fileText = isBlackOriented ? files[7 - i] : files[i];
                ctx.fillText(fileText, i * squareSize + 2, size - 2);
                
                const rankText = isBlackOriented ? ranks[i] : ranks[7 - i];
                ctx.fillText(rankText, 2, i * squareSize + 12);
            }
        }
        
        const pieces = boardElement.querySelectorAll('piece');
        const piecePromises = Array.from(pieces).map(piece => {
            return new Promise<void>((resolve) => {
                const img = new Image();
                const bgImage = getComputedStyle(piece).backgroundImage;
                
                if (!bgImage || bgImage === 'none') {
                    return resolve();
                }
                
                const url = bgImage.slice(4, -1).replace(/"/g, "");
                img.onload = () => {
                    const transform = getComputedStyle(piece).transform;
                    const matrix = transform.match(/matrix\((.+)\)/);
                    if (matrix) {
                        const values = matrix[1].split(', ');
                        ctx.drawImage(img, parseFloat(values[4]), parseFloat(values[5]), squareSize, squareSize);
                    }
                    resolve();
                };
                img.onerror = () => resolve();
                img.src = url;
            });
        });
        
        await Promise.all(piecePromises);
        
        const link = document.createElement('a');
        link.download = `chess-diagram.jpg`;
        link.href = canvas.toDataURL('image/jpg');
        link.click();
    }

    private getBoardOptions(fen?: string): any {
        return {
            coordinates: this.showCoordinates,
            fen: fen || this.game.fen() || this.startingFen,
            orientation: this.cgApi?.state.orientation || 'white',
            movable: {
                free: false,
                color: 'both',
                dests: this.getDests(),
                showDests: true, 
                events: {
                    after: (orig: any, dest: any) => {
                        this.cgApi?.set({ animation: { enabled: false } });
                        this.handleMove(orig, dest);
                        
                        setTimeout(() => {
                            this.cgApi?.set({
                                animation: { enabled: true, duration: 200 },
                                drawable: { shapes: this.drawingsVisible ? (this.moveTree.currentNode?.drawings || []) : [] }
                            });
                        }, 10);
                    },
                    select: (key: any) => {
                        const dests = this.getDests().get(key);
                        if (dests && dests.length > 0) {
                            this.cgApi?.set({ drawable: { autoShapes: [] } });
                        }
                    }
                }
            },
            animation: { enabled: true, duration: 200 },
            drawable: {
                enabled: true,
                visible: true,
                eraseOnClick: false,
                stopPropagation: false,
                brushes: {
                    'green':  { key: 'green',  color: '#ff8c00', opacity: 1, lineWidth: 10 },
                    'blue':   { key: 'blue',   color: '#4a6a8a', opacity: 1, lineWidth: 10 },
                    'yellow': { key: 'yellow', color: '#c62828', opacity: 1, lineWidth: 10 },
                    'red':    { key: 'red',    color: '#627b3d', opacity: 1, lineWidth: 10 },
                },
                shapes: this.drawingsVisible ? (this.moveTree.currentNode?.drawings || []) : [],
                onChange: (shapes: any) => {
                    if (shapes.length > 0 && this.moveTree.currentNode && !this.isDrawingGesture) {
                        const existing = this.moveTree.currentNode.drawings || [];
                        const merged = [...existing, ...shapes];
                        this.moveTree.currentNode.drawings = merged;
                        this.cgApi?.set({ drawable: { shapes: merged } });
                        this.drawingsVisible = true;
                        this.cdr.detectChanges();
                    }
                }
            }
        };
    }

    toggleCoordinates(): void {
        if (this.longPressActive) {
            this.longPressActive = false;
            return;
        }
        
        this.showCoordinates = !this.showCoordinates;
        const container = document.getElementById('chessground-board');
        
        if (container) {
            container.innerHTML = '';
            this.cgApi = Chessground(container, this.getBoardOptions());
            this.cdr.detectChanges();
        }
    }

    getAnnotationTooltip(annValue: string): string {
        const tooltips: { [key: string]: string } = {
            [Annotation.EMPTY]: 'Clear annotation',
            [Annotation.EQUAL_POSITION]: 'Equal position',
            [Annotation.ONLY_MOVE]: 'Only move',
            [Annotation.ZUGZWANG]: 'Zugzwang',
            [Annotation.WITH_THE_IDEA]: 'With the idea',
            [Annotation.UNCLEAR_POSITION]: 'Unclear position',
            [Annotation.GOOD_MOVE]: 'Good move',
            [Annotation.MISTAKE]: 'Mistake',
            [Annotation.BRILLIANT_MOVE]: 'Brilliant move',
            [Annotation.BLUNDER]: 'Blunder',
            [Annotation.INTERESTING_MOVE]: 'Interesting move',
            [Annotation.DUBIOUS_MOVE]: 'Dubious move',
            [Annotation.WHITE_IS_SLIGHTLY_BETTER]: 'White is slightly better',
            [Annotation.BLACK_IS_SLIGHTLY_BETTER]: 'Black is slightly better',
            [Annotation.WHITE_IS_BETTER]: 'White is better',
            [Annotation.BLACK_IS_BETTER]: 'Black is better',
            [Annotation.WHITE_IS_WINNING]: 'White is winning',
            [Annotation.BLACK_IS_WINNING]: 'Black is winning',
            [Annotation.NOVELTY]: 'Theoretical novelty',
            [Annotation.DEVELOPMENT]: 'Lead in development',
            [Annotation.INITIATIVE]: 'With initiative',
            [Annotation.ATTACK]: 'With attack',
            [Annotation.COUNTERPLAY]: 'With counterplay',
            [Annotation.WITH_COMPENSATION]: 'With compensation',
        };
        return tooltips[annValue] || '';
    }

    getMoveDisplayNumber(node: MoveNode): string {
        if (!node || !node.parent || node.san === 'START') return '';
        const fenParts = node.parent.fen.split(' ');
        return fenParts[5];
    }

    isFirstInVariation(node: MoveNode): boolean {
        if (node.isRoot || !node.parent) return false;
        if (node.parent.isRoot) return true;
        
        const siblings = node.parent.children;
        return siblings.length > 1 && siblings[0] !== node;
    }

    private getNAGCode(annotation: string): string {
        const map: { [key: string]: string } = {
            [Annotation.GOOD_MOVE]: '1',
            [Annotation.MISTAKE]: '2',
            [Annotation.BRILLIANT_MOVE]: '3',
            [Annotation.BLUNDER]: '4',
            [Annotation.INTERESTING_MOVE]: '5',
            [Annotation.DUBIOUS_MOVE]: '6',
            [Annotation.EQUAL_POSITION]: '10',
            [Annotation.UNCLEAR_POSITION]: '13',
            [Annotation.WHITE_IS_SLIGHTLY_BETTER]: '14',
            [Annotation.BLACK_IS_SLIGHTLY_BETTER]: '15',
            [Annotation.WHITE_IS_BETTER]: '16',
            [Annotation.BLACK_IS_BETTER]: '17',
            [Annotation.WHITE_IS_WINNING]: '18',
            [Annotation.BLACK_IS_WINNING]: '19',
            [Annotation.WITH_COMPENSATION]: '44',
            [Annotation.ONLY_MOVE]: '7',
            [Annotation.ZUGZWANG]: '22',
            [Annotation.WITH_THE_IDEA]: '140',
            [Annotation.NOVELTY]: '146',
            [Annotation.DEVELOPMENT]: '32',
            [Annotation.INITIATIVE]: '36',
            [Annotation.ATTACK]: '40',
            [Annotation.COUNTERPLAY]: '132',
        };
        return map[annotation] || '';
    }

    private getAnnotationFromNAG(nag: string): Annotation | undefined {
        const code = nag.replace('$', '');
        const map: { [key: string]: Annotation } = {
            '1': Annotation.GOOD_MOVE,
            '2': Annotation.MISTAKE,
            '3': Annotation.BRILLIANT_MOVE,
            '4': Annotation.BLUNDER,
            '5': Annotation.INTERESTING_MOVE,
            '6': Annotation.DUBIOUS_MOVE,
            '10': Annotation.EQUAL_POSITION,
            '13': Annotation.UNCLEAR_POSITION,
            '14': Annotation.WHITE_IS_SLIGHTLY_BETTER,
            '15': Annotation.BLACK_IS_SLIGHTLY_BETTER,
            '16': Annotation.WHITE_IS_BETTER,
            '17': Annotation.BLACK_IS_BETTER,
            '18': Annotation.WHITE_IS_WINNING,
            '19': Annotation.BLACK_IS_WINNING,
            '44': Annotation.WITH_COMPENSATION,
            '7': Annotation.ONLY_MOVE,
            '22': Annotation.ZUGZWANG,
            '140': Annotation.WITH_THE_IDEA,
            '146': Annotation.NOVELTY,
            '32': Annotation.DEVELOPMENT,
            '36': Annotation.INITIATIVE,
            '40': Annotation.ATTACK,
            '132': Annotation.COUNTERPLAY,
        };
        return map[code] || undefined;
    }

    private extractAnnotationFromSAN(san: string): Annotation | undefined {
        if (san.includes('!!')) return Annotation.BRILLIANT_MOVE;
        if (san.includes('??')) return Annotation.BLUNDER;
        if (san.includes('!?')) return Annotation.INTERESTING_MOVE;
        if (san.includes('?!')) return Annotation.DUBIOUS_MOVE;
        if (san.includes('!')) return Annotation.GOOD_MOVE;
        if (san.includes('?')) return Annotation.MISTAKE;
        if (san.includes('=')) return Annotation.EQUAL_POSITION;
        if (san.includes('\u00B1') || san.includes('+-')) return Annotation.WHITE_IS_WINNING;
        if (san.includes('\u2213') || san.includes('-+')) return Annotation.BLACK_IS_WINNING;
        if (san.includes('=\u221E') || san.includes('\u221E=')) return Annotation.WITH_COMPENSATION;
        if (san.includes('\u2A72')) return Annotation.WHITE_IS_SLIGHTLY_BETTER;
        if (san.includes('\u2A71')) return Annotation.BLACK_IS_SLIGHTLY_BETTER;
        if (san.includes('\u221E')) return Annotation.UNCLEAR_POSITION;
        if (san.includes('\u25FB')) return Annotation.ONLY_MOVE;
        if (san.includes('\u2299')) return Annotation.ZUGZWANG;
        if (san.includes('\u2206')) return Annotation.WITH_THE_IDEA;
        if (san.includes('\u2191\u2191')) return Annotation.DEVELOPMENT;
        if (san.includes('\u2191')) return Annotation.INITIATIVE;
        if (san.includes('\u2192')) return Annotation.ATTACK;
        if (san.includes('\u21C6')) return Annotation.COUNTERPLAY;
        return undefined;
    }

    private generatePGNString(): string {
        const root = this.moveTree.root;
        if (!root) return "";
        
        let pgnHeader = `[FEN "${root.fen}"]\n[Variant "From Position"]\n\n`;
        
        const getCBColor = (color: string | undefined): string => {
            const c = color?.toLowerCase() || '';
            if (c.includes('green')) return 'G';
            if (c.includes('red')) return 'R';
            if (c.includes('blue')) return 'B';
            return 'Y';
        };
        
        const buildRecursive = (node: MoveNode): string => {
            let str = "";
            if (node.san === 'START') {
                return node.children.length > 0 ? buildRecursive(node.children[0]) : "";
            }
            
            const parent = node.parent!;
            const isWhite = node.color === Color.WHITE;
            const moveNum = parent.fen.split(' ')[5];
            
            if (isWhite) {
                str += `${moveNum}. `;
            } else if (parent.children[0] !== node || parent.san === 'START') {
                str += `${moveNum}... `;
            }
            
            str += node.san;
            
            if (node.annotation) {
                const nag = this.getNAGCode(node.annotation);
                if (nag) str += ` $${nag}`;
            }
            
            str += ` `;
            
            const hasComment = !!node.comment?.trim();
            const drawings = node.drawings || [];
            
            if (hasComment || drawings.length > 0) {
                str += `{ `;
                if (drawings.length > 0) {
                    const circles = drawings.filter(d => !d.dest || d.orig === d.dest)
                                            .map(d => `${getCBColor(d.brush || d.color)}${d.orig || (d as any).key}`)
                                            .filter(s => s.length > 1)
                                            .join(',');
                                            
                    const arrows = drawings.filter(d => d.orig && d.dest && d.orig !== d.dest)
                                           .map(d => `${getCBColor(d.brush || d.color)}${d.orig}${d.dest}`)
                                           .join(',');
                                           
                    if (circles) str += `[%csl ${circles}] `;
                    if (arrows) str += `[%cal ${arrows}] `;
                }
                
                if (hasComment) {
                    str += `${node.comment!.trim()} `;
                }
                str += `} `;
            }
            
            if (parent.children.length > 1 && parent.children[0] === node) {
                for (let i = 1; i < parent.children.length; i++) {
                    str += `(${buildRecursive(parent.children[i])}) `;
                }
            }
            
            if (node.children.length > 0) {
                str += buildRecursive(node.children[0]);
            }
            
            return str;
        };
        
        const body = buildRecursive(root);
        return (pgnHeader + body).replace(/\s+/g, ' ').trim() + " *";
    }

    copyPGN(): void {
        if (this.longPressActive) {
            this.longPressActive = false;
            return;
        }
        
        const finalPgn = this.generatePGNString();
        if (!finalPgn) return;
        
        navigator.clipboard.writeText(finalPgn).then(() => {
            this.isPgnCopied = true;
            this.cdr.detectChanges();
            setTimeout(() => {
                this.isPgnCopied = false;
                this.cdr.detectChanges();
            }, 2000);
        });
    }

    savePGN(): void {
        if (this.longPressActive) {
            this.longPressActive = false;
            return;
        }
        
        const finalPgn = this.generatePGNString();
        if (!finalPgn) return;
        
        const blob = new Blob([finalPgn], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        
        link.download = `chess-game-${timestamp}.pgn`;
        link.href = url;
        link.click();
        
        window.URL.revokeObjectURL(url);
    }

    get isBlackAdvantage(): boolean {
        const score = this.currentEval?.toString() || '0';
        return score.startsWith('-');
    }

    public playEngineMove(uci: string): void {
        if (!uci) return;
        
        const from = uci.slice(0, 2) as Key;
        const to = uci.slice(2, 4) as Key;
        const promotion = uci.length === 5 ? uci[4] : 'q';
        
        this.engineService.stop();
        this.executeMove(from, to, promotion);
    }

    getPromotionPieces() {
        return [...this.promoOrder];
    }

    getPieceClassName(type: string): string {
        const names: any = { 'q': 'queen', 'n': 'knight', 'r': 'rook', 'b': 'bishop' };
        return names[type];
    }

    getPromotionStyle() {
        if (!this.promotionData) return {};
        
        const boardEl = document.querySelector('cg-board') as HTMLElement;
        if (!boardEl) return {};
        
        const squareSize = boardEl.clientWidth / 8;
        const file = this.promotionData.to.charCodeAt(0) - 97;
        const rank = parseInt(this.promotionData.to[1], 10) - 1;
        
        const isFlipped = this.cgApi?.state.orientation === 'black';
        const fileIndex = isFlipped ? (7 - file) : file;
        const rankIndex = isFlipped ? rank : (7 - rank);
        
        const left = fileIndex * squareSize;
        const baseTop = rankIndex * squareSize;
        const top = (rankIndex === 0) ? baseTop : baseTop - (3 * squareSize);
        
        return {
            position: 'absolute',
            left: `${left}px`,
            top: `${top}px`,
            width: `${squareSize}px`,
            height: `${squareSize * 4}px`,
            zIndex: '1000',
            display: 'flex',
            flexDirection: (rankIndex === 0) ? 'column' : 'column-reverse'
        };
    }

    openImportPanel(): void {
        if (this.longPressActive) {
            this.longPressActive = false;
            return;
        }
        
        this.fenValue = this.game.fen();
        this.pgnValue = '';
        this.showImportModal = true;
        this.cdr.detectChanges();
    }

    confirmFenImport() {
        try {
            this.game.load(this.fenValue);
            this.updateTreeFromFen(this.fenValue);
            this.syncBoard();
            if (this.isEngineEnabled) this.toggleEngine();
            this.showImportModal = false;
        } catch (e) { 
            alert("Invalid FEN!"); 
        }
    }

    private getBrushFromCode(code: string): string {
        switch (code) {
            case 'G': return 'green';
            case 'R': return 'red';
            case 'B': return 'blue';
            case 'Y': return 'yellow';
            default: return 'green';
        }
    }

    private cleanComment(comment: string): string {
        if (!comment) return '';
        return comment.replace(/\[%[^\]]+\]/g, '').trim();
    }

    confirmPgnImport(): void {
        if (!this.pgnValue?.trim()) return;
        
        try {
            if (this.isEngineEnabled) this.toggleEngine();
            
            const tagRegex = /\[(\w+)\s+"([^"]+)"\]/g;
            let match;
            const tags: { [key: string]: string } = {};
            const otherTags: string[] = [];
            
            while ((match = tagRegex.exec(this.pgnValue)) !== null) {
                const key = match[1];
                const value = match[2];
                tags[key] = value;
                
                if (!['FEN', 'Variant', 'SetUp'].includes(key) && value !== '*' && value !== '?') {
                    otherTags.push(`${key}: ${value}`);
                }
            }
            
            const startFen = tags['FEN'] || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            const activeColor = startFen.split(' ')[1] === 'b' ? Color.BLACK : Color.WHITE;
            const movesBody = this.pgnValue.replace(/^\[\w+\s+"[^"]*"\]\s*$/gm, '').trim();
            
            this.moveTree.root = {
                isRoot: true,
                fen: startFen,
                san: 'START',
                color: activeColor,
                comment: otherTags.length > 0 ? otherTags.join(' | ') : undefined,
                children: [] as MoveNode[],
                drawings: [] as any[],
                parent: null
            } as MoveNode;
            
            this.parsePgnString(movesBody, this.moveTree.root, startFen);
            this.showImportModal = false;
            this.selectMove(this.moveTree.root);
            this.syncBoard();
            this.cdr.detectChanges();
            
        } catch (e) { 
            alert("Eroare la procesarea headerelor PGN!"); 
        }
    }

    private parsePgnString(text: string, parentNode: MoveNode, currentFen: string): void {
        const cleanText = text.replace(/\s+/g, ' ');
        this.processSegment(cleanText, 0, parentNode, currentFen);
    }

    private parseDrawings(comment: string): any[] {
        const drawings: any[] = [];
        if (!comment) return drawings;
        
        const regex = /\[%(cal|csl)\s*([^\]]+)\]/gi;
        let match;
        
        while ((match = regex.exec(comment)) !== null) {
            const type = match[1].toLowerCase();
            const data = match[2];
            
            data.split(',').forEach(item => {
                const s = item.trim();
                if (type === 'cal' && s.length >= 5) {
                    drawings.push({ 
                        orig: s.substring(1, 3), 
                        dest: s.substring(3, 5), 
                        brush: this.getBrushFromCode(s[0].toUpperCase()) 
                    });
                } else if (type === 'csl' && s.length >= 3) {
                    drawings.push({ 
                        orig: s.substring(1, 3), 
                        dest: s.substring(1, 3), 
                        brush: this.getBrushFromCode(s[0].toUpperCase()) 
                    });
                }
            });
        }
        return drawings;
    }

    private processSegment(text: string, startIndex: number, parentNode: MoveNode, fen: string): number {
        let i = startIndex;
        let lastNode: MoveNode = parentNode;
        const tempGame = new Chess(fen);
        
        while (i < text.length) {
            if (text[i] === ' ') { 
                i++; 
                continue; 
            }
            if (text[i] === ')') {
                return i + 1;
            }
            if (text[i] === '(') {
                const startNode = lastNode.isRoot ? lastNode : (lastNode.parent || lastNode);
                i = this.processSegment(text, i + 1, startNode, startNode.fen);
                continue;
            }
            
            if (text[i] === '{') {
                const end = text.indexOf('}', i);
                if (end !== -1) {
                    const content = text.substring(i + 1, end).trim();
                    if (lastNode) {
                        const newComment = this.cleanComment(content);
                        if (newComment) {
                            lastNode.comment = lastNode.comment ? `${lastNode.comment} ${newComment}` : newComment;
                        }
                        const newDrawings = this.parseDrawings(content);
                        lastNode.drawings = [...(lastNode.drawings || []), ...newDrawings];
                    }
                    i = end + 1; 
                    continue;
                }
            }
            
            if (text[i] === '$') {
                const match = text.substring(i).match(/^\$(\d+)/);
                if (match) {
                    if (!lastNode.isRoot) {
                        lastNode.annotation = this.getAnnotationFromNAG(match[1]);
                    }
                    i += match[0].length; 
                    continue;
                }
            }
            
            const moveMatch = text.substring(i).match(/^(\d+\.{1,3}\s*)?([a-zA-Z0-9+#=!?-]+)/);
            if (moveMatch) {
                const san = moveMatch[2];
                if (!['1-0', '0-1', '1/2-1/2', '*', '1/2'].includes(san)) {
                    try {
                        const moveResult = tempGame.move(san);
                        if (moveResult) {
                            const newNode: MoveNode = {
                                isRoot: false,
                                san: moveResult.san,
                                fen: tempGame.fen(),
                                color: moveResult.color === 'w' ? Color.WHITE : Color.BLACK,
                                piece: moveResult.piece.toUpperCase() as PieceType,
                                from: moveResult.from as any,
                                to: moveResult.to as any,
                                parent: lastNode,
                                children: [] as MoveNode[],
                                drawings: [] as any[],
                                annotation: this.extractAnnotationFromSAN(san)
                            } as MoveNode;
                            
                            lastNode.children.push(newNode);
                            lastNode = newNode;
                        }
                    } catch (e) { }
                }
                i += moveMatch[0].length; 
                continue;
            }
            i++;
        }
        return i;
    }

    toggleSetupMode() {
        if (this.longPressActive) {
            this.longPressActive = false;
            return;
        }
        
        this.isSetupMode = !this.isSetupMode;
        
        if (this.isSetupMode && this.isEngineEnabled) {
            this.toggleEngine();
        }
        
        if (this.isSetupMode) {
            this.isSetupFlipped = this.cgApi?.state.orientation === 'black';
            const setupConfig: any = {
                movable: { 
                    free: true, 
                    color: 'both', 
                    dropOff: 'trash' 
                },
                draggable: { 
                    deleteOnDrop: true 
                },
                selectable: { 
                    enabled: false 
                },
                highlight: { 
                    lastMove: false, 
                    check: false 
                }
            };
            this.cgApi?.set(setupConfig);
        } else {
            const position = this.cgApi?.getFen();
            const fullFen = `${position} ${this.setupTurn} ${this.getCastlingString()} ${this.enPassantSquare} 0 1`;
            
            try {
                this.game.load(fullFen);
                this.cgApi?.set({ orientation: this.isSetupFlipped ? 'black' : 'white' });
                this.updateTreeFromFen(fullFen);
                this.syncBoard();
            } catch (e) { 
                this.isSetupMode = true; 
            }
        }
        
        if (!this.isSetupMode) {
            this.setupCgApi = undefined;
        }
    }

    selectPiece(piece: string | null): void { 
        this.selectedSetupPiece = piece; 
    }

    handleSetupFlip() {
        this.isSetupFlipped = !this.isSetupFlipped;
        this.setupCgApi?.set({ orientation: this.isSetupFlipped ? 'black' : 'white' });
    }

    clearBoard() { 
        this.setupCgApi?.set({ pieces: new Map() } as any); 
    }

    resetToStart() {
        this.game.reset();
        const startFen = this.game.fen();
        this.setupCgApi?.set({ fen: startFen });
        this.setupTurn = 'w';
        this.castling = { wK: true, wQ: true, bK: true, bQ: true };
        this.enPassantSquare = '-';
    }

    getCastlingString(): string {
        let res = '';
        if (this.castling.wK) res += 'K';
        if (this.castling.wQ) res += 'Q';
        if (this.castling.bK) res += 'k';
        if (this.castling.bQ) res += 'q';
        return res || '-';
    }

    getCssClasses(pieceCode: string): string {
        const color = pieceCode[0] === 'w' ? 'white' : 'black';
        const roleMap: any = { 'K': 'king', 'Q': 'queen', 'R': 'rook', 'B': 'bishop', 'N': 'knight', 'P': 'pawn' };
        const role = roleMap[pieceCode[1].toUpperCase()];
        return `piece ${color} ${role}`;
    }

    private formatRoleForCg(role: PieceType): any {
        const map: any = { 
            [PieceType.PAWN]: 'pawn', 
            [PieceType.KNIGHT]: 'knight', 
            [PieceType.BISHOP]: 'bishop', 
            [PieceType.ROOK]: 'rook', 
            [PieceType.QUEEN]: 'queen', 
            [PieceType.KING]: 'king' 
        };
        return map[role as any] || 'pawn';
    }

    private getRoleFromLetter(letter: string): PieceType {
        const l = letter.toUpperCase();
        switch (l) {
            case 'N': return PieceType.KNIGHT;
            case 'B': return PieceType.BISHOP;
            case 'R': return PieceType.ROOK;
            case 'Q': return PieceType.QUEEN;
            case 'K': return PieceType.KING;
            default: return PieceType.PAWN;
        }
    }

    initSetupBoard(element: HTMLElement) {
        const config: any = {
            fen: this.cgApi?.getFen() || 'start',
            orientation: this.isSetupFlipped ? 'black' : 'white',
            movable: { free: true, color: 'both', dropOff: 'trash' },
            animation: { enabled: true, duration: 200 },
            events: {
                change: () => { 
                    const newFen = this.setupCgApi?.getFen(); 
                    this.cgApi?.set({ fen: newFen }); 
                },
                select: (key: string) => this.handleSetupBoardClick(key)
            }
        };
        this.setupCgApi = Chessground(element, config);
    }

    handleSetupBoardClick(square: string) {
        if (!this.setupCgApi) return;
        
        const pieces = new Map(this.setupCgApi.state.pieces);
        const existingPiece = pieces.get(square as any);
        
        if (this.selectedSetupPiece === null) {
            pieces.delete(square as any);
        } else {
            const newColor = this.selectedSetupPiece[0] === 'w' ? 'white' : 'black';
            const newRole = this.getRoleFromLetter(this.selectedSetupPiece[1]);
            
            if (existingPiece && existingPiece.role === this.formatRoleForCg(newRole) && existingPiece.color === newColor) {
                pieces.delete(square as any);
            } else {
                pieces.set(square as any, { role: this.formatRoleForCg(newRole), color: newColor as any } as any);
            }
        }
        
        this.setupCgApi.set({ pieces } as any);
        this.updateEnPassantOptions();
    }

    updateEnPassantOptions() {
        const pieces = this.setupCgApi?.state.pieces;
        const options: string[] = ['-'];
        if (!pieces) return;
        
        const getPiece = (file: string, rank: number) => pieces.get((file + rank) as any);
        
        pieces.forEach((piece, square) => {
            if (piece.role !== 'pawn') return;
            
            const file = square[0]; 
            const rank = parseInt(square[1]);
            
            if (this.setupTurn === 'b' && piece.color === 'white' && rank === 4) {
                const leftFile = String.fromCharCode(file.charCodeAt(0) - 1); 
                const rightFile = String.fromCharCode(file.charCodeAt(0) + 1);
                const leftPawn = getPiece(leftFile, 4); 
                const rightPawn = getPiece(rightFile, 4);
                
                if ((leftPawn && leftPawn.role === 'pawn' && leftPawn.color === 'black') || 
                    (rightPawn && rightPawn.role === 'pawn' && rightPawn.color === 'black')) {
                    options.push(`${file}3`);
                }
            }
            
            if (this.setupTurn === 'w' && piece.color === 'black' && rank === 5) {
                const leftFile = String.fromCharCode(file.charCodeAt(0) - 1); 
                const rightFile = String.fromCharCode(file.charCodeAt(0) + 1);
                const leftPawn = getPiece(leftFile, 5); 
                const rightPawn = getPiece(rightFile, 5);
                
                if ((leftPawn && leftPawn.role === 'pawn' && leftPawn.color === 'white') || 
                    (rightPawn && rightPawn.role === 'pawn' && rightPawn.color === 'white')) {
                    options.push(`${file}6`);
                }
            }
        });
        
        this.enPassantOptions = [...new Set(options)].sort();
        if (!this.enPassantOptions.includes(this.enPassantSquare)) {
            this.enPassantSquare = '-';
        }
    }

    changeTurn(color: 'w' | 'b') { 
        this.setupTurn = color; 
        this.updateEnPassantOptions(); 
    }

    private updateTreeFromFen(fen: string) {
        this.moveTree.root = { 
            isRoot: true, 
            from: '' as any, 
            to: '' as any, 
            piece: '' as any, 
            color: fen.split(' ')[1] === 'w' ? Color.WHITE : Color.BLACK, 
            fen: fen, 
            san: 'START', 
            children: [], 
            parent: null, 
            drawings: [] 
        };
        this.moveTree.currentNode = this.moveTree.root;
    }

    exitSetup() {
        if (!this.setupCgApi) return;
        
        const position = this.setupCgApi.getFen(); 
        const pieces = this.setupCgApi.state.pieces;
        const pieceList = Array.from(pieces.values());
        
        const whiteKings = pieceList.filter(p => p.role === 'king' && p.color === 'white').length;
        const blackKings = pieceList.filter(p => p.role === 'king' && p.color === 'black').length;
        
        let invalidPawn = false;
        pieces.forEach((piece, square) => { 
            if (piece.role === 'pawn' && (square[1] === '1' || square[1] === '8')) {
                invalidPawn = true; 
            }
        });
        
        if (whiteKings !== 1 || blackKings !== 1 || invalidPawn) { 
            this.triggerSetupError(); 
            return; 
        }
        
        const hasPiece = (square: string, role: string, color: string) => { 
            const p = pieces.get(square as any); 
            return p && p.role === role && p.color === color; 
        };
        
        let castlingStr = '';
        if (this.castling.wK && hasPiece('e1', 'king', 'white') && hasPiece('h1', 'rook', 'white')) castlingStr += 'K';
        if (this.castling.wQ && hasPiece('e1', 'king', 'white') && hasPiece('a1', 'rook', 'white')) castlingStr += 'Q';
        if (this.castling.bK && hasPiece('e8', 'king', 'black') && hasPiece('h8', 'rook', 'black')) castlingStr += 'k';
        if (this.castling.bQ && hasPiece('e8', 'king', 'black') && hasPiece('a8', 'rook', 'black')) castlingStr += 'q';
        if (!castlingStr) castlingStr = '-';
        
        const fullFen = `${position} ${this.setupTurn} ${castlingStr} ${this.enPassantSquare} 0 1`;
        
        try {
            this.game.load(fullFen); 
            const tempGame = new Chess(fullFen); 
            (tempGame as any)._turn = this.setupTurn === 'w' ? 'b' : 'w';
            
            if (tempGame.inCheck()) { 
                this.triggerSetupError(); 
                return; 
            }
            this.completeSetup(fullFen);
        } catch (e) { 
            this.triggerSetupError(); 
        }
    }

    private triggerSetupError() { 
        this.setupError = true; 
        this.cdr.detectChanges(); 
        
        setTimeout(() => { 
            this.setupError = false; 
            this.cdr.detectChanges(); 
        }, 2000); 
    }

    private completeSetup(fullFen: string) {
        this.updateTreeFromFen(fullFen); 
        this.game.load(fullFen); 
        this.isSetupMode = false; 
        this.setupCgApi = undefined; 
        this.initBoard(fullFen);
        
        if (this.isEngineEnabled) { 
            this.engineService.stop(); 
            setTimeout(() => { 
                this.engineService.analyze(fullFen); 
                this.cdr.detectChanges(); 
            }, 200); 
        }
        this.cdr.detectChanges();
    }

    private pressTimer: any;
    private readonly longPressDuration = 500; 

    handlePressEnd() { 
        if (this.pressTimer) { 
            clearTimeout(this.pressTimer); 
            this.pressTimer = null; 
        } 
    }

    handlePressStart(event: MouseEvent | TouchEvent, node: MoveNode) {
        this.longPressActive = false; 
        
        if (this.pressTimer) {
            clearTimeout(this.pressTimer);
        }
        
        if (node === this.moveTree.root && (!node.drawings || node.drawings.length === 0)) {
            return;
        }
        
        const targetElement = event.currentTarget as HTMLElement;
        this.pressTimer = setTimeout(() => {
            this.longPressActive = true; 
            this.openContextMenu(event, node, targetElement);
            if ('vibrate' in navigator) {
                navigator.vibrate(50);
            }
        }, this.longPressDuration);
    }

    openContextMenu(event: MouseEvent | TouchEvent, node: MoveNode, targetEl?: HTMLElement) {
        if (event instanceof MouseEvent) {
            event.preventDefault();
        }
        event.stopPropagation();
        
        const target = targetEl || (event.currentTarget as HTMLElement); 
        if (!target) return;
        
        const rect = target.getBoundingClientRect();
        const menuHeight = 320; 
        const menuWidth = 200;
        
        let xPos = rect.right + 8; 
        let yPos = rect.top; 
        let lowSpace = false;
        
        if (yPos + menuHeight > window.innerHeight) { 
            lowSpace = true; 
            yPos = window.innerHeight - menuHeight - 10; 
        }
        
        if (xPos + menuWidth > window.innerWidth) {
            xPos = rect.left - menuWidth - 8;
        }
        
        if (xPos < 0) { 
            xPos = 10; 
            yPos = rect.bottom + 8; 
            if (yPos + menuHeight > window.innerHeight) {
                yPos = window.innerHeight - menuHeight - 10;
            }
        }
        
        this.contextMenu = { visible: true, x: xPos, y: yPos, node: node, showAnnotations: false, isLowSpace: lowSpace };
        this.cdr.detectChanges();
    }

    private tooltipTimer: any;
    private activeTooltipElement: HTMLElement | null = null;

    handleTooltipPress(event: any, buttonId: string): void {
        clearTimeout(this.tooltipHideTimer);
        clearTimeout(this.tooltipShowTimer);

        this.tooltipShowTimer = setTimeout(() => {
            this.activeTooltipButtonId = buttonId;
            this.cdr.detectChanges(); 
        }, 500);
    }

    handleTooltipEnd(event: any = null): void {
        clearTimeout(this.tooltipShowTimer);

        if (this.activeTooltipButtonId) {
            clearTimeout(this.tooltipHideTimer);
            this.tooltipHideTimer = setTimeout(() => {
                this.activeTooltipButtonId = null;
                this.cdr.detectChanges();
            }, 1000); 
        }
    }

    private setupMobileDrawing() {
        const boardEl = document.getElementById('chessground-board'); 
        if (!boardEl) return;
        
        boardEl.addEventListener('touchstart', (e: TouchEvent) => {
            this.handleTooltipEnd(); 
            const square = this.getSquareFromTouch(e);
            this.touchStartSquare = square; 
            this.lastTouchSquare = square; 
            this.isDrawingGesture = false;
        }, { passive: false });

        boardEl.addEventListener('touchmove', (e: TouchEvent) => {
            if (!this.touchStartSquare) return;
            
            const rect = boardEl.getBoundingClientRect(); 
            const touch = e.touches[0];
            const isOutside = touch.clientX < rect.left || touch.clientX > rect.right || touch.clientY < rect.top || touch.clientY > rect.bottom;
            
            if (isOutside) { 
                this.isDrawingGesture = true; 
                this.drawingsVisible = true; 
                if (e.cancelable) e.preventDefault(); 
                this.cgApi?.set({ movable: { color: undefined } }); 
                return; 
            }
            
            if (this.isDrawingGesture) {
                if (e.cancelable) e.preventDefault();
                const currentSquare = this.getSquareFromTouch(e);
                
                if (currentSquare) {
                    this.lastTouchSquare = currentSquare;
                    const tempShape = { orig: this.touchStartSquare as any, dest: currentSquare as any, brush: 'green' };
                    const existingShapes = this.moveTree.currentNode?.drawings || [];
                    this.cgApi?.set({ drawable: { shapes: [...existingShapes, tempShape] } });
                }
            }
        }, { passive: false });

        boardEl.addEventListener('touchend', (e: TouchEvent) => {
            if (!this.isDrawingGesture) { 
                this.touchStartSquare = null; 
                this.lastTouchSquare = null; 
                return; 
            }
            
            const finalSquare = this.getSquareFromTouch(e);
            if (this.touchStartSquare && finalSquare) {
                const finalShape = { orig: this.touchStartSquare as any, dest: finalSquare as any, brush: 'green' };
                if (this.moveTree.currentNode) {
                    const currentShapes = this.moveTree.currentNode.drawings || [];
                    this.moveTree.currentNode.drawings = [...currentShapes, finalShape];
                }
            }
            
            this.isDrawingGesture = false; 
            this.touchStartSquare = null; 
            this.lastTouchSquare = null; 
            this.syncBoard();
        }, { passive: false });
    }

    private getSquareFromTouch(e: TouchEvent): string | null {
        const boardEl = document.getElementById('chessground-board'); 
        if (!boardEl) return null;
        
        const rect = boardEl.getBoundingClientRect(); 
        const touch = e.touches[0] || e.changedTouches[0];
        
        const x = touch.clientX - rect.left; 
        const y = touch.clientY - rect.top;
        
        const col = Math.floor((x / rect.width) * 8); 
        const row = Math.floor((y / rect.height) * 8);
        
        const isFlipped = this.cgApi?.state.orientation === 'black';
        const finalCol = isFlipped ? 7 - col : col; 
        const finalRow = isFlipped ? row : 7 - row;
        
        if (finalCol < 0 || finalCol > 7 || finalRow < 0 || finalRow > 7) {
            return null;
        }
        
        return String.fromCharCode(97 + finalCol) + (finalRow + 1);
    }
}