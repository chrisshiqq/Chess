
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovDQoNCi8vIOaji+ebmOW4uOmHj+WumuS5iQ0KY29uc3QgUk9XUyA9IDEwOw0KY29uc3QgQ09MUyA9IDk7DQoNCi8vIOaji+WtkOexu+Wei+WumuS5iQ0KY29uc3QgUElFQ0VfVFlQRVMgPSB7DQogICAgR0VORVJBTDogJ2dlbmVyYWwnLA0KICAgIENIQVJJT1Q6ICdjaGFyaW90JywNCiAgICBDQU5OT046ICdjYW5ub24nLA0KICAgIEhPUlNFOiAnaG9yc2UnLA0KICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLA0KICAgIEFEVklTT1I6ICdhZHZpc29yJywNCiAgICBTT0xESUVSOiAnc29sZGllcicNCn07DQoNCi8vIOadkOaWmeWAvOadg+mHjemFjee9rg0KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGdlbmVyYWw6IDEwMDAwLCAgLy8g5bCGL+W4hQ0KICAgIGNoYXJpb3Q6IDkwMCwgICAgIC8vIOi9pg0KICAgIGNhbm5vbjogew0KICAgICAgICBlYXJseTogNDUwLCAgICAvLyDlvIDlsYDpmLbmrrUNCiAgICAgICAgbWlkOiA0MDAsICAgICAgLy8g5Lit5bGA6Zi25q61DQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQ0KICAgIH0sICAgICAgICAgICAgICAgIC8vIOeCrg0KICAgIGhvcnNlOiB7DQogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDQ1MCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsDQogICAgZWxlcGhhbnQ6IDIwMCwgICAgLy8g6LGhL+ebuA0KICAgIGFkdmlzb3I6IDIwMCwgICAgIC8vIOWjqy/ku5UNCiAgICBzb2xkaWVyOiB7DQogICAgICAgIGVhcmx5OiAxMDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDIwMCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSAgICAgICAgICAgICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIOaji+WtkOS7t+WAvOadg+mHjemFjee9rg0KbGV0IFZBTFVFX1dFSUdIVFMgPSB7DQogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQ0KICAgIC8vcG9zaXRpb246IDAuMiwgICAvLyDkvY3nva7lgLzmnYPph40NCiAgICAvL3RocmVhdDogMC4xNSwgICAgLy8g5aiB6IOB5YC85p2D6YeNDQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQ0KICAgIC8vc2FmZXR5OiAwLjEsICAgICAvLyDlronlhajlgLzmnYPph40NCiAgICAvL21vYmlsaXR5OiAwLjA1ICAgLy8g5py65Yqo5YC85p2D6YeNDQoNCiAgICBtYXRlcmlhbDogMSwgICAgLy8g5p2Q5paZ5YC85p2D6YeNDQogICAgcG9zaXRpb246IDEsICAgIC8vIOS9jee9ruWAvOadg+mHjQ0KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQ0KICAgIHRhY3RpYzogMSwgICAgICAvLyDmiJjmnK/lgLzmnYPph40NCiAgICBzYWZldHk6IDEsICAgICAgLy8g5a6J5YWo5YC85p2D6YeNDQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQ0KfTsNCg0KLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XDQpjb25zdCBFVkFMVUFUSU9OX1BBUkFNRVRFUlMgPSB7DQogICAgLy8g5py65Yqo5YC85Y+C5pWwDQogICAgbW9iaWxpdHk6IHsNCiAgICAgICAgYmFzZU1vdmVWYWx1ZTogMSwgICAgICAvLyDln7rnoYDnp7vliqjku7flgLwNCiAgICB9LA0KICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQ0KICAgIGNoZWNrOiB7DQogICAgICAgIGJvbnVzOiA4MA0KICAgIH0NCn07DQoNCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rg0KY29uc3QgUE9TSVRJT05fVEFCTEVTID0gew0KICAgIC8vIOWFtS/ljZLkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBzb2xkaWVyOiBbDQogICAgICAgIFswLCA1LCAxMCwgMTUsIDIwLCAxNSwgMTAsIDUsIDBdLA0KICAgICAgICBbNSwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgY2hhcmlvdDogWw0KICAgICAgICBbNSwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDEwLCA1LCAxNSwgMCwgMTUsIDUsIDEwLCAxMF0sDQogICAgICAgIFswLCAxMCwgNSwgNSwgNSwgNSwgMTAsIDUsIDBdDQogICAgXSwNCiAgICAvLyDpqazkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBob3JzZTogWw0KICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgICAgICAgWzAsIDUsIDI1LCAxMCwgMTAsIDEwLCAyNSwgNSwgMF0sDQogICAgICAgIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sDQogICAgICAgIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMjUsIDIwLCAwLCAyMCwgMjUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgICAgICAgWzUsIDAsIDUsIDUsIDAsIDUsIDUsIDAsIDVdLA0KICAgICAgICBbMCwgMCwgMCwgNSwgLTIwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDngq7kvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBjYW5ub246IFsNCiAgICAgICAgWzEwLCAyMCwgMTUsIDEwLCAwLCAxMCwgMTUsIDIwLCAxMF0sDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLA0KICAgICAgICBbNSwgNSwgMTUsIDUsIDI1LCA1LCAxNSwgNSwgNV0sDQogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLA0KICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogICAgICAgIFsxMCwgMTAsIDE1LCAyMCwgMzAsIDIwLCAxNSwgMTAsIDEwXSwgDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBlbGVwaGFudDogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g5aOr5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgYWR2aXNvcjogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCA1LCAwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDEwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0NCiAgICBdDQp9Ow0KDQovLyDojrflj5bmo4vlrZDnmoTmnZDmlpnlgLwNCmNvbnN0IGdldE1hdGVyaWFsVmFsdWUgPSAocGllY2UsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOw0KICAgIA0KICAgIC8vIOmSiOWvueacieWIhumYtuauteadkOaWmeWAvOeahOWFteenje+8iOWFteOAgeeCruOAgemprO+8ieiwg+aVtOadkOaWmeWAvA0KICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7DQogICAgICAgIHZhbHVlID0gdmFsdWVbZ2FtZVN0YWdlXSB8fCB2YWx1ZS5taWQ7DQogICAgfQ0KICAgIA0KICAgIHJldHVybiB2YWx1ZTsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOS9jee9ruWAvA0KY29uc3QgZ2V0UG9zaXRpb25WYWx1ZSA9IChwaWVjZSwgciwgYykgPT4gewogICAgY29uc3QgdGFibGUgPSBQT1NJVElPTl9UQUJMRVNbcGllY2UudHlwZV07DQogICAgaWYgKCF0YWJsZSkgcmV0dXJuIDA7DQogICAgDQogICAgLy8g6buR5pa56ZyA6KaB57+76L2s5L2N572u6KGoDQogICAgY29uc3Qgcm93SWR4ID0gcGllY2UuY29sb3IgPT09ICdyZWQnID8gKDktIHIpIDogcjsNCiAgICByZXR1cm4gdGFibGVbcm93SWR4XVtjXSB8fCAwOwp9OwoKLy8gU2VhcmNoIGxlYXZlcyB1c2UgbnVtZXJpYyBwaWVjZSBjb2Rlcy4gRmxhdHRlbiBwb3NpdGlvbiB2YWx1ZXMgb25jZSBzbyB0aGUKLy8gaG90IGV2YWx1YXRvciBuZXZlciBoYXMgdG8gZGVyZWZlcmVuY2UgYSBwaWVjZSBvYmplY3Qgb3IgYSBuZXN0ZWQgdGFibGUuCmNvbnN0IFNFQVJDSF9QT1NJVElPTl9WQUxVRVMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAxNiB9LCAoKSA9PiBuZXcgSW50MTZBcnJheSg5MCkpOwooKCkgPT4gewogICAgY29uc3QgdHlwZVRhYmxlcyA9IFsKICAgICAgICBudWxsLAogICAgICAgIG51bGwsCiAgICAgICAgUE9TSVRJT05fVEFCTEVTLmNoYXJpb3QsCiAgICAgICAgUE9TSVRJT05fVEFCTEVTLmhvcnNlLAogICAgICAgIFBPU0lUSU9OX1RBQkxFUy5lbGVwaGFudCwKICAgICAgICBQT1NJVElPTl9UQUJMRVMuYWR2aXNvciwKICAgICAgICBQT1NJVElPTl9UQUJMRVMuY2Fubm9uLAogICAgICAgIFBPU0lUSU9OX1RBQkxFUy5zb2xkaWVyCiAgICBdOwogICAgZm9yIChsZXQgcGllY2VDb2RlID0gMTsgcGllY2VDb2RlIDwgMTY7IHBpZWNlQ29kZSsrKSB7CiAgICAgICAgY29uc3QgdGFibGUgPSB0eXBlVGFibGVzW3BpZWNlQ29kZSAmIDddOwogICAgICAgIGlmICghdGFibGUpIGNvbnRpbnVlOwogICAgICAgIGNvbnN0IGlzUmVkID0gcGllY2VDb2RlIDwgODsKICAgICAgICBjb25zdCB2YWx1ZXMgPSBTRUFSQ0hfUE9TSVRJT05fVkFMVUVTW3BpZWNlQ29kZV07CiAgICAgICAgZm9yIChsZXQgc3EgPSAwOyBzcSA8IDkwOyBzcSsrKSB7CiAgICAgICAgICAgIGNvbnN0IHIgPSAoc3EgLyA5KSB8IDA7CiAgICAgICAgICAgIHZhbHVlc1tzcV0gPSB0YWJsZVtpc1JlZCA/IDkgLSByIDogcl1bc3EgJSA5XSB8fCAwOwogICAgICAgIH0KICAgIH0KfSkoKTsKDQovLyDmlLvlh7vkvY3lm77vvJo5MCDmoLznlKggM8OXVWludDMy44CC5pCc57Si5Y+25Y+q6ZyA44CM5piv5ZCm5pWM5o6n44CN77yb54K55qOLL1VJIOS7jeeUqOaOp+WItuiAheWIl+ihqOOAgg0KY29uc3QgQVRUQUNLX1dPUkRTID0gMzsNCmNvbnN0IHNjcmF0Y2hSZWRBdHRhY2sgPSBuZXcgVWludDMyQXJyYXkoQVRUQUNLX1dPUkRTKTsNCmNvbnN0IHNjcmF0Y2hCbGFja0F0dGFjayA9IG5ldyBVaW50MzJBcnJheShBVFRBQ0tfV09SRFMpOw0KLy8gdHJ1ZT3mkJzntKLlj7bnlKjmlLvlh7vkvY3lm77vvIjpu5jorqTvvInvvJtmYWxzZT3lj7bor4TkvLDku43lu7ogMTDDlzkg5o6n5Yi26ICF6KGo77yIQS9C77yJDQovLyB0cnVlPeWFs+ezu+eUqOagvOS9jSBVaW50MzIg5pS7L+WuiC/mjqcgbWFza++8iOm7mOiupO+8ie+8m2ZhbHNlPXRocmVhdC9ndWFyZCDlr7nosaHliJfooajvvIhBL0LvvIkNCi8vIFBhY2tlZCBkZXN0aW5hdGlvbnMvcmF5cyBhbmQgaW5saW5lZCByZWxhdGlvbiB3cml0ZXMgZm9yIHNlYXJjaCBsZWF2ZXMuCi8vIEtlcHQgc2VwYXJhdGUgZnJvbSB0aGUgb3JpZ2luYWwgc3BlY2lhbGl6ZWQgcGF0aCBmb3IgYmVuY2htYXJrIHZlcmlmaWNhdGlvbi4KLy8g5pCc57Si5pyf6Ze057u05oqk57Sn5YeR5qOL5a2Q6KGo77yM6YG/5YWN5Y+26K+E5LywL+edgOazleWHhuWkh+WPjeWkjeaJq+aPjyAxMHg5IOWvueixoeaji+ebmO+8iEEvQiDlj6/lhbPpl63vvIkKLy8g6Z2Z6buY5pCc57Si5ZCD5a2Q55Sf5oiQ5aSN55So5pCc57Si5oCB5qOL5a2Q6KGo77yb54us56uL5byA5YWz55So5LqOIEEvQuOAggovLyDku4Xln7rlh4bor4rmlq3lvIDlkK/vvJrpop3lpJYgcGVyZm9ybWFuY2Uubm93IOS8muW9seWTjee7neWvueiAl+aXtu+8jOato+W8j+WvueW8iOS/neaMgeWFs+mXreOAggpsZXQgU0VBUkNIX1BST0ZJTEUgPSBmYWxzZTsKDQpjb25zdCBjbGVhckF0dGFja0JpdHMgPSAoYml0cykgPT4gew0KICAgIGJpdHNbMF0gPSAwOw0KICAgIGJpdHNbMV0gPSAwOw0KICAgIGJpdHNbMl0gPSAwOw0KfTsNCg0KY29uc3Qgc2V0QXR0YWNrQml0ID0gKGJpdHMsIHNxKSA9PiB7DQogICAgYml0c1tzcSA+Pj4gNV0gfD0gKDEgPDwgKHNxICYgMzEpKTsNCn07DQoNCmNvbnN0IGhhc0F0dGFja0JpdCA9IChiaXRzLCBzcSkgPT4gKGJpdHNbc3EgPj4+IDVdICYgKDEgPDwgKHNxICYgMzEpKSkgIT09IDA7DQoNCmNvbnN0IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkID0gKCkgPT4NCiAgICBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCg0KLy8g5YWz57O7IG1hc2vvvJrmnIDlpJogMzIg5a2Q77yI5Lit5Zu96LGh5qOL5ruh55uY77yJ77yMYml0IGkgPSBwaWVjZXNJbmZvW2ldDQpjb25zdCBSRUxfU1FVQVJFUyA9IDkwOw0KY29uc3Qgc2NyYXRjaEF0dGFja01hc2sgPSBuZXcgVWludDMyQXJyYXkoUkVMX1NRVUFSRVMpOyAgLy8g5pWM5a2Q5omA5Zyo5qC877ya6LCB5Zyo5omT5a6DDQpjb25zdCBzY3JhdGNoR3VhcmRNYXNrID0gbmV3IFVpbnQzMkFycmF5KFJFTF9TUVVBUkVTKTsgICAvLyDlj4vlhpvmiYDlnKjmoLzvvJrosIHlnKjkv53lroMNCmNvbnN0IHNjcmF0Y2hDb250cm9sTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7IC8vIOepuuaOp+agvO+8muiwgeaOp+WItuWug++8iOWvuem9kOaXpyBib2FyZEluZm/vvIkNCg0KY29uc3QgY2xlYXJSZWxhdGlvbk1hc2tzID0gKGNsZWFyQ29udHJvbCA9IHRydWUpID0+IHsNCiAgICBzY3JhdGNoQXR0YWNrTWFzay5maWxsKDApOw0KICAgIHNjcmF0Y2hHdWFyZE1hc2suZmlsbCgwKTsNCiAgICBpZiAoY2xlYXJDb250cm9sKSBzY3JhdGNoQ29udHJvbE1hc2suZmlsbCgwKTsNCn07DQoNCi8vIOagvOS9jSDihpIgcGllY2VzSW5mbyDlvJXnlKjvvIjmm7/ku6Pmr4/lj7YgbmV3IE1hcO+8iQ0KY29uc3Qgc2NyYXRjaFBpZWNlQXRTcSA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7DQpjb25zdCBjbGVhclBpZWNlQXRTcSA9ICgpID0+IHsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IFJFTF9TUVVBUkVTOyBpKyspIHNjcmF0Y2hQaWVjZUF0U3FbaV0gPSBudWxsOw0KfTsNCg0KLy8g5aSN55SoIHJlbEN0eO+8jOmBv+WFjeavj+WtkCBuZXcg5bCP5a+56LGhDQpjb25zdCBzY3JhdGNoUmVsQ3R4ID0gewogICAgdXNlTWFza3M6IHRydWUsDQogICAgc2tpcENvbnRyb2xNYXNrOiBmYWxzZSwgLy8g5pCc57Si5Y+277ya5LiN5YaZ56m65o6nIGNvbnRyb2xNYXNr77yI5LuN5YaZ5pS75Ye75L2N5Zu+K+acuuWKqO+8iQ0KICAgIHBpZWNlSW5kZXg6IDAsDQogICAgYXR0YWNrTWFzazogbnVsbCwNCiAgICBndWFyZE1hc2s6IG51bGwsDQogICAgY29udHJvbE1hc2s6IG51bGwsDQogICAgcmVkQXR0YWNrOiBudWxsLA0KICAgIGJsYWNrQXR0YWNrOiBudWxsCn07Cgpjb25zdCBzY3JhdGNoTGVhZlBpZWNlc0luZm8gPSBbXTsKY29uc3Qgc2NyYXRjaExlYWZQaWVjZVNsb3RzID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogMzIgfSwgKF8sIHBpZWNlSW5kZXgpID0+ICh7CiAgICBwaWVjZTogbnVsbCwKICAgIHBpZWNlQ29kZTogMCwKICAgIHI6IDAsCiAgICBjOiAwLAogICAgc3E6IDAsCiAgICBwaWVjZUluZGV4LAogICAgbW92ZXM6IFtdLAogICAgYWxseUd1YXJkczogW10sCiAgICBtYXRlcmlhbFZhbHVlOiAwLAogICAgcG9zaXRpb25WYWx1ZTogMCwKICAgIHRocmVhdFZhbHVlOiAwLAogICAgc2FmZXR5VmFsdWU6IDAsCiAgICB0YWN0aWNWYWx1ZTogMCwKICAgIG1vYmlsaXR5VmFsdWU6IDAsCiAgICB0aHJlYXQ6IFtdLAogICAgdGhyZWF0ZW5lZEJ5OiBbXSwKICAgIGd1YXJkOiBbXSwKICAgIGd1YXJkZWRCeTogW10sCiAgICBjb250cm9sOiBbXSwKICAgIHByb3RlY3Q6IFtdCn0pKTsKCmNvbnN0IHNjcmF0Y2hMZWFmQm9hcmRJbmZvID0gewogICAgdXNlUmVsYXRpb25NYXNrczogdHJ1ZSwKICAgIHVzZUF0dGFja0JpdHM6IHRydWUsCiAgICBza2lwQ29udHJvbE1hc2s6IHRydWUsCiAgICBhdHRhY2tNYXNrOiBzY3JhdGNoQXR0YWNrTWFzaywKICAgIGd1YXJkTWFzazogc2NyYXRjaEd1YXJkTWFzaywKICAgIGNvbnRyb2xNYXNrOiBzY3JhdGNoQ29udHJvbE1hc2ssCiAgICByZWRBdHRhY2s6IHNjcmF0Y2hSZWRBdHRhY2ssCiAgICBibGFja0F0dGFjazogc2NyYXRjaEJsYWNrQXR0YWNrCn07CgpsZXQgYWN0aXZlU2VhcmNoUGllY2VTdGF0ZSA9IG51bGw7Cgpjb25zdCBzZWFyY2hQaWVjZVR5cGVDb2RlID0gKHR5cGUpID0+IHsKICAgIHN3aXRjaCAodHlwZSkgewogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuR0VORVJBTDogcmV0dXJuIDE7CiAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5DSEFSSU9UOiByZXR1cm4gMjsKICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkhPUlNFOiByZXR1cm4gMzsKICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkVMRVBIQU5UOiByZXR1cm4gNDsKICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkFEVklTT1I6IHJldHVybiA1OwogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuQ0FOTk9OOiByZXR1cm4gNjsKICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLlNPTERJRVI6IHJldHVybiA3OwogICAgICAgIGRlZmF1bHQ6IHJldHVybiAwOwogICAgfQp9OwoKY29uc3Qgc2VhcmNoUGllY2VDb2RlID0gKHBpZWNlKSA9PiBzZWFyY2hQaWVjZVR5cGVDb2RlKHBpZWNlLnR5cGUpICsgKHBpZWNlLmNvbG9yID09PSAncmVkJyA/IDAgOiA4KTsKCmNvbnN0IFNFQVJDSF9NQVRFUklBTF9WQUxVRVMgPSB7CiAgICBlYXJseTogbmV3IEludDE2QXJyYXkoWzAsIDEwMDAwLCA5MDAsIDQwMCwgMjAwLCAyMDAsIDQ1MCwgMTAwXSksCiAgICBtaWQ6IG5ldyBJbnQxNkFycmF5KFswLCAxMDAwMCwgOTAwLCA0NTAsIDIwMCwgMjAwLCA0MDAsIDIwMF0pLAogICAgbGF0ZTogbmV3IEludDE2QXJyYXkoWzAsIDEwMDAwLCA5MDAsIDQ1MCwgMjAwLCAyMDAsIDQwMCwgNDUwXSkKfTsKCmNvbnN0IHNlYXJjaE1hdGVyaWFsVGFibGUgPSAoZ2FtZVN0YWdlKSA9PiBTRUFSQ0hfTUFURVJJQUxfVkFMVUVTW2dhbWVTdGFnZV0gfHwgU0VBUkNIX01BVEVSSUFMX1ZBTFVFUy5taWQ7Cgpjb25zdCBjcmVhdGVTZWFyY2hQaWVjZVN0YXRlID0gKGJvYXJkKSA9PiB7CiAgICBjb25zdCByZWNvcmRzID0gW107CiAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBuZXcgSW50OEFycmF5KFJFTF9TUVVBUkVTKTsKICAgIGNvbnN0IHNxdWFyZUNvZGVzID0gbmV3IFVpbnQ4QXJyYXkoUkVMX1NRVUFSRVMpOwogICAgY29uc3QgcGllY2VDb2RlcyA9IG5ldyBVaW50OEFycmF5KDMyKTsKICAgIGxldCByZWRHZW5lcmFsU3EgPSAtMTsKICAgIGxldCBibGFja0dlbmVyYWxTcSA9IC0xOwogICAgc3F1YXJlVG9TbG90LmZpbGwoLTEpOwogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsKICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOwogICAgICAgICAgICBpZiAoIXBpZWNlKSBjb250aW51ZTsKICAgICAgICAgICAgaWYgKHJlY29yZHMubGVuZ3RoID49IDMyKSByZXR1cm4gbnVsbDsKICAgICAgICAgICAgY29uc3Qgc2xvdCA9IHJlY29yZHMubGVuZ3RoOwogICAgICAgICAgICByZWNvcmRzLnB1c2goeyBwaWVjZSwgciwgYywgc3E6IHIgKiA5ICsgYywgYWxpdmU6IHRydWUgfSk7CiAgICAgICAgICAgIGNvbnN0IGNvZGUgPSBzZWFyY2hQaWVjZUNvZGUocGllY2UpOwogICAgICAgICAgICBpZiAoKGNvZGUgJiA3KSA9PT0gMSkgewogICAgICAgICAgICAgICAgaWYgKGNvZGUgPCA4KSByZWRHZW5lcmFsU3EgPSByICogOSArIGM7CiAgICAgICAgICAgICAgICBlbHNlIGJsYWNrR2VuZXJhbFNxID0gciAqIDkgKyBjOwogICAgICAgICAgICB9CiAgICAgICAgICAgIHBpZWNlQ29kZXNbc2xvdF0gPSBjb2RlOwogICAgICAgICAgICBzcXVhcmVUb1Nsb3RbciAqIDkgKyBjXSA9IHNsb3Q7CiAgICAgICAgICAgIHNxdWFyZUNvZGVzW3IgKiA5ICsgY10gPSBjb2RlOwogICAgICAgIH0KICAgIH0KICAgIHJldHVybiB7CiAgICAgICAgYm9hcmQsCiAgICAgICAgcmVjb3JkcywKICAgICAgICBzcXVhcmVUb1Nsb3QsCiAgICAgICAgc3F1YXJlQ29kZXMsCiAgICAgICAgcGllY2VDb2RlcywKICAgICAgICByZWRHZW5lcmFsU3EsCiAgICAgICAgYmxhY2tHZW5lcmFsU3EsCiAgICAgICAgbW92ZXJTdGFjazogbmV3IEludDhBcnJheSgzMiksCiAgICAgICAgY2FwdHVyZWRTdGFjazogbmV3IEludDhBcnJheSgzMiksCiAgICAgICAgc3RhY2tEZXB0aDogMAogICAgfTsKfTsKCmNvbnN0IGFjdGl2ZVBpZWNlU3RhdGVGb3IgPSAoYm9hcmQpID0+IHsKICAgIGNvbnN0IHN0YXRlID0gYWN0aXZlU2VhcmNoUGllY2VTdGF0ZTsKICAgIHJldHVybiBzdGF0ZSAmJiBzdGF0ZS5ib2FyZCA9PT0gYm9hcmQgPyBzdGF0ZSA6IG51bGw7Cn07Cgpjb25zdCB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJNYWtlID0gKGJvYXJkLCBmcm9tU3EsIHRvU3EpID0+IHsKICAgIGNvbnN0IHN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7CiAgICBpZiAoIXN0YXRlKSByZXR1cm47CiAgICBjb25zdCBtb3ZlclNsb3QgPSBzdGF0ZS5zcXVhcmVUb1Nsb3RbZnJvbVNxXTsKICAgIGNvbnN0IGNhcHR1cmVkU2xvdCA9IHN0YXRlLnNxdWFyZVRvU2xvdFt0b1NxXTsKICAgIGNvbnN0IHN0YWNrSW5kZXggPSBzdGF0ZS5zdGFja0RlcHRoKys7CiAgICBzdGF0ZS5tb3ZlclN0YWNrW3N0YWNrSW5kZXhdID0gbW92ZXJTbG90OwogICAgc3RhdGUuY2FwdHVyZWRTdGFja1tzdGFja0luZGV4XSA9IGNhcHR1cmVkU2xvdDsKICAgIGlmIChtb3ZlclNsb3QgPCAwKSByZXR1cm47CgogICAgY29uc3QgbW92ZXIgPSBzdGF0ZS5yZWNvcmRzW21vdmVyU2xvdF07CiAgICBtb3Zlci5zcSA9IHRvU3E7CiAgICBtb3Zlci5yID0gKHRvU3EgLyA5KSB8IDA7CiAgICBtb3Zlci5jID0gdG9TcSAlIDk7CiAgICBzdGF0ZS5zcXVhcmVUb1Nsb3RbZnJvbVNxXSA9IC0xOwogICAgc3RhdGUuc3F1YXJlVG9TbG90W3RvU3FdID0gbW92ZXJTbG90OwogICAgc3RhdGUuc3F1YXJlQ29kZXNbZnJvbVNxXSA9IDA7CiAgICBzdGF0ZS5zcXVhcmVDb2Rlc1t0b1NxXSA9IHN0YXRlLnBpZWNlQ29kZXNbbW92ZXJTbG90XTsKICAgIGNvbnN0IG1vdmVyQ29kZSA9IHN0YXRlLnBpZWNlQ29kZXNbbW92ZXJTbG90XTsKICAgIGlmICgobW92ZXJDb2RlICYgNykgPT09IDEpIHsKICAgICAgICBpZiAobW92ZXJDb2RlIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gdG9TcTsKICAgICAgICBlbHNlIHN0YXRlLmJsYWNrR2VuZXJhbFNxID0gdG9TcTsKICAgIH0KICAgIGlmIChjYXB0dXJlZFNsb3QgPj0gMCAmJiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdICYgNykgPT09IDEpIHsKICAgICAgICBpZiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gLTE7CiAgICAgICAgZWxzZSBzdGF0ZS5ibGFja0dlbmVyYWxTcSA9IC0xOwogICAgfQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwKSBzdGF0ZS5yZWNvcmRzW2NhcHR1cmVkU2xvdF0uYWxpdmUgPSBmYWxzZTsKfTsKCmNvbnN0IHVwZGF0ZVBpZWNlU3RhdGVBZnRlclVubWFrZSA9IChib2FyZCwgZnJvbVNxLCB0b1NxKSA9PiB7CiAgICBjb25zdCBzdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOwogICAgaWYgKCFzdGF0ZSkgcmV0dXJuOwogICAgY29uc3Qgc3RhY2tJbmRleCA9IC0tc3RhdGUuc3RhY2tEZXB0aDsKICAgIGNvbnN0IG1vdmVyU2xvdCA9IHN0YXRlLm1vdmVyU3RhY2tbc3RhY2tJbmRleF07CiAgICBjb25zdCBjYXB0dXJlZFNsb3QgPSBzdGF0ZS5jYXB0dXJlZFN0YWNrW3N0YWNrSW5kZXhdOwogICAgaWYgKG1vdmVyU2xvdCA8IDApIHJldHVybjsKCiAgICBjb25zdCBtb3ZlciA9IHN0YXRlLnJlY29yZHNbbW92ZXJTbG90XTsKICAgIG1vdmVyLnNxID0gZnJvbVNxOwogICAgbW92ZXIuciA9IChmcm9tU3EgLyA5KSB8IDA7CiAgICBtb3Zlci5jID0gZnJvbVNxICUgOTsKICAgIHN0YXRlLnNxdWFyZVRvU2xvdFtmcm9tU3FdID0gbW92ZXJTbG90OwogICAgc3RhdGUuc3F1YXJlVG9TbG90W3RvU3FdID0gY2FwdHVyZWRTbG90OwogICAgc3RhdGUuc3F1YXJlQ29kZXNbZnJvbVNxXSA9IHN0YXRlLnBpZWNlQ29kZXNbbW92ZXJTbG90XTsKICAgIHN0YXRlLnNxdWFyZUNvZGVzW3RvU3FdID0gY2FwdHVyZWRTbG90ID49IDAgPyBzdGF0ZS5waWVjZUNvZGVzW2NhcHR1cmVkU2xvdF0gOiAwOwogICAgY29uc3QgbW92ZXJDb2RlID0gc3RhdGUucGllY2VDb2Rlc1ttb3ZlclNsb3RdOwogICAgaWYgKChtb3ZlckNvZGUgJiA3KSA9PT0gMSkgewogICAgICAgIGlmIChtb3ZlckNvZGUgPCA4KSBzdGF0ZS5yZWRHZW5lcmFsU3EgPSBmcm9tU3E7CiAgICAgICAgZWxzZSBzdGF0ZS5ibGFja0dlbmVyYWxTcSA9IGZyb21TcTsKICAgIH0KICAgIGlmIChjYXB0dXJlZFNsb3QgPj0gMCAmJiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdICYgNykgPT09IDEpIHsKICAgICAgICBpZiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gdG9TcTsKICAgICAgICBlbHNlIHN0YXRlLmJsYWNrR2VuZXJhbFNxID0gdG9TcTsKICAgIH0KICAgIGlmIChjYXB0dXJlZFNsb3QgPj0gMCkgc3RhdGUucmVjb3Jkc1tjYXB0dXJlZFNsb3RdLmFsaXZlID0gdHJ1ZTsKfTsKDQpjb25zdCBsb3dlc3RTZXRCaXRJbmRleCA9IChtYXNrKSA9PiAzMSAtIE1hdGguY2x6MzIobWFzayAmIC1tYXNrKTsNCg0KY29uc3QgZm9yRWFjaFNldEJpdCA9IChtYXNrLCBmbikgPT4gew0KICAgIGxldCBtID0gbWFzayA+Pj4gMDsNCiAgICB3aGlsZSAobSAhPT0gMCkgew0KICAgICAgICBjb25zdCBiaXQgPSBtICYgLW07DQogICAgICAgIGZuKDMxIC0gTWF0aC5jbHozMihiaXQpKTsNCiAgICAgICAgbSBePSBiaXQ7DQogICAgfQ0KfTsNCg0KLy8g5Li76K+E5Lyw5Ye95pWwIC0g6K+m57uG6K+E5Lyw5qOL55uY5bGA5Yq/77yIVUkgLyDngrnmo4vlhbPns7sgLyDmkJzntKLlj7YgLyDmoLnoioLngrnvvIkNCi8vIG9wdGlvbnMuZm9yU2VhcmNoTGVhZjog5LuF6Lez6L+H57uI5bGAIGdldFZhbGlkTW92ZXPvvIjml6DnnYDlt7LlnKjniLboioLngrnlpITnkIbvvInvvJvlj6/nlKjmlLvlh7vkvY3lm77ku6Pmm7/mjqfliLbogIXooagNCmNvbnN0IGV2YWx1YXRlQm9hcmQgPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJywgb3B0aW9ucyA9IG51bGwpID0+IHsKICAgIGNvbnN0IF9fdDAgPSBwZXJmb3JtYW5jZS5ub3coKTsNCiAgICAvLyDnu5/orqENCiAgICBpZiAoY3VycmVudFBsYXllcikgew0KICAgICAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50W2N1cnJlbnRQbGF5ZXJdKys7DQogICAgfQ0KICAgIGNvbnN0IGZvclNlYXJjaExlYWYgPSAhIShvcHRpb25zICYmIG9wdGlvbnMuZm9yU2VhcmNoTGVhZik7DQoNCiAgICBjb25zdCBvdXRwdXRQaGFzZSA9IGdhbWVTdGFnZTsNCg0KICAgIC8vIOmBjeWOhuaji+ebmO+8muWPquaUtumbhuWtkOWKmy9QU1TvvJvnnYDms5Ur5YWz57O757uf5LiA5ZyoIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zIOS4gOasoeWHoOS9leeUn+aIkO+8iOWvuem9kOeCru+8iQ0KICAgIGxldCBwaWVjZXNJbmZvID0gW107DQogICAgbGV0IHJlZE1hdGVyaWFsID0gMCwgcmVkUG9zaXRpb24gPSAwOw0KICAgIGxldCBibGFja01hdGVyaWFsID0gMCwgYmxhY2tQb3NpdGlvbiA9IDA7DQogICAgDQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAoIXBpZWNlKSBjb250aW51ZTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvblZhbHVlID0gZ2V0UG9zaXRpb25WYWx1ZShwaWVjZSwgciwgYyk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICByZWRNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgIHJlZFBvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGJsYWNrTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgICAgICBibGFja1Bvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7DQogICAgICAgICAgICAgICAgcGllY2UsDQogICAgICAgICAgICAgICAgciwNCiAgICAgICAgICAgICAgICBjLA0KICAgICAgICAgICAgICAgIHBpZWNlSW5kZXg6IHBpZWNlc0luZm8ubGVuZ3RoLA0KICAgICAgICAgICAgICAgIG1vdmVzOiBbXSwNCiAgICAgICAgICAgICAgICBhbGx5R3VhcmRzOiBbXSwNCiAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlLA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uVmFsdWUsDQogICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDAsDQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLA0KICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeTogW10sDQogICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLA0KICAgICAgICAgICAgICAgIGd1YXJkZWRCeTogW10sDQogICAgICAgICAgICAgICAgY29udHJvbDogW10sDQogICAgICAgICAgICAgICAgcHJvdGVjdDogW10NCiAgICAgICAgICAgIH0pOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5YWz57O7IG1hc2vvvIjiiaQzMiDlrZDvvInkvJjlhYjvvJvlkKbliJnlm57pgIDml6fliJfooaggLyDlj7bmlLvlh7vkvY3lm74NCiAgICBjb25zdCB1c2VSZWxhdGlvbk1hc2tzID0gcGllY2VzSW5mby5sZW5ndGggPD0gMzI7CiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gZmFsc2U7CiAgICBsZXQgYm9hcmRJbmZvOw0KICAgIGlmICh1c2VSZWxhdGlvbk1hc2tzKSB7DQogICAgICAgIGNsZWFyUmVsYXRpb25NYXNrcyghZm9yU2VhcmNoTGVhZik7DQogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsNCiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7DQogICAgICAgIGJvYXJkSW5mbyA9IHsNCiAgICAgICAgICAgIHVzZVJlbGF0aW9uTWFza3M6IHRydWUsDQogICAgICAgICAgICB1c2VBdHRhY2tCaXRzOiB0cnVlLA0KICAgICAgICAgICAgc2tpcENvbnRyb2xNYXNrOiAhIWZvclNlYXJjaExlYWYsDQogICAgICAgICAgICBhdHRhY2tNYXNrOiBzY3JhdGNoQXR0YWNrTWFzaywNCiAgICAgICAgICAgIGd1YXJkTWFzazogc2NyYXRjaEd1YXJkTWFzaywNCiAgICAgICAgICAgIGNvbnRyb2xNYXNrOiBzY3JhdGNoQ29udHJvbE1hc2ssDQogICAgICAgICAgICByZWRBdHRhY2s6IHNjcmF0Y2hSZWRBdHRhY2ssDQogICAgICAgICAgICBibGFja0F0dGFjazogc2NyYXRjaEJsYWNrQXR0YWNrDQogICAgICAgIH07DQogICAgfSBlbHNlIGlmICh1c2VBdHRhY2tCaXRzKSB7DQogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsNCiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7DQogICAgICAgIGJvYXJkSW5mbyA9IHsNCiAgICAgICAgICAgIHVzZUF0dGFja0JpdHM6IHRydWUsDQogICAgICAgICAgICByZWRBdHRhY2s6IHNjcmF0Y2hSZWRBdHRhY2ssDQogICAgICAgICAgICBibGFja0F0dGFjazogc2NyYXRjaEJsYWNrQXR0YWNrDQogICAgICAgIH07DQogICAgfSBlbHNlIHsNCiAgICAgICAgYm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsNCiAgICB9DQogICAgY2FsY3VsYXRlRGVyaXZlZFZhbHVlcyhib2FyZCwgcGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvLCBmb3JTZWFyY2hMZWFmKTsNCiAgICANCiAgICAvLyDnrKzkuInmraXvvJrorqHnrpfmgLvliIbvvIjlj6rorqHnrpfliankvZnliIbmlbDvvIzln7rnoYDliIbmlbDlt7LlnKjmo4vnm5jpgY3ljobml7borqHnrpfvvIkNCiAgICBsZXQgcmVkVGhyZWF0ID0gMCwgcmVkVGFjdGljID0gMCwgcmVkU2FmZXR5ID0gMCwgcmVkTW9iaWxpdHkgPSAwOw0KICAgIGxldCBibGFja1RocmVhdCA9IDAsIGJsYWNrVGFjdGljID0gMCwgYmxhY2tTYWZldHkgPSAwLCBibGFja01vYmlsaXR5ID0gMDsNCiAgICANCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBjb25zdCB7IHBpZWNlLCB0aHJlYXRWYWx1ZSwgdGFjdGljVmFsdWUsIHNhZmV0eVZhbHVlLCBtb2JpbGl0eVZhbHVlIH0gPSBpbmZvOw0KICAgICAgICANCiAgICAgICAgaWYgKHBpZWNlLmNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgcmVkVGhyZWF0ICs9IHRocmVhdFZhbHVlOw0KICAgICAgICAgICAgcmVkVGFjdGljICs9IHRhY3RpY1ZhbHVlOw0KICAgICAgICAgICAgcmVkU2FmZXR5ICs9IHNhZmV0eVZhbHVlOw0KICAgICAgICAgICAgcmVkTW9iaWxpdHkgKz0gbW9iaWxpdHlWYWx1ZTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGJsYWNrVGhyZWF0ICs9IHRocmVhdFZhbHVlOw0KICAgICAgICAgICAgYmxhY2tUYWN0aWMgKz0gdGFjdGljVmFsdWU7DQogICAgICAgICAgICBibGFja1NhZmV0eSArPSBzYWZldHlWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrTW9iaWxpdHkgKz0gbW9iaWxpdHlWYWx1ZTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICANCiAgICAvLyDorqHnrpflsYDlir/mgLvliIYNCiAgICBjb25zdCByZWRUb3RhbCA9IA0KICAgICAgICByZWRNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwgKw0KICAgICAgICByZWRQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24gKw0KICAgICAgICByZWRUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArDQogICAgICAgIHJlZFRhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljICsNCiAgICAgICAgcmVkU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHkgKw0KICAgICAgICByZWRNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7IA0KICAgIA0KICAgIGNvbnN0IGJsYWNrVG90YWwgPSANCiAgICAgICAgYmxhY2tNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwgKw0KICAgICAgICBibGFja1Bvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArDQogICAgICAgIGJsYWNrVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKw0KICAgICAgICBibGFja1RhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljICsNCiAgICAgICAgYmxhY2tTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArDQogICAgICAgIGJsYWNrTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5Ow0KICAgIA0KICAgIC8vIOi/lOWbnuivpue7huivhOS8sOe7k+aenA0KICAgIGNvbnN0IF9fZXZhbFJlc3VsdCA9IHsNCiAgICAgICAgcmVkOiB7DQogICAgICAgICAgICB0b3RhbDogcmVkVG90YWwsDQogICAgICAgICAgICBtYXRlcmlhbDogcmVkTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsLA0KICAgICAgICAgICAgcG9zaXRpb246IHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgIHRocmVhdDogcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICB0YWN0aWM6IHJlZFRhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljLA0KICAgICAgICAgICAgc2FmZXR5OiByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgIG1vYmlsaXR5OiByZWRNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksDQogICAgICAgICAgICBwaGFzZTogb3V0cHV0UGhhc2UsDQogICAgICAgICAgICB3ZWlnaHRzOiB7DQogICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAuNCwNCiAgICAgICAgICAgICAgICBwb3NpdGlvbjogMC4yLA0KICAgICAgICAgICAgICAgIHRhY3RpYzogMC4xLA0KICAgICAgICAgICAgICAgIHNhZmV0eTogMC4xLA0KICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLjA1LA0KICAgICAgICAgICAgICAgIHRocmVhdDogMC4xNQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9LA0KICAgICAgICBibGFjazogew0KICAgICAgICAgICAgdG90YWw6IGJsYWNrVG90YWwsDQogICAgICAgICAgICBtYXRlcmlhbDogYmxhY2tNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICBwb3NpdGlvbjogYmxhY2tQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sDQogICAgICAgICAgICB0aHJlYXQ6IGJsYWNrVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICB0YWN0aWM6IGJsYWNrVGFjdGljICogVkFMVUVfV0VJR0hUUy50YWN0aWMsDQogICAgICAgICAgICBzYWZldHk6IGJsYWNrU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHksDQogICAgICAgICAgICBtb2JpbGl0eTogYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksDQogICAgICAgICAgICBwaGFzZTogb3V0cHV0UGhhc2UsDQogICAgICAgICAgICB3ZWlnaHRzOiB7DQogICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAuNCwNCiAgICAgICAgICAgICAgICBwb3NpdGlvbjogMC4yLA0KICAgICAgICAgICAgICAgIHRhY3RpYzogMC4xLA0KICAgICAgICAgICAgICAgIHNhZmV0eTogMC4xLA0KICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLjA1LA0KICAgICAgICAgICAgICAgIHRocmVhdDogMC4xNQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9LA0KICAgICAgICBwaWVjZXNJbmZvOiBwaWVjZXNJbmZvLA0KICAgICAgICBnYW1lU3RhZ2U6IGdhbWVTdGFnZSwNCiAgICAgICAgYm9hcmRJbmZvOiBib2FyZEluZm8NCiAgICB9Ow0KICAgIGlmICh0eXBlb2YgcGVyZlN0YXRzICE9PSAndW5kZWZpbmVkJyAmJiBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZE1zICE9IG51bGwpIHsNCiAgICAgICAgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7DQogICAgfQ0KICAgIHJldHVybiBfX2V2YWxSZXN1bHQ7Cn07Cgpjb25zdCBldmFsdWF0ZVNlYXJjaExlYWZGYXN0ID0gKGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSkgPT4gewogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOwogICAgY29uc3QgcGllY2VzSW5mbyA9IHNjcmF0Y2hMZWFmUGllY2VzSW5mbzsKICAgIGxldCBjb3VudCA9IDA7CiAgICBsZXQgcmVkTWF0ZXJpYWwgPSAwOwogICAgbGV0IHJlZFBvc2l0aW9uID0gMDsKICAgIGxldCBibGFja01hdGVyaWFsID0gMDsKICAgIGxldCBibGFja1Bvc2l0aW9uID0gMDsKICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsKICAgIGNvbnN0IG51bWVyaWNMZWFmID0gISFwaWVjZVN0YXRlOwogICAgY29uc3QgbWF0ZXJpYWxWYWx1ZXMgPSBudW1lcmljTGVhZiA/IHNlYXJjaE1hdGVyaWFsVGFibGUoZ2FtZVN0YWdlKSA6IG51bGw7CiAgICBsZXQgb3ZlcmZsb3cgPSBmYWxzZTsKICAgIGlmIChwaWVjZVN0YXRlKSB7CiAgICAgICAgY29uc3QgcmVjb3JkcyA9IHBpZWNlU3RhdGUucmVjb3JkczsKICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJlY29yZHMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgY29uc3QgcmVjb3JkID0gcmVjb3Jkc1tpXTsKICAgICAgICAgICAgaWYgKCFyZWNvcmQuYWxpdmUpIGNvbnRpbnVlOwogICAgICAgICAgICBjb25zdCBpbmZvID0gc2NyYXRjaExlYWZQaWVjZVNsb3RzW2NvdW50KytdOwogICAgICAgICAgICBjb25zdCBwaWVjZUNvZGUgPSBwaWVjZVN0YXRlLnBpZWNlQ29kZXNbaV07CiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gbnVtZXJpY0xlYWYgPyBudWxsIDogcmVjb3JkLnBpZWNlOwogICAgICAgICAgICBjb25zdCBtYXRlcmlhbFZhbHVlID0gbnVtZXJpY0xlYWYKICAgICAgICAgICAgICAgID8gbWF0ZXJpYWxWYWx1ZXNbcGllY2VDb2RlICYgN10KICAgICAgICAgICAgICAgIDogZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKTsKICAgICAgICAgICAgY29uc3QgcG9zaXRpb25WYWx1ZSA9IG51bWVyaWNMZWFmCiAgICAgICAgICAgICAgICA/IFNFQVJDSF9QT1NJVElPTl9WQUxVRVNbcGllY2VDb2RlXVtyZWNvcmQuc3FdCiAgICAgICAgICAgICAgICA6IGdldFBvc2l0aW9uVmFsdWUocGllY2UsIHJlY29yZC5yLCByZWNvcmQuYyk7CiAgICAgICAgICAgIGluZm8ucGllY2UgPSBwaWVjZTsKICAgICAgICAgICAgaW5mby5waWVjZUNvZGUgPSBwaWVjZUNvZGU7CiAgICAgICAgICAgIGluZm8uciA9IHJlY29yZC5yOwogICAgICAgICAgICBpbmZvLmMgPSByZWNvcmQuYzsKICAgICAgICAgICAgaW5mby5zcSA9IHJlY29yZC5zcTsKICAgICAgICAgICAgaW5mby5waWVjZUluZGV4ID0gY291bnQgLSAxOwogICAgICAgICAgICBpbmZvLm1hdGVyaWFsVmFsdWUgPSBtYXRlcmlhbFZhbHVlOwogICAgICAgICAgICBpbmZvLnBvc2l0aW9uVmFsdWUgPSBwb3NpdGlvblZhbHVlOwogICAgICAgICAgICBpbmZvLnRocmVhdFZhbHVlID0gMDsKICAgICAgICAgICAgaW5mby5zYWZldHlWYWx1ZSA9IDA7CiAgICAgICAgICAgIGluZm8udGFjdGljVmFsdWUgPSAwOwogICAgICAgICAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSAwOwogICAgICAgICAgICBwaWVjZXNJbmZvW2NvdW50IC0gMV0gPSBpbmZvOwogICAgICAgICAgICBpZiAobnVtZXJpY0xlYWYgPyBwaWVjZUNvZGUgPCA4IDogcGllY2UuY29sb3IgPT09ICdyZWQnKSB7CiAgICAgICAgICAgICAgICByZWRNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOwogICAgICAgICAgICAgICAgcmVkUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGJsYWNrTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsKICAgICAgICAgICAgICAgIGJsYWNrUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0gZWxzZSB7CiAgICAgICAgc2NhbkJvYXJkOiBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgewogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsKICAgICAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOwogICAgICAgICAgICAgICAgaWYgKGNvdW50ID49IHNjcmF0Y2hMZWFmUGllY2VTbG90cy5sZW5ndGgpIHsKICAgICAgICAgICAgICAgICAgICBvdmVyZmxvdyA9IHRydWU7CiAgICAgICAgICAgICAgICAgICAgYnJlYWsgc2NhbkJvYXJkOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHNjcmF0Y2hMZWFmUGllY2VTbG90c1tjb3VudCsrXTsKICAgICAgICAgICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOwogICAgICAgICAgICAgICAgY29uc3QgcG9zaXRpb25WYWx1ZSA9IGdldFBvc2l0aW9uVmFsdWUocGllY2UsIHIsIGMpOwogICAgICAgICAgICAgICAgaW5mby5waWVjZSA9IHBpZWNlOwogICAgICAgICAgICAgICAgaW5mby5waWVjZUNvZGUgPSBzZWFyY2hQaWVjZUNvZGUocGllY2UpOwogICAgICAgICAgICAgICAgaW5mby5yID0gcjsKICAgICAgICAgICAgICAgIGluZm8uYyA9IGM7CiAgICAgICAgICAgICAgICBpbmZvLnNxID0gciAqIDkgKyBjOwogICAgICAgICAgICAgICAgaW5mby5waWVjZUluZGV4ID0gY291bnQgLSAxOwogICAgICAgICAgICAgICAgaW5mby5tYXRlcmlhbFZhbHVlID0gbWF0ZXJpYWxWYWx1ZTsKICAgICAgICAgICAgICAgIGluZm8ucG9zaXRpb25WYWx1ZSA9IHBvc2l0aW9uVmFsdWU7CiAgICAgICAgICAgICAgICBpbmZvLnRocmVhdFZhbHVlID0gMDsKICAgICAgICAgICAgICAgIGluZm8uc2FmZXR5VmFsdWUgPSAwOwogICAgICAgICAgICAgICAgaW5mby50YWN0aWNWYWx1ZSA9IDA7CiAgICAgICAgICAgICAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSAwOwogICAgICAgICAgICAgICAgcGllY2VzSW5mb1tjb3VudCAtIDFdID0gaW5mbzsKICAgICAgICAgICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsKICAgICAgICAgICAgICAgICAgICByZWRNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOwogICAgICAgICAgICAgICAgICAgIHJlZFBvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7CiAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgIGJsYWNrTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsKICAgICAgICAgICAgICAgICAgICBibGFja1Bvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9CiAgICBpZiAob3ZlcmZsb3cpIHsKICAgICAgICBjb25zdCByZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgeyBmb3JTZWFyY2hMZWFmOiB0cnVlIH0pOwogICAgICAgIGNvbnN0IG9wcG9uZW50ID0gc2VhcmNoSW5pdGlhdG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsKICAgICAgICByZXR1cm4gcmVzdWx0W3NlYXJjaEluaXRpYXRvcl0udG90YWwgLSByZXN1bHRbb3Bwb25lbnRdLnRvdGFsOwogICAgfQogICAgcGllY2VzSW5mby5sZW5ndGggPSBjb3VudDsKCiAgICBpZiAocGllY2VTdGF0ZSkgewogICAgICAgIGNhbGN1bGF0ZVBhY2tlZFNlYXJjaExlYWZSZWxhdGlvbnMocGllY2VzSW5mbywgcGllY2VTdGF0ZS5zcXVhcmVDb2Rlcyk7CiAgICAgICAgY2FsY3VsYXRlTnVtZXJpY1NlYXJjaExlYWZUaHJlYXRWYWx1ZXMocGllY2VzSW5mbywgc2VhcmNoSW5pdGlhdG9yKTsKICAgICAgICBjYWxjdWxhdGVOdW1lcmljU2VhcmNoTGVhZlNhZmV0eVZhbHVlcyhwaWVjZXNJbmZvLCBwaWVjZVN0YXRlLnNxdWFyZUNvZGVzKTsKICAgIH0gZWxzZSB7CiAgICAgICAgY2xlYXJSZWxhdGlvbk1hc2tzKHRydWUpOwogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsKICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaEJsYWNrQXR0YWNrKTsKICAgICAgICBjYWxjdWxhdGVEZXJpdmVkVmFsdWVzKGJvYXJkLCBwaWVjZXNJbmZvLCBzZWFyY2hJbml0aWF0b3IsIHNjcmF0Y2hMZWFmQm9hcmRJbmZvLCB0cnVlKTsKICAgIH0KCiAgICBsZXQgcmVkVGhyZWF0ID0gMDsKICAgIGxldCByZWRUYWN0aWMgPSAwOwogICAgbGV0IHJlZFNhZmV0eSA9IDA7CiAgICBsZXQgcmVkTW9iaWxpdHkgPSAwOwogICAgbGV0IGJsYWNrVGhyZWF0ID0gMDsKICAgIGxldCBibGFja1RhY3RpYyA9IDA7CiAgICBsZXQgYmxhY2tTYWZldHkgPSAwOwogICAgbGV0IGJsYWNrTW9iaWxpdHkgPSAwOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7CiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07CiAgICAgICAgaWYgKG51bWVyaWNMZWFmID8gaW5mby5waWVjZUNvZGUgPCA4IDogaW5mby5waWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsKICAgICAgICAgICAgcmVkVGhyZWF0ICs9IGluZm8udGhyZWF0VmFsdWU7CiAgICAgICAgICAgIHJlZFRhY3RpYyArPSBpbmZvLnRhY3RpY1ZhbHVlOwogICAgICAgICAgICByZWRTYWZldHkgKz0gaW5mby5zYWZldHlWYWx1ZTsKICAgICAgICAgICAgcmVkTW9iaWxpdHkgKz0gaW5mby5tb2JpbGl0eVZhbHVlOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGJsYWNrVGhyZWF0ICs9IGluZm8udGhyZWF0VmFsdWU7CiAgICAgICAgICAgIGJsYWNrVGFjdGljICs9IGluZm8udGFjdGljVmFsdWU7CiAgICAgICAgICAgIGJsYWNrU2FmZXR5ICs9IGluZm8uc2FmZXR5VmFsdWU7CiAgICAgICAgICAgIGJsYWNrTW9iaWxpdHkgKz0gaW5mby5tb2JpbGl0eVZhbHVlOwogICAgICAgIH0KICAgIH0KCiAgICBjb25zdCByZWRUb3RhbCA9CiAgICAgICAgcmVkTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsKICAgICAgICByZWRQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24gKwogICAgICAgIHJlZFRocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsKICAgICAgICByZWRUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArCiAgICAgICAgcmVkU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHkgKwogICAgICAgIHJlZE1vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsKICAgIGNvbnN0IGJsYWNrVG90YWwgPQogICAgICAgIGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsKICAgICAgICBibGFja1Bvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArCiAgICAgICAgYmxhY2tUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArCiAgICAgICAgYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArCiAgICAgICAgYmxhY2tTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArCiAgICAgICAgYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7CgogICAgcGVyZlN0YXRzLmZhc3RMZWFmRXZhbENvdW50Kys7CiAgICBwZXJmU3RhdHMuZmFzdExlYWZFdmFsTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOwogICAgcmV0dXJuIHNlYXJjaEluaXRpYXRvciA9PT0gJ3JlZCcgPyByZWRUb3RhbCAtIGJsYWNrVG90YWwgOiBibGFja1RvdGFsIC0gcmVkVG90YWw7Cn07Cg0KLy8g5bCGL+W4heS9jee9rue8k+WtmO+8muS+myBwb3N0LW1vdmUgaXNDaGVjayAvIOmjnuWwhuW/q+mAn+afpeivou+8jOeUsSBtYWtlL3VubWFrZSDnu7TmiqQNCmxldCBnZW5lcmFsUG9zQ2FjaGUgPSB7IHJlZDogbnVsbCwgYmxhY2s6IG51bGwgfTsNCg0KLy8g5bCG5biF5LuF5Zyo5Lmd5a6r5YaF77yM5oyJ5Lmd5a6r5omr5o+P5Y2z5Y+vDQpjb25zdCBmaW5kR2VuZXJhbFBvcyA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBjb25zdCByb3dTdGFydCA9IGNvbG9yID09PSAncmVkJyA/IDAgOiA3Ow0KICAgIGNvbnN0IHJvd0VuZCA9IGNvbG9yID09PSAncmVkJyA/IDIgOiA5Ow0KICAgIGZvciAobGV0IHIgPSByb3dTdGFydDsgciA8PSByb3dFbmQ7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMzsgYyA8PSA1OyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmIChwICYmIHAudHlwZSA9PT0gJ2dlbmVyYWwnICYmIHAuY29sb3IgPT09IGNvbG9yKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsgciwgYyB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiBudWxsOw0KfTsNCg0KY29uc3Qgc3luY0dlbmVyYWxQb3NDYWNoZSA9IChib2FyZCkgPT4gew0KICAgIGdlbmVyYWxQb3NDYWNoZS5yZWQgPSBmaW5kR2VuZXJhbFBvcyhib2FyZCwgJ3JlZCcpOw0KICAgIGdlbmVyYWxQb3NDYWNoZS5ibGFjayA9IGZpbmRHZW5lcmFsUG9zKGJvYXJkLCAnYmxhY2snKTsNCn07DQoNCmNvbnN0IGdldEdlbmVyYWxQb3MgPSAoYm9hcmQsIGNvbG9yKSA9PiB7DQogICAgY29uc3QgY2FjaGVkID0gZ2VuZXJhbFBvc0NhY2hlW2NvbG9yXTsNCiAgICBpZiAoY2FjaGVkKSB7DQogICAgICAgIGNvbnN0IHAgPSBib2FyZFtjYWNoZWQucl0/LltjYWNoZWQuY107DQogICAgICAgIGlmIChwICYmIHAudHlwZSA9PT0gJ2dlbmVyYWwnICYmIHAuY29sb3IgPT09IGNvbG9yKSB7DQogICAgICAgICAgICByZXR1cm4gY2FjaGVkOw0KICAgICAgICB9DQogICAgfQ0KICAgIGNvbnN0IHBvcyA9IGZpbmRHZW5lcmFsUG9zKGJvYXJkLCBjb2xvcik7DQogICAgZ2VuZXJhbFBvc0NhY2hlW2NvbG9yXSA9IHBvczsNCiAgICByZXR1cm4gcG9zOw0KfTsNCg0KLy8g5pCc57Si55So5Y6f5Zyw6LWw5a2QIC8g5oGi5aSN77yI6YG/5YWN5q+P5qyh6YCS5b2SIGJvYXJkLm1hcO+8ie+8m+WQjOatpee7tOaKpOWwhuS9jee8k+WtmA0KY29uc3QgbWFrZU1vdmUgPSAoYm9hcmQsIGZyb20sIHRvKSA9PiB7CiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsKICAgIGNvbnN0IGNhcHR1cmVkID0gYm9hcmRbdG8ucl1bdG8uY107CiAgICBib2FyZFt0by5yXVt0by5jXSA9IHBpZWNlOwogICAgYm9hcmRbZnJvbS5yXVtmcm9tLmNdID0gbnVsbDsKICAgIHVwZGF0ZVBpZWNlU3RhdGVBZnRlck1ha2UoYm9hcmQsIGZyb20uciAqIDkgKyBmcm9tLmMsIHRvLnIgKiA5ICsgdG8uYyk7CiAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtwaWVjZS5jb2xvcl0gPSB7IHI6IHRvLnIsIGM6IHRvLmMgfTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0gbnVsbDsNCiAgICB9DQogICAgcmV0dXJuIGNhcHR1cmVkOw0KfTsNCg0KY29uc3QgdW5tYWtlTW92ZSA9IChib2FyZCwgZnJvbSwgdG8sIGNhcHR1cmVkKSA9PiB7CiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOw0KICAgIGJvYXJkW2Zyb20ucl1bZnJvbS5jXSA9IHBpZWNlOwogICAgYm9hcmRbdG8ucl1bdG8uY10gPSBjYXB0dXJlZDsKICAgIHVwZGF0ZVBpZWNlU3RhdGVBZnRlclVubWFrZShib2FyZCwgZnJvbS5yICogOSArIGZyb20uYywgdG8uciAqIDkgKyB0by5jKTsKICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogZnJvbS5yLCBjOiBmcm9tLmMgfTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0geyByOiB0by5yLCBjOiB0by5jIH07DQogICAgfQ0KfTsNCg0KLy8g6LWw5a2Q5ZCO5piv5ZCm5L2/5bex5pa55bCG5LiN5a6J5YWo77yI6aOe5bCG5oiW6KKr5bCG77yJ44CC6LCD55So5YmN6aG75beyIG1ha2VNb3Zl44CCDQpjb25zdCBsZWF2ZXNPd25LaW5nVW5zYWZlID0gKGJvYXJkLCBjb2xvcikgPT4gewogICAgY29uc3QgX190MCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOwogICAgcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzKys7CiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7CiAgICBjb25zdCB1bnNhZmUgPSBwaWVjZVN0YXRlID8gaXNDaGVja1Jhd0Zyb21QaWVjZVN0YXRlKHBpZWNlU3RhdGUsIGNvbG9yKSA6IChpc0ZseWluZ0dlbmVyYWwoYm9hcmQpIHx8IGlzQ2hlY2tSYXcoYm9hcmQsIGNvbG9yKSk7CiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOwogICAgcmV0dXJuIHVuc2FmZTsKfTsKDQovLyDku47kvKrlkIjms5XnnYDms5XkuK3ov4fmu6Tlh7rkuI3pgIHlsIYv5LiN6aOe5bCG55qE5ZCI5rOV552A5rOV77yIVUkv5qC56IqC54K5L+W8gOWxgOW6k+agoemqjO+8iQ0KLy8g5pCc57Si54Ot6Lev5b6E5L2/55So5bu26L+f5ZCI5rOV5oCn77yI6K+V6LWw5pe25qOA5rWL77yJ77yM6YG/5YWN5a+55Ymq5p6d5pyq6Kem5Y+K55qE552A5rOV5YGa5YWo6YeP6L+H5rukDQpjb25zdCBmaWx0ZXJMZWdhbE1vdmVzID0gKGJvYXJkLCBmcm9tLCBwaWVjZSwgcHNldWRvTW92ZXMpID0+IHsNCiAgICBjb25zdCB2YWxpZE1vdmVzID0gW107DQogICAgZm9yIChjb25zdCB0byBvZiBwc2V1ZG9Nb3Zlcykgew0KICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VNb3ZlKGJvYXJkLCBmcm9tLCB0byk7DQogICAgICAgIGNvbnN0IGlsbGVnYWwgPSBsZWF2ZXNPd25LaW5nVW5zYWZlKGJvYXJkLCBwaWVjZS5jb2xvcik7DQogICAgICAgIHVubWFrZU1vdmUoYm9hcmQsIGZyb20sIHRvLCBjYXB0dXJlZCk7DQogICAgICAgIGlmICghaWxsZWdhbCkgdmFsaWRNb3Zlcy5wdXNoKHRvKTsNCiAgICB9DQogICAgcmV0dXJuIHZhbGlkTW92ZXM7DQp9Ow0KDQovLyBTZWFyY2ggaG90IHBhdGggbW92ZSBlbmNvZGluZzogbW92ZSA9IChmcm9tU3EgPDwgNykgfCB0b1NxLg0KY29uc3QgTU9WRV9UT19NQVNLID0gMHg3ZjsNCmNvbnN0IGVuY29kZU1vdmUgPSAoZnJvbSwgdG8pID0+ICgoZnJvbS5yICogOSArIGZyb20uYykgPDwgNykgfCAodG8uciAqIDkgKyB0by5jKTsNCmNvbnN0IGVuY29kZU1vdmVGcm9tQ29vcmRzID0gKGZyLCBmYywgdHIsIHRjKSA9PiAoKGZyICogOSArIGZjKSA8PCA3KSB8ICh0ciAqIDkgKyB0Yyk7DQpjb25zdCBpc0VuY29kZWRNb3ZlID0gKG1vdmUpID0+IHR5cGVvZiBtb3ZlID09PSAnbnVtYmVyJzsNCmNvbnN0IG1vdmVGcm9tU3EgPSAobW92ZSkgPT4gaXNFbmNvZGVkTW92ZShtb3ZlKSA/IChtb3ZlID4+PiA3KSA6IG1vdmUuZnJvbS5yICogOSArIG1vdmUuZnJvbS5jOw0KY29uc3QgbW92ZVRvU3EgPSAobW92ZSkgPT4gaXNFbmNvZGVkTW92ZShtb3ZlKSA/IChtb3ZlICYgTU9WRV9UT19NQVNLKSA6IG1vdmUudG8uciAqIDkgKyBtb3ZlLnRvLmM7DQpjb25zdCBtb3ZlRnJvbVIgPSAobW92ZSkgPT4gew0KICAgIGNvbnN0IHNxID0gbW92ZUZyb21TcShtb3ZlKTsNCiAgICByZXR1cm4gKHNxIC8gOSkgfCAwOw0KfTsNCmNvbnN0IG1vdmVGcm9tQyA9IChtb3ZlKSA9PiBtb3ZlRnJvbVNxKG1vdmUpICUgOTsNCmNvbnN0IG1vdmVUb1IgPSAobW92ZSkgPT4gew0KICAgIGNvbnN0IHNxID0gbW92ZVRvU3EobW92ZSk7DQogICAgcmV0dXJuIChzcSAvIDkpIHwgMDsNCn07DQpjb25zdCBtb3ZlVG9DID0gKG1vdmUpID0+IG1vdmVUb1NxKG1vdmUpICUgOTsNCmNvbnN0IG1vdmVUb09iamVjdCA9IChtb3ZlKSA9PiB7DQogICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSByZXR1cm4gbW92ZTsNCiAgICBjb25zdCBmcm9tID0gbW92ZUZyb21TcShtb3ZlKTsNCiAgICBjb25zdCB0byA9IG1vdmVUb1NxKG1vdmUpOw0KICAgIHJldHVybiB7DQogICAgICAgIGZyb206IHsgcjogKGZyb20gLyA5KSB8IDAsIGM6IGZyb20gJSA5IH0sDQogICAgICAgIHRvOiB7IHI6ICh0byAvIDkpIHwgMCwgYzogdG8gJSA5IH0NCiAgICB9Ow0KfTsNCg0KY29uc3QgbWFrZVNlYXJjaE1vdmUgPSAoYm9hcmQsIG1vdmUpID0+IHsNCiAgICBpZiAoIWlzRW5jb2RlZE1vdmUobW92ZSkpIHJldHVybiBtYWtlTW92ZShib2FyZCwgbW92ZS5mcm9tLCBtb3ZlLnRvKTsNCiAgICBjb25zdCBmcm9tID0gbW92ZSA+Pj4gNzsNCiAgICBjb25zdCB0byA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7DQogICAgY29uc3QgZnIgPSAoZnJvbSAvIDkpIHwgMCwgZmMgPSBmcm9tICUgOTsNCiAgICBjb25zdCB0ciA9ICh0byAvIDkpIHwgMCwgdGMgPSB0byAlIDk7DQogICAgY29uc3QgcGllY2UgPSBib2FyZFtmcl1bZmNdOw0KICAgIGNvbnN0IGNhcHR1cmVkID0gYm9hcmRbdHJdW3RjXTsKICAgIGJvYXJkW3RyXVt0Y10gPSBwaWVjZTsKICAgIGJvYXJkW2ZyXVtmY10gPSBudWxsOwogICAgdXBkYXRlUGllY2VTdGF0ZUFmdGVyTWFrZShib2FyZCwgZnJvbSwgdG8pOwogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbcGllY2UuY29sb3JdID0geyByOiB0ciwgYzogdGMgfTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0gbnVsbDsNCiAgICB9DQogICAgcmV0dXJuIGNhcHR1cmVkOw0KfTsNCg0KY29uc3QgdW5tYWtlU2VhcmNoTW92ZSA9IChib2FyZCwgbW92ZSwgY2FwdHVyZWQpID0+IHsNCiAgICBpZiAoIWlzRW5jb2RlZE1vdmUobW92ZSkpIHsNCiAgICAgICAgdW5tYWtlTW92ZShib2FyZCwgbW92ZS5mcm9tLCBtb3ZlLnRvLCBjYXB0dXJlZCk7DQogICAgICAgIHJldHVybjsNCiAgICB9DQogICAgY29uc3QgZnJvbSA9IG1vdmUgPj4+IDc7DQogICAgY29uc3QgdG8gPSBtb3ZlICYgTU9WRV9UT19NQVNLOw0KICAgIGNvbnN0IGZyID0gKGZyb20gLyA5KSB8IDAsIGZjID0gZnJvbSAlIDk7DQogICAgY29uc3QgdHIgPSAodG8gLyA5KSB8IDAsIHRjID0gdG8gJSA5Ow0KICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbdHJdW3RjXTsKICAgIGJvYXJkW2ZyXVtmY10gPSBwaWVjZTsKICAgIGJvYXJkW3RyXVt0Y10gPSBjYXB0dXJlZDsKICAgIHVwZGF0ZVBpZWNlU3RhdGVBZnRlclVubWFrZShib2FyZCwgZnJvbSwgdG8pOwogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbcGllY2UuY29sb3JdID0geyByOiBmciwgYzogZmMgfTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0geyByOiB0ciwgYzogdGMgfTsNCiAgICB9DQp9Ow0KDQpjb25zdCBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaCA9IFtdOw0KY29uc3Qgc29ydE1vdmVTY29yZVNjcmF0Y2ggPSBbXTsNCmNvbnN0IHNxdWFyZU1hcmtTY3JhdGNoID0gbmV3IFVpbnQ4QXJyYXkoUkVMX1NRVUFSRVMpOw0KY29uc3Qgc3F1YXJlTWFya1RvdWNoZWQgPSBbXTsNCg0KY29uc3QgbWFya1NvcnRTcXVhcmUgPSAoc3EpID0+IHsNCiAgICBpZiAoIXNxdWFyZU1hcmtTY3JhdGNoW3NxXSkgew0KICAgICAgICBzcXVhcmVNYXJrU2NyYXRjaFtzcV0gPSAxOw0KICAgICAgICBzcXVhcmVNYXJrVG91Y2hlZC5wdXNoKHNxKTsNCiAgICB9DQp9Ow0KDQpjb25zdCBjbGVhclNvcnRTcXVhcmVNYXJrcyA9ICgpID0+IHsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNxdWFyZU1hcmtUb3VjaGVkLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIHNxdWFyZU1hcmtTY3JhdGNoW3NxdWFyZU1hcmtUb3VjaGVkW2ldXSA9IDA7DQogICAgfQ0KICAgIHNxdWFyZU1hcmtUb3VjaGVkLmxlbmd0aCA9IDA7DQp9Ow0KDQpjb25zdCBzb3J0TW92ZXNGYXN0ID0gKG1vdmVzLCBib2FyZCwgY3VycmVudFBsYXllciwgcGllY2VzSW5mbywgZ2FtZVN0YWdlID0gJ21pZCcsIGJvYXJkSW5mbyA9IG51bGwsIHNlYXJjaEhldXJpc3RpY3MgPSBudWxsKSA9PiB7CiAgICBjb25zdCBfX3QwID0gU0VBUkNIX1BST0ZJTEUgPyBwZXJmb3JtYW5jZS5ub3coKSA6IDA7CiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5zb3J0TW92ZXNDb3VudCsrOwogICAgY29uc3QgY3VycmVudElzSW5DaGVjayA9IGJvYXJkSW5mbw0KICAgICAgICA/ICgoY3VycmVudFBsYXllciA9PT0gJ3JlZCcgJiYgYm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwNCiAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgJiYgYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKSkNCiAgICAgICAgOiBpc0NoZWNrKGJvYXJkLCBjdXJyZW50UGxheWVyKTsNCg0KICAgIGlmIChjdXJyZW50SXNJbkNoZWNrICYmIHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7DQogICAgICAgIGxldCBnZW5lcmFsSW5mbyA9IG51bGw7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07DQogICAgICAgICAgICBpZiAoaW5mby5waWVjZSAmJiBpbmZvLnBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBpbmZvLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgZ2VuZXJhbEluZm8gPSBpbmZvOw0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmIChnZW5lcmFsSW5mbykgew0KICAgICAgICAgICAgaWYgKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcykgew0KICAgICAgICAgICAgICAgIGxldCBtID0gYm9hcmRJbmZvLmF0dGFja01hc2tbZ2VuZXJhbEluZm8uciAqIDkgKyBnZW5lcmFsSW5mby5jXSA+Pj4gMDsNCiAgICAgICAgICAgICAgICB3aGlsZSAobSAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBiaXQgPSBtICYgLW07DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHQgPSBwaWVjZXNJbmZvWzMxIC0gTWF0aC5jbHozMihiaXQpXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHQgJiYgdC5waWVjZSAmJiB0LnBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBtYXJrU29ydFNxdWFyZSh0LnIgKiA5ICsgdC5jKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBtIF49IGJpdDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKGdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgew0KICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5Lmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHQgPSBnZW5lcmFsSW5mby50aHJlYXRlbmVkQnlbaV07DQogICAgICAgICAgICAgICAgICAgIGlmICh0LnBpZWNlICYmIHQucGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtTb3J0U3F1YXJlKHQuciAqIDkgKyB0LmMpOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3QgaGFzVGhyZWF0ZW5lZCA9ICFjdXJyZW50SXNJbkNoZWNrICYmICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5sZW5ndGggPiAwKTsNCiAgICBpZiAoaGFzVGhyZWF0ZW5lZCkgew0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXNbaV07DQogICAgICAgICAgICBtYXJrU29ydFNxdWFyZShwLnIgKiA5ICsgcC5jKTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBjb25zdCB0aHJlYXRlbmVkTWFya0VuZCA9IHNxdWFyZU1hcmtUb3VjaGVkLmxlbmd0aDsNCg0KICAgIGNvbnN0IGhhc0NhbkNhcHR1cmUgPSAhY3VycmVudElzSW5DaGVjayAmJiAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUgJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUubGVuZ3RoID4gMCk7DQogICAgaWYgKGhhc0NhbkNhcHR1cmUpIHsNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2FyZEluZm8uY2FuQ2FwdHVyZS5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkSW5mby5jYW5DYXB0dXJlW2ldOw0KICAgICAgICAgICAgbWFya1NvcnRTcXVhcmUocC5yICogOSArIHAuYyk7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBjb25zdCB0dE1vdmUgPSBzZWFyY2hIZXVyaXN0aWNzPy50dE1vdmUgfHwgbnVsbDsKICAgIGNvbnN0IGtpbGxlcnMgPSBzZWFyY2hIZXVyaXN0aWNzPy5raWxsZXJzIHx8IG51bGw7CiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7CiAgICBjb25zdCB1c2VTaW1wbGVTZWFyY2hTb3J0ID0gcGllY2VTdGF0ZSAmJiAhY3VycmVudElzSW5DaGVjayAmJiAhaGFzVGhyZWF0ZW5lZCAmJiAhaGFzQ2FuQ2FwdHVyZTsKICAgIGNvbnN0IGlzTWFya2VkVGhyZWF0ZW5lZCA9IChzcSkgPT4gewogICAgICAgIGlmICghaGFzVGhyZWF0ZW5lZCkgcmV0dXJuIGZhbHNlOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRocmVhdGVuZWRNYXJrRW5kOyBpKyspIHsNCiAgICAgICAgICAgIGlmIChzcXVhcmVNYXJrVG91Y2hlZFtpXSA9PT0gc3EpIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBmYWxzZTsNCiAgICB9Ow0KDQogICAgaWYgKHVzZVNpbXBsZVNlYXJjaFNvcnQpIHsKICAgICAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsKICAgICAgICBjb25zdCBwaWVjZUNvZGVzID0gcGllY2VTdGF0ZS5waWVjZUNvZGVzOwogICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWVzID0gc2VhcmNoTWF0ZXJpYWxUYWJsZShnYW1lU3RhZ2UpOwogICAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBtb3Zlcy5sZW5ndGg7IGluZGV4KyspIHsKICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2luZGV4XTsKICAgICAgICAgICAgY29uc3QgZnJvbVNxID0gbW92ZSA+Pj4gNzsKICAgICAgICAgICAgY29uc3QgdG9TcSA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7CiAgICAgICAgICAgIGNvbnN0IHRhcmdldFNsb3QgPSBzcXVhcmVUb1Nsb3RbdG9TcV07CiAgICAgICAgICAgIGNvbnN0IHRhcmdldFBpZWNlQ29kZSA9IHRhcmdldFNsb3QgPj0gMCA/IHBpZWNlQ29kZXNbdGFyZ2V0U2xvdF0gOiAwOwogICAgICAgICAgICBsZXQgcHJpb3JpdHkgPSA0OwogICAgICAgICAgICBsZXQgc2NvcmUgPSAwOwoKICAgICAgICAgICAgaWYgKHR0TW92ZSA9PT0gbW92ZSkgewogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAtMTsKICAgICAgICAgICAgICAgIHNjb3JlID0gMTAwMDAwMDsKICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRTbG90ID49IDApIHsKICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMzsKICAgICAgICAgICAgICAgIHNjb3JlID0gbWF0ZXJpYWxWYWx1ZXNbdGFyZ2V0UGllY2VDb2RlICYgN10gKiAxNiAtIG1hdGVyaWFsVmFsdWVzW3BpZWNlQ29kZXNbc3F1YXJlVG9TbG90W2Zyb21TcV1dICYgN107CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIGlmIChwcmlvcml0eSA+PSAwKSB7CiAgICAgICAgICAgICAgICBpZiAodGFyZ2V0U2xvdCA8IDAgJiYga2lsbGVycyAmJiBtb3ZlID09PSBraWxsZXJzWzBdKSB7CiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7CiAgICAgICAgICAgICAgICAgICAgc2NvcmUgKz0gODAwMDsKICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0U2xvdCA8IDAgJiYga2lsbGVycyAmJiBtb3ZlID09PSBraWxsZXJzWzFdKSB7CiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7CiAgICAgICAgICAgICAgICAgICAgc2NvcmUgKz0gNzAwMDsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIHNjb3JlICs9IGdldEhpc3RvcnlTY29yZShtb3ZlKTsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaW5kZXhdID0gcHJpb3JpdHk7CiAgICAgICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2luZGV4XSA9IHNjb3JlOwogICAgICAgIH0KICAgIH0gZWxzZSBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbW92ZXMubGVuZ3RoOyBpbmRleCsrKSB7CiAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2luZGV4XTsNCiAgICAgICAgY29uc3QgZnJvbVNxID0gbW92ZUZyb21TcShtb3ZlKTsNCiAgICAgICAgY29uc3QgdG9TcSA9IG1vdmVUb1NxKG1vdmUpOw0KICAgICAgICBjb25zdCBmcm9tUiA9IChmcm9tU3EgLyA5KSB8IDAsIGZyb21DID0gZnJvbVNxICUgOTsNCiAgICAgICAgY29uc3QgdG9SID0gKHRvU3EgLyA5KSB8IDAsIHRvQyA9IHRvU3EgJSA5Ow0KICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2Zyb21SXVtmcm9tQ107DQogICAgICAgIGNvbnN0IHBpZWNlVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCB0YXJnZXRQaWVjZSA9IGJvYXJkW3RvUl1bdG9DXTsNCiAgICAgICAgY29uc3QgdGFyZ2V0UGllY2VWYWx1ZSA9IHRhcmdldFBpZWNlID8gZ2V0TWF0ZXJpYWxWYWx1ZSh0YXJnZXRQaWVjZSwgZ2FtZVN0YWdlKSA6IDA7DQogICAgICAgIGxldCBwcmlvcml0eSA9IDQ7DQogICAgICAgIGxldCBzY29yZSA9IDA7DQoNCiAgICAgICAgaWYgKHR0TW92ZSAmJiBpc1NhbWVNb3ZlKG1vdmUsIHR0TW92ZSkpIHsNCiAgICAgICAgICAgIHByaW9yaXR5ID0gLTE7DQogICAgICAgICAgICBzY29yZSA9IDEwMDAwMDA7DQogICAgICAgIH0gZWxzZSBpZiAoY3VycmVudElzSW5DaGVjaykgew0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZXNDaGVja2VyID0gdGFyZ2V0UGllY2UgJiYgc3F1YXJlTWFya1NjcmF0Y2hbdG9TcV0gIT09IDA7DQogICAgICAgICAgICBpZiAoY2FwdHVyZXNDaGVja2VyKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAwOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gMTAwMDAgKyB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMjsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWUgKiAxNiAtIHBpZWNlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHBpZWNlVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoaGFzVGhyZWF0ZW5lZCkgew0KICAgICAgICAgICAgaWYgKGlzTWFya2VkVGhyZWF0ZW5lZChmcm9tU3EpKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAxOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gcGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IGhhc0NhbkNhcHR1cmUgJiYgc3F1YXJlTWFya1NjcmF0Y2hbdG9TcV0gIT09IDAgPyAyIDogMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoaGFzQ2FuQ2FwdHVyZSkgew0KICAgICAgICAgICAgaWYgKHNxdWFyZU1hcmtTY3JhdGNoW3RvU3FdICE9PSAwKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7DQogICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWUgKiAxNiAtIHBpZWNlVmFsdWU7DQogICAgICAgIH0NCg0KICAgICAgICBpZiAocHJpb3JpdHkgPj0gMCkgew0KICAgICAgICAgICAgaWYgKCF0YXJnZXRQaWVjZSAmJiBraWxsZXJzICYmIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc1swXSkpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IE1hdGgubWluKHByaW9yaXR5LCAyKTsNCiAgICAgICAgICAgICAgICBzY29yZSArPSA4MDAwOw0KICAgICAgICAgICAgfSBlbHNlIGlmICghdGFyZ2V0UGllY2UgJiYga2lsbGVycyAmJiBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNbMV0pKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7DQogICAgICAgICAgICAgICAgc2NvcmUgKz0gNzAwMDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHNjb3JlICs9IGdldEhpc3RvcnlTY29yZShtb3ZlKTsNCiAgICAgICAgfQ0KDQogICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2luZGV4XSA9IHByaW9yaXR5Ow0KICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtpbmRleF0gPSBzY29yZTsNCiAgICAgICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSB7DQogICAgICAgICAgICBtb3ZlLnByaW9yaXR5ID0gcHJpb3JpdHk7DQogICAgICAgICAgICBtb3ZlLnNvcnRTY29yZSA9IHNjb3JlOw0KICAgICAgICAgICAgbW92ZS5vcmlnaW5hbEluZGV4ID0gaW5kZXg7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBmb3IgKGxldCBpID0gMTsgaSA8IG1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpXTsNCiAgICAgICAgY29uc3QgcHJpb3JpdHkgPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtpXTsNCiAgICAgICAgY29uc3Qgc2NvcmUgPSBzb3J0TW92ZVNjb3JlU2NyYXRjaFtpXTsNCiAgICAgICAgbGV0IGogPSBpIC0gMTsNCiAgICAgICAgd2hpbGUgKA0KICAgICAgICAgICAgaiA+PSAwICYmDQogICAgICAgICAgICAoc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbal0gPiBwcmlvcml0eSB8fA0KICAgICAgICAgICAgIChzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXSA9PT0gcHJpb3JpdHkgJiYgc29ydE1vdmVTY29yZVNjcmF0Y2hbal0gPCBzY29yZSkpDQogICAgICAgICkgew0KICAgICAgICAgICAgbW92ZXNbaiArIDFdID0gbW92ZXNbal07DQogICAgICAgICAgICBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqICsgMV0gPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXTsNCiAgICAgICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2ogKyAxXSA9IHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2pdOw0KICAgICAgICAgICAgai0tOw0KICAgICAgICB9DQogICAgICAgIG1vdmVzW2ogKyAxXSA9IG1vdmU7DQogICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2ogKyAxXSA9IHByaW9yaXR5Ow0KICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqICsgMV0gPSBzY29yZTsNCiAgICB9DQoNCiAgICBjbGVhclNvcnRTcXVhcmVNYXJrcygpOwogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuc29ydE1vdmVzTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOwogICAgcmV0dXJuIG1vdmVzOwp9OwoNCi8vIOaQnOe0oueUqOedgOazleWHhuWkh++8iOi9u+mHj++8ie+8muS4jeW7uuWFs+ezu+Wbvi/lqIHog4Ev5py65Yqo5oCnDQovLyBTRUFSQ0hfREVGRVJfTEVHQUxJVFk9dHJ1Ze+8muWPqueUn+aIkOS8quWQiOazle+8jOWQiOazleaAp+WcqOivlei1sOaXtuajgOa1iw0KLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPWZhbHNl77ya6aKE6L+H5ruk5ZCI5rOV552A77yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQ0KLy8g54K55qOL5YWz57O75LuN6LWw5a6M5pW0IGV2YWx1YXRlQm9hcmTvvIzkuI3lj5flvbHlk40NCmNvbnN0IHByZXBhcmVTZWFyY2hJbmZvID0gKGJvYXJkLCBjdXJyZW50UGxheWVyKSA9PiB7DQogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOwogICAgcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnRbY3VycmVudFBsYXllcl0rKzsNCg0KICAgIGNvbnN0IGluQ2hlY2sgPSBpc0NoZWNrUmF3KGJvYXJkLCBjdXJyZW50UGxheWVyKTsKICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnByZXBhcmVDaGVja01zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsKICAgIGNvbnN0IF9fbW92ZXNUMCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOwogICAgY29uc3QgcGllY2VzSW5mbyA9IFtdOwogICAgY29uc3QgbGVnYWxNb3ZlTGlzdCA9IFtdOwogICAgY29uc3QgZGVmZXIgPSB0cnVlOwogICAgY29uc3QgcGllY2VTdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOwoKICAgIGlmIChwaWVjZVN0YXRlKSB7CiAgICAgICAgY29uc3QgcmVjb3JkcyA9IHBpZWNlU3RhdGUucmVjb3JkczsKICAgICAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsKICAgICAgICBjb25zdCBzcXVhcmVDb2RlcyA9IHBpZWNlU3RhdGUuc3F1YXJlQ29kZXM7CiAgICAgICAgY29uc3QgcGllY2VDb2RlcyA9IHBpZWNlU3RhdGUucGllY2VDb2RlczsKICAgICAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsKICAgICAgICAgICAgY29uc3Qgc2xvdCA9IHNxdWFyZVRvU2xvdFtzcV07CiAgICAgICAgICAgIGlmIChzbG90IDwgMCkgY29udGludWU7CiAgICAgICAgICAgIGNvbnN0IHJlY29yZCA9IHJlY29yZHNbc2xvdF07CiAgICAgICAgICAgIGlmICghcmVjb3JkLmFsaXZlIHx8IHJlY29yZC5waWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7CiAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7IHBpZWNlOiByZWNvcmQucGllY2UsIHI6IHJlY29yZC5yLCBjOiByZWNvcmQuYyB9KTsKICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IGFwcGVuZFNlYXJjaFBzZXVkb01vdmVzRm9yUGllY2UoCiAgICAgICAgICAgICAgICBsZWdhbE1vdmVMaXN0LCBzcSwgcGllY2VDb2Rlc1tzbG90XSwgc3F1YXJlQ29kZXMsIGZhbHNlCiAgICAgICAgICAgICk7CiAgICAgICAgfQogICAgfSBlbHNlIHsKICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgewogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsKICAgICAgICAgICAgICAgIGlmICghcGllY2UgfHwgcGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIGNvbnRpbnVlOwogICAgICAgICAgICAgICAgY29uc3QgZnJvbSA9IHsgciwgYyB9OwogICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCBmcm9tLCBwaWVjZSk7CiAgICAgICAgICAgICAgICBjb25zdCB1c2VNb3ZlcyA9IGRlZmVyID8gbW92ZXMgOiBmaWx0ZXJMZWdhbE1vdmVzKGJvYXJkLCBmcm9tLCBwaWVjZSwgbW92ZXMpOwogICAgICAgICAgICAgICAgcGllY2VzSW5mby5wdXNoKHsgcGllY2UsIHIsIGMsIG1vdmVzLCBsZWdhbE1vdmVzOiB1c2VNb3ZlcyB9KTsKICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdXNlTW92ZXMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCB0byA9IHVzZU1vdmVzW2ldOwogICAgICAgICAgICAgICAgICAgIGxlZ2FsTW92ZUxpc3QucHVzaChlbmNvZGVNb3ZlRnJvbUNvb3JkcyhyLCBjLCB0by5yLCB0by5jKSk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgKz0gbW92ZXMubGVuZ3RoOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMucHJlcGFyZU1vdmVHZW5NcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fbW92ZXNUMDsKDQogICAgLy8g6L276YePIGJvYXJkSW5mb++8muS7heiiq+Wwhuagh+W/lw0KICAgIGNvbnN0IGJvYXJkSW5mbyA9IHsNCiAgICAgICAgcmVkSXNJbkNoZWNrOiBjdXJyZW50UGxheWVyID09PSAncmVkJyA/IGluQ2hlY2sgOiBmYWxzZSwNCiAgICAgICAgYmxhY2tJc0luQ2hlY2s6IGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgPyBpbkNoZWNrIDogZmFsc2UsDQogICAgICAgIGdhbWVTdGF0ZTogbnVsbA0KICAgIH07DQoNCiAgICBpZiAobGVnYWxNb3ZlTGlzdC5sZW5ndGggPT09IDApIHsNCiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IGluQ2hlY2sNCiAgICAgICAgICAgID8geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH0NCiAgICAgICAgICAgIDogeyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfSBlbHNlIHsNCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAncGxheWluZycgfTsNCiAgICB9DQoNCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7DQogICAgcmV0dXJuIHsgcGllY2VzSW5mbywgYm9hcmRJbmZvLCBsZWdhbE1vdmVMaXN0LCBpbkNoZWNrIH07DQp9Ow0KDQovLyDorqHnrpfooY3nlJ/lgLzvvJrlqIHog4HlgLzjgIHlronlhajlgLzjgIHmiJjmnK/lgLzjgIHmnLrliqjlgLwNCmNvbnN0IGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMgPSAoYm9hcmQsIHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIgPSBudWxsLCBib2FyZEluZm8gPSBudWxsLCBmb3JTZWFyY2hMZWFmID0gZmFsc2UpID0+IHsNCiAgICAvLyDph43nva7miYDmnInooY3nlJ/lgLzvvIzpmaTkuobmnLrliqjlgLzvvIjlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpfvvIkNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpbmZvLnRocmVhdFZhbHVlID0gMDsNCiAgICAgICAgaW5mby5zYWZldHlWYWx1ZSA9IDA7DQogICAgICAgIGluZm8udGFjdGljVmFsdWUgPSAwOw0KICAgICAgICAvLyDkv53nlZnmnLrliqjlgLzvvIzlm6DkuLrlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpcNCiAgICB9DQogICAgDQogICAgLy8gMS4g6K6h566X5qOL5a2Q5YWz57O777yI5aiB6IOB6ICF44CB6KKr5aiB6IOB6ICF44CB5L+d5oqk6ICF44CB6KKr5L+d5oqk6ICF77yJDQogICAgaWYgKCFib2FyZEluZm8pIHsNCiAgICAgICAgYm9hcmRJbmZvID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7DQogICAgfQ0KICAgIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zKGJvYXJkLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgIA0KICAgIC8vIDIuIOiuoeeul+WogeiDgeWAvO+8iOaMieiiq+WogeiDgeWtkOiBmuWQiO+8jFNFRSDmr4/nm67moIfkuIDmrKHvvIkNCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMocGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvLCBmb3JTZWFyY2hMZWFmKTsKICAgIA0KICAgIC8vIDMuIOiuoeeul+WuieWFqOWAvA0KICAgIGNhbGN1bGF0ZVNhZmV0eVZhbHVlcyhwaWVjZXNJbmZvLCBib2FyZEluZm8sIGJvYXJkLCBmb3JTZWFyY2hMZWFmKTsKICAgIA0KICAgIC8vIDQuIOiuoeeul+a4uOaIj+eKtuaAgeW5tuS/neWtmOWIsGJvYXJkSW5mbw0KICAgIC8vIOaQnOe0ouWPtuiKgueCuei3s+i/h++8muaXoOedgC/lsIbmrbvlt7LlnKjniLboioLngrnlpITnkIbvvIzmraTlpITlj6rpnIDpnZnmgIHliIYNCiAgICBpZiAoY3VycmVudFBsYXllciAmJiAhZm9yU2VhcmNoTGVhZikgew0KICAgICAgICAvLyDmo4Dmn6XlvZPliY3njqnlrrbmmK/lkKbmnInlkIjms5XotbDms5UNCiAgICAgICAgbGV0IGhhc01vdmVzID0gZmFsc2U7DQogICAgICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgICAgICBpZiAoaW5mby5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgIC8vIOiOt+WPluW9k+WJjeaji+WtkOeahOacieaViOi1sOazlQ0KICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0VmFsaWRNb3Zlcyhib2FyZCwgeyByOiBpbmZvLnIsIGM6IGluZm8uYyB9KTsNCiAgICAgICAgICAgICAgICBpZiAobW92ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgICAgICBoYXNNb3ZlcyA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy8g5Yik5pat5ri45oiP54q25oCBDQogICAgICAgIGxldCBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ3BsYXlpbmcnIH07DQogICAgICAgIGlmICghaGFzTW92ZXMpIHsNCiAgICAgICAgICAgIC8vIOayoeacieWQiOazlei1sOazle+8jOajgOafpeaYr+WQpuiiq+WwhuWGmw0KICAgICAgICAgICAgY29uc3QgaW5DaGVjayA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZElzSW5DaGVjayA6IGJvYXJkSW5mby5ibGFja0lzSW5DaGVjazsNCiAgICAgICAgICAgIGNvbnN0IG9wcG9uZW50ID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChpbkNoZWNrKSB7DQogICAgICAgICAgICAgICAgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDkv53lrZjmuLjmiI/nirbmgIHliLBib2FyZEluZm8NCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IGdhbWVTdGF0ZTsNCiAgICB9DQp9Ow0KDQovLyDmo4vlrZDlh6DkvZXmlrnlkJHooajvvIjpooTorqHnrpfohb8v55y85YGP56e777yM54Ot6Lev5b6E6YG/5YWNIE1hdGguc2lnbiAvIGRyLzLvvIkNCmNvbnN0IE9SVEhfRElSUyA9IFsNCiAgICBbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXQ0KXTsNCmNvbnN0IERJQUdfRElSUyA9IFsNCiAgICBbMSwgMV0sIFsxLCAtMV0sIFstMSwgMV0sIFstMSwgLTFdDQpdOw0KY29uc3QgRUxFUEhBTlRfRElSUyA9IFsNCiAgICB7IGRyOiAyLCBkYzogMiwgZXllRHI6IDEsIGV5ZURjOiAxIH0sDQogICAgeyBkcjogMiwgZGM6IC0yLCBleWVEcjogMSwgZXllRGM6IC0xIH0sDQogICAgeyBkcjogLTIsIGRjOiAyLCBleWVEcjogLTEsIGV5ZURjOiAxIH0sDQogICAgeyBkcjogLTIsIGRjOiAtMiwgZXllRHI6IC0xLCBleWVEYzogLTEgfQ0KXTsNCmNvbnN0IEhPUlNFX0RJUlMgPSBbDQogICAgeyBkcjogMiwgZGM6IDEsIGxlZ0RyOiAxLCBsZWdEYzogMCB9LA0KICAgIHsgZHI6IDIsIGRjOiAtMSwgbGVnRHI6IDEsIGxlZ0RjOiAwIH0sDQogICAgeyBkcjogLTIsIGRjOiAxLCBsZWdEcjogLTEsIGxlZ0RjOiAwIH0sDQogICAgeyBkcjogLTIsIGRjOiAtMSwgbGVnRHI6IC0xLCBsZWdEYzogMCB9LA0KICAgIHsgZHI6IDEsIGRjOiAyLCBsZWdEcjogMCwgbGVnRGM6IDEgfSwNCiAgICB7IGRyOiAxLCBkYzogLTIsIGxlZ0RyOiAwLCBsZWdEYzogLTEgfSwNCiAgICB7IGRyOiAtMSwgZGM6IDIsIGxlZ0RyOiAwLCBsZWdEYzogMSB9LA0KICAgIHsgZHI6IC0xLCBkYzogLTIsIGxlZ0RyOiAwLCBsZWdEYzogLTEgfQ0KXTsNCg0KLy8g55+t5q2l5a2Q6aKE6KGo77ya5LiO5Y6fIHN3aXRjaCDmlrnlkJHpobrluo8v5a6r5rKz6L+H5ruk5LiA6Ie077yb6ams6LGh5bimIGJyLGJj77yI6IW/L+ecvO+8iQ0KY29uc3QgR0VORVJBTF9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgQURWSVNPUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgRUxFUEhBTlRfREVTVCA9IFtuZXcgQXJyYXkoUkVMX1NRVUFSRVMpLCBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpXTsNCmNvbnN0IEhPUlNFX0RFU1QgPSBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpOw0KY29uc3QgU09MRElFUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KDQooKCkgPT4gew0KICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICBjb25zdCBzcSA9IHIgKiA5ICsgYzsNCiAgICAgICAgICAgIGNvbnN0IGdSZWQgPSBbXSwgZ0JsYWNrID0gW10sIGFSZWQgPSBbXSwgYUJsYWNrID0gW107DQogICAgICAgICAgICBjb25zdCBlUmVkID0gW10sIGVCbGFjayA9IFtdLCBob3JzZSA9IFtdLCBzUmVkID0gW10sIHNCbGFjayA9IFtdOw0KDQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIE9SVEhfRElSU1tpXVswXSwgbmMgPSBjICsgT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPj0gMCAmJiBuciA8PSAyKSBnUmVkLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgaWYgKG5yID49IDcgJiYgbnIgPD0gOSkgZ0JsYWNrLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IERJQUdfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIERJQUdfRElSU1tpXVswXSwgbmMgPSBjICsgRElBR19ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPj0gMCAmJiBuciA8PSAyKSBhUmVkLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgaWYgKG5yID49IDcgJiYgbnIgPD0gOSkgYUJsYWNrLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IEVMRVBIQU5UX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gRUxFUEhBTlRfRElSU1tpXTsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBkLmRyLCBuYyA9IGMgKyBkLmRjOw0KICAgICAgICAgICAgICAgIGlmIChuciA8IDAgfHwgbnIgPj0gUk9XUyB8fCBuYyA8IDAgfHwgbmMgPj0gQ09MUykgY29udGludWU7DQogICAgICAgICAgICAgICAgY29uc3QgZXllUiA9IHIgKyBkLmV5ZURyLCBleWVDID0gYyArIGQuZXllRGM7DQogICAgICAgICAgICAgICAgaWYgKG5yIDw9IDQpIGVSZWQucHVzaCh7IHI6IG5yLCBjOiBuYywgYnI6IGV5ZVIsIGJjOiBleWVDIH0pOw0KICAgICAgICAgICAgICAgIGlmIChuciA+PSA1KSBlQmxhY2sucHVzaCh7IHI6IG5yLCBjOiBuYywgYnI6IGV5ZVIsIGJjOiBleWVDIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBIT1JTRV9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IEhPUlNFX0RJUlNbaV07DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZC5kciwgbmMgPSBjICsgZC5kYzsNCiAgICAgICAgICAgICAgICBjb25zdCBsZWdSID0gciArIGQubGVnRHIsIGxlZ0MgPSBjICsgZC5sZWdEYzsNCiAgICAgICAgICAgICAgICBpZiAobGVnUiA8IDAgfHwgbGVnUiA+PSBST1dTIHx8IGxlZ0MgPCAwIHx8IGxlZ0MgPj0gQ09MUykgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKG5yIDwgMCB8fCBuciA+PSBST1dTIHx8IG5jIDwgMCB8fCBuYyA+PSBDT0xTKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBob3JzZS5wdXNoKHsgcjogbnIsIGM6IG5jLCBicjogbGVnUiwgYmM6IGxlZ0MgfSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICB7DQogICAgICAgICAgICAgICAgY29uc3QgZnIgPSByICsgMTsNCiAgICAgICAgICAgICAgICBpZiAoZnIgPj0gMCAmJiBmciA8IFJPV1MpIHNSZWQucHVzaCh7IHI6IGZyLCBjIH0pOw0KICAgICAgICAgICAgICAgIGlmIChyID49IDUpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGMgLSAxID49IDApIHNSZWQucHVzaCh7IHIsIGM6IGMgLSAxIH0pOw0KICAgICAgICAgICAgICAgICAgICBpZiAoYyArIDEgPCBDT0xTKSBzUmVkLnB1c2goeyByLCBjOiBjICsgMSB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgY29uc3QgZmJyID0gciAtIDE7DQogICAgICAgICAgICAgICAgaWYgKGZiciA+PSAwICYmIGZiciA8IFJPV1MpIHNCbGFjay5wdXNoKHsgcjogZmJyLCBjIH0pOw0KICAgICAgICAgICAgICAgIGlmIChyIDw9IDQpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGMgLSAxID49IDApIHNCbGFjay5wdXNoKHsgciwgYzogYyAtIDEgfSk7DQogICAgICAgICAgICAgICAgICAgIGlmIChjICsgMSA8IENPTFMpIHNCbGFjay5wdXNoKHsgciwgYzogYyArIDEgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBHRU5FUkFMX0RFU1RbMF1bc3FdID0gZ1JlZDsNCiAgICAgICAgICAgIEdFTkVSQUxfREVTVFsxXVtzcV0gPSBnQmxhY2s7DQogICAgICAgICAgICBBRFZJU09SX0RFU1RbMF1bc3FdID0gYVJlZDsNCiAgICAgICAgICAgIEFEVklTT1JfREVTVFsxXVtzcV0gPSBhQmxhY2s7DQogICAgICAgICAgICBFTEVQSEFOVF9ERVNUWzBdW3NxXSA9IGVSZWQ7DQogICAgICAgICAgICBFTEVQSEFOVF9ERVNUWzFdW3NxXSA9IGVCbGFjazsNCiAgICAgICAgICAgIEhPUlNFX0RFU1Rbc3FdID0gaG9yc2U7CiAgICAgICAgICAgIFNPTERJRVJfREVTVFswXVtzcV0gPSBzUmVkOwogICAgICAgICAgICBTT0xESUVSX0RFU1RbMV1bc3FdID0gc0JsYWNrOwogICAgICAgIH0KICAgIH0KfSkoKTsKCmNvbnN0IFNFQVJDSF9HRU5FUkFMX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07CmNvbnN0IFNFQVJDSF9BRFZJU09SX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07CmNvbnN0IFNFQVJDSF9FTEVQSEFOVF9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOwpjb25zdCBTRUFSQ0hfSE9SU0VfREVTVCA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7CmNvbnN0IFNFQVJDSF9TT0xESUVSX0RFU1QgPSBbbmV3IEFycmF5KFJFTF9TUVVBUkVTKSwgbmV3IEFycmF5KFJFTF9TUVVBUkVTKV07CmNvbnN0IFNFQVJDSF9SQVlTID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogUkVMX1NRVUFSRVMgfSwgKCkgPT4gbmV3IEFycmF5KE9SVEhfRElSUy5sZW5ndGgpKTsKY29uc3QgU0VBUkNIX0hPUlNFX0NIRUNLRVJTID0gbmV3IEFycmF5KFJFTF9TUVVBUkVTKTsKCigoKSA9PiB7CiAgICBjb25zdCBzcXVhcmVEZXN0aW5hdGlvbnMgPSAoZGVzdHMpID0+IHsKICAgICAgICBjb25zdCBwYWNrZWQgPSBuZXcgVWludDhBcnJheShkZXN0cy5sZW5ndGgpOwogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHBhY2tlZFtpXSA9IGRlc3RzW2ldLnIgKiA5ICsgZGVzdHNbaV0uYzsKICAgICAgICByZXR1cm4gcGFja2VkOwogICAgfTsKICAgIGNvbnN0IGJsb2NrZWREZXN0aW5hdGlvbnMgPSAoZGVzdHMpID0+IHsKICAgICAgICBjb25zdCBwYWNrZWQgPSBuZXcgVWludDE2QXJyYXkoZGVzdHMubGVuZ3RoKTsKICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgIHBhY2tlZFtpXSA9IChkZXN0c1tpXS5iciAqIDkgKyBkZXN0c1tpXS5iYykgKiAxMjggKyBkZXN0c1tpXS5yICogOSArIGRlc3RzW2ldLmM7CiAgICAgICAgfQogICAgICAgIHJldHVybiBwYWNrZWQ7CiAgICB9OwoKICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgewogICAgICAgIFNFQVJDSF9HRU5FUkFMX0RFU1RbMF1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKEdFTkVSQUxfREVTVFswXVtzcV0pOwogICAgICAgIFNFQVJDSF9HRU5FUkFMX0RFU1RbMV1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKEdFTkVSQUxfREVTVFsxXVtzcV0pOwogICAgICAgIFNFQVJDSF9BRFZJU09SX0RFU1RbMF1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKEFEVklTT1JfREVTVFswXVtzcV0pOwogICAgICAgIFNFQVJDSF9BRFZJU09SX0RFU1RbMV1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKEFEVklTT1JfREVTVFsxXVtzcV0pOwogICAgICAgIFNFQVJDSF9FTEVQSEFOVF9ERVNUWzBdW3NxXSA9IGJsb2NrZWREZXN0aW5hdGlvbnMoRUxFUEhBTlRfREVTVFswXVtzcV0pOwogICAgICAgIFNFQVJDSF9FTEVQSEFOVF9ERVNUWzFdW3NxXSA9IGJsb2NrZWREZXN0aW5hdGlvbnMoRUxFUEhBTlRfREVTVFsxXVtzcV0pOwogICAgICAgIFNFQVJDSF9IT1JTRV9ERVNUW3NxXSA9IGJsb2NrZWREZXN0aW5hdGlvbnMoSE9SU0VfREVTVFtzcV0pOwogICAgICAgIFNFQVJDSF9TT0xESUVSX0RFU1RbMF1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKFNPTERJRVJfREVTVFswXVtzcV0pOwogICAgICAgIFNFQVJDSF9TT0xESUVSX0RFU1RbMV1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKFNPTERJRVJfREVTVFsxXVtzcV0pOwoKICAgICAgICBjb25zdCByID0gKHNxIC8gOSkgfCAwOwogICAgICAgIGNvbnN0IGMgPSBzcSAlIDk7CiAgICAgICAgZm9yIChsZXQgZGlyID0gMDsgZGlyIDwgT1JUSF9ESVJTLmxlbmd0aDsgZGlyKyspIHsKICAgICAgICAgICAgY29uc3QgcmF5ID0gW107CiAgICAgICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2Rpcl1bMF07CiAgICAgICAgICAgIGNvbnN0IGRjID0gT1JUSF9ESVJTW2Rpcl1bMV07CiAgICAgICAgICAgIGZvciAobGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsgbnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFM7IG5yICs9IGRyLCBuYyArPSBkYykgewogICAgICAgICAgICAgICAgcmF5LnB1c2gobnIgKiA5ICsgbmMpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIFNFQVJDSF9SQVlTW3NxXVtkaXJdID0gbmV3IFVpbnQ4QXJyYXkocmF5KTsKICAgICAgICB9CgogICAgICAgIGNvbnN0IGhvcnNlQ2hlY2tlcnMgPSBbXTsKICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IEhPUlNFX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgY29uc3QgZCA9IEhPUlNFX0RJUlNbaV07CiAgICAgICAgICAgIGNvbnN0IGhvcnNlUiA9IHIgKyBkLmRyOwogICAgICAgICAgICBjb25zdCBob3JzZUMgPSBjICsgZC5kYzsKICAgICAgICAgICAgaWYgKGhvcnNlUiA8IDAgfHwgaG9yc2VSID49IFJPV1MgfHwgaG9yc2VDIDwgMCB8fCBob3JzZUMgPj0gQ09MUykgY29udGludWU7CiAgICAgICAgICAgIGNvbnN0IGxlZ1IgPSBob3JzZVIgLSBkLmxlZ0RyOwogICAgICAgICAgICBjb25zdCBsZWdDID0gaG9yc2VDIC0gZC5sZWdEYzsKICAgICAgICAgICAgaG9yc2VDaGVja2Vycy5wdXNoKChsZWdSICogOSArIGxlZ0MpICogMTI4ICsgaG9yc2VSICogOSArIGhvcnNlQyk7CiAgICAgICAgfQogICAgICAgIFNFQVJDSF9IT1JTRV9DSEVDS0VSU1tzcV0gPSBuZXcgVWludDE2QXJyYXkoaG9yc2VDaGVja2Vycyk7CiAgICB9Cn0pKCk7Cgpjb25zdCBhcHBlbmRTZWFyY2hTaG9ydE1vdmVzID0gKG1vdmVzLCBmcm9tU3EsIGRlc3RzLCBzcXVhcmVDb2RlcywgaXNSZWQsIGNhcHR1cmVzT25seSwgYmxvY2tlZCkgPT4gewogICAgbGV0IGdlbmVyYXRlZCA9IDA7CiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgbGV0IHRvU3EgPSBkZXN0c1tpXTsKICAgICAgICBpZiAoYmxvY2tlZCkgewogICAgICAgICAgICBpZiAoc3F1YXJlQ29kZXNbdG9TcSA+Pj4gN10gIT09IDApIGNvbnRpbnVlOwogICAgICAgICAgICB0b1NxICY9IDEyNzsKICAgICAgICB9CiAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3RvU3FdOwogICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7CiAgICAgICAgICAgIGdlbmVyYXRlZCsrOwogICAgICAgICAgICBpZiAoIWNhcHR1cmVzT25seSkgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7CiAgICAgICAgfSBlbHNlIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgewogICAgICAgICAgICBnZW5lcmF0ZWQrKzsKICAgICAgICAgICAgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7CiAgICAgICAgfQogICAgfQogICAgcmV0dXJuIGdlbmVyYXRlZDsKfTsKCmNvbnN0IGFwcGVuZFNlYXJjaFBzZXVkb01vdmVzRm9yUGllY2UgPSAobW92ZXMsIGZyb21TcSwgcGllY2VDb2RlLCBzcXVhcmVDb2RlcywgY2FwdHVyZXNPbmx5ID0gZmFsc2UpID0+IHsKICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlQ29kZSAmIDc7CiAgICBjb25zdCBpc1JlZCA9IHBpZWNlQ29kZSA8IDg7CiAgICBjb25zdCBjb2xvcklkeCA9IGlzUmVkID8gMCA6IDE7CiAgICBsZXQgZ2VuZXJhdGVkID0gMDsKCiAgICBzd2l0Y2ggKHBpZWNlVHlwZSkgewogICAgICAgIGNhc2UgMToKICAgICAgICAgICAgcmV0dXJuIGFwcGVuZFNlYXJjaFNob3J0TW92ZXMobW92ZXMsIGZyb21TcSwgU0VBUkNIX0dFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXSwgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIGZhbHNlKTsKICAgICAgICBjYXNlIDU6CiAgICAgICAgICAgIHJldHVybiBhcHBlbmRTZWFyY2hTaG9ydE1vdmVzKG1vdmVzLCBmcm9tU3EsIFNFQVJDSF9BRFZJU09SX0RFU1RbY29sb3JJZHhdW2Zyb21TcV0sIHNxdWFyZUNvZGVzLCBpc1JlZCwgY2FwdHVyZXNPbmx5LCBmYWxzZSk7CiAgICAgICAgY2FzZSA0OgogICAgICAgICAgICByZXR1cm4gYXBwZW5kU2VhcmNoU2hvcnRNb3Zlcyhtb3ZlcywgZnJvbVNxLCBTRUFSQ0hfRUxFUEhBTlRfREVTVFtjb2xvcklkeF1bZnJvbVNxXSwgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIHRydWUpOwogICAgICAgIGNhc2UgMzoKICAgICAgICAgICAgcmV0dXJuIGFwcGVuZFNlYXJjaFNob3J0TW92ZXMobW92ZXMsIGZyb21TcSwgU0VBUkNIX0hPUlNFX0RFU1RbZnJvbVNxXSwgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIHRydWUpOwogICAgICAgIGNhc2UgNzoKICAgICAgICAgICAgcmV0dXJuIGFwcGVuZFNlYXJjaFNob3J0TW92ZXMobW92ZXMsIGZyb21TcSwgU0VBUkNIX1NPTERJRVJfREVTVFtjb2xvcklkeF1bZnJvbVNxXSwgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIGZhbHNlKTsKICAgICAgICBjYXNlIDI6CiAgICAgICAgICAgIGZvciAobGV0IGRpciA9IDA7IGRpciA8IE9SVEhfRElSUy5sZW5ndGg7IGRpcisrKSB7CiAgICAgICAgICAgICAgICBjb25zdCByYXkgPSBTRUFSQ0hfUkFZU1tmcm9tU3FdW2Rpcl07CiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJheS5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvU3EgPSByYXlbaV07CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3RvU3FdOwogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGdlbmVyYXRlZCsrOwogICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWNhcHR1cmVzT25seSkgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7CiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBnZW5lcmF0ZWQrKzsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goKGZyb21TcSA8PCA3KSB8IHRvU3EpOwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgICAgICByZXR1cm4gZ2VuZXJhdGVkOwogICAgICAgIGNhc2UgNjoKICAgICAgICAgICAgZm9yIChsZXQgZGlyID0gMDsgZGlyIDwgT1JUSF9ESVJTLmxlbmd0aDsgZGlyKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IHJheSA9IFNFQVJDSF9SQVlTW2Zyb21TcV1bZGlyXTsKICAgICAgICAgICAgICAgIGxldCBzY3JlZW5Gb3VuZCA9IGZhbHNlOwogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCByYXkubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCB0b1NxID0gcmF5W2ldOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1t0b1NxXTsKICAgICAgICAgICAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBnZW5lcmF0ZWQrKzsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghY2FwdHVyZXNPbmx5KSBtb3Zlcy5wdXNoKChmcm9tU3EgPDwgNykgfCB0b1NxKTsKICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjcmVlbkZvdW5kID0gdHJ1ZTsKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0Q29kZSAhPT0gMCkgewogICAgICAgICAgICAgICAgICAgICAgICBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdlbmVyYXRlZCsrOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgICAgIHJldHVybiBnZW5lcmF0ZWQ7CiAgICAgICAgZGVmYXVsdDoKICAgICAgICAgICAgcmV0dXJuIGdlbmVyYXRlZDsKICAgIH0KfTsKCi8vIOaooeWdl+e6p+iQveeCueWkhOeQhu+8iOmdnuavj+WtkOaWsOW7uumXreWMhe+8ie+8m+i/lOWbnuacuuWKqOWinumHjw0KLy8gcGllY2VBdFNxOiA5MCDmoLwg4oaSIHBpZWNlc0luZm/vvJtyZWxDdHgudXNlTWFza3Mg5pe25YaZIG1hc2sNCmNvbnN0IGFwcGx5UmVsYXRpb25TcXVhcmUgPSAoYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgdHIsIHRjLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yKSA9PiB7DQogICAgaWYgKHRyIDwgMCB8fCB0ciA+PSBST1dTIHx8IHRjIDwgMCB8fCB0YyA+PSBDT0xTKSByZXR1cm4gMDsNCiAgICBjb25zdCB0YXJnZXQgPSBib2FyZFt0cl1bdGNdOw0KICAgIGlmICghdGFyZ2V0KSB7DQogICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgY29uc3Qgc3EgPSB0ciAqIDkgKyB0YzsNCiAgICAgICAgICAgIGlmICghcmVsQ3R4LnNraXBDb250cm9sTWFzaykgcmVsQ3R4LmNvbnRyb2xNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChyZWxDdHgucmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICBlbHNlIHNldEF0dGFja0JpdChyZWxDdHguYmxhY2tBdHRhY2ssIHNxKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICB9DQogICAgaWYgKHRhcmdldC5jb2xvciAhPT0gcGllY2VDb2xvcikgew0KICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgIGlmIChwaWVjZUF0U3FbdHIgKiA5ICsgdGNdKSB7DQogICAgICAgICAgICAgICAgcmVsQ3R4LmF0dGFja01hc2tbdHIgKiA5ICsgdGNdIHw9IGJpdDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbdHIgKiA5ICsgdGNdOw0KICAgICAgICAgICAgaWYgKHRhcmdldEluZm8pIHsNCiAgICAgICAgICAgICAgICBpbmZvLnRocmVhdC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIDA7DQogICAgfQ0KICAgIGlmICh0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbdHIgKiA5ICsgdGNdOw0KICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICByZWxDdHguZ3VhcmRNYXNrW3RyICogOSArIHRjXSB8PSBiaXQ7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLmd1YXJkZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgIGluZm8uYWxseUd1YXJkcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiAwOw0KfTsNCg0KLy8g6Z2e54Ku77ya5LiA5qyh5Yeg5L2V5omr5o+P77yb55+t5q2l5a2Q6LWw6aKE6KGo77yM6L2m5LuN5bCE57q/77yb6K+t5LmJ5LiOIGdldFBpZWNlTW92ZXMg5LiA6Ie0DQpjb25zdCBmaWxsTm9uQ2Fubm9uUmVsYXRpb25zID0gKGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIHJlbEN0eCA9IG51bGwpID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGluZm8ucGllY2U7DQogICAgY29uc3QgeyByLCBjIH0gPSBpbmZvOw0KICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICAgIGNvbnN0IHBpZWNlQ29sb3IgPSBwaWVjZS5jb2xvcjsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKHJlbEN0eCAmJiByZWxDdHgudXNlTWFza3MpOw0KICAgIGNvbnN0IHNraXBDb250cm9sID0gdXNlTWFza3MgJiYgcmVsQ3R4LnNraXBDb250cm9sTWFzazsNCiAgICBjb25zdCBiaXQgPSB1c2VNYXNrcyA/ICgxIDw8IHJlbEN0eC5waWVjZUluZGV4KSA6IDA7DQogICAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOw0KICAgIGNvbnN0IGZyb21TcSA9IHIgKiA5ICsgYzsNCiAgICBpZiAoIXVzZU1hc2tzKSB7DQogICAgICAgIGluZm8ubW92ZXMgPSBbXTsNCiAgICAgICAgaW5mby5jb250cm9sID0gW107DQogICAgICAgIGluZm8uYWxseUd1YXJkcyA9IFtdOw0KICAgIH0NCiAgICBsZXQgbW9iaWxpdHlWYWx1ZSA9IDA7DQoNCiAgICBzd2l0Y2ggKHBpZWNlLnR5cGUpIHsNCiAgICAgICAgY2FzZSAnZ2VuZXJhbCc6IHsNCiAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gR0VORVJBTF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoDQogICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGNhc2UgJ2Fkdmlzb3InOiB7DQogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEFEVklTT1JfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVJlbGF0aW9uU3F1YXJlKA0KICAgICAgICAgICAgICAgICAgICBib2FyZCwgaW5mbywgcGllY2VBdFNxLCBkLnIsIGQuYywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcg0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBjYXNlICdlbGVwaGFudCc6IHsNCiAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gRUxFUEhBTlRfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW2QuYnJdW2QuYmNdID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnaG9yc2UnOiB7DQogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEhPUlNFX0RFU1RbZnJvbVNxXTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW2QuYnJdW2QuYmNdID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnY2hhcmlvdCc6DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICAgICAgICAgIHdoaWxlIChuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0ID09PSBudWxsKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzcSA9IG5yICogOSArIG5jOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghc2tpcENvbnRyb2wpIHJlbEN0eC5jb250cm9sTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHJlbEN0eC5yZWRBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHNldEF0dGFja0JpdChyZWxDdHguYmxhY2tBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlQXRTcVtuciAqIDkgKyBuY10pIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5hdHRhY2tNYXNrW25yICogOSArIG5jXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbbnIgKiA5ICsgbmNdOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW25yICogOSArIG5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsQ3R4Lmd1YXJkTWFza1tuciAqIDkgKyBuY10gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5ndWFyZC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uYWxseUd1YXJkcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICAgICAgICAgIG5jICs9IGRjOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICBjYXNlICdzb2xkaWVyJzogew0KICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBTT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgZC5yLCBkLmMsIHVzZU1hc2tzLCBiaXQsIHJlbEN0eCwgaXNSZWQsIHBpZWNlQ29sb3INCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgZGVmYXVsdDoNCiAgICAgICAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOw0KfTsNCg0KLy8g54Ku77ya5LiA5qyh5Zub5ZCR5bCE57q/77ybbWFzayDmqKHlvI/lhpkgYXR0YWNrL2d1YXJkL2NvbnRyb2zvvIzliJfooajmqKHlvI/kv53mjIHml6for63kuYkNCmNvbnN0IGZpbGxDYW5ub25SZWxhdGlvbnMgPSAoYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgcmVsQ3R4ID0gbnVsbCkgPT4gew0KICAgIGNvbnN0IHBpZWNlID0gaW5mby5waWVjZTsNCiAgICBjb25zdCB7IHIsIGMgfSA9IGluZm87DQogICAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQogICAgY29uc3QgcGllY2VDb2xvciA9IHBpZWNlLmNvbG9yOw0KICAgIGNvbnN0IHsgYmFzZU1vdmVWYWx1ZSB9ID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5Ow0KICAgIGNvbnN0IHVzZU1hc2tzID0gISEocmVsQ3R4ICYmIHJlbEN0eC51c2VNYXNrcyk7DQogICAgY29uc3Qgc2tpcENvbnRyb2wgPSB1c2VNYXNrcyAmJiByZWxDdHguc2tpcENvbnRyb2xNYXNrOw0KICAgIGNvbnN0IGJpdCA9IHVzZU1hc2tzID8gKDEgPDwgcmVsQ3R4LnBpZWNlSW5kZXgpIDogMDsNCiAgICBpZiAoIXVzZU1hc2tzKSB7DQogICAgICAgIGluZm8ubW92ZXMgPSBbXTsNCiAgICAgICAgaW5mby5jb250cm9sID0gW107DQogICAgfQ0KICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsNCg0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgbGV0IHNjcmVlbkZvdW5kQ291bnQgPSAwOw0KICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMgJiYgc2NyZWVuRm91bmRDb3VudCA8IDIpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgIT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICBzY3JlZW5Gb3VuZENvdW50Kys7DQogICAgICAgICAgICAgICAgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDIpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBpZWNlQXRTcVtuciAqIDkgKyBuY107DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRJbmZvICYmIHRhcmdldEluZm8gIT09IGluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwLmNvbG9yICE9PSBwaWVjZUNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5hdHRhY2tNYXNrW25yICogOSArIG5jXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby50aHJlYXRlbmVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsQ3R4Lmd1YXJkTWFza1tuciAqIDkgKyBuY10gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocC5jb2xvciAhPT0gcGllY2VDb2xvcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF1c2VNYXNrcykgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMCkgew0KICAgICAgICAgICAgICAgIGlmICghdXNlTWFza3MpIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDEpIHsNCiAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBuciAqIDkgKyBuYzsNCiAgICAgICAgICAgICAgICAgICAgaWYgKCFza2lwQ29udHJvbCkgcmVsQ3R4LmNvbnRyb2xNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHJlbEN0eC5yZWRBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgaW5mby5jb250cm9sLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOw0KfTsNCg0KLy8g5LuO5qC85L2NIG1hc2sg6L+Y5Y6fIHRocmVhdC9ndWFyZC9jb250cm9sIOWIl+ihqO+8iOeCueajiy9VSe+8iQ0KLy8gU2VhcmNoIGxlYXZlcyBhbHdheXMgdXNlIG1hc2tzIGFuZCBhdHRhY2sgYml0cywgc28gdGhpcyBhdm9pZHMgVUkvY29udHJvbC1saXN0IGJyYW5jaGVzLgpjb25zdCBhcHBseVNlYXJjaExlYWZSZWxhdGlvblNxdWFyZSA9IChzcXVhcmVDb2Rlcywgc3EsIGJpdCwgaXNSZWQpID0+IHsKICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1tzcV07CiAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgewogICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHNjcmF0Y2hSZWRBdHRhY2ssIHNxKTsKICAgICAgICBlbHNlIHNldEF0dGFja0JpdChzY3JhdGNoQmxhY2tBdHRhY2ssIHNxKTsKICAgICAgICByZXR1cm4gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5LmJhc2VNb3ZlVmFsdWU7CiAgICB9CiAgICBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHsKICAgICAgICBzY3JhdGNoQXR0YWNrTWFza1tzcV0gfD0gYml0OwogICAgfSBlbHNlIGlmICgodGFyZ2V0Q29kZSAmIDcpICE9PSAxKSB7CiAgICAgICAgc2NyYXRjaEd1YXJkTWFza1tzcV0gfD0gYml0OwogICAgfQogICAgcmV0dXJuIDA7Cn07Cgpjb25zdCBjYWxjdWxhdGVTZWFyY2hMZWFmUmVsYXRpb25zID0gKHBpZWNlc0luZm8sIHNxdWFyZUNvZGVzKSA9PiB7CiAgICBzY3JhdGNoQXR0YWNrTWFzay5maWxsKDApOwogICAgc2NyYXRjaEd1YXJkTWFzay5maWxsKDApOwogICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOwogICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7CgogICAgY29uc3QgYmFzZU1vdmVWYWx1ZSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eS5iYXNlTW92ZVZhbHVlOwogICAgZm9yIChsZXQgcGkgPSAwOyBwaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBwaSsrKSB7CiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9bcGldOwogICAgICAgIGNvbnN0IHIgPSBpbmZvLnI7CiAgICAgICAgY29uc3QgYyA9IGluZm8uYzsKICAgICAgICBjb25zdCBmcm9tU3EgPSByICogOSArIGM7CiAgICAgICAgY29uc3QgcGllY2VDb2RlID0gaW5mby5waWVjZUNvZGU7CiAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2VDb2RlICYgNzsKICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlQ29kZSA8IDg7CiAgICAgICAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOwogICAgICAgIGNvbnN0IGJpdCA9IDEgPDwgcGk7CiAgICAgICAgbGV0IG1vYmlsaXR5VmFsdWUgPSAwOwoKICAgICAgICBzd2l0Y2ggKHBpZWNlVHlwZSkgewogICAgICAgICAgICBjYXNlIDE6IHsKICAgICAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gR0VORVJBTF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOwogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsKICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5U2VhcmNoTGVhZlJlbGF0aW9uU3F1YXJlKHNxdWFyZUNvZGVzLCBkLnIgKiA5ICsgZC5jLCBiaXQsIGlzUmVkKTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGNhc2UgNTogewogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBBRFZJU09SX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07CiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOwogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUoc3F1YXJlQ29kZXMsIGQuciAqIDkgKyBkLmMsIGJpdCwgaXNSZWQpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgY2FzZSA0OiB7CiAgICAgICAgICAgICAgICBjb25zdCBkZXN0cyA9IEVMRVBIQU5UX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07CiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOwogICAgICAgICAgICAgICAgICAgIGlmIChzcXVhcmVDb2Rlc1tkLmJyICogOSArIGQuYmNdID09PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUoc3F1YXJlQ29kZXMsIGQuciAqIDkgKyBkLmMsIGJpdCwgaXNSZWQpOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGNhc2UgMzogewogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBIT1JTRV9ERVNUW2Zyb21TcV07CiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOwogICAgICAgICAgICAgICAgICAgIGlmIChzcXVhcmVDb2Rlc1tkLmJyICogOSArIGQuYmNdID09PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUoc3F1YXJlQ29kZXMsIGQuciAqIDkgKyBkLmMsIGJpdCwgaXNSZWQpOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGNhc2UgMjoKICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF07CiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGMgPSBPUlRIX0RJUlNbaV1bMV07CiAgICAgICAgICAgICAgICAgICAgbGV0IG5yID0gciArIGRyOwogICAgICAgICAgICAgICAgICAgIGxldCBuYyA9IGMgKyBkYzsKICAgICAgICAgICAgICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMpIHsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBuciAqIDkgKyBuYzsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3NxXTsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHNjcmF0Y2hSZWRBdHRhY2ssIHNxKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Ugc2V0QXR0YWNrQml0KHNjcmF0Y2hCbGFja0F0dGFjaywgc3EpOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOwogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSBzY3JhdGNoQXR0YWNrTWFza1tzcV0gfD0gYml0OwogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgc2NyYXRjaEd1YXJkTWFza1tzcV0gfD0gYml0OwogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgbnIgKz0gZHI7CiAgICAgICAgICAgICAgICAgICAgICAgIG5jICs9IGRjOwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICBjYXNlIDY6CiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgewogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRjID0gT1JUSF9ESVJTW2ldWzFdOwogICAgICAgICAgICAgICAgICAgIGxldCBuciA9IHIgKyBkcjsKICAgICAgICAgICAgICAgICAgICBsZXQgbmMgPSBjICsgZGM7CiAgICAgICAgICAgICAgICAgICAgbGV0IHNjcmVlbnMgPSAwOwogICAgICAgICAgICAgICAgICAgIHdoaWxlIChuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUyAmJiBzY3JlZW5zIDwgMikgewogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzcSA9IG5yICogOSArIG5jOwogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbc3FdOwogICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSAhPT0gMCkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgc2NyZWVucysrOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNjcmVlbnMgPT09IDIpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHNjcmF0Y2hBdHRhY2tNYXNrW3NxXSB8PSBiaXQ7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgc2NyYXRjaEd1YXJkTWFza1tzcV0gfD0gYml0OwogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHNjcmVlbnMgPT09IDApIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsKICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHNjcmF0Y2hSZWRBdHRhY2ssIHNxKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Ugc2V0QXR0YWNrQml0KHNjcmF0Y2hCbGFja0F0dGFjaywgc3EpOwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgIG5yICs9IGRyOwogICAgICAgICAgICAgICAgICAgICAgICBuYyArPSBkYzsKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgY2FzZSA3OiB7CiAgICAgICAgICAgICAgICBjb25zdCBkZXN0cyA9IFNPTERJRVJfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsKICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07CiAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVNlYXJjaExlYWZSZWxhdGlvblNxdWFyZShzcXVhcmVDb2RlcywgZC5yICogOSArIGQuYywgYml0LCBpc1JlZCk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICAgICAgfQogICAgICAgICAgICBkZWZhdWx0OgogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgfQogICAgICAgIGluZm8ubW9iaWxpdHlWYWx1ZSA9IG1vYmlsaXR5VmFsdWU7CiAgICB9Cn07CgovLyBTZWFyY2gtb25seSByZWxhdGlvbiBidWlsZGVyLiBJdCBpcyBlcXVpdmFsZW50IHRvIGNhbGN1bGF0ZVNlYXJjaExlYWZSZWxhdGlvbnMsCi8vIGJ1dCByZXVzZXMgdGhlIHBhY2tlZCBtb3ZlIHRhYmxlcyBhbmQgcmF5cyBhbHJlYWR5IHVzZWQgYnkgcHNldWRvIG1vdmUgZ2VuZXJhdGlvbi4KY29uc3QgY2FsY3VsYXRlUGFja2VkU2VhcmNoTGVhZlJlbGF0aW9ucyA9IChwaWVjZXNJbmZvLCBzcXVhcmVDb2RlcykgPT4gewogICAgc2NyYXRjaEF0dGFja01hc2suZmlsbCgwKTsKICAgIHNjcmF0Y2hHdWFyZE1hc2suZmlsbCgwKTsKICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsKICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOwoKICAgIGNvbnN0IGJhc2VNb3ZlVmFsdWUgPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsKICAgIGNvbnN0IGF0dGFja01hc2sgPSBzY3JhdGNoQXR0YWNrTWFzazsKICAgIGNvbnN0IGd1YXJkTWFzayA9IHNjcmF0Y2hHdWFyZE1hc2s7CiAgICBjb25zdCByZWRBdHRhY2sgPSBzY3JhdGNoUmVkQXR0YWNrOwogICAgY29uc3QgYmxhY2tBdHRhY2sgPSBzY3JhdGNoQmxhY2tBdHRhY2s7CgogICAgZm9yIChsZXQgcGkgPSAwOyBwaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBwaSsrKSB7CiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9bcGldOwogICAgICAgIGNvbnN0IGZyb21TcSA9IGluZm8uc3E7CiAgICAgICAgY29uc3QgcGllY2VDb2RlID0gaW5mby5waWVjZUNvZGU7CiAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2VDb2RlICYgNzsKICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlQ29kZSA8IDg7CiAgICAgICAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOwogICAgICAgIGNvbnN0IGJpdCA9IDEgPDwgcGk7CiAgICAgICAgY29uc3QgYXR0YWNrQml0cyA9IGlzUmVkID8gcmVkQXR0YWNrIDogYmxhY2tBdHRhY2s7CiAgICAgICAgbGV0IG1vYmlsaXR5VmFsdWUgPSAwOwoKICAgICAgICBzd2l0Y2ggKHBpZWNlVHlwZSkgewogICAgICAgICAgICBjYXNlIDE6CiAgICAgICAgICAgIGNhc2UgNToKICAgICAgICAgICAgY2FzZSA3OiB7CiAgICAgICAgICAgICAgICBjb25zdCBkZXN0cyA9IHBpZWNlVHlwZSA9PT0gMQogICAgICAgICAgICAgICAgICAgID8gU0VBUkNIX0dFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXQogICAgICAgICAgICAgICAgICAgIDogcGllY2VUeXBlID09PSA1CiAgICAgICAgICAgICAgICAgICAgICAgID8gU0VBUkNIX0FEVklTT1JfREVTVFtjb2xvcklkeF1bZnJvbVNxXQogICAgICAgICAgICAgICAgICAgICAgICA6IFNFQVJDSF9TT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07CiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBkZXN0c1tpXTsKICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbc3FdOwogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja0JpdHNbc3EgPj4+IDVdIHw9IDEgPDwgKHNxICYgMzEpOwogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7CiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgewogICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tNYXNrW3NxXSB8PSBiaXQ7CiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICgodGFyZ2V0Q29kZSAmIDcpICE9PSAxKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkTWFza1tzcV0gfD0gYml0OwogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGNhc2UgNDoKICAgICAgICAgICAgY2FzZSAzOiB7CiAgICAgICAgICAgICAgICBjb25zdCBkZXN0cyA9IHBpZWNlVHlwZSA9PT0gNAogICAgICAgICAgICAgICAgICAgID8gU0VBUkNIX0VMRVBIQU5UX0RFU1RbY29sb3JJZHhdW2Zyb21TcV0KICAgICAgICAgICAgICAgICAgICA6IFNFQVJDSF9IT1JTRV9ERVNUW2Zyb21TcV07CiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFja2VkID0gZGVzdHNbaV07CiAgICAgICAgICAgICAgICAgICAgaWYgKHNxdWFyZUNvZGVzW3BhY2tlZCA+Pj4gN10gIT09IDApIGNvbnRpbnVlOwogICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gcGFja2VkICYgMTI3OwogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1tzcV07CiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsKICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrQml0c1tzcSA+Pj4gNV0gfD0gMSA8PCAoc3EgJiAzMSk7CiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsKICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja01hc2tbc3FdIHw9IGJpdDsKICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCh0YXJnZXRDb2RlICYgNykgIT09IDEpIHsKICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRNYXNrW3NxXSB8PSBiaXQ7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgY2FzZSAyOgogICAgICAgICAgICAgICAgZm9yIChsZXQgZGlyID0gMDsgZGlyIDwgT1JUSF9ESVJTLmxlbmd0aDsgZGlyKyspIHsKICAgICAgICAgICAgICAgICAgICBjb25zdCByYXkgPSBTRUFSQ0hfUkFZU1tmcm9tU3FdW2Rpcl07CiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCByYXkubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSByYXlbaV07CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1tzcV07CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tCaXRzW3NxID4+PiA1XSB8PSAxIDw8IChzcSAmIDMxKTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgYXR0YWNrTWFza1tzcV0gfD0gYml0OwogICAgICAgICAgICAgICAgICAgICAgICBlbHNlIGlmICgodGFyZ2V0Q29kZSAmIDcpICE9PSAxKSBndWFyZE1hc2tbc3FdIHw9IGJpdDsKICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIGNhc2UgNjoKICAgICAgICAgICAgICAgIGZvciAobGV0IGRpciA9IDA7IGRpciA8IE9SVEhfRElSUy5sZW5ndGg7IGRpcisrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmF5ID0gU0VBUkNIX1JBWVNbZnJvbVNxXVtkaXJdOwogICAgICAgICAgICAgICAgICAgIGxldCBzY3JlZW5Gb3VuZCA9IGZhbHNlOwogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF5Lmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gcmF5W2ldOwogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbc3FdOwogICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2NyZWVuRm91bmQgPSB0cnVlOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldENvZGUgPT09IDApIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja0JpdHNbc3EgPj4+IDVdIHw9IDEgPDwgKHNxICYgMzEpOwogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSBhdHRhY2tNYXNrW3NxXSB8PSBiaXQ7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIGlmICgodGFyZ2V0Q29kZSAmIDcpICE9PSAxKSBndWFyZE1hc2tbc3FdIHw9IGJpdDsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgYnJlYWs7CiAgICAgICAgICAgIGRlZmF1bHQ6CiAgICAgICAgICAgICAgICBicmVhazsKICAgICAgICB9CiAgICAgICAgaW5mby5tb2JpbGl0eVZhbHVlID0gbW9iaWxpdHlWYWx1ZTsKICAgIH0KfTsKCmNvbnN0IGh5ZHJhdGVSZWxhdGlvbnNGcm9tTWFza3MgPSAocGllY2VzSW5mbywgYm9hcmRJbmZvKSA9PiB7CiAgICBjb25zdCBhdHRhY2tNYXNrID0gYm9hcmRJbmZvLmF0dGFja01hc2s7DQogICAgY29uc3QgZ3VhcmRNYXNrID0gYm9hcmRJbmZvLmd1YXJkTWFzazsNCiAgICBjb25zdCBjb250cm9sTWFzayA9IGJvYXJkSW5mby5jb250cm9sTWFzazsNCiAgICBjb25zdCBuID0gcGllY2VzSW5mby5sZW5ndGg7DQogICAgY29uc3QgYnlTcSA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHsNCiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07DQogICAgICAgIGluZm8udGhyZWF0ID0gW107DQogICAgICAgIGluZm8udGhyZWF0ZW5lZEJ5ID0gW107DQogICAgICAgIGluZm8uZ3VhcmQgPSBbXTsNCiAgICAgICAgaW5mby5ndWFyZGVkQnkgPSBbXTsNCiAgICAgICAgaW5mby5jb250cm9sID0gW107DQogICAgICAgIGJ5U3FbaW5mby5yICogOSArIGluZm8uY10gPSBpbmZvOw0KICAgIH0NCg0KICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgew0KICAgICAgICBjb25zdCByID0gKHNxIC8gOSkgfCAwOw0KICAgICAgICBjb25zdCBjID0gc3EgJSA5Ow0KICAgICAgICBjb25zdCB0YXJnZXQgPSBieVNxW3NxXTsNCg0KICAgICAgICBsZXQgY20gPSBjb250cm9sTWFza1tzcV0gPj4+IDA7DQogICAgICAgIHdoaWxlIChjbSAhPT0gMCkgew0KICAgICAgICAgICAgY29uc3QgYml0ID0gY20gJiAtY207DQogICAgICAgICAgICBjb25zdCBpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7DQogICAgICAgICAgICBwaWVjZXNJbmZvW2ldLmNvbnRyb2wucHVzaCh7IHIsIGMgfSk7DQogICAgICAgICAgICBjbSBePSBiaXQ7DQogICAgICAgIH0NCg0KICAgICAgICBsZXQgYW0gPSBhdHRhY2tNYXNrW3NxXSA+Pj4gMDsNCiAgICAgICAgd2hpbGUgKGFtICE9PSAwKSB7DQogICAgICAgICAgICBjb25zdCBiaXQgPSBhbSAmIC1hbTsNCiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsNCiAgICAgICAgICAgIGNvbnN0IGF0dGFja2VyID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgICAgIGlmICh0YXJnZXQgJiYgdGFyZ2V0ICE9PSBhdHRhY2tlciAmJiB0YXJnZXQucGllY2UuY29sb3IgIT09IGF0dGFja2VyLnBpZWNlLmNvbG9yKSB7DQogICAgICAgICAgICAgICAgYXR0YWNrZXIudGhyZWF0LnB1c2godGFyZ2V0KTsNCiAgICAgICAgICAgICAgICB0YXJnZXQudGhyZWF0ZW5lZEJ5LnB1c2goYXR0YWNrZXIpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYW0gXj0gYml0Ow0KICAgICAgICB9DQoNCiAgICAgICAgbGV0IGdtID0gZ3VhcmRNYXNrW3NxXSA+Pj4gMDsNCiAgICAgICAgd2hpbGUgKGdtICE9PSAwKSB7DQogICAgICAgICAgICBjb25zdCBiaXQgPSBnbSAmIC1nbTsNCiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsNCiAgICAgICAgICAgIGNvbnN0IGd1YXJkZXIgPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICAgICAgaWYgKHRhcmdldCAmJiB0YXJnZXQgIT09IGd1YXJkZXIgJiYgdGFyZ2V0LnBpZWNlLmNvbG9yID09PSBndWFyZGVyLnBpZWNlLmNvbG9yKSB7DQogICAgICAgICAgICAgICAgZ3VhcmRlci5ndWFyZC5wdXNoKHRhcmdldCk7DQogICAgICAgICAgICAgICAgdGFyZ2V0Lmd1YXJkZWRCeS5wdXNoKGd1YXJkZXIpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZ20gXj0gYml0Ow0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5L6bIGlzUG9zaXRpb25BY2NlcHRhYmxlIC8g54K55qOLIGNvbnRyb2xsZXJz77ya5LiO5pen6K+t5LmJ5LiA6Ie077yM5LuF56m65o6n5qC8DQogICAgY29uc3QgZ3JpZCA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7DQogICAgZm9yIChsZXQgc3EgPSAwOyBzcSA8IFJFTF9TUVVBUkVTOyBzcSsrKSB7DQogICAgICAgIGxldCBjbSA9IGNvbnRyb2xNYXNrW3NxXSA+Pj4gMDsNCiAgICAgICAgaWYgKGNtID09PSAwKSBjb250aW51ZTsNCiAgICAgICAgY29uc3QgciA9IChzcSAvIDkpIHwgMDsNCiAgICAgICAgY29uc3QgYyA9IHNxICUgOTsNCiAgICAgICAgd2hpbGUgKGNtICE9PSAwKSB7DQogICAgICAgICAgICBjb25zdCBiaXQgPSBjbSAmIC1jbTsNCiAgICAgICAgICAgIGNvbnN0IGkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsNCiAgICAgICAgICAgIGdyaWRbcl1bY10ucHVzaChwaWVjZXNJbmZvW2ldKTsNCiAgICAgICAgICAgIGNtIF49IGJpdDsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBib2FyZEluZm8uY29udHJvbGxlckdyaWQgPSBncmlkOw0KfTsNCg0KLy8g6K6h566X5qOL5a2Q5YWz57O777yabWFzayDot6/lvoTlhpkgVWludDMyIOagvOS9jeihqO+8m+WIl+ihqOi3r+W+hOS/neaMgeaXpyBwdXNoDQpjb25zdCBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyA9IChib2FyZCwgcGllY2VzSW5mbywgYm9hcmRJbmZvKSA9PiB7DQogICAgY29uc3QgdXNlTWFza3MgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpOw0KICAgIGNvbnN0IHVzZUF0dGFja0JpdHMgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMpICYmICF1c2VNYXNrczsNCg0KICAgIGlmICghdXNlTWFza3MpIHsNCiAgICAgICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgICAgIGluZm8udGhyZWF0ID0gW107DQogICAgICAgICAgICBpbmZvLnRocmVhdGVuZWRCeSA9IFtdOw0KICAgICAgICAgICAgaW5mby5ndWFyZCA9IFtdOw0KICAgICAgICAgICAgaW5mby5ndWFyZGVkQnkgPSBbXTsNCiAgICAgICAgICAgIGluZm8uY29udHJvbCA9IFtdOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgaWYgKCFib2FyZEluZm8pIHsNCiAgICAgICAgYm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsNCiAgICB9DQoNCiAgICBjbGVhclBpZWNlQXRTcSgpOw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgaWYgKGluZm8ucGllY2VJbmRleCA9PSBudWxsKSBpbmZvLnBpZWNlSW5kZXggPSBpOw0KICAgICAgICBzY3JhdGNoUGllY2VBdFNxW2luZm8uciAqIDkgKyBpbmZvLmNdID0gaW5mbzsNCiAgICB9DQoNCiAgICBsZXQgcmVsQ3R4ID0gbnVsbDsNCiAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgcmVsQ3R4ID0gc2NyYXRjaFJlbEN0eDsNCiAgICAgICAgcmVsQ3R4LnVzZU1hc2tzID0gdHJ1ZTsNCiAgICAgICAgcmVsQ3R4LnNraXBDb250cm9sTWFzayA9ICEhYm9hcmRJbmZvLnNraXBDb250cm9sTWFzazsNCiAgICAgICAgcmVsQ3R4LmF0dGFja01hc2sgPSBib2FyZEluZm8uYXR0YWNrTWFzazsNCiAgICAgICAgcmVsQ3R4Lmd1YXJkTWFzayA9IGJvYXJkSW5mby5ndWFyZE1hc2s7DQogICAgICAgIHJlbEN0eC5jb250cm9sTWFzayA9IGJvYXJkSW5mby5jb250cm9sTWFzazsNCiAgICAgICAgcmVsQ3R4LnJlZEF0dGFjayA9IGJvYXJkSW5mby5yZWRBdHRhY2s7DQogICAgICAgIHJlbEN0eC5ibGFja0F0dGFjayA9IGJvYXJkSW5mby5ibGFja0F0dGFjazsNCiAgICB9DQoNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07DQogICAgICAgIGlmIChyZWxDdHgpIHJlbEN0eC5waWVjZUluZGV4ID0gaW5mby5waWVjZUluZGV4Ow0KDQogICAgICAgIGlmIChpbmZvLnBpZWNlLnR5cGUgPT09ICdjYW5ub24nKSB7DQogICAgICAgICAgICBmaWxsQ2Fubm9uUmVsYXRpb25zKGJvYXJkLCBpbmZvLCBzY3JhdGNoUGllY2VBdFNxLCByZWxDdHgpOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgZmlsbE5vbkNhbm5vblJlbGF0aW9ucyhib2FyZCwgaW5mbywgc2NyYXRjaFBpZWNlQXRTcSwgcmVsQ3R4KTsNCiAgICAgICAgfQ0KDQogICAgICAgIGlmICghdXNlTWFza3MpIHsNCiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2wgPSBpbmZvLmNvbnRyb2w7DQogICAgICAgICAgICBpZiAodXNlQXR0YWNrQml0cykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGJpdHMgPSBpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRBdHRhY2sgOiBib2FyZEluZm8uYmxhY2tBdHRhY2s7DQogICAgICAgICAgICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBjb250cm9sLmxlbmd0aDsgaysrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvcyA9IGNvbnRyb2xba107DQogICAgICAgICAgICAgICAgICAgIHNldEF0dGFja0JpdChiaXRzLCBwb3MuciAqIDkgKyBwb3MuYyk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGJvYXJkSW5mb1swXSkpIHsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBrID0gMDsgayA8IGNvbnRyb2wubGVuZ3RoOyBrKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zID0gY29udHJvbFtrXTsNCiAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvW3Bvcy5yXVtwb3MuY10ucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBsZXQgcmVkSXNJbkNoZWNrID0gZmFsc2U7DQogICAgbGV0IGJsYWNrSXNJbkNoZWNrID0gZmFsc2U7DQogICAgbGV0IHJlZEdlbmVyYWxJbmZvID0gbnVsbDsNCiAgICBsZXQgYmxhY2tHZW5lcmFsSW5mbyA9IG51bGw7DQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICBpZiAoaW5mby5waWVjZS5jb2xvciA9PT0gJ3JlZCcpIHJlZEdlbmVyYWxJbmZvID0gaW5mbzsNCiAgICAgICAgICAgIGVsc2UgYmxhY2tHZW5lcmFsSW5mbyA9IGluZm87DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgaWYgKHJlZEdlbmVyYWxJbmZvICYmIGJvYXJkSW5mby5hdHRhY2tNYXNrW3JlZEdlbmVyYWxJbmZvLnIgKiA5ICsgcmVkR2VuZXJhbEluZm8uY10gIT09IDApIHsNCiAgICAgICAgICAgIHJlZElzSW5DaGVjayA9IHRydWU7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGJsYWNrR2VuZXJhbEluZm8gJiYgYm9hcmRJbmZvLmF0dGFja01hc2tbYmxhY2tHZW5lcmFsSW5mby5yICogOSArIGJsYWNrR2VuZXJhbEluZm8uY10gIT09IDApIHsNCiAgICAgICAgICAgIGJsYWNrSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0gZWxzZSB7DQogICAgICAgIGlmIChyZWRHZW5lcmFsSW5mbykgew0KICAgICAgICAgICAgZm9yIChjb25zdCB0aHJlYXRlbmVyIG9mIHJlZEdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgew0KICAgICAgICAgICAgICAgIGlmICh0aHJlYXRlbmVyLnBpZWNlLmNvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgIHJlZElzSW5DaGVjayA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoYmxhY2tHZW5lcmFsSW5mbykgew0KICAgICAgICAgICAgZm9yIChjb25zdCB0aHJlYXRlbmVyIG9mIGJsYWNrR2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7DQogICAgICAgICAgICAgICAgaWYgKHRocmVhdGVuZXIucGllY2UuY29sb3IgPT09ICdyZWQnKSB7DQogICAgICAgICAgICAgICAgICAgIGJsYWNrSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgaWYgKHJlZEdlbmVyYWxJbmZvICYmIGJsYWNrR2VuZXJhbEluZm8gJiYgcmVkR2VuZXJhbEluZm8uYyA9PT0gYmxhY2tHZW5lcmFsSW5mby5jKSB7DQogICAgICAgIGxldCBoYXNQaWVjZUJldHdlZW4gPSBmYWxzZTsNCiAgICAgICAgY29uc3Qgc3RhcnRSID0gTWF0aC5taW4ocmVkR2VuZXJhbEluZm8uciwgYmxhY2tHZW5lcmFsSW5mby5yKSArIDE7DQogICAgICAgIGNvbnN0IGVuZFIgPSBNYXRoLm1heChyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpIC0gMTsNCiAgICAgICAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtyXVtyZWRHZW5lcmFsSW5mby5jXSkgew0KICAgICAgICAgICAgICAgIGhhc1BpZWNlQmV0d2VlbiA9IHRydWU7DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKCFoYXNQaWVjZUJldHdlZW4pIHsNCiAgICAgICAgICAgIHJlZElzSW5DaGVjayA9IHRydWU7DQogICAgICAgICAgICBibGFja0lzSW5DaGVjayA9IHRydWU7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBib2FyZEluZm8ucmVkSXNJbkNoZWNrID0gcmVkSXNJbkNoZWNrOw0KICAgIGJvYXJkSW5mby5ibGFja0lzSW5DaGVjayA9IGJsYWNrSXNJbkNoZWNrOw0KfTsNCg0KY29uc3QgaXNQb3NpdGlvbkFjY2VwdGFibGUgPSAoYm9hcmQsIGZyb20sIHRvLCBjdXJyZW50UGxheWVyLCBib2FyZEluZm8gPSBudWxsLCBwaWVjZXNJbmZvID0gbnVsbCwgdHJ5TW92ZVBpZWNlID0gbnVsbCwgZ2FtZVN0YWdlID0gJ21pZCcpID0+IHsNCiAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IHRyeU1vdmVQaWVjZSB8fCBib2FyZFtmcm9tLnJdW2Zyb20uY107DQogICAgY29uc3QgdGFyZ2V0UGllY2UgPSBib2FyZFt0by5yXVt0by5jXTsNCiAgICBjb25zdCBpc0NhcHR1cmUgPSB0YXJnZXRQaWVjZSAmJiB0YXJnZXRQaWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcjsNCg0KICAgIC8vIOaUtumbhuaJgOacieaji+WtkOS/oeaBr++8jOWPquWcqOayoeacieaPkOS+m+aXtuiuoeeulw0KICAgIGxldCBsb2NhbFBpZWNlc0luZm8gPSBwaWVjZXNJbmZvOw0KICAgIGlmICghbG9jYWxQaWVjZXNJbmZvKSB7DQogICAgICAgIGxvY2FsUGllY2VzSW5mbyA9IFtdOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBhbGx5R3VhcmRzID0gW107DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgeyByLCBjIH0sIHBpZWNlLCBhbGx5R3VhcmRzKTsNCiAgICAgICAgICAgICAgICAgICAgbG9jYWxQaWVjZXNJbmZvLnB1c2goew0KICAgICAgICAgICAgICAgICAgICAgICAgcGllY2UsDQogICAgICAgICAgICAgICAgICAgICAgICByLCBjLCBtb3ZlcywgYWxseUd1YXJkcywNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsVmFsdWU6IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSksDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkOiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkZWRCeTogW10sDQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpY1ZhbHVlOiAwDQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOiuoeeul+aji+WtkOWFs+ezu+WSjOaOp+WItuS/oeaBr++8jOWPquWcqOayoeacieaPkOS+m+aXtuiuoeeulw0KICAgIGxldCBsb2NhbEJvYXJkSW5mbyA9IGJvYXJkSW5mbzsNCiAgICBpZiAoIWxvY2FsQm9hcmRJbmZvKSB7DQogICAgICAgIGlmIChsb2NhbFBpZWNlc0luZm8ubGVuZ3RoIDw9IDMyKSB7CiAgICAgICAgICAgIGNsZWFyUmVsYXRpb25NYXNrcygpOw0KICAgICAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOw0KICAgICAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxvY2FsUGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGxvY2FsUGllY2VzSW5mb1tpXS5waWVjZUluZGV4ID0gaTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGxvY2FsQm9hcmRJbmZvID0gew0KICAgICAgICAgICAgICAgIHVzZVJlbGF0aW9uTWFza3M6IHRydWUsDQogICAgICAgICAgICAgICAgdXNlQXR0YWNrQml0czogdHJ1ZSwNCiAgICAgICAgICAgICAgICBhdHRhY2tNYXNrOiBzY3JhdGNoQXR0YWNrTWFzaywNCiAgICAgICAgICAgICAgICBndWFyZE1hc2s6IHNjcmF0Y2hHdWFyZE1hc2ssDQogICAgICAgICAgICAgICAgY29udHJvbE1hc2s6IHNjcmF0Y2hDb250cm9sTWFzaywNCiAgICAgICAgICAgICAgICByZWRBdHRhY2s6IHNjcmF0Y2hSZWRBdHRhY2ssDQogICAgICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICAgICAgfTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGxvY2FsQm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsNCiAgICAgICAgfQ0KICAgICAgICBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyhib2FyZCwgbG9jYWxQaWVjZXNJbmZvLCBsb2NhbEJvYXJkSW5mbyk7DQogICAgfQ0KDQogICAgLy8g5o6n5Yi26ICF77yabWFzayDnlKggY29udHJvbE1hc2vvvJvml6fot6/lvoTnlKggYm9hcmRJbmZvW3JdW2Nd77ybaHlkcmF0ZSDlkI7lj6/nlKggY29udHJvbGxlckdyaWQNCiAgICBsZXQgY29udHJvbGxlcnM7DQogICAgaWYgKGxvY2FsQm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpIHsNCiAgICAgICAgY29udHJvbGxlcnMgPSBbXTsNCiAgICAgICAgZm9yRWFjaFNldEJpdChsb2NhbEJvYXJkSW5mby5jb250cm9sTWFza1t0by5yICogOSArIHRvLmNdLCAoaSkgPT4gew0KICAgICAgICAgICAgY29udHJvbGxlcnMucHVzaChsb2NhbFBpZWNlc0luZm9baV0pOw0KICAgICAgICB9KTsNCiAgICB9IGVsc2UgaWYgKGxvY2FsQm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkKSB7DQogICAgICAgIGNvbnRyb2xsZXJzID0gbG9jYWxCb2FyZEluZm8uY29udHJvbGxlckdyaWRbdG8ucl1bdG8uY10gfHwgW107DQogICAgfSBlbHNlIHsNCiAgICAgICAgY29udHJvbGxlcnMgPSBsb2NhbEJvYXJkSW5mb1t0by5yXVt0by5jXSB8fCBbXTsNCiAgICB9DQogICAgbGV0IGhhc0FsbHlDb250cm9sbGVyID0gZmFsc2U7DQogICAgbGV0IGhhc0VuZW15Q29udHJvbGxlciA9IGZhbHNlOw0KDQogICAgLy8g5o6n5Yi26ICF5Y+v6IO95pivIHBpZWNlc0luZm8g5byV55SoIHtwaWVjZSxyLGN9IOaIluaXp+e7k+aehCB7Y29sb3IsdHlwZSxyLGN9DQogICAgY29uc3QgY29udHJvbGxlckNvbG9yID0gKGNvbnRyb2xsZXIpID0+DQogICAgICAgIGNvbnRyb2xsZXIucGllY2UgPyBjb250cm9sbGVyLnBpZWNlLmNvbG9yIDogY29udHJvbGxlci5jb2xvcjsNCg0KICAgIGZvciAoY29uc3QgY29udHJvbGxlciBvZiBjb250cm9sbGVycykgew0KICAgICAgICAvLyDmjpLpmaTmraPlnKjnp7vliqjnmoTmo4vlrZDmnKzouqvvvIjotbDlkI7lroPkuI3lho3ku47ljp/kvY3mjqfliLbnm67moIfvvIkNCiAgICAgICAgaWYgKG1vdmluZ1BpZWNlICYmIGNvbnRyb2xsZXIuciA9PT0gZnJvbS5yICYmIGNvbnRyb2xsZXIuYyA9PT0gZnJvbS5jKSB7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoY29udHJvbGxlckNvbG9yKGNvbnRyb2xsZXIpID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICBoYXNBbGx5Q29udHJvbGxlciA9IHRydWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBoYXNFbmVteUNvbnRyb2xsZXIgPSB0cnVlOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgaWYgKGlzQ2FwdHVyZSkgew0KICAgICAgICAvLyDnmb3lkIPvvJrnm67moIfmnKrooqvmlYzmlrnkv53miqQNCiAgICAgICAgaWYgKCFoYXNFbmVteUNvbnRyb2xsZXIpIHsNCiAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgICAgIC8vIOeugOWNlSBTRUXvvJrlhYjlvpfnm67moIfliIbvvIzoi6XkvJrooqvlj43lkIPliJnlho3lpLHlt7Hmlrnmo4vlrZANCiAgICAgICAgY29uc3QgdGFyZ2V0VmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHRhcmdldFBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCBvdXJWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUobW92aW5nUGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgIGxldCBzZWUgPSB0YXJnZXRWYWx1ZSAtIG91clZhbHVlOw0KICAgICAgICAvLyDoi6XmnInlt7Hmlrnnu6fnu63kv53miqTvvIznspfnlaXorqTkuLrlj6/og73lho3lkIPlm57mnIDkvY7ku7flgLznmoTmlYzmlrnkv53miqTogIUNCiAgICAgICAgaWYgKGhhc0FsbHlDb250cm9sbGVyKSB7DQogICAgICAgICAgICBjb25zdCBlbmVteUd1YXJkVmFsdWVzID0gY29udHJvbGxlcnMNCiAgICAgICAgICAgICAgICAuZmlsdGVyKGMgPT4gY29udHJvbGxlckNvbG9yKGMpICE9PSBjdXJyZW50UGxheWVyICYmICEoYy5yID09PSBmcm9tLnIgJiYgYy5jID09PSBmcm9tLmMpKQ0KICAgICAgICAgICAgICAgIC5tYXAoYyA9PiB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtjLnJdW2MuY107DQogICAgICAgICAgICAgICAgICAgIHJldHVybiBwID8gZ2V0TWF0ZXJpYWxWYWx1ZShwLCBnYW1lU3RhZ2UpIDogMDsNCiAgICAgICAgICAgICAgICB9KQ0KICAgICAgICAgICAgICAgIC5maWx0ZXIodiA9PiB2ID4gMCkNCiAgICAgICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gYSAtIGIpOw0KICAgICAgICAgICAgaWYgKGVuZW15R3VhcmRWYWx1ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgIHNlZSArPSBlbmVteUd1YXJkVmFsdWVzWzBdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIC8vIOaYjuaYvuS6j+aNou+8iOWmgui9puaNouaXoOagueWFteS4lOS8muiiq+WPjeWQg++8ieWImei/h+a7pO+8m+W5s+aNoi/otZrmjaLnlZnnu5nmkJzntKINCiAgICAgICAgcmV0dXJuIHNlZSA+PSAwOw0KICAgIH0NCg0KICAgIC8vIOmdnuWQg+WtkO+8muebruagh+S7heiiq+aVjOaWueaOp+WItuWImeinhuS4uumAgeWQgw0KICAgIGlmIChjb250cm9sbGVycy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHRydWU7DQogICAgfQ0KICAgIHJldHVybiAhaGFzRW5lbXlDb250cm9sbGVyIHx8IGhhc0FsbHlDb250cm9sbGVyOw0KfTsNCg0KLy8gU0VFIOaOkuW6j+WkjeeUqOe8k+WGsu+8jOmZjeS9juWPtuivhOS8sCBHQw0KY29uc3Qgc2VlQXR0YWNrZXJTY3JhdGNoID0gW107DQpjb25zdCBzZWVHdWFyZFNjcmF0Y2ggPSBbXTsNCmNvbnN0IHNlZUF0dGFja2VyTWF0U2NyYXRjaCA9IFtdOw0KY29uc3Qgc2VlR3VhcmRNYXRTY3JhdGNoID0gW107DQoNCi8vIOacieagueWtkOeugOWMliBTRUXvvIjkuI7ml6flrp7njrDpgJDooYznrYnku7fvvInvvJvmr4/kuKrnm67moIflj6rlupTosIPnlKjkuIDmrKENCmNvbnN0IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmUgPSAodGhyZWF0ZW5lZFBpZWNlKSA9PiB7DQogICAgY29uc3QgYXR0YWNrZXJzID0gc2VlQXR0YWNrZXJTY3JhdGNoOw0KICAgIGNvbnN0IGd1YXJkcyA9IHNlZUd1YXJkU2NyYXRjaDsNCiAgICBhdHRhY2tlcnMubGVuZ3RoID0gMDsNCiAgICBndWFyZHMubGVuZ3RoID0gMDsNCiAgICBjb25zdCByYXdBdHRhY2tlcnMgPSB0aHJlYXRlbmVkUGllY2UudGhyZWF0ZW5lZEJ5Ow0KICAgIGNvbnN0IHJhd0d1YXJkcyA9IHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnk7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCByYXdBdHRhY2tlcnMubGVuZ3RoOyBpKyspIGF0dGFja2Vycy5wdXNoKHJhd0F0dGFja2Vyc1tpXSk7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCByYXdHdWFyZHMubGVuZ3RoOyBpKyspIGd1YXJkcy5wdXNoKHJhd0d1YXJkc1tpXSk7DQogICAgYXR0YWNrZXJzLnNvcnQoKGEsIGIpID0+IGEubWF0ZXJpYWxWYWx1ZSAtIGIubWF0ZXJpYWxWYWx1ZSk7DQogICAgZ3VhcmRzLnNvcnQoKGEsIGIpID0+IGEubWF0ZXJpYWxWYWx1ZSAtIGIubWF0ZXJpYWxWYWx1ZSk7DQoNCiAgICBsZXQgZXhjaGFuZ2VTY29yZSA9IDA7DQogICAgbGV0IGF0dGFja2VySW5kZXggPSAwOw0KICAgIGxldCBndWFyZEluZGV4ID0gMDsNCiAgICBjb25zdCB0YXJnZXRWYWx1ZSA9IHRocmVhdGVuZWRQaWVjZS5tYXRlcmlhbFZhbHVlOw0KDQogICAgd2hpbGUgKGF0dGFja2VySW5kZXggPCBhdHRhY2tlcnMubGVuZ3RoICYmIGd1YXJkSW5kZXggPCBndWFyZHMubGVuZ3RoKSB7DQogICAgICAgIGlmIChndWFyZEluZGV4ID09PSAwKSB7DQogICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IHRhcmdldFZhbHVlOw0KICAgICAgICB9DQogICAgICAgIGV4Y2hhbmdlU2NvcmUgLT0gYXR0YWNrZXJzW2F0dGFja2VySW5kZXhdLm1hdGVyaWFsVmFsdWU7DQogICAgICAgIGlmIChhdHRhY2tlckluZGV4ICsgMSA8IGF0dGFja2Vycy5sZW5ndGgpIHsNCiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gZ3VhcmRzW2d1YXJkSW5kZXhdLm1hdGVyaWFsVmFsdWU7DQogICAgICAgIH0NCiAgICAgICAgYXR0YWNrZXJJbmRleCsrOw0KICAgICAgICBndWFyZEluZGV4Kys7DQogICAgfQ0KICAgIHJldHVybiBleGNoYW5nZVNjb3JlOw0KfTsNCg0KLy8gbWFzayDot6/lvoQgU0VF77ya5p2Q5paZ5pWw57uE5o6S5bqP77yM6K+t5LmJ5LiO5LiK5byP5LiA6Ie077yIYml0c2NhbiDlhoXogZTvvIzml6Dlm57osIPvvIkNCmNvbnN0IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmVGcm9tTWFza3MgPSAodGhyZWF0ZW5lZFBpZWNlLCBwaWVjZXNJbmZvLCBhdHRhY2tNYXNrLCBndWFyZE1hc2spID0+IHsNCiAgICBjb25zdCBhdGtNYXRzID0gc2VlQXR0YWNrZXJNYXRTY3JhdGNoOw0KICAgIGNvbnN0IGdyZE1hdHMgPSBzZWVHdWFyZE1hdFNjcmF0Y2g7DQogICAgYXRrTWF0cy5sZW5ndGggPSAwOw0KICAgIGdyZE1hdHMubGVuZ3RoID0gMDsNCiAgICBjb25zdCBzcSA9IHRocmVhdGVuZWRQaWVjZS5zcSA9PSBudWxsCiAgICAgICAgPyB0aHJlYXRlbmVkUGllY2UuciAqIDkgKyB0aHJlYXRlbmVkUGllY2UuYwogICAgICAgIDogdGhyZWF0ZW5lZFBpZWNlLnNxOwogICAgbGV0IGFtID0gYXR0YWNrTWFza1tzcV0gPj4+IDA7DQogICAgd2hpbGUgKGFtICE9PSAwKSB7DQogICAgICAgIGNvbnN0IGJpdCA9IGFtICYgLWFtOw0KICAgICAgICBhdGtNYXRzLnB1c2gocGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV0ubWF0ZXJpYWxWYWx1ZSk7DQogICAgICAgIGFtIF49IGJpdDsNCiAgICB9DQogICAgbGV0IGdtID0gZ3VhcmRNYXNrW3NxXSA+Pj4gMDsNCiAgICB3aGlsZSAoZ20gIT09IDApIHsNCiAgICAgICAgY29uc3QgYml0ID0gZ20gJiAtZ207DQogICAgICAgIGdyZE1hdHMucHVzaChwaWVjZXNJbmZvWzMxIC0gTWF0aC5jbHozMihiaXQpXS5tYXRlcmlhbFZhbHVlKTsNCiAgICAgICAgZ20gXj0gYml0Ow0KICAgIH0NCiAgICBhdGtNYXRzLnNvcnQoKGEsIGIpID0+IGEgLSBiKTsNCiAgICBncmRNYXRzLnNvcnQoKGEsIGIpID0+IGEgLSBiKTsNCg0KICAgIGxldCBleGNoYW5nZVNjb3JlID0gMDsNCiAgICBsZXQgYXR0YWNrZXJJbmRleCA9IDA7DQogICAgbGV0IGd1YXJkSW5kZXggPSAwOw0KICAgIGNvbnN0IHRhcmdldFZhbHVlID0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7DQoNCiAgICB3aGlsZSAoYXR0YWNrZXJJbmRleCA8IGF0a01hdHMubGVuZ3RoICYmIGd1YXJkSW5kZXggPCBncmRNYXRzLmxlbmd0aCkgew0KICAgICAgICBpZiAoZ3VhcmRJbmRleCA9PT0gMCkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSB0YXJnZXRWYWx1ZTsNCiAgICAgICAgfQ0KICAgICAgICBleGNoYW5nZVNjb3JlIC09IGF0a01hdHNbYXR0YWNrZXJJbmRleF07DQogICAgICAgIGlmIChhdHRhY2tlckluZGV4ICsgMSA8IGF0a01hdHMubGVuZ3RoKSB7DQogICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IGdyZE1hdHNbZ3VhcmRJbmRleF07DQogICAgICAgIH0NCiAgICAgICAgYXR0YWNrZXJJbmRleCsrOw0KICAgICAgICBndWFyZEluZGV4Kys7DQogICAgfQ0KICAgIHJldHVybiBleGNoYW5nZVNjb3JlOw0KfTsNCg0KLy8g6K6h566X5aiB6IOB5YC877yI5Z+65LqO5a6M5pW055qE5aiB6IOB5YWz57O777yJDQovLyDmjInooqvlqIHog4HlrZDogZrlkIjvvJrmr4/kuKrnm67moIfmnIDlpJrkuIDmrKEgU0VF77yb5YiG5YC85Yqg57uZIHRocmVhdGVuZWRCeVswXQ0KLy8g77yI5YWz57O75p6E5bu65oyJIHBpZWNlc0luZm8g6aG65bqPIHB1c2jvvIzmlYXkuI7ml6figJzmlLvlh7vmlrnlpJblsYLpgY3ljobpppbmrKHorqHliIbigJ3lvZLlsZ7kuIDoh7TvvIkNCmNvbnN0IGNhbGN1bGF0ZVRocmVhdFZhbHVlcyA9IChwaWVjZXNJbmZvLCBjdXJyZW50UGxheWVyLCBib2FyZEluZm8gPSBudWxsLCBmb3JTZWFyY2hMZWFmID0gZmFsc2UpID0+IHsKICAgIC8vIOe7n+iuoQ0KICAgIGlmIChjdXJyZW50UGxheWVyKSB7DQogICAgICAgIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudFtjdXJyZW50UGxheWVyXSsrOw0KICAgIH0NCg0KICAgIC8vIOWIneWni+WMluWogeiDgeexu+Wei+e7n+iuoeS/oeaBrw0KICAgIGNvbnN0IGNvbGxlY3RVaSA9ICEhYm9hcmRJbmZvICYmICFmb3JTZWFyY2hMZWFmOwogICAgaWYgKGNvbGxlY3RVaSkgewogICAgICAgIGJvYXJkSW5mby5jaGVja3MgPSBbXTsgICAgICAvLyDlsIblhpvkv6Hmga8NCiAgICAgICAgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMgPSBbXTsgIC8vIOiiq+aNieeahOaji+WtkA0KICAgICAgICBib2FyZEluZm8uY2FuQ2FwdHVyZSA9IFtdOyAgLy8g5Y+v5ZCD55qE5qOL5a2QDQogICAgfQ0KDQogICAgY29uc3QgY2hlY2tCb251cyA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5jaGVjay5ib251czsNCiAgICBjb25zdCBjYW5DYXB0dXJlU2VlbiA9IGNvbGxlY3RVaSA/IG5ldyBTZXQoKSA6IG51bGw7CiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcyk7DQogICAgY29uc3QgYXR0YWNrTWFzayA9IHVzZU1hc2tzID8gYm9hcmRJbmZvLmF0dGFja01hc2sgOiBudWxsOw0KICAgIGNvbnN0IGd1YXJkTWFzayA9IHVzZU1hc2tzID8gYm9hcmRJbmZvLmd1YXJkTWFzayA6IG51bGw7DQoNCiAgICBmb3IgKGxldCB0aSA9IDA7IHRpIDwgcGllY2VzSW5mby5sZW5ndGg7IHRpKyspIHsNCiAgICAgICAgY29uc3QgdGhyZWF0ZW5lZFBpZWNlID0gcGllY2VzSW5mb1t0aV07DQogICAgICAgIGxldCBmaXJzdEF0dGFja2VyOw0KICAgICAgICBsZXQgaGFzR3VhcmQ7DQogICAgICAgIGxldCBhdHRhY2tlckxpc3QgPSBudWxsOw0KDQogICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgY29uc3Qgc3EgPSB0aHJlYXRlbmVkUGllY2UuciAqIDkgKyB0aHJlYXRlbmVkUGllY2UuYzsNCiAgICAgICAgICAgIGNvbnN0IGFtID0gYXR0YWNrTWFza1tzcV07DQogICAgICAgICAgICBpZiAoYW0gPT09IDApIGNvbnRpbnVlOw0KICAgICAgICAgICAgLy8g5pyA5L2OIGJpdCA9IHBpZWNlc0luZm8g6aG65bqP5LiL5pyA5YWI5oyC5LiK55qE5pS75Ye75pa577yI5LiO5penIHRocmVhdGVuZWRCeVswXSDkuIDoh7TvvIkNCiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIgPSBwaWVjZXNJbmZvW2xvd2VzdFNldEJpdEluZGV4KGFtKV07DQogICAgICAgICAgICBoYXNHdWFyZCA9IGd1YXJkTWFza1tzcV0gIT09IDA7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBjb25zdCBhdHRhY2tlcnMgPSB0aHJlYXRlbmVkUGllY2UudGhyZWF0ZW5lZEJ5Ow0KICAgICAgICAgICAgaWYgKCFhdHRhY2tlcnMgfHwgYXR0YWNrZXJzLmxlbmd0aCA9PT0gMCkgY29udGludWU7DQogICAgICAgICAgICBmaXJzdEF0dGFja2VyID0gYXR0YWNrZXJzWzBdOw0KICAgICAgICAgICAgaGFzR3VhcmQgPSB0aHJlYXRlbmVkUGllY2UuZ3VhcmRlZEJ5ICYmIHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnkubGVuZ3RoID4gMDsNCiAgICAgICAgICAgIGF0dGFja2VyTGlzdCA9IGF0dGFja2VyczsNCiAgICAgICAgfQ0KDQogICAgICAgIC8vIOWwhuWGm++8muWPque7meWwj+mineWFiOaJi+WIhu+8jOe7neS4jeaMieWwhi/luIXmnZDmlpnlgLzlgZogU0VFDQogICAgICAgIGlmICh0aHJlYXRlbmVkUGllY2UucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgew0KICAgICAgICAgICAgaWYgKGNvbGxlY3RVaSkgewogICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgIGxldCBtID0gYXR0YWNrTWFza1t0aHJlYXRlbmVkUGllY2UuciAqIDkgKyB0aHJlYXRlbmVkUGllY2UuY10gPj4+IDA7DQogICAgICAgICAgICAgICAgICAgIHdoaWxlIChtICE9PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiaXQgPSBtICYgLW07DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhaSA9IDMxIC0gTWF0aC5jbHozMihiaXQpOw0KICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNoZWNrcy5wdXNoKHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tlcjogcGllY2VzSW5mb1thaV0sDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiB0aHJlYXRlbmVkUGllY2UsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNDaGVjazogdHJ1ZQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICBtIF49IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGFpID0gMDsgYWkgPCBhdHRhY2tlckxpc3QubGVuZ3RoOyBhaSsrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2hlY2tzLnB1c2goew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja2VyOiBhdHRhY2tlckxpc3RbYWldLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldDogdGhyZWF0ZW5lZFBpZWNlLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQ2hlY2s6IHRydWUNCiAgICAgICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSBjaGVja0JvbnVzOw0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCg0KICAgICAgICAvLyDlj6rmiorlr7nmlLvlh7vmlrnmnInliKnnmoTlqIHog4HorqHlhaUgdGhyZWF0VmFsdWXvvIjljZXlkJHorqHlhaXvvIzkuI3lgZogc2FmZXR5IOWvueensOaJo+WIhu+8iQ0KICAgICAgICBpZiAoIWhhc0d1YXJkKSB7DQogICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IHRocmVhdGVuZWRQaWVjZS5tYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgaWYgKGNvbGxlY3RVaSkgewogICAgICAgICAgICAgICAgaWYgKGZpcnN0QXR0YWNrZXIucGllY2UuY29sb3IgPT09IGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBsZXQgbSA9IGF0dGFja01hc2tbdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmNdID4+PiAwOw0KICAgICAgICAgICAgICAgICAgICAgICAgd2hpbGUgKG0gIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiaXQgPSBtICYgLW07DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9bMzEgLSBNYXRoLmNsejMyKGJpdCldOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghY2FuQ2FwdHVyZVNlZW4uaGFzKGluZm8pKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbkNhcHR1cmVTZWVuLmFkZChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbSBePSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBhaSA9IDA7IGFpIDwgYXR0YWNrZXJMaXN0Lmxlbmd0aDsgYWkrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBhdHRhY2tlckxpc3RbYWldOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghY2FuQ2FwdHVyZVNlZW4uaGFzKGluZm8pKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbkNhcHR1cmVTZWVuLmFkZChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5wdXNoKHRocmVhdGVuZWRQaWVjZSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgY29uc3Qgc3NlU2NvcmUgPSB1c2VNYXNrcw0KICAgICAgICAgICAgICAgID8gY2FsY3VsYXRlU3RhdGljRXhjaGFuZ2VTY29yZUZyb21NYXNrcyh0aHJlYXRlbmVkUGllY2UsIHBpZWNlc0luZm8sIGF0dGFja01hc2ssIGd1YXJkTWFzaykNCiAgICAgICAgICAgICAgICA6IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmUodGhyZWF0ZW5lZFBpZWNlKTsNCiAgICAgICAgICAgIGlmIChzc2VTY29yZSA+IDApIHsNCiAgICAgICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IHNzZVNjb3JlICogMC41Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KfTsKCi8vIFNlYXJjaCBsZWF2ZXMgbmV2ZXIgY29uc3RydWN0IFVJIHJlbGF0aW9uIGxpc3RzLiBUaGlzIHBhdGggY29uc3VtZXMgb25seQovLyBwaWVjZUNvZGUvc3EgYW5kIHRoZSBtYXNrcyBlbWl0dGVkIGJ5IHRoZSBudW1lcmljIHJlbGF0aW9uIGJ1aWxkZXIuCmNvbnN0IGNhbGN1bGF0ZU51bWVyaWNTZWFyY2hMZWFmVGhyZWF0VmFsdWVzID0gKHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIpID0+IHsKICAgIGlmIChjdXJyZW50UGxheWVyKSB7CiAgICAgICAgcGVyZlN0YXRzLmNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50W2N1cnJlbnRQbGF5ZXJdKys7CiAgICB9CgogICAgY29uc3QgY2hlY2tCb251cyA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5jaGVjay5ib251czsKICAgIGZvciAobGV0IHRpID0gMDsgdGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgdGkrKykgewogICAgICAgIGNvbnN0IHRocmVhdGVuZWRQaWVjZSA9IHBpZWNlc0luZm9bdGldOwogICAgICAgIGNvbnN0IHNxID0gdGhyZWF0ZW5lZFBpZWNlLnNxOwogICAgICAgIGNvbnN0IGF0dGFja2VycyA9IHNjcmF0Y2hBdHRhY2tNYXNrW3NxXTsKICAgICAgICBpZiAoYXR0YWNrZXJzID09PSAwKSBjb250aW51ZTsKCiAgICAgICAgY29uc3QgZmlyc3RBdHRhY2tlciA9IHBpZWNlc0luZm9bbG93ZXN0U2V0Qml0SW5kZXgoYXR0YWNrZXJzKV07CiAgICAgICAgaWYgKCh0aHJlYXRlbmVkUGllY2UucGllY2VDb2RlICYgNykgPT09IDEpIHsKICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSBjaGVja0JvbnVzOwogICAgICAgIH0gZWxzZSBpZiAoc2NyYXRjaEd1YXJkTWFza1tzcV0gPT09IDApIHsKICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgICBjb25zdCBzc2VTY29yZSA9IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmVGcm9tTWFza3MoCiAgICAgICAgICAgICAgICB0aHJlYXRlbmVkUGllY2UsIHBpZWNlc0luZm8sIHNjcmF0Y2hBdHRhY2tNYXNrLCBzY3JhdGNoR3VhcmRNYXNrCiAgICAgICAgICAgICk7CiAgICAgICAgICAgIGlmIChzc2VTY29yZSA+IDApIHsKICAgICAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gc3NlU2NvcmUgKiAwLjU7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9Cn07CgovLyDorqHnrpflronlhajlgLzvvJrlsIbnqbrmjqfpgrvmoLzmmK/lkKbooqvmlYzmjqfvvIjml6AgdmlzaXQg5Zue6LCD77yJCmNvbnN0IGNhbGN1bGF0ZVNhZmV0eVZhbHVlcyA9IChwaWVjZXNJbmZvLCBib2FyZEluZm8sIGJvYXJkID0gbnVsbCwgZm9yU2VhcmNoTGVhZiA9IGZhbHNlKSA9PiB7CiAgICBpZiAoZm9yU2VhcmNoTGVhZiAmJiBib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMgJiYgYm9hcmQpIHsKICAgICAgICBmb3IgKGxldCBnaSA9IDA7IGdpIDwgcGllY2VzSW5mby5sZW5ndGg7IGdpKyspIHsKICAgICAgICAgICAgY29uc3QgZ2VuZXJhbCA9IHBpZWNlc0luZm9bZ2ldOwogICAgICAgICAgICBpZiAoZ2VuZXJhbC5waWVjZS50eXBlICE9PSBQSUVDRV9UWVBFUy5HRU5FUkFMKSBjb250aW51ZTsKCiAgICAgICAgICAgIGNvbnN0IGdlbmVyYWxDb2xvciA9IGdlbmVyYWwucGllY2UuY29sb3I7CiAgICAgICAgICAgIGNvbnN0IGVuZW15Qml0cyA9IGdlbmVyYWxDb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8uYmxhY2tBdHRhY2sgOiBib2FyZEluZm8ucmVkQXR0YWNrOwogICAgICAgICAgICBjb25zdCBpc1JlZCA9IGdlbmVyYWxDb2xvciA9PT0gJ3JlZCc7CiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gZ2VuZXJhbDsKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIE9SVEhfRElSU1tpXVswXTsKICAgICAgICAgICAgICAgIGNvbnN0IG5jID0gYyArIE9SVEhfRElSU1tpXVsxXTsKICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsKICAgICAgICAgICAgICAgIGlmIChpc1JlZCA/IChuciA8IDAgfHwgbnIgPiAyKSA6IChuciA8IDcgfHwgbnIgPiA5KSkgY29udGludWU7CiAgICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCAmJiBoYXNBdHRhY2tCaXQoZW5lbXlCaXRzLCBuciAqIDkgKyBuYykpIHsKICAgICAgICAgICAgICAgICAgICBnZW5lcmFsLnNhZmV0eVZhbHVlIC09IDUwOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybjsKICAgIH0KCiAgICBjb25zdCBnZW5lcmFsSW5mbyA9IFtdOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGlmIChwaWVjZXNJbmZvW2ldLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkdFTkVSQUwpIHsNCiAgICAgICAgICAgIGdlbmVyYWxJbmZvLnB1c2gocGllY2VzSW5mb1tpXSk7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VBdHRhY2tCaXRzKTsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcyk7DQoNCiAgICBmb3IgKGxldCBnaSA9IDA7IGdpIDwgZ2VuZXJhbEluZm8ubGVuZ3RoOyBnaSsrKSB7DQogICAgICAgIGNvbnN0IGdlbmVyYWwgPSBnZW5lcmFsSW5mb1tnaV07DQogICAgICAgIGNvbnN0IGdlbmVyYWxDb2xvciA9IGdlbmVyYWwucGllY2UuY29sb3I7DQogICAgICAgIGNvbnN0IGVuZW15Q29sb3IgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBjb25zdCBlbmVteUJpdHMgPSB1c2VBdHRhY2tCaXRzDQogICAgICAgICAgICA/IChlbmVteUNvbG9yID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRBdHRhY2sgOiBib2FyZEluZm8uYmxhY2tBdHRhY2spDQogICAgICAgICAgICA6IG51bGw7DQogICAgICAgIGNvbnN0IGlzUmVkID0gZ2VuZXJhbENvbG9yID09PSAncmVkJzsNCiAgICAgICAgY29uc3QgeyByLCBjIH0gPSBnZW5lcmFsOw0KDQogICAgICAgIGNvbnN0IHBlbmFsaXplSWZFbmVteSA9IChuciwgbmMpID0+IHsNCiAgICAgICAgICAgIGxldCBoYXNFbmVteUNvbnRyb2w7DQogICAgICAgICAgICBpZiAodXNlQXR0YWNrQml0cykgew0KICAgICAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbCA9IGhhc0F0dGFja0JpdChlbmVteUJpdHMsIG5yICogOSArIG5jKTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc3QgcG9zaXRpb25Db250cm9sbGVycyA9IGJvYXJkSW5mb1tucl1bbmNdOw0KICAgICAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbCA9IGZhbHNlOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IGNpID0gMDsgY2kgPCBwb3NpdGlvbkNvbnRyb2xsZXJzLmxlbmd0aDsgY2krKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sbGVyID0gcG9zaXRpb25Db250cm9sbGVyc1tjaV07DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gY29udHJvbGxlci5waWVjZSA/IGNvbnRyb2xsZXIucGllY2UuY29sb3IgOiBjb250cm9sbGVyLmNvbG9yOw0KICAgICAgICAgICAgICAgICAgICBpZiAoY29sb3IgPT09IGVuZW15Q29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbCA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmIChoYXNFbmVteUNvbnRyb2wpIGdlbmVyYWwuc2FmZXR5VmFsdWUgLT0gNTA7DQogICAgICAgIH07DQoNCiAgICAgICAgaWYgKCh1c2VNYXNrcyAmJiBib2FyZCkgfHwgKCghZ2VuZXJhbC5jb250cm9sIHx8IGdlbmVyYWwuY29udHJvbC5sZW5ndGggPT09IDApICYmIGJvYXJkKSkgew0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBPUlRIX0RJUlNbaV1bMF07DQogICAgICAgICAgICAgICAgY29uc3QgbmMgPSBjICsgT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKG5yIDwgMCB8fCBuciA+IDIpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAobnIgPCA3IHx8IG5yID4gOSkgew0KICAgICAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIHBlbmFsaXplSWZFbmVteShuciwgbmMpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKGdlbmVyYWwuY29udHJvbCAmJiBnZW5lcmFsLmNvbnRyb2wubGVuZ3RoKSB7DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGdlbmVyYWwuY29udHJvbC5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIHBlbmFsaXplSWZFbmVteShnZW5lcmFsLmNvbnRyb2xbaV0uciwgZ2VuZXJhbC5jb250cm9sW2ldLmMpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KfTsKCmNvbnN0IGNhbGN1bGF0ZU51bWVyaWNTZWFyY2hMZWFmU2FmZXR5VmFsdWVzID0gKHBpZWNlc0luZm8sIHNxdWFyZUNvZGVzKSA9PiB7CiAgICBmb3IgKGxldCBnaSA9IDA7IGdpIDwgcGllY2VzSW5mby5sZW5ndGg7IGdpKyspIHsKICAgICAgICBjb25zdCBnZW5lcmFsID0gcGllY2VzSW5mb1tnaV07CiAgICAgICAgaWYgKChnZW5lcmFsLnBpZWNlQ29kZSAmIDcpICE9PSAxKSBjb250aW51ZTsKCiAgICAgICAgY29uc3QgaXNSZWQgPSBnZW5lcmFsLnBpZWNlQ29kZSA8IDg7CiAgICAgICAgY29uc3QgZW5lbXlCaXRzID0gaXNSZWQgPyBzY3JhdGNoQmxhY2tBdHRhY2sgOiBzY3JhdGNoUmVkQXR0YWNrOwogICAgICAgIGNvbnN0IGRlc3RpbmF0aW9ucyA9IFNFQVJDSF9HRU5FUkFMX0RFU1RbaXNSZWQgPyAwIDogMV1bZ2VuZXJhbC5zcV07CiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0aW5hdGlvbnMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgY29uc3Qgc3EgPSBkZXN0aW5hdGlvbnNbaV07CiAgICAgICAgICAgIGlmIChzcXVhcmVDb2Rlc1tzcV0gPT09IDAgJiYgaGFzQXR0YWNrQml0KGVuZW15Qml0cywgc3EpKSB7CiAgICAgICAgICAgICAgICBnZW5lcmFsLnNhZmV0eVZhbHVlIC09IDUwOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQp9OwoKLy8gLS0tIFR5cGVzIChJbmxpbmVkIHRvIGF2b2lkIGltcG9ydCBpc3N1ZXMgaW4gV29ya2VyKSAtLS0KLy8gLy8gdHlwZSBDb2xvciAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgJ3JlZCcgfCAnYmxhY2snOw0KLy8gLy8gdHlwZSBQaWVjZVR5cGUgLSBUeXBlU2NyaXB0IHR5cGUgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5ICdnZW5lcmFsJyB8ICdhZHZpc29yJyB8ICdlbGVwaGFudCcgfCAnaG9yc2UnIHwgJ2NoYXJpb3QnIHwgJ2Nhbm5vbicgfCAnc29sZGllcic7DQovLyAvLyBpbnRlcmZhY2UgUGllY2UgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkNCi8vIC8vIGludGVyZmFjZSBQb3NpdGlvbiAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gaW50ZXJmYWNlIE1vdmUgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkNCi8vIC8vIHR5cGUgQm9hcmQgLSBUeXBlU2NyaXB0IHR5cGUgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5IChQaWVjZSB8IG51bGwpW11bXTsNCg0KLy8gLS0tIE9wZW5pbmcgQm9vayBUeXBlcyAtLS0NCi8vIE9wZW5pbmcgQm9vayBFbnRyeSAtIHJlcHJlc2VudHMgcG9zc2libGUgbW92ZXMgZm9yIGEgcG9zaXRpb24NCi8vIGludGVyZmFjZSBCb29rRW50cnkgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkNCg0KLy8gSW5kaXZpZHVhbCBtb3ZlIGluIG9wZW5pbmcgYm9vayB3aXRoIG1ldGFkYXRhDQovLyBpbnRlcmZhY2UgQm9va01vdmUgLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkNCg0KLy8gLS0tIFpvYnJpc3QgSGFzaGluZyBmb3IgT3BlbmluZyBCb29rIC0tLQ0KLy8gRWFjaCBwaWVjZSB0eXBlL2NvbG9yL3Bvc2l0aW9uIGdldHMgYSB1bmlxdWUgcmFuZG9tIDUzLWJpdCBpbnRlZ2VyDQovLyBVc2VzIHNlZWRlZCBSTkcgZm9yIGRldGVybWluaXN0aWMgaGFzaGluZw0KY2xhc3MgWm9icmlzdEhhc2hlciB7CiAgICBoYXNoVGFibGU7ICAvLyBbcm93XVtjb2xdW3BpZWNlSW5kZXhdCiAgICBwaWVjZVRvSW5kZXg7CgogICAgY29uc3RydWN0b3IoKSB7CiAgICAgICAgdGhpcy5waWVjZVRvSW5kZXggPSBuZXcgTWFwKFsKICAgICAgICAgICAgWydyZWQtZ2VuZXJhbCcsIDBdLCBbJ3JlZC1hZHZpc29yJywgMV0sIFsncmVkLWVsZXBoYW50JywgMl0sIFsncmVkLWhvcnNlJywgM10sCiAgICAgICAgICAgIFsncmVkLWNoYXJpb3QnLCA0XSwgWydyZWQtY2Fubm9uJywgNV0sIFsncmVkLXNvbGRpZXInLCA2XSwKICAgICAgICAgICAgWydibGFjay1nZW5lcmFsJywgN10sIFsnYmxhY2stYWR2aXNvcicsIDhdLCBbJ2JsYWNrLWVsZXBoYW50JywgOV0sIFsnYmxhY2staG9yc2UnLCAxMF0sCiAgICAgICAgICAgIFsnYmxhY2stY2hhcmlvdCcsIDExXSwgWydibGFjay1jYW5ub24nLCAxMl0sIFsnYmxhY2stc29sZGllcicsIDEzXQogICAgICAgIF0pOwogICAgICAgIC8vIEluaXRpYWxpemUgcmFuZG9tIGhhc2ggdmFsdWVzIHVzaW5nIHNlZWRlZCBSTkcgKDUzLWJpdCBpbnRlZ2VycyB0byBhdm9pZCBwcmVjaXNpb24gaXNzdWVzKQogICAgICAgIHRoaXMuaGFzaFRhYmxlID0gW107CiAgICAgICAgY29uc3QgTUFYX1NBRkUgPSAweDFGRkZGRkZGRkZGRkZGOyAvLyAyXjUzIC0gMQ0KICAgICAgICANCiAgICAgICAgLy8gU2ltcGxlIHNlZWRlZCBSTkcgKExDRyAtIExpbmVhciBDb25ncnVlbnRpYWwgR2VuZXJhdG9yKQ0KICAgICAgICBsZXQgc2VlZCA9IDEyMzQ1Njc4OTsgLy8gRml4ZWQgc2VlZCBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nDQogICAgICAgIGNvbnN0IHNlZWRlZFJhbmRvbSA9ICgpID0+IHsNCiAgICAgICAgICAgIHNlZWQgPSAoc2VlZCAqIDExMDM1MTUyNDUgKyAxMjM0NSkgJiAweDdmZmZmZmZmOw0KICAgICAgICAgICAgcmV0dXJuIHNlZWQgLyAweDdmZmZmZmZmOw0KICAgICAgICB9Ow0KDQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl0gPSBbXTsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY10gPSBbXTsKICAgICAgICAgICAgICAgIGZvciAobGV0IHAgPSAwOyBwIDwgMTQ7IHArKykgewogICAgICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIGRldGVybWluaXN0aWMgNTMtYml0IGludGVnZXIKICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWx1ZSA9IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSk7CiAgICAgICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY11bcF0gPSB2YWx1ZTsKICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIC8vIOWPtuivhOS8sOe8k+WtmOmUru+8mmJvYXJkSGFzaCBeIGluaXRpYXRvcktleSBeIHN0YWdlS2V5DQogICAgICAgIHRoaXMuZXZhbEluaXRpYXRvcktleXMgPSB7DQogICAgICAgICAgICByZWQ6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSksDQogICAgICAgICAgICBibGFjazogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKQ0KICAgICAgICB9Ow0KICAgICAgICB0aGlzLmV2YWxTdGFnZUtleXMgPSB7DQogICAgICAgICAgICBlYXJseTogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwNCiAgICAgICAgICAgIG1pZDogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwNCiAgICAgICAgICAgIGxhdGU6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSkNCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICBwaWVjZUluZGV4KHBpZWNlT3JLZXkpIHsKICAgICAgICBpZiAocGllY2VPcktleSA9PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkOwogICAgICAgIGxldCBjb2xvcjsKICAgICAgICBsZXQgdHlwZTsKICAgICAgICBpZiAodHlwZW9mIHBpZWNlT3JLZXkgPT09ICdzdHJpbmcnKSB7CiAgICAgICAgICAgIGNvbnN0IHNlcGFyYXRvciA9IHBpZWNlT3JLZXkuaW5kZXhPZignLScpOwogICAgICAgICAgICBpZiAoc2VwYXJhdG9yIDwgMCkgcmV0dXJuIHVuZGVmaW5lZDsKICAgICAgICAgICAgY29sb3IgPSBwaWVjZU9yS2V5LnNsaWNlKDAsIHNlcGFyYXRvcik7CiAgICAgICAgICAgIHR5cGUgPSBwaWVjZU9yS2V5LnNsaWNlKHNlcGFyYXRvciArIDEpOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGNvbG9yID0gcGllY2VPcktleS5jb2xvcjsKICAgICAgICAgICAgdHlwZSA9IHBpZWNlT3JLZXkudHlwZTsKICAgICAgICB9CiAgICAgICAgbGV0IHR5cGVJbmRleDsKICAgICAgICBzd2l0Y2ggKHR5cGUpIHsKICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5HRU5FUkFMOiB0eXBlSW5kZXggPSAwOyBicmVhazsKICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5BRFZJU09SOiB0eXBlSW5kZXggPSAxOyBicmVhazsKICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5FTEVQSEFOVDogdHlwZUluZGV4ID0gMjsgYnJlYWs7CiAgICAgICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuSE9SU0U6IHR5cGVJbmRleCA9IDM7IGJyZWFrOwogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkNIQVJJT1Q6IHR5cGVJbmRleCA9IDQ7IGJyZWFrOwogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkNBTk5PTjogdHlwZUluZGV4ID0gNTsgYnJlYWs7CiAgICAgICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuU09MRElFUjogdHlwZUluZGV4ID0gNjsgYnJlYWs7CiAgICAgICAgICAgIGRlZmF1bHQ6IHJldHVybiB1bmRlZmluZWQ7CiAgICAgICAgfQogICAgICAgIGlmIChjb2xvciA9PT0gJ3JlZCcpIHJldHVybiB0eXBlSW5kZXg7CiAgICAgICAgcmV0dXJuIGNvbG9yID09PSAnYmxhY2snID8gdHlwZUluZGV4ICsgNyA6IHVuZGVmaW5lZDsKICAgIH0KDQogICAgZXZhbENhY2hlS2V5KGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSkgew0KICAgICAgICBjb25zdCBzdGFnZUtleSA9IHRoaXMuZXZhbFN0YWdlS2V5c1tnYW1lU3RhZ2VdIHx8IHRoaXMuZXZhbFN0YWdlS2V5cy5taWQ7DQogICAgICAgIHJldHVybiB0aGlzLmhhc2goYm9hcmQpIF4gdGhpcy5ldmFsSW5pdGlhdG9yS2V5c1tzZWFyY2hJbml0aWF0b3JdIF4gc3RhZ2VLZXk7DQogICAgfQ0KDQogICAgZXZhbENhY2hlS2V5RnJvbUhhc2goYm9hcmRIYXNoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSkgew0KICAgICAgICBjb25zdCBzdGFnZUtleSA9IHRoaXMuZXZhbFN0YWdlS2V5c1tnYW1lU3RhZ2VdIHx8IHRoaXMuZXZhbFN0YWdlS2V5cy5taWQ7DQogICAgICAgIHJldHVybiBib2FyZEhhc2ggXiB0aGlzLmV2YWxJbml0aWF0b3JLZXlzW3NlYXJjaEluaXRpYXRvcl0gXiBzdGFnZUtleTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiDmlbDlgLwgVFQga2V577ya5oqK6KGM5qOL5pa557yW56CB6L+b5pyA5L2O5L2N77yM6YG/5YWNIGBoYXNoIF4gc2lkZUtleWAg5ZyoIEpTIFRvSW50MzINCiAgICAgKiDkuIvkuqfnlJ/ot6jnuqLpu5HnorDmkp7vvIjpgqPkvJrkvb8gVFQg6K+v5ZG95Lit5bm25pS55Y+Y5pCc57Si5qCRL+aji+WKm++8ieOAgg0KICAgICAqIOetieS7t+S6juaXp+Wtl+espuS4siBrZXkgYCR7aGFzaH06JHtzaWRlfWAg55qE5Yy65YiG6IO95Yqb44CCDQogICAgICovDQogICAgdHRLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNpZGUpIHsNCiAgICAgICAgY29uc3QgaCA9IGJvYXJkSGFzaCB8IDA7IC8vIF49IOmTvue7k+aenOW3suaYryBJbnQzMg0KICAgICAgICByZXR1cm4gaCAqIDIgKyAoc2lkZSA9PT0gJ3JlZCcgPyAwIDogMSk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQ29tcHV0ZSBoYXNoIGZvciBhIGJvYXJkIHBvc2l0aW9uDQogICAgICovDQogICAgaGFzaChib2FyZCkgew0KICAgICAgICBsZXQgaCA9IDA7DQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwaWVjZUlkeCA9IHRoaXMucGllY2VJbmRleChwaWVjZSk7DQogICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZUlkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBoIF49IHRoaXMuaGFzaFRhYmxlW3JdW2NdW3BpZWNlSWR4XTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gaDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBNaXJyb3IgYSBib2FyZCBob3Jpem9udGFsbHkgKGZvciBzeW1tZXRyeSBkZXRlY3Rpb24pDQogICAgICovDQogICAgbWlycm9yQm9hcmQoYm9hcmQpIHsNCiAgICAgICAgY29uc3QgbWlycm9yZWQgPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKSk7DQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsNCiAgICAgICAgICAgICAgICBtaXJyb3JlZFtyXVs4IC0gY10gPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gbWlycm9yZWQ7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogTWlycm9yIGEgbW92ZSBob3Jpem9udGFsbHkNCiAgICAgKi8NCiAgICBtaXJyb3JNb3ZlKG1vdmUpIHsNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IDggLSBtb3ZlLmZyb20uYyB9LA0KICAgICAgICAgICAgdG86IHsgcjogbW92ZS50by5yLCBjOiA4IC0gbW92ZS50by5jIH0NCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBJbmNyZW1lbnRhbGx5IHVwZGF0ZSBoYXNoIGFmdGVyIGEgbW92ZSAoWE9SIOiHqumAhu+8muWGjeiwg+eUqOS4gOasoeWPr+i/mOWOnykuDQogICAgICogbW92aW5nUGllY2UgLyBjYXB0dXJlZFBpZWNlIOWPr+S4uuaji+WtkOWvueixoeaIliAnY29sb3ItdHlwZScg5a2X56ym5Liy44CCDQogICAgICog6aG75ZyoIG1ha2VNb3ZlIOS5i+WJjeWPluW+lyBtb3ZpbmdQaWVjZe+8jGNhcHR1cmVkIOeUqCBtYWtlTW92ZSDov5Tlm57lgLzjgIINCiAgICAgKi8NCiAgICB1cGRhdGVIYXNoKGN1cnJlbnRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWRQaWVjZSkgew0KICAgICAgICBsZXQgbmV3SGFzaCA9IGN1cnJlbnRIYXNoOw0KICAgICAgICBjb25zdCBtb3ZpbmdJZHggPSB0aGlzLnBpZWNlSW5kZXgobW92aW5nUGllY2UpOw0KICAgICAgICBpZiAobW92aW5nSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXVttb3ZpbmdJZHhdOw0KICAgICAgICAgICAgbmV3SGFzaCBePSB0aGlzLmhhc2hUYWJsZVttb3ZlLnRvLnJdW21vdmUudG8uY11bbW92aW5nSWR4XTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgew0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRJZHggPSB0aGlzLnBpZWNlSW5kZXgoY2FwdHVyZWRQaWVjZSk7DQogICAgICAgICAgICBpZiAoY2FwdHVyZWRJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS50by5yXVttb3ZlLnRvLmNdW2NhcHR1cmVkSWR4XTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gbmV3SGFzaDsNCiAgICB9DQp9DQoNCi8qKg0KICogT3BlbmluZyBCb29rIE1hbmFnZXINCiAqLw0KY2xhc3MgT3BlbmluZ0Jvb2sgew0KICAgIGJvb2s7ICAvLyBab2JyaXN0IGhhc2ggLT4gbW92ZXMNCiAgICBoYXNoZXI7DQogICAgZW5hYmxlZDsNCiAgICBtYXhQbHk7ICAvLyBNYXhpbXVtIHBseSB0byB1c2Ugb3BlbmluZyBib29rIChlLmcuLCAyMCkNCg0KICAgIGNvbnN0cnVjdG9yKG1heFBseSA9IDEyKSB7DQogICAgICAgIHRoaXMuYm9vayA9IG5ldyBNYXAoKTsNCiAgICAgICAgdGhpcy5oYXNoZXIgPSBuZXcgWm9icmlzdEhhc2hlcigpOw0KICAgICAgICB0aGlzLmVuYWJsZWQgPSB0cnVlOw0KICAgICAgICB0aGlzLm1heFBseSA9IG1heFBseTsNCiAgICAgICAgdGhpcy5pbml0aWFsaXplQm9vaygpOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEluaXRpYWxpemUgd2l0aCBjb21tb24gQ2hpbmVzZSBDaGVzcyBvcGVuaW5ncw0KICAgICAqLw0KICAgIGluaXRpYWxpemVCb29rKCkgew0KICAgICAgICAvLyBBZGQgY2xhc3NpYyBDaGluZXNlIENoZXNzIG9wZW5pbmdzIG1hbnVhbGx5DQogICAgICAgIA0KICAgICAgICAvKg0KICAgICAgICAvLyAxLiDkuK3ngq7ov4fmsrPovablr7nlsY/po47pqazlubPngq7lr7novaYgKENlbnRyYWwgQ2Fubm9uIHZzIFNjcmVlbiBIb3JzZXMpDQogICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmUoWw0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDcsIGM6IDcgfSwgdG86IHsgcjogNywgYzogNCB9IH0sICAvLyAxLiDngq7kuozlubPkupQNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiA3IH0sIHRvOiB7IHI6IDIsIGM6IDYgfSB9LCAgLy8gMS4uLiDpqaw46L+bNw0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDcgfSwgdG86IHsgcjogNywgYzogNiB9IH0sICAvLyAyLiDpqazkuozov5vkuIkNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiA4IH0sIHRvOiB7IHI6IDAsIGM6IDcgfSB9LCAgLy8gMi4uLiDovaY55bmzOCAgICAgICAgICAgDQogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogOCB9LCB0bzogeyByOiA5LCBjOiA3IH0gfSwgIC8vIDMuIOi9puS4gOW5s+S6jA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDMsIGM6IDYgfSwgdG86IHsgcjogNCwgYzogNiB9IH0sICAvLyAzLi4uIOWNkjfov5sxDQogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogNyB9LCB0bzogeyByOiAzLCBjOiA3IH0gfSwgIC8vIDQuIOi9puS6jOi/m+WFrQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDEgfSwgdG86IHsgcjogMiwgYzogMiB9IH0sICAvLyA0Li4uIOmprDLov5szDQogICAgICAgICAgICB7IGZyb206IHsgcjogNiwgYzogMiB9LCB0bzogeyByOiA1LCBjOiAyIH0gfSwgIC8vIDUuIOWFteS4g+i/m+S4gA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDIsIGM6IDcgfSwgdG86IHsgcjogMiwgYzogOCB9IH0sICAvLyA1Li4uIOeCrjjlubM5DQogICAgICAgICAgICB7IGZyb206IHsgcjogMywgYzogNyB9LCB0bzogeyByOiAzLCBjOiA2IH0gfSwgIC8vIDYuIOi9puS6jOW5s+S4iQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDIsIGM6IDggfSwgdG86IHsgcjogMSwgYzogOCB9IH0sICAvLyA2Li4uIOeCrjnpgIAxICAgICAgICAgIA0KICAgICAgICBdLCBbODUsIDg1LCA5NSwgOTAsIDkwLCA4NSwgODUsIDgwLCA4NSwgODUsIDg1LCA4NV0pOw0KDQogICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tTm90YXRpb24oWw0KICAgICAgICAgICAgJ+eCruS6jOW5s+S6lCcsICfpqaw46L+bNycsICfpqazkuozov5vkuIknLCAn6L2mOeW5szgnLCAn6L2m5LiA5bmz5LqMJywgJ+WNkjfov5sxJywNCiAgICAgICAgICAgICfovabkuozov5vlha0nLCAn6amsMui/mzMnLCAn5YW15LiD6L+b5LiAJywgJ+eCrjjlubM5JywgJ+i9puS6jOW5s+S4iScsICfngq456YCAMScsDQogICAgICAgICAgICBdLCBbODUsIDg1LCA5NSwgOTAsIDkwLCA4NSwgODUsIDgwLCA4NSwgODUsIDg1LCA4NV0pOw0KDQogICAgICAgICAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21TdHJpbmcoWw0KICAgICAgICAgICAgJ+eCruS6jOW5s+S6lCDpqaw46L+bNyDpqazkuozov5vkuIkg6L2mOeW5szgg6L2m5LiA5bmz5LqMIOWNkjfov5sxIOi9puS6jOi/m+WFrSDpqawy6L+bMyDlhbXkuIPov5vkuIAg54KuOOW5szkg6L2m5LqM5bmz5LiJIOeCrjnpgIAxJw0KICAgICAgICBdLCBbODUsIDg1LCA5NSwgOTAsIDkwLCA4NSwgODUsIDgwLCA4NSwgODUsIDg1LCA4NV0pOw0KICAgICAgICAqLw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEFkZCBhbiBvcGVuaW5nIGxpbmUgdG8gdGhlIGJvb2sNCiAgICAgKiBAcGFyYW0gbW92ZXMgQXJyYXkgb2YgbW92ZXMgcmVwcmVzZW50aW5nIGFuIG9wZW5pbmcgbGluZQ0KICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIHdlaWdodHMgZm9yIGVhY2ggbW92ZSAoZGVmYXVsdCAxMDAgZm9yIGFsbCkNCiAgICAgKi8NCiAgICBhZGRPcGVuaW5nTGluZShtb3Zlcywgd2VpZ2h0cykgew0KICAgICAgICAvLyBTdGFydCB3aXRoIGluaXRpYWwgYm9hcmQgcG9zaXRpb24NCiAgICAgICAgY29uc3QgYm9hcmQgPSB0aGlzLmNyZWF0ZUluaXRpYWxCb2FyZCgpOw0KICAgICAgICBsZXQgY3VycmVudEhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKGJvYXJkKTsNCg0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbaV07DQogICAgICAgICAgICBjb25zdCB3ZWlnaHQgPSB3ZWlnaHRzPy5baV0gPz8gMTAwOw0KDQogICAgICAgICAgICAvLyBHZXQgb3IgY3JlYXRlIGJvb2sgZW50cnkgZm9yIHRoaXMgcG9zaXRpb24NCiAgICAgICAgICAgIGxldCBlbnRyeSA9IHRoaXMuYm9vay5nZXQoY3VycmVudEhhc2gpOw0KICAgICAgICAgICAgaWYgKCFlbnRyeSkgew0KICAgICAgICAgICAgICAgIGVudHJ5ID0geyBtb3ZlczogW10gfTsNCiAgICAgICAgICAgICAgICB0aGlzLmJvb2suc2V0KGN1cnJlbnRIYXNoLCBlbnRyeSk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEFkZCBtb3ZlIGlmIG5vdCBhbHJlYWR5IHByZXNlbnQNCiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nTW92ZSA9IGVudHJ5Lm1vdmVzLmZpbmQoDQogICAgICAgICAgICAgICAgbSA9PiBtLmZyb20uciA9PT0gbW92ZS5mcm9tLnIgJiYgbS5mcm9tLmMgPT09IG1vdmUuZnJvbS5jICYmDQogICAgICAgICAgICAgICAgICAgICBtLnRvLnIgPT09IG1vdmUudG8uciAmJiBtLnRvLmMgPT09IG1vdmUudG8uYw0KICAgICAgICAgICAgKTsNCg0KICAgICAgICAgICAgaWYgKCFleGlzdGluZ01vdmUpIHsNCiAgICAgICAgICAgICAgICBlbnRyeS5tb3Zlcy5wdXNoKHsNCiAgICAgICAgICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogbW92ZS5mcm9tLmMgfSwNCiAgICAgICAgICAgICAgICAgICAgdG86IHsgcjogbW92ZS50by5yLCBjOiBtb3ZlLnRvLmMgfSwNCiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiB3ZWlnaHQNCiAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8gVXBkYXRlIHdlaWdodCBpZiBtb3ZlIGFscmVhZHkgZXhpc3RzICh0YWtlIG1heGltdW0pDQogICAgICAgICAgICAgICAgZXhpc3RpbmdNb3ZlLndlaWdodCA9IE1hdGgubWF4KGV4aXN0aW5nTW92ZS53ZWlnaHQsIHdlaWdodCk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIE1ha2UgdGhlIG1vdmUgb24gdGhlIGJvYXJkDQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW21vdmUudG8ucl1bbW92ZS50by5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFwaWVjZSkgYnJlYWs7IC8vIEludmFsaWQgbGluZQ0KDQogICAgICAgICAgICBjb25zdCBwaWVjZUtleSA9IGAke3BpZWNlLmNvbG9yfS0ke3BpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkS2V5ID0gY2FwdHVyZWQgPyBgJHtjYXB0dXJlZC5jb2xvcn0tJHtjYXB0dXJlZC50eXBlfWAgOiB1bmRlZmluZWQ7DQoNCiAgICAgICAgICAgIC8vIFVwZGF0ZSBoYXNoIGluY3JlbWVudGFsbHkNCiAgICAgICAgICAgIGN1cnJlbnRIYXNoID0gdGhpcy5oYXNoZXIudXBkYXRlSGFzaChjdXJyZW50SGFzaCwgbW92ZSwgcGllY2VLZXksIGNhcHR1cmVkS2V5KTsNCg0KICAgICAgICAgICAgLy8gQXBwbHkgbW92ZQ0KICAgICAgICAgICAgYm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdID0gcGllY2U7DQogICAgICAgICAgICBib2FyZFttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdID0gbnVsbDsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEdldCBiZXN0IG1vdmUgZnJvbSBvcGVuaW5nIGJvb2sgZm9yIGN1cnJlbnQgcG9zaXRpb24NCiAgICAgKiBAcGFyYW0gYm9hcmQgQ3VycmVudCBib2FyZCBzdGF0ZQ0KICAgICAqIEBwYXJhbSBwbHkgQ3VycmVudCBwbHkgbnVtYmVyICgwID0gc3RhcnQgb2YgZ2FtZSkNCiAgICAgKiBAcmV0dXJucyBNb3ZlIGZyb20gYm9vaywgb3IgbnVsbCBpZiBwb3NpdGlvbiBub3QgaW4gYm9vaw0KICAgICAqLw0KICAgIGdldEJvb2tNb3ZlKGJvYXJkLCBwbHkpew0KICAgICAgICAvLyBEb24ndCB1c2UgYm9vayBpZiBkaXNhYmxlZCBvciBwYXN0IG1heCBwbHkNCiAgICAgICAgaWYgKCF0aGlzLmVuYWJsZWQgfHwgcGx5ID49IHRoaXMubWF4UGx5KSB7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnT3BlbmluZyBib29rIGRpc2FibGVkIG9yIHBhc3QgbWF4IHBseScsIHsgZW5hYmxlZDogdGhpcy5lbmFibGVkLCBtYXhQbHk6IHRoaXMubWF4UGx5LCBwbHk6IHBseSB9KTsNCiAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvL2NvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgZ2V0Qm9va01vdmUgY2FsbGVkJywgeyBwbHkgfSk7DQogICAgICAgIA0KICAgICAgICAvLyBUcnkgdG8gZmluZCBtb3ZlIGZvciBjdXJyZW50IHBvc2l0aW9uDQogICAgICAgIGNvbnN0IGhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKGJvYXJkKTsNCiAgICAgICAgLy9jb25zb2xlLmxvZygnQ3VycmVudCBwb3NpdGlvbiBoYXNoOicsIGhhc2gpOw0KICAgICAgICANCiAgICAgICAgbGV0IGVudHJ5ID0gdGhpcy5ib29rLmdldChoYXNoKTsNCiAgICAgICAgLy9jb25zb2xlLmxvZygnRW50cnkgZm91bmQgZm9yIGN1cnJlbnQgaGFzaDonLCBlbnRyeSA/IGVudHJ5Lm1vdmVzLmxlbmd0aCArICcgbW92ZXMnIDogJ251bGwnKTsNCiAgICAgICAgaWYgKGVudHJ5ICYmIGVudHJ5Lm1vdmVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdBbGwgcG9zc2libGUgYm9vayBtb3ZlcyB3aXRoIHdlaWdodHM6JywgSlNPTi5zdHJpbmdpZnkoZW50cnkubW92ZXMpKTsNCiAgICAgICAgICAgIC8vIENhbGN1bGF0ZSB0b3RhbCB3ZWlnaHQNCiAgICAgICAgICAgIGNvbnN0IHRvdGFsV2VpZ2h0ID0gZW50cnkubW92ZXMucmVkdWNlKChzdW0sIG1vdmUpID0+IHN1bSArIG1vdmUud2VpZ2h0LCAwKTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdUb3RhbCB3ZWlnaHQ6JywgdG90YWxXZWlnaHQpOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICBsZXQgbWlycm9yZWRNb3ZlID0gZmFsc2U7DQoNCiAgICAgICAgLy8gSWYgbm90IGZvdW5kLCB0cnkgbWlycm9yZWQgcG9zaXRpb24NCiAgICAgICAgaWYgKCFlbnRyeSB8fCBlbnRyeS5tb3Zlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIGNvbnN0IG1pcnJvcmVkQm9hcmQgPSB0aGlzLmhhc2hlci5taXJyb3JCb2FyZChib2FyZCk7DQogICAgICAgICAgICBjb25zdCBtaXJyb3JlZEhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKG1pcnJvcmVkQm9hcmQpOw0KICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIGVudHJ5IGZvdW5kLCB0cnlpbmcgbWlycm9yZWQgcG9zaXRpb246JywgbWlycm9yZWRIYXNoKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgZW50cnkgPSB0aGlzLmJvb2suZ2V0KG1pcnJvcmVkSGFzaCk7DQogICAgICAgICAgICBpZiAoZW50cnkgJiYgZW50cnkubW92ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ0VudHJ5IGZvdW5kIGZvciBtaXJyb3JlZCBoYXNoOicsIGVudHJ5Lm1vdmVzLmxlbmd0aCArICcgbW92ZXMnKTsNCiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdPcmlnaW5hbCBtaXJyb3IgbW92ZXM6JywgSlNPTi5zdHJpbmdpZnkoZW50cnkubW92ZXMpKTsNCiAgICAgICAgICAgICAgICBtaXJyb3JlZE1vdmUgPSB0cnVlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdObyBlbnRyeSBmb3VuZCBmb3IgbWlycm9yZWQgaGFzaCcpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgaWYgKCFlbnRyeSB8fCBlbnRyeS5tb3Zlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBtb3ZlIG5vdCBmb3VuZCBmb3IgY3VycmVudCBwb3NpdGlvbicpOw0KICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgIH0NCg0KICAgICAgICAvLyBTZWxlY3QgbW92ZSBiYXNlZCBvbiB3ZWlnaHRzDQogICAgICAgIGNvbnN0IHNlbGVjdGVkTW92ZSA9IHRoaXMuc2VsZWN0V2VpZ2h0ZWRNb3ZlKGVudHJ5Lm1vdmVzKTsNCiAgICAgICAgY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBtb3ZlIHNlbGVjdGVkOicsIHNlbGVjdGVkTW92ZSk7DQogICAgICAgIA0KICAgICAgICAvLyBJZiB3ZSB1c2VkIG1pcnJvcmVkIHBvc2l0aW9uLCBtaXJyb3IgdGhlIG1vdmUgYmFjaw0KICAgICAgICBpZiAoc2VsZWN0ZWRNb3ZlICYmIG1pcnJvcmVkTW92ZSkgew0KICAgICAgICAgICAgLy8gY29uc29sZS5sb2coJ1NlbGVjdGVkIG1pcnJvciBtb3ZlIGJlZm9yZSBjb252ZXJzaW9uOicsIEpTT04uc3RyaW5naWZ5KHNlbGVjdGVkTW92ZSkpOw0KICAgICAgICAgICAgY29uc3QgbWlycm9yZWRNb3ZlQ29udmVydGVkID0gdGhpcy5oYXNoZXIubWlycm9yTW92ZShzZWxlY3RlZE1vdmUpOw0KICAgICAgICAgICAgLy8gY29uc29sZS5sb2coJ0NvbnZlcnRlZCBtaXJyb3IgbW92ZTonLCBKU09OLnN0cmluZ2lmeShtaXJyb3JlZE1vdmVDb252ZXJ0ZWQpKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIG1pcnJvcmVkIG1vdmUgaGFzIHZhbGlkIHN0cnVjdHVyZQ0KICAgICAgICAgICAgaWYgKG1pcnJvcmVkTW92ZUNvbnZlcnRlZCAmJiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbSAmJiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQudG8gJiYNCiAgICAgICAgICAgICAgICB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tLmMgPT09ICdudW1iZXInICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIG1pcnJvcmVkTW92ZUNvbnZlcnRlZDsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ01pcnJvcmVkIG1vdmUgaGFzIGludmFsaWQgc3RydWN0dXJlLCByZXR1cm5pbmcgbnVsbCcpOw0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKHNlbGVjdGVkTW92ZSkgew0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHNlbGVjdGVkIG1vdmUgaGFzIHZhbGlkIHN0cnVjdHVyZQ0KICAgICAgICAgICAgaWYgKHNlbGVjdGVkTW92ZS5mcm9tICYmIHNlbGVjdGVkTW92ZS50byAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBzZWxlY3RlZE1vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLmZyb20uYyA9PT0gJ251bWJlcicgJiYNCiAgICAgICAgICAgICAgICB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLnRvLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBzZWxlY3RlZE1vdmUudG8uYyA9PT0gJ251bWJlcicpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gc2VsZWN0ZWRNb3ZlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU2VsZWN0ZWQgbW92ZSBoYXMgaW52YWxpZCBzdHJ1Y3R1cmUsIHJldHVybmluZyBudWxsJyk7DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIHJldHVybiBudWxsOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIFNlbGVjdCBhIG1vdmUgcmFuZG9tbHkgYmFzZWQgb24gd2VpZ2h0cw0KICAgICAqIEhpZ2hlciB3ZWlnaHQgPSBtb3JlIGxpa2VseSB0byBiZSBzZWxlY3RlZA0KICAgICAqLw0KICAgIHNlbGVjdFdlaWdodGVkTW92ZShtb3Zlcykgew0KICAgICAgICAvLyBDYWxjdWxhdGUgdG90YWwgd2VpZ2h0DQogICAgICAgIGNvbnN0IHRvdGFsV2VpZ2h0ID0gbW92ZXMucmVkdWNlKChzdW0sIG1vdmUpID0+IHN1bSArIG1vdmUud2VpZ2h0LCAwKTsNCg0KICAgICAgICAvLyBHZW5lcmF0ZSByYW5kb20gbnVtYmVyDQogICAgICAgIGxldCByYW5kb20gPSBNYXRoLnJhbmRvbSgpICogdG90YWxXZWlnaHQ7DQoNCiAgICAgICAgLy8gU2VsZWN0IG1vdmUNCiAgICAgICAgZm9yIChjb25zdCBtb3ZlIG9mIG1vdmVzKSB7DQogICAgICAgICAgICByYW5kb20gLT0gbW92ZS53ZWlnaHQ7DQogICAgICAgICAgICBpZiAocmFuZG9tIDw9IDApIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiBtb3ZlLmZyb20uYyB9LCB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IG1vdmUudG8uYyB9DQogICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIC8vIEZhbGxiYWNrIChzaG91bGQgbmV2ZXIgcmVhY2ggaGVyZSkNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIGZyb206IHsgcjogbW92ZXNbMF0uZnJvbS5yLCBjOiBtb3Zlc1swXS5mcm9tLmMgfSwgdG86IHsgcjogbW92ZXNbMF0udG8uciwgYzogbW92ZXNbMF0udG8uYyB9DQogICAgICAgIH07DQogICAgfQ0KDQogICAgLyoqDQogICAgICogSGVscGVyIHRvIGNyZWF0ZSBpbml0aWFsIGJvYXJkIChuZWVkZWQgZm9yIGJvb2sgaW5pdGlhbGl6YXRpb24pDQogICAgICovDQogICAgY3JlYXRlSW5pdGlhbEJvYXJkKCkgew0KICAgICAgICBjb25zdCBib2FyZCA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpKTsNCiAgICAgICAgDQogICAgICAgIC8vIFJlZCBwaWVjZXMgKGJvdHRvbSAtIHI9MC0yKQ0KICAgICAgICBib2FyZFswXVswXSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bMV0gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVsyXSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzNdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs0XSA9IHsgdHlwZTogJ2dlbmVyYWwnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bNV0gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzZdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bN10gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs4XSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMl1bMV0gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMl1bN10gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bMF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzJdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVs0XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bNl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzhdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KDQogICAgICAgIC8vIEJsYWNrIHBpZWNlcyAodG9wIC0gcj03LTkpDQogICAgICAgIGJvYXJkWzldWzBdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzFdID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVsyXSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bM10gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bNF0gPSB7IHR5cGU6ICdnZW5lcmFsJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bNV0gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bNl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzddID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs4XSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs3XVsxXSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzddWzddID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bMF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bMl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bNF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bNl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bOF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCg0KICAgICAgICByZXR1cm4gYm9hcmQ7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogRW5hYmxlIG9yIGRpc2FibGUgb3BlbmluZyBib29rDQogICAgICovDQogICAgc2V0RW5hYmxlZChlbmFibGVkKSB7DQogICAgICAgIHRoaXMuZW5hYmxlZCA9IGVuYWJsZWQ7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQ2hlY2sgaWYgb3BlbmluZyBib29rIGlzIGVuYWJsZWQNCiAgICAgKi8NCiAgICBpc0VuYWJsZWQoKSB7DQogICAgICAgIHJldHVybiB0aGlzLmVuYWJsZWQ7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogR2V0IHN0YXRpc3RpY3MgYWJvdXQgdGhlIG9wZW5pbmcgYm9vaw0KICAgICAqLw0KICAgIGdldFN0YXRzKCkgew0KICAgICAgICBsZXQgdG90YWxNb3ZlcyA9IDA7DQogICAgICAgIHRoaXMuYm9vay5mb3JFYWNoKGVudHJ5ID0+IHsNCiAgICAgICAgICAgIHRvdGFsTW92ZXMgKz0gZW50cnkubW92ZXMubGVuZ3RoOw0KICAgICAgICB9KTsNCg0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgcG9zaXRpb25zOiB0aGlzLmJvb2suc2l6ZSwNCiAgICAgICAgICAgIHRvdGFsTW92ZXMNCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBBZGQgb3BlbmluZyBsaW5lIGZyb20gdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbg0KICAgICAqIEBwYXJhbSBub3RhdGlvbiBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24gKGUuZy4sIFsn54Ku5LqM5bmz5LqUJywgJ+mprDjov5s3J10pDQogICAgICogQHBhcmFtIHdlaWdodHMgT3B0aW9uYWwgYXJyYXkgb2Ygd2VpZ2h0cyBmb3IgZWFjaCBtb3ZlDQogICAgICovDQogICAgYWRkT3BlbmluZ0xpbmVGcm9tTm90YXRpb24obm90YXRpb24sIHdlaWdodHMpIHsNCiAgICAgICAgLy8gQ29udmVydCB0cmFkaXRpb25hbCBub3RhdGlvbiB0byBjb29yZGluYXRlIGZvcm1hdA0KICAgICAgICBjb25zdCBtb3ZlcyA9IHRoaXMubm90YXRpb25Ub01vdmVzKG5vdGF0aW9uKTsNCiAgICAgICAgLy8gQWRkIHRoZSBtb3ZlcyB0byB0aGUgb3BlbmluZyBib29rDQogICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmUobW92ZXMsIHdlaWdodHMpOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEFkZCBvcGVuaW5nIGxpbmUgZnJvbSBzdHJpbmcgd2l0aCBzcGFjZS1zZXBhcmF0ZWQgdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbg0KICAgICAqIEBwYXJhbSBub3RhdGlvbkFycmF5IEFycmF5IG9mIHN0cmluZ3MsIGVhY2ggY29udGFpbmluZyBzcGFjZS1zZXBhcmF0ZWQgbW92ZXMgKGUuZy4sIFsn54Ku5LqM5bmz5LqUIOmprDjov5s3IOi9puS4gOW5s+S6jCddKQ0KICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIGFycmF5IG9mIHdlaWdodHMgZm9yIGVhY2ggbW92ZQ0KICAgICAqLw0KICAgIGFkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyhub3RhdGlvbkFycmF5LCB3ZWlnaHRzKSB7DQogICAgICAgIC8vIFByb2Nlc3MgZWFjaCBzdHJpbmcgaW4gdGhlIGFycmF5DQogICAgICAgIGlmICghbm90YXRpb25BcnJheSB8fCAhQXJyYXkuaXNBcnJheShub3RhdGlvbkFycmF5KSB8fCBub3RhdGlvbkFycmF5Lmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICB9DQogICAgICAgIG5vdGF0aW9uQXJyYXkuZm9yRWFjaChub3RhdGlvblN0cmluZyA9PiB7DQogICAgICAgICAgICAvLyBTcGxpdCB0aGUgc3RyaW5nIGJ5IHNwYWNlcyB0byBnZXQgaW5kaXZpZHVhbCBtb3Zlcw0KICAgICAgICAgICAgY29uc3Qgbm90YXRpb24gPSBub3RhdGlvblN0cmluZy5zcGxpdCgnICcpLmZpbHRlcihtb3ZlID0+IG1vdmUudHJpbSgpICE9PSAnJyk7DQogICAgICAgICAgICAvLyBDYWxsIGV4aXN0aW5nIGZ1bmN0aW9uIHRvIGFkZCB0aGUgbGluZQ0KICAgICAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihub3RhdGlvbiwgd2VpZ2h0cyk7DQogICAgICAgIH0pOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENvbnZlcnQgY29vcmRpbmF0ZS1iYXNlZCBtb3ZlcyB0byB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uDQogICAgICogQHBhcmFtIGJvYXJkSGlzdG9yeSBBcnJheSBvZiBib2FyZCBzdGF0ZXMgcmVwcmVzZW50aW5nIHRoZSBnYW1lIGhpc3RvcnkNCiAgICAgKiBAcGFyYW0gbW92ZUhpc3RvcnkgQXJyYXkgb2YgbW92ZXMgaW4gY29vcmRpbmF0ZSBmb3JtYXQNCiAgICAgKiBAcmV0dXJucyBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24NCiAgICAgKi8NCiAgICBtb3Zlc1RvTm90YXRpb24oYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSkgew0KICAgICAgICBjb25zdCBub3RhdGlvbiA9IFtdOw0KICAgICAgICBsZXQgY3VycmVudENvbG9yID0gJ3JlZCc7IC8vIFJlZCBtb3ZlcyBmaXJzdA0KDQogICAgICAgIC8vIFR5cGUgdG8gcGllY2UgY2hhcmFjdGVyIG1hcHBpbmcNCiAgICAgICAgY29uc3QgdHlwZVRvUGllY2UgPSB7DQogICAgICAgICAgICAnZ2VuZXJhbCc6IHsgJ3JlZCc6ICfluIUnLCAnYmxhY2snOiAn5bCGJyB9LA0KICAgICAgICAgICAgJ2Fkdmlzb3InOiB7ICdyZWQnOiAn5LuVJywgJ2JsYWNrJzogJ+WjqycgfSwNCiAgICAgICAgICAgICdlbGVwaGFudCc6IHsgJ3JlZCc6ICfnm7gnLCAnYmxhY2snOiAn6LGhJyB9LA0KICAgICAgICAgICAgJ2hvcnNlJzogeyAncmVkJzogJ+mprCcsICdibGFjayc6ICfpqawnIH0sDQogICAgICAgICAgICAnY2hhcmlvdCc6IHsgJ3JlZCc6ICfovaYnLCAnYmxhY2snOiAn6L2mJyB9LA0KICAgICAgICAgICAgJ2Nhbm5vbic6IHsgJ3JlZCc6ICfngq4nLCAnYmxhY2snOiAn54KuJyB9LA0KICAgICAgICAgICAgJ3NvbGRpZXInOiB7ICdyZWQnOiAn5YW1JywgJ2JsYWNrJzogJ+WNkicgfQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENvbHVtbiBtYXBwaW5nIChjb29yZGluYXRlIDAtOCB0byB0cmFkaXRpb25hbCDkuZ0t5LiAIGZvciByZWQsIDktMSBmb3IgYmxhY2spDQogICAgICAgIGNvbnN0IGNvbFRvQ2hpbmVzZSA9IFsn5LmdJywgJ+WFqycsICfkuIMnLCAn5YWtJywgJ+S6lCcsICflm5snLCAn5LiJJywgJ+S6jCcsICfkuIAnXTsNCiAgICAgICAgY29uc3QgY29sVG9BcmFiaWMgPSBbJzknLCAnOCcsICc3JywgJzYnLCAnNScsICc0JywgJzMnLCAnMicsICcxJ107DQoNCiAgICAgICAgLy8gRGlnaXQgdG8gQ2hpbmVzZSBudW1iZXIgbWFwcGluZyBmb3Igc3RlcHMNCiAgICAgICAgY29uc3QgZGlnaXRUb0NoaW5lc2UgPSBbJycsICfkuIAnLCAn5LqMJywgJ+S4iScsICflm5snLCAn5LqUJywgJ+WFrScsICfkuIMnLCAn5YWrJywgJ+S5nSddOw0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiB0aGVyZSBhcmUgbXVsdGlwbGUgc2FtZS10eXBlIHBpZWNlcyBpbiB0aGUgc2FtZSBjb2x1bW4NCiAgICAgICAgY29uc3QgaGFzU2FtZVR5cGVJbkNvbHVtbiA9IChib2FyZCwgcGllY2VUeXBlLCBjb2xvciwgY29sLCBleGNsdWRlUm93KSA9PiB7DQogICAgICAgICAgICBsZXQgY291bnQgPSAwOw0KICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjb2xdOw0KICAgICAgICAgICAgICAgIGlmIChyID09PSBleGNsdWRlUm93KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gcGllY2VUeXBlICYmIHBpZWNlLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgICAgICAgICBjb3VudCsrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHJldHVybiBjb3VudCA+IDA7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGRldGVybWluZSBmcm9udC9iYWNrIG1hcmtlcg0KICAgICAgICBjb25zdCBnZXRGcm9udEJhY2tNYXJrZXIgPSAoYm9hcmQsIHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgY3VycmVudFJvdykgPT4gew0KICAgICAgICAgICAgY29uc3Qgc2FtZVR5cGVQaWVjZXMgPSBbXTsNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY29sXTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gcGllY2VUeXBlICYmIHBpZWNlLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgICAgICAgICBzYW1lVHlwZVBpZWNlcy5wdXNoKHIpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmIChzYW1lVHlwZVBpZWNlcy5sZW5ndGggPD0gMSkgcmV0dXJuICcnOw0KICAgICAgICAgICAgaWYgKGNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8iHI9Ny0577yJ77yMcuWAvOi2iuWkp+i2iumdoOi/keaVjOaWue+8jOaYryLliY0iDQogICAgICAgICAgICAgICAgY29uc3Qgc29ydGVkUm93cyA9IFsuLi5zYW1lVHlwZVBpZWNlc10uc29ydCgoYSwgYikgPT4gYiAtIGEpOyAvLyBIaWdoZXIgcm93cyBmaXJzdCA9IGNsb3NlciB0byBvcHBvbmVudA0KICAgICAgICAgICAgICAgIHJldHVybiBzb3J0ZWRSb3dzWzBdID09PSBjdXJyZW50Um93ID8gJ+WJjScgOiAn5ZCOJzsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yIcj0wLTLvvInvvIxy5YC86LaK5bCP6LaK6Z2g6L+R5pWM5pa577yM5pivIuWJjSINCiAgICAgICAgICAgICAgICBjb25zdCBzb3J0ZWRSb3dzID0gWy4uLnNhbWVUeXBlUGllY2VzXS5zb3J0KChhLCBiKSA9PiBhIC0gYik7IC8vIExvd2VyIHJvd3MgZmlyc3QgPSBjbG9zZXIgdG8gb3Bwb25lbnQNCiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkUm93c1swXSA9PT0gY3VycmVudFJvdyA/ICfliY0nIDogJ+WQjic7DQogICAgICAgICAgICB9DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gUHJvY2VzcyBlYWNoIG1vdmUNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtb3ZlSGlzdG9yeS5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVIaXN0b3J5W2ldOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRCZWZvcmUgPSBib2FyZEhpc3RvcnlbaV07DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkQmVmb3JlW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghcGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBwaWVjZSBmb3VuZCBhdCBmcm9tIHBvc2l0aW9uOicsIG1vdmUuZnJvbSk7DQogICAgICAgICAgICAgICAgY29udGludWU7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlLnR5cGU7DQogICAgICAgICAgICBjb25zdCBwaWVjZUNoYXIgPSB0eXBlVG9QaWVjZVtwaWVjZVR5cGVdW3BpZWNlLmNvbG9yXTsNCiAgICAgICAgICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGVyZSBhcmUgbXVsdGlwbGUgc2FtZS10eXBlIHBpZWNlcyBpbiB0aGUgc2FtZSBjb2x1bW4NCiAgICAgICAgICAgIGNvbnN0IGhhc0R1cGxpY2F0ZSA9IGhhc1NhbWVUeXBlSW5Db2x1bW4oYm9hcmRCZWZvcmUsIHBpZWNlVHlwZSwgcGllY2UuY29sb3IsIG1vdmUuZnJvbS5jLCBtb3ZlLmZyb20ucik7DQogICAgICAgICAgICAvLyBHZXQgZnJvbnQvYmFjayBtYXJrZXIgaWYgbmVlZGVkDQogICAgICAgICAgICBjb25zdCBwb3NpdGlvbk1hcmtlciA9IGhhc0R1cGxpY2F0ZSA/IGdldEZyb250QmFja01hcmtlcihib2FyZEJlZm9yZSwgcGllY2VUeXBlLCBwaWVjZS5jb2xvciwgbW92ZS5mcm9tLmMsIG1vdmUuZnJvbS5yKSA6ICcnOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBEZXRlcm1pbmUgbm90YXRpb24gYmFzZWQgb24gcGllY2UgdHlwZSBhbmQgbW92ZSBkaXJlY3Rpb24NCiAgICAgICAgICAgIGxldCBub3RhdGlvblN0cjsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2hvcnNlJyB8fCBwaWVjZVR5cGUgPT09ICdhZHZpc29yJyB8fCBwaWVjZVR5cGUgPT09ICdlbGVwaGFudCcpIHsNCiAgICAgICAgICAgICAgICAvLyBEaWFnb25hbCBtb3ZpbmcgcGllY2VzIC0gb25seSB1c2Ug6L+bL+mAgCwgcmVjb3JkIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9DaGluZXNlW21vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/ov5vvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IG1vdmUudG8uciA+IG1vdmUuZnJvbS5yID8gJ+i/mycgOiAn6YCAJzsNCiAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yIcj0w77yJ77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+i/m++8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gbW92ZS50by5yIDwgbW92ZS5mcm9tLnIgPyAn6L+bJyA6ICfpgIAnOw0KICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdnZW5lcmFsJyB8fCBwaWVjZVR5cGUgPT09ICdjaGFyaW90JyB8fCBwaWVjZVR5cGUgPT09ICdjYW5ub24nIHx8IHBpZWNlVHlwZSA9PT0gJ3NvbGRpZXInKSB7DQogICAgICAgICAgICAgICAgLy8gU3RyYWlnaHQgbW92aW5nIHBpZWNlcyAtIOi/my/pgIAv5bmzDQogICAgICAgICAgICAgICAgaWYgKG1vdmUuZnJvbS5jID09PSBtb3ZlLnRvLmMpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gVmVydGljYWwgbW92ZSAtIOi/my/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RlcHMgPSBNYXRoLmFicyhtb3ZlLnRvLnIgLSBtb3ZlLmZyb20ucik7DQogICAgICAgICAgICAgICAgICAgIC8vIOi/m+aYr+mdoOi/keaVjOaWueeahOaWueWQke+8jOmAgOaYr+i/nOemu+aVjOaWueeahOaWueWQkQ0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6L+b77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6L+b77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSAoaXNSZWQgPyBtb3ZlLnRvLnIgPiBtb3ZlLmZyb20uciA6IG1vdmUudG8uciA8IG1vdmUuZnJvbS5yKSA/ICfov5snIDogJ+mAgCc7DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHN0ZXBzIGlzIGEgdmFsaWQgbnVtYmVyIGJldHdlZW4gMS05DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWxpZFN0ZXBzID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oOSwgTWF0aC5yb3VuZChzdGVwcyB8fCAxKSkpOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHtkaWdpdFRvQ2hpbmVzZVt2YWxpZFN0ZXBzXSB8fCAnJ31gOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCEDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBzdGVwcyBpcyBhIHZhbGlkIG51bWJlcg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsaWRTdGVwcyA9IE1hdGgucm91bmQoc3RlcHMgfHwgMSk7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3ZhbGlkU3RlcHN9YDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgbW92ZSAtIOW5sw0KICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfeW5syR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhA0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x95bmzJHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdVbmtub3duIHBpZWNlIHR5cGU6JywgcGllY2VUeXBlKTsNCiAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgbm90YXRpb24ucHVzaChub3RhdGlvblN0cik7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFN3aXRjaCBjb2xvciBmb3IgbmV4dCBtb3ZlDQogICAgICAgICAgICBjdXJyZW50Q29sb3IgPSBjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICByZXR1cm4gbm90YXRpb247DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQ29udmVydCB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uIHRvIGNvb3JkaW5hdGUgbW92ZXMNCiAgICAgKiBAcGFyYW0gbm90YXRpb24gQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uDQogICAgICogQHJldHVybnMgQXJyYXkgb2YgbW92ZXMgaW4gY29vcmRpbmF0ZSBmb3JtYXQNCiAgICAgKi8NCiAgICBub3RhdGlvblRvTW92ZXMobm90YXRpb24sIGluaXRpYWxCb2FyZCA9IG51bGwpIHsNCiAgICAgICAgLy8g56Gu5L+dbm90YXRpb27mmK/mlbDnu4TkuJTkuI3kuLrnqboNCiAgICAgICAgaWYgKCFub3RhdGlvbiB8fCAhQXJyYXkuaXNBcnJheShub3RhdGlvbikgfHwgbm90YXRpb24ubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICByZXR1cm4gW107DQogICAgICAgIH0NCiAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgbGV0IGN1cnJlbnRDb2xvciA9ICdyZWQnOyAvLyBSZWQgbW92ZXMgZmlyc3QNCg0KICAgICAgICAvLyBQaWVjZSBjaGFyYWN0ZXIgdG8gdHlwZSBtYXBwaW5nDQogICAgICAgIGNvbnN0IHBpZWNlTWFwID0gew0KICAgICAgICAgICAgJ+Wwhic6ICdnZW5lcmFsJywgJ+W4hSc6ICdnZW5lcmFsJywNCiAgICAgICAgICAgICflo6snOiAnYWR2aXNvcicsICfku5UnOiAnYWR2aXNvcicsDQogICAgICAgICAgICAn6LGhJzogJ2VsZXBoYW50JywgJ+ebuCc6ICdlbGVwaGFudCcsDQogICAgICAgICAgICAn6amsJzogJ2hvcnNlJywNCiAgICAgICAgICAgICfovaYnOiAnY2hhcmlvdCcsDQogICAgICAgICAgICAn54KuJzogJ2Nhbm5vbicsDQogICAgICAgICAgICAn5Y2SJzogJ3NvbGRpZXInLCAn5YW1JzogJ3NvbGRpZXInDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ29sdW1uIG1hcHBpbmcgKHRyYWRpdGlvbmFsIG5vdGF0aW9uIHVzZXMgMS05IGZyb20gcmlnaHQgdG8gbGVmdCkNCiAgICAgICAgY29uc3QgY29sTWFwID0gew0KICAgICAgICAgICAgJ+S4gCc6IDgsICcxJzogOCwNCiAgICAgICAgICAgICfkuownOiA3LCAnMic6IDcsDQogICAgICAgICAgICAn5LiJJzogNiwgJzMnOiA2LA0KICAgICAgICAgICAgJ+Wbmyc6IDUsICc0JzogNSwNCiAgICAgICAgICAgICfkupQnOiA0LCAnNSc6IDQsDQogICAgICAgICAgICAn5YWtJzogMywgJzYnOiAzLA0KICAgICAgICAgICAgJ+S4gyc6IDIsICc3JzogMiwNCiAgICAgICAgICAgICflhasnOiAxLCAnOCc6IDEsDQogICAgICAgICAgICAn5LmdJzogMCwgJzknOiAwDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ2hpbmVzZSBudW1iZXIgdG8gZGlnaXQgbWFwcGluZw0KICAgICAgICBjb25zdCBjaGluZXNlTnVtYmVyTWFwID0gew0KICAgICAgICAgICAgJ+S4gCc6IDEsICcxJzogMSwNCiAgICAgICAgICAgICfkuownOiAyLCAnMic6IDIsDQogICAgICAgICAgICAn5LiJJzogMywgJzMnOiAzLA0KICAgICAgICAgICAgJ+Wbmyc6IDQsICc0JzogNCwNCiAgICAgICAgICAgICfkupQnOiA1LCAnNSc6IDUsDQogICAgICAgICAgICAn5YWtJzogNiwgJzYnOiA2LA0KICAgICAgICAgICAgJ+S4gyc6IDcsICc3JzogNywNCiAgICAgICAgICAgICflhasnOiA4LCAnOCc6IDgsDQogICAgICAgICAgICAn5LmdJzogOSwgJzknOiA5DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSW5pdGlhbCBwb3NpdGlvbnMgb2YgcGllY2VzIChyZWQgYW5kIGJsYWNrKQ0KICAgICAgICAvLyDkv67lpI3vvJrkuI7mlrDlnZDmoIfns7vnu5/kv53mjIHkuIDoh7TvvIznuqLmlrnlnKjlupXpg6jvvIhyPTAtMu+8ie+8jOm7keaWueWcqOmhtumDqO+8iHI9Ny0577yJDQogICAgICAgIGNvbnN0IGRlZmF1bHRJbml0aWFsUG9zaXRpb25zID0gew0KICAgICAgICAgICAgJ3JlZC1nZW5lcmFsJzogeyByOiAwLCBjOiA0IH0sDQogICAgICAgICAgICAncmVkLWFkdmlzb3InOiBbeyByOiAwLCBjOiAzIH0sIHsgcjogMCwgYzogNSB9XSwNCiAgICAgICAgICAgICdyZWQtZWxlcGhhbnQnOiBbeyByOiAwLCBjOiAyIH0sIHsgcjogMCwgYzogNiB9XSwNCiAgICAgICAgICAgICdyZWQtaG9yc2UnOiBbeyByOiAwLCBjOiAxIH0sIHsgcjogMCwgYzogNyB9XSwNCiAgICAgICAgICAgICdyZWQtY2hhcmlvdCc6IFt7IHI6IDAsIGM6IDAgfSwgeyByOiAwLCBjOiA4IH1dLA0KICAgICAgICAgICAgJ3JlZC1jYW5ub24nOiBbeyByOiAyLCBjOiAxIH0sIHsgcjogMiwgYzogNyB9XSwNCiAgICAgICAgICAgICdyZWQtc29sZGllcic6IFt7IHI6IDMsIGM6IDAgfSwgeyByOiAzLCBjOiAyIH0sIHsgcjogMywgYzogNCB9LCB7IHI6IDMsIGM6IDYgfSwgeyByOiAzLCBjOiA4IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWdlbmVyYWwnOiB7IHI6IDksIGM6IDQgfSwNCiAgICAgICAgICAgICdibGFjay1hZHZpc29yJzogW3sgcjogOSwgYzogMyB9LCB7IHI6IDksIGM6IDUgfV0sDQogICAgICAgICAgICAnYmxhY2stZWxlcGhhbnQnOiBbeyByOiA5LCBjOiAyIH0sIHsgcjogOSwgYzogNiB9XSwNCiAgICAgICAgICAgICdibGFjay1ob3JzZSc6IFt7IHI6IDksIGM6IDEgfSwgeyByOiA5LCBjOiA3IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWNoYXJpb3QnOiBbeyByOiA5LCBjOiAwIH0sIHsgcjogOSwgYzogOCB9XSwNCiAgICAgICAgICAgICdibGFjay1jYW5ub24nOiBbeyByOiA3LCBjOiAxIH0sIHsgcjogNywgYzogNyB9XSwNCiAgICAgICAgICAgICdibGFjay1zb2xkaWVyJzogW3sgcjogNiwgYzogMCB9LCB7IHI6IDYsIGM6IDIgfSwgeyByOiA2LCBjOiA0IH0sIHsgcjogNiwgYzogNiB9LCB7IHI6IDYsIGM6IDggfV0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBUcmFjayBwaWVjZSBwb3NpdGlvbnMgYXMgbW92ZXMgYXJlIG1hZGUNCiAgICAgICAgbGV0IHBpZWNlUG9zaXRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShkZWZhdWx0SW5pdGlhbFBvc2l0aW9ucykpOw0KICAgICAgICANCiAgICAgICAgLy8gSWYgaW5pdGlhbCBib2FyZCBpcyBwcm92aWRlZCwgaW5pdGlhbGl6ZSBwaWVjZSBwb3NpdGlvbnMgZnJvbSBpdA0KICAgICAgICBpZiAoaW5pdGlhbEJvYXJkKSB7DQogICAgICAgICAgICAvLyBSZXNldCBwaWVjZSBwb3NpdGlvbnMgYmFzZWQgb24gaW5pdGlhbCBib2FyZA0KICAgICAgICAgICAgcGllY2VQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgJ3JlZC1nZW5lcmFsJzogeyByOiAtMSwgYzogLTEgfSwNCiAgICAgICAgICAgICAgICAncmVkLWFkdmlzb3InOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWVsZXBoYW50JzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1ob3JzZSc6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtY2hhcmlvdCc6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtY2Fubm9uJzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1zb2xkaWVyJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWdlbmVyYWwnOiB7IHI6IC0xLCBjOiAtMSB9LA0KICAgICAgICAgICAgICAgICdibGFjay1hZHZpc29yJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWVsZXBoYW50JzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWhvcnNlJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWNoYXJpb3QnOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stY2Fubm9uJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLXNvbGRpZXInOiBbXQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gUG9wdWxhdGUgcGllY2UgcG9zaXRpb25zIGZyb20gaW5pdGlhbCBib2FyZA0KICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBpbml0aWFsQm9hcmRbcl1bY107DQogICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7cGllY2UuY29sb3J9LSR7cGllY2UudHlwZX1gOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2tleV0gPSB7IHIsIGMgfTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgcGllY2VQb3NpdGlvbnNba2V5XS5wdXNoKHsgciwgYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBmaW5kIHBpZWNlIHBvc2l0aW9uDQogICAgICAgIGNvbnN0IGZpbmRQaWVjZVBvc2l0aW9uID0gKHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgZGlyZWN0aW9uLCBmcm9udEJhY2tNYXJrZXIgPSBudWxsKSA9PiB7DQogICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtjb2xvcn0tJHtwaWVjZVR5cGV9YDsNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2tleV07DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHBvc2l0aW9ucyBleGlzdCBhbmQgYXJlIHZhbGlkDQogICAgICAgICAgICBpZiAoIXBvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIHBvc2l0aW9ucyBmb3VuZCBmb3IgcGllY2U6Jywga2V5KTsNCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHBvc2l0aW9uczsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gRmluZCBwaWVjZXMgb24gdGhlIHNwZWNpZmllZCBjb2x1bW4NCiAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBwb3NpdGlvbnMuZmlsdGVyKHBvcyA9PiBwb3MuYyA9PT0gY29sKTsNCg0KICAgICAgICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gY2FuZGlkYXRlcyBmb3VuZCBmb3IgcGllY2U6Jywga2V5LCAnb24gY29sdW1uOicsIGNvbCk7DQogICAgICAgICAgICAgICAgLy8gQWRkaXRpb25hbCBkZWJ1ZyBpbmZvIGZvciBjYW5ub24NCiAgICAgICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnY2Fubm9uJyAmJiBjb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnREVCVUc6IENhbmRpZGF0ZXMgYWZ0ZXIgZmlsdGVyOicsIGNhbmRpZGF0ZXMpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID09PSAxKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZXNbMF07DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIElmIGZyb250L2JhY2sgbWFya2VyIGlzIHByb3ZpZGVkLCB1c2UgaXQgdG8gZGV0ZXJtaW5lIHRoZSBwaWVjZQ0KICAgICAgICAgICAgaWYgKGZyb250QmFja01hcmtlciA9PT0gJ+WJjScpIHsNCiAgICAgICAgICAgICAgICAvLyDliY3ngq7vvJrpnaDov5HmlYzmlrnnmoTmo4vlrZANCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJpy5YC86L6D5aSn55qE5pu06Z2g6L+R5pWM5pa577yI5YmN77yJDQogICAgICAgICAgICAgICAgLy8g6buR5pa577yacuWAvOi+g+Wwj+eahOabtOmdoOi/keaVjOaWue+8iOWJje+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9IGVsc2UgaWYgKGZyb250QmFja01hcmtlciA9PT0gJ+WQjicpIHsNCiAgICAgICAgICAgICAgICAvLyDlkI7ngq7vvJrpnaDov5Hlt7HmlrnnmoTmo4vlrZANCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJpy5YC86L6D5bCP55qE5pu06Z2g6L+R5bex5pa577yI5ZCO77yJDQogICAgICAgICAgICAgICAgLy8g6buR5pa577yacuWAvOi+g+Wkp+eahOabtOmdoOi/keW3seaWue+8iOWQju+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIElmIG11bHRpcGxlIHBpZWNlcyBvbiB0aGUgc2FtZSBjb2x1bW4gYW5kIG5vIG1hcmtlciwgZGV0ZXJtaW5lIGJhc2VkIG9uIGRpcmVjdGlvbg0KICAgICAgICAgICAgLy8g5a+55LqO5ZCM5LiA5YiX55qE5qOL5a2Q77yM6YCa6L+H5q+U6L6DcuWAvOadpeWMuuWIhg0KICAgICAgICAgICAgaWYgKGRpcmVjdGlvbiA9PT0gJ+i/mycpIHsNCiAgICAgICAgICAgICAgICAvLyDov5vmmK/lkJHmlYzmlrnmlrnlkJHnp7vliqjvvIzmiYDku6XpgInmi6nmm7TpnaDov5Hlt7HmlrnnmoTmo4vlrZDvvIjlkI7vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfSBlbHNlIGlmIChkaXJlY3Rpb24gPT09ICfpgIAnKSB7DQogICAgICAgICAgICAgICAgLy8g6YCA5piv5ZCR5bex5pa55pa55ZCR56e75Yqo77yM5omA5Lul6YCJ5oup5pu06Z2g6L+R5pWM5pa555qE5qOL5a2Q77yI5YmN77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZXNbMF07IC8vIERlZmF1bHQgdG8gZmlyc3QgaWYgZGlyZWN0aW9uIGlzICflubMnIGFuZCBubyBtYXJrZXINCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gdXBkYXRlIHBpZWNlIHBvc2l0aW9uDQogICAgICAgIGNvbnN0IHVwZGF0ZVBpZWNlUG9zaXRpb24gPSAocGllY2VUeXBlLCBjb2xvciwgb2xkUG9zLCBuZXdQb3MpID0+IHsNCiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbG9yfS0ke3BpZWNlVHlwZX1gOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNba2V5XTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcG9zaXRpb25zIGV4aXN0IGFuZCBhcmUgdmFsaWQNCiAgICAgICAgICAgIGlmICghcG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBObyBwb3NpdGlvbnMgZm91bmQgZm9yIHBpZWNlOicsIGtleSk7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnMuciA9IG5ld1Bvcy5yOw0KICAgICAgICAgICAgICAgIHBvc2l0aW9ucy5jID0gbmV3UG9zLmM7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCBpbmRleCA9IHBvc2l0aW9ucy5maW5kSW5kZXgocG9zID0+IHBvcy5yID09PSBvbGRQb3MuciAmJiBwb3MuYyA9PT0gb2xkUG9zLmMpOw0KICAgICAgICAgICAgaWYgKGluZGV4ICE9PSAtMSkgew0KICAgICAgICAgICAgICAgIHBvc2l0aW9uc1tpbmRleF0uciA9IG5ld1Bvcy5yOw0KICAgICAgICAgICAgICAgIHBvc2l0aW9uc1tpbmRleF0uYyA9IG5ld1Bvcy5jOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IENvdWxkIG5vdCBmaW5kIHBpZWNlIHBvc2l0aW9uIHRvIHVwZGF0ZTonLCBvbGRQb3MsICdpbicsIHBvc2l0aW9ucyk7DQogICAgICAgICAgICB9DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIHBvc2l0aW9uIGlzIHZhbGlkDQogICAgICAgIGNvbnN0IGlzVmFsaWRQb3MgPSAociwgYykgPT4gciA+PSAwICYmIHIgPCAxMCAmJiBjID49IDAgJiYgYyA8IDk7DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBob3JzZSBtb3Zlcw0KICAgICAgICBjb25zdCBnZXRIb3JzZU1vdmVzID0gKHBvcykgPT4gew0KICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyBkcjogLTIsIGRjOiAtMSB9LCB7IGRyOiAtMiwgZGM6IDEgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAtMSwgZGM6IC0yIH0sIHsgZHI6IC0xLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDEsIGRjOiAtMiB9LCB7IGRyOiAxLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDIsIGRjOiAtMSB9LCB7IGRyOiAyLCBkYzogMSB9DQogICAgICAgICAgICBdOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgaG9yc2UgY2FuIG1vdmUgaW4gdGhlIGRpcmVjdGlvbg0KICAgICAgICAgICAgY29uc3QgY2FuTW92ZSA9IChibG9ja2VkUiwgYmxvY2tlZEMpID0+IHsNCiAgICAgICAgICAgICAgICBpZiAoIWlzVmFsaWRQb3MociArIGJsb2NrZWRSLCBjICsgYmxvY2tlZEMpKSByZXR1cm4gZmFsc2U7DQogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICB9Ow0KDQogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0sIGluZGV4KSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgYmxvY2tlZFIgPSBkciA+IDAgPyAxIDogZHIgPCAwID8gLTEgOiAwOw0KICAgICAgICAgICAgICAgIGNvbnN0IGJsb2NrZWRDID0gZGMgPiAwID8gMSA6IGRjIDwgMCA/IC0xIDogMDsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgcGF0aCBpcyBibG9ja2VkDQogICAgICAgICAgICAgICAgaWYgKChpbmRleCA8IDIgfHwgaW5kZXggPj0gNikgJiYgYmxvY2tlZFIgIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gVmVydGljYWwgYmxvY2tlZA0KICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbk1vdmUoYmxvY2tlZFIsIDApKSByZXR1cm47DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChibG9ja2VkQyAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIGJsb2NrZWQNCiAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5Nb3ZlKDAsIGJsb2NrZWRDKSkgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSkgew0KICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCg0KICAgICAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgZWxlcGhhbnQgbW92ZXMNCiAgICAgICAgY29uc3QgZ2V0RWxlcGhhbnRNb3ZlcyA9IChwb3MsIGNvbG9yKSA9PiB7DQogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IGRyOiAtMiwgZGM6IC0yIH0sIHsgZHI6IC0yLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDIsIGRjOiAtMiB9LCB7IGRyOiAyLCBkYzogMiB9DQogICAgICAgICAgICBdOw0KDQogICAgICAgICAgICAvLyBFbGVwaGFudCdzIHRlcnJpdG9yeSAtIHJlZCBlbGVwaGFudHMgY2FuIG9ubHkgYmUgaW4gcjw9NCwgYmxhY2sgZWxlcGhhbnRzIGluIHI+PTUNCiAgICAgICAgICAgIGNvbnN0IGlzSW5UZXJyaXRvcnkgPSAocikgPT4gew0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyByIDw9IDQgOiByID49IDU7DQogICAgICAgICAgICB9Ow0KDQogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0pID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCBtaWRSID0gciArIGRyIC8gMjsNCiAgICAgICAgICAgICAgICBjb25zdCBtaWRDID0gYyArIGRjIC8gMjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7DQoNCiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBtaWQgcG9zaXRpb24gaXMgZW1wdHkgYW5kIG5ldyBwb3NpdGlvbiBpcyB2YWxpZA0KICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG1pZFIsIG1pZEMpICYmIGlzVmFsaWRQb3MobmV3UiwgbmV3QykgJiYgaXNJblRlcnJpdG9yeShuZXdSKSkgew0KICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCg0KICAgICAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgYWR2aXNvciBtb3Zlcw0KICAgICAgICBjb25zdCBnZXRBZHZpc29yTW92ZXMgPSAocG9zLCBjb2xvcikgPT4gew0KICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyBkcjogLTEsIGRjOiAtMSB9LCB7IGRyOiAtMSwgZGM6IDEgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAxLCBkYzogLTEgfSwgeyBkcjogMSwgZGM6IDEgfQ0KICAgICAgICAgICAgXTsNCg0KICAgICAgICAgICAgLy8gQWR2aXNvcidzIHRlcnJpdG9yeSAocGFsYWNlKSAtIHJlZCBhZHZpc29ycyBpbiByPTAtMixjPTMtNSwgYmxhY2sgYWR2aXNvcnMgaW4gcj03LTksYz0zLTUNCiAgICAgICAgICAgIGNvbnN0IGlzSW5QYWxhY2UgPSAociwgYykgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IHJSYW5nZSA9IGNvbG9yID09PSAncmVkJyA/IFswLCAyXSA6IFs3LCA5XTsNCiAgICAgICAgICAgICAgICByZXR1cm4gciA+PSByUmFuZ2VbMF0gJiYgciA8PSByUmFuZ2VbMV0gJiYgYyA+PSAzICYmIGMgPD0gNTsNCiAgICAgICAgICAgIH07DQoNCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSkgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSAmJiBpc0luUGFsYWNlKG5ld1IsIG5ld0MpKSB7DQogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0pOw0KDQogICAgICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGJvYXJkIHRvIHRyYWNrIG1vdmVzDQogICAgICAgIGxldCB0ZW1wQm9hcmQgPSB0aGlzLmNyZWF0ZUluaXRpYWxCb2FyZCgpOw0KICAgICAgICANCiAgICAgICAgLy8gRW5zdXJlIHRlbXBCb2FyZCBpcyBwcm9wZXJseSBpbml0aWFsaXplZA0KICAgICAgICBpZiAoIXRlbXBCb2FyZCB8fCB0ZW1wQm9hcmQubGVuZ3RoICE9PSAxMCkgew0KICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBib2FyZCBpbml0aWFsaXphdGlvbicpOw0KICAgICAgICAgICAgcmV0dXJuIFtdOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyBWZXJpZnkgYWxsIHJvd3MgaGF2ZSA5IGNvbHVtbnMNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDsgaSsrKSB7DQogICAgICAgICAgICBpZiAoIXRlbXBCb2FyZFtpXSB8fCB0ZW1wQm9hcmRbaV0ubGVuZ3RoICE9PSA5KSB7DQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2ldID0gQXJyYXkoOSkuZmlsbChudWxsKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIGNvbnNvbGUubG9nKCdUb3RhbCBtb3ZlczonLCBub3RhdGlvbi5sZW5ndGgpOw0KICAgICAgICBub3RhdGlvbi5mb3JFYWNoKG1vdmVOb3RhdGlvbiA9PiB7DQoNCg0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBQYXJzZSB0aGUgbW92ZSBub3RhdGlvbiAtIGtlZXAgbGFzdCBncm91cCBvcHRpb25hbA0KICAgICAgICAgICAgY29uc3QgcmVnZXggPSAvKFvliY3lkI5dKT8oW+WwhuW4heWjq+S7leixoeebuOmprOi9pueCruWFteWNkl0pKFvkuIDkuozkuInlm5vkupTlha3kuIPlhavkuZ0xMjM0NTY3ODldKShb6L+b6YCA5bmzXSkoW+S4gOS6jOS4ieWbm+S6lOWFreS4g+WFq+S5nTEyMzQ1Njc4OV0pPy87DQogICAgICAgICAgICBjb25zdCBtYXRjaCA9IG1vdmVOb3RhdGlvbi5tYXRjaChyZWdleCk7DQoNCiAgICAgICAgICAgIGlmICghbWF0Y2gpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIG1vdmUgbm90YXRpb246JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IFssIGZyb250QmFja01hcmtlciwgcGllY2VDaGFyLCBmcm9tQ29sTm90YXRpb24sIGRpcmVjdGlvbiwgdG9Db2xPclN0ZXBOb3RhdGlvbl0gPSBtYXRjaDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlTWFwW3BpZWNlQ2hhcl07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIEdldCBjb2x1bW4gbWFwcGluZyBiYXNlZCBvbiBjdXJyZW50IGNvbG9yIChibGFjayBzZWVzIGNvbHVtbnMgbWlycm9yZWQpDQogICAgICAgICAgICBsZXQgZnJvbUNvbCA9IGNvbE1hcFtmcm9tQ29sTm90YXRpb25dOw0KICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjayAoZnJvbSBibGFjaydzIHBlcnNwZWN0aXZlKQ0KICAgICAgICAgICAgICAgIGZyb21Db2wgPSA4IC0gZnJvbUNvbDsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gRmluZCB0aGUgY3VycmVudCBwb3NpdGlvbiBvZiB0aGUgcGllY2UNCiAgICAgICAgICAgIGNvbnN0IGZyb21Qb3MgPSBmaW5kUGllY2VQb3NpdGlvbihwaWVjZVR5cGUsIGN1cnJlbnRDb2xvciwgZnJvbUNvbCwgZGlyZWN0aW9uLCBmcm9udEJhY2tNYXJrZXIpOw0KDQogICAgICAgICAgICBpZiAoIWZyb21Qb3MpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZmluZCBwaWVjZSBwb3NpdGlvbiBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgbGV0IHRvUG9zOw0KDQogICAgICAgICAgICBpZiAoZGlyZWN0aW9uID09PSAn5bmzJykgew0KICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgbW92ZW1lbnQNCiAgICAgICAgICAgICAgICBsZXQgdG9Db2wgPSBjb2xNYXBbdG9Db2xPclN0ZXBOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgaWYgKHRvQ29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uOicsIHRvQ29sT3JTdGVwTm90YXRpb24sICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjayB3aGVuIG1vdmluZyBob3Jpem9udGFsbHkNCiAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgIHRvQ29sID0gOCAtIHRvQ29sOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICB0b1BvcyA9IHsgcjogZnJvbVBvcy5yLCBjOiB0b0NvbCB9Ow0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBvciBkaWFnb25hbCBtb3ZlbWVudA0KICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXBzID0gY2hpbmVzZU51bWJlck1hcFt0b0NvbE9yU3RlcE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChzdGVwcyA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgc3RlcCBjb3VudDonLCB0b0NvbE9yU3RlcE5vdGF0aW9uLCAnZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdob3JzZScpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gSG9yc2UgbW92ZXMgaW4gTC1zaGFwZQ0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0SG9yc2VNb3Zlcyhmcm9tUG9zKTsNCiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvbE5vdGF0aW9uID0gdG9Db2xPclN0ZXBOb3RhdGlvbjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uIGZvciBob3JzZTonLCB0YXJnZXRDb2xOb3RhdGlvbiwgJ2luIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrDQogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldENvbCA9IDggLSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIG1vdmUgdGhhdCBtYXRjaGVzIGJvdGggZGlyZWN0aW9uIGFuZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZGlyZWN0aW9uIChyb3cpDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbk1hdGNoID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yID4gZnJvbVBvcy5yIDogbW92ZS5yIDwgZnJvbVBvcy5yKSA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgY29sdW1uDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2x1bW5NYXRjaCA9IG1vdmUuYyA9PT0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOw0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2VsZXBoYW50Jykgew0KICAgICAgICAgICAgICAgICAgICAvLyBFbGVwaGFudCBtb3ZlcyBkaWFnb25hbGx5IDIgc3RlcHMNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEVsZXBoYW50TW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsNCiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvbE5vdGF0aW9uID0gdG9Db2xPclN0ZXBOb3RhdGlvbjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uIGZvciBlbGVwaGFudDonLCB0YXJnZXRDb2xOb3RhdGlvbiwgJ2luIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrDQogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldENvbCA9IDggLSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIG1vdmUgdGhhdCBtYXRjaGVzIGJvdGggZGlyZWN0aW9uIGFuZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZGlyZWN0aW9uIChyb3cpDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbk1hdGNoID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yID4gZnJvbVBvcy5yIDogbW92ZS5yIDwgZnJvbVBvcy5yKSA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgY29sdW1uDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2x1bW5NYXRjaCA9IG1vdmUuYyA9PT0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOw0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2Fkdmlzb3InKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEFkdmlzb3IgbW92ZXMgZGlhZ29uYWxseSAxIHN0ZXANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEFkdmlzb3JNb3Zlcyhmcm9tUG9zLCBjdXJyZW50Q29sb3IpOw0KICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24NCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOw0KICAgICAgICAgICAgICAgICAgICBsZXQgdGFyZ2V0Q29sID0gY29sTWFwW3RhcmdldENvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGFkdmlzb3I6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjaw0KICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gU3RyYWlnaHQgbGluZSBtb3ZlbWVudCAoY2hhcmlvdCwgY2Fubm9uLCBzb2xkaWVyKQ0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGVwID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gMSA6IC0xKSAqIHN0ZXBzIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gLTEgOiAxKSAqIHN0ZXBzOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gZnJvbVBvcy5yICsgc3RlcDsNCiAgICAgICAgICAgICAgICAgICAgaWYgKG5ld1IgPCAwIHx8IG5ld1IgPj0gMTApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgcm93IHBvc2l0aW9uIGFmdGVyIG1vdmU6JywgbmV3UiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSB7IHI6IG5ld1IsIGM6IGZyb21Qb3MuYyB9Ow0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKCF0b1Bvcykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBkZXRlcm1pbmUgdGFyZ2V0IHBvc2l0aW9uIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBBZGQgdGhlIG1vdmUgdG8gdGhlIGxpc3QNCiAgICAgICAgICAgIG1vdmVzLnB1c2goeyBmcm9tOiB7IHI6IGZyb21Qb3MuciwgYzogZnJvbVBvcy5jIH0sIHRvOiB7IHI6IHRvUG9zLnIsIGM6IHRvUG9zLmMgfSB9KTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUncyBhIGNhcHR1cmVkIHBpZWNlDQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZFBpZWNlID0gdGVtcEJvYXJkW3RvUG9zLnJdW3RvUG9zLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBJZiB0aGVyZSdzIGEgY2FwdHVyZWQgcGllY2UsIHJlbW92ZSBpdCBmcm9tIHBpZWNlUG9zaXRpb25zDQogICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkS2V5ID0gYCR7Y2FwdHVyZWRQaWVjZS5jb2xvcn0tJHtjYXB0dXJlZFBpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZFBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoY2FwdHVyZWRQb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5bCGL+W4heS4jeS8muiiq+WQg+aOie+8jOaJgOS7peWPquWkhOeQhuWFtuS7luaji+WtkA0KICAgICAgICAgICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZS50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJlbW92ZSB0aGUgY2FwdHVyZWQgcG9zaXRpb24gZnJvbSB0aGUgYXJyYXkNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNhcHR1cmVkUG9zaXRpb25zKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHVwZGF0ZWRQb3NpdGlvbnMgPSBjYXB0dXJlZFBvc2l0aW9ucy5maWx0ZXIocG9zID0+IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgKHBvcy5yICE9PSB0b1Bvcy5yIHx8IHBvcy5jICE9PSB0b1Bvcy5jKQ0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgcGllY2VQb3NpdGlvbnNbY2FwdHVyZWRLZXldID0gdXBkYXRlZFBvc2l0aW9uczsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBWZXJpZnkgcmVtb3ZhbCB3YXMgc3VjY2Vzc2Z1bA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0aWxsRXhpc3RzID0gdXBkYXRlZFBvc2l0aW9ucy5zb21lKHBvcyA9PiANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zICYmIHBvcy5yID09PSB0b1Bvcy5yICYmIHBvcy5jID09PSB0b1Bvcy5jDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoc3RpbGxFeGlzdHMpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBDYXB0dXJlZCBwaWVjZSBzdGlsbCBleGlzdHMgaW4gcGllY2VQb3NpdGlvbnMhJyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ+KchSBTVUNDRVNTOiBDYXB0dXJlZCBwaWVjZSByZW1vdmVkIGZyb20gcGllY2VQb3NpdGlvbnMnKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogVW5leHBlY3RlZCBub24tYXJyYXkgcG9zaXRpb25zIGZvciBwaWVjZTonLCBjYXB0dXJlZEtleSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IE5vIHBvc2l0aW9ucyBmb3VuZCBmb3IgY2FwdHVyZWQgcGllY2U6JywgY2FwdHVyZWRLZXkpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gVmVyaWZ5IHRoZSBjYXB0dXJlZCBwaWVjZSBoYXMgYmVlbiByZW1vdmVkDQogICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkS2V5ID0gYCR7Y2FwdHVyZWRQaWVjZS5jb2xvcn0tJHtjYXB0dXJlZFBpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgICAgICBjb25zdCBmaW5hbFBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XTsNCiAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaW5hbFBvc2l0aW9ucykpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RpbGxFeGlzdHMgPSBmaW5hbFBvc2l0aW9ucy5zb21lKHBvcyA9PiANCiAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiBwb3MuciA9PT0gdG9Qb3MuciAmJiBwb3MuYyA9PT0gdG9Qb3MuYw0KICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgICAgICBpZiAoc3RpbGxFeGlzdHMpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0VSUk9SOiBDYXB0dXJlZCBwaWVjZSBzdGlsbCBleGlzdHMgaW4gcGllY2VQb3NpdGlvbnM6JywgY2FwdHVyZWRQaWVjZSwgJ2F0JywgdG9Qb3MpOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NVQ0NFU1M6IENhcHR1cmVkIHBpZWNlIHJlbW92ZWQgZnJvbSBwaWVjZVBvc2l0aW9ucycpOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBNYWtlIHRoZSBtb3ZlIG9uIHRoZSB0ZW1wb3JhcnkgYm9hcmQgZmlyc3QgYmVmb3JlIHVwZGF0aW5nIHBpZWNlIHBvc2l0aW9ucw0KICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MoZnJvbVBvcy5yLCBmcm9tUG9zLmMpICYmIGlzVmFsaWRQb3ModG9Qb3MuciwgdG9Qb3MuYykgJiYgDQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2Zyb21Qb3Mucl0gJiYgdGVtcEJvYXJkW3RvUG9zLnJdKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSB0ZW1wQm9hcmRbZnJvbVBvcy5yXVtmcm9tUG9zLmNdOw0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFt0b1Bvcy5yXVt0b1Bvcy5jXSA9IHBpZWNlOw0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtmcm9tUG9zLnJdW2Zyb21Qb3MuY10gPSBudWxsOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IEludmFsaWQgcG9zaXRpb25zIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbiwgZnJvbVBvcywgdG9Qb3MpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBVcGRhdGUgdGhlIHBpZWNlIHBvc2l0aW9uIGluIHBpZWNlUG9zaXRpb25zDQogICAgICAgICAgICB1cGRhdGVQaWVjZVBvc2l0aW9uKHBpZWNlVHlwZSwgY3VycmVudENvbG9yLCBmcm9tUG9zLCB0b1Bvcyk7DQogICAgICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFN3aXRjaCBjb2xvciBmb3IgbmV4dCBtb3ZlDQogICAgICAgICAgICBjdXJyZW50Q29sb3IgPSBjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICB9KTsNCg0KICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgfQ0KfQ0KDQovLyAtLS0gQ29uc3RhbnRzIC0tLQ0KDQovLyBJbml0aWFsaXplIE9wZW5pbmcgQm9vaw0KY29uc3Qgb3BlbmluZ0Jvb2sgPSBuZXcgT3BlbmluZ0Jvb2soMTIpOw0KDQpjb25zdCBpc1ZhbGlkUG9zID0gKHIsIGMpID0+IHIgPj0gMCAmJiByIDwgUk9XUyAmJiBjID49IDAgJiYgYyA8IENPTFM7DQoNCi8vIOaooeWdl+e6p+S8quWQiOazleiQveeCue+8iOmBv+WFjSBnZXRQaWVjZU1vdmVzIOavj+iwg+eUqOaWsOW7uumXreWMhe+8iQ0KY29uc3QgcHVzaFBzZXVkb0Rlc3QgPSAoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIHRyLCB0YykgPT4gew0KICBpZiAodHIgPCAwIHx8IHRyID49IFJPV1MgfHwgdGMgPCAwIHx8IHRjID49IENPTFMpIHJldHVybjsNCiAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbdHJdW3RjXTsNCiAgaWYgKCF0YXJnZXQgfHwgdGFyZ2V0LmNvbG9yICE9PSBwaWVjZUNvbG9yKSB7DQogICAgbW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgfSBlbHNlIGlmIChhbGxpZXNPdXQgJiYgdGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgew0KICAgIGFsbGllc091dC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICB9DQp9Ow0KDQovLyBhbGxpZXNPdXQ6IOWPr+mAie+8jOaUtumbhuWPr+S/neaKpOeahOW3seaWueiQveeCue+8iOS4jeWQq+WwhuW4he+8ie+8jOS+m+WFs+ezu+iuoeeul+WkjeeUqO+8jOmBv+WFjeS6jOasoeWwhOe6vw0KY29uc3QgZ2V0UGllY2VNb3ZlcyA9IChib2FyZCwgcG9zLCBwaWVjZSwgYWxsaWVzT3V0ID0gbnVsbCkgPT4gew0KICBjb25zdCBtb3ZlcyA9IFtdOw0KICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQogIGNvbnN0IHBpZWNlQ29sb3IgPSBwaWVjZS5jb2xvcjsNCiAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOw0KICBjb25zdCBmcm9tU3EgPSByICogOSArIGM7DQoNCiAgc3dpdGNoIChwaWVjZS50eXBlKSB7DQogICAgY2FzZSAnZ2VuZXJhbCc6IHsNCiAgICAgIGNvbnN0IGRlc3RzID0gR0VORVJBTF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogICAgY2FzZSAnYWR2aXNvcic6IHsNCiAgICAgIGNvbnN0IGRlc3RzID0gQURWSVNPUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogICAgY2FzZSAnZWxlcGhhbnQnOiB7DQogICAgICBjb25zdCBkZXN0cyA9IEVMRVBIQU5UX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgaWYgKGJvYXJkW2QuYnJdW2QuYmNdID09PSBudWxsKSB7DQogICAgICAgICAgcHVzaFBzZXVkb0Rlc3QoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIGQuciwgZC5jKTsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICAgIGNhc2UgJ2hvcnNlJzogew0KICAgICAgY29uc3QgZGVzdHMgPSBIT1JTRV9ERVNUW2Zyb21TcV07DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgaWYgKGJvYXJkW2QuYnJdW2QuYmNdID09PSBudWxsKSB7DQogICAgICAgICAgcHVzaFBzZXVkb0Rlc3QoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIGQuciwgZC5jKTsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICAgIGNhc2UgJ2NoYXJpb3QnOg0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMpIHsNCiAgICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgIGlmICh0YXJnZXQgPT09IG51bGwpIHsNCiAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlQ29sb3IpIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICBlbHNlIGlmIChhbGxpZXNPdXQgJiYgdGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgYWxsaWVzT3V0LnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgICB9DQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgICB9DQogICAgICB9DQogICAgICBicmVhazsNCiAgICBjYXNlICdjYW5ub24nOg0KICAgICAgLy8g552A5rOV5LuN5Y+q5ZCr5pWM5pa56ZqU5omT77yb5bex5pa56ZqU5omT5L+d5oqk55SxIGZpbGxDYW5ub25SZWxhdGlvbnMg57uf5LiA5aSE55CGDQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGxldCBzY3JlZW5Gb3VuZCA9IGZhbHNlOw0KICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMpIHsNCiAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgc2NyZWVuRm91bmQgPSB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSAhPT0gbnVsbCkgew0KICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXS5jb2xvciAhPT0gcGllY2VDb2xvcikgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgICAgfQ0KICAgICAgICAgIG5yICs9IGRyOyBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnc29sZGllcic6IHsNCiAgICAgIGNvbnN0IGRlc3RzID0gU09MRElFUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogIH0NCiAgcmV0dXJuIG1vdmVzOw0KfTsNCg0KY29uc3QgaXNGbHlpbmdHZW5lcmFsID0gKGJvYXJkKSA9PiB7DQogIGNvbnN0IHJlZEcgPSBnZXRHZW5lcmFsUG9zKGJvYXJkLCAncmVkJyk7DQogIGNvbnN0IGJsYWNrRyA9IGdldEdlbmVyYWxQb3MoYm9hcmQsICdibGFjaycpOw0KICBpZiAoIXJlZEcgfHwgIWJsYWNrRyB8fCByZWRHLmMgIT09IGJsYWNrRy5jKSByZXR1cm4gZmFsc2U7DQogIA0KICAvLyDnoa7kv53lvqrnjq/mlrnlkJHmraPnoa7vvIzku47ovoPlsI/nmoRy5Yiw6L6D5aSn55qEcg0KICBjb25zdCBzdGFydFIgPSBNYXRoLm1pbihibGFja0cuciwgcmVkRy5yKSArIDE7DQogIGNvbnN0IGVuZFIgPSBNYXRoLm1heChibGFja0cuciwgcmVkRy5yKSAtIDE7DQogIA0KICBmb3IgKGxldCByID0gc3RhcnRSOyByIDw9IGVuZFI7IHIrKykgew0KICAgIGlmIChib2FyZFtyXVtyZWRHLmNdICE9PSBudWxsKSByZXR1cm4gZmFsc2U7DQogIH0NCiAgcmV0dXJuIHRydWU7DQp9Ow0KDQovLyDml6AgYm9hcmRJbmZvIOaXtueahOW/q+mAn+WwhuWGm+ajgOa1i++8muWwhuS9jee8k+WtmCArIOS7juWwhuS9jeWbm+WQkeWwhOe6v++8iOi9pi/lsIYv54Ku5ZCI5bm277yJDQpjb25zdCBpc0NoZWNrUmF3RnJvbVBpZWNlU3RhdGUgPSAoc3RhdGUsIGNvbG9yKSA9PiB7CiAgICBjb25zdCBvd25Jc1JlZCA9IGNvbG9yID09PSAncmVkJzsKICAgIGNvbnN0IGdlbmVyYWxTcSA9IG93bklzUmVkID8gc3RhdGUucmVkR2VuZXJhbFNxIDogc3RhdGUuYmxhY2tHZW5lcmFsU3E7CiAgICBpZiAoZ2VuZXJhbFNxIDwgMCkgcmV0dXJuIHRydWU7CgogICAgY29uc3Qgc3F1YXJlQ29kZXMgPSBzdGF0ZS5zcXVhcmVDb2RlczsKICAgIGNvbnN0IGVuZW15SXNSZWQgPSAhb3duSXNSZWQ7CiAgICBjb25zdCBnciA9IChnZW5lcmFsU3EgLyA5KSB8IDA7CiAgICBjb25zdCBnYyA9IGdlbmVyYWxTcSAlIDk7CgogICAgZm9yIChsZXQgZGlyID0gMDsgZGlyIDwgT1JUSF9ESVJTLmxlbmd0aDsgZGlyKyspIHsKICAgICAgICBjb25zdCByYXkgPSBTRUFSQ0hfUkFZU1tnZW5lcmFsU3FdW2Rpcl07CiAgICAgICAgbGV0IHNlZW4gPSAwOwogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF5Lmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW3JheVtpXV07CiAgICAgICAgICAgIGlmIChwaWVjZUNvZGUgPT09IDApIGNvbnRpbnVlOwogICAgICAgICAgICBzZWVuKys7CiAgICAgICAgICAgIGNvbnN0IGlzRW5lbXkgPSAocGllY2VDb2RlIDwgOCkgPT09IGVuZW15SXNSZWQ7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlQ29kZSAmIDc7CiAgICAgICAgICAgIGlmIChzZWVuID09PSAxKSB7CiAgICAgICAgICAgICAgICBpZiAoaXNFbmVteSAmJiAocGllY2VUeXBlID09PSAyIHx8IHBpZWNlVHlwZSA9PT0gMSkpIHJldHVybiB0cnVlOwogICAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAgICAgaWYgKGlzRW5lbXkgJiYgcGllY2VUeXBlID09PSA2KSByZXR1cm4gdHJ1ZTsKICAgICAgICAgICAgICAgIGJyZWFrOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfQoKICAgIGNvbnN0IGhvcnNlQ2hlY2tlcnMgPSBTRUFSQ0hfSE9SU0VfQ0hFQ0tFUlNbZ2VuZXJhbFNxXTsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaG9yc2VDaGVja2Vycy5sZW5ndGg7IGkrKykgewogICAgICAgIGNvbnN0IGVudHJ5ID0gaG9yc2VDaGVja2Vyc1tpXTsKICAgICAgICBpZiAoc3F1YXJlQ29kZXNbZW50cnkgPj4+IDddICE9PSAwKSBjb250aW51ZTsKICAgICAgICBjb25zdCBwaWVjZUNvZGUgPSBzcXVhcmVDb2Rlc1tlbnRyeSAmIDEyN107CiAgICAgICAgaWYgKHBpZWNlQ29kZSAhPT0gMCAmJiAocGllY2VDb2RlIDwgOCkgPT09IGVuZW15SXNSZWQgJiYgKHBpZWNlQ29kZSAmIDcpID09PSAzKSByZXR1cm4gdHJ1ZTsKICAgIH0KCiAgICBjb25zdCBhZHZpc29yU3F1YXJlcyA9IFNFQVJDSF9BRFZJU09SX0RFU1Rbb3duSXNSZWQgPyAwIDogMV1bZ2VuZXJhbFNxXTsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYWR2aXNvclNxdWFyZXMubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBwaWVjZUNvZGUgPSBzcXVhcmVDb2Rlc1thZHZpc29yU3F1YXJlc1tpXV07CiAgICAgICAgaWYgKHBpZWNlQ29kZSAhPT0gMCAmJiAocGllY2VDb2RlIDwgOCkgPT09IGVuZW15SXNSZWQgJiYgKHBpZWNlQ29kZSAmIDcpID09PSA1KSByZXR1cm4gdHJ1ZTsKICAgIH0KCiAgICBjb25zdCBlbmVteUZvcndhcmQgPSBlbmVteUlzUmVkID8gMSA6IC0xOwogICAgY29uc3QgZm9yd2FyZFIgPSBnciAtIGVuZW15Rm9yd2FyZDsKICAgIGlmIChmb3J3YXJkUiA+PSAwICYmIGZvcndhcmRSIDwgUk9XUykgewogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW2ZvcndhcmRSICogOSArIGdjXTsKICAgICAgICBpZiAocGllY2VDb2RlICE9PSAwICYmIChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZCAmJiAocGllY2VDb2RlICYgNykgPT09IDcpIHJldHVybiB0cnVlOwogICAgfQogICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gZW5lbXlJc1JlZCA/IGdyID49IDUgOiBnciA8PSA0OwogICAgaWYgKGNyb3NzZWRSaXZlcikgewogICAgICAgIGlmIChnYyA8IENPTFMgLSAxKSB7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW2dlbmVyYWxTcSArIDFdOwogICAgICAgICAgICBpZiAocGllY2VDb2RlICE9PSAwICYmIChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZCAmJiAocGllY2VDb2RlICYgNykgPT09IDcpIHJldHVybiB0cnVlOwogICAgICAgIH0KICAgICAgICBpZiAoZ2MgPiAwKSB7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW2dlbmVyYWxTcSAtIDFdOwogICAgICAgICAgICBpZiAocGllY2VDb2RlICE9PSAwICYmIChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZCAmJiAocGllY2VDb2RlICYgNykgPT09IDcpIHJldHVybiB0cnVlOwogICAgICAgIH0KICAgIH0KCiAgICByZXR1cm4gZmFsc2U7Cn07Cgpjb25zdCBpc0NoZWNrUmF3ID0gKGJvYXJkLCBjb2xvcikgPT4gewogICAgY29uc3QgcGllY2VTdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOwogICAgaWYgKHBpZWNlU3RhdGUpIHJldHVybiBpc0NoZWNrUmF3RnJvbVBpZWNlU3RhdGUocGllY2VTdGF0ZSwgY29sb3IpOwogICAgY29uc3QgZ2VuZXJhbFBvcyA9IGdldEdlbmVyYWxQb3MoYm9hcmQsIGNvbG9yKTsKICAgIGlmICghZ2VuZXJhbFBvcykgcmV0dXJuIHRydWU7DQoNCiAgICBjb25zdCBlbmVteUNvbG9yID0gY29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgIGNvbnN0IHsgcjogZ3IsIGM6IGdjIH0gPSBnZW5lcmFsUG9zOw0KDQogICAgLy8g55u057q/77ya56ys5LiA5a2Q5Li65pWM6L2mL+WwhuWImeWwhuWGm++8m+i2iui/h+eCruaetuWQjuesrOS6jOWtkOS4uuaVjOeCruWImeWwhuWGmw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgbGV0IG5yID0gZ3IgKyBkcjsNCiAgICAgICAgbGV0IG5jID0gZ2MgKyBkYzsNCiAgICAgICAgbGV0IHNlZW4gPSAwOw0KDQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHApIHsNCiAgICAgICAgICAgICAgICBzZWVuKys7DQogICAgICAgICAgICAgICAgaWYgKHNlZW4gPT09IDEpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgKHAudHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHAudHlwZSA9PT0gJ2dlbmVyYWwnKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdjYW5ub24nKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBuciArPSBkcjsNCiAgICAgICAgICAgIG5jICs9IGRjOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g6ams77ya5LuO5bCG5L2N5Y+N5o6o77yM6ams6IW/5Zyo6ams5LiA5L6n77yI5LiOIGdldFBpZWNlTW92ZXMgLyBIT1JTRV9ESVJTIOS4gOiHtO+8iQ0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgSE9SU0VfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gSE9SU0VfRElSU1tpXTsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGQuZHI7DQogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkLmRjOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhuciwgbmMpKSB7DQogICAgICAgICAgICBjb25zdCBsZWdSID0gbnIgLSBkLmxlZ0RyOw0KICAgICAgICAgICAgY29uc3QgbGVnQyA9IG5jIC0gZC5sZWdEYzsNCiAgICAgICAgICAgIGlmIChib2FyZFtsZWdSXVtsZWdDXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnaG9yc2UnKSB7DQogICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOWjq++8iOS5neWuq+WGhe+8iQ0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgRElBR19ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gRElBR19ESVJTW2ldWzBdLCBkYyA9IERJQUdfRElSU1tpXVsxXTsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGRyOw0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYNCiAgICAgICAgICAgICgoY29sb3IgPT09ICdyZWQnICYmIG5yID49IDAgJiYgbnIgPD0gMikgfHwgKGNvbG9yID09PSAnYmxhY2snICYmIG5yID49IDcgJiYgbnIgPD0gOSkpICYmDQogICAgICAgICAgICBuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdhZHZpc29yJykgew0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5YW177ya5q2j5YmN5pa55aeL57uI5Y+v5pS777yb5bem5Y+z5LuF6L+H5rKz5YW1DQogICAgY29uc3QgZW5lbXlGb3J3YXJkID0gZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyAxIDogLTE7DQogICAgY29uc3QgZm9yd2FyZEZyb21SID0gZ3IgLSBlbmVteUZvcndhcmQ7DQogICAgaWYgKGlzVmFsaWRQb3MoZm9yd2FyZEZyb21SLCBnYykpIHsNCiAgICAgICAgY29uc3QgcCA9IGJvYXJkW2ZvcndhcmRGcm9tUl1bZ2NdOw0KICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7DQogICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBmb3IgKGNvbnN0IGRjIG9mIFsxLCAtMV0pIHsNCiAgICAgICAgY29uc3QgbmMgPSBnYyArIGRjOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhnciwgbmMpKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbZ3JdW25jXTsNCiAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnc29sZGllcicpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBlbmVteUNvbG9yID09PSAncmVkJyA/IGdyID49IDUgOiBnciA8PSA0Ow0KICAgICAgICAgICAgICAgIGlmIChjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgcmV0dXJuIGZhbHNlOw0KfTsNCg0KY29uc3QgaXNDaGVjayA9IChib2FyZCwgY29sb3IsIHBpZWNlc0luZm8gPSBudWxsLCBib2FyZEluZm8gPSBudWxsKSA9PiB7DQogICAgLy8g5LyY5YWI5L2/55So6aKE6K6h566X55qE5bCG5Yab54q25oCBDQogICAgaWYgKGJvYXJkSW5mbykgew0KICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZElzSW5DaGVjayA6IGJvYXJkSW5mby5ibGFja0lzSW5DaGVjazsNCiAgICB9DQoNCiAgICAvLyDlpoLmnpzmnIlwaWVjZXNJbmZv77yM5Lmf5Y+v5Lul5LuO5Lit6I635Y+W5bCG5Yab54q25oCBDQogICAgaWYgKHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7DQogICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyBwaWVjZXNJbmZvWzBdLnJlZElzSW5DaGVjayA6IHBpZWNlc0luZm9bMF0uYmxhY2tJc0luQ2hlY2s7DQogICAgfQ0KDQogICAgcmV0dXJuIGlzQ2hlY2tSYXcoYm9hcmQsIGNvbG9yKTsNCn07DQoNCi8vIOWQiOazleedgOazle+8muS8quWQiOazlSArIOS4jemAgeWwhi/kuI3po57lsIbvvIhtYWtlL3VubWFrZe+8iQ0KY29uc3QgZ2V0VmFsaWRNb3ZlcyA9IChib2FyZCwgcG9zKSA9PiB7DQogIGNvbnN0IHBpZWNlID0gYm9hcmRbcG9zLnJdW3Bvcy5jXTsNCiAgaWYgKCFwaWVjZSkgcmV0dXJuIFtdOw0KICBjb25zdCBwc2V1ZG9Nb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHBvcywgcGllY2UpOw0KICByZXR1cm4gZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgcG9zLCBwaWVjZSwgcHNldWRvTW92ZXMpOw0KfTsNCg0KY29uc3QgaXNWYWxpZFBsYWNlbWVudCA9ICh0eXBlLCBjb2xvciwgciwgYykgPT4gew0KICAgIGNvbnN0IGlzUmVkID0gY29sb3IgPT09ICdyZWQnOw0KICAgIHN3aXRjaCh0eXBlKSB7DQogICAgICAgIGNhc2UgJ2dlbmVyYWwnOg0KICAgICAgICAgICAgLy8g5biF5bCG5Y+q6IO95Zyo5Lmd5a6r5Lit5b+D55qE5LiA5p2h57q/5LiKDQogICAgICAgICAgICBpZiAoYyA8IDMgfHwgYyA+IDUpIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgIGlmIChpc1JlZCkgcmV0dXJuIHIgPj0gMCAmJiByIDw9IDI7DQogICAgICAgICAgICBlbHNlIHJldHVybiByID49IDcgJiYgciA8PSA5Ow0KICAgICAgICBjYXNlICdhZHZpc29yJzoNCiAgICAgICAgICAgIC8vIOWjq+WPquiDveWcqOS5neWuq+eahDXkuKrngrnkuYvkuIANCiAgICAgICAgICAgIGNvbnN0IHZhbGlkQWR2aXNvclBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IFtbMCwgM10sIFswLCA1XSwgWzEsIDRdLCBbMiwgM10sIFsyLCA1XV0sDQogICAgICAgICAgICAgICAgYmxhY2s6IFtbNywgM10sIFs3LCA1XSwgWzgsIDRdLCBbOSwgM10sIFs5LCA1XV0NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICByZXR1cm4gdmFsaWRBZHZpc29yUG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXS5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgY2FzZSAnZWxlcGhhbnQnOg0KICAgICAgICAgICAgLy8g55u45Y+q6IO95Zyo5bex5pa55Y2K5Zy655qEN+S4queCueS5i+S4gA0KICAgICAgICAgICAgY29uc3QgdmFsaWRFbGVwaGFudFBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IFtbMCwgMl0sIFswLCA2XSwgWzIsIDBdLCBbMiwgNF0sIFsyLCA4XSwgWzQsIDJdLCBbNCwgNl1dLA0KICAgICAgICAgICAgICAgIGJsYWNrOiBbWzUsIDJdLCBbNSwgNl0sIFs3LCAwXSwgWzcsIDRdLCBbNywgOF0sIFs5LCAyXSwgWzksIDZdXQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIHJldHVybiB2YWxpZEVsZXBoYW50UG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXS5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgY2FzZSAnc29sZGllcic6DQogICAgICAgICAgICAvLyDlhbXnmoTkvY3nva7pmZDliLbvvJrov4fmsrPliY3lj6rog73lnKjlgbbmlbDliJfvvIzov4fmsrPlkI7lj6/ku6XlnKjku7vkvZXliJcNCiAgICAgICAgICAgIC8vIOe6ouaWueWFtei/h+ays+adoeS7tuaYr3IgPj0gNe+8jOm7keaWueWFtei/h+ays+adoeS7tuaYr3IgPD0gNA0KICAgICAgICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gaXNSZWQgPyByID49IDUgOiByIDw9IDQ7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgICAgICAgICAgLy8g6L+H5rKz5YmN5Y+q6IO95Zyo5YG25pWw5YiX77yIYz0wLDIsNCw2LDjvvIkNCiAgICAgICAgICAgICAgICBpZiAoIVswLCAyLCA0LCA2LCA4XS5pbmNsdWRlcyhjKSkgcmV0dXJuIGZhbHNlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDlhbXnmoTkvY3nva7pmZDliLbvvJrov4fmsrPliY3lj6rog73lnKjlhbXkvY3lkozlhbXkvY3liY3mlrnvvIzov4fmsrPlkI7mlYzmlrnljYrlnLrpg73lkIjms5UNCiAgICAgICAgICAgIGNvbnN0IHZhbGlkU29sZGllclBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IHsNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa55Yid5aeL5YW15L2N77yacj0zLCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBpbml0aWFsOiBbWzMsIDBdLCBbMywgMl0sIFszLCA0XSwgWzMsIDZdLCBbMywgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnlhbXkvY3liY3mlrnvvJpyPTQsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGZvcndhcmQ6IFtbNCwgMF0sIFs0LCAyXSwgWzQsIDRdLCBbNCwgNl0sIFs0LCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/h+ays+e6v++8mnI+PTUNCiAgICAgICAgICAgICAgICAgICAgY3Jvc3NlZFJpdmVyOiByID49IDUNCiAgICAgICAgICAgICAgICB9LA0KICAgICAgICAgICAgICAgIGJsYWNrOiB7DQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueWIneWni+WFteS9je+8mnI9NiwgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbDogW1s2LCAwXSwgWzYsIDJdLCBbNiwgNF0sIFs2LCA2XSwgWzYsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55YW15L2N5YmN5pa577yacj01LCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBmb3J3YXJkOiBbWzUsIDBdLCBbNSwgMl0sIFs1LCA0XSwgWzUsIDZdLCBbNSwgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov4fmsrPnur/vvJpyPD00DQogICAgICAgICAgICAgICAgICAgIGNyb3NzZWRSaXZlcjogciA8PSA0DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgY29uc3Qgc29sZGllckluZm8gPSB2YWxpZFNvbGRpZXJQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddOw0KICAgICAgICAgICAgY29uc3QgaXNJbml0aWFsUG9zID0gc29sZGllckluZm8uaW5pdGlhbC5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgICAgIGNvbnN0IGlzRm9yd2FyZFBvcyA9IHNvbGRpZXJJbmZvLmZvcndhcmQuc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChzb2xkaWVySW5mby5jcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICAvLyDov4fmsrPlkI7mlYzmlrnljYrlnLrpg73lkIjms5UNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g6L+H5rKz5YmN5Y+q6IO95Zyo5YW15L2N5ZKM5YW15L2N5YmN5pa5DQogICAgICAgICAgICAgICAgcmV0dXJuIGlzSW5pdGlhbFBvcyB8fCBpc0ZvcndhcmRQb3M7DQogICAgICAgICAgICB9DQogICAgICAgIGRlZmF1bHQ6DQogICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICB9DQp9Ow0KDQpjb25zdCBjaGVja0dhbWVTdGF0ZSA9IChib2FyZCwgdHVybiwgcGllY2VzSW5mbyA9IG51bGwsIGJvYXJkSW5mbyA9IG51bGwpID0+IHsNCiAgICAvLyDkvJjlhYjkvb/nlKjpooTorqHnrpfnmoRnYW1lU3RhdGUNCiAgICBpZiAoYm9hcmRJbmZvICYmIGJvYXJkSW5mby5nYW1lU3RhdGUpIHsNCiAgICAgICAgcmV0dXJuIGJvYXJkSW5mby5nYW1lU3RhdGU7DQogICAgfQ0KICAgIA0KICAgIC8vIOayoeaciemihOiuoeeul+e7k+aenOaXtu+8jOaJp+ihjOWOn+Wni+iuoeeulw0KICAgIGxldCBoYXNNb3ZlcyA9IGZhbHNlOw0KICAgIGZvcihsZXQgcj0wOyByPFJPV1M7IHIrKykgew0KICAgICAgICBmb3IobGV0IGM9MDsgYzxDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgICAgICAgICBpZiAoZ2V0VmFsaWRNb3Zlcyhib2FyZCwge3IsY30pLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICAgICAgaGFzTW92ZXMgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKGhhc01vdmVzKSBicmVhazsNCiAgICB9DQoNCiAgICBpZiAoaGFzTW92ZXMpIHJldHVybiB7IHN0YXR1czogJ3BsYXlpbmcnIH07DQoNCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVjayhib2FyZCwgdHVybiwgcGllY2VzSW5mbywgYm9hcmRJbmZvKTsNCiAgICBjb25zdCBvcHBvbmVudCA9IHR1cm4gPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgIA0KICAgIGlmIChpbkNoZWNrKSB7DQogICAgICAgIHJldHVybiB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICB9IGVsc2Ugew0KICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfQ0KfTsNCg0KDQoNCmNvbnN0IGdldEdhbWVQaGFzZSA9ICgpID0+IHsNCiAgcmV0dXJuICdvcGVuaW5nJzsNCn07DQoNCi8vIOWunuS+i+WMllpvYnJpc3RIYXNoZXINCmNvbnN0IHpvYnJpc3RIYXNoZXIgPSBuZXcgWm9icmlzdEhhc2hlcigpOw0KDQovLyDnva7mjaLooajlrp7njrDvvIjlrrnph4/nuqYgMl4yMO+8jOmBv+WFjSBNYXAg6L+H5aSn5ouW5oWiIEdD77yJDQpjb25zdCBUVF9ERUZBVUxUX0VWSUNUSU9OX0JBVENIID0gMTAyNDsKCmNsYXNzIFRyYW5zcG9zaXRpb25UYWJsZSB7CiAgICBjb25zdHJ1Y3RvcihzaXplID0gTWF0aC5wb3coMiwgMjApLCBldmljdGlvbkJhdGNoID0gVFRfREVGQVVMVF9FVklDVElPTl9CQVRDSCkgewogICAgICAgIHRoaXMudGFibGUgPSBuZXcgTWFwKCk7CiAgICAgICAgdGhpcy5zaXplID0gc2l6ZTsKICAgICAgICB0aGlzLmV2aWN0aW9uQmF0Y2ggPSBldmljdGlvbkJhdGNoOwogICAgICAgIHRoaXMuaGFzaGVyID0gem9icmlzdEhhc2hlcjsNCiAgICAgICAgLy8g57uf6K6h5L+h5oGvDQogICAgICAgIHRoaXMuc3RhdHMgPSB7DQogICAgICAgICAgICBoaXRzOiAwLA0KICAgICAgICAgICAgbWlzc2VzOiAwLA0KICAgICAgICAgICAgZXhhY3RIaXRzOiAwLA0KICAgICAgICAgICAgbG93ZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICB1cHBlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHN0b3JlczogMCwKICAgICAgICAgICAgbHJ1RXZpY3Rpb25zOiAwLAogICAgICAgICAgICB1cGRhdGVkU3RvcmVzOiAwLAogICAgICAgICAgICBldmljdGlvbkJhdGNoZXM6IDAsCiAgICAgICAgICAgIGNsZWFyczogMAogICAgICAgIH07CiAgICB9CgogICAgc2V0RXZpY3Rpb25CYXRjaChiYXRjaCkgewogICAgICAgIHRoaXMuZXZpY3Rpb25CYXRjaCA9IE1hdGgubWF4KDEsIGJhdGNoIHwgMCk7CiAgICB9CiAgICANCiAgICBzdG9yZShrZXksIGRlcHRoLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUgPSBudWxsLCBtb3ZlU2VxdWVuY2UgPSBudWxsKSB7DQogICAgICAgIGlmICh0aGlzLnRhYmxlLnNpemUgPj0gdGhpcy5zaXplKSB7CiAgICAgICAgICAgIGlmICh0aGlzLnRhYmxlLmhhcyhrZXkpKSB7CiAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLnVwZGF0ZWRTdG9yZXMrKzsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGNvbnN0IGRyb3BDb3VudCA9IE1hdGgubWluKHRoaXMuZXZpY3Rpb25CYXRjaCwgdGhpcy50YWJsZS5zaXplKTsKICAgICAgICAgICAgICAgIGxldCBkcm9wcGVkID0gMDsKICAgICAgICAgICAgICAgIGZvciAoY29uc3Qgb2xkZXN0S2V5IG9mIHRoaXMudGFibGUua2V5cygpKSB7CiAgICAgICAgICAgICAgICAgICAgdGhpcy50YWJsZS5kZWxldGUob2xkZXN0S2V5KTsKICAgICAgICAgICAgICAgICAgICBpZiAoKytkcm9wcGVkID49IGRyb3BDb3VudCkgYnJlYWs7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLmxydUV2aWN0aW9ucyArPSBkcm9wcGVkOwogICAgICAgICAgICAgICAgdGhpcy5zdGF0cy5ldmljdGlvbkJhdGNoZXMrKzsKICAgICAgICAgICAgfQogICAgICAgIH0NCiAgICAgICAgdGhpcy50YWJsZS5zZXQoa2V5LCB7IGRlcHRoLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUsIG1vdmVTZXF1ZW5jZSB9KTsNCiAgICAgICAgdGhpcy5zdGF0cy5zdG9yZXMrKzsNCiAgICB9DQogICAgDQogICAgcmV0cmlldmUoa2V5KSB7DQogICAgICAgIGNvbnN0IGVudHJ5ID0gdGhpcy50YWJsZS5nZXQoa2V5KSB8fCBudWxsOw0KICAgICAgICBpZiAoZW50cnkpIHsNCiAgICAgICAgICAgIHRoaXMuc3RhdHMuaGl0cysrOw0KICAgICAgICAgICAgLy8g57uf6K6h5LiN5ZCM57G75Z6L55qE5ZG95LitDQogICAgICAgICAgICBzd2l0Y2ggKGVudHJ5LmZsYWcpIHsNCiAgICAgICAgICAgICAgICBjYXNlICdleGFjdCc6DQogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMuZXhhY3RIaXRzKys7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIGNhc2UgJ2xvd2VyYm91bmQnOg0KICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLmxvd2VyYm91bmRIaXRzKys7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIGNhc2UgJ3VwcGVyYm91bmQnOg0KICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLnVwcGVyYm91bmRIaXRzKys7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgdGhpcy5zdGF0cy5taXNzZXMrKzsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gZW50cnk7DQogICAgfQ0KICAgIA0KICAgIGNsZWFyKCkgew0KICAgICAgICB0aGlzLnRhYmxlLmNsZWFyKCk7DQogICAgICAgIHRoaXMuc3RhdHMuY2xlYXJzKys7DQogICAgfQ0KICAgIA0KICAgIC8vIOiOt+WPlue7n+iuoeS/oeaBr+W5tuiuoeeul+WRveS4reeOhw0KICAgIGdldFN0YXRzKCkgew0KICAgICAgICBjb25zdCB0b3RhbEFjY2Vzc2VzID0gdGhpcy5zdGF0cy5oaXRzICsgdGhpcy5zdGF0cy5taXNzZXM7DQogICAgICAgIGNvbnN0IGhpdFJhdGUgPSB0b3RhbEFjY2Vzc2VzID4gMCA/ICh0aGlzLnN0YXRzLmhpdHMgLyB0b3RhbEFjY2Vzc2VzICogMTAwKS50b0ZpeGVkKDIpIDogMDsNCiAgICAgICAgcmV0dXJuIHsKICAgICAgICAgICAgLi4udGhpcy5zdGF0cywKICAgICAgICAgICAgZXZpY3Rpb25CYXRjaDogdGhpcy5ldmljdGlvbkJhdGNoLAogICAgICAgICAgICB0b3RhbEFjY2Vzc2VzLAogICAgICAgICAgICBoaXRSYXRlLA0KICAgICAgICAgICAgY3VycmVudFNpemU6IHRoaXMudGFibGUuc2l6ZSwNCiAgICAgICAgICAgIG1heFNpemU6IHRoaXMuc2l6ZSwNCiAgICAgICAgICAgIGZpbGxQZXJjZW50YWdlOiAodGhpcy50YWJsZS5zaXplIC8gdGhpcy5zaXplICogMTAwKS50b0ZpeGVkKDIpDQogICAgICAgIH07DQogICAgfQ0KICAgIA0KICAgIC8vIOmHjee9rue7n+iuoeS/oeaBrw0KICAgIHJlc2V0U3RhdHMoKSB7DQogICAgICAgIHRoaXMuc3RhdHMgPSB7DQogICAgICAgICAgICBoaXRzOiAwLA0KICAgICAgICAgICAgbWlzc2VzOiAwLA0KICAgICAgICAgICAgZXhhY3RIaXRzOiAwLA0KICAgICAgICAgICAgbG93ZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICB1cHBlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHN0b3JlczogMCwKICAgICAgICAgICAgbHJ1RXZpY3Rpb25zOiAwLAogICAgICAgICAgICB1cGRhdGVkU3RvcmVzOiAwLAogICAgICAgICAgICBldmljdGlvbkJhdGNoZXM6IDAsCiAgICAgICAgICAgIGNsZWFyczogMAogICAgICAgIH07DQogICAgfQ0KfQ0KDQovLyDmgKfog73nu5/orqENCmxldCBwZXJmU3RhdHMgPSB7DQogICAgZXZhbHVhdGVCb2FyZENvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwNCiAgICBwcmVwYXJlU2VhcmNoSW5mb0NvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwNCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sDQogICAgYWxwaGFCZXRhQ2FsbHM6IDAsICAvLyDmgLvosIPnlKjmrKHmlbANCiAgICBub2Rlc1NlYXJjaGVkOiB7fSwgLy8g5oyJ5rex5bqm57uf6K6h5pCc57Si55qE6IqC54K55pWwDQogICAgbW92ZXNHZW5lcmF0ZWQ6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHnlJ/miJDnmoTotbDms5XmlbANCiAgICBjdXRvZmZzOiB7fSwgLy8g5oyJ5rex5bqm57uf6K6h5Ymq5p6d5qyh5pWwDQogICAgLy8g5ZCI5rOV5oCn6Lev5b6E77ya5Lyq5ZCI5rOV55Sf5oiQ6YeP44CB6K+V6LWw5ZCI5rOV5oCn5qOA5rWL44CB6Z2e5rOV6Lez6L+H44CB5a6e6ZmF6L+b5YWl5pCc57Si55qE5ZCI5rOV552ADQogICAgcHNldWRvTW92ZXNHZW5lcmF0ZWQ6IDAsDQogICAgbGVnYWxpdHlDaGVja3M6IDAsDQogICAgaWxsZWdhbE1vdmVzU2tpcHBlZDogMCwNCiAgICBsZWdhbE1vdmVzU2VhcmNoZWQ6IDAsDQogICAgLy8gWm9icmlzdO+8muWFqOebmOmHjeeul+asoeaVsCAvIOWinumHj+abtOaWsOasoeaVsCAvIOagoemqjOS4jeS4gOiHtO+8iOS7hSB2ZXJpZnkg5qih5byP77yJDQogICAgZnVsbEhhc2hDb3VudDogMCwNCiAgICBpbmNyZW1lbnRhbEhhc2hVcGRhdGVzOiAwLA0KICAgIGhhc2hNaXNtYXRjaGVzOiAwLAogICAgZmFzdExlYWZFdmFsQ291bnQ6IDAsCiAgICBmYXN0TGVhZkV2YWxNczogMCwKICAgIHByZXBhcmVDaGVja01zOiAwLAogICAgcHJlcGFyZU1vdmVHZW5NczogMCwKICAgIHNvcnRNb3Zlc0NvdW50OiAwLAogICAgc29ydE1vdmVzTXM6IDAsCiAgICBsZWdhbGl0eUNoZWNrTXM6IDAsCiAgICBjYXB0dXJlR2VuQ291bnQ6IDAsCiAgICBjYXB0dXJlR2VuTXM6IDAsCiAgICBxdWllc2NlbmNlQ2FsbHM6IDAsCiAgICBxdWllc2NlbmNlQ2FwdHVyZU1vdmVzOiAwLAogICAgc3RhdGljRXZhbENhY2hlSGl0czogMCwKICAgIHN0YXRpY0V2YWxDYWNoZU1pc3NlczogMCwKICAgIGV2YWx1YXRlQm9hcmRNczogMCwKICAgIHByZXBhcmVTZWFyY2hJbmZvTXM6IDAsDQogICAgc3RhcnRUaW1lOiBEYXRlLm5vdygpDQp9Ow0KDQovLyDph43nva7nu5/orqHvvIjmr4/mrKHmkJzntKLlvIDlp4vml7bosIPnlKjvvIkNCmNvbnN0IHJlc2V0UGVyZlN0YXRzID0gKCkgPT4gewogICAgYWN0aXZlU2VhcmNoUGllY2VTdGF0ZSA9IG51bGw7CiAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50ID0geyByZWQ6IDAsIGJsYWNrOiAwIH07DQogICAgcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsNCiAgICBwZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsNCiAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMgPSAwOw0KICAgIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkID0ge307DQogICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkID0ge307DQogICAgcGVyZlN0YXRzLmN1dG9mZnMgPSB7fTsNCiAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgPSAwOw0KICAgIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcyA9IDA7DQogICAgcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQgPSAwOw0KICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQgPSAwOw0KICAgIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50ID0gMDsNCiAgICBwZXJmU3RhdHMuaW5jcmVtZW50YWxIYXNoVXBkYXRlcyA9IDA7DQogICAgcGVyZlN0YXRzLmhhc2hNaXNtYXRjaGVzID0gMDsKICAgIHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxDb3VudCA9IDA7CiAgICBwZXJmU3RhdHMuZmFzdExlYWZFdmFsTXMgPSAwOwogICAgcGVyZlN0YXRzLnByZXBhcmVDaGVja01zID0gMDsKICAgIHBlcmZTdGF0cy5wcmVwYXJlTW92ZUdlbk1zID0gMDsKICAgIHBlcmZTdGF0cy5zb3J0TW92ZXNDb3VudCA9IDA7CiAgICBwZXJmU3RhdHMuc29ydE1vdmVzTXMgPSAwOwogICAgcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tNcyA9IDA7CiAgICBwZXJmU3RhdHMuY2FwdHVyZUdlbkNvdW50ID0gMDsKICAgIHBlcmZTdGF0cy5jYXB0dXJlR2VuTXMgPSAwOwogICAgcGVyZlN0YXRzLnF1aWVzY2VuY2VDYWxscyA9IDA7CiAgICBwZXJmU3RhdHMucXVpZXNjZW5jZUNhcHR1cmVNb3ZlcyA9IDA7CiAgICBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlSGl0cyA9IDA7CiAgICBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlTWlzc2VzID0gMDsKICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMgPSAwOwogICAgcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvTXMgPSAwOw0KICAgIHBlcmZTdGF0cy5zdGFydFRpbWUgPSBEYXRlLm5vdygpOw0KfTsNCg0KY29uc3Qgc25hcHNob3RQZXJmU3RhdHMgPSAoKSA9PiB7DQogICAgY29uc3QgZWxhcHNlZCA9IERhdGUubm93KCkgLSBwZXJmU3RhdHMuc3RhcnRUaW1lOw0KICAgIGNvbnN0IHR0U3RhdHMgPSB0cmFuc3Bvc2l0aW9uVGFibGUuZ2V0U3RhdHMoKTsNCiAgICBjb25zdCBkZXB0aHMgPSBPYmplY3Qua2V5cyhwZXJmU3RhdHMubm9kZXNTZWFyY2hlZCkuc29ydCgoYSwgYikgPT4gTnVtYmVyKGEpIC0gTnVtYmVyKGIpKTsNCiAgICBjb25zdCBieURlcHRoID0ge307DQogICAgZm9yIChjb25zdCBkIG9mIGRlcHRocykgew0KICAgICAgICBieURlcHRoW2RdID0gew0KICAgICAgICAgICAgbm9kZXM6IHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdIHx8IDAsDQogICAgICAgICAgICBtb3ZlczogcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdIHx8IDAsDQogICAgICAgICAgICBjdXRvZmZzOiBwZXJmU3RhdHMuY3V0b2Zmc1tkXSB8fCAwDQogICAgICAgIH07DQogICAgfQ0KICAgIHJldHVybiB7DQogICAgICAgIGVsYXBzZWRNczogZWxhcHNlZCwNCiAgICAgICAgcHJvZmlsZTogU0VBUkNIX1BST0ZJTEUsCiAgICAgICAgZXZhbHVhdGVCb2FyZDogeyAuLi5wZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50IH0sDQogICAgICAgIHByZXBhcmVTZWFyY2hJbmZvOiB7IC4uLnBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb0NvdW50IH0sDQogICAgICAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlczogeyAuLi5wZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnQgfSwNCiAgICAgICAgYWxwaGFCZXRhQ2FsbHM6IHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscywNCiAgICAgICAgcHNldWRvTW92ZXNHZW5lcmF0ZWQ6IHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCwNCiAgICAgICAgbGVnYWxpdHlDaGVja3M6IHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcywNCiAgICAgICAgaWxsZWdhbE1vdmVzU2tpcHBlZDogcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQsDQogICAgICAgIGxlZ2FsTW92ZXNTZWFyY2hlZDogcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCwNCiAgICAgICAgZnVsbEhhc2hDb3VudDogcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQsDQogICAgICAgIGluY3JlbWVudGFsSGFzaFVwZGF0ZXM6IHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzLA0KICAgICAgICBoYXNoTWlzbWF0Y2hlczogcGVyZlN0YXRzLmhhc2hNaXNtYXRjaGVzLAogICAgICAgIGZhc3RMZWFmRXZhbENvdW50OiBwZXJmU3RhdHMuZmFzdExlYWZFdmFsQ291bnQsCiAgICAgICAgZmFzdExlYWZFdmFsTXM6IHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxNcywKICAgICAgICBwcmVwYXJlQ2hlY2tNczogcGVyZlN0YXRzLnByZXBhcmVDaGVja01zLAogICAgICAgIHByZXBhcmVNb3ZlR2VuTXM6IHBlcmZTdGF0cy5wcmVwYXJlTW92ZUdlbk1zLAogICAgICAgIHNvcnRNb3Zlc0NvdW50OiBwZXJmU3RhdHMuc29ydE1vdmVzQ291bnQsCiAgICAgICAgc29ydE1vdmVzTXM6IHBlcmZTdGF0cy5zb3J0TW92ZXNNcywKICAgICAgICBsZWdhbGl0eUNoZWNrTXM6IHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrTXMsCiAgICAgICAgY2FwdHVyZUdlbkNvdW50OiBwZXJmU3RhdHMuY2FwdHVyZUdlbkNvdW50LAogICAgICAgIGNhcHR1cmVHZW5NczogcGVyZlN0YXRzLmNhcHR1cmVHZW5NcywKICAgICAgICBxdWllc2NlbmNlQ2FsbHM6IHBlcmZTdGF0cy5xdWllc2NlbmNlQ2FsbHMsCiAgICAgICAgcXVpZXNjZW5jZUNhcHR1cmVNb3ZlczogcGVyZlN0YXRzLnF1aWVzY2VuY2VDYXB0dXJlTW92ZXMsCiAgICAgICAgc3RhdGljRXZhbENhY2hlSGl0czogcGVyZlN0YXRzLnN0YXRpY0V2YWxDYWNoZUhpdHMsCiAgICAgICAgc3RhdGljRXZhbENhY2hlTWlzc2VzOiBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlTWlzc2VzLAogICAgICAgIGV2YWx1YXRlQm9hcmRNczogcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcywKICAgICAgICBwcmVwYXJlU2VhcmNoSW5mb01zOiBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcywNCiAgICAgICAgdHQ6IHR0U3RhdHMsDQogICAgICAgIGJ5RGVwdGgNCiAgICB9Ow0KfTsNCg0KLy8g5omT5Y2w57uf6K6h5L+h5oGvDQpjb25zdCBsb2dQZXJmU3RhdHMgPSAoY3VycmVudFBsYXllcikgPT4gew0KICAgIGNvbnN0IHNuYXAgPSBzbmFwc2hvdFBlcmZTdGF0cygpOw0KICAgIGNvbnNvbGUubG9nKGDwn5OKIOaAp+iDvee7n+iuoSAoJHtjdXJyZW50UGxheWVyfSkgLSAke3NuYXAuZWxhcHNlZE1zfW1zOmApOw0KICAgIGNvbnNvbGUubG9nKGAgICBldmFsdWF0ZUJvYXJkOiByZWQ9JHtzbmFwLmV2YWx1YXRlQm9hcmQucmVkfSwgYmxhY2s9JHtzbmFwLmV2YWx1YXRlQm9hcmQuYmxhY2t9YCk7DQogICAgY29uc29sZS5sb2coYCAgIHByZXBhcmVTZWFyY2hJbmZvOiByZWQ9JHtzbmFwLnByZXBhcmVTZWFyY2hJbmZvLnJlZH0sIGJsYWNrPSR7c25hcC5wcmVwYXJlU2VhcmNoSW5mby5ibGFja31gKTsNCiAgICBjb25zb2xlLmxvZyhgICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzOiByZWQ9JHtzbmFwLmNhbGN1bGF0ZVRocmVhdFZhbHVlcy5yZWR9LCBibGFjaz0ke3NuYXAuY2FsY3VsYXRlVGhyZWF0VmFsdWVzLmJsYWNrfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBhbHBoYUJldGHosIPnlKjmrKHmlbA6ICR7c25hcC5hbHBoYUJldGFDYWxsc31gKTsNCiAgICBjb25zb2xlLmxvZyhgICAg5ZCI5rOV5oCnOiBwc2V1ZG89JHtzbmFwLnBzZXVkb01vdmVzR2VuZXJhdGVkfSwgY2hlY2tzPSR7c25hcC5sZWdhbGl0eUNoZWNrc30sIGlsbGVnYWxTa2lwPSR7c25hcC5pbGxlZ2FsTW92ZXNTa2lwcGVkfSwgbGVnYWxTZWFyY2hlZD0ke3NuYXAubGVnYWxNb3Zlc1NlYXJjaGVkfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBab2JyaXN0OiBmdWxsSGFzaD0ke3NuYXAuZnVsbEhhc2hDb3VudH0sIGluY3JVcGRhdGVzPSR7c25hcC5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzfWApOwogICAgY29uc29sZS5sb2coYCAgIG51bWVyaWMgbGVhZjogbXM9JHtNYXRoLnJvdW5kKHNuYXAuZmFzdExlYWZFdmFsTXMpfSBjb3VudD0ke3NuYXAuZmFzdExlYWZFdmFsQ291bnR9IHByZXBhcmVNcz0ke01hdGgucm91bmQoc25hcC5wcmVwYXJlU2VhcmNoSW5mb01zKX1gKTsKICAgIGlmIChzbmFwLnByb2ZpbGUpIHsKICAgICAgICBjb25zb2xlLmxvZyhgICAgUHJvZmlsZSAob3ZlcmxhcHBpbmcgc2NvcGVzKTogcHJlcENoZWNrPSR7TWF0aC5yb3VuZChzbmFwLnByZXBhcmVDaGVja01zKX1tcyBwcmVwTW92ZXM9JHtNYXRoLnJvdW5kKHNuYXAucHJlcGFyZU1vdmVHZW5Ncyl9bXMgc29ydD0ke01hdGgucm91bmQoc25hcC5zb3J0TW92ZXNNcyl9bXMvJHtzbmFwLnNvcnRNb3Zlc0NvdW50fSBsZWdhbGl0eT0ke01hdGgucm91bmQoc25hcC5sZWdhbGl0eUNoZWNrTXMpfW1zIGNhcHR1cmVHZW49JHtNYXRoLnJvdW5kKHNuYXAuY2FwdHVyZUdlbk1zKX1tcy8ke3NuYXAuY2FwdHVyZUdlbkNvdW50fSBxcz0ke3NuYXAucXVpZXNjZW5jZUNhbGxzfSBjYXB0dXJlTW92ZXM9JHtzbmFwLnF1aWVzY2VuY2VDYXB0dXJlTW92ZXN9IGV2YWxDYWNoZT0ke3NuYXAuc3RhdGljRXZhbENhY2hlSGl0c30vJHtzbmFwLnN0YXRpY0V2YWxDYWNoZU1pc3Nlc31gKTsKICAgIH0KICAgIGNvbnNvbGUubG9nKGAgICBUVDogaGl0cz0ke3NuYXAudHQuaGl0c30sIG1pc3Nlcz0ke3NuYXAudHQubWlzc2VzfSwgaGl0UmF0ZT0ke3NuYXAudHQuaGl0UmF0ZX0lLCBzdG9yZXM9JHtzbmFwLnR0LnN0b3Jlc30sIHVwZGF0ZXM9JHtzbmFwLnR0LnVwZGF0ZWRTdG9yZXN9LCBldmljdGVkPSR7c25hcC50dC5scnVFdmljdGlvbnN9LyR7c25hcC50dC5ldmljdGlvbkJhdGNoZXN9IGJhdGNoZXM9JHtzbmFwLnR0LmV2aWN0aW9uQmF0Y2h9LCBzaXplPSR7c25hcC50dC5jdXJyZW50U2l6ZX1gKTsKICAgIA0KICAgIGNvbnN0IGRlcHRocyA9IE9iamVjdC5rZXlzKHNuYXAuYnlEZXB0aCk7DQogICAgaWYgKGRlcHRocy5sZW5ndGggPiAwKSB7DQogICAgICAgIGNvbnNvbGUubG9nKCcgICDmjInmt7Hluqbnu5/orqE6Jyk7DQogICAgICAgIGZvciAoY29uc3QgZCBvZiBkZXB0aHMpIHsNCiAgICAgICAgICAgIGNvbnN0IHJvdyA9IHNuYXAuYnlEZXB0aFtkXTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKGAgICAgIOa3seW6piR7ZH06IOiKgueCuT0ke3Jvdy5ub2Rlc30sIOi1sOazlT0ke3Jvdy5tb3Zlc30sIOWJquaenT0ke3Jvdy5jdXRvZmZzfWApOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KY29uc3QgdHJhbnNwb3NpdGlvblRhYmxlID0gbmV3IFRyYW5zcG9zaXRpb25UYWJsZSgpOw0KDQovLyDlj7bor4TkvLDnvJPlrZjvvIjlrozmlbTlvaLlir/liIbvvInvvJvmr4/mrKEgZ2V0QmVzdE1vdmUg5riF56m6DQpjb25zdCBFVkFMX0NBQ0hFX01BWCA9IE1hdGgucG93KDIsIDE4KTsKY29uc3QgZXZhbENhY2hlID0gbmV3IE1hcCgpOwpjb25zdCBjbGVhckV2YWxDYWNoZSA9ICgpID0+IHsKICAgIGV2YWxDYWNoZS5jbGVhcigpOwp9OwoNCi8vIOWJquaeneW8gOWFs++8muWujOaVtOivhOS8sOS4i+iLpeW8gOWxgOWHuuW6n+aji+WImeWFiOWFs++8jOS/neaji+WKm+WGjemHjeagh+Wumg0KDQovLyDnnYDms5XlkIjms5XmgKfvvJp0cnVlPeaQnOe0ouWGheivlei1sOaXtuajgOa1i++8iOWPr+i3s+i/h+WJquaeneacquinpuWPiuedgOazle+8ie+8m2ZhbHNlPXByZXBhcmUg5pe25YWo6YePIGZpbHRlckxlZ2FsTW92ZXPvvIjml6fot6/lvoTvvIkNCmxldCBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFID0gdHJ1ZTsKDQovLyBab2JyaXN0L1RU77yadHJ1ZT3mkJzntKLlhoXlop7ph4/nu7TmiqTlsYDpnaLlk4jluIwgKyDmlbDlgLwgVFQga2V577ybZmFsc2U95q+P6IqC54K55YWo55uYIGhhc2ggKyDlrZfnrKbkuLIga2V577yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQ0KLy8g6LCD6K+V77ya5aKe6YeP5ZCO5LiO5YWo55uYIGhhc2gg5q+U5a+577yI5LuF5qCh6aqM6ISa5pys5byA5ZCv77yM5q2j5byP5pCc57Si5YWz6Zet77yJDQoNCi8vIOaQnOe0ouWQr+WPke+8muadgOaji+ihqCArIOWOhuWPsuWQr+WPke+8iOavj+asoSBnZXRCZXN0TW92ZSDph43nva7vvIkNCmxldCBraWxsZXJNb3ZlcyA9IFtdOw0KbGV0IGhpc3RvcnlUYWJsZSA9IG51bGw7DQoNCmNvbnN0IHJlc2V0U2VhcmNoSGV1cmlzdGljcyA9IChtYXhEZXB0aCkgPT4gew0KICAgIGtpbGxlck1vdmVzID0gQXJyYXkobWF4RGVwdGggKyAyKS5maWxsKG51bGwpLm1hcCgoKSA9PiBbbnVsbCwgbnVsbF0pOw0KICAgIGhpc3RvcnlUYWJsZSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDEwIH0sICgpID0+DQogICAgICAgIEFycmF5LmZyb20oeyBsZW5ndGg6IDkgfSwgKCkgPT4NCiAgICAgICAgICAgIEFycmF5LmZyb20oeyBsZW5ndGg6IDEwIH0sICgpID0+IEFycmF5KDkpLmZpbGwoMCkpDQogICAgICAgICkNCiAgICApOw0KfTsNCg0KY29uc3QgaXNTYW1lTW92ZSA9IChhLCBiKSA9Pg0KICAgIGEgIT0gbnVsbCAmJiBiICE9IG51bGwgJiYNCiAgICBtb3ZlRnJvbVNxKGEpID09PSBtb3ZlRnJvbVNxKGIpICYmDQogICAgbW92ZVRvU3EoYSkgPT09IG1vdmVUb1NxKGIpOw0KDQpjb25zdCBzdG9yZUtpbGxlck1vdmUgPSAoZGVwdGgsIG1vdmUpID0+IHsNCiAgICBpZiAoZGVwdGggPCAwIHx8IGRlcHRoID49IGtpbGxlck1vdmVzLmxlbmd0aCB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGNvbnN0IHNsb3QgPSBraWxsZXJNb3Zlc1tkZXB0aF07DQogICAgaWYgKGlzU2FtZU1vdmUoc2xvdFswXSwgbW92ZSkpIHJldHVybjsNCiAgICBzbG90WzFdID0gc2xvdFswXTsNCiAgICBzbG90WzBdID0gaXNFbmNvZGVkTW92ZShtb3ZlKSA/IG1vdmUgOiBlbmNvZGVNb3ZlKG1vdmUuZnJvbSwgbW92ZS50byk7DQp9Ow0KDQpjb25zdCBhZGRIaXN0b3J5U2NvcmUgPSAobW92ZSwgZGVwdGgpID0+IHsNCiAgICBpZiAoIWhpc3RvcnlUYWJsZSB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGhpc3RvcnlUYWJsZVttb3ZlRnJvbVIobW92ZSldW21vdmVGcm9tQyhtb3ZlKV1bbW92ZVRvUihtb3ZlKV1bbW92ZVRvQyhtb3ZlKV0gKz0gZGVwdGggKiBkZXB0aDsNCn07DQoNCmNvbnN0IGdldEhpc3RvcnlTY29yZSA9IChtb3ZlKSA9PiB7DQogICAgaWYgKCFoaXN0b3J5VGFibGUgfHwgIW1vdmUpIHJldHVybiAwOw0KICAgIHJldHVybiBoaXN0b3J5VGFibGVbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldW21vdmVUb1IobW92ZSldW21vdmVUb0MobW92ZSldIHx8IDA7DQp9Ow0KDQovLyBXb3JrZXIgbWVzc2FnZSBoYW5kbGluZw0KaWYgKHR5cGVvZiBzZWxmICE9PSAndW5kZWZpbmVkJykgew0KICAgIHNlbGYub25tZXNzYWdlID0gZnVuY3Rpb24oZSkgew0KICAgIGNvbnN0IHsgdHlwZSwgcGF5bG9hZCB9ID0gZS5kYXRhOw0KICAgIA0KICAgIHN3aXRjaCAodHlwZSkgeyAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdTRUFSQ0gnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBzZWFyY2hCb2FyZCwgdHVybjogc2VhcmNoVHVybiwgZGVwdGg6IHNlYXJjaERlcHRoLCBnYW1lSWQsIG9wZW5pbmdCb29rRW5hYmxlZDogc2VhcmNoT3BlbmluZ0Jvb2tFbmFibGVkID0gdHJ1ZSwgcGx5OiBzZWFyY2hQbHkgPSAwLCBlbmFibGVUaW1lTGltaXQ6IHNlYXJjaEVuYWJsZVRpbWVMaW1pdCA9IGZhbHNlLCBleGFjdFJvb3RTY29yZXM6IHNlYXJjaEV4YWN0Um9vdFNjb3JlcyA9IGZhbHNlLCBwcm9maWxlOiBzZWFyY2hQcm9maWxlLCBjb2xsZWN0TW92ZVNlcXVlbmNlOiBzZWFyY2hDb2xsZWN0TW92ZVNlcXVlbmNlIH0gPSBwYXlsb2FkOwogICAgICAgICAgICBTRUFSQ0hfUFJPRklMRSA9ICEhc2VhcmNoUHJvZmlsZTsKICAgICAgICAgICAgLy8gU2V0IG9wZW5pbmcgYm9vayBlbmFibGVkIHN0YXR1cw0KICAgICAgICAgICAgb3BlbmluZ0Jvb2suc2V0RW5hYmxlZChzZWFyY2hPcGVuaW5nQm9va0VuYWJsZWQpOw0KICAgICAgICAgICAgLy8g6K6w5b2V5pCc57Si5byA5aeL5pe26Ze0DQogICAgICAgICAgICBjb25zdCBzdGFydFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKTsNCiAgICAgICAgICAgIC8vIOaJp+ihjOaQnOe0og0KICAgICAgICAgICAgY29uc3QgYmVzdFNlYXJjaE1vdmUgPSBnZXRCZXN0TW92ZShzZWFyY2hCb2FyZCwgc2VhcmNoVHVybiwgc2VhcmNoRGVwdGgsIHNlYXJjaFBseSwgc2VhcmNoRW5hYmxlVGltZUxpbWl0LCBzZWFyY2hFeGFjdFJvb3RTY29yZXMsIHNlYXJjaENvbGxlY3RNb3ZlU2VxdWVuY2UpOw0KICAgICAgICAgICAgLy8g6K6w5b2V5pCc57Si57uT5p2f5pe26Ze05bm26K6h566X5oCd6ICD5pe26Ze0DQogICAgICAgICAgICBjb25zdCBlbmRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCk7DQogICAgICAgICAgICBjb25zdCB0aGlua2luZ1RpbWUgPSBlbmRUaW1lIC0gc3RhcnRUaW1lOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmo4Dmn6XmmK/lkKbmnaXoh6rlvIDlsYDlupMNCiAgICAgICAgICAgIGNvbnN0IGJvb2tNb3ZlU2VhcmNoID0gb3BlbmluZ0Jvb2suZ2V0Qm9va01vdmUoc2VhcmNoQm9hcmQsIHNlYXJjaFBseSk7DQogICAgICAgICAgICBjb25zdCBmcm9tQm9va1NlYXJjaCA9ICEhYm9va01vdmVTZWFyY2ggJiYgSlNPTi5zdHJpbmdpZnkoYm9va01vdmVTZWFyY2gpID09PSBKU09OLnN0cmluZ2lmeShiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOa3u+WKoOaAp+iDvee7n+iuoeaXpeW/lw0KICAgICAgICAgICAgbG9nUGVyZlN0YXRzKHNlYXJjaFR1cm4pOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmt7vliqDmgJ3ogIPml7bpl7Tml6Xlv5cNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBTZWFyY2ggY29tcGxldGVkIGluICR7TWF0aC5yb3VuZCh0aGlua2luZ1RpbWUpfW1zLCBnYW1lSWQ9JHtnYW1lSWR9LCBiZXN0TW92ZT0ke0pTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlKX0sIHNlY29uZEJlc3RNb3ZlPSR7SlNPTi5zdHJpbmdpZnkoYmVzdFNlYXJjaE1vdmUuc2Vjb25kQmVzdE1vdmUpfSwgZnJvbUJvb2s9JHtmcm9tQm9va1NlYXJjaH1gKTsNCiAgICAgICAgICAgIC8vIOWPkemAgeaQnOe0oue7k+aenOWSjOaAneiAg+aXtumXtA0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7IA0KICAgICAgICAgICAgICAgIHR5cGU6ICdTRUFSQ0hfQ09NUExFVEUnLCANCiAgICAgICAgICAgICAgICBwYXlsb2FkOiB7IA0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZTogYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmUsIA0KICAgICAgICAgICAgICAgICAgICBzZWNvbmRCZXN0TW92ZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kQmVzdE1vdmUsIA0KICAgICAgICAgICAgICAgICAgICBnYW1lSWQsIA0KICAgICAgICAgICAgICAgICAgICBmcm9tQm9vazogZnJvbUJvb2tTZWFyY2gsIA0KICAgICAgICAgICAgICAgICAgICB0aGlua2luZ1RpbWU6IE1hdGgucm91bmQodGhpbmtpbmdUaW1lKSwgLy8g5Zub6IiN5LqU5YWl5Yiw5q+r56eSDQogICAgICAgICAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogYmVzdFNlYXJjaE1vdmUubW92ZVNlcXVlbmNlLA0KICAgICAgICAgICAgICAgICAgICBzZWNvbmRNb3ZlU2VxdWVuY2U6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZE1vdmVTZXF1ZW5jZSwNCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTY29yZTogYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmVTY29yZSwNCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kQmVzdE1vdmVTY29yZTogYmVzdFNlYXJjaE1vdmUuc2Vjb25kQmVzdE1vdmVTY29yZSwNCiAgICAgICAgICAgICAgICAgICAgYWxsTW92ZXNXaXRoU2NvcmVzOiBiZXN0U2VhcmNoTW92ZS5hbGxNb3Zlc1dpdGhTY29yZXMgfHwgW10sDQogICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlZERlcHRoOiBiZXN0U2VhcmNoTW92ZS5jb21wbGV0ZWREZXB0aCwNCiAgICAgICAgICAgICAgICAgICAgcGVyZjogc25hcHNob3RQZXJmU3RhdHMoKQ0KICAgICAgICAgICAgICAgIH0gDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGNhc2UgJ2dldFZhbGlkTW92ZXMnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiB2bUJvYXJkLCBwb3M6IHZtUG9zIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgc3luY0dlbmVyYWxQb3NDYWNoZSh2bUJvYXJkKTsNCiAgICAgICAgICAgIGNvbnN0IHZhbGlkTW92ZXMgPSBnZXRWYWxpZE1vdmVzKHZtQm9hcmQsIHZtUG9zKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICd2YWxpZE1vdmVzJywNCiAgICAgICAgICAgICAgICBtb3ZlczogdmFsaWRNb3Zlcw0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2dldFBpZWNlUmVsYXRpb25zJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogcHJCb2FyZCwgcG9zOiBwclBvcyB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gcHJCb2FyZFtwclBvcy5yXVtwclBvcy5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g6LCD55SoZXZhbHVhdGVCb2FyZOiOt+WPluWujOaVtOeahOaji+WtkOS/oeaBr+WSjGJvYXJkSW5mbw0KICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoKTsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRFdmFsdWF0aW9uID0gZXZhbHVhdGVCb2FyZChwckJvYXJkLCBudWxsLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgY29uc3QgcGllY2VzSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5waWVjZXNJbmZvOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRJbmZvID0gYm9hcmRFdmFsdWF0aW9uLmJvYXJkSW5mbzsNCg0KICAgICAgICAgICAgaWYgKGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKSB7DQogICAgICAgICAgICAgICAgaHlkcmF0ZVJlbGF0aW9uc0Zyb21NYXNrcyhwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBib2FyZEluZm8g5qC85YaF5Y+v6IO95pivIHBpZWNlc0luZm8g5byV55So77yM57uf5LiA5pig5bCE5Li6IHtyLGN9IOS+myBVSSDkvb/nlKgNCiAgICAgICAgICAgIGNvbnN0IHJhd0NvbnRyb2xsZXJzID0gYm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkDQogICAgICAgICAgICAgICAgPyAoYm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkW3ByUG9zLnJdW3ByUG9zLmNdIHx8IFtdKQ0KICAgICAgICAgICAgICAgIDogKGJvYXJkSW5mb1twclBvcy5yXSAmJiBib2FyZEluZm9bcHJQb3Mucl1bcHJQb3MuY10pIHx8IFtdOw0KICAgICAgICAgICAgY29uc3QgY29udHJvbGxlcnMgPSByYXdDb250cm9sbGVycy5tYXAoKGN0cmwpID0+ICh7IHI6IGN0cmwuciwgYzogY3RybC5jIH0pKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgbGV0IHJlbGF0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLCANCiAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnk6IFtdLCANCiAgICAgICAgICAgICAgICBndWFyZDogW10sIA0KICAgICAgICAgICAgICAgIGd1YXJkZWRCeTogW10sIA0KICAgICAgICAgICAgICAgIGNvbnRyb2w6IFtdLA0KICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJzDQogICAgICAgICAgICB9Ow0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDlpoLmnpzngrnlh7vnmoTmmK/mo4vlrZDvvIzov5Tlm57or6Xmo4vlrZDnmoTlhbPns7vkv6Hmga8NCiAgICAgICAgICAgIGlmIChwaWVjZSkgew0KICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIGN1cnJlbnQgcGllY2UgaW5mbw0KICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRQaWVjZUluZm8gPSBwaWVjZXNJbmZvLmZpbmQocCA9PiBwLnIgPT09IHByUG9zLnIgJiYgcC5jID09PSBwclBvcy5jKTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoY3VycmVudFBpZWNlSW5mbykgew0KICAgICAgICAgICAgICAgICAgICAvLyBFeHRyYWN0IHJlbGF0aW9ucw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0aHJlYXQgPSBjdXJyZW50UGllY2VJbmZvLnRocmVhdC5tYXAodGhyZWF0UGllY2UgPT4gKHsgcjogdGhyZWF0UGllY2UuciwgYzogdGhyZWF0UGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRocmVhdGVuZWRCeSA9IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0ZW5lZEJ5Lm1hcCh0aHJlYXRlbmVkQnlQaWVjZSA9PiAoeyByOiB0aHJlYXRlbmVkQnlQaWVjZS5yLCBjOiB0aHJlYXRlbmVkQnlQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZ3VhcmQgPSBjdXJyZW50UGllY2VJbmZvLmd1YXJkLm1hcChndWFyZFBpZWNlID0+ICh7IHI6IGd1YXJkUGllY2UuciwgYzogZ3VhcmRQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZ3VhcmRlZEJ5ID0gY3VycmVudFBpZWNlSW5mby5ndWFyZGVkQnkubWFwKGd1YXJkZWRCeVBpZWNlID0+ICh7IHI6IGd1YXJkZWRCeVBpZWNlLnIsIGM6IGd1YXJkZWRCeVBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sID0gKGN1cnJlbnRQaWVjZUluZm8uY29udHJvbCB8fCBbXSkubWFwKGNvbnRyb2xQb3MgPT4gKHsgcjogY29udHJvbFBvcy5yLCBjOiBjb250cm9sUG9zLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25zID0gew0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0LCANCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeSwgDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZCwgDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZGVkQnksIA0KICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbCwNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJzDQogICAgICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VSZWxhdGlvbnMnLA0KICAgICAgICAgICAgICAgIHJlbGF0aW9uczogcmVsYXRpb25zDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnY2hlY2tHYW1lU3RhdGUnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBjZ3NCb2FyZCwgdHVybjogY2dzVHVybiwgcmVxdWVzdElkIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3QgZ2FtZVN0YXRlID0gY2hlY2tHYW1lU3RhdGUoY2dzQm9hcmQsIGNnc1R1cm4pOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2dhbWVTdGF0ZScsDQogICAgICAgICAgICAgICAgc3RhdGU6IGdhbWVTdGF0ZSwNCiAgICAgICAgICAgICAgICByZXF1ZXN0SWQNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdldmFsdWF0ZUJvYXJkJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogZXZhbEJvYXJkLCB0dXJuOiBldmFsVHVybiB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIC8vIOaJk+WNsOaOpeaUtueahOWPguaVsA0KICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoKTsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KICAgICAgICAgICAgY29uc3QgZGV0YWlsZWRFdmFsID0gZXZhbHVhdGVCb2FyZChldmFsQm9hcmQsIGV2YWxUdXJuLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2RldGFpbGVkRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZGV0YWlsZWRFdmFsDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQoNCiAgICAgICAgY2FzZSAnZXZhbHVhdGVQaWVjZSc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHBpZWNlRXZhbEJvYXJkLCBwb3M6IHBpZWNlRXZhbFBvcywgdHVybiB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gcGllY2VFdmFsQm9hcmRbcGllY2VFdmFsUG9zLnJdW3BpZWNlRXZhbFBvcy5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFwaWVjZSkgew0KICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogew0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiAwDQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQogICAgICAgICAgICBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyDkuLvliqjosIPnlKhldmFsdWF0ZUJvYXJk6I635Y+W5a6M5pW055qE6K+E5Lyw5L+h5oGvDQogICAgICAgICAgICAgICAgLy8g6I635Y+W5b2T5YmN5ri45oiP6Zi25q61DQogICAgICAgICAgICAgICAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoKTsNCiAgICAgICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkRXZhbHVhdGlvbiA9IGV2YWx1YXRlQm9hcmQocGllY2VFdmFsQm9hcmQsIHR1cm4sIGdhbWVTdGFnZSk7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgLy8g5LuOZXZhbHVhdGVCb2FyZOeahOi/lOWbnuWAvOS4reaJvuWIsOW9k+WJjeaji+WtkOeahOS/oeaBrw0KICAgICAgICAgICAgICAgIGN1cnJlbnRQaWVjZUluZm8gPSBib2FyZEV2YWx1YXRpb24ucGllY2VzSW5mby5maW5kKA0KICAgICAgICAgICAgICAgICAgICBwID0+IHAuciA9PT0gcGllY2VFdmFsUG9zLnIgJiYgcC5jID09PSBwaWVjZUV2YWxQb3MuYw0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRQaWVjZUluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5bqU55So5p2D6YeN5bm26L+U5Zue5Y2V5Liq5qOL5a2Q55qE6K+E5Lyw5YC8DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGV2YWx1YXRpb24gPSB7DQogICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogY3VycmVudFBpZWNlSW5mby5tYXRlcmlhbFZhbHVlICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiBjdXJyZW50UGllY2VJbmZvLnBvc2l0aW9uVmFsdWUgKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLA0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHk6IGN1cnJlbnRQaWVjZUluZm8ubW9iaWxpdHlWYWx1ZSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHksDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IGN1cnJlbnRQaWVjZUluZm8udGhyZWF0VmFsdWUgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogY3VycmVudFBpZWNlSW5mby5zYWZldHlWYWx1ZSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiBjdXJyZW50UGllY2VJbmZvLnRhY3RpY1ZhbHVlICogVkFMVUVfV0VJR0hUUy50YWN0aWMNCiAgICAgICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgICAgICAgICBldmFsdWF0aW9uOiBldmFsdWF0aW9uDQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWmguaenOS7jeeEtuaJvuS4jeWIsOaji+WtkOS/oeaBr++8jOi/lOWbnum7mOiupOWAvA0KICAgICAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljOiAwDQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdpc0NoZWNrJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogY0JvYXJkLCBjb2xvcjogY0NvbG9yLCByZXF1ZXN0SWQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBzeW5jR2VuZXJhbFBvc0NhY2hlKGNCb2FyZCk7DQogICAgICAgICAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVjayhjQm9hcmQsIGNDb2xvcik7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAnY2hlY2snLA0KICAgICAgICAgICAgICAgIGlzQ2hlY2s6IGluQ2hlY2ssDQogICAgICAgICAgICAgICAgcmVxdWVzdElkDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnaXNWYWxpZFBsYWNlbWVudCc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgdHlwZTogaXBUeXBlLCBjb2xvcjogaXBDb2xvciwgciwgYyB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IHZhbGlkUGxhY2VtZW50ID0gaXNWYWxpZFBsYWNlbWVudChpcFR5cGUsIGlwQ29sb3IsIHIsIGMpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ3ZhbGlkUGxhY2VtZW50JywNCiAgICAgICAgICAgICAgICBpc1ZhbGlkOiB2YWxpZFBsYWNlbWVudA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2FkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgbW92ZXMsIHdlaWdodHMgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICAvLyBBZGQgdGhlIG9wZW5pbmcgbGluZSB0byB0aGUgb3BlbmluZyBib29rDQogICAgICAgICAgICBvcGVuaW5nQm9vay5hZGRPcGVuaW5nTGluZUZyb21TdHJpbmcoW21vdmVzXSwgd2VpZ2h0cyk7DQogICAgICAgICAgICAvLyBTZW5kIGNvbmZpcm1hdGlvbg0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7IA0KICAgICAgICAgICAgICAgIHR5cGU6ICdvcGVuaW5nTGluZUFkZGVkJywgDQogICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSANCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdtb3Zlc1RvTm90YXRpb24nOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBub3RhdGlvbiA9IG9wZW5pbmdCb29rLm1vdmVzVG9Ob3RhdGlvbihib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5KTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnbm90YXRpb24nLCANCiAgICAgICAgICAgICAgICBub3RhdGlvbjogbm90YXRpb24gDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnbm90YXRpb25Ub01vdmVzJzogew0KICAgICAgICAgICAgY29uc3QgeyBub3RhdGlvbjogbm90YXRpb25TdHJpbmcsIGluaXRpYWxCb2FyZCB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzRnJvbU5vdGF0aW9uID0gb3BlbmluZ0Jvb2subm90YXRpb25Ub01vdmVzKG5vdGF0aW9uU3RyaW5nLCBpbml0aWFsQm9hcmQpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7IA0KICAgICAgICAgICAgICAgIHR5cGU6ICdtb3ZlcycsIA0KICAgICAgICAgICAgICAgIG1vdmVzOiBtb3Zlc0Zyb21Ob3RhdGlvbiANCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdzZXRWYWx1ZVdlaWdodHMnOiB7DQogICAgICAgICAgICBWQUxVRV9XRUlHSFRTID0geyAuLi5WQUxVRV9XRUlHSFRTLCAuLi5wYXlsb2FkIH07DQogICAgICAgICAgICBjb25zb2xlLmxvZygnVXBkYXRlZCBWQUxVRV9XRUlHSFRTOicsIFZBTFVFX1dFSUdIVFMpOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQp9Ow0KDQogICAgLy8gT3ZlcnJpZGUgY29uc29sZS5sb2cgdG8gc2VuZCBtZXNzYWdlcyBiYWNrIHRvIG1haW4gdGhyZWFkDQogICAgY29uc3Qgb3JpZ2luYWxDb25zb2xlTG9nID0gY29uc29sZS5sb2c7DQogICAgY29uc29sZS5sb2cgPSBmdW5jdGlvbiguLi5hcmdzKSB7DQogICAgICAgIC8vIFNlbmQgdG8gbWFpbiB0aHJlYWQNCiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICB0eXBlOiAnbG9nJywNCiAgICAgICAgICAgIGRhdGE6IGFyZ3Muam9pbignICcpDQogICAgICAgIH0pOw0KICAgICAgICANCiAgICAgICAgLy8gQWxzbyBsb2cgdG8gd29ya2VyIGNvbnNvbGUNCiAgICAgICAgb3JpZ2luYWxDb25zb2xlTG9nLmFwcGx5KGNvbnNvbGUsIGFyZ3MpOw0KICAgIH07DQp9DQoNCi8vIOepuuedgOWJquaene+8muaciei/m+aUu+WtkOWKm+aXtuaJjeWFgeiuuO+8iOmBv+WFjeWwhi/lo6sv6LGh5q6L5bGA6YC8552A6K+v5Ymq77yJDQpjb25zdCBjYW5Eb051bGxNb3ZlID0gKGJvYXJkLCBjb2xvcikgPT4gew0KICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAoIXAgfHwgcC5jb2xvciAhPT0gY29sb3IpIGNvbnRpbnVlOw0KICAgICAgICAgICAgaWYgKHAudHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHAudHlwZSA9PT0gJ2hvcnNlJyB8fCBwLnR5cGUgPT09ICdjYW5ub24nIHx8IHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgcmV0dXJuIGZhbHNlOw0KfTsNCg0KLy8g5pCc57Si55SoIFRUIGtlee+8muWinumHj+aooeW8j+S4uiBudW1iZXLvvIzml6fmqKHlvI/kuLogYCR7aGFzaH06JHtzaWRlfWAg5a2X56ym5LiyDQpjb25zdCBtYWtlU2VhcmNoVFRLZXkgPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSGFzaCkgPT4gewogICAgcmV0dXJuIHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChib2FyZEhhc2gsIGN1cnJlbnRQbGF5ZXIpOwp9OwoNCi8vIOi1sOWtkOWQjueahOWtkOiKgueCueWxgOmdouWTiOW4jO+8iOS7heWinumHj+aooeW8j+acieaEj+S5ie+8m+mhu+WcqCBtYWtlIOWJjeS/neWtmCBtb3ZpbmdQaWVjZe+8iQ0KY29uc3QgY2hpbGRCb2FyZEhhc2ggPSAoYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpID0+IHsKICAgIHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzKys7CiAgICBpZiAoaXNFbmNvZGVkTW92ZShtb3ZlKSkgewogICAgICAgIGxldCBuZXdIYXNoID0gYm9hcmRIYXNoOwogICAgICAgIGNvbnN0IG1vdmluZ0lkeCA9IHpvYnJpc3RIYXNoZXIucGllY2VJbmRleChtb3ZpbmdQaWVjZSk7CiAgICAgICAgY29uc3QgZnJvbSA9IG1vdmUgPj4+IDc7DQogICAgICAgIGNvbnN0IHRvID0gbW92ZSAmIE1PVkVfVE9fTUFTSzsNCiAgICAgICAgaWYgKG1vdmluZ0lkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICBuZXdIYXNoIF49IHpvYnJpc3RIYXNoZXIuaGFzaFRhYmxlWyhmcm9tIC8gOSkgfCAwXVtmcm9tICUgOV1bbW92aW5nSWR4XTsNCiAgICAgICAgICAgIG5ld0hhc2ggXj0gem9icmlzdEhhc2hlci5oYXNoVGFibGVbKHRvIC8gOSkgfCAwXVt0byAlIDldW21vdmluZ0lkeF07DQogICAgICAgIH0NCiAgICAgICAgaWYgKGNhcHR1cmVkKSB7DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZElkeCA9IHpvYnJpc3RIYXNoZXIucGllY2VJbmRleChjYXB0dXJlZCk7DQogICAgICAgICAgICBpZiAoY2FwdHVyZWRJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgIG5ld0hhc2ggXj0gem9icmlzdEhhc2hlci5oYXNoVGFibGVbKHRvIC8gOSkgfCAwXVt0byAlIDldW2NhcHR1cmVkSWR4XTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gbmV3SGFzaDsNCiAgICB9DQogICAgcmV0dXJuIHpvYnJpc3RIYXNoZXIudXBkYXRlSGFzaChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7DQp9Ow0KDQovLyDmkJzntKLnlKjlh4DliIbvvJrlrozmlbTlvaLlir/or4TkvLDvvIjlhbPns7sv5aiB6IOBL+WuieWFqC/mnLrliqjvvInvvIzku4Xot7Pov4fnu4jlsYDnnYDms5XmnprkuL7vvJvluKYgWm9icmlzdCDnvJPlrZgNCmNvbnN0IHN0YXRpY1NlYXJjaEV2YWwgPSAoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBib2FyZEhhc2ggPSAwKSA9PiB7DQogICAgY29uc3QgY2FjaGVLZXkgPSB6b2JyaXN0SGFzaGVyLmV2YWxDYWNoZUtleUZyb21IYXNoKGJvYXJkSGFzaCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpOwogICAgaWYgKGV2YWxDYWNoZS5oYXMoY2FjaGVLZXkpKSB7CiAgICAgICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlSGl0cysrOwogICAgICAgIHJldHVybiBldmFsQ2FjaGUuZ2V0KGNhY2hlS2V5KTsKICAgIH0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnN0YXRpY0V2YWxDYWNoZU1pc3NlcysrOwogICAgbGV0IG5ldDsKICAgIGlmICghU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgewogICAgICAgIG5ldCA9IGV2YWx1YXRlU2VhcmNoTGVhZkZhc3QoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsKICAgIH0gZWxzZSB7CiAgICAgICAgY29uc3QgZXZhbFJlc3VsdCA9IGV2YWx1YXRlQm9hcmQoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB7IGZvclNlYXJjaExlYWY6IHRydWUgfSk7CiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBzZWFyY2hJbml0aWF0b3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgIG5ldCA9IGV2YWxSZXN1bHRbc2VhcmNoSW5pdGlhdG9yXS50b3RhbCAtIGV2YWxSZXN1bHRbb3Bwb25lbnRdLnRvdGFsOwogICAgfQogICAgaWYgKGV2YWxDYWNoZS5zaXplID49IEVWQUxfQ0FDSEVfTUFYKSB7CiAgICAgICAgLy8g566A5Y2V5reY5rGw5pyA5pep5YaZ5YWl55qE5LiA5om577yM6YG/5YWNIE1hcCDml6DpmZDmtqgNCiAgICAgICAgbGV0IGRyb3AgPSAwOw0KICAgICAgICBmb3IgKGNvbnN0IGsgb2YgZXZhbENhY2hlLmtleXMoKSkgew0KICAgICAgICAgICAgZXZhbENhY2hlLmRlbGV0ZShrKTsNCiAgICAgICAgICAgIGlmICgrK2Ryb3AgPj0gNDA5NikgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQogICAgZXZhbENhY2hlLnNldChjYWNoZUtleSwgbmV0KTsKICAgIHJldHVybiBuZXQ7DQp9Ow0KDQovLyDnlJ/miJDlvZPliY3mlrnlkIPlrZDnnYDvvIjkvpvpnZnpu5jmkJzntKLvvIkNCmNvbnN0IGdlbmVyYXRlQ2FwdHVyZXNGb3JTZWFyY2ggPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIpID0+IHsKICAgIGNvbnN0IF9fdDAgPSBTRUFSQ0hfUFJPRklMRSA/IHBlcmZvcm1hbmNlLm5vdygpIDogMDsKICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLmNhcHR1cmVHZW5Db3VudCsrOwogICAgY29uc3QgY2FwdHVyZXMgPSBbXTsKICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsKICAgIGlmIChwaWVjZVN0YXRlKSB7CiAgICAgICAgY29uc3QgcmVjb3JkcyA9IHBpZWNlU3RhdGUucmVjb3JkczsKICAgICAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsKICAgICAgICBjb25zdCBzcXVhcmVDb2RlcyA9IHBpZWNlU3RhdGUuc3F1YXJlQ29kZXM7CiAgICAgICAgY29uc3QgcGllY2VDb2RlcyA9IHBpZWNlU3RhdGUucGllY2VDb2RlczsKICAgICAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsKICAgICAgICAgICAgY29uc3Qgc2xvdCA9IHNxdWFyZVRvU2xvdFtzcV07CiAgICAgICAgICAgIGlmIChzbG90IDwgMCkgY29udGludWU7CiAgICAgICAgICAgIGNvbnN0IHJlY29yZCA9IHJlY29yZHNbc2xvdF07CiAgICAgICAgICAgIGlmICghcmVjb3JkLmFsaXZlIHx8IHJlY29yZC5waWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7CiAgICAgICAgICAgIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCArPSBhcHBlbmRTZWFyY2hQc2V1ZG9Nb3Zlc0ZvclBpZWNlKAogICAgICAgICAgICAgICAgY2FwdHVyZXMsIHNxLCBwaWVjZUNvZGVzW3Nsb3RdLCBzcXVhcmVDb2RlcywgdHJ1ZQogICAgICAgICAgICApOwogICAgICAgIH0KICAgICAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5jYXB0dXJlR2VuTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOwogICAgICAgIHJldHVybiBjYXB0dXJlczsKICAgIH0KICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7CiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsKICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsKICAgICAgICAgICAgaWYgKCFwaWVjZSB8fCBwaWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7CiAgICAgICAgICAgIGNvbnN0IGZyb20gPSB7IHIsIGMgfTsKICAgICAgICAgICAgY29uc3QgcHNldWRvID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UpOwogICAgICAgICAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgKz0gcHNldWRvLmxlbmd0aDsKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwc2V1ZG8ubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IHRvID0gcHNldWRvW2ldOwogICAgICAgICAgICAgICAgaWYgKGJvYXJkW3RvLnJdW3RvLmNdKSBjYXB0dXJlcy5wdXNoKGVuY29kZU1vdmVGcm9tQ29vcmRzKHIsIGMsIHRvLnIsIHRvLmMpKTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLmNhcHR1cmVHZW5NcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7CiAgICByZXR1cm4gY2FwdHVyZXM7Cn07Cg0KLy8g6Z2Z6buY5pCc57Si77yac3RhbmQtcGF0IOeUqOWujOaVtOW9ouWKv+ivhOS8sO+8m+S7heWvueWQg+WtkOW7tuS8uO+8iFFT4omkM++8iQ0KY29uc3QgcXVpZXNjZW5jZSA9ICgNCiAgICBiLCBhbHBoYSwgYmV0YSwgbWF4aW1pemluZywgY3VycmVudFBsYXllciwNCiAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgcXNEZXB0aCwgYm9hcmRIYXNoID0gMA0KKSA9PiB7CiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5xdWllc2NlbmNlQ2FsbHMrKzsKICAgIGNvbnN0IHN0YW5kUGF0ID0gc3RhdGljU2VhcmNoRXZhbChiLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRIYXNoKTsNCg0KICAgIGlmIChxc0RlcHRoIDw9IDApIHsNCiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KDQogICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0ID49IGJldGEpIHsNCiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICB9DQogICAgICAgIGlmIChzdGFuZFBhdCA+IGFscGhhKSB7DQogICAgICAgICAgICBhbHBoYSA9IHN0YW5kUGF0Ow0KICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0IDw9IGFscGhhKSB7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoc3RhbmRQYXQgPCBiZXRhKSB7DQogICAgICAgICAgICBiZXRhID0gc3RhbmRQYXQ7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBsZXQgY2FwdHVyZXMgPSBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoKGIsIGN1cnJlbnRQbGF5ZXIpOwogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMucXVpZXNjZW5jZUNhcHR1cmVNb3ZlcyArPSBjYXB0dXJlcy5sZW5ndGg7CiAgICBpZiAoY2FwdHVyZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgIH0NCg0KICAgIC8vIE1WVi1MVkHvvJrlhYjor5XlkIPlpKflrZANCiAgICBjYXB0dXJlcy5zb3J0KChhLCBiTW92ZSkgPT4gew0KICAgICAgICBjb25zdCBzY29yZUEgPQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW21vdmVUb1IoYSldW21vdmVUb0MoYSldLCBnYW1lU3RhZ2UpICogMTYgLQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW21vdmVGcm9tUihhKV1bbW92ZUZyb21DKGEpXSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgY29uc3Qgc2NvcmVCID0NCiAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYlttb3ZlVG9SKGJNb3ZlKV1bbW92ZVRvQyhiTW92ZSldLCBnYW1lU3RhZ2UpICogMTYgLQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW21vdmVGcm9tUihiTW92ZSldW21vdmVGcm9tQyhiTW92ZSldLCBnYW1lU3RhZ2UpOw0KICAgICAgICByZXR1cm4gc2NvcmVCIC0gc2NvcmVBOw0KICAgIH0pOw0KDQogICAgbGV0IGJlc3RFdmFsID0gc3RhbmRQYXQ7DQogICAgbGV0IGJlc3RNb3ZlU2VxdWVuY2UgPSBbXTsNCg0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY2FwdHVyZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgbW92ZSA9IGNhcHR1cmVzW2ldOw0KICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldOw0KICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUpOw0KICAgICAgICBpZiAobGVhdmVzT3duS2luZ1Vuc2FmZShiLCBjdXJyZW50UGxheWVyKSkgewogICAgICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkKys7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgICAgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCsrOw0KICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCByZXN1bHQgPSBxdWllc2NlbmNlKA0KICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLA0KICAgICAgICAgICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGggLSAxLCBuZXh0SGFzaA0KICAgICAgICApOw0KICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCg0KICAgICAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsNCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlVG9PYmplY3QobW92ZSksIC4uLihyZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGFscGhhKSB7DQogICAgICAgICAgICAgICAgYWxwaGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4uKHJlc3VsdC5tb3ZlU2VxdWVuY2UgfHwgW10pXTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmV0YSkgew0KICAgICAgICAgICAgICAgIGJldGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPyBiZXN0TW92ZVNlcXVlbmNlIDogW10gfTsNCn07DQoNCi8vIGFscGhhQmV0Ye+8muivhOS8sOWni+e7iOS7jiBzZWFyY2hJbml0aWF0b3Ig6KeS5bqm77ybVFQgKyBraWxsZXIvaGlzdG9yeSArIOepuuedgOWJquaenSArIExNUiArIFFTDQovLyBib2FyZEhhc2jvvJrlop7ph48gWm9icmlzdCDlsYDpnaLlk4jluIzvvIjkuI3lkKvooYzmo4vmlrnvvInvvJvml6fmqKHlvI/kuIvlj6/kvKAgMA0KY29uc3QgYWxwaGFCZXRhID0gKA0KICAgIGIsIGQsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLA0KICAgIHNlYXJjaERlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gY3VycmVudFBsYXllciwgZ2FtZVN0YWdlID0gJ21pZCcsDQogICAgYWxsb3dOdWxsID0gdHJ1ZSwgYm9hcmRIYXNoID0gMA0KKSA9PiB7DQogICAgY29uc3Qgb3JpZ2luYWxBbHBoYSA9IGFscGhhOw0KICAgIGNvbnN0IG9yaWdpbmFsQmV0YSA9IGJldGE7DQoNCiAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMrKzsNCiAgICBpZiAoIXBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKSBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSA9IDA7DQogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0rKzsNCg0KICAgIC8vIOWPtuiKgueCue+8muWujOaVtOW9ouWKv+ivhOS8sCArIOWQg+WtkOmdmem7mOaQnOe0ou+8iFFT4omkM++8iQ0KICAgIGlmIChkID09PSAwKSB7DQogICAgICAgIHJldHVybiBxdWllc2NlbmNlKA0KICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgMywgYm9hcmRIYXNoDQogICAgICAgICk7DQogICAgfQ0KDQogICAgLy8g572u5o2i6KGo5o6i5rWL77yIa2V5IOWQq+ihjOaji+aWue+8jOmBv+WFjeWQjOW9ouS4jeWQjOi1sOaWueWGsueqge+8iQ0KICAgIGNvbnN0IHR0S2V5ID0gbWFrZVNlYXJjaFRUS2V5KGIsIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSGFzaCk7DQogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZSh0dEtleSk7DQogICAgbGV0IHR0TW92ZSA9IG51bGw7DQogICAgaWYgKHR0RW50cnkpIHsNCiAgICAgICAgdHRNb3ZlID0gdHRFbnRyeS5iZXN0TW92ZSB8fCBudWxsOw0KICAgICAgICBpZiAodHRFbnRyeS5kZXB0aCA+PSBkKSB7DQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnZXhhY3QnKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHR0RW50cnkudmFsdWUsDQogICAgICAgICAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRQ0KICAgICAgICAgICAgICAgICAgICAgICAgPyAodHRFbnRyeS5tb3ZlU2VxdWVuY2UgfHwgKHR0TW92ZSA/IFttb3ZlVG9PYmplY3QodHRNb3ZlKV0gOiBbXSkpDQogICAgICAgICAgICAgICAgICAgICAgICA6IFtdDQogICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICdsb3dlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlID49IGJldGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ3VwcGVyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3Qgc2VhcmNoSW5mbyA9IHByZXBhcmVTZWFyY2hJbmZvKGIsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIGNvbnN0IGFiUGllY2VzSW5mbyA9IHNlYXJjaEluZm8ucGllY2VzSW5mbzsNCiAgICBjb25zdCBhYkJvYXJkSW5mbyA9IHNlYXJjaEluZm8uYm9hcmRJbmZvOw0KICAgIGNvbnN0IGN1cnJlbnRQbGF5ZXJDb2xvciA9IGN1cnJlbnRQbGF5ZXI7DQogICAgY29uc3QgaW5DaGVjayA9IHNlYXJjaEluZm8uaW5DaGVjayB8fA0KICAgICAgICAgICAgICAgICAgICAoY3VycmVudFBsYXllckNvbG9yID09PSAncmVkJyAmJiBhYkJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8DQogICAgICAgICAgICAgICAgICAgIChjdXJyZW50UGxheWVyQ29sb3IgPT09ICdibGFjaycgJiYgYWJCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOw0KDQogICAgY29uc3QgdGVybWluYWxTY29yZSA9IChtYXRlSW5DaGVjaykgPT4gew0KICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGN1cnJlbnRQbGF5ZXJDb2xvciAhPT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7DQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICB2YWx1ZTogYmFzZVNjb3JlICsgKGlzSW5pdGlhdG9yV2lubmVyID8gZCA6IChzZWFyY2hEZXB0aCAtIGQpKSwNCiAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogW10sDQogICAgICAgICAgICB0ZXJtaW5hbDogbWF0ZUluQ2hlY2sgPyAnY2hlY2ttYXRlJyA6ICdzdGFsZW1hdGUnDQogICAgICAgIH07DQogICAgfTsNCg0KICAgIC8vIOaXoOS8quWQiOazleedgO+8muebtOaOpee7iOWxgO+8iOaegeWwkeinge+8m+mAmuW4uOiHs+WwkeacieWwhueahOi1sOWKqO+8iQ0KICAgIGlmICghc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0IHx8IHNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdC5sZW5ndGggPT09IDApIHsNCiAgICAgICAgY29uc3QgZ2FtZVN0YXRlID0gYWJCb2FyZEluZm8uZ2FtZVN0YXRlOw0KICAgICAgICBpZiAoZ2FtZVN0YXRlICYmIChnYW1lU3RhdGUuc3RhdHVzID09PSAnY2hlY2ttYXRlJyB8fCBnYW1lU3RhdGUuc3RhdHVzID09PSAnc3RhbGVtYXRlJykpIHsNCiAgICAgICAgICAgIGNvbnN0IGlzSW5pdGlhdG9yV2lubmVyID0gZ2FtZVN0YXRlLndpbm5lciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICAgICAgY29uc3QgYmFzZVNjb3JlID0gaXNJbml0aWF0b3JXaW5uZXIgPyAxMDAwMDAgOiAtMTAwMDAwOw0KICAgICAgICAgICAgY29uc3Qgc3RlcHNGcm9tUm9vdCA9IHNlYXJjaERlcHRoIC0gZDsNCiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogc3RlcHNGcm9tUm9vdCksIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gdGVybWluYWxTY29yZShpbkNoZWNrKTsNCiAgICB9DQoNCiAgICAvLyDnqbrnnYDliarmnp3vvJrku4UgbWF4aW1pemluZ++8m+WujOaVtOivhOS8sOS4i+S/neWuiOWQr+eUqA0KICAgIGlmICgNCiAgICAgICAgZmFsc2UgJiYKICAgICAgICBhbGxvd051bGwgJiYNCiAgICAgICAgbWF4aW1pemluZyAmJg0KICAgICAgICBkID49IDMgJiYNCiAgICAgICAgIWluQ2hlY2sgJiYNCiAgICAgICAgY2FuRG9OdWxsTW92ZShiLCBjdXJyZW50UGxheWVyQ29sb3IpDQogICAgKSB7DQogICAgICAgIGNvbnN0IG51bGxSID0gZCA+PSA2ID8gMyA6IDI7DQogICAgICAgIGNvbnN0IG51bGxEZXB0aCA9IGQgLSAxIC0gbnVsbFI7DQogICAgICAgIGlmIChudWxsRGVwdGggPj0gMCkgew0KICAgICAgICAgICAgY29uc3QgbnVsbFBsYXllciA9IGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgICAgICBjb25zdCBudWxsTWF4aW1pemluZyA9IG51bGxQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgICAgIC8vIOepuuedgOS4jeaUueWPmOWxgOmdouWTiOW4jO+8jOS7heihjOaji+aWueWPmOWMlu+8iFRUIGtleSDlkKsgc2lkZe+8iQ0KICAgICAgICAgICAgY29uc3QgbnVsbFJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgICBiLCBudWxsRGVwdGgsIGJldGEgLSAxZS02LCBiZXRhLCBudWxsTWF4aW1pemluZywgbnVsbFBsYXllciwNCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGZhbHNlLCBib2FyZEhhc2gNCiAgICAgICAgICAgICk7DQogICAgICAgICAgICBpZiAobnVsbFJlc3VsdC52YWx1ZSA+PSBiZXRhKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IG51bGxSZXN1bHQudmFsdWUsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGxldCBtb3ZlcyA9IHNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdDsNCg0KICAgIGlmICghcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdKSBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gPSAwOw0KICAgIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSArPSBtb3Zlcy5sZW5ndGg7DQoNCiAgICBjb25zdCBraWxsZXJzQXREZXB0aCA9IChraWxsZXJNb3Zlc1tkXSB8fCBbbnVsbCwgbnVsbF0pOw0KICAgIG1vdmVzID0gc29ydE1vdmVzRmFzdChtb3ZlcywgYiwgY3VycmVudFBsYXllckNvbG9yLCBhYlBpZWNlc0luZm8sIGdhbWVTdGFnZSwgYWJCb2FyZEluZm8sIHsNCiAgICAgICAgdHRNb3ZlLA0KICAgICAgICBraWxsZXJzOiBraWxsZXJzQXREZXB0aA0KICAgIH0pOw0KDQogICAgY29uc3Qgc3RvcmVUVCA9ICh2YWx1ZSwgYmVzdE1vdmUsIG1vdmVTZXF1ZW5jZSkgPT4gew0KICAgICAgICBsZXQgZmxhZzsNCiAgICAgICAgaWYgKHZhbHVlIDw9IG9yaWdpbmFsQWxwaGEpIGZsYWcgPSAndXBwZXJib3VuZCc7DQogICAgICAgIGVsc2UgaWYgKHZhbHVlID49IG9yaWdpbmFsQmV0YSkgZmxhZyA9ICdsb3dlcmJvdW5kJzsNCiAgICAgICAgZWxzZSBmbGFnID0gJ2V4YWN0JzsNCiAgICAgICAgdHJhbnNwb3NpdGlvblRhYmxlLnN0b3JlKHR0S2V5LCBkLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUsIFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPyBtb3ZlU2VxdWVuY2UgOiBudWxsKTsNCiAgICB9Ow0KDQogICAgbGV0IGJlc3RFdmFsID0gbWF4aW1pemluZyA/IC1JbmZpbml0eSA6IEluZmluaXR5Ow0KICAgIGxldCBiZXN0TW92ZSA9IG51bGw7DQogICAgbGV0IGJlc3RNb3ZlU2VxdWVuY2UgPSBbXTsNCiAgICBsZXQgbGVnYWxNb3Zlc0ZvdW5kID0gMDsNCg0KICAgIGZvciAobGV0IG1vdmVJbmRleCA9IDA7IG1vdmVJbmRleCA8IG1vdmVzLmxlbmd0aDsgbW92ZUluZGV4KyspIHsNCiAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW21vdmVJbmRleF07DQogICAgICAgIGNvbnN0IGlzQ2FwdHVyZSA9ICEhYlttb3ZlVG9SKG1vdmUpXVttb3ZlVG9DKG1vdmUpXTsNCiAgICAgICAgY29uc3QgaXNUVE1vdmUgPSB0dE1vdmUgJiYgaXNTYW1lTW92ZShtb3ZlLCB0dE1vdmUpOw0KICAgICAgICBjb25zdCBpc0tpbGxlciA9DQogICAgICAgICAgICBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNBdERlcHRoWzBdKSB8fA0KICAgICAgICAgICAgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzQXREZXB0aFsxXSk7DQoNCiAgICAgICAgLy8gTE1S77ya6Z2g5ZCO55qE5a6J6Z2Z552A5rOV6ZmN5rexIDHvvIjlrozmlbTor4TkvLDkuIvkv53lrojvvIkNCiAgICAgICAgLy8gbW92ZUluZGV4IOWQq+S8quWQiOazleW6j++8m+mdnuazleedgOi3s+i/h+WQjueVpeWBj+S/neWuiO+8iOWwkemZjea3se+8ie+8jOS4jeW9seWTjeato+ehruaApw0KICAgICAgICBsZXQgcmVkdWN0aW9uID0gMDsNCiAgICAgICAgaWYgKA0KICAgICAgICAgICAgZmFsc2UgJiYKICAgICAgICAgICAgZCA+PSA0ICYmDQogICAgICAgICAgICBtb3ZlSW5kZXggPj0gNCAmJg0KICAgICAgICAgICAgIWluQ2hlY2sgJiYNCiAgICAgICAgICAgICFpc0NhcHR1cmUgJiYNCiAgICAgICAgICAgICFpc1RUTW92ZSAmJg0KICAgICAgICAgICAgIWlzS2lsbGVyDQogICAgICAgICkgew0KICAgICAgICAgICAgcmVkdWN0aW9uID0gMTsNCiAgICAgICAgfQ0KDQogICAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYlttb3ZlRnJvbVIobW92ZSldW21vdmVGcm9tQyhtb3ZlKV07DQogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZVNlYXJjaE1vdmUoYiwgbW92ZSk7DQogICAgICAgIGlmIChsZWF2ZXNPd25LaW5nVW5zYWZlKGIsIGN1cnJlbnRQbGF5ZXJDb2xvcikpIHsKICAgICAgICAgICAgdW5tYWtlU2VhcmNoTW92ZShiLCBtb3ZlLCBjYXB0dXJlZCk7DQogICAgICAgICAgICBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCsrOw0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCiAgICAgICAgY29uc3QgbmV4dEhhc2ggPSBjaGlsZEJvYXJkSGFzaChib2FyZEhhc2gsIG1vdmUsIG1vdmluZ1BpZWNlLCBjYXB0dXJlZCk7DQogICAgICAgIGxlZ2FsTW92ZXNGb3VuZCsrOw0KICAgICAgICBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkKys7DQoNCiAgICAgICAgY29uc3QgbmV4dFBsYXllciA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBjb25zdCBuZXh0TWF4aW1pemluZyA9IG5leHRQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCg0KICAgICAgICBsZXQgcmVzdWx0Ow0KICAgICAgICBpZiAocmVkdWN0aW9uID4gMCkgew0KICAgICAgICAgICAgY29uc3QgcmVkdWNlZERlcHRoID0gTWF0aC5tYXgoMCwgZCAtIDEgLSByZWR1Y3Rpb24pOw0KICAgICAgICAgICAgcmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgICAgIGIsIHJlZHVjZWREZXB0aCwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLA0KICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgdHJ1ZSwgbmV4dEhhc2gNCiAgICAgICAgICAgICk7DQogICAgICAgICAgICBjb25zdCBuZWVkUmVzZWFyY2ggPSBtYXhpbWl6aW5nDQogICAgICAgICAgICAgICAgPyByZXN1bHQudmFsdWUgPiBhbHBoYQ0KICAgICAgICAgICAgICAgIDogcmVzdWx0LnZhbHVlIDwgYmV0YTsNCiAgICAgICAgICAgIGlmIChuZWVkUmVzZWFyY2gpIHsNCiAgICAgICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgICAgIGIsIGQgLSAxLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgdHJ1ZSwgbmV4dEhhc2gNCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgcmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgICAgIGIsIGQgLSAxLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgfQ0KDQogICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOw0KDQogICAgICAgIGlmIChtYXhpbWl6aW5nKSB7DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlID4gYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgICAgICBiZXN0TW92ZSA9IG1vdmU7DQogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsNCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlVG9PYmplY3QobW92ZSksIC4uLnJlc3VsdC5tb3ZlU2VxdWVuY2VdOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGFscGhhID0gTWF0aC5tYXgoYWxwaGEsIHJlc3VsdC52YWx1ZSk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgICAgICBiZXN0TW92ZSA9IG1vdmU7DQogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsNCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlVG9PYmplY3QobW92ZSksIC4uLnJlc3VsdC5tb3ZlU2VxdWVuY2VdOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJldGEgPSBNYXRoLm1pbihiZXRhLCByZXN1bHQudmFsdWUpOw0KICAgICAgICB9DQoNCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgIGlmICghcGVyZlN0YXRzLmN1dG9mZnNbZF0pIHBlcmZTdGF0cy5jdXRvZmZzW2RdID0gMDsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5jdXRvZmZzW2RdKys7DQogICAgICAgICAgICBpZiAoIWlzQ2FwdHVyZSkgew0KICAgICAgICAgICAgICAgIHN0b3JlS2lsbGVyTW92ZShkLCBtb3ZlKTsNCiAgICAgICAgICAgICAgICBhZGRIaXN0b3J5U2NvcmUobW92ZSwgZCk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOW7tui/n+WQiOazleaAp++8muS8quWQiOazlemdnuepuuS9huaXoOS4gOWQiOazlSDihpIg5bCG5q27L+WbsOavmQ0KICAgIGlmIChsZWdhbE1vdmVzRm91bmQgPT09IDApIHsKICAgICAgICByZXR1cm4gdGVybWluYWxTY29yZShpbkNoZWNrKTsNCiAgICB9DQoNCiAgICBzdG9yZVRUKGJlc3RFdmFsLCBiZXN0TW92ZSwgYmVzdE1vdmVTZXF1ZW5jZSk7DQogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPyBiZXN0TW92ZVNlcXVlbmNlIDogW10gfTsNCn07DQoNCi8vIGV4YWN0Um9vdFNjb3JlczogdHJ1ZT1BbmFseXNpcyDlhajmoLnnsr7noa7liIbvvJtmYWxzZT3lr7nlvIjmoIflh4YgUFZT77yIZmFpbC1sb3cg5LiN5Zue5pCc77yJDQpjb25zdCBnZXRCZXN0TW92ZUludGVybmFsID0gKGJvYXJkLCB0dXJuLCBkZXB0aCA9IDYsIHBseSA9IDAsIGVuYWJsZVRpbWVMaW1pdCA9IGZhbHNlLCBleGFjdFJvb3RTY29yZXMgPSBmYWxzZSwgY29sbGVjdE1vdmVTZXF1ZW5jZU92ZXJyaWRlID0gbnVsbCkgPT4gewogIGNvbnN0IHRpbWVMaW1pdCA9IDUwMDA7DQoNCiAgLy8gRmlyc3QgdHJ5IHRvIGdldCBtb3ZlIGZyb20gb3BlbmluZyBib29rDQogIGNvbnN0IGJvb2tNb3ZlID0gb3BlbmluZ0Jvb2suZ2V0Qm9va01vdmUoYm9hcmQsIHBseSk7DQogIA0KICBpZiAoYm9va01vdmUpIHsNCiAgICAvLyBDaGVjayBpZiBib29rTW92ZSBpcyB2YWxpZCBmb3IgY3VycmVudCBib2FyZA0KICAgIGlmIChib29rTW92ZS5mcm9tICYmIGJvb2tNb3ZlLnRvICYmIA0KICAgICAgICB0eXBlb2YgYm9va01vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICB0eXBlb2YgYm9va01vdmUudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJvb2tNb3ZlLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICANCiAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYm9hcmRbYm9va01vdmUuZnJvbS5yXVtib29rTW92ZS5mcm9tLmNdOw0KICAgICAgDQogICAgICBpZiAobW92aW5nUGllY2UgJiYgbW92aW5nUGllY2UuY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgLy8gVmVyaWZ5IG1vdmUgaXMgdmFsaWQNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCBib29rTW92ZS5mcm9tKTsNCiAgICAgICAgY29uc3QgaXNWYWxpZCA9IHZhbGlkRGVzdGluYXRpb25zLnNvbWUoZGVzdCA9PiBkZXN0LnIgPT09IGJvb2tNb3ZlLnRvLnIgJiYgZGVzdC5jID09PSBib29rTW92ZS50by5jKTsNCiAgICAgICAgDQogICAgICAgIGlmIChpc1ZhbGlkKSB7DQogICAgICAgICAgcmV0dXJuIHsgYmVzdE1vdmU6IGJvb2tNb3ZlLCBzZWNvbmRCZXN0TW92ZTogbnVsbCwgbW92ZVNlcXVlbmNlOiBbXSwgc2Vjb25kTW92ZVNlcXVlbmNlOiBbXSwgYmVzdE1vdmVTY29yZTogMCwgc2Vjb25kQmVzdE1vdmVTY29yZTogMCwgYWxsTW92ZXNXaXRoU2NvcmVzOiBbXSB9Ow0KICAgICAgICB9DQogICAgICB9DQogICAgfQ0KICB9DQoNCiAgLy8g5qC56IqC54K577ya6L+t5Luj5Yqg5rexICsgUFZT77ybVFQva2lsbGVyL2hpc3Rvcnkg6Leo5rex5bqm5L+d55WZ77yI5LuF5byA5bGA5riF56m65LiA5qyh77yJDQogIHJlc2V0UGVyZlN0YXRzKCk7DQogIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7DQogIHRyYW5zcG9zaXRpb25UYWJsZS5yZXNldFN0YXRzKCk7DQogIHRyYW5zcG9zaXRpb25UYWJsZS5jbGVhcigpOw0KICBjbGVhckV2YWxDYWNoZSgpOw0KICBjb25zdCBtYXhEZXB0aCA9IE1hdGgubWF4KDEsIGRlcHRoIHwgMCk7DQogIHJlc2V0U2VhcmNoSGV1cmlzdGljcyhtYXhEZXB0aCk7DQogIHN5bmNHZW5lcmFsUG9zQ2FjaGUoYm9hcmQpOw0KICBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFID0gdHlwZW9mIGNvbGxlY3RNb3ZlU2VxdWVuY2VPdmVycmlkZSA9PT0gJ2Jvb2xlYW4nDQogICAgPyBjb2xsZWN0TW92ZVNlcXVlbmNlT3ZlcnJpZGUNCiAgICA6ICEhZXhhY3RSb290U2NvcmVzOw0KDQogIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7DQogIGNvbnN0IGdhbWVTdGFnZSA9IHBoYXNlID09PSAnb3BlbmluZycgPyAnZWFybHknIDogcGhhc2UgPT09ICdtaWRkbGVnYW1lJyA/ICdtaWQnIDogJ2xhdGUnOw0KDQogIGNvbnN0IHJvb3RFdmFsUmVzdWx0ID0gZXZhbHVhdGVCb2FyZChib2FyZCwgdHVybiwgZ2FtZVN0YWdlKTsNCiAgY29uc3Qgcm9vdFBpZWNlc0luZm8gPSByb290RXZhbFJlc3VsdC5waWVjZXNJbmZvOw0KICBjb25zdCByb290Qm9hcmRJbmZvID0gcm9vdEV2YWxSZXN1bHQuYm9hcmRJbmZvOw0KDQogIC8vIOaUtumbhuagueiKgueCuei1sOazle+8iOWPquWBmuS4gOasoe+8ie+8m+acquiiq+WwhuaXtui/h+a7pOmAgeWQgw0KICBsZXQgcm9vdE1vdmVzID0gW107DQogIGNvbnN0IHJvb3RJbkNoZWNrID0gKHR1cm4gPT09ICdyZWQnICYmIHJvb3RCb2FyZEluZm8ucmVkSXNJbkNoZWNrKSB8fA0KICAgICAgICAgICAgICAgICAgICAgICh0dXJuID09PSAnYmxhY2snICYmIHJvb3RCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOw0KDQogIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgY29uc3QgdmFsaWREZXN0aW5hdGlvbnMgPSBnZXRWYWxpZE1vdmVzKGJvYXJkLCB7IHIsIGMgfSk7DQogICAgICAgIHZhbGlkRGVzdGluYXRpb25zLmZvckVhY2godG8gPT4gew0KICAgICAgICAgIGNvbnN0IGlzQWNjZXB0YWJsZSA9IHJvb3RJbkNoZWNrIHx8IGlzUG9zaXRpb25BY2NlcHRhYmxlKGJvYXJkLCB7IHIsIGMgfSwgdG8sIHR1cm4sIHJvb3RCb2FyZEluZm8sIHJvb3RQaWVjZXNJbmZvLCBwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICBpZiAoaXNBY2NlcHRhYmxlKSB7DQogICAgICAgICAgICByb290TW92ZXMucHVzaCh7IGZyb206IHsgciwgYyB9LCB0bywgc2NvcmU6IDAsIG1vdmVTZXF1ZW5jZTogW10gfSk7DQogICAgICAgICAgfQ0KICAgICAgICB9KTsNCiAgICAgIH0NCiAgICB9DQogIH0NCg0KICBpZiAocm9vdE1vdmVzLmxlbmd0aCA9PT0gMCkgew0KICAgIHJldHVybiB7DQogICAgICBiZXN0TW92ZTogbnVsbCwNCiAgICAgIHNlY29uZEJlc3RNb3ZlOiBudWxsLA0KICAgICAgbW92ZVNlcXVlbmNlOiBbXSwNCiAgICAgIHNlY29uZE1vdmVTZXF1ZW5jZTogW10sDQogICAgICBiZXN0TW92ZVNjb3JlOiAwLA0KICAgICAgc2Vjb25kQmVzdE1vdmVTY29yZTogMCwNCiAgICAgIGFsbE1vdmVzV2l0aFNjb3JlczogW10NCiAgICB9Ow0KICB9DQoNCiAgY29uc3Qgc29ydFJvb3RNb3Zlc0J5U2NvcmUgPSAobW92ZXMpID0+IHsNCiAgICBtb3Zlcy5zb3J0KChhLCBiKSA9PiB7DQogICAgICBjb25zdCBzY29yZURpZmYgPSBiLnNjb3JlIC0gYS5zY29yZTsNCiAgICAgIGlmIChNYXRoLmFicyhzY29yZURpZmYpIDwgMWUtNikgew0KICAgICAgICBpZiAoYS5zY29yZSA+IDApIHsNCiAgICAgICAgICByZXR1cm4gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYi5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoYS5zY29yZSA8IDApIHsNCiAgICAgICAgICByZXR1cm4gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCkgLSAoYS5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gMDsNCiAgICAgIH0NCiAgICAgIHJldHVybiBzY29yZURpZmY7DQogICAgfSk7DQogIH07DQoNCiAgY29uc3QgcHJvbW90ZVJvb3RNb3ZlID0gKG1vdmVzLCBwcmVmZXJyZWQpID0+IHsNCiAgICBpZiAoIXByZWZlcnJlZCkgcmV0dXJuOw0KICAgIGNvbnN0IGlkeCA9IG1vdmVzLmZpbmRJbmRleCgobSkgPT4gaXNTYW1lTW92ZShtLCBwcmVmZXJyZWQpKTsNCiAgICBpZiAoaWR4ID4gMCkgew0KICAgICAgY29uc3QgW2hpdF0gPSBtb3Zlcy5zcGxpY2UoaWR4LCAxKTsNCiAgICAgIG1vdmVzLnVuc2hpZnQoaGl0KTsNCiAgICB9DQogIH07DQoNCiAgY29uc3Qgd29ya0JvYXJkID0gYm9hcmQubWFwKChyb3cpID0+IFsuLi5yb3ddKTsKICBhY3RpdmVTZWFyY2hQaWVjZVN0YXRlID0gY3JlYXRlU2VhcmNoUGllY2VTdGF0ZSh3b3JrQm9hcmQpOwogIGNvbnN0IE5VTExfV0lORE9XX0VQUyA9IDFlLTY7DQogIGNvbnN0IG5leHRUdXJuID0gdHVybiA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogIC8vIOagueWxgOmdouWTiOW4jOWPqueul+S4gOasoe+8m+WinumHj+aooeW8j+aVtOajteaQnOe0ouagkeeUseatpOa0vueUnw0KICBjb25zdCByb290SGFzaCA9IHpvYnJpc3RIYXNoZXIuaGFzaChib2FyZCk7DQogIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50Kys7DQogIGNvbnN0IHJvb3RUVEtleSA9IHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChyb290SGFzaCwgdHVybik7Cg0KICBjb25zb2xlLmxvZygNCiAgICBgU3RhcnRpbmcgaXRlcmF0aXZlIGRlZXBlbmluZyB8IHR1cm46ICR7dHVybn0sIG1heERlcHRoOiAke21heERlcHRofSwgY29sbGVjdE1vdmVTZXF1ZW5jZTogJHtTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFfSwgdGltZUxpbWl0OiAke3RpbWVMaW1pdH1tcywgZW5hYmxlVGltZUxpbWl0OiAke2VuYWJsZVRpbWVMaW1pdH1gCiAgKTsNCg0KICBsZXQgY29tcGxldGVkRGVwdGggPSAwOw0KDQogIGZvciAobGV0IGN1cnJlbnREZXB0aCA9IDE7IGN1cnJlbnREZXB0aCA8PSBtYXhEZXB0aDsgY3VycmVudERlcHRoKyspIHsNCiAgICBpZiAoZW5hYmxlVGltZUxpbWl0ICYmIGNvbXBsZXRlZERlcHRoID4gMCAmJiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lID4gdGltZUxpbWl0KSB7DQogICAgICBjb25zb2xlLmxvZyhgSUQgc3RvcHBlZCBiZWZvcmUgZGVwdGggJHtjdXJyZW50RGVwdGh9IGR1ZSB0byB0aW1lIGxpbWl0IChsYXN0IGNvbXBsZXRlZD0ke2NvbXBsZXRlZERlcHRofSlgKTsNCiAgICAgIGJyZWFrOw0KICAgIH0NCg0KICAgIC8vIOa1heWxguacgOS9s+edgCArIFRUIOedgOaOkuWIsOacgOWJje+8jOS+m+acrOWxgiBQVlMg56ys5LiA552A5YWo56qX5L2/55SoDQogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZShyb290VFRLZXkpOw0KICAgIGNvbnN0IHR0TW92ZSA9IHR0RW50cnkgJiYgdHRFbnRyeS5iZXN0TW92ZSA/IHR0RW50cnkuYmVzdE1vdmUgOiBudWxsOw0KICAgIGNvbnN0IHByZXZCZXN0ID0gcm9vdE1vdmVzWzBdOw0KICAgIHNvcnRNb3Zlc0Zhc3Qocm9vdE1vdmVzLCBib2FyZCwgdHVybiwgcm9vdFBpZWNlc0luZm8sIGdhbWVTdGFnZSwgcm9vdEJvYXJkSW5mbywgew0KICAgICAgdHRNb3ZlLA0KICAgICAga2lsbGVyczoga2lsbGVyTW92ZXNbTWF0aC5tYXgoMCwgY3VycmVudERlcHRoIC0gMSldIHx8IFtudWxsLCBudWxsXQ0KICAgIH0pOw0KICAgIC8vIOS4iuS4gOWxguacgOS9s+edgOaUvuesrOS4gO+8iOacgOWQjiBwcm9tb3Rl77yJ77yM5L+d6K+B5pys5bGCIFBWUyDpppbnnYDlhajnqpflkb3kuK3ng63ot6/lvoQNCiAgICBwcm9tb3RlUm9vdE1vdmUocm9vdE1vdmVzLCB0dE1vdmUpOw0KICAgIHByb21vdGVSb290TW92ZShyb290TW92ZXMsIHByZXZCZXN0KTsNCg0KICAgIGNvbnN0IHVzZUV4YWN0Um9vdCA9IGV4YWN0Um9vdFNjb3JlcyAmJiBjdXJyZW50RGVwdGggPT09IG1heERlcHRoOw0KICAgIGxldCByb290QWxwaGEgPSAtSW5maW5pdHk7DQoNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJvb3RNb3Zlcy5sZW5ndGg7IGkrKykgew0KICAgICAgY29uc3QgaXRlbSA9IHJvb3RNb3Zlc1tpXTsNCiAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gd29ya0JvYXJkW2l0ZW0uZnJvbS5yXVtpdGVtLmZyb20uY107DQogICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VNb3ZlKHdvcmtCb2FyZCwgaXRlbS5mcm9tLCBpdGVtLnRvKTsNCiAgICAgIGNvbnN0IGNoaWxkSGFzaCA9IGNoaWxkQm9hcmRIYXNoKHJvb3RIYXNoLCBpdGVtLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOw0KDQogICAgICBsZXQgYWxwaGFCZXRhUmVzdWx0Ow0KICAgICAgbGV0IHNjb3JlSXNFeGFjdCA9IHRydWU7DQogICAgICBpZiAoaSA9PT0gMCB8fCByb290QWxwaGEgPT09IC1JbmZpbml0eSkgew0KICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LA0KICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICApOw0KICAgICAgfSBlbHNlIHsNCiAgICAgICAgY29uc3QgcHJvYmUgPSBhbHBoYUJldGEoDQogICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLA0KICAgICAgICAgIHJvb3RBbHBoYSwgcm9vdEFscGhhICsgTlVMTF9XSU5ET1dfRVBTLA0KICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICApOw0KICAgICAgICBpZiAocHJvYmUudmFsdWUgPiByb290QWxwaGEpIHsNCiAgICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsIHJvb3RBbHBoYSwgSW5maW5pdHksDQogICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCB0cnVlLCBjaGlsZEhhc2gNCiAgICAgICAgICApOw0KICAgICAgICB9IGVsc2UgaWYgKHVzZUV4YWN0Um9vdCkgew0KICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwgLUluZmluaXR5LCBJbmZpbml0eSwNCiAgICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICAgICk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgLy8gZmFpbC1sb3fvvJrmjqLmtYvliIblj6rmmK/kuIrnlYzvvIzkuI3og73lvZPnsr7noa7liIblhpnlhaXvvIjlkKbliJkgSUQg5LiL5bGC5o6S5bqP6KKr5rGh5p+T77yM5piT5Y+N5aSN6LWw54Ku77yJDQogICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gcHJvYmU7DQogICAgICAgICAgc2NvcmVJc0V4YWN0ID0gZmFsc2U7DQogICAgICAgIH0NCiAgICAgIH0NCg0KICAgICAgdW5tYWtlTW92ZSh3b3JrQm9hcmQsIGl0ZW0uZnJvbSwgaXRlbS50bywgY2FwdHVyZWQpOw0KDQogICAgICBpZiAoc2NvcmVJc0V4YWN0KSB7DQogICAgICAgIGl0ZW0uc2NvcmUgPSBhbHBoYUJldGFSZXN1bHQudmFsdWU7DQogICAgICAgIGl0ZW0ubW92ZVNlcXVlbmNlID0gU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRQ0KICAgICAgICAgID8gW3sgZnJvbTogaXRlbS5mcm9tLCB0bzogaXRlbS50byB9LCAuLi4oYWxwaGFCZXRhUmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldDQogICAgICAgICAgOiBbXTsNCiAgICAgICAgaWYgKGl0ZW0uc2NvcmUgPiByb290QWxwaGEpIHsNCiAgICAgICAgICByb290QWxwaGEgPSBpdGVtLnNjb3JlOw0KICAgICAgICB9DQogICAgICB9IGVsc2UgaWYgKGl0ZW0uc2NvcmUgPiByb290QWxwaGEpIHsNCiAgICAgICAgLy8g5L+d55WZ5LiK5LiA5bGC5YiG5pWw77yb6Iul5LuN6auY5LqO5b2T5YmNIM6x77yI5byC5bi477yJ77yM55Wl6ZmN5Lul5YWN5oyk5o6J55yf5pyA5LyYDQogICAgICAgIGl0ZW0uc2NvcmUgPSByb290QWxwaGEgLSAxZS0zOw0KICAgICAgfQ0KICAgIH0NCg0KICAgIHNvcnRSb290TW92ZXNCeVNjb3JlKHJvb3RNb3Zlcyk7DQogICAgY29tcGxldGVkRGVwdGggPSBjdXJyZW50RGVwdGg7DQoNCiAgICAvLyDmiormnKzlsYLmnIDkvbPnnYDlhpnlhaUgVFTvvIzkvpvmm7Tmt7HkuIDlsYLmoLnmjpLluo8NCiAgICB0cmFuc3Bvc2l0aW9uVGFibGUuc3RvcmUoDQogICAgICByb290VFRLZXksDQogICAgICBjdXJyZW50RGVwdGgsDQogICAgICByb290TW92ZXNbMF0uc2NvcmUsDQogICAgICAnZXhhY3QnLA0KICAgICAgcm9vdE1vdmVzWzBdLA0KICAgICAgU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA/IChyb290TW92ZXNbMF0ubW92ZVNlcXVlbmNlIHx8IFtdKSA6IG51bGwNCiAgICApOw0KDQogICAgY29uc29sZS5sb2coDQogICAgICBgSUQgZGVwdGggJHtjdXJyZW50RGVwdGh9LyR7bWF4RGVwdGh9IGRvbmUgfCBiZXN0PSR7SlNPTi5zdHJpbmdpZnkocm9vdE1vdmVzWzBdLmZyb20pfS0+JHtKU09OLnN0cmluZ2lmeShyb290TW92ZXNbMF0udG8pfSBzY29yZT0ke3Jvb3RNb3Zlc1swXS5zY29yZX0gZWxhcHNlZD0ke0RhdGUubm93KCkgLSBzdGFydFRpbWV9bXNgDQogICAgKTsNCiAgfQ0KDQogIGNvbnN0IGJlc3RNb3ZlID0gcm9vdE1vdmVzWzBdIHx8IG51bGw7DQogIGNvbnN0IHNlY29uZEJlc3RNb3ZlID0gcm9vdE1vdmVzLmxlbmd0aCA+IDEgPyByb290TW92ZXNbMV0gOiBudWxsOw0KICBjb25zdCBiZXN0TW92ZVNlcXVlbmNlID0gYmVzdE1vdmUgPyAoYmVzdE1vdmUubW92ZVNlcXVlbmNlIHx8IFtdKSA6IFtdOw0KICBjb25zdCBzZWNvbmRNb3ZlU2VxdWVuY2UgPSBzZWNvbmRCZXN0TW92ZSA/IChzZWNvbmRCZXN0TW92ZS5tb3ZlU2VxdWVuY2UgfHwgW10pIDogW107DQogIGNvbnN0IGJlc3RNb3ZlU2NvcmUgPSBiZXN0TW92ZSA/IGJlc3RNb3ZlLnNjb3JlIDogMDsNCiAgY29uc3Qgc2Vjb25kQmVzdE1vdmVTY29yZSA9IHNlY29uZEJlc3RNb3ZlID8gc2Vjb25kQmVzdE1vdmUuc2NvcmUgOiAwOw0KDQogIGNvbnN0IGFsbE1vdmVzV2l0aFNjb3JlcyA9IHJvb3RNb3Zlcy5tYXAoKG1vdmVJbmZvKSA9PiAoew0KICAgIG1vdmU6IHsNCiAgICAgIGZyb206IG1vdmVJbmZvLmZyb20sDQogICAgICB0bzogbW92ZUluZm8udG8NCiAgICB9LA0KICAgIHNjb3JlOiBtb3ZlSW5mby5zY29yZSwNCiAgICBtb3ZlU2VxdWVuY2U6IG1vdmVJbmZvLm1vdmVTZXF1ZW5jZSB8fCBbXQ0KICB9KSk7DQoNCiAgY29uc3QgcmVzdWx0ID0gewogICAgYmVzdE1vdmUsCiAgICBzZWNvbmRCZXN0TW92ZSwNCiAgICBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UsDQogICAgc2Vjb25kTW92ZVNlcXVlbmNlLA0KICAgIGJlc3RNb3ZlU2NvcmUsDQogICAgc2Vjb25kQmVzdE1vdmVTY29yZSwNCiAgICBhbGxNb3Zlc1dpdGhTY29yZXMsDQogICAgY29tcGxldGVkRGVwdGgKICB9OwogIGFjdGl2ZVNlYXJjaFBpZWNlU3RhdGUgPSBudWxsOwogIHJldHVybiByZXN1bHQ7Cn07CgovLyBQbGF5IGtlZXBzIHJvb3QgZmFpbC1sb3cgcHJvYmVzIGFzIGJvdW5kczsgYW5hbHlzaXMgcmUtc2VhcmNoZXMgZXZlcnkgZmluYWwKLy8gcm9vdCBtb3ZlIGFuZCByZXRhaW5zIFBWIGRhdGEuIEtlZXBpbmcgdGhlaXIgZW50cnkgcG9pbnRzIHNlcGFyYXRlIHByZXZlbnRzCi8vIGZ1dHVyZSBwbGF5LXBhdGggd29yayBmcm9tIHNpbGVudGx5IGNoYW5naW5nIGFuYWx5c2lzIHNlbWFudGljcy4KY29uc3QgZ2V0QmVzdE1vdmVGb3JQbGF5ID0gKGJvYXJkLCB0dXJuLCBkZXB0aCwgcGx5LCBlbmFibGVUaW1lTGltaXQpID0+CiAgZ2V0QmVzdE1vdmVJbnRlcm5hbChib2FyZCwgdHVybiwgZGVwdGgsIHBseSwgZW5hYmxlVGltZUxpbWl0LCBmYWxzZSwgZmFsc2UpOwoKY29uc3QgZ2V0QmVzdE1vdmVGb3JBbmFseXNpcyA9IChib2FyZCwgdHVybiwgZGVwdGgsIHBseSwgZW5hYmxlVGltZUxpbWl0KSA9PgogIGdldEJlc3RNb3ZlSW50ZXJuYWwoYm9hcmQsIHR1cm4sIGRlcHRoLCBwbHksIGVuYWJsZVRpbWVMaW1pdCwgdHJ1ZSwgdHJ1ZSk7Cgpjb25zdCBnZXRCZXN0TW92ZSA9IChib2FyZCwgdHVybiwgZGVwdGggPSA2LCBwbHkgPSAwLCBlbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzID0gZmFsc2UpID0+CiAgZXhhY3RSb290U2NvcmVzCiAgICA/IGdldEJlc3RNb3ZlRm9yQW5hbHlzaXMoYm9hcmQsIHR1cm4sIGRlcHRoLCBwbHksIGVuYWJsZVRpbWVMaW1pdCkKICAgIDogZ2V0QmVzdE1vdmVGb3JQbGF5KGJvYXJkLCB0dXJuLCBkZXB0aCwgcGx5LCBlbmFibGVUaW1lTGltaXQpOwoNCi8vIC0tLSBXT1JLRVIgTElTVEVORVIgKOe7n+S4gOa2iOaBr+WkhOeQhikgLS0tDQo=';
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

