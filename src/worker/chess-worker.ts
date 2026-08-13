/// <reference lib="webworker" />

import { decodeBoard, formatMove } from '../engine/codec.ts';
import type { Move } from '../domain/types';
import type { WorkerRequest, WorkerResponse } from '../engine/protocol.ts';
import {
  evaluateBoard,
  evaluateBoardForUi,
  evaluatePieceInfo,
  getGamePhase,
  hydrateRelationsFromMasks,
  setValueWeights
} from '../engine/js/evaluation.js';
import { getValidMoves } from '../engine/js/movegen.js';
import {
  checkGameState,
  isCheck,
  isValidPlacement,
  syncGeneralPosCache
} from '../engine/js/rules.js';
import { configureSearch, searchContext } from '../engine/js/search-context.js';
import { getBestMove, logPerfStats, openingBook, snapshotPerfStats } from '../engine/js/search.js';

type Emit = (message: WorkerResponse) => void;

const gameStage = (): 'early' | 'mid' | 'late' => {
  const phase = getGamePhase();
  return phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';
};

const emptyPieceEvaluation = () => ({
  material: 0,
  position: 0,
  mobility: 0,
  threat: 0,
  safety: 0
});

const emptyRelations = () => ({
  threat: [] as Array<{ r: number; c: number }>,
  threatenedBy: [] as Array<{ r: number; c: number }>,
  guard: [] as Array<{ r: number; c: number }>,
  guardedBy: [] as Array<{ r: number; c: number }>,
  control: [] as Array<{ r: number; c: number }>,
  controllers: [] as Array<{ r: number; c: number }>
});

const buildSquareInspection = (
  board: ReturnType<typeof decodeBoard>,
  pos: { r: number; c: number },
  turn: Parameters<typeof evaluateBoardForUi>[1],
  needMoves: boolean
) => {
  const moves = needMoves ? getValidMoves(board, pos) : [];
  const piece = board[pos.r][pos.c];
  // 点棋专用函数，不走通用 evaluateBoard
  const boardEvaluation = evaluateBoardForUi(board, turn, gameStage());
  const piecesInfo = boardEvaluation.piecesInfo;
  const boardInfo = boardEvaluation.boardInfo as any;
  if (boardInfo.useRelationMasks) hydrateRelationsFromMasks(piecesInfo, boardInfo);

  const rawControllers = boardInfo.controllerGrid
    ? (boardInfo.controllerGrid[pos.r][pos.c] || [])
    : (boardInfo[pos.r]?.[pos.c] || []);
  const controllers = rawControllers.map((controller: { r: number; c: number }) => ({
    r: controller.r,
    c: controller.c
  }));

  let relations: Record<string, unknown> = { ...emptyRelations(), controllers };
  let evaluation = emptyPieceEvaluation();

  if (piece) {
    const info = piecesInfo.find((candidate: { r: number; c: number }) =>
      candidate.r === pos.r && candidate.c === pos.c
    );
    if (info) {
      const positions = (items: Array<{ r: number; c: number }> = []) =>
        items.map(({ r, c }) => ({ r, c }));
      relations = {
        threat: positions(info.threat),
        threatenedBy: positions(info.threatenedBy),
        guard: positions(info.guard),
        guardedBy: positions(info.guardedBy),
        control: positions(info.control),
        controllers
      };
      evaluation = evaluatePieceInfo(info);
    }
  }

  return { moves, evaluation, relations };
};

export const handleWorkerRequest = (request: WorkerRequest, emit: Emit): void => {
  try {
    const { type, payload } = request;

    switch (type) {
      case 'SEARCH': {
        const board = decodeBoard(payload.board);
        configureSearch(payload);
        openingBook.setEnabled(payload.openingBookEnabled ?? true);

        emit({
          type: 'SEARCH_STARTED',
          payload: {
            gameId: payload.gameId,
            turn: payload.turn,
            depth: payload.depth,
            ply: payload.ply ?? 0,
            enableTimeLimit: !!payload.enableTimeLimit
          }
        });

        searchContext.reportSearchProgress = (info) => {
          emit({
            type: 'SEARCH_PROGRESS',
            payload: {
              gameId: payload.gameId,
              phase: (info.phase as 'root-eval' | 'start' | 'depth' | 'book') || 'depth',
              turn: info.turn as typeof payload.turn | undefined,
              maxDepth: info.maxDepth as number | undefined,
              completedDepth: info.completedDepth as number | undefined,
              rootMoves: info.rootMoves as number | undefined,
              bestMove: info.bestMove as Move | null | undefined,
              score: info.score as number | undefined,
              elapsedMs: info.elapsedMs as number | undefined
            }
          });
        };

        const started = performance.now();
        let result;
        try {
          result = getBestMove(
            board,
            payload.turn,
            payload.depth,
            payload.ply ?? 0,
            payload.enableTimeLimit ?? false,
            payload.exactRootScores ?? false
          );
        } finally {
          searchContext.reportSearchProgress = null;
        }
        const thinkingTime = Math.round(performance.now() - started);
        const bookMove = openingBook.getBookMove(board, payload.ply ?? 0);
        const fromBook = !!bookMove && JSON.stringify(bookMove) === JSON.stringify(result.bestMove);

        logPerfStats(payload.turn);
        console.log(
          `Search complete: game=${payload.gameId}, time=${thinkingTime}ms, ` +
          `best=${formatMove(result.bestMove)} score=${result.bestMoveScore}, ` +
          `second=${formatMove(result.secondBestMove)}, book=${fromBook}`
        );

        emit({
          type: 'SEARCH_COMPLETE',
          payload: {
            bestMove: result.bestMove,
            secondBestMove: result.secondBestMove,
            gameId: payload.gameId,
            fromBook,
            thinkingTime,
            moveSequence: result.moveSequence,
            secondMoveSequence: result.secondMoveSequence,
            bestMoveScore: result.bestMoveScore,
            secondBestMoveScore: result.secondBestMoveScore,
            allMovesWithScores: result.allMovesWithScores || [],
            completedDepth: result.completedDepth,
            perf: snapshotPerfStats()
          }
        });
        return;
      }

      case 'getValidMoves': {
        const board = decodeBoard(payload.board);
        syncGeneralPosCache(board);
        emit({
          type: 'validMoves',
          moves: getValidMoves(board, payload.pos),
          requestId: payload.requestId
        });
        return;
      }

      case 'inspectSquare': {
        const board = decodeBoard(payload.board);
        syncGeneralPosCache(board);
        const inspected = buildSquareInspection(
          board,
          payload.pos,
          payload.turn,
          !!payload.needMoves
        );
        emit({
          type: 'squareInspected',
          requestId: payload.requestId,
          moves: inspected.moves,
          evaluation: inspected.evaluation,
          relations: inspected.relations
        });
        return;
      }

      case 'getPieceRelations': {
        const board = decodeBoard(payload.board);
        const inspected = buildSquareInspection(board, payload.pos, null, false);
        emit({ type: 'pieceRelations', relations: inspected.relations, requestId: payload.requestId });
        return;
      }

      case 'checkGameState': {
        const board = decodeBoard(payload.board);
        emit({
          type: 'gameState',
          state: checkGameState(board, payload.turn),
          requestId: payload.requestId
        });
        return;
      }

      case 'evaluateBoard': {
        const board = decodeBoard(payload.board);
        emit({
          type: 'detailedEvaluation',
          evaluation: evaluateBoard(board, payload.turn, gameStage()),
          requestId: payload.requestId
        });
        return;
      }

      case 'evaluatePiece': {
        const board = decodeBoard(payload.board);
        const piece = board[payload.pos.r][payload.pos.c];
        if (!piece) {
          emit({
            type: 'pieceEvaluation',
            evaluation: emptyPieceEvaluation(),
            requestId: payload.requestId
          });
          return;
        }
        const boardEvaluation = evaluateBoard(board, payload.turn, gameStage());
        const info = boardEvaluation.piecesInfo.find((candidate: { r: number; c: number }) =>
          candidate.r === payload.pos.r && candidate.c === payload.pos.c
        );
        emit({
          type: 'pieceEvaluation',
          evaluation: info ? evaluatePieceInfo(info) : emptyPieceEvaluation(),
          requestId: payload.requestId
        });
        return;
      }

      case 'isCheck': {
        const board = decodeBoard(payload.board);
        syncGeneralPosCache(board);
        emit({ type: 'check', isCheck: isCheck(board, payload.color), requestId: payload.requestId });
        return;
      }

      case 'isValidPlacement':
        emit({
          type: 'validPlacement',
          isValid: isValidPlacement(payload.type, payload.color, payload.r, payload.c),
          requestId: payload.requestId
        });
        return;

      case 'addOpeningLineFromString':
        openingBook.addOpeningLineFromString([payload.moves], payload.weights);
        emit({ type: 'openingLineAdded', success: true });
        return;

      case 'movesToNotation':
        emit({
          type: 'notation',
          notation: openingBook.movesToNotation(payload.boardHistory, payload.moveHistory),
          requestId: payload.requestId
        });
        return;

      case 'notationToMoves':
        emit({
          type: 'moves',
          moves: openingBook.notationToMoves(payload.notation, decodeBoard(payload.initialBoard)),
          requestId: payload.requestId
        });
        return;

      case 'setValueWeights':
        setValueWeights(payload);
        return;
    }
  } catch (error) {
    const requestId = request && 'payload' in request &&
      typeof (request.payload as { requestId?: unknown }).requestId === 'string'
      ? (request.payload as { requestId: string }).requestId
      : undefined;
    emit({
      type: 'WORKER_ERROR',
      error: error instanceof Error ? error.message : String(error),
      requestType: request?.type,
      requestId
    });
  }
};

const workerScope = typeof self === 'undefined'
  ? null
  : self as unknown as DedicatedWorkerGlobalScope;

if (workerScope && typeof document === 'undefined') {
  const originalConsoleLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    workerScope.postMessage({ type: 'log', data: args.join(' ') } satisfies WorkerResponse);
    originalConsoleLog(...args);
  };
  workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
    handleWorkerRequest(event.data, (message) => workerScope.postMessage(message));
  };
}
