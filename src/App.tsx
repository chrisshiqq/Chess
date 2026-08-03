
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChessBoard, CELL_SIZE, BOARD_OFFSET, SKINS } from './components/ChessBoard';
import { SidePanel } from './components/CapturedPiecesPanel';
import { ChessPiece } from './components/ChessPiece';
import { EvaluationPanel } from './components/EvaluationPanel';
import { 
    ArrowPathIcon, 
    BarChartIcon,
    BookOpenIcon,
    GearIcon, 
    LightBulbIcon, 
    PlayIcon, 
    StopIcon, 
    UndoIcon, 
    SparklesIcon,
    QuestionMarkCircleIcon,
    MagicWandIcon,
    SpeakerWaveIcon,
    RocketLaunchIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    FirstPageIcon,
    LastPageIcon,
    CheckIcon,
    SaveIcon,
    LoadIcon,
    PaletteIcon,
    ClockIcon,
    SquareIcon,
    AdjustmentsIcon
} from './components/Icons';
import { ClockDisplay, FlyingPiece, formatTime } from './AppUI';
import { LobbyScreen, type LocalPlayMode } from './components/LobbyScreen';
import { PeerSession, generateRoomCode } from './net/PeerSession';
import type { AppScreen, ConnectionStatus, NetMessage, OnlineSessionInfo } from './net/types';

/*
import { 
    createInitialBoard, 
    createEmptyBoard, 
    DIFFICULTIES 
} from './src/utils/chessEngine';
*/
import { Board, Color, Position, Move, PieceType, Piece, GameStatusResult, Skin, DifficultyLevel, PieceMaterial, CompactBoard } from './types';

const ROWS = 10;
const COLS = 9;

type SearchBench = {
    thinkingTime: number;
    completedDepth?: number;
    perf?: {
        alphaBetaCalls?: number;
        legalMovesSearched?: number;
        evaluateBoardMs?: number;
        fastLeafEvalCount?: number;
        fastLeafEvalMs?: number;
        pieceList?: boolean;
        prepareSearchInfoMs?: number;
        tt?: {
            hits?: number;
            hitRate?: string | number;
            stores?: number;
        };
    };
};

const formatBenchNumber = (value?: number) => (value ?? 0).toLocaleString();
const formatBenchTime = (value?: number) => `${((value ?? 0) / 1000).toFixed(2)}s`;

// --- Board Initialization ---
// --- Enhanced Difficulty Configuration ---
const DIFFICULTIES: Record<DifficultyLevel, { depth: number; randomness: number; timeLimit: number }> = {
    easy: { depth: 3, randomness: 0.0, timeLimit: 3000 },      // 3秒，有一定随机性
    medium: { depth: 5, randomness: 0.0, timeLimit: 5000 },  // 5秒，较少随机性
    hard: { depth: 8, randomness: 0.0, timeLimit: 10000 }       // 10 seconds, strongest search
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

// 将棋盘转换为紧凑格式：10行9列的二维数组，每个元素是-1（空）或0-13（棋子）
// 红方棋子：0-6，黑方棋子：7-13
// 类型映射：general:0/7, advisor:1/8, elephant:2/9, horse:3/10, chariot:4/11, cannon:5/12, soldier:6/13
export const boardToCompactFormat = (board: Board): CompactBoard => {
    const compactBoard: CompactBoard = Array(ROWS).fill(null).map(() => Array(COLS).fill(-1));
    
    // 棋子类型到数字的映射
    const pieceTypeToNumber = {
        'general': 0,
        'advisor': 1,
        'elephant': 2,
        'horse': 3,
        'chariot': 4,
        'cannon': 5,
        'soldier': 6
    };
    
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const piece = board[r][c];
            if (piece) {
                const baseNumber = pieceTypeToNumber[piece.type];
                const colorOffset = piece.color === 'red' ? 0 : 7;
                compactBoard[r][c] = baseNumber + colorOffset;
            }
        }
    }
    
    return compactBoard;
};

// 将紧凑格式转换回标准棋盘格式
const compactFormatToBoard = (compactBoard: CompactBoard): Board => {
    const board: Board = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
    
    // 数字到棋子类型的映射
    const numberToPieceType: Record<number, PieceType> = {
        0: 'general', 7: 'general',
        1: 'advisor', 8: 'advisor',
        2: 'elephant', 9: 'elephant',
        3: 'horse', 10: 'horse',
        4: 'chariot', 11: 'chariot',
        5: 'cannon', 12: 'cannon',
        6: 'soldier', 13: 'soldier'
    };
    
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const compactValue = compactBoard[r][c];
            
            if (compactValue !== -1) {
                const pieceType = numberToPieceType[compactValue];
                const color = compactValue < 7 ? 'red' : 'black';
                board[r][c] = { type: pieceType, color };
            }
        }
    }
    
    return board;
};

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
    const handleRestartRef = useRef<() => void>(() => {});
    const boardSnapshotRef = useRef<Board>(createInitialBoard());
    const moveHistorySnapshotRef = useRef<Move[]>([]);

    const [board, setBoard] = useState<Board>(createInitialBoard());
    const [turn, setTurn] = useState<Color>('red');
    const [playerColor, setPlayerColor] = useState<Color>('red');
    const [coordinateStyle, setCoordinateStyle] = useState<'chinese' | 'western'>('western');
    
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
        tactic: number;
    } | null>(null);
    
    const [boardHistory, setBoardHistory] = useState<Board[]>([createInitialBoard()]);
    const [moveHistory, setMoveHistory] = useState<Move[]>([]);
    
    const [gameOver, setGameOver] = useState<GameStatusResult | null>(null);
    const [checkAlert, setCheckAlert] = useState<boolean>(false);
    const [pendingGameOver, setPendingGameOver] = useState<GameStatusResult | null>(null);
    const gameOverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const [isAutoMovePending, setIsAutoMovePending] = useState<boolean>(false);
    const [enableTimeLimit, setEnableTimeLimit] = useState<boolean>(false); // 控制AI时间限制逻辑的开关
    const [isReplaying, setIsReplaying] = useState<boolean>(false);
    const [replayIndex, setReplayIndex] = useState<number>(0);
    const [replayNotation, setReplayNotation] = useState<string[]>([]);
    const [analysisMoves, setAnalysisMoves] = useState<Array<{move: Move, score: number, moveSequence: Move[]}>>([]); // 分析结果
    const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false); // 是否正在分析
    const [selectedAnalysisMove, setSelectedAnalysisMove] = useState<number | null>(null); // 选中的分析着法索引
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [isMuted, setIsMuted] = useState<boolean>(false);
    const [isMusicEnabled, setIsMusicEnabled] = useState<boolean>(true); // 默认打开
    const [musicTrigger, setMusicTrigger] = useState<number>(0); // 用于触发音乐循环启动

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
    const musicLoopActiveRef = useRef<boolean>(false); // 追踪音乐循环是否激活


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
    const [positionHistory, setPositionHistory] = useState<Array<{ 
        hash: string; 
        capturedTarget?: { type: PieceType; position: Position };
        initiator?: Color; // 主动发起方（将军或捉子的一方）
        isCheck?: boolean; // 是否将军
        isChase?: boolean; // 是否捉子
    }>>([]);
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

    const [aiDepth, setAiDepth] = useState<number>(8);
    const [lastSearchBench, setLastSearchBench] = useState<SearchBench | null>(null);
    const [bestMoveSequence, setBestMoveSequence] = useState<Move[]>([]);
    const [secondBestMoveSequence, setSecondBestMoveSequence] = useState<Move[]>([]);
    const [bestMoveScore, setBestMoveScore] = useState<number>(0);
    const [secondBestMoveScore, setSecondBestMoveScore] = useState<number>(0);
    // 隐藏最优着法和次优着法
    const [hiddenBestMove, setHiddenBestMove] = useState<Move | null>(null);
    const [suboptimalMove, setSuboptimalMove] = useState<Move | null>(null);
    // 最近被吃的棋子
    const [recentlyCaptured, setRecentlyCaptured] = useState<{ color: Color; type: PieceType } | null>(null);
    // 保存原始棋盘状态用于预览未来局面
    const [originalBoardForPreview, setOriginalBoardForPreview] = useState<Board | null>(null);
    const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
    // Analysis模式状态
    const [isAnalysisMode, setIsAnalysisMode] = useState<boolean>(false);
    // 修改moveEvaluation状态结构，存储走棋前后的完整分数数据，支持红黑双方
    interface PlayerEvaluation {
        total: number;
        material: number;
        position: number;
        tactic: number;
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
            red: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 }
        },
        post: {
            red: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 }
        },
        diff: {
            red: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 }
        }
    });
    
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
        setFlyingPiece(null);
    };
    
    // Custom board color settings
    const [boardBgColor, setBoardBgColor] = useState('#e0c090'); // 默认棋盘背景色
    const [boardLineColor, setBoardLineColor] = useState('#8b4513'); // 默认棋盘线颜色
    const [enableCustomColors, setEnableCustomColors] = useState(false); // 开关：是否启用自定义棋盘颜色

    // Derive dual mode from auto settings: both players are manual (not auto)
    
    // Retry and Confirm functionality for Dual Mode
    const [isRetryMode, setIsRetryMode] = useState(false); // 是否处于重试模式
    const [hasMovedInRetryMode, setHasMovedInRetryMode] = useState(false); // 在重试模式下是否已经走过棋
    const [originalBoard, setOriginalBoard] = useState<Board>(createInitialBoard()); // 保存原始棋盘状态
    const [originalMoveHistory, setOriginalMoveHistory] = useState<Move[]>([]); // 保存原始移动历史
    const [originalPositionHistory, setOriginalPositionHistory] = useState<any[]>([]); // 保存原始局面历史
    const [originalRedStepCount, setOriginalRedStepCount] = useState(0); // 保存原始红方步数
    const [originalBlackStepCount, setOriginalBlackStepCount] = useState(0); // 保存原始黑方步数
    
    // Player turn counters
    const [redStepCount, setRedStepCount] = useState(0);
    const [blackStepCount, setBlackStepCount] = useState(0);
    
    // 连续无吃子回合计数器 (双方各走一步算一个回合)
    const [drawMoveCounter, setDrawMoveCounter] = useState(0);
    
    // Difficulty State - Default MEDIUM
    const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');

    // Game ID to prevent zombie AI moves after restart
    const [gameId, setGameId] = useState(0);

    // Chess AI with Opening Book
    const [openingBookEnabled, setOpeningBookEnabled] = useState(true);

    // VALUE_WEIGHTS for chess evaluation
    const [valueWeights, setValueWeights] = useState({
        material: 1,
        position: 1,
        threat: 1,
        tactic: 1,
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

    // Worker函数调用封装
    const workerGetValidMoves = useRef((board: Board, pos: Position): Promise<Position[]> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const timeoutId = setTimeout(() => {
                workerRef.current?.removeEventListener('message', handleMessage);
                console.warn('⚠️ workerGetValidMoves timeout, returning empty moves');
                resolve([]); // 返回空数组，避免卡住
            }, 1000); // 1秒超时

            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'validMoves') {
                    clearTimeout(timeoutId);
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve(e.data.moves);
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'getValidMoves',
                payload: { board, pos }
            });
        });
    }).current;

    // 获取详细的局面评估分数
    const workerGetDetailedEval = useRef((board: Board, turn: Color, isReplay: boolean = false): Promise<any> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'detailedEvaluation') {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve(e.data.evaluation);
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'evaluateBoard',
                payload: { board, turn, isReplay, depth: aiDepth }
            });
        });
    }).current;

    // 获取单个棋子的评估分数
    const workerGetPieceEval = useRef((board: Board, pos: Position, turn: Color): Promise<any> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'pieceEvaluation') {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve(e.data.evaluation);
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'evaluatePiece',
                payload: { board, pos, turn }
            });
        });
    }).current;

    const workerCheckGameState = useRef((board: Board, turn: Color): Promise<GameStatusResult> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'gameState' && e.data.requestId === requestId) {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve(e.data.state);
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'checkGameState',
                payload: { board, turn, requestId }
            });
        });
    }).current;

    const workerIsCheck = useRef((board: Board, color: Color): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'check' && e.data.requestId === requestId) {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve(e.data.isCheck);
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'isCheck',
                payload: { board, color, requestId }
            });
        });
    }).current;

    const workerIsValidPlacement = useRef((type: PieceType, color: Color, r: number, c: number): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'validPlacement') {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve(e.data.isValid);
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'isValidPlacement',
                payload: { type, color, r, c }
            });
        });
    }).current;



    const workerGetBestMove = useRef((board: Board, color: Color, depth: number, gameId: number, openingBookEnabled: boolean, randomness: number = 0, ply: number = 0, enableTimeLimit: boolean = true): Promise<{ bestMove: Move | null; secondMove: Move | null; moveSequence: Move[], bestMoveScore: number, secondBestMoveScore: number, allMovesWithScores: Array<{move: Move, score: number, moveSequence: Move[]}> }> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'SEARCH_COMPLETE') {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve({ 
                        bestMove: e.data.payload.bestMove, 
                        secondMove: e.data.payload.secondBestMove,
                        moveSequence: e.data.payload.moveSequence || [],
                        bestMoveScore: e.data.payload.bestMoveScore || 0,
                        secondBestMoveScore: e.data.payload.secondBestMoveScore || 0,
                        allMovesWithScores: e.data.payload.allMovesWithScores || []
                    });
                } else if (e.data.type === 'bestMove') {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve({ 
                        bestMove: e.data.move, 
                        secondMove: e.data.secondMove,
                        moveSequence: e.data.moveSequence || [],
                        bestMoveScore: e.data.bestMoveScore || 0,
                        secondBestMoveScore: e.data.secondBestMoveScore || 0,
                        allMovesWithScores: []
                    });
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'SEARCH',
                payload: { board, turn: color, depth, randomness, ply, gameId, openingBookEnabled, enableTimeLimit, exactRootScores: false }
            });
        });
    }).current;

    // Initialize Worker - ENABLED (Inline Worker to avoid SecurityError)
    useEffect(() => {
        try {
            // Create inline worker to avoid SecurityError with file:// protocol
            // Base64 encoded worker code to avoid escape issues
// Worker initialization - INLINE with Base64 encoding
// Using Base64 to avoid escape issues with multi-line strings
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovDQoNCi8vIOaji+ebmOW4uOmHj+WumuS5iQ0KY29uc3QgUk9XUyA9IDEwOw0KY29uc3QgQ09MUyA9IDk7DQoNCi8vIOaji+WtkOexu+Wei+WumuS5iQ0KY29uc3QgUElFQ0VfVFlQRVMgPSB7DQogICAgR0VORVJBTDogJ2dlbmVyYWwnLA0KICAgIENIQVJJT1Q6ICdjaGFyaW90JywNCiAgICBDQU5OT046ICdjYW5ub24nLA0KICAgIEhPUlNFOiAnaG9yc2UnLA0KICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLA0KICAgIEFEVklTT1I6ICdhZHZpc29yJywNCiAgICBTT0xESUVSOiAnc29sZGllcicNCn07DQoNCi8vIOadkOaWmeWAvOadg+mHjemFjee9rg0KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGdlbmVyYWw6IDEwMDAwLCAgLy8g5bCGL+W4hQ0KICAgIGNoYXJpb3Q6IDkwMCwgICAgIC8vIOi9pg0KICAgIGNhbm5vbjogew0KICAgICAgICBlYXJseTogNDUwLCAgICAvLyDlvIDlsYDpmLbmrrUNCiAgICAgICAgbWlkOiA0MDAsICAgICAgLy8g5Lit5bGA6Zi25q61DQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQ0KICAgIH0sICAgICAgICAgICAgICAgIC8vIOeCrg0KICAgIGhvcnNlOiB7DQogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDQ1MCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsDQogICAgZWxlcGhhbnQ6IDIwMCwgICAgLy8g6LGhL+ebuA0KICAgIGFkdmlzb3I6IDIwMCwgICAgIC8vIOWjqy/ku5UNCiAgICBzb2xkaWVyOiB7DQogICAgICAgIGVhcmx5OiAxMDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDIwMCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSAgICAgICAgICAgICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIOaji+WtkOS7t+WAvOadg+mHjemFjee9rg0KbGV0IFZBTFVFX1dFSUdIVFMgPSB7DQogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQ0KICAgIC8vcG9zaXRpb246IDAuMiwgICAvLyDkvY3nva7lgLzmnYPph40NCiAgICAvL3RocmVhdDogMC4xNSwgICAgLy8g5aiB6IOB5YC85p2D6YeNDQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQ0KICAgIC8vc2FmZXR5OiAwLjEsICAgICAvLyDlronlhajlgLzmnYPph40NCiAgICAvL21vYmlsaXR5OiAwLjA1ICAgLy8g5py65Yqo5YC85p2D6YeNDQoNCiAgICBtYXRlcmlhbDogMSwgICAgLy8g5p2Q5paZ5YC85p2D6YeNDQogICAgcG9zaXRpb246IDEsICAgIC8vIOS9jee9ruWAvOadg+mHjQ0KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQ0KICAgIHRhY3RpYzogMSwgICAgICAvLyDmiJjmnK/lgLzmnYPph40NCiAgICBzYWZldHk6IDEsICAgICAgLy8g5a6J5YWo5YC85p2D6YeNDQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQ0KfTsNCg0KLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XDQpjb25zdCBFVkFMVUFUSU9OX1BBUkFNRVRFUlMgPSB7DQogICAgLy8g5py65Yqo5YC85Y+C5pWwDQogICAgbW9iaWxpdHk6IHsNCiAgICAgICAgYmFzZU1vdmVWYWx1ZTogMSwgICAgICAvLyDln7rnoYDnp7vliqjku7flgLwNCiAgICB9LA0KICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQ0KICAgIGNoZWNrOiB7DQogICAgICAgIGJvbnVzOiA4MA0KICAgIH0NCn07DQoNCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rg0KY29uc3QgUE9TSVRJT05fVEFCTEVTID0gew0KICAgIC8vIOWFtS/ljZLkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBzb2xkaWVyOiBbDQogICAgICAgIFswLCA1LCAxMCwgMTUsIDIwLCAxNSwgMTAsIDUsIDBdLA0KICAgICAgICBbNSwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgY2hhcmlvdDogWw0KICAgICAgICBbNSwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDEwLCA1LCAxNSwgMCwgMTUsIDUsIDEwLCAxMF0sDQogICAgICAgIFswLCAxMCwgNSwgNSwgNSwgNSwgMTAsIDUsIDBdDQogICAgXSwNCiAgICAvLyDpqazkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBob3JzZTogWw0KICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgICAgICAgWzAsIDUsIDI1LCAxMCwgMTAsIDEwLCAyNSwgNSwgMF0sDQogICAgICAgIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sDQogICAgICAgIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMjUsIDIwLCAwLCAyMCwgMjUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgICAgICAgWzUsIDAsIDUsIDUsIDAsIDUsIDUsIDAsIDVdLA0KICAgICAgICBbMCwgMCwgMCwgNSwgLTIwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDngq7kvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBjYW5ub246IFsNCiAgICAgICAgWzEwLCAyMCwgMTUsIDEwLCAwLCAxMCwgMTUsIDIwLCAxMF0sDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLA0KICAgICAgICBbNSwgNSwgMTUsIDUsIDI1LCA1LCAxNSwgNSwgNV0sDQogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLA0KICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogICAgICAgIFsxMCwgMTAsIDE1LCAyMCwgMzAsIDIwLCAxNSwgMTAsIDEwXSwgDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBlbGVwaGFudDogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g5aOr5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgYWR2aXNvcjogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCA1LCAwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDEwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0NCiAgICBdDQp9Ow0KDQovLyDojrflj5bmo4vlrZDnmoTmnZDmlpnlgLwNCmNvbnN0IGdldE1hdGVyaWFsVmFsdWUgPSAocGllY2UsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOw0KICAgIA0KICAgIC8vIOmSiOWvueacieWIhumYtuauteadkOaWmeWAvOeahOWFteenje+8iOWFteOAgeeCruOAgemprO+8ieiwg+aVtOadkOaWmeWAvA0KICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7DQogICAgICAgIHZhbHVlID0gdmFsdWVbZ2FtZVN0YWdlXSB8fCB2YWx1ZS5taWQ7DQogICAgfQ0KICAgIA0KICAgIHJldHVybiB2YWx1ZTsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOS9jee9ruWAvA0KY29uc3QgZ2V0UG9zaXRpb25WYWx1ZSA9IChwaWVjZSwgciwgYykgPT4gew0KICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOw0KICAgIGlmICghdGFibGUpIHJldHVybiAwOw0KICAgIA0KICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqA0KICAgIGNvbnN0IHJvd0lkeCA9IHBpZWNlLmNvbG9yID09PSAncmVkJyA/ICg5LSByKSA6IHI7DQogICAgcmV0dXJuIHRhYmxlW3Jvd0lkeF1bY10gfHwgMDsNCn07DQoNCi8vIFNlYXJjaCBsZWF2ZXMgdXNlIG51bWVyaWMgcGllY2UgY29kZXMuIEZsYXR0ZW4gcG9zaXRpb24gdmFsdWVzIG9uY2Ugc28gdGhlDQovLyBob3QgZXZhbHVhdG9yIG5ldmVyIGhhcyB0byBkZXJlZmVyZW5jZSBhIHBpZWNlIG9iamVjdCBvciBhIG5lc3RlZCB0YWJsZS4NCmNvbnN0IFNFQVJDSF9QT1NJVElPTl9WQUxVRVMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAxNiB9LCAoKSA9PiBuZXcgSW50MTZBcnJheSg5MCkpOw0KKCgpID0+IHsNCiAgICBjb25zdCB0eXBlVGFibGVzID0gWw0KICAgICAgICBudWxsLA0KICAgICAgICBudWxsLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuY2hhcmlvdCwNCiAgICAgICAgUE9TSVRJT05fVEFCTEVTLmhvcnNlLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuZWxlcGhhbnQsDQogICAgICAgIFBPU0lUSU9OX1RBQkxFUy5hZHZpc29yLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuY2Fubm9uLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuc29sZGllcg0KICAgIF07DQogICAgZm9yIChsZXQgcGllY2VDb2RlID0gMTsgcGllY2VDb2RlIDwgMTY7IHBpZWNlQ29kZSsrKSB7DQogICAgICAgIGNvbnN0IHRhYmxlID0gdHlwZVRhYmxlc1twaWVjZUNvZGUgJiA3XTsNCiAgICAgICAgaWYgKCF0YWJsZSkgY29udGludWU7DQogICAgICAgIGNvbnN0IGlzUmVkID0gcGllY2VDb2RlIDwgODsNCiAgICAgICAgY29uc3QgdmFsdWVzID0gU0VBUkNIX1BPU0lUSU9OX1ZBTFVFU1twaWVjZUNvZGVdOw0KICAgICAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgOTA7IHNxKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHIgPSAoc3EgLyA5KSB8IDA7DQogICAgICAgICAgICB2YWx1ZXNbc3FdID0gdGFibGVbaXNSZWQgPyA5IC0gciA6IHJdW3NxICUgOV0gfHwgMDsNCiAgICAgICAgfQ0KICAgIH0NCn0pKCk7DQoNCi8vIOaUu+WHu+S9jeWbvu+8mjkwIOagvOeUqCAzw5dVaW50MzLjgILmkJzntKLlj7blj6rpnIDjgIzmmK/lkKbmlYzmjqfjgI3vvJvngrnmo4svVUkg5LuN55So5o6n5Yi26ICF5YiX6KGo44CCDQpjb25zdCBBVFRBQ0tfV09SRFMgPSAzOw0KY29uc3Qgc2NyYXRjaFJlZEF0dGFjayA9IG5ldyBVaW50MzJBcnJheShBVFRBQ0tfV09SRFMpOw0KY29uc3Qgc2NyYXRjaEJsYWNrQXR0YWNrID0gbmV3IFVpbnQzMkFycmF5KEFUVEFDS19XT1JEUyk7DQovLyB0cnVlPeaQnOe0ouWPtueUqOaUu+WHu+S9jeWbvu+8iOm7mOiupO+8ie+8m2ZhbHNlPeWPtuivhOS8sOS7jeW7uiAxMMOXOSDmjqfliLbogIXooajvvIhBL0LvvIkNCi8vIHRydWU95YWz57O755So5qC85L2NIFVpbnQzMiDmlLsv5a6IL+aOpyBtYXNr77yI6buY6K6k77yJ77ybZmFsc2U9dGhyZWF0L2d1YXJkIOWvueixoeWIl+ihqO+8iEEvQu+8iQ0KLy8gUGFja2VkIGRlc3RpbmF0aW9ucy9yYXlzIGFuZCBpbmxpbmVkIHJlbGF0aW9uIHdyaXRlcyBmb3Igc2VhcmNoIGxlYXZlcy4NCi8vIEtlcHQgc2VwYXJhdGUgZnJvbSB0aGUgb3JpZ2luYWwgc3BlY2lhbGl6ZWQgcGF0aCBmb3IgYmVuY2htYXJrIHZlcmlmaWNhdGlvbi4NCi8vIOaQnOe0ouacn+mXtOe7tOaKpOe0p+WHkeaji+WtkOihqO+8jOmBv+WFjeWPtuivhOS8sC/nnYDms5Xlh4blpIflj43lpI3miavmj48gMTB4OSDlr7nosaHmo4vnm5jvvIhBL0Ig5Y+v5YWz6Zet77yJDQovLyDpnZnpu5jmkJzntKLlkIPlrZDnlJ/miJDlpI3nlKjmkJzntKLmgIHmo4vlrZDooajvvJvni6znq4vlvIDlhbPnlKjkuo4gQS9C44CCDQovLyDku4Xln7rlh4bor4rmlq3lvIDlkK/vvJrpop3lpJYgcGVyZm9ybWFuY2Uubm93IOS8muW9seWTjee7neWvueiAl+aXtu+8jOato+W8j+WvueW8iOS/neaMgeWFs+mXreOAgg0KbGV0IFNFQVJDSF9QUk9GSUxFID0gZmFsc2U7DQoNCmNvbnN0IGNsZWFyQXR0YWNrQml0cyA9IChiaXRzKSA9PiB7DQogICAgYml0c1swXSA9IDA7DQogICAgYml0c1sxXSA9IDA7DQogICAgYml0c1syXSA9IDA7DQp9Ow0KDQpjb25zdCBzZXRBdHRhY2tCaXQgPSAoYml0cywgc3EpID0+IHsNCiAgICBiaXRzW3NxID4+PiA1XSB8PSAoMSA8PCAoc3EgJiAzMSkpOw0KfTsNCg0KY29uc3QgaGFzQXR0YWNrQml0ID0gKGJpdHMsIHNxKSA9PiAoYml0c1tzcSA+Pj4gNV0gJiAoMSA8PCAoc3EgJiAzMSkpKSAhPT0gMDsNCg0KY29uc3QgbWFrZUVtcHR5Q29udHJvbGxlckdyaWQgPSAoKSA9Pg0KICAgIEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpLm1hcCgoKSA9PiBbXSkpOw0KDQovLyDlhbPns7sgbWFza++8muacgOWkmiAzMiDlrZDvvIjkuK3lm73osaHmo4vmu6Hnm5jvvInvvIxiaXQgaSA9IHBpZWNlc0luZm9baV0NCmNvbnN0IFJFTF9TUVVBUkVTID0gOTA7DQpjb25zdCBzY3JhdGNoQXR0YWNrTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7ICAvLyDmlYzlrZDmiYDlnKjmoLzvvJrosIHlnKjmiZPlroMNCmNvbnN0IHNjcmF0Y2hHdWFyZE1hc2sgPSBuZXcgVWludDMyQXJyYXkoUkVMX1NRVUFSRVMpOyAgIC8vIOWPi+WGm+aJgOWcqOagvO+8muiwgeWcqOS/neWugw0KY29uc3Qgc2NyYXRjaENvbnRyb2xNYXNrID0gbmV3IFVpbnQzMkFycmF5KFJFTF9TUVVBUkVTKTsgLy8g56m65o6n5qC877ya6LCB5o6n5Yi25a6D77yI5a+56b2Q5penIGJvYXJkSW5mb++8iQ0KDQpjb25zdCBjbGVhclJlbGF0aW9uTWFza3MgPSAoY2xlYXJDb250cm9sID0gdHJ1ZSkgPT4gew0KICAgIHNjcmF0Y2hBdHRhY2tNYXNrLmZpbGwoMCk7DQogICAgc2NyYXRjaEd1YXJkTWFzay5maWxsKDApOw0KICAgIGlmIChjbGVhckNvbnRyb2wpIHNjcmF0Y2hDb250cm9sTWFzay5maWxsKDApOw0KfTsNCg0KLy8g5qC85L2NIOKGkiBwaWVjZXNJbmZvIOW8leeUqO+8iOabv+S7o+avj+WPtiBuZXcgTWFw77yJDQpjb25zdCBzY3JhdGNoUGllY2VBdFNxID0gbmV3IEFycmF5KFJFTF9TUVVBUkVTKTsNCmNvbnN0IGNsZWFyUGllY2VBdFNxID0gKCkgPT4gew0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgUkVMX1NRVUFSRVM7IGkrKykgc2NyYXRjaFBpZWNlQXRTcVtpXSA9IG51bGw7DQp9Ow0KDQovLyDlpI3nlKggcmVsQ3R477yM6YG/5YWN5q+P5a2QIG5ldyDlsI/lr7nosaENCmNvbnN0IHNjcmF0Y2hSZWxDdHggPSB7DQogICAgdXNlTWFza3M6IHRydWUsDQogICAgc2tpcENvbnRyb2xNYXNrOiBmYWxzZSwgLy8g5pCc57Si5Y+277ya5LiN5YaZ56m65o6nIGNvbnRyb2xNYXNr77yI5LuN5YaZ5pS75Ye75L2N5Zu+K+acuuWKqO+8iQ0KICAgIHBpZWNlSW5kZXg6IDAsDQogICAgYXR0YWNrTWFzazogbnVsbCwNCiAgICBndWFyZE1hc2s6IG51bGwsDQogICAgY29udHJvbE1hc2s6IG51bGwsDQogICAgcmVkQXR0YWNrOiBudWxsLA0KICAgIGJsYWNrQXR0YWNrOiBudWxsDQp9Ow0KDQpjb25zdCBzY3JhdGNoTGVhZlBpZWNlc0luZm8gPSBbXTsNCmNvbnN0IHNjcmF0Y2hMZWFmUGllY2VTbG90cyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDMyIH0sIChfLCBwaWVjZUluZGV4KSA9PiAoew0KICAgIHBpZWNlOiBudWxsLA0KICAgIHBpZWNlQ29kZTogMCwNCiAgICByOiAwLA0KICAgIGM6IDAsDQogICAgc3E6IDAsDQogICAgcGllY2VJbmRleCwNCiAgICBtb3ZlczogW10sDQogICAgYWxseUd1YXJkczogW10sDQogICAgbWF0ZXJpYWxWYWx1ZTogMCwNCiAgICBwb3NpdGlvblZhbHVlOiAwLA0KICAgIHRocmVhdFZhbHVlOiAwLA0KICAgIHNhZmV0eVZhbHVlOiAwLA0KICAgIHRhY3RpY1ZhbHVlOiAwLA0KICAgIG1vYmlsaXR5VmFsdWU6IDAsDQogICAgdGhyZWF0OiBbXSwNCiAgICB0aHJlYXRlbmVkQnk6IFtdLA0KICAgIGd1YXJkOiBbXSwNCiAgICBndWFyZGVkQnk6IFtdLA0KICAgIGNvbnRyb2w6IFtdLA0KICAgIHByb3RlY3Q6IFtdDQp9KSk7DQoNCmNvbnN0IHNjcmF0Y2hMZWFmQm9hcmRJbmZvID0gew0KICAgIHVzZVJlbGF0aW9uTWFza3M6IHRydWUsDQogICAgdXNlQXR0YWNrQml0czogdHJ1ZSwNCiAgICBza2lwQ29udHJvbE1hc2s6IHRydWUsDQogICAgYXR0YWNrTWFzazogc2NyYXRjaEF0dGFja01hc2ssDQogICAgZ3VhcmRNYXNrOiBzY3JhdGNoR3VhcmRNYXNrLA0KICAgIGNvbnRyb2xNYXNrOiBzY3JhdGNoQ29udHJvbE1hc2ssDQogICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgIGJsYWNrQXR0YWNrOiBzY3JhdGNoQmxhY2tBdHRhY2sNCn07DQoNCmxldCBhY3RpdmVTZWFyY2hQaWVjZVN0YXRlID0gbnVsbDsNCg0KY29uc3Qgc2VhcmNoUGllY2VUeXBlQ29kZSA9ICh0eXBlKSA9PiB7DQogICAgc3dpdGNoICh0eXBlKSB7DQogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuR0VORVJBTDogcmV0dXJuIDE7DQogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuQ0hBUklPVDogcmV0dXJuIDI7DQogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuSE9SU0U6IHJldHVybiAzOw0KICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkVMRVBIQU5UOiByZXR1cm4gNDsNCiAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5BRFZJU09SOiByZXR1cm4gNTsNCiAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5DQU5OT046IHJldHVybiA2Ow0KICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLlNPTERJRVI6IHJldHVybiA3Ow0KICAgICAgICBkZWZhdWx0OiByZXR1cm4gMDsNCiAgICB9DQp9Ow0KDQpjb25zdCBzZWFyY2hQaWVjZUNvZGUgPSAocGllY2UpID0+IHNlYXJjaFBpZWNlVHlwZUNvZGUocGllY2UudHlwZSkgKyAocGllY2UuY29sb3IgPT09ICdyZWQnID8gMCA6IDgpOw0KDQpjb25zdCBTRUFSQ0hfTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGVhcmx5OiBuZXcgSW50MTZBcnJheShbMCwgMTAwMDAsIDkwMCwgNDAwLCAyMDAsIDIwMCwgNDUwLCAxMDBdKSwNCiAgICBtaWQ6IG5ldyBJbnQxNkFycmF5KFswLCAxMDAwMCwgOTAwLCA0NTAsIDIwMCwgMjAwLCA0MDAsIDIwMF0pLA0KICAgIGxhdGU6IG5ldyBJbnQxNkFycmF5KFswLCAxMDAwMCwgOTAwLCA0NTAsIDIwMCwgMjAwLCA0MDAsIDQ1MF0pDQp9Ow0KDQpjb25zdCBzZWFyY2hNYXRlcmlhbFRhYmxlID0gKGdhbWVTdGFnZSkgPT4gU0VBUkNIX01BVEVSSUFMX1ZBTFVFU1tnYW1lU3RhZ2VdIHx8IFNFQVJDSF9NQVRFUklBTF9WQUxVRVMubWlkOw0KDQpjb25zdCBjcmVhdGVTZWFyY2hQaWVjZVN0YXRlID0gKGJvYXJkLCBnYW1lU3RhZ2UgPSAnbWlkJykgPT4gew0KICAgIGNvbnN0IHJlY29yZHMgPSBbXTsNCiAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBuZXcgSW50OEFycmF5KFJFTF9TUVVBUkVTKTsNCiAgICBjb25zdCBzcXVhcmVDb2RlcyA9IG5ldyBVaW50OEFycmF5KFJFTF9TUVVBUkVTKTsNCiAgICBjb25zdCBwaWVjZUNvZGVzID0gbmV3IFVpbnQ4QXJyYXkoMzIpOw0KICAgIGNvbnN0IG1hdGVyaWFsVmFsdWVzID0gc2VhcmNoTWF0ZXJpYWxUYWJsZShnYW1lU3RhZ2UpOw0KICAgIGxldCByZWRNYXRlcmlhbCA9IDA7DQogICAgbGV0IHJlZFBvc2l0aW9uID0gMDsNCiAgICBsZXQgYmxhY2tNYXRlcmlhbCA9IDA7DQogICAgbGV0IGJsYWNrUG9zaXRpb24gPSAwOw0KICAgIGxldCByZWRHZW5lcmFsU3EgPSAtMTsNCiAgICBsZXQgYmxhY2tHZW5lcmFsU3EgPSAtMTsNCiAgICBzcXVhcmVUb1Nsb3QuZmlsbCgtMSk7DQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAoIXBpZWNlKSBjb250aW51ZTsNCiAgICAgICAgICAgIGlmIChyZWNvcmRzLmxlbmd0aCA+PSAzMikgcmV0dXJuIG51bGw7DQogICAgICAgICAgICBjb25zdCBzbG90ID0gcmVjb3Jkcy5sZW5ndGg7DQogICAgICAgICAgICByZWNvcmRzLnB1c2goeyBwaWVjZSwgciwgYywgc3E6IHIgKiA5ICsgYywgYWxpdmU6IHRydWUgfSk7DQogICAgICAgICAgICBjb25zdCBjb2RlID0gc2VhcmNoUGllY2VDb2RlKHBpZWNlKTsNCiAgICAgICAgICAgIGlmICgoY29kZSAmIDcpID09PSAxKSB7DQogICAgICAgICAgICAgICAgaWYgKGNvZGUgPCA4KSByZWRHZW5lcmFsU3EgPSByICogOSArIGM7DQogICAgICAgICAgICAgICAgZWxzZSBibGFja0dlbmVyYWxTcSA9IHIgKiA5ICsgYzsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHBpZWNlQ29kZXNbc2xvdF0gPSBjb2RlOw0KICAgICAgICAgICAgc3F1YXJlVG9TbG90W3IgKiA5ICsgY10gPSBzbG90Ow0KICAgICAgICAgICAgc3F1YXJlQ29kZXNbciAqIDkgKyBjXSA9IGNvZGU7DQogICAgICAgICAgICBjb25zdCBtYXRlcmlhbFZhbHVlID0gbWF0ZXJpYWxWYWx1ZXNbY29kZSAmIDddOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25WYWx1ZSA9IFNFQVJDSF9QT1NJVElPTl9WQUxVRVNbY29kZV1bciAqIDkgKyBjXTsNCiAgICAgICAgICAgIGlmIChjb2RlIDwgOCkgew0KICAgICAgICAgICAgICAgIHJlZE1hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICAgICAgcmVkUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgYmxhY2tNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgIGJsYWNrUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICByZXR1cm4gew0KICAgICAgICBib2FyZCwNCiAgICAgICAgcmVjb3JkcywNCiAgICAgICAgc3F1YXJlVG9TbG90LA0KICAgICAgICBzcXVhcmVDb2RlcywNCiAgICAgICAgcGllY2VDb2RlcywNCiAgICAgICAgbWF0ZXJpYWxWYWx1ZXMsDQogICAgICAgIHJlZE1hdGVyaWFsLA0KICAgICAgICByZWRQb3NpdGlvbiwNCiAgICAgICAgYmxhY2tNYXRlcmlhbCwNCiAgICAgICAgYmxhY2tQb3NpdGlvbiwNCiAgICAgICAgcmVkR2VuZXJhbFNxLA0KICAgICAgICBibGFja0dlbmVyYWxTcSwNCiAgICAgICAgbW92ZXJTdGFjazogbmV3IEludDhBcnJheSgzMiksDQogICAgICAgIGNhcHR1cmVkU3RhY2s6IG5ldyBJbnQ4QXJyYXkoMzIpLA0KICAgICAgICBzdGFja0RlcHRoOiAwDQogICAgfTsNCn07DQoNCmNvbnN0IGFjdGl2ZVBpZWNlU3RhdGVGb3IgPSAoYm9hcmQpID0+IHsNCiAgICBjb25zdCBzdGF0ZSA9IGFjdGl2ZVNlYXJjaFBpZWNlU3RhdGU7DQogICAgcmV0dXJuIHN0YXRlICYmIHN0YXRlLmJvYXJkID09PSBib2FyZCA/IHN0YXRlIDogbnVsbDsNCn07DQoNCmNvbnN0IHVwZGF0ZVBpZWNlU3RhdGVBZnRlck1ha2UgPSAoYm9hcmQsIGZyb21TcSwgdG9TcSkgPT4gew0KICAgIGNvbnN0IHN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgaWYgKCFzdGF0ZSkgcmV0dXJuOw0KICAgIGNvbnN0IG1vdmVyU2xvdCA9IHN0YXRlLnNxdWFyZVRvU2xvdFtmcm9tU3FdOw0KICAgIGNvbnN0IGNhcHR1cmVkU2xvdCA9IHN0YXRlLnNxdWFyZVRvU2xvdFt0b1NxXTsNCiAgICBjb25zdCBzdGFja0luZGV4ID0gc3RhdGUuc3RhY2tEZXB0aCsrOw0KICAgIHN0YXRlLm1vdmVyU3RhY2tbc3RhY2tJbmRleF0gPSBtb3ZlclNsb3Q7DQogICAgc3RhdGUuY2FwdHVyZWRTdGFja1tzdGFja0luZGV4XSA9IGNhcHR1cmVkU2xvdDsNCiAgICBpZiAobW92ZXJTbG90IDwgMCkgcmV0dXJuOw0KDQogICAgY29uc3QgbW92ZXIgPSBzdGF0ZS5yZWNvcmRzW21vdmVyU2xvdF07DQogICAgY29uc3QgbW92ZXJDb2RlID0gc3RhdGUucGllY2VDb2Rlc1ttb3ZlclNsb3RdOw0KICAgIGNvbnN0IG1vdmVyUG9zaXRpb25EZWx0YSA9IFNFQVJDSF9QT1NJVElPTl9WQUxVRVNbbW92ZXJDb2RlXVt0b1NxXSAtDQogICAgICAgIFNFQVJDSF9QT1NJVElPTl9WQUxVRVNbbW92ZXJDb2RlXVtmcm9tU3FdOw0KICAgIGlmIChtb3ZlckNvZGUgPCA4KSBzdGF0ZS5yZWRQb3NpdGlvbiArPSBtb3ZlclBvc2l0aW9uRGVsdGE7DQogICAgZWxzZSBzdGF0ZS5ibGFja1Bvc2l0aW9uICs9IG1vdmVyUG9zaXRpb25EZWx0YTsNCiAgICBpZiAoY2FwdHVyZWRTbG90ID49IDApIHsNCiAgICAgICAgY29uc3QgY2FwdHVyZWRDb2RlID0gc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdOw0KICAgICAgICBjb25zdCBjYXB0dXJlZE1hdGVyaWFsID0gc3RhdGUubWF0ZXJpYWxWYWx1ZXNbY2FwdHVyZWRDb2RlICYgN107DQogICAgICAgIGNvbnN0IGNhcHR1cmVkUG9zaXRpb24gPSBTRUFSQ0hfUE9TSVRJT05fVkFMVUVTW2NhcHR1cmVkQ29kZV1bdG9TcV07DQogICAgICAgIGlmIChjYXB0dXJlZENvZGUgPCA4KSB7DQogICAgICAgICAgICBzdGF0ZS5yZWRNYXRlcmlhbCAtPSBjYXB0dXJlZE1hdGVyaWFsOw0KICAgICAgICAgICAgc3RhdGUucmVkUG9zaXRpb24gLT0gY2FwdHVyZWRQb3NpdGlvbjsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIHN0YXRlLmJsYWNrTWF0ZXJpYWwgLT0gY2FwdHVyZWRNYXRlcmlhbDsNCiAgICAgICAgICAgIHN0YXRlLmJsYWNrUG9zaXRpb24gLT0gY2FwdHVyZWRQb3NpdGlvbjsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBtb3Zlci5zcSA9IHRvU3E7DQogICAgbW92ZXIuciA9ICh0b1NxIC8gOSkgfCAwOw0KICAgIG1vdmVyLmMgPSB0b1NxICUgOTsNCiAgICBzdGF0ZS5zcXVhcmVUb1Nsb3RbZnJvbVNxXSA9IC0xOw0KICAgIHN0YXRlLnNxdWFyZVRvU2xvdFt0b1NxXSA9IG1vdmVyU2xvdDsNCiAgICBzdGF0ZS5zcXVhcmVDb2Rlc1tmcm9tU3FdID0gMDsNCiAgICBzdGF0ZS5zcXVhcmVDb2Rlc1t0b1NxXSA9IHN0YXRlLnBpZWNlQ29kZXNbbW92ZXJTbG90XTsNCiAgICBpZiAoKG1vdmVyQ29kZSAmIDcpID09PSAxKSB7DQogICAgICAgIGlmIChtb3ZlckNvZGUgPCA4KSBzdGF0ZS5yZWRHZW5lcmFsU3EgPSB0b1NxOw0KICAgICAgICBlbHNlIHN0YXRlLmJsYWNrR2VuZXJhbFNxID0gdG9TcTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwICYmIChzdGF0ZS5waWVjZUNvZGVzW2NhcHR1cmVkU2xvdF0gJiA3KSA9PT0gMSkgew0KICAgICAgICBpZiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gLTE7DQogICAgICAgIGVsc2Ugc3RhdGUuYmxhY2tHZW5lcmFsU3EgPSAtMTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwKSBzdGF0ZS5yZWNvcmRzW2NhcHR1cmVkU2xvdF0uYWxpdmUgPSBmYWxzZTsNCn07DQoNCmNvbnN0IHVwZGF0ZVBpZWNlU3RhdGVBZnRlclVubWFrZSA9IChib2FyZCwgZnJvbVNxLCB0b1NxKSA9PiB7DQogICAgY29uc3Qgc3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCiAgICBpZiAoIXN0YXRlKSByZXR1cm47DQogICAgY29uc3Qgc3RhY2tJbmRleCA9IC0tc3RhdGUuc3RhY2tEZXB0aDsNCiAgICBjb25zdCBtb3ZlclNsb3QgPSBzdGF0ZS5tb3ZlclN0YWNrW3N0YWNrSW5kZXhdOw0KICAgIGNvbnN0IGNhcHR1cmVkU2xvdCA9IHN0YXRlLmNhcHR1cmVkU3RhY2tbc3RhY2tJbmRleF07DQogICAgaWYgKG1vdmVyU2xvdCA8IDApIHJldHVybjsNCg0KICAgIGNvbnN0IG1vdmVyID0gc3RhdGUucmVjb3Jkc1ttb3ZlclNsb3RdOw0KICAgIGNvbnN0IG1vdmVyQ29kZSA9IHN0YXRlLnBpZWNlQ29kZXNbbW92ZXJTbG90XTsNCiAgICBjb25zdCBtb3ZlclBvc2l0aW9uRGVsdGEgPSBTRUFSQ0hfUE9TSVRJT05fVkFMVUVTW21vdmVyQ29kZV1bZnJvbVNxXSAtDQogICAgICAgIFNFQVJDSF9QT1NJVElPTl9WQUxVRVNbbW92ZXJDb2RlXVt0b1NxXTsNCiAgICBpZiAobW92ZXJDb2RlIDwgOCkgc3RhdGUucmVkUG9zaXRpb24gKz0gbW92ZXJQb3NpdGlvbkRlbHRhOw0KICAgIGVsc2Ugc3RhdGUuYmxhY2tQb3NpdGlvbiArPSBtb3ZlclBvc2l0aW9uRGVsdGE7DQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwKSB7DQogICAgICAgIGNvbnN0IGNhcHR1cmVkQ29kZSA9IHN0YXRlLnBpZWNlQ29kZXNbY2FwdHVyZWRTbG90XTsNCiAgICAgICAgY29uc3QgY2FwdHVyZWRNYXRlcmlhbCA9IHN0YXRlLm1hdGVyaWFsVmFsdWVzW2NhcHR1cmVkQ29kZSAmIDddOw0KICAgICAgICBjb25zdCBjYXB0dXJlZFBvc2l0aW9uID0gU0VBUkNIX1BPU0lUSU9OX1ZBTFVFU1tjYXB0dXJlZENvZGVdW3RvU3FdOw0KICAgICAgICBpZiAoY2FwdHVyZWRDb2RlIDwgOCkgew0KICAgICAgICAgICAgc3RhdGUucmVkTWF0ZXJpYWwgKz0gY2FwdHVyZWRNYXRlcmlhbDsNCiAgICAgICAgICAgIHN0YXRlLnJlZFBvc2l0aW9uICs9IGNhcHR1cmVkUG9zaXRpb247DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBzdGF0ZS5ibGFja01hdGVyaWFsICs9IGNhcHR1cmVkTWF0ZXJpYWw7DQogICAgICAgICAgICBzdGF0ZS5ibGFja1Bvc2l0aW9uICs9IGNhcHR1cmVkUG9zaXRpb247DQogICAgICAgIH0NCiAgICB9DQogICAgbW92ZXIuc3EgPSBmcm9tU3E7DQogICAgbW92ZXIuciA9IChmcm9tU3EgLyA5KSB8IDA7DQogICAgbW92ZXIuYyA9IGZyb21TcSAlIDk7DQogICAgc3RhdGUuc3F1YXJlVG9TbG90W2Zyb21TcV0gPSBtb3ZlclNsb3Q7DQogICAgc3RhdGUuc3F1YXJlVG9TbG90W3RvU3FdID0gY2FwdHVyZWRTbG90Ow0KICAgIHN0YXRlLnNxdWFyZUNvZGVzW2Zyb21TcV0gPSBzdGF0ZS5waWVjZUNvZGVzW21vdmVyU2xvdF07DQogICAgc3RhdGUuc3F1YXJlQ29kZXNbdG9TcV0gPSBjYXB0dXJlZFNsb3QgPj0gMCA/IHN0YXRlLnBpZWNlQ29kZXNbY2FwdHVyZWRTbG90XSA6IDA7DQogICAgaWYgKChtb3ZlckNvZGUgJiA3KSA9PT0gMSkgew0KICAgICAgICBpZiAobW92ZXJDb2RlIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gZnJvbVNxOw0KICAgICAgICBlbHNlIHN0YXRlLmJsYWNrR2VuZXJhbFNxID0gZnJvbVNxOw0KICAgIH0NCiAgICBpZiAoY2FwdHVyZWRTbG90ID49IDAgJiYgKHN0YXRlLnBpZWNlQ29kZXNbY2FwdHVyZWRTbG90XSAmIDcpID09PSAxKSB7DQogICAgICAgIGlmIChzdGF0ZS5waWVjZUNvZGVzW2NhcHR1cmVkU2xvdF0gPCA4KSBzdGF0ZS5yZWRHZW5lcmFsU3EgPSB0b1NxOw0KICAgICAgICBlbHNlIHN0YXRlLmJsYWNrR2VuZXJhbFNxID0gdG9TcTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwKSBzdGF0ZS5yZWNvcmRzW2NhcHR1cmVkU2xvdF0uYWxpdmUgPSB0cnVlOw0KfTsNCg0KY29uc3QgbG93ZXN0U2V0Qml0SW5kZXggPSAobWFzaykgPT4gMzEgLSBNYXRoLmNsejMyKG1hc2sgJiAtbWFzayk7DQoNCmNvbnN0IGZvckVhY2hTZXRCaXQgPSAobWFzaywgZm4pID0+IHsNCiAgICBsZXQgbSA9IG1hc2sgPj4+IDA7DQogICAgd2hpbGUgKG0gIT09IDApIHsNCiAgICAgICAgY29uc3QgYml0ID0gbSAmIC1tOw0KICAgICAgICBmbigzMSAtIE1hdGguY2x6MzIoYml0KSk7DQogICAgICAgIG0gXj0gYml0Ow0KICAgIH0NCn07DQoNCi8vIOS4u+ivhOS8sOWHveaVsCAtIOivpue7huivhOS8sOaji+ebmOWxgOWKv++8iFVJIC8g54K55qOL5YWz57O7IC8g5pCc57Si5Y+2IC8g5qC56IqC54K577yJDQovLyBvcHRpb25zLmZvclNlYXJjaExlYWY6IOS7hei3s+i/h+e7iOWxgCBnZXRWYWxpZE1vdmVz77yI5peg552A5bey5Zyo54i26IqC54K55aSE55CG77yJ77yb5Y+v55So5pS75Ye75L2N5Zu+5Luj5pu/5o6n5Yi26ICF6KGoDQpjb25zdCBldmFsdWF0ZUJvYXJkID0gKGJvYXJkLCBjdXJyZW50UGxheWVyID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcsIG9wdGlvbnMgPSBudWxsKSA9PiB7DQogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgIC8vIOe7n+iuoQ0KICAgIGlmIChjdXJyZW50UGxheWVyKSB7DQogICAgICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnRbY3VycmVudFBsYXllcl0rKzsNCiAgICB9DQogICAgY29uc3QgZm9yU2VhcmNoTGVhZiA9ICEhKG9wdGlvbnMgJiYgb3B0aW9ucy5mb3JTZWFyY2hMZWFmKTsNCg0KICAgIGNvbnN0IG91dHB1dFBoYXNlID0gZ2FtZVN0YWdlOw0KDQogICAgLy8g6YGN5Y6G5qOL55uY77ya5Y+q5pS26ZuG5a2Q5YqbL1BTVO+8m+edgOazlSvlhbPns7vnu5/kuIDlnKggY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMg5LiA5qyh5Yeg5L2V55Sf5oiQ77yI5a+56b2Q54Ku77yJDQogICAgbGV0IHBpZWNlc0luZm8gPSBbXTsNCiAgICBsZXQgcmVkTWF0ZXJpYWwgPSAwLCByZWRQb3NpdGlvbiA9IDA7DQogICAgbGV0IGJsYWNrTWF0ZXJpYWwgPSAwLCBibGFja1Bvc2l0aW9uID0gMDsNCiAgICANCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBjb25zdCBtYXRlcmlhbFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uVmFsdWUgPSBnZXRQb3NpdGlvblZhbHVlKHBpZWNlLCByLCBjKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKHBpZWNlLmNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgIHJlZE1hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICAgICAgcmVkUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgYmxhY2tNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgIGJsYWNrUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgcGllY2VzSW5mby5wdXNoKHsNCiAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICByLA0KICAgICAgICAgICAgICAgIGMsDQogICAgICAgICAgICAgICAgcGllY2VJbmRleDogcGllY2VzSW5mby5sZW5ndGgsDQogICAgICAgICAgICAgICAgbW92ZXM6IFtdLA0KICAgICAgICAgICAgICAgIGFsbHlHdWFyZHM6IFtdLA0KICAgICAgICAgICAgICAgIG1hdGVyaWFsVmFsdWUsDQogICAgICAgICAgICAgICAgcG9zaXRpb25WYWx1ZSwNCiAgICAgICAgICAgICAgICB0aHJlYXRWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICBzYWZldHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICB0YWN0aWNWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlOiAwLA0KICAgICAgICAgICAgICAgIHRocmVhdDogW10sDQogICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICBndWFyZDogW10sDQogICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICBjb250cm9sOiBbXSwNCiAgICAgICAgICAgICAgICBwcm90ZWN0OiBbXQ0KICAgICAgICAgICAgfSk7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDlhbPns7sgbWFza++8iOKJpDMyIOWtkO+8ieS8mOWFiO+8m+WQpuWImeWbnumAgOaXp+WIl+ihqCAvIOWPtuaUu+WHu+S9jeWbvg0KICAgIGNvbnN0IHVzZVJlbGF0aW9uTWFza3MgPSBwaWVjZXNJbmZvLmxlbmd0aCA8PSAzMjsNCiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gZmFsc2U7DQogICAgbGV0IGJvYXJkSW5mbzsNCiAgICBpZiAodXNlUmVsYXRpb25NYXNrcykgew0KICAgICAgICBjbGVhclJlbGF0aW9uTWFza3MoIWZvclNlYXJjaExlYWYpOw0KICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaFJlZEF0dGFjayk7DQogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOw0KICAgICAgICBib2FyZEluZm8gPSB7DQogICAgICAgICAgICB1c2VSZWxhdGlvbk1hc2tzOiB0cnVlLA0KICAgICAgICAgICAgdXNlQXR0YWNrQml0czogdHJ1ZSwNCiAgICAgICAgICAgIHNraXBDb250cm9sTWFzazogISFmb3JTZWFyY2hMZWFmLA0KICAgICAgICAgICAgYXR0YWNrTWFzazogc2NyYXRjaEF0dGFja01hc2ssDQogICAgICAgICAgICBndWFyZE1hc2s6IHNjcmF0Y2hHdWFyZE1hc2ssDQogICAgICAgICAgICBjb250cm9sTWFzazogc2NyYXRjaENvbnRyb2xNYXNrLA0KICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICB9Ow0KICAgIH0gZWxzZSBpZiAodXNlQXR0YWNrQml0cykgew0KICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaFJlZEF0dGFjayk7DQogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOw0KICAgICAgICBib2FyZEluZm8gPSB7DQogICAgICAgICAgICB1c2VBdHRhY2tCaXRzOiB0cnVlLA0KICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICB9Ow0KICAgIH0gZWxzZSB7DQogICAgICAgIGJvYXJkSW5mbyA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7DQogICAgfQ0KICAgIGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMoYm9hcmQsIHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbywgZm9yU2VhcmNoTGVhZik7DQogICAgDQogICAgLy8g56ys5LiJ5q2l77ya6K6h566X5oC75YiG77yI5Y+q6K6h566X5Ymp5L2Z5YiG5pWw77yM5Z+656GA5YiG5pWw5bey5Zyo5qOL55uY6YGN5Y6G5pe26K6h566X77yJDQogICAgbGV0IHJlZFRocmVhdCA9IDAsIHJlZFRhY3RpYyA9IDAsIHJlZFNhZmV0eSA9IDAsIHJlZE1vYmlsaXR5ID0gMDsNCiAgICBsZXQgYmxhY2tUaHJlYXQgPSAwLCBibGFja1RhY3RpYyA9IDAsIGJsYWNrU2FmZXR5ID0gMCwgYmxhY2tNb2JpbGl0eSA9IDA7DQogICAgDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgY29uc3QgeyBwaWVjZSwgdGhyZWF0VmFsdWUsIHRhY3RpY1ZhbHVlLCBzYWZldHlWYWx1ZSwgbW9iaWxpdHlWYWx1ZSB9ID0gaW5mbzsNCiAgICAgICAgDQogICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgIHJlZFRocmVhdCArPSB0aHJlYXRWYWx1ZTsNCiAgICAgICAgICAgIHJlZFRhY3RpYyArPSB0YWN0aWNWYWx1ZTsNCiAgICAgICAgICAgIHJlZFNhZmV0eSArPSBzYWZldHlWYWx1ZTsNCiAgICAgICAgICAgIHJlZE1vYmlsaXR5ICs9IG1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBibGFja1RocmVhdCArPSB0aHJlYXRWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrVGFjdGljICs9IHRhY3RpY1ZhbHVlOw0KICAgICAgICAgICAgYmxhY2tTYWZldHkgKz0gc2FmZXR5VmFsdWU7DQogICAgICAgICAgICBibGFja01vYmlsaXR5ICs9IG1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g6K6h566X5bGA5Yq/5oC75YiGDQogICAgY29uc3QgcmVkVG90YWwgPSANCiAgICAgICAgcmVkTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgcmVkUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsNCiAgICAgICAgcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKw0KICAgICAgICByZWRUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArDQogICAgICAgIHJlZFNhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsNCiAgICAgICAgcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5OyANCiAgICANCiAgICBjb25zdCBibGFja1RvdGFsID0gDQogICAgICAgIGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgYmxhY2tQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24gKw0KICAgICAgICBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsNCiAgICAgICAgYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArDQogICAgICAgIGJsYWNrU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHkgKw0KICAgICAgICBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsNCiAgICANCiAgICAvLyDov5Tlm57or6bnu4bor4TkvLDnu5PmnpwNCiAgICBjb25zdCBfX2V2YWxSZXN1bHQgPSB7DQogICAgICAgIHJlZDogew0KICAgICAgICAgICAgdG90YWw6IHJlZFRvdGFsLA0KICAgICAgICAgICAgbWF0ZXJpYWw6IHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwNCiAgICAgICAgICAgIHBvc2l0aW9uOiByZWRQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sDQogICAgICAgICAgICB0aHJlYXQ6IHJlZFRocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0LA0KICAgICAgICAgICAgdGFjdGljOiByZWRUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYywNCiAgICAgICAgICAgIHNhZmV0eTogcmVkU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHksDQogICAgICAgICAgICBtb2JpbGl0eTogcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgcGhhc2U6IG91dHB1dFBoYXNlLA0KICAgICAgICAgICAgd2VpZ2h0czogew0KICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLjQsDQogICAgICAgICAgICAgICAgcG9zaXRpb246IDAuMiwNCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwNCiAgICAgICAgICAgICAgICBzYWZldHk6IDAuMSwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eTogMC4wNSwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSwNCiAgICAgICAgYmxhY2s6IHsNCiAgICAgICAgICAgIHRvdGFsOiBibGFja1RvdGFsLA0KICAgICAgICAgICAgbWF0ZXJpYWw6IGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsLA0KICAgICAgICAgICAgcG9zaXRpb246IGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLA0KICAgICAgICAgICAgdGhyZWF0OiBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0LA0KICAgICAgICAgICAgdGFjdGljOiBibGFja1RhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljLA0KICAgICAgICAgICAgc2FmZXR5OiBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LA0KICAgICAgICAgICAgbW9iaWxpdHk6IGJsYWNrTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgcGhhc2U6IG91dHB1dFBoYXNlLA0KICAgICAgICAgICAgd2VpZ2h0czogew0KICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLjQsDQogICAgICAgICAgICAgICAgcG9zaXRpb246IDAuMiwNCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwNCiAgICAgICAgICAgICAgICBzYWZldHk6IDAuMSwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eTogMC4wNSwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSwNCiAgICAgICAgcGllY2VzSW5mbzogcGllY2VzSW5mbywNCiAgICAgICAgZ2FtZVN0YWdlOiBnYW1lU3RhZ2UsDQogICAgICAgIGJvYXJkSW5mbzogYm9hcmRJbmZvDQogICAgfTsNCiAgICBpZiAodHlwZW9mIHBlcmZTdGF0cyAhPT0gJ3VuZGVmaW5lZCcgJiYgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcyAhPSBudWxsKSB7DQogICAgICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIH0NCiAgICByZXR1cm4gX19ldmFsUmVzdWx0Ow0KfTsNCg0KY29uc3QgZXZhbHVhdGVTZWFyY2hMZWFmRmFzdCA9IChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpID0+IHsNCiAgICBjb25zdCBfX3QwID0gcGVyZm9ybWFuY2Uubm93KCk7DQogICAgY29uc3QgcGllY2VzSW5mbyA9IHNjcmF0Y2hMZWFmUGllY2VzSW5mbzsNCiAgICBsZXQgY291bnQgPSAwOw0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCiAgICBjb25zdCBudW1lcmljTGVhZiA9ICEhcGllY2VTdGF0ZTsNCiAgICBjb25zdCBtYXRlcmlhbFZhbHVlcyA9IG51bWVyaWNMZWFmID8gcGllY2VTdGF0ZS5tYXRlcmlhbFZhbHVlcyA6IG51bGw7DQogICAgbGV0IHJlZE1hdGVyaWFsID0gbnVtZXJpY0xlYWYgPyBwaWVjZVN0YXRlLnJlZE1hdGVyaWFsIDogMDsNCiAgICBsZXQgcmVkUG9zaXRpb24gPSBudW1lcmljTGVhZiA/IHBpZWNlU3RhdGUucmVkUG9zaXRpb24gOiAwOw0KICAgIGxldCBibGFja01hdGVyaWFsID0gbnVtZXJpY0xlYWYgPyBwaWVjZVN0YXRlLmJsYWNrTWF0ZXJpYWwgOiAwOw0KICAgIGxldCBibGFja1Bvc2l0aW9uID0gbnVtZXJpY0xlYWYgPyBwaWVjZVN0YXRlLmJsYWNrUG9zaXRpb24gOiAwOw0KICAgIGxldCBvdmVyZmxvdyA9IGZhbHNlOw0KICAgIGlmIChwaWVjZVN0YXRlKSB7DQogICAgICAgIGNvbnN0IHJlY29yZHMgPSBwaWVjZVN0YXRlLnJlY29yZHM7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVjb3Jkcy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgcmVjb3JkID0gcmVjb3Jkc1tpXTsNCiAgICAgICAgICAgIGlmICghcmVjb3JkLmFsaXZlKSBjb250aW51ZTsNCiAgICAgICAgICAgIGNvbnN0IGluZm8gPSBzY3JhdGNoTGVhZlBpZWNlU2xvdHNbY291bnQrK107DQogICAgICAgICAgICBjb25zdCBwaWVjZUNvZGUgPSBwaWVjZVN0YXRlLnBpZWNlQ29kZXNbaV07DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IG51bWVyaWNMZWFmID8gbnVsbCA6IHJlY29yZC5waWVjZTsNCiAgICAgICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWUgPSBudW1lcmljTGVhZg0KICAgICAgICAgICAgICAgID8gbWF0ZXJpYWxWYWx1ZXNbcGllY2VDb2RlICYgN10NCiAgICAgICAgICAgICAgICA6IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgICAgICAvLyBOdW1lcmljIGxlYXZlcyByZWFkIHRoZSBhZ2dyZWdhdGUgUFNUIHNjb3JlIGZyb20gcGllY2VTdGF0ZTsNCiAgICAgICAgICAgIC8vIG5vIGRvd25zdHJlYW0gc2VhcmNoIGNhbGN1bGF0aW9uIGNvbnN1bWVzIGEgcGVyLXBpZWNlIFBTVCB2YWx1ZS4NCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uVmFsdWUgPSBudW1lcmljTGVhZiA/IDAgOiBnZXRQb3NpdGlvblZhbHVlKHBpZWNlLCByZWNvcmQuciwgcmVjb3JkLmMpOw0KICAgICAgICAgICAgaW5mby5waWVjZSA9IHBpZWNlOw0KICAgICAgICAgICAgaW5mby5waWVjZUNvZGUgPSBwaWVjZUNvZGU7DQogICAgICAgICAgICBpbmZvLnIgPSByZWNvcmQucjsNCiAgICAgICAgICAgIGluZm8uYyA9IHJlY29yZC5jOw0KICAgICAgICAgICAgaW5mby5zcSA9IHJlY29yZC5zcTsNCiAgICAgICAgICAgIGluZm8ucGllY2VJbmRleCA9IGNvdW50IC0gMTsNCiAgICAgICAgICAgIGluZm8ubWF0ZXJpYWxWYWx1ZSA9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICBpbmZvLnBvc2l0aW9uVmFsdWUgPSBwb3NpdGlvblZhbHVlOw0KICAgICAgICAgICAgcGllY2VzSW5mb1tjb3VudCAtIDFdID0gaW5mbzsNCiAgICAgICAgfQ0KICAgIH0gZWxzZSB7DQogICAgICAgIHNjYW5Cb2FyZDogZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICBpZiAoIXBpZWNlKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAoY291bnQgPj0gc2NyYXRjaExlYWZQaWVjZVNsb3RzLmxlbmd0aCkgew0KICAgICAgICAgICAgICAgICAgICBvdmVyZmxvdyA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrIHNjYW5Cb2FyZDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHNjcmF0Y2hMZWFmUGllY2VTbG90c1tjb3VudCsrXTsNCiAgICAgICAgICAgICAgICBjb25zdCBtYXRlcmlhbFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgICAgICBjb25zdCBwb3NpdGlvblZhbHVlID0gZ2V0UG9zaXRpb25WYWx1ZShwaWVjZSwgciwgYyk7DQogICAgICAgICAgICAgICAgaW5mby5waWVjZSA9IHBpZWNlOw0KICAgICAgICAgICAgICAgIGluZm8ucGllY2VDb2RlID0gc2VhcmNoUGllY2VDb2RlKHBpZWNlKTsNCiAgICAgICAgICAgICAgICBpbmZvLnIgPSByOw0KICAgICAgICAgICAgICAgIGluZm8uYyA9IGM7DQogICAgICAgICAgICAgICAgaW5mby5zcSA9IHIgKiA5ICsgYzsNCiAgICAgICAgICAgICAgICBpbmZvLnBpZWNlSW5kZXggPSBjb3VudCAtIDE7DQogICAgICAgICAgICAgICAgaW5mby5tYXRlcmlhbFZhbHVlID0gbWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgICAgICBpbmZvLnBvc2l0aW9uVmFsdWUgPSBwb3NpdGlvblZhbHVlOw0KICAgICAgICAgICAgICAgIGluZm8udGhyZWF0VmFsdWUgPSAwOw0KICAgICAgICAgICAgICAgIGluZm8uc2FmZXR5VmFsdWUgPSAwOw0KICAgICAgICAgICAgICAgIGluZm8udGFjdGljVmFsdWUgPSAwOw0KICAgICAgICAgICAgICAgIGluZm8ubW9iaWxpdHlWYWx1ZSA9IDA7DQogICAgICAgICAgICAgICAgcGllY2VzSW5mb1tjb3VudCAtIDFdID0gaW5mbzsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UuY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICAgICAgICAgIHJlZE1hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICAgICAgICAgIHJlZFBvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgYmxhY2tNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgICAgICBibGFja1Bvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIGlmIChvdmVyZmxvdykgew0KICAgICAgICBjb25zdCByZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgeyBmb3JTZWFyY2hMZWFmOiB0cnVlIH0pOw0KICAgICAgICBjb25zdCBvcHBvbmVudCA9IHNlYXJjaEluaXRpYXRvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIHJldHVybiByZXN1bHRbc2VhcmNoSW5pdGlhdG9yXS50b3RhbCAtIHJlc3VsdFtvcHBvbmVudF0udG90YWw7DQogICAgfQ0KICAgIHBpZWNlc0luZm8ubGVuZ3RoID0gY291bnQ7DQoNCiAgICBpZiAocGllY2VTdGF0ZSkgew0KICAgICAgICBjYWxjdWxhdGVQYWNrZWRTZWFyY2hMZWFmUmVsYXRpb25zKHBpZWNlc0luZm8sIHBpZWNlU3RhdGUuc3F1YXJlQ29kZXMpOw0KICAgICAgICBjYWxjdWxhdGVOdW1lcmljU2VhcmNoTGVhZlRocmVhdFZhbHVlcyhwaWVjZXNJbmZvLCBzZWFyY2hJbml0aWF0b3IpOw0KICAgICAgICBjYWxjdWxhdGVOdW1lcmljU2VhcmNoTGVhZlNhZmV0eVZhbHVlcyhwaWVjZXNJbmZvLCBwaWVjZVN0YXRlLnNxdWFyZUNvZGVzKTsNCiAgICB9IGVsc2Ugew0KICAgICAgICBjbGVhclJlbGF0aW9uTWFza3ModHJ1ZSk7DQogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsNCiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7DQogICAgICAgIGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMoYm9hcmQsIHBpZWNlc0luZm8sIHNlYXJjaEluaXRpYXRvciwgc2NyYXRjaExlYWZCb2FyZEluZm8sIHRydWUpOw0KICAgIH0NCg0KICAgIGxldCByZWRUaHJlYXQgPSAwOw0KICAgIGxldCByZWRUYWN0aWMgPSAwOw0KICAgIGxldCByZWRTYWZldHkgPSAwOw0KICAgIGxldCByZWRNb2JpbGl0eSA9IDA7DQogICAgbGV0IGJsYWNrVGhyZWF0ID0gMDsNCiAgICBsZXQgYmxhY2tUYWN0aWMgPSAwOw0KICAgIGxldCBibGFja1NhZmV0eSA9IDA7DQogICAgbGV0IGJsYWNrTW9iaWxpdHkgPSAwOw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykgew0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgaWYgKG51bWVyaWNMZWFmID8gaW5mby5waWVjZUNvZGUgPCA4IDogaW5mby5waWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgIHJlZFRocmVhdCArPSBpbmZvLnRocmVhdFZhbHVlOw0KICAgICAgICAgICAgcmVkVGFjdGljICs9IGluZm8udGFjdGljVmFsdWU7DQogICAgICAgICAgICByZWRTYWZldHkgKz0gaW5mby5zYWZldHlWYWx1ZTsNCiAgICAgICAgICAgIHJlZE1vYmlsaXR5ICs9IGluZm8ubW9iaWxpdHlWYWx1ZTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGJsYWNrVGhyZWF0ICs9IGluZm8udGhyZWF0VmFsdWU7DQogICAgICAgICAgICBibGFja1RhY3RpYyArPSBpbmZvLnRhY3RpY1ZhbHVlOw0KICAgICAgICAgICAgYmxhY2tTYWZldHkgKz0gaW5mby5zYWZldHlWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrTW9iaWxpdHkgKz0gaW5mby5tb2JpbGl0eVZhbHVlOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3QgcmVkVG90YWwgPQ0KICAgICAgICByZWRNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwgKw0KICAgICAgICByZWRQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24gKw0KICAgICAgICByZWRUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArDQogICAgICAgIHJlZFRhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljICsNCiAgICAgICAgcmVkU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHkgKw0KICAgICAgICByZWRNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7DQogICAgY29uc3QgYmxhY2tUb3RhbCA9DQogICAgICAgIGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgYmxhY2tQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24gKw0KICAgICAgICBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsNCiAgICAgICAgYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArDQogICAgICAgIGJsYWNrU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHkgKw0KICAgICAgICBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsNCg0KICAgIHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxDb3VudCsrOw0KICAgIHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxNcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7DQogICAgcmV0dXJuIHNlYXJjaEluaXRpYXRvciA9PT0gJ3JlZCcgPyByZWRUb3RhbCAtIGJsYWNrVG90YWwgOiBibGFja1RvdGFsIC0gcmVkVG90YWw7DQp9Ow0KDQovLyDlsIYv5biF5L2N572u57yT5a2Y77ya5L6bIHBvc3QtbW92ZSBpc0NoZWNrIC8g6aOe5bCG5b+r6YCf5p+l6K+i77yM55SxIG1ha2UvdW5tYWtlIOe7tOaKpA0KbGV0IGdlbmVyYWxQb3NDYWNoZSA9IHsgcmVkOiBudWxsLCBibGFjazogbnVsbCB9Ow0KDQovLyDlsIbluIXku4XlnKjkuZ3lrqvlhoXvvIzmjInkuZ3lrqvmiavmj4/ljbPlj68NCmNvbnN0IGZpbmRHZW5lcmFsUG9zID0gKGJvYXJkLCBjb2xvcikgPT4gew0KICAgIGNvbnN0IHJvd1N0YXJ0ID0gY29sb3IgPT09ICdyZWQnID8gMCA6IDc7DQogICAgY29uc3Qgcm93RW5kID0gY29sb3IgPT09ICdyZWQnID8gMiA6IDk7DQogICAgZm9yIChsZXQgciA9IHJvd1N0YXJ0OyByIDw9IHJvd0VuZDsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAzOyBjIDw9IDU7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyByLCBjIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgcmV0dXJuIG51bGw7DQp9Ow0KDQpjb25zdCBzeW5jR2VuZXJhbFBvc0NhY2hlID0gKGJvYXJkKSA9PiB7DQogICAgZ2VuZXJhbFBvc0NhY2hlLnJlZCA9IGZpbmRHZW5lcmFsUG9zKGJvYXJkLCAncmVkJyk7DQogICAgZ2VuZXJhbFBvc0NhY2hlLmJsYWNrID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsICdibGFjaycpOw0KfTsNCg0KY29uc3QgZ2V0R2VuZXJhbFBvcyA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBjb25zdCBjYWNoZWQgPSBnZW5lcmFsUG9zQ2FjaGVbY29sb3JdOw0KICAgIGlmIChjYWNoZWQpIHsNCiAgICAgICAgY29uc3QgcCA9IGJvYXJkW2NhY2hlZC5yXT8uW2NhY2hlZC5jXTsNCiAgICAgICAgaWYgKHAgJiYgcC50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgIHJldHVybiBjYWNoZWQ7DQogICAgICAgIH0NCiAgICB9DQogICAgY29uc3QgcG9zID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsIGNvbG9yKTsNCiAgICBnZW5lcmFsUG9zQ2FjaGVbY29sb3JdID0gcG9zOw0KICAgIHJldHVybiBwb3M7DQp9Ow0KDQovLyDmkJzntKLnlKjljp/lnLDotbDlrZAgLyDmgaLlpI3vvIjpgb/lhY3mr4/mrKHpgJLlvZIgYm9hcmQubWFw77yJ77yb5ZCM5q2l57u05oqk5bCG5L2N57yT5a2YDQpjb25zdCBtYWtlTW92ZSA9IChib2FyZCwgZnJvbSwgdG8pID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsNCiAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW3RvLnJdW3RvLmNdOw0KICAgIGJvYXJkW3RvLnJdW3RvLmNdID0gcGllY2U7DQogICAgYm9hcmRbZnJvbS5yXVtmcm9tLmNdID0gbnVsbDsNCiAgICB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJNYWtlKGJvYXJkLCBmcm9tLnIgKiA5ICsgZnJvbS5jLCB0by5yICogOSArIHRvLmMpOw0KICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogdG8uciwgYzogdG8uYyB9Ow0KICAgIH0NCiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSBudWxsOw0KICAgIH0NCiAgICByZXR1cm4gY2FwdHVyZWQ7DQp9Ow0KDQpjb25zdCB1bm1ha2VNb3ZlID0gKGJvYXJkLCBmcm9tLCB0bywgY2FwdHVyZWQpID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOw0KICAgIGJvYXJkW2Zyb20ucl1bZnJvbS5jXSA9IHBpZWNlOw0KICAgIGJvYXJkW3RvLnJdW3RvLmNdID0gY2FwdHVyZWQ7DQogICAgdXBkYXRlUGllY2VTdGF0ZUFmdGVyVW5tYWtlKGJvYXJkLCBmcm9tLnIgKiA5ICsgZnJvbS5jLCB0by5yICogOSArIHRvLmMpOw0KICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogZnJvbS5yLCBjOiBmcm9tLmMgfTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0geyByOiB0by5yLCBjOiB0by5jIH07DQogICAgfQ0KfTsNCg0KLy8g5LuF5pmu6YCa6IqC54K55L2/55So77ya54i25bGA6Z2i5a6J5YWo5LiU6LW357uI54K55LiN5b2x5ZON5bCG57q/5oiW5pWM6ams5L6d6LWW5qC85pe277yM6LWw5a2Q5ZCO5LuN5b+F54S25a6J5YWo44CCCmNvbnN0IGtpbmdTYWZldHlJc1VuY2hhbmdlZEJ5TW92ZSA9IChzdGF0ZSwgY29sb3IsIG1vdmUsIHdhc0luQ2hlY2spID0+IHsKICAgIGlmICghU0VBUkNIX0VOQUJMRV9LSU5HX1NBRkVUWV9GQVNUX1BBVEggfHwgd2FzSW5DaGVjayB8fCAhc3RhdGUgfHwgbW92ZSA9PSBudWxsKSByZXR1cm4gZmFsc2U7CiAgICBjb25zdCBmcm9tU3EgPSBtb3ZlRnJvbVNxKG1vdmUpOwogICAgY29uc3QgdG9TcSA9IG1vdmVUb1NxKG1vdmUpOwogICAgY29uc3QgZ2VuZXJhbFNxID0gY29sb3IgPT09ICdyZWQnID8gc3RhdGUucmVkR2VuZXJhbFNxIDogc3RhdGUuYmxhY2tHZW5lcmFsU3E7CiAgICBpZiAoZ2VuZXJhbFNxIDwgMCB8fCBnZW5lcmFsU3EgPT09IHRvU3EpIHJldHVybiBmYWxzZTsKCiAgICBjb25zdCBnZW5lcmFsUm93ID0gU0VBUkNIX1NRX1JPV1NbZ2VuZXJhbFNxXTsKICAgIGNvbnN0IGdlbmVyYWxDb2wgPSBTRUFSQ0hfU1FfQ09MU1tnZW5lcmFsU3FdOwogICAgaWYgKAogICAgICAgIFNFQVJDSF9TUV9ST1dTW2Zyb21TcV0gPT09IGdlbmVyYWxSb3cgfHwKICAgICAgICBTRUFSQ0hfU1FfQ09MU1tmcm9tU3FdID09PSBnZW5lcmFsQ29sIHx8CiAgICAgICAgU0VBUkNIX1NRX1JPV1NbdG9TcV0gPT09IGdlbmVyYWxSb3cgfHwKICAgICAgICBTRUFSQ0hfU1FfQ09MU1t0b1NxXSA9PT0gZ2VuZXJhbENvbAogICAgKSB7CiAgICAgICAgcmV0dXJuIGZhbHNlOwogICAgfQoKICAgIGNvbnN0IGhvcnNlQ2hlY2tlcnMgPSBTRUFSQ0hfSE9SU0VfQ0hFQ0tFUlNbZ2VuZXJhbFNxXTsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaG9yc2VDaGVja2Vycy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGVudHJ5ID0gaG9yc2VDaGVja2Vyc1tpXTsKICAgICAgICBjb25zdCBsZWdTcSA9IGVudHJ5ID4+PiA3OwogICAgICAgIGNvbnN0IGhvcnNlU3EgPSBlbnRyeSAmIE1PVkVfVE9fTUFTSzsKICAgICAgICBpZiAoZnJvbVNxID09PSBsZWdTcSB8fCB0b1NxID09PSBsZWdTcSB8fCBmcm9tU3EgPT09IGhvcnNlU3EgfHwgdG9TcSA9PT0gaG9yc2VTcSkgcmV0dXJuIGZhbHNlOwogICAgfQogICAgcmV0dXJuIHRydWU7Cn07CgovLyDotbDlrZDlkI7mmK/lkKbkvb/lt7HmlrnlsIbkuI3lronlhajvvIjpo57lsIbmiJbooqvlsIbvvInjgILosIPnlKjliY3pobvlt7IgbWFrZU1vdmXjgIIKY29uc3QgbGVhdmVzT3duS2luZ1Vuc2FmZSA9IChib2FyZCwgY29sb3IsIG1vdmUgPSBudWxsLCB3YXNJbkNoZWNrID0gdHJ1ZSkgPT4gewogICAgY29uc3QgX190MCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOwogICAgcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzKys7CiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7CiAgICBpZiAoa2luZ1NhZmV0eUlzVW5jaGFuZ2VkQnlNb3ZlKHBpZWNlU3RhdGUsIGNvbG9yLCBtb3ZlLCB3YXNJbkNoZWNrKSkgewogICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSBwZXJmU3RhdHMua2luZ1NhZmV0eUZhc3RTa2lwcysrOwogICAgICAgIGlmIChTRUFSQ0hfVkVSSUZZX0tJTkdfU0FGRVRZX0ZBU1RfUEFUSCkgewogICAgICAgICAgICBjb25zdCB1bnNhZmUgPSBwaWVjZVN0YXRlCiAgICAgICAgICAgICAgICA/IGlzQ2hlY2tSYXdGcm9tUGllY2VTdGF0ZShwaWVjZVN0YXRlLCBjb2xvcikKICAgICAgICAgICAgICAgIDogKGlzRmx5aW5nR2VuZXJhbChib2FyZCkgfHwgaXNDaGVja1Jhdyhib2FyZCwgY29sb3IpKTsKICAgICAgICAgICAgaWYgKHVuc2FmZSkgewogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHBlcmZTdGF0cy5raW5nU2FmZXR5VmVyaWZpY2F0aW9uRmFpbHVyZXMrKzsKICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybiBmYWxzZTsKICAgIH0KICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSBwZXJmU3RhdHMua2luZ1NhZmV0eUZ1bGxDaGVja3MrKzsKICAgIGNvbnN0IHVuc2FmZSA9IHBpZWNlU3RhdGUgPyBpc0NoZWNrUmF3RnJvbVBpZWNlU3RhdGUocGllY2VTdGF0ZSwgY29sb3IpIDogKGlzRmx5aW5nR2VuZXJhbChib2FyZCkgfHwgaXNDaGVja1Jhdyhib2FyZCwgY29sb3IpKTsKICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tNcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7DQogICAgcmV0dXJuIHVuc2FmZTsNCn07DQoNCi8vIOS7juS8quWQiOazleedgOazleS4rei/h+a7pOWHuuS4jemAgeWwhi/kuI3po57lsIbnmoTlkIjms5XnnYDms5XvvIhVSS/moLnoioLngrkv5byA5bGA5bqT5qCh6aqM77yJDQovLyDmkJzntKLng63ot6/lvoTkvb/nlKjlu7bov5/lkIjms5XmgKfvvIjor5XotbDml7bmo4DmtYvvvInvvIzpgb/lhY3lr7nliarmnp3mnKrop6blj4rnmoTnnYDms5XlgZrlhajph4/ov4fmu6QNCmNvbnN0IGZpbHRlckxlZ2FsTW92ZXMgPSAoYm9hcmQsIGZyb20sIHBpZWNlLCBwc2V1ZG9Nb3ZlcykgPT4gew0KICAgIGNvbnN0IHZhbGlkTW92ZXMgPSBbXTsNCiAgICBmb3IgKGNvbnN0IHRvIG9mIHBzZXVkb01vdmVzKSB7DQogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZU1vdmUoYm9hcmQsIGZyb20sIHRvKTsNCiAgICAgICAgY29uc3QgaWxsZWdhbCA9IGxlYXZlc093bktpbmdVbnNhZmUoYm9hcmQsIHBpZWNlLmNvbG9yKTsNCiAgICAgICAgdW5tYWtlTW92ZShib2FyZCwgZnJvbSwgdG8sIGNhcHR1cmVkKTsNCiAgICAgICAgaWYgKCFpbGxlZ2FsKSB2YWxpZE1vdmVzLnB1c2godG8pOw0KICAgIH0NCiAgICByZXR1cm4gdmFsaWRNb3ZlczsNCn07DQoNCi8vIFNlYXJjaCBob3QgcGF0aCBtb3ZlIGVuY29kaW5nOiBtb3ZlID0gKGZyb21TcSA8PCA3KSB8IHRvU3EuDQpjb25zdCBNT1ZFX1RPX01BU0sgPSAweDdmOw0KY29uc3QgZW5jb2RlTW92ZSA9IChmcm9tLCB0bykgPT4gKChmcm9tLnIgKiA5ICsgZnJvbS5jKSA8PCA3KSB8ICh0by5yICogOSArIHRvLmMpOw0KY29uc3QgZW5jb2RlTW92ZUZyb21Db29yZHMgPSAoZnIsIGZjLCB0ciwgdGMpID0+ICgoZnIgKiA5ICsgZmMpIDw8IDcpIHwgKHRyICogOSArIHRjKTsNCmNvbnN0IGlzRW5jb2RlZE1vdmUgPSAobW92ZSkgPT4gdHlwZW9mIG1vdmUgPT09ICdudW1iZXInOw0KY29uc3QgbW92ZUZyb21TcSA9IChtb3ZlKSA9PiBpc0VuY29kZWRNb3ZlKG1vdmUpID8gKG1vdmUgPj4+IDcpIDogbW92ZS5mcm9tLnIgKiA5ICsgbW92ZS5mcm9tLmM7DQpjb25zdCBtb3ZlVG9TcSA9IChtb3ZlKSA9PiBpc0VuY29kZWRNb3ZlKG1vdmUpID8gKG1vdmUgJiBNT1ZFX1RPX01BU0spIDogbW92ZS50by5yICogOSArIG1vdmUudG8uYzsNCmNvbnN0IG1vdmVGcm9tUiA9IChtb3ZlKSA9PiB7DQogICAgY29uc3Qgc3EgPSBtb3ZlRnJvbVNxKG1vdmUpOw0KICAgIHJldHVybiAoc3EgLyA5KSB8IDA7DQp9Ow0KY29uc3QgbW92ZUZyb21DID0gKG1vdmUpID0+IG1vdmVGcm9tU3EobW92ZSkgJSA5Ow0KY29uc3QgbW92ZVRvUiA9IChtb3ZlKSA9PiB7DQogICAgY29uc3Qgc3EgPSBtb3ZlVG9TcShtb3ZlKTsNCiAgICByZXR1cm4gKHNxIC8gOSkgfCAwOw0KfTsNCmNvbnN0IG1vdmVUb0MgPSAobW92ZSkgPT4gbW92ZVRvU3EobW92ZSkgJSA5Ow0KY29uc3QgbW92ZVRvT2JqZWN0ID0gKG1vdmUpID0+IHsNCiAgICBpZiAoIWlzRW5jb2RlZE1vdmUobW92ZSkpIHJldHVybiBtb3ZlOw0KICAgIGNvbnN0IGZyb20gPSBtb3ZlRnJvbVNxKG1vdmUpOw0KICAgIGNvbnN0IHRvID0gbW92ZVRvU3EobW92ZSk7DQogICAgcmV0dXJuIHsNCiAgICAgICAgZnJvbTogeyByOiAoZnJvbSAvIDkpIHwgMCwgYzogZnJvbSAlIDkgfSwNCiAgICAgICAgdG86IHsgcjogKHRvIC8gOSkgfCAwLCBjOiB0byAlIDkgfQ0KICAgIH07DQp9Ow0KDQpjb25zdCBtYWtlU2VhcmNoTW92ZSA9IChib2FyZCwgbW92ZSkgPT4gew0KICAgIGlmICghaXNFbmNvZGVkTW92ZShtb3ZlKSkgcmV0dXJuIG1ha2VNb3ZlKGJvYXJkLCBtb3ZlLmZyb20sIG1vdmUudG8pOw0KICAgIGNvbnN0IGZyb20gPSBtb3ZlID4+PiA3Ow0KICAgIGNvbnN0IHRvID0gbW92ZSAmIE1PVkVfVE9fTUFTSzsNCiAgICBjb25zdCBmciA9IChmcm9tIC8gOSkgfCAwLCBmYyA9IGZyb20gJSA5Ow0KICAgIGNvbnN0IHRyID0gKHRvIC8gOSkgfCAwLCB0YyA9IHRvICUgOTsNCiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2ZyXVtmY107DQogICAgY29uc3QgY2FwdHVyZWQgPSBib2FyZFt0cl1bdGNdOw0KICAgIGJvYXJkW3RyXVt0Y10gPSBwaWVjZTsNCiAgICBib2FyZFtmcl1bZmNdID0gbnVsbDsNCiAgICB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJNYWtlKGJvYXJkLCBmcm9tLCB0byk7DQogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbcGllY2UuY29sb3JdID0geyByOiB0ciwgYzogdGMgfTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0gbnVsbDsNCiAgICB9DQogICAgcmV0dXJuIGNhcHR1cmVkOw0KfTsNCg0KY29uc3QgdW5tYWtlU2VhcmNoTW92ZSA9IChib2FyZCwgbW92ZSwgY2FwdHVyZWQpID0+IHsNCiAgICBpZiAoIWlzRW5jb2RlZE1vdmUobW92ZSkpIHsNCiAgICAgICAgdW5tYWtlTW92ZShib2FyZCwgbW92ZS5mcm9tLCBtb3ZlLnRvLCBjYXB0dXJlZCk7DQogICAgICAgIHJldHVybjsNCiAgICB9DQogICAgY29uc3QgZnJvbSA9IG1vdmUgPj4+IDc7DQogICAgY29uc3QgdG8gPSBtb3ZlICYgTU9WRV9UT19NQVNLOw0KICAgIGNvbnN0IGZyID0gKGZyb20gLyA5KSB8IDAsIGZjID0gZnJvbSAlIDk7DQogICAgY29uc3QgdHIgPSAodG8gLyA5KSB8IDAsIHRjID0gdG8gJSA5Ow0KICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbdHJdW3RjXTsNCiAgICBib2FyZFtmcl1bZmNdID0gcGllY2U7DQogICAgYm9hcmRbdHJdW3RjXSA9IGNhcHR1cmVkOw0KICAgIHVwZGF0ZVBpZWNlU3RhdGVBZnRlclVubWFrZShib2FyZCwgZnJvbSwgdG8pOw0KICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogZnIsIGM6IGZjIH07DQogICAgfQ0KICAgIGlmIChjYXB0dXJlZCAmJiBjYXB0dXJlZC50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IHsgcjogdHIsIGM6IHRjIH07DQogICAgfQ0KfTsNCg0KY29uc3Qgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2ggPSBbXTsKY29uc3Qgc29ydE1vdmVTY29yZVNjcmF0Y2ggPSBbXTsKY29uc3QgY2FwdHVyZVNvcnRTY29yZVNjcmF0Y2ggPSBbXTsNCmNvbnN0IHNxdWFyZU1hcmtTY3JhdGNoID0gbmV3IFVpbnQ4QXJyYXkoUkVMX1NRVUFSRVMpOw0KY29uc3Qgc3F1YXJlTWFya1RvdWNoZWQgPSBbXTsNCg0KY29uc3QgbWFya1NvcnRTcXVhcmUgPSAoc3EpID0+IHsNCiAgICBpZiAoIXNxdWFyZU1hcmtTY3JhdGNoW3NxXSkgew0KICAgICAgICBzcXVhcmVNYXJrU2NyYXRjaFtzcV0gPSAxOw0KICAgICAgICBzcXVhcmVNYXJrVG91Y2hlZC5wdXNoKHNxKTsNCiAgICB9DQp9Ow0KDQpjb25zdCBjbGVhclNvcnRTcXVhcmVNYXJrcyA9ICgpID0+IHsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNxdWFyZU1hcmtUb3VjaGVkLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIHNxdWFyZU1hcmtTY3JhdGNoW3NxdWFyZU1hcmtUb3VjaGVkW2ldXSA9IDA7DQogICAgfQ0KICAgIHNxdWFyZU1hcmtUb3VjaGVkLmxlbmd0aCA9IDA7DQp9Ow0KDQpjb25zdCBzb3J0TW92ZXNGYXN0ID0gKG1vdmVzLCBib2FyZCwgY3VycmVudFBsYXllciwgcGllY2VzSW5mbywgZ2FtZVN0YWdlID0gJ21pZCcsIGJvYXJkSW5mbyA9IG51bGwsIHNlYXJjaEhldXJpc3RpY3MgPSBudWxsKSA9PiB7DQogICAgY29uc3QgX190MCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOw0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnNvcnRNb3Zlc0NvdW50Kys7DQogICAgY29uc3QgY3VycmVudElzSW5DaGVjayA9IGJvYXJkSW5mbw0KICAgICAgICA/ICgoY3VycmVudFBsYXllciA9PT0gJ3JlZCcgJiYgYm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwNCiAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgJiYgYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKSkNCiAgICAgICAgOiBpc0NoZWNrKGJvYXJkLCBjdXJyZW50UGxheWVyKTsNCg0KICAgIGlmIChjdXJyZW50SXNJbkNoZWNrICYmIHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7DQogICAgICAgIGxldCBnZW5lcmFsSW5mbyA9IG51bGw7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07DQogICAgICAgICAgICBpZiAoaW5mby5waWVjZSAmJiBpbmZvLnBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBpbmZvLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgZ2VuZXJhbEluZm8gPSBpbmZvOw0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmIChnZW5lcmFsSW5mbykgew0KICAgICAgICAgICAgaWYgKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcykgew0KICAgICAgICAgICAgICAgIGxldCBtID0gYm9hcmRJbmZvLmF0dGFja01hc2tbZ2VuZXJhbEluZm8uciAqIDkgKyBnZW5lcmFsSW5mby5jXSA+Pj4gMDsNCiAgICAgICAgICAgICAgICB3aGlsZSAobSAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBiaXQgPSBtICYgLW07DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHQgPSBwaWVjZXNJbmZvWzMxIC0gTWF0aC5jbHozMihiaXQpXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHQgJiYgdC5waWVjZSAmJiB0LnBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBtYXJrU29ydFNxdWFyZSh0LnIgKiA5ICsgdC5jKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBtIF49IGJpdDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKGdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgew0KICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5Lmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHQgPSBnZW5lcmFsSW5mby50aHJlYXRlbmVkQnlbaV07DQogICAgICAgICAgICAgICAgICAgIGlmICh0LnBpZWNlICYmIHQucGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtTb3J0U3F1YXJlKHQuciAqIDkgKyB0LmMpOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3QgaGFzVGhyZWF0ZW5lZCA9ICFjdXJyZW50SXNJbkNoZWNrICYmICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5sZW5ndGggPiAwKTsNCiAgICBpZiAoaGFzVGhyZWF0ZW5lZCkgew0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXNbaV07DQogICAgICAgICAgICBtYXJrU29ydFNxdWFyZShwLnIgKiA5ICsgcC5jKTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBjb25zdCB0aHJlYXRlbmVkTWFya0VuZCA9IHNxdWFyZU1hcmtUb3VjaGVkLmxlbmd0aDsNCg0KICAgIGNvbnN0IGhhc0NhbkNhcHR1cmUgPSAhY3VycmVudElzSW5DaGVjayAmJiAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUgJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUubGVuZ3RoID4gMCk7DQogICAgaWYgKGhhc0NhbkNhcHR1cmUpIHsNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2FyZEluZm8uY2FuQ2FwdHVyZS5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkSW5mby5jYW5DYXB0dXJlW2ldOw0KICAgICAgICAgICAgbWFya1NvcnRTcXVhcmUocC5yICogOSArIHAuYyk7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBjb25zdCB0dE1vdmUgPSBzZWFyY2hIZXVyaXN0aWNzPy50dE1vdmUgfHwgbnVsbDsNCiAgICBjb25zdCBraWxsZXJzID0gc2VhcmNoSGV1cmlzdGljcz8ua2lsbGVycyB8fCBudWxsOw0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCiAgICBjb25zdCB1c2VTaW1wbGVTZWFyY2hTb3J0ID0gcGllY2VTdGF0ZSAmJiAhY3VycmVudElzSW5DaGVjayAmJiAhaGFzVGhyZWF0ZW5lZCAmJiAhaGFzQ2FuQ2FwdHVyZTsNCiAgICBjb25zdCBpc01hcmtlZFRocmVhdGVuZWQgPSAoc3EpID0+IHsNCiAgICAgICAgaWYgKCFoYXNUaHJlYXRlbmVkKSByZXR1cm4gZmFsc2U7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhyZWF0ZW5lZE1hcmtFbmQ7IGkrKykgew0KICAgICAgICAgICAgaWYgKHNxdWFyZU1hcmtUb3VjaGVkW2ldID09PSBzcSkgcmV0dXJuIHRydWU7DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIGZhbHNlOw0KICAgIH07DQoNCiAgICBpZiAodXNlU2ltcGxlU2VhcmNoU29ydCkgew0KICAgICAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsNCiAgICAgICAgY29uc3QgcGllY2VDb2RlcyA9IHBpZWNlU3RhdGUucGllY2VDb2RlczsNCiAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZXMgPSBzZWFyY2hNYXRlcmlhbFRhYmxlKGdhbWVTdGFnZSk7DQogICAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBtb3Zlcy5sZW5ndGg7IGluZGV4KyspIHsNCiAgICAgICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpbmRleF07DQogICAgICAgICAgICBjb25zdCBmcm9tU3EgPSBtb3ZlID4+PiA3Ow0KICAgICAgICAgICAgY29uc3QgdG9TcSA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7DQogICAgICAgICAgICBjb25zdCB0YXJnZXRTbG90ID0gc3F1YXJlVG9TbG90W3RvU3FdOwogICAgICAgICAgICBjb25zdCB0YXJnZXRQaWVjZUNvZGUgPSB0YXJnZXRTbG90ID49IDAgPyBwaWVjZUNvZGVzW3RhcmdldFNsb3RdIDogMDsKICAgICAgICAgICAgbGV0IHByaW9yaXR5ID0gNDsKICAgICAgICAgICAgbGV0IHNjb3JlID0gMDsKDQogICAgICAgICAgICBpZiAodHRNb3ZlID09PSBtb3ZlKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAtMTsNCiAgICAgICAgICAgICAgICBzY29yZSA9IDEwMDAwMDA7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFNsb3QgPj0gMCkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IG1hdGVyaWFsVmFsdWVzW3RhcmdldFBpZWNlQ29kZSAmIDddICogMTYgLSBtYXRlcmlhbFZhbHVlc1twaWVjZUNvZGVzW3NxdWFyZVRvU2xvdFtmcm9tU3FdXSAmIDddOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAocHJpb3JpdHkgPj0gMCkgew0KICAgICAgICAgICAgICAgIGlmICh0YXJnZXRTbG90IDwgMCAmJiBraWxsZXJzICYmIG1vdmUgPT09IGtpbGxlcnNbMF0pIHsNCiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7DQogICAgICAgICAgICAgICAgICAgIHNjb3JlICs9IDgwMDA7DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRTbG90IDwgMCAmJiBraWxsZXJzICYmIG1vdmUgPT09IGtpbGxlcnNbMV0pIHsNCiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7DQogICAgICAgICAgICAgICAgICAgIHNjb3JlICs9IDcwMDA7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIHNjb3JlICs9IGdldEhpc3RvcnlTY29yZShtb3ZlKTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaW5kZXhdID0gcHJpb3JpdHk7CiAgICAgICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2luZGV4XSA9IHNjb3JlOwogICAgICAgIH0NCiAgICB9IGVsc2UgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG1vdmVzLmxlbmd0aDsgaW5kZXgrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbaW5kZXhdOw0KICAgICAgICBjb25zdCBmcm9tU3EgPSBtb3ZlRnJvbVNxKG1vdmUpOw0KICAgICAgICBjb25zdCB0b1NxID0gbW92ZVRvU3EobW92ZSk7DQogICAgICAgIGNvbnN0IGZyb21SID0gKGZyb21TcSAvIDkpIHwgMCwgZnJvbUMgPSBmcm9tU3EgJSA5Ow0KICAgICAgICBjb25zdCB0b1IgPSAodG9TcSAvIDkpIHwgMCwgdG9DID0gdG9TcSAlIDk7DQogICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbZnJvbVJdW2Zyb21DXTsNCiAgICAgICAgY29uc3QgcGllY2VWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7CiAgICAgICAgY29uc3QgdGFyZ2V0UGllY2UgPSBib2FyZFt0b1JdW3RvQ107DQogICAgICAgIGNvbnN0IHRhcmdldFBpZWNlVmFsdWUgPSB0YXJnZXRQaWVjZSA/IGdldE1hdGVyaWFsVmFsdWUodGFyZ2V0UGllY2UsIGdhbWVTdGFnZSkgOiAwOw0KICAgICAgICBsZXQgcHJpb3JpdHkgPSA0OwogICAgICAgIGxldCBzY29yZSA9IDA7Cg0KICAgICAgICBpZiAodHRNb3ZlICYmIGlzU2FtZU1vdmUobW92ZSwgdHRNb3ZlKSkgew0KICAgICAgICAgICAgcHJpb3JpdHkgPSAtMTsNCiAgICAgICAgICAgIHNjb3JlID0gMTAwMDAwMDsNCiAgICAgICAgfSBlbHNlIGlmIChjdXJyZW50SXNJbkNoZWNrKSB7DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlc0NoZWNrZXIgPSB0YXJnZXRQaWVjZSAmJiBzcXVhcmVNYXJrU2NyYXRjaFt0b1NxXSAhPT0gMDsNCiAgICAgICAgICAgIGlmIChjYXB0dXJlc0NoZWNrZXIpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDA7DQogICAgICAgICAgICAgICAgc2NvcmUgPSAxMDAwMCArIHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZSAqIDE2IC0gcGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gcGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmIChoYXNUaHJlYXRlbmVkKSB7DQogICAgICAgICAgICBpZiAoaXNNYXJrZWRUaHJlYXRlbmVkKGZyb21TcSkpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDE7DQogICAgICAgICAgICAgICAgc2NvcmUgPSBwaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gaGFzQ2FuQ2FwdHVyZSAmJiBzcXVhcmVNYXJrU2NyYXRjaFt0b1NxXSAhPT0gMCA/IDIgOiAzOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmIChoYXNDYW5DYXB0dXJlKSB7DQogICAgICAgICAgICBpZiAoc3F1YXJlTWFya1NjcmF0Y2hbdG9TcV0gIT09IDApIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDI7DQogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZSAqIDE2IC0gcGllY2VWYWx1ZTsNCiAgICAgICAgfQ0KDQogICAgICAgIGlmIChwcmlvcml0eSA+PSAwKSB7DQogICAgICAgICAgICBpZiAoIXRhcmdldFBpZWNlICYmIGtpbGxlcnMgJiYgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzWzBdKSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gTWF0aC5taW4ocHJpb3JpdHksIDIpOw0KICAgICAgICAgICAgICAgIHNjb3JlICs9IDgwMDA7DQogICAgICAgICAgICB9IGVsc2UgaWYgKCF0YXJnZXRQaWVjZSAmJiBraWxsZXJzICYmIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc1sxXSkpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IE1hdGgubWluKHByaW9yaXR5LCAyKTsNCiAgICAgICAgICAgICAgICBzY29yZSArPSA3MDAwOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgc2NvcmUgKz0gZ2V0SGlzdG9yeVNjb3JlKG1vdmUpOw0KICAgICAgICB9DQoNCiAgICAgICAgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaW5kZXhdID0gcHJpb3JpdHk7CiAgICAgICAgc29ydE1vdmVTY29yZVNjcmF0Y2hbaW5kZXhdID0gc2NvcmU7CiAgICAgICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSB7DQogICAgICAgICAgICBtb3ZlLnByaW9yaXR5ID0gcHJpb3JpdHk7DQogICAgICAgICAgICBtb3ZlLnNvcnRTY29yZSA9IHNjb3JlOw0KICAgICAgICAgICAgbW92ZS5vcmlnaW5hbEluZGV4ID0gaW5kZXg7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBmb3IgKGxldCBpID0gMTsgaSA8IG1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpXTsNCiAgICAgICAgY29uc3QgcHJpb3JpdHkgPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtpXTsKICAgICAgICBjb25zdCBzY29yZSA9IHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2ldOwogICAgICAgIGxldCBqID0gaSAtIDE7DQogICAgICAgIHdoaWxlICgNCiAgICAgICAgICAgIGogPj0gMCAmJg0KICAgICAgICAgICAgKHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2pdID4gcHJpb3JpdHkgfHwKICAgICAgICAgICAgIChzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXSA9PT0gcHJpb3JpdHkgJiYgc29ydE1vdmVTY29yZVNjcmF0Y2hbal0gPCBzY29yZSkpCiAgICAgICAgKSB7DQogICAgICAgICAgICBtb3Zlc1tqICsgMV0gPSBtb3Zlc1tqXTsNCiAgICAgICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2ogKyAxXSA9IHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2pdOwogICAgICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqICsgMV0gPSBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqXTsKICAgICAgICAgICAgai0tOw0KICAgICAgICB9DQogICAgICAgIG1vdmVzW2ogKyAxXSA9IG1vdmU7DQogICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2ogKyAxXSA9IHByaW9yaXR5OwogICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2ogKyAxXSA9IHNjb3JlOwogICAgfQ0KDQogICAgY2xlYXJTb3J0U3F1YXJlTWFya3MoKTsNCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5zb3J0TW92ZXNNcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7DQogICAgcmV0dXJuIG1vdmVzOw0KfTsNCg0KLy8gUGxheS1vbmx5IG5vcm1hbC1ub2RlIG9yZGVyaW5nLiBwcmVwYXJlU2VhcmNoSW5mbyBoYXMgbm8gcmVsYXRpb24gbGlzdHMsIHNvDQovLyBpdHMgbm9uLWNoZWNrIHBhdGggaXMgZXhhY3RseSB0aGUgc2ltcGxlIGJyYW5jaCBvZiBzb3J0TW92ZXNGYXN0IHdpdGhvdXQgdGhlDQovLyBnZW5lcmljIFVJL2FuYWx5c2lzIGJvb2trZWVwaW5nLiBDaGVja2VkIHBvc2l0aW9ucyByZXRhaW4gdGhlIGdlbmVyaWMgb3JkZXIuDQpjb25zdCBzb3J0TW92ZXNQbGF5ID0gKG1vdmVzLCBib2FyZCwgY3VycmVudFBsYXllciwgcGllY2VzSW5mbywgZ2FtZVN0YWdlLCBib2FyZEluZm8sIHR0TW92ZSwga2lsbGVycywgaW5DaGVjaykgPT4gew0KICAgIGlmIChpbkNoZWNrKSB7DQogICAgICAgIHJldHVybiBzb3J0TW92ZXNGYXN0KG1vdmVzLCBib2FyZCwgY3VycmVudFBsYXllciwgcGllY2VzSW5mbywgZ2FtZVN0YWdlLCBib2FyZEluZm8sIHsgdHRNb3ZlLCBraWxsZXJzIH0pOw0KICAgIH0NCiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgaWYgKCFwaWVjZVN0YXRlKSB7DQogICAgICAgIHJldHVybiBzb3J0TW92ZXNGYXN0KG1vdmVzLCBib2FyZCwgY3VycmVudFBsYXllciwgcGllY2VzSW5mbywgZ2FtZVN0YWdlLCBib2FyZEluZm8sIHsgdHRNb3ZlLCBraWxsZXJzIH0pOw0KICAgIH0NCg0KICAgIGNvbnN0IF9fdDAgPSBTRUFSQ0hfUFJPRklMRSA/IHBlcmZvcm1hbmNlLm5vdygpIDogMDsNCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5zb3J0TW92ZXNDb3VudCsrOw0KICAgIGNvbnN0IHNxdWFyZVRvU2xvdCA9IHBpZWNlU3RhdGUuc3F1YXJlVG9TbG90Ow0KICAgIGNvbnN0IHBpZWNlQ29kZXMgPSBwaWVjZVN0YXRlLnBpZWNlQ29kZXM7DQogICAgY29uc3QgbWF0ZXJpYWxWYWx1ZXMgPSBwaWVjZVN0YXRlLm1hdGVyaWFsVmFsdWVzOw0KDQogICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG1vdmVzLmxlbmd0aDsgaW5kZXgrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbaW5kZXhdOw0KICAgICAgICBjb25zdCBmcm9tU3EgPSBtb3ZlID4+PiA3Ow0KICAgICAgICBjb25zdCB0b1NxID0gbW92ZSAmIE1PVkVfVE9fTUFTSzsNCiAgICAgICAgY29uc3QgdGFyZ2V0U2xvdCA9IHNxdWFyZVRvU2xvdFt0b1NxXTsKICAgICAgICBsZXQgcHJpb3JpdHkgPSA0OwogICAgICAgIGxldCBzY29yZSA9IDA7Cg0KICAgICAgICBpZiAodHRNb3ZlID09PSBtb3ZlKSB7DQogICAgICAgICAgICBwcmlvcml0eSA9IC0xOw0KICAgICAgICAgICAgc2NvcmUgPSAxMDAwMDAwOw0KICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFNsb3QgPj0gMCkgew0KICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgc2NvcmUgPSBtYXRlcmlhbFZhbHVlc1twaWVjZUNvZGVzW3RhcmdldFNsb3RdICYgN10gKiAxNiAtDQogICAgICAgICAgICAgICAgbWF0ZXJpYWxWYWx1ZXNbcGllY2VDb2Rlc1tzcXVhcmVUb1Nsb3RbZnJvbVNxXV0gJiA3XTsNCiAgICAgICAgfQ0KDQogICAgICAgIGlmIChwcmlvcml0eSA+PSAwKSB7DQogICAgICAgICAgICBpZiAodGFyZ2V0U2xvdCA8IDAgJiYga2lsbGVycyAmJiBtb3ZlID09PSBraWxsZXJzWzBdKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOw0KICAgICAgICAgICAgICAgIHNjb3JlICs9IDgwMDA7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFNsb3QgPCAwICYmIGtpbGxlcnMgJiYgbW92ZSA9PT0ga2lsbGVyc1sxXSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMjsNCiAgICAgICAgICAgICAgICBzY29yZSArPSA3MDAwOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgc2NvcmUgKz0gZ2V0SGlzdG9yeVNjb3JlKG1vdmUpOw0KICAgICAgICB9DQoNCiAgICAgICAgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaW5kZXhdID0gcHJpb3JpdHk7CiAgICAgICAgc29ydE1vdmVTY29yZVNjcmF0Y2hbaW5kZXhdID0gc2NvcmU7CiAgICB9DQoNCiAgICBmb3IgKGxldCBpID0gMTsgaSA8IG1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpXTsNCiAgICAgICAgY29uc3QgcHJpb3JpdHkgPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtpXTsKICAgICAgICBjb25zdCBzY29yZSA9IHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2ldOwogICAgICAgIGxldCBqID0gaSAtIDE7DQogICAgICAgIHdoaWxlICgNCiAgICAgICAgICAgIGogPj0gMCAmJg0KICAgICAgICAgICAgKHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2pdID4gcHJpb3JpdHkgfHwKICAgICAgICAgICAgIChzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXSA9PT0gcHJpb3JpdHkgJiYgc29ydE1vdmVTY29yZVNjcmF0Y2hbal0gPCBzY29yZSkpCiAgICAgICAgKSB7DQogICAgICAgICAgICBtb3Zlc1tqICsgMV0gPSBtb3Zlc1tqXTsNCiAgICAgICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2ogKyAxXSA9IHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2pdOwogICAgICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqICsgMV0gPSBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqXTsKICAgICAgICAgICAgai0tOw0KICAgICAgICB9DQogICAgICAgIG1vdmVzW2ogKyAxXSA9IG1vdmU7DQogICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2ogKyAxXSA9IHByaW9yaXR5OwogICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2ogKyAxXSA9IHNjb3JlOwogICAgfQ0KDQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuc29ydE1vdmVzTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIHJldHVybiBtb3ZlczsNCn07DQoNCi8vIOaQnOe0oueUqOedgOazleWHhuWkh++8iOi9u+mHj++8ie+8muS4jeW7uuWFs+ezu+Wbvi/lqIHog4Ev5py65Yqo5oCnDQovLyBTRUFSQ0hfREVGRVJfTEVHQUxJVFk9dHJ1Ze+8muWPqueUn+aIkOS8quWQiOazle+8jOWQiOazleaAp+WcqOivlei1sOaXtuajgOa1iw0KLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPWZhbHNl77ya6aKE6L+H5ruk5ZCI5rOV552A77yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQ0KLy8g54K55qOL5YWz57O75LuN6LWw5a6M5pW0IGV2YWx1YXRlQm9hcmTvvIzkuI3lj5flvbHlk40NCmNvbnN0IHByZXBhcmVTZWFyY2hJbmZvID0gKGJvYXJkLCBjdXJyZW50UGxheWVyKSA9PiB7DQogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQoNCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVja1Jhdyhib2FyZCwgY3VycmVudFBsYXllcik7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMucHJlcGFyZUNoZWNrTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIGNvbnN0IF9fbW92ZXNUMCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOw0KICAgIGNvbnN0IHBpZWNlc0luZm8gPSBbXTsNCiAgICBjb25zdCBsZWdhbE1vdmVMaXN0ID0gW107DQogICAgY29uc3QgZGVmZXIgPSB0cnVlOw0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCg0KICAgIGlmIChwaWVjZVN0YXRlKSB7DQogICAgICAgIGNvbnN0IHJlY29yZHMgPSBwaWVjZVN0YXRlLnJlY29yZHM7DQogICAgICAgIGNvbnN0IHNxdWFyZVRvU2xvdCA9IHBpZWNlU3RhdGUuc3F1YXJlVG9TbG90Ow0KICAgICAgICBjb25zdCBzcXVhcmVDb2RlcyA9IHBpZWNlU3RhdGUuc3F1YXJlQ29kZXM7DQogICAgICAgIGNvbnN0IHBpZWNlQ29kZXMgPSBwaWVjZVN0YXRlLnBpZWNlQ29kZXM7DQogICAgICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgew0KICAgICAgICAgICAgY29uc3Qgc2xvdCA9IHNxdWFyZVRvU2xvdFtzcV07DQogICAgICAgICAgICBpZiAoc2xvdCA8IDApIGNvbnRpbnVlOw0KICAgICAgICAgICAgY29uc3QgcmVjb3JkID0gcmVjb3Jkc1tzbG90XTsNCiAgICAgICAgICAgIGlmICghcmVjb3JkLmFsaXZlIHx8IHJlY29yZC5waWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7DQogICAgICAgICAgICBwaWVjZXNJbmZvLnB1c2goeyBwaWVjZTogcmVjb3JkLnBpZWNlLCByOiByZWNvcmQuciwgYzogcmVjb3JkLmMgfSk7DQogICAgICAgICAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgKz0gYXBwZW5kU2VhcmNoUHNldWRvTW92ZXNGb3JQaWVjZSgNCiAgICAgICAgICAgICAgICBsZWdhbE1vdmVMaXN0LCBzcSwgcGllY2VDb2Rlc1tzbG90XSwgc3F1YXJlQ29kZXMsIGZhbHNlDQogICAgICAgICAgICApOw0KICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICBpZiAoIXBpZWNlIHx8IHBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBjb25zdCBmcm9tID0geyByLCBjIH07DQogICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCBmcm9tLCBwaWVjZSk7DQogICAgICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IG1vdmVzIDogZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UsIG1vdmVzKTsNCiAgICAgICAgICAgICAgICBwaWVjZXNJbmZvLnB1c2goeyBwaWVjZSwgciwgYywgbW92ZXMsIGxlZ2FsTW92ZXM6IHVzZU1vdmVzIH0pOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdXNlTW92ZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tpXTsNCiAgICAgICAgICAgICAgICAgICAgbGVnYWxNb3ZlTGlzdC5wdXNoKGVuY29kZU1vdmVGcm9tQ29vcmRzKHIsIGMsIHRvLnIsIHRvLmMpKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IG1vdmVzLmxlbmd0aDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5wcmVwYXJlTW92ZUdlbk1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX19tb3Zlc1QwOw0KDQogICAgLy8g6L276YePIGJvYXJkSW5mb++8muS7heiiq+Wwhuagh+W/lw0KICAgIGNvbnN0IGJvYXJkSW5mbyA9IHsNCiAgICAgICAgcmVkSXNJbkNoZWNrOiBjdXJyZW50UGxheWVyID09PSAncmVkJyA/IGluQ2hlY2sgOiBmYWxzZSwNCiAgICAgICAgYmxhY2tJc0luQ2hlY2s6IGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgPyBpbkNoZWNrIDogZmFsc2UsDQogICAgICAgIGdhbWVTdGF0ZTogbnVsbA0KICAgIH07DQoNCiAgICBpZiAobGVnYWxNb3ZlTGlzdC5sZW5ndGggPT09IDApIHsNCiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IGluQ2hlY2sNCiAgICAgICAgICAgID8geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH0NCiAgICAgICAgICAgIDogeyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfSBlbHNlIHsNCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAncGxheWluZycgfTsNCiAgICB9DQoNCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7DQogICAgcmV0dXJuIHsgcGllY2VzSW5mbywgYm9hcmRJbmZvLCBsZWdhbE1vdmVMaXN0LCBpbkNoZWNrIH07DQp9Ow0KDQovLyDorqHnrpfooY3nlJ/lgLzvvJrlqIHog4HlgLzjgIHlronlhajlgLzjgIHmiJjmnK/lgLzjgIHmnLrliqjlgLwNCmNvbnN0IGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMgPSAoYm9hcmQsIHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIgPSBudWxsLCBib2FyZEluZm8gPSBudWxsLCBmb3JTZWFyY2hMZWFmID0gZmFsc2UpID0+IHsNCiAgICAvLyDph43nva7miYDmnInooY3nlJ/lgLzvvIzpmaTkuobmnLrliqjlgLzvvIjlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpfvvIkNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpbmZvLnRocmVhdFZhbHVlID0gMDsNCiAgICAgICAgaW5mby5zYWZldHlWYWx1ZSA9IDA7DQogICAgICAgIGluZm8udGFjdGljVmFsdWUgPSAwOw0KICAgICAgICAvLyDkv53nlZnmnLrliqjlgLzvvIzlm6DkuLrlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpcNCiAgICB9DQogICAgDQogICAgLy8gMS4g6K6h566X5qOL5a2Q5YWz57O777yI5aiB6IOB6ICF44CB6KKr5aiB6IOB6ICF44CB5L+d5oqk6ICF44CB6KKr5L+d5oqk6ICF77yJDQogICAgaWYgKCFib2FyZEluZm8pIHsNCiAgICAgICAgYm9hcmRJbmZvID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7DQogICAgfQ0KICAgIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zKGJvYXJkLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgIA0KICAgIC8vIDIuIOiuoeeul+WogeiDgeWAvO+8iOaMieiiq+WogeiDgeWtkOiBmuWQiO+8jFNFRSDmr4/nm67moIfkuIDmrKHvvIkNCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMocGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvLCBmb3JTZWFyY2hMZWFmKTsNCiAgICANCiAgICAvLyAzLiDorqHnrpflronlhajlgLwNCiAgICBjYWxjdWxhdGVTYWZldHlWYWx1ZXMocGllY2VzSW5mbywgYm9hcmRJbmZvLCBib2FyZCwgZm9yU2VhcmNoTGVhZik7DQogICAgDQogICAgLy8gNC4g6K6h566X5ri45oiP54q25oCB5bm25L+d5a2Y5YiwYm9hcmRJbmZvDQogICAgLy8g5pCc57Si5Y+26IqC54K56Lez6L+H77ya5peg552AL+Wwhuatu+W3suWcqOeItuiKgueCueWkhOeQhu+8jOatpOWkhOWPqumcgOmdmeaAgeWIhg0KICAgIGlmIChjdXJyZW50UGxheWVyICYmICFmb3JTZWFyY2hMZWFmKSB7DQogICAgICAgIC8vIOajgOafpeW9k+WJjeeOqeWutuaYr+WQpuacieWQiOazlei1sOazlQ0KICAgICAgICBsZXQgaGFzTW92ZXMgPSBmYWxzZTsNCiAgICAgICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5qOL5a2Q55qE5pyJ5pWI6LWw5rOVDQogICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHI6IGluZm8uciwgYzogaW5mby5jIH0pOw0KICAgICAgICAgICAgICAgIGlmIChtb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgICAgIGhhc01vdmVzID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDliKTmlq3muLjmiI/nirbmgIENCiAgICAgICAgbGV0IGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAncGxheWluZycgfTsNCiAgICAgICAgaWYgKCFoYXNNb3Zlcykgew0KICAgICAgICAgICAgLy8g5rKh5pyJ5ZCI5rOV6LWw5rOV77yM5qOA5p+l5piv5ZCm6KKr5bCG5YabDQogICAgICAgICAgICBjb25zdCBpbkNoZWNrID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkSXNJbkNoZWNrIDogYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrOw0KICAgICAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKGluQ2hlY2spIHsNCiAgICAgICAgICAgICAgICBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIOS/neWtmOa4uOaIj+eKtuaAgeWIsGJvYXJkSW5mbw0KICAgICAgICBib2FyZEluZm8uZ2FtZVN0YXRlID0gZ2FtZVN0YXRlOw0KICAgIH0NCn07DQoNCi8vIOaji+WtkOWHoOS9leaWueWQkeihqO+8iOmihOiuoeeul+iFvy/nnLzlgY/np7vvvIzng63ot6/lvoTpgb/lhY0gTWF0aC5zaWduIC8gZHIvMu+8iQ0KY29uc3QgT1JUSF9ESVJTID0gWw0KICAgIFswLCAxXSwgWzAsIC0xXSwgWzEsIDBdLCBbLTEsIDBdDQpdOw0KY29uc3QgRElBR19ESVJTID0gWw0KICAgIFsxLCAxXSwgWzEsIC0xXSwgWy0xLCAxXSwgWy0xLCAtMV0NCl07DQpjb25zdCBFTEVQSEFOVF9ESVJTID0gWw0KICAgIHsgZHI6IDIsIGRjOiAyLCBleWVEcjogMSwgZXllRGM6IDEgfSwNCiAgICB7IGRyOiAyLCBkYzogLTIsIGV5ZURyOiAxLCBleWVEYzogLTEgfSwNCiAgICB7IGRyOiAtMiwgZGM6IDIsIGV5ZURyOiAtMSwgZXllRGM6IDEgfSwNCiAgICB7IGRyOiAtMiwgZGM6IC0yLCBleWVEcjogLTEsIGV5ZURjOiAtMSB9DQpdOw0KY29uc3QgSE9SU0VfRElSUyA9IFsNCiAgICB7IGRyOiAyLCBkYzogMSwgbGVnRHI6IDEsIGxlZ0RjOiAwIH0sDQogICAgeyBkcjogMiwgZGM6IC0xLCBsZWdEcjogMSwgbGVnRGM6IDAgfSwNCiAgICB7IGRyOiAtMiwgZGM6IDEsIGxlZ0RyOiAtMSwgbGVnRGM6IDAgfSwNCiAgICB7IGRyOiAtMiwgZGM6IC0xLCBsZWdEcjogLTEsIGxlZ0RjOiAwIH0sDQogICAgeyBkcjogMSwgZGM6IDIsIGxlZ0RyOiAwLCBsZWdEYzogMSB9LA0KICAgIHsgZHI6IDEsIGRjOiAtMiwgbGVnRHI6IDAsIGxlZ0RjOiAtMSB9LA0KICAgIHsgZHI6IC0xLCBkYzogMiwgbGVnRHI6IDAsIGxlZ0RjOiAxIH0sDQogICAgeyBkcjogLTEsIGRjOiAtMiwgbGVnRHI6IDAsIGxlZ0RjOiAtMSB9DQpdOw0KDQovLyDnn63mraXlrZDpooTooajvvJrkuI7ljp8gc3dpdGNoIOaWueWQkemhuuW6jy/lrqvmsrPov4fmu6TkuIDoh7TvvJvpqazosaHluKYgYnIsYmPvvIjohb8v55y877yJDQpjb25zdCBHRU5FUkFMX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07DQpjb25zdCBBRFZJU09SX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07DQpjb25zdCBFTEVQSEFOVF9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgSE9SU0VfREVTVCA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7DQpjb25zdCBTT0xESUVSX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07DQoNCigoKSA9PiB7DQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHNxID0gciAqIDkgKyBjOw0KICAgICAgICAgICAgY29uc3QgZ1JlZCA9IFtdLCBnQmxhY2sgPSBbXSwgYVJlZCA9IFtdLCBhQmxhY2sgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IGVSZWQgPSBbXSwgZUJsYWNrID0gW10sIGhvcnNlID0gW10sIHNSZWQgPSBbXSwgc0JsYWNrID0gW107DQoNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgT1JUSF9ESVJTW2ldWzBdLCBuYyA9IGMgKyBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgICAgICAgICAgaWYgKG5jIDwgMyB8fCBuYyA+IDUpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChuciA+PSAwICYmIG5yIDw9IDIpIGdSZWQucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPj0gNyAmJiBuciA8PSA5KSBnQmxhY2sucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgRElBR19ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgRElBR19ESVJTW2ldWzBdLCBuYyA9IGMgKyBESUFHX0RJUlNbaV1bMV07DQogICAgICAgICAgICAgICAgaWYgKG5jIDwgMyB8fCBuYyA+IDUpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChuciA+PSAwICYmIG5yIDw9IDIpIGFSZWQucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPj0gNyAmJiBuciA8PSA5KSBhQmxhY2sucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgRUxFUEhBTlRfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBFTEVQSEFOVF9ESVJTW2ldOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIGQuZHIsIG5jID0gYyArIGQuZGM7DQogICAgICAgICAgICAgICAgaWYgKG5yIDwgMCB8fCBuciA+PSBST1dTIHx8IG5jIDwgMCB8fCBuYyA+PSBDT0xTKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBjb25zdCBleWVSID0gciArIGQuZXllRHIsIGV5ZUMgPSBjICsgZC5leWVEYzsNCiAgICAgICAgICAgICAgICBpZiAobnIgPD0gNCkgZVJlZC5wdXNoKHsgcjogbnIsIGM6IG5jLCBicjogZXllUiwgYmM6IGV5ZUMgfSk7DQogICAgICAgICAgICAgICAgaWYgKG5yID49IDUpIGVCbGFjay5wdXNoKHsgcjogbnIsIGM6IG5jLCBicjogZXllUiwgYmM6IGV5ZUMgfSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IEhPUlNFX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gSE9SU0VfRElSU1tpXTsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBkLmRyLCBuYyA9IGMgKyBkLmRjOw0KICAgICAgICAgICAgICAgIGNvbnN0IGxlZ1IgPSByICsgZC5sZWdEciwgbGVnQyA9IGMgKyBkLmxlZ0RjOw0KICAgICAgICAgICAgICAgIGlmIChsZWdSIDwgMCB8fCBsZWdSID49IFJPV1MgfHwgbGVnQyA8IDAgfHwgbGVnQyA+PSBDT0xTKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPCAwIHx8IG5yID49IFJPV1MgfHwgbmMgPCAwIHx8IG5jID49IENPTFMpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGhvcnNlLnB1c2goeyByOiBuciwgYzogbmMsIGJyOiBsZWdSLCBiYzogbGVnQyB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHsNCiAgICAgICAgICAgICAgICBjb25zdCBmciA9IHIgKyAxOw0KICAgICAgICAgICAgICAgIGlmIChmciA+PSAwICYmIGZyIDwgUk9XUykgc1JlZC5wdXNoKHsgcjogZnIsIGMgfSk7DQogICAgICAgICAgICAgICAgaWYgKHIgPj0gNSkgew0KICAgICAgICAgICAgICAgICAgICBpZiAoYyAtIDEgPj0gMCkgc1JlZC5wdXNoKHsgciwgYzogYyAtIDEgfSk7DQogICAgICAgICAgICAgICAgICAgIGlmIChjICsgMSA8IENPTFMpIHNSZWQucHVzaCh7IHIsIGM6IGMgKyAxIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBjb25zdCBmYnIgPSByIC0gMTsNCiAgICAgICAgICAgICAgICBpZiAoZmJyID49IDAgJiYgZmJyIDwgUk9XUykgc0JsYWNrLnB1c2goeyByOiBmYnIsIGMgfSk7DQogICAgICAgICAgICAgICAgaWYgKHIgPD0gNCkgew0KICAgICAgICAgICAgICAgICAgICBpZiAoYyAtIDEgPj0gMCkgc0JsYWNrLnB1c2goeyByLCBjOiBjIC0gMSB9KTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGMgKyAxIDwgQ09MUykgc0JsYWNrLnB1c2goeyByLCBjOiBjICsgMSB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIEdFTkVSQUxfREVTVFswXVtzcV0gPSBnUmVkOw0KICAgICAgICAgICAgR0VORVJBTF9ERVNUWzFdW3NxXSA9IGdCbGFjazsNCiAgICAgICAgICAgIEFEVklTT1JfREVTVFswXVtzcV0gPSBhUmVkOw0KICAgICAgICAgICAgQURWSVNPUl9ERVNUWzFdW3NxXSA9IGFCbGFjazsNCiAgICAgICAgICAgIEVMRVBIQU5UX0RFU1RbMF1bc3FdID0gZVJlZDsNCiAgICAgICAgICAgIEVMRVBIQU5UX0RFU1RbMV1bc3FdID0gZUJsYWNrOw0KICAgICAgICAgICAgSE9SU0VfREVTVFtzcV0gPSBob3JzZTsNCiAgICAgICAgICAgIFNPTERJRVJfREVTVFswXVtzcV0gPSBzUmVkOw0KICAgICAgICAgICAgU09MRElFUl9ERVNUWzFdW3NxXSA9IHNCbGFjazsNCiAgICAgICAgfQ0KICAgIH0NCn0pKCk7DQoNCmNvbnN0IFNFQVJDSF9HRU5FUkFMX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07DQpjb25zdCBTRUFSQ0hfQURWSVNPUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgU0VBUkNIX0VMRVBIQU5UX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07DQpjb25zdCBTRUFSQ0hfSE9SU0VfREVTVCA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7DQpjb25zdCBTRUFSQ0hfU09MRElFUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KLy8gQWxsIG9ydGhvZ29uYWwgcmF5cyBsaXZlIGluIG9uZSBjb21wYWN0IGJ1ZmZlci4gVGhlIG9mZnNldCB0YWJsZSBhdm9pZHMNCi8vIGh1bmRyZWRzIG9mIHRpbnkgVHlwZWRBcnJheXMgaW4gdGhlIHJlbGF0aW9uLCBwc2V1ZG8tbW92ZSwgYW5kIGNoZWNrIHBhdGhzLg0KY29uc3QgU0VBUkNIX1JBWV9PRkZTRVRTID0gbmV3IFVpbnQxNkFycmF5KFJFTF9TUVVBUkVTICogT1JUSF9ESVJTLmxlbmd0aCArIDEpOw0KbGV0IFNFQVJDSF9SQVlfU1FVQVJFUyA9IG51bGw7DQpjb25zdCBTRUFSQ0hfUkFZX0RJUlMgPSA0Ow0KY29uc3QgU0VBUkNIX0hPUlNFX0NIRUNLRVJTID0gbmV3IEFycmF5KFJFTF9TUVVBUkVTKTsNCmNvbnN0IFNFQVJDSF9TUV9ST1dTID0gbmV3IFVpbnQ4QXJyYXkoUkVMX1NRVUFSRVMpOw0KY29uc3QgU0VBUkNIX1NRX0NPTFMgPSBuZXcgVWludDhBcnJheShSRUxfU1FVQVJFUyk7DQoNCigoKSA9PiB7DQogICAgY29uc3Qgc2VhcmNoUmF5U3F1YXJlcyA9IFtdOw0KICAgIGNvbnN0IHNxdWFyZURlc3RpbmF0aW9ucyA9IChkZXN0cykgPT4gew0KICAgICAgICBjb25zdCBwYWNrZWQgPSBuZXcgVWludDhBcnJheShkZXN0cy5sZW5ndGgpOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSBwYWNrZWRbaV0gPSBkZXN0c1tpXS5yICogOSArIGRlc3RzW2ldLmM7DQogICAgICAgIHJldHVybiBwYWNrZWQ7DQogICAgfTsNCiAgICBjb25zdCBibG9ja2VkRGVzdGluYXRpb25zID0gKGRlc3RzKSA9PiB7DQogICAgICAgIGNvbnN0IHBhY2tlZCA9IG5ldyBVaW50MTZBcnJheShkZXN0cy5sZW5ndGgpOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBwYWNrZWRbaV0gPSAoZGVzdHNbaV0uYnIgKiA5ICsgZGVzdHNbaV0uYmMpICogMTI4ICsgZGVzdHNbaV0uciAqIDkgKyBkZXN0c1tpXS5jOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBwYWNrZWQ7DQogICAgfTsNCg0KICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgew0KICAgICAgICBTRUFSQ0hfR0VORVJBTF9ERVNUWzBdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhHRU5FUkFMX0RFU1RbMF1bc3FdKTsNCiAgICAgICAgU0VBUkNIX0dFTkVSQUxfREVTVFsxXVtzcV0gPSBzcXVhcmVEZXN0aW5hdGlvbnMoR0VORVJBTF9ERVNUWzFdW3NxXSk7DQogICAgICAgIFNFQVJDSF9BRFZJU09SX0RFU1RbMF1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKEFEVklTT1JfREVTVFswXVtzcV0pOw0KICAgICAgICBTRUFSQ0hfQURWSVNPUl9ERVNUWzFdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhBRFZJU09SX0RFU1RbMV1bc3FdKTsNCiAgICAgICAgU0VBUkNIX0VMRVBIQU5UX0RFU1RbMF1bc3FdID0gYmxvY2tlZERlc3RpbmF0aW9ucyhFTEVQSEFOVF9ERVNUWzBdW3NxXSk7DQogICAgICAgIFNFQVJDSF9FTEVQSEFOVF9ERVNUWzFdW3NxXSA9IGJsb2NrZWREZXN0aW5hdGlvbnMoRUxFUEhBTlRfREVTVFsxXVtzcV0pOw0KICAgICAgICBTRUFSQ0hfSE9SU0VfREVTVFtzcV0gPSBibG9ja2VkRGVzdGluYXRpb25zKEhPUlNFX0RFU1Rbc3FdKTsNCiAgICAgICAgU0VBUkNIX1NPTERJRVJfREVTVFswXVtzcV0gPSBzcXVhcmVEZXN0aW5hdGlvbnMoU09MRElFUl9ERVNUWzBdW3NxXSk7DQogICAgICAgIFNFQVJDSF9TT0xESUVSX0RFU1RbMV1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKFNPTERJRVJfREVTVFsxXVtzcV0pOw0KDQogICAgICAgIGNvbnN0IHIgPSAoc3EgLyA5KSB8IDA7DQogICAgICAgIGNvbnN0IGMgPSBzcSAlIDk7DQogICAgICAgIFNFQVJDSF9TUV9ST1dTW3NxXSA9IHI7DQogICAgICAgIFNFQVJDSF9TUV9DT0xTW3NxXSA9IGM7DQogICAgICAgIGZvciAobGV0IGRpciA9IDA7IGRpciA8IE9SVEhfRElSUy5sZW5ndGg7IGRpcisrKSB7DQogICAgICAgICAgICBTRUFSQ0hfUkFZX09GRlNFVFNbKHNxIDw8IDIpIHwgZGlyXSA9IHNlYXJjaFJheVNxdWFyZXMubGVuZ3RoOw0KICAgICAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbZGlyXVswXTsNCiAgICAgICAgICAgIGNvbnN0IGRjID0gT1JUSF9ESVJTW2Rpcl1bMV07DQogICAgICAgICAgICBmb3IgKGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7IG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTOyBuciArPSBkciwgbmMgKz0gZGMpIHsNCiAgICAgICAgICAgICAgICBzZWFyY2hSYXlTcXVhcmVzLnB1c2gobnIgKiA5ICsgbmMpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgY29uc3QgaG9yc2VDaGVja2VycyA9IFtdOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IEhPUlNFX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IGQgPSBIT1JTRV9ESVJTW2ldOw0KICAgICAgICAgICAgY29uc3QgaG9yc2VSID0gciArIGQuZHI7DQogICAgICAgICAgICBjb25zdCBob3JzZUMgPSBjICsgZC5kYzsNCiAgICAgICAgICAgIGlmIChob3JzZVIgPCAwIHx8IGhvcnNlUiA+PSBST1dTIHx8IGhvcnNlQyA8IDAgfHwgaG9yc2VDID49IENPTFMpIGNvbnRpbnVlOw0KICAgICAgICAgICAgY29uc3QgbGVnUiA9IGhvcnNlUiAtIGQubGVnRHI7DQogICAgICAgICAgICBjb25zdCBsZWdDID0gaG9yc2VDIC0gZC5sZWdEYzsNCiAgICAgICAgICAgIGhvcnNlQ2hlY2tlcnMucHVzaCgobGVnUiAqIDkgKyBsZWdDKSAqIDEyOCArIGhvcnNlUiAqIDkgKyBob3JzZUMpOw0KICAgICAgICB9DQogICAgICAgIFNFQVJDSF9IT1JTRV9DSEVDS0VSU1tzcV0gPSBuZXcgVWludDE2QXJyYXkoaG9yc2VDaGVja2Vycyk7DQogICAgfQ0KICAgIFNFQVJDSF9SQVlfT0ZGU0VUU1tSRUxfU1FVQVJFUyA8PCAyXSA9IHNlYXJjaFJheVNxdWFyZXMubGVuZ3RoOw0KICAgIFNFQVJDSF9SQVlfU1FVQVJFUyA9IG5ldyBVaW50OEFycmF5KHNlYXJjaFJheVNxdWFyZXMpOw0KfSkoKTsNCg0KY29uc3QgYXBwZW5kU2VhcmNoU2hvcnRNb3ZlcyA9IChtb3ZlcywgZnJvbVNxLCBkZXN0cywgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIGJsb2NrZWQpID0+IHsNCiAgICBsZXQgZ2VuZXJhdGVkID0gMDsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGxldCB0b1NxID0gZGVzdHNbaV07DQogICAgICAgIGlmIChibG9ja2VkKSB7DQogICAgICAgICAgICBpZiAoc3F1YXJlQ29kZXNbdG9TcSA+Pj4gN10gIT09IDApIGNvbnRpbnVlOw0KICAgICAgICAgICAgdG9TcSAmPSAxMjc7DQogICAgICAgIH0NCiAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3RvU3FdOw0KICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICAgICAgZ2VuZXJhdGVkKys7DQogICAgICAgICAgICBpZiAoIWNhcHR1cmVzT25seSkgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7DQogICAgICAgIH0gZWxzZSBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHsNCiAgICAgICAgICAgIGdlbmVyYXRlZCsrOw0KICAgICAgICAgICAgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7DQogICAgICAgIH0NCiAgICB9DQogICAgcmV0dXJuIGdlbmVyYXRlZDsNCn07DQoNCmNvbnN0IGFwcGVuZFNlYXJjaFBzZXVkb01vdmVzRm9yUGllY2UgPSAobW92ZXMsIGZyb21TcSwgcGllY2VDb2RlLCBzcXVhcmVDb2RlcywgY2FwdHVyZXNPbmx5ID0gZmFsc2UpID0+IHsNCiAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZUNvZGUgJiA3Ow0KICAgIGNvbnN0IGlzUmVkID0gcGllY2VDb2RlIDwgODsNCiAgICBjb25zdCBjb2xvcklkeCA9IGlzUmVkID8gMCA6IDE7DQogICAgbGV0IGdlbmVyYXRlZCA9IDA7DQoNCiAgICBzd2l0Y2ggKHBpZWNlVHlwZSkgew0KICAgICAgICBjYXNlIDE6DQogICAgICAgICAgICByZXR1cm4gYXBwZW5kU2VhcmNoU2hvcnRNb3Zlcyhtb3ZlcywgZnJvbVNxLCBTRUFSQ0hfR0VORVJBTF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdLCBzcXVhcmVDb2RlcywgaXNSZWQsIGNhcHR1cmVzT25seSwgZmFsc2UpOw0KICAgICAgICBjYXNlIDU6DQogICAgICAgICAgICByZXR1cm4gYXBwZW5kU2VhcmNoU2hvcnRNb3Zlcyhtb3ZlcywgZnJvbVNxLCBTRUFSQ0hfQURWSVNPUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdLCBzcXVhcmVDb2RlcywgaXNSZWQsIGNhcHR1cmVzT25seSwgZmFsc2UpOw0KICAgICAgICBjYXNlIDQ6DQogICAgICAgICAgICByZXR1cm4gYXBwZW5kU2VhcmNoU2hvcnRNb3Zlcyhtb3ZlcywgZnJvbVNxLCBTRUFSQ0hfRUxFUEhBTlRfREVTVFtjb2xvcklkeF1bZnJvbVNxXSwgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIHRydWUpOw0KICAgICAgICBjYXNlIDM6DQogICAgICAgICAgICByZXR1cm4gYXBwZW5kU2VhcmNoU2hvcnRNb3Zlcyhtb3ZlcywgZnJvbVNxLCBTRUFSQ0hfSE9SU0VfREVTVFtmcm9tU3FdLCBzcXVhcmVDb2RlcywgaXNSZWQsIGNhcHR1cmVzT25seSwgdHJ1ZSk7DQogICAgICAgIGNhc2UgNzoNCiAgICAgICAgICAgIHJldHVybiBhcHBlbmRTZWFyY2hTaG9ydE1vdmVzKG1vdmVzLCBmcm9tU3EsIFNFQVJDSF9TT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV0sIHNxdWFyZUNvZGVzLCBpc1JlZCwgY2FwdHVyZXNPbmx5LCBmYWxzZSk7DQogICAgICAgIGNhc2UgMjoNCiAgICAgICAgICAgIGZvciAobGV0IGRpciA9IDAsIHJheUluZGV4ID0gZnJvbVNxIDw8IDI7IGRpciA8IFNFQVJDSF9SQVlfRElSUzsgZGlyKyssIHJheUluZGV4KyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCByYXlFbmQgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXggKyAxXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCByYXlQb3MgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXhdOyByYXlQb3MgPCByYXlFbmQ7IHJheVBvcysrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvU3EgPSBTRUFSQ0hfUkFZX1NRVUFSRVNbcmF5UG9zXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3RvU3FdOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgZ2VuZXJhdGVkKys7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWNhcHR1cmVzT25seSkgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBnZW5lcmF0ZWQrKzsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKChmcm9tU3EgPDwgNykgfCB0b1NxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgcmV0dXJuIGdlbmVyYXRlZDsNCiAgICAgICAgY2FzZSA2Og0KICAgICAgICAgICAgZm9yIChsZXQgZGlyID0gMCwgcmF5SW5kZXggPSBmcm9tU3EgPDwgMjsgZGlyIDwgU0VBUkNIX1JBWV9ESVJTOyBkaXIrKywgcmF5SW5kZXgrKykgew0KICAgICAgICAgICAgICAgIGxldCBzY3JlZW5Gb3VuZCA9IGZhbHNlOw0KICAgICAgICAgICAgICAgIGNvbnN0IHJheUVuZCA9IFNFQVJDSF9SQVlfT0ZGU0VUU1tyYXlJbmRleCArIDFdOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IHJheVBvcyA9IFNFQVJDSF9SQVlfT0ZGU0VUU1tyYXlJbmRleF07IHJheVBvcyA8IHJheUVuZDsgcmF5UG9zKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9TcSA9IFNFQVJDSF9SQVlfU1FVQVJFU1tyYXlQb3NdOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbdG9TcV07DQogICAgICAgICAgICAgICAgICAgIGlmICghc2NyZWVuRm91bmQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2VuZXJhdGVkKys7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjYXB0dXJlc09ubHkpIG1vdmVzLnB1c2goKGZyb21TcSA8PCA3KSB8IHRvU3EpOw0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzY3JlZW5Gb3VuZCA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0Q29kZSAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2VuZXJhdGVkKys7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHJldHVybiBnZW5lcmF0ZWQ7DQogICAgICAgIGRlZmF1bHQ6DQogICAgICAgICAgICByZXR1cm4gZ2VuZXJhdGVkOw0KICAgIH0NCn07DQoNCi8vIOaooeWdl+e6p+iQveeCueWkhOeQhu+8iOmdnuavj+WtkOaWsOW7uumXreWMhe+8ie+8m+i/lOWbnuacuuWKqOWinumHjw0KLy8gcGllY2VBdFNxOiA5MCDmoLwg4oaSIHBpZWNlc0luZm/vvJtyZWxDdHgudXNlTWFza3Mg5pe25YaZIG1hc2sNCmNvbnN0IGFwcGx5UmVsYXRpb25TcXVhcmUgPSAoYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgdHIsIHRjLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yKSA9PiB7DQogICAgaWYgKHRyIDwgMCB8fCB0ciA+PSBST1dTIHx8IHRjIDwgMCB8fCB0YyA+PSBDT0xTKSByZXR1cm4gMDsNCiAgICBjb25zdCB0YXJnZXQgPSBib2FyZFt0cl1bdGNdOw0KICAgIGlmICghdGFyZ2V0KSB7DQogICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgY29uc3Qgc3EgPSB0ciAqIDkgKyB0YzsNCiAgICAgICAgICAgIGlmICghcmVsQ3R4LnNraXBDb250cm9sTWFzaykgcmVsQ3R4LmNvbnRyb2xNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChyZWxDdHgucmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICBlbHNlIHNldEF0dGFja0JpdChyZWxDdHguYmxhY2tBdHRhY2ssIHNxKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICB9DQogICAgaWYgKHRhcmdldC5jb2xvciAhPT0gcGllY2VDb2xvcikgew0KICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgIGlmIChwaWVjZUF0U3FbdHIgKiA5ICsgdGNdKSB7DQogICAgICAgICAgICAgICAgcmVsQ3R4LmF0dGFja01hc2tbdHIgKiA5ICsgdGNdIHw9IGJpdDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbdHIgKiA5ICsgdGNdOw0KICAgICAgICAgICAgaWYgKHRhcmdldEluZm8pIHsNCiAgICAgICAgICAgICAgICBpbmZvLnRocmVhdC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIDA7DQogICAgfQ0KICAgIGlmICh0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbdHIgKiA5ICsgdGNdOw0KICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICByZWxDdHguZ3VhcmRNYXNrW3RyICogOSArIHRjXSB8PSBiaXQ7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLmd1YXJkZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgIGluZm8uYWxseUd1YXJkcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiAwOw0KfTsNCg0KLy8g6Z2e54Ku77ya5LiA5qyh5Yeg5L2V5omr5o+P77yb55+t5q2l5a2Q6LWw6aKE6KGo77yM6L2m5LuN5bCE57q/77yb6K+t5LmJ5LiOIGdldFBpZWNlTW92ZXMg5LiA6Ie0DQpjb25zdCBmaWxsTm9uQ2Fubm9uUmVsYXRpb25zID0gKGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIHJlbEN0eCA9IG51bGwpID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGluZm8ucGllY2U7DQogICAgY29uc3QgeyByLCBjIH0gPSBpbmZvOw0KICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICAgIGNvbnN0IHBpZWNlQ29sb3IgPSBwaWVjZS5jb2xvcjsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKHJlbEN0eCAmJiByZWxDdHgudXNlTWFza3MpOw0KICAgIGNvbnN0IHNraXBDb250cm9sID0gdXNlTWFza3MgJiYgcmVsQ3R4LnNraXBDb250cm9sTWFzazsNCiAgICBjb25zdCBiaXQgPSB1c2VNYXNrcyA/ICgxIDw8IHJlbEN0eC5waWVjZUluZGV4KSA6IDA7DQogICAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOw0KICAgIGNvbnN0IGZyb21TcSA9IHIgKiA5ICsgYzsNCiAgICBpZiAoIXVzZU1hc2tzKSB7DQogICAgICAgIGluZm8ubW92ZXMgPSBbXTsNCiAgICAgICAgaW5mby5jb250cm9sID0gW107DQogICAgICAgIGluZm8uYWxseUd1YXJkcyA9IFtdOw0KICAgIH0NCiAgICBsZXQgbW9iaWxpdHlWYWx1ZSA9IDA7DQoNCiAgICBzd2l0Y2ggKHBpZWNlLnR5cGUpIHsNCiAgICAgICAgY2FzZSAnZ2VuZXJhbCc6IHsNCiAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gR0VORVJBTF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoDQogICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGNhc2UgJ2Fkdmlzb3InOiB7DQogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEFEVklTT1JfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVJlbGF0aW9uU3F1YXJlKA0KICAgICAgICAgICAgICAgICAgICBib2FyZCwgaW5mbywgcGllY2VBdFNxLCBkLnIsIGQuYywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcg0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBjYXNlICdlbGVwaGFudCc6IHsNCiAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gRUxFUEhBTlRfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW2QuYnJdW2QuYmNdID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnaG9yc2UnOiB7DQogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEhPUlNFX0RFU1RbZnJvbVNxXTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW2QuYnJdW2QuYmNdID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnY2hhcmlvdCc6DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIHdoaWxlIChuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0ID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzcSA9IG5yICogOSArIG5jOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghc2tpcENvbnRyb2wpIHJlbEN0eC5jb250cm9sTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHJlbEN0eC5yZWRBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHNldEF0dGFja0JpdChyZWxDdHguYmxhY2tBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlQXRTcVtuciAqIDkgKyBuY10pIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5hdHRhY2tNYXNrW25yICogOSArIG5jXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbbnIgKiA5ICsgbmNdOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW25yICogOSArIG5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsQ3R4Lmd1YXJkTWFza1tuciAqIDkgKyBuY10gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5ndWFyZC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uYWxseUd1YXJkcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICAgICAgICAgIG5jICs9IGRjOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICBjYXNlICdzb2xkaWVyJzogew0KICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBTT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgZC5yLCBkLmMsIHVzZU1hc2tzLCBiaXQsIHJlbEN0eCwgaXNSZWQsIHBpZWNlQ29sb3INCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgZGVmYXVsdDoNCiAgICAgICAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOw0KfTsNCg0KLy8g54Ku77ya5LiA5qyh5Zub5ZCR5bCE57q/77ybbWFzayDmqKHlvI/lhpkgYXR0YWNrL2d1YXJkL2NvbnRyb2zvvIzliJfooajmqKHlvI/kv53mjIHml6for63kuYkNCmNvbnN0IGZpbGxDYW5ub25SZWxhdGlvbnMgPSAoYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgcmVsQ3R4ID0gbnVsbCkgPT4gew0KICAgIGNvbnN0IHBpZWNlID0gaW5mby5waWVjZTsNCiAgICBjb25zdCB7IHIsIGMgfSA9IGluZm87DQogICAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQogICAgY29uc3QgcGllY2VDb2xvciA9IHBpZWNlLmNvbG9yOw0KICAgIGNvbnN0IHsgYmFzZU1vdmVWYWx1ZSB9ID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5Ow0KICAgIGNvbnN0IHVzZU1hc2tzID0gISEocmVsQ3R4ICYmIHJlbEN0eC51c2VNYXNrcyk7DQogICAgY29uc3Qgc2tpcENvbnRyb2wgPSB1c2VNYXNrcyAmJiByZWxDdHguc2tpcENvbnRyb2xNYXNrOw0KICAgIGNvbnN0IGJpdCA9IHVzZU1hc2tzID8gKDEgPDwgcmVsQ3R4LnBpZWNlSW5kZXgpIDogMDsNCiAgICBpZiAoIXVzZU1hc2tzKSB7DQogICAgICAgIGluZm8ubW92ZXMgPSBbXTsNCiAgICAgICAgaW5mby5jb250cm9sID0gW107DQogICAgfQ0KICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsNCg0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgbGV0IHNjcmVlbkZvdW5kQ291bnQgPSAwOw0KICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMgJiYgc2NyZWVuRm91bmRDb3VudCA8IDIpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgIT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICBzY3JlZW5Gb3VuZENvdW50Kys7DQogICAgICAgICAgICAgICAgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDIpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBpZWNlQXRTcVtuciAqIDkgKyBuY107DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRJbmZvICYmIHRhcmdldEluZm8gIT09IGluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yICE9PSBwaWVjZUNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5hdHRhY2tNYXNrW25yICogOSArIG5jXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby50aHJlYXRlbmVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsQ3R4Lmd1YXJkTWFza1tuciAqIDkgKyBuY10gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocC5jb2xvciAhPT0gcGllY2VDb2xvcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF1c2VNYXNrcykgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMCkgew0KICAgICAgICAgICAgICAgIGlmICghdXNlTWFza3MpIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDEpIHsNCiAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBuciAqIDkgKyBuYzsNCiAgICAgICAgICAgICAgICAgICAgaWYgKCFza2lwQ29udHJvbCkgcmVsQ3R4LmNvbnRyb2xNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHJlbEN0eC5yZWRBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgaW5mby5jb250cm9sLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOw0KfTsNCg0KLy8g5LuO5qC85L2NIG1hc2sg6L+Y5Y6fIHRocmVhdC9ndWFyZC9jb250cm9sIOWIl+ihqO+8iOeCueajiy9VSe+8iQ0KLy8gU2VhcmNoIGxlYXZlcyBhbHdheXMgdXNlIG1hc2tzIGFuZCBhdHRhY2sgYml0cywgc28gdGhpcyBhdm9pZHMgVUkvY29udHJvbC1saXN0IGJyYW5jaGVzLg0KY29uc3QgYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUgPSAoc3F1YXJlQ29kZXMsIHNxLCBiaXQsIGlzUmVkKSA9PiB7DQogICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3NxXTsNCiAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChzY3JhdGNoUmVkQXR0YWNrLCBzcSk7DQogICAgICAgIGVsc2Ugc2V0QXR0YWNrQml0KHNjcmF0Y2hCbGFja0F0dGFjaywgc3EpOw0KICAgICAgICByZXR1cm4gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5LmJhc2VNb3ZlVmFsdWU7DQogICAgfQ0KICAgIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgew0KICAgICAgICBzY3JhdGNoQXR0YWNrTWFza1tzcV0gfD0gYml0Ow0KICAgIH0gZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgew0KICAgICAgICBzY3JhdGNoR3VhcmRNYXNrW3NxXSB8PSBiaXQ7DQogICAgfQ0KICAgIHJldHVybiAwOw0KfTsNCg0KY29uc3QgY2FsY3VsYXRlU2VhcmNoTGVhZlJlbGF0aW9ucyA9IChwaWVjZXNJbmZvLCBzcXVhcmVDb2RlcykgPT4gew0KICAgIHNjcmF0Y2hBdHRhY2tNYXNrLmZpbGwoMCk7DQogICAgc2NyYXRjaEd1YXJkTWFzay5maWxsKDApOw0KICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsNCiAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaEJsYWNrQXR0YWNrKTsNCg0KICAgIGNvbnN0IGJhc2VNb3ZlVmFsdWUgPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICBmb3IgKGxldCBwaSA9IDA7IHBpIDwgcGllY2VzSW5mby5sZW5ndGg7IHBpKyspIHsNCiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9bcGldOw0KICAgICAgICBjb25zdCByID0gaW5mby5yOw0KICAgICAgICBjb25zdCBjID0gaW5mby5jOw0KICAgICAgICBjb25zdCBmcm9tU3EgPSByICogOSArIGM7DQogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IGluZm8ucGllY2VDb2RlOw0KICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZUNvZGUgJiA3Ow0KICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlQ29kZSA8IDg7DQogICAgICAgIGNvbnN0IGNvbG9ySWR4ID0gaXNSZWQgPyAwIDogMTsNCiAgICAgICAgY29uc3QgYml0ID0gMSA8PCBwaTsNCiAgICAgICAgbGV0IG1vYmlsaXR5VmFsdWUgPSAwOw0KDQogICAgICAgIHN3aXRjaCAocGllY2VUeXBlKSB7DQogICAgICAgICAgICBjYXNlIDE6IHsNCiAgICAgICAgICAgICAgICBjb25zdCBkZXN0cyA9IEdFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVNlYXJjaExlYWZSZWxhdGlvblNxdWFyZShzcXVhcmVDb2RlcywgZC5yICogOSArIGQuYywgYml0LCBpc1JlZCk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgY2FzZSA1OiB7DQogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBBRFZJU09SX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUoc3F1YXJlQ29kZXMsIGQuciAqIDkgKyBkLmMsIGJpdCwgaXNSZWQpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGNhc2UgNDogew0KICAgICAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gRUxFUEhBTlRfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHNxdWFyZUNvZGVzW2QuYnIgKiA5ICsgZC5iY10gPT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUoc3F1YXJlQ29kZXMsIGQuciAqIDkgKyBkLmMsIGJpdCwgaXNSZWQpOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgY2FzZSAzOiB7DQogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBIT1JTRV9ERVNUW2Zyb21TcV07DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgICAgIGlmIChzcXVhcmVDb2Rlc1tkLmJyICogOSArIGQuYmNdID09PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5U2VhcmNoTGVhZlJlbGF0aW9uU3F1YXJlKHNxdWFyZUNvZGVzLCBkLnIgKiA5ICsgZC5jLCBiaXQsIGlzUmVkKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGNhc2UgMjoNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgICAgICAgICAgICAgIGxldCBuciA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IG5jID0gYyArIGRjOw0KICAgICAgICAgICAgICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gbnIgKiA5ICsgbmM7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbc3FdOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChzY3JhdGNoUmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQoc2NyYXRjaEJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHNjcmF0Y2hBdHRhY2tNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgc2NyYXRjaEd1YXJkTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICAgICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIGNhc2UgNjoNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgICAgICAgICAgICAgIGxldCBuciA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IG5jID0gYyArIGRjOw0KICAgICAgICAgICAgICAgICAgICBsZXQgc2NyZWVucyA9IDA7DQogICAgICAgICAgICAgICAgICAgIHdoaWxlIChuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUyAmJiBzY3JlZW5zIDwgMikgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBuciAqIDkgKyBuYzsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1tzcV07DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjcmVlbnMrKzsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2NyZWVucyA9PT0gMikgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHNjcmF0Y2hBdHRhY2tNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCh0YXJnZXRDb2RlICYgNykgIT09IDEpIHNjcmF0Y2hHdWFyZE1hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChzY3JlZW5zID09PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChzY3JhdGNoUmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQoc2NyYXRjaEJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICBuciArPSBkcjsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5jICs9IGRjOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgY2FzZSA3OiB7DQogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBTT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUoc3F1YXJlQ29kZXMsIGQuciAqIDkgKyBkLmMsIGJpdCwgaXNSZWQpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGRlZmF1bHQ6DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgaW5mby5tb2JpbGl0eVZhbHVlID0gbW9iaWxpdHlWYWx1ZTsNCiAgICB9DQp9Ow0KDQovLyBTZWFyY2gtb25seSByZWxhdGlvbiBidWlsZGVyLiBJdCBpcyBlcXVpdmFsZW50IHRvIGNhbGN1bGF0ZVNlYXJjaExlYWZSZWxhdGlvbnMsDQovLyBidXQgcmV1c2VzIHRoZSBwYWNrZWQgbW92ZSB0YWJsZXMgYW5kIHJheXMgYWxyZWFkeSB1c2VkIGJ5IHBzZXVkbyBtb3ZlIGdlbmVyYXRpb24uDQpjb25zdCBjYWxjdWxhdGVQYWNrZWRTZWFyY2hMZWFmUmVsYXRpb25zID0gKHBpZWNlc0luZm8sIHNxdWFyZUNvZGVzKSA9PiB7DQogICAgc2NyYXRjaEF0dGFja01hc2suZmlsbCgwKTsNCiAgICBzY3JhdGNoR3VhcmRNYXNrLmZpbGwoMCk7DQogICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOw0KICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOw0KDQogICAgY29uc3QgYmFzZU1vdmVWYWx1ZSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eS5iYXNlTW92ZVZhbHVlOw0KICAgIGNvbnN0IGF0dGFja01hc2sgPSBzY3JhdGNoQXR0YWNrTWFzazsNCiAgICBjb25zdCBndWFyZE1hc2sgPSBzY3JhdGNoR3VhcmRNYXNrOw0KICAgIGNvbnN0IHJlZEF0dGFjayA9IHNjcmF0Y2hSZWRBdHRhY2s7DQogICAgY29uc3QgYmxhY2tBdHRhY2sgPSBzY3JhdGNoQmxhY2tBdHRhY2s7DQoNCiAgICBmb3IgKGxldCBwaSA9IDA7IHBpIDwgcGllY2VzSW5mby5sZW5ndGg7IHBpKyspIHsNCiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9bcGldOw0KICAgICAgICAvLyBTbG90cyBhcmUgcmV1c2VkIGJldHdlZW4gbGVhdmVzLiBDbGVhciBkZXJpdmVkIHNjb3JlcyB3aGlsZSBhbHJlYWR5DQogICAgICAgIC8vIHZpc2l0aW5nIGVhY2ggcGllY2UgdG8gYnVpbGQgaXRzIHBhY2tlZCBhdHRhY2sgYW5kIGd1YXJkIHJlbGF0aW9ucy4NCiAgICAgICAgaW5mby50aHJlYXRWYWx1ZSA9IDA7DQogICAgICAgIGluZm8uc2FmZXR5VmFsdWUgPSAwOw0KICAgICAgICBpbmZvLnRhY3RpY1ZhbHVlID0gMDsNCiAgICAgICAgY29uc3QgZnJvbVNxID0gaW5mby5zcTsNCiAgICAgICAgY29uc3QgcGllY2VDb2RlID0gaW5mby5waWVjZUNvZGU7DQogICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlQ29kZSAmIDc7DQogICAgICAgIGNvbnN0IGlzUmVkID0gcGllY2VDb2RlIDwgODsNCiAgICAgICAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOw0KICAgICAgICBjb25zdCBiaXQgPSAxIDw8IHBpOw0KICAgICAgICBjb25zdCBhdHRhY2tCaXRzID0gaXNSZWQgPyByZWRBdHRhY2sgOiBibGFja0F0dGFjazsNCiAgICAgICAgbGV0IG1vYmlsaXR5VmFsdWUgPSAwOw0KDQogICAgICAgIHN3aXRjaCAocGllY2VUeXBlKSB7DQogICAgICAgICAgICBjYXNlIDE6DQogICAgICAgICAgICBjYXNlIDU6DQogICAgICAgICAgICBjYXNlIDc6IHsNCiAgICAgICAgICAgICAgICBjb25zdCBkZXN0cyA9IHBpZWNlVHlwZSA9PT0gMQ0KICAgICAgICAgICAgICAgICAgICA/IFNFQVJDSF9HRU5FUkFMX0RFU1RbY29sb3JJZHhdW2Zyb21TcV0NCiAgICAgICAgICAgICAgICAgICAgOiBwaWVjZVR5cGUgPT09IDUNCiAgICAgICAgICAgICAgICAgICAgICAgID8gU0VBUkNIX0FEVklTT1JfREVTVFtjb2xvcklkeF1bZnJvbVNxXQ0KICAgICAgICAgICAgICAgICAgICAgICAgOiBTRUFSQ0hfU09MRElFUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3NxXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja0JpdHNbc3EgPj4+IDVdIHw9IDEgPDwgKHNxICYgMzEpOw0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBjYXNlIDQ6DQogICAgICAgICAgICBjYXNlIDM6IHsNCiAgICAgICAgICAgICAgICBjb25zdCBkZXN0cyA9IHBpZWNlVHlwZSA9PT0gNA0KICAgICAgICAgICAgICAgICAgICA/IFNFQVJDSF9FTEVQSEFOVF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdDQogICAgICAgICAgICAgICAgICAgIDogU0VBUkNIX0hPUlNFX0RFU1RbZnJvbVNxXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhY2tlZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgICAgICBpZiAoc3F1YXJlQ29kZXNbcGFja2VkID4+PiA3XSAhPT0gMCkgY29udGludWU7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gcGFja2VkICYgMTI3Ow0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbc3FdOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrQml0c1tzcSA+Pj4gNV0gfD0gMSA8PCAoc3EgJiAzMSk7DQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja01hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICgodGFyZ2V0Q29kZSAmIDcpICE9PSAxKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZE1hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGNhc2UgMjoNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBkaXIgPSAwLCByYXlJbmRleCA9IGZyb21TcSA8PCAyOyBkaXIgPCBTRUFSQ0hfUkFZX0RJUlM7IGRpcisrLCByYXlJbmRleCsrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHJheUVuZCA9IFNFQVJDSF9SQVlfT0ZGU0VUU1tyYXlJbmRleCArIDFdOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCByYXlQb3MgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXhdOyByYXlQb3MgPCByYXlFbmQ7IHJheVBvcysrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzcSA9IFNFQVJDSF9SQVlfU1FVQVJFU1tyYXlQb3NdOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3NxXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrQml0c1tzcSA+Pj4gNV0gfD0gMSA8PCAoc3EgJiAzMSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSBhdHRhY2tNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICBlbHNlIGlmICgodGFyZ2V0Q29kZSAmIDcpICE9PSAxKSBndWFyZE1hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgY2FzZSA2Og0KICAgICAgICAgICAgICAgIGZvciAobGV0IGRpciA9IDAsIHJheUluZGV4ID0gZnJvbVNxIDw8IDI7IGRpciA8IFNFQVJDSF9SQVlfRElSUzsgZGlyKyssIHJheUluZGV4KyspIHsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHNjcmVlbkZvdW5kID0gZmFsc2U7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHJheUVuZCA9IFNFQVJDSF9SQVlfT0ZGU0VUU1tyYXlJbmRleCArIDFdOw0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCByYXlQb3MgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXhdOyByYXlQb3MgPCByYXlFbmQ7IHJheVBvcysrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzcSA9IFNFQVJDSF9SQVlfU1FVQVJFU1tyYXlQb3NdOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3NxXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghc2NyZWVuRm91bmQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2NyZWVuRm91bmQgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja0JpdHNbc3EgPj4+IDVdIHw9IDEgPDwgKHNxICYgMzEpOw0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIGF0dGFja01hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIGlmICgodGFyZ2V0Q29kZSAmIDcpICE9PSAxKSBndWFyZE1hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIGRlZmF1bHQ6DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgaW5mby5tb2JpbGl0eVZhbHVlID0gbW9iaWxpdHlWYWx1ZTsNCiAgICB9DQp9Ow0KDQpjb25zdCBoeWRyYXRlUmVsYXRpb25zRnJvbU1hc2tzID0gKHBpZWNlc0luZm8sIGJvYXJkSW5mbykgPT4gew0KICAgIGNvbnN0IGF0dGFja01hc2sgPSBib2FyZEluZm8uYXR0YWNrTWFzazsNCiAgICBjb25zdCBndWFyZE1hc2sgPSBib2FyZEluZm8uZ3VhcmRNYXNrOw0KICAgIGNvbnN0IGNvbnRyb2xNYXNrID0gYm9hcmRJbmZvLmNvbnRyb2xNYXNrOw0KICAgIGNvbnN0IG4gPSBwaWVjZXNJbmZvLmxlbmd0aDsNCiAgICBjb25zdCBieVNxID0gbmV3IEFycmF5KFJFTF9TUVVBUkVTKTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykgew0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgaW5mby50aHJlYXQgPSBbXTsNCiAgICAgICAgaW5mby50aHJlYXRlbmVkQnkgPSBbXTsNCiAgICAgICAgaW5mby5ndWFyZCA9IFtdOw0KICAgICAgICBpbmZvLmd1YXJkZWRCeSA9IFtdOw0KICAgICAgICBpbmZvLmNvbnRyb2wgPSBbXTsNCiAgICAgICAgYnlTcVtpbmZvLnIgKiA5ICsgaW5mby5jXSA9IGluZm87DQogICAgfQ0KDQogICAgZm9yIChsZXQgc3EgPSAwOyBzcSA8IFJFTF9TUVVBUkVTOyBzcSsrKSB7DQogICAgICAgIGNvbnN0IHIgPSAoc3EgLyA5KSB8IDA7DQogICAgICAgIGNvbnN0IGMgPSBzcSAlIDk7DQogICAgICAgIGNvbnN0IHRhcmdldCA9IGJ5U3Fbc3FdOw0KDQogICAgICAgIGxldCBjbSA9IGNvbnRyb2xNYXNrW3NxXSA+Pj4gMDsNCiAgICAgICAgd2hpbGUgKGNtICE9PSAwKSB7DQogICAgICAgICAgICBjb25zdCBiaXQgPSBjbSAmIC1jbTsNCiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsNCiAgICAgICAgICAgIHBpZWNlc0luZm9baV0uY29udHJvbC5wdXNoKHsgciwgYyB9KTsNCiAgICAgICAgICAgIGNtIF49IGJpdDsNCiAgICAgICAgfQ0KDQogICAgICAgIGxldCBhbSA9IGF0dGFja01hc2tbc3FdID4+PiAwOw0KICAgICAgICB3aGlsZSAoYW0gIT09IDApIHsNCiAgICAgICAgICAgIGNvbnN0IGJpdCA9IGFtICYgLWFtOw0KICAgICAgICAgICAgY29uc3QgaSA9IDMxIC0gTWF0aC5jbHozMihiaXQpOw0KICAgICAgICAgICAgY29uc3QgYXR0YWNrZXIgPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICAgICAgaWYgKHRhcmdldCAmJiB0YXJnZXQgIT09IGF0dGFja2VyICYmIHRhcmdldC5waWVjZS5jb2xvciAhPT0gYXR0YWNrZXIucGllY2UuY29sb3IpIHsNCiAgICAgICAgICAgICAgICBhdHRhY2tlci50aHJlYXQucHVzaCh0YXJnZXQpOw0KICAgICAgICAgICAgICAgIHRhcmdldC50aHJlYXRlbmVkQnkucHVzaChhdHRhY2tlcik7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBhbSBePSBiaXQ7DQogICAgICAgIH0NCg0KICAgICAgICBsZXQgZ20gPSBndWFyZE1hc2tbc3FdID4+PiAwOw0KICAgICAgICB3aGlsZSAoZ20gIT09IDApIHsNCiAgICAgICAgICAgIGNvbnN0IGJpdCA9IGdtICYgLWdtOw0KICAgICAgICAgICAgY29uc3QgaSA9IDMxIC0gTWF0aC5jbHozMihiaXQpOw0KICAgICAgICAgICAgY29uc3QgZ3VhcmRlciA9IHBpZWNlc0luZm9baV07DQogICAgICAgICAgICBpZiAodGFyZ2V0ICYmIHRhcmdldCAhPT0gZ3VhcmRlciAmJiB0YXJnZXQucGllY2UuY29sb3IgPT09IGd1YXJkZXIucGllY2UuY29sb3IpIHsNCiAgICAgICAgICAgICAgICBndWFyZGVyLmd1YXJkLnB1c2godGFyZ2V0KTsNCiAgICAgICAgICAgICAgICB0YXJnZXQuZ3VhcmRlZEJ5LnB1c2goZ3VhcmRlcik7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBnbSBePSBiaXQ7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDkvpsgaXNQb3NpdGlvbkFjY2VwdGFibGUgLyDngrnmo4sgY29udHJvbGxlcnPvvJrkuI7ml6for63kuYnkuIDoh7TvvIzku4XnqbrmjqfmoLwNCiAgICBjb25zdCBncmlkID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsNCiAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsNCiAgICAgICAgbGV0IGNtID0gY29udHJvbE1hc2tbc3FdID4+PiAwOw0KICAgICAgICBpZiAoY20gPT09IDApIGNvbnRpbnVlOw0KICAgICAgICBjb25zdCByID0gKHNxIC8gOSkgfCAwOw0KICAgICAgICBjb25zdCBjID0gc3EgJSA5Ow0KICAgICAgICB3aGlsZSAoY20gIT09IDApIHsNCiAgICAgICAgICAgIGNvbnN0IGJpdCA9IGNtICYgLWNtOw0KICAgICAgICAgICAgY29uc3QgaSA9IDMxIC0gTWF0aC5jbHozMihiaXQpOw0KICAgICAgICAgICAgZ3JpZFtyXVtjXS5wdXNoKHBpZWNlc0luZm9baV0pOw0KICAgICAgICAgICAgY20gXj0gYml0Ow0KICAgICAgICB9DQogICAgfQ0KICAgIGJvYXJkSW5mby5jb250cm9sbGVyR3JpZCA9IGdyaWQ7DQp9Ow0KDQovLyDorqHnrpfmo4vlrZDlhbPns7vvvJptYXNrIOi3r+W+hOWGmSBVaW50MzIg5qC85L2N6KGo77yb5YiX6KGo6Lev5b6E5L+d5oyB5penIHB1c2gNCmNvbnN0IGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pID0+IHsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcyk7DQogICAgY29uc3QgdXNlQXR0YWNrQml0cyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlQXR0YWNrQml0cykgJiYgIXVzZU1hc2tzOw0KDQogICAgaWYgKCF1c2VNYXNrcykgew0KICAgICAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICAgICAgaW5mby50aHJlYXQgPSBbXTsNCiAgICAgICAgICAgIGluZm8udGhyZWF0ZW5lZEJ5ID0gW107DQogICAgICAgICAgICBpbmZvLmd1YXJkID0gW107DQogICAgICAgICAgICBpbmZvLmd1YXJkZWRCeSA9IFtdOw0KICAgICAgICAgICAgaW5mby5jb250cm9sID0gW107DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBpZiAoIWJvYXJkSW5mbykgew0KICAgICAgICBib2FyZEluZm8gPSBtYWtlRW1wdHlDb250cm9sbGVyR3JpZCgpOw0KICAgIH0NCg0KICAgIGNsZWFyUGllY2VBdFNxKCk7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICBpZiAoaW5mby5waWVjZUluZGV4ID09IG51bGwpIGluZm8ucGllY2VJbmRleCA9IGk7DQogICAgICAgIHNjcmF0Y2hQaWVjZUF0U3FbaW5mby5yICogOSArIGluZm8uY10gPSBpbmZvOw0KICAgIH0NCg0KICAgIGxldCByZWxDdHggPSBudWxsOw0KICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICByZWxDdHggPSBzY3JhdGNoUmVsQ3R4Ow0KICAgICAgICByZWxDdHgudXNlTWFza3MgPSB0cnVlOw0KICAgICAgICByZWxDdHguc2tpcENvbnRyb2xNYXNrID0gISFib2FyZEluZm8uc2tpcENvbnRyb2xNYXNrOw0KICAgICAgICByZWxDdHguYXR0YWNrTWFzayA9IGJvYXJkSW5mby5hdHRhY2tNYXNrOw0KICAgICAgICByZWxDdHguZ3VhcmRNYXNrID0gYm9hcmRJbmZvLmd1YXJkTWFzazsNCiAgICAgICAgcmVsQ3R4LmNvbnRyb2xNYXNrID0gYm9hcmRJbmZvLmNvbnRyb2xNYXNrOw0KICAgICAgICByZWxDdHgucmVkQXR0YWNrID0gYm9hcmRJbmZvLnJlZEF0dGFjazsNCiAgICAgICAgcmVsQ3R4LmJsYWNrQXR0YWNrID0gYm9hcmRJbmZvLmJsYWNrQXR0YWNrOw0KICAgIH0NCg0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgaWYgKHJlbEN0eCkgcmVsQ3R4LnBpZWNlSW5kZXggPSBpbmZvLnBpZWNlSW5kZXg7DQoNCiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gJ2Nhbm5vbicpIHsNCiAgICAgICAgICAgIGZpbGxDYW5ub25SZWxhdGlvbnMoYm9hcmQsIGluZm8sIHNjcmF0Y2hQaWVjZUF0U3EsIHJlbEN0eCk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBmaWxsTm9uQ2Fubm9uUmVsYXRpb25zKGJvYXJkLCBpbmZvLCBzY3JhdGNoUGllY2VBdFNxLCByZWxDdHgpOw0KICAgICAgICB9DQoNCiAgICAgICAgaWYgKCF1c2VNYXNrcykgew0KICAgICAgICAgICAgY29uc3QgY29udHJvbCA9IGluZm8uY29udHJvbDsNCiAgICAgICAgICAgIGlmICh1c2VBdHRhY2tCaXRzKSB7DQogICAgICAgICAgICAgICAgY29uc3QgYml0cyA9IGluZm8ucGllY2UuY29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZEF0dGFjayA6IGJvYXJkSW5mby5ibGFja0F0dGFjazsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBrID0gMDsgayA8IGNvbnRyb2wubGVuZ3RoOyBrKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zID0gY29udHJvbFtrXTsNCiAgICAgICAgICAgICAgICAgICAgc2V0QXR0YWNrQml0KGJpdHMsIHBvcy5yICogOSArIHBvcy5jKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoYm9hcmRJbmZvWzBdKSkgew0KICAgICAgICAgICAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgY29udHJvbC5sZW5ndGg7IGsrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3MgPSBjb250cm9sW2tdOw0KICAgICAgICAgICAgICAgICAgICBib2FyZEluZm9bcG9zLnJdW3Bvcy5jXS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGxldCByZWRJc0luQ2hlY2sgPSBmYWxzZTsNCiAgICBsZXQgYmxhY2tJc0luQ2hlY2sgPSBmYWxzZTsNCiAgICBsZXQgcmVkR2VuZXJhbEluZm8gPSBudWxsOw0KICAgIGxldCBibGFja0dlbmVyYWxJbmZvID0gbnVsbDsNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoaW5mby5waWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJykgcmVkR2VuZXJhbEluZm8gPSBpbmZvOw0KICAgICAgICAgICAgZWxzZSBibGFja0dlbmVyYWxJbmZvID0gaW5mbzsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICBpZiAocmVkR2VuZXJhbEluZm8gJiYgYm9hcmRJbmZvLmF0dGFja01hc2tbcmVkR2VuZXJhbEluZm8uciAqIDkgKyByZWRHZW5lcmFsSW5mby5jXSAhPT0gMCkgew0KICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoYmxhY2tHZW5lcmFsSW5mbyAmJiBib2FyZEluZm8uYXR0YWNrTWFza1tibGFja0dlbmVyYWxJbmZvLnIgKiA5ICsgYmxhY2tHZW5lcmFsSW5mby5jXSAhPT0gMCkgew0KICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgaWYgKHJlZEdlbmVyYWxJbmZvKSB7DQogICAgICAgICAgICBmb3IgKGNvbnN0IHRocmVhdGVuZXIgb2YgcmVkR2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7DQogICAgICAgICAgICAgICAgaWYgKHRocmVhdGVuZXIucGllY2UuY29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmIChibGFja0dlbmVyYWxJbmZvKSB7DQogICAgICAgICAgICBmb3IgKGNvbnN0IHRocmVhdGVuZXIgb2YgYmxhY2tHZW5lcmFsSW5mby50aHJlYXRlbmVkQnkpIHsNCiAgICAgICAgICAgICAgICBpZiAodGhyZWF0ZW5lci5waWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBpZiAocmVkR2VuZXJhbEluZm8gJiYgYmxhY2tHZW5lcmFsSW5mbyAmJiByZWRHZW5lcmFsSW5mby5jID09PSBibGFja0dlbmVyYWxJbmZvLmMpIHsNCiAgICAgICAgbGV0IGhhc1BpZWNlQmV0d2VlbiA9IGZhbHNlOw0KICAgICAgICBjb25zdCBzdGFydFIgPSBNYXRoLm1pbihyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpICsgMTsNCiAgICAgICAgY29uc3QgZW5kUiA9IE1hdGgubWF4KHJlZEdlbmVyYWxJbmZvLnIsIGJsYWNrR2VuZXJhbEluZm8ucikgLSAxOw0KICAgICAgICBmb3IgKGxldCByID0gc3RhcnRSOyByIDw9IGVuZFI7IHIrKykgew0KICAgICAgICAgICAgaWYgKGJvYXJkW3JdW3JlZEdlbmVyYWxJbmZvLmNdKSB7DQogICAgICAgICAgICAgICAgaGFzUGllY2VCZXR3ZWVuID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoIWhhc1BpZWNlQmV0d2Vlbikgew0KICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgIGJsYWNrSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGJvYXJkSW5mby5yZWRJc0luQ2hlY2sgPSByZWRJc0luQ2hlY2s7DQogICAgYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrID0gYmxhY2tJc0luQ2hlY2s7DQp9Ow0KDQpjb25zdCBpc1Bvc2l0aW9uQWNjZXB0YWJsZSA9IChib2FyZCwgZnJvbSwgdG8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbyA9IG51bGwsIHBpZWNlc0luZm8gPSBudWxsLCB0cnlNb3ZlUGllY2UgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJykgPT4gew0KICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gdHJ5TW92ZVBpZWNlIHx8IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsNCiAgICBjb25zdCB0YXJnZXRQaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOw0KICAgIGNvbnN0IGlzQ2FwdHVyZSA9IHRhcmdldFBpZWNlICYmIHRhcmdldFBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyOw0KDQogICAgLy8g5pS26ZuG5omA5pyJ5qOL5a2Q5L+h5oGv77yM5Y+q5Zyo5rKh5pyJ5o+Q5L6b5pe26K6h566XDQogICAgbGV0IGxvY2FsUGllY2VzSW5mbyA9IHBpZWNlc0luZm87DQogICAgaWYgKCFsb2NhbFBpZWNlc0luZm8pIHsNCiAgICAgICAgbG9jYWxQaWVjZXNJbmZvID0gW107DQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGFsbHlHdWFyZHMgPSBbXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCB7IHIsIGMgfSwgcGllY2UsIGFsbHlHdWFyZHMpOw0KICAgICAgICAgICAgICAgICAgICBsb2NhbFBpZWNlc0luZm8ucHVzaCh7DQogICAgICAgICAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHIsIGMsIG1vdmVzLCBhbGx5R3VhcmRzLA0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWxWYWx1ZTogZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogW10sDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnk6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eVZhbHVlOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDANCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g6K6h566X5qOL5a2Q5YWz57O75ZKM5o6n5Yi25L+h5oGv77yM5Y+q5Zyo5rKh5pyJ5o+Q5L6b5pe26K6h566XDQogICAgbGV0IGxvY2FsQm9hcmRJbmZvID0gYm9hcmRJbmZvOw0KICAgIGlmICghbG9jYWxCb2FyZEluZm8pIHsNCiAgICAgICAgaWYgKGxvY2FsUGllY2VzSW5mby5sZW5ndGggPD0gMzIpIHsNCiAgICAgICAgICAgIGNsZWFyUmVsYXRpb25NYXNrcygpOw0KICAgICAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOw0KICAgICAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxvY2FsUGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGxvY2FsUGllY2VzSW5mb1tpXS5waWVjZUluZGV4ID0gaTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGxvY2FsQm9hcmRJbmZvID0gew0KICAgICAgICAgICAgICAgIHVzZVJlbGF0aW9uTWFza3M6IHRydWUsDQogICAgICAgICAgICAgICAgdXNlQXR0YWNrQml0czogdHJ1ZSwNCiAgICAgICAgICAgICAgICBhdHRhY2tNYXNrOiBzY3JhdGNoQXR0YWNrTWFzaywNCiAgICAgICAgICAgICAgICBndWFyZE1hc2s6IHNjcmF0Y2hHdWFyZE1hc2ssDQogICAgICAgICAgICAgICAgY29udHJvbE1hc2s6IHNjcmF0Y2hDb250cm9sTWFzaywNCiAgICAgICAgICAgICAgICByZWRBdHRhY2s6IHNjcmF0Y2hSZWRBdHRhY2ssDQogICAgICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICAgICAgfTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGxvY2FsQm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsNCiAgICAgICAgfQ0KICAgICAgICBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyhib2FyZCwgbG9jYWxQaWVjZXNJbmZvLCBsb2NhbEJvYXJkSW5mbyk7DQogICAgfQ0KDQogICAgLy8g5o6n5Yi26ICF77yabWFzayDnlKggY29udHJvbE1hc2vvvJvml6fot6/lvoTnlKggYm9hcmRJbmZvW3JdW2Nd77ybaHlkcmF0ZSDlkI7lj6/nlKggY29udHJvbGxlckdyaWQNCiAgICBsZXQgY29udHJvbGxlcnM7DQogICAgaWYgKGxvY2FsQm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpIHsNCiAgICAgICAgY29udHJvbGxlcnMgPSBbXTsNCiAgICAgICAgZm9yRWFjaFNldEJpdChsb2NhbEJvYXJkSW5mby5jb250cm9sTWFza1t0by5yICogOSArIHRvLmNdLCAoaSkgPT4gew0KICAgICAgICAgICAgY29udHJvbGxlcnMucHVzaChsb2NhbFBpZWNlc0luZm9baV0pOw0KICAgICAgICB9KTsNCiAgICB9IGVsc2UgaWYgKGxvY2FsQm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkKSB7DQogICAgICAgIGNvbnRyb2xsZXJzID0gbG9jYWxCb2FyZEluZm8uY29udHJvbGxlckdyaWRbdG8ucl1bdG8uY10gfHwgW107DQogICAgfSBlbHNlIHsNCiAgICAgICAgY29udHJvbGxlcnMgPSBsb2NhbEJvYXJkSW5mb1t0by5yXVt0by5jXSB8fCBbXTsNCiAgICB9DQogICAgbGV0IGhhc0FsbHlDb250cm9sbGVyID0gZmFsc2U7DQogICAgbGV0IGhhc0VuZW15Q29udHJvbGxlciA9IGZhbHNlOw0KDQogICAgLy8g5o6n5Yi26ICF5Y+v6IO95pivIHBpZWNlc0luZm8g5byV55SoIHtwaWVjZSxyLGN9IOaIluaXp+e7k+aehCB7Y29sb3IsdHlwZSxyLGN9DQogICAgY29uc3QgY29udHJvbGxlckNvbG9yID0gKGNvbnRyb2xsZXIpID0+DQogICAgICAgIGNvbnRyb2xsZXIucGllY2UgPyBjb250cm9sbGVyLnBpZWNlLmNvbG9yIDogY29udHJvbGxlci5jb2xvcjsNCg0KICAgIGZvciAoY29uc3QgY29udHJvbGxlciBvZiBjb250cm9sbGVycykgew0KICAgICAgICAvLyDmjpLpmaTmraPlnKjnp7vliqjnmoTmo4vlrZDmnKzouqvvvIjotbDlkI7lroPkuI3lho3ku47ljp/kvY3mjqfliLbnm67moIfvvIkNCiAgICAgICAgaWYgKG1vdmluZ1BpZWNlICYmIGNvbnRyb2xsZXIuciA9PT0gZnJvbS5yICYmIGNvbnRyb2xsZXIuYyA9PT0gZnJvbS5jKSB7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoY29udHJvbGxlckNvbG9yKGNvbnRyb2xsZXIpID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICBoYXNBbGx5Q29udHJvbGxlciA9IHRydWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBoYXNFbmVteUNvbnRyb2xsZXIgPSB0cnVlOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgaWYgKGlzQ2FwdHVyZSkgew0KICAgICAgICAvLyDnmb3lkIPvvJrnm67moIfmnKrooqvmlYzmlrnkv53miqQNCiAgICAgICAgaWYgKCFoYXNFbmVteUNvbnRyb2xsZXIpIHsNCiAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgICAgIC8vIOeugOWNlSBTRUXvvJrlhYjlvpfnm67moIfliIbvvIzoi6XkvJrooqvlj43lkIPliJnlho3lpLHlt7Hmlrnmo4vlrZANCiAgICAgICAgY29uc3QgdGFyZ2V0VmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHRhcmdldFBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCBvdXJWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUobW92aW5nUGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgIGxldCBzZWUgPSB0YXJnZXRWYWx1ZSAtIG91clZhbHVlOw0KICAgICAgICAvLyDoi6XmnInlt7Hmlrnnu6fnu63kv53miqTvvIznspfnlaXorqTkuLrlj6/og73lho3lkIPlm57mnIDkvY7ku7flgLznmoTmlYzmlrnkv53miqTogIUNCiAgICAgICAgaWYgKGhhc0FsbHlDb250cm9sbGVyKSB7DQogICAgICAgICAgICBjb25zdCBlbmVteUd1YXJkVmFsdWVzID0gY29udHJvbGxlcnMNCiAgICAgICAgICAgICAgICAuZmlsdGVyKGMgPT4gY29udHJvbGxlckNvbG9yKGMpICE9PSBjdXJyZW50UGxheWVyICYmICEoYy5yID09PSBmcm9tLnIgJiYgYy5jID09PSBmcm9tLmMpKQ0KICAgICAgICAgICAgICAgIC5tYXAoYyA9PiB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtjLnJdW2MuY107DQogICAgICAgICAgICAgICAgICAgIHJldHVybiBwID8gZ2V0TWF0ZXJpYWxWYWx1ZShwLCBnYW1lU3RhZ2UpIDogMDsNCiAgICAgICAgICAgICAgICB9KQ0KICAgICAgICAgICAgICAgIC5maWx0ZXIodiA9PiB2ID4gMCkNCiAgICAgICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gYSAtIGIpOw0KICAgICAgICAgICAgaWYgKGVuZW15R3VhcmRWYWx1ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgIHNlZSArPSBlbmVteUd1YXJkVmFsdWVzWzBdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIC8vIOaYjuaYvuS6j+aNou+8iOWmgui9puaNouaXoOagueWFteS4lOS8muiiq+WPjeWQg++8ieWImei/h+a7pO+8m+W5s+aNoi/otZrmjaLnlZnnu5nmkJzntKINCiAgICAgICAgcmV0dXJuIHNlZSA+PSAwOw0KICAgIH0NCg0KICAgIC8vIOmdnuWQg+WtkO+8muebruagh+S7heiiq+aVjOaWueaOp+WItuWImeinhuS4uumAgeWQgw0KICAgIGlmIChjb250cm9sbGVycy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHRydWU7DQogICAgfQ0KICAgIHJldHVybiAhaGFzRW5lbXlDb250cm9sbGVyIHx8IGhhc0FsbHlDb250cm9sbGVyOw0KfTsNCg0KLy8gU0VFIOaOkuW6j+WkjeeUqOe8k+WGsu+8jOmZjeS9juWPtuivhOS8sCBHQw0KY29uc3Qgc2VlQXR0YWNrZXJTY3JhdGNoID0gW107DQpjb25zdCBzZWVHdWFyZFNjcmF0Y2ggPSBbXTsNCmNvbnN0IHNlZUF0dGFja2VyVHlwZUNvdW50cyA9IG5ldyBVaW50OEFycmF5KDgpOw0KY29uc3Qgc2VlR3VhcmRUeXBlQ291bnRzID0gbmV3IFVpbnQ4QXJyYXkoOCk7DQpjb25zdCBzZWVNYXRlcmlhbEJ5VHlwZSA9IG5ldyBJbnQzMkFycmF5KDgpOw0KDQpjb25zdCB0YWtlTG93ZXN0U2VlTWF0ZXJpYWwgPSAoY291bnRzLCBtYXRlcmlhbEJ5VHlwZSkgPT4gew0KICAgIGxldCBiZXN0VHlwZSA9IDA7DQogICAgbGV0IGJlc3RWYWx1ZSA9IEluZmluaXR5Ow0KICAgIGZvciAobGV0IHR5cGUgPSAxOyB0eXBlIDwgY291bnRzLmxlbmd0aDsgdHlwZSsrKSB7DQogICAgICAgIGlmIChjb3VudHNbdHlwZV0gIT09IDAgJiYgbWF0ZXJpYWxCeVR5cGVbdHlwZV0gPCBiZXN0VmFsdWUpIHsNCiAgICAgICAgICAgIGJlc3RUeXBlID0gdHlwZTsNCiAgICAgICAgICAgIGJlc3RWYWx1ZSA9IG1hdGVyaWFsQnlUeXBlW3R5cGVdOw0KICAgICAgICB9DQogICAgfQ0KICAgIGlmIChiZXN0VHlwZSAhPT0gMCkgY291bnRzW2Jlc3RUeXBlXS0tOw0KICAgIHJldHVybiBiZXN0VmFsdWU7DQp9Ow0KDQpjb25zdCBoYXNBbnlTZWVNYXRlcmlhbCA9IChjb3VudHMpID0+IHsNCiAgICBmb3IgKGxldCB0eXBlID0gMTsgdHlwZSA8IGNvdW50cy5sZW5ndGg7IHR5cGUrKykgew0KICAgICAgICBpZiAoY291bnRzW3R5cGVdICE9PSAwKSByZXR1cm4gdHJ1ZTsNCiAgICB9DQogICAgcmV0dXJuIGZhbHNlOw0KfTsNCg0KLy8g5pyJ5qC55a2Q566A5YyWIFNFRe+8iOS4juaXp+WunueOsOmAkOihjOetieS7t++8ie+8m+avj+S4quebruagh+WPquW6lOiwg+eUqOS4gOasoQ0KY29uc3QgY2FsY3VsYXRlU3RhdGljRXhjaGFuZ2VTY29yZSA9ICh0aHJlYXRlbmVkUGllY2UpID0+IHsNCiAgICBjb25zdCBhdHRhY2tlcnMgPSBzZWVBdHRhY2tlclNjcmF0Y2g7DQogICAgY29uc3QgZ3VhcmRzID0gc2VlR3VhcmRTY3JhdGNoOw0KICAgIGF0dGFja2Vycy5sZW5ndGggPSAwOw0KICAgIGd1YXJkcy5sZW5ndGggPSAwOw0KICAgIGNvbnN0IHJhd0F0dGFja2VycyA9IHRocmVhdGVuZWRQaWVjZS50aHJlYXRlbmVkQnk7DQogICAgY29uc3QgcmF3R3VhcmRzID0gdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJhd0F0dGFja2Vycy5sZW5ndGg7IGkrKykgYXR0YWNrZXJzLnB1c2gocmF3QXR0YWNrZXJzW2ldKTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJhd0d1YXJkcy5sZW5ndGg7IGkrKykgZ3VhcmRzLnB1c2gocmF3R3VhcmRzW2ldKTsNCiAgICBhdHRhY2tlcnMuc29ydCgoYSwgYikgPT4gYS5tYXRlcmlhbFZhbHVlIC0gYi5tYXRlcmlhbFZhbHVlKTsNCiAgICBndWFyZHMuc29ydCgoYSwgYikgPT4gYS5tYXRlcmlhbFZhbHVlIC0gYi5tYXRlcmlhbFZhbHVlKTsNCg0KICAgIGxldCBleGNoYW5nZVNjb3JlID0gMDsNCiAgICBsZXQgYXR0YWNrZXJJbmRleCA9IDA7DQogICAgbGV0IGd1YXJkSW5kZXggPSAwOw0KICAgIGNvbnN0IHRhcmdldFZhbHVlID0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7DQoNCiAgICB3aGlsZSAoYXR0YWNrZXJJbmRleCA8IGF0dGFja2Vycy5sZW5ndGggJiYgZ3VhcmRJbmRleCA8IGd1YXJkcy5sZW5ndGgpIHsNCiAgICAgICAgaWYgKGd1YXJkSW5kZXggPT09IDApIHsNCiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gdGFyZ2V0VmFsdWU7DQogICAgICAgIH0NCiAgICAgICAgZXhjaGFuZ2VTY29yZSAtPSBhdHRhY2tlcnNbYXR0YWNrZXJJbmRleF0ubWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgaWYgKGF0dGFja2VySW5kZXggKyAxIDwgYXR0YWNrZXJzLmxlbmd0aCkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSBndWFyZHNbZ3VhcmRJbmRleF0ubWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgfQ0KICAgICAgICBhdHRhY2tlckluZGV4Kys7DQogICAgICAgIGd1YXJkSW5kZXgrKzsNCiAgICB9DQogICAgcmV0dXJuIGV4Y2hhbmdlU2NvcmU7DQp9Ow0KDQovLyBtYXNrIOi3r+W+hCBTRUXvvJrmjInmo4vlrZDnsbvliKvorqHmlbDvvIzmjInmnZDmlpnlgLzmtojotLnvvJvkuI7mnZDmlpnmlbDnu4TmjpLluo/or63kuYnkuIDoh7TjgIINCmNvbnN0IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmVGcm9tTWFza3MgPSAodGhyZWF0ZW5lZFBpZWNlLCBwaWVjZXNJbmZvLCBhdHRhY2tNYXNrLCBndWFyZE1hc2spID0+IHsNCiAgICBjb25zdCBhdHRhY2tlckNvdW50cyA9IHNlZUF0dGFja2VyVHlwZUNvdW50czsNCiAgICBjb25zdCBndWFyZENvdW50cyA9IHNlZUd1YXJkVHlwZUNvdW50czsNCiAgICBhdHRhY2tlckNvdW50cy5maWxsKDApOw0KICAgIGd1YXJkQ291bnRzLmZpbGwoMCk7DQogICAgc2VlTWF0ZXJpYWxCeVR5cGUuZmlsbCgwKTsNCiAgICBjb25zdCBzcSA9IHRocmVhdGVuZWRQaWVjZS5zcSA9PSBudWxsDQogICAgICAgID8gdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmMNCiAgICAgICAgOiB0aHJlYXRlbmVkUGllY2Uuc3E7DQogICAgbGV0IGFtID0gYXR0YWNrTWFza1tzcV0gPj4+IDA7DQogICAgd2hpbGUgKGFtICE9PSAwKSB7DQogICAgICAgIGNvbnN0IGJpdCA9IGFtICYgLWFtOw0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV07DQogICAgICAgIGNvbnN0IHR5cGUgPSBpbmZvLnBpZWNlQ29kZSAmIDc7DQogICAgICAgIGF0dGFja2VyQ291bnRzW3R5cGVdKys7DQogICAgICAgIHNlZU1hdGVyaWFsQnlUeXBlW3R5cGVdID0gaW5mby5tYXRlcmlhbFZhbHVlOw0KICAgICAgICBhbSBePSBiaXQ7DQogICAgfQ0KICAgIGxldCBnbSA9IGd1YXJkTWFza1tzcV0gPj4+IDA7DQogICAgd2hpbGUgKGdtICE9PSAwKSB7DQogICAgICAgIGNvbnN0IGJpdCA9IGdtICYgLWdtOw0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV07DQogICAgICAgIGNvbnN0IHR5cGUgPSBpbmZvLnBpZWNlQ29kZSAmIDc7DQogICAgICAgIGd1YXJkQ291bnRzW3R5cGVdKys7DQogICAgICAgIHNlZU1hdGVyaWFsQnlUeXBlW3R5cGVdID0gaW5mby5tYXRlcmlhbFZhbHVlOw0KICAgICAgICBnbSBePSBiaXQ7DQogICAgfQ0KDQogICAgbGV0IGV4Y2hhbmdlU2NvcmUgPSAwOw0KICAgIGxldCBpc0ZpcnN0RXhjaGFuZ2UgPSB0cnVlOw0KICAgIGNvbnN0IHRhcmdldFZhbHVlID0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7DQoNCiAgICB3aGlsZSAodHJ1ZSkgew0KICAgICAgICBjb25zdCBhdHRhY2tlclZhbHVlID0gdGFrZUxvd2VzdFNlZU1hdGVyaWFsKGF0dGFja2VyQ291bnRzLCBzZWVNYXRlcmlhbEJ5VHlwZSk7DQogICAgICAgIGNvbnN0IGd1YXJkVmFsdWUgPSB0YWtlTG93ZXN0U2VlTWF0ZXJpYWwoZ3VhcmRDb3VudHMsIHNlZU1hdGVyaWFsQnlUeXBlKTsNCiAgICAgICAgaWYgKGF0dGFja2VyVmFsdWUgPT09IEluZmluaXR5IHx8IGd1YXJkVmFsdWUgPT09IEluZmluaXR5KSBicmVhazsNCiAgICAgICAgaWYgKGlzRmlyc3RFeGNoYW5nZSkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSB0YXJnZXRWYWx1ZTsNCiAgICAgICAgICAgIGlzRmlyc3RFeGNoYW5nZSA9IGZhbHNlOw0KICAgICAgICB9DQogICAgICAgIGV4Y2hhbmdlU2NvcmUgLT0gYXR0YWNrZXJWYWx1ZTsNCiAgICAgICAgaWYgKGhhc0FueVNlZU1hdGVyaWFsKGF0dGFja2VyQ291bnRzKSkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSBndWFyZFZhbHVlOw0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiBleGNoYW5nZVNjb3JlOw0KfTsNCg0KLy8g6K6h566X5aiB6IOB5YC877yI5Z+65LqO5a6M5pW055qE5aiB6IOB5YWz57O777yJDQovLyDmjInooqvlqIHog4HlrZDogZrlkIjvvJrmr4/kuKrnm67moIfmnIDlpJrkuIDmrKEgU0VF77yb5YiG5YC85Yqg57uZIHRocmVhdGVuZWRCeVswXQ0KLy8g77yI5YWz57O75p6E5bu65oyJIHBpZWNlc0luZm8g6aG65bqPIHB1c2jvvIzmlYXkuI7ml6figJzmlLvlh7vmlrnlpJblsYLpgY3ljobpppbmrKHorqHliIbigJ3lvZLlsZ7kuIDoh7TvvIkNCmNvbnN0IGNhbGN1bGF0ZVRocmVhdFZhbHVlcyA9IChwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyLCBib2FyZEluZm8gPSBudWxsLCBmb3JTZWFyY2hMZWFmID0gZmFsc2UpID0+IHsNCiAgICAvLyDnu5/orqENCiAgICBpZiAoY3VycmVudFBsYXllcikgew0KICAgICAgICBwZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnRbY3VycmVudFBsYXllcl0rKzsNCiAgICB9DQoNCiAgICAvLyDliJ3lp4vljJblqIHog4Hnsbvlnovnu5/orqHkv6Hmga8NCiAgICBjb25zdCBjb2xsZWN0VWkgPSAhIWJvYXJkSW5mbyAmJiAhZm9yU2VhcmNoTGVhZjsNCiAgICBpZiAoY29sbGVjdFVpKSB7DQogICAgICAgIGJvYXJkSW5mby5jaGVja3MgPSBbXTsgICAgICAvLyDlsIblhpvkv6Hmga8NCiAgICAgICAgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMgPSBbXTsgIC8vIOiiq+aNieeahOaji+WtkA0KICAgICAgICBib2FyZEluZm8uY2FuQ2FwdHVyZSA9IFtdOyAgLy8g5Y+v5ZCD55qE5qOL5a2QDQogICAgfQ0KDQogICAgY29uc3QgY2hlY2tCb251cyA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5jaGVjay5ib251czsNCiAgICBjb25zdCBjYW5DYXB0dXJlU2VlbiA9IGNvbGxlY3RVaSA/IG5ldyBTZXQoKSA6IG51bGw7DQogICAgY29uc3QgdXNlTWFza3MgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpOw0KICAgIGNvbnN0IGF0dGFja01hc2sgPSB1c2VNYXNrcyA/IGJvYXJkSW5mby5hdHRhY2tNYXNrIDogbnVsbDsNCiAgICBjb25zdCBndWFyZE1hc2sgPSB1c2VNYXNrcyA/IGJvYXJkSW5mby5ndWFyZE1hc2sgOiBudWxsOw0KDQogICAgZm9yIChsZXQgdGkgPSAwOyB0aSA8IHBpZWNlc0luZm8ubGVuZ3RoOyB0aSsrKSB7DQogICAgICAgIGNvbnN0IHRocmVhdGVuZWRQaWVjZSA9IHBpZWNlc0luZm9bdGldOw0KICAgICAgICBsZXQgZmlyc3RBdHRhY2tlcjsNCiAgICAgICAgbGV0IGhhc0d1YXJkOw0KICAgICAgICBsZXQgYXR0YWNrZXJMaXN0ID0gbnVsbDsNCg0KICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgIGNvbnN0IHNxID0gdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmM7DQogICAgICAgICAgICBjb25zdCBhbSA9IGF0dGFja01hc2tbc3FdOw0KICAgICAgICAgICAgaWYgKGFtID09PSAwKSBjb250aW51ZTsNCiAgICAgICAgICAgIC8vIOacgOS9jiBiaXQgPSBwaWVjZXNJbmZvIOmhuuW6j+S4i+acgOWFiOaMguS4iueahOaUu+WHu+aWue+8iOS4juaXpyB0aHJlYXRlbmVkQnlbMF0g5LiA6Ie077yJDQogICAgICAgICAgICBmaXJzdEF0dGFja2VyID0gcGllY2VzSW5mb1tsb3dlc3RTZXRCaXRJbmRleChhbSldOw0KICAgICAgICAgICAgaGFzR3VhcmQgPSBndWFyZE1hc2tbc3FdICE9PSAwOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgY29uc3QgYXR0YWNrZXJzID0gdGhyZWF0ZW5lZFBpZWNlLnRocmVhdGVuZWRCeTsNCiAgICAgICAgICAgIGlmICghYXR0YWNrZXJzIHx8IGF0dGFja2Vycy5sZW5ndGggPT09IDApIGNvbnRpbnVlOw0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlciA9IGF0dGFja2Vyc1swXTsNCiAgICAgICAgICAgIGhhc0d1YXJkID0gdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeSAmJiB0aHJlYXRlbmVkUGllY2UuZ3VhcmRlZEJ5Lmxlbmd0aCA+IDA7DQogICAgICAgICAgICBhdHRhY2tlckxpc3QgPSBhdHRhY2tlcnM7DQogICAgICAgIH0NCg0KICAgICAgICAvLyDlsIblhpvvvJrlj6rnu5nlsI/pop3lhYjmiYvliIbvvIznu53kuI3mjInlsIYv5biF5p2Q5paZ5YC85YGaIFNFRQ0KICAgICAgICBpZiAodGhyZWF0ZW5lZFBpZWNlLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkdFTkVSQUwpIHsNCiAgICAgICAgICAgIGlmIChjb2xsZWN0VWkpIHsNCiAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgbGV0IG0gPSBhdHRhY2tNYXNrW3RocmVhdGVuZWRQaWVjZS5yICogOSArIHRocmVhdGVuZWRQaWVjZS5jXSA+Pj4gMDsNCiAgICAgICAgICAgICAgICAgICAgd2hpbGUgKG0gIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJpdCA9IG0gJiAtbTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7DQogICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2hlY2tzLnB1c2goew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja2VyOiBwaWVjZXNJbmZvW2FpXSwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHRocmVhdGVuZWRQaWVjZSwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0NoZWNrOiB0cnVlDQogICAgICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIG0gXj0gYml0Ow0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgYWkgPSAwOyBhaSA8IGF0dGFja2VyTGlzdC5sZW5ndGg7IGFpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jaGVja3MucHVzaCh7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrZXI6IGF0dGFja2VyTGlzdFthaV0sDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiB0aHJlYXRlbmVkUGllY2UsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNDaGVjazogdHJ1ZQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IGNoZWNrQm9udXM7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KDQogICAgICAgIC8vIOWPquaKiuWvueaUu+WHu+aWueacieWIqeeahOWogeiDgeiuoeWFpSB0aHJlYXRWYWx1Ze+8iOWNleWQkeiuoeWFpe+8jOS4jeWBmiBzYWZldHkg5a+556ew5omj5YiG77yJDQogICAgICAgIGlmICghaGFzR3VhcmQpIHsNCiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICBpZiAoY29sbGVjdFVpKSB7DQogICAgICAgICAgICAgICAgaWYgKGZpcnN0QXR0YWNrZXIucGllY2UuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBsZXQgbSA9IGF0dGFja01hc2tbdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmNdID4+PiAwOw0KICAgICAgICAgICAgICAgICAgICAgICAgd2hpbGUgKG0gIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiaXQgPSBtICYgLW07DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9bMzEgLSBNYXRoLmNsejMyKGJpdCldOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghY2FuQ2FwdHVyZVNlZW4uaGFzKGluZm8pKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbkNhcHR1cmVTZWVuLmFkZChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbSBePSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBhaSA9IDA7IGFpIDwgYXR0YWNrZXJMaXN0Lmxlbmd0aDsgYWkrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBhdHRhY2tlckxpc3RbYWldOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghY2FuQ2FwdHVyZVNlZW4uaGFzKGluZm8pKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbkNhcHR1cmVTZWVuLmFkZChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5wdXNoKHRocmVhdGVuZWRQaWVjZSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgY29uc3Qgc3NlU2NvcmUgPSB1c2VNYXNrcw0KICAgICAgICAgICAgICAgID8gY2FsY3VsYXRlU3RhdGljRXhjaGFuZ2VTY29yZUZyb21NYXNrcyh0aHJlYXRlbmVkUGllY2UsIHBpZWNlc0luZm8sIGF0dGFja01hc2ssIGd1YXJkTWFzaykNCiAgICAgICAgICAgICAgICA6IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmUodGhyZWF0ZW5lZFBpZWNlKTsNCiAgICAgICAgICAgIGlmIChzc2VTY29yZSA+IDApIHsNCiAgICAgICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IHNzZVNjb3JlICogMC41Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KLy8gU2VhcmNoIGxlYXZlcyBuZXZlciBjb25zdHJ1Y3QgVUkgcmVsYXRpb24gbGlzdHMuIFRoaXMgcGF0aCBjb25zdW1lcyBvbmx5DQovLyBwaWVjZUNvZGUvc3EgYW5kIHRoZSBtYXNrcyBlbWl0dGVkIGJ5IHRoZSBudW1lcmljIHJlbGF0aW9uIGJ1aWxkZXIuDQpjb25zdCBjYWxjdWxhdGVOdW1lcmljU2VhcmNoTGVhZlRocmVhdFZhbHVlcyA9IChwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyKSA9PiB7DQogICAgaWYgKGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgcGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQogICAgfQ0KDQogICAgY29uc3QgY2hlY2tCb251cyA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5jaGVjay5ib251czsNCiAgICBmb3IgKGxldCB0aSA9IDA7IHRpIDwgcGllY2VzSW5mby5sZW5ndGg7IHRpKyspIHsNCiAgICAgICAgY29uc3QgdGhyZWF0ZW5lZFBpZWNlID0gcGllY2VzSW5mb1t0aV07DQogICAgICAgIGNvbnN0IHNxID0gdGhyZWF0ZW5lZFBpZWNlLnNxOw0KICAgICAgICBjb25zdCBhdHRhY2tlcnMgPSBzY3JhdGNoQXR0YWNrTWFza1tzcV07DQogICAgICAgIGlmIChhdHRhY2tlcnMgPT09IDApIGNvbnRpbnVlOw0KDQogICAgICAgIGNvbnN0IGZpcnN0QXR0YWNrZXIgPSBwaWVjZXNJbmZvW2xvd2VzdFNldEJpdEluZGV4KGF0dGFja2VycyldOw0KICAgICAgICBpZiAoKHRocmVhdGVuZWRQaWVjZS5waWVjZUNvZGUgJiA3KSA9PT0gMSkgew0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSBjaGVja0JvbnVzOw0KICAgICAgICB9IGVsc2UgaWYgKHNjcmF0Y2hHdWFyZE1hc2tbc3FdID09PSAwKSB7DQogICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IHRocmVhdGVuZWRQaWVjZS5tYXRlcmlhbFZhbHVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgY29uc3Qgc3NlU2NvcmUgPSBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlRnJvbU1hc2tzKA0KICAgICAgICAgICAgICAgIHRocmVhdGVuZWRQaWVjZSwgcGllY2VzSW5mbywgc2NyYXRjaEF0dGFja01hc2ssIHNjcmF0Y2hHdWFyZE1hc2sNCiAgICAgICAgICAgICk7DQogICAgICAgICAgICBpZiAoc3NlU2NvcmUgPiAwKSB7DQogICAgICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSBzc2VTY29yZSAqIDAuNTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCn07DQoNCi8vIOiuoeeul+WuieWFqOWAvO+8muWwhuepuuaOp+mCu+agvOaYr+WQpuiiq+aVjOaOp++8iOaXoCB2aXNpdCDlm57osIPvvIkNCmNvbnN0IGNhbGN1bGF0ZVNhZmV0eVZhbHVlcyA9IChwaWVjZXNJbmZvLCBib2FyZEluZm8sIGJvYXJkID0gbnVsbCwgZm9yU2VhcmNoTGVhZiA9IGZhbHNlKSA9PiB7DQogICAgaWYgKGZvclNlYXJjaExlYWYgJiYgYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VBdHRhY2tCaXRzICYmIGJvYXJkKSB7DQogICAgICAgIGZvciAobGV0IGdpID0gMDsgZ2kgPCBwaWVjZXNJbmZvLmxlbmd0aDsgZ2krKykgew0KICAgICAgICAgICAgY29uc3QgZ2VuZXJhbCA9IHBpZWNlc0luZm9bZ2ldOw0KICAgICAgICAgICAgaWYgKGdlbmVyYWwucGllY2UudHlwZSAhPT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgY29udGludWU7DQoNCiAgICAgICAgICAgIGNvbnN0IGdlbmVyYWxDb2xvciA9IGdlbmVyYWwucGllY2UuY29sb3I7DQogICAgICAgICAgICBjb25zdCBlbmVteUJpdHMgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLmJsYWNrQXR0YWNrIDogYm9hcmRJbmZvLnJlZEF0dGFjazsNCiAgICAgICAgICAgIGNvbnN0IGlzUmVkID0gZ2VuZXJhbENvbG9yID09PSAncmVkJzsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gZ2VuZXJhbDsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgT1JUSF9ESVJTW2ldWzBdOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5jID0gYyArIE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgICAgICAgICBpZiAobmMgPCAzIHx8IG5jID4gNSkgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKGlzUmVkID8gKG5yIDwgMCB8fCBuciA+IDIpIDogKG5yIDwgNyB8fCBuciA+IDkpKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCAmJiBoYXNBdHRhY2tCaXQoZW5lbXlCaXRzLCBuciAqIDkgKyBuYykpIHsNCiAgICAgICAgICAgICAgICAgICAgZ2VuZXJhbC5zYWZldHlWYWx1ZSAtPSA1MDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuOw0KICAgIH0NCg0KICAgIGNvbnN0IGdlbmVyYWxJbmZvID0gW107DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGlmIChwaWVjZXNJbmZvW2ldLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkdFTkVSQUwpIHsNCiAgICAgICAgICAgIGdlbmVyYWxJbmZvLnB1c2gocGllY2VzSW5mb1tpXSk7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VBdHRhY2tCaXRzKTsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcyk7DQoNCiAgICBmb3IgKGxldCBnaSA9IDA7IGdpIDwgZ2VuZXJhbEluZm8ubGVuZ3RoOyBnaSsrKSB7DQogICAgICAgIGNvbnN0IGdlbmVyYWwgPSBnZW5lcmFsSW5mb1tnaV07DQogICAgICAgIGNvbnN0IGdlbmVyYWxDb2xvciA9IGdlbmVyYWwucGllY2UuY29sb3I7DQogICAgICAgIGNvbnN0IGVuZW15Q29sb3IgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBjb25zdCBlbmVteUJpdHMgPSB1c2VBdHRhY2tCaXRzDQogICAgICAgICAgICA/IChlbmVteUNvbG9yID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRBdHRhY2sgOiBib2FyZEluZm8uYmxhY2tBdHRhY2spDQogICAgICAgICAgICA6IG51bGw7DQogICAgICAgIGNvbnN0IGlzUmVkID0gZ2VuZXJhbENvbG9yID09PSAncmVkJzsNCiAgICAgICAgY29uc3QgeyByLCBjIH0gPSBnZW5lcmFsOw0KDQogICAgICAgIGNvbnN0IHBlbmFsaXplSWZFbmVteSA9IChuciwgbmMpID0+IHsNCiAgICAgICAgICAgIGxldCBoYXNFbmVteUNvbnRyb2w7DQogICAgICAgICAgICBpZiAodXNlQXR0YWNrQml0cykgew0KICAgICAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbCA9IGhhc0F0dGFja0JpdChlbmVteUJpdHMsIG5yICogOSArIG5jKTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc3QgcG9zaXRpb25Db250cm9sbGVycyA9IGJvYXJkSW5mb1tucl1bbmNdOw0KICAgICAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbCA9IGZhbHNlOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IGNpID0gMDsgY2kgPCBwb3NpdGlvbkNvbnRyb2xsZXJzLmxlbmd0aDsgY2krKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sbGVyID0gcG9zaXRpb25Db250cm9sbGVyc1tjaV07DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gY29udHJvbGxlci5waWVjZSA/IGNvbnRyb2xsZXIucGllY2UuY29sb3IgOiBjb250cm9sbGVyLmNvbG9yOw0KICAgICAgICAgICAgICAgICAgICBpZiAoY29sb3IgPT09IGVuZW15Q29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbCA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmIChoYXNFbmVteUNvbnRyb2wpIGdlbmVyYWwuc2FmZXR5VmFsdWUgLT0gNTA7DQogICAgICAgIH07DQoNCiAgICAgICAgaWYgKCh1c2VNYXNrcyAmJiBib2FyZCkgfHwgKCghZ2VuZXJhbC5jb250cm9sIHx8IGdlbmVyYWwuY29udHJvbC5sZW5ndGggPT09IDApICYmIGJvYXJkKSkgew0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBPUlRIX0RJUlNbaV1bMF07DQogICAgICAgICAgICAgICAgY29uc3QgbmMgPSBjICsgT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKG5yIDwgMCB8fCBuciA+IDIpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAobnIgPCA3IHx8IG5yID4gOSkgew0KICAgICAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIHBlbmFsaXplSWZFbmVteShuciwgbmMpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKGdlbmVyYWwuY29udHJvbCAmJiBnZW5lcmFsLmNvbnRyb2wubGVuZ3RoKSB7DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGdlbmVyYWwuY29udHJvbC5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIHBlbmFsaXplSWZFbmVteShnZW5lcmFsLmNvbnRyb2xbaV0uciwgZ2VuZXJhbC5jb250cm9sW2ldLmMpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KY29uc3QgY2FsY3VsYXRlTnVtZXJpY1NlYXJjaExlYWZTYWZldHlWYWx1ZXMgPSAocGllY2VzSW5mbywgc3F1YXJlQ29kZXMpID0+IHsNCiAgICBmb3IgKGxldCBnaSA9IDA7IGdpIDwgcGllY2VzSW5mby5sZW5ndGg7IGdpKyspIHsNCiAgICAgICAgY29uc3QgZ2VuZXJhbCA9IHBpZWNlc0luZm9bZ2ldOw0KICAgICAgICBpZiAoKGdlbmVyYWwucGllY2VDb2RlICYgNykgIT09IDEpIGNvbnRpbnVlOw0KDQogICAgICAgIGNvbnN0IGlzUmVkID0gZ2VuZXJhbC5waWVjZUNvZGUgPCA4Ow0KICAgICAgICBjb25zdCBlbmVteUJpdHMgPSBpc1JlZCA/IHNjcmF0Y2hCbGFja0F0dGFjayA6IHNjcmF0Y2hSZWRBdHRhY2s7DQogICAgICAgIGNvbnN0IGRlc3RpbmF0aW9ucyA9IFNFQVJDSF9HRU5FUkFMX0RFU1RbaXNSZWQgPyAwIDogMV1bZ2VuZXJhbC5zcV07DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdGluYXRpb25zLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBzcSA9IGRlc3RpbmF0aW9uc1tpXTsNCiAgICAgICAgICAgIGlmIChzcXVhcmVDb2Rlc1tzcV0gPT09IDAgJiYgaGFzQXR0YWNrQml0KGVuZW15Qml0cywgc3EpKSB7DQogICAgICAgICAgICAgICAgZ2VuZXJhbC5zYWZldHlWYWx1ZSAtPSA1MDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCn07DQoNCi8vIC0tLSBUeXBlcyAoSW5saW5lZCB0byBhdm9pZCBpbXBvcnQgaXNzdWVzIGluIFdvcmtlcikgLS0tDQovLyAvLyB0eXBlIENvbG9yIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAncmVkJyB8ICdibGFjayc7DQovLyAvLyB0eXBlIFBpZWNlVHlwZSAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgJ2dlbmVyYWwnIHwgJ2Fkdmlzb3InIHwgJ2VsZXBoYW50JyB8ICdob3JzZScgfCAnY2hhcmlvdCcgfCAnY2Fubm9uJyB8ICdzb2xkaWVyJzsNCi8vIC8vIGludGVyZmFjZSBQaWVjZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gaW50ZXJmYWNlIFBvc2l0aW9uIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQovLyAvLyBpbnRlcmZhY2UgTW92ZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gdHlwZSBCb2FyZCAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgKFBpZWNlIHwgbnVsbClbXVtdOw0KDQovLyAtLS0gT3BlbmluZyBCb29rIFR5cGVzIC0tLQ0KLy8gT3BlbmluZyBCb29rIEVudHJ5IC0gcmVwcmVzZW50cyBwb3NzaWJsZSBtb3ZlcyBmb3IgYSBwb3NpdGlvbg0KLy8gaW50ZXJmYWNlIEJvb2tFbnRyeSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KDQovLyBJbmRpdmlkdWFsIG1vdmUgaW4gb3BlbmluZyBib29rIHdpdGggbWV0YWRhdGENCi8vIGludGVyZmFjZSBCb29rTW92ZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KDQovLyAtLS0gWm9icmlzdCBIYXNoaW5nIGZvciBPcGVuaW5nIEJvb2sgLS0tDQovLyBFYWNoIHBpZWNlIHR5cGUvY29sb3IvcG9zaXRpb24gZ2V0cyBhIHVuaXF1ZSByYW5kb20gNTMtYml0IGludGVnZXINCi8vIFVzZXMgc2VlZGVkIFJORyBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nDQpjbGFzcyBab2JyaXN0SGFzaGVyIHsNCiAgICBoYXNoVGFibGU7ICAvLyBbcm93XVtjb2xdW3BpZWNlSW5kZXhdDQogICAgcGllY2VUb0luZGV4Ow0KDQogICAgY29uc3RydWN0b3IoKSB7DQogICAgICAgIHRoaXMucGllY2VUb0luZGV4ID0gbmV3IE1hcChbDQogICAgICAgICAgICBbJ3JlZC1nZW5lcmFsJywgMF0sIFsncmVkLWFkdmlzb3InLCAxXSwgWydyZWQtZWxlcGhhbnQnLCAyXSwgWydyZWQtaG9yc2UnLCAzXSwNCiAgICAgICAgICAgIFsncmVkLWNoYXJpb3QnLCA0XSwgWydyZWQtY2Fubm9uJywgNV0sIFsncmVkLXNvbGRpZXInLCA2XSwNCiAgICAgICAgICAgIFsnYmxhY2stZ2VuZXJhbCcsIDddLCBbJ2JsYWNrLWFkdmlzb3InLCA4XSwgWydibGFjay1lbGVwaGFudCcsIDldLCBbJ2JsYWNrLWhvcnNlJywgMTBdLA0KICAgICAgICAgICAgWydibGFjay1jaGFyaW90JywgMTFdLCBbJ2JsYWNrLWNhbm5vbicsIDEyXSwgWydibGFjay1zb2xkaWVyJywgMTNdDQogICAgICAgIF0pOw0KICAgICAgICAvLyBJbml0aWFsaXplIHJhbmRvbSBoYXNoIHZhbHVlcyB1c2luZyBzZWVkZWQgUk5HICg1My1iaXQgaW50ZWdlcnMgdG8gYXZvaWQgcHJlY2lzaW9uIGlzc3VlcykNCiAgICAgICAgdGhpcy5oYXNoVGFibGUgPSBbXTsNCiAgICAgICAgY29uc3QgTUFYX1NBRkUgPSAweDFGRkZGRkZGRkZGRkZGOyAvLyAyXjUzIC0gMQ0KICAgICAgICANCiAgICAgICAgLy8gU2ltcGxlIHNlZWRlZCBSTkcgKExDRyAtIExpbmVhciBDb25ncnVlbnRpYWwgR2VuZXJhdG9yKQ0KICAgICAgICBsZXQgc2VlZCA9IDEyMzQ1Njc4OTsgLy8gRml4ZWQgc2VlZCBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nDQogICAgICAgIGNvbnN0IHNlZWRlZFJhbmRvbSA9ICgpID0+IHsNCiAgICAgICAgICAgIHNlZWQgPSAoc2VlZCAqIDExMDM1MTUyNDUgKyAxMjM0NSkgJiAweDdmZmZmZmZmOw0KICAgICAgICAgICAgcmV0dXJuIHNlZWQgLyAweDdmZmZmZmZmOw0KICAgICAgICB9Ow0KDQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl0gPSBbXTsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY10gPSBbXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBwID0gMDsgcCA8IDE0OyBwKyspIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgZGV0ZXJtaW5pc3RpYyA1My1iaXQgaW50ZWdlcg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWx1ZSA9IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSk7DQogICAgICAgICAgICAgICAgICAgIHRoaXMuaGFzaFRhYmxlW3JdW2NdW3BdID0gdmFsdWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgLy8g5Y+26K+E5Lyw57yT5a2Y6ZSu77yaYm9hcmRIYXNoIF4gaW5pdGlhdG9yS2V5IF4gc3RhZ2VLZXkNCiAgICAgICAgdGhpcy5ldmFsSW5pdGlhdG9yS2V5cyA9IHsNCiAgICAgICAgICAgIHJlZDogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwNCiAgICAgICAgICAgIGJsYWNrOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpDQogICAgICAgIH07DQogICAgICAgIHRoaXMuZXZhbFN0YWdlS2V5cyA9IHsNCiAgICAgICAgICAgIGVhcmx5OiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpLA0KICAgICAgICAgICAgbWlkOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpLA0KICAgICAgICAgICAgbGF0ZTogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIHBpZWNlSW5kZXgocGllY2VPcktleSkgew0KICAgICAgICBpZiAocGllY2VPcktleSA9PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkOw0KICAgICAgICBsZXQgY29sb3I7DQogICAgICAgIGxldCB0eXBlOw0KICAgICAgICBpZiAodHlwZW9mIHBpZWNlT3JLZXkgPT09ICdzdHJpbmcnKSB7DQogICAgICAgICAgICBjb25zdCBzZXBhcmF0b3IgPSBwaWVjZU9yS2V5LmluZGV4T2YoJy0nKTsNCiAgICAgICAgICAgIGlmIChzZXBhcmF0b3IgPCAwKSByZXR1cm4gdW5kZWZpbmVkOw0KICAgICAgICAgICAgY29sb3IgPSBwaWVjZU9yS2V5LnNsaWNlKDAsIHNlcGFyYXRvcik7DQogICAgICAgICAgICB0eXBlID0gcGllY2VPcktleS5zbGljZShzZXBhcmF0b3IgKyAxKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGNvbG9yID0gcGllY2VPcktleS5jb2xvcjsNCiAgICAgICAgICAgIHR5cGUgPSBwaWVjZU9yS2V5LnR5cGU7DQogICAgICAgIH0NCiAgICAgICAgbGV0IHR5cGVJbmRleDsNCiAgICAgICAgc3dpdGNoICh0eXBlKSB7DQogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkdFTkVSQUw6IHR5cGVJbmRleCA9IDA7IGJyZWFrOw0KICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5BRFZJU09SOiB0eXBlSW5kZXggPSAxOyBicmVhazsNCiAgICAgICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuRUxFUEhBTlQ6IHR5cGVJbmRleCA9IDI7IGJyZWFrOw0KICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5IT1JTRTogdHlwZUluZGV4ID0gMzsgYnJlYWs7DQogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkNIQVJJT1Q6IHR5cGVJbmRleCA9IDQ7IGJyZWFrOw0KICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5DQU5OT046IHR5cGVJbmRleCA9IDU7IGJyZWFrOw0KICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5TT0xESUVSOiB0eXBlSW5kZXggPSA2OyBicmVhazsNCiAgICAgICAgICAgIGRlZmF1bHQ6IHJldHVybiB1bmRlZmluZWQ7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGNvbG9yID09PSAncmVkJykgcmV0dXJuIHR5cGVJbmRleDsNCiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAnYmxhY2snID8gdHlwZUluZGV4ICsgNyA6IHVuZGVmaW5lZDsNCiAgICB9DQoNCiAgICBldmFsQ2FjaGVLZXkoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKSB7DQogICAgICAgIGNvbnN0IHN0YWdlS2V5ID0gdGhpcy5ldmFsU3RhZ2VLZXlzW2dhbWVTdGFnZV0gfHwgdGhpcy5ldmFsU3RhZ2VLZXlzLm1pZDsNCiAgICAgICAgcmV0dXJuIHRoaXMuaGFzaChib2FyZCkgXiB0aGlzLmV2YWxJbml0aWF0b3JLZXlzW3NlYXJjaEluaXRpYXRvcl0gXiBzdGFnZUtleTsNCiAgICB9DQoNCiAgICBldmFsQ2FjaGVLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKSB7DQogICAgICAgIGNvbnN0IHN0YWdlS2V5ID0gdGhpcy5ldmFsU3RhZ2VLZXlzW2dhbWVTdGFnZV0gfHwgdGhpcy5ldmFsU3RhZ2VLZXlzLm1pZDsNCiAgICAgICAgcmV0dXJuIGJvYXJkSGFzaCBeIHRoaXMuZXZhbEluaXRpYXRvcktleXNbc2VhcmNoSW5pdGlhdG9yXSBeIHN0YWdlS2V5Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIOaVsOWAvCBUVCBrZXnvvJrmiorooYzmo4vmlrnnvJbnoIHov5vmnIDkvY7kvY3vvIzpgb/lhY0gYGhhc2ggXiBzaWRlS2V5YCDlnKggSlMgVG9JbnQzMg0KICAgICAqIOS4i+S6p+eUn+i3qOe6oum7keeisOaSnu+8iOmCo+S8muS9vyBUVCDor6/lkb3kuK3lubbmlLnlj5jmkJzntKLmoJEv5qOL5Yqb77yJ44CCDQogICAgICog562J5Lu35LqO5pen5a2X56ym5LiyIGtleSBgJHtoYXNofToke3NpZGV9YCDnmoTljLrliIbog73lipvjgIINCiAgICAgKi8NCiAgICB0dEtleUZyb21IYXNoKGJvYXJkSGFzaCwgc2lkZSkgew0KICAgICAgICBjb25zdCBoID0gYm9hcmRIYXNoIHwgMDsgLy8gXj0g6ZO+57uT5p6c5bey5pivIEludDMyDQogICAgICAgIHJldHVybiBoICogMiArIChzaWRlID09PSAncmVkJyA/IDAgOiAxKTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDb21wdXRlIGhhc2ggZm9yIGEgYm9hcmQgcG9zaXRpb24NCiAgICAgKi8NCiAgICBoYXNoKGJvYXJkKSB7DQogICAgICAgIGxldCBoID0gMDsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlSWR4ID0gdGhpcy5waWVjZUluZGV4KHBpZWNlKTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGggXj0gdGhpcy5oYXNoVGFibGVbcl1bY11bcGllY2VJZHhdOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBoOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIE1pcnJvciBhIGJvYXJkIGhvcml6b250YWxseSAoZm9yIHN5bW1ldHJ5IGRldGVjdGlvbikNCiAgICAgKi8NCiAgICBtaXJyb3JCb2FyZChib2FyZCkgew0KICAgICAgICBjb25zdCBtaXJyb3JlZCA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpKTsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgIG1pcnJvcmVkW3JdWzggLSBjXSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBtaXJyb3JlZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBNaXJyb3IgYSBtb3ZlIGhvcml6b250YWxseQ0KICAgICAqLw0KICAgIG1pcnJvck1vdmUobW92ZSkgew0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogOCAtIG1vdmUuZnJvbS5jIH0sDQogICAgICAgICAgICB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IDggLSBtb3ZlLnRvLmMgfQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEluY3JlbWVudGFsbHkgdXBkYXRlIGhhc2ggYWZ0ZXIgYSBtb3ZlIChYT1Ig6Ieq6YCG77ya5YaN6LCD55So5LiA5qyh5Y+v6L+Y5Y6fKS4NCiAgICAgKiBtb3ZpbmdQaWVjZSAvIGNhcHR1cmVkUGllY2Ug5Y+v5Li65qOL5a2Q5a+56LGh5oiWICdjb2xvci10eXBlJyDlrZfnrKbkuLLjgIINCiAgICAgKiDpobvlnKggbWFrZU1vdmUg5LmL5YmN5Y+W5b6XIG1vdmluZ1BpZWNl77yMY2FwdHVyZWQg55SoIG1ha2VNb3ZlIOi/lOWbnuWAvOOAgg0KICAgICAqLw0KICAgIHVwZGF0ZUhhc2goY3VycmVudEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgIGxldCBuZXdIYXNoID0gY3VycmVudEhhc2g7DQogICAgICAgIGNvbnN0IG1vdmluZ0lkeCA9IHRoaXMucGllY2VJbmRleChtb3ZpbmdQaWVjZSk7DQogICAgICAgIGlmIChtb3ZpbmdJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgbmV3SGFzaCBePSB0aGlzLmhhc2hUYWJsZVttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdW21vdmluZ0lkeF07DQogICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUudG8ucl1bbW92ZS50by5jXVttb3ZpbmdJZHhdOw0KICAgICAgICB9DQogICAgICAgIGlmIChjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZElkeCA9IHRoaXMucGllY2VJbmRleChjYXB0dXJlZFBpZWNlKTsNCiAgICAgICAgICAgIGlmIChjYXB0dXJlZElkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgbmV3SGFzaCBePSB0aGlzLmhhc2hUYWJsZVttb3ZlLnRvLnJdW21vdmUudG8uY11bY2FwdHVyZWRJZHhdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBuZXdIYXNoOw0KICAgIH0NCn0NCg0KLyoqDQogKiBPcGVuaW5nIEJvb2sgTWFuYWdlcg0KICovDQpjbGFzcyBPcGVuaW5nQm9vayB7DQogICAgYm9vazsgIC8vIFpvYnJpc3QgaGFzaCAtPiBtb3Zlcw0KICAgIGhhc2hlcjsNCiAgICBlbmFibGVkOw0KICAgIG1heFBseTsgIC8vIE1heGltdW0gcGx5IHRvIHVzZSBvcGVuaW5nIGJvb2sgKGUuZy4sIDIwKQ0KDQogICAgY29uc3RydWN0b3IobWF4UGx5ID0gMTIpIHsNCiAgICAgICAgdGhpcy5ib29rID0gbmV3IE1hcCgpOw0KICAgICAgICB0aGlzLmhhc2hlciA9IG5ldyBab2JyaXN0SGFzaGVyKCk7DQogICAgICAgIHRoaXMuZW5hYmxlZCA9IHRydWU7DQogICAgICAgIHRoaXMubWF4UGx5ID0gbWF4UGx5Ow0KICAgICAgICB0aGlzLmluaXRpYWxpemVCb29rKCk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogSW5pdGlhbGl6ZSB3aXRoIGNvbW1vbiBDaGluZXNlIENoZXNzIG9wZW5pbmdzDQogICAgICovDQogICAgaW5pdGlhbGl6ZUJvb2soKSB7DQogICAgICAgIC8vIEFkZCBjbGFzc2ljIENoaW5lc2UgQ2hlc3Mgb3BlbmluZ3MgbWFudWFsbHkNCiAgICAgICAgDQogICAgICAgIC8qDQogICAgICAgIC8vIDEuIOS4reeCrui/h+ays+i9puWvueWxj+mjjumprOW5s+eCruWvuei9piAoQ2VudHJhbCBDYW5ub24gdnMgU2NyZWVuIEhvcnNlcykNCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZShbDQogICAgICAgICAgICB7IGZyb206IHsgcjogNywgYzogNyB9LCB0bzogeyByOiA3LCBjOiA0IH0gfSwgIC8vIDEuIOeCruS6jOW5s+S6lA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDcgfSwgdG86IHsgcjogMiwgYzogNiB9IH0sICAvLyAxLi4uIOmprDjov5s3DQogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogNyB9LCB0bzogeyByOiA3LCBjOiA2IH0gfSwgIC8vIDIuIOmprOS6jOi/m+S4iQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDggfSwgdG86IHsgcjogMCwgYzogNyB9IH0sICAvLyAyLi4uIOi9pjnlubM4ICAgICAgICAgICANCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA4IH0sIHRvOiB7IHI6IDksIGM6IDcgfSB9LCAgLy8gMy4g6L2m5LiA5bmz5LqMDQogICAgICAgICAgICB7IGZyb206IHsgcjogMywgYzogNiB9LCB0bzogeyByOiA0LCBjOiA2IH0gfSwgIC8vIDMuLi4g5Y2SN+i/mzENCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA3IH0sIHRvOiB7IHI6IDMsIGM6IDcgfSB9LCAgLy8gNC4g6L2m5LqM6L+b5YWtDQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogMSB9LCB0bzogeyByOiAyLCBjOiAyIH0gfSwgIC8vIDQuLi4g6amsMui/mzMNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA2LCBjOiAyIH0sIHRvOiB7IHI6IDUsIGM6IDIgfSB9LCAgLy8gNS4g5YW15LiD6L+b5LiADQogICAgICAgICAgICB7IGZyb206IHsgcjogMiwgYzogNyB9LCB0bzogeyByOiAyLCBjOiA4IH0gfSwgIC8vIDUuLi4g54KuOOW5szkNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAzLCBjOiA3IH0sIHRvOiB7IHI6IDMsIGM6IDYgfSB9LCAgLy8gNi4g6L2m5LqM5bmz5LiJDQogICAgICAgICAgICB7IGZyb206IHsgcjogMiwgYzogOCB9LCB0bzogeyByOiAxLCBjOiA4IH0gfSwgIC8vIDYuLi4g54KuOemAgDEgICAgICAgICAgDQogICAgICAgIF0sIFs4NSwgODUsIDk1LCA5MCwgOTAsIDg1LCA4NSwgODAsIDg1LCA4NSwgODUsIDg1XSk7DQoNCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihbDQogICAgICAgICAgICAn54Ku5LqM5bmz5LqUJywgJ+mprDjov5s3JywgJ+mprOS6jOi/m+S4iScsICfovaY55bmzOCcsICfovabkuIDlubPkuownLCAn5Y2SN+i/mzEnLA0KICAgICAgICAgICAgJ+i9puS6jOi/m+WFrScsICfpqawy6L+bMycsICflhbXkuIPov5vkuIAnLCAn54KuOOW5szknLCAn6L2m5LqM5bmz5LiJJywgJ+eCrjnpgIAxJywNCiAgICAgICAgICAgIF0sIFs4NSwgODUsIDk1LCA5MCwgOTAsIDg1LCA4NSwgODAsIDg1LCA4NSwgODUsIDg1XSk7DQoNCiAgICAgICAgICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyhbDQogICAgICAgICAgICAn54Ku5LqM5bmz5LqUIOmprDjov5s3IOmprOS6jOi/m+S4iSDovaY55bmzOCDovabkuIDlubPkuowg5Y2SN+i/mzEg6L2m5LqM6L+b5YWtIOmprDLov5szIOWFteS4g+i/m+S4gCDngq445bmzOSDovabkuozlubPkuIkg54KuOemAgDEnDQogICAgICAgIF0sIFs4NSwgODUsIDk1LCA5MCwgOTAsIDg1LCA4NSwgODAsIDg1LCA4NSwgODUsIDg1XSk7DQogICAgICAgICovDQogICAgfQ0KDQogICAgLyoqDQogICAgICogQWRkIGFuIG9wZW5pbmcgbGluZSB0byB0aGUgYm9vaw0KICAgICAqIEBwYXJhbSBtb3ZlcyBBcnJheSBvZiBtb3ZlcyByZXByZXNlbnRpbmcgYW4gb3BlbmluZyBsaW5lDQogICAgICogQHBhcmFtIHdlaWdodHMgT3B0aW9uYWwgd2VpZ2h0cyBmb3IgZWFjaCBtb3ZlIChkZWZhdWx0IDEwMCBmb3IgYWxsKQ0KICAgICAqLw0KICAgIGFkZE9wZW5pbmdMaW5lKG1vdmVzLCB3ZWlnaHRzKSB7DQogICAgICAgIC8vIFN0YXJ0IHdpdGggaW5pdGlhbCBib2FyZCBwb3NpdGlvbg0KICAgICAgICBjb25zdCBib2FyZCA9IHRoaXMuY3JlYXRlSW5pdGlhbEJvYXJkKCk7DQogICAgICAgIGxldCBjdXJyZW50SGFzaCA9IHRoaXMuaGFzaGVyLmhhc2goYm9hcmQpOw0KDQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW92ZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpXTsNCiAgICAgICAgICAgIGNvbnN0IHdlaWdodCA9IHdlaWdodHM/LltpXSA/PyAxMDA7DQoNCiAgICAgICAgICAgIC8vIEdldCBvciBjcmVhdGUgYm9vayBlbnRyeSBmb3IgdGhpcyBwb3NpdGlvbg0KICAgICAgICAgICAgbGV0IGVudHJ5ID0gdGhpcy5ib29rLmdldChjdXJyZW50SGFzaCk7DQogICAgICAgICAgICBpZiAoIWVudHJ5KSB7DQogICAgICAgICAgICAgICAgZW50cnkgPSB7IG1vdmVzOiBbXSB9Ow0KICAgICAgICAgICAgICAgIHRoaXMuYm9vay5zZXQoY3VycmVudEhhc2gsIGVudHJ5KTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gQWRkIG1vdmUgaWYgbm90IGFscmVhZHkgcHJlc2VudA0KICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdNb3ZlID0gZW50cnkubW92ZXMuZmluZCgNCiAgICAgICAgICAgICAgICBtID0+IG0uZnJvbS5yID09PSBtb3ZlLmZyb20uciAmJiBtLmZyb20uYyA9PT0gbW92ZS5mcm9tLmMgJiYNCiAgICAgICAgICAgICAgICAgICAgIG0udG8uciA9PT0gbW92ZS50by5yICYmIG0udG8uYyA9PT0gbW92ZS50by5jDQogICAgICAgICAgICApOw0KDQogICAgICAgICAgICBpZiAoIWV4aXN0aW5nTW92ZSkgew0KICAgICAgICAgICAgICAgIGVudHJ5Lm1vdmVzLnB1c2goew0KICAgICAgICAgICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiBtb3ZlLmZyb20uYyB9LA0KICAgICAgICAgICAgICAgICAgICB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IG1vdmUudG8uYyB9LA0KICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHdlaWdodA0KICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgd2VpZ2h0IGlmIG1vdmUgYWxyZWFkeSBleGlzdHMgKHRha2UgbWF4aW11bSkNCiAgICAgICAgICAgICAgICBleGlzdGluZ01vdmUud2VpZ2h0ID0gTWF0aC5tYXgoZXhpc3RpbmdNb3ZlLndlaWdodCwgd2VpZ2h0KTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gTWFrZSB0aGUgbW92ZSBvbiB0aGUgYm9hcmQNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkID0gYm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoIXBpZWNlKSBicmVhazsgLy8gSW52YWxpZCBsaW5lDQoNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlS2V5ID0gYCR7cGllY2UuY29sb3J9LSR7cGllY2UudHlwZX1gOw0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBjYXB0dXJlZCA/IGAke2NhcHR1cmVkLmNvbG9yfS0ke2NhcHR1cmVkLnR5cGV9YCA6IHVuZGVmaW5lZDsNCg0KICAgICAgICAgICAgLy8gVXBkYXRlIGhhc2ggaW5jcmVtZW50YWxseQ0KICAgICAgICAgICAgY3VycmVudEhhc2ggPSB0aGlzLmhhc2hlci51cGRhdGVIYXNoKGN1cnJlbnRIYXNoLCBtb3ZlLCBwaWVjZUtleSwgY2FwdHVyZWRLZXkpOw0KDQogICAgICAgICAgICAvLyBBcHBseSBtb3ZlDQogICAgICAgICAgICBib2FyZFttb3ZlLnRvLnJdW21vdmUudG8uY10gPSBwaWVjZTsNCiAgICAgICAgICAgIGJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY10gPSBudWxsOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLyoqDQogICAgICogR2V0IGJlc3QgbW92ZSBmcm9tIG9wZW5pbmcgYm9vayBmb3IgY3VycmVudCBwb3NpdGlvbg0KICAgICAqIEBwYXJhbSBib2FyZCBDdXJyZW50IGJvYXJkIHN0YXRlDQogICAgICogQHBhcmFtIHBseSBDdXJyZW50IHBseSBudW1iZXIgKDAgPSBzdGFydCBvZiBnYW1lKQ0KICAgICAqIEByZXR1cm5zIE1vdmUgZnJvbSBib29rLCBvciBudWxsIGlmIHBvc2l0aW9uIG5vdCBpbiBib29rDQogICAgICovDQogICAgZ2V0Qm9va01vdmUoYm9hcmQsIHBseSl7DQogICAgICAgIC8vIERvbid0IHVzZSBib29rIGlmIGRpc2FibGVkIG9yIHBhc3QgbWF4IHBseQ0KICAgICAgICBpZiAoIXRoaXMuZW5hYmxlZCB8fCBwbHkgPj0gdGhpcy5tYXhQbHkpIHsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgZGlzYWJsZWQgb3IgcGFzdCBtYXggcGx5JywgeyBlbmFibGVkOiB0aGlzLmVuYWJsZWQsIG1heFBseTogdGhpcy5tYXhQbHksIHBseTogcGx5IH0pOw0KICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBnZXRCb29rTW92ZSBjYWxsZWQnLCB7IHBseSB9KTsNCiAgICAgICAgDQogICAgICAgIC8vIFRyeSB0byBmaW5kIG1vdmUgZm9yIGN1cnJlbnQgcG9zaXRpb24NCiAgICAgICAgY29uc3QgaGFzaCA9IHRoaXMuaGFzaGVyLmhhc2goYm9hcmQpOw0KICAgICAgICAvL2NvbnNvbGUubG9nKCdDdXJyZW50IHBvc2l0aW9uIGhhc2g6JywgaGFzaCk7DQogICAgICAgIA0KICAgICAgICBsZXQgZW50cnkgPSB0aGlzLmJvb2suZ2V0KGhhc2gpOw0KICAgICAgICAvL2NvbnNvbGUubG9nKCdFbnRyeSBmb3VuZCBmb3IgY3VycmVudCBoYXNoOicsIGVudHJ5ID8gZW50cnkubW92ZXMubGVuZ3RoICsgJyBtb3ZlcycgOiAnbnVsbCcpOw0KICAgICAgICBpZiAoZW50cnkgJiYgZW50cnkubW92ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgY29uc29sZS5sb2coJ0FsbCBwb3NzaWJsZSBib29rIG1vdmVzIHdpdGggd2VpZ2h0czonLCBKU09OLnN0cmluZ2lmeShlbnRyeS5tb3ZlcykpOw0KICAgICAgICAgICAgLy8gQ2FsY3VsYXRlIHRvdGFsIHdlaWdodA0KICAgICAgICAgICAgY29uc3QgdG90YWxXZWlnaHQgPSBlbnRyeS5tb3Zlcy5yZWR1Y2UoKHN1bSwgbW92ZSkgPT4gc3VtICsgbW92ZS53ZWlnaHQsIDApOw0KICAgICAgICAgICAgY29uc29sZS5sb2coJ1RvdGFsIHdlaWdodDonLCB0b3RhbFdlaWdodCk7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIGxldCBtaXJyb3JlZE1vdmUgPSBmYWxzZTsNCg0KICAgICAgICAvLyBJZiBub3QgZm91bmQsIHRyeSBtaXJyb3JlZCBwb3NpdGlvbg0KICAgICAgICBpZiAoIWVudHJ5IHx8IGVudHJ5Lm1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgY29uc3QgbWlycm9yZWRCb2FyZCA9IHRoaXMuaGFzaGVyLm1pcnJvckJvYXJkKGJvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IG1pcnJvcmVkSGFzaCA9IHRoaXMuaGFzaGVyLmhhc2gobWlycm9yZWRCb2FyZCk7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gZW50cnkgZm91bmQsIHRyeWluZyBtaXJyb3JlZCBwb3NpdGlvbjonLCBtaXJyb3JlZEhhc2gpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBlbnRyeSA9IHRoaXMuYm9vay5nZXQobWlycm9yZWRIYXNoKTsNCiAgICAgICAgICAgIGlmIChlbnRyeSAmJiBlbnRyeS5tb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnRW50cnkgZm91bmQgZm9yIG1pcnJvcmVkIGhhc2g6JywgZW50cnkubW92ZXMubGVuZ3RoICsgJyBtb3ZlcycpOw0KICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ09yaWdpbmFsIG1pcnJvciBtb3ZlczonLCBKU09OLnN0cmluZ2lmeShlbnRyeS5tb3ZlcykpOw0KICAgICAgICAgICAgICAgIG1pcnJvcmVkTW92ZSA9IHRydWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ05vIGVudHJ5IGZvdW5kIGZvciBtaXJyb3JlZCBoYXNoJyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICBpZiAoIWVudHJ5IHx8IGVudHJ5Lm1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnT3BlbmluZyBib29rIG1vdmUgbm90IGZvdW5kIGZvciBjdXJyZW50IHBvc2l0aW9uJyk7DQogICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgfQ0KDQogICAgICAgIC8vIFNlbGVjdCBtb3ZlIGJhc2VkIG9uIHdlaWdodHMNCiAgICAgICAgY29uc3Qgc2VsZWN0ZWRNb3ZlID0gdGhpcy5zZWxlY3RXZWlnaHRlZE1vdmUoZW50cnkubW92ZXMpOw0KICAgICAgICBjb25zb2xlLmxvZygnT3BlbmluZyBib29rIG1vdmUgc2VsZWN0ZWQ6Jywgc2VsZWN0ZWRNb3ZlKTsNCiAgICAgICAgDQogICAgICAgIC8vIElmIHdlIHVzZWQgbWlycm9yZWQgcG9zaXRpb24sIG1pcnJvciB0aGUgbW92ZSBiYWNrDQogICAgICAgIGlmIChzZWxlY3RlZE1vdmUgJiYgbWlycm9yZWRNb3ZlKSB7DQogICAgICAgICAgICAvLyBjb25zb2xlLmxvZygnU2VsZWN0ZWQgbWlycm9yIG1vdmUgYmVmb3JlIGNvbnZlcnNpb246JywgSlNPTi5zdHJpbmdpZnkoc2VsZWN0ZWRNb3ZlKSk7DQogICAgICAgICAgICBjb25zdCBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQgPSB0aGlzLmhhc2hlci5taXJyb3JNb3ZlKHNlbGVjdGVkTW92ZSk7DQogICAgICAgICAgICAvLyBjb25zb2xlLmxvZygnQ29udmVydGVkIG1pcnJvciBtb3ZlOicsIEpTT04uc3RyaW5naWZ5KG1pcnJvcmVkTW92ZUNvbnZlcnRlZCkpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgbWlycm9yZWQgbW92ZSBoYXMgdmFsaWQgc3RydWN0dXJlDQogICAgICAgICAgICBpZiAobWlycm9yZWRNb3ZlQ29udmVydGVkICYmIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tICYmIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50byAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20uYyA9PT0gJ251bWJlcicgJiYNCiAgICAgICAgICAgICAgICB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQudG8uYyA9PT0gJ251bWJlcicpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gbWlycm9yZWRNb3ZlQ29udmVydGVkOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTWlycm9yZWQgbW92ZSBoYXMgaW52YWxpZCBzdHJ1Y3R1cmUsIHJldHVybmluZyBudWxsJyk7DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoc2VsZWN0ZWRNb3ZlKSB7DQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgc2VsZWN0ZWQgbW92ZSBoYXMgdmFsaWQgc3RydWN0dXJlDQogICAgICAgICAgICBpZiAoc2VsZWN0ZWRNb3ZlLmZyb20gJiYgc2VsZWN0ZWRNb3ZlLnRvICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIHNlbGVjdGVkTW92ZS5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBzZWxlY3RlZE1vdmUuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBzZWxlY3RlZE1vdmUudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIHNlbGVjdGVkTW92ZS50by5jID09PSAnbnVtYmVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiBzZWxlY3RlZE1vdmU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZWxlY3RlZCBtb3ZlIGhhcyBpbnZhbGlkIHN0cnVjdHVyZSwgcmV0dXJuaW5nIG51bGwnKTsNCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgcmV0dXJuIG51bGw7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogU2VsZWN0IGEgbW92ZSByYW5kb21seSBiYXNlZCBvbiB3ZWlnaHRzDQogICAgICogSGlnaGVyIHdlaWdodCA9IG1vcmUgbGlrZWx5IHRvIGJlIHNlbGVjdGVkDQogICAgICovDQogICAgc2VsZWN0V2VpZ2h0ZWRNb3ZlKG1vdmVzKSB7DQogICAgICAgIC8vIENhbGN1bGF0ZSB0b3RhbCB3ZWlnaHQNCiAgICAgICAgY29uc3QgdG90YWxXZWlnaHQgPSBtb3Zlcy5yZWR1Y2UoKHN1bSwgbW92ZSkgPT4gc3VtICsgbW92ZS53ZWlnaHQsIDApOw0KDQogICAgICAgIC8vIEdlbmVyYXRlIHJhbmRvbSBudW1iZXINCiAgICAgICAgbGV0IHJhbmRvbSA9IE1hdGgucmFuZG9tKCkgKiB0b3RhbFdlaWdodDsNCg0KICAgICAgICAvLyBTZWxlY3QgbW92ZQ0KICAgICAgICBmb3IgKGNvbnN0IG1vdmUgb2YgbW92ZXMpIHsNCiAgICAgICAgICAgIHJhbmRvbSAtPSBtb3ZlLndlaWdodDsNCiAgICAgICAgICAgIGlmIChyYW5kb20gPD0gMCkgew0KICAgICAgICAgICAgICAgIHJldHVybiB7DQogICAgICAgICAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmUudG8uciwgYzogbW92ZS50by5jIH0NCiAgICAgICAgICAgICAgICB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgLy8gRmFsbGJhY2sgKHNob3VsZCBuZXZlciByZWFjaCBoZXJlKQ0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgZnJvbTogeyByOiBtb3Zlc1swXS5mcm9tLnIsIGM6IG1vdmVzWzBdLmZyb20uYyB9LCB0bzogeyByOiBtb3Zlc1swXS50by5yLCBjOiBtb3Zlc1swXS50by5jIH0NCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBIZWxwZXIgdG8gY3JlYXRlIGluaXRpYWwgYm9hcmQgKG5lZWRlZCBmb3IgYm9vayBpbml0aWFsaXphdGlvbikNCiAgICAgKi8NCiAgICBjcmVhdGVJbml0aWFsQm9hcmQoKSB7DQogICAgICAgIGNvbnN0IGJvYXJkID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkpOw0KICAgICAgICANCiAgICAgICAgLy8gUmVkIHBpZWNlcyAoYm90dG9tIC0gcj0wLTIpDQogICAgICAgIGJvYXJkWzBdWzBdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVsxXSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzJdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bM10gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzRdID0geyB0eXBlOiAnZ2VuZXJhbCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs1XSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bNl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs3XSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzhdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFsyXVsxXSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFsyXVs3XSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVswXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bMl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzRdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVs2XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bOF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQoNCiAgICAgICAgLy8gQmxhY2sgcGllY2VzICh0b3AgLSByPTctOSkNCiAgICAgICAgYm9hcmRbOV1bMF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bMV0gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzJdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVszXSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs0XSA9IHsgdHlwZTogJ2dlbmVyYWwnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs1XSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs2XSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bN10gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzhdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzddWzFdID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbN11bN10gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVswXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVsyXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVs0XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVs2XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVs4XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KDQogICAgICAgIHJldHVybiBib2FyZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBFbmFibGUgb3IgZGlzYWJsZSBvcGVuaW5nIGJvb2sNCiAgICAgKi8NCiAgICBzZXRFbmFibGVkKGVuYWJsZWQpIHsNCiAgICAgICAgdGhpcy5lbmFibGVkID0gZW5hYmxlZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDaGVjayBpZiBvcGVuaW5nIGJvb2sgaXMgZW5hYmxlZA0KICAgICAqLw0KICAgIGlzRW5hYmxlZCgpIHsNCiAgICAgICAgcmV0dXJuIHRoaXMuZW5hYmxlZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBHZXQgc3RhdGlzdGljcyBhYm91dCB0aGUgb3BlbmluZyBib29rDQogICAgICovDQogICAgZ2V0U3RhdHMoKSB7DQogICAgICAgIGxldCB0b3RhbE1vdmVzID0gMDsNCiAgICAgICAgdGhpcy5ib29rLmZvckVhY2goZW50cnkgPT4gew0KICAgICAgICAgICAgdG90YWxNb3ZlcyArPSBlbnRyeS5tb3Zlcy5sZW5ndGg7DQogICAgICAgIH0pOw0KDQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICBwb3NpdGlvbnM6IHRoaXMuYm9vay5zaXplLA0KICAgICAgICAgICAgdG90YWxNb3Zlcw0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEFkZCBvcGVuaW5nIGxpbmUgZnJvbSB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uDQogICAgICogQHBhcmFtIG5vdGF0aW9uIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbiAoZS5nLiwgWyfngq7kuozlubPkupQnLCAn6amsOOi/mzcnXSkNCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCBhcnJheSBvZiB3ZWlnaHRzIGZvciBlYWNoIG1vdmUNCiAgICAgKi8NCiAgICBhZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihub3RhdGlvbiwgd2VpZ2h0cykgew0KICAgICAgICAvLyBDb252ZXJ0IHRyYWRpdGlvbmFsIG5vdGF0aW9uIHRvIGNvb3JkaW5hdGUgZm9ybWF0DQogICAgICAgIGNvbnN0IG1vdmVzID0gdGhpcy5ub3RhdGlvblRvTW92ZXMobm90YXRpb24pOw0KICAgICAgICAvLyBBZGQgdGhlIG1vdmVzIHRvIHRoZSBvcGVuaW5nIGJvb2sNCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZShtb3Zlcywgd2VpZ2h0cyk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQWRkIG9wZW5pbmcgbGluZSBmcm9tIHN0cmluZyB3aXRoIHNwYWNlLXNlcGFyYXRlZCB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uDQogICAgICogQHBhcmFtIG5vdGF0aW9uQXJyYXkgQXJyYXkgb2Ygc3RyaW5ncywgZWFjaCBjb250YWluaW5nIHNwYWNlLXNlcGFyYXRlZCBtb3ZlcyAoZS5nLiwgWyfngq7kuozlubPkupQg6amsOOi/mzcg6L2m5LiA5bmz5LqMJ10pDQogICAgICogQHBhcmFtIHdlaWdodHMgT3B0aW9uYWwgYXJyYXkgb2Ygd2VpZ2h0cyBmb3IgZWFjaCBtb3ZlDQogICAgICovDQogICAgYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKG5vdGF0aW9uQXJyYXksIHdlaWdodHMpIHsNCiAgICAgICAgLy8gUHJvY2VzcyBlYWNoIHN0cmluZyBpbiB0aGUgYXJyYXkNCiAgICAgICAgaWYgKCFub3RhdGlvbkFycmF5IHx8ICFBcnJheS5pc0FycmF5KG5vdGF0aW9uQXJyYXkpIHx8IG5vdGF0aW9uQXJyYXkubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICByZXR1cm47DQogICAgICAgIH0NCiAgICAgICAgbm90YXRpb25BcnJheS5mb3JFYWNoKG5vdGF0aW9uU3RyaW5nID0+IHsNCiAgICAgICAgICAgIC8vIFNwbGl0IHRoZSBzdHJpbmcgYnkgc3BhY2VzIHRvIGdldCBpbmRpdmlkdWFsIG1vdmVzDQogICAgICAgICAgICBjb25zdCBub3RhdGlvbiA9IG5vdGF0aW9uU3RyaW5nLnNwbGl0KCcgJykuZmlsdGVyKG1vdmUgPT4gbW92ZS50cmltKCkgIT09ICcnKTsNCiAgICAgICAgICAgIC8vIENhbGwgZXhpc3RpbmcgZnVuY3Rpb24gdG8gYWRkIHRoZSBsaW5lDQogICAgICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKG5vdGF0aW9uLCB3ZWlnaHRzKTsNCiAgICAgICAgfSk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQ29udmVydCBjb29yZGluYXRlLWJhc2VkIG1vdmVzIHRvIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24NCiAgICAgKiBAcGFyYW0gYm9hcmRIaXN0b3J5IEFycmF5IG9mIGJvYXJkIHN0YXRlcyByZXByZXNlbnRpbmcgdGhlIGdhbWUgaGlzdG9yeQ0KICAgICAqIEBwYXJhbSBtb3ZlSGlzdG9yeSBBcnJheSBvZiBtb3ZlcyBpbiBjb29yZGluYXRlIGZvcm1hdA0KICAgICAqIEByZXR1cm5zIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbg0KICAgICAqLw0KICAgIG1vdmVzVG9Ob3RhdGlvbihib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5KSB7DQogICAgICAgIGNvbnN0IG5vdGF0aW9uID0gW107DQogICAgICAgIGxldCBjdXJyZW50Q29sb3IgPSAncmVkJzsgLy8gUmVkIG1vdmVzIGZpcnN0DQoNCiAgICAgICAgLy8gVHlwZSB0byBwaWVjZSBjaGFyYWN0ZXIgbWFwcGluZw0KICAgICAgICBjb25zdCB0eXBlVG9QaWVjZSA9IHsNCiAgICAgICAgICAgICdnZW5lcmFsJzogeyAncmVkJzogJ+W4hScsICdibGFjayc6ICflsIYnIH0sDQogICAgICAgICAgICAnYWR2aXNvcic6IHsgJ3JlZCc6ICfku5UnLCAnYmxhY2snOiAn5aOrJyB9LA0KICAgICAgICAgICAgJ2VsZXBoYW50JzogeyAncmVkJzogJ+ebuCcsICdibGFjayc6ICfosaEnIH0sDQogICAgICAgICAgICAnaG9yc2UnOiB7ICdyZWQnOiAn6amsJywgJ2JsYWNrJzogJ+mprCcgfSwNCiAgICAgICAgICAgICdjaGFyaW90JzogeyAncmVkJzogJ+i9picsICdibGFjayc6ICfovaYnIH0sDQogICAgICAgICAgICAnY2Fubm9uJzogeyAncmVkJzogJ+eCricsICdibGFjayc6ICfngq4nIH0sDQogICAgICAgICAgICAnc29sZGllcic6IHsgJ3JlZCc6ICflhbUnLCAnYmxhY2snOiAn5Y2SJyB9DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ29sdW1uIG1hcHBpbmcgKGNvb3JkaW5hdGUgMC04IHRvIHRyYWRpdGlvbmFsIOS5nS3kuIAgZm9yIHJlZCwgOS0xIGZvciBibGFjaykNCiAgICAgICAgY29uc3QgY29sVG9DaGluZXNlID0gWyfkuZ0nLCAn5YWrJywgJ+S4gycsICflha0nLCAn5LqUJywgJ+WbmycsICfkuIknLCAn5LqMJywgJ+S4gCddOw0KICAgICAgICBjb25zdCBjb2xUb0FyYWJpYyA9IFsnOScsICc4JywgJzcnLCAnNicsICc1JywgJzQnLCAnMycsICcyJywgJzEnXTsNCg0KICAgICAgICAvLyBEaWdpdCB0byBDaGluZXNlIG51bWJlciBtYXBwaW5nIGZvciBzdGVwcw0KICAgICAgICBjb25zdCBkaWdpdFRvQ2hpbmVzZSA9IFsnJywgJ+S4gCcsICfkuownLCAn5LiJJywgJ+WbmycsICfkupQnLCAn5YWtJywgJ+S4gycsICflhasnLCAn5LmdJ107DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIHRoZXJlIGFyZSBtdWx0aXBsZSBzYW1lLXR5cGUgcGllY2VzIGluIHRoZSBzYW1lIGNvbHVtbg0KICAgICAgICBjb25zdCBoYXNTYW1lVHlwZUluQ29sdW1uID0gKGJvYXJkLCBwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGV4Y2x1ZGVSb3cpID0+IHsNCiAgICAgICAgICAgIGxldCBjb3VudCA9IDA7DQogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NvbF07DQogICAgICAgICAgICAgICAgaWYgKHIgPT09IGV4Y2x1ZGVSb3cpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSBwaWVjZVR5cGUgJiYgcGllY2UuY29sb3IgPT09IGNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgIGNvdW50Kys7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgcmV0dXJuIGNvdW50ID4gMDsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZGV0ZXJtaW5lIGZyb250L2JhY2sgbWFya2VyDQogICAgICAgIGNvbnN0IGdldEZyb250QmFja01hcmtlciA9IChib2FyZCwgcGllY2VUeXBlLCBjb2xvciwgY29sLCBjdXJyZW50Um93KSA9PiB7DQogICAgICAgICAgICBjb25zdCBzYW1lVHlwZVBpZWNlcyA9IFtdOw0KICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjb2xdOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSBwaWVjZVR5cGUgJiYgcGllY2UuY29sb3IgPT09IGNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgIHNhbWVUeXBlUGllY2VzLnB1c2gocik7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHNhbWVUeXBlUGllY2VzLmxlbmd0aCA8PSAxKSByZXR1cm4gJyc7DQogICAgICAgICAgICBpZiAoY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yIcj03LTnvvInvvIxy5YC86LaK5aSn6LaK6Z2g6L+R5pWM5pa577yM5pivIuWJjSINCiAgICAgICAgICAgICAgICBjb25zdCBzb3J0ZWRSb3dzID0gWy4uLnNhbWVUeXBlUGllY2VzXS5zb3J0KChhLCBiKSA9PiBiIC0gYSk7IC8vIEhpZ2hlciByb3dzIGZpcnN0ID0gY2xvc2VyIHRvIG9wcG9uZW50DQogICAgICAgICAgICAgICAgcmV0dXJuIHNvcnRlZFJvd3NbMF0gPT09IGN1cnJlbnRSb3cgPyAn5YmNJyA6ICflkI4nOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIhyPTAtMu+8ie+8jHLlgLzotorlsI/otorpnaDov5HmlYzmlrnvvIzmmK8i5YmNIg0KICAgICAgICAgICAgICAgIGNvbnN0IHNvcnRlZFJvd3MgPSBbLi4uc2FtZVR5cGVQaWVjZXNdLnNvcnQoKGEsIGIpID0+IGEgLSBiKTsgLy8gTG93ZXIgcm93cyBmaXJzdCA9IGNsb3NlciB0byBvcHBvbmVudA0KICAgICAgICAgICAgICAgIHJldHVybiBzb3J0ZWRSb3dzWzBdID09PSBjdXJyZW50Um93ID8gJ+WJjScgOiAn5ZCOJzsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBQcm9jZXNzIGVhY2ggbW92ZQ0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1vdmVIaXN0b3J5Lmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBtb3ZlID0gbW92ZUhpc3RvcnlbaV07DQogICAgICAgICAgICBjb25zdCBib2FyZEJlZm9yZSA9IGJvYXJkSGlzdG9yeVtpXTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRCZWZvcmVbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFwaWVjZSkgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIHBpZWNlIGZvdW5kIGF0IGZyb20gcG9zaXRpb246JywgbW92ZS5mcm9tKTsNCiAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2UudHlwZTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlQ2hhciA9IHR5cGVUb1BpZWNlW3BpZWNlVHlwZV1bcGllY2UuY29sb3JdOw0KICAgICAgICAgICAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlIGFyZSBtdWx0aXBsZSBzYW1lLXR5cGUgcGllY2VzIGluIHRoZSBzYW1lIGNvbHVtbg0KICAgICAgICAgICAgY29uc3QgaGFzRHVwbGljYXRlID0gaGFzU2FtZVR5cGVJbkNvbHVtbihib2FyZEJlZm9yZSwgcGllY2VUeXBlLCBwaWVjZS5jb2xvciwgbW92ZS5mcm9tLmMsIG1vdmUuZnJvbS5yKTsNCiAgICAgICAgICAgIC8vIEdldCBmcm9udC9iYWNrIG1hcmtlciBpZiBuZWVkZWQNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uTWFya2VyID0gaGFzRHVwbGljYXRlID8gZ2V0RnJvbnRCYWNrTWFya2VyKGJvYXJkQmVmb3JlLCBwaWVjZVR5cGUsIHBpZWNlLmNvbG9yLCBtb3ZlLmZyb20uYywgbW92ZS5mcm9tLnIpIDogJyc7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIERldGVybWluZSBub3RhdGlvbiBiYXNlZCBvbiBwaWVjZSB0eXBlIGFuZCBtb3ZlIGRpcmVjdGlvbg0KICAgICAgICAgICAgbGV0IG5vdGF0aW9uU3RyOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnaG9yc2UnIHx8IHBpZWNlVHlwZSA9PT0gJ2Fkdmlzb3InIHx8IHBpZWNlVHlwZSA9PT0gJ2VsZXBoYW50Jykgew0KICAgICAgICAgICAgICAgIC8vIERpYWdvbmFsIG1vdmluZyBwaWVjZXMgLSBvbmx5IHVzZSDov5sv6YCALCByZWNvcmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+i/m++8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gbW92ZS50by5yID4gbW92ZS5mcm9tLnIgPyAn6L+bJyA6ICfpgIAnOw0KICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCEDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIhyPTDvvInvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6L+b77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSBtb3ZlLnRvLnIgPCBtb3ZlLmZyb20uciA/ICfov5snIDogJ+mAgCc7DQogICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnIHx8IHBpZWNlVHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHBpZWNlVHlwZSA9PT0gJ2Nhbm5vbicgfHwgcGllY2VUeXBlID09PSAnc29sZGllcicpIHsNCiAgICAgICAgICAgICAgICAvLyBTdHJhaWdodCBtb3ZpbmcgcGllY2VzIC0g6L+bL+mAgC/lubMNCiAgICAgICAgICAgICAgICBpZiAobW92ZS5mcm9tLmMgPT09IG1vdmUudG8uYykgew0KICAgICAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBtb3ZlIC0g6L+bL+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGVwcyA9IE1hdGguYWJzKG1vdmUudG8uciAtIG1vdmUuZnJvbS5yKTsNCiAgICAgICAgICAgICAgICAgICAgLy8g6L+b5piv6Z2g6L+R5pWM5pa555qE5pa55ZCR77yM6YCA5piv6L+c56a75pWM5pa555qE5pa55ZCRDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/ov5vvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/ov5vvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IChpc1JlZCA/IG1vdmUudG8uciA+IG1vdmUuZnJvbS5yIDogbW92ZS50by5yIDwgbW92ZS5mcm9tLnIpID8gJ+i/mycgOiAn6YCAJzsNCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY107DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgc3RlcHMgaXMgYSB2YWxpZCBudW1iZXIgYmV0d2VlbiAxLTkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkU3RlcHMgPSBNYXRoLm1heCgxLCBNYXRoLm1pbig5LCBNYXRoLnJvdW5kKHN0ZXBzIHx8IDEpKSk7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke2RpZ2l0VG9DaGluZXNlW3ZhbGlkU3RlcHNdIHx8ICcnfWA7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnku47lj7PlvoDlt6bmmK8xLTnvvIzpnIDopoHlj43ovazliJfmmKDlsIQNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHN0ZXBzIGlzIGEgdmFsaWQgbnVtYmVyDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWxpZFN0ZXBzID0gTWF0aC5yb3VuZChzdGVwcyB8fCAxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dmFsaWRTdGVwc31gOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBtb3ZlIC0g5bmzDQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x95bmzJHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCEDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH3lubMke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1Vua25vd24gcGllY2UgdHlwZTonLCBwaWVjZVR5cGUpOw0KICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICBub3RhdGlvbi5wdXNoKG5vdGF0aW9uU3RyKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gU3dpdGNoIGNvbG9yIGZvciBuZXh0IG1vdmUNCiAgICAgICAgICAgIGN1cnJlbnRDb2xvciA9IGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIHJldHVybiBub3RhdGlvbjsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDb252ZXJ0IHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24gdG8gY29vcmRpbmF0ZSBtb3Zlcw0KICAgICAqIEBwYXJhbSBub3RhdGlvbiBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24NCiAgICAgKiBAcmV0dXJucyBBcnJheSBvZiBtb3ZlcyBpbiBjb29yZGluYXRlIGZvcm1hdA0KICAgICAqLw0KICAgIG5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvbiwgaW5pdGlhbEJvYXJkID0gbnVsbCkgew0KICAgICAgICAvLyDnoa7kv51ub3RhdGlvbuaYr+aVsOe7hOS4lOS4jeS4uuepug0KICAgICAgICBpZiAoIW5vdGF0aW9uIHx8ICFBcnJheS5pc0FycmF5KG5vdGF0aW9uKSB8fCBub3RhdGlvbi5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIHJldHVybiBbXTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICBsZXQgY3VycmVudENvbG9yID0gJ3JlZCc7IC8vIFJlZCBtb3ZlcyBmaXJzdA0KDQogICAgICAgIC8vIFBpZWNlIGNoYXJhY3RlciB0byB0eXBlIG1hcHBpbmcNCiAgICAgICAgY29uc3QgcGllY2VNYXAgPSB7DQogICAgICAgICAgICAn5bCGJzogJ2dlbmVyYWwnLCAn5biFJzogJ2dlbmVyYWwnLA0KICAgICAgICAgICAgJ+Wjqyc6ICdhZHZpc29yJywgJ+S7lSc6ICdhZHZpc29yJywNCiAgICAgICAgICAgICfosaEnOiAnZWxlcGhhbnQnLCAn55u4JzogJ2VsZXBoYW50JywNCiAgICAgICAgICAgICfpqawnOiAnaG9yc2UnLA0KICAgICAgICAgICAgJ+i9pic6ICdjaGFyaW90JywNCiAgICAgICAgICAgICfngq4nOiAnY2Fubm9uJywNCiAgICAgICAgICAgICfljZInOiAnc29sZGllcicsICflhbUnOiAnc29sZGllcicNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDb2x1bW4gbWFwcGluZyAodHJhZGl0aW9uYWwgbm90YXRpb24gdXNlcyAxLTkgZnJvbSByaWdodCB0byBsZWZ0KQ0KICAgICAgICBjb25zdCBjb2xNYXAgPSB7DQogICAgICAgICAgICAn5LiAJzogOCwgJzEnOiA4LA0KICAgICAgICAgICAgJ+S6jCc6IDcsICcyJzogNywNCiAgICAgICAgICAgICfkuIknOiA2LCAnMyc6IDYsDQogICAgICAgICAgICAn5ZubJzogNSwgJzQnOiA1LA0KICAgICAgICAgICAgJ+S6lCc6IDQsICc1JzogNCwNCiAgICAgICAgICAgICflha0nOiAzLCAnNic6IDMsDQogICAgICAgICAgICAn5LiDJzogMiwgJzcnOiAyLA0KICAgICAgICAgICAgJ+WFqyc6IDEsICc4JzogMSwNCiAgICAgICAgICAgICfkuZ0nOiAwLCAnOSc6IDANCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDaGluZXNlIG51bWJlciB0byBkaWdpdCBtYXBwaW5nDQogICAgICAgIGNvbnN0IGNoaW5lc2VOdW1iZXJNYXAgPSB7DQogICAgICAgICAgICAn5LiAJzogMSwgJzEnOiAxLA0KICAgICAgICAgICAgJ+S6jCc6IDIsICcyJzogMiwNCiAgICAgICAgICAgICfkuIknOiAzLCAnMyc6IDMsDQogICAgICAgICAgICAn5ZubJzogNCwgJzQnOiA0LA0KICAgICAgICAgICAgJ+S6lCc6IDUsICc1JzogNSwNCiAgICAgICAgICAgICflha0nOiA2LCAnNic6IDYsDQogICAgICAgICAgICAn5LiDJzogNywgJzcnOiA3LA0KICAgICAgICAgICAgJ+WFqyc6IDgsICc4JzogOCwNCiAgICAgICAgICAgICfkuZ0nOiA5LCAnOSc6IDkNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBJbml0aWFsIHBvc2l0aW9ucyBvZiBwaWVjZXMgKHJlZCBhbmQgYmxhY2spDQogICAgICAgIC8vIOS/ruWkje+8muS4juaWsOWdkOagh+ezu+e7n+S/neaMgeS4gOiHtO+8jOe6ouaWueWcqOW6lemDqO+8iHI9MC0y77yJ77yM6buR5pa55Zyo6aG26YOo77yIcj03LTnvvIkNCiAgICAgICAgY29uc3QgZGVmYXVsdEluaXRpYWxQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAncmVkLWdlbmVyYWwnOiB7IHI6IDAsIGM6IDQgfSwNCiAgICAgICAgICAgICdyZWQtYWR2aXNvcic6IFt7IHI6IDAsIGM6IDMgfSwgeyByOiAwLCBjOiA1IH1dLA0KICAgICAgICAgICAgJ3JlZC1lbGVwaGFudCc6IFt7IHI6IDAsIGM6IDIgfSwgeyByOiAwLCBjOiA2IH1dLA0KICAgICAgICAgICAgJ3JlZC1ob3JzZSc6IFt7IHI6IDAsIGM6IDEgfSwgeyByOiAwLCBjOiA3IH1dLA0KICAgICAgICAgICAgJ3JlZC1jaGFyaW90JzogW3sgcjogMCwgYzogMCB9LCB7IHI6IDAsIGM6IDggfV0sDQogICAgICAgICAgICAncmVkLWNhbm5vbic6IFt7IHI6IDIsIGM6IDEgfSwgeyByOiAyLCBjOiA3IH1dLA0KICAgICAgICAgICAgJ3JlZC1zb2xkaWVyJzogW3sgcjogMywgYzogMCB9LCB7IHI6IDMsIGM6IDIgfSwgeyByOiAzLCBjOiA0IH0sIHsgcjogMywgYzogNiB9LCB7IHI6IDMsIGM6IDggfV0sDQogICAgICAgICAgICAnYmxhY2stZ2VuZXJhbCc6IHsgcjogOSwgYzogNCB9LA0KICAgICAgICAgICAgJ2JsYWNrLWFkdmlzb3InOiBbeyByOiA5LCBjOiAzIH0sIHsgcjogOSwgYzogNSB9XSwNCiAgICAgICAgICAgICdibGFjay1lbGVwaGFudCc6IFt7IHI6IDksIGM6IDIgfSwgeyByOiA5LCBjOiA2IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWhvcnNlJzogW3sgcjogOSwgYzogMSB9LCB7IHI6IDksIGM6IDcgfV0sDQogICAgICAgICAgICAnYmxhY2stY2hhcmlvdCc6IFt7IHI6IDksIGM6IDAgfSwgeyByOiA5LCBjOiA4IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWNhbm5vbic6IFt7IHI6IDcsIGM6IDEgfSwgeyByOiA3LCBjOiA3IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLXNvbGRpZXInOiBbeyByOiA2LCBjOiAwIH0sIHsgcjogNiwgYzogMiB9LCB7IHI6IDYsIGM6IDQgfSwgeyByOiA2LCBjOiA2IH0sIHsgcjogNiwgYzogOCB9XQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIFRyYWNrIHBpZWNlIHBvc2l0aW9ucyBhcyBtb3ZlcyBhcmUgbWFkZQ0KICAgICAgICBsZXQgcGllY2VQb3NpdGlvbnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGRlZmF1bHRJbml0aWFsUG9zaXRpb25zKSk7DQogICAgICAgIA0KICAgICAgICAvLyBJZiBpbml0aWFsIGJvYXJkIGlzIHByb3ZpZGVkLCBpbml0aWFsaXplIHBpZWNlIHBvc2l0aW9ucyBmcm9tIGl0DQogICAgICAgIGlmIChpbml0aWFsQm9hcmQpIHsNCiAgICAgICAgICAgIC8vIFJlc2V0IHBpZWNlIHBvc2l0aW9ucyBiYXNlZCBvbiBpbml0aWFsIGJvYXJkDQogICAgICAgICAgICBwaWVjZVBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICAncmVkLWdlbmVyYWwnOiB7IHI6IC0xLCBjOiAtMSB9LA0KICAgICAgICAgICAgICAgICdyZWQtYWR2aXNvcic6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtZWxlcGhhbnQnOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWhvcnNlJzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1jaGFyaW90JzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1jYW5ub24nOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLXNvbGRpZXInOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stZ2VuZXJhbCc6IHsgcjogLTEsIGM6IC0xIH0sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWFkdmlzb3InOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stZWxlcGhhbnQnOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2staG9yc2UnOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stY2hhcmlvdCc6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1jYW5ub24nOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stc29sZGllcic6IFtdDQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBQb3B1bGF0ZSBwaWVjZSBwb3NpdGlvbnMgZnJvbSBpbml0aWFsIGJvYXJkDQogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGluaXRpYWxCb2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtwaWVjZS5jb2xvcn0tJHtwaWVjZS50eXBlfWA7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAocGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgcGllY2VQb3NpdGlvbnNba2V5XSA9IHsgciwgYyB9Ow0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1trZXldLnB1c2goeyByLCBjIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGZpbmQgcGllY2UgcG9zaXRpb24NCiAgICAgICAgY29uc3QgZmluZFBpZWNlUG9zaXRpb24gPSAocGllY2VUeXBlLCBjb2xvciwgY29sLCBkaXJlY3Rpb24sIGZyb250QmFja01hcmtlciA9IG51bGwpID0+IHsNCiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbG9yfS0ke3BpZWNlVHlwZX1gOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNba2V5XTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcG9zaXRpb25zIGV4aXN0IGFuZCBhcmUgdmFsaWQNCiAgICAgICAgICAgIGlmICghcG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gcG9zaXRpb25zIGZvdW5kIGZvciBwaWVjZTonLCBrZXkpOw0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gcG9zaXRpb25zOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBGaW5kIHBpZWNlcyBvbiB0aGUgc3BlY2lmaWVkIGNvbHVtbg0KICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IHBvc2l0aW9ucy5maWx0ZXIocG9zID0+IHBvcy5jID09PSBjb2wpOw0KDQogICAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBjYW5kaWRhdGVzIGZvdW5kIGZvciBwaWVjZTonLCBrZXksICdvbiBjb2x1bW46JywgY29sKTsNCiAgICAgICAgICAgICAgICAvLyBBZGRpdGlvbmFsIGRlYnVnIGluZm8gZm9yIGNhbm5vbg0KICAgICAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdjYW5ub24nICYmIGNvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdERUJVRzogQ2FuZGlkYXRlcyBhZnRlciBmaWx0ZXI6JywgY2FuZGlkYXRlcyk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gY2FuZGlkYXRlc1swXTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gSWYgZnJvbnQvYmFjayBtYXJrZXIgaXMgcHJvdmlkZWQsIHVzZSBpdCB0byBkZXRlcm1pbmUgdGhlIHBpZWNlDQogICAgICAgICAgICBpZiAoZnJvbnRCYWNrTWFya2VyID09PSAn5YmNJykgew0KICAgICAgICAgICAgICAgIC8vIOWJjeeCru+8mumdoOi/keaVjOaWueeahOaji+WtkA0KICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8mnLlgLzovoPlpKfnmoTmm7TpnaDov5HmlYzmlrnvvIjliY3vvIkNCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJpy5YC86L6D5bCP55qE5pu06Z2g6L+R5pWM5pa577yI5YmN77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoZnJvbnRCYWNrTWFya2VyID09PSAn5ZCOJykgew0KICAgICAgICAgICAgICAgIC8vIOWQjueCru+8mumdoOi/keW3seaWueeahOaji+WtkA0KICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8mnLlgLzovoPlsI/nmoTmm7TpnaDov5Hlt7HmlrnvvIjlkI7vvIkNCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJpy5YC86L6D5aSn55qE5pu06Z2g6L+R5bex5pa577yI5ZCO77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gSWYgbXVsdGlwbGUgcGllY2VzIG9uIHRoZSBzYW1lIGNvbHVtbiBhbmQgbm8gbWFya2VyLCBkZXRlcm1pbmUgYmFzZWQgb24gZGlyZWN0aW9uDQogICAgICAgICAgICAvLyDlr7nkuo7lkIzkuIDliJfnmoTmo4vlrZDvvIzpgJrov4fmr5TovoNy5YC85p2l5Yy65YiGDQogICAgICAgICAgICBpZiAoZGlyZWN0aW9uID09PSAn6L+bJykgew0KICAgICAgICAgICAgICAgIC8vIOi/m+aYr+WQkeaVjOaWueaWueWQkeenu+WKqO+8jOaJgOS7pemAieaLqeabtOmdoOi/keW3seaWueeahOaji+WtkO+8iOWQju+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9IGVsc2UgaWYgKGRpcmVjdGlvbiA9PT0gJ+mAgCcpIHsNCiAgICAgICAgICAgICAgICAvLyDpgIDmmK/lkJHlt7HmlrnmlrnlkJHnp7vliqjvvIzmiYDku6XpgInmi6nmm7TpnaDov5HmlYzmlrnnmoTmo4vlrZDvvIjliY3vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICByZXR1cm4gY2FuZGlkYXRlc1swXTsgLy8gRGVmYXVsdCB0byBmaXJzdCBpZiBkaXJlY3Rpb24gaXMgJ+W5sycgYW5kIG5vIG1hcmtlcg0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byB1cGRhdGUgcGllY2UgcG9zaXRpb24NCiAgICAgICAgY29uc3QgdXBkYXRlUGllY2VQb3NpdGlvbiA9IChwaWVjZVR5cGUsIGNvbG9yLCBvbGRQb3MsIG5ld1BvcykgPT4gew0KICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7Y29sb3J9LSR7cGllY2VUeXBlfWA7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1trZXldOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiBwb3NpdGlvbnMgZXhpc3QgYW5kIGFyZSB2YWxpZA0KICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IE5vIHBvc2l0aW9ucyBmb3VuZCBmb3IgcGllY2U6Jywga2V5KTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgIHBvc2l0aW9ucy5yID0gbmV3UG9zLnI7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zLmMgPSBuZXdQb3MuYzsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IGluZGV4ID0gcG9zaXRpb25zLmZpbmRJbmRleChwb3MgPT4gcG9zLnIgPT09IG9sZFBvcy5yICYmIHBvcy5jID09PSBvbGRQb3MuYyk7DQogICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKSB7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zW2luZGV4XS5yID0gbmV3UG9zLnI7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zW2luZGV4XS5jID0gbmV3UG9zLmM7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogQ291bGQgbm90IGZpbmQgcGllY2UgcG9zaXRpb24gdG8gdXBkYXRlOicsIG9sZFBvcywgJ2luJywgcG9zaXRpb25zKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY2hlY2sgaWYgcG9zaXRpb24gaXMgdmFsaWQNCiAgICAgICAgY29uc3QgaXNWYWxpZFBvcyA9IChyLCBjKSA9PiByID49IDAgJiYgciA8IDEwICYmIGMgPj0gMCAmJiBjIDwgOTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGhvcnNlIG1vdmVzDQogICAgICAgIGNvbnN0IGdldEhvcnNlTW92ZXMgPSAocG9zKSA9PiB7DQogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IGRyOiAtMiwgZGM6IC0xIH0sIHsgZHI6IC0yLCBkYzogMSB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IC0xLCBkYzogLTIgfSwgeyBkcjogLTEsIGRjOiAyIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMSwgZGM6IC0yIH0sIHsgZHI6IDEsIGRjOiAyIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMiwgZGM6IC0xIH0sIHsgZHI6IDIsIGRjOiAxIH0NCiAgICAgICAgICAgIF07DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBob3JzZSBjYW4gbW92ZSBpbiB0aGUgZGlyZWN0aW9uDQogICAgICAgICAgICBjb25zdCBjYW5Nb3ZlID0gKGJsb2NrZWRSLCBibG9ja2VkQykgPT4gew0KICAgICAgICAgICAgICAgIGlmICghaXNWYWxpZFBvcyhyICsgYmxvY2tlZFIsIGMgKyBibG9ja2VkQykpIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH07DQoNCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSwgaW5kZXgpID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCBibG9ja2VkUiA9IGRyID4gMCA/IDEgOiBkciA8IDAgPyAtMSA6IDA7DQogICAgICAgICAgICAgICAgY29uc3QgYmxvY2tlZEMgPSBkYyA+IDAgPyAxIDogZGMgPCAwID8gLTEgOiAwOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBwYXRoIGlzIGJsb2NrZWQNCiAgICAgICAgICAgICAgICBpZiAoKGluZGV4IDwgMiB8fCBpbmRleCA+PSA2KSAmJiBibG9ja2VkUiAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBibG9ja2VkDQogICAgICAgICAgICAgICAgICAgIGlmICghY2FuTW92ZShibG9ja2VkUiwgMCkpIHJldHVybjsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGJsb2NrZWRDICE9PSAwKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgYmxvY2tlZA0KICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbk1vdmUoMCwgYmxvY2tlZEMpKSByZXR1cm47DQogICAgICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpKSB7DQogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0pOw0KDQogICAgICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBlbGVwaGFudCBtb3Zlcw0KICAgICAgICBjb25zdCBnZXRFbGVwaGFudE1vdmVzID0gKHBvcywgY29sb3IpID0+IHsNCiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107DQogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgZHI6IC0yLCBkYzogLTIgfSwgeyBkcjogLTIsIGRjOiAyIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMiwgZGM6IC0yIH0sIHsgZHI6IDIsIGRjOiAyIH0NCiAgICAgICAgICAgIF07DQoNCiAgICAgICAgICAgIC8vIEVsZXBoYW50J3MgdGVycml0b3J5IC0gcmVkIGVsZXBoYW50cyBjYW4gb25seSBiZSBpbiByPD00LCBibGFjayBlbGVwaGFudHMgaW4gcj49NQ0KICAgICAgICAgICAgY29uc3QgaXNJblRlcnJpdG9yeSA9IChyKSA9PiB7DQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IHIgPD0gNCA6IHIgPj0gNTsNCiAgICAgICAgICAgIH07DQoNCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSkgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IG1pZFIgPSByICsgZHIgLyAyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG1pZEMgPSBjICsgZGMgLyAyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsNCg0KICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIG1pZCBwb3NpdGlvbiBpcyBlbXB0eSBhbmQgbmV3IHBvc2l0aW9uIGlzIHZhbGlkDQogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobWlkUiwgbWlkQykgJiYgaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSAmJiBpc0luVGVycml0b3J5KG5ld1IpKSB7DQogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0pOw0KDQogICAgICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBhZHZpc29yIG1vdmVzDQogICAgICAgIGNvbnN0IGdldEFkdmlzb3JNb3ZlcyA9IChwb3MsIGNvbG9yKSA9PiB7DQogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IGRyOiAtMSwgZGM6IC0xIH0sIHsgZHI6IC0xLCBkYzogMSB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDEsIGRjOiAtMSB9LCB7IGRyOiAxLCBkYzogMSB9DQogICAgICAgICAgICBdOw0KDQogICAgICAgICAgICAvLyBBZHZpc29yJ3MgdGVycml0b3J5IChwYWxhY2UpIC0gcmVkIGFkdmlzb3JzIGluIHI9MC0yLGM9My01LCBibGFjayBhZHZpc29ycyBpbiByPTctOSxjPTMtNQ0KICAgICAgICAgICAgY29uc3QgaXNJblBhbGFjZSA9IChyLCBjKSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgclJhbmdlID0gY29sb3IgPT09ICdyZWQnID8gWzAsIDJdIDogWzcsIDldOw0KICAgICAgICAgICAgICAgIHJldHVybiByID49IHJSYW5nZVswXSAmJiByIDw9IHJSYW5nZVsxXSAmJiBjID49IDMgJiYgYyA8PSA1Ow0KICAgICAgICAgICAgfTsNCg0KICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9KSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpICYmIGlzSW5QYWxhY2UobmV3UiwgbmV3QykpIHsNCiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSk7DQoNCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgYm9hcmQgdG8gdHJhY2sgbW92ZXMNCiAgICAgICAgbGV0IHRlbXBCb2FyZCA9IHRoaXMuY3JlYXRlSW5pdGlhbEJvYXJkKCk7DQogICAgICAgIA0KICAgICAgICAvLyBFbnN1cmUgdGVtcEJvYXJkIGlzIHByb3Blcmx5IGluaXRpYWxpemVkDQogICAgICAgIGlmICghdGVtcEJvYXJkIHx8IHRlbXBCb2FyZC5sZW5ndGggIT09IDEwKSB7DQogICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIGJvYXJkIGluaXRpYWxpemF0aW9uJyk7DQogICAgICAgICAgICByZXR1cm4gW107DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIFZlcmlmeSBhbGwgcm93cyBoYXZlIDkgY29sdW1ucw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwOyBpKyspIHsNCiAgICAgICAgICAgIGlmICghdGVtcEJvYXJkW2ldIHx8IHRlbXBCb2FyZFtpXS5sZW5ndGggIT09IDkpIHsNCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbaV0gPSBBcnJheSg5KS5maWxsKG51bGwpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgY29uc29sZS5sb2coJ1RvdGFsIG1vdmVzOicsIG5vdGF0aW9uLmxlbmd0aCk7DQogICAgICAgIG5vdGF0aW9uLmZvckVhY2gobW92ZU5vdGF0aW9uID0+IHsNCg0KDQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFBhcnNlIHRoZSBtb3ZlIG5vdGF0aW9uIC0ga2VlcCBsYXN0IGdyb3VwIG9wdGlvbmFsDQogICAgICAgICAgICBjb25zdCByZWdleCA9IC8oW+WJjeWQjl0pPyhb5bCG5biF5aOr5LuV6LGh55u46ams6L2m54Ku5YW15Y2SXSkoW+S4gOS6jOS4ieWbm+S6lOWFreS4g+WFq+S5nTEyMzQ1Njc4OV0pKFvov5vpgIDlubNdKShb5LiA5LqM5LiJ5Zub5LqU5YWt5LiD5YWr5LmdMTIzNDU2Nzg5XSk/LzsNCiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gbW92ZU5vdGF0aW9uLm1hdGNoKHJlZ2V4KTsNCg0KICAgICAgICAgICAgaWYgKCFtYXRjaCkgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgbW92ZSBub3RhdGlvbjonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgY29uc3QgWywgZnJvbnRCYWNrTWFya2VyLCBwaWVjZUNoYXIsIGZyb21Db2xOb3RhdGlvbiwgZGlyZWN0aW9uLCB0b0NvbE9yU3RlcE5vdGF0aW9uXSA9IG1hdGNoOw0KICAgICAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2VNYXBbcGllY2VDaGFyXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gR2V0IGNvbHVtbiBtYXBwaW5nIGJhc2VkIG9uIGN1cnJlbnQgY29sb3IgKGJsYWNrIHNlZXMgY29sdW1ucyBtaXJyb3JlZCkNCiAgICAgICAgICAgIGxldCBmcm9tQ29sID0gY29sTWFwW2Zyb21Db2xOb3RhdGlvbl07DQogICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrIChmcm9tIGJsYWNrJ3MgcGVyc3BlY3RpdmUpDQogICAgICAgICAgICAgICAgZnJvbUNvbCA9IDggLSBmcm9tQ29sOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBGaW5kIHRoZSBjdXJyZW50IHBvc2l0aW9uIG9mIHRoZSBwaWVjZQ0KICAgICAgICAgICAgY29uc3QgZnJvbVBvcyA9IGZpbmRQaWVjZVBvc2l0aW9uKHBpZWNlVHlwZSwgY3VycmVudENvbG9yLCBmcm9tQ29sLCBkaXJlY3Rpb24sIGZyb250QmFja01hcmtlcik7DQoNCiAgICAgICAgICAgIGlmICghZnJvbVBvcykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBmaW5kIHBpZWNlIHBvc2l0aW9uIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBsZXQgdG9Qb3M7DQoNCiAgICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT09ICflubMnKSB7DQogICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBtb3ZlbWVudA0KICAgICAgICAgICAgICAgIGxldCB0b0NvbCA9IGNvbE1hcFt0b0NvbE9yU3RlcE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICBpZiAodG9Db2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb246JywgdG9Db2xPclN0ZXBOb3RhdGlvbiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrIHdoZW4gbW92aW5nIGhvcml6b250YWxseQ0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgdG9Db2wgPSA4IC0gdG9Db2w7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIHRvUG9zID0geyByOiBmcm9tUG9zLnIsIGM6IHRvQ29sIH07DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIG9yIGRpYWdvbmFsIG1vdmVtZW50DQogICAgICAgICAgICAgICAgY29uc3Qgc3RlcHMgPSBjaGluZXNlTnVtYmVyTWFwW3RvQ29sT3JTdGVwTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKHN0ZXBzID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBzdGVwIGNvdW50OicsIHRvQ29sT3JTdGVwTm90YXRpb24sICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2hvcnNlJykgew0KICAgICAgICAgICAgICAgICAgICAvLyBIb3JzZSBtb3ZlcyBpbiBMLXNoYXBlDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRIb3JzZU1vdmVzKGZyb21Qb3MpOw0KICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24NCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOw0KICAgICAgICAgICAgICAgICAgICBsZXQgdGFyZ2V0Q29sID0gY29sTWFwW3RhcmdldENvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGhvcnNlOicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sNCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnZWxlcGhhbnQnKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEVsZXBoYW50IG1vdmVzIGRpYWdvbmFsbHkgMiBzdGVwcw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0RWxlcGhhbnRNb3Zlcyhmcm9tUG9zLCBjdXJyZW50Q29sb3IpOw0KICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24NCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOw0KICAgICAgICAgICAgICAgICAgICBsZXQgdGFyZ2V0Q29sID0gY29sTWFwW3RhcmdldENvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGVsZXBoYW50OicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sNCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnYWR2aXNvcicpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gQWR2aXNvciBtb3ZlcyBkaWFnb25hbGx5IDEgc3RlcA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0QWR2aXNvck1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7DQogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247DQogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgYWR2aXNvcjonLCB0YXJnZXRDb2xOb3RhdGlvbiwgJ2luIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrDQogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldENvbCA9IDggLSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIG1vdmUgdGhhdCBtYXRjaGVzIGJvdGggZGlyZWN0aW9uIGFuZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZGlyZWN0aW9uIChyb3cpDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbk1hdGNoID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yID4gZnJvbVBvcy5yIDogbW92ZS5yIDwgZnJvbVBvcy5yKSA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgY29sdW1uDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2x1bW5NYXRjaCA9IG1vdmUuYyA9PT0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOw0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyBTdHJhaWdodCBsaW5lIG1vdmVtZW50IChjaGFyaW90LCBjYW5ub24sIHNvbGRpZXIpDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXAgPSBkaXJlY3Rpb24gPT09ICfov5snID8gKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAxIDogLTEpICogc3RlcHMgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAtMSA6IDEpICogc3RlcHM7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSBmcm9tUG9zLnIgKyBzdGVwOw0KICAgICAgICAgICAgICAgICAgICBpZiAobmV3UiA8IDAgfHwgbmV3UiA+PSAxMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCByb3cgcG9zaXRpb24gYWZ0ZXIgbW92ZTonLCBuZXdSLCAnZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHsgcjogbmV3UiwgYzogZnJvbVBvcy5jIH07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAoIXRvUG9zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignQ291bGQgbm90IGRldGVybWluZSB0YXJnZXQgcG9zaXRpb24gZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEFkZCB0aGUgbW92ZSB0byB0aGUgbGlzdA0KICAgICAgICAgICAgbW92ZXMucHVzaCh7IGZyb206IHsgcjogZnJvbVBvcy5yLCBjOiBmcm9tUG9zLmMgfSwgdG86IHsgcjogdG9Qb3MuciwgYzogdG9Qb3MuYyB9IH0pOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGVyZSdzIGEgY2FwdHVyZWQgcGllY2UNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkUGllY2UgPSB0ZW1wQm9hcmRbdG9Qb3Mucl1bdG9Qb3MuY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIElmIHRoZXJlJ3MgYSBjYXB0dXJlZCBwaWVjZSwgcmVtb3ZlIGl0IGZyb20gcGllY2VQb3NpdGlvbnMNCiAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBgJHtjYXB0dXJlZFBpZWNlLmNvbG9yfS0ke2NhcHR1cmVkUGllY2UudHlwZX1gOw0KICAgICAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkUG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNbY2FwdHVyZWRLZXldOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjYXB0dXJlZFBvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgICAgICAvLyDlsIYv5biF5LiN5Lya6KKr5ZCD5o6J77yM5omA5Lul5Y+q5aSE55CG5YW25LuW5qOL5a2QDQogICAgICAgICAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlLnR5cGUgIT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmVtb3ZlIHRoZSBjYXB0dXJlZCBwb3NpdGlvbiBmcm9tIHRoZSBhcnJheQ0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY2FwdHVyZWRQb3NpdGlvbnMpKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlZFBvc2l0aW9ucyA9IGNhcHR1cmVkUG9zaXRpb25zLmZpbHRlcihwb3MgPT4gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiAocG9zLnIgIT09IHRvUG9zLnIgfHwgcG9zLmMgIT09IHRvUG9zLmMpDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV0gPSB1cGRhdGVkUG9zaXRpb25zOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFZlcmlmeSByZW1vdmFsIHdhcyBzdWNjZXNzZnVsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RpbGxFeGlzdHMgPSB1cGRhdGVkUG9zaXRpb25zLnNvbWUocG9zID0+IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgcG9zLnIgPT09IHRvUG9zLnIgJiYgcG9zLmMgPT09IHRvUG9zLmMNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzdGlsbEV4aXN0cykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IENhcHR1cmVkIHBpZWNlIHN0aWxsIGV4aXN0cyBpbiBwaWVjZVBvc2l0aW9ucyEnKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygn4pyFIFNVQ0NFU1M6IENhcHR1cmVkIHBpZWNlIHJlbW92ZWQgZnJvbSBwaWVjZVBvc2l0aW9ucycpOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBVbmV4cGVjdGVkIG5vbi1hcnJheSBwb3NpdGlvbnMgZm9yIHBpZWNlOicsIGNhcHR1cmVkS2V5KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogTm8gcG9zaXRpb25zIGZvdW5kIGZvciBjYXB0dXJlZCBwaWVjZTonLCBjYXB0dXJlZEtleSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBWZXJpZnkgdGhlIGNhcHR1cmVkIHBpZWNlIGhhcyBiZWVuIHJlbW92ZWQNCiAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBgJHtjYXB0dXJlZFBpZWNlLmNvbG9yfS0ke2NhcHR1cmVkUGllY2UudHlwZX1gOw0KICAgICAgICAgICAgICAgIGNvbnN0IGZpbmFsUG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNbY2FwdHVyZWRLZXldOw0KICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpbmFsUG9zaXRpb25zKSkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGlsbEV4aXN0cyA9IGZpbmFsUG9zaXRpb25zLnNvbWUocG9zID0+IA0KICAgICAgICAgICAgICAgICAgICAgICAgcG9zICYmIHBvcy5yID09PSB0b1Bvcy5yICYmIHBvcy5jID09PSB0b1Bvcy5jDQogICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgICAgIGlmIChzdGlsbEV4aXN0cykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignRVJST1I6IENhcHR1cmVkIHBpZWNlIHN0aWxsIGV4aXN0cyBpbiBwaWVjZVBvc2l0aW9uczonLCBjYXB0dXJlZFBpZWNlLCAnYXQnLCB0b1Bvcyk7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU1VDQ0VTUzogQ2FwdHVyZWQgcGllY2UgcmVtb3ZlZCBmcm9tIHBpZWNlUG9zaXRpb25zJyk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIE1ha2UgdGhlIG1vdmUgb24gdGhlIHRlbXBvcmFyeSBib2FyZCBmaXJzdCBiZWZvcmUgdXBkYXRpbmcgcGllY2UgcG9zaXRpb25zDQogICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhmcm9tUG9zLnIsIGZyb21Qb3MuYykgJiYgaXNWYWxpZFBvcyh0b1Bvcy5yLCB0b1Bvcy5jKSAmJiANCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbZnJvbVBvcy5yXSAmJiB0ZW1wQm9hcmRbdG9Qb3Mucl0pIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IHRlbXBCb2FyZFtmcm9tUG9zLnJdW2Zyb21Qb3MuY107DQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW3RvUG9zLnJdW3RvUG9zLmNdID0gcGllY2U7DQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2Zyb21Qb3Mucl1bZnJvbVBvcy5jXSA9IG51bGw7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogSW52YWxpZCBwb3NpdGlvbnMgZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uLCBmcm9tUG9zLCB0b1Bvcyk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgcGllY2UgcG9zaXRpb24gaW4gcGllY2VQb3NpdGlvbnMNCiAgICAgICAgICAgIHVwZGF0ZVBpZWNlUG9zaXRpb24ocGllY2VUeXBlLCBjdXJyZW50Q29sb3IsIGZyb21Qb3MsIHRvUG9zKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gU3dpdGNoIGNvbG9yIGZvciBuZXh0IG1vdmUNCiAgICAgICAgICAgIGN1cnJlbnRDb2xvciA9IGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIH0pOw0KDQogICAgICAgIHJldHVybiBtb3ZlczsNCiAgICB9DQp9DQoNCi8vIC0tLSBDb25zdGFudHMgLS0tDQoNCi8vIEluaXRpYWxpemUgT3BlbmluZyBCb29rDQpjb25zdCBvcGVuaW5nQm9vayA9IG5ldyBPcGVuaW5nQm9vaygxMik7DQoNCmNvbnN0IGlzVmFsaWRQb3MgPSAociwgYykgPT4gciA+PSAwICYmIHIgPCBST1dTICYmIGMgPj0gMCAmJiBjIDwgQ09MUzsNCg0KLy8g5qih5Z2X57qn5Lyq5ZCI5rOV6JC954K577yI6YG/5YWNIGdldFBpZWNlTW92ZXMg5q+P6LCD55So5paw5bu66Zet5YyF77yJDQpjb25zdCBwdXNoUHNldWRvRGVzdCA9IChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgdHIsIHRjKSA9PiB7DQogIGlmICh0ciA8IDAgfHwgdHIgPj0gUk9XUyB8fCB0YyA8IDAgfHwgdGMgPj0gQ09MUykgcmV0dXJuOw0KICBjb25zdCB0YXJnZXQgPSBib2FyZFt0cl1bdGNdOw0KICBpZiAoIXRhcmdldCB8fCB0YXJnZXQuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsNCiAgICBtb3Zlcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICB9IGVsc2UgaWYgKGFsbGllc091dCAmJiB0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgYWxsaWVzT3V0LnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogIH0NCn07DQoNCi8vIGFsbGllc091dDog5Y+v6YCJ77yM5pS26ZuG5Y+v5L+d5oqk55qE5bex5pa56JC954K577yI5LiN5ZCr5bCG5biF77yJ77yM5L6b5YWz57O76K6h566X5aSN55So77yM6YG/5YWN5LqM5qyh5bCE57q/DQpjb25zdCBnZXRQaWVjZU1vdmVzID0gKGJvYXJkLCBwb3MsIHBpZWNlLCBhbGxpZXNPdXQgPSBudWxsKSA9PiB7DQogIGNvbnN0IG1vdmVzID0gW107DQogIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCiAgY29uc3QgcGllY2VDb2xvciA9IHBpZWNlLmNvbG9yOw0KICBjb25zdCBjb2xvcklkeCA9IGlzUmVkID8gMCA6IDE7DQogIGNvbnN0IGZyb21TcSA9IHIgKiA5ICsgYzsNCg0KICBzd2l0Y2ggKHBpZWNlLnR5cGUpIHsNCiAgICBjYXNlICdnZW5lcmFsJzogew0KICAgICAgY29uc3QgZGVzdHMgPSBHRU5FUkFMX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgcHVzaFBzZXVkb0Rlc3QoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIGQuciwgZC5jKTsNCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBjYXNlICdhZHZpc29yJzogew0KICAgICAgY29uc3QgZGVzdHMgPSBBRFZJU09SX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgcHVzaFBzZXVkb0Rlc3QoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIGQuciwgZC5jKTsNCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBjYXNlICdlbGVwaGFudCc6IHsNCiAgICAgIGNvbnN0IGRlc3RzID0gRUxFUEhBTlRfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICBpZiAoYm9hcmRbZC5icl1bZC5iY10gPT09IG51bGwpIHsNCiAgICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOw0KICAgICAgICB9DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogICAgY2FzZSAnaG9yc2UnOiB7DQogICAgICBjb25zdCBkZXN0cyA9IEhPUlNFX0RFU1RbZnJvbVNxXTsNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICBpZiAoYm9hcmRbZC5icl1bZC5iY10gPT09IG51bGwpIHsNCiAgICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOw0KICAgICAgICB9DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogICAgY2FzZSAnY2hhcmlvdCc6DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIHdoaWxlIChuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUykgew0KICAgICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgaWYgKHRhcmdldCA9PT0gbnVsbCkgew0KICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKHRhcmdldC5jb2xvciAhPT0gcGllY2VDb2xvcikgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIGVsc2UgaWYgKGFsbGllc091dCAmJiB0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSBhbGxpZXNPdXQucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgIH0NCiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2Nhbm5vbic6DQogICAgICAvLyDnnYDms5Xku43lj6rlkKvmlYzmlrnpmpTmiZPvvJvlt7HmlrnpmpTmiZPkv53miqTnlLEgZmlsbENhbm5vblJlbGF0aW9ucyDnu5/kuIDlpITnkIYNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgbGV0IHNjcmVlbkZvdW5kID0gZmFsc2U7DQogICAgICAgIHdoaWxlIChuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUykgew0KICAgICAgICAgIGlmICghc2NyZWVuRm91bmQpIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdID09PSBudWxsKSB7DQogICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICBzY3JlZW5Gb3VuZCA9IHRydWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdICE9PSBudWxsKSB7DQogICAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdLmNvbG9yICE9PSBwaWVjZUNvbG9yKSBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICB9DQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgICB9DQogICAgICB9DQogICAgICBicmVhazsNCiAgICBjYXNlICdzb2xkaWVyJzogew0KICAgICAgY29uc3QgZGVzdHMgPSBTT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgcHVzaFBzZXVkb0Rlc3QoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIGQuciwgZC5jKTsNCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgfQ0KICByZXR1cm4gbW92ZXM7DQp9Ow0KDQpjb25zdCBpc0ZseWluZ0dlbmVyYWwgPSAoYm9hcmQpID0+IHsNCiAgY29uc3QgcmVkRyA9IGdldEdlbmVyYWxQb3MoYm9hcmQsICdyZWQnKTsNCiAgY29uc3QgYmxhY2tHID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgJ2JsYWNrJyk7DQogIGlmICghcmVkRyB8fCAhYmxhY2tHIHx8IHJlZEcuYyAhPT0gYmxhY2tHLmMpIHJldHVybiBmYWxzZTsNCiAgDQogIC8vIOehruS/neW+queOr+aWueWQkeato+ehru+8jOS7jui+g+Wwj+eahHLliLDovoPlpKfnmoRyDQogIGNvbnN0IHN0YXJ0UiA9IE1hdGgubWluKGJsYWNrRy5yLCByZWRHLnIpICsgMTsNCiAgY29uc3QgZW5kUiA9IE1hdGgubWF4KGJsYWNrRy5yLCByZWRHLnIpIC0gMTsNCiAgDQogIGZvciAobGV0IHIgPSBzdGFydFI7IHIgPD0gZW5kUjsgcisrKSB7DQogICAgaWYgKGJvYXJkW3JdW3JlZEcuY10gIT09IG51bGwpIHJldHVybiBmYWxzZTsNCiAgfQ0KICByZXR1cm4gdHJ1ZTsNCn07DQoNCi8vIOaXoCBib2FyZEluZm8g5pe255qE5b+r6YCf5bCG5Yab5qOA5rWL77ya5bCG5L2N57yT5a2YICsg5LuO5bCG5L2N5Zub5ZCR5bCE57q/77yI6L2mL+Wwhi/ngq7lkIjlubbvvIkNCmNvbnN0IGlzQ2hlY2tSYXdGcm9tUGllY2VTdGF0ZSA9IChzdGF0ZSwgY29sb3IpID0+IHsNCiAgICBjb25zdCBvd25Jc1JlZCA9IGNvbG9yID09PSAncmVkJzsNCiAgICBjb25zdCBnZW5lcmFsU3EgPSBvd25Jc1JlZCA/IHN0YXRlLnJlZEdlbmVyYWxTcSA6IHN0YXRlLmJsYWNrR2VuZXJhbFNxOw0KICAgIGlmIChnZW5lcmFsU3EgPCAwKSByZXR1cm4gdHJ1ZTsNCg0KICAgIGNvbnN0IHNxdWFyZUNvZGVzID0gc3RhdGUuc3F1YXJlQ29kZXM7DQogICAgY29uc3QgZW5lbXlJc1JlZCA9ICFvd25Jc1JlZDsNCiAgICBjb25zdCBnciA9IFNFQVJDSF9TUV9ST1dTW2dlbmVyYWxTcV07DQogICAgY29uc3QgZ2MgPSBTRUFSQ0hfU1FfQ09MU1tnZW5lcmFsU3FdOw0KDQogICAgZm9yIChsZXQgZGlyID0gMCwgcmF5SW5kZXggPSBnZW5lcmFsU3EgPDwgMjsgZGlyIDwgU0VBUkNIX1JBWV9ESVJTOyBkaXIrKywgcmF5SW5kZXgrKykgew0KICAgICAgICBsZXQgc2VlbiA9IDA7DQogICAgICAgIGNvbnN0IHJheUVuZCA9IFNFQVJDSF9SQVlfT0ZGU0VUU1tyYXlJbmRleCArIDFdOw0KICAgICAgICBmb3IgKGxldCByYXlQb3MgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXhdOyByYXlQb3MgPCByYXlFbmQ7IHJheVBvcysrKSB7DQogICAgICAgICAgICBjb25zdCBwaWVjZUNvZGUgPSBzcXVhcmVDb2Rlc1tTRUFSQ0hfUkFZX1NRVUFSRVNbcmF5UG9zXV07DQogICAgICAgICAgICBpZiAocGllY2VDb2RlID09PSAwKSBjb250aW51ZTsNCiAgICAgICAgICAgIHNlZW4rKzsNCiAgICAgICAgICAgIGNvbnN0IGlzRW5lbXkgPSAocGllY2VDb2RlIDwgOCkgPT09IGVuZW15SXNSZWQ7DQogICAgICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZUNvZGUgJiA3Ow0KICAgICAgICAgICAgaWYgKHNlZW4gPT09IDEpIHsNCiAgICAgICAgICAgICAgICBpZiAoaXNFbmVteSAmJiAocGllY2VUeXBlID09PSAyIHx8IHBpZWNlVHlwZSA9PT0gMSkpIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBpZiAoaXNFbmVteSAmJiBwaWVjZVR5cGUgPT09IDYpIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3QgaG9yc2VDaGVja2VycyA9IFNFQVJDSF9IT1JTRV9DSEVDS0VSU1tnZW5lcmFsU3FdOw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaG9yc2VDaGVja2Vycy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBlbnRyeSA9IGhvcnNlQ2hlY2tlcnNbaV07DQogICAgICAgIGlmIChzcXVhcmVDb2Rlc1tlbnRyeSA+Pj4gN10gIT09IDApIGNvbnRpbnVlOw0KICAgICAgICBjb25zdCBwaWVjZUNvZGUgPSBzcXVhcmVDb2Rlc1tlbnRyeSAmIDEyN107DQogICAgICAgIGlmIChwaWVjZUNvZGUgIT09IDAgJiYgKHBpZWNlQ29kZSA8IDgpID09PSBlbmVteUlzUmVkICYmIChwaWVjZUNvZGUgJiA3KSA9PT0gMykgcmV0dXJuIHRydWU7DQogICAgfQ0KDQogICAgY29uc3QgYWR2aXNvclNxdWFyZXMgPSBTRUFSQ0hfQURWSVNPUl9ERVNUW293bklzUmVkID8gMCA6IDFdW2dlbmVyYWxTcV07DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhZHZpc29yU3F1YXJlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBwaWVjZUNvZGUgPSBzcXVhcmVDb2Rlc1thZHZpc29yU3F1YXJlc1tpXV07DQogICAgICAgIGlmIChwaWVjZUNvZGUgIT09IDAgJiYgKHBpZWNlQ29kZSA8IDgpID09PSBlbmVteUlzUmVkICYmIChwaWVjZUNvZGUgJiA3KSA9PT0gNSkgcmV0dXJuIHRydWU7DQogICAgfQ0KDQogICAgY29uc3QgZW5lbXlGb3J3YXJkID0gZW5lbXlJc1JlZCA/IDEgOiAtMTsNCiAgICBjb25zdCBmb3J3YXJkUiA9IGdyIC0gZW5lbXlGb3J3YXJkOw0KICAgIGlmIChmb3J3YXJkUiA+PSAwICYmIGZvcndhcmRSIDwgUk9XUykgew0KICAgICAgICBjb25zdCBwaWVjZUNvZGUgPSBzcXVhcmVDb2Rlc1tmb3J3YXJkUiAqIDkgKyBnY107DQogICAgICAgIGlmIChwaWVjZUNvZGUgIT09IDAgJiYgKHBpZWNlQ29kZSA8IDgpID09PSBlbmVteUlzUmVkICYmIChwaWVjZUNvZGUgJiA3KSA9PT0gNykgcmV0dXJuIHRydWU7DQogICAgfQ0KICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGVuZW15SXNSZWQgPyBnciA+PSA1IDogZ3IgPD0gNDsNCiAgICBpZiAoY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgIGlmIChnYyA8IENPTFMgLSAxKSB7DQogICAgICAgICAgICBjb25zdCBwaWVjZUNvZGUgPSBzcXVhcmVDb2Rlc1tnZW5lcmFsU3EgKyAxXTsNCiAgICAgICAgICAgIGlmIChwaWVjZUNvZGUgIT09IDAgJiYgKHBpZWNlQ29kZSA8IDgpID09PSBlbmVteUlzUmVkICYmIChwaWVjZUNvZGUgJiA3KSA9PT0gNykgcmV0dXJuIHRydWU7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGdjID4gMCkgew0KICAgICAgICAgICAgY29uc3QgcGllY2VDb2RlID0gc3F1YXJlQ29kZXNbZ2VuZXJhbFNxIC0gMV07DQogICAgICAgICAgICBpZiAocGllY2VDb2RlICE9PSAwICYmIChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZCAmJiAocGllY2VDb2RlICYgNykgPT09IDcpIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgcmV0dXJuIGZhbHNlOw0KfTsNCg0KY29uc3QgaXNDaGVja1JhdyA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgaWYgKHBpZWNlU3RhdGUpIHJldHVybiBpc0NoZWNrUmF3RnJvbVBpZWNlU3RhdGUocGllY2VTdGF0ZSwgY29sb3IpOw0KICAgIGNvbnN0IGdlbmVyYWxQb3MgPSBnZXRHZW5lcmFsUG9zKGJvYXJkLCBjb2xvcik7DQogICAgaWYgKCFnZW5lcmFsUG9zKSByZXR1cm4gdHJ1ZTsNCg0KICAgIGNvbnN0IGVuZW15Q29sb3IgPSBjb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgY29uc3QgeyByOiBnciwgYzogZ2MgfSA9IGdlbmVyYWxQb3M7DQoNCiAgICAvLyDnm7Tnur/vvJrnrKzkuIDlrZDkuLrmlYzovaYv5bCG5YiZ5bCG5Yab77yb6LaK6L+H54Ku5p625ZCO56ys5LqM5a2Q5Li65pWM54Ku5YiZ5bCG5YabDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICBsZXQgbnIgPSBnciArIGRyOw0KICAgICAgICBsZXQgbmMgPSBnYyArIGRjOw0KICAgICAgICBsZXQgc2VlbiA9IDA7DQoNCiAgICAgICAgd2hpbGUgKGlzVmFsaWRQb3MobnIsIG5jKSkgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICBpZiAocCkgew0KICAgICAgICAgICAgICAgIHNlZW4rKzsNCiAgICAgICAgICAgICAgICBpZiAoc2VlbiA9PT0gMSkgew0KICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiAocC50eXBlID09PSAnY2hhcmlvdCcgfHwgcC50eXBlID09PSAnZ2VuZXJhbCcpKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ2Nhbm5vbicpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIG5yICs9IGRyOw0KICAgICAgICAgICAgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDpqazvvJrku47lsIbkvY3lj43mjqjvvIzpqazohb/lnKjpqazkuIDkvqfvvIjkuI4gZ2V0UGllY2VNb3ZlcyAvIEhPUlNFX0RJUlMg5LiA6Ie077yJDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBIT1JTRV9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBIT1JTRV9ESVJTW2ldOw0KICAgICAgICBjb25zdCBuciA9IGdyICsgZC5kcjsNCiAgICAgICAgY29uc3QgbmMgPSBnYyArIGQuZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICAgIGNvbnN0IGxlZ1IgPSBuciAtIGQubGVnRHI7DQogICAgICAgICAgICBjb25zdCBsZWdDID0gbmMgLSBkLmxlZ0RjOw0KICAgICAgICAgICAgaWYgKGJvYXJkW2xlZ1JdW2xlZ0NdID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdob3JzZScpIHsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5aOr77yI5Lmd5a6r5YaF77yJDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBESUFHX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZHIgPSBESUFHX0RJUlNbaV1bMF0sIGRjID0gRElBR19ESVJTW2ldWzFdOw0KICAgICAgICBjb25zdCBuciA9IGdyICsgZHI7DQogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkYzsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MobnIsIG5jKSAmJg0KICAgICAgICAgICAgKChjb2xvciA9PT0gJ3JlZCcgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSB8fCAoY29sb3IgPT09ICdibGFjaycgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSkgJiYNCiAgICAgICAgICAgIG5jID49IDMgJiYgbmMgPD0gNSkgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ2Fkdmlzb3InKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDlhbXvvJrmraPliY3mlrnlp4vnu4jlj6/mlLvvvJvlt6blj7Pku4Xov4fmsrPlhbUNCiAgICBjb25zdCBlbmVteUZvcndhcmQgPSBlbmVteUNvbG9yID09PSAncmVkJyA/IDEgOiAtMTsNCiAgICBjb25zdCBmb3J3YXJkRnJvbVIgPSBnciAtIGVuZW15Rm9yd2FyZDsNCiAgICBpZiAoaXNWYWxpZFBvcyhmb3J3YXJkRnJvbVIsIGdjKSkgew0KICAgICAgICBjb25zdCBwID0gYm9hcmRbZm9yd2FyZEZyb21SXVtnY107DQogICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnc29sZGllcicpIHsNCiAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgfQ0KICAgIGZvciAoY29uc3QgZGMgb2YgWzEsIC0xXSkgew0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKGdyLCBuYykpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtncl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGVuZW15Q29sb3IgPT09ICdyZWQnID8gZ3IgPj0gNSA6IGdyIDw9IDQ7DQogICAgICAgICAgICAgICAgaWYgKGNyb3NzZWRSaXZlcikgew0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICByZXR1cm4gZmFsc2U7DQp9Ow0KDQpjb25zdCBpc0NoZWNrID0gKGJvYXJkLCBjb2xvciwgcGllY2VzSW5mbyA9IG51bGwsIGJvYXJkSW5mbyA9IG51bGwpID0+IHsNCiAgICAvLyDkvJjlhYjkvb/nlKjpooTorqHnrpfnmoTlsIblhpvnirbmgIENCiAgICBpZiAoYm9hcmRJbmZvKSB7DQogICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkSXNJbkNoZWNrIDogYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrOw0KICAgIH0NCg0KICAgIC8vIOWmguaenOaciXBpZWNlc0luZm/vvIzkuZ/lj6/ku6Xku47kuK3ojrflj5blsIblhpvnirbmgIENCiAgICBpZiAocGllY2VzSW5mbyAmJiBwaWVjZXNJbmZvLmxlbmd0aCA+IDApIHsNCiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IHBpZWNlc0luZm9bMF0ucmVkSXNJbkNoZWNrIDogcGllY2VzSW5mb1swXS5ibGFja0lzSW5DaGVjazsNCiAgICB9DQoNCiAgICByZXR1cm4gaXNDaGVja1Jhdyhib2FyZCwgY29sb3IpOw0KfTsNCg0KLy8g5ZCI5rOV552A5rOV77ya5Lyq5ZCI5rOVICsg5LiN6YCB5bCGL+S4jemjnuWwhu+8iG1ha2UvdW5tYWtl77yJDQpjb25zdCBnZXRWYWxpZE1vdmVzID0gKGJvYXJkLCBwb3MpID0+IHsNCiAgY29uc3QgcGllY2UgPSBib2FyZFtwb3Mucl1bcG9zLmNdOw0KICBpZiAoIXBpZWNlKSByZXR1cm4gW107DQogIGNvbnN0IHBzZXVkb01vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgcG9zLCBwaWVjZSk7DQogIHJldHVybiBmaWx0ZXJMZWdhbE1vdmVzKGJvYXJkLCBwb3MsIHBpZWNlLCBwc2V1ZG9Nb3Zlcyk7DQp9Ow0KDQpjb25zdCBpc1ZhbGlkUGxhY2VtZW50ID0gKHR5cGUsIGNvbG9yLCByLCBjKSA9PiB7DQogICAgY29uc3QgaXNSZWQgPSBjb2xvciA9PT0gJ3JlZCc7DQogICAgc3dpdGNoKHR5cGUpIHsNCiAgICAgICAgY2FzZSAnZ2VuZXJhbCc6DQogICAgICAgICAgICAvLyDluIXlsIblj6rog73lnKjkuZ3lrqvkuK3lv4PnmoTkuIDmnaHnur/kuIoNCiAgICAgICAgICAgIGlmIChjIDwgMyB8fCBjID4gNSkgcmV0dXJuIGZhbHNlOw0KICAgICAgICAgICAgaWYgKGlzUmVkKSByZXR1cm4gciA+PSAwICYmIHIgPD0gMjsNCiAgICAgICAgICAgIGVsc2UgcmV0dXJuIHIgPj0gNyAmJiByIDw9IDk7DQogICAgICAgIGNhc2UgJ2Fkdmlzb3InOg0KICAgICAgICAgICAgLy8g5aOr5Y+q6IO95Zyo5Lmd5a6r55qENeS4queCueS5i+S4gA0KICAgICAgICAgICAgY29uc3QgdmFsaWRBZHZpc29yUG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgIHJlZDogW1swLCAzXSwgWzAsIDVdLCBbMSwgNF0sIFsyLCAzXSwgWzIsIDVdXSwNCiAgICAgICAgICAgICAgICBibGFjazogW1s3LCAzXSwgWzcsIDVdLCBbOCwgNF0sIFs5LCAzXSwgWzksIDVdXQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIHJldHVybiB2YWxpZEFkdmlzb3JQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICBjYXNlICdlbGVwaGFudCc6DQogICAgICAgICAgICAvLyDnm7jlj6rog73lnKjlt7HmlrnljYrlnLrnmoQ35Liq54K55LmL5LiADQogICAgICAgICAgICBjb25zdCB2YWxpZEVsZXBoYW50UG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgIHJlZDogW1swLCAyXSwgWzAsIDZdLCBbMiwgMF0sIFsyLCA0XSwgWzIsIDhdLCBbNCwgMl0sIFs0LCA2XV0sDQogICAgICAgICAgICAgICAgYmxhY2s6IFtbNSwgMl0sIFs1LCA2XSwgWzcsIDBdLCBbNywgNF0sIFs3LCA4XSwgWzksIDJdLCBbOSwgNl1dDQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgcmV0dXJuIHZhbGlkRWxlcGhhbnRQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICBjYXNlICdzb2xkaWVyJzoNCiAgICAgICAgICAgIC8vIOWFteeahOS9jee9rumZkOWItu+8mui/h+ays+WJjeWPquiDveWcqOWBtuaVsOWIl++8jOi/h+ays+WQjuWPr+S7peWcqOS7u+S9leWIlw0KICAgICAgICAgICAgLy8g57qi5pa55YW16L+H5rKz5p2h5Lu25pivciA+PSA177yM6buR5pa55YW16L+H5rKz5p2h5Lu25pivciA8PSA0DQogICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBpc1JlZCA/IHIgPj0gNSA6IHIgPD0gNDsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICAvLyDov4fmsrPliY3lj6rog73lnKjlgbbmlbDliJfvvIhjPTAsMiw0LDYsOO+8iQ0KICAgICAgICAgICAgICAgIGlmICghWzAsIDIsIDQsIDYsIDhdLmluY2x1ZGVzKGMpKSByZXR1cm4gZmFsc2U7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOWFteeahOS9jee9rumZkOWItu+8mui/h+ays+WJjeWPquiDveWcqOWFteS9jeWSjOWFteS9jeWJjeaWue+8jOi/h+ays+WQjuaVjOaWueWNiuWcuumDveWQiOazlQ0KICAgICAgICAgICAgY29uc3QgdmFsaWRTb2xkaWVyUG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgIHJlZDogew0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnliJ3lp4vlhbXkvY3vvJpyPTMsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGluaXRpYWw6IFtbMywgMF0sIFszLCAyXSwgWzMsIDRdLCBbMywgNl0sIFszLCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWueWFteS9jeWJjeaWue+8mnI9NCwgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgZm9yd2FyZDogW1s0LCAwXSwgWzQsIDJdLCBbNCwgNF0sIFs0LCA2XSwgWzQsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+H5rKz57q/77yacj49NQ0KICAgICAgICAgICAgICAgICAgICBjcm9zc2VkUml2ZXI6IHIgPj0gNQ0KICAgICAgICAgICAgICAgIH0sDQogICAgICAgICAgICAgICAgYmxhY2s6IHsNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55Yid5aeL5YW15L2N77yacj02LCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBpbml0aWFsOiBbWzYsIDBdLCBbNiwgMl0sIFs2LCA0XSwgWzYsIDZdLCBbNiwgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnlhbXkvY3liY3mlrnvvJpyPTUsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGZvcndhcmQ6IFtbNSwgMF0sIFs1LCAyXSwgWzUsIDRdLCBbNSwgNl0sIFs1LCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/h+ays+e6v++8mnI8PTQNCiAgICAgICAgICAgICAgICAgICAgY3Jvc3NlZFJpdmVyOiByIDw9IDQNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgDQogICAgICAgICAgICBjb25zdCBzb2xkaWVySW5mbyA9IHZhbGlkU29sZGllclBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ107DQogICAgICAgICAgICBjb25zdCBpc0luaXRpYWxQb3MgPSBzb2xkaWVySW5mby5pbml0aWFsLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICAgICAgY29uc3QgaXNGb3J3YXJkUG9zID0gc29sZGllckluZm8uZm9yd2FyZC5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKHNvbGRpZXJJbmZvLmNyb3NzZWRSaXZlcikgew0KICAgICAgICAgICAgICAgIC8vIOi/h+ays+WQjuaVjOaWueWNiuWcuumDveWQiOazlQ0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDov4fmsrPliY3lj6rog73lnKjlhbXkvY3lkozlhbXkvY3liY3mlrkNCiAgICAgICAgICAgICAgICByZXR1cm4gaXNJbml0aWFsUG9zIHx8IGlzRm9yd2FyZFBvczsNCiAgICAgICAgICAgIH0NCiAgICAgICAgZGVmYXVsdDoNCiAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgIH0NCn07DQoNCmNvbnN0IGNoZWNrR2FtZVN0YXRlID0gKGJvYXJkLCB0dXJuLCBwaWVjZXNJbmZvID0gbnVsbCwgYm9hcmRJbmZvID0gbnVsbCkgPT4gew0KICAgIC8vIOS8mOWFiOS9v+eUqOmihOiuoeeul+eahGdhbWVTdGF0ZQ0KICAgIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLmdhbWVTdGF0ZSkgew0KICAgICAgICByZXR1cm4gYm9hcmRJbmZvLmdhbWVTdGF0ZTsNCiAgICB9DQogICAgDQogICAgLy8g5rKh5pyJ6aKE6K6h566X57uT5p6c5pe277yM5omn6KGM5Y6f5aeL6K6h566XDQogICAgbGV0IGhhc01vdmVzID0gZmFsc2U7DQogICAgZm9yKGxldCByPTA7IHI8Uk9XUzsgcisrKSB7DQogICAgICAgIGZvcihsZXQgYz0wOyBjPENPTFM7IGMrKykgew0KICAgICAgICAgICAgaWYgKGJvYXJkW3JdW2NdPy5jb2xvciA9PT0gdHVybikgew0KICAgICAgICAgICAgICAgIGlmIChnZXRWYWxpZE1vdmVzKGJvYXJkLCB7cixjfSkubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgICAgICBoYXNNb3ZlcyA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoaGFzTW92ZXMpIGJyZWFrOw0KICAgIH0NCg0KICAgIGlmIChoYXNNb3ZlcykgcmV0dXJuIHsgc3RhdHVzOiAncGxheWluZycgfTsNCg0KICAgIGNvbnN0IGluQ2hlY2sgPSBpc0NoZWNrKGJvYXJkLCB0dXJuLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgIGNvbnN0IG9wcG9uZW50ID0gdHVybiA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgDQogICAgaWYgKGluQ2hlY2spIHsNCiAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnY2hlY2ttYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgIH0gZWxzZSB7DQogICAgICAgIHJldHVybiB7IHN0YXR1czogJ3N0YWxlbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICB9DQp9Ow0KDQoNCg0KY29uc3QgZ2V0R2FtZVBoYXNlID0gKCkgPT4gew0KICByZXR1cm4gJ29wZW5pbmcnOw0KfTsNCg0KLy8g5a6e5L6L5YyWWm9icmlzdEhhc2hlcg0KY29uc3Qgem9icmlzdEhhc2hlciA9IG5ldyBab2JyaXN0SGFzaGVyKCk7DQoNCi8vIEtlZXAgdGhlIGRlcHRoLTggaXRlcmF0aXZlLWRlZXBlbmluZyB0cmVlIHJlc2lkZW50LiBSZXBsYWNlbWVudCBvbmx5IHJ1bnMNCi8vIGZvciBkZWVwZXIgc2VhcmNoZXMgdGhhdCBleGNlZWQgdGhpcyBjYXBhY2l0eS4NCmNvbnN0IFRUX0RFRkFVTFRfU0laRSA9IE1hdGgucG93KDIsIDIxKTsNCmNvbnN0IFRUX0RFRkFVTFRfRVZJQ1RJT05fQkFUQ0ggPSA1MTI7DQpjb25zdCBUVF9FVklDVElPTl9TQ0FOID0gVFRfREVGQVVMVF9FVklDVElPTl9CQVRDSCAqIDQ7DQoNCmNsYXNzIFRyYW5zcG9zaXRpb25UYWJsZSB7DQogICAgY29uc3RydWN0b3Ioc2l6ZSA9IFRUX0RFRkFVTFRfU0laRSwgZXZpY3Rpb25CYXRjaCA9IFRUX0RFRkFVTFRfRVZJQ1RJT05fQkFUQ0gpIHsNCiAgICAgICAgdGhpcy50YWJsZSA9IG5ldyBNYXAoKTsNCiAgICAgICAgdGhpcy5zaXplID0gc2l6ZTsNCiAgICAgICAgdGhpcy5ldmljdGlvbkJhdGNoID0gZXZpY3Rpb25CYXRjaDsNCiAgICAgICAgdGhpcy5ldmljdGlvbkNhbmRpZGF0ZXMgPSBbXTsNCiAgICAgICAgdGhpcy5oYXNoZXIgPSB6b2JyaXN0SGFzaGVyOw0KICAgICAgICAvLyDnu5/orqHkv6Hmga8NCiAgICAgICAgdGhpcy5zdGF0cyA9IHsNCiAgICAgICAgICAgIGhpdHM6IDAsDQogICAgICAgICAgICBtaXNzZXM6IDAsDQogICAgICAgICAgICBleGFjdEhpdHM6IDAsDQogICAgICAgICAgICBsb3dlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHVwcGVyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgc3RvcmVzOiAwLA0KICAgICAgICAgICAgbHJ1RXZpY3Rpb25zOiAwLA0KICAgICAgICAgICAgZGVwdGhQcmVmZXJyZWRFdmljdGlvbnM6IDAsDQogICAgICAgICAgICBmYWxsYmFja0V2aWN0aW9uczogMCwNCiAgICAgICAgICAgIHVwZGF0ZWRTdG9yZXM6IDAsDQogICAgICAgICAgICByZXRhaW5lZFVwZGF0ZXM6IDAsDQogICAgICAgICAgICBldmljdGlvbkJhdGNoZXM6IDAsDQogICAgICAgICAgICBjbGVhcnM6IDANCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICBzZXRFdmljdGlvbkJhdGNoKGJhdGNoKSB7DQogICAgICAgIHRoaXMuZXZpY3Rpb25CYXRjaCA9IE1hdGgubWF4KDEsIGJhdGNoIHwgMCk7DQogICAgfQ0KICAgIA0KICAgIHN0b3JlKGtleSwgZGVwdGgsIHZhbHVlLCBmbGFnLCBiZXN0TW92ZSA9IG51bGwsIG1vdmVTZXF1ZW5jZSA9IG51bGwpIHsNCiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLnRhYmxlLmdldChrZXkpOw0KICAgICAgICBpZiAoZXhpc3RpbmcpIHsNCiAgICAgICAgICAgIHRoaXMuc3RhdHMudXBkYXRlZFN0b3JlcysrOw0KICAgICAgICAgICAgLy8gQSBkZWVwZXIgZXhhY3QgZW50cnkgZG9taW5hdGVzIGEgc2hhbGxvdyBib3VuZCBmb3IgcmVwbGFjZW1lbnQuDQogICAgICAgICAgICBpZiAoZXhpc3RpbmcuZGVwdGggPiBkZXB0aCAmJiBleGlzdGluZy5mbGFnID09PSAnZXhhY3QnICYmIGZsYWcgIT09ICdleGFjdCcpIHsNCiAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLnJldGFpbmVkVXBkYXRlcysrOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHRoaXMudGFibGUuc2V0KGtleSwgeyBkZXB0aCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlLCBtb3ZlU2VxdWVuY2UgfSk7DQogICAgICAgICAgICB0aGlzLnN0YXRzLnN0b3JlcysrOw0KICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICB9DQoNCiAgICAgICAgaWYgKHRoaXMudGFibGUuc2l6ZSA+PSB0aGlzLnNpemUpIHsNCiAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSB0aGlzLmV2aWN0aW9uQ2FuZGlkYXRlczsNCiAgICAgICAgICAgIGNhbmRpZGF0ZXMubGVuZ3RoID0gMDsNCiAgICAgICAgICAgIGxldCBzY2FubmVkID0gMDsNCiAgICAgICAgICAgIGZvciAoY29uc3QgY2FuZGlkYXRlS2V5IG9mIHRoaXMudGFibGUua2V5cygpKSB7DQogICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5wdXNoKGNhbmRpZGF0ZUtleSk7DQogICAgICAgICAgICAgICAgaWYgKCsrc2Nhbm5lZCA+PSBUVF9FVklDVElPTl9TQ0FOKSBicmVhazsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgY29uc3QgZHJvcENvdW50ID0gTWF0aC5taW4odGhpcy5ldmljdGlvbkJhdGNoLCBjYW5kaWRhdGVzLmxlbmd0aCk7DQogICAgICAgICAgICBsZXQgZHJvcHBlZCA9IDA7DQogICAgICAgICAgICAvLyBQcmVmZXIgcHJlc2VydmluZyBlbnRyaWVzIHRoYXQgc2VhcmNoZWQgZGVlcGVyIHRoYW4gdGhlIGluY29taW5nIG5vZGUuDQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNhbmRpZGF0ZXMubGVuZ3RoICYmIGRyb3BwZWQgPCBkcm9wQ291bnQ7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZUtleSA9IGNhbmRpZGF0ZXNbaV07DQogICAgICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gdGhpcy50YWJsZS5nZXQoY2FuZGlkYXRlS2V5KTsNCiAgICAgICAgICAgICAgICBpZiAoY2FuZGlkYXRlICYmIGNhbmRpZGF0ZS5kZXB0aCA8PSBkZXB0aCkgew0KICAgICAgICAgICAgICAgICAgICB0aGlzLnRhYmxlLmRlbGV0ZShjYW5kaWRhdGVLZXkpOw0KICAgICAgICAgICAgICAgICAgICBkcm9wcGVkKys7DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMuZGVwdGhQcmVmZXJyZWRFdmljdGlvbnMrKzsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICAvLyBUaGUgdGFibGUgbWF5IGNvbnRhaW4gb25seSBkZWVwZXIgZW50cmllcyBpbiB0aGUgc2NhbiB3aW5kb3cuDQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNhbmRpZGF0ZXMubGVuZ3RoICYmIGRyb3BwZWQgPCBkcm9wQ291bnQ7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZUtleSA9IGNhbmRpZGF0ZXNbaV07DQogICAgICAgICAgICAgICAgaWYgKHRoaXMudGFibGUuZGVsZXRlKGNhbmRpZGF0ZUtleSkpIHsNCiAgICAgICAgICAgICAgICAgICAgZHJvcHBlZCsrOw0KICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLmZhbGxiYWNrRXZpY3Rpb25zKys7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgdGhpcy5zdGF0cy5scnVFdmljdGlvbnMgKz0gZHJvcHBlZDsNCiAgICAgICAgICAgIHRoaXMuc3RhdHMuZXZpY3Rpb25CYXRjaGVzKys7DQogICAgICAgIH0NCiAgICAgICAgdGhpcy50YWJsZS5zZXQoa2V5LCB7IGRlcHRoLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUsIG1vdmVTZXF1ZW5jZSB9KTsNCiAgICAgICAgdGhpcy5zdGF0cy5zdG9yZXMrKzsNCiAgICB9DQogICAgDQogICAgcmV0cmlldmUoa2V5KSB7DQogICAgICAgIGNvbnN0IGVudHJ5ID0gdGhpcy50YWJsZS5nZXQoa2V5KSB8fCBudWxsOw0KICAgICAgICBpZiAoZW50cnkpIHsNCiAgICAgICAgICAgIHRoaXMuc3RhdHMuaGl0cysrOw0KICAgICAgICAgICAgLy8g57uf6K6h5LiN5ZCM57G75Z6L55qE5ZG95LitDQogICAgICAgICAgICBzd2l0Y2ggKGVudHJ5LmZsYWcpIHsNCiAgICAgICAgICAgICAgICBjYXNlICdleGFjdCc6DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMuZXhhY3RIaXRzKys7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIGNhc2UgJ2xvd2VyYm91bmQnOg0KICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLmxvd2VyYm91bmRIaXRzKys7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIGNhc2UgJ3VwcGVyYm91bmQnOg0KICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLnVwcGVyYm91bmRIaXRzKys7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgdGhpcy5zdGF0cy5taXNzZXMrKzsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gZW50cnk7DQogICAgfQ0KICAgIA0KICAgIGNsZWFyKCkgew0KICAgICAgICB0aGlzLnRhYmxlLmNsZWFyKCk7DQogICAgICAgIHRoaXMuc3RhdHMuY2xlYXJzKys7DQogICAgfQ0KICAgIA0KICAgIC8vIOiOt+WPlue7n+iuoeS/oeaBr+W5tuiuoeeul+WRveS4reeOhw0KICAgIGdldFN0YXRzKCkgew0KICAgICAgICBjb25zdCB0b3RhbEFjY2Vzc2VzID0gdGhpcy5zdGF0cy5oaXRzICsgdGhpcy5zdGF0cy5taXNzZXM7DQogICAgICAgIGNvbnN0IGhpdFJhdGUgPSB0b3RhbEFjY2Vzc2VzID4gMCA/ICh0aGlzLnN0YXRzLmhpdHMgLyB0b3RhbEFjY2Vzc2VzICogMTAwKS50b0ZpeGVkKDIpIDogMDsNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIC4uLnRoaXMuc3RhdHMsDQogICAgICAgICAgICBldmljdGlvbkJhdGNoOiB0aGlzLmV2aWN0aW9uQmF0Y2gsDQogICAgICAgICAgICB0b3RhbEFjY2Vzc2VzLA0KICAgICAgICAgICAgaGl0UmF0ZSwNCiAgICAgICAgICAgIGN1cnJlbnRTaXplOiB0aGlzLnRhYmxlLnNpemUsDQogICAgICAgICAgICBtYXhTaXplOiB0aGlzLnNpemUsDQogICAgICAgICAgICBmaWxsUGVyY2VudGFnZTogKHRoaXMudGFibGUuc2l6ZSAvIHRoaXMuc2l6ZSAqIDEwMCkudG9GaXhlZCgyKQ0KICAgICAgICB9Ow0KICAgIH0NCiAgICANCiAgICAvLyDph43nva7nu5/orqHkv6Hmga8NCiAgICByZXNldFN0YXRzKCkgew0KICAgICAgICB0aGlzLnN0YXRzID0gew0KICAgICAgICAgICAgaGl0czogMCwNCiAgICAgICAgICAgIG1pc3NlczogMCwNCiAgICAgICAgICAgIGV4YWN0SGl0czogMCwNCiAgICAgICAgICAgIGxvd2VyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgdXBwZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICBzdG9yZXM6IDAsDQogICAgICAgICAgICBscnVFdmljdGlvbnM6IDAsDQogICAgICAgICAgICBkZXB0aFByZWZlcnJlZEV2aWN0aW9uczogMCwNCiAgICAgICAgICAgIGZhbGxiYWNrRXZpY3Rpb25zOiAwLA0KICAgICAgICAgICAgdXBkYXRlZFN0b3JlczogMCwNCiAgICAgICAgICAgIHJldGFpbmVkVXBkYXRlczogMCwNCiAgICAgICAgICAgIGV2aWN0aW9uQmF0Y2hlczogMCwNCiAgICAgICAgICAgIGNsZWFyczogMA0KICAgICAgICB9Ow0KICAgIH0NCn0NCg0KLy8g5oCn6IO957uf6K6hDQpsZXQgcGVyZlN0YXRzID0gew0KICAgIGV2YWx1YXRlQm9hcmRDb3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sDQogICAgcHJlcGFyZVNlYXJjaEluZm9Db3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sDQogICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnQ6IHsgcmVkOiAwLCBibGFjazogMCB9LA0KICAgIGFscGhhQmV0YUNhbGxzOiAwLCAgLy8g5oC76LCD55So5qyh5pWwDQogICAgbm9kZXNTZWFyY2hlZDoge30sIC8vIOaMiea3seW6pue7n+iuoeaQnOe0oueahOiKgueCueaVsA0KICAgIG1vdmVzR2VuZXJhdGVkOiB7fSwgLy8g5oyJ5rex5bqm57uf6K6h55Sf5oiQ55qE6LWw5rOV5pWwDQogICAgY3V0b2Zmczoge30sIC8vIOaMiea3seW6pue7n+iuoeWJquaeneasoeaVsAogICAgbW92ZU9yZGVyaW5nOiB7CiAgICAgICAgdG9wTW92ZVNvdXJjZXM6IHsgdHQ6IDAsIGtpbGxlcjogMCwgY2FwdHVyZTogMCwgcXVpZXQ6IDAgfSwKICAgICAgICBmaXJzdExlZ2FsTW92ZXNCeURlcHRoOiB7fSwKICAgICAgICBmaXJzdExlZ2FsQ3V0b2Zmc0J5RGVwdGg6IHt9LAogICAgICAgIGZpcnN0TGVnYWxNb3ZlSW5kZXhUb3RhbEJ5RGVwdGg6IHt9CiAgICB9LAogICAgLy8g5ZCI5rOV5oCn6Lev5b6E77ya5Lyq5ZCI5rOV55Sf5oiQ6YeP44CB6K+V6LWw5ZCI5rOV5oCn5qOA5rWL44CB6Z2e5rOV6Lez6L+H44CB5a6e6ZmF6L+b5YWl5pCc57Si55qE5ZCI5rOV552ADQogICAgcHNldWRvTW92ZXNHZW5lcmF0ZWQ6IDAsDQogICAgbGVnYWxpdHlDaGVja3M6IDAsCiAgICBraW5nU2FmZXR5RnVsbENoZWNrczogMCwKICAgIGtpbmdTYWZldHlGYXN0U2tpcHM6IDAsCiAgICBraW5nU2FmZXR5VmVyaWZpY2F0aW9uRmFpbHVyZXM6IDAsCiAgICBpbGxlZ2FsTW92ZXNTa2lwcGVkOiAwLA0KICAgIGxlZ2FsTW92ZXNTZWFyY2hlZDogMCwNCiAgICAvLyBab2JyaXN077ya5YWo55uY6YeN566X5qyh5pWwIC8g5aKe6YeP5pu05paw5qyh5pWwIC8g5qCh6aqM5LiN5LiA6Ie077yI5LuFIHZlcmlmeSDmqKHlvI/vvIkNCiAgICBmdWxsSGFzaENvdW50OiAwLA0KICAgIGluY3JlbWVudGFsSGFzaFVwZGF0ZXM6IDAsDQogICAgaGFzaE1pc21hdGNoZXM6IDAsDQogICAgZmFzdExlYWZFdmFsQ291bnQ6IDAsDQogICAgZmFzdExlYWZFdmFsTXM6IDAsDQogICAgcHJlcGFyZUNoZWNrTXM6IDAsDQogICAgcHJlcGFyZU1vdmVHZW5NczogMCwNCiAgICBzb3J0TW92ZXNDb3VudDogMCwNCiAgICBzb3J0TW92ZXNNczogMCwNCiAgICBsZWdhbGl0eUNoZWNrTXM6IDAsDQogICAgY2FwdHVyZUdlbkNvdW50OiAwLA0KICAgIGNhcHR1cmVHZW5NczogMCwNCiAgICBxdWllc2NlbmNlQ2FsbHM6IDAsDQogICAgcXVpZXNjZW5jZUNhcHR1cmVNb3ZlczogMCwNCiAgICBzdGF0aWNFdmFsQ2FjaGVIaXRzOiAwLAogICAgc3RhdGljRXZhbENhY2hlTWlzc2VzOiAwLAogICAgcHZzUHJvYmVzOiAwLAogICAgcHZzUmVzZWFyY2hlczogMCwKICAgIHB2c1Byb2JlTm9kZXM6IDAsCiAgICBwdnNSZXNlYXJjaE5vZGVzOiAwLAogICAgZXZhbHVhdGVCb2FyZE1zOiAwLA0KICAgIHByZXBhcmVTZWFyY2hJbmZvTXM6IDAsDQogICAgc3RhcnRUaW1lOiBEYXRlLm5vdygpDQp9Ow0KDQovLyDph43nva7nu5/orqHvvIjmr4/mrKHmkJzntKLlvIDlp4vml7bosIPnlKjvvIkNCmNvbnN0IHJlc2V0UGVyZlN0YXRzID0gKCkgPT4gew0KICAgIGFjdGl2ZVNlYXJjaFBpZWNlU3RhdGUgPSBudWxsOw0KICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsNCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscyA9IDA7DQogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWQgPSB7fTsNCiAgICBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWQgPSB7fTsNCiAgICBwZXJmU3RhdHMuY3V0b2ZmcyA9IHt9OwogICAgcGVyZlN0YXRzLm1vdmVPcmRlcmluZyA9IHsKICAgICAgICB0b3BNb3ZlU291cmNlczogeyB0dDogMCwga2lsbGVyOiAwLCBjYXB0dXJlOiAwLCBxdWlldDogMCB9LAogICAgICAgIGZpcnN0TGVnYWxNb3Zlc0J5RGVwdGg6IHt9LAogICAgICAgIGZpcnN0TGVnYWxDdXRvZmZzQnlEZXB0aDoge30sCiAgICAgICAgZmlyc3RMZWdhbE1vdmVJbmRleFRvdGFsQnlEZXB0aDoge30KICAgIH07CiAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgPSAwOw0KICAgIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcyA9IDA7CiAgICBwZXJmU3RhdHMua2luZ1NhZmV0eUZ1bGxDaGVja3MgPSAwOwogICAgcGVyZlN0YXRzLmtpbmdTYWZldHlGYXN0U2tpcHMgPSAwOwogICAgcGVyZlN0YXRzLmtpbmdTYWZldHlWZXJpZmljYXRpb25GYWlsdXJlcyA9IDA7CiAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCA9IDA7DQogICAgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCA9IDA7DQogICAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQgPSAwOw0KICAgIHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzID0gMDsNCiAgICBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMgPSAwOw0KICAgIHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxDb3VudCA9IDA7DQogICAgcGVyZlN0YXRzLmZhc3RMZWFmRXZhbE1zID0gMDsNCiAgICBwZXJmU3RhdHMucHJlcGFyZUNoZWNrTXMgPSAwOw0KICAgIHBlcmZTdGF0cy5wcmVwYXJlTW92ZUdlbk1zID0gMDsNCiAgICBwZXJmU3RhdHMuc29ydE1vdmVzQ291bnQgPSAwOw0KICAgIHBlcmZTdGF0cy5zb3J0TW92ZXNNcyA9IDA7DQogICAgcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tNcyA9IDA7DQogICAgcGVyZlN0YXRzLmNhcHR1cmVHZW5Db3VudCA9IDA7DQogICAgcGVyZlN0YXRzLmNhcHR1cmVHZW5NcyA9IDA7DQogICAgcGVyZlN0YXRzLnF1aWVzY2VuY2VDYWxscyA9IDA7DQogICAgcGVyZlN0YXRzLnF1aWVzY2VuY2VDYXB0dXJlTW92ZXMgPSAwOw0KICAgIHBlcmZTdGF0cy5zdGF0aWNFdmFsQ2FjaGVIaXRzID0gMDsKICAgIHBlcmZTdGF0cy5zdGF0aWNFdmFsQ2FjaGVNaXNzZXMgPSAwOwogICAgcGVyZlN0YXRzLnB2c1Byb2JlcyA9IDA7CiAgICBwZXJmU3RhdHMucHZzUmVzZWFyY2hlcyA9IDA7CiAgICBwZXJmU3RhdHMucHZzUHJvYmVOb2RlcyA9IDA7CiAgICBwZXJmU3RhdHMucHZzUmVzZWFyY2hOb2RlcyA9IDA7CiAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zID0gMDsNCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcyA9IDA7DQogICAgcGVyZlN0YXRzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7DQp9Ow0KDQpjb25zdCBzbmFwc2hvdFBlcmZTdGF0cyA9ICgpID0+IHsNCiAgICBjb25zdCBlbGFwc2VkID0gRGF0ZS5ub3coKSAtIHBlcmZTdGF0cy5zdGFydFRpbWU7DQogICAgY29uc3QgdHRTdGF0cyA9IHRyYW5zcG9zaXRpb25UYWJsZS5nZXRTdGF0cygpOw0KICAgIGNvbnN0IGRlcHRocyA9IE9iamVjdC5rZXlzKHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkKS5zb3J0KChhLCBiKSA9PiBOdW1iZXIoYSkgLSBOdW1iZXIoYikpOw0KICAgIGNvbnN0IGJ5RGVwdGggPSB7fTsNCiAgICBmb3IgKGNvbnN0IGQgb2YgZGVwdGhzKSB7DQogICAgICAgIGJ5RGVwdGhbZF0gPSB7DQogICAgICAgICAgICBub2RlczogcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0gfHwgMCwNCiAgICAgICAgICAgIG1vdmVzOiBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gfHwgMCwNCiAgICAgICAgICAgIGN1dG9mZnM6IHBlcmZTdGF0cy5jdXRvZmZzW2RdIHx8IDANCiAgICAgICAgfTsNCiAgICB9DQogICAgcmV0dXJuIHsNCiAgICAgICAgZWxhcHNlZE1zOiBlbGFwc2VkLA0KICAgICAgICBwcm9maWxlOiBTRUFSQ0hfUFJPRklMRSwNCiAgICAgICAgZXZhbHVhdGVCb2FyZDogeyAuLi5wZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50IH0sDQogICAgICAgIHByZXBhcmVTZWFyY2hJbmZvOiB7IC4uLnBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50IH0sDQogICAgICAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlczogeyAuLi5wZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnQgfSwNCiAgICAgICAgYWxwaGFCZXRhQ2FsbHM6IHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscywNCiAgICAgICAgcHNldWRvTW92ZXNHZW5lcmF0ZWQ6IHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCwNCiAgICAgICAgbGVnYWxpdHlDaGVja3M6IHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcywKICAgICAgICBraW5nU2FmZXR5OiBTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTID8gewogICAgICAgICAgICBmYXN0UGF0aEVuYWJsZWQ6IFNFQVJDSF9FTkFCTEVfS0lOR19TQUZFVFlfRkFTVF9QQVRILAogICAgICAgICAgICBmdWxsQ2hlY2tzOiBwZXJmU3RhdHMua2luZ1NhZmV0eUZ1bGxDaGVja3MsCiAgICAgICAgICAgIGZhc3RTa2lwczogcGVyZlN0YXRzLmtpbmdTYWZldHlGYXN0U2tpcHMsCiAgICAgICAgICAgIHZlcmlmaWNhdGlvbkZhaWx1cmVzOiBwZXJmU3RhdHMua2luZ1NhZmV0eVZlcmlmaWNhdGlvbkZhaWx1cmVzLAogICAgICAgICAgICBza2lwUmF0ZTogcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzCiAgICAgICAgICAgICAgICA/IE51bWJlcigocGVyZlN0YXRzLmtpbmdTYWZldHlGYXN0U2tpcHMgLyBwZXJmU3RhdHMubGVnYWxpdHlDaGVja3MgKiAxMDApLnRvRml4ZWQoMikpCiAgICAgICAgICAgICAgICA6IDAKICAgICAgICB9IDogbnVsbCwKICAgICAgICBpbGxlZ2FsTW92ZXNTa2lwcGVkOiBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCwNCiAgICAgICAgbGVnYWxNb3Zlc1NlYXJjaGVkOiBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkLA0KICAgICAgICBmdWxsSGFzaENvdW50OiBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCwNCiAgICAgICAgaW5jcmVtZW50YWxIYXNoVXBkYXRlczogcGVyZlN0YXRzLmluY3JlbWVudGFsSGFzaFVwZGF0ZXMsDQogICAgICAgIGhhc2hNaXNtYXRjaGVzOiBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMsDQogICAgICAgIGZhc3RMZWFmRXZhbENvdW50OiBwZXJmU3RhdHMuZmFzdExlYWZFdmFsQ291bnQsDQogICAgICAgIGZhc3RMZWFmRXZhbE1zOiBwZXJmU3RhdHMuZmFzdExlYWZFdmFsTXMsDQogICAgICAgIHByZXBhcmVDaGVja01zOiBwZXJmU3RhdHMucHJlcGFyZUNoZWNrTXMsDQogICAgICAgIHByZXBhcmVNb3ZlR2VuTXM6IHBlcmZTdGF0cy5wcmVwYXJlTW92ZUdlbk1zLA0KICAgICAgICBzb3J0TW92ZXNDb3VudDogcGVyZlN0YXRzLnNvcnRNb3Zlc0NvdW50LA0KICAgICAgICBzb3J0TW92ZXNNczogcGVyZlN0YXRzLnNvcnRNb3Zlc01zLA0KICAgICAgICBsZWdhbGl0eUNoZWNrTXM6IHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrTXMsDQogICAgICAgIGNhcHR1cmVHZW5Db3VudDogcGVyZlN0YXRzLmNhcHR1cmVHZW5Db3VudCwNCiAgICAgICAgY2FwdHVyZUdlbk1zOiBwZXJmU3RhdHMuY2FwdHVyZUdlbk1zLA0KICAgICAgICBxdWllc2NlbmNlQ2FsbHM6IHBlcmZTdGF0cy5xdWllc2NlbmNlQ2FsbHMsDQogICAgICAgIHF1aWVzY2VuY2VDYXB0dXJlTW92ZXM6IHBlcmZTdGF0cy5xdWllc2NlbmNlQ2FwdHVyZU1vdmVzLA0KICAgICAgICBzdGF0aWNFdmFsQ2FjaGVIaXRzOiBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlSGl0cywKICAgICAgICBzdGF0aWNFdmFsQ2FjaGVNaXNzZXM6IHBlcmZTdGF0cy5zdGF0aWNFdmFsQ2FjaGVNaXNzZXMsCiAgICAgICAgcHZzOiBTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTID8gewogICAgICAgICAgICBlbmFibGVkOiBTRUFSQ0hfRU5BQkxFX05PTl9ST09UX1BWUywKICAgICAgICAgICAgcHJvYmVzOiBwZXJmU3RhdHMucHZzUHJvYmVzLAogICAgICAgICAgICByZXNlYXJjaGVzOiBwZXJmU3RhdHMucHZzUmVzZWFyY2hlcywKICAgICAgICAgICAgcmVzZWFyY2hSYXRlOiBwZXJmU3RhdHMucHZzUHJvYmVzCiAgICAgICAgICAgICAgICA/IE51bWJlcigocGVyZlN0YXRzLnB2c1Jlc2VhcmNoZXMgLyBwZXJmU3RhdHMucHZzUHJvYmVzICogMTAwKS50b0ZpeGVkKDIpKQogICAgICAgICAgICAgICAgOiAwLAogICAgICAgICAgICBwcm9iZU5vZGVzOiBwZXJmU3RhdHMucHZzUHJvYmVOb2RlcywKICAgICAgICAgICAgcmVzZWFyY2hOb2RlczogcGVyZlN0YXRzLnB2c1Jlc2VhcmNoTm9kZXMKICAgICAgICB9IDogbnVsbCwKICAgICAgICBldmFsdWF0ZUJvYXJkTXM6IHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMsDQogICAgICAgIHByZXBhcmVTZWFyY2hJbmZvTXM6IHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zLAogICAgICAgIG1vdmVPcmRlcmluZzogU0VBUkNIX0NPTExFQ1RfTUVUUklDUyA/IHsKICAgICAgICAgICAgdG9wTW92ZVNvdXJjZXM6IHsgLi4ucGVyZlN0YXRzLm1vdmVPcmRlcmluZy50b3BNb3ZlU291cmNlcyB9LAogICAgICAgICAgICBieURlcHRoOiBPYmplY3QuZnJvbUVudHJpZXMoZGVwdGhzLm1hcCgoZCkgPT4gewogICAgICAgICAgICAgICAgY29uc3QgZmlyc3RMZWdhbE1vdmVzID0gcGVyZlN0YXRzLm1vdmVPcmRlcmluZy5maXJzdExlZ2FsTW92ZXNCeURlcHRoW2RdIHx8IDA7CiAgICAgICAgICAgICAgICBjb25zdCBmaXJzdExlZ2FsQ3V0b2ZmcyA9IHBlcmZTdGF0cy5tb3ZlT3JkZXJpbmcuZmlyc3RMZWdhbEN1dG9mZnNCeURlcHRoW2RdIHx8IDA7CiAgICAgICAgICAgICAgICByZXR1cm4gW2QsIHsKICAgICAgICAgICAgICAgICAgICBmaXJzdExlZ2FsTW92ZXMsCiAgICAgICAgICAgICAgICAgICAgZmlyc3RMZWdhbEN1dG9mZnMsCiAgICAgICAgICAgICAgICAgICAgZmlyc3RMZWdhbEN1dG9mZlJhdGU6IGZpcnN0TGVnYWxNb3ZlcwogICAgICAgICAgICAgICAgICAgICAgICA/IE51bWJlcigoZmlyc3RMZWdhbEN1dG9mZnMgLyBmaXJzdExlZ2FsTW92ZXMgKiAxMDApLnRvRml4ZWQoMikpCiAgICAgICAgICAgICAgICAgICAgICAgIDogMCwKICAgICAgICAgICAgICAgICAgICBhdmVyYWdlRmlyc3RMZWdhbE1vdmVJbmRleDogZmlyc3RMZWdhbE1vdmVzCiAgICAgICAgICAgICAgICAgICAgICAgID8gTnVtYmVyKChwZXJmU3RhdHMubW92ZU9yZGVyaW5nLmZpcnN0TGVnYWxNb3ZlSW5kZXhUb3RhbEJ5RGVwdGhbZF0gLyBmaXJzdExlZ2FsTW92ZXMpLnRvRml4ZWQoMikpCiAgICAgICAgICAgICAgICAgICAgICAgIDogMAogICAgICAgICAgICAgICAgfV07CiAgICAgICAgICAgIH0pKQogICAgICAgIH0gOiBudWxsLAogICAgICAgIHR0OiB0dFN0YXRzLAogICAgICAgIGJ5RGVwdGgNCiAgICB9Ow0KfTsNCg0KLy8g5omT5Y2w57uf6K6h5L+h5oGvDQpjb25zdCBsb2dQZXJmU3RhdHMgPSAoY3VycmVudFBsYXllcikgPT4gew0KICAgIGNvbnN0IHNuYXAgPSBzbmFwc2hvdFBlcmZTdGF0cygpOw0KICAgIGNvbnNvbGUubG9nKGBTZWFyY2ggc3RhdHMgKCR7Y3VycmVudFBsYXllcn0pOiAke3NuYXAuZWxhcHNlZE1zfW1zLCBub2Rlcz0ke3NuYXAuYWxwaGFCZXRhQ2FsbHN9LCBsZWdhbD0ke3NuYXAubGVnYWxNb3Zlc1NlYXJjaGVkfSwgbGVhdmVzPSR7c25hcC5mYXN0TGVhZkV2YWxDb3VudH1gKTsNCiAgICBjb25zb2xlLmxvZyhgVFQ6ICR7c25hcC50dC5oaXRzfS8ke3NuYXAudHQubWlzc2VzfSAoJHtzbmFwLnR0LmhpdFJhdGV9JSksIHN0b3Jlcz0ke3NuYXAudHQuc3RvcmVzfSwgc2l6ZT0ke3NuYXAudHQuY3VycmVudFNpemV9YCk7DQp9Ow0KDQpjb25zdCB0cmFuc3Bvc2l0aW9uVGFibGUgPSBuZXcgVHJhbnNwb3NpdGlvblRhYmxlKCk7DQoNCi8vIOWPtuivhOS8sOe8k+WtmO+8iOWujOaVtOW9ouWKv+WIhu+8ie+8m+avj+asoSBnZXRCZXN0TW92ZSDmuIXnqboNCmNvbnN0IEVWQUxfQ0FDSEVfTUFYID0gTWF0aC5wb3coMiwgMTgpOw0KY29uc3QgZXZhbENhY2hlID0gbmV3IE1hcCgpOw0KY29uc3QgY2xlYXJFdmFsQ2FjaGUgPSAoKSA9PiB7DQogICAgZXZhbENhY2hlLmNsZWFyKCk7DQp9Ow0KDQovLyDliarmnp3lvIDlhbPvvJrlrozmlbTor4TkvLDkuIvoi6XlvIDlsYDlh7rlup/mo4vliJnlhYjlhbPvvIzkv53mo4vlipvlho3ph43moIflrpoNCmNvbnN0IFNFQVJDSF9RVUlFU0NFTkNFX0RFUFRIID0gMjsKY29uc3QgU0VBUkNIX05VTExfV0lORE9XX0VQUyA9IDFlLTY7CmxldCBTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTID0gZmFsc2U7CmxldCBTRUFSQ0hfRU5BQkxFX05PTl9ST09UX1BWUyA9IGZhbHNlOwpsZXQgU0VBUkNIX0VOQUJMRV9LSU5HX1NBRkVUWV9GQVNUX1BBVEggPSB0cnVlOwpsZXQgU0VBUkNIX1ZFUklGWV9LSU5HX1NBRkVUWV9GQVNUX1BBVEggPSBmYWxzZTsKDQovLyDnnYDms5XlkIjms5XmgKfvvJp0cnVlPeaQnOe0ouWGheivlei1sOaXtuajgOa1i++8iOWPr+i3s+i/h+WJquaeneacquinpuWPiuedgOazle+8ie+8m2ZhbHNlPXByZXBhcmUg5pe25YWo6YePIGZpbHRlckxlZ2FsTW92ZXPvvIjml6fot6/lvoTvvIkNCmxldCBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFID0gdHJ1ZTsNCg0KLy8gWm9icmlzdC9UVO+8mnRydWU95pCc57Si5YaF5aKe6YeP57u05oqk5bGA6Z2i5ZOI5biMICsg5pWw5YC8IFRUIGtlee+8m2ZhbHNlPeavj+iKgueCueWFqOebmCBoYXNoICsg5a2X56ym5LiyIGtlee+8iOaXp+i3r+W+hO+8jOS+v+S6jiBBL0LvvIkNCi8vIOiwg+ivle+8muWinumHj+WQjuS4juWFqOebmCBoYXNoIOavlOWvue+8iOS7heagoemqjOiEmuacrOW8gOWQr++8jOato+W8j+aQnOe0ouWFs+mXre+8iQ0KDQovLyDmkJzntKLlkK/lj5HvvJrmnYDmo4vooaggKyDljoblj7LlkK/lj5HvvIjmr4/mrKEgZ2V0QmVzdE1vdmUg6YeN572u77yJDQpsZXQga2lsbGVyTW92ZXMgPSBbXTsNCmxldCBoaXN0b3J5VGFibGUgPSBudWxsOw0KDQpjb25zdCByZXNldFNlYXJjaEhldXJpc3RpY3MgPSAobWF4RGVwdGgpID0+IHsNCiAgICBraWxsZXJNb3ZlcyA9IEFycmF5KG1heERlcHRoICsgMikuZmlsbChudWxsKS5tYXAoKCkgPT4gW251bGwsIG51bGxdKTsNCiAgICBoaXN0b3J5VGFibGUgPSBuZXcgSW50MzJBcnJheShSRUxfU1FVQVJFUyA8PCA3KTsNCn07DQoNCmNvbnN0IGlzU2FtZU1vdmUgPSAoYSwgYikgPT4NCiAgICBhICE9IG51bGwgJiYgYiAhPSBudWxsICYmDQogICAgbW92ZUZyb21TcShhKSA9PT0gbW92ZUZyb21TcShiKSAmJg0KICAgIG1vdmVUb1NxKGEpID09PSBtb3ZlVG9TcShiKTsNCg0KY29uc3Qgc3RvcmVLaWxsZXJNb3ZlID0gKGRlcHRoLCBtb3ZlKSA9PiB7DQogICAgaWYgKGRlcHRoIDwgMCB8fCBkZXB0aCA+PSBraWxsZXJNb3Zlcy5sZW5ndGggfHwgIW1vdmUpIHJldHVybjsNCiAgICBjb25zdCBzbG90ID0ga2lsbGVyTW92ZXNbZGVwdGhdOw0KICAgIGlmIChpc1NhbWVNb3ZlKHNsb3RbMF0sIG1vdmUpKSByZXR1cm47DQogICAgc2xvdFsxXSA9IHNsb3RbMF07DQogICAgc2xvdFswXSA9IGlzRW5jb2RlZE1vdmUobW92ZSkgPyBtb3ZlIDogZW5jb2RlTW92ZShtb3ZlLmZyb20sIG1vdmUudG8pOw0KfTsNCg0KY29uc3QgYWRkSGlzdG9yeVNjb3JlID0gKG1vdmUsIGRlcHRoKSA9PiB7DQogICAgaWYgKCFoaXN0b3J5VGFibGUgfHwgIW1vdmUpIHJldHVybjsNCiAgICBjb25zdCBrZXkgPSAobW92ZUZyb21TcShtb3ZlKSA8PCA3KSB8IG1vdmVUb1NxKG1vdmUpOw0KICAgIGhpc3RvcnlUYWJsZVtrZXldICs9IGRlcHRoICogZGVwdGg7DQp9Ow0KDQpjb25zdCBnZXRIaXN0b3J5U2NvcmUgPSAobW92ZSkgPT4gewogICAgaWYgKCFoaXN0b3J5VGFibGUgfHwgIW1vdmUpIHJldHVybiAwOwogICAgcmV0dXJuIGhpc3RvcnlUYWJsZVsobW92ZUZyb21TcShtb3ZlKSA8PCA3KSB8IG1vdmVUb1NxKG1vdmUpXTsKfTsKCmNvbnN0IHJlY29yZFRvcE1vdmVTb3VyY2UgPSAoZGVwdGgsIGJvYXJkLCBtb3ZlLCB0dE1vdmUsIGtpbGxlcnMpID0+IHsKICAgIGNvbnN0IHNvdXJjZXMgPSBwZXJmU3RhdHMubW92ZU9yZGVyaW5nLnRvcE1vdmVTb3VyY2VzOwogICAgaWYgKGlzU2FtZU1vdmUobW92ZSwgdHRNb3ZlKSkgc291cmNlcy50dCsrOwogICAgZWxzZSBpZiAoaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzWzBdKSB8fCBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNbMV0pKSBzb3VyY2VzLmtpbGxlcisrOwogICAgZWxzZSBpZiAoYm9hcmRbbW92ZVRvUihtb3ZlKV1bbW92ZVRvQyhtb3ZlKV0pIHNvdXJjZXMuY2FwdHVyZSsrOwogICAgZWxzZSBzb3VyY2VzLnF1aWV0Kys7Cn07Cgpjb25zdCByZWNvcmRGaXJzdExlZ2FsTW92ZSA9IChkZXB0aCwgbW92ZUluZGV4KSA9PiB7CiAgICBjb25zdCBvcmRlcmluZyA9IHBlcmZTdGF0cy5tb3ZlT3JkZXJpbmc7CiAgICBvcmRlcmluZy5maXJzdExlZ2FsTW92ZXNCeURlcHRoW2RlcHRoXSA9IChvcmRlcmluZy5maXJzdExlZ2FsTW92ZXNCeURlcHRoW2RlcHRoXSB8fCAwKSArIDE7CiAgICBvcmRlcmluZy5maXJzdExlZ2FsTW92ZUluZGV4VG90YWxCeURlcHRoW2RlcHRoXSA9CiAgICAgICAgKG9yZGVyaW5nLmZpcnN0TGVnYWxNb3ZlSW5kZXhUb3RhbEJ5RGVwdGhbZGVwdGhdIHx8IDApICsgbW92ZUluZGV4Owp9OwoKY29uc3QgcmVjb3JkRmlyc3RMZWdhbEN1dG9mZiA9IChkZXB0aCkgPT4gewogICAgY29uc3QgY3V0b2ZmcyA9IHBlcmZTdGF0cy5tb3ZlT3JkZXJpbmcuZmlyc3RMZWdhbEN1dG9mZnNCeURlcHRoOwogICAgY3V0b2Zmc1tkZXB0aF0gPSAoY3V0b2Zmc1tkZXB0aF0gfHwgMCkgKyAxOwp9OwoNCi8vIFdvcmtlciBtZXNzYWdlIGhhbmRsaW5nDQppZiAodHlwZW9mIHNlbGYgIT09ICd1bmRlZmluZWQnKSB7DQogICAgc2VsZi5vbm1lc3NhZ2UgPSBmdW5jdGlvbihlKSB7DQogICAgY29uc3QgeyB0eXBlLCBwYXlsb2FkIH0gPSBlLmRhdGE7DQogICAgDQogICAgc3dpdGNoICh0eXBlKSB7ICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ1NFQVJDSCc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHNlYXJjaEJvYXJkLCB0dXJuOiBzZWFyY2hUdXJuLCBkZXB0aDogc2VhcmNoRGVwdGgsIGdhbWVJZCwgb3BlbmluZ0Jvb2tFbmFibGVkOiBzZWFyY2hPcGVuaW5nQm9va0VuYWJsZWQgPSB0cnVlLCBwbHk6IHNlYXJjaFBseSA9IDAsIGVuYWJsZVRpbWVMaW1pdDogc2VhcmNoRW5hYmxlVGltZUxpbWl0ID0gZmFsc2UsIGV4YWN0Um9vdFNjb3Jlczogc2VhcmNoRXhhY3RSb290U2NvcmVzID0gZmFsc2UsIHByb2ZpbGU6IHNlYXJjaFByb2ZpbGUsIG1ldHJpY3M6IHNlYXJjaE1ldHJpY3MgPSBmYWxzZSwgbm9uUm9vdFB2czogc2VhcmNoTm9uUm9vdFB2cyA9IGZhbHNlLCBraW5nU2FmZXR5RmFzdFBhdGg6IHNlYXJjaEtpbmdTYWZldHlGYXN0UGF0aCA9IHRydWUsIHZlcmlmeUtpbmdTYWZldHlGYXN0UGF0aDogc2VhcmNoVmVyaWZ5S2luZ1NhZmV0eUZhc3RQYXRoID0gZmFsc2UsIGNvbGxlY3RNb3ZlU2VxdWVuY2U6IHNlYXJjaENvbGxlY3RNb3ZlU2VxdWVuY2UgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIFNFQVJDSF9QUk9GSUxFID0gISFzZWFyY2hQcm9maWxlOwogICAgICAgICAgICBTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTID0gISFzZWFyY2hNZXRyaWNzOwogICAgICAgICAgICBTRUFSQ0hfRU5BQkxFX05PTl9ST09UX1BWUyA9ICEhc2VhcmNoTm9uUm9vdFB2czsKICAgICAgICAgICAgU0VBUkNIX0VOQUJMRV9LSU5HX1NBRkVUWV9GQVNUX1BBVEggPSAhIXNlYXJjaEtpbmdTYWZldHlGYXN0UGF0aDsKICAgICAgICAgICAgU0VBUkNIX1ZFUklGWV9LSU5HX1NBRkVUWV9GQVNUX1BBVEggPSAhIXNlYXJjaFZlcmlmeUtpbmdTYWZldHlGYXN0UGF0aDsKICAgICAgICAgICAgLy8gU2V0IG9wZW5pbmcgYm9vayBlbmFibGVkIHN0YXR1cw0KICAgICAgICAgICAgb3BlbmluZ0Jvb2suc2V0RW5hYmxlZChzZWFyY2hPcGVuaW5nQm9va0VuYWJsZWQpOw0KICAgICAgICAgICAgLy8g6K6w5b2V5pCc57Si5byA5aeL5pe26Ze0DQogICAgICAgICAgICBjb25zdCBzdGFydFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKTsNCiAgICAgICAgICAgIC8vIOaJp+ihjOaQnOe0og0KICAgICAgICAgICAgY29uc3QgYmVzdFNlYXJjaE1vdmUgPSBnZXRCZXN0TW92ZShzZWFyY2hCb2FyZCwgc2VhcmNoVHVybiwgc2VhcmNoRGVwdGgsIHNlYXJjaFBseSwgc2VhcmNoRW5hYmxlVGltZUxpbWl0LCBzZWFyY2hFeGFjdFJvb3RTY29yZXMsIHNlYXJjaENvbGxlY3RNb3ZlU2VxdWVuY2UpOw0KICAgICAgICAgICAgLy8g6K6w5b2V5pCc57Si57uT5p2f5pe26Ze05bm26K6h566X5oCd6ICD5pe26Ze0DQogICAgICAgICAgICBjb25zdCBlbmRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCk7DQogICAgICAgICAgICBjb25zdCB0aGlua2luZ1RpbWUgPSBlbmRUaW1lIC0gc3RhcnRUaW1lOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmo4Dmn6XmmK/lkKbmnaXoh6rlvIDlsYDlupMNCiAgICAgICAgICAgIGNvbnN0IGJvb2tNb3ZlU2VhcmNoID0gb3BlbmluZ0Jvb2suZ2V0Qm9va01vdmUoc2VhcmNoQm9hcmQsIHNlYXJjaFBseSk7DQogICAgICAgICAgICBjb25zdCBmcm9tQm9va1NlYXJjaCA9ICEhYm9va01vdmVTZWFyY2ggJiYgSlNPTi5zdHJpbmdpZnkoYm9va01vdmVTZWFyY2gpID09PSBKU09OLnN0cmluZ2lmeShiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOa3u+WKoOaAp+iDvee7n+iuoeaXpeW/lw0KICAgICAgICAgICAgbG9nUGVyZlN0YXRzKHNlYXJjaFR1cm4pOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmt7vliqDmgJ3ogIPml7bpl7Tml6Xlv5cNCiAgICAgICAgICAgIGNvbnN0IGZvcm1hdE1vdmUgPSAobW92ZSkgPT4gbW92ZT8uZnJvbSAmJiBtb3ZlPy50bw0KICAgICAgICAgICAgICAgID8gYCgke21vdmUuZnJvbS5yfSwke21vdmUuZnJvbS5jfSktPigke21vdmUudG8ucn0sJHttb3ZlLnRvLmN9KWANCiAgICAgICAgICAgICAgICA6ICdub25lJzsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBTZWFyY2ggY29tcGxldGU6IGdhbWU9JHtnYW1lSWR9LCB0aW1lPSR7TWF0aC5yb3VuZCh0aGlua2luZ1RpbWUpfW1zLCBiZXN0PSR7Zm9ybWF0TW92ZShiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSl9IHNjb3JlPSR7YmVzdFNlYXJjaE1vdmUuYmVzdE1vdmVTY29yZX0sIHNlY29uZD0ke2Zvcm1hdE1vdmUoYmVzdFNlYXJjaE1vdmUuc2Vjb25kQmVzdE1vdmUpfSwgYm9vaz0ke2Zyb21Cb29rU2VhcmNofWApOw0KICAgICAgICAgICAgLy8g5Y+R6YCB5pCc57Si57uT5p6c5ZKM5oCd6ICD5pe26Ze0DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ1NFQVJDSF9DT01QTEVURScsIA0KICAgICAgICAgICAgICAgIHBheWxvYWQ6IHsgDQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlOiBiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSwgDQogICAgICAgICAgICAgICAgICAgIHNlY29uZEJlc3RNb3ZlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZSwgDQogICAgICAgICAgICAgICAgICAgIGdhbWVJZCwgDQogICAgICAgICAgICAgICAgICAgIGZyb21Cb29rOiBmcm9tQm9va1NlYXJjaCwgDQogICAgICAgICAgICAgICAgICAgIHRoaW5raW5nVGltZTogTWF0aC5yb3VuZCh0aGlua2luZ1RpbWUpLCAvLyDlm5voiI3kupTlhaXliLDmr6vnp5INCiAgICAgICAgICAgICAgICAgICAgbW92ZVNlcXVlbmNlOiBiZXN0U2VhcmNoTW92ZS5tb3ZlU2VxdWVuY2UsDQogICAgICAgICAgICAgICAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kTW92ZVNlcXVlbmNlLA0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNjb3JlOiBiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZVNjb3JlLA0KICAgICAgICAgICAgICAgICAgICBzZWNvbmRCZXN0TW92ZVNjb3JlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZVNjb3JlLA0KICAgICAgICAgICAgICAgICAgICBhbGxNb3Zlc1dpdGhTY29yZXM6IGJlc3RTZWFyY2hNb3ZlLmFsbE1vdmVzV2l0aFNjb3JlcyB8fCBbXSwNCiAgICAgICAgICAgICAgICAgICAgY29tcGxldGVkRGVwdGg6IGJlc3RTZWFyY2hNb3ZlLmNvbXBsZXRlZERlcHRoLA0KICAgICAgICAgICAgICAgICAgICBwZXJmOiBzbmFwc2hvdFBlcmZTdGF0cygpDQogICAgICAgICAgICAgICAgfSANCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnZ2V0VmFsaWRNb3Zlcyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHZtQm9hcmQsIHBvczogdm1Qb3MgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBzeW5jR2VuZXJhbFBvc0NhY2hlKHZtQm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgdmFsaWRNb3ZlcyA9IGdldFZhbGlkTW92ZXModm1Cb2FyZCwgdm1Qb3MpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ3ZhbGlkTW92ZXMnLA0KICAgICAgICAgICAgICAgIG1vdmVzOiB2YWxpZE1vdmVzDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnZ2V0UGllY2VSZWxhdGlvbnMnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBwckJvYXJkLCBwb3M6IHByUG9zIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBwckJvYXJkW3ByUG9zLnJdW3ByUG9zLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDosIPnlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE5qOL5a2Q5L+h5oGv5ZKMYm9hcmRJbmZvDQogICAgICAgICAgICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZSgpOw0KICAgICAgICAgICAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQogICAgICAgICAgICBjb25zdCBib2FyZEV2YWx1YXRpb24gPSBldmFsdWF0ZUJvYXJkKHByQm9hcmQsIG51bGwsIGdhbWVTdGFnZSk7DQogICAgICAgICAgICBjb25zdCBwaWVjZXNJbmZvID0gYm9hcmRFdmFsdWF0aW9uLnBpZWNlc0luZm87DQogICAgICAgICAgICBjb25zdCBib2FyZEluZm8gPSBib2FyZEV2YWx1YXRpb24uYm9hcmRJbmZvOw0KDQogICAgICAgICAgICBpZiAoYm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpIHsNCiAgICAgICAgICAgICAgICBoeWRyYXRlUmVsYXRpb25zRnJvbU1hc2tzKHBpZWNlc0luZm8sIGJvYXJkSW5mbyk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIGJvYXJkSW5mbyDmoLzlhoXlj6/og73mmK8gcGllY2VzSW5mbyDlvJXnlKjvvIznu5/kuIDmmKDlsITkuLoge3IsY30g5L6bIFVJIOS9v+eUqA0KICAgICAgICAgICAgY29uc3QgcmF3Q29udHJvbGxlcnMgPSBib2FyZEluZm8uY29udHJvbGxlckdyaWQNCiAgICAgICAgICAgICAgICA/IChib2FyZEluZm8uY29udHJvbGxlckdyaWRbcHJQb3Mucl1bcHJQb3MuY10gfHwgW10pDQogICAgICAgICAgICAgICAgOiAoYm9hcmRJbmZvW3ByUG9zLnJdICYmIGJvYXJkSW5mb1twclBvcy5yXVtwclBvcy5jXSkgfHwgW107DQogICAgICAgICAgICBjb25zdCBjb250cm9sbGVycyA9IHJhd0NvbnRyb2xsZXJzLm1hcCgoY3RybCkgPT4gKHsgcjogY3RybC5yLCBjOiBjdHJsLmMgfSkpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBsZXQgcmVsYXRpb25zID0gew0KICAgICAgICAgICAgICAgIHRocmVhdDogW10sIA0KICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeTogW10sIA0KICAgICAgICAgICAgICAgIGd1YXJkOiBbXSwgDQogICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwgDQogICAgICAgICAgICAgICAgY29udHJvbDogW10sDQogICAgICAgICAgICAgICAgY29udHJvbGxlcnMNCiAgICAgICAgICAgIH07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOWmguaenOeCueWHu+eahOaYr+aji+WtkO+8jOi/lOWbnuivpeaji+WtkOeahOWFs+ezu+S/oeaBrw0KICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgY3VycmVudCBwaWVjZSBpbmZvDQogICAgICAgICAgICAgICAgY29uc3QgY3VycmVudFBpZWNlSW5mbyA9IHBpZWNlc0luZm8uZmluZChwID0+IHAuciA9PT0gcHJQb3MuciAmJiBwLmMgPT09IHByUG9zLmMpOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGllY2VJbmZvKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgcmVsYXRpb25zDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRocmVhdCA9IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0Lm1hcCh0aHJlYXRQaWVjZSA9PiAoeyByOiB0aHJlYXRQaWVjZS5yLCBjOiB0aHJlYXRQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGhyZWF0ZW5lZEJ5ID0gY3VycmVudFBpZWNlSW5mby50aHJlYXRlbmVkQnkubWFwKHRocmVhdGVuZWRCeVBpZWNlID0+ICh7IHI6IHRocmVhdGVuZWRCeVBpZWNlLnIsIGM6IHRocmVhdGVuZWRCeVBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBndWFyZCA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmQubWFwKGd1YXJkUGllY2UgPT4gKHsgcjogZ3VhcmRQaWVjZS5yLCBjOiBndWFyZFBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBndWFyZGVkQnkgPSBjdXJyZW50UGllY2VJbmZvLmd1YXJkZWRCeS5tYXAoZ3VhcmRlZEJ5UGllY2UgPT4gKHsgcjogZ3VhcmRlZEJ5UGllY2UuciwgYzogZ3VhcmRlZEJ5UGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2wgPSAoY3VycmVudFBpZWNlSW5mby5jb250cm9sIHx8IFtdKS5tYXAoY29udHJvbFBvcyA9PiAoeyByOiBjb250cm9sUG9zLnIsIGM6IGNvbnRyb2xQb3MuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICByZWxhdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQsIA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5LCANCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkLCANCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkZWRCeSwgDQogICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sLA0KICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbGxlcnMNCiAgICAgICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZVJlbGF0aW9ucycsDQogICAgICAgICAgICAgICAgcmVsYXRpb25zOiByZWxhdGlvbnMNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdjaGVja0dhbWVTdGF0ZSc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGNnc0JvYXJkLCB0dXJuOiBjZ3NUdXJuLCByZXF1ZXN0SWQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBnYW1lU3RhdGUgPSBjaGVja0dhbWVTdGF0ZShjZ3NCb2FyZCwgY2dzVHVybik7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAnZ2FtZVN0YXRlJywNCiAgICAgICAgICAgICAgICBzdGF0ZTogZ2FtZVN0YXRlLA0KICAgICAgICAgICAgICAgIHJlcXVlc3RJZA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2V2YWx1YXRlQm9hcmQnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBldmFsQm9hcmQsIHR1cm46IGV2YWxUdXJuIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgLy8g5omT5Y2w5o6l5pS255qE5Y+C5pWwDQogICAgICAgICAgICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZSgpOw0KICAgICAgICAgICAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQogICAgICAgICAgICBjb25zdCBkZXRhaWxlZEV2YWwgPSBldmFsdWF0ZUJvYXJkKGV2YWxCb2FyZCwgZXZhbFR1cm4sIGdhbWVTdGFnZSk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAnZGV0YWlsZWRFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICBldmFsdWF0aW9uOiBkZXRhaWxlZEV2YWwNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCg0KICAgICAgICBjYXNlICdldmFsdWF0ZVBpZWNlJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogcGllY2VFdmFsQm9hcmQsIHBvczogcGllY2VFdmFsUG9zLCB0dXJuIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBwaWVjZUV2YWxCb2FyZFtwaWVjZUV2YWxQb3Mucl1bcGllY2VFdmFsUG9zLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoIXBpZWNlKSB7DQogICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgICAgICBldmFsdWF0aW9uOiB7DQogICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICB0YWN0aWM6IDANCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIOS4u+WKqOiwg+eUqGV2YWx1YXRlQm9hcmTojrflj5blrozmlbTnmoTor4TkvLDkv6Hmga8NCiAgICAgICAgICAgICAgICAvLyDojrflj5blvZPliY3muLjmiI/pmLbmrrUNCiAgICAgICAgICAgICAgICBjb25zdCBwaGFzZSA9IGdldEdhbWVQaGFzZSgpOw0KICAgICAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRFdmFsdWF0aW9uID0gZXZhbHVhdGVCb2FyZChwaWVjZUV2YWxCb2FyZCwgdHVybiwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAvLyDku45ldmFsdWF0ZUJvYXJk55qE6L+U5Zue5YC85Lit5om+5Yiw5b2T5YmN5qOL5a2Q55qE5L+h5oGvDQogICAgICAgICAgICAgICAgY3VycmVudFBpZWNlSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5waWVjZXNJbmZvLmZpbmQoDQogICAgICAgICAgICAgICAgICAgIHAgPT4gcC5yID09PSBwaWVjZUV2YWxQb3MuciAmJiBwLmMgPT09IHBpZWNlRXZhbFBvcy5jDQogICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoY3VycmVudFBpZWNlSW5mbykgew0KICAgICAgICAgICAgICAgICAgICAvLyDlupTnlKjmnYPph43lubbov5Tlm57ljZXkuKrmo4vlrZDnmoTor4TkvLDlgLwNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXZhbHVhdGlvbiA9IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsOiBjdXJyZW50UGllY2VJbmZvLm1hdGVyaWFsVmFsdWUgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsLA0KICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IGN1cnJlbnRQaWVjZUluZm8ucG9zaXRpb25WYWx1ZSAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sDQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogY3VycmVudFBpZWNlSW5mby5tb2JpbGl0eVZhbHVlICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogY3VycmVudFBpZWNlSW5mby50aHJlYXRWYWx1ZSAqIFZBTFVFX1dFSUdIVFMudGhyZWF0LA0KICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiBjdXJyZW50UGllY2VJbmZvLnNhZmV0eVZhbHVlICogVkFMVUVfV0VJR0hUUy5zYWZldHksDQogICAgICAgICAgICAgICAgICAgICAgICB0YWN0aWM6IGN1cnJlbnRQaWVjZUluZm8udGFjdGljVmFsdWUgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYw0KICAgICAgICAgICAgICAgICAgICB9Ow0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IGV2YWx1YXRpb24NCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5aaC5p6c5LuN54S25om+5LiN5Yiw5qOL5a2Q5L+h5oGv77yM6L+U5Zue6buY6K6k5YC8DQogICAgICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgICAgICAgICBldmFsdWF0aW9uOiB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YWN0aWM6IDANCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2lzQ2hlY2snOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBjQm9hcmQsIGNvbG9yOiBjQ29sb3IsIHJlcXVlc3RJZCB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIHN5bmNHZW5lcmFsUG9zQ2FjaGUoY0JvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IGluQ2hlY2sgPSBpc0NoZWNrKGNCb2FyZCwgY0NvbG9yKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdjaGVjaycsDQogICAgICAgICAgICAgICAgaXNDaGVjazogaW5DaGVjaywNCiAgICAgICAgICAgICAgICByZXF1ZXN0SWQNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdpc1ZhbGlkUGxhY2VtZW50Jzogew0KICAgICAgICAgICAgY29uc3QgeyB0eXBlOiBpcFR5cGUsIGNvbG9yOiBpcENvbG9yLCByLCBjIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgdmFsaWRQbGFjZW1lbnQgPSBpc1ZhbGlkUGxhY2VtZW50KGlwVHlwZSwgaXBDb2xvciwgciwgYyk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAndmFsaWRQbGFjZW1lbnQnLA0KICAgICAgICAgICAgICAgIGlzVmFsaWQ6IHZhbGlkUGxhY2VtZW50DQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nJzogew0KICAgICAgICAgICAgY29uc3QgeyBtb3Zlcywgd2VpZ2h0cyB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIC8vIEFkZCB0aGUgb3BlbmluZyBsaW5lIHRvIHRoZSBvcGVuaW5nIGJvb2sNCiAgICAgICAgICAgIG9wZW5pbmdCb29rLmFkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyhbbW92ZXNdLCB3ZWlnaHRzKTsNCiAgICAgICAgICAgIC8vIFNlbmQgY29uZmlybWF0aW9uDQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ29wZW5pbmdMaW5lQWRkZWQnLCANCiAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlIA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ21vdmVzVG9Ob3RhdGlvbic6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IG5vdGF0aW9uID0gb3BlbmluZ0Jvb2subW92ZXNUb05vdGF0aW9uKGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7IA0KICAgICAgICAgICAgICAgIHR5cGU6ICdub3RhdGlvbicsIA0KICAgICAgICAgICAgICAgIG5vdGF0aW9uOiBub3RhdGlvbiANCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdub3RhdGlvblRvTW92ZXMnOiB7DQogICAgICAgICAgICBjb25zdCB7IG5vdGF0aW9uOiBub3RhdGlvblN0cmluZywgaW5pdGlhbEJvYXJkIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgbW92ZXNGcm9tTm90YXRpb24gPSBvcGVuaW5nQm9vay5ub3RhdGlvblRvTW92ZXMobm90YXRpb25TdHJpbmcsIGluaXRpYWxCb2FyZCk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ21vdmVzJywgDQogICAgICAgICAgICAgICAgbW92ZXM6IG1vdmVzRnJvbU5vdGF0aW9uIA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ3NldFZhbHVlV2VpZ2h0cyc6IHsNCiAgICAgICAgICAgIFZBTFVFX1dFSUdIVFMgPSB7IC4uLlZBTFVFX1dFSUdIVFMsIC4uLnBheWxvYWQgfTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdVcGRhdGVkIFZBTFVFX1dFSUdIVFM6JywgVkFMVUVfV0VJR0hUUyk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgIH0NCn07DQoNCiAgICAvLyBPdmVycmlkZSBjb25zb2xlLmxvZyB0byBzZW5kIG1lc3NhZ2VzIGJhY2sgdG8gbWFpbiB0aHJlYWQNCiAgICBjb25zdCBvcmlnaW5hbENvbnNvbGVMb2cgPSBjb25zb2xlLmxvZzsNCiAgICBjb25zb2xlLmxvZyA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHsNCiAgICAgICAgLy8gU2VuZCB0byBtYWluIHRocmVhZA0KICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgIHR5cGU6ICdsb2cnLA0KICAgICAgICAgICAgZGF0YTogYXJncy5qb2luKCcgJykNCiAgICAgICAgfSk7DQogICAgICAgIA0KICAgICAgICAvLyBBbHNvIGxvZyB0byB3b3JrZXIgY29uc29sZQ0KICAgICAgICBvcmlnaW5hbENvbnNvbGVMb2cuYXBwbHkoY29uc29sZSwgYXJncyk7DQogICAgfTsNCn0NCg0KLy8g56m6552A5Ymq5p6d77ya5pyJ6L+b5pS75a2Q5Yqb5pe25omN5YWB6K6477yI6YG/5YWN5bCGL+Wjqy/osaHmrovlsYDpgLznnYDor6/liarvvIkNCmNvbnN0IGNhbkRvTnVsbE1vdmUgPSAoYm9hcmQsIGNvbG9yKSA9PiB7DQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcCB8fCBwLmNvbG9yICE9PSBjb2xvcikgY29udGludWU7DQogICAgICAgICAgICBpZiAocC50eXBlID09PSAnY2hhcmlvdCcgfHwgcC50eXBlID09PSAnaG9yc2UnIHx8IHAudHlwZSA9PT0gJ2Nhbm5vbicgfHwgcC50eXBlID09PSAnc29sZGllcicpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICByZXR1cm4gZmFsc2U7DQp9Ow0KDQovLyDmkJzntKLnlKggVFQga2V577ya5aKe6YeP5qih5byP5Li6IG51bWJlcu+8jOaXp+aooeW8j+S4uiBgJHtoYXNofToke3NpZGV9YCDlrZfnrKbkuLINCmNvbnN0IG1ha2VTZWFyY2hUVEtleSA9IChib2FyZCwgY3VycmVudFBsYXllciwgYm9hcmRIYXNoKSA9PiB7DQogICAgcmV0dXJuIHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChib2FyZEhhc2gsIGN1cnJlbnRQbGF5ZXIpOw0KfTsNCg0KLy8g6LWw5a2Q5ZCO55qE5a2Q6IqC54K55bGA6Z2i5ZOI5biM77yI5LuF5aKe6YeP5qih5byP5pyJ5oSP5LmJ77yb6aG75ZyoIG1ha2Ug5YmN5L+d5a2YIG1vdmluZ1BpZWNl77yJDQpjb25zdCBjaGlsZEJvYXJkSGFzaCA9IChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCkgPT4gew0KICAgIHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzKys7DQogICAgaWYgKGlzRW5jb2RlZE1vdmUobW92ZSkpIHsNCiAgICAgICAgbGV0IG5ld0hhc2ggPSBib2FyZEhhc2g7DQogICAgICAgIGNvbnN0IG1vdmluZ0lkeCA9IHpvYnJpc3RIYXNoZXIucGllY2VJbmRleChtb3ZpbmdQaWVjZSk7DQogICAgICAgIGNvbnN0IGZyb20gPSBtb3ZlID4+PiA3Ow0KICAgICAgICBjb25zdCB0byA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7DQogICAgICAgIGlmIChtb3ZpbmdJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgbmV3SGFzaCBePSB6b2JyaXN0SGFzaGVyLmhhc2hUYWJsZVsoZnJvbSAvIDkpIHwgMF1bZnJvbSAlIDldW21vdmluZ0lkeF07DQogICAgICAgICAgICBuZXdIYXNoIF49IHpvYnJpc3RIYXNoZXIuaGFzaFRhYmxlWyh0byAvIDkpIHwgMF1bdG8gJSA5XVttb3ZpbmdJZHhdOw0KICAgICAgICB9DQogICAgICAgIGlmIChjYXB0dXJlZCkgew0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRJZHggPSB6b2JyaXN0SGFzaGVyLnBpZWNlSW5kZXgoY2FwdHVyZWQpOw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICBuZXdIYXNoIF49IHpvYnJpc3RIYXNoZXIuaGFzaFRhYmxlWyh0byAvIDkpIHwgMF1bdG8gJSA5XVtjYXB0dXJlZElkeF07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIG5ld0hhc2g7DQogICAgfQ0KICAgIHJldHVybiB6b2JyaXN0SGFzaGVyLnVwZGF0ZUhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOw0KfTsNCg0KLy8g5pCc57Si55So5YeA5YiG77ya5a6M5pW05b2i5Yq/6K+E5Lyw77yI5YWz57O7L+WogeiDgS/lronlhagv5py65Yqo77yJ77yM5LuF6Lez6L+H57uI5bGA552A5rOV5p6a5Li+77yb5bimIFpvYnJpc3Qg57yT5a2YDQpjb25zdCBzdGF0aWNTZWFyY2hFdmFsID0gKGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRIYXNoID0gMCkgPT4gew0KICAgIGNvbnN0IGNhY2hlS2V5ID0gem9icmlzdEhhc2hlci5ldmFsQ2FjaGVLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsNCiAgICBpZiAoZXZhbENhY2hlLmhhcyhjYWNoZUtleSkpIHsNCiAgICAgICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlSGl0cysrOw0KICAgICAgICByZXR1cm4gZXZhbENhY2hlLmdldChjYWNoZUtleSk7DQogICAgfQ0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnN0YXRpY0V2YWxDYWNoZU1pc3NlcysrOw0KICAgIGxldCBuZXQ7DQogICAgaWYgKCFTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFKSB7DQogICAgICAgIG5ldCA9IGV2YWx1YXRlU2VhcmNoTGVhZkZhc3QoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsNCiAgICB9IGVsc2Ugew0KICAgICAgICBjb25zdCBldmFsUmVzdWx0ID0gZXZhbHVhdGVCb2FyZChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHsgZm9yU2VhcmNoTGVhZjogdHJ1ZSB9KTsNCiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBzZWFyY2hJbml0aWF0b3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBuZXQgPSBldmFsUmVzdWx0W3NlYXJjaEluaXRpYXRvcl0udG90YWwgLSBldmFsUmVzdWx0W29wcG9uZW50XS50b3RhbDsNCiAgICB9DQogICAgaWYgKGV2YWxDYWNoZS5zaXplID49IEVWQUxfQ0FDSEVfTUFYKSB7DQogICAgICAgIC8vIOeugOWNlea3mOaxsOacgOaXqeWGmeWFpeeahOS4gOaJue+8jOmBv+WFjSBNYXAg5peg6ZmQ5raoDQogICAgICAgIGxldCBkcm9wID0gMDsNCiAgICAgICAgZm9yIChjb25zdCBrIG9mIGV2YWxDYWNoZS5rZXlzKCkpIHsNCiAgICAgICAgICAgIGV2YWxDYWNoZS5kZWxldGUoayk7DQogICAgICAgICAgICBpZiAoKytkcm9wID49IDQwOTYpIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KICAgIGV2YWxDYWNoZS5zZXQoY2FjaGVLZXksIG5ldCk7DQogICAgcmV0dXJuIG5ldDsNCn07DQoNCi8vIOeUn+aIkOW9k+WJjeaWueWQg+WtkOedgO+8iOS+m+mdmem7mOaQnOe0ou+8iQ0KY29uc3QgZ2VuZXJhdGVDYXB0dXJlc0ZvclNlYXJjaCA9IChib2FyZCwgY3VycmVudFBsYXllcikgPT4gew0KICAgIGNvbnN0IF9fdDAgPSBTRUFSQ0hfUFJPRklMRSA/IHBlcmZvcm1hbmNlLm5vdygpIDogMDsNCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5jYXB0dXJlR2VuQ291bnQrKzsNCiAgICBjb25zdCBjYXB0dXJlcyA9IFtdOw0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCiAgICBpZiAocGllY2VTdGF0ZSkgew0KICAgICAgICBjb25zdCByZWNvcmRzID0gcGllY2VTdGF0ZS5yZWNvcmRzOw0KICAgICAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsNCiAgICAgICAgY29uc3Qgc3F1YXJlQ29kZXMgPSBwaWVjZVN0YXRlLnNxdWFyZUNvZGVzOw0KICAgICAgICBjb25zdCBwaWVjZUNvZGVzID0gcGllY2VTdGF0ZS5waWVjZUNvZGVzOw0KICAgICAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHNsb3QgPSBzcXVhcmVUb1Nsb3Rbc3FdOw0KICAgICAgICAgICAgaWYgKHNsb3QgPCAwKSBjb250aW51ZTsNCiAgICAgICAgICAgIGNvbnN0IHJlY29yZCA9IHJlY29yZHNbc2xvdF07DQogICAgICAgICAgICBpZiAoIXJlY29yZC5hbGl2ZSB8fCByZWNvcmQucGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIGNvbnRpbnVlOw0KICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IGFwcGVuZFNlYXJjaFBzZXVkb01vdmVzRm9yUGllY2UoDQogICAgICAgICAgICAgICAgY2FwdHVyZXMsIHNxLCBwaWVjZUNvZGVzW3Nsb3RdLCBzcXVhcmVDb2RlcywgdHJ1ZQ0KICAgICAgICAgICAgKTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5jYXB0dXJlR2VuTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgICAgICByZXR1cm4gY2FwdHVyZXM7DQogICAgfQ0KICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKCFwaWVjZSB8fCBwaWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7DQogICAgICAgICAgICBjb25zdCBmcm9tID0geyByLCBjIH07DQogICAgICAgICAgICBjb25zdCBwc2V1ZG8gPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCBmcm9tLCBwaWVjZSk7DQogICAgICAgICAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgKz0gcHNldWRvLmxlbmd0aDsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcHNldWRvLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgdG8gPSBwc2V1ZG9baV07DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW3RvLnJdW3RvLmNdKSBjYXB0dXJlcy5wdXNoKGVuY29kZU1vdmVGcm9tQ29vcmRzKHIsIGMsIHRvLnIsIHRvLmMpKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5jYXB0dXJlR2VuTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIHJldHVybiBjYXB0dXJlczsNCn07DQoNCi8vIOmdmem7mOaQnOe0ou+8mnN0YW5kLXBhdCDnlKjlrozmlbTlvaLlir/or4TkvLDvvJvku4Xlr7nlkIPlrZDlu7bkvLjvvIhRU+KJpDPvvIkNCi8vIFBsYXkgc2VhcmNoIGhhcyBubyBQViB0byByZXRhaW4sIHNvIGtlZXAgaXRzIHJlY3Vyc2l2ZSBob3QgcGF0aCBwcmltaXRpdmUtb25seS4NCi8vIEFuYWx5c2lzIGNvbnRpbnVlcyB0byB1c2UgdGhlIG9iamVjdC1yZXR1cm5pbmcgZnVuY3Rpb25zIGJlbG93Lg0KY29uc3Qgc29ydENhcHR1cmVzUGxheSA9IChjYXB0dXJlcywgYm9hcmQsIGdhbWVTdGFnZSkgPT4gew0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCiAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlICYmIHBpZWNlU3RhdGUuc3F1YXJlVG9TbG90Ow0KICAgIGNvbnN0IHBpZWNlQ29kZXMgPSBwaWVjZVN0YXRlICYmIHBpZWNlU3RhdGUucGllY2VDb2RlczsNCiAgICBjb25zdCBtYXRlcmlhbFZhbHVlcyA9IHBpZWNlU3RhdGUgPyBwaWVjZVN0YXRlLm1hdGVyaWFsVmFsdWVzIDogc2VhcmNoTWF0ZXJpYWxUYWJsZShnYW1lU3RhZ2UpOw0KDQogICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGNhcHR1cmVzLmxlbmd0aDsgaW5kZXgrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gY2FwdHVyZXNbaW5kZXhdOw0KICAgICAgICBjb25zdCBmcm9tU3EgPSBtb3ZlID4+PiA3Ow0KICAgICAgICBjb25zdCB0b1NxID0gbW92ZSAmIE1PVkVfVE9fTUFTSzsNCiAgICAgICAgbGV0IHNjb3JlOw0KICAgICAgICBpZiAocGllY2VTdGF0ZSkgew0KICAgICAgICAgICAgc2NvcmUgPSBtYXRlcmlhbFZhbHVlc1twaWVjZUNvZGVzW3NxdWFyZVRvU2xvdFt0b1NxXV0gJiA3XSAqIDE2IC0NCiAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlc1twaWVjZUNvZGVzW3NxdWFyZVRvU2xvdFtmcm9tU3FdXSAmIDddOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgc2NvcmUgPQ0KICAgICAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYm9hcmRbbW92ZVRvUihtb3ZlKV1bbW92ZVRvQyhtb3ZlKV0sIGdhbWVTdGFnZSkgKiAxNiAtDQogICAgICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShib2FyZFttb3ZlRnJvbVIobW92ZSldW21vdmVGcm9tQyhtb3ZlKV0sIGdhbWVTdGFnZSk7DQogICAgICAgIH0NCiAgICAgICAgY2FwdHVyZVNvcnRTY29yZVNjcmF0Y2hbaW5kZXhdID0gc2NvcmU7DQogICAgfQ0KDQogICAgLy8gU3RhYmxlIGluc2VydGlvbiBvcmRlcmluZyBleGFjdGx5IG1hdGNoZXMgdGhlIHByZXZpb3VzIG51bWVyaWMgY29tcGFyYXRvci4NCiAgICBmb3IgKGxldCBpID0gMTsgaSA8IGNhcHR1cmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBjYXB0dXJlc1tpXTsNCiAgICAgICAgY29uc3Qgc2NvcmUgPSBjYXB0dXJlU29ydFNjb3JlU2NyYXRjaFtpXTsNCiAgICAgICAgbGV0IGogPSBpIC0gMTsNCiAgICAgICAgd2hpbGUgKGogPj0gMCAmJiBjYXB0dXJlU29ydFNjb3JlU2NyYXRjaFtqXSA8IHNjb3JlKSB7DQogICAgICAgICAgICBjYXB0dXJlc1tqICsgMV0gPSBjYXB0dXJlc1tqXTsNCiAgICAgICAgICAgIGNhcHR1cmVTb3J0U2NvcmVTY3JhdGNoW2ogKyAxXSA9IGNhcHR1cmVTb3J0U2NvcmVTY3JhdGNoW2pdOw0KICAgICAgICAgICAgai0tOw0KICAgICAgICB9DQogICAgICAgIGNhcHR1cmVzW2ogKyAxXSA9IG1vdmU7DQogICAgICAgIGNhcHR1cmVTb3J0U2NvcmVTY3JhdGNoW2ogKyAxXSA9IHNjb3JlOw0KICAgIH0NCiAgICByZXR1cm4gY2FwdHVyZXM7DQp9Ow0KDQpjb25zdCBxdWllc2NlbmNlUGxheSA9ICgNCiAgICBiLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwNCiAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgcXNEZXB0aCwgYm9hcmRIYXNoID0gMA0KKSA9PiB7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMucXVpZXNjZW5jZUNhbGxzKys7DQogICAgY29uc3Qgc3RhbmRQYXQgPSBzdGF0aWNTZWFyY2hFdmFsKGIsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBib2FyZEhhc2gpOw0KDQogICAgaWYgKHFzRGVwdGggPD0gMCkgcmV0dXJuIHN0YW5kUGF0Ow0KDQogICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0ID49IGJldGEpIHJldHVybiBzdGFuZFBhdDsNCiAgICAgICAgaWYgKHN0YW5kUGF0ID4gYWxwaGEpIGFscGhhID0gc3RhbmRQYXQ7DQogICAgfSBlbHNlIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0IDw9IGFscGhhKSByZXR1cm4gc3RhbmRQYXQ7DQogICAgICAgIGlmIChzdGFuZFBhdCA8IGJldGEpIGJldGEgPSBzdGFuZFBhdDsNCiAgICB9DQoNCiAgICBjb25zdCBjYXB0dXJlcyA9IGdlbmVyYXRlQ2FwdHVyZXNGb3JTZWFyY2goYiwgY3VycmVudFBsYXllcik7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMucXVpZXNjZW5jZUNhcHR1cmVNb3ZlcyArPSBjYXB0dXJlcy5sZW5ndGg7DQogICAgaWYgKGNhcHR1cmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHN0YW5kUGF0Ow0KDQogICAgc29ydENhcHR1cmVzUGxheShjYXB0dXJlcywgYiwgZ2FtZVN0YWdlKTsNCg0KICAgIGxldCBiZXN0RXZhbCA9IHN0YW5kUGF0Ow0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY2FwdHVyZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgbW92ZSA9IGNhcHR1cmVzW2ldOw0KICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldOw0KICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUpOw0KICAgICAgICBpZiAobGVhdmVzT3duS2luZ1Vuc2FmZShiLCBjdXJyZW50UGxheWVyKSkgewogICAgICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkKys7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgICAgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCsrOw0KICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IHZhbHVlID0gcXVpZXNjZW5jZVBsYXkoDQogICAgICAgICAgICBiLCBhbHBoYSwgYmV0YSwgbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yLCBuZXh0UGxheWVyLA0KICAgICAgICAgICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGggLSAxLCBuZXh0SGFzaA0KICAgICAgICApOw0KICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCg0KICAgICAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgICAgICAgaWYgKHZhbHVlID4gYmVzdEV2YWwpIGJlc3RFdmFsID0gdmFsdWU7DQogICAgICAgICAgICBpZiAodmFsdWUgPiBhbHBoYSkgYWxwaGEgPSB2YWx1ZTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmICh2YWx1ZSA8IGJlc3RFdmFsKSBiZXN0RXZhbCA9IHZhbHVlOw0KICAgICAgICAgICAgaWYgKHZhbHVlIDwgYmV0YSkgYmV0YSA9IHZhbHVlOw0KICAgICAgICB9DQogICAgICAgIGlmIChiZXRhIDw9IGFscGhhKSBicmVhazsNCiAgICB9DQogICAgcmV0dXJuIGJlc3RFdmFsOw0KfTsNCg0KY29uc3QgYWxwaGFCZXRhUGxheSA9ICgNCiAgICBiLCBkLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwNCiAgICBzZWFyY2hEZXB0aCA9IDAsIHNlYXJjaEluaXRpYXRvciA9IGN1cnJlbnRQbGF5ZXIsIGdhbWVTdGFnZSA9ICdtaWQnLCBib2FyZEhhc2ggPSAwDQopID0+IHsNCiAgICBjb25zdCBvcmlnaW5hbEFscGhhID0gYWxwaGE7DQogICAgY29uc3Qgb3JpZ2luYWxCZXRhID0gYmV0YTsNCg0KICAgIHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscysrOw0KICAgIGlmICghcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0pIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdID0gMDsNCiAgICBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSsrOw0KDQogICAgaWYgKGQgPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHF1aWVzY2VuY2VQbGF5KA0KICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgU0VBUkNIX1FVSUVTQ0VOQ0VfREVQVEgsIGJvYXJkSGFzaA0KICAgICAgICApOw0KICAgIH0NCg0KICAgIGNvbnN0IHR0S2V5ID0gbWFrZVNlYXJjaFRUS2V5KGIsIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSGFzaCk7DQogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZSh0dEtleSk7DQogICAgbGV0IHR0TW92ZSA9IG51bGw7DQogICAgaWYgKHR0RW50cnkpIHsNCiAgICAgICAgdHRNb3ZlID0gdHRFbnRyeS5iZXN0TW92ZSB8fCBudWxsOw0KICAgICAgICBpZiAodHRFbnRyeS5kZXB0aCA+PSBkKSB7DQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnZXhhY3QnKSByZXR1cm4gdHRFbnRyeS52YWx1ZTsNCiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICdsb3dlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlID49IGJldGEpIHJldHVybiB0dEVudHJ5LnZhbHVlOw0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ3VwcGVyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPD0gYWxwaGEpIHJldHVybiB0dEVudHJ5LnZhbHVlOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3Qgc2VhcmNoSW5mbyA9IHByZXBhcmVTZWFyY2hJbmZvKGIsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIGNvbnN0IGFiUGllY2VzSW5mbyA9IHNlYXJjaEluZm8ucGllY2VzSW5mbzsNCiAgICBjb25zdCBhYkJvYXJkSW5mbyA9IHNlYXJjaEluZm8uYm9hcmRJbmZvOw0KICAgIGNvbnN0IGluQ2hlY2sgPSBzZWFyY2hJbmZvLmluQ2hlY2sgfHwNCiAgICAgICAgKGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnICYmIGFiQm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwNCiAgICAgICAgKGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgJiYgYWJCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOw0KICAgIGNvbnN0IHRlcm1pbmFsU2NvcmUgPSAoKSA9PiB7DQogICAgICAgIGNvbnN0IGlzSW5pdGlhdG9yV2lubmVyID0gY3VycmVudFBsYXllciAhPT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7DQogICAgICAgIHJldHVybiBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogKHNlYXJjaERlcHRoIC0gZCkpOw0KICAgIH07DQoNCiAgICBpZiAoIXNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdCB8fCBzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3QubGVuZ3RoID09PSAwKSB7DQogICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGFiQm9hcmRJbmZvLmdhbWVTdGF0ZTsNCiAgICAgICAgaWYgKGdhbWVTdGF0ZSAmJiAoZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ2NoZWNrbWF0ZScgfHwgZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ3N0YWxlbWF0ZScpKSB7DQogICAgICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGdhbWVTdGF0ZS53aW5uZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgICAgIGNvbnN0IGJhc2VTY29yZSA9IGlzSW5pdGlhdG9yV2lubmVyID8gMTAwMDAwIDogLTEwMDAwMDsNCiAgICAgICAgICAgIHJldHVybiBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogKHNlYXJjaERlcHRoIC0gZCkpOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiB0ZXJtaW5hbFNjb3JlKCk7DQogICAgfQ0KDQogICAgbGV0IG1vdmVzID0gc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0Ow0KICAgIGlmICghcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdKSBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gPSAwOw0KICAgIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSArPSBtb3Zlcy5sZW5ndGg7DQoNCiAgICBjb25zdCBraWxsZXJzQXREZXB0aCA9IGtpbGxlck1vdmVzW2RdIHx8IFtudWxsLCBudWxsXTsNCiAgICBtb3ZlcyA9IHNvcnRNb3Zlc1BsYXkoCiAgICAgICAgbW92ZXMsIGIsIGN1cnJlbnRQbGF5ZXIsIGFiUGllY2VzSW5mbywgZ2FtZVN0YWdlLCBhYkJvYXJkSW5mbywKICAgICAgICB0dE1vdmUsIGtpbGxlcnNBdERlcHRoLCBpbkNoZWNrCiAgICApOwogICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MgJiYgbW92ZXMubGVuZ3RoKSB7CiAgICAgICAgcmVjb3JkVG9wTW92ZVNvdXJjZShkLCBiLCBtb3Zlc1swXSwgdHRNb3ZlLCBraWxsZXJzQXREZXB0aCk7CiAgICB9Cg0KICAgIGxldCBiZXN0RXZhbCA9IG1heGltaXppbmcgPyAtSW5maW5pdHkgOiBJbmZpbml0eTsNCiAgICBsZXQgYmVzdE1vdmUgPSBudWxsOw0KICAgIGxldCBsZWdhbE1vdmVzRm91bmQgPSAwOw0KDQogICAgZm9yIChsZXQgbW92ZUluZGV4ID0gMDsgbW92ZUluZGV4IDwgbW92ZXMubGVuZ3RoOyBtb3ZlSW5kZXgrKykgewogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1ttb3ZlSW5kZXhdOwogICAgICAgIGNvbnN0IGlzQ2FwdHVyZSA9ICEhYlttb3ZlVG9SKG1vdmUpXVttb3ZlVG9DKG1vdmUpXTsKICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldOwogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZVNlYXJjaE1vdmUoYiwgbW92ZSk7CiAgICAgICAgaWYgKGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllciwgbW92ZSwgaW5DaGVjaykpIHsKICAgICAgICAgICAgdW5tYWtlU2VhcmNoTW92ZShiLCBtb3ZlLCBjYXB0dXJlZCk7DQogICAgICAgICAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCsrOw0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCiAgICAgICAgY29uc3QgbmV4dEhhc2ggPSBjaGlsZEJvYXJkSGFzaChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7CiAgICAgICAgbGVnYWxNb3Zlc0ZvdW5kKys7CiAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MgJiYgbGVnYWxNb3Zlc0ZvdW5kID09PSAxKSB7CiAgICAgICAgICAgIHJlY29yZEZpcnN0TGVnYWxNb3ZlKGQsIG1vdmVJbmRleCk7CiAgICAgICAgfQogICAgICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQrKzsKICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOwogICAgICAgIGNvbnN0IGNhblByb2JlID0gU0VBUkNIX0VOQUJMRV9OT05fUk9PVF9QVlMgJiYKICAgICAgICAgICAgbGVnYWxNb3Zlc0ZvdW5kID4gMSAmJgogICAgICAgICAgICBOdW1iZXIuaXNGaW5pdGUobWF4aW1pemluZyA/IGFscGhhIDogYmV0YSk7CiAgICAgICAgbGV0IHZhbHVlOwogICAgICAgIGlmIChjYW5Qcm9iZSkgewogICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgewogICAgICAgICAgICAgICAgcGVyZlN0YXRzLnB2c1Byb2JlcysrOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGNvbnN0IHByb2JlU3RhcnROb2RlcyA9IFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MgPyBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMgOiAwOwogICAgICAgICAgICB2YWx1ZSA9IG1heGltaXppbmcKICAgICAgICAgICAgICAgID8gYWxwaGFCZXRhUGxheSgKICAgICAgICAgICAgICAgICAgICBiLCBkIC0gMSwgYWxwaGEsIGFscGhhICsgU0VBUkNIX05VTExfV0lORE9XX0VQUywgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsCiAgICAgICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBuZXh0SGFzaAogICAgICAgICAgICAgICAgKQogICAgICAgICAgICAgICAgOiBhbHBoYUJldGFQbGF5KAogICAgICAgICAgICAgICAgICAgIGIsIGQgLSAxLCBiZXRhIC0gU0VBUkNIX05VTExfV0lORE9XX0VQUywgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsCiAgICAgICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBuZXh0SGFzaAogICAgICAgICAgICAgICAgKTsKICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHsKICAgICAgICAgICAgICAgIHBlcmZTdGF0cy5wdnNQcm9iZU5vZGVzICs9IHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscyAtIHByb2JlU3RhcnROb2RlczsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgY29uc3QgbmVlZHNSZXNlYXJjaCA9IG1heGltaXppbmcKICAgICAgICAgICAgICAgID8gdmFsdWUgPiBhbHBoYSAmJiB2YWx1ZSA8IGJldGEKICAgICAgICAgICAgICAgIDogdmFsdWUgPCBiZXRhICYmIHZhbHVlID4gYWxwaGE7CiAgICAgICAgICAgIGlmIChuZWVkc1Jlc2VhcmNoKSB7CiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgewogICAgICAgICAgICAgICAgICAgIHBlcmZTdGF0cy5wdnNSZXNlYXJjaGVzKys7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBjb25zdCByZXNlYXJjaFN0YXJ0Tm9kZXMgPSBTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTID8gcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzIDogMDsKICAgICAgICAgICAgICAgIHZhbHVlID0gYWxwaGFCZXRhUGxheSgKICAgICAgICAgICAgICAgICAgICBiLCBkIC0gMSwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLAogICAgICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgbmV4dEhhc2gKICAgICAgICAgICAgICAgICk7CiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgewogICAgICAgICAgICAgICAgICAgIHBlcmZTdGF0cy5wdnNSZXNlYXJjaE5vZGVzICs9IHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscyAtIHJlc2VhcmNoU3RhcnROb2RlczsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIHZhbHVlID0gYWxwaGFCZXRhUGxheSgKICAgICAgICAgICAgICAgIGIsIGQgLSAxLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIG5leHRIYXNoCiAgICAgICAgICAgICk7CiAgICAgICAgfQogICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOw0KDQogICAgICAgIGlmIChtYXhpbWl6aW5nKSB7DQogICAgICAgICAgICBpZiAodmFsdWUgPiBiZXN0RXZhbCkgew0KICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gdmFsdWU7DQogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYWxwaGEgPSBNYXRoLm1heChhbHBoYSwgdmFsdWUpOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKHZhbHVlIDwgYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHZhbHVlOw0KICAgICAgICAgICAgICAgIGJlc3RNb3ZlID0gbW92ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJldGEgPSBNYXRoLm1pbihiZXRhLCB2YWx1ZSk7DQogICAgICAgIH0NCg0KICAgICAgICBpZiAoYmV0YSA8PSBhbHBoYSkgewogICAgICAgICAgICBpZiAoIXBlcmZTdGF0cy5jdXRvZmZzW2RdKSBwZXJmU3RhdHMuY3V0b2Zmc1tkXSA9IDA7CiAgICAgICAgICAgIHBlcmZTdGF0cy5jdXRvZmZzW2RdKys7CiAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTICYmIGxlZ2FsTW92ZXNGb3VuZCA9PT0gMSkgewogICAgICAgICAgICAgICAgcmVjb3JkRmlyc3RMZWdhbEN1dG9mZihkKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAoIWlzQ2FwdHVyZSkgew0KICAgICAgICAgICAgICAgIHN0b3JlS2lsbGVyTW92ZShkLCBtb3ZlKTsNCiAgICAgICAgICAgICAgICBhZGRIaXN0b3J5U2NvcmUobW92ZSwgZCk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGlmIChsZWdhbE1vdmVzRm91bmQgPT09IDApIHJldHVybiB0ZXJtaW5hbFNjb3JlKCk7DQoNCiAgICBsZXQgZmxhZzsNCiAgICBpZiAoYmVzdEV2YWwgPD0gb3JpZ2luYWxBbHBoYSkgZmxhZyA9ICd1cHBlcmJvdW5kJzsNCiAgICBlbHNlIGlmIChiZXN0RXZhbCA+PSBvcmlnaW5hbEJldGEpIGZsYWcgPSAnbG93ZXJib3VuZCc7DQogICAgZWxzZSBmbGFnID0gJ2V4YWN0JzsNCiAgICB0cmFuc3Bvc2l0aW9uVGFibGUuc3RvcmUodHRLZXksIGQsIGJlc3RFdmFsLCBmbGFnLCBiZXN0TW92ZSwgbnVsbCk7DQogICAgcmV0dXJuIGJlc3RFdmFsOw0KfTsNCg0KY29uc3QgcXVpZXNjZW5jZSA9ICgNCiAgICBiLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwNCiAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgcXNEZXB0aCwgYm9hcmRIYXNoID0gMA0KKSA9PiB7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMucXVpZXNjZW5jZUNhbGxzKys7DQogICAgY29uc3Qgc3RhbmRQYXQgPSBzdGF0aWNTZWFyY2hFdmFsKGIsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBib2FyZEhhc2gpOw0KDQogICAgaWYgKHFzRGVwdGggPD0gMCkgew0KICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICB9DQoNCiAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgICBpZiAoc3RhbmRQYXQgPj0gYmV0YSkgew0KICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgIH0NCiAgICAgICAgaWYgKHN0YW5kUGF0ID4gYWxwaGEpIHsNCiAgICAgICAgICAgIGFscGhhID0gc3RhbmRQYXQ7DQogICAgICAgIH0NCiAgICB9IGVsc2Ugew0KICAgICAgICBpZiAoc3RhbmRQYXQgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICB9DQogICAgICAgIGlmIChzdGFuZFBhdCA8IGJldGEpIHsNCiAgICAgICAgICAgIGJldGEgPSBzdGFuZFBhdDsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGxldCBjYXB0dXJlcyA9IGdlbmVyYXRlQ2FwdHVyZXNGb3JTZWFyY2goYiwgY3VycmVudFBsYXllcik7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMucXVpZXNjZW5jZUNhcHR1cmVNb3ZlcyArPSBjYXB0dXJlcy5sZW5ndGg7DQogICAgaWYgKGNhcHR1cmVzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICB9DQoNCiAgICAvLyBNVlYtTFZB77ya5YWI6K+V5ZCD5aSn5a2QDQogICAgY2FwdHVyZXMuc29ydCgoYSwgYk1vdmUpID0+IHsNCiAgICAgICAgY29uc3Qgc2NvcmVBID0NCiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYlttb3ZlVG9SKGEpXVttb3ZlVG9DKGEpXSwgZ2FtZVN0YWdlKSAqIDE2IC0NCiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYlttb3ZlRnJvbVIoYSldW21vdmVGcm9tQyhhKV0sIGdhbWVTdGFnZSk7DQogICAgICAgIGNvbnN0IHNjb3JlQiA9DQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbbW92ZVRvUihiTW92ZSldW21vdmVUb0MoYk1vdmUpXSwgZ2FtZVN0YWdlKSAqIDE2IC0NCiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYlttb3ZlRnJvbVIoYk1vdmUpXVttb3ZlRnJvbUMoYk1vdmUpXSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgcmV0dXJuIHNjb3JlQiAtIHNjb3JlQTsNCiAgICB9KTsNCg0KICAgIGxldCBiZXN0RXZhbCA9IHN0YW5kUGF0Ow0KICAgIGxldCBiZXN0TW92ZVNlcXVlbmNlID0gW107DQoNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNhcHR1cmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBjYXB0dXJlc1tpXTsNCiAgICAgICAgY29uc3QgbW92aW5nUGllY2UgPSBiW21vdmVGcm9tUihtb3ZlKV1bbW92ZUZyb21DKG1vdmUpXTsNCiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlU2VhcmNoTW92ZShiLCBtb3ZlKTsNCiAgICAgICAgaWYgKGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllcikpIHsNCiAgICAgICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOw0KICAgICAgICAgICAgcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQrKzsNCiAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICB9DQogICAgICAgIGNvbnN0IG5leHRIYXNoID0gY2hpbGRCb2FyZEhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOw0KICAgICAgICBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkKys7DQogICAgICAgIGNvbnN0IG5leHRQbGF5ZXIgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgY29uc3QgbmV4dE1heGltaXppbmcgPSBuZXh0UGxheWVyID09PSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgIGNvbnN0IHJlc3VsdCA9IHF1aWVzY2VuY2UoDQogICAgICAgICAgICBiLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgcXNEZXB0aCAtIDEsIG5leHRIYXNoDQogICAgICAgICk7DQogICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOw0KDQogICAgICAgIGlmIChtYXhpbWl6aW5nKSB7DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlID4gYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4uKHJlc3VsdC5tb3ZlU2VxdWVuY2UgfHwgW10pXTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlID4gYWxwaGEpIHsNCiAgICAgICAgICAgICAgICBhbHBoYSA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPCBiZXN0RXZhbCkgew0KICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFKSB7DQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZVRvT2JqZWN0KG1vdmUpLCAuLi4ocmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPCBiZXRhKSB7DQogICAgICAgICAgICAgICAgYmV0YSA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoYmV0YSA8PSBhbHBoYSkgew0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICByZXR1cm4geyB2YWx1ZTogYmVzdEV2YWwsIG1vdmVTZXF1ZW5jZTogU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA/IGJlc3RNb3ZlU2VxdWVuY2UgOiBbXSB9Ow0KfTsNCg0KLy8gYWxwaGFCZXRh77ya6K+E5Lyw5aeL57uI5LuOIHNlYXJjaEluaXRpYXRvciDop5LluqbvvJtUVCArIGtpbGxlci9oaXN0b3J5ICsg56m6552A5Ymq5p6dICsgTE1SICsgUVMNCi8vIGJvYXJkSGFzaO+8muWinumHjyBab2JyaXN0IOWxgOmdouWTiOW4jO+8iOS4jeWQq+ihjOaji+aWue+8ie+8m+aXp+aooeW8j+S4i+WPr+S8oCAwDQpjb25zdCBhbHBoYUJldGEgPSAoDQogICAgYiwgZCwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgc2VhcmNoRGVwdGggPSAwLCBzZWFyY2hJbml0aWF0b3IgPSBjdXJyZW50UGxheWVyLCBnYW1lU3RhZ2UgPSAnbWlkJywNCiAgICBhbGxvd051bGwgPSB0cnVlLCBib2FyZEhhc2ggPSAwDQopID0+IHsNCiAgICBjb25zdCBvcmlnaW5hbEFscGhhID0gYWxwaGE7DQogICAgY29uc3Qgb3JpZ2luYWxCZXRhID0gYmV0YTsNCg0KICAgIHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscysrOw0KICAgIGlmICghcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0pIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdID0gMDsNCiAgICBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSsrOw0KDQogICAgLy8g5Y+26IqC54K577ya5a6M5pW05b2i5Yq/6K+E5LywICsg5ZCD5a2Q6Z2Z6buY5pCc57SiDQogICAgaWYgKGQgPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHF1aWVzY2VuY2UoDQogICAgICAgICAgICBiLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwNCiAgICAgICAgICAgIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBTRUFSQ0hfUVVJRVNDRU5DRV9ERVBUSCwgYm9hcmRIYXNoDQogICAgICAgICk7DQogICAgfQ0KDQogICAgLy8g572u5o2i6KGo5o6i5rWL77yIa2V5IOWQq+ihjOaji+aWue+8jOmBv+WFjeWQjOW9ouS4jeWQjOi1sOaWueWGsueqge+8iQ0KICAgIGNvbnN0IHR0S2V5ID0gbWFrZVNlYXJjaFRUS2V5KGIsIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSGFzaCk7DQogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZSh0dEtleSk7DQogICAgbGV0IHR0TW92ZSA9IG51bGw7DQogICAgaWYgKHR0RW50cnkpIHsNCiAgICAgICAgdHRNb3ZlID0gdHRFbnRyeS5iZXN0TW92ZSB8fCBudWxsOw0KICAgICAgICBpZiAodHRFbnRyeS5kZXB0aCA+PSBkKSB7DQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnZXhhY3QnKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHR0RW50cnkudmFsdWUsDQogICAgICAgICAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRQ0KICAgICAgICAgICAgICAgICAgICAgICAgPyAodHRFbnRyeS5tb3ZlU2VxdWVuY2UgfHwgKHR0TW92ZSA/IFttb3ZlVG9PYmplY3QodHRNb3ZlKV0gOiBbXSkpDQogICAgICAgICAgICAgICAgICAgICAgICA6IFtdDQogICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICdsb3dlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlID49IGJldGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ3VwcGVyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3Qgc2VhcmNoSW5mbyA9IHByZXBhcmVTZWFyY2hJbmZvKGIsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIGNvbnN0IGFiUGllY2VzSW5mbyA9IHNlYXJjaEluZm8ucGllY2VzSW5mbzsNCiAgICBjb25zdCBhYkJvYXJkSW5mbyA9IHNlYXJjaEluZm8uYm9hcmRJbmZvOw0KICAgIGNvbnN0IGN1cnJlbnRQbGF5ZXJDb2xvciA9IGN1cnJlbnRQbGF5ZXI7DQogICAgY29uc3QgaW5DaGVjayA9IHNlYXJjaEluZm8uaW5DaGVjayB8fA0KICAgICAgICAgICAgICAgICAgICAoY3VycmVudFBsYXllckNvbG9yID09PSAncmVkJyAmJiBhYkJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8DQogICAgICAgICAgICAgICAgICAgIChjdXJyZW50UGxheWVyQ29sb3IgPT09ICdibGFjaycgJiYgYWJCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOw0KDQogICAgY29uc3QgdGVybWluYWxTY29yZSA9IChtYXRlSW5DaGVjaykgPT4gew0KICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGN1cnJlbnRQbGF5ZXJDb2xvciAhPT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7DQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICB2YWx1ZTogYmFzZVNjb3JlICsgKGlzSW5pdGlhdG9yV2lubmVyID8gZCA6IChzZWFyY2hEZXB0aCAtIGQpKSwNCiAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogW10sDQogICAgICAgICAgICB0ZXJtaW5hbDogbWF0ZUluQ2hlY2sgPyAnY2hlY2ttYXRlJyA6ICdzdGFsZW1hdGUnDQogICAgICAgIH07DQogICAgfTsNCg0KICAgIC8vIOaXoOS8quWQiOazleedgO+8muebtOaOpee7iOWxgO+8iOaegeWwkeinge+8m+mAmuW4uOiHs+WwkeacieWwhueahOi1sOWKqO+8iQ0KICAgIGlmICghc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0IHx8IHNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdC5sZW5ndGggPT09IDApIHsNCiAgICAgICAgY29uc3QgZ2FtZVN0YXRlID0gYWJCb2FyZEluZm8uZ2FtZVN0YXRlOw0KICAgICAgICBpZiAoZ2FtZVN0YXRlICYmIChnYW1lU3RhdGUuc3RhdHVzID09PSAnY2hlY2ttYXRlJyB8fCBnYW1lU3RhdGUuc3RhdHVzID09PSAnc3RhbGVtYXRlJykpIHsNCiAgICAgICAgICAgIGNvbnN0IGlzSW5pdGlhdG9yV2lubmVyID0gZ2FtZVN0YXRlLndpbm5lciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICAgICAgY29uc3QgYmFzZVNjb3JlID0gaXNJbml0aWF0b3JXaW5uZXIgPyAxMDAwMDAgOiAtMTAwMDAwOw0KICAgICAgICAgICAgY29uc3Qgc3RlcHNGcm9tUm9vdCA9IHNlYXJjaERlcHRoIC0gZDsNCiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogc3RlcHNGcm9tUm9vdCksIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gdGVybWluYWxTY29yZShpbkNoZWNrKTsNCiAgICB9DQoNCiAgICAvLyDnqbrnnYDliarmnp3vvJrku4UgbWF4aW1pemluZ++8m+WujOaVtOivhOS8sOS4i+S/neWuiOWQr+eUqA0KICAgIGlmICgNCiAgICAgICAgZmFsc2UgJiYNCiAgICAgICAgYWxsb3dOdWxsICYmDQogICAgICAgIG1heGltaXppbmcgJiYNCiAgICAgICAgZCA+PSAzICYmDQogICAgICAgICFpbkNoZWNrICYmDQogICAgICAgIGNhbkRvTnVsbE1vdmUoYiwgY3VycmVudFBsYXllckNvbG9yKQ0KICAgICkgew0KICAgICAgICBjb25zdCBudWxsUiA9IGQgPj0gNiA/IDMgOiAyOw0KICAgICAgICBjb25zdCBudWxsRGVwdGggPSBkIC0gMSAtIG51bGxSOw0KICAgICAgICBpZiAobnVsbERlcHRoID49IDApIHsNCiAgICAgICAgICAgIGNvbnN0IG51bGxQbGF5ZXIgPSBjdXJyZW50UGxheWVyQ29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICAgICAgY29uc3QgbnVsbE1heGltaXppbmcgPSBudWxsUGxheWVyID09PSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgICAgICAvLyDnqbrnnYDkuI3mlLnlj5jlsYDpnaLlk4jluIzvvIzku4XooYzmo4vmlrnlj5jljJbvvIhUVCBrZXkg5ZCrIHNpZGXvvIkNCiAgICAgICAgICAgIGNvbnN0IG51bGxSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgbnVsbERlcHRoLCBiZXRhIC0gMWUtNiwgYmV0YSwgbnVsbE1heGltaXppbmcsIG51bGxQbGF5ZXIsDQogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBmYWxzZSwgYm9hcmRIYXNoDQogICAgICAgICAgICApOw0KICAgICAgICAgICAgaWYgKG51bGxSZXN1bHQudmFsdWUgPj0gYmV0YSkgew0KICAgICAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBudWxsUmVzdWx0LnZhbHVlLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBsZXQgbW92ZXMgPSBzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3Q7DQoNCiAgICBpZiAoIXBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSkgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdID0gMDsNCiAgICBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gKz0gbW92ZXMubGVuZ3RoOw0KDQogICAgY29uc3Qga2lsbGVyc0F0RGVwdGggPSAoa2lsbGVyTW92ZXNbZF0gfHwgW251bGwsIG51bGxdKTsNCiAgICBtb3ZlcyA9IHNvcnRNb3Zlc0Zhc3QobW92ZXMsIGIsIGN1cnJlbnRQbGF5ZXJDb2xvciwgYWJQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGFiQm9hcmRJbmZvLCB7CiAgICAgICAgdHRNb3ZlLAogICAgICAgIGtpbGxlcnM6IGtpbGxlcnNBdERlcHRoCiAgICB9KTsKICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTICYmIG1vdmVzLmxlbmd0aCkgewogICAgICAgIHJlY29yZFRvcE1vdmVTb3VyY2UoZCwgYiwgbW92ZXNbMF0sIHR0TW92ZSwga2lsbGVyc0F0RGVwdGgpOwogICAgfQoNCiAgICBjb25zdCBzdG9yZVRUID0gKHZhbHVlLCBiZXN0TW92ZSwgbW92ZVNlcXVlbmNlKSA9PiB7DQogICAgICAgIGxldCBmbGFnOw0KICAgICAgICBpZiAodmFsdWUgPD0gb3JpZ2luYWxBbHBoYSkgZmxhZyA9ICd1cHBlcmJvdW5kJzsNCiAgICAgICAgZWxzZSBpZiAodmFsdWUgPj0gb3JpZ2luYWxCZXRhKSBmbGFnID0gJ2xvd2VyYm91bmQnOw0KICAgICAgICBlbHNlIGZsYWcgPSAnZXhhY3QnOw0KICAgICAgICB0cmFuc3Bvc2l0aW9uVGFibGUuc3RvcmUodHRLZXksIGQsIHZhbHVlLCBmbGFnLCBiZXN0TW92ZSwgU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA/IG1vdmVTZXF1ZW5jZSA6IG51bGwpOw0KICAgIH07DQoNCiAgICBsZXQgYmVzdEV2YWwgPSBtYXhpbWl6aW5nID8gLUluZmluaXR5IDogSW5maW5pdHk7DQogICAgbGV0IGJlc3RNb3ZlID0gbnVsbDsNCiAgICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOw0KICAgIGxldCBsZWdhbE1vdmVzRm91bmQgPSAwOw0KDQogICAgZm9yIChsZXQgbW92ZUluZGV4ID0gMDsgbW92ZUluZGV4IDwgbW92ZXMubGVuZ3RoOyBtb3ZlSW5kZXgrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbbW92ZUluZGV4XTsNCiAgICAgICAgY29uc3QgaXNDYXB0dXJlID0gISFiW21vdmVUb1IobW92ZSldW21vdmVUb0MobW92ZSldOw0KICAgICAgICBjb25zdCBpc1RUTW92ZSA9IHR0TW92ZSAmJiBpc1NhbWVNb3ZlKG1vdmUsIHR0TW92ZSk7DQogICAgICAgIGNvbnN0IGlzS2lsbGVyID0NCiAgICAgICAgICAgIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc0F0RGVwdGhbMF0pIHx8DQogICAgICAgICAgICBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNBdERlcHRoWzFdKTsNCg0KICAgICAgICAvLyBMTVLvvJrpnaDlkI7nmoTlronpnZnnnYDms5XpmY3mt7EgMe+8iOWujOaVtOivhOS8sOS4i+S/neWuiO+8iQogICAgICAgIC8vIG1vdmVJbmRleCDlkKvkvKrlkIjms5Xluo/vvJvpnZ7ms5XnnYDot7Pov4flkI7nlaXlgY/kv53lrojvvIjlsJHpmY3mt7HvvInvvIzkuI3lvbHlk43mraPnoa7mgKcKICAgICAgICBsZXQgcmVkdWN0aW9uID0gMDsKICAgICAgICBpZiAoCiAgICAgICAgICAgIGZhbHNlICYmCiAgICAgICAgICAgIGQgPj0gNCAmJgogICAgICAgICAgICBtb3ZlSW5kZXggPj0gNCAmJgogICAgICAgICAgICAhaW5DaGVjayAmJgogICAgICAgICAgICAhaXNDYXB0dXJlICYmCiAgICAgICAgICAgICFpc1RUTW92ZSAmJgogICAgICAgICAgICAhaXNLaWxsZXIKICAgICAgICApIHsKICAgICAgICAgICAgcmVkdWN0aW9uID0gMTsKICAgICAgICB9Cg0KICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldOw0KICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUpOw0KICAgICAgICBpZiAobGVhdmVzT3duS2luZ1Vuc2FmZShiLCBjdXJyZW50UGxheWVyQ29sb3IsIG1vdmUsIGluQ2hlY2spKSB7CiAgICAgICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOw0KICAgICAgICAgICAgcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQrKzsNCiAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICB9DQogICAgICAgIGNvbnN0IG5leHRIYXNoID0gY2hpbGRCb2FyZEhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOwogICAgICAgIGxlZ2FsTW92ZXNGb3VuZCsrOwogICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTICYmIGxlZ2FsTW92ZXNGb3VuZCA9PT0gMSkgewogICAgICAgICAgICByZWNvcmRGaXJzdExlZ2FsTW92ZShkLCBtb3ZlSW5kZXgpOwogICAgICAgIH0KICAgICAgICBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkKys7Cg0KICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KDQogICAgICAgIGxldCByZXN1bHQ7DQogICAgICAgIGlmIChyZWR1Y3Rpb24gPiAwKSB7DQogICAgICAgICAgICBjb25zdCByZWR1Y2VkRGVwdGggPSBNYXRoLm1heCgwLCBkIC0gMSAtIHJlZHVjdGlvbik7DQogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgcmVkdWNlZERlcHRoLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIGNvbnN0IG5lZWRSZXNlYXJjaCA9IG1heGltaXppbmcNCiAgICAgICAgICAgICAgICA/IHJlc3VsdC52YWx1ZSA+IGFscGhhDQogICAgICAgICAgICAgICAgOiByZXN1bHQudmFsdWUgPCBiZXRhOw0KICAgICAgICAgICAgaWYgKG5lZWRSZXNlYXJjaCkgew0KICAgICAgICAgICAgICAgIHJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHRydWUsIG5leHRIYXNoDQogICAgICAgICAgICApOw0KICAgICAgICB9DQoNCiAgICAgICAgdW5tYWtlU2VhcmNoTW92ZShiLCBtb3ZlLCBjYXB0dXJlZCk7DQoNCiAgICAgICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPiBiZXN0RXZhbCkgew0KICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgICAgICAgIGJlc3RNb3ZlID0gbW92ZTsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYWxwaGEgPSBNYXRoLm1heChhbHBoYSwgcmVzdWx0LnZhbHVlKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPCBiZXN0RXZhbCkgew0KICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgICAgICAgIGJlc3RNb3ZlID0gbW92ZTsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYmV0YSA9IE1hdGgubWluKGJldGEsIHJlc3VsdC52YWx1ZSk7DQogICAgICAgIH0NCg0KICAgICAgICBpZiAoYmV0YSA8PSBhbHBoYSkgewogICAgICAgICAgICBpZiAoIXBlcmZTdGF0cy5jdXRvZmZzW2RdKSBwZXJmU3RhdHMuY3V0b2Zmc1tkXSA9IDA7CiAgICAgICAgICAgIHBlcmZTdGF0cy5jdXRvZmZzW2RdKys7CiAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTICYmIGxlZ2FsTW92ZXNGb3VuZCA9PT0gMSkgewogICAgICAgICAgICAgICAgcmVjb3JkRmlyc3RMZWdhbEN1dG9mZihkKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAoIWlzQ2FwdHVyZSkgew0KICAgICAgICAgICAgICAgIHN0b3JlS2lsbGVyTW92ZShkLCBtb3ZlKTsNCiAgICAgICAgICAgICAgICBhZGRIaXN0b3J5U2NvcmUobW92ZSwgZCk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOW7tui/n+WQiOazleaAp++8muS8quWQiOazlemdnuepuuS9huaXoOS4gOWQiOazlSDihpIg5bCG5q27L+WbsOavmQ0KICAgIGlmIChsZWdhbE1vdmVzRm91bmQgPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHRlcm1pbmFsU2NvcmUoaW5DaGVjayk7DQogICAgfQ0KDQogICAgc3RvcmVUVChiZXN0RXZhbCwgYmVzdE1vdmUsIGJlc3RNb3ZlU2VxdWVuY2UpOw0KICAgIHJldHVybiB7IHZhbHVlOiBiZXN0RXZhbCwgbW92ZVNlcXVlbmNlOiBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFID8gYmVzdE1vdmVTZXF1ZW5jZSA6IFtdIH07DQp9Ow0KDQovLyBleGFjdFJvb3RTY29yZXM6IHRydWU9QW5hbHlzaXMg5YWo5qC557K+56Gu5YiG77ybZmFsc2U95a+55byI5qCH5YeGIFBWU++8iGZhaWwtbG93IOS4jeWbnuaQnO+8iQ0KY29uc3QgZ2V0QmVzdE1vdmVJbnRlcm5hbCA9IChib2FyZCwgdHVybiwgZGVwdGggPSA4LCBwbHkgPSAwLCBlbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzID0gZmFsc2UsIGNvbGxlY3RNb3ZlU2VxdWVuY2VPdmVycmlkZSA9IG51bGwpID0+IHsNCiAgY29uc3QgdGltZUxpbWl0ID0gNTAwMDsNCg0KICAvLyBGaXJzdCB0cnkgdG8gZ2V0IG1vdmUgZnJvbSBvcGVuaW5nIGJvb2sNCiAgY29uc3QgYm9va01vdmUgPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShib2FyZCwgcGx5KTsNCiAgDQogIGlmIChib29rTW92ZSkgew0KICAgIC8vIENoZWNrIGlmIGJvb2tNb3ZlIGlzIHZhbGlkIGZvciBjdXJyZW50IGJvYXJkDQogICAgaWYgKGJvb2tNb3ZlLmZyb20gJiYgYm9va01vdmUudG8gJiYgDQogICAgICAgIHR5cGVvZiBib29rTW92ZS5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBib29rTW92ZS5mcm9tLmMgPT09ICdudW1iZXInICYmDQogICAgICAgIHR5cGVvZiBib29rTW92ZS50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUudG8uYyA9PT0gJ251bWJlcicpIHsNCiAgICAgIA0KICAgICAgY29uc3QgbW92aW5nUGllY2UgPSBib2FyZFtib29rTW92ZS5mcm9tLnJdW2Jvb2tNb3ZlLmZyb20uY107DQogICAgICANCiAgICAgIGlmIChtb3ZpbmdQaWVjZSAmJiBtb3ZpbmdQaWVjZS5jb2xvciA9PT0gdHVybikgew0KICAgICAgICAvLyBWZXJpZnkgbW92ZSBpcyB2YWxpZA0KICAgICAgICBjb25zdCB2YWxpZERlc3RpbmF0aW9ucyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIGJvb2tNb3ZlLmZyb20pOw0KICAgICAgICBjb25zdCBpc1ZhbGlkID0gdmFsaWREZXN0aW5hdGlvbnMuc29tZShkZXN0ID0+IGRlc3QuciA9PT0gYm9va01vdmUudG8uciAmJiBkZXN0LmMgPT09IGJvb2tNb3ZlLnRvLmMpOw0KICAgICAgICANCiAgICAgICAgaWYgKGlzVmFsaWQpIHsNCiAgICAgICAgICByZXR1cm4geyBiZXN0TW92ZTogYm9va01vdmUsIHNlY29uZEJlc3RNb3ZlOiBudWxsLCBtb3ZlU2VxdWVuY2U6IFtdLCBzZWNvbmRNb3ZlU2VxdWVuY2U6IFtdLCBiZXN0TW92ZVNjb3JlOiAwLCBzZWNvbmRCZXN0TW92ZVNjb3JlOiAwLCBhbGxNb3Zlc1dpdGhTY29yZXM6IFtdIH07DQogICAgICAgIH0NCiAgICAgIH0NCiAgICB9DQogIH0NCg0KICAvLyDmoLnoioLngrnvvJrov63ku6PliqDmt7EgKyBQVlPvvJtUVC9raWxsZXIvaGlzdG9yeSDot6jmt7Hluqbkv53nlZnvvIjku4XlvIDlsYDmuIXnqbrkuIDmrKHvvIkNCiAgcmVzZXRQZXJmU3RhdHMoKTsNCiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTsNCiAgdHJhbnNwb3NpdGlvblRhYmxlLnJlc2V0U3RhdHMoKTsNCiAgdHJhbnNwb3NpdGlvblRhYmxlLmNsZWFyKCk7DQogIGNsZWFyRXZhbENhY2hlKCk7DQogIGNvbnN0IG1heERlcHRoID0gTWF0aC5tYXgoMSwgZGVwdGggfCAwKTsNCiAgcmVzZXRTZWFyY2hIZXVyaXN0aWNzKG1heERlcHRoKTsNCiAgc3luY0dlbmVyYWxQb3NDYWNoZShib2FyZCk7DQogIFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPSB0eXBlb2YgY29sbGVjdE1vdmVTZXF1ZW5jZU92ZXJyaWRlID09PSAnYm9vbGVhbicNCiAgICA/IGNvbGxlY3RNb3ZlU2VxdWVuY2VPdmVycmlkZQ0KICAgIDogISFleGFjdFJvb3RTY29yZXM7DQoNCiAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoKTsNCiAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQoNCiAgY29uc3Qgcm9vdEV2YWxSZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGJvYXJkLCB0dXJuLCBnYW1lU3RhZ2UpOw0KICBjb25zdCByb290UGllY2VzSW5mbyA9IHJvb3RFdmFsUmVzdWx0LnBpZWNlc0luZm87DQogIGNvbnN0IHJvb3RCb2FyZEluZm8gPSByb290RXZhbFJlc3VsdC5ib2FyZEluZm87DQoNCiAgLy8g5pS26ZuG5qC56IqC54K56LWw5rOV77yI5Y+q5YGa5LiA5qyh77yJ77yb5pyq6KKr5bCG5pe26L+H5ruk6YCB5ZCDDQogIGxldCByb290TW92ZXMgPSBbXTsNCiAgLy9jb25zdCByb290SW5DaGVjayA9ICh0dXJuID09PSAncmVkJyAmJiByb290Qm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwNCiAgLy8gICAgICAgICAgICAgICAgICAgICh0dXJuID09PSAnYmxhY2snICYmIHJvb3RCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOw0KDQogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHIsIGMgfSk7DQogICAgICAgIHZhbGlkRGVzdGluYXRpb25zLmZvckVhY2godG8gPT4gew0KICAgICAgICAgIC8vY29uc3QgaXNBY2NlcHRhYmxlID0gcm9vdEluQ2hlY2sgfHwgaXNQb3NpdGlvbkFjY2VwdGFibGUoYm9hcmQsIHsgciwgYyB9LCB0bywgdHVybiwgcm9vdEJvYXJkSW5mbywgcm9vdFBpZWNlc0luZm8sIHBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgIC8vaWYgKGlzQWNjZXB0YWJsZSkgew0KICAgICAgICAgICAgcm9vdE1vdmVzLnB1c2goeyBmcm9tOiB7IHIsIGMgfSwgdG8sIHNjb3JlOiAwLCBtb3ZlU2VxdWVuY2U6IFtdIH0pOw0KICAgICAgICAgIC8vfQ0KICAgICAgICB9KTsNCiAgICAgIH0NCiAgICB9DQogIH0NCg0KICBpZiAocm9vdE1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgIHJldHVybiB7DQogICAgICBiZXN0TW92ZTogbnVsbCwNCiAgICAgIHNlY29uZEJlc3RNb3ZlOiBudWxsLA0KICAgICAgbW92ZVNlcXVlbmNlOiBbXSwNCiAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogW10sDQogICAgICBiZXN0TW92ZVNjb3JlOiAwLA0KICAgICAgc2Vjb25kQmVzdE1vdmVTY29yZTogMCwNCiAgICAgIGFsbE1vdmVzV2l0aFNjb3JlczogW10NCiAgICB9Ow0KICB9DQoNCiAgY29uc3Qgc29ydFJvb3RNb3Zlc0J5U2NvcmUgPSAobW92ZXMpID0+IHsNCiAgICBtb3Zlcy5zb3J0KChhLCBiKSA9PiB7DQogICAgICBjb25zdCBzY29yZURpZmYgPSBiLnNjb3JlIC0gYS5zY29yZTsNCiAgICAgIGlmIChNYXRoLmFicyhzY29yZURpZmYpIDwgMWUtNikgew0KICAgICAgICBpZiAoYS5zY29yZSA+IDApIHsNCiAgICAgICAgICByZXR1cm4gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYi5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoYS5zY29yZSA8IDApIHsNCiAgICAgICAgICByZXR1cm4gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYS5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gMDsNCiAgICAgIH0NCiAgICAgIHJldHVybiBzY29yZURpZmY7DQogICAgfSk7DQogIH07DQoNCiAgY29uc3QgcHJvbW90ZVJvb3RNb3ZlID0gKG1vdmVzLCBwcmVmZXJyZWQpID0+IHsNCiAgICBpZiAoIXByZWZlcnJlZCkgcmV0dXJuOw0KICAgIGNvbnN0IGlkeCA9IG1vdmVzLmZpbmRJbmRleCgobSkgPT4gaXNTYW1lTW92ZShtLCBwcmVmZXJyZWQpKTsNCiAgICBpZiAoaWR4ID4gMCkgew0KICAgICAgY29uc3QgW2hpdF0gPSBtb3Zlcy5zcGxpY2UoaWR4LCAxKTsNCiAgICAgIG1vdmVzLnVuc2hpZnQoaGl0KTsNCiAgICB9DQogIH07DQoNCiAgY29uc3Qgd29ya0JvYXJkID0gYm9hcmQubWFwKChyb3cpID0+IFsuLi5yb3ddKTsNCiAgYWN0aXZlU2VhcmNoUGllY2VTdGF0ZSA9IGNyZWF0ZVNlYXJjaFBpZWNlU3RhdGUod29ya0JvYXJkLCBnYW1lU3RhZ2UpOw0KICBjb25zdCBOVUxMX1dJTkRPV19FUFMgPSAxZS02Ow0KICBjb25zdCBuZXh0VHVybiA9IHR1cm4gPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAvLyDmoLnlsYDpnaLlk4jluIzlj6rnrpfkuIDmrKHvvJvlop7ph4/mqKHlvI/mlbTmo7XmkJzntKLmoJHnlLHmraTmtL7nlJ8NCiAgY29uc3Qgcm9vdEhhc2ggPSB6b2JyaXN0SGFzaGVyLmhhc2goYm9hcmQpOw0KICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOw0KICBjb25zdCByb290VFRLZXkgPSB6b2JyaXN0SGFzaGVyLnR0S2V5RnJvbUhhc2gocm9vdEhhc2gsIHR1cm4pOw0KDQogIGxldCBjb21wbGV0ZWREZXB0aCA9IDA7DQoNCiAgZm9yIChsZXQgY3VycmVudERlcHRoID0gMTsgY3VycmVudERlcHRoIDw9IG1heERlcHRoOyBjdXJyZW50RGVwdGgrKykgew0KICAgIGlmIChlbmFibGVUaW1lTGltaXQgJiYgY29tcGxldGVkRGVwdGggPiAwICYmIERhdGUubm93KCkgLSBzdGFydFRpbWUgPiB0aW1lTGltaXQpIHsNCiAgICAgIGNvbnNvbGUubG9nKGBJRCBzdG9wcGVkIGJlZm9yZSBkZXB0aCAke2N1cnJlbnREZXB0aH0gZHVlIHRvIHRpbWUgbGltaXQgKGxhc3QgY29tcGxldGVkPSR7Y29tcGxldGVkRGVwdGh9KWApOw0KICAgICAgYnJlYWs7DQogICAgfQ0KDQogICAgLy8g5rWF5bGC5pyA5L2z552AICsgVFQg552A5o6S5Yiw5pyA5YmN77yM5L6b5pys5bGCIFBWUyDnrKzkuIDnnYDlhajnqpfkvb/nlKgNCiAgICBjb25zdCB0dEVudHJ5ID0gdHJhbnNwb3NpdGlvblRhYmxlLnJldHJpZXZlKHJvb3RUVEtleSk7DQogICAgY29uc3QgdHRNb3ZlID0gdHRFbnRyeSAmJiB0dEVudHJ5LmJlc3RNb3ZlID8gdHRFbnRyeS5iZXN0TW92ZSA6IG51bGw7DQogICAgY29uc3QgcHJldkJlc3QgPSByb290TW92ZXNbMF07DQogICAgc29ydE1vdmVzRmFzdChyb290TW92ZXMsIGJvYXJkLCB0dXJuLCByb290UGllY2VzSW5mbywgZ2FtZVN0YWdlLCByb290Qm9hcmRJbmZvLCB7DQogICAgICB0dE1vdmUsDQogICAgICBraWxsZXJzOiBraWxsZXJNb3Zlc1tNYXRoLm1heCgwLCBjdXJyZW50RGVwdGggLSAxKV0gfHwgW251bGwsIG51bGxdDQogICAgfSk7DQogICAgLy8g5LiK5LiA5bGC5pyA5L2z552A5pS+56ys5LiA77yI5pyA5ZCOIHByb21vdGXvvInvvIzkv53or4HmnKzlsYIgUFZTIOmmluedgOWFqOeql+WRveS4reeDrei3r+W+hA0KICAgIHByb21vdGVSb290TW92ZShyb290TW92ZXMsIHR0TW92ZSk7DQogICAgcHJvbW90ZVJvb3RNb3ZlKHJvb3RNb3ZlcywgcHJldkJlc3QpOw0KDQogICAgY29uc3QgdXNlRXhhY3RSb290ID0gZXhhY3RSb290U2NvcmVzICYmIGN1cnJlbnREZXB0aCA9PT0gbWF4RGVwdGg7DQogICAgY29uc3QgdXNlUGxheVNlYXJjaCA9ICFleGFjdFJvb3RTY29yZXM7DQogICAgbGV0IHJvb3RBbHBoYSA9IC1JbmZpbml0eTsNCg0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcm9vdE1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICBjb25zdCBpdGVtID0gcm9vdE1vdmVzW2ldOw0KICAgICAgY29uc3QgbW92aW5nUGllY2UgPSB3b3JrQm9hcmRbaXRlbS5mcm9tLnJdW2l0ZW0uZnJvbS5jXTsNCiAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZU1vdmUod29ya0JvYXJkLCBpdGVtLmZyb20sIGl0ZW0udG8pOw0KICAgICAgY29uc3QgY2hpbGRIYXNoID0gY2hpbGRCb2FyZEhhc2gocm9vdEhhc2gsIGl0ZW0sIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7DQoNCiAgICAgIGxldCBhbHBoYUJldGFSZXN1bHQ7DQogICAgICBsZXQgc2NvcmU7DQogICAgICBsZXQgc2NvcmVJc0V4YWN0ID0gdHJ1ZTsNCiAgICAgIGlmIChpID09PSAwIHx8IHJvb3RBbHBoYSA9PT0gLUluZmluaXR5KSB7DQogICAgICAgIGlmICh1c2VQbGF5U2VhcmNoKSB7DQogICAgICAgICAgc2NvcmUgPSBhbHBoYUJldGFQbGF5KA0KICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LA0KICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgY2hpbGRIYXNoDQogICAgICAgICAgKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsIC1JbmZpbml0eSwgSW5maW5pdHksDQogICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCB0cnVlLCBjaGlsZEhhc2gNCiAgICAgICAgICApOw0KICAgICAgICAgIHNjb3JlID0gYWxwaGFCZXRhUmVzdWx0LnZhbHVlOw0KICAgICAgICB9DQogICAgICB9IGVsc2Ugew0KICAgICAgICBsZXQgcHJvYmU7DQogICAgICAgIGlmICh1c2VQbGF5U2VhcmNoKSB7DQogICAgICAgICAgcHJvYmUgPSBhbHBoYUJldGFQbGF5KA0KICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLA0KICAgICAgICAgICAgcm9vdEFscGhhLCByb290QWxwaGEgKyBOVUxMX1dJTkRPV19FUFMsDQogICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCBjaGlsZEhhc2gNCiAgICAgICAgICApOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwNCiAgICAgICAgICAgIHJvb3RBbHBoYSwgcm9vdEFscGhhICsgTlVMTF9XSU5ET1dfRVBTLA0KICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoDQogICAgICAgICAgKTsNCiAgICAgICAgICBwcm9iZSA9IGFscGhhQmV0YVJlc3VsdC52YWx1ZTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAocHJvYmUgPiByb290QWxwaGEpIHsNCiAgICAgICAgICBpZiAodXNlUGxheVNlYXJjaCkgew0KICAgICAgICAgICAgc2NvcmUgPSBhbHBoYUJldGFQbGF5KA0KICAgICAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsIHJvb3RBbHBoYSwgSW5maW5pdHksDQogICAgICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIGNoaWxkSGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsIHJvb3RBbHBoYSwgSW5maW5pdHksDQogICAgICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIHNjb3JlID0gYWxwaGFCZXRhUmVzdWx0LnZhbHVlOw0KICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmICh1c2VFeGFjdFJvb3QpIHsNCiAgICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsIC1JbmZpbml0eSwgSW5maW5pdHksDQogICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCB0cnVlLCBjaGlsZEhhc2gNCiAgICAgICAgICApOw0KICAgICAgICAgIHNjb3JlID0gYWxwaGFCZXRhUmVzdWx0LnZhbHVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgIC8vIGZhaWwtbG9377ya5o6i5rWL5YiG5Y+q5piv5LiK55WM77yM5LiN6IO95b2T57K+56Gu5YiG5YaZ5YWl77yI5ZCm5YiZIElEIOS4i+WxguaOkuW6j+iiq+axoeafk++8jOaYk+WPjeWkjei1sOeCru+8iQ0KICAgICAgICAgIHNjb3JlID0gcHJvYmU7DQogICAgICAgICAgc2NvcmVJc0V4YWN0ID0gZmFsc2U7DQogICAgICAgIH0NCiAgICAgIH0NCg0KICAgICAgdW5tYWtlTW92ZSh3b3JrQm9hcmQsIGl0ZW0uZnJvbSwgaXRlbS50bywgY2FwdHVyZWQpOw0KDQogICAgICBpZiAoc2NvcmVJc0V4YWN0KSB7DQogICAgICAgIGl0ZW0uc2NvcmUgPSBzY29yZTsNCiAgICAgICAgaXRlbS5tb3ZlU2VxdWVuY2UgPSBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFDQogICAgICAgICAgPyBbeyBmcm9tOiBpdGVtLmZyb20sIHRvOiBpdGVtLnRvIH0sIC4uLihhbHBoYUJldGFSZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV0NCiAgICAgICAgICA6IFtdOw0KICAgICAgICBpZiAoaXRlbS5zY29yZSA+IHJvb3RBbHBoYSkgew0KICAgICAgICAgIHJvb3RBbHBoYSA9IGl0ZW0uc2NvcmU7DQogICAgICAgIH0NCiAgICAgIH0gZWxzZSBpZiAoaXRlbS5zY29yZSA+IHJvb3RBbHBoYSkgew0KICAgICAgICAvLyDkv53nlZnkuIrkuIDlsYLliIbmlbDvvJvoi6Xku43pq5jkuo7lvZPliY0gzrHvvIjlvILluLjvvInvvIznlaXpmY3ku6XlhY3mjKTmjonnnJ/mnIDkvJgNCiAgICAgICAgaXRlbS5zY29yZSA9IHJvb3RBbHBoYSAtIDFlLTM7DQogICAgICB9DQogICAgfQ0KDQogICAgc29ydFJvb3RNb3Zlc0J5U2NvcmUocm9vdE1vdmVzKTsNCiAgICBjb21wbGV0ZWREZXB0aCA9IGN1cnJlbnREZXB0aDsNCg0KICAgIC8vIOaKiuacrOWxguacgOS9s+edgOWGmeWFpSBUVO+8jOS+m+abtOa3seS4gOWxguagueaOkuW6jw0KICAgIHRyYW5zcG9zaXRpb25UYWJsZS5zdG9yZSgNCiAgICAgIHJvb3RUVEtleSwNCiAgICAgIGN1cnJlbnREZXB0aCwNCiAgICAgIHJvb3RNb3Zlc1swXS5zY29yZSwNCiAgICAgICdleGFjdCcsDQogICAgICByb290TW92ZXNbMF0sDQogICAgICBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFID8gKHJvb3RNb3Zlc1swXS5tb3ZlU2VxdWVuY2UgfHwgW10pIDogbnVsbA0KICAgICk7DQoNCiAgfQ0KDQogIGNvbnN0IGJlc3RNb3ZlID0gcm9vdE1vdmVzWzBdIHx8IG51bGw7DQogIGNvbnN0IHNlY29uZEJlc3RNb3ZlID0gcm9vdE1vdmVzLmxlbmd0aCA+IDEgPyByb290TW92ZXNbMV0gOiBudWxsOw0KICBjb25zdCBiZXN0TW92ZVNlcXVlbmNlID0gYmVzdE1vdmUgPyAoYmVzdE1vdmUubW92ZVNlcXVlbmNlIHx8IFtdKSA6IFtdOw0KICBjb25zdCBzZWNvbmRNb3ZlU2VxdWVuY2UgPSBzZWNvbmRCZXN0TW92ZSA/IChzZWNvbmRCZXN0TW92ZS5tb3ZlU2VxdWVuY2UgfHwgW10pIDogW107DQogIGNvbnN0IGJlc3RNb3ZlU2NvcmUgPSBiZXN0TW92ZSA/IGJlc3RNb3ZlLnNjb3JlIDogMDsNCiAgY29uc3Qgc2Vjb25kQmVzdE1vdmVTY29yZSA9IHNlY29uZEJlc3RNb3ZlID8gc2Vjb25kQmVzdE1vdmUuc2NvcmUgOiAwOw0KDQogIGNvbnN0IGFsbE1vdmVzV2l0aFNjb3JlcyA9IHJvb3RNb3Zlcy5tYXAoKG1vdmVJbmZvKSA9PiAoew0KICAgIG1vdmU6IHsNCiAgICAgIGZyb206IG1vdmVJbmZvLmZyb20sDQogICAgICB0bzogbW92ZUluZm8udG8NCiAgICB9LA0KICAgIHNjb3JlOiBtb3ZlSW5mby5zY29yZSwNCiAgICBtb3ZlU2VxdWVuY2U6IG1vdmVJbmZvLm1vdmVTZXF1ZW5jZSB8fCBbXQ0KICB9KSk7DQoNCiAgY29uc3QgcmVzdWx0ID0gew0KICAgIGJlc3RNb3ZlLA0KICAgIHNlY29uZEJlc3RNb3ZlLA0KICAgIG1vdmVTZXF1ZW5jZTogYmVzdE1vdmVTZXF1ZW5jZSwNCiAgICBzZWNvbmRNb3ZlU2VxdWVuY2UsDQogICAgYmVzdE1vdmVTY29yZSwNCiAgICBzZWNvbmRCZXN0TW92ZVNjb3JlLA0KICAgIGFsbE1vdmVzV2l0aFNjb3JlcywNCiAgICBjb21wbGV0ZWREZXB0aA0KICB9Ow0KICBhY3RpdmVTZWFyY2hQaWVjZVN0YXRlID0gbnVsbDsNCiAgcmV0dXJuIHJlc3VsdDsNCn07DQoNCi8vIFBsYXkga2VlcHMgcm9vdCBmYWlsLWxvdyBwcm9iZXMgYXMgYm91bmRzOyBhbmFseXNpcyByZS1zZWFyY2hlcyBldmVyeSBmaW5hbA0KLy8gcm9vdCBtb3ZlIGFuZCByZXRhaW5zIFBWIGRhdGEuIEtlZXBpbmcgdGhlaXIgZW50cnkgcG9pbnRzIHNlcGFyYXRlIHByZXZlbnRzDQovLyBmdXR1cmUgcGxheS1wYXRoIHdvcmsgZnJvbSBzaWxlbnRseSBjaGFuZ2luZyBhbmFseXNpcyBzZW1hbnRpY3MuDQpjb25zdCBnZXRCZXN0TW92ZUZvclBsYXkgPSAoYm9hcmQsIHR1cm4sIGRlcHRoLCBwbHksIGVuYWJsZVRpbWVMaW1pdCkgPT4NCiAgZ2V0QmVzdE1vdmVJbnRlcm5hbChib2FyZCwgdHVybiwgZGVwdGgsIHBseSwgZW5hYmxlVGltZUxpbWl0LCBmYWxzZSwgZmFsc2UpOw0KDQpjb25zdCBnZXRCZXN0TW92ZUZvckFuYWx5c2lzID0gKGJvYXJkLCB0dXJuLCBkZXB0aCwgcGx5LCBlbmFibGVUaW1lTGltaXQpID0+DQogIGdldEJlc3RNb3ZlSW50ZXJuYWwoYm9hcmQsIHR1cm4sIGRlcHRoLCBwbHksIGVuYWJsZVRpbWVMaW1pdCwgdHJ1ZSwgdHJ1ZSk7DQoNCmNvbnN0IGdldEJlc3RNb3ZlID0gKGJvYXJkLCB0dXJuLCBkZXB0aCA9IDgsIHBseSA9IDAsIGVuYWJsZVRpbWVMaW1pdCA9IGZhbHNlLCBleGFjdFJvb3RTY29yZXMgPSBmYWxzZSkgPT4NCiAgZXhhY3RSb290U2NvcmVzDQogICAgPyBnZXRCZXN0TW92ZUZvckFuYWx5c2lzKGJvYXJkLCB0dXJuLCBkZXB0aCwgcGx5LCBlbmFibGVUaW1lTGltaXQpDQogICAgOiBnZXRCZXN0TW92ZUZvclBsYXkoYm9hcmQsIHR1cm4sIGRlcHRoLCBwbHksIGVuYWJsZVRpbWVMaW1pdCk7DQoNCi8vIC0tLSBXT1JLRVIgTElTVEVORVIgKOe7n+S4gOa2iOaBr+WkhOeQhikgLS0tDQo=';
// 正确解码包含UTF-8字符的Base64字符串
const decodedData = atob(encodedWorkerCode);
const uint8Array = new Uint8Array(decodedData.length);
for (let i = 0; i < decodedData.length; i++) {
    uint8Array[i] = decodedData.charCodeAt(i);
}
const decodedWorkerCode = new TextDecoder('utf-8').decode(uint8Array);
const workerBlob = new Blob([decodedWorkerCode], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(workerBlob);
workerRef.current = new Worker(workerUrl);
URL.revokeObjectURL(workerUrl); // Clean up the URL object
console.log("✅ Worker loaded successfully (Inline Worker)");

            // Clean up the URL object after the worker has been created
            setTimeout(() => URL.revokeObjectURL(workerUrl), 100);

                // Automatically load opening book from inlined data
                try {
                    // Import opening book data from separate file
                    import('./openingBookData').then(({ openingBookData }) => {
                        const lines = openingBookData.trim().split('\n');
                        
                        // Send each line to the worker to add to the opening book
                        lines.forEach((line, index) => {
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
                        
                        console.log(`✅ Successfully loaded ${lines.length} opening lines from inlined book data`);
                    }).catch((error) => {
                        console.error('❌ Failed to import opening book data:', error);
                    });
                } catch (error) {
                    console.error('❌ Failed to load opening book:', error);
                }
        } catch (e) {
            console.error("❌ Failed to load worker:", e);
        }
        
        return () => {
            workerRef.current?.terminate();
        };
    }, []);

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
        
        // 只有在没有活跃音乐循环且应该播放音乐时，才触发音乐循环启动
        if (!musicLoopActiveRef.current && isMusicEnabled && hasStarted && !gameOver) {
            //console.log('🎵 Starting new music loop');
            setMusicTrigger(prev => prev + 1);
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

        // 生成简单的背景音乐段落
        const generateMusicPass = () => {
            if (!isMusicPlayingRef.current) return 0;
            
            const currentTime = ctx.currentTime;
            let time = currentTime + 0.1;
            const beatDuration = 0.8; // 慢速，75 BPM 左右

            // 简单的和弦进行
            const chords = [
                [220.00, 261.63, 329.63],  // Am
                [174.61, 220.00, 261.63],  // F
                [130.81, 164.81, 196.00],  // C
                [196.00, 246.94, 293.66]   // G
            ];

            // 播放单个和弦
            const playChord = (chordNotes: number[], startTime: number, duration: number) => {
                if (!isMusicPlayingRef.current) return;
                
                chordNotes.forEach((freq, index) => {
                    const osc = ctx.createOscillator();
                    const noteGain = ctx.createGain();
                    
                    osc.type = 'triangle';
                    osc.frequency.value = freq;
                    
                    // 简单的包络
                    noteGain.gain.setValueAtTime(0, startTime);
                    noteGain.gain.linearRampToValueAtTime(0.2, startTime + 0.1);
                    noteGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
                    
                    osc.connect(noteGain);
                    noteGain.connect(gain);
                    
                    osc.start(startTime);
                    osc.stop(startTime + duration);
                });
            };

            // 播放4个和弦，每个和弦4拍
            chords.forEach((chord, index) => {
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
    }, [isMusicEnabled, hasStarted, gameOver]); // 依赖游戏状态和音乐开关

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

    // 生成棋盘哈希（简化版FEN）
    const generateBoardHash = (board: Board, turn: Color): string => {
        let hash = '';
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const piece = board[r][c];
                if (piece) {
                    const symbol = piece.type[0].toUpperCase();
                    hash += piece.color === 'red' ? symbol : symbol.toLowerCase();
                } else {
                    hash += '.';
                }
            }
            hash += '/';
        }
        hash += turn; // 加上当前回合方
        return hash;
    };

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
        history: Array<{ 
            hash: string; 
            capturedTarget?: { type: PieceType; position: Position };
            initiator?: Color; // 主动发起方（将军或捉子的一方）
            isCheck?: boolean; // 是否将军
            isChase?: boolean; // 是否捉子
        }>, 
        lastMove: Move, 
        boardBeforeMove: Board,
        turn: Color
    ): Promise<{ violation: boolean; type: 'chase' | 'check' | null }> => {
        // 模拟走棋后的棋盘
        const newBoard = boardBeforeMove.map(row => [...row]);
        newBoard[lastMove.to.r][lastMove.to.c] = newBoard[lastMove.from.r][lastMove.from.c];
        newBoard[lastMove.from.r][lastMove.from.c] = null;
        
        // 检查走棋后是否构成将军（对手是否被将军）
        const enemyColor = turn === 'red' ? 'black' : 'red';
        const isCheck = await isBoardInCheck(newBoard, enemyColor);
        
        // 检查当前走法是否构成捉子
        const capturingResult = await isCapturingThreat(boardBeforeMove, lastMove, turn);
        const isChase = capturingResult.isThreat && capturingResult.targetPiece;
        const currentTarget = capturingResult.targetPiece;
        
        // 确定发起方：如果构成将军或捉子，当前走棋方是发起方
        const initiator = (isCheck || isChase) ? turn : undefined;
        
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
        
        // 在Auto模式下，当局面重复3次时，也返回违规，触发重新计算走法
        // 这样可以避免局面重复导致和棋
        // 只在当前走棋方是Auto模式时才触发
        const count = history.filter(h => h.hash === newHash).length + 1;
        if (count >= 4 && ((turn === 'red' && redIsAuto) || (turn === 'black' && blackIsAuto))) {
            console.log('⚠️ Auto模式：当前局面已重复' + count + '次，触发变招避免和棋');
            return { violation: true, type: 'chase' }; // 使用'chase'类型，不影响现有逻辑
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



    // 通用的搜索和执行走法函数，用于AI和玩家Auto模式
    const searchAndExecuteMove = async (currentBoard: Board, currentTurn: Color, searchDepth: number, capturedGameId: number, randomness: number = 0, ply: number = 0, isAutoMode: boolean = false, delay: number = 0, enableTimeLimit: boolean = false) => {
        // 开始搜索，显示齿轮转动效果
        setIsThinking(true);
        
        // 辅助函数定义
        // 获取当前玩家的所有合法走法
        const getAllMoves = async (board: Board, turn: Color): Promise<Move[]> => {
            const allMoves: Move[] = [];
            for (let r = 0; r < 10; r++) {
                for (let c = 0; c < 9; c++) {
                    if (board[r][c]?.color === turn) {
                        const moves = await workerGetValidMoves(board, { r, c });
                        moves.forEach(to => {
                            allMoves.push({ from: { r, c }, to });
                        });
                    }
                }
            }
            return allMoves;
        };
        
        // 寻找第一个不导致重复的有效走法
        const findValidMove = async (moves: Move[], excludeMoves: Move[] = []): Promise<Move | null> => {
            for (const move of moves) {
                // 跳过排除的走法
                const isExcluded = excludeMoves.some(ex => 
                    ex.from.r === move.from.r && ex.from.c === move.from.c &&
                    ex.to.r === move.to.r && ex.to.c === move.to.c
                );
                if (isExcluded) continue;
                
                const testBoard = currentBoard.map(row => [...row]);
                testBoard[move.to.r][move.to.c] = testBoard[move.from.r][move.from.c];
                testBoard[move.from.r][move.from.c] = null;
                const nextTurn = currentTurn === 'red' ? 'black' : 'red';
                const hash = generateBoardHash(testBoard, nextTurn);
                const check = await checkRepetition(hash, positionHistory, move, currentBoard, currentTurn);
                
                if (!check.violation) {
                    console.log('✅ 找到有效走法:', move);
                    return move;
                }
            }
            return null;
        };
        
        // 尝试执行一个走法（包括有效性检查和重复性检查）
        const tryMove = async (move: Move | undefined): Promise<boolean> => {
            // 检查有效性
            if (!(move && move.from && move.to && 
                typeof move.from.r === 'number' && typeof move.from.c === 'number' &&
                typeof move.to.r === 'number' && typeof move.to.c === 'number')) {
                return false;
            }
            // 检查重复性
            const check = await checkMoveRepetition(move);
            if (check.violation) {
                console.log('⚠️ 走法', move, '会导致', check.type === 'check' ? '长将' : '长捉或局面重复', ':', check.type);
                return false;
            }
            return true;
        };
        
        // 执行走法并处理延迟
        const executeMoveWithDelay = async (move: Move, turn: Color, isAutoMode: boolean, delay: number) => {
            setIsThinking(false);
            
            // 设置提示移动和自动移动等待状态，无论是AI还是Auto模式
            // 这确保AI和玩家Auto模式有相同的延迟和指示器效果
            setHintMove(move);
            setIsAutoMovePending(true);
            
            if (delay > 0) {
                setTimeout(async () => {
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
                    setIsAutoMovePending(false);
                }, delay);
            } else {
                await executeMove(move, turn);
                setHintMove(null);
                setIsAutoMovePending(false);
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
            const hash = generateBoardHash(testBoard, nextTurn);
            return await checkRepetition(hash, positionHistory, move, currentBoard, currentTurn);
        };
        
        // 尝试寻找替代走法（当最优和次优走法都导致重复时）
        const tryAlternativeMoves = async (excludeMoves: Move[]) => {
            const allMoves = await getAllMoves(currentBoard, currentTurn);
            const filteredExcludeMoves = excludeMoves.filter(m => m && m.from && m.to);
            const validMove = await findValidMove(allMoves, filteredExcludeMoves);
            if (validMove) {
                await executeMoveWithDelay(validMove, currentTurn, isAutoMode, delay);
                return;
            }
            
            // 所有走法都会导致重复，随机选择一个
            console.warn('⚠️ 所有走法都会导致重复！随机选择一个避免死局');
            const randomMove = allMoves[Math.floor(Math.random() * allMoves.length)];
            if (randomMove) {
                console.log('🎲 随机选择走法:', randomMove);
                await executeMoveWithDelay(randomMove, currentTurn, isAutoMode, delay);
            } else {
                console.error('❌ 无法找到任何有效走法！');
                setIsThinking(false);
                setTimeout(() => {
                    setGameId(prev => prev + 1);
                }, 500);
            }
        };
        
        // Define message handler
        const handleWorkerMessage = async (e: MessageEvent) => {
            console.log('Worker message received:', e.data.type);
            const { type, payload } = e.data;
            if (type === 'SEARCH_COMPLETE') {
                // 无论gameId是否匹配，都要移除事件监听器
                workerRef.current?.removeEventListener('message', handleWorkerMessage);
                
                if (payload.gameId === capturedGameId) {
                    setLastSearchBench({
                        thinkingTime: payload.thinkingTime ?? 0,
                        completedDepth: payload.completedDepth,
                        perf: payload.perf
                    });
                    // 首先尝试使用最优走法
                    const newBestMoveSequence = payload.moveSequence || [];
                    const newSecondBestMoveSequence = payload.secondMoveSequence || [];
                    const newBestMoveScore = payload.bestMoveScore || 0;
                    const newSecondBestMoveScore = payload.secondBestMoveScore || 0;
                    // 更新最优着法序列、次优着法序列和净胜分状态
                    setBestMoveSequence(newBestMoveSequence);
                    setSecondBestMoveSequence(newSecondBestMoveSequence);
                    setBestMoveScore(newBestMoveScore);
                    setSecondBestMoveScore(newSecondBestMoveScore);
                    // 设置隐藏最优着法和次优着法
                    setHiddenBestMove(payload.bestMove);
                    setSuboptimalMove(payload.secondBestMove);
                    
                    // 填充所有着法到analysisMoves，复用Analysis的着法序列控件
                    const formattedAnalysisMoves = (payload.allMovesWithScores || []).map(moveData => ({
                        move: moveData.move,
                        score: moveData.score,
                        moveSequence: moveData.moveSequence || []
                    }));
                    setAnalysisMoves(formattedAnalysisMoves);
                    // 重置选中状态
                    setSelectedAnalysisMove(null);
                    // 重置预览状态
                    setIsPreviewing(false);
                    setOriginalBoardForPreview(null);
                    
                    // 检查最优走法是否有效
                    // 使用新的线性流程：先尝试最优走法，再尝试次优走法，最后尝试随机走法
                    
                    // 尝试最优走法
                    if (await tryMove(payload.bestMove)) {
                        await executeMoveWithDelay(payload.bestMove, currentTurn, isAutoMode, delay);
                        return;
                    }
                    
                    // 尝试次优走法
                    if (await tryMove(payload.secondBestMove)) {
                        await executeMoveWithDelay(payload.secondBestMove, currentTurn, isAutoMode, delay);
                        return;
                    }
                    
                    // 尝试其他走法
                    const allMoves = await getAllMoves(currentBoard, currentTurn);
                    if (allMoves.length === 0) {
                        setIsThinking(false);
                        setTimeout(() => {
                            setGameId(prev => prev + 1);
                        }, 500);
                        return;
                    }
                    
                    // 排除已经尝试过的最优和次优走法
                    const excludeMoves = [payload.bestMove, payload.secondBestMove].filter(m => m);
                    const validMove = await findValidMove(allMoves, excludeMoves);
                    if (validMove) {
                        await executeMoveWithDelay(validMove, currentTurn, isAutoMode, delay);
                        return;
                    }
                    
                    // 所有走法都会导致重复，随机选择一个
                    console.warn('⚠️ 所有走法都会导致重复！随机选择一个避免死局');
                    const randomMove = allMoves[Math.floor(Math.random() * allMoves.length)];
                    if (randomMove) {
                        console.log('🎲 随机选择走法:', randomMove);
                        await executeMoveWithDelay(randomMove, currentTurn, isAutoMode, delay);
                    } else {
                        console.error('❌ 无法找到任何有效走法！');
                        setIsThinking(false);
                        setTimeout(() => {
                            setGameId(prev => prev + 1);
                        }, 500);
                    }
                } else {
                    // 如果gameId不匹配，也要确保isThinking被设置为false
                    setIsThinking(false);
                }
            }
        };

        // console.log('Worker available?', !!workerRef.current);
        // console.log('🔍 Current moveHistory.length:', moveHistory.length);
        // console.log('🔍 moveHistory:', moveHistory);
        if (workerRef.current) {
            // console.log('✅ Using Worker for AI move (non-blocking)');
            workerRef.current.addEventListener('message', handleWorkerMessage);
            workerRef.current.postMessage({
                type: 'SEARCH',
                payload: {
                    board: currentBoard,
                    turn: currentTurn,
                    depth: searchDepth,
                    randomness: randomness,
                    ply: ply,
                    gameId: capturedGameId,
                    openingBookEnabled: openingBookEnabled,
                    enableTimeLimit: enableTimeLimit,
                    exactRootScores: false // 对弈：标准 PVS，不为 Analysis 全根回搜
                }
            });
        } else {
            // console.warn("⚠️ Worker not available, running on main thread (UI will freeze)");
            setIsThinking(false);
        }

        return () => {
            workerRef.current?.removeEventListener('message', handleWorkerMessage);
        };
    };

    // AI Turn Logic
    useEffect(() => {
        //console.log('AI Effect triggered:', { turn, playerColor, gameOver, isReplaying, isSetupMode, redIsAuto, blackIsAuto });
        // Check if current player should be controlled by AI
        const shouldAIMove = (turn === 'red' && redIsAuto) || (turn === 'black' && blackIsAuto);
        
        if (shouldAIMove && !gameOver && !isReplaying && !isSetupMode && !isThinking) {
            //console.log('AI should move now!');
            if (!hasStarted) setHasStarted(true);
         
            const capturedGameId = gameId;
            const config = DIFFICULTIES[difficulty];
            // 使用用户设置的AI深度，覆盖难度级别的默认深度
            const searchDepth = aiDepth;
            console.log('AI config:', { ...config, depth: searchDepth }, 'gameId:', capturedGameId);

            // 调用通用的搜索和执行走法函数，为AI走棋添加1秒延迟，使用Setting面板中的TimeLimit开关设置
            searchAndExecuteMove(board, turn, searchDepth, capturedGameId, config.randomness, moveHistory.length, true, 1000, enableTimeLimit);

            return () => {
                // 清理逻辑
            };
        }
    }, [turn, playerColor, gameOver, isReplaying, isSetupMode, hasStarted, difficulty, gameId, redIsAuto, blackIsAuto]);

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
        
        // 移动前评估当前局面
        //console.log('executeMove: evaluating current board');
        const preMoveEval = await workerGetDetailedEval(board, turn, isReplaying);
        
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
        const newHash = generateBoardHash(newBoard, nextTurn);
        
        // 检测是否是捉子
        const capturingResult = await isCapturingThreat(board, move, turn);
        
        // 长将/长捉检测已在searchAndExecuteMove函数中完成，这里不再重复检测
        // 只对玩家手动走棋进行检测，且至少有3个历史记录才进行检测
        
        const currentColorIsManual = (turn === 'red' && !redIsAuto) || (turn === 'black' && !blackIsAuto);
        if (turn === playerColor && currentColorIsManual && positionHistory.length >= 4) {
            const repetitionCheck = await checkRepetition(newHash, positionHistory, move, board, turn);
            
            if (repetitionCheck.violation) {
                const violationType = repetitionCheck.type === 'check' ? '长将' : '长捉';
                console.log('👤 玩家手动走棋违规，判负');
                const violationWinner = turn === 'red' ? 'black' : 'red';
                // 调用游戏结束处理函数
                handleGameOver('checkmate', violationWinner, `${violationType}违规！${turn === 'red' ? '红方' : '黑方'}判负`);
                return false; // 不执行这步棋，也不更新历史记录
            }
        }
        
        
        // 长将/长捉检测通过，设置行棋动画
        // 在所有模式下都设置行棋动画
        setMoveAnimation({ 
            from: move.from, 
            to: move.to,
            id: Date.now(),
            piece: board[move.from.r][move.from.c] // 保存起始位置的棋子信息
        });
        
        // 只有在没有长将/长捉违规的情况下，才更新历史记录
        // boardHistory包含初始局面和每一步移动后的局面，长度为moveHistory.length + 1
        setBoardHistory(prev => [...prev, newBoard]);
        setMoveHistory(prev => [...prev, move]);
        
        // 检查是否构成将军（走棋后对手是否被将军）
        const isCheck = await isBoardInCheck(newBoard, nextTurn);
        const isChase = capturingResult.isThreat;
        const initiator = (isCheck || isChase) ? turn : undefined;
        
        // 更新局面历史
        const updatedPositionHistory = [...positionHistory, { 
            hash: newHash, 
            capturedTarget: capturingResult.isThreat ? capturingResult.targetPiece : undefined,
            initiator,
            isCheck,
            isChase
        }];
        setPositionHistory(updatedPositionHistory);

        // 检查局面重复次数
        const hashCount = updatedPositionHistory.filter(h => h.hash === newHash).length;
        if (hashCount >= 4) {
            // 检查是否不属于长将和长捉的情况
            const inCheck = await isBoardInCheck(newBoard, nextTurn);
            const isThreat = capturingResult.isThreat;
            
            if (!inCheck && !isThreat) {
                // 调用游戏结束处理函数
                handleGameOver('draw', null, '局面重复4次，判定和棋！');
            }
        }

        // 重置选择状态和有效移动
        setSelectedPos(null);
        setValidMoves([]);
        setPieceRelations({ threat: [], threatenedBy: [], guard: [], guardedBy: [] });
        setSelectedPieceEval(null);
        
        // 0.3秒后清除动画状态，动画时长为0.3秒
        // 使用clearTimeout确保只有一个定时器在运行
        if (animationTimeoutRef.current) {
            clearTimeout(animationTimeoutRef.current);
        }
        animationTimeoutRef.current = setTimeout(() => {
            // 动画结束时播放音效
            if (hasCapture) {
                playCaptureSound(); // 吃子音效
            } else {
                playMoveSound(); // 普通移动音效
            }
            setMoveAnimation(null);
        }, 300);
        
        // 检查连续无吃子回合是否达到30回合
        // 由于每方走一步算一个回合，当计数器达到60时表示30个回合（每个方走30步）
        // 直接检查当前步骤后应该有的计数器值
        const newCounter = targetPiece ? 0 : drawMoveCounter + 1;
        if (newCounter >= 60) {
            // 调用游戏结束处理函数
            handleGameOver('draw', null, '连续30回合无吃子，判定和棋！');
        }
        
        // Increment step count for the player who just moved
        if (currentTurn === 'red') {
            setRedStepCount(prev => prev + 1);
        } else {
            setBlackStepCount(prev => prev + 1);
        }
        
        setSelectedPos(null);
        setValidMoves([]);
        
        // 更新棋盘状态
        setBoard(newBoard);
        // 只有在非重试模式下才自动切换回合
        if (!isRetryMode) {
            setTurn(nextTurn);
        }
        
        // 在棋盘状态更新后设置最近被吃的棋子
        // 使用setTimeout确保在下次渲染后执行，此时capturedInfo已经更新
        if (targetPiece) {
            setTimeout(() => {
                setRecentlyCaptured({ color: targetPiece.color, type: targetPiece.type });
                // 4秒后清除最近被吃的棋子标记，与旋转动画时长匹配
                setTimeout(() => setRecentlyCaptured(null), 4000);
            }, 0);
        };
        // 走子后立刻根据已算好的将军结果更新提示（将/帅闪动），避免等 checkGameState 才显示
        setCheckAlert(isCheck);
        setHintMove(null);
        setSelectedPieceEval(null);
        
        // 移动后评估新局面
        const postMoveEval = await workerGetDetailedEval(newBoard, nextTurn, isReplaying);
        
        // 计算红方分数变化
        const redDiff = {
            total: postMoveEval.red.total - preMoveEval.red.total,
            material: postMoveEval.red.material - preMoveEval.red.material,
            position: postMoveEval.red.position - preMoveEval.red.position,
            tactic: postMoveEval.red.tactic - preMoveEval.red.tactic,
            safety: postMoveEval.red.safety - preMoveEval.red.safety,
            mobility: postMoveEval.red.mobility - preMoveEval.red.mobility,
            threat: postMoveEval.red.threat - preMoveEval.red.threat
        };
        
        // 计算黑方分数变化
        const blackDiff = {
            total: postMoveEval.black.total - preMoveEval.black.total,
            material: postMoveEval.black.material - preMoveEval.black.material,
            position: postMoveEval.black.position - preMoveEval.black.position,
            tactic: postMoveEval.black.tactic - preMoveEval.black.tactic,
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
        setMoveEvaluation(evaluationData);
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
        console.log(`- 战术(tactic): ${redDiff.tactic.toFixed(2)}`);
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
        console.log(`- 战术(tactic): ${blackDiff.tactic.toFixed(2)}`);
        console.log('==================');
        */
        // 为了用户能更直观地看到，我们可以考虑在界面上显示这些信息
        // 例如，可以在聊天区域或专用的评估面板中展示
        
        // 如果在Try模式下成功走棋，标记为已经走过棋
        if (isRetryMode) {
            setHasMovedInRetryMode(true);
        }
        return true;
    };
    executeMoveRef.current = executeMove;

    const handlePieceSelect = async (pos: Position) => {
        //console.log('handlePieceSelect called with pos:', pos);
        // 点击棋子不播放背景音乐
        
        if (selectedPos?.r === pos.r && selectedPos?.c === pos.c) {
            //console.log('handlePieceSelect: clicking the same piece, deselecting');
            setSelectedPos(null);
            setValidMoves([]);
            setPieceRelations({ threat: [], threatenedBy: [], guard: [], guardedBy: [] });
            setSelectedPieceEval(null);
            return;
        }
        
        // 获取当前棋盘状态
        const currentBoard = isReplaying ? allReplayBoards[replayIndex] : board;

            
        const piece = currentBoard[pos.r][pos.c];
        
        // 如果点击的是空位置，获取该位置的控制者信息
        if (!piece) {
            //console.log('handlePieceSelect: clicking empty position, showing controllers');
            setSelectedPos(pos); // 设置选中位置，用于显示控制者信息
            setValidMoves([]);
            
            // 调用worker获取该位置的控制者信息
            if (workerRef.current) {
                const handleMessage = (e: MessageEvent) => {
                    if (e.data.type === 'pieceRelations') {
                        workerRef.current?.removeEventListener('message', handleMessage);
                        setPieceRelations(e.data.relations);
                        setSelectedPieceEval(null);
                    }
                };
                
                workerRef.current.addEventListener('message', handleMessage);
                workerRef.current.postMessage({
                    type: 'getPieceRelations',
                    payload: {
                        board: currentBoard,
                        pos: pos
                    }
                });
            }
            return;
        }
        
        // 允许选择任何棋子来查看关系
        setSelectedPos(pos);
        //console.log('handlePieceSelect: selected piece at pos:', pos);
        
        // 在所有模式下都显示有效移动（Setup模式下不显示）
        if (!isSetupMode) {
            // 检查是否是己方回合
            const currentTurn = isReplaying ? (replayIndex % 2 === 0 ? 'red' : 'black') : turn;
            //console.log('handlePieceSelect: currentTurn:', currentTurn, 'piece.color:', piece.color);
            // 检查是否为当前颜色的回合，不管是人工还是Auto
            const isMyTurn = currentTurn === piece.color;
            // 联机时仅己方棋子可走
            const canControlPiece = !onlineInfo || piece.color === onlineInfo.myColor;
            //console.log('handlePieceSelect: isMyTurn:', isMyTurn);
            
            // 只有当前回合的棋子才显示有效移动
            if (isMyTurn && canControlPiece) {
                //console.log('handlePieceSelect: getting valid moves for piece at pos:', pos);
                try {
                    const moves = await workerGetValidMoves(currentBoard, pos);
                    //console.log('handlePieceSelect: valid moves:', moves);
                    setValidMoves(moves);
                } catch (error) {
                    //console.error('handlePieceSelect: Failed to get valid moves:', error);
                    setValidMoves([]);
                }
            } else {
                //console.log('handlePieceSelect: not my turn, setting validMoves to empty array');
                setValidMoves([]);
            }
        } else {
            // Setup模式下不显示有效移动
            setValidMoves([]);
        }
        
        // 在所有模式下获取单个棋子的评估值
        try {
            // Setup模式下使用当前turn
            const currentTurn = isSetupMode ? turn : (isReplaying ? (replayIndex % 2 === 0 ? 'red' : 'black') : turn);
            const pieceEval = await workerGetPieceEval(currentBoard, pos, currentTurn);
            setSelectedPieceEval(pieceEval);
        } catch (error) {
            //console.error('handlePieceSelect: Failed to get piece evaluation:', error);
            setSelectedPieceEval(null);
        }
        
        // 计算棋子关系，传入当前棋盘状态
        await calculatePieceRelations(pos, currentBoard);
    };

    // 计算棋子关系（威胁者、被威胁者、保护者、被保护者）
    const calculatePieceRelations = async (pos: Position, currentBoard: Board) => {
        return new Promise<void>((resolve) => {
            if (!workerRef.current) {
                setPieceRelations({ threat: [], threatenedBy: [], guard: [], guardedBy: [] });
                resolve();
                return;
            }

            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'pieceRelations') {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    setPieceRelations(e.data.relations);
                    resolve();
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'getPieceRelations',
                payload: { board: currentBoard, pos }
            });
        });
    };

    const handleMove = async (to: Position) => {
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
            const applied = await executeMove({ from, to }, moveTurn);
            if (applied && onlineInfo && !applyingRemoteRef.current) {
                peerSessionRef.current?.send({ type: 'move', from, to, ply });
            }
        } else {
            console.log('handleMove: invalid move, not executing');
        }
    };

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
            setAppScreen('game');
            setHasStarted(true);
            return;
        }
        if (msg.type === 'ready') {
            setConnectionStatus('connected');
            setLobbyStatusMessage(null);
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
            handleGameOver('checkmate', info.myColor, '对方认输');
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
    };

    const prepareFreshGame = (mode: 'ai' | 'local' | 'online') => {
        handleRestartRef.current();
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
                leaveToLobby(reason || '连接已断开');
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
                            '加入超时。请确认房间码；若双方不在同一 Wi‑Fi（尤其手机流量），网络可能阻止了 P2P，请改连同一局域网后重试。',
                        );
                    }
                }, 35000);
            }
        } catch (err) {
            if (joinTimer) clearTimeout(joinTimer);
            const message = err instanceof Error ? err.message : '无法建立联机';
            leaveToLobby(message);
        }
    };

    const handleCreateRoom = (nick: string) => {
        void startOnlineSession('host', nick, generateRoomCode());
    };

    const handleJoinRoom = (nick: string, roomCode: string) => {
        const code = roomCode.trim().toLowerCase();
        if (code.length < 4) {
            setLobbyStatusMessage('请输入有效房间码');
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
            window.prompt('复制邀请链接', url.toString());
        }
    };

    const handleOnlineResign = () => {
        if (!onlineInfo) return;
        peerSessionRef.current?.send({ type: 'resign' });
        const winner: Color = onlineInfo.myColor === 'red' ? 'black' : 'red';
        handleGameOver('checkmate', winner, '你已认输');
    };

    useEffect(() => {
        return () => {
            destroyPeerSession();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleRestart = () => {
        // 清除游戏结束定时器
        if (gameOverTimerRef.current) {
            clearTimeout(gameOverTimerRef.current);
            gameOverTimerRef.current = null;
        }
        setPendingGameOver(null);
        
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
        
        // 清理所有指示器
        setSelectedPos(null);
        setValidMoves([]);
        setPieceRelations({ threat: [], threatenedBy: [], guard: [], guardedBy: [] });
        setSelectedPieceEval(null);
        setCheckAlert(false);
        setHintMove(null);
        setIsReplaying(false);
        setFlyingPiece(null);
        setHiddenBestMove(null);
        setSuboptimalMove(null);
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
        
        // 重置moveEvaluation为所有0的对象，确保Restart后显示EVALUATION UI
        setMoveEvaluation({
            pre: {
                red: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 },
                black: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 }
            },
            post: {
                red: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 },
                black: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 }
            },
            diff: {
                red: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 },
                black: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 }
            }
        });
        
        // 随机选择新的棋盘和棋子
        const skins: Skin[] = ['stone-board', 'wood-board', 'paper-board', 'glass-board'];
        const materials: PieceMaterial[] = ['wood', 'stone', 'metal', 'glass'];
        setSkin(skins[Math.floor(Math.random() * skins.length)]);
        setMaterial(materials[Math.floor(Math.random() * materials.length)]);
    };
    handleRestartRef.current = handleRestart;

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
            
            // 清理所有指示器
            setSelectedPos(null);
            setValidMoves([]);
            setPieceRelations({ threat: [], threatenedBy: [], guard: [], guardedBy: [] });
            setSelectedPieceEval(null);
            setHiddenBestMove(null);
            setSuboptimalMove(null);
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
        setIsRetryMode(false);
        setHintMove(null);
        setIsAutoMovePending(false);
        setCheckAlert(false);
        setRecentlyCaptured(null);
        setBestMoveSequence([]);
        setSecondBestMoveSequence([]);
        setBestMoveScore(0);
        setSecondBestMoveScore(0);
        setHiddenBestMove(null);
        setSuboptimalMove(null);
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
                
                alert('棋局加载成功！');
            } catch (error) {
                console.error('Failed to load game:', error);
                alert('加载棋局失败，请检查文件格式。');
            }
        };
        reader.readAsText(file);
        
        // 重置文件输入，以便可以重新选择同一文件
        e.target.value = '';
    };

    const handleDragStart = (e: React.DragEvent, data: any) => {
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', JSON.stringify(data));
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDropOnBoard = async (e: React.DragEvent, toPos: Position) => {
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
    };
    
    // 处理棋盘上的右键点击事件，用于在Setup模式下将棋子放回Capture Panel
    const handleRightClickOnBoard = (pos: Position) => {
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
    };

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
            
            const newBoard = board.map(row => [...row]);
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
                
                // Send each line to the worker to add to the opening book
                lines.forEach((line, index) => {
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
    
    // 异步检查游戏状态（移动到allReplayBoards声明之后）
    useEffect(() => {
        if (isSetupMode) return;

        // 防止旧请求在 AI SEARCH 排队后晚到，把 executeMove 已设好的 checkAlert 盖掉
        let cancelled = false;
        
        // 异步检查游戏状态
        const checkGameStatus = async () => {
            let currentBoard = board;
            let currentTurn = turn;
            
            // 如果是Replay模式，使用当前回放的棋盘和回合
            if (isReplaying) {
                // 直接计算当前回放的棋盘，不使用displayBoard变量
                const replayBoard = allReplayBoards[replayIndex] || createInitialBoard();
                currentBoard = replayBoard;
                currentTurn = replayIndex % 2 === 0 ? 'red' : 'black';
            }
            
            // 在Replay模式下只检查将军状态，不处理游戏结束逻辑
            if (isReplaying) {
                const isCheckState = await workerIsCheck(currentBoard, currentTurn);
                if (cancelled) return;
                setCheckAlert(isCheckState);
                
                // 如果是将军状态，播放将军音效
                if (isCheckState) {
                    playCheckSound();
                }
            } else {
                // 非Replay模式，执行完整的游戏状态检查
                const state = await workerCheckGameState(currentBoard, currentTurn);
                if (cancelled) return;
                if (state.status !== 'playing') {
                    // 设置待定的游戏结束状态
                    setPendingGameOver(state);
                    
                    // 将死时仍显示被将闪动；困毙则清除
                    if (state.status === 'checkmate') {
                        setCheckAlert(true);
                        playCheckSound();
                    } else {
                        setCheckAlert(false);
                    }
                    
                    // 清除之前的定时器（如果存在）
                    if (gameOverTimerRef.current) {
                        clearTimeout(gameOverTimerRef.current);
                    }
                    
                    // 5秒后显示游戏结束界面
                    gameOverTimerRef.current = setTimeout(() => {
                        // 调用游戏结束处理函数
                        handleGameOver(state.status, state.winner);
                        setPendingGameOver(null);
                    }, 5000);
                } else {
                    // 游戏继续进行，清除待定状态
                    setPendingGameOver(null);
                    if (gameOverTimerRef.current) {
                        clearTimeout(gameOverTimerRef.current);
                        gameOverTimerRef.current = null;
                    }
                    const isCheckState = await workerIsCheck(currentBoard, currentTurn);
                    if (cancelled) return;
                    setCheckAlert(isCheckState);
                    
                    // 如果是将军状态，播放将军音效
                    if (isCheckState) {
                        playCheckSound();
                    }
                }
            }
        };
        
        checkGameStatus();
        
        // 清理函数
        return () => {
            cancelled = true;
            if (gameOverTimerRef.current) {
                clearTimeout(gameOverTimerRef.current);
            }
        };
    }, [board, turn, isReplaying, isSetupMode, replayIndex, allReplayBoards]);

    // Replay Evaluation Logic
    const [replayEvaluation, setReplayEvaluation] = useState<MoveEvaluation>({
        pre: {
            red: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 }
        },
        post: {
            red: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 }
        },
        diff: {
            red: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 },
            black: { total: 0, material: 0, position: 0, tactic: 0, safety: 0, mobility: 0, threat: 0 }
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
                    tactic: 0,
                    safety: 0,
                    mobility: 0,
                    threat: 0
                };
                
                preEvalBlack = {
                    total: 0,
                    material: 0,
                    position: 0,
                    tactic: 0,
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
                    tactic: postEvalRed.tactic - 0,
                    safety: postEvalRed.safety - 0,
                    mobility: postEvalRed.mobility - 0,
                    threat: postEvalRed.threat - 0
                };
                
                diffBlack = {
                    total: postEvalBlack.total - 0,
                    material: postEvalBlack.material - 0,
                    position: postEvalBlack.position - 0,
                    tactic: postEvalBlack.tactic - 0,
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
                    tactic: postEvalRed.tactic - preEvalRed.tactic,
                    safety: postEvalRed.safety - preEvalRed.safety,
                    mobility: postEvalRed.mobility - preEvalRed.mobility,
                    threat: postEvalRed.threat - preEvalRed.threat
                };
                
                diffBlack = {
                    total: postEvalBlack.total - preEvalBlack.total,
                    material: postEvalBlack.material - preEvalBlack.material,
                    position: postEvalBlack.position - preEvalBlack.position,
                    tactic: postEvalBlack.tactic - preEvalBlack.tactic,
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
            const searchDepth = aiDepth; // 使用aiDepth作为搜索深度
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
                            bestMove: e.data.payload.bestMove,
                            secondMove: e.data.payload.secondBestMove,
                            moveSequence: e.data.payload.moveSequence || [],
                            bestMoveScore: e.data.payload.bestMoveScore || 0,
                            secondBestMoveScore: e.data.payload.secondBestMoveScore || 0,
                            allMovesWithScores: e.data.payload.allMovesWithScores || []
                        });
                    } else if (e.data.type === 'bestMove') {
                        workerRef.current?.removeEventListener('message', handleWorkerMessage);
                        resolve({
                            bestMove: e.data.move,
                            secondMove: e.data.secondMove,
                            moveSequence: e.data.moveSequence || [],
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
                        board: currentBoard,
                        turn: currentTurn,
                        depth: searchDepth,
                        randomness: config.randomness,
                        ply: moveHistory.length,
                        gameId: capturedGameId,
                        openingBookEnabled: openingBookEnabled,
                        enableTimeLimit: enableTimeLimit,
                        exactRootScores: true // Analysis：全部根着法精确分
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
                                tactic: 0,
                                safety: 0,
                                mobility: 0,
                                threat: 0
                            },
                            black: {
                                total: 0,
                                material: 0,
                                position: 0,
                                tactic: 0,
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
            alert('分析棋局失败，请重试');
        }
        
        setIsAnalyzing(false);
    };
    
    // 为点击的着法计算其着法序列
    const calculateMoveSequence = async (move: Move, index: number) => {
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
                return;
            }
            
            // 创建应用该着法后的棋盘
            const newBoard = JSON.parse(JSON.stringify(currentBoard)) as Board;
            newBoard[move.to.r][move.to.c] = newBoard[move.from.r][move.from.c];
            newBoard[move.from.r][move.from.c] = null;
            
            // 为这个新棋盘计算着法序列
            const nextTurn = currentTurn === 'red' ? 'black' : 'red';
            const config = DIFFICULTIES[difficulty];
            const searchDepth = aiDepth - 1; // 减少深度以加快计算
            const capturedGameId = gameId;
            
            const searchResult = await new Promise<{
                moveSequence: Move[];
            }>((resolve) => {
                if (!workerRef.current) {
                    resolve({ moveSequence: [] });
                    return;
                }

                const handleWorkerMessage = (e: MessageEvent) => {
                    if (e.data.type === 'SEARCH_COMPLETE') {
                        workerRef.current?.removeEventListener('message', handleWorkerMessage);
                        resolve({
                            moveSequence: e.data.payload.moveSequence || []
                        });
                    } else if (e.data.type === 'bestMove') {
                        workerRef.current?.removeEventListener('message', handleWorkerMessage);
                        resolve({
                            moveSequence: e.data.moveSequence || []
                        });
                    }
                };

                workerRef.current.addEventListener('message', handleWorkerMessage);
                workerRef.current.postMessage({
                    type: 'SEARCH',
                    payload: {
                        board: newBoard,
                        turn: nextTurn,
                        depth: searchDepth,
                        randomness: config.randomness,
                        ply: moveHistory.length + 1,
                        gameId: capturedGameId,
                        openingBookEnabled: openingBookEnabled,
                        enableTimeLimit: enableTimeLimit,
                        exactRootScores: false // 只补单条 PV，无需全根精确分
                    }
                });
            });
            
            // 更新分析结果中的着法序列
            setAnalysisMoves(prevMoves => 
                prevMoves.map((item, i) => 
                    i === index ? { ...item, moveSequence: [move, ...searchResult.moveSequence] } : item
                )
            );
        } catch (error) {
            console.error('Error calculating move sequence:', error);
        }
    };
    
    // 获取所有合法走法的辅助函数
    const getAllValidMoves = async (board: Board, color: Color): Promise<Move[]> => {
        const moves: Move[] = [];
        
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const piece = board[r][c];
                if (piece && piece.color === color) {
                    const pieceMoves = await workerGetValidMoves(board, { r, c });
                    moves.push(...pieceMoves.map(to => ({ from: { r, c }, to })));
                }
            }
        }
        
        return moves;
    };
    
    // 格式化移动为简单文本
    const formatMove = (move: Move): string => {
        const pieceTypeMap = {
            'general': '将',
            'advisor': '士', 
            'elephant': '象',
            'horse': '马',
            'chariot': '车',
            'cannon': '炮',
            'soldier': '兵'
        };
        
        const colMap = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
        const rowMap = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        
        // 简单格式：棋子类型 + 起始位置 -> 目标位置
        return `${colMap[move.from.c]}${rowMap[move.from.r]} -> ${colMap[move.to.c]}${rowMap[move.to.r]}`;
    };


    
    const startReplay = async () => {
        setIsReplaying(true);
        setActiveTab('replay'); // 切换到Replay页签
        setReplayIndex(0);
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
            
            setReplayIndex(prev => prev + 1);
        }
    };

    const prevReplay = () => {
        if (replayIndex > 0) {
            setReplayIndex(prev => prev - 1);
            playMoveSound();
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
        setBlackTime(0);
        setPositionHistory([]);
        setRepetitionWarning(null);
        setSelectedPos(null);
        setValidMoves([]);
        setHintMove(null);
        setRedIsAuto(false);
        setBlackIsAuto(true); // 恢复黑方默认 AI
        setIsAutoMovePending(false);
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
    };

    // 将单个移动转换为中文棋谱格式
    const convertSingleMoveToNotation = (move: Move, board?: Board): string => {
        const { from, to } = move;
        
        // 棋子类型中文名称
        const pieceNames: Record<PieceType, string> = {
            'general': '将',
            'advisor': '士',
            'elephant': '象',
            'horse': '马',
            'chariot': '车',
            'cannon': '炮',
            'soldier': '兵'
        };
        
        // 列坐标中文名称（从右到左：1-9）
        const columnNames = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
        
        // 行坐标（红方从下到上：1-5，黑方从上到下：1-5）
        const fromRow = 10 - from.r; // 棋盘底部为1，顶部为10
        const toRow = 10 - to.r;
        
        // 确定棋子类型（如果有棋盘信息）
        let pieceType: PieceType = 'soldier'; // 默认兵
        if (board && board[from.r] && board[from.r][from.c]) {
            pieceType = board[from.r][from.c]!.type;
        }
        
        const pieceName = pieceNames[pieceType];
        const fromColName = columnNames[from.c];
        const toColName = columnNames[to.c];
        
        // 判断移动方向
        const isHorizontal = from.r === to.r; // 同一行
        const isVertical = from.c === to.c;   // 同一列
        
        let direction = '';
        if (isHorizontal) {
            // 平：同一行移动
            direction = '平';
        } else if (isVertical) {
            // 进或退：同一列移动
            direction = fromRow > toRow ? '进' : '退';
        } else {
            // 斜向移动（马、象、士）
            direction = fromRow > toRow ? '进' : '退';
        }
        
        // 构建棋谱
        if (isHorizontal) {
            return `${pieceName}${fromColName}平${toColName}`;
        } else if (isVertical) {
            const step = Math.abs(fromRow - toRow);
            return `${pieceName}${fromColName}${direction}${step}`;
        } else {
            return `${pieceName}${fromColName}${direction}${toColName}`;
        }
    };

    // 将坐标移动转换为传统棋谱格式
    const convertMovesToNotation = useRef((boardHistory: Board[], moveHistory: Move[]): Promise<string[]> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'notation') {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve(e.data.notation);
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'movesToNotation',
                payload: { boardHistory, moveHistory }
            });
        });
    }).current;

    // 保存棋谱到文件（支持特定初始局面）
    const saveGameRecord = async () => {
        if (moveHistory.length === 0) {
            alert("没有棋谱可以保存");
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
            alert('保存棋谱失败');
        }
    };

    // 将传统棋谱格式转换为坐标移动
    const convertNotationToMoves = useRef((notation: string | string[], initialBoard?: Board): Promise<Move[]> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                reject(new Error('Worker not initialized'));
                return;
            }

            // 确保notation是数组
            const notationArray = notation ? 
                (typeof notation === 'string' ? notation.split(' ').filter(move => move.trim() !== '') : notation) : 
                [];

            const handleMessage = (e: MessageEvent) => {
                if (e.data.type === 'moves') {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    resolve(e.data.moves);
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({
                type: 'notationToMoves',
                payload: { notation: notationArray, initialBoard }
            });
        });
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
                setGameOver(null);
                setHasStarted(false);
                
                alert("文件加载成功！");
            } catch (error) {
                console.error("加载文件失败:", error);
                alert("加载文件失败，文件格式可能不正确");
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
    
    const displayLastMove = isReplaying 
        ? (replayIndex > 0 ? moveHistory[replayIndex - 1] : null)
        : (moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null);

    const capturedInfo = useMemo(() => getCapturedPieces(displayBoard), [displayBoard]);
    const isFlipped = playerColor === 'black';

    let topPanelLabel = "Captured Enemy";
    let topPanelPieces: PieceType[] = [];
    let topPanelColor: Color = playerColor === 'red' ? 'black' : 'red';

    let bottomPanelLabel = "Lost Allies";
    let bottomPanelPieces: PieceType[] = [];
    let bottomPanelColor: Color = playerColor;

    if (isSetupMode) {
        topPanelColor = playerColor === 'red' ? 'black' : 'red';
        topPanelLabel = `${topPanelColor === 'red' ? 'Red' : 'Black'} Supply`;
        topPanelPieces = getSupplyPieces(topPanelColor);

        bottomPanelColor = playerColor;
        bottomPanelLabel = `${bottomPanelColor === 'red' ? 'Red' : 'Black'} Supply`;
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
        <div className="min-h-screen bg-stone-900 flex flex-col items-center justify-center p-2 sm:p-4 font-sans text-stone-200 relative overflow-x-hidden select-none">
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
                                联机 · 房间{' '}
                                <span className="font-mono text-amber-400 tracking-wider">
                                    {onlineInfo.roomCode.toUpperCase()}
                                </span>
                                {onlineInfo.peerNick ? ` · vs ${onlineInfo.peerNick}` : ''}
                                {' · '}
                                {onlineInfo.myColor === 'red' ? '执红' : '执黑'}
                            </>
                        ) : (
                            '本地对局'
                        )}
                    </span>
                    <button
                        type="button"
                        onClick={() => leaveToLobby()}
                        className="text-rose-300 hover:text-rose-200 font-semibold"
                    >
                        返回大厅
                    </button>
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

            <div className="flex flex-col lg:flex-row gap-8 items-center max-w-[1040px] w-full">
                
                <div className="order-2 lg:order-1 flex flex-col h-[550px] w-full lg:w-[300px]">
                    {/* 上半部分 - 根据玩家视角动态调整 */}
                    <div className="flex flex-col h-[275px] gap-2 justify-end">
                        {/* 上方时钟 - Setup模式下隐藏 */}
                        
                            <ClockDisplay 
                                color={playerColor === 'red' ? 'black' : 'red'} 
                                time={playerColor === 'red' ? blackTime : redTime} 
                                isActive={(playerColor === 'red' ? turn === 'black' : turn === 'red') && !gameOver && !isReplaying && !isSetupMode && hasStarted} 
                                redStepCount={isReplaying ? Math.ceil(replayIndex / 2) : redStepCount}
                                blackStepCount={isReplaying ? Math.floor(replayIndex / 2) : blackStepCount}
                                playerColor={playerColor}
                            />
                        
                        
                        {/* 上方吃子面板 - Setup模式下隐藏 */}
                        {!isSetupMode && (
                            <SidePanel 
                                label={topPanelLabel} 
                                color={playerColor === 'red' ? 'black' : 'red'} 
                                playerColor={playerColor}
                                pieces={topPanelColor === (playerColor === 'red' ? 'black' : 'red') ? topPanelPieces : bottomPanelPieces}
                                isSetupMode={isSetupMode}
                                skin={skin}
                                material={material}
                                onDragStart={(e, type, c) => handleDragStart(e, {type, color: c})}
                                onDrop={(e) => handleDropOnPanel(e, playerColor === 'red' ? 'black' : 'red')}
                                recentlyCaptured={recentlyCaptured}
                            />
                        )}
                        
                        {/* 上方EVALUATION */}
                        <EvaluationPanel 
                            color={playerColor === 'red' ? 'black' : 'red'} 
                            evaluation={isReplaying ? replayEvaluation : moveEvaluation} 
                        />
                    </div>
                    
                    {/* 下半部分 - 根据玩家视角动态调整 */}
                    <div className="flex flex-col h-[275px] gap-2 justify-start">
                        {/* 下方EVALUATION */}
                        <EvaluationPanel 
                            color={playerColor} 
                            evaluation={isReplaying ? replayEvaluation : moveEvaluation} 
                        />
                        
                        {/* 下方吃子面板 - Setup模式下隐藏 */}
                        {!isSetupMode && (
                            <SidePanel 
                                label={bottomPanelLabel} 
                                color={playerColor} 
                                playerColor={playerColor}
                                pieces={topPanelColor === playerColor ? topPanelPieces : bottomPanelPieces}
                                isSetupMode={isSetupMode}
                                skin={skin}
                                material={material}
                                recentlyCaptured={recentlyCaptured}
                                onDragStart={(e, type, c) => handleDragStart(e, {type, color: c})}
                                onDrop={(e) => handleDropOnPanel(e, playerColor)}
                            />
                        )}
                        
                        {/* 下方时钟 - Setup模式下隐藏 */}
                        
                            <ClockDisplay 
                                color={playerColor} 
                                time={playerColor === 'red' ? redTime : blackTime} 
                                isActive={(playerColor === 'red' ? turn === 'red' : turn === 'black') && !gameOver && !isReplaying && !isSetupMode && hasStarted} 
                                redStepCount={isReplaying ? Math.ceil(replayIndex / 2) : redStepCount}
                                blackStepCount={isReplaying ? Math.floor(replayIndex / 2) : blackStepCount}
                                playerColor={playerColor}
                            />
                        
                    </div>
                </div>

                <div className="relative order-1 lg:order-2 w-full max-w-[500px] flex justify-center">
                    <ChessBoard 
                        board={displayBoard} 
                        onSelect={handlePieceSelect} 
                        onMove={handleMove}
                        onRightClick={handleRightClickOnBoard}
                        selectedPos={selectedPos}
                        validMoves={isSetupMode ? [] : validMoves}
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
                        onDragStart={(e, pos) => handleDragStart(e, pos)}
                        onDrop={handleDropOnBoard}
                        pieceRelations={pieceRelations}
                        moveAnimation={moveAnimation}
                        pieceEval={selectedPieceEval}
                        isCheck={checkAlert}
                        hiddenBestMove={isSetupMode ? null : hiddenBestMove}
                        suboptimalMove={isSetupMode ? null : suboptimalMove}
                    />
                    
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
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none animate-pulse z-20">
                            <div className="bg-red-600/90 text-white px-8 py-3 rounded-full text-3xl font-bold shadow-2xl border-2 border-red-400 tracking-wider">
                                CHECK!
                            </div>
                        </div>
                    )}

                    {repetitionWarning && !isReplaying && !isSetupMode && (
                        <div className="absolute top-1/4 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30">
                            <div className="bg-orange-600/95 text-white px-6 py-3 rounded-2xl text-xl font-bold shadow-2xl border-2 border-orange-400 backdrop-blur-sm animate-pulse">
                                ⚠️ {repetitionWarning}
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
                                    Game ending in 5s... Press Undo to continue
                                </div>
                            </div>
                        </div>
                    )}

                    {gameOver && gameOver.status !== 'setup' && !isReplaying && (
                        <div className="absolute inset-0 bg-black/10 flex items-center justify-center z-50 rounded-lg">
                            <div className="p-8 rounded-2xl text-center animate-scaleUp max-w-md mx-4">
                                <h2 className="text-3xl font-bold mb-2 text-amber-400 uppercase tracking-wide">Game Over</h2>
                                <div className="text-5xl font-extrabold mb-4 text-red-500 drop-shadow-md">
                                    {gameOver.status === 'draw' ? 'DRAW' : (gameOver.winner === playerColor ? 'VICTORY' : 'DEFEAT')}
                                </div>
                                <p className="text-stone-400 text-lg mb-8">
                                    {gameOver.status === 'checkmate' ? <span className="text-yellow-600">Checkmate</span> : 
                                     gameOver.status === 'stalemate' ? <><span className="text-yellow-600">Stalemate</span> (Unable to move)</> : 
                                     'Draw by repetition'}
                                </p>
                                <div className="flex gap-4 justify-center">
                                    <button onClick={startReplay} className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-full font-bold text-lg shadow-lg">Replay</button>
                                    <button
                                        onClick={() => {
                                            if (onlineInfo) {
                                                leaveToLobby();
                                                return;
                                            }
                                            handleRestart();
                                        }}
                                        className="px-6 py-3 bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-500 text-white rounded-full font-bold text-lg shadow-lg"
                                    >
                                        {onlineInfo ? '返回大厅' : 'Play Again'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                
                <div className="order-3 flex flex-col h-auto lg:h-[550px] w-full lg:w-[300px] bg-stone-800/90 backdrop-blur p-3 rounded-xl shadow-2xl border border-stone-700 transition-colors duration-300">
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
                        
                        {/* Timer开关 */}
                        <div className="bg-stone-700/50 rounded-lg border border-stone-600 flex items-center justify-between p-3">
                            <div className="flex items-center gap-2">
                                <ClockIcon className="w-5 h-5 text-amber-400" />
                                <span className="text-xs font-semibold text-stone-300 uppercase tracking-wide">TIMER</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={enableTimeLimit}
                                    onChange={(e) => setEnableTimeLimit(e.target.checked)}
                                    className="sr-only peer"
                                    disabled={isThinking}
                                />
                                <div className={`w-14 h-7 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all ${enableTimeLimit ? 'bg-amber-500' : 'bg-stone-500'}`}></div>
                            </label>
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
                                    <span className="text-xs font-semibold text-stone-300 uppercase tracking-wide">AI Depth</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <select
                                    value={aiDepth}
                                    onChange={(e) => setAiDepth(parseInt(e.target.value))}
                                    className="flex-1 py-2 px-3 bg-stone-700 hover:bg-stone-600 rounded-lg font-bold text-stone-300 text-xs border border-stone-600 transition-colors appearance-none cursor-pointer"
                                >
                                    {[2, 4, 6, 8, 10, 12].map((depth) => (
                                        <option key={depth} value={depth} className="bg-stone-800 text-stone-300">
                                            Depth {depth}
                                        </option>
                                    ))}
                                </select>
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
                                
                                {/* Tactic Weight */}
                                <div className="mb-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-stone-400">Tactic</span>
                                        <span className="text-xs text-stone-300 font-mono">{valueWeights.tactic.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="2"
                                        step="0.01"
                                        value={valueWeights.tactic}
                                        onChange={(e) => setValueWeights(prev => ({ ...prev, tactic: parseFloat(e.target.value) }))}
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
                                <button 
                                    onClick={() => {
                                        if (onlineInfo) {
                                            handleOnlineResign();
                                            return;
                                        }
                                        // 实现Resign逻辑：根据净胜分判断输赢
                                        const redScore = moveEvaluation.post.red.total;
                                        const blackScore = moveEvaluation.post.black.total;
                                        const winner = redScore > blackScore ? 'red' : redScore < blackScore ? 'black' : null;
                                        const status = winner ? 'checkmate' : 'draw';
                                        // 调用游戏结束处理函数
                                        handleGameOver(status, winner, '玩家主动认输');
                                    }} 
                                    disabled={isThinking || !!gameOver}
                                    style={getButtonStyle()}
                                    className="px-3 py-4 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95"
                                >
                                    <StopIcon className="w-6 h-6" />
                                    <span className="text-xs">Resign</span>
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
                                    <ArrowPathIcon className="w-4 h-4" />
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
                                
                                {/* 第4排：Try, Analysis */}
                                {/* Try按钮 - 只要玩家侧是非Auto模式就可以点击 */}
                                <button 
                                    onClick={() => {
                                        // 进入重试模式，保存当前状态作为原始状态
                                        setIsRetryMode(true);
                                        setHasMovedInRetryMode(false); // 重置走棋状态
                                        setOriginalBoard(board);
                                        setOriginalMoveHistory([...moveHistory]);
                                        setOriginalPositionHistory([...positionHistory]);
                                        setOriginalRedStepCount(redStepCount);
                                        setOriginalBlackStepCount(blackStepCount);
                                    }} 
                                    disabled={(redIsAuto || blackIsAuto) || isRetryMode || isThinking || !!gameOver}
                                    style={getButtonStyle()}
                                    className={`px-3 py-2 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 ${isRetryMode ? 'bg-amber-600/30 border-amber-500 ring-2 ring-amber-500/30' : ''}`}
                                >
                                    <ArrowPathIcon className="w-4 h-4" />
                                    <span className="text-xs">Try</span>
                                </button>
                                
                                {/* Analysis按钮 - 分析当前局面并显示推荐着法 */}
                                <button 
                                    onClick={() => {
                                        // 切换Analysis模式
                                        setIsAnalysisMode(!isAnalysisMode);
                                        
                                        if (!isAnalysisMode) {
                                            // 进入Analysis模式，触发分析
                                            setIsThinking(true);
                                            
                                            // 创建一个新的游戏ID，确保不会处理旧的AI响应
                                            const newGameId = gameId + 1;
                                            setGameId(newGameId);
                                            
                                            // 获取当前回合
                                            const currentTurn = turn;
                                            
                                            // 发送分析请求到worker
                                            if (workerRef.current) {
                                                // 定义Analysis模式下的消息处理器
                                                const handleAnalysisMessage = (e: MessageEvent) => {
                                                    console.log('Analysis worker message received:', e.data.type);
                                                    const { type, payload } = e.data;
                                                    if (type === 'SEARCH_COMPLETE') {
                                                        // 移除事件监听器
                                                        workerRef.current?.removeEventListener('message', handleAnalysisMessage);
                                                        
                                                        if (payload.gameId === newGameId) {
                                                            // 更新最优着法序列、次优着法序列和净胜分状态
                                                            setBestMoveSequence(payload.moveSequence || []);
                                                            setSecondBestMoveSequence(payload.secondMoveSequence || []);
                                                            setBestMoveScore(payload.bestMoveScore || 0);
                                                            setSecondBestMoveScore(payload.secondBestMoveScore || 0);
                                                            // 更新所有着法数据，转换为与Replay模式的analysisMoves结构一致的格式
                                                            const formattedAnalysisMoves = (payload.allMovesWithScores || []).map(moveData => ({
                                                                move: moveData.move,
                                                                score: moveData.score,
                                                                moveSequence: moveData.moveSequence || [] // 使用worker返回的moveSequence
                                                            }));
                                                            setAnalysisMoves(formattedAnalysisMoves);
                                                            // 重置选中状态
                                                            setSelectedAnalysisMove(null);
                                                            // 重置预览状态
                                                            setIsPreviewing(false);
                                                            setOriginalBoardForPreview(null);
                                                        }
                                                        
                                                        // 无论如何都要停止思考状态
                                                        setIsThinking(false);
                                                    }
                                                };
                                                
                                                // 添加事件监听器
                                                workerRef.current.addEventListener('message', handleAnalysisMessage);
                                                
                                                // 发送搜索请求
                                                workerRef.current.postMessage({
                                                    type: 'SEARCH',
                                                    payload: { 
                                                        board, 
                                                        turn: currentTurn, 
                                                        depth: aiDepth, 
                                                        randomness: DIFFICULTIES[difficulty].randomness,
                                                        ply: 0,
                                                        gameId: newGameId,
                                                        openingBookEnabled,
                                                        enableTimeLimit: true,
                                                        exactRootScores: true // 主动 Analysis：全根精确分
                                                    }
                                                });
                                            }
                                            
                                            // 设置一个超时，防止AI分析时间过长
                                            setTimeout(() => {
                                                setIsThinking(false);
                                            }, DIFFICULTIES[difficulty].timeLimit + 1000);
                                        }
                                    }} 
                                    disabled={(redIsAuto || blackIsAuto) || isThinking || !!gameOver}
                                    style={getButtonStyle()}
                                    className={`px-3 py-2 disabled:opacity-50 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95 ${isAnalysisMode ? 'bg-blue-600/30 border-blue-500 ring-2 ring-blue-500/30' : ''}`}
                                >
                                    <BarChartIcon className="w-4 h-4" />
                                    <span className="text-xs">Analysis</span>
                                </button>
                                
                                {/* 着法序列棋谱控件 - 与Replay模式完全一致 (Analysis模式下显示，或者在Game模式下搜索完成后显示) */}
                                {isAnalysisMode && (
                                    <div className="col-span-2 mt-2">
                                        {/* 所有着法序列 - 与Replay模式完全一致 */}
                                        {analysisMoves.length > 0 ? (
                                            <div className="w-full bg-stone-900/90 rounded-md border border-stone-700 p-2 overflow-y-auto text-xs">
                                                <div className="w-full space-y-1 overflow-y-auto max-h-48">
                                                    {analysisMoves.map((item, index) => {
                                                        // 使用清晰的坐标格式显示移动
                                                        const move = item.move;
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
                                                                                                        tactic: 0,
                                                                                                        safety: 0,
                                                                                                        mobility: 0,
                                                                                                        threat: 0
                                                                                                    },
                                                                                                    black: {
                                                                                                        total: 0,
                                                                                                        material: 0,
                                                                                                        position: 0,
                                                                                                        tactic: 0,
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
                                        ) : (
                                            <div className="col-span-2 p-3 bg-opacity-50 rounded-lg border shadow-sm text-center" style={{
                                                backgroundColor: 'rgba(28, 25, 23, 0.5)',
                                                borderColor: '#57534e',
                                                color: '#d6d3d1'
                                            }}>
                                                <span className="text-sm">Analysising...</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                                
                                {/* Try模式下的临时No和Yes按钮 */}
                                {!isAnalysisMode && (
                                    <div className="col-span-2 mt-2 rounded-lg border border-stone-700 bg-stone-900/50 p-3 font-mono text-xs text-stone-300">
                                        <div className="mb-1 text-stone-400">AI Bench</div>
                                        {lastSearchBench ? (
                                            <div className="space-y-1">
                                                <div>Time: {formatBenchTime(lastSearchBench.thinkingTime)}</div>
                                                <div>Depth: {lastSearchBench.completedDepth ?? 0} | Nodes: {formatBenchNumber(lastSearchBench.perf?.alphaBetaCalls)}</div>
                                                <div>Legal: {formatBenchNumber(lastSearchBench.perf?.legalMovesSearched)}</div>
                                                <div>Eval: {formatBenchTime(lastSearchBench.perf?.evaluateBoardMs)} | Prep: {formatBenchTime(lastSearchBench.perf?.prepareSearchInfoMs)}</div>
                                                <div>Leaf: {formatBenchNumber(lastSearchBench.perf?.fastLeafEvalCount)} | {formatBenchTime(lastSearchBench.perf?.fastLeafEvalMs)} | List: {lastSearchBench.perf?.pieceList ? 'on' : 'off'}</div>
                                                <div>TT: {formatBenchNumber(lastSearchBench.perf?.tt?.hits)} hits | {lastSearchBench.perf?.tt?.hitRate ?? 0}% | {formatBenchNumber(lastSearchBench.perf?.tt?.stores)} stores</div>
                                            </div>
                                        ) : (
                                            <div className="text-stone-500">Waiting for AI search...</div>
                                        )}
                                    </div>
                                )}

                                {isRetryMode && hasMovedInRetryMode && (
                                    <div className="col-span-2 grid grid-cols-2 gap-2 mt-2">
                                        <button
                                            onClick={() => {
                                                // 取消这次移动，恢复到原始状态
                                                setBoard(originalBoard);
                                                setMoveHistory(originalMoveHistory);
                                                setPositionHistory(originalPositionHistory);
                                                setRedStepCount(originalRedStepCount);
                                                setBlackStepCount(originalBlackStepCount);
                                                
                                                // 重置走棋状态，因为点击No相当于没走过棋
                                                setHasMovedInRetryMode(false);
                                            }}
                                            style={getButtonStyle()}
                                            className="px-3 py-4 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95"
                                        >
                                            <span className="text-xs">No</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                // 确认这次移动，退出重试模式
                                                setIsRetryMode(false);
                                                // 执行正常的走棋逻辑，轮到对方走棋
                                                const nextTurn = turn === 'red' ? 'black' : 'red';
                                                setTurn(nextTurn);
                                            }}
                                            style={getButtonStyle()}
                                            className="px-3 py-4 rounded-lg font-bold transition-all flex flex-col items-center justify-center gap-1 border shadow-sm hover:opacity-80 active:scale-95"
                                        >
                                            <span className="text-xs">Yes</span>
                                        </button>
                                    </div>
                                )}
                                
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
                                                                tactic: 0,
                                                                safety: 0,
                                                                mobility: 0,
                                                                threat: 0
                                                            },
                                                            black: {
                                                                total: 0,
                                                                material: 0,
                                                                position: 0,
                                                                tactic: 0,
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

                            
                            {/* 黑方棋子面板 */}
                            <SidePanel 
                                label="Black Pieces" 
                                color="black" 
                                playerColor={playerColor}
                                pieces={topPanelColor === 'black' ? topPanelPieces : bottomPanelPieces}
                                isSetupMode={isSetupMode}
                                skin={skin}
                                material={material}
                                onDragStart={(e, type, c) => handleDragStart(e, {type, color: c})}
                                onDrop={(e) => handleDropOnPanel(e, 'black')}
                                recentlyCaptured={recentlyCaptured}
                            />
                            
                            {/* 红方棋子面板 */}
                            <SidePanel 
                                label="Red Pieces" 
                                color="red" 
                                playerColor={playerColor}
                                pieces={topPanelColor === 'red' ? topPanelPieces : bottomPanelPieces}
                                isSetupMode={isSetupMode}
                                skin={skin}
                                material={material}
                                onDragStart={(e, type, c) => handleDragStart(e, {type, color: c})}
                                onDrop={(e) => handleDropOnPanel(e, 'red')}
                                recentlyCaptured={recentlyCaptured}
                            />
                            
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
                            
                            <div className="flex gap-1 justify-center mb-3">
                                <button onClick={() => setReplayIndex(0)} disabled={replayIndex===0} className="p-2 bg-stone-700 rounded-lg disabled:opacity-30 hover:bg-stone-600 transition-colors"><FirstPageIcon className="w-4 h-4" /></button>
                                <button onClick={prevReplay} disabled={replayIndex===0} className="p-2 bg-stone-700 rounded-lg disabled:opacity-30 hover:bg-stone-600 transition-colors"><ChevronLeftIcon className="w-4 h-4" /></button>
                                <button onClick={nextReplay} disabled={replayIndex===allReplayBoards.length-1} className="p-2 bg-stone-700 rounded-lg disabled:opacity-30 hover:bg-stone-600 transition-colors"><ChevronRightIcon className="w-4 h-4" /></button>
                                <button onClick={() => setReplayIndex(allReplayBoards.length-1)} disabled={replayIndex===allReplayBoards.length-1} className="p-2 bg-stone-700 rounded-lg disabled:opacity-30 hover:bg-stone-600 transition-colors"><LastPageIcon className="w-4 h-4" /></button>
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
                                                    onClick={() => setReplayIndex(index + 1)}
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
                                                // 使用清晰的坐标格式显示移动
                                                const move = item.move;
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
                                                                                                tactic: 0,
                                                                                                safety: 0,
                                                                                                mobility: 0,
                                                                                                threat: 0
                                                                                            },
                                                                                            black: {
                                                                                                total: 0,
                                                                                                material: 0,
                                                                                                position: 0,
                                                                                                tactic: 0,
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
                                                            tactic: 0,
                                                            safety: 0,
                                                            mobility: 0,
                                                            threat: 0
                                                        },
                                                        black: {
                                                            total: 0,
                                                            material: 0,
                                                            position: 0,
                                                            tactic: 0,
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

