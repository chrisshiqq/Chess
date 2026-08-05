
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
const encodedWorkerCode = 'LyogZXNsaW50LWRpc2FibGUgbm8tcmVzdHJpY3RlZC1nbG9iYWxzICovDQoNCi8vIOaji+ebmOW4uOmHj+WumuS5iQ0KY29uc3QgUk9XUyA9IDEwOw0KY29uc3QgQ09MUyA9IDk7DQoNCi8vIOaji+WtkOexu+Wei+WumuS5iQ0KY29uc3QgUElFQ0VfVFlQRVMgPSB7DQogICAgR0VORVJBTDogJ2dlbmVyYWwnLA0KICAgIENIQVJJT1Q6ICdjaGFyaW90JywNCiAgICBDQU5OT046ICdjYW5ub24nLA0KICAgIEhPUlNFOiAnaG9yc2UnLA0KICAgIEVMRVBIQU5UOiAnZWxlcGhhbnQnLA0KICAgIEFEVklTT1I6ICdhZHZpc29yJywNCiAgICBTT0xESUVSOiAnc29sZGllcicNCn07DQoNCi8vIOadkOaWmeWAvOadg+mHjemFjee9rg0KY29uc3QgTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGdlbmVyYWw6IDEwMDAwLCAgLy8g5bCGL+W4hQ0KICAgIGNoYXJpb3Q6IDkwMCwgICAgIC8vIOi9pg0KICAgIGNhbm5vbjogew0KICAgICAgICBlYXJseTogNDUwLCAgICAvLyDlvIDlsYDpmLbmrrUNCiAgICAgICAgbWlkOiA0MDAsICAgICAgLy8g5Lit5bGA6Zi25q61DQogICAgICAgIGxhdGU6IDQwMCAgICAgIC8vIOaui+WxgOmYtuautQ0KICAgIH0sICAgICAgICAgICAgICAgIC8vIOeCrg0KICAgIGhvcnNlOiB7DQogICAgICAgIGVhcmx5OiA0MDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDQ1MCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSwgICAgICAgICAgICAgICAgLy8g6amsDQogICAgZWxlcGhhbnQ6IDIwMCwgICAgLy8g6LGhL+ebuA0KICAgIGFkdmlzb3I6IDIwMCwgICAgIC8vIOWjqy/ku5UNCiAgICBzb2xkaWVyOiB7DQogICAgICAgIGVhcmx5OiAxMDAsICAgIC8vIOW8gOWxgOmYtuautQ0KICAgICAgICBtaWQ6IDIwMCwgICAgICAvLyDkuK3lsYDpmLbmrrUNCiAgICAgICAgbGF0ZTogNDUwICAgICAgLy8g5q6L5bGA6Zi25q61DQogICAgfSAgICAgICAgICAgICAgICAgIC8vIOWFtS/ljZINCn07DQoNCi8vIOaji+WtkOS7t+WAvOadg+mHjemFjee9rg0KbGV0IFZBTFVFX1dFSUdIVFMgPSB7DQogICAgLy9tYXRlcmlhbDogMC40LCAgIC8vIOadkOaWmeWAvOadg+mHjQ0KICAgIC8vcG9zaXRpb246IDAuMiwgICAvLyDkvY3nva7lgLzmnYPph40NCiAgICAvL3RocmVhdDogMC4xNSwgICAgLy8g5aiB6IOB5YC85p2D6YeNDQogICAgLy90YWN0aWM6IDAuMSwgICAgIC8vIOaImOacr+WAvOadg+mHjQ0KICAgIC8vc2FmZXR5OiAwLjEsICAgICAvLyDlronlhajlgLzmnYPph40NCiAgICAvL21vYmlsaXR5OiAwLjA1ICAgLy8g5py65Yqo5YC85p2D6YeNDQoNCiAgICBtYXRlcmlhbDogMSwgICAgLy8g5p2Q5paZ5YC85p2D6YeNDQogICAgcG9zaXRpb246IDEsICAgIC8vIOS9jee9ruWAvOadg+mHjQ0KICAgIHRocmVhdDogMSwgICAgIC8vIOWogeiDgeWAvOadg+mHjQ0KICAgIHRhY3RpYzogMSwgICAgICAvLyDmiJjmnK/lgLzmnYPph40NCiAgICBzYWZldHk6IDEsICAgICAgLy8g5a6J5YWo5YC85p2D6YeNDQogICAgbW9iaWxpdHk6IDEgICAgIC8vIOacuuWKqOWAvOadg+mHjQ0KfTsNCg0KLy8g6K+E5Lyw566X5rOV5Y+C5pWw6YWN572uIC0g6ZuG5Lit5a6a5LmJ5omA5pyJ5p2D6YeN57O75pWw5ZKM5Yqg5oiQ5pWw5a2XDQpjb25zdCBFVkFMVUFUSU9OX1BBUkFNRVRFUlMgPSB7DQogICAgLy8g5py65Yqo5YC85Y+C5pWwDQogICAgbW9iaWxpdHk6IHsNCiAgICAgICAgYmFzZU1vdmVWYWx1ZTogMSwgICAgICAvLyDln7rnoYDnp7vliqjku7flgLwNCiAgICB9LA0KICAgIC8vIOWwhuWGm++8muS7heS9nOWwj+mineWFiOaJi+WKoOWIhu+8jOemgeatouaMieWwhi/luIXmnZDmlpnlgLwoMTAwMDAp6K6h5YWl5aiB6IOBL1NFRQ0KICAgIGNoZWNrOiB7DQogICAgICAgIGJvbnVzOiA4MA0KICAgIH0NCn07DQoNCi8vIOS9jee9ruivhOS8sOihqCAtIOWfuuS6juaji+WtkOexu+Wei+WSjOS9jee9rg0KY29uc3QgUE9TSVRJT05fVEFCTEVTID0gew0KICAgIC8vIOWFtS/ljZLkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBzb2xkaWVyOiBbDQogICAgICAgIFswLCA1LCAxMCwgMTUsIDIwLCAxNSwgMTAsIDUsIDBdLA0KICAgICAgICBbNSwgMTUsIDIwLCAyNSwgMjUsIDI1LCAyMCwgMTUsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDI1LCAzMCwgMzAsIDMwLCAyNSwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDI1LCAyNSwgMjUsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbNSwgMCwgNSwgMCwgNSwgMCwgNSwgMCwgNV0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g6L2m5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgY2hhcmlvdDogWw0KICAgICAgICBbNSwgMTAsIDEwLCAxMCwgMTAsIDEwLCAxMCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTUsIDIwLCAyMCwgMjAsIDIwLCAyMCwgMTUsIDEwXSwNCiAgICAgICAgWzEwLCAxNSwgMjAsIDIwLCAyMCwgMjAsIDIwLCAxNSwgMTBdLA0KICAgICAgICBbMTAsIDE1LCAyMCwgMjAsIDIwLCAyMCwgMjAsIDE1LCAxMF0sDQogICAgICAgIFsxMCwgMTIsIDE1LCAxNSwgMTUsIDE1LCAxNSwgMTIsIDEwXSwNCiAgICAgICAgWzEwLCAxMiwgMTUsIDE1LCAxNSwgMTUsIDE1LCAxMiwgMTBdLA0KICAgICAgICBbNSwgMTAsIDgsIDEwLCA1LCAxMCwgOCwgMTAsIDVdLA0KICAgICAgICBbMTAsIDEwLCA1LCAxNSwgMCwgMTUsIDUsIDEwLCAxMF0sDQogICAgICAgIFswLCAxMCwgNSwgNSwgNSwgNSwgMTAsIDUsIDBdDQogICAgXSwNCiAgICAvLyDpqazkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBob3JzZTogWw0KICAgICAgICBbMCwgLTUsIDAsIDAsIDAsIDAsIDAsIC01LCAwXSwNCiAgICAgICAgWzAsIDUsIDI1LCAxMCwgMTAsIDEwLCAyNSwgNSwgMF0sDQogICAgICAgIFs1LCA1LCAyMCwgMjUsIDI1LCAyNSwgMjAsIDUsIDVdLA0KICAgICAgICBbNSwgMjAsIDEwLCAyNSwgMCwgMjUsIDEwLCAyMCwgNV0sDQogICAgICAgIFswLCA1LCAxNSwgMjAsIDIwLCAyMCwgMTUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMjUsIDIwLCAwLCAyMCwgMjUsIDUsIDBdLA0KICAgICAgICBbMCwgNSwgMTAsIDE1LCAxNSwgMTUsIDEwLCA1LCAwXSwNCiAgICAgICAgWzUsIDAsIDUsIDUsIDAsIDUsIDUsIDAsIDVdLA0KICAgICAgICBbMCwgMCwgMCwgNSwgLTIwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDUsIDAsIDUsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDngq7kvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBjYW5ub246IFsNCiAgICAgICAgWzEwLCAyMCwgMTUsIDEwLCAwLCAxMCwgMTUsIDIwLCAxMF0sDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDUsIDUsIDEwLCAxMCwgMTAsIDUsIDUsIDBdLA0KICAgICAgICBbNSwgNSwgMTUsIDUsIDI1LCA1LCAxNSwgNSwgNV0sDQogICAgICAgIFswLCA1LCA1LCA1LCA1LCA1LCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDE1LCA1LCA1LCAxMCwgNSwgNSwgMTUsIDBdLA0KICAgICAgICBbMCwgNSwgNSwgNSwgNSwgNSwgNSwgNSwgMF0sDQogICAgICAgIFsxMCwgMTAsIDE1LCAyMCwgMzAsIDIwLCAxNSwgMTAsIDEwXSwgDQogICAgICAgIFswLCA1LCA1LCAxMCwgMTAsIDEwLCA1LCA1LCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdDQogICAgXSwNCiAgICAvLyDosaHkvY3nva7ooaggKOe6ouaWueinhuinkikNCiAgICBlbGVwaGFudDogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDEwLCAwLCAwLCAwLCAxMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzUsIDAsIDAsIDAsIDIwLCAwLCAwLCAwLCA1XSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMTAsIDAsIDAsIDAsIDEwLCAwLCAwXQ0KICAgIF0sDQogICAgLy8g5aOr5L2N572u6KGoICjnuqLmlrnop4bop5IpDQogICAgYWR2aXNvcjogWw0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLA0KICAgICAgICBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sDQogICAgICAgIFswLCAwLCAwLCA1LCAwLCA1LCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDAsIDEwLCAwLCAwLCAwLCAwXSwNCiAgICAgICAgWzAsIDAsIDAsIDEwLCAwLCAxMCwgMCwgMCwgMF0NCiAgICBdDQp9Ow0KDQovLyDojrflj5bmo4vlrZDnmoTmnZDmlpnlgLwNCmNvbnN0IGdldE1hdGVyaWFsVmFsdWUgPSAocGllY2UsIGdhbWVTdGFnZSA9ICdtaWQnKSA9PiB7DQogICAgbGV0IHZhbHVlID0gTUFURVJJQUxfVkFMVUVTW3BpZWNlLnR5cGVdOw0KICAgIA0KICAgIC8vIOmSiOWvueacieWIhumYtuauteadkOaWmeWAvOeahOWFteenje+8iOWFteOAgeeCruOAgemprO+8ieiwg+aVtOadkOaWmeWAvA0KICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7DQogICAgICAgIHZhbHVlID0gdmFsdWVbZ2FtZVN0YWdlXSB8fCB2YWx1ZS5taWQ7DQogICAgfQ0KICAgIA0KICAgIHJldHVybiB2YWx1ZTsNCn07DQoNCi8vIOiOt+WPluaji+WtkOeahOS9jee9ruWAvA0KY29uc3QgZ2V0UG9zaXRpb25WYWx1ZSA9IChwaWVjZSwgciwgYykgPT4gew0KICAgIGNvbnN0IHRhYmxlID0gUE9TSVRJT05fVEFCTEVTW3BpZWNlLnR5cGVdOw0KICAgIGlmICghdGFibGUpIHJldHVybiAwOw0KICAgIA0KICAgIC8vIOm7keaWuemcgOimgee/u+i9rOS9jee9ruihqA0KICAgIGNvbnN0IHJvd0lkeCA9IHBpZWNlLmNvbG9yID09PSAncmVkJyA/ICg5LSByKSA6IHI7DQogICAgcmV0dXJuIHRhYmxlW3Jvd0lkeF1bY10gfHwgMDsNCn07DQoNCi8vIFNlYXJjaCBsZWF2ZXMgdXNlIG51bWVyaWMgcGllY2UgY29kZXMuIEZsYXR0ZW4gcG9zaXRpb24gdmFsdWVzIG9uY2Ugc28gdGhlDQovLyBob3QgZXZhbHVhdG9yIG5ldmVyIGhhcyB0byBkZXJlZmVyZW5jZSBhIHBpZWNlIG9iamVjdCBvciBhIG5lc3RlZCB0YWJsZS4NCmNvbnN0IFNFQVJDSF9QT1NJVElPTl9WQUxVRVMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAxNiB9LCAoKSA9PiBuZXcgSW50MTZBcnJheSg5MCkpOw0KKCgpID0+IHsNCiAgICBjb25zdCB0eXBlVGFibGVzID0gWw0KICAgICAgICBudWxsLA0KICAgICAgICBudWxsLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuY2hhcmlvdCwNCiAgICAgICAgUE9TSVRJT05fVEFCTEVTLmhvcnNlLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuZWxlcGhhbnQsDQogICAgICAgIFBPU0lUSU9OX1RBQkxFUy5hZHZpc29yLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuY2Fubm9uLA0KICAgICAgICBQT1NJVElPTl9UQUJMRVMuc29sZGllcg0KICAgIF07DQogICAgZm9yIChsZXQgcGllY2VDb2RlID0gMTsgcGllY2VDb2RlIDwgMTY7IHBpZWNlQ29kZSsrKSB7DQogICAgICAgIGNvbnN0IHRhYmxlID0gdHlwZVRhYmxlc1twaWVjZUNvZGUgJiA3XTsNCiAgICAgICAgaWYgKCF0YWJsZSkgY29udGludWU7DQogICAgICAgIGNvbnN0IGlzUmVkID0gcGllY2VDb2RlIDwgODsNCiAgICAgICAgY29uc3QgdmFsdWVzID0gU0VBUkNIX1BPU0lUSU9OX1ZBTFVFU1twaWVjZUNvZGVdOw0KICAgICAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgOTA7IHNxKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHIgPSAoc3EgLyA5KSB8IDA7DQogICAgICAgICAgICB2YWx1ZXNbc3FdID0gdGFibGVbaXNSZWQgPyA5IC0gciA6IHJdW3NxICUgOV0gfHwgMDsNCiAgICAgICAgfQ0KICAgIH0NCn0pKCk7DQoNCi8vIOaUu+WHu+S9jeWbvu+8mjkwIOagvOeUqCAzw5dVaW50MzLjgILmkJzntKLlj7blj6rpnIDjgIzmmK/lkKbmlYzmjqfjgI3vvJvngrnmo4svVUkg5LuN55So5o6n5Yi26ICF5YiX6KGo44CCDQpjb25zdCBBVFRBQ0tfV09SRFMgPSAzOw0KY29uc3Qgc2NyYXRjaFJlZEF0dGFjayA9IG5ldyBVaW50MzJBcnJheShBVFRBQ0tfV09SRFMpOw0KY29uc3Qgc2NyYXRjaEJsYWNrQXR0YWNrID0gbmV3IFVpbnQzMkFycmF5KEFUVEFDS19XT1JEUyk7DQovLyB0cnVlPeaQnOe0ouWPtueUqOaUu+WHu+S9jeWbvu+8iOm7mOiupO+8ie+8m2ZhbHNlPeWPtuivhOS8sOS7jeW7uiAxMMOXOSDmjqfliLbogIXooajvvIhBL0LvvIkNCi8vIHRydWU95YWz57O755So5qC85L2NIFVpbnQzMiDmlLsv5a6IL+aOpyBtYXNr77yI6buY6K6k77yJ77ybZmFsc2U9dGhyZWF0L2d1YXJkIOWvueixoeWIl+ihqO+8iEEvQu+8iQ0KLy8gUGFja2VkIGRlc3RpbmF0aW9ucy9yYXlzIGFuZCBpbmxpbmVkIHJlbGF0aW9uIHdyaXRlcyBmb3Igc2VhcmNoIGxlYXZlcy4NCi8vIEtlcHQgc2VwYXJhdGUgZnJvbSB0aGUgb3JpZ2luYWwgc3BlY2lhbGl6ZWQgcGF0aCBmb3IgYmVuY2htYXJrIHZlcmlmaWNhdGlvbi4NCi8vIOaQnOe0ouacn+mXtOe7tOaKpOe0p+WHkeaji+WtkOihqO+8jOmBv+WFjeWPtuivhOS8sC/nnYDms5Xlh4blpIflj43lpI3miavmj48gMTB4OSDlr7nosaHmo4vnm5jvvIhBL0Ig5Y+v5YWz6Zet77yJDQovLyDpnZnpu5jmkJzntKLlkIPlrZDnlJ/miJDlpI3nlKjmkJzntKLmgIHmo4vlrZDooajvvJvni6znq4vlvIDlhbPnlKjkuo4gQS9C44CCDQovLyDku4Xln7rlh4bor4rmlq3lvIDlkK/vvJrpop3lpJYgcGVyZm9ybWFuY2Uubm93IOS8muW9seWTjee7neWvueiAl+aXtu+8jOato+W8j+WvueW8iOS/neaMgeWFs+mXreOAgg0KbGV0IFNFQVJDSF9QUk9GSUxFID0gZmFsc2U7DQoNCmNvbnN0IGNsZWFyQXR0YWNrQml0cyA9IChiaXRzKSA9PiB7DQogICAgYml0c1swXSA9IDA7DQogICAgYml0c1sxXSA9IDA7DQogICAgYml0c1syXSA9IDA7DQp9Ow0KDQpjb25zdCBzZXRBdHRhY2tCaXQgPSAoYml0cywgc3EpID0+IHsNCiAgICBiaXRzW3NxID4+PiA1XSB8PSAoMSA8PCAoc3EgJiAzMSkpOw0KfTsNCg0KY29uc3QgaGFzQXR0YWNrQml0ID0gKGJpdHMsIHNxKSA9PiAoYml0c1tzcSA+Pj4gNV0gJiAoMSA8PCAoc3EgJiAzMSkpKSAhPT0gMDsNCg0KY29uc3QgbWFrZUVtcHR5Q29udHJvbGxlckdyaWQgPSAoKSA9Pg0KICAgIEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpLm1hcCgoKSA9PiBbXSkpOw0KDQovLyDlhbPns7sgbWFza++8muacgOWkmiAzMiDlrZDvvIjkuK3lm73osaHmo4vmu6Hnm5jvvInvvIxiaXQgaSA9IHBpZWNlc0luZm9baV0NCmNvbnN0IFJFTF9TUVVBUkVTID0gOTA7DQovLyDmoLzlj7cg4oaSIOihjOWIl++8mumBv+WFjeeDrei3r+W+hOWPjeWkjSAoc3EvOSl8MCDkuI4gc3ElOQ0KY29uc3QgU1FfUk9XID0gbmV3IFVpbnQ4QXJyYXkoUkVMX1NRVUFSRVMpOw0KY29uc3QgU1FfQ09MID0gbmV3IFVpbnQ4QXJyYXkoUkVMX1NRVUFSRVMpOw0KZm9yIChsZXQgX19zcSA9IDA7IF9fc3EgPCBSRUxfU1FVQVJFUzsgX19zcSsrKSB7DQogICAgU1FfUk9XW19fc3FdID0gKF9fc3EgLyA5KSB8IDA7DQogICAgU1FfQ09MW19fc3FdID0gX19zcSAlIDk7DQp9DQpjb25zdCBzY3JhdGNoQXR0YWNrTWFzayA9IG5ldyBVaW50MzJBcnJheShSRUxfU1FVQVJFUyk7ICAvLyDmlYzlrZDmiYDlnKjmoLzvvJrosIHlnKjmiZPlroMNCmNvbnN0IHNjcmF0Y2hHdWFyZE1hc2sgPSBuZXcgVWludDMyQXJyYXkoUkVMX1NRVUFSRVMpOyAgIC8vIOWPi+WGm+aJgOWcqOagvO+8muiwgeWcqOS/neWugw0KY29uc3Qgc2NyYXRjaENvbnRyb2xNYXNrID0gbmV3IFVpbnQzMkFycmF5KFJFTF9TUVVBUkVTKTsgLy8g56m65o6n5qC877ya6LCB5o6n5Yi25a6D77yI5a+56b2Q5penIGJvYXJkSW5mb++8iQ0KDQpjb25zdCBjbGVhclJlbGF0aW9uTWFza3MgPSAoY2xlYXJDb250cm9sID0gdHJ1ZSkgPT4gew0KICAgIHNjcmF0Y2hBdHRhY2tNYXNrLmZpbGwoMCk7DQogICAgc2NyYXRjaEd1YXJkTWFzay5maWxsKDApOw0KICAgIGlmIChjbGVhckNvbnRyb2wpIHNjcmF0Y2hDb250cm9sTWFzay5maWxsKDApOw0KfTsNCg0KLy8g5qC85L2NIOKGkiBwaWVjZXNJbmZvIOW8leeUqO+8iOabv+S7o+avj+WPtiBuZXcgTWFw77yJDQpjb25zdCBzY3JhdGNoUGllY2VBdFNxID0gbmV3IEFycmF5KFJFTF9TUVVBUkVTKTsNCmNvbnN0IGNsZWFyUGllY2VBdFNxID0gKCkgPT4gew0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgUkVMX1NRVUFSRVM7IGkrKykgc2NyYXRjaFBpZWNlQXRTcVtpXSA9IG51bGw7DQp9Ow0KDQovLyDlpI3nlKggcmVsQ3R477yM6YG/5YWN5q+P5a2QIG5ldyDlsI/lr7nosaENCmNvbnN0IHNjcmF0Y2hSZWxDdHggPSB7DQogICAgdXNlTWFza3M6IHRydWUsDQogICAgc2tpcENvbnRyb2xNYXNrOiBmYWxzZSwgLy8g5pCc57Si5Y+277ya5LiN5YaZ56m65o6nIGNvbnRyb2xNYXNr77yI5LuN5YaZ5pS75Ye75L2N5Zu+K+acuuWKqO+8iQ0KICAgIHBhbGFjZUNvbnRyb2xPbmx5OiBmYWxzZSwNCiAgICBwaWVjZUluZGV4OiAwLA0KICAgIGF0dGFja01hc2s6IG51bGwsDQogICAgZ3VhcmRNYXNrOiBudWxsLA0KICAgIGNvbnRyb2xNYXNrOiBudWxsLA0KICAgIHJlZEF0dGFjazogbnVsbCwNCiAgICBibGFja0F0dGFjazogbnVsbA0KfTsNCg0KY29uc3QgaXNQYWxhY2VDb250cm9sU3F1YXJlID0gKHNxKSA9PiB7DQogICAgY29uc3QgciA9IChzcSAvIDkpIHwgMDsNCiAgICBjb25zdCBjID0gc3EgJSA5Ow0KICAgIHJldHVybiBjID49IDMgJiYgYyA8PSA1ICYmIChyIDw9IDIgfHwgciA+PSA3KTsNCn07DQoNCmNvbnN0IHNob3VsZFdyaXRlQ29udHJvbE1hc2sgPSAocmVsQ3R4LCBzcSkgPT4gKA0KICAgICFyZWxDdHguc2tpcENvbnRyb2xNYXNrICYmICghcmVsQ3R4LnBhbGFjZUNvbnRyb2xPbmx5IHx8IGlzUGFsYWNlQ29udHJvbFNxdWFyZShzcSkpDQopOw0KDQpjb25zdCBzY3JhdGNoTGVhZlBpZWNlc0luZm8gPSBbXTsNCmNvbnN0IHNjcmF0Y2hMZWFmUGllY2VTbG90cyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDMyIH0sIChfLCBwaWVjZUluZGV4KSA9PiAoew0KICAgIHBpZWNlOiBudWxsLA0KICAgIHBpZWNlQ29kZTogMCwNCiAgICByOiAwLA0KICAgIGM6IDAsDQogICAgc3E6IDAsDQogICAgcGllY2VJbmRleCwNCiAgICBtb3ZlczogW10sDQogICAgYWxseUd1YXJkczogW10sDQogICAgbWF0ZXJpYWxWYWx1ZTogMCwNCiAgICBwb3NpdGlvblZhbHVlOiAwLA0KICAgIHRocmVhdFZhbHVlOiAwLA0KICAgIHNhZmV0eVZhbHVlOiAwLA0KICAgIHRhY3RpY1ZhbHVlOiAwLA0KICAgIG1vYmlsaXR5VmFsdWU6IDAsDQogICAgdGhyZWF0OiBbXSwNCiAgICB0aHJlYXRlbmVkQnk6IFtdLA0KICAgIGd1YXJkOiBbXSwNCiAgICBndWFyZGVkQnk6IFtdLA0KICAgIGNvbnRyb2w6IFtdLA0KICAgIHByb3RlY3Q6IFtdDQp9KSk7DQoNCmxldCBhY3RpdmVTZWFyY2hQaWVjZVN0YXRlID0gbnVsbDsNCg0KY29uc3Qgc2VhcmNoUGllY2VUeXBlQ29kZSA9ICh0eXBlKSA9PiB7DQogICAgc3dpdGNoICh0eXBlKSB7DQogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuR0VORVJBTDogcmV0dXJuIDE7DQogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuQ0hBUklPVDogcmV0dXJuIDI7DQogICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuSE9SU0U6IHJldHVybiAzOw0KICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkVMRVBIQU5UOiByZXR1cm4gNDsNCiAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5BRFZJU09SOiByZXR1cm4gNTsNCiAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5DQU5OT046IHJldHVybiA2Ow0KICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLlNPTERJRVI6IHJldHVybiA3Ow0KICAgICAgICBkZWZhdWx0OiByZXR1cm4gMDsNCiAgICB9DQp9Ow0KDQpjb25zdCBzZWFyY2hQaWVjZUNvZGUgPSAocGllY2UpID0+IHNlYXJjaFBpZWNlVHlwZUNvZGUocGllY2UudHlwZSkgKyAocGllY2UuY29sb3IgPT09ICdyZWQnID8gMCA6IDgpOw0KDQpjb25zdCBTRUFSQ0hfTUFURVJJQUxfVkFMVUVTID0gew0KICAgIGVhcmx5OiBuZXcgSW50MTZBcnJheShbMCwgMTAwMDAsIDkwMCwgNDAwLCAyMDAsIDIwMCwgNDUwLCAxMDBdKSwNCiAgICBtaWQ6IG5ldyBJbnQxNkFycmF5KFswLCAxMDAwMCwgOTAwLCA0NTAsIDIwMCwgMjAwLCA0MDAsIDIwMF0pLA0KICAgIGxhdGU6IG5ldyBJbnQxNkFycmF5KFswLCAxMDAwMCwgOTAwLCA0NTAsIDIwMCwgMjAwLCA0MDAsIDQ1MF0pDQp9Ow0KDQpjb25zdCBzZWFyY2hNYXRlcmlhbFRhYmxlID0gKGdhbWVTdGFnZSkgPT4gU0VBUkNIX01BVEVSSUFMX1ZBTFVFU1tnYW1lU3RhZ2VdIHx8IFNFQVJDSF9NQVRFUklBTF9WQUxVRVMubWlkOwoKLy8gSW5kZXBlbmRlbnQgMzItYml0IHZlcmlmaWVyIGZvciB0aGUgZXZhbCBjYWNoZS4gVGhlIHByaW1hcnkgWm9icmlzdCBoYXNoIGlzCi8vIGFsc28gdXNlZCBieSBUVDsgYSBzZWNvbmQgaW5jcmVtZW50YWxseSBtYWludGFpbmVkIGhhc2ggcHJldmVudHMgYSBwcmltYXJ5Ci8vIGNvbGxpc2lvbiBmcm9tIHJldHVybmluZyBhbm90aGVyIGJvYXJkJ3Mgc3RhdGljIGV2YWx1YXRpb24uCmNvbnN0IEVWQUxfVkVSSUZZX0hBU0hfQllfQ09ERSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDE2IH0sICgpID0+IG5ldyBJbnQzMkFycmF5KFJFTF9TUVVBUkVTKSk7CigoKSA9PiB7CiAgICBsZXQgc2VlZCA9IDB4NmQyYjc5ZjU7CiAgICBjb25zdCBuZXh0ID0gKCkgPT4gewogICAgICAgIHNlZWQgXj0gc2VlZCA8PCAxMzsKICAgICAgICBzZWVkIF49IHNlZWQgPj4+IDE3OwogICAgICAgIHNlZWQgXj0gc2VlZCA8PCA1OwogICAgICAgIHJldHVybiBzZWVkIHwgMDsKICAgIH07CiAgICBmb3IgKGxldCBjb2RlID0gMTsgY29kZSA8IEVWQUxfVkVSSUZZX0hBU0hfQllfQ09ERS5sZW5ndGg7IGNvZGUrKykgewogICAgICAgIGNvbnN0IGJ5U3F1YXJlID0gRVZBTF9WRVJJRllfSEFTSF9CWV9DT0RFW2NvZGVdOwogICAgICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgYnlTcXVhcmVbc3FdID0gbmV4dCgpOwogICAgfQp9KSgpOwoKY29uc3QgY3JlYXRlU2VhcmNoUGllY2VTdGF0ZSA9IChib2FyZCwgZ2FtZVN0YWdlID0gJ21pZCcpID0+IHsKICAgIGNvbnN0IHJlY29yZHMgPSBbXTsNCiAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBuZXcgSW50OEFycmF5KFJFTF9TUVVBUkVTKTsNCiAgICBjb25zdCBzcXVhcmVDb2RlcyA9IG5ldyBVaW50OEFycmF5KFJFTF9TUVVBUkVTKTsNCiAgICBjb25zdCBwaWVjZUNvZGVzID0gbmV3IFVpbnQ4QXJyYXkoMzIpOw0KICAgIGNvbnN0IG1hdGVyaWFsVmFsdWVzID0gc2VhcmNoTWF0ZXJpYWxUYWJsZShnYW1lU3RhZ2UpOw0KICAgIGxldCByZWRNYXRlcmlhbCA9IDA7DQogICAgbGV0IHJlZFBvc2l0aW9uID0gMDsNCiAgICBsZXQgYmxhY2tNYXRlcmlhbCA9IDA7DQogICAgbGV0IGJsYWNrUG9zaXRpb24gPSAwOw0KICAgIGxldCByZWRHZW5lcmFsU3EgPSAtMTsKICAgIGxldCBibGFja0dlbmVyYWxTcSA9IC0xOwogICAgbGV0IGV2YWxWZXJpZmljYXRpb25IYXNoID0gMDsKICAgIHNxdWFyZVRvU2xvdC5maWxsKC0xKTsNCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcGllY2UpIGNvbnRpbnVlOw0KICAgICAgICAgICAgaWYgKHJlY29yZHMubGVuZ3RoID49IDMyKSByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIGNvbnN0IHNsb3QgPSByZWNvcmRzLmxlbmd0aDsNCiAgICAgICAgICAgIHJlY29yZHMucHVzaCh7IHBpZWNlLCByLCBjLCBzcTogciAqIDkgKyBjLCBhbGl2ZTogdHJ1ZSB9KTsNCiAgICAgICAgICAgIGNvbnN0IGNvZGUgPSBzZWFyY2hQaWVjZUNvZGUocGllY2UpOw0KICAgICAgICAgICAgaWYgKChjb2RlICYgNykgPT09IDEpIHsNCiAgICAgICAgICAgICAgICBpZiAoY29kZSA8IDgpIHJlZEdlbmVyYWxTcSA9IHIgKiA5ICsgYzsNCiAgICAgICAgICAgICAgICBlbHNlIGJsYWNrR2VuZXJhbFNxID0gciAqIDkgKyBjOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgcGllY2VDb2Rlc1tzbG90XSA9IGNvZGU7DQogICAgICAgICAgICBzcXVhcmVUb1Nsb3RbciAqIDkgKyBjXSA9IHNsb3Q7DQogICAgICAgICAgICBzcXVhcmVDb2Rlc1tyICogOSArIGNdID0gY29kZTsKICAgICAgICAgICAgZXZhbFZlcmlmaWNhdGlvbkhhc2ggXj0gRVZBTF9WRVJJRllfSEFTSF9CWV9DT0RFW2NvZGVdW3IgKiA5ICsgY107CiAgICAgICAgICAgIGNvbnN0IG1hdGVyaWFsVmFsdWUgPSBtYXRlcmlhbFZhbHVlc1tjb2RlICYgN107DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvblZhbHVlID0gU0VBUkNIX1BPU0lUSU9OX1ZBTFVFU1tjb2RlXVtyICogOSArIGNdOw0KICAgICAgICAgICAgaWYgKGNvZGUgPCA4KSB7DQogICAgICAgICAgICAgICAgcmVkTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgICAgICByZWRQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBibGFja01hdGVyaWFsICs9IG1hdGVyaWFsVmFsdWU7DQogICAgICAgICAgICAgICAgYmxhY2tQb3NpdGlvbiArPSBwb3NpdGlvblZhbHVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiB7DQogICAgICAgIGJvYXJkLA0KICAgICAgICByZWNvcmRzLA0KICAgICAgICBzcXVhcmVUb1Nsb3QsDQogICAgICAgIHNxdWFyZUNvZGVzLA0KICAgICAgICBwaWVjZUNvZGVzLA0KICAgICAgICBtYXRlcmlhbFZhbHVlcywNCiAgICAgICAgcmVkTWF0ZXJpYWwsDQogICAgICAgIHJlZFBvc2l0aW9uLA0KICAgICAgICBibGFja01hdGVyaWFsLA0KICAgICAgICBibGFja1Bvc2l0aW9uLA0KICAgICAgICByZWRHZW5lcmFsU3EsDQogICAgICAgIGJsYWNrR2VuZXJhbFNxLAogICAgICAgIGV2YWxWZXJpZmljYXRpb25IYXNoLAogICAgICAgIG1vdmVyU3RhY2s6IG5ldyBJbnQ4QXJyYXkoMzIpLA0KICAgICAgICBjYXB0dXJlZFN0YWNrOiBuZXcgSW50OEFycmF5KDMyKSwNCiAgICAgICAgc3RhY2tEZXB0aDogMA0KICAgIH07DQp9Ow0KDQpjb25zdCBhY3RpdmVQaWVjZVN0YXRlRm9yID0gKGJvYXJkKSA9PiB7DQogICAgY29uc3Qgc3RhdGUgPSBhY3RpdmVTZWFyY2hQaWVjZVN0YXRlOw0KICAgIHJldHVybiBzdGF0ZSAmJiBzdGF0ZS5ib2FyZCA9PT0gYm9hcmQgPyBzdGF0ZSA6IG51bGw7DQp9Ow0KDQpjb25zdCB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJNYWtlID0gKGJvYXJkLCBmcm9tU3EsIHRvU3EpID0+IHsNCiAgICBjb25zdCBzdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOw0KICAgIGlmICghc3RhdGUpIHJldHVybjsNCiAgICBjb25zdCBtb3ZlclNsb3QgPSBzdGF0ZS5zcXVhcmVUb1Nsb3RbZnJvbVNxXTsNCiAgICBjb25zdCBjYXB0dXJlZFNsb3QgPSBzdGF0ZS5zcXVhcmVUb1Nsb3RbdG9TcV07DQogICAgY29uc3Qgc3RhY2tJbmRleCA9IHN0YXRlLnN0YWNrRGVwdGgrKzsNCiAgICBzdGF0ZS5tb3ZlclN0YWNrW3N0YWNrSW5kZXhdID0gbW92ZXJTbG90Ow0KICAgIHN0YXRlLmNhcHR1cmVkU3RhY2tbc3RhY2tJbmRleF0gPSBjYXB0dXJlZFNsb3Q7DQogICAgaWYgKG1vdmVyU2xvdCA8IDApIHJldHVybjsNCg0KICAgIGNvbnN0IG1vdmVyID0gc3RhdGUucmVjb3Jkc1ttb3ZlclNsb3RdOwogICAgY29uc3QgbW92ZXJDb2RlID0gc3RhdGUucGllY2VDb2Rlc1ttb3ZlclNsb3RdOwogICAgc3RhdGUuZXZhbFZlcmlmaWNhdGlvbkhhc2ggXj0gRVZBTF9WRVJJRllfSEFTSF9CWV9DT0RFW21vdmVyQ29kZV1bZnJvbVNxXSBeCiAgICAgICAgRVZBTF9WRVJJRllfSEFTSF9CWV9DT0RFW21vdmVyQ29kZV1bdG9TcV07CiAgICBjb25zdCBtb3ZlclBvc2l0aW9uRGVsdGEgPSBTRUFSQ0hfUE9TSVRJT05fVkFMVUVTW21vdmVyQ29kZV1bdG9TcV0gLQ0KICAgICAgICBTRUFSQ0hfUE9TSVRJT05fVkFMVUVTW21vdmVyQ29kZV1bZnJvbVNxXTsNCiAgICBpZiAobW92ZXJDb2RlIDwgOCkgc3RhdGUucmVkUG9zaXRpb24gKz0gbW92ZXJQb3NpdGlvbkRlbHRhOw0KICAgIGVsc2Ugc3RhdGUuYmxhY2tQb3NpdGlvbiArPSBtb3ZlclBvc2l0aW9uRGVsdGE7DQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwKSB7CiAgICAgICAgY29uc3QgY2FwdHVyZWRDb2RlID0gc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdOwogICAgICAgIHN0YXRlLmV2YWxWZXJpZmljYXRpb25IYXNoIF49IEVWQUxfVkVSSUZZX0hBU0hfQllfQ09ERVtjYXB0dXJlZENvZGVdW3RvU3FdOwogICAgICAgIGNvbnN0IGNhcHR1cmVkTWF0ZXJpYWwgPSBzdGF0ZS5tYXRlcmlhbFZhbHVlc1tjYXB0dXJlZENvZGUgJiA3XTsNCiAgICAgICAgY29uc3QgY2FwdHVyZWRQb3NpdGlvbiA9IFNFQVJDSF9QT1NJVElPTl9WQUxVRVNbY2FwdHVyZWRDb2RlXVt0b1NxXTsNCiAgICAgICAgaWYgKGNhcHR1cmVkQ29kZSA8IDgpIHsNCiAgICAgICAgICAgIHN0YXRlLnJlZE1hdGVyaWFsIC09IGNhcHR1cmVkTWF0ZXJpYWw7DQogICAgICAgICAgICBzdGF0ZS5yZWRQb3NpdGlvbiAtPSBjYXB0dXJlZFBvc2l0aW9uOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgc3RhdGUuYmxhY2tNYXRlcmlhbCAtPSBjYXB0dXJlZE1hdGVyaWFsOw0KICAgICAgICAgICAgc3RhdGUuYmxhY2tQb3NpdGlvbiAtPSBjYXB0dXJlZFBvc2l0aW9uOw0KICAgICAgICB9DQogICAgfQ0KICAgIG1vdmVyLnNxID0gdG9TcTsNCiAgICBtb3Zlci5yID0gU1FfUk9XW3RvU3FdOw0KICAgIG1vdmVyLmMgPSBTUV9DT0xbdG9TcV07DQogICAgc3RhdGUuc3F1YXJlVG9TbG90W2Zyb21TcV0gPSAtMTsNCiAgICBzdGF0ZS5zcXVhcmVUb1Nsb3RbdG9TcV0gPSBtb3ZlclNsb3Q7DQogICAgc3RhdGUuc3F1YXJlQ29kZXNbZnJvbVNxXSA9IDA7DQogICAgc3RhdGUuc3F1YXJlQ29kZXNbdG9TcV0gPSBzdGF0ZS5waWVjZUNvZGVzW21vdmVyU2xvdF07DQogICAgaWYgKChtb3ZlckNvZGUgJiA3KSA9PT0gMSkgew0KICAgICAgICBpZiAobW92ZXJDb2RlIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gdG9TcTsNCiAgICAgICAgZWxzZSBzdGF0ZS5ibGFja0dlbmVyYWxTcSA9IHRvU3E7DQogICAgfQ0KICAgIGlmIChjYXB0dXJlZFNsb3QgPj0gMCAmJiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdICYgNykgPT09IDEpIHsNCiAgICAgICAgaWYgKHN0YXRlLnBpZWNlQ29kZXNbY2FwdHVyZWRTbG90XSA8IDgpIHN0YXRlLnJlZEdlbmVyYWxTcSA9IC0xOw0KICAgICAgICBlbHNlIHN0YXRlLmJsYWNrR2VuZXJhbFNxID0gLTE7DQogICAgfQ0KICAgIGlmIChjYXB0dXJlZFNsb3QgPj0gMCkgc3RhdGUucmVjb3Jkc1tjYXB0dXJlZFNsb3RdLmFsaXZlID0gZmFsc2U7DQp9Ow0KDQpjb25zdCB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJVbm1ha2UgPSAoYm9hcmQsIGZyb21TcSwgdG9TcSkgPT4gew0KICAgIGNvbnN0IHN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgaWYgKCFzdGF0ZSkgcmV0dXJuOw0KICAgIGNvbnN0IHN0YWNrSW5kZXggPSAtLXN0YXRlLnN0YWNrRGVwdGg7DQogICAgY29uc3QgbW92ZXJTbG90ID0gc3RhdGUubW92ZXJTdGFja1tzdGFja0luZGV4XTsNCiAgICBjb25zdCBjYXB0dXJlZFNsb3QgPSBzdGF0ZS5jYXB0dXJlZFN0YWNrW3N0YWNrSW5kZXhdOw0KICAgIGlmIChtb3ZlclNsb3QgPCAwKSByZXR1cm47DQoNCiAgICBjb25zdCBtb3ZlciA9IHN0YXRlLnJlY29yZHNbbW92ZXJTbG90XTsKICAgIGNvbnN0IG1vdmVyQ29kZSA9IHN0YXRlLnBpZWNlQ29kZXNbbW92ZXJTbG90XTsKICAgIHN0YXRlLmV2YWxWZXJpZmljYXRpb25IYXNoIF49IEVWQUxfVkVSSUZZX0hBU0hfQllfQ09ERVttb3ZlckNvZGVdW2Zyb21TcV0gXgogICAgICAgIEVWQUxfVkVSSUZZX0hBU0hfQllfQ09ERVttb3ZlckNvZGVdW3RvU3FdOwogICAgY29uc3QgbW92ZXJQb3NpdGlvbkRlbHRhID0gU0VBUkNIX1BPU0lUSU9OX1ZBTFVFU1ttb3ZlckNvZGVdW2Zyb21TcV0gLQ0KICAgICAgICBTRUFSQ0hfUE9TSVRJT05fVkFMVUVTW21vdmVyQ29kZV1bdG9TcV07DQogICAgaWYgKG1vdmVyQ29kZSA8IDgpIHN0YXRlLnJlZFBvc2l0aW9uICs9IG1vdmVyUG9zaXRpb25EZWx0YTsNCiAgICBlbHNlIHN0YXRlLmJsYWNrUG9zaXRpb24gKz0gbW92ZXJQb3NpdGlvbkRlbHRhOw0KICAgIGlmIChjYXB0dXJlZFNsb3QgPj0gMCkgewogICAgICAgIGNvbnN0IGNhcHR1cmVkQ29kZSA9IHN0YXRlLnBpZWNlQ29kZXNbY2FwdHVyZWRTbG90XTsKICAgICAgICBzdGF0ZS5ldmFsVmVyaWZpY2F0aW9uSGFzaCBePSBFVkFMX1ZFUklGWV9IQVNIX0JZX0NPREVbY2FwdHVyZWRDb2RlXVt0b1NxXTsKICAgICAgICBjb25zdCBjYXB0dXJlZE1hdGVyaWFsID0gc3RhdGUubWF0ZXJpYWxWYWx1ZXNbY2FwdHVyZWRDb2RlICYgN107DQogICAgICAgIGNvbnN0IGNhcHR1cmVkUG9zaXRpb24gPSBTRUFSQ0hfUE9TSVRJT05fVkFMVUVTW2NhcHR1cmVkQ29kZV1bdG9TcV07DQogICAgICAgIGlmIChjYXB0dXJlZENvZGUgPCA4KSB7DQogICAgICAgICAgICBzdGF0ZS5yZWRNYXRlcmlhbCArPSBjYXB0dXJlZE1hdGVyaWFsOw0KICAgICAgICAgICAgc3RhdGUucmVkUG9zaXRpb24gKz0gY2FwdHVyZWRQb3NpdGlvbjsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIHN0YXRlLmJsYWNrTWF0ZXJpYWwgKz0gY2FwdHVyZWRNYXRlcmlhbDsNCiAgICAgICAgICAgIHN0YXRlLmJsYWNrUG9zaXRpb24gKz0gY2FwdHVyZWRQb3NpdGlvbjsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBtb3Zlci5zcSA9IGZyb21TcTsNCiAgICBtb3Zlci5yID0gU1FfUk9XW2Zyb21TcV07DQogICAgbW92ZXIuYyA9IFNRX0NPTFtmcm9tU3FdOw0KICAgIHN0YXRlLnNxdWFyZVRvU2xvdFtmcm9tU3FdID0gbW92ZXJTbG90Ow0KICAgIHN0YXRlLnNxdWFyZVRvU2xvdFt0b1NxXSA9IGNhcHR1cmVkU2xvdDsNCiAgICBzdGF0ZS5zcXVhcmVDb2Rlc1tmcm9tU3FdID0gc3RhdGUucGllY2VDb2Rlc1ttb3ZlclNsb3RdOw0KICAgIHN0YXRlLnNxdWFyZUNvZGVzW3RvU3FdID0gY2FwdHVyZWRTbG90ID49IDAgPyBzdGF0ZS5waWVjZUNvZGVzW2NhcHR1cmVkU2xvdF0gOiAwOw0KICAgIGlmICgobW92ZXJDb2RlICYgNykgPT09IDEpIHsNCiAgICAgICAgaWYgKG1vdmVyQ29kZSA8IDgpIHN0YXRlLnJlZEdlbmVyYWxTcSA9IGZyb21TcTsNCiAgICAgICAgZWxzZSBzdGF0ZS5ibGFja0dlbmVyYWxTcSA9IGZyb21TcTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkU2xvdCA+PSAwICYmIChzdGF0ZS5waWVjZUNvZGVzW2NhcHR1cmVkU2xvdF0gJiA3KSA9PT0gMSkgew0KICAgICAgICBpZiAoc3RhdGUucGllY2VDb2Rlc1tjYXB0dXJlZFNsb3RdIDwgOCkgc3RhdGUucmVkR2VuZXJhbFNxID0gdG9TcTsNCiAgICAgICAgZWxzZSBzdGF0ZS5ibGFja0dlbmVyYWxTcSA9IHRvU3E7DQogICAgfQ0KICAgIGlmIChjYXB0dXJlZFNsb3QgPj0gMCkgc3RhdGUucmVjb3Jkc1tjYXB0dXJlZFNsb3RdLmFsaXZlID0gdHJ1ZTsNCn07DQoNCmNvbnN0IGxvd2VzdFNldEJpdEluZGV4ID0gKG1hc2spID0+IDMxIC0gTWF0aC5jbHozMihtYXNrICYgLW1hc2spOw0KDQpjb25zdCBmb3JFYWNoU2V0Qml0ID0gKG1hc2ssIGZuKSA9PiB7DQogICAgbGV0IG0gPSBtYXNrID4+PiAwOw0KICAgIHdoaWxlIChtICE9PSAwKSB7DQogICAgICAgIGNvbnN0IGJpdCA9IG0gJiAtbTsNCiAgICAgICAgZm4oMzEgLSBNYXRoLmNsejMyKGJpdCkpOw0KICAgICAgICBtIF49IGJpdDsNCiAgICB9DQp9Ow0KDQovLyDkuLvor4TkvLDlh73mlbAgLSDor6bnu4bor4TkvLDmo4vnm5jlsYDlir/vvIhVSSAvIOeCueaji+WFs+ezuyAvIOaQnOe0ouWPtiAvIOagueiKgueCue+8iQ0KLy8gb3B0aW9ucy5mb3JTZWFyY2hMZWFmOiDku4Xot7Pov4fnu4jlsYAgZ2V0VmFsaWRNb3Zlc++8iOaXoOedgOW3suWcqOeItuiKgueCueWkhOeQhu+8ie+8m+WPr+eUqOaUu+WHu+S9jeWbvuS7o+abv+aOp+WItuiAheihqA0KY29uc3QgZXZhbHVhdGVCb2FyZCA9IChib2FyZCwgY3VycmVudFBsYXllciA9IG51bGwsIGdhbWVTdGFnZSA9ICdtaWQnLCBvcHRpb25zID0gbnVsbCkgPT4gew0KICAgIGNvbnN0IF9fdDAgPSBTRUFSQ0hfUFJPRklMRSA/IHBlcmZvcm1hbmNlLm5vdygpIDogMDsNCiAgICAvLyDnu5/orqENCiAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUyAmJiBjdXJyZW50UGxheWVyKSB7CiAgICAgICAgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRDb3VudFtjdXJyZW50UGxheWVyXSsrOwogICAgfQ0KICAgIGNvbnN0IGZvclNlYXJjaExlYWYgPSAhIShvcHRpb25zICYmIG9wdGlvbnMuZm9yU2VhcmNoTGVhZik7DQoNCiAgICBjb25zdCBvdXRwdXRQaGFzZSA9IGdhbWVTdGFnZTsNCg0KICAgIC8vIOmBjeWOhuaji+ebmO+8muWPquaUtumbhuWtkOWKmy9QU1TvvJvnnYDms5Ur5YWz57O757uf5LiA5ZyoIGNhbGN1bGF0ZVBpZWNlUmVsYXRpb25zIOS4gOasoeWHoOS9leeUn+aIkO+8iOWvuem9kOeCru+8iQ0KICAgIGxldCBwaWVjZXNJbmZvID0gW107DQogICAgbGV0IHJlZE1hdGVyaWFsID0gMCwgcmVkUG9zaXRpb24gPSAwOw0KICAgIGxldCBibGFja01hdGVyaWFsID0gMCwgYmxhY2tQb3NpdGlvbiA9IDA7DQogICAgDQogICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICBpZiAoIXBpZWNlKSBjb250aW51ZTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgICAgICBjb25zdCBwb3NpdGlvblZhbHVlID0gZ2V0UG9zaXRpb25WYWx1ZShwaWVjZSwgciwgYyk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICByZWRNYXRlcmlhbCArPSBtYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgICAgIHJlZFBvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGJsYWNrTWF0ZXJpYWwgKz0gbWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgICAgICBibGFja1Bvc2l0aW9uICs9IHBvc2l0aW9uVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgICAgIHBpZWNlc0luZm8ucHVzaCh7DQogICAgICAgICAgICAgICAgcGllY2UsDQogICAgICAgICAgICAgICAgciwNCiAgICAgICAgICAgICAgICBjLA0KICAgICAgICAgICAgICAgIHBpZWNlSW5kZXg6IHBpZWNlc0luZm8ubGVuZ3RoLA0KICAgICAgICAgICAgICAgIG1vdmVzOiBbXSwNCiAgICAgICAgICAgICAgICBhbGx5R3VhcmRzOiBbXSwNCiAgICAgICAgICAgICAgICBtYXRlcmlhbFZhbHVlLA0KICAgICAgICAgICAgICAgIHBvc2l0aW9uVmFsdWUsDQogICAgICAgICAgICAgICAgdGhyZWF0VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgc2FmZXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDAsDQogICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IFtdLA0KICAgICAgICAgICAgICAgIHRocmVhdGVuZWRCeTogW10sDQogICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLA0KICAgICAgICAgICAgICAgIGd1YXJkZWRCeTogW10sDQogICAgICAgICAgICAgICAgY29udHJvbDogW10sDQogICAgICAgICAgICAgICAgcHJvdGVjdDogW10NCiAgICAgICAgICAgIH0pOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5YWz57O7IG1hc2vvvIjiiaQzMiDlrZDvvInkvJjlhYjvvJvlkKbliJnlm57pgIDml6fliJfooaggLyDlj7bmlLvlh7vkvY3lm74NCiAgICBjb25zdCB1c2VSZWxhdGlvbk1hc2tzID0gcGllY2VzSW5mby5sZW5ndGggPD0gMzI7DQogICAgY29uc3QgdXNlQXR0YWNrQml0cyA9IGZhbHNlOw0KICAgIGxldCBib2FyZEluZm87DQogICAgaWYgKHVzZVJlbGF0aW9uTWFza3MpIHsNCiAgICAgICAgY2xlYXJSZWxhdGlvbk1hc2tzKCFmb3JTZWFyY2hMZWFmKTsNCiAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOw0KICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaEJsYWNrQXR0YWNrKTsNCiAgICAgICAgYm9hcmRJbmZvID0gew0KICAgICAgICAgICAgdXNlUmVsYXRpb25NYXNrczogdHJ1ZSwNCiAgICAgICAgICAgIHVzZUF0dGFja0JpdHM6IHRydWUsDQogICAgICAgICAgICBza2lwQ29udHJvbE1hc2s6ICEhZm9yU2VhcmNoTGVhZiwNCiAgICAgICAgICAgIHBhbGFjZUNvbnRyb2xPbmx5OiAhIShvcHRpb25zICYmIG9wdGlvbnMucGFsYWNlQ29udHJvbE9ubHkpLA0KICAgICAgICAgICAgYXR0YWNrTWFzazogc2NyYXRjaEF0dGFja01hc2ssDQogICAgICAgICAgICBndWFyZE1hc2s6IHNjcmF0Y2hHdWFyZE1hc2ssDQogICAgICAgICAgICBjb250cm9sTWFzazogc2NyYXRjaENvbnRyb2xNYXNrLA0KICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICB9Ow0KICAgIH0gZWxzZSBpZiAodXNlQXR0YWNrQml0cykgew0KICAgICAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaFJlZEF0dGFjayk7DQogICAgICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoQmxhY2tBdHRhY2spOw0KICAgICAgICBib2FyZEluZm8gPSB7DQogICAgICAgICAgICB1c2VBdHRhY2tCaXRzOiB0cnVlLA0KICAgICAgICAgICAgcmVkQXR0YWNrOiBzY3JhdGNoUmVkQXR0YWNrLA0KICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICB9Ow0KICAgIH0gZWxzZSB7DQogICAgICAgIGJvYXJkSW5mbyA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7DQogICAgfQ0KICAgIGNhbGN1bGF0ZURlcml2ZWRWYWx1ZXMoYm9hcmQsIHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbywgZm9yU2VhcmNoTGVhZik7DQogICAgDQogICAgLy8g56ys5LiJ5q2l77ya6K6h566X5oC75YiG77yI5Y+q6K6h566X5Ymp5L2Z5YiG5pWw77yM5Z+656GA5YiG5pWw5bey5Zyo5qOL55uY6YGN5Y6G5pe26K6h566X77yJDQogICAgbGV0IHJlZFRocmVhdCA9IDAsIHJlZFRhY3RpYyA9IDAsIHJlZFNhZmV0eSA9IDAsIHJlZE1vYmlsaXR5ID0gMDsNCiAgICBsZXQgYmxhY2tUaHJlYXQgPSAwLCBibGFja1RhY3RpYyA9IDAsIGJsYWNrU2FmZXR5ID0gMCwgYmxhY2tNb2JpbGl0eSA9IDA7DQogICAgDQogICAgZm9yIChjb25zdCBpbmZvIG9mIHBpZWNlc0luZm8pIHsNCiAgICAgICAgY29uc3QgeyBwaWVjZSwgdGhyZWF0VmFsdWUsIHRhY3RpY1ZhbHVlLCBzYWZldHlWYWx1ZSwgbW9iaWxpdHlWYWx1ZSB9ID0gaW5mbzsNCiAgICAgICAgDQogICAgICAgIGlmIChwaWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgIHJlZFRocmVhdCArPSB0aHJlYXRWYWx1ZTsNCiAgICAgICAgICAgIHJlZFRhY3RpYyArPSB0YWN0aWNWYWx1ZTsNCiAgICAgICAgICAgIHJlZFNhZmV0eSArPSBzYWZldHlWYWx1ZTsNCiAgICAgICAgICAgIHJlZE1vYmlsaXR5ICs9IG1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBibGFja1RocmVhdCArPSB0aHJlYXRWYWx1ZTsNCiAgICAgICAgICAgIGJsYWNrVGFjdGljICs9IHRhY3RpY1ZhbHVlOw0KICAgICAgICAgICAgYmxhY2tTYWZldHkgKz0gc2FmZXR5VmFsdWU7DQogICAgICAgICAgICBibGFja01vYmlsaXR5ICs9IG1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0NCiAgICB9DQogICAgDQogICAgLy8g6K6h566X5bGA5Yq/5oC75YiGDQogICAgY29uc3QgcmVkVG90YWwgPSANCiAgICAgICAgcmVkTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgcmVkUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uICsNCiAgICAgICAgcmVkVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKw0KICAgICAgICByZWRUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArDQogICAgICAgIHJlZFNhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsNCiAgICAgICAgcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5OyANCiAgICANCiAgICBjb25zdCBibGFja1RvdGFsID0gDQogICAgICAgIGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgYmxhY2tQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24gKw0KICAgICAgICBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0ICsNCiAgICAgICAgYmxhY2tUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYyArDQogICAgICAgIGJsYWNrU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHkgKw0KICAgICAgICBibGFja01vYmlsaXR5ICogVkFMVUVfV0VJR0hUUy5tb2JpbGl0eTsNCiAgICANCiAgICAvLyDov5Tlm57or6bnu4bor4TkvLDnu5PmnpwNCiAgICBjb25zdCBfX2V2YWxSZXN1bHQgPSB7DQogICAgICAgIHJlZDogew0KICAgICAgICAgICAgdG90YWw6IHJlZFRvdGFsLA0KICAgICAgICAgICAgbWF0ZXJpYWw6IHJlZE1hdGVyaWFsICogVkFMVUVfV0VJR0hUUy5tYXRlcmlhbCwNCiAgICAgICAgICAgIHBvc2l0aW9uOiByZWRQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24sDQogICAgICAgICAgICB0aHJlYXQ6IHJlZFRocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0LA0KICAgICAgICAgICAgdGFjdGljOiByZWRUYWN0aWMgKiBWQUxVRV9XRUlHSFRTLnRhY3RpYywNCiAgICAgICAgICAgIHNhZmV0eTogcmVkU2FmZXR5ICogVkFMVUVfV0VJR0hUUy5zYWZldHksDQogICAgICAgICAgICBtb2JpbGl0eTogcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgcGhhc2U6IG91dHB1dFBoYXNlLA0KICAgICAgICAgICAgd2VpZ2h0czogew0KICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLjQsDQogICAgICAgICAgICAgICAgcG9zaXRpb246IDAuMiwNCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwNCiAgICAgICAgICAgICAgICBzYWZldHk6IDAuMSwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eTogMC4wNSwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSwNCiAgICAgICAgYmxhY2s6IHsNCiAgICAgICAgICAgIHRvdGFsOiBibGFja1RvdGFsLA0KICAgICAgICAgICAgbWF0ZXJpYWw6IGJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsLA0KICAgICAgICAgICAgcG9zaXRpb246IGJsYWNrUG9zaXRpb24gKiBWQUxVRV9XRUlHSFRTLnBvc2l0aW9uLA0KICAgICAgICAgICAgdGhyZWF0OiBibGFja1RocmVhdCAqIFZBTFVFX1dFSUdIVFMudGhyZWF0LA0KICAgICAgICAgICAgdGFjdGljOiBibGFja1RhY3RpYyAqIFZBTFVFX1dFSUdIVFMudGFjdGljLA0KICAgICAgICAgICAgc2FmZXR5OiBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5LA0KICAgICAgICAgICAgbW9iaWxpdHk6IGJsYWNrTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgcGhhc2U6IG91dHB1dFBoYXNlLA0KICAgICAgICAgICAgd2VpZ2h0czogew0KICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLjQsDQogICAgICAgICAgICAgICAgcG9zaXRpb246IDAuMiwNCiAgICAgICAgICAgICAgICB0YWN0aWM6IDAuMSwNCiAgICAgICAgICAgICAgICBzYWZldHk6IDAuMSwNCiAgICAgICAgICAgICAgICBtb2JpbGl0eTogMC4wNSwNCiAgICAgICAgICAgICAgICB0aHJlYXQ6IDAuMTUNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSwNCiAgICAgICAgcGllY2VzSW5mbzogcGllY2VzSW5mbywNCiAgICAgICAgZ2FtZVN0YWdlOiBnYW1lU3RhZ2UsDQogICAgICAgIGJvYXJkSW5mbzogYm9hcmRJbmZvDQogICAgfTsNCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHsNCiAgICAgICAgcGVyZlN0YXRzLmV2YWx1YXRlQm9hcmRNcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7DQogICAgfQ0KICAgIHJldHVybiBfX2V2YWxSZXN1bHQ7DQp9Ow0KDQovLyDlsIYv5biF5L2N572u57yT5a2Y77ya5L6bIHBvc3QtbW92ZSBpc0NoZWNrIC8g6aOe5bCG5b+r6YCf5p+l6K+i77yM55SxIG1ha2UvdW5tYWtlIOe7tOaKpA0KbGV0IGdlbmVyYWxQb3NDYWNoZSA9IHsgcmVkOiBudWxsLCBibGFjazogbnVsbCB9Ow0KDQovLyDlsIbluIXku4XlnKjkuZ3lrqvlhoXvvIzmjInkuZ3lrqvmiavmj4/ljbPlj68NCmNvbnN0IGZpbmRHZW5lcmFsUG9zID0gKGJvYXJkLCBjb2xvcikgPT4gew0KICAgIGNvbnN0IHJvd1N0YXJ0ID0gY29sb3IgPT09ICdyZWQnID8gMCA6IDc7DQogICAgY29uc3Qgcm93RW5kID0gY29sb3IgPT09ICdyZWQnID8gMiA6IDk7DQogICAgZm9yIChsZXQgciA9IHJvd1N0YXJ0OyByIDw9IHJvd0VuZDsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAzOyBjIDw9IDU7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4geyByLCBjIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgcmV0dXJuIG51bGw7DQp9Ow0KDQpjb25zdCBzeW5jR2VuZXJhbFBvc0NhY2hlID0gKGJvYXJkKSA9PiB7DQogICAgZ2VuZXJhbFBvc0NhY2hlLnJlZCA9IGZpbmRHZW5lcmFsUG9zKGJvYXJkLCAncmVkJyk7DQogICAgZ2VuZXJhbFBvc0NhY2hlLmJsYWNrID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsICdibGFjaycpOw0KfTsNCg0KY29uc3QgZ2V0R2VuZXJhbFBvcyA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBjb25zdCBjYWNoZWQgPSBnZW5lcmFsUG9zQ2FjaGVbY29sb3JdOw0KICAgIGlmIChjYWNoZWQpIHsNCiAgICAgICAgY29uc3QgcCA9IGJvYXJkW2NhY2hlZC5yXT8uW2NhY2hlZC5jXTsNCiAgICAgICAgaWYgKHAgJiYgcC50eXBlID09PSAnZ2VuZXJhbCcgJiYgcC5jb2xvciA9PT0gY29sb3IpIHsNCiAgICAgICAgICAgIHJldHVybiBjYWNoZWQ7DQogICAgICAgIH0NCiAgICB9DQogICAgY29uc3QgcG9zID0gZmluZEdlbmVyYWxQb3MoYm9hcmQsIGNvbG9yKTsNCiAgICBnZW5lcmFsUG9zQ2FjaGVbY29sb3JdID0gcG9zOw0KICAgIHJldHVybiBwb3M7DQp9Ow0KDQovLyDmkJzntKLnlKjljp/lnLDotbDlrZAgLyDmgaLlpI3vvIjpgb/lhY3mr4/mrKHpgJLlvZIgYm9hcmQubWFw77yJ77yb5ZCM5q2l57u05oqk5bCG5L2N57yT5a2YDQpjb25zdCBtYWtlTW92ZSA9IChib2FyZCwgZnJvbSwgdG8pID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsNCiAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW3RvLnJdW3RvLmNdOw0KICAgIGJvYXJkW3RvLnJdW3RvLmNdID0gcGllY2U7DQogICAgYm9hcmRbZnJvbS5yXVtmcm9tLmNdID0gbnVsbDsNCiAgICB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJNYWtlKGJvYXJkLCBmcm9tLnIgKiA5ICsgZnJvbS5jLCB0by5yICogOSArIHRvLmMpOw0KICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogdG8uciwgYzogdG8uYyB9Ow0KICAgIH0NCiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSBudWxsOw0KICAgIH0NCiAgICByZXR1cm4gY2FwdHVyZWQ7DQp9Ow0KDQpjb25zdCB1bm1ha2VNb3ZlID0gKGJvYXJkLCBmcm9tLCB0bywgY2FwdHVyZWQpID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOw0KICAgIGJvYXJkW2Zyb20ucl1bZnJvbS5jXSA9IHBpZWNlOw0KICAgIGJvYXJkW3RvLnJdW3RvLmNdID0gY2FwdHVyZWQ7DQogICAgdXBkYXRlUGllY2VTdGF0ZUFmdGVyVW5tYWtlKGJvYXJkLCBmcm9tLnIgKiA5ICsgZnJvbS5jLCB0by5yICogOSArIHRvLmMpOw0KICAgIGlmIChwaWVjZSAmJiBwaWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgZ2VuZXJhbFBvc0NhY2hlW3BpZWNlLmNvbG9yXSA9IHsgcjogZnJvbS5yLCBjOiBmcm9tLmMgfTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0geyByOiB0by5yLCBjOiB0by5jIH07DQogICAgfQ0KfTsNCg0KLy8g5LuF5pmu6YCa6IqC54K55L2/55So77ya54i25bGA6Z2i5a6J5YWo5LiU6LW357uI54K55LiN5b2x5ZON5bCG57q/5oiW5pWM6ams5L6d6LWW5qC85pe277yM6LWw5a2Q5ZCO5LuN5b+F54S25a6J5YWo44CCDQpjb25zdCBraW5nU2FmZXR5SXNVbmNoYW5nZWRCeU1vdmUgPSAoc3RhdGUsIGNvbG9yLCBtb3ZlLCB3YXNJbkNoZWNrKSA9PiB7DQogICAgaWYgKCFTRUFSQ0hfRU5BQkxFX0tJTkdfU0FGRVRZX0ZBU1RfUEFUSCB8fCB3YXNJbkNoZWNrIHx8ICFzdGF0ZSB8fCBtb3ZlID09IG51bGwpIHJldHVybiBmYWxzZTsNCiAgICBjb25zdCBmcm9tU3EgPSBtb3ZlRnJvbVNxKG1vdmUpOw0KICAgIGNvbnN0IHRvU3EgPSBtb3ZlVG9TcShtb3ZlKTsNCiAgICBjb25zdCBnZW5lcmFsU3EgPSBjb2xvciA9PT0gJ3JlZCcgPyBzdGF0ZS5yZWRHZW5lcmFsU3EgOiBzdGF0ZS5ibGFja0dlbmVyYWxTcTsNCiAgICBpZiAoZ2VuZXJhbFNxIDwgMCB8fCBnZW5lcmFsU3EgPT09IHRvU3EpIHJldHVybiBmYWxzZTsNCg0KICAgIGNvbnN0IGdlbmVyYWxSb3cgPSBTRUFSQ0hfU1FfUk9XU1tnZW5lcmFsU3FdOw0KICAgIGNvbnN0IGdlbmVyYWxDb2wgPSBTRUFSQ0hfU1FfQ09MU1tnZW5lcmFsU3FdOw0KICAgIGlmICgNCiAgICAgICAgU0VBUkNIX1NRX1JPV1NbZnJvbVNxXSA9PT0gZ2VuZXJhbFJvdyB8fA0KICAgICAgICBTRUFSQ0hfU1FfQ09MU1tmcm9tU3FdID09PSBnZW5lcmFsQ29sIHx8DQogICAgICAgIFNFQVJDSF9TUV9ST1dTW3RvU3FdID09PSBnZW5lcmFsUm93IHx8DQogICAgICAgIFNFQVJDSF9TUV9DT0xTW3RvU3FdID09PSBnZW5lcmFsQ29sDQogICAgKSB7DQogICAgICAgIHJldHVybiBmYWxzZTsNCiAgICB9DQoNCiAgICBjb25zdCBob3JzZUNoZWNrZXJzID0gU0VBUkNIX0hPUlNFX0NIRUNLRVJTW2dlbmVyYWxTcV07DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBob3JzZUNoZWNrZXJzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGVudHJ5ID0gaG9yc2VDaGVja2Vyc1tpXTsNCiAgICAgICAgY29uc3QgbGVnU3EgPSBlbnRyeSA+Pj4gNzsNCiAgICAgICAgY29uc3QgaG9yc2VTcSA9IGVudHJ5ICYgTU9WRV9UT19NQVNLOw0KICAgICAgICBpZiAoZnJvbVNxID09PSBsZWdTcSB8fCB0b1NxID09PSBsZWdTcSB8fCBmcm9tU3EgPT09IGhvcnNlU3EgfHwgdG9TcSA9PT0gaG9yc2VTcSkgcmV0dXJuIGZhbHNlOw0KICAgIH0NCiAgICByZXR1cm4gdHJ1ZTsNCn07DQoNCi8vIOi1sOWtkOWQjuaYr+WQpuS9v+W3seaWueWwhuS4jeWuieWFqO+8iOmjnuWwhuaIluiiq+Wwhu+8ieOAguiwg+eUqOWJjemhu+W3siBtYWtlTW92ZeOAgg0KY29uc3QgbGVhdmVzT3duS2luZ1Vuc2FmZSA9IChib2FyZCwgY29sb3IsIG1vdmUgPSBudWxsLCB3YXNJbkNoZWNrID0gdHJ1ZSkgPT4gew0KICAgIGNvbnN0IF9fdDAgPSBTRUFSQ0hfUFJPRklMRSA/IHBlcmZvcm1hbmNlLm5vdygpIDogMDsNCiAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzKys7CiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgaWYgKGtpbmdTYWZldHlJc1VuY2hhbmdlZEJ5TW92ZShwaWVjZVN0YXRlLCBjb2xvciwgbW92ZSwgd2FzSW5DaGVjaykpIHsNCiAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHBlcmZTdGF0cy5raW5nU2FmZXR5RmFzdFNraXBzKys7DQogICAgICAgIGlmIChTRUFSQ0hfVkVSSUZZX0tJTkdfU0FGRVRZX0ZBU1RfUEFUSCkgew0KICAgICAgICAgICAgY29uc3QgdW5zYWZlID0gcGllY2VTdGF0ZQ0KICAgICAgICAgICAgICAgID8gaXNDaGVja1Jhd0Zyb21QaWVjZVN0YXRlKHBpZWNlU3RhdGUsIGNvbG9yKQ0KICAgICAgICAgICAgICAgIDogKGlzRmx5aW5nR2VuZXJhbChib2FyZCkgfHwgaXNDaGVja1Jhdyhib2FyZCwgY29sb3IpKTsNCiAgICAgICAgICAgIGlmICh1bnNhZmUpIHsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgcGVyZlN0YXRzLmtpbmdTYWZldHlWZXJpZmljYXRpb25GYWlsdXJlcysrOw0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBmYWxzZTsNCiAgICB9DQogICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHBlcmZTdGF0cy5raW5nU2FmZXR5RnVsbENoZWNrcysrOw0KICAgIGNvbnN0IHVuc2FmZSA9IHBpZWNlU3RhdGUgPyBpc0NoZWNrUmF3RnJvbVBpZWNlU3RhdGUocGllY2VTdGF0ZSwgY29sb3IpIDogKGlzRmx5aW5nR2VuZXJhbChib2FyZCkgfHwgaXNDaGVja1Jhdyhib2FyZCwgY29sb3IpKTsNCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIHJldHVybiB1bnNhZmU7DQp9Ow0KDQovLyDku47kvKrlkIjms5XnnYDms5XkuK3ov4fmu6Tlh7rkuI3pgIHlsIYv5LiN6aOe5bCG55qE5ZCI5rOV552A5rOV77yIVUkv5qC56IqC54K5L+W8gOWxgOW6k+agoemqjO+8iQ0KLy8g5pCc57Si54Ot6Lev5b6E5L2/55So5bu26L+f5ZCI5rOV5oCn77yI6K+V6LWw5pe25qOA5rWL77yJ77yM6YG/5YWN5a+55Ymq5p6d5pyq6Kem5Y+K55qE552A5rOV5YGa5YWo6YeP6L+H5rukDQpjb25zdCBmaWx0ZXJMZWdhbE1vdmVzID0gKGJvYXJkLCBmcm9tLCBwaWVjZSwgcHNldWRvTW92ZXMpID0+IHsNCiAgICBjb25zdCB2YWxpZE1vdmVzID0gW107DQogICAgZm9yIChjb25zdCB0byBvZiBwc2V1ZG9Nb3Zlcykgew0KICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VNb3ZlKGJvYXJkLCBmcm9tLCB0byk7DQogICAgICAgIGNvbnN0IGlsbGVnYWwgPSBsZWF2ZXNPd25LaW5nVW5zYWZlKGJvYXJkLCBwaWVjZS5jb2xvcik7DQogICAgICAgIHVubWFrZU1vdmUoYm9hcmQsIGZyb20sIHRvLCBjYXB0dXJlZCk7DQogICAgICAgIGlmICghaWxsZWdhbCkgdmFsaWRNb3Zlcy5wdXNoKHRvKTsNCiAgICB9DQogICAgcmV0dXJuIHZhbGlkTW92ZXM7DQp9Ow0KDQovLyBTZWFyY2ggaG90IHBhdGggbW92ZSBlbmNvZGluZzogbW92ZSA9IChmcm9tU3EgPDwgNykgfCB0b1NxLg0KY29uc3QgTU9WRV9UT19NQVNLID0gMHg3ZjsNCmNvbnN0IGVuY29kZU1vdmUgPSAoZnJvbSwgdG8pID0+ICgoZnJvbS5yICogOSArIGZyb20uYykgPDwgNykgfCAodG8uciAqIDkgKyB0by5jKTsNCmNvbnN0IGVuY29kZU1vdmVGcm9tQ29vcmRzID0gKGZyLCBmYywgdHIsIHRjKSA9PiAoKGZyICogOSArIGZjKSA8PCA3KSB8ICh0ciAqIDkgKyB0Yyk7DQpjb25zdCBpc0VuY29kZWRNb3ZlID0gKG1vdmUpID0+IHR5cGVvZiBtb3ZlID09PSAnbnVtYmVyJzsNCmNvbnN0IG1vdmVGcm9tU3EgPSAobW92ZSkgPT4gaXNFbmNvZGVkTW92ZShtb3ZlKSA/IChtb3ZlID4+PiA3KSA6IG1vdmUuZnJvbS5yICogOSArIG1vdmUuZnJvbS5jOw0KY29uc3QgbW92ZVRvU3EgPSAobW92ZSkgPT4gaXNFbmNvZGVkTW92ZShtb3ZlKSA/IChtb3ZlICYgTU9WRV9UT19NQVNLKSA6IG1vdmUudG8uciAqIDkgKyBtb3ZlLnRvLmM7DQpjb25zdCBtb3ZlRnJvbVIgPSAobW92ZSkgPT4gU1FfUk9XW21vdmVGcm9tU3EobW92ZSldOw0KY29uc3QgbW92ZUZyb21DID0gKG1vdmUpID0+IFNRX0NPTFttb3ZlRnJvbVNxKG1vdmUpXTsNCmNvbnN0IG1vdmVUb1IgPSAobW92ZSkgPT4gU1FfUk9XW21vdmVUb1NxKG1vdmUpXTsNCmNvbnN0IG1vdmVUb0MgPSAobW92ZSkgPT4gU1FfQ09MW21vdmVUb1NxKG1vdmUpXTsNCmNvbnN0IG1vdmVUb09iamVjdCA9IChtb3ZlKSA9PiB7DQogICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSByZXR1cm4gbW92ZTsNCiAgICBjb25zdCBmcm9tID0gbW92ZUZyb21TcShtb3ZlKTsNCiAgICBjb25zdCB0byA9IG1vdmVUb1NxKG1vdmUpOw0KICAgIHJldHVybiB7DQogICAgICAgIGZyb206IHsgcjogU1FfUk9XW2Zyb21dLCBjOiBTUV9DT0xbZnJvbV0gfSwNCiAgICAgICAgdG86IHsgcjogU1FfUk9XW3RvXSwgYzogU1FfQ09MW3RvXSB9DQogICAgfTsNCn07DQoNCmNvbnN0IG1ha2VTZWFyY2hNb3ZlID0gKGJvYXJkLCBtb3ZlKSA9PiB7DQogICAgaWYgKCFpc0VuY29kZWRNb3ZlKG1vdmUpKSByZXR1cm4gbWFrZU1vdmUoYm9hcmQsIG1vdmUuZnJvbSwgbW92ZS50byk7DQogICAgY29uc3QgZnJvbSA9IG1vdmUgPj4+IDc7DQogICAgY29uc3QgdG8gPSBtb3ZlICYgTU9WRV9UT19NQVNLOw0KICAgIGNvbnN0IGZyID0gU1FfUk9XW2Zyb21dLCBmYyA9IFNRX0NPTFtmcm9tXTsNCiAgICBjb25zdCB0ciA9IFNRX1JPV1t0b10sIHRjID0gU1FfQ09MW3RvXTsNCiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW2ZyXVtmY107DQogICAgY29uc3QgY2FwdHVyZWQgPSBib2FyZFt0cl1bdGNdOw0KICAgIGJvYXJkW3RyXVt0Y10gPSBwaWVjZTsNCiAgICBib2FyZFtmcl1bZmNdID0gbnVsbDsNCiAgICB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJNYWtlKGJvYXJkLCBmcm9tLCB0byk7DQogICAgaWYgKHBpZWNlICYmIHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbcGllY2UuY29sb3JdID0geyByOiB0ciwgYzogdGMgfTsNCiAgICB9DQogICAgaWYgKGNhcHR1cmVkICYmIGNhcHR1cmVkLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICBnZW5lcmFsUG9zQ2FjaGVbY2FwdHVyZWQuY29sb3JdID0gbnVsbDsNCiAgICB9DQogICAgcmV0dXJuIGNhcHR1cmVkOw0KfTsNCg0KY29uc3QgdW5tYWtlU2VhcmNoTW92ZSA9IChib2FyZCwgbW92ZSwgY2FwdHVyZWQpID0+IHsNCiAgICBpZiAoIWlzRW5jb2RlZE1vdmUobW92ZSkpIHsNCiAgICAgICAgdW5tYWtlTW92ZShib2FyZCwgbW92ZS5mcm9tLCBtb3ZlLnRvLCBjYXB0dXJlZCk7DQogICAgICAgIHJldHVybjsNCiAgICB9DQogICAgY29uc3QgZnJvbSA9IG1vdmUgPj4+IDc7DQogICAgY29uc3QgdG8gPSBtb3ZlICYgTU9WRV9UT19NQVNLOw0KICAgIGNvbnN0IGZyID0gU1FfUk9XW2Zyb21dLCBmYyA9IFNRX0NPTFtmcm9tXTsNCiAgICBjb25zdCB0ciA9IFNRX1JPV1t0b10sIHRjID0gU1FfQ09MW3RvXTsNCiAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3RyXVt0Y107DQogICAgYm9hcmRbZnJdW2ZjXSA9IHBpZWNlOw0KICAgIGJvYXJkW3RyXVt0Y10gPSBjYXB0dXJlZDsNCiAgICB1cGRhdGVQaWVjZVN0YXRlQWZ0ZXJVbm1ha2UoYm9hcmQsIGZyb20sIHRvKTsNCiAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtwaWVjZS5jb2xvcl0gPSB7IHI6IGZyLCBjOiBmYyB9Ow0KICAgIH0NCiAgICBpZiAoY2FwdHVyZWQgJiYgY2FwdHVyZWQudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGdlbmVyYWxQb3NDYWNoZVtjYXB0dXJlZC5jb2xvcl0gPSB7IHI6IHRyLCBjOiB0YyB9Ow0KICAgIH0NCn07DQoNCmNvbnN0IHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoID0gW107DQpjb25zdCBzb3J0TW92ZVNjb3JlU2NyYXRjaCA9IFtdOw0KY29uc3QgY2FwdHVyZVNvcnRTY29yZVNjcmF0Y2ggPSBbXTsNCmNvbnN0IHNxdWFyZU1hcmtTY3JhdGNoID0gbmV3IFVpbnQ4QXJyYXkoUkVMX1NRVUFSRVMpOw0KY29uc3Qgc3F1YXJlTWFya1RvdWNoZWQgPSBbXTsNCg0KY29uc3QgbWFya1NvcnRTcXVhcmUgPSAoc3EpID0+IHsNCiAgICBpZiAoIXNxdWFyZU1hcmtTY3JhdGNoW3NxXSkgew0KICAgICAgICBzcXVhcmVNYXJrU2NyYXRjaFtzcV0gPSAxOw0KICAgICAgICBzcXVhcmVNYXJrVG91Y2hlZC5wdXNoKHNxKTsNCiAgICB9DQp9Ow0KDQpjb25zdCBjbGVhclNvcnRTcXVhcmVNYXJrcyA9ICgpID0+IHsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNxdWFyZU1hcmtUb3VjaGVkLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIHNxdWFyZU1hcmtTY3JhdGNoW3NxdWFyZU1hcmtUb3VjaGVkW2ldXSA9IDA7DQogICAgfQ0KICAgIHNxdWFyZU1hcmtUb3VjaGVkLmxlbmd0aCA9IDA7DQp9Ow0KDQpjb25zdCBzb3J0TW92ZXNGYXN0ID0gKG1vdmVzLCBib2FyZCwgY3VycmVudFBsYXllciwgcGllY2VzSW5mbywgZ2FtZVN0YWdlID0gJ21pZCcsIGJvYXJkSW5mbyA9IG51bGwsIHNlYXJjaEhldXJpc3RpY3MgPSBudWxsKSA9PiB7DQogICAgY29uc3QgX190MCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOw0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnNvcnRNb3Zlc0NvdW50Kys7DQogICAgY29uc3QgY3VycmVudElzSW5DaGVjayA9IGJvYXJkSW5mbw0KICAgICAgICA/ICgoY3VycmVudFBsYXllciA9PT0gJ3JlZCcgJiYgYm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwNCiAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgJiYgYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKSkNCiAgICAgICAgOiBpc0NoZWNrKGJvYXJkLCBjdXJyZW50UGxheWVyKTsNCg0KICAgIGlmIChjdXJyZW50SXNJbkNoZWNrICYmIHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7DQogICAgICAgIGxldCBnZW5lcmFsSW5mbyA9IG51bGw7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07DQogICAgICAgICAgICBpZiAoaW5mby5waWVjZSAmJiBpbmZvLnBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJyAmJiBpbmZvLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgZ2VuZXJhbEluZm8gPSBpbmZvOw0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmIChnZW5lcmFsSW5mbykgew0KICAgICAgICAgICAgaWYgKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcykgew0KICAgICAgICAgICAgICAgIGxldCBtID0gYm9hcmRJbmZvLmF0dGFja01hc2tbZ2VuZXJhbEluZm8uciAqIDkgKyBnZW5lcmFsSW5mby5jXSA+Pj4gMDsNCiAgICAgICAgICAgICAgICB3aGlsZSAobSAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBiaXQgPSBtICYgLW07DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHQgPSBwaWVjZXNJbmZvWzMxIC0gTWF0aC5jbHozMihiaXQpXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHQgJiYgdC5waWVjZSAmJiB0LnBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBtYXJrU29ydFNxdWFyZSh0LnIgKiA5ICsgdC5jKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBtIF49IGJpdDsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKGdlbmVyYWxJbmZvLnRocmVhdGVuZWRCeSkgew0KICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5Lmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHQgPSBnZW5lcmFsSW5mby50aHJlYXRlbmVkQnlbaV07DQogICAgICAgICAgICAgICAgICAgIGlmICh0LnBpZWNlICYmIHQucGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtTb3J0U3F1YXJlKHQuciAqIDkgKyB0LmMpOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3QgaGFzVGhyZWF0ZW5lZCA9ICFjdXJyZW50SXNJbkNoZWNrICYmICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcyAmJiBib2FyZEluZm8udGhyZWF0ZW5lZFBpZWNlcy5sZW5ndGggPiAwKTsNCiAgICBpZiAoaGFzVGhyZWF0ZW5lZCkgew0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXNbaV07DQogICAgICAgICAgICBtYXJrU29ydFNxdWFyZShwLnIgKiA5ICsgcC5jKTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBjb25zdCB0aHJlYXRlbmVkTWFya0VuZCA9IHNxdWFyZU1hcmtUb3VjaGVkLmxlbmd0aDsNCg0KICAgIGNvbnN0IGhhc0NhbkNhcHR1cmUgPSAhY3VycmVudElzSW5DaGVjayAmJiAhIShib2FyZEluZm8gJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUgJiYgYm9hcmRJbmZvLmNhbkNhcHR1cmUubGVuZ3RoID4gMCk7DQogICAgaWYgKGhhc0NhbkNhcHR1cmUpIHsNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2FyZEluZm8uY2FuQ2FwdHVyZS5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkSW5mby5jYW5DYXB0dXJlW2ldOw0KICAgICAgICAgICAgbWFya1NvcnRTcXVhcmUocC5yICogOSArIHAuYyk7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBjb25zdCB0dE1vdmUgPSBzZWFyY2hIZXVyaXN0aWNzPy50dE1vdmUgfHwgbnVsbDsNCiAgICBjb25zdCBraWxsZXJzID0gc2VhcmNoSGV1cmlzdGljcz8ua2lsbGVycyB8fCBudWxsOw0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCiAgICBjb25zdCB1c2VTaW1wbGVTZWFyY2hTb3J0ID0gcGllY2VTdGF0ZSAmJiAhY3VycmVudElzSW5DaGVjayAmJiAhaGFzVGhyZWF0ZW5lZCAmJiAhaGFzQ2FuQ2FwdHVyZTsNCiAgICBjb25zdCBpc01hcmtlZFRocmVhdGVuZWQgPSAoc3EpID0+IHsNCiAgICAgICAgaWYgKCFoYXNUaHJlYXRlbmVkKSByZXR1cm4gZmFsc2U7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhyZWF0ZW5lZE1hcmtFbmQ7IGkrKykgew0KICAgICAgICAgICAgaWYgKHNxdWFyZU1hcmtUb3VjaGVkW2ldID09PSBzcSkgcmV0dXJuIHRydWU7DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIGZhbHNlOw0KICAgIH07DQoNCiAgICBpZiAodXNlU2ltcGxlU2VhcmNoU29ydCkgew0KICAgICAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsNCiAgICAgICAgY29uc3QgcGllY2VDb2RlcyA9IHBpZWNlU3RhdGUucGllY2VDb2RlczsNCiAgICAgICAgY29uc3QgbWF0ZXJpYWxWYWx1ZXMgPSBzZWFyY2hNYXRlcmlhbFRhYmxlKGdhbWVTdGFnZSk7DQogICAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBtb3Zlcy5sZW5ndGg7IGluZGV4KyspIHsNCiAgICAgICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpbmRleF07DQogICAgICAgICAgICBjb25zdCBmcm9tU3EgPSBtb3ZlID4+PiA3Ow0KICAgICAgICAgICAgY29uc3QgdG9TcSA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7DQogICAgICAgICAgICBjb25zdCB0YXJnZXRTbG90ID0gc3F1YXJlVG9TbG90W3RvU3FdOw0KICAgICAgICAgICAgY29uc3QgdGFyZ2V0UGllY2VDb2RlID0gdGFyZ2V0U2xvdCA+PSAwID8gcGllY2VDb2Rlc1t0YXJnZXRTbG90XSA6IDA7DQogICAgICAgICAgICBsZXQgcHJpb3JpdHkgPSA0Ow0KICAgICAgICAgICAgbGV0IHNjb3JlID0gMDsNCg0KICAgICAgICAgICAgaWYgKHR0TW92ZSA9PT0gbW92ZSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gLTE7DQogICAgICAgICAgICAgICAgc2NvcmUgPSAxMDAwMDAwOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRTbG90ID49IDApIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDM7DQogICAgICAgICAgICAgICAgc2NvcmUgPSBtYXRlcmlhbFZhbHVlc1t0YXJnZXRQaWVjZUNvZGUgJiA3XSAqIDE2IC0gbWF0ZXJpYWxWYWx1ZXNbcGllY2VDb2Rlc1tzcXVhcmVUb1Nsb3RbZnJvbVNxXV0gJiA3XTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKHByaW9yaXR5ID49IDApIHsNCiAgICAgICAgICAgICAgICBpZiAodGFyZ2V0U2xvdCA8IDAgJiYga2lsbGVycyAmJiBtb3ZlID09PSBraWxsZXJzWzBdKSB7DQogICAgICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gTWF0aC5taW4ocHJpb3JpdHksIDIpOw0KICAgICAgICAgICAgICAgICAgICBzY29yZSArPSA4MDAwOw0KICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0U2xvdCA8IDAgJiYga2lsbGVycyAmJiBtb3ZlID09PSBraWxsZXJzWzFdKSB7DQogICAgICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gTWF0aC5taW4ocHJpb3JpdHksIDIpOw0KICAgICAgICAgICAgICAgICAgICBzY29yZSArPSA3MDAwOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBzY29yZSArPSBnZXRIaXN0b3J5U2NvcmUobW92ZSk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2luZGV4XSA9IHByaW9yaXR5Ow0KICAgICAgICAgICAgc29ydE1vdmVTY29yZVNjcmF0Y2hbaW5kZXhdID0gc2NvcmU7DQogICAgICAgIH0NCiAgICB9IGVsc2UgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG1vdmVzLmxlbmd0aDsgaW5kZXgrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbaW5kZXhdOw0KICAgICAgICBjb25zdCBmcm9tU3EgPSBtb3ZlRnJvbVNxKG1vdmUpOw0KICAgICAgICBjb25zdCB0b1NxID0gbW92ZVRvU3EobW92ZSk7DQogICAgICAgIGNvbnN0IGZyb21SID0gKGZyb21TcSAvIDkpIHwgMCwgZnJvbUMgPSBmcm9tU3EgJSA5Ow0KICAgICAgICBjb25zdCB0b1IgPSAodG9TcSAvIDkpIHwgMCwgdG9DID0gdG9TcSAlIDk7DQogICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbZnJvbVJdW2Zyb21DXTsNCiAgICAgICAgY29uc3QgcGllY2VWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUocGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgIGNvbnN0IHRhcmdldFBpZWNlID0gYm9hcmRbdG9SXVt0b0NdOw0KICAgICAgICBjb25zdCB0YXJnZXRQaWVjZVZhbHVlID0gdGFyZ2V0UGllY2UgPyBnZXRNYXRlcmlhbFZhbHVlKHRhcmdldFBpZWNlLCBnYW1lU3RhZ2UpIDogMDsNCiAgICAgICAgbGV0IHByaW9yaXR5ID0gNDsNCiAgICAgICAgbGV0IHNjb3JlID0gMDsNCg0KICAgICAgICBpZiAodHRNb3ZlICYmIGlzU2FtZU1vdmUobW92ZSwgdHRNb3ZlKSkgew0KICAgICAgICAgICAgcHJpb3JpdHkgPSAtMTsNCiAgICAgICAgICAgIHNjb3JlID0gMTAwMDAwMDsNCiAgICAgICAgfSBlbHNlIGlmIChjdXJyZW50SXNJbkNoZWNrKSB7DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlc0NoZWNrZXIgPSB0YXJnZXRQaWVjZSAmJiBzcXVhcmVNYXJrU2NyYXRjaFt0b1NxXSAhPT0gMDsNCiAgICAgICAgICAgIGlmIChjYXB0dXJlc0NoZWNrZXIpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDA7DQogICAgICAgICAgICAgICAgc2NvcmUgPSAxMDAwMCArIHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldFBpZWNlKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAyOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZSAqIDE2IC0gcGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAocGllY2UudHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgcHJpb3JpdHkgPSAzOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gcGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmIChoYXNUaHJlYXRlbmVkKSB7DQogICAgICAgICAgICBpZiAoaXNNYXJrZWRUaHJlYXRlbmVkKGZyb21TcSkpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDE7DQogICAgICAgICAgICAgICAgc2NvcmUgPSBwaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gaGFzQ2FuQ2FwdHVyZSAmJiBzcXVhcmVNYXJrU2NyYXRjaFt0b1NxXSAhPT0gMCA/IDIgOiAzOw0KICAgICAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIGlmIChoYXNDYW5DYXB0dXJlKSB7DQogICAgICAgICAgICBpZiAoc3F1YXJlTWFya1NjcmF0Y2hbdG9TcV0gIT09IDApIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDI7DQogICAgICAgICAgICAgICAgc2NvcmUgPSB0YXJnZXRQaWVjZVZhbHVlOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRQaWVjZSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgICAgICBzY29yZSA9IHRhcmdldFBpZWNlVmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0UGllY2UpIHsNCiAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgIHNjb3JlID0gdGFyZ2V0UGllY2VWYWx1ZSAqIDE2IC0gcGllY2VWYWx1ZTsNCiAgICAgICAgfQ0KDQogICAgICAgIGlmIChwcmlvcml0eSA+PSAwKSB7DQogICAgICAgICAgICBpZiAoIXRhcmdldFBpZWNlICYmIGtpbGxlcnMgJiYgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzWzBdKSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gTWF0aC5taW4ocHJpb3JpdHksIDIpOw0KICAgICAgICAgICAgICAgIHNjb3JlICs9IDgwMDA7DQogICAgICAgICAgICB9IGVsc2UgaWYgKCF0YXJnZXRQaWVjZSAmJiBraWxsZXJzICYmIGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc1sxXSkpIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IE1hdGgubWluKHByaW9yaXR5LCAyKTsNCiAgICAgICAgICAgICAgICBzY29yZSArPSA3MDAwOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgc2NvcmUgKz0gZ2V0SGlzdG9yeVNjb3JlKG1vdmUpOw0KICAgICAgICB9DQoNCiAgICAgICAgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaW5kZXhdID0gcHJpb3JpdHk7DQogICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2luZGV4XSA9IHNjb3JlOw0KICAgICAgICBpZiAoIWlzRW5jb2RlZE1vdmUobW92ZSkpIHsNCiAgICAgICAgICAgIG1vdmUucHJpb3JpdHkgPSBwcmlvcml0eTsNCiAgICAgICAgICAgIG1vdmUuc29ydFNjb3JlID0gc2NvcmU7DQogICAgICAgICAgICBtb3ZlLm9yaWdpbmFsSW5kZXggPSBpbmRleDsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGZvciAobGV0IGkgPSAxOyBpIDwgbW92ZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2ldOw0KICAgICAgICBjb25zdCBwcmlvcml0eSA9IHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2ldOw0KICAgICAgICBjb25zdCBzY29yZSA9IHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2ldOw0KICAgICAgICBsZXQgaiA9IGkgLSAxOw0KICAgICAgICB3aGlsZSAoDQogICAgICAgICAgICBqID49IDAgJiYNCiAgICAgICAgICAgIChzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXSA+IHByaW9yaXR5IHx8DQogICAgICAgICAgICAgKHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2pdID09PSBwcmlvcml0eSAmJiBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqXSA8IHNjb3JlKSkNCiAgICAgICAgKSB7DQogICAgICAgICAgICBtb3Zlc1tqICsgMV0gPSBtb3Zlc1tqXTsNCiAgICAgICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2ogKyAxXSA9IHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2pdOw0KICAgICAgICAgICAgc29ydE1vdmVTY29yZVNjcmF0Y2hbaiArIDFdID0gc29ydE1vdmVTY29yZVNjcmF0Y2hbal07DQogICAgICAgICAgICBqLS07DQogICAgICAgIH0NCiAgICAgICAgbW92ZXNbaiArIDFdID0gbW92ZTsNCiAgICAgICAgc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbaiArIDFdID0gcHJpb3JpdHk7DQogICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2ogKyAxXSA9IHNjb3JlOw0KICAgIH0NCg0KICAgIGNsZWFyU29ydFNxdWFyZU1hcmtzKCk7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuc29ydE1vdmVzTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIHJldHVybiBtb3ZlczsNCn07DQoNCi8vIFBsYXktb25seSBub3JtYWwtbm9kZSBvcmRlcmluZy4gcHJlcGFyZVNlYXJjaEluZm8gaGFzIG5vIHJlbGF0aW9uIGxpc3RzLCBzbw0KLy8gaXRzIG5vbi1jaGVjayBwYXRoIGlzIGV4YWN0bHkgdGhlIHNpbXBsZSBicmFuY2ggb2Ygc29ydE1vdmVzRmFzdCB3aXRob3V0IHRoZQ0KLy8gZ2VuZXJpYyBVSS9hbmFseXNpcyBib29ra2VlcGluZy4gQ2hlY2tlZCBwb3NpdGlvbnMgcmV0YWluIHRoZSBnZW5lcmljIG9yZGVyLg0KY29uc3Qgc29ydE1vdmVzUGxheSA9IChtb3ZlcywgYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIHBpZWNlc0luZm8sIGdhbWVTdGFnZSwgYm9hcmRJbmZvLCB0dE1vdmUsIGtpbGxlcnMsIGluQ2hlY2spID0+IHsNCiAgICBpZiAoaW5DaGVjaykgew0KICAgICAgICByZXR1cm4gc29ydE1vdmVzRmFzdChtb3ZlcywgYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIHBpZWNlc0luZm8sIGdhbWVTdGFnZSwgYm9hcmRJbmZvLCB7IHR0TW92ZSwga2lsbGVycyB9KTsNCiAgICB9DQogICAgY29uc3QgcGllY2VTdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOw0KICAgIGlmICghcGllY2VTdGF0ZSkgew0KICAgICAgICByZXR1cm4gc29ydE1vdmVzRmFzdChtb3ZlcywgYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIHBpZWNlc0luZm8sIGdhbWVTdGFnZSwgYm9hcmRJbmZvLCB7IHR0TW92ZSwga2lsbGVycyB9KTsNCiAgICB9DQoNCiAgICBjb25zdCBfX3QwID0gU0VBUkNIX1BST0ZJTEUgPyBwZXJmb3JtYW5jZS5ub3coKSA6IDA7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuc29ydE1vdmVzQ291bnQrKzsNCiAgICBjb25zdCBzcXVhcmVUb1Nsb3QgPSBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsNCiAgICBjb25zdCBwaWVjZUNvZGVzID0gcGllY2VTdGF0ZS5waWVjZUNvZGVzOw0KICAgIGNvbnN0IG1hdGVyaWFsVmFsdWVzID0gcGllY2VTdGF0ZS5tYXRlcmlhbFZhbHVlczsNCg0KICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBtb3Zlcy5sZW5ndGg7IGluZGV4KyspIHsNCiAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW2luZGV4XTsNCiAgICAgICAgY29uc3QgZnJvbVNxID0gbW92ZSA+Pj4gNzsNCiAgICAgICAgY29uc3QgdG9TcSA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7DQogICAgICAgIGNvbnN0IHRhcmdldFNsb3QgPSBzcXVhcmVUb1Nsb3RbdG9TcV07DQogICAgICAgIGxldCBwcmlvcml0eSA9IDQ7DQogICAgICAgIGxldCBzY29yZSA9IDA7DQoNCiAgICAgICAgaWYgKHR0TW92ZSA9PT0gbW92ZSkgew0KICAgICAgICAgICAgcHJpb3JpdHkgPSAtMTsNCiAgICAgICAgICAgIHNjb3JlID0gMTAwMDAwMDsNCiAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRTbG90ID49IDApIHsNCiAgICAgICAgICAgIHByaW9yaXR5ID0gMzsNCiAgICAgICAgICAgIHNjb3JlID0gbWF0ZXJpYWxWYWx1ZXNbcGllY2VDb2Rlc1t0YXJnZXRTbG90XSAmIDddICogMTYgLQ0KICAgICAgICAgICAgICAgIG1hdGVyaWFsVmFsdWVzW3BpZWNlQ29kZXNbc3F1YXJlVG9TbG90W2Zyb21TcV1dICYgN107DQogICAgICAgIH0NCg0KICAgICAgICBpZiAocHJpb3JpdHkgPj0gMCkgew0KICAgICAgICAgICAgaWYgKHRhcmdldFNsb3QgPCAwICYmIGtpbGxlcnMgJiYgbW92ZSA9PT0ga2lsbGVyc1swXSkgew0KICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gMjsNCiAgICAgICAgICAgICAgICBzY29yZSArPSA4MDAwOw0KICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXRTbG90IDwgMCAmJiBraWxsZXJzICYmIG1vdmUgPT09IGtpbGxlcnNbMV0pIHsNCiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IDI7DQogICAgICAgICAgICAgICAgc2NvcmUgKz0gNzAwMDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHNjb3JlICs9IGdldEhpc3RvcnlTY29yZShtb3ZlKTsNCiAgICAgICAgfQ0KDQogICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2luZGV4XSA9IHByaW9yaXR5Ow0KICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtpbmRleF0gPSBzY29yZTsNCiAgICB9DQoNCiAgICBmb3IgKGxldCBpID0gMTsgaSA8IG1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1tpXTsNCiAgICAgICAgY29uc3QgcHJpb3JpdHkgPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtpXTsNCiAgICAgICAgY29uc3Qgc2NvcmUgPSBzb3J0TW92ZVNjb3JlU2NyYXRjaFtpXTsNCiAgICAgICAgbGV0IGogPSBpIC0gMTsNCiAgICAgICAgd2hpbGUgKA0KICAgICAgICAgICAgaiA+PSAwICYmDQogICAgICAgICAgICAoc29ydE1vdmVQcmlvcml0eVNjcmF0Y2hbal0gPiBwcmlvcml0eSB8fA0KICAgICAgICAgICAgIChzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXSA9PT0gcHJpb3JpdHkgJiYgc29ydE1vdmVTY29yZVNjcmF0Y2hbal0gPCBzY29yZSkpDQogICAgICAgICkgew0KICAgICAgICAgICAgbW92ZXNbaiArIDFdID0gbW92ZXNbal07DQogICAgICAgICAgICBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqICsgMV0gPSBzb3J0TW92ZVByaW9yaXR5U2NyYXRjaFtqXTsNCiAgICAgICAgICAgIHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2ogKyAxXSA9IHNvcnRNb3ZlU2NvcmVTY3JhdGNoW2pdOw0KICAgICAgICAgICAgai0tOw0KICAgICAgICB9DQogICAgICAgIG1vdmVzW2ogKyAxXSA9IG1vdmU7DQogICAgICAgIHNvcnRNb3ZlUHJpb3JpdHlTY3JhdGNoW2ogKyAxXSA9IHByaW9yaXR5Ow0KICAgICAgICBzb3J0TW92ZVNjb3JlU2NyYXRjaFtqICsgMV0gPSBzY29yZTsNCiAgICB9DQoNCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5zb3J0TW92ZXNNcyArPSBwZXJmb3JtYW5jZS5ub3coKSAtIF9fdDA7DQogICAgcmV0dXJuIG1vdmVzOw0KfTsNCg0KLy8g5pCc57Si55So552A5rOV5YeG5aSH77yI6L276YeP77yJ77ya5LiN5bu65YWz57O75Zu+L+WogeiDgS/mnLrliqjmgKcNCi8vIFNFQVJDSF9ERUZFUl9MRUdBTElUWT10cnVl77ya5Y+q55Sf5oiQ5Lyq5ZCI5rOV77yM5ZCI5rOV5oCn5Zyo6K+V6LWw5pe25qOA5rWLDQovLyBTRUFSQ0hfREVGRVJfTEVHQUxJVFk9ZmFsc2XvvJrpooTov4fmu6TlkIjms5XnnYDvvIjml6fot6/lvoTvvIzkvr/kuo4gQS9C77yJDQovLyDngrnmo4vlhbPns7vku43otbDlrozmlbQgZXZhbHVhdGVCb2FyZO+8jOS4jeWPl+W9seWTjQ0KY29uc3QgcHJlcGFyZVNlYXJjaEluZm8gPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIsIGNvbGxlY3RQaWVjZXNJbmZvID0gdHJ1ZSkgPT4gewogICAgY29uc3QgX190MCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOw0KICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudFtjdXJyZW50UGxheWVyXSsrOwoNCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVja1Jhdyhib2FyZCwgY3VycmVudFBsYXllcik7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMucHJlcGFyZUNoZWNrTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOw0KICAgIGNvbnN0IF9fbW92ZXNUMCA9IFNFQVJDSF9QUk9GSUxFID8gcGVyZm9ybWFuY2Uubm93KCkgOiAwOw0KICAgIC8vIFRoZSBQbGF5IG5vbi1jaGVjayBzb3J0ZXIgb25seSB1c2VzIHBhY2tlZCBzdGF0ZS4gQXZvaWQgcGVyLXBpZWNlIG9iamVjdHMKICAgIC8vIHVubGVzcyB0aGUgY2hlY2tlZC1wb3NpdGlvbiBmYWxsYmFjayBhY3R1YWxseSBuZWVkcyByZWxhdGlvbiBtZXRhZGF0YS4KICAgIGNvbnN0IHBpZWNlc0luZm8gPSAoY29sbGVjdFBpZWNlc0luZm8gfHwgaW5DaGVjaykgPyBbXSA6IG51bGw7CiAgICBjb25zdCBsZWdhbE1vdmVMaXN0ID0gW107DQogICAgY29uc3QgZGVmZXIgPSB0cnVlOw0KICAgIGNvbnN0IHBpZWNlU3RhdGUgPSBhY3RpdmVQaWVjZVN0YXRlRm9yKGJvYXJkKTsNCg0KICAgIGlmIChwaWVjZVN0YXRlKSB7DQogICAgICAgIGNvbnN0IHJlY29yZHMgPSBwaWVjZVN0YXRlLnJlY29yZHM7DQogICAgICAgIGNvbnN0IHNxdWFyZVRvU2xvdCA9IHBpZWNlU3RhdGUuc3F1YXJlVG9TbG90Ow0KICAgICAgICBjb25zdCBzcXVhcmVDb2RlcyA9IHBpZWNlU3RhdGUuc3F1YXJlQ29kZXM7DQogICAgICAgIGNvbnN0IHBpZWNlQ29kZXMgPSBwaWVjZVN0YXRlLnBpZWNlQ29kZXM7DQogICAgICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgew0KICAgICAgICAgICAgY29uc3Qgc2xvdCA9IHNxdWFyZVRvU2xvdFtzcV07DQogICAgICAgICAgICBpZiAoc2xvdCA8IDApIGNvbnRpbnVlOw0KICAgICAgICAgICAgY29uc3QgcmVjb3JkID0gcmVjb3Jkc1tzbG90XTsNCiAgICAgICAgICAgIGlmICghcmVjb3JkLmFsaXZlIHx8IHJlY29yZC5waWVjZS5jb2xvciAhPT0gY3VycmVudFBsYXllcikgY29udGludWU7DQogICAgICAgICAgICBpZiAocGllY2VzSW5mbykgcGllY2VzSW5mby5wdXNoKHsgcGllY2U6IHJlY29yZC5waWVjZSwgcjogcmVjb3JkLnIsIGM6IHJlY29yZC5jIH0pOwogICAgICAgICAgICBjb25zdCBnZW5lcmF0ZWQgPSBhcHBlbmRTZWFyY2hQc2V1ZG9Nb3Zlc0ZvclBpZWNlKAogICAgICAgICAgICAgICAgbGVnYWxNb3ZlTGlzdCwgc3EsIHBpZWNlQ29kZXNbc2xvdF0sIHNxdWFyZUNvZGVzLCBmYWxzZQogICAgICAgICAgICApOwogICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkICs9IGdlbmVyYXRlZDsKICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCBST1dTOyByKyspIHsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgICAgICBpZiAoIXBpZWNlIHx8IHBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBjb25zdCBmcm9tID0geyByLCBjIH07DQogICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCBmcm9tLCBwaWVjZSk7DQogICAgICAgICAgICAgICAgY29uc3QgdXNlTW92ZXMgPSBkZWZlciA/IG1vdmVzIDogZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UsIG1vdmVzKTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2VzSW5mbykgcGllY2VzSW5mby5wdXNoKHsgcGllY2UsIHIsIGMsIG1vdmVzLCBsZWdhbE1vdmVzOiB1c2VNb3ZlcyB9KTsKICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdXNlTW92ZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG8gPSB1c2VNb3Zlc1tpXTsNCiAgICAgICAgICAgICAgICAgICAgbGVnYWxNb3ZlTGlzdC5wdXNoKGVuY29kZU1vdmVGcm9tQ29vcmRzKHIsIGMsIHRvLnIsIHRvLmMpKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCArPSBtb3Zlcy5sZW5ndGg7CiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5wcmVwYXJlTW92ZUdlbk1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX19tb3Zlc1QwOw0KDQogICAgLy8g6L276YePIGJvYXJkSW5mb++8muS7heiiq+Wwhuagh+W/lw0KICAgIGNvbnN0IGJvYXJkSW5mbyA9IHsNCiAgICAgICAgcmVkSXNJbkNoZWNrOiBjdXJyZW50UGxheWVyID09PSAncmVkJyA/IGluQ2hlY2sgOiBmYWxzZSwNCiAgICAgICAgYmxhY2tJc0luQ2hlY2s6IGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgPyBpbkNoZWNrIDogZmFsc2UsDQogICAgICAgIGdhbWVTdGF0ZTogbnVsbA0KICAgIH07DQoNCiAgICBpZiAobGVnYWxNb3ZlTGlzdC5sZW5ndGggPT09IDApIHsNCiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IGluQ2hlY2sNCiAgICAgICAgICAgID8geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH0NCiAgICAgICAgICAgIDogeyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfSBlbHNlIHsNCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAncGxheWluZycgfTsNCiAgICB9DQoNCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsNCiAgICByZXR1cm4geyBwaWVjZXNJbmZvLCBib2FyZEluZm8sIGxlZ2FsTW92ZUxpc3QsIGluQ2hlY2sgfTsNCn07DQoNCi8vIOiuoeeul+ihjeeUn+WAvO+8muWogeiDgeWAvOOAgeWuieWFqOWAvOOAgeaImOacr+WAvOOAgeacuuWKqOWAvA0KY29uc3QgY2FsY3VsYXRlRGVyaXZlZFZhbHVlcyA9IChib2FyZCwgcGllY2VzSW5mbywgY3VycmVudFBsYXllciA9IG51bGwsIGJvYXJkSW5mbyA9IG51bGwsIGZvclNlYXJjaExlYWYgPSBmYWxzZSkgPT4gew0KICAgIC8vIOmHjee9ruaJgOacieihjeeUn+WAvO+8jOmZpOS6huacuuWKqOWAvO+8iOW3suWcqOaUtumbhuaji+WtkOS/oeaBr+aXtuiuoeeul++8iQ0KICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgIGluZm8udGhyZWF0VmFsdWUgPSAwOw0KICAgICAgICBpbmZvLnNhZmV0eVZhbHVlID0gMDsNCiAgICAgICAgaW5mby50YWN0aWNWYWx1ZSA9IDA7DQogICAgICAgIC8vIOS/neeVmeacuuWKqOWAvO+8jOWboOS4uuW3suWcqOaUtumbhuaji+WtkOS/oeaBr+aXtuiuoeeulw0KICAgIH0NCiAgICANCiAgICAvLyAxLiDorqHnrpfmo4vlrZDlhbPns7vvvIjlqIHog4HogIXjgIHooqvlqIHog4HogIXjgIHkv53miqTogIXjgIHooqvkv53miqTogIXvvIkNCiAgICBpZiAoIWJvYXJkSW5mbykgew0KICAgICAgICBib2FyZEluZm8gPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKS5tYXAoKCkgPT4gW10pKTsNCiAgICB9DQogICAgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMoYm9hcmQsIHBpZWNlc0luZm8sIGJvYXJkSW5mbyk7DQogICAgDQogICAgLy8gMi4g6K6h566X5aiB6IOB5YC877yI5oyJ6KKr5aiB6IOB5a2Q6IGa5ZCI77yMU0VFIOavj+ebruagh+S4gOasoe+8iQ0KICAgIGNhbGN1bGF0ZVRhY3RpY2FsVmFsdWVzKHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbywgYm9hcmQsIGZvclNlYXJjaExlYWYpOw0KICAgIA0KICAgIC8vIDQuIOiuoeeul+a4uOaIj+eKtuaAgeW5tuS/neWtmOWIsGJvYXJkSW5mbw0KICAgIC8vIOaQnOe0ouWPtuiKgueCuei3s+i/h++8muaXoOedgC/lsIbmrbvlt7LlnKjniLboioLngrnlpITnkIbvvIzmraTlpITlj6rpnIDpnZnmgIHliIYNCiAgICBpZiAoY3VycmVudFBsYXllciAmJiAhZm9yU2VhcmNoTGVhZikgew0KICAgICAgICAvLyDmo4Dmn6XlvZPliY3njqnlrrbmmK/lkKbmnInlkIjms5XotbDms5UNCiAgICAgICAgbGV0IGhhc01vdmVzID0gZmFsc2U7DQogICAgICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgICAgICBpZiAoaW5mby5waWVjZS5jb2xvciA9PT0gY3VycmVudFBsYXllcikgew0KICAgICAgICAgICAgICAgIC8vIOiOt+WPluW9k+WJjeaji+WtkOeahOacieaViOi1sOazlQ0KICAgICAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gZ2V0VmFsaWRNb3Zlcyhib2FyZCwgeyByOiBpbmZvLnIsIGM6IGluZm8uYyB9KTsNCiAgICAgICAgICAgICAgICBpZiAobW92ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgICAgICBoYXNNb3ZlcyA9IHRydWU7DQogICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICANCiAgICAgICAgLy8g5Yik5pat5ri45oiP54q25oCBDQogICAgICAgIGxldCBnYW1lU3RhdGUgPSB7IHN0YXR1czogJ3BsYXlpbmcnIH07DQogICAgICAgIGlmICghaGFzTW92ZXMpIHsNCiAgICAgICAgICAgIC8vIOayoeacieWQiOazlei1sOazle+8jOajgOafpeaYr+WQpuiiq+WwhuWGmw0KICAgICAgICAgICAgY29uc3QgaW5DaGVjayA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZElzSW5DaGVjayA6IGJvYXJkSW5mby5ibGFja0lzSW5DaGVjazsNCiAgICAgICAgICAgIGNvbnN0IG9wcG9uZW50ID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChpbkNoZWNrKSB7DQogICAgICAgICAgICAgICAgZ2FtZVN0YXRlID0geyBzdGF0dXM6ICdjaGVja21hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGdhbWVTdGF0ZSA9IHsgc3RhdHVzOiAnc3RhbGVtYXRlJywgd2lubmVyOiBvcHBvbmVudCB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyDkv53lrZjmuLjmiI/nirbmgIHliLBib2FyZEluZm8NCiAgICAgICAgYm9hcmRJbmZvLmdhbWVTdGF0ZSA9IGdhbWVTdGF0ZTsNCiAgICB9DQp9Ow0KDQovLyDmo4vlrZDlh6DkvZXmlrnlkJHooajvvIjpooTorqHnrpfohb8v55y85YGP56e777yM54Ot6Lev5b6E6YG/5YWNIE1hdGguc2lnbiAvIGRyLzLvvIkNCmNvbnN0IE9SVEhfRElSUyA9IFsNCiAgICBbMCwgMV0sIFswLCAtMV0sIFsxLCAwXSwgWy0xLCAwXQ0KXTsNCmNvbnN0IERJQUdfRElSUyA9IFsNCiAgICBbMSwgMV0sIFsxLCAtMV0sIFstMSwgMV0sIFstMSwgLTFdDQpdOw0KY29uc3QgRUxFUEhBTlRfRElSUyA9IFsNCiAgICB7IGRyOiAyLCBkYzogMiwgZXllRHI6IDEsIGV5ZURjOiAxIH0sDQogICAgeyBkcjogMiwgZGM6IC0yLCBleWVEcjogMSwgZXllRGM6IC0xIH0sDQogICAgeyBkcjogLTIsIGRjOiAyLCBleWVEcjogLTEsIGV5ZURjOiAxIH0sDQogICAgeyBkcjogLTIsIGRjOiAtMiwgZXllRHI6IC0xLCBleWVEYzogLTEgfQ0KXTsNCmNvbnN0IEhPUlNFX0RJUlMgPSBbDQogICAgeyBkcjogMiwgZGM6IDEsIGxlZ0RyOiAxLCBsZWdEYzogMCB9LA0KICAgIHsgZHI6IDIsIGRjOiAtMSwgbGVnRHI6IDEsIGxlZ0RjOiAwIH0sDQogICAgeyBkcjogLTIsIGRjOiAxLCBsZWdEcjogLTEsIGxlZ0RjOiAwIH0sDQogICAgeyBkcjogLTIsIGRjOiAtMSwgbGVnRHI6IC0xLCBsZWdEYzogMCB9LA0KICAgIHsgZHI6IDEsIGRjOiAyLCBsZWdEcjogMCwgbGVnRGM6IDEgfSwNCiAgICB7IGRyOiAxLCBkYzogLTIsIGxlZ0RyOiAwLCBsZWdEYzogLTEgfSwNCiAgICB7IGRyOiAtMSwgZGM6IDIsIGxlZ0RyOiAwLCBsZWdEYzogMSB9LA0KICAgIHsgZHI6IC0xLCBkYzogLTIsIGxlZ0RyOiAwLCBsZWdEYzogLTEgfQ0KXTsNCg0KLy8g55+t5q2l5a2Q6aKE6KGo77ya5LiO5Y6fIHN3aXRjaCDmlrnlkJHpobrluo8v5a6r5rKz6L+H5ruk5LiA6Ie077yb6ams6LGh5bimIGJyLGJj77yI6IW/L+ecvO+8iQ0KY29uc3QgR0VORVJBTF9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgQURWSVNPUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgRUxFUEhBTlRfREVTVCA9IFtuZXcgQXJyYXkoUkVMX1NRVUFSRVMpLCBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpXTsNCmNvbnN0IEhPUlNFX0RFU1QgPSBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpOw0KY29uc3QgU09MRElFUl9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KDQooKCkgPT4gew0KICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICAgICAgICBjb25zdCBzcSA9IHIgKiA5ICsgYzsNCiAgICAgICAgICAgIGNvbnN0IGdSZWQgPSBbXSwgZ0JsYWNrID0gW10sIGFSZWQgPSBbXSwgYUJsYWNrID0gW107DQogICAgICAgICAgICBjb25zdCBlUmVkID0gW10sIGVCbGFjayA9IFtdLCBob3JzZSA9IFtdLCBzUmVkID0gW10sIHNCbGFjayA9IFtdOw0KDQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIE9SVEhfRElSU1tpXVswXSwgbmMgPSBjICsgT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPj0gMCAmJiBuciA8PSAyKSBnUmVkLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgaWYgKG5yID49IDcgJiYgbnIgPD0gOSkgZ0JsYWNrLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IERJQUdfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IG5yID0gciArIERJQUdfRElSU1tpXVswXSwgbmMgPSBjICsgRElBR19ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAobnIgPj0gMCAmJiBuciA8PSAyKSBhUmVkLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgaWYgKG5yID49IDcgJiYgbnIgPD0gOSkgYUJsYWNrLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IEVMRVBIQU5UX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBkID0gRUxFUEhBTlRfRElSU1tpXTsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBkLmRyLCBuYyA9IGMgKyBkLmRjOw0KICAgICAgICAgICAgICAgIGlmIChuciA8IDAgfHwgbnIgPj0gUk9XUyB8fCBuYyA8IDAgfHwgbmMgPj0gQ09MUykgY29udGludWU7DQogICAgICAgICAgICAgICAgY29uc3QgZXllUiA9IHIgKyBkLmV5ZURyLCBleWVDID0gYyArIGQuZXllRGM7DQogICAgICAgICAgICAgICAgaWYgKG5yIDw9IDQpIGVSZWQucHVzaCh7IHI6IG5yLCBjOiBuYywgYnI6IGV5ZVIsIGJjOiBleWVDIH0pOw0KICAgICAgICAgICAgICAgIGlmIChuciA+PSA1KSBlQmxhY2sucHVzaCh7IHI6IG5yLCBjOiBuYywgYnI6IGV5ZVIsIGJjOiBleWVDIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBIT1JTRV9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IEhPUlNFX0RJUlNbaV07DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgZC5kciwgbmMgPSBjICsgZC5kYzsNCiAgICAgICAgICAgICAgICBjb25zdCBsZWdSID0gciArIGQubGVnRHIsIGxlZ0MgPSBjICsgZC5sZWdEYzsNCiAgICAgICAgICAgICAgICBpZiAobGVnUiA8IDAgfHwgbGVnUiA+PSBST1dTIHx8IGxlZ0MgPCAwIHx8IGxlZ0MgPj0gQ09MUykgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKG5yIDwgMCB8fCBuciA+PSBST1dTIHx8IG5jIDwgMCB8fCBuYyA+PSBDT0xTKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBob3JzZS5wdXNoKHsgcjogbnIsIGM6IG5jLCBicjogbGVnUiwgYmM6IGxlZ0MgfSk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICB7DQogICAgICAgICAgICAgICAgY29uc3QgZnIgPSByICsgMTsNCiAgICAgICAgICAgICAgICBpZiAoZnIgPj0gMCAmJiBmciA8IFJPV1MpIHNSZWQucHVzaCh7IHI6IGZyLCBjIH0pOw0KICAgICAgICAgICAgICAgIGlmIChyID49IDUpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGMgLSAxID49IDApIHNSZWQucHVzaCh7IHIsIGM6IGMgLSAxIH0pOw0KICAgICAgICAgICAgICAgICAgICBpZiAoYyArIDEgPCBDT0xTKSBzUmVkLnB1c2goeyByLCBjOiBjICsgMSB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgY29uc3QgZmJyID0gciAtIDE7DQogICAgICAgICAgICAgICAgaWYgKGZiciA+PSAwICYmIGZiciA8IFJPV1MpIHNCbGFjay5wdXNoKHsgcjogZmJyLCBjIH0pOw0KICAgICAgICAgICAgICAgIGlmIChyIDw9IDQpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGMgLSAxID49IDApIHNCbGFjay5wdXNoKHsgciwgYzogYyAtIDEgfSk7DQogICAgICAgICAgICAgICAgICAgIGlmIChjICsgMSA8IENPTFMpIHNCbGFjay5wdXNoKHsgciwgYzogYyArIDEgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBHRU5FUkFMX0RFU1RbMF1bc3FdID0gZ1JlZDsNCiAgICAgICAgICAgIEdFTkVSQUxfREVTVFsxXVtzcV0gPSBnQmxhY2s7DQogICAgICAgICAgICBBRFZJU09SX0RFU1RbMF1bc3FdID0gYVJlZDsNCiAgICAgICAgICAgIEFEVklTT1JfREVTVFsxXVtzcV0gPSBhQmxhY2s7DQogICAgICAgICAgICBFTEVQSEFOVF9ERVNUWzBdW3NxXSA9IGVSZWQ7DQogICAgICAgICAgICBFTEVQSEFOVF9ERVNUWzFdW3NxXSA9IGVCbGFjazsNCiAgICAgICAgICAgIEhPUlNFX0RFU1Rbc3FdID0gaG9yc2U7DQogICAgICAgICAgICBTT0xESUVSX0RFU1RbMF1bc3FdID0gc1JlZDsNCiAgICAgICAgICAgIFNPTERJRVJfREVTVFsxXVtzcV0gPSBzQmxhY2s7DQogICAgICAgIH0NCiAgICB9DQp9KSgpOw0KDQpjb25zdCBTRUFSQ0hfR0VORVJBTF9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgU0VBUkNIX0FEVklTT1JfREVTVCA9IFtuZXcgQXJyYXkoUkVMX1NRVUFSRVMpLCBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpXTsNCmNvbnN0IFNFQVJDSF9FTEVQSEFOVF9ERVNUID0gW25ldyBBcnJheShSRUxfU1FVQVJFUyksIG5ldyBBcnJheShSRUxfU1FVQVJFUyldOw0KY29uc3QgU0VBUkNIX0hPUlNFX0RFU1QgPSBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpOw0KY29uc3QgU0VBUkNIX1NPTERJRVJfREVTVCA9IFtuZXcgQXJyYXkoUkVMX1NRVUFSRVMpLCBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpXTsNCi8vIEFsbCBvcnRob2dvbmFsIHJheXMgbGl2ZSBpbiBvbmUgY29tcGFjdCBidWZmZXIuIFRoZSBvZmZzZXQgdGFibGUgYXZvaWRzDQovLyBodW5kcmVkcyBvZiB0aW55IFR5cGVkQXJyYXlzIGluIHRoZSByZWxhdGlvbiwgcHNldWRvLW1vdmUsIGFuZCBjaGVjayBwYXRocy4NCmNvbnN0IFNFQVJDSF9SQVlfT0ZGU0VUUyA9IG5ldyBVaW50MTZBcnJheShSRUxfU1FVQVJFUyAqIE9SVEhfRElSUy5sZW5ndGggKyAxKTsNCmxldCBTRUFSQ0hfUkFZX1NRVUFSRVMgPSBudWxsOw0KY29uc3QgU0VBUkNIX1JBWV9ESVJTID0gNDsNCmNvbnN0IFNFQVJDSF9IT1JTRV9DSEVDS0VSUyA9IG5ldyBBcnJheShSRUxfU1FVQVJFUyk7CmNvbnN0IFNFQVJDSF9TUV9ST1dTID0gbmV3IFVpbnQ4QXJyYXkoUkVMX1NRVUFSRVMpOwpjb25zdCBTRUFSQ0hfU1FfQ09MUyA9IG5ldyBVaW50OEFycmF5KFJFTF9TUVVBUkVTKTsKLy8gUGxheSBudW1lcmljIHNhZmV0eSBvbmx5IHF1ZXJpZXMgZW1wdHkgZGVzdGluYXRpb25zIGluIHRoZSBvcHBvc2luZyBnZW5lcmFsJ3MgcGFsYWNlLgovLyBiaXQgMDogcmVkIGF0dGFjayBpcyByZWxldmFudCAoYmxhY2sgcGFsYWNlKTsgYml0IDE6IGJsYWNrIGF0dGFjayBpcyByZWxldmFudCAocmVkIHBhbGFjZSkuCmNvbnN0IFNFQVJDSF9QTEFZX0FUVEFDS19UQVJHRVQgPSBuZXcgVWludDhBcnJheShSRUxfU1FVQVJFUyk7Cg0KKCgpID0+IHsNCiAgICBjb25zdCBzZWFyY2hSYXlTcXVhcmVzID0gW107DQogICAgY29uc3Qgc3F1YXJlRGVzdGluYXRpb25zID0gKGRlc3RzKSA9PiB7DQogICAgICAgIGNvbnN0IHBhY2tlZCA9IG5ldyBVaW50OEFycmF5KGRlc3RzLmxlbmd0aCk7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHBhY2tlZFtpXSA9IGRlc3RzW2ldLnIgKiA5ICsgZGVzdHNbaV0uYzsNCiAgICAgICAgcmV0dXJuIHBhY2tlZDsNCiAgICB9Ow0KICAgIGNvbnN0IGJsb2NrZWREZXN0aW5hdGlvbnMgPSAoZGVzdHMpID0+IHsNCiAgICAgICAgY29uc3QgcGFja2VkID0gbmV3IFVpbnQxNkFycmF5KGRlc3RzLmxlbmd0aCk7DQogICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIHBhY2tlZFtpXSA9IChkZXN0c1tpXS5iciAqIDkgKyBkZXN0c1tpXS5iYykgKiAxMjggKyBkZXN0c1tpXS5yICogOSArIGRlc3RzW2ldLmM7DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIHBhY2tlZDsNCiAgICB9Ow0KDQogICAgZm9yIChsZXQgc3EgPSAwOyBzcSA8IFJFTF9TUVVBUkVTOyBzcSsrKSB7DQogICAgICAgIFNFQVJDSF9HRU5FUkFMX0RFU1RbMF1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKEdFTkVSQUxfREVTVFswXVtzcV0pOw0KICAgICAgICBTRUFSQ0hfR0VORVJBTF9ERVNUWzFdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhHRU5FUkFMX0RFU1RbMV1bc3FdKTsNCiAgICAgICAgU0VBUkNIX0FEVklTT1JfREVTVFswXVtzcV0gPSBzcXVhcmVEZXN0aW5hdGlvbnMoQURWSVNPUl9ERVNUWzBdW3NxXSk7DQogICAgICAgIFNFQVJDSF9BRFZJU09SX0RFU1RbMV1bc3FdID0gc3F1YXJlRGVzdGluYXRpb25zKEFEVklTT1JfREVTVFsxXVtzcV0pOw0KICAgICAgICBTRUFSQ0hfRUxFUEhBTlRfREVTVFswXVtzcV0gPSBibG9ja2VkRGVzdGluYXRpb25zKEVMRVBIQU5UX0RFU1RbMF1bc3FdKTsNCiAgICAgICAgU0VBUkNIX0VMRVBIQU5UX0RFU1RbMV1bc3FdID0gYmxvY2tlZERlc3RpbmF0aW9ucyhFTEVQSEFOVF9ERVNUWzFdW3NxXSk7DQogICAgICAgIFNFQVJDSF9IT1JTRV9ERVNUW3NxXSA9IGJsb2NrZWREZXN0aW5hdGlvbnMoSE9SU0VfREVTVFtzcV0pOw0KICAgICAgICBTRUFSQ0hfU09MRElFUl9ERVNUWzBdW3NxXSA9IHNxdWFyZURlc3RpbmF0aW9ucyhTT0xESUVSX0RFU1RbMF1bc3FdKTsNCiAgICAgICAgU0VBUkNIX1NPTERJRVJfREVTVFsxXVtzcV0gPSBzcXVhcmVEZXN0aW5hdGlvbnMoU09MRElFUl9ERVNUWzFdW3NxXSk7DQoNCiAgICAgICAgY29uc3QgciA9IChzcSAvIDkpIHwgMDsKICAgICAgICBjb25zdCBjID0gc3EgJSA5OwogICAgICAgIFNFQVJDSF9TUV9ST1dTW3NxXSA9IHI7CiAgICAgICAgU0VBUkNIX1NRX0NPTFNbc3FdID0gYzsKICAgICAgICBpZiAoYyA+PSAzICYmIGMgPD0gNSkgewogICAgICAgICAgICBpZiAociA8PSAyKSBTRUFSQ0hfUExBWV9BVFRBQ0tfVEFSR0VUW3NxXSA9IDI7CiAgICAgICAgICAgIGVsc2UgaWYgKHIgPj0gNykgU0VBUkNIX1BMQVlfQVRUQUNLX1RBUkdFVFtzcV0gPSAxOwogICAgICAgIH0KICAgICAgICBmb3IgKGxldCBkaXIgPSAwOyBkaXIgPCBPUlRIX0RJUlMubGVuZ3RoOyBkaXIrKykgew0KICAgICAgICAgICAgU0VBUkNIX1JBWV9PRkZTRVRTWyhzcSA8PCAyKSB8IGRpcl0gPSBzZWFyY2hSYXlTcXVhcmVzLmxlbmd0aDsNCiAgICAgICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2Rpcl1bMF07DQogICAgICAgICAgICBjb25zdCBkYyA9IE9SVEhfRElSU1tkaXJdWzFdOw0KICAgICAgICAgICAgZm9yIChsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOyBuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUzsgbnIgKz0gZHIsIG5jICs9IGRjKSB7DQogICAgICAgICAgICAgICAgc2VhcmNoUmF5U3F1YXJlcy5wdXNoKG5yICogOSArIG5jKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIGNvbnN0IGhvcnNlQ2hlY2tlcnMgPSBbXTsNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBIT1JTRV9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBkID0gSE9SU0VfRElSU1tpXTsNCiAgICAgICAgICAgIGNvbnN0IGhvcnNlUiA9IHIgKyBkLmRyOw0KICAgICAgICAgICAgY29uc3QgaG9yc2VDID0gYyArIGQuZGM7DQogICAgICAgICAgICBpZiAoaG9yc2VSIDwgMCB8fCBob3JzZVIgPj0gUk9XUyB8fCBob3JzZUMgPCAwIHx8IGhvcnNlQyA+PSBDT0xTKSBjb250aW51ZTsNCiAgICAgICAgICAgIGNvbnN0IGxlZ1IgPSBob3JzZVIgLSBkLmxlZ0RyOw0KICAgICAgICAgICAgY29uc3QgbGVnQyA9IGhvcnNlQyAtIGQubGVnRGM7DQogICAgICAgICAgICBob3JzZUNoZWNrZXJzLnB1c2goKGxlZ1IgKiA5ICsgbGVnQykgKiAxMjggKyBob3JzZVIgKiA5ICsgaG9yc2VDKTsNCiAgICAgICAgfQ0KICAgICAgICBTRUFSQ0hfSE9SU0VfQ0hFQ0tFUlNbc3FdID0gbmV3IFVpbnQxNkFycmF5KGhvcnNlQ2hlY2tlcnMpOw0KICAgIH0NCiAgICBTRUFSQ0hfUkFZX09GRlNFVFNbUkVMX1NRVUFSRVMgPDwgMl0gPSBzZWFyY2hSYXlTcXVhcmVzLmxlbmd0aDsNCiAgICBTRUFSQ0hfUkFZX1NRVUFSRVMgPSBuZXcgVWludDhBcnJheShzZWFyY2hSYXlTcXVhcmVzKTsNCn0pKCk7DQoNCmNvbnN0IGFwcGVuZFNlYXJjaFNob3J0TW92ZXMgPSAobW92ZXMsIGZyb21TcSwgZGVzdHMsIHNxdWFyZUNvZGVzLCBpc1JlZCwgY2FwdHVyZXNPbmx5LCBibG9ja2VkKSA9PiB7DQogICAgbGV0IGdlbmVyYXRlZCA9IDA7DQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICBsZXQgdG9TcSA9IGRlc3RzW2ldOw0KICAgICAgICBpZiAoYmxvY2tlZCkgew0KICAgICAgICAgICAgaWYgKHNxdWFyZUNvZGVzW3RvU3EgPj4+IDddICE9PSAwKSBjb250aW51ZTsNCiAgICAgICAgICAgIHRvU3EgJj0gMTI3Ow0KICAgICAgICB9DQogICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1t0b1NxXTsNCiAgICAgICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsNCiAgICAgICAgICAgIGdlbmVyYXRlZCsrOw0KICAgICAgICAgICAgaWYgKCFjYXB0dXJlc09ubHkpIG1vdmVzLnB1c2goKGZyb21TcSA8PCA3KSB8IHRvU3EpOw0KICAgICAgICB9IGVsc2UgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSB7DQogICAgICAgICAgICBnZW5lcmF0ZWQrKzsNCiAgICAgICAgICAgIG1vdmVzLnB1c2goKGZyb21TcSA8PCA3KSB8IHRvU3EpOw0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiBnZW5lcmF0ZWQ7DQp9Ow0KDQpjb25zdCBhcHBlbmRTZWFyY2hQc2V1ZG9Nb3Zlc0ZvclBpZWNlID0gKG1vdmVzLCBmcm9tU3EsIHBpZWNlQ29kZSwgc3F1YXJlQ29kZXMsIGNhcHR1cmVzT25seSA9IGZhbHNlKSA9PiB7DQogICAgY29uc3QgcGllY2VUeXBlID0gcGllY2VDb2RlICYgNzsNCiAgICBjb25zdCBpc1JlZCA9IHBpZWNlQ29kZSA8IDg7DQogICAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOw0KICAgIGxldCBnZW5lcmF0ZWQgPSAwOw0KDQogICAgc3dpdGNoIChwaWVjZVR5cGUpIHsNCiAgICAgICAgY2FzZSAxOg0KICAgICAgICAgICAgcmV0dXJuIGFwcGVuZFNlYXJjaFNob3J0TW92ZXMobW92ZXMsIGZyb21TcSwgU0VBUkNIX0dFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXSwgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIGZhbHNlKTsNCiAgICAgICAgY2FzZSA1Og0KICAgICAgICAgICAgcmV0dXJuIGFwcGVuZFNlYXJjaFNob3J0TW92ZXMobW92ZXMsIGZyb21TcSwgU0VBUkNIX0FEVklTT1JfREVTVFtjb2xvcklkeF1bZnJvbVNxXSwgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIGZhbHNlKTsNCiAgICAgICAgY2FzZSA0Og0KICAgICAgICAgICAgcmV0dXJuIGFwcGVuZFNlYXJjaFNob3J0TW92ZXMobW92ZXMsIGZyb21TcSwgU0VBUkNIX0VMRVBIQU5UX0RFU1RbY29sb3JJZHhdW2Zyb21TcV0sIHNxdWFyZUNvZGVzLCBpc1JlZCwgY2FwdHVyZXNPbmx5LCB0cnVlKTsNCiAgICAgICAgY2FzZSAzOg0KICAgICAgICAgICAgcmV0dXJuIGFwcGVuZFNlYXJjaFNob3J0TW92ZXMobW92ZXMsIGZyb21TcSwgU0VBUkNIX0hPUlNFX0RFU1RbZnJvbVNxXSwgc3F1YXJlQ29kZXMsIGlzUmVkLCBjYXB0dXJlc09ubHksIHRydWUpOw0KICAgICAgICBjYXNlIDc6DQogICAgICAgICAgICByZXR1cm4gYXBwZW5kU2VhcmNoU2hvcnRNb3Zlcyhtb3ZlcywgZnJvbVNxLCBTRUFSQ0hfU09MRElFUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdLCBzcXVhcmVDb2RlcywgaXNSZWQsIGNhcHR1cmVzT25seSwgZmFsc2UpOw0KICAgICAgICBjYXNlIDI6DQogICAgICAgICAgICBmb3IgKGxldCBkaXIgPSAwLCByYXlJbmRleCA9IGZyb21TcSA8PCAyOyBkaXIgPCBTRUFSQ0hfUkFZX0RJUlM7IGRpcisrLCByYXlJbmRleCsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcmF5RW5kID0gU0VBUkNIX1JBWV9PRkZTRVRTW3JheUluZGV4ICsgMV07DQogICAgICAgICAgICAgICAgZm9yIChsZXQgcmF5UG9zID0gU0VBUkNIX1JBWV9PRkZTRVRTW3JheUluZGV4XTsgcmF5UG9zIDwgcmF5RW5kOyByYXlQb3MrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0b1NxID0gU0VBUkNIX1JBWV9TUVVBUkVTW3JheVBvc107DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1t0b1NxXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGdlbmVyYXRlZCsrOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjYXB0dXJlc09ubHkpIG1vdmVzLnB1c2goKGZyb21TcSA8PCA3KSB8IHRvU3EpOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2VuZXJhdGVkKys7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgbW92ZXMucHVzaCgoZnJvbVNxIDw8IDcpIHwgdG9TcSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHJldHVybiBnZW5lcmF0ZWQ7DQogICAgICAgIGNhc2UgNjoNCiAgICAgICAgICAgIGZvciAobGV0IGRpciA9IDAsIHJheUluZGV4ID0gZnJvbVNxIDw8IDI7IGRpciA8IFNFQVJDSF9SQVlfRElSUzsgZGlyKyssIHJheUluZGV4KyspIHsNCiAgICAgICAgICAgICAgICBsZXQgc2NyZWVuRm91bmQgPSBmYWxzZTsNCiAgICAgICAgICAgICAgICBjb25zdCByYXlFbmQgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXggKyAxXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCByYXlQb3MgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXhdOyByYXlQb3MgPCByYXlFbmQ7IHJheVBvcysrKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvU3EgPSBTRUFSQ0hfUkFZX1NRVUFSRVNbcmF5UG9zXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3RvU3FdOw0KICAgICAgICAgICAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdlbmVyYXRlZCsrOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghY2FwdHVyZXNPbmx5KSBtb3Zlcy5wdXNoKChmcm9tU3EgPDwgNykgfCB0b1NxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgc2NyZWVuRm91bmQgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldENvZGUgIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdlbmVyYXRlZCsrOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goKGZyb21TcSA8PCA3KSB8IHRvU3EpOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICByZXR1cm4gZ2VuZXJhdGVkOw0KICAgICAgICBkZWZhdWx0Og0KICAgICAgICAgICAgcmV0dXJuIGdlbmVyYXRlZDsNCiAgICB9DQp9Ow0KDQovLyDmqKHlnZfnuqfokL3ngrnlpITnkIbvvIjpnZ7mr4/lrZDmlrDlu7rpl63ljIXvvInvvJvov5Tlm57mnLrliqjlop7ph48NCi8vIHBpZWNlQXRTcTogOTAg5qC8IOKGkiBwaWVjZXNJbmZv77ybcmVsQ3R4LnVzZU1hc2tzIOaXtuWGmSBtYXNrDQpjb25zdCBhcHBseVJlbGF0aW9uU3F1YXJlID0gKGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIHRyLCB0YywgdXNlTWFza3MsIGJpdCwgcmVsQ3R4LCBpc1JlZCwgcGllY2VDb2xvcikgPT4gew0KICAgIGlmICh0ciA8IDAgfHwgdHIgPj0gUk9XUyB8fCB0YyA8IDAgfHwgdGMgPj0gQ09MUykgcmV0dXJuIDA7DQogICAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbdHJdW3RjXTsNCiAgICBpZiAoIXRhcmdldCkgew0KICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgIGNvbnN0IHNxID0gdHIgKiA5ICsgdGM7DQogICAgICAgICAgICBpZiAoc2hvdWxkV3JpdGVDb250cm9sTWFzayhyZWxDdHgsIHNxKSkgcmVsQ3R4LmNvbnRyb2xNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChyZWxDdHgucmVkQXR0YWNrLCBzcSk7DQogICAgICAgICAgICBlbHNlIHNldEF0dGFja0JpdChyZWxDdHguYmxhY2tBdHRhY2ssIHNxKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICB9DQogICAgaWYgKHRhcmdldC5jb2xvciAhPT0gcGllY2VDb2xvcikgew0KICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgIGlmIChwaWVjZUF0U3FbdHIgKiA5ICsgdGNdKSB7DQogICAgICAgICAgICAgICAgcmVsQ3R4LmF0dGFja01hc2tbdHIgKiA5ICsgdGNdIHw9IGJpdDsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGluZm8ubW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbdHIgKiA5ICsgdGNdOw0KICAgICAgICAgICAgaWYgKHRhcmdldEluZm8pIHsNCiAgICAgICAgICAgICAgICBpbmZvLnRocmVhdC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIDA7DQogICAgfQ0KICAgIGlmICh0YXJnZXQudHlwZSAhPT0gJ2dlbmVyYWwnKSB7DQogICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbdHIgKiA5ICsgdGNdOw0KICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICByZWxDdHguZ3VhcmRNYXNrW3RyICogOSArIHRjXSB8PSBiaXQ7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGluZm8uZ3VhcmQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLmd1YXJkZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgIGluZm8uYWxseUd1YXJkcy5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiAwOw0KfTsNCg0KLy8g6Z2e54Ku77ya5LiA5qyh5Yeg5L2V5omr5o+P77yb55+t5q2l5a2Q6LWw6aKE6KGo77yM6L2m5LuN5bCE57q/77yb6K+t5LmJ5LiOIGdldFBpZWNlTW92ZXMg5LiA6Ie0DQpjb25zdCBmaWxsTm9uQ2Fubm9uUmVsYXRpb25zID0gKGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIHJlbEN0eCA9IG51bGwpID0+IHsNCiAgICBjb25zdCBwaWVjZSA9IGluZm8ucGllY2U7DQogICAgY29uc3QgeyByLCBjIH0gPSBpbmZvOw0KICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICAgIGNvbnN0IHBpZWNlQ29sb3IgPSBwaWVjZS5jb2xvcjsNCiAgICBjb25zdCB1c2VNYXNrcyA9ICEhKHJlbEN0eCAmJiByZWxDdHgudXNlTWFza3MpOw0KICAgIGNvbnN0IGJpdCA9IHVzZU1hc2tzID8gKDEgPDwgcmVsQ3R4LnBpZWNlSW5kZXgpIDogMDsNCiAgICBjb25zdCBjb2xvcklkeCA9IGlzUmVkID8gMCA6IDE7DQogICAgY29uc3QgZnJvbVNxID0gciAqIDkgKyBjOw0KICAgIGlmICghdXNlTWFza3MpIHsNCiAgICAgICAgaW5mby5tb3ZlcyA9IFtdOw0KICAgICAgICBpbmZvLmNvbnRyb2wgPSBbXTsNCiAgICAgICAgaW5mby5hbGx5R3VhcmRzID0gW107DQogICAgfQ0KICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsNCg0KICAgIHN3aXRjaCAocGllY2UudHlwZSkgew0KICAgICAgICBjYXNlICdnZW5lcmFsJzogew0KICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBHRU5FUkFMX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgZC5yLCBkLmMsIHVzZU1hc2tzLCBiaXQsIHJlbEN0eCwgaXNSZWQsIHBpZWNlQ29sb3INCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgY2FzZSAnYWR2aXNvcic6IHsNCiAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gQURWSVNPUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5UmVsYXRpb25TcXVhcmUoDQogICAgICAgICAgICAgICAgICAgIGJvYXJkLCBpbmZvLCBwaWVjZUF0U3EsIGQuciwgZC5jLCB1c2VNYXNrcywgYml0LCByZWxDdHgsIGlzUmVkLCBwaWVjZUNvbG9yDQogICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGNhc2UgJ2VsZXBoYW50Jzogew0KICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBFTEVQSEFOVF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICBpZiAoYm9hcmRbZC5icl1bZC5iY10gPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVJlbGF0aW9uU3F1YXJlKA0KICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgZC5yLCBkLmMsIHVzZU1hc2tzLCBiaXQsIHJlbEN0eCwgaXNSZWQsIHBpZWNlQ29sb3INCiAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBjYXNlICdob3JzZSc6IHsNCiAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gSE9SU0VfREVTVFtmcm9tU3FdOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgICAgICAgICBpZiAoYm9hcmRbZC5icl1bZC5iY10gPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVJlbGF0aW9uU3F1YXJlKA0KICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgZC5yLCBkLmMsIHVzZU1hc2tzLCBiaXQsIHJlbEN0eCwgaXNSZWQsIHBpZWNlQ29sb3INCiAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBjYXNlICdjaGFyaW90JzoNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgICAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXQgPT09IG51bGwpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gbnIgKiA5ICsgbmM7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNob3VsZFdyaXRlQ29udHJvbE1hc2socmVsQ3R4LCBzcSkpIHJlbEN0eC5jb250cm9sTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHJlbEN0eC5yZWRBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHNldEF0dGFja0JpdChyZWxDdHguYmxhY2tBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uY29udHJvbC5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlQXRTcVtuciAqIDkgKyBuY10pIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbEN0eC5hdHRhY2tNYXNrW25yICogOSArIG5jXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldEluZm8gPSBwaWVjZUF0U3FbbnIgKiA5ICsgbmNdOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby50aHJlYXQucHVzaCh0YXJnZXRJbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldEluZm8udGhyZWF0ZW5lZEJ5LnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldC50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW25yICogOSArIG5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0SW5mbyAmJiB0YXJnZXRJbmZvICE9PSBpbmZvKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsQ3R4Lmd1YXJkTWFza1tuciAqIDkgKyBuY10gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5ndWFyZC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0SW5mby5ndWFyZGVkQnkucHVzaChpbmZvKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uYWxseUd1YXJkcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICAgICAgICAgIG5jICs9IGRjOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICBjYXNlICdzb2xkaWVyJzogew0KICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBTT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlSZWxhdGlvblNxdWFyZSgNCiAgICAgICAgICAgICAgICAgICAgYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgZC5yLCBkLmMsIHVzZU1hc2tzLCBiaXQsIHJlbEN0eCwgaXNSZWQsIHBpZWNlQ29sb3INCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgZGVmYXVsdDoNCiAgICAgICAgICAgIGJyZWFrOw0KICAgIH0NCiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOw0KfTsNCg0KLy8g54Ku77ya5LiA5qyh5Zub5ZCR5bCE57q/77ybbWFzayDmqKHlvI/lhpkgYXR0YWNrL2d1YXJkL2NvbnRyb2zvvIzliJfooajmqKHlvI/kv53mjIHml6for63kuYkNCmNvbnN0IGZpbGxDYW5ub25SZWxhdGlvbnMgPSAoYm9hcmQsIGluZm8sIHBpZWNlQXRTcSwgcmVsQ3R4ID0gbnVsbCkgPT4gew0KICAgIGNvbnN0IHBpZWNlID0gaW5mby5waWVjZTsNCiAgICBjb25zdCB7IHIsIGMgfSA9IGluZm87DQogICAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQogICAgY29uc3QgcGllY2VDb2xvciA9IHBpZWNlLmNvbG9yOw0KICAgIGNvbnN0IHsgYmFzZU1vdmVWYWx1ZSB9ID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5Ow0KICAgIGNvbnN0IHVzZU1hc2tzID0gISEocmVsQ3R4ICYmIHJlbEN0eC51c2VNYXNrcyk7DQogICAgY29uc3QgYml0ID0gdXNlTWFza3MgPyAoMSA8PCByZWxDdHgucGllY2VJbmRleCkgOiAwOw0KICAgIGlmICghdXNlTWFza3MpIHsNCiAgICAgICAgaW5mby5tb3ZlcyA9IFtdOw0KICAgICAgICBpbmZvLmNvbnRyb2wgPSBbXTsNCiAgICB9DQogICAgbGV0IG1vYmlsaXR5VmFsdWUgPSAwOw0KDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICBsZXQgc2NyZWVuRm91bmRDb3VudCA9IDA7DQogICAgICAgIHdoaWxlIChuciA+PSAwICYmIG5yIDwgUk9XUyAmJiBuYyA+PSAwICYmIG5jIDwgQ09MUyAmJiBzY3JlZW5Gb3VuZENvdW50IDwgMikgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW25yXVtuY107DQogICAgICAgICAgICBpZiAocCAhPT0gbnVsbCkgew0KICAgICAgICAgICAgICAgIHNjcmVlbkZvdW5kQ291bnQrKzsNCiAgICAgICAgICAgICAgICBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMikgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRJbmZvID0gcGllY2VBdFNxW25yICogOSArIG5jXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldEluZm8gJiYgdGFyZ2V0SW5mbyAhPT0gaW5mbykgew0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHAuY29sb3IgIT09IHBpZWNlQ29sb3IpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlTWFza3MpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsQ3R4LmF0dGFja01hc2tbbnIgKiA5ICsgbmNdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLnRocmVhdC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLnRocmVhdGVuZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwLnR5cGUgIT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWxDdHguZ3VhcmRNYXNrW25yICogOSArIG5jXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5mby5ndWFyZC5wdXNoKHRhcmdldEluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRJbmZvLmd1YXJkZWRCeS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwLmNvbG9yICE9PSBwaWVjZUNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXVzZU1hc2tzKSBpbmZvLm1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIGlmIChzY3JlZW5Gb3VuZENvdW50ID09PSAwKSB7DQogICAgICAgICAgICAgICAgaWYgKCF1c2VNYXNrcykgaW5mby5tb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NyZWVuRm91bmRDb3VudCA9PT0gMSkgew0KICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzcSA9IG5yICogOSArIG5jOw0KICAgICAgICAgICAgICAgICAgICBpZiAoc2hvdWxkV3JpdGVDb250cm9sTWFzayhyZWxDdHgsIHNxKSkgcmVsQ3R4LmNvbnRyb2xNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgIGlmIChpc1JlZCkgc2V0QXR0YWNrQml0KHJlbEN0eC5yZWRBdHRhY2ssIHNxKTsNCiAgICAgICAgICAgICAgICAgICAgZWxzZSBzZXRBdHRhY2tCaXQocmVsQ3R4LmJsYWNrQXR0YWNrLCBzcSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgaW5mby5jb250cm9sLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOw0KfTsNCg0KLy8g5LuO5qC85L2NIG1hc2sg6L+Y5Y6fIHRocmVhdC9ndWFyZC9jb250cm9sIOWIl+ihqO+8iOeCueajiy9VSe+8iQ0KLy8gU2VhcmNoIGxlYXZlcyBhbHdheXMgdXNlIG1hc2tzIGFuZCBhdHRhY2sgYml0cywgc28gdGhpcyBhdm9pZHMgVUkvY29udHJvbC1saXN0IGJyYW5jaGVzLg0KY29uc3QgYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUgPSAoc3F1YXJlQ29kZXMsIHNxLCBiaXQsIGlzUmVkKSA9PiB7DQogICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3NxXTsNCiAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgew0KICAgICAgICBpZiAoaXNSZWQpIHNldEF0dGFja0JpdChzY3JhdGNoUmVkQXR0YWNrLCBzcSk7DQogICAgICAgIGVsc2Ugc2V0QXR0YWNrQml0KHNjcmF0Y2hCbGFja0F0dGFjaywgc3EpOw0KICAgICAgICByZXR1cm4gRVZBTFVBVElPTl9QQVJBTUVURVJTLm1vYmlsaXR5LmJhc2VNb3ZlVmFsdWU7DQogICAgfQ0KICAgIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgew0KICAgICAgICBzY3JhdGNoQXR0YWNrTWFza1tzcV0gfD0gYml0Ow0KICAgIH0gZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgew0KICAgICAgICBzY3JhdGNoR3VhcmRNYXNrW3NxXSB8PSBiaXQ7DQogICAgfQ0KICAgIHJldHVybiAwOw0KfTsNCg0KY29uc3QgY2FsY3VsYXRlU2VhcmNoTGVhZlJlbGF0aW9ucyA9IChwaWVjZXNJbmZvLCBzcXVhcmVDb2RlcykgPT4gew0KICAgIHNjcmF0Y2hBdHRhY2tNYXNrLmZpbGwoMCk7DQogICAgc2NyYXRjaEd1YXJkTWFzay5maWxsKDApOw0KICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsNCiAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaEJsYWNrQXR0YWNrKTsNCg0KICAgIGNvbnN0IGJhc2VNb3ZlVmFsdWUgPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICBmb3IgKGxldCBwaSA9IDA7IHBpIDwgcGllY2VzSW5mby5sZW5ndGg7IHBpKyspIHsNCiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9bcGldOw0KICAgICAgICBjb25zdCByID0gaW5mby5yOw0KICAgICAgICBjb25zdCBjID0gaW5mby5jOw0KICAgICAgICBjb25zdCBmcm9tU3EgPSByICogOSArIGM7DQogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IGluZm8ucGllY2VDb2RlOw0KICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZUNvZGUgJiA3Ow0KICAgICAgICBjb25zdCBpc1JlZCA9IHBpZWNlQ29kZSA8IDg7DQogICAgICAgIGNvbnN0IGNvbG9ySWR4ID0gaXNSZWQgPyAwIDogMTsKICAgICAgICBjb25zdCBiaXQgPSAxIDw8IHBpOwogICAgICAgIGxldCBtb2JpbGl0eVZhbHVlID0gMDsNCg0KICAgICAgICBzd2l0Y2ggKHBpZWNlVHlwZSkgew0KICAgICAgICAgICAgY2FzZSAxOiB7DQogICAgICAgICAgICAgICAgY29uc3QgZGVzdHMgPSBHRU5FUkFMX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYXBwbHlTZWFyY2hMZWFmUmVsYXRpb25TcXVhcmUoc3F1YXJlQ29kZXMsIGQuciAqIDkgKyBkLmMsIGJpdCwgaXNSZWQpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGNhc2UgNTogew0KICAgICAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gQURWSVNPUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5U2VhcmNoTGVhZlJlbGF0aW9uU3F1YXJlKHNxdWFyZUNvZGVzLCBkLnIgKiA5ICsgZC5jLCBiaXQsIGlzUmVkKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBjYXNlIDQ6IHsNCiAgICAgICAgICAgICAgICBjb25zdCBkZXN0cyA9IEVMRVBIQU5UX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgICAgIGlmIChzcXVhcmVDb2Rlc1tkLmJyICogOSArIGQuYmNdID09PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5U2VhcmNoTGVhZlJlbGF0aW9uU3F1YXJlKHNxdWFyZUNvZGVzLCBkLnIgKiA5ICsgZC5jLCBiaXQsIGlzUmVkKTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGNhc2UgMzogew0KICAgICAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gSE9SU0VfREVTVFtmcm9tU3FdOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgICAgICBpZiAoc3F1YXJlQ29kZXNbZC5iciAqIDkgKyBkLmJjXSA9PT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBhcHBseVNlYXJjaExlYWZSZWxhdGlvblNxdWFyZShzcXVhcmVDb2RlcywgZC5yICogOSArIGQuYywgYml0LCBpc1JlZCk7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBjYXNlIDI6DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF07DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRjID0gT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgICAgICBsZXQgbnIgPSByICsgZHI7DQogICAgICAgICAgICAgICAgICAgIGxldCBuYyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICAgICAgd2hpbGUgKG5yID49IDAgJiYgbnIgPCBST1dTICYmIG5jID49IDAgJiYgbmMgPCBDT0xTKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzcSA9IG5yICogOSArIG5jOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29kZSA9IHNxdWFyZUNvZGVzW3NxXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSBzZXRBdHRhY2tCaXQoc2NyYXRjaFJlZEF0dGFjaywgc3EpOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Ugc2V0QXR0YWNrQml0KHNjcmF0Y2hCbGFja0F0dGFjaywgc3EpOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSBzY3JhdGNoQXR0YWNrTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCh0YXJnZXRDb2RlICYgNykgIT09IDEpIHNjcmF0Y2hHdWFyZE1hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIG5yICs9IGRyOw0KICAgICAgICAgICAgICAgICAgICAgICAgbmMgKz0gZGM7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICBjYXNlIDY6DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF07DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRjID0gT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgICAgICBsZXQgbnIgPSByICsgZHI7DQogICAgICAgICAgICAgICAgICAgIGxldCBuYyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHNjcmVlbnMgPSAwOw0KICAgICAgICAgICAgICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMgJiYgc2NyZWVucyA8IDIpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gbnIgKiA5ICsgbmM7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbc3FdOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzY3JlZW5zKys7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNjcmVlbnMgPT09IDIpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh0YXJnZXRDb2RlIDwgOCkgIT09IGlzUmVkKSBzY3JhdGNoQXR0YWNrTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIGlmICgodGFyZ2V0Q29kZSAmIDcpICE9PSAxKSBzY3JhdGNoR3VhcmRNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoc2NyZWVucyA9PT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWUgKz0gYmFzZU1vdmVWYWx1ZTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGlzUmVkKSBzZXRBdHRhY2tCaXQoc2NyYXRjaFJlZEF0dGFjaywgc3EpOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Ugc2V0QXR0YWNrQml0KHNjcmF0Y2hCbGFja0F0dGFjaywgc3EpOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgbnIgKz0gZHI7DQogICAgICAgICAgICAgICAgICAgICAgICBuYyArPSBkYzsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIGNhc2UgNzogew0KICAgICAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gU09MRElFUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZCA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGFwcGx5U2VhcmNoTGVhZlJlbGF0aW9uU3F1YXJlKHNxdWFyZUNvZGVzLCBkLnIgKiA5ICsgZC5jLCBiaXQsIGlzUmVkKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBkZWZhdWx0Og0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgIGluZm8ubW9iaWxpdHlWYWx1ZSA9IG1vYmlsaXR5VmFsdWU7DQogICAgfQ0KfTsNCg0KLy8gU2VhcmNoLW9ubHkgcmVsYXRpb24gYnVpbGRlci4gSXQgaXMgZXF1aXZhbGVudCB0byBjYWxjdWxhdGVTZWFyY2hMZWFmUmVsYXRpb25zLA0KLy8gYnV0IHJldXNlcyB0aGUgcGFja2VkIG1vdmUgdGFibGVzIGFuZCByYXlzIGFscmVhZHkgdXNlZCBieSBwc2V1ZG8gbW92ZSBnZW5lcmF0aW9uLg0KY29uc3QgY2FsY3VsYXRlUGFja2VkU2VhcmNoTGVhZlJlbGF0aW9ucyA9IChwaWVjZXNJbmZvLCBzcXVhcmVDb2RlcykgPT4gew0KICAgIHNjcmF0Y2hBdHRhY2tNYXNrLmZpbGwoMCk7DQogICAgc2NyYXRjaEd1YXJkTWFzay5maWxsKDApOw0KICAgIGNsZWFyQXR0YWNrQml0cyhzY3JhdGNoUmVkQXR0YWNrKTsNCiAgICBjbGVhckF0dGFja0JpdHMoc2NyYXRjaEJsYWNrQXR0YWNrKTsNCg0KICAgIGNvbnN0IGJhc2VNb3ZlVmFsdWUgPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMubW9iaWxpdHkuYmFzZU1vdmVWYWx1ZTsNCiAgICBjb25zdCBhdHRhY2tNYXNrID0gc2NyYXRjaEF0dGFja01hc2s7DQogICAgY29uc3QgZ3VhcmRNYXNrID0gc2NyYXRjaEd1YXJkTWFzazsNCiAgICBjb25zdCByZWRBdHRhY2sgPSBzY3JhdGNoUmVkQXR0YWNrOw0KICAgIGNvbnN0IGJsYWNrQXR0YWNrID0gc2NyYXRjaEJsYWNrQXR0YWNrOw0KDQogICAgZm9yIChsZXQgcGkgPSAwOyBwaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBwaSsrKSB7DQogICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW3BpXTsNCiAgICAgICAgLy8gU2xvdHMgYXJlIHJldXNlZCBiZXR3ZWVuIGxlYXZlcy4gQ2xlYXIgZGVyaXZlZCBzY29yZXMgd2hpbGUgYWxyZWFkeQ0KICAgICAgICAvLyB2aXNpdGluZyBlYWNoIHBpZWNlIHRvIGJ1aWxkIGl0cyBwYWNrZWQgYXR0YWNrIGFuZCBndWFyZCByZWxhdGlvbnMuDQogICAgICAgIGluZm8udGhyZWF0VmFsdWUgPSAwOw0KICAgICAgICBpbmZvLnNhZmV0eVZhbHVlID0gMDsNCiAgICAgICAgaW5mby50YWN0aWNWYWx1ZSA9IDA7DQogICAgICAgIGNvbnN0IGZyb21TcSA9IGluZm8uc3E7DQogICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IGluZm8ucGllY2VDb2RlOw0KICAgICAgICBjb25zdCBwaWVjZVR5cGUgPSBwaWVjZUNvZGUgJiA3OwogICAgICAgIGNvbnN0IGlzUmVkID0gcGllY2VDb2RlIDwgODsKICAgICAgICBjb25zdCBjb2xvcklkeCA9IGlzUmVkID8gMCA6IDE7CiAgICAgICAgY29uc3QgYXR0YWNrVGFyZ2V0Qml0ID0gaXNSZWQgPyAxIDogMjsKICAgICAgICBjb25zdCBiaXQgPSAxIDw8IHBpOwogICAgICAgIGNvbnN0IGF0dGFja0JpdHMgPSBpc1JlZCA/IHJlZEF0dGFjayA6IGJsYWNrQXR0YWNrOw0KICAgICAgICBsZXQgbW9iaWxpdHlWYWx1ZSA9IDA7DQoNCiAgICAgICAgc3dpdGNoIChwaWVjZVR5cGUpIHsNCiAgICAgICAgICAgIGNhc2UgMToNCiAgICAgICAgICAgIGNhc2UgNToNCiAgICAgICAgICAgIGNhc2UgNzogew0KICAgICAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gcGllY2VUeXBlID09PSAxDQogICAgICAgICAgICAgICAgICAgID8gU0VBUkNIX0dFTkVSQUxfREVTVFtjb2xvcklkeF1bZnJvbVNxXQ0KICAgICAgICAgICAgICAgICAgICA6IHBpZWNlVHlwZSA9PT0gNQ0KICAgICAgICAgICAgICAgICAgICAgICAgPyBTRUFSQ0hfQURWSVNPUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdDQogICAgICAgICAgICAgICAgICAgICAgICA6IFNFQVJDSF9TT0xESUVSX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzcSA9IGRlc3RzW2ldOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbc3FdOwogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2RlID09PSAwKSB7CiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChTRUFSQ0hfUExBWV9BVFRBQ0tfVEFSR0VUW3NxXSAmIGF0dGFja1RhcmdldEJpdCkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrQml0c1tzcSA+Pj4gNV0gfD0gMSA8PCAoc3EgJiAzMSk7CiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOwogICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoKHRhcmdldENvZGUgPCA4KSAhPT0gaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja01hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICgodGFyZ2V0Q29kZSAmIDcpICE9PSAxKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBndWFyZE1hc2tbc3FdIHw9IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGNhc2UgNDoNCiAgICAgICAgICAgIGNhc2UgMzogew0KICAgICAgICAgICAgICAgIGNvbnN0IGRlc3RzID0gcGllY2VUeXBlID09PSA0DQogICAgICAgICAgICAgICAgICAgID8gU0VBUkNIX0VMRVBIQU5UX0RFU1RbY29sb3JJZHhdW2Zyb21TcV0NCiAgICAgICAgICAgICAgICAgICAgOiBTRUFSQ0hfSE9SU0VfREVTVFtmcm9tU3FdOw0KICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGVzdHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFja2VkID0gZGVzdHNbaV07DQogICAgICAgICAgICAgICAgICAgIGlmIChzcXVhcmVDb2Rlc1twYWNrZWQgPj4+IDddICE9PSAwKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBwYWNrZWQgJiAxMjc7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1tzcV07CiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9QTEFZX0FUVEFDS19UQVJHRVRbc3FdICYgYXR0YWNrVGFyZ2V0Qml0KSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tCaXRzW3NxID4+PiA1XSB8PSAxIDw8IChzcSAmIDMxKTsKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7CiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCh0YXJnZXRDb2RlICYgNykgIT09IDEpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGd1YXJkTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgY2FzZSAyOg0KICAgICAgICAgICAgICAgIGZvciAobGV0IGRpciA9IDAsIHJheUluZGV4ID0gZnJvbVNxIDw8IDI7IGRpciA8IFNFQVJDSF9SQVlfRElSUzsgZGlyKyssIHJheUluZGV4KyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmF5RW5kID0gU0VBUkNIX1JBWV9PRkZTRVRTW3JheUluZGV4ICsgMV07DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IHJheVBvcyA9IFNFQVJDSF9SQVlfT0ZGU0VUU1tyYXlJbmRleF07IHJheVBvcyA8IHJheUVuZDsgcmF5UG9zKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNxID0gU0VBUkNIX1JBWV9TUVVBUkVTW3JheVBvc107DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0YXJnZXRDb2RlID0gc3F1YXJlQ29kZXNbc3FdOwogICAgICAgICAgICAgICAgICAgICAgICBpZiAodGFyZ2V0Q29kZSA9PT0gMCkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9QTEFZX0FUVEFDS19UQVJHRVRbc3FdICYgYXR0YWNrVGFyZ2V0Qml0KSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXR0YWNrQml0c1tzcSA+Pj4gNV0gfD0gMSA8PCAoc3EgJiAzMSk7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eVZhbHVlICs9IGJhc2VNb3ZlVmFsdWU7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgYXR0YWNrTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoKHRhcmdldENvZGUgJiA3KSAhPT0gMSkgZ3VhcmRNYXNrW3NxXSB8PSBiaXQ7DQogICAgICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIGNhc2UgNjoNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBkaXIgPSAwLCByYXlJbmRleCA9IGZyb21TcSA8PCAyOyBkaXIgPCBTRUFSQ0hfUkFZX0RJUlM7IGRpcisrLCByYXlJbmRleCsrKSB7DQogICAgICAgICAgICAgICAgICAgIGxldCBzY3JlZW5Gb3VuZCA9IGZhbHNlOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCByYXlFbmQgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXggKyAxXTsNCiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgcmF5UG9zID0gU0VBUkNIX1JBWV9PRkZTRVRTW3JheUluZGV4XTsgcmF5UG9zIDwgcmF5RW5kOyByYXlQb3MrKykgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3EgPSBTRUFSQ0hfUkFZX1NRVUFSRVNbcmF5UG9zXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvZGUgPSBzcXVhcmVDb2Rlc1tzcV07DQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvZGUgPT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9iaWxpdHlWYWx1ZSArPSBiYXNlTW92ZVZhbHVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjcmVlbkZvdW5kID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRhcmdldENvZGUgPT09IDApIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChTRUFSQ0hfUExBWV9BVFRBQ0tfVEFSR0VUW3NxXSAmIGF0dGFja1RhcmdldEJpdCkgewogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja0JpdHNbc3EgPj4+IDVdIHw9IDEgPDwgKHNxICYgMzEpOwogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICgodGFyZ2V0Q29kZSA8IDgpICE9PSBpc1JlZCkgYXR0YWNrTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCh0YXJnZXRDb2RlICYgNykgIT09IDEpIGd1YXJkTWFza1tzcV0gfD0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICAgICAgZGVmYXVsdDoNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBpbmZvLm1vYmlsaXR5VmFsdWUgPSBtb2JpbGl0eVZhbHVlOw0KICAgIH0NCn07DQoNCmNvbnN0IGh5ZHJhdGVSZWxhdGlvbnNGcm9tTWFza3MgPSAocGllY2VzSW5mbywgYm9hcmRJbmZvKSA9PiB7DQogICAgY29uc3QgYXR0YWNrTWFzayA9IGJvYXJkSW5mby5hdHRhY2tNYXNrOw0KICAgIGNvbnN0IGd1YXJkTWFzayA9IGJvYXJkSW5mby5ndWFyZE1hc2s7DQogICAgY29uc3QgY29udHJvbE1hc2sgPSBib2FyZEluZm8uY29udHJvbE1hc2s7DQogICAgY29uc3QgbiA9IHBpZWNlc0luZm8ubGVuZ3RoOw0KICAgIGNvbnN0IGJ5U3EgPSBuZXcgQXJyYXkoUkVMX1NRVUFSRVMpOw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7DQogICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvW2ldOw0KICAgICAgICBpbmZvLnRocmVhdCA9IFtdOw0KICAgICAgICBpbmZvLnRocmVhdGVuZWRCeSA9IFtdOw0KICAgICAgICBpbmZvLmd1YXJkID0gW107DQogICAgICAgIGluZm8uZ3VhcmRlZEJ5ID0gW107DQogICAgICAgIGluZm8uY29udHJvbCA9IFtdOw0KICAgICAgICBieVNxW2luZm8uciAqIDkgKyBpbmZvLmNdID0gaW5mbzsNCiAgICB9DQoNCiAgICBmb3IgKGxldCBzcSA9IDA7IHNxIDwgUkVMX1NRVUFSRVM7IHNxKyspIHsNCiAgICAgICAgY29uc3QgciA9IChzcSAvIDkpIHwgMDsNCiAgICAgICAgY29uc3QgYyA9IHNxICUgOTsNCiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYnlTcVtzcV07DQoNCiAgICAgICAgbGV0IGNtID0gY29udHJvbE1hc2tbc3FdID4+PiAwOw0KICAgICAgICB3aGlsZSAoY20gIT09IDApIHsNCiAgICAgICAgICAgIGNvbnN0IGJpdCA9IGNtICYgLWNtOw0KICAgICAgICAgICAgY29uc3QgaSA9IDMxIC0gTWF0aC5jbHozMihiaXQpOw0KICAgICAgICAgICAgcGllY2VzSW5mb1tpXS5jb250cm9sLnB1c2goeyByLCBjIH0pOw0KICAgICAgICAgICAgY20gXj0gYml0Ow0KICAgICAgICB9DQoNCiAgICAgICAgbGV0IGFtID0gYXR0YWNrTWFza1tzcV0gPj4+IDA7DQogICAgICAgIHdoaWxlIChhbSAhPT0gMCkgew0KICAgICAgICAgICAgY29uc3QgYml0ID0gYW0gJiAtYW07DQogICAgICAgICAgICBjb25zdCBpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7DQogICAgICAgICAgICBjb25zdCBhdHRhY2tlciA9IHBpZWNlc0luZm9baV07DQogICAgICAgICAgICBpZiAodGFyZ2V0ICYmIHRhcmdldCAhPT0gYXR0YWNrZXIgJiYgdGFyZ2V0LnBpZWNlLmNvbG9yICE9PSBhdHRhY2tlci5waWVjZS5jb2xvcikgew0KICAgICAgICAgICAgICAgIGF0dGFja2VyLnRocmVhdC5wdXNoKHRhcmdldCk7DQogICAgICAgICAgICAgICAgdGFyZ2V0LnRocmVhdGVuZWRCeS5wdXNoKGF0dGFja2VyKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGFtIF49IGJpdDsNCiAgICAgICAgfQ0KDQogICAgICAgIGxldCBnbSA9IGd1YXJkTWFza1tzcV0gPj4+IDA7DQogICAgICAgIHdoaWxlIChnbSAhPT0gMCkgew0KICAgICAgICAgICAgY29uc3QgYml0ID0gZ20gJiAtZ207DQogICAgICAgICAgICBjb25zdCBpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7DQogICAgICAgICAgICBjb25zdCBndWFyZGVyID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgICAgIGlmICh0YXJnZXQgJiYgdGFyZ2V0ICE9PSBndWFyZGVyICYmIHRhcmdldC5waWVjZS5jb2xvciA9PT0gZ3VhcmRlci5waWVjZS5jb2xvcikgew0KICAgICAgICAgICAgICAgIGd1YXJkZXIuZ3VhcmQucHVzaCh0YXJnZXQpOw0KICAgICAgICAgICAgICAgIHRhcmdldC5ndWFyZGVkQnkucHVzaChndWFyZGVyKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGdtIF49IGJpdDsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOS+myBpc1Bvc2l0aW9uQWNjZXB0YWJsZSAvIOeCueajiyBjb250cm9sbGVyc++8muS4juaXp+ivreS5ieS4gOiHtO+8jOS7heepuuaOp+agvA0KICAgIGNvbnN0IGdyaWQgPSBtYWtlRW1wdHlDb250cm9sbGVyR3JpZCgpOw0KICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCBSRUxfU1FVQVJFUzsgc3ErKykgew0KICAgICAgICBsZXQgY20gPSBjb250cm9sTWFza1tzcV0gPj4+IDA7DQogICAgICAgIGlmIChjbSA9PT0gMCkgY29udGludWU7DQogICAgICAgIGNvbnN0IHIgPSAoc3EgLyA5KSB8IDA7DQogICAgICAgIGNvbnN0IGMgPSBzcSAlIDk7DQogICAgICAgIHdoaWxlIChjbSAhPT0gMCkgew0KICAgICAgICAgICAgY29uc3QgYml0ID0gY20gJiAtY207DQogICAgICAgICAgICBjb25zdCBpID0gMzEgLSBNYXRoLmNsejMyKGJpdCk7DQogICAgICAgICAgICBncmlkW3JdW2NdLnB1c2gocGllY2VzSW5mb1tpXSk7DQogICAgICAgICAgICBjbSBePSBiaXQ7DQogICAgICAgIH0NCiAgICB9DQogICAgYm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkID0gZ3JpZDsNCn07DQoNCi8vIOiuoeeul+aji+WtkOWFs+ezu++8mm1hc2sg6Lev5b6E5YaZIFVpbnQzMiDmoLzkvY3ooajvvJvliJfooajot6/lvoTkv53mjIHml6cgcHVzaA0KY29uc3QgY2FsY3VsYXRlUGllY2VSZWxhdGlvbnMgPSAoYm9hcmQsIHBpZWNlc0luZm8sIGJvYXJkSW5mbykgPT4gew0KICAgIGNvbnN0IHVzZU1hc2tzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKTsNCiAgICBjb25zdCB1c2VBdHRhY2tCaXRzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VBdHRhY2tCaXRzKSAmJiAhdXNlTWFza3M7DQoNCiAgICBpZiAoIXVzZU1hc2tzKSB7DQogICAgICAgIGZvciAoY29uc3QgaW5mbyBvZiBwaWVjZXNJbmZvKSB7DQogICAgICAgICAgICBpbmZvLnRocmVhdCA9IFtdOw0KICAgICAgICAgICAgaW5mby50aHJlYXRlbmVkQnkgPSBbXTsNCiAgICAgICAgICAgIGluZm8uZ3VhcmQgPSBbXTsNCiAgICAgICAgICAgIGluZm8uZ3VhcmRlZEJ5ID0gW107DQogICAgICAgICAgICBpbmZvLmNvbnRyb2wgPSBbXTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGlmICghYm9hcmRJbmZvKSB7DQogICAgICAgIGJvYXJkSW5mbyA9IG1ha2VFbXB0eUNvbnRyb2xsZXJHcmlkKCk7DQogICAgfQ0KDQogICAgY2xlYXJQaWVjZUF0U3EoKTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgaW5mbyA9IHBpZWNlc0luZm9baV07DQogICAgICAgIGlmIChpbmZvLnBpZWNlSW5kZXggPT0gbnVsbCkgaW5mby5waWVjZUluZGV4ID0gaTsNCiAgICAgICAgc2NyYXRjaFBpZWNlQXRTcVtpbmZvLnIgKiA5ICsgaW5mby5jXSA9IGluZm87DQogICAgfQ0KDQogICAgbGV0IHJlbEN0eCA9IG51bGw7DQogICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgIHJlbEN0eCA9IHNjcmF0Y2hSZWxDdHg7DQogICAgICAgIHJlbEN0eC51c2VNYXNrcyA9IHRydWU7DQogICAgICAgIHJlbEN0eC5za2lwQ29udHJvbE1hc2sgPSAhIWJvYXJkSW5mby5za2lwQ29udHJvbE1hc2s7DQogICAgICAgIHJlbEN0eC5wYWxhY2VDb250cm9sT25seSA9ICEhYm9hcmRJbmZvLnBhbGFjZUNvbnRyb2xPbmx5Ow0KICAgICAgICByZWxDdHguYXR0YWNrTWFzayA9IGJvYXJkSW5mby5hdHRhY2tNYXNrOw0KICAgICAgICByZWxDdHguZ3VhcmRNYXNrID0gYm9hcmRJbmZvLmd1YXJkTWFzazsNCiAgICAgICAgcmVsQ3R4LmNvbnRyb2xNYXNrID0gYm9hcmRJbmZvLmNvbnRyb2xNYXNrOw0KICAgICAgICByZWxDdHgucmVkQXR0YWNrID0gYm9hcmRJbmZvLnJlZEF0dGFjazsNCiAgICAgICAgcmVsQ3R4LmJsYWNrQXR0YWNrID0gYm9hcmRJbmZvLmJsYWNrQXR0YWNrOw0KICAgIH0NCg0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgaWYgKHJlbEN0eCkgcmVsQ3R4LnBpZWNlSW5kZXggPSBpbmZvLnBpZWNlSW5kZXg7DQoNCiAgICAgICAgaWYgKGluZm8ucGllY2UudHlwZSA9PT0gJ2Nhbm5vbicpIHsNCiAgICAgICAgICAgIGZpbGxDYW5ub25SZWxhdGlvbnMoYm9hcmQsIGluZm8sIHNjcmF0Y2hQaWVjZUF0U3EsIHJlbEN0eCk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBmaWxsTm9uQ2Fubm9uUmVsYXRpb25zKGJvYXJkLCBpbmZvLCBzY3JhdGNoUGllY2VBdFNxLCByZWxDdHgpOw0KICAgICAgICB9DQoNCiAgICAgICAgaWYgKCF1c2VNYXNrcykgew0KICAgICAgICAgICAgY29uc3QgY29udHJvbCA9IGluZm8uY29udHJvbDsNCiAgICAgICAgICAgIGlmICh1c2VBdHRhY2tCaXRzKSB7DQogICAgICAgICAgICAgICAgY29uc3QgYml0cyA9IGluZm8ucGllY2UuY29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZEF0dGFjayA6IGJvYXJkSW5mby5ibGFja0F0dGFjazsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBrID0gMDsgayA8IGNvbnRyb2wubGVuZ3RoOyBrKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zID0gY29udHJvbFtrXTsNCiAgICAgICAgICAgICAgICAgICAgc2V0QXR0YWNrQml0KGJpdHMsIHBvcy5yICogOSArIHBvcy5jKTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoYm9hcmRJbmZvWzBdKSkgew0KICAgICAgICAgICAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgY29udHJvbC5sZW5ndGg7IGsrKykgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3MgPSBjb250cm9sW2tdOw0KICAgICAgICAgICAgICAgICAgICBib2FyZEluZm9bcG9zLnJdW3Bvcy5jXS5wdXNoKGluZm8pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGxldCByZWRJc0luQ2hlY2sgPSBmYWxzZTsNCiAgICBsZXQgYmxhY2tJc0luQ2hlY2sgPSBmYWxzZTsNCiAgICBsZXQgcmVkR2VuZXJhbEluZm8gPSBudWxsOw0KICAgIGxldCBibGFja0dlbmVyYWxJbmZvID0gbnVsbDsNCiAgICBmb3IgKGNvbnN0IGluZm8gb2YgcGllY2VzSW5mbykgew0KICAgICAgICBpZiAoaW5mby5waWVjZS50eXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgIGlmIChpbmZvLnBpZWNlLmNvbG9yID09PSAncmVkJykgcmVkR2VuZXJhbEluZm8gPSBpbmZvOw0KICAgICAgICAgICAgZWxzZSBibGFja0dlbmVyYWxJbmZvID0gaW5mbzsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICBpZiAocmVkR2VuZXJhbEluZm8gJiYgYm9hcmRJbmZvLmF0dGFja01hc2tbcmVkR2VuZXJhbEluZm8uciAqIDkgKyByZWRHZW5lcmFsSW5mby5jXSAhPT0gMCkgew0KICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoYmxhY2tHZW5lcmFsSW5mbyAmJiBib2FyZEluZm8uYXR0YWNrTWFza1tibGFja0dlbmVyYWxJbmZvLnIgKiA5ICsgYmxhY2tHZW5lcmFsSW5mby5jXSAhPT0gMCkgew0KICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgaWYgKHJlZEdlbmVyYWxJbmZvKSB7DQogICAgICAgICAgICBmb3IgKGNvbnN0IHRocmVhdGVuZXIgb2YgcmVkR2VuZXJhbEluZm8udGhyZWF0ZW5lZEJ5KSB7DQogICAgICAgICAgICAgICAgaWYgKHRocmVhdGVuZXIucGllY2UuY29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIGlmIChibGFja0dlbmVyYWxJbmZvKSB7DQogICAgICAgICAgICBmb3IgKGNvbnN0IHRocmVhdGVuZXIgb2YgYmxhY2tHZW5lcmFsSW5mby50aHJlYXRlbmVkQnkpIHsNCiAgICAgICAgICAgICAgICBpZiAodGhyZWF0ZW5lci5waWVjZS5jb2xvciA9PT0gJ3JlZCcpIHsNCiAgICAgICAgICAgICAgICAgICAgYmxhY2tJc0luQ2hlY2sgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBpZiAocmVkR2VuZXJhbEluZm8gJiYgYmxhY2tHZW5lcmFsSW5mbyAmJiByZWRHZW5lcmFsSW5mby5jID09PSBibGFja0dlbmVyYWxJbmZvLmMpIHsNCiAgICAgICAgbGV0IGhhc1BpZWNlQmV0d2VlbiA9IGZhbHNlOw0KICAgICAgICBjb25zdCBzdGFydFIgPSBNYXRoLm1pbihyZWRHZW5lcmFsSW5mby5yLCBibGFja0dlbmVyYWxJbmZvLnIpICsgMTsNCiAgICAgICAgY29uc3QgZW5kUiA9IE1hdGgubWF4KHJlZEdlbmVyYWxJbmZvLnIsIGJsYWNrR2VuZXJhbEluZm8ucikgLSAxOw0KICAgICAgICBmb3IgKGxldCByID0gc3RhcnRSOyByIDw9IGVuZFI7IHIrKykgew0KICAgICAgICAgICAgaWYgKGJvYXJkW3JdW3JlZEdlbmVyYWxJbmZvLmNdKSB7DQogICAgICAgICAgICAgICAgaGFzUGllY2VCZXR3ZWVuID0gdHJ1ZTsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICBpZiAoIWhhc1BpZWNlQmV0d2Vlbikgew0KICAgICAgICAgICAgcmVkSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgICAgIGJsYWNrSXNJbkNoZWNrID0gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGJvYXJkSW5mby5yZWRJc0luQ2hlY2sgPSByZWRJc0luQ2hlY2s7DQogICAgYm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrID0gYmxhY2tJc0luQ2hlY2s7DQp9Ow0KDQpjb25zdCBpc1Bvc2l0aW9uQWNjZXB0YWJsZSA9IChib2FyZCwgZnJvbSwgdG8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbyA9IG51bGwsIHBpZWNlc0luZm8gPSBudWxsLCB0cnlNb3ZlUGllY2UgPSBudWxsLCBnYW1lU3RhZ2UgPSAnbWlkJykgPT4gew0KICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gdHJ5TW92ZVBpZWNlIHx8IGJvYXJkW2Zyb20ucl1bZnJvbS5jXTsNCiAgICBjb25zdCB0YXJnZXRQaWVjZSA9IGJvYXJkW3RvLnJdW3RvLmNdOw0KICAgIGNvbnN0IGlzQ2FwdHVyZSA9IHRhcmdldFBpZWNlICYmIHRhcmdldFBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyOw0KDQogICAgLy8g5pS26ZuG5omA5pyJ5qOL5a2Q5L+h5oGv77yM5Y+q5Zyo5rKh5pyJ5o+Q5L6b5pe26K6h566XDQogICAgbGV0IGxvY2FsUGllY2VzSW5mbyA9IHBpZWNlc0luZm87DQogICAgaWYgKCFsb2NhbFBpZWNlc0luZm8pIHsNCiAgICAgICAgbG9jYWxQaWVjZXNJbmZvID0gW107DQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgUk9XUzsgcisrKSB7DQogICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgICAgICAgICAgaWYgKHBpZWNlKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGFsbHlHdWFyZHMgPSBbXTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBnZXRQaWVjZU1vdmVzKGJvYXJkLCB7IHIsIGMgfSwgcGllY2UsIGFsbHlHdWFyZHMpOw0KICAgICAgICAgICAgICAgICAgICBsb2NhbFBpZWNlc0luZm8ucHVzaCh7DQogICAgICAgICAgICAgICAgICAgICAgICBwaWVjZSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHIsIGMsIG1vdmVzLCBhbGx5R3VhcmRzLA0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWxWYWx1ZTogZ2V0TWF0ZXJpYWxWYWx1ZShwaWVjZSwgZ2FtZVN0YWdlKSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogW10sDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnk6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRlZEJ5OiBbXSwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5VmFsdWU6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRWYWx1ZTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eVZhbHVlOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgdGFjdGljVmFsdWU6IDANCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g6K6h566X5qOL5a2Q5YWz57O75ZKM5o6n5Yi25L+h5oGv77yM5Y+q5Zyo5rKh5pyJ5o+Q5L6b5pe26K6h566XDQogICAgbGV0IGxvY2FsQm9hcmRJbmZvID0gYm9hcmRJbmZvOw0KICAgIGlmICghbG9jYWxCb2FyZEluZm8pIHsNCiAgICAgICAgaWYgKGxvY2FsUGllY2VzSW5mby5sZW5ndGggPD0gMzIpIHsNCiAgICAgICAgICAgIGNsZWFyUmVsYXRpb25NYXNrcygpOw0KICAgICAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hSZWRBdHRhY2spOw0KICAgICAgICAgICAgY2xlYXJBdHRhY2tCaXRzKHNjcmF0Y2hCbGFja0F0dGFjayk7DQogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxvY2FsUGllY2VzSW5mby5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGxvY2FsUGllY2VzSW5mb1tpXS5waWVjZUluZGV4ID0gaTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGxvY2FsQm9hcmRJbmZvID0gew0KICAgICAgICAgICAgICAgIHVzZVJlbGF0aW9uTWFza3M6IHRydWUsDQogICAgICAgICAgICAgICAgdXNlQXR0YWNrQml0czogdHJ1ZSwNCiAgICAgICAgICAgICAgICBhdHRhY2tNYXNrOiBzY3JhdGNoQXR0YWNrTWFzaywNCiAgICAgICAgICAgICAgICBndWFyZE1hc2s6IHNjcmF0Y2hHdWFyZE1hc2ssDQogICAgICAgICAgICAgICAgY29udHJvbE1hc2s6IHNjcmF0Y2hDb250cm9sTWFzaywNCiAgICAgICAgICAgICAgICByZWRBdHRhY2s6IHNjcmF0Y2hSZWRBdHRhY2ssDQogICAgICAgICAgICAgICAgYmxhY2tBdHRhY2s6IHNjcmF0Y2hCbGFja0F0dGFjaw0KICAgICAgICAgICAgfTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGxvY2FsQm9hcmRJbmZvID0gbWFrZUVtcHR5Q29udHJvbGxlckdyaWQoKTsNCiAgICAgICAgfQ0KICAgICAgICBjYWxjdWxhdGVQaWVjZVJlbGF0aW9ucyhib2FyZCwgbG9jYWxQaWVjZXNJbmZvLCBsb2NhbEJvYXJkSW5mbyk7DQogICAgfQ0KDQogICAgLy8g5o6n5Yi26ICF77yabWFzayDnlKggY29udHJvbE1hc2vvvJvml6fot6/lvoTnlKggYm9hcmRJbmZvW3JdW2Nd77ybaHlkcmF0ZSDlkI7lj6/nlKggY29udHJvbGxlckdyaWQNCiAgICBsZXQgY29udHJvbGxlcnM7DQogICAgaWYgKGxvY2FsQm9hcmRJbmZvLnVzZVJlbGF0aW9uTWFza3MpIHsNCiAgICAgICAgY29udHJvbGxlcnMgPSBbXTsNCiAgICAgICAgZm9yRWFjaFNldEJpdChsb2NhbEJvYXJkSW5mby5jb250cm9sTWFza1t0by5yICogOSArIHRvLmNdLCAoaSkgPT4gew0KICAgICAgICAgICAgY29udHJvbGxlcnMucHVzaChsb2NhbFBpZWNlc0luZm9baV0pOw0KICAgICAgICB9KTsNCiAgICB9IGVsc2UgaWYgKGxvY2FsQm9hcmRJbmZvLmNvbnRyb2xsZXJHcmlkKSB7DQogICAgICAgIGNvbnRyb2xsZXJzID0gbG9jYWxCb2FyZEluZm8uY29udHJvbGxlckdyaWRbdG8ucl1bdG8uY10gfHwgW107DQogICAgfSBlbHNlIHsNCiAgICAgICAgY29udHJvbGxlcnMgPSBsb2NhbEJvYXJkSW5mb1t0by5yXVt0by5jXSB8fCBbXTsNCiAgICB9DQogICAgbGV0IGhhc0FsbHlDb250cm9sbGVyID0gZmFsc2U7DQogICAgbGV0IGhhc0VuZW15Q29udHJvbGxlciA9IGZhbHNlOw0KDQogICAgLy8g5o6n5Yi26ICF5Y+v6IO95pivIHBpZWNlc0luZm8g5byV55SoIHtwaWVjZSxyLGN9IOaIluaXp+e7k+aehCB7Y29sb3IsdHlwZSxyLGN9DQogICAgY29uc3QgY29udHJvbGxlckNvbG9yID0gKGNvbnRyb2xsZXIpID0+DQogICAgICAgIGNvbnRyb2xsZXIucGllY2UgPyBjb250cm9sbGVyLnBpZWNlLmNvbG9yIDogY29udHJvbGxlci5jb2xvcjsNCg0KICAgIGZvciAoY29uc3QgY29udHJvbGxlciBvZiBjb250cm9sbGVycykgew0KICAgICAgICAvLyDmjpLpmaTmraPlnKjnp7vliqjnmoTmo4vlrZDmnKzouqvvvIjotbDlkI7lroPkuI3lho3ku47ljp/kvY3mjqfliLbnm67moIfvvIkNCiAgICAgICAgaWYgKG1vdmluZ1BpZWNlICYmIGNvbnRyb2xsZXIuciA9PT0gZnJvbS5yICYmIGNvbnRyb2xsZXIuYyA9PT0gZnJvbS5jKSB7DQogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoY29udHJvbGxlckNvbG9yKGNvbnRyb2xsZXIpID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICBoYXNBbGx5Q29udHJvbGxlciA9IHRydWU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBoYXNFbmVteUNvbnRyb2xsZXIgPSB0cnVlOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgaWYgKGlzQ2FwdHVyZSkgew0KICAgICAgICAvLyDnmb3lkIPvvJrnm67moIfmnKrooqvmlYzmlrnkv53miqQNCiAgICAgICAgaWYgKCFoYXNFbmVteUNvbnRyb2xsZXIpIHsNCiAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgICAgIC8vIOeugOWNlSBTRUXvvJrlhYjlvpfnm67moIfliIbvvIzoi6XkvJrooqvlj43lkIPliJnlho3lpLHlt7Hmlrnmo4vlrZANCiAgICAgICAgY29uc3QgdGFyZ2V0VmFsdWUgPSBnZXRNYXRlcmlhbFZhbHVlKHRhcmdldFBpZWNlLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCBvdXJWYWx1ZSA9IGdldE1hdGVyaWFsVmFsdWUobW92aW5nUGllY2UsIGdhbWVTdGFnZSk7DQogICAgICAgIGxldCBzZWUgPSB0YXJnZXRWYWx1ZSAtIG91clZhbHVlOw0KICAgICAgICAvLyDoi6XmnInlt7Hmlrnnu6fnu63kv53miqTvvIznspfnlaXorqTkuLrlj6/og73lho3lkIPlm57mnIDkvY7ku7flgLznmoTmlYzmlrnkv53miqTogIUNCiAgICAgICAgaWYgKGhhc0FsbHlDb250cm9sbGVyKSB7DQogICAgICAgICAgICBjb25zdCBlbmVteUd1YXJkVmFsdWVzID0gY29udHJvbGxlcnMNCiAgICAgICAgICAgICAgICAuZmlsdGVyKGMgPT4gY29udHJvbGxlckNvbG9yKGMpICE9PSBjdXJyZW50UGxheWVyICYmICEoYy5yID09PSBmcm9tLnIgJiYgYy5jID09PSBmcm9tLmMpKQ0KICAgICAgICAgICAgICAgIC5tYXAoYyA9PiB7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtjLnJdW2MuY107DQogICAgICAgICAgICAgICAgICAgIHJldHVybiBwID8gZ2V0TWF0ZXJpYWxWYWx1ZShwLCBnYW1lU3RhZ2UpIDogMDsNCiAgICAgICAgICAgICAgICB9KQ0KICAgICAgICAgICAgICAgIC5maWx0ZXIodiA9PiB2ID4gMCkNCiAgICAgICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gYSAtIGIpOw0KICAgICAgICAgICAgaWYgKGVuZW15R3VhcmRWYWx1ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgIHNlZSArPSBlbmVteUd1YXJkVmFsdWVzWzBdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIC8vIOaYjuaYvuS6j+aNou+8iOWmgui9puaNouaXoOagueWFteS4lOS8muiiq+WPjeWQg++8ieWImei/h+a7pO+8m+W5s+aNoi/otZrmjaLnlZnnu5nmkJzntKINCiAgICAgICAgcmV0dXJuIHNlZSA+PSAwOw0KICAgIH0NCg0KICAgIC8vIOmdnuWQg+WtkO+8muebruagh+S7heiiq+aVjOaWueaOp+WItuWImeinhuS4uumAgeWQgw0KICAgIGlmIChjb250cm9sbGVycy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHRydWU7DQogICAgfQ0KICAgIHJldHVybiAhaGFzRW5lbXlDb250cm9sbGVyIHx8IGhhc0FsbHlDb250cm9sbGVyOw0KfTsNCg0KLy8gU0VFIOaOkuW6j+WkjeeUqOe8k+WGsu+8jOmZjeS9juWPtuivhOS8sCBHQw0KY29uc3Qgc2VlQXR0YWNrZXJTY3JhdGNoID0gW107DQpjb25zdCBzZWVHdWFyZFNjcmF0Y2ggPSBbXTsNCmNvbnN0IHNlZUF0dGFja2VyVHlwZUNvdW50cyA9IG5ldyBVaW50OEFycmF5KDgpOw0KY29uc3Qgc2VlR3VhcmRUeXBlQ291bnRzID0gbmV3IFVpbnQ4QXJyYXkoOCk7DQpjb25zdCBzZWVNYXRlcmlhbEJ5VHlwZSA9IG5ldyBJbnQzMkFycmF5KDgpOw0KDQpjb25zdCB0YWtlTG93ZXN0U2VlTWF0ZXJpYWwgPSAoY291bnRzLCBtYXRlcmlhbEJ5VHlwZSkgPT4gew0KICAgIGxldCBiZXN0VHlwZSA9IDA7DQogICAgbGV0IGJlc3RWYWx1ZSA9IEluZmluaXR5Ow0KICAgIGZvciAobGV0IHR5cGUgPSAxOyB0eXBlIDwgY291bnRzLmxlbmd0aDsgdHlwZSsrKSB7DQogICAgICAgIGlmIChjb3VudHNbdHlwZV0gIT09IDAgJiYgbWF0ZXJpYWxCeVR5cGVbdHlwZV0gPCBiZXN0VmFsdWUpIHsNCiAgICAgICAgICAgIGJlc3RUeXBlID0gdHlwZTsNCiAgICAgICAgICAgIGJlc3RWYWx1ZSA9IG1hdGVyaWFsQnlUeXBlW3R5cGVdOw0KICAgICAgICB9DQogICAgfQ0KICAgIGlmIChiZXN0VHlwZSAhPT0gMCkgY291bnRzW2Jlc3RUeXBlXS0tOw0KICAgIHJldHVybiBiZXN0VmFsdWU7DQp9Ow0KDQpjb25zdCBoYXNBbnlTZWVNYXRlcmlhbCA9IChjb3VudHMpID0+IHsNCiAgICBmb3IgKGxldCB0eXBlID0gMTsgdHlwZSA8IGNvdW50cy5sZW5ndGg7IHR5cGUrKykgew0KICAgICAgICBpZiAoY291bnRzW3R5cGVdICE9PSAwKSByZXR1cm4gdHJ1ZTsNCiAgICB9DQogICAgcmV0dXJuIGZhbHNlOw0KfTsNCg0KLy8g5pyJ5qC55a2Q566A5YyWIFNFRe+8iOS4juaXp+WunueOsOmAkOihjOetieS7t++8ie+8m+avj+S4quebruagh+WPquW6lOiwg+eUqOS4gOasoQ0KY29uc3QgY2FsY3VsYXRlU3RhdGljRXhjaGFuZ2VTY29yZSA9ICh0aHJlYXRlbmVkUGllY2UpID0+IHsNCiAgICBjb25zdCBhdHRhY2tlcnMgPSBzZWVBdHRhY2tlclNjcmF0Y2g7DQogICAgY29uc3QgZ3VhcmRzID0gc2VlR3VhcmRTY3JhdGNoOw0KICAgIGF0dGFja2Vycy5sZW5ndGggPSAwOw0KICAgIGd1YXJkcy5sZW5ndGggPSAwOw0KICAgIGNvbnN0IHJhd0F0dGFja2VycyA9IHRocmVhdGVuZWRQaWVjZS50aHJlYXRlbmVkQnk7DQogICAgY29uc3QgcmF3R3VhcmRzID0gdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJhd0F0dGFja2Vycy5sZW5ndGg7IGkrKykgYXR0YWNrZXJzLnB1c2gocmF3QXR0YWNrZXJzW2ldKTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJhd0d1YXJkcy5sZW5ndGg7IGkrKykgZ3VhcmRzLnB1c2gocmF3R3VhcmRzW2ldKTsNCiAgICBhdHRhY2tlcnMuc29ydCgoYSwgYikgPT4gYS5tYXRlcmlhbFZhbHVlIC0gYi5tYXRlcmlhbFZhbHVlKTsNCiAgICBndWFyZHMuc29ydCgoYSwgYikgPT4gYS5tYXRlcmlhbFZhbHVlIC0gYi5tYXRlcmlhbFZhbHVlKTsNCg0KICAgIGxldCBleGNoYW5nZVNjb3JlID0gMDsNCiAgICBsZXQgYXR0YWNrZXJJbmRleCA9IDA7DQogICAgbGV0IGd1YXJkSW5kZXggPSAwOw0KICAgIGNvbnN0IHRhcmdldFZhbHVlID0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7DQoNCiAgICB3aGlsZSAoYXR0YWNrZXJJbmRleCA8IGF0dGFja2Vycy5sZW5ndGggJiYgZ3VhcmRJbmRleCA8IGd1YXJkcy5sZW5ndGgpIHsNCiAgICAgICAgaWYgKGd1YXJkSW5kZXggPT09IDApIHsNCiAgICAgICAgICAgIGV4Y2hhbmdlU2NvcmUgKz0gdGFyZ2V0VmFsdWU7DQogICAgICAgIH0NCiAgICAgICAgZXhjaGFuZ2VTY29yZSAtPSBhdHRhY2tlcnNbYXR0YWNrZXJJbmRleF0ubWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgaWYgKGF0dGFja2VySW5kZXggKyAxIDwgYXR0YWNrZXJzLmxlbmd0aCkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSBndWFyZHNbZ3VhcmRJbmRleF0ubWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgfQ0KICAgICAgICBhdHRhY2tlckluZGV4Kys7DQogICAgICAgIGd1YXJkSW5kZXgrKzsNCiAgICB9DQogICAgcmV0dXJuIGV4Y2hhbmdlU2NvcmU7DQp9Ow0KDQovLyBtYXNrIOi3r+W+hCBTRUXvvJrmjInmo4vlrZDnsbvliKvorqHmlbDvvIzmjInmnZDmlpnlgLzmtojotLnvvJvkuI7mnZDmlpnmlbDnu4TmjpLluo/or63kuYnkuIDoh7TjgIINCmNvbnN0IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmVGcm9tTWFza3MgPSAodGhyZWF0ZW5lZFBpZWNlLCBwaWVjZXNJbmZvLCBhdHRhY2tNYXNrLCBndWFyZE1hc2spID0+IHsNCiAgICBjb25zdCBhdHRhY2tlckNvdW50cyA9IHNlZUF0dGFja2VyVHlwZUNvdW50czsNCiAgICBjb25zdCBndWFyZENvdW50cyA9IHNlZUd1YXJkVHlwZUNvdW50czsNCiAgICBhdHRhY2tlckNvdW50cy5maWxsKDApOw0KICAgIGd1YXJkQ291bnRzLmZpbGwoMCk7DQogICAgc2VlTWF0ZXJpYWxCeVR5cGUuZmlsbCgwKTsNCiAgICBjb25zdCBzcSA9IHRocmVhdGVuZWRQaWVjZS5zcSA9PSBudWxsDQogICAgICAgID8gdGhyZWF0ZW5lZFBpZWNlLnIgKiA5ICsgdGhyZWF0ZW5lZFBpZWNlLmMNCiAgICAgICAgOiB0aHJlYXRlbmVkUGllY2Uuc3E7DQogICAgbGV0IGFtID0gYXR0YWNrTWFza1tzcV0gPj4+IDA7DQogICAgd2hpbGUgKGFtICE9PSAwKSB7DQogICAgICAgIGNvbnN0IGJpdCA9IGFtICYgLWFtOw0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV07DQogICAgICAgIGNvbnN0IHR5cGUgPSBpbmZvLnBpZWNlQ29kZSAmIDc7DQogICAgICAgIGF0dGFja2VyQ291bnRzW3R5cGVdKys7DQogICAgICAgIHNlZU1hdGVyaWFsQnlUeXBlW3R5cGVdID0gaW5mby5tYXRlcmlhbFZhbHVlOw0KICAgICAgICBhbSBePSBiaXQ7DQogICAgfQ0KICAgIGxldCBnbSA9IGd1YXJkTWFza1tzcV0gPj4+IDA7DQogICAgd2hpbGUgKGdtICE9PSAwKSB7DQogICAgICAgIGNvbnN0IGJpdCA9IGdtICYgLWdtOw0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1szMSAtIE1hdGguY2x6MzIoYml0KV07DQogICAgICAgIGNvbnN0IHR5cGUgPSBpbmZvLnBpZWNlQ29kZSAmIDc7DQogICAgICAgIGd1YXJkQ291bnRzW3R5cGVdKys7DQogICAgICAgIHNlZU1hdGVyaWFsQnlUeXBlW3R5cGVdID0gaW5mby5tYXRlcmlhbFZhbHVlOw0KICAgICAgICBnbSBePSBiaXQ7DQogICAgfQ0KDQogICAgbGV0IGV4Y2hhbmdlU2NvcmUgPSAwOw0KICAgIGxldCBpc0ZpcnN0RXhjaGFuZ2UgPSB0cnVlOw0KICAgIGNvbnN0IHRhcmdldFZhbHVlID0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7DQoNCiAgICB3aGlsZSAodHJ1ZSkgew0KICAgICAgICBjb25zdCBhdHRhY2tlclZhbHVlID0gdGFrZUxvd2VzdFNlZU1hdGVyaWFsKGF0dGFja2VyQ291bnRzLCBzZWVNYXRlcmlhbEJ5VHlwZSk7DQogICAgICAgIGNvbnN0IGd1YXJkVmFsdWUgPSB0YWtlTG93ZXN0U2VlTWF0ZXJpYWwoZ3VhcmRDb3VudHMsIHNlZU1hdGVyaWFsQnlUeXBlKTsNCiAgICAgICAgaWYgKGF0dGFja2VyVmFsdWUgPT09IEluZmluaXR5IHx8IGd1YXJkVmFsdWUgPT09IEluZmluaXR5KSBicmVhazsNCiAgICAgICAgaWYgKGlzRmlyc3RFeGNoYW5nZSkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSB0YXJnZXRWYWx1ZTsNCiAgICAgICAgICAgIGlzRmlyc3RFeGNoYW5nZSA9IGZhbHNlOw0KICAgICAgICB9DQogICAgICAgIGV4Y2hhbmdlU2NvcmUgLT0gYXR0YWNrZXJWYWx1ZTsNCiAgICAgICAgaWYgKGhhc0FueVNlZU1hdGVyaWFsKGF0dGFja2VyQ291bnRzKSkgew0KICAgICAgICAgICAgZXhjaGFuZ2VTY29yZSArPSBndWFyZFZhbHVlOw0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiBleGNoYW5nZVNjb3JlOw0KfTsNCg0KLy8g6K6h566X5aiB6IOB5YC877yI5Z+65LqO5a6M5pW055qE5aiB6IOB5YWz57O777yJDQovLyDmjInooqvlqIHog4HlrZDogZrlkIjvvJrmr4/kuKrnm67moIfmnIDlpJrkuIDmrKEgU0VF77yb5YiG5YC85Yqg57uZIHRocmVhdGVuZWRCeVswXQ0KLy8g77yI5YWz57O75p6E5bu65oyJIHBpZWNlc0luZm8g6aG65bqPIHB1c2jvvIzmlYXkuI7ml6figJzmlLvlh7vmlrnlpJblsYLpgY3ljobpppbmrKHorqHliIbigJ3lvZLlsZ7kuIDoh7TvvIkNCmNvbnN0IGNhbGN1bGF0ZVRhY3RpY2FsVmFsdWVzID0gKHBpZWNlc0luZm8sIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSW5mbyA9IG51bGwsIGJvYXJkID0gbnVsbCwgZm9yU2VhcmNoTGVhZiA9IGZhbHNlKSA9PiB7DQogICAgLy8g57uf6K6hDQogICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MgJiYgY3VycmVudFBsYXllcikgewogICAgICAgIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudFtjdXJyZW50UGxheWVyXSsrOwogICAgfQ0KDQogICAgLy8g5Yid5aeL5YyW5aiB6IOB57G75Z6L57uf6K6h5L+h5oGvDQogICAgY29uc3QgY29sbGVjdFVpID0gISFib2FyZEluZm8gJiYgIWZvclNlYXJjaExlYWY7DQogICAgaWYgKGNvbGxlY3RVaSkgew0KICAgICAgICBib2FyZEluZm8uY2hlY2tzID0gW107ICAgICAgLy8g5bCG5Yab5L+h5oGvDQogICAgICAgIGJvYXJkSW5mby50aHJlYXRlbmVkUGllY2VzID0gW107ICAvLyDooqvmjYnnmoTmo4vlrZANCiAgICAgICAgYm9hcmRJbmZvLmNhbkNhcHR1cmUgPSBbXTsgIC8vIOWPr+WQg+eahOaji+WtkA0KICAgIH0NCg0KICAgIGNvbnN0IGNoZWNrQm9udXMgPSBFVkFMVUFUSU9OX1BBUkFNRVRFUlMuY2hlY2suYm9udXM7DQogICAgY29uc3QgY2FuQ2FwdHVyZVNlZW4gPSBjb2xsZWN0VWkgPyBuZXcgU2V0KCkgOiBudWxsOw0KICAgIGNvbnN0IHVzZU1hc2tzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VSZWxhdGlvbk1hc2tzKTsNCiAgICBjb25zdCBhdHRhY2tNYXNrID0gdXNlTWFza3MgPyBib2FyZEluZm8uYXR0YWNrTWFzayA6IG51bGw7DQogICAgY29uc3QgZ3VhcmRNYXNrID0gdXNlTWFza3MgPyBib2FyZEluZm8uZ3VhcmRNYXNrIDogbnVsbDsNCg0KICAgIGZvciAobGV0IHRpID0gMDsgdGkgPCBwaWVjZXNJbmZvLmxlbmd0aDsgdGkrKykgew0KICAgICAgICBjb25zdCB0aHJlYXRlbmVkUGllY2UgPSBwaWVjZXNJbmZvW3RpXTsNCiAgICAgICAgbGV0IGZpcnN0QXR0YWNrZXI7DQogICAgICAgIGxldCBoYXNHdWFyZDsNCiAgICAgICAgbGV0IGF0dGFja2VyTGlzdCA9IG51bGw7DQoNCiAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICBjb25zdCBzcSA9IHRocmVhdGVuZWRQaWVjZS5yICogOSArIHRocmVhdGVuZWRQaWVjZS5jOw0KICAgICAgICAgICAgY29uc3QgYW0gPSBhdHRhY2tNYXNrW3NxXTsNCiAgICAgICAgICAgIGlmIChhbSA9PT0gMCkgY29udGludWU7DQogICAgICAgICAgICAvLyDmnIDkvY4gYml0ID0gcGllY2VzSW5mbyDpobrluo/kuIvmnIDlhYjmjILkuIrnmoTmlLvlh7vmlrnvvIjkuI7ml6cgdGhyZWF0ZW5lZEJ5WzBdIOS4gOiHtO+8iQ0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlciA9IHBpZWNlc0luZm9bbG93ZXN0U2V0Qml0SW5kZXgoYW0pXTsNCiAgICAgICAgICAgIGhhc0d1YXJkID0gZ3VhcmRNYXNrW3NxXSAhPT0gMDsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGNvbnN0IGF0dGFja2VycyA9IHRocmVhdGVuZWRQaWVjZS50aHJlYXRlbmVkQnk7DQogICAgICAgICAgICBpZiAoIWF0dGFja2VycyB8fCBhdHRhY2tlcnMubGVuZ3RoID09PSAwKSBjb250aW51ZTsNCiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIgPSBhdHRhY2tlcnNbMF07DQogICAgICAgICAgICBoYXNHdWFyZCA9IHRocmVhdGVuZWRQaWVjZS5ndWFyZGVkQnkgJiYgdGhyZWF0ZW5lZFBpZWNlLmd1YXJkZWRCeS5sZW5ndGggPiAwOw0KICAgICAgICAgICAgYXR0YWNrZXJMaXN0ID0gYXR0YWNrZXJzOw0KICAgICAgICB9DQoNCiAgICAgICAgLy8g5bCG5Yab77ya5Y+q57uZ5bCP6aKd5YWI5omL5YiG77yM57ud5LiN5oyJ5bCGL+W4headkOaWmeWAvOWBmiBTRUUNCiAgICAgICAgaWYgKHRocmVhdGVuZWRQaWVjZS5waWVjZS50eXBlID09PSBQSUVDRV9UWVBFUy5HRU5FUkFMKSB7DQogICAgICAgICAgICBpZiAoY29sbGVjdFVpKSB7DQogICAgICAgICAgICAgICAgaWYgKHVzZU1hc2tzKSB7DQogICAgICAgICAgICAgICAgICAgIGxldCBtID0gYXR0YWNrTWFza1t0aHJlYXRlbmVkUGllY2UuciAqIDkgKyB0aHJlYXRlbmVkUGllY2UuY10gPj4+IDA7DQogICAgICAgICAgICAgICAgICAgIHdoaWxlIChtICE9PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiaXQgPSBtICYgLW07DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhaSA9IDMxIC0gTWF0aC5jbHozMihiaXQpOw0KICAgICAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLmNoZWNrcy5wdXNoKHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhdHRhY2tlcjogcGllY2VzSW5mb1thaV0sDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiB0aHJlYXRlbmVkUGllY2UsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNDaGVjazogdHJ1ZQ0KICAgICAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgICAgICAgICBtIF49IGJpdDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGFpID0gMDsgYWkgPCBhdHRhY2tlckxpc3QubGVuZ3RoOyBhaSsrKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBib2FyZEluZm8uY2hlY2tzLnB1c2goew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dGFja2VyOiBhdHRhY2tlckxpc3RbYWldLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldDogdGhyZWF0ZW5lZFBpZWNlLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzQ2hlY2s6IHRydWUNCiAgICAgICAgICAgICAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSBjaGVja0JvbnVzOw0KICAgICAgICAgICAgY29udGludWU7DQogICAgICAgIH0NCg0KICAgICAgICAvLyDlj6rmiorlr7nmlLvlh7vmlrnmnInliKnnmoTlqIHog4HorqHlhaUgdGhyZWF0VmFsdWXvvIjljZXlkJHorqHlhaXvvIzkuI3lgZogc2FmZXR5IOWvueensOaJo+WIhu+8iQ0KICAgICAgICBpZiAoIWhhc0d1YXJkKSB7DQogICAgICAgICAgICBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IHRocmVhdGVuZWRQaWVjZS5tYXRlcmlhbFZhbHVlOw0KICAgICAgICAgICAgaWYgKGNvbGxlY3RVaSkgew0KICAgICAgICAgICAgICAgIGlmIChmaXJzdEF0dGFja2VyLnBpZWNlLmNvbG9yID09PSBjdXJyZW50UGxheWVyKSB7DQogICAgICAgICAgICAgICAgICAgIGlmICh1c2VNYXNrcykgew0KICAgICAgICAgICAgICAgICAgICAgICAgbGV0IG0gPSBhdHRhY2tNYXNrW3RocmVhdGVuZWRQaWVjZS5yICogOSArIHRocmVhdGVuZWRQaWVjZS5jXSA+Pj4gMDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHdoaWxlIChtICE9PSAwKSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYml0ID0gbSAmIC1tOw0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGluZm8gPSBwaWVjZXNJbmZvWzMxIC0gTWF0aC5jbHozMihiaXQpXTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbkNhcHR1cmVTZWVuLmhhcyhpbmZvKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYW5DYXB0dXJlU2Vlbi5hZGQoaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jYW5DYXB0dXJlLnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIG0gXj0gYml0Ow0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgYWkgPSAwOyBhaSA8IGF0dGFja2VyTGlzdC5sZW5ndGg7IGFpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gYXR0YWNrZXJMaXN0W2FpXTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbkNhcHR1cmVTZWVuLmhhcyhpbmZvKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYW5DYXB0dXJlU2Vlbi5hZGQoaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJvYXJkSW5mby5jYW5DYXB0dXJlLnB1c2goaW5mbyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgYm9hcmRJbmZvLnRocmVhdGVuZWRQaWVjZXMucHVzaCh0aHJlYXRlbmVkUGllY2UpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGNvbnN0IHNzZVNjb3JlID0gdXNlTWFza3MNCiAgICAgICAgICAgICAgICA/IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmVGcm9tTWFza3ModGhyZWF0ZW5lZFBpZWNlLCBwaWVjZXNJbmZvLCBhdHRhY2tNYXNrLCBndWFyZE1hc2spDQogICAgICAgICAgICAgICAgOiBjYWxjdWxhdGVTdGF0aWNFeGNoYW5nZVNjb3JlKHRocmVhdGVuZWRQaWVjZSk7DQogICAgICAgICAgICBpZiAoc3NlU2NvcmUgPiAwKSB7DQogICAgICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSBzc2VTY29yZSAqIDAuNTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOWuieWFqOWAvO+8muWwhuepuuaOp+mCu+agvOaYr+WQpuiiq+aVjOaOp++8iOaXoCB2aXNpdCDlm57osIPvvIkNCiAgICBpZiAoZm9yU2VhcmNoTGVhZiAmJiBib2FyZEluZm8gJiYgYm9hcmRJbmZvLnVzZUF0dGFja0JpdHMgJiYgYm9hcmQpIHsNCiAgICAgICAgZm9yIChsZXQgZ2kgPSAwOyBnaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBnaSsrKSB7DQogICAgICAgICAgICBjb25zdCBnZW5lcmFsID0gcGllY2VzSW5mb1tnaV07DQogICAgICAgICAgICBpZiAoZ2VuZXJhbC5waWVjZS50eXBlICE9PSBQSUVDRV9UWVBFUy5HRU5FUkFMKSBjb250aW51ZTsNCg0KICAgICAgICAgICAgY29uc3QgZ2VuZXJhbENvbG9yID0gZ2VuZXJhbC5waWVjZS5jb2xvcjsNCiAgICAgICAgICAgIGNvbnN0IGVuZW15Qml0cyA9IGdlbmVyYWxDb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8uYmxhY2tBdHRhY2sgOiBib2FyZEluZm8ucmVkQXR0YWNrOw0KICAgICAgICAgICAgY29uc3QgaXNSZWQgPSBnZW5lcmFsQ29sb3IgPT09ICdyZWQnOw0KICAgICAgICAgICAgY29uc3QgeyByLCBjIH0gPSBnZW5lcmFsOw0KICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBuciA9IHIgKyBPUlRIX0RJUlNbaV1bMF07DQogICAgICAgICAgICAgICAgY29uc3QgbmMgPSBjICsgT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICAgICAgICAgIGlmIChuYyA8IDMgfHwgbmMgPiA1KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAoaXNSZWQgPyAobnIgPCAwIHx8IG5yID4gMikgOiAobnIgPCA3IHx8IG5yID4gOSkpIGNvbnRpbnVlOw0KICAgICAgICAgICAgICAgIGlmIChib2FyZFtucl1bbmNdID09PSBudWxsICYmIGhhc0F0dGFja0JpdChlbmVteUJpdHMsIG5yICogOSArIG5jKSkgew0KICAgICAgICAgICAgICAgICAgICBnZW5lcmFsLnNhZmV0eVZhbHVlIC09IDUwOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICByZXR1cm47DQogICAgfQ0KDQogICAgY29uc3QgZ2VuZXJhbEluZm8gPSBbXTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpZWNlc0luZm8ubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgaWYgKHBpZWNlc0luZm9baV0ucGllY2UudHlwZSA9PT0gUElFQ0VfVFlQRVMuR0VORVJBTCkgZ2VuZXJhbEluZm8ucHVzaChwaWVjZXNJbmZvW2ldKTsNCiAgICB9DQoNCiAgICBjb25zdCBzYWZldHlVc2VBdHRhY2tCaXRzID0gISEoYm9hcmRJbmZvICYmIGJvYXJkSW5mby51c2VBdHRhY2tCaXRzKTsNCiAgICBjb25zdCBzYWZldHlVc2VNYXNrcyA9ICEhKGJvYXJkSW5mbyAmJiBib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcyk7DQogICAgZm9yIChsZXQgZ2kgPSAwOyBnaSA8IGdlbmVyYWxJbmZvLmxlbmd0aDsgZ2krKykgew0KICAgICAgICBjb25zdCBnZW5lcmFsID0gZ2VuZXJhbEluZm9bZ2ldOw0KICAgICAgICBjb25zdCBnZW5lcmFsQ29sb3IgPSBnZW5lcmFsLnBpZWNlLmNvbG9yOw0KICAgICAgICBjb25zdCBlbmVteUNvbG9yID0gZ2VuZXJhbENvbG9yID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgY29uc3QgZW5lbXlCaXRzID0gc2FmZXR5VXNlQXR0YWNrQml0cw0KICAgICAgICAgICAgPyAoZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyBib2FyZEluZm8ucmVkQXR0YWNrIDogYm9hcmRJbmZvLmJsYWNrQXR0YWNrKQ0KICAgICAgICAgICAgOiBudWxsOw0KICAgICAgICBjb25zdCBpc1JlZCA9IGdlbmVyYWxDb2xvciA9PT0gJ3JlZCc7DQogICAgICAgIGNvbnN0IHsgciwgYyB9ID0gZ2VuZXJhbDsNCg0KICAgICAgICBjb25zdCBwZW5hbGl6ZUlmRW5lbXkgPSAobnIsIG5jKSA9PiB7DQogICAgICAgICAgICBsZXQgaGFzRW5lbXlDb250cm9sOw0KICAgICAgICAgICAgaWYgKHNhZmV0eVVzZUF0dGFja0JpdHMpIHsNCiAgICAgICAgICAgICAgICBoYXNFbmVteUNvbnRyb2wgPSBoYXNBdHRhY2tCaXQoZW5lbXlCaXRzLCBuciAqIDkgKyBuYyk7DQogICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uQ29udHJvbGxlcnMgPSBib2FyZEluZm9bbnJdW25jXTsNCiAgICAgICAgICAgICAgICBoYXNFbmVteUNvbnRyb2wgPSBmYWxzZTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBjaSA9IDA7IGNpIDwgcG9zaXRpb25Db250cm9sbGVycy5sZW5ndGg7IGNpKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udHJvbGxlciA9IHBvc2l0aW9uQ29udHJvbGxlcnNbY2ldOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2xvciA9IGNvbnRyb2xsZXIucGllY2UgPyBjb250cm9sbGVyLnBpZWNlLmNvbG9yIDogY29udHJvbGxlci5jb2xvcjsNCiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbG9yID09PSBlbmVteUNvbG9yKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBoYXNFbmVteUNvbnRyb2wgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAoaGFzRW5lbXlDb250cm9sKSBnZW5lcmFsLnNhZmV0eVZhbHVlIC09IDUwOw0KICAgICAgICB9Ow0KDQogICAgICAgIGlmICgoc2FmZXR5VXNlTWFza3MgJiYgYm9hcmQpIHx8ICgoIWdlbmVyYWwuY29udHJvbCB8fCBnZW5lcmFsLmNvbnRyb2wubGVuZ3RoID09PSAwKSAmJiBib2FyZCkpIHsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgbnIgPSByICsgT1JUSF9ESVJTW2ldWzBdOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5jID0gYyArIE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgICAgICAgICBpZiAobmMgPCAzIHx8IG5jID4gNSkgY29udGludWU7DQogICAgICAgICAgICAgICAgaWYgKGlzUmVkID8gKG5yIDwgMCB8fCBuciA+IDIpIDogKG5yIDwgNyB8fCBuciA+IDkpKSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCkgcGVuYWxpemVJZkVuZW15KG5yLCBuYyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAoZ2VuZXJhbC5jb250cm9sICYmIGdlbmVyYWwuY29udHJvbC5sZW5ndGgpIHsNCiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ2VuZXJhbC5jb250cm9sLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICAgICAgcGVuYWxpemVJZkVuZW15KGdlbmVyYWwuY29udHJvbFtpXS5yLCBnZW5lcmFsLmNvbnRyb2xbaV0uYyk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQp9Ow0KDQovLyBTZWFyY2ggbGVhdmVzIG5ldmVyIGNvbnN0cnVjdCBVSSByZWxhdGlvbiBsaXN0cy4gVGhpcyBwYXRoIGNvbnN1bWVzIG9ubHkNCi8vIHBpZWNlQ29kZS9zcSBhbmQgdGhlIG1hc2tzIGVtaXR0ZWQgYnkgdGhlIG51bWVyaWMgcmVsYXRpb24gYnVpbGRlci4NCi8vIC0tLSBUeXBlcyAoSW5saW5lZCB0byBhdm9pZCBpbXBvcnQgaXNzdWVzIGluIFdvcmtlcikgLS0tDQovLyAvLyB0eXBlIENvbG9yIC0gVHlwZVNjcmlwdCB0eXBlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eSAncmVkJyB8ICdibGFjayc7DQovLyAvLyB0eXBlIFBpZWNlVHlwZSAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgJ2dlbmVyYWwnIHwgJ2Fkdmlzb3InIHwgJ2VsZXBoYW50JyB8ICdob3JzZScgfCAnY2hhcmlvdCcgfCAnY2Fubm9uJyB8ICdzb2xkaWVyJzsNCi8vIC8vIGludGVyZmFjZSBQaWVjZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gaW50ZXJmYWNlIFBvc2l0aW9uIC0gVHlwZVNjcmlwdCBpbnRlcmZhY2UgcmVtb3ZlZCBmb3IgSmF2YVNjcmlwdCBjb21wYXRpYmlsaXR5DQovLyAvLyBpbnRlcmZhY2UgTW92ZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KLy8gLy8gdHlwZSBCb2FyZCAtIFR5cGVTY3JpcHQgdHlwZSByZW1vdmVkIGZvciBKYXZhU2NyaXB0IGNvbXBhdGliaWxpdHkgKFBpZWNlIHwgbnVsbClbXVtdOw0KDQovLyAtLS0gT3BlbmluZyBCb29rIFR5cGVzIC0tLQ0KLy8gT3BlbmluZyBCb29rIEVudHJ5IC0gcmVwcmVzZW50cyBwb3NzaWJsZSBtb3ZlcyBmb3IgYSBwb3NpdGlvbg0KLy8gaW50ZXJmYWNlIEJvb2tFbnRyeSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KDQovLyBJbmRpdmlkdWFsIG1vdmUgaW4gb3BlbmluZyBib29rIHdpdGggbWV0YWRhdGENCi8vIGludGVyZmFjZSBCb29rTW92ZSAtIFR5cGVTY3JpcHQgaW50ZXJmYWNlIHJlbW92ZWQgZm9yIEphdmFTY3JpcHQgY29tcGF0aWJpbGl0eQ0KDQovLyAtLS0gWm9icmlzdCBIYXNoaW5nIGZvciBPcGVuaW5nIEJvb2sgLS0tDQovLyBFYWNoIHBpZWNlIHR5cGUvY29sb3IvcG9zaXRpb24gZ2V0cyBhIHVuaXF1ZSByYW5kb20gNTMtYml0IGludGVnZXINCi8vIFVzZXMgc2VlZGVkIFJORyBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nDQpjbGFzcyBab2JyaXN0SGFzaGVyIHsNCiAgICBoYXNoVGFibGU7ICAvLyBbcm93XVtjb2xdW3BpZWNlSW5kZXhdDQogICAgcGllY2VUb0luZGV4Ow0KDQogICAgY29uc3RydWN0b3IoKSB7DQogICAgICAgIHRoaXMucGllY2VUb0luZGV4ID0gbmV3IE1hcChbDQogICAgICAgICAgICBbJ3JlZC1nZW5lcmFsJywgMF0sIFsncmVkLWFkdmlzb3InLCAxXSwgWydyZWQtZWxlcGhhbnQnLCAyXSwgWydyZWQtaG9yc2UnLCAzXSwNCiAgICAgICAgICAgIFsncmVkLWNoYXJpb3QnLCA0XSwgWydyZWQtY2Fubm9uJywgNV0sIFsncmVkLXNvbGRpZXInLCA2XSwNCiAgICAgICAgICAgIFsnYmxhY2stZ2VuZXJhbCcsIDddLCBbJ2JsYWNrLWFkdmlzb3InLCA4XSwgWydibGFjay1lbGVwaGFudCcsIDldLCBbJ2JsYWNrLWhvcnNlJywgMTBdLA0KICAgICAgICAgICAgWydibGFjay1jaGFyaW90JywgMTFdLCBbJ2JsYWNrLWNhbm5vbicsIDEyXSwgWydibGFjay1zb2xkaWVyJywgMTNdDQogICAgICAgIF0pOw0KICAgICAgICAvLyBJbml0aWFsaXplIHJhbmRvbSBoYXNoIHZhbHVlcyB1c2luZyBzZWVkZWQgUk5HICg1My1iaXQgaW50ZWdlcnMgdG8gYXZvaWQgcHJlY2lzaW9uIGlzc3VlcykNCiAgICAgICAgdGhpcy5oYXNoVGFibGUgPSBbXTsNCiAgICAgICAgY29uc3QgTUFYX1NBRkUgPSAweDFGRkZGRkZGRkZGRkZGOyAvLyAyXjUzIC0gMQ0KICAgICAgICANCiAgICAgICAgLy8gU2ltcGxlIHNlZWRlZCBSTkcgKExDRyAtIExpbmVhciBDb25ncnVlbnRpYWwgR2VuZXJhdG9yKQ0KICAgICAgICBsZXQgc2VlZCA9IDEyMzQ1Njc4OTsgLy8gRml4ZWQgc2VlZCBmb3IgZGV0ZXJtaW5pc3RpYyBoYXNoaW5nDQogICAgICAgIGNvbnN0IHNlZWRlZFJhbmRvbSA9ICgpID0+IHsNCiAgICAgICAgICAgIHNlZWQgPSAoc2VlZCAqIDExMDM1MTUyNDUgKyAxMjM0NSkgJiAweDdmZmZmZmZmOw0KICAgICAgICAgICAgcmV0dXJuIHNlZWQgLyAweDdmZmZmZmZmOw0KICAgICAgICB9Ow0KDQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl0gPSBbXTsNCiAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgOTsgYysrKSB7DQogICAgICAgICAgICAgICAgdGhpcy5oYXNoVGFibGVbcl1bY10gPSBbXTsNCiAgICAgICAgICAgICAgICBmb3IgKGxldCBwID0gMDsgcCA8IDE0OyBwKyspIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgZGV0ZXJtaW5pc3RpYyA1My1iaXQgaW50ZWdlcg0KICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWx1ZSA9IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSk7DQogICAgICAgICAgICAgICAgICAgIHRoaXMuaGFzaFRhYmxlW3JdW2NdW3BdID0gdmFsdWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgLy8g5qC85Y+355u057Si5byV77yaaGFzaEJ5U3Fbc3FdW3BpZWNlSWR4Xe+8jOmBv+WFjeeDrei3r+W+hCAoc3EvOSl8MCDkuI4gJTkNCiAgICAgICAgdGhpcy5oYXNoQnlTcSA9IG5ldyBBcnJheSg5MCk7DQogICAgICAgIGZvciAobGV0IHNxID0gMDsgc3EgPCA5MDsgc3ErKykgew0KICAgICAgICAgICAgdGhpcy5oYXNoQnlTcVtzcV0gPSB0aGlzLmhhc2hUYWJsZVtTUV9ST1dbc3FdXVtTUV9DT0xbc3FdXTsNCiAgICAgICAgfQ0KDQogICAgICAgIC8vIOWPtuivhOS8sOe8k+WtmOmUru+8mmJvYXJkSGFzaCBeIGluaXRpYXRvcktleSBeIHN0YWdlS2V5DQogICAgICAgIHRoaXMuZXZhbEluaXRpYXRvcktleXMgPSB7DQogICAgICAgICAgICByZWQ6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSksDQogICAgICAgICAgICBibGFjazogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKQ0KICAgICAgICB9Ow0KICAgICAgICB0aGlzLmV2YWxTdGFnZUtleXMgPSB7DQogICAgICAgICAgICBlYXJseTogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwNCiAgICAgICAgICAgIG1pZDogTWF0aC5mbG9vcihzZWVkZWRSYW5kb20oKSAqIE1BWF9TQUZFKSwNCiAgICAgICAgICAgIGxhdGU6IE1hdGguZmxvb3Ioc2VlZGVkUmFuZG9tKCkgKiBNQVhfU0FGRSkNCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICBwaWVjZUluZGV4KHBpZWNlT3JLZXkpIHsNCiAgICAgICAgaWYgKHBpZWNlT3JLZXkgPT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDsNCiAgICAgICAgbGV0IGNvbG9yOw0KICAgICAgICBsZXQgdHlwZTsNCiAgICAgICAgaWYgKHR5cGVvZiBwaWVjZU9yS2V5ID09PSAnc3RyaW5nJykgew0KICAgICAgICAgICAgY29uc3Qgc2VwYXJhdG9yID0gcGllY2VPcktleS5pbmRleE9mKCctJyk7DQogICAgICAgICAgICBpZiAoc2VwYXJhdG9yIDwgMCkgcmV0dXJuIHVuZGVmaW5lZDsNCiAgICAgICAgICAgIGNvbG9yID0gcGllY2VPcktleS5zbGljZSgwLCBzZXBhcmF0b3IpOw0KICAgICAgICAgICAgdHlwZSA9IHBpZWNlT3JLZXkuc2xpY2Uoc2VwYXJhdG9yICsgMSk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBjb2xvciA9IHBpZWNlT3JLZXkuY29sb3I7DQogICAgICAgICAgICB0eXBlID0gcGllY2VPcktleS50eXBlOw0KICAgICAgICB9DQogICAgICAgIGxldCB0eXBlSW5kZXg7DQogICAgICAgIHN3aXRjaCAodHlwZSkgew0KICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5HRU5FUkFMOiB0eXBlSW5kZXggPSAwOyBicmVhazsNCiAgICAgICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuQURWSVNPUjogdHlwZUluZGV4ID0gMTsgYnJlYWs7DQogICAgICAgICAgICBjYXNlIFBJRUNFX1RZUEVTLkVMRVBIQU5UOiB0eXBlSW5kZXggPSAyOyBicmVhazsNCiAgICAgICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuSE9SU0U6IHR5cGVJbmRleCA9IDM7IGJyZWFrOw0KICAgICAgICAgICAgY2FzZSBQSUVDRV9UWVBFUy5DSEFSSU9UOiB0eXBlSW5kZXggPSA0OyBicmVhazsNCiAgICAgICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuQ0FOTk9OOiB0eXBlSW5kZXggPSA1OyBicmVhazsNCiAgICAgICAgICAgIGNhc2UgUElFQ0VfVFlQRVMuU09MRElFUjogdHlwZUluZGV4ID0gNjsgYnJlYWs7DQogICAgICAgICAgICBkZWZhdWx0OiByZXR1cm4gdW5kZWZpbmVkOw0KICAgICAgICB9DQogICAgICAgIGlmIChjb2xvciA9PT0gJ3JlZCcpIHJldHVybiB0eXBlSW5kZXg7DQogICAgICAgIHJldHVybiBjb2xvciA9PT0gJ2JsYWNrJyA/IHR5cGVJbmRleCArIDcgOiB1bmRlZmluZWQ7DQogICAgfQ0KDQogICAgZXZhbENhY2hlS2V5KGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSkgew0KICAgICAgICBjb25zdCBzdGFnZUtleSA9IHRoaXMuZXZhbFN0YWdlS2V5c1tnYW1lU3RhZ2VdIHx8IHRoaXMuZXZhbFN0YWdlS2V5cy5taWQ7DQogICAgICAgIHJldHVybiB0aGlzLmhhc2goYm9hcmQpIF4gdGhpcy5ldmFsSW5pdGlhdG9yS2V5c1tzZWFyY2hJbml0aWF0b3JdIF4gc3RhZ2VLZXk7DQogICAgfQ0KDQogICAgZXZhbENhY2hlS2V5RnJvbUhhc2goYm9hcmRIYXNoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSkgew0KICAgICAgICBjb25zdCBzdGFnZUtleSA9IHRoaXMuZXZhbFN0YWdlS2V5c1tnYW1lU3RhZ2VdIHx8IHRoaXMuZXZhbFN0YWdlS2V5cy5taWQ7DQogICAgICAgIHJldHVybiBib2FyZEhhc2ggXiB0aGlzLmV2YWxJbml0aWF0b3JLZXlzW3NlYXJjaEluaXRpYXRvcl0gXiBzdGFnZUtleTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiDmlbDlgLwgVFQga2V577ya5oqK6KGM5qOL5pa557yW56CB6L+b5pyA5L2O5L2N77yM6YG/5YWNIGBoYXNoIF4gc2lkZUtleWAg5ZyoIEpTIFRvSW50MzINCiAgICAgKiDkuIvkuqfnlJ/ot6jnuqLpu5HnorDmkp7vvIjpgqPkvJrkvb8gVFQg6K+v5ZG95Lit5bm25pS55Y+Y5pCc57Si5qCRL+aji+WKm++8ieOAgg0KICAgICAqIOetieS7t+S6juaXp+Wtl+espuS4siBrZXkgYCR7aGFzaH06JHtzaWRlfWAg55qE5Yy65YiG6IO95Yqb44CCDQogICAgICovDQogICAgdHRLZXlGcm9tSGFzaChib2FyZEhhc2gsIHNpZGUpIHsNCiAgICAgICAgY29uc3QgaCA9IGJvYXJkSGFzaCB8IDA7IC8vIF49IOmTvue7k+aenOW3suaYryBJbnQzMg0KICAgICAgICByZXR1cm4gaCAqIDIgKyAoc2lkZSA9PT0gJ3JlZCcgPyAwIDogMSk7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQ29tcHV0ZSBoYXNoIGZvciBhIGJvYXJkIHBvc2l0aW9uDQogICAgICovDQogICAgaGFzaChib2FyZCkgew0KICAgICAgICBsZXQgaCA9IDA7DQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsNCiAgICAgICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgICAgIGlmIChwaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwaWVjZUlkeCA9IHRoaXMucGllY2VJbmRleChwaWVjZSk7DQogICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZUlkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBoIF49IHRoaXMuaGFzaFRhYmxlW3JdW2NdW3BpZWNlSWR4XTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gaDsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBNaXJyb3IgYSBib2FyZCBob3Jpem9udGFsbHkgKGZvciBzeW1tZXRyeSBkZXRlY3Rpb24pDQogICAgICovDQogICAgbWlycm9yQm9hcmQoYm9hcmQpIHsNCiAgICAgICAgY29uc3QgbWlycm9yZWQgPSBBcnJheSgxMCkuZmlsbChudWxsKS5tYXAoKCkgPT4gQXJyYXkoOSkuZmlsbChudWxsKSk7DQogICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsNCiAgICAgICAgICAgICAgICBtaXJyb3JlZFtyXVs4IC0gY10gPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gbWlycm9yZWQ7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogTWlycm9yIGEgbW92ZSBob3Jpem9udGFsbHkNCiAgICAgKi8NCiAgICBtaXJyb3JNb3ZlKG1vdmUpIHsNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIGZyb206IHsgcjogbW92ZS5mcm9tLnIsIGM6IDggLSBtb3ZlLmZyb20uYyB9LA0KICAgICAgICAgICAgdG86IHsgcjogbW92ZS50by5yLCBjOiA4IC0gbW92ZS50by5jIH0NCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBJbmNyZW1lbnRhbGx5IHVwZGF0ZSBoYXNoIGFmdGVyIGEgbW92ZSAoWE9SIOiHqumAhu+8muWGjeiwg+eUqOS4gOasoeWPr+i/mOWOnykuDQogICAgICogbW92aW5nUGllY2UgLyBjYXB0dXJlZFBpZWNlIOWPr+S4uuaji+WtkOWvueixoeaIliAnY29sb3ItdHlwZScg5a2X56ym5Liy44CCDQogICAgICog6aG75ZyoIG1ha2VNb3ZlIOS5i+WJjeWPluW+lyBtb3ZpbmdQaWVjZe+8jGNhcHR1cmVkIOeUqCBtYWtlTW92ZSDov5Tlm57lgLzjgIINCiAgICAgKi8NCiAgICB1cGRhdGVIYXNoKGN1cnJlbnRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWRQaWVjZSkgew0KICAgICAgICBsZXQgbmV3SGFzaCA9IGN1cnJlbnRIYXNoOw0KICAgICAgICBjb25zdCBtb3ZpbmdJZHggPSB0aGlzLnBpZWNlSW5kZXgobW92aW5nUGllY2UpOw0KICAgICAgICBpZiAobW92aW5nSWR4ICE9PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS5mcm9tLnJdW21vdmUuZnJvbS5jXVttb3ZpbmdJZHhdOw0KICAgICAgICAgICAgbmV3SGFzaCBePSB0aGlzLmhhc2hUYWJsZVttb3ZlLnRvLnJdW21vdmUudG8uY11bbW92aW5nSWR4XTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgew0KICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRJZHggPSB0aGlzLnBpZWNlSW5kZXgoY2FwdHVyZWRQaWVjZSk7DQogICAgICAgICAgICBpZiAoY2FwdHVyZWRJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgIG5ld0hhc2ggXj0gdGhpcy5oYXNoVGFibGVbbW92ZS50by5yXVttb3ZlLnRvLmNdW2NhcHR1cmVkSWR4XTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgICAgICByZXR1cm4gbmV3SGFzaDsNCiAgICB9DQp9DQoNCi8qKg0KICogT3BlbmluZyBCb29rIE1hbmFnZXINCiAqLw0KY2xhc3MgT3BlbmluZ0Jvb2sgew0KICAgIGJvb2s7ICAvLyBab2JyaXN0IGhhc2ggLT4gbW92ZXMNCiAgICBoYXNoZXI7DQogICAgZW5hYmxlZDsNCiAgICBtYXhQbHk7ICAvLyBNYXhpbXVtIHBseSB0byB1c2Ugb3BlbmluZyBib29rIChlLmcuLCAyMCkNCg0KICAgIGNvbnN0cnVjdG9yKG1heFBseSA9IDEyKSB7DQogICAgICAgIHRoaXMuYm9vayA9IG5ldyBNYXAoKTsNCiAgICAgICAgdGhpcy5oYXNoZXIgPSBuZXcgWm9icmlzdEhhc2hlcigpOw0KICAgICAgICB0aGlzLmVuYWJsZWQgPSB0cnVlOw0KICAgICAgICB0aGlzLm1heFBseSA9IG1heFBseTsNCiAgICAgICAgdGhpcy5pbml0aWFsaXplQm9vaygpOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEluaXRpYWxpemUgd2l0aCBjb21tb24gQ2hpbmVzZSBDaGVzcyBvcGVuaW5ncw0KICAgICAqLw0KICAgIGluaXRpYWxpemVCb29rKCkgew0KICAgICAgICAvLyBBZGQgY2xhc3NpYyBDaGluZXNlIENoZXNzIG9wZW5pbmdzIG1hbnVhbGx5DQogICAgICAgIA0KICAgICAgICAvKg0KICAgICAgICAvLyAxLiDkuK3ngq7ov4fmsrPovablr7nlsY/po47pqazlubPngq7lr7novaYgKENlbnRyYWwgQ2Fubm9uIHZzIFNjcmVlbiBIb3JzZXMpDQogICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmUoWw0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDcsIGM6IDcgfSwgdG86IHsgcjogNywgYzogNCB9IH0sICAvLyAxLiDngq7kuozlubPkupQNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiA3IH0sIHRvOiB7IHI6IDIsIGM6IDYgfSB9LCAgLy8gMS4uLiDpqaw46L+bNw0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDksIGM6IDcgfSwgdG86IHsgcjogNywgYzogNiB9IH0sICAvLyAyLiDpqazkuozov5vkuIkNCiAgICAgICAgICAgIHsgZnJvbTogeyByOiAwLCBjOiA4IH0sIHRvOiB7IHI6IDAsIGM6IDcgfSB9LCAgLy8gMi4uLiDovaY55bmzOCAgICAgICAgICAgDQogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogOCB9LCB0bzogeyByOiA5LCBjOiA3IH0gfSwgIC8vIDMuIOi9puS4gOW5s+S6jA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDMsIGM6IDYgfSwgdG86IHsgcjogNCwgYzogNiB9IH0sICAvLyAzLi4uIOWNkjfov5sxDQogICAgICAgICAgICB7IGZyb206IHsgcjogOSwgYzogNyB9LCB0bzogeyByOiAzLCBjOiA3IH0gfSwgIC8vIDQuIOi9puS6jOi/m+WFrQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDAsIGM6IDEgfSwgdG86IHsgcjogMiwgYzogMiB9IH0sICAvLyA0Li4uIOmprDLov5szDQogICAgICAgICAgICB7IGZyb206IHsgcjogNiwgYzogMiB9LCB0bzogeyByOiA1LCBjOiAyIH0gfSwgIC8vIDUuIOWFteS4g+i/m+S4gA0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDIsIGM6IDcgfSwgdG86IHsgcjogMiwgYzogOCB9IH0sICAvLyA1Li4uIOeCrjjlubM5DQogICAgICAgICAgICB7IGZyb206IHsgcjogMywgYzogNyB9LCB0bzogeyByOiAzLCBjOiA2IH0gfSwgIC8vIDYuIOi9puS6jOW5s+S4iQ0KICAgICAgICAgICAgeyBmcm9tOiB7IHI6IDIsIGM6IDggfSwgdG86IHsgcjogMSwgYzogOCB9IH0sICAvLyA2Li4uIOeCrjnpgIAxICAgICAgICAgIA0KICAgICAgICBdLCBbODUsIDg1LCA5NSwgOTAsIDkwLCA4NSwgODUsIDgwLCA4NSwgODUsIDg1LCA4NV0pOw0KDQogICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmVGcm9tTm90YXRpb24oWw0KICAgICAgICAgICAgJ+eCruS6jOW5s+S6lCcsICfpqaw46L+bNycsICfpqazkuozov5vkuIknLCAn6L2mOeW5szgnLCAn6L2m5LiA5bmz5LqMJywgJ+WNkjfov5sxJywNCiAgICAgICAgICAgICfovabkuozov5vlha0nLCAn6amsMui/mzMnLCAn5YW15LiD6L+b5LiAJywgJ+eCrjjlubM5JywgJ+i9puS6jOW5s+S4iScsICfngq456YCAMScsDQogICAgICAgICAgICBdLCBbODUsIDg1LCA5NSwgOTAsIDkwLCA4NSwgODUsIDgwLCA4NSwgODUsIDg1LCA4NV0pOw0KDQogICAgICAgICAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21TdHJpbmcoWw0KICAgICAgICAgICAgJ+eCruS6jOW5s+S6lCDpqaw46L+bNyDpqazkuozov5vkuIkg6L2mOeW5szgg6L2m5LiA5bmz5LqMIOWNkjfov5sxIOi9puS6jOi/m+WFrSDpqawy6L+bMyDlhbXkuIPov5vkuIAg54KuOOW5szkg6L2m5LqM5bmz5LiJIOeCrjnpgIAxJw0KICAgICAgICBdLCBbODUsIDg1LCA5NSwgOTAsIDkwLCA4NSwgODUsIDgwLCA4NSwgODUsIDg1LCA4NV0pOw0KICAgICAgICAqLw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEFkZCBhbiBvcGVuaW5nIGxpbmUgdG8gdGhlIGJvb2sNCiAgICAgKiBAcGFyYW0gbW92ZXMgQXJyYXkgb2YgbW92ZXMgcmVwcmVzZW50aW5nIGFuIG9wZW5pbmcgbGluZQ0KICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIHdlaWdodHMgZm9yIGVhY2ggbW92ZSAoZGVmYXVsdCAxMDAgZm9yIGFsbCkNCiAgICAgKi8NCiAgICBhZGRPcGVuaW5nTGluZShtb3Zlcywgd2VpZ2h0cykgew0KICAgICAgICAvLyBTdGFydCB3aXRoIGluaXRpYWwgYm9hcmQgcG9zaXRpb24NCiAgICAgICAgY29uc3QgYm9hcmQgPSB0aGlzLmNyZWF0ZUluaXRpYWxCb2FyZCgpOw0KICAgICAgICBsZXQgY3VycmVudEhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKGJvYXJkKTsNCg0KICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1vdmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgICAgICBjb25zdCBtb3ZlID0gbW92ZXNbaV07DQogICAgICAgICAgICBjb25zdCB3ZWlnaHQgPSB3ZWlnaHRzPy5baV0gPz8gMTAwOw0KDQogICAgICAgICAgICAvLyBHZXQgb3IgY3JlYXRlIGJvb2sgZW50cnkgZm9yIHRoaXMgcG9zaXRpb24NCiAgICAgICAgICAgIGxldCBlbnRyeSA9IHRoaXMuYm9vay5nZXQoY3VycmVudEhhc2gpOw0KICAgICAgICAgICAgaWYgKCFlbnRyeSkgew0KICAgICAgICAgICAgICAgIGVudHJ5ID0geyBtb3ZlczogW10gfTsNCiAgICAgICAgICAgICAgICB0aGlzLmJvb2suc2V0KGN1cnJlbnRIYXNoLCBlbnRyeSk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIEFkZCBtb3ZlIGlmIG5vdCBhbHJlYWR5IHByZXNlbnQNCiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nTW92ZSA9IGVudHJ5Lm1vdmVzLmZpbmQoDQogICAgICAgICAgICAgICAgbSA9PiBtLmZyb20uciA9PT0gbW92ZS5mcm9tLnIgJiYgbS5mcm9tLmMgPT09IG1vdmUuZnJvbS5jICYmDQogICAgICAgICAgICAgICAgICAgICBtLnRvLnIgPT09IG1vdmUudG8uciAmJiBtLnRvLmMgPT09IG1vdmUudG8uYw0KICAgICAgICAgICAgKTsNCg0KICAgICAgICAgICAgaWYgKCFleGlzdGluZ01vdmUpIHsNCiAgICAgICAgICAgICAgICBlbnRyeS5tb3Zlcy5wdXNoKHsNCiAgICAgICAgICAgICAgICAgICAgZnJvbTogeyByOiBtb3ZlLmZyb20uciwgYzogbW92ZS5mcm9tLmMgfSwNCiAgICAgICAgICAgICAgICAgICAgdG86IHsgcjogbW92ZS50by5yLCBjOiBtb3ZlLnRvLmMgfSwNCiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiB3ZWlnaHQNCiAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8gVXBkYXRlIHdlaWdodCBpZiBtb3ZlIGFscmVhZHkgZXhpc3RzICh0YWtlIG1heGltdW0pDQogICAgICAgICAgICAgICAgZXhpc3RpbmdNb3ZlLndlaWdodCA9IE1hdGgubWF4KGV4aXN0aW5nTW92ZS53ZWlnaHQsIHdlaWdodCk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIE1ha2UgdGhlIG1vdmUgb24gdGhlIGJvYXJkDQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107DQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZCA9IGJvYXJkW21vdmUudG8ucl1bbW92ZS50by5jXTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKCFwaWVjZSkgYnJlYWs7IC8vIEludmFsaWQgbGluZQ0KDQogICAgICAgICAgICBjb25zdCBwaWVjZUtleSA9IGAke3BpZWNlLmNvbG9yfS0ke3BpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkS2V5ID0gY2FwdHVyZWQgPyBgJHtjYXB0dXJlZC5jb2xvcn0tJHtjYXB0dXJlZC50eXBlfWAgOiB1bmRlZmluZWQ7DQoNCiAgICAgICAgICAgIC8vIFVwZGF0ZSBoYXNoIGluY3JlbWVudGFsbHkNCiAgICAgICAgICAgIGN1cnJlbnRIYXNoID0gdGhpcy5oYXNoZXIudXBkYXRlSGFzaChjdXJyZW50SGFzaCwgbW92ZSwgcGllY2VLZXksIGNhcHR1cmVkS2V5KTsNCg0KICAgICAgICAgICAgLy8gQXBwbHkgbW92ZQ0KICAgICAgICAgICAgYm9hcmRbbW92ZS50by5yXVttb3ZlLnRvLmNdID0gcGllY2U7DQogICAgICAgICAgICBib2FyZFttb3ZlLmZyb20ucl1bbW92ZS5mcm9tLmNdID0gbnVsbDsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEdldCBiZXN0IG1vdmUgZnJvbSBvcGVuaW5nIGJvb2sgZm9yIGN1cnJlbnQgcG9zaXRpb24NCiAgICAgKiBAcGFyYW0gYm9hcmQgQ3VycmVudCBib2FyZCBzdGF0ZQ0KICAgICAqIEBwYXJhbSBwbHkgQ3VycmVudCBwbHkgbnVtYmVyICgwID0gc3RhcnQgb2YgZ2FtZSkNCiAgICAgKiBAcmV0dXJucyBNb3ZlIGZyb20gYm9vaywgb3IgbnVsbCBpZiBwb3NpdGlvbiBub3QgaW4gYm9vaw0KICAgICAqLw0KICAgIGdldEJvb2tNb3ZlKGJvYXJkLCBwbHkpew0KICAgICAgICAvLyBEb24ndCB1c2UgYm9vayBpZiBkaXNhYmxlZCBvciBwYXN0IG1heCBwbHkNCiAgICAgICAgaWYgKCF0aGlzLmVuYWJsZWQgfHwgcGx5ID49IHRoaXMubWF4UGx5KSB7DQogICAgICAgICAgICBjb25zb2xlLmxvZygnT3BlbmluZyBib29rIGRpc2FibGVkIG9yIHBhc3QgbWF4IHBseScsIHsgZW5hYmxlZDogdGhpcy5lbmFibGVkLCBtYXhQbHk6IHRoaXMubWF4UGx5LCBwbHk6IHBseSB9KTsNCiAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvL2NvbnNvbGUubG9nKCdPcGVuaW5nIGJvb2sgZ2V0Qm9va01vdmUgY2FsbGVkJywgeyBwbHkgfSk7DQogICAgICAgIA0KICAgICAgICAvLyBUcnkgdG8gZmluZCBtb3ZlIGZvciBjdXJyZW50IHBvc2l0aW9uDQogICAgICAgIGNvbnN0IGhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKGJvYXJkKTsNCiAgICAgICAgLy9jb25zb2xlLmxvZygnQ3VycmVudCBwb3NpdGlvbiBoYXNoOicsIGhhc2gpOw0KICAgICAgICANCiAgICAgICAgbGV0IGVudHJ5ID0gdGhpcy5ib29rLmdldChoYXNoKTsNCiAgICAgICAgLy9jb25zb2xlLmxvZygnRW50cnkgZm91bmQgZm9yIGN1cnJlbnQgaGFzaDonLCBlbnRyeSA/IGVudHJ5Lm1vdmVzLmxlbmd0aCArICcgbW92ZXMnIDogJ251bGwnKTsNCiAgICAgICAgaWYgKGVudHJ5ICYmIGVudHJ5Lm1vdmVzLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdBbGwgcG9zc2libGUgYm9vayBtb3ZlcyB3aXRoIHdlaWdodHM6JywgSlNPTi5zdHJpbmdpZnkoZW50cnkubW92ZXMpKTsNCiAgICAgICAgICAgIC8vIENhbGN1bGF0ZSB0b3RhbCB3ZWlnaHQNCiAgICAgICAgICAgIGNvbnN0IHRvdGFsV2VpZ2h0ID0gZW50cnkubW92ZXMucmVkdWNlKChzdW0sIG1vdmUpID0+IHN1bSArIG1vdmUud2VpZ2h0LCAwKTsNCiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdUb3RhbCB3ZWlnaHQ6JywgdG90YWxXZWlnaHQpOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICBsZXQgbWlycm9yZWRNb3ZlID0gZmFsc2U7DQoNCiAgICAgICAgLy8gSWYgbm90IGZvdW5kLCB0cnkgbWlycm9yZWQgcG9zaXRpb24NCiAgICAgICAgaWYgKCFlbnRyeSB8fCBlbnRyeS5tb3Zlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIGNvbnN0IG1pcnJvcmVkQm9hcmQgPSB0aGlzLmhhc2hlci5taXJyb3JCb2FyZChib2FyZCk7DQogICAgICAgICAgICBjb25zdCBtaXJyb3JlZEhhc2ggPSB0aGlzLmhhc2hlci5oYXNoKG1pcnJvcmVkQm9hcmQpOw0KICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIGVudHJ5IGZvdW5kLCB0cnlpbmcgbWlycm9yZWQgcG9zaXRpb246JywgbWlycm9yZWRIYXNoKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgZW50cnkgPSB0aGlzLmJvb2suZ2V0KG1pcnJvcmVkSGFzaCk7DQogICAgICAgICAgICBpZiAoZW50cnkgJiYgZW50cnkubW92ZXMubGVuZ3RoID4gMCkgew0KICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ0VudHJ5IGZvdW5kIGZvciBtaXJyb3JlZCBoYXNoOicsIGVudHJ5Lm1vdmVzLmxlbmd0aCArICcgbW92ZXMnKTsNCiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdPcmlnaW5hbCBtaXJyb3IgbW92ZXM6JywgSlNPTi5zdHJpbmdpZnkoZW50cnkubW92ZXMpKTsNCiAgICAgICAgICAgICAgICBtaXJyb3JlZE1vdmUgPSB0cnVlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdObyBlbnRyeSBmb3VuZCBmb3IgbWlycm9yZWQgaGFzaCcpOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQoNCiAgICAgICAgaWYgKCFlbnRyeSB8fCBlbnRyeS5tb3Zlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBtb3ZlIG5vdCBmb3VuZCBmb3IgY3VycmVudCBwb3NpdGlvbicpOw0KICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgIH0NCg0KICAgICAgICAvLyBTZWxlY3QgbW92ZSBiYXNlZCBvbiB3ZWlnaHRzDQogICAgICAgIGNvbnN0IHNlbGVjdGVkTW92ZSA9IHRoaXMuc2VsZWN0V2VpZ2h0ZWRNb3ZlKGVudHJ5Lm1vdmVzKTsNCiAgICAgICAgY29uc29sZS5sb2coJ09wZW5pbmcgYm9vayBtb3ZlIHNlbGVjdGVkOicsIHNlbGVjdGVkTW92ZSk7DQogICAgICAgIA0KICAgICAgICAvLyBJZiB3ZSB1c2VkIG1pcnJvcmVkIHBvc2l0aW9uLCBtaXJyb3IgdGhlIG1vdmUgYmFjaw0KICAgICAgICBpZiAoc2VsZWN0ZWRNb3ZlICYmIG1pcnJvcmVkTW92ZSkgew0KICAgICAgICAgICAgLy8gY29uc29sZS5sb2coJ1NlbGVjdGVkIG1pcnJvciBtb3ZlIGJlZm9yZSBjb252ZXJzaW9uOicsIEpTT04uc3RyaW5naWZ5KHNlbGVjdGVkTW92ZSkpOw0KICAgICAgICAgICAgY29uc3QgbWlycm9yZWRNb3ZlQ29udmVydGVkID0gdGhpcy5oYXNoZXIubWlycm9yTW92ZShzZWxlY3RlZE1vdmUpOw0KICAgICAgICAgICAgLy8gY29uc29sZS5sb2coJ0NvbnZlcnRlZCBtaXJyb3IgbW92ZTonLCBKU09OLnN0cmluZ2lmeShtaXJyb3JlZE1vdmVDb252ZXJ0ZWQpKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIG1pcnJvcmVkIG1vdmUgaGFzIHZhbGlkIHN0cnVjdHVyZQ0KICAgICAgICAgICAgaWYgKG1pcnJvcmVkTW92ZUNvbnZlcnRlZCAmJiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQuZnJvbSAmJiBtaXJyb3JlZE1vdmVDb252ZXJ0ZWQudG8gJiYNCiAgICAgICAgICAgICAgICB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLmZyb20uciA9PT0gJ251bWJlcicgJiYgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC5mcm9tLmMgPT09ICdudW1iZXInICYmDQogICAgICAgICAgICAgICAgdHlwZW9mIG1pcnJvcmVkTW92ZUNvbnZlcnRlZC50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgbWlycm9yZWRNb3ZlQ29udmVydGVkLnRvLmMgPT09ICdudW1iZXInKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIG1pcnJvcmVkTW92ZUNvbnZlcnRlZDsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ01pcnJvcmVkIG1vdmUgaGFzIGludmFsaWQgc3RydWN0dXJlLCByZXR1cm5pbmcgbnVsbCcpOw0KICAgICAgICAgICAgICAgIHJldHVybiBudWxsOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2UgaWYgKHNlbGVjdGVkTW92ZSkgew0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHNlbGVjdGVkIG1vdmUgaGFzIHZhbGlkIHN0cnVjdHVyZQ0KICAgICAgICAgICAgaWYgKHNlbGVjdGVkTW92ZS5mcm9tICYmIHNlbGVjdGVkTW92ZS50byAmJg0KICAgICAgICAgICAgICAgIHR5cGVvZiBzZWxlY3RlZE1vdmUuZnJvbS5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLmZyb20uYyA9PT0gJ251bWJlcicgJiYNCiAgICAgICAgICAgICAgICB0eXBlb2Ygc2VsZWN0ZWRNb3ZlLnRvLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBzZWxlY3RlZE1vdmUudG8uYyA9PT0gJ251bWJlcicpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gc2VsZWN0ZWRNb3ZlOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU2VsZWN0ZWQgbW92ZSBoYXMgaW52YWxpZCBzdHJ1Y3R1cmUsIHJldHVybmluZyBudWxsJyk7DQogICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgDQogICAgICAgIHJldHVybiBudWxsOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIFNlbGVjdCBhIG1vdmUgcmFuZG9tbHkgYmFzZWQgb24gd2VpZ2h0cw0KICAgICAqIEhpZ2hlciB3ZWlnaHQgPSBtb3JlIGxpa2VseSB0byBiZSBzZWxlY3RlZA0KICAgICAqLw0KICAgIHNlbGVjdFdlaWdodGVkTW92ZShtb3Zlcykgew0KICAgICAgICAvLyBDYWxjdWxhdGUgdG90YWwgd2VpZ2h0DQogICAgICAgIGNvbnN0IHRvdGFsV2VpZ2h0ID0gbW92ZXMucmVkdWNlKChzdW0sIG1vdmUpID0+IHN1bSArIG1vdmUud2VpZ2h0LCAwKTsNCg0KICAgICAgICAvLyBHZW5lcmF0ZSByYW5kb20gbnVtYmVyDQogICAgICAgIGxldCByYW5kb20gPSBNYXRoLnJhbmRvbSgpICogdG90YWxXZWlnaHQ7DQoNCiAgICAgICAgLy8gU2VsZWN0IG1vdmUNCiAgICAgICAgZm9yIChjb25zdCBtb3ZlIG9mIG1vdmVzKSB7DQogICAgICAgICAgICByYW5kb20gLT0gbW92ZS53ZWlnaHQ7DQogICAgICAgICAgICBpZiAocmFuZG9tIDw9IDApIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgICAgICAgICBmcm9tOiB7IHI6IG1vdmUuZnJvbS5yLCBjOiBtb3ZlLmZyb20uYyB9LCB0bzogeyByOiBtb3ZlLnRvLnIsIGM6IG1vdmUudG8uYyB9DQogICAgICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIC8vIEZhbGxiYWNrIChzaG91bGQgbmV2ZXIgcmVhY2ggaGVyZSkNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIGZyb206IHsgcjogbW92ZXNbMF0uZnJvbS5yLCBjOiBtb3Zlc1swXS5mcm9tLmMgfSwgdG86IHsgcjogbW92ZXNbMF0udG8uciwgYzogbW92ZXNbMF0udG8uYyB9DQogICAgICAgIH07DQogICAgfQ0KDQogICAgLyoqDQogICAgICogSGVscGVyIHRvIGNyZWF0ZSBpbml0aWFsIGJvYXJkIChuZWVkZWQgZm9yIGJvb2sgaW5pdGlhbGl6YXRpb24pDQogICAgICovDQogICAgY3JlYXRlSW5pdGlhbEJvYXJkKCkgew0KICAgICAgICBjb25zdCBib2FyZCA9IEFycmF5KDEwKS5maWxsKG51bGwpLm1hcCgoKSA9PiBBcnJheSg5KS5maWxsKG51bGwpKTsNCiAgICAgICAgDQogICAgICAgIC8vIFJlZCBwaWVjZXMgKGJvdHRvbSAtIHI9MC0yKQ0KICAgICAgICBib2FyZFswXVswXSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bMV0gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVsyXSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzNdID0geyB0eXBlOiAnYWR2aXNvcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs0XSA9IHsgdHlwZTogJ2dlbmVyYWwnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bNV0gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzBdWzZdID0geyB0eXBlOiAnZWxlcGhhbnQnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMF1bN10gPSB7IHR5cGU6ICdob3JzZScsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFswXVs4XSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMl1bMV0gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbMl1bN10gPSB7IHR5cGU6ICdjYW5ub24nLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bMF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzJdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KICAgICAgICBib2FyZFszXVs0XSA9IHsgdHlwZTogJ3NvbGRpZXInLCBjb2xvcjogJ3JlZCcgfTsNCiAgICAgICAgYm9hcmRbM11bNl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdyZWQnIH07DQogICAgICAgIGJvYXJkWzNdWzhdID0geyB0eXBlOiAnc29sZGllcicsIGNvbG9yOiAncmVkJyB9Ow0KDQogICAgICAgIC8vIEJsYWNrIHBpZWNlcyAodG9wIC0gcj03LTkpDQogICAgICAgIGJvYXJkWzldWzBdID0geyB0eXBlOiAnY2hhcmlvdCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzFdID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVsyXSA9IHsgdHlwZTogJ2VsZXBoYW50JywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bM10gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bNF0gPSB7IHR5cGU6ICdnZW5lcmFsJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bNV0gPSB7IHR5cGU6ICdhZHZpc29yJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbOV1bNl0gPSB7IHR5cGU6ICdlbGVwaGFudCcsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzldWzddID0geyB0eXBlOiAnaG9yc2UnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs5XVs4XSA9IHsgdHlwZTogJ2NoYXJpb3QnLCBjb2xvcjogJ2JsYWNrJyB9Ow0KICAgICAgICBib2FyZFs3XVsxXSA9IHsgdHlwZTogJ2Nhbm5vbicsIGNvbG9yOiAnYmxhY2snIH07DQogICAgICAgIGJvYXJkWzddWzddID0geyB0eXBlOiAnY2Fubm9uJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bMF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bMl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bNF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bNl0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCiAgICAgICAgYm9hcmRbNl1bOF0gPSB7IHR5cGU6ICdzb2xkaWVyJywgY29sb3I6ICdibGFjaycgfTsNCg0KICAgICAgICByZXR1cm4gYm9hcmQ7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogRW5hYmxlIG9yIGRpc2FibGUgb3BlbmluZyBib29rDQogICAgICovDQogICAgc2V0RW5hYmxlZChlbmFibGVkKSB7DQogICAgICAgIHRoaXMuZW5hYmxlZCA9IGVuYWJsZWQ7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQ2hlY2sgaWYgb3BlbmluZyBib29rIGlzIGVuYWJsZWQNCiAgICAgKi8NCiAgICBpc0VuYWJsZWQoKSB7DQogICAgICAgIHJldHVybiB0aGlzLmVuYWJsZWQ7DQogICAgfQ0KDQogICAgLyoqDQogICAgICogR2V0IHN0YXRpc3RpY3MgYWJvdXQgdGhlIG9wZW5pbmcgYm9vaw0KICAgICAqLw0KICAgIGdldFN0YXRzKCkgew0KICAgICAgICBsZXQgdG90YWxNb3ZlcyA9IDA7DQogICAgICAgIHRoaXMuYm9vay5mb3JFYWNoKGVudHJ5ID0+IHsNCiAgICAgICAgICAgIHRvdGFsTW92ZXMgKz0gZW50cnkubW92ZXMubGVuZ3RoOw0KICAgICAgICB9KTsNCg0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgcG9zaXRpb25zOiB0aGlzLmJvb2suc2l6ZSwNCiAgICAgICAgICAgIHRvdGFsTW92ZXMNCiAgICAgICAgfTsNCiAgICB9DQoNCiAgICAvKioNCiAgICAgKiBBZGQgb3BlbmluZyBsaW5lIGZyb20gdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbg0KICAgICAqIEBwYXJhbSBub3RhdGlvbiBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24gKGUuZy4sIFsn54Ku5LqM5bmz5LqUJywgJ+mprDjov5s3J10pDQogICAgICogQHBhcmFtIHdlaWdodHMgT3B0aW9uYWwgYXJyYXkgb2Ygd2VpZ2h0cyBmb3IgZWFjaCBtb3ZlDQogICAgICovDQogICAgYWRkT3BlbmluZ0xpbmVGcm9tTm90YXRpb24obm90YXRpb24sIHdlaWdodHMpIHsNCiAgICAgICAgLy8gQ29udmVydCB0cmFkaXRpb25hbCBub3RhdGlvbiB0byBjb29yZGluYXRlIGZvcm1hdA0KICAgICAgICBjb25zdCBtb3ZlcyA9IHRoaXMubm90YXRpb25Ub01vdmVzKG5vdGF0aW9uKTsNCiAgICAgICAgLy8gQWRkIHRoZSBtb3ZlcyB0byB0aGUgb3BlbmluZyBib29rDQogICAgICAgIHRoaXMuYWRkT3BlbmluZ0xpbmUobW92ZXMsIHdlaWdodHMpOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIEFkZCBvcGVuaW5nIGxpbmUgZnJvbSBzdHJpbmcgd2l0aCBzcGFjZS1zZXBhcmF0ZWQgdHJhZGl0aW9uYWwgQ2hpbmVzZSBjaGVzcyBub3RhdGlvbg0KICAgICAqIEBwYXJhbSBub3RhdGlvbkFycmF5IEFycmF5IG9mIHN0cmluZ3MsIGVhY2ggY29udGFpbmluZyBzcGFjZS1zZXBhcmF0ZWQgbW92ZXMgKGUuZy4sIFsn54Ku5LqM5bmz5LqUIOmprDjov5s3IOi9puS4gOW5s+S6jCddKQ0KICAgICAqIEBwYXJhbSB3ZWlnaHRzIE9wdGlvbmFsIGFycmF5IG9mIHdlaWdodHMgZm9yIGVhY2ggbW92ZQ0KICAgICAqLw0KICAgIGFkZE9wZW5pbmdMaW5lRnJvbVN0cmluZyhub3RhdGlvbkFycmF5LCB3ZWlnaHRzKSB7DQogICAgICAgIC8vIFByb2Nlc3MgZWFjaCBzdHJpbmcgaW4gdGhlIGFycmF5DQogICAgICAgIGlmICghbm90YXRpb25BcnJheSB8fCAhQXJyYXkuaXNBcnJheShub3RhdGlvbkFycmF5KSB8fCBub3RhdGlvbkFycmF5Lmxlbmd0aCA9PT0gMCkgew0KICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICB9DQogICAgICAgIG5vdGF0aW9uQXJyYXkuZm9yRWFjaChub3RhdGlvblN0cmluZyA9PiB7DQogICAgICAgICAgICAvLyBTcGxpdCB0aGUgc3RyaW5nIGJ5IHNwYWNlcyB0byBnZXQgaW5kaXZpZHVhbCBtb3Zlcw0KICAgICAgICAgICAgY29uc3Qgbm90YXRpb24gPSBub3RhdGlvblN0cmluZy5zcGxpdCgnICcpLmZpbHRlcihtb3ZlID0+IG1vdmUudHJpbSgpICE9PSAnJyk7DQogICAgICAgICAgICAvLyBDYWxsIGV4aXN0aW5nIGZ1bmN0aW9uIHRvIGFkZCB0aGUgbGluZQ0KICAgICAgICAgICAgdGhpcy5hZGRPcGVuaW5nTGluZUZyb21Ob3RhdGlvbihub3RhdGlvbiwgd2VpZ2h0cyk7DQogICAgICAgIH0pOw0KICAgIH0NCg0KICAgIC8qKg0KICAgICAqIENvbnZlcnQgY29vcmRpbmF0ZS1iYXNlZCBtb3ZlcyB0byB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uDQogICAgICogQHBhcmFtIGJvYXJkSGlzdG9yeSBBcnJheSBvZiBib2FyZCBzdGF0ZXMgcmVwcmVzZW50aW5nIHRoZSBnYW1lIGhpc3RvcnkNCiAgICAgKiBAcGFyYW0gbW92ZUhpc3RvcnkgQXJyYXkgb2YgbW92ZXMgaW4gY29vcmRpbmF0ZSBmb3JtYXQNCiAgICAgKiBAcmV0dXJucyBBcnJheSBvZiBtb3ZlIHN0cmluZ3MgaW4gdHJhZGl0aW9uYWwgbm90YXRpb24NCiAgICAgKi8NCiAgICBtb3Zlc1RvTm90YXRpb24oYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSkgew0KICAgICAgICBjb25zdCBub3RhdGlvbiA9IFtdOw0KICAgICAgICBsZXQgY3VycmVudENvbG9yID0gJ3JlZCc7IC8vIFJlZCBtb3ZlcyBmaXJzdA0KDQogICAgICAgIC8vIFR5cGUgdG8gcGllY2UgY2hhcmFjdGVyIG1hcHBpbmcNCiAgICAgICAgY29uc3QgdHlwZVRvUGllY2UgPSB7DQogICAgICAgICAgICAnZ2VuZXJhbCc6IHsgJ3JlZCc6ICfluIUnLCAnYmxhY2snOiAn5bCGJyB9LA0KICAgICAgICAgICAgJ2Fkdmlzb3InOiB7ICdyZWQnOiAn5LuVJywgJ2JsYWNrJzogJ+WjqycgfSwNCiAgICAgICAgICAgICdlbGVwaGFudCc6IHsgJ3JlZCc6ICfnm7gnLCAnYmxhY2snOiAn6LGhJyB9LA0KICAgICAgICAgICAgJ2hvcnNlJzogeyAncmVkJzogJ+mprCcsICdibGFjayc6ICfpqawnIH0sDQogICAgICAgICAgICAnY2hhcmlvdCc6IHsgJ3JlZCc6ICfovaYnLCAnYmxhY2snOiAn6L2mJyB9LA0KICAgICAgICAgICAgJ2Nhbm5vbic6IHsgJ3JlZCc6ICfngq4nLCAnYmxhY2snOiAn54KuJyB9LA0KICAgICAgICAgICAgJ3NvbGRpZXInOiB7ICdyZWQnOiAn5YW1JywgJ2JsYWNrJzogJ+WNkicgfQ0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIENvbHVtbiBtYXBwaW5nIChjb29yZGluYXRlIDAtOCB0byB0cmFkaXRpb25hbCDkuZ0t5LiAIGZvciByZWQsIDktMSBmb3IgYmxhY2spDQogICAgICAgIGNvbnN0IGNvbFRvQ2hpbmVzZSA9IFsn5LmdJywgJ+WFqycsICfkuIMnLCAn5YWtJywgJ+S6lCcsICflm5snLCAn5LiJJywgJ+S6jCcsICfkuIAnXTsNCiAgICAgICAgY29uc3QgY29sVG9BcmFiaWMgPSBbJzknLCAnOCcsICc3JywgJzYnLCAnNScsICc0JywgJzMnLCAnMicsICcxJ107DQoNCiAgICAgICAgLy8gRGlnaXQgdG8gQ2hpbmVzZSBudW1iZXIgbWFwcGluZyBmb3Igc3RlcHMNCiAgICAgICAgY29uc3QgZGlnaXRUb0NoaW5lc2UgPSBbJycsICfkuIAnLCAn5LqMJywgJ+S4iScsICflm5snLCAn5LqUJywgJ+WFrScsICfkuIMnLCAn5YWrJywgJ+S5nSddOw0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiB0aGVyZSBhcmUgbXVsdGlwbGUgc2FtZS10eXBlIHBpZWNlcyBpbiB0aGUgc2FtZSBjb2x1bW4NCiAgICAgICAgY29uc3QgaGFzU2FtZVR5cGVJbkNvbHVtbiA9IChib2FyZCwgcGllY2VUeXBlLCBjb2xvciwgY29sLCBleGNsdWRlUm93KSA9PiB7DQogICAgICAgICAgICBsZXQgY291bnQgPSAwOw0KICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjb2xdOw0KICAgICAgICAgICAgICAgIGlmIChyID09PSBleGNsdWRlUm93KSBjb250aW51ZTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gcGllY2VUeXBlICYmIHBpZWNlLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgICAgICAgICBjb3VudCsrOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIHJldHVybiBjb3VudCA+IDA7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGRldGVybWluZSBmcm9udC9iYWNrIG1hcmtlcg0KICAgICAgICBjb25zdCBnZXRGcm9udEJhY2tNYXJrZXIgPSAoYm9hcmQsIHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgY3VycmVudFJvdykgPT4gew0KICAgICAgICAgICAgY29uc3Qgc2FtZVR5cGVQaWVjZXMgPSBbXTsNCiAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgMTA7IHIrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY29sXTsNCiAgICAgICAgICAgICAgICBpZiAocGllY2UgJiYgcGllY2UudHlwZSA9PT0gcGllY2VUeXBlICYmIHBpZWNlLmNvbG9yID09PSBjb2xvcikgew0KICAgICAgICAgICAgICAgICAgICBzYW1lVHlwZVBpZWNlcy5wdXNoKHIpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGlmIChzYW1lVHlwZVBpZWNlcy5sZW5ndGggPD0gMSkgcmV0dXJuICcnOw0KICAgICAgICAgICAgaWYgKGNvbG9yID09PSAncmVkJykgew0KICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8iHI9Ny0577yJ77yMcuWAvOi2iuWkp+i2iumdoOi/keaVjOaWue+8jOaYryLliY0iDQogICAgICAgICAgICAgICAgY29uc3Qgc29ydGVkUm93cyA9IFsuLi5zYW1lVHlwZVBpZWNlc10uc29ydCgoYSwgYikgPT4gYiAtIGEpOyAvLyBIaWdoZXIgcm93cyBmaXJzdCA9IGNsb3NlciB0byBvcHBvbmVudA0KICAgICAgICAgICAgICAgIHJldHVybiBzb3J0ZWRSb3dzWzBdID09PSBjdXJyZW50Um93ID8gJ+WJjScgOiAn5ZCOJzsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yIcj0wLTLvvInvvIxy5YC86LaK5bCP6LaK6Z2g6L+R5pWM5pa577yM5pivIuWJjSINCiAgICAgICAgICAgICAgICBjb25zdCBzb3J0ZWRSb3dzID0gWy4uLnNhbWVUeXBlUGllY2VzXS5zb3J0KChhLCBiKSA9PiBhIC0gYik7IC8vIExvd2VyIHJvd3MgZmlyc3QgPSBjbG9zZXIgdG8gb3Bwb25lbnQNCiAgICAgICAgICAgICAgICByZXR1cm4gc29ydGVkUm93c1swXSA9PT0gY3VycmVudFJvdyA/ICfliY0nIDogJ+WQjic7DQogICAgICAgICAgICB9DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gUHJvY2VzcyBlYWNoIG1vdmUNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtb3ZlSGlzdG9yeS5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVIaXN0b3J5W2ldOw0KICAgICAgICAgICAgY29uc3QgYm9hcmRCZWZvcmUgPSBib2FyZEhpc3RvcnlbaV07DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IGJvYXJkQmVmb3JlW21vdmUuZnJvbS5yXVttb3ZlLmZyb20uY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghcGllY2UpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdObyBwaWVjZSBmb3VuZCBhdCBmcm9tIHBvc2l0aW9uOicsIG1vdmUuZnJvbSk7DQogICAgICAgICAgICAgICAgY29udGludWU7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlLnR5cGU7DQogICAgICAgICAgICBjb25zdCBwaWVjZUNoYXIgPSB0eXBlVG9QaWVjZVtwaWVjZVR5cGVdW3BpZWNlLmNvbG9yXTsNCiAgICAgICAgICAgIGNvbnN0IGlzUmVkID0gcGllY2UuY29sb3IgPT09ICdyZWQnOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGVyZSBhcmUgbXVsdGlwbGUgc2FtZS10eXBlIHBpZWNlcyBpbiB0aGUgc2FtZSBjb2x1bW4NCiAgICAgICAgICAgIGNvbnN0IGhhc0R1cGxpY2F0ZSA9IGhhc1NhbWVUeXBlSW5Db2x1bW4oYm9hcmRCZWZvcmUsIHBpZWNlVHlwZSwgcGllY2UuY29sb3IsIG1vdmUuZnJvbS5jLCBtb3ZlLmZyb20ucik7DQogICAgICAgICAgICAvLyBHZXQgZnJvbnQvYmFjayBtYXJrZXIgaWYgbmVlZGVkDQogICAgICAgICAgICBjb25zdCBwb3NpdGlvbk1hcmtlciA9IGhhc0R1cGxpY2F0ZSA/IGdldEZyb250QmFja01hcmtlcihib2FyZEJlZm9yZSwgcGllY2VUeXBlLCBwaWVjZS5jb2xvciwgbW92ZS5mcm9tLmMsIG1vdmUuZnJvbS5yKSA6ICcnOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBEZXRlcm1pbmUgbm90YXRpb24gYmFzZWQgb24gcGllY2UgdHlwZSBhbmQgbW92ZSBkaXJlY3Rpb24NCiAgICAgICAgICAgIGxldCBub3RhdGlvblN0cjsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2hvcnNlJyB8fCBwaWVjZVR5cGUgPT09ICdhZHZpc29yJyB8fCBwaWVjZVR5cGUgPT09ICdlbGVwaGFudCcpIHsNCiAgICAgICAgICAgICAgICAvLyBEaWFnb25hbCBtb3ZpbmcgcGllY2VzIC0gb25seSB1c2Ug6L+bL+mAgCwgcmVjb3JkIHRhcmdldCBjb2x1bW4NCiAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQ2hpbmVzZVttb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvQ29sID0gY29sVG9DaGluZXNlW21vdmUudG8uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWue+8muaVjOaWueWcqOmhtumDqO+8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/ov5vvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6YCADQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IG1vdmUudG8uciA+IG1vdmUuZnJvbS5yID8gJ+i/mycgOiAn6YCAJzsNCiAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0FyYWJpY1s4IC0gbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa577ya5pWM5pa55Zyo5bqV6YOo77yIcj0w77yJ77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+i/m++8jOWQkeS4iu+8iHLlop7lpKfvvInmmK/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gbW92ZS50by5yIDwgbW92ZS5mcm9tLnIgPyAn6L+bJyA6ICfpgIAnOw0KICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3RvQ29sfWA7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIGlmIChwaWVjZVR5cGUgPT09ICdnZW5lcmFsJyB8fCBwaWVjZVR5cGUgPT09ICdjaGFyaW90JyB8fCBwaWVjZVR5cGUgPT09ICdjYW5ub24nIHx8IHBpZWNlVHlwZSA9PT0gJ3NvbGRpZXInKSB7DQogICAgICAgICAgICAgICAgLy8gU3RyYWlnaHQgbW92aW5nIHBpZWNlcyAtIOi/my/pgIAv5bmzDQogICAgICAgICAgICAgICAgaWYgKG1vdmUuZnJvbS5jID09PSBtb3ZlLnRvLmMpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gVmVydGljYWwgbW92ZSAtIOi/my/pgIANCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RlcHMgPSBNYXRoLmFicyhtb3ZlLnRvLnIgLSBtb3ZlLmZyb20ucik7DQogICAgICAgICAgICAgICAgICAgIC8vIOi/m+aYr+mdoOi/keaVjOaWueeahOaWueWQke+8jOmAgOaYr+i/nOemu+aVjOaWueeahOaWueWQkQ0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJrmlYzmlrnlnKjpobbpg6jvvIzlkJHkuIrvvIhy5aKe5aSn77yJ5piv6L+b77yM5ZCR5LiL77yIcuWHj+Wwj++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICAvLyDpu5HmlrnvvJrmlYzmlrnlnKjlupXpg6jvvIzlkJHkuIvvvIhy5YeP5bCP77yJ5piv6L+b77yM5ZCR5LiK77yIcuWinuWkp++8ieaYr+mAgA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSAoaXNSZWQgPyBtb3ZlLnRvLnIgPiBtb3ZlLmZyb20uciA6IG1vdmUudG8uciA8IG1vdmUuZnJvbS5yKSA/ICfov5snIDogJ+mAgCc7DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHN0ZXBzIGlzIGEgdmFsaWQgbnVtYmVyIGJldHdlZW4gMS05DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWxpZFN0ZXBzID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oOSwgTWF0aC5yb3VuZChzdGVwcyB8fCAxKSkpOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x9JHtkaXJlY3Rpb259JHtkaWdpdFRvQ2hpbmVzZVt2YWxpZFN0ZXBzXSB8fCAnJ31gOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55LuO5Y+z5b6A5bem5pivMS0577yM6ZyA6KaB5Y+N6L2s5YiX5pig5bCEDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcm9tQ29sID0gY29sVG9BcmFiaWNbOCAtIG1vdmUuZnJvbS5jXTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBzdGVwcyBpcyBhIHZhbGlkIG51bWJlcg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsaWRTdGVwcyA9IE1hdGgucm91bmQoc3RlcHMgfHwgMSk7DQogICAgICAgICAgICAgICAgICAgICAgICBub3RhdGlvblN0ciA9IGAke3Bvc2l0aW9uTWFya2VyfSR7cGllY2VDaGFyfSR7ZnJvbUNvbH0ke2RpcmVjdGlvbn0ke3ZhbGlkU3RlcHN9YDsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgbW92ZSAtIOW5sw0KICAgICAgICAgICAgICAgICAgICBpZiAoaXNSZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZyb21Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS5mcm9tLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9Db2wgPSBjb2xUb0NoaW5lc2VbbW92ZS50by5jXSB8fCAnJzsNCiAgICAgICAgICAgICAgICAgICAgICAgIG5vdGF0aW9uU3RyID0gYCR7cG9zaXRpb25NYXJrZXJ9JHtwaWVjZUNoYXJ9JHtmcm9tQ29sfeW5syR7dG9Db2x9YDsNCiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueS7juWPs+W+gOW3puaYrzEtOe+8jOmcgOimgeWPjei9rOWIl+aYoOWwhA0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJvbUNvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLmZyb20uY10gfHwgJyc7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0b0NvbCA9IGNvbFRvQXJhYmljWzggLSBtb3ZlLnRvLmNdIHx8ICcnOw0KICAgICAgICAgICAgICAgICAgICAgICAgbm90YXRpb25TdHIgPSBgJHtwb3NpdGlvbk1hcmtlcn0ke3BpZWNlQ2hhcn0ke2Zyb21Db2x95bmzJHt0b0NvbH1gOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdVbmtub3duIHBpZWNlIHR5cGU6JywgcGllY2VUeXBlKTsNCiAgICAgICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgbm90YXRpb24ucHVzaChub3RhdGlvblN0cik7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFN3aXRjaCBjb2xvciBmb3IgbmV4dCBtb3ZlDQogICAgICAgICAgICBjdXJyZW50Q29sb3IgPSBjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICByZXR1cm4gbm90YXRpb247DQogICAgfQ0KDQogICAgLyoqDQogICAgICogQ29udmVydCB0cmFkaXRpb25hbCBDaGluZXNlIGNoZXNzIG5vdGF0aW9uIHRvIGNvb3JkaW5hdGUgbW92ZXMNCiAgICAgKiBAcGFyYW0gbm90YXRpb24gQXJyYXkgb2YgbW92ZSBzdHJpbmdzIGluIHRyYWRpdGlvbmFsIG5vdGF0aW9uDQogICAgICogQHJldHVybnMgQXJyYXkgb2YgbW92ZXMgaW4gY29vcmRpbmF0ZSBmb3JtYXQNCiAgICAgKi8NCiAgICBub3RhdGlvblRvTW92ZXMobm90YXRpb24sIGluaXRpYWxCb2FyZCA9IG51bGwpIHsNCiAgICAgICAgLy8g56Gu5L+dbm90YXRpb27mmK/mlbDnu4TkuJTkuI3kuLrnqboNCiAgICAgICAgaWYgKCFub3RhdGlvbiB8fCAhQXJyYXkuaXNBcnJheShub3RhdGlvbikgfHwgbm90YXRpb24ubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICByZXR1cm4gW107DQogICAgICAgIH0NCiAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgbGV0IGN1cnJlbnRDb2xvciA9ICdyZWQnOyAvLyBSZWQgbW92ZXMgZmlyc3QNCg0KICAgICAgICAvLyBQaWVjZSBjaGFyYWN0ZXIgdG8gdHlwZSBtYXBwaW5nDQogICAgICAgIGNvbnN0IHBpZWNlTWFwID0gew0KICAgICAgICAgICAgJ+Wwhic6ICdnZW5lcmFsJywgJ+W4hSc6ICdnZW5lcmFsJywNCiAgICAgICAgICAgICflo6snOiAnYWR2aXNvcicsICfku5UnOiAnYWR2aXNvcicsDQogICAgICAgICAgICAn6LGhJzogJ2VsZXBoYW50JywgJ+ebuCc6ICdlbGVwaGFudCcsDQogICAgICAgICAgICAn6amsJzogJ2hvcnNlJywNCiAgICAgICAgICAgICfovaYnOiAnY2hhcmlvdCcsDQogICAgICAgICAgICAn54KuJzogJ2Nhbm5vbicsDQogICAgICAgICAgICAn5Y2SJzogJ3NvbGRpZXInLCAn5YW1JzogJ3NvbGRpZXInDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ29sdW1uIG1hcHBpbmcgKHRyYWRpdGlvbmFsIG5vdGF0aW9uIHVzZXMgMS05IGZyb20gcmlnaHQgdG8gbGVmdCkNCiAgICAgICAgY29uc3QgY29sTWFwID0gew0KICAgICAgICAgICAgJ+S4gCc6IDgsICcxJzogOCwNCiAgICAgICAgICAgICfkuownOiA3LCAnMic6IDcsDQogICAgICAgICAgICAn5LiJJzogNiwgJzMnOiA2LA0KICAgICAgICAgICAgJ+Wbmyc6IDUsICc0JzogNSwNCiAgICAgICAgICAgICfkupQnOiA0LCAnNSc6IDQsDQogICAgICAgICAgICAn5YWtJzogMywgJzYnOiAzLA0KICAgICAgICAgICAgJ+S4gyc6IDIsICc3JzogMiwNCiAgICAgICAgICAgICflhasnOiAxLCAnOCc6IDEsDQogICAgICAgICAgICAn5LmdJzogMCwgJzknOiAwDQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ2hpbmVzZSBudW1iZXIgdG8gZGlnaXQgbWFwcGluZw0KICAgICAgICBjb25zdCBjaGluZXNlTnVtYmVyTWFwID0gew0KICAgICAgICAgICAgJ+S4gCc6IDEsICcxJzogMSwNCiAgICAgICAgICAgICfkuownOiAyLCAnMic6IDIsDQogICAgICAgICAgICAn5LiJJzogMywgJzMnOiAzLA0KICAgICAgICAgICAgJ+Wbmyc6IDQsICc0JzogNCwNCiAgICAgICAgICAgICfkupQnOiA1LCAnNSc6IDUsDQogICAgICAgICAgICAn5YWtJzogNiwgJzYnOiA2LA0KICAgICAgICAgICAgJ+S4gyc6IDcsICc3JzogNywNCiAgICAgICAgICAgICflhasnOiA4LCAnOCc6IDgsDQogICAgICAgICAgICAn5LmdJzogOSwgJzknOiA5DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSW5pdGlhbCBwb3NpdGlvbnMgb2YgcGllY2VzIChyZWQgYW5kIGJsYWNrKQ0KICAgICAgICAvLyDkv67lpI3vvJrkuI7mlrDlnZDmoIfns7vnu5/kv53mjIHkuIDoh7TvvIznuqLmlrnlnKjlupXpg6jvvIhyPTAtMu+8ie+8jOm7keaWueWcqOmhtumDqO+8iHI9Ny0577yJDQogICAgICAgIGNvbnN0IGRlZmF1bHRJbml0aWFsUG9zaXRpb25zID0gew0KICAgICAgICAgICAgJ3JlZC1nZW5lcmFsJzogeyByOiAwLCBjOiA0IH0sDQogICAgICAgICAgICAncmVkLWFkdmlzb3InOiBbeyByOiAwLCBjOiAzIH0sIHsgcjogMCwgYzogNSB9XSwNCiAgICAgICAgICAgICdyZWQtZWxlcGhhbnQnOiBbeyByOiAwLCBjOiAyIH0sIHsgcjogMCwgYzogNiB9XSwNCiAgICAgICAgICAgICdyZWQtaG9yc2UnOiBbeyByOiAwLCBjOiAxIH0sIHsgcjogMCwgYzogNyB9XSwNCiAgICAgICAgICAgICdyZWQtY2hhcmlvdCc6IFt7IHI6IDAsIGM6IDAgfSwgeyByOiAwLCBjOiA4IH1dLA0KICAgICAgICAgICAgJ3JlZC1jYW5ub24nOiBbeyByOiAyLCBjOiAxIH0sIHsgcjogMiwgYzogNyB9XSwNCiAgICAgICAgICAgICdyZWQtc29sZGllcic6IFt7IHI6IDMsIGM6IDAgfSwgeyByOiAzLCBjOiAyIH0sIHsgcjogMywgYzogNCB9LCB7IHI6IDMsIGM6IDYgfSwgeyByOiAzLCBjOiA4IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWdlbmVyYWwnOiB7IHI6IDksIGM6IDQgfSwNCiAgICAgICAgICAgICdibGFjay1hZHZpc29yJzogW3sgcjogOSwgYzogMyB9LCB7IHI6IDksIGM6IDUgfV0sDQogICAgICAgICAgICAnYmxhY2stZWxlcGhhbnQnOiBbeyByOiA5LCBjOiAyIH0sIHsgcjogOSwgYzogNiB9XSwNCiAgICAgICAgICAgICdibGFjay1ob3JzZSc6IFt7IHI6IDksIGM6IDEgfSwgeyByOiA5LCBjOiA3IH1dLA0KICAgICAgICAgICAgJ2JsYWNrLWNoYXJpb3QnOiBbeyByOiA5LCBjOiAwIH0sIHsgcjogOSwgYzogOCB9XSwNCiAgICAgICAgICAgICdibGFjay1jYW5ub24nOiBbeyByOiA3LCBjOiAxIH0sIHsgcjogNywgYzogNyB9XSwNCiAgICAgICAgICAgICdibGFjay1zb2xkaWVyJzogW3sgcjogNiwgYzogMCB9LCB7IHI6IDYsIGM6IDIgfSwgeyByOiA2LCBjOiA0IH0sIHsgcjogNiwgYzogNiB9LCB7IHI6IDYsIGM6IDggfV0NCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBUcmFjayBwaWVjZSBwb3NpdGlvbnMgYXMgbW92ZXMgYXJlIG1hZGUNCiAgICAgICAgbGV0IHBpZWNlUG9zaXRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShkZWZhdWx0SW5pdGlhbFBvc2l0aW9ucykpOw0KICAgICAgICANCiAgICAgICAgLy8gSWYgaW5pdGlhbCBib2FyZCBpcyBwcm92aWRlZCwgaW5pdGlhbGl6ZSBwaWVjZSBwb3NpdGlvbnMgZnJvbSBpdA0KICAgICAgICBpZiAoaW5pdGlhbEJvYXJkKSB7DQogICAgICAgICAgICAvLyBSZXNldCBwaWVjZSBwb3NpdGlvbnMgYmFzZWQgb24gaW5pdGlhbCBib2FyZA0KICAgICAgICAgICAgcGllY2VQb3NpdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgJ3JlZC1nZW5lcmFsJzogeyByOiAtMSwgYzogLTEgfSwNCiAgICAgICAgICAgICAgICAncmVkLWFkdmlzb3InOiBbXSwNCiAgICAgICAgICAgICAgICAncmVkLWVsZXBoYW50JzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1ob3JzZSc6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtY2hhcmlvdCc6IFtdLA0KICAgICAgICAgICAgICAgICdyZWQtY2Fubm9uJzogW10sDQogICAgICAgICAgICAgICAgJ3JlZC1zb2xkaWVyJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWdlbmVyYWwnOiB7IHI6IC0xLCBjOiAtMSB9LA0KICAgICAgICAgICAgICAgICdibGFjay1hZHZpc29yJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWVsZXBoYW50JzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWhvcnNlJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLWNoYXJpb3QnOiBbXSwNCiAgICAgICAgICAgICAgICAnYmxhY2stY2Fubm9uJzogW10sDQogICAgICAgICAgICAgICAgJ2JsYWNrLXNvbGRpZXInOiBbXQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gUG9wdWxhdGUgcGllY2UgcG9zaXRpb25zIGZyb20gaW5pdGlhbCBib2FyZA0KICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCAxMDsgcisrKSB7DQogICAgICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA5OyBjKyspIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSBpbml0aWFsQm9hcmRbcl1bY107DQogICAgICAgICAgICAgICAgICAgIGlmIChwaWVjZSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5ID0gYCR7cGllY2UuY29sb3J9LSR7cGllY2UudHlwZX1gOw0KICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpZWNlLnR5cGUgPT09ICdnZW5lcmFsJykgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZWNlUG9zaXRpb25zW2tleV0gPSB7IHIsIGMgfTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgcGllY2VQb3NpdGlvbnNba2V5XS5wdXNoKHsgciwgYyB9KTsNCiAgICAgICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBmaW5kIHBpZWNlIHBvc2l0aW9uDQogICAgICAgIGNvbnN0IGZpbmRQaWVjZVBvc2l0aW9uID0gKHBpZWNlVHlwZSwgY29sb3IsIGNvbCwgZGlyZWN0aW9uLCBmcm9udEJhY2tNYXJrZXIgPSBudWxsKSA9PiB7DQogICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtjb2xvcn0tJHtwaWVjZVR5cGV9YDsNCiAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2tleV07DQoNCiAgICAgICAgICAgIC8vIENoZWNrIGlmIHBvc2l0aW9ucyBleGlzdCBhbmQgYXJlIHZhbGlkDQogICAgICAgICAgICBpZiAoIXBvc2l0aW9ucykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ05vIHBvc2l0aW9ucyBmb3VuZCBmb3IgcGllY2U6Jywga2V5KTsNCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKHBpZWNlVHlwZSA9PT0gJ2dlbmVyYWwnKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHBvc2l0aW9uczsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gRmluZCBwaWVjZXMgb24gdGhlIHNwZWNpZmllZCBjb2x1bW4NCiAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBwb3NpdGlvbnMuZmlsdGVyKHBvcyA9PiBwb3MuYyA9PT0gY29sKTsNCg0KICAgICAgICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID09PSAwKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignTm8gY2FuZGlkYXRlcyBmb3VuZCBmb3IgcGllY2U6Jywga2V5LCAnb24gY29sdW1uOicsIGNvbCk7DQogICAgICAgICAgICAgICAgLy8gQWRkaXRpb25hbCBkZWJ1ZyBpbmZvIGZvciBjYW5ub24NCiAgICAgICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnY2Fubm9uJyAmJiBjb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnREVCVUc6IENhbmRpZGF0ZXMgYWZ0ZXIgZmlsdGVyOicsIGNhbmRpZGF0ZXMpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID09PSAxKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZXNbMF07DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIElmIGZyb250L2JhY2sgbWFya2VyIGlzIHByb3ZpZGVkLCB1c2UgaXQgdG8gZGV0ZXJtaW5lIHRoZSBwaWVjZQ0KICAgICAgICAgICAgaWYgKGZyb250QmFja01hcmtlciA9PT0gJ+WJjScpIHsNCiAgICAgICAgICAgICAgICAvLyDliY3ngq7vvJrpnaDov5HmlYzmlrnnmoTmo4vlrZANCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJpy5YC86L6D5aSn55qE5pu06Z2g6L+R5pWM5pa577yI5YmN77yJDQogICAgICAgICAgICAgICAgLy8g6buR5pa577yacuWAvOi+g+Wwj+eahOabtOmdoOi/keaVjOaWue+8iOWJje+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA+IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9IGVsc2UgaWYgKGZyb250QmFja01hcmtlciA9PT0gJ+WQjicpIHsNCiAgICAgICAgICAgICAgICAvLyDlkI7ngq7vvJrpnaDov5Hlt7HmlrnnmoTmo4vlrZANCiAgICAgICAgICAgICAgICAvLyDnuqLmlrnvvJpy5YC86L6D5bCP55qE5pu06Z2g6L+R5bex5pa577yI5ZCO77yJDQogICAgICAgICAgICAgICAgLy8g6buR5pa577yacuWAvOi+g+Wkp+eahOabtOmdoOi/keW3seaWue+8iOWQju+8iQ0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyANCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKSA6DQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPiBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSk7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIC8vIElmIG11bHRpcGxlIHBpZWNlcyBvbiB0aGUgc2FtZSBjb2x1bW4gYW5kIG5vIG1hcmtlciwgZGV0ZXJtaW5lIGJhc2VkIG9uIGRpcmVjdGlvbg0KICAgICAgICAgICAgLy8g5a+55LqO5ZCM5LiA5YiX55qE5qOL5a2Q77yM6YCa6L+H5q+U6L6DcuWAvOadpeWMuuWIhg0KICAgICAgICAgICAgaWYgKGRpcmVjdGlvbiA9PT0gJ+i/mycpIHsNCiAgICAgICAgICAgICAgICAvLyDov5vmmK/lkJHmlYzmlrnmlrnlkJHnp7vliqjvvIzmiYDku6XpgInmi6nmm7TpnaDov5Hlt7HmlrnnmoTmo4vlrZDvvIjlkI7vvIkNCiAgICAgICAgICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gDQogICAgICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LnIgPCBjdXJyLnIgPyBwcmV2IDogY3VyciwgY2FuZGlkYXRlc1swXSkgOg0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pOw0KICAgICAgICAgICAgfSBlbHNlIGlmIChkaXJlY3Rpb24gPT09ICfpgIAnKSB7DQogICAgICAgICAgICAgICAgLy8g6YCA5piv5ZCR5bex5pa55pa55ZCR56e75Yqo77yM5omA5Lul6YCJ5oup5pu06Z2g6L+R5pWM5pa555qE5qOL5a2Q77yI5YmN77yJDQogICAgICAgICAgICAgICAgcmV0dXJuIGNvbG9yID09PSAncmVkJyA/IA0KICAgICAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5yID4gY3Vyci5yID8gcHJldiA6IGN1cnIsIGNhbmRpZGF0ZXNbMF0pIDoNCiAgICAgICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuciA8IGN1cnIuciA/IHByZXYgOiBjdXJyLCBjYW5kaWRhdGVzWzBdKTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZXNbMF07IC8vIERlZmF1bHQgdG8gZmlyc3QgaWYgZGlyZWN0aW9uIGlzICflubMnIGFuZCBubyBtYXJrZXINCiAgICAgICAgfTsNCg0KICAgICAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gdXBkYXRlIHBpZWNlIHBvc2l0aW9uDQogICAgICAgIGNvbnN0IHVwZGF0ZVBpZWNlUG9zaXRpb24gPSAocGllY2VUeXBlLCBjb2xvciwgb2xkUG9zLCBuZXdQb3MpID0+IHsNCiAgICAgICAgICAgIGNvbnN0IGtleSA9IGAke2NvbG9yfS0ke3BpZWNlVHlwZX1gOw0KICAgICAgICAgICAgY29uc3QgcG9zaXRpb25zID0gcGllY2VQb3NpdGlvbnNba2V5XTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcG9zaXRpb25zIGV4aXN0IGFuZCBhcmUgdmFsaWQNCiAgICAgICAgICAgIGlmICghcG9zaXRpb25zKSB7DQogICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBObyBwb3NpdGlvbnMgZm91bmQgZm9yIHBpZWNlOicsIGtleSk7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBpZiAocGllY2VUeXBlID09PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICBwb3NpdGlvbnMuciA9IG5ld1Bvcy5yOw0KICAgICAgICAgICAgICAgIHBvc2l0aW9ucy5jID0gbmV3UG9zLmM7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICBjb25zdCBpbmRleCA9IHBvc2l0aW9ucy5maW5kSW5kZXgocG9zID0+IHBvcy5yID09PSBvbGRQb3MuciAmJiBwb3MuYyA9PT0gb2xkUG9zLmMpOw0KICAgICAgICAgICAgaWYgKGluZGV4ICE9PSAtMSkgew0KICAgICAgICAgICAgICAgIHBvc2l0aW9uc1tpbmRleF0uciA9IG5ld1Bvcy5yOw0KICAgICAgICAgICAgICAgIHBvc2l0aW9uc1tpbmRleF0uYyA9IG5ld1Bvcy5jOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IENvdWxkIG5vdCBmaW5kIHBpZWNlIHBvc2l0aW9uIHRvIHVwZGF0ZTonLCBvbGRQb3MsICdpbicsIHBvc2l0aW9ucyk7DQogICAgICAgICAgICB9DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIHBvc2l0aW9uIGlzIHZhbGlkDQogICAgICAgIGNvbnN0IGlzVmFsaWRQb3MgPSAociwgYykgPT4gciA+PSAwICYmIHIgPCAxMCAmJiBjID49IDAgJiYgYyA8IDk7DQoNCiAgICAgICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBob3JzZSBtb3Zlcw0KICAgICAgICBjb25zdCBnZXRIb3JzZU1vdmVzID0gKHBvcykgPT4gew0KICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyBkcjogLTIsIGRjOiAtMSB9LCB7IGRyOiAtMiwgZGM6IDEgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAtMSwgZGM6IC0yIH0sIHsgZHI6IC0xLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDEsIGRjOiAtMiB9LCB7IGRyOiAxLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDIsIGRjOiAtMSB9LCB7IGRyOiAyLCBkYzogMSB9DQogICAgICAgICAgICBdOw0KDQogICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgaG9yc2UgY2FuIG1vdmUgaW4gdGhlIGRpcmVjdGlvbg0KICAgICAgICAgICAgY29uc3QgY2FuTW92ZSA9IChibG9ja2VkUiwgYmxvY2tlZEMpID0+IHsNCiAgICAgICAgICAgICAgICBpZiAoIWlzVmFsaWRQb3MociArIGJsb2NrZWRSLCBjICsgYmxvY2tlZEMpKSByZXR1cm4gZmFsc2U7DQogICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICB9Ow0KDQogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0sIGluZGV4KSA9PiB7DQogICAgICAgICAgICAgICAgY29uc3QgYmxvY2tlZFIgPSBkciA+IDAgPyAxIDogZHIgPCAwID8gLTEgOiAwOw0KICAgICAgICAgICAgICAgIGNvbnN0IGJsb2NrZWRDID0gZGMgPiAwID8gMSA6IGRjIDwgMCA/IC0xIDogMDsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgcGF0aCBpcyBibG9ja2VkDQogICAgICAgICAgICAgICAgaWYgKChpbmRleCA8IDIgfHwgaW5kZXggPj0gNikgJiYgYmxvY2tlZFIgIT09IDApIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gVmVydGljYWwgYmxvY2tlZA0KICAgICAgICAgICAgICAgICAgICBpZiAoIWNhbk1vdmUoYmxvY2tlZFIsIDApKSByZXR1cm47DQogICAgICAgICAgICAgICAgfSBlbHNlIGlmIChibG9ja2VkQyAhPT0gMCkgew0KICAgICAgICAgICAgICAgICAgICAvLyBIb3Jpem9udGFsIGJsb2NrZWQNCiAgICAgICAgICAgICAgICAgICAgaWYgKCFjYW5Nb3ZlKDAsIGJsb2NrZWRDKSkgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSkgew0KICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCg0KICAgICAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgZWxlcGhhbnQgbW92ZXMNCiAgICAgICAgY29uc3QgZ2V0RWxlcGhhbnRNb3ZlcyA9IChwb3MsIGNvbG9yKSA9PiB7DQogICAgICAgICAgICBpZiAoIXBvcykgcmV0dXJuIFtdOw0KICAgICAgICAgICAgY29uc3QgbW92ZXMgPSBbXTsNCiAgICAgICAgICAgIGNvbnN0IHsgciwgYyB9ID0gcG9zOw0KICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IFsNCiAgICAgICAgICAgICAgICB7IGRyOiAtMiwgZGM6IC0yIH0sIHsgZHI6IC0yLCBkYzogMiB9LA0KICAgICAgICAgICAgICAgIHsgZHI6IDIsIGRjOiAtMiB9LCB7IGRyOiAyLCBkYzogMiB9DQogICAgICAgICAgICBdOw0KDQogICAgICAgICAgICAvLyBFbGVwaGFudCdzIHRlcnJpdG9yeSAtIHJlZCBlbGVwaGFudHMgY2FuIG9ubHkgYmUgaW4gcjw9NCwgYmxhY2sgZWxlcGhhbnRzIGluIHI+PTUNCiAgICAgICAgICAgIGNvbnN0IGlzSW5UZXJyaXRvcnkgPSAocikgPT4gew0KICAgICAgICAgICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyByIDw9IDQgOiByID49IDU7DQogICAgICAgICAgICB9Ow0KDQogICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goKHsgZHIsIGRjIH0pID0+IHsNCiAgICAgICAgICAgICAgICBjb25zdCBtaWRSID0gciArIGRyIC8gMjsNCiAgICAgICAgICAgICAgICBjb25zdCBtaWRDID0gYyArIGRjIC8gMjsNCiAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gciArIGRyOw0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld0MgPSBjICsgZGM7DQoNCiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBtaWQgcG9zaXRpb24gaXMgZW1wdHkgYW5kIG5ldyBwb3NpdGlvbiBpcyB2YWxpZA0KICAgICAgICAgICAgICAgIGlmIChpc1ZhbGlkUG9zKG1pZFIsIG1pZEMpICYmIGlzVmFsaWRQb3MobmV3UiwgbmV3QykgJiYgaXNJblRlcnJpdG9yeShuZXdSKSkgew0KICAgICAgICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbmV3UiwgYzogbmV3QyB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9KTsNCg0KICAgICAgICAgICAgcmV0dXJuIG1vdmVzOw0KICAgICAgICB9Ow0KDQogICAgICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgYWR2aXNvciBtb3Zlcw0KICAgICAgICBjb25zdCBnZXRBZHZpc29yTW92ZXMgPSAocG9zLCBjb2xvcikgPT4gew0KICAgICAgICAgICAgaWYgKCFwb3MpIHJldHVybiBbXTsNCiAgICAgICAgICAgIGNvbnN0IG1vdmVzID0gW107DQogICAgICAgICAgICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbnMgPSBbDQogICAgICAgICAgICAgICAgeyBkcjogLTEsIGRjOiAtMSB9LCB7IGRyOiAtMSwgZGM6IDEgfSwNCiAgICAgICAgICAgICAgICB7IGRyOiAxLCBkYzogLTEgfSwgeyBkcjogMSwgZGM6IDEgfQ0KICAgICAgICAgICAgXTsNCg0KICAgICAgICAgICAgLy8gQWR2aXNvcidzIHRlcnJpdG9yeSAocGFsYWNlKSAtIHJlZCBhZHZpc29ycyBpbiByPTAtMixjPTMtNSwgYmxhY2sgYWR2aXNvcnMgaW4gcj03LTksYz0zLTUNCiAgICAgICAgICAgIGNvbnN0IGlzSW5QYWxhY2UgPSAociwgYykgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IHJSYW5nZSA9IGNvbG9yID09PSAncmVkJyA/IFswLCAyXSA6IFs3LCA5XTsNCiAgICAgICAgICAgICAgICByZXR1cm4gciA+PSByUmFuZ2VbMF0gJiYgciA8PSByUmFuZ2VbMV0gJiYgYyA+PSAzICYmIGMgPD0gNTsNCiAgICAgICAgICAgIH07DQoNCiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaCgoeyBkciwgZGMgfSkgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IG5ld1IgPSByICsgZHI7DQogICAgICAgICAgICAgICAgY29uc3QgbmV3QyA9IGMgKyBkYzsNCiAgICAgICAgICAgICAgICBpZiAoaXNWYWxpZFBvcyhuZXdSLCBuZXdDKSAmJiBpc0luUGFsYWNlKG5ld1IsIG5ld0MpKSB7DQogICAgICAgICAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuZXdSLCBjOiBuZXdDIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0pOw0KDQogICAgICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgICAgIH07DQoNCiAgICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGJvYXJkIHRvIHRyYWNrIG1vdmVzDQogICAgICAgIGxldCB0ZW1wQm9hcmQgPSB0aGlzLmNyZWF0ZUluaXRpYWxCb2FyZCgpOw0KICAgICAgICANCiAgICAgICAgLy8gRW5zdXJlIHRlbXBCb2FyZCBpcyBwcm9wZXJseSBpbml0aWFsaXplZA0KICAgICAgICBpZiAoIXRlbXBCb2FyZCB8fCB0ZW1wQm9hcmQubGVuZ3RoICE9PSAxMCkgew0KICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBib2FyZCBpbml0aWFsaXphdGlvbicpOw0KICAgICAgICAgICAgcmV0dXJuIFtdOw0KICAgICAgICB9DQogICAgICAgIA0KICAgICAgICAvLyBWZXJpZnkgYWxsIHJvd3MgaGF2ZSA5IGNvbHVtbnMNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDsgaSsrKSB7DQogICAgICAgICAgICBpZiAoIXRlbXBCb2FyZFtpXSB8fCB0ZW1wQm9hcmRbaV0ubGVuZ3RoICE9PSA5KSB7DQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2ldID0gQXJyYXkoOSkuZmlsbChudWxsKTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KDQogICAgICAgIGNvbnNvbGUubG9nKCdUb3RhbCBtb3ZlczonLCBub3RhdGlvbi5sZW5ndGgpOw0KICAgICAgICBub3RhdGlvbi5mb3JFYWNoKG1vdmVOb3RhdGlvbiA9PiB7DQoNCg0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBQYXJzZSB0aGUgbW92ZSBub3RhdGlvbiAtIGtlZXAgbGFzdCBncm91cCBvcHRpb25hbA0KICAgICAgICAgICAgY29uc3QgcmVnZXggPSAvKFvliY3lkI5dKT8oW+WwhuW4heWjq+S7leixoeebuOmprOi9pueCruWFteWNkl0pKFvkuIDkuozkuInlm5vkupTlha3kuIPlhavkuZ0xMjM0NTY3ODldKShb6L+b6YCA5bmzXSkoW+S4gOS6jOS4ieWbm+S6lOWFreS4g+WFq+S5nTEyMzQ1Njc4OV0pPy87DQogICAgICAgICAgICBjb25zdCBtYXRjaCA9IG1vdmVOb3RhdGlvbi5tYXRjaChyZWdleCk7DQoNCiAgICAgICAgICAgIGlmICghbWF0Y2gpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIG1vdmUgbm90YXRpb246JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IFssIGZyb250QmFja01hcmtlciwgcGllY2VDaGFyLCBmcm9tQ29sTm90YXRpb24sIGRpcmVjdGlvbiwgdG9Db2xPclN0ZXBOb3RhdGlvbl0gPSBtYXRjaDsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlVHlwZSA9IHBpZWNlTWFwW3BpZWNlQ2hhcl07DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIEdldCBjb2x1bW4gbWFwcGluZyBiYXNlZCBvbiBjdXJyZW50IGNvbG9yIChibGFjayBzZWVzIGNvbHVtbnMgbWlycm9yZWQpDQogICAgICAgICAgICBsZXQgZnJvbUNvbCA9IGNvbE1hcFtmcm9tQ29sTm90YXRpb25dOw0KICAgICAgICAgICAgaWYgKGN1cnJlbnRDb2xvciA9PT0gJ2JsYWNrJykgew0KICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjayAoZnJvbSBibGFjaydzIHBlcnNwZWN0aXZlKQ0KICAgICAgICAgICAgICAgIGZyb21Db2wgPSA4IC0gZnJvbUNvbDsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gRmluZCB0aGUgY3VycmVudCBwb3NpdGlvbiBvZiB0aGUgcGllY2UNCiAgICAgICAgICAgIGNvbnN0IGZyb21Qb3MgPSBmaW5kUGllY2VQb3NpdGlvbihwaWVjZVR5cGUsIGN1cnJlbnRDb2xvciwgZnJvbUNvbCwgZGlyZWN0aW9uLCBmcm9udEJhY2tNYXJrZXIpOw0KDQogICAgICAgICAgICBpZiAoIWZyb21Qb3MpIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZmluZCBwaWVjZSBwb3NpdGlvbiBmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgbGV0IHRvUG9zOw0KDQogICAgICAgICAgICBpZiAoZGlyZWN0aW9uID09PSAn5bmzJykgew0KICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgbW92ZW1lbnQNCiAgICAgICAgICAgICAgICBsZXQgdG9Db2wgPSBjb2xNYXBbdG9Db2xPclN0ZXBOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgaWYgKHRvQ29sID09PSB1bmRlZmluZWQpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uOicsIHRvQ29sT3JTdGVwTm90YXRpb24sICdmb3IgbW92ZTonLCBtb3ZlTm90YXRpb24pOw0KICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjayB3aGVuIG1vdmluZyBob3Jpem9udGFsbHkNCiAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgIHRvQ29sID0gOCAtIHRvQ29sOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICB0b1BvcyA9IHsgcjogZnJvbVBvcy5yLCBjOiB0b0NvbCB9Ow0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAvLyBWZXJ0aWNhbCBvciBkaWFnb25hbCBtb3ZlbWVudA0KICAgICAgICAgICAgICAgIGNvbnN0IHN0ZXBzID0gY2hpbmVzZU51bWJlck1hcFt0b0NvbE9yU3RlcE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChzdGVwcyA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgc3RlcCBjb3VudDonLCB0b0NvbE9yU3RlcE5vdGF0aW9uLCAnZm9yIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgICAgIGlmIChwaWVjZVR5cGUgPT09ICdob3JzZScpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gSG9yc2UgbW92ZXMgaW4gTC1zaGFwZQ0KICAgICAgICAgICAgICAgICAgICBjb25zdCBwb3NzaWJsZU1vdmVzID0gZ2V0SG9yc2VNb3Zlcyhmcm9tUG9zKTsNCiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvbE5vdGF0aW9uID0gdG9Db2xPclN0ZXBOb3RhdGlvbjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uIGZvciBob3JzZTonLCB0YXJnZXRDb2xOb3RhdGlvbiwgJ2luIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrDQogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldENvbCA9IDggLSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIG1vdmUgdGhhdCBtYXRjaGVzIGJvdGggZGlyZWN0aW9uIGFuZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZGlyZWN0aW9uIChyb3cpDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbk1hdGNoID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yID4gZnJvbVBvcy5yIDogbW92ZS5yIDwgZnJvbVBvcy5yKSA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgY29sdW1uDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2x1bW5NYXRjaCA9IG1vdmUuYyA9PT0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOw0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2VsZXBoYW50Jykgew0KICAgICAgICAgICAgICAgICAgICAvLyBFbGVwaGFudCBtb3ZlcyBkaWFnb25hbGx5IDIgc3RlcHMNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEVsZXBoYW50TW92ZXMoZnJvbVBvcywgY3VycmVudENvbG9yKTsNCiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgdGFyZ2V0IGNvbHVtbiBmcm9tIG5vdGF0aW9uDQogICAgICAgICAgICAgICAgICAgIGNvbnN0IHRhcmdldENvbE5vdGF0aW9uID0gdG9Db2xPclN0ZXBOb3RhdGlvbjsNCiAgICAgICAgICAgICAgICAgICAgbGV0IHRhcmdldENvbCA9IGNvbE1hcFt0YXJnZXRDb2xOb3RhdGlvbl07DQogICAgICAgICAgICAgICAgICAgIGlmICh0YXJnZXRDb2wgPT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCB0YXJnZXQgY29sdW1uIG5vdGF0aW9uIGZvciBlbGVwaGFudDonLCB0YXJnZXRDb2xOb3RhdGlvbiwgJ2luIG1vdmU6JywgbW92ZU5vdGF0aW9uKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgLy8gTWlycm9yIHRoZSBjb2x1bW4gZm9yIGJsYWNrDQogICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50Q29sb3IgPT09ICdibGFjaycpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldENvbCA9IDggLSB0YXJnZXRDb2w7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgdGhlIG1vdmUgdGhhdCBtYXRjaGVzIGJvdGggZGlyZWN0aW9uIGFuZCB0YXJnZXQgY29sdW1uDQogICAgICAgICAgICAgICAgICAgIHRvUG9zID0gcG9zc2libGVNb3Zlcy5maW5kKG1vdmUgPT4gew0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZGlyZWN0aW9uIChyb3cpDQogICAgICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa56L+b5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8ie+8jOmAgOaYr3Llop7lpKfvvIjlkJHpu5HmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdGlvbk1hdGNoID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yID4gZnJvbVBvcy5yIDogbW92ZS5yIDwgZnJvbVBvcy5yKSA6DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRDb2xvciA9PT0gJ3JlZCcgPyBtb3ZlLnIgPCBmcm9tUG9zLnIgOiBtb3ZlLnIgPiBmcm9tUG9zLnIpOw0KICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgY29sdW1uDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2x1bW5NYXRjaCA9IG1vdmUuYyA9PT0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpcmVjdGlvbk1hdGNoICYmIGNvbHVtbk1hdGNoOw0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHBpZWNlVHlwZSA9PT0gJ2Fkdmlzb3InKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIEFkdmlzb3IgbW92ZXMgZGlhZ29uYWxseSAxIHN0ZXANCiAgICAgICAgICAgICAgICAgICAgY29uc3QgcG9zc2libGVNb3ZlcyA9IGdldEFkdmlzb3JNb3Zlcyhmcm9tUG9zLCBjdXJyZW50Q29sb3IpOw0KICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSB0YXJnZXQgY29sdW1uIGZyb20gbm90YXRpb24NCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0Q29sTm90YXRpb24gPSB0b0NvbE9yU3RlcE5vdGF0aW9uOw0KICAgICAgICAgICAgICAgICAgICBsZXQgdGFyZ2V0Q29sID0gY29sTWFwW3RhcmdldENvbE5vdGF0aW9uXTsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHRhcmdldENvbCA9PT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIHRhcmdldCBjb2x1bW4gbm90YXRpb24gZm9yIGFkdmlzb3I6JywgdGFyZ2V0Q29sTm90YXRpb24sICdpbiBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIC8vIE1pcnJvciB0aGUgY29sdW1uIGZvciBibGFjaw0KICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudENvbG9yID09PSAnYmxhY2snKSB7DQogICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRDb2wgPSA4IC0gdGFyZ2V0Q29sOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBtb3ZlIHRoYXQgbWF0Y2hlcyBib3RoIGRpcmVjdGlvbiBhbmQgdGFyZ2V0IGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICB0b1BvcyA9IHBvc3NpYmxlTW92ZXMuZmluZChtb3ZlID0+IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGRpcmVjdGlvbiAocm93KQ0KICAgICAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa56L+b5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8ie+8jOmAgOaYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvIkNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIOm7keaWuei/m+aYr3Llh4/lsI/vvIjlkJHnuqLmlrnmlrnlkJHvvInvvIzpgIDmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJDQogICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXJlY3Rpb25NYXRjaCA9IGRpcmVjdGlvbiA9PT0gJ+i/mycgPyANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAoY3VycmVudENvbG9yID09PSAncmVkJyA/IG1vdmUuciA+IGZyb21Qb3MuciA6IG1vdmUuciA8IGZyb21Qb3MucikgOg0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gbW92ZS5yIDwgZnJvbVBvcy5yIDogbW92ZS5yID4gZnJvbVBvcy5yKTsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGNvbHVtbg0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29sdW1uTWF0Y2ggPSBtb3ZlLmMgPT09IHRhcmdldENvbDsNCiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3Rpb25NYXRjaCAmJiBjb2x1bW5NYXRjaDsNCiAgICAgICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gU3RyYWlnaHQgbGluZSBtb3ZlbWVudCAoY2hhcmlvdCwgY2Fubm9uLCBzb2xkaWVyKQ0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnov5vmmK9y5aKe5aSn77yI5ZCR6buR5pa55pa55ZCR77yJ77yM6YCA5pivcuWHj+Wwj++8iOWQkee6ouaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov5vmmK9y5YeP5bCP77yI5ZCR57qi5pa55pa55ZCR77yJ77yM6YCA5pivcuWinuWkp++8iOWQkem7keaWueaWueWQke+8iQ0KICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGVwID0gZGlyZWN0aW9uID09PSAn6L+bJyA/IChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gMSA6IC0xKSAqIHN0ZXBzIDoNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gLTEgOiAxKSAqIHN0ZXBzOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXdSID0gZnJvbVBvcy5yICsgc3RlcDsNCiAgICAgICAgICAgICAgICAgICAgaWYgKG5ld1IgPCAwIHx8IG5ld1IgPj0gMTApIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgcm93IHBvc2l0aW9uIGFmdGVyIG1vdmU6JywgbmV3UiwgJ2ZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICAgICAgdG9Qb3MgPSB7IHI6IG5ld1IsIGM6IGZyb21Qb3MuYyB9Ow0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgaWYgKCF0b1Bvcykgew0KICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBkZXRlcm1pbmUgdGFyZ2V0IHBvc2l0aW9uIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbik7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KDQogICAgICAgICAgICAvLyBBZGQgdGhlIG1vdmUgdG8gdGhlIGxpc3QNCiAgICAgICAgICAgIG1vdmVzLnB1c2goeyBmcm9tOiB7IHI6IGZyb21Qb3MuciwgYzogZnJvbVBvcy5jIH0sIHRvOiB7IHI6IHRvUG9zLnIsIGM6IHRvUG9zLmMgfSB9KTsNCg0KICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUncyBhIGNhcHR1cmVkIHBpZWNlDQogICAgICAgICAgICBjb25zdCBjYXB0dXJlZFBpZWNlID0gdGVtcEJvYXJkW3RvUG9zLnJdW3RvUG9zLmNdOw0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBJZiB0aGVyZSdzIGEgY2FwdHVyZWQgcGllY2UsIHJlbW92ZSBpdCBmcm9tIHBpZWNlUG9zaXRpb25zDQogICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkS2V5ID0gYCR7Y2FwdHVyZWRQaWVjZS5jb2xvcn0tJHtjYXB0dXJlZFBpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgICAgICBjb25zdCBjYXB0dXJlZFBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XTsNCiAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICBpZiAoY2FwdHVyZWRQb3NpdGlvbnMpIHsNCiAgICAgICAgICAgICAgICAgICAgLy8g5bCGL+W4heS4jeS8muiiq+WQg+aOie+8jOaJgOS7peWPquWkhOeQhuWFtuS7luaji+WtkA0KICAgICAgICAgICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZS50eXBlICE9PSAnZ2VuZXJhbCcpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJlbW92ZSB0aGUgY2FwdHVyZWQgcG9zaXRpb24gZnJvbSB0aGUgYXJyYXkNCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNhcHR1cmVkUG9zaXRpb25zKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHVwZGF0ZWRQb3NpdGlvbnMgPSBjYXB0dXJlZFBvc2l0aW9ucy5maWx0ZXIocG9zID0+IA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3MgJiYgKHBvcy5yICE9PSB0b1Bvcy5yIHx8IHBvcy5jICE9PSB0b1Bvcy5jKQ0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgcGllY2VQb3NpdGlvbnNbY2FwdHVyZWRLZXldID0gdXBkYXRlZFBvc2l0aW9uczsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBWZXJpZnkgcmVtb3ZhbCB3YXMgc3VjY2Vzc2Z1bA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0aWxsRXhpc3RzID0gdXBkYXRlZFBvc2l0aW9ucy5zb21lKHBvcyA9PiANCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zICYmIHBvcy5yID09PSB0b1Bvcy5yICYmIHBvcy5jID09PSB0b1Bvcy5jDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoc3RpbGxFeGlzdHMpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVSUk9SOiBDYXB0dXJlZCBwaWVjZSBzdGlsbCBleGlzdHMgaW4gcGllY2VQb3NpdGlvbnMhJyk7DQogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ+KchSBTVUNDRVNTOiBDYXB0dXJlZCBwaWVjZSByZW1vdmVkIGZyb20gcGllY2VQb3NpdGlvbnMnKTsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFUlJPUjogVW5leHBlY3RlZCBub24tYXJyYXkgcG9zaXRpb25zIGZvciBwaWVjZTonLCBjYXB0dXJlZEtleSk7DQogICAgICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IE5vIHBvc2l0aW9ucyBmb3VuZCBmb3IgY2FwdHVyZWQgcGllY2U6JywgY2FwdHVyZWRLZXkpOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8gVmVyaWZ5IHRoZSBjYXB0dXJlZCBwaWVjZSBoYXMgYmVlbiByZW1vdmVkDQogICAgICAgICAgICBpZiAoY2FwdHVyZWRQaWVjZSkgew0KICAgICAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkS2V5ID0gYCR7Y2FwdHVyZWRQaWVjZS5jb2xvcn0tJHtjYXB0dXJlZFBpZWNlLnR5cGV9YDsNCiAgICAgICAgICAgICAgICBjb25zdCBmaW5hbFBvc2l0aW9ucyA9IHBpZWNlUG9zaXRpb25zW2NhcHR1cmVkS2V5XTsNCiAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaW5hbFBvc2l0aW9ucykpIHsNCiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RpbGxFeGlzdHMgPSBmaW5hbFBvc2l0aW9ucy5zb21lKHBvcyA9PiANCiAgICAgICAgICAgICAgICAgICAgICAgIHBvcyAmJiBwb3MuciA9PT0gdG9Qb3MuciAmJiBwb3MuYyA9PT0gdG9Qb3MuYw0KICAgICAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgICAgICBpZiAoc3RpbGxFeGlzdHMpIHsNCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0VSUk9SOiBDYXB0dXJlZCBwaWVjZSBzdGlsbCBleGlzdHMgaW4gcGllY2VQb3NpdGlvbnM6JywgY2FwdHVyZWRQaWVjZSwgJ2F0JywgdG9Qb3MpOw0KICAgICAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NVQ0NFU1M6IENhcHR1cmVkIHBpZWNlIHJlbW92ZWQgZnJvbSBwaWVjZVBvc2l0aW9ucycpOw0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBNYWtlIHRoZSBtb3ZlIG9uIHRoZSB0ZW1wb3JhcnkgYm9hcmQgZmlyc3QgYmVmb3JlIHVwZGF0aW5nIHBpZWNlIHBvc2l0aW9ucw0KICAgICAgICAgICAgaWYgKGlzVmFsaWRQb3MoZnJvbVBvcy5yLCBmcm9tUG9zLmMpICYmIGlzVmFsaWRQb3ModG9Qb3MuciwgdG9Qb3MuYykgJiYgDQogICAgICAgICAgICAgICAgdGVtcEJvYXJkW2Zyb21Qb3Mucl0gJiYgdGVtcEJvYXJkW3RvUG9zLnJdKSB7DQogICAgICAgICAgICAgICAgY29uc3QgcGllY2UgPSB0ZW1wQm9hcmRbZnJvbVBvcy5yXVtmcm9tUG9zLmNdOw0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFt0b1Bvcy5yXVt0b1Bvcy5jXSA9IHBpZWNlOw0KICAgICAgICAgICAgICAgIHRlbXBCb2FyZFtmcm9tUG9zLnJdW2Zyb21Qb3MuY10gPSBudWxsOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRVJST1I6IEludmFsaWQgcG9zaXRpb25zIGZvciBtb3ZlOicsIG1vdmVOb3RhdGlvbiwgZnJvbVBvcywgdG9Qb3MpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyBVcGRhdGUgdGhlIHBpZWNlIHBvc2l0aW9uIGluIHBpZWNlUG9zaXRpb25zDQogICAgICAgICAgICB1cGRhdGVQaWVjZVBvc2l0aW9uKHBpZWNlVHlwZSwgY3VycmVudENvbG9yLCBmcm9tUG9zLCB0b1Bvcyk7DQogICAgICAgICAgICAgICAgICAgICAgICANCiAgICAgICAgICAgIC8vIFN3aXRjaCBjb2xvciBmb3IgbmV4dCBtb3ZlDQogICAgICAgICAgICBjdXJyZW50Q29sb3IgPSBjdXJyZW50Q29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICB9KTsNCg0KICAgICAgICByZXR1cm4gbW92ZXM7DQogICAgfQ0KfQ0KDQovLyAtLS0gQ29uc3RhbnRzIC0tLQ0KDQovLyBJbml0aWFsaXplIE9wZW5pbmcgQm9vaw0KY29uc3Qgb3BlbmluZ0Jvb2sgPSBuZXcgT3BlbmluZ0Jvb2soMTIpOw0KDQpjb25zdCBpc1ZhbGlkUG9zID0gKHIsIGMpID0+IHIgPj0gMCAmJiByIDwgUk9XUyAmJiBjID49IDAgJiYgYyA8IENPTFM7DQoNCi8vIOaooeWdl+e6p+S8quWQiOazleiQveeCue+8iOmBv+WFjSBnZXRQaWVjZU1vdmVzIOavj+iwg+eUqOaWsOW7uumXreWMhe+8iQ0KY29uc3QgcHVzaFBzZXVkb0Rlc3QgPSAoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIHRyLCB0YykgPT4gew0KICBpZiAodHIgPCAwIHx8IHRyID49IFJPV1MgfHwgdGMgPCAwIHx8IHRjID49IENPTFMpIHJldHVybjsNCiAgY29uc3QgdGFyZ2V0ID0gYm9hcmRbdHJdW3RjXTsNCiAgaWYgKCF0YXJnZXQgfHwgdGFyZ2V0LmNvbG9yICE9PSBwaWVjZUNvbG9yKSB7DQogICAgbW92ZXMucHVzaCh7IHI6IHRyLCBjOiB0YyB9KTsNCiAgfSBlbHNlIGlmIChhbGxpZXNPdXQgJiYgdGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgew0KICAgIGFsbGllc091dC5wdXNoKHsgcjogdHIsIGM6IHRjIH0pOw0KICB9DQp9Ow0KDQovLyBhbGxpZXNPdXQ6IOWPr+mAie+8jOaUtumbhuWPr+S/neaKpOeahOW3seaWueiQveeCue+8iOS4jeWQq+WwhuW4he+8ie+8jOS+m+WFs+ezu+iuoeeul+WkjeeUqO+8jOmBv+WFjeS6jOasoeWwhOe6vw0KY29uc3QgZ2V0UGllY2VNb3ZlcyA9IChib2FyZCwgcG9zLCBwaWVjZSwgYWxsaWVzT3V0ID0gbnVsbCkgPT4gew0KICBjb25zdCBtb3ZlcyA9IFtdOw0KICBjb25zdCB7IHIsIGMgfSA9IHBvczsNCiAgY29uc3QgaXNSZWQgPSBwaWVjZS5jb2xvciA9PT0gJ3JlZCc7DQogIGNvbnN0IHBpZWNlQ29sb3IgPSBwaWVjZS5jb2xvcjsNCiAgY29uc3QgY29sb3JJZHggPSBpc1JlZCA/IDAgOiAxOw0KICBjb25zdCBmcm9tU3EgPSByICogOSArIGM7DQoNCiAgc3dpdGNoIChwaWVjZS50eXBlKSB7DQogICAgY2FzZSAnZ2VuZXJhbCc6IHsNCiAgICAgIGNvbnN0IGRlc3RzID0gR0VORVJBTF9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogICAgY2FzZSAnYWR2aXNvcic6IHsNCiAgICAgIGNvbnN0IGRlc3RzID0gQURWSVNPUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogICAgY2FzZSAnZWxlcGhhbnQnOiB7DQogICAgICBjb25zdCBkZXN0cyA9IEVMRVBIQU5UX0RFU1RbY29sb3JJZHhdW2Zyb21TcV07DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgaWYgKGJvYXJkW2QuYnJdW2QuYmNdID09PSBudWxsKSB7DQogICAgICAgICAgcHVzaFBzZXVkb0Rlc3QoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIGQuciwgZC5jKTsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICAgIGNhc2UgJ2hvcnNlJzogew0KICAgICAgY29uc3QgZGVzdHMgPSBIT1JTRV9ERVNUW2Zyb21TcV07DQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlc3RzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGQgPSBkZXN0c1tpXTsNCiAgICAgICAgaWYgKGJvYXJkW2QuYnJdW2QuYmNdID09PSBudWxsKSB7DQogICAgICAgICAgcHVzaFBzZXVkb0Rlc3QoYm9hcmQsIG1vdmVzLCBhbGxpZXNPdXQsIHBpZWNlQ29sb3IsIGQuciwgZC5jKTsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgfQ0KICAgIGNhc2UgJ2NoYXJpb3QnOg0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBPUlRIX0RJUlMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZHIgPSBPUlRIX0RJUlNbaV1bMF0sIGRjID0gT1JUSF9ESVJTW2ldWzFdOw0KICAgICAgICBsZXQgbnIgPSByICsgZHIsIG5jID0gYyArIGRjOw0KICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMpIHsNCiAgICAgICAgICBjb25zdCB0YXJnZXQgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgIGlmICh0YXJnZXQgPT09IG51bGwpIHsNCiAgICAgICAgICAgIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGlmICh0YXJnZXQuY29sb3IgIT09IHBpZWNlQ29sb3IpIG1vdmVzLnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICBlbHNlIGlmIChhbGxpZXNPdXQgJiYgdGFyZ2V0LnR5cGUgIT09ICdnZW5lcmFsJykgYWxsaWVzT3V0LnB1c2goeyByOiBuciwgYzogbmMgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgICB9DQogICAgICAgICAgbnIgKz0gZHI7IG5jICs9IGRjOw0KICAgICAgICB9DQogICAgICB9DQogICAgICBicmVhazsNCiAgICBjYXNlICdjYW5ub24nOg0KICAgICAgLy8g552A5rOV5LuN5Y+q5ZCr5pWM5pa56ZqU5omT77yb5bex5pa56ZqU5omT5L+d5oqk55SxIGZpbGxDYW5ub25SZWxhdGlvbnMg57uf5LiA5aSE55CGDQogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE9SVEhfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkciA9IE9SVEhfRElSU1tpXVswXSwgZGMgPSBPUlRIX0RJUlNbaV1bMV07DQogICAgICAgIGxldCBuciA9IHIgKyBkciwgbmMgPSBjICsgZGM7DQogICAgICAgIGxldCBzY3JlZW5Gb3VuZCA9IGZhbHNlOw0KICAgICAgICB3aGlsZSAobnIgPj0gMCAmJiBuciA8IFJPV1MgJiYgbmMgPj0gMCAmJiBuYyA8IENPTFMpIHsNCiAgICAgICAgICBpZiAoIXNjcmVlbkZvdW5kKSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICBtb3Zlcy5wdXNoKHsgcjogbnIsIGM6IG5jIH0pOw0KICAgICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgICAgc2NyZWVuRm91bmQgPSB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXSAhPT0gbnVsbCkgew0KICAgICAgICAgICAgICBpZiAoYm9hcmRbbnJdW25jXS5jb2xvciAhPT0gcGllY2VDb2xvcikgbW92ZXMucHVzaCh7IHI6IG5yLCBjOiBuYyB9KTsNCiAgICAgICAgICAgICAgYnJlYWs7DQogICAgICAgICAgICB9DQogICAgICAgICAgfQ0KICAgICAgICAgIG5yICs9IGRyOyBuYyArPSBkYzsNCiAgICAgICAgfQ0KICAgICAgfQ0KICAgICAgYnJlYWs7DQogICAgY2FzZSAnc29sZGllcic6IHsNCiAgICAgIGNvbnN0IGRlc3RzID0gU09MRElFUl9ERVNUW2NvbG9ySWR4XVtmcm9tU3FdOw0KICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0cy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gZGVzdHNbaV07DQogICAgICAgIHB1c2hQc2V1ZG9EZXN0KGJvYXJkLCBtb3ZlcywgYWxsaWVzT3V0LCBwaWVjZUNvbG9yLCBkLnIsIGQuYyk7DQogICAgICB9DQogICAgICBicmVhazsNCiAgICB9DQogIH0NCiAgcmV0dXJuIG1vdmVzOw0KfTsNCg0KY29uc3QgaXNGbHlpbmdHZW5lcmFsID0gKGJvYXJkKSA9PiB7DQogIGNvbnN0IHJlZEcgPSBnZXRHZW5lcmFsUG9zKGJvYXJkLCAncmVkJyk7DQogIGNvbnN0IGJsYWNrRyA9IGdldEdlbmVyYWxQb3MoYm9hcmQsICdibGFjaycpOw0KICBpZiAoIXJlZEcgfHwgIWJsYWNrRyB8fCByZWRHLmMgIT09IGJsYWNrRy5jKSByZXR1cm4gZmFsc2U7DQogIA0KICAvLyDnoa7kv53lvqrnjq/mlrnlkJHmraPnoa7vvIzku47ovoPlsI/nmoRy5Yiw6L6D5aSn55qEcg0KICBjb25zdCBzdGFydFIgPSBNYXRoLm1pbihibGFja0cuciwgcmVkRy5yKSArIDE7DQogIGNvbnN0IGVuZFIgPSBNYXRoLm1heChibGFja0cuciwgcmVkRy5yKSAtIDE7DQogIA0KICBmb3IgKGxldCByID0gc3RhcnRSOyByIDw9IGVuZFI7IHIrKykgew0KICAgIGlmIChib2FyZFtyXVtyZWRHLmNdICE9PSBudWxsKSByZXR1cm4gZmFsc2U7DQogIH0NCiAgcmV0dXJuIHRydWU7DQp9Ow0KDQovLyDml6AgYm9hcmRJbmZvIOaXtueahOW/q+mAn+WwhuWGm+ajgOa1i++8muWwhuS9jee8k+WtmCArIOS7juWwhuS9jeWbm+WQkeWwhOe6v++8iOi9pi/lsIYv54Ku5ZCI5bm277yJDQpjb25zdCBpc0NoZWNrUmF3RnJvbVBpZWNlU3RhdGUgPSAoc3RhdGUsIGNvbG9yKSA9PiB7DQogICAgY29uc3Qgb3duSXNSZWQgPSBjb2xvciA9PT0gJ3JlZCc7DQogICAgY29uc3QgZ2VuZXJhbFNxID0gb3duSXNSZWQgPyBzdGF0ZS5yZWRHZW5lcmFsU3EgOiBzdGF0ZS5ibGFja0dlbmVyYWxTcTsNCiAgICBpZiAoZ2VuZXJhbFNxIDwgMCkgcmV0dXJuIHRydWU7DQoNCiAgICBjb25zdCBzcXVhcmVDb2RlcyA9IHN0YXRlLnNxdWFyZUNvZGVzOw0KICAgIGNvbnN0IGVuZW15SXNSZWQgPSAhb3duSXNSZWQ7DQogICAgY29uc3QgZ3IgPSBTRUFSQ0hfU1FfUk9XU1tnZW5lcmFsU3FdOw0KICAgIGNvbnN0IGdjID0gU0VBUkNIX1NRX0NPTFNbZ2VuZXJhbFNxXTsNCg0KICAgIGZvciAobGV0IGRpciA9IDAsIHJheUluZGV4ID0gZ2VuZXJhbFNxIDw8IDI7IGRpciA8IFNFQVJDSF9SQVlfRElSUzsgZGlyKyssIHJheUluZGV4KyspIHsNCiAgICAgICAgbGV0IHNlZW4gPSAwOw0KICAgICAgICBjb25zdCByYXlFbmQgPSBTRUFSQ0hfUkFZX09GRlNFVFNbcmF5SW5kZXggKyAxXTsNCiAgICAgICAgZm9yIChsZXQgcmF5UG9zID0gU0VBUkNIX1JBWV9PRkZTRVRTW3JheUluZGV4XTsgcmF5UG9zIDwgcmF5RW5kOyByYXlQb3MrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2VDb2RlID0gc3F1YXJlQ29kZXNbU0VBUkNIX1JBWV9TUVVBUkVTW3JheVBvc11dOw0KICAgICAgICAgICAgaWYgKHBpZWNlQ29kZSA9PT0gMCkgY29udGludWU7DQogICAgICAgICAgICBzZWVuKys7DQogICAgICAgICAgICBjb25zdCBpc0VuZW15ID0gKHBpZWNlQ29kZSA8IDgpID09PSBlbmVteUlzUmVkOw0KICAgICAgICAgICAgY29uc3QgcGllY2VUeXBlID0gcGllY2VDb2RlICYgNzsNCiAgICAgICAgICAgIGlmIChzZWVuID09PSAxKSB7DQogICAgICAgICAgICAgICAgaWYgKGlzRW5lbXkgJiYgKHBpZWNlVHlwZSA9PT0gMiB8fCBwaWVjZVR5cGUgPT09IDEpKSByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgaWYgKGlzRW5lbXkgJiYgcGllY2VUeXBlID09PSA2KSByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGNvbnN0IGhvcnNlQ2hlY2tlcnMgPSBTRUFSQ0hfSE9SU0VfQ0hFQ0tFUlNbZ2VuZXJhbFNxXTsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGhvcnNlQ2hlY2tlcnMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgZW50cnkgPSBob3JzZUNoZWNrZXJzW2ldOw0KICAgICAgICBpZiAoc3F1YXJlQ29kZXNbZW50cnkgPj4+IDddICE9PSAwKSBjb250aW51ZTsNCiAgICAgICAgY29uc3QgcGllY2VDb2RlID0gc3F1YXJlQ29kZXNbZW50cnkgJiAxMjddOw0KICAgICAgICBpZiAocGllY2VDb2RlICE9PSAwICYmIChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZCAmJiAocGllY2VDb2RlICYgNykgPT09IDMpIHJldHVybiB0cnVlOw0KICAgIH0NCg0KICAgIGNvbnN0IGFkdmlzb3JTcXVhcmVzID0gU0VBUkNIX0FEVklTT1JfREVTVFtvd25Jc1JlZCA/IDAgOiAxXVtnZW5lcmFsU3FdOw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYWR2aXNvclNxdWFyZXMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgcGllY2VDb2RlID0gc3F1YXJlQ29kZXNbYWR2aXNvclNxdWFyZXNbaV1dOw0KICAgICAgICBpZiAocGllY2VDb2RlICE9PSAwICYmIChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZCAmJiAocGllY2VDb2RlICYgNykgPT09IDUpIHJldHVybiB0cnVlOw0KICAgIH0NCg0KICAgIGNvbnN0IGVuZW15Rm9yd2FyZCA9IGVuZW15SXNSZWQgPyAxIDogLTE7DQogICAgY29uc3QgZm9yd2FyZFIgPSBnciAtIGVuZW15Rm9yd2FyZDsNCiAgICBpZiAoZm9yd2FyZFIgPj0gMCAmJiBmb3J3YXJkUiA8IFJPV1MpIHsNCiAgICAgICAgY29uc3QgcGllY2VDb2RlID0gc3F1YXJlQ29kZXNbZm9yd2FyZFIgKiA5ICsgZ2NdOw0KICAgICAgICBpZiAocGllY2VDb2RlICE9PSAwICYmIChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZCAmJiAocGllY2VDb2RlICYgNykgPT09IDcpIHJldHVybiB0cnVlOw0KICAgIH0NCiAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBlbmVteUlzUmVkID8gZ3IgPj0gNSA6IGdyIDw9IDQ7DQogICAgaWYgKGNyb3NzZWRSaXZlcikgew0KICAgICAgICBpZiAoZ2MgPCBDT0xTIC0gMSkgew0KICAgICAgICAgICAgY29uc3QgcGllY2VDb2RlID0gc3F1YXJlQ29kZXNbZ2VuZXJhbFNxICsgMV07DQogICAgICAgICAgICBpZiAocGllY2VDb2RlICE9PSAwICYmIChwaWVjZUNvZGUgPCA4KSA9PT0gZW5lbXlJc1JlZCAmJiAocGllY2VDb2RlICYgNykgPT09IDcpIHJldHVybiB0cnVlOw0KICAgICAgICB9DQogICAgICAgIGlmIChnYyA+IDApIHsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlQ29kZSA9IHNxdWFyZUNvZGVzW2dlbmVyYWxTcSAtIDFdOw0KICAgICAgICAgICAgaWYgKHBpZWNlQ29kZSAhPT0gMCAmJiAocGllY2VDb2RlIDwgOCkgPT09IGVuZW15SXNSZWQgJiYgKHBpZWNlQ29kZSAmIDcpID09PSA3KSByZXR1cm4gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIHJldHVybiBmYWxzZTsNCn07DQoNCmNvbnN0IGlzQ2hlY2tSYXcgPSAoYm9hcmQsIGNvbG9yKSA9PiB7DQogICAgY29uc3QgcGllY2VTdGF0ZSA9IGFjdGl2ZVBpZWNlU3RhdGVGb3IoYm9hcmQpOw0KICAgIGlmIChwaWVjZVN0YXRlKSByZXR1cm4gaXNDaGVja1Jhd0Zyb21QaWVjZVN0YXRlKHBpZWNlU3RhdGUsIGNvbG9yKTsNCiAgICBjb25zdCBnZW5lcmFsUG9zID0gZ2V0R2VuZXJhbFBvcyhib2FyZCwgY29sb3IpOw0KICAgIGlmICghZ2VuZXJhbFBvcykgcmV0dXJuIHRydWU7DQoNCiAgICBjb25zdCBlbmVteUNvbG9yID0gY29sb3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgIGNvbnN0IHsgcjogZ3IsIGM6IGdjIH0gPSBnZW5lcmFsUG9zOw0KDQogICAgLy8g55u057q/77ya56ys5LiA5a2Q5Li65pWM6L2mL+WwhuWImeWwhuWGm++8m+i2iui/h+eCruaetuWQjuesrOS6jOWtkOS4uuaVjOeCruWImeWwhuWGmw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgT1JUSF9ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gT1JUSF9ESVJTW2ldWzBdLCBkYyA9IE9SVEhfRElSU1tpXVsxXTsNCiAgICAgICAgbGV0IG5yID0gZ3IgKyBkcjsNCiAgICAgICAgbGV0IG5jID0gZ2MgKyBkYzsNCiAgICAgICAgbGV0IHNlZW4gPSAwOw0KDQogICAgICAgIHdoaWxlIChpc1ZhbGlkUG9zKG5yLCBuYykpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHApIHsNCiAgICAgICAgICAgICAgICBzZWVuKys7DQogICAgICAgICAgICAgICAgaWYgKHNlZW4gPT09IDEpIHsNCiAgICAgICAgICAgICAgICAgICAgaWYgKHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgKHAudHlwZSA9PT0gJ2NoYXJpb3QnIHx8IHAudHlwZSA9PT0gJ2dlbmVyYWwnKSkgew0KICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICBpZiAocC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdjYW5ub24nKSB7DQogICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBuciArPSBkcjsNCiAgICAgICAgICAgIG5jICs9IGRjOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g6ams77ya5LuO5bCG5L2N5Y+N5o6o77yM6ams6IW/5Zyo6ams5LiA5L6n77yI5LiOIGdldFBpZWNlTW92ZXMgLyBIT1JTRV9ESVJTIOS4gOiHtO+8iQ0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgSE9SU0VfRElSUy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBkID0gSE9SU0VfRElSU1tpXTsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGQuZHI7DQogICAgICAgIGNvbnN0IG5jID0gZ2MgKyBkLmRjOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhuciwgbmMpKSB7DQogICAgICAgICAgICBjb25zdCBsZWdSID0gbnIgLSBkLmxlZ0RyOw0KICAgICAgICAgICAgY29uc3QgbGVnQyA9IG5jIC0gZC5sZWdEYzsNCiAgICAgICAgICAgIGlmIChib2FyZFtsZWdSXVtsZWdDXSA9PT0gbnVsbCkgew0KICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnaG9yc2UnKSB7DQogICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOWjq++8iOS5neWuq+WGhe+8iQ0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgRElBR19ESVJTLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IGRyID0gRElBR19ESVJTW2ldWzBdLCBkYyA9IERJQUdfRElSU1tpXVsxXTsNCiAgICAgICAgY29uc3QgbnIgPSBnciArIGRyOw0KICAgICAgICBjb25zdCBuYyA9IGdjICsgZGM7DQogICAgICAgIGlmIChpc1ZhbGlkUG9zKG5yLCBuYykgJiYNCiAgICAgICAgICAgICgoY29sb3IgPT09ICdyZWQnICYmIG5yID49IDAgJiYgbnIgPD0gMikgfHwgKGNvbG9yID09PSAnYmxhY2snICYmIG5yID49IDcgJiYgbnIgPD0gOSkpICYmDQogICAgICAgICAgICBuYyA+PSAzICYmIG5jIDw9IDUpIHsNCiAgICAgICAgICAgIGNvbnN0IHAgPSBib2FyZFtucl1bbmNdOw0KICAgICAgICAgICAgaWYgKHAgJiYgcC5jb2xvciA9PT0gZW5lbXlDb2xvciAmJiBwLnR5cGUgPT09ICdhZHZpc29yJykgew0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgLy8g5YW177ya5q2j5YmN5pa55aeL57uI5Y+v5pS777yb5bem5Y+z5LuF6L+H5rKz5YW1DQogICAgY29uc3QgZW5lbXlGb3J3YXJkID0gZW5lbXlDb2xvciA9PT0gJ3JlZCcgPyAxIDogLTE7DQogICAgY29uc3QgZm9yd2FyZEZyb21SID0gZ3IgLSBlbmVteUZvcndhcmQ7DQogICAgaWYgKGlzVmFsaWRQb3MoZm9yd2FyZEZyb21SLCBnYykpIHsNCiAgICAgICAgY29uc3QgcCA9IGJvYXJkW2ZvcndhcmRGcm9tUl1bZ2NdOw0KICAgICAgICBpZiAocCAmJiBwLmNvbG9yID09PSBlbmVteUNvbG9yICYmIHAudHlwZSA9PT0gJ3NvbGRpZXInKSB7DQogICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgfQ0KICAgIH0NCiAgICBmb3IgKGNvbnN0IGRjIG9mIFsxLCAtMV0pIHsNCiAgICAgICAgY29uc3QgbmMgPSBnYyArIGRjOw0KICAgICAgICBpZiAoaXNWYWxpZFBvcyhnciwgbmMpKSB7DQogICAgICAgICAgICBjb25zdCBwID0gYm9hcmRbZ3JdW25jXTsNCiAgICAgICAgICAgIGlmIChwICYmIHAuY29sb3IgPT09IGVuZW15Q29sb3IgJiYgcC50eXBlID09PSAnc29sZGllcicpIHsNCiAgICAgICAgICAgICAgICBjb25zdCBjcm9zc2VkUml2ZXIgPSBlbmVteUNvbG9yID09PSAncmVkJyA/IGdyID49IDUgOiBnciA8PSA0Ow0KICAgICAgICAgICAgICAgIGlmIChjcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgcmV0dXJuIGZhbHNlOw0KfTsNCg0KY29uc3QgaXNDaGVjayA9IChib2FyZCwgY29sb3IsIHBpZWNlc0luZm8gPSBudWxsLCBib2FyZEluZm8gPSBudWxsKSA9PiB7DQogICAgLy8g5LyY5YWI5L2/55So6aKE6K6h566X55qE5bCG5Yab54q25oCBDQogICAgaWYgKGJvYXJkSW5mbykgew0KICAgICAgICByZXR1cm4gY29sb3IgPT09ICdyZWQnID8gYm9hcmRJbmZvLnJlZElzSW5DaGVjayA6IGJvYXJkSW5mby5ibGFja0lzSW5DaGVjazsNCiAgICB9DQoNCiAgICAvLyDlpoLmnpzmnIlwaWVjZXNJbmZv77yM5Lmf5Y+v5Lul5LuO5Lit6I635Y+W5bCG5Yab54q25oCBDQogICAgaWYgKHBpZWNlc0luZm8gJiYgcGllY2VzSW5mby5sZW5ndGggPiAwKSB7DQogICAgICAgIHJldHVybiBjb2xvciA9PT0gJ3JlZCcgPyBwaWVjZXNJbmZvWzBdLnJlZElzSW5DaGVjayA6IHBpZWNlc0luZm9bMF0uYmxhY2tJc0luQ2hlY2s7DQogICAgfQ0KDQogICAgcmV0dXJuIGlzQ2hlY2tSYXcoYm9hcmQsIGNvbG9yKTsNCn07DQoNCi8vIOWQiOazleedgOazle+8muS8quWQiOazlSArIOS4jemAgeWwhi/kuI3po57lsIbvvIhtYWtlL3VubWFrZe+8iQ0KY29uc3QgZ2V0VmFsaWRNb3ZlcyA9IChib2FyZCwgcG9zKSA9PiB7DQogIGNvbnN0IHBpZWNlID0gYm9hcmRbcG9zLnJdW3Bvcy5jXTsNCiAgaWYgKCFwaWVjZSkgcmV0dXJuIFtdOw0KICBjb25zdCBwc2V1ZG9Nb3ZlcyA9IGdldFBpZWNlTW92ZXMoYm9hcmQsIHBvcywgcGllY2UpOw0KICByZXR1cm4gZmlsdGVyTGVnYWxNb3Zlcyhib2FyZCwgcG9zLCBwaWVjZSwgcHNldWRvTW92ZXMpOw0KfTsNCg0KY29uc3QgaXNWYWxpZFBsYWNlbWVudCA9ICh0eXBlLCBjb2xvciwgciwgYykgPT4gew0KICAgIGNvbnN0IGlzUmVkID0gY29sb3IgPT09ICdyZWQnOw0KICAgIHN3aXRjaCh0eXBlKSB7DQogICAgICAgIGNhc2UgJ2dlbmVyYWwnOg0KICAgICAgICAgICAgLy8g5biF5bCG5Y+q6IO95Zyo5Lmd5a6r5Lit5b+D55qE5LiA5p2h57q/5LiKDQogICAgICAgICAgICBpZiAoYyA8IDMgfHwgYyA+IDUpIHJldHVybiBmYWxzZTsNCiAgICAgICAgICAgIGlmIChpc1JlZCkgcmV0dXJuIHIgPj0gMCAmJiByIDw9IDI7DQogICAgICAgICAgICBlbHNlIHJldHVybiByID49IDcgJiYgciA8PSA5Ow0KICAgICAgICBjYXNlICdhZHZpc29yJzoNCiAgICAgICAgICAgIC8vIOWjq+WPquiDveWcqOS5neWuq+eahDXkuKrngrnkuYvkuIANCiAgICAgICAgICAgIGNvbnN0IHZhbGlkQWR2aXNvclBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IFtbMCwgM10sIFswLCA1XSwgWzEsIDRdLCBbMiwgM10sIFsyLCA1XV0sDQogICAgICAgICAgICAgICAgYmxhY2s6IFtbNywgM10sIFs3LCA1XSwgWzgsIDRdLCBbOSwgM10sIFs5LCA1XV0NCiAgICAgICAgICAgIH07DQogICAgICAgICAgICByZXR1cm4gdmFsaWRBZHZpc29yUG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXS5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgY2FzZSAnZWxlcGhhbnQnOg0KICAgICAgICAgICAgLy8g55u45Y+q6IO95Zyo5bex5pa55Y2K5Zy655qEN+S4queCueS5i+S4gA0KICAgICAgICAgICAgY29uc3QgdmFsaWRFbGVwaGFudFBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IFtbMCwgMl0sIFswLCA2XSwgWzIsIDBdLCBbMiwgNF0sIFsyLCA4XSwgWzQsIDJdLCBbNCwgNl1dLA0KICAgICAgICAgICAgICAgIGJsYWNrOiBbWzUsIDJdLCBbNSwgNl0sIFs3LCAwXSwgWzcsIDRdLCBbNywgOF0sIFs5LCAyXSwgWzksIDZdXQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIHJldHVybiB2YWxpZEVsZXBoYW50UG9zaXRpb25zW2lzUmVkID8gJ3JlZCcgOiAnYmxhY2snXS5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgY2FzZSAnc29sZGllcic6DQogICAgICAgICAgICAvLyDlhbXnmoTkvY3nva7pmZDliLbvvJrov4fmsrPliY3lj6rog73lnKjlgbbmlbDliJfvvIzov4fmsrPlkI7lj6/ku6XlnKjku7vkvZXliJcNCiAgICAgICAgICAgIC8vIOe6ouaWueWFtei/h+ays+adoeS7tuaYr3IgPj0gNe+8jOm7keaWueWFtei/h+ays+adoeS7tuaYr3IgPD0gNA0KICAgICAgICAgICAgY29uc3QgY3Jvc3NlZFJpdmVyID0gaXNSZWQgPyByID49IDUgOiByIDw9IDQ7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghY3Jvc3NlZFJpdmVyKSB7DQogICAgICAgICAgICAgICAgLy8g6L+H5rKz5YmN5Y+q6IO95Zyo5YG25pWw5YiX77yIYz0wLDIsNCw2LDjvvIkNCiAgICAgICAgICAgICAgICBpZiAoIVswLCAyLCA0LCA2LCA4XS5pbmNsdWRlcyhjKSkgcmV0dXJuIGZhbHNlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgICAgICAvLyDlhbXnmoTkvY3nva7pmZDliLbvvJrov4fmsrPliY3lj6rog73lnKjlhbXkvY3lkozlhbXkvY3liY3mlrnvvIzov4fmsrPlkI7mlYzmlrnljYrlnLrpg73lkIjms5UNCiAgICAgICAgICAgIGNvbnN0IHZhbGlkU29sZGllclBvc2l0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICByZWQ6IHsNCiAgICAgICAgICAgICAgICAgICAgLy8g57qi5pa55Yid5aeL5YW15L2N77yacj0zLCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBpbml0aWFsOiBbWzMsIDBdLCBbMywgMl0sIFszLCA0XSwgWzMsIDZdLCBbMywgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDnuqLmlrnlhbXkvY3liY3mlrnvvJpyPTQsIGM9MCwyLDQsNiw4DQogICAgICAgICAgICAgICAgICAgIGZvcndhcmQ6IFtbNCwgMF0sIFs0LCAyXSwgWzQsIDRdLCBbNCwgNl0sIFs0LCA4XV0sDQogICAgICAgICAgICAgICAgICAgIC8vIOe6ouaWuei/h+ays+e6v++8mnI+PTUNCiAgICAgICAgICAgICAgICAgICAgY3Jvc3NlZFJpdmVyOiByID49IDUNCiAgICAgICAgICAgICAgICB9LA0KICAgICAgICAgICAgICAgIGJsYWNrOiB7DQogICAgICAgICAgICAgICAgICAgIC8vIOm7keaWueWIneWni+WFteS9je+8mnI9NiwgYz0wLDIsNCw2LDgNCiAgICAgICAgICAgICAgICAgICAgaW5pdGlhbDogW1s2LCAwXSwgWzYsIDJdLCBbNiwgNF0sIFs2LCA2XSwgWzYsIDhdXSwNCiAgICAgICAgICAgICAgICAgICAgLy8g6buR5pa55YW15L2N5YmN5pa577yacj01LCBjPTAsMiw0LDYsOA0KICAgICAgICAgICAgICAgICAgICBmb3J3YXJkOiBbWzUsIDBdLCBbNSwgMl0sIFs1LCA0XSwgWzUsIDZdLCBbNSwgOF1dLA0KICAgICAgICAgICAgICAgICAgICAvLyDpu5Hmlrnov4fmsrPnur/vvJpyPD00DQogICAgICAgICAgICAgICAgICAgIGNyb3NzZWRSaXZlcjogciA8PSA0DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgY29uc3Qgc29sZGllckluZm8gPSB2YWxpZFNvbGRpZXJQb3NpdGlvbnNbaXNSZWQgPyAncmVkJyA6ICdibGFjayddOw0KICAgICAgICAgICAgY29uc3QgaXNJbml0aWFsUG9zID0gc29sZGllckluZm8uaW5pdGlhbC5zb21lKHBvcyA9PiBwb3NbMF0gPT09IHIgJiYgcG9zWzFdID09PSBjKTsNCiAgICAgICAgICAgIGNvbnN0IGlzRm9yd2FyZFBvcyA9IHNvbGRpZXJJbmZvLmZvcndhcmQuc29tZShwb3MgPT4gcG9zWzBdID09PSByICYmIHBvc1sxXSA9PT0gYyk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmIChzb2xkaWVySW5mby5jcm9zc2VkUml2ZXIpIHsNCiAgICAgICAgICAgICAgICAvLyDov4fmsrPlkI7mlYzmlrnljYrlnLrpg73lkIjms5UNCiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICAgICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g6L+H5rKz5YmN5Y+q6IO95Zyo5YW15L2N5ZKM5YW15L2N5YmN5pa5DQogICAgICAgICAgICAgICAgcmV0dXJuIGlzSW5pdGlhbFBvcyB8fCBpc0ZvcndhcmRQb3M7DQogICAgICAgICAgICB9DQogICAgICAgIGRlZmF1bHQ6DQogICAgICAgICAgICByZXR1cm4gdHJ1ZTsNCiAgICB9DQp9Ow0KDQpjb25zdCBjaGVja0dhbWVTdGF0ZSA9IChib2FyZCwgdHVybiwgcGllY2VzSW5mbyA9IG51bGwsIGJvYXJkSW5mbyA9IG51bGwpID0+IHsNCiAgICAvLyDkvJjlhYjkvb/nlKjpooTorqHnrpfnmoRnYW1lU3RhdGUNCiAgICBpZiAoYm9hcmRJbmZvICYmIGJvYXJkSW5mby5nYW1lU3RhdGUpIHsNCiAgICAgICAgcmV0dXJuIGJvYXJkSW5mby5nYW1lU3RhdGU7DQogICAgfQ0KICAgIA0KICAgIC8vIOayoeaciemihOiuoeeul+e7k+aenOaXtu+8jOaJp+ihjOWOn+Wni+iuoeeulw0KICAgIGxldCBoYXNNb3ZlcyA9IGZhbHNlOw0KICAgIGZvcihsZXQgcj0wOyByPFJPV1M7IHIrKykgew0KICAgICAgICBmb3IobGV0IGM9MDsgYzxDT0xTOyBjKyspIHsNCiAgICAgICAgICAgIGlmIChib2FyZFtyXVtjXT8uY29sb3IgPT09IHR1cm4pIHsNCiAgICAgICAgICAgICAgICBpZiAoZ2V0VmFsaWRNb3Zlcyhib2FyZCwge3IsY30pLmxlbmd0aCA+IDApIHsNCiAgICAgICAgICAgICAgICAgICAgaGFzTW92ZXMgPSB0cnVlOw0KICAgICAgICAgICAgICAgICAgICBicmVhazsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKGhhc01vdmVzKSBicmVhazsNCiAgICB9DQoNCiAgICBpZiAoaGFzTW92ZXMpIHJldHVybiB7IHN0YXR1czogJ3BsYXlpbmcnIH07DQoNCiAgICBjb25zdCBpbkNoZWNrID0gaXNDaGVjayhib2FyZCwgdHVybiwgcGllY2VzSW5mbywgYm9hcmRJbmZvKTsNCiAgICBjb25zdCBvcHBvbmVudCA9IHR1cm4gPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgIA0KICAgIGlmIChpbkNoZWNrKSB7DQogICAgICAgIHJldHVybiB7IHN0YXR1czogJ2NoZWNrbWF0ZScsIHdpbm5lcjogb3Bwb25lbnQgfTsNCiAgICB9IGVsc2Ugew0KICAgICAgICByZXR1cm4geyBzdGF0dXM6ICdzdGFsZW1hdGUnLCB3aW5uZXI6IG9wcG9uZW50IH07DQogICAgfQ0KfTsNCg0KDQoNCmNvbnN0IGdldEdhbWVQaGFzZSA9ICgpID0+IHsNCiAgcmV0dXJuICdvcGVuaW5nJzsNCn07DQoNCi8vIOWunuS+i+WMllpvYnJpc3RIYXNoZXINCmNvbnN0IHpvYnJpc3RIYXNoZXIgPSBuZXcgWm9icmlzdEhhc2hlcigpOw0KDQovLyDlrprplb/mp73kvY0gVFTvvJpUeXBlZEFycmF5IOeDreWtl+autSArIGdlbmVyYXRpb24gTygxKSBjbGVhcuOAgg0KLy8g6ZW/5bqm5Y+WIDJeMjLvvJpkOCDnuqYgMTEwIOS4h+eLrOeJueWxgOmdouaXtui0n+i9vX4wLjI377yM5pi+6JGX5L2O5LqOIDJeMjEg5LiL55qE5Yay56qB6KaG55uW546H44CCDQpjb25zdCBUVF9ERUZBVUxUX1NJWkUgPSAxIDw8IDIyOyAvLyA0MTk0MzA0DQpjb25zdCBUVF9ERUZBVUxUX0VWSUNUSU9OX0JBVENIID0gNTEyOyAvLyBBUEkg5YW85a6577yM5a6a6ZW/IFRUIOS4jeWGjeaJuemHj+a3mOaxsA0KY29uc3QgVFRfRkxBR19OQU1FUyA9IFsnZXhhY3QnLCAnbG93ZXJib3VuZCcsICd1cHBlcmJvdW5kJ107DQoNCmNsYXNzIFRyYW5zcG9zaXRpb25UYWJsZSB7DQogICAgY29uc3RydWN0b3Ioc2l6ZSA9IFRUX0RFRkFVTFRfU0laRSwgZXZpY3Rpb25CYXRjaCA9IFRUX0RFRkFVTFRfRVZJQ1RJT05fQkFUQ0gpIHsNCiAgICAgICAgbGV0IG4gPSBzaXplIHwgMDsNCiAgICAgICAgaWYgKG4gPCAxMDI0KSBuID0gMTAyNDsNCiAgICAgICAgLy8g5by65Yi2IDIg55qE5bmC77yM5L6/5LqOIGtleSAmIG1hc2sNCiAgICAgICAgbiA9IDEgPDwgKDMyIC0gTWF0aC5jbHozMihuIC0gMSkpOw0KICAgICAgICB0aGlzLnNpemUgPSBuOw0KICAgICAgICB0aGlzLm1hc2sgPSBuIC0gMTsNCiAgICAgICAgdGhpcy5ldmljdGlvbkJhdGNoID0gZXZpY3Rpb25CYXRjaDsNCiAgICAgICAgdGhpcy5nZW5lcmF0aW9uID0gMTsNCiAgICAgICAgdGhpcy5vY2N1cGllZEFwcHJveCA9IDA7DQogICAgICAgIHRoaXMuaGFzaGVyID0gem9icmlzdEhhc2hlcjsNCg0KICAgICAgICB0aGlzLmtleXMgPSBuZXcgRmxvYXQ2NEFycmF5KG4pOw0KICAgICAgICB0aGlzLmRlcHRocyA9IG5ldyBJbnQxNkFycmF5KG4pOw0KICAgICAgICB0aGlzLnZhbHVlcyA9IG5ldyBJbnQzMkFycmF5KG4pOw0KICAgICAgICB0aGlzLmZsYWdzID0gbmV3IFVpbnQ4QXJyYXkobik7DQogICAgICAgIHRoaXMuZ2VucyA9IG5ldyBVaW50MzJBcnJheShuKTsNCiAgICAgICAgdGhpcy5iZXN0TW92ZXMgPSBuZXcgQXJyYXkobik7DQogICAgICAgIHRoaXMubW92ZVNlcXVlbmNlcyA9IG5ldyBBcnJheShuKTsNCiAgICAgICAgLy8gcmV0cmlldmUg5aSN55So77yM6YG/5YWN5q+P5qyh5YiG6YWN77yb6LCD55So5pa56aG75Zyo5LiL5LiA5qyhIHJldHJpZXZlL+mAkuW9kuWJjeivu+WujOWtl+autQ0KICAgICAgICB0aGlzLmVudHJ5U2NyYXRjaCA9IHsNCiAgICAgICAgICAgIGRlcHRoOiAwLA0KICAgICAgICAgICAgdmFsdWU6IDAsDQogICAgICAgICAgICBmbGFnOiAnZXhhY3QnLA0KICAgICAgICAgICAgYmVzdE1vdmU6IG51bGwsDQogICAgICAgICAgICBtb3ZlU2VxdWVuY2U6IG51bGwNCiAgICAgICAgfTsNCg0KICAgICAgICB0aGlzLnN0YXRzID0gew0KICAgICAgICAgICAgaGl0czogMCwNCiAgICAgICAgICAgIG1pc3NlczogMCwNCiAgICAgICAgICAgIGV4YWN0SGl0czogMCwNCiAgICAgICAgICAgIGxvd2VyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgdXBwZXJib3VuZEhpdHM6IDAsDQogICAgICAgICAgICBzdG9yZXM6IDAsDQogICAgICAgICAgICBscnVFdmljdGlvbnM6IDAsDQogICAgICAgICAgICBkZXB0aFByZWZlcnJlZEV2aWN0aW9uczogMCwNCiAgICAgICAgICAgIGZhbGxiYWNrRXZpY3Rpb25zOiAwLA0KICAgICAgICAgICAgdXBkYXRlZFN0b3JlczogMCwNCiAgICAgICAgICAgIHJldGFpbmVkVXBkYXRlczogMCwNCiAgICAgICAgICAgIGV2aWN0aW9uQmF0Y2hlczogMCwNCiAgICAgICAgICAgIGNsZWFyczogMA0KICAgICAgICB9Ow0KICAgIH0NCg0KICAgIHNldEV2aWN0aW9uQmF0Y2goYmF0Y2gpIHsNCiAgICAgICAgdGhpcy5ldmljdGlvbkJhdGNoID0gTWF0aC5tYXgoMSwgYmF0Y2ggfCAwKTsNCiAgICB9DQoNCiAgICBzdG9yZShrZXksIGRlcHRoLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUgPSBudWxsLCBtb3ZlU2VxdWVuY2UgPSBudWxsKSB7DQogICAgICAgIGNvbnN0IGkgPSAoa2V5ID4+PiAwKSAmIHRoaXMubWFzazsNCiAgICAgICAgY29uc3QgZ2VuID0gdGhpcy5nZW5lcmF0aW9uOw0KICAgICAgICBjb25zdCBsaXZlID0gdGhpcy5nZW5zW2ldID09PSBnZW47DQogICAgICAgIGNvbnN0IGZsYWdDb2RlID0gZmxhZyA9PT0gJ2V4YWN0JyA/IDAgOiAoZmxhZyA9PT0gJ2xvd2VyYm91bmQnID8gMSA6IDIpOwoKICAgICAgICBpZiAobGl2ZSAmJiB0aGlzLmtleXNbaV0gPT09IGtleSkgewogICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgdGhpcy5zdGF0cy51cGRhdGVkU3RvcmVzKys7CiAgICAgICAgICAgIC8vIOabtOa3sSBleGFjdCDkuI3ooqvmm7TmtYUgYm91bmQg6KaG55uWCiAgICAgICAgICAgIGlmICh0aGlzLmRlcHRoc1tpXSA+IGRlcHRoICYmIHRoaXMuZmxhZ3NbaV0gPT09IDAgJiYgZmxhZ0NvZGUgIT09IDApIHsKICAgICAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSB0aGlzLnN0YXRzLnJldGFpbmVkVXBkYXRlcysrOwogICAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICB9DQogICAgICAgICAgICB0aGlzLmRlcHRoc1tpXSA9IGRlcHRoOw0KICAgICAgICAgICAgdGhpcy52YWx1ZXNbaV0gPSB2YWx1ZSB8IDA7DQogICAgICAgICAgICB0aGlzLmZsYWdzW2ldID0gZmxhZ0NvZGU7DQogICAgICAgICAgICB0aGlzLmJlc3RNb3Zlc1tpXSA9IGJlc3RNb3ZlOw0KICAgICAgICAgICAgdGhpcy5tb3ZlU2VxdWVuY2VzW2ldID0gbW92ZVNlcXVlbmNlOw0KICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHRoaXMuc3RhdHMuc3RvcmVzKys7CiAgICAgICAgICAgIHJldHVybjsKICAgICAgICB9DQoNCiAgICAgICAgaWYgKGxpdmUpIHsNCiAgICAgICAgICAgIC8vIOWTiOW4jOWGsueqge+8muS/neeVmeabtOa3seadoeebru+8iOS4jemZkCBleGFjdO+8ie+8jOmZjeS9juacieaViOWRveS4reaNn+WksQogICAgICAgICAgICBpZiAodGhpcy5kZXB0aHNbaV0gPiBkZXB0aCkgewogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHsKICAgICAgICAgICAgICAgICAgICB0aGlzLnN0YXRzLnJldGFpbmVkVXBkYXRlcysrOwogICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMuZGVwdGhQcmVmZXJyZWRFdmljdGlvbnMrKzsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgewogICAgICAgICAgICAgICAgdGhpcy5zdGF0cy5scnVFdmljdGlvbnMrKzsKICAgICAgICAgICAgICAgIHRoaXMuc3RhdHMuZmFsbGJhY2tFdmljdGlvbnMrKzsKICAgICAgICAgICAgfQogICAgICAgIH0gZWxzZSBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgewogICAgICAgICAgICB0aGlzLm9jY3VwaWVkQXBwcm94Kys7CiAgICAgICAgfQ0KDQogICAgICAgIHRoaXMuZ2Vuc1tpXSA9IGdlbjsNCiAgICAgICAgdGhpcy5rZXlzW2ldID0ga2V5Ow0KICAgICAgICB0aGlzLmRlcHRoc1tpXSA9IGRlcHRoOw0KICAgICAgICB0aGlzLnZhbHVlc1tpXSA9IHZhbHVlIHwgMDsNCiAgICAgICAgdGhpcy5mbGFnc1tpXSA9IGZsYWdDb2RlOw0KICAgICAgICB0aGlzLmJlc3RNb3Zlc1tpXSA9IGJlc3RNb3ZlOw0KICAgICAgICB0aGlzLm1vdmVTZXF1ZW5jZXNbaV0gPSBtb3ZlU2VxdWVuY2U7DQogICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSB0aGlzLnN0YXRzLnN0b3JlcysrOwogICAgfQ0KDQogICAgcmV0cmlldmUoa2V5KSB7DQogICAgICAgIGNvbnN0IGkgPSAoa2V5ID4+PiAwKSAmIHRoaXMubWFzazsKICAgICAgICBpZiAodGhpcy5nZW5zW2ldICE9PSB0aGlzLmdlbmVyYXRpb24gfHwgdGhpcy5rZXlzW2ldICE9PSBrZXkpIHsKICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHRoaXMuc3RhdHMubWlzc2VzKys7CiAgICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgIH0KICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgdGhpcy5zdGF0cy5oaXRzKys7CiAgICAgICAgY29uc3QgZmxhZ0NvZGUgPSB0aGlzLmZsYWdzW2ldOw0KICAgICAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHsNCiAgICAgICAgICAgIGlmIChmbGFnQ29kZSA9PT0gMCkgdGhpcy5zdGF0cy5leGFjdEhpdHMrKzsNCiAgICAgICAgICAgIGVsc2UgaWYgKGZsYWdDb2RlID09PSAxKSB0aGlzLnN0YXRzLmxvd2VyYm91bmRIaXRzKys7DQogICAgICAgICAgICBlbHNlIHRoaXMuc3RhdHMudXBwZXJib3VuZEhpdHMrKzsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBlID0gdGhpcy5lbnRyeVNjcmF0Y2g7DQogICAgICAgIGUuZGVwdGggPSB0aGlzLmRlcHRoc1tpXTsNCiAgICAgICAgZS52YWx1ZSA9IHRoaXMudmFsdWVzW2ldOw0KICAgICAgICBlLmZsYWcgPSBUVF9GTEFHX05BTUVTW2ZsYWdDb2RlXTsNCiAgICAgICAgZS5iZXN0TW92ZSA9IHRoaXMuYmVzdE1vdmVzW2ldOw0KICAgICAgICBlLm1vdmVTZXF1ZW5jZSA9IHRoaXMubW92ZVNlcXVlbmNlc1tpXTsNCiAgICAgICAgcmV0dXJuIGU7DQogICAgfQ0KDQogICAgY2xlYXIoKSB7DQogICAgICAgIC8vIE8oMSnvvJrmiqzljYcgZ2VuZXJhdGlvbu+8m+anveS9jeaDsOaAp+WkseaViA0KICAgICAgICB0aGlzLmdlbmVyYXRpb24gPSAodGhpcy5nZW5lcmF0aW9uICsgMSkgPj4+IDA7DQogICAgICAgIGlmICh0aGlzLmdlbmVyYXRpb24gPT09IDApIHsNCiAgICAgICAgICAgIHRoaXMuZ2VuZXJhdGlvbiA9IDE7DQogICAgICAgICAgICB0aGlzLmdlbnMuZmlsbCgwKTsNCiAgICAgICAgfQ0KICAgICAgICB0aGlzLm9jY3VwaWVkQXBwcm94ID0gMDsNCiAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHRoaXMuc3RhdHMuY2xlYXJzKys7CiAgICB9DQoNCiAgICBnZXRTdGF0cygpIHsNCiAgICAgICAgY29uc3QgdG90YWxBY2Nlc3NlcyA9IHRoaXMuc3RhdHMuaGl0cyArIHRoaXMuc3RhdHMubWlzc2VzOw0KICAgICAgICBjb25zdCBoaXRSYXRlID0gdG90YWxBY2Nlc3NlcyA+IDAgPyAodGhpcy5zdGF0cy5oaXRzIC8gdG90YWxBY2Nlc3NlcyAqIDEwMCkudG9GaXhlZCgyKSA6IDA7DQogICAgICAgIGNvbnN0IGN1cnJlbnRTaXplID0gTWF0aC5taW4odGhpcy5vY2N1cGllZEFwcHJveCwgdGhpcy5zaXplKTsNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIC4uLnRoaXMuc3RhdHMsDQogICAgICAgICAgICBldmljdGlvbkJhdGNoOiB0aGlzLmV2aWN0aW9uQmF0Y2gsDQogICAgICAgICAgICB0b3RhbEFjY2Vzc2VzLA0KICAgICAgICAgICAgaGl0UmF0ZSwNCiAgICAgICAgICAgIGN1cnJlbnRTaXplLA0KICAgICAgICAgICAgbWF4U2l6ZTogdGhpcy5zaXplLA0KICAgICAgICAgICAgZmlsbFBlcmNlbnRhZ2U6ICgoY3VycmVudFNpemUgLyB0aGlzLnNpemUpICogMTAwKS50b0ZpeGVkKDIpDQogICAgICAgIH07DQogICAgfQ0KDQogICAgcmVzZXRTdGF0cygpIHsNCiAgICAgICAgdGhpcy5zdGF0cyA9IHsNCiAgICAgICAgICAgIGhpdHM6IDAsDQogICAgICAgICAgICBtaXNzZXM6IDAsDQogICAgICAgICAgICBleGFjdEhpdHM6IDAsDQogICAgICAgICAgICBsb3dlcmJvdW5kSGl0czogMCwNCiAgICAgICAgICAgIHVwcGVyYm91bmRIaXRzOiAwLA0KICAgICAgICAgICAgc3RvcmVzOiAwLA0KICAgICAgICAgICAgbHJ1RXZpY3Rpb25zOiAwLA0KICAgICAgICAgICAgZGVwdGhQcmVmZXJyZWRFdmljdGlvbnM6IDAsDQogICAgICAgICAgICBmYWxsYmFja0V2aWN0aW9uczogMCwNCiAgICAgICAgICAgIHVwZGF0ZWRTdG9yZXM6IDAsDQogICAgICAgICAgICByZXRhaW5lZFVwZGF0ZXM6IDAsDQogICAgICAgICAgICBldmljdGlvbkJhdGNoZXM6IDAsDQogICAgICAgICAgICBjbGVhcnM6IDANCiAgICAgICAgfTsNCiAgICB9DQp9DQoNCi8vIOaAp+iDvee7n+iuoQ0KbGV0IHBlcmZTdGF0cyA9IHsNCiAgICBldmFsdWF0ZUJvYXJkQ291bnQ6IHsgcmVkOiAwLCBibGFjazogMCB9LA0KICAgIHByZXBhcmVTZWFyY2hJbmZvQ291bnQ6IHsgcmVkOiAwLCBibGFjazogMCB9LA0KICAgIGNhbGN1bGF0ZVRocmVhdFZhbHVlc0NvdW50OiB7IHJlZDogMCwgYmxhY2s6IDAgfSwNCiAgICBhbHBoYUJldGFDYWxsczogMCwgIC8vIOaAu+iwg+eUqOasoeaVsA0KICAgIG5vZGVzU2VhcmNoZWQ6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHmkJzntKLnmoToioLngrnmlbANCiAgICBtb3Zlc0dlbmVyYXRlZDoge30sIC8vIOaMiea3seW6pue7n+iuoeeUn+aIkOeahOi1sOazleaVsA0KICAgIGN1dG9mZnM6IHt9LCAvLyDmjInmt7Hluqbnu5/orqHliarmnp3mrKHmlbANCiAgICBtb3ZlT3JkZXJpbmc6IHsNCiAgICAgICAgdG9wTW92ZVNvdXJjZXM6IHsgdHQ6IDAsIGtpbGxlcjogMCwgY2FwdHVyZTogMCwgcXVpZXQ6IDAgfSwNCiAgICAgICAgZmlyc3RMZWdhbE1vdmVzQnlEZXB0aDoge30sDQogICAgICAgIGZpcnN0TGVnYWxDdXRvZmZzQnlEZXB0aDoge30sDQogICAgICAgIGZpcnN0TGVnYWxNb3ZlSW5kZXhUb3RhbEJ5RGVwdGg6IHt9DQogICAgfSwNCiAgICAvLyDlkIjms5XmgKfot6/lvoTvvJrkvKrlkIjms5XnlJ/miJDph4/jgIHor5XotbDlkIjms5XmgKfmo4DmtYvjgIHpnZ7ms5Xot7Pov4fjgIHlrp7pmYXov5vlhaXmkJzntKLnmoTlkIjms5XnnYANCiAgICBwc2V1ZG9Nb3Zlc0dlbmVyYXRlZDogMCwNCiAgICBsZWdhbGl0eUNoZWNrczogMCwNCiAgICBraW5nU2FmZXR5RnVsbENoZWNrczogMCwNCiAgICBraW5nU2FmZXR5RmFzdFNraXBzOiAwLA0KICAgIGtpbmdTYWZldHlWZXJpZmljYXRpb25GYWlsdXJlczogMCwNCiAgICBpbGxlZ2FsTW92ZXNTa2lwcGVkOiAwLA0KICAgIGxlZ2FsTW92ZXNTZWFyY2hlZDogMCwNCiAgICAvLyBab2JyaXN077ya5YWo55uY6YeN566X5qyh5pWwIC8g5aKe6YeP5pu05paw5qyh5pWwIC8g5qCh6aqM5LiN5LiA6Ie077yI5LuFIHZlcmlmeSDmqKHlvI/vvIkNCiAgICBmdWxsSGFzaENvdW50OiAwLA0KICAgIGluY3JlbWVudGFsSGFzaFVwZGF0ZXM6IDAsDQogICAgaGFzaE1pc21hdGNoZXM6IDAsDQogICAgZmFzdExlYWZFdmFsQ291bnQ6IDAsDQogICAgZmFzdExlYWZFdmFsTXM6IDAsDQogICAgcHJlcGFyZUNoZWNrTXM6IDAsDQogICAgcHJlcGFyZU1vdmVHZW5NczogMCwNCiAgICBzb3J0TW92ZXNDb3VudDogMCwNCiAgICBzb3J0TW92ZXNNczogMCwNCiAgICBsZWdhbGl0eUNoZWNrTXM6IDAsDQogICAgY2FwdHVyZUdlbkNvdW50OiAwLA0KICAgIGNhcHR1cmVHZW5NczogMCwNCiAgICBxdWllc2NlbmNlQ2FsbHM6IDAsDQogICAgcXVpZXNjZW5jZUNhcHR1cmVNb3ZlczogMCwNCiAgICBzdGF0aWNFdmFsQ2FjaGVIaXRzOiAwLA0KICAgIHN0YXRpY0V2YWxDYWNoZU1pc3NlczogMCwNCiAgICBwdnNQcm9iZXM6IDAsDQogICAgcHZzUmVzZWFyY2hlczogMCwNCiAgICBwdnNQcm9iZU5vZGVzOiAwLA0KICAgIHB2c1Jlc2VhcmNoTm9kZXM6IDAsDQogICAgZXZhbHVhdGVCb2FyZE1zOiAwLA0KICAgIHByZXBhcmVTZWFyY2hJbmZvTXM6IDAsDQogICAgc3RhcnRUaW1lOiBEYXRlLm5vdygpDQp9Ow0KDQovLyDph43nva7nu5/orqHvvIjmr4/mrKHmkJzntKLlvIDlp4vml7bosIPnlKjvvIkNCmNvbnN0IHJlc2V0UGVyZlN0YXRzID0gKCkgPT4gew0KICAgIGFjdGl2ZVNlYXJjaFBpZWNlU3RhdGUgPSBudWxsOw0KICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgPSB7IHJlZDogMCwgYmxhY2s6IDAgfTsNCiAgICBwZXJmU3RhdHMucHJlcGFyZVNlYXJjaEluZm9Db3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudCA9IHsgcmVkOiAwLCBibGFjazogMCB9Ow0KICAgIHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscyA9IDA7DQogICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWQgPSB7fTsNCiAgICBwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWQgPSB7fTsNCiAgICBwZXJmU3RhdHMuY3V0b2ZmcyA9IHt9Ow0KICAgIHBlcmZTdGF0cy5tb3ZlT3JkZXJpbmcgPSB7DQogICAgICAgIHRvcE1vdmVTb3VyY2VzOiB7IHR0OiAwLCBraWxsZXI6IDAsIGNhcHR1cmU6IDAsIHF1aWV0OiAwIH0sDQogICAgICAgIGZpcnN0TGVnYWxNb3Zlc0J5RGVwdGg6IHt9LA0KICAgICAgICBmaXJzdExlZ2FsQ3V0b2Zmc0J5RGVwdGg6IHt9LA0KICAgICAgICBmaXJzdExlZ2FsTW92ZUluZGV4VG90YWxCeURlcHRoOiB7fQ0KICAgIH07DQogICAgcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkID0gMDsNCiAgICBwZXJmU3RhdHMubGVnYWxpdHlDaGVja3MgPSAwOw0KICAgIHBlcmZTdGF0cy5raW5nU2FmZXR5RnVsbENoZWNrcyA9IDA7DQogICAgcGVyZlN0YXRzLmtpbmdTYWZldHlGYXN0U2tpcHMgPSAwOw0KICAgIHBlcmZTdGF0cy5raW5nU2FmZXR5VmVyaWZpY2F0aW9uRmFpbHVyZXMgPSAwOw0KICAgIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkID0gMDsNCiAgICBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkID0gMDsNCiAgICBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCA9IDA7DQogICAgcGVyZlN0YXRzLmluY3JlbWVudGFsSGFzaFVwZGF0ZXMgPSAwOw0KICAgIHBlcmZTdGF0cy5oYXNoTWlzbWF0Y2hlcyA9IDA7DQogICAgcGVyZlN0YXRzLmZhc3RMZWFmRXZhbENvdW50ID0gMDsNCiAgICBwZXJmU3RhdHMuZmFzdExlYWZFdmFsTXMgPSAwOw0KICAgIHBlcmZTdGF0cy5wcmVwYXJlQ2hlY2tNcyA9IDA7DQogICAgcGVyZlN0YXRzLnByZXBhcmVNb3ZlR2VuTXMgPSAwOw0KICAgIHBlcmZTdGF0cy5zb3J0TW92ZXNDb3VudCA9IDA7DQogICAgcGVyZlN0YXRzLnNvcnRNb3Zlc01zID0gMDsNCiAgICBwZXJmU3RhdHMubGVnYWxpdHlDaGVja01zID0gMDsNCiAgICBwZXJmU3RhdHMuY2FwdHVyZUdlbkNvdW50ID0gMDsNCiAgICBwZXJmU3RhdHMuY2FwdHVyZUdlbk1zID0gMDsNCiAgICBwZXJmU3RhdHMucXVpZXNjZW5jZUNhbGxzID0gMDsNCiAgICBwZXJmU3RhdHMucXVpZXNjZW5jZUNhcHR1cmVNb3ZlcyA9IDA7DQogICAgcGVyZlN0YXRzLnN0YXRpY0V2YWxDYWNoZUhpdHMgPSAwOw0KICAgIHBlcmZTdGF0cy5zdGF0aWNFdmFsQ2FjaGVNaXNzZXMgPSAwOw0KICAgIHBlcmZTdGF0cy5wdnNQcm9iZXMgPSAwOw0KICAgIHBlcmZTdGF0cy5wdnNSZXNlYXJjaGVzID0gMDsNCiAgICBwZXJmU3RhdHMucHZzUHJvYmVOb2RlcyA9IDA7DQogICAgcGVyZlN0YXRzLnB2c1Jlc2VhcmNoTm9kZXMgPSAwOw0KICAgIHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMgPSAwOw0KICAgIHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zID0gMDsNCiAgICBwZXJmU3RhdHMuc3RhcnRUaW1lID0gRGF0ZS5ub3coKTsNCn07DQoNCmNvbnN0IHNuYXBzaG90UGVyZlN0YXRzID0gKCkgPT4gew0KICAgIGNvbnN0IGVsYXBzZWQgPSBEYXRlLm5vdygpIC0gcGVyZlN0YXRzLnN0YXJ0VGltZTsNCiAgICBjb25zdCB0dFN0YXRzID0gdHJhbnNwb3NpdGlvblRhYmxlLmdldFN0YXRzKCk7DQogICAgY29uc3QgZGVwdGhzID0gT2JqZWN0LmtleXMocGVyZlN0YXRzLm5vZGVzU2VhcmNoZWQpLnNvcnQoKGEsIGIpID0+IE51bWJlcihhKSAtIE51bWJlcihiKSk7DQogICAgY29uc3QgYnlEZXB0aCA9IHt9Ow0KICAgIGZvciAoY29uc3QgZCBvZiBkZXB0aHMpIHsNCiAgICAgICAgYnlEZXB0aFtkXSA9IHsNCiAgICAgICAgICAgIG5vZGVzOiBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSB8fCAwLA0KICAgICAgICAgICAgbW92ZXM6IHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSB8fCAwLA0KICAgICAgICAgICAgY3V0b2ZmczogcGVyZlN0YXRzLmN1dG9mZnNbZF0gfHwgMA0KICAgICAgICB9Ow0KICAgIH0NCiAgICByZXR1cm4gew0KICAgICAgICBlbGFwc2VkTXM6IGVsYXBzZWQsDQogICAgICAgIHByb2ZpbGU6IFNFQVJDSF9QUk9GSUxFLA0KICAgICAgICBldmFsdWF0ZUJvYXJkOiB7IC4uLnBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkQ291bnQgfSwNCiAgICAgICAgcHJlcGFyZVNlYXJjaEluZm86IHsgLi4ucGVyZlN0YXRzLnByZXBhcmVTZWFyY2hJbmZvQ291bnQgfSwNCiAgICAgICAgY2FsY3VsYXRlVGhyZWF0VmFsdWVzOiB7IC4uLnBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudCB9LA0KICAgICAgICBhbHBoYUJldGFDYWxsczogcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzLA0KICAgICAgICBwc2V1ZG9Nb3Zlc0dlbmVyYXRlZDogcGVyZlN0YXRzLnBzZXVkb01vdmVzR2VuZXJhdGVkLA0KICAgICAgICBsZWdhbGl0eUNoZWNrczogcGVyZlN0YXRzLmxlZ2FsaXR5Q2hlY2tzLA0KICAgICAgICBraW5nU2FmZXR5OiBTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTID8gew0KICAgICAgICAgICAgZmFzdFBhdGhFbmFibGVkOiBTRUFSQ0hfRU5BQkxFX0tJTkdfU0FGRVRZX0ZBU1RfUEFUSCwNCiAgICAgICAgICAgIGZ1bGxDaGVja3M6IHBlcmZTdGF0cy5raW5nU2FmZXR5RnVsbENoZWNrcywNCiAgICAgICAgICAgIGZhc3RTa2lwczogcGVyZlN0YXRzLmtpbmdTYWZldHlGYXN0U2tpcHMsDQogICAgICAgICAgICB2ZXJpZmljYXRpb25GYWlsdXJlczogcGVyZlN0YXRzLmtpbmdTYWZldHlWZXJpZmljYXRpb25GYWlsdXJlcywNCiAgICAgICAgICAgIHNraXBSYXRlOiBwZXJmU3RhdHMubGVnYWxpdHlDaGVja3MNCiAgICAgICAgICAgICAgICA/IE51bWJlcigocGVyZlN0YXRzLmtpbmdTYWZldHlGYXN0U2tpcHMgLyBwZXJmU3RhdHMubGVnYWxpdHlDaGVja3MgKiAxMDApLnRvRml4ZWQoMikpDQogICAgICAgICAgICAgICAgOiAwDQogICAgICAgIH0gOiBudWxsLA0KICAgICAgICBpbGxlZ2FsTW92ZXNTa2lwcGVkOiBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCwNCiAgICAgICAgbGVnYWxNb3Zlc1NlYXJjaGVkOiBwZXJmU3RhdHMubGVnYWxNb3Zlc1NlYXJjaGVkLA0KICAgICAgICBmdWxsSGFzaENvdW50OiBwZXJmU3RhdHMuZnVsbEhhc2hDb3VudCwNCiAgICAgICAgaW5jcmVtZW50YWxIYXNoVXBkYXRlczogcGVyZlN0YXRzLmluY3JlbWVudGFsSGFzaFVwZGF0ZXMsDQogICAgICAgIGhhc2hNaXNtYXRjaGVzOiBwZXJmU3RhdHMuaGFzaE1pc21hdGNoZXMsDQogICAgICAgIGZhc3RMZWFmRXZhbENvdW50OiBwZXJmU3RhdHMuZmFzdExlYWZFdmFsQ291bnQsDQogICAgICAgIGZhc3RMZWFmRXZhbE1zOiBwZXJmU3RhdHMuZmFzdExlYWZFdmFsTXMsDQogICAgICAgIHByZXBhcmVDaGVja01zOiBwZXJmU3RhdHMucHJlcGFyZUNoZWNrTXMsDQogICAgICAgIHByZXBhcmVNb3ZlR2VuTXM6IHBlcmZTdGF0cy5wcmVwYXJlTW92ZUdlbk1zLA0KICAgICAgICBzb3J0TW92ZXNDb3VudDogcGVyZlN0YXRzLnNvcnRNb3Zlc0NvdW50LA0KICAgICAgICBzb3J0TW92ZXNNczogcGVyZlN0YXRzLnNvcnRNb3Zlc01zLA0KICAgICAgICBsZWdhbGl0eUNoZWNrTXM6IHBlcmZTdGF0cy5sZWdhbGl0eUNoZWNrTXMsDQogICAgICAgIGNhcHR1cmVHZW5Db3VudDogcGVyZlN0YXRzLmNhcHR1cmVHZW5Db3VudCwNCiAgICAgICAgY2FwdHVyZUdlbk1zOiBwZXJmU3RhdHMuY2FwdHVyZUdlbk1zLA0KICAgICAgICBxdWllc2NlbmNlQ2FsbHM6IHBlcmZTdGF0cy5xdWllc2NlbmNlQ2FsbHMsDQogICAgICAgIHF1aWVzY2VuY2VDYXB0dXJlTW92ZXM6IHBlcmZTdGF0cy5xdWllc2NlbmNlQ2FwdHVyZU1vdmVzLA0KICAgICAgICBzdGF0aWNFdmFsQ2FjaGVIaXRzOiBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlSGl0cywNCiAgICAgICAgc3RhdGljRXZhbENhY2hlTWlzc2VzOiBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlTWlzc2VzLA0KICAgICAgICBwdnM6IFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MgPyB7DQogICAgICAgICAgICBlbmFibGVkOiBTRUFSQ0hfRU5BQkxFX05PTl9ST09UX1BWUywNCiAgICAgICAgICAgIHByb2JlczogcGVyZlN0YXRzLnB2c1Byb2JlcywNCiAgICAgICAgICAgIHJlc2VhcmNoZXM6IHBlcmZTdGF0cy5wdnNSZXNlYXJjaGVzLA0KICAgICAgICAgICAgcmVzZWFyY2hSYXRlOiBwZXJmU3RhdHMucHZzUHJvYmVzDQogICAgICAgICAgICAgICAgPyBOdW1iZXIoKHBlcmZTdGF0cy5wdnNSZXNlYXJjaGVzIC8gcGVyZlN0YXRzLnB2c1Byb2JlcyAqIDEwMCkudG9GaXhlZCgyKSkNCiAgICAgICAgICAgICAgICA6IDAsDQogICAgICAgICAgICBwcm9iZU5vZGVzOiBwZXJmU3RhdHMucHZzUHJvYmVOb2RlcywNCiAgICAgICAgICAgIHJlc2VhcmNoTm9kZXM6IHBlcmZTdGF0cy5wdnNSZXNlYXJjaE5vZGVzDQogICAgICAgIH0gOiBudWxsLA0KICAgICAgICBldmFsdWF0ZUJvYXJkTXM6IHBlcmZTdGF0cy5ldmFsdWF0ZUJvYXJkTXMsDQogICAgICAgIHByZXBhcmVTZWFyY2hJbmZvTXM6IHBlcmZTdGF0cy5wcmVwYXJlU2VhcmNoSW5mb01zLA0KICAgICAgICBtb3ZlT3JkZXJpbmc6IFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MgPyB7DQogICAgICAgICAgICB0b3BNb3ZlU291cmNlczogeyAuLi5wZXJmU3RhdHMubW92ZU9yZGVyaW5nLnRvcE1vdmVTb3VyY2VzIH0sDQogICAgICAgICAgICBieURlcHRoOiBPYmplY3QuZnJvbUVudHJpZXMoZGVwdGhzLm1hcCgoZCkgPT4gew0KICAgICAgICAgICAgICAgIGNvbnN0IGZpcnN0TGVnYWxNb3ZlcyA9IHBlcmZTdGF0cy5tb3ZlT3JkZXJpbmcuZmlyc3RMZWdhbE1vdmVzQnlEZXB0aFtkXSB8fCAwOw0KICAgICAgICAgICAgICAgIGNvbnN0IGZpcnN0TGVnYWxDdXRvZmZzID0gcGVyZlN0YXRzLm1vdmVPcmRlcmluZy5maXJzdExlZ2FsQ3V0b2Zmc0J5RGVwdGhbZF0gfHwgMDsNCiAgICAgICAgICAgICAgICByZXR1cm4gW2QsIHsNCiAgICAgICAgICAgICAgICAgICAgZmlyc3RMZWdhbE1vdmVzLA0KICAgICAgICAgICAgICAgICAgICBmaXJzdExlZ2FsQ3V0b2ZmcywNCiAgICAgICAgICAgICAgICAgICAgZmlyc3RMZWdhbEN1dG9mZlJhdGU6IGZpcnN0TGVnYWxNb3Zlcw0KICAgICAgICAgICAgICAgICAgICAgICAgPyBOdW1iZXIoKGZpcnN0TGVnYWxDdXRvZmZzIC8gZmlyc3RMZWdhbE1vdmVzICogMTAwKS50b0ZpeGVkKDIpKQ0KICAgICAgICAgICAgICAgICAgICAgICAgOiAwLA0KICAgICAgICAgICAgICAgICAgICBhdmVyYWdlRmlyc3RMZWdhbE1vdmVJbmRleDogZmlyc3RMZWdhbE1vdmVzDQogICAgICAgICAgICAgICAgICAgICAgICA/IE51bWJlcigocGVyZlN0YXRzLm1vdmVPcmRlcmluZy5maXJzdExlZ2FsTW92ZUluZGV4VG90YWxCeURlcHRoW2RdIC8gZmlyc3RMZWdhbE1vdmVzKS50b0ZpeGVkKDIpKQ0KICAgICAgICAgICAgICAgICAgICAgICAgOiAwDQogICAgICAgICAgICAgICAgfV07DQogICAgICAgICAgICB9KSkNCiAgICAgICAgfSA6IG51bGwsDQogICAgICAgIHR0OiB0dFN0YXRzLA0KICAgICAgICBieURlcHRoDQogICAgfTsNCn07DQoNCi8vIOaJk+WNsOe7n+iuoeS/oeaBrw0KY29uc3QgbG9nUGVyZlN0YXRzID0gKGN1cnJlbnRQbGF5ZXIpID0+IHsNCiAgICBjb25zdCBzbmFwID0gc25hcHNob3RQZXJmU3RhdHMoKTsNCiAgICBjb25zb2xlLmxvZyhgU2VhcmNoIHN0YXRzICgke2N1cnJlbnRQbGF5ZXJ9KTogJHtzbmFwLmVsYXBzZWRNc31tcywgbm9kZXM9JHtzbmFwLmFscGhhQmV0YUNhbGxzfSwgbGVnYWw9JHtzbmFwLmxlZ2FsTW92ZXNTZWFyY2hlZH0sIGxlYXZlcz0ke3NuYXAuZmFzdExlYWZFdmFsQ291bnR9YCk7DQogICAgY29uc29sZS5sb2coYFRUOiAke3NuYXAudHQuaGl0c30vJHtzbmFwLnR0Lm1pc3Nlc30gKCR7c25hcC50dC5oaXRSYXRlfSUpLCBzdG9yZXM9JHtzbmFwLnR0LnN0b3Jlc30sIHNpemU9JHtzbmFwLnR0LmN1cnJlbnRTaXplfWApOw0KfTsNCg0KY29uc3QgdHJhbnNwb3NpdGlvblRhYmxlID0gbmV3IFRyYW5zcG9zaXRpb25UYWJsZSgpOw0KDQovLyDlj7bor4TkvLDnvJPlrZjvvIjlrozmlbTlvaLlir/liIbvvInvvJrlrprplb/nm7TmjqXmmKDlsITvvIzlrozmlbQga2V5IOagoemqjOmBv+WFjeanveS9jeWGsueqgeivr+WRveS4reOAggovLyBnZW5lcmF0aW9uIOiuqeavj+asoeaQnOe0oueahCBjbGVhciDkv53mjIEgTygxKe+8jOS5n+mBv+WFjSBNYXAg5ruh6L295ZCO55qE5om56YePIGRlbGV0ZeOAggpjb25zdCBFVkFMX0NBQ0hFX1NJWkUgPSAxIDw8IDIwOwpjb25zdCBFVkFMX0NBQ0hFX01BU0sgPSBFVkFMX0NBQ0hFX1NJWkUgLSAxOwpjb25zdCBldmFsQ2FjaGVLZXlzID0gbmV3IEludDMyQXJyYXkoRVZBTF9DQUNIRV9TSVpFKTsKY29uc3QgZXZhbENhY2hlVmVyaWZpY2F0aW9uS2V5cyA9IG5ldyBJbnQzMkFycmF5KEVWQUxfQ0FDSEVfU0laRSk7CmNvbnN0IGV2YWxDYWNoZVZhbHVlcyA9IG5ldyBGbG9hdDY0QXJyYXkoRVZBTF9DQUNIRV9TSVpFKTsKY29uc3QgZXZhbENhY2hlR2VuZXJhdGlvbnMgPSBuZXcgVWludDMyQXJyYXkoRVZBTF9DQUNIRV9TSVpFKTsKbGV0IGV2YWxDYWNoZUdlbmVyYXRpb24gPSAxOwpjb25zdCBjbGVhckV2YWxDYWNoZSA9ICgpID0+IHsKICAgIGV2YWxDYWNoZUdlbmVyYXRpb24gPSAoZXZhbENhY2hlR2VuZXJhdGlvbiArIDEpID4+PiAwOwogICAgaWYgKGV2YWxDYWNoZUdlbmVyYXRpb24gPT09IDApIHsKICAgICAgICBldmFsQ2FjaGVHZW5lcmF0aW9uID0gMTsKICAgICAgICBldmFsQ2FjaGVHZW5lcmF0aW9ucy5maWxsKDApOwogICAgfQp9OwoNCi8vIOWJquaeneW8gOWFs++8muWujOaVtOivhOS8sOS4i+iLpeW8gOWxgOWHuuW6n+aji+WImeWFiOWFs++8jOS/neaji+WKm+WGjemHjeagh+Wumg0KY29uc3QgU0VBUkNIX1FVSUVTQ0VOQ0VfREVQVEggPSAyOw0KY29uc3QgU0VBUkNIX05VTExfV0lORE9XX0VQUyA9IDFlLTY7DQpsZXQgU0VBUkNIX0NPTExFQ1RfTUVUUklDUyA9IGZhbHNlOw0KbGV0IFNFQVJDSF9FTkFCTEVfTk9OX1JPT1RfUFZTID0gZmFsc2U7DQpsZXQgU0VBUkNIX0VOQUJMRV9LSU5HX1NBRkVUWV9GQVNUX1BBVEggPSB0cnVlOw0KbGV0IFNFQVJDSF9WRVJJRllfS0lOR19TQUZFVFlfRkFTVF9QQVRIID0gZmFsc2U7DQoNCi8vIOedgOazleWQiOazleaAp++8mnRydWU95pCc57Si5YaF6K+V6LWw5pe25qOA5rWL77yI5Y+v6Lez6L+H5Ymq5p6d5pyq6Kem5Y+K552A5rOV77yJ77ybZmFsc2U9cHJlcGFyZSDml7blhajph48gZmlsdGVyTGVnYWxNb3Zlc++8iOaXp+i3r+W+hO+8iQ0KbGV0IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPSB0cnVlOw0KDQovLyBab2JyaXN0L1RU77yadHJ1ZT3mkJzntKLlhoXlop7ph4/nu7TmiqTlsYDpnaLlk4jluIwgKyDmlbDlgLwgVFQga2V577ybZmFsc2U95q+P6IqC54K55YWo55uYIGhhc2ggKyDlrZfnrKbkuLIga2V577yI5pen6Lev5b6E77yM5L6/5LqOIEEvQu+8iQ0KLy8g6LCD6K+V77ya5aKe6YeP5ZCO5LiO5YWo55uYIGhhc2gg5q+U5a+577yI5LuF5qCh6aqM6ISa5pys5byA5ZCv77yM5q2j5byP5pCc57Si5YWz6Zet77yJDQoNCi8vIOaQnOe0ouWQr+WPke+8muadgOaji+ihqCArIOWOhuWPsuWQr+WPke+8iOavj+asoSBnZXRCZXN0TW92ZSDph43nva7vvIkNCmxldCBraWxsZXJNb3ZlcyA9IFtdOw0KbGV0IGhpc3RvcnlUYWJsZSA9IG51bGw7DQoNCmNvbnN0IHJlc2V0U2VhcmNoSGV1cmlzdGljcyA9IChtYXhEZXB0aCkgPT4gew0KICAgIGtpbGxlck1vdmVzID0gQXJyYXkobWF4RGVwdGggKyAyKS5maWxsKG51bGwpLm1hcCgoKSA9PiBbbnVsbCwgbnVsbF0pOw0KICAgIGhpc3RvcnlUYWJsZSA9IG5ldyBJbnQzMkFycmF5KFJFTF9TUVVBUkVTIDw8IDcpOw0KfTsNCg0KY29uc3QgaXNTYW1lTW92ZSA9IChhLCBiKSA9Pg0KICAgIGEgIT0gbnVsbCAmJiBiICE9IG51bGwgJiYNCiAgICBtb3ZlRnJvbVNxKGEpID09PSBtb3ZlRnJvbVNxKGIpICYmDQogICAgbW92ZVRvU3EoYSkgPT09IG1vdmVUb1NxKGIpOw0KDQpjb25zdCBzdG9yZUtpbGxlck1vdmUgPSAoZGVwdGgsIG1vdmUpID0+IHsNCiAgICBpZiAoZGVwdGggPCAwIHx8IGRlcHRoID49IGtpbGxlck1vdmVzLmxlbmd0aCB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGNvbnN0IHNsb3QgPSBraWxsZXJNb3Zlc1tkZXB0aF07DQogICAgaWYgKGlzU2FtZU1vdmUoc2xvdFswXSwgbW92ZSkpIHJldHVybjsNCiAgICBzbG90WzFdID0gc2xvdFswXTsNCiAgICBzbG90WzBdID0gaXNFbmNvZGVkTW92ZShtb3ZlKSA/IG1vdmUgOiBlbmNvZGVNb3ZlKG1vdmUuZnJvbSwgbW92ZS50byk7DQp9Ow0KDQpjb25zdCBhZGRIaXN0b3J5U2NvcmUgPSAobW92ZSwgZGVwdGgpID0+IHsNCiAgICBpZiAoIWhpc3RvcnlUYWJsZSB8fCAhbW92ZSkgcmV0dXJuOw0KICAgIGNvbnN0IGtleSA9IChtb3ZlRnJvbVNxKG1vdmUpIDw8IDcpIHwgbW92ZVRvU3EobW92ZSk7DQogICAgaGlzdG9yeVRhYmxlW2tleV0gKz0gZGVwdGggKiBkZXB0aDsNCn07DQoNCmNvbnN0IGdldEhpc3RvcnlTY29yZSA9IChtb3ZlKSA9PiB7DQogICAgaWYgKCFoaXN0b3J5VGFibGUgfHwgIW1vdmUpIHJldHVybiAwOw0KICAgIHJldHVybiBoaXN0b3J5VGFibGVbKG1vdmVGcm9tU3EobW92ZSkgPDwgNykgfCBtb3ZlVG9TcShtb3ZlKV07DQp9Ow0KDQpjb25zdCByZWNvcmRUb3BNb3ZlU291cmNlID0gKGRlcHRoLCBib2FyZCwgbW92ZSwgdHRNb3ZlLCBraWxsZXJzKSA9PiB7DQogICAgY29uc3Qgc291cmNlcyA9IHBlcmZTdGF0cy5tb3ZlT3JkZXJpbmcudG9wTW92ZVNvdXJjZXM7DQogICAgaWYgKGlzU2FtZU1vdmUobW92ZSwgdHRNb3ZlKSkgc291cmNlcy50dCsrOw0KICAgIGVsc2UgaWYgKGlzU2FtZU1vdmUobW92ZSwga2lsbGVyc1swXSkgfHwgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzWzFdKSkgc291cmNlcy5raWxsZXIrKzsNCiAgICBlbHNlIGlmIChib2FyZFttb3ZlVG9SKG1vdmUpXVttb3ZlVG9DKG1vdmUpXSkgc291cmNlcy5jYXB0dXJlKys7DQogICAgZWxzZSBzb3VyY2VzLnF1aWV0Kys7DQp9Ow0KDQpjb25zdCByZWNvcmRGaXJzdExlZ2FsTW92ZSA9IChkZXB0aCwgbW92ZUluZGV4KSA9PiB7DQogICAgY29uc3Qgb3JkZXJpbmcgPSBwZXJmU3RhdHMubW92ZU9yZGVyaW5nOw0KICAgIG9yZGVyaW5nLmZpcnN0TGVnYWxNb3Zlc0J5RGVwdGhbZGVwdGhdID0gKG9yZGVyaW5nLmZpcnN0TGVnYWxNb3Zlc0J5RGVwdGhbZGVwdGhdIHx8IDApICsgMTsNCiAgICBvcmRlcmluZy5maXJzdExlZ2FsTW92ZUluZGV4VG90YWxCeURlcHRoW2RlcHRoXSA9DQogICAgICAgIChvcmRlcmluZy5maXJzdExlZ2FsTW92ZUluZGV4VG90YWxCeURlcHRoW2RlcHRoXSB8fCAwKSArIG1vdmVJbmRleDsNCn07DQoNCmNvbnN0IHJlY29yZEZpcnN0TGVnYWxDdXRvZmYgPSAoZGVwdGgpID0+IHsNCiAgICBjb25zdCBjdXRvZmZzID0gcGVyZlN0YXRzLm1vdmVPcmRlcmluZy5maXJzdExlZ2FsQ3V0b2Zmc0J5RGVwdGg7DQogICAgY3V0b2Zmc1tkZXB0aF0gPSAoY3V0b2Zmc1tkZXB0aF0gfHwgMCkgKyAxOw0KfTsNCg0KLy8gV29ya2VyIG1lc3NhZ2UgaGFuZGxpbmcNCmlmICh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcpIHsNCiAgICBzZWxmLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKGUpIHsNCiAgICBjb25zdCB7IHR5cGUsIHBheWxvYWQgfSA9IGUuZGF0YTsNCiAgICANCiAgICBzd2l0Y2ggKHR5cGUpIHsgICAgICAgICAgICANCiAgICAgICAgY2FzZSAnU0VBUkNIJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogc2VhcmNoQm9hcmQsIHR1cm46IHNlYXJjaFR1cm4sIGRlcHRoOiBzZWFyY2hEZXB0aCwgZ2FtZUlkLCBvcGVuaW5nQm9va0VuYWJsZWQ6IHNlYXJjaE9wZW5pbmdCb29rRW5hYmxlZCA9IHRydWUsIHBseTogc2VhcmNoUGx5ID0gMCwgZW5hYmxlVGltZUxpbWl0OiBzZWFyY2hFbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzOiBzZWFyY2hFeGFjdFJvb3RTY29yZXMgPSBmYWxzZSwgcHJvZmlsZTogc2VhcmNoUHJvZmlsZSwgbWV0cmljczogc2VhcmNoTWV0cmljcyA9IGZhbHNlLCBub25Sb290UHZzOiBzZWFyY2hOb25Sb290UHZzID0gZmFsc2UsIGtpbmdTYWZldHlGYXN0UGF0aDogc2VhcmNoS2luZ1NhZmV0eUZhc3RQYXRoID0gdHJ1ZSwgdmVyaWZ5S2luZ1NhZmV0eUZhc3RQYXRoOiBzZWFyY2hWZXJpZnlLaW5nU2FmZXR5RmFzdFBhdGggPSBmYWxzZSwgY29sbGVjdE1vdmVTZXF1ZW5jZTogc2VhcmNoQ29sbGVjdE1vdmVTZXF1ZW5jZSB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIFNFQVJDSF9QUk9GSUxFID0gISFzZWFyY2hQcm9maWxlOw0KICAgICAgICAgICAgU0VBUkNIX0NPTExFQ1RfTUVUUklDUyA9ICEhc2VhcmNoTWV0cmljczsNCiAgICAgICAgICAgIFNFQVJDSF9FTkFCTEVfTk9OX1JPT1RfUFZTID0gISFzZWFyY2hOb25Sb290UHZzOw0KICAgICAgICAgICAgU0VBUkNIX0VOQUJMRV9LSU5HX1NBRkVUWV9GQVNUX1BBVEggPSAhIXNlYXJjaEtpbmdTYWZldHlGYXN0UGF0aDsNCiAgICAgICAgICAgIFNFQVJDSF9WRVJJRllfS0lOR19TQUZFVFlfRkFTVF9QQVRIID0gISFzZWFyY2hWZXJpZnlLaW5nU2FmZXR5RmFzdFBhdGg7DQogICAgICAgICAgICAvLyBTZXQgb3BlbmluZyBib29rIGVuYWJsZWQgc3RhdHVzDQogICAgICAgICAgICBvcGVuaW5nQm9vay5zZXRFbmFibGVkKHNlYXJjaE9wZW5pbmdCb29rRW5hYmxlZCk7DQogICAgICAgICAgICAvLyDorrDlvZXmkJzntKLlvIDlp4vml7bpl7QNCiAgICAgICAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IHBlcmZvcm1hbmNlLm5vdygpOw0KICAgICAgICAgICAgLy8g5omn6KGM5pCc57SiDQogICAgICAgICAgICBjb25zdCBiZXN0U2VhcmNoTW92ZSA9IGdldEJlc3RNb3ZlKHNlYXJjaEJvYXJkLCBzZWFyY2hUdXJuLCBzZWFyY2hEZXB0aCwgc2VhcmNoUGx5LCBzZWFyY2hFbmFibGVUaW1lTGltaXQsIHNlYXJjaEV4YWN0Um9vdFNjb3Jlcywgc2VhcmNoQ29sbGVjdE1vdmVTZXF1ZW5jZSk7DQogICAgICAgICAgICAvLyDorrDlvZXmkJzntKLnu5PmnZ/ml7bpl7TlubborqHnrpfmgJ3ogIPml7bpl7QNCiAgICAgICAgICAgIGNvbnN0IGVuZFRpbWUgPSBwZXJmb3JtYW5jZS5ub3coKTsNCiAgICAgICAgICAgIGNvbnN0IHRoaW5raW5nVGltZSA9IGVuZFRpbWUgLSBzdGFydFRpbWU7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOajgOafpeaYr+WQpuadpeiHquW8gOWxgOW6kw0KICAgICAgICAgICAgY29uc3QgYm9va01vdmVTZWFyY2ggPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShzZWFyY2hCb2FyZCwgc2VhcmNoUGx5KTsNCiAgICAgICAgICAgIGNvbnN0IGZyb21Cb29rU2VhcmNoID0gISFib29rTW92ZVNlYXJjaCAmJiBKU09OLnN0cmluZ2lmeShib29rTW92ZVNlYXJjaCkgPT09IEpTT04uc3RyaW5naWZ5KGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlKTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5re75Yqg5oCn6IO957uf6K6h5pel5b+XDQogICAgICAgICAgICBsb2dQZXJmU3RhdHMoc2VhcmNoVHVybik7DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOa3u+WKoOaAneiAg+aXtumXtOaXpeW/lw0KICAgICAgICAgICAgY29uc3QgZm9ybWF0TW92ZSA9IChtb3ZlKSA9PiBtb3ZlPy5mcm9tICYmIG1vdmU/LnRvDQogICAgICAgICAgICAgICAgPyBgKCR7bW92ZS5mcm9tLnJ9LCR7bW92ZS5mcm9tLmN9KS0+KCR7bW92ZS50by5yfSwke21vdmUudG8uY30pYA0KICAgICAgICAgICAgICAgIDogJ25vbmUnOw0KICAgICAgICAgICAgY29uc29sZS5sb2coYFNlYXJjaCBjb21wbGV0ZTogZ2FtZT0ke2dhbWVJZH0sIHRpbWU9JHtNYXRoLnJvdW5kKHRoaW5raW5nVGltZSl9bXMsIGJlc3Q9JHtmb3JtYXRNb3ZlKGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlKX0gc2NvcmU9JHtiZXN0U2VhcmNoTW92ZS5iZXN0TW92ZVNjb3JlfSwgc2Vjb25kPSR7Zm9ybWF0TW92ZShiZXN0U2VhcmNoTW92ZS5zZWNvbmRCZXN0TW92ZSl9LCBib29rPSR7ZnJvbUJvb2tTZWFyY2h9YCk7DQogICAgICAgICAgICAvLyDlj5HpgIHmkJzntKLnu5PmnpzlkozmgJ3ogIPml7bpl7QNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnU0VBUkNIX0NPTVBMRVRFJywgDQogICAgICAgICAgICAgICAgcGF5bG9hZDogeyANCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmU6IGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlLCANCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kQmVzdE1vdmU6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlLCANCiAgICAgICAgICAgICAgICAgICAgZ2FtZUlkLCANCiAgICAgICAgICAgICAgICAgICAgZnJvbUJvb2s6IGZyb21Cb29rU2VhcmNoLCANCiAgICAgICAgICAgICAgICAgICAgdGhpbmtpbmdUaW1lOiBNYXRoLnJvdW5kKHRoaW5raW5nVGltZSksIC8vIOWbm+iIjeS6lOWFpeWIsOavq+enkg0KICAgICAgICAgICAgICAgICAgICBtb3ZlU2VxdWVuY2U6IGJlc3RTZWFyY2hNb3ZlLm1vdmVTZXF1ZW5jZSwNCiAgICAgICAgICAgICAgICAgICAgc2Vjb25kTW92ZVNlcXVlbmNlOiBiZXN0U2VhcmNoTW92ZS5zZWNvbmRNb3ZlU2VxdWVuY2UsDQogICAgICAgICAgICAgICAgICAgIGJlc3RNb3ZlU2NvcmU6IGJlc3RTZWFyY2hNb3ZlLmJlc3RNb3ZlU2NvcmUsDQogICAgICAgICAgICAgICAgICAgIHNlY29uZEJlc3RNb3ZlU2NvcmU6IGJlc3RTZWFyY2hNb3ZlLnNlY29uZEJlc3RNb3ZlU2NvcmUsDQogICAgICAgICAgICAgICAgICAgIGFsbE1vdmVzV2l0aFNjb3JlczogYmVzdFNlYXJjaE1vdmUuYWxsTW92ZXNXaXRoU2NvcmVzIHx8IFtdLA0KICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWREZXB0aDogYmVzdFNlYXJjaE1vdmUuY29tcGxldGVkRGVwdGgsDQogICAgICAgICAgICAgICAgICAgIHBlcmY6IHNuYXBzaG90UGVyZlN0YXRzKCkNCiAgICAgICAgICAgICAgICB9IA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICBjYXNlICdnZXRWYWxpZE1vdmVzJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogdm1Cb2FyZCwgcG9zOiB2bVBvcyB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIHN5bmNHZW5lcmFsUG9zQ2FjaGUodm1Cb2FyZCk7DQogICAgICAgICAgICBjb25zdCB2YWxpZE1vdmVzID0gZ2V0VmFsaWRNb3Zlcyh2bUJvYXJkLCB2bVBvcyk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICB0eXBlOiAndmFsaWRNb3ZlcycsDQogICAgICAgICAgICAgICAgbW92ZXM6IHZhbGlkTW92ZXMNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdnZXRQaWVjZVJlbGF0aW9ucyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IHByQm9hcmQsIHBvczogcHJQb3MgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IHByQm9hcmRbcHJQb3Mucl1bcHJQb3MuY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIC8vIOiwg+eUqGV2YWx1YXRlQm9hcmTojrflj5blrozmlbTnmoTmo4vlrZDkv6Hmga/lkoxib2FyZEluZm8NCiAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7DQogICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkRXZhbHVhdGlvbiA9IGV2YWx1YXRlQm9hcmQocHJCb2FyZCwgbnVsbCwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIGNvbnN0IHBpZWNlc0luZm8gPSBib2FyZEV2YWx1YXRpb24ucGllY2VzSW5mbzsNCiAgICAgICAgICAgIGNvbnN0IGJvYXJkSW5mbyA9IGJvYXJkRXZhbHVhdGlvbi5ib2FyZEluZm87DQoNCiAgICAgICAgICAgIGlmIChib2FyZEluZm8udXNlUmVsYXRpb25NYXNrcykgew0KICAgICAgICAgICAgICAgIGh5ZHJhdGVSZWxhdGlvbnNGcm9tTWFza3MocGllY2VzSW5mbywgYm9hcmRJbmZvKTsNCiAgICAgICAgICAgIH0NCg0KICAgICAgICAgICAgLy8gYm9hcmRJbmZvIOagvOWGheWPr+iDveaYryBwaWVjZXNJbmZvIOW8leeUqO+8jOe7n+S4gOaYoOWwhOS4uiB7cixjfSDkvpsgVUkg5L2/55SoDQogICAgICAgICAgICBjb25zdCByYXdDb250cm9sbGVycyA9IGJvYXJkSW5mby5jb250cm9sbGVyR3JpZA0KICAgICAgICAgICAgICAgID8gKGJvYXJkSW5mby5jb250cm9sbGVyR3JpZFtwclBvcy5yXVtwclBvcy5jXSB8fCBbXSkNCiAgICAgICAgICAgICAgICA6IChib2FyZEluZm9bcHJQb3Mucl0gJiYgYm9hcmRJbmZvW3ByUG9zLnJdW3ByUG9zLmNdKSB8fCBbXTsNCiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJzID0gcmF3Q29udHJvbGxlcnMubWFwKChjdHJsKSA9PiAoeyByOiBjdHJsLnIsIGM6IGN0cmwuYyB9KSk7DQogICAgICAgICAgICANCiAgICAgICAgICAgIGxldCByZWxhdGlvbnMgPSB7DQogICAgICAgICAgICAgICAgdGhyZWF0OiBbXSwgDQogICAgICAgICAgICAgICAgdGhyZWF0ZW5lZEJ5OiBbXSwgDQogICAgICAgICAgICAgICAgZ3VhcmQ6IFtdLCANCiAgICAgICAgICAgICAgICBndWFyZGVkQnk6IFtdLCANCiAgICAgICAgICAgICAgICBjb250cm9sOiBbXSwNCiAgICAgICAgICAgICAgICBjb250cm9sbGVycw0KICAgICAgICAgICAgfTsNCiAgICAgICAgICAgIA0KICAgICAgICAgICAgLy8g5aaC5p6c54K55Ye755qE5piv5qOL5a2Q77yM6L+U5Zue6K+l5qOL5a2Q55qE5YWz57O75L+h5oGvDQogICAgICAgICAgICBpZiAocGllY2UpIHsNCiAgICAgICAgICAgICAgICAvLyBGaW5kIHRoZSBjdXJyZW50IHBpZWNlIGluZm8NCiAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50UGllY2VJbmZvID0gcGllY2VzSW5mby5maW5kKHAgPT4gcC5yID09PSBwclBvcy5yICYmIHAuYyA9PT0gcHJQb3MuYyk7DQogICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRQaWVjZUluZm8pIHsNCiAgICAgICAgICAgICAgICAgICAgLy8gRXh0cmFjdCByZWxhdGlvbnMNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGhyZWF0ID0gY3VycmVudFBpZWNlSW5mby50aHJlYXQubWFwKHRocmVhdFBpZWNlID0+ICh7IHI6IHRocmVhdFBpZWNlLnIsIGM6IHRocmVhdFBpZWNlLmMgfSkpOw0KICAgICAgICAgICAgICAgICAgICBjb25zdCB0aHJlYXRlbmVkQnkgPSBjdXJyZW50UGllY2VJbmZvLnRocmVhdGVuZWRCeS5tYXAodGhyZWF0ZW5lZEJ5UGllY2UgPT4gKHsgcjogdGhyZWF0ZW5lZEJ5UGllY2UuciwgYzogdGhyZWF0ZW5lZEJ5UGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGd1YXJkID0gY3VycmVudFBpZWNlSW5mby5ndWFyZC5tYXAoZ3VhcmRQaWVjZSA9PiAoeyByOiBndWFyZFBpZWNlLnIsIGM6IGd1YXJkUGllY2UuYyB9KSk7DQogICAgICAgICAgICAgICAgICAgIGNvbnN0IGd1YXJkZWRCeSA9IGN1cnJlbnRQaWVjZUluZm8uZ3VhcmRlZEJ5Lm1hcChndWFyZGVkQnlQaWVjZSA9PiAoeyByOiBndWFyZGVkQnlQaWVjZS5yLCBjOiBndWFyZGVkQnlQaWVjZS5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udHJvbCA9IChjdXJyZW50UGllY2VJbmZvLmNvbnRyb2wgfHwgW10pLm1hcChjb250cm9sUG9zID0+ICh7IHI6IGNvbnRyb2xQb3MuciwgYzogY29udHJvbFBvcy5jIH0pKTsNCiAgICAgICAgICAgICAgICAgICAgDQogICAgICAgICAgICAgICAgICAgIHJlbGF0aW9ucyA9IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdCwgDQogICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXRlbmVkQnksIA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmQsIA0KICAgICAgICAgICAgICAgICAgICAgICAgZ3VhcmRlZEJ5LCANCiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRyb2wsDQogICAgICAgICAgICAgICAgICAgICAgICBjb250cm9sbGVycw0KICAgICAgICAgICAgICAgICAgICB9Ow0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlUmVsYXRpb25zJywNCiAgICAgICAgICAgICAgICByZWxhdGlvbnM6IHJlbGF0aW9ucw0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2NoZWNrR2FtZVN0YXRlJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZDogY2dzQm9hcmQsIHR1cm46IGNnc1R1cm4sIHJlcXVlc3RJZCB9ID0gcGF5bG9hZDsNCiAgICAgICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGNoZWNrR2FtZVN0YXRlKGNnc0JvYXJkLCBjZ3NUdXJuKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdnYW1lU3RhdGUnLA0KICAgICAgICAgICAgICAgIHN0YXRlOiBnYW1lU3RhdGUsDQogICAgICAgICAgICAgICAgcmVxdWVzdElkDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnZXZhbHVhdGVCb2FyZCc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGV2YWxCb2FyZCwgdHVybjogZXZhbFR1cm4gfSA9IHBheWxvYWQ7DQogICAgICAgICAgICAvLyDmiZPljbDmjqXmlLbnmoTlj4LmlbANCiAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7DQogICAgICAgICAgICBjb25zdCBnYW1lU3RhZ2UgPSBwaGFzZSA9PT0gJ29wZW5pbmcnID8gJ2Vhcmx5JyA6IHBoYXNlID09PSAnbWlkZGxlZ2FtZScgPyAnbWlkJyA6ICdsYXRlJzsNCiAgICAgICAgICAgIGNvbnN0IGRldGFpbGVkRXZhbCA9IGV2YWx1YXRlQm9hcmQoZXZhbEJvYXJkLCBldmFsVHVybiwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICdkZXRhaWxlZEV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IGRldGFpbGVkRXZhbA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KDQogICAgICAgIGNhc2UgJ2V2YWx1YXRlUGllY2UnOiB7DQogICAgICAgICAgICBjb25zdCB7IGJvYXJkOiBwaWVjZUV2YWxCb2FyZCwgcG9zOiBwaWVjZUV2YWxQb3MsIHR1cm4gfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBwaWVjZSA9IHBpZWNlRXZhbEJvYXJkW3BpZWNlRXZhbFBvcy5yXVtwaWVjZUV2YWxQb3MuY107DQogICAgICAgICAgICANCiAgICAgICAgICAgIGlmICghcGllY2UpIHsNCiAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BpZWNlRXZhbHVhdGlvbicsDQogICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsNCiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGVyaWFsOiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IDAsDQogICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRocmVhdDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHNhZmV0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMA0KICAgICAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgfSk7DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZWxzZSB7DQogICAgICAgICAgICAgICAgLy8g5Li75Yqo6LCD55SoZXZhbHVhdGVCb2FyZOiOt+WPluWujOaVtOeahOivhOS8sOS/oeaBrw0KICAgICAgICAgICAgICAgIC8vIOiOt+WPluW9k+WJjea4uOaIj+mYtuautQ0KICAgICAgICAgICAgICAgIGNvbnN0IHBoYXNlID0gZ2V0R2FtZVBoYXNlKCk7DQogICAgICAgICAgICAgICAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQogICAgICAgICAgICBjb25zdCBib2FyZEV2YWx1YXRpb24gPSBldmFsdWF0ZUJvYXJkKHBpZWNlRXZhbEJvYXJkLCB0dXJuLCBnYW1lU3RhZ2UpOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIC8vIOS7jmV2YWx1YXRlQm9hcmTnmoTov5Tlm57lgLzkuK3mib7liLDlvZPliY3mo4vlrZDnmoTkv6Hmga8NCiAgICAgICAgICAgICAgICBjdXJyZW50UGllY2VJbmZvID0gYm9hcmRFdmFsdWF0aW9uLnBpZWNlc0luZm8uZmluZCgNCiAgICAgICAgICAgICAgICAgICAgcCA9PiBwLnIgPT09IHBpZWNlRXZhbFBvcy5yICYmIHAuYyA9PT0gcGllY2VFdmFsUG9zLmMNCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGllY2VJbmZvKSB7DQogICAgICAgICAgICAgICAgICAgIC8vIOW6lOeUqOadg+mHjeW5tui/lOWbnuWNleS4quaji+WtkOeahOivhOS8sOWAvA0KICAgICAgICAgICAgICAgICAgICBjb25zdCBldmFsdWF0aW9uID0gew0KICAgICAgICAgICAgICAgICAgICAgICAgbWF0ZXJpYWw6IGN1cnJlbnRQaWVjZUluZm8ubWF0ZXJpYWxWYWx1ZSAqIFZBTFVFX1dFSUdIVFMubWF0ZXJpYWwsDQogICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogY3VycmVudFBpZWNlSW5mby5wb3NpdGlvblZhbHVlICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiwNCiAgICAgICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiBjdXJyZW50UGllY2VJbmZvLm1vYmlsaXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5LA0KICAgICAgICAgICAgICAgICAgICAgICAgdGhyZWF0OiBjdXJyZW50UGllY2VJbmZvLnRocmVhdFZhbHVlICogVkFMVUVfV0VJR0hUUy50aHJlYXQsDQogICAgICAgICAgICAgICAgICAgICAgICBzYWZldHk6IGN1cnJlbnRQaWVjZUluZm8uc2FmZXR5VmFsdWUgKiBWQUxVRV9XRUlHSFRTLnNhZmV0eSwNCiAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogY3VycmVudFBpZWNlSW5mby50YWN0aWNWYWx1ZSAqIFZBTFVFX1dFSUdIVFMudGFjdGljDQogICAgICAgICAgICAgICAgICAgIH07DQogICAgICAgICAgICAgICAgICAgIA0KICAgICAgICAgICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwaWVjZUV2YWx1YXRpb24nLA0KICAgICAgICAgICAgICAgICAgICAgICAgZXZhbHVhdGlvbjogZXZhbHVhdGlvbg0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgICAgICAgICAvLyDlpoLmnpzku43nhLbmib7kuI3liLDmo4vlrZDkv6Hmga/vvIzov5Tlm57pu5jorqTlgLwNCiAgICAgICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGllY2VFdmFsdWF0aW9uJywNCiAgICAgICAgICAgICAgICAgICAgICAgIGV2YWx1YXRpb246IHsNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRlcmlhbDogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2JpbGl0eTogMCwNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJlYXQ6IDAsDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgc2FmZXR5OiAwLA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhY3RpYzogMA0KICAgICAgICAgICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICAgICAgcmV0dXJuOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnaXNDaGVjayc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgYm9hcmQ6IGNCb2FyZCwgY29sb3I6IGNDb2xvciwgcmVxdWVzdElkIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgc3luY0dlbmVyYWxQb3NDYWNoZShjQm9hcmQpOw0KICAgICAgICAgICAgY29uc3QgaW5DaGVjayA9IGlzQ2hlY2soY0JvYXJkLCBjQ29sb3IpOw0KICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7DQogICAgICAgICAgICAgICAgdHlwZTogJ2NoZWNrJywNCiAgICAgICAgICAgICAgICBpc0NoZWNrOiBpbkNoZWNrLA0KICAgICAgICAgICAgICAgIHJlcXVlc3RJZA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ2lzVmFsaWRQbGFjZW1lbnQnOiB7DQogICAgICAgICAgICBjb25zdCB7IHR5cGU6IGlwVHlwZSwgY29sb3I6IGlwQ29sb3IsIHIsIGMgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCB2YWxpZFBsYWNlbWVudCA9IGlzVmFsaWRQbGFjZW1lbnQoaXBUeXBlLCBpcENvbG9yLCByLCBjKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgICAgIHR5cGU6ICd2YWxpZFBsYWNlbWVudCcsDQogICAgICAgICAgICAgICAgaXNWYWxpZDogdmFsaWRQbGFjZW1lbnQNCiAgICAgICAgICAgIH0pOw0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICAgICAgICAgIA0KICAgICAgICBjYXNlICdhZGRPcGVuaW5nTGluZUZyb21TdHJpbmcnOiB7DQogICAgICAgICAgICBjb25zdCB7IG1vdmVzLCB3ZWlnaHRzIH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgLy8gQWRkIHRoZSBvcGVuaW5nIGxpbmUgdG8gdGhlIG9wZW5pbmcgYm9vaw0KICAgICAgICAgICAgb3BlbmluZ0Jvb2suYWRkT3BlbmluZ0xpbmVGcm9tU3RyaW5nKFttb3Zlc10sIHdlaWdodHMpOw0KICAgICAgICAgICAgLy8gU2VuZCBjb25maXJtYXRpb24NCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnb3BlbmluZ0xpbmVBZGRlZCcsIA0KICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUgDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnbW92ZXNUb05vdGF0aW9uJzogew0KICAgICAgICAgICAgY29uc3QgeyBib2FyZEhpc3RvcnksIG1vdmVIaXN0b3J5IH0gPSBwYXlsb2FkOw0KICAgICAgICAgICAgY29uc3Qgbm90YXRpb24gPSBvcGVuaW5nQm9vay5tb3Zlc1RvTm90YXRpb24oYm9hcmRIaXN0b3J5LCBtb3ZlSGlzdG9yeSk7DQogICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHsgDQogICAgICAgICAgICAgICAgdHlwZTogJ25vdGF0aW9uJywgDQogICAgICAgICAgICAgICAgbm90YXRpb246IG5vdGF0aW9uIA0KICAgICAgICAgICAgfSk7DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgICAgICAgICAgDQogICAgICAgIGNhc2UgJ25vdGF0aW9uVG9Nb3Zlcyc6IHsNCiAgICAgICAgICAgIGNvbnN0IHsgbm90YXRpb246IG5vdGF0aW9uU3RyaW5nLCBpbml0aWFsQm9hcmQgfSA9IHBheWxvYWQ7DQogICAgICAgICAgICBjb25zdCBtb3Zlc0Zyb21Ob3RhdGlvbiA9IG9wZW5pbmdCb29rLm5vdGF0aW9uVG9Nb3Zlcyhub3RhdGlvblN0cmluZywgaW5pdGlhbEJvYXJkKTsNCiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyANCiAgICAgICAgICAgICAgICB0eXBlOiAnbW92ZXMnLCANCiAgICAgICAgICAgICAgICBtb3ZlczogbW92ZXNGcm9tTm90YXRpb24gDQogICAgICAgICAgICB9KTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgICAgICAgICANCiAgICAgICAgY2FzZSAnc2V0VmFsdWVXZWlnaHRzJzogew0KICAgICAgICAgICAgVkFMVUVfV0VJR0hUUyA9IHsgLi4uVkFMVUVfV0VJR0hUUywgLi4ucGF5bG9hZCB9Ow0KICAgICAgICAgICAgY29uc29sZS5sb2coJ1VwZGF0ZWQgVkFMVUVfV0VJR0hUUzonLCBWQUxVRV9XRUlHSFRTKTsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KfTsNCg0KICAgIC8vIE92ZXJyaWRlIGNvbnNvbGUubG9nIHRvIHNlbmQgbWVzc2FnZXMgYmFjayB0byBtYWluIHRocmVhZA0KICAgIGNvbnN0IG9yaWdpbmFsQ29uc29sZUxvZyA9IGNvbnNvbGUubG9nOw0KICAgIGNvbnNvbGUubG9nID0gZnVuY3Rpb24oLi4uYXJncykgew0KICAgICAgICAvLyBTZW5kIHRvIG1haW4gdGhyZWFkDQogICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoew0KICAgICAgICAgICAgdHlwZTogJ2xvZycsDQogICAgICAgICAgICBkYXRhOiBhcmdzLmpvaW4oJyAnKQ0KICAgICAgICB9KTsNCiAgICAgICAgDQogICAgICAgIC8vIEFsc28gbG9nIHRvIHdvcmtlciBjb25zb2xlDQogICAgICAgIG9yaWdpbmFsQ29uc29sZUxvZy5hcHBseShjb25zb2xlLCBhcmdzKTsNCiAgICB9Ow0KfQ0KDQovLyDnqbrnnYDliarmnp3vvJrmnInov5vmlLvlrZDlipvml7bmiY3lhYHorrjvvIjpgb/lhY3lsIYv5aOrL+ixoeaui+WxgOmAvOedgOivr+WJqu+8iQ0KY29uc3QgY2FuRG9OdWxsTW92ZSA9IChib2FyZCwgY29sb3IpID0+IHsNCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcCA9IGJvYXJkW3JdW2NdOw0KICAgICAgICAgICAgaWYgKCFwIHx8IHAuY29sb3IgIT09IGNvbG9yKSBjb250aW51ZTsNCiAgICAgICAgICAgIGlmIChwLnR5cGUgPT09ICdjaGFyaW90JyB8fCBwLnR5cGUgPT09ICdob3JzZScgfHwgcC50eXBlID09PSAnY2Fubm9uJyB8fCBwLnR5cGUgPT09ICdzb2xkaWVyJykgew0KICAgICAgICAgICAgICAgIHJldHVybiB0cnVlOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KICAgIHJldHVybiBmYWxzZTsNCn07DQoNCi8vIOaQnOe0oueUqCBUVCBrZXnvvJrlop7ph4/mqKHlvI/kuLogbnVtYmVy77yM5pen5qih5byP5Li6IGAke2hhc2h9OiR7c2lkZX1gIOWtl+espuS4sg0KY29uc3QgbWFrZVNlYXJjaFRUS2V5ID0gKGJvYXJkLCBjdXJyZW50UGxheWVyLCBib2FyZEhhc2gpID0+IHsNCiAgICByZXR1cm4gem9icmlzdEhhc2hlci50dEtleUZyb21IYXNoKGJvYXJkSGFzaCwgY3VycmVudFBsYXllcik7DQp9Ow0KDQovLyDotbDlrZDlkI7nmoTlrZDoioLngrnlsYDpnaLlk4jluIzvvIjku4Xlop7ph4/mqKHlvI/mnInmhI/kuYnvvJvpobvlnKggbWFrZSDliY3kv53lrZggbW92aW5nUGllY2XvvIkNCmNvbnN0IGNoaWxkQm9hcmRIYXNoID0gKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKSA9PiB7CiAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgcGVyZlN0YXRzLmluY3JlbWVudGFsSGFzaFVwZGF0ZXMrKzsKICAgIGlmIChpc0VuY29kZWRNb3ZlKG1vdmUpKSB7DQogICAgICAgIGxldCBuZXdIYXNoID0gYm9hcmRIYXNoOw0KICAgICAgICBjb25zdCBtb3ZpbmdJZHggPSB6b2JyaXN0SGFzaGVyLnBpZWNlSW5kZXgobW92aW5nUGllY2UpOw0KICAgICAgICBjb25zdCBmcm9tID0gbW92ZSA+Pj4gNzsNCiAgICAgICAgY29uc3QgdG8gPSBtb3ZlICYgTU9WRV9UT19NQVNLOw0KICAgICAgICBjb25zdCBoYXNoQnlTcSA9IHpvYnJpc3RIYXNoZXIuaGFzaEJ5U3E7DQogICAgICAgIGlmIChtb3ZpbmdJZHggIT09IHVuZGVmaW5lZCkgew0KICAgICAgICAgICAgbmV3SGFzaCBePSBoYXNoQnlTcVtmcm9tXVttb3ZpbmdJZHhdOw0KICAgICAgICAgICAgbmV3SGFzaCBePSBoYXNoQnlTcVt0b11bbW92aW5nSWR4XTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoY2FwdHVyZWQpIHsNCiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkSWR4ID0gem9icmlzdEhhc2hlci5waWVjZUluZGV4KGNhcHR1cmVkKTsNCiAgICAgICAgICAgIGlmIChjYXB0dXJlZElkeCAhPT0gdW5kZWZpbmVkKSB7DQogICAgICAgICAgICAgICAgbmV3SGFzaCBePSBoYXNoQnlTcVt0b11bY2FwdHVyZWRJZHhdOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgICAgIHJldHVybiBuZXdIYXNoOw0KICAgIH0NCiAgICByZXR1cm4gem9icmlzdEhhc2hlci51cGRhdGVIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCn07DQoNCi8vIOWvueW8iCBudW1lcmljIOWPtu+8muWFs+ezuyArIOWogeiDgS9TRUUgKyDlronlhaggKyDmsYfmgLvvvIjopoHmsYIgYWN0aXZlU2VhcmNoUGllY2VTdGF0ZSDlt7Lnu5HlrpogYm9hcmTvvIkNCmNvbnN0IGV2YWx1YXRlUGxheUxlYWZOdW1lcmljID0gKGJvYXJkLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSkgPT4gew0KICAgIGNvbnN0IF9fdDAgPSBTRUFSQ0hfUFJPRklMRSA/IHBlcmZvcm1hbmNlLm5vdygpIDogMDsNCiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgY29uc3QgcGllY2VzSW5mbyA9IHNjcmF0Y2hMZWFmUGllY2VzSW5mbzsNCiAgICBjb25zdCByZWNvcmRzID0gcGllY2VTdGF0ZS5yZWNvcmRzOw0KICAgIGNvbnN0IG1hdGVyaWFsVmFsdWVzID0gcGllY2VTdGF0ZS5tYXRlcmlhbFZhbHVlczsNCiAgICBjb25zdCBzcXVhcmVDb2RlcyA9IHBpZWNlU3RhdGUuc3F1YXJlQ29kZXM7DQogICAgbGV0IGNvdW50ID0gMDsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJlY29yZHMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgY29uc3QgcmVjb3JkID0gcmVjb3Jkc1tpXTsNCiAgICAgICAgaWYgKCFyZWNvcmQuYWxpdmUpIGNvbnRpbnVlOw0KICAgICAgICBjb25zdCBpbmZvID0gc2NyYXRjaExlYWZQaWVjZVNsb3RzW2NvdW50XTsNCiAgICAgICAgY29uc3QgcGllY2VDb2RlID0gcGllY2VTdGF0ZS5waWVjZUNvZGVzW2ldOw0KICAgICAgICBpbmZvLnBpZWNlID0gbnVsbDsNCiAgICAgICAgaW5mby5waWVjZUNvZGUgPSBwaWVjZUNvZGU7DQogICAgICAgIGluZm8uciA9IHJlY29yZC5yOw0KICAgICAgICBpbmZvLmMgPSByZWNvcmQuYzsNCiAgICAgICAgaW5mby5zcSA9IHJlY29yZC5zcTsNCiAgICAgICAgaW5mby5waWVjZUluZGV4ID0gY291bnQ7DQogICAgICAgIGluZm8ubWF0ZXJpYWxWYWx1ZSA9IG1hdGVyaWFsVmFsdWVzW3BpZWNlQ29kZSAmIDddOw0KICAgICAgICBpbmZvLnBvc2l0aW9uVmFsdWUgPSAwOw0KICAgICAgICBwaWVjZXNJbmZvW2NvdW50KytdID0gaW5mbzsNCiAgICB9DQogICAgcGllY2VzSW5mby5sZW5ndGggPSBjb3VudDsNCg0KICAgIGNhbGN1bGF0ZVBhY2tlZFNlYXJjaExlYWZSZWxhdGlvbnMocGllY2VzSW5mbywgc3F1YXJlQ29kZXMpOw0KDQogICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHBlcmZTdGF0cy5jYWxjdWxhdGVUaHJlYXRWYWx1ZXNDb3VudFtzZWFyY2hJbml0aWF0b3JdKys7CiAgICBjb25zdCBjaGVja0JvbnVzID0gRVZBTFVBVElPTl9QQVJBTUVURVJTLmNoZWNrLmJvbnVzOw0KICAgIGNvbnN0IGF0dGFja01hc2sgPSBzY3JhdGNoQXR0YWNrTWFzazsNCiAgICBjb25zdCBndWFyZE1hc2sgPSBzY3JhdGNoR3VhcmRNYXNrOw0KICAgIGZvciAobGV0IHRpID0gMDsgdGkgPCBjb3VudDsgdGkrKykgew0KICAgICAgICBjb25zdCB0aHJlYXRlbmVkUGllY2UgPSBwaWVjZXNJbmZvW3RpXTsNCiAgICAgICAgY29uc3Qgc3EgPSB0aHJlYXRlbmVkUGllY2Uuc3E7DQogICAgICAgIGNvbnN0IGF0dGFja2VycyA9IGF0dGFja01hc2tbc3FdID4+PiAwOw0KICAgICAgICBpZiAoYXR0YWNrZXJzID09PSAwKSBjb250aW51ZTsNCg0KICAgICAgICBjb25zdCBmaXJzdEJpdCA9IGF0dGFja2VycyAmIC1hdHRhY2tlcnM7DQogICAgICAgIGNvbnN0IGZpcnN0QXR0YWNrZXIgPSBwaWVjZXNJbmZvWzMxIC0gTWF0aC5jbHozMihmaXJzdEJpdCldOw0KICAgICAgICBpZiAoKHRocmVhdGVuZWRQaWVjZS5waWVjZUNvZGUgJiA3KSA9PT0gMSkgew0KICAgICAgICAgICAgZmlyc3RBdHRhY2tlci50aHJlYXRWYWx1ZSArPSBjaGVja0JvbnVzOw0KICAgICAgICB9IGVsc2UgaWYgKGd1YXJkTWFza1tzcV0gPT09IDApIHsNCiAgICAgICAgICAgIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gdGhyZWF0ZW5lZFBpZWNlLm1hdGVyaWFsVmFsdWU7DQogICAgICAgIH0gZWxzZSBpZiAoYXR0YWNrZXJzID09PSBmaXJzdEJpdCkgew0KICAgICAgICAgICAgY29uc3Qgc3NlU2NvcmUgPSB0aHJlYXRlbmVkUGllY2UubWF0ZXJpYWxWYWx1ZSAtIGZpcnN0QXR0YWNrZXIubWF0ZXJpYWxWYWx1ZTsNCiAgICAgICAgICAgIGlmIChzc2VTY29yZSA+IDApIGZpcnN0QXR0YWNrZXIudGhyZWF0VmFsdWUgKz0gc3NlU2NvcmUgKiAwLjU7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBjb25zdCBzc2VTY29yZSA9IGNhbGN1bGF0ZVN0YXRpY0V4Y2hhbmdlU2NvcmVGcm9tTWFza3MoDQogICAgICAgICAgICAgICAgdGhyZWF0ZW5lZFBpZWNlLCBwaWVjZXNJbmZvLCBhdHRhY2tNYXNrLCBndWFyZE1hc2sNCiAgICAgICAgICAgICk7DQogICAgICAgICAgICBpZiAoc3NlU2NvcmUgPiAwKSBmaXJzdEF0dGFja2VyLnRocmVhdFZhbHVlICs9IHNzZVNjb3JlICogMC41Ow0KICAgICAgICB9DQogICAgfQ0KDQogICAgZm9yIChsZXQgZ2kgPSAwOyBnaSA8IGNvdW50OyBnaSsrKSB7DQogICAgICAgIGNvbnN0IGdlbmVyYWwgPSBwaWVjZXNJbmZvW2dpXTsNCiAgICAgICAgaWYgKChnZW5lcmFsLnBpZWNlQ29kZSAmIDcpICE9PSAxKSBjb250aW51ZTsNCiAgICAgICAgY29uc3QgaXNSZWQgPSBnZW5lcmFsLnBpZWNlQ29kZSA8IDg7DQogICAgICAgIGNvbnN0IGVuZW15Qml0cyA9IGlzUmVkID8gc2NyYXRjaEJsYWNrQXR0YWNrIDogc2NyYXRjaFJlZEF0dGFjazsNCiAgICAgICAgY29uc3QgZGVzdGluYXRpb25zID0gU0VBUkNIX0dFTkVSQUxfREVTVFtpc1JlZCA/IDAgOiAxXVtnZW5lcmFsLnNxXTsNCiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXN0aW5hdGlvbnMubGVuZ3RoOyBpKyspIHsNCiAgICAgICAgICAgIGNvbnN0IHNxID0gZGVzdGluYXRpb25zW2ldOw0KICAgICAgICAgICAgaWYgKHNxdWFyZUNvZGVzW3NxXSA9PT0gMCAmJiBoYXNBdHRhY2tCaXQoZW5lbXlCaXRzLCBzcSkpIHsNCiAgICAgICAgICAgICAgICBnZW5lcmFsLnNhZmV0eVZhbHVlIC09IDUwOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9DQogICAgfQ0KDQogICAgbGV0IHJlZFRocmVhdCA9IDA7DQogICAgbGV0IHJlZFNhZmV0eSA9IDA7DQogICAgbGV0IHJlZE1vYmlsaXR5ID0gMDsNCiAgICBsZXQgYmxhY2tUaHJlYXQgPSAwOw0KICAgIGxldCBibGFja1NhZmV0eSA9IDA7DQogICAgbGV0IGJsYWNrTW9iaWxpdHkgPSAwOw0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykgew0KICAgICAgICBjb25zdCBpbmZvID0gcGllY2VzSW5mb1tpXTsNCiAgICAgICAgaWYgKGluZm8ucGllY2VDb2RlIDwgOCkgew0KICAgICAgICAgICAgcmVkVGhyZWF0ICs9IGluZm8udGhyZWF0VmFsdWU7DQogICAgICAgICAgICByZWRTYWZldHkgKz0gaW5mby5zYWZldHlWYWx1ZTsNCiAgICAgICAgICAgIHJlZE1vYmlsaXR5ICs9IGluZm8ubW9iaWxpdHlWYWx1ZTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGJsYWNrVGhyZWF0ICs9IGluZm8udGhyZWF0VmFsdWU7DQogICAgICAgICAgICBibGFja1NhZmV0eSArPSBpbmZvLnNhZmV0eVZhbHVlOw0KICAgICAgICAgICAgYmxhY2tNb2JpbGl0eSArPSBpbmZvLm1vYmlsaXR5VmFsdWU7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBjb25zdCByZWRUb3RhbCA9DQogICAgICAgIHBpZWNlU3RhdGUucmVkTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgcGllY2VTdGF0ZS5yZWRQb3NpdGlvbiAqIFZBTFVFX1dFSUdIVFMucG9zaXRpb24gKw0KICAgICAgICByZWRUaHJlYXQgKiBWQUxVRV9XRUlHSFRTLnRocmVhdCArDQogICAgICAgIHJlZFNhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsNCiAgICAgICAgcmVkTW9iaWxpdHkgKiBWQUxVRV9XRUlHSFRTLm1vYmlsaXR5Ow0KICAgIGNvbnN0IGJsYWNrVG90YWwgPQ0KICAgICAgICBwaWVjZVN0YXRlLmJsYWNrTWF0ZXJpYWwgKiBWQUxVRV9XRUlHSFRTLm1hdGVyaWFsICsNCiAgICAgICAgcGllY2VTdGF0ZS5ibGFja1Bvc2l0aW9uICogVkFMVUVfV0VJR0hUUy5wb3NpdGlvbiArDQogICAgICAgIGJsYWNrVGhyZWF0ICogVkFMVUVfV0VJR0hUUy50aHJlYXQgKw0KICAgICAgICBibGFja1NhZmV0eSAqIFZBTFVFX1dFSUdIVFMuc2FmZXR5ICsNCiAgICAgICAgYmxhY2tNb2JpbGl0eSAqIFZBTFVFX1dFSUdIVFMubW9iaWxpdHk7DQoNCiAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHsKICAgICAgICBwZXJmU3RhdHMuZmFzdExlYWZFdmFsQ291bnQrKzsKICAgICAgICBwZXJmU3RhdHMuZmFzdExlYWZFdmFsTXMgKz0gcGVyZm9ybWFuY2Uubm93KCkgLSBfX3QwOwogICAgfSBlbHNlIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSB7CiAgICAgICAgcGVyZlN0YXRzLmZhc3RMZWFmRXZhbENvdW50Kys7CiAgICB9DQogICAgcmV0dXJuIHNlYXJjaEluaXRpYXRvciA9PT0gJ3JlZCcgPyByZWRUb3RhbCAtIGJsYWNrVG90YWwgOiBibGFja1RvdGFsIC0gcmVkVG90YWw7DQp9Ow0KDQovLyDmkJzntKLnlKjlh4DliIbvvJrlrozmlbTlvaLlir/or4TkvLDvvIjlhbPns7sv5aiB6IOBL+WuieWFqC/mnLrliqjvvInvvIzku4Xot7Pov4fnu4jlsYDnnYDms5XmnprkuL7vvJvluKYgWm9icmlzdCDnvJPlrZgNCmNvbnN0IHN0YXRpY1NlYXJjaEV2YWwgPSAoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBib2FyZEhhc2ggPSAwKSA9PiB7CiAgICBjb25zdCBjYWNoZUtleSA9IHpvYnJpc3RIYXNoZXIuZXZhbENhY2hlS2V5RnJvbUhhc2goYm9hcmRIYXNoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSk7CiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7CiAgICBjb25zdCB2ZXJpZmljYXRpb25LZXkgPSBwaWVjZVN0YXRlID8gcGllY2VTdGF0ZS5ldmFsVmVyaWZpY2F0aW9uSGFzaCA6IDA7CiAgICBjb25zdCBjYWNoZVNsb3QgPSAoY2FjaGVLZXkgPj4+IDApICYgRVZBTF9DQUNIRV9NQVNLOwogICAgaWYgKGV2YWxDYWNoZUdlbmVyYXRpb25zW2NhY2hlU2xvdF0gPT09IGV2YWxDYWNoZUdlbmVyYXRpb24gJiYKICAgICAgICBldmFsQ2FjaGVLZXlzW2NhY2hlU2xvdF0gPT09IGNhY2hlS2V5ICYmCiAgICAgICAgZXZhbENhY2hlVmVyaWZpY2F0aW9uS2V5c1tjYWNoZVNsb3RdID09PSB2ZXJpZmljYXRpb25LZXkpIHsKICAgICAgICBpZiAoU0VBUkNIX1BST0ZJTEUpIHBlcmZTdGF0cy5zdGF0aWNFdmFsQ2FjaGVIaXRzKys7CiAgICAgICAgcmV0dXJuIGV2YWxDYWNoZVZhbHVlc1tjYWNoZVNsb3RdOwogICAgfQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuc3RhdGljRXZhbENhY2hlTWlzc2VzKys7DQogICAgbGV0IG5ldDsNCiAgICBpZiAoIVNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsNCiAgICAgICAgbmV0ID0gZXZhbHVhdGVQbGF5TGVhZk51bWVyaWMoYm9hcmQsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlKTsNCiAgICB9IGVsc2Ugew0KICAgICAgICBjb25zdCBldmFsUmVzdWx0ID0gZXZhbHVhdGVCb2FyZChib2FyZCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHsgZm9yU2VhcmNoTGVhZjogdHJ1ZSB9KTsNCiAgICAgICAgY29uc3Qgb3Bwb25lbnQgPSBzZWFyY2hJbml0aWF0b3IgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBuZXQgPSBldmFsUmVzdWx0W3NlYXJjaEluaXRpYXRvcl0udG90YWwgLSBldmFsUmVzdWx0W29wcG9uZW50XS50b3RhbDsNCiAgICB9DQogICAgZXZhbENhY2hlR2VuZXJhdGlvbnNbY2FjaGVTbG90XSA9IGV2YWxDYWNoZUdlbmVyYXRpb247CiAgICBldmFsQ2FjaGVLZXlzW2NhY2hlU2xvdF0gPSBjYWNoZUtleTsKICAgIGV2YWxDYWNoZVZlcmlmaWNhdGlvbktleXNbY2FjaGVTbG90XSA9IHZlcmlmaWNhdGlvbktleTsKICAgIGV2YWxDYWNoZVZhbHVlc1tjYWNoZVNsb3RdID0gbmV0OwogICAgcmV0dXJuIG5ldDsKfTsKDQovLyDnlJ/miJDlvZPliY3mlrnlkIPlrZDnnYDvvIjkvpvpnZnpu5jmkJzntKLvvIkNCmNvbnN0IGdlbmVyYXRlQ2FwdHVyZXNGb3JTZWFyY2ggPSAoYm9hcmQsIGN1cnJlbnRQbGF5ZXIpID0+IHsNCiAgICBjb25zdCBfX3QwID0gU0VBUkNIX1BST0ZJTEUgPyBwZXJmb3JtYW5jZS5ub3coKSA6IDA7DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuY2FwdHVyZUdlbkNvdW50Kys7DQogICAgY29uc3QgY2FwdHVyZXMgPSBbXTsNCiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgaWYgKHBpZWNlU3RhdGUpIHsNCiAgICAgICAgY29uc3QgcmVjb3JkcyA9IHBpZWNlU3RhdGUucmVjb3JkczsNCiAgICAgICAgY29uc3Qgc3F1YXJlVG9TbG90ID0gcGllY2VTdGF0ZS5zcXVhcmVUb1Nsb3Q7DQogICAgICAgIGNvbnN0IHNxdWFyZUNvZGVzID0gcGllY2VTdGF0ZS5zcXVhcmVDb2RlczsNCiAgICAgICAgY29uc3QgcGllY2VDb2RlcyA9IHBpZWNlU3RhdGUucGllY2VDb2RlczsNCiAgICAgICAgZm9yIChsZXQgc3EgPSAwOyBzcSA8IFJFTF9TUVVBUkVTOyBzcSsrKSB7DQogICAgICAgICAgICBjb25zdCBzbG90ID0gc3F1YXJlVG9TbG90W3NxXTsNCiAgICAgICAgICAgIGlmIChzbG90IDwgMCkgY29udGludWU7DQogICAgICAgICAgICBjb25zdCByZWNvcmQgPSByZWNvcmRzW3Nsb3RdOw0KICAgICAgICAgICAgaWYgKCFyZWNvcmQuYWxpdmUgfHwgcmVjb3JkLnBpZWNlLmNvbG9yICE9PSBjdXJyZW50UGxheWVyKSBjb250aW51ZTsNCiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZCA9IGFwcGVuZFNlYXJjaFBzZXVkb01vdmVzRm9yUGllY2UoCiAgICAgICAgICAgICAgICBjYXB0dXJlcywgc3EsIHBpZWNlQ29kZXNbc2xvdF0sIHNxdWFyZUNvZGVzLCB0cnVlCiAgICAgICAgICAgICk7CiAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSBwZXJmU3RhdHMucHNldWRvTW92ZXNHZW5lcmF0ZWQgKz0gZ2VuZXJhdGVkOwogICAgICAgIH0NCiAgICAgICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuY2FwdHVyZUdlbk1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsNCiAgICAgICAgcmV0dXJuIGNhcHR1cmVzOw0KICAgIH0NCiAgICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IENPTFM7IGMrKykgew0KICAgICAgICAgICAgY29uc3QgcGllY2UgPSBib2FyZFtyXVtjXTsNCiAgICAgICAgICAgIGlmICghcGllY2UgfHwgcGllY2UuY29sb3IgIT09IGN1cnJlbnRQbGF5ZXIpIGNvbnRpbnVlOw0KICAgICAgICAgICAgY29uc3QgZnJvbSA9IHsgciwgYyB9Ow0KICAgICAgICAgICAgY29uc3QgcHNldWRvID0gZ2V0UGllY2VNb3Zlcyhib2FyZCwgZnJvbSwgcGllY2UpOw0KICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHBlcmZTdGF0cy5wc2V1ZG9Nb3Zlc0dlbmVyYXRlZCArPSBwc2V1ZG8ubGVuZ3RoOwogICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBzZXVkby5sZW5ndGg7IGkrKykgew0KICAgICAgICAgICAgICAgIGNvbnN0IHRvID0gcHNldWRvW2ldOw0KICAgICAgICAgICAgICAgIGlmIChib2FyZFt0by5yXVt0by5jXSkgY2FwdHVyZXMucHVzaChlbmNvZGVNb3ZlRnJvbUNvb3JkcyhyLCBjLCB0by5yLCB0by5jKSk7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQogICAgaWYgKFNFQVJDSF9QUk9GSUxFKSBwZXJmU3RhdHMuY2FwdHVyZUdlbk1zICs9IHBlcmZvcm1hbmNlLm5vdygpIC0gX190MDsNCiAgICByZXR1cm4gY2FwdHVyZXM7DQp9Ow0KDQovLyDpnZnpu5jmkJzntKLvvJpzdGFuZC1wYXQg55So5a6M5pW05b2i5Yq/6K+E5Lyw77yb5LuF5a+55ZCD5a2Q5bu25Ly477yIUVPiiaQz77yJDQovLyBQbGF5IHNlYXJjaCBoYXMgbm8gUFYgdG8gcmV0YWluLCBzbyBrZWVwIGl0cyByZWN1cnNpdmUgaG90IHBhdGggcHJpbWl0aXZlLW9ubHkuDQovLyBBbmFseXNpcyBjb250aW51ZXMgdG8gdXNlIHRoZSBvYmplY3QtcmV0dXJuaW5nIGZ1bmN0aW9ucyBiZWxvdy4NCmNvbnN0IHNvcnRDYXB0dXJlc1BsYXkgPSAoY2FwdHVyZXMsIGJvYXJkLCBnYW1lU3RhZ2UpID0+IHsNCiAgICBjb25zdCBwaWVjZVN0YXRlID0gYWN0aXZlUGllY2VTdGF0ZUZvcihib2FyZCk7DQogICAgY29uc3Qgc3F1YXJlVG9TbG90ID0gcGllY2VTdGF0ZSAmJiBwaWVjZVN0YXRlLnNxdWFyZVRvU2xvdDsNCiAgICBjb25zdCBwaWVjZUNvZGVzID0gcGllY2VTdGF0ZSAmJiBwaWVjZVN0YXRlLnBpZWNlQ29kZXM7DQogICAgY29uc3QgbWF0ZXJpYWxWYWx1ZXMgPSBwaWVjZVN0YXRlID8gcGllY2VTdGF0ZS5tYXRlcmlhbFZhbHVlcyA6IHNlYXJjaE1hdGVyaWFsVGFibGUoZ2FtZVN0YWdlKTsNCg0KICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBjYXB0dXJlcy5sZW5ndGg7IGluZGV4KyspIHsNCiAgICAgICAgY29uc3QgbW92ZSA9IGNhcHR1cmVzW2luZGV4XTsNCiAgICAgICAgY29uc3QgZnJvbVNxID0gbW92ZSA+Pj4gNzsNCiAgICAgICAgY29uc3QgdG9TcSA9IG1vdmUgJiBNT1ZFX1RPX01BU0s7DQogICAgICAgIGxldCBzY29yZTsNCiAgICAgICAgaWYgKHBpZWNlU3RhdGUpIHsNCiAgICAgICAgICAgIHNjb3JlID0gbWF0ZXJpYWxWYWx1ZXNbcGllY2VDb2Rlc1tzcXVhcmVUb1Nsb3RbdG9TcV1dICYgN10gKiAxNiAtDQogICAgICAgICAgICAgICAgbWF0ZXJpYWxWYWx1ZXNbcGllY2VDb2Rlc1tzcXVhcmVUb1Nsb3RbZnJvbVNxXV0gJiA3XTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIHNjb3JlID0NCiAgICAgICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJvYXJkW21vdmVUb1IobW92ZSldW21vdmVUb0MobW92ZSldLCBnYW1lU3RhZ2UpICogMTYgLQ0KICAgICAgICAgICAgICAgIGdldE1hdGVyaWFsVmFsdWUoYm9hcmRbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldLCBnYW1lU3RhZ2UpOw0KICAgICAgICB9DQogICAgICAgIGNhcHR1cmVTb3J0U2NvcmVTY3JhdGNoW2luZGV4XSA9IHNjb3JlOw0KICAgIH0NCg0KICAgIC8vIFN0YWJsZSBpbnNlcnRpb24gb3JkZXJpbmcgZXhhY3RseSBtYXRjaGVzIHRoZSBwcmV2aW91cyBudW1lcmljIGNvbXBhcmF0b3IuDQogICAgZm9yIChsZXQgaSA9IDE7IGkgPCBjYXB0dXJlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gY2FwdHVyZXNbaV07DQogICAgICAgIGNvbnN0IHNjb3JlID0gY2FwdHVyZVNvcnRTY29yZVNjcmF0Y2hbaV07DQogICAgICAgIGxldCBqID0gaSAtIDE7DQogICAgICAgIHdoaWxlIChqID49IDAgJiYgY2FwdHVyZVNvcnRTY29yZVNjcmF0Y2hbal0gPCBzY29yZSkgew0KICAgICAgICAgICAgY2FwdHVyZXNbaiArIDFdID0gY2FwdHVyZXNbal07DQogICAgICAgICAgICBjYXB0dXJlU29ydFNjb3JlU2NyYXRjaFtqICsgMV0gPSBjYXB0dXJlU29ydFNjb3JlU2NyYXRjaFtqXTsNCiAgICAgICAgICAgIGotLTsNCiAgICAgICAgfQ0KICAgICAgICBjYXB0dXJlc1tqICsgMV0gPSBtb3ZlOw0KICAgICAgICBjYXB0dXJlU29ydFNjb3JlU2NyYXRjaFtqICsgMV0gPSBzY29yZTsNCiAgICB9DQogICAgcmV0dXJuIGNhcHR1cmVzOw0KfTsNCg0KY29uc3QgcXVpZXNjZW5jZVBsYXkgPSAoDQogICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGgsIGJvYXJkSGFzaCA9IDANCikgPT4gew0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnF1aWVzY2VuY2VDYWxscysrOw0KICAgIGNvbnN0IHN0YW5kUGF0ID0gc3RhdGljU2VhcmNoRXZhbChiLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRIYXNoKTsNCg0KICAgIGlmIChxc0RlcHRoIDw9IDApIHJldHVybiBzdGFuZFBhdDsNCg0KICAgIGlmIChtYXhpbWl6aW5nKSB7DQogICAgICAgIGlmIChzdGFuZFBhdCA+PSBiZXRhKSByZXR1cm4gc3RhbmRQYXQ7DQogICAgICAgIGlmIChzdGFuZFBhdCA+IGFscGhhKSBhbHBoYSA9IHN0YW5kUGF0Ow0KICAgIH0gZWxzZSB7DQogICAgICAgIGlmIChzdGFuZFBhdCA8PSBhbHBoYSkgcmV0dXJuIHN0YW5kUGF0Ow0KICAgICAgICBpZiAoc3RhbmRQYXQgPCBiZXRhKSBiZXRhID0gc3RhbmRQYXQ7DQogICAgfQ0KDQogICAgY29uc3QgY2FwdHVyZXMgPSBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoKGIsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnF1aWVzY2VuY2VDYXB0dXJlTW92ZXMgKz0gY2FwdHVyZXMubGVuZ3RoOw0KICAgIGlmIChjYXB0dXJlcy5sZW5ndGggPT09IDApIHJldHVybiBzdGFuZFBhdDsNCg0KICAgIHNvcnRDYXB0dXJlc1BsYXkoY2FwdHVyZXMsIGIsIGdhbWVTdGFnZSk7DQoNCiAgICBsZXQgYmVzdEV2YWwgPSBzdGFuZFBhdDsNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNhcHR1cmVzLmxlbmd0aDsgaSsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBjYXB0dXJlc1tpXTsNCiAgICAgICAgY29uc3QgbW92aW5nUGllY2UgPSBiW21vdmVGcm9tUihtb3ZlKV1bbW92ZUZyb21DKG1vdmUpXTsNCiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSBtYWtlU2VhcmNoTW92ZShiLCBtb3ZlKTsNCiAgICAgICAgaWYgKGxlYXZlc093bktpbmdVbnNhZmUoYiwgY3VycmVudFBsYXllcikpIHsNCiAgICAgICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOw0KICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHBlcmZTdGF0cy5pbGxlZ2FsTW92ZXNTa2lwcGVkKys7CiAgICAgICAgICAgIGNvbnRpbnVlOw0KICAgICAgICB9DQogICAgICAgIGNvbnN0IG5leHRIYXNoID0gY2hpbGRCb2FyZEhhc2goYm9hcmRIYXNoLCBtb3ZlLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOw0KICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCsrOwogICAgICAgIGNvbnN0IG5leHRQbGF5ZXIgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgY29uc3QgdmFsdWUgPSBxdWllc2NlbmNlUGxheSgNCiAgICAgICAgICAgIGIsIGFscGhhLCBiZXRhLCBuZXh0UGxheWVyID09PSBzZWFyY2hJbml0aWF0b3IsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgcXNEZXB0aCAtIDEsIG5leHRIYXNoDQogICAgICAgICk7DQogICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOw0KDQogICAgICAgIGlmIChtYXhpbWl6aW5nKSB7DQogICAgICAgICAgICBpZiAodmFsdWUgPiBiZXN0RXZhbCkgYmVzdEV2YWwgPSB2YWx1ZTsNCiAgICAgICAgICAgIGlmICh2YWx1ZSA+IGFscGhhKSBhbHBoYSA9IHZhbHVlOw0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgaWYgKHZhbHVlIDwgYmVzdEV2YWwpIGJlc3RFdmFsID0gdmFsdWU7DQogICAgICAgICAgICBpZiAodmFsdWUgPCBiZXRhKSBiZXRhID0gdmFsdWU7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIGJyZWFrOw0KICAgIH0NCiAgICByZXR1cm4gYmVzdEV2YWw7DQp9Ow0KDQpjb25zdCBhbHBoYUJldGFQbGF5ID0gKA0KICAgIGIsIGQsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLA0KICAgIHNlYXJjaERlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gY3VycmVudFBsYXllciwgZ2FtZVN0YWdlID0gJ21pZCcsIGJvYXJkSGFzaCA9IDANCikgPT4gew0KICAgIGNvbnN0IG9yaWdpbmFsQWxwaGEgPSBhbHBoYTsNCiAgICBjb25zdCBvcmlnaW5hbEJldGEgPSBiZXRhOw0KDQogICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHsKICAgICAgICBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMrKzsKICAgICAgICBpZiAoIXBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdKSBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSA9IDA7CiAgICAgICAgcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0rKzsKICAgIH0KDQogICAgaWYgKGQgPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHF1aWVzY2VuY2VQbGF5KA0KICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgICAgICAgICBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgU0VBUkNIX1FVSUVTQ0VOQ0VfREVQVEgsIGJvYXJkSGFzaA0KICAgICAgICApOw0KICAgIH0NCg0KICAgIGNvbnN0IHR0S2V5ID0gbWFrZVNlYXJjaFRUS2V5KGIsIGN1cnJlbnRQbGF5ZXIsIGJvYXJkSGFzaCk7DQogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZSh0dEtleSk7DQogICAgbGV0IHR0TW92ZSA9IG51bGw7DQogICAgaWYgKHR0RW50cnkpIHsNCiAgICAgICAgdHRNb3ZlID0gdHRFbnRyeS5iZXN0TW92ZSB8fCBudWxsOw0KICAgICAgICBpZiAodHRFbnRyeS5kZXB0aCA+PSBkKSB7DQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAnZXhhY3QnKSByZXR1cm4gdHRFbnRyeS52YWx1ZTsNCiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICdsb3dlcmJvdW5kJyAmJiB0dEVudHJ5LnZhbHVlID49IGJldGEpIHJldHVybiB0dEVudHJ5LnZhbHVlOw0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ3VwcGVyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPD0gYWxwaGEpIHJldHVybiB0dEVudHJ5LnZhbHVlOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgY29uc3Qgc2VhcmNoSW5mbyA9IHByZXBhcmVTZWFyY2hJbmZvKGIsIGN1cnJlbnRQbGF5ZXIsIGZhbHNlKTsKICAgIGNvbnN0IGFiUGllY2VzSW5mbyA9IHNlYXJjaEluZm8ucGllY2VzSW5mbzsNCiAgICBjb25zdCBhYkJvYXJkSW5mbyA9IHNlYXJjaEluZm8uYm9hcmRJbmZvOw0KICAgIGNvbnN0IGluQ2hlY2sgPSBzZWFyY2hJbmZvLmluQ2hlY2sgfHwNCiAgICAgICAgKGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnICYmIGFiQm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwNCiAgICAgICAgKGN1cnJlbnRQbGF5ZXIgPT09ICdibGFjaycgJiYgYWJCb2FyZEluZm8uYmxhY2tJc0luQ2hlY2spOw0KICAgIGNvbnN0IHRlcm1pbmFsU2NvcmUgPSAoKSA9PiB7DQogICAgICAgIGNvbnN0IGlzSW5pdGlhdG9yV2lubmVyID0gY3VycmVudFBsYXllciAhPT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7DQogICAgICAgIHJldHVybiBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogKHNlYXJjaERlcHRoIC0gZCkpOw0KICAgIH07DQoNCiAgICBpZiAoIXNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdCB8fCBzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3QubGVuZ3RoID09PSAwKSB7DQogICAgICAgIGNvbnN0IGdhbWVTdGF0ZSA9IGFiQm9hcmRJbmZvLmdhbWVTdGF0ZTsNCiAgICAgICAgaWYgKGdhbWVTdGF0ZSAmJiAoZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ2NoZWNrbWF0ZScgfHwgZ2FtZVN0YXRlLnN0YXR1cyA9PT0gJ3N0YWxlbWF0ZScpKSB7DQogICAgICAgICAgICBjb25zdCBpc0luaXRpYXRvcldpbm5lciA9IGdhbWVTdGF0ZS53aW5uZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgICAgIGNvbnN0IGJhc2VTY29yZSA9IGlzSW5pdGlhdG9yV2lubmVyID8gMTAwMDAwIDogLTEwMDAwMDsNCiAgICAgICAgICAgIHJldHVybiBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogKHNlYXJjaERlcHRoIC0gZCkpOw0KICAgICAgICB9DQogICAgICAgIHJldHVybiB0ZXJtaW5hbFNjb3JlKCk7DQogICAgfQ0KDQogICAgbGV0IG1vdmVzID0gc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0Ow0KICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSB7CiAgICAgICAgaWYgKCFwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0pIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSA9IDA7CiAgICAgICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdICs9IG1vdmVzLmxlbmd0aDsKICAgIH0KDQogICAgY29uc3Qga2lsbGVyc0F0RGVwdGggPSBraWxsZXJNb3Zlc1tkXSB8fCBbbnVsbCwgbnVsbF07DQogICAgbW92ZXMgPSBzb3J0TW92ZXNQbGF5KA0KICAgICAgICBtb3ZlcywgYiwgY3VycmVudFBsYXllciwgYWJQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGFiQm9hcmRJbmZvLA0KICAgICAgICB0dE1vdmUsIGtpbGxlcnNBdERlcHRoLCBpbkNoZWNrDQogICAgKTsNCiAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUyAmJiBtb3Zlcy5sZW5ndGgpIHsNCiAgICAgICAgcmVjb3JkVG9wTW92ZVNvdXJjZShkLCBiLCBtb3Zlc1swXSwgdHRNb3ZlLCBraWxsZXJzQXREZXB0aCk7DQogICAgfQ0KDQogICAgbGV0IGJlc3RFdmFsID0gbWF4aW1pemluZyA/IC1JbmZpbml0eSA6IEluZmluaXR5Ow0KICAgIGxldCBiZXN0TW92ZSA9IG51bGw7DQogICAgbGV0IGxlZ2FsTW92ZXNGb3VuZCA9IDA7DQoNCiAgICBmb3IgKGxldCBtb3ZlSW5kZXggPSAwOyBtb3ZlSW5kZXggPCBtb3Zlcy5sZW5ndGg7IG1vdmVJbmRleCsrKSB7DQogICAgICAgIGNvbnN0IG1vdmUgPSBtb3Zlc1ttb3ZlSW5kZXhdOw0KICAgICAgICBjb25zdCBpc0NhcHR1cmUgPSAhIWJbbW92ZVRvUihtb3ZlKV1bbW92ZVRvQyhtb3ZlKV07DQogICAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYlttb3ZlRnJvbVIobW92ZSldW21vdmVGcm9tQyhtb3ZlKV07DQogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZVNlYXJjaE1vdmUoYiwgbW92ZSk7DQogICAgICAgIGlmIChsZWF2ZXNPd25LaW5nVW5zYWZlKGIsIGN1cnJlbnRQbGF5ZXIsIG1vdmUsIGluQ2hlY2spKSB7DQogICAgICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCiAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCsrOwogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgICAgbGVnYWxNb3Zlc0ZvdW5kKys7DQogICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTICYmIGxlZ2FsTW92ZXNGb3VuZCA9PT0gMSkgew0KICAgICAgICAgICAgcmVjb3JkRmlyc3RMZWdhbE1vdmUoZCwgbW92ZUluZGV4KTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCsrOwogICAgICAgIGNvbnN0IG5leHRQbGF5ZXIgPSBjdXJyZW50UGxheWVyID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgICAgICAgY29uc3QgbmV4dE1heGltaXppbmcgPSBuZXh0UGxheWVyID09PSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgIGNvbnN0IGNhblByb2JlID0gU0VBUkNIX0VOQUJMRV9OT05fUk9PVF9QVlMgJiYNCiAgICAgICAgICAgIGxlZ2FsTW92ZXNGb3VuZCA+IDEgJiYNCiAgICAgICAgICAgIE51bWJlci5pc0Zpbml0ZShtYXhpbWl6aW5nID8gYWxwaGEgOiBiZXRhKTsNCiAgICAgICAgbGV0IHZhbHVlOw0KICAgICAgICBpZiAoY2FuUHJvYmUpIHsNCiAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSB7DQogICAgICAgICAgICAgICAgcGVyZlN0YXRzLnB2c1Byb2JlcysrOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgY29uc3QgcHJvYmVTdGFydE5vZGVzID0gU0VBUkNIX0NPTExFQ1RfTUVUUklDUyA/IHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscyA6IDA7DQogICAgICAgICAgICB2YWx1ZSA9IG1heGltaXppbmcNCiAgICAgICAgICAgICAgICA/IGFscGhhQmV0YVBsYXkoDQogICAgICAgICAgICAgICAgICAgIGIsIGQgLSAxLCBhbHBoYSwgYWxwaGEgKyBTRUFSQ0hfTlVMTF9XSU5ET1dfRVBTLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBuZXh0SGFzaA0KICAgICAgICAgICAgICAgICkNCiAgICAgICAgICAgICAgICA6IGFscGhhQmV0YVBsYXkoDQogICAgICAgICAgICAgICAgICAgIGIsIGQgLSAxLCBiZXRhIC0gU0VBUkNIX05VTExfV0lORE9XX0VQUywgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgbmV4dEhhc2gNCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHsNCiAgICAgICAgICAgICAgICBwZXJmU3RhdHMucHZzUHJvYmVOb2RlcyArPSBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMgLSBwcm9iZVN0YXJ0Tm9kZXM7DQogICAgICAgICAgICB9DQoNCiAgICAgICAgICAgIGNvbnN0IG5lZWRzUmVzZWFyY2ggPSBtYXhpbWl6aW5nDQogICAgICAgICAgICAgICAgPyB2YWx1ZSA+IGFscGhhICYmIHZhbHVlIDwgYmV0YQ0KICAgICAgICAgICAgICAgIDogdmFsdWUgPCBiZXRhICYmIHZhbHVlID4gYWxwaGE7DQogICAgICAgICAgICBpZiAobmVlZHNSZXNlYXJjaCkgew0KICAgICAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSB7DQogICAgICAgICAgICAgICAgICAgIHBlcmZTdGF0cy5wdnNSZXNlYXJjaGVzKys7DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgICAgIGNvbnN0IHJlc2VhcmNoU3RhcnROb2RlcyA9IFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MgPyBwZXJmU3RhdHMuYWxwaGFCZXRhQ2FsbHMgOiAwOw0KICAgICAgICAgICAgICAgIHZhbHVlID0gYWxwaGFCZXRhUGxheSgNCiAgICAgICAgICAgICAgICAgICAgYiwgZCAtIDEsIGFscGhhLCBiZXRhLCBuZXh0TWF4aW1pemluZywgbmV4dFBsYXllciwNCiAgICAgICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCBuZXh0SGFzaA0KICAgICAgICAgICAgICAgICk7DQogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHsNCiAgICAgICAgICAgICAgICAgICAgcGVyZlN0YXRzLnB2c1Jlc2VhcmNoTm9kZXMgKz0gcGVyZlN0YXRzLmFscGhhQmV0YUNhbGxzIC0gcmVzZWFyY2hTdGFydE5vZGVzOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIHZhbHVlID0gYWxwaGFCZXRhUGxheSgNCiAgICAgICAgICAgICAgICBiLCBkIC0gMSwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLA0KICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgbmV4dEhhc2gNCiAgICAgICAgICAgICk7DQogICAgICAgIH0NCiAgICAgICAgdW5tYWtlU2VhcmNoTW92ZShiLCBtb3ZlLCBjYXB0dXJlZCk7DQoNCiAgICAgICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgICAgIGlmICh2YWx1ZSA+IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSB2YWx1ZTsNCiAgICAgICAgICAgICAgICBiZXN0TW92ZSA9IG1vdmU7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBhbHBoYSA9IE1hdGgubWF4KGFscGhhLCB2YWx1ZSk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAodmFsdWUgPCBiZXN0RXZhbCkgew0KICAgICAgICAgICAgICAgIGJlc3RFdmFsID0gdmFsdWU7DQogICAgICAgICAgICAgICAgYmVzdE1vdmUgPSBtb3ZlOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYmV0YSA9IE1hdGgubWluKGJldGEsIHZhbHVlKTsNCiAgICAgICAgfQ0KDQogICAgICAgIGlmIChiZXRhIDw9IGFscGhhKSB7DQogICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgewogICAgICAgICAgICAgICAgaWYgKCFwZXJmU3RhdHMuY3V0b2Zmc1tkXSkgcGVyZlN0YXRzLmN1dG9mZnNbZF0gPSAwOwogICAgICAgICAgICAgICAgcGVyZlN0YXRzLmN1dG9mZnNbZF0rKzsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUyAmJiBsZWdhbE1vdmVzRm91bmQgPT09IDEpIHsNCiAgICAgICAgICAgICAgICByZWNvcmRGaXJzdExlZ2FsQ3V0b2ZmKGQpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKCFpc0NhcHR1cmUpIHsNCiAgICAgICAgICAgICAgICBzdG9yZUtpbGxlck1vdmUoZCwgbW92ZSk7DQogICAgICAgICAgICAgICAgYWRkSGlzdG9yeVNjb3JlKG1vdmUsIGQpOw0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgYnJlYWs7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBpZiAobGVnYWxNb3Zlc0ZvdW5kID09PSAwKSByZXR1cm4gdGVybWluYWxTY29yZSgpOw0KDQogICAgbGV0IGZsYWc7DQogICAgaWYgKGJlc3RFdmFsIDw9IG9yaWdpbmFsQWxwaGEpIGZsYWcgPSAndXBwZXJib3VuZCc7DQogICAgZWxzZSBpZiAoYmVzdEV2YWwgPj0gb3JpZ2luYWxCZXRhKSBmbGFnID0gJ2xvd2VyYm91bmQnOw0KICAgIGVsc2UgZmxhZyA9ICdleGFjdCc7DQogICAgdHJhbnNwb3NpdGlvblRhYmxlLnN0b3JlKHR0S2V5LCBkLCBiZXN0RXZhbCwgZmxhZywgYmVzdE1vdmUsIG51bGwpOw0KICAgIHJldHVybiBiZXN0RXZhbDsNCn07DQoNCmNvbnN0IHF1aWVzY2VuY2UgPSAoDQogICAgYiwgYWxwaGEsIGJldGEsIG1heGltaXppbmcsIGN1cnJlbnRQbGF5ZXIsDQogICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGgsIGJvYXJkSGFzaCA9IDANCikgPT4gew0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnF1aWVzY2VuY2VDYWxscysrOw0KICAgIGNvbnN0IHN0YW5kUGF0ID0gc3RhdGljU2VhcmNoRXZhbChiLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgYm9hcmRIYXNoKTsNCg0KICAgIGlmIChxc0RlcHRoIDw9IDApIHsNCiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KDQogICAgaWYgKG1heGltaXppbmcpIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0ID49IGJldGEpIHsNCiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBzdGFuZFBhdCwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICB9DQogICAgICAgIGlmIChzdGFuZFBhdCA+IGFscGhhKSB7DQogICAgICAgICAgICBhbHBoYSA9IHN0YW5kUGF0Ow0KICAgICAgICB9DQogICAgfSBlbHNlIHsNCiAgICAgICAgaWYgKHN0YW5kUGF0IDw9IGFscGhhKSB7DQogICAgICAgICAgICByZXR1cm4geyB2YWx1ZTogc3RhbmRQYXQsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoc3RhbmRQYXQgPCBiZXRhKSB7DQogICAgICAgICAgICBiZXRhID0gc3RhbmRQYXQ7DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBsZXQgY2FwdHVyZXMgPSBnZW5lcmF0ZUNhcHR1cmVzRm9yU2VhcmNoKGIsIGN1cnJlbnRQbGF5ZXIpOw0KICAgIGlmIChTRUFSQ0hfUFJPRklMRSkgcGVyZlN0YXRzLnF1aWVzY2VuY2VDYXB0dXJlTW92ZXMgKz0gY2FwdHVyZXMubGVuZ3RoOw0KICAgIGlmIChjYXB0dXJlcy5sZW5ndGggPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHN0YW5kUGF0LCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgfQ0KDQogICAgLy8gTVZWLUxWQe+8muWFiOivleWQg+Wkp+WtkA0KICAgIGNhcHR1cmVzLnNvcnQoKGEsIGJNb3ZlKSA9PiB7DQogICAgICAgIGNvbnN0IHNjb3JlQSA9DQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbbW92ZVRvUihhKV1bbW92ZVRvQyhhKV0sIGdhbWVTdGFnZSkgKiAxNiAtDQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbbW92ZUZyb21SKGEpXVttb3ZlRnJvbUMoYSldLCBnYW1lU3RhZ2UpOw0KICAgICAgICBjb25zdCBzY29yZUIgPQ0KICAgICAgICAgICAgZ2V0TWF0ZXJpYWxWYWx1ZShiW21vdmVUb1IoYk1vdmUpXVttb3ZlVG9DKGJNb3ZlKV0sIGdhbWVTdGFnZSkgKiAxNiAtDQogICAgICAgICAgICBnZXRNYXRlcmlhbFZhbHVlKGJbbW92ZUZyb21SKGJNb3ZlKV1bbW92ZUZyb21DKGJNb3ZlKV0sIGdhbWVTdGFnZSk7DQogICAgICAgIHJldHVybiBzY29yZUIgLSBzY29yZUE7DQogICAgfSk7DQoNCiAgICBsZXQgYmVzdEV2YWwgPSBzdGFuZFBhdDsNCiAgICBsZXQgYmVzdE1vdmVTZXF1ZW5jZSA9IFtdOw0KDQogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjYXB0dXJlcy5sZW5ndGg7IGkrKykgew0KICAgICAgICBjb25zdCBtb3ZlID0gY2FwdHVyZXNbaV07DQogICAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gYlttb3ZlRnJvbVIobW92ZSldW21vdmVGcm9tQyhtb3ZlKV07DQogICAgICAgIGNvbnN0IGNhcHR1cmVkID0gbWFrZVNlYXJjaE1vdmUoYiwgbW92ZSk7DQogICAgICAgIGlmIChsZWF2ZXNPd25LaW5nVW5zYWZlKGIsIGN1cnJlbnRQbGF5ZXIpKSB7DQogICAgICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCiAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCsrOwogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHBlcmZTdGF0cy5sZWdhbE1vdmVzU2VhcmNoZWQrKzsKICAgICAgICBjb25zdCBuZXh0UGxheWVyID0gY3VycmVudFBsYXllciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgIGNvbnN0IG5leHRNYXhpbWl6aW5nID0gbmV4dFBsYXllciA9PT0gc2VhcmNoSW5pdGlhdG9yOw0KICAgICAgICBjb25zdCByZXN1bHQgPSBxdWllc2NlbmNlKA0KICAgICAgICAgICAgYiwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLA0KICAgICAgICAgICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIHFzRGVwdGggLSAxLCBuZXh0SGFzaA0KICAgICAgICApOw0KICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCg0KICAgICAgICBpZiAobWF4aW1pemluZykgew0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGJlc3RFdmFsKSB7DQogICAgICAgICAgICAgICAgYmVzdEV2YWwgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsNCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlVG9PYmplY3QobW92ZSksIC4uLihyZXN1bHQubW92ZVNlcXVlbmNlIHx8IFtdKV07DQogICAgICAgICAgICAgICAgfQ0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHJlc3VsdC52YWx1ZSA+IGFscGhhKSB7DQogICAgICAgICAgICAgICAgYWxwaGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSkgew0KICAgICAgICAgICAgICAgICAgICBiZXN0TW92ZVNlcXVlbmNlID0gW21vdmVUb09iamVjdChtb3ZlKSwgLi4uKHJlc3VsdC5tb3ZlU2VxdWVuY2UgfHwgW10pXTsNCiAgICAgICAgICAgICAgICB9DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmV0YSkgew0KICAgICAgICAgICAgICAgIGJldGEgPSByZXN1bHQudmFsdWU7DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgIGJyZWFrOw0KICAgICAgICB9DQogICAgfQ0KDQogICAgcmV0dXJuIHsgdmFsdWU6IGJlc3RFdmFsLCBtb3ZlU2VxdWVuY2U6IFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPyBiZXN0TW92ZVNlcXVlbmNlIDogW10gfTsNCn07DQoNCi8vIGFscGhhQmV0Ye+8muivhOS8sOWni+e7iOS7jiBzZWFyY2hJbml0aWF0b3Ig6KeS5bqm77ybVFQgKyBraWxsZXIvaGlzdG9yeSArIOepuuedgOWJquaenSArIExNUiArIFFTDQovLyBib2FyZEhhc2jvvJrlop7ph48gWm9icmlzdCDlsYDpnaLlk4jluIzvvIjkuI3lkKvooYzmo4vmlrnvvInvvJvml6fmqKHlvI/kuIvlj6/kvKAgMA0KY29uc3QgYWxwaGFCZXRhID0gKA0KICAgIGIsIGQsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLA0KICAgIHNlYXJjaERlcHRoID0gMCwgc2VhcmNoSW5pdGlhdG9yID0gY3VycmVudFBsYXllciwgZ2FtZVN0YWdlID0gJ21pZCcsDQogICAgYWxsb3dOdWxsID0gdHJ1ZSwgYm9hcmRIYXNoID0gMA0KKSA9PiB7DQogICAgY29uc3Qgb3JpZ2luYWxBbHBoYSA9IGFscGhhOw0KICAgIGNvbnN0IG9yaWdpbmFsQmV0YSA9IGJldGE7DQoNCiAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgewogICAgICAgIHBlcmZTdGF0cy5hbHBoYUJldGFDYWxscysrOwogICAgICAgIGlmICghcGVyZlN0YXRzLm5vZGVzU2VhcmNoZWRbZF0pIHBlcmZTdGF0cy5ub2Rlc1NlYXJjaGVkW2RdID0gMDsKICAgICAgICBwZXJmU3RhdHMubm9kZXNTZWFyY2hlZFtkXSsrOwogICAgfQoNCiAgICAvLyDlj7boioLngrnvvJrlrozmlbTlvaLlir/or4TkvLAgKyDlkIPlrZDpnZnpu5jmkJzntKINCiAgICBpZiAoZCA9PT0gMCkgew0KICAgICAgICByZXR1cm4gcXVpZXNjZW5jZSgNCiAgICAgICAgICAgIGIsIGFscGhhLCBiZXRhLCBtYXhpbWl6aW5nLCBjdXJyZW50UGxheWVyLA0KICAgICAgICAgICAgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIFNFQVJDSF9RVUlFU0NFTkNFX0RFUFRILCBib2FyZEhhc2gNCiAgICAgICAgKTsNCiAgICB9DQoNCiAgICAvLyDnva7mjaLooajmjqLmtYvvvIhrZXkg5ZCr6KGM5qOL5pa577yM6YG/5YWN5ZCM5b2i5LiN5ZCM6LWw5pa55Yay56qB77yJDQogICAgY29uc3QgdHRLZXkgPSBtYWtlU2VhcmNoVFRLZXkoYiwgY3VycmVudFBsYXllciwgYm9hcmRIYXNoKTsNCiAgICBjb25zdCB0dEVudHJ5ID0gdHJhbnNwb3NpdGlvblRhYmxlLnJldHJpZXZlKHR0S2V5KTsNCiAgICBsZXQgdHRNb3ZlID0gbnVsbDsNCiAgICBpZiAodHRFbnRyeSkgew0KICAgICAgICB0dE1vdmUgPSB0dEVudHJ5LmJlc3RNb3ZlIHx8IG51bGw7DQogICAgICAgIGlmICh0dEVudHJ5LmRlcHRoID49IGQpIHsNCiAgICAgICAgICAgIGlmICh0dEVudHJ5LmZsYWcgPT09ICdleGFjdCcpIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgICAgICAgICB2YWx1ZTogdHRFbnRyeS52YWx1ZSwNCiAgICAgICAgICAgICAgICAgICAgbW92ZVNlcXVlbmNlOiBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFDQogICAgICAgICAgICAgICAgICAgICAgICA/ICh0dEVudHJ5Lm1vdmVTZXF1ZW5jZSB8fCAodHRNb3ZlID8gW21vdmVUb09iamVjdCh0dE1vdmUpXSA6IFtdKSkNCiAgICAgICAgICAgICAgICAgICAgICAgIDogW10NCiAgICAgICAgICAgICAgICB9Ow0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgaWYgKHR0RW50cnkuZmxhZyA9PT0gJ2xvd2VyYm91bmQnICYmIHR0RW50cnkudmFsdWUgPj0gYmV0YSkgew0KICAgICAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiB0dEVudHJ5LnZhbHVlLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAodHRFbnRyeS5mbGFnID09PSAndXBwZXJib3VuZCcgJiYgdHRFbnRyeS52YWx1ZSA8PSBhbHBoYSkgew0KICAgICAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiB0dEVudHJ5LnZhbHVlLCBtb3ZlU2VxdWVuY2U6IFtdIH07DQogICAgICAgICAgICB9DQogICAgICAgIH0NCiAgICB9DQoNCiAgICBjb25zdCBzZWFyY2hJbmZvID0gcHJlcGFyZVNlYXJjaEluZm8oYiwgY3VycmVudFBsYXllcik7DQogICAgY29uc3QgYWJQaWVjZXNJbmZvID0gc2VhcmNoSW5mby5waWVjZXNJbmZvOw0KICAgIGNvbnN0IGFiQm9hcmRJbmZvID0gc2VhcmNoSW5mby5ib2FyZEluZm87DQogICAgY29uc3QgY3VycmVudFBsYXllckNvbG9yID0gY3VycmVudFBsYXllcjsNCiAgICBjb25zdCBpbkNoZWNrID0gc2VhcmNoSW5mby5pbkNoZWNrIHx8DQogICAgICAgICAgICAgICAgICAgIChjdXJyZW50UGxheWVyQ29sb3IgPT09ICdyZWQnICYmIGFiQm9hcmRJbmZvLnJlZElzSW5DaGVjaykgfHwNCiAgICAgICAgICAgICAgICAgICAgKGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ2JsYWNrJyAmJiBhYkJvYXJkSW5mby5ibGFja0lzSW5DaGVjayk7DQoNCiAgICBjb25zdCB0ZXJtaW5hbFNjb3JlID0gKG1hdGVJbkNoZWNrKSA9PiB7DQogICAgICAgIGNvbnN0IGlzSW5pdGlhdG9yV2lubmVyID0gY3VycmVudFBsYXllckNvbG9yICE9PSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgIGNvbnN0IGJhc2VTY29yZSA9IGlzSW5pdGlhdG9yV2lubmVyID8gMTAwMDAwIDogLTEwMDAwMDsNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgIHZhbHVlOiBiYXNlU2NvcmUgKyAoaXNJbml0aWF0b3JXaW5uZXIgPyBkIDogKHNlYXJjaERlcHRoIC0gZCkpLA0KICAgICAgICAgICAgbW92ZVNlcXVlbmNlOiBbXSwNCiAgICAgICAgICAgIHRlcm1pbmFsOiBtYXRlSW5DaGVjayA/ICdjaGVja21hdGUnIDogJ3N0YWxlbWF0ZScNCiAgICAgICAgfTsNCiAgICB9Ow0KDQogICAgLy8g5peg5Lyq5ZCI5rOV552A77ya55u05o6l57uI5bGA77yI5p6B5bCR6KeB77yb6YCa5bi46Iez5bCR5pyJ5bCG55qE6LWw5Yqo77yJDQogICAgaWYgKCFzZWFyY2hJbmZvLmxlZ2FsTW92ZUxpc3QgfHwgc2VhcmNoSW5mby5sZWdhbE1vdmVMaXN0Lmxlbmd0aCA9PT0gMCkgew0KICAgICAgICBjb25zdCBnYW1lU3RhdGUgPSBhYkJvYXJkSW5mby5nYW1lU3RhdGU7DQogICAgICAgIGlmIChnYW1lU3RhdGUgJiYgKGdhbWVTdGF0ZS5zdGF0dXMgPT09ICdjaGVja21hdGUnIHx8IGdhbWVTdGF0ZS5zdGF0dXMgPT09ICdzdGFsZW1hdGUnKSkgew0KICAgICAgICAgICAgY29uc3QgaXNJbml0aWF0b3JXaW5uZXIgPSBnYW1lU3RhdGUud2lubmVyID09PSBzZWFyY2hJbml0aWF0b3I7DQogICAgICAgICAgICBjb25zdCBiYXNlU2NvcmUgPSBpc0luaXRpYXRvcldpbm5lciA/IDEwMDAwMCA6IC0xMDAwMDA7DQogICAgICAgICAgICBjb25zdCBzdGVwc0Zyb21Sb290ID0gc2VhcmNoRGVwdGggLSBkOw0KICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IGJhc2VTY29yZSArIChpc0luaXRpYXRvcldpbm5lciA/IGQgOiBzdGVwc0Zyb21Sb290KSwgbW92ZVNlcXVlbmNlOiBbXSB9Ow0KICAgICAgICB9DQogICAgICAgIHJldHVybiB0ZXJtaW5hbFNjb3JlKGluQ2hlY2spOw0KICAgIH0NCg0KICAgIC8vIOepuuedgOWJquaene+8muS7hSBtYXhpbWl6aW5n77yb5a6M5pW06K+E5Lyw5LiL5L+d5a6I5ZCv55SoDQogICAgaWYgKA0KICAgICAgICBmYWxzZSAmJg0KICAgICAgICBhbGxvd051bGwgJiYNCiAgICAgICAgbWF4aW1pemluZyAmJg0KICAgICAgICBkID49IDMgJiYNCiAgICAgICAgIWluQ2hlY2sgJiYNCiAgICAgICAgY2FuRG9OdWxsTW92ZShiLCBjdXJyZW50UGxheWVyQ29sb3IpDQogICAgKSB7DQogICAgICAgIGNvbnN0IG51bGxSID0gZCA+PSA2ID8gMyA6IDI7DQogICAgICAgIGNvbnN0IG51bGxEZXB0aCA9IGQgLSAxIC0gbnVsbFI7DQogICAgICAgIGlmIChudWxsRGVwdGggPj0gMCkgew0KICAgICAgICAgICAgY29uc3QgbnVsbFBsYXllciA9IGN1cnJlbnRQbGF5ZXJDb2xvciA9PT0gJ3JlZCcgPyAnYmxhY2snIDogJ3JlZCc7DQogICAgICAgICAgICBjb25zdCBudWxsTWF4aW1pemluZyA9IG51bGxQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCiAgICAgICAgICAgIC8vIOepuuedgOS4jeaUueWPmOWxgOmdouWTiOW4jO+8jOS7heihjOaji+aWueWPmOWMlu+8iFRUIGtleSDlkKsgc2lkZe+8iQ0KICAgICAgICAgICAgY29uc3QgbnVsbFJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgICBiLCBudWxsRGVwdGgsIGJldGEgLSAxZS02LCBiZXRhLCBudWxsTWF4aW1pemluZywgbnVsbFBsYXllciwNCiAgICAgICAgICAgICAgICBzZWFyY2hEZXB0aCwgc2VhcmNoSW5pdGlhdG9yLCBnYW1lU3RhZ2UsIGZhbHNlLCBib2FyZEhhc2gNCiAgICAgICAgICAgICk7DQogICAgICAgICAgICBpZiAobnVsbFJlc3VsdC52YWx1ZSA+PSBiZXRhKSB7DQogICAgICAgICAgICAgICAgcmV0dXJuIHsgdmFsdWU6IG51bGxSZXN1bHQudmFsdWUsIG1vdmVTZXF1ZW5jZTogW10gfTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIGxldCBtb3ZlcyA9IHNlYXJjaEluZm8ubGVnYWxNb3ZlTGlzdDsNCg0KICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSB7CiAgICAgICAgaWYgKCFwZXJmU3RhdHMubW92ZXNHZW5lcmF0ZWRbZF0pIHBlcmZTdGF0cy5tb3Zlc0dlbmVyYXRlZFtkXSA9IDA7CiAgICAgICAgcGVyZlN0YXRzLm1vdmVzR2VuZXJhdGVkW2RdICs9IG1vdmVzLmxlbmd0aDsKICAgIH0KDQogICAgY29uc3Qga2lsbGVyc0F0RGVwdGggPSAoa2lsbGVyTW92ZXNbZF0gfHwgW251bGwsIG51bGxdKTsNCiAgICBtb3ZlcyA9IHNvcnRNb3Zlc0Zhc3QobW92ZXMsIGIsIGN1cnJlbnRQbGF5ZXJDb2xvciwgYWJQaWVjZXNJbmZvLCBnYW1lU3RhZ2UsIGFiQm9hcmRJbmZvLCB7DQogICAgICAgIHR0TW92ZSwNCiAgICAgICAga2lsbGVyczoga2lsbGVyc0F0RGVwdGgNCiAgICB9KTsNCiAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUyAmJiBtb3Zlcy5sZW5ndGgpIHsNCiAgICAgICAgcmVjb3JkVG9wTW92ZVNvdXJjZShkLCBiLCBtb3Zlc1swXSwgdHRNb3ZlLCBraWxsZXJzQXREZXB0aCk7DQogICAgfQ0KDQogICAgY29uc3Qgc3RvcmVUVCA9ICh2YWx1ZSwgYmVzdE1vdmUsIG1vdmVTZXF1ZW5jZSkgPT4gew0KICAgICAgICBsZXQgZmxhZzsNCiAgICAgICAgaWYgKHZhbHVlIDw9IG9yaWdpbmFsQWxwaGEpIGZsYWcgPSAndXBwZXJib3VuZCc7DQogICAgICAgIGVsc2UgaWYgKHZhbHVlID49IG9yaWdpbmFsQmV0YSkgZmxhZyA9ICdsb3dlcmJvdW5kJzsNCiAgICAgICAgZWxzZSBmbGFnID0gJ2V4YWN0JzsNCiAgICAgICAgdHJhbnNwb3NpdGlvblRhYmxlLnN0b3JlKHR0S2V5LCBkLCB2YWx1ZSwgZmxhZywgYmVzdE1vdmUsIFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPyBtb3ZlU2VxdWVuY2UgOiBudWxsKTsNCiAgICB9Ow0KDQogICAgbGV0IGJlc3RFdmFsID0gbWF4aW1pemluZyA/IC1JbmZpbml0eSA6IEluZmluaXR5Ow0KICAgIGxldCBiZXN0TW92ZSA9IG51bGw7DQogICAgbGV0IGJlc3RNb3ZlU2VxdWVuY2UgPSBbXTsNCiAgICBsZXQgbGVnYWxNb3Zlc0ZvdW5kID0gMDsNCg0KICAgIGZvciAobGV0IG1vdmVJbmRleCA9IDA7IG1vdmVJbmRleCA8IG1vdmVzLmxlbmd0aDsgbW92ZUluZGV4KyspIHsNCiAgICAgICAgY29uc3QgbW92ZSA9IG1vdmVzW21vdmVJbmRleF07DQogICAgICAgIGNvbnN0IGlzQ2FwdHVyZSA9ICEhYlttb3ZlVG9SKG1vdmUpXVttb3ZlVG9DKG1vdmUpXTsNCiAgICAgICAgY29uc3QgaXNUVE1vdmUgPSB0dE1vdmUgJiYgaXNTYW1lTW92ZShtb3ZlLCB0dE1vdmUpOw0KICAgICAgICBjb25zdCBpc0tpbGxlciA9DQogICAgICAgICAgICBpc1NhbWVNb3ZlKG1vdmUsIGtpbGxlcnNBdERlcHRoWzBdKSB8fA0KICAgICAgICAgICAgaXNTYW1lTW92ZShtb3ZlLCBraWxsZXJzQXREZXB0aFsxXSk7DQoNCiAgICAgICAgLy8gTE1S77ya6Z2g5ZCO55qE5a6J6Z2Z552A5rOV6ZmN5rexIDHvvIjlrozmlbTor4TkvLDkuIvkv53lrojvvIkNCiAgICAgICAgLy8gbW92ZUluZGV4IOWQq+S8quWQiOazleW6j++8m+mdnuazleedgOi3s+i/h+WQjueVpeWBj+S/neWuiO+8iOWwkemZjea3se+8ie+8jOS4jeW9seWTjeato+ehruaApw0KICAgICAgICBsZXQgcmVkdWN0aW9uID0gMDsNCiAgICAgICAgaWYgKA0KICAgICAgICAgICAgZmFsc2UgJiYNCiAgICAgICAgICAgIGQgPj0gNCAmJg0KICAgICAgICAgICAgbW92ZUluZGV4ID49IDQgJiYNCiAgICAgICAgICAgICFpbkNoZWNrICYmDQogICAgICAgICAgICAhaXNDYXB0dXJlICYmDQogICAgICAgICAgICAhaXNUVE1vdmUgJiYNCiAgICAgICAgICAgICFpc0tpbGxlcg0KICAgICAgICApIHsNCiAgICAgICAgICAgIHJlZHVjdGlvbiA9IDE7DQogICAgICAgIH0NCg0KICAgICAgICBjb25zdCBtb3ZpbmdQaWVjZSA9IGJbbW92ZUZyb21SKG1vdmUpXVttb3ZlRnJvbUMobW92ZSldOw0KICAgICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUpOw0KICAgICAgICBpZiAobGVhdmVzT3duS2luZ1Vuc2FmZShiLCBjdXJyZW50UGxheWVyQ29sb3IsIG1vdmUsIGluQ2hlY2spKSB7DQogICAgICAgICAgICB1bm1ha2VTZWFyY2hNb3ZlKGIsIG1vdmUsIGNhcHR1cmVkKTsNCiAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSBwZXJmU3RhdHMuaWxsZWdhbE1vdmVzU2tpcHBlZCsrOwogICAgICAgICAgICBjb250aW51ZTsNCiAgICAgICAgfQ0KICAgICAgICBjb25zdCBuZXh0SGFzaCA9IGNoaWxkQm9hcmRIYXNoKGJvYXJkSGFzaCwgbW92ZSwgbW92aW5nUGllY2UsIGNhcHR1cmVkKTsNCiAgICAgICAgbGVnYWxNb3Zlc0ZvdW5kKys7DQogICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTICYmIGxlZ2FsTW92ZXNGb3VuZCA9PT0gMSkgew0KICAgICAgICAgICAgcmVjb3JkRmlyc3RMZWdhbE1vdmUoZCwgbW92ZUluZGV4KTsNCiAgICAgICAgfQ0KICAgICAgICBpZiAoU0VBUkNIX0NPTExFQ1RfTUVUUklDUykgcGVyZlN0YXRzLmxlZ2FsTW92ZXNTZWFyY2hlZCsrOwoNCiAgICAgICAgY29uc3QgbmV4dFBsYXllciA9IGN1cnJlbnRQbGF5ZXIgPT09ICdyZWQnID8gJ2JsYWNrJyA6ICdyZWQnOw0KICAgICAgICBjb25zdCBuZXh0TWF4aW1pemluZyA9IG5leHRQbGF5ZXIgPT09IHNlYXJjaEluaXRpYXRvcjsNCg0KICAgICAgICBsZXQgcmVzdWx0Ow0KICAgICAgICBpZiAocmVkdWN0aW9uID4gMCkgew0KICAgICAgICAgICAgY29uc3QgcmVkdWNlZERlcHRoID0gTWF0aC5tYXgoMCwgZCAtIDEgLSByZWR1Y3Rpb24pOw0KICAgICAgICAgICAgcmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgICAgIGIsIHJlZHVjZWREZXB0aCwgYWxwaGEsIGJldGEsIG5leHRNYXhpbWl6aW5nLCBuZXh0UGxheWVyLA0KICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgdHJ1ZSwgbmV4dEhhc2gNCiAgICAgICAgICAgICk7DQogICAgICAgICAgICBjb25zdCBuZWVkUmVzZWFyY2ggPSBtYXhpbWl6aW5nDQogICAgICAgICAgICAgICAgPyByZXN1bHQudmFsdWUgPiBhbHBoYQ0KICAgICAgICAgICAgICAgIDogcmVzdWx0LnZhbHVlIDwgYmV0YTsNCiAgICAgICAgICAgIGlmIChuZWVkUmVzZWFyY2gpIHsNCiAgICAgICAgICAgICAgICByZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICAgICAgICAgIGIsIGQgLSAxLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICAgICAgICAgIHNlYXJjaERlcHRoLCBzZWFyY2hJbml0aWF0b3IsIGdhbWVTdGFnZSwgdHJ1ZSwgbmV4dEhhc2gNCiAgICAgICAgICAgICAgICApOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9IGVsc2Ugew0KICAgICAgICAgICAgcmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgICAgIGIsIGQgLSAxLCBhbHBoYSwgYmV0YSwgbmV4dE1heGltaXppbmcsIG5leHRQbGF5ZXIsDQogICAgICAgICAgICAgICAgc2VhcmNoRGVwdGgsIHNlYXJjaEluaXRpYXRvciwgZ2FtZVN0YWdlLCB0cnVlLCBuZXh0SGFzaA0KICAgICAgICAgICAgKTsNCiAgICAgICAgfQ0KDQogICAgICAgIHVubWFrZVNlYXJjaE1vdmUoYiwgbW92ZSwgY2FwdHVyZWQpOw0KDQogICAgICAgIGlmIChtYXhpbWl6aW5nKSB7DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlID4gYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgICAgICBiZXN0TW92ZSA9IG1vdmU7DQogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsNCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlVG9PYmplY3QobW92ZSksIC4uLnJlc3VsdC5tb3ZlU2VxdWVuY2VdOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGFscGhhID0gTWF0aC5tYXgoYWxwaGEsIHJlc3VsdC52YWx1ZSk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgICBpZiAocmVzdWx0LnZhbHVlIDwgYmVzdEV2YWwpIHsNCiAgICAgICAgICAgICAgICBiZXN0RXZhbCA9IHJlc3VsdC52YWx1ZTsNCiAgICAgICAgICAgICAgICBiZXN0TW92ZSA9IG1vdmU7DQogICAgICAgICAgICAgICAgaWYgKFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UpIHsNCiAgICAgICAgICAgICAgICAgICAgYmVzdE1vdmVTZXF1ZW5jZSA9IFttb3ZlVG9PYmplY3QobW92ZSksIC4uLnJlc3VsdC5tb3ZlU2VxdWVuY2VdOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgIH0NCiAgICAgICAgICAgIGJldGEgPSBNYXRoLm1pbihiZXRhLCByZXN1bHQudmFsdWUpOw0KICAgICAgICB9DQoNCiAgICAgICAgaWYgKGJldGEgPD0gYWxwaGEpIHsNCiAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTKSB7CiAgICAgICAgICAgICAgICBpZiAoIXBlcmZTdGF0cy5jdXRvZmZzW2RdKSBwZXJmU3RhdHMuY3V0b2Zmc1tkXSA9IDA7CiAgICAgICAgICAgICAgICBwZXJmU3RhdHMuY3V0b2Zmc1tkXSsrOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmIChTRUFSQ0hfQ09MTEVDVF9NRVRSSUNTICYmIGxlZ2FsTW92ZXNGb3VuZCA9PT0gMSkgew0KICAgICAgICAgICAgICAgIHJlY29yZEZpcnN0TGVnYWxDdXRvZmYoZCk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBpZiAoIWlzQ2FwdHVyZSkgew0KICAgICAgICAgICAgICAgIHN0b3JlS2lsbGVyTW92ZShkLCBtb3ZlKTsNCiAgICAgICAgICAgICAgICBhZGRIaXN0b3J5U2NvcmUobW92ZSwgZCk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBicmVhazsNCiAgICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIOW7tui/n+WQiOazleaAp++8muS8quWQiOazlemdnuepuuS9huaXoOS4gOWQiOazlSDihpIg5bCG5q27L+WbsOavmQ0KICAgIGlmIChsZWdhbE1vdmVzRm91bmQgPT09IDApIHsNCiAgICAgICAgcmV0dXJuIHRlcm1pbmFsU2NvcmUoaW5DaGVjayk7DQogICAgfQ0KDQogICAgc3RvcmVUVChiZXN0RXZhbCwgYmVzdE1vdmUsIGJlc3RNb3ZlU2VxdWVuY2UpOw0KICAgIHJldHVybiB7IHZhbHVlOiBiZXN0RXZhbCwgbW92ZVNlcXVlbmNlOiBTRUFSQ0hfQ09MTEVDVF9NT1ZFX1NFUVVFTkNFID8gYmVzdE1vdmVTZXF1ZW5jZSA6IFtdIH07DQp9Ow0KDQovLyBleGFjdFJvb3RTY29yZXM6IHRydWU9QW5hbHlzaXMg5YWo5qC557K+56Gu5YiG77ybZmFsc2U95a+55byI5qCH5YeGIFBWU++8iGZhaWwtbG93IOS4jeWbnuaQnO+8iQ0KY29uc3QgZ2V0QmVzdE1vdmVJbnRlcm5hbCA9IChib2FyZCwgdHVybiwgZGVwdGggPSA4LCBwbHkgPSAwLCBlbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzID0gZmFsc2UsIGNvbGxlY3RNb3ZlU2VxdWVuY2VPdmVycmlkZSA9IG51bGwpID0+IHsNCiAgY29uc3QgdGltZUxpbWl0ID0gNTAwMDsNCg0KICAvLyBGaXJzdCB0cnkgdG8gZ2V0IG1vdmUgZnJvbSBvcGVuaW5nIGJvb2sNCiAgY29uc3QgYm9va01vdmUgPSBvcGVuaW5nQm9vay5nZXRCb29rTW92ZShib2FyZCwgcGx5KTsNCiAgDQogIGlmIChib29rTW92ZSkgew0KICAgIC8vIENoZWNrIGlmIGJvb2tNb3ZlIGlzIHZhbGlkIGZvciBjdXJyZW50IGJvYXJkDQogICAgaWYgKGJvb2tNb3ZlLmZyb20gJiYgYm9va01vdmUudG8gJiYgDQogICAgICAgIHR5cGVvZiBib29rTW92ZS5mcm9tLnIgPT09ICdudW1iZXInICYmIHR5cGVvZiBib29rTW92ZS5mcm9tLmMgPT09ICdudW1iZXInICYmDQogICAgICAgIHR5cGVvZiBib29rTW92ZS50by5yID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYm9va01vdmUudG8uYyA9PT0gJ251bWJlcicpIHsNCiAgICAgIA0KICAgICAgY29uc3QgbW92aW5nUGllY2UgPSBib2FyZFtib29rTW92ZS5mcm9tLnJdW2Jvb2tNb3ZlLmZyb20uY107DQogICAgICANCiAgICAgIGlmIChtb3ZpbmdQaWVjZSAmJiBtb3ZpbmdQaWVjZS5jb2xvciA9PT0gdHVybikgew0KICAgICAgICAvLyBWZXJpZnkgbW92ZSBpcyB2YWxpZA0KICAgICAgICBjb25zdCB2YWxpZERlc3RpbmF0aW9ucyA9IGdldFZhbGlkTW92ZXMoYm9hcmQsIGJvb2tNb3ZlLmZyb20pOw0KICAgICAgICBjb25zdCBpc1ZhbGlkID0gdmFsaWREZXN0aW5hdGlvbnMuc29tZShkZXN0ID0+IGRlc3QuciA9PT0gYm9va01vdmUudG8uciAmJiBkZXN0LmMgPT09IGJvb2tNb3ZlLnRvLmMpOw0KICAgICAgICANCiAgICAgICAgaWYgKGlzVmFsaWQpIHsNCiAgICAgICAgICByZXR1cm4geyBiZXN0TW92ZTogYm9va01vdmUsIHNlY29uZEJlc3RNb3ZlOiBudWxsLCBtb3ZlU2VxdWVuY2U6IFtdLCBzZWNvbmRNb3ZlU2VxdWVuY2U6IFtdLCBiZXN0TW92ZVNjb3JlOiAwLCBzZWNvbmRCZXN0TW92ZVNjb3JlOiAwLCBhbGxNb3Zlc1dpdGhTY29yZXM6IFtdIH07DQogICAgICAgIH0NCiAgICAgIH0NCiAgICB9DQogIH0NCg0KICAvLyDmoLnoioLngrnvvJrov63ku6PliqDmt7EgKyBQVlPvvJtUVC9raWxsZXIvaGlzdG9yeSDot6jmt7Hluqbkv53nlZnvvIjku4XlvIDlsYDmuIXnqbrkuIDmrKHvvIkNCiAgcmVzZXRQZXJmU3RhdHMoKTsNCiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTsNCiAgdHJhbnNwb3NpdGlvblRhYmxlLnJlc2V0U3RhdHMoKTsNCiAgdHJhbnNwb3NpdGlvblRhYmxlLmNsZWFyKCk7DQogIGNsZWFyRXZhbENhY2hlKCk7DQogIGNvbnN0IG1heERlcHRoID0gTWF0aC5tYXgoMSwgZGVwdGggfCAwKTsNCiAgcmVzZXRTZWFyY2hIZXVyaXN0aWNzKG1heERlcHRoKTsNCiAgc3luY0dlbmVyYWxQb3NDYWNoZShib2FyZCk7DQogIFNFQVJDSF9DT0xMRUNUX01PVkVfU0VRVUVOQ0UgPSB0eXBlb2YgY29sbGVjdE1vdmVTZXF1ZW5jZU92ZXJyaWRlID09PSAnYm9vbGVhbicNCiAgICA/IGNvbGxlY3RNb3ZlU2VxdWVuY2VPdmVycmlkZQ0KICAgIDogISFleGFjdFJvb3RTY29yZXM7DQoNCiAgY29uc3QgcGhhc2UgPSBnZXRHYW1lUGhhc2UoKTsNCiAgY29uc3QgZ2FtZVN0YWdlID0gcGhhc2UgPT09ICdvcGVuaW5nJyA/ICdlYXJseScgOiBwaGFzZSA9PT0gJ21pZGRsZWdhbWUnID8gJ21pZCcgOiAnbGF0ZSc7DQoNCiAgY29uc3Qgcm9vdEV2YWxSZXN1bHQgPSBldmFsdWF0ZUJvYXJkKGJvYXJkLCB0dXJuLCBnYW1lU3RhZ2UsIHsNCiAgICBwYWxhY2VDb250cm9sT25seTogIWV4YWN0Um9vdFNjb3Jlcw0KICB9KTsNCiAgY29uc3Qgcm9vdFBpZWNlc0luZm8gPSByb290RXZhbFJlc3VsdC5waWVjZXNJbmZvOw0KICBjb25zdCByb290Qm9hcmRJbmZvID0gcm9vdEV2YWxSZXN1bHQuYm9hcmRJbmZvOw0KDQogIC8vIOaUtumbhuagueiKgueCuei1sOazle+8iOWPquWBmuS4gOasoe+8ie+8m+acquiiq+WwhuaXtui/h+a7pOmAgeWQgw0KICBsZXQgcm9vdE1vdmVzID0gW107DQogIC8vY29uc3Qgcm9vdEluQ2hlY2sgPSAodHVybiA9PT0gJ3JlZCcgJiYgcm9vdEJvYXJkSW5mby5yZWRJc0luQ2hlY2spIHx8DQogIC8vICAgICAgICAgICAgICAgICAgICAodHVybiA9PT0gJ2JsYWNrJyAmJiByb290Qm9hcmRJbmZvLmJsYWNrSXNJbkNoZWNrKTsNCg0KICBmb3IgKGxldCByID0gMDsgciA8IFJPV1M7IHIrKykgew0KICAgIGZvciAobGV0IGMgPSAwOyBjIDwgQ09MUzsgYysrKSB7DQogICAgICBpZiAoYm9hcmRbcl1bY10/LmNvbG9yID09PSB0dXJuKSB7DQogICAgICAgIGNvbnN0IHBpZWNlID0gYm9hcmRbcl1bY107DQogICAgICAgIGNvbnN0IHZhbGlkRGVzdGluYXRpb25zID0gZ2V0VmFsaWRNb3Zlcyhib2FyZCwgeyByLCBjIH0pOw0KICAgICAgICB2YWxpZERlc3RpbmF0aW9ucy5mb3JFYWNoKHRvID0+IHsNCiAgICAgICAgICAvL2NvbnN0IGlzQWNjZXB0YWJsZSA9IHJvb3RJbkNoZWNrIHx8IGlzUG9zaXRpb25BY2NlcHRhYmxlKGJvYXJkLCB7IHIsIGMgfSwgdG8sIHR1cm4sIHJvb3RCb2FyZEluZm8sIHJvb3RQaWVjZXNJbmZvLCBwaWVjZSwgZ2FtZVN0YWdlKTsNCiAgICAgICAgICAvL2lmIChpc0FjY2VwdGFibGUpIHsNCiAgICAgICAgICAgIHJvb3RNb3Zlcy5wdXNoKHsgZnJvbTogeyByLCBjIH0sIHRvLCBzY29yZTogMCwgbW92ZVNlcXVlbmNlOiBbXSB9KTsNCiAgICAgICAgICAvL30NCiAgICAgICAgfSk7DQogICAgICB9DQogICAgfQ0KICB9DQoNCiAgaWYgKHJvb3RNb3Zlcy5sZW5ndGggPT09IDApIHsNCiAgICByZXR1cm4gew0KICAgICAgYmVzdE1vdmU6IG51bGwsDQogICAgICBzZWNvbmRCZXN0TW92ZTogbnVsbCwNCiAgICAgIG1vdmVTZXF1ZW5jZTogW10sDQogICAgICBzZWNvbmRNb3ZlU2VxdWVuY2U6IFtdLA0KICAgICAgYmVzdE1vdmVTY29yZTogMCwNCiAgICAgIHNlY29uZEJlc3RNb3ZlU2NvcmU6IDAsDQogICAgICBhbGxNb3Zlc1dpdGhTY29yZXM6IFtdDQogICAgfTsNCiAgfQ0KDQogIGNvbnN0IHNvcnRSb290TW92ZXNCeVNjb3JlID0gKG1vdmVzKSA9PiB7DQogICAgbW92ZXMuc29ydCgoYSwgYikgPT4gew0KICAgICAgY29uc3Qgc2NvcmVEaWZmID0gYi5zY29yZSAtIGEuc2NvcmU7DQogICAgICBpZiAoTWF0aC5hYnMoc2NvcmVEaWZmKSA8IDFlLTYpIHsNCiAgICAgICAgaWYgKGEuc2NvcmUgPiAwKSB7DQogICAgICAgICAgcmV0dXJuIChhLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApIC0gKGIubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCk7DQogICAgICAgIH0NCiAgICAgICAgaWYgKGEuc2NvcmUgPCAwKSB7DQogICAgICAgICAgcmV0dXJuIChiLm1vdmVTZXF1ZW5jZT8ubGVuZ3RoIHx8IDApIC0gKGEubW92ZVNlcXVlbmNlPy5sZW5ndGggfHwgMCk7DQogICAgICAgIH0NCiAgICAgICAgcmV0dXJuIDA7DQogICAgICB9DQogICAgICByZXR1cm4gc2NvcmVEaWZmOw0KICAgIH0pOw0KICB9Ow0KDQogIGNvbnN0IHByb21vdGVSb290TW92ZSA9IChtb3ZlcywgcHJlZmVycmVkKSA9PiB7DQogICAgaWYgKCFwcmVmZXJyZWQpIHJldHVybjsNCiAgICBjb25zdCBpZHggPSBtb3Zlcy5maW5kSW5kZXgoKG0pID0+IGlzU2FtZU1vdmUobSwgcHJlZmVycmVkKSk7DQogICAgaWYgKGlkeCA+IDApIHsNCiAgICAgIGNvbnN0IFtoaXRdID0gbW92ZXMuc3BsaWNlKGlkeCwgMSk7DQogICAgICBtb3Zlcy51bnNoaWZ0KGhpdCk7DQogICAgfQ0KICB9Ow0KDQogIGNvbnN0IHdvcmtCb2FyZCA9IGJvYXJkLm1hcCgocm93KSA9PiBbLi4ucm93XSk7DQogIGFjdGl2ZVNlYXJjaFBpZWNlU3RhdGUgPSBjcmVhdGVTZWFyY2hQaWVjZVN0YXRlKHdvcmtCb2FyZCwgZ2FtZVN0YWdlKTsNCiAgY29uc3QgTlVMTF9XSU5ET1dfRVBTID0gMWUtNjsNCiAgY29uc3QgbmV4dFR1cm4gPSB0dXJuID09PSAncmVkJyA/ICdibGFjaycgOiAncmVkJzsNCiAgLy8g5qC55bGA6Z2i5ZOI5biM5Y+q566X5LiA5qyh77yb5aKe6YeP5qih5byP5pW05qO15pCc57Si5qCR55Sx5q2k5rS+55SfDQogIGNvbnN0IHJvb3RIYXNoID0gem9icmlzdEhhc2hlci5oYXNoKGJvYXJkKTsNCiAgaWYgKFNFQVJDSF9DT0xMRUNUX01FVFJJQ1MpIHBlcmZTdGF0cy5mdWxsSGFzaENvdW50Kys7CiAgY29uc3Qgcm9vdFRUS2V5ID0gem9icmlzdEhhc2hlci50dEtleUZyb21IYXNoKHJvb3RIYXNoLCB0dXJuKTsNCg0KICBsZXQgY29tcGxldGVkRGVwdGggPSAwOw0KDQogIGZvciAobGV0IGN1cnJlbnREZXB0aCA9IDE7IGN1cnJlbnREZXB0aCA8PSBtYXhEZXB0aDsgY3VycmVudERlcHRoKyspIHsNCiAgICBpZiAoZW5hYmxlVGltZUxpbWl0ICYmIGNvbXBsZXRlZERlcHRoID4gMCAmJiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lID4gdGltZUxpbWl0KSB7DQogICAgICBjb25zb2xlLmxvZyhgSUQgc3RvcHBlZCBiZWZvcmUgZGVwdGggJHtjdXJyZW50RGVwdGh9IGR1ZSB0byB0aW1lIGxpbWl0IChsYXN0IGNvbXBsZXRlZD0ke2NvbXBsZXRlZERlcHRofSlgKTsNCiAgICAgIGJyZWFrOw0KICAgIH0NCg0KICAgIC8vIOa1heWxguacgOS9s+edgCArIFRUIOedgOaOkuWIsOacgOWJje+8jOS+m+acrOWxgiBQVlMg56ys5LiA552A5YWo56qX5L2/55SoDQogICAgY29uc3QgdHRFbnRyeSA9IHRyYW5zcG9zaXRpb25UYWJsZS5yZXRyaWV2ZShyb290VFRLZXkpOw0KICAgIGNvbnN0IHR0TW92ZSA9IHR0RW50cnkgJiYgdHRFbnRyeS5iZXN0TW92ZSA/IHR0RW50cnkuYmVzdE1vdmUgOiBudWxsOw0KICAgIGNvbnN0IHByZXZCZXN0ID0gcm9vdE1vdmVzWzBdOw0KICAgIHNvcnRNb3Zlc0Zhc3Qocm9vdE1vdmVzLCBib2FyZCwgdHVybiwgcm9vdFBpZWNlc0luZm8sIGdhbWVTdGFnZSwgcm9vdEJvYXJkSW5mbywgew0KICAgICAgdHRNb3ZlLA0KICAgICAga2lsbGVyczoga2lsbGVyTW92ZXNbTWF0aC5tYXgoMCwgY3VycmVudERlcHRoIC0gMSldIHx8IFtudWxsLCBudWxsXQ0KICAgIH0pOw0KICAgIC8vIOS4iuS4gOWxguacgOS9s+edgOaUvuesrOS4gO+8iOacgOWQjiBwcm9tb3Rl77yJ77yM5L+d6K+B5pys5bGCIFBWUyDpppbnnYDlhajnqpflkb3kuK3ng63ot6/lvoQNCiAgICBwcm9tb3RlUm9vdE1vdmUocm9vdE1vdmVzLCB0dE1vdmUpOw0KICAgIHByb21vdGVSb290TW92ZShyb290TW92ZXMsIHByZXZCZXN0KTsNCg0KICAgIGNvbnN0IHVzZUV4YWN0Um9vdCA9IGV4YWN0Um9vdFNjb3JlcyAmJiBjdXJyZW50RGVwdGggPT09IG1heERlcHRoOw0KICAgIGNvbnN0IHVzZVBsYXlTZWFyY2ggPSAhZXhhY3RSb290U2NvcmVzOw0KICAgIGxldCByb290QWxwaGEgPSAtSW5maW5pdHk7DQoNCiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJvb3RNb3Zlcy5sZW5ndGg7IGkrKykgew0KICAgICAgY29uc3QgaXRlbSA9IHJvb3RNb3Zlc1tpXTsNCiAgICAgIGNvbnN0IG1vdmluZ1BpZWNlID0gd29ya0JvYXJkW2l0ZW0uZnJvbS5yXVtpdGVtLmZyb20uY107DQogICAgICBjb25zdCBjYXB0dXJlZCA9IG1ha2VNb3ZlKHdvcmtCb2FyZCwgaXRlbS5mcm9tLCBpdGVtLnRvKTsNCiAgICAgIGNvbnN0IGNoaWxkSGFzaCA9IGNoaWxkQm9hcmRIYXNoKHJvb3RIYXNoLCBpdGVtLCBtb3ZpbmdQaWVjZSwgY2FwdHVyZWQpOw0KDQogICAgICBsZXQgYWxwaGFCZXRhUmVzdWx0Ow0KICAgICAgbGV0IHNjb3JlOw0KICAgICAgbGV0IHNjb3JlSXNFeGFjdCA9IHRydWU7DQogICAgICBpZiAoaSA9PT0gMCB8fCByb290QWxwaGEgPT09IC1JbmZpbml0eSkgew0KICAgICAgICBpZiAodXNlUGxheVNlYXJjaCkgew0KICAgICAgICAgIHNjb3JlID0gYWxwaGFCZXRhUGxheSgNCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwgLUluZmluaXR5LCBJbmZpbml0eSwNCiAgICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIGNoaWxkSGFzaA0KICAgICAgICAgICk7DQogICAgICAgIH0gZWxzZSB7DQogICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LA0KICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoDQogICAgICAgICAgKTsNCiAgICAgICAgICBzY29yZSA9IGFscGhhQmV0YVJlc3VsdC52YWx1ZTsNCiAgICAgICAgfQ0KICAgICAgfSBlbHNlIHsNCiAgICAgICAgbGV0IHByb2JlOw0KICAgICAgICBpZiAodXNlUGxheVNlYXJjaCkgew0KICAgICAgICAgIHByb2JlID0gYWxwaGFCZXRhUGxheSgNCiAgICAgICAgICAgIHdvcmtCb2FyZCwgY3VycmVudERlcHRoIC0gMSwNCiAgICAgICAgICAgIHJvb3RBbHBoYSwgcm9vdEFscGhhICsgTlVMTF9XSU5ET1dfRVBTLA0KICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgY2hpbGRIYXNoDQogICAgICAgICAgKTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICBhbHBoYUJldGFSZXN1bHQgPSBhbHBoYUJldGEoDQogICAgICAgICAgICB3b3JrQm9hcmQsIGN1cnJlbnREZXB0aCAtIDEsDQogICAgICAgICAgICByb290QWxwaGEsIHJvb3RBbHBoYSArIE5VTExfV0lORE9XX0VQUywNCiAgICAgICAgICAgIGZhbHNlLCBuZXh0VHVybiwgY3VycmVudERlcHRoLCB0dXJuLCBnYW1lU3RhZ2UsIHRydWUsIGNoaWxkSGFzaA0KICAgICAgICAgICk7DQogICAgICAgICAgcHJvYmUgPSBhbHBoYUJldGFSZXN1bHQudmFsdWU7DQogICAgICAgIH0NCiAgICAgICAgaWYgKHByb2JlID4gcm9vdEFscGhhKSB7DQogICAgICAgICAgaWYgKHVzZVBsYXlTZWFyY2gpIHsNCiAgICAgICAgICAgIHNjb3JlID0gYWxwaGFCZXRhUGxheSgNCiAgICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCByb290QWxwaGEsIEluZmluaXR5LA0KICAgICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCBjaGlsZEhhc2gNCiAgICAgICAgICAgICk7DQogICAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAgIGFscGhhQmV0YVJlc3VsdCA9IGFscGhhQmV0YSgNCiAgICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCByb290QWxwaGEsIEluZmluaXR5LA0KICAgICAgICAgICAgICBmYWxzZSwgbmV4dFR1cm4sIGN1cnJlbnREZXB0aCwgdHVybiwgZ2FtZVN0YWdlLCB0cnVlLCBjaGlsZEhhc2gNCiAgICAgICAgICAgICk7DQogICAgICAgICAgICBzY29yZSA9IGFscGhhQmV0YVJlc3VsdC52YWx1ZTsNCiAgICAgICAgICB9DQogICAgICAgIH0gZWxzZSBpZiAodXNlRXhhY3RSb290KSB7DQogICAgICAgICAgYWxwaGFCZXRhUmVzdWx0ID0gYWxwaGFCZXRhKA0KICAgICAgICAgICAgd29ya0JvYXJkLCBjdXJyZW50RGVwdGggLSAxLCAtSW5maW5pdHksIEluZmluaXR5LA0KICAgICAgICAgICAgZmFsc2UsIG5leHRUdXJuLCBjdXJyZW50RGVwdGgsIHR1cm4sIGdhbWVTdGFnZSwgdHJ1ZSwgY2hpbGRIYXNoDQogICAgICAgICAgKTsNCiAgICAgICAgICBzY29yZSA9IGFscGhhQmV0YVJlc3VsdC52YWx1ZTsNCiAgICAgICAgfSBlbHNlIHsNCiAgICAgICAgICAvLyBmYWlsLWxvd++8muaOoua1i+WIhuWPquaYr+S4iueVjO+8jOS4jeiDveW9k+eyvuehruWIhuWGmeWFpe+8iOWQpuWImSBJRCDkuIvlsYLmjpLluo/ooqvmsaHmn5PvvIzmmJPlj43lpI3otbDngq7vvIkNCiAgICAgICAgICBzY29yZSA9IHByb2JlOw0KICAgICAgICAgIHNjb3JlSXNFeGFjdCA9IGZhbHNlOw0KICAgICAgICB9DQogICAgICB9DQoNCiAgICAgIHVubWFrZU1vdmUod29ya0JvYXJkLCBpdGVtLmZyb20sIGl0ZW0udG8sIGNhcHR1cmVkKTsNCg0KICAgICAgaWYgKHNjb3JlSXNFeGFjdCkgew0KICAgICAgICBpdGVtLnNjb3JlID0gc2NvcmU7DQogICAgICAgIGl0ZW0ubW92ZVNlcXVlbmNlID0gU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRQ0KICAgICAgICAgID8gW3sgZnJvbTogaXRlbS5mcm9tLCB0bzogaXRlbS50byB9LCAuLi4oYWxwaGFCZXRhUmVzdWx0Lm1vdmVTZXF1ZW5jZSB8fCBbXSldDQogICAgICAgICAgOiBbXTsNCiAgICAgICAgaWYgKGl0ZW0uc2NvcmUgPiByb290QWxwaGEpIHsNCiAgICAgICAgICByb290QWxwaGEgPSBpdGVtLnNjb3JlOw0KICAgICAgICB9DQogICAgICB9IGVsc2UgaWYgKGl0ZW0uc2NvcmUgPiByb290QWxwaGEpIHsNCiAgICAgICAgLy8g5L+d55WZ5LiK5LiA5bGC5YiG5pWw77yb6Iul5LuN6auY5LqO5b2T5YmNIM6x77yI5byC5bi477yJ77yM55Wl6ZmN5Lul5YWN5oyk5o6J55yf5pyA5LyYDQogICAgICAgIGl0ZW0uc2NvcmUgPSByb290QWxwaGEgLSAxZS0zOw0KICAgICAgfQ0KICAgIH0NCg0KICAgIHNvcnRSb290TW92ZXNCeVNjb3JlKHJvb3RNb3Zlcyk7DQogICAgY29tcGxldGVkRGVwdGggPSBjdXJyZW50RGVwdGg7DQoNCiAgICAvLyDmiormnKzlsYLmnIDkvbPnnYDlhpnlhaUgVFTvvIzkvpvmm7Tmt7HkuIDlsYLmoLnmjpLluo8NCiAgICB0cmFuc3Bvc2l0aW9uVGFibGUuc3RvcmUoDQogICAgICByb290VFRLZXksDQogICAgICBjdXJyZW50RGVwdGgsDQogICAgICByb290TW92ZXNbMF0uc2NvcmUsDQogICAgICAnZXhhY3QnLA0KICAgICAgcm9vdE1vdmVzWzBdLA0KICAgICAgU0VBUkNIX0NPTExFQ1RfTU9WRV9TRVFVRU5DRSA/IChyb290TW92ZXNbMF0ubW92ZVNlcXVlbmNlIHx8IFtdKSA6IG51bGwNCiAgICApOw0KDQogIH0NCg0KICBjb25zdCBiZXN0TW92ZSA9IHJvb3RNb3Zlc1swXSB8fCBudWxsOw0KICBjb25zdCBzZWNvbmRCZXN0TW92ZSA9IHJvb3RNb3Zlcy5sZW5ndGggPiAxID8gcm9vdE1vdmVzWzFdIDogbnVsbDsNCiAgY29uc3QgYmVzdE1vdmVTZXF1ZW5jZSA9IGJlc3RNb3ZlID8gKGJlc3RNb3ZlLm1vdmVTZXF1ZW5jZSB8fCBbXSkgOiBbXTsNCiAgY29uc3Qgc2Vjb25kTW92ZVNlcXVlbmNlID0gc2Vjb25kQmVzdE1vdmUgPyAoc2Vjb25kQmVzdE1vdmUubW92ZVNlcXVlbmNlIHx8IFtdKSA6IFtdOw0KICBjb25zdCBiZXN0TW92ZVNjb3JlID0gYmVzdE1vdmUgPyBiZXN0TW92ZS5zY29yZSA6IDA7DQogIGNvbnN0IHNlY29uZEJlc3RNb3ZlU2NvcmUgPSBzZWNvbmRCZXN0TW92ZSA/IHNlY29uZEJlc3RNb3ZlLnNjb3JlIDogMDsNCg0KICBjb25zdCBhbGxNb3Zlc1dpdGhTY29yZXMgPSByb290TW92ZXMubWFwKChtb3ZlSW5mbykgPT4gKHsNCiAgICBtb3ZlOiB7DQogICAgICBmcm9tOiBtb3ZlSW5mby5mcm9tLA0KICAgICAgdG86IG1vdmVJbmZvLnRvDQogICAgfSwNCiAgICBzY29yZTogbW92ZUluZm8uc2NvcmUsDQogICAgbW92ZVNlcXVlbmNlOiBtb3ZlSW5mby5tb3ZlU2VxdWVuY2UgfHwgW10NCiAgfSkpOw0KDQogIGNvbnN0IHJlc3VsdCA9IHsNCiAgICBiZXN0TW92ZSwNCiAgICBzZWNvbmRCZXN0TW92ZSwNCiAgICBtb3ZlU2VxdWVuY2U6IGJlc3RNb3ZlU2VxdWVuY2UsDQogICAgc2Vjb25kTW92ZVNlcXVlbmNlLA0KICAgIGJlc3RNb3ZlU2NvcmUsDQogICAgc2Vjb25kQmVzdE1vdmVTY29yZSwNCiAgICBhbGxNb3Zlc1dpdGhTY29yZXMsDQogICAgY29tcGxldGVkRGVwdGgNCiAgfTsNCiAgYWN0aXZlU2VhcmNoUGllY2VTdGF0ZSA9IG51bGw7DQogIHJldHVybiByZXN1bHQ7DQp9Ow0KDQovLyBQbGF5IGtlZXBzIHJvb3QgZmFpbC1sb3cgcHJvYmVzIGFzIGJvdW5kczsgYW5hbHlzaXMgcmUtc2VhcmNoZXMgZXZlcnkgZmluYWwNCi8vIHJvb3QgbW92ZSBhbmQgcmV0YWlucyBQViBkYXRhLiBLZWVwaW5nIHRoZWlyIGVudHJ5IHBvaW50cyBzZXBhcmF0ZSBwcmV2ZW50cw0KLy8gZnV0dXJlIHBsYXktcGF0aCB3b3JrIGZyb20gc2lsZW50bHkgY2hhbmdpbmcgYW5hbHlzaXMgc2VtYW50aWNzLg0KY29uc3QgZ2V0QmVzdE1vdmVGb3JQbGF5ID0gKGJvYXJkLCB0dXJuLCBkZXB0aCwgcGx5LCBlbmFibGVUaW1lTGltaXQpID0+DQogIGdldEJlc3RNb3ZlSW50ZXJuYWwoYm9hcmQsIHR1cm4sIGRlcHRoLCBwbHksIGVuYWJsZVRpbWVMaW1pdCwgZmFsc2UsIGZhbHNlKTsNCg0KY29uc3QgZ2V0QmVzdE1vdmVGb3JBbmFseXNpcyA9IChib2FyZCwgdHVybiwgZGVwdGgsIHBseSwgZW5hYmxlVGltZUxpbWl0KSA9Pg0KICBnZXRCZXN0TW92ZUludGVybmFsKGJvYXJkLCB0dXJuLCBkZXB0aCwgcGx5LCBlbmFibGVUaW1lTGltaXQsIHRydWUsIHRydWUpOw0KDQpjb25zdCBnZXRCZXN0TW92ZSA9IChib2FyZCwgdHVybiwgZGVwdGggPSA4LCBwbHkgPSAwLCBlbmFibGVUaW1lTGltaXQgPSBmYWxzZSwgZXhhY3RSb290U2NvcmVzID0gZmFsc2UpID0+DQogIGV4YWN0Um9vdFNjb3Jlcw0KICAgID8gZ2V0QmVzdE1vdmVGb3JBbmFseXNpcyhib2FyZCwgdHVybiwgZGVwdGgsIHBseSwgZW5hYmxlVGltZUxpbWl0KQ0KICAgIDogZ2V0QmVzdE1vdmVGb3JQbGF5KGJvYXJkLCB0dXJuLCBkZXB0aCwgcGx5LCBlbmFibGVUaW1lTGltaXQpOw0KDQovLyAtLS0gV09SS0VSIExJU1RFTkVSICjnu5/kuIDmtojmga/lpITnkIYpIC0tLQ0K';
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
                                    {[6, 7, 8, 9, 10].map((depth) => (
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

