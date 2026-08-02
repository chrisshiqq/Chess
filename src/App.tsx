
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovDQoNCi8vIOaji+ebmOW4uOmHj+WumuS5iQ0KY29uc3QgUk9XUyA9IDEwOw0KY29uc3QgQ09MUyA9IDk7DQoNCi8vIOaji+WtkOexu+Wei+WumuS5iQ0KY29uc3QgUElFQ0VfVFlQRVMgPSB7DQogICAgR0VORVJBTDogJ2dlbmVyYWwnLA0KICAgIENIQVJJT1Q6ICdjaGFyaW90JywNCiAgICBDQU5OT046ICdjYW5ub24nLA0KICAgIEhPUlNFOiAnaG9yc2UnLA0KICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLA0KICAgIEFEVklTT1I6ICdhZHZpc29yJywNCiAgICBTT0xESUVSOiAnc29sZGllcicNCn07DQoNCi8vIOadkOaWmeWAvOadg+mHjemFjee9rg0KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGdlbmVyYWw6IDEwMDAwLCAgLy8g5bCGL+W4hQ0KICAgIGNoYXJpb3Q6IDkwMCwgICAgIC8vIOi9pg0KICAgIGNhbm5vbjogew0KICAgICAgICBlYXJseTogNDUwLCAgICAvLyDlvIDlsYDpmLbmrrUNCiAgICAgICAgbWlkOiA0MDAsICAgICAgLy8g5Lit5bGA6Zi25q61DQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQ0KICAgIH0sICAgICAgICAgICAgICAgIC8vIOeCrg0KICAgIGhvcnNlOiB7DQogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDQ1MCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsDQogICAgZWxlcGhhbnQ6IDIwMCwgICAgLy8g6LGhL+ebuA0KICAgIGFkdmlzb3I6IDIwMCwgICAgIC8vIOWjqy/ku5UNCiAgICBzb2xkaWVyOiB7DQogICAgICAgIGVhcmx5OiAxMDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDIwMCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSAgICAgICAgICAgICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIOaji+WtkOS7t+WAvOadg+mHjemFjee9rg0KbGV0IFZBTFVFX1dFSUdIVFMgPSB7DQogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQ0KICAgIC8vcG9zaXRpb246IDAuMiwgICAvLyDkvY3nva7lgLzmnYPph40NCiAgICAvL3RocmVhdDogMC4xNSwgICAgLy8g5aiB6IOB5YC85p2D6YeNDQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQ0KICAgIC8vc2FmZXR5OiAwLjEsICAgICAvLyDlronlhajlgLzmnYPph40NCiAgICAvL21vYmlsaXR5OiAwLjA1ICAgLy8g5py65Yqo5YC85p2D6YeNDQoNCiAgICBtYXRlcmlhbDogMSwgICAgLy8g5p2Q5paZ5YC85p2D6YeNDQogICAgcG9zaXRpb246IDEsICAgIC8vIOS9jee9ruWAvOadg+mHjQ0KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQ0KICAgIHRhY3RpYzogMSwgICAgICAvLyDmiJjmnK/lgLzmnYPph40NCiAgICBzYWZldHk6IDEsICAgICAgLy8g5a6J5YWo5YC85p2D6YeNDQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQ0KfTsNCg0KLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XDQpjb25zdCBFVkFMVUFUSU9OX1BBUkFNRVRFUlMgPSB7DQogICAgLy8g5py65Yqo5YC85Y+C5pWwDQogICAgbW9iaWxpdHk6IHsNCiAgICAgICAgYmFzZU1vdmVWYWx1ZTogMSwgICAgICAvLyDln7rnoYDnp7vliqjku7flgLwNCiAgICB9LA0KICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQ0KICAgIGNoZWNrOiB7DQogICAgICAgIGJvbnVzOiA4MA0KICAgIH0NCn07DQoNCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rg0KY29uc3QgUE9TSVRJT05fVEFCTEVTID0gew0KICAgIC8vIOWFtS/ljZLkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBzb2xkaWVyOiBbDQogICAgICAgIFswLCA1LCAxMCwgMTUsIDIwLCAxNSwgMTAsIDUsIDBdLA0KICAgICAgICBbNSwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgY2hhcmlvdDogWw0KICAgICAgICBbNSwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDEwLCA1LCAxNSwgMCwgMTUsIDUsIDEwLCAxMF0sDQogICAgICAgIFswLCAxMCwgNSwgNSwgNSwgNSwgMTAsIDUsIDBdDQogICAgXSwNCiAgICAvLyDpqazkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBob3JzZTogWw0KICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgICAgICAgWzAsIDUsIDI1LCAxMCwgMTAsIDEwLCAyNSwgNSwgMF0sDQogICAgICAgIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sDQogICAgICAgIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMjUsIDIwLCAwLCAyMCwgMjUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgICAgICAgWzUsIDAsIDUsIDUsIDAsIDUsIDUsIDAsIDVdLA0KICAgICAgICBbMCwgMCwgMCwgNSwgLTIwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDngq7kvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBjYW5ub246IFsNCiAgICAgICAgWzEwLCAyMCwgMTUsIDEwLCAwLCAxMCwgMTUsIDIwLCAxMF0sDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLA0KICAgICAgICBbNSwgNSwgMTUsIDUsIDI1LCA1LCAxNSwgNSwgNV0sDQogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLA0KICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogICAgICAgIFsxMCwgMTAsIDE1LCAyMCwgMzAsIDIwLCAxNSwgMTAsIDEwXSwgDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBlbGVwaGFudDogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g5aOr5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgYWR2aXNvcjogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCA1LCAwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDEwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0NCiAgICBdDQp9Ow0KDQovLyDojrflj5bmo4vlrZDnmoTmnZDmlpnlgLwNCmNvbnN0IGdldE1hdGVyaWFsVmFsdWUgPSAocGllY2UsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOw0KICAgIA0KICAgIC8vIOmSiOWvueacieWIhumYtuauteadkOaWmeWAvOeahOWFteenje+8iOWFteOAgeeCruOAgemprO+8ieiwg+aVtOadkOaWmeWAvA0KICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7DQogICAgICAgIHZhbHVlID0gdmFsdWVbZ2FtZVN0YWdlXSB8fCB2YWx1ZS5taWQ7DQogICAgfQ0KICAgIA0KICAgIHJldHVybiB2YWx1ZTsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOS9jee9ruWAvA0KY29uc3QgZ2V0UG9zaXRpb25WYWx1ZSA9IChwaWVjZSwgciwgYykgPT4gew0KICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOw0KICAgIGlmICghdGFibGUpIHJldHVybiAwOw0KICAgIA0KICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqA0KICAgIGNvbnN0IHJvd0lkeCA9IHBpZWNlLmNvbG9yID09PSAncmVkJyA/ICg5LSByKSA6IHI7DQogICAgcmV0dXJuIHRhYmxlW3Jvd0lkeF1bY10gfHwgMDsNCn07DQoNCi8vIOaUu+WHu+S9jeWbvu+8mjkwIOagvOeUqCAzw5dVaW50MzLjgILmkJzntKLlj7blj6rpnIDjgIzmmK/lkKbmlYzmjqfjgI3vvJvngrnmo4svVUkg5LuN55So5o6n5Yi26ICF5YiX6KGo44CCDQpjb25zdCBBVFRBQ0tfV09SRFMgPSAzOw0KY29uc3Qgc2NyYXRjaFJlZEF0dGFjayA9IG5ldyBVaW50MzJBcnJheShBVFRBQ0tfV09SRFMpOw0KY29uc3Qgc2NyYXRjaEJsYWNrQXR0YWNrID0gbmV3IFVpbnQzMkFycmF5KEFUVEFDS19XT1JEUyk7DQovLyB0cnVlPeaQnOe0ouWPtueUqOaUu+WHu+S9jeWbvu+8iOm7mOiupO+8ie+8m2ZhbHNlPeWPtuivhOS8sOS7jeW7uiAxMMOXOSDmjqfliLbogIXooajvvIhBL0LvvIkNCmxldCBTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUUyA9IHRydWU7DQovLyB0cnVlPeWFs+ezu+eUqOagvOS9jSBVaW50MzIg5pS7L+WuiC/mjqcgbWFza++8iOm7mOiupO+8ie+8m2ZhbHNlPXRocmVhdC9ndWFyZCDlr7nosaHliJfooajvvIhBL0LvvIkNCmxldCBTRUFSQ0hfUkVMQVRJT05fTUFTS1MgPSB0cnVlOwpsZXQgU0VBUkNIX0ZBU1RfTEVBRl9FVkFMID0gdHJ1ZTsKLy8g5pCc57Si5pyf6Ze057u05oqk57Sn5YeR5qOL5a2Q6KGo77yM6YG/5YWN5Y+26K+E5LywL+edgOazleWHhuWkh+WPjeWkjeaJq+aPjyAxMHg5IOWvueixoeaji+ebmO+8iEEvQiDlj6/lhbPpl63vvIkKbGV0IFNFQVJDSF9QSUVDRV9MSVNUID0gdHJ1ZTsKDQpjb25zdCBjbGVhckF0dGFja0JpdHMgPSAoYml0cykgPT4gew0KICAgIGJpdHNbMF0gPSAwOw0KICAgIGJpdHNbMV0gPSAwOw0KICAgIGJpdHNbMl0gPSAwOw0KfTsNCg0KY29uc3Qgc2V0QXR0YWNrQml0ID0gKGJpdHMsIHNxKSA9PiB7DQogICAgYml0c1tzcSA+Pj4gNV0gfD0gKDEgPDwgKHNxICYgMzEpKTsNCn07DQoNCmNvbnN0IGhhc0F0dGFja0JpdCA9IChiaXRzLCBzcSkgPT4gKGJpdHNbc3EgPj4+IDVdICYgKDEgPDwgKHNxICYgMzEpKSkgIT09IDA7DQoNCmNvbnN0IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkID0gKCkgPT4NCiAgICBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCg0KLy8g5YWz57O7IG1hc2vvvJrmnIDlpJogMzIg5a2Q77yI5Lit5Zu96LGh5qOL5ruh55uY77yJ77yMYml0IGkgPSBwaWVjZXNJbmZvW2ldDQpjb25zdCBSRUxfU1FVQVJFUyA9IDkwOw0KY29uc3Qgc2NyYXRjaEF0dGFja01hc2sgPSBuZXcgVWludDMyQXJyYXkoUkVMX1NRVUFSRVMpOyAgLy8g5pWM5a2Q5omA5Zyo5qC877ya6LCB5Zyo5omT5a6DDQpjb25zdCBzY3JhdGNoR3VhcmRNYXNrID0gbmV3IFVpbnQzMkFycmF5KFJFTF9TUVVBUkVTKTsgICAvLyDlj4vlhpvmiYDlnKjmoLzvvJrosIHlnKjkv53lroMNCmNvbnN0IHNjcmF0Y2hDb250cm9sTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7IC8vIOepuuaOp+agvO+8muiwgeaOp+WItuWug++8iOWvuem9kOaXpyBib2FyZEluZm/vvIkNCg0KY29uc3QgY2xlYXJSZWxhdGlvbk1hc2tzID0gKGNsZWFyQ29udHJvbCA9IHRydWUpID0+IHsNCiAgICBzY3JhdGNoQXR0YWNrTWFzay5maWxsKDApOw0KICAgIHNjcmF0Y2hHdWFyZE1hc2suZmlsbCgwKTsNCiAgICBpZiAoY2xlYXJDb250cm9sKSBzY3JhdGNoQ29udHJvbE1hc2suZmlsbCgwKTsNCn07DQoNCi8vIOagvOS9jSDihpIgcGllY2VzSW5mbyDlvJXnlKjvvIjmm7/ku6Pmr4/lj7YgbmV3IE1hcO+8iQ0KY29uc3Qgc2NyYXRjaFBpZWNlQXRTcSA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7DQpjb25zdCBjbGVhclBpZWNlQXRTcSA9ICgpID0+IHsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IFJFTF9TUVVBUkVTOyBpKyspIHNjcmF0Y2hQaWVjZUF0U3FbaV0gPSBudWxsOw0KfTsNCg0KLy8g5aSN55SoIHJlbEN0eO+8jOmBv+WFjeavj+WtkCBuZXcg5bCP5a+56LGhDQpjb25zdCBzY3JhdGNoUmVsQ3R4ID0gewogICAgdXNlTWFza3M6IHRydWUsDQogICAgc2tpcENvbnRyb2xNYXNrOiBmYWxzZSwgLy8g5pCc57Si5Y+277ya5LiN5YaZ56m65o6nIGNvbnRyb2xNYXNr77yI5LuN5YaZ5pS75Ye75L2N5Zu+K+acuuWKqO+8iQ0KICAgIHBpZWNlSW5kZXg6IDAsDQogICAgYXR0YWNrTWFzazogbnVsbCwNCiAgICBndWFyZE1hc2s6IG51bGwsDQogICAgY29udHJvbE1hc2s6IG51bGwsDQogICAgcmVkQXR0YWNrOiBudWxsLA0KICAgIGJsYWNrQXR0YWNrOiBudWxsCn07Cgpjb25zdCBzY3JhdGNoTGVhZlBpZWNlc0luZm8gPSBbXTsKY29uc3Qgc2NyYXRjaExlYWZQaWVjZVNsb3RzID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogMzIgfSwgKF8sIHBpZWNlSW5kZXgpID0+ICh7CiAgICBwaWVjZTogbnVsbCwKICAgIHI6IDAsCiAgICBjOiAwLAogICAgcGllY2VJbmRleCwKICAgIG1vdmVzOiBbXSwKICAgIGFsbHlHdWFyZHM6IFtdLAogICAgbWF0ZXJpYWxWYWx1ZTogMCwKICAgIHBvc2l0aW9uVmFsdWU6IDAsCiAgICB0aHJlYXRWYWx1ZTogMCwKICAgIHNhZmV0eVZhbHVlOiAwLAogICAgdGFjdGljVmFsdWU6IDAsCiAgICBtb2JpbGl0eVZhbHVlOiAwLAogICAgdGhyZWF0OiBbXSwKICAgIHRocmVhdGVuZWRCeTogW10sCiAgICBndWFyZDogW10sCiAgICBndWFyZGVkQnk6IFtdLAogICAgY29udHJvbDogW10sCiAgICBwcm90ZWN0OiBbXQp9KSk7Cgpjb25zdCBzY3JhdGNoTGVhZkJvYXJkSW5mbyA9IHsKICAgIHVzZVJlbGF0aW9uTWFza3M6IHRydWUsCiAgICB1c2VBdHRhY2tCaXRzOiB0cnVlLAogICAgc2tpcENvbnRyb2xNYXNrOiB0cnVlLAogICAgYXR0YWNrTWFzazogc2NyYXRjaEF0dGFja01hc2ssCiAgICBndWFyZE1hc2s6IHNjcmF0Y2hHdWFyZE1hc2ssCiAgICBjb250cm9sTWFzazogc2NyYXRjaENvbnRyb2xNYXNrLAogICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLAogICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjawp9OwoKbGV0IGFjdGl2ZVNlYXJjaFBpZWNlU3RhdGUgPSBudWxsOwoKY29uc3QgY3JlYXRlU2VhcmNoUGllY2VTdGF0ZSA9IChib2FyZCkgPT4gewogICAgY29uc3QgcmVjb3JkcyA9IFtdOwogICAgY29uc3Qgc3F1YXJlVG9TbG90ID0gbmV3IEludDhBcnJheShSRUxfU1FVQVJFUyk7CiAgICBzcXVhcmVUb1Nsb3QuZmlsbCgtMSk7CiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgewogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7CiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOwogICAgICAgICAgICBpZiAocmVjb3Jkcy5sZW5ndGggPj0gMzIpIHJldHVybiBudWxsOwogICAgICAgICAgICBjb25zdCBzbG90ID0gcmVjb3Jkcy5sZW5ndGg7CiAgICAgICAgICAgIHJlY29yZHMucHVzaCh7IHBpZWNlLCByLCBjLCBzcTogciAqIDkgKyBjLCBhbGl2ZTogdHJ1ZSB9KTsKICAgICAgICAgICAgc3F1YXJlVG9TbG90W3IgKiA5ICsgY10gPSBzbG90OwogICAgICAgIH0KICAgIH0KICAgIHJldHVybiB7CiAgICAgICAgYm9hcmQsCiAgICAgICAgcmVjb3JkcywKICAgICAgICBzcXVhcmVUb1Nsb3QsCiAgICAgICAgbW92ZXJTdGFjazogbmV3IEludDhBcnJheSgzMiksCiAgICAgICAgY2FwdHVyZWRTdGFjazogbmV3IEludDhBcnJheSgzMiksCiAgICAgICAgc3RhY2tEZXB0aDogMAogICAgfTsKfTsKCmNvbnN0IGFjdGl2ZVBpZWNlU3RhdGVGb3IgPSAoYm9hcmQpID0+IHsKICAgIGNvbnN0IHN0YXRlID0gYWN0aXZlU2VhcmNoUGllY2VTdGF0ZTsKICAgIHJldHVybiBTRUFSQ0hfUElFQ0VfTElTVCAmJiBzdGF0ZSAmJiBzdGF0ZS5ib2FyZCA9PT0gYm9hcmQgPyBzdGF0ZSA6IG51bGw7Cn07Cgpjb25zdCB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJNYWtlID0gKGJvYXJkLCBmcm9tU3EsIHRvU3EpID0+IHsKICAgIGNvbnN0IHN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7CiAgICBpZiAoIXN0YXRlKSByZXR1cm47CiAgICBjb25zdCBtb3ZlclNsb3QgPSBzdGF0ZS5zcXVhcmVUb1Nsb3RbZnJvbVNxXTsKICAgIGNvbnN0IGNhcHR1cmVkU2xvdCA9IHN0YXRlLnNxdWFyZVRvU2xvdFt0b1NxXTsKICAgIGNvbnN0IHN0YWNrSW5kZXggPSBzdGF0ZS5zdGFja0RlcHRoKys7CiAgICBzdGF0ZS5tb3ZlclN0YWNrW3N0YWNrSW5kZXhdID0gbW92ZXJTbG90OwogICAgc3RhdGUuY2FwdHVyZWRTdGFja1tzdGFja0luZGV4XSA9IGNhcHR1cmVkU2xvdDsKICAgIGlmIChtb3ZlclNsb3QgPCAwKSByZXR1cm47CgogICAgY29uc3QgbW92ZXIgPSBzdGF0ZS5yZWNvcmRzW21vdmVyU2xvdF07CiAgICBtb3Zlci5zcSA9IHRvU3E7CiAgICBtb3Zlci5yID0gKHRvU3EgLyA5KSB8IDA7CiAgICBtb3Zlci5jID0gdG9TcSAlIDk7CiAgICBzdGF0ZS5zcXVhcmVUb1Nsb3RbZnJvbVNxXSA9IC0xOwogICAgc3RhdGUuc3F1YXJlVG9TbG90W3RvU3FdID0gbW92ZXJTbG90OwogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwKSBzdGF0ZS5yZWNvcmRzW2NhcHR1cmVkU2xvdF0uYWxpdmUgPSBmYWxzZTsKfTsKCmNvbnN0IHVwZGF0ZVBpZWNlU3RhdGVBZnRlclVubWFrZSA9IChib2FyZCwgZnJvbVNxLCB0b1NxKSA9PiB7CiAgICBjb25zdCBzdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOwogICAgaWYgKCFzdGF0ZSkgcmV0dXJuOwogICAgY29uc3Qgc3RhY2tJbmRleCA9IC0tc3RhdGUuc3RhY2tEZXB0aDsKICAgIGNvbnN0IG1vdmVyU2xvdCA9IHN0YXRlLm1vdmVyU3RhY2tbc3RhY2tJbmRleF07CiAgICBjb25zdCBjYXB0dXJlZFNsb3QgPSBzdGF0ZS5jYXB0dXJlZFN0YWNrW3N0YWNrSW5kZXhdOwogICAgaWYgKG1vdmVyU2xvdCA8IDApIHJldHVybjsKCiAgICBjb25zdCBtb3ZlciA9IHN0YXRlLnJlY29yZHNbbW92ZXJTbG90XTsKICAgIG1vdmVyLnNxID0gZnJvbVNxOwogICAgbW92ZXIuciA9IChmcm9tU3EgLyA5KSB8IDA7CiAgICBtb3Zlci5jID0gZnJvbVNxICUgOTsKICAgIHN0YXRlLnNxdWFyZVRvU2xvdFtmcm9tU3FdID0gbW92ZXJTbG90OwogICAgc3RhdGUuc3F1YXJlVG9TbG90W3RvU3FdID0gY2FwdHVyZWRTbG90OwogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwKSBzdGF0ZS5yZWNvcmRzW2NhcHR1cmVkU2xvdF0uYWxpdmUgPSB0cnVlOwp9OwoNCmNvbnN0IGxvd2VzdFNldEJpdEluZGV4ID0gKG1hc2spID0+IDMxIC0gTWF0aC5jbHozMihtYXNrICYgLW1hc2spOw0KDQpjb25zdCBmb3JFYWNoU2V0Qml0ID0gKG1hc2ssIGZuKSA9PiB7DQogICAgbGV0IG0gPSBtYXNrID4+PiAwOw0KICAgIHdoaWxlIChtICE9PSAwKSB7DQogICAgICAgIGNvbnN0IGJpdCA9IG0gJiAtbTsNCiAgICAgICAgZm4oMzEgLSBNYXRoLmNsejMyKGJpdCkpOw0KICAgICAgICBtIF49IGJpdDsNCiAgICB9DQp9Ow0KDQovLyDkuLvor4TkvLDlh73mlbAgLSDor6bnu4bor4TkvLDmo4vnm5jlsYDlir/vvIhVSSAvIOeCueaji+WFs+ezuyAvIOaQnOe0ouWPtiAvIOagueiKgueCue+8iQ0KLy8gb3B0aW9ucy5mb3JTZWFyY2hMZWFmOiDku4Xot7Pov4fnu4jlsYAgZ2V0VmFsaWRNb3Zlc++8iOaXoOedgOW3suWcqOeItuiKgueCueWkhOeQhu+8ie+8m+WPr+eUqOaUu+WHu+S9jeWbvuS7o+abv+aOp+WItuiAheihqA0KY29uc3QgZXZhbHVhdGVCb2FyZCA9IChib2FyZCwgY3VycmVudFBsYXllciA9IG51bGwsIGdhbWVTdGFnZSA9ICdtaWQnLCBvcHRpb25zID0gbnVsbCkgPT4gewogICAgY29uc3QgX190MCA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgIC8vIOe7n+iuoQ0KICAgIGlmIChjdXJyZW50UGxheWVyKSB7DQogICAgICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnRbY3VycmVudFBsYXllcl0rKzsNCiAgICB9DQogICAgY29uc3QgZm9yU2VhcmNoTGVhZiA9ICEhKG9wdGlvbnMgJiYgb3B0aW9ucy5mb3JTZWFyY2hMZWFmKTsNCg0KICAgIGNvbnN0IG91dHB1dFBoYXNlID0gZ2FtZVN0YWdlOw0KDQogICAgLy8g6YGN5Y6G5qOL55uY77ya5Y+q5pS26ZuG5a2Q5YqbL1BTVO+8m+edgOazlSvlhbPns7vnu5/kuIDlnKggY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMg5LiA5qyh5Yeg5L2V55Sf5oiQ77yI5a+56b2Q54Ku77yJDQogICAgbGV0IHBpZWNlc0luZm8gPSBbXTsNCiAgICBsZXQgcmVkTWF0ZXJpYWwgPSAwLCByZWRQb3NpdGlvbiA9IDA7DQogICAgbGV0IGJsYWNrTWF0ZXJpYWwgPSAwLCBibGFja1Bvc2l0aW9uID0gMDsNCiAgICANCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBjb25zdCBtYXRlcmlhbFZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uVmFsdWUgPSBnZXRQb3NpdGlvblZhbHVlKHBpZWNlLCByLCBjKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKHBpZWNlLmNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgIHJlZE1hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICAgICAgcmVkUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgYmxhY2tNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgIGJsYWNrUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgcGllY2VzSW5mby5wdXNoKHsNCiAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICByLA0KICAgICAgICAgICAgICAgIGMsDQogICAgICAgICAgICAgICAgcGllY2VJbmRleDogcGllY2VzSW5mby5sZW5ndGgsDQogICAgICAgICAgICAgICAgbW92ZXM6IFtdLA0KICAgICAgICAgICAgICAgIGFsbHlHdWFyZHM6IFtdLA0KICAgICAgICAgICAgICAgIG1hdGVyaWFsVmFsdWUsDQogICAgICAgICAgICAgICAgcG9zaXRpb25WYWx1ZSwNCiAgICAgICAgICAgICAgICB0aHJlYXRWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICBzYWZldHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICB0YWN0aWNWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlOiAwLA0KICAgICAgICAgICAgICAgIHRocmVhdDogW10sDQogICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICBndWFyZDogW10sDQogICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICBjb250cm9sOiBbXSwNCiAgICAgICAgICAgICAgICBwcm90ZWN0OiBbXQ0KICAgICAgICAgICAgfSk7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDlhbPns7sgbWFza++8iOKJpDMyIOWtkO+8ieS8mOWFiO+8m+WQpuWImeWbnumAgOaXp+WIl+ihqCAvIOWPtuaUu+WHu+S9jeWbvg0KICAgIGNvbnN0IHVzZVJlbGF0aW9uTWFza3MgPSBTRUFSQ0hfUkVMQVRJT05fTUFTS1MgJiYgcGllY2VzSW5mby5sZW5ndGggPD0gMzI7DQogICAgY29uc3QgdXNlQXR0YWNrQml0cyA9ICF1c2VSZWxhdGlvbk1hc2tzICYmIGZvclNlYXJjaExlYWYgJiYgU0VBUkNIX0xFQUZfQVRUQUNLX0JJVFM7DQogICAgbGV0IGJvYXJkSW5mbzsNCiAgICBpZiAodXNlUmVsYXRpb25NYXNrcykgew0KICAgICAgICBjbGVhclJlbGF0aW9uTWFza3MoIWZvclNlYXJjaExlYWYpOw0KICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaFJlZEF0dGFjayk7DQogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOw0KICAgICAgICBib2FyZEluZm8gPSB7DQogICAgICAgICAgICB1c2VSZWxhdGlvbk1hc2tzOiB0cnVlLA0KICAgICAgICAgICAgdXNlQXR0YWNrQml0czogdHJ1ZSwNCiAgICAgICAgICAgIHNraXBDb250cm9sTWFzazogISFmb3JTZWFyY2hMZWFmLA0KICAgICAgICAgICAgYXR0YWNrTWFzazogc2NyYXRjaEF0dGFja01hc2ssDQogICAgICAgICAgICBndWFyZE1hc2s6IHNjcmF0Y2hHdWFyZE1hc2ssDQogICAgICAgICAgICBjb250cm9sTWFzazogc2NyYXRjaENvbnRyb2xNYXNrLA0KICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICB9Ow0KICAgIH0gZWxzZSBpZiAodXNlQXR0YWNrQml0cykgew0KICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaFJlZEF0dGFjayk7DQogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOw0KICAgICAgICBib2FyZEluZm8gPSB7DQogICAgICAgICAgICB1c2VBdHRhY2tCaXRzOiB0cnVlLA0KICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICB9Ow0KICAgIH0gZWxzZSB7DQogICAgICAgIGJvYXJkSW5mbyA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7DQogICAgfQ0KICAgIGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMoYm9hcmQsIHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbywgZm9yU2VhcmNoTGVhZik7DQogICAgDQogICAgLy8g56ys5LiJ5q2l77ya6K6h566X5oC75YiG77yI5Y+q6K6h566X5Ymp5L2Z5YiG5pWw77yM5Z+656GA5YiG5pWw5bey5Zyo5qOL55uY6YGN5Y6G5pe26K6h566X77yJDQogICAgbGV0IHJlZFRocmVhdCA9IDAsIHJlZFRhY3RpYyA9IDAsIHJlZFNhZmV0eSA9IDAsIHJlZE1vYmlsaXR5ID0gMDsNCiAgICBsZXQgYmxhY2tUaHJlYXQgPSAwLCBibGFja1RhY3RpYyA9IDAsIGJsYWNrU2FmZXR5ID0gMCwgYmxhY2tNb2JpbGl0eSA9IDA7DQogICAgDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgY29uc3QgeyBwaWVjZSwgdGhyZWF0VmFsdWUsIHRhY3RpY1ZhbHVlLCBzYWZldHlWYWx1ZSwgbW9iaWxpdHlWYWx1ZSB9ID0gaW5mbzsNCiAgICAgICAgDQogICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgIHJlZFRocmVhdCArPSB0aHJlYXRWYWx1ZTsNCiAgICAgICAgICAgIHJlZFRhY3RpYyArPSB0YWN0aWNWYWx1ZTsNCiAgICAgICAgICAgIHJlZFNhZmV0eSArPSBzYWZldHlWYWx1ZTsNCiAgICAgICAgICAgIHJlZE1vYmlsaXR5ICs9IG1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBibGFja1RocmVhdCArPSB0aHJlYXRWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrVGFjdGljICs9IHRhY3RpY1ZhbHVlOw0KICAgICAgICAgICAgYmxhY2tTYWZldHkgKz0gc2FmZXR5VmFsdWU7DQogICAgICAgICAgICBibGFja01vYmlsaXR5ICs9IG1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g6K6h566X5bGA5Yq/5oC75YiGDQogICAgY29uc3QgcmVkVG90YWwgPSANCiAgICAgICAgcmVkTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgcmVkUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsNCiAgICAgICAgcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKw0KICAgICAgICByZWRUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArDQogICAgICAgIHJlZFNhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsNCiAgICAgICAgcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5OyANCiAgICANCiAgICBjb25zdCBibGFja1RvdGFsID0gDQogICAgICAgIGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgYmxhY2tQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24gKw0KICAgICAgICBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsNCiAgICAgICAgYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArDQogICAgICAgIGJsYWNrU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHkgKw0KICAgICAgICBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsNCiAgICANCiAgICAvLyDov5Tlm57or6bnu4bor4TkvLDnu5PmnpwNCiAgICBjb25zdCBfX2V2YWxSZXN1bHQgPSB7DQogICAgICAgIHJlZDogew0KICAgICAgICAgICAgdG90YWw6IHJlZFRvdGFsLA0KICAgICAgICAgICAgbWF0ZXJpYWw6IHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwNCiAgICAgICAgICAgIHBvc2l0aW9uOiByZWRQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sDQogICAgICAgICAgICB0aHJlYXQ6IHJlZFRocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0LA0KICAgICAgICAgICAgdGFjdGljOiByZWRUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYywNCiAgICAgICAgICAgIHNhZmV0eTogcmVkU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHksDQogICAgICAgICAgICBtb2JpbGl0eTogcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgcGhhc2U6IG91dHB1dFBoYXNlLA0KICAgICAgICAgICAgd2VpZ2h0czogew0KICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLjQsDQogICAgICAgICAgICAgICAgcG9zaXRpb246IDAuMiwNCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwNCiAgICAgICAgICAgICAgICBzYWZldHk6IDAuMSwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eTogMC4wNSwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSwNCiAgICAgICAgYmxhY2s6IHsNCiAgICAgICAgICAgIHRvdGFsOiBibGFja1RvdGFsLA0KICAgICAgICAgICAgbWF0ZXJpYWw6IGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsLA0KICAgICAgICAgICAgcG9zaXRpb246IGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLA0KICAgICAgICAgICAgdGhyZWF0OiBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0LA0KICAgICAgICAgICAgdGFjdGljOiBibGFja1RhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljLA0KICAgICAgICAgICAgc2FmZXR5OiBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LA0KICAgICAgICAgICAgbW9iaWxpdHk6IGJsYWNrTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgcGhhc2U6IG91dHB1dFBoYXNlLA0KICAgICAgICAgICAgd2VpZ2h0czogew0KICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLjQsDQogICAgICAgICAgICAgICAgcG9zaXRpb246IDAuMiwNCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwNCiAgICAgICAgICAgICAgICBzYWZldHk6IDAuMSwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eTogMC4wNSwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSwNCiAgICAgICAgcGllY2VzSW5mbzogcGllY2VzSW5mbywNCiAgICAgICAgZ2FtZVN0YWdlOiBnYW1lU3RhZ2UsDQogICAgICAgIGJvYXJkSW5mbzogYm9hcmRJbmZvDQogICAgfTsNCiAgICBpZiAodHlwZW9mIHBlcmZTdGF0cyAhPT0gJ3VuZGVmaW5lZCcgJiYgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcyAhPSBudWxsKSB7DQogICAgICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIH0NCiAgICByZXR1cm4gX19ldmFsUmVzdWx0Owp9OwoKY29uc3QgZXZhbHVhdGVTZWFyY2hMZWFmRmFzdCA9IChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpID0+IHsKICAgIGNvbnN0IF9fdDAgPSBwZXJmb3JtYW5jZS5ub3coKTsKICAgIGNvbnN0IHBpZWNlc0luZm8gPSBzY3JhdGNoTGVhZlBpZWNlc0luZm87CiAgICBsZXQgY291bnQgPSAwOwogICAgbGV0IHJlZE1hdGVyaWFsID0gMDsKICAgIGxldCByZWRQb3NpdGlvbiA9IDA7CiAgICBsZXQgYmxhY2tNYXRlcmlhbCA9IDA7CiAgICBsZXQgYmxhY2tQb3NpdGlvbiA9IDA7CiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7CiAgICBsZXQgb3ZlcmZsb3cgPSBmYWxzZTsKICAgIGlmIChwaWVjZVN0YXRlKSB7CiAgICAgICAgY29uc3QgcmVjb3JkcyA9IHBpZWNlU3RhdGUucmVjb3JkczsKICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJlY29yZHMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgY29uc3QgcmVjb3JkID0gcmVjb3Jkc1tpXTsKICAgICAgICAgICAgaWYgKCFyZWNvcmQuYWxpdmUpIGNvbnRpbnVlOwogICAgICAgICAgICBjb25zdCBwaWVjZSA9IHJlY29yZC5waWVjZTsKICAgICAgICAgICAgY29uc3QgaW5mbyA9IHNjcmF0Y2hMZWFmUGllY2VTbG90c1tjb3VudCsrXTsKICAgICAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7CiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uVmFsdWUgPSBnZXRQb3NpdGlvblZhbHVlKHBpZWNlLCByZWNvcmQuciwgcmVjb3JkLmMpOwogICAgICAgICAgICBpbmZvLnBpZWNlID0gcGllY2U7CiAgICAgICAgICAgIGluZm8uciA9IHJlY29yZC5yOwogICAgICAgICAgICBpbmZvLmMgPSByZWNvcmQuYzsKICAgICAgICAgICAgaW5mby5waWVjZUluZGV4ID0gY291bnQgLSAxOwogICAgICAgICAgICBpbmZvLm1hdGVyaWFsVmFsdWUgPSBtYXRlcmlhbFZhbHVlOwogICAgICAgICAgICBpbmZvLnBvc2l0aW9uVmFsdWUgPSBwb3NpdGlvblZhbHVlOwogICAgICAgICAgICBpbmZvLnRocmVhdFZhbHVlID0gMDsKICAgICAgICAgICAgaW5mby5zYWZldHlWYWx1ZSA9IDA7CiAgICAgICAgICAgIGluZm8udGFjdGljVmFsdWUgPSAwOwogICAgICAgICAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSAwOwogICAgICAgICAgICBwaWVjZXNJbmZvW2NvdW50IC0gMV0gPSBpbmZvOwogICAgICAgICAgICBpZiAocGllY2UuY29sb3IgPT09ICdyZWQnKSB7CiAgICAgICAgICAgICAgICByZWRNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOwogICAgICAgICAgICAgICAgcmVkUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsKICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIGJsYWNrTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsKICAgICAgICAgICAgICAgIGJsYWNrUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0gZWxzZSB7CiAgICAgICAgc2NhbkJvYXJkOiBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgewogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgewogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsKICAgICAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOwogICAgICAgICAgICAgICAgaWYgKGNvdW50ID49IHNjcmF0Y2hMZWFmUGllY2VTbG90cy5sZW5ndGgpIHsKICAgICAgICAgICAgICAgICAgICBvdmVyZmxvdyA9IHRydWU7CiAgICAgICAgICAgICAgICAgICAgYnJlYWsgc2NhbkJvYXJkOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgY29uc3QgaW5mbyA9IHNjcmF0Y2hMZWFmUGllY2VTbG90c1tjb3VudCsrXTsKICAgICAgICAgICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpOwogICAgICAgICAgICAgICAgY29uc3QgcG9zaXRpb25WYWx1ZSA9IGdldFBvc2l0aW9uVmFsdWUocGllY2UsIHIsIGMpOwogICAgICAgICAgICAgICAgaW5mby5waWVjZSA9IHBpZWNlOwogICAgICAgICAgICAgICAgaW5mby5yID0gcjsKICAgICAgICAgICAgICAgIGluZm8uYyA9IGM7CiAgICAgICAgICAgICAgICBpbmZvLnBpZWNlSW5kZXggPSBjb3VudCAtIDE7CiAgICAgICAgICAgICAgICBpbmZvLm1hdGVyaWFsVmFsdWUgPSBtYXRlcmlhbFZhbHVlOwogICAgICAgICAgICAgICAgaW5mby5wb3NpdGlvblZhbHVlID0gcG9zaXRpb25WYWx1ZTsKICAgICAgICAgICAgICAgIGluZm8udGhyZWF0VmFsdWUgPSAwOwogICAgICAgICAgICAgICAgaW5mby5zYWZldHlWYWx1ZSA9IDA7CiAgICAgICAgICAgICAgICBpbmZvLnRhY3RpY1ZhbHVlID0gMDsKICAgICAgICAgICAgICAgIGluZm8ubW9iaWxpdHlWYWx1ZSA9IDA7CiAgICAgICAgICAgICAgICBwaWVjZXNJbmZvW2NvdW50IC0gMV0gPSBpbmZvOwogICAgICAgICAgICAgICAgaWYgKHBpZWNlLmNvbG9yID09PSAncmVkJykgewogICAgICAgICAgICAgICAgICAgIHJlZE1hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7CiAgICAgICAgICAgICAgICAgICAgcmVkUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsKICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgYmxhY2tNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOwogICAgICAgICAgICAgICAgICAgIGJsYWNrUG9zaXRpb24gKz0gcG9zaXRpb25WYWx1ZTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KICAgIGlmIChvdmVyZmxvdykgewogICAgICAgIGNvbnN0IHJlc3VsdCA9IGV2YWx1YXRlQm9hcmQoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB7IGZvclNlYXJjaExlYWY6IHRydWUgfSk7CiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBzZWFyY2hJbml0aWF0b3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgIHJldHVybiByZXN1bHRbc2VhcmNoSW5pdGlhdG9yXS50b3RhbCAtIHJlc3VsdFtvcHBvbmVudF0udG90YWw7CiAgICB9CiAgICBwaWVjZXNJbmZvLmxlbmd0aCA9IGNvdW50OwoKICAgIGNsZWFyUmVsYXRpb25NYXNrcyh0cnVlKTsKICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsKICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOwogICAgY2FsY3VsYXRlRGVyaXZlZFZhbHVlcyhib2FyZCwgcGllY2VzSW5mbywgc2VhcmNoSW5pdGlhdG9yLCBzY3JhdGNoTGVhZkJvYXJkSW5mbywgdHJ1ZSk7CgogICAgbGV0IHJlZFRocmVhdCA9IDA7CiAgICBsZXQgcmVkVGFjdGljID0gMDsKICAgIGxldCByZWRTYWZldHkgPSAwOwogICAgbGV0IHJlZE1vYmlsaXR5ID0gMDsKICAgIGxldCBibGFja1RocmVhdCA9IDA7CiAgICBsZXQgYmxhY2tUYWN0aWMgPSAwOwogICAgbGV0IGJsYWNrU2FmZXR5ID0gMDsKICAgIGxldCBibGFja01vYmlsaXR5ID0gMDsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykgewogICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOwogICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJykgewogICAgICAgICAgICByZWRUaHJlYXQgKz0gaW5mby50aHJlYXRWYWx1ZTsKICAgICAgICAgICAgcmVkVGFjdGljICs9IGluZm8udGFjdGljVmFsdWU7CiAgICAgICAgICAgIHJlZFNhZmV0eSArPSBpbmZvLnNhZmV0eVZhbHVlOwogICAgICAgICAgICByZWRNb2JpbGl0eSArPSBpbmZvLm1vYmlsaXR5VmFsdWU7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgYmxhY2tUaHJlYXQgKz0gaW5mby50aHJlYXRWYWx1ZTsKICAgICAgICAgICAgYmxhY2tUYWN0aWMgKz0gaW5mby50YWN0aWNWYWx1ZTsKICAgICAgICAgICAgYmxhY2tTYWZldHkgKz0gaW5mby5zYWZldHlWYWx1ZTsKICAgICAgICAgICAgYmxhY2tNb2JpbGl0eSArPSBpbmZvLm1vYmlsaXR5VmFsdWU7CiAgICAgICAgfQogICAgfQoKICAgIGNvbnN0IHJlZFRvdGFsID0KICAgICAgICByZWRNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwgKwogICAgICAgIHJlZFBvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArCiAgICAgICAgcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKwogICAgICAgIHJlZFRhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljICsKICAgICAgICByZWRTYWZldHkgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSArCiAgICAgICAgcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5OwogICAgY29uc3QgYmxhY2tUb3RhbCA9CiAgICAgICAgYmxhY2tNYXRlcmlhbCAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwgKwogICAgICAgIGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsKICAgICAgICBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsKICAgICAgICBibGFja1RhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljICsKICAgICAgICBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsKICAgICAgICBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsKCiAgICBwZXJmU3RhdHMuZmFzdExlYWZFdmFsQ291bnQrKzsKICAgIHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxNcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7CiAgICByZXR1cm4gc2VhcmNoSW5pdGlhdG9yID09PSAncmVkJyA/IHJlZFRvdGFsIC0gYmxhY2tUb3RhbCA6IGJsYWNrVG90YWwgLSByZWRUb3RhbDsKfTsKDQovLyDlsIYv5biF5L2N572u57yT5a2Y77ya5L6bIHBvc3QtbW92ZSBpc0NoZWNrIC8g6aOe5bCG5b+r6YCf5p+l6K+i77yM55SxIG1ha2UvdW5tYWtlIOe7tOaKpA0KbGV0IGdlbmVyYWxQb3NDYWNoZSA9IHsgcmVkOiBudWxsLCBibGFjazogbnVsbCB9Ow0KDQovLyDlsIbluIXku4XlnKjkuZ3lrqvlhoXvvIzmjInkuZ3lrqvmiavmj4/ljbPlj68NCmNvbnN0IGZpbmRHZW5lcmFsUG9zID0gKGJvYXJkLCBjb2xvcikgPT4gew0KICAgIGNvbnN0IHJvd1N0YXJ0ID0gY29sb3IgPT09ICdyZWQnID8gMCA6IDc7DQogICAgY29uc3Qgcm93RW5kID0gY29sb3IgPT09ICdyZWQnID8gMiA6IDk7DQogICAgZm9yIChsZXQgciA9IHJvd1N0YXJ0OyByIDw9IHJvd0VuZDsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAzOyBjIDw9IDU7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyByLCBjIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgcmV0dXJuIG51bGw7DQp9Ow0KDQpjb25zdCBzeW5jR2VuZXJhbFBvc0NhY2hlID0gKGJvYXJkKSA9PiB7DQogICAgZ2VuZXJhbFBvc0NhY2hlLnJlZCA9IGZpbmRHZW5lcmFsUG9zKGJvYXJkLCAncmVkJyk7DQogICAgZ2VuZXJhbFBvc0NhY2hlLmJsYWNrID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsICdibGFjaycpOw0KfTsNCg0KY29uc3QgZ2V0R2VuZXJhbFBvcyA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBjb25zdCBjYWNoZWQgPSBnZW5lcmFsUG9zQ2FjaGVbY29sb3JdOw0KICAgIGlmIChjYWNoZWQpIHsNCiAgICAgICAgY29uc3QgcCA9IGJvYXJkW2NhY2hlZC5yXT8uW2NhY2hlZC5jXTsNCiAgICAgICAgaWYgKHAgJiYgcC50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgIHJldHVybiBjYWNoZWQ7DQogICAgICAgIH0NCiAgICB9DQogICAgY29uc3QgcG9zID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsIGNvbG9yKTsNCiAgICBnZW5lcmFsUG9zQ2FjaGVbY29sb3JdID0gcG9zOw0KICAgIHJldHVybiBwb3M7DQp9Ow0KDQovLyDmkJzntKLnlKjljp/lnLDotbDlrZAgLyDmgaLlpI3vvIjpgb/lhY3mr4/mrKHpgJLlvZIgYm9hcmQubWFw77yJ77yb5ZCM5q2l57u05oqk5bCG5L2N57yT5a2YDQpjb25zdCBtYWtlTW92ZSA9IChib2FyZCwgZnJvbSwgdG8pID0+IHsKICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbZnJvbS5yXVtmcm9tLmNdOwogICAgY29uc3QgY2FwdHVyZWQgPSBib2FyZFt0by5yXVt0by5jXTsKICAgIGJvYXJkW3RvLnJdW3RvLmNdID0gcGllY2U7CiAgICBib2FyZFtmcm9tLnJdW2Zyb20uY10gPSBudWxsOwogICAgdXBkYXRlUGllY2VTdGF0ZUFmdGVyTWFrZShib2FyZCwgZnJvbS5yICogOSArIGZyb20uYywgdG8uciAqIDkgKyB0by5jKTsKICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogdG8uciwgYzogdG8uYyB9Ow0KICAgIH0NCiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSBudWxsOw0KICAgIH0NCiAgICByZXR1cm4gY2FwdHVyZWQ7DQp9Ow0KDQpjb25zdCB1bm1ha2VNb3ZlID0gKGJvYXJkLCBmcm9tLCB0bywgY2FwdHVyZWQpID0+IHsKICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbdG8ucl1bdG8uY107DQogICAgYm9hcmRbZnJvbS5yXVtmcm9tLmNdID0gcGllY2U7CiAgICBib2FyZFt0by5yXVt0by5jXSA9IGNhcHR1cmVkOwogICAgdXBkYXRlUGllY2VTdGF0ZUFmdGVyVW5tYWtlKGJvYXJkLCBmcm9tLnIgKiA5ICsgZnJvbS5jLCB0by5yICogOSArIHRvLmMpOwogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbcGllY2UuY29sb3JdID0geyByOiBmcm9tLnIsIGM6IGZyb20uYyB9Ow0KICAgIH0NCiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSB7IHI6IHRvLnIsIGM6IHRvLmMgfTsNCiAgICB9DQp9Ow0KDQovLyDotbDlrZDlkI7mmK/lkKbkvb/lt7HmlrnlsIbkuI3lronlhajvvIjpo57lsIbmiJbooqvlsIbvvInjgILosIPnlKjliY3pobvlt7IgbWFrZU1vdmXjgIINCmNvbnN0IGxlYXZlc093bktpbmdVbnNhZmUgPSAoYm9hcmQsIGNvbG9yKSA9PiB7DQogICAgcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzKys7DQogICAgcmV0dXJuIGlzRmx5aW5nR2VuZXJhbChib2FyZCkgfHwgaXNDaGVja1Jhdyhib2FyZCwgY29sb3IpOw0KfTsNCg0KLy8g5LuO5Lyq5ZCI5rOV552A5rOV5Lit6L+H5ruk5Ye65LiN6YCB5bCGL+S4jemjnuWwhueahOWQiOazleedgOazle+8iFVJL+agueiKgueCuS/lvIDlsYDlupPmoKHpqozvvIkNCi8vIOaQnOe0oueDrei3r+W+hOS9v+eUqOW7tui/n+WQiOazleaAp++8iOivlei1sOaXtuajgOa1i++8ie+8jOmBv+WFjeWvueWJquaeneacquinpuWPiueahOedgOazleWBmuWFqOmHj+i/h+a7pA0KY29uc3QgZmlsdGVyTGVnYWxNb3ZlcyA9IChib2FyZCwgZnJvbSwgcGllY2UsIHBzZXVkb01vdmVzKSA9PiB7DQogICAgY29uc3QgdmFsaWRNb3ZlcyA9IFtdOw0KICAgIGZvciAoY29uc3QgdG8gb2YgcHNldWRvTW92ZXMpIHsNCiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlTW92ZShib2FyZCwgZnJvbSwgdG8pOw0KICAgICAgICBjb25zdCBpbGxlZ2FsID0gbGVhdmVzT3duS2luZ1Vuc2FmZShib2FyZCwgcGllY2UuY29sb3IpOw0KICAgICAgICB1bm1ha2VNb3ZlKGJvYXJkLCBmcm9tLCB0bywgY2FwdHVyZWQpOw0KICAgICAgICBpZiAoIWlsbGVnYWwpIHZhbGlkTW92ZXMucHVzaCh0byk7DQogICAgfQ0KICAgIHJldHVybiB2YWxpZE1vdmVzOw0KfTsNCg0KLy8gU2VhcmNoIGhvdCBwYXRoIG1vdmUgZW5jb2Rpbmc6IG1vdmUgPSAoZnJvbVNxIDw8IDcpIHwgdG9TcS4NCmNvbnN0IE1PVkVfVE9fTUFTSyA9IDB4N2Y7DQpjb25zdCBlbmNvZGVNb3ZlID0gKGZyb20sIHRvKSA9PiAoKGZyb20uciAqIDkgKyBmcm9tLmMpIDw8IDcpIHwgKHRvLnIgKiA5ICsgdG8uYyk7DQpjb25zdCBlbmNvZGVNb3ZlRnJvbUNvb3JkcyA9IChmciwgZmMsIHRyLCB0YykgPT4gKChmciAqIDkgKyBmYykgPDwgNykgfCAodHIgKiA5ICsgdGMpOw0KY29uc3QgaXNFbmNvZGVkTW92ZSA9IChtb3ZlKSA9PiB0eXBlb2YgbW92ZSA9PT0gJ251bWJlcic7DQpjb25zdCBtb3ZlRnJvbVNxID0gKG1vdmUpID0+IGlzRW5jb2RlZE1vdmUobW92ZSkgPyAobW92ZSA+Pj4gNykgOiBtb3ZlLmZyb20uciAqIDkgKyBtb3ZlLmZyb20uYzsNCmNvbnN0IG1vdmVUb1NxID0gKG1vdmUpID0+IGlzRW5jb2RlZE1vdmUobW92ZSkgPyAobW92ZSAmIE1PVkVfVE9fTUFTSykgOiBtb3ZlLnRvLnIgKiA5ICsgbW92ZS50by5jOw0KY29uc3QgbW92ZUZyb21SID0gKG1vdmUpID0+IHsNCiAgICBjb25zdCBzcSA9IG1vdmVGcm9tU3EobW92ZSk7DQogICAgcmV0dXJuIChzcSAvIDkpIHwgMDsNCn07DQpjb25zdCBtb3ZlRnJvbUMgPSAobW92ZSkgPT4gbW92ZUZyb21TcShtb3ZlKSAlIDk7DQpjb25zdCBtb3ZlVG9SID0gKG1vdmUpID0+IHsNCiAgICBjb25zdCBzcSA9IG1vdmVUb1NxKG1vdmUpOw0KICAgIHJldHVybiAoc3EgLyA5KSB8IDA7DQp9Ow0KY29uc3QgbW92ZVRvQyA9IChtb3ZlKSA9PiBtb3ZlVG9TcShtb3ZlKSAlIDk7DQpjb25zdCBtb3ZlVG9PYmplY3QgPSAobW92ZSkgPT4gew0KICAgIGlmICghaXNFbmNvZGVkTW92ZShtb3ZlKSkgcmV0dXJuIG1vdmU7DQogICAgY29uc3QgZnJvbSA9IG1vdmVGcm9tU3EobW92ZSk7DQogICAgY29uc3QgdG8gPSBtb3ZlVG9TcShtb3ZlKTsNCiAgICByZXR1cm4gew0KICAgICAgICBmcm9tOiB7IHI6IChmcm9tIC8gOSkgfCAwLCBjOiBmcm9tICUgOSB9LA0KICAgICAgICB0bzogeyByOiAodG8gLyA5KSB8IDAsIGM6IHRvICUgOSB9DQogICAgfTsNCn07DQoNCmNvbnN0IG1ha2VTZWFyY2hNb3ZlID0gKGJvYXJkLCBtb3ZlKSA9PiB7DQogICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSByZXR1cm4gbWFrZU1vdmUoYm9hcmQsIG1vdmUuZnJvbSwgbW92ZS50byk7DQogICAgY29uc3QgZnJvbSA9IG1vdmUgPj4+IDc7DQogICAgY29uc3QgdG8gPSBtb3ZlICYgTU9WRV9UT19NQVNLOw0KICAgIGNvbnN0IGZyID0gKGZyb20gLyA5KSB8IDAsIGZjID0gZnJvbSAlIDk7DQogICAgY29uc3QgdHIgPSAodG8gLyA5KSB8IDAsIHRjID0gdG8gJSA5Ow0KICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbZnJdW2ZjXTsNCiAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW3RyXVt0Y107CiAgICBib2FyZFt0cl1bdGNdID0gcGllY2U7CiAgICBib2FyZFtmcl1bZmNdID0gbnVsbDsKICAgIHVwZGF0ZVBpZWNlU3RhdGVBZnRlck1ha2UoYm9hcmQsIGZyb20sIHRvKTsKICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogdHIsIGM6IHRjIH07DQogICAgfQ0KICAgIGlmIChjYXB0dXJlZCAmJiBjYXB0dXJlZC50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IG51bGw7DQogICAgfQ0KICAgIHJldHVybiBjYXB0dXJlZDsNCn07DQoNCmNvbnN0IHVubWFrZVNlYXJjaE1vdmUgPSAoYm9hcmQsIG1vdmUsIGNhcHR1cmVkKSA9PiB7DQogICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSB7DQogICAgICAgIHVubWFrZU1vdmUoYm9hcmQsIG1vdmUuZnJvbSwgbW92ZS50bywgY2FwdHVyZWQpOw0KICAgICAgICByZXR1cm47DQogICAgfQ0KICAgIGNvbnN0IGZyb20gPSBtb3ZlID4+PiA3Ow0KICAgIGNvbnN0IHRvID0gbW92ZSAmIE1PVkVfVE9fTUFTSzsNCiAgICBjb25zdCBmciA9IChmcm9tIC8gOSkgfCAwLCBmYyA9IGZyb20gJSA5Ow0KICAgIGNvbnN0IHRyID0gKHRvIC8gOSkgfCAwLCB0YyA9IHRvICUgOTsNCiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3RyXVt0Y107CiAgICBib2FyZFtmcl1bZmNdID0gcGllY2U7CiAgICBib2FyZFt0cl1bdGNdID0gY2FwdHVyZWQ7CiAgICB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJVbm1ha2UoYm9hcmQsIGZyb20sIHRvKTsKICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogZnIsIGM6IGZjIH07DQogICAgfQ0KICAgIGlmIChjYXB0dXJlZCAmJiBjYXB0dXJlZC50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW2NhcHR1cmVkLmNvbG9yXSA9IHsgcjogdHIsIGM6IHRjIH07DQogICAgfQ0KfTsNCg0KY29uc3Qgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2ggPSBbXTsNCmNvbnN0IHNvcnRNb3ZlU2NvcmVTY3JhdGNoID0gW107DQpjb25zdCBzcXVhcmVNYXJrU2NyYXRjaCA9IG5ldyBVaW50OEFycmF5KFJFTF9TUVVBUkVTKTsNCmNvbnN0IHNxdWFyZU1hcmtUb3VjaGVkID0gW107DQoNCmNvbnN0IG1hcmtTb3J0U3F1YXJlID0gKHNxKSA9PiB7DQogICAgaWYgKCFzcXVhcmVNYXJrU2NyYXRjaFtzcV0pIHsNCiAgICAgICAgc3F1YXJlTWFya1NjcmF0Y2hbc3FdID0gMTsNCiAgICAgICAgc3F1YXJlTWFya1RvdWNoZWQucHVzaChzcSk7DQogICAgfQ0KfTsNCg0KY29uc3QgY2xlYXJTb3J0U3F1YXJlTWFya3MgPSAoKSA9PiB7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzcXVhcmVNYXJrVG91Y2hlZC5sZW5ndGg7IGkrKykgew0KICAgICAgICBzcXVhcmVNYXJrU2NyYXRjaFtzcXVhcmVNYXJrVG91Y2hlZFtpXV0gPSAwOw0KICAgIH0NCiAgICBzcXVhcmVNYXJrVG91Y2hlZC5sZW5ndGggPSAwOw0KfTsNCg0KY29uc3Qgc29ydE1vdmVzRmFzdCA9IChtb3ZlcywgYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIHBpZWNlc0luZm8sIGdhbWVTdGFnZSA9ICdtaWQnLCBib2FyZEluZm8gPSBudWxsLCBzZWFyY2hIZXVyaXN0aWNzID0gbnVsbCkgPT4gew0KICAgIGNvbnN0IGN1cnJlbnRJc0luQ2hlY2sgPSBib2FyZEluZm8NCiAgICAgICAgPyAoKGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnICYmIGJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8DQogICAgICAgICAgIChjdXJyZW50UGxheWVyID09PSAnYmxhY2snICYmIGJvYXJkSW5mby5ibGFja0lzSW5DaGVjaykpDQogICAgICAgIDogaXNDaGVjayhib2FyZCwgY3VycmVudFBsYXllcik7DQoNCiAgICBpZiAoY3VycmVudElzSW5DaGVjayAmJiBwaWVjZXNJbmZvICYmIHBpZWNlc0luZm8ubGVuZ3RoID4gMCkgew0KICAgICAgICBsZXQgZ2VuZXJhbEluZm8gPSBudWxsOw0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICAgICAgaWYgKGluZm8ucGllY2UgJiYgaW5mby5waWVjZS50eXBlID09PSAnZ2VuZXJhbCcgJiYgaW5mby5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgIGdlbmVyYWxJbmZvID0gaW5mbzsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoZ2VuZXJhbEluZm8pIHsNCiAgICAgICAgICAgIGlmIChib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpIHsNCiAgICAgICAgICAgICAgICBsZXQgbSA9IGJvYXJkSW5mby5hdHRhY2tNYXNrW2dlbmVyYWxJbmZvLnIgKiA5ICsgZ2VuZXJhbEluZm8uY10gPj4+IDA7DQogICAgICAgICAgICAgICAgd2hpbGUgKG0gIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgYml0ID0gbSAmIC1tOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0ID0gcGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV07DQogICAgICAgICAgICAgICAgICAgIGlmICh0ICYmIHQucGllY2UgJiYgdC5waWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgbWFya1NvcnRTcXVhcmUodC5yICogOSArIHQuYyk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgbSBePSBiaXQ7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIGlmIChnZW5lcmFsSW5mby50aHJlYXRlbmVkQnkpIHsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeS5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0ID0gZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5W2ldOw0KICAgICAgICAgICAgICAgICAgICBpZiAodC5waWVjZSAmJiB0LnBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBtYXJrU29ydFNxdWFyZSh0LnIgKiA5ICsgdC5jKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGNvbnN0IGhhc1RocmVhdGVuZWQgPSAhY3VycmVudElzSW5DaGVjayAmJiAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMgJiYgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMubGVuZ3RoID4gMCk7DQogICAgaWYgKGhhc1RocmVhdGVuZWQpIHsNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzW2ldOw0KICAgICAgICAgICAgbWFya1NvcnRTcXVhcmUocC5yICogOSArIHAuYyk7DQogICAgICAgIH0NCiAgICB9DQogICAgY29uc3QgdGhyZWF0ZW5lZE1hcmtFbmQgPSBzcXVhcmVNYXJrVG91Y2hlZC5sZW5ndGg7DQoNCiAgICBjb25zdCBoYXNDYW5DYXB0dXJlID0gIWN1cnJlbnRJc0luQ2hlY2sgJiYgISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby5jYW5DYXB0dXJlICYmIGJvYXJkSW5mby5jYW5DYXB0dXJlLmxlbmd0aCA+IDApOw0KICAgIGlmIChoYXNDYW5DYXB0dXJlKSB7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYm9hcmRJbmZvLmNhbkNhcHR1cmUubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZEluZm8uY2FuQ2FwdHVyZVtpXTsNCiAgICAgICAgICAgIG1hcmtTb3J0U3F1YXJlKHAuciAqIDkgKyBwLmMpOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3QgdHRNb3ZlID0gc2VhcmNoSGV1cmlzdGljcz8udHRNb3ZlIHx8IG51bGw7DQogICAgY29uc3Qga2lsbGVycyA9IHNlYXJjaEhldXJpc3RpY3M/LmtpbGxlcnMgfHwgbnVsbDsNCiAgICBjb25zdCBpc01hcmtlZFRocmVhdGVuZWQgPSAoc3EpID0+IHsNCiAgICAgICAgaWYgKCFoYXNUaHJlYXRlbmVkKSByZXR1cm4gZmFsc2U7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhyZWF0ZW5lZE1hcmtFbmQ7IGkrKykgew0KICAgICAgICAgICAgaWYgKHNxdWFyZU1hcmtUb3VjaGVkW2ldID09PSBzcSkgcmV0dXJuIHRydWU7DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIGZhbHNlOw0KICAgIH07DQoNCiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbW92ZXMubGVuZ3RoOyBpbmRleCsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpbmRleF07DQogICAgICAgIGNvbnN0IGZyb21TcSA9IG1vdmVGcm9tU3EobW92ZSk7DQogICAgICAgIGNvbnN0IHRvU3EgPSBtb3ZlVG9TcShtb3ZlKTsNCiAgICAgICAgY29uc3QgZnJvbVIgPSAoZnJvbVNxIC8gOSkgfCAwLCBmcm9tQyA9IGZyb21TcSAlIDk7DQogICAgICAgIGNvbnN0IHRvUiA9ICh0b1NxIC8gOSkgfCAwLCB0b0MgPSB0b1NxICUgOTsNCiAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtmcm9tUl1bZnJvbUNdOw0KICAgICAgICBjb25zdCBwaWVjZVZhbHVlID0gZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgY29uc3QgdGFyZ2V0UGllY2UgPSBib2FyZFt0b1JdW3RvQ107DQogICAgICAgIGNvbnN0IHRhcmdldFBpZWNlVmFsdWUgPSB0YXJnZXRQaWVjZSA/IGdldE1hdGVyaWFsVmFsdWUodGFyZ2V0UGllY2UsIGdhbWVTdGFnZSkgOiAwOw0KICAgICAgICBsZXQgcHJpb3JpdHkgPSA0Ow0KICAgICAgICBsZXQgc2NvcmUgPSAwOw0KDQogICAgICAgIGlmICh0dE1vdmUgJiYgaXNTYW1lTW92ZShtb3ZlLCB0dE1vdmUpKSB7DQogICAgICAgICAgICBwcmlvcml0eSA9IC0xOw0KICAgICAgICAgICAgc2NvcmUgPSAxMDAwMDAwOw0KICAgICAgICB9IGVsc2UgaWYgKGN1cnJlbnRJc0luQ2hlY2spIHsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVzQ2hlY2tlciA9IHRhcmdldFBpZWNlICYmIHNxdWFyZU1hcmtTY3JhdGNoW3RvU3FdICE9PSAwOw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVzQ2hlY2tlcikgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMDsNCiAgICAgICAgICAgICAgICBzY29yZSA9IDEwMDAwICsgdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDI7DQogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlICogMTYgLSBwaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICAgICAgc2NvcmUgPSBwaWVjZVZhbHVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKGhhc1RocmVhdGVuZWQpIHsNCiAgICAgICAgICAgIGlmIChpc01hcmtlZFRocmVhdGVuZWQoZnJvbVNxKSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMTsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHBpZWNlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBoYXNDYW5DYXB0dXJlICYmIHNxdWFyZU1hcmtTY3JhdGNoW3RvU3FdICE9PSAwID8gMiA6IDM7DQogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKGhhc0NhbkNhcHR1cmUpIHsNCiAgICAgICAgICAgIGlmIChzcXVhcmVNYXJrU2NyYXRjaFt0b1NxXSAhPT0gMCkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMjsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlICogMTYgLSBwaWVjZVZhbHVlOw0KICAgICAgICB9DQoNCiAgICAgICAgaWYgKHByaW9yaXR5ID49IDApIHsNCiAgICAgICAgICAgIGlmICghdGFyZ2V0UGllY2UgJiYga2lsbGVycyAmJiBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNbMF0pKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBNYXRoLm1pbihwcmlvcml0eSwgMik7DQogICAgICAgICAgICAgICAgc2NvcmUgKz0gODAwMDsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoIXRhcmdldFBpZWNlICYmIGtpbGxlcnMgJiYgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzWzFdKSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gTWF0aC5taW4ocHJpb3JpdHksIDIpOw0KICAgICAgICAgICAgICAgIHNjb3JlICs9IDcwMDA7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBzY29yZSArPSBnZXRIaXN0b3J5U2NvcmUobW92ZSk7DQogICAgICAgIH0NCg0KICAgICAgICBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtpbmRleF0gPSBwcmlvcml0eTsNCiAgICAgICAgc29ydE1vdmVTY29yZVNjcmF0Y2hbaW5kZXhdID0gc2NvcmU7DQogICAgICAgIGlmICghaXNFbmNvZGVkTW92ZShtb3ZlKSkgew0KICAgICAgICAgICAgbW92ZS5wcmlvcml0eSA9IHByaW9yaXR5Ow0KICAgICAgICAgICAgbW92ZS5zb3J0U2NvcmUgPSBzY29yZTsNCiAgICAgICAgICAgIG1vdmUub3JpZ2luYWxJbmRleCA9IGluZGV4Ow0KICAgICAgICB9DQogICAgfQ0KDQogICAgZm9yIChsZXQgaSA9IDE7IGkgPCBtb3Zlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbaV07DQogICAgICAgIGNvbnN0IHByaW9yaXR5ID0gc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaV07DQogICAgICAgIGNvbnN0IHNjb3JlID0gc29ydE1vdmVTY29yZVNjcmF0Y2hbaV07DQogICAgICAgIGxldCBqID0gaSAtIDE7DQogICAgICAgIHdoaWxlICgNCiAgICAgICAgICAgIGogPj0gMCAmJg0KICAgICAgICAgICAgKHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2pdID4gcHJpb3JpdHkgfHwNCiAgICAgICAgICAgICAoc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbal0gPT09IHByaW9yaXR5ICYmIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2pdIDwgc2NvcmUpKQ0KICAgICAgICApIHsNCiAgICAgICAgICAgIG1vdmVzW2ogKyAxXSA9IG1vdmVzW2pdOw0KICAgICAgICAgICAgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaiArIDFdID0gc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbal07DQogICAgICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqICsgMV0gPSBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqXTsNCiAgICAgICAgICAgIGotLTsNCiAgICAgICAgfQ0KICAgICAgICBtb3Zlc1tqICsgMV0gPSBtb3ZlOw0KICAgICAgICBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqICsgMV0gPSBwcmlvcml0eTsNCiAgICAgICAgc29ydE1vdmVTY29yZVNjcmF0Y2hbaiArIDFdID0gc2NvcmU7DQogICAgfQ0KDQogICAgY2xlYXJTb3J0U3F1YXJlTWFya3MoKTsNCiAgICByZXR1cm4gbW92ZXM7DQp9Ow0KDQovLyDmkJzntKLnlKjnnYDms5Xlh4blpIfvvIjovbvph4/vvInvvJrkuI3lu7rlhbPns7vlm74v5aiB6IOBL+acuuWKqOaApw0KLy8gU0VBUkNIX0RFRkVSX0xFR0FMSVRZPXRydWXvvJrlj6rnlJ/miJDkvKrlkIjms5XvvIzlkIjms5XmgKflnKjor5XotbDml7bmo4DmtYsNCi8vIFNFQVJDSF9ERUZFUl9MRUdBTElUWT1mYWxzZe+8mumihOi/h+a7pOWQiOazleedgO+8iOaXp+i3r+W+hO+8jOS+v+S6jiBBL0LvvIkNCi8vIOeCueaji+WFs+ezu+S7jei1sOWujOaVtCBldmFsdWF0ZUJvYXJk77yM5LiN5Y+X5b2x5ZONDQpjb25zdCBwcmVwYXJlU2VhcmNoSW5mbyA9IChib2FyZCwgY3VycmVudFBsYXllcikgPT4gew0KICAgIGNvbnN0IF9fdDAgPSBwZXJmb3JtYW5jZS5ub3coKTsNCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudFtjdXJyZW50UGxheWVyXSsrOw0KDQogICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2tSYXcoYm9hcmQsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIGNvbnN0IHBpZWNlc0luZm8gPSBbXTsKICAgIGNvbnN0IGxlZ2FsTW92ZUxpc3QgPSBbXTsKICAgIGNvbnN0IGRlZmVyID0gU0VBUkNIX0RFRkVSX0xFR0FMSVRZOwogICAgY29uc3QgcGllY2VTdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOwoKICAgIGlmIChwaWVjZVN0YXRlKSB7CiAgICAgICAgY29uc3QgcmVjb3JkcyA9IHBpZWNlU3RhdGUucmVjb3JkczsKICAgICAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsKICAgICAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsKICAgICAgICAgICAgY29uc3Qgc2xvdCA9IHNxdWFyZVRvU2xvdFtzcV07CiAgICAgICAgICAgIGlmIChzbG90IDwgMCkgY29udGludWU7CiAgICAgICAgICAgIGNvbnN0IHJlY29yZCA9IHJlY29yZHNbc2xvdF07CiAgICAgICAgICAgIGlmIChyZWNvcmQuYWxpdmUgJiYgcmVjb3JkLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7CiAgICAgICAgICAgICAgICBjb25zdCByID0gcmVjb3JkLnI7CiAgICAgICAgICAgICAgICBjb25zdCBjID0gcmVjb3JkLmM7CiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IHJlY29yZC5waWVjZTsKICAgICAgICAgICAgICAgIGNvbnN0IGZyb20gPSB7IHIsIGMgfTsKICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UpOwogICAgICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IG1vdmVzIDogZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UsIG1vdmVzKTsKICAgICAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7IHBpZWNlLCByLCBjLCBtb3ZlcywgbGVnYWxNb3ZlczogdXNlTW92ZXMgfSk7CiAgICAgICAgICAgICAgICBmb3IgKGxldCBqID0gMDsgaiA8IHVzZU1vdmVzLmxlbmd0aDsgaisrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tqXTsKICAgICAgICAgICAgICAgICAgICBsZWdhbE1vdmVMaXN0LnB1c2goZW5jb2RlTW92ZUZyb21Db29yZHMociwgYywgdG8uciwgdG8uYykpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IG1vdmVzLmxlbmd0aDsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0gZWxzZSB7CiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsKICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107CiAgICAgICAgICAgICAgICBpZiAoIXBpZWNlIHx8IHBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSBjb250aW51ZTsKICAgICAgICAgICAgICAgIGNvbnN0IGZyb20gPSB7IHIsIGMgfTsKICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UpOwogICAgICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IG1vdmVzIDogZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UsIG1vdmVzKTsKICAgICAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7IHBpZWNlLCByLCBjLCBtb3ZlcywgbGVnYWxNb3ZlczogdXNlTW92ZXMgfSk7CiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHVzZU1vdmVzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tpXTsKICAgICAgICAgICAgICAgICAgICBsZWdhbE1vdmVMaXN0LnB1c2goZW5jb2RlTW92ZUZyb21Db29yZHMociwgYywgdG8uciwgdG8uYykpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IG1vdmVzLmxlbmd0aDsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KDQogICAgLy8g6L276YePIGJvYXJkSW5mb++8muS7heiiq+Wwhuagh+W/lw0KICAgIGNvbnN0IGJvYXJkSW5mbyA9IHsNCiAgICAgICAgcmVkSXNJbkNoZWNrOiBjdXJyZW50UGxheWVyID09PSAncmVkJyA/IGluQ2hlY2sgOiBmYWxzZSwNCiAgICAgICAgYmxhY2tJc0luQ2hlY2s6IGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgPyBpbkNoZWNrIDogZmFsc2UsDQogICAgICAgIGdhbWVTdGF0ZTogbnVsbA0KICAgIH07DQoNCiAgICBpZiAobGVnYWxNb3ZlTGlzdC5sZW5ndGggPT09IDApIHsNCiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IGluQ2hlY2sNCiAgICAgICAgICAgID8geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH0NCiAgICAgICAgICAgIDogeyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfSBlbHNlIHsNCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAncGxheWluZycgfTsNCiAgICB9DQoNCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7DQogICAgcmV0dXJuIHsgcGllY2VzSW5mbywgYm9hcmRJbmZvLCBsZWdhbE1vdmVMaXN0LCBpbkNoZWNrIH07DQp9Ow0KDQovLyDorqHnrpfooY3nlJ/lgLzvvJrlqIHog4HlgLzjgIHlronlhajlgLzjgIHmiJjmnK/lgLzjgIHmnLrliqjlgLwNCmNvbnN0IGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMgPSAoYm9hcmQsIHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIgPSBudWxsLCBib2FyZEluZm8gPSBudWxsLCBmb3JTZWFyY2hMZWFmID0gZmFsc2UpID0+IHsNCiAgICAvLyDph43nva7miYDmnInooY3nlJ/lgLzvvIzpmaTkuobmnLrliqjlgLzvvIjlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpfvvIkNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpbmZvLnRocmVhdFZhbHVlID0gMDsNCiAgICAgICAgaW5mby5zYWZldHlWYWx1ZSA9IDA7DQogICAgICAgIGluZm8udGFjdGljVmFsdWUgPSAwOw0KICAgICAgICAvLyDkv53nlZnmnLrliqjlgLzvvIzlm6DkuLrlt7LlnKjmlLbpm4bmo4vlrZDkv6Hmga/ml7borqHnrpcNCiAgICB9DQogICAgDQogICAgLy8gMS4g6K6h566X5qOL5a2Q5YWz57O777yI5aiB6IOB6ICF44CB6KKr5aiB6IOB6ICF44CB5L+d5oqk6ICF44CB6KKr5L+d5oqk6ICF77yJDQogICAgaWYgKCFib2FyZEluZm8pIHsNCiAgICAgICAgYm9hcmRJbmZvID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkubWFwKCgpID0+IFtdKSk7DQogICAgfQ0KICAgIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zKGJvYXJkLCBwaWVjZXNJbmZvLCBib2FyZEluZm8pOw0KICAgIA0KICAgIC8vIDIuIOiuoeeul+WogeiDgeWAvO+8iOaMieiiq+WogeiDgeWtkOiBmuWQiO+8jFNFRSDmr4/nm67moIfkuIDmrKHvvIkNCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMocGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvLCBmb3JTZWFyY2hMZWFmKTsKICAgIA0KICAgIC8vIDMuIOiuoeeul+WuieWFqOWAvA0KICAgIGNhbGN1bGF0ZVNhZmV0eVZhbHVlcyhwaWVjZXNJbmZvLCBib2FyZEluZm8sIGJvYXJkLCBmb3JTZWFyY2hMZWFmKTsKICAgIA0KICAgIC8vIDQuIOiuoeeul+a4uOaIj+eKtuaAgeW5tuS/neWtmOWIsGJvYXJkSW5mbw0KICAgIC8vIOaQnOe0ouWPtuiKgueCuei3s+i/h++8muaXoOedgC/lsIbmrbvlt7LlnKjniLboioLngrnlpITnkIbvvIzmraTlpITlj6rpnIDpnZnmgIHliIYNCiAgICBpZiAoY3VycmVudFBsYXllciAmJiAhZm9yU2VhcmNoTGVhZikgew0KICAgICAgICAvLyDmo4Dmn6XlvZPliY3njqnlrrbmmK/lkKbmnInlkIjms5XotbDms5UNCiAgICAgICAgbGV0IGhhc01vdmVzID0gZmFsc2U7DQogICAgICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgICAgICBpZiAoaW5mby5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgIC8vIOiOt+WPluW9k+WJjeaji+WtkOeahOacieaViOi1sOazlQ0KICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0VmFsaWRNb3Zlcyhib2FyZCwgeyByOiBpbmZvLnIsIGM6IGluZm8uYyB9KTsNCiAgICAgICAgICAgICAgICBpZiAobW92ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgICAgICBoYXNNb3ZlcyA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy8g5Yik5pat5ri45oiP54q25oCBDQogICAgICAgIGxldCBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ3BsYXlpbmcnIH07DQogICAgICAgIGlmICghaGFzTW92ZXMpIHsNCiAgICAgICAgICAgIC8vIOayoeacieWQiOazlei1sOazle+8jOajgOafpeaYr+WQpuiiq+WwhuWGmw0KICAgICAgICAgICAgY29uc3QgaW5DaGVjayA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZElzSW5DaGVjayA6IGJvYXJkSW5mby5ibGFja0lzSW5DaGVjazsNCiAgICAgICAgICAgIGNvbnN0IG9wcG9uZW50ID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChpbkNoZWNrKSB7DQogICAgICAgICAgICAgICAgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDkv53lrZjmuLjmiI/nirbmgIHliLBib2FyZEluZm8NCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IGdhbWVTdGF0ZTsNCiAgICB9DQp9Ow0KDQovLyDmo4vlrZDlh6DkvZXmlrnlkJHooajvvIjpooTorqHnrpfohb8v55y85YGP56e777yM54Ot6Lev5b6E6YG/5YWNIE1hdGguc2lnbiAvIGRyLzLvvIkNCmNvbnN0IE9SVEhfRElSUyA9IFsNCiAgICBbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXQ0KXTsNCmNvbnN0IERJQUdfRElSUyA9IFsNCiAgICBbMSwgMV0sIFsxLCAtMV0sIFstMSwgMV0sIFstMSwgLTFdDQpdOw0KY29uc3QgRUxFUEhBTlRfRElSUyA9IFsNCiAgICB7IGRyOiAyLCBkYzogMiwgZXllRHI6IDEsIGV5ZURjOiAxIH0sDQogICAgeyBkcjogMiwgZGM6IC0yLCBleWVEcjogMSwgZXllRGM6IC0xIH0sDQogICAgeyBkcjogLTIsIGRjOiAyLCBleWVEcjogLTEsIGV5ZURjOiAxIH0sDQogICAgeyBkcjogLTIsIGRjOiAtMiwgZXllRHI6IC0xLCBleWVEYzogLTEgfQ0KXTsNCmNvbnN0IEhPUlNFX0RJUlMgPSBbDQogICAgeyBkcjogMiwgZGM6IDEsIGxlZ0RyOiAxLCBsZWdEYzogMCB9LA0KICAgIHsgZHI6IDIsIGRjOiAtMSwgbGVnRHI6IDEsIGxlZ0RjOiAwIH0sDQogICAgeyBkcjogLTIsIGRjOiAxLCBsZWdEcjogLTEsIGxlZ0RjOiAwIH0sDQogICAgeyBkcjogLTIsIGRjOiAtMSwgbGVnRHI6IC0xLCBsZWdEYzogMCB9LA0KICAgIHsgZHI6IDEsIGRjOiAyLCBsZWdEcjogMCwgbGVnRGM6IDEgfSwNCiAgICB7IGRyOiAxLCBkYzogLTIsIGxlZ0RyOiAwLCBsZWdEYzogLTEgfSwNCiAgICB7IGRyOiAtMSwgZGM6IDIsIGxlZ0RyOiAwLCBsZWdEYzogMSB9LA0KICAgIHsgZHI6IC0xLCBkYzogLTIsIGxlZ0RyOiAwLCBsZWdEYzogLTEgfQ0KXTsNCg0KLy8g55+t5q2l5a2Q6aKE6KGo77ya5LiO5Y6fIHN3aXRjaCDmlrnlkJHpobrluo8v5a6r5rKz6L+H5ruk5LiA6Ie077yb6ams6LGh5bimIGJyLGJj77yI6IW/L+ecvO+8iQ0KY29uc3QgR0VORVJBTF9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgQURWSVNPUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgRUxFUEhBTlRfREVTVCA9IFtuZXcgQXJyYXkoUkVMX1NRVUFSRVMpLCBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpXTsNCmNvbnN0IEhPUlNFX0RFU1QgPSBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpOw0KY29uc3QgU09MRElFUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KDQooKCkgPT4gew0KICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICBjb25zdCBzcSA9IHIgKiA5ICsgYzsNCiAgICAgICAgICAgIGNvbnN0IGdSZWQgPSBbXSwgZ0JsYWNrID0gW10sIGFSZWQgPSBbXSwgYUJsYWNrID0gW107DQogICAgICAgICAgICBjb25zdCBlUmVkID0gW10sIGVCbGFjayA9IFtdLCBob3JzZSA9IFtdLCBzUmVkID0gW10sIHNCbGFjayA9IFtdOw0KDQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIE9SVEhfRElSU1tpXVswXSwgbmMgPSBjICsgT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPj0gMCAmJiBuciA8PSAyKSBnUmVkLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgaWYgKG5yID49IDcgJiYgbnIgPD0gOSkgZ0JsYWNrLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IERJQUdfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIERJQUdfRElSU1tpXVswXSwgbmMgPSBjICsgRElBR19ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPj0gMCAmJiBuciA8PSAyKSBhUmVkLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgaWYgKG5yID49IDcgJiYgbnIgPD0gOSkgYUJsYWNrLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IEVMRVBIQU5UX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gRUxFUEhBTlRfRElSU1tpXTsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBkLmRyLCBuYyA9IGMgKyBkLmRjOw0KICAgICAgICAgICAgICAgIGlmIChuciA8IDAgfHwgbnIgPj0gUk9XUyB8fCBuYyA8IDAgfHwgbmMgPj0gQ09MUykgY29udGludWU7DQogICAgICAgICAgICAgICAgY29uc3QgZXllUiA9IHIgKyBkLmV5ZURyLCBleWVDID0gYyArIGQuZXllRGM7DQogICAgICAgICAgICAgICAgaWYgKG5yIDw9IDQpIGVSZWQucHVzaCh7IHI6IG5yLCBjOiBuYywgYnI6IGV5ZVIsIGJjOiBleWVDIH0pOw0KICAgICAgICAgICAgICAgIGlmIChuciA+PSA1KSBlQmxhY2sucHVzaCh7IHI6IG5yLCBjOiBuYywgYnI6IGV5ZVIsIGJjOiBleWVDIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBIT1JTRV9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IEhPUlNFX0RJUlNbaV07DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZC5kciwgbmMgPSBjICsgZC5kYzsNCiAgICAgICAgICAgICAgICBjb25zdCBsZWdSID0gciArIGQubGVnRHIsIGxlZ0MgPSBjICsgZC5sZWdEYzsNCiAgICAgICAgICAgICAgICBpZiAobGVnUiA8IDAgfHwgbGVnUiA+PSBST1dTIHx8IGxlZ0MgPCAwIHx8IGxlZ0MgPj0gQ09MUykgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKG5yIDwgMCB8fCBuciA+PSBST1dTIHx8IG5jIDwgMCB8fCBuYyA+PSBDT0xTKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBob3JzZS5wdXNoKHsgcjogbnIsIGM6IG5jLCBicjogbGVnUiwgYmM6IGxlZ0MgfSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICB7DQogICAgICAgICAgICAgICAgY29uc3QgZnIgPSByICsgMTsNCiAgICAgICAgICAgICAgICBpZiAoZnIgPj0gMCAmJiBmciA8IFJPV1MpIHNSZWQucHVzaCh7IHI6IGZyLCBjIH0pOw0KICAgICAgICAgICAgICAgIGlmIChyID49IDUpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGMgLSAxID49IDApIHNSZWQucHVzaCh7IHIsIGM6IGMgLSAxIH0pOw0KICAgICAgICAgICAgICAgICAgICBpZiAoYyArIDEgPCBDT0xTKSBzUmVkLnB1c2goeyByLCBjOiBjICsgMSB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgY29uc3QgZmJyID0gciAtIDE7DQogICAgICAgICAgICAgICAgaWYgKGZiciA+PSAwICYmIGZiciA8IFJPV1MpIHNCbGFjay5wdXNoKHsgcjogZmJyLCBjIH0pOw0KICAgICAgICAgICAgICAgIGlmIChyIDw9IDQpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGMgLSAxID49IDApIHNCbGFjay5wdXNoKHsgciwgYzogYyAtIDEgfSk7DQogICAgICAgICAgICAgICAgICAgIGlmIChjICsgMSA8IENPTFMpIHNCbGFjay5wdXNoKHsgciwgYzogYyArIDEgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBHRU5FUkFMX0RFU1RbMF1bc3FdID0gZ1JlZDsNCiAgICAgICAgICAgIEdFTkVSQUxfREVTVFsxXVtzcV0gPSBnQmxhY2s7DQogICAgICAgICAgICBBRFZJU09SX0RFU1RbMF1bc3FdID0gYVJlZDsNCiAgICAgICAgICAgIEFEVklTT1JfREVTVFsxXVtzcV0gPSBhQmxhY2s7DQogICAgICAgICAgICBFTEVQSEFOVF9ERVNUWzBdW3NxXSA9IGVSZWQ7DQogICAgICAgICAgICBFTEVQSEFOVF9ERVNUWzFdW3NxXSA9IGVCbGFjazsNCiAgICAgICAgICAgIEhPUlNFX0RFU1Rbc3FdID0gaG9yc2U7DQogICAgICAgICAgICBTT0xESUVSX0RFU1RbMF1bc3FdID0gc1JlZDsNCiAgICAgICAgICAgIFNPTERJRVJfREVTVFsxXVtzcV0gPSBzQmxhY2s7DQogICAgICAgIH0NCiAgICB9DQp9KSgpOw0KDQovLyDmqKHlnZfnuqfokL3ngrnlpITnkIbvvIjpnZ7mr4/lrZDmlrDlu7rpl63ljIXvvInvvJvov5Tlm57mnLrliqjlop7ph48NCi8vIHBpZWNlQXRTcTogOTAg5qC8IOKGkiBwaWVjZXNJbmZv77ybcmVsQ3R4LnVzZU1hc2tzIOaXtuWGmSBtYXNrDQpjb25zdCBhcHBseVJlbGF0aW9uU3F1YXJlID0gKGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIHRyLCB0YywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcikgPT4gew0KICAgIGlmICh0ciA8IDAgfHwgdHIgPj0gUk9XUyB8fCB0YyA8IDAgfHwgdGMgPj0gQ09MUykgcmV0dXJuIDA7DQogICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbdHJdW3RjXTsNCiAgICBpZiAoIXRhcmdldCkgew0KICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgIGNvbnN0IHNxID0gdHIgKiA5ICsgdGM7DQogICAgICAgICAgICBpZiAoIXJlbEN0eC5za2lwQ29udHJvbE1hc2spIHJlbEN0eC5jb250cm9sTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgaWYgKGlzUmVkKSBzZXRBdHRhY2tCaXQocmVsQ3R4LnJlZEF0dGFjaywgc3EpOw0KICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgICAgICAgICBpbmZvLmNvbnRyb2wucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5LmJhc2VNb3ZlVmFsdWU7DQogICAgfQ0KICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsNCiAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICBpZiAocGllY2VBdFNxW3RyICogOSArIHRjXSkgew0KICAgICAgICAgICAgICAgIHJlbEN0eC5hdHRhY2tNYXNrW3RyICogOSArIHRjXSB8PSBiaXQ7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW3RyICogOSArIHRjXTsNCiAgICAgICAgICAgIGlmICh0YXJnZXRJbmZvKSB7DQogICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLnRocmVhdGVuZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiAwOw0KICAgIH0NCiAgICBpZiAodGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgew0KICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW3RyICogOSArIHRjXTsNCiAgICAgICAgaWYgKHRhcmdldEluZm8gJiYgdGFyZ2V0SW5mbyAhPT0gaW5mbykgew0KICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgcmVsQ3R4Lmd1YXJkTWFza1t0ciAqIDkgKyB0Y10gfD0gYml0Ow0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBpbmZvLmd1YXJkLnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICBpbmZvLmFsbHlHdWFyZHMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICByZXR1cm4gMDsNCn07DQoNCi8vIOmdnueCru+8muS4gOasoeWHoOS9leaJq+aPj++8m+efreatpeWtkOi1sOmihOihqO+8jOi9puS7jeWwhOe6v++8m+ivreS5ieS4jiBnZXRQaWVjZU1vdmVzIOS4gOiHtA0KY29uc3QgZmlsbE5vbkNhbm5vblJlbGF0aW9ucyA9IChib2FyZCwgaW5mbywgcGllY2VBdFNxLCByZWxDdHggPSBudWxsKSA9PiB7DQogICAgY29uc3QgcGllY2UgPSBpbmZvLnBpZWNlOw0KICAgIGNvbnN0IHsgciwgYyB9ID0gaW5mbzsNCiAgICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCiAgICBjb25zdCBwaWVjZUNvbG9yID0gcGllY2UuY29sb3I7DQogICAgY29uc3QgdXNlTWFza3MgPSAhIShyZWxDdHggJiYgcmVsQ3R4LnVzZU1hc2tzKTsNCiAgICBjb25zdCBza2lwQ29udHJvbCA9IHVzZU1hc2tzICYmIHJlbEN0eC5za2lwQ29udHJvbE1hc2s7DQogICAgY29uc3QgYml0ID0gdXNlTWFza3MgPyAoMSA8PCByZWxDdHgucGllY2VJbmRleCkgOiAwOw0KICAgIGNvbnN0IGNvbG9ySWR4ID0gaXNSZWQgPyAwIDogMTsNCiAgICBjb25zdCBmcm9tU3EgPSByICogOSArIGM7DQogICAgaWYgKCF1c2VNYXNrcykgew0KICAgICAgICBpbmZvLm1vdmVzID0gW107DQogICAgICAgIGluZm8uY29udHJvbCA9IFtdOw0KICAgICAgICBpbmZvLmFsbHlHdWFyZHMgPSBbXTsNCiAgICB9DQogICAgbGV0IG1vYmlsaXR5VmFsdWUgPSAwOw0KDQogICAgc3dpdGNoIChwaWVjZS50eXBlKSB7DQogICAgICAgIGNhc2UgJ2dlbmVyYWwnOiB7DQogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEdFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVJlbGF0aW9uU3F1YXJlKA0KICAgICAgICAgICAgICAgICAgICBib2FyZCwgaW5mbywgcGllY2VBdFNxLCBkLnIsIGQuYywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcg0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBjYXNlICdhZHZpc29yJzogew0KICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBBRFZJU09SX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgZC5yLCBkLmMsIHVzZU1hc2tzLCBiaXQsIHJlbEN0eCwgaXNSZWQsIHBpZWNlQ29sb3INCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnZWxlcGhhbnQnOiB7DQogICAgICAgICAgICBjb25zdCBkZXN0cyA9IEVMRVBIQU5UX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgIGlmIChib2FyZFtkLmJyXVtkLmJjXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoDQogICAgICAgICAgICAgICAgICAgICAgICBib2FyZCwgaW5mbywgcGllY2VBdFNxLCBkLnIsIGQuYywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcg0KICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGNhc2UgJ2hvcnNlJzogew0KICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBIT1JTRV9ERVNUW2Zyb21TcV07DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgIGlmIChib2FyZFtkLmJyXVtkLmJjXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoDQogICAgICAgICAgICAgICAgICAgICAgICBib2FyZCwgaW5mbywgcGllY2VBdFNxLCBkLnIsIGQuYywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcg0KICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGNhc2UgJ2NoYXJpb3QnOg0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgICAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldCA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBuciAqIDkgKyBuYzsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXNraXBDb250cm9sKSByZWxDdHguY29udHJvbE1hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChyZWxDdHgucmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLmNvbnRyb2wucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5LmJhc2VNb3ZlVmFsdWU7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0LmNvbG9yICE9PSBwaWVjZUNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZUF0U3FbbnIgKiA5ICsgbmNdKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWxDdHguYXR0YWNrTWFza1tuciAqIDkgKyBuY10gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW25yICogOSArIG5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldEluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8udGhyZWF0LnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLnRocmVhdGVuZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0SW5mbyA9IHBpZWNlQXRTcVtuciAqIDkgKyBuY107DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldEluZm8gJiYgdGFyZ2V0SW5mbyAhPT0gaW5mbykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5ndWFyZE1hc2tbbnIgKiA5ICsgbmNdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8uZ3VhcmRlZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLmFsbHlHdWFyZHMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIG5yICs9IGRyOw0KICAgICAgICAgICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgY2FzZSAnc29sZGllcic6IHsNCiAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gU09MRElFUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoDQogICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGRlZmF1bHQ6DQogICAgICAgICAgICBicmVhazsNCiAgICB9DQogICAgaW5mby5tb2JpbGl0eVZhbHVlID0gbW9iaWxpdHlWYWx1ZTsNCn07DQoNCi8vIOeCru+8muS4gOasoeWbm+WQkeWwhOe6v++8m21hc2sg5qih5byP5YaZIGF0dGFjay9ndWFyZC9jb250cm9s77yM5YiX6KGo5qih5byP5L+d5oyB5pen6K+t5LmJDQpjb25zdCBmaWxsQ2Fubm9uUmVsYXRpb25zID0gKGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIHJlbEN0eCA9IG51bGwpID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGluZm8ucGllY2U7DQogICAgY29uc3QgeyByLCBjIH0gPSBpbmZvOw0KICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICAgIGNvbnN0IHBpZWNlQ29sb3IgPSBwaWVjZS5jb2xvcjsNCiAgICBjb25zdCB7IGJhc2VNb3ZlVmFsdWUgfSA9IEVWQUxVQVRJT05fUEFSQU1FVEVSUy5tb2JpbGl0eTsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKHJlbEN0eCAmJiByZWxDdHgudXNlTWFza3MpOw0KICAgIGNvbnN0IHNraXBDb250cm9sID0gdXNlTWFza3MgJiYgcmVsQ3R4LnNraXBDb250cm9sTWFzazsNCiAgICBjb25zdCBiaXQgPSB1c2VNYXNrcyA/ICgxIDw8IHJlbEN0eC5waWVjZUluZGV4KSA6IDA7DQogICAgaWYgKCF1c2VNYXNrcykgew0KICAgICAgICBpbmZvLm1vdmVzID0gW107DQogICAgICAgIGluZm8uY29udHJvbCA9IFtdOw0KICAgIH0NCiAgICBsZXQgbW9iaWxpdHlWYWx1ZSA9IDA7DQoNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGxldCBzY3JlZW5Gb3VuZENvdW50ID0gMDsNCiAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTICYmIHNjcmVlbkZvdW5kQ291bnQgPCAyKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICAgIGlmIChwICE9PSBudWxsKSB7DQogICAgICAgICAgICAgICAgc2NyZWVuRm91bmRDb3VudCsrOw0KICAgICAgICAgICAgICAgIGlmIChzY3JlZW5Gb3VuZENvdW50ID09PSAyKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbbnIgKiA5ICsgbmNdOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciAhPT0gcGllY2VDb2xvcikgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWxDdHguYXR0YWNrTWFza1tuciAqIDkgKyBuY10gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8udGhyZWF0LnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHAudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5ndWFyZE1hc2tbbnIgKiA5ICsgbmNdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLmd1YXJkLnB1c2godGFyZ2V0SW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8uZ3VhcmRlZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHAuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdXNlTWFza3MpIGluZm8ubW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKHNjcmVlbkZvdW5kQ291bnQgPT09IDApIHsNCiAgICAgICAgICAgICAgICBpZiAoIXVzZU1hc2tzKSBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmIChzY3JlZW5Gb3VuZENvdW50ID09PSAxKSB7DQogICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gbnIgKiA5ICsgbmM7DQogICAgICAgICAgICAgICAgICAgIGlmICghc2tpcENvbnRyb2wpIHJlbEN0eC5jb250cm9sTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChyZWxDdHgucmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgICAgIGVsc2Ugc2V0QXR0YWNrQml0KHJlbEN0eC5ibGFja0F0dGFjaywgc3EpOw0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIG5yICs9IGRyOw0KICAgICAgICAgICAgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICB9DQogICAgaW5mby5tb2JpbGl0eVZhbHVlID0gbW9iaWxpdHlWYWx1ZTsNCn07DQoNCi8vIOS7juagvOS9jSBtYXNrIOi/mOWOnyB0aHJlYXQvZ3VhcmQvY29udHJvbCDliJfooajvvIjngrnmo4svVUnvvIkNCmNvbnN0IGh5ZHJhdGVSZWxhdGlvbnNGcm9tTWFza3MgPSAocGllY2VzSW5mbywgYm9hcmRJbmZvKSA9PiB7DQogICAgY29uc3QgYXR0YWNrTWFzayA9IGJvYXJkSW5mby5hdHRhY2tNYXNrOw0KICAgIGNvbnN0IGd1YXJkTWFzayA9IGJvYXJkSW5mby5ndWFyZE1hc2s7DQogICAgY29uc3QgY29udHJvbE1hc2sgPSBib2FyZEluZm8uY29udHJvbE1hc2s7DQogICAgY29uc3QgbiA9IHBpZWNlc0luZm8ubGVuZ3RoOw0KICAgIGNvbnN0IGJ5U3EgPSBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpOw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7DQogICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICBpbmZvLnRocmVhdCA9IFtdOw0KICAgICAgICBpbmZvLnRocmVhdGVuZWRCeSA9IFtdOw0KICAgICAgICBpbmZvLmd1YXJkID0gW107DQogICAgICAgIGluZm8uZ3VhcmRlZEJ5ID0gW107DQogICAgICAgIGluZm8uY29udHJvbCA9IFtdOw0KICAgICAgICBieVNxW2luZm8uciAqIDkgKyBpbmZvLmNdID0gaW5mbzsNCiAgICB9DQoNCiAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsNCiAgICAgICAgY29uc3QgciA9IChzcSAvIDkpIHwgMDsNCiAgICAgICAgY29uc3QgYyA9IHNxICUgOTsNCiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYnlTcVtzcV07DQoNCiAgICAgICAgbGV0IGNtID0gY29udHJvbE1hc2tbc3FdID4+PiAwOw0KICAgICAgICB3aGlsZSAoY20gIT09IDApIHsNCiAgICAgICAgICAgIGNvbnN0IGJpdCA9IGNtICYgLWNtOw0KICAgICAgICAgICAgY29uc3QgaSA9IDMxIC0gTWF0aC5jbHozMihiaXQpOw0KICAgICAgICAgICAgcGllY2VzSW5mb1tpXS5jb250cm9sLnB1c2goeyByLCBjIH0pOw0KICAgICAgICAgICAgY20gXj0gYml0Ow0KICAgICAgICB9DQoNCiAgICAgICAgbGV0IGFtID0gYXR0YWNrTWFza1tzcV0gPj4+IDA7DQogICAgICAgIHdoaWxlIChhbSAhPT0gMCkgew0KICAgICAgICAgICAgY29uc3QgYml0ID0gYW0gJiAtYW07DQogICAgICAgICAgICBjb25zdCBpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7DQogICAgICAgICAgICBjb25zdCBhdHRhY2tlciA9IHBpZWNlc0luZm9baV07DQogICAgICAgICAgICBpZiAodGFyZ2V0ICYmIHRhcmdldCAhPT0gYXR0YWNrZXIgJiYgdGFyZ2V0LnBpZWNlLmNvbG9yICE9PSBhdHRhY2tlci5waWVjZS5jb2xvcikgew0KICAgICAgICAgICAgICAgIGF0dGFja2VyLnRocmVhdC5wdXNoKHRhcmdldCk7DQogICAgICAgICAgICAgICAgdGFyZ2V0LnRocmVhdGVuZWRCeS5wdXNoKGF0dGFja2VyKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGFtIF49IGJpdDsNCiAgICAgICAgfQ0KDQogICAgICAgIGxldCBnbSA9IGd1YXJkTWFza1tzcV0gPj4+IDA7DQogICAgICAgIHdoaWxlIChnbSAhPT0gMCkgew0KICAgICAgICAgICAgY29uc3QgYml0ID0gZ20gJiAtZ207DQogICAgICAgICAgICBjb25zdCBpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7DQogICAgICAgICAgICBjb25zdCBndWFyZGVyID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgICAgIGlmICh0YXJnZXQgJiYgdGFyZ2V0ICE9PSBndWFyZGVyICYmIHRhcmdldC5waWVjZS5jb2xvciA9PT0gZ3VhcmRlci5waWVjZS5jb2xvcikgew0KICAgICAgICAgICAgICAgIGd1YXJkZXIuZ3VhcmQucHVzaCh0YXJnZXQpOw0KICAgICAgICAgICAgICAgIHRhcmdldC5ndWFyZGVkQnkucHVzaChndWFyZGVyKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGdtIF49IGJpdDsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOS+myBpc1Bvc2l0aW9uQWNjZXB0YWJsZSAvIOeCueajiyBjb250cm9sbGVyc++8muS4juaXp+ivreS5ieS4gOiHtO+8jOS7heepuuaOp+agvA0KICAgIGNvbnN0IGdyaWQgPSBtYWtlRW1wdHlDb250cm9sbGVyR3JpZCgpOw0KICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgew0KICAgICAgICBsZXQgY20gPSBjb250cm9sTWFza1tzcV0gPj4+IDA7DQogICAgICAgIGlmIChjbSA9PT0gMCkgY29udGludWU7DQogICAgICAgIGNvbnN0IHIgPSAoc3EgLyA5KSB8IDA7DQogICAgICAgIGNvbnN0IGMgPSBzcSAlIDk7DQogICAgICAgIHdoaWxlIChjbSAhPT0gMCkgew0KICAgICAgICAgICAgY29uc3QgYml0ID0gY20gJiAtY207DQogICAgICAgICAgICBjb25zdCBpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7DQogICAgICAgICAgICBncmlkW3JdW2NdLnB1c2gocGllY2VzSW5mb1tpXSk7DQogICAgICAgICAgICBjbSBePSBiaXQ7DQogICAgICAgIH0NCiAgICB9DQogICAgYm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkID0gZ3JpZDsNCn07DQoNCi8vIOiuoeeul+aji+WtkOWFs+ezu++8mm1hc2sg6Lev5b6E5YaZIFVpbnQzMiDmoLzkvY3ooajvvJvliJfooajot6/lvoTkv53mjIHml6cgcHVzaA0KY29uc3QgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMgPSAoYm9hcmQsIHBpZWNlc0luZm8sIGJvYXJkSW5mbykgPT4gew0KICAgIGNvbnN0IHVzZU1hc2tzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKTsNCiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VBdHRhY2tCaXRzKSAmJiAhdXNlTWFza3M7DQoNCiAgICBpZiAoIXVzZU1hc2tzKSB7DQogICAgICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgICAgICBpbmZvLnRocmVhdCA9IFtdOw0KICAgICAgICAgICAgaW5mby50aHJlYXRlbmVkQnkgPSBbXTsNCiAgICAgICAgICAgIGluZm8uZ3VhcmQgPSBbXTsNCiAgICAgICAgICAgIGluZm8uZ3VhcmRlZEJ5ID0gW107DQogICAgICAgICAgICBpbmZvLmNvbnRyb2wgPSBbXTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGlmICghYm9hcmRJbmZvKSB7DQogICAgICAgIGJvYXJkSW5mbyA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7DQogICAgfQ0KDQogICAgY2xlYXJQaWVjZUF0U3EoKTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07DQogICAgICAgIGlmIChpbmZvLnBpZWNlSW5kZXggPT0gbnVsbCkgaW5mby5waWVjZUluZGV4ID0gaTsNCiAgICAgICAgc2NyYXRjaFBpZWNlQXRTcVtpbmZvLnIgKiA5ICsgaW5mby5jXSA9IGluZm87DQogICAgfQ0KDQogICAgbGV0IHJlbEN0eCA9IG51bGw7DQogICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgIHJlbEN0eCA9IHNjcmF0Y2hSZWxDdHg7DQogICAgICAgIHJlbEN0eC51c2VNYXNrcyA9IHRydWU7DQogICAgICAgIHJlbEN0eC5za2lwQ29udHJvbE1hc2sgPSAhIWJvYXJkSW5mby5za2lwQ29udHJvbE1hc2s7DQogICAgICAgIHJlbEN0eC5hdHRhY2tNYXNrID0gYm9hcmRJbmZvLmF0dGFja01hc2s7DQogICAgICAgIHJlbEN0eC5ndWFyZE1hc2sgPSBib2FyZEluZm8uZ3VhcmRNYXNrOw0KICAgICAgICByZWxDdHguY29udHJvbE1hc2sgPSBib2FyZEluZm8uY29udHJvbE1hc2s7DQogICAgICAgIHJlbEN0eC5yZWRBdHRhY2sgPSBib2FyZEluZm8ucmVkQXR0YWNrOw0KICAgICAgICByZWxDdHguYmxhY2tBdHRhY2sgPSBib2FyZEluZm8uYmxhY2tBdHRhY2s7DQogICAgfQ0KDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICBpZiAocmVsQ3R4KSByZWxDdHgucGllY2VJbmRleCA9IGluZm8ucGllY2VJbmRleDsNCg0KICAgICAgICBpZiAoaW5mby5waWVjZS50eXBlID09PSAnY2Fubm9uJykgew0KICAgICAgICAgICAgZmlsbENhbm5vblJlbGF0aW9ucyhib2FyZCwgaW5mbywgc2NyYXRjaFBpZWNlQXRTcSwgcmVsQ3R4KTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGZpbGxOb25DYW5ub25SZWxhdGlvbnMoYm9hcmQsIGluZm8sIHNjcmF0Y2hQaWVjZUF0U3EsIHJlbEN0eCk7DQogICAgICAgIH0NCg0KICAgICAgICBpZiAoIXVzZU1hc2tzKSB7DQogICAgICAgICAgICBjb25zdCBjb250cm9sID0gaW5mby5jb250cm9sOw0KICAgICAgICAgICAgaWYgKHVzZUF0dGFja0JpdHMpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBiaXRzID0gaW5mby5waWVjZS5jb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkQXR0YWNrIDogYm9hcmRJbmZvLmJsYWNrQXR0YWNrOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgY29udHJvbC5sZW5ndGg7IGsrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3MgPSBjb250cm9sW2tdOw0KICAgICAgICAgICAgICAgICAgICBzZXRBdHRhY2tCaXQoYml0cywgcG9zLnIgKiA5ICsgcG9zLmMpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShib2FyZEluZm9bMF0pKSB7DQogICAgICAgICAgICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBjb250cm9sLmxlbmd0aDsgaysrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvcyA9IGNvbnRyb2xba107DQogICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mb1twb3Mucl1bcG9zLmNdLnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgbGV0IHJlZElzSW5DaGVjayA9IGZhbHNlOw0KICAgIGxldCBibGFja0lzSW5DaGVjayA9IGZhbHNlOw0KICAgIGxldCByZWRHZW5lcmFsSW5mbyA9IG51bGw7DQogICAgbGV0IGJsYWNrR2VuZXJhbEluZm8gPSBudWxsOw0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGlmIChpbmZvLnBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgaWYgKGluZm8ucGllY2UuY29sb3IgPT09ICdyZWQnKSByZWRHZW5lcmFsSW5mbyA9IGluZm87DQogICAgICAgICAgICBlbHNlIGJsYWNrR2VuZXJhbEluZm8gPSBpbmZvOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgIGlmIChyZWRHZW5lcmFsSW5mbyAmJiBib2FyZEluZm8uYXR0YWNrTWFza1tyZWRHZW5lcmFsSW5mby5yICogOSArIHJlZEdlbmVyYWxJbmZvLmNdICE9PSAwKSB7DQogICAgICAgICAgICByZWRJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICB9DQogICAgICAgIGlmIChibGFja0dlbmVyYWxJbmZvICYmIGJvYXJkSW5mby5hdHRhY2tNYXNrW2JsYWNrR2VuZXJhbEluZm8uciAqIDkgKyBibGFja0dlbmVyYWxJbmZvLmNdICE9PSAwKSB7DQogICAgICAgICAgICBibGFja0lzSW5DaGVjayA9IHRydWU7DQogICAgICAgIH0NCiAgICB9IGVsc2Ugew0KICAgICAgICBpZiAocmVkR2VuZXJhbEluZm8pIHsNCiAgICAgICAgICAgIGZvciAoY29uc3QgdGhyZWF0ZW5lciBvZiByZWRHZW5lcmFsSW5mby50aHJlYXRlbmVkQnkpIHsNCiAgICAgICAgICAgICAgICBpZiAodGhyZWF0ZW5lci5waWVjZS5jb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICByZWRJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKGJsYWNrR2VuZXJhbEluZm8pIHsNCiAgICAgICAgICAgIGZvciAoY29uc3QgdGhyZWF0ZW5lciBvZiBibGFja0dlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgew0KICAgICAgICAgICAgICAgIGlmICh0aHJlYXRlbmVyLnBpZWNlLmNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgICAgICBibGFja0lzSW5DaGVjayA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGlmIChyZWRHZW5lcmFsSW5mbyAmJiBibGFja0dlbmVyYWxJbmZvICYmIHJlZEdlbmVyYWxJbmZvLmMgPT09IGJsYWNrR2VuZXJhbEluZm8uYykgew0KICAgICAgICBsZXQgaGFzUGllY2VCZXR3ZWVuID0gZmFsc2U7DQogICAgICAgIGNvbnN0IHN0YXJ0UiA9IE1hdGgubWluKHJlZEdlbmVyYWxJbmZvLnIsIGJsYWNrR2VuZXJhbEluZm8ucikgKyAxOw0KICAgICAgICBjb25zdCBlbmRSID0gTWF0aC5tYXgocmVkR2VuZXJhbEluZm8uciwgYmxhY2tHZW5lcmFsSW5mby5yKSAtIDE7DQogICAgICAgIGZvciAobGV0IHIgPSBzdGFydFI7IHIgPD0gZW5kUjsgcisrKSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbcl1bcmVkR2VuZXJhbEluZm8uY10pIHsNCiAgICAgICAgICAgICAgICBoYXNQaWVjZUJldHdlZW4gPSB0cnVlOw0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmICghaGFzUGllY2VCZXR3ZWVuKSB7DQogICAgICAgICAgICByZWRJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgYm9hcmRJbmZvLnJlZElzSW5DaGVjayA9IHJlZElzSW5DaGVjazsNCiAgICBib2FyZEluZm8uYmxhY2tJc0luQ2hlY2sgPSBibGFja0lzSW5DaGVjazsNCn07DQoNCmNvbnN0IGlzUG9zaXRpb25BY2NlcHRhYmxlID0gKGJvYXJkLCBmcm9tLCB0bywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvID0gbnVsbCwgcGllY2VzSW5mbyA9IG51bGwsIHRyeU1vdmVQaWVjZSA9IG51bGwsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgY29uc3QgbW92aW5nUGllY2UgPSB0cnlNb3ZlUGllY2UgfHwgYm9hcmRbZnJvbS5yXVtmcm9tLmNdOw0KICAgIGNvbnN0IHRhcmdldFBpZWNlID0gYm9hcmRbdG8ucl1bdG8uY107DQogICAgY29uc3QgaXNDYXB0dXJlID0gdGFyZ2V0UGllY2UgJiYgdGFyZ2V0UGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXI7DQoNCiAgICAvLyDmlLbpm4bmiYDmnInmo4vlrZDkv6Hmga/vvIzlj6rlnKjmsqHmnInmj5Dkvpvml7borqHnrpcNCiAgICBsZXQgbG9jYWxQaWVjZXNJbmZvID0gcGllY2VzSW5mbzsNCiAgICBpZiAoIWxvY2FsUGllY2VzSW5mbykgew0KICAgICAgICBsb2NhbFBpZWNlc0luZm8gPSBbXTsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgYWxseUd1YXJkcyA9IFtdOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBtb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSwgYWxseUd1YXJkcyk7DQogICAgICAgICAgICAgICAgICAgIGxvY2FsUGllY2VzSW5mby5wdXNoKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlLA0KICAgICAgICAgICAgICAgICAgICAgICAgciwgYywgbW92ZXMsIGFsbHlHdWFyZHMsDQogICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlOiBnZXRNYXRlcmlhbFZhbHVlKHBpZWNlLCBnYW1lU3RhZ2UpLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeTogW10sDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZDogW10sDQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZGVkQnk6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdFZhbHVlOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICB0YWN0aWNWYWx1ZTogMA0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDorqHnrpfmo4vlrZDlhbPns7vlkozmjqfliLbkv6Hmga/vvIzlj6rlnKjmsqHmnInmj5Dkvpvml7borqHnrpcNCiAgICBsZXQgbG9jYWxCb2FyZEluZm8gPSBib2FyZEluZm87DQogICAgaWYgKCFsb2NhbEJvYXJkSW5mbykgew0KICAgICAgICBpZiAoU0VBUkNIX1JFTEFUSU9OX01BU0tTICYmIGxvY2FsUGllY2VzSW5mby5sZW5ndGggPD0gMzIpIHsNCiAgICAgICAgICAgIGNsZWFyUmVsYXRpb25NYXNrcygpOw0KICAgICAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOw0KICAgICAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxvY2FsUGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGxvY2FsUGllY2VzSW5mb1tpXS5waWVjZUluZGV4ID0gaTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGxvY2FsQm9hcmRJbmZvID0gew0KICAgICAgICAgICAgICAgIHVzZVJlbGF0aW9uTWFza3M6IHRydWUsDQogICAgICAgICAgICAgICAgdXNlQXR0YWNrQml0czogdHJ1ZSwNCiAgICAgICAgICAgICAgICBhdHRhY2tNYXNrOiBzY3JhdGNoQXR0YWNrTWFzaywNCiAgICAgICAgICAgICAgICBndWFyZE1hc2s6IHNjcmF0Y2hHdWFyZE1hc2ssDQogICAgICAgICAgICAgICAgY29udHJvbE1hc2s6IHNjcmF0Y2hDb250cm9sTWFzaywNCiAgICAgICAgICAgICAgICByZWRBdHRhY2s6IHNjcmF0Y2hSZWRBdHRhY2ssDQogICAgICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICAgICAgfTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGxvY2FsQm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsNCiAgICAgICAgfQ0KICAgICAgICBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyhib2FyZCwgbG9jYWxQaWVjZXNJbmZvLCBsb2NhbEJvYXJkSW5mbyk7DQogICAgfQ0KDQogICAgLy8g5o6n5Yi26ICF77yabWFzayDnlKggY29udHJvbE1hc2vvvJvml6fot6/lvoTnlKggYm9hcmRJbmZvW3JdW2Nd77ybaHlkcmF0ZSDlkI7lj6/nlKggY29udHJvbGxlckdyaWQNCiAgICBsZXQgY29udHJvbGxlcnM7DQogICAgaWYgKGxvY2FsQm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpIHsNCiAgICAgICAgY29udHJvbGxlcnMgPSBbXTsNCiAgICAgICAgZm9yRWFjaFNldEJpdChsb2NhbEJvYXJkSW5mby5jb250cm9sTWFza1t0by5yICogOSArIHRvLmNdLCAoaSkgPT4gew0KICAgICAgICAgICAgY29udHJvbGxlcnMucHVzaChsb2NhbFBpZWNlc0luZm9baV0pOw0KICAgICAgICB9KTsNCiAgICB9IGVsc2UgaWYgKGxvY2FsQm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkKSB7DQogICAgICAgIGNvbnRyb2xsZXJzID0gbG9jYWxCb2FyZEluZm8uY29udHJvbGxlckdyaWRbdG8ucl1bdG8uY10gfHwgW107DQogICAgfSBlbHNlIHsNCiAgICAgICAgY29udHJvbGxlcnMgPSBsb2NhbEJvYXJkSW5mb1t0by5yXVt0by5jXSB8fCBbXTsNCiAgICB9DQogICAgbGV0IGhhc0FsbHlDb250cm9sbGVyID0gZmFsc2U7DQogICAgbGV0IGhhc0VuZW15Q29udHJvbGxlciA9IGZhbHNlOw0KDQogICAgLy8g5o6n5Yi26ICF5Y+v6IO95pivIHBpZWNlc0luZm8g5byV55SoIHtwaWVjZSxyLGN9IOaIluaXp+e7k+aehCB7Y29sb3IsdHlwZSxyLGN9DQogICAgY29uc3QgY29udHJvbGxlckNvbG9yID0gKGNvbnRyb2xsZXIpID0+DQogICAgICAgIGNvbnRyb2xsZXIucGllY2UgPyBjb250cm9sbGVyLnBpZWNlLmNvbG9yIDogY29udHJvbGxlci5jb2xvcjsNCg0KICAgIGZvciAoY29uc3QgY29udHJvbGxlciBvZiBjb250cm9sbGVycykgew0KICAgICAgICAvLyDmjpLpmaTmraPlnKjnp7vliqjnmoTmo4vlrZDmnKzouqvvvIjotbDlkI7lroPkuI3lho3ku47ljp/kvY3mjqfliLbnm67moIfvvIkNCiAgICAgICAgaWYgKG1vdmluZ1BpZWNlICYmIGNvbnRyb2xsZXIuciA9PT0gZnJvbS5yICYmIGNvbnRyb2xsZXIuYyA9PT0gZnJvbS5jKSB7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoY29udHJvbGxlckNvbG9yKGNvbnRyb2xsZXIpID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICBoYXNBbGx5Q29udHJvbGxlciA9IHRydWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBoYXNFbmVteUNvbnRyb2xsZXIgPSB0cnVlOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgaWYgKGlzQ2FwdHVyZSkgew0KICAgICAgICAvLyDnmb3lkIPvvJrnm67moIfmnKrooqvmlYzmlrnkv53miqQNCiAgICAgICAgaWYgKCFoYXNFbmVteUNvbnRyb2xsZXIpIHsNCiAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgICAgIC8vIOeugOWNlSBTRUXvvJrlhYjlvpfnm67moIfliIbvvIzoi6XkvJrooqvlj43lkIPliJnlho3lpLHlt7Hmlrnmo4vlrZANCiAgICAgICAgY29uc3QgdGFyZ2V0VmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHRhcmdldFBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCBvdXJWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUobW92aW5nUGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgIGxldCBzZWUgPSB0YXJnZXRWYWx1ZSAtIG91clZhbHVlOw0KICAgICAgICAvLyDoi6XmnInlt7Hmlrnnu6fnu63kv53miqTvvIznspfnlaXorqTkuLrlj6/og73lho3lkIPlm57mnIDkvY7ku7flgLznmoTmlYzmlrnkv53miqTogIUNCiAgICAgICAgaWYgKGhhc0FsbHlDb250cm9sbGVyKSB7DQogICAgICAgICAgICBjb25zdCBlbmVteUd1YXJkVmFsdWVzID0gY29udHJvbGxlcnMNCiAgICAgICAgICAgICAgICAuZmlsdGVyKGMgPT4gY29udHJvbGxlckNvbG9yKGMpICE9PSBjdXJyZW50UGxheWVyICYmICEoYy5yID09PSBmcm9tLnIgJiYgYy5jID09PSBmcm9tLmMpKQ0KICAgICAgICAgICAgICAgIC5tYXAoYyA9PiB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtjLnJdW2MuY107DQogICAgICAgICAgICAgICAgICAgIHJldHVybiBwID8gZ2V0TWF0ZXJpYWxWYWx1ZShwLCBnYW1lU3RhZ2UpIDogMDsNCiAgICAgICAgICAgICAgICB9KQ0KICAgICAgICAgICAgICAgIC5maWx0ZXIodiA9PiB2ID4gMCkNCiAgICAgICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gYSAtIGIpOw0KICAgICAgICAgICAgaWYgKGVuZW15R3VhcmRWYWx1ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgIHNlZSArPSBlbmVteUd1YXJkVmFsdWVzWzBdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIC8vIOaYjuaYvuS6j+aNou+8iOWmgui9puaNouaXoOagueWFteS4lOS8muiiq+WPjeWQg++8ieWImei/h+a7pO+8m+W5s+aNoi/otZrmjaLnlZnnu5nmkJzntKINCiAgICAgICAgcmV0dXJuIHNlZSA+PSAwOw0KICAgIH0NCg0KICAgIC8vIOmdnuWQg+WtkO+8muebruagh+S7heiiq+aVjOaWueaOp+WItuWImeinhuS4uumAgeWQgw0KICAgIGlmIChjb250cm9sbGVycy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHRydWU7DQogICAgfQ0KICAgIHJldHVybiAhaGFzRW5lbXlDb250cm9sbGVyIHx8IGhhc0FsbHlDb250cm9sbGVyOw0KfTsNCg0KLy8gU0VFIOaOkuW6j+WkjeeUqOe8k+WGsu+8jOmZjeS9juWPtuivhOS8sCBHQw0KY29uc3Qgc2VlQXR0YWNrZXJTY3JhdGNoID0gW107DQpjb25zdCBzZWVHdWFyZFNjcmF0Y2ggPSBbXTsNCmNvbnN0IHNlZUF0dGFja2VyTWF0U2NyYXRjaCA9IFtdOw0KY29uc3Qgc2VlR3VhcmRNYXRTY3JhdGNoID0gW107DQoNCi8vIOacieagueWtkOeugOWMliBTRUXvvIjkuI7ml6flrp7njrDpgJDooYznrYnku7fvvInvvJvmr4/kuKrnm67moIflj6rlupTosIPnlKjkuIDmrKENCmNvbnN0IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmUgPSAodGhyZWF0ZW5lZFBpZWNlKSA9PiB7DQogICAgY29uc3QgYXR0YWNrZXJzID0gc2VlQXR0YWNrZXJTY3JhdGNoOw0KICAgIGNvbnN0IGd1YXJkcyA9IHNlZUd1YXJkU2NyYXRjaDsNCiAgICBhdHRhY2tlcnMubGVuZ3RoID0gMDsNCiAgICBndWFyZHMubGVuZ3RoID0gMDsNCiAgICBjb25zdCByYXdBdHRhY2tlcnMgPSB0aHJlYXRlbmVkUGllY2UudGhyZWF0ZW5lZEJ5Ow0KICAgIGNvbnN0IHJhd0d1YXJkcyA9IHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnk7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCByYXdBdHRhY2tlcnMubGVuZ3RoOyBpKyspIGF0dGFja2Vycy5wdXNoKHJhd0F0dGFja2Vyc1tpXSk7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCByYXdHdWFyZHMubGVuZ3RoOyBpKyspIGd1YXJkcy5wdXNoKHJhd0d1YXJkc1tpXSk7DQogICAgYXR0YWNrZXJzLnNvcnQoKGEsIGIpID0+IGEubWF0ZXJpYWxWYWx1ZSAtIGIubWF0ZXJpYWxWYWx1ZSk7DQogICAgZ3VhcmRzLnNvcnQoKGEsIGIpID0+IGEubWF0ZXJpYWxWYWx1ZSAtIGIubWF0ZXJpYWxWYWx1ZSk7DQoNCiAgICBsZXQgZXhjaGFuZ2VTY29yZSA9IDA7DQogICAgbGV0IGF0dGFja2VySW5kZXggPSAwOw0KICAgIGxldCBndWFyZEluZGV4ID0gMDsNCiAgICBjb25zdCB0YXJnZXRWYWx1ZSA9IHRocmVhdGVuZWRQaWVjZS5tYXRlcmlhbFZhbHVlOw0KDQogICAgd2hpbGUgKGF0dGFja2VySW5kZXggPCBhdHRhY2tlcnMubGVuZ3RoICYmIGd1YXJkSW5kZXggPCBndWFyZHMubGVuZ3RoKSB7DQogICAgICAgIGlmIChndWFyZEluZGV4ID09PSAwKSB7DQogICAgICAgICAgICBleGNoYW5nZVNjb3JlICs9IHRhcmdldFZhbHVlOw0KICAgICAgICB9DQogICAgICAgIGV4Y2hhbmdlU2NvcmUgLT0gYXR0YWNrZXJzW2F0dGFja2VySW5kZXhdLm1hdGVyaWFsVmFsdWU7DQogICAgICAgIGlmIChhdHRhY2tlckluZGV4ICsgMSA8IGF0dGFja2Vycy5sZW5ndGgpIHsNCiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gZ3VhcmRzW2d1YXJkSW5kZXhdLm1hdGVyaWFsVmFsdWU7DQogICAgICAgIH0NCiAgICAgICAgYXR0YWNrZXJJbmRleCsrOw0KICAgICAgICBndWFyZEluZGV4Kys7DQogICAgfQ0KICAgIHJldHVybiBleGNoYW5nZVNjb3JlOw0KfTsNCg0KLy8gbWFzayDot6/lvoQgU0VF77ya5p2Q5paZ5pWw57uE5o6S5bqP77yM6K+t5LmJ5LiO5LiK5byP5LiA6Ie077yIYml0c2NhbiDlhoXogZTvvIzml6Dlm57osIPvvIkNCmNvbnN0IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmVGcm9tTWFza3MgPSAodGhyZWF0ZW5lZFBpZWNlLCBwaWVjZXNJbmZvLCBhdHRhY2tNYXNrLCBndWFyZE1hc2spID0+IHsNCiAgICBjb25zdCBhdGtNYXRzID0gc2VlQXR0YWNrZXJNYXRTY3JhdGNoOw0KICAgIGNvbnN0IGdyZE1hdHMgPSBzZWVHdWFyZE1hdFNjcmF0Y2g7DQogICAgYXRrTWF0cy5sZW5ndGggPSAwOw0KICAgIGdyZE1hdHMubGVuZ3RoID0gMDsNCiAgICBjb25zdCBzcSA9IHRocmVhdGVuZWRQaWVjZS5yICogOSArIHRocmVhdGVuZWRQaWVjZS5jOw0KICAgIGxldCBhbSA9IGF0dGFja01hc2tbc3FdID4+PiAwOw0KICAgIHdoaWxlIChhbSAhPT0gMCkgew0KICAgICAgICBjb25zdCBiaXQgPSBhbSAmIC1hbTsNCiAgICAgICAgYXRrTWF0cy5wdXNoKHBpZWNlc0luZm9bMzEgLSBNYXRoLmNsejMyKGJpdCldLm1hdGVyaWFsVmFsdWUpOw0KICAgICAgICBhbSBePSBiaXQ7DQogICAgfQ0KICAgIGxldCBnbSA9IGd1YXJkTWFza1tzcV0gPj4+IDA7DQogICAgd2hpbGUgKGdtICE9PSAwKSB7DQogICAgICAgIGNvbnN0IGJpdCA9IGdtICYgLWdtOw0KICAgICAgICBncmRNYXRzLnB1c2gocGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV0ubWF0ZXJpYWxWYWx1ZSk7DQogICAgICAgIGdtIF49IGJpdDsNCiAgICB9DQogICAgYXRrTWF0cy5zb3J0KChhLCBiKSA9PiBhIC0gYik7DQogICAgZ3JkTWF0cy5zb3J0KChhLCBiKSA9PiBhIC0gYik7DQoNCiAgICBsZXQgZXhjaGFuZ2VTY29yZSA9IDA7DQogICAgbGV0IGF0dGFja2VySW5kZXggPSAwOw0KICAgIGxldCBndWFyZEluZGV4ID0gMDsNCiAgICBjb25zdCB0YXJnZXRWYWx1ZSA9IHRocmVhdGVuZWRQaWVjZS5tYXRlcmlhbFZhbHVlOw0KDQogICAgd2hpbGUgKGF0dGFja2VySW5kZXggPCBhdGtNYXRzLmxlbmd0aCAmJiBndWFyZEluZGV4IDwgZ3JkTWF0cy5sZW5ndGgpIHsNCiAgICAgICAgaWYgKGd1YXJkSW5kZXggPT09IDApIHsNCiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gdGFyZ2V0VmFsdWU7DQogICAgICAgIH0NCiAgICAgICAgZXhjaGFuZ2VTY29yZSAtPSBhdGtNYXRzW2F0dGFja2VySW5kZXhdOw0KICAgICAgICBpZiAoYXR0YWNrZXJJbmRleCArIDEgPCBhdGtNYXRzLmxlbmd0aCkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSBncmRNYXRzW2d1YXJkSW5kZXhdOw0KICAgICAgICB9DQogICAgICAgIGF0dGFja2VySW5kZXgrKzsNCiAgICAgICAgZ3VhcmRJbmRleCsrOw0KICAgIH0NCiAgICByZXR1cm4gZXhjaGFuZ2VTY29yZTsNCn07DQoNCi8vIOiuoeeul+WogeiDgeWAvO+8iOWfuuS6juWujOaVtOeahOWogeiDgeWFs+ezu++8iQ0KLy8g5oyJ6KKr5aiB6IOB5a2Q6IGa5ZCI77ya5q+P5Liq55uu5qCH5pyA5aSa5LiA5qyhIFNFRe+8m+WIhuWAvOWKoOe7mSB0aHJlYXRlbmVkQnlbMF0NCi8vIO+8iOWFs+ezu+aehOW7uuaMiSBwaWVjZXNJbmZvIOmhuuW6jyBwdXNo77yM5pWF5LiO5pen4oCc5pS75Ye75pa55aSW5bGC6YGN5Y6G6aaW5qyh6K6h5YiG4oCd5b2S5bGe5LiA6Ie077yJDQpjb25zdCBjYWxjdWxhdGVUaHJlYXRWYWx1ZXMgPSAocGllY2VzSW5mbywgY3VycmVudFBsYXllciwgYm9hcmRJbmZvID0gbnVsbCwgZm9yU2VhcmNoTGVhZiA9IGZhbHNlKSA9PiB7CiAgICAvLyDnu5/orqENCiAgICBpZiAoY3VycmVudFBsYXllcikgew0KICAgICAgICBwZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnRbY3VycmVudFBsYXllcl0rKzsNCiAgICB9DQoNCiAgICAvLyDliJ3lp4vljJblqIHog4Hnsbvlnovnu5/orqHkv6Hmga8NCiAgICBjb25zdCBjb2xsZWN0VWkgPSAhIWJvYXJkSW5mbyAmJiAhZm9yU2VhcmNoTGVhZjsKICAgIGlmIChjb2xsZWN0VWkpIHsKICAgICAgICBib2FyZEluZm8uY2hlY2tzID0gW107ICAgICAgLy8g5bCG5Yab5L+h5oGvDQogICAgICAgIGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzID0gW107ICAvLyDooqvmjYnnmoTmo4vlrZANCiAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUgPSBbXTsgIC8vIOWPr+WQg+eahOaji+WtkA0KICAgIH0NCg0KICAgIGNvbnN0IGNoZWNrQm9udXMgPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuY2hlY2suYm9udXM7DQogICAgY29uc3QgY2FuQ2FwdHVyZVNlZW4gPSBjb2xsZWN0VWkgPyBuZXcgU2V0KCkgOiBudWxsOwogICAgY29uc3QgdXNlTWFza3MgPSAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpOw0KICAgIGNvbnN0IGF0dGFja01hc2sgPSB1c2VNYXNrcyA/IGJvYXJkSW5mby5hdHRhY2tNYXNrIDogbnVsbDsNCiAgICBjb25zdCBndWFyZE1hc2sgPSB1c2VNYXNrcyA/IGJvYXJkSW5mby5ndWFyZE1hc2sgOiBudWxsOw0KDQogICAgZm9yIChsZXQgdGkgPSAwOyB0aSA8IHBpZWNlc0luZm8ubGVuZ3RoOyB0aSsrKSB7DQogICAgICAgIGNvbnN0IHRocmVhdGVuZWRQaWVjZSA9IHBpZWNlc0luZm9bdGldOw0KICAgICAgICBsZXQgZmlyc3RBdHRhY2tlcjsNCiAgICAgICAgbGV0IGhhc0d1YXJkOw0KICAgICAgICBsZXQgYXR0YWNrZXJMaXN0ID0gbnVsbDsNCg0KICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgIGNvbnN0IHNxID0gdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmM7DQogICAgICAgICAgICBjb25zdCBhbSA9IGF0dGFja01hc2tbc3FdOw0KICAgICAgICAgICAgaWYgKGFtID09PSAwKSBjb250aW51ZTsNCiAgICAgICAgICAgIC8vIOacgOS9jiBiaXQgPSBwaWVjZXNJbmZvIOmhuuW6j+S4i+acgOWFiOaMguS4iueahOaUu+WHu+aWue+8iOS4juaXpyB0aHJlYXRlbmVkQnlbMF0g5LiA6Ie077yJDQogICAgICAgICAgICBmaXJzdEF0dGFja2VyID0gcGllY2VzSW5mb1tsb3dlc3RTZXRCaXRJbmRleChhbSldOw0KICAgICAgICAgICAgaGFzR3VhcmQgPSBndWFyZE1hc2tbc3FdICE9PSAwOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgY29uc3QgYXR0YWNrZXJzID0gdGhyZWF0ZW5lZFBpZWNlLnRocmVhdGVuZWRCeTsNCiAgICAgICAgICAgIGlmICghYXR0YWNrZXJzIHx8IGF0dGFja2Vycy5sZW5ndGggPT09IDApIGNvbnRpbnVlOw0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlciA9IGF0dGFja2Vyc1swXTsNCiAgICAgICAgICAgIGhhc0d1YXJkID0gdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeSAmJiB0aHJlYXRlbmVkUGllY2UuZ3VhcmRlZEJ5Lmxlbmd0aCA+IDA7DQogICAgICAgICAgICBhdHRhY2tlckxpc3QgPSBhdHRhY2tlcnM7DQogICAgICAgIH0NCg0KICAgICAgICAvLyDlsIblhpvvvJrlj6rnu5nlsI/pop3lhYjmiYvliIbvvIznu53kuI3mjInlsIYv5biF5p2Q5paZ5YC85YGaIFNFRQ0KICAgICAgICBpZiAodGhyZWF0ZW5lZFBpZWNlLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkdFTkVSQUwpIHsNCiAgICAgICAgICAgIGlmIChjb2xsZWN0VWkpIHsKICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICBsZXQgbSA9IGF0dGFja01hc2tbdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmNdID4+PiAwOw0KICAgICAgICAgICAgICAgICAgICB3aGlsZSAobSAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYml0ID0gbSAmIC1tOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWkgPSAzMSAtIE1hdGguY2x6MzIoYml0KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jaGVja3MucHVzaCh7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrZXI6IHBpZWNlc0luZm9bYWldLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldDogdGhyZWF0ZW5lZFBpZWNlLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQ2hlY2s6IHRydWUNCiAgICAgICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgbSBePSBiaXQ7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBhaSA9IDA7IGFpIDwgYXR0YWNrZXJMaXN0Lmxlbmd0aDsgYWkrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNoZWNrcy5wdXNoKHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tlcjogYXR0YWNrZXJMaXN0W2FpXSwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IHRocmVhdGVuZWRQaWVjZSwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc0NoZWNrOiB0cnVlDQogICAgICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gY2hlY2tCb251czsNCiAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICB9DQoNCiAgICAgICAgLy8g5Y+q5oqK5a+55pS75Ye75pa55pyJ5Yip55qE5aiB6IOB6K6h5YWlIHRocmVhdFZhbHVl77yI5Y2V5ZCR6K6h5YWl77yM5LiN5YGaIHNhZmV0eSDlr7nnp7DmiaPliIbvvIkNCiAgICAgICAgaWYgKCFoYXNHdWFyZCkgew0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgIGlmIChjb2xsZWN0VWkpIHsKICAgICAgICAgICAgICAgIGlmIChmaXJzdEF0dGFja2VyLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICAgICAgbGV0IG0gPSBhdHRhY2tNYXNrW3RocmVhdGVuZWRQaWVjZS5yICogOSArIHRocmVhdGVuZWRQaWVjZS5jXSA+Pj4gMDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHdoaWxlIChtICE9PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYml0ID0gbSAmIC1tOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvWzMxIC0gTWF0aC5jbHozMihiaXQpXTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbkNhcHR1cmVTZWVuLmhhcyhpbmZvKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYW5DYXB0dXJlU2Vlbi5hZGQoaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jYW5DYXB0dXJlLnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIG0gXj0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgYWkgPSAwOyBhaSA8IGF0dGFja2VyTGlzdC5sZW5ndGg7IGFpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gYXR0YWNrZXJMaXN0W2FpXTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbkNhcHR1cmVTZWVuLmhhcyhpbmZvKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYW5DYXB0dXJlU2Vlbi5hZGQoaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jYW5DYXB0dXJlLnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMucHVzaCh0aHJlYXRlbmVkUGllY2UpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGNvbnN0IHNzZVNjb3JlID0gdXNlTWFza3MNCiAgICAgICAgICAgICAgICA/IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmVGcm9tTWFza3ModGhyZWF0ZW5lZFBpZWNlLCBwaWVjZXNJbmZvLCBhdHRhY2tNYXNrLCBndWFyZE1hc2spDQogICAgICAgICAgICAgICAgOiBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlKHRocmVhdGVuZWRQaWVjZSk7DQogICAgICAgICAgICBpZiAoc3NlU2NvcmUgPiAwKSB7DQogICAgICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSBzc2VTY29yZSAqIDAuNTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCn07DQoNCi8vIOiuoeeul+WuieWFqOWAvO+8muWwhuepuuaOp+mCu+agvOaYr+WQpuiiq+aVjOaOp++8iOaXoCB2aXNpdCDlm57osIPvvIkNCmNvbnN0IGNhbGN1bGF0ZVNhZmV0eVZhbHVlcyA9IChwaWVjZXNJbmZvLCBib2FyZEluZm8sIGJvYXJkID0gbnVsbCwgZm9yU2VhcmNoTGVhZiA9IGZhbHNlKSA9PiB7CiAgICBpZiAoZm9yU2VhcmNoTGVhZiAmJiBib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMgJiYgYm9hcmQpIHsKICAgICAgICBmb3IgKGxldCBnaSA9IDA7IGdpIDwgcGllY2VzSW5mby5sZW5ndGg7IGdpKyspIHsKICAgICAgICAgICAgY29uc3QgZ2VuZXJhbCA9IHBpZWNlc0luZm9bZ2ldOwogICAgICAgICAgICBpZiAoZ2VuZXJhbC5waWVjZS50eXBlICE9PSBQSUVDRV9UWVBFUy5HRU5FUkFMKSBjb250aW51ZTsKCiAgICAgICAgICAgIGNvbnN0IGdlbmVyYWxDb2xvciA9IGdlbmVyYWwucGllY2UuY29sb3I7CiAgICAgICAgICAgIGNvbnN0IGVuZW15Qml0cyA9IGdlbmVyYWxDb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8uYmxhY2tBdHRhY2sgOiBib2FyZEluZm8ucmVkQXR0YWNrOwogICAgICAgICAgICBjb25zdCBpc1JlZCA9IGdlbmVyYWxDb2xvciA9PT0gJ3JlZCc7CiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gZ2VuZXJhbDsKICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsKICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIE9SVEhfRElSU1tpXVswXTsKICAgICAgICAgICAgICAgIGNvbnN0IG5jID0gYyArIE9SVEhfRElSU1tpXVsxXTsKICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsKICAgICAgICAgICAgICAgIGlmIChpc1JlZCA/IChuciA8IDAgfHwgbnIgPiAyKSA6IChuciA8IDcgfHwgbnIgPiA5KSkgY29udGludWU7CiAgICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCAmJiBoYXNBdHRhY2tCaXQoZW5lbXlCaXRzLCBuciAqIDkgKyBuYykpIHsKICAgICAgICAgICAgICAgICAgICBnZW5lcmFsLnNhZmV0eVZhbHVlIC09IDUwOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybjsKICAgIH0KCiAgICBjb25zdCBnZW5lcmFsSW5mbyA9IFtdOwogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGlmIChwaWVjZXNJbmZvW2ldLnBpZWNlLnR5cGUgPT09IFBJRUNFX1RZUEVTLkdFTkVSQUwpIHsNCiAgICAgICAgICAgIGdlbmVyYWxJbmZvLnB1c2gocGllY2VzSW5mb1tpXSk7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VBdHRhY2tCaXRzKTsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcyk7DQoNCiAgICBmb3IgKGxldCBnaSA9IDA7IGdpIDwgZ2VuZXJhbEluZm8ubGVuZ3RoOyBnaSsrKSB7DQogICAgICAgIGNvbnN0IGdlbmVyYWwgPSBnZW5lcmFsSW5mb1tnaV07DQogICAgICAgIGNvbnN0IGdlbmVyYWxDb2xvciA9IGdlbmVyYWwucGllY2UuY29sb3I7DQogICAgICAgIGNvbnN0IGVuZW15Q29sb3IgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBjb25zdCBlbmVteUJpdHMgPSB1c2VBdHRhY2tCaXRzDQogICAgICAgICAgICA/IChlbmVteUNvbG9yID09PSAncmVkJyA/IGJvYXJkSW5mby5yZWRBdHRhY2sgOiBib2FyZEluZm8uYmxhY2tBdHRhY2spDQogICAgICAgICAgICA6IG51bGw7DQogICAgICAgIGNvbnN0IGlzUmVkID0gZ2VuZXJhbENvbG9yID09PSAncmVkJzsNCiAgICAgICAgY29uc3QgeyByLCBjIH0gPSBnZW5lcmFsOw0KDQogICAgICAgIGNvbnN0IHBlbmFsaXplSWZFbmVteSA9IChuciwgbmMpID0+IHsNCiAgICAgICAgICAgIGxldCBoYXNFbmVteUNvbnRyb2w7DQogICAgICAgICAgICBpZiAodXNlQXR0YWNrQml0cykgew0KICAgICAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbCA9IGhhc0F0dGFja0JpdChlbmVteUJpdHMsIG5yICogOSArIG5jKTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc3QgcG9zaXRpb25Db250cm9sbGVycyA9IGJvYXJkSW5mb1tucl1bbmNdOw0KICAgICAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbCA9IGZhbHNlOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IGNpID0gMDsgY2kgPCBwb3NpdGlvbkNvbnRyb2xsZXJzLmxlbmd0aDsgY2krKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sbGVyID0gcG9zaXRpb25Db250cm9sbGVyc1tjaV07DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbG9yID0gY29udHJvbGxlci5waWVjZSA/IGNvbnRyb2xsZXIucGllY2UuY29sb3IgOiBjb250cm9sbGVyLmNvbG9yOw0KICAgICAgICAgICAgICAgICAgICBpZiAoY29sb3IgPT09IGVuZW15Q29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGhhc0VuZW15Q29udHJvbCA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmIChoYXNFbmVteUNvbnRyb2wpIGdlbmVyYWwuc2FmZXR5VmFsdWUgLT0gNTA7DQogICAgICAgIH07DQoNCiAgICAgICAgaWYgKCh1c2VNYXNrcyAmJiBib2FyZCkgfHwgKCghZ2VuZXJhbC5jb250cm9sIHx8IGdlbmVyYWwuY29udHJvbC5sZW5ndGggPT09IDApICYmIGJvYXJkKSkgew0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBPUlRIX0RJUlNbaV1bMF07DQogICAgICAgICAgICAgICAgY29uc3QgbmMgPSBjICsgT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKG5yIDwgMCB8fCBuciA+IDIpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAobnIgPCA3IHx8IG5yID4gOSkgew0KICAgICAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIHBlbmFsaXplSWZFbmVteShuciwgbmMpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKGdlbmVyYWwuY29udHJvbCAmJiBnZW5lcmFsLmNvbnRyb2wubGVuZ3RoKSB7DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGdlbmVyYWwuY29udHJvbC5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIHBlbmFsaXplSWZFbmVteShnZW5lcmFsLmNvbnRyb2xbaV0uciwgZ2VuZXJhbC5jb250cm9sW2ldLmMpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KLy8gLS0tIFR5cGVzIChJbmxpbmVkIHRvIGF2b2lkIGltcG9ydCBpc3N1ZXMgaW4gV29ya2VyKSAtLS0NCi8vIC8vIHR5cGUgQ29sb3IgLSBUeXBlU2NyaXB0IHR5cGUgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5ICdyZWQnIHwgJ2JsYWNrJzsNCi8vIC8vIHR5cGUgUGllY2VUeXBlIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAnZ2VuZXJhbCcgfCAnYWR2aXNvcicgfCAnZWxlcGhhbnQnIHwgJ2hvcnNlJyB8ICdjaGFyaW90JyB8ICdjYW5ub24nIHwgJ3NvbGRpZXInOw0KLy8gLy8gaW50ZXJmYWNlIFBpZWNlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQovLyAvLyBpbnRlcmZhY2UgUG9zaXRpb24gLSBUeXBlU2NyaXB0IGludGVyZmFjZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkNCi8vIC8vIGludGVyZmFjZSBNb3ZlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQovLyAvLyB0eXBlIEJvYXJkIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAoUGllY2UgfCBudWxsKVtdW107DQoNCi8vIC0tLSBPcGVuaW5nIEJvb2sgVHlwZXMgLS0tDQovLyBPcGVuaW5nIEJvb2sgRW50cnkgLSByZXByZXNlbnRzIHBvc3NpYmxlIG1vdmVzIGZvciBhIHBvc2l0aW9uDQovLyBpbnRlcmZhY2UgQm9va0VudHJ5IC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQoNCi8vIEluZGl2aWR1YWwgbW92ZSBpbiBvcGVuaW5nIGJvb2sgd2l0aCBtZXRhZGF0YQ0KLy8gaW50ZXJmYWNlIEJvb2tNb3ZlIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQoNCi8vIC0tLSBab2JyaXN0IEhhc2hpbmcgZm9yIE9wZW5pbmcgQm9vayAtLS0NCi8vIEVhY2ggcGllY2UgdHlwZS9jb2xvci9wb3NpdGlvbiBnZXRzIGEgdW5pcXVlIHJhbmRvbSA1My1iaXQgaW50ZWdlcg0KLy8gVXNlcyBzZWVkZWQgUk5HIGZvciBkZXRlcm1pbmlzdGljIGhhc2hpbmcNCmNsYXNzIFpvYnJpc3RIYXNoZXIgew0KICAgIGhhc2hUYWJsZTsgIC8vIFtyb3ddW2NvbF1bcGllY2VJbmRleF0NCiAgICBwaWVjZVRvSW5kZXg7DQoNCiAgICBjb25zdHJ1Y3RvcigpIHsNCiAgICAgICAgdGhpcy5waWVjZVRvSW5kZXggPSBuZXcgTWFwKFsNCiAgICAgICAgICAgIFsncmVkLWdlbmVyYWwnLCAwXSwNCiAgICAgICAgICAgIFsncmVkLWFkdmlzb3InLCAxXSwNCiAgICAgICAgICAgIFsncmVkLWVsZXBoYW50JywgMl0sDQogICAgICAgICAgICBbJ3JlZC1ob3JzZScsIDNdLA0KICAgICAgICAgICAgWydyZWQtY2hhcmlvdCcsIDRdLA0KICAgICAgICAgICAgWydyZWQtY2Fubm9uJywgNV0sDQogICAgICAgICAgICBbJ3JlZC1zb2xkaWVyJywgNl0sDQogICAgICAgICAgICBbJ2JsYWNrLWdlbmVyYWwnLCA3XSwNCiAgICAgICAgICAgIFsnYmxhY2stYWR2aXNvcicsIDhdLA0KICAgICAgICAgICAgWydibGFjay1lbGVwaGFudCcsIDldLA0KICAgICAgICAgICAgWydibGFjay1ob3JzZScsIDEwXSwNCiAgICAgICAgICAgIFsnYmxhY2stY2hhcmlvdCcsIDExXSwNCiAgICAgICAgICAgIFsnYmxhY2stY2Fubm9uJywgMTJdLA0KICAgICAgICAgICAgWydibGFjay1zb2xkaWVyJywgMTNdLA0KICAgICAgICBdKTsNCg0KICAgICAgICAvLyBJbml0aWFsaXplIHJhbmRvbSBoYXNoIHZhbHVlcyB1c2luZyBzZWVkZWQgUk5HICg1My1iaXQgaW50ZWdlcnMgdG8gYXZvaWQgcHJlY2lzaW9uIGlzc3VlcykNCiAgICAgICAgdGhpcy5oYXNoVGFibGUgPSBbXTsNCiAgICAgICAgY29uc3QgTUFYX1NBRkUgPSAweDFGRkZGRkZGRkZGRkZGOyAvLyAyXjUzIC0gMQ0KICAgICAgICANCiAgICAgICAgLy8gU2ltcGxlIHNlZWRlZCBSTkcgKExDRyAtIExpbmVhciBDb25ncnVlbnRpYWwgR2VuZXJhdG9yKQ0KICAgICAgICBsZXQgc2VlZCA9IDEyMzQ1Njc4OTsgLy8gRml4ZWQgc2VlZCBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nDQogICAgICAgIGNvbnN0IHNlZWRlZFJhbmRvbSA9ICgpID0+IHsNCiAgICAgICAgICAgIHNlZWQgPSAoc2VlZCAqIDExMDM1MTUyNDUgKyAxMjM0NSkgJiAweDdmZmZmZmZmOw0KICAgICAgICAgICAgcmV0dXJuIHNlZWQgLyAweDdmZmZmZmZmOw0KICAgICAgICB9Ow0KDQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl0gPSBbXTsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY10gPSBbXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBwID0gMDsgcCA8IDE0OyBwKyspIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgZGV0ZXJtaW5pc3RpYyA1My1iaXQgaW50ZWdlcg0KICAgICAgICAgICAgICAgICAgICB0aGlzLmhhc2hUYWJsZVtyXVtjXVtwXSA9IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgLy8g5Y+26K+E5Lyw57yT5a2Y6ZSu77yaYm9hcmRIYXNoIF4gaW5pdGlhdG9yS2V5IF4gc3RhZ2VLZXkNCiAgICAgICAgdGhpcy5ldmFsSW5pdGlhdG9yS2V5cyA9IHsNCiAgICAgICAgICAgIHJlZDogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwNCiAgICAgICAgICAgIGJsYWNrOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpDQogICAgICAgIH07DQogICAgICAgIHRoaXMuZXZhbFN0YWdlS2V5cyA9IHsNCiAgICAgICAgICAgIGVhcmx5OiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpLA0KICAgICAgICAgICAgbWlkOiBNYXRoLmZsb29yKHNlZWRlZFJhbmRvbSgpICogTUFYX1NBRkUpLA0KICAgICAgICAgICAgbGF0ZTogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIHBpZWNlSW5kZXgocGllY2VPcktleSkgew0KICAgICAgICBpZiAocGllY2VPcktleSA9PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkOw0KICAgICAgICBpZiAodHlwZW9mIHBpZWNlT3JLZXkgPT09ICdzdHJpbmcnKSByZXR1cm4gdGhpcy5waWVjZVRvSW5kZXguZ2V0KHBpZWNlT3JLZXkpOw0KICAgICAgICByZXR1cm4gdGhpcy5waWVjZVRvSW5kZXguZ2V0KGAke3BpZWNlT3JLZXkuY29sb3J9LSR7cGllY2VPcktleS50eXBlfWApOw0KICAgIH0NCg0KICAgIGV2YWxDYWNoZUtleShib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpIHsNCiAgICAgICAgY29uc3Qgc3RhZ2VLZXkgPSB0aGlzLmV2YWxTdGFnZUtleXNbZ2FtZVN0YWdlXSB8fCB0aGlzLmV2YWxTdGFnZUtleXMubWlkOw0KICAgICAgICByZXR1cm4gdGhpcy5oYXNoKGJvYXJkKSBeIHRoaXMuZXZhbEluaXRpYXRvcktleXNbc2VhcmNoSW5pdGlhdG9yXSBeIHN0YWdlS2V5Ow0KICAgIH0NCg0KICAgIGV2YWxDYWNoZUtleUZyb21IYXNoKGJvYXJkSGFzaCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpIHsNCiAgICAgICAgY29uc3Qgc3RhZ2VLZXkgPSB0aGlzLmV2YWxTdGFnZUtleXNbZ2FtZVN0YWdlXSB8fCB0aGlzLmV2YWxTdGFnZUtleXMubWlkOw0KICAgICAgICByZXR1cm4gYm9hcmRIYXNoIF4gdGhpcy5ldmFsSW5pdGlhdG9yS2V5c1tzZWFyY2hJbml0aWF0b3JdIF4gc3RhZ2VLZXk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICog5pWw5YC8IFRUIGtlee+8muaKiuihjOaji+aWuee8lueggei/m+acgOS9juS9je+8jOmBv+WFjSBgaGFzaCBeIHNpZGVLZXlgIOWcqCBKUyBUb0ludDMyDQogICAgICog5LiL5Lqn55Sf6Leo57qi6buR56Kw5pKe77yI6YKj5Lya5L2/IFRUIOivr+WRveS4reW5tuaUueWPmOaQnOe0ouagkS/mo4vlipvvvInjgIINCiAgICAgKiDnrYnku7fkuo7ml6flrZfnrKbkuLIga2V5IGAke2hhc2h9OiR7c2lkZX1gIOeahOWMuuWIhuiDveWKm+OAgg0KICAgICAqLw0KICAgIHR0S2V5RnJvbUhhc2goYm9hcmRIYXNoLCBzaWRlKSB7DQogICAgICAgIGNvbnN0IGggPSBib2FyZEhhc2ggfCAwOyAvLyBePSDpk77nu5Pmnpzlt7LmmK8gSW50MzINCiAgICAgICAgcmV0dXJuIGggKiAyICsgKHNpZGUgPT09ICdyZWQnID8gMCA6IDEpOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENvbXB1dGUgaGFzaCBmb3IgYSBib2FyZCBwb3NpdGlvbg0KICAgICAqLw0KICAgIGhhc2goYm9hcmQpIHsNCiAgICAgICAgbGV0IGggPSAwOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGllY2VJZHggPSB0aGlzLnBpZWNlSW5kZXgocGllY2UpOw0KICAgICAgICAgICAgICAgICAgICBpZiAocGllY2VJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgaCBePSB0aGlzLmhhc2hUYWJsZVtyXVtjXVtwaWVjZUlkeF07DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIGg7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogTWlycm9yIGEgYm9hcmQgaG9yaXpvbnRhbGx5IChmb3Igc3ltbWV0cnkgZGV0ZWN0aW9uKQ0KICAgICAqLw0KICAgIG1pcnJvckJvYXJkKGJvYXJkKSB7DQogICAgICAgIGNvbnN0IG1pcnJvcmVkID0gQXJyYXkoMTApLmZpbGwobnVsbCkubWFwKCgpID0+IEFycmF5KDkpLmZpbGwobnVsbCkpOw0KICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgbWlycm9yZWRbcl1bOCAtIGNdID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIG1pcnJvcmVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIE1pcnJvciBhIG1vdmUgaG9yaXpvbnRhbGx5DQogICAgICovDQogICAgbWlycm9yTW92ZShtb3ZlKSB7DQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiA4IC0gbW92ZS5mcm9tLmMgfSwNCiAgICAgICAgICAgIHRvOiB7IHI6IG1vdmUudG8uciwgYzogOCAtIG1vdmUudG8uYyB9DQogICAgICAgIH07DQogICAgfQ0KDQogICAgLyoqDQogICAgICogSW5jcmVtZW50YWxseSB1cGRhdGUgaGFzaCBhZnRlciBhIG1vdmUgKFhPUiDoh6rpgIbvvJrlho3osIPnlKjkuIDmrKHlj6/ov5jljp8pLg0KICAgICAqIG1vdmluZ1BpZWNlIC8gY2FwdHVyZWRQaWVjZSDlj6/kuLrmo4vlrZDlr7nosaHmiJYgJ2NvbG9yLXR5cGUnIOWtl+espuS4suOAgg0KICAgICAqIOmhu+WcqCBtYWtlTW92ZSDkuYvliY3lj5blvpcgbW92aW5nUGllY2XvvIxjYXB0dXJlZCDnlKggbWFrZU1vdmUg6L+U5Zue5YC844CCDQogICAgICovDQogICAgdXBkYXRlSGFzaChjdXJyZW50SGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgbGV0IG5ld0hhc2ggPSBjdXJyZW50SGFzaDsNCiAgICAgICAgY29uc3QgbW92aW5nSWR4ID0gdGhpcy5waWVjZUluZGV4KG1vdmluZ1BpZWNlKTsNCiAgICAgICAgaWYgKG1vdmluZ0lkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY11bbW92aW5nSWR4XTsNCiAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS50by5yXVttb3ZlLnRvLmNdW21vdmluZ0lkeF07DQogICAgICAgIH0NCiAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkSWR4ID0gdGhpcy5waWVjZUluZGV4KGNhcHR1cmVkUGllY2UpOw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICBuZXdIYXNoIF49IHRoaXMuaGFzaFRhYmxlW21vdmUudG8ucl1bbW92ZS50by5jXVtjYXB0dXJlZElkeF07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIG5ld0hhc2g7DQogICAgfQ0KfQ0KDQovKioNCiAqIE9wZW5pbmcgQm9vayBNYW5hZ2VyDQogKi8NCmNsYXNzIE9wZW5pbmdCb29rIHsNCiAgICBib29rOyAgLy8gWm9icmlzdCBoYXNoIC0+IG1vdmVzDQogICAgaGFzaGVyOw0KICAgIGVuYWJsZWQ7DQogICAgbWF4UGx5OyAgLy8gTWF4aW11bSBwbHkgdG8gdXNlIG9wZW5pbmcgYm9vayAoZS5nLiwgMjApDQoNCiAgICBjb25zdHJ1Y3RvcihtYXhQbHkgPSAxMikgew0KICAgICAgICB0aGlzLmJvb2sgPSBuZXcgTWFwKCk7DQogICAgICAgIHRoaXMuaGFzaGVyID0gbmV3IFpvYnJpc3RIYXNoZXIoKTsNCiAgICAgICAgdGhpcy5lbmFibGVkID0gdHJ1ZTsNCiAgICAgICAgdGhpcy5tYXhQbHkgPSBtYXhQbHk7DQogICAgICAgIHRoaXMuaW5pdGlhbGl6ZUJvb2soKTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBJbml0aWFsaXplIHdpdGggY29tbW9uIENoaW5lc2UgQ2hlc3Mgb3BlbmluZ3MNCiAgICAgKi8NCiAgICBpbml0aWFsaXplQm9vaygpIHsNCiAgICAgICAgLy8gQWRkIGNsYXNzaWMgQ2hpbmVzZSBDaGVzcyBvcGVuaW5ncyBtYW51YWxseQ0KICAgICAgICANCiAgICAgICAgLyoNCiAgICAgICAgLy8gMS4g5Lit54Ku6L+H5rKz6L2m5a+55bGP6aOO6ams5bmz54Ku5a+56L2mIChDZW50cmFsIENhbm5vbiB2cyBTY3JlZW4gSG9yc2VzKQ0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lKFsNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA3LCBjOiA3IH0sIHRvOiB7IHI6IDcsIGM6IDQgfSB9LCAgLy8gMS4g54Ku5LqM5bmz5LqUDQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogNyB9LCB0bzogeyByOiAyLCBjOiA2IH0gfSwgIC8vIDEuLi4g6amsOOi/mzcNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiA5LCBjOiA3IH0sIHRvOiB7IHI6IDcsIGM6IDYgfSB9LCAgLy8gMi4g6ams5LqM6L+b5LiJDQogICAgICAgICAgICB7IGZyb206IHsgcjogMCwgYzogOCB9LCB0bzogeyByOiAwLCBjOiA3IH0gfSwgIC8vIDIuLi4g6L2mOeW5szggICAgICAgICAgIA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDggfSwgdG86IHsgcjogOSwgYzogNyB9IH0sICAvLyAzLiDovabkuIDlubPkuowNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAzLCBjOiA2IH0sIHRvOiB7IHI6IDQsIGM6IDYgfSB9LCAgLy8gMy4uLiDljZI36L+bMQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDcgfSwgdG86IHsgcjogMywgYzogNyB9IH0sICAvLyA0LiDovabkuozov5vlha0NCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiAxIH0sIHRvOiB7IHI6IDIsIGM6IDIgfSB9LCAgLy8gNC4uLiDpqawy6L+bMw0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDYsIGM6IDIgfSwgdG86IHsgcjogNSwgYzogMiB9IH0sICAvLyA1LiDlhbXkuIPov5vkuIANCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAyLCBjOiA3IH0sIHRvOiB7IHI6IDIsIGM6IDggfSB9LCAgLy8gNS4uLiDngq445bmzOQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDMsIGM6IDcgfSwgdG86IHsgcjogMywgYzogNiB9IH0sICAvLyA2LiDovabkuozlubPkuIkNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAyLCBjOiA4IH0sIHRvOiB7IHI6IDEsIGM6IDggfSB9LCAgLy8gNi4uLiDngq456YCAMSAgICAgICAgICANCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCg0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKFsNCiAgICAgICAgICAgICfngq7kuozlubPkupQnLCAn6amsOOi/mzcnLCAn6ams5LqM6L+b5LiJJywgJ+i9pjnlubM4JywgJ+i9puS4gOW5s+S6jCcsICfljZI36L+bMScsDQogICAgICAgICAgICAn6L2m5LqM6L+b5YWtJywgJ+mprDLov5szJywgJ+WFteS4g+i/m+S4gCcsICfngq445bmzOScsICfovabkuozlubPkuIknLCAn54KuOemAgDEnLA0KICAgICAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCg0KICAgICAgICAgICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKFsNCiAgICAgICAgICAgICfngq7kuozlubPkupQg6amsOOi/mzcg6ams5LqM6L+b5LiJIOi9pjnlubM4IOi9puS4gOW5s+S6jCDljZI36L+bMSDovabkuozov5vlha0g6amsMui/mzMg5YW15LiD6L+b5LiAIOeCrjjlubM5IOi9puS6jOW5s+S4iSDngq456YCAMScNCiAgICAgICAgXSwgWzg1LCA4NSwgOTUsIDkwLCA5MCwgODUsIDg1LCA4MCwgODUsIDg1LCA4NSwgODVdKTsNCiAgICAgICAgKi8NCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBBZGQgYW4gb3BlbmluZyBsaW5lIHRvIHRoZSBib29rDQogICAgICogQHBhcmFtIG1vdmVzIEFycmF5IG9mIG1vdmVzIHJlcHJlc2VudGluZyBhbiBvcGVuaW5nIGxpbmUNCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCB3ZWlnaHRzIGZvciBlYWNoIG1vdmUgKGRlZmF1bHQgMTAwIGZvciBhbGwpDQogICAgICovDQogICAgYWRkT3BlbmluZ0xpbmUobW92ZXMsIHdlaWdodHMpIHsNCiAgICAgICAgLy8gU3RhcnQgd2l0aCBpbml0aWFsIGJvYXJkIHBvc2l0aW9uDQogICAgICAgIGNvbnN0IGJvYXJkID0gdGhpcy5jcmVhdGVJbml0aWFsQm9hcmQoKTsNCiAgICAgICAgbGV0IGN1cnJlbnRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChib2FyZCk7DQoNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtb3Zlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2ldOw0KICAgICAgICAgICAgY29uc3Qgd2VpZ2h0ID0gd2VpZ2h0cz8uW2ldID8/IDEwMDsNCg0KICAgICAgICAgICAgLy8gR2V0IG9yIGNyZWF0ZSBib29rIGVudHJ5IGZvciB0aGlzIHBvc2l0aW9uDQogICAgICAgICAgICBsZXQgZW50cnkgPSB0aGlzLmJvb2suZ2V0KGN1cnJlbnRIYXNoKTsNCiAgICAgICAgICAgIGlmICghZW50cnkpIHsNCiAgICAgICAgICAgICAgICBlbnRyeSA9IHsgbW92ZXM6IFtdIH07DQogICAgICAgICAgICAgICAgdGhpcy5ib29rLnNldChjdXJyZW50SGFzaCwgZW50cnkpOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBBZGQgbW92ZSBpZiBub3QgYWxyZWFkeSBwcmVzZW50DQogICAgICAgICAgICBjb25zdCBleGlzdGluZ01vdmUgPSBlbnRyeS5tb3Zlcy5maW5kKA0KICAgICAgICAgICAgICAgIG0gPT4gbS5mcm9tLnIgPT09IG1vdmUuZnJvbS5yICYmIG0uZnJvbS5jID09PSBtb3ZlLmZyb20uYyAmJg0KICAgICAgICAgICAgICAgICAgICAgbS50by5yID09PSBtb3ZlLnRvLnIgJiYgbS50by5jID09PSBtb3ZlLnRvLmMNCiAgICAgICAgICAgICk7DQoNCiAgICAgICAgICAgIGlmICghZXhpc3RpbmdNb3ZlKSB7DQogICAgICAgICAgICAgICAgZW50cnkubW92ZXMucHVzaCh7DQogICAgICAgICAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IG1vdmUuZnJvbS5jIH0sDQogICAgICAgICAgICAgICAgICAgIHRvOiB7IHI6IG1vdmUudG8uciwgYzogbW92ZS50by5jIH0sDQogICAgICAgICAgICAgICAgICAgIHdlaWdodDogd2VpZ2h0DQogICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSB3ZWlnaHQgaWYgbW92ZSBhbHJlYWR5IGV4aXN0cyAodGFrZSBtYXhpbXVtKQ0KICAgICAgICAgICAgICAgIGV4aXN0aW5nTW92ZS53ZWlnaHQgPSBNYXRoLm1heChleGlzdGluZ01vdmUud2VpZ2h0LCB3ZWlnaHQpOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBNYWtlIHRoZSBtb3ZlIG9uIHRoZSBib2FyZA0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBib2FyZFttb3ZlLnRvLnJdW21vdmUudG8uY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghcGllY2UpIGJyZWFrOyAvLyBJbnZhbGlkIGxpbmUNCg0KICAgICAgICAgICAgY29uc3QgcGllY2VLZXkgPSBgJHtwaWVjZS5jb2xvcn0tJHtwaWVjZS50eXBlfWA7DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGNhcHR1cmVkID8gYCR7Y2FwdHVyZWQuY29sb3J9LSR7Y2FwdHVyZWQudHlwZX1gIDogdW5kZWZpbmVkOw0KDQogICAgICAgICAgICAvLyBVcGRhdGUgaGFzaCBpbmNyZW1lbnRhbGx5DQogICAgICAgICAgICBjdXJyZW50SGFzaCA9IHRoaXMuaGFzaGVyLnVwZGF0ZUhhc2goY3VycmVudEhhc2gsIG1vdmUsIHBpZWNlS2V5LCBjYXB0dXJlZEtleSk7DQoNCiAgICAgICAgICAgIC8vIEFwcGx5IG1vdmUNCiAgICAgICAgICAgIGJvYXJkW21vdmUudG8ucl1bbW92ZS50by5jXSA9IHBpZWNlOw0KICAgICAgICAgICAgYm9hcmRbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXSA9IG51bGw7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBHZXQgYmVzdCBtb3ZlIGZyb20gb3BlbmluZyBib29rIGZvciBjdXJyZW50IHBvc2l0aW9uDQogICAgICogQHBhcmFtIGJvYXJkIEN1cnJlbnQgYm9hcmQgc3RhdGUNCiAgICAgKiBAcGFyYW0gcGx5IEN1cnJlbnQgcGx5IG51bWJlciAoMCA9IHN0YXJ0IG9mIGdhbWUpDQogICAgICogQHJldHVybnMgTW92ZSBmcm9tIGJvb2ssIG9yIG51bGwgaWYgcG9zaXRpb24gbm90IGluIGJvb2sNCiAgICAgKi8NCiAgICBnZXRCb29rTW92ZShib2FyZCwgcGx5KXsNCiAgICAgICAgLy8gRG9uJ3QgdXNlIGJvb2sgaWYgZGlzYWJsZWQgb3IgcGFzdCBtYXggcGx5DQogICAgICAgIGlmICghdGhpcy5lbmFibGVkIHx8IHBseSA+PSB0aGlzLm1heFBseSkgew0KICAgICAgICAgICAgY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBkaXNhYmxlZCBvciBwYXN0IG1heCBwbHknLCB7IGVuYWJsZWQ6IHRoaXMuZW5hYmxlZCwgbWF4UGx5OiB0aGlzLm1heFBseSwgcGx5OiBwbHkgfSk7DQogICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy9jb25zb2xlLmxvZygnT3BlbmluZyBib29rIGdldEJvb2tNb3ZlIGNhbGxlZCcsIHsgcGx5IH0pOw0KICAgICAgICANCiAgICAgICAgLy8gVHJ5IHRvIGZpbmQgbW92ZSBmb3IgY3VycmVudCBwb3NpdGlvbg0KICAgICAgICBjb25zdCBoYXNoID0gdGhpcy5oYXNoZXIuaGFzaChib2FyZCk7DQogICAgICAgIC8vY29uc29sZS5sb2coJ0N1cnJlbnQgcG9zaXRpb24gaGFzaDonLCBoYXNoKTsNCiAgICAgICAgDQogICAgICAgIGxldCBlbnRyeSA9IHRoaXMuYm9vay5nZXQoaGFzaCk7DQogICAgICAgIC8vY29uc29sZS5sb2coJ0VudHJ5IGZvdW5kIGZvciBjdXJyZW50IGhhc2g6JywgZW50cnkgPyBlbnRyeS5tb3Zlcy5sZW5ndGggKyAnIG1vdmVzJyA6ICdudWxsJyk7DQogICAgICAgIGlmIChlbnRyeSAmJiBlbnRyeS5tb3Zlcy5sZW5ndGggPiAwKSB7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnQWxsIHBvc3NpYmxlIGJvb2sgbW92ZXMgd2l0aCB3ZWlnaHRzOicsIEpTT04uc3RyaW5naWZ5KGVudHJ5Lm1vdmVzKSk7DQogICAgICAgICAgICAvLyBDYWxjdWxhdGUgdG90YWwgd2VpZ2h0DQogICAgICAgICAgICBjb25zdCB0b3RhbFdlaWdodCA9IGVudHJ5Lm1vdmVzLnJlZHVjZSgoc3VtLCBtb3ZlKSA9PiBzdW0gKyBtb3ZlLndlaWdodCwgMCk7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnVG90YWwgd2VpZ2h0OicsIHRvdGFsV2VpZ2h0KTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgbGV0IG1pcnJvcmVkTW92ZSA9IGZhbHNlOw0KDQogICAgICAgIC8vIElmIG5vdCBmb3VuZCwgdHJ5IG1pcnJvcmVkIHBvc2l0aW9uDQogICAgICAgIGlmICghZW50cnkgfHwgZW50cnkubW92ZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICBjb25zdCBtaXJyb3JlZEJvYXJkID0gdGhpcy5oYXNoZXIubWlycm9yQm9hcmQoYm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgbWlycm9yZWRIYXNoID0gdGhpcy5oYXNoZXIuaGFzaChtaXJyb3JlZEJvYXJkKTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdObyBlbnRyeSBmb3VuZCwgdHJ5aW5nIG1pcnJvcmVkIHBvc2l0aW9uOicsIG1pcnJvcmVkSGFzaCk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGVudHJ5ID0gdGhpcy5ib29rLmdldChtaXJyb3JlZEhhc2gpOw0KICAgICAgICAgICAgaWYgKGVudHJ5ICYmIGVudHJ5Lm1vdmVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdFbnRyeSBmb3VuZCBmb3IgbWlycm9yZWQgaGFzaDonLCBlbnRyeS5tb3Zlcy5sZW5ndGggKyAnIG1vdmVzJyk7DQogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnT3JpZ2luYWwgbWlycm9yIG1vdmVzOicsIEpTT04uc3RyaW5naWZ5KGVudHJ5Lm1vdmVzKSk7DQogICAgICAgICAgICAgICAgbWlycm9yZWRNb3ZlID0gdHJ1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZygnTm8gZW50cnkgZm91bmQgZm9yIG1pcnJvcmVkIGhhc2gnKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIGlmICghZW50cnkgfHwgZW50cnkubW92ZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgbW92ZSBub3QgZm91bmQgZm9yIGN1cnJlbnQgcG9zaXRpb24nKTsNCiAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICB9DQoNCiAgICAgICAgLy8gU2VsZWN0IG1vdmUgYmFzZWQgb24gd2VpZ2h0cw0KICAgICAgICBjb25zdCBzZWxlY3RlZE1vdmUgPSB0aGlzLnNlbGVjdFdlaWdodGVkTW92ZShlbnRyeS5tb3Zlcyk7DQogICAgICAgIGNvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgbW92ZSBzZWxlY3RlZDonLCBzZWxlY3RlZE1vdmUpOw0KICAgICAgICANCiAgICAgICAgLy8gSWYgd2UgdXNlZCBtaXJyb3JlZCBwb3NpdGlvbiwgbWlycm9yIHRoZSBtb3ZlIGJhY2sNCiAgICAgICAgaWYgKHNlbGVjdGVkTW92ZSAmJiBtaXJyb3JlZE1vdmUpIHsNCiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdTZWxlY3RlZCBtaXJyb3IgbW92ZSBiZWZvcmUgY29udmVyc2lvbjonLCBKU09OLnN0cmluZ2lmeShzZWxlY3RlZE1vdmUpKTsNCiAgICAgICAgICAgIGNvbnN0IG1pcnJvcmVkTW92ZUNvbnZlcnRlZCA9IHRoaXMuaGFzaGVyLm1pcnJvck1vdmUoc2VsZWN0ZWRNb3ZlKTsNCiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdDb252ZXJ0ZWQgbWlycm9yIG1vdmU6JywgSlNPTi5zdHJpbmdpZnkobWlycm9yZWRNb3ZlQ29udmVydGVkKSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBtaXJyb3JlZCBtb3ZlIGhhcyB2YWxpZCBzdHJ1Y3R1cmUNCiAgICAgICAgICAgIGlmIChtaXJyb3JlZE1vdmVDb252ZXJ0ZWQgJiYgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20gJiYgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbS5jID09PSAnbnVtYmVyJyAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQudG8uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50by5jID09PSAnbnVtYmVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQ7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdNaXJyb3JlZCBtb3ZlIGhhcyBpbnZhbGlkIHN0cnVjdHVyZSwgcmV0dXJuaW5nIG51bGwnKTsNCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmIChzZWxlY3RlZE1vdmUpIHsNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBzZWxlY3RlZCBtb3ZlIGhhcyB2YWxpZCBzdHJ1Y3R1cmUNCiAgICAgICAgICAgIGlmIChzZWxlY3RlZE1vdmUuZnJvbSAmJiBzZWxlY3RlZE1vdmUudG8gJiYNCiAgICAgICAgICAgICAgICB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLmZyb20uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIHNlbGVjdGVkTW92ZS5mcm9tLmMgPT09ICdudW1iZXInICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIHNlbGVjdGVkTW92ZS50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHNlbGVjdGVkTW92ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlbGVjdGVkIG1vdmUgaGFzIGludmFsaWQgc3RydWN0dXJlLCByZXR1cm5pbmcgbnVsbCcpOw0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICByZXR1cm4gbnVsbDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBTZWxlY3QgYSBtb3ZlIHJhbmRvbWx5IGJhc2VkIG9uIHdlaWdodHMNCiAgICAgKiBIaWdoZXIgd2VpZ2h0ID0gbW9yZSBsaWtlbHkgdG8gYmUgc2VsZWN0ZWQNCiAgICAgKi8NCiAgICBzZWxlY3RXZWlnaHRlZE1vdmUobW92ZXMpIHsNCiAgICAgICAgLy8gQ2FsY3VsYXRlIHRvdGFsIHdlaWdodA0KICAgICAgICBjb25zdCB0b3RhbFdlaWdodCA9IG1vdmVzLnJlZHVjZSgoc3VtLCBtb3ZlKSA9PiBzdW0gKyBtb3ZlLndlaWdodCwgMCk7DQoNCiAgICAgICAgLy8gR2VuZXJhdGUgcmFuZG9tIG51bWJlcg0KICAgICAgICBsZXQgcmFuZG9tID0gTWF0aC5yYW5kb20oKSAqIHRvdGFsV2VpZ2h0Ow0KDQogICAgICAgIC8vIFNlbGVjdCBtb3ZlDQogICAgICAgIGZvciAoY29uc3QgbW92ZSBvZiBtb3Zlcykgew0KICAgICAgICAgICAgcmFuZG9tIC09IG1vdmUud2VpZ2h0Ow0KICAgICAgICAgICAgaWYgKHJhbmRvbSA8PSAwKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogbW92ZS5mcm9tLmMgfSwgdG86IHsgcjogbW92ZS50by5yLCBjOiBtb3ZlLnRvLmMgfQ0KICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICAvLyBGYWxsYmFjayAoc2hvdWxkIG5ldmVyIHJlYWNoIGhlcmUpDQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmVzWzBdLmZyb20uciwgYzogbW92ZXNbMF0uZnJvbS5jIH0sIHRvOiB7IHI6IG1vdmVzWzBdLnRvLnIsIGM6IG1vdmVzWzBdLnRvLmMgfQ0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEhlbHBlciB0byBjcmVhdGUgaW5pdGlhbCBib2FyZCAobmVlZGVkIGZvciBib29rIGluaXRpYWxpemF0aW9uKQ0KICAgICAqLw0KICAgIGNyZWF0ZUluaXRpYWxCb2FyZCgpIHsNCiAgICAgICAgY29uc3QgYm9hcmQgPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKSk7DQogICAgICAgIA0KICAgICAgICAvLyBSZWQgcGllY2VzIChib3R0b20gLSByPTAtMikNCiAgICAgICAgYm9hcmRbMF1bMF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzFdID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bMl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVszXSA9IHsgdHlwZTogJ2Fkdmlzb3InLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bNF0gPSB7IHR5cGU6ICdnZW5lcmFsJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzVdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs2XSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzddID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bOF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzJdWzFdID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzJdWzddID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzBdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVsyXSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bNF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzZdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVs4XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCg0KICAgICAgICAvLyBCbGFjayBwaWVjZXMgKHRvcCAtIHI9Ny05KQ0KICAgICAgICBib2FyZFs5XVswXSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVsxXSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bMl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzNdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzRdID0geyB0eXBlOiAnZ2VuZXJhbCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzVdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzZdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs3XSA9IHsgdHlwZTogJ2hvcnNlJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bOF0gPSB7IHR5cGU6ICdjaGFyaW90JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbN11bMV0gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs3XVs3XSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzBdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzJdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzRdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzZdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzZdWzhdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAnYmxhY2snIH07DQoNCiAgICAgICAgcmV0dXJuIGJvYXJkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEVuYWJsZSBvciBkaXNhYmxlIG9wZW5pbmcgYm9vaw0KICAgICAqLw0KICAgIHNldEVuYWJsZWQoZW5hYmxlZCkgew0KICAgICAgICB0aGlzLmVuYWJsZWQgPSBlbmFibGVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENoZWNrIGlmIG9wZW5pbmcgYm9vayBpcyBlbmFibGVkDQogICAgICovDQogICAgaXNFbmFibGVkKCkgew0KICAgICAgICByZXR1cm4gdGhpcy5lbmFibGVkOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEdldCBzdGF0aXN0aWNzIGFib3V0IHRoZSBvcGVuaW5nIGJvb2sNCiAgICAgKi8NCiAgICBnZXRTdGF0cygpIHsNCiAgICAgICAgbGV0IHRvdGFsTW92ZXMgPSAwOw0KICAgICAgICB0aGlzLmJvb2suZm9yRWFjaChlbnRyeSA9PiB7DQogICAgICAgICAgICB0b3RhbE1vdmVzICs9IGVudHJ5Lm1vdmVzLmxlbmd0aDsNCiAgICAgICAgfSk7DQoNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIHBvc2l0aW9uczogdGhpcy5ib29rLnNpemUsDQogICAgICAgICAgICB0b3RhbE1vdmVzDQogICAgICAgIH07DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQWRkIG9wZW5pbmcgbGluZSBmcm9tIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24NCiAgICAgKiBAcGFyYW0gbm90YXRpb24gQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uIChlLmcuLCBbJ+eCruS6jOW5s+S6lCcsICfpqaw46L+bNyddKQ0KICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIGFycmF5IG9mIHdlaWdodHMgZm9yIGVhY2ggbW92ZQ0KICAgICAqLw0KICAgIGFkZE9wZW5pbmdMaW5lRnJvbU5vdGF0aW9uKG5vdGF0aW9uLCB3ZWlnaHRzKSB7DQogICAgICAgIC8vIENvbnZlcnQgdHJhZGl0aW9uYWwgbm90YXRpb24gdG8gY29vcmRpbmF0ZSBmb3JtYXQNCiAgICAgICAgY29uc3QgbW92ZXMgPSB0aGlzLm5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvbik7DQogICAgICAgIC8vIEFkZCB0aGUgbW92ZXMgdG8gdGhlIG9wZW5pbmcgYm9vaw0KICAgICAgICB0aGlzLmFkZE9wZW5pbmdMaW5lKG1vdmVzLCB3ZWlnaHRzKTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBBZGQgb3BlbmluZyBsaW5lIGZyb20gc3RyaW5nIHdpdGggc3BhY2Utc2VwYXJhdGVkIHRyYWRpdGlvbmFsIENoaW5lc2UgY2hlc3Mgbm90YXRpb24NCiAgICAgKiBAcGFyYW0gbm90YXRpb25BcnJheSBBcnJheSBvZiBzdHJpbmdzLCBlYWNoIGNvbnRhaW5pbmcgc3BhY2Utc2VwYXJhdGVkIG1vdmVzIChlLmcuLCBbJ+eCruS6jOW5s+S6lCDpqaw46L+bNyDovabkuIDlubPkuownXSkNCiAgICAgKiBAcGFyYW0gd2VpZ2h0cyBPcHRpb25hbCBhcnJheSBvZiB3ZWlnaHRzIGZvciBlYWNoIG1vdmUNCiAgICAgKi8NCiAgICBhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcobm90YXRpb25BcnJheSwgd2VpZ2h0cykgew0KICAgICAgICAvLyBQcm9jZXNzIGVhY2ggc3RyaW5nIGluIHRoZSBhcnJheQ0KICAgICAgICBpZiAoIW5vdGF0aW9uQXJyYXkgfHwgIUFycmF5LmlzQXJyYXkobm90YXRpb25BcnJheSkgfHwgbm90YXRpb25BcnJheS5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgfQ0KICAgICAgICBub3RhdGlvbkFycmF5LmZvckVhY2gobm90YXRpb25TdHJpbmcgPT4gew0KICAgICAgICAgICAgLy8gU3BsaXQgdGhlIHN0cmluZyBieSBzcGFjZXMgdG8gZ2V0IGluZGl2aWR1YWwgbW92ZXMNCiAgICAgICAgICAgIGNvbnN0IG5vdGF0aW9uID0gbm90YXRpb25TdHJpbmcuc3BsaXQoJyAnKS5maWx0ZXIobW92ZSA9PiBtb3ZlLnRyaW0oKSAhPT0gJycpOw0KICAgICAgICAgICAgLy8gQ2FsbCBleGlzdGluZyBmdW5jdGlvbiB0byBhZGQgdGhlIGxpbmUNCiAgICAgICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tTm90YXRpb24obm90YXRpb24sIHdlaWdodHMpOw0KICAgICAgICB9KTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBDb252ZXJ0IGNvb3JkaW5hdGUtYmFzZWQgbW92ZXMgdG8gdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbg0KICAgICAqIEBwYXJhbSBib2FyZEhpc3RvcnkgQXJyYXkgb2YgYm9hcmQgc3RhdGVzIHJlcHJlc2VudGluZyB0aGUgZ2FtZSBoaXN0b3J5DQogICAgICogQHBhcmFtIG1vdmVIaXN0b3J5IEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0DQogICAgICogQHJldHVybnMgQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uDQogICAgICovDQogICAgbW92ZXNUb05vdGF0aW9uKGJvYXJkSGlzdG9yeSwgbW92ZUhpc3RvcnkpIHsNCiAgICAgICAgY29uc3Qgbm90YXRpb24gPSBbXTsNCiAgICAgICAgbGV0IGN1cnJlbnRDb2xvciA9ICdyZWQnOyAvLyBSZWQgbW92ZXMgZmlyc3QNCg0KICAgICAgICAvLyBUeXBlIHRvIHBpZWNlIGNoYXJhY3RlciBtYXBwaW5nDQogICAgICAgIGNvbnN0IHR5cGVUb1BpZWNlID0gew0KICAgICAgICAgICAgJ2dlbmVyYWwnOiB7ICdyZWQnOiAn5biFJywgJ2JsYWNrJzogJ+WwhicgfSwNCiAgICAgICAgICAgICdhZHZpc29yJzogeyAncmVkJzogJ+S7lScsICdibGFjayc6ICflo6snIH0sDQogICAgICAgICAgICAnZWxlcGhhbnQnOiB7ICdyZWQnOiAn55u4JywgJ2JsYWNrJzogJ+ixoScgfSwNCiAgICAgICAgICAgICdob3JzZSc6IHsgJ3JlZCc6ICfpqawnLCAnYmxhY2snOiAn6amsJyB9LA0KICAgICAgICAgICAgJ2NoYXJpb3QnOiB7ICdyZWQnOiAn6L2mJywgJ2JsYWNrJzogJ+i9picgfSwNCiAgICAgICAgICAgICdjYW5ub24nOiB7ICdyZWQnOiAn54KuJywgJ2JsYWNrJzogJ+eCricgfSwNCiAgICAgICAgICAgICdzb2xkaWVyJzogeyAncmVkJzogJ+WFtScsICdibGFjayc6ICfljZInIH0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBDb2x1bW4gbWFwcGluZyAoY29vcmRpbmF0ZSAwLTggdG8gdHJhZGl0aW9uYWwg5LmdLeS4gCBmb3IgcmVkLCA5LTEgZm9yIGJsYWNrKQ0KICAgICAgICBjb25zdCBjb2xUb0NoaW5lc2UgPSBbJ+S5nScsICflhasnLCAn5LiDJywgJ+WFrScsICfkupQnLCAn5ZubJywgJ+S4iScsICfkuownLCAn5LiAJ107DQogICAgICAgIGNvbnN0IGNvbFRvQXJhYmljID0gWyc5JywgJzgnLCAnNycsICc2JywgJzUnLCAnNCcsICczJywgJzInLCAnMSddOw0KDQogICAgICAgIC8vIERpZ2l0IHRvIENoaW5lc2UgbnVtYmVyIG1hcHBpbmcgZm9yIHN0ZXBzDQogICAgICAgIGNvbnN0IGRpZ2l0VG9DaGluZXNlID0gWycnLCAn5LiAJywgJ+S6jCcsICfkuIknLCAn5ZubJywgJ+S6lCcsICflha0nLCAn5LiDJywgJ+WFqycsICfkuZ0nXTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY2hlY2sgaWYgdGhlcmUgYXJlIG11bHRpcGxlIHNhbWUtdHlwZSBwaWVjZXMgaW4gdGhlIHNhbWUgY29sdW1uDQogICAgICAgIGNvbnN0IGhhc1NhbWVUeXBlSW5Db2x1bW4gPSAoYm9hcmQsIHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgZXhjbHVkZVJvdykgPT4gew0KICAgICAgICAgICAgbGV0IGNvdW50ID0gMDsNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY29sXTsNCiAgICAgICAgICAgICAgICBpZiAociA9PT0gZXhjbHVkZVJvdykgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09IHBpZWNlVHlwZSAmJiBwaWVjZS5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgY291bnQrKzsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICByZXR1cm4gY291bnQgPiAwOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBkZXRlcm1pbmUgZnJvbnQvYmFjayBtYXJrZXINCiAgICAgICAgY29uc3QgZ2V0RnJvbnRCYWNrTWFya2VyID0gKGJvYXJkLCBwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGN1cnJlbnRSb3cpID0+IHsNCiAgICAgICAgICAgIGNvbnN0IHNhbWVUeXBlUGllY2VzID0gW107DQogICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDEwOyByKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NvbF07DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09IHBpZWNlVHlwZSAmJiBwaWVjZS5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgc2FtZVR5cGVQaWVjZXMucHVzaChyKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAoc2FtZVR5cGVQaWVjZXMubGVuZ3RoIDw9IDEpIHJldHVybiAnJzsNCiAgICAgICAgICAgIGlmIChjb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIhyPTctOe+8ie+8jHLlgLzotorlpKfotorpnaDov5HmlYzmlrnvvIzmmK8i5YmNIg0KICAgICAgICAgICAgICAgIGNvbnN0IHNvcnRlZFJvd3MgPSBbLi4uc2FtZVR5cGVQaWVjZXNdLnNvcnQoKGEsIGIpID0+IGIgLSBhKTsgLy8gSGlnaGVyIHJvd3MgZmlyc3QgPSBjbG9zZXIgdG8gb3Bwb25lbnQNCiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkUm93c1swXSA9PT0gY3VycmVudFJvdyA/ICfliY0nIDogJ+WQjic7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8iHI9MC0y77yJ77yMcuWAvOi2iuWwj+i2iumdoOi/keaVjOaWue+8jOaYryLliY0iDQogICAgICAgICAgICAgICAgY29uc3Qgc29ydGVkUm93cyA9IFsuLi5zYW1lVHlwZVBpZWNlc10uc29ydCgoYSwgYikgPT4gYSAtIGIpOyAvLyBMb3dlciByb3dzIGZpcnN0ID0gY2xvc2VyIHRvIG9wcG9uZW50DQogICAgICAgICAgICAgICAgcmV0dXJuIHNvcnRlZFJvd3NbMF0gPT09IGN1cnJlbnRSb3cgPyAn5YmNJyA6ICflkI4nOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIFByb2Nlc3MgZWFjaCBtb3ZlDQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbW92ZUhpc3RvcnkubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IG1vdmUgPSBtb3ZlSGlzdG9yeVtpXTsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkQmVmb3JlID0gYm9hcmRIaXN0b3J5W2ldOw0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZEJlZm9yZVttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICBpZiAoIXBpZWNlKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gcGllY2UgZm91bmQgYXQgZnJvbSBwb3NpdGlvbjonLCBtb3ZlLmZyb20pOw0KICAgICAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZS50eXBlOw0KICAgICAgICAgICAgY29uc3QgcGllY2VDaGFyID0gdHlwZVRvUGllY2VbcGllY2VUeXBlXVtwaWVjZS5jb2xvcl07DQogICAgICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlLmNvbG9yID09PSAncmVkJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUgYXJlIG11bHRpcGxlIHNhbWUtdHlwZSBwaWVjZXMgaW4gdGhlIHNhbWUgY29sdW1uDQogICAgICAgICAgICBjb25zdCBoYXNEdXBsaWNhdGUgPSBoYXNTYW1lVHlwZUluQ29sdW1uKGJvYXJkQmVmb3JlLCBwaWVjZVR5cGUsIHBpZWNlLmNvbG9yLCBtb3ZlLmZyb20uYywgbW92ZS5mcm9tLnIpOw0KICAgICAgICAgICAgLy8gR2V0IGZyb250L2JhY2sgbWFya2VyIGlmIG5lZWRlZA0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25NYXJrZXIgPSBoYXNEdXBsaWNhdGUgPyBnZXRGcm9udEJhY2tNYXJrZXIoYm9hcmRCZWZvcmUsIHBpZWNlVHlwZSwgcGllY2UuY29sb3IsIG1vdmUuZnJvbS5jLCBtb3ZlLmZyb20ucikgOiAnJzsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gRGV0ZXJtaW5lIG5vdGF0aW9uIGJhc2VkIG9uIHBpZWNlIHR5cGUgYW5kIG1vdmUgZGlyZWN0aW9uDQogICAgICAgICAgICBsZXQgbm90YXRpb25TdHI7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdob3JzZScgfHwgcGllY2VUeXBlID09PSAnYWR2aXNvcicgfHwgcGllY2VUeXBlID09PSAnZWxlcGhhbnQnKSB7DQogICAgICAgICAgICAgICAgLy8gRGlhZ29uYWwgbW92aW5nIHBpZWNlcyAtIG9ubHkgdXNlIOi/my/pgIAsIHJlY29yZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6L+b77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSBtb3ZlLnRvLnIgPiBtb3ZlLmZyb20uciA/ICfov5snIDogJ+mAgCc7DQogICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnku47lj7PlvoDlt6bmmK8xLTnvvIzpnIDopoHlj43ovazliJfmmKDlsIQNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWue+8muaVjOaWueWcqOW6lemDqO+8iHI9MO+8ie+8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/ov5vvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IG1vdmUudG8uciA8IG1vdmUuZnJvbS5yID8gJ+i/mycgOiAn6YCAJzsNCiAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcgfHwgcGllY2VUeXBlID09PSAnY2hhcmlvdCcgfHwgcGllY2VUeXBlID09PSAnY2Fubm9uJyB8fCBwaWVjZVR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIC8vIFN0cmFpZ2h0IG1vdmluZyBwaWVjZXMgLSDov5sv6YCAL+W5sw0KICAgICAgICAgICAgICAgIGlmIChtb3ZlLmZyb20uYyA9PT0gbW92ZS50by5jKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIG1vdmUgLSDov5sv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXBzID0gTWF0aC5hYnMobW92ZS50by5yIC0gbW92ZS5mcm9tLnIpOw0KICAgICAgICAgICAgICAgICAgICAvLyDov5vmmK/pnaDov5HmlYzmlrnnmoTmlrnlkJHvvIzpgIDmmK/ov5znprvmlYzmlrnnmoTmlrnlkJENCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa577ya5pWM5pa55Zyo6aG26YOo77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+i/m++8jOWQkeS4i++8iHLlh4/lsI/vvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+i/m++8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gKGlzUmVkID8gbW92ZS50by5yID4gbW92ZS5mcm9tLnIgOiBtb3ZlLnRvLnIgPCBtb3ZlLmZyb20ucikgPyAn6L+bJyA6ICfpgIAnOw0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBzdGVwcyBpcyBhIHZhbGlkIG51bWJlciBiZXR3ZWVuIDEtOQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsaWRTdGVwcyA9IE1hdGgubWF4KDEsIE1hdGgubWluKDksIE1hdGgucm91bmQoc3RlcHMgfHwgMSkpKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfSR7ZGlyZWN0aW9ufSR7ZGlnaXRUb0NoaW5lc2VbdmFsaWRTdGVwc10gfHwgJyd9YDsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhA0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY107DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgc3RlcHMgaXMgYSB2YWxpZCBudW1iZXINCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkU3RlcHMgPSBNYXRoLnJvdW5kKHN0ZXBzIHx8IDEpOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt2YWxpZFN0ZXBzfWA7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIG1vdmUgLSDlubMNCiAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9DaGluZXNlW21vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9DaGluZXNlW21vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH3lubMke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnku47lj7PlvoDlt6bmmK8xLTnvvIzpnIDopoHlj43ovazliJfmmKDlsIQNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfeW5syR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignVW5rbm93biBwaWVjZSB0eXBlOicsIHBpZWNlVHlwZSk7DQogICAgICAgICAgICAgICAgY29udGludWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIG5vdGF0aW9uLnB1c2gobm90YXRpb25TdHIpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBTd2l0Y2ggY29sb3IgZm9yIG5leHQgbW92ZQ0KICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgcmV0dXJuIG5vdGF0aW9uOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENvbnZlcnQgdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbiB0byBjb29yZGluYXRlIG1vdmVzDQogICAgICogQHBhcmFtIG5vdGF0aW9uIEFycmF5IG9mIG1vdmUgc3RyaW5ncyBpbiB0cmFkaXRpb25hbCBub3RhdGlvbg0KICAgICAqIEByZXR1cm5zIEFycmF5IG9mIG1vdmVzIGluIGNvb3JkaW5hdGUgZm9ybWF0DQogICAgICovDQogICAgbm90YXRpb25Ub01vdmVzKG5vdGF0aW9uLCBpbml0aWFsQm9hcmQgPSBudWxsKSB7DQogICAgICAgIC8vIOehruS/nW5vdGF0aW9u5piv5pWw57uE5LiU5LiN5Li656m6DQogICAgICAgIGlmICghbm90YXRpb24gfHwgIUFycmF5LmlzQXJyYXkobm90YXRpb24pIHx8IG5vdGF0aW9uLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgcmV0dXJuIFtdOw0KICAgICAgICB9DQogICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgIGxldCBjdXJyZW50Q29sb3IgPSAncmVkJzsgLy8gUmVkIG1vdmVzIGZpcnN0DQoNCiAgICAgICAgLy8gUGllY2UgY2hhcmFjdGVyIHRvIHR5cGUgbWFwcGluZw0KICAgICAgICBjb25zdCBwaWVjZU1hcCA9IHsNCiAgICAgICAgICAgICflsIYnOiAnZ2VuZXJhbCcsICfluIUnOiAnZ2VuZXJhbCcsDQogICAgICAgICAgICAn5aOrJzogJ2Fkdmlzb3InLCAn5LuVJzogJ2Fkdmlzb3InLA0KICAgICAgICAgICAgJ+ixoSc6ICdlbGVwaGFudCcsICfnm7gnOiAnZWxlcGhhbnQnLA0KICAgICAgICAgICAgJ+mprCc6ICdob3JzZScsDQogICAgICAgICAgICAn6L2mJzogJ2NoYXJpb3QnLA0KICAgICAgICAgICAgJ+eCric6ICdjYW5ub24nLA0KICAgICAgICAgICAgJ+WNkic6ICdzb2xkaWVyJywgJ+WFtSc6ICdzb2xkaWVyJw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENvbHVtbiBtYXBwaW5nICh0cmFkaXRpb25hbCBub3RhdGlvbiB1c2VzIDEtOSBmcm9tIHJpZ2h0IHRvIGxlZnQpDQogICAgICAgIGNvbnN0IGNvbE1hcCA9IHsNCiAgICAgICAgICAgICfkuIAnOiA4LCAnMSc6IDgsDQogICAgICAgICAgICAn5LqMJzogNywgJzInOiA3LA0KICAgICAgICAgICAgJ+S4iSc6IDYsICczJzogNiwNCiAgICAgICAgICAgICflm5snOiA1LCAnNCc6IDUsDQogICAgICAgICAgICAn5LqUJzogNCwgJzUnOiA0LA0KICAgICAgICAgICAgJ+WFrSc6IDMsICc2JzogMywNCiAgICAgICAgICAgICfkuIMnOiAyLCAnNyc6IDIsDQogICAgICAgICAgICAn5YWrJzogMSwgJzgnOiAxLA0KICAgICAgICAgICAgJ+S5nSc6IDAsICc5JzogMA0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENoaW5lc2UgbnVtYmVyIHRvIGRpZ2l0IG1hcHBpbmcNCiAgICAgICAgY29uc3QgY2hpbmVzZU51bWJlck1hcCA9IHsNCiAgICAgICAgICAgICfkuIAnOiAxLCAnMSc6IDEsDQogICAgICAgICAgICAn5LqMJzogMiwgJzInOiAyLA0KICAgICAgICAgICAgJ+S4iSc6IDMsICczJzogMywNCiAgICAgICAgICAgICflm5snOiA0LCAnNCc6IDQsDQogICAgICAgICAgICAn5LqUJzogNSwgJzUnOiA1LA0KICAgICAgICAgICAgJ+WFrSc6IDYsICc2JzogNiwNCiAgICAgICAgICAgICfkuIMnOiA3LCAnNyc6IDcsDQogICAgICAgICAgICAn5YWrJzogOCwgJzgnOiA4LA0KICAgICAgICAgICAgJ+S5nSc6IDksICc5JzogOQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEluaXRpYWwgcG9zaXRpb25zIG9mIHBpZWNlcyAocmVkIGFuZCBibGFjaykNCiAgICAgICAgLy8g5L+u5aSN77ya5LiO5paw5Z2Q5qCH57O757uf5L+d5oyB5LiA6Ie077yM57qi5pa55Zyo5bqV6YOo77yIcj0wLTLvvInvvIzpu5HmlrnlnKjpobbpg6jvvIhyPTctOe+8iQ0KICAgICAgICBjb25zdCBkZWZhdWx0SW5pdGlhbFBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICdyZWQtZ2VuZXJhbCc6IHsgcjogMCwgYzogNCB9LA0KICAgICAgICAgICAgJ3JlZC1hZHZpc29yJzogW3sgcjogMCwgYzogMyB9LCB7IHI6IDAsIGM6IDUgfV0sDQogICAgICAgICAgICAncmVkLWVsZXBoYW50JzogW3sgcjogMCwgYzogMiB9LCB7IHI6IDAsIGM6IDYgfV0sDQogICAgICAgICAgICAncmVkLWhvcnNlJzogW3sgcjogMCwgYzogMSB9LCB7IHI6IDAsIGM6IDcgfV0sDQogICAgICAgICAgICAncmVkLWNoYXJpb3QnOiBbeyByOiAwLCBjOiAwIH0sIHsgcjogMCwgYzogOCB9XSwNCiAgICAgICAgICAgICdyZWQtY2Fubm9uJzogW3sgcjogMiwgYzogMSB9LCB7IHI6IDIsIGM6IDcgfV0sDQogICAgICAgICAgICAncmVkLXNvbGRpZXInOiBbeyByOiAzLCBjOiAwIH0sIHsgcjogMywgYzogMiB9LCB7IHI6IDMsIGM6IDQgfSwgeyByOiAzLCBjOiA2IH0sIHsgcjogMywgYzogOCB9XSwNCiAgICAgICAgICAgICdibGFjay1nZW5lcmFsJzogeyByOiA5LCBjOiA0IH0sDQogICAgICAgICAgICAnYmxhY2stYWR2aXNvcic6IFt7IHI6IDksIGM6IDMgfSwgeyByOiA5LCBjOiA1IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWVsZXBoYW50JzogW3sgcjogOSwgYzogMiB9LCB7IHI6IDksIGM6IDYgfV0sDQogICAgICAgICAgICAnYmxhY2staG9yc2UnOiBbeyByOiA5LCBjOiAxIH0sIHsgcjogOSwgYzogNyB9XSwNCiAgICAgICAgICAgICdibGFjay1jaGFyaW90JzogW3sgcjogOSwgYzogMCB9LCB7IHI6IDksIGM6IDggfV0sDQogICAgICAgICAgICAnYmxhY2stY2Fubm9uJzogW3sgcjogNywgYzogMSB9LCB7IHI6IDcsIGM6IDcgfV0sDQogICAgICAgICAgICAnYmxhY2stc29sZGllcic6IFt7IHI6IDYsIGM6IDAgfSwgeyByOiA2LCBjOiAyIH0sIHsgcjogNiwgYzogNCB9LCB7IHI6IDYsIGM6IDYgfSwgeyByOiA2LCBjOiA4IH1dDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gVHJhY2sgcGllY2UgcG9zaXRpb25zIGFzIG1vdmVzIGFyZSBtYWRlDQogICAgICAgIGxldCBwaWVjZVBvc2l0aW9ucyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoZGVmYXVsdEluaXRpYWxQb3NpdGlvbnMpKTsNCiAgICAgICAgDQogICAgICAgIC8vIElmIGluaXRpYWwgYm9hcmQgaXMgcHJvdmlkZWQsIGluaXRpYWxpemUgcGllY2UgcG9zaXRpb25zIGZyb20gaXQNCiAgICAgICAgaWYgKGluaXRpYWxCb2FyZCkgew0KICAgICAgICAgICAgLy8gUmVzZXQgcGllY2UgcG9zaXRpb25zIGJhc2VkIG9uIGluaXRpYWwgYm9hcmQNCiAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zID0gew0KICAgICAgICAgICAgICAgICdyZWQtZ2VuZXJhbCc6IHsgcjogLTEsIGM6IC0xIH0sDQogICAgICAgICAgICAgICAgJ3JlZC1hZHZpc29yJzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1lbGVwaGFudCc6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtaG9yc2UnOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWNoYXJpb3QnOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWNhbm5vbic6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtc29sZGllcic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1nZW5lcmFsJzogeyByOiAtMSwgYzogLTEgfSwNCiAgICAgICAgICAgICAgICAnYmxhY2stYWR2aXNvcic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1lbGVwaGFudCc6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1ob3JzZSc6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1jaGFyaW90JzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWNhbm5vbic6IFtdLA0KICAgICAgICAgICAgICAgICdibGFjay1zb2xkaWVyJzogW10NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFBvcHVsYXRlIHBpZWNlIHBvc2l0aW9ucyBmcm9tIGluaXRpYWwgYm9hcmQNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gaW5pdGlhbEJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke3BpZWNlLmNvbG9yfS0ke3BpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaWVjZVBvc2l0aW9uc1trZXldID0geyByLCBjIH07DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2tleV0ucHVzaCh7IHIsIGMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZmluZCBwaWVjZSBwb3NpdGlvbg0KICAgICAgICBjb25zdCBmaW5kUGllY2VQb3NpdGlvbiA9IChwaWVjZVR5cGUsIGNvbG9yLCBjb2wsIGRpcmVjdGlvbiwgZnJvbnRCYWNrTWFya2VyID0gbnVsbCkgPT4gew0KICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7Y29sb3J9LSR7cGllY2VUeXBlfWA7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1trZXldOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiBwb3NpdGlvbnMgZXhpc3QgYW5kIGFyZSB2YWxpZA0KICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBwb3NpdGlvbnMgZm91bmQgZm9yIHBpZWNlOicsIGtleSk7DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgIHJldHVybiBwb3NpdGlvbnM7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEZpbmQgcGllY2VzIG9uIHRoZSBzcGVjaWZpZWQgY29sdW1uDQogICAgICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gcG9zaXRpb25zLmZpbHRlcihwb3MgPT4gcG9zLmMgPT09IGNvbCk7DQoNCiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIGNhbmRpZGF0ZXMgZm91bmQgZm9yIHBpZWNlOicsIGtleSwgJ29uIGNvbHVtbjonLCBjb2wpOw0KICAgICAgICAgICAgICAgIC8vIEFkZGl0aW9uYWwgZGVidWcgaW5mbyBmb3IgY2Fubm9uDQogICAgICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2Nhbm5vbicgJiYgY29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0RFQlVHOiBDYW5kaWRhdGVzIGFmdGVyIGZpbHRlcjonLCBjYW5kaWRhdGVzKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMSkgew0KICAgICAgICAgICAgICAgIHJldHVybiBjYW5kaWRhdGVzWzBdOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBJZiBmcm9udC9iYWNrIG1hcmtlciBpcyBwcm92aWRlZCwgdXNlIGl0IHRvIGRldGVybWluZSB0aGUgcGllY2UNCiAgICAgICAgICAgIGlmIChmcm9udEJhY2tNYXJrZXIgPT09ICfliY0nKSB7DQogICAgICAgICAgICAgICAgLy8g5YmN54Ku77ya6Z2g6L+R5pWM5pa555qE5qOL5a2QDQogICAgICAgICAgICAgICAgLy8g57qi5pa577yacuWAvOi+g+Wkp+eahOabtOmdoOi/keaVjOaWue+8iOWJje+8iQ0KICAgICAgICAgICAgICAgIC8vIOm7keaWue+8mnLlgLzovoPlsI/nmoTmm7TpnaDov5HmlYzmlrnvvIjliY3vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfSBlbHNlIGlmIChmcm9udEJhY2tNYXJrZXIgPT09ICflkI4nKSB7DQogICAgICAgICAgICAgICAgLy8g5ZCO54Ku77ya6Z2g6L+R5bex5pa555qE5qOL5a2QDQogICAgICAgICAgICAgICAgLy8g57qi5pa577yacuWAvOi+g+Wwj+eahOabtOmdoOi/keW3seaWue+8iOWQju+8iQ0KICAgICAgICAgICAgICAgIC8vIOm7keaWue+8mnLlgLzovoPlpKfnmoTmm7TpnaDov5Hlt7HmlrnvvIjlkI7vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBJZiBtdWx0aXBsZSBwaWVjZXMgb24gdGhlIHNhbWUgY29sdW1uIGFuZCBubyBtYXJrZXIsIGRldGVybWluZSBiYXNlZCBvbiBkaXJlY3Rpb24NCiAgICAgICAgICAgIC8vIOWvueS6juWQjOS4gOWIl+eahOaji+WtkO+8jOmAmui/h+avlOi+g3LlgLzmnaXljLrliIYNCiAgICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT09ICfov5snKSB7DQogICAgICAgICAgICAgICAgLy8g6L+b5piv5ZCR5pWM5pa55pa55ZCR56e75Yqo77yM5omA5Lul6YCJ5oup5pu06Z2g6L+R5bex5pa555qE5qOL5a2Q77yI5ZCO77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yIDwgY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoZGlyZWN0aW9uID09PSAn6YCAJykgew0KICAgICAgICAgICAgICAgIC8vIOmAgOaYr+WQkeW3seaWueaWueWQkeenu+WKqO+8jOaJgOS7pemAieaLqeabtOmdoOi/keaVjOaWueeahOaji+WtkO+8iOWJje+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIHJldHVybiBjYW5kaWRhdGVzWzBdOyAvLyBEZWZhdWx0IHRvIGZpcnN0IGlmIGRpcmVjdGlvbiBpcyAn5bmzJyBhbmQgbm8gbWFya2VyDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIHVwZGF0ZSBwaWVjZSBwb3NpdGlvbg0KICAgICAgICBjb25zdCB1cGRhdGVQaWVjZVBvc2l0aW9uID0gKHBpZWNlVHlwZSwgY29sb3IsIG9sZFBvcywgbmV3UG9zKSA9PiB7DQogICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtjb2xvcn0tJHtwaWVjZVR5cGV9YDsNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2tleV07DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHBvc2l0aW9ucyBleGlzdCBhbmQgYXJlIHZhbGlkDQogICAgICAgICAgICBpZiAoIXBvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogTm8gcG9zaXRpb25zIGZvdW5kIGZvciBwaWVjZTonLCBrZXkpOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgcG9zaXRpb25zLnIgPSBuZXdQb3MucjsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnMuYyA9IG5ld1Bvcy5jOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgY29uc3QgaW5kZXggPSBwb3NpdGlvbnMuZmluZEluZGV4KHBvcyA9PiBwb3MuciA9PT0gb2xkUG9zLnIgJiYgcG9zLmMgPT09IG9sZFBvcy5jKTsNCiAgICAgICAgICAgIGlmIChpbmRleCAhPT0gLTEpIHsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnNbaW5kZXhdLnIgPSBuZXdQb3MucjsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnNbaW5kZXhdLmMgPSBuZXdQb3MuYzsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBDb3VsZCBub3QgZmluZCBwaWVjZSBwb3NpdGlvbiB0byB1cGRhdGU6Jywgb2xkUG9zLCAnaW4nLCBwb3NpdGlvbnMpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiBwb3NpdGlvbiBpcyB2YWxpZA0KICAgICAgICBjb25zdCBpc1ZhbGlkUG9zID0gKHIsIGMpID0+IHIgPj0gMCAmJiByIDwgMTAgJiYgYyA+PSAwICYmIGMgPCA5Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgaG9yc2UgbW92ZXMNCiAgICAgICAgY29uc3QgZ2V0SG9yc2VNb3ZlcyA9IChwb3MpID0+IHsNCiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107DQogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgZHI6IC0yLCBkYzogLTEgfSwgeyBkcjogLTIsIGRjOiAxIH0sDQogICAgICAgICAgICAgICAgeyBkcjogLTEsIGRjOiAtMiB9LCB7IGRyOiAtMSwgZGM6IDIgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAxLCBkYzogLTIgfSwgeyBkcjogMSwgZGM6IDIgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAyLCBkYzogLTEgfSwgeyBkcjogMiwgZGM6IDEgfQ0KICAgICAgICAgICAgXTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGhvcnNlIGNhbiBtb3ZlIGluIHRoZSBkaXJlY3Rpb24NCiAgICAgICAgICAgIGNvbnN0IGNhbk1vdmUgPSAoYmxvY2tlZFIsIGJsb2NrZWRDKSA9PiB7DQogICAgICAgICAgICAgICAgaWYgKCFpc1ZhbGlkUG9zKHIgKyBibG9ja2VkUiwgYyArIGJsb2NrZWRDKSkgcmV0dXJuIGZhbHNlOw0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfTsNCg0KICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9LCBpbmRleCkgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IGJsb2NrZWRSID0gZHIgPiAwID8gMSA6IGRyIDwgMCA/IC0xIDogMDsNCiAgICAgICAgICAgICAgICBjb25zdCBibG9ja2VkQyA9IGRjID4gMCA/IDEgOiBkYyA8IDAgPyAtMSA6IDA7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHBhdGggaXMgYmxvY2tlZA0KICAgICAgICAgICAgICAgIGlmICgoaW5kZXggPCAyIHx8IGluZGV4ID49IDYpICYmIGJsb2NrZWRSICE9PSAwKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIFZlcnRpY2FsIGJsb2NrZWQNCiAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5Nb3ZlKGJsb2NrZWRSLCAwKSkgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoYmxvY2tlZEMgIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBibG9ja2VkDQogICAgICAgICAgICAgICAgICAgIGlmICghY2FuTW92ZSgwLCBibG9ja2VkQykpIHJldHVybjsNCiAgICAgICAgICAgICAgICB9DQoNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7DQogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobmV3UiwgbmV3QykpIHsNCiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSk7DQoNCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGVsZXBoYW50IG1vdmVzDQogICAgICAgIGNvbnN0IGdldEVsZXBoYW50TW92ZXMgPSAocG9zLCBjb2xvcikgPT4gew0KICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyBkcjogLTIsIGRjOiAtMiB9LCB7IGRyOiAtMiwgZGM6IDIgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAyLCBkYzogLTIgfSwgeyBkcjogMiwgZGM6IDIgfQ0KICAgICAgICAgICAgXTsNCg0KICAgICAgICAgICAgLy8gRWxlcGhhbnQncyB0ZXJyaXRvcnkgLSByZWQgZWxlcGhhbnRzIGNhbiBvbmx5IGJlIGluIHI8PTQsIGJsYWNrIGVsZXBoYW50cyBpbiByPj01DQogICAgICAgICAgICBjb25zdCBpc0luVGVycml0b3J5ID0gKHIpID0+IHsNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gciA8PSA0IDogciA+PSA1Ow0KICAgICAgICAgICAgfTsNCg0KICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKCh7IGRyLCBkYyB9KSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgbWlkUiA9IHIgKyBkciAvIDI7DQogICAgICAgICAgICAgICAgY29uc3QgbWlkQyA9IGMgKyBkYyAvIDI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IHIgKyBkcjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdDID0gYyArIGRjOw0KDQogICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgbWlkIHBvc2l0aW9uIGlzIGVtcHR5IGFuZCBuZXcgcG9zaXRpb24gaXMgdmFsaWQNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhtaWRSLCBtaWRDKSAmJiBpc1ZhbGlkUG9zKG5ld1IsIG5ld0MpICYmIGlzSW5UZXJyaXRvcnkobmV3UikpIHsNCiAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5ld1IsIGM6IG5ld0MgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSk7DQoNCiAgICAgICAgICAgIHJldHVybiBtb3ZlczsNCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGFkdmlzb3IgbW92ZXMNCiAgICAgICAgY29uc3QgZ2V0QWR2aXNvck1vdmVzID0gKHBvcywgY29sb3IpID0+IHsNCiAgICAgICAgICAgIGlmICghcG9zKSByZXR1cm4gW107DQogICAgICAgICAgICBjb25zdCBtb3ZlcyA9IFtdOw0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25zID0gWw0KICAgICAgICAgICAgICAgIHsgZHI6IC0xLCBkYzogLTEgfSwgeyBkcjogLTEsIGRjOiAxIH0sDQogICAgICAgICAgICAgICAgeyBkcjogMSwgZGM6IC0xIH0sIHsgZHI6IDEsIGRjOiAxIH0NCiAgICAgICAgICAgIF07DQoNCiAgICAgICAgICAgIC8vIEFkdmlzb3IncyB0ZXJyaXRvcnkgKHBhbGFjZSkgLSByZWQgYWR2aXNvcnMgaW4gcj0wLTIsYz0zLTUsIGJsYWNrIGFkdmlzb3JzIGluIHI9Ny05LGM9My01DQogICAgICAgICAgICBjb25zdCBpc0luUGFsYWNlID0gKHIsIGMpID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCByUmFuZ2UgPSBjb2xvciA9PT0gJ3JlZCcgPyBbMCwgMl0gOiBbNywgOV07DQogICAgICAgICAgICAgICAgcmV0dXJuIHIgPj0gclJhbmdlWzBdICYmIHIgPD0gclJhbmdlWzFdICYmIGMgPj0gMyAmJiBjIDw9IDU7DQogICAgICAgICAgICB9Ow0KDQogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0pID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7DQogICAgICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MobmV3UiwgbmV3QykgJiYgaXNJblBhbGFjZShuZXdSLCBuZXdDKSkgew0KICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCg0KICAgICAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBib2FyZCB0byB0cmFjayBtb3Zlcw0KICAgICAgICBsZXQgdGVtcEJvYXJkID0gdGhpcy5jcmVhdGVJbml0aWFsQm9hcmQoKTsNCiAgICAgICAgDQogICAgICAgIC8vIEVuc3VyZSB0ZW1wQm9hcmQgaXMgcHJvcGVybHkgaW5pdGlhbGl6ZWQNCiAgICAgICAgaWYgKCF0ZW1wQm9hcmQgfHwgdGVtcEJvYXJkLmxlbmd0aCAhPT0gMTApIHsNCiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgYm9hcmQgaW5pdGlhbGl6YXRpb24nKTsNCiAgICAgICAgICAgIHJldHVybiBbXTsNCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy8gVmVyaWZ5IGFsbCByb3dzIGhhdmUgOSBjb2x1bW5zDQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTA7IGkrKykgew0KICAgICAgICAgICAgaWYgKCF0ZW1wQm9hcmRbaV0gfHwgdGVtcEJvYXJkW2ldLmxlbmd0aCAhPT0gOSkgew0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtpXSA9IEFycmF5KDkpLmZpbGwobnVsbCk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCg0KICAgICAgICBjb25zb2xlLmxvZygnVG90YWwgbW92ZXM6Jywgbm90YXRpb24ubGVuZ3RoKTsNCiAgICAgICAgbm90YXRpb24uZm9yRWFjaChtb3ZlTm90YXRpb24gPT4gew0KDQoNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gUGFyc2UgdGhlIG1vdmUgbm90YXRpb24gLSBrZWVwIGxhc3QgZ3JvdXAgb3B0aW9uYWwNCiAgICAgICAgICAgIGNvbnN0IHJlZ2V4ID0gLyhb5YmN5ZCOXSk/KFvlsIbluIXlo6vku5XosaHnm7jpqazovabngq7lhbXljZJdKShb5LiA5LqM5LiJ5Zub5LqU5YWt5LiD5YWr5LmdMTIzNDU2Nzg5XSkoW+i/m+mAgOW5s10pKFvkuIDkuozkuInlm5vkupTlha3kuIPlhavkuZ0xMjM0NTY3ODldKT8vOw0KICAgICAgICAgICAgY29uc3QgbWF0Y2ggPSBtb3ZlTm90YXRpb24ubWF0Y2gocmVnZXgpOw0KDQogICAgICAgICAgICBpZiAoIW1hdGNoKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBtb3ZlIG5vdGF0aW9uOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCBbLCBmcm9udEJhY2tNYXJrZXIsIHBpZWNlQ2hhciwgZnJvbUNvbE5vdGF0aW9uLCBkaXJlY3Rpb24sIHRvQ29sT3JTdGVwTm90YXRpb25dID0gbWF0Y2g7DQogICAgICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZU1hcFtwaWVjZUNoYXJdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBHZXQgY29sdW1uIG1hcHBpbmcgYmFzZWQgb24gY3VycmVudCBjb2xvciAoYmxhY2sgc2VlcyBjb2x1bW5zIG1pcnJvcmVkKQ0KICAgICAgICAgICAgbGV0IGZyb21Db2wgPSBjb2xNYXBbZnJvbUNvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sgKGZyb20gYmxhY2sncyBwZXJzcGVjdGl2ZSkNCiAgICAgICAgICAgICAgICBmcm9tQ29sID0gOCAtIGZyb21Db2w7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEZpbmQgdGhlIGN1cnJlbnQgcG9zaXRpb24gb2YgdGhlIHBpZWNlDQogICAgICAgICAgICBjb25zdCBmcm9tUG9zID0gZmluZFBpZWNlUG9zaXRpb24ocGllY2VUeXBlLCBjdXJyZW50Q29sb3IsIGZyb21Db2wsIGRpcmVjdGlvbiwgZnJvbnRCYWNrTWFya2VyKTsNCg0KICAgICAgICAgICAgaWYgKCFmcm9tUG9zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignQ291bGQgbm90IGZpbmQgcGllY2UgcG9zaXRpb24gZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGxldCB0b1BvczsNCg0KICAgICAgICAgICAgaWYgKGRpcmVjdGlvbiA9PT0gJ+W5sycpIHsNCiAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIG1vdmVtZW50DQogICAgICAgICAgICAgICAgbGV0IHRvQ29sID0gY29sTWFwW3RvQ29sT3JTdGVwTm90YXRpb25dOw0KICAgICAgICAgICAgICAgIGlmICh0b0NvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbjonLCB0b0NvbE9yU3RlcE5vdGF0aW9uLCAnZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sgd2hlbiBtb3ZpbmcgaG9yaXpvbnRhbGx5DQogICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICB0b0NvbCA9IDggLSB0b0NvbDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgdG9Qb3MgPSB7IHI6IGZyb21Qb3MuciwgYzogdG9Db2wgfTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8gVmVydGljYWwgb3IgZGlhZ29uYWwgbW92ZW1lbnQNCiAgICAgICAgICAgICAgICBjb25zdCBzdGVwcyA9IGNoaW5lc2VOdW1iZXJNYXBbdG9Db2xPclN0ZXBOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoc3RlcHMgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHN0ZXAgY291bnQ6JywgdG9Db2xPclN0ZXBOb3RhdGlvbiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICB9DQoNCiAgICAgICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnaG9yc2UnKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEhvcnNlIG1vdmVzIGluIEwtc2hhcGUNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEhvcnNlTW92ZXMoZnJvbVBvcyk7DQogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247DQogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgaG9yc2U6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjaw0KICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdlbGVwaGFudCcpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gRWxlcGhhbnQgbW92ZXMgZGlhZ29uYWxseSAyIHN0ZXBzDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRFbGVwaGFudE1vdmVzKGZyb21Qb3MsIGN1cnJlbnRDb2xvcik7DQogICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIHRhcmdldCBjb2x1bW4gZnJvbSBub3RhdGlvbg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2xOb3RhdGlvbiA9IHRvQ29sT3JTdGVwTm90YXRpb247DQogICAgICAgICAgICAgICAgICAgIGxldCB0YXJnZXRDb2wgPSBjb2xNYXBbdGFyZ2V0Q29sTm90YXRpb25dOw0KICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgdGFyZ2V0IGNvbHVtbiBub3RhdGlvbiBmb3IgZWxlcGhhbnQ6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjaw0KICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdhZHZpc29yJykgew0KICAgICAgICAgICAgICAgICAgICAvLyBBZHZpc29yIG1vdmVzIGRpYWdvbmFsbHkgMSBzdGVwDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHBvc3NpYmxlTW92ZXMgPSBnZXRBZHZpc29yTW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsNCiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvbE5vdGF0aW9uID0gdG9Db2xPclN0ZXBOb3RhdGlvbjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uIGZvciBhZHZpc29yOicsIHRhcmdldENvbE5vdGF0aW9uLCAnaW4gbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBNaXJyb3IgdGhlIGNvbHVtbiBmb3IgYmxhY2sNCiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0Q29sID0gOCAtIHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCB0aGUgbW92ZSB0aGF0IG1hdGNoZXMgYm90aCBkaXJlY3Rpb24gYW5kIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSBwb3NzaWJsZU1vdmVzLmZpbmQobW92ZSA9PiB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBkaXJlY3Rpb24gKHJvdykNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/m+aYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvInvvIzpgIDmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uTWF0Y2ggPSBkaXJlY3Rpb24gPT09ICfov5snID8gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPiBmcm9tUG9zLnIgOiBtb3ZlLnIgPCBmcm9tUG9zLnIpIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA8IGZyb21Qb3MuciA6IG1vdmUuciA+IGZyb21Qb3Mucik7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBjb2x1bW4NCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbHVtbk1hdGNoID0gbW92ZS5jID09PSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGlyZWN0aW9uTWF0Y2ggJiYgY29sdW1uTWF0Y2g7DQogICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIFN0cmFpZ2h0IGxpbmUgbW92ZW1lbnQgKGNoYXJpb3QsIGNhbm5vbiwgc29sZGllcikNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RlcCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyAoY3VycmVudENvbG9yID09PSAncmVkJyA/IDEgOiAtMSkgKiBzdGVwcyA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IC0xIDogMSkgKiBzdGVwczsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3UiA9IGZyb21Qb3MuciArIHN0ZXA7DQogICAgICAgICAgICAgICAgICAgIGlmIChuZXdSIDwgMCB8fCBuZXdSID49IDEwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHJvdyBwb3NpdGlvbiBhZnRlciBtb3ZlOicsIG5ld1IsICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0geyByOiBuZXdSLCBjOiBmcm9tUG9zLmMgfTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGlmICghdG9Qb3MpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZGV0ZXJtaW5lIHRhcmdldCBwb3NpdGlvbiBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gQWRkIHRoZSBtb3ZlIHRvIHRoZSBsaXN0DQogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgZnJvbTogeyByOiBmcm9tUG9zLnIsIGM6IGZyb21Qb3MuYyB9LCB0bzogeyByOiB0b1Bvcy5yLCBjOiB0b1Bvcy5jIH0gfSk7DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlJ3MgYSBjYXB0dXJlZCBwaWVjZQ0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRQaWVjZSA9IHRlbXBCb2FyZFt0b1Bvcy5yXVt0b1Bvcy5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gSWYgdGhlcmUncyBhIGNhcHR1cmVkIHBpZWNlLCByZW1vdmUgaXQgZnJvbSBwaWVjZVBvc2l0aW9ucw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGAke2NhcHR1cmVkUGllY2UuY29sb3J9LSR7Y2FwdHVyZWRQaWVjZS50eXBlfWA7DQogICAgICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGNhcHR1cmVkUG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOWwhi/luIXkuI3kvJrooqvlkIPmjonvvIzmiYDku6Xlj6rlpITnkIblhbbku5bmo4vlrZANCiAgICAgICAgICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAvLyBSZW1vdmUgdGhlIGNhcHR1cmVkIHBvc2l0aW9uIGZyb20gdGhlIGFycmF5DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjYXB0dXJlZFBvc2l0aW9ucykpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB1cGRhdGVkUG9zaXRpb25zID0gY2FwdHVyZWRQb3NpdGlvbnMuZmlsdGVyKHBvcyA9PiANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zICYmIChwb3MuciAhPT0gdG9Qb3MuciB8fCBwb3MuYyAhPT0gdG9Qb3MuYykNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XSA9IHVwZGF0ZWRQb3NpdGlvbnM7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVmVyaWZ5IHJlbW92YWwgd2FzIHN1Y2Nlc3NmdWwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGlsbEV4aXN0cyA9IHVwZGF0ZWRQb3NpdGlvbnMuc29tZShwb3MgPT4gDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiBwb3MuciA9PT0gdG9Qb3MuciAmJiBwb3MuYyA9PT0gdG9Qb3MuYw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHN0aWxsRXhpc3RzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogQ2FwdHVyZWQgcGllY2Ugc3RpbGwgZXhpc3RzIGluIHBpZWNlUG9zaXRpb25zIScpOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCfinIUgU1VDQ0VTUzogQ2FwdHVyZWQgcGllY2UgcmVtb3ZlZCBmcm9tIHBpZWNlUG9zaXRpb25zJyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IFVuZXhwZWN0ZWQgbm9uLWFycmF5IHBvc2l0aW9ucyBmb3IgcGllY2U6JywgY2FwdHVyZWRLZXkpOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBObyBwb3NpdGlvbnMgZm91bmQgZm9yIGNhcHR1cmVkIHBpZWNlOicsIGNhcHR1cmVkS2V5KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFZlcmlmeSB0aGUgY2FwdHVyZWQgcGllY2UgaGFzIGJlZW4gcmVtb3ZlZA0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkUGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZEtleSA9IGAke2NhcHR1cmVkUGllY2UuY29sb3J9LSR7Y2FwdHVyZWRQaWVjZS50eXBlfWA7DQogICAgICAgICAgICAgICAgY29uc3QgZmluYWxQb3NpdGlvbnMgPSBwaWVjZVBvc2l0aW9uc1tjYXB0dXJlZEtleV07DQogICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmluYWxQb3NpdGlvbnMpKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0aWxsRXhpc3RzID0gZmluYWxQb3NpdGlvbnMuc29tZShwb3MgPT4gDQogICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgcG9zLnIgPT09IHRvUG9zLnIgJiYgcG9zLmMgPT09IHRvUG9zLmMNCiAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHN0aWxsRXhpc3RzKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFUlJPUjogQ2FwdHVyZWQgcGllY2Ugc3RpbGwgZXhpc3RzIGluIHBpZWNlUG9zaXRpb25zOicsIGNhcHR1cmVkUGllY2UsICdhdCcsIHRvUG9zKTsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTVUNDRVNTOiBDYXB0dXJlZCBwaWVjZSByZW1vdmVkIGZyb20gcGllY2VQb3NpdGlvbnMnKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gTWFrZSB0aGUgbW92ZSBvbiB0aGUgdGVtcG9yYXJ5IGJvYXJkIGZpcnN0IGJlZm9yZSB1cGRhdGluZyBwaWVjZSBwb3NpdGlvbnMNCiAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKGZyb21Qb3MuciwgZnJvbVBvcy5jKSAmJiBpc1ZhbGlkUG9zKHRvUG9zLnIsIHRvUG9zLmMpICYmIA0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtmcm9tUG9zLnJdICYmIHRlbXBCb2FyZFt0b1Bvcy5yXSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gdGVtcEJvYXJkW2Zyb21Qb3Mucl1bZnJvbVBvcy5jXTsNCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbdG9Qb3Mucl1bdG9Qb3MuY10gPSBwaWVjZTsNCiAgICAgICAgICAgICAgICB0ZW1wQm9hcmRbZnJvbVBvcy5yXVtmcm9tUG9zLmNdID0gbnVsbDsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBJbnZhbGlkIHBvc2l0aW9ucyBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24sIGZyb21Qb3MsIHRvUG9zKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBwaWVjZSBwb3NpdGlvbiBpbiBwaWVjZVBvc2l0aW9ucw0KICAgICAgICAgICAgdXBkYXRlUGllY2VQb3NpdGlvbihwaWVjZVR5cGUsIGN1cnJlbnRDb2xvciwgZnJvbVBvcywgdG9Qb3MpOw0KICAgICAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBTd2l0Y2ggY29sb3IgZm9yIG5leHQgbW92ZQ0KICAgICAgICAgICAgY3VycmVudENvbG9yID0gY3VycmVudENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgfSk7DQoNCiAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgIH0NCn0NCg0KLy8gLS0tIENvbnN0YW50cyAtLS0NCg0KLy8gSW5pdGlhbGl6ZSBPcGVuaW5nIEJvb2sNCmNvbnN0IG9wZW5pbmdCb29rID0gbmV3IE9wZW5pbmdCb29rKDEyKTsNCg0KY29uc3QgaXNWYWxpZFBvcyA9IChyLCBjKSA9PiByID49IDAgJiYgciA8IFJPV1MgJiYgYyA+PSAwICYmIGMgPCBDT0xTOw0KDQovLyDmqKHlnZfnuqfkvKrlkIjms5XokL3ngrnvvIjpgb/lhY0gZ2V0UGllY2VNb3ZlcyDmr4/osIPnlKjmlrDlu7rpl63ljIXvvIkNCmNvbnN0IHB1c2hQc2V1ZG9EZXN0ID0gKGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCB0ciwgdGMpID0+IHsNCiAgaWYgKHRyIDwgMCB8fCB0ciA+PSBST1dTIHx8IHRjIDwgMCB8fCB0YyA+PSBDT0xTKSByZXR1cm47DQogIGNvbnN0IHRhcmdldCA9IGJvYXJkW3RyXVt0Y107DQogIGlmICghdGFyZ2V0IHx8IHRhcmdldC5jb2xvciAhPT0gcGllY2VDb2xvcikgew0KICAgIG1vdmVzLnB1c2goeyByOiB0ciwgYzogdGMgfSk7DQogIH0gZWxzZSBpZiAoYWxsaWVzT3V0ICYmIHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICBhbGxpZXNPdXQucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgfQ0KfTsNCg0KLy8gYWxsaWVzT3V0OiDlj6/pgInvvIzmlLbpm4blj6/kv53miqTnmoTlt7HmlrnokL3ngrnvvIjkuI3lkKvlsIbluIXvvInvvIzkvpvlhbPns7vorqHnrpflpI3nlKjvvIzpgb/lhY3kuozmrKHlsITnur8NCmNvbnN0IGdldFBpZWNlTW92ZXMgPSAoYm9hcmQsIHBvcywgcGllY2UsIGFsbGllc091dCA9IG51bGwpID0+IHsNCiAgY29uc3QgbW92ZXMgPSBbXTsNCiAgY29uc3QgeyByLCBjIH0gPSBwb3M7DQogIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICBjb25zdCBwaWVjZUNvbG9yID0gcGllY2UuY29sb3I7DQogIGNvbnN0IGNvbG9ySWR4ID0gaXNSZWQgPyAwIDogMTsNCiAgY29uc3QgZnJvbVNxID0gciAqIDkgKyBjOw0KDQogIHN3aXRjaCAocGllY2UudHlwZSkgew0KICAgIGNhc2UgJ2dlbmVyYWwnOiB7DQogICAgICBjb25zdCBkZXN0cyA9IEdFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOw0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICAgIGNhc2UgJ2Fkdmlzb3InOiB7DQogICAgICBjb25zdCBkZXN0cyA9IEFEVklTT1JfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOw0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICAgIGNhc2UgJ2VsZXBoYW50Jzogew0KICAgICAgY29uc3QgZGVzdHMgPSBFTEVQSEFOVF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgIGlmIChib2FyZFtkLmJyXVtkLmJjXSA9PT0gbnVsbCkgew0KICAgICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7DQogICAgICAgIH0NCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBjYXNlICdob3JzZSc6IHsNCiAgICAgIGNvbnN0IGRlc3RzID0gSE9SU0VfREVTVFtmcm9tU3FdOw0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgIGlmIChib2FyZFtkLmJyXVtkLmJjXSA9PT0gbnVsbCkgew0KICAgICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7DQogICAgICAgIH0NCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBjYXNlICdjaGFyaW90JzoNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgbGV0IG5yID0gciArIGRyLCBuYyA9IGMgKyBkYzsNCiAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTKSB7DQogICAgICAgICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbbnJdW25jXTsNCiAgICAgICAgICBpZiAodGFyZ2V0ID09PSBudWxsKSB7DQogICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAodGFyZ2V0LmNvbG9yICE9PSBwaWVjZUNvbG9yKSBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgZWxzZSBpZiAoYWxsaWVzT3V0ICYmIHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIGFsbGllc091dC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgfQ0KICAgICAgICAgIG5yICs9IGRyOyBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnY2Fubm9uJzoNCiAgICAgIC8vIOedgOazleS7jeWPquWQq+aVjOaWuemalOaJk++8m+W3seaWuemalOaJk+S/neaKpOeUsSBmaWxsQ2Fubm9uUmVsYXRpb25zIOe7n+S4gOWkhOeQhg0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBsZXQgc2NyZWVuRm91bmQgPSBmYWxzZTsNCiAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTKSB7DQogICAgICAgICAgaWYgKCFzY3JlZW5Gb3VuZCkgew0KICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgIHNjcmVlbkZvdW5kID0gdHJ1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10gIT09IG51bGwpIHsNCiAgICAgICAgICAgICAgaWYgKGJvYXJkW25yXVtuY10uY29sb3IgIT09IHBpZWNlQ29sb3IpIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgIH0NCiAgICAgICAgICBuciArPSBkcjsgbmMgKz0gZGM7DQogICAgICAgIH0NCiAgICAgIH0NCiAgICAgIGJyZWFrOw0KICAgIGNhc2UgJ3NvbGRpZXInOiB7DQogICAgICBjb25zdCBkZXN0cyA9IFNPTERJRVJfREVTVFtjb2xvcklkeF1bZnJvbVNxXTsNCiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICBwdXNoUHNldWRvRGVzdChib2FyZCwgbW92ZXMsIGFsbGllc091dCwgcGllY2VDb2xvciwgZC5yLCBkLmMpOw0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICB9DQogIHJldHVybiBtb3ZlczsNCn07DQoNCmNvbnN0IGlzRmx5aW5nR2VuZXJhbCA9IChib2FyZCkgPT4gew0KICBjb25zdCByZWRHID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgJ3JlZCcpOw0KICBjb25zdCBibGFja0cgPSBnZXRHZW5lcmFsUG9zKGJvYXJkLCAnYmxhY2snKTsNCiAgaWYgKCFyZWRHIHx8ICFibGFja0cgfHwgcmVkRy5jICE9PSBibGFja0cuYykgcmV0dXJuIGZhbHNlOw0KICANCiAgLy8g56Gu5L+d5b6q546v5pa55ZCR5q2j56Gu77yM5LuO6L6D5bCP55qEcuWIsOi+g+Wkp+eahHINCiAgY29uc3Qgc3RhcnRSID0gTWF0aC5taW4oYmxhY2tHLnIsIHJlZEcucikgKyAxOw0KICBjb25zdCBlbmRSID0gTWF0aC5tYXgoYmxhY2tHLnIsIHJlZEcucikgLSAxOw0KICANCiAgZm9yIChsZXQgciA9IHN0YXJ0UjsgciA8PSBlbmRSOyByKyspIHsNCiAgICBpZiAoYm9hcmRbcl1bcmVkRy5jXSAhPT0gbnVsbCkgcmV0dXJuIGZhbHNlOw0KICB9DQogIHJldHVybiB0cnVlOw0KfTsNCg0KLy8g5pegIGJvYXJkSW5mbyDml7bnmoTlv6vpgJ/lsIblhpvmo4DmtYvvvJrlsIbkvY3nvJPlrZggKyDku47lsIbkvY3lm5vlkJHlsITnur/vvIjovaYv5bCGL+eCruWQiOW5tu+8iQ0KY29uc3QgaXNDaGVja1JhdyA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBjb25zdCBnZW5lcmFsUG9zID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgY29sb3IpOw0KICAgIGlmICghZ2VuZXJhbFBvcykgcmV0dXJuIHRydWU7DQoNCiAgICBjb25zdCBlbmVteUNvbG9yID0gY29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgIGNvbnN0IHsgcjogZ3IsIGM6IGdjIH0gPSBnZW5lcmFsUG9zOw0KDQogICAgLy8g55u057q/77ya56ys5LiA5a2Q5Li65pWM6L2mL+WwhuWImeWwhuWGm++8m+i2iui/h+eCruaetuWQjuesrOS6jOWtkOS4uuaVjOeCruWImeWwhuWGmw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgbGV0IG5yID0gZ3IgKyBkcjsNCiAgICAgICAgbGV0IG5jID0gZ2MgKyBkYzsNCiAgICAgICAgbGV0IHNlZW4gPSAwOw0KDQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHApIHsNCiAgICAgICAgICAgICAgICBzZWVuKys7DQogICAgICAgICAgICAgICAgaWYgKHNlZW4gPT09IDEpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgKHAudHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHAudHlwZSA9PT0gJ2dlbmVyYWwnKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdjYW5ub24nKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBuciArPSBkcjsNCiAgICAgICAgICAgIG5jICs9IGRjOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g6ams77ya5LuO5bCG5L2N5Y+N5o6o77yM6ams6IW/5Zyo6ams5LiA5L6n77yI5LiOIGdldFBpZWNlTW92ZXMgLyBIT1JTRV9ESVJTIOS4gOiHtO+8iQ0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgSE9SU0VfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gSE9SU0VfRElSU1tpXTsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGQuZHI7DQogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkLmRjOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhuciwgbmMpKSB7DQogICAgICAgICAgICBjb25zdCBsZWdSID0gbnIgLSBkLmxlZ0RyOw0KICAgICAgICAgICAgY29uc3QgbGVnQyA9IG5jIC0gZC5sZWdEYzsNCiAgICAgICAgICAgIGlmIChib2FyZFtsZWdSXVtsZWdDXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnaG9yc2UnKSB7DQogICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOWjq++8iOS5neWuq+WGhe+8iQ0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgRElBR19ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gRElBR19ESVJTW2ldWzBdLCBkYyA9IERJQUdfRElSU1tpXVsxXTsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGRyOw0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYNCiAgICAgICAgICAgICgoY29sb3IgPT09ICdyZWQnICYmIG5yID49IDAgJiYgbnIgPD0gMikgfHwgKGNvbG9yID09PSAnYmxhY2snICYmIG5yID49IDcgJiYgbnIgPD0gOSkpICYmDQogICAgICAgICAgICBuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdhZHZpc29yJykgew0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5YW177ya5q2j5YmN5pa55aeL57uI5Y+v5pS777yb5bem5Y+z5LuF6L+H5rKz5YW1DQogICAgY29uc3QgZW5lbXlGb3J3YXJkID0gZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyAxIDogLTE7DQogICAgY29uc3QgZm9yd2FyZEZyb21SID0gZ3IgLSBlbmVteUZvcndhcmQ7DQogICAgaWYgKGlzVmFsaWRQb3MoZm9yd2FyZEZyb21SLCBnYykpIHsNCiAgICAgICAgY29uc3QgcCA9IGJvYXJkW2ZvcndhcmRGcm9tUl1bZ2NdOw0KICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7DQogICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBmb3IgKGNvbnN0IGRjIG9mIFsxLCAtMV0pIHsNCiAgICAgICAgY29uc3QgbmMgPSBnYyArIGRjOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhnciwgbmMpKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbZ3JdW25jXTsNCiAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnc29sZGllcicpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBlbmVteUNvbG9yID09PSAncmVkJyA/IGdyID49IDUgOiBnciA8PSA0Ow0KICAgICAgICAgICAgICAgIGlmIChjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgcmV0dXJuIGZhbHNlOw0KfTsNCg0KY29uc3QgaXNDaGVjayA9IChib2FyZCwgY29sb3IsIHBpZWNlc0luZm8gPSBudWxsLCBib2FyZEluZm8gPSBudWxsKSA9PiB7DQogICAgLy8g5LyY5YWI5L2/55So6aKE6K6h566X55qE5bCG5Yab54q25oCBDQogICAgaWYgKGJvYXJkSW5mbykgew0KICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZElzSW5DaGVjayA6IGJvYXJkSW5mby5ibGFja0lzSW5DaGVjazsNCiAgICB9DQoNCiAgICAvLyDlpoLmnpzmnIlwaWVjZXNJbmZv77yM5Lmf5Y+v5Lul5LuO5Lit6I635Y+W5bCG5Yab54q25oCBDQogICAgaWYgKHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7DQogICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyBwaWVjZXNJbmZvWzBdLnJlZElzSW5DaGVjayA6IHBpZWNlc0luZm9bMF0uYmxhY2tJc0luQ2hlY2s7DQogICAgfQ0KDQogICAgcmV0dXJuIGlzQ2hlY2tSYXcoYm9hcmQsIGNvbG9yKTsNCn07DQoNCi8vIOWQiOazleedgOazle+8muS8quWQiOazlSArIOS4jemAgeWwhi/kuI3po57lsIbvvIhtYWtlL3VubWFrZe+8iQ0KY29uc3QgZ2V0VmFsaWRNb3ZlcyA9IChib2FyZCwgcG9zKSA9PiB7DQogIGNvbnN0IHBpZWNlID0gYm9hcmRbcG9zLnJdW3Bvcy5jXTsNCiAgaWYgKCFwaWVjZSkgcmV0dXJuIFtdOw0KICBjb25zdCBwc2V1ZG9Nb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHBvcywgcGllY2UpOw0KICByZXR1cm4gZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgcG9zLCBwaWVjZSwgcHNldWRvTW92ZXMpOw0KfTsNCg0KY29uc3QgaXNWYWxpZFBsYWNlbWVudCA9ICh0eXBlLCBjb2xvciwgciwgYykgPT4gew0KICAgIGNvbnN0IGlzUmVkID0gY29sb3IgPT09ICdyZWQnOw0KICAgIHN3aXRjaCh0eXBlKSB7DQogICAgICAgIGNhc2UgJ2dlbmVyYWwnOg0KICAgICAgICAgICAgLy8g5biF5bCG5Y+q6IO95Zyo5Lmd5a6r5Lit5b+D55qE5LiA5p2h57q/5LiKDQogICAgICAgICAgICBpZiAoYyA8IDMgfHwgYyA+IDUpIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgIGlmIChpc1JlZCkgcmV0dXJuIHIgPj0gMCAmJiByIDw9IDI7DQogICAgICAgICAgICBlbHNlIHJldHVybiByID49IDcgJiYgciA8PSA5Ow0KICAgICAgICBjYXNlICdhZHZpc29yJzoNCiAgICAgICAgICAgIC8vIOWjq+WPquiDveWcqOS5neWuq+eahDXkuKrngrnkuYvkuIANCiAgICAgICAgICAgIGNvbnN0IHZhbGlkQWR2aXNvclBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IFtbMCwgM10sIFswLCA1XSwgWzEsIDRdLCBbMiwgM10sIFsyLCA1XV0sDQogICAgICAgICAgICAgICAgYmxhY2s6IFtbNywgM10sIFs3LCA1XSwgWzgsIDRdLCBbOSwgM10sIFs5LCA1XV0NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICByZXR1cm4gdmFsaWRBZHZpc29yUG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXS5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgY2FzZSAnZWxlcGhhbnQnOg0KICAgICAgICAgICAgLy8g55u45Y+q6IO95Zyo5bex5pa55Y2K5Zy655qEN+S4queCueS5i+S4gA0KICAgICAgICAgICAgY29uc3QgdmFsaWRFbGVwaGFudFBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IFtbMCwgMl0sIFswLCA2XSwgWzIsIDBdLCBbMiwgNF0sIFsyLCA4XSwgWzQsIDJdLCBbNCwgNl1dLA0KICAgICAgICAgICAgICAgIGJsYWNrOiBbWzUsIDJdLCBbNSwgNl0sIFs3LCAwXSwgWzcsIDRdLCBbNywgOF0sIFs5LCAyXSwgWzksIDZdXQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIHJldHVybiB2YWxpZEVsZXBoYW50UG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXS5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgY2FzZSAnc29sZGllcic6DQogICAgICAgICAgICAvLyDlhbXnmoTkvY3nva7pmZDliLbvvJrov4fmsrPliY3lj6rog73lnKjlgbbmlbDliJfvvIzov4fmsrPlkI7lj6/ku6XlnKjku7vkvZXliJcNCiAgICAgICAgICAgIC8vIOe6ouaWueWFtei/h+ays+adoeS7tuaYr3IgPj0gNe+8jOm7keaWueWFtei/h+ays+adoeS7tuaYr3IgPD0gNA0KICAgICAgICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gaXNSZWQgPyByID49IDUgOiByIDw9IDQ7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgICAgICAgICAgLy8g6L+H5rKz5YmN5Y+q6IO95Zyo5YG25pWw5YiX77yIYz0wLDIsNCw2LDjvvIkNCiAgICAgICAgICAgICAgICBpZiAoIVswLCAyLCA0LCA2LCA4XS5pbmNsdWRlcyhjKSkgcmV0dXJuIGZhbHNlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDlhbXnmoTkvY3nva7pmZDliLbvvJrov4fmsrPliY3lj6rog73lnKjlhbXkvY3lkozlhbXkvY3liY3mlrnvvIzov4fmsrPlkI7mlYzmlrnljYrlnLrpg73lkIjms5UNCiAgICAgICAgICAgIGNvbnN0IHZhbGlkU29sZGllclBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IHsNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa55Yid5aeL5YW15L2N77yacj0zLCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBpbml0aWFsOiBbWzMsIDBdLCBbMywgMl0sIFszLCA0XSwgWzMsIDZdLCBbMywgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnlhbXkvY3liY3mlrnvvJpyPTQsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGZvcndhcmQ6IFtbNCwgMF0sIFs0LCAyXSwgWzQsIDRdLCBbNCwgNl0sIFs0LCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/h+ays+e6v++8mnI+PTUNCiAgICAgICAgICAgICAgICAgICAgY3Jvc3NlZFJpdmVyOiByID49IDUNCiAgICAgICAgICAgICAgICB9LA0KICAgICAgICAgICAgICAgIGJsYWNrOiB7DQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueWIneWni+WFteS9je+8mnI9NiwgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbDogW1s2LCAwXSwgWzYsIDJdLCBbNiwgNF0sIFs2LCA2XSwgWzYsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55YW15L2N5YmN5pa577yacj01LCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBmb3J3YXJkOiBbWzUsIDBdLCBbNSwgMl0sIFs1LCA0XSwgWzUsIDZdLCBbNSwgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov4fmsrPnur/vvJpyPD00DQogICAgICAgICAgICAgICAgICAgIGNyb3NzZWRSaXZlcjogciA8PSA0DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgY29uc3Qgc29sZGllckluZm8gPSB2YWxpZFNvbGRpZXJQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddOw0KICAgICAgICAgICAgY29uc3QgaXNJbml0aWFsUG9zID0gc29sZGllckluZm8uaW5pdGlhbC5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgICAgIGNvbnN0IGlzRm9yd2FyZFBvcyA9IHNvbGRpZXJJbmZvLmZvcndhcmQuc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChzb2xkaWVySW5mby5jcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICAvLyDov4fmsrPlkI7mlYzmlrnljYrlnLrpg73lkIjms5UNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g6L+H5rKz5YmN5Y+q6IO95Zyo5YW15L2N5ZKM5YW15L2N5YmN5pa5DQogICAgICAgICAgICAgICAgcmV0dXJuIGlzSW5pdGlhbFBvcyB8fCBpc0ZvcndhcmRQb3M7DQogICAgICAgICAgICB9DQogICAgICAgIGRlZmF1bHQ6DQogICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICB9DQp9Ow0KDQpjb25zdCBjaGVja0dhbWVTdGF0ZSA9IChib2FyZCwgdHVybiwgcGllY2VzSW5mbyA9IG51bGwsIGJvYXJkSW5mbyA9IG51bGwpID0+IHsNCiAgICAvLyDkvJjlhYjkvb/nlKjpooTorqHnrpfnmoRnYW1lU3RhdGUNCiAgICBpZiAoYm9hcmRJbmZvICYmIGJvYXJkSW5mby5nYW1lU3RhdGUpIHsNCiAgICAgICAgcmV0dXJuIGJvYXJkSW5mby5nYW1lU3RhdGU7DQogICAgfQ0KICAgIA0KICAgIC8vIOayoeaciemihOiuoeeul+e7k+aenOaXtu+8jOaJp+ihjOWOn+Wni+iuoeeulw0KICAgIGxldCBoYXNNb3ZlcyA9IGZhbHNlOw0KICAgIGZvcihsZXQgcj0wOyByPFJPV1M7IHIrKykgew0KICAgICAgICBmb3IobGV0IGM9MDsgYzxDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgICAgICAgICBpZiAoZ2V0VmFsaWRNb3Zlcyhib2FyZCwge3IsY30pLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICAgICAgaGFzTW92ZXMgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKGhhc01vdmVzKSBicmVhazsNCiAgICB9DQoNCiAgICBpZiAoaGFzTW92ZXMpIHJldHVybiB7IHN0YXR1czogJ3BsYXlpbmcnIH07DQoNCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVjayhib2FyZCwgdHVybiwgcGllY2VzSW5mbywgYm9hcmRJbmZvKTsNCiAgICBjb25zdCBvcHBvbmVudCA9IHR1cm4gPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgIA0KICAgIGlmIChpbkNoZWNrKSB7DQogICAgICAgIHJldHVybiB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICB9IGVsc2Ugew0KICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfQ0KfTsNCg0KDQoNCmNvbnN0IGdldEdhbWVQaGFzZSA9ICgpID0+IHsNCiAgcmV0dXJuICdvcGVuaW5nJzsNCn07DQoNCi8vIOWunuS+i+WMllpvYnJpc3RIYXNoZXINCmNvbnN0IHpvYnJpc3RIYXNoZXIgPSBuZXcgWm9icmlzdEhhc2hlcigpOw0KDQovLyDnva7mjaLooajlrp7njrDvvIjlrrnph4/nuqYgMl4yMO+8jOmBv+WFjSBNYXAg6L+H5aSn5ouW5oWiIEdD77yJDQpjbGFzcyBUcmFuc3Bvc2l0aW9uVGFibGUgew0KICAgIGNvbnN0cnVjdG9yKHNpemUgPSBNYXRoLnBvdygyLCAyMCkpIHsNCiAgICAgICAgdGhpcy50YWJsZSA9IG5ldyBNYXAoKTsNCiAgICAgICAgdGhpcy5zaXplID0gc2l6ZTsNCiAgICAgICAgdGhpcy5oYXNoZXIgPSB6b2JyaXN0SGFzaGVyOw0KICAgICAgICAvLyDnu5/orqHkv6Hmga8NCiAgICAgICAgdGhpcy5zdGF0cyA9IHsNCiAgICAgICAgICAgIGhpdHM6IDAsDQogICAgICAgICAgICBtaXNzZXM6IDAsDQogICAgICAgICAgICBleGFjdEhpdHM6IDAsDQogICAgICAgICAgICBsb3dlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHVwcGVyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgc3RvcmVzOiAwLA0KICAgICAgICAgICAgbHJ1RXZpY3Rpb25zOiAwLA0KICAgICAgICAgICAgY2xlYXJzOiAwDQogICAgICAgIH07DQogICAgfQ0KICAgIA0KICAgIHN0b3JlKGtleSwgZGVwdGgsIHZhbHVlLCBmbGFnLCBiZXN0TW92ZSA9IG51bGwsIG1vdmVTZXF1ZW5jZSA9IG51bGwpIHsNCiAgICAgICAgaWYgKHRoaXMudGFibGUuc2l6ZSA+PSB0aGlzLnNpemUpIHsNCiAgICAgICAgICAgIC8vIOeugOWNleeahExSVeetlueVpe+8muenu+mZpOesrOS4gOS4quWFg+e0oA0KICAgICAgICAgICAgY29uc3QgZmlyc3RLZXkgPSB0aGlzLnRhYmxlLmtleXMoKS5uZXh0KCkudmFsdWU7DQogICAgICAgICAgICB0aGlzLnRhYmxlLmRlbGV0ZShmaXJzdEtleSk7DQogICAgICAgICAgICB0aGlzLnN0YXRzLmxydUV2aWN0aW9ucysrOw0KICAgICAgICB9DQogICAgICAgIHRoaXMudGFibGUuc2V0KGtleSwgeyBkZXB0aCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlLCBtb3ZlU2VxdWVuY2UgfSk7DQogICAgICAgIHRoaXMuc3RhdHMuc3RvcmVzKys7DQogICAgfQ0KICAgIA0KICAgIHJldHJpZXZlKGtleSkgew0KICAgICAgICBjb25zdCBlbnRyeSA9IHRoaXMudGFibGUuZ2V0KGtleSkgfHwgbnVsbDsNCiAgICAgICAgaWYgKGVudHJ5KSB7DQogICAgICAgICAgICB0aGlzLnN0YXRzLmhpdHMrKzsNCiAgICAgICAgICAgIC8vIOe7n+iuoeS4jeWQjOexu+Wei+eahOWRveS4rQ0KICAgICAgICAgICAgc3dpdGNoIChlbnRyeS5mbGFnKSB7DQogICAgICAgICAgICAgICAgY2FzZSAnZXhhY3QnOg0KICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLmV4YWN0SGl0cysrOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICBjYXNlICdsb3dlcmJvdW5kJzoNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0cy5sb3dlcmJvdW5kSGl0cysrOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICBjYXNlICd1cHBlcmJvdW5kJzoNCiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0cy51cHBlcmJvdW5kSGl0cysrOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIHRoaXMuc3RhdHMubWlzc2VzKys7DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIGVudHJ5Ow0KICAgIH0NCiAgICANCiAgICBjbGVhcigpIHsNCiAgICAgICAgdGhpcy50YWJsZS5jbGVhcigpOw0KICAgICAgICB0aGlzLnN0YXRzLmNsZWFycysrOw0KICAgIH0NCiAgICANCiAgICAvLyDojrflj5bnu5/orqHkv6Hmga/lubborqHnrpflkb3kuK3njocNCiAgICBnZXRTdGF0cygpIHsNCiAgICAgICAgY29uc3QgdG90YWxBY2Nlc3NlcyA9IHRoaXMuc3RhdHMuaGl0cyArIHRoaXMuc3RhdHMubWlzc2VzOw0KICAgICAgICBjb25zdCBoaXRSYXRlID0gdG90YWxBY2Nlc3NlcyA+IDAgPyAodGhpcy5zdGF0cy5oaXRzIC8gdG90YWxBY2Nlc3NlcyAqIDEwMCkudG9GaXhlZCgyKSA6IDA7DQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICAuLi50aGlzLnN0YXRzLA0KICAgICAgICAgICAgdG90YWxBY2Nlc3NlcywNCiAgICAgICAgICAgIGhpdFJhdGUsDQogICAgICAgICAgICBjdXJyZW50U2l6ZTogdGhpcy50YWJsZS5zaXplLA0KICAgICAgICAgICAgbWF4U2l6ZTogdGhpcy5zaXplLA0KICAgICAgICAgICAgZmlsbFBlcmNlbnRhZ2U6ICh0aGlzLnRhYmxlLnNpemUgLyB0aGlzLnNpemUgKiAxMDApLnRvRml4ZWQoMikNCiAgICAgICAgfTsNCiAgICB9DQogICAgDQogICAgLy8g6YeN572u57uf6K6h5L+h5oGvDQogICAgcmVzZXRTdGF0cygpIHsNCiAgICAgICAgdGhpcy5zdGF0cyA9IHsNCiAgICAgICAgICAgIGhpdHM6IDAsDQogICAgICAgICAgICBtaXNzZXM6IDAsDQogICAgICAgICAgICBleGFjdEhpdHM6IDAsDQogICAgICAgICAgICBsb3dlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHVwcGVyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgc3RvcmVzOiAwLA0KICAgICAgICAgICAgbHJ1RXZpY3Rpb25zOiAwLA0KICAgICAgICAgICAgY2xlYXJzOiAwDQogICAgICAgIH07DQogICAgfQ0KfQ0KDQovLyDmgKfog73nu5/orqENCmxldCBwZXJmU3RhdHMgPSB7DQogICAgZXZhbHVhdGVCb2FyZENvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwNCiAgICBwcmVwYXJlU2VhcmNoSW5mb0NvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwNCiAgICBjYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudDogeyByZWQ6IDAsIGJsYWNrOiAwIH0sDQogICAgYWxwaGFCZXRhQ2FsbHM6IDAsICAvLyDmgLvosIPnlKjmrKHmlbANCiAgICBub2Rlc1NlYXJjaGVkOiB7fSwgLy8g5oyJ5rex5bqm57uf6K6h5pCc57Si55qE6IqC54K55pWwDQogICAgbW92ZXNHZW5lcmF0ZWQ6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHnlJ/miJDnmoTotbDms5XmlbANCiAgICBjdXRvZmZzOiB7fSwgLy8g5oyJ5rex5bqm57uf6K6h5Ymq5p6d5qyh5pWwDQogICAgLy8g5ZCI5rOV5oCn6Lev5b6E77ya5Lyq5ZCI5rOV55Sf5oiQ6YeP44CB6K+V6LWw5ZCI5rOV5oCn5qOA5rWL44CB6Z2e5rOV6Lez6L+H44CB5a6e6ZmF6L+b5YWl5pCc57Si55qE5ZCI5rOV552ADQogICAgcHNldWRvTW92ZXNHZW5lcmF0ZWQ6IDAsDQogICAgbGVnYWxpdHlDaGVja3M6IDAsDQogICAgaWxsZWdhbE1vdmVzU2tpcHBlZDogMCwNCiAgICBsZWdhbE1vdmVzU2VhcmNoZWQ6IDAsDQogICAgLy8gWm9icmlzdO+8muWFqOebmOmHjeeul+asoeaVsCAvIOWinumHj+abtOaWsOasoeaVsCAvIOagoemqjOS4jeS4gOiHtO+8iOS7hSB2ZXJpZnkg5qih5byP77yJDQogICAgZnVsbEhhc2hDb3VudDogMCwNCiAgICBpbmNyZW1lbnRhbEhhc2hVcGRhdGVzOiAwLA0KICAgIGhhc2hNaXNtYXRjaGVzOiAwLAogICAgZmFzdExlYWZFdmFsQ291bnQ6IDAsCiAgICBmYXN0TGVhZkV2YWxNczogMCwKICAgIGV2YWx1YXRlQm9hcmRNczogMCwKICAgIHByZXBhcmVTZWFyY2hJbmZvTXM6IDAsDQogICAgc3RhcnRUaW1lOiBEYXRlLm5vdygpDQp9Ow0KDQovLyDph43nva7nu5/orqHvvIjmr4/mrKHmkJzntKLlvIDlp4vml7bosIPnlKjvvIkNCmNvbnN0IHJlc2V0UGVyZlN0YXRzID0gKCkgPT4gewogICAgYWN0aXZlU2VhcmNoUGllY2VTdGF0ZSA9IG51bGw7CiAgICBwZXJmU3RhdHMuZXZhbHVhdGVCb2FyZENvdW50ID0geyByZWQ6IDAsIGJsYWNrOiAwIH07DQogICAgcGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsNCiAgICBwZXJmU3RhdHMuY2FsY3VsYXRlVGhyZWF0VmFsdWVzQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsNCiAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMgPSAwOw0KICAgIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkID0ge307DQogICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkID0ge307DQogICAgcGVyZlN0YXRzLmN1dG9mZnMgPSB7fTsNCiAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgPSAwOw0KICAgIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrcyA9IDA7DQogICAgcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQgPSAwOw0KICAgIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQgPSAwOw0KICAgIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50ID0gMDsNCiAgICBwZXJmU3RhdHMuaW5jcmVtZW50YWxIYXNoVXBkYXRlcyA9IDA7DQogICAgcGVyZlN0YXRzLmhhc2hNaXNtYXRjaGVzID0gMDsKICAgIHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxDb3VudCA9IDA7CiAgICBwZXJmU3RhdHMuZmFzdExlYWZFdmFsTXMgPSAwOwogICAgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcyA9IDA7CiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcyA9IDA7DQogICAgcGVyZlN0YXRzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7DQp9Ow0KDQpjb25zdCBzbmFwc2hvdFBlcmZTdGF0cyA9ICgpID0+IHsNCiAgICBjb25zdCBlbGFwc2VkID0gRGF0ZS5ub3coKSAtIHBlcmZTdGF0cy5zdGFydFRpbWU7DQogICAgY29uc3QgdHRTdGF0cyA9IHRyYW5zcG9zaXRpb25UYWJsZS5nZXRTdGF0cygpOw0KICAgIGNvbnN0IGRlcHRocyA9IE9iamVjdC5rZXlzKHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkKS5zb3J0KChhLCBiKSA9PiBOdW1iZXIoYSkgLSBOdW1iZXIoYikpOw0KICAgIGNvbnN0IGJ5RGVwdGggPSB7fTsNCiAgICBmb3IgKGNvbnN0IGQgb2YgZGVwdGhzKSB7DQogICAgICAgIGJ5RGVwdGhbZF0gPSB7DQogICAgICAgICAgICBub2RlczogcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0gfHwgMCwNCiAgICAgICAgICAgIG1vdmVzOiBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gfHwgMCwNCiAgICAgICAgICAgIGN1dG9mZnM6IHBlcmZTdGF0cy5jdXRvZmZzW2RdIHx8IDANCiAgICAgICAgfTsNCiAgICB9DQogICAgcmV0dXJuIHsNCiAgICAgICAgZWxhcHNlZE1zOiBlbGFwc2VkLA0KICAgICAgICBkZWZlckxlZ2FsaXR5OiBTRUFSQ0hfREVGRVJfTEVHQUxJVFksDQogICAgICAgIGluY3JlbWVudGFsWm9icmlzdDogU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QsDQogICAgICAgIGxlYWZBdHRhY2tCaXRzOiBTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUUywKICAgICAgICByZWxhdGlvbk1hc2tzOiBTRUFSQ0hfUkVMQVRJT05fTUFTS1MsCiAgICAgICAgcGllY2VMaXN0OiBTRUFSQ0hfUElFQ0VfTElTVCwKICAgICAgICBldmFsdWF0ZUJvYXJkOiB7IC4uLnBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgfSwNCiAgICAgICAgcHJlcGFyZVNlYXJjaEluZm86IHsgLi4ucGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnQgfSwNCiAgICAgICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzOiB7IC4uLnBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudCB9LA0KICAgICAgICBhbHBoYUJldGFDYWxsczogcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzLA0KICAgICAgICBwc2V1ZG9Nb3Zlc0dlbmVyYXRlZDogcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkLA0KICAgICAgICBsZWdhbGl0eUNoZWNrczogcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzLA0KICAgICAgICBpbGxlZ2FsTW92ZXNTa2lwcGVkOiBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCwNCiAgICAgICAgbGVnYWxNb3Zlc1NlYXJjaGVkOiBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkLA0KICAgICAgICBmdWxsSGFzaENvdW50OiBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCwNCiAgICAgICAgaW5jcmVtZW50YWxIYXNoVXBkYXRlczogcGVyZlN0YXRzLmluY3JlbWVudGFsSGFzaFVwZGF0ZXMsDQogICAgICAgIGhhc2hNaXNtYXRjaGVzOiBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMsCiAgICAgICAgZmFzdExlYWZFdmFsOiBTRUFSQ0hfRkFTVF9MRUFGX0VWQUwsCiAgICAgICAgZmFzdExlYWZFdmFsQ291bnQ6IHBlcmZTdGF0cy5mYXN0TGVhZkV2YWxDb3VudCwKICAgICAgICBmYXN0TGVhZkV2YWxNczogcGVyZlN0YXRzLmZhc3RMZWFmRXZhbE1zLAogICAgICAgIGV2YWx1YXRlQm9hcmRNczogcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcywKICAgICAgICBwcmVwYXJlU2VhcmNoSW5mb01zOiBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9NcywNCiAgICAgICAgdHQ6IHR0U3RhdHMsDQogICAgICAgIGJ5RGVwdGgNCiAgICB9Ow0KfTsNCg0KLy8g5omT5Y2w57uf6K6h5L+h5oGvDQpjb25zdCBsb2dQZXJmU3RhdHMgPSAoY3VycmVudFBsYXllcikgPT4gew0KICAgIGNvbnN0IHNuYXAgPSBzbmFwc2hvdFBlcmZTdGF0cygpOw0KICAgIGNvbnNvbGUubG9nKGDwn5OKIOaAp+iDvee7n+iuoSAoJHtjdXJyZW50UGxheWVyfSkgLSAke3NuYXAuZWxhcHNlZE1zfW1zOmApOw0KICAgIGNvbnNvbGUubG9nKGAgICBldmFsdWF0ZUJvYXJkOiByZWQ9JHtzbmFwLmV2YWx1YXRlQm9hcmQucmVkfSwgYmxhY2s9JHtzbmFwLmV2YWx1YXRlQm9hcmQuYmxhY2t9YCk7DQogICAgY29uc29sZS5sb2coYCAgIHByZXBhcmVTZWFyY2hJbmZvOiByZWQ9JHtzbmFwLnByZXBhcmVTZWFyY2hJbmZvLnJlZH0sIGJsYWNrPSR7c25hcC5wcmVwYXJlU2VhcmNoSW5mby5ibGFja31gKTsNCiAgICBjb25zb2xlLmxvZyhgICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzOiByZWQ9JHtzbmFwLmNhbGN1bGF0ZVRocmVhdFZhbHVlcy5yZWR9LCBibGFjaz0ke3NuYXAuY2FsY3VsYXRlVGhyZWF0VmFsdWVzLmJsYWNrfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBhbHBoYUJldGHosIPnlKjmrKHmlbA6ICR7c25hcC5hbHBoYUJldGFDYWxsc31gKTsNCiAgICBjb25zb2xlLmxvZyhgICAg5ZCI5rOV5oCnOiBwc2V1ZG89JHtzbmFwLnBzZXVkb01vdmVzR2VuZXJhdGVkfSwgY2hlY2tzPSR7c25hcC5sZWdhbGl0eUNoZWNrc30sIGlsbGVnYWxTa2lwPSR7c25hcC5pbGxlZ2FsTW92ZXNTa2lwcGVkfSwgbGVnYWxTZWFyY2hlZD0ke3NuYXAubGVnYWxNb3Zlc1NlYXJjaGVkfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBab2JyaXN0OiBpbmNyZW1lbnRhbD0ke3NuYXAuaW5jcmVtZW50YWxab2JyaXN0fSwgZnVsbEhhc2g9JHtzbmFwLmZ1bGxIYXNoQ291bnR9LCBpbmNyVXBkYXRlcz0ke3NuYXAuaW5jcmVtZW50YWxIYXNoVXBkYXRlc30sIG1pc21hdGNoZXM9JHtzbmFwLmhhc2hNaXNtYXRjaGVzfWApOw0KICAgIGNvbnNvbGUubG9nKGAgICBsZWFmQXR0YWNrQml0cz0ke3NuYXAubGVhZkF0dGFja0JpdHN9IHJlbGF0aW9uTWFza3M9JHtzbmFwLnJlbGF0aW9uTWFza3N9IHBpZWNlTGlzdD0ke3NuYXAucGllY2VMaXN0fSBmdWxsRXZhbE1zPSR7TWF0aC5yb3VuZChzbmFwLmV2YWx1YXRlQm9hcmRNcyl9IGZhc3RMZWFmTXM9JHtNYXRoLnJvdW5kKHNuYXAuZmFzdExlYWZFdmFsTXMpfSBmYXN0TGVhZkNvdW50PSR7c25hcC5mYXN0TGVhZkV2YWxDb3VudH0gcHJlcGFyZU1zPSR7TWF0aC5yb3VuZChzbmFwLnByZXBhcmVTZWFyY2hJbmZvTXMpfWApOwogICAgY29uc29sZS5sb2coYCAgIFRUOiBoaXRzPSR7c25hcC50dC5oaXRzfSwgbWlzc2VzPSR7c25hcC50dC5taXNzZXN9LCBoaXRSYXRlPSR7c25hcC50dC5oaXRSYXRlfSUsIHN0b3Jlcz0ke3NuYXAudHQuc3RvcmVzfSwgc2l6ZT0ke3NuYXAudHQuY3VycmVudFNpemV9YCk7DQogICAgDQogICAgY29uc3QgZGVwdGhzID0gT2JqZWN0LmtleXMoc25hcC5ieURlcHRoKTsNCiAgICBpZiAoZGVwdGhzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgY29uc29sZS5sb2coJyAgIOaMiea3seW6pue7n+iuoTonKTsNCiAgICAgICAgZm9yIChjb25zdCBkIG9mIGRlcHRocykgew0KICAgICAgICAgICAgY29uc3Qgcm93ID0gc25hcC5ieURlcHRoW2RdOw0KICAgICAgICAgICAgY29uc29sZS5sb2coYCAgICAg5rex5bqmJHtkfTog6IqC54K5PSR7cm93Lm5vZGVzfSwg6LWw5rOVPSR7cm93Lm1vdmVzfSwg5Ymq5p6dPSR7cm93LmN1dG9mZnN9YCk7DQogICAgICAgIH0NCiAgICB9DQp9Ow0KDQpjb25zdCB0cmFuc3Bvc2l0aW9uVGFibGUgPSBuZXcgVHJhbnNwb3NpdGlvblRhYmxlKCk7DQoNCi8vIOWPtuivhOS8sOe8k+WtmO+8iOWujOaVtOW9ouWKv+WIhu+8ie+8m+avj+asoSBnZXRCZXN0TW92ZSDmuIXnqboNCmNvbnN0IEVWQUxfQ0FDSEVfTUFYID0gTWF0aC5wb3coMiwgMTgpOw0KY29uc3QgZXZhbENhY2hlID0gbmV3IE1hcCgpOw0KY29uc3QgY2xlYXJFdmFsQ2FjaGUgPSAoKSA9PiB7DQogICAgZXZhbENhY2hlLmNsZWFyKCk7DQp9Ow0KDQovLyDliarmnp3lvIDlhbPvvJrlrozmlbTor4TkvLDkuIvoi6XlvIDlsYDlh7rlup/mo4vliJnlhYjlhbPvvIzkv53mo4vlipvlho3ph43moIflrpoNCmNvbnN0IFNFQVJDSF9FTkFCTEVfTk1QID0gZmFsc2U7DQpjb25zdCBTRUFSQ0hfRU5BQkxFX0xNUiA9IGZhbHNlOw0KDQovLyDnnYDms5XlkIjms5XmgKfvvJp0cnVlPeaQnOe0ouWGheivlei1sOaXtuajgOa1i++8iOWPr+i3s+i/h+WJquaeneacquinpuWPiuedgOazle+8ie+8m2ZhbHNlPXByZXBhcmUg5pe25YWo6YePIGZpbHRlckxlZ2FsTW92ZXPvvIjml6fot6/lvoTvvIkNCmxldCBTRUFSQ0hfREVGRVJfTEVHQUxJVFkgPSB0cnVlOw0KbGV0IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPSB0cnVlOw0KDQovLyBab2JyaXN0L1RU77yadHJ1ZT3mkJzntKLlhoXlop7ph4/nu7TmiqTlsYDpnaLlk4jluIwgKyDmlbDlgLwgVFQga2V577ybZmFsc2U95q+P6IqC54K55YWo55uYIGhhc2ggKyDlrZfnrKbkuLIga2V577yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQ0KbGV0IFNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUID0gdHJ1ZTsNCi8vIOiwg+ivle+8muWinumHj+WQjuS4juWFqOebmCBoYXNoIOavlOWvue+8iOS7heagoemqjOiEmuacrOW8gOWQr++8jOato+W8j+aQnOe0ouWFs+mXre+8iQ0KbGV0IFNFQVJDSF9aT0JSSVNUX1ZFUklGWSA9IGZhbHNlOw0KDQovLyDmkJzntKLlkK/lj5HvvJrmnYDmo4vooaggKyDljoblj7LlkK/lj5HvvIjmr4/mrKEgZ2V0QmVzdE1vdmUg6YeN572u77yJDQpsZXQga2lsbGVyTW92ZXMgPSBbXTsNCmxldCBoaXN0b3J5VGFibGUgPSBudWxsOw0KDQpjb25zdCByZXNldFNlYXJjaEhldXJpc3RpY3MgPSAobWF4RGVwdGgpID0+IHsNCiAgICBraWxsZXJNb3ZlcyA9IEFycmF5KG1heERlcHRoICsgMikuZmlsbChudWxsKS5tYXAoKCkgPT4gW251bGwsIG51bGxdKTsNCiAgICBoaXN0b3J5VGFibGUgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAxMCB9LCAoKSA9Pg0KICAgICAgICBBcnJheS5mcm9tKHsgbGVuZ3RoOiA5IH0sICgpID0+DQogICAgICAgICAgICBBcnJheS5mcm9tKHsgbGVuZ3RoOiAxMCB9LCAoKSA9PiBBcnJheSg5KS5maWxsKDApKQ0KICAgICAgICApDQogICAgKTsNCn07DQoNCmNvbnN0IGlzU2FtZU1vdmUgPSAoYSwgYikgPT4NCiAgICBhICE9IG51bGwgJiYgYiAhPSBudWxsICYmDQogICAgbW92ZUZyb21TcShhKSA9PT0gbW92ZUZyb21TcShiKSAmJg0KICAgIG1vdmVUb1NxKGEpID09PSBtb3ZlVG9TcShiKTsNCg0KY29uc3Qgc3RvcmVLaWxsZXJNb3ZlID0gKGRlcHRoLCBtb3ZlKSA9PiB7DQogICAgaWYgKGRlcHRoIDwgMCB8fCBkZXB0aCA+PSBraWxsZXJNb3Zlcy5sZW5ndGggfHwgIW1vdmUpIHJldHVybjsNCiAgICBjb25zdCBzbG90ID0ga2lsbGVyTW92ZXNbZGVwdGhdOw0KICAgIGlmIChpc1NhbWVNb3ZlKHNsb3RbMF0sIG1vdmUpKSByZXR1cm47DQogICAgc2xvdFsxXSA9IHNsb3RbMF07DQogICAgc2xvdFswXSA9IGlzRW5jb2RlZE1vdmUobW92ZSkgPyBtb3ZlIDogZW5jb2RlTW92ZShtb3ZlLmZyb20sIG1vdmUudG8pOw0KfTsNCg0KY29uc3QgYWRkSGlzdG9yeVNjb3JlID0gKG1vdmUsIGRlcHRoKSA9PiB7DQogICAgaWYgKCFoaXN0b3J5VGFibGUgfHwgIW1vdmUpIHJldHVybjsNCiAgICBoaXN0b3J5VGFibGVbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldW21vdmVUb1IobW92ZSldW21vdmVUb0MobW92ZSldICs9IGRlcHRoICogZGVwdGg7DQp9Ow0KDQpjb25zdCBnZXRIaXN0b3J5U2NvcmUgPSAobW92ZSkgPT4gew0KICAgIGlmICghaGlzdG9yeVRhYmxlIHx8ICFtb3ZlKSByZXR1cm4gMDsNCiAgICByZXR1cm4gaGlzdG9yeVRhYmxlW21vdmVGcm9tUihtb3ZlKV1bbW92ZUZyb21DKG1vdmUpXVttb3ZlVG9SKG1vdmUpXVttb3ZlVG9DKG1vdmUpXSB8fCAwOw0KfTsNCg0KLy8gV29ya2VyIG1lc3NhZ2UgaGFuZGxpbmcNCmlmICh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcpIHsNCiAgICBzZWxmLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKGUpIHsNCiAgICBjb25zdCB7IHR5cGUsIHBheWxvYWQgfSA9IGUuZGF0YTsNCiAgICANCiAgICBzd2l0Y2ggKHR5cGUpIHsgICAgICAgICAgICANCiAgICAgICAgY2FzZSAnU0VBUkNIJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogc2VhcmNoQm9hcmQsIHR1cm46IHNlYXJjaFR1cm4sIGRlcHRoOiBzZWFyY2hEZXB0aCwgZ2FtZUlkLCBvcGVuaW5nQm9va0VuYWJsZWQ6IHNlYXJjaE9wZW5pbmdCb29rRW5hYmxlZCA9IHRydWUsIHBseTogc2VhcmNoUGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0OiBzZWFyY2hFbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzOiBzZWFyY2hFeGFjdFJvb3RTY29yZXMgPSBmYWxzZSwgZGVmZXJMZWdhbGl0eTogc2VhcmNoRGVmZXJMZWdhbGl0eSwgaW5jcmVtZW50YWxab2JyaXN0OiBzZWFyY2hJbmNyZW1lbnRhbFpvYnJpc3QsIGxlYWZBdHRhY2tCaXRzOiBzZWFyY2hMZWFmQXR0YWNrQml0cywgcmVsYXRpb25NYXNrczogc2VhcmNoUmVsYXRpb25NYXNrcywgZmFzdExlYWZFdmFsOiBzZWFyY2hGYXN0TGVhZkV2YWwsIHBpZWNlTGlzdDogc2VhcmNoUGllY2VMaXN0LCB6b2JyaXN0VmVyaWZ5OiBzZWFyY2hab2JyaXN0VmVyaWZ5LCBjb2xsZWN0TW92ZVNlcXVlbmNlOiBzZWFyY2hDb2xsZWN0TW92ZVNlcXVlbmNlIH0gPSBwYXlsb2FkOwogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaERlZmVyTGVnYWxpdHkgPT09ICdib29sZWFuJykgew0KICAgICAgICAgICAgICAgIFNFQVJDSF9ERUZFUl9MRUdBTElUWSA9IHNlYXJjaERlZmVyTGVnYWxpdHk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaEluY3JlbWVudGFsWm9icmlzdCA9PT0gJ2Jvb2xlYW4nKSB7DQogICAgICAgICAgICAgICAgU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QgPSBzZWFyY2hJbmNyZW1lbnRhbFpvYnJpc3Q7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAodHlwZW9mIHNlYXJjaExlYWZBdHRhY2tCaXRzID09PSAnYm9vbGVhbicpIHsNCiAgICAgICAgICAgICAgICBTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUUyA9IHNlYXJjaExlYWZBdHRhY2tCaXRzOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHR5cGVvZiBzZWFyY2hSZWxhdGlvbk1hc2tzID09PSAnYm9vbGVhbicpIHsKICAgICAgICAgICAgICAgIFNFQVJDSF9SRUxBVElPTl9NQVNLUyA9IHNlYXJjaFJlbGF0aW9uTWFza3M7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgaWYgKHR5cGVvZiBzZWFyY2hGYXN0TGVhZkV2YWwgPT09ICdib29sZWFuJykgewogICAgICAgICAgICAgICAgU0VBUkNIX0ZBU1RfTEVBRl9FVkFMID0gc2VhcmNoRmFzdExlYWZFdmFsOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2VhcmNoUGllY2VMaXN0ID09PSAnYm9vbGVhbicpIHsKICAgICAgICAgICAgICAgIFNFQVJDSF9QSUVDRV9MSVNUID0gc2VhcmNoUGllY2VMaXN0OwogICAgICAgICAgICB9CiAgICAgICAgICAgIFNFQVJDSF9aT0JSSVNUX1ZFUklGWSA9ICEhc2VhcmNoWm9icmlzdFZlcmlmeTsNCiAgICAgICAgICAgIC8vIFNldCBvcGVuaW5nIGJvb2sgZW5hYmxlZCBzdGF0dXMNCiAgICAgICAgICAgIG9wZW5pbmdCb29rLnNldEVuYWJsZWQoc2VhcmNoT3BlbmluZ0Jvb2tFbmFibGVkKTsNCiAgICAgICAgICAgIC8vIOiusOW9leaQnOe0ouW8gOWni+aXtumXtA0KICAgICAgICAgICAgY29uc3Qgc3RhcnRUaW1lID0gcGVyZm9ybWFuY2Uubm93KCk7DQogICAgICAgICAgICAvLyDmiafooYzmkJzntKINCiAgICAgICAgICAgIGNvbnN0IGJlc3RTZWFyY2hNb3ZlID0gZ2V0QmVzdE1vdmUoc2VhcmNoQm9hcmQsIHNlYXJjaFR1cm4sIHNlYXJjaERlcHRoLCBzZWFyY2hQbHksIHNlYXJjaEVuYWJsZVRpbWVMaW1pdCwgc2VhcmNoRXhhY3RSb290U2NvcmVzLCBzZWFyY2hDb2xsZWN0TW92ZVNlcXVlbmNlKTsNCiAgICAgICAgICAgIC8vIOiusOW9leaQnOe0oue7k+adn+aXtumXtOW5tuiuoeeul+aAneiAg+aXtumXtA0KICAgICAgICAgICAgY29uc3QgZW5kVGltZSA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgICAgICAgICAgY29uc3QgdGhpbmtpbmdUaW1lID0gZW5kVGltZSAtIHN0YXJ0VGltZTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5qOA5p+l5piv5ZCm5p2l6Ieq5byA5bGA5bqTDQogICAgICAgICAgICBjb25zdCBib29rTW92ZVNlYXJjaCA9IG9wZW5pbmdCb29rLmdldEJvb2tNb3ZlKHNlYXJjaEJvYXJkLCBzZWFyY2hQbHkpOw0KICAgICAgICAgICAgY29uc3QgZnJvbUJvb2tTZWFyY2ggPSAhIWJvb2tNb3ZlU2VhcmNoICYmIEpTT04uc3RyaW5naWZ5KGJvb2tNb3ZlU2VhcmNoKSA9PT0gSlNPTi5zdHJpbmdpZnkoYmVzdFNlYXJjaE1vdmUuYmVzdE1vdmUpOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDmt7vliqDmgKfog73nu5/orqHml6Xlv5cNCiAgICAgICAgICAgIGxvZ1BlcmZTdGF0cyhzZWFyY2hUdXJuKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5re75Yqg5oCd6ICD5pe26Ze05pel5b+XDQogICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VhcmNoIGNvbXBsZXRlZCBpbiAke01hdGgucm91bmQodGhpbmtpbmdUaW1lKX1tcywgZ2FtZUlkPSR7Z2FtZUlkfSwgYmVzdE1vdmU9JHtKU09OLnN0cmluZ2lmeShiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZSl9LCBzZWNvbmRCZXN0TW92ZT0ke0pTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlKX0sIGZyb21Cb29rPSR7ZnJvbUJvb2tTZWFyY2h9YCk7DQogICAgICAgICAgICAvLyDlj5HpgIHmkJzntKLnu5PmnpzlkozmgJ3ogIPml7bpl7QNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnU0VBUkNIX0NPTVBMRVRFJywgDQogICAgICAgICAgICAgICAgcGF5bG9hZDogeyANCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmU6IGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlLCANCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kQmVzdE1vdmU6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlLCANCiAgICAgICAgICAgICAgICAgICAgZ2FtZUlkLCANCiAgICAgICAgICAgICAgICAgICAgZnJvbUJvb2s6IGZyb21Cb29rU2VhcmNoLCANCiAgICAgICAgICAgICAgICAgICAgdGhpbmtpbmdUaW1lOiBNYXRoLnJvdW5kKHRoaW5raW5nVGltZSksIC8vIOWbm+iIjeS6lOWFpeWIsOavq+enkg0KICAgICAgICAgICAgICAgICAgICBtb3ZlU2VxdWVuY2U6IGJlc3RTZWFyY2hNb3ZlLm1vdmVTZXF1ZW5jZSwNCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kTW92ZVNlcXVlbmNlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRNb3ZlU2VxdWVuY2UsDQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2NvcmU6IGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlU2NvcmUsDQogICAgICAgICAgICAgICAgICAgIHNlY29uZEJlc3RNb3ZlU2NvcmU6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlU2NvcmUsDQogICAgICAgICAgICAgICAgICAgIGFsbE1vdmVzV2l0aFNjb3JlczogYmVzdFNlYXJjaE1vdmUuYWxsTW92ZXNXaXRoU2NvcmVzIHx8IFtdLA0KICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWREZXB0aDogYmVzdFNlYXJjaE1vdmUuY29tcGxldGVkRGVwdGgsDQogICAgICAgICAgICAgICAgICAgIHBlcmY6IHNuYXBzaG90UGVyZlN0YXRzKCkNCiAgICAgICAgICAgICAgICB9IA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBjYXNlICdnZXRWYWxpZE1vdmVzJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogdm1Cb2FyZCwgcG9zOiB2bVBvcyB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIHN5bmNHZW5lcmFsUG9zQ2FjaGUodm1Cb2FyZCk7DQogICAgICAgICAgICBjb25zdCB2YWxpZE1vdmVzID0gZ2V0VmFsaWRNb3Zlcyh2bUJvYXJkLCB2bVBvcyk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAndmFsaWRNb3ZlcycsDQogICAgICAgICAgICAgICAgbW92ZXM6IHZhbGlkTW92ZXMNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdnZXRQaWVjZVJlbGF0aW9ucyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHByQm9hcmQsIHBvczogcHJQb3MgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IHByQm9hcmRbcHJQb3Mucl1bcHJQb3MuY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOiwg+eUqGV2YWx1YXRlQm9hcmTojrflj5blrozmlbTnmoTmo4vlrZDkv6Hmga/lkoxib2FyZEluZm8NCiAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7DQogICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkRXZhbHVhdGlvbiA9IGV2YWx1YXRlQm9hcmQocHJCb2FyZCwgbnVsbCwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlc0luZm8gPSBib2FyZEV2YWx1YXRpb24ucGllY2VzSW5mbzsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5ib2FyZEluZm87DQoNCiAgICAgICAgICAgIGlmIChib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcykgew0KICAgICAgICAgICAgICAgIGh5ZHJhdGVSZWxhdGlvbnNGcm9tTWFza3MocGllY2VzSW5mbywgYm9hcmRJbmZvKTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gYm9hcmRJbmZvIOagvOWGheWPr+iDveaYryBwaWVjZXNJbmZvIOW8leeUqO+8jOe7n+S4gOaYoOWwhOS4uiB7cixjfSDkvpsgVUkg5L2/55SoDQogICAgICAgICAgICBjb25zdCByYXdDb250cm9sbGVycyA9IGJvYXJkSW5mby5jb250cm9sbGVyR3JpZA0KICAgICAgICAgICAgICAgID8gKGJvYXJkSW5mby5jb250cm9sbGVyR3JpZFtwclBvcy5yXVtwclBvcy5jXSB8fCBbXSkNCiAgICAgICAgICAgICAgICA6IChib2FyZEluZm9bcHJQb3Mucl0gJiYgYm9hcmRJbmZvW3ByUG9zLnJdW3ByUG9zLmNdKSB8fCBbXTsNCiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJzID0gcmF3Q29udHJvbGxlcnMubWFwKChjdHJsKSA9PiAoeyByOiBjdHJsLnIsIGM6IGN0cmwuYyB9KSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGxldCByZWxhdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgdGhyZWF0OiBbXSwgDQogICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwgDQogICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLCANCiAgICAgICAgICAgICAgICBndWFyZGVkQnk6IFtdLCANCiAgICAgICAgICAgICAgICBjb250cm9sOiBbXSwNCiAgICAgICAgICAgICAgICBjb250cm9sbGVycw0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5aaC5p6c54K55Ye755qE5piv5qOL5a2Q77yM6L+U5Zue6K+l5qOL5a2Q55qE5YWz57O75L+h5oGvDQogICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBjdXJyZW50IHBpZWNlIGluZm8NCiAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50UGllY2VJbmZvID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSBwclBvcy5yICYmIHAuYyA9PT0gcHJQb3MuYyk7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRQaWVjZUluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gRXh0cmFjdCByZWxhdGlvbnMNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGhyZWF0ID0gY3VycmVudFBpZWNlSW5mby50aHJlYXQubWFwKHRocmVhdFBpZWNlID0+ICh7IHI6IHRocmVhdFBpZWNlLnIsIGM6IHRocmVhdFBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0aHJlYXRlbmVkQnkgPSBjdXJyZW50UGllY2VJbmZvLnRocmVhdGVuZWRCeS5tYXAodGhyZWF0ZW5lZEJ5UGllY2UgPT4gKHsgcjogdGhyZWF0ZW5lZEJ5UGllY2UuciwgYzogdGhyZWF0ZW5lZEJ5UGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGd1YXJkID0gY3VycmVudFBpZWNlSW5mby5ndWFyZC5tYXAoZ3VhcmRQaWVjZSA9PiAoeyByOiBndWFyZFBpZWNlLnIsIGM6IGd1YXJkUGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGd1YXJkZWRCeSA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmRlZEJ5Lm1hcChndWFyZGVkQnlQaWVjZSA9PiAoeyByOiBndWFyZGVkQnlQaWVjZS5yLCBjOiBndWFyZGVkQnlQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udHJvbCA9IChjdXJyZW50UGllY2VJbmZvLmNvbnRyb2wgfHwgW10pLm1hcChjb250cm9sUG9zID0+ICh7IHI6IGNvbnRyb2xQb3MuciwgYzogY29udHJvbFBvcy5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIHJlbGF0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdCwgDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnksIA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmQsIA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRlZEJ5LCANCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRyb2wsDQogICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sbGVycw0KICAgICAgICAgICAgICAgICAgICB9Ow0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlUmVsYXRpb25zJywNCiAgICAgICAgICAgICAgICByZWxhdGlvbnM6IHJlbGF0aW9ucw0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2NoZWNrR2FtZVN0YXRlJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogY2dzQm9hcmQsIHR1cm46IGNnc1R1cm4sIHJlcXVlc3RJZCB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGNoZWNrR2FtZVN0YXRlKGNnc0JvYXJkLCBjZ3NUdXJuKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdnYW1lU3RhdGUnLA0KICAgICAgICAgICAgICAgIHN0YXRlOiBnYW1lU3RhdGUsDQogICAgICAgICAgICAgICAgcmVxdWVzdElkDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnZXZhbHVhdGVCb2FyZCc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGV2YWxCb2FyZCwgdHVybjogZXZhbFR1cm4gfSA9IHBheWxvYWQ7DQogICAgICAgICAgICAvLyDmiZPljbDmjqXmlLbnmoTlj4LmlbANCiAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7DQogICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCiAgICAgICAgICAgIGNvbnN0IGRldGFpbGVkRXZhbCA9IGV2YWx1YXRlQm9hcmQoZXZhbEJvYXJkLCBldmFsVHVybiwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdkZXRhaWxlZEV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IGRldGFpbGVkRXZhbA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KDQogICAgICAgIGNhc2UgJ2V2YWx1YXRlUGllY2UnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBwaWVjZUV2YWxCb2FyZCwgcG9zOiBwaWVjZUV2YWxQb3MsIHR1cm4gfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IHBpZWNlRXZhbEJvYXJkW3BpZWNlRXZhbFBvcy5yXVtwaWVjZUV2YWxQb3MuY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghcGllY2UpIHsNCiAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMA0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g5Li75Yqo6LCD55SoZXZhbHVhdGVCb2FyZOiOt+WPluWujOaVtOeahOivhOS8sOS/oeaBrw0KICAgICAgICAgICAgICAgIC8vIOiOt+WPluW9k+WJjea4uOaIj+mYtuautQ0KICAgICAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7DQogICAgICAgICAgICAgICAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQogICAgICAgICAgICBjb25zdCBib2FyZEV2YWx1YXRpb24gPSBldmFsdWF0ZUJvYXJkKHBpZWNlRXZhbEJvYXJkLCB0dXJuLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIOS7jmV2YWx1YXRlQm9hcmTnmoTov5Tlm57lgLzkuK3mib7liLDlvZPliY3mo4vlrZDnmoTkv6Hmga8NCiAgICAgICAgICAgICAgICBjdXJyZW50UGllY2VJbmZvID0gYm9hcmRFdmFsdWF0aW9uLnBpZWNlc0luZm8uZmluZCgNCiAgICAgICAgICAgICAgICAgICAgcCA9PiBwLnIgPT09IHBpZWNlRXZhbFBvcy5yICYmIHAuYyA9PT0gcGllY2VFdmFsUG9zLmMNCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGllY2VJbmZvKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOW6lOeUqOadg+mHjeW5tui/lOWbnuWNleS4quaji+WtkOeahOivhOS8sOWAvA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBldmFsdWF0aW9uID0gew0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IGN1cnJlbnRQaWVjZUluZm8ubWF0ZXJpYWxWYWx1ZSAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogY3VycmVudFBpZWNlSW5mby5wb3NpdGlvblZhbHVlICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiBjdXJyZW50UGllY2VJbmZvLm1vYmlsaXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiBjdXJyZW50UGllY2VJbmZvLnRocmVhdFZhbHVlICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IGN1cnJlbnRQaWVjZUluZm8uc2FmZXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogY3VycmVudFBpZWNlSW5mby50YWN0aWNWYWx1ZSAqIFZBTFVFX1dFSUdIVFMudGFjdGljDQogICAgICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZXZhbHVhdGlvbg0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDlpoLmnpzku43nhLbmib7kuI3liLDmo4vlrZDkv6Hmga/vvIzov5Tlm57pu5jorqTlgLwNCiAgICAgICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMA0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnaXNDaGVjayc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGNCb2FyZCwgY29sb3I6IGNDb2xvciwgcmVxdWVzdElkIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgc3luY0dlbmVyYWxQb3NDYWNoZShjQm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2soY0JvYXJkLCBjQ29sb3IpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2NoZWNrJywNCiAgICAgICAgICAgICAgICBpc0NoZWNrOiBpbkNoZWNrLA0KICAgICAgICAgICAgICAgIHJlcXVlc3RJZA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2lzVmFsaWRQbGFjZW1lbnQnOiB7DQogICAgICAgICAgICBjb25zdCB7IHR5cGU6IGlwVHlwZSwgY29sb3I6IGlwQ29sb3IsIHIsIGMgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCB2YWxpZFBsYWNlbWVudCA9IGlzVmFsaWRQbGFjZW1lbnQoaXBUeXBlLCBpcENvbG9yLCByLCBjKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICd2YWxpZFBsYWNlbWVudCcsDQogICAgICAgICAgICAgICAgaXNWYWxpZDogdmFsaWRQbGFjZW1lbnQNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcnOiB7DQogICAgICAgICAgICBjb25zdCB7IG1vdmVzLCB3ZWlnaHRzIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgLy8gQWRkIHRoZSBvcGVuaW5nIGxpbmUgdG8gdGhlIG9wZW5pbmcgYm9vaw0KICAgICAgICAgICAgb3BlbmluZ0Jvb2suYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKFttb3Zlc10sIHdlaWdodHMpOw0KICAgICAgICAgICAgLy8gU2VuZCBjb25maXJtYXRpb24NCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnb3BlbmluZ0xpbmVBZGRlZCcsIA0KICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUgDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnbW92ZXNUb05vdGF0aW9uJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5IH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3Qgbm90YXRpb24gPSBvcGVuaW5nQm9vay5tb3Zlc1RvTm90YXRpb24oYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ25vdGF0aW9uJywgDQogICAgICAgICAgICAgICAgbm90YXRpb246IG5vdGF0aW9uIA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ25vdGF0aW9uVG9Nb3Zlcyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgbm90YXRpb246IG5vdGF0aW9uU3RyaW5nLCBpbml0aWFsQm9hcmQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBtb3Zlc0Zyb21Ob3RhdGlvbiA9IG9wZW5pbmdCb29rLm5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvblN0cmluZywgaW5pdGlhbEJvYXJkKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnbW92ZXMnLCANCiAgICAgICAgICAgICAgICBtb3ZlczogbW92ZXNGcm9tTm90YXRpb24gDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnc2V0VmFsdWVXZWlnaHRzJzogew0KICAgICAgICAgICAgVkFMVUVfV0VJR0hUUyA9IHsgLi4uVkFMVUVfV0VJR0hUUywgLi4ucGF5bG9hZCB9Ow0KICAgICAgICAgICAgY29uc29sZS5sb2coJ1VwZGF0ZWQgVkFMVUVfV0VJR0hUUzonLCBWQUxVRV9XRUlHSFRTKTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KICAgIC8vIE92ZXJyaWRlIGNvbnNvbGUubG9nIHRvIHNlbmQgbWVzc2FnZXMgYmFjayB0byBtYWluIHRocmVhZA0KICAgIGNvbnN0IG9yaWdpbmFsQ29uc29sZUxvZyA9IGNvbnNvbGUubG9nOw0KICAgIGNvbnNvbGUubG9nID0gZnVuY3Rpb24oLi4uYXJncykgew0KICAgICAgICAvLyBTZW5kIHRvIG1haW4gdGhyZWFkDQogICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgdHlwZTogJ2xvZycsDQogICAgICAgICAgICBkYXRhOiBhcmdzLmpvaW4oJyAnKQ0KICAgICAgICB9KTsNCiAgICAgICAgDQogICAgICAgIC8vIEFsc28gbG9nIHRvIHdvcmtlciBjb25zb2xlDQogICAgICAgIG9yaWdpbmFsQ29uc29sZUxvZy5hcHBseShjb25zb2xlLCBhcmdzKTsNCiAgICB9Ow0KfQ0KDQovLyDnqbrnnYDliarmnp3vvJrmnInov5vmlLvlrZDlipvml7bmiY3lhYHorrjvvIjpgb/lhY3lsIYv5aOrL+ixoeaui+WxgOmAvOedgOivr+WJqu+8iQ0KY29uc3QgY2FuRG9OdWxsTW92ZSA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKCFwIHx8IHAuY29sb3IgIT09IGNvbG9yKSBjb250aW51ZTsNCiAgICAgICAgICAgIGlmIChwLnR5cGUgPT09ICdjaGFyaW90JyB8fCBwLnR5cGUgPT09ICdob3JzZScgfHwgcC50eXBlID09PSAnY2Fubm9uJyB8fCBwLnR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiBmYWxzZTsNCn07DQoNCi8vIOaQnOe0oueUqCBUVCBrZXnvvJrlop7ph4/mqKHlvI/kuLogbnVtYmVy77yM5pen5qih5byP5Li6IGAke2hhc2h9OiR7c2lkZX1gIOWtl+espuS4sg0KY29uc3QgbWFrZVNlYXJjaFRUS2V5ID0gKGJvYXJkLCBjdXJyZW50UGxheWVyLCBib2FyZEhhc2gpID0+IHsNCiAgICBpZiAoU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QpIHsNCiAgICAgICAgcmV0dXJuIHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChib2FyZEhhc2gsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIH0NCiAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCsrOw0KICAgIHJldHVybiBgJHt6b2JyaXN0SGFzaGVyLmhhc2goYm9hcmQpfToke2N1cnJlbnRQbGF5ZXJ9YDsNCn07DQoNCi8vIOi1sOWtkOWQjueahOWtkOiKgueCueWxgOmdouWTiOW4jO+8iOS7heWinumHj+aooeW8j+acieaEj+S5ie+8m+mhu+WcqCBtYWtlIOWJjeS/neWtmCBtb3ZpbmdQaWVjZe+8iQ0KY29uc3QgY2hpbGRCb2FyZEhhc2ggPSAoYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpID0+IHsNCiAgICBpZiAoIVNFQVJDSF9JTkNSRU1FTlRBTF9aT0JSSVNUKSByZXR1cm4gYm9hcmRIYXNoOw0KICAgIHBlcmZTdGF0cy5pbmNyZW1lbnRhbEhhc2hVcGRhdGVzKys7DQogICAgaWYgKGlzRW5jb2RlZE1vdmUobW92ZSkpIHsNCiAgICAgICAgbGV0IG5ld0hhc2ggPSBib2FyZEhhc2g7DQogICAgICAgIGNvbnN0IG1vdmluZ0lkeCA9IHpvYnJpc3RIYXNoZXIucGllY2VJbmRleChtb3ZpbmdQaWVjZSk7DQogICAgICAgIGNvbnN0IGZyb20gPSBtb3ZlID4+PiA3Ow0KICAgICAgICBjb25zdCB0byA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7DQogICAgICAgIGlmIChtb3ZpbmdJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgbmV3SGFzaCBePSB6b2JyaXN0SGFzaGVyLmhhc2hUYWJsZVsoZnJvbSAvIDkpIHwgMF1bZnJvbSAlIDldW21vdmluZ0lkeF07DQogICAgICAgICAgICBuZXdIYXNoIF49IHpvYnJpc3RIYXNoZXIuaGFzaFRhYmxlWyh0byAvIDkpIHwgMF1bdG8gJSA5XVttb3ZpbmdJZHhdOw0KICAgICAgICB9DQogICAgICAgIGlmIChjYXB0dXJlZCkgew0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRJZHggPSB6b2JyaXN0SGFzaGVyLnBpZWNlSW5kZXgoY2FwdHVyZWQpOw0KICAgICAgICAgICAgaWYgKGNhcHR1cmVkSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICBuZXdIYXNoIF49IHpvYnJpc3RIYXNoZXIuaGFzaFRhYmxlWyh0byAvIDkpIHwgMF1bdG8gJSA5XVtjYXB0dXJlZElkeF07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIG5ld0hhc2g7DQogICAgfQ0KICAgIHJldHVybiB6b2JyaXN0SGFzaGVyLnVwZGF0ZUhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOw0KfTsNCg0KY29uc3QgdmVyaWZ5Qm9hcmRIYXNoID0gKGJvYXJkLCBleHBlY3RlZEhhc2gpID0+IHsNCiAgICBpZiAoIVNFQVJDSF9aT0JSSVNUX1ZFUklGWSkgcmV0dXJuOw0KICAgIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50Kys7DQogICAgY29uc3QgZnVsbCA9IHpvYnJpc3RIYXNoZXIuaGFzaChib2FyZCk7DQogICAgaWYgKGZ1bGwgIT09IGV4cGVjdGVkSGFzaCkgew0KICAgICAgICBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMrKzsNCiAgICB9DQp9Ow0KDQovLyDmkJzntKLnlKjlh4DliIbvvJrlrozmlbTlvaLlir/or4TkvLDvvIjlhbPns7sv5aiB6IOBL+WuieWFqC/mnLrliqjvvInvvIzku4Xot7Pov4fnu4jlsYDnnYDms5XmnprkuL7vvJvluKYgWm9icmlzdCDnvJPlrZgNCmNvbnN0IHN0YXRpY1NlYXJjaEV2YWwgPSAoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBib2FyZEhhc2ggPSAwKSA9PiB7DQogICAgbGV0IGNhY2hlS2V5Ow0KICAgIGlmIChTRUFSQ0hfSU5DUkVNRU5UQUxfWk9CUklTVCkgew0KICAgICAgICBjYWNoZUtleSA9IHpvYnJpc3RIYXNoZXIuZXZhbENhY2hlS2V5RnJvbUhhc2goYm9hcmRIYXNoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSk7DQogICAgfSBlbHNlIHsNCiAgICAgICAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsNCiAgICAgICAgY2FjaGVLZXkgPSB6b2JyaXN0SGFzaGVyLmV2YWxDYWNoZUtleShib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UpOw0KICAgIH0NCiAgICBpZiAoZXZhbENhY2hlLmhhcyhjYWNoZUtleSkpIHsNCiAgICAgICAgcmV0dXJuIGV2YWxDYWNoZS5nZXQoY2FjaGVLZXkpOw0KICAgIH0NCiAgICBsZXQgbmV0OwogICAgaWYgKFNFQVJDSF9GQVNUX0xFQUZfRVZBTCAmJiAhU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgewogICAgICAgIG5ldCA9IGV2YWx1YXRlU2VhcmNoTGVhZkZhc3QoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsKICAgIH0gZWxzZSB7CiAgICAgICAgY29uc3QgZXZhbFJlc3VsdCA9IGV2YWx1YXRlQm9hcmQoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB7IGZvclNlYXJjaExlYWY6IHRydWUgfSk7CiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBzZWFyY2hJbml0aWF0b3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOwogICAgICAgIG5ldCA9IGV2YWxSZXN1bHRbc2VhcmNoSW5pdGlhdG9yXS50b3RhbCAtIGV2YWxSZXN1bHRbb3Bwb25lbnRdLnRvdGFsOwogICAgfQogICAgaWYgKGV2YWxDYWNoZS5zaXplID49IEVWQUxfQ0FDSEVfTUFYKSB7DQogICAgICAgIC8vIOeugOWNlea3mOaxsOacgOaXqeWGmeWFpeeahOS4gOaJue+8jOmBv+WFjSBNYXAg5peg6ZmQ5raoDQogICAgICAgIGxldCBkcm9wID0gMDsNCiAgICAgICAgZm9yIChjb25zdCBrIG9mIGV2YWxDYWNoZS5rZXlzKCkpIHsNCiAgICAgICAgICAgIGV2YWxDYWNoZS5kZWxldGUoayk7DQogICAgICAgICAgICBpZiAoKytkcm9wID49IDQwOTYpIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KICAgIGV2YWxDYWNoZS5zZXQoY2FjaGVLZXksIG5ldCk7DQogICAgcmV0dXJuIG5ldDsNCn07DQoNCi8vIOeUn+aIkOW9k+WJjeaWueWQg+WtkOedgO+8iOS+m+mdmem7mOaQnOe0ou+8iQ0KY29uc3QgZ2VuZXJhdGVDYXB0dXJlc0ZvclNlYXJjaCA9IChib2FyZCwgY3VycmVudFBsYXllcikgPT4gew0KICAgIGNvbnN0IGNhcHR1cmVzID0gW107DQogICAgY29uc3QgZGVmZXIgPSBTRUFSQ0hfREVGRVJfTEVHQUxJVFk7DQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAoIXBpZWNlIHx8IHBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSBjb250aW51ZTsNCiAgICAgICAgICAgIGNvbnN0IHBzZXVkbyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHsgciwgYyB9LCBwaWVjZSk7DQogICAgICAgICAgICBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgKz0gcHNldWRvLmxlbmd0aDsNCiAgICAgICAgICAgIGNvbnN0IHVzZU1vdmVzID0gZGVmZXIgPyBwc2V1ZG8gOiBmaWx0ZXJMZWdhbE1vdmVzKGJvYXJkLCB7IHIsIGMgfSwgcGllY2UsIHBzZXVkbyk7DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHVzZU1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tpXTsNCiAgICAgICAgICAgICAgICBpZiAoYm9hcmRbdG8ucl1bdG8uY10pIHsNCiAgICAgICAgICAgICAgICAgICAgY2FwdHVyZXMucHVzaChlbmNvZGVNb3ZlRnJvbUNvb3JkcyhyLCBjLCB0by5yLCB0by5jKSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiBjYXB0dXJlczsNCn07DQoNCi8vIOmdmem7mOaQnOe0ou+8mnN0YW5kLXBhdCDnlKjlrozmlbTlvaLlir/or4TkvLDvvJvku4Xlr7nlkIPlrZDlu7bkvLjvvIhRU+KJpDPvvIkNCmNvbnN0IHF1aWVzY2VuY2UgPSAoDQogICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGgsIGJvYXJkSGFzaCA9IDANCikgPT4gew0KICAgIGNvbnN0IHN0YW5kUGF0ID0gc3RhdGljU2VhcmNoRXZhbChiLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRIYXNoKTsNCg0KICAgIGlmIChxc0RlcHRoIDw9IDApIHsNCiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KDQogICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0ID49IGJldGEpIHsNCiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICB9DQogICAgICAgIGlmIChzdGFuZFBhdCA+IGFscGhhKSB7DQogICAgICAgICAgICBhbHBoYSA9IHN0YW5kUGF0Ow0KICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0IDw9IGFscGhhKSB7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoc3RhbmRQYXQgPCBiZXRhKSB7DQogICAgICAgICAgICBiZXRhID0gc3RhbmRQYXQ7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBsZXQgY2FwdHVyZXMgPSBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoKGIsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIGlmIChjYXB0dXJlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KDQogICAgLy8gTVZWLUxWQe+8muWFiOivleWQg+Wkp+WtkA0KICAgIGNhcHR1cmVzLnNvcnQoKGEsIGJNb3ZlKSA9PiB7DQogICAgICAgIGNvbnN0IHNjb3JlQSA9DQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbbW92ZVRvUihhKV1bbW92ZVRvQyhhKV0sIGdhbWVTdGFnZSkgKiAxNiAtDQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbbW92ZUZyb21SKGEpXVttb3ZlRnJvbUMoYSldLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCBzY29yZUIgPQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW21vdmVUb1IoYk1vdmUpXVttb3ZlVG9DKGJNb3ZlKV0sIGdhbWVTdGFnZSkgKiAxNiAtDQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbbW92ZUZyb21SKGJNb3ZlKV1bbW92ZUZyb21DKGJNb3ZlKV0sIGdhbWVTdGFnZSk7DQogICAgICAgIHJldHVybiBzY29yZUIgLSBzY29yZUE7DQogICAgfSk7DQoNCiAgICBsZXQgYmVzdEV2YWwgPSBzdGFuZFBhdDsNCiAgICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOw0KICAgIGNvbnN0IGRlZmVyID0gU0VBUkNIX0RFRkVSX0xFR0FMSVRZOw0KDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjYXB0dXJlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gY2FwdHVyZXNbaV07DQogICAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYlttb3ZlRnJvbVIobW92ZSldW21vdmVGcm9tQyhtb3ZlKV07DQogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZVNlYXJjaE1vdmUoYiwgbW92ZSk7DQogICAgICAgIGlmIChkZWZlciAmJiBsZWF2ZXNPd25LaW5nVW5zYWZlKGIsIGN1cnJlbnRQbGF5ZXIpKSB7DQogICAgICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCiAgICAgICAgICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkKys7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgICAgdmVyaWZ5Qm9hcmRIYXNoKGIsIG5leHRIYXNoKTsNCiAgICAgICAgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCsrOw0KICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCByZXN1bHQgPSBxdWllc2NlbmNlKA0KICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLA0KICAgICAgICAgICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGggLSAxLCBuZXh0SGFzaA0KICAgICAgICApOw0KICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCg0KICAgICAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsNCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlVG9PYmplY3QobW92ZSksIC4uLihyZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGFscGhhKSB7DQogICAgICAgICAgICAgICAgYWxwaGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4uKHJlc3VsdC5tb3ZlU2VxdWVuY2UgfHwgW10pXTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmV0YSkgew0KICAgICAgICAgICAgICAgIGJldGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPyBiZXN0TW92ZVNlcXVlbmNlIDogW10gfTsNCn07DQoNCi8vIGFscGhhQmV0Ye+8muivhOS8sOWni+e7iOS7jiBzZWFyY2hJbml0aWF0b3Ig6KeS5bqm77ybVFQgKyBraWxsZXIvaGlzdG9yeSArIOepuuedgOWJquaenSArIExNUiArIFFTDQovLyBib2FyZEhhc2jvvJrlop7ph48gWm9icmlzdCDlsYDpnaLlk4jluIzvvIjkuI3lkKvooYzmo4vmlrnvvInvvJvml6fmqKHlvI/kuIvlj6/kvKAgMA0KY29uc3QgYWxwaGFCZXRhID0gKA0KICAgIGIsIGQsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLA0KICAgIHNlYXJjaERlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gY3VycmVudFBsYXllciwgZ2FtZVN0YWdlID0gJ21pZCcsDQogICAgYWxsb3dOdWxsID0gdHJ1ZSwgYm9hcmRIYXNoID0gMA0KKSA9PiB7DQogICAgY29uc3Qgb3JpZ2luYWxBbHBoYSA9IGFscGhhOw0KICAgIGNvbnN0IG9yaWdpbmFsQmV0YSA9IGJldGE7DQoNCiAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMrKzsNCiAgICBpZiAoIXBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKSBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSA9IDA7DQogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0rKzsNCg0KICAgIC8vIOWPtuiKgueCue+8muWujOaVtOW9ouWKv+ivhOS8sCArIOWQg+WtkOmdmem7mOaQnOe0ou+8iFFT4omkM++8iQ0KICAgIGlmIChkID09PSAwKSB7DQogICAgICAgIHJldHVybiBxdWllc2NlbmNlKA0KICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgMywgYm9hcmRIYXNoDQogICAgICAgICk7DQogICAgfQ0KDQogICAgLy8g572u5o2i6KGo5o6i5rWL77yIa2V5IOWQq+ihjOaji+aWue+8jOmBv+WFjeWQjOW9ouS4jeWQjOi1sOaWueWGsueqge+8iQ0KICAgIGNvbnN0IHR0S2V5ID0gbWFrZVNlYXJjaFRUS2V5KGIsIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSGFzaCk7DQogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZSh0dEtleSk7DQogICAgbGV0IHR0TW92ZSA9IG51bGw7DQogICAgaWYgKHR0RW50cnkpIHsNCiAgICAgICAgdHRNb3ZlID0gdHRFbnRyeS5iZXN0TW92ZSB8fCBudWxsOw0KICAgICAgICBpZiAodHRFbnRyeS5kZXB0aCA+PSBkKSB7DQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnZXhhY3QnKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHR0RW50cnkudmFsdWUsDQogICAgICAgICAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRQ0KICAgICAgICAgICAgICAgICAgICAgICAgPyAodHRFbnRyeS5tb3ZlU2VxdWVuY2UgfHwgKHR0TW92ZSA/IFttb3ZlVG9PYmplY3QodHRNb3ZlKV0gOiBbXSkpDQogICAgICAgICAgICAgICAgICAgICAgICA6IFtdDQogICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICdsb3dlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlID49IGJldGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ3VwcGVyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdHRFbnRyeS52YWx1ZSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3Qgc2VhcmNoSW5mbyA9IHByZXBhcmVTZWFyY2hJbmZvKGIsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIGNvbnN0IGFiUGllY2VzSW5mbyA9IHNlYXJjaEluZm8ucGllY2VzSW5mbzsNCiAgICBjb25zdCBhYkJvYXJkSW5mbyA9IHNlYXJjaEluZm8uYm9hcmRJbmZvOw0KICAgIGNvbnN0IGN1cnJlbnRQbGF5ZXJDb2xvciA9IGN1cnJlbnRQbGF5ZXI7DQogICAgY29uc3QgaW5DaGVjayA9IHNlYXJjaEluZm8uaW5DaGVjayB8fA0KICAgICAgICAgICAgICAgICAgICAoY3VycmVudFBsYXllckNvbG9yID09PSAncmVkJyAmJiBhYkJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8DQogICAgICAgICAgICAgICAgICAgIChjdXJyZW50UGxheWVyQ29sb3IgPT09ICdibGFjaycgJiYgYWJCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOw0KDQogICAgY29uc3QgdGVybWluYWxTY29yZSA9IChtYXRlSW5DaGVjaykgPT4gew0KICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGN1cnJlbnRQbGF5ZXJDb2xvciAhPT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7DQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgICB2YWx1ZTogYmFzZVNjb3JlICsgKGlzSW5pdGlhdG9yV2lubmVyID8gZCA6IChzZWFyY2hEZXB0aCAtIGQpKSwNCiAgICAgICAgICAgIG1vdmVTZXF1ZW5jZTogW10sDQogICAgICAgICAgICB0ZXJtaW5hbDogbWF0ZUluQ2hlY2sgPyAnY2hlY2ttYXRlJyA6ICdzdGFsZW1hdGUnDQogICAgICAgIH07DQogICAgfTsNCg0KICAgIC8vIOaXoOS8quWQiOazleedgO+8muebtOaOpee7iOWxgO+8iOaegeWwkeinge+8m+mAmuW4uOiHs+WwkeacieWwhueahOi1sOWKqO+8iQ0KICAgIGlmICghc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0IHx8IHNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdC5sZW5ndGggPT09IDApIHsNCiAgICAgICAgY29uc3QgZ2FtZVN0YXRlID0gYWJCb2FyZEluZm8uZ2FtZVN0YXRlOw0KICAgICAgICBpZiAoZ2FtZVN0YXRlICYmIChnYW1lU3RhdGUuc3RhdHVzID09PSAnY2hlY2ttYXRlJyB8fCBnYW1lU3RhdGUuc3RhdHVzID09PSAnc3RhbGVtYXRlJykpIHsNCiAgICAgICAgICAgIGNvbnN0IGlzSW5pdGlhdG9yV2lubmVyID0gZ2FtZVN0YXRlLndpbm5lciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICAgICAgY29uc3QgYmFzZVNjb3JlID0gaXNJbml0aWF0b3JXaW5uZXIgPyAxMDAwMDAgOiAtMTAwMDAwOw0KICAgICAgICAgICAgY29uc3Qgc3RlcHNGcm9tUm9vdCA9IHNlYXJjaERlcHRoIC0gZDsNCiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogc3RlcHNGcm9tUm9vdCksIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gdGVybWluYWxTY29yZShpbkNoZWNrKTsNCiAgICB9DQoNCiAgICAvLyDnqbrnnYDliarmnp3vvJrku4UgbWF4aW1pemluZ++8m+WujOaVtOivhOS8sOS4i+S/neWuiOWQr+eUqA0KICAgIGlmICgNCiAgICAgICAgU0VBUkNIX0VOQUJMRV9OTVAgJiYNCiAgICAgICAgYWxsb3dOdWxsICYmDQogICAgICAgIG1heGltaXppbmcgJiYNCiAgICAgICAgZCA+PSAzICYmDQogICAgICAgICFpbkNoZWNrICYmDQogICAgICAgIGNhbkRvTnVsbE1vdmUoYiwgY3VycmVudFBsYXllckNvbG9yKQ0KICAgICkgew0KICAgICAgICBjb25zdCBudWxsUiA9IGQgPj0gNiA/IDMgOiAyOw0KICAgICAgICBjb25zdCBudWxsRGVwdGggPSBkIC0gMSAtIG51bGxSOw0KICAgICAgICBpZiAobnVsbERlcHRoID49IDApIHsNCiAgICAgICAgICAgIGNvbnN0IG51bGxQbGF5ZXIgPSBjdXJyZW50UGxheWVyQ29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICAgICAgY29uc3QgbnVsbE1heGltaXppbmcgPSBudWxsUGxheWVyID09PSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgICAgICAvLyDnqbrnnYDkuI3mlLnlj5jlsYDpnaLlk4jluIzvvIzku4XooYzmo4vmlrnlj5jljJbvvIhUVCBrZXkg5ZCrIHNpZGXvvIkNCiAgICAgICAgICAgIGNvbnN0IG51bGxSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgYiwgbnVsbERlcHRoLCBiZXRhIC0gMWUtNiwgYmV0YSwgbnVsbE1heGltaXppbmcsIG51bGxQbGF5ZXIsDQogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBmYWxzZSwgYm9hcmRIYXNoDQogICAgICAgICAgICApOw0KICAgICAgICAgICAgaWYgKG51bGxSZXN1bHQudmFsdWUgPj0gYmV0YSkgew0KICAgICAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBudWxsUmVzdWx0LnZhbHVlLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBsZXQgbW92ZXMgPSBzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3Q7DQoNCiAgICBpZiAoIXBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSkgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdID0gMDsNCiAgICBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0gKz0gbW92ZXMubGVuZ3RoOw0KDQogICAgY29uc3Qga2lsbGVyc0F0RGVwdGggPSAoa2lsbGVyTW92ZXNbZF0gfHwgW251bGwsIG51bGxdKTsNCiAgICBtb3ZlcyA9IHNvcnRNb3Zlc0Zhc3QobW92ZXMsIGIsIGN1cnJlbnRQbGF5ZXJDb2xvciwgYWJQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGFiQm9hcmRJbmZvLCB7DQogICAgICAgIHR0TW92ZSwNCiAgICAgICAga2lsbGVyczoga2lsbGVyc0F0RGVwdGgNCiAgICB9KTsNCg0KICAgIGNvbnN0IHN0b3JlVFQgPSAodmFsdWUsIGJlc3RNb3ZlLCBtb3ZlU2VxdWVuY2UpID0+IHsNCiAgICAgICAgbGV0IGZsYWc7DQogICAgICAgIGlmICh2YWx1ZSA8PSBvcmlnaW5hbEFscGhhKSBmbGFnID0gJ3VwcGVyYm91bmQnOw0KICAgICAgICBlbHNlIGlmICh2YWx1ZSA+PSBvcmlnaW5hbEJldGEpIGZsYWcgPSAnbG93ZXJib3VuZCc7DQogICAgICAgIGVsc2UgZmxhZyA9ICdleGFjdCc7DQogICAgICAgIHRyYW5zcG9zaXRpb25UYWJsZS5zdG9yZSh0dEtleSwgZCwgdmFsdWUsIGZsYWcsIGJlc3RNb3ZlLCBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFID8gbW92ZVNlcXVlbmNlIDogbnVsbCk7DQogICAgfTsNCg0KICAgIGxldCBiZXN0RXZhbCA9IG1heGltaXppbmcgPyAtSW5maW5pdHkgOiBJbmZpbml0eTsNCiAgICBsZXQgYmVzdE1vdmUgPSBudWxsOw0KICAgIGxldCBiZXN0TW92ZVNlcXVlbmNlID0gW107DQogICAgbGV0IGxlZ2FsTW92ZXNGb3VuZCA9IDA7DQoNCiAgICBmb3IgKGxldCBtb3ZlSW5kZXggPSAwOyBtb3ZlSW5kZXggPCBtb3Zlcy5sZW5ndGg7IG1vdmVJbmRleCsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1ttb3ZlSW5kZXhdOw0KICAgICAgICBjb25zdCBpc0NhcHR1cmUgPSAhIWJbbW92ZVRvUihtb3ZlKV1bbW92ZVRvQyhtb3ZlKV07DQogICAgICAgIGNvbnN0IGlzVFRNb3ZlID0gdHRNb3ZlICYmIGlzU2FtZU1vdmUobW92ZSwgdHRNb3ZlKTsNCiAgICAgICAgY29uc3QgaXNLaWxsZXIgPQ0KICAgICAgICAgICAgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzQXREZXB0aFswXSkgfHwNCiAgICAgICAgICAgIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc0F0RGVwdGhbMV0pOw0KDQogICAgICAgIC8vIExNUu+8mumdoOWQjueahOWuiemdmeedgOazlemZjea3sSAx77yI5a6M5pW06K+E5Lyw5LiL5L+d5a6I77yJDQogICAgICAgIC8vIG1vdmVJbmRleCDlkKvkvKrlkIjms5Xluo/vvJvpnZ7ms5XnnYDot7Pov4flkI7nlaXlgY/kv53lrojvvIjlsJHpmY3mt7HvvInvvIzkuI3lvbHlk43mraPnoa7mgKcNCiAgICAgICAgbGV0IHJlZHVjdGlvbiA9IDA7DQogICAgICAgIGlmICgNCiAgICAgICAgICAgIFNFQVJDSF9FTkFCTEVfTE1SICYmDQogICAgICAgICAgICBkID49IDQgJiYNCiAgICAgICAgICAgIG1vdmVJbmRleCA+PSA0ICYmDQogICAgICAgICAgICAhaW5DaGVjayAmJg0KICAgICAgICAgICAgIWlzQ2FwdHVyZSAmJg0KICAgICAgICAgICAgIWlzVFRNb3ZlICYmDQogICAgICAgICAgICAhaXNLaWxsZXINCiAgICAgICAgKSB7DQogICAgICAgICAgICByZWR1Y3Rpb24gPSAxOw0KICAgICAgICB9DQoNCiAgICAgICAgY29uc3QgbW92aW5nUGllY2UgPSBiW21vdmVGcm9tUihtb3ZlKV1bbW92ZUZyb21DKG1vdmUpXTsNCiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlU2VhcmNoTW92ZShiLCBtb3ZlKTsNCiAgICAgICAgaWYgKFNFQVJDSF9ERUZFUl9MRUdBTElUWSAmJiBsZWF2ZXNPd25LaW5nVW5zYWZlKGIsIGN1cnJlbnRQbGF5ZXJDb2xvcikpIHsNCiAgICAgICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOw0KICAgICAgICAgICAgcGVyZlN0YXRzLmlsbGVnYWxNb3Zlc1NraXBwZWQrKzsNCiAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICB9DQogICAgICAgIGNvbnN0IG5leHRIYXNoID0gY2hpbGRCb2FyZEhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOw0KICAgICAgICB2ZXJpZnlCb2FyZEhhc2goYiwgbmV4dEhhc2gpOw0KICAgICAgICBsZWdhbE1vdmVzRm91bmQrKzsNCiAgICAgICAgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCsrOw0KDQogICAgICAgIGNvbnN0IG5leHRQbGF5ZXIgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgY29uc3QgbmV4dE1heGltaXppbmcgPSBuZXh0UGxheWVyID09PSBzZWFyY2hJbml0aWF0b3I7DQoNCiAgICAgICAgbGV0IHJlc3VsdDsNCiAgICAgICAgaWYgKHJlZHVjdGlvbiA+IDApIHsNCiAgICAgICAgICAgIGNvbnN0IHJlZHVjZWREZXB0aCA9IE1hdGgubWF4KDAsIGQgLSAxIC0gcmVkdWN0aW9uKTsNCiAgICAgICAgICAgIHJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgICBiLCByZWR1Y2VkRGVwdGgsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHRydWUsIG5leHRIYXNoDQogICAgICAgICAgICApOw0KICAgICAgICAgICAgY29uc3QgbmVlZFJlc2VhcmNoID0gbWF4aW1pemluZw0KICAgICAgICAgICAgICAgID8gcmVzdWx0LnZhbHVlID4gYWxwaGENCiAgICAgICAgICAgICAgICA6IHJlc3VsdC52YWx1ZSA8IGJldGE7DQogICAgICAgICAgICBpZiAobmVlZFJlc2VhcmNoKSB7DQogICAgICAgICAgICAgICAgcmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgICAgICAgICBiLCBkIC0gMSwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLA0KICAgICAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHRydWUsIG5leHRIYXNoDQogICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIHJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgICBiLCBkIC0gMSwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLA0KICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgdHJ1ZSwgbmV4dEhhc2gNCiAgICAgICAgICAgICk7DQogICAgICAgIH0NCg0KICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCg0KICAgICAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOw0KICAgICAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFKSB7DQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZVRvT2JqZWN0KG1vdmUpLCAuLi5yZXN1bHQubW92ZVNlcXVlbmNlXTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBhbHBoYSA9IE1hdGgubWF4KGFscGhhLCByZXN1bHQudmFsdWUpOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA8IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOw0KICAgICAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFKSB7DQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2VxdWVuY2UgPSBbbW92ZVRvT2JqZWN0KG1vdmUpLCAuLi5yZXN1bHQubW92ZVNlcXVlbmNlXTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBiZXRhID0gTWF0aC5taW4oYmV0YSwgcmVzdWx0LnZhbHVlKTsNCiAgICAgICAgfQ0KDQogICAgICAgIGlmIChiZXRhIDw9IGFscGhhKSB7DQogICAgICAgICAgICBpZiAoIXBlcmZTdGF0cy5jdXRvZmZzW2RdKSBwZXJmU3RhdHMuY3V0b2Zmc1tkXSA9IDA7DQogICAgICAgICAgICBwZXJmU3RhdHMuY3V0b2Zmc1tkXSsrOw0KICAgICAgICAgICAgaWYgKCFpc0NhcHR1cmUpIHsNCiAgICAgICAgICAgICAgICBzdG9yZUtpbGxlck1vdmUoZCwgbW92ZSk7DQogICAgICAgICAgICAgICAgYWRkSGlzdG9yeVNjb3JlKG1vdmUsIGQpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICAvLyDlu7bov5/lkIjms5XmgKfvvJrkvKrlkIjms5XpnZ7nqbrkvYbml6DkuIDlkIjms5Ug4oaSIOWwhuatuy/lm7Dmr5kNCiAgICBpZiAoU0VBUkNIX0RFRkVSX0xFR0FMSVRZICYmIGxlZ2FsTW92ZXNGb3VuZCA9PT0gMCkgew0KICAgICAgICByZXR1cm4gdGVybWluYWxTY29yZShpbkNoZWNrKTsNCiAgICB9DQoNCiAgICBzdG9yZVRUKGJlc3RFdmFsLCBiZXN0TW92ZSwgYmVzdE1vdmVTZXF1ZW5jZSk7DQogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPyBiZXN0TW92ZVNlcXVlbmNlIDogW10gfTsNCn07DQoNCi8vIGV4YWN0Um9vdFNjb3JlczogdHJ1ZT1BbmFseXNpcyDlhajmoLnnsr7noa7liIbvvJtmYWxzZT3lr7nlvIjmoIflh4YgUFZT77yIZmFpbC1sb3cg5LiN5Zue5pCc77yJDQpjb25zdCBnZXRCZXN0TW92ZSA9IChib2FyZCwgdHVybiwgZGVwdGggPSA2LCBwbHkgPSAwLCBlbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzID0gZmFsc2UsIGNvbGxlY3RNb3ZlU2VxdWVuY2VPdmVycmlkZSA9IG51bGwpID0+IHsNCiAgY29uc3QgdGltZUxpbWl0ID0gNTAwMDsNCg0KICAvLyBGaXJzdCB0cnkgdG8gZ2V0IG1vdmUgZnJvbSBvcGVuaW5nIGJvb2sNCiAgY29uc3QgYm9va01vdmUgPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShib2FyZCwgcGx5KTsNCiAgDQogIGlmIChib29rTW92ZSkgew0KICAgIC8vIENoZWNrIGlmIGJvb2tNb3ZlIGlzIHZhbGlkIGZvciBjdXJyZW50IGJvYXJkDQogICAgaWYgKGJvb2tNb3ZlLmZyb20gJiYgYm9va01vdmUudG8gJiYgDQogICAgICAgIHR5cGVvZiBib29rTW92ZS5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBib29rTW92ZS5mcm9tLmMgPT09ICdudW1iZXInICYmDQogICAgICAgIHR5cGVvZiBib29rTW92ZS50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUudG8uYyA9PT0gJ251bWJlcicpIHsNCiAgICAgIA0KICAgICAgY29uc3QgbW92aW5nUGllY2UgPSBib2FyZFtib29rTW92ZS5mcm9tLnJdW2Jvb2tNb3ZlLmZyb20uY107DQogICAgICANCiAgICAgIGlmIChtb3ZpbmdQaWVjZSAmJiBtb3ZpbmdQaWVjZS5jb2xvciA9PT0gdHVybikgew0KICAgICAgICAvLyBWZXJpZnkgbW92ZSBpcyB2YWxpZA0KICAgICAgICBjb25zdCB2YWxpZERlc3RpbmF0aW9ucyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIGJvb2tNb3ZlLmZyb20pOw0KICAgICAgICBjb25zdCBpc1ZhbGlkID0gdmFsaWREZXN0aW5hdGlvbnMuc29tZShkZXN0ID0+IGRlc3QuciA9PT0gYm9va01vdmUudG8uciAmJiBkZXN0LmMgPT09IGJvb2tNb3ZlLnRvLmMpOw0KICAgICAgICANCiAgICAgICAgaWYgKGlzVmFsaWQpIHsNCiAgICAgICAgICByZXR1cm4geyBiZXN0TW92ZTogYm9va01vdmUsIHNlY29uZEJlc3RNb3ZlOiBudWxsLCBtb3ZlU2VxdWVuY2U6IFtdLCBzZWNvbmRNb3ZlU2VxdWVuY2U6IFtdLCBiZXN0TW92ZVNjb3JlOiAwLCBzZWNvbmRCZXN0TW92ZVNjb3JlOiAwLCBhbGxNb3Zlc1dpdGhTY29yZXM6IFtdIH07DQogICAgICAgIH0NCiAgICAgIH0NCiAgICB9DQogIH0NCg0KICAvLyDmoLnoioLngrnvvJrov63ku6PliqDmt7EgKyBQVlPvvJtUVC9raWxsZXIvaGlzdG9yeSDot6jmt7Hluqbkv53nlZnvvIjku4XlvIDlsYDmuIXnqbrkuIDmrKHvvIkNCiAgcmVzZXRQZXJmU3RhdHMoKTsNCiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTsNCiAgdHJhbnNwb3NpdGlvblRhYmxlLnJlc2V0U3RhdHMoKTsNCiAgdHJhbnNwb3NpdGlvblRhYmxlLmNsZWFyKCk7DQogIGNsZWFyRXZhbENhY2hlKCk7DQogIGNvbnN0IG1heERlcHRoID0gTWF0aC5tYXgoMSwgZGVwdGggfCAwKTsNCiAgcmVzZXRTZWFyY2hIZXVyaXN0aWNzKG1heERlcHRoKTsNCiAgc3luY0dlbmVyYWxQb3NDYWNoZShib2FyZCk7DQogIFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPSB0eXBlb2YgY29sbGVjdE1vdmVTZXF1ZW5jZU92ZXJyaWRlID09PSAnYm9vbGVhbicNCiAgICA/IGNvbGxlY3RNb3ZlU2VxdWVuY2VPdmVycmlkZQ0KICAgIDogISFleGFjdFJvb3RTY29yZXM7DQoNCiAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoKTsNCiAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQoNCiAgY29uc3Qgcm9vdEV2YWxSZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGJvYXJkLCB0dXJuLCBnYW1lU3RhZ2UpOw0KICBjb25zdCByb290UGllY2VzSW5mbyA9IHJvb3RFdmFsUmVzdWx0LnBpZWNlc0luZm87DQogIGNvbnN0IHJvb3RCb2FyZEluZm8gPSByb290RXZhbFJlc3VsdC5ib2FyZEluZm87DQoNCiAgLy8g5pS26ZuG5qC56IqC54K56LWw5rOV77yI5Y+q5YGa5LiA5qyh77yJ77yb5pyq6KKr5bCG5pe26L+H5ruk6YCB5ZCDDQogIGxldCByb290TW92ZXMgPSBbXTsNCiAgY29uc3Qgcm9vdEluQ2hlY2sgPSAodHVybiA9PT0gJ3JlZCcgJiYgcm9vdEJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8DQogICAgICAgICAgICAgICAgICAgICAgKHR1cm4gPT09ICdibGFjaycgJiYgcm9vdEJvYXJkSW5mby5ibGFja0lzSW5DaGVjayk7DQoNCiAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgaWYgKGJvYXJkW3JdW2NdPy5jb2xvciA9PT0gdHVybikgew0KICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICBjb25zdCB2YWxpZERlc3RpbmF0aW9ucyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIHsgciwgYyB9KTsNCiAgICAgICAgdmFsaWREZXN0aW5hdGlvbnMuZm9yRWFjaCh0byA9PiB7DQogICAgICAgICAgY29uc3QgaXNBY2NlcHRhYmxlID0gcm9vdEluQ2hlY2sgfHwgaXNQb3NpdGlvbkFjY2VwdGFibGUoYm9hcmQsIHsgciwgYyB9LCB0bywgdHVybiwgcm9vdEJvYXJkSW5mbywgcm9vdFBpZWNlc0luZm8sIHBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgIGlmIChpc0FjY2VwdGFibGUpIHsNCiAgICAgICAgICAgIHJvb3RNb3Zlcy5wdXNoKHsgZnJvbTogeyByLCBjIH0sIHRvLCBzY29yZTogMCwgbW92ZVNlcXVlbmNlOiBbXSB9KTsNCiAgICAgICAgICB9DQogICAgICAgIH0pOw0KICAgICAgfQ0KICAgIH0NCiAgfQ0KDQogIGlmIChyb290TW92ZXMubGVuZ3RoID09PSAwKSB7DQogICAgcmV0dXJuIHsNCiAgICAgIGJlc3RNb3ZlOiBudWxsLA0KICAgICAgc2Vjb25kQmVzdE1vdmU6IG51bGwsDQogICAgICBtb3ZlU2VxdWVuY2U6IFtdLA0KICAgICAgc2Vjb25kTW92ZVNlcXVlbmNlOiBbXSwNCiAgICAgIGJlc3RNb3ZlU2NvcmU6IDAsDQogICAgICBzZWNvbmRCZXN0TW92ZVNjb3JlOiAwLA0KICAgICAgYWxsTW92ZXNXaXRoU2NvcmVzOiBbXQ0KICAgIH07DQogIH0NCg0KICBjb25zdCBzb3J0Um9vdE1vdmVzQnlTY29yZSA9IChtb3ZlcykgPT4gew0KICAgIG1vdmVzLnNvcnQoKGEsIGIpID0+IHsNCiAgICAgIGNvbnN0IHNjb3JlRGlmZiA9IGIuc2NvcmUgLSBhLnNjb3JlOw0KICAgICAgaWYgKE1hdGguYWJzKHNjb3JlRGlmZikgPCAxZS02KSB7DQogICAgICAgIGlmIChhLnNjb3JlID4gMCkgew0KICAgICAgICAgIHJldHVybiAoYS5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKSAtIChiLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApOw0KICAgICAgICB9DQogICAgICAgIGlmIChhLnNjb3JlIDwgMCkgew0KICAgICAgICAgIHJldHVybiAoYi5tb3ZlU2VxdWVuY2U/Lmxlbmd0aCB8fCAwKSAtIChhLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiAwOw0KICAgICAgfQ0KICAgICAgcmV0dXJuIHNjb3JlRGlmZjsNCiAgICB9KTsNCiAgfTsNCg0KICBjb25zdCBwcm9tb3RlUm9vdE1vdmUgPSAobW92ZXMsIHByZWZlcnJlZCkgPT4gew0KICAgIGlmICghcHJlZmVycmVkKSByZXR1cm47DQogICAgY29uc3QgaWR4ID0gbW92ZXMuZmluZEluZGV4KChtKSA9PiBpc1NhbWVNb3ZlKG0sIHByZWZlcnJlZCkpOw0KICAgIGlmIChpZHggPiAwKSB7DQogICAgICBjb25zdCBbaGl0XSA9IG1vdmVzLnNwbGljZShpZHgsIDEpOw0KICAgICAgbW92ZXMudW5zaGlmdChoaXQpOw0KICAgIH0NCiAgfTsNCg0KICBjb25zdCB3b3JrQm9hcmQgPSBib2FyZC5tYXAoKHJvdykgPT4gWy4uLnJvd10pOwogIGFjdGl2ZVNlYXJjaFBpZWNlU3RhdGUgPSBTRUFSQ0hfUElFQ0VfTElTVCA/IGNyZWF0ZVNlYXJjaFBpZWNlU3RhdGUod29ya0JvYXJkKSA6IG51bGw7CiAgY29uc3QgTlVMTF9XSU5ET1dfRVBTID0gMWUtNjsNCiAgY29uc3QgbmV4dFR1cm4gPSB0dXJuID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgLy8g5qC55bGA6Z2i5ZOI5biM5Y+q566X5LiA5qyh77yb5aKe6YeP5qih5byP5pW05qO15pCc57Si5qCR55Sx5q2k5rS+55SfDQogIGNvbnN0IHJvb3RIYXNoID0gem9icmlzdEhhc2hlci5oYXNoKGJvYXJkKTsNCiAgcGVyZlN0YXRzLmZ1bGxIYXNoQ291bnQrKzsNCiAgY29uc3Qgcm9vdFRUS2V5ID0gU0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1QNCiAgICA/IHpvYnJpc3RIYXNoZXIudHRLZXlGcm9tSGFzaChyb290SGFzaCwgdHVybikNCiAgICA6IGAke3Jvb3RIYXNofToke3R1cm59YDsNCg0KICBjb25zb2xlLmxvZygNCiAgICBgU3RhcnRpbmcgaXRlcmF0aXZlIGRlZXBlbmluZyB8IHR1cm46ICR7dHVybn0sIG1heERlcHRoOiAke21heERlcHRofSwgaW5jclpvYnJpc3Q6ICR7U0VBUkNIX0lOQ1JFTUVOVEFMX1pPQlJJU1R9LCBsZWFmQXR0YWNrQml0czogJHtTRUFSQ0hfTEVBRl9BVFRBQ0tfQklUU30sIHJlbGF0aW9uTWFza3M6ICR7U0VBUkNIX1JFTEFUSU9OX01BU0tTfSwgY29sbGVjdE1vdmVTZXF1ZW5jZTogJHtTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFfSwgdGltZUxpbWl0OiAke3RpbWVMaW1pdH1tcywgZW5hYmxlVGltZUxpbWl0OiAke2VuYWJsZVRpbWVMaW1pdH1gDQogICk7DQoNCiAgbGV0IGNvbXBsZXRlZERlcHRoID0gMDsNCg0KICBmb3IgKGxldCBjdXJyZW50RGVwdGggPSAxOyBjdXJyZW50RGVwdGggPD0gbWF4RGVwdGg7IGN1cnJlbnREZXB0aCsrKSB7DQogICAgaWYgKGVuYWJsZVRpbWVMaW1pdCAmJiBjb21wbGV0ZWREZXB0aCA+IDAgJiYgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA+IHRpbWVMaW1pdCkgew0KICAgICAgY29uc29sZS5sb2coYElEIHN0b3BwZWQgYmVmb3JlIGRlcHRoICR7Y3VycmVudERlcHRofSBkdWUgdG8gdGltZSBsaW1pdCAobGFzdCBjb21wbGV0ZWQ9JHtjb21wbGV0ZWREZXB0aH0pYCk7DQogICAgICBicmVhazsNCiAgICB9DQoNCiAgICAvLyDmtYXlsYLmnIDkvbPnnYAgKyBUVCDnnYDmjpLliLDmnIDliY3vvIzkvpvmnKzlsYIgUFZTIOesrOS4gOedgOWFqOeql+S9v+eUqA0KICAgIGNvbnN0IHR0RW50cnkgPSB0cmFuc3Bvc2l0aW9uVGFibGUucmV0cmlldmUocm9vdFRUS2V5KTsNCiAgICBjb25zdCB0dE1vdmUgPSB0dEVudHJ5ICYmIHR0RW50cnkuYmVzdE1vdmUgPyB0dEVudHJ5LmJlc3RNb3ZlIDogbnVsbDsNCiAgICBjb25zdCBwcmV2QmVzdCA9IHJvb3RNb3Zlc1swXTsNCiAgICBzb3J0TW92ZXNGYXN0KHJvb3RNb3ZlcywgYm9hcmQsIHR1cm4sIHJvb3RQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIHJvb3RCb2FyZEluZm8sIHsNCiAgICAgIHR0TW92ZSwNCiAgICAgIGtpbGxlcnM6IGtpbGxlck1vdmVzW01hdGgubWF4KDAsIGN1cnJlbnREZXB0aCAtIDEpXSB8fCBbbnVsbCwgbnVsbF0NCiAgICB9KTsNCiAgICAvLyDkuIrkuIDlsYLmnIDkvbPnnYDmlL7nrKzkuIDvvIjmnIDlkI4gcHJvbW90Ze+8ie+8jOS/neivgeacrOWxgiBQVlMg6aaW552A5YWo56qX5ZG95Lit54Ot6Lev5b6EDQogICAgcHJvbW90ZVJvb3RNb3ZlKHJvb3RNb3ZlcywgdHRNb3ZlKTsNCiAgICBwcm9tb3RlUm9vdE1vdmUocm9vdE1vdmVzLCBwcmV2QmVzdCk7DQoNCiAgICBjb25zdCB1c2VFeGFjdFJvb3QgPSBleGFjdFJvb3RTY29yZXMgJiYgY3VycmVudERlcHRoID09PSBtYXhEZXB0aDsNCiAgICBsZXQgcm9vdEFscGhhID0gLUluZmluaXR5Ow0KDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCByb290TW92ZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgIGNvbnN0IGl0ZW0gPSByb290TW92ZXNbaV07DQogICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IHdvcmtCb2FyZFtpdGVtLmZyb20ucl1baXRlbS5mcm9tLmNdOw0KICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlTW92ZSh3b3JrQm9hcmQsIGl0ZW0uZnJvbSwgaXRlbS50byk7DQogICAgICBjb25zdCBjaGlsZEhhc2ggPSBjaGlsZEJvYXJkSGFzaChyb290SGFzaCwgaXRlbSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgIHZlcmlmeUJvYXJkSGFzaCh3b3JrQm9hcmQsIGNoaWxkSGFzaCk7DQoNCiAgICAgIGxldCBhbHBoYUJldGFSZXN1bHQ7DQogICAgICBsZXQgc2NvcmVJc0V4YWN0ID0gdHJ1ZTsNCiAgICAgIGlmIChpID09PSAwIHx8IHJvb3RBbHBoYSA9PT0gLUluZmluaXR5KSB7DQogICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsIC1JbmZpbml0eSwgSW5maW5pdHksDQogICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoDQogICAgICAgICk7DQogICAgICB9IGVsc2Ugew0KICAgICAgICBjb25zdCBwcm9iZSA9IGFscGhhQmV0YSgNCiAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsDQogICAgICAgICAgcm9vdEFscGhhLCByb290QWxwaGEgKyBOVUxMX1dJTkRPV19FUFMsDQogICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoDQogICAgICAgICk7DQogICAgICAgIGlmIChwcm9iZS52YWx1ZSA+IHJvb3RBbHBoYSkgew0KICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwgcm9vdEFscGhhLCBJbmZpbml0eSwNCiAgICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICAgICk7DQogICAgICAgIH0gZWxzZSBpZiAodXNlRXhhY3RSb290KSB7DQogICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LA0KICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoDQogICAgICAgICAgKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAvLyBmYWlsLWxvd++8muaOoua1i+WIhuWPquaYr+S4iueVjO+8jOS4jeiDveW9k+eyvuehruWIhuWGmeWFpe+8iOWQpuWImSBJRCDkuIvlsYLmjpLluo/ooqvmsaHmn5PvvIzmmJPlj43lpI3otbDngq7vvIkNCiAgICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBwcm9iZTsNCiAgICAgICAgICBzY29yZUlzRXhhY3QgPSBmYWxzZTsNCiAgICAgICAgfQ0KICAgICAgfQ0KDQogICAgICB1bm1ha2VNb3ZlKHdvcmtCb2FyZCwgaXRlbS5mcm9tLCBpdGVtLnRvLCBjYXB0dXJlZCk7DQoNCiAgICAgIGlmIChzY29yZUlzRXhhY3QpIHsNCiAgICAgICAgaXRlbS5zY29yZSA9IGFscGhhQmV0YVJlc3VsdC52YWx1ZTsNCiAgICAgICAgaXRlbS5tb3ZlU2VxdWVuY2UgPSBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFDQogICAgICAgICAgPyBbeyBmcm9tOiBpdGVtLmZyb20sIHRvOiBpdGVtLnRvIH0sIC4uLihhbHBoYUJldGFSZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV0NCiAgICAgICAgICA6IFtdOw0KICAgICAgICBpZiAoaXRlbS5zY29yZSA+IHJvb3RBbHBoYSkgew0KICAgICAgICAgIHJvb3RBbHBoYSA9IGl0ZW0uc2NvcmU7DQogICAgICAgIH0NCiAgICAgIH0gZWxzZSBpZiAoaXRlbS5zY29yZSA+IHJvb3RBbHBoYSkgew0KICAgICAgICAvLyDkv53nlZnkuIrkuIDlsYLliIbmlbDvvJvoi6Xku43pq5jkuo7lvZPliY0gzrHvvIjlvILluLjvvInvvIznlaXpmY3ku6XlhY3mjKTmjonnnJ/mnIDkvJgNCiAgICAgICAgaXRlbS5zY29yZSA9IHJvb3RBbHBoYSAtIDFlLTM7DQogICAgICB9DQogICAgfQ0KDQogICAgc29ydFJvb3RNb3Zlc0J5U2NvcmUocm9vdE1vdmVzKTsNCiAgICBjb21wbGV0ZWREZXB0aCA9IGN1cnJlbnREZXB0aDsNCg0KICAgIC8vIOaKiuacrOWxguacgOS9s+edgOWGmeWFpSBUVO+8jOS+m+abtOa3seS4gOWxguagueaOkuW6jw0KICAgIHRyYW5zcG9zaXRpb25UYWJsZS5zdG9yZSgNCiAgICAgIHJvb3RUVEtleSwNCiAgICAgIGN1cnJlbnREZXB0aCwNCiAgICAgIHJvb3RNb3Zlc1swXS5zY29yZSwNCiAgICAgICdleGFjdCcsDQogICAgICByb290TW92ZXNbMF0sDQogICAgICBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFID8gKHJvb3RNb3Zlc1swXS5tb3ZlU2VxdWVuY2UgfHwgW10pIDogbnVsbA0KICAgICk7DQoNCiAgICBjb25zb2xlLmxvZygNCiAgICAgIGBJRCBkZXB0aCAke2N1cnJlbnREZXB0aH0vJHttYXhEZXB0aH0gZG9uZSB8IGJlc3Q9JHtKU09OLnN0cmluZ2lmeShyb290TW92ZXNbMF0uZnJvbSl9LT4ke0pTT04uc3RyaW5naWZ5KHJvb3RNb3Zlc1swXS50byl9IHNjb3JlPSR7cm9vdE1vdmVzWzBdLnNjb3JlfSBlbGFwc2VkPSR7RGF0ZS5ub3coKSAtIHN0YXJ0VGltZX1tc2ANCiAgICApOw0KICB9DQoNCiAgY29uc3QgYmVzdE1vdmUgPSByb290TW92ZXNbMF0gfHwgbnVsbDsNCiAgY29uc3Qgc2Vjb25kQmVzdE1vdmUgPSByb290TW92ZXMubGVuZ3RoID4gMSA/IHJvb3RNb3Zlc1sxXSA6IG51bGw7DQogIGNvbnN0IGJlc3RNb3ZlU2VxdWVuY2UgPSBiZXN0TW92ZSA/IChiZXN0TW92ZS5tb3ZlU2VxdWVuY2UgfHwgW10pIDogW107DQogIGNvbnN0IHNlY29uZE1vdmVTZXF1ZW5jZSA9IHNlY29uZEJlc3RNb3ZlID8gKHNlY29uZEJlc3RNb3ZlLm1vdmVTZXF1ZW5jZSB8fCBbXSkgOiBbXTsNCiAgY29uc3QgYmVzdE1vdmVTY29yZSA9IGJlc3RNb3ZlID8gYmVzdE1vdmUuc2NvcmUgOiAwOw0KICBjb25zdCBzZWNvbmRCZXN0TW92ZVNjb3JlID0gc2Vjb25kQmVzdE1vdmUgPyBzZWNvbmRCZXN0TW92ZS5zY29yZSA6IDA7DQoNCiAgY29uc3QgYWxsTW92ZXNXaXRoU2NvcmVzID0gcm9vdE1vdmVzLm1hcCgobW92ZUluZm8pID0+ICh7DQogICAgbW92ZTogew0KICAgICAgZnJvbTogbW92ZUluZm8uZnJvbSwNCiAgICAgIHRvOiBtb3ZlSW5mby50bw0KICAgIH0sDQogICAgc2NvcmU6IG1vdmVJbmZvLnNjb3JlLA0KICAgIG1vdmVTZXF1ZW5jZTogbW92ZUluZm8ubW92ZVNlcXVlbmNlIHx8IFtdDQogIH0pKTsNCg0KICBjb25zdCByZXN1bHQgPSB7CiAgICBiZXN0TW92ZSwKICAgIHNlY29uZEJlc3RNb3ZlLA0KICAgIG1vdmVTZXF1ZW5jZTogYmVzdE1vdmVTZXF1ZW5jZSwNCiAgICBzZWNvbmRNb3ZlU2VxdWVuY2UsDQogICAgYmVzdE1vdmVTY29yZSwNCiAgICBzZWNvbmRCZXN0TW92ZVNjb3JlLA0KICAgIGFsbE1vdmVzV2l0aFNjb3JlcywNCiAgICBjb21wbGV0ZWREZXB0aAogIH07CiAgYWN0aXZlU2VhcmNoUGllY2VTdGF0ZSA9IG51bGw7CiAgcmV0dXJuIHJlc3VsdDsKfTsKDQovLyAtLS0gV09SS0VSIExJU1RFTkVSICjnu5/kuIDmtojmga/lpITnkIYpIC0tLQ0K';
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

