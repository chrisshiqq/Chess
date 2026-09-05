
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChessBoard, SKINS } from './components/ChessBoard';
import { SidePanel } from './components/CapturedPiecesPanel';
import { EvaluationPanel } from './components/EvaluationPanel';
import { 
    ArrowPathIcon,
    ArrowsLeftRightIcon, 
    BarChartIcon,
    GearIcon, 
    LightBulbIcon, 
    PlayIcon, 
    StopIcon, 
    UndoIcon, 
    SparklesIcon,
    SpeakerWaveIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    FirstPageIcon,
    LastPageIcon,
    SaveIcon,
    LoadIcon,
    PaletteIcon,
    SquareIcon,
    AdjustmentsIcon,
    BoltIcon
} from './components/Icons';
import { ClockDisplay, FlyingPiece } from './AppUI';
import { LobbyScreen, type LocalPlayMode } from './components/LobbyScreen';
import type { PeerSession } from './net/PeerSession';
import { generateRoomCode } from './net/roomCode';
import type { AppScreen, ConnectionStatus, NetMessage, OnlineSessionInfo } from './net/types';
import {
    generatePositionHash,
    isReplyingToOpponentInitiative,
    violatesRepeatedCheckCycle,
    type PositionHistoryEntry
} from './domain/repetition';
import ChessWorker from '@chess-worker';

/*
import { 
    createInitialBoard, 
    createEmptyBoard, 
    DIFFICULTIES 
} from './src/utils/chessEngine';
*/
import { Board, Color, Position, Move, PieceType, Piece, GameStatusResult, CompactBoard } from './domain/types';
import { decodeAnalysisMoves, decodeBoard, decodeMove, decodeMoves, encodeBoard, previewMove } from './engine/codec';
import { Skin, DifficultyLevel, PieceMaterial } from './ui/types';

const ROWS = 10;
const COLS = 9;

type DepthTime = { depth: number; ms: number };

type SearchBench = {
    thinkingTime: number;
    completedDepth?: number;
    targetDepth?: number;
    rootMoves?: number;
    bestPreview?: string;
    depthTimes?: DepthTime[];
};

const formatBenchTime = (value?: number) => ((value ?? 0) / 1000).toFixed(2);

const appendDepthTime = (times: DepthTime[] | undefined, depth: number, ms: number): DepthTime[] => {
    const list = times ? times.slice() : [];
    const i = list.findIndex((t) => t.depth === depth);
    if (i >= 0) list[i] = { depth, ms };
    else list.push({ depth, ms });
    return list;
};

let workerRequestSequence = 0;

const requestWorker = <T,>(
    worker: Worker,
    requestType: string,
    payload: Record<string, unknown>,
    responseType: string,
    readResponse: (data: any) => T,
    timeoutMs = 2000,
    requestId = `${Date.now()}-${++workerRequestSequence}`
): Promise<T> => new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
        clearTimeout(timeoutId);
        worker.removeEventListener('message', handleMessage);
    };
    const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
    };
    const handleMessage = (event: MessageEvent) => {
        const data = event.data;
        if (data?.requestId !== requestId) return;
        if (data.type === 'WORKER_ERROR') {
            finish(() => reject(new Error(data.error || `${requestType} failed`)));
            return;
        }
        if (data.type === responseType) {
            finish(() => resolve(readResponse(data)));
        }
    };
    const timeoutId = window.setTimeout(() => {
        finish(() => reject(new Error(`${requestType} timeout`)));
    }, timeoutMs);

    worker.addEventListener('message', handleMessage);
    try {
        worker.postMessage({
            type: requestType,
            payload: { ...payload, requestId }
        });
    } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
});

// --- Board Initialization ---
// --- Enhanced Difficulty Configuration ---
const DIFFICULTIES: Record<DifficultyLevel, { depth: number; randomness: number }> = {
    easy: { depth: 3, randomness: 0.0 },
    medium: { depth: 5, randomness: 0.0 },
    hard: { depth: 8, randomness: 0.0 }
};

const createInitialBoard = (): Board => {
  const board: Board = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));

  const setupRow = (row: number, color: Color, types: PieceType[]) => {
    types.forEach((type, col) => {
      board[row][col] = { type, color };
    });
  };

  const backRow: PieceType[] = ['chariot', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'chariot'];
  
  setupRow(9, 'black', backRow);
  board[7][1] = { type: 'cannon', color: 'black' };
  board[7][7] = { type: 'cannon', color: 'black' };
  for (let c = 0; c < COLS; c += 2) board[6][c] = { type: 'soldier', color: 'black' };

  setupRow(0, 'red', backRow);
  board[2][1] = { type: 'cannon', color: 'red' };
  board[2][7] = { type: 'cannon', color: 'red' };
  for (let c = 0; c < COLS; c += 2) board[3][c] = { type: 'soldier', color: 'red' };

  return board;
};

export const createEmptyBoard = (): Board => {
    return Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
};

// 棋谱/存档局面：与搜索码相同，0 空，红 1–7，黑 9–15
export const boardToCompactFormat = (board: Board): CompactBoard => encodeBoard(board);

const compactFormatToBoard = (compactBoard: CompactBoard): Board => decodeBoard(compactBoard);

// 音效数据 - 使用 Web Audio API 生成
const generateTone = (frequency: number, duration: number, type: OscillatorType = 'sine'): string => {
    const sampleRate = 44100;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);
    
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        if (type === 'sine') {
            buffer[i] = Math.sin(2 * Math.PI * frequency * t) * Math.exp(-t * 3);
        } else if (type === 'square') {
            buffer[i] = (Math.sin(2 * Math.PI * frequency * t) > 0 ? 1 : -1) * Math.exp(-t * 3);
        } else if (type === 'triangle') {
            buffer[i] = (2 * Math.asin(Math.sin(2 * Math.PI * frequency * t)) / Math.PI) * Math.exp(-t * 3);
        }
    }
    
    // 转换为 16 位 PCM
    const intBuffer = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        intBuffer[i] = Math.max(-32768, Math.min(32767, buffer[i] * 32767));
    }
    
    // 创建 WAV 文件
    const wavHeader = new ArrayBuffer(44);
    const wavView = new DataView(wavHeader);
    
    const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            wavView.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    
    writeString(0, 'RIFF');
    wavView.setUint32(4, 36 + intBuffer.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    wavView.setUint32(16, 16, true);
    wavView.setUint16(20, 1, true);
    wavView.setUint16(22, 1, true);
    wavView.setUint32(24, sampleRate, true);
    wavView.setUint32(28, sampleRate * 2, true);
    wavView.setUint16(32, 2, true);
    wavView.setUint16(34, 16, true);
    writeString(36, 'data');
    wavView.setUint32(40, intBuffer.length * 2, true);
    
    const wav = new Uint8Array(wavHeader.byteLength + intBuffer.byteLength);
    wav.set(new Uint8Array(wavHeader), 0);
    wav.set(new Uint8Array(intBuffer.buffer), wavHeader.byteLength);
    
    const base64 = btoa(String.fromCharCode.apply(null, wav));
    return `data:audio/wav;base64,${base64}`;
};

// 生成落子碰撞音效 - 模拟棋子落到棋盘上的声音
const generateDropSound = (): string => {
    const sampleRate = 44100;
    const duration = 0.15; // 稍长的持续时间
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);
    
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        
        // 组合多个频率来模拟碰撞声音
        // 高频部分 - 清脆的碰撞
        const highFreq = Math.sin(2 * Math.PI * 1500 * t) * 0.3;
        // 中频部分 - 主体声音
        const midFreq = Math.sin(2 * Math.PI * 800 * t) * 0.4;
        // 低频部分 - 撞击感
        const lowFreq = Math.sin(2 * Math.PI * 200 * t) * 0.2;
        
        // 噪声部分 - 增加真实感
        const noise = (Math.random() - 0.5) * 0.1;
        
        // 衰减包络
        const envelope = Math.exp(-t * 15); // 快速衰减
        
        // 组合所有声音
        buffer[i] = (highFreq + midFreq + lowFreq + noise) * envelope;
        
        // 在开头添加一个小的冲击效果
        if (i < 100) {
            buffer[i] += (Math.random() - 0.5) * 0.3;
        }
    }
    
    // 转换为 16 位 PCM
    const intBuffer = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        intBuffer[i] = Math.max(-32768, Math.min(32767, buffer[i] * 32767));
    }
    
    // 创建 WAV 文件
    const wavHeader = new ArrayBuffer(44);
    const wavView = new DataView(wavHeader);
    
    const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            wavView.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    
    writeString(0, 'RIFF');
    wavView.setUint32(4, 36 + intBuffer.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    wavView.setUint32(16, 16, true);
    wavView.setUint16(20, 1, true);
    wavView.setUint16(22, 1, true);
    wavView.setUint32(24, sampleRate, true);
    wavView.setUint32(28, sampleRate * 2, true);
    wavView.setUint16(32, 2, true);
    wavView.setUint16(34, 16, true);
    writeString(36, 'data');
    wavView.setUint32(40, intBuffer.length * 2, true);
    
    const wav = new Uint8Array(wavHeader.byteLength + intBuffer.byteLength);
    wav.set(new Uint8Array(wavHeader), 0);
    wav.set(new Uint8Array(intBuffer.buffer), wavHeader.byteLength);
    
    const base64 = btoa(String.fromCharCode.apply(null, wav));
    return `data:audio/wav;base64,${base64}`;
};

// 不同类型的音效
const MOVE_SOUND = generateDropSound();
const CAPTURE_SOUND = generateTone(400, 0.2, 'sine');
const CHECK_SOUND = generateTone(1200, 0.3, 'triangle');
const GAME_OVER_SOUND = generateTone(300, 0.5, 'sine');
const VICTORY_SOUND = generateTone(600, 0.4, 'triangle');

// 保留原有的简单点击音效
const CLICK_SOUND_URI = generateTone(600, 0.05, 'square'); 
const BOARD_HEIGHT_PX = 570; 

/** 程序化 BGM 变体：慢速轻量氛围，Restart 时随机换一套 */
type MusicVariant = {
    chords: number[][];
    beatDuration: number;
    wave: OscillatorType;
};

const MUSIC_VARIANTS: MusicVariant[] = [
    // Am – F – C – G（原版）
    {
        chords: [
            [220.00, 261.63, 329.63],
            [174.61, 220.00, 261.63],
            [130.81, 164.81, 196.00],
            [196.00, 246.94, 293.66],
        ],
        beatDuration: 0.8,
        wave: 'triangle',
    },
    // C – G – Am – F
    {
        chords: [
            [130.81, 164.81, 196.00],
            [196.00, 246.94, 293.66],
            [220.00, 261.63, 329.63],
            [174.61, 220.00, 261.63],
        ],
        beatDuration: 0.85,
        wave: 'sine',
    },
    // Dm – Bb – F – C
    {
        chords: [
            [146.83, 174.61, 220.00],
            [116.54, 146.83, 174.61],
            [174.61, 220.00, 261.63],
            [130.81, 164.81, 196.00],
        ],
        beatDuration: 0.9,
        wave: 'triangle',
    },
    // Em – C – G – D
    {
        chords: [
            [164.81, 196.00, 246.94],
            [130.81, 164.81, 196.00],
            [196.00, 246.94, 293.66],
            [146.83, 185.00, 220.00],
        ],
        beatDuration: 0.75,
        wave: 'sine',
    },
    // F – C – Dm – Am
    {
        chords: [
            [174.61, 220.00, 261.63],
            [130.81, 164.81, 196.00],
            [146.83, 174.61, 220.00],
            [220.00, 261.63, 329.63],
        ],
        beatDuration: 0.82,
        wave: 'triangle',
    },
    // G – Em – C – D
    {
        chords: [
            [196.00, 246.94, 293.66],
            [164.81, 196.00, 246.94],
            [130.81, 164.81, 196.00],
            [146.83, 185.00, 220.00],
        ],
        beatDuration: 0.78,
        wave: 'sine',
    },
    // Am – Dm – G – C
    {
        chords: [
            [220.00, 261.63, 329.63],
            [146.83, 174.61, 220.00],
            [196.00, 246.94, 293.66],
            [130.81, 164.81, 196.00],
        ],
        beatDuration: 0.88,
        wave: 'triangle',
    },
    // C – Am – F – G
    {
        chords: [
            [130.81, 164.81, 196.00],
            [220.00, 261.63, 329.63],
            [174.61, 220.00, 261.63],
            [196.00, 246.94, 293.66],
        ],
        beatDuration: 0.8,
        wave: 'sine',
    },
];

const INITIAL_SUPPLY: Record<Color, Record<PieceType, number>> = {
    red: { general: 1, advisor: 2, elephant: 2, horse: 2, chariot: 2, cannon: 2, soldier: 5 },
    black: { general: 1, advisor: 2, elephant: 2, horse: 2, chariot: 2, cannon: 2, soldier: 5 }
};





const App: React.FC = () => {
    const [appScreen, setAppScreen] = useState<AppScreen>('lobby');
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
    const [lobbyStatusMessage, setLobbyStatusMessage] = useState<string | null>(null);
    const [onlineInfo, setOnlineInfo] = useState<OnlineSessionInfo | null>(null);
    const peerSessionRef = useRef<PeerSession | null>(null);
    const applyingRemoteRef = useRef(false);
    const onlineInfoRef = useRef<OnlineSessionInfo | null>(null);
    const executeMoveRef = useRef<(move: Move, moveTurn?: Color) => Promise<boolean>>(async () => false);
    const onNetMessageRef = useRef<(msg: NetMessage) => void>(() => {});
    const resetGameStateRef = useRef<() => void>(() => {});
    const boardSnapshotRef = useRef<Board>(createInitialBoard());
    const moveHistorySnapshotRef = useRef<Move[]>([]);

    const [board, setBoard] = useState<Board>(createInitialBoard());
    const [turn, setTurn] = useState<Color>('red');
    const [playerColor, setPlayerColor] = useState<Color>('red');
    const [coordinateStyle, setCoordinateStyle] = useState<'chinese' | 'western'>('chinese');
    
    const [selectedPos, setSelectedPos] = useState<Position | null>(null);
    const [validMoves, setValidMoves] = useState<Position[]>([]);
    // 棋子关系状态
    const [pieceRelations, setPieceRelations] = useState<{
        threat: Position[]; // 当前棋子威胁的敌方棋子位置
        threatenedBy: Position[]; // 威胁当前棋子的敌方棋子位置
        guard: Position[]; // 当前棋子保护的友方棋子位置
        guardedBy: Position[]; // 保护当前棋子的友方棋子位置
        control?: Position[]; // 当前棋子控制的位置
        controllers?: Position[]; // 控制当前位置的棋子位置
    }>({ threat: [], threatenedBy: [], guard: [], guardedBy: [] });

    // 选中棋子的评估值
    const [selectedPieceEval, setSelectedPieceEval] = useState<{
        material: number;
        position: number;
        mobility: number;
        threat: number;
        safety: number;
    } | null>(null);
    
    const [boardHistory, setBoardHistory] = useState<Board[]>([createInitialBoard()]);
    const [moveHistory, setMoveHistory] = useState<Move[]>([]);
    
    const [gameOver, setGameOver] = useState<GameStatusResult | null>(null);
    const [checkAlert, setCheckAlert] = useState<boolean>(false);
    const [pendingGameOver, setPendingGameOver] = useState<GameStatusResult | null>(null);
    const gameOverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const moveAnimActiveRef = useRef(false);
    const pendingMoveEvalRef = useRef<MoveEvaluation | null>(null);
    const moveEvalGenRef = useRef(0);

    const [hintMove, setHintMove] = useState<Move | null>(null);
    const [redIsAuto, setRedIsAuto] = useState<boolean>(false);
    const [blackIsAuto, setBlackIsAuto] = useState<boolean>(true); // 黑方默认 AI 行棋
    const redIsAutoRef = useRef<boolean>(false);
    const blackIsAutoRef = useRef<boolean>(true);
    
    useEffect(() => {
        redIsAutoRef.current = redIsAuto;
    }, [redIsAuto]);
    
    useEffect(() => {
        blackIsAutoRef.current = blackIsAuto;
    }, [blackIsAuto]);
    const [isReplaying, setIsReplaying] = useState<boolean>(false);
    const [replayIndex, setReplayIndex] = useState<number>(0);
    const [replayNotation, setReplayNotation] = useState<string[]>([]);
    const [analysisMoves, setAnalysisMoves] = useState<Array<{move: Move, score: number, moveSequence: Move[]}>>([]); // 分析结果
    const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false); // 是否正在分析
    const [selectedAnalysisMove, setSelectedAnalysisMove] = useState<number | null>(null); // 选中的分析着法索引
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isMuted = false;
    const [isMusicEnabled, setIsMusicEnabled] = useState<boolean>(true); // 默认打开
    const [musicVariant, setMusicVariant] = useState<number>(
        () => Math.floor(Math.random() * MUSIC_VARIANTS.length)
    );

    const musicRef = useRef<HTMLAudioElement | null>(null);
    const sfxRef = useRef<HTMLAudioElement | null>(null);
    const moveSoundRef = useRef<HTMLAudioElement | null>(null);
    const captureSoundRef = useRef<HTMLAudioElement | null>(null);
    const checkSoundRef = useRef<HTMLAudioElement | null>(null);
    const gameOverSoundRef = useRef<HTMLAudioElement | null>(null);
    const victorySoundRef = useRef<HTMLAudioElement | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const musicGainRef = useRef<GainNode | null>(null);
    const musicStartedRef = useRef<boolean>(false); // 追踪音乐是否已启动


    const [isSetupMode, setIsSetupMode] = useState<boolean>(false);
    const [setupSupply, setSetupSupply] = useState(INITIAL_SUPPLY);

    const [flyingPiece, setFlyingPiece] = useState<{ piece: Piece, from: Position, target: {x: number, y: number}, id: number } | null>(null);
    // 行棋动画状态
    const [moveAnimation, setMoveAnimation] = useState<{ from: Position, to: Position, id: number, piece: Piece } | null>(null);

    const [redTime, setRedTime] = useState(0);
    const [blackTime, setBlackTime] = useState(0);
    const [hasStarted, setHasStarted] = useState(false);

    // 长将和长捉检测
    // 局面历史，存储哈希值和被捉棋子信息
    const [positionHistory, setPositionHistory] = useState<PositionHistoryEntry[]>([]);
    const [repetitionWarning, setRepetitionWarning] = useState<string | null>(null); // 重复警告

    // 随机选择棋盘和棋子
    const [skin, setSkin] = useState<Skin>(() => {
        const skins: Skin[] = ['stone-board', 'wood-board', 'paper-board', 'glass-board'];
        return skins[Math.floor(Math.random() * skins.length)];
    });
    const [material, setMaterial] = useState<PieceMaterial>(() => {
        const materials: PieceMaterial[] = ['wood', 'stone', 'metal', 'glass'];
        return materials[Math.floor(Math.random() * materials.length)];
    });
    const [isThinking, setIsThinking] = useState(false);
    const [showSkinSelector, setShowSkinSelector] = useState(false);
    const [showMaterialSelector, setShowMaterialSelector] = useState(false);
    const [aiSearchDebug, setAiSearchDebug] = useState<{
        active: boolean;
        gameId: number | null;
        turn: Color | null;
        targetDepth: number;
        completedDepth: number;
        currentDepth: number;
        rootMoves: number;
        phase: string;
        bestPreview: string;
        score: number | null;
        startedAt: number | null;
        lastProgressAt: number | null;
        lastEvent: string;
        postedAt: number | null;
        depthTimes: DepthTime[];
    }>({
        active: false,
        gameId: null,
        turn: null,
        targetDepth: 0,
        completedDepth: -2,
        currentDepth: 0,
        rootMoves: 0,
        phase: '',
        bestPreview: '',
        score: null,
        startedAt: null,
        lastProgressAt: null,
        lastEvent: '',
        postedAt: null,
        depthTimes: []
    });
    const aiSearchDebugRef = useRef(aiSearchDebug);
    aiSearchDebugRef.current = aiSearchDebug;
    // SEARCH_PROGRESS 节流：合并到 pending，≥200ms 再 flush；COMPLETE 时强制刷最新值
    const aiSearchProgressPendingRef = useRef<((prev: typeof aiSearchDebug) => typeof aiSearchDebug) | null>(null);
    const aiSearchProgressTimerRef = useRef<number | null>(null);
    const aiSearchProgressLastFlushRef = useRef(0);
    const aiSearchListenerRef = useRef<((e: MessageEvent) => void) | null>(null);
    const aiSearchCleanupRef = useRef<(() => void) | null>(null);
    const aiSearchAbortRef = useRef<{ gameId: number; aborted: boolean } | null>(null);

    const [playDepth, setPlayDepth] = useState<number>(10);
    const [analysisDepth, setAnalysisDepth] = useState<number>(10);
    const [analysisScale, setAnalysisScale] = useState<number>(20);
    const [lastSearchBench, setLastSearchBench] = useState<SearchBench | null>(null);
    // 隐藏最优着法和次优着法
    const [hiddenBestMove, setHiddenBestMove] = useState<Move | null>(null);
    const [suboptimalMove, setSuboptimalMove] = useState<Move | null>(null);
    const [analysisBestMove, setAnalysisBestMove] = useState<Move | null>(null);
    const [analysisSecondBestMove, setAnalysisSecondBestMove] = useState<Move | null>(null);
    // 最近被吃的棋子
    const [recentlyCaptured, setRecentlyCaptured] = useState<{ color: Color; type: PieceType } | null>(null);
    // 保存原始棋盘状态用于预览未来局面
    const [originalBoardForPreview, setOriginalBoardForPreview] = useState<Board | null>(null);
    const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
    // Analysis模式状态
    const [isAnalysisMode, setIsAnalysisMode] = useState<boolean>(false);

    useEffect(() => {
        const autoTurn = turn === 'red' ? redIsAuto : blackIsAuto;
        if (!autoTurn) return;
        setAnalysisMoves([]);
        setAnalysisBestMove(null);
        setAnalysisSecondBestMove(null);
        setSelectedAnalysisMove(null);
        setIsAnalyzing(false);
        setIsPreviewing(false);
        setOriginalBoardForPreview(null);
    }, [turn, redIsAuto, blackIsAuto]);

    useEffect(() => {
        const autoTurn = turn === 'red' ? redIsAuto : blackIsAuto;
        if (!autoTurn || !isAnalysisMode || analysisMoves.length > 0) return;
        setIsAnalysisMode(false);
    }, [turn, redIsAuto, blackIsAuto, isAnalysisMode, analysisMoves.length]);
    // 修改moveEvaluation状态结构，存储走棋前后的完整分数数据，支持红黑双方
    interface PlayerEvaluation {
        total: number;
        material: number;
        position: number;
        safety: number;
        mobility: number;
        threat: number;
    }
    
    interface MoveEvaluation {
        pre: {
            red: PlayerEvaluation;
            black: PlayerEvaluation;
        };
        post: {
            red: PlayerEvaluation;
            black: PlayerEvaluation;
        };
        diff: {
            red: PlayerEvaluation;
            black: PlayerEvaluation;
        };
    }
    // 初始化moveEvaluation为所有0的对象，确保首次游戏时显示EVALUATION UI
    const [moveEvaluation, setMoveEvaluation] = useState<MoveEvaluation>({
        pre: {
            red: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 }
        },
        post: {
            red: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 }
        },
        diff: {
            red: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 }
        }
    });
    // 缓存上一手 post 评估，供下一步作 pre，避免每步双次整盘评估
    const cachedBoardEvalRef = useRef<{
        hash: string;
        red: PlayerEvaluation;
        black: PlayerEvaluation;
    } | null>(null);
    
    // Tab navigation for right panel
    const [activeTab, setActiveTab] = useState<'game' | 'replay' | 'setup' | 'settings' | 'stats'>('game');
    
    // 重置所有棋盘指示器的函数
    const resetBoardIndicators = () => {
        setSelectedPos(null);
        setValidMoves([]);
        setPieceRelations({ threat: [], threatenedBy: [], guard: [], guardedBy: [] });
        setSelectedPieceEval(null);
        setHiddenBestMove(null);
        setSuboptimalMove(null);
        setAnalysisBestMove(null);
        setAnalysisSecondBestMove(null);
        setFlyingPiece(null);
    };
    
    // Custom board color settings
    const [boardBgColor, setBoardBgColor] = useState('#e0c090'); // 默认棋盘背景色
    const [boardLineColor, setBoardLineColor] = useState('#8b4513'); // 默认棋盘线颜色
    const [enableCustomColors, setEnableCustomColors] = useState(false); // 开关：是否启用自定义棋盘颜色

    // Derive dual mode from auto settings: both players are manual (not auto)
    
    // Try feature removed: related state variables eliminated
    
    // Player turn counters
    const [redStepCount, setRedStepCount] = useState(0);
    const [blackStepCount, setBlackStepCount] = useState(0);
    
    // 连续无吃子步数计数器（每步 +1；满 120 步即双方各 60 回合判和）
    const [drawMoveCounter, setDrawMoveCounter] = useState(0);
    
    // Difficulty State - Default MEDIUM
    const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');

    // Game ID to prevent zombie AI moves after restart
    const [gameId, setGameId] = useState(0);

    // Chess AI with Opening Book
    const openingBookEnabled = true;

    // VALUE_WEIGHTS for chess evaluation
    const [valueWeights, setValueWeights] = useState({
        material: 1,
        position: 1,
        threat: 1,
        safety: 1,
        mobility: 1
    });

    // Refs for timer to prevent interval resets on turn change
    const turnRef = useRef(turn);
    useEffect(() => { turnRef.current = turn; }, [turn]);
    useEffect(() => { boardSnapshotRef.current = board; }, [board]);
    useEffect(() => { moveHistorySnapshotRef.current = moveHistory; }, [moveHistory]);
    useEffect(() => { onlineInfoRef.current = onlineInfo; }, [onlineInfo]);

    // Worker Ref
    const workerRef = useRef<Worker | null>(null);
    const valueWeightsRef = useRef(valueWeights);
    valueWeightsRef.current = valueWeights;
    const customOpeningLinesRef = useRef<string[]>([]);
    // 选子探测请求序号：快速连点时丢弃过期结果，避免旧评估堵住交互感
    const selectInspectIdRef = useRef(0);
    const selectInspectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const emptyPieceRelations = useRef({
        threat: [] as Position[],
        threatenedBy: [] as Position[],
        guard: [] as Position[],
        guardedBy: [] as Position[],
        control: [] as Position[],
        controllers: [] as Position[]
    }).current;
    const emptyValidMoves = useRef<Position[]>([]).current;

    // Worker函数调用封装
    const workerGetValidMoves = useRef((board: Board, pos: Position, requestId?: string): Promise<Position[]> => {
        const worker = workerRef.current;
        if (!worker) return Promise.reject(new Error('Worker not initialized'));
        return requestWorker(worker, 'getValidMoves', { board: encodeBoard(board), pos }, 'validMoves', data => data.moves, 1000, requestId)
            .catch(error => {
                if (error instanceof Error && error.message === 'getValidMoves timeout') {
                    console.warn('⚠️ workerGetValidMoves timeout, returning empty moves');
                    return [];
                }
                throw error;
            });
    }).current;

    // 获取详细的局面评估分数
    const workerGetDetailedEval = useRef((board: Board, turn: Color, isReplay: boolean = false): Promise<any> => {
        const worker = workerRef.current;
        if (!worker) return Promise.reject(new Error('Worker not initialized'));
        return requestWorker(
            worker,
            'evaluateBoard',
            { board: encodeBoard(board), turn, isReplay, depth: playDepth },
            'detailedEvaluation',
            data => data.evaluation
        );
    }).current;

    // 一次 worker 调用完成：合法着法 + 单子评估 + 关系（内部只跑一遍 evaluateBoard）
    const workerInspectSquare = useRef((
        board: Board,
        pos: Position,
        turn: Color | null,
        needMoves: boolean,
        requestId: string
    ): Promise<{ moves: Position[]; evaluation: any; relations: any }> => {
        const worker = workerRef.current;
        if (!worker) return Promise.reject(new Error('Worker not initialized'));
        return requestWorker(
            worker,
            'inspectSquare',
            { board: encodeBoard(board), pos, turn, needMoves },
            'squareInspected',
            data => ({
                moves: data.moves || [],
                evaluation: data.evaluation,
                relations: data.relations
            }),
            2000,
            requestId
        );
    }).current;

    const workerCheckGameState = useRef((board: Board, turn: Color): Promise<GameStatusResult> => {
        const worker = workerRef.current;
        if (!worker) return Promise.reject(new Error('Worker not initialized'));
        return requestWorker(worker, 'checkGameState', { board: encodeBoard(board), turn }, 'gameState', data => data.state)
            .catch(error => {
                if (error instanceof Error && error.message === 'checkGameState timeout') {
                    console.warn('⚠️ workerCheckGameState timeout, worker busy');
                    return { status: 'playing' };
                }
                throw error;
            });
    }).current;

    const workerIsCheck = useRef((board: Board, color: Color): Promise<boolean> => {
        const worker = workerRef.current;
        if (!worker) return Promise.reject(new Error('Worker not initialized'));
        return requestWorker(worker, 'isCheck', { board: encodeBoard(board), color }, 'check', data => data.isCheck)
            .catch(error => {
                if (error instanceof Error && error.message === 'isCheck timeout') {
                    console.warn('⚠️ workerIsCheck timeout, worker busy');
                    return false;
                }
                throw error;
            });
    }).current;

    const workerIsValidPlacement = useRef((type: PieceType, color: Color, r: number, c: number): Promise<boolean> => {
        const worker = workerRef.current;
        if (!worker) return Promise.reject(new Error('Worker not initialized'));
        return requestWorker(
            worker,
            'isValidPlacement',
            { type, color, r, c },
            'validPlacement',
            data => data.isValid
        );
    }).current;



    const terminateWorker = useRef(() => {
        // Termination must also release every main-thread reference to the old worker.
        if (aiSearchListenerRef.current && workerRef.current) {
            workerRef.current.removeEventListener('message', aiSearchListenerRef.current);
        }
        aiSearchListenerRef.current = null;
        if (aiSearchAbortRef.current) aiSearchAbortRef.current.aborted = true;
        aiSearchCleanupRef.current = null;
        if (aiSearchProgressTimerRef.current != null) {
            window.clearTimeout(aiSearchProgressTimerRef.current);
            aiSearchProgressTimerRef.current = null;
        }
        aiSearchProgressPendingRef.current = null;

        const previousWorker = workerRef.current;
        workerRef.current = null;
        previousWorker?.terminate();
    }).current;

    const ensureWorker = useRef(() => {
        if (workerRef.current) return workerRef.current;
        try {
            const worker = new ChessWorker();
            workerRef.current = worker;
            console.log('✅ Worker loaded successfully (inline module worker)');

            worker.postMessage({
                type: 'setValueWeights',
                payload: valueWeightsRef.current
            });

            import('./openingBookData').then(({ openingBookData }) => {
                if (workerRef.current !== worker) return;
                const builtInLines = openingBookData.trim().split('\n');
                const lines = [...builtInLines, ...customOpeningLinesRef.current];
                lines.forEach((line) => {
                    const trimmedLine = line.trim();
                    if (trimmedLine && !trimmedLine.startsWith('#')) {
                        worker.postMessage({
                            type: 'addOpeningLineFromString',
                            payload: {
                                moves: trimmedLine,
                                weights: [85, 85, 95, 90, 90, 85, 85, 80, 85, 85, 85, 85]
                            }
                        });
                    }
                });
                console.log(`✅ Successfully loaded ${lines.length} opening lines`);
            }).catch((error) => {
                if (workerRef.current === worker) {
                    console.error('❌ Failed to import opening book data:', error);
                }
            });
            return worker;
        } catch (e) {
            console.error("❌ Failed to load worker:", e);
            return null;
        }
    }).current;

    const recreateWorker = useRef(() => {
        terminateWorker();
        return ensureWorker();
    }).current;

    // The lobby does not need the 64 MiB TT and 17 MiB eval cache. Keep the
    // worker absent until a game starts, and release it when App unmounts.
    useEffect(() => {
        return terminateWorker;
    }, [terminateWorker]);

    // 发送权重到worker
    const sendWeightsToWorker = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.postMessage({
                type: 'setValueWeights',
                payload: valueWeights
            });
        }
    }, [valueWeights]);

    // 当权重改变时发送到worker
    useEffect(() => {
        sendWeightsToWorker();
    }, [sendWeightsToWorker]);

    // 初始化 AudioContext（延迟到用户交互时）
    const initAudioContext = () => {
        if (!audioContextRef.current) {
            try {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                musicGainRef.current = audioContextRef.current.createGain();
                musicGainRef.current.connect(audioContextRef.current.destination);
                musicGainRef.current.gain.value = 0.3; // 音量30%

            } catch (err) {
                console.error('❌ Failed to initialize AudioContext:', err);
            }
        }
    };

    // 检测外部MP3文件是否存在
    useEffect(() => {

    }, []);

    // 进游戏的时候初始化音频系统
    useEffect(() => {
        initAudioContext();
    }, []);

    // 启动音乐（需要用户交互）
    const startMusicOnUserGesture = async () => {
        
        if (!isMusicEnabled) {
            console.log('⏹️ Music is disabled, skipping');
            return;
        }
        
        // 使用生成音乐
        initAudioContext();
        
        if (audioContextRef.current) {
            const currentState = audioContextRef.current.state;
            
            if (currentState === 'suspended') {
                try {
                    await audioContextRef.current.resume();
                    musicStartedRef.current = true;
                    //console.log('🎶 Generated music resumed after user interaction!');
                } catch (err) {
                    //console.error('❌ Failed to resume generated music:', err);
                }
            } else if (currentState === 'running' && !musicStartedRef.current) {
                musicStartedRef.current = true;
                //console.log('🎶 Music already running, marking as started');
            }
        }
        
    };

    useEffect(() => {
        if (musicRef.current) musicRef.current.volume = 0.3;
        if (sfxRef.current) sfxRef.current.volume = 0.6;
        
        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
    
        };
    }, []);



    // 使用useRef来存储音乐播放状态，确保所有useEffect实例共享同一个状态
    const isMusicPlayingRef = useRef<boolean>(false);
    const musicTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 改进的音乐系统，实现循环播放但避免声音叠加
    useEffect(() => {
        // 只有在对局期间（hasStarted为true且gameOver为null）且音乐开关打开时才播放音乐
        const shouldPlayMusic = isMusicEnabled && hasStarted && !gameOver;

        // 确保AudioContext和GainNode已初始化
        if (!audioContextRef.current || !musicGainRef.current) {
            initAudioContext();
            // 等待初始化完成后再继续
            return;
        }

        // 如果音乐不应该播放，暂停AudioContext并停止所有音乐循环
        if (!shouldPlayMusic) {
            // 停止所有音乐循环
            isMusicPlayingRef.current = false;
            if (musicTimeoutRef.current) {
                clearTimeout(musicTimeoutRef.current);
                musicTimeoutRef.current = null;
            }
            
            // 暂停AudioContext
            if (audioContextRef.current.state === 'running') {
                audioContextRef.current.suspend().then(() => {
                    console.log('⏸️ Music paused (not in game)');
                });
            }
            return;
        }

        // 如果已经有活跃的音乐循环，不要创建新的
        if (isMusicPlayingRef.current) {
            console.log('🎵 Music loop already active, skipping creation');
            // 确保AudioContext是运行状态
            if (audioContextRef.current.state === 'suspended') {
                audioContextRef.current.resume().then(() => {
                    //console.log('✅ AudioContext resumed for music');
                });
            }
            return;
        }

        // 确保AudioContext是运行状态
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().then(() => {
                //console.log('✅ AudioContext resumed for music');
            });
        }

        const ctx = audioContextRef.current;
        const gain = musicGainRef.current;
        
        // 标记音乐正在播放
        isMusicPlayingRef.current = true;
        
        //console.log('🎵 Starting background music loop');

        // 按当前变体生成背景音乐段落
        const variant = MUSIC_VARIANTS[musicVariant % MUSIC_VARIANTS.length];
        const generateMusicPass = () => {
            if (!isMusicPlayingRef.current) return 0;
            
            const currentTime = ctx.currentTime;
            let time = currentTime + 0.1;
            const beatDuration = variant.beatDuration;
            const chords = variant.chords;

            // 播放单个和弦
            const playChord = (chordNotes: number[], startTime: number, duration: number) => {
                if (!isMusicPlayingRef.current) return;
                
                chordNotes.forEach((freq) => {
                    const osc = ctx.createOscillator();
                    const noteGain = ctx.createGain();
                    
                    osc.type = variant.wave;
                    osc.frequency.value = freq;
                    
                    // 简单的包络
                    noteGain.gain.setValueAtTime(0, startTime);
                    noteGain.gain.linearRampToValueAtTime(0.2, startTime + 0.1);
                    noteGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
                    
                    osc.connect(noteGain);
                    noteGain.connect(gain);

                    osc.onended = () => {
                        osc.disconnect();
                        noteGain.disconnect();
                    };
                    
                    osc.start(startTime);
                    osc.stop(startTime + duration);
                });
            };

            // 播放4个和弦，每个和弦4拍
            chords.forEach((chord) => {
                playChord(chord, time, beatDuration * 4);
                time += beatDuration * 4;
            });

            return time - currentTime;
        };

        // 音乐循环函数
        const musicLoop = () => {
            if (!isMusicPlayingRef.current) return;
            
            // 生成音乐段落并获取持续时间
            const duration = generateMusicPass();
            
            // 在音乐段落结束后重新生成
            if (duration > 0) {
                // 保存timeoutID，以便后续清理
                musicTimeoutRef.current = setTimeout(() => {
                    if (isMusicPlayingRef.current) {
                        musicLoop();
                    }
                }, (duration - 0.5) * 1000);
            }
        };

        // 启动音乐循环
        musicLoop();

        // 清理函数
        return () => {
            console.log('🛑 Music loop cleanup');
            // 标记音乐不再播放
            isMusicPlayingRef.current = false;
            // 清理timeout
            if (musicTimeoutRef.current) {
                clearTimeout(musicTimeoutRef.current);
                musicTimeoutRef.current = null;
            }
        };
    }, [isMusicEnabled, hasStarted, gameOver, musicVariant]); // 依赖游戏状态、音乐开关与曲目变体

    // Timer Logic
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | null = null;
        
        if (!gameOver && !isReplaying && !isSetupMode && hasStarted) {
            interval = setInterval(() => {
                if (turnRef.current === 'red') {
                    setRedTime(prev => prev + 1);
                } else {
                    setBlackTime(prev => prev + 1);
                }
            }, 1000);
        }
        
        return () => { if (interval) clearInterval(interval); };
    }, [gameOver, isReplaying, isSetupMode, hasStarted]);

    // 检测局面是否处于将军状态
    const isBoardInCheck = async (board: Board, color: Color): Promise<boolean> => {
        return await workerIsCheck(board, color);
    };

    // 检测是否是捉子（攻击对方有价值的棋子）
    const isCapturingThreat = async (board: Board, move: Move, color: Color): Promise<{ isThreat: boolean; targetPiece?: { type: PieceType; position: Position } }> => {
        // 执行移动后检查
        const newBoard = board.map(row => [...row]);
        newBoard[move.to.r][move.to.c] = newBoard[move.from.r][move.from.c];
        newBoard[move.from.r][move.from.c] = null;

        const piece = newBoard[move.to.r][move.to.c];
        if (!piece) return { isThreat: false };

        const enemyColor = color === 'red' ? 'black' : 'red';
        
        // 获取该棋子能攻击的位置
        const attackMoves = await workerGetValidMoves(newBoard, move.to);
        
        // 检查是否攻击对方有价值的棋子（排除兵、将）
        for (const attackPos of attackMoves) {
            const target = newBoard[attackPos.r][attackPos.c];
            if (target && target.color === enemyColor) {
                // 捉子定义：攻击车、马、炮、象、士（不包括兵和将）
                if (['chariot', 'horse', 'cannon', 'elephant', 'advisor'].includes(target.type)) {
                    return { 
                        isThreat: true, 
                        targetPiece: { type: target.type, position: attackPos }
                    };
                }
            }
        }
        return { isThreat: false };
    };

    // 检测长将或长捉
    const checkRepetition = async (
        newHash: string, 
        history: PositionHistoryEntry[],
        lastMove: Move, 
        boardBeforeMove: Board,
        turn: Color,
        cached?: {
            isCheck?: boolean;
            capturingResult?: { isThreat: boolean; targetPiece?: { type: PieceType; position: Position } };
        }
    ): Promise<{ violation: boolean; type: 'chase' | 'check' | null }> => {
        const enemyColor = turn === 'red' ? 'black' : 'red';
        // 调用方可传入已算好的将军/捉子，避免同一步内重复 Worker RPC
        let isCheck = cached?.isCheck;
        let capturingResult = cached?.capturingResult;
        if (isCheck === undefined || capturingResult === undefined) {
            const newBoard = boardBeforeMove.map(row => [...row]);
            newBoard[lastMove.to.r][lastMove.to.c] = newBoard[lastMove.from.r][lastMove.from.c];
            newBoard[lastMove.from.r][lastMove.from.c] = null;
            if (isCheck === undefined) {
                isCheck = await isBoardInCheck(newBoard, enemyColor);
            }
            if (capturingResult === undefined) {
                capturingResult = await isCapturingThreat(boardBeforeMove, lastMove, turn);
            }
        }
        const isChase = capturingResult.isThreat && capturingResult.targetPiece;
        const currentTarget = capturingResult.targetPiece;

        // 棋规：只有长将/长捉的发起方须变招；躲将、躲捉、闲着的被动方不须变招。
        if (!isCheck && !isChase) {
            return { violation: false, type: null };
        }

        // 确定发起方：如果构成将军或捉子，当前走棋方是发起方
        const initiator = turn;

        // 三个完整循环后不立即判和；同一将军局面第4次出现时，发起方必须变招。
        if (violatesRepeatedCheckCycle(history, newHash, isCheck)) {
            console.log('⚠️ 长将检测：' + turn + '方试图第4次发起相同将军循环，必须变招');
            return { violation: true, type: 'check' };
        }
        
        // 计算相同局面且相同发起方的重复次数
        let initiatorRepeatCount = 0;
        for (const historyEntry of history) {
            if (historyEntry.hash === newHash && historyEntry.initiator === initiator) {
                initiatorRepeatCount++;
            }
        }
        // 加上当前局面
        initiatorRepeatCount++;
        
        // 发起方第4次重复（即连续重复3次后）才违规
        if (initiatorRepeatCount >= 4) {
            if (isCheck) {
                console.log('⚠️ 长将检测：发起方连续将军' + initiatorRepeatCount + '次（发起方：' + initiator + '）');
                return { violation: true, type: 'check' };
            } else if (isChase) {
                console.log('⚠️ 长捉检测：发起方连续捉子' + initiatorRepeatCount + '次（发起方：' + initiator + '），棋子类型：' + currentTarget!.type + '，位置：' + currentTarget!.position.r + ',' + currentTarget!.position.c);
                return { violation: true, type: 'chase' };
            }
        }

        return { violation: false, type: null };
    };

    const playMoveSound = () => {
        // 点击棋子不播放背景音乐
        
        if (!isMuted && moveSoundRef.current) {
            moveSoundRef.current.currentTime = 0;
            moveSoundRef.current.play().catch(() => {});
        }
    };

    const playCaptureSound = () => {
        if (!isMuted && captureSoundRef.current) {
            captureSoundRef.current.currentTime = 0;
            captureSoundRef.current.play().catch(() => {});
        }
    };

    const playCheckSound = () => {
        if (!isMuted && checkSoundRef.current) {
            checkSoundRef.current.currentTime = 0;
            checkSoundRef.current.play().catch(() => {});
        }
    };

    const playGameOverSound = () => {
        if (!isMuted && gameOverSoundRef.current) {
            gameOverSoundRef.current.currentTime = 0;
            gameOverSoundRef.current.play().catch(() => {});
        }
    };

    const playVictorySound = () => {
        if (!isMuted && victorySoundRef.current) {
            victorySoundRef.current.currentTime = 0;
            victorySoundRef.current.play().catch(() => {});
        }
    };

    // 处理游戏结束的清理工作，包括音效播放、UI更新和AI模式切换
    const handleGameOver = (status: GameStatusResult['status'], winner?: Color | null, warningMessage?: string) => {
        // 只处理真正的游戏结束状态，忽略playing和setup状态
        if (status === 'playing' || status === 'setup') {
            return;
        }
        
        // 设置游戏结束状态
        setGameOver({ status, winner });
        
        // 游戏结束时自动将AI模式从Auto改为Manual
        setRedIsAuto(false);
        setBlackIsAuto(false);

        resetBoardIndicators();
        
        // 播放相应音效
        if (status === 'checkmate' || status === 'stalemate') {
            if (winner === playerColor) {
                playVictorySound(); // 玩家胜利
            } else if (winner) {
                playGameOverSound(); // 玩家失败
            } else {
                playGameOverSound(); // 和棋情况
            }
        } else {
            playGameOverSound(); // 其他和棋情况
        }
        
        // 设置重复警告
        if (warningMessage) {
            setRepetitionWarning(warningMessage);
            setTimeout(() => setRepetitionWarning(null), 5000);
        }
    };

    const clearPendingGameOver = () => {
        setPendingGameOver(null);
        if (gameOverTimerRef.current) {
            clearTimeout(gameOverTimerRef.current);
            gameOverTimerRef.current = null;
        }
    };

    const armPendingGameOver = (state: GameStatusResult) => {
        setPendingGameOver(state);
        if (state.status === 'checkmate') setCheckAlert(true);
        else setCheckAlert(false);
        if (gameOverTimerRef.current) {
            clearTimeout(gameOverTimerRef.current);
        }
        gameOverTimerRef.current = setTimeout(() => {
            handleGameOver(state.status, state.winner);
            setPendingGameOver(null);
        }, 5000);
    };

    // 切换音乐开关

    const toggleMusic = (enabled: boolean) => {
        setIsMusicEnabled(enabled);
        if (enabled) {
            // 只初始化 AudioContext，不立即启动音乐循环
            // 等待用户点击棋子时再启动
            initAudioContext();
        }
    };

    // 获取棋盘材质显示名称
    const getSkinDisplayName = (skin: Skin): string => {
        switch (skin) {
            case 'stone-board': return 'Stone';
            case 'wood-board': return 'Wood';

            case 'paper-board': return 'Paper';
            case 'glass-board': return 'Glass';
            default: return 'Board';
        }
    };

    // 获取棋子材质显示名称
    const getMaterialDisplayName = (material: PieceMaterial): string => {
        switch (material) {
            case 'wood': return 'Wood';
            case 'stone': return 'Stone';
            case 'metal': return 'Metal';
            case 'glass': return 'Glass';
            default: return 'Pieces';
        }
    };

    // Get button style - 统一使用底部开关的配色
    const getButtonStyle = (disabled?: boolean) => {
        return {
            backgroundColor: disabled ? 'rgba(28, 25, 23, 0.3)' : 'rgba(28, 25, 23, 0.5)', // 禁用时透明度降低
            borderColor: disabled ? '#3f3d3a' : '#57534e', // 禁用时边框颜色变灰
            color: disabled ? '#927659' : '#d6d3d1', // 禁用时文本颜色变灰
        } as React.CSSProperties;
    };



    const flushAiSearchProgress = () => {
        if (aiSearchProgressTimerRef.current != null) {
            window.clearTimeout(aiSearchProgressTimerRef.current);
            aiSearchProgressTimerRef.current = null;
        }
        const apply = aiSearchProgressPendingRef.current;
        aiSearchProgressPendingRef.current = null;
        if (!apply) return aiSearchDebugRef.current;
        // 同步落到 ref：COMPLETE 紧跟最后一层 PROGRESS，不能等 setState updater
        const next = apply(aiSearchDebugRef.current);
        aiSearchDebugRef.current = next;
        aiSearchProgressLastFlushRef.current = Date.now();
        setAiSearchDebug(next);
        return next;
    };

    const scheduleAiSearchProgress = (apply: (prev: typeof aiSearchDebug) => typeof aiSearchDebug) => {
        const prevPending = aiSearchProgressPendingRef.current;
        aiSearchProgressPendingRef.current = (prev) => apply(prevPending ? prevPending(prev) : prev);
        const elapsed = Date.now() - aiSearchProgressLastFlushRef.current;
        const THROTTLE_MS = 200;
        if (elapsed >= THROTTLE_MS) {
            flushAiSearchProgress();
            return;
        }
        if (aiSearchProgressTimerRef.current == null) {
            aiSearchProgressTimerRef.current = window.setTimeout(flushAiSearchProgress, THROTTLE_MS - elapsed);
        }
    };

    // 通用的搜索和执行走法函数，用于AI和玩家Auto模式（同步返回 cleanup，供 effect 使用）
    const searchAndExecuteMove = (currentBoard: Board, currentTurn: Color, searchDepth: number, capturedGameId: number, randomness: number = 0, ply: number = 0, isAutoMode: boolean = false, delay: number = 0) => {
        // 新搜索开始前移除旧 listener，避免叠加
        const prevListener = aiSearchListenerRef.current;
        if (prevListener) {
            workerRef.current?.removeEventListener('message', prevListener);
            aiSearchListenerRef.current = null;
        }
        if (aiSearchAbortRef.current) aiSearchAbortRef.current.aborted = true;
        if (aiSearchProgressTimerRef.current != null) {
            window.clearTimeout(aiSearchProgressTimerRef.current);
            aiSearchProgressTimerRef.current = null;
        }
        aiSearchProgressPendingRef.current = null;

        const searchToken = { gameId: capturedGameId, aborted: false };
        const excludedRootMoves: Move[] = [];
        aiSearchAbortRef.current = searchToken;

        // 开始搜索，显示齿轮转动效果
        setIsThinking(true);
        // 清掉上一手分析箭头，避免误判为“正在考虑非法应将”
        setAnalysisMoves([]);
        setHiddenBestMove(null);
        setSuboptimalMove(null);
        setAnalysisBestMove(null);
        setAnalysisSecondBestMove(null);
        setHintMove(null);
        const postedAt = Date.now();
        const postedDebug = {
            active: true,
            gameId: capturedGameId,
            turn: currentTurn,
            targetDepth: searchDepth,
            completedDepth: -2,
            currentDepth: 0,
            rootMoves: 0,
            phase: 'posted',
            bestPreview: '',
            score: null,
            startedAt: null,
            lastProgressAt: postedAt,
            lastEvent: 'SEARCH posted',
            postedAt,
            depthTimes: [] as DepthTime[]
        };
        aiSearchDebugRef.current = postedDebug;
        setAiSearchDebug(postedDebug);
        console.info('[AI] SEARCH posted', {
            gameId: capturedGameId,
            turn: currentTurn,
            depth: searchDepth,
            ply
        });
        
        // 执行走法并处理延迟
        const executeMoveWithDelay = async (move: Move, turn: Color, isAutoMode: boolean, delay: number) => {
            if (searchToken.aborted) return;
            setIsThinking(false);
            
            // AI 和 Auto 模式共用延迟与提示移动效果
            setHintMove(move);
            
            if (delay > 0) {
                setTimeout(async () => {
                    if (searchToken.aborted) {
                        setHintMove(null);
                        return;
                    }
                    // 对于AI模式，不需要检查isAutoMode，直接执行
                    // 对于Auto模式，仍然需要检查当前颜色的auto状态，防止用户中途取消
                    let currentColorIsAuto;
                    if (isAutoMode) {
                        // AI模式总是执行
                        currentColorIsAuto = true;
                    } else {
                        // 玩家Auto模式，检查当前颜色的auto状态
                        currentColorIsAuto = (move.from && currentBoard[move.from.r] && currentBoard[move.from.r][move.from.c]) ? 
                            (currentBoard[move.from.r][move.from.c].color === 'red' ? redIsAutoRef.current : blackIsAutoRef.current) : false;
                    }
                    
                    if (!isAutoMode || (isAutoMode && currentColorIsAuto)) {
                        await executeMove(move, turn);
                    }
                    setHintMove(null);
                }, delay);
            } else {
                await executeMove(move, turn);
                setHintMove(null);
            }
        };
        
        // 检查单个走法是否会导致重复
        const checkMoveRepetition = async (move: Move): Promise<{
            violation: boolean;
            type?: string;
        }> => {
            const testBoard = currentBoard.map(row => [...row]);
            testBoard[move.to.r][move.to.c] = testBoard[move.from.r][move.from.c];
            testBoard[move.from.r][move.from.c] = null;
            const nextTurn = currentTurn === 'red' ? 'black' : 'red';
            const hash = generatePositionHash(testBoard, nextTurn);
            return await checkRepetition(hash, positionHistory, move, currentBoard, currentTurn);
        };

        const isSameMove = (left: Move, right: Move): boolean =>
            left.from.r === right.from.r && left.from.c === right.from.c &&
            left.to.r === right.to.r && left.to.c === right.to.c;

        const isUsableMove = (move: Move | null | undefined): move is Move =>
            !!(move?.from && move?.to &&
                typeof move.from.r === 'number' && typeof move.from.c === 'number' &&
                typeof move.to.r === 'number' && typeof move.to.c === 'number');

        const postSearch = (): boolean => {
            const worker = workerRef.current;
            if (!worker) return false;
            worker.postMessage({
                type: 'SEARCH',
                payload: {
                    board: encodeBoard(currentBoard),
                    turn: currentTurn,
                    depth: searchDepth,
                    randomness,
                    ply,
                    gameId: capturedGameId,
                    openingBookEnabled,
                    exactRootScores: false,
                    excludedRootMoves: [...excludedRootMoves]
                }
            });
            return true;
        };

        const detachSearchListener = (listener: (e: MessageEvent) => void): boolean => {
            const stillListening = aiSearchListenerRef.current === listener;
            workerRef.current?.removeEventListener('message', listener);
            if (stillListening) aiSearchListenerRef.current = null;
            return stillListening;
        };
        
        // Define message handler
        const handleWorkerMessage = async (e: MessageEvent) => {
            if (searchToken.aborted) return;
            const { type, payload } = e.data;
            if (type === 'SEARCH_STARTED' || type === 'SEARCH_PROGRESS') {
                if (payload?.gameId !== capturedGameId) return;
                const now = Date.now();
                const bestPreview = previewMove(payload.bestMove);
                scheduleAiSearchProgress(prev => ({
                    ...prev,
                    active: true,
                    gameId: payload.gameId,
                    turn: payload.turn ?? prev.turn,
                    targetDepth: payload.maxDepth ?? payload.depth ?? prev.targetDepth,
                    completedDepth: payload.completedDepth ?? prev.completedDepth,
                    rootMoves: payload.rootMoves ?? prev.rootMoves,
                    phase: payload.phase ?? type,
                    bestPreview: bestPreview || prev.bestPreview,
                    score: payload.score ?? prev.score,
                    startedAt: type === 'SEARCH_STARTED' ? now : (prev.startedAt ?? now),
                    lastProgressAt: now,
                    lastEvent: type === 'SEARCH_STARTED'
                        ? `STARTED d=${payload.depth}`
                        : `${payload.phase} d=${payload.completedDepth}/${payload.maxDepth ?? '?'}`,
                    depthTimes: payload.phase === 'depth' && (payload.completedDepth | 0) > 0
                        ? appendDepthTime(prev.depthTimes, payload.completedDepth | 0, payload.elapsedMs ?? 0)
                        : prev.depthTimes
                }));
                // 仅关键节点打日志，避免每层 depth 刷屏拖慢 DevTools
                if (type === 'SEARCH_STARTED' || payload.phase === 'root-eval' || payload.phase === 'start') {
                    console.info(`[AI] ${type}`, payload.phase ?? '', payload.completedDepth ?? '');
                }
                return;
            }
            if (type === 'SEARCH_COMPLETE') {
                console.info('[AI] SEARCH_COMPLETE', {
                    gameId: payload?.gameId,
                    expect: capturedGameId,
                    thinkingTime: payload?.thinkingTime,
                    completedDepth: payload?.completedDepth,
                    best: payload?.bestMove
                });
                // COMPLETE 前同步 flush；最后一层 PROGRESS 几乎总是还在 pending
                const prevDbg = flushAiSearchProgress();

                if (searchToken.aborted) return;
                
                if (payload.gameId === capturedGameId) {
                    {
                        const bestPreview = previewMove(payload.bestMove) || prevDbg.bestPreview;
                        const completedDepth = payload.completedDepth ?? prevDbg.completedDepth;
                        const thinkingTime = payload.thinkingTime ?? 0;
                        const depthTimes = completedDepth > 0
                            ? appendDepthTime(prevDbg.depthTimes, completedDepth, thinkingTime)
                            : prevDbg.depthTimes;
                        const completedDebug = {
                            ...prevDbg,
                            active: false,
                            phase: 'complete',
                            completedDepth,
                            bestPreview,
                            lastEvent: `COMPLETE ${thinkingTime}ms`,
                            lastProgressAt: Date.now(),
                            depthTimes
                        };
                        aiSearchDebugRef.current = completedDebug;
                        setAiSearchDebug(completedDebug);
                        setLastSearchBench({
                            thinkingTime,
                            completedDepth,
                            targetDepth: prevDbg.targetDepth || searchDepth,
                            rootMoves: prevDbg.rootMoves,
                            bestPreview,
                            depthTimes
                        });
                    }
                    // 设置隐藏最优着法和次优着法
                    setHiddenBestMove(decodeMove(payload.bestMove));
                    setSuboptimalMove(decodeMove(payload.secondBestMove));
                    
                    const formattedAnalysisMoves = decodeAnalysisMoves(payload.allMovesWithScores);
                    // 对弈路径只保留 best/次优到 React state；全量仍用于本地变招选择
                    // 分析模式（isAnalysisMode）保留全量列表
                    setAnalysisMoves(isAnalysisMode ? formattedAnalysisMoves : formattedAnalysisMoves.slice(0, 2));
                    // 重置选中状态
                    setSelectedAnalysisMove(null);
                    // 重置预览状态
                    setIsPreviewing(false);
                    setOriginalBoardForPreview(null);
                    
                    const bestMove = decodeMove(payload.bestMove);
                    if (!isUsableMove(bestMove)) {
                        detachSearchListener(handleWorkerMessage);
                        let idleFallback: Move | null = null;
                        for (const candidate of excludedRootMoves) {
                            if (!isUsableMove(candidate)) continue;
                            const idle = await checkMoveRepetition(candidate);
                            if (searchToken.aborted) return;
                            if (!idle.violation) {
                                idleFallback = candidate;
                                break;
                            }
                        }
                        if (idleFallback) {
                            console.warn('⚠️ 禁着后无剩余根着，改走闲着', idleFallback);
                            await executeMoveWithDelay(idleFallback, currentTurn, isAutoMode, delay);
                            return;
                        }
                        const winner = currentTurn === 'red' ? 'black' : 'red';
                        handleGameOver('checkmate', winner, 'LONG CHECK!');
                        setIsThinking(false);
                        return;
                    }

                    const repetition = await checkMoveRepetition(bestMove);
                    if (searchToken.aborted) return;
                    if (repetition.violation) {
                        console.log(
                            '⚠️ 最优着违反重复规则，禁着后重新搜索:',
                            bestMove,
                            repetition.type
                        );
                        if (excludedRootMoves.some(move => isSameMove(move, bestMove))) {
                            console.error('❌ 根节点禁着后仍返回同一走法，发起方不变招判负:', bestMove);
                            detachSearchListener(handleWorkerMessage);
                            const winner = currentTurn === 'red' ? 'black' : 'red';
                            handleGameOver(
                                'checkmate',
                                winner,
                                repetition.type === 'chase' ? 'LONG CHASE!' : 'LONG CHECK!'
                            );
                            setIsThinking(false);
                            return;
                        }
                        excludedRootMoves.push(bestMove);
                        setAiSearchDebug(prev => ({
                            ...prev,
                            active: true,
                            phase: 'posted',
                            completedDepth: -2,
                            currentDepth: 0,
                            bestPreview: '',
                            lastEvent: `RESEARCH exclusions=${excludedRootMoves.length}`,
                            lastProgressAt: Date.now()
                        }));
                        if (!postSearch()) {
                            detachSearchListener(handleWorkerMessage);
                            setIsThinking(false);
                        }
                        return;
                    }

                    detachSearchListener(handleWorkerMessage);
                    await executeMoveWithDelay(bestMove, currentTurn, isAutoMode, delay);
                    return;
                } else {
                    detachSearchListener(handleWorkerMessage);
                    console.warn('[AI] SEARCH_COMPLETE gameId mismatch', {
                        got: payload?.gameId,
                        expect: capturedGameId
                    });
                    setAiSearchDebug(prev => ({
                        ...prev,
                        active: false,
                        lastEvent: `COMPLETE ignored gameId ${payload?.gameId}!=${capturedGameId}`,
                        lastProgressAt: Date.now()
                    }));
                    setIsThinking(false);
                }
            }
        };

        const cleanup = () => {
            searchToken.aborted = true;
            const stillListening = detachSearchListener(handleWorkerMessage);
            if (aiSearchProgressTimerRef.current != null) {
                window.clearTimeout(aiSearchProgressTimerRef.current);
                aiSearchProgressTimerRef.current = null;
            }
            aiSearchProgressPendingRef.current = null;
            // 仅中止进行中的搜索时重置 UI，避免 COMPLETE 后 turn 变化误标 aborted
            if (stillListening) {
                setIsThinking(false);
                setAiSearchDebug(prev => ({
                    ...prev,
                    active: false,
                    lastEvent: 'SEARCH aborted',
                    lastProgressAt: Date.now()
                }));
            }
        };
        aiSearchCleanupRef.current = cleanup;

        if (workerRef.current) {
            aiSearchListenerRef.current = handleWorkerMessage;
            workerRef.current.addEventListener('message', handleWorkerMessage);
            postSearch();
        } else {
            setIsThinking(false);
        }

        return cleanup;
    };

    // AI 搜索调试：无进度看门狗（不再每秒刷 UI）
    useEffect(() => {
        if (!isThinking) return;
        const watchId = window.setInterval(() => {
            const dbg = aiSearchDebugRef.current;
            if (!dbg.active || !dbg.postedAt) return;
            const elapsed = Date.now() - dbg.postedAt;
            const sinceProgress = dbg.lastProgressAt ? Date.now() - dbg.lastProgressAt : elapsed;
            if (sinceProgress < 8000) return;
            const snapshot = {
                ...dbg,
                elapsedMs: elapsed,
                sinceProgressMs: sinceProgress,
                isThinking: true,
                turn,
                playDepth,
                hint: sinceProgress >= 8000 && dbg.phase === 'posted'
                    ? '已 post SEARCH 但未收到 SEARCH_STARTED：Worker 可能未跑/被阻塞/监听器丢失'
                    : sinceProgress >= 8000 && (dbg.phase === 'SEARCH_STARTED' || dbg.phase === 'root-eval')
                        ? '卡在开局评估/根着法生成（还没进入迭代加深）'
                        : sinceProgress >= 8000 && dbg.phase === 'start'
                            ? '卡在 depth=1 搜索'
                            : `迭代加深停在 d=${dbg.completedDepth}/${dbg.targetDepth}`
            };
            console.warn('[AI watchdog] no progress >8s', snapshot);
            (window as unknown as { __CHESS_AI_DEBUG__?: unknown }).__CHESS_AI_DEBUG__ = snapshot;
        }, 2000);
        (window as unknown as { __CHESS_AI_DEBUG__?: unknown }).__CHESS_AI_DEBUG__ = () => ({
            ...aiSearchDebugRef.current,
            isThinking: true,
            turn,
            playDepth,
            now: Date.now()
        });
        return () => {
            window.clearInterval(watchId);
        };
    }, [isThinking, turn, playDepth]);

    // AI Turn Logic
    useEffect(() => {
        //console.log('AI Effect triggered:', { turn, playerColor, gameOver, isReplaying, isSetupMode, redIsAuto, blackIsAuto });
        // Check if current player should be controlled by AI
        const shouldAIMove = (turn === 'red' && redIsAuto) || (turn === 'black' && blackIsAuto);
        
        if (shouldAIMove && !gameOver && !isReplaying && !isSetupMode && !isThinking) {
            //console.log('AI should move now!');
            // hasStarted 由 executeMove 设置；勿写入 deps，否则一开搜就会被 cleanup 掐掉
         
            const capturedGameId = gameId;
            const config = DIFFICULTIES[difficulty];
            // 使用用户设置的AI深度，覆盖难度级别的默认深度
            const searchDepth = playDepth;
            console.log('AI config:', { ...config, depth: searchDepth }, 'gameId:', capturedGameId);

            // 调用通用的搜索和执行走法函数，为AI走棋添加0.1秒延迟
            const cleanup = searchAndExecuteMove(board, turn, searchDepth, capturedGameId, config.randomness, moveHistory.length, true, 100);

            return () => {
                cleanup();
                if (aiSearchCleanupRef.current === cleanup) {
                    aiSearchCleanupRef.current = null;
                }
            };
        }

        // 换边/关 Auto/卸载等：若仍挂着旧搜索监听，必须摘掉，避免 COMPLETE 写回新局
        return () => {
            aiSearchCleanupRef.current?.();
            aiSearchCleanupRef.current = null;
        };
    }, [turn, playerColor, gameOver, isReplaying, isSetupMode, difficulty, gameId, redIsAuto, blackIsAuto]);

    const executeMove = async (move: Move, moveTurn?: Color): Promise<boolean> => {
        //console.log('executeMove called with move:', move, 'moveTurn:', moveTurn);
        if (!hasStarted) {
            console.log('executeMove: game not started, setting hasStarted to true');
            setHasStarted(true);
        }
        
        // 第一次移动时启动音乐
        startMusicOnUserGesture();
        
        const currentTurn = moveTurn || turn;
        //console.log('executeMove: currentTurn:', currentTurn, 'turn:', turn);
        
        const movingPiece = board[move.from.r][move.from.c];
        //console.log('executeMove: movingPiece:', movingPiece);
        
        // 检查是否是当前回合的棋子，只有当前回合的棋子才能移动
        if (!movingPiece || movingPiece.color !== currentTurn) {
            console.log('executeMove: not current turn\'s piece, returning');
            return false; // 不是当前回合的棋子，不执行移动
        }
        
        // 移动前评估：优先复用上一手 post（同 hash），否则才 RPC
        const preHash = generatePositionHash(board, turn);
        const cachedPre = cachedBoardEvalRef.current;
        const preMoveEval = (cachedPre && cachedPre.hash === preHash)
            ? { red: cachedPre.red, black: cachedPre.black }
            : await workerGetDetailedEval(board, turn, isReplaying);
        
        const targetPiece = board[move.to.r][move.to.c];
        //console.log('executeMove: targetPiece:', targetPiece);
        
        // 记录是否有吃子，用于后续播放音效
        const hasCapture = !!targetPiece;
        //console.log('executeMove: hasCapture:', hasCapture);
        
        // 根据是否有吃子更新计数器
        if (hasCapture) {
            // 有吃子，重置连续无吃子回合计数器
            setDrawMoveCounter(0);
        } else {
            // 没有吃子，增加连续无吃子回合计数器
            setDrawMoveCounter(prev => prev + 1);
        }
        
        // 显示吃子动画
        if (targetPiece) {
            //console.log('executeMove: showing capture animation');
            const isAlly = targetPiece.color === playerColor;
            const targetX = -160; 
            const targetY = isAlly ? (BOARD_HEIGHT_PX - 60) : 40;

            setFlyingPiece({ 
                piece: targetPiece, 
                from: move.to, 
                target: { x: targetX, y: targetY },
                id: Date.now() 
            });
            setTimeout(() => setFlyingPiece(null), 2000);
        }
        
        // 创建新棋盘状态（在所有路径中都能访问）
        //console.log('executeMove: creating new board state');
        const newBoard = board.map(row => [...row]);
        newBoard[move.to.r][move.to.c] = newBoard[move.from.r][move.from.c];
        newBoard[move.from.r][move.from.c] = null;
        
        // 生成新局面哈希
        const nextTurn = turn === 'red' ? 'black' : 'red';
        const newHash = generatePositionHash(newBoard, nextTurn);
        
        // 注意：以下 await 期间不要 setMoveAnimation/setBoard，否则会出现「动画已开、棋盘未变」的中间帧
        // 将军/捉子各算一次，供重复检测与历史共用
        const isCheck = await isBoardInCheck(newBoard, nextTurn);
        const capturingResult = await isCapturingThreat(board, move, turn);
        
        // 长将/长捉检测已在searchAndExecuteMove函数中完成，这里不再重复检测
        // 只对玩家手动走棋进行检测，且至少有3个历史记录才进行检测
        
        const currentColorIsManual = (turn === 'red' && !redIsAuto) || (turn === 'black' && !blackIsAuto);
        if (turn === playerColor && currentColorIsManual && positionHistory.length >= 4) {
            const repetitionCheck = await checkRepetition(
                newHash, positionHistory, move, board, turn,
                { isCheck, capturingResult }
            );
            
            if (repetitionCheck.violation) {
                console.log('👤 玩家手动走棋违规，判负');
                const violationWinner = turn === 'red' ? 'black' : 'red';
                const warningMessage = repetitionCheck.type === 'check' ? 'LONG CHECK!' : 'LONG CHASE!';
                handleGameOver('checkmate', violationWinner, warningMessage);
                return false; // 不执行这步棋，也不更新历史记录
            }
        }

        const terminal = await workerCheckGameState(newBoard, nextTurn);
        
        // 只有在没有长将/长捉违规的情况下，才更新历史记录
        // boardHistory包含初始局面和每一步移动后的局面，长度为moveHistory.length + 1
        setBoardHistory(prev => [...prev, newBoard]);
        setMoveHistory(prev => [...prev, move]);
        
        const isChase = capturingResult.isThreat;
        const initiator = (isCheck || isChase) ? currentTurn : undefined;
        
        // 更新局面历史
        const updatedPositionHistory = [...positionHistory, { 
            hash: newHash, 
            mover: currentTurn,
            capturedTarget: capturingResult.isThreat ? capturingResult.targetPiece : undefined,
            initiator,
            isCheck,
            isChase
        }];
        setPositionHistory(updatedPositionHistory);

        // 检查局面重复次数
        const hashCount = updatedPositionHistory.filter(h => h.hash === newHash).length;
        if (hashCount >= 4) {
            // 复用上面的 isCheck，避免同一步再次 isBoardInCheck
            const isThreat = capturingResult.isThreat;
            const answeringInitiative = isReplyingToOpponentInitiative(positionHistory, currentTurn);
            
            if (!isCheck && !isThreat && !answeringInitiative) {
                // 双方都是闲着重复：不变作和
                handleGameOver('draw', null, 'REPETITION!');
            } else if (answeringInitiative) {
                console.log('⚠️ 对方长将/长捉循环已满，等待发起方变招；本方闲着不须变招');
            }
        }

        // 检查连续无吃子回合是否达到60回合
        // 每步 +1，双方各走 60 步时计数器为 120
        const newCounter = targetPiece ? 0 : drawMoveCounter + 1;
        if (newCounter >= 120) {
            handleGameOver('draw', null, 'NO CAPTURE!');
        }
        
        // Increment step count for the player who just moved
        if (currentTurn === 'red') {
            setRedStepCount(prev => prev + 1);
        } else {
            setBlackStepCount(prev => prev + 1);
        }
        
        // 动画与棋盘同一同步段更新，避免 await 拆批导致瞬移/回弹
        setSelectedPos(null);
        setValidMoves([]);
        setPieceRelations(emptyPieceRelations);
        setSelectedPieceEval(null);
        setMoveAnimation({
            from: move.from,
            to: move.to,
            id: Date.now(),
            piece: movingPiece
        });
        setBoard(newBoard);
        setTurn(nextTurn);
        if (animationTimeoutRef.current) {
            clearTimeout(animationTimeoutRef.current);
        }
        const evalGen = ++moveEvalGenRef.current;
        moveAnimActiveRef.current = true;
        pendingMoveEvalRef.current = null;
        animationTimeoutRef.current = setTimeout(() => {
            if (hasCapture) {
                playCaptureSound();
            } else {
                playMoveSound();
            }
            setMoveAnimation(null);
            moveAnimActiveRef.current = false;
            if (pendingMoveEvalRef.current) {
                setMoveEvaluation(pendingMoveEvalRef.current);
                pendingMoveEvalRef.current = null;
            }
        }, 300);
        
        // 在棋盘状态更新后设置最近被吃的棋子
        // 使用setTimeout确保在下次渲染后执行，此时capturedInfo已经更新
        if (targetPiece) {
            setTimeout(() => {
                setRecentlyCaptured({ color: targetPiece.color, type: targetPiece.type });
                // 4秒后清除最近被吃的棋子标记，与旋转动画时长匹配
                setTimeout(() => setRecentlyCaptured(null), 4000);
            }, 0);
        };
        // 走子后立刻根据已算好的将军结果更新提示（将/帅闪动）
        setCheckAlert(isCheck);
        if (isCheck) playCheckSound();
        if (terminal.status !== 'playing') armPendingGameOver(terminal);
        else clearPendingGameOver();
        setHintMove(null);
        setSelectedPieceEval(null);
        setAnalysisBestMove(null);
        setAnalysisSecondBestMove(null);
        
        // 本步只算 post；结果写入缓存供下一手作 pre
        const postMoveEval = await workerGetDetailedEval(newBoard, nextTurn, isReplaying);
        cachedBoardEvalRef.current = {
            hash: newHash,
            red: postMoveEval.red,
            black: postMoveEval.black
        };
        
        // 计算红方分数变化
        const redDiff = {
            total: postMoveEval.red.total - preMoveEval.red.total,
            material: postMoveEval.red.material - preMoveEval.red.material,
            position: postMoveEval.red.position - preMoveEval.red.position,
            safety: postMoveEval.red.safety - preMoveEval.red.safety,
            mobility: postMoveEval.red.mobility - preMoveEval.red.mobility,
            threat: postMoveEval.red.threat - preMoveEval.red.threat
        };
        
        // 计算黑方分数变化
        const blackDiff = {
            total: postMoveEval.black.total - preMoveEval.black.total,
            material: postMoveEval.black.material - preMoveEval.black.material,
            position: postMoveEval.black.position - preMoveEval.black.position,
            safety: postMoveEval.black.safety - preMoveEval.black.safety,
            mobility: postMoveEval.black.mobility - preMoveEval.black.mobility,
            threat: postMoveEval.black.threat - preMoveEval.black.threat
        };
        
        // 存储评估结果到状态变量，包含双方完整分数
        const evaluationData = {
            pre: {
                red: preMoveEval.red,
                black: preMoveEval.black
            },
            post: {
                red: postMoveEval.red,
                black: postMoveEval.black
            },
            diff: {
                red: redDiff,
                black: blackDiff
            }
        };
        if (evalGen !== moveEvalGenRef.current) {
            return true;
        }
        if (moveAnimActiveRef.current) {
            pendingMoveEvalRef.current = evaluationData;
        } else {
            setMoveEvaluation(evaluationData);
        }
        /*
        // 打印走棋评估结果
        console.log('=== 走棋评估结果 ===');
        console.log(`红方移动前总评: ${preMoveEval.red.total.toFixed(2)}`);
        console.log(`红方移动后总评: ${postMoveEval.red.total.toFixed(2)}`);
        console.log(`红方总分变化: ${redDiff.total.toFixed(2)}`);
        console.log('红方详细维度变化:');
        console.log(`- 子力(material): ${redDiff.material.toFixed(2)}`);
        console.log(`- 位置(position): ${redDiff.position.toFixed(2)}`);
        console.log(`- 机动性(mobility): ${redDiff.mobility.toFixed(2)}`);
        console.log(`- 安全(safety): ${redDiff.safety.toFixed(2)}`);
        console.log(`- 威胁(threat): ${redDiff.threat.toFixed(2)}`);
        console.log('');
        console.log(`黑方移动前总评: ${preMoveEval.black.total.toFixed(2)}`);
        console.log(`黑方移动后总评: ${postMoveEval.black.total.toFixed(2)}`);
        console.log(`黑方总分变化: ${blackDiff.total.toFixed(2)}`);
        console.log('黑方详细维度变化:');
        console.log(`- 子力(material): ${blackDiff.material.toFixed(2)}`);
        console.log(`- 位置(position): ${blackDiff.position.toFixed(2)}`);
        console.log(`- 机动性(mobility): ${blackDiff.mobility.toFixed(2)}`);        
        console.log(`- 安全(safety): ${blackDiff.safety.toFixed(2)}`);
        console.log(`- 威胁(threat): ${blackDiff.threat.toFixed(2)}`);
        console.log('==================');
        */
        // 为了用户能更直观地看到，我们可以考虑在界面上显示这些信息
        // 例如，可以在聊天区域或专用的评估面板中展示
        
        // Try feature removed: always advance turn
        return true;
    };
    executeMoveRef.current = executeMove;

    const handlePieceSelect = useCallback((pos: Position) => {
        if (selectedPos?.r === pos.r && selectedPos?.c === pos.c) {
            selectInspectIdRef.current += 1;
            if (selectInspectTimerRef.current) {
                clearTimeout(selectInspectTimerRef.current);
                selectInspectTimerRef.current = null;
            }
            setSelectedPos(null);
            setValidMoves([]);
            setPieceRelations(emptyPieceRelations);
            setSelectedPieceEval(null);
            return;
        }

        const currentBoard = isReplaying ? (boardHistory[replayIndex] || board) : board;
        const piece = currentBoard[pos.r][pos.c];
        const currentTurn = isSetupMode
            ? turn
            : (isReplaying ? (replayIndex % 2 === 0 ? 'red' : 'black') : turn);

        let needMoves = false;
        if (piece && !isSetupMode) {
            const isMyTurn = currentTurn === piece.color;
            const canControlPiece = !onlineInfo || piece.color === onlineInfo.myColor;
            needMoves = isMyTurn && canControlPiece;
        }

        const requestId = String(++selectInspectIdRef.current);

        // 先同步更新选中态，高亮立刻出现
        setSelectedPos(pos);
        setValidMoves([]);
        setPieceRelations(emptyPieceRelations);
        setSelectedPieceEval(null);

        // 合法着法优先：轻量消息，不跑 evaluateBoard
        if (needMoves) {
            workerGetValidMoves(currentBoard, pos, `moves-${requestId}`)
                .then((moves) => {
                    if (String(selectInspectIdRef.current) !== requestId) return;
                    setValidMoves(moves);
                })
                .catch(() => {
                    if (String(selectInspectIdRef.current) !== requestId) return;
                    setValidMoves([]);
                });
        }

        // 关系/单子评估：立即走 forUiInspect（不再防抖、不用 startTransition，避免手机上 defer 感很强）
        if (selectInspectTimerRef.current) {
            clearTimeout(selectInspectTimerRef.current);
            selectInspectTimerRef.current = null;
        }
        workerInspectSquare(currentBoard, pos, piece ? currentTurn : null, false, requestId)
            .then((result) => {
                if (String(selectInspectIdRef.current) !== requestId) return;
                setPieceRelations(result.relations || emptyPieceRelations);
                setSelectedPieceEval(piece ? (result.evaluation || null) : null);
            })
            .catch(() => {
                if (String(selectInspectIdRef.current) !== requestId) return;
                setPieceRelations(emptyPieceRelations);
                setSelectedPieceEval(null);
            });
    }, [selectedPos, isReplaying, boardHistory, replayIndex, board, isSetupMode, turn, onlineInfo]);

    const handleMove = useCallback(async (to: Position) => {
        //console.log('handleMove called with to:', to);
        //console.log('handleMove: selectedPos:', selectedPos, 'isThinking:', isThinking);
        
        if (!selectedPos) {
            console.log('handleMove: no selectedPos, returning');
            return;
        }

        // 联机：只能走己方棋子、且轮到己方
        if (onlineInfo) {
            if (turn !== onlineInfo.myColor) return;
            const piece = board[selectedPos.r][selectedPos.c];
            if (!piece || piece.color !== onlineInfo.myColor) return;
        }
        
        // 检查移动是否在有效移动列表中
        const isValidMove = validMoves.some(move => 
            move.r === to.r && move.c === to.c
        );
        //console.log('handleMove: validMoves:', validMoves, 'isValidMove:', isValidMove);
        
        if (isValidMove) {
            //console.log('handleMove: valid move, executing');
            // 手动走棋时强制设置isThinking为false，确保移动能够执行
            setIsThinking(false);
            const from = selectedPos;
            const ply = moveHistory.length;
            const moveTurn = turn;
            const applied = await executeMoveRef.current({ from, to }, moveTurn);
            if (applied && onlineInfo && !applyingRemoteRef.current) {
                peerSessionRef.current?.send({ type: 'move', from, to, ply });
            }
        } else {
            console.log('handleMove: invalid move, not executing');
        }
    }, [selectedPos, onlineInfo, turn, board, validMoves, moveHistory]);

    const clearRoomQuery = () => {
        const url = new URL(window.location.href);
        if (url.searchParams.has('room')) {
            url.searchParams.delete('room');
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        }
    };

    const setRoomQuery = (code: string) => {
        const url = new URL(window.location.href);
        url.searchParams.set('room', code);
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    };

    const destroyPeerSession = () => {
        peerSessionRef.current?.destroy();
        peerSessionRef.current = null;
    };

    const applyRemoteMove = async (from: Position, to: Position, ply: number) => {
        const info = onlineInfoRef.current;
        if (!info) return;
        if (ply !== moveHistorySnapshotRef.current.length) {
            console.warn('联机着法 ply 不匹配，已忽略', { ply, expected: moveHistorySnapshotRef.current.length });
            return;
        }
        const currentTurn = turnRef.current;
        if (currentTurn === info.myColor) {
            console.warn('联机着法：当前是己方回合，忽略对方消息');
            return;
        }
        const currentBoard = boardSnapshotRef.current;
        const piece = currentBoard[from.r]?.[from.c];
        if (!piece || piece.color !== currentTurn) return;

        let legal: Position[] = [];
        try {
            legal = await workerGetValidMoves(currentBoard, from);
        } catch {
            return;
        }
        if (!legal.some((m) => m.r === to.r && m.c === to.c)) {
            console.warn('联机着法非法，已忽略', { from, to });
            return;
        }

        applyingRemoteRef.current = true;
        try {
            await executeMoveRef.current({ from, to }, currentTurn);
        } finally {
            applyingRemoteRef.current = false;
        }
    };

    const handleNetMessage = (msg: NetMessage) => {
        if (msg.type === 'hello') {
            setOnlineInfo((prev) => {
                const next = prev ? { ...prev, peerNick: msg.nick } : prev;
                onlineInfoRef.current = next;
                return next;
            });
            peerSessionRef.current?.send({ type: 'ready' });
            setConnectionStatus('connected');
            setLobbyStatusMessage(null);
            ensureWorker();
            setAppScreen('game');
            setHasStarted(true);
            return;
        }
        if (msg.type === 'ready') {
            setConnectionStatus('connected');
            setLobbyStatusMessage(null);
            ensureWorker();
            setAppScreen('game');
            setHasStarted(true);
            return;
        }
        if (msg.type === 'move') {
            void applyRemoteMove(msg.from, msg.to, msg.ply);
            return;
        }
        if (msg.type === 'resign') {
            const info = onlineInfoRef.current;
            if (!info) return;
            handleGameOver('checkmate', info.myColor, 'RESIGNED!');
        }
    };
    onNetMessageRef.current = handleNetMessage;

    const leaveToLobby = (message?: string) => {
        destroyPeerSession();
        setOnlineInfo(null);
        onlineInfoRef.current = null;
        setConnectionStatus('idle');
        setLobbyStatusMessage(message ?? null);
        setAppScreen('lobby');
        clearRoomQuery();
        applyingRemoteRef.current = false;
        // The lobby must not retain the engine's large TT/eval buffers.
        terminateWorker();
        resetGameStateRef.current();
    };

    const prepareFreshGame = (mode: 'ai' | 'local' | 'online') => {
        // Entering from the lobby creates one worker. Do not recreate an
        // already-fresh worker and temporarily overlap two large backing stores.
        if (mode !== 'online') ensureWorker();
        resetGameStateRef.current();
        if (mode === 'ai') {
            setRedIsAuto(false);
            setBlackIsAuto(true);
            setPlayerColor('red');
        } else if (mode === 'local') {
            setRedIsAuto(false);
            setBlackIsAuto(false);
            setPlayerColor('red');
        } else {
            setRedIsAuto(false);
            setBlackIsAuto(false);
        }
        setActiveTab('game');
        setIsReplaying(false);
        setIsSetupMode(false);
    };

    const handleStartLocal = (mode: LocalPlayMode) => {
        destroyPeerSession();
        setOnlineInfo(null);
        onlineInfoRef.current = null;
        setConnectionStatus('idle');
        setLobbyStatusMessage(null);
        clearRoomQuery();
        prepareFreshGame(mode);
        setAppScreen('game');
    };

    const startOnlineSession = async (role: 'host' | 'guest', nick: string, roomCode: string) => {
        destroyPeerSession();
        prepareFreshGame('online');
        const myColor: Color = role === 'host' ? 'red' : 'black';
        const info: OnlineSessionInfo = {
            roomCode,
            role,
            myColor,
            myNick: nick,
            peerNick: null,
        };
        setOnlineInfo(info);
        onlineInfoRef.current = info;
        setPlayerColor(myColor);
        setAppScreen('waiting');
        setConnectionStatus('connecting');
        setLobbyStatusMessage(null);
        setRoomQuery(roomCode);

        let joinTimer: ReturnType<typeof setTimeout> | null = null;
        const { PeerSession } = await import('./net/PeerSession');
        const session = new PeerSession(roomCode, role, {
            onOpen: () => {
                setConnectionStatus(role === 'host' ? 'waiting' : 'connecting');
            },
            onConnected: () => {
                if (joinTimer) clearTimeout(joinTimer);
                setConnectionStatus('connected');
                session.send({ type: 'hello', nick, color: myColor });
            },
            onDisconnected: (reason) => {
                if (joinTimer) clearTimeout(joinTimer);
                leaveToLobby(reason || 'Disconnected');
            },
            onError: (message) => {
                if (joinTimer) clearTimeout(joinTimer);
                leaveToLobby(message);
            },
            onMessage: (msg) => onNetMessageRef.current(msg),
        });
        peerSessionRef.current = session;

        try {
            await session.start();
            if (role === 'host') {
                setConnectionStatus('waiting');
            } else {
                // TURN 候选收集较慢；跨网失败时给出明确提示
                joinTimer = setTimeout(() => {
                    if (!session.isConnected) {
                        leaveToLobby(
                            'Join timed out. Check the room code; if not on the same Wi‑Fi (especially mobile data), P2P may be blocked — retry on the same LAN.',
                        );
                    }
                }, 35000);
            }
        } catch (err) {
            if (joinTimer) clearTimeout(joinTimer);
            const message = err instanceof Error ? err.message : 'Could not start online session';
            leaveToLobby(message);
        }
    };

    const handleCreateRoom = (nick: string) => {
        void startOnlineSession('host', nick, generateRoomCode());
    };

    const handleJoinRoom = (nick: string, roomCode: string) => {
        const code = roomCode.trim().toLowerCase();
        if (code.length < 4) {
            setLobbyStatusMessage('Please enter a valid room code');
            return;
        }
        void startOnlineSession('guest', nick, code);
    };

    const handleCopyRoomLink = async () => {
        const code = onlineInfo?.roomCode;
        if (!code) return;
        const url = new URL(window.location.href);
        url.searchParams.set('room', code);
        try {
            await navigator.clipboard.writeText(url.toString());
        } catch {
            // fallback
            window.prompt('Copy invite link', url.toString());
        }
    };

    // Resign UI removed; network "resign" messages still handled elsewhere

    useEffect(() => {
        return () => {
            destroyPeerSession();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const resetGameState = () => {
        // 清除游戏结束定时器
        if (gameOverTimerRef.current) {
            clearTimeout(gameOverTimerRef.current);
            gameOverTimerRef.current = null;
        }
        setPendingGameOver(null);
        if (selectInspectTimerRef.current) {
            clearTimeout(selectInspectTimerRef.current);
            selectInspectTimerRef.current = null;
        }
        selectInspectIdRef.current += 1;
        
        const initialBoard = createInitialBoard();
        setBoard(initialBoard);
        setTurn('red');
        setRedIsAuto(false);
        setBlackIsAuto(true); // 恢复黑方默认 AI
        setRedStepCount(0);
        setBlackStepCount(0);
        setPlayerColor('red');
        setGameOver(null);
        setBoardHistory([initialBoard]);
        setMoveHistory([]);
        
        // 清理所有指示器与动画残留
        setSelectedPos(null);
        setValidMoves([]);
        setPieceRelations(emptyPieceRelations);
        setSelectedPieceEval(null);
        setCheckAlert(false);
        setHintMove(null);
        setIsReplaying(false);
        setReplayIndex(0);
        setReplayNotation([]);
        setFlyingPiece(null);
        setMoveAnimation(null);
        setRecentlyCaptured(null);
        setHiddenBestMove(null);
        setSuboptimalMove(null);
        setAnalysisBestMove(null);
        setAnalysisSecondBestMove(null);
        setIsSetupMode(false);
        setRedTime(0);
        setBlackTime(0);
        setHasStarted(false);
        setIsThinking(false);
        setGameId(prev => prev + 1);
        // 重置连续无吃子回合计数器
        setDrawMoveCounter(0);
        
        // 清除重复检测
        setPositionHistory([]);
        setRepetitionWarning(null);

        // 清理分析 / Try / 搜索面板残留（结算 Rematch 与 Restart 共用）
        setIsAnalysisMode(false);
        setIsAnalyzing(false);
        setAnalysisMoves([]);
        setSelectedAnalysisMove(null);
        setIsPreviewing(false);
        setOriginalBoardForPreview(null);
        setLastSearchBench(null);
        setActiveTab('game');
        
        // 重置moveEvaluation为所有0的对象，确保Restart后显示EVALUATION UI
        setMoveEvaluation({
            pre: {
                red: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 },
                black: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 }
            },
            post: {
                red: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 },
                black: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 }
            },
            diff: {
                red: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 },
                black: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 }
            }
        });
        cachedBoardEvalRef.current = null;
        
        // 随机选择新的棋盘和棋子
        const skins: Skin[] = ['stone-board', 'wood-board', 'paper-board', 'glass-board'];
        const materials: PieceMaterial[] = ['wood', 'stone', 'metal', 'glass'];
        setSkin(skins[Math.floor(Math.random() * skins.length)]);
        setMaterial(materials[Math.floor(Math.random() * materials.length)]);

        // 换一套 BGM 变体（尽量不与当前相同）
        setMusicVariant((prev) => {
            const count = MUSIC_VARIANTS.length;
            if (count <= 1) return 0;
            let next = Math.floor(Math.random() * (count - 1));
            if (next >= prev) next += 1;
            return next;
        });
    };
    resetGameStateRef.current = resetGameState;

    const handleRestart = () => {
        // Restart inside an active game intentionally drops all search state.
        recreateWorker();
        resetGameState();
    };
    const handleSwitchSide = () => {
        setPlayerColor(prev => prev === 'red' ? 'black' : 'red');
        setSelectedPos(null);
        setValidMoves([]);
        setHintMove(null);
        setSelectedPieceEval(null);
    };

    const handleUndo = async () => {
        if (isThinking) return;

        // 检查是否有足够的历史记录可以悔棋
        if (boardHistory.length < 2) return;

        // 清除游戏结束定时器
        if (gameOverTimerRef.current) {
            clearTimeout(gameOverTimerRef.current);
            gameOverTimerRef.current = null;
        }
        setPendingGameOver(null);

        const newBoardHistory = [...boardHistory];
        const newMoveHistory = [...moveHistory];
        let prevBoard;

        // 检查是否有Manual方
        const hasManualPlayer = !redIsAuto || !blackIsAuto;
        
        if (hasManualPlayer) {
            // 回退到上一次Manual方操作前的状态
            // 从最近的历史记录开始查找
            let manualMoveIndex = -1;
            
            // 从最新的move开始往前查找，找到最近的Manual方操作
            for (let i = newMoveHistory.length - 1; i >= 0; i--) {
                const moveColor = i % 2 === 0 ? 'red' : 'black';
                
                // 检查当前move是否是Manual方的操作
                const isManualMove = (moveColor === 'red' && !redIsAuto) || (moveColor === 'black' && !blackIsAuto);
                
                if (isManualMove) {
                    manualMoveIndex = i;
                    break;
                }
            }
            
            // 如果找到Manual方的操作，回退到该操作之前的状态
            if (manualMoveIndex >= 0) {
                // 计算需要回退的步数
                const stepsToUndo = newMoveHistory.length - manualMoveIndex;
                
                // 确保有足够的历史记录可以回退
                if (newBoardHistory.length < stepsToUndo + 1) return;
                
                // 回退棋盘历史到Manual方操作前的状态
                for (let i = 0; i < stepsToUndo; i++) {
                    newBoardHistory.pop();
                }
                prevBoard = newBoardHistory[newBoardHistory.length - 1];
                
                // 回退移动历史到Manual方操作前的状态
                for (let i = 0; i < stepsToUndo; i++) {
                    newMoveHistory.pop();
                }
            } else {
                // 没有找到Manual方的操作，回退1步
                prevBoard = newBoardHistory.pop();
                newMoveHistory.pop();
            }
        } else {
            // 双Auto模式，回退1步
            prevBoard = newBoardHistory.pop();
            newMoveHistory.pop();
        }

        if (prevBoard) {
            setBoard(prevBoard);
            setBoardHistory(newBoardHistory);
            setMoveHistory(newMoveHistory);
            
            // 更新回合：根据剩余的移动历史数量确定
            const newTurn = newMoveHistory.length % 2 === 0 ? 'red' : 'black';
            setTurn(newTurn);
            
            // 恢复正确的步数计数器
            // 计算新的步数：红方和黑方的步数等于移动历史中相应颜色的步数
            const newRedStepCount = Math.floor((newMoveHistory.length + 1) / 2);
            const newBlackStepCount = Math.floor(newMoveHistory.length / 2);
            setRedStepCount(newRedStepCount);
            setBlackStepCount(newBlackStepCount);
            
            setGameOver(null);
            const checkState = await workerIsCheck(prevBoard, newTurn);
            setCheckAlert(checkState);
            setHintMove(null);
            // 悔棋后面目变化，丢弃评估缓存以免下一步误用
            cachedBoardEvalRef.current = null;
            
            // 清理所有指示器
            setSelectedPos(null);
            setValidMoves([]);
            setPieceRelations(emptyPieceRelations);
            setSelectedPieceEval(null);
            setHiddenBestMove(null);
            setSuboptimalMove(null);
            setAnalysisBestMove(null);
            setAnalysisSecondBestMove(null);
        }
    };

    // handleAuto function is now replaced with direct setRedIsAuto and setBlackIsAuto calls in the UI
    // The auto mode is now controlled per-color, so this function is no longer needed

    const enterSetupMode = () => {
        setIsSetupMode(true);
        setIsReplaying(false);
        setGameOver({ status: 'setup' });
        setBoard(createEmptyBoard());
        setSetupSupply(JSON.parse(JSON.stringify(INITIAL_SUPPLY))); 
        setBoardHistory([]);
        setMoveHistory([]);
        setRedTime(0);
        setBlackTime(0);
        setHasStarted(false);
        setIsThinking(false);
        setGameId(prev => prev + 1);
        // 重置连续无吃子回合计数器
        setDrawMoveCounter(0);
        
        // 随机选择棋盘皮肤
        const skins: Skin[] = ['stone-board', 'wood-board', 'paper-board', 'glass-board'];
        setSkin(skins[Math.floor(Math.random() * skins.length)]);
        
        // 随机选择棋子材质
        const materials: PieceMaterial[] = ['wood', 'stone', 'metal', 'glass'];
        setMaterial(materials[Math.floor(Math.random() * materials.length)]);
        
        // 重置所有相关状态变量
        setRedIsAuto(false);
        setBlackIsAuto(false);
        setPositionHistory([]);
        setHintMove(null);
        setCheckAlert(false);
        setRecentlyCaptured(null);
        setHiddenBestMove(null);
        setSuboptimalMove(null);
        setAnalysisBestMove(null);
        setAnalysisSecondBestMove(null);
        setRepetitionWarning(null);
        setSelectedPos(null);
        setValidMoves([]);
        setPieceRelations({ threat: [], threatenedBy: [], guard: [], guardedBy: [] });
        setSelectedPieceEval(null);
        setRedStepCount(0);
        setBlackStepCount(0);
        setTurn('red');
        setPlayerColor('red');
    };

    const exitSetupMode = async (checkGenerals: boolean = true) => {
        if (checkGenerals) {
            let redG = false, blackG = false;
            board.forEach(row => row.forEach(p => {
                if (p?.type === 'general') {
                    if (p.color === 'red') redG = true;
                    else blackG = true;
                }
            }));

            if (!redG || !blackG) {
                alert("Both sides must have a General.");
                return;
            }
            const checkState = await workerIsCheck(board, 'black');
            if (checkState) {
                alert("Black General cannot start in Check.");
                return;
            }
        }

        setIsSetupMode(false);
        setGameOver(null);
        setTurn('red'); 
        setBoardHistory([board]);
        setMoveHistory([]);
        setHasStarted(false);
        setGameId(prev => prev + 1);
    };

    // 保存棋局到文件
    const saveGame = () => {
        // 创建统一格式的棋谱数据，包含初始局面但没有棋谱
        // 对于单纯的局面文件，notation为空字符串
        const gameData = {
            notation: '', // 空棋谱，表示只有初始局面
            initialBoard: boardToCompactFormat(board), // 使用紧凑格式保存初始局面
            skin: skin,
            material: material,
            timestamp: new Date().toISOString(),
            type: 'endgame' // 标记为残局
        };
        
        // 将棋局数据转换为JSON字符串，自定义格式确保initialBoard为10行9列
        let jsonData: string;
        if (gameData.initialBoard && Array.isArray(gameData.initialBoard)) {
            // 复制游戏数据，避免修改原始对象
            const gameDataCopy = { ...gameData };
            // 自定义序列化initialBoard，确保每行占一行
            const initialBoardStr = JSON.stringify(gameDataCopy.initialBoard).replace(/\],\[/g, '],\n          [');
            // 手动构建JSON字符串，确保initialBoard格式正确
            const otherProps = Object.entries(gameDataCopy)
                .filter(([key]) => key !== 'initialBoard')
                .map(([key, value]) => `  "${key}": ${JSON.stringify(value)}`)
                .join(',\n');
            jsonData = `{
${otherProps}${otherProps ? ',\n' : ''}  "initialBoard": ${initialBoardStr}
}`;
        } else {
            // 普通序列化
            jsonData = JSON.stringify(gameData, null, 2);
        }
        
        // 创建Blob对象
        const blob = new Blob([jsonData], { type: 'application/json' });
        
        // 创建下载链接
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chinese-chess-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        
        // 触发下载
        document.body.appendChild(a);
        a.click();
        
        // 清理
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // 从文件加载棋局（支持统一格式）
    const loadGame = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const jsonData = event.target?.result as string;
                const gameData = JSON.parse(jsonData);
                
                let finalBoard: Board;
                
                // 处理统一格式文件
                if (gameData.initialBoard || gameData.notation) {
                    // 统一格式：包含初始局面或棋谱
                    let startBoard: Board;
                    
                    // 确定初始局面
                    if (gameData.initialBoard) {
                        // 检查是否是紧凑格式（二维数字数组）
                        if (Array.isArray(gameData.initialBoard) && 
                            gameData.initialBoard.length === ROWS && 
                            gameData.initialBoard.every(row => Array.isArray(row) && row.length === COLS && row.every(item => typeof item === 'number'))) {
                            // 是紧凑格式，转换为标准棋盘格式
                            startBoard = compactFormatToBoard(gameData.initialBoard as CompactBoard);
                        } else {
                            // 是传统格式，直接使用
                            startBoard = gameData.initialBoard as Board;
                        }
                    } else {
                        startBoard = createInitialBoard();
                    }
                    
                    // Setup模式只使用初始局面，不解析棋谱
                    // 根据用户要求：Setup模式可以打开棋谱文件，但是只要解析局面即可，不用解析棋谱
                    finalBoard = startBoard;
                } else if (gameData.board) {
                    // 旧格式：直接使用board字段
                    if (!Array.isArray(gameData.board) || gameData.board.length !== 10) {
                        throw new Error('Invalid board data format');
                    }
                    finalBoard = gameData.board;
                } else {
                    throw new Error('Invalid file format: no board or notation found');
                }
                
                // 更新棋盘状态和相关设置
                setBoard(finalBoard);
                if (gameData.skin) {
                    setSkin(gameData.skin);
                }
                if (gameData.material) {
                    setMaterial(gameData.material);
                }
                
                // 重新计算棋子供应
                const supply = JSON.parse(JSON.stringify(INITIAL_SUPPLY));
                finalBoard.forEach(row => {
                    row.forEach(piece => {
                        if (piece) {
                            supply[piece.color][piece.type]--;
                        }
                    });
                });
                setSetupSupply(supply);
                
                alert('Position loaded successfully!');
            } catch (error) {
                console.error('Failed to load game:', error);
                alert('Failed to load position. Check the file format.');
            }
        };
        reader.readAsText(file);
        
        // 重置文件输入，以便可以重新选择同一文件
        e.target.value = '';
    };

    const handleDragStart = useCallback((e: React.DragEvent, data: any) => {
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', JSON.stringify(data));
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleDropOnBoard = useCallback(async (e: React.DragEvent, toPos: Position) => {
        e.preventDefault();
        const dataStr = e.dataTransfer.getData('text/plain');
        if (!dataStr) return;
        
        let data;
        try { data = JSON.parse(dataStr); } catch (e) { return; }
        
        const newBoard = board.map(row => [...row]);
        const newSupply = JSON.parse(JSON.stringify(setupSupply));

        if (data.r !== undefined) { 
            const fromPos = data as Position;
            const piece = newBoard[fromPos.r][fromPos.c];
            if (!piece) return;
            if (!(await workerIsValidPlacement(piece.type, piece.color, toPos.r, toPos.c))) return;
            const existing = newBoard[toPos.r][toPos.c];
            if (existing) newSupply[existing.color][existing.type]++;
            newBoard[toPos.r][toPos.c] = piece;
            newBoard[fromPos.r][fromPos.c] = null;
        } else { 
            const { type, color } = data as Piece;
            if (newSupply[color][type] <= 0) return;
            if (!(await workerIsValidPlacement(type, color, toPos.r, toPos.c))) return;
            const existing = newBoard[toPos.r][toPos.c];
            if (existing) newSupply[existing.color][existing.type]++;
            newBoard[toPos.r][toPos.c] = { type, color };
            newSupply[color][type]--;
        }
        setBoard(newBoard);
        setSetupSupply(newSupply);
        playMoveSound();
    }, [board, setupSupply]);
    
    // 处理棋盘上的右键点击事件，用于在Setup模式下将棋子放回Capture Panel
    const handleRightClickOnBoard = useCallback((pos: Position) => {
        if (!isSetupMode) return;
        
        const newBoard = board.map(row => [...row]);
        const piece = newBoard[pos.r][pos.c];
        if (!piece) return;
        
        // 更新供应，增加该棋子的数量
        const newSupply = JSON.parse(JSON.stringify(setupSupply));
        newSupply[piece.color][piece.type]++;
        
        // 从棋盘中移除该棋子
        newBoard[pos.r][pos.c] = null;
        
        setBoard(newBoard);
        setSetupSupply(newSupply);
        playMoveSound();
    }, [isSetupMode, board, setupSupply]);

    const handleDropOnPanel = (e: React.DragEvent, panelColor: Color) => {
        e.preventDefault();
        const dataStr = e.dataTransfer.getData('text/plain');
        if (!dataStr) return;
        let data;
        try { data = JSON.parse(dataStr); } catch (e) { return; }

        if (data.r !== undefined) {
            // 不允许从棋盘拖放回面板
            return;
        }
        
        if (data.type && data.color) {
            const { type, color } = data;
            if (color !== panelColor) return;
            
            const newSupply = JSON.parse(JSON.stringify(setupSupply));
            
            // 检查是否有足够的棋子可以放置
            if (newSupply[color][type] <= 0) return;
            
            // 移除一个棋子
            newSupply[color][type]--;
            setSetupSupply(newSupply);
        }
    };

    // Handle loading opening book from file
    const handleLoadOpeningBook = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const content = event.target?.result as string;
                if (!content) return;

                // Parse the content - assuming each line is a space-separated move string
                const lines = content.trim().split('\n');
                const customLines = lines.filter(line => {
                    const trimmedLine = line.trim();
                    return trimmedLine && !trimmedLine.startsWith('#');
                });
                customOpeningLinesRef.current.push(...customLines);
                
                // Send each line to the worker to add to the opening book
                lines.forEach((line) => {
                    const trimmedLine = line.trim();
                    if (trimmedLine && !trimmedLine.startsWith('#')) {
                        // Send the move string to the worker
                        if (workerRef.current) {
                            workerRef.current.postMessage({
                                type: 'addOpeningLineFromString',
                                payload: {
                                    moves: trimmedLine,
                                    // Use default weights similar to the hardcoded ones
                                    weights: [85, 85, 95, 90, 90, 85, 85, 80, 85, 85, 85, 85]
                                }
                            });
                        }
                    }
                });

                alert(`Successfully loaded ${lines.length} opening lines from the file.`);
            } catch (error) {
                console.error('Error loading opening book:', error);
                alert('Failed to load opening book. Please check the file format.');
            }
        };

        reader.onerror = () => {
            console.error('Error reading file');
            alert('Failed to read the file.');
        };

        reader.readAsText(file);
        
        // Reset the input to allow selecting the same file again
        e.target.value = '';
    };

    // 确保allReplayBoards包含初始状态和所有移动后的状态
    const allReplayBoards = useMemo(() => {
        // 直接使用boardHistory，它已经包含了初始局面和所有移动后的状态
        if (boardHistory.length === 0) {
            // 当boardHistory为空时，返回当前棋盘作为初始局面，而不是默认的初始棋盘
            // 这样可以确保加载Setup保存的局面时，allReplayBoards包含正确的初始局面
            return [board];
        }
        // boardHistory已经包含了初始状态和所有移动后的状态，直接返回即可
        return boardHistory;
    }, [boardHistory, board]);

    const showReplayCheck = async (index: number) => {
        const replayBoard = allReplayBoards[index] || createInitialBoard();
        const replayTurn: Color = index % 2 === 0 ? 'red' : 'black';
        const inCheck = await workerIsCheck(replayBoard, replayTurn);
        setCheckAlert(inCheck);
        if (inCheck) playCheckSound();
    };

    const jumpReplay = (index: number) => {
        const last = Math.max(0, allReplayBoards.length - 1);
        const next = Math.max(0, Math.min(index, last));
        setReplayIndex(next);
        void showReplayCheck(next);
    };

    // Replay Evaluation Logic
    const [replayEvaluation, setReplayEvaluation] = useState<MoveEvaluation>({
        pre: {
            red: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 }
        },
        post: {
            red: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 }
        },
        diff: {
            red: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, safety: 0, mobility: 0, threat: 0 }
        }
    });

    // 更新Replay评估分数
    const updateReplayEvaluation = async () => {
        if (!isReplaying) {
            return;
        }

        try {
            // 获取当前回合和颜色
            const currentTurn: Color = replayIndex % 2 === 0 ? 'red' : 'black';

            // 获取当前棋盘状态
            const currentBoard = allReplayBoards[replayIndex];
            
            // 计算当前局面的评估分数
            const currentEval = await workerGetDetailedEval(currentBoard, currentTurn, isReplaying);
            
            let preEvalRed, preEvalBlack;
            let postEvalRed, postEvalBlack;
            let diffRed, diffBlack;
            
            if (replayIndex === 0) {
                // 刚进入回放模式，还没有走第一步棋
                // Before应该全是0
                preEvalRed = {
                    total: 0,
                    material: 0,
                    position: 0,
                    safety: 0,
                    mobility: 0,
                    threat: 0
                };
                
                preEvalBlack = {
                    total: 0,
                    material: 0,
                    position: 0,
                    safety: 0,
                    mobility: 0,
                    threat: 0
                };
                
                // After是当前局面对应的分数
                postEvalRed = currentEval.red;
                postEvalBlack = currentEval.black;
                
                // Diff是当前局面分数减去0
                diffRed = {
                    total: postEvalRed.total - 0,
                    material: postEvalRed.material - 0,
                    position: postEvalRed.position - 0,
                    safety: postEvalRed.safety - 0,
                    mobility: postEvalRed.mobility - 0,
                    threat: postEvalRed.threat - 0
                };
                
                diffBlack = {
                    total: postEvalBlack.total - 0,
                    material: postEvalBlack.material - 0,
                    position: postEvalBlack.position - 0,
                    safety: postEvalBlack.safety - 0,
                    mobility: postEvalBlack.mobility - 0,
                    threat: postEvalBlack.threat - 0
                };
            } else {
                // 已经走了至少一步棋
                // 获取上一步的棋盘状态和回合
                const previousTurn: Color = (replayIndex - 1) % 2 === 0 ? 'red' : 'black';
                const previousBoard = allReplayBoards[replayIndex - 1];
                
                // 计算上一步局面的评估分数（即Before分数）
                const previousEval = await workerGetDetailedEval(previousBoard, previousTurn, isReplaying);
                
                // Before是上一步局面的分数
                preEvalRed = previousEval.red;
                preEvalBlack = previousEval.black;
                
                // After是当前局面的分数
                postEvalRed = currentEval.red;
                postEvalBlack = currentEval.black;
                
                // Diff是当前局面分数减去上一步局面分数
                diffRed = {
                    total: postEvalRed.total - preEvalRed.total,
                    material: postEvalRed.material - preEvalRed.material,
                    position: postEvalRed.position - preEvalRed.position,
                    safety: postEvalRed.safety - preEvalRed.safety,
                    mobility: postEvalRed.mobility - preEvalRed.mobility,
                    threat: postEvalRed.threat - preEvalRed.threat
                };
                
                diffBlack = {
                    total: postEvalBlack.total - preEvalBlack.total,
                    material: postEvalBlack.material - preEvalBlack.material,
                    position: postEvalBlack.position - preEvalBlack.position,
                    safety: postEvalBlack.safety - preEvalBlack.safety,
                    mobility: postEvalBlack.mobility - preEvalBlack.mobility,
                    threat: postEvalBlack.threat - preEvalBlack.threat
                };
            }

            // 更新Replay评估状态
            setReplayEvaluation({
                pre: {
                    red: preEvalRed,
                    black: preEvalBlack
                },
                post: {
                    red: postEvalRed,
                    black: postEvalBlack
                },
                diff: {
                    red: diffRed,
                    black: diffBlack
                }
            });
        } catch (error) {
            console.error('Error calculating replay evaluation:', error);
        }
    };

    // 当replayIndex变化时更新评估分数
    useEffect(() => {
        if (isReplaying) {
            updateReplayEvaluation();
        }
    }, [replayIndex, isReplaying, allReplayBoards]);
    
    // 分析当前局面
    const analyzeCurrentPosition = async () => {
        setIsAnalyzing(true);
        setAnalysisMoves([]);
        setAnalysisBestMove(null);
        setAnalysisSecondBestMove(null);
        
        try {
            let currentBoard;
            let currentTurn;
            
            if (isReplaying && allReplayBoards.length > 0) {
                // Replay模式
                currentBoard = allReplayBoards[replayIndex];
                currentTurn = replayIndex % 2 === 0 ? 'red' : 'black';
            } else if (isSetupMode) {
                // Setup模式
                currentBoard = board;
                currentTurn = turn;
            } else if (isAnalysisMode) {
                // Analysis模式
                currentBoard = board;
                currentTurn = turn;
            } else {
                // 其他模式，不支持分析
                setIsAnalyzing(false);
                return;
            }
            
            // 模拟调用Game模式的搜索流程，直接向Worker发送SEARCH消息
            const config = DIFFICULTIES[difficulty];
            const searchDepth = analysisDepth;
            const capturedGameId = gameId;
            
            // 使用与searchAndExecuteMove相同的方式向Worker发送SEARCH消息
            const searchResult = await new Promise<{
                bestMove: Move | null;
                secondMove: Move | null;
                moveSequence: Move[];
                bestMoveScore: number;
                secondBestMoveScore: number;
                allMovesWithScores: Array<{ move: Move; score: number; moveSequence: Move[] }>;
            }>((resolve) => {
                if (!workerRef.current) {
                    resolve({
                        bestMove: null,
                        secondMove: null,
                        moveSequence: [],
                        bestMoveScore: 0,
                        secondBestMoveScore: 0,
                        allMovesWithScores: []
                    });
                    return;
                }

                const handleWorkerMessage = (e: MessageEvent) => {
                    if (e.data.type === 'SEARCH_COMPLETE') {
                        workerRef.current?.removeEventListener('message', handleWorkerMessage);
                        resolve({
                            bestMove: decodeMove(e.data.payload.bestMove),
                            secondMove: decodeMove(e.data.payload.secondBestMove),
                            moveSequence: decodeMoves(e.data.payload.moveSequence),
                            bestMoveScore: e.data.payload.bestMoveScore || 0,
                            secondBestMoveScore: e.data.payload.secondBestMoveScore || 0,
                            allMovesWithScores: decodeAnalysisMoves(e.data.payload.allMovesWithScores)
                        });
                    } else if (e.data.type === 'bestMove') {
                        workerRef.current?.removeEventListener('message', handleWorkerMessage);
                        resolve({
                            bestMove: decodeMove(e.data.move),
                            secondMove: decodeMove(e.data.secondMove),
                            moveSequence: decodeMoves(e.data.moveSequence),
                            bestMoveScore: e.data.bestMoveScore || 0,
                            secondBestMoveScore: e.data.secondBestMoveScore || 0,
                            allMovesWithScores: []
                        });
                    }
                };

                workerRef.current.addEventListener('message', handleWorkerMessage);
                workerRef.current.postMessage({
                    type: 'SEARCH',
                    payload: {
                    board: encodeBoard(currentBoard),
                    turn: currentTurn,
                    depth: searchDepth,
                    randomness: config.randomness,
                    ply: moveHistory.length,
                    gameId: capturedGameId,
                    openingBookEnabled: openingBookEnabled,
                    exactRootScores: true,
                    exactRootLimit: analysisScale
                    }
                });
            });
            
            // 处理分析结果，使用worker返回的完整深度为4的搜索结果
            const movesWithScores = (searchResult.allMovesWithScores || []).map((item: any, index: number) => {
                // 直接使用worker返回的完整moveSequence
                // 由于worker已经为每个根节点着法计算了完整的深度为4的序列
                console.log('Processing move:', item.move);
                console.log('Processing moveSequence:', item.moveSequence);
                
                // 确保moveSequence存在且不为空
                let moveSequence = item.moveSequence || [];
                
                // 如果moveSequence为空，尝试从最佳着法序列中获取
                if (moveSequence.length === 0 && searchResult.moveSequence && searchResult.moveSequence.length > 0) {
                    // 对于最佳着法，使用完整的序列
                    if (index === 0) {
                        moveSequence = searchResult.moveSequence;
                    } else if (item.move) {
                        // 对于其他着法，创建一个包含当前着法的基本序列
                        moveSequence = [item.move];
                    }
                }
                
                return {
                    move: item.move,
                    score: item.score,
                    moveSequence: moveSequence
                };
            });
            
            movesWithScores.sort((a, b) => {
                return b.score - a.score;
            });
            
            setAnalysisMoves(movesWithScores);
            setSelectedAnalysisMove(null);
            setAnalysisBestMove(searchResult.bestMove ?? movesWithScores[0]?.move ?? null);
            setAnalysisSecondBestMove(searchResult.secondMove ?? movesWithScores[1]?.move ?? null);
            
            // 对于Setup模式，我们还需要获取详细的局面评估并更新EVALUATION
            if (isSetupMode) {
                try {
                    const evaluation = await workerGetDetailedEval(currentBoard, currentTurn, false);
                    // 将worker返回的评估结果转换为moveEvaluation期望的格式
                    const formattedEvaluation = {
                        pre: evaluation,
                        post: evaluation,
                        diff: {
                            red: {
                                total: 0,
                                material: 0,
                                position: 0,
                                safety: 0,
                                mobility: 0,
                                threat: 0
                            },
                            black: {
                                total: 0,
                                material: 0,
                                position: 0,
                                safety: 0,
                                mobility: 0,
                                threat: 0
                            }
                        }
                    };
                    setMoveEvaluation(formattedEvaluation);
                } catch (evalError) {
                    console.error('获取局面评估失败:', evalError);
                }
            }
            
        } catch (error) {
            console.error('分析棋局失败:', error);
            alert('Analysis failed. Please try again.');
        }
        
        setIsAnalyzing(false);
    };
    
    const startReplay = async () => {
        setIsReplaying(true);
        setActiveTab('replay'); // 切换到Replay页签
        setReplayIndex(0);
        void showReplayCheck(0);
        setSelectedPos(null);
        setValidMoves([]);
        setFlyingPiece(null);
        setIsThinking(false);
        setSelectedPieceEval(null);
        
        // 获取棋谱着法
        if (boardHistory.length > 0 && moveHistory.length > 0) {
            try {
                const notation = await convertMovesToNotation(boardHistory, moveHistory);
                setReplayNotation(notation);
            } catch (error) {
                console.error('Failed to get replay notation:', error);
            }
        }
    };

    const nextReplay = async () => {
        if (replayIndex < allReplayBoards.length - 1) {
            const currentMove = moveHistory[replayIndex];
            if (currentMove) {
                // 获取移动前的棋盘状态
                const prevBoard = allReplayBoards[replayIndex];
                // 获取移动的棋子
                const movingPiece = prevBoard[currentMove.from.r][currentMove.from.c];
                // 获取目标位置的棋子（如果有）
                const targetPiece = prevBoard[currentMove.to.r][currentMove.to.c];
                
                // 显示吃子动画
                if (targetPiece) {
                    const isAlly = targetPiece.color === playerColor;
                    const targetX = -160; 
                    const targetY = isAlly ? (BOARD_HEIGHT_PX - 60) : 40;

                    setFlyingPiece({ 
                        piece: targetPiece, 
                        from: currentMove.to, 
                        target: { x: targetX, y: targetY },
                        id: Date.now() 
                    });
                    setTimeout(() => setFlyingPiece(null), 2000);
                }
                
                // 设置行棋动画
                setMoveAnimation({ 
                    from: currentMove.from, 
                    to: currentMove.to,
                    id: Date.now(),
                    piece: movingPiece
                });
                
                // 0.3秒后清除动画状态
                if (animationTimeoutRef.current) {
                    clearTimeout(animationTimeoutRef.current);
                }
                animationTimeoutRef.current = setTimeout(() => {
                    // 动画结束时播放音效
                    if (targetPiece) {
                        playCaptureSound(); // 吃子音效
                    } else {
                        playMoveSound(); // 普通移动音效
                    }
                    setMoveAnimation(null);
                }, 300);
            }
            
            const next = replayIndex + 1;
            setReplayIndex(next);
            void showReplayCheck(next);
        }
    };

    const prevReplay = () => {
        if (replayIndex > 0) {
            const next = replayIndex - 1;
            setReplayIndex(next);
            playMoveSound();
            void showReplayCheck(next);
        }
    };

    const exitReplay = () => {
        setIsReplaying(false);
        // 清空棋谱记录，恢复到初始状态
        setBoard(createInitialBoard());
        setBoardHistory([]);
        setMoveHistory([]);
        setReplayIndex(0);
        setGameOver(null);
        setPendingGameOver(null);
        setHasStarted(false);
        setRedTime(0);
        // 重置指示器
        setHiddenBestMove(null);
        setSuboptimalMove(null);
        setAnalysisBestMove(null);
        setAnalysisSecondBestMove(null);
        setBlackTime(0);
        setPositionHistory([]);
        setRepetitionWarning(null);
        setSelectedPos(null);
        setValidMoves([]);
        setHintMove(null);
        setRedIsAuto(false);
        setBlackIsAuto(true); // 恢复黑方默认 AI
        // 重置连续无吃子回合计数器
        setDrawMoveCounter(0);
        // 返回Game页签
        setActiveTab('game');
    };

    const playFromHere = () => {
        // 点击按钮不播放背景音乐
        
        // 从当前复盘位置继续游戏
        const currentBoard = allReplayBoards[replayIndex];
        const currentMoveHistory = moveHistory.slice(0, replayIndex);
        const currentBoardHistory = allReplayBoards.slice(0, replayIndex + 1);
        
        // 确定当前该谁走
        // 如果 replayIndex 是偶数，说明是初始状态或红方刚走完，轮到黑方
        // 如果 replayIndex 是奇数，说明黑方刚走完，轮到红方
        const currentTurn: Color = replayIndex % 2 === 0 ? 'red' : 'black';
        
        // 设置棋盘状态
        setBoard(currentBoard);
        setMoveHistory(currentMoveHistory);
        setBoardHistory(currentBoardHistory);
        setTurn(currentTurn);
        
        // 清除游戏结束状态，允许继续对局
        setGameOver(null);
        setPendingGameOver(null);
        
        // 退出复盘模式
        setIsReplaying(false);
        setReplayIndex(0);
        
        // 清除选中状态和提示
        setSelectedPos(null);
        setValidMoves([]);
        setHintMove(null);
        
        // 如果当前不是玩家回合，标记为已开始以便AI移动
        if (currentTurn !== playerColor) {
            setHasStarted(true);
        }
        
        // 增加 gameId 以重置 AI 状态
        setGameId(prev => prev + 1);

        void (async () => {
            const inCheck = await workerIsCheck(currentBoard, currentTurn);
            setCheckAlert(inCheck);
            if (inCheck) playCheckSound();
            const terminal = await workerCheckGameState(currentBoard, currentTurn);
            if (terminal.status !== 'playing') armPendingGameOver(terminal);
            else clearPendingGameOver();
        })();
    };

    // 将坐标移动转换为传统棋谱格式
    const convertMovesToNotation = useRef((boardHistory: Board[], moveHistory: Move[]): Promise<string[]> => {
        const worker = workerRef.current;
        if (!worker) return Promise.reject(new Error('Worker not initialized'));
        return requestWorker(
            worker,
            'movesToNotation',
            { boardHistory: boardHistory.map(encodeBoard), moveHistory },
            'notation',
            data => data.notation,
            5000
        );
    }).current;

    // 保存棋谱到文件（支持特定初始局面）
    const saveGameRecord = async () => {
        if (moveHistory.length === 0) {
            alert("No game record to save");
            return;
        }

        try {
            // 转换为传统棋谱格式
            const notation = await convertMovesToNotation(boardHistory, moveHistory);
            const notationString = notation.join(' ');
            
            // 创建统一格式的棋谱数据
            const gameData: any = {
                notation: notationString,
                timestamp: new Date().toISOString(),
                playerColor: playerColor,
                difficulty: difficulty
            };
            
            // 如果初始局面不是默认棋盘，保存初始局面
            const defaultBoard = createInitialBoard();
            const startBoard = boardHistory[0];
            let isDefaultBoard = true;
            
            // 检查初始局面是否与默认棋盘相同
            for (let r = 0; r < 10; r++) {
                for (let c = 0; c < 9; c++) {
                    const defaultPiece = defaultBoard[r][c];
                    const startPiece = startBoard[r][c];
                    
                    if ((defaultPiece === null && startPiece !== null) || 
                        (defaultPiece !== null && startPiece === null) ||
                        (defaultPiece !== null && startPiece !== null && 
                         (defaultPiece.type !== startPiece.type || defaultPiece.color !== startPiece.color))) {
                        isDefaultBoard = false;
                        break;
                    }
                }
                if (!isDefaultBoard) break;
            }
            
            // 如果不是默认初始局面，保存初始局面信息，使用紧凑格式
            if (!isDefaultBoard) {
                gameData.initialBoard = boardToCompactFormat(startBoard);
            }

            // 将棋局数据转换为JSON字符串，自定义格式确保initialBoard为10行9列
            let jsonData: string;
            if (gameData.initialBoard && Array.isArray(gameData.initialBoard)) {
                // 复制游戏数据，避免修改原始对象
                const gameDataCopy = { ...gameData };
                // 自定义序列化initialBoard，确保每行占一行
                const initialBoardStr = JSON.stringify(gameDataCopy.initialBoard).replace(/\],\[/g, '],\n          [');
                // 手动构建JSON字符串，确保initialBoard格式正确
                const otherProps = Object.entries(gameDataCopy)
                    .filter(([key]) => key !== 'initialBoard')
                    .map(([key, value]) => `  "${key}": ${JSON.stringify(value)}`)
                    .join(',\n');
                jsonData = `{
${otherProps}${otherProps ? ',\n' : ''}  "initialBoard": ${initialBoardStr}
}`;
            } else {
                // 普通序列化
                jsonData = JSON.stringify(gameData, null, 2);
            }
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `chinese-chess-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('保存棋谱失败:', error);
            alert('Failed to save game record');
        }
    };

    // 将传统棋谱格式转换为坐标移动
    const convertNotationToMoves = useRef((notation: string | string[], initialBoard?: Board): Promise<Move[]> => {
        const worker = workerRef.current;
        if (!worker) return Promise.reject(new Error('Worker not initialized'));

        const notationArray = notation
            ? (typeof notation === 'string' ? notation.split(' ').filter(move => move.trim() !== '') : notation)
            : [];
        return requestWorker(
            worker,
            'notationToMoves',
            { notation: notationArray, initialBoard: initialBoard ? encodeBoard(initialBoard) : undefined },
            'moves',
            data => data.moves,
            5000
        );
    }).current;

    // 从传统棋谱生成棋盘历史，支持从特定初始局面开始
    const generateBoardHistory = (moves: Move[], initialBoard?: Board): Board[] => {
        // 如果提供了初始局面，则使用该局面，否则使用默认初始棋盘
        const startBoard = initialBoard || createInitialBoard();
        const boardHistory: Board[] = [startBoard];
        let currentBoard = JSON.parse(JSON.stringify(startBoard));

        for (const move of moves) {
            // 创建新的棋盘状态
            const newBoard: Board = JSON.parse(JSON.stringify(currentBoard));
            
            // 执行移动
            newBoard[move.to.r][move.to.c] = currentBoard[move.from.r][move.from.c];
            newBoard[move.from.r][move.from.c] = null;
            
            // 更新当前棋盘和历史
            currentBoard = newBoard;
            boardHistory.push(currentBoard);
        }

        return boardHistory;
    };

    // 加载棋谱文件（支持统一格式，包括棋谱和局面文件）
    const loadGameRecord = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const content = e.target?.result as string;
                const gameData = JSON.parse(content);
                
                // 加载新棋谱之前，先清空老棋谱的相关状态
                setMoveHistory([]);
                setBoardHistory([]);
                setReplayNotation([]);
                setReplayIndex(0);
                
                // 处理统一格式文件
                let moves: Move[] = [];
                let boardHistory: Board[] = [];
                let startBoard: Board;
                
                // 检查是否有初始局面
                if (gameData.initialBoard) {
                    // 检查是否是紧凑格式（二维数字数组）
                    if (Array.isArray(gameData.initialBoard) && 
                        gameData.initialBoard.length === ROWS && 
                        gameData.initialBoard.every(row => Array.isArray(row) && row.length === COLS && row.every(item => typeof item === 'number'))) {
                        // 是紧凑格式，转换为标准棋盘格式
                        startBoard = compactFormatToBoard(gameData.initialBoard as CompactBoard);
                    } else {
                        // 是传统格式，直接使用
                        startBoard = gameData.initialBoard as Board;
                    }
                } else {
                    // 使用默认初始棋盘
                    startBoard = createInitialBoard();
                }
                
                // 检查是否有棋谱
                if (gameData.notation && gameData.notation.trim() !== '') {
                    // 有棋谱，转换为坐标移动并生成棋盘历史
                    const notationData = gameData.notation;
                    // 转换为坐标移动，传递初始局面
                    moves = await convertNotationToMoves(notationData, startBoard);
                    // 生成棋盘历史，支持从特定初始局面开始
                    boardHistory = generateBoardHistory(moves, startBoard);
                } else {
                    // 没有棋谱，只有初始局面
                    moves = [];
                    boardHistory = [startBoard];
                }
                
                // 加载棋谱数据
                setMoveHistory(moves);
                setBoardHistory(boardHistory);
                setBoard(boardHistory[boardHistory.length - 1]);
                
                // 设置玩家颜色和难度（如果存在）
                if (gameData.playerColor) {
                    setPlayerColor(gameData.playerColor);
                }
                if (gameData.difficulty) {
                    setDifficulty(gameData.difficulty);
                }
                
                // 设置皮肤和材质（如果存在）
                if (gameData.skin) {
                    setSkin(gameData.skin);
                }
                if (gameData.material) {
                    setMaterial(gameData.material);
                }
                
                // 获取棋谱着法
                let notationArray = [];
                try {
                    if (gameData.notation && gameData.notation.trim() !== '') {
                        notationArray = typeof gameData.notation === 'string' ? gameData.notation.split(' ').filter(move => move.trim() !== '') : gameData.notation;
                    } else {
                        notationArray = [];
                    }
                    setReplayNotation(notationArray);
                } catch (error) {
                    console.error('Failed to get replay notation:', error);
                }
                
                // 进入回放模式
                setIsReplaying(true);
                setReplayIndex(0);
                void showReplayCheck(0);
                setGameOver(null);
                setHasStarted(false);
                
                alert("File loaded successfully!");
            } catch (error) {
                console.error("加载文件失败:", error);
                alert("Failed to load file. Format may be invalid");
            }
        };
        
        reader.readAsText(file);
        // 重置文件输入，允许再次选择同一文件
        event.target.value = '';
    };

    const getCapturedPieces = (currentBoard: Board) => {
        const counts = JSON.parse(JSON.stringify(INITIAL_SUPPLY));
        // 确保currentBoard有效
        if (currentBoard) {
            currentBoard.forEach(row => row.forEach(p => {
                if(p) counts[p.color][p.type]--;
            }));
        }
        const captured = { red: [] as PieceType[], black: [] as PieceType[] };
        (['red', 'black'] as const).forEach(color => {
            (Object.keys(counts[color]) as PieceType[]).forEach(type => {
                const lostCount = counts[color][type];
                for(let i=0; i<lostCount; i++) captured[color].push(type);
            });
        });
        return captured;
    };

    const getSupplyPieces = (color: Color) => {
        const list: PieceType[] = [];
        (Object.keys(setupSupply[color]) as PieceType[]).forEach(type => {
            const count = setupSupply[color][type];
            for(let i=0; i<count; i++) list.push(type);
        });
        return list;
    };

    // 计算显示的棋盘
    const displayBoard = useMemo(() => {
        if (isPreviewing) {
            // 预览模式下使用当前board状态
            return board;
        } else if (isReplaying) {
            // 确保boardHistory和boardHistory[replayIndex]有效
            return boardHistory && boardHistory[replayIndex] ? boardHistory[replayIndex] : createInitialBoard();
        } else {
            // 确保board有效
            return board || createInitialBoard();
        }
    }, [board, isReplaying, replayIndex, boardHistory, isPreviewing]);
    
    // 计算当前回合，在Replay模式下根据replayIndex计算
    const currentTurn = useMemo(() => {
        return isReplaying ? (replayIndex % 2 === 0 ? 'red' : 'black') : turn;
    }, [isReplaying, replayIndex, turn]);
    const isAutoTurn = (isReplaying ? currentTurn : turn) === 'red' ? redIsAuto : blackIsAuto;
    
    const displayLastMove = isReplaying 
        ? (replayIndex > 0 ? moveHistory[replayIndex - 1] : null)
        : (moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null);

    const capturedInfo = useMemo(() => getCapturedPieces(displayBoard), [displayBoard]);
    const isFlipped = playerColor === 'black';

    let topPanelPieces: PieceType[] = [];
    let topPanelColor: Color = playerColor === 'red' ? 'black' : 'red';

    let bottomPanelPieces: PieceType[] = [];
    let bottomPanelColor: Color = playerColor;

    if (isSetupMode) {
        topPanelColor = playerColor === 'red' ? 'black' : 'red';
        topPanelPieces = getSupplyPieces(topPanelColor);

        bottomPanelColor = playerColor;
        bottomPanelPieces = getSupplyPieces(bottomPanelColor);
    } else {
        const enemyColor = playerColor === 'red' ? 'black' : 'red';
        topPanelPieces = capturedInfo[enemyColor];
        bottomPanelPieces = capturedInfo[playerColor];
    }

    if (appScreen === 'lobby' || appScreen === 'waiting') {
        return (
            <LobbyScreen
                screen={appScreen}
                connectionStatus={connectionStatus}
                roomCode={onlineInfo?.roomCode ?? null}
                statusMessage={lobbyStatusMessage}
                peerNick={onlineInfo?.peerNick ?? null}
                onStartLocal={handleStartLocal}
                onCreateRoom={handleCreateRoom}
                onJoinRoom={handleJoinRoom}
                onCancelWaiting={() => leaveToLobby()}
                onCopyRoomLink={() => { void handleCopyRoomLink(); }}
            />
        );
    }

    return (
        <div className="min-h-dvh bg-stone-900 flex flex-col items-center justify-start lg:justify-center p-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-4 sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] font-sans text-stone-200 relative overflow-x-hidden select-none">
            <audio ref={sfxRef} src={CLICK_SOUND_URI} />
            
            {/* 新增的各种音效 */}
            <audio ref={moveSoundRef} src={MOVE_SOUND} />
            <audio ref={captureSoundRef} src={CAPTURE_SOUND} />
            <audio ref={checkSoundRef} src={CHECK_SOUND} />
            <audio ref={gameOverSoundRef} src={GAME_OVER_SOUND} />
            <audio ref={victorySoundRef} src={VICTORY_SOUND} />

            {/* 游戏模式选择按钮 - 位于棋盘正上方 */}
            <div className="w-full mb-3 max-w-[500px] mx-auto">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-stone-400 px-1">
                    <span>
                        {onlineInfo ? (
                            <>
                                Online · Room{' '}
                                <span className="font-mono text-amber-400 tracking-wider">
                                    {onlineInfo.roomCode.toUpperCase()}
                                </span>
                                {onlineInfo.peerNick ? ` · vs ${onlineInfo.peerNick}` : ''}
                                {' · '}
                                {onlineInfo.myColor === 'red' ? 'Playing Red' : 'Playing Black'}
                            </>
                        ) : (
                            'Local game'
                        )}
                    </span>
                    <button
                        type="button"
                        onClick={() => leaveToLobby()}
                        className="text-rose-300 hover:text-rose-200 font-semibold"
                    >Back to Lobby</button>
                </div>
                <div className="flex gap-1">
                    <button 
                        onClick={() => {
                            if (isSetupMode || isReplaying) {
                                // 处于Setup或Replay模式时，点击Game页签无效
                                return;
                            }
                            resetBoardIndicators();
                            setActiveTab('game');
                        }}
                        className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-xs transition-all ${activeTab === 'game' ? 'bg-amber-600 text-white' : 'bg-stone-700 text-stone-400 hover:bg-stone-600'}`}
                    >
                        Game
                    </button>
                    <button 
                        onClick={() => {
                            if (isSetupMode) {
                                // 处于Setup模式时，点击Replay页签无效
                                return;
                            }
                            // 切换到Replay页签，只有从非Replay页签切换时才需要重置
                            // 保留当前Replay模式的棋谱数据，不要清空
                            resetBoardIndicators();
                            setActiveTab('replay');
                            if (!isReplaying) {
                                // 只有在非Replay模式下才需要调用startReplay
                                startReplay();
                            }
                        }}
                        className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-xs transition-all ${activeTab === 'replay' ? 'bg-amber-600 text-white' : 'bg-stone-700 text-stone-400 hover:bg-stone-600'}`}
                    >
                        Replay
                    </button>
                    <button 
                        onClick={() => {
                            if (isReplaying) {
                                // 处于Replay模式时，点击Setup页签无效
                                return;
                            }
                            // 只有AI没有在搜索时才能切换到Setup tab
                            if (!isThinking) {
                                if (!isSetupMode) {
                                    // 只有在非Setup模式下才需要调用enterSetupMode()
                                    enterSetupMode();
                                }
                                // 允许从任何非Replay模式切换到Setup页签
                                resetBoardIndicators();
                                setActiveTab('setup');
                            }
                        }}
                        disabled={isThinking}
                        className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-xs transition-all ${activeTab === 'setup' ? 'bg-amber-600 text-white' : 'bg-stone-700 text-stone-400 hover:bg-stone-600'} ${isThinking ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        Setup
                    </button>
                    <button 
                        onClick={() => {
                            // 允许在任何模式下点击Settings页签
                            resetBoardIndicators();
                            setActiveTab('settings');
                        }}
                        className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-xs transition-all ${activeTab === 'settings' ? 'bg-amber-600 text-white' : 'bg-stone-700 text-stone-400 hover:bg-stone-600'}`}
                    >
                        Setting
                    </button>

                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-center max-w-[1040px] w-full">
                
                {/* Mobile: contents 使子项参与父级 flex order；Desktop: 左栏侧边栏 */}
                <div className="contents lg:flex lg:flex-col lg:h-[550px] lg:w-[300px] lg:order-1">
                    {/* 对手：mobile order-1（棋盘上方），desktop 左栏上半 */}
                    <div className="order-1 w-full flex flex-col gap-2 lg:h-[275px] lg:justify-end">
                        {/* Setup 竖屏隐藏时钟省空间；桌面仍显示 */}
                        <div className={isSetupMode ? 'hidden lg:block' : undefined}>
                            <ClockDisplay 
                                color={playerColor === 'red' ? 'black' : 'red'} 
                                time={playerColor === 'red' ? blackTime : redTime} 
                                isActive={(playerColor === 'red' ? turn === 'black' : turn === 'red') && !gameOver && !isReplaying && !isSetupMode && hasStarted} 
                                redStepCount={isReplaying ? Math.ceil(replayIndex / 2) : redStepCount}
                                blackStepCount={isReplaying ? Math.floor(replayIndex / 2) : blackStepCount}
                            />
                        </div>
                        
                        {!isSetupMode && (
                            <SidePanel 
                                color={playerColor === 'red' ? 'black' : 'red'} 
                                playerColor={playerColor}
                                pieces={topPanelColor === (playerColor === 'red' ? 'black' : 'red') ? topPanelPieces : bottomPanelPieces}
                                isSetupMode={isSetupMode}
                                material={material}
                                onDragStart={(e, type, c) => handleDragStart(e, {type, color: c})}
                                onDrop={(e) => handleDropOnPanel(e, playerColor === 'red' ? 'black' : 'red')}
                                recentlyCaptured={recentlyCaptured}
                            />
                        )}

                        {/* Setup 可摆棋子：仅竖屏（桌面右栏已有，避免重复） */}
                        {isSetupMode && (
                            <div className="lg:hidden">
                                <SidePanel 
                                    color={topPanelColor} 
                                    playerColor={playerColor}
                                    pieces={topPanelPieces}
                                    isSetupMode={isSetupMode}
                                    material={material}
                                    onDragStart={(e, type, c) => handleDragStart(e, {type, color: c})}
                                    onDrop={(e) => handleDropOnPanel(e, topPanelColor)}
                                    recentlyCaptured={recentlyCaptured}
                                />
                            </div>
                        )}
                        
                        {/* 评估面板仅桌面显示 */}
                        <div className="hidden lg:block">
                            <EvaluationPanel 
                                color={playerColor === 'red' ? 'black' : 'red'} 
                                evaluation={isReplaying ? replayEvaluation : moveEvaluation} 
                            />
                        </div>
                    </div>
                    
                    {/* 己方：mobile order-3（棋盘下方），desktop 左栏下半 */}
                    <div className="order-3 w-full flex flex-col gap-2 lg:h-[275px] lg:justify-start">
                        <div className="hidden lg:block">
                            <EvaluationPanel 
                                color={playerColor} 
                                evaluation={isReplaying ? replayEvaluation : moveEvaluation} 
                            />
                        </div>
                        
                        {!isSetupMode && (
                            <SidePanel 
                                color={playerColor} 
                                playerColor={playerColor}
                                pieces={topPanelColor === playerColor ? topPanelPieces : bottomPanelPieces}
                                isSetupMode={isSetupMode}
                                material={material}
                                recentlyCaptured={recentlyCaptured}
                                onDragStart={(e, type, c) => handleDragStart(e, {type, color: c})}
                                onDrop={(e) => handleDropOnPanel(e, playerColor)}
                            />
                        )}

                        {/* Setup 可摆棋子：仅竖屏（桌面右栏已有，避免重复） */}
                        {isSetupMode && (
                            <div className="lg:hidden">
                                <SidePanel 
                                    color={bottomPanelColor} 
                                    playerColor={playerColor}
                                    pieces={bottomPanelPieces}
                                    isSetupMode={isSetupMode}
                                    material={material}
                                    recentlyCaptured={recentlyCaptured}
                                    onDragStart={(e, type, c) => handleDragStart(e, {type, color: c})}
                                    onDrop={(e) => handleDropOnPanel(e, bottomPanelColor)}
                                />
                            </div>
                        )}
                        
                        <div className={isSetupMode ? 'hidden lg:block' : undefined}>
                            <ClockDisplay 
                                color={playerColor} 
                                time={playerColor === 'red' ? redTime : blackTime} 
                                isActive={(playerColor === 'red' ? turn === 'red' : turn === 'black') && !gameOver && !isReplaying && !isSetupMode && hasStarted} 
                                redStepCount={isReplaying ? Math.ceil(replayIndex / 2) : redStepCount}
                                blackStepCount={isReplaying ? Math.floor(replayIndex / 2) : blackStepCount}
                            />
                        </div>
                    </div>
                </div>

                <div className="relative order-2 lg:order-2 w-full max-w-[500px] flex justify-center">
                    <ChessBoard 
                        board={displayBoard} 
                        onSelect={handlePieceSelect} 
                        onMove={handleMove}
                        onRightClick={handleRightClickOnBoard}
                        selectedPos={selectedPos}
                        validMoves={isSetupMode ? emptyValidMoves : validMoves}
                        turn={currentTurn}
                        lastMove={isSetupMode ? null : displayLastMove}
                        hintMove={hintMove}
                        flip={isFlipped}
                        isSetupMode={isSetupMode}
                        skin={skin}
                        material={material}
                        playerColor={playerColor}
                        boardBgColor={enableCustomColors ? boardBgColor : undefined}
                        boardLineColor={enableCustomColors ? boardLineColor : undefined}
                        coordinateStyle={coordinateStyle}
                        onDragStart={handleDragStart}
                        onDrop={handleDropOnBoard}
                        pieceRelations={pieceRelations}
                        moveAnimation={moveAnimation}
                        pieceEval={selectedPieceEval}
                        isCheck={checkAlert}
                        hiddenBestMove={isSetupMode ? null : hiddenBestMove}
                        suboptimalMove={isSetupMode ? null : suboptimalMove}
                        analysisBestMove={isSetupMode ? null : analysisBestMove}
                        analysisSecondBestMove={isSetupMode ? null : analysisSecondBestMove}
                    />

                    {isReplaying && (
                        <div
                            className="absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-md border border-stone-700/30 bg-stone-950/25 p-1 shadow-md"
                            role="group"
                            aria-label="Replay navigation"
                        >
                            <button
                                type="button"
                                onClick={() => jumpReplay(0)}
                                disabled={replayIndex === 0}
                                className="flex h-9 w-9 items-center justify-center rounded bg-stone-900/35 text-white/90 transition-colors hover:bg-stone-800/70 hover:text-white disabled:opacity-30"
                                aria-label="First move"
                                title="First move"
                            >
                                <FirstPageIcon className="h-5 w-5" />
                            </button>
                            <button
                                type="button"
                                onClick={prevReplay}
                                disabled={replayIndex === 0}
                                className="flex h-9 w-9 items-center justify-center rounded bg-stone-900/35 text-white/90 transition-colors hover:bg-stone-800/70 hover:text-white disabled:opacity-30"
                                aria-label="Previous move"
                                title="Previous move"
                            >
                                <ChevronLeftIcon className="h-5 w-5" />
                            </button>
                            <button
                                type="button"
                                onClick={nextReplay}
                                disabled={replayIndex === allReplayBoards.length - 1}
                                className="flex h-9 w-9 items-center justify-center rounded bg-stone-900/35 text-white/90 transition-colors hover:bg-stone-800/70 hover:text-white disabled:opacity-30"
                                aria-label="Next move"
                                title="Next move"
                            >
                                <ChevronRightIcon className="h-5 w-5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => jumpReplay(allReplayBoards.length - 1)}
                                disabled={replayIndex === allReplayBoards.length - 1}
                                className="flex h-9 w-9 items-center justify-center rounded bg-stone-900/35 text-white/90 transition-colors hover:bg-stone-800/70 hover:text-white disabled:opacity-30"
                                aria-label="Last move"
                                title="Last move"
                            >
                                <LastPageIcon className="h-5 w-5" />
                            </button>
                        </div>
                    )}

                    {isThinking && !isReplaying && (
                        <div className="absolute z-40 pointer-events-none" style={{
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)'
                        }}>
                            <GearIcon className="text-amber-400 animate-spin" style={{
                                width: '48px',
                                height: '48px',
                                filter: 'drop-shadow(0 0 8px rgba(251, 191, 36, 0.5))'
                            }} />
                        </div>
                    )}
                    
                    {flyingPiece && (
                         <FlyingPiece 
                             piece={flyingPiece.piece}
                             startPos={flyingPiece.from}
                             targetPos={flyingPiece.target}
                             isFlipped={isFlipped}
                             material={material}
                         />
                    )}
                    


                    {checkAlert && !gameOver && !isReplaying && !isSetupMode && (
                        <div
                            className="absolute pointer-events-none z-20 animate-pulse"
                            style={{
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)'
                            }}
                        >
                            <BoltIcon
                                className="text-red-500"
                                style={{
                                    width: '48px',
                                    height: '48px',
                                    opacity: 0.85,
                                    filter: 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.5))'
                                }}
                            />
                        </div>
                    )}

                    {repetitionWarning && !isReplaying && !isSetupMode && (
                        <div className="absolute top-1/4 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30">
                            <div className="bg-transparent text-orange-500 text-2xl font-extrabold tracking-wide whitespace-nowrap drop-shadow-md animate-pulse">
                                {repetitionWarning}
                            </div>
                        </div>
                    )}

                    {pendingGameOver && !gameOver && !isReplaying && !isSetupMode && (
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20">
                            <div className="bg-amber-600/10 px-6 py-4 rounded-2xl text-xl font-bold">
                                <div className="text-center mb-2 text-yellow-600">
                                    {pendingGameOver.status === 'checkmate' ? '🏁 Checkmate!' : '🏁 Stalemate!'}
                                </div>
                                <div className="text-sm text-amber-100 text-center">
                                    Game ending in 5s.
                                </div>
                            </div>
                        </div>
                    )}

                    {gameOver && gameOver.status !== 'setup' && !isReplaying && (
                        <>
                            <div
                                className="absolute z-50 pointer-events-none animate-scaleUp text-4xl font-extrabold tracking-wide drop-shadow-md text-red-500/90"
                                style={{
                                    top: '50%',
                                    left: '50%',
                                    transform: 'translate(-50%, -50%)'
                                }}
                            >
                                {gameOver.status === 'draw' ? 'DRAW' : (gameOver.winner === playerColor ? 'VICTORY' : 'DEFEAT')}
                            </div>
                            <div
                                className="absolute z-50 flex gap-3 pointer-events-auto"
                                style={{
                                    top: 'calc(50% + 28px)',
                                    left: '50%',
                                    transform: 'translateX(-50%)'
                                }}
                            >
                                <button
                                    type="button"
                                    onClick={startReplay}
                                    className="px-5 py-2 rounded-full font-bold text-base bg-transparent text-red-600 border border-red-600/40 hover:bg-red-600/10 transition-colors"
                                >
                                    Replay
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (onlineInfo) {
                                            // 返回大厅会重置棋局并释放 Worker，不会立即重建引擎。
                                            leaveToLobby();
                                            return;
                                        }
                                        handleRestart();
                                    }}
                                    className="px-5 py-2 rounded-full font-bold text-base bg-transparent text-red-600 border border-red-600/40 hover:bg-red-600/10 transition-colors"
                                >
                                    {onlineInfo ? 'Back to Lobby' : 'Rematch'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
                
                <div className="order-4 lg:order-3 flex flex-col h-auto lg:h-[550px] w-full lg:w-[300px] bg-stone-800/90 backdrop-blur p-3 pb-5 lg:pb-3 rounded-xl shadow-2xl border border-stone-700 transition-colors duration-300 overflow-y-auto">
                {/* Settings Tab Content */}
                {activeTab === 'settings' && (
                    <div className="flex flex-col gap-3">
                        {/* Board Skin and Piece Material */}
                        <div className="bg-stone-900/50 p-3 rounded-lg border border-stone-700">
                            <div className="flex items-center gap-2 mb-3">
                                <PaletteIcon className="w-5 h-5 text-amber-400" />
                                <span className="text-xs font-semibold text-stone-300 uppercase tracking-wide">Board & Pieces</span>
                            </div>
                            
                            {/* 皮肤选择器 */}
                            <div className="relative mb-3">
                                <button 
                                    onClick={() => setShowSkinSelector(!showSkinSelector)} 
                                    style={getButtonStyle()}
                                    className="w-full px-3 py-3 rounded-lg font-bold transition-all flex items-center justify-between gap-1 border border-stone-600 shadow-sm hover:opacity-80 active:scale-95 text-left"
                                >
                                    <div className="flex items-center gap-2">
                                        <SquareIcon className="w-4 h-4" />
                                        <span className="text-xs">Board Skin</span>
                                    </div>
                                    <span className="text-xs font-bold">{getSkinDisplayName(skin)}</span>
                                </button>
                                {/* 皮肤选择面板 */}
                                {showSkinSelector && (
                                    <div className="absolute right-0 mt-2 bg-stone-800 border-2 border-stone-700 rounded-lg shadow-xl p-2 grid grid-cols-2 gap-2 z-50">
                                        {(['stone-board', 'wood-board', 'paper-board', 'glass-board'] as Skin[]).map((s) => (
                                            <button
                                                key={s}
                                                onClick={() => {
                                                    setSkin(s);
                                                    setShowSkinSelector(false);
                                                }}
                                                className={`p-3 rounded-lg transition-all border-2 ${skin === s ? 'border-amber-500 ring-2 ring-amber-500/30' : 'border-stone-600 hover:border-stone-500'}`}
                                                style={{
                                                    backgroundColor: SKINS[s].boardBg,
                                                    borderColor: SKINS[s].border,
                                                }}
                                            >
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <span className={`text-xs font-bold ${SKINS[s].boardBg === '#f0e6d2' ? 'text-stone-800' : 'text-white'}`}>
                                                        {getSkinDisplayName(s)}
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            
                            {/* 棋子材质选择器 */}
                            <div className="relative">
                                <button 
                                    onClick={() => setShowMaterialSelector(!showMaterialSelector)} 
                                    style={getButtonStyle()}
                                    className="w-full px-3 py-3 rounded-lg font-bold transition-all flex items-center justify-between gap-1 border border-stone-600 shadow-sm hover:opacity-80 active:scale-95 text-left"
                                >
                                    <div className="flex items-center gap-2">
                                        <AdjustmentsIcon className="w-4 h-4" />
                                        <span className="text-xs">Piece Material</span>
                                    </div>
                                    <span className="text-xs font-bold">{getMaterialDisplayName(material)}</span>
                                </button>
                                {/* 棋子材质选择面板 */}
                                {showMaterialSelector && (
                                    <div className="absolute right-0 mt-2 bg-stone-800 border-2 border-stone-700 rounded-lg shadow-xl p-2 grid grid-cols-2 gap-2 z-50">
                                        {(['wood', 'stone', 'metal', 'glass'] as PieceMaterial[]).map((m) => (
                                            <button
                                                key={m}
                                                onClick={() => {
                                                    setMaterial(m);
                                                    setShowMaterialSelector(false);
                                                }}
                                                className={`p-3 rounded-lg transition-all border-2 ${material === m ? 'border-amber-500 ring-2 ring-amber-500/30' : 'border-stone-600 hover:border-stone-500'}`}
                                                style={{
                                                    backgroundColor: m === 'wood' ? '#D2B48C' : 
                                                                      m === 'stone' ? '#808080' : 
                                                                      m === 'metal' ? '#4A2C17' : 
                                                                      'rgba(255, 255, 255, 0.1)',
                                                    borderColor: m === 'wood' ? '#8B4513' : 
                                                                 m === 'stone' ? '#808080' : 
                                                                 m === 'metal' ? '#2D1810' : 
                                                                     'rgba(139, 0, 0, 0.8)',
                                                }}
                                            >
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <span className={`text-xs font-bold ${m === 'glass' ? 'text-white' : 
                                                                       m === 'metal' ? 'text-amber-300' : 
                                                                       m === 'stone' ? 'text-red-500' : 
                                                                       'text-stone-800'}`}>
                                                        {getMaterialDisplayName(m)}
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        {/* Coordinate System Settings */}
                        <div className="bg-stone-900/50 p-3 rounded-lg border border-stone-700">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <SquareIcon className="w-5 h-5 text-amber-400" />
                                    <span className="text-xs font-semibold text-stone-300 uppercase tracking-wide">Coordinates</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <select
                                    value={coordinateStyle}
                                    onChange={(e) => setCoordinateStyle(e.target.value as 'chinese' | 'western')}
                                    className="flex-1 py-2 px-3 bg-stone-700 hover:bg-stone-600 rounded-lg font-bold text-stone-300 text-xs border border-stone-600 transition-colors appearance-none cursor-pointer"
                                >
                                    <option value="chinese" className="bg-stone-800 text-stone-300">
                                        Chinese
                                    </option>
                                    <option value="western" className="bg-stone-800 text-stone-300">
                                        Western
                                    </option>
                                </select>
                            </div>
                        </div>
                        
                        <div className="flex items-center justify-between bg-stone-900/50 p-3 rounded-lg border border-stone-700">
                            <div className="flex items-center gap-2">
                                <SpeakerWaveIcon className="w-5 h-5 text-stone-400" />
                                <span className="text-xs font-semibold text-stone-300 uppercase tracking-wide">Music</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={isMusicEnabled}
                                    onChange={(e) => toggleMusic(e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-stone-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                            </label>
                        </div>
                        
                        {/* Opening Book Settings */}
                        <div className="bg-stone-900/50 p-3 rounded-lg border border-stone-700">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <SparklesIcon className="w-5 h-5 text-amber-400" />
                                    <span className="text-xs font-semibold text-stone-300 uppercase tracking-wide">Opening Book</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-stone-700 hover:bg-stone-600 rounded-lg font-bold text-stone-300 text-xs border border-stone-600 transition-colors"
                                >
                                    <LoadIcon className="w-4 h-4" />
                                    <span>Load BOOK</span>
                                </button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept=".txt"
                                    className="hidden"
                                    onChange={handleLoadOpeningBook}
                                />
                            </div>
                        </div>

                        {/* AI Search Depth Settings */}
                        <div className="bg-stone-900/50 p-3 rounded-lg border border-stone-700">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <AdjustmentsIcon className="w-5 h-5 text-amber-400" />
                                    <span className="text-xs font-semibold text-stone-300 uppercase tracking-wide">Search Depth</span>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="flex items-center gap-2">
                                    <span className="w-28 shrink-0 text-xs text-stone-400">Play</span>
                                    <select
                                        value={playDepth}
                                        onChange={(e) => setPlayDepth(parseInt(e.target.value))}
                                        className="flex-1 py-2 px-3 bg-stone-700 hover:bg-stone-600 rounded-lg font-bold text-stone-300 text-xs border border-stone-600 transition-colors appearance-none cursor-pointer"
                                    >
                                        {[8, 9, 10, 11, 12].map((depth) => (
                                            <option key={depth} value={depth} className="bg-stone-800 text-stone-300">
                                                Depth {depth}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex items-center gap-2">
                                    <span className="w-28 shrink-0 text-xs text-stone-400">Analysis</span>
                                    <select
                                        value={analysisDepth}
                                        onChange={(e) => setAnalysisDepth(parseInt(e.target.value))}
                                        className="flex-1 py-2 px-3 bg-stone-700 hover:bg-stone-600 rounded-lg font-bold text-stone-300 text-xs border border-stone-600 transition-colors appearance-none cursor-pointer"
                                    >
                                        {[6, 7, 8, 9, 10].map((depth) => (
                                            <option key={depth} value={depth} className="bg-stone-800 text-stone-300">
                                                Depth {depth}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex items-center gap-2">
                                    <span className="w-28 shrink-0 text-xs text-stone-400">Analysis Scale</span>
                                    <select
                                        value={analysisScale}
                                        onChange={(e) => setAnalysisScale(parseInt(e.target.value))}
                                        className="flex-1 py-2 px-3 bg-stone-700 hover:bg-stone-600 rounded-lg font-bold text-stone-300 text-xs border border-stone-600 transition-colors appearance-none cursor-pointer"
                                    >
                                        {[10, 20, 30, 40, 50].map((scale) => (
                                            <option key={scale} value={scale} className="bg-stone-800 text-stone-300">
                                                {scale}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        </div>

                        {/* VALUE_WEIGHTS Settings */}
                        <div className="bg-stone-900/50 p-3 rounded-lg border border-stone-700">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <AdjustmentsIcon className="w-5 h-5 text-amber-400" />
                                    <span className="text-xs font-semibold text-stone-300 uppercase tracking-wide">Evaluation Weights</span>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                {/* Material Weight */}
                                <div className="mb-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-stone-400">Material</span>
                                        <span className="text-xs text-stone-300 font-mono">{valueWeights.material.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="2"
                                        step="0.01"
                                        value={valueWeights.material}
                                        onChange={(e) => setValueWeights(prev => ({ ...prev, material: parseFloat(e.target.value) }))}
                                        className="w-full h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                                
                                {/* Position Weight */}
                                <div className="mb-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-stone-400">Position</span>
                                        <span className="text-xs text-stone-300 font-mono">{valueWeights.position.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="2"
                                        step="0.01"
                                        value={valueWeights.position}
                                        onChange={(e) => setValueWeights(prev => ({ ...prev, position: parseFloat(e.target.value) }))}
                                        className="w-full h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                                
                                {/* Threat Weight */}
                                <div className="mb-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-stone-400">Threat</span>
                                        <span className="text-xs text-stone-300 font-mono">{valueWeights.threat.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="2"
                                        step="0.01"
                                        value={valueWeights.threat}
                                        onChange={(e) => setValueWeights(prev => ({ ...prev, threat: parseFloat(e.target.value) }))}
                                        className="w-full h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                                
                                
                                {/* Safety Weight */}
                                <div className="mb-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-stone-400">Safety</span>
                                        <span className="text-xs text-stone-300 font-mono">{valueWeights.safety.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="2"
                                        step="0.01"
                                        value={valueWeights.safety}
                                        onChange={(e) => setValueWeights(prev => ({ ...prev, safety: parseFloat(e.target.value) }))}
                                        className="w-full h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                                
                                {/* Mobility Weight */}
                                <div className="mb-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-stone-400">Mobility</span>
                                        <span className="text-xs text-stone-300 font-mono">{valueWeights.mobility.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="2"
                                        step="0.01"
                                        value={valueWeights.mobility}
                                        onChange={(e) => setValueWeights(prev => ({ ...prev, mobility: parseFloat(e.target.value) }))}
                                        className="w-full h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>
                        </div>
                        
                        {/* Board Color Settings */}
                        <div className="bg-stone-900/50 p-3 rounded-lg border border-stone-700">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <SquareIcon className="w-5 h-5 text-amber-400" />
                                    <span className="text-xs font-semibold text-stone-300 uppercase tracking-wide">Board</span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={enableCustomColors}
                                        onChange={(e) => setEnableCustomColors(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-stone-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                                </label>
                            </div>
                            
                            {/* Background Color */}
                            <div className="space-y-2 mb-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-stone-400">Background</span>
                                    <input
                                        type="color"
                                        value={boardBgColor}
                                        onChange={(e) => setBoardBgColor(e.target.value)}
                                        disabled={!enableCustomColors}
                                        className="w-8 h-8 rounded cursor-pointer border border-stone-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                </div>
                            </div>
                            
                            {/* Line Color */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-stone-400">Lines</span>
                                    <input
                                        type="color"
                                        value={boardLineColor}
                                        onChange={(e) => setBoardLineColor(e.target.value)}
                                        disabled={!enableCustomColors}
                                        className="w-8 h-8 rounded cursor-pointer border border-stone-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                    {!isReplaying && !isSetupMode ? (
                        <div className="flex flex-col h-full">
                            
                            {/* Game Tab Content */}
                            {activeTab === 'game' && (
                                <div className="grid grid-cols-2 gap-3 mb-auto">
                                {/* 第1排：Restart, Resign */}
                                <button 
                                    onClick={handleRestart} 
                                    disabled={isThinking || !!onlineInfo} 
                                    style={getButtonStyle()}
                                    className="px-3 py-4 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95"
                                >
                                    <ArrowPathIcon className="w-4 h-4" />
                                    <span className="text-xs">Restart</span>
                                </button>
                                {/* Analysis button moved into Resign slot */}
                                <button
                                    onClick={() => {
                                        if (isAnalysisMode) {
                                            setAnalysisMoves([]);
                                            setSelectedAnalysisMove(null);
                                            setIsPreviewing(false);
                                            setOriginalBoardForPreview(null);
                                            setIsAnalysisMode(false);
                                            setAnalysisBestMove(null);
                                            setAnalysisSecondBestMove(null);
                                            return;
                                        }
                                        // 进入Analysis模式，触发分析
                                        setIsAnalysisMode(true);
                                        setAnalysisBestMove(null);
                                        setAnalysisSecondBestMove(null);
                                        setIsThinking(true);
                                        const newGameId = gameId + 1;
                                        setGameId(newGameId);
                                        const currentTurn = turn;
                                        const postedAt = Date.now();
                                        const postedDebug = {
                                            active: true,
                                            gameId: newGameId,
                                            turn: currentTurn,
                                            targetDepth: analysisDepth,
                                            completedDepth: -2,
                                            currentDepth: 0,
                                            rootMoves: 0,
                                            phase: 'posted',
                                            bestPreview: '',
                                            score: null,
                                            startedAt: null,
                                            lastProgressAt: postedAt,
                                            lastEvent: 'SEARCH posted',
                                            postedAt,
                                            depthTimes: [] as DepthTime[]
                                        };
                                        aiSearchDebugRef.current = postedDebug;
                                        setAiSearchDebug(postedDebug);
                                        if (workerRef.current) {
                                            const handleAnalysisMessage = (e: MessageEvent) => {
                                                const { type, payload } = e.data;
                                                if (payload?.gameId !== newGameId) return;
                                                if (type === 'SEARCH_STARTED' || type === 'SEARCH_PROGRESS') {
                                                    const now = Date.now();
                                                    const bestPreview = previewMove(payload.bestMove);
                                                    scheduleAiSearchProgress(prev => ({
                                                        ...prev,
                                                        active: true,
                                                        gameId: payload.gameId,
                                                        turn: payload.turn ?? prev.turn,
                                                        targetDepth: payload.maxDepth ?? payload.depth ?? prev.targetDepth,
                                                        completedDepth: payload.completedDepth ?? prev.completedDepth,
                                                        rootMoves: payload.rootMoves ?? prev.rootMoves,
                                                        phase: payload.phase ?? type,
                                                        bestPreview: bestPreview || prev.bestPreview,
                                                        score: payload.score ?? prev.score,
                                                        startedAt: type === 'SEARCH_STARTED' ? now : (prev.startedAt ?? now),
                                                        lastProgressAt: now,
                                                        lastEvent: type === 'SEARCH_STARTED'
                                                            ? `STARTED d=${payload.depth}`
                                                            : `${payload.phase} d=${payload.completedDepth}/${payload.maxDepth ?? '?'}`,
                                                        depthTimes: payload.phase === 'depth' && (payload.completedDepth | 0) > 0
                                                            ? appendDepthTime(prev.depthTimes, payload.completedDepth | 0, payload.elapsedMs ?? 0)
                                                            : prev.depthTimes
                                                    }));
                                                    return;
                                                }
                                                if (type === 'SEARCH_COMPLETE') {
                                                    workerRef.current?.removeEventListener('message', handleAnalysisMessage);
                                                    const prevDbg = flushAiSearchProgress();
                                                    const bestPreview = previewMove(payload.bestMove) || prevDbg.bestPreview;
                                                    const completedDepth = payload.completedDepth ?? prevDbg.completedDepth;
                                                    const thinkingTime = payload.thinkingTime ?? 0;
                                                    const depthTimes = completedDepth > 0
                                                        ? appendDepthTime(prevDbg.depthTimes, completedDepth, thinkingTime)
                                                        : prevDbg.depthTimes;
                                                    const completedDebug = {
                                                        ...prevDbg,
                                                        active: false,
                                                        phase: 'complete',
                                                        completedDepth,
                                                        bestPreview,
                                                        lastEvent: `COMPLETE ${thinkingTime}ms`,
                                                        lastProgressAt: Date.now(),
                                                        depthTimes
                                                    };
                                                    aiSearchDebugRef.current = completedDebug;
                                                    setAiSearchDebug(completedDebug);
                                                    setLastSearchBench({
                                                        thinkingTime,
                                                        completedDepth,
                                                        targetDepth: prevDbg.targetDepth || analysisDepth,
                                                        rootMoves: prevDbg.rootMoves,
                                                        bestPreview,
                                                        depthTimes
                                                    });
                                                    const formattedAnalysisMoves = decodeAnalysisMoves(payload.allMovesWithScores);
                                                    setAnalysisMoves(formattedAnalysisMoves);
                                                    setSelectedAnalysisMove(null);
                                                    setIsPreviewing(false);
                                                    setOriginalBoardForPreview(null);
                                                    setAnalysisBestMove(decodeMove(payload.bestMove) ?? formattedAnalysisMoves[0]?.move ?? null);
                                                    setAnalysisSecondBestMove(decodeMove(payload.secondBestMove) ?? formattedAnalysisMoves[1]?.move ?? null);
                                                    setIsThinking(false);
                                                }
                                            };
                                            workerRef.current.addEventListener('message', handleAnalysisMessage);
                                            workerRef.current.postMessage({
                                                type: 'SEARCH',
                                                payload: {
                                                    board: encodeBoard(board),
                                                    turn: currentTurn,
                                                    depth: analysisDepth,
                                                    randomness: DIFFICULTIES[difficulty].randomness,
                                                    ply: 0,
                                                    gameId: newGameId,
                                                    openingBookEnabled,
                                                    exactRootScores: true,
                                                    exactRootLimit: analysisScale
                                                }
                                            });
                                        }
                                    }}
                                    disabled={(turn === 'red' ? redIsAuto : blackIsAuto) || isThinking || !!gameOver}
                                    style={getButtonStyle()}
                                    className={`px-3 py-4 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 ${isAnalysisMode ? 'bg-blue-600/30 border-blue-500 ring-2 ring-blue-500/30' : ''}`}
                                >
                                    <BarChartIcon className="w-4 h-4" />
                                    <span className="text-xs">Analysis</span>
                                </button>
                                
                                {/* 第2排：Undo, Switch */}
                                <button 
                                    onClick={handleUndo} 
                                    disabled={!!onlineInfo || boardHistory.length < 1 || (!!gameOver && !pendingGameOver) || isThinking} 
                                    style={getButtonStyle()}
                                    className="px-3 py-4 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95"
                                >
                                    <UndoIcon className="w-6 h-6" />
                                    <span className="text-xs">Undo</span>
                                </button>
                                <button 
                                    onClick={handleSwitchSide} 
                                    disabled={!!onlineInfo || !!gameOver || isThinking} 
                                    style={getButtonStyle()}
                                    className="px-3 py-4 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95"
                                >
                                    <ArrowsLeftRightIcon className="w-6 h-6" />
                                    <span className="text-xs">Switch</span>
                                </button>
                                
                                {/* 第3排：Red Manual/Auto, Black Manual/Auto */}
                                <button 
                                    onClick={() => setRedIsAuto(prev => !prev)} 
                                    disabled={!!onlineInfo || !!gameOver || isThinking} 
                                    style={getButtonStyle(!!onlineInfo || !!gameOver || isThinking)}
                                    className={`px-3 py-4 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 ${
                                        redIsAuto ? 'bg-amber-600/30 border-amber-500 ring-2 ring-amber-500/30' : ''
                                    }`}
                                >
                                    <LightBulbIcon className="w-6 h-6" />
                                    <span className="text-xs text-stone-300">R: {redIsAuto ? "Auto" : "Manual"}</span>
                                </button>
                                <button 
                                    onClick={() => setBlackIsAuto(prev => !prev)}
                                    disabled={!!onlineInfo || !!gameOver || isThinking}
                                    style={getButtonStyle(!!onlineInfo || !!gameOver || isThinking)}
                                    className={`px-3 py-4 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 ${
                                        blackIsAuto ? 'bg-amber-600/30 border-amber-500 ring-2 ring-amber-500/30' : ''
                                    }`}
                                >
                                    <LightBulbIcon className="w-6 h-6" />
                                    <span className="text-xs text-stone-300">B: {blackIsAuto ? "Auto" : "Manual"}</span>
                                </button>
                                
                                {/* Try 按钮已移除 */}
                                
                                {/* Analysis button removed from original location (moved to Resign slot) */}
                                
                                {/* 着法序列棋谱控件 - 与Replay模式完全一致 (Analysis模式下显示，或者在Game模式下搜索完成后显示) */}
                                {isAnalysisMode && analysisMoves.length > 0 && (
                                    <div className="col-span-2 mt-2">
                                        {/* 所有着法序列 - 与Replay模式完全一致 */}
                                        <div className="w-full bg-stone-900/90 rounded-md border border-stone-700 p-2 overflow-y-auto text-xs">
                                                <div className="w-full space-y-1 overflow-y-auto max-h-48">
                                                    {analysisMoves.map((item, index) => {
                                                        return (
                                                            <div 
                                                                key={index}
                                                                onClick={() => {
                                                                    if (selectedAnalysisMove === index) {
                                                                        setSelectedAnalysisMove(null);
                                                                    } else {
                                                                        setSelectedAnalysisMove(index);
                                                                    }
                                                                }}
                                                                className={`p-1 border rounded cursor-pointer ${selectedAnalysisMove === index ? 'bg-stone-700 border-stone-500' : 'bg-stone-800/50 border-stone-700'}`}
                                                            >
                                                                <div className="flex items-center whitespace-nowrap">
                                                                    <span className="text-stone-300 font-mono whitespace-nowrap">({index + 1})({Math.round(item.score)})</span>
                                                                </div>
                                                                {/* 显示着法序列 */}
                                                                {selectedAnalysisMove === index && item.moveSequence.length > 0 && (
                                                                    <div className="mt-1 text-xs text-stone-400 font-mono">
                                                                        {/* 显示着法序列 */}
                                                                        {item.moveSequence.map((seqMove, seqIndex) => {
                                                                            return (
                                                                                <div 
                                                                                    key={seqIndex}
                                                                                    onClick={async (e) => {
                                                                                        e.stopPropagation();
                                                                                        // 保存当前棋盘状态作为预览的基准（如果是第一次预览）
                                                                                        let baseBoard = originalBoardForPreview;
                                                                                        if (!isPreviewing) {
                                                                                            // 保存当前棋盘状态
                                                                                            const currentBoard = board;
                                                                                            setOriginalBoardForPreview(currentBoard);
                                                                                            setIsPreviewing(true);
                                                                                            baseBoard = currentBoard;
                                                                                        }
                                                                                        
                                                                                        // 确保有基准棋盘状态
                                                                                        if (!baseBoard) return;
                                                                                        
                                                                                        // 创建一个新的棋盘副本
                                                                                        let tempBoard = JSON.parse(JSON.stringify(baseBoard));
                                                                                        
                                                                                        // 应用从第一步到当前选中着法的所有着法
                                                                                        for (let i = 0; i <= seqIndex; i++) {
                                                                                            const previewMove = item.moveSequence[i];
                                                                                            tempBoard[previewMove.to.r][previewMove.to.c] = tempBoard[previewMove.from.r][previewMove.from.c];
                                                                                            tempBoard[previewMove.from.r][previewMove.from.c] = null;
                                                                                        }
                                                                                        
                                                                                        // 更新棋盘状态
                                                                                        setBoard(tempBoard);
                                                                                        
                                                                                        // 重新评估局面并更新 EVALUATION 面板
                                                                                        try {
                                                                                            const nextTurn = (seqIndex + 1) % 2 === 0 ? turn : (turn === 'red' ? 'black' : 'red');
                                                                                            const evaluation = await workerGetDetailedEval(tempBoard, nextTurn, false);
                                                                                            // 将评估结果转换为 moveEvaluation 期望的格式
                                                                                            const formattedEvaluation = {
                                                                                                pre: evaluation,
                                                                                                post: evaluation,
                                                                                                diff: {
                                                                                                    red: {
                                                                                                        total: 0,
                                                                                                        material: 0,
                                                                                                        position: 0,
                                                                                                        safety: 0,
                                                                                                        mobility: 0,
                                                                                                        threat: 0
                                                                                                    },
                                                                                                    black: {
                                                                                                        total: 0,
                                                                                                        material: 0,
                                                                                                        position: 0,
                                                                                                        safety: 0,
                                                                                                        mobility: 0,
                                                                                                        threat: 0
                                                                                                    }
                                                                                                }
                                                                                            };
                                                                                            setMoveEvaluation(formattedEvaluation);
                                                                                        } catch (evalError) {
                                                                                            console.error('获取局面评估失败:', evalError);
                                                                                        }
                                                                                    }}
                                                                                    className="hover:bg-amber-600/30 p-1 rounded transition-all cursor-pointer"
                                                                                >
                                                                                    ({seqMove.from.r},{seqMove.from.c})→({seqMove.to.r},{seqMove.to.c})
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                    </div>
                                )}
                                
                                {/* 对弈与分析共用 AI Bench；分析模式放在着法列表下方 */}
                                {(isThinking || lastSearchBench) && (
                                    <div className={`col-span-2 mt-2 mb-1 rounded-lg border border-stone-700 bg-stone-900/50 p-3 pb-4 font-mono text-xs ${isThinking ? 'text-amber-200/90' : 'text-stone-300'}`}>
                                        <div className="mb-1 text-stone-400">{isThinking ? 'Thinking' : 'Done'}</div>
                                        <div className="space-y-1">
                                            {((isThinking ? aiSearchDebug.rootMoves : lastSearchBench?.rootMoves) || 0) > 0 ? (
                                                <div>Root: {isThinking ? aiSearchDebug.rootMoves : lastSearchBench?.rootMoves}</div>
                                            ) : null}
                                            {(isThinking ? aiSearchDebug.bestPreview : lastSearchBench?.bestPreview) ? (
                                                <div className="truncate">
                                                    PV: {isThinking ? aiSearchDebug.bestPreview : lastSearchBench?.bestPreview}
                                                </div>
                                            ) : null}
                                            <div>
                                                Depth: {isThinking
                                                    ? `${Math.max(0, aiSearchDebug.completedDepth)}/${aiSearchDebug.targetDepth || (isAnalysisMode ? analysisDepth : playDepth)}`
                                                    : `${lastSearchBench?.completedDepth ?? 0}/${lastSearchBench?.targetDepth ?? (isAnalysisMode ? analysisDepth : playDepth)}`}
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 lg:grid-cols-1">
                                                {(isThinking ? aiSearchDebug.depthTimes : lastSearchBench?.depthTimes)?.map((t) => (
                                                    <div key={t.depth}>d{t.depth} {formatBenchTime(t.ms)}</div>
                                                ))}
                                            </div>
                                            {!isThinking && lastSearchBench && !lastSearchBench.depthTimes?.length ? (
                                                <div>Time: {formatBenchTime(lastSearchBench.thinkingTime)}</div>
                                            ) : null}
                                        </div>
                                    </div>
                                )}

                                {/* Try confirmation UI removed */}
                                
                                {/* 退出预览模式按钮 - 放在着法序列下方 */}
                                {isPreviewing && (
                                    <button
                                        onClick={async () => {
                                            if (originalBoardForPreview) {
                                                // 恢复到原始棋盘状态
                                                setBoard(originalBoardForPreview);
                                                setOriginalBoardForPreview(null);
                                                setIsPreviewing(false);
                                                
                                                // 恢复到原始局面后更新EVALUATION面板
                                                try {
                                                    const currentTurn = turn;
                                                    const evaluation = await workerGetDetailedEval(originalBoardForPreview, currentTurn, false);
                                                    // 将评估结果转换为moveEvaluation期望的格式
                                                    const formattedEvaluation = {
                                                        pre: evaluation,
                                                        post: evaluation,
                                                        diff: {
                                                            red: {
                                                                total: 0,
                                                                material: 0,
                                                                position: 0,
                                                                safety: 0,
                                                                mobility: 0,
                                                                threat: 0
                                                            },
                                                            black: {
                                                                total: 0,
                                                                material: 0,
                                                                position: 0,
                                                                safety: 0,
                                                                mobility: 0,
                                                                threat: 0
                                                            }
                                                        }
                                                    };
                                                    setMoveEvaluation(formattedEvaluation);
                                                } catch (evalError) {
                                                    console.error('获取局面评估失败:', evalError);
                                                }
                                            }
                                        }}
                                        className="col-span-2 px-3 py-2 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 mt-1 bg-red-600 hover:bg-red-700 text-white"
                                    >
                                        <ArrowPathIcon className="w-5 h-5" />
                                        <span>Resume</span>
                                    </button>
                                )}
                            </div>
                        )}



                        

                    </div>
                    ) : isSetupMode ? (
                        <div className="flex flex-col h-full animate-fadeIn">

                            
                            {/* 桌面右栏 Setup 可摆棋子；竖屏改由左栏 order-1/3 显示 */}
                            <div className="hidden lg:block">
                                {/* 黑方棋子面板 */}
                                <SidePanel 
                                    color="black" 
                                    playerColor={playerColor}
                                    pieces={topPanelColor === 'black' ? topPanelPieces : bottomPanelPieces}
                                    isSetupMode={isSetupMode}
                                    material={material}
                                    onDragStart={(e, type, c) => handleDragStart(e, {type, color: c})}
                                    onDrop={(e) => handleDropOnPanel(e, 'black')}
                                    recentlyCaptured={recentlyCaptured}
                                />
                                
                                {/* 红方棋子面板 */}
                                <SidePanel 
                                    color="red" 
                                    playerColor={playerColor}
                                    pieces={topPanelColor === 'red' ? topPanelPieces : bottomPanelPieces}
                                    isSetupMode={isSetupMode}
                                    material={material}
                                    onDragStart={(e, type, c) => handleDragStart(e, {type, color: c})}
                                    onDrop={(e) => handleDropOnPanel(e, 'red')}
                                    recentlyCaptured={recentlyCaptured}
                                />
                            </div>
                            
                            {/* 棋盒和按钮之间的间隔 */}
                            <div className="h-4"></div>
                            
                            <div className="grid grid-cols-2 gap-2 mb-2">
                                <label className="w-full cursor-pointer">
                                    <input 
                                        type="file" 
                                        accept=".json" 
                                        onChange={loadGame} 
                                        className="hidden" 
                                    />
                                    <span style={getButtonStyle()} className="w-full py-1 px-2 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs">
                                        <LoadIcon className="w-4 h-4" />
                                        Load
                                    </span>
                                </label>
                                <button 
                                    onClick={saveGame} 
                                    style={getButtonStyle()}
                                    className="w-full py-1 px-2 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs"
                                >
                                    <SaveIcon className="w-4 h-4" />
                                    Save
                                </button>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 mb-2">
                                <button 
                                    onClick={handleSwitchSide} 
                                    style={getButtonStyle()}
                                    className="w-full py-1 px-2 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs"
                                >
                                    <ArrowPathIcon className="w-4 h-4" />
                                    Switch
                                </button>
                                <button 
                                    onClick={() => {
                                        // Analysis按钮功能：分析当前的Setup局面做一次分析，然后填充到EVALUATION中
                                        analyzeCurrentPosition();
                                    }}
                                    disabled={isAnalyzing}
                                    style={getButtonStyle()}
                                    className="w-full py-1 px-2 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs"
                                >
                                    {isAnalyzing ? (
                                        <div className="w-4 h-4 border-2 border-stone-300 border-t-transparent rounded-full animate-spin"></div>
                                    ) : (
                                        <BarChartIcon className="w-4 h-4" />
                                    )}
                                    Analysis
                                </button>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2">
                                <button 
                                    onClick={async () => {
                                        await exitSetupMode(); // 检查红帅和黑将
                                        resetBoardIndicators();
                                        setActiveTab('game');
                                    }} 
                                    style={getButtonStyle()}
                                    className="w-full py-1 px-2 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs"
                                >
                                    <PlayIcon className="w-4 h-4" />
                                    Play
                                </button>
                                <button 
                                    onClick={() => {
                                        // Exit按钮功能：直接退出Setup标签返回Game标签，不调用exitSetupMode
                                        resetBoardIndicators();
                                        setActiveTab('game');
                                        // 退出Setup模式状态
                                        setIsSetupMode(false);
                                        setGameOver(null);
                                        // 清空棋局
                                        setBoard(createInitialBoard());
                                        setBoardHistory([createInitialBoard()]);
                                        setMoveHistory([]);
                                        setHasStarted(false);
                                    }}
                                    style={getButtonStyle()}
                                    className="w-full py-1 px-2 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs bg-red-600/80 hover:bg-red-500/80 border-red-500"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    Exit
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col h-full animate-fadeIn">
                             <div className="text-center mb-2">
                                <div className="text-lg font-mono text-white">{replayIndex} <span className="text-stone-500 text-xs">/ {allReplayBoards.length - 1}</span></div>
                            </div>
                            
                            {/* 棋谱着法和分析结果并排显示 */}
                            <div className="flex gap-4 mb-3" style={{ height: '300px', width: '100%' }}>
                                {/* 棋谱着法面板 - 左侧 */}
                                <div className="flex-1 bg-stone-900/90 rounded-md border border-stone-700 p-2 overflow-x-auto text-xs whitespace-nowrap">
                                    {replayNotation.length > 0 ? (
                                        <div className="inline-flex flex-wrap">
                                            {replayNotation.map((move, index) => (
                                                <div
                                                    key={index}
                                                    className={`inline-block px-2 py-0.5 border border-stone-700/50 hover:bg-stone-700/30 transition-colors cursor-pointer mx-1 mb-1 ${replayIndex === index + 1 ? 'bg-amber-600/30 text-amber-300 font-bold' : ''}`}
                                                    onClick={() => jumpReplay(index + 1)}
                                                    style={{ fontFamily: 'monospace', fontSize: '0.7rem', whiteSpace: 'nowrap' }}
                                                >
                                                    {index + 1}.{move}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-stone-400 text-center py-5" style={{ fontSize: '0.7rem' }}>
                                        </div>
                                    )}
                                </div>
                                
                                {/* 分析结果面板 - 右侧 */}
                                <div className="flex-1 bg-stone-900/90 rounded-md border border-stone-700 p-2 overflow-y-auto text-xs">
                                    {analysisMoves.length > 0 ? (
                                        <div className="w-full h-full space-y-1 overflow-y-auto">
                                            {analysisMoves.map((item, index) => {
                                                return (
                                                    <div 
                                                        key={index}
                                                        onClick={() => {
                                                            if (selectedAnalysisMove === index) {
                                                                setSelectedAnalysisMove(null);
                                                            } else {
                                                                setSelectedAnalysisMove(index);
                                                            }
                                                        }}
                                                        className={`p-1 border rounded cursor-pointer ${selectedAnalysisMove === index ? 'bg-stone-700 border-stone-500' : 'bg-stone-800/50 border-stone-700'}`}
                                                    >
                                                        <div className="flex items-center whitespace-nowrap">
                                                            <span className="text-stone-300 font-mono whitespace-nowrap">({index + 1})({Math.round(item.score)})</span>
                                                        </div>
                                                        {/* 显示着法序列 */}
                                                        {selectedAnalysisMove === index && item.moveSequence.length > 0 && (
                                                            <div className="mt-1 text-xs text-stone-400 font-mono">
                                                                {/* 显示着法序列 */}
                                                                {item.moveSequence.map((seqMove, seqIndex) => {
                                                                    return (
                                                                        <div 
                                                                            key={seqIndex}
                                                                            onClick={async (e) => {
                                                                                e.stopPropagation();
                                                                                // 保存当前棋盘状态作为预览的基准（如果是第一次预览）
                                                                                let baseBoard = originalBoardForPreview;
                                                                                if (!isPreviewing) {
                                                                                    // 保存当前Replay模式下的棋盘状态
                                                                                    const currentBoard = allReplayBoards[replayIndex];
                                                                                    setOriginalBoardForPreview(currentBoard);
                                                                                    setIsPreviewing(true);
                                                                                    baseBoard = currentBoard;
                                                                                }
                                                                                
                                                                                // 确保有基准棋盘状态
                                                                                if (!baseBoard) return;
                                                                                
                                                                                // 创建一个新的棋盘副本
                                                                                let tempBoard = JSON.parse(JSON.stringify(baseBoard));
                                                                                
                                                                                // 应用从第一步到当前选中着法的所有着法
                                                                                for (let i = 0; i <= seqIndex; i++) {
                                                                                    const previewMove = item.moveSequence[i];
                                                                                    tempBoard[previewMove.to.r][previewMove.to.c] = tempBoard[previewMove.from.r][previewMove.from.c];
                                                                                    tempBoard[previewMove.from.r][previewMove.from.c] = null;
                                                                                }
                                                                                
                                                                                // 更新棋盘状态
                                                                                setBoard(tempBoard);
                                                                                
                                                                                // 重新评估局面并更新 EVALUATION 面板
                                                                                try {
                                                                                    const nextTurn = (seqIndex + 1) % 2 === 0 ? (replayIndex % 2 === 0 ? 'red' : 'black') : (replayIndex % 2 === 0 ? 'black' : 'red');
                                                                                    const evaluation = await workerGetDetailedEval(tempBoard, nextTurn, true);
                                                                                    // 将评估结果转换为 replayEvaluation 期望的格式
                                                                                    const formattedEvaluation = {
                                                                                        pre: evaluation,
                                                                                        post: evaluation,
                                                                                        diff: {
                                                                                            red: {
                                                                                                total: 0,
                                                                                                material: 0,
                                                                                                position: 0,
                                                                                                safety: 0,
                                                                                                mobility: 0,
                                                                                                threat: 0
                                                                                            },
                                                                                            black: {
                                                                                                total: 0,
                                                                                                material: 0,
                                                                                                position: 0,
                                                                                                safety: 0,
                                                                                                mobility: 0,
                                                                                                threat: 0
                                                                                            }
                                                                                        }
                                                                                    };
                                                                                    setReplayEvaluation(formattedEvaluation);
                                                                                } catch (evalError) {
                                                                                    console.error('获取局面评估失败:', evalError);
                                                                                }
                                                                            }}
                                                                            className="hover:bg-amber-600/30 p-1 rounded transition-all cursor-pointer"
                                                                        >
                                                                            ({seqMove.from.r},{seqMove.from.c})→({seqMove.to.r},{seqMove.to.c})
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-stone-400 text-center py-5" style={{ fontSize: '0.7rem' }}>
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {/* 退出预览模式按钮 - Replay模式下 */}
                            {isPreviewing && (
                                <button
                                    onClick={async () => {
                                        if (originalBoardForPreview) {
                                            // 恢复到原始棋盘状态
                                            setBoard(originalBoardForPreview);
                                            setOriginalBoardForPreview(null);
                                            setIsPreviewing(false);
                                            
                                            // 恢复到原始局面后更新EVALUATION面板
                                            try {
                                                const currentTurn = replayIndex % 2 === 0 ? 'red' : 'black';
                                                const evaluation = await workerGetDetailedEval(originalBoardForPreview, currentTurn, true);
                                                // 将评估结果转换为replayEvaluation期望的格式
                                                const formattedEvaluation = {
                                                    pre: evaluation,
                                                    post: evaluation,
                                                    diff: {
                                                        red: {
                                                            total: 0,
                                                            material: 0,
                                                            position: 0,
                                                            safety: 0,
                                                            mobility: 0,
                                                            threat: 0
                                                        },
                                                        black: {
                                                            total: 0,
                                                            material: 0,
                                                            position: 0,
                                                            safety: 0,
                                                            mobility: 0,
                                                            threat: 0
                                                        }
                                                    }
                                                };
                                                setReplayEvaluation(formattedEvaluation);
                                            } catch (evalError) {
                                                console.error('获取局面评估失败:', evalError);
                                            }
                                        }
                                    }}
                                    className="w-full p-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-all flex items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 mt-2"
                                >
                                    <ArrowPathIcon className="w-5 h-5" />
                                    <span>Resume</span>
                                </button>
                            )}
                            
                            {/* 按钮布局：第1排Load和Save，第2排Switch和Analysis，第3排Play和Exit */}
                            <div className="grid grid-cols-2 gap-2 mb-2">
                                <label className="w-full cursor-pointer">
                                    <input 
                                        type="file" 
                                        accept=".json" 
                                        onChange={loadGameRecord} 
                                        className="hidden" 
                                    />
                                    <span style={getButtonStyle()} className="w-full py-1 px-2 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs">
                                        <LoadIcon className="w-4 h-4" />
                                        Load
                                    </span>
                                </label>
                                <button 
                                    onClick={saveGameRecord} 
                                    style={getButtonStyle()}
                                    className="w-full py-1 px-2 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs"
                                >
                                    <SaveIcon className="w-4 h-4" />
                                    Save
                                </button>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 mb-2">
                                <button 
                                    onClick={handleSwitchSide} 
                                    style={getButtonStyle()}
                                    className="w-full py-1 px-2 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs"
                                >
                                    <ArrowPathIcon className="w-4 h-4" />
                                    Switch
                                </button>
                                <button 
                                    onClick={analyzeCurrentPosition}
                                    disabled={isAnalyzing}
                                    style={getButtonStyle()}
                                    className="w-full py-1 px-2 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs"
                                >
                                    {isAnalyzing ? (
                                        <div className="w-4 h-4 border-2 border-stone-300 border-t-transparent rounded-full animate-spin"></div>
                                    ) : (
                                        <BarChartIcon className="w-4 h-4" />
                                    )}
                                    Analysis
                                </button>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2">
                                <button 
                                    onClick={() => {
                                        playFromHere();
                                        resetBoardIndicators();
                                        setActiveTab('game');
                                    }} 
                                    style={getButtonStyle()}
                                    className="w-full py-1 px-2 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs"
                                >
                                    <PlayIcon className="w-4 h-4" />
                                    Play
                                </button>
                                <button 
                                    onClick={exitReplay}
                                    style={getButtonStyle()}
                                    className="w-full py-1 px-2 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 text-xs bg-red-600/80 hover:bg-red-500/80 border-red-500"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    Exit
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default App;

