
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
    hard: { depth: 6, randomness: 0.0, timeLimit: 10000 }       // 10秒，最优走法（从6降到5）
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

    const [aiDepth, setAiDepth] = useState<number>(6);
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovDQoNCi8vIOaji+ebmOW4uOmHj+WumuS5iQ0KY29uc3QgUk9XUyA9IDEwOw0KY29uc3QgQ09MUyA9IDk7DQoNCi8vIOaji+WtkOexu+Wei+WumuS5iQ0KY29uc3QgUElFQ0VfVFlQRVMgPSB7DQogICAgR0VORVJBTDogJ2dlbmVyYWwnLA0KICAgIENIQVJJT1Q6ICdjaGFyaW90JywNCiAgICBDQU5OT046ICdjYW5ub24nLA0KICAgIEhPUlNFOiAnaG9yc2UnLA0KICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLA0KICAgIEFEVklTT1I6ICdhZHZpc29yJywNCiAgICBTT0xESUVSOiAnc29sZGllcicNCn07DQoNCi8vIOadkOaWmeWAvOadg+mHjemFjee9rg0KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGdlbmVyYWw6IDEwMDAwLCAgLy8g5bCGL+W4hQ0KICAgIGNoYXJpb3Q6IDkwMCwgICAgIC8vIOi9pg0KICAgIGNhbm5vbjogew0KICAgICAgICBlYXJseTogNDUwLCAgICAvLyDlvIDlsYDpmLbmrrUNCiAgICAgICAgbWlkOiA0MDAsICAgICAgLy8g5Lit5bGA6Zi25q61DQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQ0KICAgIH0sICAgICAgICAgICAgICAgIC8vIOeCrg0KICAgIGhvcnNlOiB7DQogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDQ1MCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsDQogICAgZWxlcGhhbnQ6IDIwMCwgICAgLy8g6LGhL+ebuA0KICAgIGFkdmlzb3I6IDIwMCwgICAgIC8vIOWjqy/ku5UNCiAgICBzb2xkaWVyOiB7DQogICAgICAgIGVhcmx5OiAxMDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDIwMCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSAgICAgICAgICAgICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIOaji+WtkOS7t+WAvOadg+mHjemFjee9rg0KbGV0IFZBTFVFX1dFSUdIVFMgPSB7DQogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQ0KICAgIC8vcG9zaXRpb246IDAuMiwgICAvLyDkvY3nva7lgLzmnYPph40NCiAgICAvL3RocmVhdDogMC4xNSwgICAgLy8g5aiB6IOB5YC85p2D6YeNDQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQ0KICAgIC8vc2FmZXR5OiAwLjEsICAgICAvLyDlronlhajlgLzmnYPph40NCiAgICAvL21vYmlsaXR5OiAwLjA1ICAgLy8g5py65Yqo5YC85p2D6YeNDQoNCiAgICBtYXRlcmlhbDogMSwgICAgLy8g5p2Q5paZ5YC85p2D6YeNDQogICAgcG9zaXRpb246IDEsICAgIC8vIOS9jee9ruWAvOadg+mHjQ0KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQ0KICAgIHRhY3RpYzogMSwgICAgICAvLyDmiJjmnK/lgLzmnYPph40NCiAgICBzYWZldHk6IDEsICAgICAgLy8g5a6J5YWo5YC85p2D6YeNDQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQ0KfTsNCg0KLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XDQpjb25zdCBFVkFMVUFUSU9OX1BBUkFNRVRFUlMgPSB7DQogICAgLy8g5py65Yqo5YC85Y+C5pWwDQogICAgbW9iaWxpdHk6IHsNCiAgICAgICAgYmFzZU1vdmVWYWx1ZTogMSwgICAgICAvLyDln7rnoYDnp7vliqjku7flgLwNCiAgICB9LA0KICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQ0KICAgIGNoZWNrOiB7DQogICAgICAgIGJvbnVzOiA4MA0KICAgIH0NCn07DQoNCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rg0KY29uc3QgUE9TSVRJT05fVEFCTEVTID0gew0KICAgIC8vIOWFtS/ljZLkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBzb2xkaWVyOiBbDQogICAgICAgIFswLCA1LCAxMCwgMTUsIDIwLCAxNSwgMTAsIDUsIDBdLA0KICAgICAgICBbNSwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgY2hhcmlvdDogWw0KICAgICAgICBbNSwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDEwLCA1LCAxNSwgMCwgMTUsIDUsIDEwLCAxMF0sDQogICAgICAgIFswLCAxMCwgNSwgNSwgNSwgNSwgMTAsIDUsIDBdDQogICAgXSwNCiAgICAvLyDpqazkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBob3JzZTogWw0KICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgICAgICAgWzAsIDUsIDI1LCAxMCwgMTAsIDEwLCAyNSwgNSwgMF0sDQogICAgICAgIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sDQogICAgICAgIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMjUsIDIwLCAwLCAyMCwgMjUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgICAgICAgWzUsIDAsIDUsIDUsIDAsIDUsIDUsIDAsIDVdLA0KICAgICAgICBbMCwgMCwgMCwgNSwgLTIwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDngq7kvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBjYW5ub246IFsNCiAgICAgICAgWzEwLCAyMCwgMTUsIDEwLCAwLCAxMCwgMTUsIDIwLCAxMF0sDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLA0KICAgICAgICBbNSwgNSwgMTUsIDUsIDI1LCA1LCAxNSwgNSwgNV0sDQogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLA0KICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogICAgICAgIFsxMCwgMTAsIDE1LCAyMCwgMzAsIDIwLCAxNSwgMTAsIDEwXSwgDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBlbGVwaGFudDogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g5aOr5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgYWR2aXNvcjogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCA1LCAwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDEwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0NCiAgICBdDQp9Ow0KDQovLyDojrflj5bmo4vlrZDnmoTmnZDmlpnlgLwNCmNvbnN0IGdldE1hdGVyaWFsVmFsdWUgPSAocGllY2UsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOw0KICAgIA0KICAgIC8vIOmSiOWvueacieWIhumYtuauteadkOaWmeWAvOeahOWFteenje+8iOWFteOAgeeCruOAgemprO+8ieiwg+aVtOadkOaWmeWAvA0KICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7DQogICAgICAgIHZhbHVlID0gdmFsdWVbZ2FtZVN0YWdlXSB8fCB2YWx1ZS5taWQ7DQogICAgfQ0KICAgIA0KICAgIHJldHVybiB2YWx1ZTsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOS9jee9ruWAvA0KY29uc3QgZ2V0UG9zaXRpb25WYWx1ZSA9IChwaWVjZSwgciwgYykgPT4gew0KICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOw0KICAgIGlmICghdGFibGUpIHJldHVybiAwOw0KICAgIA0KICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqA0KICAgIGNvbnN0IHJvd0lkeCA9IHBpZWNlLmNvbG9yID09PSAncmVkJyA/ICg5LSByKSA6IHI7DQogICAgcmV0dXJuIHRhYmxlW3Jvd0lkeF1bY10gfHwgMDsNCn07DQoNCi8vIOaUu+WHu+S9jeWbvu+8mjkwIOagvOeUqCAzw5dVaW50MzLjgILmkJzntKLlj7blj6rpnIDjgIzmmK/lkKbmlYzmjqfjgI3vvJvngrnmo4svVUkg5LuN55So5o6n5Yi26ICF5YiX6KGo44CCDQpjb25zdCBBVFRBQ0tfV09SRFMgPSAzOw0KY29uc3Qgc2NyYXRjaFJlZEF0dGFjayA9IG5ldyBVaW50MzJBcnJheShBVFRBQ0tfV09SRFMpOw0KY29uc3Qgc2NyYXRjaEJsYWNrQXR0YWNrID0gbmV3IFVpbnQzMkFycmF5KEFUVEFDS19XT1JEUyk7DQovLyB0cnVlPeaQnOe0ouWPtueUqOaUu+WHu+S9jeWbvu+8iOm7mOiupO+8ie+8m2ZhbHNlPeWPtuivhOS8sOS7jeW7uiAxMMOXOSDmjqfliLbogIXooajvvIhBL0LvvIkNCmxldCBTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUUyA9IHRydWU7DQovLyB0cnVlPeWFs+ezu+eUqOagvOS9jSBVaW50MzIg5pS7L+WuiC/mjqcgbWFza++8iOm7mOiupO+8ie+8m2ZhbHNlPXRocmVhdC9ndWFyZCDlr7nosaHliJfooajvvIhBL0LvvIkNCmxldCBTRUFSQ0hfUkVMQVRJT05fTUFTS1MgPSB0cnVlOwpsZXQgU0VBUkNIX0ZBU1RfTEVBRl9FVkFMID0gdHJ1ZTsKbGV0IFNFQVJDSF9GQVNUX0xFQUZfUkVMQVRJT05TID0gdHJ1ZTsKbGV0IFNFQVJDSF9GQVNUX1NPUlQgPSB0cnVlOwpsZXQgU0VBUkNIX0ZBU1RfUFNFVURPX01PVkVTID0gdHJ1ZTsKbGV0IFNFQVJDSF9OVU1FUklDX0NIRUNLID0gdHJ1ZTsKbGV0IFNFQVJDSF9GQVNUX1pPQlJJU1QgPSB0cnVlOwovLyDmkJzntKLmnJ/pl7Tnu7TmiqTntKflh5Hmo4vlrZDooajvvIzpgb/lhY3lj7bor4TkvLAv552A5rOV5YeG5aSH5Y+N5aSN5omr5o+PIDEweDkg5a+56LGh5qOL55uY77yIQS9CIOWPr+WFs+mXre+8iQpsZXQgU0VBUkNIX1BJRUNFX0xJU1QgPSB0cnVlOwovLyDpnZnpu5jmkJzntKLlkIPlrZDnlJ/miJDlpI3nlKjmkJzntKLmgIHmo4vlrZDooajvvJvni6znq4vlvIDlhbPnlKjkuo4gQS9C44CCCi8vIOS7heWfuuWHhuiviuaWreW8gOWQr++8mumineWkliBwZXJmb3JtYW5jZS5ub3cg5Lya5b2x5ZON57ud5a+56ICX5pe277yM5q2j5byP5a+55byI5L+d5oyB5YWz6Zet44CCCmxldCBTRUFSQ0hfUFJPRklMRSA9IGZhbHNlOwoNCmNvbnN0IGNsZWFyQXR0YWNrQml0cyA9IChiaXRzKSA9PiB7DQogICAgYml0c1swXSA9IDA7DQogICAgYml0c1sxXSA9IDA7DQogICAgYml0c1syXSA9IDA7DQp9Ow0KDQpjb25zdCBzZXRBdHRhY2tCaXQgPSAoYml0cywgc3EpID0+IHsNCiAgICBiaXRzW3NxID4+PiA1XSB8PSAoMSA8PCAoc3EgJiAzMSkpOw0KfTsNCg0KY29uc3QgaGFzQXR0YWNrQml0ID0gKGJpdHMsIHNxKSA9PiAoYml0c1tzcSA+Pj4gNV0gJiAoMSA8PCAoc3EgJiAzMSkpKSAhPT0gMDsNCg0KY29uc3QgbWFrZUVtcHR5Q29udHJvbGxlckdyaWQgPSAoKSA9Pg0KICAgIEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpLm1hcCgoKSA9PiBbXSkpOw0KDQovLyDlhbPns7sgbWFza++8muacgOWkmiAzMiDlrZDvvIjkuK3lm73osaHmo4vmu6Hnm5jvvInvvIxiaXQgaSA9IHBpZWNlc0luZm9baV0NCmNvbnN0IFJFTF9TUVVBUkVTID0gOTA7DQpjb25zdCBzY3JhdGNoQXR0YWNrTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7ICAvLyDmlYzlrZDmiYDlnKjmoLzvvJrosIHlnKjmiZPlroMNCmNvbnN0IHNjcmF0Y2hHdWFyZE1hc2sgPSBuZXcgVWludDMyQXJyYXkoUkVMX1NRVUFSRVMpOyAgIC8vIOWPi+WGm+aJgOWcqOagvO+8muiwgeWcqOS/neWugw0KY29uc3Qgc2NyYXRjaENvbnRyb2xNYXNrID0gbmV3IFVpbnQzMkFycmF5KFJFTF9TUVVBUkVTKTsgLy8g56m65o6n5qC877ya6LCB5o6n5Yi25a6D77yI5a+56b2Q5penIGJvYXJkSW5mb++8iQ0KDQpjb25zdCBjbGVhclJlbGF0aW9uTWFza3MgPSAoY2xlYXJDb250cm9sID0gdHJ1ZSkgPT4gew0KICAgIHNjcmF0Y2hBdHRhY2tNYXNrLmZpbGwoMCk7DQogICAgc2NyYXRjaEd1YXJkTWFzay5maWxsKDApOw0KICAgIGlmIChjbGVhckNvbnRyb2wpIHNjcmF0Y2hDb250cm9sTWFzay5maWxsKDApOw0KfTsNCg0KLy8g5qC85L2NIOKGkiBwaWVjZXNJbmZvIOW8leeUqO+8iOabv+S7o+avj+WPtiBuZXcgTWFw77yJDQpjb25zdCBzY3JhdGNoUGllY2VBdFNxID0gbmV3IEFycmF5KFJFTF9TUVVBUkVTKTsNCmNvbnN0IGNsZWFyUGllY2VBdFNxID0gKCkgPT4gew0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgUkVMX1NRVUFSRVM7IGkrKykgc2NyYXRjaFBpZWNlQXRTcVtpXSA9IG51bGw7DQp9Ow0KDQovLyDlpI3nlKggcmVsQ3R477yM6YG/5YWN5q+P5a2QIG5ldyDlsI/lr7nosaENCmNvbnN0IHNjcmF0Y2hSZWxDdHggPSB7CiAgICB1c2VNYXNrczogdHJ1ZSwNCiAgICBza2lwQ29udHJvbE1hc2s6IGZhbHNlLCAvLyDmkJzntKLlj7bvvJrkuI3lhpnnqbrmjqcgY29udHJvbE1hc2vvvIjku43lhpnmlLvlh7vkvY3lm74r5py65Yqo77yJDQogICAgcGllY2VJbmRleDogMCwNCiAgICBhdHRhY2tNYXNrOiBudWxsLA0KICAgIGd1YXJkTWFzazogbnVsbCwNCiAgICBjb250cm9sTWFzazogbnVsbCwNCiAgICByZWRBdHRhY2s6IG51bGwsDQogICAgYmxhY2tBdHRhY2s6IG51bGwKfTsKCmNvbnN0IHNjcmF0Y2hMZWFmUGllY2VzSW5mbyA9IFtdOwpjb25zdCBzY3JhdGNoTGVhZlBpZWNlU2xvdHMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAzMiB9LCAoXywgcGllY2VJbmRleCkgPT4gKHsKICAgIHBpZWNlOiBudWxsLAogICAgcGllY2VDb2RlOiAwLAogICAgcjogMCwKICAgIGM6IDAsCiAgICBwaWVjZUluZGV4LAogICAgbW92ZXM6IFtdLAogICAgYWxseUd1YXJkczogW10sCiAgICBtYXRlcmlhbFZhbHVlOiAwLAogICAgcG9zaXRpb25WYWx1ZTogMCwKICAgIHRocmVhdFZhbHVlOiAwLAogICAgc2FmZXR5VmFsdWU6IDAsCiAgICB0YWN0aWNWYWx1ZTogMCwKICAgIG1vYmlsaXR5VmFsdWU6IDAsCiAgICB0aHJlYXQ6IFtdLAogICAgdGhyZWF0ZW5lZEJ5OiBbXSwKICAgIGd1YXJkOiBbXSwKICAgIGd1YXJkZWRCeTogW10sCiAgICBjb250cm9sOiBbXSwKICAgIHByb3RlY3Q6IFtdCn0pKTsKCmNvbnN0IHNjcmF0Y2hMZWFmQm9hcmRJbmZvID0gewogICAgdXNlUmVsYXRpb25NYXNrczogdHJ1ZSwKICAgIHVzZUF0dGFja0JpdHM6IHRydWUsCiAgICBza2lwQ29udHJvbE1hc2s6IHRydWUsCiAgICBhdHRhY2tNYXNrOiBzY3JhdGNoQXR0YWNrTWFzaywKICAgIGd1YXJkTWFzazogc2NyYXRjaEd1YXJkTWFzaywKICAgIGNvbnRyb2xNYXNrOiBzY3JhdGNoQ29udHJvbE1hc2ssCiAgICByZWRBdHRhY2s6IHNjcmF0Y2hSZWRBdHRhY2ssCiAgICBibGFja0F0dGFjazogc2NyYXRjaEJsYWNrQXR0YWNrCn07CgpsZXQgYWN0aXZlU2VhcmNoUGllY2VTdGF0ZSA9IG51bGw7Cgpjb25zdCBzZWFyY2hQaWVjZVR5cGVDb2RlID0gKHR5cGUpID0+IHsKICAgIHN3aXRjaCAodHlwZSkgewogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuR0VORVJBTDogcmV0dXJuIDE7CiAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5DSEFSSU9UOiByZXR1cm4gMjsKICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkhPUlNFOiByZXR1cm4gMzsKICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkVMRVBIQU5UOiByZXR1cm4gNDsKICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkFEVklTT1I6IHJldHVybiA1OwogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuQ0FOTk9OOiByZXR1cm4gNjsKICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLlNPTERJRVI6IHJldHVybiA3OwogICAgICAgIGRlZmF1bHQ6IHJldHVybiAwOwogICAgfQp9OwoKY29uc3Qgc2VhcmNoUGllY2VDb2RlID0gKHBpZWNlKSA9PiBzZWFyY2hQaWVjZVR5cGVDb2RlKHBpZWNlLnR5cGUpICsgKHBpZWNlLmNvbG9yID09PSAncmVkJyA/IDAgOiA4KTsKCmNvbnN0IFNFQVJDSF9NQVRFUklBTF9WQUxVRVMgPSB7CiAgICBlYXJseTogbmV3IEludDE2QXJyYXkoWzAsIDEwMDAwLCA5MDAsIDQwMCwgMjAwLCAyMDAsIDQ1MCwgMTAwXSksCiAgICBtaWQ6IG5ldyBJbnQxNkFycmF5KFswLCAxMDAwMCwgOTAwLCA0NTAsIDIwMCwgMjAwLCA0MDAsIDIwMF0pLAogICAgbGF0ZTogbmV3IEludDE2QXJyYXkoWzAsIDEwMDAwLCA5MDAsIDQ1MCwgMjAwLCAyMDAsIDQwMCwgNDUwXSkKfTsKCmNvbnN0IHNlYXJjaE1hdGVyaWFsVGFibGUgPSAoZ2FtZVN0YWdlKSA9PiBTRUFSQ0hfTUFURVJJQUxfVkFMVUVTW2dhbWVTdGFnZV0gfHwgU0VBUkNIX01BVEVSSUFMX1ZBTFVFUy5taWQ7Cgpjb25zdCBjcmVhdGVTZWFyY2hQaWVjZVN0YXRlID0gKGJvYXJkKSA9PiB7CiAgICBjb25zdCByZWNvcmRzID0gW107CiAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBuZXcgSW50OEFycmF5KFJFTF9TUVVBUkVTKTsKICAgIGNvbnN0IHNxdWFyZUNvZGVzID0gbmV3IFVpbnQ4QXJyYXkoUkVMX1NRVUFSRVMpOwogICAgY29uc3QgcGllY2VDb2RlcyA9IG5ldyBVaW50OEFycmF5KDMyKTsKICAgIGxldCByZWRHZW5lcmFsU3EgPSAtMTsKICAgIGxldCBibGFja0dlbmVyYWxTcSA9IC0xOwogICAgc3F1YXJlVG9TbG90LmZpbGwoLTEpOwogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsKICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICBpZiAoIXBpZWNlKSBjb250aW51ZTsKICAgICAgICAgICAgaWYgKHJlY29yZHMubGVuZ3RoID49IDMyKSByZXR1cm4gbnVsbDsKICAgICAgICAgICAgY29uc3Qgc2xvdCA9IHJlY29yZHMubGVuZ3RoOwogICAgICAgICAgICByZWNvcmRzLnB1c2goeyBwaWVjZSwgciwgYywgc3E6IHIgKiA5ICsgYywgYWxpdmU6IHRydWUgfSk7CiAgICAgICAgICAgIGNvbnN0IGNvZGUgPSBzZWFyY2hQaWVjZUNvZGUocGllY2UpOwogICAgICAgICAgICBpZiAoKGNvZGUgJiA3KSA9PT0gMSkgewogICAgICAgICAgICAgICAgaWYgKGNvZGUgPCA4KSByZWRHZW5lcmFsU3EgPSByICogOSArIGM7CiAgICAgICAgICAgICAgICBlbHNlIGJsYWNrR2VuZXJhbFNxID0gciAqIDkgKyBjOwogICAgICAgICAgICB9CiAgICAgICAgICAgIHBpZWNlQ29kZXNbc2xvdF0gPSBjb2RlOwogICAgICAgICAgICBzcXVhcmVUb1Nsb3RbciAqIDkgKyBjXSA9IHNsb3Q7CiAgICAgICAgICAgIHNxdWFyZUNvZGVzW3IgKiA5ICsgY10gPSBjb2RlOwogICAgICAgIH0KICAgIH0KICAgIHJldHVybiB7CiAgICAgICAgYm9hcmQsCiAgICAgICAgcmVjb3JkcywKICAgICAgICBzcXVhcmVUb1Nsb3QsCiAgICAgICAgc3F1YXJlQ29kZXMsCiAgICAgICAgcGllY2VDb2RlcywKICAgICAgICByZWRHZW5lcmFsU3EsCiAgICAgICAgYmxhY2tHZW5lcmFsU3EsCiAgICAgICAgbW92ZXJTdGFjazogbmV3IEludDhBcnJheSgzMiksCiAgICAgICAgY2FwdHVyZWRTdGFjazogbmV3IEludDhBcnJheSgzMiksCiAgICAgICAgc3RhY2tEZXB0aDogMAogICAgfTsKfTsKCmNvbnN0IGFjdGl2ZVBpZWNlU3RhdGVGb3IgPSAoYm9hcmQpID0+IHsKICAgIGNvbnN0IHN0YXRlID0gYWN0aXZlU2VhcmNoUGllY2VTdGF0ZTsKICAgIHJldHVybiBTRUFSQ0hfUElFQ0VfTElTVCAmJiBzdGF0ZSAmJiBzdGF0ZS5ib2FyZCA9PT0gYm9hcmQgPyBzdGF0ZSA6IG51bGw7Cn07Cgpjb25zdCB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJNYWtlID0gKGJvYXJkLCBmcm9tU3EsIHRvU3EpID0+IHsKICAgIGNvbnN0IHN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7CiAgICBpZiAoIXN0YXRlKSByZXR1cm47CiAgICBjb25zdCBtb3ZlclNsb3QgPSBzdGF0ZS5zcXVhcmVUb1Nsb3RbZnJvbVNxXTsKICAgIGNvbnN0IGNhcHR1cmVkU2xvdCA9IHN0YXRlLnNxdWFyZVRvU2xvdFt0b1NxXTsKICAgIGNvbnN0IHN0YWNrSW5kZXggPSBzdGF0ZS5zdGFja0RlcHRoKys7CiAgICBzdGF0ZS5tb3ZlclN0YWNrW3N0YWNrSW5kZXhdID0gbW92ZXJTbG90OwogICAgc3RhdGUuY2FwdHVyZWRTdGFja1tzdGFja0luZGV4XSA9IGNhcHR1cmVkU2xvdDsKICAgIGlmIChtb3ZlclNsb3QgPCAwKSByZXR1cm47CgogICAgY29uc3QgbW92ZXIgPSBzdGF0ZS5yZWNvcmRzW21vdmVyU2xvdF07CiAgICBtb3Zlci5zcSA9IHRvU3E7CiAgICBtb3Zlci5yID0gKHRvU3EgLyA5KSB8IDA7CiAgICBtb3Zlci5jID0gdG9TcSAlIDk7CiAgICBzdGF0ZS5zcXVhcmVUb1Nsb3RbZnJvbVNxXSA9IC0xOwogICAgc3RhdGUuc3F1YXJlVG9TbG90W3RvU3FdID0gbW92ZXJTbG90OwogICAgc3RhdGUuc3F1YXJlQ29kZXNbZnJvbVNxXSA9IDA7CiAgICBzdGF0ZS5zcXVhcmVDb2Rlc1t0b1NxXSA9IHN0YXRlLnBpZWNlQ29kZXNbbW92ZXJTbG90XTsKICAgIGNvbnN0IG1vdmVyQ29kZSA9IHN0YXRlLnBpZWNlQ29kZXNbbW92ZXJTbG90XTsKICAgIGlmICgobW92ZXJDb2RlICYgNykgPT09IDEpIHsKICAgICAgICBpZiAobW92ZXJDb2RlIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gdG9TcTsKICAgICAgICBlbHNlIHN0YXRlLmJsYWNrR2VuZXJhbFNxID0gdG9TcTsKICAgIH0KICAgIGlmIChjYXB0dXJlZFNsb3QgPj0gMCAmJiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdICYgNykgPT09IDEpIHsKICAgICAgICBpZiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gLTE7CiAgICAgICAgZWxzZSBzdGF0ZS5ibGFja0dlbmVyYWxTcSA9IC0xOwogICAgfQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwKSBzdGF0ZS5yZWNvcmRzW2NhcHR1cmVkU2xvdF0uYWxpdmUgPSBmYWxzZTsKfTsKCmNvbnN0IHVwZGF0ZVBpZWNlU3RhdGVBZnRlclVubWFrZSA9IChib2FyZCwgZnJvbVNxLCB0b1NxKSA9PiB7CiAgICBjb25zdCBzdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOwogICAgaWYgKCFzdGF0ZSkgcmV0dXJuOwogICAgY29uc3Qgc3RhY2tJbmRleCA9IC0tc3RhdGUuc3RhY2tEZXB0aDsKICAgIGNvbnN0IG1vdmVyU2xvdCA9IHN0YXRlLm1vdmVyU3RhY2tbc3RhY2tJbmRleF07CiAgICBjb25zdCBjYXB0dXJlZFNsb3QgPSBzdGF0ZS5jYXB0dXJlZFN0YWNrW3N0YWNrSW5kZXhdOwogICAgaWYgKG1vdmVyU2xvdCA8IDApIHJldHVybjsKCiAgICBjb25zdCBtb3ZlciA9IHN0YXRlLnJlY29yZHNbbW92ZXJTbG90XTsKICAgIG1vdmVyLnNxID0gZnJvbVNxOwogICAgbW92ZXIuciA9IChmcm9tU3EgLyA5KSB8IDA7CiAgICBtb3Zlci5jID0gZnJvbVNxICUgOTsKICAgIHN0YXRlLnNxdWFyZVRvU2xvdFtmcm9tU3FdID0gbW92ZXJTbG90OwogICAgc3RhdGUuc3F1YXJlVG9TbG90W3RvU3FdID0gY2FwdHVyZWRTbG90OwogICAgc3RhdGUuc3F1YXJlQ29kZXNbZnJvbVNxXSA9IHN0YXRlLnBpZWNlQ29kZXNbbW92ZXJTbG90XTsKICAgIHN0YXRlLnNxdWFyZUNvZGVzW3RvU3FdID0gY2FwdHVyZWRTbG90ID49IDAgPyBzdGF0ZS5waWVjZUNvZGVzW2NhcHR1cmVkU2xvdF0gOiAwOwogICAgY29uc3QgbW92ZXJDb2RlID0gc3RhdGUucGllY2VDb2Rlc1ttb3ZlclNsb3RdOwogICAgaWYgKChtb3ZlckNvZGUgJiA3KSA9PT0gMSkgewogICAgICAgIGlmIChtb3ZlckNvZGUgPCA4KSBzdGF0ZS5yZWRHZW5lcmFsU3EgPSBmcm9tU3E7CiAgICAgICAgZWxzZSBzdGF0ZS5ibGFja0dlbmVyYWxTcSA9IGZyb21TcTsKICAgIH0KICAgIGlmIChjYXB0dXJlZFNsb3QgPj0gMCAmJiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdICYgNykgPT09IDEpIHsKICAgICAgICBpZiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gdG9TcTsKICAgICAgICBlbHNlIHN0YXRlLmJsYWNrR2VuZXJhbFNxID0gdG9TcTsKICAgIH0KICAgIGlmIChjYXB0dXJlZFNsb3QgPj0gMCkgc3RhdGUucmVjb3Jkc1tjYXB0dXJlZFNsb3RdLmFsaXZlID0gdHJ1ZTsKfTsKDQpjb25zdCBsb3dlc3RTZXRCaXRJbmRleCA9IChtYXNrKSA9PiAzMSAtIE1hdGguY2x6MzIobWFzayAmIC1tYXNrKTsNCg0KY29uc3QgZm9yRWFjaFNldEJpdCA9IChtYXNrLCBmbikgPT4gew0KICAgIGxldCBtID0gbWFzayA+Pj4gMDsNCiAgICB3aGlsZSAobSAhPT0gMCkgew0KICAgICAgICBjb25zdCBiaXQgPSBtICYgLW07DQogICAgICAgIGZuKDMxIC0gTWF0aC5jbHozMihiaXQpKTsNCiAgICAgICAgbSBePSBiaXQ7DQogICAgfQ0KfTsNCg0KLy8g5Li76K+E5Lyw5Ye95pWwIC0g6K+m57uG6K+E5Lyw5qOL55uY5bGA5Yq/77yIVUkgLyDngrnmo4vlhbPns7sgLyDmkJzntKLlj7YgLyDmoLnoioLngrnvvIkNCi8vIG9wdGlvbnMuZm9yU2VhcmNoTGVhZjog5LuF6Lez6L+H57uI5bGAIGdldFZhbGlkTW92ZXPvvIjml6DnnYDlt7LlnKjniLboioLngrnlpITnkIbvvInvvJvlj6/nlKjmlLvlh7vkvY3lm77ku6Pmm7/mjqfliLbogIXooagNCmNvbnN0IGV2YWx1YXRlQm9hcmQgPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJywgb3B0aW9ucyA9IG51bGwpID0+IHsKICAgIGNvbnN0IF9fdDAgPSBwZXJmb3JtYW5jZS5ub3coKTsNCiAgICAvLyDnu5/orqENCiAgICBpZiAoY3VycmVudFBsYXllcikgew0KICAgICAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQogICAgfQ0KICAgIGNvbnN0IGZvclNlYXJjaExlYWYgPSAhIShvcHRpb25zICYmIG9wdGlvbnMuZm9yU2VhcmNoTGVhZik7DQoNCiAgICBjb25zdCBvdXRwdXRQaGFzZSA9IGdhbWVTdGFnZTsNCg0KICAgIC8vIOmBjeWOhuaji+ebmO+8muWPquaUtumbhuWtkOWKmy9QU1TvvJvnnYDms5Ur5YWz57O757uf5LiA5ZyoIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zIOS4gOasoeWHoOS9leeUn+aIkO+8iOWvuem9kOeCru+8iQ0KICAgIGxldCBwaWVjZXNJbmZvID0gW107DQogICAgbGV0IHJlZE1hdGVyaWFsID0gMCwgcmVkUG9zaXRpb24gPSAwOw0KICAgIGxldCBibGFja01hdGVyaWFsID0gMCwgYmxhY2tQb3NpdGlvbiA9IDA7DQogICAgDQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAoIXBpZWNlKSBjb250aW51ZTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvblZhbHVlID0gZ2V0UG9zaXRpb25WYWx1ZShwaWVjZSwgciwgYyk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICByZWRNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgIHJlZFBvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGJsYWNrTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgICAgICBibGFja1Bvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7DQogICAgICAgICAgICAgICAgcGllY2UsDQogICAgICAgICAgICAgICAgciwNCiAgICAgICAgICAgICAgICBjLA0KICAgICAgICAgICAgICAgIHBpZWNlSW5kZXg6IHBpZWNlc0luZm8ubGVuZ3RoLA0KICAgICAgICAgICAgICAgIG1vdmVzOiBbXSwNCiAgICAgICAgICAgICAgICBhbGx5R3VhcmRzOiBbXSwNCiAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlLA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uVmFsdWUsDQogICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDAsDQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLA0KICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeTogW10sDQogICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLA0KICAgICAgICAgICAgICAgIGd1YXJkZWRCeTogW10sDQogICAgICAgICAgICAgICAgY29udHJvbDogW10sDQogICAgICAgICAgICAgICAgcHJvdGVjdDogW10NCiAgICAgICAgICAgIH0pOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5YWz57O7IG1hc2vvvIjiiaQzMiDlrZDvvInkvJjlhYjvvJvlkKbliJnlm57pgIDml6fliJfooaggLyDlj7bmlLvlh7vkvY3lm74NCiAgICBjb25zdCB1c2VSZWxhdGlvbk1hc2tzID0gU0VBUkNIX1JFTEFUSU9OX01BU0tTICYmIHBpZWNlc0luZm8ubGVuZ3RoIDw9IDMyOw0KICAgIGNvbnN0IHVzZUF0dGFja0JpdHMgPSAhdXNlUmVsYXRpb25NYXNrcyAmJiBmb3JTZWFyY2hMZWFmICYmIFNFQVJDSF9MRUFGX0FUVEFDS19CSVRTOw0KICAgIGxldCBib2FyZEluZm87DQogICAgaWYgKHVzZVJlbGF0aW9uTWFza3MpIHsNCiAgICAgICAgY2xlYXJSZWxhdGlvbk1hc2tzKCFmb3JTZWFyY2hMZWFmKTsNCiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOw0KICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaEJsYWNrQXR0YWNrKTsNCiAgICAgICAgYm9hcmRJbmZvID0gew0KICAgICAgICAgICAgdXNlUmVsYXRpb25NYXNrczogdHJ1ZSwNCiAgICAgICAgICAgIHVzZUF0dGFja0JpdHM6IHRydWUsDQogICAgICAgICAgICBza2lwQ29udHJvbE1hc2s6ICEhZm9yU2VhcmNoTGVhZiwNCiAgICAgICAgICAgIGF0dGFja01hc2s6IHNjcmF0Y2hBdHRhY2tNYXNrLA0KICAgICAgICAgICAgZ3VhcmRNYXNrOiBzY3JhdGNoR3VhcmRNYXNrLA0KICAgICAgICAgICAgY29udHJvbE1hc2s6IHNjcmF0Y2hDb250cm9sTWFzaywNCiAgICAgICAgICAgIHJlZEF0dGFjazogc2NyYXRjaFJlZEF0dGFjaywNCiAgICAgICAgICAgIGJsYWNrQXR0YWNrOiBzY3JhdGNoQmxhY2tBdHRhY2sNCiAgICAgICAgfTsNCiAgICB9IGVsc2UgaWYgKHVzZUF0dGFja0JpdHMpIHsNCiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOw0KICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaEJsYWNrQXR0YWNrKTsNCiAgICAgICAgYm9hcmRJbmZvID0gew0KICAgICAgICAgICAgdXNlQXR0YWNrQml0czogdHJ1ZSwNCiAgICAgICAgICAgIHJlZEF0dGFjazogc2NyYXRjaFJlZEF0dGFjaywNCiAgICAgICAgICAgIGJsYWNrQXR0YWNrOiBzY3JhdGNoQmxhY2tBdHRhY2sNCiAgICAgICAgfTsNCiAgICB9IGVsc2Ugew0KICAgICAgICBib2FyZEluZm8gPSBtYWtlRW1wdHlDb250cm9sbGVyR3JpZCgpOw0KICAgIH0NCiAgICBjYWxjdWxhdGVEZXJpdmVkVmFsdWVzKGJvYXJkLCBwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyLCBib2FyZEluZm8sIGZvclNlYXJjaExlYWYpOw0KICAgIA0KICAgIC8vIOesrOS4ieatpe+8muiuoeeul+aAu+WIhu+8iOWPquiuoeeul+WJqeS9meWIhuaVsO+8jOWfuuehgOWIhuaVsOW3suWcqOaji+ebmOmBjeWOhuaXtuiuoeeul++8iQ0KICAgIGxldCByZWRUaHJlYXQgPSAwLCByZWRUYWN0aWMgPSAwLCByZWRTYWZldHkgPSAwLCByZWRNb2JpbGl0eSA9IDA7DQogICAgbGV0IGJsYWNrVGhyZWF0ID0gMCwgYmxhY2tUYWN0aWMgPSAwLCBibGFja1NhZmV0eSA9IDAsIGJsYWNrTW9iaWxpdHkgPSAwOw0KICAgIA0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGNvbnN0IHsgcGllY2UsIHRocmVhdFZhbHVlLCB0YWN0aWNWYWx1ZSwgc2FmZXR5VmFsdWUsIG1vYmlsaXR5VmFsdWUgfSA9IGluZm87DQogICAgICAgIA0KICAgICAgICBpZiAocGllY2UuY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICByZWRUaHJlYXQgKz0gdGhyZWF0VmFsdWU7DQogICAgICAgICAgICByZWRUYWN0aWMgKz0gdGFjdGljVmFsdWU7DQogICAgICAgICAgICByZWRTYWZldHkgKz0gc2FmZXR5VmFsdWU7DQogICAgICAgICAgICByZWRNb2JpbGl0eSArPSBtb2JpbGl0eVZhbHVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgYmxhY2tUaHJlYXQgKz0gdGhyZWF0VmFsdWU7DQogICAgICAgICAgICBibGFja1RhY3RpYyArPSB0YWN0aWNWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrU2FmZXR5ICs9IHNhZmV0eVZhbHVlOw0KICAgICAgICAgICAgYmxhY2tNb2JpbGl0eSArPSBtb2JpbGl0eVZhbHVlOw0KICAgICAgICB9DQogICAgfQ0KICAgIA0KICAgIC8vIOiuoeeul+WxgOWKv+aAu+WIhg0KICAgIGNvbnN0IHJlZFRvdGFsID0gDQogICAgICAgIHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArDQogICAgICAgIHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArDQogICAgICAgIHJlZFRocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsNCiAgICAgICAgcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKw0KICAgICAgICByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArDQogICAgICAgIHJlZE1vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsgDQogICAgDQogICAgY29uc3QgYmxhY2tUb3RhbCA9IA0KICAgICAgICBibGFja01hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArDQogICAgICAgIGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsNCiAgICAgICAgYmxhY2tUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArDQogICAgICAgIGJsYWNrVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKw0KICAgICAgICBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsNCiAgICAgICAgYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7DQogICAgDQogICAgLy8g6L+U5Zue6K+m57uG6K+E5Lyw57uT5p6cDQogICAgY29uc3QgX19ldmFsUmVzdWx0ID0gew0KICAgICAgICByZWQ6IHsNCiAgICAgICAgICAgIHRvdGFsOiByZWRUb3RhbCwNCiAgICAgICAgICAgIG1hdGVyaWFsOiByZWRNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICBwb3NpdGlvbjogcmVkUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLA0KICAgICAgICAgICAgdGhyZWF0OiByZWRUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCwNCiAgICAgICAgICAgIHRhY3RpYzogcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMsDQogICAgICAgICAgICBzYWZldHk6IHJlZFNhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LA0KICAgICAgICAgICAgbW9iaWxpdHk6IHJlZE1vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eSwNCiAgICAgICAgICAgIHBoYXNlOiBvdXRwdXRQaGFzZSwNCiAgICAgICAgICAgIHdlaWdodHM6IHsNCiAgICAgICAgICAgICAgICBtYXRlcmlhbDogMC40LA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLjIsDQogICAgICAgICAgICAgICAgdGFjdGljOiAwLjEsDQogICAgICAgICAgICAgICAgc2FmZXR5OiAwLjEsDQogICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAuMDUsDQogICAgICAgICAgICAgICAgdGhyZWF0OiAwLjE1DQogICAgICAgICAgICB9DQogICAgICAgIH0sDQogICAgICAgIGJsYWNrOiB7DQogICAgICAgICAgICB0b3RhbDogYmxhY2tUb3RhbCwNCiAgICAgICAgICAgIG1hdGVyaWFsOiBibGFja01hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwNCiAgICAgICAgICAgIHBvc2l0aW9uOiBibGFja1Bvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgIHRocmVhdDogYmxhY2tUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCwNCiAgICAgICAgICAgIHRhY3RpYzogYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYywNCiAgICAgICAgICAgIHNhZmV0eTogYmxhY2tTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgIG1vYmlsaXR5OiBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eSwNCiAgICAgICAgICAgIHBoYXNlOiBvdXRwdXRQaGFzZSwNCiAgICAgICAgICAgIHdlaWdodHM6IHsNCiAgICAgICAgICAgICAgICBtYXRlcmlhbDogMC40LA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLjIsDQogICAgICAgICAgICAgICAgdGFjdGljOiAwLjEsDQogICAgICAgICAgICAgICAgc2FmZXR5OiAwLjEsDQogICAgICAgICAgICAgICAgbW9iaWxpdHk6IDAuMDUsDQogICAgICAgICAgICAgICAgdGhyZWF0OiAwLjE1DQogICAgICAgICAgICB9DQogICAgICAgIH0sDQogICAgICAgIHBpZWNlc0luZm86IHBpZWNlc0luZm8sDQogICAgICAgIGdhbWVTdGFnZTogZ2FtZVN0YWdlLA0KICAgICAgICBib2FyZEluZm86IGJvYXJkSW5mbw0KICAgIH07DQogICAgaWYgKHR5cGVvZiBwZXJmU3RhdHMgIT09ICd1bmRlZmluZWQnICYmIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMgIT0gbnVsbCkgew0KICAgICAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsNCiAgICB9DQogICAgcmV0dXJuIF9fZXZhbFJlc3VsdDsKfTsKCmNvbnN0IGV2YWx1YXRlU2VhcmNoTGVhZkZhc3QgPSAoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKSA9PiB7CiAgICBjb25zdCBfX3QwID0gcGVyZm9ybWFuY2Uubm93KCk7CiAgICBjb25zdCBwaWVjZXNJbmZvID0gc2NyYXRjaExlYWZQaWVjZXNJbmZvOwogICAgbGV0IGNvdW50ID0gMDsKICAgIGxldCByZWRNYXRlcmlhbCA9IDA7CiAgICBsZXQgcmVkUG9zaXRpb24gPSAwOwogICAgbGV0IGJsYWNrTWF0ZXJpYWwgPSAwOwogICAgbGV0IGJsYWNrUG9zaXRpb24gPSAwOwogICAgY29uc3QgcGllY2VTdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOwogICAgbGV0IG92ZXJmbG93ID0gZmFsc2U7CiAgICBpZiAocGllY2VTdGF0ZSkgewogICAgICAgIGNvbnN0IHJlY29yZHMgPSBwaWVjZVN0YXRlLnJlY29yZHM7CiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCByZWNvcmRzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgIGNvbnN0IHJlY29yZCA9IHJlY29yZHNbaV07CiAgICAgICAgICAgIGlmICghcmVjb3JkLmFsaXZlKSBjb250aW51ZTsKICAgICAgICAgICAgY29uc3QgcGllY2UgPSByZWNvcmQucGllY2U7CiAgICAgICAgICAgIGNvbnN0IGluZm8gPSBzY3JhdGNoTGVhZlBpZWNlU2xvdHNbY291bnQrK107CiAgICAgICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOwogICAgICAgICAgICBjb25zdCBwb3NpdGlvblZhbHVlID0gZ2V0UG9zaXRpb25WYWx1ZShwaWVjZSwgcmVjb3JkLnIsIHJlY29yZC5jKTsKICAgICAgICAgICAgaW5mby5waWVjZSA9IHBpZWNlOwogICAgICAgICAgICBpbmZvLnBpZWNlQ29kZSA9IHBpZWNlU3RhdGUucGllY2VDb2Rlc1tpXTsKICAgICAgICAgICAgaW5mby5yID0gcmVjb3JkLnI7CiAgICAgICAgICAgIGluZm8uYyA9IHJlY29yZC5jOwogICAgICAgICAgICBpbmZvLnBpZWNlSW5kZXggPSBjb3VudCAtIDE7CiAgICAgICAgICAgIGluZm8ubWF0ZXJpYWxWYWx1ZSA9IG1hdGVyaWFsVmFsdWU7CiAgICAgICAgICAgIGluZm8ucG9zaXRpb25WYWx1ZSA9IHBvc2l0aW9uVmFsdWU7CiAgICAgICAgICAgIGluZm8udGhyZWF0VmFsdWUgPSAwOwogICAgICAgICAgICBpbmZvLnNhZmV0eVZhbHVlID0gMDsKICAgICAgICAgICAgaW5mby50YWN0aWNWYWx1ZSA9IDA7CiAgICAgICAgICAgIGluZm8ubW9iaWxpdHlWYWx1ZSA9IDA7CiAgICAgICAgICAgIHBpZWNlc0luZm9bY291bnQgLSAxXSA9IGluZm87CiAgICAgICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsKICAgICAgICAgICAgICAgIHJlZE1hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7CiAgICAgICAgICAgICAgICByZWRQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgYmxhY2tNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOwogICAgICAgICAgICAgICAgYmxhY2tQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfSBlbHNlIHsKICAgICAgICBzY2FuQm9hcmQ6IGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7CiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICAgICAgaWYgKCFwaWVjZSkgY29udGludWU7CiAgICAgICAgICAgICAgICBpZiAoY291bnQgPj0gc2NyYXRjaExlYWZQaWVjZVNsb3RzLmxlbmd0aCkgewogICAgICAgICAgICAgICAgICAgIG92ZXJmbG93ID0gdHJ1ZTsKICAgICAgICAgICAgICAgICAgICBicmVhayBzY2FuQm9hcmQ7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gc2NyYXRjaExlYWZQaWVjZVNsb3RzW2NvdW50KytdOwogICAgICAgICAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7CiAgICAgICAgICAgICAgICBjb25zdCBwb3NpdGlvblZhbHVlID0gZ2V0UG9zaXRpb25WYWx1ZShwaWVjZSwgciwgYyk7CiAgICAgICAgICAgICAgICBpbmZvLnBpZWNlID0gcGllY2U7CiAgICAgICAgICAgICAgICBpbmZvLnBpZWNlQ29kZSA9IHNlYXJjaFBpZWNlQ29kZShwaWVjZSk7CiAgICAgICAgICAgICAgICBpbmZvLnIgPSByOwogICAgICAgICAgICAgICAgaW5mby5jID0gYzsKICAgICAgICAgICAgICAgIGluZm8ucGllY2VJbmRleCA9IGNvdW50IC0gMTsKICAgICAgICAgICAgICAgIGluZm8ubWF0ZXJpYWxWYWx1ZSA9IG1hdGVyaWFsVmFsdWU7CiAgICAgICAgICAgICAgICBpbmZvLnBvc2l0aW9uVmFsdWUgPSBwb3NpdGlvblZhbHVlOwogICAgICAgICAgICAgICAgaW5mby50aHJlYXRWYWx1ZSA9IDA7CiAgICAgICAgICAgICAgICBpbmZvLnNhZmV0eVZhbHVlID0gMDsKICAgICAgICAgICAgICAgIGluZm8udGFjdGljVmFsdWUgPSAwOwogICAgICAgICAgICAgICAgaW5mby5tb2JpbGl0eVZhbHVlID0gMDsKICAgICAgICAgICAgICAgIHBpZWNlc0luZm9bY291bnQgLSAxXSA9IGluZm87CiAgICAgICAgICAgICAgICBpZiAocGllY2UuY29sb3IgPT09ICdyZWQnKSB7CiAgICAgICAgICAgICAgICAgICAgcmVkTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsKICAgICAgICAgICAgICAgICAgICByZWRQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOwogICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICBibGFja01hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7CiAgICAgICAgICAgICAgICAgICAgYmxhY2tQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQogICAgaWYgKG92ZXJmbG93KSB7CiAgICAgICAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVCb2FyZChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHsgZm9yU2VhcmNoTGVhZjogdHJ1ZSB9KTsKICAgICAgICBjb25zdCBvcHBvbmVudCA9IHNlYXJjaEluaXRpYXRvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7CiAgICAgICAgcmV0dXJuIHJlc3VsdFtzZWFyY2hJbml0aWF0b3JdLnRvdGFsIC0gcmVzdWx0W29wcG9uZW50XS50b3RhbDsKICAgIH0KICAgIHBpZWNlc0luZm8ubGVuZ3RoID0gY291bnQ7CgogICAgaWYgKFNFQVJDSF9GQVNUX0xFQUZfUkVMQVRJT05TICYmIHBpZWNlU3RhdGUpIHsKICAgICAgICBjYWxjdWxhdGVTZWFyY2hMZWFmUmVsYXRpb25zKHBpZWNlc0luZm8sIHBpZWNlU3RhdGUuc3F1YXJlQ29kZXMpOwogICAgICAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlcyhwaWVjZXNJbmZvLCBzZWFyY2hJbml0aWF0b3IsIHNjcmF0Y2hMZWFmQm9hcmRJbmZvLCB0cnVlKTsKICAgICAgICBjYWxjdWxhdGVTYWZldHlWYWx1ZXMocGllY2VzSW5mbywgc2NyYXRjaExlYWZCb2FyZEluZm8sIGJvYXJkLCB0cnVlKTsKICAgIH0gZWxzZSB7CiAgICAgICAgY2xlYXJSZWxhdGlvbk1hc2tzKHRydWUpOwogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsKICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaEJsYWNrQXR0YWNrKTsKICAgICAgICBjYWxjdWxhdGVEZXJpdmVkVmFsdWVzKGJvYXJkLCBwaWVjZXNJbmZvLCBzZWFyY2hJbml0aWF0b3IsIHNjcmF0Y2hMZWFmQm9hcmRJbmZvLCB0cnVlKTsKICAgIH0KCiAgICBsZXQgcmVkVGhyZWF0ID0gMDsKICAgIGxldCByZWRUYWN0aWMgPSAwOwogICAgbGV0IHJlZFNhZmV0eSA9IDA7CiAgICBsZXQgcmVkTW9iaWxpdHkgPSAwOwogICAgbGV0IGJsYWNrVGhyZWF0ID0gMDsKICAgIGxldCBibGFja1RhY3RpYyA9IDA7CiAgICBsZXQgYmxhY2tTYWZldHkgPSAwOwogICAgbGV0IGJsYWNrTW9iaWxpdHkgPSAwOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7CiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07CiAgICAgICAgaWYgKGluZm8ucGllY2UuY29sb3IgPT09ICdyZWQnKSB7CiAgICAgICAgICAgIHJlZFRocmVhdCArPSBpbmZvLnRocmVhdFZhbHVlOwogICAgICAgICAgICByZWRUYWN0aWMgKz0gaW5mby50YWN0aWNWYWx1ZTsKICAgICAgICAgICAgcmVkU2FmZXR5ICs9IGluZm8uc2FmZXR5VmFsdWU7CiAgICAgICAgICAgIHJlZE1vYmlsaXR5ICs9IGluZm8ubW9iaWxpdHlWYWx1ZTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgICBibGFja1RocmVhdCArPSBpbmZvLnRocmVhdFZhbHVlOwogICAgICAgICAgICBibGFja1RhY3RpYyArPSBpbmZvLnRhY3RpY1ZhbHVlOwogICAgICAgICAgICBibGFja1NhZmV0eSArPSBpbmZvLnNhZmV0eVZhbHVlOwogICAgICAgICAgICBibGFja01vYmlsaXR5ICs9IGluZm8ubW9iaWxpdHlWYWx1ZTsKICAgICAgICB9CiAgICB9CgogICAgY29uc3QgcmVkVG90YWwgPQogICAgICAgIHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArCiAgICAgICAgcmVkUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsKICAgICAgICByZWRUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArCiAgICAgICAgcmVkVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKwogICAgICAgIHJlZFNhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsKICAgICAgICByZWRNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7CiAgICBjb25zdCBibGFja1RvdGFsID0KICAgICAgICBibGFja01hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCArCiAgICAgICAgYmxhY2tQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24gKwogICAgICAgIGJsYWNrVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKwogICAgICAgIGJsYWNrVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMgKwogICAgICAgIGJsYWNrU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHkgKwogICAgICAgIGJsYWNrTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5OwoKICAgIHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxDb3VudCsrOwogICAgcGVyZlN0YXRzLmZhc3RMZWFmRXZhbE1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsKICAgIHJldHVybiBzZWFyY2hJbml0aWF0b3IgPT09ICdyZWQnID8gcmVkVG90YWwgLSBibGFja1RvdGFsIDogYmxhY2tUb3RhbCAtIHJlZFRvdGFsOwp9OwoNCi8vIOWwhi/luIXkvY3nva7nvJPlrZjvvJrkvpsgcG9zdC1tb3ZlIGlzQ2hlY2sgLyDpo57lsIblv6vpgJ/mn6Xor6LvvIznlLEgbWFrZS91bm1ha2Ug57u05oqkDQpsZXQgZ2VuZXJhbFBvc0NhY2hlID0geyByZWQ6IG51bGwsIGJsYWNrOiBudWxsIH07DQoNCi8vIOWwhuW4heS7heWcqOS5neWuq+WGhe+8jOaMieS5neWuq+aJq+aPj+WNs+WPrw0KY29uc3QgZmluZEdlbmVyYWxQb3MgPSAoYm9hcmQsIGNvbG9yKSA9PiB7DQogICAgY29uc3Qgcm93U3RhcnQgPSBjb2xvciA9PT0gJ3JlZCcgPyAwIDogNzsNCiAgICBjb25zdCByb3dFbmQgPSBjb2xvciA9PT0gJ3JlZCcgPyAyIDogOTsNCiAgICBmb3IgKGxldCByID0gcm93U3RhcnQ7IHIgPD0gcm93RW5kOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDM7IGMgPD0gNTsgYysrKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAocCAmJiBwLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBwLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgICAgIHJldHVybiB7IHIsIGMgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICByZXR1cm4gbnVsbDsNCn07DQoNCmNvbnN0IHN5bmNHZW5lcmFsUG9zQ2FjaGUgPSAoYm9hcmQpID0+IHsNCiAgICBnZW5lcmFsUG9zQ2FjaGUucmVkID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsICdyZWQnKTsNCiAgICBnZW5lcmFsUG9zQ2FjaGUuYmxhY2sgPSBmaW5kR2VuZXJhbFBvcyhib2FyZCwgJ2JsYWNrJyk7DQp9Ow0KDQpjb25zdCBnZXRHZW5lcmFsUG9zID0gKGJvYXJkLCBjb2xvcikgPT4gew0KICAgIGNvbnN0IGNhY2hlZCA9IGdlbmVyYWxQb3NDYWNoZVtjb2xvcl07DQogICAgaWYgKGNhY2hlZCkgew0KICAgICAgICBjb25zdCBwID0gYm9hcmRbY2FjaGVkLnJdPy5bY2FjaGVkLmNdOw0KICAgICAgICBpZiAocCAmJiBwLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBwLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgcmV0dXJuIGNhY2hlZDsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBjb25zdCBwb3MgPSBmaW5kR2VuZXJhbFBvcyhib2FyZCwgY29sb3IpOw0KICAgIGdlbmVyYWxQb3NDYWNoZVtjb2xvcl0gPSBwb3M7DQogICAgcmV0dXJuIHBvczsNCn07DQoNCi8vIOaQnOe0oueUqOWOn+WcsOi1sOWtkCAvIOaBouWkje+8iOmBv+WFjeavj+asoemAkuW9kiBib2FyZC5tYXDvvInvvJvlkIzmraXnu7TmiqTlsIbkvY3nvJPlrZgNCmNvbnN0IG1ha2VNb3ZlID0gKGJvYXJkLCBmcm9tLCB0bykgPT4gewogICAgY29uc3QgcGllY2UgPSBib2FyZFtmcm9tLnJdW2Zyb20uY107CiAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW3RvLnJdW3RvLmNdOwogICAgYm9hcmRbdG8ucl1bdG8uY10gPSBwaWVjZTsKICAgIGJvYXJkW2Zyb20ucl1bZnJvbS5jXSA9IG51bGw7CiAgICB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJNYWtlKGJvYXJkLCBmcm9tLnIgKiA5ICsgZnJvbS5jLCB0by5yICogOSArIHRvLmMpOwogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbcGllY2UuY29sb3JdID0geyByOiB0by5yLCBjOiB0by5jIH07DQogICAgfQ0KICAgIGlmIChjYXB0dXJlZCAmJiBjYXB0dXJlZC50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IG51bGw7DQogICAgfQ0KICAgIHJldHVybiBjYXB0dXJlZDsNCn07DQoNCmNvbnN0IHVubWFrZU1vdmUgPSAoYm9hcmQsIGZyb20sIHRvLCBjYXB0dXJlZCkgPT4gewogICAgY29uc3QgcGllY2UgPSBib2FyZFt0by5yXVt0by5jXTsNCiAgICBib2FyZFtmcm9tLnJdW2Zyb20uY10gPSBwaWVjZTsKICAgIGJvYXJkW3RvLnJdW3RvLmNdID0gY2FwdHVyZWQ7CiAgICB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJVbm1ha2UoYm9hcmQsIGZyb20uciAqIDkgKyBmcm9tLmMsIHRvLnIgKiA5ICsgdG8uYyk7CiAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtwaWVjZS5jb2xvcl0gPSB7IHI6IGZyb20uciwgYzogZnJvbS5jIH07DQogICAgfQ0KICAgIGlmIChjYXB0dXJlZCAmJiBjYXB0dXJlZC50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IHsgcjogdG8uciwgYzogdG8uYyB9Ow0KICAgIH0NCn07DQoNCi8vIOi1sOWtkOWQjuaYr+WQpuS9v+W3seaWueWwhuS4jeWuieWFqO+8iOmjnuWwhuaIluiiq+Wwhu+8ieOAguiwg+eUqOWJjemhu+W3siBtYWtlTW92ZeOAgg0KY29uc3QgbGVhdmVzT3duS2luZ1Vuc2FmZSA9IChib2FyZCwgY29sb3IpID0+IHsKICAgIGNvbnN0IF9fdDAgPSBTRUFSQ0hfUFJPRklMRSA/IHBlcmZvcm1hbmNlLm5vdygpIDogMDsKICAgIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcysrOwogICAgY29uc3QgcGllY2VTdGF0ZSA9IFNFQVJDSF9OVU1FUklDX0NIRUNLID8gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCkgOiBudWxsOwogICAgY29uc3QgdW5zYWZlID0gcGllY2VTdGF0ZSA/IGlzQ2hlY2tSYXdGcm9tUGllY2VTdGF0ZShwaWVjZVN0YXRlLCBjb2xvcikgOiAoaXNGbHlpbmdHZW5lcmFsKGJvYXJkKSB8fCBpc0NoZWNrUmF3KGJvYXJkLCBjb2xvcikpOwogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMubGVnYWxpdHlDaGVja01zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsKICAgIHJldHVybiB1bnNhZmU7Cn07Cg0KLy8g5LuO5Lyq5ZCI5rOV552A5rOV5Lit6L+H5ruk5Ye65LiN6YCB5bCGL+S4jemjnuWwhueahOWQiOazleedgOazle+8iFVJL+agueiKgueCuS/lvIDlsYDlupPmoKHpqozvvIkNCi8vIOaQnOe0oueDrei3r+W+hOS9v+eUqOW7tui/n+WQiOazleaAp++8iOivlei1sOaXtuajgOa1i++8ie+8jOmBv+WFjeWvueWJquaeneacquinpuWPiueahOedgOazleWBmuWFqOmHj+i/h+a7pA0KY29uc3QgZmlsdGVyTGVnYWxNb3ZlcyA9IChib2FyZCwgZnJvbSwgcGllY2UsIHBzZXVkb01vdmVzKSA9PiB7DQogICAgY29uc3QgdmFsaWRNb3ZlcyA9IFtdOw0KICAgIGZvciAoY29uc3QgdG8gb2YgcHNldWRvTW92ZXMpIHsNCiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlTW92ZShib2FyZCwgZnJvbSwgdG8pOw0KICAgICAgICBjb25zdCBpbGxlZ2FsID0gbGVhdmVzT3duS2luZ1Vuc2FmZShib2FyZCwgcGllY2UuY29sb3IpOw0KICAgICAgICB1bm1ha2VNb3ZlKGJvYXJkLCBmcm9tLCB0bywgY2FwdHVyZWQpOw0KICAgICAgICBpZiAoIWlsbGVnYWwpIHZhbGlkTW92ZXMucHVzaCh0byk7DQogICAgfQ0KICAgIHJldHVybiB2YWxpZE1vdmVzOw0KfTsNCg0KLy8gU2VhcmNoIGhvdCBwYXRoIG1vdmUgZW5jb2Rpbmc6IG1vdmUgPSAoZnJvbVNxIDw8IDcpIHwgdG9TcS4NCmNvbnN0IE1PVkVfVE9fTUFTSyA9IDB4N2Y7DQpjb25zdCBlbmNvZGVNb3ZlID0gKGZyb20sIHRvKSA9PiAoKGZyb20uciAqIDkgKyBmcm9tLmMpIDw8IDcpIHwgKHRvLnIgKiA5ICsgdG8uYyk7DQpjb25zdCBlbmNvZGVNb3ZlRnJvbUNvb3JkcyA9IChmciwgZmMsIHRyLCB0YykgPT4gKChmciAqIDkgKyBmYykgPDwgNykgfCAodHIgKiA5ICsgdGMpOw0KY29uc3QgaXNFbmNvZGVkTW92ZSA9IChtb3ZlKSA9PiB0eXBlb2YgbW92ZSA9PT0gJ251bWJlcic7DQpjb25zdCBtb3ZlRnJvbVNxID0gKG1vdmUpID0+IGlzRW5jb2RlZE1vdmUobW92ZSkgPyAobW92ZSA+Pj4gNykgOiBtb3ZlLmZyb20uciAqIDkgKyBtb3ZlLmZyb20uYzsNCmNvbnN0IG1vdmVUb1NxID0gKG1vdmUpID0+IGlzRW5jb2RlZE1vdmUobW92ZSkgPyAobW92ZSAmIE1PVkVfVE9fTUFTSykgOiBtb3ZlLnRvLnIgKiA5ICsgbW92ZS50by5jOw0KY29uc3QgbW92ZUZyb21SID0gKG1vdmUpID0+IHsNCiAgICBjb25zdCBzcSA9IG1vdmVGcm9tU3EobW92ZSk7DQogICAgcmV0dXJuIChzcSAvIDkpIHwgMDsNCn07DQpjb25zdCBtb3ZlRnJvbUMgPSAobW92ZSkgPT4gbW92ZUZyb21TcShtb3ZlKSAlIDk7DQpjb25zdCBtb3ZlVG9SID0gKG1vdmUpID0+IHsNCiAgICBjb25zdCBzcSA9IG1vdmVUb1NxKG1vdmUpOw0KICAgIHJldHVybiAoc3EgLyA5KSB8IDA7DQp9Ow0KY29uc3QgbW92ZVRvQyA9IChtb3ZlKSA9PiBtb3ZlVG9TcShtb3ZlKSAlIDk7DQpjb25zdCBtb3ZlVG9PYmplY3QgPSAobW92ZSkgPT4gew0KICAgIGlmICghaXNFbmNvZGVkTW92ZShtb3ZlKSkgcmV0dXJuIG1vdmU7DQogICAgY29uc3QgZnJvbSA9IG1vdmVGcm9tU3EobW92ZSk7DQogICAgY29uc3QgdG8gPSBtb3ZlVG9TcShtb3ZlKTsNCiAgICByZXR1cm4gew0KICAgICAgICBmcm9tOiB7IHI6IChmcm9tIC8gOSkgfCAwLCBjOiBmcm9tICUgOSB9LA0KICAgICAgICB0bzogeyByOiAodG8gLyA5KSB8IDAsIGM6IHRvICUgOSB9DQogICAgfTsNCn07DQoNCmNvbnN0IG1ha2VTZWFyY2hNb3ZlID0gKGJvYXJkLCBtb3ZlKSA9PiB7DQogICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSByZXR1cm4gbWFrZU1vdmUoYm9hcmQsIG1vdmUuZnJvbSwgbW92ZS50byk7DQogICAgY29uc3QgZnJvbSA9IG1vdmUgPj4+IDc7DQogICAgY29uc3QgdG8gPSBtb3ZlICYgTU9WRV9UT19NQVNLOw0KICAgIGNvbnN0IGZyID0gKGZyb20gLyA5KSB8IDAsIGZjID0gZnJvbSAlIDk7DQogICAgY29uc3QgdHIgPSAodG8gLyA5KSB8IDAsIHRjID0gdG8gJSA5Ow0KICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbZnJdW2ZjXTsNCiAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW3RyXVt0Y107CiAgICBib2FyZFt0cl1bdGNdID0gcGllY2U7CiAgICBib2FyZFtmcl1bZmNdID0gbnVsbDsKICAgIHVwZGF0ZVBpZWNlU3RhdGVBZnRlck1ha2UoYm9hcmQsIGZyb20sIHRvKTsKICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogdHIsIGM6IHRjIH07DQogICAgfQ0KICAgIGlmIChjYXB0dXJlZCAmJiBjYXB0dXJlZC50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IG51bGw7DQogICAgfQ0KICAgIHJldHVybiBjYXB0dXJlZDsNCn07DQoNCmNvbnN0IHVubWFrZVNlYXJjaE1vdmUgPSAoYm9hcmQsIG1vdmUsIGNhcHR1cmVkKSA9PiB7DQogICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSB7DQogICAgICAgIHVubWFrZU1vdmUoYm9hcmQsIG1vdmUuZnJvbSwgbW92ZS50bywgY2FwdHVyZWQpOw0KICAgICAgICByZXR1cm47DQogICAgfQ0KICAgIGNvbnN0IGZyb20gPSBtb3ZlID4+PiA3Ow0KICAgIGNvbnN0IHRvID0gbW92ZSAmIE1PVkVfVE9fTUFTSzsNCiAgICBjb25zdCBmciA9IChmcm9tIC8gOSkgfCAwLCBmYyA9IGZyb20gJSA5Ow0KICAgIGNvbnN0IHRyID0gKHRvIC8gOSkgfCAwLCB0YyA9IHRvICUgOTsNCiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3RyXVt0Y107CiAgICBib2FyZFtmcl1bZmNdID0gcGllY2U7CiAgICBib2FyZFt0cl1bdGNdID0gY2FwdHVyZWQ7CiAgICB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJVbm1ha2UoYm9hcmQsIGZyb20sIHRvKTsKICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogZnIsIGM6IGZjIH07DQogICAgfQ0KICAgIGlmIChjYXB0dXJlZCAmJiBjYXB0dXJlZC50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IHsgcjogdHIsIGM6IHRjIH07DQogICAgfQ0KfTsNCg0KY29uc3Qgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2ggPSBbXTsNCmNvbnN0IHNvcnRNb3ZlU2NvcmVTY3JhdGNoID0gW107DQpjb25zdCBzcXVhcmVNYXJrU2NyYXRjaCA9IG5ldyBVaW50OEFycmF5KFJFTF9TUVVBUkVTKTsNCmNvbnN0IHNxdWFyZU1hcmtUb3VjaGVkID0gW107DQoNCmNvbnN0IG1hcmtTb3J0U3F1YXJlID0gKHNxKSA9PiB7DQogICAgaWYgKCFzcXVhcmVNYXJrU2NyYXRjaFtzcV0pIHsNCiAgICAgICAgc3F1YXJlTWFya1NjcmF0Y2hbc3FdID0gMTsNCiAgICAgICAgc3F1YXJlTWFya1RvdWNoZWQucHVzaChzcSk7DQogICAgfQ0KfTsNCg0KY29uc3QgY2xlYXJTb3J0U3F1YXJlTWFya3MgPSAoKSA9PiB7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzcXVhcmVNYXJrVG91Y2hlZC5sZW5ndGg7IGkrKykgew0KICAgICAgICBzcXVhcmVNYXJrU2NyYXRjaFtzcXVhcmVNYXJrVG91Y2hlZFtpXV0gPSAwOw0KICAgIH0NCiAgICBzcXVhcmVNYXJrVG91Y2hlZC5sZW5ndGggPSAwOw0KfTsNCg0KY29uc3Qgc29ydE1vdmVzRmFzdCA9IChtb3ZlcywgYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIHBpZWNlc0luZm8sIGdhbWVTdGFnZSA9ICdtaWQnLCBib2FyZEluZm8gPSBudWxsLCBzZWFyY2hIZXVyaXN0aWNzID0gbnVsbCkgPT4gewogICAgY29uc3QgX190MCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOwogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuc29ydE1vdmVzQ291bnQrKzsKICAgIGNvbnN0IGN1cnJlbnRJc0luQ2hlY2sgPSBib2FyZEluZm8NCiAgICAgICAgPyAoKGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnICYmIGJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8DQogICAgICAgICAgIChjdXJyZW50UGxheWVyID09PSAnYmxhY2snICYmIGJvYXJkSW5mby5ibGFja0lzSW5DaGVjaykpDQogICAgICAgIDogaXNDaGVjayhib2FyZCwgY3VycmVudFBsYXllcik7DQoNCiAgICBpZiAoY3VycmVudElzSW5DaGVjayAmJiBwaWVjZXNJbmZvICYmIHBpZWNlc0luZm8ubGVuZ3RoID4gMCkgew0KICAgICAgICBsZXQgZ2VuZXJhbEluZm8gPSBudWxsOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICAgICAgaWYgKGluZm8ucGllY2UgJiYgaW5mby5waWVjZS50eXBlID09PSAnZ2VuZXJhbCcgJiYgaW5mby5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgIGdlbmVyYWxJbmZvID0gaW5mbzsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoZ2VuZXJhbEluZm8pIHsNCiAgICAgICAgICAgIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpIHsNCiAgICAgICAgICAgICAgICBsZXQgbSA9IGJvYXJkSW5mby5hdHRhY2tNYXNrW2dlbmVyYWxJbmZvLnIgKiA5ICsgZ2VuZXJhbEluZm8uY10gPj4+IDA7DQogICAgICAgICAgICAgICAgd2hpbGUgKG0gIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgYml0ID0gbSAmIC1tOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0ID0gcGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV07DQogICAgICAgICAgICAgICAgICAgIGlmICh0ICYmIHQucGllY2UgJiYgdC5waWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgbWFya1NvcnRTcXVhcmUodC5yICogOSArIHQuYyk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgbSBePSBiaXQ7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIGlmIChnZW5lcmFsSW5mby50aHJlYXRlbmVkQnkpIHsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeS5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0ID0gZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5W2ldOw0KICAgICAgICAgICAgICAgICAgICBpZiAodC5waWVjZSAmJiB0LnBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBtYXJrU29ydFNxdWFyZSh0LnIgKiA5ICsgdC5jKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGNvbnN0IGhhc1RocmVhdGVuZWQgPSAhY3VycmVudElzSW5DaGVjayAmJiAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMgJiYgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMubGVuZ3RoID4gMCk7DQogICAgaWYgKGhhc1RocmVhdGVuZWQpIHsNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzW2ldOw0KICAgICAgICAgICAgbWFya1NvcnRTcXVhcmUocC5yICogOSArIHAuYyk7DQogICAgICAgIH0NCiAgICB9DQogICAgY29uc3QgdGhyZWF0ZW5lZE1hcmtFbmQgPSBzcXVhcmVNYXJrVG91Y2hlZC5sZW5ndGg7DQoNCiAgICBjb25zdCBoYXNDYW5DYXB0dXJlID0gIWN1cnJlbnRJc0luQ2hlY2sgJiYgISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby5jYW5DYXB0dXJlICYmIGJvYXJkSW5mby5jYW5DYXB0dXJlLmxlbmd0aCA+IDApOw0KICAgIGlmIChoYXNDYW5DYXB0dXJlKSB7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYm9hcmRJbmZvLmNhbkNhcHR1cmUubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZEluZm8uY2FuQ2FwdHVyZVtpXTsNCiAgICAgICAgICAgIG1hcmtTb3J0U3F1YXJlKHAuciAqIDkgKyBwLmMpOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3QgdHRNb3ZlID0gc2VhcmNoSGV1cmlzdGljcz8udHRNb3ZlIHx8IG51bGw7CiAgICBjb25zdCBraWxsZXJzID0gc2VhcmNoSGV1cmlzdGljcz8ua2lsbGVycyB8fCBudWxsOwogICAgY29uc3QgcGllY2VTdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOwogICAgY29uc3QgdXNlU2ltcGxlU2VhcmNoU29ydCA9IFNFQVJDSF9GQVNUX1NPUlQgJiYgcGllY2VTdGF0ZSAmJiAhY3VycmVudElzSW5DaGVjayAmJiAhaGFzVGhyZWF0ZW5lZCAmJiAhaGFzQ2FuQ2FwdHVyZTsKICAgIGNvbnN0IGlzTWFya2VkVGhyZWF0ZW5lZCA9IChzcSkgPT4gewogICAgICAgIGlmICghaGFzVGhyZWF0ZW5lZCkgcmV0dXJuIGZhbHNlOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRocmVhdGVuZWRNYXJrRW5kOyBpKyspIHsNCiAgICAgICAgICAgIGlmIChzcXVhcmVNYXJrVG91Y2hlZFtpXSA9PT0gc3EpIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBmYWxzZTsNCiAgICB9Ow0KDQogICAgaWYgKHVzZVNpbXBsZVNlYXJjaFNvcnQpIHsKICAgICAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsKICAgICAgICBjb25zdCBwaWVjZUNvZGVzID0gcGllY2VTdGF0ZS5waWVjZUNvZGVzOwogICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWVzID0gc2VhcmNoTWF0ZXJpYWxUYWJsZShnYW1lU3RhZ2UpOwogICAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBtb3Zlcy5sZW5ndGg7IGluZGV4KyspIHsKICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2luZGV4XTsKICAgICAgICAgICAgY29uc3QgZnJvbVNxID0gbW92ZSA+Pj4gNzsKICAgICAgICAgICAgY29uc3QgdG9TcSA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7CiAgICAgICAgICAgIGNvbnN0IHRhcmdldFNsb3QgPSBzcXVhcmVUb1Nsb3RbdG9TcV07CiAgICAgICAgICAgIGNvbnN0IHRhcmdldFBpZWNlQ29kZSA9IHRhcmdldFNsb3QgPj0gMCA/IHBpZWNlQ29kZXNbdGFyZ2V0U2xvdF0gOiAwOwogICAgICAgICAgICBsZXQgcHJpb3JpdHkgPSA0OwogICAgICAgICAgICBsZXQgc2NvcmUgPSAwOwoKICAgICAgICAgICAgaWYgKHR0TW92ZSA9PT0gbW92ZSkgewogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAtMTsKICAgICAgICAgICAgICAgIHNjb3JlID0gMTAwMDAwMDsKICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRTbG90ID49IDApIHsKICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMzsKICAgICAgICAgICAgICAgIHNjb3JlID0gbWF0ZXJpYWxWYWx1ZXNbdGFyZ2V0UGllY2VDb2RlICYgN10gKiAxNiAtIG1hdGVyaWFsVmFsdWVzW3BpZWNlQ29kZXNbc3F1YXJlVG9TbG90W2Zyb21TcV1dICYgN107CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIGlmIChwcmlvcml0eSA+PSAwKSB7CiAgICAgICAgICAgICAgICBpZiAodGFyZ2V0U2xvdCA8IDAgJiYga2lsbGVycyAmJiBtb3ZlID09PSBraWxsZXJzWzBdKSB7CiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7CiAgICAgICAgICAgICAgICAgICAgc2NvcmUgKz0gODAwMDsKICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0U2xvdCA8IDAgJiYga2lsbGVycyAmJiBtb3ZlID09PSBraWxsZXJzWzFdKSB7CiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7CiAgICAgICAgICAgICAgICAgICAgc2NvcmUgKz0gNzAwMDsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIHNjb3JlICs9IGdldEhpc3RvcnlTY29yZShtb3ZlKTsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaW5kZXhdID0gcHJpb3JpdHk7CiAgICAgICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2luZGV4XSA9IHNjb3JlOwogICAgICAgIH0KICAgIH0gZWxzZSBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbW92ZXMubGVuZ3RoOyBpbmRleCsrKSB7CiAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2luZGV4XTsNCiAgICAgICAgY29uc3QgZnJvbVNxID0gbW92ZUZyb21TcShtb3ZlKTsNCiAgICAgICAgY29uc3QgdG9TcSA9IG1vdmVUb1NxKG1vdmUpOw0KICAgICAgICBjb25zdCBmcm9tUiA9IChmcm9tU3EgLyA5KSB8IDAsIGZyb21DID0gZnJvbVNxICUgOTsNCiAgICAgICAgY29uc3QgdG9SID0gKHRvU3EgLyA5KSB8IDAsIHRvQyA9IHRvU3EgJSA5Ow0KICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2Zyb21SXVtmcm9tQ107DQogICAgICAgIGNvbnN0IHBpZWNlVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCB0YXJnZXRQaWVjZSA9IGJvYXJkW3RvUl1bdG9DXTsNCiAgICAgICAgY29uc3QgdGFyZ2V0UGllY2VWYWx1ZSA9IHRhcmdldFBpZWNlID8gZ2V0TWF0ZXJpYWxWYWx1ZSh0YXJnZXRQaWVjZSwgZ2FtZVN0YWdlKSA6IDA7DQogICAgICAgIGxldCBwcmlvcml0eSA9IDQ7DQogICAgICAgIGxldCBzY29yZSA9IDA7DQoNCiAgICAgICAgaWYgKHR0TW92ZSAmJiBpc1NhbWVNb3ZlKG1vdmUsIHR0TW92ZSkpIHsNCiAgICAgICAgICAgIHByaW9yaXR5ID0gLTE7DQogICAgICAgICAgICBzY29yZSA9IDEwMDAwMDA7DQogICAgICAgIH0gZWxzZSBpZiAoY3VycmVudElzSW5DaGVjaykgew0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZXNDaGVja2VyID0gdGFyZ2V0UGllY2UgJiYgc3F1YXJlTWFya1NjcmF0Y2hbdG9TcV0gIT09IDA7DQogICAgICAgICAgICBpZiAoY2FwdHVyZXNDaGVja2VyKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAwOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gMTAwMDAgKyB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMjsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWUgKiAxNiAtIHBpZWNlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHBpZWNlVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoaGFzVGhyZWF0ZW5lZCkgew0KICAgICAgICAgICAgaWYgKGlzTWFya2VkVGhyZWF0ZW5lZChmcm9tU3EpKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAxOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gcGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IGhhc0NhbkNhcHR1cmUgJiYgc3F1YXJlTWFya1NjcmF0Y2hbdG9TcV0gIT09IDAgPyAyIDogMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoaGFzQ2FuQ2FwdHVyZSkgew0KICAgICAgICAgICAgaWYgKHNxdWFyZU1hcmtTY3JhdGNoW3RvU3FdICE9PSAwKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7DQogICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWUgKiAxNiAtIHBpZWNlVmFsdWU7DQogICAgICAgIH0NCg0KICAgICAgICBpZiAocHJpb3JpdHkgPj0gMCkgew0KICAgICAgICAgICAgaWYgKCF0YXJnZXRQaWVjZSAmJiBraWxsZXJzICYmIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc1swXSkpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IE1hdGgubWluKHByaW9yaXR5LCAyKTsNCiAgICAgICAgICAgICAgICBzY29yZSArPSA4MDAwOw0KICAgICAgICAgICAgfSBlbHNlIGlmICghdGFyZ2V0UGllY2UgJiYga2lsbGVycyAmJiBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNbMV0pKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7DQogICAgICAgICAgICAgICAgc2NvcmUgKz0gNzAwMDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHNjb3JlICs9IGdldEhpc3RvcnlTY29yZShtb3ZlKTsNCiAgICAgICAgfQ0KDQogICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2luZGV4XSA9IHByaW9yaXR5Ow0KICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtpbmRleF0gPSBzY29yZTsNCiAgICAgICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSB7DQogICAgICAgICAgICBtb3ZlLnByaW9yaXR5ID0gcHJpb3JpdHk7DQogICAgICAgICAgICBtb3ZlLnNvcnRTY29yZSA9IHNjb3JlOw0KICAgICAgICAgICAgbW92ZS5vcmlnaW5hbEluZGV4ID0gaW5kZXg7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBmb3IgKGxldCBpID0gMTsgaSA8IG1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpXTsNCiAgICAgICAgY29uc3QgcHJpb3JpdHkgPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtpXTsNCiAgICAgICAgY29uc3Qgc2NvcmUgPSBzb3J0TW92ZVNjb3JlU2NyYXRjaFtpXTsNCiAgICAgICAgbGV0IGogPSBpIC0gMTsNCiAgICAgICAgd2hpbGUgKA0KICAgICAgICAgICAgaiA+PSAwICYmDQogICAgICAgICAgICAoc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbal0gPiBwcmlvcml0eSB8fA0KICAgICAgICAgICAgIChzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXSA9PT0gcHJpb3JpdHkgJiYgc29ydE1vdmVTY29yZVNjcmF0Y2hbal0gPCBzY29yZSkpDQogICAgICAgICkgew0KICAgICAgICAgICAgbW92ZXNbaiArIDFdID0gbW92ZXNbal07DQogICAgICAgICAgICBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqICsgMV0gPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXTsNCiAgICAgICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2ogKyAxXSA9IHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2pdOw0KICAgICAgICAgICAgai0tOw0KICAgICAgICB9DQogICAgICAgIG1vdmVzW2ogKyAxXSA9IG1vdmU7DQogICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2ogKyAxXSA9IHByaW9yaXR5Ow0KICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqICsgMV0gPSBzY29yZTsNCiAgICB9DQoNCiAgICBjbGVhclNvcnRTcXVhcmVNYXJrcygpOwogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuc29ydE1vdmVzTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOwogICAgcmV0dXJuIG1vdmVzOwp9OwoNCi8vIOaQnOe0oueUqOedgOazleWHhuWkh++8iOi9u+mHj++8ie+8muS4jeW7uuWFs+ezu+Wbvi/lqIHog4Ev5py65Yqo5oCnDQovLyBTRUFSQ0hfREVGRVJfTEVHQUxJVFk9dHJ1Ze+8muWPqueUn+aIkOS8quWQiOazle+8jOWQiOazleaAp+WcqOivlei1sOaXtuajgOa1iw0KLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPWZhbHNl77ya6aKE6L+H5ruk5ZCI5rOV552A77yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQ0KLy8g54K55qOL5YWz57O75LuN6LWw5a6M5pW0IGV2YWx1YXRlQm9hcmTvvIzkuI3lj5flvbHlk40NCmNvbnN0IHByZXBhcmVTZWFyY2hJbmZvID0gKGJvYXJkLCBjdXJyZW50UGxheWVyKSA9PiB7DQogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOwogICAgcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnRbY3VycmVudFBsYXllcl0rKzsNCg0KICAgIGNvbnN0IGluQ2hlY2sgPSBpc0NoZWNrUmF3KGJvYXJkLCBjdXJyZW50UGxheWVyKTsKICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnByZXBhcmVDaGVja01zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsKICAgIGNvbnN0IF9fbW92ZXNUMCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOwogICAgY29uc3QgcGllY2VzSW5mbyA9IFtdOwogICAgY29uc3QgbGVnYWxNb3ZlTGlzdCA9IFtdOwogICAgY29uc3QgZGVmZXIgPSBTRUFSQ0hfREVGRVJfTEVHQUxJVFk7CiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7CgogICAgaWYgKHBpZWNlU3RhdGUgJiYgU0VBUkNIX0ZBU1RfUFNFVURPX01PVkVTICYmIGRlZmVyKSB7CiAgICAgICAgY29uc3QgcmVjb3JkcyA9IHBpZWNlU3RhdGUucmVjb3JkczsKICAgICAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsKICAgICAgICBjb25zdCBzcXVhcmVDb2RlcyA9IHBpZWNlU3RhdGUuc3F1YXJlQ29kZXM7CiAgICAgICAgY29uc3QgcGllY2VDb2RlcyA9IHBpZWNlU3RhdGUucGllY2VDb2RlczsKICAgICAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsKICAgICAgICAgICAgY29uc3Qgc2xvdCA9IHNxdWFyZVRvU2xvdFtzcV07CiAgICAgICAgICAgIGlmIChzbG90IDwgMCkgY29udGludWU7CiAgICAgICAgICAgIGNvbnN0IHJlY29yZCA9IHJlY29yZHNbc2xvdF07CiAgICAgICAgICAgIGlmICghcmVjb3JkLmFsaXZlIHx8IHJlY29yZC5waWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7CiAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7IHBpZWNlOiByZWNvcmQucGllY2UsIHI6IHJlY29yZC5yLCBjOiByZWNvcmQuYyB9KTsKICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IGFwcGVuZFNlYXJjaFBzZXVkb01vdmVzRm9yUGllY2UoCiAgICAgICAgICAgICAgICBsZWdhbE1vdmVMaXN0LCBzcSwgcGllY2VDb2Rlc1tzbG90XSwgc3F1YXJlQ29kZXMsIGZhbHNlCiAgICAgICAgICAgICk7CiAgICAgICAgfQogICAgfSBlbHNlIGlmIChwaWVjZVN0YXRlKSB7CiAgICAgICAgY29uc3QgcmVjb3JkcyA9IHBpZWNlU3RhdGUucmVjb3JkczsKICAgICAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsKICAgICAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsKICAgICAgICAgICAgY29uc3Qgc2xvdCA9IHNxdWFyZVRvU2xvdFtzcV07CiAgICAgICAgICAgIGlmIChzbG90IDwgMCkgY29udGludWU7CiAgICAgICAgICAgIGNvbnN0IHJlY29yZCA9IHJlY29yZHNbc2xvdF07CiAgICAgICAgICAgIGlmIChyZWNvcmQuYWxpdmUgJiYgcmVjb3JkLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7CiAgICAgICAgICAgICAgICBjb25zdCByID0gcmVjb3JkLnI7CiAgICAgICAgICAgICAgICBjb25zdCBjID0gcmVjb3JkLmM7CiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IHJlY29yZC5waWVjZTsKICAgICAgICAgICAgICAgIGNvbnN0IGZyb20gPSB7IHIsIGMgfTsKICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UpOwogICAgICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IG1vdmVzIDogZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UsIG1vdmVzKTsKICAgICAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7IHBpZWNlLCByLCBjLCBtb3ZlcywgbGVnYWxNb3ZlczogdXNlTW92ZXMgfSk7CiAgICAgICAgICAgICAgICBmb3IgKGxldCBqID0gMDsgaiA8IHVzZU1vdmVzLmxlbmd0aDsgaisrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tqXTsKICAgICAgICAgICAgICAgICAgICBsZWdhbE1vdmVMaXN0LnB1c2goZW5jb2RlTW92ZUZyb21Db29yZHMociwgYywgdG8uciwgdG8uYykpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IG1vdmVzLmxlbmd0aDsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0gZWxzZSB7CiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsKICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgICAgICBpZiAoIXBpZWNlIHx8IHBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSBjb250aW51ZTsKICAgICAgICAgICAgICAgIGNvbnN0IGZyb20gPSB7IHIsIGMgfTsKICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UpOwogICAgICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IG1vdmVzIDogZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UsIG1vdmVzKTsKICAgICAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7IHBpZWNlLCByLCBjLCBtb3ZlcywgbGVnYWxNb3ZlczogdXNlTW92ZXMgfSk7CiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHVzZU1vdmVzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tpXTsKICAgICAgICAgICAgICAgICAgICBsZWdhbE1vdmVMaXN0LnB1c2goZW5jb2RlTW92ZUZyb21Db29yZHMociwgYywgdG8uciwgdG8uYykpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IG1vdmVzLmxlbmd0aDsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnByZXBhcmVNb3ZlR2VuTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX21vdmVzVDA7Cg0KICAgIC8vIOi9u+mHjyBib2FyZEluZm/vvJrku4XooqvlsIbmoIflv5cNCiAgICBjb25zdCBib2FyZEluZm8gPSB7DQogICAgICAgIHJlZElzSW5DaGVjazogY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyBpbkNoZWNrIDogZmFsc2UsDQogICAgICAgIGJsYWNrSXNJbkNoZWNrOiBjdXJyZW50UGxheWVyID09PSAnYmxhY2snID8gaW5DaGVjayA6IGZhbHNlLA0KICAgICAgICBnYW1lU3RhdGU6IG51bGwNCiAgICB9Ow0KDQogICAgaWYgKGxlZ2FsTW92ZUxpc3QubGVuZ3RoID09PSAwKSB7DQogICAgICAgIGNvbnN0IG9wcG9uZW50ID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGJvYXJkSW5mby5nYW1lU3RhdGUgPSBpbkNoZWNrDQogICAgICAgICAgICA/IHsgc3RhdHVzOiAnY2hlY2ttYXRlJywgd2lubmVyOiBvcHBvbmVudCB9DQogICAgICAgICAgICA6IHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgIH0gZWxzZSB7DQogICAgICAgIGJvYXJkSW5mby5nYW1lU3RhdGUgPSB7IHN0YXR1czogJ3BsYXlpbmcnIH07DQogICAgfQ0KDQogICAgcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIHJldHVybiB7IHBpZWNlc0luZm8sIGJvYXJkSW5mbywgbGVnYWxNb3ZlTGlzdCwgaW5DaGVjayB9Ow0KfTsNCg0KLy8g6K6h566X6KGN55Sf5YC877ya5aiB6IOB5YC844CB5a6J5YWo5YC844CB5oiY5pyv5YC844CB5py65Yqo5YC8DQpjb25zdCBjYWxjdWxhdGVEZXJpdmVkVmFsdWVzID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyID0gbnVsbCwgYm9hcmRJbmZvID0gbnVsbCwgZm9yU2VhcmNoTGVhZiA9IGZhbHNlKSA9PiB7DQogICAgLy8g6YeN572u5omA5pyJ6KGN55Sf5YC877yM6Zmk5LqG5py65Yqo5YC877yI5bey5Zyo5pS26ZuG5qOL5a2Q5L+h5oGv5pe26K6h566X77yJDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaW5mby50aHJlYXRWYWx1ZSA9IDA7DQogICAgICAgIGluZm8uc2FmZXR5VmFsdWUgPSAwOw0KICAgICAgICBpbmZvLnRhY3RpY1ZhbHVlID0gMDsNCiAgICAgICAgLy8g5L+d55WZ5py65Yqo5YC877yM5Zug5Li65bey5Zyo5pS26ZuG5qOL5a2Q5L+h5oGv5pe26K6h566XDQogICAgfQ0KICAgIA0KICAgIC8vIDEuIOiuoeeul+aji+WtkOWFs+ezu++8iOWogeiDgeiAheOAgeiiq+WogeiDgeiAheOAgeS/neaKpOiAheOAgeiiq+S/neaKpOiAhe+8iQ0KICAgIGlmICghYm9hcmRJbmZvKSB7DQogICAgICAgIGJvYXJkSW5mbyA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpLm1hcCgoKSA9PiBbXSkpOw0KICAgIH0NCiAgICBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyhib2FyZCwgcGllY2VzSW5mbywgYm9hcmRJbmZvKTsNCiAgICANCiAgICAvLyAyLiDorqHnrpflqIHog4HlgLzvvIjmjInooqvlqIHog4HlrZDogZrlkIjvvIxTRUUg5q+P55uu5qCH5LiA5qyh77yJDQogICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzKHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbywgZm9yU2VhcmNoTGVhZik7CiAgICANCiAgICAvLyAzLiDorqHnrpflronlhajlgLwNCiAgICBjYWxjdWxhdGVTYWZldHlWYWx1ZXMocGllY2VzSW5mbywgYm9hcmRJbmZvLCBib2FyZCwgZm9yU2VhcmNoTGVhZik7CiAgICANCiAgICAvLyA0LiDorqHnrpfmuLjmiI/nirbmgIHlubbkv53lrZjliLBib2FyZEluZm8NCiAgICAvLyDmkJzntKLlj7boioLngrnot7Pov4fvvJrml6DnnYAv5bCG5q275bey5Zyo54i26IqC54K55aSE55CG77yM5q2k5aSE5Y+q6ZyA6Z2Z5oCB5YiGDQogICAgaWYgKGN1cnJlbnRQbGF5ZXIgJiYgIWZvclNlYXJjaExlYWYpIHsNCiAgICAgICAgLy8g5qOA5p+l5b2T5YmN546p5a625piv5ZCm5pyJ5ZCI5rOV6LWw5rOVDQogICAgICAgIGxldCBoYXNNb3ZlcyA9IGZhbHNlOw0KICAgICAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICAgICAgaWYgKGluZm8ucGllY2UuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgICAgICAgICAvLyDojrflj5blvZPliY3mo4vlrZDnmoTmnInmlYjotbDms5UNCiAgICAgICAgICAgICAgICBjb25zdCBtb3ZlcyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIHsgcjogaW5mby5yLCBjOiBpbmZvLmMgfSk7DQogICAgICAgICAgICAgICAgaWYgKG1vdmVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICAgICAgaGFzTW92ZXMgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIOWIpOaWrea4uOaIj+eKtuaAgQ0KICAgICAgICBsZXQgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdwbGF5aW5nJyB9Ow0KICAgICAgICBpZiAoIWhhc01vdmVzKSB7DQogICAgICAgICAgICAvLyDmsqHmnInlkIjms5XotbDms5XvvIzmo4Dmn6XmmK/lkKbooqvlsIblhpsNCiAgICAgICAgICAgIGNvbnN0IGluQ2hlY2sgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRJc0luQ2hlY2sgOiBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2s7DQogICAgICAgICAgICBjb25zdCBvcHBvbmVudCA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoaW5DaGVjaykgew0KICAgICAgICAgICAgICAgIGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAnY2hlY2ttYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ3N0YWxlbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy8g5L+d5a2Y5ri45oiP54q25oCB5YiwYm9hcmRJbmZvDQogICAgICAgIGJvYXJkSW5mby5nYW1lU3RhdGUgPSBnYW1lU3RhdGU7DQogICAgfQ0KfTsNCg0KLy8g5qOL5a2Q5Yeg5L2V5pa55ZCR6KGo77yI6aKE6K6h566X6IW/L+ecvOWBj+enu++8jOeDrei3r+W+hOmBv+WFjSBNYXRoLnNpZ24gLyBkci8y77yJDQpjb25zdCBPUlRIX0RJUlMgPSBbDQogICAgWzAsIDFdLCBbMCwgLTFdLCBbMSwgMF0sIFstMSwgMF0NCl07DQpjb25zdCBESUFHX0RJUlMgPSBbDQogICAgWzEsIDFdLCBbMSwgLTFdLCBbLTEsIDFdLCBbLTEsIC0xXQ0KXTsNCmNvbnN0IEVMRVBIQU5UX0RJUlMgPSBbDQogICAgeyBkcjogMiwgZGM6IDIsIGV5ZURyOiAxLCBleWVEYzogMSB9LA0KICAgIHsgZHI6IDIsIGRjOiAtMiwgZXllRHI6IDEsIGV5ZURjOiAtMSB9LA0KICAgIHsgZHI6IC0yLCBkYzogMiwgZXllRHI6IC0xLCBleWVEYzogMSB9LA0KICAgIHsgZHI6IC0yLCBkYzogLTIsIGV5ZURyOiAtMSwgZXllRGM6IC0xIH0NCl07DQpjb25zdCBIT1JTRV9ESVJTID0gWw0KICAgIHsgZHI6IDIsIGRjOiAxLCBsZWdEcjogMSwgbGVnRGM6IDAgfSwNCiAgICB7IGRyOiAyLCBkYzogLTEsIGxlZ0RyOiAxLCBsZWdEYzogMCB9LA0KICAgIHsgZHI6IC0yLCBkYzogMSwgbGVnRHI6IC0xLCBsZWdEYzogMCB9LA0KICAgIHsgZHI6IC0yLCBkYzogLTEsIGxlZ0RyOiAtMSwgbGVnRGM6IDAgfSwNCiAgICB7IGRyOiAxLCBkYzogMiwgbGVnRHI6IDAsIGxlZ0RjOiAxIH0sDQogICAgeyBkcjogMSwgZGM6IC0yLCBsZWdEcjogMCwgbGVnRGM6IC0xIH0sDQogICAgeyBkcjogLTEsIGRjOiAyLCBsZWdEcjogMCwgbGVnRGM6IDEgfSwNCiAgICB7IGRyOiAtMSwgZGM6IC0yLCBsZWdEcjogMCwgbGVnRGM6IC0xIH0NCl07DQoNCi8vIOefreatpeWtkOmihOihqO+8muS4juWOnyBzd2l0Y2gg5pa55ZCR6aG65bqPL+Wuq+ays+i/h+a7pOS4gOiHtO+8m+mprOixoeW4piBicixiY++8iOiFvy/nnLzvvIkNCmNvbnN0IEdFTkVSQUxfREVTVCA9IFtuZXcgQXJyYXkoUkVMX1NRVUFSRVMpLCBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpXTsNCmNvbnN0IEFEVklTT1JfREVTVCA9IFtuZXcgQXJyYXkoUkVMX1NRVUFSRVMpLCBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpXTsNCmNvbnN0IEVMRVBIQU5UX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07DQpjb25zdCBIT1JTRV9ERVNUID0gbmV3IEFycmF5KFJFTF9TUVVBUkVTKTsNCmNvbnN0IFNPTERJRVJfREVTVCA9IFtuZXcgQXJyYXkoUkVMX1NRVUFSRVMpLCBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpXTsNCg0KKCgpID0+IHsNCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3Qgc3EgPSByICogOSArIGM7DQogICAgICAgICAgICBjb25zdCBnUmVkID0gW10sIGdCbGFjayA9IFtdLCBhUmVkID0gW10sIGFCbGFjayA9IFtdOw0KICAgICAgICAgICAgY29uc3QgZVJlZCA9IFtdLCBlQmxhY2sgPSBbXSwgaG9yc2UgPSBbXSwgc1JlZCA9IFtdLCBzQmxhY2sgPSBbXTsNCg0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBPUlRIX0RJUlNbaV1bMF0sIG5jID0gYyArIE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgICAgICAgICBpZiAobmMgPCAzIHx8IG5jID4gNSkgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKG5yID49IDAgJiYgbnIgPD0gMikgZ1JlZC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgIGlmIChuciA+PSA3ICYmIG5yIDw9IDkpIGdCbGFjay5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBESUFHX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBESUFHX0RJUlNbaV1bMF0sIG5jID0gYyArIERJQUdfRElSU1tpXVsxXTsNCiAgICAgICAgICAgICAgICBpZiAobmMgPCAzIHx8IG5jID4gNSkgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKG5yID49IDAgJiYgbnIgPD0gMikgYVJlZC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgIGlmIChuciA+PSA3ICYmIG5yIDw9IDkpIGFCbGFjay5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBFTEVQSEFOVF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IEVMRVBIQU5UX0RJUlNbaV07DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZC5kciwgbmMgPSBjICsgZC5kYzsNCiAgICAgICAgICAgICAgICBpZiAobnIgPCAwIHx8IG5yID49IFJPV1MgfHwgbmMgPCAwIHx8IG5jID49IENPTFMpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGNvbnN0IGV5ZVIgPSByICsgZC5leWVEciwgZXllQyA9IGMgKyBkLmV5ZURjOw0KICAgICAgICAgICAgICAgIGlmIChuciA8PSA0KSBlUmVkLnB1c2goeyByOiBuciwgYzogbmMsIGJyOiBleWVSLCBiYzogZXllQyB9KTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPj0gNSkgZUJsYWNrLnB1c2goeyByOiBuciwgYzogbmMsIGJyOiBleWVSLCBiYzogZXllQyB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgSE9SU0VfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBIT1JTRV9ESVJTW2ldOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIGQuZHIsIG5jID0gYyArIGQuZGM7DQogICAgICAgICAgICAgICAgY29uc3QgbGVnUiA9IHIgKyBkLmxlZ0RyLCBsZWdDID0gYyArIGQubGVnRGM7DQogICAgICAgICAgICAgICAgaWYgKGxlZ1IgPCAwIHx8IGxlZ1IgPj0gUk9XUyB8fCBsZWdDIDwgMCB8fCBsZWdDID49IENPTFMpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChuciA8IDAgfHwgbnIgPj0gUk9XUyB8fCBuYyA8IDAgfHwgbmMgPj0gQ09MUykgY29udGludWU7DQogICAgICAgICAgICAgICAgaG9yc2UucHVzaCh7IHI6IG5yLCBjOiBuYywgYnI6IGxlZ1IsIGJjOiBsZWdDIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgew0KICAgICAgICAgICAgICAgIGNvbnN0IGZyID0gciArIDE7DQogICAgICAgICAgICAgICAgaWYgKGZyID49IDAgJiYgZnIgPCBST1dTKSBzUmVkLnB1c2goeyByOiBmciwgYyB9KTsNCiAgICAgICAgICAgICAgICBpZiAociA+PSA1KSB7DQogICAgICAgICAgICAgICAgICAgIGlmIChjIC0gMSA+PSAwKSBzUmVkLnB1c2goeyByLCBjOiBjIC0gMSB9KTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGMgKyAxIDwgQ09MUykgc1JlZC5wdXNoKHsgciwgYzogYyArIDEgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGNvbnN0IGZiciA9IHIgLSAxOw0KICAgICAgICAgICAgICAgIGlmIChmYnIgPj0gMCAmJiBmYnIgPCBST1dTKSBzQmxhY2sucHVzaCh7IHI6IGZiciwgYyB9KTsNCiAgICAgICAgICAgICAgICBpZiAociA8PSA0KSB7DQogICAgICAgICAgICAgICAgICAgIGlmIChjIC0gMSA+PSAwKSBzQmxhY2sucHVzaCh7IHIsIGM6IGMgLSAxIH0pOw0KICAgICAgICAgICAgICAgICAgICBpZiAoYyArIDEgPCBDT0xTKSBzQmxhY2sucHVzaCh7IHIsIGM6IGMgKyAxIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgR0VORVJBTF9ERVNUWzBdW3NxXSA9IGdSZWQ7DQogICAgICAgICAgICBHRU5FUkFMX0RFU1RbMV1bc3FdID0gZ0JsYWNrOw0KICAgICAgICAgICAgQURWSVNPUl9ERVNUWzBdW3NxXSA9IGFSZWQ7DQogICAgICAgICAgICBBRFZJU09SX0RFU1RbMV1bc3FdID0gYUJsYWNrOw0KICAgICAgICAgICAgRUxFUEhBTlRfREVTVFswXVtzcV0gPSBlUmVkOw0KICAgICAgICAgICAgRUxFUEhBTlRfREVTVFsxXVtzcV0gPSBlQmxhY2s7DQogICAgICAgICAgICBIT1JTRV9ERVNUW3NxXSA9IGhvcnNlOwogICAgICAgICAgICBTT0xESUVSX0RFU1RbMF1bc3FdID0gc1JlZDsKICAgICAgICAgICAgU09MRElFUl9ERVNUWzFdW3NxXSA9IHNCbGFjazsKICAgICAgICB9CiAgICB9Cn0pKCk7Cgpjb25zdCBTRUFSQ0hfR0VORVJBTF9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOwpjb25zdCBTRUFSQ0hfQURWSVNPUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOwpjb25zdCBTRUFSQ0hfRUxFUEhBTlRfREVTVCA9IFtuZXcgQXJyYXkoUkVMX1NRVUFSRVMpLCBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpXTsKY29uc3QgU0VBUkNIX0hPUlNFX0RFU1QgPSBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpOwpjb25zdCBTRUFSQ0hfU09MRElFUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOwpjb25zdCBTRUFSQ0hfUkFZUyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IFJFTF9TUVVBUkVTIH0sICgpID0+IG5ldyBBcnJheShPUlRIX0RJUlMubGVuZ3RoKSk7CmNvbnN0IFNFQVJDSF9IT1JTRV9DSEVDS0VSUyA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7CgooKCkgPT4gewogICAgY29uc3Qgc3F1YXJlRGVzdGluYXRpb25zID0gKGRlc3RzKSA9PiB7CiAgICAgICAgY29uc3QgcGFja2VkID0gbmV3IFVpbnQ4QXJyYXkoZGVzdHMubGVuZ3RoKTsKICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSBwYWNrZWRbaV0gPSBkZXN0c1tpXS5yICogOSArIGRlc3RzW2ldLmM7CiAgICAgICAgcmV0dXJuIHBhY2tlZDsKICAgIH07CiAgICBjb25zdCBibG9ja2VkRGVzdGluYXRpb25zID0gKGRlc3RzKSA9PiB7CiAgICAgICAgY29uc3QgcGFja2VkID0gbmV3IFVpbnQxNkFycmF5KGRlc3RzLmxlbmd0aCk7CiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICBwYWNrZWRbaV0gPSAoZGVzdHNbaV0uYnIgKiA5ICsgZGVzdHNbaV0uYmMpICogMTI4ICsgZGVzdHNbaV0uciAqIDkgKyBkZXN0c1tpXS5jOwogICAgICAgIH0KICAgICAgICByZXR1cm4gcGFja2VkOwogICAgfTsKCiAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsKICAgICAgICBTRUFSQ0hfR0VORVJBTF9ERVNUWzBdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhHRU5FUkFMX0RFU1RbMF1bc3FdKTsKICAgICAgICBTRUFSQ0hfR0VORVJBTF9ERVNUWzFdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhHRU5FUkFMX0RFU1RbMV1bc3FdKTsKICAgICAgICBTRUFSQ0hfQURWSVNPUl9ERVNUWzBdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhBRFZJU09SX0RFU1RbMF1bc3FdKTsKICAgICAgICBTRUFSQ0hfQURWSVNPUl9ERVNUWzFdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhBRFZJU09SX0RFU1RbMV1bc3FdKTsKICAgICAgICBTRUFSQ0hfRUxFUEhBTlRfREVTVFswXVtzcV0gPSBibG9ja2VkRGVzdGluYXRpb25zKEVMRVBIQU5UX0RFU1RbMF1bc3FdKTsKICAgICAgICBTRUFSQ0hfRUxFUEhBTlRfREVTVFsxXVtzcV0gPSBibG9ja2VkRGVzdGluYXRpb25zKEVMRVBIQU5UX0RFU1RbMV1bc3FdKTsKICAgICAgICBTRUFSQ0hfSE9SU0VfREVTVFtzcV0gPSBibG9ja2VkRGVzdGluYXRpb25zKEhPUlNFX0RFU1Rbc3FdKTsKICAgICAgICBTRUFSQ0hfU09MRElFUl9ERVNUWzBdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhTT0xESUVSX0RFU1RbMF1bc3FdKTsKICAgICAgICBTRUFSQ0hfU09MRElFUl9ERVNUWzFdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhTT0xESUVSX0RFU1RbMV1bc3FdKTsKCiAgICAgICAgY29uc3QgciA9IChzcSAvIDkpIHwgMDsKICAgICAgICBjb25zdCBjID0gc3EgJSA5OwogICAgICAgIGZvciAobGV0IGRpciA9IDA7IGRpciA8IE9SVEhfRElSUy5sZW5ndGg7IGRpcisrKSB7CiAgICAgICAgICAgIGNvbnN0IHJheSA9IFtdOwogICAgICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tkaXJdWzBdOwogICAgICAgICAgICBjb25zdCBkYyA9IE9SVEhfRElSU1tkaXJdWzFdOwogICAgICAgICAgICBmb3IgKGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7IG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTOyBuciArPSBkciwgbmMgKz0gZGMpIHsKICAgICAgICAgICAgICAgIHJheS5wdXNoKG5yICogOSArIG5jKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBTRUFSQ0hfUkFZU1tzcV1bZGlyXSA9IG5ldyBVaW50OEFycmF5KHJheSk7CiAgICAgICAgfQoKICAgICAgICBjb25zdCBob3JzZUNoZWNrZXJzID0gW107CiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBIT1JTRV9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgIGNvbnN0IGQgPSBIT1JTRV9ESVJTW2ldOwogICAgICAgICAgICBjb25zdCBob3JzZVIgPSByICsgZC5kcjsKICAgICAgICAgICAgY29uc3QgaG9yc2VDID0gYyArIGQuZGM7CiAgICAgICAgICAgIGlmIChob3JzZVIgPCAwIHx8IGhvcnNlUiA+PSBST1dTIHx8IGhvcnNlQyA8IDAgfHwgaG9yc2VDID49IENPTFMpIGNvbnRpbnVlOwogICAgICAgICAgICBjb25zdCBsZWdSID0gaG9yc2VSIC0gZC5sZWdEcjsKICAgICAgICAgICAgY29uc3QgbGVnQyA9IGhvcnNlQyAtIGQubGVnRGM7CiAgICAgICAgICAgIGhvcnNlQ2hlY2tlcnMucHVzaCgobGVnUiAqIDkgKyBsZWdDKSAqIDEyOCArIGhvcnNlUiAqIDkgKyBob3JzZUMpOwogICAgICAgIH0KICAgICAgICBTRUFSQ0hfSE9SU0VfQ0hFQ0tFUlNbc3FdID0gbmV3IFVpbnQxNkFycmF5KGhvcnNlQ2hlY2tlcnMpOwogICAgfQp9KSgpOwoKY29uc3QgYXBwZW5kU2VhcmNoU2hvcnRNb3ZlcyA9IChtb3ZlcywgZnJvbVNxLCBkZXN0cywgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIGJsb2NrZWQpID0+IHsKICAgIGxldCBnZW5lcmF0ZWQgPSAwOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgewogICAgICAgIGxldCB0b1NxID0gZGVzdHNbaV07CiAgICAgICAgaWYgKGJsb2NrZWQpIHsKICAgICAgICAgICAgaWYgKHNxdWFyZUNvZGVzW3RvU3EgPj4+IDddICE9PSAwKSBjb250aW51ZTsKICAgICAgICAgICAgdG9TcSAmPSAxMjc7CiAgICAgICAgfQogICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1t0b1NxXTsKICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgewogICAgICAgICAgICBnZW5lcmF0ZWQrKzsKICAgICAgICAgICAgaWYgKCFjYXB0dXJlc09ubHkpIG1vdmVzLnB1c2goKGZyb21TcSA8PCA3KSB8IHRvU3EpOwogICAgICAgIH0gZWxzZSBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHsKICAgICAgICAgICAgZ2VuZXJhdGVkKys7CiAgICAgICAgICAgIG1vdmVzLnB1c2goKGZyb21TcSA8PCA3KSB8IHRvU3EpOwogICAgICAgIH0KICAgIH0KICAgIHJldHVybiBnZW5lcmF0ZWQ7Cn07Cgpjb25zdCBhcHBlbmRTZWFyY2hQc2V1ZG9Nb3Zlc0ZvclBpZWNlID0gKG1vdmVzLCBmcm9tU3EsIHBpZWNlQ29kZSwgc3F1YXJlQ29kZXMsIGNhcHR1cmVzT25seSA9IGZhbHNlKSA9PiB7CiAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZUNvZGUgJiA3OwogICAgY29uc3QgaXNSZWQgPSBwaWVjZUNvZGUgPCA4OwogICAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOwogICAgbGV0IGdlbmVyYXRlZCA9IDA7CgogICAgc3dpdGNoIChwaWVjZVR5cGUpIHsKICAgICAgICBjYXNlIDE6CiAgICAgICAgICAgIHJldHVybiBhcHBlbmRTZWFyY2hTaG9ydE1vdmVzKG1vdmVzLCBmcm9tU3EsIFNFQVJDSF9HRU5FUkFMX0RFU1RbY29sb3JJZHhdW2Zyb21TcV0sIHNxdWFyZUNvZGVzLCBpc1JlZCwgY2FwdHVyZXNPbmx5LCBmYWxzZSk7CiAgICAgICAgY2FzZSA1OgogICAgICAgICAgICByZXR1cm4gYXBwZW5kU2VhcmNoU2hvcnRNb3Zlcyhtb3ZlcywgZnJvbVNxLCBTRUFSQ0hfQURWSVNPUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdLCBzcXVhcmVDb2RlcywgaXNSZWQsIGNhcHR1cmVzT25seSwgZmFsc2UpOwogICAgICAgIGNhc2UgNDoKICAgICAgICAgICAgcmV0dXJuIGFwcGVuZFNlYXJjaFNob3J0TW92ZXMobW92ZXMsIGZyb21TcSwgU0VBUkNIX0VMRVBIQU5UX0RFU1RbY29sb3JJZHhdW2Zyb21TcV0sIHNxdWFyZUNvZGVzLCBpc1JlZCwgY2FwdHVyZXNPbmx5LCB0cnVlKTsKICAgICAgICBjYXNlIDM6CiAgICAgICAgICAgIHJldHVybiBhcHBlbmRTZWFyY2hTaG9ydE1vdmVzKG1vdmVzLCBmcm9tU3EsIFNFQVJDSF9IT1JTRV9ERVNUW2Zyb21TcV0sIHNxdWFyZUNvZGVzLCBpc1JlZCwgY2FwdHVyZXNPbmx5LCB0cnVlKTsKICAgICAgICBjYXNlIDc6CiAgICAgICAgICAgIHJldHVybiBhcHBlbmRTZWFyY2hTaG9ydE1vdmVzKG1vdmVzLCBmcm9tU3EsIFNFQVJDSF9TT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV0sIHNxdWFyZUNvZGVzLCBpc1JlZCwgY2FwdHVyZXNPbmx5LCBmYWxzZSk7CiAgICAgICAgY2FzZSAyOgogICAgICAgICAgICBmb3IgKGxldCBkaXIgPSAwOyBkaXIgPCBPUlRIX0RJUlMubGVuZ3RoOyBkaXIrKykgewogICAgICAgICAgICAgICAgY29uc3QgcmF5ID0gU0VBUkNIX1JBWVNbZnJvbVNxXVtkaXJdOwogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCByYXkubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCB0b1NxID0gcmF5W2ldOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1t0b1NxXTsKICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgewogICAgICAgICAgICAgICAgICAgICAgICBnZW5lcmF0ZWQrKzsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjYXB0dXJlc09ubHkpIG1vdmVzLnB1c2goKGZyb21TcSA8PCA3KSB8IHRvU3EpOwogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2VuZXJhdGVkKys7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKChmcm9tU3EgPDwgNykgfCB0b1NxKTsKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgICAgcmV0dXJuIGdlbmVyYXRlZDsKICAgICAgICBjYXNlIDY6CiAgICAgICAgICAgIGZvciAobGV0IGRpciA9IDA7IGRpciA8IE9SVEhfRElSUy5sZW5ndGg7IGRpcisrKSB7CiAgICAgICAgICAgICAgICBjb25zdCByYXkgPSBTRUFSQ0hfUkFZU1tmcm9tU3FdW2Rpcl07CiAgICAgICAgICAgICAgICBsZXQgc2NyZWVuRm91bmQgPSBmYWxzZTsKICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF5Lmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9TcSA9IHJheVtpXTsKICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbdG9TcV07CiAgICAgICAgICAgICAgICAgICAgaWYgKCFzY3JlZW5Gb3VuZCkgewogICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2VuZXJhdGVkKys7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWNhcHR1cmVzT25seSkgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzY3JlZW5Gb3VuZCA9IHRydWU7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldENvZGUgIT09IDApIHsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBnZW5lcmF0ZWQrKzsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goKGZyb21TcSA8PCA3KSB8IHRvU3EpOwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICByZXR1cm4gZ2VuZXJhdGVkOwogICAgICAgIGRlZmF1bHQ6CiAgICAgICAgICAgIHJldHVybiBnZW5lcmF0ZWQ7CiAgICB9Cn07CgovLyDmqKHlnZfnuqfokL3ngrnlpITnkIbvvIjpnZ7mr4/lrZDmlrDlu7rpl63ljIXvvInvvJvov5Tlm57mnLrliqjlop7ph48NCi8vIHBpZWNlQXRTcTogOTAg5qC8IOKGkiBwaWVjZXNJbmZv77ybcmVsQ3R4LnVzZU1hc2tzIOaXtuWGmSBtYXNrDQpjb25zdCBhcHBseVJlbGF0aW9uU3F1YXJlID0gKGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIHRyLCB0YywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcikgPT4gew0KICAgIGlmICh0ciA8IDAgfHwgdHIgPj0gUk9XUyB8fCB0YyA8IDAgfHwgdGMgPj0gQ09MUykgcmV0dXJuIDA7DQogICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbdHJdW3RjXTsNCiAgICBpZiAoIXRhcmdldCkgew0KICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgIGNvbnN0IHNxID0gdHIgKiA5ICsgdGM7DQogICAgICAgICAgICBpZiAoIXJlbEN0eC5za2lwQ29udHJvbE1hc2spIHJlbEN0eC5jb250cm9sTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgaWYgKGlzUmVkKSBzZXRBdHRhY2tCaXQocmVsQ3R4LnJlZEF0dGFjaywgc3EpOw0KICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgICAgICAgICBpbmZvLmNvbnRyb2wucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5LmJhc2VNb3ZlVmFsdWU7DQogICAgfQ0KICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsNCiAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICBpZiAocGllY2VBdFNxW3RyICogOSArIHRjXSkgew0KICAgICAgICAgICAgICAgIHJlbEN0eC5hdHRhY2tNYXNrW3RyICogOSArIHRjXSB8PSBiaXQ7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW3RyICogOSArIHRjXTsNCiAgICAgICAgICAgIGlmICh0YXJnZXRJbmZvKSB7DQogICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLnRocmVhdGVuZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiAwOw0KICAgIH0NCiAgICBpZiAodGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgew0KICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW3RyICogOSArIHRjXTsNCiAgICAgICAgaWYgKHRhcmdldEluZm8gJiYgdGFyZ2V0SW5mbyAhPT0gaW5mbykgew0KICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgcmVsQ3R4Lmd1YXJkTWFza1t0ciAqIDkgKyB0Y10gfD0gYml0Ow0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBpbmZvLmd1YXJkLnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICBpbmZvLmFsbHlHdWFyZHMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICByZXR1cm4gMDsNCn07DQoNCi8vIOmdnueCru+8muS4gOasoeWHoOS9leaJq+aPj++8m+efreatpeWtkOi1sOmihOihqO+8jOi9puS7jeWwhOe6v++8m+ivreS5ieS4jiBnZXRQaWVjZU1vdmVzIOS4gOiHtA0KY29uc3QgZmlsbE5vbkNhbm5vblJlbGF0aW9ucyA9IChib2FyZCwgaW5mbywgcGllY2VBdFNxLCByZWxDdHggPSBudWxsKSA9PiB7DQogICAgY29uc3QgcGllY2UgPSBpbmZvLnBpZWNlOw0KICAgIGNvbnN0IHsgciwgYyB9ID0gaW5mbzsNCiAgICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCiAgICBjb25zdCBwaWVjZUNvbG9yID0gcGllY2UuY29sb3I7DQogICAgY29uc3QgdXNlTWFza3MgPSAhIShyZWxDdHggJiYgcmVsQ3R4LnVzZU1hc2tzKTsNCiAgICBjb25zdCBza2lwQ29udHJvbCA9IHVzZU1hc2tzICYmIHJlbEN0eC5za2lwQ29udHJvbE1hc2s7DQogICAgY29uc3QgYml0ID0gdXNlTWFza3MgPyAoMSA8PCByZWxDdHgucGllY2VJbmRleCkgOiAwOw0KICAgIGNvbnN0IGNvbG9ySWR4ID0gaXNSZWQgPyAwIDogMTsNCiAgICBjb25zdCBmcm9tU3EgPSByICogOSArIGM7DQogICAgaWYgKCF1c2VNYXNrcykgew0KICAgICAgICBpbmZvLm1vdmVzID0gW107DQogICAgICAgIGluZm8uY29udHJvbCA9IFtdOw0KICAgICAgICBpbmZvLmFsbHlHdWFyZHMgPSBbXTsNCiAgICB9DQogICAgbGV0IG1vYmlsaXR5VmFsdWUgPSAwOw0KDQogICAgc3dpdGNoIChwaWVjZS50eXBlKSB7DQogICAgICAgIGNhc2UgJ2dlbmVyYWwnOiB7DQogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEdFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVJlbGF0aW9uU3F1YXJlKA0KICAgICAgICAgICAgICAgICAgICBib2FyZCwgaW5mbywgcGllY2VBdFNxLCBkLnIsIGQuYywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcg0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBjYXNlICdhZHZpc29yJzogew0KICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBBRFZJU09SX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgZC5yLCBkLmMsIHVzZU1hc2tzLCBiaXQsIHJlbEN0eCwgaXNSZWQsIHBpZWNlQ29sb3INCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnZWxlcGhhbnQnOiB7DQogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEVMRVBIQU5UX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgIGlmIChib2FyZFtkLmJyXVtkLmJjXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoDQogICAgICAgICAgICAgICAgICAgICAgICBib2FyZCwgaW5mbywgcGllY2VBdFNxLCBkLnIsIGQuYywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcg0KICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGNhc2UgJ2hvcnNlJzogew0KICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBIT1JTRV9ERVNUW2Zyb21TcV07DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgIGlmIChib2FyZFtkLmJyXVtkLmJjXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoDQogICAgICAgICAgICAgICAgICAgICAgICBib2FyZCwgaW5mbywgcGllY2VBdFNxLCBkLnIsIGQuYywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcg0KICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGNhc2UgJ2NoYXJpb3QnOg0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgICAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldCA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBuciAqIDkgKyBuYzsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXNraXBDb250cm9sKSByZWxDdHguY29udHJvbE1hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChyZWxDdHgucmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLmNvbnRyb2wucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5LmJhc2VNb3ZlVmFsdWU7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0LmNvbG9yICE9PSBwaWVjZUNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZUF0U3FbbnIgKiA5ICsgbmNdKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWxDdHguYXR0YWNrTWFza1tuciAqIDkgKyBuY10gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW25yICogOSArIG5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldEluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8udGhyZWF0LnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLnRocmVhdGVuZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBpZWNlQXRTcVtuciAqIDkgKyBuY107DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldEluZm8gJiYgdGFyZ2V0SW5mbyAhPT0gaW5mbykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5ndWFyZE1hc2tbbnIgKiA5ICsgbmNdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8uZ3VhcmRlZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLmFsbHlHdWFyZHMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIG5yICs9IGRyOw0KICAgICAgICAgICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgY2FzZSAnc29sZGllcic6IHsNCiAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gU09MRElFUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoDQogICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGRlZmF1bHQ6DQogICAgICAgICAgICBicmVhazsNCiAgICB9DQogICAgaW5mby5tb2JpbGl0eVZhbHVlID0gbW9iaWxpdHlWYWx1ZTsNCn07DQoNCi8vIOeCru+8muS4gOasoeWbm+WQkeWwhOe6v++8m21hc2sg5qih5byP5YaZIGF0dGFjay9ndWFyZC9jb250cm9s77yM5YiX6KGo5qih5byP5L+d5oyB5pen6K+t5LmJDQpjb25zdCBmaWxsQ2Fubm9uUmVsYXRpb25zID0gKGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIHJlbEN0eCA9IG51bGwpID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGluZm8ucGllY2U7DQogICAgY29uc3QgeyByLCBjIH0gPSBpbmZvOw0KICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICAgIGNvbnN0IHBpZWNlQ29sb3IgPSBwaWVjZS5jb2xvcjsNCiAgICBjb25zdCB7IGJhc2VNb3ZlVmFsdWUgfSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eTsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKHJlbEN0eCAmJiByZWxDdHgudXNlTWFza3MpOw0KICAgIGNvbnN0IHNraXBDb250cm9sID0gdXNlTWFza3MgJiYgcmVsQ3R4LnNraXBDb250cm9sTWFzazsNCiAgICBjb25zdCBiaXQgPSB1c2VNYXNrcyA/ICgxIDw8IHJlbEN0eC5waWVjZUluZGV4KSA6IDA7DQogICAgaWYgKCF1c2VNYXNrcykgew0KICAgICAgICBpbmZvLm1vdmVzID0gW107DQogICAgICAgIGluZm8uY29udHJvbCA9IFtdOw0KICAgIH0NCiAgICBsZXQgbW9iaWxpdHlWYWx1ZSA9IDA7DQoNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGxldCBzY3JlZW5Gb3VuZENvdW50ID0gMDsNCiAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTICYmIHNjcmVlbkZvdW5kQ291bnQgPCAyKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgIGlmIChwICE9PSBudWxsKSB7DQogICAgICAgICAgICAgICAgc2NyZWVuRm91bmRDb3VudCsrOw0KICAgICAgICAgICAgICAgIGlmIChzY3JlZW5Gb3VuZENvdW50ID09PSAyKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbbnIgKiA5ICsgbmNdOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciAhPT0gcGllY2VDb2xvcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWxDdHguYXR0YWNrTWFza1tuciAqIDkgKyBuY10gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8udGhyZWF0LnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHAudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5ndWFyZE1hc2tbbnIgKiA5ICsgbmNdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLmd1YXJkLnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8uZ3VhcmRlZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHAuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdXNlTWFza3MpIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDApIHsNCiAgICAgICAgICAgICAgICBpZiAoIXVzZU1hc2tzKSBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmIChzY3JlZW5Gb3VuZENvdW50ID09PSAxKSB7DQogICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gbnIgKiA5ICsgbmM7DQogICAgICAgICAgICAgICAgICAgIGlmICghc2tpcENvbnRyb2wpIHJlbEN0eC5jb250cm9sTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChyZWxDdHgucmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgIGVsc2Ugc2V0QXR0YWNrQml0KHJlbEN0eC5ibGFja0F0dGFjaywgc3EpOw0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIG5yICs9IGRyOw0KICAgICAgICAgICAgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICB9DQogICAgaW5mby5tb2JpbGl0eVZhbHVlID0gbW9iaWxpdHlWYWx1ZTsNCn07DQoNCi8vIOS7juagvOS9jSBtYXNrIOi/mOWOnyB0aHJlYXQvZ3VhcmQvY29udHJvbCDliJfooajvvIjngrnmo4svVUnvvIkNCi8vIFNlYXJjaCBsZWF2ZXMgYWx3YXlzIHVzZSBtYXNrcyBhbmQgYXR0YWNrIGJpdHMsIHNvIHRoaXMgYXZvaWRzIFVJL2NvbnRyb2wtbGlzdCBicmFuY2hlcy4KY29uc3QgYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUgPSAoc3F1YXJlQ29kZXMsIHNxLCBiaXQsIGlzUmVkKSA9PiB7CiAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbc3FdOwogICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsKICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChzY3JhdGNoUmVkQXR0YWNrLCBzcSk7CiAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQoc2NyYXRjaEJsYWNrQXR0YWNrLCBzcSk7CiAgICAgICAgcmV0dXJuIEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eS5iYXNlTW92ZVZhbHVlOwogICAgfQogICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSB7CiAgICAgICAgc2NyYXRjaEF0dGFja01hc2tbc3FdIHw9IGJpdDsKICAgIH0gZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgewogICAgICAgIHNjcmF0Y2hHdWFyZE1hc2tbc3FdIHw9IGJpdDsKICAgIH0KICAgIHJldHVybiAwOwp9OwoKY29uc3QgY2FsY3VsYXRlU2VhcmNoTGVhZlJlbGF0aW9ucyA9IChwaWVjZXNJbmZvLCBzcXVhcmVDb2RlcykgPT4gewogICAgc2NyYXRjaEF0dGFja01hc2suZmlsbCgwKTsKICAgIHNjcmF0Y2hHdWFyZE1hc2suZmlsbCgwKTsKICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsKICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOwoKICAgIGNvbnN0IGJhc2VNb3ZlVmFsdWUgPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsKICAgIGZvciAobGV0IHBpID0gMDsgcGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgcGkrKykgewogICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW3BpXTsKICAgICAgICBjb25zdCByID0gaW5mby5yOwogICAgICAgIGNvbnN0IGMgPSBpbmZvLmM7CiAgICAgICAgY29uc3QgZnJvbVNxID0gciAqIDkgKyBjOwogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IGluZm8ucGllY2VDb2RlOwogICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlQ29kZSAmIDc7CiAgICAgICAgY29uc3QgaXNSZWQgPSBwaWVjZUNvZGUgPCA4OwogICAgICAgIGNvbnN0IGNvbG9ySWR4ID0gaXNSZWQgPyAwIDogMTsKICAgICAgICBjb25zdCBiaXQgPSAxIDw8IHBpOwogICAgICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsKCiAgICAgICAgc3dpdGNoIChwaWVjZVR5cGUpIHsKICAgICAgICAgICAgY2FzZSAxOiB7CiAgICAgICAgICAgICAgICBjb25zdCBkZXN0cyA9IEdFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsKICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07CiAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVNlYXJjaExlYWZSZWxhdGlvblNxdWFyZShzcXVhcmVDb2RlcywgZC5yICogOSArIGQuYywgYml0LCBpc1JlZCk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgfQogICAgICAgICAgICBjYXNlIDU6IHsKICAgICAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gQURWSVNPUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOwogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsKICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5U2VhcmNoTGVhZlJlbGF0aW9uU3F1YXJlKHNxdWFyZUNvZGVzLCBkLnIgKiA5ICsgZC5jLCBiaXQsIGlzUmVkKTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGNhc2UgNDogewogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBFTEVQSEFOVF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOwogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsKICAgICAgICAgICAgICAgICAgICBpZiAoc3F1YXJlQ29kZXNbZC5iciAqIDkgKyBkLmJjXSA9PT0gMCkgewogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5U2VhcmNoTGVhZlJlbGF0aW9uU3F1YXJlKHNxdWFyZUNvZGVzLCBkLnIgKiA5ICsgZC5jLCBiaXQsIGlzUmVkKTsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgfQogICAgICAgICAgICBjYXNlIDM6IHsKICAgICAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gSE9SU0VfREVTVFtmcm9tU3FdOwogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsKICAgICAgICAgICAgICAgICAgICBpZiAoc3F1YXJlQ29kZXNbZC5iciAqIDkgKyBkLmJjXSA9PT0gMCkgewogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5U2VhcmNoTGVhZlJlbGF0aW9uU3F1YXJlKHNxdWFyZUNvZGVzLCBkLnIgKiA5ICsgZC5jLCBiaXQsIGlzUmVkKTsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgfQogICAgICAgICAgICBjYXNlIDI6CiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRjID0gT1JUSF9ESVJTW2ldWzFdOwogICAgICAgICAgICAgICAgICAgIGxldCBuciA9IHIgKyBkcjsKICAgICAgICAgICAgICAgICAgICBsZXQgbmMgPSBjICsgZGM7CiAgICAgICAgICAgICAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gbnIgKiA5ICsgbmM7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1tzcV07CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChzY3JhdGNoUmVkQXR0YWNrLCBzcSk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHNldEF0dGFja0JpdChzY3JhdGNoQmxhY2tBdHRhY2ssIHNxKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsKICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgc2NyYXRjaEF0dGFja01hc2tbc3FdIHw9IGJpdDsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCh0YXJnZXRDb2RlICYgNykgIT09IDEpIHNjcmF0Y2hHdWFyZE1hc2tbc3FdIHw9IGJpdDsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgIG5yICs9IGRyOwogICAgICAgICAgICAgICAgICAgICAgICBuYyArPSBkYzsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgY2FzZSA2OgogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXTsKICAgICAgICAgICAgICAgICAgICBjb25zdCBkYyA9IE9SVEhfRElSU1tpXVsxXTsKICAgICAgICAgICAgICAgICAgICBsZXQgbnIgPSByICsgZHI7CiAgICAgICAgICAgICAgICAgICAgbGV0IG5jID0gYyArIGRjOwogICAgICAgICAgICAgICAgICAgIGxldCBzY3JlZW5zID0gMDsKICAgICAgICAgICAgICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMgJiYgc2NyZWVucyA8IDIpIHsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBuciAqIDkgKyBuYzsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3NxXTsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgIT09IDApIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjcmVlbnMrKzsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzY3JlZW5zID09PSAyKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSBzY3JhdGNoQXR0YWNrTWFza1tzcV0gfD0gYml0OwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCh0YXJnZXRDb2RlICYgNykgIT09IDEpIHNjcmF0Y2hHdWFyZE1hc2tbc3FdIHw9IGJpdDsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChzY3JlZW5zID09PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7CiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChzY3JhdGNoUmVkQXR0YWNrLCBzcSk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHNldEF0dGFja0JpdChzY3JhdGNoQmxhY2tBdHRhY2ssIHNxKTsKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICBuciArPSBkcjsKICAgICAgICAgICAgICAgICAgICAgICAgbmMgKz0gZGM7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIGNhc2UgNzogewogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBTT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07CiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOwogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUoc3F1YXJlQ29kZXMsIGQuciAqIDkgKyBkLmMsIGJpdCwgaXNSZWQpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgZGVmYXVsdDoKICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOwogICAgfQp9OwoKY29uc3QgaHlkcmF0ZVJlbGF0aW9uc0Zyb21NYXNrcyA9IChwaWVjZXNJbmZvLCBib2FyZEluZm8pID0+IHsKICAgIGNvbnN0IGF0dGFja01hc2sgPSBib2FyZEluZm8uYXR0YWNrTWFzazsNCiAgICBjb25zdCBndWFyZE1hc2sgPSBib2FyZEluZm8uZ3VhcmRNYXNrOw0KICAgIGNvbnN0IGNvbnRyb2xNYXNrID0gYm9hcmRJbmZvLmNvbnRyb2xNYXNrOw0KICAgIGNvbnN0IG4gPSBwaWVjZXNJbmZvLmxlbmd0aDsNCiAgICBjb25zdCBieVNxID0gbmV3IEFycmF5KFJFTF9TUVVBUkVTKTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykgew0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgaW5mby50aHJlYXQgPSBbXTsNCiAgICAgICAgaW5mby50aHJlYXRlbmVkQnkgPSBbXTsNCiAgICAgICAgaW5mby5ndWFyZCA9IFtdOw0KICAgICAgICBpbmZvLmd1YXJkZWRCeSA9IFtdOw0KICAgICAgICBpbmZvLmNvbnRyb2wgPSBbXTsNCiAgICAgICAgYnlTcVtpbmZvLnIgKiA5ICsgaW5mby5jXSA9IGluZm87DQogICAgfQ0KDQogICAgZm9yIChsZXQgc3EgPSAwOyBzcSA8IFJFTF9TUVVBUkVTOyBzcSsrKSB7DQogICAgICAgIGNvbnN0IHIgPSAoc3EgLyA5KSB8IDA7DQogICAgICAgIGNvbnN0IGMgPSBzcSAlIDk7DQogICAgICAgIGNvbnN0IHRhcmdldCA9IGJ5U3Fbc3FdOw0KDQogICAgICAgIGxldCBjbSA9IGNvbnRyb2xNYXNrW3NxXSA+Pj4gMDsNCiAgICAgICAgd2hpbGUgKGNtICE9PSAwKSB7DQogICAgICAgICAgICBjb25zdCBiaXQgPSBjbSAmIC1jbTsNCiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsNCiAgICAgICAgICAgIHBpZWNlc0luZm9baV0uY29udHJvbC5wdXNoKHsgciwgYyB9KTsNCiAgICAgICAgICAgIGNtIF49IGJpdDsNCiAgICAgICAgfQ0KDQogICAgICAgIGxldCBhbSA9IGF0dGFja01hc2tbc3FdID4+PiAwOw0KICAgICAgICB3aGlsZSAoYW0gIT09IDApIHsNCiAgICAgICAgICAgIGNvbnN0IGJpdCA9IGFtICYgLWFtOw0KICAgICAgICAgICAgY29uc3QgaSA9IDMxIC0gTWF0aC5jbHozMihiaXQpOw0KICAgICAgICAgICAgY29uc3QgYXR0YWNrZXIgPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICAgICAgaWYgKHRhcmdldCAmJiB0YXJnZXQgIT09IGF0dGFja2VyICYmIHRhcmdldC5waWVjZS5jb2xvciAhPT0gYXR0YWNrZXIucGllY2UuY29sb3IpIHsNCiAgICAgICAgICAgICAgICBhdHRhY2tlci50aHJlYXQucHVzaCh0YXJnZXQpOw0KICAgICAgICAgICAgICAgIHRhcmdldC50aHJlYXRlbmVkQnkucHVzaChhdHRhY2tlcik7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBhbSBePSBiaXQ7DQogICAgICAgIH0NCg0KICAgICAgICBsZXQgZ20gPSBndWFyZE1hc2tbc3FdID4+PiAwOw0KICAgICAgICB3aGlsZSAoZ20gIT09IDApIHsNCiAgICAgICAgICAgIGNvbnN0IGJpdCA9IGdtICYgLWdtOw0KICAgICAgICAgICAgY29uc3QgaSA9IDMxIC0gTWF0aC5jbHozMihiaXQpOw0KICAgICAgICAgICAgY29uc3QgZ3VhcmRlciA9IHBpZWNlc0luZm9baV07DQogICAgICAgICAgICBpZiAodGFyZ2V0ICYmIHRhcmdldCAhPT0gZ3VhcmRlciAmJiB0YXJnZXQucGllY2UuY29sb3IgPT09IGd1YXJkZXIucGllY2UuY29sb3IpIHsNCiAgICAgICAgICAgICAgICBndWFyZGVyLmd1YXJkLnB1c2godGFyZ2V0KTsNCiAgICAgICAgICAgICAgICB0YXJnZXQuZ3VhcmRlZEJ5LnB1c2goZ3VhcmRlcik7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBnbSBePSBiaXQ7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDkvpsgaXNQb3NpdGlvbkFjY2VwdGFibGUgLyDngrnmo4sgY29udHJvbGxlcnPvvJrkuI7ml6for63kuYnkuIDoh7TvvIzku4XnqbrmjqfmoLwNCiAgICBjb25zdCBncmlkID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsNCiAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsNCiAgICAgICAgbGV0IGNtID0gY29udHJvbE1hc2tbc3FdID4+PiAwOw0KICAgICAgICBpZiAoY20gPT09IDApIGNvbnRpbnVlOw0KICAgICAgICBjb25zdCByID0gKHNxIC8gOSkgfCAwOw0KICAgICAgICBjb25zdCBjID0gc3EgJSA5Ow0KICAgICAgICB3aGlsZSAoY20gIT09IDApIHsNCiAgICAgICAgICAgIGNvbnN0IGJpdCA9IGNtICYgLWNtOw0KICAgICAgICAgICAgY29uc3QgaSA9IDMxIC0gTWF0aC5jbHozMihiaXQpOw0KICAgICAgICAgICAgZ3JpZFtyXVtjXS5wdXNoKHBpZWNlc0luZm9baV0pOw0KICAgICAgICAgICAgY20gXj0gYml0Ow0KICAgICAgICB9DQogICAgfQ0KICAgIGJvYXJkSW5mby5jb250cm9sbGVyR3JpZCA9IGdyaWQ7DQp9Ow0KDQovLyDorqHnrpfmo4vlrZDlhbPns7vvvJptYXNrIOi3r+W+hOWGmSBVaW50MzIg5qC85L2N6KGo77yb5YiX6KGo6Lev5b6E5L+d5oyB5penIHB1c2gNCmNvbnN0IGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zID0gKGJvYXJkLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pID0+IHsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcyk7DQogICAgY29uc3QgdXNlQXR0YWNrQml0cyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlQXR0YWNrQml0cykgJiYgIXVzZU1hc2tzOw0KDQogICAgaWYgKCF1c2VNYXNrcykgew0KICAgICAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICAgICAgaW5mby50aHJlYXQgPSBbXTsNCiAgICAgICAgICAgIGluZm8udGhyZWF0ZW5lZEJ5ID0gW107DQogICAgICAgICAgICBpbmZvLmd1YXJkID0gW107DQogICAgICAgICAgICBpbmZvLmd1YXJkZWRCeSA9IFtdOw0KICAgICAgICAgICAgaW5mby5jb250cm9sID0gW107DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBpZiAoIWJvYXJkSW5mbykgew0KICAgICAgICBib2FyZEluZm8gPSBtYWtlRW1wdHlDb250cm9sbGVyR3JpZCgpOw0KICAgIH0NCg0KICAgIGNsZWFyUGllY2VBdFNxKCk7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICBpZiAoaW5mby5waWVjZUluZGV4ID09IG51bGwpIGluZm8ucGllY2VJbmRleCA9IGk7DQogICAgICAgIHNjcmF0Y2hQaWVjZUF0U3FbaW5mby5yICogOSArIGluZm8uY10gPSBpbmZvOw0KICAgIH0NCg0KICAgIGxldCByZWxDdHggPSBudWxsOw0KICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICByZWxDdHggPSBzY3JhdGNoUmVsQ3R4Ow0KICAgICAgICByZWxDdHgudXNlTWFza3MgPSB0cnVlOw0KICAgICAgICByZWxDdHguc2tpcENvbnRyb2xNYXNrID0gISFib2FyZEluZm8uc2tpcENvbnRyb2xNYXNrOw0KICAgICAgICByZWxDdHguYXR0YWNrTWFzayA9IGJvYXJkSW5mby5hdHRhY2tNYXNrOw0KICAgICAgICByZWxDdHguZ3VhcmRNYXNrID0gYm9hcmRJbmZvLmd1YXJkTWFzazsNCiAgICAgICAgcmVsQ3R4LmNvbnRyb2xNYXNrID0gYm9hcmRJbmZvLmNvbnRyb2xNYXNrOw0KICAgICAgICByZWxDdHgucmVkQXR0YWNrID0gYm9hcmRJbmZvLnJlZEF0dGFjazsNCiAgICAgICAgcmVsQ3R4LmJsYWNrQXR0YWNrID0gYm9hcmRJbmZvLmJsYWNrQXR0YWNrOw0KICAgIH0NCg0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgaWYgKHJlbEN0eCkgcmVsQ3R4LnBpZWNlSW5kZXggPSBpbmZvLnBpZWNlSW5kZXg7DQoNCiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gJ2Nhbm5vbicpIHsNCiAgICAgICAgICAgIGZpbGxDYW5ub25SZWxhdGlvbnMoYm9hcmQsIGluZm8sIHNjcmF0Y2hQaWVjZUF0U3EsIHJlbEN0eCk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBmaWxsTm9uQ2Fubm9uUmVsYXRpb25zKGJvYXJkLCBpbmZvLCBzY3JhdGNoUGllY2VBdFNxLCByZWxDdHgpOw0KICAgICAgICB9DQoNCiAgICAgICAgaWYgKCF1c2VNYXNrcykgew0KICAgICAgICAgICAgY29uc3QgY29udHJvbCA9IGluZm8uY29udHJvbDsNCiAgICAgICAgICAgIGlmICh1c2VBdHRhY2tCaXRzKSB7DQogICAgICAgICAgICAgICAgY29uc3QgYml0cyA9IGluZm8ucGllY2UuY29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZEF0dGFjayA6IGJvYXJkSW5mby5ibGFja0F0dGFjazsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBrID0gMDsgayA8IGNvbnRyb2wubGVuZ3RoOyBrKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zID0gY29udHJvbFtrXTsNCiAgICAgICAgICAgICAgICAgICAgc2V0QXR0YWNrQml0KGJpdHMsIHBvcy5yICogOSArIHBvcy5jKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoYm9hcmRJbmZvWzBdKSkgew0KICAgICAgICAgICAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgY29udHJvbC5sZW5ndGg7IGsrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3MgPSBjb250cm9sW2tdOw0KICAgICAgICAgICAgICAgICAgICBib2FyZEluZm9bcG9zLnJdW3Bvcy5jXS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGxldCByZWRJc0luQ2hlY2sgPSBmYWxzZTsNCiAgICBsZXQgYmxhY2tJc0luQ2hlY2sgPSBmYWxzZTsNCiAgICBsZXQgcmVkR2VuZXJhbEluZm8gPSBudWxsOw0KICAgIGxldCBibGFja0dlbmVyYWxJbmZvID0gbnVsbDsNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoaW5mby5waWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJykgcmVkR2VuZXJhbEluZm8gPSBpbmZvOw0KICAgICAgICAgICAgZWxzZSBibGFja0dlbmVyYWxJbmZvID0gaW5mbzsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICBpZiAocmVkR2VuZXJhbEluZm8gJiYgYm9hcmRJbmZvLmF0dGFja01hc2tbcmVkR2VuZXJhbEluZm8uciAqIDkgKyByZWRHZW5lcmFsSW5mby5jXSAhPT0gMCkgew0KICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoYmxhY2tHZW5lcmFsSW5mbyAmJiBib2FyZEluZm8uYXR0YWNrTWFza1tibGFja0dlbmVyYWxJbmZvLnIgKiA5ICsgYmxhY2tHZW5lcmFsSW5mby5jXSAhPT0gMCkgew0KICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgaWYgKHJlZEdlbmVyYWxJbmZvKSB7DQogICAgICAgICAgICBmb3IgKGNvbnN0IHRocmVhdGVuZXIgb2YgcmVkR2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7DQogICAgICAgICAgICAgICAgaWYgKHRocmVhdGVuZXIucGllY2UuY29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmIChibGFja0dlbmVyYWxJbmZvKSB7DQogICAgICAgICAgICBmb3IgKGNvbnN0IHRocmVhdGVuZXIgb2YgYmxhY2tHZW5lcmFsSW5mby50aHJlYXRlbmVkQnkpIHsNCiAgICAgICAgICAgICAgICBpZiAodGhyZWF0ZW5lci5waWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBpZiAocmVkR2VuZXJhbEluZm8gJiYgYmxhY2tHZW5lcmFsSW5mbyAmJiByZWRHZW5lcmFsSW5mby5jID09PSBibGFja0dlbmVyYWxJbmZvLmMpIHsNCiAgICAgICAgbGV0IGhhc1BpZWNlQmV0d2VlbiA9IGZhbHNlOw0KICAgICAgICBjb25zdCBzdGFydFIgPSBNYXRoLm1pbihyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpICsgMTsNCiAgICAgICAgY29uc3QgZW5kUiA9IE1hdGgubWF4KHJlZEdlbmVyYWxJbmZvLnIsIGJsYWNrR2VuZXJhbEluZm8ucikgLSAxOw0KICAgICAgICBmb3IgKGxldCByID0gc3RhcnRSOyByIDw9IGVuZFI7IHIrKykgew0KICAgICAgICAgICAgaWYgKGJvYXJkW3JdW3JlZEdlbmVyYWxJbmZvLmNdKSB7DQogICAgICAgICAgICAgICAgaGFzUGllY2VCZXR3ZWVuID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoIWhhc1BpZWNlQmV0d2Vlbikgew0KICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgIGJsYWNrSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGJvYXJkSW5mby5yZWRJc0luQ2hlY2sgPSByZWRJc0luQ2hlY2s7DQogICAgYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrID0gYmxhY2tJc0luQ2hlY2s7DQp9Ow0KDQpjb25zdCBpc1Bvc2l0aW9uQWNjZXB0YWJsZSA9IChib2FyZCwgZnJvbSwgdG8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbyA9IG51bGwsIHBpZWNlc0luZm8gPSBudWxsLCB0cnlNb3ZlUGllY2UgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJykgPT4gew0KICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gdHJ5TW92ZVBpZWNlIHx8IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsNCiAgICBjb25zdCB0YXJnZXRQaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOw0KICAgIGNvbnN0IGlzQ2FwdHVyZSA9IHRhcmdldFBpZWNlICYmIHRhcmdldFBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyOw0KDQogICAgLy8g5pS26ZuG5omA5pyJ5qOL5a2Q5L+h5oGv77yM5Y+q5Zyo5rKh5pyJ5o+Q5L6b5pe26K6h566XDQogICAgbGV0IGxvY2FsUGllY2VzSW5mbyA9IHBpZWNlc0luZm87DQogICAgaWYgKCFsb2NhbFBpZWNlc0luZm8pIHsNCiAgICAgICAgbG9jYWxQaWVjZXNJbmZvID0gW107DQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGFsbHlHdWFyZHMgPSBbXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCB7IHIsIGMgfSwgcGllY2UsIGFsbHlHdWFyZHMpOw0KICAgICAgICAgICAgICAgICAgICBsb2NhbFBpZWNlc0luZm8ucHVzaCh7DQogICAgICAgICAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHIsIGMsIG1vdmVzLCBhbGx5R3VhcmRzLA0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWxWYWx1ZTogZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogW10sDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnk6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eVZhbHVlOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDANCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g6K6h566X5qOL5a2Q5YWz57O75ZKM5o6n5Yi25L+h5oGv77yM5Y+q5Zyo5rKh5pyJ5o+Q5L6b5pe26K6h566XDQogICAgbGV0IGxvY2FsQm9hcmRJbmZvID0gYm9hcmRJbmZvOw0KICAgIGlmICghbG9jYWxCb2FyZEluZm8pIHsNCiAgICAgICAgaWYgKFNFQVJDSF9SRUxBVElPTl9NQVNLUyAmJiBsb2NhbFBpZWNlc0luZm8ubGVuZ3RoIDw9IDMyKSB7DQogICAgICAgICAgICBjbGVhclJlbGF0aW9uTWFza3MoKTsNCiAgICAgICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsNCiAgICAgICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsb2NhbFBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBsb2NhbFBpZWNlc0luZm9baV0ucGllY2VJbmRleCA9IGk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBsb2NhbEJvYXJkSW5mbyA9IHsNCiAgICAgICAgICAgICAgICB1c2VSZWxhdGlvbk1hc2tzOiB0cnVlLA0KICAgICAgICAgICAgICAgIHVzZUF0dGFja0JpdHM6IHRydWUsDQogICAgICAgICAgICAgICAgYXR0YWNrTWFzazogc2NyYXRjaEF0dGFja01hc2ssDQogICAgICAgICAgICAgICAgZ3VhcmRNYXNrOiBzY3JhdGNoR3VhcmRNYXNrLA0KICAgICAgICAgICAgICAgIGNvbnRyb2xNYXNrOiBzY3JhdGNoQ29udHJvbE1hc2ssDQogICAgICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgICAgICAgICAgICAgIGJsYWNrQXR0YWNrOiBzY3JhdGNoQmxhY2tBdHRhY2sNCiAgICAgICAgICAgIH07DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBsb2NhbEJvYXJkSW5mbyA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7DQogICAgICAgIH0NCiAgICAgICAgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMoYm9hcmQsIGxvY2FsUGllY2VzSW5mbywgbG9jYWxCb2FyZEluZm8pOw0KICAgIH0NCg0KICAgIC8vIOaOp+WItuiAhe+8mm1hc2sg55SoIGNvbnRyb2xNYXNr77yb5pen6Lev5b6E55SoIGJvYXJkSW5mb1tyXVtjXe+8m2h5ZHJhdGUg5ZCO5Y+v55SoIGNvbnRyb2xsZXJHcmlkDQogICAgbGV0IGNvbnRyb2xsZXJzOw0KICAgIGlmIChsb2NhbEJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKSB7DQogICAgICAgIGNvbnRyb2xsZXJzID0gW107DQogICAgICAgIGZvckVhY2hTZXRCaXQobG9jYWxCb2FyZEluZm8uY29udHJvbE1hc2tbdG8uciAqIDkgKyB0by5jXSwgKGkpID0+IHsNCiAgICAgICAgICAgIGNvbnRyb2xsZXJzLnB1c2gobG9jYWxQaWVjZXNJbmZvW2ldKTsNCiAgICAgICAgfSk7DQogICAgfSBlbHNlIGlmIChsb2NhbEJvYXJkSW5mby5jb250cm9sbGVyR3JpZCkgew0KICAgICAgICBjb250cm9sbGVycyA9IGxvY2FsQm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkW3RvLnJdW3RvLmNdIHx8IFtdOw0KICAgIH0gZWxzZSB7DQogICAgICAgIGNvbnRyb2xsZXJzID0gbG9jYWxCb2FyZEluZm9bdG8ucl1bdG8uY10gfHwgW107DQogICAgfQ0KICAgIGxldCBoYXNBbGx5Q29udHJvbGxlciA9IGZhbHNlOw0KICAgIGxldCBoYXNFbmVteUNvbnRyb2xsZXIgPSBmYWxzZTsNCg0KICAgIC8vIOaOp+WItuiAheWPr+iDveaYryBwaWVjZXNJbmZvIOW8leeUqCB7cGllY2UscixjfSDmiJbml6fnu5PmnoQge2NvbG9yLHR5cGUscixjfQ0KICAgIGNvbnN0IGNvbnRyb2xsZXJDb2xvciA9IChjb250cm9sbGVyKSA9Pg0KICAgICAgICBjb250cm9sbGVyLnBpZWNlID8gY29udHJvbGxlci5waWVjZS5jb2xvciA6IGNvbnRyb2xsZXIuY29sb3I7DQoNCiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgY29udHJvbGxlcnMpIHsNCiAgICAgICAgLy8g5o6S6Zmk5q2j5Zyo56e75Yqo55qE5qOL5a2Q5pys6Lqr77yI6LWw5ZCO5a6D5LiN5YaN5LuO5Y6f5L2N5o6n5Yi255uu5qCH77yJDQogICAgICAgIGlmIChtb3ZpbmdQaWVjZSAmJiBjb250cm9sbGVyLnIgPT09IGZyb20uciAmJiBjb250cm9sbGVyLmMgPT09IGZyb20uYykgew0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGNvbnRyb2xsZXJDb2xvcihjb250cm9sbGVyKSA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgaGFzQWxseUNvbnRyb2xsZXIgPSB0cnVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaGFzRW5lbXlDb250cm9sbGVyID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGlmIChpc0NhcHR1cmUpIHsNCiAgICAgICAgLy8g55m95ZCD77ya55uu5qCH5pyq6KKr5pWM5pa55L+d5oqkDQogICAgICAgIGlmICghaGFzRW5lbXlDb250cm9sbGVyKSB7DQogICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgfQ0KICAgICAgICAvLyDnroDljZUgU0VF77ya5YWI5b6X55uu5qCH5YiG77yM6Iul5Lya6KKr5Y+N5ZCD5YiZ5YaN5aSx5bex5pa55qOL5a2QDQogICAgICAgIGNvbnN0IHRhcmdldFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZSh0YXJnZXRQaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgY29uc3Qgb3VyVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKG1vdmluZ1BpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICBsZXQgc2VlID0gdGFyZ2V0VmFsdWUgLSBvdXJWYWx1ZTsNCiAgICAgICAgLy8g6Iul5pyJ5bex5pa557un57ut5L+d5oqk77yM57KX55Wl6K6k5Li65Y+v6IO95YaN5ZCD5Zue5pyA5L2O5Lu35YC855qE5pWM5pa55L+d5oqk6ICFDQogICAgICAgIGlmIChoYXNBbGx5Q29udHJvbGxlcikgew0KICAgICAgICAgICAgY29uc3QgZW5lbXlHdWFyZFZhbHVlcyA9IGNvbnRyb2xsZXJzDQogICAgICAgICAgICAgICAgLmZpbHRlcihjID0+IGNvbnRyb2xsZXJDb2xvcihjKSAhPT0gY3VycmVudFBsYXllciAmJiAhKGMuciA9PT0gZnJvbS5yICYmIGMuYyA9PT0gZnJvbS5jKSkNCiAgICAgICAgICAgICAgICAubWFwKGMgPT4gew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbYy5yXVtjLmNdOw0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gcCA/IGdldE1hdGVyaWFsVmFsdWUocCwgZ2FtZVN0YWdlKSA6IDA7DQogICAgICAgICAgICAgICAgfSkNCiAgICAgICAgICAgICAgICAuZmlsdGVyKHYgPT4gdiA+IDApDQogICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IGEgLSBiKTsNCiAgICAgICAgICAgIGlmIChlbmVteUd1YXJkVmFsdWVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICBzZWUgKz0gZW5lbXlHdWFyZFZhbHVlc1swXTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICAvLyDmmI7mmL7kuo/mjaLvvIjlpoLovabmjaLml6DmoLnlhbXkuJTkvJrooqvlj43lkIPvvInliJnov4fmu6TvvJvlubPmjaIv6LWa5o2i55WZ57uZ5pCc57SiDQogICAgICAgIHJldHVybiBzZWUgPj0gMDsNCiAgICB9DQoNCiAgICAvLyDpnZ7lkIPlrZDvvJrnm67moIfku4XooqvmlYzmlrnmjqfliLbliJnop4bkuLrpgIHlkIMNCiAgICBpZiAoY29udHJvbGxlcnMubGVuZ3RoID09PSAwKSB7DQogICAgICAgIHJldHVybiB0cnVlOw0KICAgIH0NCiAgICByZXR1cm4gIWhhc0VuZW15Q29udHJvbGxlciB8fCBoYXNBbGx5Q29udHJvbGxlcjsNCn07DQoNCi8vIFNFRSDmjpLluo/lpI3nlKjnvJPlhrLvvIzpmY3kvY7lj7bor4TkvLAgR0MNCmNvbnN0IHNlZUF0dGFja2VyU2NyYXRjaCA9IFtdOw0KY29uc3Qgc2VlR3VhcmRTY3JhdGNoID0gW107DQpjb25zdCBzZWVBdHRhY2tlck1hdFNjcmF0Y2ggPSBbXTsNCmNvbnN0IHNlZUd1YXJkTWF0U2NyYXRjaCA9IFtdOw0KDQovLyDmnInmoLnlrZDnroDljJYgU0VF77yI5LiO5pen5a6e546w6YCQ6KGM562J5Lu377yJ77yb5q+P5Liq55uu5qCH5Y+q5bqU6LCD55So5LiA5qyhDQpjb25zdCBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlID0gKHRocmVhdGVuZWRQaWVjZSkgPT4gew0KICAgIGNvbnN0IGF0dGFja2VycyA9IHNlZUF0dGFja2VyU2NyYXRjaDsNCiAgICBjb25zdCBndWFyZHMgPSBzZWVHdWFyZFNjcmF0Y2g7DQogICAgYXR0YWNrZXJzLmxlbmd0aCA9IDA7DQogICAgZ3VhcmRzLmxlbmd0aCA9IDA7DQogICAgY29uc3QgcmF3QXR0YWNrZXJzID0gdGhyZWF0ZW5lZFBpZWNlLnRocmVhdGVuZWRCeTsNCiAgICBjb25zdCByYXdHdWFyZHMgPSB0aHJlYXRlbmVkUGllY2UuZ3VhcmRlZEJ5Ow0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF3QXR0YWNrZXJzLmxlbmd0aDsgaSsrKSBhdHRhY2tlcnMucHVzaChyYXdBdHRhY2tlcnNbaV0pOw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF3R3VhcmRzLmxlbmd0aDsgaSsrKSBndWFyZHMucHVzaChyYXdHdWFyZHNbaV0pOw0KICAgIGF0dGFja2Vycy5zb3J0KChhLCBiKSA9PiBhLm1hdGVyaWFsVmFsdWUgLSBiLm1hdGVyaWFsVmFsdWUpOw0KICAgIGd1YXJkcy5zb3J0KChhLCBiKSA9PiBhLm1hdGVyaWFsVmFsdWUgLSBiLm1hdGVyaWFsVmFsdWUpOw0KDQogICAgbGV0IGV4Y2hhbmdlU2NvcmUgPSAwOw0KICAgIGxldCBhdHRhY2tlckluZGV4ID0gMDsNCiAgICBsZXQgZ3VhcmRJbmRleCA9IDA7DQogICAgY29uc3QgdGFyZ2V0VmFsdWUgPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsNCg0KICAgIHdoaWxlIChhdHRhY2tlckluZGV4IDwgYXR0YWNrZXJzLmxlbmd0aCAmJiBndWFyZEluZGV4IDwgZ3VhcmRzLmxlbmd0aCkgew0KICAgICAgICBpZiAoZ3VhcmRJbmRleCA9PT0gMCkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSB0YXJnZXRWYWx1ZTsNCiAgICAgICAgfQ0KICAgICAgICBleGNoYW5nZVNjb3JlIC09IGF0dGFja2Vyc1thdHRhY2tlckluZGV4XS5tYXRlcmlhbFZhbHVlOw0KICAgICAgICBpZiAoYXR0YWNrZXJJbmRleCArIDEgPCBhdHRhY2tlcnMubGVuZ3RoKSB7DQogICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IGd1YXJkc1tndWFyZEluZGV4XS5tYXRlcmlhbFZhbHVlOw0KICAgICAgICB9DQogICAgICAgIGF0dGFja2VySW5kZXgrKzsNCiAgICAgICAgZ3VhcmRJbmRleCsrOw0KICAgIH0NCiAgICByZXR1cm4gZXhjaGFuZ2VTY29yZTsNCn07DQoNCi8vIG1hc2sg6Lev5b6EIFNFRe+8muadkOaWmeaVsOe7hOaOkuW6j++8jOivreS5ieS4juS4iuW8j+S4gOiHtO+8iGJpdHNjYW4g5YaF6IGU77yM5peg5Zue6LCD77yJDQpjb25zdCBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlRnJvbU1hc2tzID0gKHRocmVhdGVuZWRQaWVjZSwgcGllY2VzSW5mbywgYXR0YWNrTWFzaywgZ3VhcmRNYXNrKSA9PiB7DQogICAgY29uc3QgYXRrTWF0cyA9IHNlZUF0dGFja2VyTWF0U2NyYXRjaDsNCiAgICBjb25zdCBncmRNYXRzID0gc2VlR3VhcmRNYXRTY3JhdGNoOw0KICAgIGF0a01hdHMubGVuZ3RoID0gMDsNCiAgICBncmRNYXRzLmxlbmd0aCA9IDA7DQogICAgY29uc3Qgc3EgPSB0aHJlYXRlbmVkUGllY2UuciAqIDkgKyB0aHJlYXRlbmVkUGllY2UuYzsNCiAgICBsZXQgYW0gPSBhdHRhY2tNYXNrW3NxXSA+Pj4gMDsNCiAgICB3aGlsZSAoYW0gIT09IDApIHsNCiAgICAgICAgY29uc3QgYml0ID0gYW0gJiAtYW07DQogICAgICAgIGF0a01hdHMucHVzaChwaWVjZXNJbmZvWzMxIC0gTWF0aC5jbHozMihiaXQpXS5tYXRlcmlhbFZhbHVlKTsNCiAgICAgICAgYW0gXj0gYml0Ow0KICAgIH0NCiAgICBsZXQgZ20gPSBndWFyZE1hc2tbc3FdID4+PiAwOw0KICAgIHdoaWxlIChnbSAhPT0gMCkgew0KICAgICAgICBjb25zdCBiaXQgPSBnbSAmIC1nbTsNCiAgICAgICAgZ3JkTWF0cy5wdXNoKHBpZWNlc0luZm9bMzEgLSBNYXRoLmNsejMyKGJpdCldLm1hdGVyaWFsVmFsdWUpOw0KICAgICAgICBnbSBePSBiaXQ7DQogICAgfQ0KICAgIGF0a01hdHMuc29ydCgoYSwgYikgPT4gYSAtIGIpOw0KICAgIGdyZE1hdHMuc29ydCgoYSwgYikgPT4gYSAtIGIpOw0KDQogICAgbGV0IGV4Y2hhbmdlU2NvcmUgPSAwOw0KICAgIGxldCBhdHRhY2tlckluZGV4ID0gMDsNCiAgICBsZXQgZ3VhcmRJbmRleCA9IDA7DQogICAgY29uc3QgdGFyZ2V0VmFsdWUgPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsNCg0KICAgIHdoaWxlIChhdHRhY2tlckluZGV4IDwgYXRrTWF0cy5sZW5ndGggJiYgZ3VhcmRJbmRleCA8IGdyZE1hdHMubGVuZ3RoKSB7DQogICAgICAgIGlmIChndWFyZEluZGV4ID09PSAwKSB7DQogICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IHRhcmdldFZhbHVlOw0KICAgICAgICB9DQogICAgICAgIGV4Y2hhbmdlU2NvcmUgLT0gYXRrTWF0c1thdHRhY2tlckluZGV4XTsNCiAgICAgICAgaWYgKGF0dGFja2VySW5kZXggKyAxIDwgYXRrTWF0cy5sZW5ndGgpIHsNCiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gZ3JkTWF0c1tndWFyZEluZGV4XTsNCiAgICAgICAgfQ0KICAgICAgICBhdHRhY2tlckluZGV4Kys7DQogICAgICAgIGd1YXJkSW5kZXgrKzsNCiAgICB9DQogICAgcmV0dXJuIGV4Y2hhbmdlU2NvcmU7DQp9Ow0KDQovLyDorqHnrpflqIHog4HlgLzvvIjln7rkuo7lrozmlbTnmoTlqIHog4HlhbPns7vvvIkNCi8vIOaMieiiq+WogeiDgeWtkOiBmuWQiO+8muavj+S4quebruagh+acgOWkmuS4gOasoSBTRUXvvJvliIblgLzliqDnu5kgdGhyZWF0ZW5lZEJ5WzBdDQovLyDvvIjlhbPns7vmnoTlu7rmjIkgcGllY2VzSW5mbyDpobrluo8gcHVzaO+8jOaVheS4juaXp+KAnOaUu+WHu+aWueWkluWxgumBjeWOhummluasoeiuoeWIhuKAneW9kuWxnuS4gOiHtO+8iQ0KY29uc3QgY2FsY3VsYXRlVGhyZWF0VmFsdWVzID0gKHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbyA9IG51bGwsIGZvclNlYXJjaExlYWYgPSBmYWxzZSkgPT4gewogICAgLy8g57uf6K6hDQogICAgaWYgKGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgcGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQogICAgfQ0KDQogICAgLy8g5Yid5aeL5YyW5aiB6IOB57G75Z6L57uf6K6h5L+h5oGvDQogICAgY29uc3QgY29sbGVjdFVpID0gISFib2FyZEluZm8gJiYgIWZvclNlYXJjaExlYWY7CiAgICBpZiAoY29sbGVjdFVpKSB7CiAgICAgICAgYm9hcmRJbmZvLmNoZWNrcyA9IFtdOyAgICAgIC8vIOWwhuWGm+S/oeaBrw0KICAgICAgICBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyA9IFtdOyAgLy8g6KKr5o2J55qE5qOL5a2QDQogICAgICAgIGJvYXJkSW5mby5jYW5DYXB0dXJlID0gW107ICAvLyDlj6/lkIPnmoTmo4vlrZANCiAgICB9DQoNCiAgICBjb25zdCBjaGVja0JvbnVzID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmNoZWNrLmJvbnVzOw0KICAgIGNvbnN0IGNhbkNhcHR1cmVTZWVuID0gY29sbGVjdFVpID8gbmV3IFNldCgpIDogbnVsbDsKICAgIGNvbnN0IHVzZU1hc2tzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKTsNCiAgICBjb25zdCBhdHRhY2tNYXNrID0gdXNlTWFza3MgPyBib2FyZEluZm8uYXR0YWNrTWFzayA6IG51bGw7DQogICAgY29uc3QgZ3VhcmRNYXNrID0gdXNlTWFza3MgPyBib2FyZEluZm8uZ3VhcmRNYXNrIDogbnVsbDsNCg0KICAgIGZvciAobGV0IHRpID0gMDsgdGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgdGkrKykgew0KICAgICAgICBjb25zdCB0aHJlYXRlbmVkUGllY2UgPSBwaWVjZXNJbmZvW3RpXTsNCiAgICAgICAgbGV0IGZpcnN0QXR0YWNrZXI7DQogICAgICAgIGxldCBoYXNHdWFyZDsNCiAgICAgICAgbGV0IGF0dGFja2VyTGlzdCA9IG51bGw7DQoNCiAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICBjb25zdCBzcSA9IHRocmVhdGVuZWRQaWVjZS5yICogOSArIHRocmVhdGVuZWRQaWVjZS5jOw0KICAgICAgICAgICAgY29uc3QgYW0gPSBhdHRhY2tNYXNrW3NxXTsNCiAgICAgICAgICAgIGlmIChhbSA9PT0gMCkgY29udGludWU7DQogICAgICAgICAgICAvLyDmnIDkvY4gYml0ID0gcGllY2VzSW5mbyDpobrluo/kuIvmnIDlhYjmjILkuIrnmoTmlLvlh7vmlrnvvIjkuI7ml6cgdGhyZWF0ZW5lZEJ5WzBdIOS4gOiHtO+8iQ0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlciA9IHBpZWNlc0luZm9bbG93ZXN0U2V0Qml0SW5kZXgoYW0pXTsNCiAgICAgICAgICAgIGhhc0d1YXJkID0gZ3VhcmRNYXNrW3NxXSAhPT0gMDsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGNvbnN0IGF0dGFja2VycyA9IHRocmVhdGVuZWRQaWVjZS50aHJlYXRlbmVkQnk7DQogICAgICAgICAgICBpZiAoIWF0dGFja2VycyB8fCBhdHRhY2tlcnMubGVuZ3RoID09PSAwKSBjb250aW51ZTsNCiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIgPSBhdHRhY2tlcnNbMF07DQogICAgICAgICAgICBoYXNHdWFyZCA9IHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnkgJiYgdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeS5sZW5ndGggPiAwOw0KICAgICAgICAgICAgYXR0YWNrZXJMaXN0ID0gYXR0YWNrZXJzOw0KICAgICAgICB9DQoNCiAgICAgICAgLy8g5bCG5Yab77ya5Y+q57uZ5bCP6aKd5YWI5omL5YiG77yM57ud5LiN5oyJ5bCGL+W4headkOaWmeWAvOWBmiBTRUUNCiAgICAgICAgaWYgKHRocmVhdGVuZWRQaWVjZS5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5HRU5FUkFMKSB7DQogICAgICAgICAgICBpZiAoY29sbGVjdFVpKSB7CiAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgbGV0IG0gPSBhdHRhY2tNYXNrW3RocmVhdGVuZWRQaWVjZS5yICogOSArIHRocmVhdGVuZWRQaWVjZS5jXSA+Pj4gMDsNCiAgICAgICAgICAgICAgICAgICAgd2hpbGUgKG0gIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJpdCA9IG0gJiAtbTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7DQogICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2hlY2tzLnB1c2goew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja2VyOiBwaWVjZXNJbmZvW2FpXSwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHRocmVhdGVuZWRQaWVjZSwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0NoZWNrOiB0cnVlDQogICAgICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIG0gXj0gYml0Ow0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgYWkgPSAwOyBhaSA8IGF0dGFja2VyTGlzdC5sZW5ndGg7IGFpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jaGVja3MucHVzaCh7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrZXI6IGF0dGFja2VyTGlzdFthaV0sDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiB0aHJlYXRlbmVkUGllY2UsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNDaGVjazogdHJ1ZQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IGNoZWNrQm9udXM7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KDQogICAgICAgIC8vIOWPquaKiuWvueaUu+WHu+aWueacieWIqeeahOWogeiDgeiuoeWFpSB0aHJlYXRWYWx1Ze+8iOWNleWQkeiuoeWFpe+8jOS4jeWBmiBzYWZldHkg5a+556ew5omj5YiG77yJDQogICAgICAgIGlmICghaGFzR3VhcmQpIHsNCiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICBpZiAoY29sbGVjdFVpKSB7CiAgICAgICAgICAgICAgICBpZiAoZmlyc3RBdHRhY2tlci5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGxldCBtID0gYXR0YWNrTWFza1t0aHJlYXRlbmVkUGllY2UuciAqIDkgKyB0aHJlYXRlbmVkUGllY2UuY10gPj4+IDA7DQogICAgICAgICAgICAgICAgICAgICAgICB3aGlsZSAobSAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGJpdCA9IG0gJiAtbTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV07DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5DYXB0dXJlU2Vlbi5oYXMoaW5mbykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FuQ2FwdHVyZVNlZW4uYWRkKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2FuQ2FwdHVyZS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtIF49IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGFpID0gMDsgYWkgPCBhdHRhY2tlckxpc3QubGVuZ3RoOyBhaSsrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IGF0dGFja2VyTGlzdFthaV07DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5DYXB0dXJlU2Vlbi5oYXMoaW5mbykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FuQ2FwdHVyZVNlZW4uYWRkKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2FuQ2FwdHVyZS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLnB1c2godGhyZWF0ZW5lZFBpZWNlKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBjb25zdCBzc2VTY29yZSA9IHVzZU1hc2tzDQogICAgICAgICAgICAgICAgPyBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlRnJvbU1hc2tzKHRocmVhdGVuZWRQaWVjZSwgcGllY2VzSW5mbywgYXR0YWNrTWFzaywgZ3VhcmRNYXNrKQ0KICAgICAgICAgICAgICAgIDogY2FsY3VsYXRlU3RhdGljRXhjaGFuZ2VTY29yZSh0aHJlYXRlbmVkUGllY2UpOw0KICAgICAgICAgICAgaWYgKHNzZVNjb3JlID4gMCkgew0KICAgICAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gc3NlU2NvcmUgKiAwLjU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQp9Ow0KDQovLyDorqHnrpflronlhajlgLzvvJrlsIbnqbrmjqfpgrvmoLzmmK/lkKbooqvmlYzmjqfvvIjml6AgdmlzaXQg5Zue6LCD77yJDQpjb25zdCBjYWxjdWxhdGVTYWZldHlWYWx1ZXMgPSAocGllY2VzSW5mbywgYm9hcmRJbmZvLCBib2FyZCA9IG51bGwsIGZvclNlYXJjaExlYWYgPSBmYWxzZSkgPT4gewogICAgaWYgKGZvclNlYXJjaExlYWYgJiYgYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VBdHRhY2tCaXRzICYmIGJvYXJkKSB7CiAgICAgICAgZm9yIChsZXQgZ2kgPSAwOyBnaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBnaSsrKSB7CiAgICAgICAgICAgIGNvbnN0IGdlbmVyYWwgPSBwaWVjZXNJbmZvW2dpXTsKICAgICAgICAgICAgaWYgKGdlbmVyYWwucGllY2UudHlwZSAhPT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgY29udGludWU7CgogICAgICAgICAgICBjb25zdCBnZW5lcmFsQ29sb3IgPSBnZW5lcmFsLnBpZWNlLmNvbG9yOwogICAgICAgICAgICBjb25zdCBlbmVteUJpdHMgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLmJsYWNrQXR0YWNrIDogYm9hcmRJbmZvLnJlZEF0dGFjazsKICAgICAgICAgICAgY29uc3QgaXNSZWQgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnOwogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IGdlbmVyYWw7CiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBPUlRIX0RJUlNbaV1bMF07CiAgICAgICAgICAgICAgICBjb25zdCBuYyA9IGMgKyBPUlRIX0RJUlNbaV1bMV07CiAgICAgICAgICAgICAgICBpZiAobmMgPCAzIHx8IG5jID4gNSkgY29udGludWU7CiAgICAgICAgICAgICAgICBpZiAoaXNSZWQgPyAobnIgPCAwIHx8IG5yID4gMikgOiAobnIgPCA3IHx8IG5yID4gOSkpIGNvbnRpbnVlOwogICAgICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwgJiYgaGFzQXR0YWNrQml0KGVuZW15Qml0cywgbnIgKiA5ICsgbmMpKSB7CiAgICAgICAgICAgICAgICAgICAgZ2VuZXJhbC5zYWZldHlWYWx1ZSAtPSA1MDsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0KICAgICAgICByZXR1cm47CiAgICB9CgogICAgY29uc3QgZ2VuZXJhbEluZm8gPSBbXTsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICBpZiAocGllY2VzSW5mb1tpXS5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5HRU5FUkFMKSB7DQogICAgICAgICAgICBnZW5lcmFsSW5mby5wdXNoKHBpZWNlc0luZm9baV0pOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3QgdXNlQXR0YWNrQml0cyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlQXR0YWNrQml0cyk7DQogICAgY29uc3QgdXNlTWFza3MgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpOw0KDQogICAgZm9yIChsZXQgZ2kgPSAwOyBnaSA8IGdlbmVyYWxJbmZvLmxlbmd0aDsgZ2krKykgew0KICAgICAgICBjb25zdCBnZW5lcmFsID0gZ2VuZXJhbEluZm9bZ2ldOw0KICAgICAgICBjb25zdCBnZW5lcmFsQ29sb3IgPSBnZW5lcmFsLnBpZWNlLmNvbG9yOw0KICAgICAgICBjb25zdCBlbmVteUNvbG9yID0gZ2VuZXJhbENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgY29uc3QgZW5lbXlCaXRzID0gdXNlQXR0YWNrQml0cw0KICAgICAgICAgICAgPyAoZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkQXR0YWNrIDogYm9hcmRJbmZvLmJsYWNrQXR0YWNrKQ0KICAgICAgICAgICAgOiBudWxsOw0KICAgICAgICBjb25zdCBpc1JlZCA9IGdlbmVyYWxDb2xvciA9PT0gJ3JlZCc7DQogICAgICAgIGNvbnN0IHsgciwgYyB9ID0gZ2VuZXJhbDsNCg0KICAgICAgICBjb25zdCBwZW5hbGl6ZUlmRW5lbXkgPSAobnIsIG5jKSA9PiB7DQogICAgICAgICAgICBsZXQgaGFzRW5lbXlDb250cm9sOw0KICAgICAgICAgICAgaWYgKHVzZUF0dGFja0JpdHMpIHsNCiAgICAgICAgICAgICAgICBoYXNFbmVteUNvbnRyb2wgPSBoYXNBdHRhY2tCaXQoZW5lbXlCaXRzLCBuciAqIDkgKyBuYyk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uQ29udHJvbGxlcnMgPSBib2FyZEluZm9bbnJdW25jXTsNCiAgICAgICAgICAgICAgICBoYXNFbmVteUNvbnRyb2wgPSBmYWxzZTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBjaSA9IDA7IGNpIDwgcG9zaXRpb25Db250cm9sbGVycy5sZW5ndGg7IGNpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udHJvbGxlciA9IHBvc2l0aW9uQ29udHJvbGxlcnNbY2ldOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2xvciA9IGNvbnRyb2xsZXIucGllY2UgPyBjb250cm9sbGVyLnBpZWNlLmNvbG9yIDogY29udHJvbGxlci5jb2xvcjsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbG9yID09PSBlbmVteUNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBoYXNFbmVteUNvbnRyb2wgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAoaGFzRW5lbXlDb250cm9sKSBnZW5lcmFsLnNhZmV0eVZhbHVlIC09IDUwOw0KICAgICAgICB9Ow0KDQogICAgICAgIGlmICgodXNlTWFza3MgJiYgYm9hcmQpIHx8ICgoIWdlbmVyYWwuY29udHJvbCB8fCBnZW5lcmFsLmNvbnRyb2wubGVuZ3RoID09PSAwKSAmJiBib2FyZCkpIHsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgT1JUSF9ESVJTW2ldWzBdOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5jID0gYyArIE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgICAgICAgICBpZiAobmMgPCAzIHx8IG5jID4gNSkgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgIGlmIChuciA8IDAgfHwgbnIgPiAyKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG5yIDwgNyB8fCBuciA+IDkpIHsNCiAgICAgICAgICAgICAgICAgICAgY29udGludWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdID09PSBudWxsKSBwZW5hbGl6ZUlmRW5lbXkobnIsIG5jKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmIChnZW5lcmFsLmNvbnRyb2wgJiYgZ2VuZXJhbC5jb250cm9sLmxlbmd0aCkgew0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBnZW5lcmFsLmNvbnRyb2wubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBwZW5hbGl6ZUlmRW5lbXkoZ2VuZXJhbC5jb250cm9sW2ldLnIsIGdlbmVyYWwuY29udHJvbFtpXS5jKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCn07DQoNCi8vIC0tLSBUeXBlcyAoSW5saW5lZCB0byBhdm9pZCBpbXBvcnQgaXNzdWVzIGluIFdvcmtlcikgLS0tDQovLyAvLyB0eXBlIENvbG9yIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAncmVkJyB8ICdibGFjayc7DQovLyAvLyB0eXBlIFBpZWNlVHlwZSAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgJ2dlbmVyYWwnIHwgJ2Fkdmlzb3InIHwgJ2VsZXBoYW50JyB8ICdob3JzZScgfCAnY2hhcmlvdCcgfCAnY2Fubm9uJyB8ICdzb2xkaWVyJzsNCi8vIC8vIGludGVyZmFjZSBQaWVjZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gaW50ZXJmYWNlIFBvc2l0aW9uIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQovLyAvLyBpbnRlcmZhY2UgTW92ZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gdHlwZSBCb2FyZCAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgKFBpZWNlIHwgbnVsbClbXVtdOw0KDQovLyAtLS0gT3BlbmluZyBCb29rIFR5cGVzIC0tLQ0KLy8gT3BlbmluZyBCb29rIEVudHJ5IC0gcmVwcmVzZW50cyBwb3NzaWJsZSBtb3ZlcyBmb3IgYSBwb3NpdGlvbg0KLy8gaW50ZXJmYWNlIEJvb2tFbnRyeSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KDQovLyBJbmRpdmlkdWFsIG1vdmUgaW4gb3BlbmluZyBib29rIHdpdGggbWV0YWRhdGENCi8vIGludGVyZmFjZSBCb29rTW92ZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KDQovLyAtLS0gWm9icmlzdCBIYXNoaW5nIGZvciBPcGVuaW5nIEJvb2sgLS0tDQovLyBFYWNoIHBpZWNlIHR5cGUvY29sb3IvcG9zaXRpb24gZ2V0cyBhIHVuaXF1ZSByYW5kb20gNTMtYml0IGludGVnZXINCi8vIFVzZXMgc2VlZGVkIFJORyBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nDQpjbGFzcyBab2JyaXN0SGFzaGVyIHsKICAgIGhhc2hUYWJsZTsgIC8vIFtyb3ddW2NvbF1bcGllY2VJbmRleF0KICAgIHBpZWNlVG9JbmRleDsKCiAgICBjb25zdHJ1Y3RvcigpIHsKICAgICAgICB0aGlzLnBpZWNlVG9JbmRleCA9IG5ldyBNYXAoWwogICAgICAgICAgICBbJ3JlZC1nZW5lcmFsJywgMF0sIFsncmVkLWFkdmlzb3InLCAxXSwgWydyZWQtZWxlcGhhbnQnLCAyXSwgWydyZWQtaG9yc2UnLCAzXSwKICAgICAgICAgICAgWydyZWQtY2hhcmlvdCcsIDRdLCBbJ3JlZC1jYW5ub24nLCA1XSwgWydyZWQtc29sZGllcicsIDZdLAogICAgICAgICAgICBbJ2JsYWNrLWdlbmVyYWwnLCA3XSwgWydibGFjay1hZHZpc29yJywgOF0sIFsnYmxhY2stZWxlcGhhbnQnLCA5XSwgWydibGFjay1ob3JzZScsIDEwXSwKICAgICAgICAgICAgWydibGFjay1jaGFyaW90JywgMTFdLCBbJ2JsYWNrLWNhbm5vbicsIDEyXSwgWydibGFjay1zb2xkaWVyJywgMTNdCiAgICAgICAgXSk7CiAgICAgICAgLy8gSW5pdGlhbGl6ZSByYW5kb20gaGFzaCB2YWx1ZXMgdXNpbmcgc2VlZGVkIFJORyAoNTMtYml0IGludGVnZXJzIHRvIGF2b2lkIHByZWNpc2lvbiBpc3N1ZXMpCiAgICAgICAgdGhpcy5oYXNoVGFibGUgPSBbXTsKICAgICAgICBjb25zdCBNQVhfU0FGRSA9IDB4MUZGRkZGRkZGRkZGRkY7IC8vIDJeNTMgLSAxDQogICAgICAgIA0KICAgICAgICAvLyBTaW1wbGUgc2VlZGVkIFJORyAoTENHIC0gTGluZWFyIENvbmdydWVudGlhbCBHZW5lcmF0b3IpDQogICAgICAgIGxldCBzZWVkID0gMTIzNDU2Nzg5OyAvLyBGaXhlZCBzZWVkIGZvciBkZXRlcm1pbmlzdGljIGhhc2hpbmcNCiAgICAgICAgY29uc3Qgc2VlZGVkUmFuZG9tID0gKCkgPT4gew0KICAgICAgICAgICAgc2VlZCA9IChzZWVkICogMTEwMzUxNTI0NSArIDEyMzQ1KSAmIDB4N2ZmZmZmZmY7DQogICAgICAgICAgICByZXR1cm4gc2VlZCAvIDB4N2ZmZmZmZmY7DQogICAgICAgIH07DQoNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICB0aGlzLmhhc2hUYWJsZVtyXSA9IFtdOw0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsNCiAgICAgICAgICAgICAgICB0aGlzLmhhc2hUYWJsZVtyXVtjXSA9IFtdOwogICAgICAgICAgICAgICAgZm9yIChsZXQgcCA9IDA7IHAgPCAxNDsgcCsrKSB7CiAgICAgICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgZGV0ZXJtaW5pc3RpYyA1My1iaXQgaW50ZWdlcgogICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKTsKICAgICAgICAgICAgICAgICAgICB0aGlzLmhhc2hUYWJsZVtyXVtjXVtwXSA9IHZhbHVlOwogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgLy8g5Y+26K+E5Lyw57yT5a2Y6ZSu77yaYm9hcmRIYXNoIF4gaW5pdGlhdG9yS2V5IF4gc3RhZ2VLZXkNCiAgICAgICAgdGhpcy5ldmFsSW5pdGlhdG9yS2V5cyA9IHsNCiAgICAgICAgICAgIHJlZDogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwNCiAgICAgICAgICAgIGJsYWNrOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpDQogICAgICAgIH07DQogICAgICAgIHRoaXMuZXZhbFN0YWdlS2V5cyA9IHsNCiAgICAgICAgICAgIGVhcmx5OiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpLA0KICAgICAgICAgICAgbWlkOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpLA0KICAgICAgICAgICAgbGF0ZTogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIHBpZWNlSW5kZXgocGllY2VPcktleSkgewogICAgICAgIGlmIChwaWVjZU9yS2V5ID09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7CiAgICAgICAgaWYgKCFTRUFSQ0hfRkFTVF9aT0JSSVNUKSB7CiAgICAgICAgICAgIHJldHVybiB0eXBlb2YgcGllY2VPcktleSA9PT0gJ3N0cmluZycKICAgICAgICAgICAgICAgID8gdGhpcy5waWVjZVRvSW5kZXguZ2V0KHBpZWNlT3JLZXkpCiAgICAgICAgICAgICAgICA6IHRoaXMucGllY2VUb0luZGV4LmdldChgJHtwaWVjZU9yS2V5LmNvbG9yfS0ke3BpZWNlT3JLZXkudHlwZX1gKTsKICAgICAgICB9CiAgICAgICAgbGV0IGNvbG9yOwogICAgICAgIGxldCB0eXBlOwogICAgICAgIGlmICh0eXBlb2YgcGllY2VPcktleSA9PT0gJ3N0cmluZycpIHsKICAgICAgICAgICAgY29uc3Qgc2VwYXJhdG9yID0gcGllY2VPcktleS5pbmRleE9mKCctJyk7CiAgICAgICAgICAgIGlmIChzZXBhcmF0b3IgPCAwKSByZXR1cm4gdW5kZWZpbmVkOwogICAgICAgICAgICBjb2xvciA9IHBpZWNlT3JLZXkuc2xpY2UoMCwgc2VwYXJhdG9yKTsKICAgICAgICAgICAgdHlwZSA9IHBpZWNlT3JLZXkuc2xpY2Uoc2VwYXJhdG9yICsgMSk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgY29sb3IgPSBwaWVjZU9yS2V5LmNvbG9yOwogICAgICAgICAgICB0eXBlID0gcGllY2VPcktleS50eXBlOwogICAgICAgIH0KICAgICAgICBsZXQgdHlwZUluZGV4OwogICAgICAgIHN3aXRjaCAodHlwZSkgewogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkdFTkVSQUw6IHR5cGVJbmRleCA9IDA7IGJyZWFrOwogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkFEVklTT1I6IHR5cGVJbmRleCA9IDE7IGJyZWFrOwogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkVMRVBIQU5UOiB0eXBlSW5kZXggPSAyOyBicmVhazsKICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5IT1JTRTogdHlwZUluZGV4ID0gMzsgYnJlYWs7CiAgICAgICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuQ0hBUklPVDogdHlwZUluZGV4ID0gNDsgYnJlYWs7CiAgICAgICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuQ0FOTk9OOiB0eXBlSW5kZXggPSA1OyBicmVhazsKICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5TT0xESUVSOiB0eXBlSW5kZXggPSA2OyBicmVhazsKICAgICAgICAgICAgZGVmYXVsdDogcmV0dXJuIHVuZGVmaW5lZDsKICAgICAgICB9CiAgICAgICAgaWYgKGNvbG9yID09PSAncmVkJykgcmV0dXJuIHR5cGVJbmRleDsKICAgICAgICByZXR1cm4gY29sb3IgPT09ICdibGFjaycgPyB0eXBlSW5kZXggKyA3IDogdW5kZWZpbmVkOwogICAgfQoNCiAgICBldmFsQ2FjaGVLZXkoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKSB7DQogICAgICAgIGNvbnN0IHN0YWdlS2V5ID0gdGhpcy5ldmFsU3RhZ2VLZXlzW2dhbWVTdGFnZV0gfHwgdGhpcy5ldmFsU3RhZ2VLZXlzLm1pZDsNCiAgICAgICAgcmV0dXJuIHRoaXMuaGFzaChib2FyZCkgXiB0aGlzLmV2YWxJbml0aWF0b3JLZXlzW3NlYXJjaEluaXRpYXRvcl0gXiBzdGFnZUtleTsNCiAgICB9DQoNCiAgICBldmFsQ2FjaGVLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKSB7DQogICAgICAgIGNvbnN0IHN0YWdlS2V5ID0gdGhpcy5ldmFsU3RhZ2VLZXlzW2dhbWVTdGFnZV0gfHwgdGhpcy5ldmFsU3RhZ2VLZXlzLm1pZDsNCiAgICAgICAgcmV0dXJuIGJvYXJkSGFzaCBeIHRoaXMuZXZhbEluaXRpYXRvcktleXNbc2VhcmNoSW5pdGlhdG9yXSBeIHN0YWdlS2V5Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIOaVsOWAvCBUVCBrZXnvvJrmiorooYzmo4vmlrnnvJbnoIHov5vmnIDkvY7kvY3vvIzpgb/lhY0gYGhhc2ggXiBzaWRlS2V5YCDlnKggSlMgVG9JbnQzMg0KICAgICAqIOS4i+S6p+eUn+i3qOe6oum7keeisOaSnu+8iOmCo+S8muS9vyBUVCDor6/lkb3kuK3lubbmlLnlj5jmkJzntKLmoJEv5qOL5Yqb77yJ44CCDQogICAgICog562J5Lu35LqO5pen5a2X56ym5LiyIGtleSBgJHtoYXNofToke3NpZGV9YCDnmoTljLrliIbog73lipvjgIINCiAgICAgKi8NCiAgICB0dEtleUZyb21IYXNoKGJvYXJkSGFzaCwgc2lkZSkgew0KICAgICAgICBjb25zdCBoID0gYm9hcmRIYXNoIHwgMDsgLy8gXj0g6ZO+57uT5p6c5bey5pivIEludDMyDQogICAgICAgIHJldHVybiBoICogMiArIChzaWRlID09PSAncmVkJyA/IDAgOiAxKTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDb21wdXRlIGhhc2ggZm9yIGEgYm9hcmQgcG9zaXRpb24NCiAgICAgKi8NCiAgICBoYXNoKGJvYXJkKSB7DQogICAgICAgIGxldCBoID0gMDsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlSWR4ID0gdGhpcy5waWVjZUluZGV4KHBpZWNlKTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGggXj0gdGhpcy5oYXNoVGFibGVbcl1bY11bcGllY2VJZHhdOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBoOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIE1pcnJvciBhIGJvYXJkIGhvcml6b250YWxseSAoZm9yIHN5bW1ldHJ5IGRldGVjdGlvbikNCiAgICAgKi8NCiAgICBtaXJyb3JCb2FyZChib2FyZCkgew0KICAgICAgICBjb25zdCBtaXJyb3JlZCA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpKTsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgIG1pcnJvcmVkW3JdWzggLSBjXSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBtaXJyb3JlZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBNaXJyb3IgYSBtb3ZlIGhvcml6b250YWxseQ0KICAgICAqLw0KICAgIG1pcnJvck1vdmUobW92ZSkgew0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogOCAtIG1vdmUuZnJvbS5jIH0sDQogICAgICAgICAgICB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IDggLSBtb3ZlLnRvLmMgfQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEluY3JlbWVudGFsbHkgdXBkYXRlIGhhc2ggYWZ0ZXIgYSBtb3ZlIChYT1Ig6Ieq6YCG77ya5YaN6LCD55So5LiA5qyh5Y+v6L+Y5Y6fKS4NCiAgICAgKiBtb3ZpbmdQaWVjZSAvIGNhcHR1cmVkUGllY2Ug5Y+v5Li65qOL5a2Q5a+56LGh5oiWICdjb2xvci10eXBlJyDlrZfnrKbkuLLjgIINCiAgICAgKiDpobvlnKggbWFrZU1vdmUg5LmL5YmN5Y+W5b6XIG1vdmluZ1BpZWNl77yMY2FwdHVyZWQg55SoIG1ha2VNb3ZlIOi/lOWbnuWAvOOAgg0KICAgICAqLw0KICAgIHVwZGF0ZUhhc2goY3VycmVudEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgIGxldCBuZXdIYXNoID0gY3VycmVudEhhc2g7DQogICAgICAgIGNvbnN0IG1vdmluZ0lkeCA9IHRoaXMucGllY2VJbmRleChtb3ZpbmdQaWVjZSk7DQogICAgICAgIGlmIChtb3ZpbmdJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgbmV3SGFzaCBePSB0aGlzLmhhc2hUYWJsZVttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdW21vdmluZ0lkeF07DQogICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUudG8ucl1bbW92ZS50by5jXVttb3ZpbmdJZHhdOw0KICAgICAgICB9DQogICAgICAgIGlmIChjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZElkeCA9IHRoaXMucGllY2VJbmRleChjYXB0dXJlZFBpZWNlKTsNCiAgICAgICAgICAgIGlmIChjYXB0dXJlZElkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgbmV3SGFzaCBePSB0aGlzLmhhc2hUYWJsZVttb3ZlLnRvLnJdW21vdmUudG8uY11bY2FwdHVyZWRJZHhdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBuZXdIYXNoOw0KICAgIH0NCn0NCg0KLyoqDQogKiBPcGVuaW5nIEJvb2sgTWFuYWdlcg0KICovDQpjbGFzcyBPcGVuaW5nQm9vayB7DQogICAgYm9vazsgIC8vIFpvYnJpc3QgaGFzaCAtPiBtb3Zlcw0KICAgIGhhc2hlcjsNCiAgICBlbmFibGVkOw0KICAgIG1heFBseTsgIC8vIE1heGltdW0gcGx5IHRvIHVzZSBvcGVuaW5nIGJvb2sgKGUuZy4sIDIwKQ0KDQogICAgY29uc3RydWN0b3IobWF4UGx5ID0gMTIpIHsNCiAgICAgICAgdGhpcy5ib29rID0gbmV3IE1hcCgpOw0KICAgICAgICB0aGlzLmhhc2hlciA9IG5ldyBab2JyaXN0SGFzaGVyKCk7DQogICAgICAgIHRoaXMuZW5hYmxlZCA9IHRydWU7DQogICAgICAgIHRoaXMubWF4UGx5ID0gbWF4UGx5Ow0KICAgICAgICB0aGlzLmluaXRpYWxpemVCb29rKCk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogSW5pdGlhbGl6ZSB3aXRoIGNvbW1vbiBDaGluZXNlIENoZXNzIG9wZW5pbmdzDQogICAgICovDQogICAgaW5pdGlhbGl6ZUJvb2soKSB7DQogICAgICAgIC8vIEFkZCBjbGFzc2ljIENoaW5lc2UgQ2hlc3Mgb3BlbmluZ3MgbWFudWFsbHkNCiAgICAgICAgDQogICAgICAgIC8qDQogICAgICAgIC8vIDEuIOS4reeCrui/h+ays+i9puWvueWxj+mjjumprOW5s+eCruWvuei9piAoQ2VudHJhbCBDYW5ub24gdnMgU2NyZWVuIEhvcnNlcykNCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZShbDQogICAgICAgICAgICB7IGZyb206IHsgcjogNywgYzogNyB9LCB0bzogeyByOiA3LCBjOiA0IH0gfSwgIC8vIDEuIOeCruS6jOW5s+S6lA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDcgfSwgdG86IHsgcjogMiwgYzogNiB9IH0sICAvLyAxLi4uIOmprDjov5s3DQogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogNyB9LCB0bzogeyByOiA3LCBjOiA2IH0gfSwgIC8vIDIuIOmprOS6jOi/m+S4iQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDggfSwgdG86IHsgcjogMCwgYzogNyB9IH0sICAvLyAyLi4uIOi9pjnlubM4ICAgICAgICAgICANCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA4IH0sIHRvOiB7IHI6IDksIGM6IDcgfSB9LCAgLy8gMy4g6L2m5LiA5bmz5LqMDQogICAgICAgICAgICB7IGZyb206IHsgcjogMywgYzogNiB9LCB0bzogeyByOiA0LCBjOiA2IH0gfSwgIC8vIDMuLi4g5Y2SN+i/mzENCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA3IH0sIHRvOiB7IHI6IDMsIGM6IDcgfSB9LCAgLy8gNC4g6L2m5LqM6L+b5YWtDQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogMSB9LCB0bzogeyByOiAyLCBjOiAyIH0gfSwgIC8vIDQuLi4g6amsMui/mzMNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA2LCBjOiAyIH0sIHRvOiB7IHI6IDUsIGM6IDIgfSB9LCAgLy8gNS4g5YW15LiD6L+b5LiADQogICAgICAgICAgICB7IGZyb206IHsgcjogMiwgYzogNyB9LCB0bzogeyByOiAyLCBjOiA4IH0gfSwgIC8vIDUuLi4g54KuOOW5szkNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAzLCBjOiA3IH0sIHRvOiB7IHI6IDMsIGM6IDYgfSB9LCAgLy8gNi4g6L2m5LqM5bmz5LiJDQogICAgICAgICAgICB7IGZyb206IHsgcjogMiwgYzogOCB9LCB0bzogeyByOiAxLCBjOiA4IH0gfSwgIC8vIDYuLi4g54KuOemAgDEgICAgICAgICAgDQogICAgICAgIF0sIFs4NSwgODUsIDk1LCA5MCwgOTAsIDg1LCA4NSwgODAsIDg1LCA4NSwgODUsIDg1XSk7DQoNCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihbDQogICAgICAgICAgICAn54Ku5LqM5bmz5LqUJywgJ+mprDjov5s3JywgJ+mprOS6jOi/m+S4iScsICfovaY55bmzOCcsICfovabkuIDlubPkuownLCAn5Y2SN+i/mzEnLA0KICAgICAgICAgICAgJ+i9puS6jOi/m+WFrScsICfpqawy6L+bMycsICflhbXkuIPov5vkuIAnLCAn54KuOOW5szknLCAn6L2m5LqM5bmz5LiJJywgJ+eCrjnpgIAxJywNCiAgICAgICAgICAgIF0sIFs4NSwgODUsIDk1LCA5MCwgOTAsIDg1LCA4NSwgODAsIDg1LCA4NSwgODUsIDg1XSk7DQoNCiAgICAgICAgICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyhbDQogICAgICAgICAgICAn54Ku5LqM5bmz5LqUIOmprDjov5s3IOmprOS6jOi/m+S4iSDovaY55bmzOCDovabkuIDlubPkuowg5Y2SN+i/mzEg6L2m5LqM6L+b5YWtIOmprDLov5szIOWFteS4g+i/m+S4gCDngq445bmzOSDovabkuozlubPkuIkg54KuOemAgDEnDQogICAgICAgIF0sIFs4NSwgODUsIDk1LCA5MCwgOTAsIDg1LCA4NSwgODAsIDg1LCA4NSwgODUsIDg1XSk7DQogICAgICAgICovDQogICAgfQ0KDQogICAgLyoqDQogICAgICogQWRkIGFuIG9wZW5pbmcgbGluZSB0byB0aGUgYm9vaw0KICAgICAqIEBwYXJhbSBtb3ZlcyBBcnJheSBvZiBtb3ZlcyByZXByZXNlbnRpbmcgYW4gb3BlbmluZyBsaW5lDQogICAgICogQHBhcmFtIHdlaWdodHMgT3B0aW9uYWwgd2VpZ2h0cyBmb3IgZWFjaCBtb3ZlIChkZWZhdWx0IDEwMCBmb3IgYWxsKQ0KICAgICAqLw0KICAgIGFkZE9wZW5pbmdMaW5lKG1vdmVzLCB3ZWlnaHRzKSB7DQogICAgICAgIC8vIFN0YXJ0IHdpdGggaW5pdGlhbCBib2FyZCBwb3NpdGlvbg0KICAgICAgICBjb25zdCBib2FyZCA9IHRoaXMuY3JlYXRlSW5pdGlhbEJvYXJkKCk7DQogICAgICAgIGxldCBjdXJyZW50SGFzaCA9IHRoaXMuaGFzaGVyLmhhc2goYm9hcmQpOw0KDQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW92ZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpXTsNCiAgICAgICAgICAgIGNvbnN0IHdlaWdodCA9IHdlaWdodHM/LltpXSA/PyAxMDA7DQoNCiAgICAgICAgICAgIC8vIEdldCBvciBjcmVhdGUgYm9vayBlbnRyeSBmb3IgdGhpcyBwb3NpdGlvbg0KICAgICAgICAgICAgbGV0IGVudHJ5ID0gdGhpcy5ib29rLmdldChjdXJyZW50SGFzaCk7DQogICAgICAgICAgICBpZiAoIWVudHJ5KSB7DQogICAgICAgICAgICAgICAgZW50cnkgPSB7IG1vdmVzOiBbXSB9Ow0KICAgICAgICAgICAgICAgIHRoaXMuYm9vay5zZXQoY3VycmVudEhhc2gsIGVudHJ5KTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gQWRkIG1vdmUgaWYgbm90IGFscmVhZHkgcHJlc2VudA0KICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdNb3ZlID0gZW50cnkubW92ZXMuZmluZCgNCiAgICAgICAgICAgICAgICBtID0+IG0uZnJvbS5yID09PSBtb3ZlLmZyb20uciAmJiBtLmZyb20uYyA9PT0gbW92ZS5mcm9tLmMgJiYNCiAgICAgICAgICAgICAgICAgICAgIG0udG8uciA9PT0gbW92ZS50by5yICYmIG0udG8uYyA9PT0gbW92ZS50by5jDQogICAgICAgICAgICApOw0KDQogICAgICAgICAgICBpZiAoIWV4aXN0aW5nTW92ZSkgew0KICAgICAgICAgICAgICAgIGVudHJ5Lm1vdmVzLnB1c2goew0KICAgICAgICAgICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiBtb3ZlLmZyb20uYyB9LA0KICAgICAgICAgICAgICAgICAgICB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IG1vdmUudG8uYyB9LA0KICAgICAgICAgICAgICAgICAgICB3ZWlnaHQ6IHdlaWdodA0KICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgd2VpZ2h0IGlmIG1vdmUgYWxyZWFkeSBleGlzdHMgKHRha2UgbWF4aW11bSkNCiAgICAgICAgICAgICAgICBleGlzdGluZ01vdmUud2VpZ2h0ID0gTWF0aC5tYXgoZXhpc3RpbmdNb3ZlLndlaWdodCwgd2VpZ2h0KTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gTWFrZSB0aGUgbW92ZSBvbiB0aGUgYm9hcmQNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkID0gYm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoIXBpZWNlKSBicmVhazsgLy8gSW52YWxpZCBsaW5lDQoNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlS2V5ID0gYCR7cGllY2UuY29sb3J9LSR7cGllY2UudHlwZX1gOw0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBjYXB0dXJlZCA/IGAke2NhcHR1cmVkLmNvbG9yfS0ke2NhcHR1cmVkLnR5cGV9YCA6IHVuZGVmaW5lZDsNCg0KICAgICAgICAgICAgLy8gVXBkYXRlIGhhc2ggaW5jcmVtZW50YWxseQ0KICAgICAgICAgICAgY3VycmVudEhhc2ggPSB0aGlzLmhhc2hlci51cGRhdGVIYXNoKGN1cnJlbnRIYXNoLCBtb3ZlLCBwaWVjZUtleSwgY2FwdHVyZWRLZXkpOw0KDQogICAgICAgICAgICAvLyBBcHBseSBtb3ZlDQogICAgICAgICAgICBib2FyZFttb3ZlLnRvLnJdW21vdmUudG8uY10gPSBwaWVjZTsNCiAgICAgICAgICAgIGJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY10gPSBudWxsOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLyoqDQogICAgICogR2V0IGJlc3QgbW92ZSBmcm9tIG9wZW5pbmcgYm9vayBmb3IgY3VycmVudCBwb3NpdGlvbg0KICAgICAqIEBwYXJhbSBib2FyZCBDdXJyZW50IGJvYXJkIHN0YXRlDQogICAgICogQHBhcmFtIHBseSBDdXJyZW50IHBseSBudW1iZXIgKDAgPSBzdGFydCBvZiBnYW1lKQ0KICAgICAqIEByZXR1cm5zIE1vdmUgZnJvbSBib29rLCBvciBudWxsIGlmIHBvc2l0aW9uIG5vdCBpbiBib29rDQogICAgICovDQogICAgZ2V0Qm9va01vdmUoYm9hcmQsIHBseSl7DQogICAgICAgIC8vIERvbid0IHVzZSBib29rIGlmIGRpc2FibGVkIG9yIHBhc3QgbWF4IHBseQ0KICAgICAgICBpZiAoIXRoaXMuZW5hYmxlZCB8fCBwbHkgPj0gdGhpcy5tYXhQbHkpIHsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgZGlzYWJsZWQgb3IgcGFzdCBtYXggcGx5JywgeyBlbmFibGVkOiB0aGlzLmVuYWJsZWQsIG1heFBseTogdGhpcy5tYXhQbHksIHBseTogcGx5IH0pOw0KICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBnZXRCb29rTW92ZSBjYWxsZWQnLCB7IHBseSB9KTsNCiAgICAgICAgDQogICAgICAgIC8vIFRyeSB0byBmaW5kIG1vdmUgZm9yIGN1cnJlbnQgcG9zaXRpb24NCiAgICAgICAgY29uc3QgaGFzaCA9IHRoaXMuaGFzaGVyLmhhc2goYm9hcmQpOw0KICAgICAgICAvL2NvbnNvbGUubG9nKCdDdXJyZW50IHBvc2l0aW9uIGhhc2g6JywgaGFzaCk7DQogICAgICAgIA0KICAgICAgICBsZXQgZW50cnkgPSB0aGlzLmJvb2suZ2V0KGhhc2gpOw0KICAgICAgICAvL2NvbnNvbGUubG9nKCdFbnRyeSBmb3VuZCBmb3IgY3VycmVudCBoYXNoOicsIGVudHJ5ID8gZW50cnkubW92ZXMubGVuZ3RoICsgJyBtb3ZlcycgOiAnbnVsbCcpOw0KICAgICAgICBpZiAoZW50cnkgJiYgZW50cnkubW92ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgY29uc29sZS5sb2coJ0FsbCBwb3NzaWJsZSBib29rIG1vdmVzIHdpdGggd2VpZ2h0czonLCBKU09OLnN0cmluZ2lmeShlbnRyeS5tb3ZlcykpOw0KICAgICAgICAgICAgLy8gQ2FsY3VsYXRlIHRvdGFsIHdlaWdodA0KICAgICAgICAgICAgY29uc3QgdG90YWxXZWlnaHQgPSBlbnRyeS5tb3Zlcy5yZWR1Y2UoKHN1bSwgbW92ZSkgPT4gc3VtICsgbW92ZS53ZWlnaHQsIDApOw0KICAgICAgICAgICAgY29uc29sZS5sb2coJ1RvdGFsIHdlaWdodDonLCB0b3RhbFdlaWdodCk7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIGxldCBtaXJyb3JlZE1vdmUgPSBmYWxzZTsNCg0KICAgICAgICAvLyBJZiBub3QgZm91bmQsIHRyeSBtaXJyb3JlZCBwb3NpdGlvbg0KICAgICAgICBpZiAoIWVudHJ5IHx8IGVudHJ5Lm1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgY29uc3QgbWlycm9yZWRCb2FyZCA9IHRoaXMuaGFzaGVyLm1pcnJvckJvYXJkKGJvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IG1pcnJvcmVkSGFzaCA9IHRoaXMuaGFzaGVyLmhhc2gobWlycm9yZWRCb2FyZCk7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gZW50cnkgZm91bmQsIHRyeWluZyBtaXJyb3JlZCBwb3NpdGlvbjonLCBtaXJyb3JlZEhhc2gpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBlbnRyeSA9IHRoaXMuYm9vay5nZXQobWlycm9yZWRIYXNoKTsNCiAgICAgICAgICAgIGlmIChlbnRyeSAmJiBlbnRyeS5tb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnRW50cnkgZm91bmQgZm9yIG1pcnJvcmVkIGhhc2g6JywgZW50cnkubW92ZXMubGVuZ3RoICsgJyBtb3ZlcycpOw0KICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ09yaWdpbmFsIG1pcnJvciBtb3ZlczonLCBKU09OLnN0cmluZ2lmeShlbnRyeS5tb3ZlcykpOw0KICAgICAgICAgICAgICAgIG1pcnJvcmVkTW92ZSA9IHRydWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ05vIGVudHJ5IGZvdW5kIGZvciBtaXJyb3JlZCBoYXNoJyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICBpZiAoIWVudHJ5IHx8IGVudHJ5Lm1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnT3BlbmluZyBib29rIG1vdmUgbm90IGZvdW5kIGZvciBjdXJyZW50IHBvc2l0aW9uJyk7DQogICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgfQ0KDQogICAgICAgIC8vIFNlbGVjdCBtb3ZlIGJhc2VkIG9uIHdlaWdodHMNCiAgICAgICAgY29uc3Qgc2VsZWN0ZWRNb3ZlID0gdGhpcy5zZWxlY3RXZWlnaHRlZE1vdmUoZW50cnkubW92ZXMpOw0KICAgICAgICBjb25zb2xlLmxvZygnT3BlbmluZyBib29rIG1vdmUgc2VsZWN0ZWQ6Jywgc2VsZWN0ZWRNb3ZlKTsNCiAgICAgICAgDQogICAgICAgIC8vIElmIHdlIHVzZWQgbWlycm9yZWQgcG9zaXRpb24sIG1pcnJvciB0aGUgbW92ZSBiYWNrDQogICAgICAgIGlmIChzZWxlY3RlZE1vdmUgJiYgbWlycm9yZWRNb3ZlKSB7DQogICAgICAgICAgICAvLyBjb25zb2xlLmxvZygnU2VsZWN0ZWQgbWlycm9yIG1vdmUgYmVmb3JlIGNvbnZlcnNpb246JywgSlNPTi5zdHJpbmdpZnkoc2VsZWN0ZWRNb3ZlKSk7DQogICAgICAgICAgICBjb25zdCBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQgPSB0aGlzLmhhc2hlci5taXJyb3JNb3ZlKHNlbGVjdGVkTW92ZSk7DQogICAgICAgICAgICAvLyBjb25zb2xlLmxvZygnQ29udmVydGVkIG1pcnJvciBtb3ZlOicsIEpTT04uc3RyaW5naWZ5KG1pcnJvcmVkTW92ZUNvbnZlcnRlZCkpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgbWlycm9yZWQgbW92ZSBoYXMgdmFsaWQgc3RydWN0dXJlDQogICAgICAgICAgICBpZiAobWlycm9yZWRNb3ZlQ29udmVydGVkICYmIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tICYmIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50byAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20uYyA9PT0gJ251bWJlcicgJiYNCiAgICAgICAgICAgICAgICB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQudG8uYyA9PT0gJ251bWJlcicpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gbWlycm9yZWRNb3ZlQ29udmVydGVkOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTWlycm9yZWQgbW92ZSBoYXMgaW52YWxpZCBzdHJ1Y3R1cmUsIHJldHVybmluZyBudWxsJyk7DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoc2VsZWN0ZWRNb3ZlKSB7DQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgc2VsZWN0ZWQgbW92ZSBoYXMgdmFsaWQgc3RydWN0dXJlDQogICAgICAgICAgICBpZiAoc2VsZWN0ZWRNb3ZlLmZyb20gJiYgc2VsZWN0ZWRNb3ZlLnRvICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIHNlbGVjdGVkTW92ZS5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBzZWxlY3RlZE1vdmUuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBzZWxlY3RlZE1vdmUudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIHNlbGVjdGVkTW92ZS50by5jID09PSAnbnVtYmVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiBzZWxlY3RlZE1vdmU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZWxlY3RlZCBtb3ZlIGhhcyBpbnZhbGlkIHN0cnVjdHVyZSwgcmV0dXJuaW5nIG51bGwnKTsNCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgcmV0dXJuIG51bGw7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogU2VsZWN0IGEgbW92ZSByYW5kb21seSBiYXNlZCBvbiB3ZWlnaHRzDQogICAgICogSGlnaGVyIHdlaWdodCA9IG1vcmUgbGlrZWx5IHRvIGJlIHNlbGVjdGVkDQogICAgICovDQogICAgc2VsZWN0V2VpZ2h0ZWRNb3ZlKG1vdmVzKSB7DQogICAgICAgIC8vIENhbGN1bGF0ZSB0b3RhbCB3ZWlnaHQNCiAgICAgICAgY29uc3QgdG90YWxXZWlnaHQgPSBtb3Zlcy5yZWR1Y2UoKHN1bSwgbW92ZSkgPT4gc3VtICsgbW92ZS53ZWlnaHQsIDApOw0KDQogICAgICAgIC8vIEdlbmVyYXRlIHJhbmRvbSBudW1iZXINCiAgICAgICAgbGV0IHJhbmRvbSA9IE1hdGgucmFuZG9tKCkgKiB0b3RhbFdlaWdodDsNCg0KICAgICAgICAvLyBTZWxlY3QgbW92ZQ0KICAgICAgICBmb3IgKGNvbnN0IG1vdmUgb2YgbW92ZXMpIHsNCiAgICAgICAgICAgIHJhbmRvbSAtPSBtb3ZlLndlaWdodDsNCiAgICAgICAgICAgIGlmIChyYW5kb20gPD0gMCkgew0KICAgICAgICAgICAgICAgIHJldHVybiB7DQogICAgICAgICAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmUudG8uciwgYzogbW92ZS50by5jIH0NCiAgICAgICAgICAgICAgICB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgLy8gRmFsbGJhY2sgKHNob3VsZCBuZXZlciByZWFjaCBoZXJlKQ0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgZnJvbTogeyByOiBtb3Zlc1swXS5mcm9tLnIsIGM6IG1vdmVzWzBdLmZyb20uYyB9LCB0bzogeyByOiBtb3Zlc1swXS50by5yLCBjOiBtb3Zlc1swXS50by5jIH0NCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBIZWxwZXIgdG8gY3JlYXRlIGluaXRpYWwgYm9hcmQgKG5lZWRlZCBmb3IgYm9vayBpbml0aWFsaXphdGlvbikNCiAgICAgKi8NCiAgICBjcmVhdGVJbml0aWFsQm9hcmQoKSB7DQogICAgICAgIGNvbnN0IGJvYXJkID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkpOw0KICAgICAgICANCiAgICAgICAgLy8gUmVkIHBpZWNlcyAoYm90dG9tIC0gcj0wLTIpDQogICAgICAgIGJvYXJkWzBdWzBdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVsxXSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzJdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bM10gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzRdID0geyB0eXBlOiAnZ2VuZXJhbCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs1XSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bNl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs3XSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzhdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFsyXVsxXSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFsyXVs3XSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVswXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bMl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzRdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVs2XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bOF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQoNCiAgICAgICAgLy8gQmxhY2sgcGllY2VzICh0b3AgLSByPTctOSkNCiAgICAgICAgYm9hcmRbOV1bMF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bMV0gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzJdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVszXSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs0XSA9IHsgdHlwZTogJ2dlbmVyYWwnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs1XSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs2XSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bN10gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzhdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzddWzFdID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbN11bN10gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVswXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVsyXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVs0XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVs2XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs2XVs4XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ2JsYWNrJyB9Ow0KDQogICAgICAgIHJldHVybiBib2FyZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBFbmFibGUgb3IgZGlzYWJsZSBvcGVuaW5nIGJvb2sNCiAgICAgKi8NCiAgICBzZXRFbmFibGVkKGVuYWJsZWQpIHsNCiAgICAgICAgdGhpcy5lbmFibGVkID0gZW5hYmxlZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDaGVjayBpZiBvcGVuaW5nIGJvb2sgaXMgZW5hYmxlZA0KICAgICAqLw0KICAgIGlzRW5hYmxlZCgpIHsNCiAgICAgICAgcmV0dXJuIHRoaXMuZW5hYmxlZDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBHZXQgc3RhdGlzdGljcyBhYm91dCB0aGUgb3BlbmluZyBib29rDQogICAgICovDQogICAgZ2V0U3RhdHMoKSB7DQogICAgICAgIGxldCB0b3RhbE1vdmVzID0gMDsNCiAgICAgICAgdGhpcy5ib29rLmZvckVhY2goZW50cnkgPT4gew0KICAgICAgICAgICAgdG90YWxNb3ZlcyArPSBlbnRyeS5tb3Zlcy5sZW5ndGg7DQogICAgICAgIH0pOw0KDQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICBwb3NpdGlvbnM6IHRoaXMuYm9vay5zaXplLA0KICAgICAgICAgICAgdG90YWxNb3Zlcw0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEFkZCBvcGVuaW5nIGxpbmUgZnJvbSB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uDQogICAgICogQHBhcmFtIG5vdGF0aW9uIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbiAoZS5nLiwgWyfngq7kuozlubPkupQnLCAn6amsOOi/mzcnXSkNCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCBhcnJheSBvZiB3ZWlnaHRzIGZvciBlYWNoIG1vdmUNCiAgICAgKi8NCiAgICBhZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihub3RhdGlvbiwgd2VpZ2h0cykgew0KICAgICAgICAvLyBDb252ZXJ0IHRyYWRpdGlvbmFsIG5vdGF0aW9uIHRvIGNvb3JkaW5hdGUgZm9ybWF0DQogICAgICAgIGNvbnN0IG1vdmVzID0gdGhpcy5ub3RhdGlvblRvTW92ZXMobm90YXRpb24pOw0KICAgICAgICAvLyBBZGQgdGhlIG1vdmVzIHRvIHRoZSBvcGVuaW5nIGJvb2sNCiAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZShtb3Zlcywgd2VpZ2h0cyk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQWRkIG9wZW5pbmcgbGluZSBmcm9tIHN0cmluZyB3aXRoIHNwYWNlLXNlcGFyYXRlZCB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uDQogICAgICogQHBhcmFtIG5vdGF0aW9uQXJyYXkgQXJyYXkgb2Ygc3RyaW5ncywgZWFjaCBjb250YWluaW5nIHNwYWNlLXNlcGFyYXRlZCBtb3ZlcyAoZS5nLiwgWyfngq7kuozlubPkupQg6amsOOi/mzcg6L2m5LiA5bmz5LqMJ10pDQogICAgICogQHBhcmFtIHdlaWdodHMgT3B0aW9uYWwgYXJyYXkgb2Ygd2VpZ2h0cyBmb3IgZWFjaCBtb3ZlDQogICAgICovDQogICAgYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKG5vdGF0aW9uQXJyYXksIHdlaWdodHMpIHsNCiAgICAgICAgLy8gUHJvY2VzcyBlYWNoIHN0cmluZyBpbiB0aGUgYXJyYXkNCiAgICAgICAgaWYgKCFub3RhdGlvbkFycmF5IHx8ICFBcnJheS5pc0FycmF5KG5vdGF0aW9uQXJyYXkpIHx8IG5vdGF0aW9uQXJyYXkubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICByZXR1cm47DQogICAgICAgIH0NCiAgICAgICAgbm90YXRpb25BcnJheS5mb3JFYWNoKG5vdGF0aW9uU3RyaW5nID0+IHsNCiAgICAgICAgICAgIC8vIFNwbGl0IHRoZSBzdHJpbmcgYnkgc3BhY2VzIHRvIGdldCBpbmRpdmlkdWFsIG1vdmVzDQogICAgICAgICAgICBjb25zdCBub3RhdGlvbiA9IG5vdGF0aW9uU3RyaW5nLnNwbGl0KCcgJykuZmlsdGVyKG1vdmUgPT4gbW92ZS50cmltKCkgIT09ICcnKTsNCiAgICAgICAgICAgIC8vIENhbGwgZXhpc3RpbmcgZnVuY3Rpb24gdG8gYWRkIHRoZSBsaW5lDQogICAgICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKG5vdGF0aW9uLCB3ZWlnaHRzKTsNCiAgICAgICAgfSk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQ29udmVydCBjb29yZGluYXRlLWJhc2VkIG1vdmVzIHRvIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24NCiAgICAgKiBAcGFyYW0gYm9hcmRIaXN0b3J5IEFycmF5IG9mIGJvYXJkIHN0YXRlcyByZXByZXNlbnRpbmcgdGhlIGdhbWUgaGlzdG9yeQ0KICAgICAqIEBwYXJhbSBtb3ZlSGlzdG9yeSBBcnJheSBvZiBtb3ZlcyBpbiBjb29yZGluYXRlIGZvcm1hdA0KICAgICAqIEByZXR1cm5zIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbg0KICAgICAqLw0KICAgIG1vdmVzVG9Ob3RhdGlvbihib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5KSB7DQogICAgICAgIGNvbnN0IG5vdGF0aW9uID0gW107DQogICAgICAgIGxldCBjdXJyZW50Q29sb3IgPSAncmVkJzsgLy8gUmVkIG1vdmVzIGZpcnN0DQoNCiAgICAgICAgLy8gVHlwZSB0byBwaWVjZSBjaGFyYWN0ZXIgbWFwcGluZw0KICAgICAgICBjb25zdCB0eXBlVG9QaWVjZSA9IHsNCiAgICAgICAgICAgICdnZW5lcmFsJzogeyAncmVkJzogJ+W4hScsICdibGFjayc6ICflsIYnIH0sDQogICAgICAgICAgICAnYWR2aXNvcic6IHsgJ3JlZCc6ICfku5UnLCAnYmxhY2snOiAn5aOrJyB9LA0KICAgICAgICAgICAgJ2VsZXBoYW50JzogeyAncmVkJzogJ+ebuCcsICdibGFjayc6ICfosaEnIH0sDQogICAgICAgICAgICAnaG9yc2UnOiB7ICdyZWQnOiAn6amsJywgJ2JsYWNrJzogJ+mprCcgfSwNCiAgICAgICAgICAgICdjaGFyaW90JzogeyAncmVkJzogJ+i9picsICdibGFjayc6ICfovaYnIH0sDQogICAgICAgICAgICAnY2Fubm9uJzogeyAncmVkJzogJ+eCricsICdibGFjayc6ICfngq4nIH0sDQogICAgICAgICAgICAnc29sZGllcic6IHsgJ3JlZCc6ICflhbUnLCAnYmxhY2snOiAn5Y2SJyB9DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ29sdW1uIG1hcHBpbmcgKGNvb3JkaW5hdGUgMC04IHRvIHRyYWRpdGlvbmFsIOS5nS3kuIAgZm9yIHJlZCwgOS0xIGZvciBibGFjaykNCiAgICAgICAgY29uc3QgY29sVG9DaGluZXNlID0gWyfkuZ0nLCAn5YWrJywgJ+S4gycsICflha0nLCAn5LqUJywgJ+WbmycsICfkuIknLCAn5LqMJywgJ+S4gCddOw0KICAgICAgICBjb25zdCBjb2xUb0FyYWJpYyA9IFsnOScsICc4JywgJzcnLCAnNicsICc1JywgJzQnLCAnMycsICcyJywgJzEnXTsNCg0KICAgICAgICAvLyBEaWdpdCB0byBDaGluZXNlIG51bWJlciBtYXBwaW5nIGZvciBzdGVwcw0KICAgICAgICBjb25zdCBkaWdpdFRvQ2hpbmVzZSA9IFsnJywgJ+S4gCcsICfkuownLCAn5LiJJywgJ+WbmycsICfkupQnLCAn5YWtJywgJ+S4gycsICflhasnLCAn5LmdJ107DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIHRoZXJlIGFyZSBtdWx0aXBsZSBzYW1lLXR5cGUgcGllY2VzIGluIHRoZSBzYW1lIGNvbHVtbg0KICAgICAgICBjb25zdCBoYXNTYW1lVHlwZUluQ29sdW1uID0gKGJvYXJkLCBwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGV4Y2x1ZGVSb3cpID0+IHsNCiAgICAgICAgICAgIGxldCBjb3VudCA9IDA7DQogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NvbF07DQogICAgICAgICAgICAgICAgaWYgKHIgPT09IGV4Y2x1ZGVSb3cpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSBwaWVjZVR5cGUgJiYgcGllY2UuY29sb3IgPT09IGNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgIGNvdW50Kys7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgcmV0dXJuIGNvdW50ID4gMDsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZGV0ZXJtaW5lIGZyb250L2JhY2sgbWFya2VyDQogICAgICAgIGNvbnN0IGdldEZyb250QmFja01hcmtlciA9IChib2FyZCwgcGllY2VUeXBlLCBjb2xvciwgY29sLCBjdXJyZW50Um93KSA9PiB7DQogICAgICAgICAgICBjb25zdCBzYW1lVHlwZVBpZWNlcyA9IFtdOw0KICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjb2xdOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSBwaWVjZVR5cGUgJiYgcGllY2UuY29sb3IgPT09IGNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgIHNhbWVUeXBlUGllY2VzLnB1c2gocik7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHNhbWVUeXBlUGllY2VzLmxlbmd0aCA8PSAxKSByZXR1cm4gJyc7DQogICAgICAgICAgICBpZiAoY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yIcj03LTnvvInvvIxy5YC86LaK5aSn6LaK6Z2g6L+R5pWM5pa577yM5pivIuWJjSINCiAgICAgICAgICAgICAgICBjb25zdCBzb3J0ZWRSb3dzID0gWy4uLnNhbWVUeXBlUGllY2VzXS5zb3J0KChhLCBiKSA9PiBiIC0gYSk7IC8vIEhpZ2hlciByb3dzIGZpcnN0ID0gY2xvc2VyIHRvIG9wcG9uZW50DQogICAgICAgICAgICAgICAgcmV0dXJuIHNvcnRlZFJvd3NbMF0gPT09IGN1cnJlbnRSb3cgPyAn5YmNJyA6ICflkI4nOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIhyPTAtMu+8ie+8jHLlgLzotorlsI/otorpnaDov5HmlYzmlrnvvIzmmK8i5YmNIg0KICAgICAgICAgICAgICAgIGNvbnN0IHNvcnRlZFJvd3MgPSBbLi4uc2FtZVR5cGVQaWVjZXNdLnNvcnQoKGEsIGIpID0+IGEgLSBiKTsgLy8gTG93ZXIgcm93cyBmaXJzdCA9IGNsb3NlciB0byBvcHBvbmVudA0KICAgICAgICAgICAgICAgIHJldHVybiBzb3J0ZWRSb3dzWzBdID09PSBjdXJyZW50Um93ID8gJ+WJjScgOiAn5ZCOJzsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBQcm9jZXNzIGVhY2ggbW92ZQ0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1vdmVIaXN0b3J5Lmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBtb3ZlID0gbW92ZUhpc3RvcnlbaV07DQogICAgICAgICAgICBjb25zdCBib2FyZEJlZm9yZSA9IGJvYXJkSGlzdG9yeVtpXTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRCZWZvcmVbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFwaWVjZSkgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIHBpZWNlIGZvdW5kIGF0IGZyb20gcG9zaXRpb246JywgbW92ZS5mcm9tKTsNCiAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2UudHlwZTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlQ2hhciA9IHR5cGVUb1BpZWNlW3BpZWNlVHlwZV1bcGllY2UuY29sb3JdOw0KICAgICAgICAgICAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlIGFyZSBtdWx0aXBsZSBzYW1lLXR5cGUgcGllY2VzIGluIHRoZSBzYW1lIGNvbHVtbg0KICAgICAgICAgICAgY29uc3QgaGFzRHVwbGljYXRlID0gaGFzU2FtZVR5cGVJbkNvbHVtbihib2FyZEJlZm9yZSwgcGllY2VUeXBlLCBwaWVjZS5jb2xvciwgbW92ZS5mcm9tLmMsIG1vdmUuZnJvbS5yKTsNCiAgICAgICAgICAgIC8vIEdldCBmcm9udC9iYWNrIG1hcmtlciBpZiBuZWVkZWQNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uTWFya2VyID0gaGFzRHVwbGljYXRlID8gZ2V0RnJvbnRCYWNrTWFya2VyKGJvYXJkQmVmb3JlLCBwaWVjZVR5cGUsIHBpZWNlLmNvbG9yLCBtb3ZlLmZyb20uYywgbW92ZS5mcm9tLnIpIDogJyc7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIERldGVybWluZSBub3RhdGlvbiBiYXNlZCBvbiBwaWVjZSB0eXBlIGFuZCBtb3ZlIGRpcmVjdGlvbg0KICAgICAgICAgICAgbGV0IG5vdGF0aW9uU3RyOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnaG9yc2UnIHx8IHBpZWNlVHlwZSA9PT0gJ2Fkdmlzb3InIHx8IHBpZWNlVHlwZSA9PT0gJ2VsZXBoYW50Jykgew0KICAgICAgICAgICAgICAgIC8vIERpYWdvbmFsIG1vdmluZyBwaWVjZXMgLSBvbmx5IHVzZSDov5sv6YCALCByZWNvcmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+i/m++8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gbW92ZS50by5yID4gbW92ZS5mcm9tLnIgPyAn6L+bJyA6ICfpgIAnOw0KICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCEDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIhyPTDvvInvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6L+b77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSBtb3ZlLnRvLnIgPCBtb3ZlLmZyb20uciA/ICfov5snIDogJ+mAgCc7DQogICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnIHx8IHBpZWNlVHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHBpZWNlVHlwZSA9PT0gJ2Nhbm5vbicgfHwgcGllY2VUeXBlID09PSAnc29sZGllcicpIHsNCiAgICAgICAgICAgICAgICAvLyBTdHJhaWdodCBtb3ZpbmcgcGllY2VzIC0g6L+bL+mAgC/lubMNCiAgICAgICAgICAgICAgICBpZiAobW92ZS5mcm9tLmMgPT09IG1vdmUudG8uYykgew0KICAgICAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBtb3ZlIC0g6L+bL+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGVwcyA9IE1hdGguYWJzKG1vdmUudG8uciAtIG1vdmUuZnJvbS5yKTsNCiAgICAgICAgICAgICAgICAgICAgLy8g6L+b5piv6Z2g6L+R5pWM5pa555qE5pa55ZCR77yM6YCA5piv6L+c56a75pWM5pa555qE5pa55ZCRDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/ov5vvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/ov5vvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IChpc1JlZCA/IG1vdmUudG8uciA+IG1vdmUuZnJvbS5yIDogbW92ZS50by5yIDwgbW92ZS5mcm9tLnIpID8gJ+i/mycgOiAn6YCAJzsNCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY107DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgc3RlcHMgaXMgYSB2YWxpZCBudW1iZXIgYmV0d2VlbiAxLTkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkU3RlcHMgPSBNYXRoLm1heCgxLCBNYXRoLm1pbig5LCBNYXRoLnJvdW5kKHN0ZXBzIHx8IDEpKSk7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke2RpZ2l0VG9DaGluZXNlW3ZhbGlkU3RlcHNdIHx8ICcnfWA7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnku47lj7PlvoDlt6bmmK8xLTnvvIzpnIDopoHlj43ovazliJfmmKDlsIQNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHN0ZXBzIGlzIGEgdmFsaWQgbnVtYmVyDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWxpZFN0ZXBzID0gTWF0aC5yb3VuZChzdGVwcyB8fCAxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dmFsaWRTdGVwc31gOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBtb3ZlIC0g5bmzDQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x95bmzJHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCEDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH3lubMke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1Vua25vd24gcGllY2UgdHlwZTonLCBwaWVjZVR5cGUpOw0KICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICBub3RhdGlvbi5wdXNoKG5vdGF0aW9uU3RyKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gU3dpdGNoIGNvbG9yIGZvciBuZXh0IG1vdmUNCiAgICAgICAgICAgIGN1cnJlbnRDb2xvciA9IGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIHJldHVybiBub3RhdGlvbjsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDb252ZXJ0IHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24gdG8gY29vcmRpbmF0ZSBtb3Zlcw0KICAgICAqIEBwYXJhbSBub3RhdGlvbiBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24NCiAgICAgKiBAcmV0dXJucyBBcnJheSBvZiBtb3ZlcyBpbiBjb29yZGluYXRlIGZvcm1hdA0KICAgICAqLw0KICAgIG5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvbiwgaW5pdGlhbEJvYXJkID0gbnVsbCkgew0KICAgICAgICAvLyDnoa7kv51ub3RhdGlvbuaYr+aVsOe7hOS4lOS4jeS4uuepug0KICAgICAgICBpZiAoIW5vdGF0aW9uIHx8ICFBcnJheS5pc0FycmF5KG5vdGF0aW9uKSB8fCBub3RhdGlvbi5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIHJldHVybiBbXTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICBsZXQgY3VycmVudENvbG9yID0gJ3JlZCc7IC8vIFJlZCBtb3ZlcyBmaXJzdA0KDQogICAgICAgIC8vIFBpZWNlIGNoYXJhY3RlciB0byB0eXBlIG1hcHBpbmcNCiAgICAgICAgY29uc3QgcGllY2VNYXAgPSB7DQogICAgICAgICAgICAn5bCGJzogJ2dlbmVyYWwnLCAn5biFJzogJ2dlbmVyYWwnLA0KICAgICAgICAgICAgJ+Wjqyc6ICdhZHZpc29yJywgJ+S7lSc6ICdhZHZpc29yJywNCiAgICAgICAgICAgICfosaEnOiAnZWxlcGhhbnQnLCAn55u4JzogJ2VsZXBoYW50JywNCiAgICAgICAgICAgICfpqawnOiAnaG9yc2UnLA0KICAgICAgICAgICAgJ+i9pic6ICdjaGFyaW90JywNCiAgICAgICAgICAgICfngq4nOiAnY2Fubm9uJywNCiAgICAgICAgICAgICfljZInOiAnc29sZGllcicsICflhbUnOiAnc29sZGllcicNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDb2x1bW4gbWFwcGluZyAodHJhZGl0aW9uYWwgbm90YXRpb24gdXNlcyAxLTkgZnJvbSByaWdodCB0byBsZWZ0KQ0KICAgICAgICBjb25zdCBjb2xNYXAgPSB7DQogICAgICAgICAgICAn5LiAJzogOCwgJzEnOiA4LA0KICAgICAgICAgICAgJ+S6jCc6IDcsICcyJzogNywNCiAgICAgICAgICAgICfkuIknOiA2LCAnMyc6IDYsDQogICAgICAgICAgICAn5ZubJzogNSwgJzQnOiA1LA0KICAgICAgICAgICAgJ+S6lCc6IDQsICc1JzogNCwNCiAgICAgICAgICAgICflha0nOiAzLCAnNic6IDMsDQogICAgICAgICAgICAn5LiDJzogMiwgJzcnOiAyLA0KICAgICAgICAgICAgJ+WFqyc6IDEsICc4JzogMSwNCiAgICAgICAgICAgICfkuZ0nOiAwLCAnOSc6IDANCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDaGluZXNlIG51bWJlciB0byBkaWdpdCBtYXBwaW5nDQogICAgICAgIGNvbnN0IGNoaW5lc2VOdW1iZXJNYXAgPSB7DQogICAgICAgICAgICAn5LiAJzogMSwgJzEnOiAxLA0KICAgICAgICAgICAgJ+S6jCc6IDIsICcyJzogMiwNCiAgICAgICAgICAgICfkuIknOiAzLCAnMyc6IDMsDQogICAgICAgICAgICAn5ZubJzogNCwgJzQnOiA0LA0KICAgICAgICAgICAgJ+S6lCc6IDUsICc1JzogNSwNCiAgICAgICAgICAgICflha0nOiA2LCAnNic6IDYsDQogICAgICAgICAgICAn5LiDJzogNywgJzcnOiA3LA0KICAgICAgICAgICAgJ+WFqyc6IDgsICc4JzogOCwNCiAgICAgICAgICAgICfkuZ0nOiA5LCAnOSc6IDkNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBJbml0aWFsIHBvc2l0aW9ucyBvZiBwaWVjZXMgKHJlZCBhbmQgYmxhY2spDQogICAgICAgIC8vIOS/ruWkje+8muS4juaWsOWdkOagh+ezu+e7n+S/neaMgeS4gOiHtO+8jOe6ouaWueWcqOW6lemDqO+8iHI9MC0y77yJ77yM6buR5pa55Zyo6aG26YOo77yIcj03LTnvvIkNCiAgICAgICAgY29uc3QgZGVmYXVsdEluaXRpYWxQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAncmVkLWdlbmVyYWwnOiB7IHI6IDAsIGM6IDQgfSwNCiAgICAgICAgICAgICdyZWQtYWR2aXNvcic6IFt7IHI6IDAsIGM6IDMgfSwgeyByOiAwLCBjOiA1IH1dLA0KICAgICAgICAgICAgJ3JlZC1lbGVwaGFudCc6IFt7IHI6IDAsIGM6IDIgfSwgeyByOiAwLCBjOiA2IH1dLA0KICAgICAgICAgICAgJ3JlZC1ob3JzZSc6IFt7IHI6IDAsIGM6IDEgfSwgeyByOiAwLCBjOiA3IH1dLA0KICAgICAgICAgICAgJ3JlZC1jaGFyaW90JzogW3sgcjogMCwgYzogMCB9LCB7IHI6IDAsIGM6IDggfV0sDQogICAgICAgICAgICAncmVkLWNhbm5vbic6IFt7IHI6IDIsIGM6IDEgfSwgeyByOiAyLCBjOiA3IH1dLA0KICAgICAgICAgICAgJ3JlZC1zb2xkaWVyJzogW3sgcjogMywgYzogMCB9LCB7IHI6IDMsIGM6IDIgfSwgeyByOiAzLCBjOiA0IH0sIHsgcjogMywgYzogNiB9LCB7IHI6IDMsIGM6IDggfV0sDQogICAgICAgICAgICAnYmxhY2stZ2VuZXJhbCc6IHsgcjogOSwgYzogNCB9LA0KICAgICAgICAgICAgJ2JsYWNrLWFkdmlzb3InOiBbeyByOiA5LCBjOiAzIH0sIHsgcjogOSwgYzogNSB9XSwNCiAgICAgICAgICAgICdibGFjay1lbGVwaGFudCc6IFt7IHI6IDksIGM6IDIgfSwgeyByOiA5LCBjOiA2IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWhvcnNlJzogW3sgcjogOSwgYzogMSB9LCB7IHI6IDksIGM6IDcgfV0sDQogICAgICAgICAgICAnYmxhY2stY2hhcmlvdCc6IFt7IHI6IDksIGM6IDAgfSwgeyByOiA5LCBjOiA4IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWNhbm5vbic6IFt7IHI6IDcsIGM6IDEgfSwgeyByOiA3LCBjOiA3IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLXNvbGRpZXInOiBbeyByOiA2LCBjOiAwIH0sIHsgcjogNiwgYzogMiB9LCB7IHI6IDYsIGM6IDQgfSwgeyByOiA2LCBjOiA2IH0sIHsgcjogNiwgYzogOCB9XQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIFRyYWNrIHBpZWNlIHBvc2l0aW9ucyBhcyBtb3ZlcyBhcmUgbWFkZQ0KICAgICAgICBsZXQgcGllY2VQb3NpdGlvbnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGRlZmF1bHRJbml0aWFsUG9zaXRpb25zKSk7DQogICAgICAgIA0KICAgICAgICAvLyBJZiBpbml0aWFsIGJvYXJkIGlzIHByb3ZpZGVkLCBpbml0aWFsaXplIHBpZWNlIHBvc2l0aW9ucyBmcm9tIGl0DQogICAgICAgIGlmIChpbml0aWFsQm9hcmQpIHsNCiAgICAgICAgICAgIC8vIFJlc2V0IHBpZWNlIHBvc2l0aW9ucyBiYXNlZCBvbiBpbml0aWFsIGJvYXJkDQogICAgICAgICAgICBwaWVjZVBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICAncmVkLWdlbmVyYWwnOiB7IHI6IC0xLCBjOiAtMSB9LA0KICAgICAgICAgICAgICAgICdyZWQtYWR2aXNvcic6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtZWxlcGhhbnQnOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWhvcnNlJzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1jaGFyaW90JzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1jYW5ub24nOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLXNvbGRpZXInOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stZ2VuZXJhbCc6IHsgcjogLTEsIGM6IC0xIH0sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWFkdmlzb3InOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stZWxlcGhhbnQnOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2staG9yc2UnOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stY2hhcmlvdCc6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1jYW5ub24nOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stc29sZGllcic6IFtdDQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBQb3B1bGF0ZSBwaWVjZSBwb3NpdGlvbnMgZnJvbSBpbml0aWFsIGJvYXJkDQogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDk7IGMrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGluaXRpYWxCb2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtwaWVjZS5jb2xvcn0tJHtwaWVjZS50eXBlfWA7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAocGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgcGllY2VQb3NpdGlvbnNba2V5XSA9IHsgciwgYyB9Ow0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1trZXldLnB1c2goeyByLCBjIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGZpbmQgcGllY2UgcG9zaXRpb24NCiAgICAgICAgY29uc3QgZmluZFBpZWNlUG9zaXRpb24gPSAocGllY2VUeXBlLCBjb2xvciwgY29sLCBkaXJlY3Rpb24sIGZyb250QmFja01hcmtlciA9IG51bGwpID0+IHsNCiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbG9yfS0ke3BpZWNlVHlwZX1gOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNba2V5XTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcG9zaXRpb25zIGV4aXN0IGFuZCBhcmUgdmFsaWQNCiAgICAgICAgICAgIGlmICghcG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gcG9zaXRpb25zIGZvdW5kIGZvciBwaWVjZTonLCBrZXkpOw0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gcG9zaXRpb25zOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBGaW5kIHBpZWNlcyBvbiB0aGUgc3BlY2lmaWVkIGNvbHVtbg0KICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IHBvc2l0aW9ucy5maWx0ZXIocG9zID0+IHBvcy5jID09PSBjb2wpOw0KDQogICAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBjYW5kaWRhdGVzIGZvdW5kIGZvciBwaWVjZTonLCBrZXksICdvbiBjb2x1bW46JywgY29sKTsNCiAgICAgICAgICAgICAgICAvLyBBZGRpdGlvbmFsIGRlYnVnIGluZm8gZm9yIGNhbm5vbg0KICAgICAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdjYW5ub24nICYmIGNvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdERUJVRzogQ2FuZGlkYXRlcyBhZnRlciBmaWx0ZXI6JywgY2FuZGlkYXRlcyk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gY2FuZGlkYXRlc1swXTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gSWYgZnJvbnQvYmFjayBtYXJrZXIgaXMgcHJvdmlkZWQsIHVzZSBpdCB0byBkZXRlcm1pbmUgdGhlIHBpZWNlDQogICAgICAgICAgICBpZiAoZnJvbnRCYWNrTWFya2VyID09PSAn5YmNJykgew0KICAgICAgICAgICAgICAgIC8vIOWJjeeCru+8mumdoOi/keaVjOaWueeahOaji+WtkA0KICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8mnLlgLzovoPlpKfnmoTmm7TpnaDov5HmlYzmlrnvvIjliY3vvIkNCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJpy5YC86L6D5bCP55qE5pu06Z2g6L+R5pWM5pa577yI5YmN77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoZnJvbnRCYWNrTWFya2VyID09PSAn5ZCOJykgew0KICAgICAgICAgICAgICAgIC8vIOWQjueCru+8mumdoOi/keW3seaWueeahOaji+WtkA0KICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8mnLlgLzovoPlsI/nmoTmm7TpnaDov5Hlt7HmlrnvvIjlkI7vvIkNCiAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJpy5YC86L6D5aSn55qE5pu06Z2g6L+R5bex5pa577yI5ZCO77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gSWYgbXVsdGlwbGUgcGllY2VzIG9uIHRoZSBzYW1lIGNvbHVtbiBhbmQgbm8gbWFya2VyLCBkZXRlcm1pbmUgYmFzZWQgb24gZGlyZWN0aW9uDQogICAgICAgICAgICAvLyDlr7nkuo7lkIzkuIDliJfnmoTmo4vlrZDvvIzpgJrov4fmr5TovoNy5YC85p2l5Yy65YiGDQogICAgICAgICAgICBpZiAoZGlyZWN0aW9uID09PSAn6L+bJykgew0KICAgICAgICAgICAgICAgIC8vIOi/m+aYr+WQkeaVjOaWueaWueWQkeenu+WKqO+8jOaJgOS7pemAieaLqeabtOmdoOi/keW3seaWueeahOaji+WtkO+8iOWQju+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9IGVsc2UgaWYgKGRpcmVjdGlvbiA9PT0gJ+mAgCcpIHsNCiAgICAgICAgICAgICAgICAvLyDpgIDmmK/lkJHlt7HmlrnmlrnlkJHnp7vliqjvvIzmiYDku6XpgInmi6nmm7TpnaDov5HmlYzmlrnnmoTmo4vlrZDvvIjliY3vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICByZXR1cm4gY2FuZGlkYXRlc1swXTsgLy8gRGVmYXVsdCB0byBmaXJzdCBpZiBkaXJlY3Rpb24gaXMgJ+W5sycgYW5kIG5vIG1hcmtlcg0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byB1cGRhdGUgcGllY2UgcG9zaXRpb24NCiAgICAgICAgY29uc3QgdXBkYXRlUGllY2VQb3NpdGlvbiA9IChwaWVjZVR5cGUsIGNvbG9yLCBvbGRQb3MsIG5ld1BvcykgPT4gew0KICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7Y29sb3J9LSR7cGllY2VUeXBlfWA7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1trZXldOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiBwb3NpdGlvbnMgZXhpc3QgYW5kIGFyZSB2YWxpZA0KICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IE5vIHBvc2l0aW9ucyBmb3VuZCBmb3IgcGllY2U6Jywga2V5KTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgIHBvc2l0aW9ucy5yID0gbmV3UG9zLnI7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zLmMgPSBuZXdQb3MuYzsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IGluZGV4ID0gcG9zaXRpb25zLmZpbmRJbmRleChwb3MgPT4gcG9zLnIgPT09IG9sZFBvcy5yICYmIHBvcy5jID09PSBvbGRQb3MuYyk7DQogICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKSB7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zW2luZGV4XS5yID0gbmV3UG9zLnI7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zW2luZGV4XS5jID0gbmV3UG9zLmM7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogQ291bGQgbm90IGZpbmQgcGllY2UgcG9zaXRpb24gdG8gdXBkYXRlOicsIG9sZFBvcywgJ2luJywgcG9zaXRpb25zKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY2hlY2sgaWYgcG9zaXRpb24gaXMgdmFsaWQNCiAgICAgICAgY29uc3QgaXNWYWxpZFBvcyA9IChyLCBjKSA9PiByID49IDAgJiYgciA8IDEwICYmIGMgPj0gMCAmJiBjIDwgOTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGhvcnNlIG1vdmVzDQogICAgICAgIGNvbnN0IGdldEhvcnNlTW92ZXMgPSAocG9zKSA9PiB7DQogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IGRyOiAtMiwgZGM6IC0xIH0sIHsgZHI6IC0yLCBkYzogMSB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IC0xLCBkYzogLTIgfSwgeyBkcjogLTEsIGRjOiAyIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMSwgZGM6IC0yIH0sIHsgZHI6IDEsIGRjOiAyIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMiwgZGM6IC0xIH0sIHsgZHI6IDIsIGRjOiAxIH0NCiAgICAgICAgICAgIF07DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBob3JzZSBjYW4gbW92ZSBpbiB0aGUgZGlyZWN0aW9uDQogICAgICAgICAgICBjb25zdCBjYW5Nb3ZlID0gKGJsb2NrZWRSLCBibG9ja2VkQykgPT4gew0KICAgICAgICAgICAgICAgIGlmICghaXNWYWxpZFBvcyhyICsgYmxvY2tlZFIsIGMgKyBibG9ja2VkQykpIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH07DQoNCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSwgaW5kZXgpID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCBibG9ja2VkUiA9IGRyID4gMCA/IDEgOiBkciA8IDAgPyAtMSA6IDA7DQogICAgICAgICAgICAgICAgY29uc3QgYmxvY2tlZEMgPSBkYyA+IDAgPyAxIDogZGMgPCAwID8gLTEgOiAwOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBwYXRoIGlzIGJsb2NrZWQNCiAgICAgICAgICAgICAgICBpZiAoKGluZGV4IDwgMiB8fCBpbmRleCA+PSA2KSAmJiBibG9ja2VkUiAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBibG9ja2VkDQogICAgICAgICAgICAgICAgICAgIGlmICghY2FuTW92ZShibG9ja2VkUiwgMCkpIHJldHVybjsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGJsb2NrZWRDICE9PSAwKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgYmxvY2tlZA0KICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbk1vdmUoMCwgYmxvY2tlZEMpKSByZXR1cm47DQogICAgICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpKSB7DQogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0pOw0KDQogICAgICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBlbGVwaGFudCBtb3Zlcw0KICAgICAgICBjb25zdCBnZXRFbGVwaGFudE1vdmVzID0gKHBvcywgY29sb3IpID0+IHsNCiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107DQogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgZHI6IC0yLCBkYzogLTIgfSwgeyBkcjogLTIsIGRjOiAyIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMiwgZGM6IC0yIH0sIHsgZHI6IDIsIGRjOiAyIH0NCiAgICAgICAgICAgIF07DQoNCiAgICAgICAgICAgIC8vIEVsZXBoYW50J3MgdGVycml0b3J5IC0gcmVkIGVsZXBoYW50cyBjYW4gb25seSBiZSBpbiByPD00LCBibGFjayBlbGVwaGFudHMgaW4gcj49NQ0KICAgICAgICAgICAgY29uc3QgaXNJblRlcnJpdG9yeSA9IChyKSA9PiB7DQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IHIgPD0gNCA6IHIgPj0gNTsNCiAgICAgICAgICAgIH07DQoNCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSkgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IG1pZFIgPSByICsgZHIgLyAyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG1pZEMgPSBjICsgZGMgLyAyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsNCg0KICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIG1pZCBwb3NpdGlvbiBpcyBlbXB0eSBhbmQgbmV3IHBvc2l0aW9uIGlzIHZhbGlkDQogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobWlkUiwgbWlkQykgJiYgaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSAmJiBpc0luVGVycml0b3J5KG5ld1IpKSB7DQogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0pOw0KDQogICAgICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBhZHZpc29yIG1vdmVzDQogICAgICAgIGNvbnN0IGdldEFkdmlzb3JNb3ZlcyA9IChwb3MsIGNvbG9yKSA9PiB7DQogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IGRyOiAtMSwgZGM6IC0xIH0sIHsgZHI6IC0xLCBkYzogMSB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDEsIGRjOiAtMSB9LCB7IGRyOiAxLCBkYzogMSB9DQogICAgICAgICAgICBdOw0KDQogICAgICAgICAgICAvLyBBZHZpc29yJ3MgdGVycml0b3J5IChwYWxhY2UpIC0gcmVkIGFkdmlzb3JzIGluIHI9MC0yLGM9My01LCBibGFjayBhZHZpc29ycyBpbiByPTctOSxjPTMtNQ0KICAgICAgICAgICAgY29uc3QgaXNJblBhbGFjZSA9IChyLCBjKSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgclJhbmdlID0gY29sb3IgPT09ICdyZWQnID8gWzAsIDJdIDogWzcsIDldOw0KICAgICAgICAgICAgICAgIHJldHVybiByID49IHJSYW5nZVswXSAmJiByIDw9IHJSYW5nZVsxXSAmJiBjID49IDMgJiYgYyA8PSA1Ow0KICAgICAgICAgICAgfTsNCg0KICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9KSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpICYmIGlzSW5QYWxhY2UobmV3UiwgbmV3QykpIHsNCiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSk7DQoNCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgYm9hcmQgdG8gdHJhY2sgbW92ZXMNCiAgICAgICAgbGV0IHRlbXBCb2FyZCA9IHRoaXMuY3JlYXRlSW5pdGlhbEJvYXJkKCk7DQogICAgICAgIA0KICAgICAgICAvLyBFbnN1cmUgdGVtcEJvYXJkIGlzIHByb3Blcmx5IGluaXRpYWxpemVkDQogICAgICAgIGlmICghdGVtcEJvYXJkIHx8IHRlbXBCb2FyZC5sZW5ndGggIT09IDEwKSB7DQogICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIGJvYXJkIGluaXRpYWxpemF0aW9uJyk7DQogICAgICAgICAgICByZXR1cm4gW107DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIC8vIFZlcmlmeSBhbGwgcm93cyBoYXZlIDkgY29sdW1ucw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwOyBpKyspIHsNCiAgICAgICAgICAgIGlmICghdGVtcEJvYXJkW2ldIHx8IHRlbXBCb2FyZFtpXS5sZW5ndGggIT09IDkpIHsNCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbaV0gPSBBcnJheSg5KS5maWxsKG51bGwpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgY29uc29sZS5sb2coJ1RvdGFsIG1vdmVzOicsIG5vdGF0aW9uLmxlbmd0aCk7DQogICAgICAgIG5vdGF0aW9uLmZvckVhY2gobW92ZU5vdGF0aW9uID0+IHsNCg0KDQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFBhcnNlIHRoZSBtb3ZlIG5vdGF0aW9uIC0ga2VlcCBsYXN0IGdyb3VwIG9wdGlvbmFsDQogICAgICAgICAgICBjb25zdCByZWdleCA9IC8oW+WJjeWQjl0pPyhb5bCG5biF5aOr5LuV6LGh55u46ams6L2m54Ku5YW15Y2SXSkoW+S4gOS6jOS4ieWbm+S6lOWFreS4g+WFq+S5nTEyMzQ1Njc4OV0pKFvov5vpgIDlubNdKShb5LiA5LqM5LiJ5Zub5LqU5YWt5LiD5YWr5LmdMTIzNDU2Nzg5XSk/LzsNCiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gbW92ZU5vdGF0aW9uLm1hdGNoKHJlZ2V4KTsNCg0KICAgICAgICAgICAgaWYgKCFtYXRjaCkgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgbW92ZSBub3RhdGlvbjonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgY29uc3QgWywgZnJvbnRCYWNrTWFya2VyLCBwaWVjZUNoYXIsIGZyb21Db2xOb3RhdGlvbiwgZGlyZWN0aW9uLCB0b0NvbE9yU3RlcE5vdGF0aW9uXSA9IG1hdGNoOw0KICAgICAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2VNYXBbcGllY2VDaGFyXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gR2V0IGNvbHVtbiBtYXBwaW5nIGJhc2VkIG9uIGN1cnJlbnQgY29sb3IgKGJsYWNrIHNlZXMgY29sdW1ucyBtaXJyb3JlZCkNCiAgICAgICAgICAgIGxldCBmcm9tQ29sID0gY29sTWFwW2Zyb21Db2xOb3RhdGlvbl07DQogICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrIChmcm9tIGJsYWNrJ3MgcGVyc3BlY3RpdmUpDQogICAgICAgICAgICAgICAgZnJvbUNvbCA9IDggLSBmcm9tQ29sOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBGaW5kIHRoZSBjdXJyZW50IHBvc2l0aW9uIG9mIHRoZSBwaWVjZQ0KICAgICAgICAgICAgY29uc3QgZnJvbVBvcyA9IGZpbmRQaWVjZVBvc2l0aW9uKHBpZWNlVHlwZSwgY3VycmVudENvbG9yLCBmcm9tQ29sLCBkaXJlY3Rpb24sIGZyb250QmFja01hcmtlcik7DQoNCiAgICAgICAgICAgIGlmICghZnJvbVBvcykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBmaW5kIHBpZWNlIHBvc2l0aW9uIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBsZXQgdG9Qb3M7DQoNCiAgICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT09ICflubMnKSB7DQogICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBtb3ZlbWVudA0KICAgICAgICAgICAgICAgIGxldCB0b0NvbCA9IGNvbE1hcFt0b0NvbE9yU3RlcE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICBpZiAodG9Db2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb246JywgdG9Db2xPclN0ZXBOb3RhdGlvbiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrIHdoZW4gbW92aW5nIGhvcml6b250YWxseQ0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgdG9Db2wgPSA4IC0gdG9Db2w7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIHRvUG9zID0geyByOiBmcm9tUG9zLnIsIGM6IHRvQ29sIH07DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIG9yIGRpYWdvbmFsIG1vdmVtZW50DQogICAgICAgICAgICAgICAgY29uc3Qgc3RlcHMgPSBjaGluZXNlTnVtYmVyTWFwW3RvQ29sT3JTdGVwTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKHN0ZXBzID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBzdGVwIGNvdW50OicsIHRvQ29sT3JTdGVwTm90YXRpb24sICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2hvcnNlJykgew0KICAgICAgICAgICAgICAgICAgICAvLyBIb3JzZSBtb3ZlcyBpbiBMLXNoYXBlDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRIb3JzZU1vdmVzKGZyb21Qb3MpOw0KICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24NCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOw0KICAgICAgICAgICAgICAgICAgICBsZXQgdGFyZ2V0Q29sID0gY29sTWFwW3RhcmdldENvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGhvcnNlOicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sNCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnZWxlcGhhbnQnKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEVsZXBoYW50IG1vdmVzIGRpYWdvbmFsbHkgMiBzdGVwcw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0RWxlcGhhbnRNb3Zlcyhmcm9tUG9zLCBjdXJyZW50Q29sb3IpOw0KICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24NCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOw0KICAgICAgICAgICAgICAgICAgICBsZXQgdGFyZ2V0Q29sID0gY29sTWFwW3RhcmdldENvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGVsZXBoYW50OicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sNCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnYWR2aXNvcicpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gQWR2aXNvciBtb3ZlcyBkaWFnb25hbGx5IDEgc3RlcA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0QWR2aXNvck1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7DQogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247DQogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgYWR2aXNvcjonLCB0YXJnZXRDb2xOb3RhdGlvbiwgJ2luIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrDQogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldENvbCA9IDggLSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIG1vdmUgdGhhdCBtYXRjaGVzIGJvdGggZGlyZWN0aW9uIGFuZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZGlyZWN0aW9uIChyb3cpDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbk1hdGNoID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yID4gZnJvbVBvcy5yIDogbW92ZS5yIDwgZnJvbVBvcy5yKSA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgY29sdW1uDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2x1bW5NYXRjaCA9IG1vdmUuYyA9PT0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOw0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyBTdHJhaWdodCBsaW5lIG1vdmVtZW50IChjaGFyaW90LCBjYW5ub24sIHNvbGRpZXIpDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXAgPSBkaXJlY3Rpb24gPT09ICfov5snID8gKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAxIDogLTEpICogc3RlcHMgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAtMSA6IDEpICogc3RlcHM7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSBmcm9tUG9zLnIgKyBzdGVwOw0KICAgICAgICAgICAgICAgICAgICBpZiAobmV3UiA8IDAgfHwgbmV3UiA+PSAxMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCByb3cgcG9zaXRpb24gYWZ0ZXIgbW92ZTonLCBuZXdSLCAnZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHsgcjogbmV3UiwgYzogZnJvbVBvcy5jIH07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAoIXRvUG9zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignQ291bGQgbm90IGRldGVybWluZSB0YXJnZXQgcG9zaXRpb24gZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEFkZCB0aGUgbW92ZSB0byB0aGUgbGlzdA0KICAgICAgICAgICAgbW92ZXMucHVzaCh7IGZyb206IHsgcjogZnJvbVBvcy5yLCBjOiBmcm9tUG9zLmMgfSwgdG86IHsgcjogdG9Qb3MuciwgYzogdG9Qb3MuYyB9IH0pOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGVyZSdzIGEgY2FwdHVyZWQgcGllY2UNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkUGllY2UgPSB0ZW1wQm9hcmRbdG9Qb3Mucl1bdG9Qb3MuY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIElmIHRoZXJlJ3MgYSBjYXB0dXJlZCBwaWVjZSwgcmVtb3ZlIGl0IGZyb20gcGllY2VQb3NpdGlvbnMNCiAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBgJHtjYXB0dXJlZFBpZWNlLmNvbG9yfS0ke2NhcHR1cmVkUGllY2UudHlwZX1gOw0KICAgICAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkUG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNbY2FwdHVyZWRLZXldOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjYXB0dXJlZFBvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgICAgICAvLyDlsIYv5biF5LiN5Lya6KKr5ZCD5o6J77yM5omA5Lul5Y+q5aSE55CG5YW25LuW5qOL5a2QDQogICAgICAgICAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlLnR5cGUgIT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmVtb3ZlIHRoZSBjYXB0dXJlZCBwb3NpdGlvbiBmcm9tIHRoZSBhcnJheQ0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY2FwdHVyZWRQb3NpdGlvbnMpKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlZFBvc2l0aW9ucyA9IGNhcHR1cmVkUG9zaXRpb25zLmZpbHRlcihwb3MgPT4gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiAocG9zLnIgIT09IHRvUG9zLnIgfHwgcG9zLmMgIT09IHRvUG9zLmMpDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV0gPSB1cGRhdGVkUG9zaXRpb25zOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFZlcmlmeSByZW1vdmFsIHdhcyBzdWNjZXNzZnVsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RpbGxFeGlzdHMgPSB1cGRhdGVkUG9zaXRpb25zLnNvbWUocG9zID0+IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgcG9zLnIgPT09IHRvUG9zLnIgJiYgcG9zLmMgPT09IHRvUG9zLmMNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzdGlsbEV4aXN0cykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IENhcHR1cmVkIHBpZWNlIHN0aWxsIGV4aXN0cyBpbiBwaWVjZVBvc2l0aW9ucyEnKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygn4pyFIFNVQ0NFU1M6IENhcHR1cmVkIHBpZWNlIHJlbW92ZWQgZnJvbSBwaWVjZVBvc2l0aW9ucycpOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBVbmV4cGVjdGVkIG5vbi1hcnJheSBwb3NpdGlvbnMgZm9yIHBpZWNlOicsIGNhcHR1cmVkS2V5KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogTm8gcG9zaXRpb25zIGZvdW5kIGZvciBjYXB0dXJlZCBwaWVjZTonLCBjYXB0dXJlZEtleSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBWZXJpZnkgdGhlIGNhcHR1cmVkIHBpZWNlIGhhcyBiZWVuIHJlbW92ZWQNCiAgICAgICAgICAgIGlmIChjYXB0dXJlZFBpZWNlKSB7DQogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRLZXkgPSBgJHtjYXB0dXJlZFBpZWNlLmNvbG9yfS0ke2NhcHR1cmVkUGllY2UudHlwZX1gOw0KICAgICAgICAgICAgICAgIGNvbnN0IGZpbmFsUG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNbY2FwdHVyZWRLZXldOw0KICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpbmFsUG9zaXRpb25zKSkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGlsbEV4aXN0cyA9IGZpbmFsUG9zaXRpb25zLnNvbWUocG9zID0+IA0KICAgICAgICAgICAgICAgICAgICAgICAgcG9zICYmIHBvcy5yID09PSB0b1Bvcy5yICYmIHBvcy5jID09PSB0b1Bvcy5jDQogICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgICAgIGlmIChzdGlsbEV4aXN0cykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignRVJST1I6IENhcHR1cmVkIHBpZWNlIHN0aWxsIGV4aXN0cyBpbiBwaWVjZVBvc2l0aW9uczonLCBjYXB0dXJlZFBpZWNlLCAnYXQnLCB0b1Bvcyk7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU1VDQ0VTUzogQ2FwdHVyZWQgcGllY2UgcmVtb3ZlZCBmcm9tIHBpZWNlUG9zaXRpb25zJyk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIE1ha2UgdGhlIG1vdmUgb24gdGhlIHRlbXBvcmFyeSBib2FyZCBmaXJzdCBiZWZvcmUgdXBkYXRpbmcgcGllY2UgcG9zaXRpb25zDQogICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhmcm9tUG9zLnIsIGZyb21Qb3MuYykgJiYgaXNWYWxpZFBvcyh0b1Bvcy5yLCB0b1Bvcy5jKSAmJiANCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbZnJvbVBvcy5yXSAmJiB0ZW1wQm9hcmRbdG9Qb3Mucl0pIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IHRlbXBCb2FyZFtmcm9tUG9zLnJdW2Zyb21Qb3MuY107DQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW3RvUG9zLnJdW3RvUG9zLmNdID0gcGllY2U7DQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2Zyb21Qb3Mucl1bZnJvbVBvcy5jXSA9IG51bGw7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogSW52YWxpZCBwb3NpdGlvbnMgZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uLCBmcm9tUG9zLCB0b1Bvcyk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgcGllY2UgcG9zaXRpb24gaW4gcGllY2VQb3NpdGlvbnMNCiAgICAgICAgICAgIHVwZGF0ZVBpZWNlUG9zaXRpb24ocGllY2VUeXBlLCBjdXJyZW50Q29sb3IsIGZyb21Qb3MsIHRvUG9zKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gU3dpdGNoIGNvbG9yIGZvciBuZXh0IG1vdmUNCiAgICAgICAgICAgIGN1cnJlbnRDb2xvciA9IGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIH0pOw0KDQogICAgICAgIHJldHVybiBtb3ZlczsNCiAgICB9DQp9DQoNCi8vIC0tLSBDb25zdGFudHMgLS0tDQoNCi8vIEluaXRpYWxpemUgT3BlbmluZyBCb29rDQpjb25zdCBvcGVuaW5nQm9vayA9IG5ldyBPcGVuaW5nQm9vaygxMik7DQoNCmNvbnN0IGlzVmFsaWRQb3MgPSAociwgYykgPT4gciA+PSAwICYmIHIgPCBST1dTICYmIGMgPj0gMCAmJiBjIDwgQ09MUzsNCg0KLy8g5qih5Z2X57qn5Lyq5ZCI5rOV6JC954K577yI6YG/5YWNIGdldFBpZWNlTW92ZXMg5q+P6LCD55So5paw5bu66Zet5YyF77yJDQpjb25zdCBwdXNoUHNldWRvRGVzdCA9IChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgdHIsIHRjKSA9PiB7DQogIGlmICh0ciA8IDAgfHwgdHIgPj0gUk9XUyB8fCB0YyA8IDAgfHwgdGMgPj0gQ09MUykgcmV0dXJuOw0KICBjb25zdCB0YXJnZXQgPSBib2FyZFt0cl1bdGNdOw0KICBpZiAoIXRhcmdldCB8fCB0YXJnZXQuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsNCiAgICBtb3Zlcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICB9IGVsc2UgaWYgKGFsbGllc091dCAmJiB0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgYWxsaWVzT3V0LnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogIH0NCn07DQoNCi8vIGFsbGllc091dDog5Y+v6YCJ77yM5pS26ZuG5Y+v5L+d5oqk55qE5bex5pa56JC954K577yI5LiN5ZCr5bCG5biF77yJ77yM5L6b5YWz57O76K6h566X5aSN55So77yM6YG/5YWN5LqM5qyh5bCE57q/DQpjb25zdCBnZXRQaWVjZU1vdmVzID0gKGJvYXJkLCBwb3MsIHBpZWNlLCBhbGxpZXNPdXQgPSBudWxsKSA9PiB7DQogIGNvbnN0IG1vdmVzID0gW107DQogIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCiAgY29uc3QgcGllY2VDb2xvciA9IHBpZWNlLmNvbG9yOw0KICBjb25zdCBjb2xvcklkeCA9IGlzUmVkID8gMCA6IDE7DQogIGNvbnN0IGZyb21TcSA9IHIgKiA5ICsgYzsNCg0KICBzd2l0Y2ggKHBpZWNlLnR5cGUpIHsNCiAgICBjYXNlICdnZW5lcmFsJzogew0KICAgICAgY29uc3QgZGVzdHMgPSBHRU5FUkFMX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgcHVzaFBzZXVkb0Rlc3QoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIGQuciwgZC5jKTsNCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBjYXNlICdhZHZpc29yJzogew0KICAgICAgY29uc3QgZGVzdHMgPSBBRFZJU09SX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgcHVzaFBzZXVkb0Rlc3QoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIGQuciwgZC5jKTsNCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBjYXNlICdlbGVwaGFudCc6IHsNCiAgICAgIGNvbnN0IGRlc3RzID0gRUxFUEhBTlRfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICBpZiAoYm9hcmRbZC5icl1bZC5iY10gPT09IG51bGwpIHsNCiAgICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOw0KICAgICAgICB9DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogICAgY2FzZSAnaG9yc2UnOiB7DQogICAgICBjb25zdCBkZXN0cyA9IEhPUlNFX0RFU1RbZnJvbVNxXTsNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICBpZiAoYm9hcmRbZC5icl1bZC5iY10gPT09IG51bGwpIHsNCiAgICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOw0KICAgICAgICB9DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogICAgY2FzZSAnY2hhcmlvdCc6DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIHdoaWxlIChuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUykgew0KICAgICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgaWYgKHRhcmdldCA9PT0gbnVsbCkgew0KICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKHRhcmdldC5jb2xvciAhPT0gcGllY2VDb2xvcikgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIGVsc2UgaWYgKGFsbGllc091dCAmJiB0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSBhbGxpZXNPdXQucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgIH0NCiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ2Nhbm5vbic6DQogICAgICAvLyDnnYDms5Xku43lj6rlkKvmlYzmlrnpmpTmiZPvvJvlt7HmlrnpmpTmiZPkv53miqTnlLEgZmlsbENhbm5vblJlbGF0aW9ucyDnu5/kuIDlpITnkIYNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgbGV0IHNjcmVlbkZvdW5kID0gZmFsc2U7DQogICAgICAgIHdoaWxlIChuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUykgew0KICAgICAgICAgIGlmICghc2NyZWVuRm91bmQpIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdID09PSBudWxsKSB7DQogICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICBzY3JlZW5Gb3VuZCA9IHRydWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdICE9PSBudWxsKSB7DQogICAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdLmNvbG9yICE9PSBwaWVjZUNvbG9yKSBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICB9DQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgICB9DQogICAgICB9DQogICAgICBicmVhazsNCiAgICBjYXNlICdzb2xkaWVyJzogew0KICAgICAgY29uc3QgZGVzdHMgPSBTT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgcHVzaFBzZXVkb0Rlc3QoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIGQuciwgZC5jKTsNCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgfQ0KICByZXR1cm4gbW92ZXM7DQp9Ow0KDQpjb25zdCBpc0ZseWluZ0dlbmVyYWwgPSAoYm9hcmQpID0+IHsNCiAgY29uc3QgcmVkRyA9IGdldEdlbmVyYWxQb3MoYm9hcmQsICdyZWQnKTsNCiAgY29uc3QgYmxhY2tHID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgJ2JsYWNrJyk7DQogIGlmICghcmVkRyB8fCAhYmxhY2tHIHx8IHJlZEcuYyAhPT0gYmxhY2tHLmMpIHJldHVybiBmYWxzZTsNCiAgDQogIC8vIOehruS/neW+queOr+aWueWQkeato+ehru+8jOS7jui+g+Wwj+eahHLliLDovoPlpKfnmoRyDQogIGNvbnN0IHN0YXJ0UiA9IE1hdGgubWluKGJsYWNrRy5yLCByZWRHLnIpICsgMTsNCiAgY29uc3QgZW5kUiA9IE1hdGgubWF4KGJsYWNrRy5yLCByZWRHLnIpIC0gMTsNCiAgDQogIGZvciAobGV0IHIgPSBzdGFydFI7IHIgPD0gZW5kUjsgcisrKSB7DQogICAgaWYgKGJvYXJkW3JdW3JlZEcuY10gIT09IG51bGwpIHJldHVybiBmYWxzZTsNCiAgfQ0KICByZXR1cm4gdHJ1ZTsNCn07DQoNCi8vIOaXoCBib2FyZEluZm8g5pe255qE5b+r6YCf5bCG5Yab5qOA5rWL77ya5bCG5L2N57yT5a2YICsg5LuO5bCG5L2N5Zub5ZCR5bCE57q/77yI6L2mL+Wwhi/ngq7lkIjlubbvvIkNCmNvbnN0IGlzQ2hlY2tSYXdGcm9tUGllY2VTdGF0ZSA9IChzdGF0ZSwgY29sb3IpID0+IHsKICAgIGNvbnN0IG93bklzUmVkID0gY29sb3IgPT09ICdyZWQnOwogICAgY29uc3QgZ2VuZXJhbFNxID0gb3duSXNSZWQgPyBzdGF0ZS5yZWRHZW5lcmFsU3EgOiBzdGF0ZS5ibGFja0dlbmVyYWxTcTsKICAgIGlmIChnZW5lcmFsU3EgPCAwKSByZXR1cm4gdHJ1ZTsKCiAgICBjb25zdCBzcXVhcmVDb2RlcyA9IHN0YXRlLnNxdWFyZUNvZGVzOwogICAgY29uc3QgZW5lbXlJc1JlZCA9ICFvd25Jc1JlZDsKICAgIGNvbnN0IGdyID0gKGdlbmVyYWxTcSAvIDkpIHwgMDsKICAgIGNvbnN0IGdjID0gZ2VuZXJhbFNxICUgOTsKCiAgICBmb3IgKGxldCBkaXIgPSAwOyBkaXIgPCBPUlRIX0RJUlMubGVuZ3RoOyBkaXIrKykgewogICAgICAgIGNvbnN0IHJheSA9IFNFQVJDSF9SQVlTW2dlbmVyYWxTcV1bZGlyXTsKICAgICAgICBsZXQgc2VlbiA9IDA7CiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCByYXkubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgY29uc3QgcGllY2VDb2RlID0gc3F1YXJlQ29kZXNbcmF5W2ldXTsKICAgICAgICAgICAgaWYgKHBpZWNlQ29kZSA9PT0gMCkgY29udGludWU7CiAgICAgICAgICAgIHNlZW4rKzsKICAgICAgICAgICAgY29uc3QgaXNFbmVteSA9IChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZDsKICAgICAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2VDb2RlICYgNzsKICAgICAgICAgICAgaWYgKHNlZW4gPT09IDEpIHsKICAgICAgICAgICAgICAgIGlmIChpc0VuZW15ICYmIChwaWVjZVR5cGUgPT09IDIgfHwgcGllY2VUeXBlID09PSAxKSkgcmV0dXJuIHRydWU7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICBpZiAoaXNFbmVteSAmJiBwaWVjZVR5cGUgPT09IDYpIHJldHVybiB0cnVlOwogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CgogICAgY29uc3QgaG9yc2VDaGVja2VycyA9IFNFQVJDSF9IT1JTRV9DSEVDS0VSU1tnZW5lcmFsU3FdOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBob3JzZUNoZWNrZXJzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgZW50cnkgPSBob3JzZUNoZWNrZXJzW2ldOwogICAgICAgIGlmIChzcXVhcmVDb2Rlc1tlbnRyeSA+Pj4gN10gIT09IDApIGNvbnRpbnVlOwogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW2VudHJ5ICYgMTI3XTsKICAgICAgICBpZiAocGllY2VDb2RlICE9PSAwICYmIChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZCAmJiAocGllY2VDb2RlICYgNykgPT09IDMpIHJldHVybiB0cnVlOwogICAgfQoKICAgIGNvbnN0IGFkdmlzb3JTcXVhcmVzID0gU0VBUkNIX0FEVklTT1JfREVTVFtvd25Jc1JlZCA/IDAgOiAxXVtnZW5lcmFsU3FdOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhZHZpc29yU3F1YXJlcy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW2Fkdmlzb3JTcXVhcmVzW2ldXTsKICAgICAgICBpZiAocGllY2VDb2RlICE9PSAwICYmIChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZCAmJiAocGllY2VDb2RlICYgNykgPT09IDUpIHJldHVybiB0cnVlOwogICAgfQoKICAgIGNvbnN0IGVuZW15Rm9yd2FyZCA9IGVuZW15SXNSZWQgPyAxIDogLTE7CiAgICBjb25zdCBmb3J3YXJkUiA9IGdyIC0gZW5lbXlGb3J3YXJkOwogICAgaWYgKGZvcndhcmRSID49IDAgJiYgZm9yd2FyZFIgPCBST1dTKSB7CiAgICAgICAgY29uc3QgcGllY2VDb2RlID0gc3F1YXJlQ29kZXNbZm9yd2FyZFIgKiA5ICsgZ2NdOwogICAgICAgIGlmIChwaWVjZUNvZGUgIT09IDAgJiYgKHBpZWNlQ29kZSA8IDgpID09PSBlbmVteUlzUmVkICYmIChwaWVjZUNvZGUgJiA3KSA9PT0gNykgcmV0dXJuIHRydWU7CiAgICB9CiAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBlbmVteUlzUmVkID8gZ3IgPj0gNSA6IGdyIDw9IDQ7CiAgICBpZiAoY3Jvc3NlZFJpdmVyKSB7CiAgICAgICAgaWYgKGdjIDwgQ09MUyAtIDEpIHsKICAgICAgICAgICAgY29uc3QgcGllY2VDb2RlID0gc3F1YXJlQ29kZXNbZ2VuZXJhbFNxICsgMV07CiAgICAgICAgICAgIGlmIChwaWVjZUNvZGUgIT09IDAgJiYgKHBpZWNlQ29kZSA8IDgpID09PSBlbmVteUlzUmVkICYmIChwaWVjZUNvZGUgJiA3KSA9PT0gNykgcmV0dXJuIHRydWU7CiAgICAgICAgfQogICAgICAgIGlmIChnYyA+IDApIHsKICAgICAgICAgICAgY29uc3QgcGllY2VDb2RlID0gc3F1YXJlQ29kZXNbZ2VuZXJhbFNxIC0gMV07CiAgICAgICAgICAgIGlmIChwaWVjZUNvZGUgIT09IDAgJiYgKHBpZWNlQ29kZSA8IDgpID09PSBlbmVteUlzUmVkICYmIChwaWVjZUNvZGUgJiA3KSA9PT0gNykgcmV0dXJuIHRydWU7CiAgICAgICAgfQogICAgfQoKICAgIHJldHVybiBmYWxzZTsKfTsKCmNvbnN0IGlzQ2hlY2tSYXcgPSAoYm9hcmQsIGNvbG9yKSA9PiB7CiAgICBjb25zdCBwaWVjZVN0YXRlID0gU0VBUkNIX05VTUVSSUNfQ0hFQ0sgPyBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKSA6IG51bGw7CiAgICBpZiAocGllY2VTdGF0ZSkgcmV0dXJuIGlzQ2hlY2tSYXdGcm9tUGllY2VTdGF0ZShwaWVjZVN0YXRlLCBjb2xvcik7CiAgICBjb25zdCBnZW5lcmFsUG9zID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgY29sb3IpOwogICAgaWYgKCFnZW5lcmFsUG9zKSByZXR1cm4gdHJ1ZTsNCg0KICAgIGNvbnN0IGVuZW15Q29sb3IgPSBjb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgY29uc3QgeyByOiBnciwgYzogZ2MgfSA9IGdlbmVyYWxQb3M7DQoNCiAgICAvLyDnm7Tnur/vvJrnrKzkuIDlrZDkuLrmlYzovaYv5bCG5YiZ5bCG5Yab77yb6LaK6L+H54Ku5p625ZCO56ys5LqM5a2Q5Li65pWM54Ku5YiZ5bCG5YabDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICBsZXQgbnIgPSBnciArIGRyOw0KICAgICAgICBsZXQgbmMgPSBnYyArIGRjOw0KICAgICAgICBsZXQgc2VlbiA9IDA7DQoNCiAgICAgICAgd2hpbGUgKGlzVmFsaWRQb3MobnIsIG5jKSkgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICBpZiAocCkgew0KICAgICAgICAgICAgICAgIHNlZW4rKzsNCiAgICAgICAgICAgICAgICBpZiAoc2VlbiA9PT0gMSkgew0KICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiAocC50eXBlID09PSAnY2hhcmlvdCcgfHwgcC50eXBlID09PSAnZ2VuZXJhbCcpKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ2Nhbm5vbicpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIG5yICs9IGRyOw0KICAgICAgICAgICAgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDpqazvvJrku47lsIbkvY3lj43mjqjvvIzpqazohb/lnKjpqazkuIDkvqfvvIjkuI4gZ2V0UGllY2VNb3ZlcyAvIEhPUlNFX0RJUlMg5LiA6Ie077yJDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBIT1JTRV9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBIT1JTRV9ESVJTW2ldOw0KICAgICAgICBjb25zdCBuciA9IGdyICsgZC5kcjsNCiAgICAgICAgY29uc3QgbmMgPSBnYyArIGQuZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICAgIGNvbnN0IGxlZ1IgPSBuciAtIGQubGVnRHI7DQogICAgICAgICAgICBjb25zdCBsZWdDID0gbmMgLSBkLmxlZ0RjOw0KICAgICAgICAgICAgaWYgKGJvYXJkW2xlZ1JdW2xlZ0NdID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdob3JzZScpIHsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5aOr77yI5Lmd5a6r5YaF77yJDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBESUFHX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZHIgPSBESUFHX0RJUlNbaV1bMF0sIGRjID0gRElBR19ESVJTW2ldWzFdOw0KICAgICAgICBjb25zdCBuciA9IGdyICsgZHI7DQogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkYzsNCiAgICAgICAgaWYgKGlzVmFsaWRQb3MobnIsIG5jKSAmJg0KICAgICAgICAgICAgKChjb2xvciA9PT0gJ3JlZCcgJiYgbnIgPj0gMCAmJiBuciA8PSAyKSB8fCAoY29sb3IgPT09ICdibGFjaycgJiYgbnIgPj0gNyAmJiBuciA8PSA5KSkgJiYNCiAgICAgICAgICAgIG5jID49IDMgJiYgbmMgPD0gNSkgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ2Fkdmlzb3InKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDlhbXvvJrmraPliY3mlrnlp4vnu4jlj6/mlLvvvJvlt6blj7Pku4Xov4fmsrPlhbUNCiAgICBjb25zdCBlbmVteUZvcndhcmQgPSBlbmVteUNvbG9yID09PSAncmVkJyA/IDEgOiAtMTsNCiAgICBjb25zdCBmb3J3YXJkRnJvbVIgPSBnciAtIGVuZW15Rm9yd2FyZDsNCiAgICBpZiAoaXNWYWxpZFBvcyhmb3J3YXJkRnJvbVIsIGdjKSkgew0KICAgICAgICBjb25zdCBwID0gYm9hcmRbZm9yd2FyZEZyb21SXVtnY107DQogICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnc29sZGllcicpIHsNCiAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgfQ0KICAgIGZvciAoY29uc3QgZGMgb2YgWzEsIC0xXSkgew0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKGdyLCBuYykpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtncl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGNyb3NzZWRSaXZlciA9IGVuZW15Q29sb3IgPT09ICdyZWQnID8gZ3IgPj0gNSA6IGdyIDw9IDQ7DQogICAgICAgICAgICAgICAgaWYgKGNyb3NzZWRSaXZlcikgew0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICByZXR1cm4gZmFsc2U7DQp9Ow0KDQpjb25zdCBpc0NoZWNrID0gKGJvYXJkLCBjb2xvciwgcGllY2VzSW5mbyA9IG51bGwsIGJvYXJkSW5mbyA9IG51bGwpID0+IHsNCiAgICAvLyDkvJjlhYjkvb/nlKjpooTorqHnrpfnmoTlsIblhpvnirbmgIENCiAgICBpZiAoYm9hcmRJbmZvKSB7DQogICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkSXNJbkNoZWNrIDogYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrOw0KICAgIH0NCg0KICAgIC8vIOWmguaenOaciXBpZWNlc0luZm/vvIzkuZ/lj6/ku6Xku47kuK3ojrflj5blsIblhpvnirbmgIENCiAgICBpZiAocGllY2VzSW5mbyAmJiBwaWVjZXNJbmZvLmxlbmd0aCA+IDApIHsNCiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IHBpZWNlc0luZm9bMF0ucmVkSXNJbkNoZWNrIDogcGllY2VzSW5mb1swXS5ibGFja0lzSW5DaGVjazsNCiAgICB9DQoNCiAgICByZXR1cm4gaXNDaGVja1Jhdyhib2FyZCwgY29sb3IpOw0KfTsNCg0KLy8g5ZCI5rOV552A5rOV77ya5Lyq5ZCI5rOVICsg5LiN6YCB5bCGL+S4jemjnuWwhu+8iG1ha2UvdW5tYWtl77yJDQpjb25zdCBnZXRWYWxpZE1vdmVzID0gKGJvYXJkLCBwb3MpID0+IHsNCiAgY29uc3QgcGllY2UgPSBib2FyZFtwb3Mucl1bcG9zLmNdOw0KICBpZiAoIXBpZWNlKSByZXR1cm4gW107DQogIGNvbnN0IHBzZXVkb01vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgcG9zLCBwaWVjZSk7DQogIHJldHVybiBmaWx0ZXJMZWdhbE1vdmVzKGJvYXJkLCBwb3MsIHBpZWNlLCBwc2V1ZG9Nb3Zlcyk7DQp9Ow0KDQpjb25zdCBpc1ZhbGlkUGxhY2VtZW50ID0gKHR5cGUsIGNvbG9yLCByLCBjKSA9PiB7DQogICAgY29uc3QgaXNSZWQgPSBjb2xvciA9PT0gJ3JlZCc7DQogICAgc3dpdGNoKHR5cGUpIHsNCiAgICAgICAgY2FzZSAnZ2VuZXJhbCc6DQogICAgICAgICAgICAvLyDluIXlsIblj6rog73lnKjkuZ3lrqvkuK3lv4PnmoTkuIDmnaHnur/kuIoNCiAgICAgICAgICAgIGlmIChjIDwgMyB8fCBjID4gNSkgcmV0dXJuIGZhbHNlOw0KICAgICAgICAgICAgaWYgKGlzUmVkKSByZXR1cm4gciA+PSAwICYmIHIgPD0gMjsNCiAgICAgICAgICAgIGVsc2UgcmV0dXJuIHIgPj0gNyAmJiByIDw9IDk7DQogICAgICAgIGNhc2UgJ2Fkdmlzb3InOg0KICAgICAgICAgICAgLy8g5aOr5Y+q6IO95Zyo5Lmd5a6r55qENeS4queCueS5i+S4gA0KICAgICAgICAgICAgY29uc3QgdmFsaWRBZHZpc29yUG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgIHJlZDogW1swLCAzXSwgWzAsIDVdLCBbMSwgNF0sIFsyLCAzXSwgWzIsIDVdXSwNCiAgICAgICAgICAgICAgICBibGFjazogW1s3LCAzXSwgWzcsIDVdLCBbOCwgNF0sIFs5LCAzXSwgWzksIDVdXQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIHJldHVybiB2YWxpZEFkdmlzb3JQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICBjYXNlICdlbGVwaGFudCc6DQogICAgICAgICAgICAvLyDnm7jlj6rog73lnKjlt7HmlrnljYrlnLrnmoQ35Liq54K55LmL5LiADQogICAgICAgICAgICBjb25zdCB2YWxpZEVsZXBoYW50UG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgIHJlZDogW1swLCAyXSwgWzAsIDZdLCBbMiwgMF0sIFsyLCA0XSwgWzIsIDhdLCBbNCwgMl0sIFs0LCA2XV0sDQogICAgICAgICAgICAgICAgYmxhY2s6IFtbNSwgMl0sIFs1LCA2XSwgWzcsIDBdLCBbNywgNF0sIFs3LCA4XSwgWzksIDJdLCBbOSwgNl1dDQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgcmV0dXJuIHZhbGlkRWxlcGhhbnRQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICBjYXNlICdzb2xkaWVyJzoNCiAgICAgICAgICAgIC8vIOWFteeahOS9jee9rumZkOWItu+8mui/h+ays+WJjeWPquiDveWcqOWBtuaVsOWIl++8jOi/h+ays+WQjuWPr+S7peWcqOS7u+S9leWIlw0KICAgICAgICAgICAgLy8g57qi5pa55YW16L+H5rKz5p2h5Lu25pivciA+PSA177yM6buR5pa55YW16L+H5rKz5p2h5Lu25pivciA8PSA0DQogICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBpc1JlZCA/IHIgPj0gNSA6IHIgPD0gNDsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICAvLyDov4fmsrPliY3lj6rog73lnKjlgbbmlbDliJfvvIhjPTAsMiw0LDYsOO+8iQ0KICAgICAgICAgICAgICAgIGlmICghWzAsIDIsIDQsIDYsIDhdLmluY2x1ZGVzKGMpKSByZXR1cm4gZmFsc2U7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOWFteeahOS9jee9rumZkOWItu+8mui/h+ays+WJjeWPquiDveWcqOWFteS9jeWSjOWFteS9jeWJjeaWue+8jOi/h+ays+WQjuaVjOaWueWNiuWcuumDveWQiOazlQ0KICAgICAgICAgICAgY29uc3QgdmFsaWRTb2xkaWVyUG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgIHJlZDogew0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnliJ3lp4vlhbXkvY3vvJpyPTMsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGluaXRpYWw6IFtbMywgMF0sIFszLCAyXSwgWzMsIDRdLCBbMywgNl0sIFszLCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWueWFteS9jeWJjeaWue+8mnI9NCwgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgZm9yd2FyZDogW1s0LCAwXSwgWzQsIDJdLCBbNCwgNF0sIFs0LCA2XSwgWzQsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+H5rKz57q/77yacj49NQ0KICAgICAgICAgICAgICAgICAgICBjcm9zc2VkUml2ZXI6IHIgPj0gNQ0KICAgICAgICAgICAgICAgIH0sDQogICAgICAgICAgICAgICAgYmxhY2s6IHsNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55Yid5aeL5YW15L2N77yacj02LCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBpbml0aWFsOiBbWzYsIDBdLCBbNiwgMl0sIFs2LCA0XSwgWzYsIDZdLCBbNiwgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnlhbXkvY3liY3mlrnvvJpyPTUsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGZvcndhcmQ6IFtbNSwgMF0sIFs1LCAyXSwgWzUsIDRdLCBbNSwgNl0sIFs1LCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/h+ays+e6v++8mnI8PTQNCiAgICAgICAgICAgICAgICAgICAgY3Jvc3NlZFJpdmVyOiByIDw9IDQNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgDQogICAgICAgICAgICBjb25zdCBzb2xkaWVySW5mbyA9IHZhbGlkU29sZGllclBvc2l0aW9uc1tpc1JlZCA/ICdyZWQnIDogJ2JsYWNrJ107DQogICAgICAgICAgICBjb25zdCBpc0luaXRpYWxQb3MgPSBzb2xkaWVySW5mby5pbml0aWFsLnNvbWUocG9zID0+IHBvc1swXSA9PT0gciAmJiBwb3NbMV0gPT09IGMpOw0KICAgICAgICAgICAgY29uc3QgaXNGb3J3YXJkUG9zID0gc29sZGllckluZm8uZm9yd2FyZC5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKHNvbGRpZXJJbmZvLmNyb3NzZWRSaXZlcikgew0KICAgICAgICAgICAgICAgIC8vIOi/h+ays+WQjuaVjOaWueWNiuWcuumDveWQiOazlQ0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDov4fmsrPliY3lj6rog73lnKjlhbXkvY3lkozlhbXkvY3liY3mlrkNCiAgICAgICAgICAgICAgICByZXR1cm4gaXNJbml0aWFsUG9zIHx8IGlzRm9yd2FyZFBvczsNCiAgICAgICAgICAgIH0NCiAgICAgICAgZGVmYXVsdDoNCiAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgIH0NCn07DQoNCmNvbnN0IGNoZWNrR2FtZVN0YXRlID0gKGJvYXJkLCB0dXJuLCBwaWVjZXNJbmZvID0gbnVsbCwgYm9hcmRJbmZvID0gbnVsbCkgPT4gew0KICAgIC8vIOS8mOWFiOS9v+eUqOmihOiuoeeul+eahGdhbWVTdGF0ZQ0KICAgIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLmdhbWVTdGF0ZSkgew0KICAgICAgICByZXR1cm4gYm9hcmRJbmZvLmdhbWVTdGF0ZTsNCiAgICB9DQogICAgDQogICAgLy8g5rKh5pyJ6aKE6K6h566X57uT5p6c5pe277yM5omn6KGM5Y6f5aeL6K6h566XDQogICAgbGV0IGhhc01vdmVzID0gZmFsc2U7DQogICAgZm9yKGxldCByPTA7IHI8Uk9XUzsgcisrKSB7DQogICAgICAgIGZvcihsZXQgYz0wOyBjPENPTFM7IGMrKykgew0KICAgICAgICAgICAgaWYgKGJvYXJkW3JdW2NdPy5jb2xvciA9PT0gdHVybikgew0KICAgICAgICAgICAgICAgIGlmIChnZXRWYWxpZE1vdmVzKGJvYXJkLCB7cixjfSkubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgICAgICBoYXNNb3ZlcyA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoaGFzTW92ZXMpIGJyZWFrOw0KICAgIH0NCg0KICAgIGlmIChoYXNNb3ZlcykgcmV0dXJuIHsgc3RhdHVzOiAncGxheWluZycgfTsNCg0KICAgIGNvbnN0IGluQ2hlY2sgPSBpc0NoZWNrKGJvYXJkLCB0dXJuLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgIGNvbnN0IG9wcG9uZW50ID0gdHVybiA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgDQogICAgaWYgKGluQ2hlY2spIHsNCiAgICAgICAgcmV0dXJuIHsgc3RhdHVzOiAnY2hlY2ttYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgIH0gZWxzZSB7DQogICAgICAgIHJldHVybiB7IHN0YXR1czogJ3N0YWxlbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICB9DQp9Ow0KDQoNCg0KY29uc3QgZ2V0R2FtZVBoYXNlID0gKCkgPT4gew0KICByZXR1cm4gJ29wZW5pbmcnOw0KfTsNCg0KLy8g5a6e5L6L5YyWWm9icmlzdEhhc2hlcg0KY29uc3Qgem9icmlzdEhhc2hlciA9IG5ldyBab2JyaXN0SGFzaGVyKCk7DQoNCi8vIOe9ruaNouihqOWunueOsO+8iOWuuemHj+e6piAyXjIw77yM6YG/5YWNIE1hcCDov4flpKfmi5bmhaIgR0PvvIkNCmNvbnN0IFRUX0RFRkFVTFRfRVZJQ1RJT05fQkFUQ0ggPSAxMDI0OwoKY2xhc3MgVHJhbnNwb3NpdGlvblRhYmxlIHsKICAgIGNvbnN0cnVjdG9yKHNpemUgPSBNYXRoLnBvdygyLCAyMCksIGV2aWN0aW9uQmF0Y2ggPSBUVF9ERUZBVUxUX0VWSUNUSU9OX0JBVENIKSB7CiAgICAgICAgdGhpcy50YWJsZSA9IG5ldyBNYXAoKTsKICAgICAgICB0aGlzLnNpemUgPSBzaXplOwogICAgICAgIHRoaXMuZXZpY3Rpb25CYXRjaCA9IGV2aWN0aW9uQmF0Y2g7CiAgICAgICAgdGhpcy5oYXNoZXIgPSB6b2JyaXN0SGFzaGVyOw0KICAgICAgICAvLyDnu5/orqHkv6Hmga8NCiAgICAgICAgdGhpcy5zdGF0cyA9IHsNCiAgICAgICAgICAgIGhpdHM6IDAsDQogICAgICAgICAgICBtaXNzZXM6IDAsDQogICAgICAgICAgICBleGFjdEhpdHM6IDAsDQogICAgICAgICAgICBsb3dlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHVwcGVyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgc3RvcmVzOiAwLAogICAgICAgICAgICBscnVFdmljdGlvbnM6IDAsCiAgICAgICAgICAgIHVwZGF0ZWRTdG9yZXM6IDAsCiAgICAgICAgICAgIGV2aWN0aW9uQmF0Y2hlczogMCwKICAgICAgICAgICAgY2xlYXJzOiAwCiAgICAgICAgfTsKICAgIH0KCiAgICBzZXRFdmljdGlvbkJhdGNoKGJhdGNoKSB7CiAgICAgICAgdGhpcy5ldmljdGlvbkJhdGNoID0gTWF0aC5tYXgoMSwgYmF0Y2ggfCAwKTsKICAgIH0KICAgIA0KICAgIHN0b3JlKGtleSwgZGVwdGgsIHZhbHVlLCBmbGFnLCBiZXN0TW92ZSA9IG51bGwsIG1vdmVTZXF1ZW5jZSA9IG51bGwpIHsNCiAgICAgICAgaWYgKHRoaXMudGFibGUuc2l6ZSA+PSB0aGlzLnNpemUpIHsKICAgICAgICAgICAgaWYgKHRoaXMudGFibGUuaGFzKGtleSkpIHsKICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMudXBkYXRlZFN0b3JlcysrOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgY29uc3QgZHJvcENvdW50ID0gTWF0aC5taW4odGhpcy5ldmljdGlvbkJhdGNoLCB0aGlzLnRhYmxlLnNpemUpOwogICAgICAgICAgICAgICAgbGV0IGRyb3BwZWQgPSAwOwogICAgICAgICAgICAgICAgZm9yIChjb25zdCBvbGRlc3RLZXkgb2YgdGhpcy50YWJsZS5rZXlzKCkpIHsKICAgICAgICAgICAgICAgICAgICB0aGlzLnRhYmxlLmRlbGV0ZShvbGRlc3RLZXkpOwogICAgICAgICAgICAgICAgICAgIGlmICgrK2Ryb3BwZWQgPj0gZHJvcENvdW50KSBicmVhazsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMubHJ1RXZpY3Rpb25zICs9IGRyb3BwZWQ7CiAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLmV2aWN0aW9uQmF0Y2hlcysrOwogICAgICAgICAgICB9CiAgICAgICAgfQ0KICAgICAgICB0aGlzLnRhYmxlLnNldChrZXksIHsgZGVwdGgsIHZhbHVlLCBmbGFnLCBiZXN0TW92ZSwgbW92ZVNlcXVlbmNlIH0pOw0KICAgICAgICB0aGlzLnN0YXRzLnN0b3JlcysrOw0KICAgIH0NCiAgICANCiAgICByZXRyaWV2ZShrZXkpIHsNCiAgICAgICAgY29uc3QgZW50cnkgPSB0aGlzLnRhYmxlLmdldChrZXkpIHx8IG51bGw7DQogICAgICAgIGlmIChlbnRyeSkgew0KICAgICAgICAgICAgdGhpcy5zdGF0cy5oaXRzKys7DQogICAgICAgICAgICAvLyDnu5/orqHkuI3lkIznsbvlnovnmoTlkb3kuK0NCiAgICAgICAgICAgIHN3aXRjaCAoZW50cnkuZmxhZykgew0KICAgICAgICAgICAgICAgIGNhc2UgJ2V4YWN0JzoNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0cy5leGFjdEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgY2FzZSAnbG93ZXJib3VuZCc6DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMubG93ZXJib3VuZEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgY2FzZSAndXBwZXJib3VuZCc6DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMudXBwZXJib3VuZEhpdHMrKzsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICB0aGlzLnN0YXRzLm1pc3NlcysrOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBlbnRyeTsNCiAgICB9DQogICAgDQogICAgY2xlYXIoKSB7DQogICAgICAgIHRoaXMudGFibGUuY2xlYXIoKTsNCiAgICAgICAgdGhpcy5zdGF0cy5jbGVhcnMrKzsNCiAgICB9DQogICAgDQogICAgLy8g6I635Y+W57uf6K6h5L+h5oGv5bm26K6h566X5ZG95Lit546HDQogICAgZ2V0U3RhdHMoKSB7DQogICAgICAgIGNvbnN0IHRvdGFsQWNjZXNzZXMgPSB0aGlzLnN0YXRzLmhpdHMgKyB0aGlzLnN0YXRzLm1pc3NlczsNCiAgICAgICAgY29uc3QgaGl0UmF0ZSA9IHRvdGFsQWNjZXNzZXMgPiAwID8gKHRoaXMuc3RhdHMuaGl0cyAvIHRvdGFsQWNjZXNzZXMgKiAxMDApLnRvRml4ZWQoMikgOiAwOw0KICAgICAgICByZXR1cm4gewogICAgICAgICAgICAuLi50aGlzLnN0YXRzLAogICAgICAgICAgICBldmljdGlvbkJhdGNoOiB0aGlzLmV2aWN0aW9uQmF0Y2gsCiAgICAgICAgICAgIHRvdGFsQWNjZXNzZXMsCiAgICAgICAgICAgIGhpdFJhdGUsDQogICAgICAgICAgICBjdXJyZW50U2l6ZTogdGhpcy50YWJsZS5zaXplLA0KICAgICAgICAgICAgbWF4U2l6ZTogdGhpcy5zaXplLA0KICAgICAgICAgICAgZmlsbFBlcmNlbnRhZ2U6ICh0aGlzLnRhYmxlLnNpemUgLyB0aGlzLnNpemUgKiAxMDApLnRvRml4ZWQoMikNCiAgICAgICAgfTsNCiAgICB9DQogICAgDQogICAgLy8g6YeN572u57uf6K6h5L+h5oGvDQogICAgcmVzZXRTdGF0cygpIHsNCiAgICAgICAgdGhpcy5zdGF0cyA9IHsNCiAgICAgICAgICAgIGhpdHM6IDAsDQogICAgICAgICAgICBtaXNzZXM6IDAsDQogICAgICAgICAgICBleGFjdEhpdHM6IDAsDQogICAgICAgICAgICBsb3dlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHVwcGVyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgc3RvcmVzOiAwLAogICAgICAgICAgICBscnVFdmljdGlvbnM6IDAsCiAgICAgICAgICAgIHVwZGF0ZWRTdG9yZXM6IDAsCiAgICAgICAgICAgIGV2aWN0aW9uQmF0Y2hlczogMCwKICAgICAgICAgICAgY2xlYXJzOiAwCiAgICAgICAgfTsNCiAgICB9DQp9DQoNCi8vIOaAp+iDvee7n+iuoQ0KbGV0IHBlcmZTdGF0cyA9IHsNCiAgICBldmFsdWF0ZUJvYXJkQ291bnQ6IHsgcmVkOiAwLCBibGFjazogMCB9LA0KICAgIHByZXBhcmVTZWFyY2hJbmZvQ291bnQ6IHsgcmVkOiAwLCBibGFjazogMCB9LA0KICAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwNCiAgICBhbHBoYUJldGFDYWxsczogMCwgIC8vIOaAu+iwg+eUqOasoeaVsA0KICAgIG5vZGVzU2VhcmNoZWQ6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHmkJzntKLnmoToioLngrnmlbANCiAgICBtb3Zlc0dlbmVyYXRlZDoge30sIC8vIOaMiea3seW6pue7n+iuoeeUn+aIkOeahOi1sOazleaVsA0KICAgIGN1dG9mZnM6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHliarmnp3mrKHmlbANCiAgICAvLyDlkIjms5XmgKfot6/lvoTvvJrkvKrlkIjms5XnlJ/miJDph4/jgIHor5XotbDlkIjms5XmgKfmo4DmtYvjgIHpnZ7ms5Xot7Pov4fjgIHlrp7pmYXov5vlhaXmkJzntKLnmoTlkIjms5XnnYANCiAgICBwc2V1ZG9Nb3Zlc0dlbmVyYXRlZDogMCwNCiAgICBsZWdhbGl0eUNoZWNrczogMCwNCiAgICBpbGxlZ2FsTW92ZXNTa2lwcGVkOiAwLA0KICAgIGxlZ2FsTW92ZXNTZWFyY2hlZDogMCwNCiAgICAvLyBab2JyaXN077ya5YWo55uY6YeN566X5qyh5pWwIC8g5aKe6YeP5pu05paw5qyh5pWwIC8g5qCh6aqM5LiN5LiA6Ie077yI5LuFIHZlcmlmeSDmqKHlvI/vvIkNCiAgICBmdWxsSGFzaENvdW50OiAwLA0KICAgIGluY3JlbWVudGFsSGFzaFVwZGF0ZXM6IDAsDQogICAgaGFzaE1pc21hdGNoZXM6IDAsCiAgICBmYXN0TGVhZkV2YWxDb3VudDogMCwKICAgIGZhc3RMZWFmRXZhbE1zOiAwLAogICAgcHJlcGFyZUNoZWNrTXM6IDAsCiAgICBwcmVwYXJlTW92ZUdlbk1zOiAwLAogICAgc29ydE1vdmVzQ291bnQ6IDAsCiAgICBzb3J0TW92ZXNNczogMCwKICAgIGxlZ2FsaXR5Q2hlY2tNczogMCwKICAgIGNhcHR1cmVHZW5Db3VudDogMCwKICAgIGNhcHR1cmVHZW5NczogMCwKICAgIHF1aWVzY2VuY2VDYWxsczogMCwKICAgIHF1aWVzY2VuY2VDYXB0dXJlTW92ZXM6IDAsCiAgICBzdGF0aWNFdmFsQ2FjaGVIaXRzOiAwLAogICAgc3RhdGljRXZhbENhY2hlTWlzc2VzOiAwLAogICAgZXZhbHVhdGVCb2FyZE1zOiAwLAogICAgcHJlcGFyZVNlYXJjaEluZm9NczogMCwNCiAgICBzdGFydFRpbWU6IERhdGUubm93KCkNCn07DQoNCi8vIOmHjee9rue7n+iuoe+8iOavj+asoeaQnOe0ouW8gOWni+aXtuiwg+eUqO+8iQ0KY29uc3QgcmVzZXRQZXJmU3RhdHMgPSAoKSA9PiB7CiAgICBhY3RpdmVTZWFyY2hQaWVjZVN0YXRlID0gbnVsbDsKICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsNCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscyA9IDA7DQogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWQgPSB7fTsNCiAgICBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWQgPSB7fTsNCiAgICBwZXJmU3RhdHMuY3V0b2ZmcyA9IHt9Ow0KICAgIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCA9IDA7DQogICAgcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzID0gMDsNCiAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCA9IDA7DQogICAgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCA9IDA7DQogICAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQgPSAwOw0KICAgIHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzID0gMDsNCiAgICBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMgPSAwOwogICAgcGVyZlN0YXRzLmZhc3RMZWFmRXZhbENvdW50ID0gMDsKICAgIHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxNcyA9IDA7CiAgICBwZXJmU3RhdHMucHJlcGFyZUNoZWNrTXMgPSAwOwogICAgcGVyZlN0YXRzLnByZXBhcmVNb3ZlR2VuTXMgPSAwOwogICAgcGVyZlN0YXRzLnNvcnRNb3Zlc0NvdW50ID0gMDsKICAgIHBlcmZTdGF0cy5zb3J0TW92ZXNNcyA9IDA7CiAgICBwZXJmU3RhdHMubGVnYWxpdHlDaGVja01zID0gMDsKICAgIHBlcmZTdGF0cy5jYXB0dXJlR2VuQ291bnQgPSAwOwogICAgcGVyZlN0YXRzLmNhcHR1cmVHZW5NcyA9IDA7CiAgICBwZXJmU3RhdHMucXVpZXNjZW5jZUNhbGxzID0gMDsKICAgIHBlcmZTdGF0cy5xdWllc2NlbmNlQ2FwdHVyZU1vdmVzID0gMDsKICAgIHBlcmZTdGF0cy5zdGF0aWNFdmFsQ2FjaGVIaXRzID0gMDsKICAgIHBlcmZTdGF0cy5zdGF0aWNFdmFsQ2FjaGVNaXNzZXMgPSAwOwogICAgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcyA9IDA7CiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcyA9IDA7DQogICAgcGVyZlN0YXRzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7DQp9Ow0KDQpjb25zdCBzbmFwc2hvdFBlcmZTdGF0cyA9ICgpID0+IHsNCiAgICBjb25zdCBlbGFwc2VkID0gRGF0ZS5ub3coKSAtIHBlcmZTdGF0cy5zdGFydFRpbWU7DQogICAgY29uc3QgdHRTdGF0cyA9IHRyYW5zcG9zaXRpb25UYWJsZS5nZXRTdGF0cygpOw0KICAgIGNvbnN0IGRlcHRocyA9IE9iamVjdC5rZXlzKHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkKS5zb3J0KChhLCBiKSA9PiBOdW1iZXIoYSkgLSBOdW1iZXIoYikpOw0KICAgIGNvbnN0IGJ5RGVwdGggPSB7fTsNCiAgICBmb3IgKGNvbnN0IGQgb2YgZGVwdGhzKSB7DQogICAgICAgIGJ5RGVwdGhbZF0gPSB7DQogICAgICAgICAgICBub2RlczogcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0gfHwgMCwNCiAgICAgICAgICAgIG1vdmVzOiBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gfHwgMCwNCiAgICAgICAgICAgIGN1dG9mZnM6IHBlcmZTdGF0cy5jdXRvZmZzW2RdIHx8IDANCiAgICAgICAgfTsNCiAgICB9DQogICAgcmV0dXJuIHsNCiAgICAgICAgZWxhcHNlZE1zOiBlbGFwc2VkLA0KICAgICAgICBkZWZlckxlZ2FsaXR5OiBTRUFSQ0hfREVGRVJfTEVHQUxJVFksDQogICAgICAgIGluY3JlbWVudGFsWm9icmlzdDogU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QsDQogICAgICAgIGxlYWZBdHRhY2tCaXRzOiBTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUUywKICAgICAgICByZWxhdGlvbk1hc2tzOiBTRUFSQ0hfUkVMQVRJT05fTUFTS1MsCiAgICAgICAgZmFzdExlYWZSZWxhdGlvbnM6IFNFQVJDSF9GQVNUX0xFQUZfUkVMQVRJT05TLAogICAgICAgIGZhc3RTb3J0OiBTRUFSQ0hfRkFTVF9TT1JULAogICAgICAgIGZhc3RQc2V1ZG9Nb3ZlczogU0VBUkNIX0ZBU1RfUFNFVURPX01PVkVTLAogICAgICAgIG51bWVyaWNDaGVjazogU0VBUkNIX05VTUVSSUNfQ0hFQ0ssCiAgICAgICAgZmFzdFpvYnJpc3Q6IFNFQVJDSF9GQVNUX1pPQlJJU1QsCiAgICAgICAgcGllY2VMaXN0OiBTRUFSQ0hfUElFQ0VfTElTVCwKICAgICAgICBwcm9maWxlOiBTRUFSQ0hfUFJPRklMRSwKICAgICAgICBldmFsdWF0ZUJvYXJkOiB7IC4uLnBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgfSwNCiAgICAgICAgcHJlcGFyZVNlYXJjaEluZm86IHsgLi4ucGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnQgfSwNCiAgICAgICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzOiB7IC4uLnBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudCB9LA0KICAgICAgICBhbHBoYUJldGFDYWxsczogcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzLA0KICAgICAgICBwc2V1ZG9Nb3Zlc0dlbmVyYXRlZDogcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkLA0KICAgICAgICBsZWdhbGl0eUNoZWNrczogcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzLA0KICAgICAgICBpbGxlZ2FsTW92ZXNTa2lwcGVkOiBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCwNCiAgICAgICAgbGVnYWxNb3Zlc1NlYXJjaGVkOiBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkLA0KICAgICAgICBmdWxsSGFzaENvdW50OiBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCwNCiAgICAgICAgaW5jcmVtZW50YWxIYXNoVXBkYXRlczogcGVyZlN0YXRzLmluY3JlbWVudGFsSGFzaFVwZGF0ZXMsDQogICAgICAgIGhhc2hNaXNtYXRjaGVzOiBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMsCiAgICAgICAgZmFzdExlYWZFdmFsOiBTRUFSQ0hfRkFTVF9MRUFGX0VWQUwsCiAgICAgICAgZmFzdExlYWZFdmFsQ291bnQ6IHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxDb3VudCwKICAgICAgICBmYXN0TGVhZkV2YWxNczogcGVyZlN0YXRzLmZhc3RMZWFmRXZhbE1zLAogICAgICAgIHByZXBhcmVDaGVja01zOiBwZXJmU3RhdHMucHJlcGFyZUNoZWNrTXMsCiAgICAgICAgcHJlcGFyZU1vdmVHZW5NczogcGVyZlN0YXRzLnByZXBhcmVNb3ZlR2VuTXMsCiAgICAgICAgc29ydE1vdmVzQ291bnQ6IHBlcmZTdGF0cy5zb3J0TW92ZXNDb3VudCwKICAgICAgICBzb3J0TW92ZXNNczogcGVyZlN0YXRzLnNvcnRNb3Zlc01zLAogICAgICAgIGxlZ2FsaXR5Q2hlY2tNczogcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tNcywKICAgICAgICBjYXB0dXJlR2VuQ291bnQ6IHBlcmZTdGF0cy5jYXB0dXJlR2VuQ291bnQsCiAgICAgICAgY2FwdHVyZUdlbk1zOiBwZXJmU3RhdHMuY2FwdHVyZUdlbk1zLAogICAgICAgIHF1aWVzY2VuY2VDYWxsczogcGVyZlN0YXRzLnF1aWVzY2VuY2VDYWxscywKICAgICAgICBxdWllc2NlbmNlQ2FwdHVyZU1vdmVzOiBwZXJmU3RhdHMucXVpZXNjZW5jZUNhcHR1cmVNb3ZlcywKICAgICAgICBzdGF0aWNFdmFsQ2FjaGVIaXRzOiBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlSGl0cywKICAgICAgICBzdGF0aWNFdmFsQ2FjaGVNaXNzZXM6IHBlcmZTdGF0cy5zdGF0aWNFdmFsQ2FjaGVNaXNzZXMsCiAgICAgICAgZXZhbHVhdGVCb2FyZE1zOiBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zLAogICAgICAgIHByZXBhcmVTZWFyY2hJbmZvTXM6IHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zLA0KICAgICAgICB0dDogdHRTdGF0cywNCiAgICAgICAgYnlEZXB0aA0KICAgIH07DQp9Ow0KDQovLyDmiZPljbDnu5/orqHkv6Hmga8NCmNvbnN0IGxvZ1BlcmZTdGF0cyA9IChjdXJyZW50UGxheWVyKSA9PiB7DQogICAgY29uc3Qgc25hcCA9IHNuYXBzaG90UGVyZlN0YXRzKCk7DQogICAgY29uc29sZS5sb2coYPCfk4og5oCn6IO957uf6K6hICgke2N1cnJlbnRQbGF5ZXJ9KSAtICR7c25hcC5lbGFwc2VkTXN9bXM6YCk7DQogICAgY29uc29sZS5sb2coYCAgIGV2YWx1YXRlQm9hcmQ6IHJlZD0ke3NuYXAuZXZhbHVhdGVCb2FyZC5yZWR9LCBibGFjaz0ke3NuYXAuZXZhbHVhdGVCb2FyZC5ibGFja31gKTsNCiAgICBjb25zb2xlLmxvZyhgICAgcHJlcGFyZVNlYXJjaEluZm86IHJlZD0ke3NuYXAucHJlcGFyZVNlYXJjaEluZm8ucmVkfSwgYmxhY2s9JHtzbmFwLnByZXBhcmVTZWFyY2hJbmZvLmJsYWNrfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXM6IHJlZD0ke3NuYXAuY2FsY3VsYXRlVGhyZWF0VmFsdWVzLnJlZH0sIGJsYWNrPSR7c25hcC5jYWxjdWxhdGVUaHJlYXRWYWx1ZXMuYmxhY2t9YCk7DQogICAgY29uc29sZS5sb2coYCAgIGFscGhhQmV0Yeiwg+eUqOasoeaVsDogJHtzbmFwLmFscGhhQmV0YUNhbGxzfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICDlkIjms5XmgKc6IHBzZXVkbz0ke3NuYXAucHNldWRvTW92ZXNHZW5lcmF0ZWR9LCBjaGVja3M9JHtzbmFwLmxlZ2FsaXR5Q2hlY2tzfSwgaWxsZWdhbFNraXA9JHtzbmFwLmlsbGVnYWxNb3Zlc1NraXBwZWR9LCBsZWdhbFNlYXJjaGVkPSR7c25hcC5sZWdhbE1vdmVzU2VhcmNoZWR9YCk7DQogICAgY29uc29sZS5sb2coYCAgIFpvYnJpc3Q6IGluY3JlbWVudGFsPSR7c25hcC5pbmNyZW1lbnRhbFpvYnJpc3R9LCBmdWxsSGFzaD0ke3NuYXAuZnVsbEhhc2hDb3VudH0sIGluY3JVcGRhdGVzPSR7c25hcC5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzfSwgbWlzbWF0Y2hlcz0ke3NuYXAuaGFzaE1pc21hdGNoZXN9YCk7DQogICAgY29uc29sZS5sb2coYCAgIGxlYWZBdHRhY2tCaXRzPSR7c25hcC5sZWFmQXR0YWNrQml0c30gcmVsYXRpb25NYXNrcz0ke3NuYXAucmVsYXRpb25NYXNrc30gZmFzdExlYWZSZWxhdGlvbnM9JHtzbmFwLmZhc3RMZWFmUmVsYXRpb25zfSBwaWVjZUxpc3Q9JHtzbmFwLnBpZWNlTGlzdH0gZnVsbEV2YWxNcz0ke01hdGgucm91bmQoc25hcC5ldmFsdWF0ZUJvYXJkTXMpfSBmYXN0TGVhZk1zPSR7TWF0aC5yb3VuZChzbmFwLmZhc3RMZWFmRXZhbE1zKX0gZmFzdExlYWZDb3VudD0ke3NuYXAuZmFzdExlYWZFdmFsQ291bnR9IHByZXBhcmVNcz0ke01hdGgucm91bmQoc25hcC5wcmVwYXJlU2VhcmNoSW5mb01zKX1gKTsKICAgIGlmIChzbmFwLnByb2ZpbGUpIHsKICAgICAgICBjb25zb2xlLmxvZyhgICAgUHJvZmlsZSAob3ZlcmxhcHBpbmcgc2NvcGVzKTogcHJlcENoZWNrPSR7TWF0aC5yb3VuZChzbmFwLnByZXBhcmVDaGVja01zKX1tcyBwcmVwTW92ZXM9JHtNYXRoLnJvdW5kKHNuYXAucHJlcGFyZU1vdmVHZW5Ncyl9bXMgc29ydD0ke01hdGgucm91bmQoc25hcC5zb3J0TW92ZXNNcyl9bXMvJHtzbmFwLnNvcnRNb3Zlc0NvdW50fSBsZWdhbGl0eT0ke01hdGgucm91bmQoc25hcC5sZWdhbGl0eUNoZWNrTXMpfW1zIGNhcHR1cmVHZW49JHtNYXRoLnJvdW5kKHNuYXAuY2FwdHVyZUdlbk1zKX1tcy8ke3NuYXAuY2FwdHVyZUdlbkNvdW50fSBxcz0ke3NuYXAucXVpZXNjZW5jZUNhbGxzfSBjYXB0dXJlTW92ZXM9JHtzbmFwLnF1aWVzY2VuY2VDYXB0dXJlTW92ZXN9IGV2YWxDYWNoZT0ke3NuYXAuc3RhdGljRXZhbENhY2hlSGl0c30vJHtzbmFwLnN0YXRpY0V2YWxDYWNoZU1pc3Nlc31gKTsKICAgIH0KICAgIGNvbnNvbGUubG9nKGAgICBUVDogaGl0cz0ke3NuYXAudHQuaGl0c30sIG1pc3Nlcz0ke3NuYXAudHQubWlzc2VzfSwgaGl0UmF0ZT0ke3NuYXAudHQuaGl0UmF0ZX0lLCBzdG9yZXM9JHtzbmFwLnR0LnN0b3Jlc30sIHVwZGF0ZXM9JHtzbmFwLnR0LnVwZGF0ZWRTdG9yZXN9LCBldmljdGVkPSR7c25hcC50dC5scnVFdmljdGlvbnN9LyR7c25hcC50dC5ldmljdGlvbkJhdGNoZXN9IGJhdGNoZXM9JHtzbmFwLnR0LmV2aWN0aW9uQmF0Y2h9LCBzaXplPSR7c25hcC50dC5jdXJyZW50U2l6ZX1gKTsKICAgIA0KICAgIGNvbnN0IGRlcHRocyA9IE9iamVjdC5rZXlzKHNuYXAuYnlEZXB0aCk7DQogICAgaWYgKGRlcHRocy5sZW5ndGggPiAwKSB7DQogICAgICAgIGNvbnNvbGUubG9nKCcgICDmjInmt7Hluqbnu5/orqE6Jyk7DQogICAgICAgIGZvciAoY29uc3QgZCBvZiBkZXB0aHMpIHsNCiAgICAgICAgICAgIGNvbnN0IHJvdyA9IHNuYXAuYnlEZXB0aFtkXTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICAgIOa3seW6piR7ZH06IOiKgueCuT0ke3Jvdy5ub2Rlc30sIOi1sOazlT0ke3Jvdy5tb3Zlc30sIOWJquaenT0ke3Jvdy5jdXRvZmZzfWApOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KY29uc3QgdHJhbnNwb3NpdGlvblRhYmxlID0gbmV3IFRyYW5zcG9zaXRpb25UYWJsZSgpOw0KDQovLyDlj7bor4TkvLDnvJPlrZjvvIjlrozmlbTlvaLlir/liIbvvInvvJvmr4/mrKEgZ2V0QmVzdE1vdmUg5riF56m6DQpjb25zdCBFVkFMX0NBQ0hFX01BWCA9IE1hdGgucG93KDIsIDE4KTsKY29uc3QgZXZhbENhY2hlID0gbmV3IE1hcCgpOwpjb25zdCBjbGVhckV2YWxDYWNoZSA9ICgpID0+IHsKICAgIGV2YWxDYWNoZS5jbGVhcigpOwp9OwoNCi8vIOWJquaeneW8gOWFs++8muWujOaVtOivhOS8sOS4i+iLpeW8gOWxgOWHuuW6n+aji+WImeWFiOWFs++8jOS/neaji+WKm+WGjemHjeagh+Wumg0KY29uc3QgU0VBUkNIX0VOQUJMRV9OTVAgPSBmYWxzZTsNCmNvbnN0IFNFQVJDSF9FTkFCTEVfTE1SID0gZmFsc2U7DQoNCi8vIOedgOazleWQiOazleaAp++8mnRydWU95pCc57Si5YaF6K+V6LWw5pe25qOA5rWL77yI5Y+v6Lez6L+H5Ymq5p6d5pyq6Kem5Y+K552A5rOV77yJ77ybZmFsc2U9cHJlcGFyZSDml7blhajph48gZmlsdGVyTGVnYWxNb3Zlc++8iOaXp+i3r+W+hO+8iQ0KbGV0IFNFQVJDSF9ERUZFUl9MRUdBTElUWSA9IHRydWU7DQpsZXQgU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA9IHRydWU7DQoNCi8vIFpvYnJpc3QvVFTvvJp0cnVlPeaQnOe0ouWGheWinumHj+e7tOaKpOWxgOmdouWTiOW4jCArIOaVsOWAvCBUVCBrZXnvvJtmYWxzZT3mr4/oioLngrnlhajnm5ggaGFzaCArIOWtl+espuS4siBrZXnvvIjml6fot6/lvoTvvIzkvr/kuo4gQS9C77yJDQpsZXQgU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QgPSB0cnVlOw0KLy8g6LCD6K+V77ya5aKe6YeP5ZCO5LiO5YWo55uYIGhhc2gg5q+U5a+577yI5LuF5qCh6aqM6ISa5pys5byA5ZCv77yM5q2j5byP5pCc57Si5YWz6Zet77yJDQpsZXQgU0VBUkNIX1pPQlJJU1RfVkVSSUZZID0gZmFsc2U7DQoNCi8vIOaQnOe0ouWQr+WPke+8muadgOaji+ihqCArIOWOhuWPsuWQr+WPke+8iOavj+asoSBnZXRCZXN0TW92ZSDph43nva7vvIkNCmxldCBraWxsZXJNb3ZlcyA9IFtdOw0KbGV0IGhpc3RvcnlUYWJsZSA9IG51bGw7DQoNCmNvbnN0IHJlc2V0U2VhcmNoSGV1cmlzdGljcyA9IChtYXhEZXB0aCkgPT4gew0KICAgIGtpbGxlck1vdmVzID0gQXJyYXkobWF4RGVwdGggKyAyKS5maWxsKG51bGwpLm1hcCgoKSA9PiBbbnVsbCwgbnVsbF0pOw0KICAgIGhpc3RvcnlUYWJsZSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDEwIH0sICgpID0+DQogICAgICAgIEFycmF5LmZyb20oeyBsZW5ndGg6IDkgfSwgKCkgPT4NCiAgICAgICAgICAgIEFycmF5LmZyb20oeyBsZW5ndGg6IDEwIH0sICgpID0+IEFycmF5KDkpLmZpbGwoMCkpDQogICAgICAgICkNCiAgICApOw0KfTsNCg0KY29uc3QgaXNTYW1lTW92ZSA9IChhLCBiKSA9Pg0KICAgIGEgIT0gbnVsbCAmJiBiICE9IG51bGwgJiYNCiAgICBtb3ZlRnJvbVNxKGEpID09PSBtb3ZlRnJvbVNxKGIpICYmDQogICAgbW92ZVRvU3EoYSkgPT09IG1vdmVUb1NxKGIpOw0KDQpjb25zdCBzdG9yZUtpbGxlck1vdmUgPSAoZGVwdGgsIG1vdmUpID0+IHsNCiAgICBpZiAoZGVwdGggPCAwIHx8IGRlcHRoID49IGtpbGxlck1vdmVzLmxlbmd0aCB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGNvbnN0IHNsb3QgPSBraWxsZXJNb3Zlc1tkZXB0aF07DQogICAgaWYgKGlzU2FtZU1vdmUoc2xvdFswXSwgbW92ZSkpIHJldHVybjsNCiAgICBzbG90WzFdID0gc2xvdFswXTsNCiAgICBzbG90WzBdID0gaXNFbmNvZGVkTW92ZShtb3ZlKSA/IG1vdmUgOiBlbmNvZGVNb3ZlKG1vdmUuZnJvbSwgbW92ZS50byk7DQp9Ow0KDQpjb25zdCBhZGRIaXN0b3J5U2NvcmUgPSAobW92ZSwgZGVwdGgpID0+IHsNCiAgICBpZiAoIWhpc3RvcnlUYWJsZSB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGhpc3RvcnlUYWJsZVttb3ZlRnJvbVIobW92ZSldW21vdmVGcm9tQyhtb3ZlKV1bbW92ZVRvUihtb3ZlKV1bbW92ZVRvQyhtb3ZlKV0gKz0gZGVwdGggKiBkZXB0aDsNCn07DQoNCmNvbnN0IGdldEhpc3RvcnlTY29yZSA9IChtb3ZlKSA9PiB7DQogICAgaWYgKCFoaXN0b3J5VGFibGUgfHwgIW1vdmUpIHJldHVybiAwOw0KICAgIHJldHVybiBoaXN0b3J5VGFibGVbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldW21vdmVUb1IobW92ZSldW21vdmVUb0MobW92ZSldIHx8IDA7DQp9Ow0KDQovLyBXb3JrZXIgbWVzc2FnZSBoYW5kbGluZw0KaWYgKHR5cGVvZiBzZWxmICE9PSAndW5kZWZpbmVkJykgew0KICAgIHNlbGYub25tZXNzYWdlID0gZnVuY3Rpb24oZSkgew0KICAgIGNvbnN0IHsgdHlwZSwgcGF5bG9hZCB9ID0gZS5kYXRhOw0KICAgIA0KICAgIHN3aXRjaCAodHlwZSkgeyAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdTRUFSQ0gnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBzZWFyY2hCb2FyZCwgdHVybjogc2VhcmNoVHVybiwgZGVwdGg6IHNlYXJjaERlcHRoLCBnYW1lSWQsIG9wZW5pbmdCb29rRW5hYmxlZDogc2VhcmNoT3BlbmluZ0Jvb2tFbmFibGVkID0gdHJ1ZSwgcGx5OiBzZWFyY2hQbHkgPSAwLCBlbmFibGVUaW1lTGltaXQ6IHNlYXJjaEVuYWJsZVRpbWVMaW1pdCA9IGZhbHNlLCBleGFjdFJvb3RTY29yZXM6IHNlYXJjaEV4YWN0Um9vdFNjb3JlcyA9IGZhbHNlLCBkZWZlckxlZ2FsaXR5OiBzZWFyY2hEZWZlckxlZ2FsaXR5LCBpbmNyZW1lbnRhbFpvYnJpc3Q6IHNlYXJjaEluY3JlbWVudGFsWm9icmlzdCwgbGVhZkF0dGFja0JpdHM6IHNlYXJjaExlYWZBdHRhY2tCaXRzLCByZWxhdGlvbk1hc2tzOiBzZWFyY2hSZWxhdGlvbk1hc2tzLCBmYXN0TGVhZkV2YWw6IHNlYXJjaEZhc3RMZWFmRXZhbCwgZmFzdExlYWZSZWxhdGlvbnM6IHNlYXJjaEZhc3RMZWFmUmVsYXRpb25zLCBmYXN0U29ydDogc2VhcmNoRmFzdFNvcnQsIGZhc3RQc2V1ZG9Nb3Zlczogc2VhcmNoRmFzdFBzZXVkb01vdmVzLCBudW1lcmljQ2hlY2s6IHNlYXJjaE51bWVyaWNDaGVjaywgZmFzdFpvYnJpc3Q6IHNlYXJjaEZhc3Rab2JyaXN0LCBwaWVjZUxpc3Q6IHNlYXJjaFBpZWNlTGlzdCwgdHRFdmljdGlvbkJhdGNoOiBzZWFyY2hUVEV2aWN0aW9uQmF0Y2gsIHByb2ZpbGU6IHNlYXJjaFByb2ZpbGUsIHpvYnJpc3RWZXJpZnk6IHNlYXJjaFpvYnJpc3RWZXJpZnksIGNvbGxlY3RNb3ZlU2VxdWVuY2U6IHNlYXJjaENvbGxlY3RNb3ZlU2VxdWVuY2UgfSA9IHBheWxvYWQ7CiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoRGVmZXJMZWdhbGl0eSA9PT0gJ2Jvb2xlYW4nKSB7DQogICAgICAgICAgICAgICAgU0VBUkNIX0RFRkVSX0xFR0FMSVRZID0gc2VhcmNoRGVmZXJMZWdhbGl0eTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoSW5jcmVtZW50YWxab2JyaXN0ID09PSAnYm9vbGVhbicpIHsNCiAgICAgICAgICAgICAgICBTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCA9IHNlYXJjaEluY3JlbWVudGFsWm9icmlzdDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoTGVhZkF0dGFja0JpdHMgPT09ICdib29sZWFuJykgew0KICAgICAgICAgICAgICAgIFNFQVJDSF9MRUFGX0FUVEFDS19CSVRTID0gc2VhcmNoTGVhZkF0dGFja0JpdHM7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaFJlbGF0aW9uTWFza3MgPT09ICdib29sZWFuJykgewogICAgICAgICAgICAgICAgU0VBUkNIX1JFTEFUSU9OX01BU0tTID0gc2VhcmNoUmVsYXRpb25NYXNrczsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaEZhc3RMZWFmRXZhbCA9PT0gJ2Jvb2xlYW4nKSB7CiAgICAgICAgICAgICAgICBTRUFSQ0hfRkFTVF9MRUFGX0VWQUwgPSBzZWFyY2hGYXN0TGVhZkV2YWw7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgaWYgKHR5cGVvZiBzZWFyY2hGYXN0TGVhZlJlbGF0aW9ucyA9PT0gJ2Jvb2xlYW4nKSB7CiAgICAgICAgICAgICAgICBTRUFSQ0hfRkFTVF9MRUFGX1JFTEFUSU9OUyA9IHNlYXJjaEZhc3RMZWFmUmVsYXRpb25zOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoRmFzdFNvcnQgPT09ICdib29sZWFuJykgewogICAgICAgICAgICAgICAgU0VBUkNIX0ZBU1RfU09SVCA9IHNlYXJjaEZhc3RTb3J0OwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoRmFzdFBzZXVkb01vdmVzID09PSAnYm9vbGVhbicpIHsKICAgICAgICAgICAgICAgIFNFQVJDSF9GQVNUX1BTRVVET19NT1ZFUyA9IHNlYXJjaEZhc3RQc2V1ZG9Nb3ZlczsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaE51bWVyaWNDaGVjayA9PT0gJ2Jvb2xlYW4nKSB7CiAgICAgICAgICAgICAgICBTRUFSQ0hfTlVNRVJJQ19DSEVDSyA9IHNlYXJjaE51bWVyaWNDaGVjazsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaEZhc3Rab2JyaXN0ID09PSAnYm9vbGVhbicpIHsKICAgICAgICAgICAgICAgIFNFQVJDSF9GQVNUX1pPQlJJU1QgPSBzZWFyY2hGYXN0Wm9icmlzdDsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaFBpZWNlTGlzdCA9PT0gJ2Jvb2xlYW4nKSB7CiAgICAgICAgICAgICAgICBTRUFSQ0hfUElFQ0VfTElTVCA9IHNlYXJjaFBpZWNlTGlzdDsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaFRURXZpY3Rpb25CYXRjaCA9PT0gJ251bWJlcicpIHsKICAgICAgICAgICAgICAgIHRyYW5zcG9zaXRpb25UYWJsZS5zZXRFdmljdGlvbkJhdGNoKHNlYXJjaFRURXZpY3Rpb25CYXRjaCk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgU0VBUkNIX1BST0ZJTEUgPSAhIXNlYXJjaFByb2ZpbGU7CiAgICAgICAgICAgIFNFQVJDSF9aT0JSSVNUX1ZFUklGWSA9ICEhc2VhcmNoWm9icmlzdFZlcmlmeTsNCiAgICAgICAgICAgIC8vIFNldCBvcGVuaW5nIGJvb2sgZW5hYmxlZCBzdGF0dXMNCiAgICAgICAgICAgIG9wZW5pbmdCb29rLnNldEVuYWJsZWQoc2VhcmNoT3BlbmluZ0Jvb2tFbmFibGVkKTsNCiAgICAgICAgICAgIC8vIOiusOW9leaQnOe0ouW8gOWni+aXtumXtA0KICAgICAgICAgICAgY29uc3Qgc3RhcnRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCk7DQogICAgICAgICAgICAvLyDmiafooYzmkJzntKINCiAgICAgICAgICAgIGNvbnN0IGJlc3RTZWFyY2hNb3ZlID0gZ2V0QmVzdE1vdmUoc2VhcmNoQm9hcmQsIHNlYXJjaFR1cm4sIHNlYXJjaERlcHRoLCBzZWFyY2hQbHksIHNlYXJjaEVuYWJsZVRpbWVMaW1pdCwgc2VhcmNoRXhhY3RSb290U2NvcmVzLCBzZWFyY2hDb2xsZWN0TW92ZVNlcXVlbmNlKTsNCiAgICAgICAgICAgIC8vIOiusOW9leaQnOe0oue7k+adn+aXtumXtOW5tuiuoeeul+aAneiAg+aXtumXtA0KICAgICAgICAgICAgY29uc3QgZW5kVGltZSA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgICAgICAgICAgY29uc3QgdGhpbmtpbmdUaW1lID0gZW5kVGltZSAtIHN0YXJ0VGltZTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5qOA5p+l5piv5ZCm5p2l6Ieq5byA5bGA5bqTDQogICAgICAgICAgICBjb25zdCBib29rTW92ZVNlYXJjaCA9IG9wZW5pbmdCb29rLmdldEJvb2tNb3ZlKHNlYXJjaEJvYXJkLCBzZWFyY2hQbHkpOw0KICAgICAgICAgICAgY29uc3QgZnJvbUJvb2tTZWFyY2ggPSAhIWJvb2tNb3ZlU2VhcmNoICYmIEpTT04uc3RyaW5naWZ5KGJvb2tNb3ZlU2VhcmNoKSA9PT0gSlNPTi5zdHJpbmdpZnkoYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmUpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmt7vliqDmgKfog73nu5/orqHml6Xlv5cNCiAgICAgICAgICAgIGxvZ1BlcmZTdGF0cyhzZWFyY2hUdXJuKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5re75Yqg5oCd6ICD5pe26Ze05pel5b+XDQogICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VhcmNoIGNvbXBsZXRlZCBpbiAke01hdGgucm91bmQodGhpbmtpbmdUaW1lKX1tcywgZ2FtZUlkPSR7Z2FtZUlkfSwgYmVzdE1vdmU9JHtKU09OLnN0cmluZ2lmeShiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSl9LCBzZWNvbmRCZXN0TW92ZT0ke0pTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlKX0sIGZyb21Cb29rPSR7ZnJvbUJvb2tTZWFyY2h9YCk7DQogICAgICAgICAgICAvLyDlj5HpgIHmkJzntKLnu5PmnpzlkozmgJ3ogIPml7bpl7QNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnU0VBUkNIX0NPTVBMRVRFJywgDQogICAgICAgICAgICAgICAgcGF5bG9hZDogeyANCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmU6IGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlLCANCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kQmVzdE1vdmU6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlLCANCiAgICAgICAgICAgICAgICAgICAgZ2FtZUlkLCANCiAgICAgICAgICAgICAgICAgICAgZnJvbUJvb2s6IGZyb21Cb29rU2VhcmNoLCANCiAgICAgICAgICAgICAgICAgICAgdGhpbmtpbmdUaW1lOiBNYXRoLnJvdW5kKHRoaW5raW5nVGltZSksIC8vIOWbm+iIjeS6lOWFpeWIsOavq+enkg0KICAgICAgICAgICAgICAgICAgICBtb3ZlU2VxdWVuY2U6IGJlc3RTZWFyY2hNb3ZlLm1vdmVTZXF1ZW5jZSwNCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kTW92ZVNlcXVlbmNlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRNb3ZlU2VxdWVuY2UsDQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2NvcmU6IGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlU2NvcmUsDQogICAgICAgICAgICAgICAgICAgIHNlY29uZEJlc3RNb3ZlU2NvcmU6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlU2NvcmUsDQogICAgICAgICAgICAgICAgICAgIGFsbE1vdmVzV2l0aFNjb3JlczogYmVzdFNlYXJjaE1vdmUuYWxsTW92ZXNXaXRoU2NvcmVzIHx8IFtdLA0KICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWREZXB0aDogYmVzdFNlYXJjaE1vdmUuY29tcGxldGVkRGVwdGgsDQogICAgICAgICAgICAgICAgICAgIHBlcmY6IHNuYXBzaG90UGVyZlN0YXRzKCkNCiAgICAgICAgICAgICAgICB9IA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBjYXNlICdnZXRWYWxpZE1vdmVzJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogdm1Cb2FyZCwgcG9zOiB2bVBvcyB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIHN5bmNHZW5lcmFsUG9zQ2FjaGUodm1Cb2FyZCk7DQogICAgICAgICAgICBjb25zdCB2YWxpZE1vdmVzID0gZ2V0VmFsaWRNb3Zlcyh2bUJvYXJkLCB2bVBvcyk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAndmFsaWRNb3ZlcycsDQogICAgICAgICAgICAgICAgbW92ZXM6IHZhbGlkTW92ZXMNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdnZXRQaWVjZVJlbGF0aW9ucyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHByQm9hcmQsIHBvczogcHJQb3MgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IHByQm9hcmRbcHJQb3Mucl1bcHJQb3MuY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOiwg+eUqGV2YWx1YXRlQm9hcmTojrflj5blrozmlbTnmoTmo4vlrZDkv6Hmga/lkoxib2FyZEluZm8NCiAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7DQogICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkRXZhbHVhdGlvbiA9IGV2YWx1YXRlQm9hcmQocHJCb2FyZCwgbnVsbCwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlc0luZm8gPSBib2FyZEV2YWx1YXRpb24ucGllY2VzSW5mbzsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5ib2FyZEluZm87DQoNCiAgICAgICAgICAgIGlmIChib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcykgew0KICAgICAgICAgICAgICAgIGh5ZHJhdGVSZWxhdGlvbnNGcm9tTWFza3MocGllY2VzSW5mbywgYm9hcmRJbmZvKTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gYm9hcmRJbmZvIOagvOWGheWPr+iDveaYryBwaWVjZXNJbmZvIOW8leeUqO+8jOe7n+S4gOaYoOWwhOS4uiB7cixjfSDkvpsgVUkg5L2/55SoDQogICAgICAgICAgICBjb25zdCByYXdDb250cm9sbGVycyA9IGJvYXJkSW5mby5jb250cm9sbGVyR3JpZA0KICAgICAgICAgICAgICAgID8gKGJvYXJkSW5mby5jb250cm9sbGVyR3JpZFtwclBvcy5yXVtwclBvcy5jXSB8fCBbXSkNCiAgICAgICAgICAgICAgICA6IChib2FyZEluZm9bcHJQb3Mucl0gJiYgYm9hcmRJbmZvW3ByUG9zLnJdW3ByUG9zLmNdKSB8fCBbXTsNCiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJzID0gcmF3Q29udHJvbGxlcnMubWFwKChjdHJsKSA9PiAoeyByOiBjdHJsLnIsIGM6IGN0cmwuYyB9KSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGxldCByZWxhdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgdGhyZWF0OiBbXSwgDQogICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwgDQogICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLCANCiAgICAgICAgICAgICAgICBndWFyZGVkQnk6IFtdLCANCiAgICAgICAgICAgICAgICBjb250cm9sOiBbXSwNCiAgICAgICAgICAgICAgICBjb250cm9sbGVycw0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5aaC5p6c54K55Ye755qE5piv5qOL5a2Q77yM6L+U5Zue6K+l5qOL5a2Q55qE5YWz57O75L+h5oGvDQogICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBjdXJyZW50IHBpZWNlIGluZm8NCiAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50UGllY2VJbmZvID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSBwclBvcy5yICYmIHAuYyA9PT0gcHJQb3MuYyk7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRQaWVjZUluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gRXh0cmFjdCByZWxhdGlvbnMNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGhyZWF0ID0gY3VycmVudFBpZWNlSW5mby50aHJlYXQubWFwKHRocmVhdFBpZWNlID0+ICh7IHI6IHRocmVhdFBpZWNlLnIsIGM6IHRocmVhdFBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0aHJlYXRlbmVkQnkgPSBjdXJyZW50UGllY2VJbmZvLnRocmVhdGVuZWRCeS5tYXAodGhyZWF0ZW5lZEJ5UGllY2UgPT4gKHsgcjogdGhyZWF0ZW5lZEJ5UGllY2UuciwgYzogdGhyZWF0ZW5lZEJ5UGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGd1YXJkID0gY3VycmVudFBpZWNlSW5mby5ndWFyZC5tYXAoZ3VhcmRQaWVjZSA9PiAoeyByOiBndWFyZFBpZWNlLnIsIGM6IGd1YXJkUGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGd1YXJkZWRCeSA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmRlZEJ5Lm1hcChndWFyZGVkQnlQaWVjZSA9PiAoeyByOiBndWFyZGVkQnlQaWVjZS5yLCBjOiBndWFyZGVkQnlQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udHJvbCA9IChjdXJyZW50UGllY2VJbmZvLmNvbnRyb2wgfHwgW10pLm1hcChjb250cm9sUG9zID0+ICh7IHI6IGNvbnRyb2xQb3MuciwgYzogY29udHJvbFBvcy5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIHJlbGF0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdCwgDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnksIA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmQsIA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRlZEJ5LCANCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRyb2wsDQogICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sbGVycw0KICAgICAgICAgICAgICAgICAgICB9Ow0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlUmVsYXRpb25zJywNCiAgICAgICAgICAgICAgICByZWxhdGlvbnM6IHJlbGF0aW9ucw0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2NoZWNrR2FtZVN0YXRlJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogY2dzQm9hcmQsIHR1cm46IGNnc1R1cm4sIHJlcXVlc3RJZCB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGNoZWNrR2FtZVN0YXRlKGNnc0JvYXJkLCBjZ3NUdXJuKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdnYW1lU3RhdGUnLA0KICAgICAgICAgICAgICAgIHN0YXRlOiBnYW1lU3RhdGUsDQogICAgICAgICAgICAgICAgcmVxdWVzdElkDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnZXZhbHVhdGVCb2FyZCc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGV2YWxCb2FyZCwgdHVybjogZXZhbFR1cm4gfSA9IHBheWxvYWQ7DQogICAgICAgICAgICAvLyDmiZPljbDmjqXmlLbnmoTlj4LmlbANCiAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7DQogICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCiAgICAgICAgICAgIGNvbnN0IGRldGFpbGVkRXZhbCA9IGV2YWx1YXRlQm9hcmQoZXZhbEJvYXJkLCBldmFsVHVybiwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdkZXRhaWxlZEV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IGRldGFpbGVkRXZhbA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KDQogICAgICAgIGNhc2UgJ2V2YWx1YXRlUGllY2UnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBwaWVjZUV2YWxCb2FyZCwgcG9zOiBwaWVjZUV2YWxQb3MsIHR1cm4gfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IHBpZWNlRXZhbEJvYXJkW3BpZWNlRXZhbFBvcy5yXVtwaWVjZUV2YWxQb3MuY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghcGllY2UpIHsNCiAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMA0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g5Li75Yqo6LCD55SoZXZhbHVhdGVCb2FyZOiOt+WPluWujOaVtOeahOivhOS8sOS/oeaBrw0KICAgICAgICAgICAgICAgIC8vIOiOt+WPluW9k+WJjea4uOaIj+mYtuautQ0KICAgICAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7DQogICAgICAgICAgICAgICAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQogICAgICAgICAgICBjb25zdCBib2FyZEV2YWx1YXRpb24gPSBldmFsdWF0ZUJvYXJkKHBpZWNlRXZhbEJvYXJkLCB0dXJuLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIOS7jmV2YWx1YXRlQm9hcmTnmoTov5Tlm57lgLzkuK3mib7liLDlvZPliY3mo4vlrZDnmoTkv6Hmga8NCiAgICAgICAgICAgICAgICBjdXJyZW50UGllY2VJbmZvID0gYm9hcmRFdmFsdWF0aW9uLnBpZWNlc0luZm8uZmluZCgNCiAgICAgICAgICAgICAgICAgICAgcCA9PiBwLnIgPT09IHBpZWNlRXZhbFBvcy5yICYmIHAuYyA9PT0gcGllY2VFdmFsUG9zLmMNCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGllY2VJbmZvKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOW6lOeUqOadg+mHjeW5tui/lOWbnuWNleS4quaji+WtkOeahOivhOS8sOWAvA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBldmFsdWF0aW9uID0gew0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IGN1cnJlbnRQaWVjZUluZm8ubWF0ZXJpYWxWYWx1ZSAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogY3VycmVudFBpZWNlSW5mby5wb3NpdGlvblZhbHVlICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiBjdXJyZW50UGllY2VJbmZvLm1vYmlsaXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiBjdXJyZW50UGllY2VJbmZvLnRocmVhdFZhbHVlICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IGN1cnJlbnRQaWVjZUluZm8uc2FmZXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogY3VycmVudFBpZWNlSW5mby50YWN0aWNWYWx1ZSAqIFZBTFVFX1dFSUdIVFMudGFjdGljDQogICAgICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZXZhbHVhdGlvbg0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDlpoLmnpzku43nhLbmib7kuI3liLDmo4vlrZDkv6Hmga/vvIzov5Tlm57pu5jorqTlgLwNCiAgICAgICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMA0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnaXNDaGVjayc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGNCb2FyZCwgY29sb3I6IGNDb2xvciwgcmVxdWVzdElkIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgc3luY0dlbmVyYWxQb3NDYWNoZShjQm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2soY0JvYXJkLCBjQ29sb3IpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2NoZWNrJywNCiAgICAgICAgICAgICAgICBpc0NoZWNrOiBpbkNoZWNrLA0KICAgICAgICAgICAgICAgIHJlcXVlc3RJZA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2lzVmFsaWRQbGFjZW1lbnQnOiB7DQogICAgICAgICAgICBjb25zdCB7IHR5cGU6IGlwVHlwZSwgY29sb3I6IGlwQ29sb3IsIHIsIGMgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCB2YWxpZFBsYWNlbWVudCA9IGlzVmFsaWRQbGFjZW1lbnQoaXBUeXBlLCBpcENvbG9yLCByLCBjKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICd2YWxpZFBsYWNlbWVudCcsDQogICAgICAgICAgICAgICAgaXNWYWxpZDogdmFsaWRQbGFjZW1lbnQNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcnOiB7DQogICAgICAgICAgICBjb25zdCB7IG1vdmVzLCB3ZWlnaHRzIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgLy8gQWRkIHRoZSBvcGVuaW5nIGxpbmUgdG8gdGhlIG9wZW5pbmcgYm9vaw0KICAgICAgICAgICAgb3BlbmluZ0Jvb2suYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKFttb3Zlc10sIHdlaWdodHMpOw0KICAgICAgICAgICAgLy8gU2VuZCBjb25maXJtYXRpb24NCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnb3BlbmluZ0xpbmVBZGRlZCcsIA0KICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUgDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnbW92ZXNUb05vdGF0aW9uJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5IH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3Qgbm90YXRpb24gPSBvcGVuaW5nQm9vay5tb3Zlc1RvTm90YXRpb24oYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ25vdGF0aW9uJywgDQogICAgICAgICAgICAgICAgbm90YXRpb246IG5vdGF0aW9uIA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ25vdGF0aW9uVG9Nb3Zlcyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgbm90YXRpb246IG5vdGF0aW9uU3RyaW5nLCBpbml0aWFsQm9hcmQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBtb3Zlc0Zyb21Ob3RhdGlvbiA9IG9wZW5pbmdCb29rLm5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvblN0cmluZywgaW5pdGlhbEJvYXJkKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnbW92ZXMnLCANCiAgICAgICAgICAgICAgICBtb3ZlczogbW92ZXNGcm9tTm90YXRpb24gDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnc2V0VmFsdWVXZWlnaHRzJzogew0KICAgICAgICAgICAgVkFMVUVfV0VJR0hUUyA9IHsgLi4uVkFMVUVfV0VJR0hUUywgLi4ucGF5bG9hZCB9Ow0KICAgICAgICAgICAgY29uc29sZS5sb2coJ1VwZGF0ZWQgVkFMVUVfV0VJR0hUUzonLCBWQUxVRV9XRUlHSFRTKTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KICAgIC8vIE92ZXJyaWRlIGNvbnNvbGUubG9nIHRvIHNlbmQgbWVzc2FnZXMgYmFjayB0byBtYWluIHRocmVhZA0KICAgIGNvbnN0IG9yaWdpbmFsQ29uc29sZUxvZyA9IGNvbnNvbGUubG9nOw0KICAgIGNvbnNvbGUubG9nID0gZnVuY3Rpb24oLi4uYXJncykgew0KICAgICAgICAvLyBTZW5kIHRvIG1haW4gdGhyZWFkDQogICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgdHlwZTogJ2xvZycsDQogICAgICAgICAgICBkYXRhOiBhcmdzLmpvaW4oJyAnKQ0KICAgICAgICB9KTsNCiAgICAgICAgDQogICAgICAgIC8vIEFsc28gbG9nIHRvIHdvcmtlciBjb25zb2xlDQogICAgICAgIG9yaWdpbmFsQ29uc29sZUxvZy5hcHBseShjb25zb2xlLCBhcmdzKTsNCiAgICB9Ow0KfQ0KDQovLyDnqbrnnYDliarmnp3vvJrmnInov5vmlLvlrZDlipvml7bmiY3lhYHorrjvvIjpgb/lhY3lsIYv5aOrL+ixoeaui+WxgOmAvOedgOivr+WJqu+8iQ0KY29uc3QgY2FuRG9OdWxsTW92ZSA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKCFwIHx8IHAuY29sb3IgIT09IGNvbG9yKSBjb250aW51ZTsNCiAgICAgICAgICAgIGlmIChwLnR5cGUgPT09ICdjaGFyaW90JyB8fCBwLnR5cGUgPT09ICdob3JzZScgfHwgcC50eXBlID09PSAnY2Fubm9uJyB8fCBwLnR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiBmYWxzZTsNCn07DQoNCi8vIOaQnOe0oueUqCBUVCBrZXnvvJrlop7ph4/mqKHlvI/kuLogbnVtYmVy77yM5pen5qih5byP5Li6IGAke2hhc2h9OiR7c2lkZX1gIOWtl+espuS4sg0KY29uc3QgbWFrZVNlYXJjaFRUS2V5ID0gKGJvYXJkLCBjdXJyZW50UGxheWVyLCBib2FyZEhhc2gpID0+IHsNCiAgICBpZiAoU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QpIHsNCiAgICAgICAgcmV0dXJuIHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChib2FyZEhhc2gsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIH0NCiAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOw0KICAgIHJldHVybiBgJHt6b2JyaXN0SGFzaGVyLmhhc2goYm9hcmQpfToke2N1cnJlbnRQbGF5ZXJ9YDsNCn07DQoNCi8vIOi1sOWtkOWQjueahOWtkOiKgueCueWxgOmdouWTiOW4jO+8iOS7heWinumHj+aooeW8j+acieaEj+S5ie+8m+mhu+WcqCBtYWtlIOWJjeS/neWtmCBtb3ZpbmdQaWVjZe+8iQ0KY29uc3QgY2hpbGRCb2FyZEhhc2ggPSAoYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpID0+IHsKICAgIGlmICghU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QpIHJldHVybiBib2FyZEhhc2g7CiAgICBwZXJmU3RhdHMuaW5jcmVtZW50YWxIYXNoVXBkYXRlcysrOwogICAgaWYgKGlzRW5jb2RlZE1vdmUobW92ZSkpIHsKICAgICAgICBsZXQgbmV3SGFzaCA9IGJvYXJkSGFzaDsKICAgICAgICBjb25zdCBtb3ZpbmdJZHggPSB6b2JyaXN0SGFzaGVyLnBpZWNlSW5kZXgobW92aW5nUGllY2UpOwogICAgICAgIGNvbnN0IGZyb20gPSBtb3ZlID4+PiA3Ow0KICAgICAgICBjb25zdCB0byA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7DQogICAgICAgIGlmIChtb3ZpbmdJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgbmV3SGFzaCBePSB6b2JyaXN0SGFzaGVyLmhhc2hUYWJsZVsoZnJvbSAvIDkpIHwgMF1bZnJvbSAlIDldW21vdmluZ0lkeF07DQogICAgICAgICAgICBuZXdIYXNoIF49IHpvYnJpc3RIYXNoZXIuaGFzaFRhYmxlWyh0byAvIDkpIHwgMF1bdG8gJSA5XVttb3ZpbmdJZHhdOw0KICAgICAgICB9DQogICAgICAgIGlmIChjYXB0dXJlZCkgew0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRJZHggPSB6b2JyaXN0SGFzaGVyLnBpZWNlSW5kZXgoY2FwdHVyZWQpOw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICBuZXdIYXNoIF49IHpvYnJpc3RIYXNoZXIuaGFzaFRhYmxlWyh0byAvIDkpIHwgMF1bdG8gJSA5XVtjYXB0dXJlZElkeF07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIG5ld0hhc2g7DQogICAgfQ0KICAgIHJldHVybiB6b2JyaXN0SGFzaGVyLnVwZGF0ZUhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOw0KfTsNCg0KY29uc3QgdmVyaWZ5Qm9hcmRIYXNoID0gKGJvYXJkLCBleHBlY3RlZEhhc2gpID0+IHsNCiAgICBpZiAoIVNFQVJDSF9aT0JSSVNUX1ZFUklGWSkgcmV0dXJuOw0KICAgIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50Kys7DQogICAgY29uc3QgZnVsbCA9IHpvYnJpc3RIYXNoZXIuaGFzaChib2FyZCk7DQogICAgaWYgKGZ1bGwgIT09IGV4cGVjdGVkSGFzaCkgew0KICAgICAgICBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMrKzsNCiAgICB9DQp9Ow0KDQovLyDmkJzntKLnlKjlh4DliIbvvJrlrozmlbTlvaLlir/or4TkvLDvvIjlhbPns7sv5aiB6IOBL+WuieWFqC/mnLrliqjvvInvvIzku4Xot7Pov4fnu4jlsYDnnYDms5XmnprkuL7vvJvluKYgWm9icmlzdCDnvJPlrZgNCmNvbnN0IHN0YXRpY1NlYXJjaEV2YWwgPSAoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBib2FyZEhhc2ggPSAwKSA9PiB7DQogICAgbGV0IGNhY2hlS2V5Ow0KICAgIGlmIChTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCkgew0KICAgICAgICBjYWNoZUtleSA9IHpvYnJpc3RIYXNoZXIuZXZhbENhY2hlS2V5RnJvbUhhc2goYm9hcmRIYXNoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSk7DQogICAgfSBlbHNlIHsNCiAgICAgICAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsNCiAgICAgICAgY2FjaGVLZXkgPSB6b2JyaXN0SGFzaGVyLmV2YWxDYWNoZUtleShib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpOw0KICAgIH0NCiAgICBpZiAoZXZhbENhY2hlLmhhcyhjYWNoZUtleSkpIHsKICAgICAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5zdGF0aWNFdmFsQ2FjaGVIaXRzKys7CiAgICAgICAgcmV0dXJuIGV2YWxDYWNoZS5nZXQoY2FjaGVLZXkpOwogICAgfQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlTWlzc2VzKys7CiAgICBsZXQgbmV0OwogICAgaWYgKFNFQVJDSF9GQVNUX0xFQUZfRVZBTCAmJiAhU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgewogICAgICAgIG5ldCA9IGV2YWx1YXRlU2VhcmNoTGVhZkZhc3QoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsKICAgIH0gZWxzZSB7CiAgICAgICAgY29uc3QgZXZhbFJlc3VsdCA9IGV2YWx1YXRlQm9hcmQoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB7IGZvclNlYXJjaExlYWY6IHRydWUgfSk7CiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBzZWFyY2hJbml0aWF0b3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgIG5ldCA9IGV2YWxSZXN1bHRbc2VhcmNoSW5pdGlhdG9yXS50b3RhbCAtIGV2YWxSZXN1bHRbb3Bwb25lbnRdLnRvdGFsOwogICAgfQogICAgaWYgKGV2YWxDYWNoZS5zaXplID49IEVWQUxfQ0FDSEVfTUFYKSB7CiAgICAgICAgLy8g566A5Y2V5reY5rGw5pyA5pep5YaZ5YWl55qE5LiA5om577yM6YG/5YWNIE1hcCDml6DpmZDmtqgNCiAgICAgICAgbGV0IGRyb3AgPSAwOw0KICAgICAgICBmb3IgKGNvbnN0IGsgb2YgZXZhbENhY2hlLmtleXMoKSkgew0KICAgICAgICAgICAgZXZhbENhY2hlLmRlbGV0ZShrKTsNCiAgICAgICAgICAgIGlmICgrK2Ryb3AgPj0gNDA5NikgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQogICAgZXZhbENhY2hlLnNldChjYWNoZUtleSwgbmV0KTsKICAgIHJldHVybiBuZXQ7DQp9Ow0KDQovLyDnlJ/miJDlvZPliY3mlrnlkIPlrZDnnYDvvIjkvpvpnZnpu5jmkJzntKLvvIkNCmNvbnN0IGdlbmVyYXRlQ2FwdHVyZXNGb3JTZWFyY2ggPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIpID0+IHsKICAgIGNvbnN0IF9fdDAgPSBTRUFSQ0hfUFJPRklMRSA/IHBlcmZvcm1hbmNlLm5vdygpIDogMDsKICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLmNhcHR1cmVHZW5Db3VudCsrOwogICAgY29uc3QgY2FwdHVyZXMgPSBbXTsKICAgIGNvbnN0IGRlZmVyID0gU0VBUkNIX0RFRkVSX0xFR0FMSVRZOwogICAgY29uc3QgcGllY2VTdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOwogICAgaWYgKHBpZWNlU3RhdGUgJiYgU0VBUkNIX0ZBU1RfUFNFVURPX01PVkVTICYmIGRlZmVyKSB7CiAgICAgICAgY29uc3QgcmVjb3JkcyA9IHBpZWNlU3RhdGUucmVjb3JkczsKICAgICAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsKICAgICAgICBjb25zdCBzcXVhcmVDb2RlcyA9IHBpZWNlU3RhdGUuc3F1YXJlQ29kZXM7CiAgICAgICAgY29uc3QgcGllY2VDb2RlcyA9IHBpZWNlU3RhdGUucGllY2VDb2RlczsKICAgICAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsKICAgICAgICAgICAgY29uc3Qgc2xvdCA9IHNxdWFyZVRvU2xvdFtzcV07CiAgICAgICAgICAgIGlmIChzbG90IDwgMCkgY29udGludWU7CiAgICAgICAgICAgIGNvbnN0IHJlY29yZCA9IHJlY29yZHNbc2xvdF07CiAgICAgICAgICAgIGlmICghcmVjb3JkLmFsaXZlIHx8IHJlY29yZC5waWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7CiAgICAgICAgICAgIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCArPSBhcHBlbmRTZWFyY2hQc2V1ZG9Nb3Zlc0ZvclBpZWNlKAogICAgICAgICAgICAgICAgY2FwdHVyZXMsIHNxLCBwaWVjZUNvZGVzW3Nsb3RdLCBzcXVhcmVDb2RlcywgdHJ1ZQogICAgICAgICAgICApOwogICAgICAgIH0KICAgICAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5jYXB0dXJlR2VuTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOwogICAgICAgIHJldHVybiBjYXB0dXJlczsKICAgIH0KICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7CiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsKICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsKICAgICAgICAgICAgaWYgKCFwaWVjZSB8fCBwaWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7CiAgICAgICAgICAgIGNvbnN0IGZyb20gPSB7IHIsIGMgfTsKICAgICAgICAgICAgY29uc3QgcHNldWRvID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UpOwogICAgICAgICAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgKz0gcHNldWRvLmxlbmd0aDsKICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IHBzZXVkbyA6IGZpbHRlckxlZ2FsTW92ZXMoYm9hcmQsIGZyb20sIHBpZWNlLCBwc2V1ZG8pOwogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHVzZU1vdmVzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICBjb25zdCB0byA9IHVzZU1vdmVzW2ldOwogICAgICAgICAgICAgICAgaWYgKGJvYXJkW3RvLnJdW3RvLmNdKSBjYXB0dXJlcy5wdXNoKGVuY29kZU1vdmVGcm9tQ29vcmRzKHIsIGMsIHRvLnIsIHRvLmMpKTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLmNhcHR1cmVHZW5NcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7CiAgICByZXR1cm4gY2FwdHVyZXM7Cn07Cg0KLy8g6Z2Z6buY5pCc57Si77yac3RhbmQtcGF0IOeUqOWujOaVtOW9ouWKv+ivhOS8sO+8m+S7heWvueWQg+WtkOW7tuS8uO+8iFFT4omkM++8iQ0KY29uc3QgcXVpZXNjZW5jZSA9ICgNCiAgICBiLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwNCiAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgcXNEZXB0aCwgYm9hcmRIYXNoID0gMA0KKSA9PiB7CiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5xdWllc2NlbmNlQ2FsbHMrKzsKICAgIGNvbnN0IHN0YW5kUGF0ID0gc3RhdGljU2VhcmNoRXZhbChiLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRIYXNoKTsNCg0KICAgIGlmIChxc0RlcHRoIDw9IDApIHsNCiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KDQogICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0ID49IGJldGEpIHsNCiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICB9DQogICAgICAgIGlmIChzdGFuZFBhdCA+IGFscGhhKSB7DQogICAgICAgICAgICBhbHBoYSA9IHN0YW5kUGF0Ow0KICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0IDw9IGFscGhhKSB7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoc3RhbmRQYXQgPCBiZXRhKSB7DQogICAgICAgICAgICBiZXRhID0gc3RhbmRQYXQ7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBsZXQgY2FwdHVyZXMgPSBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoKGIsIGN1cnJlbnRQbGF5ZXIpOwogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMucXVpZXNjZW5jZUNhcHR1cmVNb3ZlcyArPSBjYXB0dXJlcy5sZW5ndGg7CiAgICBpZiAoY2FwdHVyZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgIH0NCg0KICAgIC8vIE1WVi1MVkHvvJrlhYjor5XlkIPlpKflrZANCiAgICBjYXB0dXJlcy5zb3J0KChhLCBiTW92ZSkgPT4gew0KICAgICAgICBjb25zdCBzY29yZUEgPQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW21vdmVUb1IoYSldW21vdmVUb0MoYSldLCBnYW1lU3RhZ2UpICogMTYgLQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW21vdmVGcm9tUihhKV1bbW92ZUZyb21DKGEpXSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgY29uc3Qgc2NvcmVCID0NCiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYlttb3ZlVG9SKGJNb3ZlKV1bbW92ZVRvQyhiTW92ZSldLCBnYW1lU3RhZ2UpICogMTYgLQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW21vdmVGcm9tUihiTW92ZSldW21vdmVGcm9tQyhiTW92ZSldLCBnYW1lU3RhZ2UpOw0KICAgICAgICByZXR1cm4gc2NvcmVCIC0gc2NvcmVBOw0KICAgIH0pOw0KDQogICAgbGV0IGJlc3RFdmFsID0gc3RhbmRQYXQ7DQogICAgbGV0IGJlc3RNb3ZlU2VxdWVuY2UgPSBbXTsNCiAgICBjb25zdCBkZWZlciA9IFNFQVJDSF9ERUZFUl9MRUdBTElUWTsNCg0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY2FwdHVyZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgbW92ZSA9IGNhcHR1cmVzW2ldOw0KICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldOw0KICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUpOw0KICAgICAgICBpZiAoZGVmZXIgJiYgbGVhdmVzT3duS2luZ1Vuc2FmZShiLCBjdXJyZW50UGxheWVyKSkgew0KICAgICAgICAgICAgdW5tYWtlU2VhcmNoTW92ZShiLCBtb3ZlLCBjYXB0dXJlZCk7DQogICAgICAgICAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCsrOw0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCiAgICAgICAgY29uc3QgbmV4dEhhc2ggPSBjaGlsZEJvYXJkSGFzaChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7DQogICAgICAgIHZlcmlmeUJvYXJkSGFzaChiLCBuZXh0SGFzaCk7DQogICAgICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQrKzsNCiAgICAgICAgY29uc3QgbmV4dFBsYXllciA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBjb25zdCBuZXh0TWF4aW1pemluZyA9IG5leHRQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgY29uc3QgcmVzdWx0ID0gcXVpZXNjZW5jZSgNCiAgICAgICAgICAgIGIsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBxc0RlcHRoIC0gMSwgbmV4dEhhc2gNCiAgICAgICAgKTsNCiAgICAgICAgdW5tYWtlU2VhcmNoTW92ZShiLCBtb3ZlLCBjYXB0dXJlZCk7DQoNCiAgICAgICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPiBiZXN0RXZhbCkgew0KICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFKSB7DQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZVRvT2JqZWN0KG1vdmUpLCAuLi4ocmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPiBhbHBoYSkgew0KICAgICAgICAgICAgICAgIGFscGhhID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA8IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsNCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlVG9PYmplY3QobW92ZSksIC4uLihyZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA8IGJldGEpIHsNCiAgICAgICAgICAgICAgICBiZXRhID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmIChiZXRhIDw9IGFscGhhKSB7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIHJldHVybiB7IHZhbHVlOiBiZXN0RXZhbCwgbW92ZVNlcXVlbmNlOiBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFID8gYmVzdE1vdmVTZXF1ZW5jZSA6IFtdIH07DQp9Ow0KDQovLyBhbHBoYUJldGHvvJror4TkvLDlp4vnu4jku44gc2VhcmNoSW5pdGlhdG9yIOinkuW6pu+8m1RUICsga2lsbGVyL2hpc3RvcnkgKyDnqbrnnYDliarmnp0gKyBMTVIgKyBRUw0KLy8gYm9hcmRIYXNo77ya5aKe6YePIFpvYnJpc3Qg5bGA6Z2i5ZOI5biM77yI5LiN5ZCr6KGM5qOL5pa577yJ77yb5pen5qih5byP5LiL5Y+v5LygIDANCmNvbnN0IGFscGhhQmV0YSA9ICgNCiAgICBiLCBkLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwNCiAgICBzZWFyY2hEZXB0aCA9IDAsIHNlYXJjaEluaXRpYXRvciA9IGN1cnJlbnRQbGF5ZXIsIGdhbWVTdGFnZSA9ICdtaWQnLA0KICAgIGFsbG93TnVsbCA9IHRydWUsIGJvYXJkSGFzaCA9IDANCikgPT4gew0KICAgIGNvbnN0IG9yaWdpbmFsQWxwaGEgPSBhbHBoYTsNCiAgICBjb25zdCBvcmlnaW5hbEJldGEgPSBiZXRhOw0KDQogICAgcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzKys7DQogICAgaWYgKCFwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSkgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0gPSAwOw0KICAgIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKys7DQoNCiAgICAvLyDlj7boioLngrnvvJrlrozmlbTlvaLlir/or4TkvLAgKyDlkIPlrZDpnZnpu5jmkJzntKLvvIhRU+KJpDPvvIkNCiAgICBpZiAoZCA9PT0gMCkgew0KICAgICAgICByZXR1cm4gcXVpZXNjZW5jZSgNCiAgICAgICAgICAgIGIsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLA0KICAgICAgICAgICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIDMsIGJvYXJkSGFzaA0KICAgICAgICApOw0KICAgIH0NCg0KICAgIC8vIOe9ruaNouihqOaOoua1i++8iGtleSDlkKvooYzmo4vmlrnvvIzpgb/lhY3lkIzlvaLkuI3lkIzotbDmlrnlhrLnqoHvvIkNCiAgICBjb25zdCB0dEtleSA9IG1ha2VTZWFyY2hUVEtleShiLCBjdXJyZW50UGxheWVyLCBib2FyZEhhc2gpOw0KICAgIGNvbnN0IHR0RW50cnkgPSB0cmFuc3Bvc2l0aW9uVGFibGUucmV0cmlldmUodHRLZXkpOw0KICAgIGxldCB0dE1vdmUgPSBudWxsOw0KICAgIGlmICh0dEVudHJ5KSB7DQogICAgICAgIHR0TW92ZSA9IHR0RW50cnkuYmVzdE1vdmUgfHwgbnVsbDsNCiAgICAgICAgaWYgKHR0RW50cnkuZGVwdGggPj0gZCkgew0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ2V4YWN0Jykgew0KICAgICAgICAgICAgICAgIHJldHVybiB7DQogICAgICAgICAgICAgICAgICAgIHZhbHVlOiB0dEVudHJ5LnZhbHVlLA0KICAgICAgICAgICAgICAgICAgICBtb3ZlU2VxdWVuY2U6IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UNCiAgICAgICAgICAgICAgICAgICAgICAgID8gKHR0RW50cnkubW92ZVNlcXVlbmNlIHx8ICh0dE1vdmUgPyBbbW92ZVRvT2JqZWN0KHR0TW92ZSldIDogW10pKQ0KICAgICAgICAgICAgICAgICAgICAgICAgOiBbXQ0KICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnbG93ZXJib3VuZCcgJiYgdHRFbnRyeS52YWx1ZSA+PSBiZXRhKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHR0RW50cnkudmFsdWUsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICd1cHBlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlIDw9IGFscGhhKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHR0RW50cnkudmFsdWUsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGNvbnN0IHNlYXJjaEluZm8gPSBwcmVwYXJlU2VhcmNoSW5mbyhiLCBjdXJyZW50UGxheWVyKTsNCiAgICBjb25zdCBhYlBpZWNlc0luZm8gPSBzZWFyY2hJbmZvLnBpZWNlc0luZm87DQogICAgY29uc3QgYWJCb2FyZEluZm8gPSBzZWFyY2hJbmZvLmJvYXJkSW5mbzsNCiAgICBjb25zdCBjdXJyZW50UGxheWVyQ29sb3IgPSBjdXJyZW50UGxheWVyOw0KICAgIGNvbnN0IGluQ2hlY2sgPSBzZWFyY2hJbmZvLmluQ2hlY2sgfHwNCiAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ3JlZCcgJiYgYWJCb2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fA0KICAgICAgICAgICAgICAgICAgICAoY3VycmVudFBsYXllckNvbG9yID09PSAnYmxhY2snICYmIGFiQm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKTsNCg0KICAgIGNvbnN0IHRlcm1pbmFsU2NvcmUgPSAobWF0ZUluQ2hlY2spID0+IHsNCiAgICAgICAgY29uc3QgaXNJbml0aWF0b3JXaW5uZXIgPSBjdXJyZW50UGxheWVyQ29sb3IgIT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgY29uc3QgYmFzZVNjb3JlID0gaXNJbml0aWF0b3JXaW5uZXIgPyAxMDAwMDAgOiAtMTAwMDAwOw0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgdmFsdWU6IGJhc2VTY29yZSArIChpc0luaXRpYXRvcldpbm5lciA/IGQgOiAoc2VhcmNoRGVwdGggLSBkKSksDQogICAgICAgICAgICBtb3ZlU2VxdWVuY2U6IFtdLA0KICAgICAgICAgICAgdGVybWluYWw6IG1hdGVJbkNoZWNrID8gJ2NoZWNrbWF0ZScgOiAnc3RhbGVtYXRlJw0KICAgICAgICB9Ow0KICAgIH07DQoNCiAgICAvLyDml6DkvKrlkIjms5XnnYDvvJrnm7TmjqXnu4jlsYDvvIjmnoHlsJHop4HvvJvpgJrluLjoh7PlsJHmnInlsIbnmoTotbDliqjvvIkNCiAgICBpZiAoIXNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdCB8fCBzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3QubGVuZ3RoID09PSAwKSB7DQogICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGFiQm9hcmRJbmZvLmdhbWVTdGF0ZTsNCiAgICAgICAgaWYgKGdhbWVTdGF0ZSAmJiAoZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ2NoZWNrbWF0ZScgfHwgZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ3N0YWxlbWF0ZScpKSB7DQogICAgICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGdhbWVTdGF0ZS53aW5uZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgICAgIGNvbnN0IGJhc2VTY29yZSA9IGlzSW5pdGlhdG9yV2lubmVyID8gMTAwMDAwIDogLTEwMDAwMDsNCiAgICAgICAgICAgIGNvbnN0IHN0ZXBzRnJvbVJvb3QgPSBzZWFyY2hEZXB0aCAtIGQ7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogYmFzZVNjb3JlICsgKGlzSW5pdGlhdG9yV2lubmVyID8gZCA6IHN0ZXBzRnJvbVJvb3QpLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIHRlcm1pbmFsU2NvcmUoaW5DaGVjayk7DQogICAgfQ0KDQogICAgLy8g56m6552A5Ymq5p6d77ya5LuFIG1heGltaXppbmfvvJvlrozmlbTor4TkvLDkuIvkv53lrojlkK/nlKgNCiAgICBpZiAoDQogICAgICAgIFNFQVJDSF9FTkFCTEVfTk1QICYmDQogICAgICAgIGFsbG93TnVsbCAmJg0KICAgICAgICBtYXhpbWl6aW5nICYmDQogICAgICAgIGQgPj0gMyAmJg0KICAgICAgICAhaW5DaGVjayAmJg0KICAgICAgICBjYW5Eb051bGxNb3ZlKGIsIGN1cnJlbnRQbGF5ZXJDb2xvcikNCiAgICApIHsNCiAgICAgICAgY29uc3QgbnVsbFIgPSBkID49IDYgPyAzIDogMjsNCiAgICAgICAgY29uc3QgbnVsbERlcHRoID0gZCAtIDEgLSBudWxsUjsNCiAgICAgICAgaWYgKG51bGxEZXB0aCA+PSAwKSB7DQogICAgICAgICAgICBjb25zdCBudWxsUGxheWVyID0gY3VycmVudFBsYXllckNvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgICAgIGNvbnN0IG51bGxNYXhpbWl6aW5nID0gbnVsbFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICAgICAgLy8g56m6552A5LiN5pS55Y+Y5bGA6Z2i5ZOI5biM77yM5LuF6KGM5qOL5pa55Y+Y5YyW77yIVFQga2V5IOWQqyBzaWRl77yJDQogICAgICAgICAgICBjb25zdCBudWxsUmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgICAgIGIsIG51bGxEZXB0aCwgYmV0YSAtIDFlLTYsIGJldGEsIG51bGxNYXhpbWl6aW5nLCBudWxsUGxheWVyLA0KICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgZmFsc2UsIGJvYXJkSGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIGlmIChudWxsUmVzdWx0LnZhbHVlID49IGJldGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogbnVsbFJlc3VsdC52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgbGV0IG1vdmVzID0gc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0Ow0KDQogICAgaWYgKCFwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0pIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSA9IDA7DQogICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdICs9IG1vdmVzLmxlbmd0aDsNCg0KICAgIGNvbnN0IGtpbGxlcnNBdERlcHRoID0gKGtpbGxlck1vdmVzW2RdIHx8IFtudWxsLCBudWxsXSk7DQogICAgbW92ZXMgPSBzb3J0TW92ZXNGYXN0KG1vdmVzLCBiLCBjdXJyZW50UGxheWVyQ29sb3IsIGFiUGllY2VzSW5mbywgZ2FtZVN0YWdlLCBhYkJvYXJkSW5mbywgew0KICAgICAgICB0dE1vdmUsDQogICAgICAgIGtpbGxlcnM6IGtpbGxlcnNBdERlcHRoDQogICAgfSk7DQoNCiAgICBjb25zdCBzdG9yZVRUID0gKHZhbHVlLCBiZXN0TW92ZSwgbW92ZVNlcXVlbmNlKSA9PiB7DQogICAgICAgIGxldCBmbGFnOw0KICAgICAgICBpZiAodmFsdWUgPD0gb3JpZ2luYWxBbHBoYSkgZmxhZyA9ICd1cHBlcmJvdW5kJzsNCiAgICAgICAgZWxzZSBpZiAodmFsdWUgPj0gb3JpZ2luYWxCZXRhKSBmbGFnID0gJ2xvd2VyYm91bmQnOw0KICAgICAgICBlbHNlIGZsYWcgPSAnZXhhY3QnOw0KICAgICAgICB0cmFuc3Bvc2l0aW9uVGFibGUuc3RvcmUodHRLZXksIGQsIHZhbHVlLCBmbGFnLCBiZXN0TW92ZSwgU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA/IG1vdmVTZXF1ZW5jZSA6IG51bGwpOw0KICAgIH07DQoNCiAgICBsZXQgYmVzdEV2YWwgPSBtYXhpbWl6aW5nID8gLUluZmluaXR5IDogSW5maW5pdHk7DQogICAgbGV0IGJlc3RNb3ZlID0gbnVsbDsNCiAgICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOw0KICAgIGxldCBsZWdhbE1vdmVzRm91bmQgPSAwOw0KDQogICAgZm9yIChsZXQgbW92ZUluZGV4ID0gMDsgbW92ZUluZGV4IDwgbW92ZXMubGVuZ3RoOyBtb3ZlSW5kZXgrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbbW92ZUluZGV4XTsNCiAgICAgICAgY29uc3QgaXNDYXB0dXJlID0gISFiW21vdmVUb1IobW92ZSldW21vdmVUb0MobW92ZSldOw0KICAgICAgICBjb25zdCBpc1RUTW92ZSA9IHR0TW92ZSAmJiBpc1NhbWVNb3ZlKG1vdmUsIHR0TW92ZSk7DQogICAgICAgIGNvbnN0IGlzS2lsbGVyID0NCiAgICAgICAgICAgIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc0F0RGVwdGhbMF0pIHx8DQogICAgICAgICAgICBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNBdERlcHRoWzFdKTsNCg0KICAgICAgICAvLyBMTVLvvJrpnaDlkI7nmoTlronpnZnnnYDms5XpmY3mt7EgMe+8iOWujOaVtOivhOS8sOS4i+S/neWuiO+8iQ0KICAgICAgICAvLyBtb3ZlSW5kZXgg5ZCr5Lyq5ZCI5rOV5bqP77yb6Z2e5rOV552A6Lez6L+H5ZCO55Wl5YGP5L+d5a6I77yI5bCR6ZmN5rex77yJ77yM5LiN5b2x5ZON5q2j56Gu5oCnDQogICAgICAgIGxldCByZWR1Y3Rpb24gPSAwOw0KICAgICAgICBpZiAoDQogICAgICAgICAgICBTRUFSQ0hfRU5BQkxFX0xNUiAmJg0KICAgICAgICAgICAgZCA+PSA0ICYmDQogICAgICAgICAgICBtb3ZlSW5kZXggPj0gNCAmJg0KICAgICAgICAgICAgIWluQ2hlY2sgJiYNCiAgICAgICAgICAgICFpc0NhcHR1cmUgJiYNCiAgICAgICAgICAgICFpc1RUTW92ZSAmJg0KICAgICAgICAgICAgIWlzS2lsbGVyDQogICAgICAgICkgew0KICAgICAgICAgICAgcmVkdWN0aW9uID0gMTsNCiAgICAgICAgfQ0KDQogICAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYlttb3ZlRnJvbVIobW92ZSldW21vdmVGcm9tQyhtb3ZlKV07DQogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZVNlYXJjaE1vdmUoYiwgbW92ZSk7DQogICAgICAgIGlmIChTRUFSQ0hfREVGRVJfTEVHQUxJVFkgJiYgbGVhdmVzT3duS2luZ1Vuc2FmZShiLCBjdXJyZW50UGxheWVyQ29sb3IpKSB7DQogICAgICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkKys7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgICAgdmVyaWZ5Qm9hcmRIYXNoKGIsIG5leHRIYXNoKTsNCiAgICAgICAgbGVnYWxNb3Zlc0ZvdW5kKys7DQogICAgICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQrKzsNCg0KICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KDQogICAgICAgIGxldCByZXN1bHQ7DQogICAgICAgIGlmIChyZWR1Y3Rpb24gPiAwKSB7DQogICAgICAgICAgICBjb25zdCByZWR1Y2VkRGVwdGggPSBNYXRoLm1heCgwLCBkIC0gMSAtIHJlZHVjdGlvbik7DQogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgcmVkdWNlZERlcHRoLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIGNvbnN0IG5lZWRSZXNlYXJjaCA9IG1heGltaXppbmcNCiAgICAgICAgICAgICAgICA/IHJlc3VsdC52YWx1ZSA+IGFscGhhDQogICAgICAgICAgICAgICAgOiByZXN1bHQudmFsdWUgPCBiZXRhOw0KICAgICAgICAgICAgaWYgKG5lZWRSZXNlYXJjaCkgew0KICAgICAgICAgICAgICAgIHJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHRydWUsIG5leHRIYXNoDQogICAgICAgICAgICApOw0KICAgICAgICB9DQoNCiAgICAgICAgdW5tYWtlU2VhcmNoTW92ZShiLCBtb3ZlLCBjYXB0dXJlZCk7DQoNCiAgICAgICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPiBiZXN0RXZhbCkgew0KICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgICAgICAgIGJlc3RNb3ZlID0gbW92ZTsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYWxwaGEgPSBNYXRoLm1heChhbHBoYSwgcmVzdWx0LnZhbHVlKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmIChyZXN1bHQudmFsdWUgPCBiZXN0RXZhbCkgew0KICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gcmVzdWx0LnZhbHVlOw0KICAgICAgICAgICAgICAgIGJlc3RNb3ZlID0gbW92ZTsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4ucmVzdWx0Lm1vdmVTZXF1ZW5jZV07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYmV0YSA9IE1hdGgubWluKGJldGEsIHJlc3VsdC52YWx1ZSk7DQogICAgICAgIH0NCg0KICAgICAgICBpZiAoYmV0YSA8PSBhbHBoYSkgew0KICAgICAgICAgICAgaWYgKCFwZXJmU3RhdHMuY3V0b2Zmc1tkXSkgcGVyZlN0YXRzLmN1dG9mZnNbZF0gPSAwOw0KICAgICAgICAgICAgcGVyZlN0YXRzLmN1dG9mZnNbZF0rKzsNCiAgICAgICAgICAgIGlmICghaXNDYXB0dXJlKSB7DQogICAgICAgICAgICAgICAgc3RvcmVLaWxsZXJNb3ZlKGQsIG1vdmUpOw0KICAgICAgICAgICAgICAgIGFkZEhpc3RvcnlTY29yZShtb3ZlLCBkKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5bu26L+f5ZCI5rOV5oCn77ya5Lyq5ZCI5rOV6Z2e56m65L2G5peg5LiA5ZCI5rOVIOKGkiDlsIbmrbsv5Zuw5q+ZDQogICAgaWYgKFNFQVJDSF9ERUZFUl9MRUdBTElUWSAmJiBsZWdhbE1vdmVzRm91bmQgPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHRlcm1pbmFsU2NvcmUoaW5DaGVjayk7DQogICAgfQ0KDQogICAgc3RvcmVUVChiZXN0RXZhbCwgYmVzdE1vdmUsIGJlc3RNb3ZlU2VxdWVuY2UpOw0KICAgIHJldHVybiB7IHZhbHVlOiBiZXN0RXZhbCwgbW92ZVNlcXVlbmNlOiBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFID8gYmVzdE1vdmVTZXF1ZW5jZSA6IFtdIH07DQp9Ow0KDQovLyBleGFjdFJvb3RTY29yZXM6IHRydWU9QW5hbHlzaXMg5YWo5qC557K+56Gu5YiG77ybZmFsc2U95a+55byI5qCH5YeGIFBWU++8iGZhaWwtbG93IOS4jeWbnuaQnO+8iQ0KY29uc3QgZ2V0QmVzdE1vdmUgPSAoYm9hcmQsIHR1cm4sIGRlcHRoID0gNiwgcGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0ID0gZmFsc2UsIGV4YWN0Um9vdFNjb3JlcyA9IGZhbHNlLCBjb2xsZWN0TW92ZVNlcXVlbmNlT3ZlcnJpZGUgPSBudWxsKSA9PiB7DQogIGNvbnN0IHRpbWVMaW1pdCA9IDUwMDA7DQoNCiAgLy8gRmlyc3QgdHJ5IHRvIGdldCBtb3ZlIGZyb20gb3BlbmluZyBib29rDQogIGNvbnN0IGJvb2tNb3ZlID0gb3BlbmluZ0Jvb2suZ2V0Qm9va01vdmUoYm9hcmQsIHBseSk7DQogIA0KICBpZiAoYm9va01vdmUpIHsNCiAgICAvLyBDaGVjayBpZiBib29rTW92ZSBpcyB2YWxpZCBmb3IgY3VycmVudCBib2FyZA0KICAgIGlmIChib29rTW92ZS5mcm9tICYmIGJvb2tNb3ZlLnRvICYmIA0KICAgICAgICB0eXBlb2YgYm9va01vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICB0eXBlb2YgYm9va01vdmUudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJvb2tNb3ZlLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICANCiAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYm9hcmRbYm9va01vdmUuZnJvbS5yXVtib29rTW92ZS5mcm9tLmNdOw0KICAgICAgDQogICAgICBpZiAobW92aW5nUGllY2UgJiYgbW92aW5nUGllY2UuY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgLy8gVmVyaWZ5IG1vdmUgaXMgdmFsaWQNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCBib29rTW92ZS5mcm9tKTsNCiAgICAgICAgY29uc3QgaXNWYWxpZCA9IHZhbGlkRGVzdGluYXRpb25zLnNvbWUoZGVzdCA9PiBkZXN0LnIgPT09IGJvb2tNb3ZlLnRvLnIgJiYgZGVzdC5jID09PSBib29rTW92ZS50by5jKTsNCiAgICAgICAgDQogICAgICAgIGlmIChpc1ZhbGlkKSB7DQogICAgICAgICAgcmV0dXJuIHsgYmVzdE1vdmU6IGJvb2tNb3ZlLCBzZWNvbmRCZXN0TW92ZTogbnVsbCwgbW92ZVNlcXVlbmNlOiBbXSwgc2Vjb25kTW92ZVNlcXVlbmNlOiBbXSwgYmVzdE1vdmVTY29yZTogMCwgc2Vjb25kQmVzdE1vdmVTY29yZTogMCwgYWxsTW92ZXNXaXRoU2NvcmVzOiBbXSB9Ow0KICAgICAgICB9DQogICAgICB9DQogICAgfQ0KICB9DQoNCiAgLy8g5qC56IqC54K577ya6L+t5Luj5Yqg5rexICsgUFZT77ybVFQva2lsbGVyL2hpc3Rvcnkg6Leo5rex5bqm5L+d55WZ77yI5LuF5byA5bGA5riF56m65LiA5qyh77yJDQogIHJlc2V0UGVyZlN0YXRzKCk7DQogIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7DQogIHRyYW5zcG9zaXRpb25UYWJsZS5yZXNldFN0YXRzKCk7DQogIHRyYW5zcG9zaXRpb25UYWJsZS5jbGVhcigpOw0KICBjbGVhckV2YWxDYWNoZSgpOw0KICBjb25zdCBtYXhEZXB0aCA9IE1hdGgubWF4KDEsIGRlcHRoIHwgMCk7DQogIHJlc2V0U2VhcmNoSGV1cmlzdGljcyhtYXhEZXB0aCk7DQogIHN5bmNHZW5lcmFsUG9zQ2FjaGUoYm9hcmQpOw0KICBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFID0gdHlwZW9mIGNvbGxlY3RNb3ZlU2VxdWVuY2VPdmVycmlkZSA9PT0gJ2Jvb2xlYW4nDQogICAgPyBjb2xsZWN0TW92ZVNlcXVlbmNlT3ZlcnJpZGUNCiAgICA6ICEhZXhhY3RSb290U2NvcmVzOw0KDQogIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7DQogIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KDQogIGNvbnN0IHJvb3RFdmFsUmVzdWx0ID0gZXZhbHVhdGVCb2FyZChib2FyZCwgdHVybiwgZ2FtZVN0YWdlKTsNCiAgY29uc3Qgcm9vdFBpZWNlc0luZm8gPSByb290RXZhbFJlc3VsdC5waWVjZXNJbmZvOw0KICBjb25zdCByb290Qm9hcmRJbmZvID0gcm9vdEV2YWxSZXN1bHQuYm9hcmRJbmZvOw0KDQogIC8vIOaUtumbhuagueiKgueCuei1sOazle+8iOWPquWBmuS4gOasoe+8ie+8m+acquiiq+WwhuaXtui/h+a7pOmAgeWQgw0KICBsZXQgcm9vdE1vdmVzID0gW107DQogIGNvbnN0IHJvb3RJbkNoZWNrID0gKHR1cm4gPT09ICdyZWQnICYmIHJvb3RCb2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fA0KICAgICAgICAgICAgICAgICAgICAgICh0dXJuID09PSAnYmxhY2snICYmIHJvb3RCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOw0KDQogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHIsIGMgfSk7DQogICAgICAgIHZhbGlkRGVzdGluYXRpb25zLmZvckVhY2godG8gPT4gew0KICAgICAgICAgIGNvbnN0IGlzQWNjZXB0YWJsZSA9IHJvb3RJbkNoZWNrIHx8IGlzUG9zaXRpb25BY2NlcHRhYmxlKGJvYXJkLCB7IHIsIGMgfSwgdG8sIHR1cm4sIHJvb3RCb2FyZEluZm8sIHJvb3RQaWVjZXNJbmZvLCBwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICBpZiAoaXNBY2NlcHRhYmxlKSB7DQogICAgICAgICAgICByb290TW92ZXMucHVzaCh7IGZyb206IHsgciwgYyB9LCB0bywgc2NvcmU6IDAsIG1vdmVTZXF1ZW5jZTogW10gfSk7DQogICAgICAgICAgfQ0KICAgICAgICB9KTsNCiAgICAgIH0NCiAgICB9DQogIH0NCg0KICBpZiAocm9vdE1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgIHJldHVybiB7DQogICAgICBiZXN0TW92ZTogbnVsbCwNCiAgICAgIHNlY29uZEJlc3RNb3ZlOiBudWxsLA0KICAgICAgbW92ZVNlcXVlbmNlOiBbXSwNCiAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogW10sDQogICAgICBiZXN0TW92ZVNjb3JlOiAwLA0KICAgICAgc2Vjb25kQmVzdE1vdmVTY29yZTogMCwNCiAgICAgIGFsbE1vdmVzV2l0aFNjb3JlczogW10NCiAgICB9Ow0KICB9DQoNCiAgY29uc3Qgc29ydFJvb3RNb3Zlc0J5U2NvcmUgPSAobW92ZXMpID0+IHsNCiAgICBtb3Zlcy5zb3J0KChhLCBiKSA9PiB7DQogICAgICBjb25zdCBzY29yZURpZmYgPSBiLnNjb3JlIC0gYS5zY29yZTsNCiAgICAgIGlmIChNYXRoLmFicyhzY29yZURpZmYpIDwgMWUtNikgew0KICAgICAgICBpZiAoYS5zY29yZSA+IDApIHsNCiAgICAgICAgICByZXR1cm4gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYi5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoYS5zY29yZSA8IDApIHsNCiAgICAgICAgICByZXR1cm4gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYS5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gMDsNCiAgICAgIH0NCiAgICAgIHJldHVybiBzY29yZURpZmY7DQogICAgfSk7DQogIH07DQoNCiAgY29uc3QgcHJvbW90ZVJvb3RNb3ZlID0gKG1vdmVzLCBwcmVmZXJyZWQpID0+IHsNCiAgICBpZiAoIXByZWZlcnJlZCkgcmV0dXJuOw0KICAgIGNvbnN0IGlkeCA9IG1vdmVzLmZpbmRJbmRleCgobSkgPT4gaXNTYW1lTW92ZShtLCBwcmVmZXJyZWQpKTsNCiAgICBpZiAoaWR4ID4gMCkgew0KICAgICAgY29uc3QgW2hpdF0gPSBtb3Zlcy5zcGxpY2UoaWR4LCAxKTsNCiAgICAgIG1vdmVzLnVuc2hpZnQoaGl0KTsNCiAgICB9DQogIH07DQoNCiAgY29uc3Qgd29ya0JvYXJkID0gYm9hcmQubWFwKChyb3cpID0+IFsuLi5yb3ddKTsKICBhY3RpdmVTZWFyY2hQaWVjZVN0YXRlID0gU0VBUkNIX1BJRUNFX0xJU1QgPyBjcmVhdGVTZWFyY2hQaWVjZVN0YXRlKHdvcmtCb2FyZCkgOiBudWxsOwogIGNvbnN0IE5VTExfV0lORE9XX0VQUyA9IDFlLTY7DQogIGNvbnN0IG5leHRUdXJuID0gdHVybiA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogIC8vIOagueWxgOmdouWTiOW4jOWPqueul+S4gOasoe+8m+WinumHj+aooeW8j+aVtOajteaQnOe0ouagkeeUseatpOa0vueUnw0KICBjb25zdCByb290SGFzaCA9IHpvYnJpc3RIYXNoZXIuaGFzaChib2FyZCk7DQogIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50Kys7DQogIGNvbnN0IHJvb3RUVEtleSA9IFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUDQogICAgPyB6b2JyaXN0SGFzaGVyLnR0S2V5RnJvbUhhc2gocm9vdEhhc2gsIHR1cm4pDQogICAgOiBgJHtyb290SGFzaH06JHt0dXJufWA7DQoNCiAgY29uc29sZS5sb2coDQogICAgYFN0YXJ0aW5nIGl0ZXJhdGl2ZSBkZWVwZW5pbmcgfCB0dXJuOiAke3R1cm59LCBtYXhEZXB0aDogJHttYXhEZXB0aH0sIGluY3Jab2JyaXN0OiAke1NFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUfSwgbGVhZkF0dGFja0JpdHM6ICR7U0VBUkNIX0xFQUZfQVRUQUNLX0JJVFN9LCByZWxhdGlvbk1hc2tzOiAke1NFQVJDSF9SRUxBVElPTl9NQVNLU30sIGNvbGxlY3RNb3ZlU2VxdWVuY2U6ICR7U0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRX0sIHRpbWVMaW1pdDogJHt0aW1lTGltaXR9bXMsIGVuYWJsZVRpbWVMaW1pdDogJHtlbmFibGVUaW1lTGltaXR9YA0KICApOw0KDQogIGxldCBjb21wbGV0ZWREZXB0aCA9IDA7DQoNCiAgZm9yIChsZXQgY3VycmVudERlcHRoID0gMTsgY3VycmVudERlcHRoIDw9IG1heERlcHRoOyBjdXJyZW50RGVwdGgrKykgew0KICAgIGlmIChlbmFibGVUaW1lTGltaXQgJiYgY29tcGxldGVkRGVwdGggPiAwICYmIERhdGUubm93KCkgLSBzdGFydFRpbWUgPiB0aW1lTGltaXQpIHsNCiAgICAgIGNvbnNvbGUubG9nKGBJRCBzdG9wcGVkIGJlZm9yZSBkZXB0aCAke2N1cnJlbnREZXB0aH0gZHVlIHRvIHRpbWUgbGltaXQgKGxhc3QgY29tcGxldGVkPSR7Y29tcGxldGVkRGVwdGh9KWApOw0KICAgICAgYnJlYWs7DQogICAgfQ0KDQogICAgLy8g5rWF5bGC5pyA5L2z552AICsgVFQg552A5o6S5Yiw5pyA5YmN77yM5L6b5pys5bGCIFBWUyDnrKzkuIDnnYDlhajnqpfkvb/nlKgNCiAgICBjb25zdCB0dEVudHJ5ID0gdHJhbnNwb3NpdGlvblRhYmxlLnJldHJpZXZlKHJvb3RUVEtleSk7DQogICAgY29uc3QgdHRNb3ZlID0gdHRFbnRyeSAmJiB0dEVudHJ5LmJlc3RNb3ZlID8gdHRFbnRyeS5iZXN0TW92ZSA6IG51bGw7DQogICAgY29uc3QgcHJldkJlc3QgPSByb290TW92ZXNbMF07DQogICAgc29ydE1vdmVzRmFzdChyb290TW92ZXMsIGJvYXJkLCB0dXJuLCByb290UGllY2VzSW5mbywgZ2FtZVN0YWdlLCByb290Qm9hcmRJbmZvLCB7DQogICAgICB0dE1vdmUsDQogICAgICBraWxsZXJzOiBraWxsZXJNb3Zlc1tNYXRoLm1heCgwLCBjdXJyZW50RGVwdGggLSAxKV0gfHwgW251bGwsIG51bGxdDQogICAgfSk7DQogICAgLy8g5LiK5LiA5bGC5pyA5L2z552A5pS+56ys5LiA77yI5pyA5ZCOIHByb21vdGXvvInvvIzkv53or4HmnKzlsYIgUFZTIOmmluedgOWFqOeql+WRveS4reeDrei3r+W+hA0KICAgIHByb21vdGVSb290TW92ZShyb290TW92ZXMsIHR0TW92ZSk7DQogICAgcHJvbW90ZVJvb3RNb3ZlKHJvb3RNb3ZlcywgcHJldkJlc3QpOw0KDQogICAgY29uc3QgdXNlRXhhY3RSb290ID0gZXhhY3RSb290U2NvcmVzICYmIGN1cnJlbnREZXB0aCA9PT0gbWF4RGVwdGg7DQogICAgbGV0IHJvb3RBbHBoYSA9IC1JbmZpbml0eTsNCg0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcm9vdE1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICBjb25zdCBpdGVtID0gcm9vdE1vdmVzW2ldOw0KICAgICAgY29uc3QgbW92aW5nUGllY2UgPSB3b3JrQm9hcmRbaXRlbS5mcm9tLnJdW2l0ZW0uZnJvbS5jXTsNCiAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZU1vdmUod29ya0JvYXJkLCBpdGVtLmZyb20sIGl0ZW0udG8pOw0KICAgICAgY29uc3QgY2hpbGRIYXNoID0gY2hpbGRCb2FyZEhhc2gocm9vdEhhc2gsIGl0ZW0sIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7DQogICAgICB2ZXJpZnlCb2FyZEhhc2god29ya0JvYXJkLCBjaGlsZEhhc2gpOw0KDQogICAgICBsZXQgYWxwaGFCZXRhUmVzdWx0Ow0KICAgICAgbGV0IHNjb3JlSXNFeGFjdCA9IHRydWU7DQogICAgICBpZiAoaSA9PT0gMCB8fCByb290QWxwaGEgPT09IC1JbmZpbml0eSkgew0KICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LA0KICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICApOw0KICAgICAgfSBlbHNlIHsNCiAgICAgICAgY29uc3QgcHJvYmUgPSBhbHBoYUJldGEoDQogICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLA0KICAgICAgICAgIHJvb3RBbHBoYSwgcm9vdEFscGhhICsgTlVMTF9XSU5ET1dfRVBTLA0KICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICApOw0KICAgICAgICBpZiAocHJvYmUudmFsdWUgPiByb290QWxwaGEpIHsNCiAgICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsIHJvb3RBbHBoYSwgSW5maW5pdHksDQogICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCB0cnVlLCBjaGlsZEhhc2gNCiAgICAgICAgICApOw0KICAgICAgICB9IGVsc2UgaWYgKHVzZUV4YWN0Um9vdCkgew0KICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwgLUluZmluaXR5LCBJbmZpbml0eSwNCiAgICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICAgICk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgLy8gZmFpbC1sb3fvvJrmjqLmtYvliIblj6rmmK/kuIrnlYzvvIzkuI3og73lvZPnsr7noa7liIblhpnlhaXvvIjlkKbliJkgSUQg5LiL5bGC5o6S5bqP6KKr5rGh5p+T77yM5piT5Y+N5aSN6LWw54Ku77yJDQogICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gcHJvYmU7DQogICAgICAgICAgc2NvcmVJc0V4YWN0ID0gZmFsc2U7DQogICAgICAgIH0NCiAgICAgIH0NCg0KICAgICAgdW5tYWtlTW92ZSh3b3JrQm9hcmQsIGl0ZW0uZnJvbSwgaXRlbS50bywgY2FwdHVyZWQpOw0KDQogICAgICBpZiAoc2NvcmVJc0V4YWN0KSB7DQogICAgICAgIGl0ZW0uc2NvcmUgPSBhbHBoYUJldGFSZXN1bHQudmFsdWU7DQogICAgICAgIGl0ZW0ubW92ZVNlcXVlbmNlID0gU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRQ0KICAgICAgICAgID8gW3sgZnJvbTogaXRlbS5mcm9tLCB0bzogaXRlbS50byB9LCAuLi4oYWxwaGFCZXRhUmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldDQogICAgICAgICAgOiBbXTsNCiAgICAgICAgaWYgKGl0ZW0uc2NvcmUgPiByb290QWxwaGEpIHsNCiAgICAgICAgICByb290QWxwaGEgPSBpdGVtLnNjb3JlOw0KICAgICAgICB9DQogICAgICB9IGVsc2UgaWYgKGl0ZW0uc2NvcmUgPiByb290QWxwaGEpIHsNCiAgICAgICAgLy8g5L+d55WZ5LiK5LiA5bGC5YiG5pWw77yb6Iul5LuN6auY5LqO5b2T5YmNIM6x77yI5byC5bi477yJ77yM55Wl6ZmN5Lul5YWN5oyk5o6J55yf5pyA5LyYDQogICAgICAgIGl0ZW0uc2NvcmUgPSByb290QWxwaGEgLSAxZS0zOw0KICAgICAgfQ0KICAgIH0NCg0KICAgIHNvcnRSb290TW92ZXNCeVNjb3JlKHJvb3RNb3Zlcyk7DQogICAgY29tcGxldGVkRGVwdGggPSBjdXJyZW50RGVwdGg7DQoNCiAgICAvLyDmiormnKzlsYLmnIDkvbPnnYDlhpnlhaUgVFTvvIzkvpvmm7Tmt7HkuIDlsYLmoLnmjpLluo8NCiAgICB0cmFuc3Bvc2l0aW9uVGFibGUuc3RvcmUoDQogICAgICByb290VFRLZXksDQogICAgICBjdXJyZW50RGVwdGgsDQogICAgICByb290TW92ZXNbMF0uc2NvcmUsDQogICAgICAnZXhhY3QnLA0KICAgICAgcm9vdE1vdmVzWzBdLA0KICAgICAgU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA/IChyb290TW92ZXNbMF0ubW92ZVNlcXVlbmNlIHx8IFtdKSA6IG51bGwNCiAgICApOw0KDQogICAgY29uc29sZS5sb2coDQogICAgICBgSUQgZGVwdGggJHtjdXJyZW50RGVwdGh9LyR7bWF4RGVwdGh9IGRvbmUgfCBiZXN0PSR7SlNPTi5zdHJpbmdpZnkocm9vdE1vdmVzWzBdLmZyb20pfS0+JHtKU09OLnN0cmluZ2lmeShyb290TW92ZXNbMF0udG8pfSBzY29yZT0ke3Jvb3RNb3Zlc1swXS5zY29yZX0gZWxhcHNlZD0ke0RhdGUubm93KCkgLSBzdGFydFRpbWV9bXNgDQogICAgKTsNCiAgfQ0KDQogIGNvbnN0IGJlc3RNb3ZlID0gcm9vdE1vdmVzWzBdIHx8IG51bGw7DQogIGNvbnN0IHNlY29uZEJlc3RNb3ZlID0gcm9vdE1vdmVzLmxlbmd0aCA+IDEgPyByb290TW92ZXNbMV0gOiBudWxsOw0KICBjb25zdCBiZXN0TW92ZVNlcXVlbmNlID0gYmVzdE1vdmUgPyAoYmVzdE1vdmUubW92ZVNlcXVlbmNlIHx8IFtdKSA6IFtdOw0KICBjb25zdCBzZWNvbmRNb3ZlU2VxdWVuY2UgPSBzZWNvbmRCZXN0TW92ZSA/IChzZWNvbmRCZXN0TW92ZS5tb3ZlU2VxdWVuY2UgfHwgW10pIDogW107DQogIGNvbnN0IGJlc3RNb3ZlU2NvcmUgPSBiZXN0TW92ZSA/IGJlc3RNb3ZlLnNjb3JlIDogMDsNCiAgY29uc3Qgc2Vjb25kQmVzdE1vdmVTY29yZSA9IHNlY29uZEJlc3RNb3ZlID8gc2Vjb25kQmVzdE1vdmUuc2NvcmUgOiAwOw0KDQogIGNvbnN0IGFsbE1vdmVzV2l0aFNjb3JlcyA9IHJvb3RNb3Zlcy5tYXAoKG1vdmVJbmZvKSA9PiAoew0KICAgIG1vdmU6IHsNCiAgICAgIGZyb206IG1vdmVJbmZvLmZyb20sDQogICAgICB0bzogbW92ZUluZm8udG8NCiAgICB9LA0KICAgIHNjb3JlOiBtb3ZlSW5mby5zY29yZSwNCiAgICBtb3ZlU2VxdWVuY2U6IG1vdmVJbmZvLm1vdmVTZXF1ZW5jZSB8fCBbXQ0KICB9KSk7DQoNCiAgY29uc3QgcmVzdWx0ID0gewogICAgYmVzdE1vdmUsCiAgICBzZWNvbmRCZXN0TW92ZSwNCiAgICBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UsDQogICAgc2Vjb25kTW92ZVNlcXVlbmNlLA0KICAgIGJlc3RNb3ZlU2NvcmUsDQogICAgc2Vjb25kQmVzdE1vdmVTY29yZSwNCiAgICBhbGxNb3Zlc1dpdGhTY29yZXMsDQogICAgY29tcGxldGVkRGVwdGgKICB9OwogIGFjdGl2ZVNlYXJjaFBpZWNlU3RhdGUgPSBudWxsOwogIHJldHVybiByZXN1bHQ7Cn07Cg0KLy8gLS0tIFdPUktFUiBMSVNURU5FUiAo57uf5LiA5raI5oGv5aSE55CGKSAtLS0NCg==';
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
        board: Board, 
        turn: Color
    ): Promise<{ violation: boolean; type: 'chase' | 'check' | null }> => {
        // 模拟走棋后的棋盘
        const newBoard = board.map(row => [...row]);
        newBoard[lastMove.to.r][lastMove.to.c] = newBoard[lastMove.from.r][lastMove.from.c];
        newBoard[lastMove.from.r][lastMove.from.c] = null;
        
        // 检查走棋后是否构成将军（对手是否被将军）
        const enemyColor = turn === 'red' ? 'black' : 'red';
        const isCheck = await isBoardInCheck(newBoard, enemyColor);
        
        // 检查当前走法是否构成捉子
        const capturingResult = await isCapturingThreat(board, lastMove, turn);
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
                const check = await checkRepetition(hash, positionHistory, move, testBoard, currentTurn);
                
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
            return await checkRepetition(hash, positionHistory, move, testBoard, currentTurn);
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
            const repetitionCheck = await checkRepetition(newHash, positionHistory, move, newBoard, turn);
            
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

