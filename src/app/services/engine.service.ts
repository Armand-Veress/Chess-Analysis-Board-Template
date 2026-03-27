import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Chess } from 'chess.js';

@Injectable({ providedIn: 'root' })
export class EngineService {
    private worker: Worker | null = null;
    private gameForSan = new Chess();
    private currentLines: any[] = [];

    public evaluation$ = new Subject<string>();
    public bestMove$ = new Subject<{orig: string, dest: string}>();
    public multiPV$ = new Subject<any[]>();

    constructor() {
        this.initEngine();
    }

    private initEngine(): void {
        this.worker = new Worker('engine/stockfish-18-lite-single.js');

        this.worker.onmessage = (e) => {
            const msg: string = e.data;

            if (msg.startsWith('info')) {
                this.parseEval(msg);
            } else if (msg.startsWith('bestmove')) {
                this.parseBestMove(msg);
            }
        };

        this.sendCommand('uci');
        this.sendCommand('setoption name Hash value 16');
        this.sendCommand('setoption name MultiPV value 2');
        this.sendCommand('isready');
    }

    public sendCommand(cmd: string): void {
        this.worker?.postMessage(cmd);
    }

    public stop(): void {
        this.sendCommand('stop');
    }

    public analyze(fen: string, depth: number = 13): void {
        if (!this.worker) return;

        this.sendCommand('stop');
        this.currentLines = [null, null];

        try {
            this.gameForSan.load(fen);
        } catch (e) {
            console.error('[FEN INVALID]', fen, e);
            return;
        }

        this.sendCommand(`position fen ${fen}`);
        this.sendCommand(`go depth ${depth}`);
    }

    private parseEval(msg: string): void {
        const parts = msg.split(' ');

        const multipvIdx = parts.indexOf('multipv');
        const pvIdx = parts.indexOf('pv');
        const cpIdx = parts.indexOf('cp');
        const mateIdx = parts.indexOf('mate');

        if (multipvIdx === -1 || pvIdx === -1) {
            return;
        }

        const idRaw = parts[multipvIdx + 1];
        if (!idRaw) return;

        const id = parseInt(idRaw) - 1;
        if (isNaN(id)) return;

        const turn = this.gameForSan.turn();
        let scoreStr = '0.0';

        if (cpIdx !== -1 && parts[cpIdx + 1]) {
            let score = parseInt(parts[cpIdx + 1]) / 100;
            if (turn === 'b') score = -score;
            scoreStr = (score > 0 ? '+' : '') + score.toFixed(1);
        } else if (mateIdx !== -1 && parts[mateIdx + 1]) {
            let mateIn = parseInt(parts[mateIdx + 1]);
            if (turn === 'b') mateIn = -mateIn;
            const sign = mateIn > 0 ? '+' : '-';
            scoreStr = `${sign}M${Math.abs(mateIn)}`;
        }

        const rawMoves = parts.slice(pvIdx + 1, pvIdx + 5);
        if (rawMoves.length === 0) return;

        const sanMoves = this.convertMovesToSan(rawMoves);

        this.currentLines[id] = { 
            score: scoreStr, 
            moves: sanMoves.join(' '),
            uci: rawMoves[0]
        };

        this.multiPV$.next([...this.currentLines]);

        if (id === 0) {
            this.evaluation$.next(scoreStr);
        }
    }

    private convertMovesToSan(rawMoves: string[]): string[] {
        const sanResult: string[] = [];
        const tempGame = new Chess(this.gameForSan.fen());

        for (const move of rawMoves) {
            try {
                const turn = tempGame.turn();
                const moveNum = tempGame.moveNumber();

                let prefix = '';
                if (turn === 'w') {
                    prefix = `${moveNum}.`;
                } else if (sanResult.length === 0 && turn === 'b') {
                    prefix = `${moveNum}... `;
                }

                const result = tempGame.move({
                    from: move.slice(0, 2),
                    to: move.slice(2, 4),
                    promotion: move.length === 5 ? move[4] : 'q'
                });

                if (result) {
                    sanResult.push(`${prefix}${result.san}`);
                } else {
                    sanResult.push(`${prefix}${move}`);
                }
            } catch (e) {
                console.warn(`[SAN fallback]`, move);
                sanResult.push(move);
            }
        }

        return sanResult;
    }

    private parseBestMove(msg: string): void {
        const move = msg.split(' ')[1];

        if (move && move !== '(none)') {
            this.bestMove$.next({
                orig: move.slice(0, 2),
                dest: move.slice(2, 4)
            });
        }
    }
}